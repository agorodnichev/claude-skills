# Gap fill round 1: contradictions, stale facts and missing levers

Scope: the 20 gaps that the completeness critic found in the notes files 01-18. Part A resolves contradictions and stale facts between files, and names the files and lines to change. Part B adds items for levers that no file covered. Part C gives the "Status fixes" for survey rules and run2-only items.
Sources: BCD 8.1.2 (build 2026-09-17) and web-features in `raw/`; WebKit release notes (Safari 18.0, 26.0, 27.0); CSS Contain 2, HTML, DOM and WebSockets specs; the chrome-devtools-mcp source (commit 069ab27, npm 1.10.1), the devtools-frontend source and the V8 source; the scichart 5.2.69 npm package (d.ts and CommonJS files) and the SciChart v5 docs; web.dev, developer.chrome.com, MDN (live pages and mdn/content raw Markdown), svelte.dev and chromiumdash. Checked 2026-09-23.
Raw copies are in `raw/gapfill-round-1/`.

---

## A. Contradictions and stale facts (gaps 1-7)

### Enable navigation preload only for navigations that your fetch handler sends to the network
- Layer: js, network
- Stage: network
- Metrics: TTFB, FCP, LCP
- When: load
- Impact: medium. Service worker boot is about 50 ms on desktop and about 250 ms on mobile, and more than 500 ms in bad cases (web.dev). Only navigations that go to the network pay this cost.
- Do: Enable navigation preload in `activate` only when the fetch handler answers navigations network-first or network-only. This includes stream-composed pages whose body comes from the network. In the handler, always use `await event.preloadResponse` before you call `fetch()`. Leave preload off when the handler serves navigations cache-first. For routes that never need the handler, send them to the network with static routing (`addRoutes`) where it is supported, and keep navigation preload as the fallback for all other browsers.
- Why: Navigation preload starts the navigation request in parallel with worker boot. When the worker answers from the cache, the network response is not used, so preload only adds a request. web.dev says that boot time "isn't a problem if you're responding from the cache". Static routing does better for matched routes, because the browser does not start the worker at all.
- Example:
  ```js
  // sw.js: network-first navigations. Preload hides the worker boot time.
  self.addEventListener('activate', (e) => e.waitUntil(self.registration.navigationPreload?.enable()));
  self.addEventListener('fetch', (e) => {
    if (e.request.mode !== 'navigate') return;
    e.respondWith((async () => {
      try { return (await e.preloadResponse) ?? (await fetch(e.request)); }
      catch { return caches.match('/offline.html'); }
    })());
  });
  ```
- Avoid/caveats: If you enable preload and then call `fetch(event.request)`, every navigation is requested twice (web.dev). The request carries `Service-Worker-Navigation-Preload: true`. Change the value with `setHeaderValue()`, and add `Vary: Service-Worker-Navigation-Preload` if the server sends a partial response. Static routing throws a `TypeError` for `source: "fetch-event"` when there is no fetch handler. Firefox has no static routing.
- Resolution: 17-collections-batch-03.md:235 is wrong: its title says "whenever a service worker has a fetch handler" and it rates the impact high. Its own caveat about cache-first navigations shows the limit. 07-js-web-apis.md:220, 17-collections-batch-01.md:72 and 04-html-and-http-loading-features.md:691 are correct (network navigations only, medium impact). 04's order is also correct: first static routing, then navigation preload for routes that still need the handler. The Workbox "precaching dos and don'ts" page uses the same pattern, NetworkOnly navigations with navigation preload. Rename the batch-03 item to this title and change its impact to medium.
- Status: `NavigationPreloadManager` and `FetchEvent.preloadResponse`: Chrome 59, Firefox 99, Safari 15.4 (BCD), so all engines. `InstallEvent.addRoutes`: Chrome 123, Safari 27, no Firefox (BCD; web-features `service-workers-static-routes`: not Baseline).
- Sources: https://web.dev/blog/navigation-preload, https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes, https://developer.chrome.com/blog/service-worker-static-routing, https://developer.chrome.com/docs/workbox/precaching-dos-and-donts

### Do not expect speed from `contain: style`; it scopes only counters and quotes
- Layer: css
- Stage: style, layout
- Metrics: FPS/smoothness, INP
- When: interaction, animation/render-loop
- Impact: low. Style containment has no effect on style-recalc or layout scope. The speed of `contain: content`/`strict` comes from layout, paint and size containment.
- Do: Keep `contain: content` or `contain: strict` (with an explicit size) on independent widgets. Do not add `style` for performance. Do not remove `contain` for older Safari because of `style`.
- Why: CSS Contain 2 §3.4 defines two effects of style containment only. `counter-increment`/`counter-set` are scoped to the subtree, and `open-quote`/`close-quote` depth is scoped to the subtree. Neither effect changes how much style or layout work the browser does.
- Avoid/caveats: None for performance. If you use CSS counters or quotes across widget boundaries, test Safari 15.4 to 26.x for quote scoping.
- Resolution: 05-css-rendering.md:963 (open: "BCD says Safari 27, webstatus says 2022") and 01-critical-rendering-path.md:678. BCD has two Safari entries for `css.properties.contain.style`. The first is Safari 15.4 to 26.6 with the note "Style containment does not affect quotes" (webkit.org/b/232083). The second is full support in Safari 27. The WebKit Safari 27.0 notes confirm the scope: Safari 27 adds `contain: style` "applying to CSS quotes". web-features (`contain-style`: Safari 15.4, Baseline widely available 2025-01-26) is therefore also correct. The critic's reading (no style containment in Safari before 27) is wrong. Counter scoping works from Safari 15.4, and only quote scoping arrived in 27. 01:678 needs no warning. Change 05:298 and 05:963 to: "Safari 15.4-26: `style` scopes counters but not quotes; Safari 27: full."
- Status: `contain` Baseline widely available 2024-09 (web-features). `contain: style`: Chrome 52, Firefox 103, Safari 15.4 (no quote scoping) and Safari 27 (full) (BCD 8.1.2).
- Sources: https://drafts.csswg.org/css-contain-2/#containment-style, https://webkit.org/blog/18325/webkit-features-for-safari-27-0/, raw/bcd.json `css.properties.contain.style`, raw/web-features.json `contain-style`

### Pause off-screen chart panes with `contentvisibilityautostatechange`, gate it with `CSS.supports`, and keep an IntersectionObserver fallback
- Layer: js, css
- Stage: main-thread-task, paint, gpu-draw
- Metrics: FPS/smoothness, INP, memory
- When: long-lived session, animation/render-loop
- Impact: medium. In a multi-pane terminal, panes that are scrolled away still render every tick unless something pauses them.
- Do: Put `content-visibility: auto` plus `contain-intrinsic-size: auto <h>px` on each pane container. Pause and resume the pane's render loop from `contentvisibilityautostatechange`, using `event.skipped`. Register the listener with `addEventListener`, not the `on…` property. Choose the path with `CSS.supports('content-visibility', 'auto')`. When it is false (Safari 17 and older), use an IntersectionObserver with a `rootMargin`. For SciChart surfaces, use the built-in `freezeWhenOutOfView: true` (13-scichart.md:315) instead of this code. Do not use both on the same chart.
- Why: The event tells you when the browser itself starts or stops skipping the subtree. It also fires once when the element is inserted, with `skipped` set for the start position (WPT `content-visibility-auto-state-changed-first-observation`), so you do not need a separate first check. SciChart's `freezeWhenOutOfView` uses an IntersectionObserver (threshold 0.01) and calls the surface's suspend lock (`Charting/Visuals/SciChartSurfaceBase.js`, `Core/ObserveVisibility.js` in 5.2.69).
- Example:
  ```js
  function watchPane(pane, chart) {
    if (CSS.supports('content-visibility', 'auto')) {
      pane.addEventListener('contentvisibilityautostatechange', (e) =>
        e.skipped ? chart.pause() : chart.resume());
      return () => {};
    }
    const io = new IntersectionObserver(([en]) =>
      en.isIntersecting ? chart.resume() : chart.pause(), { rootMargin: '50% 0px' });
    io.observe(pane);
    return () => io.disconnect();
  }
  ```
- Avoid/caveats: Firefox 124-129 fires the event but has no `oncontentvisibilityautostatechange` property (BCD partial note). Chrome 85-107 supports `auto` but not the event, which does not matter for current browsers. Skipped content still counts for accessibility, so do not remove semantic DOM updates. Without `contain-intrinsic-size`, the pane collapses while it is skipped.
- Resolution: 06-js-event-loop-and-scheduling.md:762 (event from Safari 18) is correct. 05-css-rendering.md:315 ("`auto` arrived in Safari 26 … not in Safari 18 to 25") and 01-critical-rendering-path.md:649 ("`auto` since Safari 26") are misleading. BCD `css.properties.content-visibility.auto` has two Safari entries: 18-18.6 partial (note: skipped content is not findable with find-in-page) and 26 full. The WebKit Safari 18.0 notes say that Safari 18 "adds support for `content-visibility`", and the Safari 26 notes list "Fixed content skipped with `content-visibility: auto` to be findable". Safari 19-25 do not exist (Safari went from 18 to 26). So `auto` skips rendering in Safari 18, and the critic's claim that the event exists but "auto never skips" is wrong. Change 05:315 and 01:649 to: "`auto` from Safari 18 (find-in-page for skipped content fixed in Safari 26)".
- Status: `content-visibility`: Chrome 85, Firefox 125, Safari 18. `auto` is full from Safari 26 and partial in 18.x. `contentvisibilityautostatechange`: Chrome 108, Firefox 130 (event from 124, handler property from 130), Safari 18 (BCD 8.1.2). web-features `content-visibility`: Baseline newly available 2025-09-15. IntersectionObserver: Baseline widely available (2019).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Element/contentvisibilityautostatechange_event, https://drafts.csswg.org/css-contain-2/#content-visibility-auto-state-changed, https://github.com/web-platform-tests/wpt/blob/master/css/css-contain/content-visibility/content-visibility-auto-state-changed-first-observation.html, https://webkit.org/blog/15865/webkit-features-in-safari-18-0/, https://webkit.org/blog/17333/webkit-features-in-safari-26-0/, raw/bcd.json

### Treat Wasm timings taken through Chrome DevTools MCP as debug-tier numbers
- Layer: tooling
- Stage: script-run, gpu-draw
- Metrics: FPS/smoothness, INP, TBT
- When: testing
- Impact: high for SciChart. SciChart's resampling, autorange and vertex generation run in Wasm. Under MCP, the Wasm code probably runs as Liftoff debug code, so frame times are pessimistic and A/B deltas between Wasm work and JS work are distorted.
- Do: Do not report absolute SciChart frame, draw or append times from an MCP-attached page as production numbers. Get those numbers from a run with no debugger attached: a plain Chrome window with in-page `performance.measure` and rAF deltas sent to a log or endpoint, or the DevTools Performance panel (which removes the tier-down while it records). Use MCP traces for structure: which phases, which insights, LoAF attribution, and before/after comparisons under the same conditions. Mark MCP-derived Wasm numbers as "debug tier" in reports.
- Why: Source reading, chrome-devtools-mcp 1.10.1: `McpPage.init()` always creates a DevTools "target universe" for each page (`src/McpPage.ts` `#initDevToolsUniverseNoThrow`). That universe auto-starts `DebuggerModel` (`src/devtools/DevtoolsUtils.ts`: `overrideAutoStartModels: new Set([DevTools.DebuggerModel])`). The `DebuggerModel` constructor calls `Debugger.enable` (devtools-frontend `DebuggerModel.ts` `enableDebugger()`). In V8, `V8Debugger::enable()` calls `EnterDebuggingForIsolate`, and `WasmEngine::EnterDebuggingForIsolate` sets each module to `kDebugging` and removes its non-debug (TurboFan/Turboshaft) code (`src/inspector/v8-debugger.cc`, `src/wasm/wasm-engine.cc`). The V8 docs describe this as tier-down to Liftoff while debugging. The DevTools Performance panel avoids it: `TimelineController.startRecordingWithCategories()` calls `suspendAllTargets()`, which runs `Debugger.disable`, and V8 then tiers up again. MCP's `performance_start_trace` only calls Puppeteer `tracing.start()` and does not suspend its universe (`src/tools/performance.ts`). `enableDebugger()` also sets `Debugger.setAsyncCallStackDepth(32)`, which adds async stack capture cost to promise-heavy JS.
- Example:
  ```js
  // In-page A/B timing with no debugger attached (send results to a log endpoint).
  const nextFrame = () => new Promise(requestAnimationFrame);
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) { series.appendRange(xs[i], ys[i]); await nextFrame(); }
  navigator.sendBeacon('/perf-log', JSON.stringify({ msPerFrame: (performance.now() - t0) / 200 }));
  ```
- Avoid/caveats: This is an inference from source code. I did not measure the size of the effect. `--no-source-maps` does not stop the `DebuggerModel` auto-start. I found no flag that turns the universe off. Connecting MCP to a Chrome that is already running (`--browserUrl`/`--autoConnect`) still creates the universe when the page is attached. Worker isolates are separate, so Wasm in a worker is only affected if that worker target is also debugged.
- Resolution: 09-v8-consolidated.md:2170 ("never benchmark Wasm with DevTools open") and 14-devtools-mcp-and-webmcp.md (chart-frame playbook built on MCP sessions) are both correct in their own scope. 14 is missing this caveat: MCP keeps the Debugger domain on, which matches the DevTools-open case in 09. Add this item to 14 and link it from 13-scichart.md.
- Status: Verified in source for chrome-devtools-mcp 1.10.1 (commit 069ab27, 2026-09-23), devtools-frontend main, and V8 HEAD. Effect size not measured.
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp (src/McpPage.ts, src/devtools/DevtoolsUtils.ts, src/tools/performance.ts), https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/core/sdk/DebuggerModel.ts, https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/panels/timeline/TimelineController.ts, https://chromium.googlesource.com/v8/v8/+/HEAD/src/inspector/v8-debugger.cc, https://chromium.googlesource.com/v8/v8/+/HEAD/src/wasm/wasm-engine.cc, https://v8.dev/docs/wasm-compilation-pipeline, https://chromium.googlesource.com/v8/v8/+/HEAD/docs/wasm/architecture.md, https://chromedevtools.github.io/devtools-protocol/tot/Debugger/

### Treat `unload` as gone in Chrome 154+ and still a bfcache blocker in Firefox
- Layer: js
- Stage: main-thread-task
- Metrics: LCP, FCP (back/forward navigations), INP
- When: long-lived session
- Impact: medium. Chrome no longer runs `unload` by default, so logic that depends on it breaks silently, and Firefox still refuses bfcache for such pages.
- Do: Never add `unload`. Save state and flush telemetry on `visibilitychange` (hidden) and `pagehide`. Close sockets on `pagehide` and reconnect on `pageshow` when `event.persisted` is true. Do not opt back in with `Permissions-Policy: unload=(self)`, because an opted-in page fires `unload` again and loses bfcache in Chrome.
- Why: Chrome's rollout table reaches 100% of page loads at M154 (2026-09-22). From then, `unload` handlers do not fire unless the page opts in with Permissions Policy or an enterprise sets `ForcePermissionPolicyUnloadDefaultEnabled`. Chrome's page says that disabling unload lets a site "immediately benefit from the bfcache". Chrome 154 reached stable on 2026-09-22 and Chrome 155 follows on 2026-10-06 (chromiumdash). web.dev's bfcache page (updated 2026-07-02) still says that Chrome and Firefox make pages with `unload` ineligible. That is still true for Firefox and for Chrome pages that opt back in.
- Avoid/caveats: Chrome says the milestones are "subject to change". `beforeunload` is not deprecated, but add it only while there is unsaved work (07:372). The `Permissions-Policy` `unload` feature is Chromium only.
- Resolution: stale lines to update: 07-js-web-apis.md:4 ("Chrome 153 era") becomes "Chrome 154 stable (2026-09-22); 155 on 2026-10-06". 07:373 and 07:920 ("100% planned M154") become "100% at M154 (2026-09-22)". 01-critical-rendering-path.md:148 (bfcache item at :141) becomes "Firefox (and Chrome pages that opt back in with Permissions-Policy) make pages with `unload` ineligible; Chrome 154+ does not run `unload` by default". 06 tested Chromium 152, and its `unload`-related observations predate the 100% step. verify/02 and verify/04 already flag 02 and 04.
- Status: `pagehide`/`pageshow`/`visibilitychange` Baseline widely available. `unload` deprecated in Chrome at 100% of page loads from M154. `http.headers.Permissions-Policy.unload`: Chrome 115 only (BCD).
- Sources: https://developer.chrome.com/docs/web-platform/deprecating-unload, https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=154, https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=155, https://web.dev/articles/bfcache

### Carry verify/01 corrections into the final 01 by content, not by title
- Layer: tooling
- Stage: html-parse, composite
- Metrics: INP, FCP
- When: build
- Impact: medium. Three verified corrections are still missing from the final 01, and a merge that matches titles will skip them.
- Do: When you merge verify results, match items by claim text or by source URL, not by title. Apply the fixes below to `01-critical-rendering-path.md` (the final 01 is the same file as `.run2.md`).
- Why: The final 01 renamed items after verification ran on run1. For example, "Include a mobile viewport meta tag…" became "Ship a mobile viewport meta tag…", and "Preload late-discovered critical resources…" became "Preload only late-discovered…".
- Avoid/caveats: Four verified run1 items have no clear counterpart in the final 01, so their content may have been merged or dropped: "Keep inline scripts tiny; ship large code as external files", "Split the startup bundle so the critical path carries only first-view code", "Do not rely on requestIdleCallback alone", and "Expose read-only render diagnostics as dev-only tools for agents". Check them by hand.
- Resolution (still stale in final 01, checked with grep 2026-09-23):

  | Final line | Final title | Stale text | Replacement (source) |
  |---|---|---|---|
  | 43 | (a) phase map, row 12 | Paint holding "on same-origin navigations" | Chrome keeps the old page until FCP or a 500 ms timeout. This started for same-origin navigations in Chrome 76 and was extended to most cross-origin navigations in 2021 (verify/01; WPT PR 27670) |
  | 197 | Ship a mobile viewport meta tag in the initial HTML | MDN "generally 960px" | about 980 px virtual viewport (MDN viewport meta page; verify/01) |
  | 885 | Use passive listeners and attach non-passive wheel/touch handlers only to the chart surface | "Browsers other than Safari default `passive: true` for wheel/touchstart/touchmove" | All engines default `touchstart`/`touchmove` on window/document/body to passive. Chrome 73+ and Firefox 84+ also default `wheel` to passive there, and Safari does not (BCD; 06:649 is correct) |
  | 148 | Keep pages eligible for the back/forward cache | "On desktop, Chrome and Firefox make pages with `unload` listeners ineligible" | See the `unload` item above (Chrome 154+) |
  | 571 | Make critical fonts discoverable early and keep text visible | no note that `ascent-override` has no effect in Safari | Add: "`ascent-override`/`descent-override` do not work in shipping Safari; `size-adjust` works in all engines" (verify/01; BCD `css.at-rules.font-face.ascent-override`) |
  | 1054 | Let the agent verify CRP changes with Chrome DevTools MCP traces | Do line has no `pageId`; tool defaults not stated | `pageId` is required on page tools (get it from `list_pages`); `reload` and `autoStop` default to true (docs/tool-reference.md, 1.10.1) |

  These corrections are already applied in the final 01: Early Hints HTTP/2+ wording (L106), speculation rules status (L158), tight mode (L388), paint area (L761), and insight titles (L1002).
- Status: Verified by grep against the final 01 on 2026-09-23.
- Sources: verify/01-critical-rendering-path.verify.md, 01-critical-rendering-path.md, 01-critical-rendering-path.run2-new.md

### Apply GPU decimation rules to custom renderers only; for SciChart, rely on its resampler and pre-aggregate only the series it does not resample
- Layer: gpu, network
- Stage: script-run, gpu-upload, gpu-draw
- Metrics: FPS/smoothness, memory, bundle-size
- When: animation/render-loop, load
- Impact: high. Decimating before SciChart repeats work that its Wasm resampler already does on every draw. Some series types, however, get no resampling at all.
- Do: For your own WebGL/WebGPU/Canvas renderers, follow 10-gpu-webgl.md:676 and 11-gpu-webgpu.md:663 (reduce to about pixel density, in compute shaders where possible). For SciChart line, mountain, column, OHLC, candlestick and scatter series with X-sorted data, do not decimate in JS. Keep `resamplingMode` Auto and set `dataIsSortedInX`/`containsNaN` so the resampler stays on its fast path. Pre-aggregate on the server or in a worker only for series that SciChart does not resample: X-unsorted data (unless the X axis is a category axis), stacked series, bubble, error bars, box plot, line segment, and uniform/non-uniform heatmaps and contours.
- Why: `BaseRenderableSeries.supportsResampling` in scichart 5.2.69 returns false for these series types: UniformContours, UniformHeatmap, PolarUniformHeatmap, NonUniformHeatmap, Bubble, ErrorBars, BoxPlot and LineSegment. It also returns false for stacked series, for `resamplingMode: None` without FIFO, and for data whose X values are not sorted ascending on a non-category axis. For those cases, every point reaches the GPU.
- Example:
  ```ts
  // OK: sorted time series, SciChart resamples per draw.
  new XyDataSeries(wasm, { dataIsSortedInX: true, containsNaN: false, fifoCapacity: 200_000 });
  // Pre-aggregate: 2M unsorted trade prints for a scatter → server bins to a density grid or 1 point per pixel column.
  ```
- Avoid/caveats: The rule in 13-scichart.md:214 was marked as an inference. It is now backed by source for the series list, but the claim that JS pre-decimation is slower is still not measured. Server aggregation of long history (1m/1h/1d bars) is still correct for network and memory reasons for all series.
- Resolution: 10:676, 11:663 and 13:214 do not conflict once the scope is stated. The GPU rules apply to custom renderers and to SciChart series that are not resampled. 13:214 applies to resampled SciChart series.
- Status: scichart 5.2.69 (npm latest, checked 2026-09-23). Source: `Charting/Visuals/RenderableSeries/BaseRenderableSeries.js` (`supportsResampling`, `enableDrawingOptimisations`).
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/resampling/, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/RenderableSeries/BaseRenderableSeries.js

---

## B. Missing levers (gaps 8-20)

### Put one inline import map before the first module script and every modulepreload
- Layer: html
- Stage: html-parse, preload-scan, script-compile
- Metrics: FCP, LCP, startup
- When: load
- Impact: medium. A late map cannot remap specifiers that are already resolved, so imports fail or load the wrong URL. An external map is not possible.
- Do: Emit `<script type="importmap">` inline in `<head>`, before any `<script type="module">`, `<link rel="modulepreload">` or `import()`. Keep one map per page. Only add a second map for code that loads later, and give it only new specifiers.
- Why: The HTML spec merges each later map into the global map, but it drops rules that conflict with existing rules or that would change modules already resolved. `src` is not allowed on an import map, so the map is always parser-inline. Import maps do not apply to `<script src>` or `<link rel=modulepreload href>` URLs themselves. They apply to the static and dynamic imports inside those modules.
- Example:
  ```html
  <script type="importmap">
  { "imports": { "chart-core": "/assets/chart-core.4f1c2a.js", "svelte/": "/assets/svelte/" },
    "integrity": { "/assets/chart-core.4f1c2a.js": "sha384-…" } }
  </script>
  <link rel="modulepreload" href="/assets/chart-core.4f1c2a.js">
  <script type="module" src="/assets/app.9b0e11.js"></script>
  ```
- Avoid/caveats: The map is inline JSON that blocks nothing, but it adds HTML bytes. Keep it small (only chunks with hashed names). Browsers that allow only one map ignore a second map; Firefox supports multiple maps only behind a flag (from 150). For CSP, an inline import map needs a nonce or hash.
- Status: Import maps Baseline widely available (low 2023-03-27; Chrome 89, Firefox 108, Safari 16.4). Multiple import maps: Chrome 133, Safari 18.4, Firefox 150 behind a flag (BCD; not Baseline). `integrity` key: Chrome 127, Firefox 138, Safari 18 (BCD). `modulepreload`: Chrome 66, Firefox 115, Safari 17. `HTMLScriptElement.supports('importmap')` for detection: Chrome 96, Firefox 94, Safari 16.
- Sources: https://html.spec.whatwg.org/multipage/webappapis.html#import-maps, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap, raw/bcd.json

### Use an import map of hashed chunk URLs to stop cascading cache invalidation and keep V8 code caches warm
- Layer: build, html
- Stage: network, script-compile
- Metrics: startup, TBT, bundle-size
- When: build, load
- Impact: medium for apps that deploy often. A change to one leaf chunk no longer changes the URLs of all its importers, so their HTTP and code caches survive.
- Do: Import stable names (`import 'chart-core'`) in the source code and map them to content-hashed URLs in a generated import map. With Rolldown, turn on `experimental.chunkImportMap` and inline the emitted `importmap.json` into the HTML. Keep stable library chunks separate from chunks that change often.
- Why: When a module's hashed URL is written inside its importer, a dependency change changes the importer's bytes and hash, and so on up the chain. V8 keys its code cache by script URL. A new URL starts a cold cache entry, and a changed file loses its cached code (v8.dev). The map moves all hashes into one place, so unchanged chunks keep their URLs and their code caches. Rolldown's docs describe the option as preventing "cascading cache invalidation caused by content hashes".
- Example:
  ```js
  // rolldown.config.js
  export default { input: 'src/main.ts', output: { dir: 'dist', entryFileNames: '[name].[hash].js' },
    experimental: { chunkImportMap: { fileName: 'importmap.json', baseUrl: '/assets/' } } };
  ```
- Avoid/caveats: The HTML now holds the map, so the HTML must not be cached for long. Unbundled deploys pay one request per module. v8.dev still recommends bundling for large graphs ("less than 100 modules" for unbundled). The link between import maps and code cache survival combines two primary sources and has not been measured.
- Status: Import maps Baseline widely available (see above). `experimental.chunkImportMap` is experimental in Rolldown.
- Sources: https://rolldown.rs/reference/Interface.RolldownOptions, https://v8.dev/blog/code-caching-for-devs, https://v8.dev/features/modules

### Add an `integrity` map for module chunks instead of per-tag attributes
- Layer: html
- Stage: network
- Metrics: startup
- When: load
- Impact: low. This is a security control, not a speed gain. It lets you keep SRI when chunks are loaded through `import`, which has no attribute to hold a hash.
- Do: Put `sha384-…` hashes for dynamically imported and statically imported chunks in the map's `integrity` object, and generate them at build time.
- Why: The spec applies integrity metadata from the map to module fetches that have no integrity of their own, including modules that are not listed in `imports`.
- Avoid/caveats: A wrong hash blocks the module and breaks the app. Regenerate the hashes on every build.
- Status: Chrome 127, Firefox 138, Safari 18 (BCD `html.elements.script.type.importmap.integrity`).
- Sources: https://html.spec.whatwg.org/multipage/webappapis.html#import-maps, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap

### Choose rendering by page type: server HTML for public pages, a client-rendered app shell for the logged-in terminal
- Layer: build, html, js
- Stage: html-parse, script-run, main-thread-task
- Metrics: FCP, LCP, INP, TBT
- When: load
- Impact: high. The choice sets how much JS must run before the first useful paint and before the first responsive input.
- Do: Render marketing, docs and SEO pages as static or streamed server HTML with little JS. For the authenticated trading terminal, a client-rendered shell is acceptable when you pair it with a precached shell (service worker), aggressive code splitting per panel, and preload of the critical data request. In SvelteKit, set `ssr = false` only on the terminal route group, not in the root layout.
- Why: web.dev: CSR can come close to SSR performance with a tight JS budget, and its main risk is JS growth that hurts INP. SSR with full rehydration "can have a significant negative impact" on TBT and INP. HTML from the server is parsed in chunks with automatic yields. HTML built on the client comes in one long task, and the preload scanner cannot see its resources. A terminal's first view depends on per-user, live data that the server cannot cache, so SSR gains little there.
- Example:
  ```js
  // src/routes/(terminal)/+layout.js: SPA mode only for the terminal routes
  export const ssr = false;
  ```
- Avoid/caveats: SvelteKit says that `ssr = false` is "not recommended" in most cases, because it gives an empty shell. Keep it scoped to the terminal. Show a skeleton that matches the final layout to avoid CLS.
- Status: Guidance (web.dev "Rendering on the web", updated 2026-01-05). SvelteKit page options are current.
- Sources: https://web.dev/articles/rendering-on-the-web, https://web.dev/articles/client-side-rendering-of-html-and-interactivity, https://svelte.dev/docs/kit/page-options

### When you do SSR, budget hydration: avoid double-serialized state, and hydrate islands progressively
- Layer: build, js
- Stage: html-parse, script-run, main-thread-task
- Metrics: INP, TBT, LCP, bundle-size
- When: load
- Impact: high on mid-range mobile. The page looks ready but ignores input until hydration ends.
- Do: Send each piece of state once. Do not inline a large JSON blob that repeats data already present in the HTML. Hydrate only interactive parts: split low-priority widgets and hydrate them on idle or when visible. Stream the HTML (`renderToPipeableStream`-style streaming, or SvelteKit streaming of promises) so the parser yields between chunks.
- Why: web.dev calls rehydration "one app for the price of two". The server sends the UI as HTML, the source data again as script tags, and the full UI code, and nothing responds until that code runs. Progressive rehydration boots parts over time. Partial rehydration makes static parts inert. A common failure is a server DOM that is destroyed and rebuilt on the client because the data was not ready (an unresolved promise).
- Avoid/caveats: Partial hydration is hard to implement and complicates caching (web.dev). Measure INP in the first seconds after load, not only LCP.
- Status: Guidance. Framework support varies.
- Sources: https://web.dev/articles/rendering-on-the-web

### Update live numbers by writing to a persistent Text node, not `innerHTML`
- Layer: js
- Stage: main-thread-task, style, layout
- Metrics: INP, FPS/smoothness, memory
- When: long-lived session, animation/render-loop
- Impact: high for tickers, order books and watchlists at 10-100 updates per second.
- Do: Create each cell's Text node once. On each coalesced frame, write `textNode.data = formatted` only when the string changed. Never set `innerHTML` for values. Avoid `element.textContent =` in hot loops, because it replaces the child node every time.
- Why: The DOM spec says that `Element.textContent` runs "string replace all": it creates a new Text node and replaces all children. On a `CharacterData` node, the same setter runs "replace data" in place. `innerHTML` also runs the HTML parser, which MDN calls "slower" and an XSS risk. A new node on every tick adds garbage and mutation work.
- Example:
  ```js
  // setup
  const t = document.createTextNode(''); priceCell.append(t);
  // per frame (after coalescing ticks)
  const s = fmt.format(last.price);
  if (s !== t.data) t.data = s;
  ```
- Avoid/caveats: Reading `innerText` forces layout (MDN). Do not read geometry in the same frame. The same pattern applies to Svelte: `{price}` in a template already updates one Text node, so do not wrap values in `{@html}`.
- Status: DOM standard, all engines.
- Sources: https://dom.spec.whatwg.org/#dom-node-textcontent, https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent

### Give live numeric cells a fixed width and `font-variant-numeric: tabular-nums`
- Layer: css
- Stage: layout, paint
- Metrics: CLS, FPS/smoothness
- When: long-lived session
- Impact: medium. With proportional digits, each tick changes text width, neighbors move, and data-driven shifts count toward CLS because no input came before them.
- Do: Use `font-variant-numeric: tabular-nums` on price, size and P&L cells. Give the cells a fixed `inline-size` (`ch` units work well), right-align them, and put `contain: layout paint` on the cell or the row.
- Why: `tabular-nums` selects same-width figures (OpenType `tnum`), so a digit change does not change the text width. With fixed widths, a text change cannot resize the cell, and containment keeps the relayout inside it. Layout shifts are excluded only within 500 ms of a discrete input (web.dev CLS), so shifts caused by streaming data are always counted.
- Example:
  ```css
  .num { font-variant-numeric: tabular-nums; text-align: end; inline-size: 11ch; contain: layout paint; }
  ```
- Avoid/caveats: The font must have a `tnum` feature, or the property does nothing (MDN). Check the web font you use. Fixed widths clip long values, so size them for the worst case (for example, negative values with thousands separators).
- Status: `font-variant-numeric` Baseline widely available (since 2020; Chrome 52, Firefox 34, Safari 9.1).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric, https://web.dev/articles/cls, https://developer.mozilla.org/en-US/docs/Web/CSS/contain

### Use `table-layout: fixed` with an explicit width for large or live tables
- Layer: css
- Stage: layout
- Metrics: INP, FPS/smoothness, LCP
- When: load, long-lived session
- Impact: medium for order books, blotters and screeners with many rows.
- Do: Set `table-layout: fixed` and `width` on the table, and set column widths on `<col>` or on first-row cells. Use `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on cells.
- Why: MDN: the fixed algorithm is "faster" because horizontal layout depends only on the table width, column widths and borders, not on cell contents. The table can render once the first row is analyzed. With `auto`, every content change can resize columns across all rows.
- Example:
  ```css
  table.book { table-layout: fixed; inline-size: 100%; }
  table.book col.price { inline-size: 11ch; } table.book td { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  ```
- Avoid/caveats: Without an explicit table width, `fixed` has no effect. Content that is too wide is clipped. For thousands of rows, virtualize (see 01's DOM size items). A fixed table alone does not stop the row count cost.
- Status: `table-layout` Baseline widely available (since 2015).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/table-layout, https://www.w3.org/TR/CSS22/tables.html#fixed-table-layout

### Update rows in place with stable keys; never rebuild a live list per tick
- Layer: js
- Stage: main-thread-task, style, layout, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: long-lived session
- Impact: high. Recreating rows destroys focus, selection and layout caches, and creates garbage every tick.
- Do: Key rows by a stable primitive id (`{#each rows as r (r.id)}` in Svelte). Mutate only the changed cells. For price-flash effects, animate `opacity` of a cell overlay (pseudo-element), not the `background-color` of the whole row.
- Why: Svelte keyed each blocks insert, move and delete items instead of patching positions. The Svelte docs recommend strings or numbers as keys so identity survives object replacement. `opacity` changes are handled in composition, while `background-color` needs a repaint (MDN animation guide).
- Example:
  ```svelte
  {#each book.bids as lvl (lvl.price)}<tr><td class="num">{lvl.priceStr}</td><td class="num">{lvl.sizeStr}</td></tr>{/each}
  ```
- Avoid/caveats: Keys must be stable across updates. Index keys give the non-keyed behavior. Coalesce socket messages per frame first (07:482).
- Status: Svelte 5 current docs.
- Sources: https://svelte.dev/docs/svelte/each, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate

### Keep SVG charts and overlays small: few elements, one path per series, no per-point nodes
- Layer: html, canvas2d
- Stage: style, layout, paint
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop, interaction
- Impact: high. Every SVG element is a DOM node that pays style, layout and paint costs. Per-point `<circle>` elements do not scale to trading data sizes.
- Do: Draw each series as one `<path>`, and decimate to about one vertex per pixel column before you build `d`. Draw markers only for hovered or last points. Move dense series to Canvas/WebGL (or SciChart), and keep SVG for axes, a few annotations and static icons.
- Why: SVG geometry is retained DOM. Changing `d` means path parsing, style, layout and repaint on the main thread. The bklit chart-performance skill (a GitHub skill, not a primary source) found that continuous `d` morphing and hover in the same state as geometry made charts slow, and it fixed them with static paths after the enter animation and transform-only hover.
- Avoid/caveats: SVG is fine for a few hundred elements. Above that, measure. Use `vector-effect: non-scaling-stroke` when you scale a `<g>` for zoom, so line widths stay constant.
- Status: Guidance. `vector-effect` (CSS property): Chrome 6, Firefox 15, Safari 5.1 (BCD). Only `non-scaling-stroke` is implemented; the other values have "no implementations" (MDN).
- Sources: https://github.com/bklit/bklit-ui/blob/main/.agents/skills/bklit-studio-chart-performance/SKILL.md, https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/vector-effect

### Freeze SVG geometry after the enter animation; move hover and pan with `transform` on a group, and keep hover state apart from data state
- Layer: js, css
- Stage: style, layout, paint, composite
- Metrics: FPS/smoothness, INP
- When: interaction, animation/render-loop
- Impact: medium. Hover that recomputes paths replays expensive geometry on every pointer move.
- Do: Store hover (hovered index, tooltip position) in its own small state. Components that draw geometry must not read that state. Pan or zoom by setting `transform` on a wrapping `<g>`, and rebuild `d` only when the data or the visible window changes enough (for example, after the gesture ends). For continuous spins or slides of a whole icon or chart, animate an HTML wrapper element, not an element inside the SVG.
- Why: Chrome says SVG animations have been hardware-accelerated since Chromium 89 for `transform`, `opacity` and `filter`. A 2026 report on Electron (Chromium), measured with DevTools traces, still saw style recalc every frame when the rotation was inside the SVG. Moving the rotation to the HTML wrapper dropped recalcs to idle and paints to 11-12 per second (facebook/astryx issue, not primary). An HTML wrapper is the case that composites reliably.
- Example:
  ```js
  // pan without rebuilding paths
  g.setAttribute('transform', `translate(${dx} 0) scale(${k} 1)`); // plus vector-effect: non-scaling-stroke on paths
  ```
- Avoid/caveats: The two sources conflict on when SVG transforms are composited. Check with the DevTools Animations track ("Compositing failed" reasons) on your target Chrome. A scaled `<g>` blurs text, so keep labels outside the scaled group.
- Status: Chromium 89+ accelerates SVG animations of transform, opacity and filter (Chrome blog, 2021). Behavior inside SVG is not verified for current Chrome.
- Sources: https://developer.chrome.com/blog/hardware-accelerated-animations, https://github.com/facebook/astryx/issues/6473, https://github.com/bklit/bklit-ui/blob/main/.agents/skills/bklit-studio-chart-performance/SKILL.md

### Do not animate SVG filters, blur or drop-shadow on live content; use `shape-rendering: crispEdges` for axis-aligned grids
- Layer: css
- Stage: paint, raster, composite
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium. Filter animations that "may move pixels" fall back to the main thread and repaint every frame.
- Do: Keep `filter: url(#…)`, `blur()` and `drop-shadow()` off elements that change each frame. Apply them to static layers, or prerender the effect into a bitmap. Set `shape-rendering: crispEdges` on gridlines and axis ticks (horizontal and vertical lines), and keep the default `auto` (or `geometricPrecision`) for data curves.
- Why: Chrome's compositor failure reasons include "Filter related property may move pixels", which covers blur, drop-shadow and SVG `url()` reference filters (web.dev issue 3790). MDN: `crispEdges` may turn off anti-aliasing for near-vertical and near-horizontal lines and snap them to device pixels, so 1 px grids look sharp. `optimizeSpeed` may turn off anti-aliasing for all shapes.
- Avoid/caveats: `crispEdges` on curves makes them jagged. Test at DPR 1 and DPR 2. There is no primary source for a speed gain from `shape-rendering`. Treat it as a quality lever.
- Status: `shape-rendering`/`vector-effect` are supported as presentation attributes and CSS properties in all engines (BCD). Compositor reasons are Chromium-specific.
- Sources: https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/shape-rendering, https://github.com/GoogleChrome/web.dev/issues/3790

### Receive binary market data as ArrayBuffer and decode it off the main thread
- Layer: js, network
- Stage: network, main-thread-task, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: long-lived session
- Impact: high at hundreds or thousands of messages per second.
- Do: Set `ws.binaryType = 'arraybuffer'` right after you construct the socket. Use binary frames (fixed-layout records read with `DataView` or typed arrays) for high-rate channels, and keep JSON for low-rate control messages. Open the socket in a dedicated worker, decode there, and post batched typed arrays to the main thread with transfer.
- Why: The spec default is `"blob"`, and with `"blob"` the user agent may spool the data to disk. Reading a Blob is async (`await blob.arrayBuffer()`), which adds a hop and allocation per message. The spec says `"arraybuffer"` is "likely more efficient" in memory. Fixed binary records skip string decoding and create no object graph per message, while JSON creates many short-lived objects (GC pressure). WebSocket is exposed in workers (spec IDL `Exposed=(Window,Worker)`).
- Example:
  ```js
  // worker.js
  const ws = new WebSocket(url); ws.binaryType = 'arraybuffer';
  let buf = []; ws.onmessage = (e) => { if (e.data instanceof ArrayBuffer) buf.push(e.data); };
  setInterval(() => { if (buf.length) { const out = merge(buf); buf = []; postMessage(out, [out.buffer]); } }, 16);
  ```
- Avoid/caveats: The claim that binary beats JSON at high rates is a mechanism argument. I found no primary benchmark. Measure with your schema. The spec says `bufferedAmount` covers only data queued by `send()`. For receive-side backpressure, `WebSocketStream` is Chromium only (07:482).
- Status: `binaryType` Chrome 15, Firefox 11, Safari 6 (BCD). WebSockets Baseline widely available. `WebSocketStream` Chrome 124 only, experimental.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/binaryType, https://websockets.spec.whatwg.org/

### Ask the server to conflate and batch; render the latest state, not every message
- Layer: network, js
- Stage: network, main-thread-task
- Metrics: INP, FPS/smoothness
- When: long-lived session
- Impact: high. Sending more updates than the screen can show wastes bytes, parse time and main-thread time.
- Do: Subscribe with a server-side conflation interval per channel (for example, the latest top-of-book every 50-100 ms for background panels and every frame for the focused panel). Batch many instrument updates into one frame. On the client, keep only the latest value per key before each rAF.
- Why: The display updates at most once per refresh (16.7 ms at 60 Hz). Updates in between are overwritten before paint. Server conflation reduces bandwidth, decode and GC together, and the client merge-by-key keeps work per frame bounded (see the frame budget item below).
- Avoid/caveats: Never conflate trade or fill events that the user must see individually (executions, order acks). Conflate only state snapshots.
- Status: Pattern (protocol design). No browser support needed.
- Sources: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_long_is_too_long, https://websockets.spec.whatwg.org/

### Detect dead connections with app-level heartbeats and reconnect with capped exponential backoff and full jitter
- Layer: js, network
- Stage: network, idle
- Metrics: memory, INP
- When: long-lived session
- Impact: medium. Silent half-open sockets freeze the terminal, and retry storms after an outage overload the backend.
- Do: Have the server send a heartbeat message every N seconds, and treat 2-3 missed beats as a dead link. Reconnect after `random(0, min(cap, base * 2 ** attempt))` ms, reset `attempt` after a stable period, queue outgoing orders while offline (or fail them visibly), and resubscribe from the last sequence number.
- Why: The WebSocket API does not expose Ping/Pong frames. The spec says user agents "may" send pings, but pages cannot. AWS's analysis (blog) found that "Full Jitter" gave the fewest total calls and spread retry spikes.
- Example:
  ```js
  const delay = (n) => Math.random() * Math.min(30_000, 500 * 2 ** n);
  ```
- Avoid/caveats: Stop reconnecting while `document.visibilityState === 'hidden'` if the business allows it. Close on `pagehide` for bfcache (03, 04, 07).
- Status: WebSockets Baseline widely available. The backoff algorithm needs no browser support.
- Sources: https://websockets.spec.whatwg.org/#ping-and-pong-frames, https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/

### Choose the transport by direction and message shape: SSE for one-way text push, WebSocket for two-way or binary, WebTransport for unreliable datagrams
- Layer: network
- Stage: network
- Metrics: memory, INP
- When: long-lived session
- Impact: medium. The wrong transport adds reconnect code, text encoding cost, or connection-limit stalls.
- Do: Use `EventSource` for server-to-client text streams (news, alerts, low-rate quotes) over HTTP/2 or HTTP/3. It reconnects by itself and resumes with `Last-Event-ID`. Use WebSocket for two-way traffic, order entry, or binary frames. Consider WebTransport datagrams only for data where a late value is worthless (a price tick can be replaced by the next one) and when you control an HTTP/3 server. Share one connection across tabs through a SharedWorker.
- Why: SSE streams are always UTF-8 text, and a 204 response stops reconnects (HTML spec). Over HTTP/1.1, browsers cap connections at 6 per domain across all tabs (MDN, "Won't fix" in Chrome and Firefox). The HTML spec suggests sharing one EventSource through a shared worker. WebTransport offers unreliable, unordered datagrams plus reliable streams over HTTP/3 (MDN).
- Avoid/caveats: SSE cannot send custom headers (use cookies or the URL). The spec suggests a comment line every 15 s to keep legacy proxies from dropping the stream. WebTransport needs an HTTPS URL with an explicit port and an HTTP/3 server. SharedWorker on Chrome Android arrived only in 148.
- Status: SSE Baseline widely available. WebTransport Baseline newly available 2026-03-24 (Safari 26.4). SharedWorker Baseline newly available 2026-05-05 (Chrome Android 148) (web-features).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/EventSource, https://html.spec.whatwg.org/multipage/server-sent-events.html, https://developer.mozilla.org/en-US/docs/Web/API/WebTransport

### Write a degradation policy for every streaming view, driven by measured frame time, and show when the view is degraded
- Layer: js
- Stage: main-thread-task, gpu-draw
- Metrics: FPS/smoothness, INP, memory
- When: long-lived session, animation/render-loop
- Impact: high on weak devices and during market bursts. Without a policy, frame time grows until input stalls.
- Do: Before you build the view, list the steps in order and the trigger for each: (1) lower the update rate of background panels, (2) aggregate older samples and narrow the time window, (3) hide secondary series and indicators, (4) lower the canvas DPR, (5) pause off-screen charts. Trigger from a rolling p95 of rAF deltas (all browsers) and, where available, the `blockingDuration` of `long-animation-frame` entries. Add hysteresis. Show a small "reduced detail" badge while degraded, and restore the steps in reverse order.
- Why: The OpenAI data-visualization skill (a GitHub skill, not a primary source) asks for frame, memory and network budgets up front and says to make "degraded state visible". LoAF entries report frames over 50 ms with `blockingDuration`, `renderStart`, `styleAndLayoutStart` and per-script attribution (W3C draft). Static device-class rules (07) cannot see bursts. Frame time can.
- Example:
  ```js
  let last = performance.now(), deltas = [];
  function tick(now) { deltas.push(now - last); last = now; if (deltas.length > 120) deltas.shift();
    const p95 = [...deltas].sort((a, b) => a - b)[114];
    if (p95 > 24) policy.stepDown(); else if (p95 < 14) policy.stepUp(); requestAnimationFrame(tick); }
  ```
- Avoid/caveats: rAF deltas grow when the tab is throttled or hidden, so ignore samples while hidden. On 120 Hz displays, the thresholds scale with the refresh interval. Do not degrade fills or executions.
- Status: LoAF Chrome 123 only (BCD, experimental). rAF in all engines. Compute Pressure (07) Chrome 125 desktop only.
- Sources: https://github.com/openai/plugins/tree/main/plugins/build-web-data-visualization, https://w3c.github.io/long-animation-frames/

### Svelte 5: derive with `$derived`, reserve `$effect` for escape hatches, bind chart engines with `{@attach}`
- Layer: js
- Stage: script-run, microtask, main-thread-task
- Metrics: INP, FPS/smoothness, memory
- When: interaction, long-lived session
- Impact: medium. State synced through effects doubles the update passes and can loop. Chart setup that is re-run on each prop change recreates GPU resources.
- Do: Compute derived values with `$derived`/`$derived.by`. Do not assign state inside `$effect`. Mount a chart engine in an `{@attach}` factory that returns a cleanup, and read props that change often in a nested `$effect` inside the attachment, so setup runs once. Use `$state.raw` for large arrays that you replace and do not mutate. Use keyed `{#each}` for rows.
- Why: Svelte docs: deriveds are lazy ("push-pull"), and when a derived's value is referentially identical, downstream updates are skipped. Effects run after DOM updates in a microtask and should not be used to "synchronise state". Attachments "re-run on changes" to their arguments, so heavy setup must not read changing state directly. `$state.raw` avoids the proxy cost for data that is only reassigned.
- Example:
  ```svelte
  <script>
    let { data, range } = $props();
    const visible = $derived.by(() => slice(data, range));
    function chart(opts) { return (node) => { const c = createChart(node, opts());
      $effect(() => c.setData(visible)); return () => c.delete(); }; }
  </script>
  <div {@attach chart(() => ({ theme: 'dark' }))}></div>
  ```
- Avoid/caveats: Writable deriveds need Svelte 5.25+, and `{@attach}` needs 5.29+. Pass `$state.snapshot()` to libraries that cannot take proxies.
- Status: Svelte 5 docs (current). `{@attach}` since 5.29.
- Sources: https://svelte.dev/docs/svelte/$derived, https://svelte.dev/docs/svelte/$effect, https://svelte.dev/docs/svelte/@attach, https://svelte.dev/docs/svelte/$state, https://svelte.dev/docs/svelte/each

### Do not animate panel height to or from `auto` in a data-dense UI; if you must, keep it short and Chromium-only
- Layer: css
- Stage: style, layout, paint
- Metrics: FPS/smoothness, CLS, INP
- When: interaction
- Impact: medium. Every technique that animates height to or from `auto` runs layout for the panel and everything below it on every frame. Only `interpolate-size` and `calc-size()` make the intent explicit.
- Do: Open and close terminal panels and accordions instantly, or animate only `opacity`/`transform` of the content. If you want a height animation, opt in with `interpolate-size: allow-keywords` on `:root` and keep it under about 300 ms. For `<details>`, transition `::details-content` with `content-visibility … allow-discrete` plus opacity. Avoid the `grid-template-rows: 0fr → 1fr` and `max-height` tricks, which also run layout every frame.
- Why: Chrome: `interpolate-size` lets you interpolate between one intrinsic keyword and one length, and browsers without it simply do not transition, which makes it a progressive enhancement. `calc-size()` adds math on intrinsic sizes. web.dev says to use `transform: scale()` instead of `height` changes to avoid layout shifts. Layout shifts count toward CLS unless they happen within 500 ms of a discrete input, so a long expand animation that pushes content keeps adding CLS after 500 ms. This last point is an inference from the CLS definition.
- Example:
  ```css
  :root { interpolate-size: allow-keywords; }
  .panel { block-size: 0; overflow: clip; transition: block-size 200ms ease-out; }
  .panel[data-open] { block-size: auto; }
  @media (prefers-reduced-motion: reduce) { .panel { transition: none; } }
  ```
- Avoid/caveats: Two intrinsic keywords cannot be interpolated. The property is inherited, so scope it if a library assumes that keywords do not animate. Respect `prefers-reduced-motion`.
- Status: `interpolate-size` and `calc-size()`: Chrome 129 only (BCD, experimental; not Baseline). `::details-content`: Baseline newly available 2025-09-16 (Chrome 131, Firefox 143, Safari 18.4). `transition-behavior`: Baseline newly available 2024-08-06.
- Sources: https://developer.chrome.com/docs/css-ui/animate-to-height-auto, https://developer.mozilla.org/en-US/docs/Web/CSS/interpolate-size, https://developer.mozilla.org/en-US/docs/Web/CSS/::details-content, https://web.dev/articles/cls

### When a CSS background must stay, select it with `image-set()` and preload the same candidate
- Layer: css, html
- Stage: preload-scan, network, cssom
- Metrics: LCP
- When: load
- Impact: medium when the LCP element is a CSS background, and low otherwise.
- Do: Prefer `<img>` for LCP images (01 run2-new). When a background is required, write a plain `url()` fallback and then `image-set()` with `type()` and `x` descriptors. Preload the likely candidate from the HTML with `imagesrcset` (and `type` for a modern format) plus `fetchpriority="high"`.
- Why: Background images are found only after CSSOM and style matching, and web.dev lists "the LCP element requires a CSS background image" as a cause of load delay unless it is preloaded. `image-set()` lets the browser download only one image, chosen by resolution and supported type (MDN).
- Example:
  ```html
  <link rel="preload" as="image" fetchpriority="high" type="image/avif"
        imagesrcset="/hero-1x.avif 1x, /hero-2x.avif 2x">
  <style>.hero { background-image: url(/hero-1x.jpg);
    background-image: image-set(url(/hero-1x.avif) type("image/avif") 1x, url(/hero-2x.avif) type("image/avif") 2x,
                                url(/hero-1x.jpg) type("image/jpeg") 1x, url(/hero-2x.jpg) type("image/jpeg") 2x); }</style>
  ```
- Avoid/caveats: If the preload list and the `image-set()` choice differ, the browser downloads two images. A `type` on the preload makes browsers without AVIF skip the preload. They then fetch the JPEG late, which is acceptable. Background images have no alt text.
- Status: `image-set()` Baseline widely available (low 2023-09-18, high 2026-03-18; Chrome 113, Firefox 89, Safari 17). `imagesrcset` Chrome 73, Firefox 78, Safari 17.2. `fetchpriority` Baseline newly available 2024-10-29.
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/image/image-set, https://web.dev/articles/optimize-lcp

### Budget each frame against the refresh interval and each task against about 50 ms
- Layer: js
- Stage: main-thread-task, style, layout, paint
- Metrics: FPS/smoothness, INP, TBT
- When: animation/render-loop, interaction
- Impact: medium. This gives the agent concrete numbers when it writes a render loop or a handler.
- Do: Keep script plus style plus layout per frame to about 10 ms at 60 Hz. Rendering takes about 6 ms of the 16.7 ms (MDN), so scale down for 120 Hz (8.3 ms per frame). Split startup and background work into chunks of 50 ms or less. Acknowledge input within 100 ms, and within 50 ms where possible.
- Why: MDN's "How long is too long" gives these goals: idle chunks of 50 ms, animation at 16.7 ms, and responsiveness of 50-200 ms. MDN's animation guide classifies properties by the steps they trigger: geometry changes cause style, layout and paint; paint-only properties cause style and paint; `transform` and `opacity` cause style and composite only.
- Avoid/caveats: The "about 6 ms to render" figure is a rule of thumb, not a measured number. MDN Fundamentals states that humans cannot see differences above 60 Hz. That is outdated for 120 Hz displays and is not a reason to cap charts at 60 fps.
- Status: Guidance (MDN).
- Sources: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_long_is_too_long, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Fundamentals

### Set performance budgets with warning and error levels, and gate them in CI against a per-branch baseline
- Layer: build, tooling
- Stage: network, script-compile
- Metrics: bundle-size, LCP, INP, startup
- When: build, testing
- Impact: medium. Budgets stop gradual regressions that no single review catches.
- Do: Define budgets for file size (per chunk, per route, SciChart Wasm separate), timing (LCP and INP in lab and field), and rule-based scores. Give each a warning level (plan work) and an error level (block the merge). Compare against the base branch's baseline, not an absolute ideal.
- Why: MDN's budget guide calls for two levels (warning and error) and a development baseline per branch. Size budgets are the first line of defense, but size does not map directly to time, so keep timing budgets too.
- Avoid/caveats: MDN's examples (Lighthouse Bot on Travis CI, TTI) are outdated. Use current CI and INP/LCP instead.
- Status: Guidance.
- Sources: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Performance_budgets

### Use synthetic tests to catch regressions and RUM to find what users actually hit; do not replace one with the other
- Layer: tooling
- Stage: network, main-thread-task
- Metrics: LCP, INP, CLS, TTFB
- When: testing, long-lived session
- Impact: medium.
- Do: Run lab traces (fixed device, throttling and cache state) on each change, and fail the push when a result regresses from the baseline. Collect RUM from real sessions with Navigation and Resource Timing (`nextHopProtocol`, `transferSize` versus `decodedBodySize`) plus web-vitals attribution. Segment the data by browser and device.
- Why: MDN: synthetic monitoring is suited to "regression testing", and RUM captures real devices, networks and paths but costs more. MDN's timing guide computes compression savings as `1 - transferSize / decodedBodySize` and reads the protocol from `nextHopProtocol`.
- Avoid/caveats: DevTools throttling presets only approximate networks. For example, MDN lists "Regular 3G" as 750 kbps down with 100 ms minimum latency. Cross-origin resources hide details without `Timing-Allow-Origin` (a known Resource Timing rule; not stated in this guide).
- Status: Navigation and Resource Timing Baseline widely available.
- Sources: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Rum-vs-Synthetic, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Navigation_and_resource_timings, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Understanding_latency

### Start up asynchronously: decode in workers with built-in decoders, and keep non-critical code out of the startup HTML
- Layer: js
- Stage: script-run, main-thread-task
- Metrics: startup, TBT, INP
- When: load
- Impact: medium.
- Do: Fetch and decode startup data (history bars, symbol lists) in a worker. Use the platform's decoders (`createImageBitmap`, `DecompressionStream`, `TextDecoder`) instead of JS ports. Load code for panels that are not on the first view on demand.
- Why: MDN's startup guide: move fetching and processing to a worker, use the browser's decoders because they are "almost certainly significantly faster" and may run in parallel, and leave scripts that are not on the critical path out of the startup HTML.
- Avoid/caveats: Workers cannot touch the DOM. Transfer buffers instead of copying them.
- Status: Guidance.
- Sources: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Optimizing_startup_performance

### Pick video encodings with Media Capabilities `decodingInfo()` (`smooth` and `powerEfficient`)
- Layer: js
- Stage: network, gpu-draw
- Metrics: FPS/smoothness, memory
- When: load
- Impact: low for a trading terminal (video only in tutorials or marketing). It is high where video plays next to live charts.
- Do: Before you choose a rendition, call `navigator.mediaCapabilities.decodingInfo({type: 'media-source', video: {contentType, width, height, bitrate, framerate}})`. Prefer results that are `smooth` and `powerEfficient`, which usually means hardware decode.
- Why: MDN: the result reports whether playback is possible at the given frame rate without dropped frames (`smooth`) and whether it is power efficient. A software decode competes with the chart for CPU.
- Avoid/caveats: This is a hint, not a guarantee. `keySystemConfiguration` needs a secure context and does not work in workers.
- Status: Media Capabilities Baseline widely available (high 2024-10-28; web-features). `decodingInfo` Chrome 66, Firefox 63, Safari 13 (BCD).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/decodingInfo

### Collect browser deprecation and intervention reports with `ReportingObserver` and `Reporting-Endpoints`
- Layer: js, network
- Stage: idle
- Metrics: INP, FPS/smoothness
- When: long-lived session, testing
- Impact: low to medium. It catches browser interventions (for example, APIs that were blocked or throttled) and deprecations before they break the terminal. The unload deprecation is one such case.
- Do: In the page, observe `['deprecation', 'intervention']` with `buffered: true` and send batched reports to your log endpoint. For server delivery, send `Reporting-Endpoints: default="https://…/reports"` and do not rely on the old `Report-To` header.
- Why: MDN: reports are delivered as JSON POSTs (`application/reports+json`). All report types except `crash` can be observed in JavaScript. `Report-To` is no longer part of the Reporting API.
- Example:
  ```js
  new ReportingObserver((reports) => navigator.sendBeacon('/r', JSON.stringify(reports.map(r => ({ t: r.type, b: r.body })))),
    { types: ['deprecation', 'intervention'], buffered: true }).observe();
  ```
- Avoid/caveats: Deprecation and intervention reports are Chromium only (web-features). web-features marks "intervention reports" as discouraged, because specifications no longer define interventions. Treat them as best-effort signals.
- Status: Reporting API Baseline newly available 2026-03-24 (Firefox 149). `ReportingObserver` Chrome 69, Firefox 149, Safari 16.4. `Reporting-Endpoints` Chrome 96, Firefox 130, Safari 16.4 (BCD).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Reporting_API

### Attack TTFB and resource load delay before image bytes when LCP is slow
- Layer: network, html
- Stage: network, preload-scan
- Metrics: LCP, TTFB
- When: load
- Impact: high. In Chrome field data, image download is the shortest LCP subpart in every rating bucket.
- Do: Read the LCP breakdown first. For poor LCP, fix TTFB (CDN, caching, fewer redirects) and load delay: make the LCP resource discoverable in HTML (`<img>` or preload), add `fetchpriority="high"`, and remove `loading="lazy"` from it. Compress images too, but expect a small gain.
- Why: web.dev (2024-08-20) took the median of origin p75 values from CrUX. For poor-LCP origins: TTFB 2,270 ms, load delay 1,290 ms, load duration 350 ms, render delay 360 ms. Most such origins spend "less than 10%" of p75 LCP downloading the image. Mobile image load was only about 20% slower than desktop.
- Avoid/caveats: Preloading can move the time into render delay if CSS or JS still blocks the render (for example, a client-rendered app).
- Status: Field data 2024. The LCP subparts are current in DevTools insights.
- Sources: https://web.dev/blog/common-misconceptions-lcp

### Start module workers with `{type: 'module'}` and preload them with `modulepreload`
- Layer: js, html
- Stage: network, script-compile
- Metrics: startup, INP
- When: load
- Impact: medium for apps that parse market data in workers at startup.
- Do: Create workers with `new Worker(url, {type: 'module'})`, add `<link rel="modulepreload" href="/worker.js">` so the worker's module graph is fetched and parsed early, and use `import()` inside the worker for code that is needed later.
- Why: web.dev (2019): module workers load their dependencies in parallel, share parsed module code between the main thread and workers, and can be preloaded and "even pre-parsed" with `modulepreload`. Classic workers had no working preload (`as="worker"` was never implemented). `importScripts()` blocks and is not available in module workers.
- Avoid/caveats: Module worker code runs in strict mode, and top-level `this` is `undefined` (use `self`). The claim that parsed code is shared across the main thread and workers comes from the 2019 article and is not re-verified.
- Status: Module dedicated workers: Chrome 80, Firefox 114, Safari 15 (BCD). `modulepreload` Chrome 66, Firefox 115, Safari 17.
- Sources: https://web.dev/articles/module-workers

### Precache only the app shell; never precache responsive image sets, favicon sets or polyfills
- Layer: js, network
- Stage: network, idle
- Metrics: bundle-size, memory, TTFB (repeat visits)
- When: load, build
- Impact: medium. Over-precaching wastes data on every service worker update.
- Do: Precache global CSS, the global JS chunks and the shell HTML. Runtime-cache per-route chunks, images and polyfills. Speculatively precache other assets only when analytics support it, and never precache assets that change often.
- Why: Workbox guidance: a precached responsive set downloads variants that the device never uses, only one favicon is requested, and polyfills are needed only by some browsers. Precached HTML is served from the cache until the service worker updates, which causes churn when the HTML changes often.
- Avoid/caveats: For the terminal, precache the shell and the SciChart Wasm file (one variant: SIMD or no-SIMD), and do not precache both Wasm builds.
- Status: Guidance (Workbox docs).
- Sources: https://developer.chrome.com/docs/workbox/precaching-dos-and-donts

### For complex sites, prefetch likely next pages eagerly and prerender on hover; keep prerendered pages fresh or cancel them
- Layer: html, js
- Stage: network, idle
- Metrics: LCP, INP (next navigation)
- When: interaction
- Impact: medium for MPAs (docs, account pages). It is not relevant inside a single-page terminal.
- Do: Prefetch one or two frequently visited next pages with `eager`, and prerender same-origin links with `moderate`, excluding `/logout` and state-changing URLs. Broadcast state changes (for example, a basket or account state) to prerendered pages with BroadcastChannel. To cancel, remove the rules, wait a microtask, and reinsert them. From the server, use `Clear-Site-Data` (prefetch and prerender caches). Turn speculation off during peak load.
- Why: Chrome's guide: prefetch first, because it is cheaper and safer. Scripts delayed until activation all run at activation, which can hurt INP. Prerendered pages can become stale. Removing rules cancels speculations, and only `immediate`/`eager` rules restart when you reinsert them.
- Avoid/caveats: Analytics and ads must be prerender-aware. Measure each rollout step, because over-speculation can slow the client or the server.
- Status: Speculation rules are Chromium only (webstatus). Safari 26.2 prefetch is behind a flag (verify/01).
- Sources: https://developer.chrome.com/docs/web-platform/implementing-speculation-rules

### For MPA sections, stream a precached header and footer around network content from the service worker
- Layer: js, network
- Stage: network, html-parse
- Metrics: FCP, LCP, TTFB
- When: load
- Impact: medium for multipage docs or account areas. It is not needed for the SPA terminal.
- Do: Precache header and footer partials. Serve navigations with a stream that joins the cached header, the network content partial (with navigation preload, and a header that asks the server for the partial only), and the cached footer.
- Why: The browser starts parsing and painting the cached header right away while content arrives. Navigation preload starts the content request during service worker boot (Workbox guide, 2022).
- Avoid/caveats: The server must support partial responses and `Vary` on the request header. Precached partials need content hashes.
- Status: Streams and navigation preload are in all engines.
- Sources: https://developer.chrome.com/docs/workbox/faster-multipage-applications-with-streams

### Move elements with `transform`, never `top`/`left`, to avoid animation-induced layout shifts
- Layer: css
- Stage: layout, composite
- Metrics: CLS, FPS/smoothness
- When: animation/render-loop, interaction
- Impact: medium.
- Do: Animate position with `transform: translate()` and size with `transform: scale()`. For drawers, toasts and tooltips over the chart, use transform-based entry animations.
- Why: web.dev: changing `top`/`left` causes layout shifts "even when the element being moved is on its own layer". Composited `translate` animations cannot affect other elements and do not count toward CLS. The 500 ms `hadRecentInput` exclusion applies only to discrete input (tap, click, key), not to scroll or drag.
- Avoid/caveats: Percent translations that depend on box size can stop the animation from running on the compositor (Chromium failure reason).
- Status: Guidance.
- Sources: https://web.dev/articles/optimize-cls, https://web.dev/articles/cls

### Read GPU cost from a saved trace: the GPU track and the Frames track in DevTools, or Perfetto for the GPU process
- Layer: tooling
- Stage: gpu-draw, gpu-upload, raster, composite
- Metrics: FPS/smoothness
- When: testing
- Impact: medium. The MCP text summary reports LCP, INP, CLS and insights only, so GPU-bound chart frames look fine there.
- Do: Run `performance_start_trace` with `filePath` (for example `trace.json.gz`), then open the file in the DevTools Performance panel. In the Frames section, check for yellow (partially presented) and red (dropped) frames. Check the GPU section for long GPU tasks that line up with chart frames. For deeper GPU and compositor detail, record with Perfetto (ui.perfetto.dev with its Chrome extension) using the categories `gpu`, `viz`, `cc`, `webgpu`, `gpu.dawn`, `disabled-by-default-gpu.service` and `disabled-by-default-skia.gpu`, or open the DevTools JSON in Perfetto.
- Why: DevTools reference: a partially presented frame means Chrome rendered only some updates in time, for example when main-thread canvas work is late but compositor scrolling is on time. A dropped frame could not be rendered in time. MCP's summary comes from `PerformanceTraceFormatter.formatTraceSummary()`, which prints URL, bounds, throttling, LCP/INP/CLS and insights, with no frame or GPU data. MCP records with DevTools' `DefaultCategories` plus JS sampling and screenshots (`src/tools/performance.ts`), so the saved trace should show the same GPU and Frames data as a DevTools recording. This last point is an inference and was not tested.
- Avoid/caveats: Perfetto traces contain the URLs of all open tabs and hardware details (Perfetto warns about this). Perfetto shows overlapping non-nested JSON events on an overflow track. Combine the trace with in-page timer queries (10, 11) for per-pass GPU time.
- Status: Chrome DevTools (current). The category names are from Chromium `base/trace_event/builtin_categories.h` (HEAD).
- Sources: https://developer.chrome.com/docs/devtools/performance/reference, https://perfetto.dev/docs/getting-started/chrome-tracing, https://perfetto.dev/docs/getting-started/other-formats, https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/ai_assistance/data_formatters/PerformanceTraceFormatter.ts, https://chromium.googlesource.com/chromium/src/+/HEAD/base/trace_event/builtin_categories.h

### Update the Chrome DevTools MCP inventory to 1.10.1
- Layer: tooling
- Stage: style, main-thread-task
- Metrics: FPS/smoothness, memory
- When: testing
- Impact: low to medium. Long chart-session traces are more reliable, and CSS debugging becomes a normal tool.
- Do: Pin `chrome-devtools-mcp@1.10.1` (npm latest, published 2026-09-23). Use `get_css_styles` (`pageId`, `uid` from `take_snapshot`, `pageSize` default 10, `pageIdx` default 0). It is a normal tool in the Debugging category, not doc-only. Use `--config <file.json>` for shared flag sets. Keep trace files for long sessions.
- Why: 1.10.0 (2026-09-23) added `get_css_style` (renamed to `get_css_styles` in the source and docs), default paging, config-file support, a chunked trace-buffer parser (batches of 10,000 events or 32 MB) and a fix for a trace-engine memory leak (model scoped per parse). 1.10.1 fixed the rollup bundle.
- Avoid/caveats: The 1.2 GB default trace buffer came in 1.9.0 (2026-09-08), not in 1.10.0 as the critic wrote. The source passes `bufferSize: 1200 * 1000` (KB). The Debugger-domain caveat above applies to all versions.
- Resolution: 14-devtools-mcp-and-webmcp.md:3 and :34. Change 1.9.0 to 1.10.1 and remove "(doc only)" from `get_css_styles`.
- Status: Verified in the repo at commit 069ab27 (CHANGELOG.md, src/tools/css.ts, docs/tool-reference.md, docs/configuration.md) and in the npm registry times.
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/releases, https://registry.npmjs.org/chrome-devtools-mcp, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md

### SciChart: use `SciChartSurface.create()` for terminals, because `createSingle()` reloads the page on WebGL context loss
- Layer: gpu, js
- Stage: gpu-draw
- Metrics: FPS/smoothness, memory
- When: long-lived session
- Impact: high. In a long session, a GPU reset or a context eviction (too many contexts) otherwise reloads the whole terminal.
- Do: Build charts with `SciChartSurface.create()` (shared master WebGL context). SciChart restores that context itself. Keep `createSingle()` for a few isolated heavy charts, and only if a reload on context loss is acceptable. Count `createSingle` charts toward the browser's WebGL context limit (the typings say "a limit (16)" for createSingle; 19-design-b).
- Why: scichart 5.2.69 source: `initCanvas()` defaults to a dedicated WebGL canvas for `createSingle()`. It registers a `webglcontextlost` listener that logs "Reloading the page" and calls `location.reload()` (`Charting/Visuals/sciChartInitCommon.js`). For the shared context, `monitorWebGL()` calls `preventDefault()`, marks surfaces inactive, clears pen, label and native caches, shuts down the engine, and on `webglcontextrestored` re-inits the engine and forces a redraw (`Charting/Visuals/createMaster.js`).
- Avoid/caveats: This is source reading of the CommonJS build, not a documented API. No SciChart doc on context loss was found. Retest after each SciChart upgrade.
- Status: scichart 5.2.69.
- Sources: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/sciChartInitCommon.js, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/createMaster.js

### SciChart: detach long-hidden streaming series instead of only setting `isVisible = false`
- Layer: js
- Stage: script-run, main-thread-task
- Metrics: FPS/smoothness
- When: long-lived session, animation/render-loop
- Impact: medium when many indicator series are toggled off but still stream.
- Do: For a series that the user hides for more than a moment, remove it from `sciChartSurface.renderableSeries` and keep its `dataSeries` if you want to re-add it quickly, or stop appending to it. Use `isVisible = false` for quick toggles.
- Why: `SciChartRenderer.prepareSeriesRenderData()` loops over all renderable series and calls `ExtremeResamplerHelper.resampleSeries()` for each, with no visibility check. Only the draw step skips series with `!rs.isVisible`. Resampling is cached by a hash, so a hidden series costs nothing while its data and the view stay unchanged. While it streams, it is resampled on every frame. Autorange does exclude hidden series (`AxisBase2D.js` filters on `s.isVisible`).
- Avoid/caveats: Inference from source. Not measured. Re-adding a series recreates its render data on the next frame.
- Status: scichart 5.2.69 (`Charting/Services/SciChartRenderer.js`).
- Sources: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Services/SciChartRenderer.js, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/Axis/AxisBase2D.js

### SciChart: use `EAutoRange.Always` on Y for streaming only with the sorted-data flags; drive X with an explicit window
- Layer: js
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, interaction
- Impact: medium.
- Do: For a scrolling time window, set X to `EAutoRange.Never` and update `visibleRange` yourself each frame (or use FIFO sweeping). Use `Always` on Y only when you want Y to follow the data, and set `dataIsSortedInX: true` and `containsNaN` explicitly.
- Why: SciChart docs: `Always` autoranges "every time the chart is drawn" and overrides zooming and panning by modifiers. In source, the Y range for the visible X window is a memoized `getWindowedYRange()`. It finds the index range by binary search when data is sorted, and otherwise over the whole series. It then runs a Wasm `MinMaxWithIndex` over that slice for each series, after each data change. The docs say that the sort and NaN flags give a speedup "by a factor of 5" because they stop automatic recalculation.
- Avoid/caveats: `Always` on X breaks the user's zoom and pan (docs). The per-frame cost is O(visible points) per series and was not measured here.
- Status: scichart 5.2.69 (`Charting/Model/BaseDataSeries.js` `getWindowedYRange`).
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/axis-api/ranging-scaling/auto-range/, https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/resampling/, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.js

### SciChart: do not animate point-marker fill, stroke or size per frame; use `lastPointOnly` for "current value" dots
- Layer: canvas2d, gpu
- Stage: paint, gpu-upload, gpu-draw
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium.
- Do: Set point-marker styles once. For a pulsing "last price" dot, use `lastPointOnly: true` and animate `opacity` (the only property that does not rebuild the sprites), or draw an annotation. For per-point colors, use a palette provider instead of swapping markers. Call `delete()` on markers you replace.
- Why: `BasePointMarker` renders its shape into canvas textures (sprite, stroke mask, fill mask). Setting `fill`, `stroke`, `width`, `height`, `strokeThickness`, `lastPointOnly` or `antiAlias` calls `recreateSpriteTextures()`, which is a canvas draw plus a texture upload. `opacity` returns early. The docs describe `isLastPointOnly` for ECG-style highlights. Markers are drawn for each point after resampling, so dense scatters stay costly when the data is not sorted (see the resampling scope item).
- Avoid/caveats: Source reading. Not measured.
- Status: scichart 5.2.69 (`Charting/Visuals/PointMarkers/BasePointMarker.js`).
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/common-series-apis/drawing-point-markers/, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/PointMarkers/BasePointMarker.js

### SciChart: load it on demand, because v5 does not tree-shake, and do not plan on worker or OffscreenCanvas rendering
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, startup
- When: build, load
- Impact: medium. It is about 2.2 MB of minified JS plus about 1.28 MB of Wasm per 2D or 3D engine.
- Do: Import SciChart only in chart routes and panels with dynamic `import()`. Serve `scichart2d.wasm` with long-term caching and `application/wasm` (streaming compile). Load the 3D engine only when a 3D chart opens. Keep chart rendering on the main thread, and move data decode and aggregation to workers.
- Why: The package.json of scichart 5.2.69 has `main: index.js` (CommonJS, 933 `require` calls in the entry) and no `module`, `exports` or `sideEffects` fields. `index.min.mjs` is one pre-built bundle of 2.27 MB. So bundlers cannot drop unused parts. The `_wasm/` folder ships `scichart2d.wasm` (1.28 MB), a no-SIMD fallback, and 3D equivalents. No file in 5.2.69 or 6.0.0-alpha.197 uses `OffscreenCanvas` or `transferControlToOffscreen`. Rendering uses a DOM master canvas. The 6.0 alpha adds an `esm/` build and an `exports` map (still without `sideEffects: false`).
- Avoid/caveats: Absence in the package is not a roadmap statement. Check v6 releases. Precache only the Wasm variant the device uses.
- Status: scichart 5.2.69 (latest) and 6.0.0-alpha.197 (2026-09-23).
- Sources: https://registry.npmjs.org/scichart, https://cdn.jsdelivr.net/npm/scichart@5.2.69/package.json, https://data.jsdelivr.com/v1/packages/npm/scichart@6.0.0-alpha.197?structure=flat, https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.197/package.json

### SciChart: keep raw timestamps as float64 in the DataSeries, and do not pre-offset them for precision
- Layer: js
- Stage: script-run, gpu-upload
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low. It prevents needless JS work.
- Do: Append epoch seconds or milliseconds as they are. Do not subtract a base time in JS before handing data to SciChart.
- Why: The d.ts shows that data series values live in `SCRTDoubleVector` (64-bit doubles in Wasm memory), and the coordinate calculators take `visibleMin`/`visibleMax` as JS numbers and map them to pixels in the engine. The float32 precision loss that 10-gpu-webgl.md:587 guards against affects custom renderers that upload raw values. It does not affect data kept as doubles until pixel conversion.
- Avoid/caveats: Partly verified. Storage is float64 (d.ts), but the GPU vertex format and the conversion point were not visible in the JS package, and the SciChart "64-bit precision" blog returned 403. 10:1033 stays "partly verified".
- Status: scichart 5.2.69 d.ts.
- Sources: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.d.ts, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Numerics/CoordinateCalculators/CoordinateCalculatorBase.d.ts

---

## Status fixes

Survey rules that had no topic item (18-skills-survey-*.md "Rules to consider adding"):

| Survey rule | Now covered by | Status |
|---|---|---|
| github #7 degradation policy for streaming views | "Write a degradation policy for every streaming view…" | Pattern. Signals: rAF deltas in all engines; LoAF Chrome 123 only (experimental, BCD); Compute Pressure Chrome 125 desktop only. |
| github #10 Svelte 5 (`$state.raw`, `$derived` over `$effect`, `{@attach}`) | "Svelte 5: derive with `$derived`…" and "Update rows in place with stable keys…" | Svelte 5 docs, current 2026-09. Writable `$derived` since 5.25, `{@attach}` since 5.29. |
| web #16 SVG or DOM charts: freeze geometry after enter; transform hover on a group; hover state separate | Three SVG items in part B | Chromium 89+ accelerates SVG transform, opacity and filter animations (Chrome blog). Behavior inside SVG disputed (astryx issue). `vector-effect`/`shape-rendering` in all engines (BCD). |
| web #19 resilient live feeds (transport by direction, heartbeats, capped backoff, queue) | The four transport items in part B | WebSockets and SSE Baseline widely available. WebTransport Baseline newly available 2026-03-24. SharedWorker Baseline newly available 2026-05-05. |

Run2-only items in 01 (01-critical-rendering-path.run2-new.md, never verified). I checked their Status lines against BCD 8.1.2 and web-features:

| Item | Current Status line | Check |
|---|---|---|
| Use an img element for the LCP image… | "Responsive image preload Baseline widely available (2023-12, Safari 17.2)" | Wrong label. `link imagesrcset`: Chrome 73, Firefox 78, Safari 17.2, so newly available 2023-12 and widely available about 2026-06 (30 months later). Say "widely available since 2026-06". |
| Raise a critical async script with fetchpriority… | "Baseline newly available 2024-10-29" | Correct (web-features `fetch-priority`). |
| Keep inactive views with content-visibility:hidden… | "Baseline newly available 2024-09 for `hidden` (Safari 18)" | Correct (BCD `content-visibility.hidden`: Chrome 85, Firefox 125, Safari 18). |
| Treat IntersectionObserver callbacks as next-task… | "Baseline widely available (2019)" | Correct (low 2019-03-25, high 2021-09-25). |
| Split script evaluation…; Do not inline large blobs…; Do not build large DOM subtrees…; Avoid layout-forcing reads…; Put small inline head scripts above external stylesheets; preserveDrawingBuffer; Rendering drawer; Coverage panel | Guidance, spec or DevTools | No version claim to check. The "Avoid layout-forcing reads in pointer handlers" source is a blog or gist (label it that way). |

Stale version framing (gap 5): the current stable is Chrome 154 (2026-09-22), and Chrome 155 is due 2026-10-06 (chromiumdash). Apply this to 07:4, 07:373, 07:920 and 01:148. 06 was tested on Chromium 152. Re-check its `unload`/bfcache observations on 154.

---

## Sources read
- https://web.dev/blog/navigation-preload
- https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes
- https://developer.chrome.com/blog/service-worker-static-routing
- https://webkit.org/blog/18325/webkit-features-for-safari-27-0/
- https://webkit.org/blog/15865/webkit-features-in-safari-18-0/
- https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- https://drafts.csswg.org/css-contain-2/
- https://developer.mozilla.org/en-US/docs/Web/API/Element/contentvisibilityautostatechange_event
- https://github.com/web-platform-tests/wpt/blob/master/css/css-contain/content-visibility/content-visibility-auto-state-changed-first-observation.html
- raw/bcd.json (BCD 8.1.2, build 2026-09-17), raw/web-features.json
- https://github.com/ChromeDevTools/chrome-devtools-mcp at commit 069ab27: src/McpPage.ts, src/McpContext.ts, src/devtools/DevtoolsUtils.ts, src/tools/performance.ts, src/tools/css.ts, src/tools/categories.ts, src/tools/tools.ts, src/processors/PerformanceTrace.ts, src/processors/ChunkedTraceParser.ts, src/config/mcp-options.ts, docs/tool-reference.md, docs/configuration.md, CHANGELOG.md
- https://registry.npmjs.org/chrome-devtools-mcp
- https://github.com/ChromeDevTools/devtools-frontend (main): front_end/core/sdk/DebuggerModel.ts, front_end/panels/timeline/TimelineController.ts, front_end/models/trace/types/TraceEvents.ts, front_end/models/ai_assistance/data_formatters/PerformanceTraceFormatter.ts
- https://v8.dev/docs/wasm-compilation-pipeline
- https://chromium.googlesource.com/v8/v8/+/HEAD/docs/wasm/architecture.md
- https://chromium.googlesource.com/v8/v8/+/HEAD/src/inspector/v8-debugger.cc
- https://chromium.googlesource.com/v8/v8/+/HEAD/src/wasm/wasm-engine.cc
- https://chromium.googlesource.com/v8/v8/+/HEAD/src/profiler/cpu-profiler.cc (grep only)
- https://developer.chrome.com/docs/web-platform/deprecating-unload
- https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=152 (and 153, 154, 155)
- https://web.dev/articles/bfcache
- verify/01-critical-rendering-path.verify.md, 01-critical-rendering-path.md, 01-critical-rendering-path.run2-new.md (local notes)
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/resampling/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/common-series-apis/drawing-point-markers/
- https://www.scichart.com/documentation/js/v5/2d-charts/axis-api/ranging-scaling/auto-range/
- https://www.scichart.com/documentation/js/v5/sitemap.xml
- https://www.scichart.com/llms.txt
- https://registry.npmjs.org/scichart and https://registry.npmjs.org/scichart/-/scichart-5.2.69.tgz (package.json; Charting/Visuals/createMaster.js, createSingle.js, sciChartInitCommon.js, SciChartSurfaceBase.js/.d.ts; Charting/Services/SciChartRenderer.js; Charting/Numerics/Resamplers/ExtremeResamplerHelper.js; Charting/Visuals/RenderableSeries/BaseRenderableSeries.js; Charting/Model/BaseDataSeries.js/.d.ts; Charting/Visuals/Axis/AxisBase2D.js; Charting/Visuals/PointMarkers/BasePointMarker.js; Core/ObserveVisibility.js; types/AutoRange.d.ts; Charting/Numerics/CoordinateCalculators/CoordinateCalculatorBase.d.ts)
- https://data.jsdelivr.com/v1/packages/npm/scichart@6.0.0-alpha.197?structure=flat, https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.197/package.json
- https://html.spec.whatwg.org/multipage/webappapis.html#import-maps (raw/webappapis.txt), raw/spec-scripting.txt
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap
- https://web.dev/blog/import-maps-in-all-modern-browsers
- https://v8.dev/features/modules
- https://v8.dev/blog/code-caching-for-devs
- https://rolldown.rs/reference/Interface.RolldownOptions
- https://web.dev/articles/rendering-on-the-web
- https://web.dev/articles/client-side-rendering-of-html-and-interactivity
- https://svelte.dev/docs/kit/page-options
- https://svelte.dev/docs/svelte/$effect, https://svelte.dev/docs/svelte/$derived, https://svelte.dev/docs/svelte/@attach, https://svelte.dev/docs/svelte/each, https://svelte.dev/docs/svelte/$state
- https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent
- https://dom.spec.whatwg.org/ (textContent and set text content)
- https://developer.mozilla.org/en-US/docs/Web/CSS/table-layout
- https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric
- https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing
- https://web.dev/articles/cls
- https://github.com/bklit/bklit-ui/blob/main/.agents/skills/bklit-studio-chart-performance/SKILL.md
- https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/shape-rendering
- https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/vector-effect
- https://developer.chrome.com/blog/hardware-accelerated-animations
- https://github.com/facebook/astryx/issues/6473
- https://github.com/GoogleChrome/web.dev/issues/3790
- https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/binaryType
- https://developer.mozilla.org/en-US/docs/Web/API/EventSource
- https://developer.mozilla.org/en-US/docs/Web/API/WebTransport
- https://websockets.spec.whatwg.org/
- https://html.spec.whatwg.org/multipage/server-sent-events.html
- https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
- https://raw.githubusercontent.com/openai/plugins/main/plugins/build-web-data-visualization/skills/dashboards-and-real-time-visualization/references/performance-and-degradation.md
- https://w3c.github.io/long-animation-frames/
- https://developer.chrome.com/docs/css-ui/animate-to-height-auto
- https://developer.mozilla.org/en-US/docs/Web/CSS/interpolate-size
- https://developer.mozilla.org/en-US/docs/Web/CSS/::details-content
- https://developer.mozilla.org/en-US/docs/Web/CSS/image/image-set
- https://web.dev/articles/optimize-lcp
- mdn/content raw Markdown for Web/Performance/Guides: Animation_performance_and_frame_rate, Fundamentals, How_long_is_too_long, Navigation_and_resource_timings, Optimizing_startup_performance, Performance_budgets, Rum-vs-Synthetic, Understanding_latency
- https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/decodingInfo
- https://developer.mozilla.org/en-US/docs/Web/API/Reporting_API
- https://web.dev/blog/common-misconceptions-lcp
- https://web.dev/articles/module-workers
- https://developer.chrome.com/docs/workbox/precaching-dos-and-donts
- https://developer.chrome.com/docs/web-platform/implementing-speculation-rules
- https://developer.chrome.com/docs/workbox/faster-multipage-applications-with-streams
- https://web.dev/articles/optimize-cls
- https://developer.chrome.com/docs/devtools/performance/reference
- https://perfetto.dev/docs/getting-started/chrome-tracing
- https://perfetto.dev/docs/getting-started/other-formats
- https://chromium.googlesource.com/chromium/src/+/HEAD/base/trace_event/builtin_categories.h

## Not covered / could not access
- The size of the Wasm tier-down under chrome-devtools-mcp was not measured. The item rests on source reading only. I did not run SciChart with and without MCP attached.
- The SciChart blog "Nanosecond precision … 64-bit" returned 403 in WebFetch, and direct curl of scichart.com hits a Cloudflare challenge. The SciChart docs were read only through WebFetch summaries. No SciChart doc on WebGL context loss, workers or tree-shaking was found. Those items come from the 5.2.69 package source.
- SciChart.JS.Examples GitHub repo and the SciChart changelog were not read.
- https://www.patterns.dev/react/progressive-hydration (blog) was not read. web.dev "Rendering on the web" covered progressive and partial hydration.
- web.dev/articles/precaching-dos-and-donts returns 404. The article moved to developer.chrome.com/docs/workbox (read).
- The Philip Walton "Cascading cache invalidation" article was only seen in search results and not read. Rolldown's docs and v8.dev were used instead.
- The Chromium trace category of the `GPUTask` event was not located, so it is not verified that MCP's default categories include the GPU track. This is an inference from the shared `DefaultCategories`.
- The conflict about SVG transform compositing (Chrome blog 2021 against the 2026 astryx measurement) is not resolved. No current Chromium source was read.
- No primary benchmark was found for binary frames against JSON at high message rates.
- The MDN Media Capabilities overview page, MDN Resource Timing (Timing-Allow-Origin) and the Reporting API header pages were not read beyond the pages listed.
- The MDN Web/Performance/Guides index was not fetched again. The 8 guides named by the critic were read from mdn/content.
- The Chrome status of composited `background-color` animations was not checked (the price-flash advice uses opacity for this reason).
