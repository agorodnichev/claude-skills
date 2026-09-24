# Verify: 14-devtools-mcp-and-webmcp.md

Checked 2026-09-23. Sources used:
- npm registry: `chrome-devtools-mcp` `latest` = **1.10.1** (published 2026-09-23 10:42 UTC). 1.10.0 was published the same day (09:55 UTC). The notes are written against 1.9.0 (2026-09-08).
- The released 1.10.1 tarball (`build/`, `skills/`, `bundled-packages.json`: Lighthouse 13.4.1, puppeteer-core 25.11.0) and the repo `main` sources and docs (CHANGELOG, `docs/*.md`, `src/tools/*.ts`, `src/McpPage.ts`, `src/McpContext.ts`, `src/McpResponse.ts`, `src/config/*.ts`, `src/processors/PerformanceTrace.ts`, skills).
- The tool schemas that this session loaded live from the installed server (`emulate`, `list_network_requests`, `list_console_messages`, `evaluate_script`, `execute_webmcp_tool`, `get_css_styles`, `performance_start_trace`, `navigate_page`, `new_page`, `take_heapsnapshot`). This session now has `get_css_styles`, so its server is 1.10.x.
- devtools-frontend `main`: `models/trace/Processor.ts`, all 19 `insights/*.ts`, `ai_assistance/data_formatters/PerformanceTraceFormatter.ts` and `PerformanceInsightFormatter.ts`. The bundled DevTools tracing categories were read in the 1.10.1 build.
- WebMCP spec `index.bs` (last commit 2026-09-17; no newer commits), `declarative-api-explainer.md`, `implementation-status.md`, the commit history, the CDP `WebMCP.pdl`, Puppeteer PR #15069 and the guide, ChromeStatus API (feature 5117755740913664), api.webstatus.dev, BCD 8.1.2 (`raw/verify/02/bcd.json`).
- Chromium `main`: `runtime_enabled_features.json5` (WebMCP), `permissions_policy_features.json5` (`tools`), `navigation_request.cc`, `frame_loader.cc`, devtools `page_handler.cc` (Page.reload).
- developer.chrome.com pages (WebFetch): WebMCP overview, imperative API (last updated 2026-09-21), best practices, secure tools, DevTools WebMCP pane, DevTools-for-agents get-started, autoConnect blog, grounded-real-world blog. Lighthouse `throttling.md` and `variability.md`. web.dev vitals and service-worker lifecycle. MDN invokerType.

Raw files are in `raw/verify/14/` (84 files: `cdm1101/` is the extracted 1.10.1 package, `src_*`, `docs_*`, `dtf_*`, `webmcp_*`, `cr_*`, `ws-*.json`, `cs-webmcp.json`, `pptr-*`, `lh-*`, and the grep helper `g.sh`).

## Summary

| Verdict | Count |
|---|---|
| Items checked (`### ` headings) | 39 |
| verified | 28 |
| corrected | 11 |
| disputed | 0 |
| unverified | 0 (a few sub-claims are marked unverified inside items) |

Header and Part 1 tool table (these are not `### ` items, but they are stale):
1. **Version.** The Scope line says npm `chrome-devtools-mcp` 1.9.0 (2026-09-08). Current is **1.10.1 (2026-09-23)**. All behavior that the items use (trace flow, 5 s auto-stop, one stored trace, emulation reset, formatter output, WebMCP handler) is unchanged in the 1.10.1 build.
2. **`get_css_styles` is not "doc only".** It was added in 1.10.0 ("add get_css_style tool", #2612; default `pageIdx` 0 and `pageSize` 10, #2799). The note in "Not covered" is wrong: "The session's server build is older than 1.9.0 docs (it lacks `get_css_styles`)". No release before 1.10.0 had the tool. The docs on `main` showed it before the release.
3. **The comments tools are gated.** `open_devtools`, `get_devtools_comments`, `resolve_devtools_comment` and `reveal_in_devtools` load only with the hidden flag `--devtoolsComments` (default false, "Internal WIP feature."). Sources: `build/src/tools/tools.js` and `build/src/config/mcp-options.js` in 1.10.1.
4. **A new memory tool on `main`, not released.** `analyze_heapsnapshot_contexts` (needs `--memoryDebugging`) is in `docs/tool-reference.md` and `src/tools/memory.ts` on `main`, but it is not in the 1.10.1 build.
5. **Open points in "Not covered" that are now closed:**
   - Flags. Blink defines the runtime feature `WebMCP` as `implied_by: ["WebMCPDeclarativeFileInput", "WebMCPFormAssociatedCustomElements", "WebMCPTesting"]`. So `--enable-features=WebMCP` and `--enable-features=WebMCPTesting` both turn on the API.
   - `initScript`. It does **not** apply to the internal reload of `performance_start_trace`. `navigate_page` removes the script after its own navigation (`removeScriptToEvaluateOnNewDocument` in a `finally` block).
   - `SlowCSSSelector`. It can never be listed in an MCP trace. MCP turns on only the `JsSampling` and `Screenshot` optional categories. `CssSelectorStats` (`disabled-by-default-blink.debug`) stays off, so the insight state is `pass`, and the summary skips insights in the `pass` state.

Most important corrections:
1. **Cold-cache recipe.** `new_page` always loads its `url` (`goto`). So "new `isolatedContext` + `performance_start_trace` `reload: true`" records a **warm** second load. Also, `ignoreCache` reload **does** bypass the service worker. In Chromium, a CDP `Page.reload({ignoreCache: true})` becomes `RELOAD_BYPASSING_CACHE`, which sets `skip_service_worker = true`.
2. **The playbook loses its setup state.** Fixtures that `load_fixture_data` loads before a `reload: true` trace are gone after the reload. Also, `emulate` with `,mobile`/`,touch` can reload the page: Puppeteer reloads when `isMobile` or `hasTouch` changes.
3. **`--allowUnrestrictedPaths` is deprecated.** The source says "Use --workspace=/ instead." Paths outside the roots are refused, so relative `traces/...` paths need client roots or `--workspace`.
4. **The `debugging` annotation is "available from Chrome 156"** (Chrome imperative-API doc, updated 2026-09-21). This explains why Chrome 153 did not return it. CDP `WebMCP.Annotation` now has `consequential` and `debugging`.
5. **The leak recipe uses three snapshots.** The official skill takes baseline, target (after the actions) and final (after revert) snapshots, and compares **baseline with target**. The memory analysis tools shipped in 1.2.0-1.8.0 (2026-06-08 to 2026-08-25), not in "2026-04 to 2026-08 (0.21-1.8)".

---

### Performance insight names (for `performance_analyze_insight`)
- Verdict: verified
- Evidence details:
  - `Models.ts` on `main` exports exactly these 19 insights.
  - Each title and `InsightCategory` matches the table. FontDisplay, DOMSize, Viewport and INPBreakdown are `INP`. DocumentLatency, LegacyJavaScript, ThirdParties, Cache, CharacterSet, ForcedReflow and SlowCSSSelector are `ALL`. The rest are `LCP`, and CLSCulprits is `CLS`.
  - The CLS culprit strings are "Injected iframe", "Web font", "Animation" (non-composited failures) and "Unsized image element".
  - The CharacterSet check is "meta charset tag in the first 1024 bytes … or in the Content-Type HTTP response header".
  - The summary lists only insights whose `state !== 'pass'` and that `PerformanceInsightFormatter` supports. The formatter supports all 19.
  - Upgrade for the SlowCSSSelector row: it is never listed in MCP (see header point 5). The insight's own text says "CSS selector stats need to be enabled in the Performance panel settings."
  - The observed header lines match the code: `CPU throttling: ${n}x` (rate 1 prints "1x") and `Network throttling: ${… ?? 'none'}`.
- Evidence: https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/insights/Models.ts , https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/ai_assistance/data_formatters/PerformanceTraceFormatter.ts , https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/insights/SlowCSSSelector.ts , raw/verify/14/cdm1101/package/build/src/third_party/index.js (`OptionalCategories`)

### Navigate first, then trace the load with `reload: true`
- Verdict: verified
- Evidence details:
  - `performance.ts` (main and the 1.10.1 build) does these steps in order: store `pageUrlForTracing = page.url()`, `goto('about:blank', {waitUntil:'load'})`, start tracing, `goto(pageUrlForTracing, {waitUntil:['load']})`, then `setTimeout(5_000)` and stop.
  - The error text is "Only one trace can be running at any given time."
  - `reload` and `autoStop` both default to true (live schema).
  - The `debug-optimize-lcp` skill uses the same steps: `navigate_page`, then `performance_start_trace` with `reload: true` and `autoStop: true`.
  - Only the Status version is stale (the flow is the same in 1.10.1).
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/performance.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/debug-optimize-lcp/SKILL.md

### Analyze every insight you need before the next trace starts
- Verdict: verified
- Evidence details:
  - `McpContext.storeTraceRecording()` runs `this.#traceResults = []` and then pushes the new result. The analyze tool reads `context.recordedTraces().at(-1)`.
  - Set ids are `NAVIGATION_${this.#insights.size}` or `NO_NAVIGATION` (Processor.ts).
  - The error texts are "No Insight with the name … found" and "No Performance Insights for the given insight set id."
  - Extra fact: soft navigations (`isSoftNavigationStart`) also create `NAVIGATION_n` sets.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/McpContext.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/processors/PerformanceTrace.ts , https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/Processor.ts

### Decide cold or warm cache for every load trace, and say which one you used
- Verdict: corrected
- Correction:
  - (1) **The fresh-context option does not give a cold trace as written.** `new_page` has a required `url` and runs `page.goto(url)` right away. So `new_page(url, isolatedContext)` followed by `performance_start_trace {reload:true}` traces the second load in that context, which is warm. The cold recipe with a fresh context is:
    1. `new_page {url:"about:blank", isolatedContext:"run-N"}`.
    2. `emulate` on the new `pageId`. Emulation is stored per page (`McpPage.emulationSettings`), so a new page starts unthrottled.
    3. `performance_start_trace {reload:false, autoStop:false}`.
    4. `navigate_page {type:"url", url}`.
    5. Wait for ready, then `performance_stop_trace`.
  - (2) **Replace the caveat "Service-worker caches are not bypassed by an HTTP cache bypass".** For the `ignoreCache` reload recipe, the service worker **is** bypassed. Puppeteer `reload({ignoreCache})` becomes CDP `Page.reload` with `ignoreCache`. `PageHandler::Reload` maps that to `ReloadType::BYPASSING_CACHE`. `NavigationRequest` then sets `load_flags |= LOAD_BYPASS_CACHE` and `skip_service_worker = true` ("Shift-Reload forces bypassing caches and service workers"). The page is not controlled by a service worker for that load (web.dev: "If you force-reload the page (shift-reload) it bypasses the service worker entirely").
  - (3) Add a caveat: neither recipe closes open connections (in the `ignoreCache` recipe) or clears DNS caches. So TTFB can be lower than on a true first visit.
  - The tool parameters are verified (`ignoreCache`, `isolatedContext`, and `type` = `url`/`back`/`forward`/`reload`).
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/pages.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/McpPage.ts , https://source.chromium.org/chromium/chromium/src/+/main:content/browser/renderer_host/navigation_request.cc , https://source.chromium.org/chromium/chromium/src/+/main:content/browser/devtools/protocol/page_handler.cc , https://web.dev/articles/service-worker-lifecycle

### Set all emulation options in one `emulate` call, then confirm them in the trace header
- Verdict: corrected
- Correction:
  - The main claim is verified. In `McpPage.emulate()`, an omitted `networkConditions` calls `emulateNetworkConditions(null)`, and an omitted `cpuThrottlingRate` sets the rate to 1. `userAgent`, `colorScheme` and `viewport` are also reset. The summary prints `page.cpuThrottlingRate` and `networkConditions` as they are at **stop** time.
  - Fix the overgeneralization "each option that you omit is reset":
    - `extraHttpHeaders` is **not** reset when omitted. It changes only when it is passed ("persist across navigations until cleared"; pass `""` to clear).
    - An omitted `geolocation` is set to `{latitude: 0, longitude: 0}`, not removed.
  - Add a caveat: a call that changes the `mobile` or `touch` flags of `viewport` can **reload the page** (Puppeteer `EmulationManager`: `reloadNeeded = #emulatingMobile !== mobile || #hasTouch !== hasTouch`; docs: "setting viewport will reload the page in order to set the isMobile or hasTouch properties"). Call `emulate` before page setup (fixtures and `wait_for`), not after.
  - The Avoid lines are verified: the error text is "Network throttling is not supported when network blocking (allowlist/blocklist) is configured.", and `updateTimeouts()` multiplies by the CPU and network factors.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/McpPage.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/emulation.ts , https://github.com/puppeteer/puppeteer/blob/main/docs/api/puppeteer.page.setviewport.md , https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/cdp/EmulationManager.ts

### Use named throttling profiles that match Lighthouse and DevTools presets
- Verdict: verified
- Evidence details:
  - Lighthouse `throttling.md`: "Latency: 150ms", "Throughput: 1.6Mbps down / 750 Kbps up", "a constant 4x CPU multiplier". The multiplier table row for high-end desktop gives "4x (2-10)" for mid-tier mobile and "10x (5-20)" for low-end mobile.
  - Puppeteer `PredefinedNetworkConditions.ts`:
    - `Slow 4G` = `Fast 3G` = 1.6 Mbps × 0.9 down, 750 Kbps × 0.9 up, latency 150 × 3.75. The comment says "alias to Fast 3G".
    - `Fast 4G` = 9 Mbps × 0.9, latency 60 × 2.75 = 165 ms.
    - `Slow 3G` = 500 Kbps × 0.8, latency 400 × 5 = 2000 ms.
  - The MCP `lighthouse_audit` mobile setting is 412×823 at DSF 1.75.
  - CPU calibration: "Starting in Chrome 134, DevTools includes CPU throttling calibration".
  - Caveat to add: Lighthouse **defaults to simulated throttling** ("Simulated throttling remains the default setting"). MCP uses request-level (DevTools) throttling. So MCP numbers use the same presets but do not match Lighthouse or PageSpeed Insights scores.
- Evidence: https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md , https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/cdp/PredefinedNetworkConditions.ts , https://developer.chrome.com/blog/devtools-grounded-real-world , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/lighthouse.ts

### Do not trust CPU throttling for WebGL/WebGPU chart frame times
- Verdict: verified
- Evidence details:
  - The blog (published 2025-04-04) says:
    - "calibrated 'mid-tier mobile' CPU throttling preset (3.7x on this development machine)"
    - "taking 270 milliseconds" locally against "taking 620 milliseconds" on the phone
    - "DevTools CPU throttling doesn't touch the GPU process"
    - "a separate throttling thread that interrupts and suspends the tab's main thread"
  - The probe code uses current API names. `GPUAdapterInfo.isFallbackAdapter` is in Chrome 136+ (BCD 8.1.2). The old `GPUAdapter.isFallbackAdapter` was removed after Chrome 140, and the code does not use it.
- Evidence: https://developer.chrome.com/blog/devtools-grounded-real-world , raw/verify/02/bcd.json (`api.GPUAdapterInfo.isFallbackAdapter`, `api.GPUAdapter.isFallbackAdapter`)

### Test canvas cost at DPR 1, 2, and 3 with the `viewport` string
- Verdict: verified
- Evidence details:
  - The viewport format is `'<width>x<height>x<devicePixelRatio>[,mobile][,touch][,landscape]'` (live schema). `McpPage.emulate()` merges it with the default `deviceScaleFactor: 1` and calls `setViewport`.
  - `resize_page` takes only `width` and `height`.
  - Note: keep the same `mobile`/`touch` flags across the three runs. A change of those flags reloads the page (see the emulate item).
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/McpPage.ts

### Record interaction traces manually to get INP and its subparts
- Verdict: verified
- Evidence details:
  - The INPBreakdown UIStrings are "Input delay", "Processing duration" and "Presentation delay".
  - A live run in 15-gaps-round-2 part F confirmed the recipe. Chrome 153 reported "INP: 227 ms", split 0.6 ms / 200 ms / 26 ms.
  - Nuance to add: in an SPA, an interaction that starts a soft navigation can create a `NAVIGATION_n` insight set. Processor.ts handles `SoftNavigationStart`, and soft-navigation entries shipped in Chrome 151 (webstatus). So use the set id from the summary, as the item already says, and do not assume `NO_NAVIGATION`.
- Evidence: https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/insights/INPBreakdown.ts , https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/Processor.ts , https://api.webstatus.dev/v1/features/soft-navigations , 15-gaps-round-2.md:561-571

### Use the INP threshold and the lab proxy correctly
- Verdict: verified
- Evidence details:
  - web.dev "Last updated 2024-10-31": LCP 2.5 s, INP 200 ms, CLS 0.1, all at p75. The page says "Tools like Lighthouse … cannot measure INP" and "TBT … is a proxy for INP".
  - The MCP summary prints only LCP (and its subparts), INP and CLS. There is no FCP or TBT (`formatTraceSummary`).
  - webstatus: event-timing and largest-contentful-paint are Baseline "newly" since 2025-12-12 (Safari 26.2).
  - Small note: a sum of LoAF `blockingDuration` is not the Lighthouse TBT definition (TBT is long tasks between FCP and TTI). "TBT-like" is fair.
- Evidence: https://web.dev/articles/vitals , https://api.webstatus.dev/v1/features/event-timing , https://api.webstatus.dev/v1/features/largest-contentful-paint

### Read Long Animation Frame data with `evaluate_script` to attribute jank to scripts
- Verdict: verified
- Evidence details:
  - The six `invokerType` values match MDN.
  - LoAF is Chrome/Edge 123 and webstatus "limited".
  - The buffer holds 200 entries (same as 07-js-web-apis.md:713).
  - Script attribution applies to scripts over 5 ms (same as 06 and 07).
  - Note for the Avoid line: a `navigate_page` `initScript` is active only for that one navigation. The server removes it afterwards, so it does not cover the internal reload of `performance_start_trace` or later reloads. For load traces, `buffered: true` already replays entries from page start, so an early observer is needed only for sessions longer than 200 LoAFs.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceScriptTiming/invokerType , https://api.webstatus.dev/v1/features/long-animation-frames , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/pages.ts

### Read paint, navigation, and resource timing with `evaluate_script` because the network tools omit sizes and timings
- Verdict: verified
- Evidence details:
  - `NetworkFormatter.ts`: the list line is `reqid=${id} ${method} ${url} [${status}]`. The detail view has headers, bodies and the redirect chain, with no timing or size.
  - The skill really says `resourceTypes: ["Image", "Font"]`, while the schema enum is lowercase. The same skill step also asks for "Start Time", which the list output does not have.
  - `renderBlockingStatus` is Chromium-only (Chrome 107; BCD), which is fine for the test browser.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/formatters/NetworkFormatter.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/debug-optimize-lcp/SKILL.md

### Run the LCP skill order: breakdown first, then fix the largest delay subpart
- Verdict: verified
- Evidence details:
  - The skill table says TTFB "~40%", load delay "<10%", load duration "~40%" and render delay "<10%". It also has the pitfall "the saved time just shifts to render delay".
  - Precision: Step 2 of the skill lists LCPBreakdown, DocumentLatency, RenderBlocking and LCPDiscovery. The mapping by subpart, and the extra NetworkDependencyTree and ForcedReflow, are this file's own extension, not the skill's text.
  - A canvas is not an LCP candidate, so the canvas caveat holds.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/debug-optimize-lcp/SKILL.md

### Save raw traces and heap snapshots to files inside allowed roots
- Verdict: corrected
- Correction:
  - `--allowUnrestrictedPaths` is **deprecated** (`src/config/mcp-options.ts` and the 1.10.1 build: `deprecated: 'Use --workspace=/ instead.'`). Use client MCP roots, or `--workspace <dir>` (alias of `--filesystemRoot`; can be repeated; default "OS temp directory").
  - A path outside the roots is refused ("Access denied: path … is not within any of the configured workspace roots", live run in 15-gaps-round-2:589-595). So relative paths such as `traces/…` work only when the client announces the project as a root.
  - The CLI allows unrestricted paths by default ("The CLI enables unrestricted filesystem access by default").
  - The "Reference over Value" quote and `close_heapsnapshot` are verified.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/config/mcp-options.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/design-principles.md

### Find leaks with a baseline / repeat x10 / revert snapshot sequence
- Verdict: corrected
- Correction:
  - (1) **The official sequence uses three snapshots.** The skill says: "save `.heapsnapshot` files to disk at baseline, target (after actions), and final (after reverting actions) states". Then "Use `compare_heapsnapshots` to compare baseline and target snapshots". It starts without `classIndex`. The final snapshot is used to check that memory is released. It is not the compare input.
  - (2) Parameter names:
    - `compare_heapsnapshots` takes `baseFilePath`, `currentFilePath` and an optional `classIndex`.
    - `get_heapsnapshot_class_nodes` needs `filePath` and `id` (the class id from details), plus an optional `filterName`.
  - (3) Status: `take_memory_snapshot` came first in 0.18.0 (2026-02-24). The `--memoryDebugging` analysis tools came in 1.2.0 (2026-06-08, "memory debugging tools" #2169) to 1.8.0 (2026-08-25, `query_heapsnapshot_objects`). This is not "2026-04 to 2026-08 (0.21-1.8)".
  - (4) The claim "comparing after revert separates leaks from normal caches" is contested by 15-gaps-round-2.md:490: "A before/after snapshot pair cannot tell a leak from a warm cache. Growth per repetition can." Keep the snapshot compare to find the retainer, and prove a leak with the slope over N repetitions.
  - The four `filterName` values and the gating (`conditions: ['memoryDebugging']`; `take_heapsnapshot` is not gated) are verified.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/memory-leak-debugging/SKILL.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/memory.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/CHANGELOG.md

### Check the console after every run
- Verdict: corrected
- Correction:
  - "Messages reset on navigation" now applies only to cross-document navigations. 1.10.0 added "preserve console history across same-document navigations" (#2676). SPA route changes (`pushState`) keep the list.
  - 1.10.0 also bounds `ConsoleCollector` retention per navigation (#2773).
  - Verified: the `types` enum includes `error`, `warn` and `issue`. `includeStackTraces` came in 1.8.0. `includePreservedMessages` covers "the last 3 navigations". The README says "source-mapped stack traces".
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/CHANGELOG.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/README.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/console.ts

### Use `lighthouse_audit` for quality gates, not for performance
- Verdict: verified
- Evidence details:
  - The categories are `['accessibility','seo','best-practices','agentic-browsing']`, and the description says "This excludes performance".
  - Desktop is 1350×940 at DSF 1. Mobile is 412×823 at DSF 1.75.
  - Output formats are `['json','html']`.
  - Lighthouse 13.4.1 is still bundled in 1.10.1 (`bundled-packages.json`).
  - The defaults are `device: desktop` and `mode: navigation`.
  - 1.10.0 fixed the emulated UA and `finalDisplayedUrl` (#2795).
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/lighthouse.ts , raw/verify/14/cdm1101/package/build/src/third_party/bundled-packages.json

### Prefer `take_snapshot` for state, `take_screenshot` for visual proof
- Verdict: verified
- Evidence details:
  - The `take_screenshot` formats are png, jpeg and webp, with `quality` 0-100.
  - `--screenshotMaxWidth` and `--screenshotMaxHeight` exist ("downscaled (preserving aspect ratio)").
  - The trace categories include `TracingOptionalCategories.Screenshot`.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/performance.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/config/mcp-options.ts

### Run each comparison at least 3 times (prefer 5) and compare medians, one run at a time
- Verdict: verified
- Evidence details:
  - Lighthouse `variability.md`: "The median Lighthouse score of 5 runs is twice as stable as 1 run" and "DO NOT collect multiple Lighthouse reports at the same time on the same machine".
  - The CLI docs say "Headless is enabled by default. Isolated is enabled by default unless `--userDataDir` is provided", and page tools take `<pageId>` as the first positional argument.
- Evidence: https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md

### Give CrUX field data priority, and turn CrUX off for private URLs
- Verdict: verified
- Evidence details:
  - README: "Performance tools may send trace URLs to the Google CrUX API … run with the `--no-performance-crux` flag".
  - The option `performanceCrux` defaults to true.
  - The formatter text says "Best practice is to prioritize metrics that are bad in field data" and prints `scope: url|origin`.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/README.md , https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/ai_assistance/data_formatters/PerformanceTraceFormatter.ts

### Lock the test browser down before an agent drives it
- Verdict: verified
- Evidence details:
  - `allowedUrlPattern` "Requires Chrome 149+" and conflicts with `blockedUrlPattern`.
  - `redactNetworkHeaders` defaults to false.
  - The default profile is `$HOME/.cache/chrome-devtools-mcp/chrome-profile…`.
  - `autoConnect` is "(Chrome 144+)". The blog (2025-12-11) says Chrome shows a dialog for each remote debugging request, and the feature needs `chrome://inspect/#remote-debugging`.
  - README: "exposes content of the browser instance to the MCP clients".
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md , https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session , raw/verify/14/cdm1101/package/build/src/config/browser-options.js

### Install the DevTools-for-agents plugin to get the official perf skills
- Verdict: verified
- Evidence details:
  - Both commands appear on the get-started page (updated 2026-05-13) and in `docs/client-configurations.md`.
  - The marketplace name is `chrome-devtools-plugins` (version 1.10.1).
  - The 1.10.1 package ships exactly these skills: `a11y-debugging`, `chrome-devtools`, `chrome-devtools-cli`, `cookie-debugging`, `debug-optimize-lcp`, `memory-leak-debugging` and `troubleshooting`.
- Evidence: https://developer.chrome.com/docs/devtools/agents/get-started , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/client-configurations.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/.claude-plugin/marketplace.json

### Expose DevTools-only debug hooks with third-party developer tools when agents outside DevTools must not see them
- Verdict: verified
- Evidence details:
  - The doc names the `devtoolstooldiscovery` event on `window`, `event.respondWith()` with a `ToolGroup` (`name`, `description`, `tools`), `window.__dtmcp.executeTool()` inside `evaluate_script`, and the flag `--categoryExperimentalThirdParty=true`.
  - The CHANGELOG has "support third-party developer tools" (#1982) in 0.25.0 (2026-05-06).
  - Caveat to add: this is not a security boundary. Any main-world script can dispatch the event. The doc says the tools "can only execute code that an attacker would already be able to run on that page".
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/third-party-developer-tools.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/CHANGELOG.md

### Status as of 2026-09-22
- Verdict: corrected
- Correction: The table rows are correct except the three points below.
  - Verified rows:
    - `Status: CG-DRAFT`.
    - `partial interface Document { [SecureContext, SameObject] readonly attribute ModelContext modelContext; }`. The move was spec commit 2026-05-27 (#184).
    - `provideContext`/`clearContext` removed 2026-03-05 (#132).
    - Puppeteer PR #15069 (merged 2026-06-22) says "Switch to `document.modelContext`" and "Remove `unregisterTool` call which was removed in Chrome 148".
    - ChromeStatus: "Proposed", dev trial 146, OT stage 149-156 on desktop and Android.
    - Edge 150 OT, ChatGPT Desktop and Brave Leo (implementation-status.md).
    - Mozilla neutral and WebKit oppose with the listed concerns. webstatus is "limited" for both `document-modelcontext` and `declarative-webmcp`.
  - Fixes:
    - (1) Add to "Chrome behavior changes": **Chrome 156: `debugging` annotation** ("available from Chrome 156", imperative-API doc, last updated 2026-09-21). The doc gives no milestone for `consequentialHint`. CDP `WebMCP.Annotation` now has `readOnly`, `untrustedContent`, `consequential`, `debugging` and `autosubmit` (protocol roll 2026-09-19).
    - (2) The status enum is `Completed | Canceled | Error` (CDP `InvocationStatus`). Write "Error", not "error".
    - (3) The API-surface paragraph says "spec IDL", but the declarative part (`toolname`, `SubmitEvent.agentInvoked/respondWith`, `:tool-form-active`) comes from `declarative-api-explainer.md`. It is not in `index.bs`. Also, `executeTool` takes a `RegisteredTool` dictionary (from `getTools()`), not a name, and returns `Promise<DOMString>`.
  - Still unverified: the Chrome milestone that removed the `navigator.modelContext` alias. Secondary sources only say "deprecated in Chrome 150 and removed in 152".
  - Add: Blink's `WebMCP` runtime feature has `origin_trial_allows_third_party: true`. Third-party OT tokens are accepted.
- Evidence: https://github.com/webmachinelearning/webmcp/blob/main/index.bs , https://github.com/webmachinelearning/webmcp/commits/main , https://github.com/puppeteer/puppeteer/pull/15069 , https://chromestatus.com/feature/5117755740913664 , https://developer.chrome.com/docs/ai/webmcp/imperative-api , https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/WebMCP.pdl , https://api.webstatus.dev/v1/features/document-modelcontext , https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/platform/runtime_enabled_features.json5

### Register perf hooks as WebMCP tools only in development builds
- Verdict: verified
- Evidence details:
  - Spec mitigation: "Site authors can deliver a `Permissions-Policy: tools=()` response header … This defense applies to every descendant frame … The user agent enforces this before script runs". The Chrome overview says WebMCP "respects the `tools` Permissions Policy".
  - Caveat to add: in Chromium, the `tools` policy feature has `depends_on: ["WebMCP"]` (an OT-gated runtime feature). Chrome treats the header entry as not enabled when the page has no WebMCP. Expect a console warning in production.
  - Unverified: the item says "even an injected one". It was not verified whether the header still blocks registration after an injected script enables WebMCP later with a third-party OT token (allowed for this trial). Treat the header as defense in depth. The dev-only build is the main control.
- Evidence: https://github.com/webmachinelearning/webmcp/blob/main/index.bs (#mitigation-disable-permissions-policy) , https://developer.chrome.com/docs/ai/webmcp , https://source.chromium.org/chromium/chromium/src/+/main:services/network/public/cpp/permissions_policy/permissions_policy_features.json5

### Design hook tools as small, read-mostly, bounded functions with compact outputs
- Verdict: verified
- Evidence details:
  - Secure-tools (last updated 2026-09-01) gives these budgets:
    - "500 characters per tool description"
    - "150 characters per parameter description"
    - "30 characters per tool name and parameter name"
    - "1.5K character limit per individual tool output"
  - Best-practices (last updated 2026-05-18) says "Each tool should consist of a single function" and "subject to change".
  - The example code matches the spec signatures `registerTool(tool, {signal})` and `execute(input, {signal})`.
  - Notes:
    - The "subject to change" quote is on the best-practices page, not the 2026-09-01 page.
    - The code comment names "SciChart.js v4". SciChart 5.2.69 is current and has the same events.
    - `renderedToDestination` fires only for non-copy (`createSingle`) surfaces (verify/13). So `app.nextPaint()` on `painted` is the right choice for `SciChartSurface.create()` terminals.
- Evidence: https://developer.chrome.com/docs/ai/webmcp/secure-tools , https://developer.chrome.com/docs/ai/webmcp/best-practices , verify/13-scichart.verify.md:215-238

### Keep hook execution out of the measured window
- Verdict: verified
- Evidence details: the spec queues the tool execute steps on the webmcp task source ("Queue a global task on the webmcp task source given |targetWindow| to run the tool …"). So a tool call runs on the page event loop, inside the trace.
- Evidence: https://github.com/webmachinelearning/webmcp/blob/main/index.bs

### Abort the old registration before you register again (HMR and remounts)
- Verdict: verified
- Evidence details:
  - `registerTool` step order:
    1. Not fully active: `InvalidStateError`.
    2. Not origin-keyed and not `file:`: `SecurityError`.
    3. `tools` policy not allowed: `NotAllowedError`.
    4. Name already exists: `InvalidStateError`.
    5. Name empty, longer than 128, or a code point outside ASCII alphanumeric, `_`, `-` and `.`: `InvalidStateError`.
    6. Empty description: `InvalidStateError`.
  - The abort steps unregister synchronously, so an immediate re-register with the same name succeeds.
  - Notes:
    - Add `SecurityError` to the Why line.
    - If you abort before the queued resolve task runs, the promise rejects with the abort reason. The example's `.catch` then logs a harmless warning.
    - The Chrome doc date is now 2026-09-21. It was 2026-09-11 when the notes were written. "As of Chrome 153, you can unregister a tool without cancelling and breaking in-flight executions" is verified.
- Evidence: https://github.com/webmachinelearning/webmcp/blob/main/index.bs , https://developer.chrome.com/docs/ai/webmcp/imperative-api

### Feature-detect `document.modelContext` and never depend on it for app behavior
- Verdict: verified
- Evidence details:
  - Spec IDL is on `Document`, with `[SecureContext]`.
  - Puppeteer #15069 switched to `document.modelContext`.
  - The Chrome imperative doc uses `document.modelContext`.
- Evidence: https://github.com/puppeteer/puppeteer/pull/15069 , https://developer.chrome.com/docs/ai/webmcp/imperative-api

### Drive hooks from the agent with `list_webmcp_tools` and `execute_webmcp_tool`
- Verdict: corrected
- Correction:
  - (1) **The flag conflict in the Avoid line is resolved:**
    - The server flag is `--categoryExperimentalWebmcp`. `ToolCategory.WEBMCP = 'experimentalWebmcp'`, and it is off by default. `docs/configuration.md` now documents it as "Requires Chrome 150+ with the following flag: `--enable-features=WebMCP`".
    - `--categoryWebMCP` (DevTools pane doc, 2026-05-12) does not exist in the source.
    - In Blink, `WebMCPTesting` implies `WebMCP`, so `--enable-features=WebMCPTesting` also works.
    - The Puppeteer guide now says "Chrome 151+". PR #15069 said 150+.
  - (2) Status: the two tools came in 0.22.0, **released 2026-04-21** (#1845, #1873). The date is not 2026-04-16.
  - (3) The status enum is `Completed | Canceled | Error`.
  - Verified: the handler does `JSON.parse(input)`, rejects values that are not objects, runs `page.webmcp.tools().find(t => t.name === toolName)` and `tool.execute(input)`, and prints `{status, output, errorText}`. The `navigate_page`, `new_page` and `select_page` responses add the "## WebMCP tools" section only when the category is on.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/webmcp.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/categories.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md , https://github.com/puppeteer/puppeteer/blob/main/docs/guides/webmcp.md , https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/platform/runtime_enabled_features.json5 , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/CHANGELOG.md

### Treat every hook as reachable by any agent or extension on the page, and keep it harmless
- Verdict: corrected
- Correction:
  - Replace "Chrome 153 did not return it (observed)" with this: Chrome documents `debugging` as "available from Chrome 156". Chrome 153 cannot return it.
  - `consequentialHint` has no documented Chrome milestone. The spec added it on 2026-09-03 (#217), and CDP carries `consequential` now. Re-check `getTools()` on Chrome 155+ before you rely on it.
  - The rest is verified:
    - Secure-tools: "Chrome Extensions can query and execute WebMCP tools using content scripts".
    - The spec has sections "Prompt Injection Attacks", "Misrepresentation of Intent" and "Privacy Leakage Through Over-Parameterization".
    - CDP marks tool output as "untrusted and poses a prompt injection risk".
- Evidence: https://developer.chrome.com/docs/ai/webmcp/imperative-api , https://developer.chrome.com/docs/ai/webmcp/secure-tools , https://github.com/webmachinelearning/webmcp/blob/main/index.bs , https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/WebMCP.pdl

### Use declarative form tools only for simple dev settings panels
- Verdict: verified
- Evidence details:
  - The explainer names `toolname`, `tooldescription`, `toolautosubmit` and `toolparamdescription`.
  - It defines `SubmitEvent` with `readonly attribute boolean agentInvoked; undefined respondWith(Promise<any> agentResponse);` and says "the `preventDefault()` must be called before this method is called".
  - It defines `:tool-form-active` and `:tool-submit-active`.
  - It says the schema synthesis "is TBD" (`anyOf`, `oneOf`). A change of `toolname` or `tooldescription` cancels in-flight calls.
  - webstatus `declarative-webmcp` is "limited".
- Evidence: https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md , https://api.webstatus.dev/v1/features/declarative-webmcp

### Inspect hooks with the DevTools WebMCP pane before you automate them
- Verdict: corrected
- Correction:
  - The pane facts are verified. The page (last updated 2026-05-12) describes it as Application > WebMCP, with "A live list of all WebMCP tools" and invocation counters, an "Invoked Tools" log (status, input, output), schema validation errors, and manual runs with edited input.
  - Fix the Avoid line. The inspector extension does not send prompts to Gemini "by default". Its repo describes it as a tool to "inspect, monitor, and execute WebMCP tools manually or with Gemini". Gemini is used only when you supply a Gemini API key. Then your prompt and the page's tool definitions and outputs go to the Gemini API. Manual execution sends nothing.
  - The Chrome overview says the extension "is separate from the Gemini in Chrome features".
- Evidence: https://developer.chrome.com/docs/devtools/application/webmcp , https://github.com/beaufortfrancois/model-context-tool-inspector , https://developer.chrome.com/docs/ai/webmcp

### 0. Prepare (once per session)
- Verdict: corrected
- Correction:
  - Add `--workspace=<project>/.perf` (alias `--filesystemRoot`), or make sure the client announces the project root. Without that, every `filePath: "traces/…"` in steps 1-3 is refused.
  - Add `--categoryExperimentalWebmcp` only together with `--chromeArg=--enable-features=WebMCP` (or `WebMCPTesting`). Do not use `--allowUnrestrictedPaths`, which is deprecated.
  - The other flags are verified: `--memoryDebugging`, `--no-performance-crux`, and `--allowedUrlPattern` (Chrome 149+).
  - `navigator.userAgentData.getHighEntropyValues(['fullVersionList'])` is Chromium-only (Chrome 90+), which is fine for the test browser.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/config/mcp-options.ts , 15-gaps-round-2.md:589-595 , raw/verify/02/bcd.json

### 1. Baseline (before the code change)
- Verdict: corrected
- Correction:
  - (1) Step 3 ("Setup outside the trace: `execute_webmcp_tool load_fixture_data`") does not work with the load trace in step 4 (`reload: true`). The trace goes to `about:blank` and reloads the page, so the in-memory fixture is lost. For load traces, the page must choose the fixture at boot (for example with a dev-only URL parameter or env value in the URL that you navigate to). Use `load_fixture_data` only before manual interaction and render-loop traces.
  - (2) Call `emulate` before `wait_for` and the setup steps. An `emulate` call that changes `,mobile`/`,touch` can reload the page (Puppeteer), so any earlier `wait_for` or setup is lost.
  - (3) The "cold" choice in the profile table needs the corrected recipe from the cold/warm item: `new_page` with `about:blank` + `emulate` + manual trace + `navigate_page`, or a manual trace around `navigate_page {type:"reload", ignoreCache:true}`. "Fresh `isolatedContext`" with `reload:true` is warm.
  - The other steps are verified: the header check, the insight calls, the console check, and 3-5 runs, never in parallel.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/performance.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/pages.ts , https://github.com/puppeteer/puppeteer/blob/main/docs/api/puppeteer.page.setviewport.md

### 2. Change the code
- Verdict: verified
- Evidence details: `take_screenshot` supports `format: "webp"`.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md

### 3. Re-trace
- Verdict: verified
- Evidence details: this step only repeats section 1. The corrections to section 1 apply here too.
- Evidence: (same as section 1)

### 4. Compare
- Verdict: verified
- Evidence details:
  - The summary prints "estimated metric savings" per insight, so comparing insight lists is supported.
  - `compare_heapsnapshots` exists (it needs `--memoryDebugging`). For memory, see the corrected leak item (three snapshots; slope proof in 15-gaps-round-2:484).
  - The acceptance rule ("more than the baseline spread, or 5% / 20 ms") is an unsourced heuristic. It is marked as an example, which is fine.
- Evidence: https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/ai_assistance/data_formatters/PerformanceTraceFormatter.ts

### 5. What to record (one row per run)
- Verdict: verified
- Evidence details:
  - Every "Where it comes from" source exists: the trace header lines, `LCPBreakdown` subparts, `CLSCulprits`, `INPBreakdown`, `evaluate_script` for FCP and TTFB (the summary has no FCP), `list_console_messages`, `take_heapsnapshot`, and `get_heapsnapshot_summary` (`--memoryDebugging`).
  - Add a "debug tier (MCP attached)" flag for Wasm-heavy rows. See Missing item 1.
- Evidence: https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/ai_assistance/data_formatters/PerformanceTraceFormatter.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md

## Cross-file conflicts

1. **15-gaps-round-1.md:647-656 against 14:3 and :34.** 15 already says to change 1.9.0 to 1.10.1 and to remove "(doc only)" from `get_css_styles`. 14 is not updated. This check confirms it. 19-skill-design.md:28 and :720 also still say "DevTools MCP 1.9.0".
2. **15-gaps-round-1.md:76-95 against 14's playbook.** 15 says MCP always creates a DevTools target universe with `DebuggerModel` (`Debugger.enable`). V8 then moves Wasm down to Liftoff debug code. 09-v8-consolidated.md:2170 says "never benchmark Wasm with DevTools open". 14's render-loop and SciChart numbers come from MCP-attached pages and have no "debug tier" caveat.
3. **15-gaps-round-2.md:589-595 against 14 "Save raw traces" and the playbook.** Trace paths outside the workspace roots are refused. `--allowUnrestrictedPaths` is deprecated. 14 uses relative `traces/…` paths and recommends the deprecated flag.
4. **15-gaps-round-2.md:617-627 against 14:605 and :785.** 15 resolves the flag conflict that 14 leaves open (`--categoryExperimentalWebmcp`, not `--categoryWebMCP`). This check adds that `WebMCPTesting` implies `WebMCP` in Blink, so both `--enable-features` values work.
5. **15-gaps-round-2.md:490 against 14 "Find leaks".** 14 says "comparing after revert separates leaks from normal caches". 15 says "A before/after snapshot pair cannot tell a leak from a warm cache. Growth per repetition can." The official skill compares baseline with target, not with the reverted state.
6. **15-gaps-round-2.md:597-615 against 14's `mobile-mid` profile and "Not covered" (WebSocket).** DevTools network emulation throttles WebSocket bandwidth and the handshake, but not per-message latency. A "Slow 4G" or "Slow 3G" profile makes a streaming quote chart look more responsive than on a real slow network.
7. **15-gaps-round-2.md:164 against 14's hook and scenario design.** `console.*` calls cost about 30 times more with MCP attached (CDP console and runtime on). Logging inside `run_scenario` or `get_frame_stats` skews MCP-attached frame times.
8. **verify/13-scichart.verify.md:215-238 against 14:498 (code comment).** `renderedToDestination` fires only for non-copy (`createSingle`) surfaces. 15-gaps-round-1 recommends `SciChartSurface.create()` for terminals. A hook that times frames with `renderedToDestination` sees no events there. Use `painted` (as `app.nextPaint()` does) or `preRenderAll` plus `renderedToWebGl`.
9. **19-skill-design.md:936 against 14:527 (scenario names).** 19 uses `run_scenario` enum values `stream`, `pan`, `zoom`, `drag_drawing`, `switch_symbol` and `toggle_toolbar`. 14 uses `stream-1k-ticks-per-s`, `zoom-pan-sweep` and `add-20-series`. This is not a factual conflict, but the skill should pick one set.
10. Consistent, no conflict:
    - The LoAF buffer of 200 and script attribution over 5 ms (06:511, 07:713, 07:737).
    - The Lighthouse "median of 5 runs … twice as stable" (16-explore-fast-batch-06.md:83).
    - The INP recipe (confirmed live in 15-gaps-round-2:561-571).
    - Chrome 154 is stable since 2026-09-22. Chrome 153 is only the MCP test browser (15-gaps-round-2:67).

## Missing but important

1. **MCP-attached pages run Wasm in debug tier.** `DebuggerModel` auto-starts, `Debugger.enable` runs, and Wasm moves down to Liftoff. Mark MCP Wasm timings "debug tier". Take absolute SciChart numbers from an unattached run. Sources: 15-gaps-round-1.md:76-95; https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/McpPage.ts ; https://chromium.googlesource.com/v8/v8/+/HEAD/src/wasm/wasm-engine.cc
2. **`emulate` with `,mobile`/`,touch` can reload the page.** Put `emulate` first in every recipe, and re-run `wait_for` and setup after it. Source: https://github.com/puppeteer/puppeteer/blob/main/docs/api/puppeteer.page.setviewport.md ("setting viewport will reload the page in order to set the isMobile or hasTouch properties")
3. **Custom tracks reach the MCP text summary.** `PerformanceTraceFormatter` prints a "# Custom tracks" section from `ExtensionTraceData` (`performance.measure` with `detail.devtools`, or `console.timeStamp` tracks). So chart phases (append, resample, draw) can appear in the agent's summary without a saved trace. Sources: https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/ai_assistance/data_formatters/PerformanceTraceFormatter.ts ; https://developer.chrome.com/docs/devtools/performance/extension ; 15-gaps-round-2.md:573-583
4. **Soft navigations create insight sets.** The trace engine makes `NAVIGATION_n` sets for `SoftNavigationStart` events (SPA route changes). Soft-navigation entries shipped in Chrome 151. In interaction traces of a routed terminal, read the set ids from the summary. Sources: https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/Processor.ts ; https://api.webstatus.dev/v1/features/soft-navigations
5. **The MCP summary has no frame, FPS or GPU data.** Render-loop verdicts need an in-page frame probe and the saved trace, opened in DevTools or Perfetto. Source: 15-gaps-round-2.md:573-583; the PerformanceTraceFormatter.ts link above.
6. **SlowCSSSelector never appears in MCP.** MCP does not turn on the `CssSelectorStats` trace categories (`disabled-by-default-blink.debug`). Record selector cost in the DevTools Performance panel with "Enable CSS selector stats". Sources: raw/verify/14/cdm1101/package/build/src/third_party/index.js (`OptionalCategories`); https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/insights/SlowCSSSelector.ts
7. **Two server options change the recipes.** `--no-javascript-evaluation` (1.9.0) removes `evaluate_script` and blocks `initScript`, so every LoAF, timing and GPU probe recipe in 14 fails under it. `--config <file.json>` (1.10.0) holds a shared flag set for repeatable runs. Source: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/CHANGELOG.md (#2627, #2638, #2661)
8. **Console cost under MCP.** About 4.9 µs per `console` call with MCP attached (about 30 times more). Sample or aggregate logging per frame in hooks during agent runs. Source: 15-gaps-round-2.md:164
9. **WebSocket throttling model.** Network presets throttle WebSocket bandwidth and the handshake, not per-message latency. For quote-stream latency tests, add the delay in a proxy or replay server. Sources: 15-gaps-round-2.md:597-615; https://developer.chrome.com/blog/new-in-devtools-99
10. **`registerTool()` rejects with `SecurityError` in documents that are not origin-keyed.** Examples: pages that set `document.domain`, or that send `Origin-Agent-Cluster: ?0`. A legacy page setup can silently break all hooks. Sources: https://github.com/webmachinelearning/webmcp/blob/main/index.bs (registerTool steps; commit #197 "Gate `registerTool()` on document.domain being disabled")
