# HTML and HTTP features that change how resources load or render (catalog, 2026-09)

Scope: every current HTML attribute, `<link rel>` value, HTTP header/status and small HTML-adjacent API that changes when or how the browser fetches, prioritizes, blocks on, renders, caches or restores resources. Support data comes from MDN browser-compat-data 8.1.2 (built 2026-09-17), web-features 3.39.0 and the webstatus.dev API (queried 2026-09-22), cross-checked with MDN, WHATWG HTML, developer.chrome.com, web.dev and webkit.org (Safari 27 release notes, 2026-09-14). Current stable at research time: Chrome 153 (154 beta), Firefox 156, Safari 27.
Reading guide: "Baseline YYYY" = Baseline newly available in that year (all of Chrome, Edge, Firefox, Safari). "Limited" = not in all engines. Items are grouped; each `###` is one rule.

---

## A. Scripts

### Never ship a parser-blocking `<script src>` in `<head>`: use `defer` or `type="module"`
- Layer: html
- Stage: html-parse, preload-scan, script-run, network
- Metrics: FCP, LCP, TBT
- When: load
- Impact: high, because a classic script without `async`/`defer` stops the parser until it is fetched and executed.
- Do: Mark every external classic script `defer` unless it must run before the rest of the document is parsed. Put `type="module"` scripts in `<head>` without `defer` (they are deferred by default). Keep script order only where you need it (`defer` keeps document order; `async` does not).
- Why: `defer` and `module` scripts download in parallel with parsing and run after parsing, before `DOMContentLoaded`. `defer` has no effect on inline classic scripts and no effect on module scripts (already deferred).
- Example:
  ```html
  <!-- Before: blocks the parser at this point -->
  <script src="/js/terminal.js"></script>
  <!-- After -->
  <script src="/js/terminal.js" defer></script>
  <script type="module" src="/js/chart-boot.js"></script>
  ```
- Avoid/caveats: A deferred script still delays `DOMContentLoaded`. Big deferred bundles still cost main-thread time after parse (TBT). If `async` and `defer` are both present, the element behaves as `async`.
- Status: Baseline since before 2015 (defer/async); JS modules Baseline 2018 (high 2020). Source: BCD `html.elements.script.defer`, web-features `js-modules`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script

### Use `async` only for independent scripts, and set their priority explicitly
- Layer: html
- Stage: network, script-run
- Metrics: LCP, TBT, INP
- When: load
- Impact: medium, because async scripts run as soon as they arrive (unordered) and get Low priority by default in Chrome.
- Do: Use `async` for scripts with no dependencies and no DOM-order needs (analytics, RUM, feature flags). Add `fetchpriority="high"` to an async script that the first interaction needs; add `fetchpriority="low"` to a late-body parser-blocking script that must stay blocking but is not important.
- Why: web.dev's Chrome priority table lists async/defer scripts at Low; `fetchpriority` moves them relative to other resources without making them blocking.
- Example:
  ```html
  <script src="/js/order-ticket.js" async fetchpriority="high"></script>
  <script src="/js/rum.js" async fetchpriority="low"></script>
  ```
- Avoid/caveats: `async` on an inline classic script has no effect. An async script can execute mid-parse and create a long task at a bad time; do not use it for large app bundles that depend on the DOM.
- Status: `async` Baseline (all browsers since before 2015); `fetchpriority` on `<script>` Baseline 2024 (Chrome 101, Firefox 132, Safari 17.2). Source: BCD `html.elements.script.fetchpriority`, webstatus `fetch-priority` (newly, 2024-10-29).
- Sources: https://web.dev/articles/fetch-priority, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script

### Drop `nomodule` fallback bundles
- Layer: html, build
- Stage: network, script-compile
- Metrics: bundle-size, startup
- When: build
- Impact: low, because no current browser downloads `nomodule` scripts, but the build and HTML stay more complex.
- Do: Ship one modern module build. Remove `<script nomodule>` and the legacy bundle unless your support matrix includes browsers older than Chrome 61 / Firefox 60 / Safari 11.
- Why: Browsers that support modules ignore `nomodule` scripts; modules are Baseline widely available since 2020, so the fallback only serves browsers that are gone.
- Example:
  ```html
  <!-- Before -->
  <script type="module" src="/app.mjs"></script>
  <script nomodule src="/app.legacy.js"></script>
  <!-- After -->
  <script type="module" src="/app.mjs"></script>
  ```
- Avoid/caveats: Check your real browser analytics before removal.
- Status: `nomodule` still standard, not deprecated; the need for it is obsolete. Source: BCD `html.elements.script.nomodule` (Chrome 61, Firefox 60, Safari 11), web-features `js-modules` (Baseline high 2020-11-09).
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script

### Add `blocking="render"` only when the first frame is wrong without that resource
- Layer: html
- Stage: html-parse, style, paint
- Metrics: FCP, LCP, CLS
- When: load
- Impact: medium, because it trades a later first paint for a correct first paint.
- Do: Use `blocking="render"` on a `<script>`, `<style>` or `<link rel="stylesheet">` in `<head>` only when content painted without it would flash or shift (for example an async module that registers a `pagereveal` listener for a cross-document view transition, or a stylesheet inserted by script that must apply before first paint). Measure FCP/LCP before and after.
- Why: Scripts are not render-blocking by default (a plain head script blocks parsing, not rendering). Only elements in `<head>` can block rendering. A stylesheet `<link>` added by script does not block rendering unless you set `blocking="render"`.
- Example:
  ```html
  <script type="module" src="/vt-setup.js" blocking="render"></script>
  ```
- Avoid/caveats: Every render-blocking resource delays FCP for all users. Firefox ignores the attribute, so the page must still work without blocking.
- Status: Limited. Chrome 105, Safari 18.2; Firefox no. Source: BCD `html.elements.{script,link,style}.blocking`, webstatus `blocking-render` (limited).
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/link, https://developer.chrome.com/docs/web-platform/view-transitions/cross-document

### Use `<link rel="expect" href="#id" blocking="render">` to hold first paint until a key element is parsed
- Layer: html
- Stage: html-parse, paint
- Metrics: FCP, CLS
- When: load (cross-document navigations)
- Impact: low, because it is Chromium-only and mainly for cross-document view transitions.
- Do: For an MPA with cross-document view transitions, add one `rel=expect` link per element that must exist in the DOM before the first frame. Point it at an element near the top of the document.
- Why: The HTML spec blocks rendering on an expect link while the indicated element is still open on the parser's stack; the element only has to be parsed, not loaded (an `<img>` counts once the tag is parsed). Rendering unblocks when the element is closed, or when parsing ends without finding it.
- Example:
  ```html
  <head>
    <link rel="expect" href="#instrument-header" blocking="render">
  </head>
  ```
- Avoid/caveats: Pointing it at an element far down the document delays FCP. Chrome's own docs warn to avoid render blocking unless you measure the Core Web Vitals impact.
- Status: Chrome 124 only (experimental in BCD); Firefox and Safari no. Source: BCD `html.elements.link.rel.expect`, webstatus `link-rel-expect`.
- Sources: https://html.spec.whatwg.org/multipage/links.html, https://developer.chrome.com/docs/web-platform/view-transitions/cross-document

---

## B. Resource hints (`<link rel>` and `Link:` header)

### Preconnect to at most a few critical cross-origin origins, with the correct `crossorigin`
- Layer: html, network
- Stage: network
- Metrics: LCP, FCP, TTFB (of the third-party request)
- When: load
- Impact: medium, because DNS+TCP+TLS can cost up to three round trips before the first byte of a cross-origin resource.
- Do: Add `<link rel="preconnect">` for 1-3 origins that the page will use within seconds (CDN for the LCP image, font host, market-data API host). Add `crossorigin` when the resources are fetched in CORS mode (fonts, `fetch()`, module scripts); if you need both CORS and no-CORS requests to the same origin, preconnect twice.
- Why: Preconnect does the connection handshake early; it has no benefit for same-origin requests. CORS and no-CORS requests use separate connections, so a preconnect without `crossorigin` does not help a font fetch.
- Example:
  ```html
  <link rel="preconnect" href="https://md.example-feed.com" crossorigin>
  <link rel="preconnect" href="https://img.example-cdn.com">
  ```
- Avoid/caveats: web.dev says Chrome closes a preconnected connection that stays unused for 10 seconds, and extra preconnects compete with critical requests. Do not preconnect to origins that are only used after user interaction.
- Status: Baseline widely available (Chrome 46, Firefox 39, Safari 11.1; high since 2022). Source: BCD `html.elements.link.rel.preconnect`, web-features `link-rel-preconnect`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preconnect, https://web.dev/articles/preconnect-and-dns-prefetch, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/103

### Use `dns-prefetch` for the other cross-origin origins, in a separate `<link>`
- Layer: html
- Stage: network
- Metrics: LCP, INP (first request after interaction)
- When: load
- Impact: low, because it saves only the DNS step (web.dev: typically 20-120 ms).
- Do: Use `<link rel="dns-prefetch">` for third-party origins you will probably contact but that are not worth a full preconnect. If you want both hints for one origin, write two `<link>` elements.
- Why: DNS resolution is the first part of every new connection; it is cheap to do early.
- Example:
  ```html
  <link rel="preconnect" href="https://api.example.com" crossorigin>
  <link rel="dns-prefetch" href="https://api.example.com">
  ```
- Avoid/caveats: web.dev reports that `rel="preconnect dns-prefetch"` in one tag makes Safari cancel the preconnect. No benefit for same-origin. The `X-DNS-Prefetch-Control` header is non-standard (no Safari).
- Status: Baseline 2025 (Safari iOS 26 and Firefox 127 completed support; newly available 2025-09-15). Source: web-features `link-rel-dns-prefetch`, BCD `html.elements.link.rel.dns-prefetch`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/dns-prefetch, https://web.dev/articles/preconnect-and-dns-prefetch

### Preload only critical resources that the preload scanner cannot see, with matching attributes
- Layer: html, network
- Stage: preload-scan, network
- Metrics: LCP, FCP, CLS (fonts)
- When: load
- Impact: high, because late-discovered LCP images, fonts and JS-requested files otherwise wait for CSS/JS to be parsed.
- Do: Preload fonts referenced from CSS, LCP images set as CSS backgrounds, and files requested by JS early in startup (JSON config, `.wasm`). Always set `as` (`fetch`, `font`, `image`, `script`, `style`, `track`). Add `crossorigin` for `as="font"` (always, even same-origin) and `as="fetch"`. Add `type` to skip unsupported formats and `media` to preload only for matching viewports.
- Why: A preload is a mandatory high-priority fetch into a per-document memory cache. `as` sets the priority, the `Accept` header and CSP checks, and lets the later real request match the preload. If the credentials mode, `as` or URL does not match, the browser fetches the file twice.
- Example:
  ```html
  <link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/wasm/chart-engine.wasm" as="fetch" crossorigin>
  <link rel="preload" href="/img/hero-narrow.avif" as="image" type="image/avif" media="(width <= 600px)">
  ```
- Avoid/caveats: Preloading resources the parser already finds early gives little gain and steals bandwidth. Do not preload several formats of one image (both get downloaded). web.dev: preloads in HTTP `Link` headers go before everything in the HTML, and preloads of Medium+ priority load in parser order, so place them deliberately. Unused preloads waste bytes.
- Status: Baseline widely available (Chrome 50, Firefox 85, Safari 11.1; high 2023). `as="track"`: not in Firefox. Source: BCD `html.elements.link.rel.preload.*`, web-features `link-rel-preload`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/link, https://web.dev/articles/fetch-priority

### Preload a responsive LCP image with `imagesrcset` and `imagesizes` that match the `<img>`
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP
- When: load
- Impact: medium, because a preload with a plain `href` downloads the wrong size or a second copy.
- Do: When you must preload a responsive image (for example a CSS background or an image injected by JS), copy the `srcset` and `sizes` of the real element into `imagesrcset` and `imagesizes`, and add `fetchpriority="high"`.
- Why: The browser picks the same candidate for the preload as for the element only if both describe the same candidate set.
- Example:
  ```html
  <link rel="preload" as="image" fetchpriority="high"
        imagesrcset="/img/hero-640.avif 640w, /img/hero-1280.avif 1280w"
        imagesizes="100vw">
  ```
- Avoid/caveats: Chrome says responsive-image preloads (`imagesrcset`, `imagesizes`, `media`) may not work from HTTP `Link` headers or 103 Early Hints, because the viewport is not known yet.
- Status: Baseline 2023 (Chrome 73, Firefox 78, Safari 17.2), Baseline widely available since 2026-06-11. Source: web-features `preloading-responsive-images`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/link, https://developer.chrome.com/docs/web-platform/early-hints, https://web.dev/articles/preload-scanner

### Use `modulepreload` to flatten the module dependency waterfall
- Layer: html, build
- Stage: network, script-compile
- Metrics: LCP, TBT, startup
- When: load
- Impact: medium, because without it each import level is discovered only after its parent is fetched and parsed.
- Do: Add `<link rel="modulepreload">` for the entry module and its static dependencies that are needed at startup (check what your bundler already emits). Use `crossorigin` values that match the later module load.
- Why: `modulepreload` fetches in CORS mode, then parses and compiles the module into the module map, so execution can start as soon as the graph is complete. Browsers may also fetch dependencies automatically, but only listing them guarantees it in all browsers.
- Example:
  ```html
  <link rel="modulepreload" href="/js/app.3f9a.js">
  <link rel="modulepreload" href="/js/chart-core.a41c.js">
  <script type="module" src="/js/app.3f9a.js"></script>
  ```
- Avoid/caveats: Preloading modules only needed after interaction (lazy routes, dialogs) wastes bandwidth and compile time. New: `as="json"` (Chrome 147, Safari 26.2) and `as="style"` (Chrome 147) preload JSON and CSS modules; other browsers fire an `error` event on unknown destinations.
- Status: Baseline 2023, Baseline widely available 2026-03-18 (Chrome 66, Firefox 115, Safari 17). Source: web-features `modulepreload`, BCD `html.elements.link.rel.modulepreload.*`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Speculative_loading

### Use `rel="prefetch"` only for subresources of the likely next page
- Layer: html
- Stage: network, idle
- Metrics: LCP (next page)
- When: load, idle
- Impact: low, because the fetch goes to the HTTP cache at lowest priority and Safari ignores it by default.
- Do: Prefetch same-site subresources (a route chunk, a stylesheet) that the next page will need. For whole documents, use Speculation Rules instead.
- Why: Prefetched responses land in the HTTP cache with `Sec-Purpose: prefetch`. They obey `Cache-Control` (`no-store`/`no-cache` can defeat them) and are partitioned by top-level site, so cross-site prefetch is useless.
- Example:
  ```html
  <link rel="prefetch" href="/js/route-portfolio.8c1d.js">
  ```
- Avoid/caveats: MDN: functionally like `fetch()` with `priority: "low"`, usually even lower. Requires a secure context in Chrome and Firefox.
- Status: Limited. Chrome 8, Firefox 2; Safari only behind the `LinkPrefetch` preference. Source: BCD `html.elements.link.rel.prefetch`, web-features `link-rel-prefetch`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/prefetch, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Speculative_loading

### Remove `<link rel="prerender">`; it is deprecated and does not prerender
- Layer: html
- Stage: network
- Metrics: LCP (next page)
- When: load
- Impact: low, because it only triggers a limited prefetch in Chrome and nothing elsewhere.
- Do: Replace every `rel="prerender"` with a Speculation Rules `prerender` or `prefetch` rule.
- Why: Chrome 63+ turns `rel=prerender` into NoState Prefetch (fetch the document and statically found subresources into the HTTP cache, no rendering, no JS-loaded subresources); it was never standardized and Chrome is sunsetting it.
- Example:
  ```html
  <!-- Before --><link rel="prerender" href="/markets">
  <!-- After -->
  <script type="speculationrules">{"prerender":[{"urls":["/markets"]}]}</script>
  ```
- Avoid/caveats: None; the old hint only costs bytes.
- Status: Deprecated, non-standard. Chrome 63+ partial (NoState Prefetch), no Firefox/Safari. Source: BCD `html.elements.link.rel.prerender`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/prerender, https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API

---

## C. Fetch priority

### Give the LCP image `fetchpriority="high"` and deprioritize competing images
- Layer: html
- Stage: network
- Metrics: LCP
- When: load
- Impact: high, because in Chrome images start at Low priority and are boosted only after layout finds them in the viewport.
- Do: Put `fetchpriority="high"` on exactly the LCP `<img>` (and on its preload, if any). Put `fetchpriority="low"` on above-the-fold images that do not matter at first (hidden carousel slides, decorative icons).
- Why: web.dev: Chrome starts images at Low, boosts in-viewport images to High after layout, and since Chrome 117 sets the first 5 large images to Medium; an explicit `high` starts at High immediately. Chrome DevTools' "LCP request discovery" insight checks that the LCP image is in the HTML (or preloaded), has `fetchpriority=high`, and is not lazy-loaded.
- Example:
  ```html
  <img src="/img/hero.avif" width="1200" height="600" fetchpriority="high" alt="">
  <img src="/img/slide-2.avif" width="1200" height="600" fetchpriority="low" alt="">
  ```
- Avoid/caveats: It is a hint, not a directive, and it changes priority relatively (critical CSS stays Highest even with `high`). Marking many resources `high` cancels the effect. CDNs do not apply HTTP/2 or HTTP/3 priorities uniformly, but the browser's internal scheduling still changes. The old `importance` attribute (Priority Hints origin trials, 2018 and 2021) is removed; use `fetchpriority`.
- Status: Baseline 2024 (Chrome 101/102, Firefox 132, Safari 17.2) for `<img>`, `<link>`, `<script>`; `Link:` header `fetchpriority` param same versions. No `fetchpriority` on `<iframe>`, `<video>` or CSS. SVG `<image>`/`<script>`/`<feImage>`: Firefox 140 only. Source: BCD `html.elements.img.fetchpriority`, `http.headers.Link.fetchpriority`, `svg.elements.image.fetchpriority`; webstatus `fetch-priority` newly 2024-10-29.
- Sources: https://web.dev/articles/fetch-priority, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/fetchpriority, https://developer.chrome.com/docs/performance/insights/lcp-discovery

### Set `priority` on `fetch()` so background requests do not compete with user-critical data
- Layer: js, network
- Stage: network
- Metrics: INP, LCP
- When: load, interaction, long-lived session
- Impact: medium, because `fetch()` defaults to High priority in Chrome.
- Do: Pass `{ priority: "low" }` for prefetch-like, analytics or "suggested content" requests; keep the default (or `"high"`) for data the user waits for (order status, the visible instrument's quotes).
- Why: Browser priority orders requests inside the browser and is sent to HTTP/2/3 servers; a low-priority request waits behind render-critical and interaction-critical requests.
- Example:
  ```ts
  const quote = await fetch(`/api/quote/${symbol}`); // default high
  void fetch('/api/news/related', { priority: 'low' });
  ```
- Avoid/caveats: Priority does not help when the connection is idle. For navigation documents, Speculation Rules prefetch is preferred over `fetch(..., {priority:"low"})` (it adapts to Save-Data/battery and uses a per-document cache).
- Status: Baseline 2024 (Chrome 101, Firefox 132, Safari 17.2). Source: BCD `api.fetch.options_parameter.priority`.
- Sources: https://web.dev/articles/fetch-priority, https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API

---

## D. Images, iframes and media

### Never lazy-load the LCP or first-viewport images; lazy-load everything below the fold
- Layer: html
- Stage: network, layout
- Metrics: LCP, bundle-size (bytes), memory
- When: load
- Impact: high, because `loading="lazy"` on a first-viewport image delays its fetch until layout, and missing `lazy` on long lists wastes bandwidth.
- Do: Leave first-viewport images at the default (eager). Add `loading="lazy"` to images that start outside the viewport; on `<picture>`, put it on the inner `<img>` only. Always pair it with `width` and `height`.
- Why: The browser cannot lazy-load an image until it knows its position. web.dev: Chrome loads lazy images when they are within about 1250 px (fast connections) or 2500 px (slow) of the viewport; since Chrome 121 horizontal carousels use the same thresholds; images with `display:none` (on the image or a parent) are not loaded in Chrome, Safari or Firefox, but `opacity:0` images are.
- Example:
  ```html
  <img src="/img/news-7.webp" width="320" height="180" loading="lazy" alt="">
  ```
- Avoid/caveats: Unloaded lazy images have 0x0 size without dimensions, so they cause layout shift and may never intersect. Lazy loading is off when JavaScript is disabled (anti-tracking). Do not replace native `loading="lazy"` with `data-src` JS loaders for first-viewport images (the preload scanner ignores `data-src`). Thresholds are hard-coded.
- Status: Baseline 2023 for img + iframe (widely available 2026-06-19); `<img loading>` Chrome 77, Firefox 75, Safari 15.4. Source: web-features `loading-lazy`.
- Sources: https://web.dev/articles/browser-level-image-lazy-loading, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img, https://web.dev/articles/preload-scanner

### Lazy-load offscreen iframes and put heavy embeds behind a facade
- Layer: html
- Stage: network, main-thread-task, memory
- Metrics: LCP, TBT, memory
- When: load
- Impact: medium, because each iframe loads a whole document with its own scripts (web.dev: a YouTube embed is about 500 KB).
- Do: Add `loading="lazy"` to every iframe that starts below the fold (videos, social embeds, third-party widgets). For very heavy embeds, render a static preview and create the iframe on click.
- Why: A lazy iframe is not fetched until it is near the viewport, so it does not compete with the main page or block the `load` event.
- Example:
  ```html
  <iframe src="https://widgets.example.com/econ-calendar" loading="lazy"
          width="400" height="600" title="Economic calendar"></iframe>
  ```
- Avoid/caveats: Do not lazy-load iframes that are visible at load. Hidden iframes used for messaging are lazy-loaded too if you add the attribute (the old automatic Data Saver exception does not apply to the attribute).
- Status: Baseline 2023 (Chrome 77, Firefox 121, Safari 16.4). Source: BCD `html.elements.iframe.loading`, web-features `loading-lazy`.
- Sources: https://web.dev/articles/iframe-lazy-loading, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe

### Use `sizes="auto"` on lazy images whose rendered width is only known after layout
- Layer: html
- Stage: layout, network
- Metrics: LCP (bytes), bundle-size (bytes)
- When: load
- Impact: medium, because a wrong `sizes` (default `100vw`) makes the browser download oversized candidates.
- Do: For `loading="lazy"` images with `w` descriptors, write `sizes="auto"` first and keep a fallback list after it for browsers without support. Set `width`/`height` to the intrinsic size of the largest candidate.
- Why: With `auto`, the browser uses the laid-out width of the element to pick the `srcset` candidate. It is only valid together with `loading="lazy"`, because layout information exists by the time a lazy image loads.
- Example:
  ```html
  <img loading="lazy" width="800" height="450"
       sizes="auto, (width <= 600px) 100vw, 400px"
       srcset="/img/c-400.webp 400w, /img/c-800.webp 800w, /img/c-1600.webp 1600w"
       src="/img/c-800.webp" alt="">
  ```
- Avoid/caveats: Useless on eager images (the LCP image). Without layout size the browser falls back to the source-size list, then to `width`/`height`, then to 300x150.
- Status: Chrome 126, Firefox 150; Safari 27.0 added it per the WebKit Safari 27 release notes (2026-09-14). BCD 8.1.2 and webstatus do not list Safari yet (BCD issue #30607), so expect Baseline 2026 once data updates. Source: BCD `html.elements.img.sizes.auto`, webstatus `sizes-auto`, webkit.org Safari 27 post.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img, https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

### Serve right-sized, modern-format images with `srcset`/`sizes` and `<picture><source type>`
- Layer: html, build
- Stage: network, raster (decode)
- Metrics: LCP, memory
- When: load, build
- Impact: high, because image bytes usually dominate page weight and decode cost scales with pixel count.
- Do: Use `w` descriptors plus `sizes` for fluid images, `x` descriptors for fixed-size images. Use `<picture>` with `<source type="image/avif">` then `image/webp` then a JPEG/PNG `<img>` fallback. Use `<source media>` only for art direction.
- Why: The browser picks the smallest candidate that satisfies layout width x device pixel ratio. With `w` descriptors `src` is ignored except as fallback. `type` lets the browser skip formats it cannot decode without downloading them.
- Example:
  ```html
  <picture>
    <source type="image/avif" srcset="/img/p-600.avif 600w, /img/p-1200.avif 1200w" sizes="(width <= 700px) 100vw, 600px">
    <img src="/img/p-1200.jpg" srcset="/img/p-600.jpg 600w, /img/p-1200.jpg 1200w"
         sizes="(width <= 700px) 100vw, 600px" width="1200" height="800" alt="">
  </picture>
  ```
- Avoid/caveats: Do not mix `w` and `x` descriptors in one `srcset`. `sizes` media conditions describe the viewport, and `em` is relative to the root font size. JPEG XL: Safari 17+ only; Chrome 145 behind a flag; do not rely on it without a fallback.
- Status: `srcset`/`sizes` Baseline widely available (2017); `<picture>` Baseline 2016; AVIF Baseline 2024 (widely available 2026-07-25); WebP Baseline 2020. Source: web-features `srcset`, `picture`, `avif`, `webp`, `jpegxl`; BCD `mediatypes.image.jxl`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload

### Always set `width` and `height` on `<img>`, `<video>` and `<source>` to reserve space
- Layer: html, css
- Stage: layout
- Metrics: CLS
- When: load
- Impact: high, because images and embeds without dimensions are a top cause of layout shift.
- Do: Put the intrinsic `width` and `height` (unitless) on every `<img>`/`<video>`, and CSS `img { max-width: 100%; height: auto; }`. In art-directed `<picture>`, put `width`/`height` on each `<source>` when aspect ratios differ. For ads/iframes/embeds use CSS `aspect-ratio` or `min-height`.
- Why: Browsers map the attributes to `aspect-ratio: auto W / H` before the image loads, so the box has the right height as soon as its width is known.
- Example:
  ```html
  <picture>
    <source media="(width < 800px)" srcset="/img/chart-sq.webp" width="600" height="600">
    <img src="/img/chart-wide.webp" width="1600" height="600" alt="">
  </picture>
  ```
- Avoid/caveats: All `srcset` candidates of one `<img>` should share one aspect ratio. Scroll anchoring (`overflow-anchor`, now in Safari 27; Baseline 2026-09-14) hides some shifts above the viewport but does not replace dimensions.
- Status: Aspect-ratio-from-attributes: Chrome 79, Firefox 71, Safari 15 (`<video>` Safari 14). `<source width/height>`: Chrome 90, Firefox 108, Safari 15. Source: BCD `html.elements.img.aspect_ratio_computed_from_attributes`, `html.elements.source.width`; web-features `overflow-anchor`.
- Sources: https://web.dev/articles/optimize-cls, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img, https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/

### Use `decoding="async"` and `img.decode()` so image decode never holds up a frame
- Layer: html, js
- Stage: raster, paint, main-thread-task
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: low on static pages, medium for images swapped at runtime (galleries, avatars, symbol logos in lists).
- Do: When you create or swap images from JS, set `src`, `await img.decode()`, then insert or swap. Use `decoding="async"` on large non-critical images so the next paint does not wait for decode. For canvas/WebGL textures, decode off the main thread with `createImageBitmap()` instead.
- Why: `decode()` resolves when the image is decoded and safe to append, so the frame that shows it does not stall on decoding. MDN notes that `decoding` rarely has a visible effect on static `<img>` tags.
- Example:
  ```ts
  const next = new Image();
  next.src = logoUrl;
  await next.decode().catch(() => {}); // EncodingError: fall back to normal load
  row.replaceChildren(next);
  ```
- Avoid/caveats: `decode()` rejects with `EncodingError` on network failure, `src` change, or corrupt data. Do not use `decoding="sync"` except to avoid a visible flash in tightly coordinated swaps. Safari 27 fixed spurious `decode()` resolution after adoption/`src` change.
- Status: `decode()` Baseline (Chrome 64, Firefox 68, Safari 11.1); `decoding` attribute Chrome 65, Firefox 63, Safari 11.1; `createImageBitmap` Baseline 2023 (widely available 2026-06-11). Source: BCD `api.HTMLImageElement.decode`, `html.elements.img.decoding`; web-features `createimagebitmap`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img, https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

### Lazy-load offscreen `<video>`/`<audio>` and keep `preload` minimal
- Layer: html
- Stage: network, memory
- Metrics: LCP, memory, bundle-size (bytes)
- When: load
- Impact: medium, because media files are large and eager media delays `load`.
- Do: Add `loading="lazy"` to offscreen `<video>` and `<audio>`. Set `preload="none"` (or `metadata`) on media that plays only on demand. For a first-viewport video that is the LCP element, give it a `poster` and preload that poster with `fetchpriority="high"`.
- Why: Chrome 148 added `loading` to media elements with the same behavior as `<img>`/`<iframe>`; lazy media no longer delays the `load` event. web.dev: for `<video>`, LCP uses the earlier of the poster load time and the first frame presentation time.
- Example:
  ```html
  <video src="/media/tutorial.mp4" loading="lazy" preload="none"
         poster="/img/tutorial.webp" width="1280" height="720" controls></video>
  ```
- Avoid/caveats: Chrome 148-149 did not apply `loading` to `<source>` children (fixed in 150). Other browsers ignore the attribute, so keep `preload="none"` as the cross-browser saving. `preload` default differs per browser.
- Status: Limited: Chrome 150 (148 partial); Firefox and Safari no. Source: BCD `html.elements.video.loading`, webstatus `loading-lazy-media` (Chrome 2026-06-30).
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video, https://developer.chrome.com/blog/new-in-chrome-148, https://web.dev/articles/lcp

### Keep critical resources discoverable by the preload scanner
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP, FCP
- When: load
- Impact: high, because the preload scanner reads raw HTML only; anything hidden in JS or CSS is found late.
- Do: Put the LCP image as a real `<img src/srcset>` in server HTML. Use normal `<script src defer>` instead of script-injected scripts for startup code. Preload CSS-background LCP images. Avoid client-side rendering of the first viewport.
- Why: The preload scanner does not read `data-src`, does not run JS and does not parse CSS for `url()`; resources referenced that way wait for the main parser, the CSS parser or JS execution.
- Example:
  ```html
  <!-- Before: invisible to the scanner -->
  <img data-src="/img/hero.avif" class="js-lazy">
  <!-- After -->
  <img src="/img/hero.avif" fetchpriority="high" width="1200" height="600" alt="">
  ```
- Avoid/caveats: SPA shells that render everything from JS defeat this entirely; server-render at least the first viewport.
- Status: Browser behavior, all engines. Safari 27 fixed several scanner bugs (`@import` after `@layer`, `<source type="">`, skipping disabled stylesheets).
- Sources: https://web.dev/articles/preload-scanner, https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

---

## E. Render-blocking CSS through HTML

### Put a `media` attribute on stylesheets that do not apply to the first render
- Layer: html
- Stage: cssom, paint, network
- Metrics: FCP, LCP
- When: load
- Impact: medium, because every matching `<link rel=stylesheet>` in `<head>` blocks rendering until it loads.
- Do: Split print, large-screen-only or orientation-only CSS into separate files with a matching `media` attribute. Give non-critical stylesheets `fetchpriority="low"`.
- Why: The HTML spec blocks rendering on a parser-created stylesheet link only if its `media` matches the environment. web.dev: Chrome loads non-matching stylesheets at the lowest priority.
- Example:
  ```html
  <link rel="stylesheet" href="/css/app.css">
  <link rel="stylesheet" href="/css/print.css" media="print">
  <link rel="stylesheet" href="/css/wide.css" media="(width >= 1600px)">
  ```
- Avoid/caveats: If the media query matches at load, the file is render-blocking again. A stylesheet inserted by script never blocks rendering unless it has `blocking="render"`.
- Status: `media` on `<link>` Baseline since the start. Source: BCD `html.elements.link.media`.
- Sources: https://html.spec.whatwg.org/multipage/links.html, https://web.dev/articles/fetch-priority, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/link

---

## F. Speculative navigation (Speculation Rules API)

### Prefetch likely next pages with document rules and `moderate` eagerness
- Layer: html
- Stage: network, idle
- Metrics: TTFB, LCP (next page)
- When: load, interaction
- Impact: high for MPAs, because the next document is already in memory when the user clicks; none for single-page app route changes.
- Do: Add a `<script type="speculationrules">` with a `prefetch` document rule (`where`) that matches safe same-site links and excludes logout, add-to-cart, language switch and other side-effect URLs. Use `"eagerness": "moderate"` (hover/pointerdown) as the default.
- Why: Speculation prefetch downloads the document response body (no subresources) into a per-document memory cache, can prefetch documents that are not HTTP-cacheable, and respects Save-Data and battery saver. Chrome keeps prefetches about 5 minutes. Cross-site prefetch works only if the user has no cookies for that site.
- Example:
  ```html
  <script type="speculationrules">
  {
    "prefetch": [{
      "where": { "and": [
        { "href_matches": "/*" },
        { "not": { "href_matches": "/logout" } },
        { "not": { "selector_matches": "[data-no-speculate]" } }
      ]},
      "eagerness": "moderate"
    }]
  }
  </script>
  ```
- Avoid/caveats: Speculation Rules target document navigations; they do not prefetch subresources and do nothing for client-side routing. Servers must not perform side effects on GET for prefetched URLs; watch `Sec-Purpose: prefetch` if needed. Feature-detect with `HTMLScriptElement.supports("speculationrules")` for JS insertion.
- Status: Limited. Chrome 109 (document rules, `eagerness`, `relative_to` 121; `tag` 136); Safari 26.2+ prefetch only, behind the "SpeculationRules prefetch" preference (conservative-only for document rules); Firefox no. Source: BCD `html.elements.script.type.speculationrules.*`, webstatus `speculation-rules` (limited).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/speculationrules, https://developer.chrome.com/docs/web-platform/prerender-pages

### Choose eagerness per rule, knowing Chrome's triggers and limits
- Layer: html
- Stage: network, idle, memory
- Metrics: LCP (next page), memory
- When: interaction
- Impact: medium, because too eager wastes bandwidth/memory and too conservative leaves no lead time.
- Do: `immediate` for list rules of 1-2 very likely URLs; `eager` for a few high-probability links; `moderate` as the default for document rules; `conservative` for expensive prerenders. Combine a cheap eager `prefetch` with a stricter `prerender` on the same links.
- Why (Chrome, per developer.chrome.com, updated 2026-01-23): `conservative` = pointer/touch down; `moderate` = desktop hover 200 ms (or pointerdown), mobile viewport heuristics since Aug 2025; `eager` = since Chrome 143 desktop hover 10 ms, mobile simple viewport heuristics since Jan 2026 (was same as `immediate` before); `immediate` = as soon as rules are seen. Defaults: list rules `immediate`, document rules `conservative`. Limits: `immediate` 50 prefetches / 10 prerenders; `eager`/`moderate`/`conservative` 2 each, FIFO.
- Example:
  ```json
  { "prefetch":  [{ "where": { "href_matches": "/instrument/*" }, "eagerness": "eager" }],
    "prerender": [{ "where": { "href_matches": "/instrument/*" }, "eagerness": "moderate" }] }
  ```
- Avoid/caveats: Chrome skips speculation under Save-Data, energy saver on low battery, memory pressure, the "Preload pages" setting off (also turned off by some extensions), and for background tabs. Removing a list-rule script cancels its speculations and frees capacity.
- Status: `eagerness` Chrome 121; Safari 26.2 flag, partial. Source: BCD `html.elements.script.type.speculationrules.eagerness`.
- Sources: https://developer.chrome.com/docs/web-platform/prerender-pages, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/speculationrules

### Prerender only same-origin pages that are safe to run early, and defer side effects to activation
- Layer: html, js
- Stage: network, script-run, layout, paint, memory
- Metrics: LCP (next page near 0), memory
- When: interaction
- Impact: high for MPAs, because an activated prerender shows instantly; costs about as much as an iframe per prerender.
- Do: Use `prerender` rules for high-confidence same-origin targets. In prerendered pages, delay analytics, storage writes and anything user-visible until activation with `document.prerendering` + `prerenderingchange`, and refresh stale state on activation. Cross-origin same-site targets must send `Supports-Loading-Mode: credentialed-prerender`.
- Why: Prerender fetches subresources and runs JS in a hidden page; activation swaps it in. Cross-origin iframes inside a prerender stay unloaded until activation. `activationStart > 0` identifies prerendered loads for metrics.
- Example:
  ```ts
  function whenActivated(fn: () => void) {
    if (document.prerendering) {
      document.addEventListener('prerenderingchange', fn, { once: true });
    } else {
      fn();
    }
  }
  whenActivated(() => startRealtimeFeed());
  ```
- Avoid/caveats: Pages with user-specific or fast-changing server state (cart, login state, live prices) can show stale data after activation; refresh on activation or clear with `Clear-Site-Data: "prerenderCache"`. Status 204/205 prevent prerender; non-2xx responses prevent both prefetch and prerender. Cross-site prerender is not possible.
- Status: Chrome 105+ only (`prerender` action), `document.prerendering` Chrome 108, `activationStart` Chrome 108, `Supports-Loading-Mode` Chrome 109; Firefox and Safari no. Source: BCD `html.elements.script.type.speculationrules.prerender`, `api.Document.prerendering`, `http.headers.Supports-Loading-Mode`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API, https://developer.chrome.com/docs/web-platform/prerender-pages

### Deliver and manage speculation rules with HTTP headers
- Layer: network, tooling
- Stage: network
- Metrics: LCP (next page)
- When: load, build
- Impact: low, because these are operational controls, not new speed.
- Do: When you cannot edit HTML (CDN), send `Speculation-Rules: "/rules.json"` (quoted structured string) and serve the file as `application/speculationrules+json` (with CORS if cross-origin; add `"relative_to": "document"` for document-relative URLs). With a CSP `script-src`, allow inline rules via `'inline-speculation-rules'`, a hash or a nonce. Add `"tag"` to rules to see them in `Sec-Speculation-Tags` on the server. On logout or state change, send `Clear-Site-Data: "prefetchCache", "prerenderCache"`.
- Why: Servers see `Sec-Purpose: prefetch` (and `prefetch;prerender`) on speculative requests and can log, adapt or refuse them (non-2xx response).
- Example:
  ```http
  Speculation-Rules: "/speculation/rules.json"
  Clear-Site-Data: "prefetchCache", "prerenderCache"
  ```
- Avoid/caveats: Rules in subframes are ignored; rules in a prerendered page act only after activation.
- Status: `Speculation-Rules` header Chrome 121 (Safari 26.2 flag); `Sec-Speculation-Tags` Chrome 136; `Clear-Site-Data` `prefetchCache`/`prerenderCache` Chrome 138 only. Source: BCD `http.headers.Speculation-Rules`, `http.headers.Sec-Speculation-Tags`, `http.headers.Clear-Site-Data.*`.
- Sources: https://developer.chrome.com/docs/web-platform/prerender-pages, https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/speculationrules

### Send `No-Vary-Search` for query parameters that do not change the response
- Layer: network
- Stage: network
- Metrics: TTFB, LCP
- When: load, interaction
- Impact: medium, because UTM, tracking or client-only params otherwise create cache misses and wasted prefetches.
- Do: Send `No-Vary-Search: params=("utm_source" "utm_campaign")` (or `params, except=("id")`, or `key-order`) on documents whose HTML does not depend on those params. Add a matching `"expects_no_vary_search"` to speculation rules so an in-flight prefetch can be reused.
- Why: The header lets the HTTP cache and the speculation cache treat URLs that differ only in the listed params as one entry.
- Example:
  ```http
  No-Vary-Search: key-order, params=("utm_source" "utm_medium" "ref")
  ```
- Avoid/caveats: The list is space-separated, not comma-separated. With prerender, code that reads those params must run after activation, because the page may have been prerendered with other values.
- Status: HTTP cache: Chrome 141, Firefox 154; speculation prefetch Chrome 121, prerender Chrome 127; Safari no. Source: BCD `http.headers.No-Vary-Search.*`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/No-Vary-Search, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/speculationrules

### Do not depend on `prerender_until_script` yet; if you test it, keep a `prefetch` fallback
- Layer: html
- Stage: network, html-parse, preload-scan, layout, paint
- Metrics: LCP (next page)
- When: interaction
- Impact: low today, because it is only an origin trial.
- Do: Only in an origin trial: add `prerender_until_script` rules next to equivalent `prefetch` rules (unsupported browsers ignore the unknown key and would get nothing).
- Why: It prefetches the document, fetches its subresources and starts rendering, but pauses the parser at the first `<script>` until activation. Pages with only `defer`/`async`/footer scripts render almost fully; inline event handler attributes can still run.
- Example:
  ```json
  { "prerender_until_script": [{ "where": { "href_matches": "/*" }, "eagerness": "moderate" }],
    "prefetch":               [{ "where": { "href_matches": "/*" }, "eagerness": "moderate" }] }
  ```
- Avoid/caveats: `document.prerendering` and `prerenderingchange` cannot be observed (no script runs), but `activationStart` is non-zero. Blink-dev reported it slower than prefetch in the trial.
- Status: Experimental. Origin trial Chrome 144-150, extended to 154 (blink-dev, 2026-06-01); no intent to ship. Not in BCD.
- Sources: https://developer.chrome.com/blog/prerender-until-script-origin-trial, http://www.mail-archive.com/blink-dev@chromium.org/msg16667.html, https://developer.chrome.com/docs/web-platform/prerender-pages

---

## G. Server responses and HTTP

### Send 103 Early Hints for critical origins and assets while the server builds the HTML
- Layer: network
- Stage: network
- Metrics: TTFB (effective), FCP, LCP
- When: load
- Impact: high when HTML takes hundreds of ms to generate, none when HTML is ready immediately.
- Do: For navigation requests (`Sec-Fetch-Mode: navigate`) over HTTP/2 or HTTP/3, send `103` with `Link: <...>; rel=preconnect` and `Link: <...>; rel=preload; as=...` for stable, cacheable render-blocking CSS, fonts and the main script. Repeat the same `Link` headers on the final `200`.
- Why: The browser starts connections and fetches during server think-time. Early-hint preloads go to the HTTP cache, so only cacheable resources help.
- Example:
  ```http
  HTTP/2 103
  link: </css/app.5c1e.css>; rel=preload; as=style
  link: <https://fonts.example-cdn.com>; rel=preconnect; crossorigin

  HTTP/2 200
  content-type: text/html
  link: </css/app.5c1e.css>; rel=preload; as=style
  ```
- Avoid/caveats: Chrome processes only the first 103; a cross-origin redirect discards the hints. `prefetch` is not supported in 103. Responsive image preloads usually do not work from headers. A 103 CSP applies while processing hints. Do not hint frequently changing hashed URLs from an older build.
- Status: 103 Chrome 103, Firefox 120, Safari 17 (HTTP/2+ only in Chrome and Safari). `preconnect` in 103: all three; `preload` in 103: Chrome 103, Firefox 123, Safari no. Source: BCD `http.status.103.*`.
- Sources: https://developer.chrome.com/docs/web-platform/early-hints, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/103

### Do not use HTTP/2 Server Push; it is removed
- Layer: network
- Stage: network
- Metrics: TTFB, LCP
- When: load
- Impact: low, because browsers ignore it; but pushed bytes may still waste bandwidth on the server side.
- Do: Remove push configuration from servers/CDNs. Use 103 Early Hints and `Link: rel=preload` instead.
- Why: Chrome data showed push was a net negative (servers pushed resources the browser already had). Chrome disabled it in 106; Firefox set `network.http.http2.allow-push` to false in 132.
- Example: n/a (server config).
- Avoid/caveats: None.
- Status: Removed/disabled in Chrome 106+ and Firefox 132+; MDN says no major browser supports it.
- Sources: https://developer.chrome.com/blog/removing-push, https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/132, https://developer.chrome.com/docs/web-platform/early-hints

### Cache hashed assets forever and revalidate HTML
- Layer: network, build
- Stage: network
- Metrics: TTFB, LCP, startup (repeat visits)
- When: load, build
- Impact: high for repeat visits, because a fresh cached asset needs no network at all.
- Do: Put a content hash in every static asset URL and serve it with `Cache-Control: max-age=31536000, immutable`. Serve HTML with `Cache-Control: no-cache` (revalidate every time). Use `stale-while-revalidate=<s>` for resources where slightly stale content is fine.
- Why: `immutable` tells supporting browsers not to revalidate a fresh response, even on reload. `stale-while-revalidate` lets the cache serve a stale copy while it revalidates in the background.
- Example:
  ```http
  # /assets/*
  Cache-Control: max-age=31536000, immutable
  # /index.html
  Cache-Control: no-cache
  # /api/instruments (reference data)
  Cache-Control: max-age=60, stale-while-revalidate=600
  ```
- Avoid/caveats: `no-store` on documents limits bfcache in Firefox/Safari and adds eviction rules in Chrome (see bfcache rule); use `no-cache` unless the page contains sensitive data. Safari 27 fixed several Cache-Control handling bugs.
- Status: `immutable`: Firefox 49, Safari 11, Chrome no (Chrome does not revalidate fresh subresources on normal reload anyway); `stale-while-revalidate`: Chrome 75, Firefox 68, Safari 14. Source: BCD `http.headers.Cache-Control.*`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control, https://web.dev/articles/bfcache

### Compress text with Zstandard or Brotli, and use dictionary compression for versioned bundles
- Layer: network, build
- Stage: network
- Metrics: bundle-size (transfer), LCP, TTFB
- When: load, build
- Impact: high for large JS/WASM bundles that change often, because a dictionary delta can be an order of magnitude smaller than normal compression.
- Do: Serve `zstd` or `br` based on `Accept-Encoding`. For frequently shipped bundles, add `Use-As-Dictionary: match="/js/app.*.js"` to each version, and when a request carries `Available-Dictionary` plus `dcb`/`dcz` in `Accept-Encoding`, return a delta-compressed response with `Content-Encoding: dcb` (or `dcz`) and `Vary: accept-encoding, available-dictionary`. A separate dictionary can be announced with `<link rel="compression-dictionary" href="...">` or a `Link` header.
- Why: With Compression Dictionary Transport, the previous version of a file is the dictionary, so only the changed bytes are sent. Dictionaries are keyed by SHA-256 hash; `Dictionary-ID` is only a server lookup aid.
- Example:
  ```http
  # response for app.v41.js
  Use-As-Dictionary: match="/js/app.*.js", id="app-v41"
  # later request for app.v42.js
  Accept-Encoding: gzip, br, zstd, dcb, dcz
  Available-Dictionary: :pZGm1Av0IEBKARczz7exkNYsZb8LzaMrV7J32a2fFG4=:
  # response
  Content-Encoding: dcb
  Vary: accept-encoding, available-dictionary
  ```
- Avoid/caveats: Requires build or CDN support to precompute deltas (with the `dcb`/`dcz` magic header and hash). A missing `Vary` can serve the wrong bytes from shared caches. SDCH (the old attempt) was removed in 2017.
- Status: zstd Baseline 2026 (Chrome 123, Firefox 126, Safari 26.3; newly 2026-02-11). Brotli Baseline widely available. Compression Dictionary Transport: Chrome 130 only; Firefox 145 behind `network.http.dictionaries.enable`; Safari no. Spec RFC 9842. Source: BCD `http.headers.Content-Encoding.*`, `http.headers.Use-As-Dictionary`, web-features `zstd`, webstatus `compression-dictionary-transport`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression_dictionary_transport, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/compression-dictionary

### Let servers and CDNs honor the `Priority` header
- Layer: network
- Stage: network
- Metrics: LCP
- When: load
- Impact: low to medium, because it only matters when many responses compete on one connection and the server implements RFC 9218.
- Do: On your server/CDN, enable RFC 9218 extensible prioritization (the `Priority` request header and HTTP/2/3 `PRIORITY_UPDATE` frames). Optionally send `Priority: u=0` on a response the server knows is critical.
- Why: `u` is urgency 0 (highest) to 7 (lowest, default 3); `i` marks incremental responses. Browsers derive these values from their internal priority, including `fetchpriority`.
- Example:
  ```http
  Priority: u=1, i
  ```
- Avoid/caveats: The server is free to ignore it; many CDNs do. Test with real waterfalls.
- Status: Request header sent by Chrome 124+ and Firefox 128+; Safari no (per BCD). Source: BCD `http.headers.Priority`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Priority, https://web.dev/articles/fetch-priority

### Use Client Hints for server-side adaptation only as a Chromium enhancement
- Layer: network
- Stage: network
- Metrics: LCP, bundle-size (bytes)
- When: load
- Impact: low, because only Chromium sends most hints, and markup-based `srcset` already covers images.
- Do: If the server chooses variants (image width, lighter JS), request hints with `Accept-CH` (for example `Sec-CH-DPR`, `Sec-CH-Width`, `Sec-CH-Viewport-Width`, `ECT`, `RTT`, `Downlink`, `Sec-CH-Device-Memory`) and list them in `Vary`. Use `Critical-CH` only for hints that must change the first response.
- Why: Hints are sent on later requests in the session after `Accept-CH`. `Critical-CH` makes the browser retry the navigation when a critical hint was missing, which costs a full round trip.
- Example:
  ```http
  Accept-CH: Sec-CH-DPR, Sec-CH-Width
  Vary: Sec-CH-DPR, Sec-CH-Width
  ```
- Avoid/caveats: `Vary` on fast-changing network hints (`RTT`, `Downlink`) makes responses nearly uncacheable. Legacy names `DPR`, `Width`, `Viewport-Width`, `Device-Memory`, `Content-DPR` are deprecated; use the `Sec-CH-` names.
- Status: Chromium only (Accept-CH Chrome 46; `Sec-CH-*` 89-108; `Critical-CH` Chrome 91 experimental); Firefox and Safari no. Source: BCD `http.headers.Accept-CH.*`, `http.headers.Critical-CH`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Client_hints

### Respect `Save-Data` by sending less
- Layer: network, js
- Stage: network
- Metrics: bundle-size (bytes), LCP
- When: load, long-lived session
- Impact: low, because only Chromium sends it, but for those users it can cut bytes a lot.
- Do: When `Save-Data: on` (header) or `navigator.connection.saveData` is true, serve smaller images, skip autoplay video, lower polling rates and skip speculative prefetch.
- Why: The user explicitly opted into reduced data use. Chrome already disables speculation rules under Save-Data.
- Example:
  ```ts
  const saveData = (navigator as any).connection?.saveData === true;
  const pollMs = saveData ? 10_000 : 1_000;
  ```
- Avoid/caveats: Add `Vary: Save-Data` if the response differs.
- Status: Chromium only (header Chrome 49, JS Chrome 65). Source: BCD `http.headers.Save-Data`, `api.NetworkInformation.saveData`; web-features `savedata` (limited).
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Save-Data, https://developer.chrome.com/docs/web-platform/prerender-pages

### Let navigations skip service-worker startup with static routing and navigation preload
- Layer: js, network
- Stage: network
- Metrics: TTFB, LCP
- When: load
- Impact: medium for sites with a service worker, because starting the worker to proxy a request adds latency.
- Do: In the `install` event call `event.addRoutes()` to send routes straight to `"network"` or a named `"cache"` without running the fetch handler. Where the fetch handler must run for navigations, enable navigation preload so the network request starts in parallel with worker boot.
- Why: Static routes are evaluated by the browser, so the service worker does not need to start for those requests.
- Example:
  ```ts
  self.addEventListener('install', (event: any) => {
    event.addRoutes([
      { condition: { urlPattern: '/api/*' }, source: 'network' },
      { condition: { urlPattern: '/assets/*' }, source: { cacheName: 'assets-v7' } },
    ]);
  });
  ```
- Avoid/caveats: The original origin-trial API `registerRouter()` was replaced by `addRoutes()`.
- Status: Static routing Chrome 123, Safari 27; Firefox no. Navigation preload Chrome 59, Firefox 99, Safari 15.4. Source: BCD `api.InstallEvent.addRoutes`, `api.NavigationPreloadManager`; web-features `service-workers-static-routes`.
- Sources: https://developer.chrome.com/blog/service-worker-static-routing, https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

---

## H. Back/forward cache

### Keep every page bfcache-eligible
- Layer: js, network
- Stage: main-thread-task, gc-memory
- Metrics: LCP, FCP, INP, CLS (back/forward navigations become near-instant)
- When: long-lived session
- Impact: high, because a bfcache restore skips network, parsing and script startup for history navigations.
- Do: Never add `unload` listeners; use `pagehide`/`visibilitychange`. Send `Permissions-Policy: unload=()` to stop third parties from adding them. Add `beforeunload` only while there are unsaved changes, and remove it after. Avoid `Cache-Control: no-store` on documents unless they hold sensitive data. Avoid `window.opener` links (`rel="noopener"` is the default now). Close IndexedDB connections in `pagehide` and reopen in `pageshow`. On `pageshow` with `event.persisted`, refresh live data.
- Why: A page with an `unload` listener is ineligible on desktop Chrome and Firefox. Chrome is deprecating `unload`: the rollout reaches 100% of page loads in Chrome 154 (2026-09-22). Since March-April 2025 Chrome allows `no-store` pages into bfcache if cookies do not change, with a 3-minute timeout instead of 10, but still blocks them when WebSocket, WebTransport or WebRTC is used; other browsers may still block all `no-store` pages. web.dev (updated 2026-07-02): Chrome 149+ and Safari do not block on open WebSockets on normal pages; other browsers do.
- Example:
  ```ts
  addEventListener('pagehide', () => feed.close());
  addEventListener('pageshow', (e) => { if (e.persisted) feed.reconnect(); });
  ```
- Avoid/caveats: For a trading terminal, restored pages show old prices until `pageshow` refreshes them; always resync on `persisted`. Analytics must count `pageshow` restores as page views.
- Status: bfcache in all major browsers (Chrome since 96). `Permissions-Policy: unload` Chrome 115 (experimental). Unload deprecation timeline per Chrome docs (updated 2026-07-14). Source: web.dev bfcache, Chrome docs.
- Sources: https://web.dev/articles/bfcache, https://developer.chrome.com/docs/web-platform/deprecating-unload, https://developer.chrome.com/docs/web-platform/bfcache-ccns

### Send exit beacons with `fetchLater()` (or `sendBeacon`/`keepalive`), not `unload`
- Layer: js, network
- Stage: network, idle
- Metrics: INP (no work at exit), reliability of analytics
- When: long-lived session
- Impact: medium, because it removes the last common reason for `unload` handlers.
- Do: Queue the final beacon with `fetchLater(url, { method: 'POST', body, activateAfter })`, wrapped in try/catch for `QuotaExceededError`. Fall back to `navigator.sendBeacon()` or `fetch(..., { keepalive: true })` in `visibilitychange` (hidden) where `fetchLater` is missing.
- Why: A `fetchLater` request is sent by the browser when the page is destroyed or enters bfcache, or after `activateAfter`, whichever comes first, even if the page never runs code again.
- Example:
  ```ts
  if ('fetchLater' in window) {
    try { (window as any).fetchLater('/rum', { method: 'POST', body: JSON.stringify(stats) }); }
    catch { /* quota: fall back */ }
  } else {
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') navigator.sendBeacon('/rum', JSON.stringify(stats));
    });
  }
  ```
- Avoid/caveats: The response is ignored. Body cannot be a `ReadableStream`. Requires HTTPS URLs. Governed by CSP `connect-src` and the `deferred-fetch` permissions policy quotas.
- Status: `fetchLater` Chrome 135 only (experimental). `sendBeacon` Baseline; `keepalive` Chrome 66, Firefox 133, Safari 13. Source: BCD `api.Window.fetchLater`, `api.fetch.options_parameter.keepalive`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater, https://developer.chrome.com/docs/web-platform/deprecating-unload

### Monitor why pages miss the bfcache
- Layer: tooling
- Stage: gc-memory
- Metrics: LCP, INP (history navigations)
- When: testing, long-lived session
- Impact: low (measurement only), but it finds blockers you cannot see locally, including ones in iframes.
- Do: Report `performance.getEntriesByType('navigation')[0].notRestoredReasons` to RUM. Use the DevTools Application > Back/forward cache tester and Lighthouse's `no-unload-listeners` audit in CI.
- Why: The reasons object lists blocking reasons for the top frame and every iframe (`id`, `name`, `src`).
- Example:
  ```ts
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as any[]) if (e.notRestoredReasons) report(e.notRestoredReasons);
  }).observe({ type: 'navigation', buffered: true });
  ```
- Avoid/caveats: Chromium only; Firefox/Safari have different blockers.
- Status: Chrome 125 (experimental). Source: BCD `api.PerformanceNavigationTiming.notRestoredReasons`, web-features `bfcache-blocking-reasons`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Monitoring_bfcache_blocking_reasons, https://web.dev/articles/bfcache

---

## I. Native HTML instead of JavaScript

### Build menus, tooltips and dropdown panels with `popover` and invoker commands
- Layer: html
- Stage: script-compile, script-run, main-thread-task, composite
- Metrics: bundle-size, TBT, INP, startup
- When: load, interaction
- Impact: medium, because it removes positioning/toggle/light-dismiss JS and works before hydration.
- Do: Use `popover` (or `popover="manual"`) for panels, `<button commandfor="id" command="toggle-popover|show-modal|close|...">` to wire buttons without listeners, and `popovertarget` for simple toggles. Use `popover="hint"` and `interestfor` (hover/focus cards) only as progressive enhancements.
- Why: The browser handles top-layer rendering (no z-index fights), light dismiss, Esc and focus return, and the controls work as soon as HTML is parsed, before any bundle loads.
- Example:
  ```html
  <button commandfor="acct-menu" command="toggle-popover">Account</button>
  <div id="acct-menu" popover>
    <button commandfor="acct-menu" command="hide-popover">Close</button>
  </div>
  ```
- Avoid/caveats: Many open top-layer elements still cost style/layout; keep popover content light. Customizable `<select>` (`appearance: base-select`) is Chrome 135 and Safari 27 only.
- Status: `popover` Baseline 2025 (2025-01-27); invoker commands Baseline 2025 (Chrome 135, Firefox 144, Safari 26.2; 2025-12-12); `popover="hint"` Chrome 151, Firefox 153, Safari preview; `interestfor` Chrome 142 only (experimental). Source: web-features `popover`, `invoker-commands`, `popover-hint`, `interest-invokers`, `customizable-select`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/popover, https://developer.mozilla.org/en-US/docs/Web/API/Invoker_Commands_API

### Use `<dialog>` and `inert` instead of modal libraries and focus-trap scripts
- Layer: html
- Stage: script-run, main-thread-task
- Metrics: bundle-size, INP
- When: interaction
- Impact: low to medium, because it deletes focus-trap and scroll-lock JS and its event listeners.
- Do: Use `<dialog>` with `showModal()` (or `command="show-modal"`), `closedby="any"` for light dismiss, and `inert` on background regions for non-modal blocking states.
- Why: A modal dialog makes the rest of the page inert and handles Esc/focus natively; `inert` removes a subtree from focus, clicks and the accessibility tree with one attribute.
- Example:
  ```html
  <dialog id="confirm-order" closedby="closerequest">...</dialog>
  <button commandfor="confirm-order" command="show-modal">Place order</button>
  ```
- Avoid/caveats: `closedby` is not in Safari release yet; keep a close button.
- Status: `<dialog>` Baseline 2022; `inert` Baseline 2023 (widely available 2025-10-11); `closedby` Chrome 134, Firefox 141, Safari preview. Source: web-features `dialog`, `inert`, `dialog-closedby`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert

### Collapse long hidden content with `hidden="until-found"` or `<details>`, not `display:none` + JS
- Layer: html
- Stage: style, layout, paint
- Metrics: INP, TBT, FCP
- When: load, interaction
- Impact: low to medium, because the collapsed content skips rendering but stays findable.
- Do: Use `hidden="until-found"` for collapsed sections (FAQ answers, long disclosures) and listen for `beforematch` to sync your UI state. Use `<details name="group">` for exclusive accordions.
- Why: Browsers implement `until-found` with `content-visibility: hidden`, so the subtree's contents are not laid out or painted, but find-in-page and fragment links reveal it (fire `beforematch`, remove `hidden`, scroll).
- Example:
  ```html
  <h3><button aria-expanded="false" aria-controls="fees">Fees</button></h3>
  <div id="fees" hidden="until-found">...</div>
  <script>
    const panel = document.getElementById('fees');
    const toggle = document.querySelector('[aria-controls="fees"]');
    panel.addEventListener('beforematch', () => toggle.setAttribute('aria-expanded', 'true'));
  </script>
  ```
- Avoid/caveats: Unsupported browsers treat it as normal `hidden` (content not findable). BCD notes Firefox and Safari do not scroll to the match correctly yet.
- Status: Limited. Chrome 102, Firefox 148 (139 partial), Safari 26.2 partial; `beforematch` Chrome 102, Firefox 139, Safari 26.2. `<details name>` Baseline 2024. Source: BCD `html.global_attributes.hidden.until-found`, web-features `hidden-until-found`, `details-name`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/hidden

### Server-render web components with declarative shadow DOM
- Layer: html
- Stage: html-parse, style, paint, script-run
- Metrics: FCP, LCP, CLS, startup
- When: load
- Impact: medium for component libraries, because components paint styled before their JS loads.
- Do: Emit `<template shadowrootmode="open">` inside each custom element in server HTML, with its styles inside. Parse such HTML at runtime with `setHTMLUnsafe()` / `Document.parseHTMLUnsafe()`, not `innerHTML`.
- Why: The parser attaches the shadow root while streaming, so there is no flash of unstyled content and no layout shift when JS upgrades the element; hydration can reuse the existing root.
- Example:
  ```html
  <price-tile>
    <template shadowrootmode="open">
      <style>:host{display:block;contain:content}</style>
      <span part="bid"><slot name="bid"></slot></span>
    </template>
    <span slot="bid">1.08421</span>
  </price-tile>
  ```
- Avoid/caveats: Each host repeats its template markup (HTML bytes grow for many instances). The old non-standard `shadowroot` attribute (Chrome 90-110) is removed; use `shadowrootmode`. `shadowrootserializable`: no Firefox.
- Status: Baseline 2024 (Chrome 111, Firefox 123, Safari 16.4), widely available 2026-08-20. `shadowrootclonable` Chrome 124/Firefox 125/Safari 17.5; `shadowrootslotassignment` Firefox 151 and Safari 27. Source: web-features `declarative-shadow-dom`, BCD `html.elements.template.*`.
- Sources: https://web.dev/articles/declarative-shadow-dom, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/template

### Stream slow page regions out of order with `<template for>` (progressive enhancement)
- Layer: html, network
- Stage: html-parse, layout, paint
- Metrics: FCP, LCP, TTFB (perceived)
- When: load
- Impact: medium where supported, because fast HTML ships first and slow regions (database-backed widgets) stream in later without JS.
- Do: Stream the page shell with `<?start name="x">placeholder<?end>` or `<?marker name="x">`, flush early, and later in the same response emit `<template for="x">...</template>`. Use the Chrome polyfill (`template-for-polyfill`) for other browsers.
- Why: The parser matches the template to the processing-instruction marker and replaces the range in place; placing a template as a direct child of `<body>` lets it patch anywhere, including `<head>` (for `<title>`).
- Example:
  ```html
  <section id="positions"><?start name="positions">Loading positions...<?end></section>
  <!-- ... rest of page, flushed ... -->
  <template for="positions"><table>...</table></template>
  ```
- Avoid/caveats: A template can only patch markers inside its own parent. Moving markers during streaming misbehaves. Templates inserted with `innerHTML`/`setHTML` patch only inside the fragment. Unsupported browsers keep the placeholder unless polyfilled. Streaming JS setters (`streamHTMLUnsafe()` etc.) are behind a flag in Chrome 148, planned for Chrome 155.
- Status: Experimental. `<template for>` Chrome 150 only (webstatus: 2026-06-30); in the WHATWG HTML standard. Source: BCD `html.elements.template.for`, webstatus `template-for`.
- Sources: https://developer.chrome.com/blog/declarative-partial-updates, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/template

### Add `<meta name="viewport" content="width=device-width">` to remove the mobile tap delay
- Layer: html
- Stage: main-thread-task (input handling)
- Metrics: INP
- When: interaction
- Impact: medium on mobile, because without it some browsers wait about 300 ms after a tap to detect double-tap zoom.
- Do: Include the viewport meta in every page. If you cannot, use CSS `touch-action: manipulation` on interactive areas.
- Why: Chrome (since 32) and other mobile browsers skip the double-tap wait on mobile-optimized (`width=device-width`) pages while keeping pinch-zoom.
- Example:
  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ```
- Avoid/caveats: Do not disable zoom (`user-scalable=no`, `maximum-scale=1`); it harms accessibility and is not needed for speed.
- Status: Supported by all mobile browsers (BCD lists Chrome Android 18, Safari iOS 3). Source: BCD `html.elements.meta.name.viewport`.
- Sources: https://developer.chrome.com/blog/300ms-tap-delay-gone-away

### Use credentialless iframes when cross-origin isolation is needed for WASM threads
- Layer: html, network
- Stage: script-run
- Metrics: startup, FPS/smoothness (enables multi-threaded WASM)
- When: load
- Impact: low (enabler, not a speed-up by itself).
- Do: If the app needs `crossOriginIsolated` (for `SharedArrayBuffer`, multi-threaded WebAssembly) and embeds third-party iframes that do not send COEP/CORP, use `Cross-Origin-Embedder-Policy: credentialless` and `<iframe credentialless>`.
- Why: A credentialless iframe loads in an ephemeral context without cookies or storage, so COEP embedding rules can be lifted for it.
- Example:
  ```html
  <iframe src="https://news-widget.example.com" credentialless loading="lazy" title="News"></iframe>
  ```
- Avoid/caveats: The embedded page loses its cookies/storage (logins break). Chromium only.
- Status: `<iframe credentialless>` Chrome 110 only (experimental); `COEP: credentialless` Chrome 96, Firefox 119, Safari no. Source: BCD `html.elements.iframe.credentialless`, `http.headers.Cross-Origin-Embedder-Policy.credentialless`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe

---

## J. Measurement hooks for loading features

### Measure render-blocking, delivery and early-hint timing in RUM
- Layer: tooling
- Stage: network, paint
- Metrics: FCP, LCP, TTFB
- When: testing, load
- Impact: low (measurement), but it shows which HTML/HTTP levers actually work in the field.
- Do: Log `PerformanceResourceTiming.renderBlockingStatus` ("blocking"/"non-blocking") for CSS/JS, `deliveryType` (`"navigational-prefetch"`, cache), `firstInterimResponseStart` (103 arrival), `contentEncoding` (was dictionary/zstd used), and `PerformanceNavigationTiming.activationStart` (prerender). Send `Server-Timing` for backend phases and `Timing-Allow-Origin` on CDN/API responses so their timings are visible. Mark key elements with `elementtiming="name"`.
- Why: These fields tell you whether a resource blocked first paint, whether it came from a speculation or 103 hint, and how much server time preceded the first byte.
- Example:
  ```ts
  new PerformanceObserver((l) => {
    for (const e of l.getEntries() as PerformanceResourceTiming[]) {
      if ((e as any).renderBlockingStatus === 'blocking') log('render-blocking', e.name, e.duration);
    }
  }).observe({ type: 'resource', buffered: true });
  ```
- Avoid/caveats: Most of these are Chromium-first; guard every property. Cross-origin entries show zeros without `Timing-Allow-Origin`.
- Status: `renderBlockingStatus` Chrome 107 only; `deliveryType` Chrome 117, Safari 26.4; `firstInterimResponseStart` Chrome 115, Firefox 152, Safari 26.4; `contentEncoding` Chrome 143 (experimental); `activationStart` Chrome 108; `elementtiming` Chrome 77 only; `containertiming` behind flags (Chrome 145, Firefox 156); `Server-Timing` Baseline 2023; LCP and Event Timing APIs Baseline 2025 (Safari 26.2, 2025-12-12). Source: BCD `api.PerformanceResourceTiming.*`, `api.PerformanceNavigationTiming.activationStart`, `html.global_attributes.elementtiming`; web-features `largest-contentful-paint`, `event-timing`, `server-timing`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/renderBlockingStatus, https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API, https://developer.chrome.com/docs/performance/insights/lcp-discovery

---

## Deprecated, renamed or removed (quick list)

| Old | Status (2026-09) | Use instead | Source |
|---|---|---|---|
| `<link rel="prerender">` | Deprecated, non-standard; Chrome 63+ runs NoState Prefetch only | Speculation Rules `prerender` / `prefetch` | BCD `html.elements.link.rel.prerender`; MDN |
| `importance="high|low"` (Priority Hints OT 2018/2021) | Removed; not in BCD | `fetchpriority`, `fetch(..., {priority})` | web.dev fetch-priority (History) |
| `<template shadowroot>` | Removed (Chrome 90-110) | `shadowrootmode` | BCD `html.elements.template.shadowrootmode` |
| HTTP/2 Server Push | Disabled Chrome 106, Firefox 132 | 103 Early Hints, `Link: rel=preload` | Chrome blog; MDN Firefox 132 notes |
| `unload` event | Chrome deprecation at 100% of page loads from Chrome 154 | `pagehide`, `visibilitychange`, `fetchLater()` | Chrome deprecating-unload doc |
| Speculation rules `"source"` key | Optional since Chrome 121 (inferred from `urls`/`where`) | omit it | Chrome prerender-pages doc |
| `InstallEvent.registerRouter()` | Replaced by `addRoutes()` (removal planned Chrome 125) | `addRoutes()` | Chrome static routing blog |
| Client hints `DPR`, `Width`, `Viewport-Width`, `Device-Memory`, `Content-DPR` | Deprecated | `Sec-CH-DPR`, `Sec-CH-Width`, `Sec-CH-Viewport-Width`, `Sec-CH-Device-Memory` | BCD `http.headers.*` |
| `loading="auto"` / Chrome Lite-mode auto lazy-load | Deprecated, no plans for automatic lazy loading | explicit `loading="lazy"` | web.dev browser-level lazy loading FAQ |
| `nomodule` bundles | Standard but obsolete in practice | single module build | BCD / web-features `js-modules` |
| SDCH | Removed 2017 | Compression Dictionary Transport (RFC 9842) | MDN CDT guide |
| `HTMLImageElement.lowsrc` | Deprecated | `srcset`, placeholders | BCD `api.HTMLImageElement.lowsrc` |

## Sources read
Support data (queried 2026-09-22):
- https://cdn.jsdelivr.net/npm/@mdn/browser-compat-data/data.json (BCD 8.1.2, built 2026-09-17)
- https://cdn.jsdelivr.net/npm/web-features/data.json (web-features 3.39.0)
- https://api.webstatus.dev/v1/features/{speculation-rules, fetch-priority, sizes-auto, blocking-render, hidden-until-found, compression-dictionary-transport, zstd, loading-lazy-media, template-for}

MDN (read from the mdn/content GitHub source files, main branch, 2026-09-22):
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/speculationrules
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/link
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preconnect
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/dns-prefetch
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/prefetch
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/prerender
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/compression-dictionary
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/fetchpriority
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/template
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/hidden
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/popover
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert
- https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API
- https://developer.mozilla.org/en-US/docs/Web/API/Invoker_Commands_API
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode
- https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/renderBlockingStatus
- https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater
- https://developer.mozilla.org/en-US/docs/Web/API/Window/unload_event
- https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Monitoring_bfcache_blocking_reasons
- https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Speculative_loading
- https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/dns-prefetch
- https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Lazy_loading
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/103
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression_dictionary_transport
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Client_hints
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Save-Data
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/No-Vary-Search
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Speculation-Tags
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Priority
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control
- https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/132

Chrome / web.dev / WebKit / specs:
- https://developer.chrome.com/docs/web-platform/prerender-pages (updated 2026-01-23)
- https://developer.chrome.com/blog/prerender-until-script-origin-trial (2026-01-23)
- http://www.mail-archive.com/blink-dev@chromium.org/msg16667.html (Intent to Extend Experiment, 2026-06-01)
- https://developer.chrome.com/docs/web-platform/early-hints (updated 2026-07-10)
- https://developer.chrome.com/blog/removing-push
- https://developer.chrome.com/docs/web-platform/bfcache-ccns (updated 2025-09-09)
- https://developer.chrome.com/docs/web-platform/deprecating-unload (updated 2026-07-14)
- https://developer.chrome.com/blog/declarative-partial-updates (updated 2026-09-08)
- https://developer.chrome.com/docs/web-platform/view-transitions/cross-document
- https://developer.chrome.com/blog/service-worker-static-routing
- https://developer.chrome.com/blog/new-in-chrome-148
- https://developer.chrome.com/blog/300ms-tap-delay-gone-away
- https://developer.chrome.com/docs/performance/insights/lcp-discovery (2025-10-08)
- https://web.dev/articles/fetch-priority
- https://web.dev/articles/bfcache (updated 2026-07-02)
- https://web.dev/articles/browser-level-image-lazy-loading
- https://web.dev/articles/iframe-lazy-loading
- https://web.dev/articles/declarative-shadow-dom
- https://web.dev/articles/preload-scanner
- https://web.dev/articles/preconnect-and-dns-prefetch
- https://web.dev/articles/optimize-cls
- https://web.dev/articles/lcp
- https://webkit.org/blog/18325/webkit-features-for-safari-27-0/
- https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/
- https://html.spec.whatwg.org/multipage/links.html

## Not covered / could not access
- MDN pages that return 404 at the canonical URL: `/Web/HTML/Reference/Attributes/blocking`, `/Web/HTML/Reference/Attributes/rel/expect`; the MDN source path for "IFrame credentialless" guide was not found (used the `<iframe>` reference instead).
- BCD 8.1.2 and webstatus.dev do not yet reflect Safari 27 (released 2026-09-14) for `sizes="auto"`; the Safari claim comes from the WebKit release notes only.
- Safari 26.2 speculation-rules prefetch behind a preference: behavior not tested; the Safari 27 notes did not mention enabling it by default.
- `target_hint`: MDN says it is not supported for prefetch, while the BCD note says Chrome 138 supports it only for prefetch; conflict not resolved, so no rule was written.
- Exact Chrome resource-priority table per resource type was only summarized (web.dev table dates from 2023-11); Firefox and Safari internal priority mappings were not researched.
- HTTP/3, `Alt-Svc`, HTTPS DNS records, TLS 1.3/0-RTT (`Early-Data`), and CDN-specific features were not covered.
- CSS-side levers that interact with these features (`content-visibility`, `contain-intrinsic-size`, `font-display`, `@view-transition`) are left to the CSS topic.
- Import-map techniques for cache stability and multiple import maps (Chrome 133, Safari 18.4) were checked for support only; no performance evidence was gathered.
- Quotas for `fetchLater()` (deferred-fetch permissions policy) were not read in detail.
- Blog-only claims: none used as sole source; the WebSocket/bfcache Chrome 149 statement comes from web.dev (Chrome team) only.
