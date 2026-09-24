# Verify: 04-html-and-http-loading-features.md

Summary: 48 items checked. 37 verified, 11 corrected, 0 disputed, 0 unverified.

Checks run (2026-09-22/23):
- BCD 8.1.2 (npm latest, built 2026-09-17) and web-features 3.39.0 (npm latest): queried every Status key in the notes with a local script (`raw/verify/04/q.py`).
- webstatus.dev API for 23 feature ids (saved as `raw/verify/04/ws-*.json`). `no-vary-search` returns 404 (no such feature id).
- chromestatus API: JPEG XL (5114042131808256), prerender-until-script (6324676351623168), Document-Isolation-Policy, HTTPS-RR HTTP/3.
- chromiumdash milestone schedule (152-155) and current stable releases; Mozilla product-details (Firefox 156.0.1 stable).
- Re-read the saved sources in `raw/html-latest/` (web.dev, developer.chrome.com, MDN source, WHATWG HTML, WebKit Safari 27 post) and grepped each claim. Fetched fresh: MDN Firefox 132 notes, blink-dev "Intent to Extend Experiment" (2026-06-01), Lighthouse `changelog.md` (main), RFC 9842, web.dev `link-prefetch`.

File-level corrections (header, line 3):
- "Current stable at research time: Chrome 153 (154 beta)": Chrome 154 became stable on 2026-09-22 (chromiumdash: 154.0.8037.58, 18:08 UTC). Chrome is now on a 2-week cadence: 153 = 2026-09-08, 154 = 2026-09-22, 155 = 2026-10-06. Version-based claims age twice as fast as before.
- "webkit.org (Safari 27 release notes, 2026-09-14)": Safari 27 shipped 2026-09-14 (web-features release data), but the "WebKit Features for Safari 27.0" post is dated 2026-09-17 (`article:published_time`), modified 2026-09-21.

---

### Never ship a parser-blocking `<script src>` in `<head>`: use `defer` or `type="module"`
- Verdict: verified
- Evidence: BCD `html.elements.script.defer`/`async`; web-features `js-modules` (low 2018-05-09, high 2020-11-09); https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script

### Use `async` only for independent scripts, and set their priority explicitly
- Verdict: verified
- Note: web.dev priority table puts "Script (async/defer)" at Low, and `fetchpriority="low"` moves it to Lowest. The late-body `fetchpriority="low"` example is web.dev's own ("blocking_but_unimportant.js").
- Evidence: https://web.dev/articles/fetch-priority ; BCD `html.elements.script.fetchpriority` (Chrome 101, Firefox 132, Safari 17.2); https://api.webstatus.dev/v1/features/fetch-priority (newly 2024-10-29)

### Drop `nomodule` fallback bundles
- Verdict: verified
- Evidence: BCD `html.elements.script.nomodule` (Chrome 61, Edge 16, Firefox 60, Safari 11); web-features `js-modules` high 2020-11-09

### Add `blocking="render"` only when the first frame is wrong without that resource
- Verdict: corrected
- Correction: The Why sentence "Scripts are not render-blocking by default (a plain head script blocks parsing, not rendering)" copies MDN, but the HTML standard says the opposite: "A script element el is implicitly potentially render-blocking if el's type is "classic", el is parser-inserted, and el does not have an async or defer attribute." Also, the whole document is render-blocked while its `<body>` element is null. Replace with: "A parser-inserted classic script without `async`/`defer` already blocks rendering. `async`, `defer`, module and script-inserted scripts do not, so `blocking="render"` only changes behavior on those (and on script-inserted `<link>`/`<style>`). Elements can only be added to the render-blocking set while `<body>` does not exist yet." Support data is correct: Chrome 105, Safari 18.2, Firefox no (webstatus `blocking-render` limited).
- Evidence: https://html.spec.whatwg.org/multipage/scripting.html#implicitly-potentially-render-blocking ; https://html.spec.whatwg.org/multipage/dom.html#render-blocking-mechanism ("allows adding render-blocking elements ... the body element of document is null"); https://api.webstatus.dev/v1/features/blocking-render

### Use `<link rel="expect" href="#id" blocking="render">` to hold first paint until a key element is parsed
- Verdict: verified
- Evidence: https://html.spec.whatwg.org/multipage/links.html#link-type-expect (blocks while the indicated element "is on a stack of open elements"; unblocks when readiness is no longer "loading"); BCD `html.elements.link.rel.expect` Chrome 124, experimental; webstatus `link-rel-expect` limited

### Preconnect to at most a few critical cross-origin origins, with the correct `crossorigin`
- Verdict: verified
- Note: web.dev says "the browser closes any connection that isn't used within 10 seconds" (not only Chrome). The article is from 2019 (02 notes flag the same).
- Evidence: https://web.dev/articles/preconnect-and-dns-prefetch ; BCD `html.elements.link.rel.preconnect`; web-features `link-rel-preconnect` (high 2022-07-15)

### Use `dns-prefetch` for the other cross-origin origins, in a separate `<link>`
- Verdict: verified
- Evidence: web-features `link-rel-dns-prefetch` (low 2025-09-15; Firefox 127, Safari iOS 26); BCD `http.headers.X-DNS-Prefetch-Control` (no Safari, non-standard); https://web.dev/articles/preconnect-and-dns-prefetch ("20–120 ms"; Safari cancels preconnect in a combined tag)

### Preload only critical resources that the preload scanner cannot see, with matching attributes
- Verdict: corrected
- Correction: "A preload is a mandatory high-priority fetch" is wrong. A preload is a mandatory fetch at the default priority of its `as` destination; web.dev: "it still fetches the resource with the default priority", "preload as="style" uses Highest priority", and "Image preloads have a Low or Medium priority by default". Use `fetchpriority` on the `<link>` to change it. The rest (as/crossorigin/type/media rules, double fetch on mismatch, `as="track"` not in Firefox, Baseline high 2023-07-26) is correct.
- Evidence: https://web.dev/articles/fetch-priority (table notes and "Tips for using preloads"); BCD `html.elements.link.rel.preload.*`; web-features `link-rel-preload`

### Preload a responsive LCP image with `imagesrcset` and `imagesizes` that match the `<img>`
- Verdict: verified
- Evidence: web-features `preloading-responsive-images` (low 2023-12-11, high 2026-06-11); BCD `html.elements.link.imagesrcset` (Chrome 73, Firefox 78, Safari 17.2); https://developer.chrome.com/docs/web-platform/early-hints ("Current limitations": responsive preloads "may not be supported using HTTP <link> headers")

### Use `modulepreload` to flatten the module dependency waterfall
- Verdict: verified
- Note: MDN also lists `as="text"` and worker destinations as valid; any other value fires `error`. web.dev adds an ordering tip: import preloads "should run after the script tag that needs the import" so the entry can compile while dependencies load; the example puts them before the `<script>`.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload ; BCD `html.elements.link.rel.modulepreload.as-json` (Chrome 147, Safari 26.2), `.as-style` (Chrome 147, experimental); web-features `modulepreload` (high 2026-03-18); https://web.dev/articles/fetch-priority

### Use `rel="prefetch"` only for subresources of the likely next page
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/prefetch ; BCD `html.elements.link.rel.prefetch` (Safari flag `LinkPrefetch`; "Requires secure context" notes); https://web.dev/articles/link-prefetch (Lowest priority)

### Remove `<link rel="prerender">`; it is deprecated and does not prerender
- Verdict: verified
- Evidence: BCD `html.elements.link.rel.prerender` (deprecated, non-standard, Chrome 63 partial "Triggers NoState Prefetch"); https://developer.chrome.com/docs/web-platform/prerender-pages

### Give the LCP image `fetchpriority="high"` and deprioritize competing images
- Verdict: corrected
- Correction: Status "`Link:` header `fetchpriority` param same versions" is wrong for Chrome: BCD `http.headers.Link.fetchpriority` = Chrome 103, Firefox 132, Safari 17.2 (the `<img>`/`<link>`/`<script>` attributes are Chrome 101). This is why webstatus lists Chrome 103 for `fetch-priority`. Everything else (Low start, Chrome 117 first-5-large-images at Medium, DevTools LCP request discovery checks, no `fetchpriority` on iframe/video/CSS, SVG elements Firefox 140 only) is correct.
- Evidence: BCD `http.headers.Link.fetchpriority`, `svg.elements.image.fetchpriority`; https://api.webstatus.dev/v1/features/fetch-priority ; https://web.dev/articles/fetch-priority ; https://developer.chrome.com/docs/performance/insights/lcp-discovery

### Set `priority` on `fetch()` so background requests do not compete with user-critical data
- Verdict: verified
- Evidence: https://web.dev/articles/fetch-priority ("The browser executes fetch with a high priority"); BCD `api.fetch.options_parameter.priority` (Chrome 101, Firefox 132, Safari 17.2)

### Never lazy-load the LCP or first-viewport images; lazy-load everything below the fold
- Verdict: verified
- Note: Safari 27 fixed `<picture> <source>` candidates "being speculatively preloaded even when the inner <img> has loading=lazy" (177833110), so older Safari could fetch lazy `<picture>` sources early.
- Evidence: https://web.dev/articles/browser-level-image-lazy-loading (1250/2500 px, Chrome 121 carousels, `display:none` vs `opacity:0`, `loading="auto"` deprecated); web-features `loading-lazy` (low 2023-12-19, high 2026-06-19); https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

### Lazy-load offscreen iframes and put heavy embeds behind a facade
- Verdict: verified
- Evidence: https://web.dev/articles/iframe-lazy-loading ("around 500KB"; the attribute "doesn't apply these heuristics"); BCD `html.elements.iframe.loading` (Chrome 77, Firefox 121, Safari 16.4)

### Use `sizes="auto"` on lazy images whose rendered width is only known after layout
- Verdict: verified
- Note: The WebKit post that lists it is dated 2026-09-17 (Safari 27 shipped 2026-09-14). It also lists "Fixed remaining issues with <img sizes="auto">" (174684058). BCD 8.1.2, web-features and webstatus still show no Safari, so webstatus says "limited" today.
- Evidence: https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ; BCD `html.elements.img.sizes.auto` (Chrome 126, Firefox 150); https://api.webstatus.dev/v1/features/sizes-auto ; MDN `<img>` source (fallback order text matches)

### Serve right-sized, modern-format images with `srcset`/`sizes` and `<picture><source type>`
- Verdict: verified
- Note (JPEG XL, changes soon): chromestatus "JPEG XL decoding support (image/jxl) in blink" (jxl-rs) has a ship stage at Chrome 155 (stable 2026-10-06) with an intent thread; today Chrome 145+ is flag-only (`#enable-jxl-image-format`). BCD lists Firefox as "preview" (Nightly only). Keep the fallback.
- Evidence: web-features `srcset`, `picture`, `avif` (high 2026-07-25), `webp`, `jpegxl`; BCD `mediatypes.image.jxl`; https://chromestatus.com/feature/5114042131808256 ; https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=155

### Always set `width` and `height` on `<img>`, `<video>` and `<source>` to reserve space
- Verdict: verified
- Evidence: BCD `html.elements.img.aspect_ratio_computed_from_attributes` (Chrome 79, Firefox 71, Safari 15; 14 partial), `html.elements.video.aspect_ratio_computed_from_attributes` (Safari 14), `html.elements.source.width` (Chrome 90, Firefox 108, Safari 15); web-features `overflow-anchor` (low 2026-09-14, Safari 27)

### Use `decoding="async"` and `img.decode()` so image decode never holds up a frame
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode (EncodingError cases); MDN `<img>` `decoding` text; BCD `api.HTMLImageElement.decode`, `html.elements.img.decoding`; web-features `createimagebitmap` (high 2026-06-11); Safari 27 fix 178118012

### Lazy-load offscreen `<video>`/`<audio>` and keep `preload` minimal
- Verdict: verified
- Evidence: BCD `html.elements.video.loading` (Chrome 150; 148-149 partial "Not supported for <source>"; experimental); https://api.webstatus.dev/v1/features/loading-lazy-media ; https://developer.chrome.com/blog/new-in-chrome-148 ; https://web.dev/articles/lcp (video: poster load or first frame, "whichever is earlier")

### Keep critical resources discoverable by the preload scanner
- Verdict: verified
- Evidence: https://web.dev/articles/preload-scanner ; https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ (fixes 180170656 `@import` after `@layer`, 175094037 empty `type`, 173378582 disabled stylesheets)

### Put a `media` attribute on stylesheets that do not apply to the first render
- Verdict: corrected
- Correction: The Do line "Give non-critical stylesheets `fetchpriority="low"`" needs a scope limit. On a parser-inserted `<link rel="stylesheet">` in `<head>` whose `media` matches, `low` does not remove render blocking; it only makes the blocking file arrive later and delays FCP/LCP. Use `fetchpriority="low"` only on stylesheets that are already non-blocking: non-matching `media`, the web.dev pattern `<link rel="preload" as="style" fetchpriority="low" onload="this.rel='stylesheet'">`, or late CSS. Also add from web.dev: non-matching CSS "is not fetched by the preload scanner" and is fetched "very late, even with fetchpriority="high"". The spec and priority claims are correct.
- Evidence: https://html.spec.whatwg.org/multipage/links.html#link-type-stylesheet ("If el's media attribute's value matches the environment and el is potentially render-blocking, then block rendering"); https://web.dev/articles/fetch-priority

### Prefetch likely next pages with document rules and `moderate` eagerness
- Verdict: verified
- Evidence: https://developer.chrome.com/docs/web-platform/prerender-pages (updated 2026-01-23); MDN Speculation Rules API ("Chrome for example caches them for 5 minutes"; cross-site only without cookies); BCD `html.elements.script.type.speculationrules.*` (Safari 26.2 flag "SpeculationRules prefetch", eagerness partial "Only conservative is supported for document rules"); webstatus `speculation-rules` limited

### Choose eagerness per rule, knowing Chrome's triggers and limits
- Verdict: verified
- Evidence: https://developer.chrome.com/docs/web-platform/prerender-pages ("Eagerness" and "Chrome limits": immediate 50/10, others 2 FIFO; eager changed in Chrome 143; mobile heuristics Aug 2025 / Jan 2026)

### Prerender only same-origin pages that are safe to run early, and defer side effects to activation
- Verdict: verified
- Evidence: MDN Speculation Rules API ("about the same amount of resources as rendering an iframe"; 204/205; `credentialed-prerender`); BCD `api.Document.prerendering` (Chrome 108), `http.headers.Supports-Loading-Mode` (Chrome 109), `...speculationrules.prerender` (Chrome 105)

### Deliver and manage speculation rules with HTTP headers
- Verdict: verified
- Evidence: MDN Speculation Rules API (`'inline-speculation-rules'`, `application/speculationrules+json`, `Clear-Site-Data` prefetchCache/prerenderCache); https://developer.chrome.com/docs/web-platform/prerender-pages ("Speculation rules in subframes are not acted upon"); BCD `http.headers.Speculation-Rules` (Chrome 121, Safari 26.2 flag), `Sec-Speculation-Tags` (Chrome 136), `Clear-Site-Data.prefetchCache` (Chrome 138)

### Send `No-Vary-Search` for query parameters that do not change the response
- Verdict: corrected
- Correction: HTTP-cache support is Chrome desktop 141 but Chrome Android 143 (BCD note: "Before Chrome 143, HTTP cache is not supported" on Android); Firefox 154; Safari no. Speculation prefetch Chrome 121, prerender Chrome 127 are correct. webstatus has no `no-vary-search` feature id (404), so cite BCD only.
- Evidence: BCD `http.headers.No-Vary-Search`, `.http_cache`, `.speculation_rules_prefetch`, `.speculation_rules_prerender`; https://api.webstatus.dev/v1/features/no-vary-search (404)

### Do not depend on `prerender_until_script` yet; if you test it, keep a `prefetch` fallback
- Verdict: verified
- Note: The extension ends at milestone 154, and Chrome 154 became stable on 2026-09-22, so the trial is in its last milestone unless extended again. chromestatus (last updated 2026-06-03) has no ship stage. The blink-dev reason is "Developers have reported that it is currently slower than prefetch", with a suspected cause (`Prerender2FallbackPrefetchSpecRules` not yet on by default).
- Evidence: https://www.mail-archive.com/blink-dev@chromium.org/msg16667.html (OT 144-150, "extension 1 end milestone 154"); https://chromestatus.com/feature/6324676351623168 ; https://developer.chrome.com/blog/prerender-until-script-origin-trial

### Send 103 Early Hints for critical origins and assets while the server builds the HTML
- Verdict: verified
- Evidence: https://developer.chrome.com/docs/web-platform/early-hints (updated 2026-07-10, "Current limitations"); https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/103 ("Browsers only process the first early hints response"); BCD `http.status.103.*` (preload: Chrome 103, Firefox 123, Safari no)

### Do not use HTTP/2 Server Push; it is removed
- Verdict: corrected
- Correction: The Why overstates the cited Chrome post. It says analysis had "mixed results (Chrome, Akamai), without a clear net performance gain and in many cases performance regressions", and usage was 1.25% of HTTP/2 sites, later 0.7%. "Pushed resources the browser already had" is a known failure mode, but that post does not state it. Chrome 106 disabled push by default; Firefox 132 set `network.http.http2.allow-push` to `false`, and MDN says push "is no longer supported by any other major browser".
- Evidence: https://developer.chrome.com/blog/removing-push ; https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/132

### Cache hashed assets forever and revalidate HTML
- Verdict: verified
- Evidence: BCD `http.headers.Cache-Control.immutable` (Firefox 49, Safari 11, Chrome no, Edge 15-79), `.stale-while-revalidate` (Chrome 75, Firefox 68, Safari 14); Safari 27 Cache-Control fixes 179865576, 179870099

### Compress text with Zstandard or Brotli, and use dictionary compression for versioned bundles
- Verdict: verified
- Note: BCD lists Firefox as "preview" (Nightly, on by default) plus 145+ behind `network.http.dictionaries.enable`. RFC 9842 "Compression Dictionary Transport" (Standards Track, September 2025) confirms `Available-Dictionary` is the SHA-256 hash and the dcb/dcz headers carry a 32-byte SHA-256 digest.
- Evidence: https://www.rfc-editor.org/rfc/rfc9842.html ; BCD `http.headers.Content-Encoding.zstd` (Safari 26.3), `.dcb`, `http.headers.Use-As-Dictionary`; https://api.webstatus.dev/v1/features/zstd (newly 2026-02-11); https://api.webstatus.dev/v1/features/compression-dictionary-transport (limited)

### Let servers and CDNs honor the `Priority` header
- Verdict: verified
- Evidence: BCD `http.headers.Priority` (Chrome 124, Firefox 128, Safari no); https://web.dev/articles/fetch-priority ("CDNs don't implement HTTP/2 prioritization uniformly")

### Use Client Hints for server-side adaptation only as a Chromium enhancement
- Verdict: corrected
- Correction: "`Sec-CH-*` 89-108" is wrong. The hints named in this item (`Sec-CH-DPR`, `Sec-CH-Width`, `Sec-CH-Viewport-Width`, `Sec-CH-Device-Memory`) are Chrome 97. `Sec-CH-UA*` hints are Chrome 89, and `Sec-CH-Viewport-Height` is Chrome 105. New fact worth a caveat: from Chrome 147, `Sec-CH-Device-Memory`/`Device-Memory` report 2, 4, 8, 16, 32 on desktop and 1, 2, 4, 8 on Android (before: 0.25-8). BCD also notes `RTT` is capped at 3000 ms and `Downlink` at 10 Mbps. Accept-CH Chrome 46, Critical-CH Chrome 91 (experimental) and the deprecated legacy names are correct.
- Evidence: BCD `http.headers.Accept-CH.Sec-CH-DPR` / `.Sec-CH-Width` / `.Sec-CH-Viewport-Width` / `.Sec-CH-Device-Memory` (97), `http.headers.Sec-CH-UA` (89), `http.headers.Accept-CH.Sec-CH-Viewport-Height` (105), `http.headers.Sec-CH-Device-Memory` notes, `http.headers.RTT`, `http.headers.Downlink`

### Respect `Save-Data` by sending less
- Verdict: verified
- Evidence: BCD `http.headers.Save-Data` (Chrome 49), `api.NetworkInformation.saveData` (Chrome 65); web-features `savedata` (not Baseline); https://developer.chrome.com/docs/web-platform/prerender-pages (Save-Data disables speculation)

### Let navigations skip service-worker startup with static routing and navigation preload
- Verdict: verified
- Evidence: https://developer.chrome.com/blog/service-worker-static-routing (`addRoutes`, string `urlPattern`, `{cacheName}` source, "We plan to remove registerRouter() in Chrome 125"); BCD `api.InstallEvent.addRoutes` (Chrome 123, Safari 27), `api.NavigationPreloadManager` (Chrome 59, Firefox 99, Safari 15.4); WebKit Safari 27 post

### Keep every page bfcache-eligible
- Verdict: corrected
- Correction: "A page with an `unload` listener is ineligible on desktop Chrome and Firefox" is out of date for Chrome. With the deprecation at 100% of page loads in Chrome 154 (stable 2026-09-22), Chrome no longer fires `unload` handlers by default ("unload handlers stop firing on pages unless a page explicitly opts in"), so they no longer block bfcache there. The exceptions are pages that opt back in with Permissions-Policy (Chrome 117+) and devices with the `ForcePermissionPolicyUnloadDefaultEnabled` enterprise policy. Firefox still makes such pages ineligible on desktop and Android (web.dev). The new risk in Chrome is data loss: code that flushes state in `unload` now does not run. Keep the Do line as is. The `no-store` (3 min vs 10 min, cookie eviction, WebSocket/WebTransport/WebRTC) and "Chrome (as of 149) and Safari" WebSocket claims are correct.
- Evidence: https://developer.chrome.com/docs/web-platform/deprecating-unload (updated 2026-07-14, table: 154, Sep 22 2026, 100%); https://web.dev/articles/bfcache ; https://developer.chrome.com/docs/web-platform/bfcache-ccns ; https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=154

### Send exit beacons with `fetchLater()` (or `sendBeacon`/`keepalive`), not `unload`
- Verdict: corrected
- Correction: The example is wrong for a "final beacon". `fetchLater('/rum', { body: JSON.stringify(stats) })` captures `stats` at call time; later changes are never sent. Abort and re-queue on each update with an `AbortController` (`signal` option), as in MDN's "Update a pending request" example, and check `result.activated` before re-queuing. Other claims are correct: sent when the page is destroyed or enters bfcache or after `activateAfter`; `ReadableStream` bodies and non-trustworthy URLs throw `TypeError`; `QuotaExceededError`; `connect-src`; Chrome 135 only; `keepalive` Firefox 133.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater ; BCD `api.Window.fetchLater`, `api.fetch.options_parameter.keepalive`; webstatus `fetchlater` limited

### Monitor why pages miss the bfcache
- Verdict: corrected
- Correction: Lighthouse has no `no-unload-listeners` audit. It was removed in Lighthouse 12.0.0 (2024-04-22, PR #15874): "Unload listeners are deprecated and are still flagged in the `deprecations` and `bf-cache` audits." Current Lighthouse is 13.5.0 (2026-09-17); `core/audits/bf-cache.js` exists and `no-unload-listeners.js` returns 404. Replace with "Lighthouse `bf-cache` and `deprecations` audits". web.dev still names the old audit (stale). `notRestoredReasons` Chrome 125 (experimental) is correct.
- Evidence: https://github.com/GoogleChrome/lighthouse/blob/main/changelog.md (12.0.0 section); https://raw.githubusercontent.com/GoogleChrome/lighthouse/main/core/audits/bf-cache.js ; BCD `api.PerformanceNavigationTiming.notRestoredReasons`

### Build menus, tooltips and dropdown panels with `popover` and invoker commands
- Verdict: verified
- Note: BCD marks `popover="hint"` as partial in Chrome 133-150 and Firefox 149-152 ("older version of the specification"); full support is Chrome 151 and Firefox 153, as the notes say.
- Evidence: web-features `popover` (low 2025-01-27), `invoker-commands` (low 2025-12-12), `customizable-select` (Chrome 135, Safari 27); BCD `html.global_attributes.popover.hint`, `html.elements.button.interestfor` (Chrome 142, experimental)

### Use `<dialog>` and `inert` instead of modal libraries and focus-trap scripts
- Verdict: verified
- Evidence: web-features `dialog` (low 2022-03-14), `inert` (high 2025-10-11); BCD `html.elements.dialog.closedby` (Chrome 134, Firefox 141, Safari preview)

### Collapse long hidden content with `hidden="until-found"` or `<details>`, not `display:none` + JS
- Verdict: verified
- Evidence: BCD `html.global_attributes.hidden.until-found` (Firefox 148, 139-147 partial; Safari 26.2 partial, "does not correctly scroll to the matching text"), `api.Element.beforematch_event`; web-features `details-name` (low 2024-09-03)

### Server-render web components with declarative shadow DOM
- Verdict: corrected
- Correction: "hydration can reuse the existing root" is only true if the component looks for it first. Calling `attachShadow()` on an element that has a declarative root does not throw; web.dev: "the Declarative Shadow Root is emptied and returned", so the component re-renders and the server-rendered paint is lost. Hydrate with `this.attachInternals().shadowRoot` (ElementInternals.shadowRoot: Chrome 88, Firefox 93, Safari 16.4) and call `attachShadow()` only when it is null. Status is correct (Baseline 2024, high 2026-08-20; `shadowrootslotassignment` Safari 27 per WebKit, BCD still Firefox 151 only). Minor: `setHTMLUnsafe`/`parseHTMLUnsafe` are Safari 26 (17.4-25 partial).
- Evidence: https://web.dev/articles/declarative-shadow-dom ("Component hydration"); BCD `api.ElementInternals.shadowRoot`, `api.Element.setHTMLUnsafe`; https://api.webstatus.dev/v1/features/declarative-shadow-dom

### Stream slow page regions out of order with `<template for>` (progressive enhancement)
- Verdict: verified
- Evidence: https://developer.chrome.com/blog/declarative-partial-updates (updated 2026-09-08; same-parent rule; streaming setters "planned for launch in Chrome 155"); BCD `html.elements.template.for` (Chrome 150, experimental); https://api.webstatus.dev/v1/features/template-for

### Add `<meta name="viewport" content="width=device-width">` to remove the mobile tap delay
- Verdict: verified
- Evidence: https://developer.chrome.com/blog/300ms-tap-delay-gone-away (Chrome 32; iOS 9.3); BCD `html.elements.meta.name.viewport`

### Use credentialless iframes when cross-origin isolation is needed for WASM threads
- Verdict: verified
- Evidence: BCD `html.elements.iframe.credentialless` (Chrome 110, experimental), `http.headers.Cross-Origin-Embedder-Policy.credentialless` (Chrome 96, Firefox 119, Safari no)

### Measure render-blocking, delivery and early-hint timing in RUM
- Verdict: verified
- Evidence: BCD `api.PerformanceResourceTiming.renderBlockingStatus` (Chrome 107), `.deliveryType` (Chrome 117, Safari 26.4), `.firstInterimResponseStart` (Chrome 115, Firefox 152, Safari 26.4), `.contentEncoding` (Chrome 143, experimental), `html.global_attributes.containertiming` (flags Chrome 145, Firefox 156); web-features `server-timing` (low 2023-03-27), `largest-contentful-paint` and `event-timing` (low 2025-12-12)

---

## Cross-file conflicts

1. `sizes="auto"` in Safari: 02-course-loading.md:723, 03-course-js-and-vitals.md:153 and 16-explore-fast-index.md:216 say "no Safari". 04 says Safari 27 added it (WebKit post 2026-09-17). 04 is correct; the others follow BCD/webstatus, which lag.
2. Preload priority: 04 (preload item Why) says "a mandatory high-priority fetch". 02-course-loading.md:559 says "A preload gets the default priority of its `as` destination, which is low for images". 02 matches web.dev; fix 04.
3. `Link:` header `fetchpriority`: 04 says "same versions" as the attributes (Chrome 101/102). 02-course-loading.md:687 says Chrome 103, which matches BCD. Fix 04.
4. Lighthouse `no-unload-listeners`: 03-course-js-and-vitals.md:943 and 04:762 both recommend an audit that Lighthouse removed in 12.0.0 (2024-04-22). verify/03 already flags this.
5. `unload` and bfcache framing: 04:723 and 07-js-web-apis.md:373 both say `unload` makes pages ineligible in Chrome desktop. From Chrome 154 (2026-09-22) Chrome no longer fires `unload` by default, so this now applies only to Firefox and to Chrome pages that opt back in.
6. Chrome stable version: the 04 header says Chrome 153 stable (154 beta). Chromiumdash shows 154 stable on 2026-09-22 on a 2-week cadence (155 on 2026-10-06). Any file that reasons "Chrome 154 = beta" is stale.
7. No conflict found for: dns-prefetch Baseline 2025-09-15 (01, 02), modulepreload widely 2026-03-18 (01, 02, 03), zstd newly 2026-02-11 (02, 16), `no-store` bfcache rules and Chrome 149 WebSocket change (02, 03, 07, 17), speculation eagerness (03), SW static routing Chrome 123 / Safari 27 (07, 17), preconnect 10 s (02, 16; same 2019 web.dev source).

## Missing but important

1. HTTPS DNS records (SVCB/HTTPS, RFC 9460) for HTTP/3. Chrome 118+ connects over HTTP/3 directly when the HTTPS record has `alpn=h3`, which avoids the first-visit Alt-Svc upgrade. Alt-Svc: Chrome 52, Firefox 38, Safari 17. Check the result in RUM with `PerformanceResourceTiming.nextHopProtocol`. Sources: https://chromestatus.com/feature/5154357283651584 ; https://www.rfc-editor.org/rfc/rfc9460 ; BCD `http.headers.Alt-Svc`.
2. Remove navigation redirects, keep server response under 600 ms and compress the HTML. The DevTools "Document request latency" insight flags any redirect, a server response over 600 ms, or uncompressed HTML. A cross-origin redirect also drops 103 Early Hints. Sources: https://developer.chrome.com/docs/performance/insights/document-latency ; https://developer.chrome.com/docs/web-platform/early-hints.
3. HTTP cache partitioning (double-keyed cache). Shared-CDN cache hits across sites no longer happen, so "load libraries from a public CDN for cache reuse" is obsolete. Self-host critical assets to save a connection and to keep them preloadable. Sources: https://developer.chrome.com/blog/http-cache-partitioning (linked from MDN `rel=prefetch`); https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/prefetch.
4. Document-Isolation-Policy as a Chromium alternative to COOP+COEP+credentialless iframes for `crossOriginIsolated` (SharedArrayBuffer, WASM threads). chromestatus ship stage: desktop 137, Android 146 (status field still says "In development"); Chromium only. Source: https://chromestatus.com/feature/5141940204208128 (07-js-web-apis.md:157 has the same data).
5. Preconnect for a `wss://` market-data host (trading terminal). A later WebSocket handshake reuses a preconnected HTTP/2 connection only if the server allows WebSockets over HTTP/2 (RFC 8441, `SETTINGS_ENABLE_CONNECT_PROTOCOL`); otherwise only the DNS step may help. Not verified in Chromium source here; confirm with the DevTools Network "Connection ID" column before relying on it. Source: https://www.rfc-editor.org/info/rfc8441.

Raw data saved under `raw/verify/04/` (BCD query script, webstatus JSON, chromestatus JSON, blink-dev message, Lighthouse changelog).
