# web.dev Learn Performance, part A (loading)

Scope: every actionable loading lever in the web.dev "Learn Performance" course modules that I read in full: Welcome, Why speed matters, General HTML performance considerations, Optimize resource loading, Assist the browser with resource hints, Image performance, Video performance, Optimize web fonts. I skimmed "Understanding the critical path" only for levers a CRP note can miss. To fill gaps and check exact values I also read the linked web.dev articles (fetch-priority, preload-responsive-images, preload-scanner, font-best-practices, optimize-lcp, ttfb, vitals, preconnect-and-dns-prefetch), MDN rel=preload, the WebKit font-loading post, and Chrome release notes and chromestatus entries.
Browser status comes from web-features 3.39.0 and @mdn/browser-compat-data (BCD) 8.1.2 (dated 2026-09-17), both downloaded on 2026-09-22, plus caniuse raw JSON. At that date the current stable releases are Chrome 153, Firefox 156 and Safari 27. Most course modules were last updated on 2023-11-01. The video module was updated on 2026-04-02. Where a course claim is out of date, the item says so.

---

## Module: Why speed matters

### Set Core Web Vitals targets at the 75th percentile before you optimize
- Layer: tooling
- Stage: network, paint, main-thread-task
- Metrics: LCP, INP, CLS, TTFB
- When: testing
- Impact: medium. Without a target, loading work has no clear stop condition.
- Do: Aim for LCP ≤ 2.5 s, INP ≤ 200 ms and CLS ≤ 0.1 at the 75th percentile of page loads, and look at mobile and desktop separately. Use TTFB ≤ 0.8 s as a rough guide for the server. Look at field data (CrUX/RUM), not only lab runs.
- Why: The course links speed to retention and conversion (for example, BBC saw 10% more users leave for each extra second of load time, and Vodafone saw 8% more sales after a 31% LCP improvement). Mobile CPUs, memory and data plans are limited, so large code payloads hurt most there.
- Example: n/a
- Avoid/caveats: TTFB is not a Core Web Vital. A slow TTFB matters only because it delays FCP and LCP.
- Status: metrics definitions, not browser features.
- Sources: https://web.dev/learn/performance/why-speed-matters, https://web.dev/articles/vitals, https://web.dev/articles/ttfb

---

## Module: General HTML performance considerations

### Link to final URLs and remove redirect hops
- Layer: network
- Stage: network
- Metrics: TTFB, FCP, LCP
- When: load
- Impact: high. Each redirect adds a full extra request before the document starts.
- Do: Make internal links and canonical URLs point directly to the final URL, including the trailing-slash form your server uses. Remove HTTP→HTTPS→canonical chains. Check that third-party campaign or ad links do not chain a cross-origin redirect into a same-origin redirect.
- Why: A `301`/`302` makes the browser issue a second request at the new location, and TTFB includes that redirect time.
- Example:
  ```html
  <!-- Before: the server answers 301 -> /markets -->
  <a href="/markets/">Markets</a>
  <!-- After -->
  <a href="/markets">Markets</a>
  ```
- Avoid/caveats: Cross-origin redirects (ads, URL shorteners) are outside your control. Remove only the hops on your own origin.
- Status: HTTP behavior, all browsers.
- Sources: https://web.dev/learn/performance/general-html-performance

### Cache static HTML briefly; do not cache personalized HTML in the browser
- Layer: network
- Stage: network
- Metrics: TTFB, LCP
- When: load
- Impact: medium. A short TTL lets a CDN serve the document and lets browsers revalidate instead of downloading it again.
- Do: For HTML that is the same for all users, set a short lifetime (the course suggests about 5 minutes) so a CDN can cache it. For personalized or authenticated HTML, do not let the browser cache it, because you cannot invalidate a browser cache.
- Why: HTML references fingerprinted subresources. A long-lived HTML cache can point to deleted bundles after a deploy. A short TTL limits that risk and still takes load off the origin.
- Example:
  ```http
  # static marketing page
  Cache-Control: public, max-age=300
  # logged-in trading dashboard shell
  Cache-Control: private, no-store
  ```
- Avoid/caveats: `no-store` used to block the back/forward cache in Chrome. Since the 2025 rollout, Chrome allows bfcache for `no-store` pages when it is safe: it evicts the page on cookie or auth changes and keeps it for 3 minutes, not 10 (developer.chrome.com/docs/web-platform/bfcache-ccns; not from the course). Use `no-cache` (revalidate every time) when you want freshness but still want a revalidation path.
- Status: HTTP caching, all browsers.
- Sources: https://web.dev/learn/performance/general-html-performance

### Make HTML revalidation cheap with ETag or Last-Modified
- Layer: network
- Stage: network
- Metrics: TTFB
- When: load
- Impact: low. A 304 still costs a round trip but saves the body bytes.
- Do: Send a strong validator (`ETag` from a content hash, or `Last-Modified`) on HTML. The browser then sends `If-None-Match` / `If-Modified-Since`, and the server answers `304 Not Modified` when the content is unchanged.
- Why: A 304 has no body, so revalidation costs only latency, not the full download.
- Example:
  ```http
  HTTP/1.1 200 OK
  ETag: "v7-9f2c1ab0"
  Cache-Control: no-cache
  ```
- Avoid/caveats: Every revalidation still costs one RTT. Generate a new ETag on every content change.
- Status: HTTP/1.1, Baseline widely available (web-features `http11`).
- Sources: https://web.dev/learn/performance/general-html-performance

### Expose backend phases with the Server-Timing header
- Layer: network
- Stage: network
- Metrics: TTFB
- When: testing
- Impact: medium. It shows which server phase causes a slow field TTFB.
- Do: Add `Server-Timing` entries for the main backend phases (auth, DB, render, cache hit/miss). Read them in the field through Navigation Timing (`performance.getEntriesByType('navigation')[0].serverTiming`) and send them to RUM.
- Why: One header can carry several named metrics with `dur` and `desc`, so you can see where server time goes for real users.
- Example:
  ```http
  Server-Timing: edge;desc="HIT", session;dur=12.4, quotes-db;dur=87.0
  ```
- Avoid/caveats: Do not expose sensitive internals to all users. Gate detailed entries if needed.
- Status: Baseline widely available (low 2023-03-27, high 2025-09-27). Chrome 65, Firefox 61, Safari 16.4 (web-features `server-timing`).
- Sources: https://web.dev/learn/performance/general-html-performance, https://web.dev/articles/optimize-ttfb

### Render the first view on the server, not with a spinner and a client-side fetch
- Layer: html
- Stage: network, html-parse, script-run
- Metrics: LCP, FCP, INP
- When: load
- Impact: high. Client rendering adds a script download, compile, run and data round trip before any content appears.
- Do: Send the initial content in the HTML response (SSR or SSG). Keep client-side work for things that must be dynamic.
- Why: The server environment is predictable. The user's device and network are not, so moving work to the client makes user-centric metrics worse on average.
- Example: n/a
- Avoid/caveats: SSR increases TTFB if the backend is slow. Measure TTFB and LCP together.
- Status: architecture pattern.
- Sources: https://web.dev/learn/performance/general-html-performance, https://web.dev/articles/preload-scanner

### Compress text responses with Brotli, keep gzip as fallback, consider zstd
- Layer: network
- Stage: network
- Metrics: TTFB, FCP, LCP, bundle-size
- When: load
- Impact: high. HTML, CSS, JS, SVG and JSON shrink a lot, and Brotli is about 15–20% smaller than gzip.
- Do: Serve `Content-Encoding: br` to clients that send it in `Accept-Encoding`, and fall back to gzip. Compress every text type, including SVG and JSON.
- Why: Fewer bytes on the wire means a faster download for render-blocking CSS/JS and for the document.
- Example:
  ```http
  Vary: Accept-Encoding
  Content-Encoding: br
  ```
- Avoid/caveats: Zstandard (`zstd`) is newer than the course. It is now in all major engines, and servers and CDNs can offer it where they support it. Keep br/gzip for older clients.
- Status: Brotli is Baseline widely available (2017). zstd is Baseline newly available since 2026-02-11 (Chrome 123, Firefox 126, Safari 26.3) (web-features `brotli`, `zstd`; BCD `http.headers.Content-Encoding`). Compression dictionary transport is Chrome 130+ only and experimental.
- Sources: https://web.dev/learn/performance/general-html-performance, https://caniuse.com/brotli

### Pre-compress static assets at build time; compress dynamic HTML on the fly
- Layer: build
- Stage: network
- Metrics: TTFB, bundle-size
- When: build
- Impact: medium. Static compression removes compression latency from each request and allows the highest compression levels.
- Do: Emit `.br` (and `.gz`) versions of JS, CSS and SVG during the build and serve them directly. Compress personalized HTML dynamically.
- Why: Dynamic compression runs on every request and adds server time. Static compression runs once.
- Example: `vite-plugin-compression`-style step, or a CDN setting that stores compressed variants.
- Avoid/caveats: A CDN often does this for you. Check what it does before you add a build step.
- Status: server/build practice.
- Sources: https://web.dev/learn/performance/general-html-performance

### Do not size bundles for compression ratio
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, TBT, startup
- When: build
- Impact: low. It stops people from merging files only to improve compression.
- Do: Accept that very small files (< 1 KiB) barely compress. Do not merge assets into huge files only to get a better compression ratio.
- Why: The decompressed size is what the browser must parse and evaluate. Large bundles also change hash more often, which invalidates caches.
- Example: n/a
- Avoid/caveats: The balance between many tiny requests and a few huge bundles depends on HTTP/2/3 multiplexing and cache churn.
- Status: n/a.
- Sources: https://web.dev/learn/performance/general-html-performance

### Serve from a CDN edge over HTTP/2 or HTTP/3
- Layer: network
- Stage: network
- Metrics: TTFB, LCP
- When: load
- Impact: high. Edge proximity cuts RTT on every request, including connection setup.
- Do: Put the document and static assets behind a CDN that supports HTTP/2 and HTTP/3, edge caching and compression. Keep cache keys clean (for example, strip analytics query parameters) so edge hits happen.
- Why: Physical distance sets the RTT. The CDN also handles compression and protocol upgrades.
- Example: n/a
- Avoid/caveats: Shared hosting often has high TTFB (compare providers with CrUX data such as ismyhostfastyet.com). Unique URL parameters can force every request back to the origin (optimize-lcp article).
- Status: HTTP/3 is Baseline newly available since 2024-09-16 (web-features `http3`). HTTP/2 is widely available.
- Sources: https://web.dev/learn/performance/general-html-performance, https://web.dev/articles/optimize-lcp

---

## Module: Understanding the critical path (skimmed for extra levers)

### Keep render-blocking work in the head to the minimum needed for a non-broken first render
- Layer: html
- Stage: html-parse, cssom, paint
- Metrics: FCP, LCP
- When: load
- Impact: high. Head CSS and sync JS block the whole page.
- Do: Know what blocks and what does not. These block the first render: part of the HTML, stylesheets in `<head>` and sync scripts in `<head>`. These do not: the rest of the HTML, fonts, images, scripts at the end of the body or with `async`/`defer`/`type=module`, and CSS whose `media` does not match.
- Why: The browser holds the first paint until head CSS is parsed, to avoid a broken-looking page (FOUC). Parser-blocking scripts in the head stop all content after them.
- Example: n/a
- Avoid/caveats: Do not remove CSS that is needed for the first view. An early but broken render is worse than a short blank screen.
- Status: n/a.
- Sources: https://web.dev/learn/performance/understanding-the-critical-path

### Stream the HTML and flush the head early
- Layer: network
- Stage: network, html-parse, preload-scan
- Metrics: TTFB, FCP, LCP
- When: load
- Impact: medium. The browser can fetch head resources while the server still builds the body.
- Do: Send the response in chunks. Flush `<head>` (CSS links, preloads, preconnects) before slow data queries finish.
- Why: Browsers parse HTML as it streams and can render before the full document arrives. An early flush also counts as the first byte (TTFB article).
- Example:
  ```js
  // Node/Express sketch
  res.write(headHtml);            // links, preloads, critical CSS
  const rows = await loadQuotes(); // slow backend
  res.end(renderBody(rows));
  ```
- Avoid/caveats: After you flush you cannot change the status code or headers. Handle errors inside the stream.
- Status: HTTP chunked/streamed responses, all browsers.
- Sources: https://web.dev/learn/performance/understanding-the-critical-path, https://web.dev/articles/ttfb

### Reserve space for images and media so late content does not shift layout
- Layer: html
- Stage: layout
- Metrics: CLS
- When: load
- Impact: high. Images and fonts are filled in after the first render, and missing dimensions cause shifts.
- Do: Put `width` and `height` (or CSS `aspect-ratio`) on every `<img>`, `<video>` and `<iframe>`. On art-directed `<picture>`, put `width`/`height` on each `<source>` whose aspect ratio differs.
- Why: The browser does not wait for images or fonts before the first render. Without intrinsic dimensions, the box grows when the resource arrives.
- Example:
  ```html
  <img src="/chart-preview.webp" width="640" height="360" alt="BTC/USD 1D">
  ```
- Avoid/caveats: CSS must not override the ratio (use `height: auto` with a fluid width).
- Status: `<source width/height>` in `<picture>`: Chrome 90, Firefox 108, Safari 15 (BCD `html.elements.source.width`).
- Sources: https://web.dev/learn/performance/understanding-the-critical-path

### Load section-specific CSS in the body, next to the section
- Layer: html
- Stage: cssom, paint
- Metrics: FCP, LCP
- When: load
- Impact: medium. A body stylesheet blocks only the content after it, not the whole page.
- Do: Keep only first-view CSS in `<head>`. Place `<link rel="stylesheet">` for lower sections just before those sections in `<body>`.
- Why: Firefox did this first, and Chrome since version 69: stylesheets that activate after the body starts no longer block paint of the content above them. They still pause the parser.
- Example:
  ```html
  <body>
    <header>…</header>
    <link rel="stylesheet" href="/css/order-book.css">
    <section class="order-book">…</section>
  </body>
  ```
- Avoid/caveats: The parser still pauses at each link, so do not scatter dozens of links.
- Status: Chrome 69 (chromestatus 5696805480169472). chromestatus lists Firefox and Safari as "Shipped".
- Sources: https://web.dev/learn/performance/understanding-the-critical-path, https://chromestatus.com/feature/5696805480169472

### Use a non-matching media attribute only for truly conditional CSS
- Layer: html
- Stage: preload-scan, cssom
- Metrics: FCP
- When: load
- Impact: low. Print or large-screen-only CSS stops blocking render.
- Do: Put `media="print"` or a real media query on stylesheets that apply only in those conditions.
- Why: CSS whose `media` does not match the current conditions is not render-blocking.
- Example:
  ```html
  <link rel="stylesheet" href="/css/print.css" media="print">
  ```
- Avoid/caveats: In Chrome, media-mismatched CSS is not fetched by the preload scanner. It loads at Lowest priority when the main parser reaches it, even with `fetchpriority="high"`. Do not use the old `media="print" onload="this.media='all'"` trick for CSS you need soon. A low-priority `rel=preload as=style` works better for that.
- Status: `media` on `<link>` is universal.
- Sources: https://web.dev/learn/performance/understanding-the-critical-path, https://web.dev/articles/fetch-priority

### Use blocking="render" only to block paint on purpose
- Layer: html
- Stage: html-parse, paint
- Metrics: FCP, CLS
- When: load
- Impact: low. It is a correctness tool (no FOUC or A/B flicker), not a speed tool.
- Do: Add `blocking="render"` to a `<script>`, `<style>` or stylesheet `<link>` only when an early paint without it would look broken (for example, a theme script that sets `data-theme` before the first paint). The parser keeps going while rendering is blocked.
- Why: It gives render-blocking semantics without parser-blocking.
- Example:
  ```html
  <script src="/theme-init.js" async blocking="render"></script>
  ```
- Avoid/caveats: Every render-blocking resource delays FCP. Firefox does not support it, so there you still get an early paint.
- Status: Not Baseline. Chrome 105, Safari 18.2, no Firefox (web-features `blocking-render`, BCD).
- Sources: https://web.dev/learn/performance/understanding-the-critical-path, https://chromestatus.com/feature/5452774595624960

### Treat the LCP resource as part of the critical path and audit request chains
- Layer: tooling
- Stage: network, preload-scan
- Metrics: LCP
- When: testing
- Impact: medium. The classic CRP ignores the non-blocking resources that the main content needs.
- Do: Define the "critical contentful path" as blocking resources plus the LCP resource (image, font, video poster). Use Lighthouse LCP breakdown and critical request chains, WebPageTest render-blocking markers, and DevTools Insights to find chains.
- Why: LCP can be slow even when there are no render-blocking resources, because the LCP image is discovered late or has low priority.
- Example: n/a
- Avoid/caveats: The Lighthouse chain audit lists all high-priority requests, including fonts that do not block rendering.
- Status: tooling.
- Sources: https://web.dev/learn/performance/understanding-the-critical-path, https://web.dev/articles/optimize-lcp

---

## Module: Optimize resource loading

### Do not ship parser-blocking scripts; use defer, type=module, or async
- Layer: html
- Stage: html-parse, script-run, preload-scan
- Metrics: FCP, LCP, TBT
- When: load
- Impact: high. A sync `<script src>` in the head stops parsing and rendering until the script is downloaded, parsed and run.
- Do: Use `defer` for scripts that need the DOM and must run in order. Use `type="module"` (deferred by default, including inline modules). Use `async` for independent scripts (analytics) that can run at any time and in any order.
- Why: `defer` scripts run in document order after parsing finishes, just before `DOMContentLoaded`. `async` scripts run as soon as they arrive and can interrupt parsing. Inline classic scripts always block the parser until they run.
- Example:
  ```html
  <!-- Before -->
  <script src="/js/app.js"></script>
  <!-- After -->
  <script src="/js/app.js" defer></script>
  <script type="module" src="/js/chart-boot.js"></script>
  <script src="/js/rum.js" async></script>
  ```
- Avoid/caveats: `async` scripts that touch the DOM can race with the parser. Scripts inserted with JS behave like `async`.
- Status: `async`/`defer`/modules are Baseline widely available.
- Sources: https://web.dev/learn/performance/optimize-resource-loading

### Remember that a parser-blocking script also waits for pending CSS
- Layer: html
- Stage: cssom, script-run, html-parse
- Metrics: FCP, LCP
- When: load
- Impact: medium. Slow CSS plus a sync script after it doubles the blocking.
- Do: Avoid sync scripts after stylesheets. If an inline script does not read styles, place it before the stylesheet links (my inference from the course's rule, not an explicit course lever).
- Why: A sync script cannot run until in-flight render-blocking CSS has arrived and been parsed, because it might call `getComputedStyle()`.
- Example: n/a
- Avoid/caveats: Order changes can alter behavior if the script does read computed styles.
- Status: HTML spec behavior.
- Sources: https://web.dev/learn/performance/optimize-resource-loading

### Keep critical resources in server-sent HTML so the preload scanner can find them
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP, FCP
- When: load
- Impact: high. The preload scanner fetches `<img>`, `<link>` and `<script src>` early, even while the main parser is blocked.
- Do: Avoid the four patterns the scanner cannot see: (1) CSS `background-image`, (2) scripts inserted by JS and dynamic `import()`, (3) markup rendered on the client, (4) CSS `@import`. If you cannot avoid one of them for a critical resource, preload that resource.
- Why: Late-discovered resources start downloading only after their parent CSS or JS is fetched and run, which creates request chains.
- Example:
  ```html
  <!-- Before: hero only in CSS -->
  <div class="hero"></div>
  <!-- After: discoverable -->
  <img class="hero" src="/img/hero-1200.avif" width="1200" height="600" alt="" fetchpriority="high">
  ```
- Avoid/caveats: Preload is a patch, not a fix. Prefer markup that the scanner can see.
- Status: all modern browsers have a speculative (preload) parser.
- Sources: https://web.dev/learn/performance/optimize-resource-loading, https://web.dev/articles/preload-scanner

### Do not inject startup scripts from inline JS
- Layer: js
- Stage: preload-scan, network
- Metrics: FCP, LCP, startup
- When: load
- Impact: medium. An injected script is requested only after the preceding CSS finishes, and then at Low priority.
- Do: Use `<script src async>` or `defer` in the markup instead of `document.createElement('script')` for anything needed at startup.
- Why: The inline injector runs only after head CSS is loaded (a parser-blocking inline script waits for CSS), so the fetch starts late. Fixing it with a preload raises priority and can compete with CSS for bandwidth.
- Example:
  ```html
  <!-- Before -->
  <script>const s=document.createElement('script');s.src='/js/widget.js';document.head.append(s);</script>
  <!-- After -->
  <script src="/js/widget.js" async></script>
  ```
- Avoid/caveats: Keep injection for scripts that really are conditional or on demand.
- Status: n/a.
- Sources: https://web.dev/articles/preload-scanner

### Do not JS-lazy-load images or iframes that are visible at startup
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP
- When: load
- Impact: high. `data-src` hides the URL from the scanner and waits for the lazy-loader script.
- Do: Use a real `src`/`srcset` for first-view images and iframes. Use native `loading="lazy"` only below the fold.
- Why: The preload scanner reads `src`/`srcset`, not `data-*`. The image then waits for the loader JS to download, compile and run.
- Example:
  ```html
  <!-- Before --> <img data-src="/img/promo.webp" class="lazy" alt="">
  <!-- After -->  <img src="/img/promo.webp" width="800" height="400" alt="">
  ```
- Avoid/caveats: The same applies to iframes, where the cost is larger because an iframe loads many subresources.
- Status: n/a.
- Sources: https://web.dev/articles/preload-scanner, https://web.dev/articles/optimize-lcp

### Replace CSS @import with link elements
- Layer: css
- Stage: network, cssom, preload-scan
- Metrics: FCP, LCP
- When: load
- Impact: medium. `@import` creates a serial chain of render-blocking CSS that the scanner cannot see.
- Do: Load each stylesheet with its own `<link rel="stylesheet">` so they download in parallel. Let preprocessors or bundlers inline their `@import`s at build time. If you must keep a runtime `@import` (layers, third-party CSS), preload the imported file.
- Why: The imported sheet is found only after the parent sheet is downloaded and parsed.
- Example:
  ```html
  <!-- Before (in main.css): @import url('grid.css'); -->
  <link rel="stylesheet" href="/css/main.css">
  <link rel="stylesheet" href="/css/grid.css">
  ```
- Avoid/caveats: For cascade layers, `<link>` cannot assign a layer, so either preload the import or wrap the rules in `@layer` at build time.
- Status: n/a.
- Sources: https://web.dev/learn/performance/optimize-resource-loading

### Minify CSS in production builds
- Layer: build
- Stage: network, cssom
- Metrics: FCP, LCP, bundle-size
- When: build
- Impact: medium. CSS blocks render, so fewer bytes means an earlier first paint.
- Do: Let the bundler minify CSS (whitespace, comments, short color forms).
- Why: A smaller render-blocking file downloads faster.
- Example: n/a
- Avoid/caveats: Aggressive "structural" minification (merging rules across selectors) can break some design-system or cascade assumptions. Keep the default safe level.
- Status: build tooling.
- Sources: https://web.dev/learn/performance/optimize-resource-loading

### Remove unused CSS and split CSS per page or route
- Layer: css
- Stage: network, cssom, style
- Metrics: FCP, LCP, bundle-size
- When: build
- Impact: medium. The browser must download and parse every rule, used or not, before the first render.
- Do: Use the DevTools Coverage panel to find large unused blocks. Move route-specific CSS into route bundles and delete dead CSS.
- Why: Fewer rules mean less download time and a faster render-tree build.
- Example: n/a
- Avoid/caveats: Zero unused CSS is not realistic. Go after big unused chunks only.
- Status: tooling.
- Sources: https://web.dev/learn/performance/optimize-resource-loading

### Inline small critical CSS and load the rest without blocking render
- Layer: css
- Stage: network, cssom, paint
- Metrics: FCP, LCP
- When: load
- Impact: medium. It removes a render-blocking round trip on cold loads.
- Do: Inline only the rules the first viewport needs in a `<style>` in `<head>`. Load the rest with a `<link>` at the end of `<body>`, or with a low-priority preload that switches to a stylesheet.
- Why: With cold caches, the first render then waits for no CSS request.
- Example:
  ```html
  <head>
    <style>/* first-view rules only */ .toolbar{height:40px}.chart-host{min-height:60vh}</style>
    <link rel="preload" as="style" href="/css/app.css" fetchpriority="low" onload="this.rel='stylesheet'">
  </head>
  ```
- Avoid/caveats: Inlined CSS is not cached across pages, and it bloats uncacheable HTML. It is hard to keep correct (which viewports? what if the user scrolls early?). Inline only if the sheet is small. If the CSS takes longer than the LCP resource, do not inline it.
- Status: techniques use widely supported features. `fetchpriority` is Baseline 2024.
- Sources: https://web.dev/learn/performance/optimize-resource-loading, https://web.dev/articles/fetch-priority, https://web.dev/articles/optimize-lcp

### Do not render the LCP element or critical content with client-side JS
- Layer: js
- Stage: preload-scan, script-run, main-thread-task
- Metrics: LCP, INP, TBT
- When: load
- Impact: high. It creates a critical request chain and large single tasks.
- Do: Server-render or statically generate markup for critical content, then hydrate or attach behavior. If an LCP image must come from JS, preload it with `fetchpriority="high"`.
- Why: Client-rendered markup hides resources from the scanner. Building large DOM from JS runs as one monolithic task, while streamed server HTML is parsed in chunks.
- Example: n/a
- Avoid/caveats: Very large DOMs make every later JS update expensive too.
- Status: n/a.
- Sources: https://web.dev/learn/performance/optimize-resource-loading, https://web.dev/articles/preload-scanner

### Minify and mangle JavaScript in production builds
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, startup, TBT
- When: build
- Impact: medium. Mangling shortens identifiers on top of removing whitespace.
- Do: Keep the bundler's production minifier (Terser, esbuild, SWC) on with default settings.
- Why: Fewer bytes to download and parse.
- Example: n/a
- Avoid/caveats: Over-aggressive options (unsafe transforms, mangling properties) can break code. The defaults are usually the right balance.
- Status: build tooling.
- Sources: https://web.dev/learn/performance/optimize-resource-loading

### Do not inline large resources or base64 data into the HTML
- Layer: html
- Stage: network, preload-scan
- Metrics: FCP, LCP
- When: load
- Impact: medium. Inlined bytes delay the scanner's view of everything after them and cannot be cached separately.
- Do: Inline only very small resources. Never base64 fonts or big images into HTML or CSS.
- Why: In the preload-scanner demo, inlining CSS plus four base64 fonts moved LCP from about 3.5 s to over 7 s and FCP from about 2.7 s to about 5.8 s. Base64 is also larger than binary, and inlined fonts download even when the page does not use them.
- Example: n/a
- Avoid/caveats: A tiny inline SVG icon or a small data URL for a small LCP image can be fine. Data URLs can add decode cost (optimize-lcp).
- Status: n/a.
- Sources: https://web.dev/articles/preload-scanner, https://web.dev/learn/performance/optimize-web-fonts

---

## Module: Assist the browser with resource hints

### Preconnect only to the one or two critical cross-origins, with crossorigin for CORS fetches
- Layer: html
- Stage: network
- Metrics: LCP, FCP
- When: load
- Impact: medium. It saves DNS, TCP and TLS time on the first critical cross-origin request.
- Do: Add `<link rel="preconnect" href="https://origin">` early in `<head>` for origins that serve critical resources (image CDN, font files, API). Add `crossorigin` when the resources use CORS (fonts, `fetch` in cors mode). If you need both modes, preconnect twice.
- Why: A preconnect without `crossorigin` opens a connection in the wrong credentials mode, so the CORS font fetch opens a new connection anyway.
- Example:
  ```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  ```
- Avoid/caveats: Unused preconnects close after about 10 s (older web.dev article, 2019) and waste sockets and CPU. Too many cause contention. The best fix is to serve critical assets from your own origin.
- Status: Baseline widely available (low 2020-01-15). Chrome 46, Firefox 39, Safari 11.1 (web-features `link-rel-preconnect`).
- Sources: https://web.dev/learn/performance/resource-hints, https://web.dev/articles/preconnect-and-dns-prefetch

### Use dns-prefetch for less critical or probable origins, in a separate link tag
- Layer: html
- Stage: network
- Metrics: LCP
- When: load
- Impact: low. It saves a DNS lookup (about 20–120 ms) at very low cost.
- Do: Use `dns-prefetch` for third-party origins you may contact later (secondary widgets, outbound links the user will likely follow). When you pair it with `preconnect` as a fallback, use two separate `<link>` tags.
- Why: DNS resolution costs little but is not free. Putting `preconnect dns-prefetch` in one `rel` caused Safari to cancel the preconnect (per web.dev).
- Example:
  ```html
  <link rel="preconnect" href="https://api.example-data.com">
  <link rel="dns-prefetch" href="https://api.example-data.com">
  ```
- Avoid/caveats: Tools such as dnstradamus add dns-prefetch for outbound links when they scroll into view (Intersection Observer).
- Status: Baseline newly available since 2025-09-15. Firefox gained HTTPS-page support in 127, and iOS Safari support came in 26 (web-features `link-rel-dns-prefetch`, BCD).
- Sources: https://web.dev/learn/performance/resource-hints, https://web.dev/articles/preconnect-and-dns-prefetch

### Preload only late-discovered critical resources
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP, FCP
- When: load
- Impact: high. It removes the discovery delay for fonts, CSS background LCP images, `@import`ed CSS and JS-inserted LCP images.
- Do: Add `<link rel="preload">` only for resources that the page needs now and that the HTML parser or scanner cannot see. Keep the list short.
- Why: Preload is a mandatory fetch that starts at parse time. It does not wait for the CSS or JS that references the resource.
- Example:
  ```html
  <link rel="preload" href="/img/hero-bg.avif" as="image" type="image/avif" fetchpriority="high">
  ```
- Avoid/caveats: Preloaded resources get high priority for most `as` types and compete for bandwidth. When everything has priority, nothing does. A preload that the page does not use wastes bytes. If the resource is already in the markup, let the scanner find it.
- Status: Baseline widely available (low 2021-01-26). Chrome 50, Firefox 85, Safari 11.1 (web-features `link-rel-preload`).
- Sources: https://web.dev/learn/performance/resource-hints, https://web.dev/articles/preload-scanner

### Always set as, and set crossorigin for fonts and fetch preloads
- Layer: html
- Stage: network
- Metrics: LCP, bundle-size
- When: load
- Impact: high. A wrong or missing attribute makes the browser download the resource twice.
- Do: Set `as` to one of `fetch`, `font`, `image`, `script`, `style`, `track`. Add `crossorigin` for `as="font"` (even same-origin) and `as="fetch"`, and leave it off for non-CORS loads. Add `type` so browsers skip formats they do not support.
- Why: The preload cache entry must match the later request's destination and CORS mode. A mismatch causes a second fetch. Without `as`, the resource is also downloaded twice.
- Example:
  ```html
  <link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
  <!-- a WASM or JSON file a charting lib fetches at runtime -->
  <link rel="preload" href="/wasm/engine.wasm" as="fetch" crossorigin>
  ```
- Avoid/caveats: `as="track"` is not supported in Firefox (BCD). The `crossorigin` value must match how the code later fetches the file. Check DevTools for duplicate requests.
- Status: `as` values fetch, font, image, script, style: Chrome 50, Firefox 85, Safari 11.1 (BCD `html.elements.link.rel.preload.*`).
- Sources: https://web.dev/learn/performance/resource-hints, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload

### Add fetchpriority="high" to image preloads that are LCP candidates
- Layer: html
- Stage: network
- Metrics: LCP
- When: load
- Impact: high. Preload fixes discovery but not priority, and image preloads start at Low or Medium.
- Do: Put `fetchpriority="high"` on every `rel=preload as=image` for an LCP candidate, including CSS background heroes and video posters.
- Why: A preload gets the default priority of its `as` destination, which is low for images. In Chrome, images start Low. The first five large images (> 10,000 px²) are Medium since Chrome 117, and in-viewport images rise to High only after layout.
- Example:
  ```html
  <link rel="preload" as="image" href="/img/hero.webp" fetchpriority="high">
  ```
- Avoid/caveats: Use it on one or two images at most.
- Status: `fetchpriority` is Baseline newly available since 2024-10-29. Chrome 101/102, Firefox 132, Safari 17.2 (web-features `fetch-priority`).
- Sources: https://web.dev/learn/performance/resource-hints, https://web.dev/articles/preload-responsive-images, https://web.dev/articles/fetch-priority

### Preload responsive images with imagesrcset and imagesizes, and no href
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP, bundle-size
- When: load
- Impact: medium. Without it, the preload fetches the wrong size, or fetches twice.
- Do: Copy the `<img>`'s `srcset`/`sizes` into `imagesrcset`/`imagesizes` on the preload. Leave out `href` so browsers without support do not fetch a fallback. For `<picture>` art direction, write one preload per source with media queries that do not overlap. For format fallbacks, preload only the preferred type, with `type`.
- Why: Responsive preload uses the same selection logic as `srcset`. Preload has no "first match wins" rule, so overlapping media or several types all download.
- Example:
  ```html
  <link rel="preload" as="image" fetchpriority="high"
        imagesrcset="/img/hero-640.avif 640w, /img/hero-1280.avif 1280w"
        imagesizes="100vw" type="image/avif">
  <link rel="preload" as="image" href="/img/banner-narrow.webp" media="(max-width: 600px)">
  <link rel="preload" as="image" href="/img/banner-wide.webp" media="(min-width: 600.1px)">
  ```
- Avoid/caveats: Do not preload responsive images from a `Link` HTTP header or 103 Early Hints: the viewport is not known yet. A late `<meta name="viewport">` can also make the wrong candidate load. If the `<picture>` is already in the HTML, skip the preload and use `fetchpriority` on the `<img>`.
- Status: `imagesrcset`/`imagesizes` are Baseline widely available (low 2023-12-11, high 2026-06-11). Chrome 73, Firefox 78, Safari 17.2 (web-features `preloading-responsive-images`).
- Sources: https://web.dev/learn/performance/resource-hints, https://web.dev/articles/preload-responsive-images

### Place preloads deliberately in the head
- Layer: html
- Stage: html-parse, network
- Metrics: LCP, FCP
- When: load
- Impact: low. Order decides when a preload is issued relative to CSS and scripts.
- Do: Put image preloads after the stylesheet links so they do not delay them. Put font preloads toward the end of `<head>`. Put `modulepreload` for dynamic imports after the script that needs them. Remember that preloads in HTTP headers come before everything else.
- Why: Preloads at Medium or higher priority are issued in parser order. Resources with equal priority load in discovery order.
- Example: n/a
- Avoid/caveats: Many preloads at the very top of `<head>` can delay render-blocking CSS.
- Status: `modulepreload` is Baseline widely available (high 2026-03-18).
- Sources: https://web.dev/articles/fetch-priority, https://web.dev/articles/preload-scanner

### Mark the likely LCP image fetchpriority="high" and hidden above-the-fold images low
- Layer: html
- Stage: network
- Metrics: LCP
- When: load
- Impact: high. In a web.dev test on Google Flights, LCP went from 2.6 s to 1.9 s.
- Do: Add `fetchpriority="high"` to the one image that is most likely the LCP element. Add `fetchpriority="low"` to images in the first viewport that are not visible at start (carousel slides 2+, collapsed tabs).
- Why: The browser starts the LCP image at High during the first "tight" phase instead of waiting for layout to raise it. Lowering the others gives bandwidth to what matters.
- Example:
  ```html
  <img src="/img/slide-1.avif" fetchpriority="high" width="1200" height="500" alt="">
  <img src="/img/slide-2.avif" fetchpriority="low" width="1200" height="500" alt="">
  ```
- Avoid/caveats: It is a hint, not an order. High priority on more than one or two images cancels the effect. Carousel slides near the viewport can load even with `loading=lazy`, so `fetchpriority=low` is the right tool for them. The effect is smaller when CDNs ignore HTTP/2 or HTTP/3 priorities, but the browser-internal ordering still applies.
- Status: Baseline 2024 (see above).
- Sources: https://web.dev/learn/performance/resource-hints, https://web.dev/articles/fetch-priority, https://web.dev/articles/optimize-lcp

### Reprioritize scripts with fetchpriority instead of preload hacks
- Layer: html
- Stage: network, script-run
- Metrics: INP, LCP, startup
- When: load
- Impact: medium. `async`/`defer` scripts are Low priority by default.
- Do: Use `<script async fetchpriority="high">` for important scripts that do not block. Use `fetchpriority="low"` on late, unimportant blocking scripts or preloads.
- Why: Fetch priority raises or lowers the computed priority relatively. Before it existed, people used a preload to raise an async script's priority, which competes with CSS.
- Example:
  ```html
  <script src="/js/order-entry.js" async fetchpriority="high"></script>
  <link rel="preload" as="script" href="/js/help-widget.js" fetchpriority="low">
  ```
- Avoid/caveats: Early head CSS stays Highest even with `fetchpriority=high`, and drops only to High with `low`. The value is relative, not absolute.
- Status: Baseline 2024.
- Sources: https://web.dev/articles/fetch-priority

### Give fetch() calls explicit priority: high for user-driven data, low for background data
- Layer: js
- Stage: network
- Metrics: INP, LCP
- When: interaction
- Impact: medium. By default every `fetch()` is High, so background polling competes with interactive requests.
- Do: Pass `{ priority: 'low' }` for prefetches, analytics, "suggested" panels and background refreshes. Leave the high default for requests the user is waiting for (order submit, symbol switch).
- Why: The priority option feeds the same browser scheduler and HTTP/2/3 priority signals as the HTML attribute.
- Example:
  ```js
  const book = await fetch(`/api/book/${sym}`);                        // user is waiting
  fetch('/api/news/related?sym=' + sym, { priority: 'low' });           // can wait
  ```
- Avoid/caveats: It is a hint. It does nothing where there is no contention.
- Status: `fetch` / `Request` `priority` option: Chrome 101, Firefox 132, Safari 17.2 (BCD `api.fetch.options_parameter.priority`).
- Sources: https://web.dev/articles/fetch-priority

### Prefetch next-navigation resources only for high-confidence flows, and respect Save-Data
- Layer: html
- Stage: network, idle
- Metrics: LCP, TTFB
- When: load
- Impact: low. It helps the next page but can waste user data.
- Do: Use `<link rel="prefetch" href as>` for resources of a page that most users visit next (from analytics). Skip it when the user prefers reduced data (`Save-Data: on` request header or `navigator.connection.saveData`).
- Why: Prefetch runs at Lowest priority and fills the HTTP cache for a future navigation.
- Example:
  ```js
  if (!navigator.connection?.saveData) {
    const l = document.createElement('link');
    l.rel = 'prefetch'; l.href = '/js/portfolio.chunk.js'; l.as = 'script';
    document.head.append(l);
  }
  ```
- Avoid/caveats: Prefetched bytes that are never used are wasted. For whole-page prefetch or prerender, see the Speculation Rules notes (part B).
- Status: `rel=prefetch` is not Baseline: Chrome and Firefox yes, Safari only behind a flag (BCD). Save-Data is Chromium-only (web-features `savedata`).
- Sources: https://web.dev/learn/performance/resource-hints

### Send critical hints as HTTP Link headers or 103 Early Hints when HTML is slow
- Layer: network
- Stage: network
- Metrics: TTFB, FCP, LCP
- When: load
- Impact: medium. The browser can preconnect or preload while the server is still building the HTML.
- Do: Send `Link: <https://cdn.example>; rel=preconnect` and `Link: </css/app.css>; rel=preload; as=style` headers, or send them early in a `103 Early Hints` response.
- Why: Header hints are processed before any HTML arrives. A header preload goes first in the load order.
- Example:
  ```http
  HTTP/1.1 103 Early Hints
  Link: </css/app.css>; rel=preload; as=style
  Link: <https://img.example-cdn.com>; rel=preconnect
  ```
- Avoid/caveats: Do not preload responsive images this way (the viewport is unknown). Safari handles preconnect in 103 but not preload.
- Status: 103: Chrome 103, Firefox 120 (preload in 103 since 123), Safari 17 (no preload in 103) (BCD `http.status.103`). `fetchpriority` in a Link header: Chrome 103, Firefox 132, Safari 17.2.
- Sources: https://web.dev/learn/performance/resource-hints, https://web.dev/articles/preload-responsive-images, https://web.dev/articles/fetch-priority

---

## Module: Image performance

### Serve images at display size times DPR, and cap at about 2x
- Layer: html
- Stage: network, raster, gpu-upload
- Metrics: LCP, bundle-size, memory
- When: load
- Impact: high. Oversized images waste bytes, decode time and memory.
- Do: Make the intrinsic width about CSS width × `devicePixelRatio`. Cap high-DPR candidates at about 2x, because most people cannot see the gain from 3x.
- Why: A 500 CSS-px slot needs 1000 px at DPR 2. Anything larger is transferred and decoded for nothing.
- Example: n/a
- Avoid/caveats: The same rule applies to canvas and WebGL textures: do not upload textures larger than the drawn size × DPR (my application, not from the course).
- Status: n/a.
- Sources: https://web.dev/learn/performance/image-performance

### Use srcset width descriptors together with sizes for fluid images
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP, bundle-size
- When: load
- Impact: high. It lets the browser pick the smallest adequate file before layout.
- Do: List candidates with `w` descriptors and always add `sizes` that describe the slot width per breakpoint. For lazy images, `sizes="auto"` lets the browser use the laid-out width.
- Why: The browser multiplies the `sizes` slot width by DPR and picks the closest candidate. `w` descriptors without `sizes` default to `100vw`, which picks candidates that are too large.
- Example:
  ```html
  <img src="/img/card-400.webp"
       srcset="/img/card-400.webp 400w, /img/card-800.webp 800w, /img/card-1200.webp 1200w"
       sizes="(min-width: 1024px) 400px, 50vw" width="400" height="300" alt="">
  <img loading="lazy" sizes="auto" srcset="…" width="400" height="300" alt="">
  ```
- Avoid/caveats: `srcset` is a hint. The browser may choose differently (for example, on Save-Data).
- Status: srcset/sizes are Baseline widely available (2017). `sizes="auto"` is not Baseline: Chrome 126, Firefox 150, no Safari (web-features `sizes-auto`).
- Sources: https://web.dev/learn/performance/image-performance

### Use x descriptors for images that have a fixed CSS size
- Layer: html
- Stage: network
- Metrics: LCP, bundle-size
- When: load
- Impact: medium. It is the simplest correct markup when the slot size never changes.
- Do: Use `1x/2x` candidates when the image has the same CSS size on every viewport (logos, avatars, fixed thumbnails).
- Why: Only DPR changes, so a density descriptor is enough.
- Example:
  ```html
  <img src="/img/logo-120.png" srcset="/img/logo-120.png 1x, /img/logo-240.png 2x" width="120" height="32" alt="Logo">
  ```
- Avoid/caveats: Do not mix x and w descriptors in one `srcset`.
- Status: Baseline widely available.
- Sources: https://web.dev/learn/performance/image-performance

### Serve AVIF and WebP with a legacy fallback through picture type sources
- Layer: html
- Stage: network, raster
- Metrics: LCP, bundle-size
- When: load
- Impact: high. AVIF can be more than 50% smaller than JPEG, and WebP beats JPEG, PNG and GIF with alpha even in lossy mode.
- Do: Put `<source type="image/avif">` first, then `image/webp`, then the `<img>` fallback. Put `alt`, `width`, `height`, `loading` and `fetchpriority` on the inner `<img>`.
- Why: The browser takes the first `<source>` whose type it supports, so the order sets the preference.
- Example:
  ```html
  <picture>
    <source type="image/avif" srcset="/img/pnl.avif">
    <source type="image/webp" srcset="/img/pnl.webp">
    <img src="/img/pnl.jpg" width="800" height="450" alt="P&L summary">
  </picture>
  ```
- Avoid/caveats: Each format multiplies the variants you must build and cache. AVIF encoding is slow, so build it offline or with an image CDN.
- Status: AVIF is Baseline widely available (low 2024-01-25, high 2026-07-25). WebP is widely available (2020). `<picture>` is widely available (web-features `avif`, `webp`, `picture`).
- Sources: https://web.dev/learn/performance/image-performance, https://caniuse.com/avif, https://caniuse.com/webp

### Use picture media sources to cap sizes on small screens or to art-direct
- Layer: html
- Stage: network
- Metrics: LCP, bundle-size
- When: load
- Impact: medium. It stops 3x phones from downloading desktop-sized images.
- Do: Use `<source media="…">` when you need a hard rule. `media` is a command the browser must follow, while `srcset` is only a hint. For example, limit phones to 1x/2x files, or serve more compressed "-sm" variants at high DPR on narrow screens.
- Why: The browser must follow the first matching `media`, so you control the worst case.
- Example:
  ```html
  <picture>
    <source media="(max-width: 560px)" srcset="/img/h-500.jpg 1x, /img/h-1000.jpg 2x">
    <source media="(min-width: 561px)" srcset="/img/h-500.jpg 1x, /img/h-1000.jpg 2x, /img/h-1500.jpg 3x">
    <img src="/img/h-500.jpg" width="500" height="500" alt="">
  </picture>
  ```
- Avoid/caveats: Every source adds HTML bytes and cache variants.
- Status: Baseline widely available.
- Sources: https://web.dev/learn/performance/image-performance

### Negotiate the image format on the server with Accept and Vary, or use an image CDN
- Layer: network
- Stage: network
- Metrics: LCP, bundle-size
- When: load
- Impact: medium. You get the best format without extra HTML bytes per image.
- Do: Read the request `Accept` header and return AVIF, then WebP, then JPEG from one URL. Send `Vary: Accept` so shared caches store each variant. Or use an image CDN, ideally proxied through your own origin to avoid an extra connection.
- Why: The HTML stays small and the server picks the format.
- Example:
  ```js
  const a = req.headers.accept ?? '';
  const ext = a.includes('image/avif') ? 'avif' : a.includes('image/webp') ? 'webp' : 'jpg';
  res.setHeader('Vary', 'Accept');
  return sendFile(`${base}.${ext}`);
  ```
- Avoid/caveats: `Vary: Accept` splits cache keys, because Accept strings differ between browsers. Normalize the key at the CDN. A third-party image CDN domain costs a connection. Prefer a same-origin proxy (optimize-lcp).
- Status: HTTP, universal.
- Sources: https://web.dev/learn/performance/image-performance, https://web.dev/articles/optimize-lcp

### Keep the number of image variants small
- Layer: build
- Stage: network
- Metrics: LCP, bundle-size
- When: build
- Impact: low. Too many variants reduce cache hits and bloat HTML.
- Do: Create only as many size and format variants as the layout needs. A full-width hero may need several, and a small thumbnail one or two. Measure the effect.
- Why: Every variant is a separate cache entry at the CDN and in the browser, and every candidate adds bytes to the HTML.
- Example: n/a
- Avoid/caveats: Expired variants that must go back to the origin can be slower than one shared, well-cached file.
- Status: n/a.
- Sources: https://web.dev/learn/performance/image-performance

### Choose lossy or lossless per image and tune quality by eye
- Layer: build
- Stage: network
- Metrics: LCP, bundle-size
- When: build
- Impact: medium. The right codec mode often halves the size.
- Do: Use lossy (JPEG, WebP, AVIF) for photos and noisy images. Use lossless (PNG, WebP, AVIF, GIF) or SVG for sharp line art and text. Try several quality levels (Squoosh, ImageOptim, a pipeline) and check for chroma-subsampling artifacts on colored text.
- Why: Lossy artifacts hide in detailed images but show on sharp edges.
- Example: n/a
- Avoid/caveats: No single quality setting fits all images.
- Status: n/a.
- Sources: https://web.dev/learn/performance/image-performance

### Use SVG for line art, diagrams and charts, and optimize it like text
- Layer: build
- Stage: network, paint
- Metrics: bundle-size, LCP
- When: build
- Impact: medium. Vector art is tiny and sharp at any DPR.
- Do: Use SVG for icons, logos, diagrams and chart thumbnails. Run svgo and serve with Brotli or gzip.
- Why: SVG is text, so minification and compression work well on it. It has no per-DPR variants.
- Example: n/a
- Avoid/caveats: Very complex SVGs (thousands of paths) can cost more to paint than a raster image. Inline SVG adds to HTML size and is not cached.
- Status: n/a.
- Sources: https://web.dev/learn/performance/image-performance

### Lazy-load offscreen images natively, and never the LCP image
- Layer: html
- Stage: network, idle
- Metrics: LCP, bundle-size
- When: load
- Impact: high. It saves bandwidth for first-view resources.
- Do: Add `loading="lazy"` to images and iframes below the first viewport. Never put it on the LCP or first-view images.
- Why: The browser delays the request until the element is near the viewport. On an LCP image, that delay waits for layout and always makes LCP worse.
- Example:
  ```html
  <img src="/img/footer-promo.webp" loading="lazy" width="600" height="200" alt="">
  ```
- Avoid/caveats: For more detail (thresholds, iframes, facades), see the lazy-loading module notes (part B).
- Status: Baseline widely available (low 2023-12-19, high 2026-06-19). img: Chrome 77, Firefox 75, Safari 15.4. iframe: Firefox 121, Safari 16.4 (web-features `loading-lazy`).
- Sources: https://web.dev/learn/performance/image-performance, https://web.dev/articles/optimize-lcp

### Decode images that JS inserts with img.decode() before you attach them
- Layer: js
- Stage: raster, main-thread-task
- Metrics: FPS/smoothness, LCP
- When: interaction
- Impact: low. Its effect shows mainly on very large, high-resolution images.
- Do: For images you insert with JS, set `src`, `await img.decode()`, then append. Use the `decoding` attribute only as a micro-optimization (`async` for large offscreen images).
- Why: `decode()` decodes the image before it reaches the DOM, so rendering neither stalls nor shows an empty box.
- Example:
  ```js
  const img = new Image();
  img.src = url;
  await img.decode();
  thumbStrip.append(img);
  ```
- Avoid/caveats: `decoding="async"` on JS-inserted or LCP images can show a flash of the background before the pixels appear. Defaults differ: Chrome and Safari behave like `sync`, Firefox like `async` (per a tunetheweb.com blog, not a spec source).
- Status: `decoding` attribute: Chrome 65, Firefox 63, Safari 11.1. `decode()`: Chrome 64, Firefox 68, Safari 11.1 (BCD). Both widely available.
- Sources: https://web.dev/learn/performance/image-performance, https://www.tunetheweb.com/blog/what-does-the-image-decoding-attribute-actually-do/

---

## Module: Video performance

### Re-encode video with a modern codec, strip unused audio, and tune CRF
- Layer: build
- Stage: network
- Metrics: LCP, bundle-size
- When: build
- Impact: high. Video bytes are large, and the defaults are rarely optimal.
- Do: Transcode sources with FFmpeg (for example to WebM/VP9 or AV1, plus an MP4/H.264 fallback). Remove the audio stream with `-an` when the video has no sound (GIF replacements, backgrounds). Set quality with `-crf` for the codec.
- Why: The container (`.mp4`, `.webm`) holds streams, and the codec compresses each stream. A silent audio track still costs bytes.
- Example:
  ```sh
  ffmpeg -i demo.mov -an -c:v libvpx-vp9 -crf 34 -b:v 0 demo.webm
  ffmpeg -i demo.mov -an -c:v libx264 -crf 24 -movflags +faststart demo.mp4
  ```
- Avoid/caveats: CRF ranges differ by codec (see the FFmpeg H.264 and VP9 guides). `+faststart` (my addition) moves metadata to the front so playback can start before the full download.
- Status: n/a.
- Sources: https://web.dev/learn/performance/video-performance

### List video sources most-efficient first, with a codecs-qualified type
- Layer: html
- Stage: network
- Metrics: LCP, bundle-size
- When: load
- Impact: medium. The browser takes the first playable source, so order and type decide the bytes.
- Do: Put the most efficient format first and MP4/H.264 last as the universal fallback. Add a `codecs` parameter to `type` so browsers that cannot decode AV1 skip it without downloading it.
- Why: Source order is priority. If MP4 comes first, every browser picks it.
- Example:
  ```html
  <video controls preload="none" poster="/img/intro-poster.webp" width="1280" height="720">
    <source src="/v/intro.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"'>
    <source src="/v/intro.webm" type='video/webm; codecs="vp9"'>
    <source src="/v/intro.h264.mp4" type="video/mp4">
  </video>
  ```
- Avoid/caveats: Safari decodes AV1 only on devices with a hardware decoder, and Safari's WebM has no alpha transparency (caniuse notes).
- Status: H.264/MP4 in all browsers. WebM is full in current Safari (no alpha). AV1 is partial in Safari (hardware only) (caniuse `av1`, `webm`, `mpeg4`).
- Sources: https://web.dev/learn/performance/video-performance, https://caniuse.com/av1, https://caniuse.com/webm

### Replace animated GIFs with muted, looping, inline autoplay video
- Layer: html
- Stage: network, raster
- Metrics: LCP, bundle-size
- When: load
- Impact: high. Animated GIFs are often several MB, and the video version is much smaller.
- Do: Use `<video autoplay muted loop playsinline>` with the sources above instead of a GIF or another animated image format.
- Why: Video codecs compress motion far better than GIF. `muted` and `playsinline` are needed for browser autoplay policies, especially on iOS.
- Example:
  ```html
  <video autoplay muted loop playsinline width="480" height="270">
    <source src="/v/tip.webm" type="video/webm"><source src="/v/tip.mp4" type="video/mp4">
  </video>
  ```
- Avoid/caveats: Autoplaying video with sound is jarring, and autoplay policies block it. Use autoplay only when the user expects it.
- Status: widely available. `playsinline`: Chrome 75, Safari 10 (Firefox does not need it) (BCD).
- Sources: https://web.dev/learn/performance/video-performance

### Lazy-load below-the-fold autoplay videos with a poster and IntersectionObserver
- Layer: js
- Stage: network, idle
- Metrics: LCP, bundle-size
- When: load
- Impact: medium. An `autoplay` video starts downloading at once, even outside the viewport.
- Do: For offscreen autoplay videos, render a `poster` (for example, a small first-frame image) and attach sources or call `load()` and `play()` only when an IntersectionObserver reports visibility.
- Why: It moves video bytes out of the startup phase.
- Example:
  ```js
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) {
      const v = e.target;
      for (const s of v.querySelectorAll('source[data-src]')) s.src = s.dataset.src;
      v.load(); v.play(); io.unobserve(v);
    }
  });
  document.querySelectorAll('video.lazy').forEach(v => io.observe(v));
  ```
- Avoid/caveats: Users see the poster briefly before playback. Do not do this for first-view videos. Where supported, native `loading="lazy"` replaces this code (next items).
- Status: IntersectionObserver is Baseline widely available.
- Sources: https://web.dev/learn/performance/video-performance

### Use preload="none" or "metadata" plus a poster for click-to-play video
- Layer: html
- Stage: network
- Metrics: LCP, bundle-size
- When: load
- Impact: medium. By default the browser may start downloading video data when it parses `<video>`.
- Do: Set `preload="none"` (best for user-started playback) or `preload="metadata"` (duration and dimensions only), and add a `poster` for context.
- Why: Nothing, or only metadata, downloads until the user presses play.
- Example: `<video controls preload="none" poster="/img/webinar.webp" …>`
- Avoid/caveats: `preload` is only a hint. Browsers, and mobile versus desktop, may behave differently.
- Status: widely available.
- Sources: https://web.dev/learn/performance/video-performance

### Preload the video poster with high priority only when it is the LCP element
- Layer: html
- Stage: network
- Metrics: LCP
- When: load
- Impact: medium. The poster, or the first painted frame, is an LCP candidate.
- Do: If the video is the largest element in the first viewport, add `<link rel="preload" as="image" href="poster" fetchpriority="high">`. If it autoplays without a poster, make the first frame load fast (small first segment, fast start).
- Why: The poster is an image fetched at image priority. Since a Chromium fix, the first painted frame also counts for LCP.
- Example:
  ```html
  <link rel="preload" as="image" href="/img/hero-video-poster.avif" type="image/avif" fetchpriority="high">
  ```
- Avoid/caveats: If the video is not the LCP element, this preload takes bandwidth from the real LCP resource.
- Status: Baseline (preload, fetchpriority 2024).
- Sources: https://web.dev/learn/performance/video-performance

### Add loading="lazy" to below-the-fold video and audio as progressive enhancement
- Layer: html
- Stage: network, idle
- Metrics: LCP, bundle-size
- When: load
- Impact: medium. It defers the poster and preload/metadata fetches until the element is near the viewport, with no JS.
- Do: Add `loading="lazy"` to offscreen `<video>`/`<audio>` in addition to `preload="none"` or `metadata`. Keep a JS fallback only if browsers without support matter.
- Why: It works like image and iframe lazy loading: the browser uses network-aware distance thresholds and the preload scanner still sees the element.
- Example:
  ```html
  <video controls loading="lazy" preload="metadata" poster="/img/tutorial.webp" width="960" height="540">…</video>
  ```
- Avoid/caveats: Do not use it on first-view or LCP videos. Chrome 148–149 ignored it for `<source>` child elements (BCD note).
- Status: This is new since the course was first written (the module was updated 2026-04-02). Experimental and not Baseline: Chrome 148 partial (not for `<source>`), full in Chrome 150. Firefox and Safari have implementations in progress (BCD `html.elements.video.loading`, chromestatus 5200068565139456, Chrome 148 release notes). The spec is an open WHATWG HTML PR.
- Sources: https://web.dev/learn/performance/video-performance, https://chromestatus.com/feature/5200068565139456, https://developer.chrome.com/release-notes/148

### Put a facade in front of third-party video embeds
- Layer: html
- Stage: network, script-run, main-thread-task
- Metrics: INP, TBT, LCP
- When: load
- Impact: high. On the median site, YouTube embeds block the main thread for more than 1.7 s (HTTP Archive 2022).
- Do: Render a static thumbnail and play button. Load the real player iframe or script only when the user clicks.
- Why: Embedded players ship a lot of JS that competes with your own startup work.
- Example: n/a (see the lazy-loading module facades section, part B)
- Avoid/caveats: The first play needs an extra click and load delay. Preconnect to the player origin on hover or focus.
- Status: pattern.
- Sources: https://web.dev/learn/performance/video-performance

---

## Module: Optimize web fonts

### Inline @font-face declarations in the head so fonts are discovered early
- Layer: css
- Stage: cssom, network
- Metrics: FCP, LCP
- When: load
- Impact: medium. It removes the external-stylesheet hop before font discovery.
- Do: Put `@font-face` rules, and the critical rules that use them, in a `<style>` in `<head>`.
- Why: A font downloads only after the CSSOM shows that some rendered element uses it. In an external stylesheet, that happens only after the sheet arrives. Unlike preload, this downloads only fonts the page actually needs.
- Example:
  ```html
  <style>
    @font-face { font-family: "UI Mono"; src: url(/fonts/uimono-latin.woff2) format("woff2"); font-display: swap; }
    .price { font-family: "UI Mono", ui-monospace, monospace; }
  </style>
  ```
- Avoid/caveats: Fonts still wait for all render-blocking CSS, so an external sheet delays them even when `@font-face` is inline.
- Status: @font-face is widely available.
- Sources: https://web.dev/learn/performance/optimize-web-fonts, https://web.dev/articles/font-best-practices

### Preload only the one or two critical fonts, with as="font" and crossorigin
- Layer: html
- Stage: preload-scan, network
- Metrics: FCP, LCP, CLS
- When: load
- Impact: medium. A late-discovered font can become a fast one.
- Do: Preload the WOFF2 of the font used by first-view text, with `as="font" type="font/woff2" crossorigin`, even when it is same-origin.
- Why: Fonts are CORS resources. Without `crossorigin` the preload does not match and the font downloads twice.
- Example: `<link rel="preload" href="/fonts/uimono-latin.woff2" as="font" type="font/woff2" crossorigin>`
- Avoid/caveats: A preload downloads even when the page does not use the font, and it ignores `unicode-range`. It also takes bandwidth from other resources. Preload a single format only.
- Status: preload is Baseline widely available.
- Sources: https://web.dev/learn/performance/optimize-web-fonts, https://web.dev/articles/font-best-practices

### Never inline font files as base64
- Layer: build
- Stage: network, preload-scan
- Metrics: FCP, LCP
- When: build
- Impact: medium. Base64 is bigger than binary and delays everything behind it.
- Do: Serve fonts as separate cacheable `.woff2` files.
- Why: Base64 adds size, prevents independent caching, and slows the preload scanner (see the inlining item).
- Example: n/a
- Avoid/caveats: n/a
- Status: n/a.
- Sources: https://web.dev/learn/performance/optimize-web-fonts

### Self-host fonts on a fast CDN; if third-party, preconnect to both origins
- Layer: network
- Stage: network
- Metrics: FCP, LCP
- When: load
- Impact: medium. It removes one or two extra connections from the critical path.
- Do: Self-host fonts on your origin with CDN, HTTP/2 or HTTP/3 and long cache headers. If you use Google Fonts, preconnect to `fonts.googleapis.com` (CSS) and `fonts.gstatic.com` with `crossorigin` (font files), and load the CSS with `<link>`, not `@import`.
- Why: A third-party font needs a new connection before the CSS, and another before the files.
- Example: see the preconnect item.
- Avoid/caveats: Self-hosting helps only on a fast CDN with HTTP/2. The 2020 Web Almanac found third-party fonts rendered faster on average. When you self-host, you must also do the subsetting and WOFF2 compression yourself. Check the font license for self-hosting and subsetting.
- Status: n/a.
- Sources: https://web.dev/learn/performance/optimize-web-fonts, https://web.dev/articles/font-best-practices

### Serve WOFF2 only
- Layer: build
- Stage: network
- Metrics: FCP, LCP, bundle-size
- When: build
- Impact: medium. WOFF2 (Brotli-based) is up to 30% smaller than WOFF.
- Do: Ship a single `format("woff2")` source per face. Drop WOFF, TTF and EOT unless you must support very old browsers.
- Why: All current browsers support WOFF2. Extra formats add CSS and can cause wrong or double downloads.
- Example: `src: url(/fonts/inter-var.woff2) format("woff2");`
- Avoid/caveats: For very old browsers, prefer a system-font fallback over extra formats.
- Status: Chrome 36, Firefox 39, Safari 10 (macOS Sierra+), iOS 10 (caniuse `woff2`). Universal in current engines.
- Sources: https://web.dev/learn/performance/optimize-web-fonts, https://caniuse.com/woff2

### Subset fonts and map subsets with unicode-range
- Layer: build
- Stage: network
- Metrics: FCP, LCP, bundle-size
- When: build
- Impact: medium. Removing unused glyphs cuts file size a lot (CJK fonts can hold more than 10,000 glyphs).
- Do: Generate per-script subsets (for example latin, latin-ext, cyrillic) with glyphhanger or subfont, and declare each with `unicode-range`. For display fonts with very few characters, request only those characters (Google Fonts `text=` parameter).
- Why: The browser downloads a subset only if the page has characters in its range.
- Example:
  ```css
  @font-face { font-family: "Brand"; src: url(/fonts/brand-latin.woff2) format("woff2"); unicode-range: U+0000-00FF, U+2013-2014, U+20AC; }
  @font-face { font-family: "Brand"; src: url(/fonts/brand-cyr.woff2) format("woff2"); unicode-range: U+0400-04FF; }
  ```
- Avoid/caveats: Preloading a subset bypasses `unicode-range`. Numeric-only UIs (prices) can use very small subsets, but include every character they might show (minus signs, currency symbols, separators).
- Status: `unicode-range` is universal (BCD).
- Sources: https://web.dev/learn/performance/optimize-web-fonts, https://web.dev/articles/font-best-practices

### Choose font-display on purpose: optional for performance, swap for brand text
- Layer: css
- Stage: paint, layout
- Metrics: FCP, LCP, CLS
- When: load
- Impact: high. The default (`block`) hides text for up to about 3 s.
- Do: Set `font-display` on every `@font-face`. Use `optional` when performance and zero swap-shift matter most (body text). Use `swap` when the web font must show and you can deliver it early. Avoid `block` except for fonts where fallback glyphs make no sense.
- Why: The values set the block and swap periods. `block`: about 3 s block, then infinite swap. `swap`: 0 ms block. `fallback`: about 100 ms block, about 3 s swap. `optional`: about 100 ms block and no swap, so the font is used on a later visit from cache. Values other than `auto`/`block` keep text visible, so LCP does not wait for the font.
- Example:
  ```css
  @font-face { font-family: "Body"; src: url(/fonts/body.woff2) format("woff2"); font-display: optional; }
  ```
- Avoid/caveats: `swap`, `fallback`, `block` and `auto` can all shift layout when the font arrives. The course says Safari blocks forever, but WebKit's 2016 font-loading post says the invisible period is limited to 3 s. Treat all engines as about 3 s. Icon fonts shift badly with any strategy. Use SVG icons instead.
- Status: `font-display` is Baseline widely available (2020).
- Sources: https://web.dev/learn/performance/optimize-web-fonts, https://web.dev/articles/font-best-practices, https://webkit.org/blog/6643/improved-font-loading/

### Match fallback font metrics to cut swap layout shift
- Layer: css
- Stage: layout
- Metrics: CLS
- When: load
- Impact: medium. A metric-matched fallback makes a `swap` nearly invisible.
- Do: Declare a fallback `@font-face` over a local font with `size-adjust` (and `ascent-override`, `descent-override`, `line-gap-override` where supported), and list it right after the web font.
- Why: The fallback then uses the same line boxes and widths as the web font, so reflow on swap is small.
- Example:
  ```css
  @font-face { font-family: "Body Fallback"; src: local("Arial"); size-adjust: 104%; ascent-override: 92%; descent-override: 24%; }
  body { font-family: "Body", "Body Fallback", sans-serif; }
  ```
- Avoid/caveats: The values depend on the font pair. Generate them with a tool (framework font utilities or capsize-style calculators).
- Status: `size-adjust`: Chrome 92, Firefox 92, Safari 17. `ascent/descent/line-gap-override`: Chrome 87, Firefox 89, Safari only in Technology Preview (BCD). web-features `font-metric-overrides` is not Baseline.
- Sources: https://web.dev/articles/font-best-practices (links to https://web.dev/articles/css-size-adjust)

### Use fewer font files: system-ui, variable fonts, SVG icons
- Layer: css
- Stage: network
- Metrics: FCP, LCP, CLS
- When: build
- Impact: medium. A font you never request costs nothing.
- Do: Use `font-family: system-ui` for body UI text where the brand allows. Replace several static weights with one variable font when you use many weights. Replace icon fonts with inline or sprite SVG.
- Why: System fonts are already installed. One variable file can replace many static files.
- Example: `body { font-family: system-ui, sans-serif; }`
- Avoid/caveats: A variable font is larger than a single static style. It pays off only when you use several weights or styles. System fonts differ by OS, so check how numbers align in data tables (`font-variant-numeric: tabular-nums`).
- Status: `system-ui` is Baseline widely available (2021). `font-variation-settings` is widely available (2018) (web-features).
- Sources: https://web.dev/articles/font-best-practices

---

## Sources read
- https://web.dev/learn/performance/welcome (last updated 2023-11-27)
- https://web.dev/learn/performance/why-speed-matters (2023-11-01)
- https://web.dev/learn/performance/general-html-performance (2023-11-01)
- https://web.dev/learn/performance/understanding-the-critical-path (2023-11-27, skimmed for levers)
- https://web.dev/learn/performance/optimize-resource-loading (2023-11-01)
- https://web.dev/learn/performance/resource-hints (2023-11-01)
- https://web.dev/learn/performance/image-performance (2023-11-01)
- https://web.dev/learn/performance/video-performance (2026-04-02)
- https://web.dev/learn/performance/optimize-web-fonts (2023-11-01)
- https://web.dev/articles/fetch-priority (2023-11-14)
- https://web.dev/articles/preload-responsive-images (2026-07-10)
- https://web.dev/articles/preload-scanner (2022-05-13)
- https://web.dev/articles/font-best-practices (2022-10-04)
- https://web.dev/articles/optimize-lcp (2025-03-31)
- https://web.dev/articles/ttfb (2025-11-28)
- https://web.dev/articles/vitals (2024-10-31)
- https://web.dev/articles/preconnect-and-dns-prefetch (2019-07-30)
- https://developer.chrome.com/docs/web-platform/bfcache-ccns (search summary only)
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload
- https://webkit.org/blog/6643/improved-font-loading/
- https://www.tunetheweb.com/blog/what-does-the-image-decoding-attribute-actually-do/ (blog)
- https://chromestatus.com/feature/5200068565139456 (JSON API), https://chromestatus.com/feature/5696805480169472, https://chromestatus.com/feature/5452774595624960
- https://developer.chrome.com/release-notes/148, /149, /150
- https://cdn.jsdelivr.net/npm/web-features/data.json (v3.39.0)
- https://cdn.jsdelivr.net/npm/@mdn/browser-compat-data/data.json (v8.1.2, 2026-09-17)
- https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/{woff2,av1,webm,mpeg4,hevc}.json
- Raw copies: /private/tmp/claude-501/-Users-aleksandrgorodnichev-projects-tradester-1-tradester/94297743-fdaa-4fb8-9563-198f98f27bdb/scratchpad/web-performance-research/raw/course-loading/

## Not covered / could not access
- The course demos (embedded Glitch pages) were not run. The quiz sections carry no extra levers.
- Modules outside this part (code-split JS, lazy loading images and iframes, prefetch/prerender/precaching, web workers) are left to part B. They appear here only as cross-references.
- chromestatus HTML pages are rendered by JS and return no content to WebFetch. I used the chromestatus JSON API instead.
- The web.dev CSS size-adjust article, the Save-Data article, the Chrome autoplay policy pages and the FFmpeg CRF guides were not opened. Items that depend on them rely on the course text and BCD only.
- Conflict: for `<video loading>`, chromestatus and the Chrome 148 release notes say Chrome 148, and BCD says 148 was partial (no `<source>` support) with full support in 150. I recorded both.
- The claim that Chrome closes unused preconnects after about 10 s comes from a 2019 article and was not re-verified against current Chromium.
- The claim that combining `preconnect dns-prefetch` in one `rel` breaks Safari comes from the 2019 web.dev article and was not re-tested.
