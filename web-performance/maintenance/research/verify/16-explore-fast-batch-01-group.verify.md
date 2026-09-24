# Verify: 16-explore-fast-batch-01.md, 16-explore-fast-batch-02.md

Checked on 2026-09-23. Items: 79 (46 in batch 01, 33 in batch 02).

| File | Verified | Corrected | Disputed | Unverified |
|---|---|---|---|---|
| 16-explore-fast-batch-01.md | 35 | 10 | 1 | 0 |
| 16-explore-fast-batch-02.md | 22 | 10 | 1 | 0 |
| Total | 57 | 20 | 2 | 0 |

Most important findings:
1. Since Chrome 145, Chromium runs each deferred or module script in its own task (`SeparateDeferModuleScriptTasks`, stable). Batch 01 says the opposite (item title, line 13 and line 867).
2. Lazy `<video>`/`<audio>` shipped in Chrome 148 without `<source>` support. Full support came in Chrome 150.
3. 103 Early Hints `preload` does not work in Safari (Safari accepts only `preconnect` in 103). Speculation-rules `prerender` does not exist in Safari, not even behind a flag.
4. LoAF: ResizeObserver and IntersectionObserver work falls after `styleAndLayoutStart`, not before it (HTML "update the rendering").
5. Chromium keeps an unused preconnected socket about 60 s, not 10 s. It reuses an unused prefetched cache entry for up to 5 minutes without validation.
6. `font-display: block` can still shift layout. SvelteKit does not stream the page HTML progressively. Vite 8 removed the object form of `manualChunks`.

Method: I read both notes files in full and grepped the saved article text in `raw/fast-batch-1/` and `raw/fast-batch-2/`. I queried the local BCD 8.1.2 (npm `latest`, 2026-09-17) and web-features data (it includes Safari 27, 2026-09-14) with `raw/verify/16a/q.py`. I read Chromium `main` source files (`resource_fetcher.cc`, `features.cc`, `preload_helper.cc`, `http_cache_transaction.cc`, `settings.json5`). I checked WHATWG issue and PR states through the GitHub API and chromestatus JSON (5054329641893888, 5636954674692096, 5135917565214720). I also read web-vitals 6.2.2, the quicklink source, the Vite 8 docs, the HTML and Layout Instability specs, and developer.chrome.com pages. Raw files are in `raw/verify/16a/`.

## 16-explore-fast-batch-01.md

### Start the LCP image at High priority with `fetchpriority="high"` instead of waiting for the layout boost
- Verdict: verified
- Note: BCD 8.1.2 gives Chrome 101 for the attribute. web-features `fetch-priority` gives Chrome 103 (the feature also covers the `Link` header). Both are correct for their scope. Chromium `main` still has the Chrome 117 rule: `kBoostedImageTarget = 5` and `kSmallImageMaxSize = 10000` in `resource_fetcher.cc`. The boost applies only to images that the preload scanner finds in the document (not to `<link rel=preload>`), and "only boost the priority if one wasn't explicitly set". The "two in parallel during tight mode" detail comes from the article only. I did not find it in source.
- Evidence: https://web.dev/articles/fetch-priority ("As of Chrome 117, the first 5 large images are set to "Medium"") ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/loader/fetch/resource_fetcher.cc ; MDN browser-compat-data 8.1.2 (2026-09-17) `html.elements.img.fetchpriority` ; web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `fetch-priority` (low 2024-10-29)

### Pair `preload` (for discovery) with `fetchpriority="high"` (for priority) for CSS-background and poster LCP images
- Verdict: corrected
- Correction: Status: `<link rel=preload>` is Baseline newly available 2021-01-26 and widely available 2023-07-26 (web-features `link-rel-preload`). It is not "widely available (2021)". Add one fact to the Do line: when the LCP element is an `<img>` that you also preload, put `fetchpriority="high"` on both the `<img>` and the preload. The DevTools "LCP request discovery" insight says: "When preloading the image, ensure `fetchpriority=high` is set on the preload as well as the image." The rest is verified against the article: "If a critical image is a CSS background image, preload it with `fetchpriority = "high"`."
- Evidence: web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `link-rel-preload` ; https://developer.chrome.com/docs/performance/insights/lcp-discovery (published 2025-10-08) ; https://web.dev/articles/fetch-priority

### Lower in-viewport-but-unimportant images with `fetchpriority="low"` rather than relying on `loading="lazy"`
- Verdict: verified
- Note: Article: "In an earlier experiment with the Oodle app, we used this to lower the priority of images that don't appear on load. It decreased page load time by 2 seconds." In Chromium, any explicit `fetchpriority` also turns off the "first 5 large images start at Medium" boost for that image.
- Evidence: https://web.dev/articles/fetch-priority ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/loader/fetch/resource_fetcher.cc

### Raise important `async` scripts with `fetchpriority="high"` instead of the preload hack, and lower late parser-blocking scripts with `fetchpriority="low"`
- Verdict: verified
- Note: Article: "these scripts are also assigned a "Low" priority" and the example `<script src="async_but_important.js" async fetchpriority="high">`. BCD `html.elements.script.fetchpriority`: Chrome 101, Firefox 132, Safari 17.2.
- Evidence: https://web.dev/articles/fetch-priority ; MDN browser-compat-data 8.1.2 (2026-09-17) `html.elements.script.fetchpriority`

### Give background data fetches `priority: 'low'` so they do not compete with fetches that respond to user input
- Verdict: verified
- Note: Article: "The browser executes `fetch` with a high priority" and "With no explicit destination, fetch is prioritized like an async XHR." BCD `api.fetch.options_parameter.priority` and `api.Request.Request.options_parameter.priority`: Chrome 101, Firefox 132, Safari 17.2.
- Evidence: https://web.dev/articles/fetch-priority ; MDN browser-compat-data 8.1.2 (2026-09-17)

### Lower non-critical preloads with `fetchpriority="low"`, including a non-blocking stylesheet preload
- Verdict: verified
- Note: The article has this exact example: `<link rel="preload" as="style" href="theme.css" fetchpriority="low" onload="this.rel='stylesheet'">`.
- Evidence: https://web.dev/articles/fetch-priority

### Treat `fetchpriority` as relative, and know where it cannot help
- Verdict: verified
- Note: Article: "`fetchpriority` sets relative priority, meaning it raises or lowers the default priority by an appropriate amount". The table footnote confirms that media-mismatched CSS "isn't fetched by the preload scanner".
- Evidence: https://web.dev/articles/fetch-priority

### Place preloads by type so that preloads do not delay one another
- Verdict: verified
- Note: All four rules are in the article's "Tips for using preloads". Related fact: current Chromium ignores `rel=preload` in a `Link` header on a subresource response (feature `kRestrictLinkHeaderOnSubresource`, enabled by default, param `disable_resource_load` = true). A `Link` header on the HTML document response still works.
- Evidence: https://web.dev/articles/fetch-priority ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/common/features.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/loader/preload_helper.cc

### Check the priority each request actually got in DevTools before and after you add hints
- Verdict: verified
- Note: Article: "Make sure you include the priority column by right-clicking the table headings" and "you can see both the initial and final priority in the Big request rows setting". The DevTools "LCP request discovery" insight (2025-10-08) now checks `fetchpriority=high`, discoverability and lazy loading of the LCP image for you.
- Evidence: https://web.dev/articles/fetch-priority ; https://developer.chrome.com/docs/performance/insights/lcp-discovery

### Keep recurring timers light, and prefer self-rescheduling `setTimeout` to `setInterval` for periodic work
- Verdict: verified
- Note: Article: "`setInterval`'s recurring nature makes it much more likely that it will get in the way of an interaction". Small gap in the example: the comment says "pauses while hidden", but the loop still wakes up every second and only skips the work. To match the Do line ("stop timers while the tab is hidden"), clear the timer on `visibilitychange` to `hidden` and start it again on `visible`.
- Evidence: https://web.dev/articles/optimize-input-delay

### Debounce bursty input handlers and abort superseded network requests
- Verdict: corrected
- Correction: Status: abortable fetch is Baseline newly available 2019-03-25 and widely available 2021-09-25 (web-features `abortable-fetch`). It is not "widely available (2019)". The rest is verified. The article says to "Use `AbortController` to cancel outgoing `fetch` requests" and "an `AbortController` instance's `signal` property can also be used to abort events". BCD `addEventListener` `signal`: Chrome 90, Firefox 86, Safari 15.
- Evidence: web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `abortable-fetch` ; https://web.dev/articles/optimize-input-delay ; MDN browser-compat-data 8.1.2 (2026-09-17) `api.EventTarget.addEventListener.options_parameter.options_signal_parameter`

### Judge DOM size by how long style and layout take, not by a fixed node count
- Verdict: verified
- Note: DevTools source: `DOM_SIZE_DURATION_THRESHOLD` = 40 ms, `LAYOUT_OBJECTS_THRESHOLD = 100`, `STYLE_RECALC_ELEMENTS_THRESHOLD = 300`. Insight page: "This insight only fails if there is a large layout or style recalculation exceeding a duration of 40ms." The article still says Lighthouse warns above 800 nodes and fails above 1,400. Lighthouse 13 replaced the `dom-size` audit with `dom-size-insight`.
- Evidence: https://developer.chrome.com/docs/performance/insights/dom-size ; https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/insights/DOMSize.ts (saved as raw/verify/14/dtf_insights_DOMSize.ts) ; https://developer.chrome.com/blog/moving-lighthouse-to-insights

### Flatten wrapper nesting with framework fragments and flex or grid
- Verdict: verified
- Note: svelte.dev: "In Svelte 5+, this concept is obsolete, as snippets don't create a wrapping element". The article lists Svelte among frameworks with fragments.
- Evidence: https://svelte.dev/docs/svelte/legacy-svelte-fragment ; https://web.dev/articles/dom-size-and-interactivity

### Add hidden parts of the UI to the DOM when they are needed, not at startup (the "additive" approach)
- Verdict: verified
- Evidence: https://web.dev/articles/dom-size-and-interactivity ("Consider an additive approach")

### Do not keep large `querySelectorAll` results alive
- Verdict: verified
- Note: Article: "if you call `document.querySelectorAll` to select all `<div>` elements on a page, the memory cost could be considerable".
- Evidence: https://web.dev/articles/dom-size-and-interactivity

### Split large classic bundles so each `<script>` creates a smaller evaluation task (about 100 KB per script as a starting target)
- Verdict: corrected
- Correction: The Example is out of date for Vite. Vite 8 (npm `latest` 8.3.0, 2026-09-10) bundles with Rolldown. `build.rollupOptions` is now `build.rolldownOptions`. The object form of `output.manualChunks` "is not supported anymore", and the function form "is deprecated". Use Rolldown `output.codeSplitting`. Write the Example as: "webpack `optimization.splitChunks.maxSize`; Rollup `output.manualChunks`; Vite 8 `build.rolldownOptions.output.codeSplitting`; all of them split at dynamic `import()`". Add to the Why: since Chrome 145, Chromium also runs each deferred or module script in its own task (see the next item), so splitting a deferred bundle now shortens tasks too. The 100 KB figure is the article's own rule of thumb ("a limit of 100 kilobytes per individual script is a good target"). It has no measured source.
- Evidence: https://raw.githubusercontent.com/vitejs/vite/main/docs/guide/migration.md ("Removed object form `build.rollupOptions.output.manualChunks` and deprecate function form one") ; https://vite.dev/config/build-options ; https://registry.npmjs.org/vite ; https://web.dev/articles/script-evaluation-and-long-tasks

### Do not count on `defer` or `type=module` to split evaluation: Chromium runs the ready ones in one task with `DOMContentLoaded`
- Verdict: corrected
- Correction: The title, the Why and the Status are out of date for Chrome 145 and later. Since Chrome 145 (stable 145.0.7632.26, released 2026-02-10), Chromium runs each deferred classic script and each module script in its own task, and yields to the event loop between them. The runtime feature `SeparateDeferModuleScriptTasks` has `status: "stable"`. The commit is e7e02f3c, "Enable SeparateDeferModuleScriptTasks by default" (2026-01-09). `HTMLParserScriptRunner::ExecuteScriptsWaitingForParsing()` now says: "execute scripts one at a time with event loop yields between them to prevent long tasks". WHATWG html#6230 is still open (last update 2023-05-11), but Chromium now follows the spec model. Replacement title: "Do not count on `defer` or `type=module` alone to keep startup tasks short". Replacement Why: "Chromium 145+ runs each deferred or module script in its own task. Chromium 144 and older ran all of them in the `DOMContentLoaded` task. Each script is still one task, so one large deferred bundle still makes one long task." Keep the Do line (dynamic `import()` and yielding between phases).
- Evidence: https://chromiumdash.appspot.com/commit/e7e02f3ceba01c4519f58ab4b4c2445ba7566609 (saved raw/verify/01n/cd-separate-defer.json) ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/script/html_parser_script_runner.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/runtime_enabled_features.json5 ; https://github.com/whatwg/html/issues/6230 (open; updated 2023-05-11)

### Native ES modules: per-module compile tasks help, but unbundled static import chains create request waterfalls, so bundle or `modulepreload` them
- Verdict: disputed
- Correction: I dispute one sub-claim from the 2023 article: "Safari and Firefox evaluate each module in its own task". HTML "run a module script" calls `record.Evaluate()` once for the root module. ECMAScript `Evaluate()` runs the whole static graph depth-first in one call (InnerModuleEvaluation). Only top-level await splits it, through promise jobs. So a spec-conformant engine evaluates a static graph in one task. Separate tasks come from fetch and parse/compile work as each file arrives, which matches the Chromium "Compile module" tasks. Also, Safari 27 (2026-09-14) shipped "a complete standards-compliant rewrite of the ECMAScript module (ESM) loader", so observations of Safari from 2023 may not hold. I did not trace Firefox or Safari. The Do line (bundle, or `modulepreload` every module in the static graph) is verified. The status dates are correct: `modulepreload` high 2026-03-18, import maps high 2025-09-27.
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html#run-a-module-script ("Set evaluationPromise to record.Evaluate()") ; https://tc39.es/ecma262/#sec-innermoduleevaluation ; https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ; https://web.dev/articles/script-evaluation-and-long-tasks

### Use dynamic `import()` as split points so each loaded module compiles and evaluates in its own task, and keep each chunk small
- Verdict: verified
- Note: Article: "Dynamic `import()` calls behave similarly in all major browser engines". Precision: the imported module and its static dependencies evaluate together in one task (same ECMAScript rule as in the previous item).
- Evidence: https://web.dev/articles/script-evaluation-and-long-tasks

### Balance chunk size against compression and cache hits, and always use content-hashed file names
- Verdict: verified
- Note: See "Missing but important" for Compression Dictionary Transport, which lowers the re-download cost of changed hashed chunks.
- Evidence: https://web.dev/articles/script-evaluation-and-long-tasks

### Stream HTML from the server so the parser does the chunking and yielding for you
- Verdict: corrected
- Correction: SvelteKit is not a streaming HTML renderer in the same way as React `renderToPipeableStream`. SvelteKit renders the page shell and sends it. Then it streams only the data of promises that a server `load` function returns without `await`: "When using a server `load`, promises will be streamed to the browser as they resolve". This needs JavaScript ("Streaming data will only work when JavaScript is enabled"), and "On platforms that do not support streaming, such as AWS Lambda or Firebase, responses will be buffered". Proxies such as NGINX must not buffer. Replace "SvelteKit SSR" with "SvelteKit SSR (the shell arrives at once; un-awaited `load` promises stream later)". This matters for a Svelte app: the parser gets progressive chunks only for the streamed promise data, not for the page body. The React API names are verified on react.dev.
- Evidence: https://svelte.dev/docs/kit/load#Streaming-with-promises ; https://react.dev/reference/react-dom/server ; https://web.dev/articles/client-side-rendering-of-html-and-interactivity

### Keep LCP-critical resource URLs in the server HTML, because the preload scanner cannot see markup that client JS creates
- Verdict: verified
- Evidence: https://web.dev/articles/client-side-rendering-of-html-and-interactivity ; https://web.dev/articles/top-cwv ("35% of those images had source URLs that were not discoverable in the initial HTML response")

### When you build DOM on the client, choose the API deliberately and split large insertions across tasks
- Verdict: verified
- Note: BCD: `setHTMLUnsafe` Chrome 124, Firefox 123, Safari 26 (17.4 to 26 partial). `parseHTMLUnsafe` Firefox 128 (123 to 127 partial). web-features `parse-html-unsafe` low 2025-09-15. `document.write` has `deprecated: true`. `setHTML` (Sanitizer): Chrome 146 (2026-03-10), Firefox 148 (2026-02-24), not Safari. chromestatus 5054329641893888 ("Renewed HTML insertion&streaming methods"): dev trial 148, shipping stage milestone 155 (Chrome 155 stable is 2026-10-06), Firefox "Positive", Safari "No signal". WHATWG PR #12758 (updated 2026-09-16) and #12753 (updated 2026-09-22) are open.
- Evidence: MDN browser-compat-data 8.1.2 (2026-09-17) ; web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `parse-html-unsafe`, `sanitizer` ; https://chromestatus.com/feature/5054329641893888 ; https://github.com/whatwg/html/pull/12758 ; https://github.com/whatwg/html/pull/12753

### Consider a streaming service-worker architecture for multi-page apps
- Verdict: verified
- Note: Related lever the item does not name: service-worker static routing (`InstallEvent.addRoutes()`, Chrome 123 and Safari 27, not Firefox) lets the browser skip worker startup for routes that do not need the worker. Files 04 and 07 cover it.
- Evidence: https://web.dev/articles/client-side-rendering-of-html-and-interactivity ; web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `service-workers-static-routes`

### Inline `@font-face` rules (and the rules that use them) in `<head>` so font discovery does not wait for an external stylesheet
- Verdict: verified
- Evidence: https://web.dev/articles/font-best-practices

### Remember that a font downloads only when rendered content uses it, and load canvas-chart fonts explicitly
- Verdict: verified
- Evidence: https://web.dev/articles/font-best-practices ; https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/font ; web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `font-loading` (high 2022-07-15)

### Preconnect to third-party font origins, with `crossorigin` on the origin that serves the font files
- Verdict: verified
- Note: Live check on 2026-09-23: the `fonts.googleapis.com/css2` response carries `link: <https://fonts.gstatic.com>; rel=preconnect; crossorigin`. BCD `preconnect`: Chrome 46, Firefox 39, Safari 11.1.
- Evidence: https://web.dev/articles/font-best-practices ; https://fonts.googleapis.com/css2?family=Inter&display=swap (response headers) ; MDN browser-compat-data 8.1.2 (2026-09-17) `html.elements.link.rel.preconnect`

### Preload fonts only as a targeted fix, and set `crossorigin` and a single format
- Verdict: verified
- Note: Article: "`preload` ignores `unicode-range` declarations". BCD `preload` `as-font`: Chrome 50, Firefox 85, Safari 11.1.
- Evidence: https://web.dev/articles/font-best-practices ; https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload

### Self-host fonts only with a CDN and HTTP/2 or later, and copy what font services do for you
- Verdict: verified
- Note: Article: "If you are considering using self-hosted fonts, confirm that your site uses a Content Delivery Network (CDN) and HTTP/2."
- Evidence: https://web.dev/articles/font-best-practices

### Serve only WOFF2
- Verdict: verified
- Note: BCD `css.at-rules.font-face.WOFF_2`: Chrome 36, Firefox 39, Safari 10. Article: "WOFF2 compresses 30% better than WOFF".
- Evidence: https://web.dev/articles/font-best-practices ; MDN browser-compat-data 8.1.2 (2026-09-17)

### Subset fonts and split them with `unicode-range`
- Verdict: verified
- Note: Glyph counts match the article ("100 to 1000 glyphs"; CJK "over 10,000"). Safari 27 fixed "an issue where a font was downloaded despite no characters in the document falling within its unicode-range" (140674753), so Safari 26 and older could download a subset that the page did not need. Incremental Font Transfer is still "Proposed" on chromestatus (intent to prototype only).
- Evidence: https://web.dev/articles/font-best-practices ; https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ; https://chromestatus.com/feature/5135917565214720

### Use fewer web fonts: `system-ui` for UI text, and a variable font only when you need many styles
- Verdict: corrected
- Correction: Status: `font-variation-settings` is Baseline newly available 2018-09-05 and widely available 2021-03-05 (web-features). It is not "widely available (2018)". Add: `system-ui` (web-features `font-family-system`) is Baseline widely available since 2024-03-07.
- Evidence: web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `font-variation-settings`, `font-family-system`

### Choose `font-display` by priority: `optional` for performance, `swap` for brand text that must appear, and preload any `optional` font that matters
- Verdict: verified
- Note: web.dev (2020): Chrome 83 blocks the first render for a preloaded `optional` font "until the custom font has finished loading or a certain period of time has passed", and "This timeout period is currently set at 100ms". chromestatus 5636954674692096 is the Chrome 49 adaptive-timeout intervention ("only if 'auto' is specified"). WebKit post 6643 (2016) confirms the 3 s limit. The article's code sample has the syntax errors that the notes describe (`font-family: Roboto, Sans-Serif` with no semicolon, and a comma after `src`).
- Evidence: https://web.dev/articles/font-best-practices ; https://web.dev/articles/preload-optional-fonts ; https://webkit.org/blog/6643/improved-font-loading/ ; https://chromestatus.com/feature/5636954674692096 ; web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `font-display` (high 2022-07-15)

### Replace icon fonts with SVG
- Verdict: verified
- Evidence: https://web.dev/articles/font-best-practices

### Match fallback-font metrics to the web font to shrink swap shifts
- Verdict: corrected
- Correction: Status: web-features has no separate `size-adjust` feature. It puts the `size-adjust` descriptor in the `font-size-adjust` feature, which is Baseline newly available since 2024-07-25. The descriptor-level BCD data in the notes is correct: Chrome 92, Firefox 92, Safari 17 (2023-09-18). Write: "`size-adjust` works in all three engines since Safari 17 (2023-09). Its Baseline date (web-features `font-size-adjust`) is 2024-07-25." The status of the override descriptors is correct: BCD Safari "preview", Safari iOS no; web-features `font-metric-overrides` is not Baseline.
- Evidence: MDN browser-compat-data 8.1.2 (2026-09-17) `css.at-rules.font-face.size-adjust` (tag `web-features:font-size-adjust`) ; web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `font-size-adjust`, `font-metric-overrides`

### Measure Core Web Vitals in the field with the `web-vitals` library and report them as custom metrics or events
- Verdict: verified
- Note: web-vitals README (6.2.2): the attribution build is larger "by about 1.5K, brotli'd". Support: "`onCLS()`: Chromium", and "Core Web Vitals for soft navigations: Chromium 151+". It warns: "Avoid calling the Web Vitals functions ... repeatedly per page load". npm `latest` = 6.2.2.
- Evidence: https://cdn.jsdelivr.net/npm/web-vitals@6.2.2/README.md ; web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `largest-contentful-paint`, `event-timing` (low 2025-12-12), `soft-navigations` (Chrome 151)

### Report percentiles from a per-instance distribution, not averages
- Verdict: verified
- Note: Article: "rely on percentiles instead of averages", and "it may be worth observing the 90th or even the 95th percentile".
- Evidence: https://web.dev/articles/vitals-field-measurement-best-practices

### Send beacons when the page becomes hidden (`visibilitychange` → `hidden`), never in `unload` or `beforeunload`
- Verdict: verified
- Note: The rollout table (doc updated 2026-07-14) lists 146 at 1% through 154 (Sep 22, 2026) at 100%, with the warning "Version numbers and dates are subject to change". I could not confirm from outside Google that the 100% step shipped. The syntax `Permissions-Policy: unload=()` is on web.dev bfcache. BCD `http.headers.Permissions-Policy.unload`: Chrome 115, experimental. `fetchLater`: Chrome 135 only, experimental.
- Evidence: https://developer.chrome.com/docs/web-platform/deprecating-unload ; https://web.dev/articles/bfcache ; MDN browser-compat-data 8.1.2 (2026-09-17) `api.Window.fetchLater`

### Tag every metric with a deploy version and a server-assigned experiment group
- Verdict: verified
- Note: The article has "Version your changes" and "Run experiments" sections.
- Evidence: https://web.dev/articles/vitals-field-measurement-best-practices

### Load RUM and analytics code last and asynchronously, and inline only the tiny part that must run early
- Verdict: corrected
- Correction: The Why "loading late loses nothing" is too strong. (1) `event` entries are buffered only when their duration is 104 ms or more (plus the `first-input` entry). A late observer misses faster interactions. web-vitals README: "the `event-timing` default of `104` milliseconds applies to all events emitted before the library is initialised". (2) Resource Timing keeps only "the first 250 entries available in the default buffer". Write: "`buffered: true` returns most earlier entries, so loading late loses little. It loses interactions under 104 ms and resource entries after the buffer is full."
- Evidence: https://cdn.jsdelivr.net/npm/web-vitals@6.2.2/README.md ; https://web.dev/articles/inp ("`event` entries below 104 milliseconds don't report by default")

### Keep measurement code free of long tasks: run passive work when idle, and collect only data you will use
- Verdict: verified
- Note: BCD `requestIdleCallback`: Safari "preview" behind a flag, Safari iOS no. Safari 27 did not add it.
- Evidence: MDN browser-compat-data 8.1.2 (2026-09-17) `api.Window.requestIdleCallback` ; web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `requestidlecallback`

### Add `loading="lazy"` to below-the-fold `<video>` and `<audio>`, together with `preload` and `poster`
- Verdict: corrected
- Correction: Status: the conflict in the notes has an answer. Chrome 148 shipped `loading` on `<video>`/`<audio>` with partial support. BCD records Chrome 148 to 149 as partial with the note "Not supported for `<source>`" (crbug 514611050), and full support from Chrome 150. The item's example uses `<source>` children, so Chrome 148 and 149 did not lazy-load it. Write: "Chrome/Edge 150 (148 to 149 partial: no `<source>` children). Firefox and Safari: implementation in progress (Mozilla D278547; WebKit PR 58220). Limited availability." The Firefox and Safari standards positions are correct.
- Evidence: MDN browser-compat-data 8.1.2 (2026-09-17) `html.elements.video.loading`, `html.elements.audio.loading` ; https://chromestatus.com/feature/5200068565139456 ; web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `loading-lazy-media`

### Use `preload="none"` on videos that do not autoplay, and raise it to `metadata` on hover
- Verdict: verified
- Note: Article: "In most browsers `preload` defaults to `metadata` and a portion of the video is preloaded using the `Content-Range` header".
- Evidence: https://web.dev/articles/lazy-loading-video

### For a video that is the LCP element, preload its poster with high priority
- Verdict: verified
- Note: Article: "at the time of writing you cannot specify the `fetchpriority` for poster attributes". The `<video>` LCP rule (poster or first frame, whichever is earlier) is from web.dev/articles/lcp.
- Evidence: https://web.dev/articles/lazy-loading-video ; https://web.dev/articles/lcp

### Replace animated GIFs with `<video autoplay muted loop playsinline>`
- Verdict: verified
- Note: Article: "`playsinline` is necessary for autoplaying to occur in iOS."
- Evidence: https://web.dev/articles/lazy-loading-video

### Where `loading="lazy"` is not supported, lazy-start video with an IntersectionObserver
- Verdict: corrected
- Correction: Status: IntersectionObserver is Baseline newly available 2019-03-25 and widely available 2021-09-25 (web-features `intersection-observer`). It is not "widely available (2019)". The rest matches the article.
- Evidence: web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `intersection-observer` ; https://web.dev/articles/lazy-loading-video

## 16-explore-fast-batch-02.md

### Give visual feedback in the very next frame after a click, tap, or key press
- Verdict: verified
- Note: Article: "we ignore one highest interaction for every 50 interactions", good at 200 ms or less, poor above 500 ms, and hover/scroll "are not observed for the purposes of INP". BCD `interactionId`: Chrome 96, Firefox 144, Safari 26.2. `Scheduler.yield`: Chrome 129, Firefox 142, Safari no.
- Evidence: https://web.dev/articles/inp ; MDN browser-compat-data 8.1.2 (2026-09-17)

### Measure INP across the whole lifetime of long-lived tabs and report it on every `visibilitychange` to hidden
- Verdict: verified
- Note: Article: "Users might keep a tab open for a very long time—days, weeks, months", and "INP should be reported any time a page is background". web-vitals README: same-origin iframes need "the library to every frame and `postMessage()` the results".
- Evidence: https://web.dev/articles/inp ; https://cdn.jsdelivr.net/npm/web-vitals@6.2.2/README.md

### Know the Event Timing API gaps when you write your own INP collector
- Verdict: verified
- Note: Article: "`event` entries below 104 milliseconds don't report by default", `durationThreshold` "has a minimum value of 16 milliseconds", and for p98 keep "a small list of the worst-N interactions. 10 is a common choice." web-vitals 6.2.2 source: `DEFAULT_DURATION_THRESHOLD = 40`, and "Event Timing entries have their durations rounded to the nearest 8ms".
- Evidence: https://web.dev/articles/inp ; https://cdn.jsdelivr.net/npm/web-vitals@6.2.2/dist/modules/onINP.js

### Reproduce slow interactions in the lab by interacting while the page loads
- Verdict: verified
- Evidence: https://web.dev/articles/inp

### Insert new content where it does not move existing visible elements
- Verdict: verified
- Note: Definitions match the article ("a new element is added to the DOM or an existing element changes size, it doesn't count as a layout shift"; gaps under 1 s; window up to 5 s). Related lever: scroll anchoring (`overflow-anchor: auto`) is now in all three engines (Safari 27; web-features `overflow-anchor` low 2026-09-14). The Layout Instability spec excludes nodes that move only because of a scroll ("intended to prevent nodes from being considered unstable solely because of a scroll operation"). File 05 covers scroll anchoring. The `scrollTop` question stays unverified.
- Evidence: https://web.dev/articles/cls ; https://wicg.github.io/layout-instability/ ; web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `overflow-anchor`

### Reserve space at the moment of the interaction when the result arrives later than 500 ms
- Verdict: verified
- Note: Article: "The `hadRecentInput` flag will only be true for discrete input events, such as tap, click, or keypress. Continuous interactions such as scrolls, drags, or pinch and zoom gestures are not considered "recent input"." Precision from the spec: "mousedown, keydown, pointerdown" are "excluding inputs", so shifts in the first 500 ms after the `pointerdown` that starts a drag are excluded. Later shifts during the drag count.
- Evidence: https://web.dev/articles/cls ; https://wicg.github.io/layout-instability/

### Measure CLS with the reference implementation, not a raw sum
- Verdict: verified
- Note: web-vitals README: "CLS, FCP, and LCP are not reported if the page was loaded in the background", and `onCLS()` "technically measures DCLS" when the page has iframes.
- Evidence: https://web.dev/articles/cls ; https://cdn.jsdelivr.net/npm/web-vitals@6.2.2/README.md

### Collect INP with the web-vitals attribution build and send the phase breakdown
- Verdict: verified
- Note: All attribution names exist in the web-vitals 6.2.2 README: `interactionType?: 'pointer' | 'keyboard'`, `longestScript` with `subpart: 'input-delay' | 'processing-duration' | 'presentation-delay'`, `generateTarget`, and "If this value is an empty string, that generally means the element was removed from the DOM".
- Evidence: https://cdn.jsdelivr.net/npm/web-vitals@6.2.2/README.md ; https://web.dev/articles/find-slow-interactions-in-the-field

### Use Long Animation Frame script attribution to find the exact slow function
- Verdict: corrected
- Correction: Why: "`renderStart` (rAF and ResizeObserver callbacks begin)" is wrong for ResizeObserver. HTML "update the rendering" takes `unsafeStyleAndLayoutStartTime` after "run the animation frame callbacks" and before the loop "Recalculate styles and update layout ... broadcasting active resize observations". Then it runs the IntersectionObserver update steps, and then "record rendering time". So ResizeObserver and IntersectionObserver callbacks fall after `styleAndLayoutStart`, inside the style-and-layout window. Write: "`renderStart` (the rendering update starts; rAF callbacks run), `styleAndLayoutStart` (style, layout, ResizeObserver and IntersectionObserver work start)". The rest is verified: frames over 50 ms, scripts over 5 ms, `duration` "not including presentation time", the field names, and `sourceLocation` does not exist (BCD `PerformanceScriptTiming` has `sourceURL`, `sourceCharPosition`, `sourceFunctionName`). `paintTime`/`presentationTime`: Chrome 145.
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering ; https://developer.chrome.com/docs/web-platform/long-animation-frames ; MDN browser-compat-data 8.1.2 (2026-09-17) `api.PerformanceScriptTiming`, `api.PerformanceLongAnimationFrameTiming.paintTime`

### Diagnose input delay from the `invokerType` of the script that ran before the interaction
- Verdict: verified
- Note: Article: "Can be `'user-callback'`, `'event-listener'`, `'resolve-promise'`, `'reject-promise'`, `'classic-script'`, or `'module-script'`."
- Evidence: https://web.dev/articles/find-slow-interactions-in-the-field

### Keep `requestAnimationFrame` callbacks to visual writes only
- Verdict: corrected
- Correction: Why: remove "(and ResizeObserver)". The gap `styleAndLayoutStart − renderStart` holds the rAF callbacks and the steps that run before them (resize and scroll events, media-query checks, animation updates). ResizeObserver callbacks run after `styleAndLayoutStart` (HTML "update the rendering"). So a chart that redraws in a ResizeObserver callback shows its cost in the style/layout window, not in this gap. The article's example is correct: `rafDuration = styleAndLayoutStart - renderStart; // 500.59999999403954`.
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering ; https://web.dev/articles/find-slow-interactions-in-the-field

### Measure style and layout cost of an interaction from LoAF timestamps
- Verdict: corrected
- Correction: Why: the window `(startTime + duration) − styleAndLayoutStart` is not only style and layout. It also holds ResizeObserver callbacks (and the extra style/layout passes that they cause), the focus fix-up (which can fire `blur`/`change`), view-transition steps and IntersectionObserver updates. HTML records the rendering time after those steps. web-vitals uses the same formula for `totalStyleAndLayoutDuration` (`loafEntry.startTime + loafEntry.duration - loafEntry.styleAndLayoutStart`), so its value has the same content. Add: "If a chart redraws in ResizeObserver, a large value can be script, not style/layout." The formula and `forcedStyleAndLayoutDuration` are verified.
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering ; https://cdn.jsdelivr.net/npm/web-vitals@6.2.2/dist/modules/attribution/onINP.js ; https://web.dev/articles/find-slow-interactions-in-the-field

### Put the LCP image URL in the server HTML as `<img src|srcset>`, never behind `data-src` or an inline style
- Verdict: verified
- Note: Article numbers: less than 10% of p75 LCP spent downloading the image, 1,290 ms delay at p75 (Chrome blog data), 35% not discoverable, 7% behind `data-src` (Web Almanac 2024). web.dev/articles/lcp does not list `<canvas>` among LCP element types.
- Evidence: https://web.dev/articles/top-cwv ; https://web.dev/articles/lcp

### Keep pages eligible for bfcache: no `unload`, and close live connections on `pagehide`
- Verdict: corrected
- Correction: Why: "Open connections ... block bfcache" is out of date for WebSockets. web.dev bfcache (updated 2026-07-02): "Chrome (as of 149) and Safari do no block on open WebSockets but other browsers do." Chrome closes the socket when the page enters bfcache, so the page must reconnect on `pageshow`. `rel="noopener"` is "now the default in all modern browsers" for links, so the `window.opener` risk is mainly `window.open()` without `noopener`. Write the Why as: "`unload` handlers (desktop Chrome and Firefox), a non-null `window.opener`, open IndexedDB connections, and in Firefox open WebSockets block bfcache." Keep the Do line: Firefox still blocks, and Chrome closes the socket anyway. The `no-store` conditions are verified on bfcache-ccns (3 minutes; eviction on cookie or authorization changes, WebSocket/WebTransport/WebRTC use, or a `no-store` fetch/XHR response). The CLS statement is verified: bfcache "was responsible for the biggest improvement in CLS that we saw that year" (2022).
- Evidence: https://web.dev/articles/bfcache ; https://developer.chrome.com/docs/web-platform/bfcache-ccns (updated 2025-09-09) ; https://web.dev/articles/top-cwv

### Prerender likely next pages with speculation rules, and match eagerness to your confidence
- Verdict: corrected
- Correction: (1) Status: Safari 26.2 behind a flag has only speculation-rules prefetch (flag "SpeculationRules prefetch"). BCD `speculationrules.prerender`: Safari no, not even behind a flag. `eagerness` is partial in Safari. The example uses `prerender`, so it is Chromium only. (2) Add the mobile behavior. `moderate` on mobile uses viewport heuristics: it triggers 500 ms after scrolling stops for anchors within 30% vertical distance of the last pointer down (August 2025). `eager` on mobile triggers 50 ms after an anchor enters the viewport (January 2026). (3) Add two more skip conditions: the "Preload pages" setting is off, and the page is in a background tab. The desktop values (200 ms hover or `pointerdown`; `eager` 10 ms) and the limit of 2 (FIFO) are verified.
- Evidence: MDN browser-compat-data 8.1.2 (2026-09-17) `html.elements.script.type.speculationrules.*` ; https://developer.chrome.com/docs/web-platform/prerender-pages (updated 2026-01-23)

### Serve HTML from a CDN edge, and cache it even for a short time
- Verdict: verified
- Note: Article: "only 33% of HTML document requests were served from a CDN" (Web Almanac 2024).
- Evidence: https://web.dev/articles/top-cwv

### Never animate layout properties, even on absolutely positioned elements
- Verdict: verified
- Note: Article: pages that animate `margin` or `border` widths have poor CLS "at almost twice the rate". Lighthouse `main` default config has `cls-culprits-insight`, and `non-composited-animations` stays in the diagnostics group.
- Evidence: https://web.dev/articles/top-cwv ; https://developer.chrome.com/blog/moving-lighthouse-to-insights ; https://github.com/GoogleChrome/lighthouse/blob/main/core/config/default-config.js

### Do not use `isInputPending()` for yielding decisions
- Verdict: verified
- Note: Article: "We reversed our recommendation to use the `isInputPending` API". web-features marks `is-input-pending` as discouraged (Chrome 87 only).
- Evidence: https://web.dev/articles/top-cwv ; web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `is-input-pending`

### Always set a correct `as` (and `type`) on `rel=preload`
- Verdict: verified
- Note: The "about 3 s" figure is now verified in Chromium: `kUnusedPreloadTimeout = base::Seconds(3)`, with the message "was preloaded using link preload but not used within a few seconds from the window's load event". Article: omitting `as` "is equivalent to an XHR request".
- Evidence: https://web.dev/articles/preload-critical-assets ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/loader/fetch/resource_fetcher.cc

### Add `crossorigin` when you preload fonts (and other CORS resources)
- Verdict: verified
- Note: Article: "Fonts preloaded without the `crossorigin` attribute will be fetched twice!"
- Evidence: https://web.dev/articles/preload-critical-assets

### Preload only late-discovered resources, and only a few
- Verdict: verified
- Note: Article: "Lighthouse identifies assets that are on the third level of this chain as late-discovered" and "If too many resources are prioritized, effectively none of them are." Lighthouse 13.0.0 changelog: "remove preload-fonts, uses-rel-preload audits (#16716)". The blog gives the reason "Not enabled due to risks of over recommending."
- Evidence: https://web.dev/articles/preload-critical-assets ; https://github.com/GoogleChrome/lighthouse/blob/main/changelog.md ; https://developer.chrome.com/blog/moving-lighthouse-to-insights

### Use preload to separate download from execution of JS
- Verdict: verified
- Note: One sub-claim is unverified: "some browsers also fetch its dependencies". MDN says a browser "may" do this, and "the only approach to ensure that all browsers will try to preload a module's dependencies is to individually specify them". I found no engine that does it. BCD `modulepreload`: Chrome 66, Firefox 115, Safari 17. Vite still emits `modulepreload` (Vite 8 docs).
- Evidence: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload ; https://vite.dev/config/build-options ; web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `modulepreload`

### Preload a lazy chunk when the user shows intent, before the interaction needs it
- Verdict: corrected
- Correction: The example comment "starts fetch + compile" is wrong. `import()` also evaluates the module (it runs its top-level code) when the module arrives. To fetch and compile without running the module, inject `<link rel="modulepreload" href="/order-validation.js">`. The browser "parses and compiles it, and puts the results into the module map" (MDN). The article recommends preloading the code; running it on intent is also fine if the module has no side effects at the top level.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload ; https://web.dev/articles/preload-critical-assets

### Choose the `font-display` value and preload together, with CLS in mind
- Verdict: corrected
- Correction: Pattern (1) "preload + `font-display: block` (no font-swap shift ...)" is wrong. web.dev font-best-practices says `block` "can still cause a layout shift as the text is actually drawn invisible, and the fallback font space is therefore used to reserve the space". It also says that `auto`, `block`, `swap` and `fallback` "all have the potential to cause layout shifts when the font is swapped". The source article calls `block` "the default", but the initial value is `auto` (defined by the browser; about a 3 s block in Chromium, Firefox and WebKit). Write (1) as: "preload + `block`: text is hidden for a short time, and a late font can still shift layout unless the fallback metrics match (`size-adjust`)". Add a fourth pattern from file 01: preload + `optional` (Chrome 83+ blocks the first render for up to about 100 ms, with no swap later).
- Evidence: https://web.dev/articles/font-best-practices ; https://web.dev/articles/preload-critical-assets ; https://web.dev/articles/preload-optional-fonts

### Send preload hints in the `Link` response header
- Verdict: corrected
- Correction: The 103 Early Hints support in the caveat is wrong for preload. BCD: `http.status.103.preload`: Chrome 103, Firefox 123, Safari no. `http.status.103.preconnect`: Chrome 103, Firefox 120, Safari 17. Chrome and Safari process 103 "in HTTP/2 and later only" (BCD note). Write: "103 Early Hints can carry `preload` (Chrome 103, Firefox 123; Safari 17 accepts only `preconnect`), and only over HTTP/2+ in Chrome and Safari." Also add: current Chromium ignores `rel=preload` in the `Link` header of a subresource response (`kRestrictLinkHeaderOnSubresource`, `disable_resource_load` = true). Put preload headers on the HTML response. The `fetchpriority`-in-`Link` versions (Chrome 103, Firefox 132, Safari 17.2) are verified.
- Evidence: MDN browser-compat-data 8.1.2 (2026-09-17) `http.status.103`, `.preload`, `.preconnect`, `http.headers.Link.fetchpriority` ; https://developer.chrome.com/docs/web-platform/early-hints ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/common/features.cc

### Preconnect only to the few cross-origin hosts you will use within seconds, with the correct `crossorigin` mode
- Verdict: corrected
- Correction: The 10 s figure is from 2019 and does not match current Chromium. In `net/socket/client_socket_pool_manager.cc` on `main`, `unused_idle_socket_timeout()` returns `kPreconnectIntervalSec = 60` (60 s). Used idle sockets stay 300 s (`client_socket_pool.cc`). Write: "Chromium drops an unused preconnected socket after about 60 s (the 2019 article says 10 s). Servers and CDNs can close idle connections sooner." The rest is verified: "100–500 ms"; Learn Performance: "If you omit the crossorigin attribute, the browser opens a new connection when it downloads the font files"; `preconnect` high 2022-07-15. File 15-gaps-round-2 already has this correction.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/net/socket/client_socket_pool_manager.cc ; https://chromium.googlesource.com/chromium/src/+/main/net/socket/client_socket_pool.cc ; https://web.dev/articles/preconnect-and-dns-prefetch ; https://web.dev/learn/performance/resource-hints

### Use `dns-prefetch` for the long tail of third-party origins, in separate `<link>` tags
- Verdict: verified
- Note: web-features `link-rel-dns-prefetch`: low 2025-09-15 (Firefox 127 added HTTPS pages; Safari iOS 26). The article gives the Safari bug with `rel="preconnect dns-prefetch"`. I did not re-test it.
- Evidence: https://web.dev/articles/preconnect-and-dns-prefetch ; web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `link-rel-dns-prefetch` ; MDN browser-compat-data 8.1.2 (2026-09-17) `html.elements.link.rel.dns-prefetch`

### Send `preconnect` in a `Link` header on subresource responses
- Verdict: verified
- Note: Chromium `main` processes network hints from `Link` headers on subresource responses: in `preload_helper.cc`, `IsNetworkHintAllowed()` returns true for `kSubresourceNotFromMemoryCache`, and `kRestrictLinkHeaderOnSubresourceNetworkHint` defaults to false. The Google Fonts CSS response still sends `link: <https://fonts.gstatic.com>; rel=preconnect; crossorigin` (checked 2026-09-23). Note: `rel=preload` in the same kind of header is ignored (see the `Link` header item).
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/loader/preload_helper.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/common/features.cc ; https://web.dev/articles/preconnect-and-dns-prefetch

### Prefetch next-page or next-route resources at lowest priority, and only cacheable ones
- Verdict: disputed
- Correction: (1) Correction: "The file is stored in the HTTP cache only if it is cacheable; otherwise it is thrown away" is not exact for Chromium. The HTTP cache marks a prefetched entry `unused_since_prefetch`, and a "Cached entry less than 5 minutes old, unused_since_prefetch is true" skips validation on its first use. So a response that needs revalidation (for example `max-age=0` or `no-cache`) can still be reused once within 5 minutes. `no-store` is still not stored. File 17-collections-batch-03 states the 5-minute rule. (2) Dispute: "A prefetched stylesheet also prefetches its background images" (from the article) conflicts with the HTML spec. The prefetch "fetch and process the linked resource" steps only fetch the request and fire `load` or `error`. They do not parse the response or fetch subresources. I did not test an engine. Remove this sentence, or mark it as article-only. The rest is verified: "Lowest" priority, Safari only behind the `LinkPrefetch` flag, Chrome and Firefox require a secure context (BCD note), cache partitioning, and the in-flight takeover in Chrome.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/net/http/http_cache_transaction.cc (comment cases 13 and 14) ; https://html.spec.whatwg.org/multipage/links.html#link-type-prefetch ; https://web.dev/articles/link-prefetch ; https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/prefetch ; MDN browser-compat-data 8.1.2 (2026-09-17) `html.elements.link.rel.prefetch`

### Prefetch on-demand chunks that a later action will need
- Verdict: corrected
- Correction: The caveat "quicklink uses `requestIdleCallback`, which Safari does not ship" is misleading. quicklink has its own shim: "RIC and shim for browsers setTimeout() without it". It also falls back to XHR or `fetch()` when `rel=prefetch` is not supported (`linkPrefetchStrategy` versus `xhrPrefetchStrategy`). So quicklink works in Safari. quicklink is maintained: npm `latest` 3.0.2 (2026-08-04). The webpack magic comment `/* webpackPrefetch: true */` is verified.
- Evidence: https://cdn.jsdelivr.net/npm/quicklink/src/request-idle-callback.mjs ; https://cdn.jsdelivr.net/npm/quicklink/src/prefetch.mjs ; https://registry.npmjs.org/quicklink ; https://web.dev/articles/link-prefetch

### Lazy-load only images outside the first viewport, and always give them dimensions
- Verdict: verified
- Note: BCD `img loading`: Chrome 77, Firefox 75, Safari 15.4. `iframe loading`: Chrome 77, Firefox 121, Safari 16.4. web-features `loading-lazy` high 2026-06-19. Article: "loading is only deferred when JavaScript is enabled", and "All images and iframes load immediately when the page is printed".
- Evidence: https://web.dev/articles/browser-level-image-lazy-loading ; web-features data (downloaded 2026-09-22, includes Safari 27; raw/verify/02/wf.json) `loading-lazy`

### Know the Chromium distance thresholds and hidden-image behavior before you rely on lazy loading
- Verdict: verified
- Note: Chromium `settings.json5` on `main` (2026-09-23): images 4G 1250, 3G 2500, 2G 6000, slow-2G and offline 8000, unknown 3000. Frames: 4G 2500, 3G 3500, 2G 6000, slow-2G and offline 8000, unknown 4000. The article says Lite mode and `loading="auto"` "have been deprecated" (Lite mode sunset in M100). I did not confirm the removal milestone for `loading="auto"`.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/frame/settings.json5 ; https://web.dev/articles/browser-level-image-lazy-loading

### Remove lazy-loading libraries and `data-src` swaps
- Verdict: verified
- Note: Lighthouse 13.0.0: "remove offscreen-images audit (#16748)". Blog: "Offscreen images are already deprioritized by the browser so while lazy loading helps reduce bandwidth, it is unlikely to have an impact on what Lighthouse measures."
- Evidence: https://developer.chrome.com/blog/moving-lighthouse-to-insights ; https://github.com/GoogleChrome/lighthouse/blob/main/changelog.md

## Stale lines outside the items
- batch-01 line 13 (table) and line 867: "I found no evidence that the behavior has changed". It changed in Chrome 145 (see the `defer` item).
- batch-01 line 868: the 148 versus 150 conflict for lazy media has an answer: 148 partial (no `<source>`), 150 full.
- batch-01 line 17 (table): "`loading="lazy"` on `<video>`/`<audio>` is Chrome/Edge 150 only". Add "148 to 149 partial".
- batch-02 line 15 (table) and line 640: the 10 s preconnect timeout. Chromium uses 60 s.
- batch-02 line 642: the unused-preload warning timing is now verified (3 s after `load`, Chromium `kUnusedPreloadTimeout`).
- batch-02 line 644: quicklink is maintained (3.0.2, 2026-08-04). I did not check Guess.js.
- batch-02 line 645: I did not verify whether `preconnect` helps WebSocket connections. The question stays open.

## Cross-file conflicts
1. Deferred and module scripts in one task. 16-b01:13, :311-329, :867; 01-critical-rendering-path.md:36, :501; 03-course-js-and-vitals.md:127; 06-js-event-loop-and-scheduling.md:776 say that Chromium runs them all in the `DOMContentLoaded` task. That was true through Chrome 144. Chrome 145+ gives each script its own task (commit e7e02f3c). verify/01-critical-rendering-path.run2-new.verify.md already reports this.
2. "Safari and Firefox evaluate each module in its own task": 16-b01:338; 01:535; 03:128; 06:776 repeat the 2023 article. The ECMAScript and HTML module evaluation steps contradict it (one `Evaluate()` per graph), and Safari 27 rewrote its module loader.
3. Preconnect idle timeout: 16-b02:486, :640; 02-course-loading.md:497; 04-html-and-http-loading-features.md:118; 16-explore-fast-batch-05.md:56 use 10 s. 15-gaps-round-2.md:11 uses 60 s (Chromium source). 60 s is correct.
4. Prefetch caching: 16-b02:524 says a prefetched file is kept "only if it is cacheable; otherwise it is thrown away". 17-collections-batch-03.md:262 says "Chrome keeps it for about 5 minutes". Chromium `http_cache_transaction.cc` supports 17-b03 (unused prefetched entries skip validation for 5 minutes).
5. `size-adjust` Baseline: 16-b01:618 says "Baseline since Safari 17 (2023-09)". 01:583 says "Baseline widely available since 2026-03". web-features puts the descriptor in `font-size-adjust` (newly available 2024-07-25; widely available about 2027-01). 02:1137 and 05:764 give only versions and agree with BCD.
6. `<link rel=preload>` Baseline: 16-b01:55 says "widely available (2021)". 16-b02:388 says "low 2021-01-26, high 2023-07-26". 16-b02 is correct.
7. Lazy `<video>`/`<audio>`: 16-b01:744, :868 say 150 and call it a conflict. 03:207, :228 say 148. 02:998, :1189 and 04:393 say 148 partial, 150 full. Only 02 and 04 are correct.
8. `fetchpriority` Chrome version: 16-b01:39 says 101. 03:426 says 102/103. 16-explore-fast-index.md:213 says Chrome/Edge 103 (webstatus) and notes that the article widget says 102. BCD gives 101 and web-features gives 103. Use "101 (103 for the `Link` header)".
9. `font-display: block` and layout shift: 16-b02:451 says preload + `block` gives "no font-swap shift". 02:1119 and web.dev font-best-practices (the source of 16-b01) say that `block` can still shift layout.
10. LoAF `renderStart`: 16-b02:198 and :239 put ResizeObserver before `styleAndLayoutStart`. 01:69 says "`renderStart` (rAF, style/layout, observers)". The HTML spec puts ResizeObserver and IntersectionObserver after `styleAndLayoutStart`.
11. bfcache and WebSockets: 16-b02:301 says open connections block bfcache. 07-js-web-apis.md:385 and 19-skill-design.md:1144 say Chrome 149+ and Safari no longer block on open WebSockets. 07 and 19 match web.dev. 15-gaps-round-2.md:716 still treats this question as open.
12. 103 Early Hints in Safari: 16-b02:465 says "Chrome 103, Firefox 120, Safari 17" with no qualifier. 01:121, 02:687, 03:559 and 04:581 say `preload` in 103 is not supported in Safari. BCD agrees with them.
13. Speculation rules in Safari: 16-b02:328 says "Safari 26.2: behind a flag" with no qualifier. 03:274 and 04:465 say prefetch only. BCD agrees with 03 and 04: no `prerender`.

## Missing but important
1. Chrome 145 separate tasks for deferred and module scripts. With this change, splitting a deferred bundle shortens load-time tasks in Chromium too. Sources: https://chromiumdash.appspot.com/commit/e7e02f3ceba01c4519f58ab4b4c2445ba7566609 ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/script/html_parser_script_runner.cc
2. DevTools/Lighthouse "LCP request discovery" insight (2025-10-08). It checks that the LCP image is in the HTML or preloaded, has `fetchpriority=high` on both the image and the preload, and is not lazy. Use it to verify the Fetch Priority levers. Source: https://developer.chrome.com/docs/performance/insights/lcp-discovery
3. Responsive image preload with `imagesrcset`/`imagesizes`. The preload examples use one `href`, which downloads the wrong size for a responsive LCP `<img>`. web-features `preloading-responsive-images`: widely available 2026-06-11. Source: https://web.dev/articles/preload-responsive-images
4. `sizes="auto"` on lazy images (Chrome 126, Firefox 150; the Safari 27 release notes list it, but BCD and web-features do not show Safari yet). It removes guessed `sizes` values for below-the-fold images. Sources: https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ; web-features `sizes-auto`
5. Scroll anchoring (`overflow-anchor`) is now Baseline (2026-09-14, Safari 27). It stops content from jumping when content above the viewport grows, which helps live lists. File 05 covers it. Source: web-features `overflow-anchor`; https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-anchor
6. Zstandard content encoding is Baseline newly available (2026-02-11: Chrome 123, Firefox 126, Safari 26.3). It is now a Baseline alternative to Brotli for JS/CSS chunks and dynamic HTML (I did not compare their speed or size). Source: web-features `zstd`
7. Compression Dictionary Transport (Chrome 130, Chromium only). It sends only the difference between an old and a new hashed chunk after a deploy, so the "any change downloads everything again" cost drops. Source: web-features `compression-dictionary-transport`; https://developer.chrome.com/blog/shared-dictionary-compression
8. Service-worker static routing (`InstallEvent.addRoutes()`, Chrome 123 and Safari 27) and navigation preload. They keep the streaming service-worker design from paying worker startup on every navigation. Files 04, 07 and 15-gaps-round-1 cover them. Source: web-features `service-workers-static-routes`
9. `Link`-header `preload` on subresource responses is now ignored by Chromium (`kRestrictLinkHeaderOnSubresource`, enabled by default). Only network hints (`preconnect`, `dns-prefetch`) still work there. Put preload headers on the HTML response or in 103. Source: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/common/features.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/loader/preload_helper.cc
