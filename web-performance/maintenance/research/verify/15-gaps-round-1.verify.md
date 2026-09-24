# Verify: 15-gaps-round-1.md

Checked 2026-09-23. Items checked: 47 (every `### ` heading). The "Status fixes" tables (not `###` items) were also checked. Their facts are correct.

| Verdict | Count |
|---|---|
| verified | 31 |
| corrected | 12 |
| disputed | 3 |
| unverified | 1 |

Data used: BCD 8.1.2 (build 2026-09-17, still npm `latest` on 2026-09-23) and web-features (browser releases up to Chrome 153, Firefox 156, Safari 27) in `raw/`. Query script: `raw/verify/15g1/q.py`. Chrome milestones from chromiumdash: 153 stable 2026-09-08, 154 stable 2026-09-22, 155 stable 2026-10-06. I read the source myself for: scichart 5.2.69 (npm tarball, `raw/verify/15g1/sc/`), chrome-devtools-mcp 1.10.1 (npm `gitHead` e52c6b5, `raw/verify/15g1/mcp/`), devtools-frontend main (DebuggerModel.ts, TimelineController.ts, TraceEvents.ts, PerformanceTraceFormatter.ts), V8 HEAD (v8-debugger.cc, wasm-engine.cc), and Chromium HEAD (node.cc, compositor_animations.cc/.h, runtime_enabled_features.json5, builtin_categories.h). I also read the HTML spec (webappapis, scripting, links, server-sent-events), CSS Contain 2 and the WebSockets spec.

---

### Enable navigation preload only for navigations that your fetch handler sends to the network
- Verdict: verified
- Note: web.dev says boot is "usually around 50ms. On mobile it's more like 250ms", so "50 ms on desktop" is a small paraphrase. The quote "isn't a problem if you're responding from the cache", the double-request warning, `Service-Worker-Navigation-Preload: true`, `setHeaderValue()` and `Vary` all match. MDN `addRoutes` throws `TypeError` for `source: "fetch-event"` with no fetch handler. The Workbox dos-and-don'ts page uses `NetworkOnly` navigations together with `workbox-navigation-preload`. BCD: preload Chrome 59, Firefox 99, Safari 15.4. `addRoutes` Chrome 123, Safari 27, no Firefox. web-features `service-workers-static-routes` is not Baseline. The WebKit Safari 27 notes confirm static routing.
- Evidence: https://web.dev/blog/navigation-preload, https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes, https://developer.chrome.com/docs/workbox/precaching-dos-and-donts, https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

### Do not expect speed from `contain: style`; it scopes only counters and quotes
- Verdict: verified
- Note: CSS Contain 2 §3.4 lists only counter scoping (`counter-increment`, `counter-set`) and quote scoping. BCD `css.properties.contain.style` gives Safari "27" plus "15.4-27 [no quotes, webkit.org/b/232083]". The WebKit 27.0 page says "adds support for `contain: style` applying to CSS quotes". web-features `contain-style`: low 2022-07-26, high 2025-01-26. Add one missing fact: BCD also has a Chrome note, "Before Chrome 115, style containment did not affect quotes". So the Status line should read "Chrome 52 (quotes from 115)".
- Evidence: https://drafts.csswg.org/css-contain-2/#containment-style, https://webkit.org/blog/18325/webkit-features-for-safari-27-0/, raw/bcd.json `css.properties.contain.style`

### Pause off-screen chart panes with `contentvisibilityautostatechange`, gate it with `CSS.supports`, and keep an IntersectionObserver fallback
- Verdict: corrected
- Correction: The WPT test does fire the event once for a newly inserted element, but its listener is added before `appendChild`. If you add the listener after the pane was first rendered (for example after an async `SciChartSurface.create()`), you miss the first event. A pane that starts off-screen then never pauses until it scrolls in and out again. Fix: add the listener before you insert the pane or before you set `content-visibility: auto`. Otherwise, do one initial check: `pane.firstElementChild.checkVisibility({ contentVisibilityAuto: true })` returns false while the content is skipped (option support: Chrome 121, Firefox 122, Safari 17.4, BCD). All other facts match BCD 8.1.2: content-visibility is Chrome 85, Firefox 125, Safari 18; `auto` is partial in Safari 18.x and full in 26; the event is Chrome 108, Firefox 130 (124-129 without the `on…` property), Safari 18. web-features gives low 2025-09-15. SciChart 5.2.69 `freezeWhenOutOfView` uses `VisibilityObserver` (IntersectionObserver, `threshold: 0.01`) and `suspender.lock()`, as the notes say.
- Evidence: https://github.com/web-platform-tests/wpt/blob/master/css/css-contain/content-visibility/content-visibility-auto-state-changed-first-observation.html, https://developer.mozilla.org/en-US/docs/Web/API/Element/checkVisibility, raw/bcd.json `api.Element.checkVisibility.options_contentVisibilityAuto_parameter`, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Core/ObserveVisibility.js

### Treat Wasm timings taken through Chrome DevTools MCP as debug-tier numbers
- Verdict: corrected
- Correction: The source chain is correct. At 1.10.1, `McpPage.init()` calls `#initDevToolsUniverseNoThrow()`. `createTargetUniverse` sets `overrideAutoStartModels: new Set([DevTools.DebuggerModel])`. The `DebuggerModel` constructor calls `enableDebugger()`, which calls `Debugger.enable` and `setAsyncCallStackDepth({maxDepth: 32})`. In V8, `V8Debugger::enable()` calls `EnterDebuggingForIsolate`, which removes non-debug Wasm code. One fix is needed. V8 counts enables per isolate: `enable()` does `if (m_enableCount++) return;`, and `disable()` does `if (--m_enableCount) return;` before `LeaveDebuggingForIsolate`. The Performance panel's `suspendAllTargets()` disables only its own DevTools session. So the Performance panel removes the tier-down only when no other debugger client is attached. If MCP (or any other CDP client with `Debugger.enable`) is attached to the same page, Wasm stays in Liftoff debug code during a Performance-panel recording too. Change the Do line to: "Get production numbers from a browser that has no MCP or other CDP debugger client attached. The DevTools Performance panel lifts the tier-down only when it is the only debugger client." V8 also recompiles with TurboFan only after the tier-up starts, so the first seconds of a recording can still run Liftoff code.
- Evidence: https://chromium.googlesource.com/v8/v8/+/HEAD/src/inspector/v8-debugger.cc (V8Debugger::enable/disable, lines 104-145), https://chromium.googlesource.com/v8/v8/+/HEAD/src/wasm/wasm-engine.cc (EnterDebuggingForIsolate/LeaveDebuggingForIsolate), https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/core/sdk/DebuggerModel.ts, https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/panels/timeline/TimelineController.ts, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/e52c6b59b476c5e04d8dd9fd4bd017ba3b3d65df/src/devtools/DevtoolsUtils.ts, https://v8.dev/docs/wasm-compilation-pipeline

### Treat `unload` as gone in Chrome 154+ and still a bfcache blocker in Firefox
- Verdict: verified
- Note: The Chrome page (updated 2026-07-14) has the rollout table 146=1% … 152=80%, 154=100% (2026-09-22). M153 is skipped. The page says "Version numbers and dates are subject to change". The policy name `ForcePermissionPolicyUnloadDefaultEnabled` matches. chromiumdash confirms that 154 went stable on 2026-09-22 and that 155 is due on 2026-10-06. web.dev bfcache (updated 2026-07-02): "On desktop, Chrome and Firefox have chosen to make pages ineligible". Firefox mobile is also ineligible (except on iOS). I found no public confirmation that the 100% step actually shipped in 154, so it stays the published plan. BCD: `Permissions-Policy` `unload` Chrome 115 only.
- Evidence: https://developer.chrome.com/docs/web-platform/deprecating-unload, https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=154, https://web.dev/articles/bfcache

### Carry verify/01 corrections into the final 01 by content, not by title
- Verdict: corrected
- Correction: The grep claims are true. `01-critical-rendering-path.md` is byte-identical to `.run2.md`, and lines 43, 148, 197 and 885 still carry the stale text. The replacement facts are correct: BCD passive default for touch is Chrome 55, Firefox 61, Safari 11.1, and for wheel Chrome 73, Firefox 84, no Safari. `ascent-override` has Safari only "preview", and `size-adjust` is Chrome 92, Firefox 92, Safari 17. One source attribution is wrong. `docs/tool-reference.md` (1.10.1) does not state the defaults for `reload`/`autoStop`. The defaults (`true`) come from `src/tools/performance.ts` (`zod.boolean().default(true)`). The docs do list `pageId` as required.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/e52c6b59b476c5e04d8dd9fd4bd017ba3b3d65df/src/tools/performance.ts, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/e52c6b59b476c5e04d8dd9fd4bd017ba3b3d65df/docs/tool-reference.md, raw/bcd.json `api.EventTarget.addEventListener.options_parameter.options_passive_parameter_default_true_wheel`, verify/01-critical-rendering-path.verify.md

### Apply GPU decimation rules to custom renderers only; for SciChart, rely on its resampler and pre-aggregate only the series it does not resample
- Verdict: verified
- Note: `BaseRenderableSeries.supportsResampling` (5.2.69) excludes UniformContours, UniformHeatmap, PolarUniformHeatmap, NonUniformHeatmap, Bubble, ErrorBars, BoxPlot and LineSegment. It also requires `!isStacked`, `enableDrawingOptimisations || fifoCapacity` (where `enableDrawingOptimisations` = `resamplingMode !== None`), and `isSortedAscending || xAxis.isCategoryAxis`. Scatter is commented out of the exclusion list, so scatter is resampled. No subclass overrides `supportsResampling`.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/RenderableSeries/BaseRenderableSeries.js (lines 543-550, 1270-1296)

### Put one inline import map before the first module script and every modulepreload
- Verdict: verified
- Note: HTML spec: "merge existing and new import maps … ensures that new import maps cannot define the module resolution for modules that were already defined by past import maps, or for ones that were already resolved". An importmap with `src` fires `error` ("External import maps … are not currently supported"). BCD: importmap Chrome 89, Firefox 108, Safari 16.4. multiple_import_maps Chrome 133, Safari 18.4, Firefox 150 flag. `integrity` Chrome 127, Firefox 138, Safari 18. `HTMLScriptElement.supports` Chrome 96, Firefox 94, Safari 16. web-features `import-maps` high 2025-09-27. `modulepreload` is widely available from 2026-03-18. One missing fact (see "Missing but important" #1): import maps apply only to `Window` globals, so worker code cannot use mapped specifiers.
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html#import-maps, https://html.spec.whatwg.org/multipage/scripting.html#prepare-the-script-element, raw/bcd.json

### Use an import map of hashed chunk URLs to stop cascading cache invalidation and keep V8 code caches warm
- Verdict: corrected
- Correction: Add this caveat. The HTML spec says "For now, only Window global objects have their import map modified from the initial empty one". Dedicated, shared and service workers therefore resolve specifiers with an empty import map. Chunks that are imported inside a module worker (for example the market-data decode worker) cannot use the stable names from the map, so they fail to load or load the unhashed URL. Keep worker entry chunks and their imports out of `chunkImportMap`, or give them normal hashed URLs. The other facts match their sources. Rolldown documents `experimental.chunkImportMap` as an input option (`boolean | { baseUrl?, fileName? }`) with the words "preventing cascading cache invalidation caused by content hashes". The Rolldown docs do not mention workers. v8.dev says code caches "are (currently) associated with the URL of a script" and gives "less than 100 modules" / "maximum depth less than 5" for unbundled production.
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html#concept-global-import-map, https://rolldown.rs/reference/Interface.RolldownOptions, https://v8.dev/blog/code-caching-for-devs, https://v8.dev/features/modules

### Add an `integrity` map for module chunks instead of per-tag attributes
- Verdict: verified
- Note: "resolve a module integrity metadata" is used for descendant imports, for `<script type="module" src>` without an `integrity` attribute, and for `<link rel="modulepreload">` without `integrity`. So the map also covers top-level module scripts and module preloads. As with the item above, the map does not apply in workers. BCD: Chrome 127, Firefox 138, Safari 18.
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html#resolving-a-module-integrity-metadata, https://html.spec.whatwg.org/multipage/links.html#link-type-modulepreload

### Choose rendering by page type: server HTML for public pages, a client-rendered app shell for the logged-in terminal
- Verdict: verified
- Note: web.dev "Rendering on the web" (updated 2026-01-05) says SSR with rehydration "can have a significant negative impact on TBT and INP", and that CSR with a tight budget can "almost replicate the performance of pure server-side rendering". The CSR article confirms chunked parsing with yields and that the preload scanner cannot see client-built HTML. SvelteKit calls `ssr = false` "not recommended" in most situations, and the flag can go in `+layout.js`.
- Evidence: https://web.dev/articles/rendering-on-the-web, https://web.dev/articles/client-side-rendering-of-html-and-interactivity, https://svelte.dev/docs/kit/page-options

### When you do SSR, budget hydration: avoid double-serialized state, and hydrate islands progressively
- Verdict: verified
- Note: The quotes match: "one app for the price of two", "Partial rehydration has proven difficult to implement", "challenges for caching", and the "Promise that hasn't resolved yet" failure.
- Evidence: https://web.dev/articles/rendering-on-the-web

### Update live numbers by writing to a persistent Text node, not `innerHTML`
- Verdict: verified
- Note: MDN says setting `textContent` "removes all of the node's children and replaces them with a single text node", and says `innerHTML` is "slower because it needs to invoke the HTML parser". Blink `Node::setTextContent` matches this, with one shortcut. When the element has one Text child with identical data, and there are no MutationObservers, it returns early. Otherwise it calls `RemoveChildren()` and appends a new Text node. So the item's "only when the string changed" check also matters for `textContent`.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent, https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/dom/node.cc (Node::setTextContent), https://dom.spec.whatwg.org/#dom-node-textcontent

### Give live numeric cells a fixed width and `font-variant-numeric: tabular-nums`
- Verdict: corrected
- Correction: (1) "put `contain: layout paint` on the cell or the row": CSS Contain 2 says layout and paint containment have no effect "if its principal box is an internal table box other than table-cell". So on a `<tr>` it does nothing. Use it on `<td>`, or on a non-table row (for example a grid or flex `div`). Size containment has no effect on any internal table box, including cells. (2) Status: `font-variant-numeric` is newly available from 2020-01-15 and widely available from 2022-07-15 (web-features), not "widely available since 2020". The BCD versions (Chrome 52, Firefox 34, Safari 9.1) are correct. The CLS facts are correct: "discrete input events, such as tap, click, or keypress".
- Evidence: https://drafts.csswg.org/css-contain-2/#containment-layout, https://drafts.csswg.org/css-contain-2/#containment-paint, raw/web-features.json `font-variant-numeric`, https://web.dev/articles/cls

### Use `table-layout: fixed` with an explicit width for large or live tables
- Verdict: verified
- Note: MDN: the fixed algorithm is faster, the table "can be rendered once the first table row has been downloaded and analyzed", and the width "needs to be specified explicitly". web-features `table`: low 2015-07-29, high 2018-01-29 ("available across browsers since July 2015" per MDN).
- Evidence: https://developer.mozilla.org/en-US/docs/Web/CSS/table-layout

### Update rows in place with stable keys; never rebuild a live list per tick
- Verdict: disputed
- Correction: (1) The example keys order-book levels by `lvl.price`. In a depth ladder, levels move, appear and disappear on almost every tick, so a key by price makes Svelte insert, move and delete `<tr>` nodes every tick. For fixed-slot ladders, an unkeyed (slot) `{#each}` updates the text in existing rows and does no DOM moves. js-framework-benchmark: non-keyed "can be more performant, since costly DOM operations can be avoided". Key by id only when a row has identity that must survive (orders, positions, watchlist symbols, focus or selection, or per-row flash state). (2) "background-color needs a repaint" is stale for Chromium CSS and Web Animations: `CompositeBGColorAnimation` has status "stable" in Chromium's runtime_enabled_features.json5, and compositor_animations.cc accepts `background-color` and `clip-path` keyframes. An opacity overlay is still the cross-engine choice. The Svelte docs quotes ("inserting, moving and deleting"; "strings and numbers are recommended") match.
- Evidence: https://github.com/krausest/js-framework-benchmark, https://svelte.dev/docs/svelte/each, https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/runtime_enabled_features.json5, https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/animation/compositor_animations.cc

### Keep SVG charts and overlays small: few elements, one path per series, no per-point nodes
- Verdict: verified
- Note: The bklit SKILL.md exists and says continuous `d` morphing "runs layout + paint every frame, per series". It recommends static paths after enter and hover through `motion.g`. BCD `css.properties.vector-effect`: Chrome 6, Firefox 15, Safari 5.1. See the next item for a Chromium limit on `vector-effect` combined with composited transforms.
- Evidence: https://github.com/bklit/bklit-ui/blob/main/.agents/skills/bklit-studio-chart-performance/SKILL.md, raw/bcd.json

### Freeze SVG geometry after the enter animation; move hover and pan with `transform` on a group, and keep hover state apart from data state
- Verdict: corrected
- Correction: (1) The astryx issue (created 2026-09-23) reports that the wrapper `<span>` rotation dropped style recalcs from 120/s to 11-12/s, and that paints were 0 in all rotate variants. It is not "paints to 11-12 per second". Only the `stroke-dashoffset` variant painted (240 to 3,597/s). (2) The conflict can be resolved from Chromium source. `compositor_animations.cc` composites SVG `transform` animations except in these cases: the property is `rotate`, `scale` or `translate` (`kSVGTargetHasIndependentTransformProperty`); the effective zoom is not 1 (common in Electron with a zoom factor); the target is a container with an extra transform (`<svg>`/`<symbol>` viewBox or x/y, `<use>` x/y); "the subtree has vector effect" (`TransformAffectsVectorEffect`); the element has SMIL animations; or the element is inside an SVG resource. So `vector-effect: non-scaling-stroke` under an animated `<g>` stops the compositing that this item wants. (3) The pan example writes the `transform` attribute from JS each frame. That is a style change, not an animation, and it repaints on the main thread each frame. It is still cheaper than rebuilding `d`. Keep "animate an HTML wrapper" as the reliable path.
- Evidence: https://github.com/facebook/astryx/issues/6473, https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/animation/compositor_animations.cc (CheckCanStartTransformAnimationOnCompositorForSVG), https://developer.chrome.com/blog/hardware-accelerated-animations

### Do not animate SVG filters, blur or drop-shadow on live content; use `shape-rendering: crispEdges` for axis-aligned grids
- Verdict: verified
- Note: web.dev issue 3790 lists blur, drop-shadow and `url()` under "Filter related property may move pixels". Chromium HEAD still sets `kFilterRelatedPropertyMayMovePixels` when `HasFilterThatMovesPixels()`. `backdrop-filter` is exempt. The MDN `shape-rendering` wording matches. web-features `svg` (which includes `shape-rendering`/`vector-effect`): widely available.
- Evidence: https://github.com/GoogleChrome/web.dev/issues/3790, https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/animation/compositor_animations.cc, https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/shape-rendering

### Receive binary market data as ArrayBuffer and decode it off the main thread
- Verdict: verified
- Note: The WebSockets spec says: "if it is "blob", it is safe to spool it to disk, and if it is "arraybuffer", it is likely more efficient to keep the data in memory". The IDL is `[Exposed=(Window,Worker)] interface WebSocket`. BCD: binaryType Chrome 15, Firefox 11, Safari 6. WebSocketStream is Chrome 124 only and experimental. A better tool for the example's batch timer: dedicated workers have `requestAnimationFrame` (Chrome 69, Firefox 99, Safari 16.4; not in nested workers in Chrome).
- Evidence: https://websockets.spec.whatwg.org/, raw/bcd.json `api.WebSocket.binaryType`, `api.DedicatedWorkerGlobalScope.requestAnimationFrame`

### Ask the server to conflate and batch; render the latest state, not every message
- Verdict: verified
- Note: This is a mechanism argument. The cited sources support only the frame-time facts (16.7 ms per frame). They do not discuss server conflation. That is acceptable for a protocol pattern, but label it as a pattern.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_long_is_too_long

### Detect dead connections with app-level heartbeats and reconnect with capped exponential backoff and full jitter
- Verdict: verified
- Note: Spec: ping/pong "are not currently exposed in the API. User agents may send ping…". AWS: "The 'Full Jitter' approach uses less work, but slightly more time". Formula `sleep = random(0, min(cap, base * 2 ** attempt))`.
- Evidence: https://websockets.spec.whatwg.org/#ping-and-pong-frames, https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/

### Choose the transport by direction and message shape: SSE for one-way text push, WebSocket for two-way or binary, WebTransport for unreliable datagrams
- Verdict: verified
- Note: HTML spec: "Event streams are always decoded as UTF-8", "HTTP 204 No Content" stops reconnects, a comment line "every 15 seconds or so", and sharing "a single EventSource object using a shared worker". MDN EventSource: 6 connections "per browser + domain" and "Won't fix". MDN WebTransport: "The scheme must be HTTPS, and the port number needs to be explicitly specified". web-features: webtransport low 2026-03-24, shared-workers low 2026-05-05 (Chrome Android 148), server-sent-events widely available.
- Evidence: https://html.spec.whatwg.org/multipage/server-sent-events.html, https://developer.mozilla.org/en-US/docs/Web/API/EventSource, https://developer.mozilla.org/en-US/docs/Web/API/WebTransport/WebTransport, raw/web-features.json

### Write a degradation policy for every streaming view, driven by measured frame time, and show when the view is degraded
- Verdict: corrected
- Correction: The example never steps up at 60 Hz. rAF deltas are about 16.7 ms on a 60 Hz display, so `p95 < 14` is never true and the view stays degraded. Use thresholds relative to the measured refresh interval, for example `interval = median(deltas)`, `stepDown` when `p95 > 1.5 * interval`, and `stepUp` when `p95 < 1.1 * interval` for N seconds. The item already says that thresholds scale at 120 Hz, but the code uses fixed values. The other facts are correct: the OpenAI reference says "Make degraded state visible rather than silently dropping fidelity". LoAF is Chrome 123 only (BCD experimental). PressureObserver is Chrome 125 desktop only (no Chrome Android in BCD).
- Evidence: https://raw.githubusercontent.com/openai/plugins/main/plugins/build-web-data-visualization/skills/dashboards-and-real-time-visualization/references/performance-and-degradation.md, raw/bcd.json `api.PerformanceLongAnimationFrameTiming`, `api.PressureObserver`

### Svelte 5: derive with `$derived`, reserve `$effect` for escape hatches, bind chart engines with `{@attach}`
- Verdict: verified
- Note: The Svelte docs say "Prior to Svelte 5.25, deriveds were read-only", "Attachments are available in Svelte 5.29 and newer", push-pull, "referentially identical … downstream updates will be skipped", effects run "in a microtask after state changes", "avoid using it to synchronise state". The "Controlling when attachments re-run" section shows the nested-`$effect` pattern that the example uses.
- Evidence: https://svelte.dev/docs/svelte/$derived, https://svelte.dev/docs/svelte/@attach, https://svelte.dev/docs/svelte/$effect

### Do not animate panel height to or from `auto` in a data-dense UI; if you must, keep it short and Chromium-only
- Verdict: verified
- Note: BCD: `interpolate-size` and `calc-size` Chrome 129 only, experimental. web-features: `details-content` low 2025-09-16, `transition-behavior` low 2024-08-06. The Chrome doc says "Interpolation between two intrinsic sizing keyword is not possible", inherited on `:root` "is the recommended approach", and fallback to no transition.
- Evidence: https://developer.chrome.com/docs/css-ui/animate-to-height-auto, raw/bcd.json, raw/web-features.json

### When a CSS background must stay, select it with `image-set()` and preload the same candidate
- Verdict: verified
- Note: web-features `image-set`: low 2023-09-18, high 2026-03-18 (Chrome 113, Firefox 89, Safari 17 with `type()`). `imagesrcset`: Chrome 73, Firefox 78, Safari 17.2, widely available 2026-06-11. `fetch-priority`: low 2024-10-29.
- Evidence: raw/bcd.json `css.types.image.image-set`, raw/web-features.json `image-set`, `preloading-responsive-images`

### Budget each frame against the refresh interval and each task against about 50 ms
- Verdict: verified
- Note: MDN says "a document takes about 6ms to render a frame, leaving about 10ms for the rest", gives 50 ms chunks, and says to answer input "within 100ms, preferably within 50ms". MDN Fundamentals says "Humans usually cannot perceive differences in frame rate above 60Hz", which confirms the caveat.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_long_is_too_long, https://github.com/mdn/content/blob/main/files/en-us/web/performance/guides/fundamentals/index.md

### Set performance budgets with warning and error levels, and gate them in CI against a per-branch baseline
- Verdict: verified
- Note: MDN: "A budget should include 2 levels", "a development baseline for each branch", "File size checks are the first line of defense". The current CI tool is Lighthouse CI (`lhci` assertions and budgets), not Lighthouse Bot.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Performance_budgets, https://github.com/GoogleChrome/lighthouse-ci

### Use synthetic tests to catch regressions and RUM to find what users actually hit; do not replace one with the other
- Verdict: verified
- Note: The MDN mdn/content source has "Regular 3G | 750 kbps | 250 kbps | 100", `1 - timing.transferSize / timing.decodedBodySize`, and says synthetic monitoring "is very well suited to regression testing".
- Evidence: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Rum-vs-Synthetic, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Navigation_and_resource_timings, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Understanding_latency

### Start up asynchronously: decode in workers with built-in decoders, and keep non-critical code out of the startup HTML
- Verdict: verified
- Note: MDN: "almost certainly significantly faster … may automatically parallelize these decoders". The same MDN page says workers have "no access to WebGL". That is stale (OffscreenCanvas), but the notes do not repeat it.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Optimizing_startup_performance

### Pick video encodings with Media Capabilities `decodingInfo()` (`smooth` and `powerEfficient`)
- Verdict: verified
- Note: Add MDN's caveat: "Browsers will report a supported media configuration as `smooth` and `powerEfficient` until stats on this device have been recorded." So the first answers can be optimistic. `keySystemConfiguration` is rejected in workers and outside secure contexts (MDN). BCD: Chrome 66, Firefox 63, Safari 13. web-features `media-capabilities`: high 2024-10-28.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/decodingInfo

### Collect browser deprecation and intervention reports with `ReportingObserver` and `Reporting-Endpoints`
- Verdict: corrected
- Correction: (1) "Deprecation and intervention reports are Chromium only" is only half right. BCD `…types_property.deprecation`: Chrome 69 and Firefox 149 (partial: "Not supported in workers"). web-features `reporting-deprecation` lists Chrome only because it ignores partial support. Intervention reports are Chrome 69 only, and web-features marks them discouraged. (2) "The unload deprecation is one such case": Chrome's deprecation page says to use "the Reporting API … in conjunction with a read-only Permission Policy". That means `Permissions-Policy-Report-Only: unload=()` (Chrome 120, BCD) and observing `'permissions-policy-violation'` reports, not only `'deprecation'`. Add that type to the observer. The statuses are correct: web-features `reporting` low 2026-03-24; BCD `ReportingObserver` Chrome 69, Firefox 149, Safari 16.4; `Reporting-Endpoints` Chrome 96, Firefox 130, Safari 16.4; `Report-To` deprecated.
- Evidence: raw/bcd.json `api.ReportingObserver.ReportingObserver.options_parameter.types_property.deprecation`, `http.headers.Permissions-Policy-Report-Only`, raw/web-features.json `reporting-deprecation`, `reporting-interventions`, https://developer.chrome.com/docs/web-platform/deprecating-unload

### Attack TTFB and resource load delay before image bytes when LCP is slow
- Verdict: verified
- Note: web.dev (2024-08-20) gives Poor: TTFB 2,270, load delay 1,290, load duration 350, render delay 360. Duration is the smallest subpart in all three buckets (Good 160, Needs improvement 270). The page also says "less than 10%" and "only 20% slower on mobile".
- Evidence: https://web.dev/blog/common-misconceptions-lcp

### Start module workers with `{type: 'module'}` and preload them with `modulepreload`
- Verdict: disputed
- Correction: The web.dev 2019 claim that "Preloaded modules can also be used by both the main thread and module workers" conflicts with the current HTML spec. `modulepreload` uses "el's node document's relevant settings object" and "places the result into the appropriate module map", which is the document's map. A worker has its own module map. At most, the worker gets the HTTP cache (if the response can be cached), not the parsed module. 07-js-web-apis.md:44 already says "Every worker loads and compiles its own copy of its module graph". If you keep the preload for the network gain, use `as="worker"` (a valid module preload destination in the spec), so the request destination matches the worker fetch. Also, import maps do not apply inside the worker (see above). The status is correct: module workers Chrome 80, Firefox 114, Safari 15 (web-features `js-modules-workers` high 2025-12-06). `as="worker"` plain preload was "never implemented" (web.dev).
- Evidence: https://html.spec.whatwg.org/multipage/links.html#link-type-modulepreload, https://web.dev/articles/module-workers

### Precache only the app shell; never precache responsive image sets, favicon sets or polyfills
- Verdict: verified
- Note: Workbox: "Don't precache responsive image and favicon sets", "Don't precache polyfills", and "markup that gets precached now will always be served from the cache later until the service worker is updated". SciChart 5.2.69 does ship `scichart2d.wasm` and `scichart2d-nosimd.wasm`.
- Evidence: https://developer.chrome.com/docs/workbox/precaching-dos-and-donts

### For complex sites, prefetch likely next pages eagerly and prerender on hover; keep prerendered pages fresh or cancel them
- Verdict: corrected
- Correction: From Chrome 143, `eager` no longer means "on load". Chrome's prerender page (updated 2026-01-23) says: `immediate` = "as soon as the speculation rules are observed". `eager` = on desktop, hover for 10 ms, and on mobile, 50 ms after the link enters the viewport. `moderate` = hover 200 ms or pointerdown. To prefetch 1-2 frequent next pages on load, use `immediate`. The implementing guide (updated 2025-10-23) still says "on load with an eager setting", which is stale. The limits are: `immediate` 50 prefetch / 10 prerender; `eager`/`moderate`/`conservative` 2 each (FIFO). The remove-and-reinsert rule ("will only speculate immediate or eager rules") is correct. BCD: Clear-Site-Data `"prefetchCache"`/`"prerenderCache"` Chrome 138 only. Speculation rules are Chromium only, and Safari 26.2 has them behind a flag.
- Evidence: https://developer.chrome.com/docs/web-platform/prerender-pages, https://developer.chrome.com/docs/web-platform/implementing-speculation-rules, raw/bcd.json `html.elements.script.type.speculationrules.*`, `http.headers.Clear-Site-Data.prefetchCache`

### For MPA sections, stream a precached header and footer around network content from the service worker
- Verdict: verified
- Note: The pattern matches the Workbox streams guide. Streams as a Response body and navigation preload work in all engines (BCD `api.NavigationPreloadManager`).
- Evidence: https://developer.chrome.com/docs/workbox/faster-multipage-applications-with-streams

### Move elements with `transform`, never `top`/`left`, to avoid animation-induced layout shifts
- Verdict: corrected
- Correction: The caveat "Percent translations that depend on box size can stop the animation from running on the compositor" is stale. Chrome has composited percentage transforms since Chromium 89 "as long as the layout size is not changing every frame" (Chrome blog). The failure reason no longer exists in Chromium HEAD: the `FailureReason` list in `compositor_animations.h` skips bit 11 (the old `kTransformRelatedPropertyDependsOnBoxSize`). The quotes are correct: "even when the element being moved is on its own layer", and "Composited animations using `translate` can't impact other elements, and so don't count toward CLS" (web.dev optimize-cls, updated 2025-02-07). The discrete-input rule is also correct.
- Evidence: https://developer.chrome.com/blog/hardware-accelerated-animations, https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/animation/compositor_animations.h, https://web.dev/articles/optimize-cls

### Read GPU cost from a saved trace: the GPU track and the Frames track in DevTools, or Perfetto for the GPU process
- Verdict: corrected
- Correction: `performance_start_trace` defaults to `reload: true` and `autoStop: true` (`src/tools/performance.ts`). A plain call reloads the page and records the load, not a steady streaming session. For chart GPU cost, call `performance_start_trace({ pageId, reload: false, autoStop: false })`, run the workload, then call `performance_stop_trace({ pageId, filePath: 'trace.json.gz' })`. The other facts are correct. DevTools reference: partially presented = "Chrome did its best to render at least some visual updates in time", dropped = "can't render the frame in reasonable time". `formatTraceSummary()` prints URL, bounds, CPU and network throttling, LCP breakdown, INP, CLS, CrUX field data and insights, with no frame or GPU data. MCP uses `TracingDefaultCategories` (which include `disabled-by-default-devtools.timeline.frame`) plus JS sampling and screenshots. Category names need one more fix. In `builtin_categories.h`, `gpu`, `viz` and `cc` are plain categories (lines 105, 154, 275). `webgpu` and `gpu.dawn` exist only as disabled-by-default categories (lines 456, 362). So write them as `disabled-by-default-webgpu` and `disabled-by-default-gpu.dawn`. The bare names `webgpu` and `gpu.dawn` record nothing. `disabled-by-default-gpu.service` and `disabled-by-default-skia.gpu` are correct. The category of `GPUTask` is still not confirmed.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/e52c6b59b476c5e04d8dd9fd4bd017ba3b3d65df/src/tools/performance.ts, https://developer.chrome.com/docs/devtools/performance/reference, https://chromium.googlesource.com/chromium/src/+/HEAD/base/trace_event/builtin_categories.h (lines 105, 154, 275, 362, 370, 418, 456), https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/types/TraceEvents.ts (DefaultCategories)

### Update the Chrome DevTools MCP inventory to 1.10.1
- Verdict: verified
- Note: npm: 1.9.0 2026-09-08, 1.10.0 2026-09-23T09:55Z, 1.10.1 2026-09-23T10:42Z (`latest`). The CHANGELOG matches: "add get_css_style tool", "set default pageSize and pageIdx for get_css_styles tool", "support config file", "chunked trace buffer parser", "prevent memory leak by scoping trace engine model per parse". 1.10.1: "resolve node export conditions in rollup bundle". 1.9.0: "set default trace buffer size to match DevTools (1.2gb)". `src/tools/css.ts`: `get_css_styles`, `ToolCategory.DEBUGGING`, `pageSize` default 10, `pageIdx` default 0. The chunked parser uses `DEFAULT_EVENTS_PER_BATCH = 10_000` and `32 * 1024 * 1024`. `--config` is in docs/configuration.md.
- Evidence: https://registry.npmjs.org/chrome-devtools-mcp, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/e52c6b59b476c5e04d8dd9fd4bd017ba3b3d65df/CHANGELOG.md, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/e52c6b59b476c5e04d8dd9fd4bd017ba3b3d65df/src/tools/css.ts

### SciChart: use `SciChartSurface.create()` for terminals, because `createSingle()` reloads the page on WebGL context loss
- Verdict: disputed
- Correction: The source facts are correct. `sciChartInitCommon.js` does `console.warn("WebGL context lost. Reloading the page."); event.preventDefault(); location.reload();`. `createMaster.js` `monitorWebGL` calls `preventDefault()`, marks surfaces inactive, clears caches, calls `SCRTShutdownEngine2D()`, and restores on `webglcontextrestored`. The conclusion is disputed. SciChart's own forum ("WebGL context lost and Memory Issue Critical Bug", seen through search result snippets because the page returns 403) says that in some cases "webglcontextrestored is never called by the browser" (Intel HD 620/630 drivers). There the vendor recommends `createSingle()` as the workaround. With `create()`, a missing restore event leaves every chart dead with no reload. Safer wording: default to `create()`, and add a watchdog. If `webglcontextrestored` does not arrive within a few seconds after `webglcontextlost`, delete and recreate the surfaces, or reload. Also, going past the context cap with `createSingle()` makes the browser drop the oldest context. That triggers `location.reload()`, which can cause reload loops.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/sciChartInitCommon.js, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/createMaster.js, https://www.scichart.com/questions/js/webgl-context-lost-and-memory-issue-critical-bug (403 to fetchers; content from search snippets only)

### SciChart: detach long-hidden streaming series instead of only setting `isVisible = false`
- Verdict: verified
- Note: `prepareSeriesRenderData()` loops over all `renderableSeries` and calls `ExtremeResamplerHelper.resampleSeries()` with no `isVisible` check. The draw loop skips `!rs.isVisible` (SciChartRenderer.js:365). The resampling hash cache is used in `resampleSeries`. `AxisBase2D.js:1111/1120` filters autorange on `s.isVisible`.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Services/SciChartRenderer.js, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/Axis/AxisBase2D.js

### SciChart: use `EAutoRange.Always` on Y for streaming only with the sorted-data flags; drive X with an explicit window
- Verdict: corrected
- Correction: The docs' "factor of 5" is about data changes, not autorange: "This improves performance on data append/update/insert/remove operations by a factor of 5". Keep the flags, but do not present the 5x as an autorange speedup. The other facts are correct. The docs say `Always` autoranges "every time the chart is drawn" and "will override any other ranging, including zooming and panning by modifiers". `getWindowedYRange` is memoized, uses `getIndicesRange(…, isSortedAscending, …)` and `NumberUtil.MinMaxWithIndex`. The d.ts comment says "Autorange Always when the data changes".
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/resampling/, https://www.scichart.com/documentation/js/v5/2d-charts/axis-api/ranging-scaling/auto-range/, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.js

### SciChart: do not animate point-marker fill, stroke or size per frame; use `lastPointOnly` for "current value" dots
- Verdict: verified
- Note: `notifyPropertyChanged` returns early for `PROPERTY.OPACITY` or for an unchanged value. Otherwise it calls `recreateSpriteTextures()`, which deletes and recreates the sprite, stroke and fill masks. `opacity` calls `applyOpacity()` on the existing textures. The option name in the d.ts is `lastPointOnly?: boolean` (BasePointMarker.d.ts:41). "isLastPointOnly" in the Why line is the docs' wording, not the API name.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/PointMarkers/BasePointMarker.js

### SciChart: load it on demand, because v5 does not tree-shake, and do not plan on worker or OffscreenCanvas rendering
- Verdict: verified
- Note: package.json 5.2.69 has `main: index.js`, no `module`, no `exports`, no `sideEffects`. `index.js` has 933 lines with `require(`. `index.min.mjs` is 2,266,401 bytes. `_wasm/` has scichart2d.wasm 1,278,913, scichart2d-nosimd.wasm 1,275,740, and the 3D equivalents. There are 0 files with `OffscreenCanvas`/`transferControlToOffscreen`. 6.0.0-alpha.197 (2026-09-23) has `module: ./esm/index.js`, an `exports` map, and no `sideEffects`.
- Evidence: https://registry.npmjs.org/scichart, https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.197/package.json

### SciChart: keep raw timestamps as float64 in the DataSeries, and do not pre-offset them for precision
- Verdict: unverified
- Correction: The storage part is verified: `getNativeXValues(): SCRTDoubleVector`, and `visibleMin`/`visibleMax` are JS numbers. Where the engine converts to float32 for the GPU is not visible in the JS package, and the SciChart precision blog and demo pages return 403 to fetchers. Also fix "Append epoch seconds or milliseconds as they are". `DateTimeNumericAxis`/`SmartDateLabelProvider` expect Unix seconds by default ("Default EDatePrecision.Seconds (Unix time)", SmartDateLabelProvider.d.ts:87). Append in the unit that the axis expects, or set `datePrecision`.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.d.ts, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/Axis/LabelProvider/SmartDateLabelProvider.d.ts

---

## Cross-file conflicts

1. Speculation eagerness. 04-html-and-http-loading-features.md:474-475 says `immediate` is for 1-2 likely URLs and that `eager` has meant hover since Chrome 143. 15 item "For complex sites, prefetch likely next pages eagerly…" says to prefetch 1-2 pages "with `eager`". 04 is correct.
2. `textContent` in hot paths. 08-v8-batch-01.md:348, 08-v8-index.md:359 and 09-v8-consolidated.md:608 write `cell.textContent = priceFmt.format(price)` in the per-tick path. 15 "Update live numbers by writing to a persistent Text node" says to avoid `element.textContent =` in hot loops. The 08/09 examples should use a persistent Text node, or at least skip unchanged strings.
3. Module preload for workers. 07-js-web-apis.md:44 ("Every worker loads and compiles its own copy of its module graph") conflicts with 15 "Start module workers…" (web.dev 2019: preloaded modules shared with workers). 07 matches the HTML spec.
4. Wasm tier-up during a Performance recording. 09-v8-consolidated.md:2170 ("starting a Performance recording tiers it back up") and 15 "Treat Wasm timings taken through Chrome DevTools MCP…" both omit the V8 per-isolate enable count. With MCP attached, a Performance recording does not tier up.
5. SVG compositing inside 15 itself. "Keep SVG charts and overlays small" and "Freeze SVG geometry…" pair `vector-effect: non-scaling-stroke` with a transformed `<g>`. Chromium does not composite an SVG transform animation when "the subtree has vector effect".
6. Chrome stable version. 02-course-loading.md:4 says the current stable is Chrome 153 on 2026-09-22. chromiumdash gives Chrome 154 stable on 2026-09-22. 14-devtools-mcp-and-webmcp.md:3 (MCP 1.9.0, Chrome 153 test) and :34 (`get_css_styles` "(doc only)") are still stale, as 15 says.
7. `contain: style` and `content-visibility: auto` in Safari. 05-css-rendering.md:298, :315, :963 and 01-critical-rendering-path.md:649 are still unresolved. BCD confirms the resolution in 15: counters from Safari 15.4, quotes from 27, and `auto` from 18 (partial) with full support in 26. Also add the BCD Chrome note: quotes are scoped only from Chrome 115.
8. SciChart context loss. 13-scichart.md:339-345 (default to `create()`) agrees with 15, but neither file covers the vendor-reported case where `webglcontextrestored` never fires.

## Missing but important

1. Import maps are Window-only. Worker module graphs (decode workers, SharedWorker feeds, service workers) get an empty import map, so mapped specifiers and the `integrity` map do not apply there. Source: https://html.spec.whatwg.org/multipage/webappapis.html#concept-global-import-map ("only Window global objects have their import map modified").
2. Check the first visibility state of `content-visibility: auto` panes with `child.checkVisibility({ contentVisibilityAuto: true })` (Chrome 121, Firefox 122, Safari 17.4). Use it when the listener is attached after the first render. Source: https://developer.mozilla.org/en-US/docs/Web/API/Element/checkVisibility, BCD.
3. Find remaining `unload` users with `Permissions-Policy-Report-Only: unload=()` and `permissions-policy-violation` reports (Chrome 120). Source: https://developer.chrome.com/docs/web-platform/deprecating-unload, BCD `http.headers.Permissions-Policy-Report-Only`.
4. `immediate` eagerness for on-load list rules. `eager` has been hover or viewport-based since Chrome 143. Source: https://developer.chrome.com/docs/web-platform/prerender-pages.
5. `requestAnimationFrame` in dedicated workers (Chrome 69, Firefox 99, Safari 16.4; not in nested workers in Chrome) to post decoded batches once per frame, instead of `setInterval(…, 16)`. Source: https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope/requestAnimationFrame.
6. A WebGL context-loss watchdog for SciChart's shared context: recreate the surfaces or reload if `webglcontextrestored` does not arrive. Sources: SciChart forum (above), https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextrestored_event.
7. WebSocket `permessage-deflate` tuning for high-rate binary feeds. Compression costs CPU per message and memory for the LZ77 window per connection. RFC 7692 has `server_no_context_takeover` and `client_max_window_bits` "to limit memory usage". For binary frames that are already packed, measure with compression off. Source: https://www.rfc-editor.org/rfc/rfc7692.
8. Composited `background-color` and `clip-path` animations in Chromium (`CompositeBGColorAnimation` and `CompositeClipPathAnimation` are "stable"). This changes the cost ranking for price-flash effects in Chrome only. Source: https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/runtime_enabled_features.json5.
9. Rules for composited SVG transform animations in Chromium: use the `transform` property only (not `rotate`/`scale`/`translate`), effective zoom 1, no viewBox or x/y container transform, and no vector-effect in the subtree. Source: https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/animation/compositor_animations.cc.
10. Lighthouse CI (`lhci autorun` with assertions and budgets) as the current CI gate for the budgets item. It replaces the archived Lighthouse Bot that MDN names. Source: https://github.com/GoogleChrome/lighthouse-ci.
