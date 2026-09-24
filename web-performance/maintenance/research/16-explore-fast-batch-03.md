# web.dev "Fast" collection: batch 3 of 6 (lazy loading and LCP, image dimensions, LCP metric, CSS for Web Vitals, field debugging, lab INP diagnosis, layout-shift debugging, web workers)

Scope: a full read of the 8 web.dev articles in `batches/fast-batch-03.md`. I saved the raw HTML and stripped text in `raw/fast-batch-3/`. From each article I took every actionable lever and its mechanism.
Status was checked on 2026-09-23 against MDN browser-compat-data (BCD) v8.1.2 (2026-09-17), web-features (webstatus.dev data), the Chromium LCP metric changelog, the W3C Paint Timing and LCP specs, the web-vitals CHANGELOG and upgrade guides (v6.2.2), the Lighthouse 13 release notes, DevTools release notes, and the MDN, webpack and Vite docs.
Other research files cover standard levers (Core Web Vitals guides, HTML loading attributes, CSS rendering, the event loop, workers and GPU). Those levers appear once each in "## Standard levers seen". The detail goes to levers that are new, more specific, or changed.

## Article dates and advice that is out of date (as of 2026-09-23)

| Article | Last updated | Out of date or changed |
|---|---|---|
| The performance effects of too much lazy loading | 2022-03-31 | The WordPress fix it proposes shipped in WP 5.9 (first content image not lazy, `wp_omit_loading_attr_threshold` default 1). WP 6.3 added auto `fetchpriority="high"`. The Lighthouse audit it asks for (`lcp-lazy-loaded`) was added and then folded into `lcp-discovery-insight` in Lighthouse 13 (2025-10-10). I could not check the status of the Chromium issue on "eager first N images despite `loading=lazy`" (the tracker needs sign-in). `loading="lazy"` for images and iframes is now Baseline widely available (2026-06-19). |
| Serve images with correct dimensions | 2018-11-05 | **The Lighthouse "Properly size images" audit (`uses-responsive-images`) no longer exists.** It is part of `image-delivery-insight` (Lighthouse 13). **The ImageMagick commands are out of date:** in ImageMagick 7, `magick` replaces `convert`, and the docs say not to use `magick convert`. New since then: `sizes="auto"` for lazy images (Chrome 126, Firefox 150, not in Safari). |
| Largest Contentful Paint (LCP) | 2025-09-04 | Mostly current. Chromium changes after the update: Chrome 145 shipped `paintTime`/`presentationTime` on LCP entries. Chrome 147 emits intermediate candidates by *painted* size rather than *pending* size. Chrome 151 emits video LCP entries promptly. LCP entries now exist in Firefox 122+ and Safari 26.2+ (Baseline 2025-12-12). The heuristics the article lists are Chromium's. |
| CSS for Web Vitals | 2021-06-02 | **"Safari will block text rendering indefinitely" is wrong.** WebKit has used a 3 s block since 2016. **"The browser will stop downloading other resources until the stylesheet is parsed" is inaccurate.** The preload scanner keeps fetching while CSS blocks rendering. The Lighthouse audits it names were merged into `cls-culprits-insight` in Lighthouse 13. `unsized-images` and `non-composited-animations` still exist as separate diagnostics. The claim "Lighthouse only analyzes up to page load" holds only for navigation mode. Timespan mode measures CLS across interactions. |
| Debug performance in the field | 2024-10-06 | **`attribution.element` for LCP was renamed `attribution.target` in web-vitals v5 (2025-05-07).** Current is v6.2.2 (2026-09-14). **The first CLS snippet reads `curRect`/`prevRect`, which do not exist.** The real properties are `currentRect`/`previousRect`. **The "Web Vitals Report" tool is archived (2025-06-27) and is no longer online.** v6 adds soft-navigation reporting (Chromium 151+), and `includeProcessedEventEntries` now defaults to `false`. |
| Manually diagnose slow interactions in the lab | 2024-10-17 (published 2023-05-09) | **The "Timeline: event initiators" experiment is gone.** Initiator arrows show by default since Chrome 122. CPU throttling now has calibrated "low-tier mobile" and "mid-tier mobile" presets (Chrome 134). Since 2025-10, DevTools has "INP breakdown" and "Forced reflow" insights (fails at more than 30 ms). |
| Debug layout shifts | 2025-02-07 | Current. The Layout Instability API is still Chromium only (BCD 8.1.2: no Firefox or Safari support, marked experimental). Its console snippet sums *all* shifts. That is the pre-2021 CLS definition, not the current session-window CLS. Use it only to debug. |
| Use web workers to run JavaScript off the main thread | 2019-12-05 | **Tooling section is out of date.** webpack 5 and Vite bundle workers natively with `new Worker(new URL(..., import.meta.url))`. `worker-plugin` was archived on 2026-04-19. Module workers are Baseline widely available (2025-12-06). **Time to Interactive** was removed from Lighthouse 10. The article does not mention OffscreenCanvas (Baseline widely available since 2025-09-27), which lets a worker render a canvas. |

---

## The performance effects of too much lazy loading (web.dev/articles/lcp-lazy-loading, 2022-03-31)

### Decide `loading` per image position: load the first in-viewport content image eagerly and lazy-load the rest
- Layer: html
- Stage: network, preload-scan
- Metrics: LCP, bundle-size (image bytes)
- When: load
- Impact: high. In the article's WordPress A/B test, lazy loading everything made archive-page LCP 13–15% slower. The position-based fix removed that regression and kept every byte saved.
- Do: When the server builds the page and cannot know the viewport, treat the first featured image and the first image in the main content as above the fold. Leave out `loading="lazy"` on those images and put it on every later image. Keep the number of eager images as a setting (WordPress calls it `wp_omit_loading_attr_threshold`, default 1).
- Why: A lazy image is requested only after layout confirms that it is near the viewport. This removes it from the preload scanner's early fetches and delays the LCP image. When below-the-fold images are lazy, fewer requests compete with the LCP image for bandwidth. In the article's test, the fix was up to 4% faster than turning lazy loading off entirely, and image bytes were 51–70% lower.
- Example:
  ```html
  <!-- Server-rendered list: first card eager (no attribute), others lazy -->
  <img src="/news/1.avif" width="640" height="360" alt="">
  <img src="/news/2.avif" width="640" height="360" alt="" loading="lazy">
  <img src="/news/3.avif" width="640" height="360" alt="" loading="lazy">
  ```
- Avoid/caveats: The heuristic is only calibrated for the general case. Long headings, intro text, the viewport size, and anchor links or text fragments that open the page scrolled all change what is in the viewport. For a single-page app, do the same for images that JS renders on first paint.
- Status: `loading` on img/iframe is Baseline widely available since 2026-06-19 (web-features `loading-lazy`). WordPress shipped the fix in 5.9 and added `fetchpriority="high"` on the likely LCP image in 6.3.
- Sources: https://web.dev/articles/lcp-lazy-loading, https://make.wordpress.org/core/2021/12/29/enhanced-lazy-loading-performance-in-5-9/, https://make.wordpress.org/core/2023/07/13/image-performance-enhancements-in-wordpress-6-3/

### Log a warning when the LCP element is lazy-loaded
- Layer: js
- Stage: network
- Metrics: LCP
- When: testing, long-lived session (RUM)
- Impact: medium. It catches a common cause of LCP regressions that lab tests on one viewport can miss.
- Do: In dev builds or RUM, observe `largest-contentful-paint` entries. Warn or report when the latest entry's `element` has `loading="lazy"`.
- Why: The LCP element varies with viewport and scroll position, so field data shows cases that one lab run does not show.
- Example:
  ```js
  new PerformanceObserver((list) => {
    const last = list.getEntries().at(-1);
    if (last?.element?.getAttribute('loading') === 'lazy') {
      console.warn('LCP element is lazy-loaded', last.element);
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  ```
- Avoid/caveats: The check misses JS lazy loaders that use `data-src` swaps. `element` is `null` if the element has since been removed from the DOM. In the lab, Lighthouse 13 reports this in `lcp-discovery-insight`, which replaced `lcp-lazy-loaded`.
- Status: LCP entries are Baseline newly available (2025-12-12). Chrome 77, Firefox 122, Safari 26.2 (BCD 8.1.2).
- Sources: https://web.dev/articles/lcp-lazy-loading, https://developer.chrome.com/blog/lighthouse-13-0

### Prove a loading-strategy change with a repeated-run lab A/B test, not cross-site correlation
- Layer: tooling
- Stage: network
- Metrics: LCP, bundle-size
- When: testing
- Impact: medium. HTTP Archive data showed a correlation (lazy-loading sites had slower p75 LCP) that did not prove the cause. Only the A/B test found the real cause.
- Do: Test the same pages with the change on and off, on desktop and emulated mobile. Run each variant many times (the article used 9 WebPageTest runs) and compare the medians of LCP *and* bytes. Treat a difference smaller than one standard deviation as neutral.
- Why: Real-world cohorts are confounded (84% of lazy-loading sites were WordPress). Repeated runs expose variance.
- Avoid/caveats: Lab tests use one viewport and one network profile. Confirm the result with field data.
- Status: Methodology. Not version dependent.
- Sources: https://web.dev/articles/lcp-lazy-loading

---

## Serve images with correct dimensions (web.dev/articles/serve-images-with-correct-dimensions, 2018-11-05)

### Choose the resize method by how CSS sizes the image
- Layer: html, build
- Stage: network, raster
- Metrics: LCP, bundle-size
- When: build, load
- Impact: medium. Oversized images waste bytes and decode time, and they slow LCP when the image is the LCP element.
- Do: For an image with a fixed size in absolute units (`px`), export it at that display size (times the device pixel ratios you support). For an image sized in relative units (`%`, `vw`, `em`), either export one size that works on all common screens ("good"), or give `srcset` (width descriptors) plus `sizes` so the browser picks a file ("better").
- Why: The browser downloads and decodes the whole file even when it paints it smaller. With `srcset`/`sizes`, the browser can choose by layout width and screen density before layout.
- Example:
  ```html
  <!-- relative width: the card is 100vw on phones, 400px on desktop -->
  <img src="/logo-800.webp"
       srcset="/logo-400.webp 400w, /logo-800.webp 800w, /logo-1200.webp 1200w"
       sizes="(min-width: 768px) 400px, 100vw"
       width="400" height="200" alt="Exchange logo">
  ```
- Avoid/caveats: `sizes` must match the real CSS layout, or the browser picks the wrong file. The "better" approach costs more build complexity. The article says some sites find the quality gain from high-density files does not matter.
- Status: `srcset`/`sizes` is Baseline widely available (2019-09-27, web-features `srcset`). In Lighthouse 13, oversized images are reported by `image-delivery-insight`. It does not flag an image when the estimated savings are under 4 KiB.
- Sources: https://web.dev/articles/serve-images-with-correct-dimensions, https://developer.chrome.com/docs/performance/insights/image-delivery, https://developer.chrome.com/blog/lighthouse-13-0

### Resize images in the build with `magick`, not `convert`
- Layer: build
- Stage: network
- Metrics: bundle-size, LCP
- When: build
- Impact: low. It is a workflow detail, but a wrong command breaks the build scripts.
- Do: Write resize steps with ImageMagick 7 syntax, for example `magick in.jpg -resize 200x100 out.jpg` (fit inside a box) or `magick in.jpg -resize 25% out.jpg`. For many images, automate with a script or an image CDN.
- Why: **Out of date in the article:** the article uses `convert` (macOS/Linux) and `magick convert` (Windows). ImageMagick 7 makes `magick` the primary command, no longer ships the legacy `convert` on Windows, and says not to use `magick convert`.
- Avoid/caveats: Resizing does not re-encode to a modern format by itself. The Lighthouse image-delivery insight also flags format and compression.
- Status: ImageMagick 7 porting guide (checked 2026-09-23).
- Sources: https://web.dev/articles/serve-images-with-correct-dimensions, https://imagemagick.org/porting/

### When CSS forces an aspect ratio that differs from the file, add `object-fit`
- Layer: css
- Stage: layout, paint
- Metrics: CLS
- When: load
- Impact: medium. It reserves layout space before the image loads, with no distortion.
- Do: Either set `width`/`height` attributes, or set CSS `aspect-ratio` and a width. If the CSS ratio differs from the image's own ratio, also set `object-fit: cover` (or `contain`).
- Why: Space is reserved from the declared ratio before the bytes arrive, so no shift occurs when the image loads. Without `object-fit`, a file with a different ratio is stretched to fill the box.
- Example:
  ```css
  .news-thumb { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
  ```
- Avoid/caveats: `cover` crops the edges. Pick `contain` for logos and charts that must not be cropped.
- Status: `aspect-ratio` is Baseline widely available (2024-03-20). `object-fit` is Baseline widely available (2022-07-15). The ratio mapped from `width`/`height` attributes works in Chrome 79, Firefox 71, Safari 15 (BCD).
- Sources: https://web.dev/articles/serve-images-with-correct-dimensions

### Use `sizes="auto"` on lazy images whose layout width is only known after layout (not in the article)
- Layer: html
- Stage: layout, network
- Metrics: bundle-size
- When: load
- Impact: low to medium. It saves writing and maintaining `sizes` by hand for below-the-fold images.
- Do: For images with `loading="lazy"` and a `srcset` with width descriptors, write `sizes="auto, <fallback>"`. Browsers that support it use the laid-out width, and other browsers use the fallback.
- Why: A lazy image is fetched after layout, so the browser already knows its rendered width and can pick the right candidate.
- Example:
  ```html
  <img loading="lazy" sizes="auto, (min-width: 768px) 400px, 100vw"
       srcset="/c-400.webp 400w, /c-800.webp 800w" src="/c-800.webp"
       width="400" height="225" alt="">
  ```
- Avoid/caveats: It works only together with `loading="lazy"`. Do not use it on the LCP image.
- Status: Chrome 126, Firefox 150, not in Safari. Not Baseline (web-features `sizes-auto`, BCD 8.1.2).
- Sources: BCD `html.elements.img.sizes.auto`. Added for currency, not from the article.

---

## Largest Contentful Paint (LCP) (web.dev/articles/lcp, 2019-08-08, updated 2025-09-04)

### Do not count on a `<canvas>` chart to be the LCP element. Measure chart readiness with your own mark
- Layer: canvas2d, gpu, js
- Stage: paint, gpu-draw
- Metrics: LCP, FCP
- When: load
- Impact: high for a chart-first page. The LCP value may reflect a heading or logo rather than the chart the user waits for.
- Do: Keep the server-rendered text and images above the chart fast, because one of them becomes the LCP element. Track "first chart frame" as a custom metric: call `performance.mark('chart-first-frame')` after the first frame that has data is drawn, and report it with your RUM.
- Why: The Paint Timing spec treats a canvas with a context as *contentful*, so it can trigger FCP. However, LCP and Element Timing only consider *timing-eligible* elements: `img`, `image` inside `svg`, `video` with a poster or first frame, elements with a `url()` background image, and text nodes. The article adds that inline `<svg>` is not a candidate, but `<img src="x.svg">` is.
- Example:
  ```js
  // SciChart: wait for the first rendered state (API per 13-scichart.md), then mark
  await surface.nextStateRender({ resumeBefore: true, invalidateOnResume: true, suspendAfter: false });
  performance.mark('chart-first-frame');
  ```
- Avoid/caveats: `nextStateRender` and its options come from the SciChart research file (`13-scichart.md`). I did not check them again here. A User Timing mark records when the draw was *submitted*, not when it was presented. The canvas/LCP conclusion is my reading of the specs, not a claim from the article.
- Status: `performance.mark` is Baseline widely available. Element Timing (`elementtiming` attribute) is Chromium only and experimental (BCD 8.1.2).
- Sources: https://web.dev/articles/lcp, https://w3c.github.io/paint-timing/, https://w3c.github.io/largest-contentful-paint/

### Do not rely on placeholders, full-viewport backgrounds, or invisible elements as the LCP element
- Layer: html, css
- Stage: paint
- Metrics: LCP
- When: load
- Impact: medium. These heuristics decide *which* paint counts, so tricks that "paint something big early" do not improve LCP.
- Do: Make the real hero content load fast. Do not fade the LCP content in from `opacity: 0` on load. Do not use transparent text, anti-flicker snippets that hide the page, or a large blurry placeholder in the hope of an early LCP.
- Why: In Chromium, LCP ignores elements with opacity 0 (Chrome 86), elements that cover the whole viewport (Chrome 88), and images with less than 0.05 bits of image data per displayed pixel (Chrome 112). This is why low-quality placeholders do not count. Chrome 130 also ignores transparent text. The fade-in or the real image then becomes the LCP time.
- Avoid/caveats: Firefox and Safari have their own heuristics, and the article lists only Chromium's. Chrome 144 fixed LCP/FCP timing when the document's opacity changes from zero to non-zero.
- Status: Chromium changelog (checked 2026-09-23).
- Sources: https://web.dev/articles/lcp, https://chromium.googlesource.com/chromium/src/+/main/docs/speed/metrics_changelog/lcp.md, https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/speed/metrics_changelog/2023_04_lcp.md

### Know how LCP size is computed before you design the hero
- Layer: html, css
- Stage: layout, paint
- Metrics: LCP
- When: load
- Impact: medium. It explains why the LCP element can differ from the one you expect.
- Do: When you optimize an LCP image, remember that an image stretched above its natural size counts at its *intrinsic* size (the smaller of intrinsic and visible). Only the part inside the viewport counts, and margins, padding and borders do not. For text, only the smallest rectangle around the text nodes counts, and each text node belongs to its nearest block-level ancestor.
- Why: An element's size is taken from its first paint in the viewport. Later moves or resizes do not create new candidates. An image that slides in from off-screen may never be reported, and an element pushed out of view keeps its first size. An element that is removed remains the LCP element until something larger paints (Chrome 88+).
- Avoid/caveats: Carousels that insert same-size slides do not create new candidates. The browser stops recording candidates at the first tap, scroll or key press.
- Status: Current per article (2025-09-04) and the Chromium changelog.
- Sources: https://web.dev/articles/lcp, https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/speed/metrics_changelog/2020_11_lcp_2.md

### Send `Timing-Allow-Origin` on cross-origin LCP images (CDN)
- Layer: network
- Stage: network
- Metrics: LCP
- When: load
- Impact: medium. Without it, RUM LCP for cross-origin images can be wrong (it can even appear to come before FCP) in browsers that do not coarsen render times.
- Do: Configure the image CDN to send `Timing-Allow-Origin: https://your.app` (or `*` for public assets).
- Why: For privacy, render time for cross-origin images was hidden unless the image had TAO, so the API fell back to load time. Chrome 133 exposes a render time coarsened to 4 ms even without TAO, but the article still recommends TAO for accuracy in other browsers.
- Example:
  ```http
  Timing-Allow-Origin: https://terminal.example
  ```
- Avoid/caveats: TAO also exposes detailed Resource Timing to the allowed origins. Allow only the origins you need.
- Status: `Timing-Allow-Origin` works in Chrome 54, Firefox 45, Safari 11 (BCD). Chrome 133 coarsened render times (Chromium changelog 2025_02).
- Sources: https://web.dev/articles/lcp, https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/speed/metrics_changelog/2025_02_lcp.md

### Measure LCP with `web-vitals` `onLCP`, not with a raw observer
- Layer: js, tooling
- Stage: paint
- Metrics: LCP
- When: long-lived session (RUM)
- Impact: medium. Raw API values differ from the metric in several ways, so dashboards are wrong without these corrections.
- Do: Use `onLCP()` from `web-vitals` and report only the final value. If you must use the raw API, ignore pages loaded in a background tab, ignore entries after the page is hidden, measure bfcache restores as new visits, and measure prerendered pages from `activationStart`.
- Why: The raw API continues after the page is hidden and ignores bfcache restores and iframes. It also counts from navigation start even for prerendered pages. The library applies these corrections, but it cannot see LCP inside cross-origin iframes.
- Avoid/caveats: The raw API does not see content inside iframes, but CrUX does. That is one reason RUM and CrUX differ. Since Chrome 147, observers get intermediate candidates as content paints, and the final value does not change. web-vitals v6 also reports soft-navigation LCP in Chromium 151+.
- Status: web-vitals 6.2.2 (npm, 2026-09-14). `activationStart` is Chromium only (BCD).
- Sources: https://web.dev/articles/lcp, https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/speed/metrics_changelog/2026_02_lcp.md, https://github.com/GoogleChrome/web-vitals/blob/main/docs/upgrading-to-v6.md

### Expect a video or animated image to count from its first frame
- Layer: html
- Stage: paint, gpu-draw
- Metrics: LCP
- When: load
- Impact: low to medium. It matters for hero videos.
- Do: If a hero `<video>` autoplays, make its first frame (or its poster) arrive fast. The LCP time is the earlier of the poster load and the first frame shown.
- Why: Since Chrome 116, a video can be an LCP candidate, and animated GIF/PNG images count from their first frame. Since Chrome 151, Chrome requests a frame right after the first video frame so that the entry is not delayed on an idle page.
- Avoid/caveats: Video LCP times seen by the observer can be about one vsync later than the real paint.
- Status: Chromium changelog (2023_08, 2026_06).
- Sources: https://web.dev/articles/lcp, https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/speed/metrics_changelog/2026_06_lcp.md

---

## CSS for Web Vitals (web.dev/articles/css-web-vitals, 2021-06-02)

### Put late-arriving banners, toasts and notices in fixed or absolute position, or reserve their space
- Layer: css
- Stage: layout
- Metrics: CLS
- When: load, interaction
- Impact: high. Content inserted at the top after first render pushes everything below it down.
- Do: Show cookie notices, alert bars, order toasts and similar late UI as `position: fixed` (for example at the bottom) or `absolute`, so they overlay the page. If they must be in the flow, reserve their height from the first render.
- Why: An element outside the normal flow does not move its siblings. A `position: sticky` bar at the top is still in the flow, so inserting it shifts `div.hero` and everything after it. The banner itself does not shift, so tools list the elements *below* it as the shifted sources.
- Example:
  ```css
  /* Before: in-flow sticky bar inserted late -> shifts the page */
  .notice { position: sticky; top: 0; }
  /* After: overlays the page, nothing moves */
  .notice { position: fixed; inset: auto 0 0 0; }
  ```
- Avoid/caveats: A fixed overlay can cover content or controls. Add bottom padding to the page if it must not hide the last rows. Lighthouse navigation mode does not see banners that appear after load (use timespan mode or RUM).
- Status: CSS positioning is Baseline. Lighthouse 13 merged `layout-shifts` into `cls-culprits-insight`.
- Sources: https://web.dev/articles/css-web-vitals, https://developer.chrome.com/blog/lighthouse-13-0, https://github.com/GoogleChrome/lighthouse/blob/main/docs/user-flows.md

### Paint decorative backgrounds with CSS gradients instead of image files
- Layer: css
- Stage: network, paint
- Metrics: LCP
- When: load
- Impact: medium. In the article's demo, a large gradient JPEG behind the banner was an LCP candidate and cost a download.
- Do: Replace gradient-like background images with `linear-gradient()`/`radial-gradient()`.
- Why: A CSS gradient needs no request. LCP considers only `url()` background images, not gradients, so the LCP moves to real content.
- Example:
  ```css
  /* Before */ .panel { background: url(/img/gradient-960.jpg); }
  /* After  */ .panel { background: linear-gradient(135deg, #0b1220 20%, #1b2a4a 90%); }
  ```
- Avoid/caveats: Complex gradients over very large areas still cost paint time, especially if they animate.
- Status: Gradients are Baseline widely available.
- Sources: https://web.dev/articles/css-web-vitals, https://web.dev/articles/lcp

### Load third-party font CSS with `<link>` plus preconnect, never with CSS `@import`
- Layer: html, css
- Stage: network, cssom
- Metrics: FCP, LCP, CLS
- When: load
- Impact: medium. It removes one or two round trips from the font request chain.
- Do: Remove the `@import` of the font stylesheet. At the top of `<head>`, add `preconnect` to the stylesheet origin and to the font-file origin (with `crossorigin`, because font files are fetched with CORS), then a `<link rel="stylesheet">`.
- Why: With `@import`, the chain is page CSS → font CSS → font file, and each step is found only after the step before it is parsed. A `<link>` is found by the preload scanner, and preconnect opens both connections early. The article asks you to check the request chain in the DevTools Network panel (Initiator tab) and to keep it short.
- Example:
  ```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap">
  ```
- Avoid/caveats: Every preconnect uses sockets and CPU, so add them only for origins that are needed early. Self-hosting removes the third-party connections completely. The fonts research files cover that.
- Status: `preconnect` is Baseline. Google Fonts still documents `display=`.
- Sources: https://web.dev/articles/css-web-vitals, https://developers.google.com/fonts/docs/getting_started

### Request only the glyphs a logo or heading needs (`text=`)
- Layer: network
- Stage: network
- Metrics: FCP, LCP
- When: load
- Impact: low to medium. Google says a `text=` request can make the font file up to 90% smaller.
- Do: For a font used only for fixed text (logo, one heading), add `&text=<url-encoded characters>` to the Google Fonts URL. For self-hosted fonts, subset them at build time.
- Why: The font server returns a file that contains only those glyphs.
- Example:
  ```html
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@700&text=TRADESTER&display=swap">
  ```
- Avoid/caveats: Dynamic text (prices, names) needs the full character set. A second request for the full family defeats the purpose.
- Status: Still documented (Google Fonts docs, last updated 2024-07-23).
- Sources: https://web.dev/articles/css-web-vitals, https://developers.google.com/fonts/docs/getting_started

### Do not trust the article's explanation of render-blocking CSS and Safari font blocking
- Layer: css
- Stage: cssom, preload-scan
- Metrics: FCP, LCP
- When: load
- Impact: low. This item fixes facts, not code.
- Do: Keep critical CSS small and defer the rest (standard). But reason from the real mechanism: CSS blocks *rendering* and later parser-blocking scripts, while the preload scanner keeps discovering and fetching other resources.
- Why: **Out of date or inaccurate:** the article says the browser "stops downloading other resources" until CSS is parsed. The preload-scanner article shows images found and fetched while the parser waits on CSS. The article also says Safari blocks text "indefinitely", but WebKit switched to a 3 s block in 2016.
- Avoid/caveats: None.
- Status: WebKit blog 2016-06-27. web.dev preload-scanner article (2022-05-13).
- Sources: https://web.dev/articles/css-web-vitals, https://web.dev/articles/preload-scanner, https://webkit.org/blog/6643/improved-font-loading/

---

## Debug performance in the field (web.dev/articles/debug-performance-in-the-field, 2024-10-06)

### Send one "debug target" string with every Web Vitals beacon, using the attribution build
- Layer: js, tooling
- Stage: main-thread-task, layout, paint
- Metrics: LCP, INP, CLS
- When: long-lived session (RUM)
- Impact: high. Without attribution, field scores do not tell you what to fix. Lighthouse sees only page load and no interactions.
- Do: Import from `web-vitals/attribution`. With each metric, send a selector string: `attribution.largestShiftTarget` (CLS), **`attribution.target`** (LCP), and `attribution.interactionTarget` (INP). Add `generateTarget` if your CSS classes are hashed or unstable.
- Why: The library already picks the final LCP element, the largest shift source, and the INP interaction, and it turns each into a short, low-cardinality selector.
- Example:
  ```js
  import { onCLS, onINP, onLCP } from 'web-vitals/attribution';
  const target = { CLS: a => a.largestShiftTarget, LCP: a => a.target, INP: a => a.interactionTarget };
  const send = ({ name, value, delta, id, attribution }) =>
    navigator.sendBeacon('/rum', JSON.stringify({ name, value, delta, id, debug: target[name](attribution) }));
  onCLS(send); onLCP(send); onINP(send);
  ```
- Avoid/caveats: **Out of date in the article:** it reads `attribution.element` for LCP, which was renamed `target` in v5 (2025-05-07). v5 also removed `interactionTargetElement` by default. The "Web Vitals Report" tool the article suggests was archived on 2025-06-27 and is no longer online. Send `delta` if your backend adds values together.
- Status: web-vitals 6.2.2 (2026-09-14). Its support policy is Baseline Widely available (since v5).
- Sources: https://web.dev/articles/debug-performance-in-the-field, https://github.com/GoogleChrome/web-vitals/blob/main/docs/upgrading-to-v5.md, https://github.com/GoogleChrome/web-vitals/blob/main/CHANGELOG.md, https://github.com/GoogleChromeLabs/web-vitals-report

### For CLS, report only the largest source of the largest shift, with its time and URL path
- Layer: js
- Stage: layout
- Metrics: CLS
- When: long-lived session
- Impact: medium. It keeps beacons small and still points to the elements that affect the most users.
- Do: Keep all shift entries in memory. When you send CLS, find the entry with the largest `value`, and in it the source with the largest `previousRect` area. Report that node's selector, the shift time, and `location.pathname` (for SPAs that change the URL).
- Why: CLS depends on how the user scrolls and clicks, so field and lab values differ a lot. The article showed 0.28 at p75 in the field and a different value in the lab. When you aggregate the worst element across users, you get a ranked fix list. After you fix the top one, smaller shifts become the next "worst".
- Example:
  ```js
  function clsDebugTarget(entries) {
    const worst = entries.reduce((a, b) => (a.value >= b.value ? a : b));
    const src = worst.sources?.reduce((a, b) =>
      a.previousRect.width * a.previousRect.height >= b.previousRect.width * b.previousRect.height ? a : b);
    return src?.node ?? null;
  }
  ```
- Avoid/caveats: **Bug in the article's first snippet:** it destructures `curRect` and `prevRect`, which do not exist. The properties are `currentRect` and `previousRect`. Do not compute the target on every shift, only when you send. The web-vitals `largestShiftSource`/`largestShiftTarget` does this for you, but it picks the *first* source in document order rather than the largest area.
- Status: `LayoutShift`/`LayoutShiftAttribution` are Chromium only (Chrome 77/84) and experimental. Not in Firefox or Safari (BCD 8.1.2, web-features `layout-instability` not Baseline).
- Sources: https://web.dev/articles/debug-performance-in-the-field, https://github.com/GoogleChrome/web-vitals

### Record where the LCP element is and why it was slow (subparts), per page load
- Layer: js, tooling
- Stage: network, paint
- Metrics: LCP, TTFB
- When: long-lived session
- Impact: medium. The LCP element differs between users on the same URL.
- Do: Report the LCP selector plus its subparts: `timeToFirstByte`, `resourceLoadDelay`, `resourceLoadDuration`, `elementRenderDelay` (and `url` for images).
- Why: Screen size changes the layout, links with fragments or text fragments open the page scrolled, and personalized content changes what is largest. You must measure the element, not assume it. The subparts tell you whether to fix the server, discovery, bytes, or rendering.
- Avoid/caveats: With many resources before LCP, raise `resourceBufferSize` in `onLCP` (default 50 extra entries, added in v6.1). It costs memory.
- Status: web-vitals 6.x `LCPAttribution`.
- Sources: https://web.dev/articles/debug-performance-in-the-field, https://github.com/GoogleChrome/web-vitals

### For INP, send the target, type, time, load state and the three subparts, then act on the dominant one
- Layer: js, tooling
- Stage: main-thread-task, style, layout, paint
- Metrics: INP
- When: interaction, long-lived session
- Impact: high. It decides whether to fix startup JS, handlers, or rendering.
- Do: Send `interactionTarget`, `interactionType` ('pointer' or 'keyboard'), `interactionTime`, `loadState`, `inputDelay`, `processingDuration` and `presentationDelay`. Where Long Animation Frame (LoAF) data exists, also send `longestScript` and `totalStyleAndLayoutDuration`.
- Why: If most slow interactions have `loadState` `dom-interactive` or `dom-content-loaded`, the main thread is busy with startup script, so reduce or split it. A high processing time points to the handler code. A high presentation delay points to rendering work.
- Avoid/caveats: In v6, `processedEventEntries` is empty unless you set `includeProcessedEventEntries: true`, which saves memory. LoAF fields are Chromium only.
- Status: Event Timing is Baseline newly available (2025-12-12). LoAF is Chrome 123+ only (web-features `long-animation-frames` not Baseline).
- Sources: https://web.dev/articles/debug-performance-in-the-field, https://github.com/GoogleChrome/web-vitals/blob/main/docs/upgrading-to-v6.md

---

## Manually diagnose slow interactions in the lab (web.dev/articles/manually-diagnose-slow-interactions-in-the-lab, 2023-05-09, updated 2024-10-17)

### Reproduce slow interactions on throttled or real low-end hardware, and interact *during* load
- Layer: tooling
- Stage: main-thread-task
- Metrics: INP, TBT
- When: testing
- Impact: high. A fast laptop hides the long tasks that users on phones see.
- Do: In the Performance panel, use calibrated CPU throttling ("mid-tier mobile" is the suggested default), or debug a real Android phone remotely. Also throttle the network and click as soon as the page paints, not after it settles.
- Why: The main thread is busiest during startup, and users interact before load finishes. Throttling makes long tasks longer so that they show up in the trace. Calibration fits the slowdown factor to your machine.
- Avoid/caveats: Throttling pauses the main thread in short bursts. It does not model GPU or raster speed, so check canvas and WebGL work on a real device.
- Status: Calibration shipped in DevTools in Chrome 134.
- Sources: https://web.dev/articles/manually-diagnose-slow-interactions-in-the-lab, https://developer.chrome.com/blog/new-in-devtools-134

### Find the slow interaction in live metrics, then record a trace and read its subparts on the Interactions track
- Layer: tooling
- Stage: main-thread-task, style, layout, paint
- Metrics: INP
- When: testing
- Impact: medium. It turns "INP is bad" into a specific handler or rendering step.
- Do: Open the Performance panel. In the live metrics view, try many interactions and expand the slow ones to see the phase breakdown. Then record a trace of that interaction. Hover it on the Interactions track: the left whisker is input delay, the solid block is processing, the right whisker is presentation delay, and the striped part is the time above 200 ms. Look for red-cornered `Event: click` entries in long tasks. Enable Screenshots when the problem is rendering.
- Why: The right fix depends on which of the three parts is largest.
- Avoid/caveats: **Out of date in the article:** the "Timeline: event initiators" experiment no longer exists. Initiator arrows (for example, invalidation → Recalculate styles or Layout, and rAF request → Animation Frame Fired) show by default since Chrome 122. Since 2025-10, the INP breakdown and Forced reflow insights point to the same data.
- Status: DevTools (Chrome 122 and later). Lighthouse 13 `interaction-to-next-paint-insight` replaced `work-during-interaction`.
- Sources: https://web.dev/articles/manually-diagnose-slow-interactions-in-the-lab, https://developer.chrome.com/blog/new-in-devtools-122, https://developer.chrome.com/docs/performance/insights/forced-reflow, https://developer.chrome.com/docs/performance/insights/inp-breakdown

### Keep `requestAnimationFrame` and `ResizeObserver` callbacks to the work the next frame needs
- Layer: js
- Stage: main-thread-task, style, layout
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: high for chart UIs. Resize handlers and render loops often do data work that delays the next frame.
- Do: In rAF and `ResizeObserver` callbacks, only write the visual updates for this frame. Move analytics, data transforms, recomputing indicators and network calls into a task after the frame (for example `scheduler.yield()` or `setTimeout`) or into a worker.
- Why: Both callback types run in the rendering step of the event loop, before style, layout and paint. Everything in them adds directly to presentation delay and to frame time.
- Example:
  ```js
  // Before: heavy work blocks the frame after every resize
  new ResizeObserver(([e]) => { recomputeIndicators(); chart.resize(e.contentRect); });
  // After: resize now, recompute after the frame
  new ResizeObserver(([e]) => {
    chart.resize(e.contentRect);
    setTimeout(recomputeIndicators, 0);
  });
  ```
- Avoid/caveats: Do not defer the visual change itself. That only moves the jank. Reading layout (for example `offsetWidth`) after a write inside these callbacks forces a reflow, which the Forced reflow insight flags above 30 ms.
- Status: rAF and ResizeObserver are Baseline widely available. `scheduler.yield()` is Chrome 129 and Firefox 142, not in Safari (BCD 8.1.2).
- Sources: https://web.dev/articles/manually-diagnose-slow-interactions-in-the-lab, https://developer.chrome.com/docs/performance/insights/forced-reflow

### Without field data, use TBT and known user flows to choose what to test
- Layer: tooling
- Stage: main-thread-task
- Metrics: TBT, INP
- When: testing
- Impact: low to medium. It is a fallback, because TBT covers only load.
- Do: Run Lighthouse. If TBT is high, test interactions during load. For interactions after load, script the main user flows from analytics (for example, placing an order) and profile them. Lighthouse timespan mode helps here.
- Why: TBT correlates with INP during load. It does not see slow interactions after load.
- Status: Methodology.
- Sources: https://web.dev/articles/manually-diagnose-slow-interactions-in-the-lab, https://github.com/GoogleChrome/lighthouse/blob/main/docs/user-flows.md

---

## Debug layout shifts (web.dev/articles/debug-layout-shifts, 2021-03-11, updated 2025-02-07)

### Hide an element with `display:none`, `visibility:hidden` or `opacity:0` while you lay it out before showing it
- Layer: css, js
- Stage: layout
- Metrics: CLS
- When: interaction, animation/render-loop
- Impact: medium. Shifts of elements covered by other elements still count.
- Do: If you must lay out or measure a panel before you reveal it (for example, a chart legend or order-ticket popover positioned under an overlay), hide it with one of these three properties, not by stacking it behind another element or moving it off-screen in flow.
- Why: The Layout Instability API does not ignore an element that is hidden only because another element covers it. When that element moves, the move counts as a shift.
- Example:
  ```css
  .ticket[data-measuring] { visibility: hidden; } /* laid out, measurable, not a shift source */
  ```
- Avoid/caveats: `display:none` gives no geometry, so use `visibility:hidden` when you need measurements.
- Status: Chromium behavior. CLS exists only in Chromium.
- Sources: https://web.dev/articles/debug-layout-shifts

### Read `sources` as symptoms: look at the element *before* the shifted one, and at the shift's direction and size
- Layer: tooling
- Stage: layout
- Metrics: CLS
- When: testing
- Impact: medium. It saves time spent fixing the wrong element.
- Do: For each shift, check whether the preceding element changed size or position, whether a node was inserted or removed before it, or whether the shifted element itself was moved. Use the size of the shift as a hint: a large downward move usually means an insertion. A 1–2 px move usually means conflicting CSS or a font swap.
- Why: `sources` lists up to the five elements that *moved* (the largest by impact), and these are often not the root cause. If every field of `previousRect` is 0, the element moved into view. If every field of `currentRect` is 0, it moved out of view.
- Avoid/caveats: An element that changes size without moving its neighbors creates no shift.
- Status: Layout Instability is Chromium only and experimental (BCD 8.1.2).
- Sources: https://web.dev/articles/debug-layout-shifts

### Log shifts in the console with a buffered observer (and `debugger`) during a 5–10 minute manual session
- Layer: tooling
- Stage: layout
- Metrics: CLS
- When: testing
- Impact: medium. You cannot fix shifts that you cannot reproduce, and Lighthouse navigation mode sees only load.
- Do: Paste a buffered `layout-shift` observer that skips `hadRecentInput`. Add `debugger` in it to pause at each shift. Then use the site for 5–10 minutes on different devices and a slow connection.
- Why: `buffered: true` replays earlier shifts, so a burst at the start is a backlog, not new shifts. Entries arrive when the main thread is idle, so they can lag a little. Shifts within 500 ms of input are excluded from CLS.
- Example:
  ```js
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      console.log('shift', e.value.toFixed(4), e.sources.map(s => s.node));
      // debugger;
    }
  }).observe({ type: 'layout-shift', buffered: true });
  ```
- Avoid/caveats: The article's snippet adds up every shift. That is not today's CLS, which is the largest session window (gaps under 1 s, at most 5 s). Use `onCLS` for the metric value.
- Status: Chromium only.
- Sources: https://web.dev/articles/debug-layout-shifts, https://web.dev/articles/cls

### Use the DevTools Layout shifts track, the Layout shift culprits insight and Layout Shift Regions
- Layer: tooling
- Stage: layout
- Metrics: CLS
- When: testing
- Impact: medium.
- Do: Watch CLS in live metrics while you interact. Record a trace: in the Layout shifts track, clusters are purple lines and each diamond is one shift, sized by score. Click a diamond to see an animation and the shifted nodes. Open the "Layout shift culprits" insight for likely causes (unsized images, injected iframes, unoptimized animations, web fonts). For a quick visual check, enable Rendering > Layout Shift Regions and reload.
- Why: These tools are built on the Layout Instability API and show which shifts to fix first.
- Status: DevTools. The CLS culprits insight was published on 2025-10-08.
- Sources: https://web.dev/articles/debug-layout-shifts, https://developer.chrome.com/docs/devtools/rendering/performance

---

## Use web workers to run JavaScript off the main thread (web.dev/articles/off-main-thread, 2019-12-05)

### Keep the UI on the main thread and move pure logic and state into a dedicated worker
- Layer: js
- Stage: main-thread-task, script-run
- Metrics: INP, LCP, FPS/smoothness
- When: interaction, long-lived session
- Impact: high on weak devices. In the article's PROXX case, a 6 s frozen UI on a feature phone became 12 s of total work *with frames still shown*.
- Do: Split the app like the PROXX game (the Chrome team's case study): the main thread renders and animates, and the worker owns the purely computational logic and state (for a terminal: parsing the market data feed, indicators, order-book aggregation). Design the state flow like Flux or Redux so that the worker sends state changes to the UI.
- Why: A worker is a separate OS thread with no shared variables and no DOM. Work moved there no longer blocks input handling or frames. The goal is to *reduce risk* on unpredictable devices, not to make things faster.
- Avoid/caveats: Total work stays the same, and message overhead can make things slightly slower. Workers have no DOM access. The 2019 article also names WebUSB, WebRTC and Web Audio as unavailable. Check MDN for each API's worker availability. **Not in the article:** a worker *can* draw a chart through `OffscreenCanvas` (`transferControlToOffscreen()`). This works for 2D in Chrome 69, Firefox 105 and Safari 16.4, and for WebGL/WebGL2 in Safari 17. The GPU research files cover it.
- Status: Dedicated workers are Baseline widely available. OffscreenCanvas is Baseline widely available (2025-09-27). `requestAnimationFrame` in workers is Baseline widely available (2025-09-27).
- Sources: https://web.dev/articles/off-main-thread, BCD `api.OffscreenCanvas.getContext`

### Wrap worker calls in an RPC layer (Comlink) instead of writing a message protocol by hand
- Layer: js
- Stage: main-thread-task
- Metrics: INP
- When: build, long-lived session
- Impact: medium. It removes the main reason teams avoid workers.
- Do: `expose(api)` in the worker and `wrap(worker)` on the main thread. Every call then returns a promise.
- Why: Raw `postMessage` makes you encode the operation and match responses to requests yourself. With several operations, that code grows quickly.
- Example:
  ```ts
  // indicators.worker.ts
  import { expose } from 'comlink';
  expose({ ema: (closes: Float64Array, n: number) => computeEma(closes, n) });
  // main.ts
  import { wrap } from 'comlink';
  const calc = wrap<typeof import('./indicators.worker')>(
    new Worker(new URL('./indicators.worker.ts', import.meta.url), { type: 'module' }));
  ```
- Avoid/caveats: Each call is one message round trip, so chatty fine-grained calls add latency. Batch calls. Comlink's latest release is 4.4.2 (2024-11-07). It is stable but not recently updated.
- Status: Comlink 4.4.2 (npm).
- Sources: https://web.dev/articles/off-main-thread, https://registry.npmjs.org/comlink

### Keep worker messages small: send patches, chunk large updates, transfer binary buffers
- Layer: js
- Stage: main-thread-task, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: animation/render-loop, long-lived session
- Impact: high for streaming data. Structured cloning of large objects runs on both threads.
- Do: For work within the frame budget, keep each message's JSON-equivalent size under about 10 KiB. For a response to an interaction (100 ms budget), stay under about 100 KiB. Send only changed fields (patches), split large patch sets over several messages, and move numeric series as `ArrayBuffer`s in the transfer list.
- Why: `postMessage` copies with structured clone, and the cost grows with payload size. Surma measured this in 2019, with the Nokia 2 as the slowest device. A transferred `ArrayBuffer` moves in constant time, and the sender's copy becomes detached (`byteLength` 0).
- Example:
  ```js
  const prices = new Float64Array(50_000);
  worker.postMessage({ type: 'series', prices }, [prices.buffer]); // zero-copy; prices is now empty here
  ```
- Avoid/caveats: Typed arrays are not transferable themselves. Transfer their `.buffer`. The 10 KiB and 100 KiB figures come from a 2019 blog, not from a spec. `SharedArrayBuffer` avoids copies but needs cross-origin isolation (`Cross-Origin-Opener-Policy: same-origin` plus `Cross-Origin-Embedder-Policy: require-corp` or `credentialless`). `credentialless` is not in Safari.
- Status: Transfer lists are widely supported. `SharedArrayBuffer`/Atomics are Baseline widely available (2024-06-13) when cross-origin isolated. `structuredClone` is Baseline widely available (2024-09-14).
- Sources: https://web.dev/articles/off-main-thread, https://surma.dev/things/is-postmessage-slow/, https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects, https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated

### Create workers with the standard `new URL(..., import.meta.url)` pattern and `type: 'module'`
- Layer: build
- Stage: network, script-compile
- Metrics: startup, bundle-size
- When: build
- Impact: medium. With the wrong syntax, the bundler does not see the worker, and the worker file is missing or not code-split.
- Do: Write `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` inline, with the `new URL(...)` directly inside the constructor.
- Why: **Out of date in the article:** it says most bundlers need plugins (`worker-plugin`, `rollup-plugin-off-main-thread`). webpack 5 and Vite now detect this pattern natively and emit the worker as its own chunk, and `worker-plugin` was archived on 2026-04-19. The worker also parses and compiles on its own thread, so startup cost moves off the main thread.
- Example:
  ```js
  // Before (breaks static analysis)
  const url = new URL('./feed.worker.ts', import.meta.url); const w = new Worker(url);
  // After
  const w = new Worker(new URL('./feed.worker.ts', import.meta.url), { type: 'module' });
  ```
- Avoid/caveats: webpack says it cannot analyze a URL stored in a variable. Vite also accepts `import W from './x?worker'`, but it recommends the constructor form.
- Status: Module workers are Baseline widely available (2025-12-06, web-features `js-modules-workers`).
- Sources: https://web.dev/articles/off-main-thread, https://webpack.js.org/guides/web-workers/, https://vite.dev/guide/features#web-workers, https://github.com/GoogleChromeLabs/worker-plugin

---

## Standard levers seen
- Do not lazy-load the LCP image or other above-the-fold images (lcp-lazy-loading, css-web-vitals).
- Set `width`/`height` on `<img>`/`<iframe>` so space is reserved before load. Lighthouse still has a separate `unsized-images` diagnostic (serve-images, css-web-vitals, debug-layout-shifts).
- Serve responsive images with `srcset`/`sizes` (serve-images, css-web-vitals).
- Compress images and use modern formats (AVIF/WebP). This is now one Lighthouse `image-delivery-insight` (css-web-vitals conclusion).
- Animate `transform`/`opacity` (the article adds `filter`) instead of `margin`/`top`/`left`. Lighthouse flags only CSS animations, not JS `setInterval` animations (css-web-vitals, debug-layout-shifts).
- Inline critical CSS, defer the rest, and remove unused CSS (css-web-vitals).
- Use `preconnect` only for a few critical origins (css-web-vitals).
- Use fewer web fonts, shorten the font request chain, and use a fallback font with similar metrics to reduce swap shifts (css-web-vitals, debug-layout-shifts).
- Reserve space for ads, embeds, banners and modals, and do not insert content above existing content, for example in infinite scroll (debug-layout-shifts).
- Let stylesheets load early. Late or overriding stylesheets move and resize elements (debug-layout-shifts).
- Break up long tasks by yielding, and defer work that does not render (manually-diagnose). `scheduler.yield()` works in Chrome 129+ and Firefox 142+, not Safari.
- Do less in event handlers: memoize (React `memo`), and use framework transitions (React `startTransition`) (manually-diagnose).
- Keep the DOM small, and avoid forced synchronous layout and layout thrashing (manually-diagnose).
- Reduce input delay caused by third-party timers during load (manually-diagnose).
- Core Web Vitals "good" thresholds at p75, split by mobile and desktop: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 (lcp, manually-diagnose, debug-performance-in-the-field).
- Measure in the field first, then reproduce in the lab, then fix the issue that affects the most users, and repeat (manually-diagnose, debug-performance-in-the-field).
- Web fonts in their block period are not painted, so they delay LCP for text. Use `font-display` (lcp, css-web-vitals).

## Sources read
- https://web.dev/articles/lcp-lazy-loading
- https://web.dev/articles/serve-images-with-correct-dimensions
- https://web.dev/articles/lcp
- https://web.dev/articles/css-web-vitals
- https://web.dev/articles/debug-performance-in-the-field
- https://web.dev/articles/manually-diagnose-slow-interactions-in-the-lab
- https://web.dev/articles/debug-layout-shifts
- https://web.dev/articles/off-main-thread
- https://web.dev/articles/preload-scanner
- https://web.dev/articles/cls (saved copy from batch 2, for the session-window definition)
- https://chromium.googlesource.com/chromium/src/+/main/docs/speed/metrics_changelog/lcp.md and entries 2026_02, 2026_06, 2025_02, 2024_10, 2023_04, 2023_08, 2020_11_lcp_2
- https://w3c.github.io/paint-timing/ and https://w3c.github.io/largest-contentful-paint/
- https://github.com/GoogleChrome/web-vitals/blob/main/CHANGELOG.md, docs/upgrading-to-v5.md, docs/upgrading-to-v6.md, and the README (saved copy from batch 2), npm registry `web-vitals` (6.2.2)
- https://github.com/GoogleChromeLabs/web-vitals-report
- https://developer.chrome.com/blog/moving-lighthouse-to-insights
- https://developer.chrome.com/blog/lighthouse-13-0
- https://developer.chrome.com/docs/performance/insights/image-delivery
- https://developer.chrome.com/docs/performance/insights/cls-culprit, forced-reflow, inp-breakdown (saved copies in raw/)
- https://developer.chrome.com/blog/new-in-devtools-122
- https://developer.chrome.com/blog/new-in-devtools-134 (search summary) and https://developer.chrome.com/docs/devtools/rendering/performance
- https://github.com/GoogleChrome/lighthouse/blob/main/docs/user-flows.md
- https://developer.chrome.com/blog/lighthouse-10-0/ (search summary: TTI removed)
- https://make.wordpress.org/core/2021/12/29/enhanced-lazy-loading-performance-in-5-9/ and https://make.wordpress.org/core/2023/07/13/image-performance-enhancements-in-wordpress-6-3/ (search summaries)
- https://webkit.org/blog/6643/improved-font-loading/
- https://developers.google.com/fonts/docs/getting_started
- https://imagemagick.org/porting/
- https://surma.dev/things/is-postmessage-slow/
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
- https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated
- https://webpack.js.org/guides/web-workers/
- https://vite.dev/guide/features#web-workers
- https://github.com/GoogleChromeLabs/worker-plugin
- npm registry: comlink, worker-plugin, @surma/rollup-plugin-off-main-thread
- MDN browser-compat-data 8.1.2 and web-features data (local copies in raw/)

## Not covered / could not access
- Chromium issue 996963 (experiment to load the first few images eagerly despite `loading=lazy`). The tracker needs sign-in, so its current status is unknown.
- The embedded videos (Surma's CDS 2019 talk) and the article images, charts and screenshots were not reviewed. The notes use only the text.
- The linked "Find slow interactions in the field", "Optimize LCP", "Custom metrics", "Evolving CLS" and "How to create high-performance CSS animations" articles were not re-read. Other batches cover them.
- The web.dev "Serve responsive images" guide that the serve-images article points to was not read here. The HTML loading-attributes research covers `srcset`/`sizes`.
- Whether Firefox and Safari expose `renderTime` for cross-origin images without `Timing-Allow-Origin` (Chrome 133 does, coarsened) was not verified.
- Which Web APIs are available inside workers (the article's 2019 list: WebUSB, WebRTC, Web Audio) was not re-checked one by one.
- The claim that a canvas cannot be an LCP candidate comes from the Paint Timing spec's "timing-eligible" list. I did not test it in a browser.
