# Critical rendering path (CRP): first HTML bytes to pixels, and the update frame after load

Scope: every step from the navigation request to pixels on the display (initial load), and every step of one rendering update after load (input, JS, rAF, style, layout, observers, paint, composite, present). For each step: what blocks it, what code controls it, the levers, and how to see it in the Chrome DevTools Performance panel.
Sources: web.dev Learn Performance (critical path, resource loading, resource hints, fonts), web.dev articles (preload scanner, rendering performance, layout thrashing, paint, compositor, style, content-visibility, fetch priority, LCP, INP, long tasks, script evaluation, client-side rendering, TTFB, bfcache), MDN performance guides, developer.chrome.com (RenderingNG architecture and data structures, "Inside look at modern web browser" parts 3-4, aligned input events, DevTools Performance reference and Performance insights, Lighthouse 13, Early Hints, LoAF, paint holding, DevTools MCP), Chromium "How cc works", DevTools frontend source (event labels), WHATWG HTML (render-blocking, script-blocking style sheets, "update the rendering"), W3C IntersectionObserver and CSSWG ResizeObserver specs, Khronos WebGL 1.0 spec, RFC 9002/8446. Browser status comes from web-features 3.39.0 (webstatus.dev) and MDN browser-compat-data 8.1.2 (2026-09-17).

---

## Phase map

The phase map is the backbone of the skill classification. Each item later in the file names its Stage with the same words.

### Threads and processes (Chromium RenderingNG; other engines differ in detail)

| Thread / process | What it does in the pipeline | Source |
|---|---|---|
| Renderer main thread (one per render process) | Runs scripts, event dispatch and hit testing, HTML and CSS parsing, the document lifecycle: style, layout, pre-paint, paint (display lists), layerize, commit. Also rAF, ResizeObserver and intersection computation. | RenderingNG architecture |
| Main-thread helpers | Image bitmap and blob encode/decode for Canvas APIs. | RenderingNG architecture |
| Web workers | Run script, and a rendering event loop (rAF) for OffscreenCanvas. | RenderingNG architecture; HTML spec worker event loop |
| Compositor thread (one per render process) | Receives input first, scrolls and runs compositor animations (transform, opacity, filter) by mutating property trees, decides layerization, coordinates decode and raster, activates the pending tree, builds compositor frames. Keeps scrolling alive when the main thread is busy. | RenderingNG; How cc works |
| Compositor worker (raster) threads | Image decode, paint worklets, raster tasks (or fallback CPU raster). GPU raster is limited to one worker at a time; decodes run in parallel. | RenderingNG; How cc works |
| Viz (GPU) process: GPU main thread | Rasters display lists into GPU texture tiles and draws compositor frames. | RenderingNG architecture |
| Viz: display compositor thread | Aggregates compositor frames from all render processes and the browser UI into one frame for the screen. | RenderingNG architecture |
| Browser process | Receives raw input, routes it to the right renderer; network requests (preload scanner requests go to the network service). | Inside look part 3-4 |
| Media threads | Decode video/audio in parallel with the main pipeline. | RenderingNG architecture |

Canonical Chromium stage list (RenderingNG): Animate, Style, Layout, Pre-paint, Scroll, Paint, Commit, Layerize, Raster/decode/paint worklets, Activate, Aggregate, Draw. Note: RenderingNG lists Commit before Layerize, but the current DevTools labels say "Layerize" is followed by "Commit" on the main thread. Treat both as the main-to-compositor hand-off. Commit blocks the main thread while data is copied (How cc works).

### (a) Initial load: navigation to first pixels

| # | Phase (Stage tag) | Thread | What blocks it | Code that controls it | Levers (items below) | See it in DevTools Performance panel |
|---|---|---|---|---|---|---|
| 1 | Navigation, TTFB (`network`) | Browser network service, server | Redirects, DNS, TCP + TLS (TLS 1.3 = 1 RTT), server think time, uncompressed HTML, cache misses | Server, CDN, service worker, links that redirect | Stream and flush head; 103 Early Hints; no redirects; compression; preconnect; bfcache; prerender | Network track: document row, Summary timing breakdown and Server-Timing; Insights "Document request latency" (redirects, server > 600 ms, no compression); "LCP breakdown" TTFB subpart |
| 2 | HTML parse (`html-parse`) | Main thread, in chunks as bytes arrive ("Parse HTML" tasks) | Parser-blocking classic scripts (fetch + run); those scripts also wait for pending "script-blocking" stylesheets; late `<meta charset>` forces a re-parse; `document.write` | Order and attributes of tags in HTML; server streaming | charset in first 1024 bytes; defer/module scripts; inline scripts above stylesheets; SSR/streaming; small DOM | Main track "Parse HTML" (hover shows line range); long idle gaps between parse chunks = blocked parser; Insight "Declare a character encoding" |
| 3 | Preload scanner (`preload-scan`) | Secondary tokenizer, requests go to network | Only sees raw markup. Misses JS-injected tags, `data-src`, CSS `background-image`, CSS `@import`, font URLs in CSS, client-rendered markup, `import()`; delayed by large inline blobs | Markup shape; `rel=preload`, `modulepreload` | Keep critical resources as markup; preload late-discovered ones; no lazy LCP; no big inline base64 | Network track (initiator arrows, start times, Priority); Insights "LCP request discovery", "Network dependency tree" |
| 4 | CSSOM (`cssom`) | Main thread ("Parse stylesheet") | Render-blocking: `<link rel=stylesheet>`/`<style>` in `<head>` whose `media` matches, created by the parser while `<body>` is not yet created. CSSOM is not incremental; later rules can override earlier ones. Stylesheets are also script-blocking. First paint also waits until `<body>` exists (or an implementation timeout). | CSS size, count, `media`, `@import`, location (head vs body), `blocking=render` | Inline small critical CSS; media split; no `@import`; remove unused CSS; body-level non-critical CSS | Network track red triangle = render-blocking; Insight "Render-blocking requests"; Coverage panel for unused CSS |
| 5 | Script fetch/compile/run (`script-compile`, `script-run`) | Network; streaming compile on thread pool; evaluation on main thread | Classic sync script: parser-blocking. `async`: runs as soon as fetched (any order). `defer`: after parsing, in order, before DOMContentLoaded (Chromium runs all deferred scripts in the same task as DOMContentLoaded). `type=module`: deferred by default, `async` allowed; inline modules also deferred. `blocking=render` makes a head script render-blocking. | `<script>` attributes, bundle split, `fetchpriority` | defer/module; no injected startup scripts; ~100 KB chunks; `import()`; `modulepreload` | Main track "Evaluate script", "Compile script", "Compile code", "Compile module", "Evaluate module", "Streaming compile task"; long tasks have a red triangle; Insights "Legacy JavaScript", "Duplicated JavaScript" |
| 6 | Style (`style`) | Main thread | Render-blocked document; cost = elements x selectors, width of invalidation | Selectors, DOM size, class changes | Simple selectors; narrow invalidation; containment | "Recalculate style" (Elements affected, Styles invalidated stack); "Enable CSS selector stats" setting; Insight "CSS selector costs" |
| 7 | Layout (`layout`) | Main thread, builds the immutable fragment tree | Style; forced synchronous layout from script reads; large DOM | DOM size, CSS layout modes, sizes of replaced elements | Small DOM; reserve space; `content-visibility`; `contain`; no read-after-write | "Layout" (Nodes that need layout, Layout tree size, Layout scope Partial/Whole document); "Invalidate layout"; Insights "Forced reflow", "Optimize DOM size", "Layout shift culprits"; Layout shifts track |
| 8 | Pre-paint + Paint (`paint`) | Main thread: property trees (transform/clip/effect/scroll), then display lists grouped in paint chunks | Layout | Paint-heavy CSS (blur, shadows), paint area | Cheap paint; small paint area | "Pre-paint", "Paint", "Paint setup", "Paint image"; Rendering drawer "Paint flashing" |
| 9 | Layerize + Commit (`composite`) | Main thread to compositor thread | Paint; main thread blocked during commit | `will-change`, compositor animations, canvas/video (own layers) | Promote only what moves; avoid layer explosion | "Layerize", "Commit"; "Enable advanced paint instrumentation" then the Layers tab; Rendering drawer "Layer borders" |
| 10 | Raster + image decode (`raster`, `gpu-upload`) | Compositor worker threads and Viz GPU main thread (GPU raster) | Commit; image decode is the most expensive part of raster | Image size/format; number and size of layers | `img.decode()`; right-sized images; fewer layers | Thread pool track: "Rasterize paint", "Image decode"; GPU track |
| 11 | Activate, composite, aggregate, draw (`composite`, `gpu-draw`) | Compositor thread, Viz display compositor, GPU | All tiles needed to draw must be rastered before activation | Few render passes (filters, blend modes add intermediate passes) | Compositor-only animation; fewer effects | GPU track; Frames track; Timings track (FP, FCP, LCP, DCL, L markers) |
| 12 | Display (`gpu-draw`) | Display hardware, vsync | Rendering opportunity (refresh rate, throttling) | none directly | Chrome paint holding keeps the old page visible on same-origin navigations until a load signal such as FCP | Screenshots filmstrip; Frames track |

Critical resources for the first render: part of the HTML, render-blocking CSS in `<head>`, parser-blocking JS in `<head>`. Not waited for: the rest of the HTML, fonts, images, non-blocking scripts, CSS with non-matching `media`, CSS in `<body>` (web.dev critical path).

### (b) The update frame after load (one rendering opportunity)

Rendering opportunities follow display refresh (for example about 16.7 ms at 60 Hz). A browser may drop a page to 30 per second if it cannot keep up, and to very few or none when the page is hidden (HTML spec). The work budget is about 10 ms of a 16.7 ms frame (web.dev rendering performance).

| Step (spec order) | Stage tag | Thread | What blocks or triggers it | Code that controls it | Levers | DevTools |
|---|---|---|---|---|---|---|
| 0. Input arrives | `main-thread-task` | Browser process, then compositor thread | If the target region has non-passive touch/wheel listeners, the compositor must wait for the main thread ("non-fast scrollable region") | Listener options, `touch-action` | Passive listeners; scope non-passive listeners | Rendering drawer "Scrolling performance issues" |
| 0b. Compositor-only work | `composite` | Compositor thread | Nothing on main thread: scroll, transform/opacity/filter animations | CSS/WAAPI animations of compositor properties | Animate compositor properties | Animations track (red triangle = not composited, with reasons) |
| 1. Event tasks | `main-thread-task`, `script-run`, `microtask` | Main thread | Discrete events (keydown, pointerdown, click) are dispatched at once; continuous events (pointermove, mousemove, touchmove, wheel) are coalesced and dispatched just before rAF in Chrome | Handlers, microtasks after each task | Paint-first handlers; yield; no forced layout | Interactions track (input delay, processing, presentation delay whiskers); "Event: click"; "Hit test"; "Run microtasks" |
| 2. Filter and skip | `idle` | Main thread | Frame skipped if the document is render-blocked or hidden, or if there is no visible change AND no rAF callback | rAF loops | Stop idle rAF loops | Frames track "Idle frame" |
| 3. Resize steps, scroll steps, media queries | `script-run` | Main thread | `resize`/`scroll` events fire here (rAF-aligned) | Listeners | Keep handlers cheap | Main track event entries |
| 4. Update animations and send events | `style` | Main thread | CSS transitions/animations, WAAPI | CSS, WAAPI | Prefer compositor properties | Animations track |
| 5. Animation frame callbacks (rAF) | `script-run` | Main thread | All callbacks registered before this frame | `requestAnimationFrame` | One rAF writer per frame; use timestamp | "Animation frame fired" (initiator arrow from "Request animation frame") |
| 6. Style + layout loop | `style`, `layout` | Main thread | Dirty styles/layout; `content-visibility:auto` proximity checks | CSS, DOM writes | Narrow invalidation; containment | "Recalculate style", "Layout" |
| 7. ResizeObserver delivery (inside the loop) | `script-run`, `layout` | Main thread | After layout, before paint; each round only observes deeper targets; if skipped, "ResizeObserver loop completed with undelivered notifications" is reported | RO callbacks | Do not change the observed size in the callback | Function calls after "Layout" in the same frame |
| 8. Focus fixup, view transitions | `style` | Main thread | | | | |
| 9. Update intersection observations | `layout` | Main thread | Intersections are computed here; callbacks are delivered in a separate queued task (after this frame) | IO targets | Use IO for visibility gating, not for same-frame layout | "Compute intersections" |
| 10. Paint timing marks, then "update the rendering" | `paint` | Main thread | Pre-paint, Paint, Layerize, Commit | CSS paint cost | Cheap paint | "Pre-paint", "Paint", "Layerize", "Commit" |
| 11. Raster, activate, draw, present | `raster`, `gpu-draw` | Compositor, raster threads, Viz/GPU | Slow raster makes cc enter "high latency mode" (draw without waiting for a commit) | Layer count, image sizes | Fewer/lighter layers | Thread pool, GPU, Frames tracks (green = on time, yellow = partially presented, red = dropped) |

WebGL/canvas note: WebGL presents its drawing buffer to the page compositor right before a compositing operation, only if something was drawn, the context was created, or the canvas was resized since the last composite (Khronos WebGL spec). A canvas is its own composited layer (MDN "How browsers work").

Field view of the same frame: Long Animation Frames (Chrome only) split a frame into work, `renderStart` (rAF, style/layout, observers), `styleAndLayoutStart`, and per-script `forcedStyleAndLayoutDuration`.

---

## Items: Navigation and TTFB

### Stream the HTML and flush the head early
- Layer: network
- Stage: network, html-parse, preload-scan
- Metrics: TTFB, FCP, LCP
- When: load
- Impact: high; the parser and preload scanner start only when bytes arrive, and streamed HTML is parsed in chunks with free yielding.
- Do: Send the document as a stream. Flush the `<head>` (charset, viewport, preconnects, critical CSS, scripts) before slow data work. Prefer static generation when content allows.
- Why: Browsers parse HTML incrementally as chunks arrive and yield between chunks, so the preload scanner can request CSS/JS/images while the server still renders the body.
- Example:
  ```js
  // Node/edge handler: head first, body when data is ready
  res.write(renderHead());            // charset, viewport, <link rel=stylesheet>, deferred scripts
  const rows = await loadTableRows(); // slow backend work happens after the flush
  res.end(renderBody(rows));
  ```
- Avoid/caveats: Status codes and headers are fixed once you flush; plan error handling (render an error block, not a 500). Buffering proxies or compression settings can undo streaming.
- Status: HTTP streaming works in all browsers (no feature flag).
- Sources: https://web.dev/articles/optimize-ttfb ; https://web.dev/articles/client-side-rendering-of-html-and-interactivity

### Remove navigation redirects and compress the document
- Layer: network
- Stage: network
- Metrics: TTFB, FCP, LCP
- When: load
- Impact: high; every redirect adds a full request round trip before the first HTML byte.
- Do: Link to final URLs. Serve HTML with gzip, br or zstd. Aim for server response under 600 ms and TTFB at or under 0.8 s at p75.
- Why: DevTools "Document request latency" fails on any redirect, server response over 600 ms, or an uncompressed document. TTFB "good" is 0.8 s or less.
- Avoid/caveats: TTFB includes DNS and redirects, so the 600 ms server budget is tighter than the 800 ms TTFB target.
- Status: Not a feature; insight available in Chrome DevTools and Lighthouse 13.
- Sources: https://developer.chrome.com/docs/performance/insights/document-latency ; https://web.dev/articles/optimize-ttfb

### Send 103 Early Hints when the server has think time
- Layer: network
- Stage: network, preload-scan
- Metrics: TTFB (apparent), FCP, LCP
- When: load
- Impact: medium; the browser preconnects/preloads during server think time, before any HTML exists.
- Do: When HTML generation is slow, answer with `103` plus `Link: rel=preconnect` for critical origins and `rel=preload` for stable, render-blocking assets; then send the 200.
- Why: The connection is otherwise idle while the server works.
- Example:
  ```http
  HTTP/1.1 103 Early Hints
  Link: </css/app.4f2a.css>; rel=preload; as=style
  Link: <https://cdn.example.net>; rel=preconnect
  ```
- Avoid/caveats: No gain for static/fast responses. Do not hint versioned files that change often. Hints can mask a slow real TTFB; measure server time with Server-Timing. Disable-cache in DevTools breaks it (hints use the HTTP cache).
- Status: `103` supported Chrome 103, Firefox 120, Safari 17 (HTTP/2+ only in Chrome and Safari). `preload` in 103: Chrome 103, Firefox 123, not Safari. `preconnect`: all three (BCD 8.1.2).
- Sources: https://developer.chrome.com/docs/web-platform/early-hints ; https://web.dev/articles/optimize-ttfb

### Preconnect only to the one or two cross-origin hosts on the critical path
- Layer: html, network
- Stage: network
- Metrics: LCP, FCP
- When: load
- Impact: medium; removes DNS+TCP+TLS from the first critical request to that origin.
- Do: Add `<link rel="preconnect">` early in `<head>` for the critical third-party origin (font files, image CDN). Add `crossorigin` when the resource uses CORS (fonts). Use `dns-prefetch` for less certain origins.
- Why: Without `crossorigin` on a CORS resource, the browser opens a second connection and does not reuse the preconnected one.
- Example:
  ```html
  <link rel="preconnect" href="https://fonts.example-cdn.com" crossorigin>
  <link rel="dns-prefetch" href="https://analytics.example.com">
  ```
- Avoid/caveats: Unused preconnects waste sockets and CPU; keep the list short. Serving critical assets from the page origin is better than any preconnect.
- Status: `preconnect` Baseline widely available (2020). `dns-prefetch` Baseline newly available 2025-09-15 (Firefox 127, Safari iOS 26).
- Sources: https://web.dev/learn/performance/resource-hints ; https://webstatus.dev/features/link-rel-preconnect

### Keep pages eligible for the back/forward cache
- Layer: js
- Stage: network, html-parse, style, layout, paint
- Metrics: LCP, FCP, TTFB (back/forward navigations)
- When: load
- Impact: high for history navigations; a bfcache restore skips the whole CRP.
- Do: Never add `unload` listeners; use `pagehide`. Handle `pageshow` with `event.persisted` to refresh stale data.
- Why: On desktop, Chrome and Firefox make pages with `unload` listeners ineligible for bfcache.
- Example:
  ```js
  addEventListener('pagehide', flushPendingState);
  addEventListener('pageshow', (e) => { if (e.persisted) refreshQuotes(); });
  ```
- Avoid/caveats: Open connections and some headers can still block bfcache; check DevTools Application > Back/forward cache.
- Status: bfcache in all major engines; `pagehide`/`pageshow` Baseline widely available.
- Sources: https://web.dev/articles/bfcache

### Prerender or prefetch likely next pages with speculation rules
- Layer: html
- Stage: network, html-parse, style, layout, paint
- Metrics: LCP, FCP
- When: load (next navigation)
- Impact: high where supported; a prerendered page runs its CRP before the click.
- Do: Add a `<script type="speculationrules">` for the one or two most likely next URLs; prefer `prefetch` or moderate eagerness for less certain targets.
- Why: Activation of a prerendered page shows an already rendered document.
- Example:
  ```html
  <script type="speculationrules">
  {"prerender":[{"where":{"href_matches":"/instrument/*"},"eagerness":"moderate"}]}
  </script>
  ```
- Avoid/caveats: Costs bandwidth, CPU and memory; analytics must handle prerender activation. Progressive enhancement only.
- Status: Limited availability: Chromium 109+ only (webstatus.dev, 2026-09).
- Sources: https://developer.chrome.com/docs/web-platform/prerender-pages ; https://webstatus.dev/features/speculation-rules

---

## Items: HTML parse and the head

### Declare the charset in the first 1024 bytes
- Layer: html
- Stage: html-parse
- Metrics: FCP, LCP
- When: load
- Impact: medium; a late declaration can force the browser to restart parsing.
- Do: Make `<meta charset="utf-8">` the first element in `<head>`, or send `Content-Type: text/html; charset=utf-8`.
- Why: The browser guesses an encoding; if a later `<meta charset>` shows the guess was wrong, it must parse the HTML again from the start.
- Avoid/caveats: The element must be fully inside the first 1024 bytes; long comments or inline scripts before it break this.
- Status: DevTools insight "Declare a character encoding"; behavior in all browsers.
- Sources: https://developer.chrome.com/docs/performance/insights/charset

### Ship a mobile viewport meta tag in the initial HTML
- Layer: html
- Stage: layout, main-thread-task
- Metrics: INP, FCP
- When: load
- Impact: medium; without it, mobile layout uses a default wide viewport (MDN: "generally 960px") and taps can wait up to 300 ms.
- Do: Put `<meta name="viewport" content="width=device-width, initial-scale=1">` in the server HTML, not injected by JS.
- Why: Layout depends on the layout viewport width; the insight requires `width` set and `initial-scale >= 1` at initial render.
- Status: DevTools insight "Optimize viewport for mobile".
- Sources: https://developer.chrome.com/docs/performance/insights/viewport ; https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path

### Put small inline head scripts above external stylesheets
- Layer: html
- Stage: html-parse, cssom, script-run
- Metrics: FCP, LCP
- When: load
- Impact: medium; a sync or inline script placed after a pending stylesheet stops the parser until that CSS arrives.
- Do: Place inline scripts that do not read styles (feature flags, theme class, config) before `<link rel="stylesheet">`. Keep scripts that must read computed styles after the CSS.
- Why: Per the HTML spec, a parser-created stylesheet in the head is a "script-blocking style sheet"; a parser-blocking script cannot run while one is pending, so parsing stops too. This also applies to inline scripts.
- Example:
  ```html
  <!-- Before: parser waits for app.css before it can run the inline script -->
  <link rel="stylesheet" href="/app.css">
  <script>document.documentElement.dataset.theme = localStorage.theme || 'dark'</script>
  <!-- After -->
  <script>document.documentElement.dataset.theme = localStorage.theme || 'dark'</script>
  <link rel="stylesheet" href="/app.css">
  ```
- Avoid/caveats: The preload scanner still fetches ahead, but DOM building stops. Firefox speculatively builds DOM past the blocked script (per a 2020 blog; not confirmed in a primary source).
- Status: Spec behavior, all engines.
- Sources: https://html.spec.whatwg.org/multipage/semantics.html#interactions-of-styling-and-scripting ; https://web.dev/learn/performance/optimize-resource-loading ; https://timkadlec.com/remembers/2020-02-13-when-css-blocks/ (blog)

### Keep the head lean: only what the first paint needs
- Layer: html
- Stage: html-parse, cssom, preload-scan
- Metrics: FCP, LCP
- When: load
- Impact: high; the document cannot render before `<body>` is created, so every byte and blocker in `<head>` gates first paint.
- Do: Order the head as: charset, viewport, title, preconnects, critical CSS (inline or one link), preloads for late-discovered LCP resources, deferred/module scripts. Move analytics and widgets to `defer`/`async` or after load.
- Why: Per the HTML spec, a document "allows adding render-blocking elements" while its body element is null, and it stays render-blocked until the render-blocking set is empty (or an implementation timeout).
- Example:
  ```html
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Markets</title>
    <link rel="preconnect" href="https://img.example-cdn.com">
    <style>/* critical above-the-fold rules only */</style>
    <link rel="stylesheet" href="/app.9c1e.css">
    <script type="module" src="/main.3b7d.js"></script>
  </head>
  ```
- Avoid/caveats: Inlining too much delays discovery of later resources (see "Do not inline large blobs").
- Status: Spec behavior.
- Sources: https://html.spec.whatwg.org/multipage/dom.html#render-blocking-mechanism ; https://web.dev/learn/performance/understanding-the-critical-path

### Never use document.write
- Layer: js
- Stage: html-parse, script-run
- Metrics: FCP, LCP
- When: load
- Impact: medium; injected scripts via `document.write` block the parser and hide resources from the preload scanner.
- Do: Insert DOM with DOM APIs or server markup; load third-party tags with `async`.
- Why: The parser must pause for script that can rewrite the document stream.
- Avoid/caveats: Lighthouse 13 removed the `no-document-write` audit ("rarely an issue in first-party scripts"), so tools will not flag it anymore; the rule still holds.
- Status: Strongly discouraged (web.dev); still supported.
- Sources: https://web.dev/articles/client-side-rendering-of-html-and-interactivity ; https://developer.chrome.com/blog/lighthouse-13-0 ; https://developer.chrome.com/blog/inside-browser-part3

### Server-render the first view instead of building it in client JS
- Layer: html, build
- Stage: html-parse, preload-scan, script-run, main-thread-task
- Metrics: LCP, FCP, INP, TBT
- When: load
- Impact: high; client-built markup hides resources from the preload scanner and builds DOM in one long task.
- Do: Send above-the-fold HTML from the server or from a static build; hydrate or attach behavior after. For SPAs, stream SSR output.
- Why: Server HTML is parsed in chunks with yielding; client rendering is one monolithic task and its `<img>` URLs are found only after the JS downloads, compiles and runs.
- Avoid/caveats: SSR adds server time (TTFB); stream it. Hydration cost still counts for INP.
- Status: Architecture choice.
- Sources: https://web.dev/articles/preload-scanner ; https://web.dev/articles/client-side-rendering-of-html-and-interactivity ; https://web.dev/articles/optimize-lcp

---

## Items: Preload scanner and fetch priority

### Keep critical resources as plain tags in the HTML markup
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP, FCP
- When: load
- Impact: high; the preload scanner fetches only what it sees in raw markup while the parser is blocked.
- Do: Reference critical CSS, JS and the LCP image with `<link>`, `<script src>`, `<img src/srcset>` in the server HTML.
- Why: The scanner misses script-injected elements, `data-src` lazy loaders, CSS `background-image`, CSS `@import`, fonts referenced from CSS, client-rendered markup and `import()`.
- Example:
  ```js
  // Before: injected script is invisible to the scanner and starts after CSS arrives
  const s = document.createElement('script'); s.src = '/chart.js'; document.head.append(s);
  ```
  ```html
  <!-- After: discoverable, still non-blocking -->
  <script src="/chart.js" defer></script>
  ```
- Avoid/caveats: Do not "fix" discoverability with `rel=preload` when a plain tag works; preload raises priority and can steal bandwidth from CSS.
- Status: All browsers have a preload scanner (behavior, not API).
- Sources: https://web.dev/articles/preload-scanner ; https://web.dev/learn/performance/optimize-resource-loading

### Use an img element for the LCP image, not a CSS background or data-src
- Layer: html, css
- Stage: preload-scan, network
- Metrics: LCP
- When: load
- Impact: high; a CSS background image is requested only after the CSS is downloaded and matched.
- Do: Render the hero/LCP image as `<img src srcset sizes>`. If it must stay in CSS, preload it with `fetchpriority="high"` and `imagesrcset` for responsive variants.
- Why: The scanner reads HTML only; CSS resources are requested when the CSSOM finds them.
- Example:
  ```html
  <link rel="preload" as="image" fetchpriority="high"
        imagesrcset="/hero-800.avif 800w, /hero-1600.avif 1600w" imagesizes="100vw">
  ```
- Avoid/caveats: Omit `href` on responsive preloads so old browsers do not fetch a fallback; place preloads after stylesheet links so they do not delay CSS.
- Status: Responsive image preload Baseline widely available (2023-12, Safari 17.2).
- Sources: https://web.dev/articles/preload-scanner ; https://web.dev/learn/performance/resource-hints ; https://webstatus.dev/features/preloading-responsive-images

### Give the LCP image fetchpriority=high and never lazy-load it
- Layer: html
- Stage: network, preload-scan
- Metrics: LCP
- When: load
- Impact: high; images start at Low priority and are boosted only after layout finds them in the viewport.
- Do: Put `fetchpriority="high"` on the one likely LCP image (and on its preload, if any). Never set `loading="lazy"` on it. Put `fetchpriority="low"` on in-viewport but unimportant images (carousel slides 2+).
- Why: In Chrome, in-viewport images are raised to High only at layout; since Chrome 117 the first 5 images larger than 10,000 px² start at Medium. A lazy image waits for layout to confirm it is in the viewport.
- Example:
  ```html
  <img src="/hero.avif" width="1200" height="600" fetchpriority="high" alt="">
  <img src="/slide-2.avif" width="1200" height="600" fetchpriority="low" alt="">
  ```
- Avoid/caveats: More than one or two `high` images removes the benefit. `fetchpriority` is a hint.
- Status: Baseline newly available 2024-10-29 (Chrome 102, Firefox 132, Safari 17.2); widely available about 2027-04.
- Sources: https://web.dev/articles/fetch-priority ; https://developer.chrome.com/docs/performance/insights/lcp-discovery ; https://webstatus.dev/features/fetch-priority

### Lazy-load only below-the-fold images and iframes, natively
- Layer: html
- Stage: network
- Metrics: LCP, bundle-size
- When: load
- Impact: medium; saves bandwidth for critical resources without hiding in-viewport content.
- Do: Use `loading="lazy"` on offscreen `<img>`/`<iframe>`; keep `src` real so the browser, not JS, decides.
- Why: JS lazy loaders (`data-src`) defeat the preload scanner and wait for script execution.
- Avoid/caveats: Lighthouse 13 removed the offscreen-images audit because browsers already deprioritize offscreen images; the gain is bandwidth, not lab LCP.
- Status: Images and iframes lazy-loading Baseline widely available (img since 2022-03, iframe since 2023-12; BCD/web-features).
- Sources: https://web.dev/articles/preload-scanner ; https://developer.chrome.com/blog/lighthouse-13-0 ; https://webstatus.dev/features/loading-lazy

### Preload only late-discovered critical resources, with as and crossorigin
- Layer: html, network
- Stage: preload-scan, network
- Metrics: LCP, FCP
- When: load
- Impact: medium; removes discovery delay for fonts, CSS background LCP images, `@import`ed CSS or JS-loaded LCP resources.
- Do: Preload only resources the scanner cannot see and that the first view needs. Always set `as`. Add `crossorigin` for fonts (even same-origin). Add `fetchpriority="high"` for image preloads.
- Why: A preload without `as`, or with a CORS mismatch, downloads the resource twice. Preload raises priority and can cause bandwidth contention.
- Example:
  ```html
  <link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
  ```
- Avoid/caveats: "When you prioritize everything, nothing will be" (web.dev preload scanner). Lighthouse 13 removed `uses-rel-preload` and `preload-fonts` audits due to over-recommendation risk. Do not preload async scripts just to raise priority; use `fetchpriority`.
- Status: `<link rel=preload>` Baseline widely available (2021-01).
- Sources: https://web.dev/learn/performance/resource-hints ; https://web.dev/articles/preload-scanner ; https://developer.chrome.com/blog/lighthouse-13-0

### Flatten ES module waterfalls with modulepreload or bundling
- Layer: build, html
- Stage: network, script-compile
- Metrics: FCP, LCP, INP
- When: load, build
- Impact: medium; each static import level adds a request round trip.
- Do: Bundle production code into a few chunks. If you ship unbundled modules, add `<link rel="modulepreload">` for the deep dependencies of the entry module.
- Why: A nested import chain (a imports b imports c) is discovered one level per round trip.
- Example:
  ```html
  <script type="module" src="/app/main.js"></script>
  <link rel="modulepreload" href="/app/chart-core.js">
  <link rel="modulepreload" href="/app/data-feed.js">
  ```
- Status: `modulepreload` Baseline widely available (since 2026-03-18).
- Sources: https://web.dev/articles/script-evaluation-and-long-tasks ; https://webstatus.dev/features/modulepreload

### Do not inline large blobs into the HTML
- Layer: html, build
- Stage: preload-scan, network, html-parse
- Metrics: FCP, LCP
- When: load, build
- Impact: medium; bytes before a tag delay its discovery, and inlined assets are not cached across pages.
- Do: Inline only small critical CSS/JS. Keep fonts and images as separate cacheable files.
- Why: In the web.dev test, inlining CSS plus four base64 fonts moved FCP from about 2.7 s to 5.8 s and LCP from about 3.5 s to over 7 s. Base64 is inefficient for binaries, and inlined fonts download even when unused.
- Avoid/caveats: Dynamic HTML is often uncacheable, so inlined bytes are paid on every visit.
- Status: Guidance.
- Sources: https://web.dev/articles/preload-scanner

### Know Chrome's tight mode when you order head resources
- Layer: html, network
- Stage: network
- Metrics: LCP, FCP
- When: load
- Impact: medium; during the layout-blocking phase Chrome loads high-priority resources and only a trickle of others.
- Do: Keep CSS and critical scripts early and few; mark the LCP image `fetchpriority="high"` so it is not held back; place same-priority resources in the order you want them fetched.
- Why: Early CSS is Highest; early scripts High; async/defer scripts Low; images Low until layout. Late CSS and late scripts load one at a time during the layout-blocking phase. Same-priority resources download in discovery order.
- Status: Chrome-specific heuristics (subject to change).
- Sources: https://web.dev/articles/fetch-priority

---

## Items: CSSOM (render-blocking CSS)

### Shrink render-blocking CSS: remove unused rules, minify, compress
- Layer: css, build
- Stage: cssom, style
- Metrics: FCP, LCP
- When: load, build
- Impact: high; the browser downloads and parses all render-blocking CSS, used or not, before the first paint.
- Do: Split CSS per route/page; delete dead rules found with the Coverage panel; minify in the build.
- Why: CSSOM is not built incrementally; later rules can override earlier ones, so the render tree waits for the whole sheet.
- Avoid/caveats: Aggressive rule-merging minifiers can break cascade order; basic minification is safe. Selector micro-tuning is rarely the bottleneck (MDN).
- Status: Guidance.
- Sources: https://web.dev/learn/performance/optimize-resource-loading ; https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path

### Replace CSS @import with link elements
- Layer: css
- Stage: preload-scan, cssom, network
- Metrics: FCP, LCP
- When: load
- Impact: high; each `@import` is a serial, late-discovered, render-blocking request.
- Do: Use one `<link rel="stylesheet">` per sheet, or let the build inline imports. If `@import` is required (layers, third-party), preload the imported file.
- Why: The imported URL is known only after the parent CSS downloads and parses.
- Example:
  ```css
  /* Before, in app.css */
  @import url('/grid.css');
  ```
  ```html
  <!-- After -->
  <link rel="stylesheet" href="/grid.css">
  <link rel="stylesheet" href="/app.css">
  ```
- Status: Guidance.
- Sources: https://web.dev/learn/performance/optimize-resource-loading ; https://developer.chrome.com/docs/performance/insights/network-dependency-tree

### Inline small critical CSS and load the rest without blocking render
- Layer: css, html, build
- Stage: cssom, network
- Metrics: FCP, LCP
- When: load
- Impact: high on first visits; removes a network round trip from the first paint.
- Do: Inline only the rules for the initial viewport in `<style>`; load the full sheet non-blocking (link at end of body, or `media` swap).
- Why: Inline CSS needs no request; the Render-blocking requests insight passes when nothing blocks first paint.
- Example:
  ```html
  <style>/* shell, header, chart frame sizes */</style>
  <link rel="stylesheet" href="/rest.css" media="print" onload="this.media='all'">
  ```
- Avoid/caveats: Hard to maintain; inlined CSS is not cached; a user who scrolls early sees unstyled content. DevTools docs call it "an advanced performance technique" that "can also lead to bugs". Do not use the old `rel=preload` + `onload` swap for non-critical CSS: preload gives it top priority (priority inversion).
- Status: Guidance; `media` attribute universal.
- Sources: https://web.dev/learn/performance/optimize-resource-loading ; https://developer.chrome.com/docs/performance/insights/render-blocking ; https://timkadlec.com/remembers/2020-02-13-when-css-blocks/ (blog)

### Split CSS by media query and give each link a matching media attribute
- Layer: css, html
- Stage: cssom, network
- Metrics: FCP
- When: load
- Impact: medium; only sheets whose `media` matches block rendering.
- Do: Put print, wide-screen-only, or orientation-specific rules in separate files with `media` on the `<link>`.
- Why: Non-matching media sheets are not render-blocking and load at the lowest priority.
- Example:
  ```html
  <link rel="stylesheet" href="/print.css" media="print">
  <link rel="stylesheet" href="/desktop.css" media="(min-width: 1024px)">
  ```
- Avoid/caveats: `media="all"` still blocks. Chrome's preload scanner does not fetch non-matching sheets; they are fetched only when the main parser reaches them, at the lowest priority.
- Status: Universal.
- Sources: https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources ; https://web.dev/articles/fetch-priority

### Use body-level stylesheets only for progressive sections
- Layer: css, html
- Stage: cssom, html-parse
- Metrics: FCP, LCP
- When: load
- Impact: medium; a stylesheet in `<body>` does not block the first paint of content above it.
- Do: Place a section's non-critical CSS just before that section.
- Why: Chrome and Firefox block rendering only of content after the stylesheet (web.dev). In Chrome, stylesheets activated after body start "no longer block paint"; the parser still waits for them before running later scripts.
- Avoid/caveats: Content below the link waits for it, so a slow sheet can hide content mid-page. Per spec, only head elements can be render-blocking.
- Status: Chrome, Firefox (web.dev); Safari behavior not verified.
- Sources: https://web.dev/learn/performance/understanding-the-critical-path ; https://groups.google.com/a/chromium.org/g/blink-dev/c/QC5iefctcag/m/kkoBNliBAgAJ ; https://html.spec.whatwg.org/multipage/dom.html#render-blocking-mechanism

---

## Items: Scripts

### Default app scripts to defer or type=module; use async only for independent scripts
- Layer: html, js
- Stage: html-parse, script-compile, script-run
- Metrics: FCP, LCP, TBT, INP
- When: load
- Impact: high; a classic script without attributes blocks parsing for its fetch and execution.
- Do: Use `defer` (or `type="module"`) for app code that needs the DOM and ordered execution. Use `async` for self-contained scripts (analytics). Never put a sync `<script src>` in `<head>`.
- Why: `defer` runs after parsing, in document order, before DOMContentLoaded; `async` runs as soon as it arrives, in any order; modules are deferred by default and `defer` has no effect on them.
- Example:
  ```html
  <script src="/vendor.js" defer></script>
  <script src="/app.js" defer></script>            <!-- runs after vendor.js -->
  <script src="/rum.js" async></script>            <!-- independent -->
  <script type="module" src="/charts.mjs"></script> <!-- deferred by default -->
  ```
- Avoid/caveats: `async` on inline classic scripts has no effect. Chromium runs all deferred (and module) scripts in the same task as DOMContentLoaded, which can create one long task; keep them small.
- Status: `async`/`defer` Baseline widely available (2015 cutoff); JS modules widely available (2018).
- Sources: https://html.spec.whatwg.org/multipage/scripting.html ; https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script ; https://web.dev/articles/script-evaluation-and-long-tasks

### Raise a critical async script with fetchpriority, not with preload
- Layer: html
- Stage: network
- Metrics: LCP, INP
- When: load
- Impact: low to medium; async/defer scripts default to Low priority.
- Do: Add `fetchpriority="high"` to an async script that the first interaction needs; add `fetchpriority="low"` to late-body, non-critical scripts.
- Why: Preloading an async script promotes it to High and can contend with the Highest-priority CSS.
- Example:
  ```html
  <script src="/order-ticket.js" async fetchpriority="high"></script>
  ```
- Status: Baseline newly available 2024-10-29.
- Sources: https://web.dev/articles/fetch-priority ; https://web.dev/articles/preload-scanner

### Split script evaluation into smaller tasks and defer non-critical features
- Layer: build, js
- Stage: script-compile, script-run, main-thread-task
- Metrics: TBT, INP, bundle-size, startup
- When: load, build
- Impact: high; each classic `<script>` evaluates in one task, so a huge bundle is one long task.
- Do: Target about 100 KB per script chunk; load features behind `import()`; keep the first-view chunk small; run heavy non-UI code in workers.
- Why: Script evaluation (parse, compile, run) happens on the main thread; each `import()` gets its own compile/evaluate tasks.
- Example:
  ```js
  indicatorsButton.addEventListener('click', async () => {
    const { openIndicatorPicker } = await import('./indicator-picker.js');
    openIndicatorPicker();
  });
  ```
- Avoid/caveats: Smaller files compress worse; unbundled deep imports create waterfalls (use modulepreload). Safari and Firefox evaluate each module in its own task; Chromium compiles modules separately.
- Status: Dynamic import Baseline widely available.
- Sources: https://web.dev/articles/script-evaluation-and-long-tasks

### Use blocking=render only to hide a known flash of wrong content
- Layer: html
- Stage: cssom, script-run
- Metrics: FCP, CLS
- When: load
- Impact: low to medium; it delays first paint on purpose.
- Do: Mark a tiny head script or style that sets theme/layout state with `blocking="render"` when a wrong first frame would be worse than a later one. Prefer inlining the logic before stylesheets.
- Why: The element becomes render-blocking while the parser keeps parsing (unlike a parser-blocking script). Only head elements can block rendering; a script added from JS needs `blocking="render"` to block.
- Example:
  ```html
  <script src="/theme-boot.js" async blocking="render"></script>
  ```
- Avoid/caveats: Firefox ignores it, so still guard against the flash. Every render-blocking byte delays FCP.
- Status: Limited availability: Chrome 105, Safari 18.2; not Firefox (web-features `blocking-render`).
- Sources: https://html.spec.whatwg.org/multipage/urls-and-fetching.html#blocking-attributes ; https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script ; https://webstatus.dev/features/blocking-render

### Use rel=expect with blocking=render only to stabilize cross-document view transitions
- Layer: html
- Stage: html-parse, paint
- Metrics: FCP, LCP
- When: load
- Impact: low; blocks rendering until a named element is parsed.
- Do: Add `<link rel="expect" href="#chart-root" blocking="render">` only when a cross-document view transition needs that element in the first frame.
- Why: The first rendered frame then contains the element the transition animates.
- Avoid/caveats: Delays first paint; implementations add a timeout.
- Status: Limited: Chrome 124 only, experimental in BCD.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/link ; https://webstatus.dev/features/link-rel-expect

---

## Items: Fonts and media on the critical path

### Make critical fonts discoverable early and keep text visible
- Layer: css, html
- Stage: cssom, network, paint
- Metrics: FCP, LCP, CLS
- When: load
- Impact: medium; fonts are found only after CSSOM and DOM show text that needs them.
- Do: Inline the `@font-face` rules in the head or preload the one critical font file with `crossorigin`. Set `font-display: swap` (or `optional` for non-brand text) and tune fallback metrics.
- Why: `font-display: auto`/`block` gives a block period with invisible text; `swap` and `optional` use an "extremely small" block period.
- Example:
  ```css
  @font-face { font-family: Inter; src: url(/fonts/inter-var.woff2) format('woff2'); font-display: swap; }
  ```
- Avoid/caveats: `swap` can shift layout; use fallback metric overrides (`size-adjust`, Baseline widely available since 2026-03). Preloading fonts not used on the page wastes bandwidth.
- Status: `font-display` Baseline widely available (2020).
- Sources: https://web.dev/learn/performance/optimize-web-fonts ; https://developer.chrome.com/docs/performance/insights/font-display ; https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@font-face/font-display

### Reserve space for images, iframes, canvases and late UI
- Layer: html, css
- Stage: layout
- Metrics: CLS, LCP
- When: load
- Impact: high for CLS; an unsized element causes a reflow and repaint when its size becomes known.
- Do: Put `width`/`height` on `<img>`/`<video>`/`<iframe>`, or `aspect-ratio`; give chart containers a fixed or min height before JS runs.
- Why: Layout gives placeholder space to replaced elements of unknown size, then must reflow when the image arrives.
- Example:
  ```html
  <img src="/spark.png" width="320" height="80" alt="">
  <div class="chart-host" style="block-size: 420px; contain: strict"></div>
  ```
- Status: `aspect-ratio` Baseline widely available (2024-03).
- Sources: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work ; https://web.dev/learn/performance/understanding-the-critical-path

---

## Items: Style and layout

### Keep selectors simple and style changes narrow
- Layer: css, js
- Stage: style
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium; about half of Blink style time is selector matching, and the worst case scales with elements x selectors.
- Do: Prefer class selectors over deep, positional or `nth-*` chains in hot paths; toggle classes on the smallest subtree that changes; use Shadow DOM to scope styles for big component trees.
- Why: A class change invalidates the elements whose rules depend on it; wide invalidation means many "Elements affected".
- Example:
  ```css
  /* Before */ .grid .row:nth-last-child(-n+1) .cell-price { color: var(--up); }
  /* After  */ .cell-price--last-row { color: var(--up); }
  ```
- Avoid/caveats: Measure first; MDN notes selector gains are often microseconds. Use DevTools "Enable CSS selector stats" (adds overhead) or the "CSS selector costs" insight.
- Status: Guidance.
- Sources: https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations ; https://developer.chrome.com/docs/performance/insights/slow-css-selector

### Keep the DOM small and shallow; create hidden UI on demand
- Layer: html, js
- Stage: style, layout, gc-memory
- Metrics: INP, LCP, memory
- When: load, interaction, long-lived session
- Impact: high; style and layout cost grows with element count.
- Do: Flatten wrappers (fragments), virtualize long lists and order books, create menus/dialogs when opened.
- Why: DevTools "Optimize DOM size" fails when a layout over 100 objects or a style recalculation over 300 elements takes more than 40 ms. Lighthouse's older guidance flagged pages over 1,400 nodes and warned at 800.
- Avoid/caveats: A deep tree is not a problem by itself; it is a symptom of excess nesting.
- Status: Insight in Chrome DevTools and Lighthouse 13 (`dom-size-insight`).
- Sources: https://developer.chrome.com/docs/performance/insights/dom-size ; https://web.dev/articles/dom-size-and-interactivity

### Skip rendering of off-screen sections with content-visibility:auto
- Layer: css
- Stage: style, layout, paint
- Metrics: LCP, INP, FPS/smoothness
- When: load, interaction
- Impact: high on long pages; off-screen subtrees skip style, layout and paint.
- Do: Apply `content-visibility: auto` to large, independent sections below the fold, with `contain-intrinsic-size: auto <estimate>` to keep scroll height stable.
- Why: The element gets layout, style and paint containment, plus size containment while off-screen, so its descendants are not rendered. In the web.dev demo rendering went from 232 ms to 30 ms.
- Example:
  ```css
  .news-section { content-visibility: auto; contain-intrinsic-size: auto 600px; }
  ```
- Avoid/caveats: APIs that force layout on skipped subtrees (for example `offsetHeight` inside it) undo the win. Do not apply to the LCP area or small elements. Hidden landmarks may appear in the accessibility tree; add `aria-hidden` where needed.
- Status: `content-visibility` Baseline newly available 2025-09-15 (the `auto` value since Safari 26); `contain-intrinsic-size` widely available (2026-03).
- Sources: https://web.dev/articles/content-visibility ; https://webstatus.dev/features/content-visibility

### Keep inactive views with content-visibility:hidden instead of display:none
- Layer: css
- Stage: style, layout, paint
- Metrics: INP
- When: interaction, long-lived session
- Impact: medium; switching back to a cached view skips re-rendering from scratch.
- Do: For tabbed workspaces/SPA views you will show again, hide with `content-visibility: hidden`.
- Why: `display: none` destroys rendering state; `content-visibility: hidden` keeps it and skips work while hidden.
- Avoid/caveats: Hidden subtree still uses memory; do not use for content that will never return.
- Status: Baseline newly available 2024-09 for the `hidden` value (Safari 18).
- Sources: https://web.dev/articles/content-visibility

### Contain independent widgets such as chart containers
- Layer: css
- Stage: layout, paint, style
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium; changes inside a contained box do not trigger layout or paint outside it.
- Do: Give fixed-size widgets (chart panes, tickers, order book) `contain: strict` (size layout paint style) when the size comes from outside, or `contain: content` when content sets the height.
- Why: Layout containment makes the box a layout boundary; paint containment clips descendants so off-screen ones can be skipped. DevTools shows "Layout scope: Partial" for bounded relayouts.
- Example:
  ```css
  .chart-pane { contain: strict; inline-size: 100%; block-size: 420px; }
  .ticker     { contain: content; }
  ```
- Avoid/caveats: Size containment makes an unsized box collapse to 0; paint containment clips overflow such as tooltips (render tooltips in a top-layer/portal).
- Status: `contain` Baseline widely available (2024-09).
- Sources: https://web.dev/articles/content-visibility ; https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/contain ; https://developer.chrome.com/docs/devtools/performance/timeline-reference

### Batch DOM reads before writes; never read geometry after a write in the same task
- Layer: js
- Stage: style, layout
- Metrics: INP, TBT, FPS/smoothness
- When: interaction, animation/render-loop, load
- Impact: high; each read after a write forces a synchronous style and layout; in a loop this is layout thrashing.
- Do: Read all geometry first (values from the last frame are free), then write. Cache sizes from ResizeObserver.
- Why: Layout-reading APIs include `offsetWidth/Height/Top/Left`, `clientWidth/Height`, `getBoundingClientRect()`, `getClientRects()`, `scrollTop/Left/Width/Height`, `scrollTo()`, `scrollIntoView()`, `focus()`, `innerText`, `window.innerWidth/innerHeight/scrollX/scrollY`, `elementFromPoint()`, `getComputedStyle()` (often), and mouse event `offsetX/offsetY/layerX/layerY`.
- Example:
  ```js
  // Before: read-write per row (layout each iteration)
  for (const row of rows) row.style.width = `${header.offsetWidth}px`;
  // After: one read, many writes
  const w = header.offsetWidth;
  for (const row of rows) row.style.width = `${w}px`;
  ```
- Avoid/caveats: A read is cheap if nothing was invalidated since the last layout.
- Status: DevTools "Forced reflow" insight fails on any forced reflow over 30 ms; LoAF `forcedStyleAndLayoutDuration` in the field (Chrome only).
- Sources: https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing ; https://developer.chrome.com/docs/performance/insights/forced-reflow ; https://gist.github.com/paulirish/5d52fb081b3570c81e3a (blog/gist)

### Avoid layout-forcing reads in pointer handlers
- Layer: js, canvas2d
- Stage: layout, script-run
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium to high for crosshair/drag code that runs on every pointermove.
- Do: Use `clientX/clientY` minus a cached container rect (updated by ResizeObserver and on scroll), not `event.offsetX/offsetY` or `getBoundingClientRect()` per event.
- Why: `MouseEvent.offsetX/offsetY` and `layerX/layerY` force layout in Chromium; if the handler also wrote styles, every event pays a full layout.
- Example:
  ```js
  let rect = host.getBoundingClientRect();
  new ResizeObserver(() => { rect = host.getBoundingClientRect(); }).observe(host);
  addEventListener('scroll', () => { rect = host.getBoundingClientRect(); }, { passive: true });
  host.addEventListener('pointermove', (e) => {
    crosshair.move(e.clientX - rect.left, e.clientY - rect.top); // no layout read here
  });
  ```
- Avoid/caveats: Refresh the cache on any change that moves the container (scroll, resize, layout changes above it).
- Status: Chromium source-backed list (blog/gist).
- Sources: https://gist.github.com/paulirish/5d52fb081b3570c81e3a (gist) ; https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing

---

## Items: Paint, layers and compositing

### Animate only compositor properties: transform, opacity, filter
- Layer: css, js
- Stage: composite, paint, layout
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, interaction
- Impact: high; compositor animations run on the compositor thread and skip style, layout and paint on the main thread.
- Do: Move and scale with `transform`, fade with `opacity`, blur/brighten with `filter`. Remap width/top animations to transforms (FLIP).
- Why: The cc animation framework ticks keyframe animations of transform lists, opacity and filter lists directly on property trees. Chromium 89+ also composites SVG animations and percentage transforms (when the box size is stable).
- Example:
  ```css
  /* Before */ .drawer { transition: left 200ms; }
  /* After  */ .drawer { transition: transform 200ms; }
               .drawer.open { transform: translateX(0); }
  ```
- Avoid/caveats: Changing `transform` from JS every frame still runs the main-thread lifecycle; declarative CSS/WAAPI animations are what the compositor can run alone. `background-color`/`clip-path` compositing was announced as coming to Chromium; its shipping status was not verified; check the Animations track (red triangle marks non-composited animations, with reasons).
- Status: Behavior, not an API. transform/opacity per web.dev; filter listed in the Chromium cc animation framework and the Chrome animation blog. Other engines not verified per property.
- Sources: https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count ; https://developer.chrome.com/blog/hardware-accelerated-animations ; https://chromium.googlesource.com/chromium/src/+/HEAD/docs/how_cc_works.md ; https://developer.chrome.com/docs/devtools/performance/reference

### Use will-change sparingly and just in time
- Layer: css, js
- Stage: composite, raster, gpu-upload, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium; a promoted layer avoids repaint of its neighbors but costs GPU memory and upload bandwidth.
- Do: Add `will-change: transform` to an element shortly before it animates and remove it after, or keep it only on a few permanently moving elements.
- Why: Each layer's textures must be uploaded to the GPU; too many layers ("layer explosion") can cost more than it saves, most on low-memory devices.
- Example:
  ```js
  panel.addEventListener('pointerenter', () => { panel.style.willChange = 'transform'; });
  panel.addEventListener('transitionend', () => { panel.style.willChange = ''; });
  ```
- Avoid/caveats: MDN: use it "as a last resort", never on `*`. `translateZ(0)` is the legacy hack. Check layer count and reasons in the Layers tab (advanced paint instrumentation) and "Layer borders".
- Status: `will-change` Baseline widely available (2020).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/will-change ; https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count

### Reduce paint area and paint cost
- Layer: css
- Stage: paint, raster
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, interaction
- Impact: medium; paint is often the longest pipeline step, and blur-based effects cost much more than flat fills.
- Do: Avoid animating `box-shadow`, blurs and large gradients; keep frequently repainted regions small and separate from other repaint regions; use Paint flashing to find surprise repaints.
- Why: Browsers union dirty regions, so two small repaints far apart can repaint the whole screen. Paint-only property changes (color, background, shadow) skip layout but not paint.
- Example:
  ```css
  /* Before: repaint every frame */ .pulse { animation: glow 1s infinite; } @keyframes glow { to { box-shadow: 0 0 12px var(--up); } }
  /* After: composite only       */ .pulse::after { box-shadow: 0 0 12px var(--up); opacity: 0; animation: fade 1s infinite; } @keyframes fade { to { opacity: 1; } }
  ```
- Avoid/caveats: Filters and blend modes can add intermediate render passes on the GPU.
- Status: Guidance.
- Sources: https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas ; https://developer.chrome.com/docs/chromium/renderingng-data-structures

### Decode large images before they enter the frame
- Layer: js, html
- Stage: raster, gpu-upload
- Metrics: FPS/smoothness, INP
- When: interaction, animation/render-loop
- Impact: low to medium; image decode is the most expensive part of raster.
- Do: When you swap in a large image (full-res after thumbnail, new chart background), `await img.decode()` before inserting it.
- Why: `decode()` resolves when the image is decoded and "safe to be appended", so the next frame does not wait for or flash an empty image.
- Example:
  ```js
  const next = new Image(); next.src = url;
  await next.decode();
  thumb.replaceWith(next);
  ```
- Status: `HTMLImageElement.decode()` Baseline widely available (since 2020-01; Chrome 64, Firefox 68, Safari 11.1).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode ; https://chromium.googlesource.com/chromium/src/+/HEAD/docs/how_cc_works.md

---

## Items: The update frame (interaction and render loop)

### Write visual updates inside requestAnimationFrame and drive motion by its timestamp
- Layer: js, canvas2d, gpu
- Stage: script-run, style, layout, paint
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: high; rAF runs right before style and layout of the frame, so one batched write lands in the next paint.
- Do: Collect data changes from events/sockets into state; apply DOM writes and canvas/WebGL draws once per frame in a single rAF callback. Compute progress from the rAF timestamp.
- Why: Per the HTML spec, rAF callbacks run after resize/scroll/animation steps and before the style/layout loop. Motion based on frame count runs faster on 120 Hz screens.
- Example:
  ```js
  let pending = null, scheduled = false;
  socket.onmessage = (m) => { pending = JSON.parse(m.data); if (!scheduled) { scheduled = true; requestAnimationFrame(draw); } };
  function draw(now) { scheduled = false; chart.render(pending, now); }
  ```
- Avoid/caveats: rAF is paused in background tabs and hidden iframes. Do not read layout after writing inside the callback.
- Status: `requestAnimationFrame` Baseline widely available; rAF in dedicated workers widely available (2025-09).
- Sources: https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering ; https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame

### Render on demand: stop rAF loops when nothing changes or the page is hidden
- Layer: js, gpu
- Stage: idle, script-run, gpu-draw
- Metrics: FPS/smoothness, memory, INP
- When: long-lived session, animation/render-loop
- Impact: medium; an always-on rAF loop forces a rendering update every frame and blocks idle time.
- Do: Request a frame only when state is dirty; stop streaming-driven redraws on `visibilitychange` to hidden and resume on visible.
- Why: The spec skips a frame only when there is no visible change AND no animation frame callback; idle-callback deadlines are also cut short when rAF callbacks are pending. Hidden documents are removed from rendering.
- Example:
  ```js
  document.addEventListener('visibilitychange', () => {
    document.hidden ? feed.pauseRendering() : feed.resumeRendering();
  });
  ```
- Status: Page Visibility Baseline widely available.
- Sources: https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model ; https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame

### Paint the response first, then defer non-visual work until after the next frame
- Layer: js
- Stage: script-run, main-thread-task, paint
- Metrics: INP
- When: interaction
- Impact: high; INP ends at the next paint, so work after the visual update in the same task delays it.
- Do: In the event handler, apply only the UI change; move saving, analytics, recalculation to a task after the frame.
- Why: The presentation delay subpart of INP runs from handler end to the next frame.
- Example:
  ```js
  input.addEventListener('input', (e) => {
    priceField.update(e.target.value);             // visible now
    requestAnimationFrame(() => setTimeout(() => { // after the next frame
      recalcOrderPreview(); persistDraft();
    }, 0));
  });
  ```
- Avoid/caveats: The rAF + setTimeout pattern works in all browsers; `scheduler.yield()` is cleaner where supported.
- Status: Pattern; all browsers.
- Sources: https://web.dev/articles/optimize-inp

### Break long tasks by yielding about every 50 ms
- Layer: js
- Stage: main-thread-task, script-run
- Metrics: INP, TBT
- When: interaction, load, long-lived session
- Impact: high; a task over 50 ms is a long task, and input waits for it.
- Do: In loops over big data, yield with `scheduler.yield()` (fallback `setTimeout`) when about 50 ms have passed since the last yield.
- Why: `scheduler.yield()` continuations are prioritized ahead of other queued tasks; `setTimeout` puts work at the end of the queue and clamps to 5 ms after nesting.
- Example:
  ```js
  const yieldToMain = () => globalThis.scheduler?.yield ? scheduler.yield() : new Promise(r => setTimeout(r, 0));
  async function recalcAll(series) {
    let last = performance.now();
    for (const s of series) {
      s.recalc();
      if (performance.now() - last > 50) { await yieldToMain(); last = performance.now(); }
    }
  }
  ```
- Avoid/caveats: Do not use `navigator.scheduling.isInputPending()` (discouraged; may return false incorrectly). `requestIdleCallback` is not in Safari stable (Safari "preview" in BCD), so never rely on it alone.
- Status: `scheduler.yield`/`postTask`: Chrome 129, Firefox 142, not Safari (limited). `isInputPending`: Chrome 87, discouraged. `requestIdleCallback`: Chrome 47, Firefox 55.
- Sources: https://web.dev/articles/optimize-long-tasks ; https://webstatus.dev/features/scheduler ; https://webstatus.dev/features/requestidlecallback

### Use passive listeners and attach non-passive wheel/touch handlers only to the chart surface
- Layer: js, css
- Stage: composite, main-thread-task
- Metrics: FPS/smoothness, INP
- When: interaction
- Impact: high for scroll smoothness; a non-passive listener makes the compositor wait for the main thread in that region.
- Do: Use `{ passive: true }` for touch/wheel listeners that do not cancel scrolling. When a chart must block page scroll for zoom/pan, attach `{ passive: false }` to the chart element only and use `touch-action: none` on it.
- Why: Regions with such handlers become a "non-fast scrollable region". Browsers other than Safari already default `passive: true` for wheel/touchstart/touchmove on window, document and body.
- Example:
  ```js
  chartEl.addEventListener('wheel', onZoom, { passive: false }); // scoped
  document.addEventListener('touchstart', onAnyTouch, { passive: true });
  ```
  ```css
  .chart-surface { touch-action: none; }
  ```
- Avoid/caveats: Event delegation of a non-passive handler on `body` marks the whole page. Lighthouse 13 removed the passive-listener audit; check "Scrolling performance issues" in the Rendering drawer instead.
- Status: `passive` option Baseline widely available (2017); `touch-action` widely available.
- Sources: https://developer.chrome.com/blog/inside-browser-part4 ; https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener ; https://developer.chrome.com/docs/devtools/rendering/performance

### Read coalesced pointer events when you need every input point
- Layer: js, canvas2d
- Stage: script-run, main-thread-task
- Metrics: FPS/smoothness, INP
- When: interaction
- Impact: low to medium; keeps drawing tools precise without raising handler frequency.
- Do: Handle `pointermove` once per frame and read `getCoalescedEvents()` for the full path; use `getPredictedEvents()` to draw ahead for lower latency.
- Why: Chrome dispatches continuous events (pointermove, mousemove, touchmove, wheel) right before rAF, once per frame; discrete events dispatch at once.
- Example:
  ```js
  canvas.addEventListener('pointermove', (e) => {
    for (const p of e.getCoalescedEvents()) trendLine.addPoint(p.clientX, p.clientY);
  });
  ```
- Status: `getCoalescedEvents` in Chrome 58, Firefox 59, Safari 18.2 (not Baseline per web-features key); `getPredictedEvents` Baseline newly available 2024-12.
- Sources: https://developer.chrome.com/blog/aligning-input-events ; https://developer.chrome.com/blog/inside-browser-part4

### Size canvases from ResizeObserver; do not resize the observed box in its callback
- Layer: js, canvas2d, gpu
- Stage: layout, gpu-upload, gpu-draw
- Metrics: FPS/smoothness, CLS, memory
- When: interaction, long-lived session
- Impact: medium; resizing a canvas backing store clears and reallocates it, and resize via polling forces layout.
- Do: Observe the canvas host with ResizeObserver; set `canvas.width/height` only when the device-pixel size really changed; use `devicePixelContentBoxSize` when present, else `contentBoxSize * devicePixelRatio`.
- Why: RO callbacks run after layout and before paint in the same frame, so the new size is drawn without a stale frame. A WebGL canvas resize clears the drawing buffer and triggers a present.
- Example:
  ```js
  const ro = new ResizeObserver(([entry]) => {
    const dp = entry.devicePixelContentBoxSize?.[0];
    const w = dp ? dp.inlineSize : Math.round(entry.contentBoxSize[0].inlineSize * devicePixelRatio);
    const h = dp ? dp.blockSize  : Math.round(entry.contentBoxSize[0].blockSize  * devicePixelRatio);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; chart.invalidate(); }
  });
  try { ro.observe(canvas, { box: 'device-pixel-content-box' }); } catch { ro.observe(canvas); }
  ```
- Avoid/caveats: Changing the observed element's size inside the callback causes another round; the spec reports "ResizeObserver loop completed with undelivered notifications" when it gives up. Where `device-pixel-content-box` is not a supported box option (Safari), `observe()` with that option can throw (WebIDL enum conversion); wrap it in try/catch and fall back to `observe(canvas)` (content box).
- Status: ResizeObserver Baseline widely available; `devicePixelContentBoxSize` Chrome 84, Firefox 108, not Safari.
- Sources: https://drafts.csswg.org/resize-observer/ ; https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering ; https://registry.khronos.org/webgl/specs/latest/1.0/

### Treat IntersectionObserver callbacks as next-task, and use them to pause off-screen work
- Layer: js
- Stage: layout, script-run
- Metrics: FPS/smoothness, memory, INP
- When: long-lived session, animation/render-loop
- Impact: medium; stops rendering of charts/widgets that are not visible.
- Do: Pause redraws of off-screen charts when `isIntersecting` is false; resume when true. Do not use IO callbacks for same-frame layout corrections.
- Why: Intersections are computed during "update the rendering", but the callback runs in a separately queued task, after that frame.
- Example:
  ```js
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) charts.get(e.target).setActive(e.isIntersecting);
  }, { rootMargin: '200px' });
  ```
- Status: IntersectionObserver Baseline widely available (2019).
- Sources: https://w3c.github.io/IntersectionObserver/ ; https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering

### Move heavy canvas or WebGL drawing off the main thread with OffscreenCanvas
- Layer: js, gpu, canvas2d
- Stage: script-run, gpu-draw, main-thread-task
- Metrics: INP, FPS/smoothness
- When: animation/render-loop, long-lived session
- Impact: high when drawing cost competes with input handling on the main thread.
- Do: `transferControlToOffscreen()` the chart canvas, post it to a worker, and run the draw loop with the worker's rAF.
- Why: Workers have their own rendering event loop for OffscreenCanvas; main-thread long tasks then do not stall chart frames, and chart frames do not delay input.
- Example:
  ```js
  const off = canvas.transferControlToOffscreen();
  const worker = new Worker(new URL('./chart-worker.js', import.meta.url), { type: 'module' });
  worker.postMessage({ canvas: off }, [off]);
  ```
- Avoid/caveats: DOM overlays (tooltips, axes in HTML) stay on the main thread and need syncing; input must be forwarded by message. Check that the chart library supports worker rendering.
- Status: OffscreenCanvas Baseline widely available (since 2025-09); WebGL/WebGL2 on OffscreenCanvas widely available (since 2026-03).
- Sources: https://web.dev/articles/offscreen-canvas ; https://developer.chrome.com/docs/chromium/renderingng-architecture ; https://webstatus.dev/features/offscreen-canvas

### Keep preserveDrawingBuffer false for WebGL charts
- Layer: gpu
- Stage: gpu-draw, gpu-upload
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium; preserving the buffer "can cause significant performance loss on some platforms" (WebGL spec).
- Do: Leave `preserveDrawingBuffer` at its default `false`; for screenshots, read pixels in the same task as the draw.
- Why: With `false`, the implementation can clear or swap the buffer after compositing.
- Example:
  ```js
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: false, antialias: true });
  ```
- Status: WebGL spec default.
- Sources: https://registry.khronos.org/webgl/specs/latest/1.0/

### Do not build large DOM subtrees in one task
- Layer: js
- Stage: script-run, style, layout, main-thread-task
- Metrics: INP, TBT
- When: interaction, load
- Impact: high; client-created markup is processed as one monolithic task.
- Do: Virtualize big lists; insert in chunks with yields; keep initial client DOM small; prefer server HTML.
- Why: Streamed server HTML yields between chunks for free; `innerHTML`/`createElement` bursts do not.
- Status: Guidance.
- Sources: https://web.dev/articles/client-side-rendering-of-html-and-interactivity ; https://web.dev/articles/dom-size-and-interactivity

---

## Items: Tooling and verification

### Read the CRP in the DevTools Performance panel before and after each change
- Layer: tooling
- Stage: network, html-parse, cssom, script-run, style, layout, paint, composite, raster, gpu-draw
- Metrics: FCP, LCP, INP, CLS, TBT, FPS/smoothness
- When: testing
- Impact: high; every lever above has a named trace event or insight.
- Do: Record a reload with CPU throttling (calibrate a preset for mid-tier mobile) and network throttling. Read, in order: Network track (red triangle = render-blocking), Main track ("Parse HTML", "Evaluate script", "Recalculate style", "Layout", "Pre-paint", "Paint", "Layerize", "Commit"), Timings (FCP, LCP, DCL, L), Frames (green/yellow/red), Thread pool (raster, decode), GPU, Interactions and Animations tracks, then the Insights tab.
- Why: Insights now shared with Lighthouse 13: Render-blocking requests, Network dependency tree, LCP request discovery, LCP breakdown, Document request latency, Forced reflow, Optimize DOM size, CSS selector costs, INP breakdown, Layout shift culprits, Font display, Declare a character encoding, Optimize viewport for mobile, Third parties, Legacy/Duplicated JavaScript, Modern HTTP, Improve image delivery, Use efficient cache lifetimes.
- Avoid/caveats: Throttling is relative to your machine. "Enable advanced paint instrumentation" and "Enable CSS selector stats" add overhead; turn them on only when needed. The old "Timeline event reference" page lists pre-RenderingNG names (for example "Composite Layers").
- Status: Chrome DevTools (current); Lighthouse 13 in Chrome 143+.
- Sources: https://developer.chrome.com/docs/devtools/performance/reference ; https://developer.chrome.com/docs/performance/insights ; https://developer.chrome.com/blog/lighthouse-13-0 ; https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/Styles.ts

### Use the Rendering drawer to see paint, layers and frame drops live
- Layer: tooling
- Stage: paint, composite, raster, gpu-draw
- Metrics: FPS/smoothness, CLS
- When: testing
- Impact: medium; shows surprises without a trace.
- Do: Turn on Paint flashing (green = repaint), Layout shift regions (purple), Layer borders (orange/olive layers, cyan tiles), Frame rendering stats (FPS, dropped/partial frames, GPU raster state, GPU memory), Scrolling performance issues (elements with scroll-blocking listeners).
- Status: Chrome DevTools.
- Sources: https://developer.chrome.com/docs/devtools/rendering/performance

### Find unused CSS and JS with the Coverage panel
- Layer: tooling
- Stage: cssom, script-compile
- Metrics: FCP, LCP, bundle-size
- When: testing, build
- Impact: medium; identifies what can leave the critical path.
- Do: Record coverage during load and key interactions; move unused-at-load code to lazy chunks and unused CSS to route sheets.
- Status: Chrome DevTools.
- Sources: https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources ; https://web.dev/learn/performance/optimize-resource-loading

### Measure frame phases in the field with Long Animation Frames, Event Timing and renderBlockingStatus
- Layer: tooling, js
- Stage: script-run, style, layout, main-thread-task
- Metrics: INP, LCP, FPS/smoothness
- When: long-lived session, testing
- Impact: medium; attributes slow frames and render-blocking requests for real users.
- Do: Observe `long-animation-frame` entries (fields `duration`, `blockingDuration`, `renderStart`, `styleAndLayoutStart`, `firstUIEventTimestamp`, `scripts[].invoker`, `forcedStyleAndLayoutDuration`); observe `event` entries for INP; read `renderBlockingStatus` on resource entries.
- Example:
  ```js
  new PerformanceObserver((list) => {
    for (const f of list.getEntries()) {
      const forced = f.scripts.reduce((t, s) => t + s.forcedStyleAndLayoutDuration, 0);
      report({ dur: f.duration, blocking: f.blockingDuration, forced });
    }
  }).observe({ type: 'long-animation-frame', buffered: true });
  ```
- Avoid/caveats: LoAF has no data for cross-origin iframes or workers; `desiredExecutionStart`/`desiredRenderStart` were removed.
- Status: LoAF Chrome 123 only (limited, experimental in BCD). Event Timing Baseline newly available 2025-12-12 (Safari 26.2, Firefox). `renderBlockingStatus` Chrome 107 only.
- Sources: https://developer.chrome.com/docs/web-platform/long-animation-frames ; https://webstatus.dev/features/event-timing ; https://webstatus.dev/features/long-animation-frames

### Let the agent verify CRP changes with Chrome DevTools MCP traces
- Layer: tooling
- Stage: network, html-parse, style, layout, paint
- Metrics: FCP, LCP, INP, CLS
- When: testing
- Impact: medium; closes the loop for code written by an agent.
- Do: After a change, run `performance_start_trace` (reload), then `performance_analyze_insight` for Render-blocking requests, LCP breakdown, Forced reflow and DOM size; compare with the baseline trace.
- Why: The Chrome DevTools MCP server exposes DevTools performance tracing and insights to coding agents.
- Status: Public preview since 2025-09-23; now part of "DevTools for agents".
- Sources: https://developer.chrome.com/blog/chrome-devtools-mcp

---

## Sources read
- https://web.dev/learn/performance/understanding-the-critical-path
- https://web.dev/learn/performance/optimize-resource-loading
- https://web.dev/learn/performance/resource-hints
- https://web.dev/learn/performance/optimize-web-fonts
- https://web.dev/learn/performance/image-performance (skimmed)
- https://web.dev/articles/preload-scanner
- https://web.dev/articles/rendering-performance
- https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing
- https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count
- https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas
- https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations
- https://web.dev/articles/content-visibility
- https://web.dev/articles/fetch-priority
- https://web.dev/articles/optimize-lcp
- https://web.dev/articles/optimize-inp
- https://web.dev/articles/optimize-long-tasks
- https://web.dev/articles/script-evaluation-and-long-tasks
- https://web.dev/articles/client-side-rendering-of-html-and-interactivity
- https://web.dev/articles/dom-size-and-interactivity
- https://web.dev/articles/optimize-ttfb
- https://web.dev/articles/bfcache
- https://web.dev/articles/offscreen-canvas
- https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path
- https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work
- https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
- https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- https://developer.mozilla.org/en-US/docs/Web/CSS/will-change
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/contain
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/link
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@font-face/font-display
- https://developer.chrome.com/docs/chromium/renderingng
- https://developer.chrome.com/docs/chromium/renderingng-architecture
- https://developer.chrome.com/docs/chromium/renderingng-data-structures
- https://developer.chrome.com/blog/inside-browser-part3
- https://developer.chrome.com/blog/inside-browser-part4
- https://developer.chrome.com/blog/aligning-input-events
- https://developer.chrome.com/blog/hardware-accelerated-animations
- https://developer.chrome.com/blog/paint-holding
- https://developer.chrome.com/blog/lighthouse-13-0
- https://developer.chrome.com/blog/chrome-devtools-mcp
- https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources
- https://developer.chrome.com/docs/devtools/performance/reference
- https://developer.chrome.com/docs/devtools/performance/timeline-reference
- https://developer.chrome.com/docs/devtools/rendering/performance
- https://developer.chrome.com/docs/performance/insights (index) and the insight pages: charset, document-latency, dom-size, forced-reflow, lcp-discovery, network-dependency-tree, render-blocking, viewport, font-display
- https://developer.chrome.com/docs/web-platform/early-hints
- https://developer.chrome.com/docs/web-platform/long-animation-frames
- https://developer.chrome.com/docs/web-platform/prerender-pages (skimmed)
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/how_cc_works.md
- https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/models/trace/Styles.ts
- https://html.spec.whatwg.org/multipage/webappapis.html (event loop, update the rendering)
- https://html.spec.whatwg.org/multipage/dom.html (render-blocking mechanism)
- https://html.spec.whatwg.org/multipage/urls-and-fetching.html (blocking attributes, fetch priority)
- https://html.spec.whatwg.org/multipage/scripting.html (async/defer/module modes)
- https://html.spec.whatwg.org/multipage/semantics.html (script-blocking style sheets)
- https://w3c.github.io/IntersectionObserver/
- https://drafts.csswg.org/resize-observer/
- https://registry.khronos.org/webgl/specs/latest/1.0/
- https://www.rfc-editor.org/rfc/rfc9002.txt ; https://www.rfc-editor.org/rfc/rfc8446.txt
- https://groups.google.com/a/chromium.org/g/blink-dev/c/QC5iefctcag/m/kkoBNliBAgAJ (in-body stylesheets do not block paint)
- https://groups.google.com/a/chromium.org/g/blink-dev/c/TPkgQj2gmiI (head stylesheet parser pausing intent; outcome not visible)
- https://timkadlec.com/remembers/2020-02-13-when-css-blocks/ (blog)
- https://gist.github.com/paulirish/5d52fb081b3570c81e3a (gist: what forces layout)
- https://api.webstatus.dev/v1/features (fetch-priority, content-visibility, blocking-render, scheduler, requestidlecallback, long-animation-frames, offscreen-canvas, resize-observer, intersection-observer, speculation-rules, modulepreload, link-rel-expect, will-change, contain, import-maps, link-rel-preload, loading-lazy, event-timing, largest-contentful-paint, layout-instability, view-transitions, canvas desynchronized)
- https://unpkg.com/web-features@3.39.0/data.json ; https://unpkg.com/@mdn/browser-compat-data (8.1.2, 2026-09-17)

## Not covered / could not access
- "Life of a Pixel" (Steve Kobes) slides and video: not read directly; the RenderingNG articles and "How cc works" cover the same pipeline.
- Chromium intent "Pause HTML parser while loading stylesheets in head": the final decision in the thread was truncated; whether Chrome pauses the parser (not only rendering) for head stylesheets today is not verified.
- Composited `background-color` and `clip-path` animations in Chromium: announced as coming; the shipping version and default status were not verified.
- Exact DevTools label for ResizeObserver callbacks in the Main track: not verified.
- Safari behavior for in-body stylesheets and Safari/Firefox profiler equivalents (Web Inspector Timelines, Firefox Profiler markers) were not researched.
- WebGPU presentation timing (`getCurrentTexture`, `configure`) and SciChart.js-specific render-loop internals were out of scope for this topic.
- Exact Chrome render-blocking timeout value (spec says "implementation-defined").
