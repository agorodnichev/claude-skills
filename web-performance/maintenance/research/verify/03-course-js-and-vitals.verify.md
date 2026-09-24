# Verify: 03-course-js-and-vitals.md

Summary counts: 63 items checked. 50 verified, 12 corrected, 0 disputed, 1 unverified.

The reference tables at the top (CWV thresholds, LCP sub-part shares, INP sub-parts, 50 ms long task, 500 ms input exclusion, 1 s / 5 s session window, TTFB 0.8 s / 1.8 s) are correct. Evidence: web.dev optimize-lcp (the table rows "~40%", "<10%", "~40%", "<10%"), web.dev cls ("less than 1-second in between each shift and a maximum of 5 seconds"), web.dev optimize-ttfb ("Good TTFB values are 0.8 seconds or less, poor values are greater than 1.8 seconds").

Checks run (2026-09-22/23):
- Downloaded BCD 8.1.2 (2026-09-17) and web-features 3.39.0 from jsDelivr to `raw/verify/03/`. These are the same versions that the notes used. I queried every Status line with `raw/verify/03/q.py`.
- Read the Safari 27.0 WebKit post (https://webkit.org/blog/18325/webkit-features-for-safari-27-0/, page metadata `article:published_time` 2026-09-17). It is newer than BCD 8.1.2 for `sizes="auto"`.
- Fetched the chromestatus JSON for 6324676351623168 (prerender-until-script), 5200068565139456 (lazy video/audio) and 5144837209194496 (soft navigations).
- Read the Lighthouse `main` source (package version 13.5.0): `core/audits/bootup-time.js`, `core/config/default-config.js`, the audit tree, and the commit log for `no-unload-listeners.js`.
- Read the webpack SplitChunksPlugin and optimization docs, the esbuild API docs, the Vite features page, the webpack web-workers guide and v8.dev/features/modules.
- Re-fetched developer.chrome.com prerender-pages (updated 2026-01-23), deprecating-unload (updated 2026-07-14), bfcache-ccns (updated 2025-09-09), early-hints (updated 2026-07-10), the Lighthouse bootup-time doc, new-in-chrome-148, web.dev bfcache, MDN Speculation Rules API (modified 2026-09-10), MDN 103, MDN isInputPending, Surma's "Is postMessage slow?", and the blink-dev PSA "Disconnect WebSockets on BFCache entry".
- Grepped the saved article and course text in `raw/course-js-vitals/` for every number and quote that the notes use.
- Checked every URL that the notes cite (57). All return HTTP 200, except the bare API root `https://api.webstatus.dev/v1/features/`, the placeholder `https://example.com/embed` and the course "conclusion" page. The notes already say that the conclusion page is 404.
- web-vitals on npm: `latest` = 6.2.2 (published 2026-09-14). The README attribution names in the notes are correct.

---

## A. Code-split JavaScript

### Split non-startup JavaScript behind dynamic import()
- Verdict: corrected
- Correction: The reason for "Cache the returned promise so the module loads once" is wrong. The browser module map already makes sure that each module URL is fetched and evaluated one time only. A second `import()` of the same URL returns the same module and does not download or run it again. Keep the cached promise as a small convenience, but the reason is to skip repeated lookups, not to prevent a second load. Everything else is correct: BCD `javascript.operators.import` gives Chrome 63, Firefox 67, Safari 11.1. The course says "Total Blocking Time (TBT)... is highly correlated with INP".
- Evidence: https://web.dev/learn/performance/code-split-javascript, https://html.spec.whatwg.org/multipage/webappapis.html#module-map, BCD `javascript.operators.import`

### Find split candidates with Coverage and script-execution data before you split
- Verdict: corrected
- Correction: The course and the Lighthouse doc page (last updated 2019-05-02) say "warning when JavaScript execution takes longer than 2 seconds... fails when execution takes longer than 3.5 seconds". The current Lighthouse code (`main`, v13.5.0) does not use 2 s. `bootup-time` is still an audit (weight 0, "diagnostics" group; it did not become an insight). Its log-normal scoring uses `p10: 1282` and `median: 3500`, with the source comment "<500ms ~= 100, >1.3s is yellow, >3.5s is red". Use: "Lighthouse shows the audit as not passed (yellow) above about 1.3 s of total JS execution and red above 3.5 s."
- Evidence: https://github.com/GoogleChrome/lighthouse/blob/main/core/audits/bootup-time.js, https://developer.chrome.com/docs/lighthouse/performance/bootup-time, https://developer.chrome.com/blog/moving-lighthouse-to-insights (bootup-time is not in the list of renamed or removed audits)

### Bundle modules for production; do not ship deep unbundled module graphs
- Verdict: verified
- Note: The full v8.dev condition is "less than 100 modules in total and with a relatively shallow dependency tree (i.e. a maximum depth less than 5)". You can add "depth < 5" to the Why line. modulepreload: web-features `modulepreload` is Baseline high (low 2023-09-18, high 2026-03-18); Chrome 66, Firefox 115, Safari 17.
- Evidence: https://v8.dev/features/modules, web-features 3.39.0 `modulepreload`

### Configure bundler splitting explicitly and check the output
- Verdict: corrected
- Correction: "webpack `chunks: 'initial'` merges the dynamic chunk into the main bundle" is wrong. The course says this, but the webpack docs do not support it. The `splitChunks.chunks` option "indicates which chunks will be selected for optimization". `'async'` selects "chunks created by import()". An `import()` always creates its own async chunk, whatever the SplitChunksPlugin setting is. With `chunks: 'initial'`, SplitChunksPlugin does not extract shared or vendor modules from async chunks, so async chunks can carry duplicate code. It does not merge them into `main`. Replace the Why line with: "`chunks: 'initial'` only optimizes entry chunks; shared modules inside lazy chunks stay duplicated. `'all'` lets initial and async chunks share split chunks." I could not confirm the `splitChunks: false` duplication example in current webpack docs. It comes from the 2023 course only. The esbuild facts are correct: "It currently only works with the esm output format". esbuild also warns about "a known ordering issue with import statements across code splitting chunks". Add this to Avoid/caveats.
- Evidence: https://webpack.js.org/plugins/split-chunks-plugin/ (section `splitChunks.chunks`), https://esbuild.github.io/api/#splitting, https://web.dev/learn/performance/code-split-javascript

### Balance chunk size: evaluation cost vs compression vs cache hits (about 100 KB per script)
- Verdict: verified
- Evidence: https://web.dev/articles/script-evaluation-and-long-tasks ("a limit of 100 kilobytes per individual script is a good target"; "Each `<script>` element kicks off a task to evaluate the requested script")

### Know how browsers turn scripts into tasks
- Verdict: unverified
- Correction: The notes quote the 2023 article correctly: Chromium runs defer and module scripts in the `DOMContentLoaded` task; "Compile module" tasks; "When modules are loaded in Safari and Firefox, each of them is evaluated in a separate task". I could not confirm that this is still the engine behavior in 2026-09. There is one new fact that makes the Safari part less safe. Safari 27.0 ships "a complete standards-compliant rewrite of the ECMAScript module (ESM) loader" (WebKit, 2026-09-17), so the Safari task model for modules can be different now. Keep the "profile in each engine" caveat.
- Evidence: https://web.dev/articles/script-evaluation-and-long-tasks, https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

## B. Lazy loading images and iframes

### Add loading="lazy" to below-the-fold images and iframes
- Verdict: corrected
- Correction: The `sizes="auto"` status is stale. The Safari 27.0 release adds it: "Responsive image techniques get easier with the auto keyword for sizes", with a `sizes="auto" loading="lazy"` example. It also fixes "remaining issues with `<img sizes="auto">`". BCD 8.1.2 and web-features 3.39.0 still say no Safari. Use: "`sizes="auto"`: Chrome/Edge 126, Firefox 150, Safari 27.0. It is now in all three engines; webstatus has not yet updated." Add a Safari caveat: before Safari 27, `<picture>` `<source>` candidates were "speculatively preloaded even when the inner `<img>` has loading=lazy" (fixed in 27.0). On Safari 26 and older, lazy `<picture>` images can still download early. The rest is correct: web-features `loading-lazy` is Baseline high (low 2023-12-19, high 2026-06-19), and the iframe attribute is Firefox 121, Safari 16.4. The YouTube (>500 KiB) and Facebook (>200 KiB) numbers match the course.
- Evidence: https://webkit.org/blog/18325/webkit-features-for-safari-27-0/, BCD `html.elements.img.sizes.auto`, web-features `sizes-auto`, `loading-lazy`, https://web.dev/learn/performance/lazy-load-images-and-iframe-elements

### Never lazy-load the LCP image or anything likely above the fold
- Verdict: verified
- Evidence: https://web.dev/learn/performance/lazy-load-images-and-iframe-elements ("an image in the visible viewport with `fetchpriority="high"` and `loading="lazy"` still waits until all CSS is downloaded and parsed")

### Use native lazy loading, not JavaScript libraries, for images and iframes
- Verdict: verified
- Evidence: https://web.dev/articles/top-cwv ("7% of pages obscure their LCP image behind `data-src`")

### Replace heavy third-party embeds with facades
- Verdict: verified
- Evidence: https://web.dev/learn/performance/lazy-load-images-and-iframe-elements (names `lite-youtube-embed`, `lite-vimeo-embed`, React Live Chat Loader; intent is "holding a pointer over it for a reasonable period of time, or with a click")

### Lazy-load video, posters and CSS background images yourself (or with native video/audio loading in Chrome 148+)
- Verdict: corrected
- Correction: The source conflict has an answer. Native `loading` on `<video>`/`<audio>` shipped in Chrome 148 (chromestatus 5200068565139456, shipping stage milestone 148; "New in Chrome 148"). BCD records Chrome 148–150 as partial with the note "Not supported for `<source>`" (crbug 514611050), and full support in Chrome 150. Status line: "Chrome/Edge 148 partial (the attribute does not apply when the media URL is on `<source>` children), full in 150. Not in Firefox or Safari (chromestatus: implementations under way in both). Experimental, limited availability." This matters for the example: a `<video>` that uses `<source>` children got no native lazy loading in Chrome 148–149.
- Evidence: https://chromestatus.com/feature/5200068565139456, https://developer.chrome.com/blog/new-in-chrome-148, BCD `html.elements.video.loading`, `html.elements.audio.loading`, web-features `loading-lazy-media`

## C. Prefetching, prerendering, service worker precaching

### Prefetch likely-next resources at low priority
- Verdict: verified
- Evidence: https://web.dev/learn/performance/prefetching-prerendering-precaching ("at lowest priority"; "There is an open issue related to prefetching cross-origin documents that results in duplicate requests"; "only on fast connections, and avoid prefetching altogether if the user has enabled the `Save-Data` signal"), BCD `html.elements.link.rel.prefetch` (Chrome 8 and Firefox 2 "Requires secure context"; Safari 13.1 behind the `LinkPrefetch` preference), web-features `link-rel-prefetch` (not Baseline)

### Use speculation rules for next-page prefetch/prerender, with conservative eagerness
- Verdict: corrected
- Correction: The `prerender_until_script` origin-trial window is stale. chromestatus shows the origin trial stage as desktop and Android 144–150, with an extension to milestone 154 (blink-dev extension thread). There is no shipping stage and no intent to ship. Use: "origin trial Chrome 144–150, extended through Chrome 154; not shipped." Everything else matches developer.chrome.com (updated 2026-01-23): eager = 10 ms hover on desktop and 50 ms in viewport on mobile ("changed from Chrome 143"); moderate = 200 ms hover or pointerdown, with mobile heuristics; defaults are list `immediate` and document `conservative`; limits are immediate 50 prefetch / 10 prerender, and eager/moderate/conservative 2 / 2 FIFO. The conditions that disable speculation are also correct. MDN confirms "Chrome for example caches them for 5 minutes" and `'inline-speculation-rules'`. BCD confirms Chrome 109 (105–109 partial), prefetch 110, prerender 105, eagerness 121, Safari 26.2 behind a flag (no prerender), and no Firefox.
- Evidence: https://chromestatus.com/feature/6324676351623168, https://developer.chrome.com/docs/web-platform/prerender-pages, https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API, BCD `html.elements.script.type.speculationrules`

### Make pages safe to prerender: defer side effects until activation
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API (deferred APIs: Web Locks, `BroadcastChannel.postMessage()`, Notifications, Geolocation, "AudioContexts are not allowed to start while prerendering"; `Sec-Purpose: prefetch;prerender`), https://developer.chrome.com/docs/web-platform/prerender-pages ("Chrome also does not render cross-origin iframes on prerendered pages until activation"), BCD `api.Document.prerendering` / `api.PerformanceNavigationTiming.activationStart` (Chrome 108, experimental)

### Do not use <link rel="prerender">
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API ("Chrome-specific and was never standardized, and the Chrome engineering team are in the process of sunsetting it"), BCD `html.elements.link.rel.prerender` (deprecated: true, standard_track: false), course ("since Chrome 63, this initiates a NoState Prefetch")

### Precache only likely-needed, versioned assets in the service worker
- Verdict: verified
- Note: Workbox is still maintained. The latest release is v7.4.1 (2026-05-05), the repo is not archived, and the last push was 2026-09-02. This closes the "not verified in depth" gap in the notes.
- Evidence: https://web.dev/learn/performance/prefetching-prerendering-precaching, https://github.com/GoogleChrome/workbox/releases, web-features `service-workers` (Baseline high, 2020-10-30)

## D. Web workers

### Move expensive non-DOM work into a dedicated worker
- Verdict: corrected
- Correction: The list "Workers cannot access ... WebRTC, Web Audio, WebUSB" comes from the 2019 off-main-thread article and is now too broad. `AudioContext` and `RTCPeerConnection` are still not available in workers. But `RTCDataChannel` is transferable to a worker (BCD: Chrome 130, Firefox 144, Safari 15), and `RTCRtpScriptTransform` runs in a worker. WebUSB is partly exposed in Chromium dedicated workers (BCD `api.WorkerNavigator.usb`: Chrome 70+, partial; `requestDevice()` stays on the main thread). Use: "Workers have no DOM, no `AudioContext` and no `RTCPeerConnection`. Check BCD `worker_support` for other APIs." The OffscreenCanvas and worker `requestAnimationFrame()` status is correct: web-features `offscreen-canvas` is Baseline high since 2025-09-27; BCD worker rAF is Chrome 69, Firefox 99, Safari 16.4.
- Evidence: https://web.dev/articles/off-main-thread, BCD `api.RTCDataChannel.transferable`, `api.RTCRtpScriptTransform`, `api.WorkerNavigator.usb`, `api.USB.worker_support`, web-features `offscreen-canvas`

### Create module workers with new URL(..., import.meta.url)
- Verdict: verified
- Evidence: https://webpack.js.org/guides/web-workers/ ("As of webpack 5, you can use Web Workers without worker-loader"), https://vite.dev/guide/features ("the recommended way to create workers"; "The worker detection will only work if the new URL() constructor is used directly inside the new Worker() declaration"), web-features `js-modules-workers` (low 2023-06-06, high 2025-12-06)

### Keep worker messages small; transfer large binary data
- Verdict: corrected
- Correction: The web.dev summary ("less than 10 KB") drops half of the original result. Surma (2019-07-15) gives two budgets: "you can postMessage() objects up to 100KiB and stay within your 100ms response budget", and "everything up to 10KiB will not pose a risk to your animation budget" (16 ms frame). Replace the Why line with: "≤ 10 KiB (JSON size) per message is safe inside an animation frame; ≤ 100 KiB is safe for a 100 ms response. Above that, transfer ArrayBuffers."
- Evidence: https://surma.dev/things/is-postmessage-slow/, https://web.dev/articles/off-main-thread

### Fetch only the bytes you need (HTTP Range)
- Verdict: verified
- Note: The course demo sends `bytes=0-${2 ** 10 * 64}` (= `bytes=0-65536`, which is 65,537 bytes). The notes' `bytes=0-65535` is the correct value for exactly 64 KiB.
- Evidence: https://web.dev/learn/performance/web-worker-demo

## E. LCP

### Make the LCP resource discoverable in the initial HTML
- Verdict: verified
- Evidence: https://web.dev/articles/top-cwv ("delayed on the client by 1,290 milliseconds at the 75th percentile"; "35% of those images had source URLs that were not discoverable in the initial HTML response"), https://web.dev/articles/optimize-lcp

### Give the LCP image fetchpriority="high" (only one or two), and lower hidden images
- Verdict: corrected
- Correction: This is a minor version fix. BCD gives Chrome 101 for `html.elements.img.fetchpriority` and `html.elements.link.fetchpriority`. web-features `fetch-priority` gives Chrome 103. Write "Chrome 101 (BCD) / 103 (web-features)", not "102/103". The rest is correct: Baseline low 2024-10-29, Firefox 132, Safari 17.2, widely available expected 2027-04-29; "setting a high priority on more than one or two images makes priority setting unhelpful"; 15% adoption (top-cwv).
- Evidence: BCD `html.elements.img.fetchpriority`, web-features `fetch-priority`, https://web.dev/articles/optimize-lcp

### Serve the LCP resource from the page's own origin
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-lcp ("host critical resources on the same origin"; "Many CDNs allow you to proxy requests from your origin to theirs")

### Remove render-blocking work that delays the LCP element after its resource arrives
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-lcp

### Do not hide or build the LCP element with JavaScript
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-lcp ("hidden by some other code, such as an A/B testing library"; SSG "generally a better choice for performance")

### Keep the main thread free during load so the LCP image can paint
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-lcp ("All browsers today render images on the main thread")

### Shorten LCP resource load duration: smaller bytes, closer server, less contention, cache
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-lcp (the `font-display` "anything other than `auto` or `block`" rule; data-URL caveats)

### Measure LCP sub-parts in the field, not only in the lab
- Verdict: verified
- Note: "a slightly coarsened render time is available from Chrome 133 even when `Timing-Allow-Origin` is not provided". The same article says to still set TAO "for browsers that don't include this recent change". Firefox and Safari can still report `renderTime` 0 without TAO. The status is correct: web-features `largest-contentful-paint` is Baseline low 2025-12-12; web-vitals 6.2.2 attribution has `timeToFirstByte`, `resourceLoadDelay`, `resourceLoadDuration`, `elementRenderDelay`.
- Evidence: https://web.dev/articles/lcp (last updated 2025-09-04), web-features `largest-contentful-paint`, https://cdn.jsdelivr.net/npm/web-vitals/README.md

## F. TTFB (code-level parts only)

### Link to final URLs; avoid redirect chains and cache-busting query strings
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-ttfb (HSTS and preload list; "unique query string parameters for analytics measurement")

### Stream HTML (streaming SSR or static files)
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-ttfb, https://web.dev/articles/client-side-rendering-of-html-and-interactivity

### Use service-worker strategies that answer navigations from cache when safe
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-ttfb ("stale-while-revalidate strategy can make a page's TTFB nearly instant"; network first for authenticated markup)

### Send 103 Early Hints for render-critical resources when the backend is slow
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/103 ("Browsers only process the first early hints response, and this response must be discarded if the request results in a cross-origin redirect"), https://developer.chrome.com/docs/web-platform/early-hints (updated 2026-07-10; "Only supports `preconnect` and `preload`"), BCD `http.status.103` (Chrome 103, Firefox 120, preload Firefox 123, Safari 17 with preload false; Chrome and Safari "Supported in HTTP/2 and later only"), https://web.dev/articles/optimize-ttfb (`finalResponseHeadersStart`)

### Instrument the backend with Server-Timing
- Verdict: verified
- Note: The notes are correct that the web.dev snippet `performance.getEntries('navigation')[0]` is wrong. `getEntries()` takes no filter and returns all entries. `[0]` is the navigation entry only by chance. web-features `server-timing`: low 2023-03-27, high 2025-09-27.
- Evidence: https://web.dev/articles/optimize-ttfb, web-features `server-timing`

## G. CLS

### Set width and height on every image and video
- Verdict: verified
- Evidence: https://web.dev/articles/top-cwv ("66% of pages have at least one unsized image"), BCD `html.elements.source.width` (Chrome 90, Firefox 108, Safari 15), web-features `aspect-ratio` (high 2024-03-20)

### Reserve space for ads, embeds, iframes and late content
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-cls ("choose the most likely size"; "set the initial size to the smallest size")

### Never insert content above existing content without a user action
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-cls (500 ms note), https://web.dev/articles/cls ("Continuous interactions such as scrolls, drags, or pinch and zoom gestures are not considered 'recent input'")

### Animate transform and opacity, never layout properties
- Verdict: verified
- Evidence: https://web.dev/articles/top-cwv ("absolutely positioned elements that animate `top` or `left` cause layout shifts"; margin or border animations have poor CLS "at almost twice the rate")

### Minimize font-swap shifts
- Verdict: corrected
- Correction: The Status line says "not re-verified". The example depends on `ascent-override`, and Safari does not support it. BCD 8.1.2: `ascent-override`, `descent-override` and `line-gap-override` are Chrome 87, Firefox 89, Safari "preview" only. web-features `font-metric-overrides` is not Baseline, and the Safari 27.0 notes do not add them. `size-adjust` is Chrome 92, Firefox 92, Safari 17. Status line: "`size-adjust` works in all engines (Safari 17+); the three `*-override` descriptors are Chromium and Firefox only, so Safari gets only the size match." `font-display: optional` and the generic-family advice match web.dev.
- Evidence: BCD `css.at-rules.font-face.ascent-override`, `css.at-rules.font-face.size-adjust`, web-features `font-metric-overrides`, https://web.dev/articles/optimize-cls

### Measure CLS over the whole page life and find the cause, not the victim
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-cls ("CLS that happens in iframes is not measurable from Web APIs"), BCD `api.LayoutShift` (Chrome 77, experimental; Firefox and Safari no)

## H. INP

### Yield to the main thread with scheduler.yield() (with a fallback)
- Verdict: verified
- Evidence: BCD `api.Scheduler.yield` (Chrome 129, Firefox 142, Safari no; Safari 27.0 notes do not add it), BCD `api.Scheduler.postTask` (Chrome 94, Firefox 142), https://web.dev/articles/optimize-long-tasks ("minimum 5 millisecond delay"), HTML spec timer steps (clamp to 4 ms when the nesting level is greater than 5)

### Yield by time budget, not after every item
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-long-tasks ("A common deadline is 50 milliseconds")

### Run only the next-frame update inside the event handler; defer the rest
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-inp ("an effective method that works in all browsers to prevent non-critical code from blocking the next frame")

### Do not use isInputPending() for yielding decisions
- Verdict: verified
- Note: The MDN page now has a "Deprecated" banner, but BCD 8.1.2 still has `deprecated: false`, `experimental: true` (Chrome 87 only). The top-cwv change log (October 2024) says "We reversed our recommendation to use the `isInputPending` API".
- Evidence: https://web.dev/articles/optimize-long-tasks ("may incorrectly return `false` despite a user having interacted"), https://web.dev/articles/top-cwv, https://developer.mozilla.org/en-US/docs/Web/API/Scheduling/isInputPending

### Read layout before you write styles; never interleave in loops
- Verdict: verified
- Evidence: https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing ("all the old layout values from the previous frame are known"; LoAF `forcedStyleAndLayoutDuration`), BCD `api.PerformanceScriptTiming.forcedStyleAndLayoutDuration` (Chrome 123 only)

### Avoid layout-triggering style changes where you can
- Verdict: verified
- Evidence: https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing ("over 28 milliseconds is spent inside layout for each frame, which, when we have 16 milliseconds...")

### Keep the DOM small and shallow; add DOM on demand
- Verdict: corrected
- Correction: The 800 / 1,400-node Lighthouse thresholds are obsolete. Lighthouse 13 replaced the `dom-size` audit with `dom-size-insight` (the default config lists `insights/dom-size-insight`, and there is no `dom-size` audit). That insight ("Optimize DOM size", published 2025-10-08) "only fails if there is a large layout or style recalculation exceeding a duration of 40ms". A large layout is "over 100 layout objects". A large style recalc "affects more than 300 elements". Replace the Why line with this and keep 800/1,400 only as history.
- Evidence: https://developer.chrome.com/docs/performance/insights/dom-size, https://developer.chrome.com/blog/moving-lighthouse-to-insights (`dom-size` → `dom-size-insight`), https://github.com/GoogleChrome/lighthouse/blob/main/core/config/default-config.js

### Skip off-screen rendering with content-visibility
- Verdict: verified
- Note: The `aria-hidden="true"` advice comes from the 2020 article ("landmark elements with style features such as `display: none` or `visibility: hidden` will also appear in the accessibility tree when off-screen"). I did not re-test it in current engines. The `auto` value was partial in Safari 18–25 and full from Safari 26 (BCD `css.properties.content-visibility.auto`), so the Do line needs Safari 26+. The status is correct: web-features `content-visibility` is Baseline low 2025-09-15, and `contain-intrinsic-size` is high 2026-03-18.
- Evidence: https://web.dev/articles/content-visibility ("from a 232ms rendering time to a 30ms rendering time"), BCD `css.properties.content-visibility.auto`, web-features `content-visibility`, `contain-intrinsic-size`

### Limit client-side HTML rendering; prefer server-streamed HTML
- Verdict: verified
- Evidence: https://web.dev/articles/client-side-rendering-of-html-and-interactivity

### Avoid heavy recurring timers
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-input-delay ("preferably not scheduling the next iteration until the previous one is completed")

### Debounce rapid input and abort stale requests
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-input-delay ("an `AbortController` instance's `signal` property can also be used to abort events"), web-features `aborting` (Baseline high 2021-09-25)

### Prefer composited CSS animations over requestAnimationFrame-driven JS animations
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-input-delay ("animations run mainly on the GPU and compositor threads")

### Simplify CSS selectors and reduce the number of invalidated elements
- Verdict: verified
- Evidence: https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations ("Roughly half of the time used in Blink... is used to match selectors"; Selector stats; last updated 2025-05-07)

### Ship less JavaScript at startup
- Verdict: verified
- Evidence: https://web.dev/articles/top-cwv, https://web.dev/articles/script-evaluation-and-long-tasks

### Remember each iframe has its own main thread, but INP includes iframe interactions
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-inp ("INP will be reported at the page-level including any slow interactions on the page or any iframes"), https://web.dev/articles/inp

### Measure INP in the field with attribution
- Verdict: verified
- Note: web-vitals does not see iframe interactions: "they have no visibility into `<iframe>` content (not even same-origin iframes)". So RUM INP can be lower than CrUX.
- Evidence: https://web.dev/articles/inp ("below 104 milliseconds don't report by default... minimum value of 16 milliseconds"; observe `first-input`), web-features `event-timing` (low 2025-12-12), BCD `api.PerformanceEventTiming.interactionId` (Chrome 96, Firefox 144, Safari 26.2), web-vitals README

## I. Back/forward cache (bfcache)

### Never register unload; use pagehide (and lock it with Permissions-Policy)
- Verdict: corrected
- Correction: (1) The Impact line is too narrow. web.dev (bfcache): "On desktop, Chrome and Firefox have chosen to make pages ineligible for bfcache if they add an `unload` listener", and "Firefox treats pages that use `unload` as ineligible for the bfcache, except on iOS". So Firefox Android is affected too. With the Chrome unload deprecation at 100% of page loads in Chrome 154 (2026-09-22), Chrome no longer fires `unload` handlers by default, and code that flushes data in `unload` now silently loses that data. The exceptions are sites that opt back in (Permissions-Policy opt-in since Chrome 117) and the enterprise policy `ForcePermissionPolicyUnloadDefaultEnabled`. (2) The Avoid/caveats line "Lighthouse has a `no-unload-listeners` audit" is stale. Lighthouse removed that audit in 2024-03 ("core: remove `no-unload-listeners` audit (#15874)"), and the current audit tree has no such file. The web.dev article still names it. Use the Lighthouse `bf-cache` audit or the DevTools bfcache test. The rollout table in the Status line is correct (M146 1% … M152 80%, M154 2026-09-22 100%; page updated 2026-07-14).
- Evidence: https://web.dev/articles/bfcache, https://developer.chrome.com/docs/web-platform/deprecating-unload, https://github.com/GoogleChrome/lighthouse/pull/15874, BCD `http.headers.Permissions-Policy.unload` (Chrome 115, experimental)

### Add beforeunload only while there are unsaved changes
- Verdict: verified
- Evidence: https://web.dev/articles/bfcache ("won't make your pages ineligible for bfcache in modern browsers... but previously it did and it is still unreliable"), web-features `beforeunload` (not Baseline)

### Use Cache-Control: no-store only for truly sensitive pages
- Verdict: verified
- Note: The Chrome doc says the page is evicted "on changes to cookies, or other authorization methods". "Any cookie change" is a small overstatement. The bfcache article (footer updated 2026-09-03) still says "There is work underway to change this behavior for Chrome". That sentence is stale, and the notes correctly follow the newer bfcache-ccns page.
- Evidence: https://developer.chrome.com/docs/web-platform/bfcache-ccns ("reduced to 3 minutes (from 10 minutes"; "completing the final rollout to 100% of users over March and April 2025"), https://web.dev/articles/bfcache

### Refresh stale or sensitive state on pageshow with persisted=true
- Verdict: verified
- Evidence: https://web.dev/articles/bfcache, web-features `page-transition-events` (Baseline high)

### Close IndexedDB, WebSocket and WebRTC connections on pagehide; reopen on pageshow
- Verdict: verified
- Note: Three details matter for a real-time app. (1) Chrome does not keep the socket open: the blink-dev PSA says it works "By closing connections on BFCache entry instead of marking the document as ineligible". The page must handle `close` and reconnect on `pageshow`. The PSA gives milestone 148; web.dev says "Chrome (as of 149)". A third-party measurement on Chrome 150 automation builds still saw `notRestoredReasons` = "websocket", which is possibly a staged rollout, so keep closing sockets in `pagehide` yourself. (2) For `Cache-Control: no-store` pages, WebSocket, WebTransport and WebRTC use "will continue to make those pages ineligible for bfcache" (bfcache-ccns). (3) The web.dev byline says "Last updated: July 2, 2026" and the footer says 2026-09-03. Both dates are on the page.
- Evidence: https://web.dev/articles/bfcache, https://groups.google.com/a/chromium.org/g/blink-dev/c/52nlr8z3Png, https://developer.chrome.com/docs/web-platform/bfcache-ccns, https://jangwook.net/en/blog/en/websocket-bfcache-eligibility-remeasure/, BCD `api.Document.freeze_event` (Chrome 68, experimental)

### Avoid window.opener relationships
- Verdict: verified
- Evidence: https://web.dev/articles/bfcache ("A page with a non-null `window.opener` reference can't safely be put into bfcache")

### Keep iframes from blocking the parent's bfcache
- Verdict: verified
- Evidence: https://web.dev/articles/bfcache ("The Permissions Policy set on the main frame or the use of `sandbox` attributes can be used to avoid this")

### Test and monitor bfcache; adjust analytics and RUM for restores
- Verdict: verified
- Evidence: https://web.dev/articles/bfcache ("1 in 10 navigations on desktop and 1 in 5 on mobile"), BCD `api.PerformanceNavigationTiming.notRestoredReasons` (Chrome 125, experimental), Lighthouse `core/audits/bf-cache.js` (present in 13.5.0)

---

## Cross-file conflicts

- `sizes="auto"` in Safari: 03 (B, first item) and 02 (line 723) say "no Safari". 04 (lines 302–313, 1027) says Safari 27 supports it. The WebKit Safari 27.0 post confirms 04. Note that 04 dates Safari 27 as "released 2026-09-14", but the WebKit post metadata says 2026-09-17.
- `unload` eligibility: 03 says the listener makes pages ineligible "in Firefox desktop". 04 (line 723) and 07 (line 373) say "desktop Chrome and Firefox". web.dev agrees with 04/07 and adds Firefox on all platforms except iOS.
- Lighthouse `no-unload-listeners`: 03 (unload item) and 04 (line 762, "Lighthouse's `no-unload-listeners` audit in CI") both recommend an audit that Lighthouse removed in 2024-03 (PR #15874).
- `prerender_until_script`: 03 says the origin trial "runs through Chrome 150". 04 (line 553) says "Origin trial Chrome 144-150, extended to 154". chromestatus agrees with 04.
- LCP `renderTime` for cross-origin images without `Timing-Allow-Origin`: 03 says Chrome 133+ exposes a coarsened render time. 07 (line 756) says "`renderTime` is 0 for cross-origin images without `Timing-Allow-Origin`". web.dev/lcp agrees with 03 for Chrome 133+. 07's statement is still true for other engines only.
- DOM size thresholds: 03 uses Lighthouse 800 / 1,400 nodes. 01 (line 631) uses the current insight rule (40 ms; 100 layout objects; 300 elements). 01 is current.
- Worker API limits: 03 (D, first item) and 07 (line 26) both repeat the 2019 list "WebUSB, WebRTC, Web Audio" as main-thread-only. Both need the BCD correction above.
- `setTimeout` clamp: 01 (line 862) says "clamps to 5 ms after nesting". 03 (H, first item) and 06 (lines 100–113) say that the spec clamp is 4 ms and that the 5 ms web.dev figure is the clamp plus overhead.
- `fetchpriority` Chrome version: 02 (line 565) and 04 (line 245) say "Chrome 101/102". 16 (line 213) says 103. 03 says "102/103". BCD says 101 and web-features says 103. 19-design-b-task (line 596) already plans to keep both sources.
- `isInputPending` label: 06 (line 796, "MDN-deprecated") and 07 (line 912, "deprecated") vs 03 ("no longer recommended"). This is not a real conflict: the MDN page shows "Deprecated", but BCD 8.1.2 has `deprecated: false`.
- `Cache-Control: no-store` for app shells: 03 keeps `no-store` for sensitive pages only. The 02 verify report already recorded that 02 uses `private, no-store` for a "logged-in trading dashboard shell", which conflicts with 03, 04, 07 and 17-batch-01.
- Lazy `<video>`/`<audio>`: 03's open conflict ("Chrome blog says 148; MDN BCD and webstatus list 150") has an answer in 02 (lines 998–999) and 04 (line 392): 148 partial (no `<source>`), full 150. 03 should use the same wording.

## Missing but important

1. SPA soft-navigation measurement. `PerformanceSoftNavigation` / InteractionContentfulPaint shipped in Chrome 151 (chromestatus shipping stage 151; web-features `soft-navigations`: Chrome/Edge 151). web-vitals 6.2 reports LCP, INP and CLS per soft navigation with `{reportSoftNavs: true}` ("Chromium-based browsers on version 151+"). The notes say only that bfcache does not apply to SPA navigations. Sources: https://chromestatus.com/feature/5144837209194496, https://cdn.jsdelivr.net/npm/web-vitals/README.md, https://developer.chrome.com/docs/web-platform/soft-navigations-experiment
2. LoAF script attribution for slow interactions. The web-vitals INP attribution includes `longAnimationFrameEntries` (script URL, invoker, `forcedStyleAndLayoutDuration`), and the result points to the script that caused a slow interaction. The notes mention LoAF only for forced reflow. LoAF is Chrome 123+ only. Sources: https://web.dev/articles/find-slow-interactions-in-the-field, web-vitals README (`longAnimationFrameEntries`), BCD `api.PerformanceLongAnimationFrameTiming`
3. Service-worker navigation preload. `registration.navigationPreload.enable()` starts the navigation request while the service worker boots, so a network-first SW does not add its startup time to TTFB. The notes name that cost but do not name the fix. BCD: Chrome 59, Firefox 99, Safari 15.4. Source: https://developer.mozilla.org/en-US/docs/Web/API/NavigationPreloadManager
4. Service Worker Static Routing API. `InstallEvent.addRoutes()` lets network-only or cache-only routes skip the service worker completely. BCD: Chrome 123, Safari 27, no Firefox. Safari 27.0 calls it a way of "reducing overhead for high-performance PWAs". Sources: https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes, https://webkit.org/blog/18325/webkit-features-for-safari-27-0/
5. `No-Vary-Search` response header. It lets prefetch/prerender (and the HTTP cache) reuse an entry when only irrelevant query parameters differ (for example `utm_*`). Without it, a speculated URL and the clicked URL with extra parameters miss. BCD: Chrome 141 (121–141 partial), Firefox 154, no Safari; speculation rules `expects_no_vary_search` since Chrome 127. Sources: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/No-Vary-Search, BCD `http.headers.No-Vary-Search`
6. End-of-session beacons. Send final analytics and state on `visibilitychange` to `hidden` (plus `pagehide`) with `navigator.sendBeacon()`, or `fetchLater()` where available (Chrome 135, Chromium-only, experimental). Since `unload` no longer fires in Chrome, this is the reliable replacement; `pagehide` alone is not reliable on mobile. Sources: https://developer.chrome.com/docs/web-platform/page-lifecycle-api, https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater
7. Compression Dictionary Transport for hashed chunks. The server sends `Use-As-Dictionary` on a chunk, and the next version of that chunk is sent as a small delta (`dcb`/`dcz`). This removes most of the "one change invalidates the whole chunk" cost that the chunk-size item describes. Chrome 130; Firefox behind a flag; no Safari. Sources: https://developer.chrome.com/blog/shared-dictionary-compression, BCD `http.headers.Use-As-Dictionary`
8. WebSocket reconnect after a bfcache restore. Chrome now closes open WebSockets when the page enters bfcache (blink-dev PSA, M148). A live-quote page must treat the `close` event as normal and reconnect on `pageshow` (`persisted`), or users see a frozen feed after Back. Source: https://groups.google.com/a/chromium.org/g/blink-dev/c/52nlr8z3Png
