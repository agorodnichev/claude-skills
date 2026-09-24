# web.dev "Fast" collection, batch 6: Performance monitoring with Lighthouse CI

Scope: one article, "Performance monitoring with Lighthouse CI" (Katie Hempenius, web.dev, last updated 2020-07-27). The article shows how to run Lighthouse CI (LHCI) locally, in CI, as a GitHub status check, and with the LHCI server. It is six years old, so I checked every tool, version, audit ID and service against current primary sources: the LHCI repo docs and source (`main`, last commit 2025-06-26), the npm registry, the Lighthouse changelog and `default-config.js` (Lighthouse 13.5.0, 2026-09-17), developer.chrome.com release posts, chromestatus, and the Chromium SwiftShader doc.

Main finding: the article's workflow still works in shape, but most of its details are outdated. The most important one: the newest LHCI (`@lhci/cli` 0.15.1, June 2025) bundles Lighthouse 12.6.1. Current Lighthouse is 13.5.0, and 13.0 removed or renamed many performance audits. LHCI therefore tests a different audit set than DevTools and PageSpeed Insights (PSI) show today.

Outdated advice in the article (as of 2026-09):

| Article says (2020) | Current status | Source |
|---|---|---|
| `npm install -g @lhci/cli@0.3.x` | Latest is 0.15.1 (2025-06-25); docs pin `@lhci/cli@0.15.x` | npm registry; LHCI getting-started.md |
| `actions/checkout@v1`, `actions/setup-node@v1`, Node `10.x` | checkout v7.0.1 and setup-node v7.0.0 (July 2026). Node 10/16/18/20 are end-of-life; LTS lines are 22 and 24. Lighthouse 12.6.1 needs Node >=18.20; Lighthouse 13 needs >=22.19 | GitHub releases API; nodejs/Release schedule.json; npm `engines` |
| Temporary public storage keeps reports "seven days" | "3 days to 5 weeks depending on available capacity". It is public and run by Eris Ventures LLC, not Google | LHCI services-disclaimer.md |
| `lhci autorun ... \|\| echo "LHCI failed!"` | This swallows the exit code, so an `error` assertion can never fail the job | article + LHCI assert docs (inference from shell semantics) |
| Budgets through Lighthouse `budgetPath` / `performance-budget` (in LHCI docs and linked web.dev budget articles) | Lighthouse 12.0 "remove budgets". LHCI `budgetsFile` still works because LHCI converts budget.json into its own assertions | Lighthouse changelog 12.0.0; LHCI `budgets-converter.js` |
| Presets `lighthouse:no-pwa`, audits `uses-rel-preload`, `offscreen-images`, `uses-webp-images`, `tap-targets` in LHCI examples | PWA category removed in Lighthouse 12. `tap-targets` replaced by `target-size` (12.0). `offscreen-images` and `uses-rel-preload` removed in 13.0. LHCI source says `// TODO: PWA doesn't exist anymore, so remove?` | Lighthouse changelog; LHCI `presets/no-pwa.js` |
| Assertion default `minScore: 1` (LHCI docs) | LHCI source uses 0.9 when you give only a level and no other option | LHCI `assertions.js` line ~179 |

## Standard levers seen

- Monitor performance over time, not with one Lighthouse snapshot. A single report is one point in time; CI history shows which commit changed what. (article)
- Set performance budgets and fail builds that exceed them. (article; budgets are covered in depth by other batches)
- Assert category scores (performance, accessibility, SEO, best practices), not only performance. (article)
- Consider a hosted third-party monitoring service if you do not want to run servers and test devices, or if you need email/Slack alerts. (article)
- Lighthouse is a lab tool. Pair it with field data (RUM/CrUX), because lab results change with hardware, network and settings. (LHCI troubleshooting.md, Lighthouse variability.md)
- TBT is the lab proxy for INP in a navigation run. INP has weight 0 in the Lighthouse 13.5 performance category. (Lighthouse `default-config.js`)
- Current Lighthouse performance score weights: FCP 10, LCP 25, TBT 30, CLS 25, SI 10. (Lighthouse `default-config.js`, 13.5.0)

---

### Fail the build on assertion errors: never swallow the lhci exit code
- Layer: tooling
- Stage: network, script-run, main-thread-task, layout, paint
- Metrics: FCP, LCP, TBT, CLS, bundle-size
- When: build, testing
- Impact: high, because a gate that cannot fail catches no regressions
- Do: Run `lhci autorun` as its own CI step and let a non-zero exit fail the job. Use the `error` level only for the assertions you want to block merges, and `warn` for advisory ones. Remove the article's `|| echo "LHCI failed!"`.
- Why: LHCI has three levels. `off` skips the check, `warn` prints to stderr, and `error` prints and exits non-zero. A shell `|| echo` turns every non-zero exit into success, so `error` behaves like `warn`.
- Example:
  ```yaml
  # Before (article, 2020): assertion errors never fail the job
  - run: lhci autorun --upload.target=temporary-public-storage || echo "LHCI failed!"
  # After: the step fails when an 'error' assertion fails
  - run: npx -y @lhci/cli@0.15.x autorun
  ```
- Avoid/caveats: `autorun` only warns on upload failures by default. Add `--failOnUploadFailure` only if lost uploads must block merges. Before you gate, run `lhci healthcheck --fatal` locally to check the config, Chrome and tokens.
- Status: `@lhci/cli` 0.15.1 is the latest release (2025-06-25). The repo has had no commits since 2025-06-26, so treat LHCI as maintenance-mode. Source: npm registry; GitHub commits API.
- Sources: https://web.dev/articles/lighthouse-ci ; https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#assert

### Audit the production build that LHCI serves, not a dev server
- Layer: tooling, build
- Stage: network, script-compile, script-run
- Metrics: FCP, LCP, TBT, bundle-size
- When: build, testing
- Impact: high, because dev servers ship unminified code and HMR clients that distort every byte and CPU number
- Do: Build first (`npm run build`), then point LHCI at the output with `collect.staticDistDir` for static output or `collect.startServerCommand` for a server. For a client-routed SPA served from a static folder, set `isSinglePageApplication: true` so unknown paths get `index.html`. List the exact `url`s you care about (for example the terminal route).
- Why: LHCI starts a server, runs Lighthouse against it, and stops it after collection. With `staticDistDir` it uses its own static server and rewrites the port in `url`. With `startServerCommand` it waits for stdout to match `startServerReadyPattern` (default `listen|ready`) for up to `startServerReadyTimeout` (default 10000 ms), then continues anyway.
- Example:
  ```js
  // lighthouserc.cjs
  module.exports = {
    ci: {
      collect: {
        startServerCommand: 'node ./dist/server.js',
        startServerReadyPattern: 'Server ready',
        url: ['http://localhost:4173/terminal', 'http://localhost:4173/'],
        numberOfRuns: 5,
      },
    },
  };
  ```
- Avoid/caveats: Do not combine `staticDistDir` with a non-localhost `url` or with `startServerCommand`. Autodiscovery finds at most 5 HTML files (`maxAutodiscoverUrls`) and searches only 2 folder levels deep (`staticDirFileDiscoveryDepth`). It looks in `dist`, `build`, `out`, `public`, in that order. If nothing matches, it falls back to an npm script named `serve:lhci`. LHCI looks for the config file only in the working directory (`.lighthouserc.js`, `lighthouserc.js`, `.cjs`, `.json`, `.yml`, `.yaml` variants) and never in parent folders. In a monorepo, pass `--config=./path/lighthouserc.cjs`.
- Status: Current in LHCI 0.15.x docs. Source: LHCI configuration.md.
- Sources: https://web.dev/articles/lighthouse-ci ; https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#collect

### Collect at least 3 runs (5 for metric gates) and choose the aggregation method for each assertion
- Layer: tooling
- Stage: network, main-thread-task
- Metrics: FCP, LCP, TBT, CLS
- When: testing
- Impact: high, because single runs vary enough to produce false alarms and missed regressions
- Do: Set `collect.numberOfRuns` (default 3; use 5 for timing thresholds). On each metric assertion, set `aggregationMethod` and `minScore`/`maxNumericValue` yourself; do not rely on defaults.
- Why: Lighthouse says the median score of 5 runs is "twice as stable as 1 run". LHCI can aggregate in four ways. `median` takes the median value. `optimistic` (the default) takes the value most likely to pass. `pessimistic` takes the value least likely to pass. `median-run` takes the value from the one "representative" run. In LHCI source, that representative run is the run closest to the median FCP and median TTI (`interactive`). TTI no longer counts toward the score, and the run is not chosen by LCP, TBT or CLS.
- Example:
  ```js
  assert: {
    assertions: {
      // Blocks merges; uses the median, so one lucky run cannot hide a regression
      'largest-contentful-paint': ['error', { maxNumericValue: 2500, aggregationMethod: 'median' }],
      // Catches intermittent long tasks
      'total-blocking-time': ['warn', { maxNumericValue: 200, aggregationMethod: 'pessimistic' }],
    },
  },
  ```
- Avoid/caveats: `optimistic` hides regressions that appear in only some runs. `pessimistic` is noisy on shared CI runners. The docs and source disagree on the default score: the docs say that with no options the defaults are `{"aggregationMethod": "optimistic", "minScore": 1}`, but `assertions.js` uses `minScore` 0.9 when you give a bare level. Set it explicitly.
- Status: Current. Sources: LHCI configuration.md; LHCI `packages/utils/src/assertions.js`, `representative-runs.js` (main); Lighthouse variability.md.
- Sources: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#aggregation-methods ; https://github.com/GoogleChrome/lighthouse-ci/blob/main/packages/utils/src/representative-runs.js ; https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md

### Assert facts (bytes, request counts) before conclusions (scores, TTI)
- Layer: tooling, build
- Stage: network, script-compile
- Metrics: bundle-size, LCP, TBT
- When: build, testing
- Impact: high, because byte and count checks are deterministic, while timing scores drift with hardware
- Do: Gate on `resource-summary:<type>:size|count`, `total-byte-weight`, and `unused-javascript` first. Add metric thresholds later. Resource types: `document`, `script`, `stylesheet`, `image`, `media`, `font`, `other`, `third-party`, `total`.
- Why: The LHCI troubleshooting guide tells you to assert "facts over conclusions", for example the number and size of JavaScript requests rather than TTI. Byte counts do not depend on CPU speed. LHCI reads `size` from the `resource-summary` item's `transferSize` (compressed bytes over the wire), in bytes.
- Example:
  ```js
  assertions: {
    'resource-summary:script:size': ['error', { maxNumericValue: 350 * 1024 }], // bytes, transfer size
    'resource-summary:script:count': ['warn', { maxNumericValue: 12 }],
    'resource-summary:third-party:count': ['error', { maxNumericValue: 0 }],
    'resource-summary:font:count': ['warn', { maxNumericValue: 2 }],
  },
  ```
- Avoid/caveats: Transfer size does not show parse or compile cost after decompression; also track `bootup-time` or `mainthread-work-breakdown`. Units differ: LHCI assertions use bytes, but a budget.json file uses kilobytes. The LHCI converter multiplies by 1024. `budgetsFile` cannot be combined with other assert options. Lighthouse's own `budgetPath` setting and `performance-budget` audit were removed in Lighthouse 12, so the LHCI docs' "Budgets.json" recipe no longer works. `budgetsFile` still works because LHCI turns it into `resource-summary:*` assertions itself.
- Status: `resource-summary` and `total-byte-weight` exist in Lighthouse 12.6.1 and 13.5.0. Budgets were removed in Lighthouse 12.0.0 (2024-04-22, "remove budgets"). Sources: Lighthouse changelog; `default-config.js`; LHCI `budgets-converter.js`.
- Sources: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/troubleshooting.md ; https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#budgetsfile ; https://github.com/GoogleChrome/lighthouse/blob/main/changelog.md

### Emit User Timing marks at app milestones and assert them in CI
- Layer: js, tooling
- Stage: script-run, gpu-draw, paint
- Metrics: startup, LCP, TBT
- When: load, testing
- Impact: high for canvas/WebGL apps, because LCP and FCP do not see when a chart has drawn its first data
- Do: Call `performance.mark()` once at each milestone that matters, for example "chart surface created" and "first frame with data drawn". Add `performance.measure()` for the phases between them. Assert them as `user-timings:<kebab-cased-name>` with `maxNumericValue` in milliseconds.
- Why: LHCI reads the Lighthouse `user-timings` audit. It kebab-cases your name, and uses the mark's `startTime` or the measure's `duration`. Only the first entry with a matching name in each run is used. If the entry is missing in any run, the assertion fails with `auditRan`, so the check also proves the chart finished loading.
- Example:
  ```ts
  // Original helper: one mark per name, so CI always reads the right entry
  const done = new Set<string>();
  export function milestone(name: string): void {
    if (done.has(name)) return;
    done.add(name);
    performance.mark(name);
  }

  milestone('chart-init-start');
  // ...create the chart surface, load the first candles...
  // call this from your chart library's "frame rendered" hook, once data is visible
  milestone('chart-first-data-frame');
  performance.measure('chart-boot', 'chart-init-start', 'chart-first-data-frame');
  ```
  ```js
  // lighthouserc.cjs
  assertions: {
    'user-timings:chart-first-data-frame': ['error', { maxNumericValue: 2500, aggregationMethod: 'median' }],
    'user-timings:chart-boot': ['warn', { maxNumericValue: 600, aggregationMethod: 'median' }],
  },
  ```
- Avoid/caveats: Emit the mark during the load. Lighthouse ends a navigation after load plus about 1 s of network and CPU quiet (`pauseAfterLoadMs`, `networkQuietThresholdMs`, `cpuQuietThresholdMs` = 1000), capped at `maxWaitForLoad` 45000 ms, so a later mark is missing. Inference, not stated in the docs: the `user-timings` audit reads raw trace timestamps. Under the default `throttlingMethod: 'simulate'`, the page loads unthrottled, so these values are unthrottled observations, not simulated slow-device times. If you need throttled values for user timings, use `throttlingMethod: 'devtools'`; Lighthouse then uses 5250 ms quiet windows. Pick names without collisions: `My Mark` and `my-mark` kebab-case to the same key.
- Status: `performance.mark()` is Baseline widely available (MDN: "available across browsers since September 2017"). The LHCI `user-timings:` syntax is current in 0.15.x. Sources: MDN Performance.mark; LHCI configuration.md "User Timings"; LHCI `assertions.js`; Lighthouse `constants.js`.
- Sources: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#user-timings ; https://github.com/GoogleChrome/lighthouse/blob/main/core/audits/user-timings.js ; https://github.com/GoogleChrome/lighthouse/blob/main/core/config/constants.js

### Give each route class its own thresholds with assertMatrix
- Layer: tooling
- Stage: network, main-thread-task
- Metrics: LCP, TBT, CLS, bundle-size
- When: testing
- Impact: medium, because one global threshold is too loose for landing pages or too strict for the app shell
- Do: Use `assert.assertMatrix` with `matchingUrlPattern` regexes to apply different assertion sets to marketing pages and to heavy app routes such as a trading terminal.
- Why: Each matrix entry is tested against the run's `finalUrl` with `new RegExp(pattern)`. Only matching entries apply, so thresholds follow the real cost of each page type.
- Example:
  ```js
  assert: {
    assertMatrix: [
      { matchingUrlPattern: '.*', assertions: { 'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }] } },
      { matchingUrlPattern: '/terminal', assertions: {
          'resource-summary:script:size': ['error', { maxNumericValue: 900 * 1024 }],
          'user-timings:chart-first-data-frame': ['error', { maxNumericValue: 3000 }] } },
    ],
  },
  ```
- Avoid/caveats: The pattern matches `finalUrl`, which is after redirects. A redirect to a login page therefore changes which entries apply.
- Status: Current. Source: LHCI configuration.md "assertMatrix"; LHCI `assertions.js` (`doesLHRMatchPattern`).
- Sources: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#assertmatrix

### Start from lighthouse:recommended and burn down failures; do not start from lighthouse:all
- Layer: tooling
- Stage: network, script-run, layout
- Metrics: FCP, LCP, TBT, CLS, bundle-size
- When: testing
- Impact: medium, because an unreachable gate gets disabled or ignored
- Do: Use `preset: 'lighthouse:recommended'`, turn off each audit that fails today, and treat the list of `'off'` entries as a backlog. Adopt in stages: collect and upload first, then add assertions, then add the server.
- Why: `lighthouse:recommended` requires a perfect score on every audit outside performance. Performance metrics only warn. Opportunity audits error when they flag any item (`maxLength: 0`, for example `unused-javascript`, `unminified-javascript`, `uses-text-compression`). The source also includes insight audits (`cache-insight`, `render-blocking-insight`, `dom-size-insight`) at `warn`. `lighthouse:all` requires a perfect score on every audit, which the docs call "extremely difficult".
- Avoid/caveats: `lighthouse:no-pwa` is legacy: it is `recommended` with `is-on-https` and `viewport` turned off, and its source has a TODO to remove it. The preset lists audit IDs that Lighthouse 13 removed (for example `offscreen-images`, `uses-rel-preconnect`). This only works because LHCI still runs Lighthouse 12.6.1 (see the next item).
- Status: Presets `all`, `recommended`, `no-pwa` exist in LHCI 0.15.1. Source: LHCI `packages/utils/src/presets/`.
- Sources: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/getting-started.md#add-assertions ; https://github.com/GoogleChrome/lighthouse-ci/blob/main/packages/utils/src/presets/recommended.js

### Pin the Lighthouse version and key assertions only to audit IDs that exist in it
- Layer: tooling
- Stage: network, script-run, layout
- Metrics: FCP, LCP, TBT, CLS
- When: build, testing
- Impact: high, because a version change can break the gate or silently change what it measures
- Do: Pin `@lhci/cli@0.15.x`; it bundles `lighthouse@12.6.1`. When you compare CI results with DevTools or PSI (Lighthouse 13.x), expect different audit lists. Prefer IDs that exist in both 12.6 and 13.5: the five scored metrics, `resource-summary`, `total-byte-weight`, `user-timings`, `unused-javascript`, `unused-css-rules`, `unminified-*`, `bootup-time`, `mainthread-work-breakdown`, `long-tasks`, and the `*-insight` audits.
- Why: Lighthouse 13.0 (2025-10-10) removed performance audits that performance insights replaced. For example, `render-blocking-resources` became `render-blocking-insight`, `critical-request-chains` and `uses-rel-preconnect` became `network-dependency-tree-insight`, and image audits became `image-delivery-insight`. It also removed `offscreen-images`, `uses-rel-preload`, `preload-fonts`, `no-document-write`, `uses-passive-event-listeners`, `third-party-facades`, `font-size` and `first-meaningful-paint` with no replacement. In LHCI, an assertion on an audit that is missing from the report fails with `auditRan` (and the message `"<id>" is not a known audit.` when the ID is not in the preset).
- Avoid/caveats: The insights blog post lists some IDs (`use-cache-insight`, `lcp-phases-insight`, `interaction-to-next-paint-insight`) that differ from the current `default-config.js` (`cache-insight`, `lcp-breakdown-insight`, `inp-breakdown-insight`). Use `default-config.js` of your pinned version as the source of truth. Lighthouse 13.1 added a `baseline` audit (web-features Baseline status, informative only) and 13.2/13.3 added an "agentic browsing" category; neither is in LHCI's Lighthouse 12.6.1.
- Status: `@lhci/cli` 0.15.1 → `lighthouse` 12.6.1 (npm dependencies). Latest Lighthouse is 13.5.0 (2026-09-18), shipping in Chrome 156 DevTools. Sources: npm registry; Lighthouse changelog; developer.chrome.com/blog/lighthouse-13-0; developer.chrome.com/blog/moving-lighthouse-to-insights (2025-04-28).
- Sources: https://developer.chrome.com/blog/lighthouse-13-0 ; https://developer.chrome.com/blog/moving-lighthouse-to-insights ; https://github.com/GoogleChrome/lighthouse/blob/main/core/config/default-config.js ; https://registry.npmjs.org/@lhci/cli

### Match Lighthouse emulation to the product: use the desktop preset for a desktop trading terminal
- Layer: tooling
- Stage: network, main-thread-task, layout
- Metrics: FCP, LCP, TBT, CLS
- When: testing
- Impact: medium, because mobile emulation on a desktop-first app measures a device and viewport your users do not have
- Do: Set `collect.settings.preset: 'desktop'` for desktop-first pages. Keep mobile runs for the pages that mobile users load. Run both as separate LHCI configs if you need both.
- Why: Default settings emulate a moto g power at 412x823 with DPR 1.75, simulated slow 4G (150 ms RTT, 1.6 Mbps down / 750 Kbps up) and 4x CPU slowdown. The desktop preset uses a 1350x940 viewport, DPR 1 and `desktopDense4G` throttling. Layout, image choice, chart canvas size and CPU budget all change with these settings.
- Example:
  ```js
  collect: { settings: { preset: 'desktop' } },
  ```
- Avoid/caveats: The troubleshooting guide says the desktop setting in DevTools/PSI also changes throttling, not only the form factor. Results only compare within the same settings (form factor, throttling, storage reset, auth state, headless or headful, hardware, location).
- Status: Current in Lighthouse 13.5 `constants.js` and `desktop-config.js`. Source: Lighthouse repo.
- Sources: https://github.com/GoogleChrome/lighthouse/blob/main/core/config/constants.js ; https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md ; https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/troubleshooting.md

### Stabilize the lab: dedicated runners, one run per machine, third parties blocked, CPU calibrated
- Layer: tooling
- Stage: network, main-thread-task
- Metrics: FCP, LCP, TBT, CLS
- When: testing
- Impact: high, because runner noise is the main cause of flaky performance gates
- Do: Run LHCI on dedicated machines with at least 2 cores (4 recommended) and 2 GB RAM (4-8 GB recommended). Never run two Lighthouse runs at once on one machine. Avoid burstable/shared-core instances and function-as-a-service. Block nondeterministic third parties with `settings.blockedUrlPatterns`, and remove random timers and A/B code paths in the test build. Check `benchmarkIndex` ("CPU/Memory Power") and tune `throttling.cpuSlowdownMultiplier` if the runner is slow.
- Why: The Lighthouse variability doc rates page nondeterminism, client hardware and resource contention as high-impact sources. Simulated throttling only partly corrects them. Scaling out (four small instances) is better than scaling up (one large one), because concurrent runs compete for CPU. The default 4x CPU slowdown assumes a high-end desktop host; on a weak runner it over-throttles.
- Example:
  ```js
  collect: {
    settings: {
      blockedUrlPatterns: ['*googletagmanager.com*', '*analytics*'],
      throttling: { cpuSlowdownMultiplier: 2 }, // calibrated from benchmarkIndex on this runner
    },
  },
  ```
- Avoid/caveats: Blocking third parties hides their real cost. Measure them separately (the `third-party` resource-summary row, `third-parties-insight`). The docs name AWS `m5.large`, GCP `n2-standard-2` and Azure `D2` as enough for one run at a time.
- Status: Current. Sources: Lighthouse variability.md and throttling.md (main); LHCI troubleshooting.md.
- Sources: https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md ; https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md ; https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/troubleshooting.md

### Make GPU-rendered (WebGL/WebGPU) pages measurable in CI on purpose, and handle context loss in code
- Layer: gpu, tooling, js
- Stage: gpu-upload, gpu-draw, script-run
- Metrics: startup, LCP, TBT, FPS/smoothness
- When: testing, load
- Impact: high for SciChart-style pages, because a GPU-less runner can make the chart fail or run on a software renderer
- Do: In code, check whether WebGL context creation succeeded and show a Canvas2D or message fallback when it failed. In CI, decide the GPU mode explicitly: use a GPU runner, or opt in to SwiftShader with `--enable-unsafe-swiftshader` for functional checks only. Do not copy the LHCI docs' `chromeFlags: '--disable-gpu --no-sandbox'` example into a WebGL page's config without thinking.
- Why: Chrome deprecated the automatic WebGL fallback to SwiftShader (CPU software rendering), and chromestatus lists milestone 139. The Chromium docs say WebGL context creation will fail instead of falling back. They also say: "Chromium and other browsers do not guarantee WebGL availability." Lighthouse also clears `shader_cache` before each run (`clearStorageTypes`), so every run measures cold shader compilation.
- Example:
  ```ts
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    performance.mark('chart-webgl-unavailable'); // CI can assert this never appears
    renderFallback(canvas); // Canvas2D or a clear message
  }
  ```
- Avoid/caveats: Inference: numbers from a software renderer measure the CPU, not the GPU, so do not gate GPU timing on a GPU-less runner. The docs mark `--enable-unsafe-swiftshader` as unsafe for untrusted content; use it only for your own test builds. Whether headless Chrome on your runner has a hardware GPU depends on the runner; log the renderer string in a `puppeteerScript` to check.
- Status: SwiftShader WebGL fallback: chromestatus "Deprecated", desktop milestone 139. Source: chromestatus feature 5166674414927872; Chromium docs/gpu/swiftshader.md. Lighthouse `clearStorageTypes` includes `shader_cache` in 13.5 `constants.js`.
- Sources: https://chromestatus.com/feature/5166674414927872 ; https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md ; https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#custom-chrome-flags ; https://github.com/GoogleChrome/lighthouse/blob/main/core/config/constants.js

### Test interactions with Lighthouse user flows (timespan mode); LHCI only tests cold navigations
- Layer: tooling
- Stage: main-thread-task, style, layout, paint
- Metrics: INP, TBT, CLS
- When: testing, interaction
- Impact: high for a trading terminal, because most cost comes after load (pan, zoom, symbol switch)
- Do: Write a Puppeteer script with `startFlow(page)` from `lighthouse`. Wrap the interactions in `flow.startTimespan()` / `flow.endTimespan()`, and save the report in CI. Keep LHCI for navigation gates.
- Why: Navigation mode reports one page load, and LHCI's `collect` runs navigations only. Timespan mode measures layout shifts and JavaScript execution time over a period that includes interactions. It gives no overall score and no moment-based metrics such as LCP.
- Example:
  ```js
  import puppeteer from 'puppeteer';
  import { startFlow } from 'lighthouse';
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:4173/terminal');
  const flow = await startFlow(page, { config: { extends: 'lighthouse:default', settings: { preset: 'desktop' } } });
  await flow.startTimespan({ name: 'switch symbol' });
  await page.click('[data-test=symbol-EURUSD]');
  // the app calls performance.mark('symbol-rendered:EURUSD') after the new series is drawn
  await page.waitForFunction(() => performance.getEntriesByName('symbol-rendered:EURUSD').length > 0);
  await flow.endTimespan();
  const flowResult = await flow.createFlowResult(); // assert on flowResult.steps[i].lhr yourself
  await browser.close();
  ```
- Avoid/caveats: User flows have no built-in LHCI assertion or history; you must write the assertions yourself against the flow result. Lighthouse 13 needs Node >=22.19. API names (`startFlow(page, {name, config})`, `startTimespan(flags)`, `endTimespan()`, `createFlowResult()`, `generateReport()`) were checked against `core/user-flow.js` on main.
- Status: User flows available since Lighthouse 9.6/10. Source: Lighthouse docs/user-flows.md (main).
- Sources: https://github.com/GoogleChrome/lighthouse/blob/main/docs/user-flows.md

### Keep reports of a private or financial app off public storage
- Layer: tooling
- Stage: network
- Metrics: FCP, LCP, TBT, CLS
- When: build, testing
- Impact: medium, because reports contain URLs, screenshots, script names and request lists of the app
- Do: Do not use `upload.target: 'temporary-public-storage'` for proprietary apps. Use `target: 'filesystem'` with `outputDir` and keep the files as CI artifacts, or self-host an LHCI server with Basic auth.
- Why: Temporary public storage is run by Eris Ventures LLC, not Google. The disclaimer says uploaded data "is considered public information" and is kept from 3 days to 5 weeks. The LHCI server is also open by default: anyone with HTTP access can view data and create builds; only edit and delete need the admin token.
- Example:
  ```js
  upload: { target: 'filesystem', outputDir: './lhci-reports' }, // writes manifest.json + reports
  ```
- Avoid/caveats: Never put the LHCI admin token in CI. The build token can only add data. The GitHub App token lets its holder set status checks on the repo; store it as a secret (`LHCI_GITHUB_APP_TOKEN`). Screenshots in reports can show data from the page.
- Status: Current. Sources: LHCI services-disclaimer.md; server.md "Security".
- Sources: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/services-disclaimer.md ; https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/server.md#security

### Track history and commit diffs, and give LHCI the git context it needs
- Layer: tooling
- Stage: network
- Metrics: FCP, LCP, TBT, CLS, bundle-size
- When: build, testing
- Impact: medium, because a regression is cheap to fix only when you can see which commit caused it
- Do: Use an LHCI server (`target: 'lhci'`, SQLite/Postgres/MySQL) for time-series and report diffs, or read `manifest.json` from the `filesystem` target (`isRepresentativeRun` marks the median run). In GitHub Actions, check out enough history (`fetch-depth: 20`, and fetch the base ref) and use `ref: ${{ github.event.pull_request.head.sha }}` for PR status checks. Run `lhci autorun` once per build hash.
- Why: The server needs the ancestor commit to compare builds, and `actions/checkout` fetches 1 commit by default ("Ancestor hash not determinable"). The server accepts one upload per commit hash and rejects later ones. Use `ignoreDuplicateBuildFailure` for reruns, or push an empty commit. `urlReplacementPatterns` mask ports and UUIDs so URLs match between builds; setting them removes the defaults, so copy the defaults in.
- Example:
  ```yaml
  - uses: actions/checkout@v7
    with: { fetch-depth: 20 }
  - run: git fetch --depth=1 origin +refs/heads/${{ github.base_ref }}:refs/remotes/origin/${{ github.base_ref }}
  ```
- Avoid/caveats: In a CI matrix, run LHCI in only one leg. The server needs upkeep; the docs call it best for teams that manage their own infrastructure. The `deleteOldBuildsCron` option limits database growth.
- Status: Current in LHCI 0.15.x docs. The docs still show `actions/checkout@v3` / `setup-node@v3` / Node 16; current releases are checkout v7.0.1 and setup-node v7.0.0 (2026-07). Sources: LHCI getting-started.md, troubleshooting.md, configuration.md; GitHub releases API.
- Sources: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/getting-started.md ; https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/troubleshooting.md ; https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#upload

### Test authenticated pages with a login script or headers, and keep cold-load semantics
- Layer: tooling
- Stage: network, script-run
- Metrics: FCP, LCP, TBT
- When: testing
- Impact: medium, because a terminal behind login otherwise gets measured as its login page
- Do: Use `collect.puppeteerScript` to log in (it runs before each URL's runs, in a browser that stays open), or send a session cookie with `settings.extraHeaders`. Read credentials from environment variables, never from the repo.
- Why: Lighthouse clears storage before each run by default (`disableStorageReset: false`). Cookies from the login script survive, but tokens in `localStorage` need `disableStorageReset: true`.
- Example:
  ```js
  collect: {
    puppeteerScript: './ci/lhci-login.cjs',
    settings: { extraHeaders: JSON.stringify({ Cookie: `session=${process.env.LHCI_SESSION}` }) },
  },
  ```
- Avoid/caveats: `disableStorageReset: true` also keeps caches, so the run no longer measures a cold load. Keep it off unless auth needs it. The LHCI docs still mention Puppeteer v1/v2 compatibility, which is outdated; install a Puppeteer version that matches your Chrome. LHCI reserves `port`, `auditMode`, `gatherMode`, `output`, `outputPath`, `channel` and `cli-flags-path` in `settings`.
- Status: Current in LHCI 0.15.x. Source: LHCI configuration.md.
- Sources: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#puppeteerscript ; https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#page-behind-authentication

### Monitor public production URLs with the PSI runner to get the current Lighthouse
- Layer: tooling
- Stage: network
- Metrics: FCP, LCP, TBT, CLS
- When: long-lived session, testing
- Impact: low to medium: useful for public pages, but no help for pages behind auth
- Do: For public URLs, use `collect.method: 'psi'` with `psiApiKey` (and `psiStrategy: 'desktop'` if needed), or configure `server.psiCollectCron` to collect on a cron schedule into the LHCI server.
- Why: PSI runs the current Lighthouse (the changelog says each release reaches PSI within about 2 weeks), so it avoids the 12.6.1 version lag of the local runner.
- Avoid/caveats: Only works for sites reachable from the internet, and "no other collection options will be respected". Mixing PSI runs and local runs in one history changes the audit set and the hardware.
- Status: Documented in LHCI 0.15.x. Source: LHCI configuration.md `method`, `psiCollectCron`.
- Sources: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#method

### Update the article's CI recipe versions before you copy it
- Layer: tooling
- Stage: network
- Metrics: FCP, LCP, TBT, CLS
- When: build
- Impact: medium, because the 2020 recipe pins end-of-life Node and old action majors
- Do: Use a current Node LTS (22 or 24), current action majors, and `@lhci/cli@0.15.x`.
- Why: Node 18 reached end of life on 2025-04-30 and Node 20 on 2026-04-30. Node 22 (maintenance until 2027-04-30) and Node 24 (LTS until 2028-04-30) are supported. `@lhci/cli` 0.15.1 needs Node >=18.20 through Lighthouse 12.6.1.
- Example:
  ```yaml
  # Before (article, 2020)
  - uses: actions/checkout@v1
  - uses: actions/setup-node@v1
    with: { node-version: 10.x }
  - run: npm install -g @lhci/cli@0.3.x
  # After (2026-09)
  - uses: actions/checkout@v7
  - uses: actions/setup-node@v7
    with: { node-version: 24 }
  - run: npx -y @lhci/cli@0.15.x autorun
  ```
- Avoid/caveats: Check the release notes of each action major before you upgrade (I did not read them). The community action `treosh/lighthouse-ci-action` (12.6.2, 2026-03-12) also runs Lighthouse 12.6 through `@lhci/cli` ^0.15.1.
- Status: Versions checked 2026-09-23 against GitHub releases API, npm registry and nodejs/Release schedule.json.
- Sources: https://github.com/nodejs/Release/blob/main/schedule.json ; https://github.com/actions/checkout/releases ; https://github.com/actions/setup-node/releases ; https://github.com/treosh/lighthouse-ci-action

## Sources read

- https://web.dev/articles/lighthouse-ci (raw HTML saved as raw/fast-batch-6/lighthouse-ci.html, text as lighthouse-ci.txt; dateModified 2020-07-27)
- https://github.com/GoogleChrome/lighthouse-ci/blob/main/README.md
- https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/getting-started.md
- https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md
- https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/troubleshooting.md
- https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/server.md
- https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/services-disclaimer.md
- https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/recipes/docker-client/README.md
- https://github.com/GoogleChrome/lighthouse-ci/blob/main/packages/utils/src/assertions.js
- https://github.com/GoogleChrome/lighthouse-ci/blob/main/packages/utils/src/budgets-converter.js
- https://github.com/GoogleChrome/lighthouse-ci/blob/main/packages/utils/src/representative-runs.js
- https://github.com/GoogleChrome/lighthouse-ci/tree/main/packages/utils/src/presets (recommended.js, no-pwa.js)
- https://github.com/GoogleChrome/lighthouse-ci/blob/main/packages/cli/package.json
- GitHub API: lighthouse-ci commits and releases; actions/checkout, actions/setup-node, treosh/lighthouse-ci-action releases
- https://registry.npmjs.org/@lhci/cli , https://registry.npmjs.org/lighthouse (dist-tags, engines, dependencies)
- https://github.com/GoogleChrome/lighthouse/blob/main/changelog.md (13.5.0 → 10.0.0 sections)
- https://github.com/GoogleChrome/lighthouse/blob/main/core/config/default-config.js
- https://github.com/GoogleChrome/lighthouse/blob/main/core/config/constants.js
- https://github.com/GoogleChrome/lighthouse/blob/main/core/config/desktop-config.js
- https://github.com/GoogleChrome/lighthouse/blob/main/core/audits/user-timings.js
- https://github.com/GoogleChrome/lighthouse/blob/main/core/audits/resource-summary.js and core/computed/resource-summary.js
- https://github.com/GoogleChrome/lighthouse/blob/main/core/audits/baseline.js
- https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md
- https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md
- https://github.com/GoogleChrome/lighthouse/blob/main/docs/user-flows.md
- https://github.com/GoogleChrome/lighthouse/blob/main/core/user-flow.js
- https://developer.chrome.com/blog/lighthouse-13-0
- https://developer.chrome.com/blog/moving-lighthouse-to-insights
- https://chromestatus.com/feature/5166674414927872 (via chromestatus API JSON)
- https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md (GitHub mirror raw file)
- https://github.com/nodejs/Release/blob/main/schedule.json
- https://github.com/treosh/lighthouse-ci-action (README, package.json)
- https://developer.mozilla.org/en-US/docs/Web/API/Performance/mark

## Not covered / could not access

- The batch file lists only one article, so this batch has one article.
- I did not test the Lighthouse CI GitHub App or the temporary public storage service. I know they exist only from the docs and the disclaimer, not from use.
- I did not read the release notes of actions/checkout v5-v7 or setup-node v5-v7, so I do not know their breaking changes.
- I did not verify whether headless Chrome on GitHub-hosted runners has a hardware GPU, or which WebGL renderer it reports. The GPU item marks this as something to check per runner.
- "User timings under simulated throttling are unthrottled observations" is my inference from `user-timings.js` (it reads trace timestamps) and throttling.md (the simulation starts from an unthrottled load). No doc states it directly.
- The linked web.dev budget articles (performance-budgets-101, use-lighthouse-for-performance-budgets, incorporate-performance-budgets-into-your-build-tools) belong to other batches. I noted only that Lighthouse 12 removed `budgetPath` budgets.
- chromestatus's HTML page did not render through WebFetch; I used its JSON API (status "Deprecated", desktop milestone 139). I did not confirm the exact Chrome milestone in which WebGL context creation starts to fail by default.
