# Verify: 01-critical-rendering-path.md

Summary: 54 items checked (2 phase-map sections + 52 items). 43 verified, 10 corrected, 1 disputed, 0 unverified.

Method (date 2026-09-22):
- Status: I read the web-features and MDN browser-compat-data (BCD 8.1.2, build 2026-09-17) copies in `raw/` (web-features.json, bcd.json) with my own query script `raw/verify/q.py`. I compared two features against live webstatus.dev (`api.webstatus.dev/v1/features/scheduler`, `/speculation-rules`). Both matched.
- Names and numbers: I fetched the live pages again (developer.chrome.com, web.dev, MDN, v8.dev, GitHub chrome-devtools-mcp, devtools-frontend `Styles.ts`, `insights/` folder) and grepped the HTML spec, IntersectionObserver spec and "How cc works" copies in `raw/`.
- Not done: I did not record a new Chrome DevTools MCP trace. The claim that network rows carry `priority`, `initialPriority` and `renderBlocking` comes only from the notes writer's live run.

---

### (a) Initial load: navigation -> first pixels
- Verdict: disputed
- Correction: L15 says Paint Holding applies "on same-origin navigations". The 2019 Chrome blog (Chrome 76) says same-origin only. But the Chromium change "Paint Holding Cross Origin" (WPT export PR #27670, merged 2021-03-19) "extends Paint Holding to most navigations". It also gives the timeout: Chrome defers the first commit "until after First Contentful Paint, or a 500ms timeout". So the notes' "timeout not documented" (in "Not covered") is also out of date. I did not find the Chrome version that turned on cross-origin Paint Holding by default. Suggested text: "Chrome Paint Holding: Chrome keeps the old page until the new page reaches FCP or 500 ms. This started for same-origin navigations in Chrome 76 (2019) and was extended to most cross-origin navigations in 2021 (Chromium)." All other rows (L0 to L14) match the spec and Chromium sources: the render-blocking mechanism, the script-blocking style sheet set, commit blocking the main thread, one GPU raster worker at a time, and the DevTools event names.
- Evidence: https://developer.chrome.com/blog/paint-holding, https://github.com/web-platform-tests/wpt/pull/27670, https://html.spec.whatwg.org/multipage/dom.html#render-blocking-mechanism, https://chromium.googlesource.com/chromium/src/+/HEAD/docs/how_cc_works.md

### (b) The update frame after load (one rendering opportunity)
- Verdict: verified
- Note: The step order matches "update the rendering" in the spec: resize, scroll, media queries, animations, fullscreen, context lost, rAF, the style/layout loop with the content-visibility check and ResizeObserver depth, focus fix-up, view transitions, IntersectionObserver, paint timing, update the rendering. The table leaves out three spec steps: "reveal" and "flush autofocus candidates" (before resize) and "process top layer removals" (after paint). This does not make the table wrong. The spec says 30 Hz, and "4 rendering opportunities per second" for pages the UA slows down. Coalesced dispatch just before rAF is Chrome behavior (inside-browser-part4 lists `wheel`, `mousewheel`, `mousemove`, `pointermove`, `touchmove`). The IntersectionObserver spec delivers entries in a queued task.
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering, https://w3c.github.io/IntersectionObserver/ (3.2.4 "Queue a task on the IntersectionObserver task source"), https://developer.chrome.com/blog/inside-browser-part4

### Keep the HTML document request fast: no redirects, fast server, compressed body
- Verdict: verified
- Note: The insight text is "It took more than 600ms for the server to respond". The insight also says "The Core Web Vitals recommended Time to First Byte (TTFB) time (800 ms) is longer than the server response time recommended by this insight (600ms)". This insight page was published 2025-03-27. Server-Timing: Baseline high 2025-09-27 (Chrome 65, Firefox 61, Safari 16.4). `Content-Encoding: zstd`: Chrome 123, Firefox 126, Safari 26.3 (BCD). Servers pick the encoding from `Accept-Encoding`, so the advice is safe.
- Evidence: https://developer.chrome.com/docs/performance/insights/document-latency, https://web.dev/articles/optimize-ttfb

### Stream the HTML and flush the head early
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-inp ("the browser implicitly yields periodically and automatically during page load" for streamed HTML; with client-side HTML "the browser will not yield until it has finished parsing that HTML")

### Send 103 Early Hints for critical origins and assets
- Verdict: corrected
- Correction: The Chrome page (updated 2026-07-10) does not state "HTTP/2 or HTTP/3 only" as a browser limit. It states "Early Hints are recommended to only be sent over HTTP/2 or HTTP/3 connections". Change the caveat to "send only over HTTP/2 or HTTP/3 (Chrome recommendation)". The other facts are correct: navigation requests only; hints are dropped on a cross-origin redirect; non-cacheable preloads are "double fetched"; the "several hundred milliseconds" LCP gains from Shopify and Cloudflare. Support is correct and matches BCD: preconnect Chrome 103, Firefox 120, Safari 17; preload Chrome 103, Firefox 123, Safari no.
- Evidence: https://developer.chrome.com/docs/web-platform/early-hints, BCD `http.status.103.preconnect` / `.preload`

### Preconnect only to the one or two cross-origin hosts on the critical path
- Verdict: verified
- Note: web-features: `link-rel-preconnect` high 2022-07-15; `link-rel-dns-prefetch` low 2025-09-15 (Firefox 127, Safari iOS 26). web.dev: "If you omit the crossorigin attribute, the browser opens a new connection when it downloads the font files". optimize-lcp: "host critical resources on the same origin".
- Evidence: https://web.dev/learn/performance/resource-hints, https://web.dev/articles/optimize-lcp

### Keep pages eligible for the back/forward cache
- Verdict: corrected
- Correction: Two blockers in the Why line are out of date for Chrome. (1) `Cache-Control: no-store`: Chrome finished "the final rollout to 100% of users over March and April 2025" of bfcache for no-store pages. These pages are still excluded when cookies or other authorization methods change, when the page uses WebSocket, WebTransport or WebRTC, or when a fetch/XHR response has `Cache-Control: no-store`. (2) Open WebSockets: web.dev (updated 2026-07-02) says "Chrome (as of 149) and Safari do not block on open WebSockets but other browsers do." Suggested Why text: "`unload` listeners (Chrome/Firefox desktop), a non-null `window.opener`, and in some browsers `Cache-Control: no-store` and open IndexedDB/WebSocket/WebRTC connections block it." Keep the Do line (close in `pagehide`, reopen in `pageshow`), because Firefox still blocks on open WebSockets. Status is correct: NotRestoredReasons is Chrome 125 only (web-features `bfcache-blocking-reasons`, not Baseline).
- Evidence: https://web.dev/articles/bfcache, https://developer.chrome.com/docs/web-platform/bfcache-ccns

### Prerender or prefetch likely next navigations with speculation rules
- Verdict: corrected
- Correction: (1) Status "Safari 26.2 behind a flag" is too broad. BCD: Safari 26.2 behind a flag has `urls`, `where`, `prefetch`, and eagerness (partial: "Only `conservative` is supported for document rules"). Safari has no `prerender` support, not even behind a flag (BCD `html.elements.script.type.speculationrules.prerender`: Safari false). The example uses `prerender`, so it is Chromium-only. (2) Eagerness meanings changed: from Chrome 143, `eager` on desktop fires after a 10 ms pointer hover. On mobile, `eager` fires 50 ms after a link enters the viewport. The old "at once" behavior is now `immediate`. (3) Add two skip conditions to the caveats: the user turned off the "Preload pages" setting, and pages opened in background tabs. The limits in the notes are correct: `immediate` allows 50 prefetch and 10 prerender; `eager`/`moderate`/`conservative` allow 2 each (FIFO). Chrome 109 and eagerness Chrome 121 are also correct.
- Evidence: https://developer.chrome.com/docs/web-platform/prerender-pages (updated 2026-01-23), BCD `html.elements.script.type.speculationrules.*`, https://api.webstatus.dev/v1/features/speculation-rules (Limited; Chrome/Edge 109 only)

### Declare the charset in the first 1024 bytes
- Verdict: verified
- Evidence: https://developer.chrome.com/docs/performance/insights/charset ("The element must be fully contained within the first 1024 bytes")

### Include a mobile viewport meta tag in the initial HTML
- Verdict: corrected
- Correction: "~960 px default width" comes from MDN's CRP guide ("generally 960px"). The MDN viewport-meta page and current mobile browsers use 980 px ("pages might be rendered with a virtual viewport of 980px"). Use "~980 px". The 300 ms tap delay and the insight rule (`width` set and `initial-scale` >= 1) are correct.
- Evidence: https://developer.chrome.com/docs/performance/insights/viewport, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path

### Keep the head lean: only what the first paint needs
- Verdict: verified
- Note: Spec text: "A Document document allows adding render-blocking elements if document's content type is "text/html" and the body element of document is null". It is render-blocked while the set is non-empty or adding is still allowed, until "an implementation-defined timeout". web.dev preload-scanner confirms that large inlined content delays discovery (its base64-font demo moved LCP from 3.5 s to more than 7 s).
- Evidence: https://html.spec.whatwg.org/multipage/dom.html#render-blocking-mechanism, https://web.dev/articles/preload-scanner

### Never use document.write
- Verdict: verified
- Note: web-features `document-write` is discouraged ("very idiosyncratic behavior"), with alternative `dom`.
- Evidence: https://developer.chrome.com/blog/inside-browser-part3, https://cdn.jsdelivr.net/npm/web-features/data.json

### Server-render the first view instead of building it in client JS
- Verdict: verified
- Evidence: https://web.dev/articles/preload-scanner ("any resources in that markup are effectively invisible to the preload scanner"), https://web.dev/articles/optimize-inp

### Keep critical resources as plain tags in the HTML markup
- Verdict: verified
- Evidence: https://web.dev/articles/preload-scanner ("the preload scanner doesn't read the data- prefix in the same way that it would an src")

### Preload late-discovered critical resources, with the right as and crossorigin
- Verdict: verified
- Note: web.dev states "A resource specified in a preload directive is downloaded twice if the as attribute is missing". The quote "when you prioritize everything, nothing will be" is not on the cited resource-hints page. That page says "preload may create bandwidth contention". Remove the quote marks or cite a source. Status is correct: `link-rel-preload` high 2023-07-26; `preloading-responsive-images` high 2026-06-11 (`imagesrcset`/`imagesizes`: Chrome 73, Firefox 78, Safari 17.2).
- Evidence: https://web.dev/learn/performance/resource-hints, BCD `html.elements.link.imagesrcset`

### Flatten ES module waterfalls with modulepreload
- Verdict: verified
- Note: web.dev: the browser can "parse and compile the module as soon as it's done fetching". It fetches dependencies only if it chooses ("Browsers don't have to do this, but they can"). web-features `modulepreload` high 2026-03-18 (Firefox 115, Safari 17).
- Evidence: https://web.dev/articles/modulepreload

### Give the LCP image fetchpriority=high and never lazy-load it
- Verdict: verified
- Note: The insight checks three conditions: `fetchpriority=high` (also on the preload), discoverable from HTML, and no `loading=lazy`. Support: `fetchpriority` attribute on img/link Chrome 101, Firefox 132, Safari 17.2 (BCD). The `fetch()` `priority` option has the same versions (BCD `api.fetch.options_parameter.priority`). web-features `fetch-priority` low 2024-10-29. The Impact line "images start at Low" is incomplete: from Chrome 117, the first 5 large images start at Medium (see the tight-mode item).
- Evidence: https://developer.chrome.com/docs/performance/insights/lcp-discovery, https://web.dev/articles/fetch-priority

### Know Chrome's tight mode when you order head resources
- Verdict: corrected
- Correction: This is not a blog-only fact. web.dev/articles/fetch-priority (a source this item already cites, updated 2023-11-14) states: "As of Chrome 117, the first 5 large images are set to 'Medium' to speed this up, and two of them can be fetched in parallel during the initial 'tight mode'." Replace "Blog sources say Chrome 117+ ... check the Network panel" with this quote, and remove "Blog-only source" from the caveats. Smashing (Geoff Graham, 2025-01-09) gives the end condition as "until the body is attached to the document". The rule is "low-priority resources are only loaded if there are less than two in-flight requests at the time that they are discovered". Safari enforces its tight mode while blocking JS or CSS exists anywhere in the document. Firefox "doesn't take any extra tightening measures". The notes match these.
- Evidence: https://web.dev/articles/fetch-priority, https://www.smashingmagazine.com/2025/01/tight-mode-why-browsers-produce-different-performance-results/

### Shrink render-blocking CSS: remove unused rules, minify, compress
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path ("While the DOM construction is incremental, CSSOM is not"), https://developer.chrome.com/docs/performance/insights/render-blocking

### Replace CSS @import with link elements
- Verdict: verified
- Evidence: https://web.dev/learn/performance/optimize-resource-loading, https://web.dev/articles/preload-scanner

### Inline small critical CSS and load the rest without blocking render
- Verdict: verified
- Note: The case study numbers are FCP "1s" to "0.8s" ("a 20% improvement"). That article was last updated 2019-02-17. The insight warns: "Inlining CSS is an advanced performance technique that can improve performance, but can also lead to bugs".
- Evidence: https://web.dev/articles/defer-non-critical-css, https://developer.chrome.com/docs/performance/insights/render-blocking

### Split CSS by media query and give each link a matching media attribute
- Verdict: verified
- Note: The web.dev priority table lists "CSS (media mismatch)" at "Lowest".
- Evidence: https://web.dev/articles/fetch-priority, https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Critical_rendering_path

### Put no sync script right after a stylesheet unless it needs those styles
- Verdict: verified
- Note: Spec: an element "contributes a script-blocking style sheet" when the parser created it, it is a `style` or styling `link`, and its media matches.
- Evidence: https://html.spec.whatwg.org/multipage/semantics.html#contributes-a-script-blocking-style-sheet

### Use body-level stylesheets only for progressive sections, and expect them to block the parser below
- Verdict: verified
- Note: The cited Catchpoint article (Tim Kadlec, 2021) lists the `in_body_parser_blocking` value but does not discuss body stylesheets. Better evidence: Lighthouse issue #5452 ("As of Chrome M69, all stylesheets that are in-body are not considered render blocking"). DebugBear also explains that body resources are marked `in_body_parser_blocking`.
- Evidence: https://github.com/GoogleChrome/lighthouse/issues/5452, https://www.debugbear.com/blog/render-blocking-resources, https://www.catchpoint.com/blog/new-render-blocking-indicator-in-chrome-and-webpagetest

### Default app scripts to defer or type=module; use async only for independent scripts
- Verdict: verified
- Note: MDN: "If the attribute is specified with the defer attribute, the element will act as if only the async attribute is specified". It also says "The defer attribute has no effect on module scripts". web-features `js-modules` high 2020-11-09.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script

### Keep inline scripts tiny; ship large code as external files
- Verdict: verified
- Note: V8: "now also regular synchronous scripts are parsed that way (not inline scripts though)" (Chrome 72). It also says "if the script is over 1 kB, avoid inlining it (also because 1 kB is when code caching kicks in for external scripts)".
- Evidence: https://v8.dev/blog/cost-of-javascript-2019

### Split the startup bundle so the critical path carries only first-view code
- Verdict: verified
- Evidence: https://v8.dev/blog/cost-of-javascript-2019 ("if a bundle exceeds ~50–100 kB, split it up")

### Use blocking=render only to hide a known flash of wrong content
- Verdict: verified
- Note: BCD: `script`/`link` `blocking` Chrome 105, Safari 18.2, Firefox no. web-features `blocking-render` is not Baseline. MDN: "If such a script element is added dynamically via script, you must set blocking = "render" for it to block rendering." The CSS Wizardry URL exists and has the typo "whould" ("blocking=render: Why would you do that?!", Harry Roberts, 2024-08-14). That article says `blocking=render` "has no such timeout" (it compares this with `font-display: block`). The spec has an implementation-defined timeout for the render-blocked state. The notes follow the spec, so the notes are correct.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script, https://csswizardry.com/2024/08/blocking-render-why-whould-you-do-that/

### Use rel=expect with blocking=render only to stabilize cross-document view transitions
- Verdict: verified
- Note: BCD `html.elements.link.rel.expect`: Chrome 124 only, experimental. Spec: rendering stays blocked while "indicatedElement is not an element, or is on a stack of open elements".
- Evidence: https://html.spec.whatwg.org/multipage/links.html#link-type-expect

### Make critical fonts discoverable early and keep text visible
- Verdict: corrected
- Correction: The Status line cites the wrong feature. The Do line uses the `@font-face` descriptors `size-adjust` and `ascent-override`, but the status gives the CSS property `font-size-adjust`. Correct status: `size-adjust` descriptor Chrome 92, Firefox 92, Safari 17 (BCD `css.at-rules.font-face.size-adjust`). `ascent-override` Chrome 87, Firefox 89, and Safari only in Technology Preview (BCD `css.at-rules.font-face.ascent-override`), so it has no effect in shipping Safari. Add: "`ascent-override`/`descent-override` do not work in Safari; `size-adjust` works in all engines." Other facts are correct: `font-display` high 2022-07-15; the insight passes only with `swap` or `optional`; web.dev font-display table: block period 2-3 s for `block`, 100 ms for `optional`.
- Evidence: https://web.dev/articles/font-best-practices, https://developer.chrome.com/docs/performance/insights/font-display, BCD 8.1.2

### Reserve space for images, iframes and late UI
- Verdict: verified
- Note: BCD `html.elements.img.aspect_ratio_computed_from_attributes`: Chrome 79, Firefox 71, Safari 15. This width/height-to-aspect-ratio mapping applies to img/video/canvas. For `<iframe>`, `width`/`height` set fixed dimensions (there is no ratio mapping). web-features `aspect-ratio`: low 2021-09-20, high 2024-03-20.
- Evidence: https://web.dev/articles/optimize-cls

### Lazy-load only below-the-fold images and iframes, natively
- Verdict: verified
- Note: web-features `loading-lazy` high 2026-06-19 (Firefox 121 was the last engine for iframes). There is a new separate feature `loading-lazy-media` (`<video>`/`<audio>`) in Chrome 150 only, not Baseline.
- Evidence: https://developer.chrome.com/docs/performance/insights/lcp-discovery, https://web.dev/articles/preload-scanner

### Keep selectors simple and style changes narrow
- Verdict: verified
- Note: web.dev: "Roughly half of the time used in Blink to calculate the computed style for an element is used to match selectors". This article was last updated 2015-03-20.
- Evidence: https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations

### Keep the DOM small and shallow; create hidden UI on demand
- Verdict: verified
- Note: Insight text: "This insight only fails if there is a large layout or style recalculation exceeding a duration of 40ms", with "over 100 layout objects" or "more than 300 elements".
- Evidence: https://developer.chrome.com/docs/performance/insights/dom-size

### Skip rendering of off-screen sections with content-visibility:auto
- Verdict: verified
- Note: web.dev (updated 2025-09-23): "rendering times going from 232ms to 30ms". web-features `content-visibility` low 2025-09-15 (Chrome 108, Firefox 130, Safari 26). BCD `auto` value: Chrome 85, Firefox 125, Safari 26. `contain-intrinsic-size` is Baseline high 2026-03-18.
- Evidence: https://web.dev/articles/content-visibility

### Contain independent widgets such as chart containers
- Verdict: verified
- Note: web-features `contain` high 2024-09-14.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/contain

### Batch DOM reads before writes; never read geometry after a write in the same task
- Verdict: verified
- Note: Insight: "Have no forced reflows that take longer than 30 milliseconds."
- Evidence: https://developer.chrome.com/docs/performance/insights/forced-reflow

### Animate only compositor properties: transform, opacity, filter
- Verdict: verified
- Note: "How cc works": the framework "supports keyframe based animations of transform lists, opacity, and filter lists". The 2021 Chrome post (not updated since 2021-02-22) still says `background-color` and `clip-path` are "slated" for future versions. I also found no primary source that says they shipped (only Chromium code-review threads). This part stays unverified, as the notes say.
- Evidence: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/how_cc_works.md, https://developer.chrome.com/blog/hardware-accelerated-animations

### Use will-change sparingly and just in time
- Verdict: verified
- Note: "Low-DPI devices do not auto-promote fixed elements" comes from web.dev simplify-paint-complexity (last updated 2015-03-20), not from the stick-to-compositor article. The "4-5ms" compositing target is in stick-to-compositor (2015). Both are 2015 guidance. Label them as dated. I did not check current Chromium behavior for fixed-position promotion on low-DPI screens. web-features `will-change` high 2022-07-15.
- Evidence: https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas, https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count

### Reduce paint area and paint cost
- Verdict: corrected
- Correction: "Only transform and opacity changes avoid paint" copies the 2015 article ("Changing any property apart from transforms or opacity always triggers paint"). It conflicts with the compositor item in the same file. In Chromium, composited `filter` animations also run on the compositor without repaint ("opacity, filter, and transform" are hardware-accelerated by default, Chrome 2021). Suggested text: "Only compositor-animated transform, opacity and (in Chromium) filter changes avoid paint." The union-of-dirty-regions claim is correct.
- Evidence: https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas, https://developer.chrome.com/blog/hardware-accelerated-animations, https://chromium.googlesource.com/chromium/src/+/HEAD/docs/how_cc_works.md

### Decode large images before they enter the frame
- Verdict: verified
- Note: "How cc works": image decodes "are the most expensive part of raster" and "Each decode receives its own dependent task". BCD `HTMLImageElement.decode`: Chrome 64, Firefox 68, Safari 11.1.
- Evidence: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/how_cc_works.md

### Write visual updates inside requestAnimationFrame and drive motion by its timestamp
- Verdict: verified
- Note: web-features `request-animation-frame` high 2018-01-29.
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering, https://developer.chrome.com/blog/inside-browser-part4

### Paint the response first, then defer non-visual work until after the next frame
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-inp (`requestAnimationFrame(() => { setTimeout(() => {...}, 0); })`)

### Break long tasks by yielding about every 50 ms
- Verdict: verified
- Note: BCD `Scheduler.yield`: Chrome 129, Firefox 142, Safari no. webstatus.dev `scheduler`: Limited, same versions. web.dev puts the nested-timeout clamp at "5 millisecond". The spec and MDN put it at 4 ms, so "4-5 ms" is correct. `isInputPending` is discouraged in web-features.
- Evidence: https://web.dev/articles/optimize-long-tasks, https://api.webstatus.dev/v1/features/scheduler

### Use passive listeners and attach non-passive wheel/touch handlers only to the chart surface
- Verdict: corrected
- Correction: "Browsers other than Safari default wheel/touchstart/touchmove on window/document/body to passive" is wrong for touch. BCD: the passive default for `touchstart`/`touchmove` is in all engines (Chrome 55, Firefox 61, Safari 11.1, Safari iOS 11.3). The passive default for `wheel`/`mousewheel` is Chrome 73 and Firefox 84 only (Safari: no). Suggested text: "All engines default touchstart/touchmove listeners on window/document/body to passive; Chrome and Firefox (not Safari) also default wheel there." MDN's prose ("in browsers other than Safari...") is less exact than MDN's own compat data. The `passive` option versions (Chrome 51, Firefox 49, Safari 10) are correct.
- Evidence: BCD `api.EventTarget.addEventListener.options_parameter.options_passive_parameter_default_true_touch` / `_default_true_wheel`, https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener, https://developer.chrome.com/blog/inside-browser-part4

### Read coalesced pointer events when you need every input point
- Verdict: verified
- Note: "a typical touch-screen device delivers touch event 60-120 times a second, and a typical mouse delivers events 100 times a second". BCD `getCoalescedEvents`: Chrome 58, Firefox 59, Safari 18.2.
- Evidence: https://developer.chrome.com/blog/inside-browser-part4

### Size canvases from ResizeObserver; use IntersectionObserver to pause off-screen work
- Verdict: verified
- Note: BCD `devicePixelContentBoxSize`: Chrome 84, Firefox 108, Safari no. RO high 2023-01-28. IO high 2021-09-25. The IO spec queues a task to notify observers.
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering, https://w3c.github.io/IntersectionObserver/

### Stop render loops when the document is hidden
- Verdict: verified
- Note: web-features `page-visibility` high 2018-01-29.
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering

### Move heavy canvas or WebGL drawing off the main thread with OffscreenCanvas
- Verdict: verified
- Note: web-features `offscreen-canvas` and `request-animation-frame-workers` are both high 2025-09-27 (Safari 16.4).
- Evidence: https://web.dev/articles/offscreen-canvas

### Do not rely on requestIdleCallback alone
- Verdict: verified
- Note: BCD 8.1.2: Safari "preview flag" only. web-features `requestidlecallback` is not Baseline (Chrome 47, Firefox 55). The fallback `scheduler.postTask` is also missing in Safari, so `setTimeout` must be the final fallback.
- Evidence: BCD `api.Window.requestIdleCallback`, web-features `requestidlecallback`

### Read the CRP in the DevTools Performance panel before and after each change
- Verdict: corrected
- Correction: Use the official insight titles. "Character encoding" is **Declare a character encoding**. "Viewport" is **Optimize viewport for mobile**. Not all insight pages were "published 2025-10-08": Document request latency was published 2025-03-27. All the event titles (Parse HTML, Pre-paint, Layerize, Commit, Compute intersections, Rasterize paint, Image decode, Streaming compile task, and the others) exist in the current `Styles.ts`. The pass rules (30 ms; 40 ms with 300 elements/100 layout objects) and the LCP subpart targets (~40% / <10% / ~40% / <10%) are correct.
- Evidence: https://developer.chrome.com/docs/performance/insights, https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/models/trace/Styles.ts, https://web.dev/articles/optimize-lcp

### Measure frame phases in the field with Long Animation Frames and renderBlockingStatus
- Verdict: verified
- Note: "the LoAF API has shipped from Chrome 123". Firefox and Safari do not support it. BCD marks it experimental. The attribute names `blockingDuration`, `renderStart`, `styleAndLayoutStart`, `invoker`, `sourceURL` and `forcedStyleAndLayoutDuration` are correct. `renderBlockingStatus`: Chrome 107 only.
- Evidence: https://developer.chrome.com/docs/web-platform/long-animation-frames, BCD `api.PerformanceResourceTiming.renderBlockingStatus`

### Let the agent verify CRP changes with Chrome DevTools MCP traces
- Verdict: corrected
- Correction: (1) The current tool reference lists `pageId` (number) as **required** on `emulate`, `performance_start_trace`, `list_webmcp_tools` and other page tools. Get it from `list_pages`. The workflow must pass it. (2) `performance_start_trace`: `reload` and `autoStop` default to `true` (tool schema). (3) `cpuThrottlingRate` range is 1-20. (4) CrUX opt-out: `--performanceCrux=false` (the README also shows `--no-performance-crux`). (5) File paths: "file-writing tools are restricted to the OS temp directory when no roots are configured". Otherwise they are restricted to the MCP roots or `--filesystemRoot`/`--workspace`. The notes' "must be inside the MCP server's workspace roots" misses the temp-directory case. The insight names `RenderBlocking`, `LCPBreakdown`, `NetworkDependencyTree`, `CLSCulprits` and `DocumentLatency` match the devtools-frontend `insights/` files. "`lighthouse_audit` ... excludes performance" is correct. Not re-verified: the `priority`/`initialPriority`/`renderBlocking` fields on network rows.
- Evidence: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md, https://github.com/ChromeDevTools/devtools-frontend/tree/main/front_end/models/trace/insights

### Expose read-only render diagnostics as dev-only tools for agents (WebMCP or DevTools 3P tools)
- Verdict: verified
- Note: The live docs match: `document.modelContext.registerTool`; annotations `readOnlyHint`, `consequentialHint`, and also `untrustedContentHint`; "As of Chrome 153, you can unregister a tool without cancelling"; "JSON stringified input arguments are deprecated from Chrome 155"; "Join the WebMCP origin trial from Chrome 149"; `chrome://flags/#enable-webmcp-testing`; the `tools` Permissions Policy with `allow="tools"`. Two notes. (1) "Origin-isolated" means an origin-keyed agent cluster. WebMCP is off only when `document.domain` is on (for example with `Origin-Agent-Cluster: ?0`). It does not require COOP/COEP cross-origin isolation. (2) The docs conflict on the flag. The DevTools "Debug WebMCP tools" page (updated 2026-05-12) says to enable `--categoryWebMCP`. The current chrome-devtools-mcp tool reference says `--categoryExperimentalWebmcp=true`, which matches the notes. Check `npx chrome-devtools-mcp --help` before you depend on either. The 3P flow (`devtoolstooldiscovery`, `event.respondWith`, `window.__dtmcp.executeTool()`, `--categoryExperimentalThirdParty=true`) matches the GitHub doc.
- Evidence: https://developer.chrome.com/docs/ai/webmcp, https://developer.chrome.com/docs/ai/webmcp/imperative-api, https://developer.chrome.com/docs/devtools/application/webmcp, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/third-party-developer-tools.md

---

## Cross-file conflicts

- No other file makes conflicting claims. The only other notes file is `00-course-modules.md`, a list of 14 web.dev course modules with no claims on these topics.
- Conflicts inside this file:
  1. "Reduce paint area and paint cost" says "Only transform and opacity changes avoid paint". "Animate only compositor properties" and the Threads summary say filter is also composited. Fix the first one (see the correction above).
  2. "Give the LCP image fetchpriority=high" says images "start at Low priority". "Know Chrome's tight mode" says Chrome 117+ starts the first 5 large images at Medium. Both need the same statement (web.dev fetch-priority).
  3. "Know Chrome's tight mode" calls itself blog-only, but the web.dev article it cites states the Chrome 117 behavior and tight mode.
  4. "Keep pages eligible for the back/forward cache" treats `Cache-Control: no-store` and open connections as general blockers. That is out of date for Chrome (no-store pages allowed since 2025 unless cookies change; WebSockets allowed from Chrome 149).

## Missing but important

1. Cache lifetimes for static assets (hashed file names + long `max-age`/`immutable`). This is the DevTools "Use efficient cache lifetimes" insight, and it drives repeat-visit CRP cost. https://developer.chrome.com/docs/performance/insights
2. HTTP/2 or HTTP/3 on every critical origin. This is the "Modern HTTP" insight, which flags HTTP/1.1 requests. https://developer.chrome.com/docs/performance/insights
3. Paint Holding facts: the old page is kept until FCP or 500 ms, and since 2021 this covers most cross-origin navigations. Without these facts, the notes cannot explain why short blank periods are not seen. https://github.com/web-platform-tests/wpt/pull/27670
4. `fetchpriority="high"` on a critical `async`/`defer`/module script: Chrome gives these scripts "Low" priority by default. https://web.dev/articles/fetch-priority
5. `decoding="async"` on `<img>` as the markup equivalent of `img.decode()` (BCD: Chrome 65, Firefox 63, Safari 11.1). https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img
6. The `Speculation-Rules` HTTP response header (Chrome 121) adds rules without changing the HTML. `expects_no_vary_search` (Chrome 127) raises prefetch hit rates for URLs with query parameters. BCD `http.headers.Speculation-Rules`, `html.elements.script.type.speculationrules.expects_no_vary_search`; https://developer.chrome.com/docs/web-platform/prerender-pages
7. Cross-document view transitions (`@view-transition { navigation: auto; }`): Chrome 126, Safari 18.2, not Firefox, not Baseline. This is the reason `rel=expect` exists. web-features `cross-document-view-transitions`; https://developer.chrome.com/docs/web-platform/view-transitions/cross-document
8. Native `loading="lazy"` for `<video>`/`<audio>` (Chrome 150 only, not Baseline). This extends the lazy-load item. web-features `loading-lazy-media`.
9. The "Duplicated JavaScript" and "Legacy JavaScript" DevTools insights, which support the "Split the startup bundle" item. https://developer.chrome.com/docs/performance/insights
10. The bfcache no-store rollout in Chrome (a 2025 change): pages with `Cache-Control: no-store` can now enter bfcache unless cookies or auth change. Put this in the bfcache item, because many teams add `no-store` to HTML only because of old advice. https://developer.chrome.com/docs/web-platform/bfcache-ccns
