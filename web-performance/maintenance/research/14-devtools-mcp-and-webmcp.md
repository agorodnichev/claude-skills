# Chrome DevTools MCP and WebMCP for agent performance testing

Scope: how an AI coding agent uses the Chrome DevTools MCP server ("Chrome DevTools for agents", npm `chrome-devtools-mcp` 1.9.0, 2026-09-08) to measure, compare, and fix the performance of code it writes, and how a page under development can expose test/perf hooks as WebMCP tools (`document.modelContext`, origin trial Chrome 149-156).
Sources: the chrome-devtools-mcp repo (README, docs/*.md, CHANGELOG, `src/tools/*.ts`, skills), devtools-frontend insight models, developer.chrome.com (DevTools-for-agents docs, WebMCP docs, blogs, release notes), the WebMCP spec/explainer (webmachinelearning/webmcp), ChromeStatus, webstatus.dev, Puppeteer, Lighthouse docs, MDN, web.dev.
Verified live in this session: one trial trace on https://example.com (Chrome 153.0.8010.53), one insight drill-down, and a WebMCP round trip (register, list, execute) on the same page.

---

## Part 1 - Chrome DevTools MCP: tool inventory (exact parameters)

Parameters below are copied from the tool schemas loaded in this session (ToolSearch `+chrome-devtools`) and cross-checked with `docs/tool-reference.md`. "Req" = required. Tools marked (doc only) are in the current docs but were NOT loaded in this session (older server build or flag not set).

| Group | Tool | Parameters (Req in bold) | Perf use |
|---|---|---|---|
| Navigation | `list_pages` | none | Get `pageId` values |
| Navigation | `new_page` | **url**, background, isolatedContext (named browser context), timeout | Clean-state runs; isolated cookies/storage |
| Navigation | `navigate_page` | **pageId**, type (`url`/`back`/`forward`/`reload`), url, ignoreCache, initScript (runs before page scripts on next navigation), handleBeforeUnload (`accept`/`dismiss`), timeout | Set URL before trace; cold reload; early observers |
| Navigation | `select_page` | **pageId**, bringToFront | - |
| Navigation | `close_page` | **pageId** | - |
| Navigation | `wait_for` | **pageId**, **text** (array, any match), timeout | Wait for "chart ready" text before measuring |
| Emulation | `emulate` | **pageId**, cpuThrottlingRate (1-20), networkConditions (`Offline`,`Slow 3G`,`Fast 3G`,`Slow 4G`,`Fast 4G`), viewport (`WxHxDPR[,mobile][,touch][,landscape]`), userAgent, colorScheme (`dark`/`light`/`auto`), geolocation (`lat,lon`), extraHttpHeaders (JSON string) | Throttling and device profile |
| Emulation | `resize_page` | **pageId**, **width**, **height** | Window size only (no DPR) |
| Performance | `performance_start_trace` | **pageId**, reload (default true), autoStop (default true), filePath (`.json` or `.json.gz`) | Record trace, get summary + insight list |
| Performance | `performance_stop_trace` | **pageId**, filePath | End a manual trace |
| Performance | `performance_analyze_insight` | **pageId**, **insightSetId**, **insightName** | Drill into one insight |
| Network | `list_network_requests` | **pageId**, resourceTypes (lowercase enum: `document`,`stylesheet`,`image`,`media`,`font`,`script`,`texttrack`,`xhr`,`fetch`,`prefetch`,`eventsource`,`websocket`,`manifest`,`signedexchange`,`ping`,`cspviolationreport`,`preflight`,`fedcm`,`other`), pageIdx, pageSize, includePreservedRequests (last 3 navigations) | Request inventory |
| Network | `get_network_request` | **pageId**, reqid, requestFilePath, responseFilePath | Headers, bodies, redirect chain |
| Debugging | `evaluate_script` | **pageId**, **function** (function declaration string), args (element uids), filePath, waitForStableDom (default true), dialogAction | Read PerformanceObserver, LoAF, Resource Timing |
| Debugging | `list_console_messages` | **pageId**, types (`log`,`debug`,`info`,`error`,`warn`,...,`verbose`,`issue`), includeStackTraces, includePreservedMessages, pageIdx, pageSize, serviceWorkerId | Errors/warnings after a run |
| Debugging | `get_console_message` | **pageId**, **msgid** | Full message + source-mapped stack |
| Debugging | `lighthouse_audit` | **pageId**, device (`desktop`/`mobile`), mode (`navigation`/`snapshot`), outputDirPath | a11y, SEO, best practices, agentic browsing (NOT performance) |
| Debugging | `take_screenshot` | **pageId**, filePath, format (`png`/`jpeg`/`webp`), quality, fullPage, uid | Visual proof of render state |
| Debugging | `take_snapshot` | **pageId**, filePath, verbose | a11y-tree text with element uids |
| Debugging | `get_css_styles` (doc only) | **pageId**, **uid**, pageIdx, pageSize | Cascade debugging |
| Debugging | `screencast_start` / `screencast_stop` (doc only, `--experimentalScreencast`, needs ffmpeg) | **pageId**, filePath (.webm/.mp4) | Video of jank |
| Memory | `take_heapsnapshot` | **pageId**, **filePath** (`.heapsnapshot`) | Heap capture |
| Memory (doc only, `--memoryDebugging`) | `compare_heapsnapshots`, `get_heapsnapshot_summary`, `get_heapsnapshot_details`, `get_heapsnapshot_class_nodes`, `get_heapsnapshot_retainers`, `get_heapsnapshot_retaining_paths`, `get_heapsnapshot_dominators`, `get_heapsnapshot_edges`, `get_heapsnapshot_object_details`, `get_heapsnapshot_duplicate_strings`, `query_heapsnapshot_objects`, `close_heapsnapshot` | filePath(s), nodeId, classIndex, filterName (`objectsRetainedByDetachedDomNodes`, `objectsRetainedByConsole`, `objectsRetainedByEventHandlers`, `objectsRetainedByContexts`, `sharedNativeContext`, `noNativeContext`, `attributedToSpecificNativeContext`), retainedSize/selfSize ranges, sortBy | Leak diagnosis |
| Input | `click`, `hover`, `drag`, `fill`, `fill_form`, `press_key`, `type_text`, `upload_file`, `handle_dialog` | **pageId** + **uid**/key/text; includeSnapshot | Drive interactions for INP traces |
| Input | `click_at` (doc only, `--experimentalVision`) | **pageId**, **x**, **y**, dblClick | Click painted canvas regions |
| WebMCP (`--categoryExperimentalWebmcp`) | `list_webmcp_tools` | **pageId** | Discover page hooks |
| WebMCP | `execute_webmcp_tool` | **pageId**, **toolName**, input (JSON string) | Run page hooks |
| Third-party (doc only, `--categoryExperimentalThirdParty`) | `list_3p_developer_tools`, `execute_3p_developer_tool` (**pageId**, **toolName**, params) | DevTools-only page hooks |
| Extensions / PWA (doc only, off by default) | `install_extension`, `list_extensions`, `reload_extension`, `trigger_extension_action`, `uninstall_extension`; `install_pwa`, `launch_pwa`, `uninstall_pwa`, `get_os_app_state` | Not perf-relevant |
| Slim mode (`--slim`) | `navigate`, `evaluate`, `screenshot` | No trace tools |

Unlisted in docs but present in `src/tools/comments.ts`: `open_devtools`, `get_devtools_comments`, `resolve_devtools_comment`, `reveal_in_devtools` (gating not verified).

### Performance insight names (for `performance_analyze_insight`)

From `devtools-frontend/front_end/models/trace/insights/Models.ts` (main branch, 19 insights). The trace summary lists only the insights that apply to that trace; use only listed names.

| insightName | Title in DevTools | Category (metric) | What it points to |
|---|---|---|---|
| `LCPBreakdown` | LCP breakdown | LCP | TTFB / load delay / load duration / render delay |
| `LCPDiscovery` | LCP request discovery | LCP | LCP image not discoverable in HTML, lazy-loaded, no fetchpriority |
| `RenderBlocking` | Render-blocking requests | LCP (FCP+LCP savings) | CSS/JS that block first render |
| `NetworkDependencyTree` | Network dependency tree | LCP | Chained critical requests; preconnect candidates |
| `DocumentLatency` | Document request latency | All | Redirects, slow server, no compression |
| `ImageDelivery` | Improve image delivery | LCP | Oversized / badly compressed / wrong format images |
| `ModernHTTP` | Modern HTTP | LCP | HTTP/1.1 requests |
| `DuplicatedJavaScript` | Duplicated JavaScript | LCP | Same module in several bundles |
| `LegacyJavaScript` | Legacy JavaScript | All | Polyfills/transforms for Baseline features |
| `ThirdParties` | 3rd parties | All | Transfer size and main-thread time per third party |
| `Cache` | Use efficient cache lifetimes | All | Short `Cache-Control` lifetimes |
| `FontDisplay` | Font display | FCP (listed under INP group) | Missing `font-display` |
| `CharacterSet` | Declare a character encoding | All | No meta charset in first 1024 bytes / header |
| `CLSCulprits` | Layout shift culprits | CLS | Worst cluster; culprits: injected iframe, web font, non-composited animation, unsized image |
| `INPBreakdown` | INP breakdown | INP | Input delay / processing duration / presentation delay |
| `DOMSize` | Optimize DOM size | INP | Total elements, depth, most children, large layout/style updates |
| `ForcedReflow` | Forced reflow | All | Call frames that read layout after a style invalidation |
| `SlowCSSSelector` | CSS selector costs | All | Selector match cost (needs selector stats; see caveat) |
| `Viewport` | Optimize viewport for mobile | INP | Missing mobile viewport meta (tap delay) |

Observed output shape (trial on example.com): the summary prints `CPU throttling: 1x`, `Network throttling: none`, then "Available insight sets" with `insight set id: NAVIGATION_0`, lab metrics (LCP with node id and LCP breakdown, CLS), CrUX field metrics (p75 LCP + subparts, INP, CLS, with `scope: url|origin`), the list of available insights (here only `LCPBreakdown` and `CharacterSet`), and format keys for call trees and network lines. The per-insight call returned subpart durations and percentages ("TTFB 26 ms (42.2%), render delay 35 ms (57.8%)") and "Estimated savings".

---

### Navigate first, then trace the load with `reload: true`
- Layer: tooling
- Stage: network, html-parse, preload-scan, script-run, style, layout, paint
- Metrics: LCP, CLS, TTFB, FCP
- When: testing
- Impact: high, because this is the only built-in way to get LCP subparts and load insights in one call
- Do: Call `navigate_page` to the target URL, then `performance_start_trace` with `reload: true, autoStop: true`. Read the summary, write down the `insightSetId` and the listed insight names, then call `performance_analyze_insight` for each relevant name.
- Why: With `reload: true` the server goes to `about:blank`, starts tracing, re-opens the URL it had, waits for `load`, then waits a fixed 5 s and stops (source: `src/tools/performance.ts`). It reloads the page's current URL, so the page must already be on the right URL.
- Example:
  ```jsonc
  // 1
  {"tool":"navigate_page","pageId":1,"type":"url","url":"http://localhost:5173/chart"}
  // 2
  {"tool":"performance_start_trace","pageId":1,"reload":true,"autoStop":true,"filePath":"traces/baseline-run1.json.gz"}
  // 3 (use the id and names printed by step 2)
  {"tool":"performance_analyze_insight","pageId":1,"insightSetId":"NAVIGATION_0","insightName":"LCPBreakdown"}
  ```
- Avoid/caveats: `autoStop` covers load + 5 s only; work that starts later (websocket data, first chart render after a fetch) can fall outside the trace. Use a manual trace for that. Only one trace can run at a time.
- Status: chrome-devtools-mcp 1.9.0 (2026-09-08); verified by a trial trace in Chrome 153.
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/performance.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/debug-optimize-lcp/SKILL.md

### Analyze every insight you need before the next trace starts
- Layer: tooling
- Stage: main-thread-task, network
- Metrics: LCP, INP, CLS
- When: testing
- Impact: medium, because a later trace silently replaces the data you want to compare
- Do: After each trace, call `performance_analyze_insight` for all listed insights you care about and save the text (or save the raw trace with `filePath`). Only then start the next trace.
- Why: The analyze tool reads `context.recordedTraces().at(-1)`, that is, only the last recorded trace. Old insight sets are not reachable after a new trace.
- Avoid/caveats: Use only ids from the "Available insight sets" list (`NAVIGATION_0`, `NAVIGATION_1`, ... or `NO_NAVIGATION` for traces without a navigation). A wrong name returns "No Insight with the name ...".
- Status: verified in `src/tools/performance.ts`, `src/processors/PerformanceTrace.ts` (1.9.0).
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/performance.ts , https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/types/TraceEvents.ts

### Decide cold or warm cache for every load trace, and say which one you used
- Layer: tooling
- Stage: network
- Metrics: LCP, FCP, TTFB
- When: testing
- Impact: high, because the default flow measures a warm HTTP cache and hides download cost
- Do: For a first-visit (cold) number, either open a fresh page with `new_page` and a new `isolatedContext` name per run, or record manually: `performance_start_trace` with `reload: false, autoStop: false`, then `navigate_page` with `type: "reload", ignoreCache: true`, then `performance_stop_trace`. Record "cold" or "warm" next to each result.
- Why: The required `navigate_page` before the trace already downloads and caches resources; the trace's internal reload uses a normal navigation, so cached assets can come from the cache. `ignoreCache` bypasses the cache on reload. A separate browser context has its own storage.
- Avoid/caveats: The manual recipe is derived from the tool semantics, not from a documented recipe. Service-worker caches are not bypassed by an HTTP cache bypass. Do not mix cold and warm runs in one comparison.
- Status: tool parameters verified (1.9.0); recipe is an inference.
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/performance.ts

### Set all emulation options in one `emulate` call, then confirm them in the trace header
- Layer: tooling
- Stage: main-thread-task, network
- Metrics: LCP, INP, TBT, FPS/smoothness
- When: testing
- Impact: high, because a second `emulate` call silently turns off throttling you set before
- Do: Pass `cpuThrottlingRate`, `networkConditions`, and `viewport` together in every `emulate` call. After each trace, check that the summary shows the expected `CPU throttling: Nx` and `Network throttling: <preset>` lines.
- Why: In `McpPage.emulate()`, each option that you omit is reset (network throttling off, CPU rate 1, user agent cleared, color scheme reset, viewport cleared). The trace parser takes the current throttling values and prints them in the summary.
- Example:
  ```jsonc
  // Wrong: the second call removes the CPU and network throttling
  {"tool":"emulate","pageId":1,"cpuThrottlingRate":4,"networkConditions":"Slow 4G"}
  {"tool":"emulate","pageId":1,"viewport":"412x823x1.75,mobile,touch"}
  // Right: one call with the full profile
  {"tool":"emulate","pageId":1,"cpuThrottlingRate":4,"networkConditions":"Slow 4G","viewport":"412x823x1.75,mobile,touch"}
  ```
- Avoid/caveats: Network throttling is refused when `--blockedUrlPattern`/`--allowedUrlPattern` is set. Throttling raises the default wait and navigation timeouts in proportion.
- Status: verified in `src/McpPage.ts` and `src/tools/emulation.ts` (1.9.0).
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/McpPage.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/emulation.ts

### Use named throttling profiles that match Lighthouse and DevTools presets
- Layer: tooling
- Stage: network, main-thread-task
- Metrics: LCP, INP, TBT, startup
- When: testing
- Impact: high, because a fast developer machine (this session ran on an Apple M4 Max) hides main-thread cost
- Do: Use these profiles and name them in your results:
  - `desktop-fast`: no CPU or network throttling, `viewport: "1920x1080x1"`.
  - `mobile-mid` (default for load work): `cpuThrottlingRate: 4`, `networkConditions: "Slow 4G"`, `viewport: "412x823x1.75,mobile,touch"`.
  - `mobile-low` (stress): `cpuThrottlingRate: 10`, `networkConditions: "Slow 4G"` (or `"Slow 3G"` for worst case).
  - If you know a calibrated DevTools "mid-tier mobile" rate for your machine, use it instead of 4.
- Why: Lighthouse mobile uses 4x CPU and a "Slow 4G" network (150 ms RTT, 1.6 Mbps down, 750 Kbps up). Its table maps a high-end desktop to mid-tier mobile at 4x (range 2-10) and to low-end mobile at 10x (5-20). Puppeteer's `Slow 4G` preset is an alias of `Fast 3G`: about 1.44 Mbps down, 675 Kbps up, 562.5 ms request latency (150 ms x 3.75, because request-level throttling needs a higher latency to match packet-level RTT). `Fast 4G` is about 8.1 Mbps / 165 ms; `Slow 3G` about 400 Kbps / 2000 ms. The 412x823 at DPR 1.75 viewport is the one the MCP Lighthouse tool uses for mobile.
- Avoid/caveats: CPU throttling is relative to the host CPU, so the same rate gives different results on different machines. It does not slow the GPU (see the GPU rule). The MCP numeric rate is 1-20.
- Status: Lighthouse docs (main); Puppeteer `PredefinedNetworkConditions.ts` (main); DevTools CPU calibration since Chrome 134.
- Sources: https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md , https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/cdp/PredefinedNetworkConditions.ts , https://developer.chrome.com/blog/devtools-grounded-real-world , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/lighthouse.ts

### Do not trust CPU throttling for WebGL/WebGPU chart frame times
- Layer: tooling
- Stage: gpu-upload, gpu-draw, raster, composite
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: high, because GPU-bound frames look fast on a desktop GPU even at 20x CPU throttling
- Do: Before you trust frame numbers, read the WebGL renderer and WebGPU adapter with `evaluate_script`, and write them in the result. Reject runs on a software renderer (SwiftShader or `isFallbackAdapter: true`). Treat throttled frame times for GPU-heavy charts as a lower limit; confirm GPU-heavy changes on a real low-end device.
- Why: DevTools CPU throttling slows the renderer main thread only. The Chrome team reported a click that matched a real phone after 3.7x CPU throttling, but a GPU-heavy effect measured 270 ms locally against 620 ms on the device, because the GPU was not throttled.
- Example:
  ```js
  // evaluate_script function (waitForStableDom: false)
  async () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    const adapter = await navigator.gpu?.requestAdapter();
    return {
      glRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      gpu: adapter ? { vendor: adapter.info.vendor, arch: adapter.info.architecture, fallback: adapter.info.isFallbackAdapter } : null,
      dpr: devicePixelRatio,
    };
  }
  ```
  Observed in this session: `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max)`, WebGPU `apple/metal-3`, not fallback, DPR 2.
- Avoid/caveats: `WEBGL_debug_renderer_info` can be masked in some browsers; this check is for the test browser only, never for production logic.
- Status: Chrome 153 observation; blog 2025-04-04.
- Sources: https://developer.chrome.com/blog/devtools-grounded-real-world

### Test canvas cost at DPR 1, 2, and 3 with the `viewport` string
- Layer: tooling
- Stage: raster, gpu-draw, composite, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, because canvas backing-store pixels grow with DPR squared
- Do: Repeat the render-loop test with `viewport: "1280x800x1"`, `"1280x800x2"`, and `"1280x800x3"` (same CSS size). Compare frame p95 and heap/GPU memory.
- Why: `emulate` sets the device scale factor. A chart canvas sized to CSS pixels x DPR has 4x the pixels at DPR 2 and 9x at DPR 3, which changes fill and upload cost.
- Avoid/caveats: `resize_page` changes the window size only, not DPR. Emulated DPR on a desktop GPU still does not match a phone GPU.
- Status: `emulate.viewport` format verified in 1.9.0 docs.
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md

### Record interaction traces manually to get INP and its subparts
- Layer: tooling
- Stage: main-thread-task, script-run, style, layout, paint
- Metrics: INP, TBT
- When: interaction
- Impact: high, because load traces contain no interactions and cannot show INP
- Do: Load the page and wait for ready state. Call `performance_start_trace` with `reload: false, autoStop: false`. Drive the real interaction with `click`, `press_key`, `type_text`, `drag`, or a WebMCP `run_scenario` tool. Call `performance_stop_trace`. Then analyze `INPBreakdown` (and `ForcedReflow`, `DOMSize`) in the `NO_NAVIGATION` set or the set the summary lists.
- Why: `INPBreakdown` splits the slowest interaction into input delay, processing duration, and presentation delay. The MCP input tools send trusted input through Puppeteer, so Event Timing sees them.
- Avoid/caveats: Keep the trace short (seconds) and do one scenario per trace. `take_snapshot` is needed first to get element `uid`s; take it before the trace starts so it does not add work inside the trace. Canvas-only targets have no uid; use a WebMCP scenario tool or `click_at` (`--experimentalVision`).
- Status: insight and subpart names verified in devtools-frontend main; the recipe is built from tool semantics.
- Sources: https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/insights/INPBreakdown.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md , https://web.dev/articles/vitals

### Use the INP threshold and the lab proxy correctly
- Layer: tooling
- Stage: main-thread-task
- Metrics: INP, TBT, LCP, CLS
- When: testing
- Impact: medium, because wrong targets lead to wrong "pass" decisions
- Do: Judge results against the web.dev thresholds at p75: LCP good at 2.5 s or less, INP good at 200 ms or less, CLS good at 0.1 or less. In load traces with no input, use long main-thread blocking (TBT-like sum of LoAF `blockingDuration`) as the proxy for INP risk.
- Why: Lab tools without a user cannot measure INP; TBT is the documented lab proxy.
- Avoid/caveats: The MCP trace summary does not print TBT or FCP; compute them with `evaluate_script` (see LoAF and paint rules). `lighthouse_audit` in this server excludes the performance category, so it does not give TBT either.
- Status: web.dev page last updated 2024-10-31; LCP and Event Timing entries are Baseline newly available since 2025-12-12 (Safari 26.2) per webstatus.dev.
- Sources: https://web.dev/articles/vitals , https://api.webstatus.dev/v1/features/event-timing , https://api.webstatus.dev/v1/features/largest-contentful-paint

### Read Long Animation Frame data with `evaluate_script` to attribute jank to scripts
- Layer: tooling
- Stage: main-thread-task, script-run, style, layout
- Metrics: INP, TBT, FPS/smoothness
- When: interaction, animation/render-loop, long-lived session
- Impact: high, because LoAF names the script, function, and invoker behind each slow frame
- Do: After a scenario, run an `evaluate_script` that observes `long-animation-frame` with `buffered: true` and returns a compact summary: count, sum of `blockingDuration`, worst frames, and top scripts by duration with `invokerType`, `invoker`, `sourceURL`, `sourceFunctionName`, `forcedStyleAndLayoutDuration`. Pass `waitForStableDom: false` for read-only scripts.
- Why: A LoAF is a rendering update delayed past 50 ms. Each entry has `blockingDuration`, `renderStart`, `styleAndLayoutStart`, `firstUIEventTimestamp`, and `scripts` (only scripts longer than 5 ms). `invokerType` is one of `user-callback`, `event-listener`, `resolve-promise`, `reject-promise`, `classic-script`, `module-script`.
- Example:
  ```js
  // evaluate_script function; returns under ~1.5 KB of JSON
  async () => {
    const entries = await new Promise((resolve) => {
      const seen = [];
      const po = new PerformanceObserver((list) => seen.push(...list.getEntries()));
      po.observe({ type: 'long-animation-frame', buffered: true });
      setTimeout(() => { po.disconnect(); resolve(seen); }, 200);
    });
    const scripts = entries.flatMap((f) => f.scripts.map((s) => ({
      ms: Math.round(s.duration), type: s.invokerType, invoker: s.invoker,
      src: (s.sourceURL || '').split('/').pop(), fn: s.sourceFunctionName,
      forcedLayoutMs: Math.round(s.forcedStyleAndLayoutDuration),
    })));
    scripts.sort((a, b) => b.ms - a.ms);
    return {
      loafCount: entries.length,
      blockingMsTotal: Math.round(entries.reduce((t, f) => t + f.blockingDuration, 0)),
      worstFrameMs: Math.round(Math.max(0, ...entries.map((f) => f.duration))),
      topScripts: scripts.slice(0, 8),
    };
  }
  ```
- Avoid/caveats: The buffer keeps 200 entries; for long sessions install the observer early (app dev hook or `navigate_page` `initScript`) and aggregate. Return aggregates, not raw entries, to save tokens.
- Status: LoAF shipped Chrome 123; Chromium-only (webstatus.dev "limited"); `long-animation-frame` listed in `PerformanceObserver.supportedEntryTypes` in Chrome 153 (observed).
- Sources: https://developer.chrome.com/docs/web-platform/long-animation-frames , https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming , https://developer.mozilla.org/en-US/docs/Web/API/PerformanceScriptTiming/invokerType , https://api.webstatus.dev/v1/features/long-animation-frames

### Read paint, navigation, and resource timing with `evaluate_script` because the network tools omit sizes and timings
- Layer: tooling
- Stage: network, paint
- Metrics: TTFB, FCP, bundle-size, LCP
- When: testing, load
- Impact: medium, because `list_network_requests` shows only reqid, method, URL, and status
- Do: Use `evaluate_script` to return TTFB (`responseStart`), FCP (`first-contentful-paint` paint entry), and per-type totals of `transferSize` and `decodedBodySize`, plus `renderBlockingStatus` and `nextHopProtocol`. Use `get_network_request` only for headers (for example `cache-control`, `content-encoding`) and bodies. Use the trace network lines (priority, initialPriority, renderBlocking, protocol, initiators) when an insight shows them.
- Why: The MCP network formatter prints `reqid=<id> <method> <url> [<status>]` in lists, and headers/bodies/redirects in detail, without timing or size. The trace formatter prints priority, render-blocking flag, protocol, and initiator chains.
- Example:
  ```js
  () => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const byType = {};
    for (const r of performance.getEntriesByType('resource')) {
      const t = (byType[r.initiatorType] ??= { n: 0, transferKB: 0, decodedKB: 0, blocking: 0 });
      t.n++; t.transferKB += r.transferSize / 1024; t.decodedKB += r.decodedBodySize / 1024;
      if (r.renderBlockingStatus === 'blocking') t.blocking++;
    }
    for (const t of Object.values(byType)) { t.transferKB = Math.round(t.transferKB); t.decodedKB = Math.round(t.decodedKB); }
    return { ttfbMs: Math.round(nav.responseStart), fcpMs: fcp && Math.round(fcp.startTime), byType };
  }
  ```
- Avoid/caveats: Cross-origin resources without `Timing-Allow-Origin` report 0 sizes. The `resourceTypes` filter enum is lowercase (`"image"`, `"font"`); the official LCP skill text shows `["Image", "Font"]`, which does not match the schema.
- Status: formatter verified in `src/formatters/NetworkFormatter.ts` (1.9.0).
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/formatters/NetworkFormatter.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/debug-optimize-lcp/SKILL.md

### Run the LCP skill order: breakdown first, then fix the largest delay subpart
- Layer: tooling
- Stage: network, preload-scan, paint
- Metrics: LCP
- When: testing
- Impact: high, because fixing the wrong subpart only moves the time to another subpart
- Do: Read `LCPBreakdown`; if load delay is large, read `LCPDiscovery` and `NetworkDependencyTree`; if render delay is large, read `RenderBlocking` and `ForcedReflow`; if TTFB is large, read `DocumentLatency`. Identify the LCP element with an `evaluate_script` LCP observer, then re-trace.
- Why: The official `debug-optimize-lcp` skill states target shares: TTFB about 40%, load delay under 10%, load duration about 40%, render delay under 10%.
- Avoid/caveats: For a canvas/WebGL chart page, the LCP element is often a text or image element outside the chart, so chart render time may not be in LCP at all; measure chart "first frame" separately (see WebMCP hooks).
- Status: skill in repo main (2026).
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/debug-optimize-lcp/SKILL.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/debug-optimize-lcp/references/lcp-breakdown.md

### Save raw traces and heap snapshots to files inside allowed roots
- Layer: tooling
- Stage: gc-memory, main-thread-task
- Metrics: memory, INP, LCP
- When: testing
- Impact: medium, because text summaries lose detail that a human or a later diff needs
- Do: Pass `filePath` (`.json.gz` for traces, `.heapsnapshot` for heaps) with a run id in the name. Keep the files next to the results table. Open traces in the DevTools Performance panel when a human must review.
- Why: The design principle is "reference over value": heavy assets go to files, summaries go to the context. When the client does not negotiate MCP roots, file tools are limited to the OS temp directory unless `--filesystemRoot` or `--allowUnrestrictedPaths` is set.
- Avoid/caveats: Do not read raw `.heapsnapshot` or trace JSON into the model context; use the summary tools. Close loaded snapshots with `close_heapsnapshot` when done.
- Status: 1.9.0 docs.
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/design-principles.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md

### Find leaks with a baseline / repeat x10 / revert snapshot sequence
- Layer: tooling
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: high, because a trading terminal runs for hours and small per-action leaks grow without limit
- Do: Take `take_heapsnapshot` at baseline, run the scenario 10 times (for example open/close a chart, subscribe/unsubscribe a symbol), revert to the start state, take a second snapshot, then compare with `compare_heapsnapshots` and inspect growth with `get_heapsnapshot_class_nodes`, `get_heapsnapshot_retaining_paths`, and the `filterName` values `objectsRetainedByDetachedDomNodes`, `objectsRetainedByEventHandlers`, `objectsRetainedByContexts`, `objectsRetainedByConsole`.
- Why: Repeating the action amplifies a leak above noise; comparing after revert separates leaks from normal caches. Common roots are listeners not removed, detached DOM kept in variables, closures, and unbounded caches.
- Avoid/caveats: Analysis tools need `--memoryDebugging`; only `take_heapsnapshot` is on by default. Detached nodes can be an intended cache; confirm before removing references. A heap snapshot forces a GC and pauses the page; never take one inside a perf trace.
- Status: memory tools added 2026-04 to 2026-08 (CHANGELOG 0.21-1.8).
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/memory-leak-debugging/SKILL.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/memory-leak-debugging/references/common-leaks.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md

### Check the console after every run
- Layer: tooling
- Stage: script-run
- Metrics: startup, INP
- When: testing
- Impact: medium, because a thrown error can make a run look fast by skipping work
- Do: Call `list_console_messages` with `types: ["error","warn","issue"]` after each run. For each error, call `get_console_message` (or set `includeStackTraces: true`) to get the source-mapped stack. Count errors in the results table.
- Why: A fast run with errors is not a valid result. The server includes source-mapped stack traces for uncaught errors.
- Avoid/caveats: Messages reset on navigation; use `includePreservedMessages` for the last 3 navigations. Chrome "[Violation]" console entries were not verified to appear in this tool.
- Status: 1.8.0 added `includeStackTraces`.
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/CHANGELOG.md

### Use `lighthouse_audit` for quality gates, not for performance
- Layer: tooling
- Stage: html-parse
- Metrics: startup
- When: testing
- Impact: low, because it does not score performance in this server
- Do: Run `lighthouse_audit` (`device: "mobile"` or `"desktop"`, `mode: "navigation"` or `"snapshot"`) for accessibility, SEO, best practices, and agentic browsing. Use traces for performance.
- Why: The tool hard-codes `onlyCategories: ['accessibility','seo','best-practices','agentic-browsing']`; mobile uses 412x823 at DPR 1.75, desktop 1350x940 at DPR 1. It writes JSON and HTML reports.
- Avoid/caveats: A navigation audit reloads and resizes the page; do not run it in the middle of a trace. Lighthouse 13.4.1 is bundled (1.7.0 changelog).
- Status: 1.9.0.
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/lighthouse.ts , https://developer.chrome.com/docs/devtools/agents/use-cases/lighthouse-audit

### Prefer `take_snapshot` for state, `take_screenshot` for visual proof
- Layer: tooling
- Stage: paint, composite
- Metrics: CLS, FPS/smoothness
- When: testing
- Impact: low, because it controls token cost and proof quality
- Do: Use `take_snapshot` to get uids and check text state. Use `take_screenshot` with `format: "webp"` and a `quality` value (or `filePath`) to prove that the chart rendered. Take them outside trace windows.
- Why: Snapshots are text and cheaper; image tokens scale with pixel size, so downscale with `--screenshotMaxWidth`/`--screenshotMaxHeight`. The trace already records screenshots (the server enables the screenshot trace category).
- Avoid/caveats: A canvas chart shows up as one element in the a11y snapshot; use a screenshot or a WebMCP state tool to check its content.
- Status: 1.9.0.
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md

### Run each comparison at least 3 times (prefer 5) and compare medians, one run at a time
- Layer: tooling
- Stage: main-thread-task, network
- Metrics: LCP, INP, CLS, FPS/smoothness
- When: testing
- Impact: high, because single lab runs vary enough to invert a conclusion
- Do: Run the same profile 3-5 times per variant, compare medians, and state the spread. Never run two traces or audits in parallel on one machine. Close other heavy apps. Keep the same URL, data fixture, and cache state.
- Why: Lighthouse reports that the median of 5 runs is about twice as stable as 1 run, and concurrent runs skew results through resource contention.
- Avoid/caveats: For scripted repeats, the experimental `chrome-devtools` CLI can call the same tools from a shell (for example `chrome-devtools performance_start_trace 1 --filePath run3.json.gz`); it runs headless and isolated by default, which changes GPU and cache behavior, so do not mix CLI and MCP runs in one comparison.
- Status: Lighthouse docs main; CLI experimental (1.x).
- Sources: https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md

### Give CrUX field data priority, and turn CrUX off for private URLs
- Layer: tooling
- Stage: network
- Metrics: LCP, INP, CLS
- When: testing
- Impact: medium, because field data shows what real users see, but sending private URLs to Google leaks them
- Do: When the summary shows "Metrics (field / real users)", fix the metrics that are bad in field data first. For localhost, staging, or internal URLs, start the server with `--no-performance-crux` (and `--no-usage-statistics` if policy requires).
- Why: The server sends trace URLs to the CrUX API to fetch p75 field data by default. Localhost has no CrUX data.
- Avoid/caveats: Field "scope" can be `origin` rather than `url`; do not compare it one-to-one with a single lab run.
- Status: 1.9.0 README and configuration.
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/README.md , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md

### Lock the test browser down before an agent drives it
- Layer: tooling
- Stage: network
- Metrics: startup
- When: testing
- Impact: medium, because the agent can read and change everything in the connected browser
- Do: Use a dedicated profile (`--isolated` or the default MCP profile), never your logged-in daily profile, for perf work. Add `--allowedUrlPattern` (Chrome 149+) or `--blockedUrlPattern` to stop the agent from reaching production or broker endpoints. Use `--redactNetworkHeaders` when traces touch authenticated APIs.
- Why: The README warns that the server exposes browser content to MCP clients. URL patterns block navigations and subresources at the browser level.
- Avoid/caveats: URL blocking disables network throttling in `emulate`. `--autoConnect` (Chrome 144+) attaches to your running Chrome and shows a permission dialog; use it only for debugging, not for measurement.
- Status: 1.9.0.
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md , https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session

### Install the DevTools-for-agents plugin to get the official perf skills
- Layer: tooling
- Stage: main-thread-task
- Metrics: LCP, memory
- When: testing
- Impact: low, because it adds tested workflows but no new capabilities
- Do: In Claude Code run `/plugin marketplace add ChromeDevTools/chrome-devtools-mcp` then `/plugin install chrome-devtools-mcp@chrome-devtools-plugins` to add the MCP server plus skills (`chrome-devtools`, `debug-optimize-lcp`, `memory-leak-debugging`, `a11y-debugging`, `cookie-debugging`, `troubleshooting`, `chrome-devtools-cli`).
- Why: The skills encode the tool order (navigate, trace, analyze, emulate, re-trace) and the leak workflow.
- Avoid/caveats: There is no official INP or render-loop skill; this notes file covers that gap.
- Status: developer.chrome.com get-started page (2026).
- Sources: https://developer.chrome.com/docs/devtools/agents/get-started , https://github.com/ChromeDevTools/chrome-devtools-mcp/tree/main/skills

### Expose DevTools-only debug hooks with third-party developer tools when agents outside DevTools must not see them
- Layer: tooling
- Stage: script-run
- Metrics: FPS/smoothness, memory
- When: testing
- Impact: low, because it is experimental and flag-gated
- Do: For hooks meant only for DevTools for agents, listen for the `devtoolstooldiscovery` event on `window` and call `event.respondWith({ name, description, tools: [...] })`. Enable with `--categoryExperimentalThirdParty`; call with `execute_3p_developer_tool` or `window.__dtmcp.executeTool(name, params)` inside `evaluate_script`.
- Why: Unlike WebMCP, this channel is discovered only by the DevTools MCP server, so browser agents and extensions that read WebMCP do not see the hooks.
- Example:
  ```js
  if (import.meta.env.DEV) {
    window.addEventListener('devtoolstooldiscovery', (event) => {
      event.respondWith({
        name: 'chart-perf',
        description: 'Dev-only chart performance probes',
        tools: [{
          name: 'series_point_counts',
          description: 'Returns point count per chart series.',
          inputSchema: { type: 'object', properties: {} },
          execute: () => window.__chartDebug?.pointCounts() ?? {},
        }],
      });
    });
  }
  ```
- Avoid/caveats: Experimental; the API can change. Not tested in this session (flag not set).
- Status: added in 0.25.0 (2026-05-06).
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/third-party-developer-tools.md

---

## Part 2 - WebMCP

### Status as of 2026-09-22

| Item | State | Source |
|---|---|---|
| Spec | W3C Web Machine Learning Community Group draft (`Status: CG-DRAFT`); not on a standards track yet | https://github.com/webmachinelearning/webmcp/blob/main/index.bs |
| API entry point | `document.modelContext` (getter moved from `Navigator` to `Document` in the spec on 2026-05-27, PR #184). `navigator.modelContext` is gone: Puppeteer PR #15069 switched to `document.modelContext` for Chrome 150; in Chrome 153 in this session `'modelContext' in navigator` was false and `'modelContext' in document` was true. Blogs disagree on the exact removal milestone (152 vs 153); not confirmed in Chrome release notes. | https://github.com/webmachinelearning/webmcp/commits/main , https://github.com/puppeteer/puppeteer/pull/15069 |
| Removed/renamed | `provideContext()` and `clearContext()` removed (2026-03-05); `unregisterTool()` removed from the spec and from Chrome 148 (unregister with an `AbortSignal`) | spec commits; Puppeteer PR #15069 |
| Chrome | Dev trial from Chrome 146 (flag); origin trial Chrome 149 to 156 (desktop and Android); ChromeStatus shows "Proposed", no ship milestone. Local dev: `chrome://flags/#enable-webmcp-testing`. | https://chromestatus.com/feature/5117755740913664 , https://developer.chrome.com/docs/ai/webmcp |
| Chrome behavior changes | Chrome 153: unregistering no longer cancels in-flight executions. Chrome 155: JSON-string input to `executeTool()` deprecated (pass an object). | https://developer.chrome.com/docs/ai/webmcp/imperative-api |
| Edge | Origin trial in Edge 150 | https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md |
| Firefox / Safari | Mozilla position: neutral. WebKit position: oppose (concerns listed: duplication, i18n, privacy, security, venue, use cases, portability, API design). No implementation. | https://api.webstatus.dev/v1/features/document-modelcontext |
| Agents | ChatGPT Desktop supports WebMCP; Brave Leo experimental; Chrome DevTools MCP exposes it behind a flag | implementation-status.md |
| Baseline | Not Baseline ("limited") | webstatus.dev |

API surface (spec IDL, 2026-09-17): `ModelContext.registerTool(tool, {exposedTo, signal})` returns a Promise; `getTools({fromOrigins})`; `executeTool(tool, input, {signal})`; events `toolchange`, `toolactivated`, `toolcancel`. `ModelContextTool` = `name` (1-128 chars of ASCII alphanumerics, `_`, `-`, `.`), optional `title`, `description` (required, non-empty), `inputSchema`, `execute(input, {signal})`, `annotations` = `readOnlyHint`, `untrustedContentHint`, `consequentialHint`, `debugging` (all default false). Declarative: `<form toolname tooldescription toolautosubmit>`, `toolparamdescription` on controls, `SubmitEvent.agentInvoked` and `SubmitEvent.respondWith(promise)`, CSS `:tool-form-active` and `:tool-submit-active`. Gated by the `tools` Permissions Policy (default `self`) and secure, origin-keyed documents.

How DevTools MCP exposes page tools: start the server with `--categoryExperimentalWebmcp` and launch Chrome with WebMCP on (source says Chrome 150+ with `--enable-features=WebMCP`; pass it with `--chromeArg`). `navigate_page` then appends a "## WebMCP tools" section. `list_webmcp_tools` prints `name`, `description`, `inputSchema`, `annotations`. `execute_webmcp_tool` takes `input` as a JSON-string object and returns `{status, output, errorText}`; statuses seen in Puppeteer are `Completed`, `Canceled`, and error. Observed in this session:
```text
list_webmcp_tools -> name="get_frame_stats", description="...", inputSchema={...}, annotations={"readOnly":true,"untrustedContent":false}
execute_webmcp_tool {"durationMs":300} -> {"status":"Completed","output":{"frames":20,"meanMs":15.75,"p95Ms":17.5}}
```
Note: Chrome 153 echoed only `readOnlyHint` and `untrustedContentHint` from `getTools()`; `consequentialHint` and `debugging` were not echoed.

---

### Register perf hooks as WebMCP tools only in development builds
- Layer: tooling
- Stage: script-run
- Metrics: bundle-size, startup
- When: build, testing
- Impact: high, because a shipped hook gives any connected agent or extension control over app internals
- Do: Put all hook tools in one module (for example `perf-hooks.dev.ts`) and load it through a branch that the bundler removes in production (`if (import.meta.env.DEV) await import(...)`). Also send `Permissions-Policy: tools=()` from production servers so no script, even an injected one, can register WebMCP tools there.
- Why: Statically false branches and their dynamic imports are dropped from production bundles. The spec lists the empty `tools` allowlist as a mitigation enforced before script runs, for all descendant frames.
- Example:
  ```ts
  // main.ts
  const app = await bootChartApp();
  if (import.meta.env.DEV) {
    const { registerPerfHooks } = await import('./perf-hooks.dev');
    const dispose = registerPerfHooks(app);
    import.meta.hot?.dispose(dispose);
  }
  ```
  ```http
  Permissions-Policy: tools=()
  ```
- Avoid/caveats: Do not guard only with a runtime query flag (for example `?perf=1`); the code still ships. Staging builds that face real accounts count as production here.
- Status: `tools` permission policy in spec and Chrome docs; WebMCP itself is origin-trial only (Chrome 149-156).
- Sources: https://github.com/webmachinelearning/webmcp/blob/main/index.bs (sections permissions-policy, mitigation-disable-permissions-policy) , https://developer.chrome.com/docs/ai/webmcp

### Design hook tools as small, read-mostly, bounded functions with compact outputs
- Layer: tooling
- Stage: script-run, main-thread-task, gpu-draw
- Metrics: FPS/smoothness, INP, memory, startup
- When: testing, animation/render-loop, long-lived session
- Impact: high, because well-shaped hooks let the agent run the same scenario every time and read one number
- Do: Expose a few single-purpose tools: `load_fixture_data` (deterministic synthetic data), `run_scenario` (named, time-boxed interaction script), `get_frame_stats` (frame-time percentiles for a window), `get_perf_summary` (User Timing measures, LoAF totals, heap), and `reset_state`. Use enums for scenario and fixture names, clamp every numeric input, honor the `signal`, and return aggregates under about 1.5 K characters. Set `readOnlyHint: true` on measurement tools.
- Why: Chrome's guidance suggests budgets of about 500 characters per description, 150 per parameter description, 30 per name, and 1.5 K per output, and one function per tool. Deterministic fixtures and scripted scenarios remove run-to-run variance that comes from live data and agent click paths.
- Example:
  ```ts
  // perf-hooks.dev.ts (SciChart.js v4 render events: preRenderAll, renderedToDestination, painted)
  type Mc = { registerTool(tool: object, opts?: { signal?: AbortSignal }): Promise<void> };

  export function registerPerfHooks(app: ChartApp): () => void {
    const mc = (document as unknown as { modelContext?: Mc }).modelContext;
    if (!mc) return () => {};
    const life = new AbortController();
    const add = (tool: object) =>
      mc.registerTool(tool, { signal: life.signal }).catch((e) => console.warn('[perf-hooks]', e));
    const clamp = (v: unknown, lo: number, hi: number, d: number) =>
      Math.min(hi, Math.max(lo, typeof v === 'number' ? v : d));

    add({
      name: 'load_fixture_data',
      description: 'Loads seeded synthetic OHLC data into the main chart and returns ms until the first painted frame.',
      inputSchema: { type: 'object', properties: {
        fixture: { type: 'string', enum: ['ohlc-10k', 'ohlc-1m', 'ticks-5m'] } }, required: ['fixture'] },
      async execute({ fixture }: { fixture: string }) {
        const t0 = performance.now();
        await app.loadFixture(fixture);              // local seeded generator, no network
        await app.nextPaint();                       // resolves on surface.painted
        return { fixture, points: app.pointCount(), firstPaintMs: Math.round(performance.now() - t0) };
      },
    });

    add({
      name: 'run_scenario',
      description: 'Runs a named, time-boxed chart scenario and returns User Timing and long-frame totals.',
      inputSchema: { type: 'object', properties: {
        scenario: { type: 'string', enum: ['stream-1k-ticks-per-s', 'zoom-pan-sweep', 'add-20-series'] },
        seconds: { type: 'number', description: '1 to 30' } }, required: ['scenario'] },
      async execute({ scenario, seconds }: { scenario: string; seconds?: number }, { signal }: { signal: AbortSignal }) {
        performance.mark(`scenario:${scenario}:start`);
        await app.runScenario(scenario, clamp(seconds, 1, 30, 5) * 1000, signal);
        performance.measure(`scenario:${scenario}`, `scenario:${scenario}:start`);
        return app.perfSummary(`scenario:${scenario}`);  // {measureMs, loafCount, blockingMs, frameP95Ms}
      },
    });

    add({
      name: 'get_frame_stats',
      description: 'Samples chart paints for a window and returns frame count, fps, and frame-time percentiles.',
      annotations: { readOnlyHint: true },
      inputSchema: { type: 'object', properties: { durationMs: { type: 'number', description: '200 to 10000' } } },
      async execute({ durationMs }: { durationMs?: number }, { signal }: { signal: AbortSignal }) {
        return app.sampleFrames(clamp(durationMs, 200, 10_000, 2000), signal); // {frames, fps, p50, p95, p99, maxMs}
      },
    });

    return () => life.abort();
  }
  ```
- Avoid/caveats: Do not return raw point arrays or full traces. Do not let one tool both load data and measure; separate setup from measurement. `app.*` methods here are placeholders for your own code.
- Status: WebMCP origin trial; guidance "subject to change" per Chrome docs (updated 2026-09-01).
- Sources: https://developer.chrome.com/docs/ai/webmcp/secure-tools , https://developer.chrome.com/docs/ai/webmcp/best-practices , https://www.scichart.com/documentation/js/v4/2d-charts/miscellaneous-apis/render-events/

### Keep hook execution out of the measured window
- Layer: tooling
- Stage: main-thread-task, script-run
- Metrics: FPS/smoothness, INP
- When: testing
- Impact: medium, because tools run on the page's main thread and add their own cost
- Do: Call `load_fixture_data` before `performance_start_trace`. Inside the trace, call only `run_scenario`. Call `get_frame_stats`/`get_perf_summary` after the trace or in a separate short window. Keep sampling code light (store numbers in a preallocated array; compute percentiles after sampling ends).
- Why: The spec queues tool execution on the document's event loop (the "webmcp task source"), so a tool call is main-thread work in the trace.
- Avoid/caveats: A `get_frame_stats` call that runs during a trace measures itself; label such numbers.
- Status: spec section "Event loop integration".
- Sources: https://github.com/webmachinelearning/webmcp/blob/main/index.bs

### Abort the old registration before you register again (HMR and remounts)
- Layer: tooling
- Stage: script-run
- Metrics: startup
- When: build, testing
- Impact: medium, because a duplicate name rejects and the hook silently disappears
- Do: Keep one `AbortController` per hook module; abort it on HMR dispose or component unmount; then register again. Handle the rejected promise from `registerTool()`.
- Why: The spec rejects `registerTool()` with `InvalidStateError` when the name already exists, when the name has invalid characters or is longer than 128, or when the description is empty. It rejects with `NotAllowedError` when the `tools` policy is off.
- Avoid/caveats: Chrome 153+ keeps in-flight executions when you unregister; your scenario must still honor its `signal` to stop.
- Status: spec 2026-09; Chrome docs updated 2026-09-11.
- Sources: https://github.com/webmachinelearning/webmcp/blob/main/index.bs , https://developer.chrome.com/docs/ai/webmcp/imperative-api

### Feature-detect `document.modelContext` and never depend on it for app behavior
- Layer: tooling
- Stage: script-run
- Metrics: startup
- When: build
- Impact: low, because detection costs nothing and prevents errors
- Do: Check `document.modelContext` (not `navigator.modelContext`) and return a no-op dispose function when it is missing. Keep all app features working without WebMCP.
- Why: The API exists only with the flag or an origin-trial token, only in Chromium, and the entry point moved during the trial.
- Avoid/caveats: Do not add a `navigator.modelContext` fallback for new code; it was absent in Chrome 153 (observed).
- Status: see status table.
- Sources: https://github.com/puppeteer/puppeteer/pull/15069 , https://developer.chrome.com/docs/ai/webmcp/imperative-api

### Drive hooks from the agent with `list_webmcp_tools` and `execute_webmcp_tool`
- Layer: tooling
- Stage: script-run
- Metrics: FPS/smoothness, INP, memory
- When: testing
- Impact: high, because it replaces fragile pixel clicks on canvas charts with exact, repeatable calls
- Do: Start the MCP server with `--categoryExperimentalWebmcp` and Chrome with WebMCP enabled (for example `--chromeArg=--enable-features=WebMCP`, Chrome 150+). After navigation, call `list_webmcp_tools`, then `execute_webmcp_tool` with `input` as a JSON string. Check `status === "Completed"` before you use `output`.
- Why: The MCP handler parses `input`, finds the tool by name in Puppeteer's `page.webmcp.tools()`, runs `tool.execute(input)`, and prints `{status, output, errorText}`.
- Example:
  ```jsonc
  {"tool":"execute_webmcp_tool","pageId":1,"toolName":"load_fixture_data","input":"{\"fixture\":\"ohlc-1m\"}"}
  {"tool":"performance_start_trace","pageId":1,"reload":false,"autoStop":false}
  {"tool":"execute_webmcp_tool","pageId":1,"toolName":"run_scenario","input":"{\"scenario\":\"zoom-pan-sweep\",\"seconds\":5}"}
  {"tool":"performance_stop_trace","pageId":1,"filePath":"traces/zoom-run1.json.gz"}
  ```
- Avoid/caveats: Required Chrome version and flag text differ between sources (MCP source: Chrome 150+ with `--enable-features=WebMCP`; an older MCP PR: `WebMCPTesting`; Puppeteer guide: Chrome 151+; the DevTools WebMCP panel doc names a flag `--categoryWebMCP`). The server flag that works in the tool reference is `--categoryExperimentalWebmcp`.
- Status: tools added 2026-04-16 (MCP 0.22.0); verified live in this session.
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/webmcp.ts , https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/config/category-options.ts , https://github.com/puppeteer/puppeteer/blob/main/docs/guides/webmcp.md , https://developer.chrome.com/docs/devtools/application/webmcp

### Treat every hook as reachable by any agent or extension on the page, and keep it harmless
- Layer: tooling
- Stage: script-run
- Metrics: memory, INP
- When: testing
- Impact: high, because in a trading app a mistaken tool can place orders or leak account data
- Do: Expose only synthetic-data and measurement tools. Never expose tools that send orders, change account settings, read tokens or personal data, or call write endpoints. Mark any tool whose output contains server or user text with `untrustedContentHint: true`, and any state-changing tool with `readOnlyHint: false`. Clamp inputs so no call can freeze the main thread. Do not set `exposedTo` in dev hooks.
- Why: Tool output goes into the model context and can carry prompt injection; the spec lists prompt injection, misrepresentation of intent, and privacy leakage through over-parameterization as key risks. Chrome notes that extensions with content scripts can query and run WebMCP tools. The one sanctioned "dangerous tool" marker, `consequentialHint`, lets agents ask for confirmation, but Chrome 153 did not echo it in `getTools()`.
- Avoid/caveats: The spec added a `debugging: true` annotation (2026-09-17, "intended for debugging and developer tooling"), but Chrome 153 did not return it (observed); do not rely on it to hide tools from end-user agents.
- Status: spec and Chrome docs, 2026-09.
- Sources: https://github.com/webmachinelearning/webmcp/blob/main/index.bs (security-privacy) , https://developer.chrome.com/docs/ai/webmcp/secure-tools

### Use declarative form tools only for simple dev settings panels
- Layer: tooling
- Stage: html-parse, script-run
- Metrics: startup
- When: testing
- Impact: low, because charts need imperative tools; forms help only for settings
- Do: If a dev-only settings form exists (series count, update rate, render mode), add `toolname`, `tooldescription`, and `toolparamdescription`; add `toolautosubmit` only if a submit is harmless. In the `submit` handler, when `event.agentInvoked` is true, call `event.preventDefault()` then `event.respondWith(promiseOfResult)` to return a result without navigation.
- Why: The browser builds the input schema from the form controls (labels, `select` options become `enum`/`anyOf`); `:tool-form-active` and `:tool-submit-active` show the agent-filled state.
- Example:
  ```html
  <form toolname="set_stream_rate" tooldescription="Sets the synthetic tick rate for the dev chart." toolautosubmit>
    <select name="ticksPerSecond" toolparamdescription="Ticks per second">
      <option value="100">100</option><option value="1000">1000</option><option value="10000">10000</option>
    </select>
    <button>Apply</button>
  </form>
  ```
- Avoid/caveats: Schema synthesis rules are not fully specified yet; removing `toolname` or `tooldescription` unregisters the tool.
- Status: declarative API in Chrome origin trial; webstatus.dev "limited".
- Sources: https://developer.chrome.com/docs/ai/webmcp/declarative-api , https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md

### Inspect hooks with the DevTools WebMCP pane before you automate them
- Layer: tooling
- Stage: script-run
- Metrics: startup
- When: testing
- Impact: low, because it catches schema and output errors quickly
- Do: Open DevTools > Application > WebMCP to see available tools, the invocation log (status, input, output), and to run a tool manually with edited input. For a quick chat-style check, use the Model Context Tool Inspector extension.
- Why: The pane shows schema violations and per-tool call counts, which shows whether an agent ever picked your tool.
- Avoid/caveats: The inspector extension sends prompts to a Gemini model by default; do not use it with private data.
- Status: Chrome docs 2026.
- Sources: https://developer.chrome.com/docs/devtools/application/webmcp , https://developer.chrome.com/docs/ai/webmcp

---

## Agent performance-testing playbook

Goal: prove that a code change makes a measured metric better (or not worse), with numbers that another person can repeat.

### 0. Prepare (once per session)
1. Server flags: default categories plus, when needed, `--memoryDebugging`, `--categoryExperimentalWebmcp`, `--chromeArg=--enable-features=WebMCP`, `--no-performance-crux` (private URLs), `--allowedUrlPattern=http://localhost:*/*` (Chrome 149+). Do not use `--headless` for GPU work unless you have checked the renderer.
2. Record the environment: `evaluate_script` for Chrome version (`navigator.userAgentData.getHighEntropyValues(['fullVersionList'])`), WebGL renderer, WebGPU adapter, DPR. Record the MCP version and the git commit.
3. Pick one profile per question:

| Question | Profile (`emulate` in ONE call) | Trace mode |
|---|---|---|
| Load speed, mobile | `cpuThrottlingRate: 4, networkConditions: "Slow 4G", viewport: "412x823x1.75,mobile,touch"` | `reload: true, autoStop: true`, cold (fresh `isolatedContext` or manual reload with `ignoreCache`) |
| Load speed, desktop terminal | no throttling (or `cpuThrottlingRate: 2` for low-end desktop), `viewport: "1920x1080x1"` | same |
| Interaction (INP) | `cpuThrottlingRate: 4` (mobile) or `2` (desktop) | `reload: false, autoStop: false` around one interaction |
| Render loop / streaming chart | `cpuThrottlingRate: 4`, viewport at DPR 1 and 2 | `reload: false, autoStop: false`, 5-10 s scenario |
| Memory over time | no throttling | no trace; heap snapshots |

### 1. Baseline (before the code change)
1. `navigate_page` to the URL. `wait_for` the "ready" text (or poll a WebMCP state tool).
2. `emulate` with the full profile.
3. Setup outside the trace: `execute_webmcp_tool load_fixture_data`.
4. Trace:
   - Load: `performance_start_trace {reload: true, autoStop: true, filePath: "traces/<change>-base-<n>.json.gz"}`.
   - Interaction / render loop: `performance_start_trace {reload: false, autoStop: false}` -> `click`/`press_key` or `execute_webmcp_tool run_scenario` -> `performance_stop_trace {filePath: ...}`.
5. Confirm the header lines `CPU throttling` and `Network throttling` match the profile. If not, discard the run.
6. Call `performance_analyze_insight` for each listed insight that matters (see the insight table). Save the text.
7. Collect in-page data with `evaluate_script` (`waitForStableDom: false`): LoAF summary, paint/navigation/resource summary; or `execute_webmcp_tool get_frame_stats` / `get_perf_summary`.
8. `list_console_messages {types: ["error","warn","issue"]}`.
9. Repeat steps 1-8 for 3 runs (5 when the expected change is small). Never in parallel.

### 2. Change the code
Make one change per comparison. Rebuild. Confirm with `take_screenshot` (webp) that the chart still renders the same data.

### 3. Re-trace
Repeat section 1 with identical URL, fixture, profile, cache state, and run count. Name files `<change>-after-<n>`.

### 4. Compare
1. Compute the median and the min-max spread per metric for "base" and "after".
2. Accept an improvement only if the median moves by more than the spread of the baseline runs (or by a preset minimum, for example 5% or 20 ms, whichever is larger).
3. Compare insight lists: an insight that disappeared, or whose "Estimated savings" dropped, supports the claim. A new insight is a regression to explain.
4. Check for side effects: CLS change, new console errors, request count or transfer bytes up, heap up.
5. For memory changes: baseline snapshot -> scenario x10 -> revert -> snapshot, before and after the change; compare with `compare_heapsnapshots`.
6. If a result is GPU-bound (frame time high but LoAF/main-thread time low), mark it "needs real-device check".

### 5. What to record (one row per run)

| Field | Where it comes from |
|---|---|
| run id, date, git commit, change name | agent |
| Chrome version, MCP version, GPU renderer, DPR | `evaluate_script`, server |
| profile name + CPU rate + network preset + viewport | `emulate` call and trace header |
| cache state (cold/warm) | how you loaded |
| insight set id | trace summary |
| LCP, LCP subparts (TTFB, load delay, load duration, render delay) | trace summary / `LCPBreakdown` |
| CLS and top culprit | trace summary / `CLSCulprits` |
| INP and subparts (input delay, processing, presentation delay) | `INPBreakdown` |
| FCP, TTFB | `evaluate_script` (paint + navigation timing) |
| LoAF count, sum of `blockingDuration`, worst frame, top 3 scripts | `evaluate_script` LoAF summary |
| frame p50/p95/p99, fps, frames > 50 ms | WebMCP `get_frame_stats` |
| request count, transfer KB by type, render-blocking count | `evaluate_script` resource summary |
| insight names + estimated savings | trace summary and analyze calls |
| console error/warn count | `list_console_messages` |
| heap snapshot path and size (memory runs) | `take_heapsnapshot`, `get_heapsnapshot_summary` |
| trace file path, screenshot path | `filePath` values |

---

## Sources read
- https://github.com/ChromeDevTools/chrome-devtools-mcp (README.md)
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/slim-tool-reference.md
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/design-principles.md
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/third-party-developer-tools.md
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/CHANGELOG.md (1.9.0, 2026-09-08 and earlier)
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/performance.ts
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/emulation.ts
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/lighthouse.ts
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/webmcp.ts
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/comments.ts
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/processors/PerformanceTrace.ts
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/McpPage.ts
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/McpResponse.ts
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/formatters/NetworkFormatter.ts
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/config/category-options.ts
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/chrome-devtools/SKILL.md
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/debug-optimize-lcp/SKILL.md (+ references/lcp-breakdown.md, lcp-snippets.md)
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/memory-leak-debugging/SKILL.md (+ references/common-leaks.md)
- GitHub PRs: chrome-devtools-mcp #1845, #1873, #1993, #2163; puppeteer #15069
- https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/insights/Models.ts and the 19 insight files (UIStrings, categories)
- https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/insights/types.ts , .../Processor.ts , .../types/TraceEvents.ts
- https://developer.chrome.com/blog/chrome-devtools-mcp
- https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session
- https://developer.chrome.com/docs/devtools/agents
- https://developer.chrome.com/docs/devtools/agents/get-started
- https://developer.chrome.com/docs/devtools/agents/use-cases/emulation
- https://developer.chrome.com/docs/devtools/agents/use-cases/lighthouse-audit
- https://developer.chrome.com/docs/devtools/application/webmcp
- https://developer.chrome.com/docs/devtools/settings/throttling
- https://developer.chrome.com/blog/new-in-devtools-134
- https://developer.chrome.com/blog/devtools-grounded-real-world
- https://developer.chrome.com/docs/web-platform/long-animation-frames
- https://developer.chrome.com/docs/ai/webmcp
- https://developer.chrome.com/docs/ai/webmcp/imperative-api
- https://developer.chrome.com/docs/ai/webmcp/declarative-api
- https://developer.chrome.com/docs/ai/webmcp/best-practices
- https://developer.chrome.com/docs/ai/webmcp/secure-tools
- https://developer.chrome.com/docs/ai/webmcp/build-tools
- https://developer.chrome.com/docs/ai/webmcp/evals
- https://developer.chrome.com/blog/ai-webmcp-origin-trial
- https://developer.chrome.com/release-notes/149 through /154 (checked for WebMCP; no entries)
- https://github.com/webmachinelearning/webmcp (README.md, declarative-api-explainer.md, implementation-status.md, index.bs, commit history)
- https://chromestatus.com/feature/5117755740913664 (via api/v0/features JSON)
- https://api.webstatus.dev/v1/features/document-modelcontext , declarative-webmcp, long-animation-frames, event-timing, largest-contentful-paint, layout-instability, soft-navigations
- https://github.com/puppeteer/puppeteer/blob/main/docs/guides/webmcp.md , docs/api/puppeteer.webmcptoolcallresult.md , packages/puppeteer-core/src/cdp/PredefinedNetworkConditions.ts
- https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md , docs/variability.md
- https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming , PerformanceScriptTiming , PerformanceScriptTiming/invokerType
- https://web.dev/articles/vitals
- https://github.com/GoogleChrome/web-vitals (README, CHANGELOG, v6.2.2)
- https://www.scichart.com/documentation/js/v4/2d-charts/miscellaneous-apis/render-events/
- Blogs (search snippets only, used only for the navigator-to-document timing claim, marked unverified): spronta.com "State of WebMCP July 2026", modelpiper.com, dev.to posts
- Live checks in this session (Chrome 153.0.8010.53 on https://example.com): `list_pages`, `navigate_page`, one `performance_start_trace` (reload+autoStop), one `performance_analyze_insight` (LCPBreakdown), three `evaluate_script` reads (entry types, modelContext presence, GPU info; one registration of a demo WebMCP tool), `list_webmcp_tools`, `execute_webmcp_tool`.

## Not covered / could not access
- Exact Chrome milestone that removed the `navigator.modelContext` alias: blogs say 152 or 153 (they disagree); Chrome release notes 149-154 have no WebMCP entry. Only the spec move (2026-05-27), Puppeteer's Chrome-150 switch, and my Chrome 153 observation are verified.
- Whether Chrome implements the new `debugging` and `consequentialHint` annotations beyond echoing: Chrome 153 did not return them from `getTools()`; Chromium source was not read.
- The Intent to Experiment thread and the Google Docs linked from ChromeStatus were not read.
- Flag names conflict across sources (`--enable-features=WebMCP` vs `WebMCPTesting`; `--categoryExperimentalWebmcp` vs DevTools doc `--categoryWebMCP`; Chrome 150+ vs 151+). Not resolved by a test launch.
- Whether `navigate_page` `initScript` also applies to the internal reload inside `performance_start_trace`: not verified.
- Whether `SlowCSSSelector` can appear in MCP traces: the server enables only the JS-sampling and screenshot optional trace categories; selector stats is an optional DevTools setting, so this insight is probably absent (inference, not tested).
- Whether DevTools network emulation throttles WebSocket frames (relevant to streaming market data): not verified.
- Whether Chrome "[Violation]" log entries reach `list_console_messages`: not verified.
- Third-party developer tools, `get_css_styles`, `click_at`, screencast, and the `--memoryDebugging` analysis tools were not in this session's tool set, so they were not tested live (documented from the repo only). The session's server build is older than 1.9.0 docs (it lacks `get_css_styles`).
- No INP or render-loop trace was run (the task allowed one trial trace); those recipes are built from tool semantics and source code.
- GPU timing inside traces (WebGL/WebGPU GPU tasks) and how the MCP trace summary reports them were not examined.
