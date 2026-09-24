# Critical rendering path (CRP): from first HTML bytes to pixels, and the update frame after load

Scope: every step the browser takes from the navigation request to pixels on the display (initial load), and every step of one rendering update after load (input -> JS -> rAF -> style -> layout -> observers -> paint -> composite -> present), with the levers that code can pull at each step and how to see each step in Chrome DevTools.
Sources: web.dev Learn Performance and articles, MDN Performance guides, developer.chrome.com (RenderingNG, "Inside look at modern web browser", DevTools and Performance insights docs, Early Hints, prerender, LoAF, WebMCP), the WHATWG HTML spec (render-blocking mechanism, script-blocking style sheets, "update the rendering"), the W3C IntersectionObserver spec, Chromium "How cc works", DevTools frontend source, web-features and MDN browser-compat-data (BCD 8.1.2, 2026-09-17) for status. One live trace was recorded with Chrome DevTools MCP to confirm the agent workflow. Per the user's request, WebMCP / Chrome DevTools MCP items are included in the "Tooling" section.

## Phase map

### (a) Initial load: navigation -> first pixels

| # | Phase | Thread / process | What blocks it | Code that controls it | Levers (item titles below) | How to see it in DevTools |
|---|---|---|---|---|---|---|
| L0 | Navigation -> TTFB (redirects, DNS, TCP, TLS, server think time, first bytes) | Browser process network service | Redirect chains; each new origin costs DNS + TCP + TLS round trips; slow server; uncompressed HTML; no edge cache | Server, CDN, link URLs, service worker, `Cache-Control`, `Server-Timing` | "Keep the HTML document request fast", "Stream the HTML", "Send 103 Early Hints", "Preconnect", "Keep pages bfcache-eligible", "Prerender likely next pages" | Network track (document row); **Document request latency** insight (redirects, >600 ms server, no compression); **LCP breakdown** TTFB subpart; Server-Timing values in Network panel Timing tab |
| L1 | HTML parse (incremental tokenizer + tree builder -> DOM) | Renderer main thread | Bytes not yet arrived; a parser-blocking classic `<script>`; that script also waits for every earlier "script-blocking" stylesheet; late `<meta charset>` can force a re-parse; `document.write` | Markup order, `<script>` attributes, charset, DOM size | "Declare the charset", "Default scripts to defer or module", "Put no sync script right after a stylesheet", "Never use document.write", "Server-render the first view" | Main track **Parse HTML** slices; gaps in Parse HTML = parser waiting; Network track shows what it waited for |
| L2 | Preload scan (speculative parser over raw HTML) | Renderer (helper to the parser) | It only sees markup tokens: not CSS `background-image`, not `@import`, not JS-injected tags, not client-rendered HTML; large inline blobs push discovery later | Markup, `<link rel=preload/modulepreload>`, `fetchpriority` | "Keep critical resources in the markup", "Preload late-discovered critical resources", "Flatten module waterfalls with modulepreload", "Give the LCP image fetchpriority=high" | Network waterfall start times and Initiator column; **LCP request discovery** and **Network dependency tree** insights |
| L3 | CSSOM (download + parse every render-blocking stylesheet) | Network + main thread | All parser-inserted `<link rel=stylesheet>` / `<style>` in `<head>` whose `media` matches; `@import` chains serialize | `<link>`, `<style>`, `media`, `disabled`, `@import`, CSS size | "Shrink render-blocking CSS", "Replace CSS @import", "Inline small critical CSS", "Split CSS by media" | Network track render-blocking marker; **Parse stylesheet** slices; **Render-blocking requests** insight; Coverage panel for unused CSS |
| L4 | Scripts: fetch, compile, run | Network; V8 background threads (streaming compile); main thread (evaluate) | Classic sync scripts block the parser; `async` runs when ready (interrupts parsing); `defer` and `type=module` run after parsing, in order, before `DOMContentLoaded` | `async`, `defer`, `type=module`, `blocking`, `fetchpriority`, bundle split | "Default scripts to defer or module", "Keep inline scripts tiny", "Split the startup bundle", "Use blocking=render only to hide a known flicker" | **Streaming compile task**, **Compile script**, **Compile module**, **Evaluate script** slices; Network track |
| L5 | Render-blocked gate | (spec state) | HTML spec: a document is render-blocked while its render-blocking element set is non-empty **or** its `<body>` element does not exist yet, up to a UA timeout. Only elements added before `<body>` can join the set (head stylesheets/styles, `blocking=render`, `rel=expect`). A sync head script keeps `<body>` from existing, so it blocks render too | Everything in `<head>` | "Keep the head lean", "Use rel=expect only for view transitions" | **First Contentful Paint** marker in Timings track vs. last render-blocking request |
| L6 | Style ("Recalculate style") | Main | DOM + CSSOM ready; cost grows with elements x selectors | Selectors, DOM size, class toggles, CSS-in-JS injection | "Keep selectors simple", "Keep the DOM small", "Skip off-screen rendering with content-visibility" | **Recalculate style** (Elements affected); **CSS selector costs** insight with "Enable CSS selector stats" |
| L7 | Layout (immutable fragment tree) | Main | Style; DOM size; unsized media; forced sync layout from JS | Geometry CSS, `width`/`height` on media, `contain` | "Reserve space for media", "Contain independent widgets", "Batch DOM reads before writes" | **Layout** (Nodes that need layout, Layout scope Partial/Whole document); **Forced reflow**, **Optimize DOM size**, **Layout shift culprits** insights |
| L8 | Pre-paint (property trees: transform, clip, effect, scroll; paint/raster invalidation) | Main | Layout | Transforms, clips, opacity, filters | (no direct lever) | **Pre-paint** |
| L9 | Paint (display lists / paint chunks) | Main | Pre-paint | Visual CSS (shadows, blur, gradients), paint area | "Reduce paint area and paint cost" | **Paint** slices; Rendering tab > Paint flashing |
| L10 | Commit (copy property trees + display lists to compositor; main thread blocks while copying) | Main -> compositor | Paint | — | — | **Commit** |
| L11 | Layerize (split display list into composited layers) | Compositor thread | Commit | `will-change`, `<video>`, `<canvas>`, active transform/opacity/filter animations | "Use will-change sparingly" | **Layerize**; Layers panel; Rendering tab > Layer borders |
| L12 | Raster + image decode (tiles -> GPU textures) | Raster worker threads (Thread pool) / GPU process | Tiles in and near the viewport; image decode is the most expensive raster work | Image sizes/formats, `img.decode()`, `decoding` | "Decode large images off the frame" | **Rasterize paint**, **Image decode** in Thread pool track |
| L13 | Activate + "draw" (build compositor frame of quads/render passes) | Compositor thread | All raster for the pending tree done | — | — | Frames track |
| L14 | Aggregate + GPU draw + display | Viz display-compositor thread; GPU main thread | Vsync / display refresh | — | — | GPU track; Frames track colors (green / partially presented / dropped) |
| L15 | First paint signals (FP, FCP, LCP) | — | Chrome Paint Holding: on same-origin navigations Chrome keeps the old page until the new page reaches FCP or a timeout (no developer action) | LCP element choice, fonts, images | "Give the LCP image fetchpriority=high", "Make fonts discoverable early" | Timings track FCP/LCP markers; **LCP breakdown** insight (TTFB, load delay, load duration, render delay) |

### (b) The update frame after load (one rendering opportunity)

Order below follows the HTML spec "update the rendering" steps (webappapis.html) plus Chromium's compositor pipeline (RenderingNG, How cc works).

| # | Step | Thread | What code controls it | Notes that change how code is written | DevTools name |
|---|---|---|---|---|---|
| U0 | Input arrives (browser process -> renderer compositor thread) | Compositor | `touch-action`, passive vs. non-passive `wheel`/`touch*` listeners and where they are attached | Areas with blocking listeners are "non-fast scrollable regions": the compositor must ask the main thread before it scrolls. Outside them the compositor scrolls alone | Rendering tab > Scrolling performance issues |
| U1 | Event dispatch as a task | Main | Event listeners | Discrete events (`keydown`, `pointerdown`, `click`) dispatch at once. Continuous events (`pointermove`, `mousemove`, `touchmove`, `wheel`) are coalesced and dispatched just before rAF; `getCoalescedEvents()` returns the dropped points | **Event: <type>**, **Function call**; Interactions track (input delay / processing / presentation delay) |
| U2 | Microtask checkpoint after each task/callback | Main | Promises, `queueMicrotask` | Long promise chains extend the same task; they do not yield | **Run microtasks** |
| U3 | Rendering opportunity | (scheduler) | — | Tied to display refresh (60 Hz ~16.7 ms; spec allows a drop to 30 Hz when a page cannot keep up, and much less when hidden). Hidden or render-blocked documents are filtered out (no rAF, no paint) | Frames track |
| U4 | resize steps -> scroll steps -> media-query change evaluation -> Web Animations update + events -> fullscreen steps -> canvas 2D context-lost check | Main | `resize`/`scroll` handlers, `matchMedia` listeners, WAAPI | `resize` and `scroll` events already fire once per frame here; no need to rAF-throttle them again, but their work lands in the frame budget | **Event: scroll**, **Event: resize** |
| U5 | requestAnimationFrame callbacks | Main | rAF callbacks | Every callback in the frame gets the same timestamp; do visual writes here | **Animation frame fired** |
| U6 | Style + layout (loop start) | Main | DOM/CSS writes made so far | Reading geometry earlier in the task forces this work early ("forced reflow") | **Recalculate style**, **Layout** |
| U7 | `content-visibility: auto` first proximity check (re-runs style/layout once if newly relevant) | Main | `content-visibility` | Off-screen `auto` subtrees skip style/layout/paint | — |
| U8 | ResizeObserver: gather + broadcast, repeat style/layout at deeper depth while observations exist | Main | ResizeObserver callbacks | Runs after layout and before paint in the **same** frame; writes that resize shallower-or-equal depth elements are skipped and reported as a "resize loop" error | (inside the rendering task; callbacks show as **Function call**) |
| U9 | Focus fix-up, view-transition operations | Main | — | — | — |
| U10 | IntersectionObserver: compute intersections | Main | IntersectionObserver | Computation happens here, but callbacks are delivered by a **queued task**, so they run after this frame, not before its paint | **Compute intersections** |
| U11 | Paint timing marks, then paint (display lists) + commit | Main -> compositor | Visual CSS | Commit blocks the main thread while it copies | **Pre-paint**, **Paint**, **Commit** |
| U12 | Layerize, tile raster, image decode, activate | Compositor + raster threads | `will-change`, image decode | The compositor can keep scrolling and animating transform/opacity/filter from the active tree while the pending tree rasters | **Layerize**, **Rasterize paint**, **Image decode** |
| U13 | Draw compositor frame -> Viz aggregate -> GPU draw -> present on vsync | Compositor, Viz, GPU | — | Canvas/WebGL content arrives as a texture layer | GPU track; Frames (green / partially presented / dropped) |

Threads summary:

| Thread | Work |
|---|---|
| Renderer main | HTML parse, JS (events, timers, rAF, microtasks), style, layout, pre-paint, paint, ResizeObserver callbacks, IntersectionObserver computation, commit |
| Renderer compositor ("impl") | Input routing and hit-region checks, compositor scroll, compositor animations (transform lists, opacity, filter lists), layerize, tile management, activation, compositor frame |
| Raster / thread pool | Tile raster, image decode (GPU raster uses one worker at a time; decodes run in parallel) |
| V8 background threads | Streaming parse/compile of external scripts, GC helpers |
| Viz process | Display compositor thread aggregates frames from all frames/tabs; GPU main thread executes the draw |
| Web workers | Separate event loop; a dedicated worker can run rAF and render an `OffscreenCanvas` without the main thread |

Fast paths: scroll and compositor-only animations skip style, layout, pre-paint and paint ("Stages of the rendering pipeline can be skipped if they aren't needed", RenderingNG architecture). Paint-only changes skip layout; geometry changes run the full path (web.dev rendering-performance).

## Items: Navigation and TTFB

### Keep the HTML document request fast: no redirects, fast server, compressed body
- Layer: network
- Stage: network
- Metrics: TTFB, FCP, LCP
- When: load
- Impact: high, because every later phase and every subresource waits for the document.
- Do: Link to final URLs (scheme, host, trailing slash) so the navigation has zero redirects. Keep server response under ~600 ms and serve HTML with `Content-Encoding` (gzip, br or zstd). Cache HTML at a CDN edge when it is not personalized.
- Why: The DevTools "Document request latency" insight flags redirects, server response over 600 ms, and uncompressed HTML. TTFB target is 0.8 s at p75; TTFB includes DNS and redirects, so the server budget is smaller than TTFB.
- Example: `Server-Timing: db;dur=42, render;dur=88` on the HTML response makes back-end phases visible in DevTools and in `performance.getEntriesByType('navigation')[0].serverTiming`.
- Avoid/caveats: Unique query parameters defeat CDN caching. A cache hit can hide a slow back end; measure both.
- Status: Server-Timing Baseline widely available (2025-09-27 per web-features).
- Sources: https://developer.chrome.com/docs/performance/insights/document-latency, https://web.dev/articles/optimize-ttfb

### Stream the HTML and flush the head early
- Layer: network
- Stage: network, html-parse, preload-scan
- Metrics: TTFB, FCP, LCP
- When: load
- Impact: high on server-rendered pages with slow data, because the parser and preload scanner can start on the head while the server still builds the body.
- Do: Send `<head>` (charset, viewport, critical CSS links, preloads) as the first chunk, then stream body parts. Use a streaming SSR API if the framework has one.
- Why: HTML parsing is incremental; the browser parses and fetches what it has. Server-streamed HTML also yields to the main thread automatically, unlike one big client-side `innerHTML` render.
- Avoid/caveats: Once headers and the first chunk are sent you cannot change the status code or redirect. Buffering proxies can undo streaming; verify chunked delivery in the Network panel.
- Status: Standard HTTP behavior, all browsers.
- Sources: https://web.dev/articles/optimize-ttfb, https://web.dev/articles/optimize-inp, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work

### Send 103 Early Hints for critical origins and assets
- Layer: network
- Stage: network, preload-scan
- Metrics: TTFB (effective), FCP, LCP
- When: load
- Impact: medium to high when server think time is long; Chrome reports several hundred ms LCP wins from Shopify and Cloudflare.
- Do: While the server builds the page, send `103` with `Link: <https://cdn.example.com>; rel=preconnect` and `Link: </app.css>; rel=preload; as=style`. Use the exact URLs the final HTML uses.
- Why: The browser warms connections and starts fetches during idle server time.
- Avoid/caveats: Navigation requests only; HTTP/2 or HTTP/3 only; hints are dropped on a cross-origin redirect; preload only cacheable, stably-versioned resources or they download twice. Hints can mask a slow back end.
- Status: preconnect in Chrome/Edge 103, Firefox 120, Safari 17; preload in Chrome/Edge 103, Firefox 123, not Safari (developer.chrome.com, updated 2026-07-10).
- Sources: https://developer.chrome.com/docs/web-platform/early-hints

### Preconnect only to the one or two cross-origin hosts on the critical path
- Layer: html, network
- Stage: network
- Metrics: FCP, LCP
- When: load
- Impact: medium, because it removes DNS + TCP + TLS round trips from a critical request.
- Do: Add `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` only for origins used during first render. Use `dns-prefetch` for less certain origins.
- Why: Each new origin costs DNS, TCP and TLS round trips before the first request; a preconnected socket skips them.
- Avoid/caveats: Omitting `crossorigin` for a CORS resource (fonts, `fetch`) opens a second connection and wastes the first. Many preconnects compete for bandwidth and CPU. Prefer same-origin hosting for critical assets when possible (optimize-lcp).
- Status: preconnect Baseline widely available (2022-07-15); dns-prefetch Baseline 2025 newly available (2025-09-15) per web-features.
- Sources: https://web.dev/learn/performance/resource-hints, https://web.dev/articles/optimize-lcp

### Keep pages eligible for the back/forward cache
- Layer: js
- Stage: network, html-parse, style, layout, paint (all skipped on restore)
- Metrics: TTFB, FCP, LCP, CLS (on back/forward navigations)
- When: load, long-lived session
- Impact: high for back/forward navigations, because a bfcache restore skips the whole CRP.
- Do: Never register `unload` listeners; use `pagehide`/`pageshow` and check `event.persisted` to pause and resume work. Close WebSockets and other open connections in `pagehide` and reopen them in `pageshow`.
- Why: bfcache keeps the frozen page in memory and restores it instead of loading it again. `unload`, `Cache-Control: no-store`, open connections and a non-null `window.opener` block it.
- Example:
  ```js
  addEventListener('pagehide', (e) => { if (e.persisted) feed.close(); });
  addEventListener('pageshow', (e) => { if (e.persisted) feed.reconnect(); });
  ```
- Avoid/caveats: bfcache restores remove the fastest loads from lab-style datasets; segment metrics by navigation type.
- Status: bfcache is a browser behavior; the NotRestoredReasons API is Chromium-only (Chrome 125, web-features `bfcache-blocking-reasons`). Test via DevTools Application > Back/forward cache.
- Sources: https://web.dev/articles/bfcache

### Prerender or prefetch likely next navigations with speculation rules
- Layer: html
- Stage: network, html-parse, style, layout, paint (done before the click)
- Metrics: TTFB, FCP, LCP (next page)
- When: load
- Impact: high for the next navigation in Chromium, because a prerendered page activates almost instantly.
- Do: Add `<script type="speculationrules">` with document rules and `moderate` or `conservative` eagerness for same-site links; use `document.prerendering` and `prerenderingchange` to defer analytics and heavy startup work until activation.
- Why: The next page runs its CRP in a hidden renderer; on click Chrome swaps it in.
- Example:
  ```html
  <script type="speculationrules">
  {"prerender":[{"where":{"href_matches":"/markets/*"},"eagerness":"moderate"}]}
  </script>
  ```
- Avoid/caveats: Chrome limits non-immediate speculations to 2 (FIFO) and immediate ones to 10 prerenders / 50 prefetches. Skipped under Save-Data, Energy Saver with low battery, and memory pressure. Wasted work if the user does not navigate; not for URLs with side effects.
- Status: Chromium only (Chrome/Edge 109; eagerness 121); Safari 26.2 behind a flag; not Firefox (BCD). Not Baseline.
- Sources: https://developer.chrome.com/docs/web-platform/prerender-pages

## Items: HTML parse and the head

### Declare the charset in the first 1024 bytes
- Layer: html
- Stage: html-parse
- Metrics: FCP, LCP
- When: load
- Impact: medium, because a late or wrong encoding guess can force the parser to start again.
- Do: Make `<meta charset="utf-8">` the first element in `<head>`, or send `Content-Type: text/html; charset=utf-8`.
- Why: The browser guesses an encoding; if a later declaration disagrees, it re-parses from the start. The DevTools "Declare a character encoding" insight passes only when the meta tag is fully inside the first 1024 bytes or the header has a valid charset.
- Status: Universal.
- Sources: https://developer.chrome.com/docs/performance/insights/charset

### Include a mobile viewport meta tag in the initial HTML
- Layer: html
- Stage: layout, main-thread-task
- Metrics: INP, CLS
- When: load
- Impact: medium on mobile, because without it layout uses a ~960 px default width and taps can be delayed up to 300 ms.
- Do: Ship `<meta name="viewport" content="width=device-width, initial-scale=1">` in the server HTML, not injected by JS.
- Why: The "Optimize viewport for mobile" insight requires a `width` value and `initial-scale` >= 1 at initial render.
- Status: Universal.
- Sources: https://developer.chrome.com/docs/performance/insights/viewport, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path

### Keep the head lean: only what the first paint needs
- Layer: html
- Stage: html-parse, preload-scan, cssom
- Metrics: FCP, LCP
- When: load
- Impact: high, because the document stays render-blocked until `<body>` exists and every head stylesheet has loaded.
- Do: In `<head>` keep charset, viewport, title, critical CSS (inline or one small file), preloads for late-discovered critical assets, and `defer`/`module` scripts. Move everything else later or load it on demand.
- Why: HTML spec render-blocking mechanism: a document "allows adding render-blocking elements" only while its body element is null, and it is render-blocked while that is true or while any render-blocking element is pending (up to a UA timeout).
- Avoid/caveats: Do not inline large base64 images or fonts into the head; they delay the preload scanner's view of later resources.
- Status: Spec behavior, all engines.
- Sources: https://html.spec.whatwg.org/multipage/dom.html#render-blocking-mechanism, https://web.dev/articles/preload-scanner

### Never use document.write
- Layer: js
- Stage: html-parse, network
- Metrics: FCP, LCP, TBT
- When: load
- Impact: high where it is used, because it forces the parser to block on scripts and hides injected resources from the preload scanner.
- Do: Insert nodes with DOM APIs, or put the markup in the HTML.
- Why: Parser-blocking scripts exist largely because a script can call `document.write` and change what the parser sees next.
- Status: Discouraged per web-features (`document-write`, citing the HTML spec's "very idiosyncratic behavior"); alternative: DOM APIs.
- Sources: https://developer.chrome.com/blog/inside-browser-part3, web-features `document-write` (https://cdn.jsdelivr.net/npm/web-features/data.json)

### Server-render the first view instead of building it in client JS
- Layer: html, build
- Stage: html-parse, preload-scan, script-run
- Metrics: FCP, LCP, INP
- When: load
- Impact: high, because client-rendered markup is invisible to the preload scanner and waits for JS download, compile and run.
- Do: Render the above-the-fold shell and the LCP element on the server or at build time; hydrate after. For a chart app, render the page frame, toolbar and chart container sizes in HTML; let the chart library draw into an already-sized canvas.
- Why: Resources in JS-generated markup are discovered only after the script runs, creating critical request chains. Client-side HTML generation also does not yield the main thread the way streamed HTML parsing does.
- Avoid/caveats: Hydration cost can move the problem to INP; keep hydration work small or incremental.
- Status: Architecture choice.
- Sources: https://web.dev/learn/performance/optimize-resource-loading, https://web.dev/articles/preload-scanner, https://web.dev/articles/optimize-inp

## Items: Preload scanner and fetch priority

### Keep critical resources as plain tags in the HTML markup
- Layer: html
- Stage: preload-scan, network
- Metrics: FCP, LCP
- When: load
- Impact: high, because only markup-visible URLs are fetched early.
- Do: Reference critical scripts with `<script src ... defer>` in HTML, not injected by a loader script. Use `<img src/srcset>` for above-the-fold images, not `data-src` plus JS lazy loading.
- Why: The preload scanner reads the raw HTML while the main parser is blocked. It cannot see JS-injected scripts, JS lazy-load attributes, CSS background images, `@import`, or client-rendered HTML.
- Example:
  ```html
  <!-- Before: hidden from the preload scanner -->
  <script>const s=document.createElement('script');s.src='/app.js';document.head.append(s);</script>
  <!-- After -->
  <script src="/app.js" defer></script>
  ```
- Avoid/caveats: Injected scripts are fine for truly optional features that must not compete with first render.
- Status: Universal browser behavior.
- Sources: https://web.dev/articles/preload-scanner, https://web.dev/learn/performance/optimize-resource-loading

### Preload late-discovered critical resources, with the right as and crossorigin
- Layer: html
- Stage: preload-scan, network
- Metrics: FCP, LCP, CLS
- When: load
- Impact: high for an LCP background image, a critical font, or the startup data file; low or negative when overused.
- Do: Add `<link rel="preload">` only for resources the first render needs but the scanner cannot see: CSS background LCP images, critical fonts, the first data payload. Always set `as`. Set `crossorigin` for `as="font"` and `as="fetch"` even on the same origin. Use `imagesrcset`/`imagesizes` for responsive images.
- Why: A missing `as` makes the browser download the resource twice. Font and fetch preloads without `crossorigin` do not match the later CORS request.
- Example:
  ```html
  <link rel="preload" href="/api/chart/BTCUSD?tf=1m" as="fetch" crossorigin>
  <link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
  ```
- Avoid/caveats: Preload raises priority; preloading many things makes them compete ("when you prioritize everything, nothing will be"). A preload the page never uses is pure waste; check the Network panel after each change.
- Status: `rel=preload` Baseline widely available (2023-07-26); preloading responsive images Baseline widely available (2026-06-11) per web-features.
- Sources: https://web.dev/learn/performance/resource-hints, https://web.dev/articles/preload-scanner, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload

### Flatten ES module waterfalls with modulepreload
- Layer: html, build
- Stage: preload-scan, network, script-compile
- Metrics: FCP, LCP, startup
- When: load
- Impact: medium to high for unbundled or lightly bundled module graphs, because each import level otherwise costs a round trip.
- Do: Emit `<link rel="modulepreload">` for the entry module and a flat list of its static dependencies (most bundlers can emit this).
- Why: The browser learns a module's imports only after it fetches it. `modulepreload` fetches with the correct module credentials mode, puts the module in the module map, and can parse and compile it early; plain `preload` does neither.
- Avoid/caveats: Whether the browser follows dependencies of a modulepreloaded module is not guaranteed; list them.
- Status: Baseline widely available (2026-03-18) per web-features.
- Sources: https://web.dev/articles/modulepreload

### Give the LCP image fetchpriority=high and never lazy-load it
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP
- When: load
- Impact: high, because images start at Low priority and wait for layout to be boosted.
- Do: Put `fetchpriority="high"` on the LCP `<img>` (and on its preload, if any). Do not use `loading="lazy"` on it. Put `fetchpriority="low"` on off-screen carousel slides; use `fetch(url, { priority: 'low' })` for background requests.
- Why: Chrome boosts in-viewport images only after layout; `fetchpriority` adjusts priority relative to the default at discovery time. The LCP request discovery insight checks all three conditions.
- Example: `<img src="/hero.avif" width="1200" height="600" fetchpriority="high" alt="">`
- Avoid/caveats: It is a hint, not a directive. Marking many items high removes the benefit. Gains are largest on constrained connections.
- Status: Fetch priority Baseline 2024 newly available (2024-10-29): Chrome 101-103, Firefox 132, Safari 17.2 (web-features, BCD).
- Sources: https://web.dev/articles/fetch-priority, https://developer.chrome.com/docs/performance/insights/lcp-discovery, https://web.dev/articles/optimize-lcp

### Know Chrome's tight mode when you order head resources
- Layer: html
- Stage: network, preload-scan
- Metrics: FCP, LCP
- When: load
- Impact: medium, because low-priority requests (most images) are held back while sync head scripts are pending.
- Do: Keep sync scripts out of `<head>` so tight mode ends early; mark the LCP image `fetchpriority="high"` so it is not held back.
- Why: Per the blog source, Chrome starts in "tight mode" until head blocking scripts have run and `<body>` is attached; during it, low-priority requests start only when fewer than two requests are in flight. Blog sources say Chrome 117+ raises the first 5 large images to Medium (web.dev's 2023 priority table puts them in a higher band; check the Network panel Priority column). Safari applies a similar mode for blocking CSS or JS anywhere; Firefox does not.
- Avoid/caveats: Blog-only source (Smashing Magazine, 2025, summarizing Robin Marx); behavior is an implementation detail and can change.
- Status: Chrome implementation detail.
- Sources: https://www.smashingmagazine.com/2025/01/tight-mode-why-browsers-produce-different-performance-results/, https://web.dev/articles/fetch-priority

## Items: CSSOM (render-blocking CSS)

### Shrink render-blocking CSS: remove unused rules, minify, compress
- Layer: css, build
- Stage: network, cssom, style
- Metrics: FCP, LCP
- When: load, build
- Impact: high, because nothing paints until head CSS downloads and parses.
- Do: Remove unused selectors (DevTools Coverage panel), minify, and serve with compression. Keep one small critical stylesheet per route instead of one site-wide bundle.
- Why: CSS is render-blocking by design (to avoid FOUC) and CSSOM is not incremental: the whole sheet must arrive before it applies. Fewer rules also cut style recalc cost.
- Avoid/caveats: Tree-shaking CSS can drop rules used by JS-added classes; safelist them.
- Status: Universal.
- Sources: https://web.dev/learn/performance/optimize-resource-loading, https://developer.chrome.com/docs/performance/insights/render-blocking

### Replace CSS @import with link elements
- Layer: css
- Stage: preload-scan, network, cssom
- Metrics: FCP, LCP
- When: load
- Impact: high where chains exist, because each `@import` level waits for its parent sheet.
- Do: List every stylesheet as its own `<link rel="stylesheet">` in HTML, or let the bundler inline imports at build time.
- Why: The preload scanner cannot see `@import`, so imported sheets start only after the parent sheet is fetched and parsed.
- Example: `@import url('theme.css');` -> `<link rel="stylesheet" href="/theme.css">`
- Status: Universal.
- Sources: https://web.dev/learn/performance/optimize-resource-loading

### Inline small critical CSS and load the rest without blocking render
- Layer: css, html, build
- Stage: cssom, network
- Metrics: FCP, LCP
- When: load, build
- Impact: medium to high on first visits, because the first paint stops waiting for a network round trip.
- Do: Inline the few rules the first viewport needs in `<style>`; load the remainder with `<link rel="preload" as="style">` swapped to `stylesheet` on load, with a `<noscript>` fallback, or move it to a later route chunk.
- Why: Inline CSS needs no request. The web.dev case study cut FCP from 1.0 s to 0.8 s.
- Example:
  ```html
  <style>/* shell + toolbar + chart frame only */</style>
  <link rel="preload" href="/rest.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="/rest.css"></noscript>
  ```
- Avoid/caveats: Chrome's insight labels this "an advanced performance technique" that can cause bugs; inlined bytes are not cached across pages and enlarge the first HTML chunk; inline `onload` needs CSP allowance. Most sites can meet targets without it.
- Status: Universal.
- Sources: https://web.dev/articles/defer-non-critical-css, https://developer.chrome.com/docs/performance/insights/render-blocking, https://web.dev/learn/performance/optimize-resource-loading

### Split CSS by media query and give each link a matching media attribute
- Layer: css, html
- Stage: cssom, network
- Metrics: FCP, LCP
- When: load
- Impact: medium, because non-matching sheets stop blocking render and drop to Lowest priority.
- Do: Put print and large-breakpoint-only rules in separate files with `media="print"` or `media="(min-width: 1200px)"`.
- Why: Only stylesheets whose `media` matches the environment block rendering; `media="all"` or no `media` blocks.
- Status: Universal.
- Sources: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path, https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources, https://web.dev/articles/fetch-priority

### Put no sync script right after a stylesheet unless it needs those styles
- Layer: html
- Stage: html-parse, cssom, script-run
- Metrics: FCP, LCP
- When: load
- Impact: medium, because a sync script waits for every earlier pending stylesheet before it runs, and the parser waits for the script.
- Do: Place small inline scripts that do not read styles (feature flags, theme class) before the stylesheet links; make everything else `defer`/`module`.
- Why: HTML spec "script-blocking style sheet": parser-inserted styles and matching stylesheet links block later parser-inserted scripts until they load, so CSS download time becomes parser-blocking time.
- Status: Spec behavior, all engines.
- Sources: https://html.spec.whatwg.org/multipage/semantics.html (script-blocking style sheet set), https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work

### Use body-level stylesheets only for progressive sections, and expect them to block the parser below
- Layer: html, css
- Stage: cssom, html-parse
- Metrics: FCP, LCP, CLS
- When: load
- Impact: low to medium; it lets the top of the page paint before below-the-fold CSS arrives.
- Do: If a large section has its own CSS, put its `<link rel="stylesheet">` right before that section in `<body>`.
- Why: Per spec, only elements seen before `<body>` exists can render-block the whole document. Chrome classifies a body stylesheet as `in_body_parser_blocking`: it stops parsing of content below it until it loads.
- Avoid/caveats: Content-sized layouts (flex, tables) can shift when the section's CSS arrives (CLS). Chrome's current behavior comes from blog sources (Jake Archibald 2016; Tim Kadlec 2021) plus the spec; verify in the Network track.
- Status: Spec behavior plus Chrome implementation detail.
- Sources: https://html.spec.whatwg.org/multipage/dom.html#render-blocking-mechanism, https://jakearchibald.com/2016/link-in-body/, https://www.catchpoint.com/blog/new-render-blocking-indicator-in-chrome-and-webpagetest

## Items: Scripts

### Default app scripts to defer or type=module; use async only for independent scripts
- Layer: html, js
- Stage: html-parse, script-compile, script-run
- Metrics: FCP, LCP, TBT, INP
- When: load
- Impact: high, because a classic sync script in `<head>` blocks parsing, keeps `<body>` from existing, and therefore blocks render.
- Do: Use `<script type="module" src>` or `<script defer src>` for app code (order kept, runs after parse, before `DOMContentLoaded`). Use `async` for scripts with no ordering needs (analytics, monitoring). Load third parties with `async` or after load.
- Why: `async` runs as soon as it arrives and can interrupt parsing; `defer` and module scripts run after parsing in document order. `async` wins if both are set; `defer` has no effect on modules or inline scripts.
- Example:
  ```html
  <script type="module" src="/main.js"></script>
  <script async src="https://rum.example.com/rum.js"></script>
  ```
- Avoid/caveats: Code that must run before first paint (theme class to avoid a flash) should be a tiny inline script, not an async file.
- Status: `<script>` Baseline widely available; JS modules Baseline widely available (2020-11-09) per web-features.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script, https://web.dev/learn/performance/optimize-resource-loading, https://web.dev/learn/performance/understanding-the-critical-path

### Keep inline scripts tiny; ship large code as external files
- Layer: js, build
- Stage: script-compile, main-thread-task
- Metrics: TBT, FCP, startup
- When: load, build
- Impact: medium, because inline scripts parse and compile on the main thread while external scripts can stream-compile on background threads.
- Do: Inline only bootstrapping code under ~1 kB; put the rest in cacheable external files.
- Why: V8 script streaming parses and compiles external scripts off the main thread while they download (async/defer first; sync external scripts since Chrome 72). External files also get V8 code caching on repeat visits.
- Avoid/caveats: The 1 kB number is from 2019 V8 guidance; treat it as a direction, not a limit.
- Status: V8/Chrome behavior.
- Sources: https://v8.dev/blog/cost-of-javascript-2019

### Split the startup bundle so the critical path carries only first-view code
- Layer: build, js
- Stage: network, script-compile, script-run
- Metrics: FCP, LCP, TBT, INP, bundle-size
- When: build, load
- Impact: high, because JS download, compile and execution all delay first render or first interactivity.
- Do: Code-split by route and by feature (for example, load drawing tools, indicators, and settings panels on demand). Keep startup chunks small; 2019 V8 guidance suggested splitting bundles above ~50-100 kB.
- Why: Script evaluation during load creates long tasks that delay rendering and add input delay.
- Avoid/caveats: Too many tiny chunks create request waterfalls; pair with `modulepreload` for the chunks you know you need.
- Status: Build practice.
- Sources: https://v8.dev/blog/cost-of-javascript-2019, https://web.dev/articles/optimize-inp, https://developer.chrome.com/docs/performance/insights/network-dependency-tree

### Use blocking=render only to hide a known flash of wrong content
- Layer: html
- Stage: cssom, script-run
- Metrics: FCP, LCP, CLS
- When: load
- Impact: low (targeted); it trades later first paint for no flicker.
- Do: Add `blocking="render"` to a head `<script async>` (or `<style>`/`<link rel=stylesheet>`) only when the first paint must include its effect, for example an experiment or a theme decision. Keep the resource small and fast.
- Why: It makes the element render-blocking without making it parser-blocking, so parsing and the preload scanner continue. It only takes effect while `<body>` does not exist yet (spec). Dynamically inserted scripts need the attribute to block rendering.
- Example: `<script async blocking="render" src="/exp-assign.js"></script>`
- Avoid/caveats: Default answer is "don't" (CSS Wizardry). The browser applies an implementation-defined timeout. Firefox ignores it.
- Status: Chrome/Edge 105, Safari 18.2; not Firefox; not Baseline (web-features `blocking-render`).
- Sources: https://html.spec.whatwg.org/multipage/urls-and-fetching.html (blocking attributes), https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script, https://csswizardry.com/2024/08/blocking-render-why-whould-you-do-that/

### Use rel=expect with blocking=render only to stabilize cross-document view transitions
- Layer: html
- Stage: html-parse
- Metrics: FCP, LCP
- When: load
- Impact: low (niche); it delays first render until a named element is parsed.
- Do: `<link rel="expect" href="#chart-root" blocking="render">` in `<head>` when a cross-document view transition needs that element present in the first rendered frame.
- Why: The spec keeps the document render-blocked while the indicated element is not yet parsed (or still on the parser's open-element stack).
- Avoid/caveats: Pointing at an element far down the page delays FCP for everyone.
- Status: Chrome/Edge 124 only; experimental per BCD; not Baseline.
- Sources: https://html.spec.whatwg.org/multipage/links.html (link type expect), https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel#expect

## Items: Fonts and media on the critical path

### Make critical fonts discoverable early and keep text visible
- Layer: css, html
- Stage: preload-scan, network, layout, paint
- Metrics: FCP, LCP, CLS
- When: load
- Impact: medium to high for text LCP, because a font is requested only after CSS and the render tree show that it is used.
- Do: Inline the `@font-face` rules in the head; preload only the one or two WOFF2 files used above the fold (`crossorigin` required); subset with `unicode-range`; set `font-display: swap` or `optional`; tune fallback metrics with `size-adjust`/`ascent-override`.
- Why: Late discovery puts fonts at the end of the chain. `block` hides text up to ~3 s; `swap` shows fallback at once; `optional` gives ~100 ms and then keeps the fallback. The Font display insight passes only with `swap` or `optional`.
- Example:
  ```css
  @font-face { font-family: Inter; src: url(/fonts/inter-latin.woff2) format('woff2'); font-display: optional; }
  ```
- Avoid/caveats: Do not inline font files (they bloat the HTML). Preloading fonts not used above the fold steals bandwidth.
- Status: `font-display` Baseline widely available (2022-07-15); `font-size-adjust` Baseline 2024 newly available (web-features).
- Sources: https://web.dev/articles/font-best-practices, https://developer.chrome.com/docs/performance/insights/font-display, https://web.dev/articles/optimize-cls

### Reserve space for images, iframes and late UI
- Layer: html, css
- Stage: layout
- Metrics: CLS, LCP
- When: load
- Impact: high for CLS, because unsized content forces relayout and shifts when it arrives.
- Do: Put `width` and `height` attributes on every `<img>`/`<video>`/`<iframe>`, or set `aspect-ratio`; give ad/embed/late panels a `min-height` or skeleton of the final size. Size the chart container in CSS before the chart library loads.
- Why: Browsers map `width`/`height` to a default aspect ratio, so layout knows the box before the bytes arrive. A late image without size triggers reflow, repaint and re-composite.
- Avoid/caveats: Removing a reserved box later is also a shift.
- Status: `aspect-ratio` Baseline widely available (newly available 2021-09-20, per web-features).
- Sources: https://web.dev/articles/optimize-cls, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work

### Lazy-load only below-the-fold images and iframes, natively
- Layer: html
- Stage: network, preload-scan
- Metrics: LCP, bandwidth
- When: load
- Impact: medium; frees bandwidth for critical requests.
- Do: Use `loading="lazy"` on images and iframes that start outside the viewport; keep above-the-fold ones eager.
- Why: Native lazy loading keeps the URL in markup (scanner-visible) but defers the fetch; JS lazy loaders hide URLs entirely.
- Avoid/caveats: Lazy-loading the LCP image delays LCP (LCP request discovery insight).
- Status: Baseline widely available (2026-06-19) per web-features.
- Sources: https://developer.chrome.com/docs/performance/insights/lcp-discovery, https://web.dev/articles/preload-scanner

## Items: Style and layout

### Keep selectors simple and style changes narrow
- Layer: css
- Stage: style
- Metrics: INP, TBT, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium, because style cost is roughly elements affected x selectors to test, and about half of Blink's per-element style time is selector matching.
- Do: Prefer single-class selectors over deep descendant or positional chains; toggle classes on the smallest subtree that needs to change, not on `<body>`.
- Why: Changing a class high in the tree invalidates many descendants; complex selectors fall to slower matching paths.
- Example: `.box:nth-last-child(-n+1) .title` -> `.final-box-title`.
- Avoid/caveats: Selector micro-tuning rarely matters on small DOMs; measure first with "Enable CSS selector stats" (adds overhead to the recording).
- Status: Universal.
- Sources: https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations, https://developer.chrome.com/docs/devtools/performance/selector-stats, https://developer.chrome.com/docs/performance/insights/slow-css-selector

### Keep the DOM small and shallow; create hidden UI on demand
- Layer: html, js
- Stage: style, layout, gc-memory
- Metrics: INP, LCP, memory
- When: load, interaction, long-lived session
- Impact: high on data-heavy pages (order books, trade lists), because style and layout work grows with elements touched.
- Do: Virtualize long lists and tables; render menus, dialogs and settings only when opened; remove wrapper-only elements.
- Why: The Optimize DOM size insight fails when a style recalc touching more than 300 elements or a layout of more than 100 layout objects takes over 40 ms. Large DOMs also hold more memory and JS references.
- Avoid/caveats: Virtualization must keep find-in-page and accessibility working where users need them.
- Status: Universal.
- Sources: https://developer.chrome.com/docs/performance/insights/dom-size, https://web.dev/articles/dom-size-and-interactivity

### Skip rendering of off-screen sections with content-visibility:auto
- Layer: css
- Stage: style, layout, paint
- Metrics: LCP, INP, FPS/smoothness
- When: load, interaction
- Impact: high on long pages; web.dev measured 232 ms -> 30 ms rendering on load.
- Do: Put `content-visibility: auto` plus `contain-intrinsic-size: auto <estimate>` on large independent sections below the fold (for example, secondary panels, news lists).
- Why: Off-screen `auto` elements get layout, style, paint (and size) containment, so their subtrees skip style, layout and paint until near the viewport. `auto` in `contain-intrinsic-size` remembers the last rendered size and avoids scrollbar jumps.
- Example:
  ```css
  .news-card { content-visibility: auto; contain-intrinsic-size: auto 320px; }
  ```
- Avoid/caveats: Wrong size estimates cause scroll jumps; off-screen landmarks may need `aria-hidden` handling per web.dev. Do not put it on the element that holds the LCP.
- Status: Baseline 2025 newly available (2025-09-15): Chrome 108, Firefox 130, Safari 26 per web-features (`auto` value in Safari 26 per BCD).
- Sources: https://web.dev/articles/content-visibility, https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering

### Contain independent widgets such as chart containers
- Layer: css
- Stage: layout, paint, style
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium, because layout and paint inside the widget stop affecting (and being affected by) the rest of the page.
- Do: Give fixed-size widgets `contain: strict` (size + layout + paint + style) or content-sized ones `contain: content` (layout + paint + style).
- Why: Containment lets the browser limit layout, style and paint work to the subtree; `paint` also lets off-screen subtrees skip painting.
- Example: `.chart-pane { contain: strict; width: 100%; height: 480px; }`
- Avoid/caveats: `layout`/`paint`/`content`/`strict` create a new containing block for fixed/absolute descendants and a new stacking context; `paint` clips overflow (tooltips and menus that must escape need to live outside); `size` needs explicit dimensions.
- Status: `contain` Baseline widely available (2024-09-14) per web-features.
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/contain, https://web.dev/articles/content-visibility

### Batch DOM reads before writes; never read geometry after a write in the same task
- Layer: js
- Stage: style, layout, main-thread-task
- Metrics: INP, TBT, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: high where it happens in loops (layout thrashing).
- Do: Read all geometry (`offsetWidth`, `getBoundingClientRect()`, `scrollTop`, `getComputedStyle`) first, then write styles. Cache reads outside loops. Move writes into rAF when reads come from events.
- Why: A geometry read after a style/DOM write forces style and layout to run synchronously. The Forced reflow insight fails on any forced reflow over 30 ms.
- Example:
  ```js
  // Before: layout per iteration
  for (const row of rows) row.style.width = `${host.offsetWidth}px`;
  // After: one read, then writes
  const w = host.offsetWidth;
  for (const row of rows) row.style.width = `${w}px`;
  ```
- Avoid/caveats: The full list of layout-forcing APIs is in Paul Irish's gist (linked from web.dev).
- Status: Universal.
- Sources: https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing, https://developer.chrome.com/docs/performance/insights/forced-reflow

## Items: Paint, layers and compositing

### Animate only compositor properties: transform, opacity, filter
- Layer: css, js
- Stage: composite, style
- Metrics: FPS/smoothness, CLS, INP
- When: animation/render-loop, interaction
- Impact: high, because compositor animations skip layout and paint and keep running while the main thread is busy.
- Do: Move with `transform: translate()`, resize visually with `scale()`, fade with `opacity`. Never animate `top`, `left`, `width`, `height`, `margin` or `box-shadow`.
- Why: Chromium's cc animation framework animates transform lists, opacity and filter lists directly on property-tree nodes on the compositor thread. Composited transform animations do not count toward CLS.
- Example:
  ```css
  /* Before */ .panel.open { left: 0; transition: left .2s; }
  /* After  */ .panel.open { transform: translateX(0); transition: transform .2s; }
  ```
- Avoid/caveats: A 2021 Chrome post said background-color and clip-path compositing were planned; do not rely on them without checking the Animations track, which marks non-composited animations. Percentage transforms composite only if layout size does not change every frame.
- Status: transform/opacity composited in all engines; filter hardware-accelerated in Chrome (2021 post).
- Sources: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/how_cc_works.md, https://web.dev/articles/animations-guide, https://developer.chrome.com/blog/hardware-accelerated-animations, https://web.dev/articles/optimize-cls

### Use will-change sparingly and just in time
- Layer: css
- Stage: composite, raster, gpu-upload, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium; a layer avoids repaint of the rest of the page, but each layer costs GPU memory and upload bandwidth.
- Do: Add `will-change: transform` only to elements that animate often, ideally just before the animation, and remove it after. Check layer count in the Layers panel or Rendering > Layer borders.
- Why: Layer promotion lets the compositor move the element without repaint; but too many layers slow compositing (the old web.dev target was ~4-5 ms of compositing for scroll) and use memory.
- Avoid/caveats: Do not blanket-promote (`* { will-change: transform }`). Low-DPI devices do not auto-promote fixed elements.
- Status: `will-change` Baseline widely available (2022-07-15).
- Sources: https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count, https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas, https://web.dev/articles/animations-guide

### Reduce paint area and paint cost
- Layer: css
- Stage: paint, raster
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, interaction
- Impact: medium; large blurs and shadows can exceed a frame's paint budget on mobile.
- Do: Avoid animating properties that repaint large areas; keep blur/shadow effects small and static; separate frequently changing small elements (a price ticker cell) from large static backgrounds.
- Why: Overlapping dirty regions are unioned, so one small change next to a big one can repaint both. Only transform and opacity changes avoid paint.
- Avoid/caveats: Guidance is from 2015 articles; verify with Rendering > Paint flashing and Paint profiler ("Enable advanced paint instrumentation").
- Status: Universal.
- Sources: https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas, https://developer.chrome.com/docs/devtools/performance/reference

### Decode large images before they enter the frame
- Layer: js, html
- Stage: raster, main-thread-task
- Metrics: FPS/smoothness, INP
- When: interaction, animation/render-loop
- Impact: medium; image decode is the most expensive part of raster.
- Do: For images inserted during interaction, `await img.decode()` before appending; serve images at display size.
- Why: cc gives each decode its own raster task; a large undecoded image can hold a frame's tiles back.
- Example:
  ```js
  const img = new Image(); img.src = url; await img.decode(); slot.append(img);
  ```
- Status: `HTMLImageElement.decode()` in Chrome 64, Firefox 68, Safari 11.1 (BCD).
- Sources: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/how_cc_works.md

## Items: The update frame (interaction and render loop)

### Write visual updates inside requestAnimationFrame and drive motion by its timestamp
- Layer: js, canvas2d, gpu
- Stage: script-run, style, layout, paint
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, interaction
- Impact: high for charts, because one frame-aligned draw per vsync replaces many redundant draws.
- Do: In event handlers only record state (latest pointer position, new ticks) and mark "dirty"; draw once in a single rAF loop. Compute motion from the rAF timestamp, not a per-frame constant.
- Why: rAF runs right before style/layout/paint in each rendering opportunity; all callbacks in a frame share one timestamp; continuous input is already coalesced to one dispatch before rAF. Without the timestamp, animations run faster on 120/144 Hz screens.
- Example:
  ```js
  let dirty = false, last = null;
  canvas.addEventListener('pointermove', (e) => { last = e; if (!dirty) { dirty = true; requestAnimationFrame(draw); } });
  function draw(ts) { dirty = false; renderCrosshair(last.offsetX, last.offsetY, ts); }
  ```
- Avoid/caveats: rAF does not run in hidden tabs or hidden iframes; do not use it for non-visual work.
- Status: rAF Baseline widely available (2018).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame, https://developer.chrome.com/blog/inside-browser-part4, https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering

### Paint the response first, then defer non-visual work until after the next frame
- Layer: js
- Stage: main-thread-task, script-run
- Metrics: INP
- When: interaction
- Impact: high, because presentation delay includes any work left in the same task.
- Do: In a handler, do only the visible update; schedule persistence, analytics and recalculation after the next paint (rAF then `setTimeout(0)`, or `scheduler.yield()`).
- Why: INP ends at the next presented frame; work queued after the rAF runs after that frame.
- Example:
  ```js
  button.addEventListener('click', () => {
    applyOrderTypeUI();
    requestAnimationFrame(() => setTimeout(() => { saveDraft(); track('order_type'); }, 0));
  });
  ```
- Status: Universal.
- Sources: https://web.dev/articles/optimize-inp

### Break long tasks by yielding about every 50 ms
- Layer: js
- Stage: main-thread-task
- Metrics: INP, TBT, FPS/smoothness
- When: load, interaction, long-lived session
- Impact: high; no rendering and no input handling can happen while a task runs.
- Do: In long loops (parsing a big history payload, recomputing indicators), check elapsed time and `await scheduler.yield()` when over ~50 ms; fall back to `setTimeout` where `scheduler` is missing.
- Why: A long task is >50 ms. `scheduler.yield()` continuations run ahead of other queued tasks, so work resumes in order after the browser renders and handles input.
- Example:
  ```js
  const yieldToMain = () => globalThis.scheduler?.yield ? scheduler.yield() : new Promise(r => setTimeout(r, 0));
  let t = performance.now();
  for (const bar of bars) { addBar(bar); if (performance.now() - t > 50) { await yieldToMain(); t = performance.now(); } }
  ```
- Avoid/caveats: Nested `setTimeout` gets a 4-5 ms clamp after five levels. `navigator.scheduling.isInputPending()` is discouraged (can return false negatives).
- Status: `scheduler.yield()` Chrome/Edge 129, Firefox 142, not Safari; not Baseline (web-features `scheduler`). isInputPending discouraged per web-features.
- Sources: https://web.dev/articles/optimize-long-tasks

### Use passive listeners and attach non-passive wheel/touch handlers only to the chart surface
- Layer: js, css
- Stage: composite, main-thread-task
- Metrics: FPS/smoothness, INP
- When: interaction
- Impact: high for scroll smoothness, because a blocking listener makes its area wait for the main thread before scrolling.
- Do: Pass `{ passive: true }` to scroll-related listeners you do not cancel. When the chart must cancel `wheel` (zoom) or `touchmove` (pan), attach `{ passive: false }` on the chart canvas element only, never on `window`/`document`/`body`. Prefer CSS `touch-action: none` (or `pan-y`) on the chart surface over `preventDefault()` for touch.
- Why: The compositor marks areas with blocking handlers as non-fast scrollable regions. Delegating a blocking handler at the document level turns the whole page into one. Browsers other than Safari default `wheel`/`touchstart`/`touchmove` on window/document/body to passive, so an explicit `passive: false` is needed where you do cancel.
- Example:
  ```js
  chartCanvas.addEventListener('wheel', onZoom, { passive: false }); // scoped to the chart only
  ```
- Status: `passive` option in all engines (Chrome 51, Firefox 49, Safari 10); `touch-action` Baseline widely available.
- Sources: https://developer.chrome.com/blog/inside-browser-part4, https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener

### Read coalesced pointer events when you need every input point
- Layer: js
- Stage: script-run
- Metrics: FPS/smoothness
- When: interaction
- Impact: low to medium; improves drawing-tool precision without more dispatches.
- Do: In a `pointermove` handler for freehand drawing, iterate `e.getCoalescedEvents()` to get the intermediate points, but still render once per frame.
- Why: Chrome coalesces continuous events (mice ~100 Hz, touch 60-120 Hz) into one dispatch per frame before rAF.
- Status: Chrome 58, Firefox 59, Safari 18.2 (BCD).
- Sources: https://developer.chrome.com/blog/inside-browser-part4

### Size canvases from ResizeObserver; use IntersectionObserver to pause off-screen work
- Layer: js, canvas2d, gpu
- Stage: layout, paint, main-thread-task
- Metrics: FPS/smoothness, CLS, memory
- When: interaction, long-lived session
- Impact: medium; same-frame resize avoids a stretched frame, and pausing hidden charts frees the main thread.
- Do: Observe the chart container with ResizeObserver and set the canvas backing size in the callback; do not write sizes that re-trigger the same observer depth. Observe chart panels with IntersectionObserver and stop their render loops while not intersecting.
- Why: HTML spec order: ResizeObserver callbacks run after layout and before paint in the same rendering update, and the loop repeats only for deeper elements (else a "resize loop" error). IntersectionObserver results are delivered by a queued task, so they arrive after that frame; fine for pause/resume, too late for same-frame layout.
- Example:
  ```js
  new ResizeObserver(([e]) => { const b = e.devicePixelContentBoxSize?.[0]; resizeBacking(b ? b.inlineSize : Math.round(e.contentRect.width * devicePixelRatio)); }).observe(pane);
  ```
- Avoid/caveats: `devicePixelContentBoxSize` is not in Safari (BCD); keep the fallback.
- Status: ResizeObserver Baseline widely available (2023-01-28); IntersectionObserver Baseline widely available (2021-09-25) per web-features.
- Sources: https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering, https://w3c.github.io/IntersectionObserver/

### Stop render loops when the document is hidden
- Layer: js
- Stage: idle, main-thread-task, gpu-draw
- Metrics: memory, FPS/smoothness (on return), battery
- When: long-lived session
- Impact: medium for trading terminals left open in background tabs.
- Do: On `visibilitychange` to hidden, stop timers that exist only to feed drawing, keep state updates cheap (buffer ticks), and redraw once on visible.
- Why: The spec removes hidden documents from each rendering update, so no rAF or paint happens; `setInterval`-driven drawing still burns CPU for nothing.
- Status: Page Visibility Baseline widely available.
- Sources: https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering, https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame

### Move heavy canvas or WebGL drawing off the main thread with OffscreenCanvas
- Layer: canvas2d, gpu, js
- Stage: main-thread-task, gpu-draw
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, long-lived session
- Impact: high when drawing competes with UI work, because the worker renders even while the main thread is busy.
- Do: `canvas.transferControlToOffscreen()`, post it to a worker, and drive drawing with the worker's `requestAnimationFrame`. Keep input handling on the main thread and send compact state to the worker.
- Why: OffscreenCanvas decouples canvas rendering from the DOM and main thread; the worker has its own event loop and rendering update.
- Example:
  ```js
  const off = canvas.transferControlToOffscreen();
  worker.postMessage({ canvas: off }, [off]);
  ```
- Avoid/caveats: Only if the chart library supports worker rendering (SciChart.js support not verified here). Text measurement and DOM overlays still live on the main thread; message latency adds up to a frame.
- Status: OffscreenCanvas Baseline widely available (2025-09-27); rAF in workers Baseline widely available (2025-09-27) per web-features.
- Sources: https://web.dev/articles/offscreen-canvas, https://html.spec.whatwg.org/multipage/webappapis.html (worker event loop rendering)

### Do not rely on requestIdleCallback alone
- Layer: js
- Stage: idle
- Metrics: INP, TBT
- When: load, long-lived session
- Impact: low; mainly a correctness issue.
- Do: Feature-detect `requestIdleCallback` and fall back to `setTimeout` or `scheduler.postTask(fn, { priority: 'background' })`.
- Why: Idle periods end at the next render deadline (spec computes them from the refresh rate), and Safari does not ship the API.
- Status: Not Baseline: Chrome 47, Firefox 55; Safari only behind a flag in Technology Preview (BCD).
- Sources: https://html.spec.whatwg.org/multipage/webappapis.html (start an idle period), web-features `requestidlecallback`

## Items: Tooling and verification (DevTools, field data, WebMCP)

### Read the CRP in the DevTools Performance panel before and after each change
- Layer: tooling
- Stage: network, html-parse, cssom, script-run, style, layout, paint, composite
- Metrics: FCP, LCP, CLS, INP, TBT
- When: testing
- Impact: high; it shows which phase is on the critical path instead of guessing.
- Do: Record with CPU throttling (Capture settings; use the field-calibrated preset) and a reload. Check the Network track render-blocking markers, the Main track names (**Parse HTML**, **Parse stylesheet**, **Evaluate script**, **Recalculate style**, **Layout**, **Pre-paint**, **Paint**, **Layerize**, **Commit**, **Animation frame fired**, **Run microtasks**, **Compute intersections**), the Thread pool (**Rasterize paint**, **Image decode**), GPU and Frames tracks. Read the insights: Render-blocking requests, LCP breakdown, LCP request discovery, Network dependency tree, Document request latency, Forced reflow, Optimize DOM size, CSS selector costs, Layout shift culprits, INP breakdown, Font display, Viewport, Character encoding.
- Why: Each insight has a pass rule (for example: forced reflow <30 ms; DOM-size failure needs a >40 ms recalc/layout; LCP subpart targets ~40% TTFB, <10% load delay, ~40% load duration, <10% render delay).
- Avoid/caveats: "Enable CSS selector stats" and "advanced paint instrumentation" add overhead; turn them off when you measure timing. Lab results differ from field; compare with CrUX.
- Status: Current Chrome DevTools (insight pages published 2025-10-08; event titles checked in DevTools frontend source `front_end/models/trace/Styles.ts`).
- Sources: https://developer.chrome.com/docs/devtools/performance/reference, https://developer.chrome.com/docs/performance/insights, https://web.dev/articles/optimize-lcp, https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/Styles.ts

### Measure frame phases in the field with Long Animation Frames and renderBlockingStatus
- Layer: tooling, js
- Stage: main-thread-task, style, layout, network
- Metrics: INP, LCP, FPS/smoothness
- When: long-lived session, testing
- Impact: medium; attributes slow frames to scripts and to forced style/layout.
- Do: Observe `long-animation-frame` entries (`buffered: true`) and log `blockingDuration`, `renderStart`, `styleAndLayoutStart`, and per-script `invoker`, `sourceURL`, `forcedStyleAndLayoutDuration`. Log `PerformanceResourceTiming.renderBlockingStatus` to catch new render-blocking assets.
- Why: LoAF reports whole frames (tasks plus rendering) over 50 ms, which Long Tasks cannot.
- Example:
  ```js
  if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
    new PerformanceObserver((l) => l.getEntries().forEach(report)).observe({ type: 'long-animation-frame', buffered: true });
  }
  ```
- Status: LoAF Chrome/Edge 123 only, experimental per BCD; `renderBlockingStatus` Chrome/Edge 107 only (BCD).
- Sources: https://developer.chrome.com/docs/web-platform/long-animation-frames

### Let the agent verify CRP changes with Chrome DevTools MCP traces
- Layer: tooling
- Stage: network, html-parse, cssom, script-run, style, layout, paint
- Metrics: LCP, CLS, INP, FCP, TTFB
- When: testing
- Impact: high for agent-written code; it replaces "should be faster" with a measured trace.
- Do: After a change: `navigate_page` to the dev URL, `emulate` (`cpuThrottlingRate`, `networkConditions` such as "Slow 4G"), `performance_start_trace` with `reload: true, autoStop: true`, then `performance_analyze_insight` for `RenderBlocking`, `LCPBreakdown`, `NetworkDependencyTree`, `CLSCulprits`, `DocumentLatency`. Use `list_network_requests`/`get_network_request` to check priority and render-blocking flags. Compare before/after numbers in the report.
- Why: The trace summary lists lab LCP/CLS with subparts, CrUX field values, and insight sets; network rows carry `priority`, `initialPriority` and a `renderBlocking` flag. Confirmed on 2026-09-22 with a live trace of web.dev (lab LCP 426 ms = TTFB 292 ms + render delay 134 ms; three render-blocking CSS requests listed).
- Avoid/caveats: By default the server sends trace URLs to the CrUX API (`--performanceCrux=false` for private/local URLs). `filePath` must be inside the MCP server's workspace roots. `lighthouse_audit` excludes performance; use traces for performance. One trace is noisy; repeat.
- Status: chrome-devtools-mcp (GitHub docs fetched 2026-09-22).
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md, https://developer.chrome.com/blog/chrome-devtools-mcp

### Expose read-only render diagnostics as dev-only tools for agents (WebMCP or DevTools 3P tools)
- Layer: tooling, js
- Stage: main-thread-task, gpu-draw
- Metrics: FPS/smoothness, INP, memory
- When: testing
- Impact: medium; agents can read internal render state (frame times, points drawn, layer/series counts) and drive repeatable scenarios instead of scraping pixels.
- Do: In development builds only, register tools such as `get_render_stats` (read-only) and `set_visible_range` (drives a deterministic zoom for a perf trace). Two routes:
  (1) WebMCP: `document.modelContext.registerTool({ name, description, inputSchema, execute, annotations: { readOnlyHint: true } }, { signal })`; unregister with the AbortController. Inspect in DevTools Application > WebMCP; agents call them through Chrome DevTools MCP `list_webmcp_tools` / `execute_webmcp_tool` (server flag `--categoryExperimentalWebmcp=true`).
  (2) DevTools third-party developer tools: answer the `devtoolstooldiscovery` window event with `event.respondWith({ name, description, tools: [...] })`; agents call `list_3p_developer_tools` / `execute_3p_developer_tool` (flag `--categoryExperimentalThirdParty=true`) or `window.__dtmcp.executeTool()` inside `evaluate_script`.
- Why: Tools return structured JSON the agent can compare across runs; combined with `performance_start_trace` the agent can script "zoom chart to 50k bars, record, read LoAF and render stats".
- Example:
  ```js
  if (import.meta.env.DEV && document.modelContext) {
    const ac = new AbortController();
    await document.modelContext.registerTool({
      name: 'get_render_stats',
      description: 'Returns last 120 chart frame times (ms) and points drawn per frame. Read-only.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => JSON.stringify(chartStats.snapshot()),
    }, { signal: ac.signal });
  }
  ```
- Avoid/caveats: Both APIs are experimental and changing: the object moved to `document.modelContext` in current docs, JSON-string input arguments are deprecated from Chrome 155, unregister-without-cancel landed in Chrome 153. WebMCP needs an origin-isolated document and the `tools` Permissions Policy (cross-origin iframes need `allow="tools"`). Never ship write tools (orders, account actions) as dev hooks; mark any consequential tool with `consequentialHint: true`. Keep tool code out of production bundles unless the product intends to expose it.
- Status: WebMCP: origin trial from Chrome 149, local flag `chrome://flags/#enable-webmcp-testing` (WebMCP docs updated 2026-08-07 / 2026-09-11); DevTools WebMCP pane doc updated 2026-05-12. Not in other engines.
- Sources: https://developer.chrome.com/docs/ai/webmcp, https://developer.chrome.com/docs/ai/webmcp/imperative-api, https://developer.chrome.com/docs/ai/webmcp/declarative-api, https://developer.chrome.com/docs/devtools/application/webmcp, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/third-party-developer-tools.md, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md

## Sources read
- https://web.dev/learn/performance/understanding-the-critical-path
- https://web.dev/learn/performance/optimize-resource-loading
- https://web.dev/learn/performance/resource-hints
- https://web.dev/articles/preload-scanner
- https://web.dev/articles/rendering-performance
- https://web.dev/articles/fetch-priority
- https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing
- https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations
- https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas
- https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count
- https://web.dev/articles/animations-guide
- https://web.dev/articles/optimize-lcp
- https://web.dev/articles/optimize-inp
- https://web.dev/articles/optimize-cls
- https://web.dev/articles/optimize-ttfb
- https://web.dev/articles/optimize-long-tasks
- https://web.dev/articles/content-visibility
- https://web.dev/articles/bfcache
- https://web.dev/articles/offscreen-canvas
- https://web.dev/articles/font-best-practices
- https://web.dev/articles/defer-non-critical-css
- https://web.dev/articles/modulepreload
- https://web.dev/articles/dom-size-and-interactivity
- https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path
- https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel#expect
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/contain
- https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
- https://developer.chrome.com/docs/chromium/renderingng-architecture
- https://developer.chrome.com/docs/chromium/renderingng-data-structures
- https://developer.chrome.com/blog/inside-browser-part3
- https://developer.chrome.com/blog/inside-browser-part4
- https://developer.chrome.com/blog/hardware-accelerated-animations
- https://developer.chrome.com/blog/paint-holding
- https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources
- https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations
- https://developer.chrome.com/docs/devtools/performance/reference
- https://developer.chrome.com/docs/devtools/performance/timeline-reference
- https://developer.chrome.com/docs/devtools/performance/selector-stats
- https://developer.chrome.com/docs/devtools/rendering/performance
- https://developer.chrome.com/docs/performance/insights (index) and subpages: render-blocking, lcp-discovery, lcp-breakdown, forced-reflow, network-dependency-tree, dom-size, viewport, charset, document-latency, slow-css-selector, inp-breakdown, cls-culprit, font-display
- https://developer.chrome.com/docs/web-platform/long-animation-frames
- https://developer.chrome.com/docs/web-platform/early-hints
- https://developer.chrome.com/docs/web-platform/prerender-pages
- https://developer.chrome.com/docs/ai/webmcp
- https://developer.chrome.com/docs/ai/webmcp/imperative-api
- https://developer.chrome.com/docs/ai/webmcp/declarative-api
- https://developer.chrome.com/docs/devtools/application/webmcp
- https://developer.chrome.com/blog/chrome-devtools-mcp
- https://github.com/ChromeDevTools/chrome-devtools-mcp (README.md, docs/tool-reference.md, docs/configuration.md, docs/third-party-developer-tools.md)
- https://github.com/ChromeDevTools/devtools-frontend (front_end/models/trace/Styles.ts, front_end/models/trace/types/TraceEvents.ts)
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/how_cc_works.md
- https://html.spec.whatwg.org/multipage/webappapis.html (event loop processing model, update the rendering, idle periods, microtask checkpoint)
- https://html.spec.whatwg.org/multipage/dom.html (render-blocking mechanism)
- https://html.spec.whatwg.org/multipage/semantics.html (style element, script-blocking style sheets)
- https://html.spec.whatwg.org/multipage/links.html (stylesheet and expect link types)
- https://html.spec.whatwg.org/multipage/scripting.html
- https://html.spec.whatwg.org/multipage/urls-and-fetching.html (blocking attributes, fetch priority attributes)
- https://w3c.github.io/IntersectionObserver/
- https://v8.dev/blog/cost-of-javascript-2019
- https://csswizardry.com/2024/08/blocking-render-why-whould-you-do-that/ (blog)
- https://www.smashingmagazine.com/2025/01/tight-mode-why-browsers-produce-different-performance-results/ (blog)
- https://jakearchibald.com/2016/link-in-body/ (blog)
- https://www.catchpoint.com/blog/new-render-blocking-indicator-in-chrome-and-webpagetest (blog)
- web-features data: https://cdn.jsdelivr.net/npm/web-features/data.json (fetched 2026-09-22)
- MDN browser-compat-data 8.1.2: https://cdn.jsdelivr.net/npm/@mdn/browser-compat-data/data.json (2026-09-17 build)
- Live trace: Chrome DevTools MCP `performance_start_trace` + `performance_analyze_insight` (RenderBlocking, LCPBreakdown) on https://web.dev/learn/performance/understanding-the-critical-path, 2026-09-22

## Not covered / could not access
- Chromium "Life of a Pixel" slide deck (Google Slides) returned HTTP 401; Chromium's "How cc works" and RenderingNG pages were used instead.
- The Chrome DevTools trace file could not be saved (`filePath` outside the MCP workspace roots), so raw trace event names were verified from DevTools frontend source, not from a saved trace.
- Current composited status of `background-color` and `clip-path` animations in Chrome was not confirmed in a primary source newer than the 2021 post (which lists them as planned).
- Chrome's exact Paint Holding timeout and the render-blocked UA timeout are implementation-defined and not documented in the sources read.
- The current Chrome behavior for body-level stylesheets rests on blog sources (2016, 2021) plus the spec, not on a Chrome doc.
- SciChart.js support for OffscreenCanvas/worker rendering was not checked (out of scope for this topic).
- V8 compile details (code caching, lazy parsing heuristics), image format choice, HTTP/3 and compression dictionaries, view-transition authoring, and service-worker navigation preload are only touched here; they belong to other topic files.
- WebMCP spec text (the W3C community group explainer) was not read directly; only Chrome's docs.
