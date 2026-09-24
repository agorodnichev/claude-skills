# Critical rendering path: items new in the second pass
Only items whose titles do not match the first pass (01-critical-rendering-path.run1.md).

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

