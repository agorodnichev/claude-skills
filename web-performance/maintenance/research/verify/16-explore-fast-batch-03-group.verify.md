# Verify: 16-explore-fast-batch-03.md, 16-explore-fast-batch-04.md

Checked on 2026-09-23. Items: 66 (34 in batch 03, 32 in batch 04).

| File | Verified | Corrected | Disputed | Unverified |
|---|---|---|---|---|
| 16-explore-fast-batch-03.md | 24 | 10 | 0 | 0 |
| 16-explore-fast-batch-04.md | 27 | 5 | 0 | 0 |
| Total | 51 | 15 | 0 | 0 |

Most important findings:
1. Lighthouse 13 insight IDs are wrong in both files. The real IDs are `cache-insight` (not `use-cache-insight`) and `inp-breakdown-insight` (not `interaction-to-next-paint-insight`). The IDs in the notes come from the 2025 "moving to insights" blog post, not from the Lighthouse source.
2. web-vitals `largestShiftSource` does not pick "the first source in document order". The Layout Instability spec sorts `sources` by impact area, largest first. web-vitals takes the first Element in that list, so it is already the largest by impact area.
3. ResizeObserver callbacks run *after* style and layout (and before paint), not before them. Only rAF callbacks run before style and layout.
4. Chromium does not report moves of less than 3 CSS px (`kMovementThreshold = 3.0`). A "1–2 px layout shift" cannot appear in `layout-shift` entries.
5. Safari 27.0 (2026-09-14) supports `sizes="auto"`. BCD 8.1.2 and web-features do not show this yet.
6. WordPress 6.3 changed the `wp_omit_loading_attr_threshold` default from 1 to 3.
7. Cross-origin LCP `renderTime` without `Timing-Allow-Origin` is coarsened, not zero, in Chrome 133, Firefox 141 and Safari 26.2. The "other browsers need TAO" argument no longer holds for current versions.
8. web-vitals allows more than one `onINP()` call with different options since v5.0.0 (#583), not since v5.3.
9. The zstd/Brotli `find -regex` build example matches no files with macOS `/usr/bin/find`.

Method:
- I read both notes files in full. I grepped the saved article text in `raw/fast-batch-3/` and `raw/fast-batch-4/`.
- I queried the local MDN browser-compat-data 8.1.2 (2026-09-17) and web-features data (includes Safari 27, 2026-09-14). I used `raw/verify/16b/q.py`, a copy of `raw/verify/16a/q.py`.
- I read Lighthouse `default-config.js` at v13.0.0 and v13.5.0, and the v13.5.0 insight audit sources (`replacesAudits`).
- I read the Chromium `layout_shift_tracker.cc` (main), the DevTools `WarningsHandler.ts` and `ImageDelivery.ts`, the Layout Instability, Paint Timing, HTML (images, update-the-rendering) specs, and the web-vitals `main` attribution sources.
- I used GitHub and npm APIs (archive states, Comlink releases, `@lhci/cli` dependencies), and developer.chrome.com, MDN, WebKit, RFC and vendor pages.
- Raw files are in `raw/verify/16b/`.

## 16-explore-fast-batch-03.md

### Decide `loading` per image position: load the first in-viewport content image eagerly and lazy-load the rest
- Verdict: corrected
- Correction: WordPress 5.9 shipped the fix with `wp_omit_loading_attr_threshold` default 1. WordPress 6.3 changed the default to 3: "the _default_ value for the `wp_omit_loading_attr_threshold` filter has been modified from 1 to 3". Change the Do line to "(WordPress calls it `wp_omit_loading_attr_threshold`: default 1 in WP 5.9, default 3 since WP 6.3)". The article numbers are correct. The table shows "Difference from default" −13% and −15% for archive pages when lazy loading is off, −1% to −4% for the fix against "disabled", and −51% to −70% image bytes against "disabled". `loading-lazy` is Baseline high 2026-06-19 (web-features).
- Evidence: https://make.wordpress.org/core/2023/07/13/image-performance-enhancements-in-wordpress-6-3/ ; https://web.dev/articles/lcp-lazy-loading ; web-features `loading-lazy` (raw/verify/02/wf.json)

### Log a warning when the LCP element is lazy-loaded
- Verdict: verified
- Note: The snippet matches the article. BCD 8.1.2 `api.LargestContentfulPaint`: Chrome 77, Firefox 122, Safari 26.2. web-features `largest-contentful-paint` is Baseline low 2025-12-12. Lighthouse 13.5.0 `lcp-discovery-insight` has `replacesAudits: ['prioritize-lcp-image', 'lcp-lazy-loaded']`.
- Evidence: https://web.dev/articles/lcp-lazy-loading ; https://github.com/GoogleChrome/lighthouse/blob/v13.5.0/core/audits/insights/lcp-discovery-insight.js

### Prove a loading-strategy change with a repeated-run lab A/B test, not cross-site correlation
- Verdict: verified
- Note: Article: "each test was ran nine times to get the median LCP value", "84% of sites that use browser-level image lazy loading use WordPress", and the single-page difference "is less than one standard deviation".
- Evidence: https://web.dev/articles/lcp-lazy-loading

### Choose the resize method by how CSS sizes the image
- Verdict: verified
- Note: web-features `srcset` is Baseline high 2019-09-27. The DevTools/Lighthouse image-delivery insight drops findings with savings of 4096 bytes or less (`BYTE_SAVINGS_THRESHOLD = 4096`). It also ignores up to 12 KiB of oversize waste when the image has `srcset` or `<picture>` (`BYTE_SAVINGS_THRESHOLD_RESPONSIVE_BREAKPOINTS = 12288`). It never checks CSS background images for size ("Ignore CSS images").
- Evidence: https://web.dev/articles/serve-images-with-correct-dimensions ; https://chromium.googlesource.com/devtools/devtools-frontend/+/refs/heads/main/front_end/models/trace/insights/ImageDelivery.ts

### Resize images in the build with `magick`, not `convert`
- Verdict: verified
- Note: Porting guide: "Do not use `magick convert`" and "the legacy `convert` executable is no longer included" (Windows).
- Evidence: https://imagemagick.org/porting/

### When CSS forces an aspect ratio that differs from the file, add `object-fit`
- Verdict: verified
- Note: web-features `aspect-ratio` Baseline high 2024-03-20 and `object-fit` Baseline high 2022-07-15. BCD `html.elements.img.aspect_ratio_computed_from_attributes`: Chrome 79, Firefox 71, Safari 15 (Safari 14 partial).
- Evidence: MDN browser-compat-data 8.1.2 ; web-features data (raw/verify/02/wf.json)

### Use `sizes="auto"` on lazy images whose layout width is only known after layout (not in the article)
- Verdict: corrected
- Correction:
  - Status: Chrome 126, Firefox 150, **Safari 27.0** (WebKit release notes, 2026-09-14: "Responsive image techniques get easier with the auto keyword for sizes"). BCD 8.1.2 and web-features still show no Safari support. Replace "not in Safari. Not Baseline" with "all three engines as of Safari 27.0; the Baseline data does not show it yet".
  - Add to Avoid/caveats: always give `width`/`height` or a CSS size. HTML spec: "Without specified dimensions, the image will likely render with 300x150 dimensions because sizes="auto" implies contain-intrinsic-size: 300px 150px".
- Evidence: https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ; https://html.spec.whatwg.org/multipage/images.html#sizes-attributes ; MDN browser-compat-data 8.1.2 `html.elements.img.sizes.auto`

### Do not count on a `<canvas>` chart to be the LCP element. Measure chart readiness with your own mark
- Verdict: corrected
- Correction: The Why line quotes the spec list incorrectly. The Paint Timing editor's draft (2026-09-02) says: "An element is timing-eligible if it is one of the following: an img element. an image element inside an svg element. a video element with a poster frame. an element with a contentful background-image. a text node." The spec says "video with a poster frame", not "or first frame". The first-frame rule is Chromium behavior (web.dev LCP article, Chrome 116). The rest is correct: "target is a canvas with its context mode set to any value other than none" makes a canvas *contentful* (FCP), and canvas is not timing-eligible. The SciChart API names exist (13-scichart verify). 13-scichart also documents a `painted` event, raised after frame paint, which is a closer hook for a "first frame" mark.
- Evidence: https://w3c.github.io/paint-timing/ ; https://web.dev/articles/lcp ; verify/13-scichart.verify.md

### Do not rely on placeholders, full-viewport backgrounds, or invisible elements as the LCP element
- Verdict: verified
- Note: Chromium changelog: opacity 0 (Chrome 86), full viewport (Chrome 88), "0.05 bits of image data per displayed pixel" (Chrome 112), transparent text (Chrome 130), document opacity fix (Chrome 144). All match.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/docs/speed/metrics_changelog/lcp.md ; https://chromium.googlesource.com/chromium/src/+/main/docs/speed/metrics_changelog/2023_04_lcp.md

### Know how LCP size is computed before you design the hero
- Verdict: verified
- Note: Article: "the size that gets reported is either the visible size or the intrinsic size, whichever is smaller", "Only the element's initial size and position in the viewport is considered". Chrome 88: "an element being removed is still considered a valid LCP candidate".
- Evidence: https://web.dev/articles/lcp ; https://chromium.googlesource.com/chromium/src/+/main/docs/speed/metrics_changelog/2020_11_lcp_2.md

### Send `Timing-Allow-Origin` on cross-origin LCP images (CDN)
- Verdict: corrected
- Correction: The coarsened cross-origin `renderTime` is not Chrome-only. BCD 8.1.2 `api.LargestContentfulPaint.renderTime.cross-origin`: Chrome 133, Firefox 141, Safari 26.2. Replace "in browsers that do not coarsen render times" and "for accuracy in other browsers" with: "All current engines expose a coarsened `renderTime` without TAO (Chrome 133+, Firefox 141+, Safari 26.2+). TAO still gives the uncoarsened value (Chrome coarsens to a 4 ms multiple) and full Resource Timing detail, and helps older browser versions." The TAO header BCD row (Chrome 54, Firefox 45, Safari 11) is correct. This also answers the open question in "Not covered".
- Evidence: MDN browser-compat-data 8.1.2 ; https://chromium.googlesource.com/chromium/src/+/main/docs/speed/metrics_changelog/2025_02_lcp.md

### Measure LCP with `web-vitals` `onLCP`, not with a raw observer
- Verdict: verified
- Note: The four API differences match the article. Chrome 147 changelog: "No increase or decrease in final LCP". web-vitals 6.2.2 is npm `latest` (2026-09-14). BCD `activationStart`: Chrome 108 only.
- Evidence: https://web.dev/articles/lcp ; https://chromium.googlesource.com/chromium/src/+/main/docs/speed/metrics_changelog/2026_02_lcp.md ; https://registry.npmjs.org/web-vitals

### Expect a video or animated image to count from its first frame
- Verdict: verified
- Note: Two caveats to add. (1) The Chrome 116 change said: "for now, this only affects UKM (and so CrUX) reporting of LCP and does not affect PerformanceObserver observations". The Chrome 151 note describes observer emission, but I found no changelog line that dates web exposure of video entries. (2) Chromium main has an experimental flag `EntropyIgnoredForFirstVideoFrameLCP` ("the LCP algorithm ignores image entropy for the first video frame", crbug 434659232). So today a low-detail first frame can still be dropped by the 0.05 bits-per-pixel rule. The "about one vsync later" caveat matches the Chrome 151 note.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/docs/speed/metrics_changelog/2023_08_lcp.md ; https://chromium.googlesource.com/chromium/src/+/main/docs/speed/metrics_changelog/2026_06_lcp.md ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/runtime_enabled_features.json5

### Put late-arriving banners, toasts and notices in fixed or absolute position, or reserve their space
- Verdict: verified
- Note: In Lighthouse 13.5.0, `cls-culprits-insight` has `replacesAudits: ['layout-shifts']`. `layout-shifts` still runs in the hidden group. `unsized-images` and `non-composited-animations` stay in "diagnostics". The "moving to insights" blog post lists all three under `cls-culprits-insight`. The source code is right and the blog is wrong.
- Evidence: https://web.dev/articles/css-web-vitals ; https://github.com/GoogleChrome/lighthouse/blob/v13.5.0/core/config/default-config.js

### Paint decorative backgrounds with CSS gradients instead of image files
- Verdict: verified
- Note: Paint Timing: "A CSS image img is a contentful image when … img is url valued". A gradient is not url-valued.
- Evidence: https://web.dev/articles/css-web-vitals ; https://w3c.github.io/paint-timing/

### Load third-party font CSS with `<link>` plus preconnect, never with CSS `@import`
- Verdict: verified
- Evidence: https://web.dev/articles/css-web-vitals ; https://developers.google.com/fonts/docs/getting_started

### Request only the glyphs a logo or heading needs (`text=`)
- Verdict: verified
- Note: Google Fonts: "In some cases, this can reduce the size of the font file by up to 90%." Last updated 2024-07-23.
- Evidence: https://developers.google.com/fonts/docs/getting_started

### Do not trust the article's explanation of render-blocking CSS and Safari font blocking
- Verdict: verified
- Note: WebKit (2016-06-27): "newer versions of WebKit will show this invisible text for a maximum of 3 seconds".
- Evidence: https://webkit.org/blog/6643/improved-font-loading/ ; https://web.dev/articles/preload-scanner

### Send one "debug target" string with every Web Vitals beacon, using the attribution build
- Verdict: verified
- Note: upgrading-to-v5: "Changed `LCPAttribution.element` to `LCPAttribution.target`" and "Removed `INPAttribution.interactionTargetElement` by default". The GitHub page says: "This repository was archived by the owner on Jun 27, 2025" and "the Web Vitals Report is no longer available online".
- Evidence: https://github.com/GoogleChrome/web-vitals/blob/main/docs/upgrading-to-v5.md ; https://github.com/GoogleChromeLabs/web-vitals-report

### For CLS, report only the largest source of the largest shift, with its time and URL path
- Verdict: corrected
- Correction: Replace the last caveat sentence. web-vitals does **not** pick "the first source in document order". Its code is `sources.find((s) => s.node?.nodeType === 1) || sources[0]`. The Layout Instability spec sorts `sources` "in descending order by impact area, with the element that contributed most to the layout shift appearing first". So `largestShiftSource` is the Element with the largest impact area, which is the union of the old and new rects. The article's `previousRect`-area reduce is a weaker proxy: it gives 0 area for an element that moves into view. Prefer `attribution.largestShiftSource` / `largestShiftTarget`, or take `sources[0]`. The `curRect`/`prevRect` bug report is correct: the article's snippet uses `{node, curRect, prevRect}`.
- Evidence: https://wicg.github.io/layout-instability/#report-the-layout-shift-sources ; https://github.com/GoogleChrome/web-vitals/blob/main/src/attribution/onCLS.ts ; https://web.dev/articles/debug-performance-in-the-field

### Record where the LCP element is and why it was slow (subparts), per page load
- Verdict: verified
- Note: README: `resourceBufferSize` "defaulting to `50`", "in addition to the first 250 entries". CHANGELOG v6.1.0: "Add Resource Timing buffer for LCP attribution".
- Evidence: https://github.com/GoogleChrome/web-vitals/blob/main/README.md ; https://github.com/GoogleChrome/web-vitals/blob/main/CHANGELOG.md

### For INP, send the target, type, time, load state and the three subparts, then act on the dominant one
- Verdict: verified
- Note: README types: `interactionType?: 'pointer' | 'keyboard'`, `loadState`, `longestScript`, `totalStyleAndLayoutDuration`. upgrading-to-v6: "the default for `includeProcessedEventEntries` … has changed to `false`". web-features `event-timing` Baseline low 2025-12-12. `long-animation-frames` has Chromium support only.
- Evidence: https://github.com/GoogleChrome/web-vitals/blob/main/docs/upgrading-to-v6.md ; web-features data

### Reproduce slow interactions on throttled or real low-end hardware, and interact *during* load
- Verdict: corrected
- Correction: Remove '"mid-tier mobile" is the suggested default'. No cited source recommends a default preset. The article says "connect a low to mid-tier Android device" or "enable the CPU throttling feature". The DevTools reference has no recommendation. Chrome 134 adds "two additional CPU throttling presets that more accurately approximate low- and mid-tier mobile devices" after you run **Calibrate**. The rest is verified.
- Evidence: https://developer.chrome.com/blog/new-in-devtools-134 ; https://developer.chrome.com/docs/devtools/performance/reference ; https://web.dev/articles/manually-diagnose-slow-interactions-in-the-lab

### Find the slow interaction in live metrics, then record a trace and read its subparts on the Interactions track
- Verdict: corrected
- Correction:
  - Status: the Lighthouse 13 ID is `inp-breakdown-insight`, not `interaction-to-next-paint-insight`. Source: `id: 'inp-breakdown-insight'` and `replacesAudits: ['work-during-interaction']` in v13.5.0.
  - Avoid/caveats: "Since 2025-10" is wrong. The Insights sidebar "was added in Chrome 131". "INP by phase" (now "INP breakdown") and "Forced reflow" (Chrome 134) came in early 2025. Only the doc pages are dated 2025-10-08.
  - The rest is verified. The whiskers and the striped portion "exceeded 200 milliseconds" match the article. Chrome 122: "The Performance > Main track by default now shows arrows connecting initiators".
- Evidence: https://github.com/GoogleChrome/lighthouse/blob/v13.5.0/core/audits/insights/inp-breakdown-insight.js ; https://developer.chrome.com/blog/devtools-insights-sidebar ; https://developer.chrome.com/blog/new-in-devtools-134 ; https://developer.chrome.com/blog/new-in-devtools-122

### Keep `requestAnimationFrame` and `ResizeObserver` callbacks to the work the next frame needs
- Verdict: corrected
- Correction: Replace the Why line with: "rAF callbacks run in the rendering step *before* style and layout. ResizeObserver callbacks run *after* style and layout and before paint. HTML spec order: run the animation frame callbacks, then in a loop 'Recalculate styles and update layout', 'Gather active resize observations', 'broadcast active resize observations'. A DOM or style write inside a ResizeObserver callback makes the browser run style and layout again in the same frame. Work in either callback adds to presentation delay and frame time." The Forced reflow threshold is correct: DevTools `FORCED_REFLOW_THRESHOLD = 30 ms`, summed per task. BCD `api.Scheduler.yield`: Chrome 129, Firefox 142, no Safari.
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering ; https://chromium.googlesource.com/devtools/devtools-frontend/+/refs/heads/main/front_end/models/trace/handlers/WarningsHandler.ts

### Without field data, use TBT and known user flows to choose what to test
- Verdict: verified
- Note: Article: TBT "correlates well with INP".
- Evidence: https://web.dev/articles/manually-diagnose-slow-interactions-in-the-lab

### Hide an element with `display:none`, `visibility:hidden` or `opacity:0` while you lay it out before showing it
- Verdict: verified
- Note: This is also normative spec text. A node is an unstable-candidate only if visibility is "visible" and opacity is not 0, "currently and in the previous frame". The spec has no rule about occlusion.
- Evidence: https://web.dev/articles/debug-layout-shifts ; https://wicg.github.io/layout-instability/#unstable-candidate

### Read `sources` as symptoms: look at the element *before* the shifted one, and at the shift's direction and size
- Verdict: corrected
- Correction: Remove "A 1–2 px move usually means conflicting CSS or a font swap". The article says this, but Chromium does not report such moves. `layout_shift_tracker.cc` has `const float kMovementThreshold = 3.0;  // CSS pixels.`, and it skips a node when its start point moved less than that on both axes. The spec note says: "Chrome has defined number of pixels to significance as 3." The article's own example is a 5 px font-swap shift. Use instead: "a small upward or downward move of a few pixels (3 px or more) often means a font swap or a late style change". The rest is verified: "up to five sources", largest by impact, and all-zero `previousRect`/`currentRect` meanings.
- Evidence: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/layout/layout_shift_tracker.cc ; https://wicg.github.io/layout-instability/#sec-unstable-nodes ; https://web.dev/articles/debug-layout-shifts

### Log shifts in the console with a buffered observer (and `debugger`) during a 5–10 minute manual session
- Verdict: verified
- Note: Spec: `hadRecentInput` is true "if lastInputTime is less than 500 milliseconds in the past". Chromium `kTimerDelay = 500 ms`.
- Evidence: https://web.dev/articles/debug-layout-shifts ; https://wicg.github.io/layout-instability/ ; https://web.dev/articles/cls

### Use the DevTools Layout shifts track, the Layout shift culprits insight and Layout Shift Regions
- Verdict: verified
- Note: The CLS culprits doc was published 2025-10-08. It lists "Unsized images", "Injected iframes", "Unoptimized animations" and "Web fonts".
- Evidence: https://developer.chrome.com/docs/performance/insights/cls-culprit ; https://developer.chrome.com/docs/devtools/performance/reference

### Keep the UI on the main thread and move pure logic and state into a dedicated worker
- Verdict: verified
- Note: Article: "frozen for six seconds" and "takes twelve seconds". BCD: OffscreenCanvas 2D Chrome 69, Firefox 105, Safari 16.4. WebGL/WebGL2 contexts Safari 17. web-features `offscreen-canvas` and `request-animation-frame-workers` are Baseline high 2025-09-27.
- Evidence: https://web.dev/articles/off-main-thread ; MDN browser-compat-data 8.1.2 ; web-features data

### Wrap worker calls in an RPC layer (Comlink) instead of writing a message protocol by hand
- Verdict: corrected
- Correction:
  - The TypeScript example does not type-check. `indicators.worker.ts` has no exports, so `typeof import('./indicators.worker')` is an empty namespace type, and `calc.ema` is a TS error. Use `const api = { ema: … }; export type IndicatorsApi = typeof api; expose(api);` in the worker, and `wrap<IndicatorsApi>(new Worker(…))` on the main thread. Comlink README: "When you `expose()` something of type `T`, the corresponding `wrap()` call will return something of type `Comlink.Remote<T>`."
  - Add: Comlink copies every argument and return value by default: "every function parameter, return value and object property value is copied". Use `Comlink.transfer(data, [data.buffer])` for large `Float64Array`s.
  - Version facts are verified. npm `latest` is 4.4.2 (2024-11-07). The last GitHub release is v4.4.2. The last commit is 2025-06-18.
- Evidence: https://github.com/GoogleChromeLabs/comlink/blob/main/README.md ; https://registry.npmjs.org/comlink ; https://api.github.com/repos/GoogleChromeLabs/comlink/releases

### Keep worker messages small: send patches, chunk large updates, transfer binary buffers
- Verdict: verified
- Note: Surma (2019-07-15): "up to 100KiB and stay within your budget" and "everything up to 10KiB will not pose a risk to your animation budget". BCD: COEP `credentialless` Chrome 96, Firefox 119, no Safari, no Firefox Android. web-features `shared-memory` Baseline high 2024-06-13 and `structured-clone` Baseline high 2024-09-14.
- Evidence: https://surma.dev/things/is-postmessage-slow/ ; MDN browser-compat-data 8.1.2

### Create workers with the standard `new URL(..., import.meta.url)` pattern and `type: 'module'`
- Verdict: verified
- Note: webpack: "Using a variable in the `Worker` constructor is not supported by webpack." Vite: "The worker detection will only work if the `new URL()` constructor is used directly inside the `new Worker()` declaration", and the constructor form "is the recommended way". worker-plugin: "archived by the owner on Apr 19, 2026". web-features `js-modules-workers` is Baseline high 2025-12-06.
- Evidence: https://webpack.js.org/guides/web-workers/ ; https://vite.dev/guide/features#web-workers ; https://github.com/GoogleChromeLabs/worker-plugin

## 16-explore-fast-batch-04.md

### Measure Core Web Vitals in the field with the web-vitals library, not hand-rolled observers
- Verdict: verified
- Note: README: "tiny (~3K, brotli'd)" and attribution "by about 1.5K, brotli'd". Browser Support: `onCLS()` is Chromium only. `onFCP`, `onINP`, `onLCP` and `onTTFB` work in Chromium, Firefox and Safari. `reportAllChanges` "only reports when the **metric changes**".
- Evidence: https://github.com/GoogleChrome/web-vitals/blob/main/README.md ; https://github.com/GoogleChrome/web-vitals/blob/main/CHANGELOG.md

### Queue metric reports and flush them in one beacon when the page becomes hidden
- Verdict: verified
- Note: The README batch example uses `visibilitychange` and `sendBeacon`. MDN fetchLater: sent when "The document is destroyed or enters the bfcache" or `activateAfter` expires. The 64 KiB figure is the per-reporting-origin limit inside a 640 KiB per-document quota (512 KiB top-level plus 128 KiB shared). BCD: `fetchLater` Chrome 135 only, experimental.
- Evidence: https://github.com/GoogleChrome/web-vitals#batch-multiple-reports-together ; https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater ; https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Deferred_Fetch

### Register each web-vitals listener once per document, not per component mount or route
- Verdict: corrected
- Correction: Change "v5.3+ lets you call `onINP()` more than once" to "v5.0.0+". CHANGELOG v5.0.0 (2025-05-07): "Support multiple calls to `onINP()` with different config options (#583)". v5.3.0 only "Fixed issue where the same configuration object to multiple metric functions can result in errors (#731)". The README warning is quoted correctly.
- Evidence: https://github.com/GoogleChrome/web-vitals/blob/main/CHANGELOG.md

### Measure SPA route changes as soft navigations and label each metric with its own URL
- Verdict: verified
- Note: Chrome doc (last updated 2026-09-02): "enabled by default from Chrome 151". Entry types `soft-navigation` and `interaction-contentful-paint`. CrUX: "still to be determined". The README shows the two-registration pattern and says "the metrics for the initial URL will be finalized once the first soft nav occurs". BCD shows Chrome 151 released 2026-07-28.
- Evidence: https://developer.chrome.com/docs/web-platform/soft-navigations ; https://github.com/GoogleChrome/web-vitals#report-metrics-for-soft-navigations

### Add a custom "first chart frame" metric, because canvas and WebGL content is not an LCP candidate
- Verdict: verified
- Note: The spec quote matches the Paint Timing editor's draft (2026-09-02). Two small fixes to the Do line: (1) `navigationStart` is a legacy Navigation Timing field. `performance.measure(…, { start: 0 })` measures from `timeOrigin`. For prerendered pages, subtract `activationStart`. (2) A mark inside one rAF runs before the *next* frame. It does not prove that the previous frame reached the screen. The SciChart `painted` event (see 13-scichart verify) is closer.
- Evidence: https://w3c.github.io/paint-timing/ ; verify/13-scichart.verify.md

### Send `Timing-Allow-Origin` on cross-origin assets that affect metrics
- Verdict: verified
- Note: BCD `api.LargestContentfulPaint.renderTime.cross-origin`: Chrome 133, Firefox 141, Safari 26.2. This is correct, and it contradicts batch 03 and 15-gaps-round-2 (see Cross-file conflicts).
- Evidence: MDN browser-compat-data 8.1.2 ; https://chromium.googlesource.com/chromium/src/+/main/docs/speed/metrics_changelog/2025_02_lcp.md

### Expose backend and CDN phases with the `Server-Timing` header so RUM can split TTFB
- Verdict: verified
- Note: web-features `server-timing`: low 2023-03-27, high 2025-09-27. BCD: Chrome 65, Firefox 61, Safari 16.4.
- Evidence: https://w3c.github.io/server-timing/ ; web-features data

### Keep metric-critical content out of iframes, or instrument inside the iframe
- Verdict: verified
- Note: README: "no visibility into `<iframe>` content (not even same-origin iframes)" and "the `onCLS()` function technically measures DCLS".
- Evidence: https://github.com/GoogleChrome/web-vitals#limitations

### Count bfcache restores, prerenders and discard-restores as their own navigation types in RUM
- Verdict: verified
- Note: README `navigationType` union: 'navigate' | 'reload' | 'back-forward' | 'back-forward-cache' | 'prerender' | 'restore' | 'soft-navigation'. "CLS, FCP, and LCP are not reported if the page was loaded in the background."
- Evidence: https://github.com/GoogleChrome/web-vitals#metric

### Record the browser engine with each beacon, and compare with CrUX only on Chrome at p75 over 28 days
- Verdict: verified
- Note: web.dev (2025-12-17): "Chrome measures LCP up until the end of `presentationTime`, while Firefox and Safari don't include `presentationTime` and so measure until the earlier `paintTime`." BCD: `presentationTime` is exposed but returns null in Firefox 140 and Safari 26.2. CrUX excludes iOS and Android WebView and includes Custom Tabs (article).
- Evidence: https://web.dev/blog/lcp-and-inp-are-now-baseline-newly-available ; https://web.dev/articles/crux-and-rum-differences

### Test INP-sensitive flows with real or scripted interactions, not only TBT
- Verdict: verified
- Note: npm lighthouse `latest` is 13.5.0 (2026-09-18).
- Evidence: https://web.dev/articles/lab-and-field-data-differences ; https://registry.npmjs.org/lighthouse

### Declare a mobile viewport so taps have no 300 ms delay
- Verdict: verified
- Note: The article says: "This delay counts toward a page's INP … it doesn't affect a page's TBT". I did not confirm this in Chromium Event Timing code. web-features `touch-action`: low 2019-09-19, high 2022-03-19. BCD `manipulation`: Safari 13, iOS 9.3.
- Evidence: https://web.dev/articles/lab-and-field-data-differences ; https://developer.chrome.com/blog/300ms-tap-delay-gone-away

### Test many states in the lab: warm and cold cache, several viewports, deep links, logged-in and personalized views
- Verdict: verified
- Evidence: https://web.dev/articles/lab-and-field-data-differences

### Gate CI on Lighthouse audits (lint-style), not on raw timings, and pin the Lighthouse version
- Verdict: corrected
- Correction:
  - `uses-long-cache-ttl` became **`cache-insight`**, not `use-cache-insight`. Lighthouse 13.5.0 `cache-insight.js`: `id: 'cache-insight'`, `replacesAudits: ['uses-long-cache-ttl']`.
  - Add: in 13.0.0 and 13.5.0, `redirects` and `server-response-time` still run as hidden audits (group `hidden`), so assertions on them keep working. `uses-text-compression`, `uses-long-cache-ttl` and `render-blocking-resources` are gone.
  - Verified: `@lhci/cli` 0.15.1 (2025-06-25) depends on `lighthouse` 12.6.1. `render-blocking-insight` replaces `render-blocking-resources`. `document-latency-insight` replaces `redirects`, `server-response-time` and `uses-text-compression`. The "regress within six months" figure is quoted from vitals-tools. I did not watch the linked video.
- Evidence: https://github.com/GoogleChrome/lighthouse/blob/v13.5.0/core/audits/insights/cache-insight.js ; https://github.com/GoogleChrome/lighthouse/blob/v13.5.0/core/config/default-config.js ; https://registry.npmjs.org/@lhci/cli

### Pre-compress static text assets at build time with maximum settings, and compress dynamic responses at mid settings
- Verdict: corrected
- Correction:
  - The example does not work with macOS `/usr/bin/find`. `\|` alternation in the default basic regex matched no files in a test on this machine. Use a portable form: `find -E dist -regex '.*\.(js|css|html|svg|json|wasm)' -size +1k …` (BSD/macOS) or `find dist -regextype posix-extended -regex '.*\.(js|css|html|svg|json|wasm)' …` (GNU).
  - If you pre-compress `.zst`, keep the window at 8 MB or less. RFC 9659: "encoders MUST NOT generate frames requiring a Window_Size larger than 8 MB". Do not use `--long` or `--ultra` levels.
  - Verified numbers: article table "range from 65% to 86%" at maximum levels. CDN article: "Brotli-4 … Brotli-11" and "gzip-6 … gzip-9". Calvano (2024-03-19): Brotli 11 is "19.18%" smaller than gzip 6, and zstd 19 is "14.11%" smaller. web-features `brotli` is Baseline high 2020-03-19.
- Evidence: https://web.dev/articles/optimizing-content-efficiency-optimize-encoding-and-transfer ; https://web.dev/articles/content-delivery-networks ; https://paulcalvano.com/2024-03-19-choosing-between-gzip-brotli-and-zstandard-compression/ ; https://www.rfc-editor.org/rfc/rfc9659.html

### Offer zstd for dynamically compressed responses
- Verdict: verified
- Note: Calvano: "zStandard level 12 often produces similar payloads to Brotli level 5, with compression times faster than gzip and Brotli." web-features `zstd`: Baseline low 2026-02-11 (Chrome 123, Firefox 126, Safari 26.3). Add the RFC 9659 8 MB window rule from the item above.
- Evidence: https://paulcalvano.com/2024-03-19-choosing-between-gzip-brotli-and-zstandard-compression/ ; https://api.webstatus.dev/v1/features/zstd ; https://www.rfc-editor.org/rfc/rfc9659.html

### Do not compress already-compressed or tiny responses
- Verdict: verified
- Note: The article's figure is more exact: a minimum threshold "typically less than four or five kilobytes".
- Evidence: https://web.dev/articles/optimizing-content-efficiency-optimize-encoding-and-transfer

### Compress the HTML document instead of adding many preloads, and compress SVG LCP images
- Verdict: verified
- Note: The article's "Core Web Vitals" section contains all three points: HTML plus the preload scanner, SVG LCP images, and system-font text with CSS.
- Evidence: https://web.dev/articles/optimizing-content-efficiency-optimize-encoding-and-transfer

### Minify in the build with source maps, not at the CDN edge
- Verdict: verified
- Note: Article table: Angular 1.8.3 is 1,346 KiB unminified and 173 KiB minified. The Cloudflare facts come from the community post and secondary reports: removal on 2024-08-05, less than 0.1% saved.
- Evidence: https://web.dev/articles/optimizing-content-efficiency-optimize-encoding-and-transfer ; https://community.cloudflare.com/t/deprecating-auto-minify/655677

### Use Compression Dictionary Transport to ship frequently deployed bundles as deltas (Chromium)
- Verdict: corrected
- Correction:
  - Impact: MDN does not cite "5–10x". MDN says: "Compression Dictionary Transport can achieve an order of magnitude more compression than compression using a default built-in dictionary", and links the WICG examples.
  - Avoid/caveats: the CSP rule applies only to a separate dictionary. "When loading a separate dictionary using `<link rel="compression-dictionary">`, the `connect-src` directive … must allow the dictionary location." It does not apply to the `Use-As-Dictionary` delta flow on bundles that this item describes.
  - Verified: RFC 9842. BCD: Chrome 130, Firefox "preview" (and 145 behind a flag), no Safari. `Vary: accept-encoding, available-dictionary`. The `match` value is a URLPattern.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression_dictionary_transport ; https://www.rfc-editor.org/info/rfc9842/ ; MDN browser-compat-data 8.1.2

### Put the whole site through the CDN, including HTML and uncacheable API responses
- Verdict: verified
- Note: Article: "Ideally you should use a CDN to serve your entire site."
- Evidence: https://web.dev/articles/content-delivery-networks

### Give hashed static assets a one-year TTL and add `immutable`
- Verdict: verified
- Note: BCD `Cache-Control.immutable`: Chrome false, Firefox 49, Safari 11. It is also false in Firefox for Android.
- Evidence: MDN browser-compat-data 8.1.2 ; https://web.dev/articles/content-delivery-networks

### Micro-cache hot public dynamic responses at the CDN for a few seconds, and never cache private data there
- Verdict: verified
- Note: Article: "caching these responses for very short periods of time (for example, 5 seconds)". BCD `stale-while-revalidate`: Chrome 75, Firefox 68, Safari 14.
- Evidence: https://web.dev/articles/content-delivery-networks

### Use long CDN TTLs plus tag-based purge ("hold-till-told") for content that changes at unknown times
- Verdict: verified
- Evidence: https://web.dev/articles/content-delivery-networks

### Normalize cache keys: ignore tracking query params, sort params, and send `No-Vary-Search` for the browser
- Verdict: verified
- Note: BCD: HTTP cache support is Chrome 141 on desktop and **Chrome 143 on Android**. Speculation-rules support is from Chrome 121 (prefetch only before 127). Firefox 154 (released 2026-08-18). No Safari.
- Evidence: MDN browser-compat-data 8.1.2 `http.headers.No-Vary-Search`

### Do not send `Set-Cookie` or wide `Vary` on cacheable responses
- Verdict: verified
- Note: Article: "caches will typically not cache server responses containing this header" and "The Vary header is not widely supported by CDNs".
- Evidence: https://web.dev/articles/content-delivery-networks

### Target a CDN cache hit ratio of about 90%, and audit cache headers on every static response
- Verdict: corrected
- Correction: The Lighthouse 13 ID is `cache-insight`, not `use-cache-insight` (see the CI item). The rest is verified. Article: "A CHR of 90% is a good goal for most sites." The minimum headers are `max-age`, `s-maxage` or `Expires`.
- Evidence: https://github.com/GoogleChrome/lighthouse/blob/v13.5.0/core/audits/insights/cache-insight.js ; https://web.dev/articles/content-delivery-networks

### Choose tiered caching (edge plus a central shield) when your users are spread thin across PoPs
- Verdict: verified
- Evidence: https://web.dev/articles/content-delivery-networks

### Enable TLS 1.3, HTTP/2 and HTTP/3 at the edge
- Verdict: verified
- Note: Article: "effectively reduces connection setup time by 33%". web-features `http3`: Baseline low 2024-09-16. caniuse `tls1-3` usage is 95.68%.
- Evidence: https://web.dev/articles/content-delivery-networks ; https://api.webstatus.dev/v1/features/http3 ; https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/tls1-3.json

### Emit only lowercase, ASCII-safe header names and values before you enable HTTP/2 or HTTP/3
- Verdict: verified
- Note: RFC 9113 §8.2.1 bans uppercase and 0x7f–0xff in field **names**. For field **values**, it bans only NUL, LF and CR, and leading or trailing whitespace. Non-ASCII in values is not "malformed" under RFC 9113. The "no non-ASCII" rule comes from the article ("non-ASCII or uppercase characters in headers"). It is a safe rule, but not a protocol requirement.
- Evidence: https://www.rfc-editor.org/rfc/rfc9113.html#section-8.2.1 ; https://web.dev/articles/content-delivery-networks

### Do not depend on the HTTP/2 priority tree, and do not split bundles into hundreds of tiny files
- Verdict: verified
- Note: RFC 9113 §5.3.2 deprecates the RFC 7540 signals, and "The PRIORITY frame (type=0x02) is deprecated". BCD `Priority` header: Chrome 124, Firefox 128, no Safari.
- Evidence: https://www.rfc-editor.org/rfc/rfc9113.html ; MDN browser-compat-data 8.1.2

### Do not invest in AMP or Signed Exchanges for load speed
- Verdict: verified
- Note: More facts in the same direction:
  - Google Search now "will now take users directly to the publisher's AMP host pages", so no AMP Cache or SXG prefetch happens from Search results.
  - The Cloudflare changelog (2026-06-23) says AMP/SXG is end of life. Cloudflare staff said SXG was turned off early. Users saw SXG traffic drop around 2025-09-19.
- Evidence: https://developers.google.com/search/docs/appearance/signed-exchange ; https://developers.cloudflare.com/changelog/post/2026-06-23-amp-sxg-end-of-life/ ; https://community.cloudflare.com/t/amp-and-signed-exchanges-deprecation-october-20th/831238

## Cross-file conflicts

1. **`sizes="auto"` in Safari.** Batch 03 (line 12 and the `sizes="auto"` item) says "not in Safari". `04-html-and-http-loading-features.md:318` says Safari 27.0 added it. The WebKit Safari 27.0 release notes confirm 04, so batch 03 is wrong.
2. **Lighthouse 13 insight IDs.** Batch 03 (line 412) uses `interaction-to-next-paint-insight`. Batch 04 (lines 245 and 429) uses `use-cache-insight`. `16-explore-fast-batch-06.md:198` correctly gives the source IDs `cache-insight`, `lcp-breakdown-insight` and `inp-breakdown-insight`.
3. **Cross-origin `renderTime` without TAO.** Batch 04 says Chrome 133, Firefox 141 and Safari 26.2 (correct per BCD). Batch 03 says other browsers need TAO and lists the Firefox/Safari question as not verified. `15-gaps-round-2.md:63` says "The old rule still holds in other engines". `07-js-web-apis.md:756` says "`renderTime` is 0 for cross-origin images without `Timing-Allow-Origin`". The last three are out of date.
4. **ResizeObserver timing.** Batch 03 says ResizeObserver callbacks run "before style, layout and paint". `01-critical-rendering-path.run1.md:694`, `06-js-event-loop-and-scheduling.md:337` and `05-css-rendering.md:516` say they run after layout and before paint. The others are correct, per the HTML spec.
5. **First-chart-frame hook.** Batch 03 marks after `await surface.nextStateRender(...)`. Batch 04 marks in the rAF after `renderedToDestination`. Both APIs exist (13-scichart verify). Neither uses SciChart's `painted` event, which 13-scichart describes as raised after frame paint. Pick one pattern for the skill.
6. **`unsized-images` / `non-composited-animations`.** Batch 03 and `05-css-rendering.md:94` say they are still separate Lighthouse 13 diagnostics. This is correct per `default-config.js`. The "moving to insights" blog that batch 03 cites says that `cls-culprits-insight` replaces them. Use the source code.
7. **Dates in the Chromium LCP changelog.** The changelog pages say "Chrome 147 reached stable users in February 2026" and "Chrome 151 … in June 2026". BCD release dates are 2026-04-07 (147) and 2026-07-28 (151). Batch 04 uses 2026-07-28, which is correct. Do not copy the changelog dates.

## Missing but important

1. **zstd window limit (RFC 9659).** Encoders "MUST NOT generate frames requiring a Window_Size larger than 8 MB". High `--ultra`/`--long` pre-compression can produce files that browsers fail to decode. Source: https://www.rfc-editor.org/rfc/rfc9659.html
2. **103 Early Hints from the CDN.** The CDN article does not mention it. BCD `http.status.103`: Chrome 103, Firefox 120, Safari 17, HTTP/2+ only. The batch 01 verify notes that Safari acts only on `preconnect` in a 103. Source: MDN browser-compat-data 8.1.2 ; verify/16-explore-fast-batch-01-group.verify.md
3. **`image-set()` for CSS background images.** `srcset` does not apply to CSS backgrounds, and the image-delivery insight skips CSS images for size checks. web-features `image-set` is Baseline high 2026-03-18. Source: web-features data ; https://chromium.googlesource.com/devtools/devtools-frontend/+/refs/heads/main/front_end/models/trace/insights/ImageDelivery.ts
4. **`Comlink.transfer()`.** Without it, Comlink structured-clones every typed array that goes to or from the worker. Source: https://github.com/GoogleChromeLabs/comlink/blob/main/README.md
5. **Container Timing (`containertiming` attribute, entry type `container`).** It measures when a DOM subtree finishes its first paint, for example an order book or watch-list panel. It is in an origin trial from Chrome 148 (blog 2026-05-01). The blog does not say that canvas paints count, so it probably does not replace a custom chart mark (unverified). Source: https://developer.chrome.com/blog/container-timing-origin-trial
6. **Verify the served encoding in RUM.** `PerformanceResourceTiming.contentEncoding` (Chrome 143, experimental) shows whether `br`/`zstd`/`dcb` reached real users. `deliveryType` (Chrome 117, Safari 26.4) shows cache and prefetch hits. Source: MDN browser-compat-data 8.1.2
7. **Use `sources[0]` directly.** `sources` is sorted by impact area, so `sources[0]` (or web-vitals `largestShiftSource`) is the main moved element. You do not need a custom area reduce. Source: https://wicg.github.io/layout-instability/#report-the-layout-shift-sources
8. **`presentationTime` null handling.** Chrome 145+ exposes `paintTime` and `presentationTime`. Firefox 140 and Safari 26.2 expose `presentationTime` but it "always returns null". Cross-browser RUM code that computes render delay must fall back to `paintTime`. Source: MDN browser-compat-data 8.1.2 `api.LargestContentfulPaint.presentationTime`
