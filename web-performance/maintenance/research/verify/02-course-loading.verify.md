# Verify: 02-course-loading.md

Summary counts: 69 items checked. 54 verified, 14 corrected, 1 disputed, 0 unverified.
(One sub-claim inside a corrected item stays unverified: the Safari bug with `rel="preconnect dns-prefetch"`.)

Checks run (2026-09-22):
- Downloaded BCD 8.1.2 (2026-09-17) and web-features 3.39.0 again from jsDelivr. They are the same versions the notes used. I queried every status line against them (`raw/verify/02/q.py`).
- Fetched the chromestatus JSON for 5696805480169472, 5452774595624960 and 5200068565139456. Fetched the caniuse JSON for av1, webm, woff2 and brotli.
- Read the Chromium `main` source for `client_socket_pool_manager.cc`, `css_preload_scanner.cc` and `html_preload_scanner.cc`. Read the chromiumdash milestone schedule for Chrome 150–154.
- Read the WebKit "Safari 27.0" release notes (2026-09-14). This release is newer than BCD 8.1.2 for some keys.
- Grepped the saved course and article text in `raw/course-loading/`. Re-fetched web.dev vitals, preconnect-and-dns-prefetch, preload-critical-assets, bfcache-ccns, MDN rel=preload, MDN img, the WebKit font post, the tunetheweb decoding post, Jake Archibald's link-in-body post and RFC 9110.
- Every real URL that the notes cite returns HTTP 200. Only the placeholder example origins do not resolve.
- Preamble note: chromiumdash shows that Chrome now ships every two weeks. Chrome 153 became stable on 2026-09-08 and Chrome 154 on 2026-09-22 (today). The notes say "Chrome 153". That was true for BCD 8.1.2 but is stale as of today.

---

### Set Core Web Vitals targets at the 75th percentile before you optimize
- Verdict: verified
- Evidence: https://web.dev/articles/vitals (LCP 2.5 s, INP 200 ms, CLS 0.1, p75, "segmented across mobile and desktop"; last updated 2024-10-31, with no newer threshold change), https://web.dev/articles/ttfb ("most sites should strive to have a TTFB of 0.8 seconds or less"), https://web.dev/learn/performance/why-speed-matters (BBC 10%/s; Vodafone "A 31% improvement in LCP increased sales by 8%")

### Link to final URLs and remove redirect hops
- Verdict: verified
- Note: For the HTTP→HTTPS hop, `Strict-Transport-Security` (and the HSTS preload list) removes the redirect on repeat visits. The notes do not mention this.
- Evidence: https://web.dev/learn/performance/general-html-performance, https://web.dev/articles/ttfb (redirect time is part of TTFB), https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security

### Cache static HTML briefly; do not cache personalized HTML in the browser
- Verdict: disputed
- Correction: The notes quote the 2023 course correctly: "It's therefore best to avoid caching HTML altogether in such cases". Newer web.dev guidance (bfcache article, last updated 2026-09-03) says that `no-store` "should only be set on pages that contain sensitive information where caching of any sort is never appropriate". For personalized HTML that is not sensitive, use `Cache-Control: private, no-cache`. The browser then revalidates on every use, so the "cannot invalidate" concern goes away. Keep `no-store` for sensitive pages only. The bfcache-ccns facts are correct: Chrome rolled this out to 100% in March–April 2025. It evicts the page on cookie or other auth changes, on WebSocket, WebTransport or WebRTC use, and on a `no-store` fetch/XHR response. The timeout is 3 minutes, not 10. The example `private, no-store` on a "logged-in trading dashboard shell" conflicts with files 03, 04, 07 and 17-batch-01 (see Cross-file conflicts).
- Evidence: https://web.dev/articles/bfcache (section "Minimize use of Cache-Control: no-store"), https://developer.chrome.com/docs/web-platform/bfcache-ccns, https://web.dev/learn/performance/general-html-performance

### Make HTML revalidation cheap with ETag or Last-Modified
- Verdict: corrected
- Correction: Revalidation does not need a strong validator. RFC 9110 §13.1.2: "A recipient MUST use the weak comparison function when comparing entity-tags for If-None-Match", so a weak ETag (`W/"…"`) works. `Last-Modified` is usually a weak validator (§8.8.2.2: implicitly weak unless it can be deduced to be strong), so do not call it "strong". When both headers are present, the server must ignore `If-Modified-Since` (§13.1.3). Replace "Send a strong validator" with "Send a validator (`ETag`, weak or strong, or `Last-Modified`)".
- Evidence: https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2, https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2, https://web.dev/learn/performance/general-html-performance

### Expose backend phases with the Server-Timing header
- Verdict: verified
- Evidence: web-features `server-timing` (baseline high, low 2023-03-27, high 2025-09-27; Chrome 65, Firefox 61, Safari 16.4), BCD `http.headers.Server-Timing`, https://web.dev/learn/performance/general-html-performance

### Render the first view on the server, not with a spinner and a client-side fetch
- Verdict: verified
- Evidence: https://web.dev/learn/performance/general-html-performance ("Displaying a loading spinner and then fetching all data on the client side moves the effort from a more predictable server-…"), https://web.dev/articles/preload-scanner

### Compress text responses with Brotli, keep gzip as fallback, consider zstd
- Verdict: verified
- Evidence: course text "Brotli results in about a 15% to 20% improvement over gzip" (https://web.dev/learn/performance/general-html-performance). web-features `brotli` (low 2017-09-19), `zstd` (baseline low 2026-02-11; Chrome 123, Firefox 126, Safari 26.3). BCD `http.headers.Content-Encoding.dcb`/`dcz`: Chrome 130, Firefox 145 behind a flag, no Safari, experimental. https://caniuse.com/brotli

### Pre-compress static assets at build time; compress dynamic HTML on the fly
- Verdict: verified
- Evidence: https://web.dev/learn/performance/general-html-performance ("Static resources—such as JavaScript, CSS, and SVG images—should be statically compressed, whereas HTML resources… should be dynamically compressed")

### Do not size bundles for compression ratio
- Verdict: verified
- Evidence: https://web.dev/learn/performance/general-html-performance ("Very small resources—less than 1 KiB—don't compress very well")

### Serve from a CDN edge over HTTP/2 or HTTP/3
- Verdict: verified
- Evidence: web-features `http3` (baseline low 2024-09-16), `http2` (widely available), https://web.dev/articles/optimize-lcp ("unique URL parameters are used by visitors for analytics")

### Keep render-blocking work in the head to the minimum needed for a non-broken first render
- Verdict: verified
- Evidence: https://web.dev/learn/performance/understanding-the-critical-path

### Stream the HTML and flush the head early
- Verdict: verified
- Note: The Express sketch can fail silently. The common `compression` middleware buffers output until you call `res.flush()` after `res.write(headHtml)`. Proxies with response buffering have the same effect.
- Evidence: https://web.dev/learn/performance/understanding-the-critical-path, https://web.dev/articles/ttfb ("early flushing… measured as `responseStart` and so TTFB"), https://github.com/expressjs/compression#resflush

### Reserve space for images and media so late content does not shift layout
- Verdict: corrected
- Correction: The `width`/`height` attributes map to `aspect-ratio` only on `<img>` and `<video>`: Chrome 79, Firefox 71, Safari 14/15. BCD has `aspect_ratio_computed_from_attributes` only for img and video. On `<iframe>`, the attributes set a fixed size and do not give a ratio. So "use `height: auto` with a fluid width" collapses an iframe to the default 150 px height. For fluid iframes, set CSS `aspect-ratio` (for example `width:100%; aspect-ratio:16/9; height:auto`). In Safari before 15, the space was not reserved for images without a valid `src` (BCD note, WebKit bug 224197).
- Evidence: BCD `html.elements.img.aspect_ratio_computed_from_attributes`, `html.elements.video.aspect_ratio_computed_from_attributes` (no iframe key), BCD `html.elements.source.width` (Chrome 90, Firefox 108, Safari 15, correct in notes)

### Load section-specific CSS in the body, next to the section
- Verdict: corrected
- Correction: "They still pause the parser" is Chrome behavior only. The chromestatus feature notes say: "Firefox is similar but does not pause the parser so that content after the external sheet is painted using the existing styles until the external sheet loads." Jake Archibald's post says the same: in-body links in Firefox "can result in a flash of unstyled content". His workaround for Firefox is a non-empty `<script> </script>` right after the link. chromestatus shows Safari as "Shipped", but its notes say "the Safari implementation is different". Add to the caveats: "In Firefox, content after the link can paint unstyled (FOUC)."
- Evidence: https://chromestatus.com/feature/5696805480169472 (JSON `feature_notes`), https://jakearchibald.com/2016/link-in-body/

### Use a non-matching media attribute only for truly conditional CSS
- Verdict: corrected
- Correction: (1) The fetch-priority table shows that `fetchpriority="high"` raises media-mismatched CSS from Lowest to High. The problem is timing, not priority: the preload scanner skips the sheet, so it is "fetched very late, even with `fetchpriority="high"`". Replace "It loads at Lowest priority… even with fetchpriority=high" with "It loads at Lowest priority, and only when the main parser reaches it. `fetchpriority="high"` raises it to High but does not make it load earlier." (2) Replace "A low-priority `rel=preload as=style` works better" with "An early `rel=preload as=style` fetches at Highest. With `fetchpriority="low"` it drops only to High, not Low (same table, row 'CSS (early)'), so it still competes with critical CSS. Use it only for CSS needed soon." Both swap tricks use inline `onload` handlers, which a strict CSP blocks.
- Evidence: https://web.dev/articles/fetch-priority (priority table and footnotes * and ***), https://timkadlec.com/remembers/2020-02-13-when-css-blocks/ (blog, cited by file 01)

### Use blocking="render" only to block paint on purpose
- Verdict: verified
- Evidence: web-features `blocking-render` (not Baseline; Chrome 105, Safari 18.2), BCD `html.elements.{link,script,style}.blocking` (Firefox false), https://chromestatus.com/feature/5452774595624960 (Firefox "Positive", no implementation)

### Treat the LCP resource as part of the critical path and audit request chains
- Verdict: corrected
- Correction: Lighthouse 13 (2025-10-10; in Chrome stable from 143) removed the old audits. `critical-request-chains` (and `uses-rel-preconnect`) became `network-dependency-tree-insight`. `render-blocking-resources` became `render-blocking-insight`. `largest-contentful-paint-element` became `lcp-phases-insight` ("LCP breakdown"). `prioritize-lcp-image` and `lcp-lazy-loaded` became `lcp-discovery-insight`. Replace "Lighthouse LCP breakdown and critical request chains" with "the LCP breakdown, LCP request discovery and Network dependency tree insights (Lighthouse 13+ and the DevTools Performance panel)". The caveat about "the Lighthouse chain audit" now applies to the network-dependency-tree insight: "A request is considered critical if it is potentially render-blocking or high priority."
- Evidence: https://developer.chrome.com/blog/lighthouse-13-0, https://developer.chrome.com/docs/performance/insights/network-dependency-tree

### Do not ship parser-blocking scripts; use defer, type=module, or async
- Verdict: verified
- Evidence: https://web.dev/learn/performance/optimize-resource-loading ("scripts (including inline scripts) with `type="module"` are deferred automatically"), https://web.dev/articles/preload-scanner ("Injected scripts are `async` by default")

### Remember that a parser-blocking script also waits for pending CSS
- Verdict: verified
- Evidence: https://web.dev/learn/performance/optimize-resource-loading ("A parser-blocking `<script>` must also wait for any in-flight render-blocking CSS resources… `element.getComputedStyle()`")

### Keep critical resources in server-sent HTML so the preload scanner can find them
- Verdict: corrected
- Correction: Pattern (4) is too broad. Only `@import` inside an external stylesheet is invisible to the scanner. Chromium's HTML preload scanner runs a `CSSPreloadScanner` over inline `<style>` content (`in_style_` → `css_scanner_.Scan`) and preloads `@import` rules, including `layer`/`layer(name)` imports. WebKit also has a CSS preload scanner: Safari 27 "Fixed the CSS preload scanner to resolve relative @import URLs against the <base> element URL". Replace (4) with "CSS `@import` inside external stylesheets". The other three patterns are verified.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/html/parser/css_preload_scanner.cc, https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/html/parser/html_preload_scanner.cc, https://webkit.org/blog/18325/webkit-features-for-safari-27-0/, https://web.dev/learn/performance/optimize-resource-loading

### Do not inject startup scripts from inline JS
- Verdict: verified
- Evidence: https://web.dev/articles/preload-scanner (injected async script loads at "Low" after the stylesheet; preloading it promotes it to "High" and may cause "bandwidth contention")

### Do not JS-lazy-load images or iframes that are visible at startup
- Verdict: verified
- Evidence: https://web.dev/articles/preload-scanner (section "Lazy loading with JavaScript", iframe key point)

### Replace CSS @import with link elements
- Verdict: corrected
- Correction: "that the scanner cannot see" applies only to `@import` in external sheets. The Chromium scanner (and WebKit's) finds `@import` in an inline `<style>` in the HTML (see the item above). For cascade layers, one more option is to put `<style>@import url(/css/base.css) layer(base);</style>` in `<head>`. Chromium's `CanPreloadImportRule()` explicitly accepts `layer` and `layer(name)` imports. It is correct that `<link>` cannot assign a layer: BCD `html.elements.link` has no `layer` attribute.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/html/parser/css_preload_scanner.cc, https://web.dev/learn/performance/optimize-resource-loading

### Minify CSS in production builds
- Verdict: verified
- Evidence: https://web.dev/learn/performance/optimize-resource-loading ("advanced CSS optimizations can be risky")

### Remove unused CSS and split CSS per page or route
- Verdict: verified
- Evidence: https://web.dev/learn/performance/optimize-resource-loading ("Focus on big wins")

### Inline small critical CSS and load the rest without blocking render
- Verdict: corrected
- Correction: The example `<link rel="preload" as="style" … fetchpriority="low" onload="this.rel='stylesheet'">` is copied from web.dev. But the same article's table shows that early CSS with `fetchpriority="low"` drops only from Highest to High. So this is not a low-priority load, and it still competes with first-view resources. For CSS that is truly non-critical, a `<link rel="stylesheet">` at the end of `<body>` is the simplest option in the course. The inline `onload` handler also needs CSP `'unsafe-inline'`/`'unsafe-hashes'` and has no no-JS fallback. The rest is verified (course: inlined CSS "is not cached for subsequent pages"; optimize-lcp: "If a style sheet is so large that it takes longer to load than the LCP resource, then it's unlikely to be a good candidate for inlining"). `fetchpriority` Baseline 2024 is correct.
- Evidence: https://web.dev/articles/fetch-priority (table rows "CSS (early**)" and footnote *), https://web.dev/articles/optimize-lcp, https://web.dev/learn/performance/optimize-resource-loading

### Do not render the LCP element or critical content with client-side JS
- Verdict: verified
- Evidence: https://web.dev/articles/preload-scanner ("Client-rendered markup… is handled as a single, monolithic task")

### Minify and mangle JavaScript in production builds
- Verdict: verified
- Evidence: https://web.dev/learn/performance/optimize-resource-loading

### Do not inline large resources or base64 data into the HTML
- Verdict: verified
- Evidence: https://web.dev/articles/preload-scanner (LCP "about 3.5 seconds" vs "just over 7 seconds"; FCP "roughly 2.7" vs "roughly 5.8 seconds"), https://web.dev/articles/optimize-lcp (data URL decode cost)

### Preconnect only to the one or two critical cross-origins, with crossorigin for CORS fetches
- Verdict: corrected
- Correction: The "about 10 s" idle close comes from the 2019 article ("the browser closes any connection that isn't used within 10 seconds"). It does not match current Chromium. In `net/socket/client_socket_pool_manager.cc` on `main`, `unused_idle_socket_timeout()` returns `kPreconnectIntervalSec = 60` (60 s). Used idle sockets stay for 300 s (`client_socket_pool.cc`). Write: "Chromium drops an unused preconnected socket after about 60 s (the 2019 web.dev article says 10 s). Servers and CDNs can close idle connections sooner." The rest is verified: web-features `link-rel-preconnect` (low 2020-01-15; Chrome 46, Firefox 39, Safari 11.1) and the course's Google Fonts example.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/net/socket/client_socket_pool_manager.cc, https://chromium.googlesource.com/chromium/src/+/main/net/socket/client_socket_pool.cc, https://web.dev/articles/preconnect-and-dns-prefetch

### Use dns-prefetch for less critical or probable origins, in a separate link tag
- Verdict: corrected
- Correction: Status and the "20–120 ms" figure are verified (web-features `link-rel-dns-prefetch`: baseline low 2025-09-15; Firefox 127 added HTTPS pages; iOS Safari 26). The advice to pair `dns-prefetch` with `preconnect` "as a fallback" is obsolete. `preconnect` has been Baseline widely available since 2022-07-15, so no current browser needs the fallback. Use `dns-prefetch` alone for low-certainty origins, and `preconnect` alone for critical ones. The Safari bug with a combined `rel` comes only from the 2019 article. I did not reproduce it (unverified).
- Evidence: web-features `link-rel-preconnect` (high 2022-07-15), BCD `html.elements.link.rel.dns-prefetch`, https://web.dev/articles/preconnect-and-dns-prefetch

### Preload only late-discovered critical resources
- Verdict: verified
- Evidence: web-features `link-rel-preload` (low 2021-01-26; Chrome 50, Firefox 85, Safari 11.1), https://web.dev/articles/fetch-priority ("Preload is a mandatory fetch, not a hint")

### Always set as, and set crossorigin for fonts and fetch preloads
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload ("`font` and `fetch` preloading requires the `crossorigin` attribute to be set"; `as` list fetch, font, image, script, style, track), BCD `html.elements.link.rel.preload.as-track` (Firefox false), https://web.dev/articles/preload-critical-assets ("Omitting the `as` attribute… can also cause some resources, such as scripts, to be fetched twice")

### Add fetchpriority="high" to image preloads that are LCP candidates
- Verdict: corrected
- Correction: The Status versions are wrong. BCD 8.1.2 gives `fetchpriority` on `<img>`/`<link>`/`<script>` and `fetch()` `priority` as Chrome 101. The `fetchpriority` parameter in the `Link` header is Chrome 103. web-features `fetch-priority` shows Chrome 103 at the feature level, because it takes the latest key. Replace "Chrome 101/102" with "Chrome 101 (Link header: 103)". Baseline low 2024-10-29, Firefox 132 and Safari 17.2 are correct. The mechanism is verified: images start Low, and "As of Chrome 117, the first 5 large images are set to 'Medium'".
- Evidence: BCD `html.elements.img.fetchpriority`, `html.elements.link.fetchpriority`, `http.headers.Link.fetchpriority`, web-features `fetch-priority`, https://web.dev/articles/fetch-priority, https://web.dev/articles/preload-responsive-images

### Preload responsive images with imagesrcset and imagesizes, and no href
- Verdict: verified
- Evidence: https://web.dev/articles/preload-responsive-images (updated 2026-07-10: "responsive preload has no notion of 'order' or 'first match'"; header/103 warning; late `<meta name="viewport">` risk), web-features `preloading-responsive-images` (high 2026-06-11; Chrome 73, Firefox 78, Safari 17.2)

### Place preloads deliberately in the head
- Verdict: verified
- Evidence: https://web.dev/articles/fetch-priority ("Tips for using preloads"), web-features `modulepreload` (high 2026-03-18)

### Mark the likely LCP image fetchpriority="high" and hidden above-the-fold images low
- Verdict: verified
- Evidence: https://web.dev/articles/fetch-priority ("the LCP improved from 2.6s to 1.9s"; CDN HTTP/2 prioritization caveat), https://web.dev/articles/optimize-lcp

### Reprioritize scripts with fetchpriority instead of preload hacks
- Verdict: verified
- Note: This item states correctly that early CSS "drops only to High with `low`". The same rule contradicts the "low-priority `rel=preload as=style`" wording in two other items of this file (see the corrections above).
- Evidence: https://web.dev/articles/fetch-priority (table rows "Script (async/defer)" Low, "CSS (early**)")

### Give fetch() calls explicit priority: high for user-driven data, low for background data
- Verdict: verified
- Evidence: BCD `api.fetch.options_parameter.priority` (Chrome 101, Firefox 132, Safari 17.2), https://web.dev/articles/fetch-priority (row "XHR/fetch* (async)" High)

### Prefetch next-navigation resources only for high-confidence flows, and respect Save-Data
- Verdict: verified
- Note: BCD notes "Requires secure context". The HTTP cache is partitioned by top-level site, so a prefetch helps only same-site next pages (file 04 says the same).
- Evidence: BCD `html.elements.link.rel.prefetch` (Safari 13.1 flag), web-features `link-rel-prefetch` (not Baseline), `savedata` (Chromium only), https://web.dev/articles/fetch-priority (row "Prefetch" Lowest)

### Send critical hints as HTTP Link headers or 103 Early Hints when HTML is slow
- Verdict: corrected
- Correction: (1) BCD notes for `http.status.103` in Chrome and Safari: "Supported in HTTP/2 and later only". The Chrome doc says "most browsers will only accept them over those protocols". The example header line `HTTP/1.1 103 Early Hints` is ignored by Chrome and Safari over HTTP/1.1, so show it as an HTTP/2+ response. (2) Add the Chrome limits: 103 works "Only… for navigation requests". "Only cacheable resources can be preloaded using Early Hints or the resource will be double fetched". A cross-origin redirect on the final response drops the hints. The version data is verified: 103 in Chrome 103, Firefox 120 (preload 123) and Safari 17 (preconnect only). `Link` `fetchpriority` is supported in Chrome 103, Firefox 132 and Safari 17.2.
- Evidence: BCD `http.status.103`, `http.status.103.preload`, https://developer.chrome.com/docs/web-platform/early-hints (last updated 2026-07-10, "Current limitations")

### Serve images at display size times DPR, and cap at about 2x
- Verdict: verified
- Evidence: https://web.dev/learn/performance/image-performance ("In most cases, the human eye is unable to benefit from a DPR of 3")

### Use srcset width descriptors together with sizes for fluid images
- Verdict: corrected
- Correction: (1) The Status is stale. Safari 27.0 (released 2026-09-14) added `sizes="auto"` according to the WebKit Safari 27 release notes. BCD 8.1.2 and web-features 3.39.0 do not list it yet. With Chrome 126, Firefox 150 and Safari 27, the feature reaches Baseline newly available (2026-09-14) when the data updates. (2) Write the example with a fallback list, because older Safari ignores a bare `auto` and falls back to `100vw`: `sizes="auto, (min-width: 1024px) 400px, 50vw"`. MDN: "you can include fallback sizes after `auto`". "Without `sizes` the default is 100vw" is correct (MDN: "it has a default value of `100vw`").
- Evidence: https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ (section "Responsive images"), https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img, BCD `html.elements.img.sizes.auto`

### Use x descriptors for images that have a fixed CSS size
- Verdict: verified
- Evidence: https://web.dev/learn/performance/image-performance

### Serve AVIF and WebP with a legacy fallback through picture type sources
- Verdict: verified
- Evidence: web-features `avif` (low 2024-01-25, high 2026-07-25), `webp` (low 2020-09-16), `picture`, https://web.dev/learn/performance/image-performance ("greater than 50% savings when compared to JPEG in some cases")

### Use picture media sources to cap sizes on small screens or to art-direct
- Verdict: verified
- Note: `(max-width: 560px)` and `(min-width: 561px)` leave a gap at fractional viewport widths such as 560.5 px, where no source matches and the `<img>` fallback is used. Use range syntax, for example `(width <= 560px)` and `(width > 560px)`.
- Evidence: https://web.dev/learn/performance/image-performance ("the media query on `<src>` is a command to be followed by the browser")

### Negotiate the image format on the server with Accept and Vary, or use an image CDN
- Verdict: verified
- Evidence: https://web.dev/learn/performance/image-performance (Accept + `Vary`), https://web.dev/articles/optimize-lcp (same-origin image CDN proxy)

### Keep the number of image variants small
- Verdict: verified
- Evidence: https://web.dev/learn/performance/image-performance ("find a balance, generate a reasonable number of image candidates")

### Choose lossy or lossless per image and tune quality by eye
- Verdict: verified
- Note: The Impact line "often halves the size" is the author's estimate. The course does not say it.
- Evidence: https://web.dev/learn/performance/image-performance (chroma-subsampling note; lossless list GIF, PNG, WebP, AVIF)

### Use SVG for line art, diagrams and charts, and optimize it like text
- Verdict: verified
- Evidence: https://web.dev/learn/performance/image-performance (svgo, "minification and compression apply")

### Lazy-load offscreen images natively, and never the LCP image
- Verdict: verified
- Note: Before Safari 27, WebKit preloaded `<picture>` `<source>` candidates even when the inner `<img>` had `loading=lazy`. Safari 27 fixed this (177833110).
- Evidence: web-features `loading-lazy` (low 2023-12-19, high 2026-06-19), BCD `html.elements.img.loading` (Chrome 77, Firefox 75, Safari 15.4), `html.elements.iframe.loading` (Firefox 121, Safari 16.4), https://web.dev/articles/optimize-lcp ("Never lazy-load your LCP image"), https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

### Decode images that JS inserts with img.decode() before you attach them
- Verdict: verified
- Evidence: BCD `html.elements.img.decoding` (Chrome 65, Firefox 63, Safari 11.1), `api.HTMLImageElement.decode` (Chrome 64, Firefox 68, Safari 11.1), https://www.tunetheweb.com/blog/what-does-the-image-decoding-attribute-actually-do/ ("Chrome and Safari use `sync`… Firefox uses `async` by default")

### Re-encode video with a modern codec, strip unused audio, and tune CRF
- Verdict: verified
- Evidence: https://web.dev/learn/performance/video-performance (`-an`, `-crf`), https://developers.google.com/media/vp9/bitrate-modes and https://wiki.webmproject.org/ffmpeg/vp9-encoding-guide (constant quality needs `-crf` together with `-b:v 0`, as in the example; the VP9 CRF range is 0–63). trac.ffmpeg.org was behind a bot wall and I could not read it.

### List video sources most-efficient first, with a codecs-qualified type
- Verdict: verified
- Evidence: caniuse `av1` (Safari "a #4": "Supported only on devices with hardware decoder"), caniuse `webm` (Safari "y #8": "Does not support alpha transparency"), https://web.dev/learn/performance/video-performance

### Replace animated GIFs with muted, looping, inline autoplay video
- Verdict: verified
- Evidence: https://web.dev/learn/performance/video-performance, BCD `html.elements.video.playsinline` (Chrome 75, Safari 10, Firefox false)

### Lazy-load below-the-fold autoplay videos with a poster and IntersectionObserver
- Verdict: verified
- Evidence: https://web.dev/learn/performance/video-performance ("`<video>` elements with the `autoplay` attribute specified begin downloading immediately"), web-features `intersection-observer` (widely available)

### Use preload="none" or "metadata" plus a poster for click-to-play video
- Verdict: verified
- Note: Since Chrome 64, Chrome desktop already defaults to `metadata` when there is no `preload` attribute. So in Chrome only `preload="none"` changes behavior.
- Evidence: https://web.dev/learn/performance/video-performance, https://chromestatus.com/feature/5682169347309568

### Preload the video poster with high priority only when it is the LCP element
- Verdict: verified
- Evidence: https://web.dev/learn/performance/video-performance (poster preload + "the first frame of a video file—once painted—will be considered as an LCP candidate")

### Add loading="lazy" to below-the-fold video and audio as progressive enhancement
- Verdict: verified
- Evidence: BCD `html.elements.video.loading` / `audio.loading` (experimental; Chrome 150, 148–149 partial "Not supported for `<source>`"; Firefox and Safari false), web-features `loading-lazy-media` (not Baseline), chromestatus 5200068565139456 JSON (Firefox "Implementation under way: D278547"; Safari "Support", "Implementation under way: WebKit PR 58220"; spec whatwg/html PR 11980), https://developer.chrome.com/release-notes/148

### Put a facade in front of third-party video embeds
- Verdict: verified
- Note: Lighthouse 13 removed the `third-party-facades` audit, because "some developers expressed concern using non-affiliated third-party facades". The lever still works, but no audit reports it now.
- Evidence: https://web.dev/learn/performance/video-performance ("YouTube embeds block the main thread for more than 1.7 seconds"), https://developer.chrome.com/blog/lighthouse-13-0

### Inline @font-face declarations in the head so fonts are discovered early
- Verdict: verified
- Evidence: https://web.dev/learn/performance/optimize-web-fonts ("The browser only begins downloading font files after all render-blocking resources has been loaded")

### Preload only the one or two critical fonts, with as="font" and crossorigin
- Verdict: verified
- Evidence: https://web.dev/learn/performance/optimize-web-fonts, https://web.dev/articles/font-best-practices ("`preload` ignores `unicode-range` declarations"), https://developer.chrome.com/blog/lighthouse-13-0 (`preload-fonts` removed "due to risks of over recommending")

### Never inline font files as base64
- Verdict: verified
- Evidence: https://web.dev/learn/performance/optimize-web-fonts, https://web.dev/articles/preload-scanner

### Self-host fonts on a fast CDN; if third-party, preconnect to both origins
- Verdict: verified
- Note: HTTP cache partitioning (Chrome 86+) removes any cross-site cache benefit of shared font hosts. This supports self-hosting.
- Evidence: https://web.dev/articles/font-best-practices (Web Almanac 2020 finding; "If you have slow servers, don't use a CDN or HTTP/2…"), https://developer.chrome.com/blog/http-cache-partitioning

### Serve WOFF2 only
- Verdict: verified
- Evidence: caniuse `woff2` (Safari note "Supported only on Safari for Mac OS Sierra"), BCD `css.at-rules.font-face.WOFF_2` (Chrome 36, Firefox 39, Safari 10), https://web.dev/learn/performance/optimize-web-fonts ("up to 30% better than WOFF")

### Subset fonts and map subsets with unicode-range
- Verdict: verified
- Note: Safari 27 "Fixed an issue where a font was downloaded despite no characters in the document falling within its unicode-range" (140674753). Before Safari 27, subsets could download when not needed.
- Evidence: https://web.dev/learn/performance/optimize-web-fonts (glyphhanger, subfont, `text=`), https://web.dev/articles/font-best-practices, https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

### Choose font-display on purpose: optional for performance, swap for brand text
- Verdict: corrected
- Correction: (1) The initial value of `font-display` is `auto`, not `block`. `auto` means the strategy is defined by the user agent. Chromium, Firefox and Safari implement it as about a 3 s block. The course's "The default value for `font-display` is `block`" is imprecise. Write: "The default (`auto`, which browsers treat like `block`)". (2) "Values other than `auto`/`block` keep text visible, so LCP does not wait" is true only for `swap`. `fallback` and `optional` keep a block period of about 100 ms (web.dev table), so text can stay invisible and LCP can wait up to about 100 ms. The Safari timeout correction is verified: WebKit (2016) "will show this invisible text for a maximum of 3 seconds".
- Evidence: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@font-face/font-display, https://web.dev/articles/font-best-practices (table Block 2–3 s / Swap 0 ms / Fallback 100 ms + 3 s / Optional 100 ms + none), https://webkit.org/blog/6643/improved-font-loading/

### Match fallback font metrics to cut swap layout shift
- Verdict: verified
- Note: On its own, the `size-adjust` descriptor is Baseline widely available: web-features puts `css.at-rules.font-face.size-adjust` under `font-size-adjust` (key status low 2023-09-18, high 2026-03-18). File 01 says the same. Only the three override descriptors are not Baseline, and Safari has them only in Technology Preview.
- Evidence: BCD `css.at-rules.font-face.size-adjust` (Chrome 92, Firefox 92, Safari 17), `ascent-override`/`descent-override`/`line-gap-override` (Chrome 87, Firefox 89, Safari "preview"), web-features `font-metric-overrides` (not Baseline)

### Use fewer font files: system-ui, variable fonts, SVG icons
- Verdict: verified
- Evidence: web-features `font-family-system` (low 2021-09-07, high 2024-03-07), `font-variation-settings` (low 2018-09-05), https://web.dev/articles/font-best-practices

---

## Cross-file conflicts

1. Fetch Priority Chrome version. 02 says "Chrome 101/102". 01 (line 328) says "Chrome 102". 03 (line 426) says "Chrome 102/103". 04 says "Chrome 101" (lines 44, 262) and "Chrome 101/102" (line 245). 16 (line 213) says "Chrome/Edge 103". Truth (BCD 8.1.2): Chrome 101 for the HTML attribute and `fetch()` `priority`, Chrome 103 for the `Link`-header parameter. web-features gives 103 at the feature level. All files need the same line: "Chrome 101 (Link header 103)".
2. Loading non-critical CSS. 01 (lines 443–449) recommends `media="print" onload="this.media='all'"` and says "Do not use the old `rel=preload` + `onload` swap… (priority inversion)". 02 recommends the reverse ("Do not use the old `media="print" onload`… A low-priority `rel=preload as=style` works better"). Facts from the web.dev table: the media swap loads at Lowest and late. A style preload loads at Highest, or High with `fetchpriority="low"`. Choose by urgency, and state that both need an inline handler, which a strict CSP blocks (18-skills-survey-github line 118).
3. `sizes="auto"` in Safari. 02, 03 (line 153) and 16 (line 216) say "no Safari". 04 (line 318) says Safari 27.0 added it. The WebKit Safari 27 notes confirm 04. BCD 8.1.2 has not caught up.
4. Preconnect idle timeout. 02, 04 (line 118) and 16 (line 88) all repeat the 2019 "10 seconds". Current Chromium `main` uses 60 s for unused idle sockets (`kPreconnectIntervalSec = 60`).
5. 103 Early Hints over HTTP/1.1. The examples in 02 and 01 (line 116) use `HTTP/1.1 103 Early Hints`, but 01's own Status line, 03 (line 558) and 04 (line 581) say that Chrome and Safari accept 103 only over HTTP/2+. The examples should show HTTP/2 framing or say "HTTP/2+ only".
6. Caching personalized HTML. The 02 example uses `Cache-Control: private, no-store` for a logged-in dashboard. 03 (line 970), 04 (line 614), 07 (line 384) and 17-collections-batch-01 (line 364) say to use `no-cache`/`private, no-cache` for signed-in HTML and to keep `no-store` for sensitive pages, because of bfcache.
7. `decoding="async"`. 04 (line 366) recommends `decoding="async"` on large non-critical images. 02 calls it a micro-optimization and warns about a flash of background. This is a tension of emphasis, not of fact. Both agree that `img.decode()` is the main tool for JS-inserted images.
8. `font-display: swap` block period. 02 says "`swap`: 0 ms block" (web.dev table). 01 (line 578) says "`swap` and `optional` use an 'extremely small' block period" (spec/MDN wording). They agree in practice, but 02's "`optional`: about 100 ms" and 01's "extremely small" should use the same wording.
9. Current Chrome stable. 02 and 04 (line 3) say "Chrome 153". chromiumdash shows two-week releases, with Chrome 154 stable on 2026-09-22.

## Missing but important

1. Long-lived caching for fingerprinted subresources: `Cache-Control: public, max-age=31536000, immutable`. The Lighthouse 13 `use-cache-insight` wants at least 30 days for fonts, images, media, scripts and styles. `immutable`: Firefox 49, Safari 11; Chrome ignores it (BCD). Sources: https://developer.chrome.com/docs/performance/insights/cache, https://web.dev/articles/http-cache
2. `stale-while-revalidate` for short-TTL HTML at the CDN and in the browser, which completes the "cache HTML briefly" item. BCD: Chrome 75, Firefox 68, Safari 14. Source: https://web.dev/articles/stale-while-revalidate
3. HTTP cache partitioning, which changes the third-party font/library trade-off and makes cross-site `rel=prefetch` useless. Source: https://developer.chrome.com/blog/http-cache-partitioning
4. `<link rel="modulepreload">` for critical ES-module dependency graphs, to flatten import waterfalls. It is Baseline widely available (2026-03-18). The notes mention it only for placement. Sources: https://web.dev/articles/modulepreload, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload
5. CSS `image-set()` with `type()` and resolution for responsive or format-negotiated CSS background images. It is Baseline widely available (web-features `image-set`, high 2026-03-18). The notes cover background LCP images only through preload. Source: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/image/image-set
6. Compression Dictionary Transport (`Use-As-Dictionary`, `dcb`/`dcz`) for delta updates of versioned bundles. It is Chrome 130+ only; Firefox has it behind a flag. File 04 covers it; 02 mentions it only in Status. Source: https://developer.chrome.com/blog/shared-dictionary-compression
7. Measure real server time when you use 103 or an early flush. TTFB (`responseStart`) counts the 103. Use `finalResponseHeadersStart` for the final response (Chrome changed `responseStart` in 115 and reverted it in 133). Sources: https://web.dev/articles/ttfb, https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/finalResponseHeadersStart
8. HSTS (and the preload list) to remove the HTTP→HTTPS redirect hop that the redirect item asks you to remove. Sources: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security, https://hstspreload.org/
9. Server and CDN support for the RFC 9218 `Priority` header. Chrome 124 and Firefox 128 send it (BCD; no Safari). `fetchpriority` changes the order on the wire only if the server or CDN honors it. The fetch-priority article says: "CDNs don't implement HTTP/2 prioritization uniformly". Sources: https://www.rfc-editor.org/rfc/rfc9218.html, https://web.dev/articles/fetch-priority
