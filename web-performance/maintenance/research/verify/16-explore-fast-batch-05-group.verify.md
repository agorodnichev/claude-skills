# Verify: 16-explore-fast-batch-05.md, 16-explore-fast-batch-06.md

Checked on 2026-09-23. Raw evidence is saved in `raw/verify/16c/` (web.dev article text, LHCI and Lighthouse source and docs, WebKit `CachedResourceRequest.cpp`, npm and GitHub API data, chromestatus JSON). Compat data: web-features 3.39.0 and @mdn/browser-compat-data 8.1.2 (2026-09-17). Both are the latest npm versions today, so the shared copies in `raw/verify/02/` are current.

Summary counts (52 items):

| File | Items | Verified | Corrected | Disputed | Unverified |
|---|---|---|---|---|---|
| 16-explore-fast-batch-05.md | 35 | 26 | 9 | 0 | 0 |
| 16-explore-fast-batch-06.md | 17 | 13 | 4 | 0 | 0 |
| Total | 52 | 39 | 13 | 0 | 0 |

Most important corrections:
1. Safari does advertise `image/avif` in its image `Accept` header (WebKit source, since the 2022 AVIF enablement for macOS 13/iOS 16). The batch-05 claim that Accept-based logic sends WebP to Safari is wrong. It came from an outdated MDN table.
2. Chromium closes an unused preconnected socket after about 60 s, not 10 s (`client_socket_pool_manager.cc`). 15-gaps-round-2.md already flagged this line.
3. Lighthouse 12.6.1 (bundled in LHCI 0.15.1) and Lighthouse 13.x do not use the same `*-insight` IDs. 12.6.1 has `lcp-phases-insight` and `interaction-to-next-paint-insight`. 13.x has `lcp-breakdown-insight` and `inp-breakdown-insight`.
4. The LHCI presets do not assert `total-blocking-time` at all (it is `off` in `all.js`). With the PSI runner (Lighthouse 13), the presets fail with `auditRan` errors on audits that 13.0 removed.

---

## 16-explore-fast-batch-05.md

### Serve raster images through an image CDN with URL-driven size, format, and quality
- Verdict: verified
- Evidence: https://web.dev/articles/image-cdns ("40–80% savings in image file sizes"; security key; content-type can differ from the extension; Thumbor, Imaginary, Imagor; footer 2019-08-14). web-features `srcset` is Baseline widely available (high 2019-09-27).

### Put the image CDN on the page's own origin, or preconnect to it early
- Verdict: corrected
- Correction: (1) Caveat: Chromium closes an unused preconnected socket after about 60 s: `ClientSocketPoolManager::unused_idle_socket_timeout()` returns `kPreconnectIntervalSec = 60`. The "10 s" figure comes from a 2019 web.dev article. Suggested wording: "Chromium drops an unused preconnected socket after about 60 s; servers and CDNs can close idle connections sooner." (2) Status: `rel=preconnect` became Baseline newly available on 2020-01-15 and widely available on 2022-07-15. The notes give 2020-01-15 as the "widely available" date.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/net/socket/client_socket_pool_manager.cc (lines 208-212, cached in raw/verify/02/). web-features `link-rel-preconnect` (low 2020-01-15, high 2022-07-15). 15-gaps-round-2.md:12-28.

### Negotiate image format with the `Accept` header and send `Vary: Accept`; do not rely on Chromium-only hints
- Verdict: corrected
- Correction: (1) Replace "Safari's image `Accept` header also leaves out `image/avif` … so pure Accept-based logic sends WebP to Safari. Commercial CDNs add UA sniffing to fix this." with: "Safari 16+ on macOS 13+/iOS 16+ sends `image/webp,image/avif,image/jxl,image/heic,image/heic-sequence,video/*;q=0.8,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5` (JXL and HEIC from Safari 17). Lockdown Mode sends only `image/webp`. MDN's 'Safari (since Big Sur)' row is outdated." WebKit builds the header in `acceptHeaderValueForImageResource()`, which appends `image/avif,` under `HAVE(AVIF) || USE(AVIF)`. The WebKit commit "[Cocoa] Support AVIF images for macOS Ventura and iOS 16" (2022-06-25) changed this file. (2) The Chrome/Edge example value leaves out `image/svg+xml`. The observed Chrome value is `image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8` (whatwg/fetch#1740). (3) Add a caveat: `Vary: Accept` splits the cache key per distinct Accept string, so normalize Accept into avif/webp/other buckets at the CDN. 02-course-loading.md:797 already says this.
- Evidence: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/cache/CachedResourceRequest.cpp (lines 142-176, cached as raw/verify/16c/wk-CachedResourceRequest.cpp). https://github.com/whatwg/fetch/issues/1740. https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Content_negotiation/List_of_default_Accept_values (outdated Safari row). BCD: `Save-Data` Chrome 49 only, experimental. `Sec-CH-DPR`/`Sec-CH-Width`/`Sec-CH-Viewport-Width` Chrome 97, experimental. `DPR`/`Width`/`Viewport-Width`/`Content-DPR` deprecated. `NetworkInformation.effectiveType` Chromium only. https://www.fastly.com/blog/best-practices-using-vary-header

### Remove the image before you optimize it: use CSS, SVG, or live text
- Verdict: corrected
- Correction: The quoted phrase is "might incur a higher processing cost". The notes quote it as "may incur a higher processing cost". The rest is verified.
- Evidence: https://web.dev/articles/choose-the-right-image-format ("you might incur a higher processing cost to render the finer detail, but the underlying asset is the same"). https://web.dev/articles/carousel-best-practices ("Keep text and images separate").

### Budget raster pixels by DPR squared
- Verdict: verified
- Evidence: https://web.dev/articles/choose-the-right-image-format (table: 10,000 px → 40,000 bytes at 1x; 160,000 at 2x; 360,000 at 3x, "4 bytes per pixel", labeled "Uncompressed file size").

### Choose the raster format by content type
- Verdict: corrected
- Correction: Update the JPEG XL status. chromestatus "JPEG XL decoding support (image/jxl) in blink" (jxl-rs, entry updated 2026-08-31) has a ship stage at Chrome 155 on desktop, Android, WebView and iOS, with a blink-dev intent thread. Its status is "Proposed". Chrome 155 stable is 2026-10-06. Today (Chrome 154 stable) the decoder is still off by default, so keep the fallback. Also check this again after 2026-10-06. Minor point: "Animation: `<video>`, never GIF or APNG" follows the article. For small UI animations that need transparency, video alpha support is uneven, so "never" is stronger than needed. AVIF (high 2026-07-25, low 2024-01-25) and WebP (high 2023-03-16) dates are verified.
- Evidence: https://chromestatus.com/feature/5114042131808256 (API JSON cached as raw/verify/16c/cs-jxl.json). https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=155. web-features `avif`, `webp`, `jpegxl` (Safari 17 only). https://web.dev/articles/choose-the-right-image-format

### Measure unused JS and CSS before cutting it
- Verdict: verified
- Evidence: https://developer.chrome.com/docs/devtools/coverage ("Per function or Per block", reload button, JS/CSS filter; "Last updated 2026-04-13"). The Lighthouse 13.5 `default-config.js` still lists `unused-javascript` and `unused-css-rules` (diagnostics group). This closes the notes' own open question.

### Import only the sub-modules you use, and prefer SDKs with modular (tree-shakable) APIs
- Verdict: verified
- Evidence: https://firebase.google.com/docs/web/modular-upgrade (updated 2026-09-17): "can result in 80% less kilobytes than a comparable app built using the namespaced API". The compat libraries "will be removed completely in a future major SDK version". GitHub API shows `GoogleChromeLabs/webpack-libs-optimizations` archived=true with last push 2022-11-12. The API does not give the archive date. https://web.dev/articles/remove-unused-code (footer 2018-11-05).

### Replace heavy interactive embeds with a facade, and load the real one on interaction
- Verdict: corrected
- Correction: "Lighthouse 13 removed the `third-party-facades` audit, so no tool will flag missing facades for you" is too broad. Lighthouse 12.x still has `third-party-facades` (diagnostics). That includes Lighthouse 12.6.1, which LHCI 0.15.1 bundles. Only Lighthouse 13+ (DevTools, PSI, CLI 13.x) dropped it. The rest is verified: GitHub API shows lite-youtube-embed last pushed 2025-11-10, and react-live-chat-loader archived=true with last push 2026-05-09.
- Evidence: https://developer.chrome.com/blog/lighthouse-13-0 ("third-party-facades … removed"). Lighthouse v12.6.1 `core/config/default-config.js` line 466 `{id: 'third-party-facades', …}`. https://web.dev/articles/embed-best-practices ("over 100 KB of JavaScript, sometimes even going up to 2 MB"; "On mouseover: Facade preconnects").

### Use a static or generated image instead of an interactive embed when interaction is optional
- Verdict: verified
- Evidence: https://web.dev/articles/embed-best-practices (DevTools "Capture node screenshot" gives a png, "consider converting it to WebP"; Maps Static API; the API key is left out of the example URL).

### Remove the embed, or link to it, when no loading technique makes it cheap enough
- Verdict: verified
- Evidence: https://web.dev/articles/embed-best-practices ("embed source code may change"; link with `target="_blank"`). https://developer.chrome.com/blog/lighthouse-13-0 (`third-party-summary` → `third-parties-insight`). `third-party-summary` is not in the 13.5 config.

### Reserve an embed's final size per breakpoint, then release the reservation
- Verdict: verified
- Evidence: https://web.dev/articles/embed-best-practices (Layout Shift Terminator: "Sizes a min-height wrapper around the embed markup using media queries (and container queries) until the embed initializes"). GitHub API shows `GoogleChromeLabs/layout-shift-terminator` archived=true, pushed_at 2026-03-27. The archive date is inferred from pushed_at because the API does not expose it. web-features `aspect-ratio` high 2024-03-20 and `container-queries` high 2025-08-14 are verified.

### Treat the embed article's iframe `loading` details as outdated
- Verdict: verified
- Evidence: MDN iframe source lists only `eager` and `lazy`, and says "Loading is only deferred when JavaScript is enabled. This is an anti-tracking measure". BCD `html.elements.iframe.loading`: Chrome 77, Firefox 121, Safari 16.4. web-features `loading-lazy` low 2023-12-19, high 2026-06-19. BCD `iframe.frameborder` deprecated. Lite mode was turned off with Chrome 100 stable (2022-03-29): https://9to5google.com/2022/02/23/chrome-lite-mode-for-android-will-be-removed-next-month-with-the-chrome-100-update/. GitHub API shows lazysizes last pushed 2024-04-03.

### Reserve space for the next batch with skeletons that match the final item size
- Verdict: verified
- Evidence: https://addyosmani.com/blog/infinite-scroll-without-layout-shifts/ (the Facebook feed placeholders "have different dimensions to the final content"). web-features `line-clamp` shows no support. BCD `css.properties.line-clamp`: only the prefixed form ships in all engines.

### Prefetch the next page early enough that appended content lands inside the 500 ms input window
- Verdict: verified
- Evidence: https://web.dev/articles/cls ("within 500 milliseconds of user input … `hadRecentInput` … only be true for discrete input events … Continuous interactions such as scrolls, drags … are not"). BCD `api.LayoutShift` is Chromium only and experimental. Minor note, not a correction: an IntersectionObserver sentinel fires only when intersection changes. If the appended page is too short to push the sentinel out, observe again or check after each append.

### Do not put content below an unbounded list
- Verdict: verified
- Evidence: https://addyosmani.com/blog/infinite-scroll-without-layout-shifts/ ("Remove the footer or any DOM elements at the bottom of the page that may be pushed down").

### Virtualize long lists: render only the visible window of rows
- Verdict: corrected
- Correction: "With fixed-height rows the scroll height never changes" is not accurate. In the example, `spacer.style.height = data.length * ROW`, so the scroll height grows with every append. Correct wording: "with fixed-height rows, existing rows keep their offsets, so rows appended below do not move visible content". Status and library facts are verified: web-features `content-visibility` low 2025-09-15, `contain-intrinsic-size` high 2026-03-18; GitHub API shows react-window pushed 2026-09-22.
- Evidence: https://addyosmani.com/blog/infinite-scroll-without-layout-shifts/ (react-window). Local web-features 3.39.0.

### Expect CLS to be counted per 5-second session window, including in long-lived SPAs
- Verdict: verified
- Evidence: https://web.dev/articles/cls ("less than 1-second in between each shift and a maximum of 5 seconds"; "Good CLS values are 0.1 or less. Poor values are greater than 0.25"; "Last updated 2023-04-12"). The blog's "session-level normalization" section confirms the "future" wording. Note: Lighthouse timespan mode (user flows, batch 06) can also record shifts after load, so "Lighthouse sees only the load" is true only for navigation mode.

### Prefer "Load more" over automatic infinite scroll when accessibility matters
- Verdict: verified
- Evidence: https://addyosmani.com/blog/infinite-scroll-without-layout-shifts/ (WordPress.org list: back button, footer, "large memory footprint", keyboard, assistive devices, no URL).

### After a heavy click, paint the acknowledgment first, then yield, then run callbacks; remove DOM later
- Verdict: corrected
- Correction: The PubTech fallback chain differs by priority. `yieldToMainUiBlocking` uses `scheduler.yield()`, then `postTask({priority:'user-blocking'})`, then "falling back to nothing" (no `setTimeout`, so no yield in Safari). Only `yieldToMainBackground` uses `scheduler.yield()`, then `postTask({priority:'user-visible'})`, then `setTimeout(…, 0)`. The case study's summary line says "up to 64%" and its body says "up to 65%". The 470 ms → 230 ms figure and the `display:none` plus `requestIdleCallback` "lazy de-rendering" are verified. The status (`scheduler.yield` Chrome 129 / Firefox 142 / no Safari; `requestIdleCallback` Safari preview flag only) is verified.
- Evidence: https://web.dev/case-studies/pubconsent-inp (last updated 2024-02-28). BCD `api.Scheduler.yield`, `api.Window.requestIdleCallback`. web-features `scheduler` and `requestidlecallback` are not Baseline.

### Load the consent script directly in the HTML, async, with early connections to each of its origins
- Verdict: verified
- Evidence: https://web.dev/articles/cookie-notice-best-practices (printed preload has no `as`; "usefulness of preloading … will vary"). MDN `<link>`: "`as` … is required when rel="preload"". web-features `link-rel-preload` high 2023-07-26, `link-rel-dns-prefetch` low 2025-09-15 (Safari iOS 26). Small addition: for a `type=module` CMP script, use `rel=modulepreload` instead of `preload as=script`.

### Show notices as overlays, or reserve their space; never insert them above rendered content
- Verdict: verified
- Evidence: https://web.dev/articles/cookie-notice-best-practices (top-of-screen notices, "sticky footer or modal … 'overlay'", text blocks as LCP, large modals and bounce, late fonts).

### Self-host or service-worker-cache third-party consent scripts, and check their styling chain
- Verdict: verified
- Evidence: https://web.dev/articles/cookie-notice-best-practices ("Caching and serving third-party cookie notice scripts from your own servers"; "tend to load styling at the end of long request chains").

### Test each consent state and each cache state; trust RUM over lab data
- Verdict: verified
- Evidence: https://web.dev/articles/cookie-notice-best-practices (tab-delimited WebPageTest script `combineSteps` / `navigate %URL%` / `clickAndWait id=cookieButton`; `--extra-headers`; "PageSeed Insights cannot be configured to set particular cookies"; "Cookie usage is not a technical requirement for performance measurement").

### Never deliver UX-critical resources through a tag manager
- Verdict: verified
- Evidence: https://web.dev/articles/tag-best-practices (resources requested with a tag manager load later).

### Prefer pixels, then sandboxed templates; limit Custom HTML tags
- Verdict: verified
- Evidence: https://web.dev/articles/tag-best-practices (pixels "less than 1 KB", `<noscript>` pixel, `injectScript`, "top of the `<head>`", `gtm.allowlist` / `gtm.blocklist: ['customScripts']`).

### Send fire-and-forget telemetry with sendBeacon or fetch keepalive on `visibilitychange`/`pagehide`, never on `unload`
- Verdict: corrected
- Correction: Status: sendBeacon ("Beacons") became Baseline newly available on 2018-04-12 and widely available on 2020-10-12. It was not "widely available (2018)". `Request.keepalive` is Baseline 2024 (newly available; MDN banner). Its versions (Chrome 66, Edge 15, Safari 13, Firefox 133) are verified. The unload rollout plan is verified: Chrome 146 (2026-03-10, 1%) to Chrome 154 (2026-09-22, 100%). As of today, Chrome 154 is stable, so the 100% step is live by plan. The 64 KiB in-flight quota per fetch group is verified in fetch.bs (`inflightKeepaliveBytes` … "greater than 64 kibibytes, then return a network error").
- Evidence: web-features `beacons` (low 2018-04-12, high 2020-10-12). https://developer.mozilla.org/en-US/docs/Web/API/Request/keepalive. https://developer.chrome.com/docs/web-platform/deprecating-unload (updated 2026-07-14). https://fetch.spec.whatwg.org/. https://web.dev/articles/tag-best-practices ("in Chromium browsers, `sendBeacon()` is now built upon `fetch() keepalive`").

### Fire non-essential tags late, on narrow triggers, with few variables
- Verdict: corrected
- Correction: The example comment says "fire marketing tags only after the app has painted and gone idle". `requestAnimationFrame(() => setTimeout(…, 0))` runs after the next frame, not when the main thread is idle. Either change the comment to "after the next paint", or use `requestIdleCallback` with a `setTimeout` fallback (not in Safari) for "idle". The article's own custom-event example fires after 2 s. The rest is verified ("fire non-essential tags after `Window Loaded`"; variables "continually evaluated").
- Evidence: https://web.dev/articles/tag-best-practices

### Keep the tag container lean and governed
- Verdict: verified
- Evidence: https://web.dev/articles/tag-best-practices (the article gives a 300 KB limit, 70% warning, ~50 KB median, "around 33 KB compressed"). "Pausing or removing a tag removes the code from the container; blocking does not." https://support.google.com/tagmanager/answer/2772488 states only "If the Size indicator value is above 70%…" with no KB value. Third-party sources say 200 KB (https://www.analyticsmania.com/post/google-tag-manager-limits/). The notes correctly mark the number as unconfirmed.

### Measure tags in isolation, not in Preview mode
- Verdict: verified
- Evidence: https://web.dev/articles/tag-best-practices (Preview mode overhead; empty page with a single-tag container; GTM Monitoring API).

### Put slides in the initial HTML, not injected by JavaScript
- Verdict: verified
- Evidence: https://web.dev/articles/carousel-best-practices ("probably the single biggest performance mistake"; "consider loading the first slide statically, then progressively enhancing"). web-features `fetch-priority` low 2024-10-29. The note that "a single static image can work as well" on short-visit pages is not in the article. It is harmless advice with no source.

### Animate slide transitions with `transform`, never with `left`/`top`/`width`/`margin`
- Verdict: verified
- Evidence: https://web.dev/articles/carousel-best-practices ("`left`, `top`, `width`, and `marginTop` … instead use the CSS `transform`"; "Chrome 88-90 shipped a variety of bug fixes"). The Lighthouse 13 blog says "non-composited-animations and unsized-images still remaining as a separate diagnostic audit". Both are in the 13.5 config.

### Keep all auto-advancing slide images at the same intrinsic size
- Verdict: verified
- Evidence: https://web.dev/articles/carousel-best-practices ("visible size or the intrinsic size, whichever is smaller"; Chrome 88 removed-element change). https://web.dev/articles/lcp ("stop reporting new entries as soon as the user interacts … (via a tap, scroll, or keypress)"). web-features `largest-contentful-paint` low 2025-12-12. BCD: Firefox 122, Safari 26.2.

### Build carousels with CSS scroll snap before you reach for a JS library
- Verdict: verified
- Evidence: https://developer.chrome.com/blog/carousels-with-css (published 2025-03-20: "The performance of a CSS carousel is better than any JavaScript solution"; "No hydration"). BCD 8.1.2: `::scroll-button`, `::scroll-marker`, `::scroll-marker-group`, `:target-current` are Chrome 135 only and experimental. web-features `scroll-snap` high 2022-07-15. Chrome 121 horizontal thresholds: https://chrome.dev/horizontal-lazy-loading/ and the carousel article. Nuance on `overscroll-behavior`: web-features gives no Baseline status because the full behavior (non-scrollable containers) shipped only in Chrome 144 and Firefox 150. On a scrollable carousel it has worked since Chrome 63, Firefox 59 and Safari 16 (BCD "partial" notes). So "enhancement" is safe, and it works in all three engines for this use.

### Do not autoplay; if you must, pause on hover and time each slide by its text length
- Verdict: verified
- Evidence: https://web.dev/articles/carousel-best-practices ("autoplay should be disabled on user hover … the more text that a slide contains, the longer it should be displayed").

---

## 16-explore-fast-batch-06.md

### Fail the build on assertion errors: never swallow the lhci exit code
- Verdict: verified
- Evidence: https://web.dev/articles/lighthouse-ci (lines with `|| echo "LHCI failed!"`, `@lhci/cli@0.3.x`, `checkout@v1`, Node 10.x, "seven days"). https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md ("Levels": `warn` … "will not result in a non-zero exit code"; `error` … "will result in a non-zero exit code"; `failOnUploadFailure`; `healthcheck --fatal`). npm: `@lhci/cli` latest 0.15.1, published 2025-06-25T23:52Z. Last main commit is 2025-06-26.

### Audit the production build that LHCI serves, not a dev server
- Verdict: verified
- Evidence: LHCI configuration.md (config file names and "upward traversal is not supported"; `startServerReadyPattern` default "listen|ready"; `startServerReadyTimeout` default 10000; `maxAutodiscoverUrls` 5; `staticDirFileDiscoveryDepth` 2; dist/build/out/public order; `serve:lhci`; `isSinglePageApplication`; the port is replaced in `url` with `staticDistDir`).

### Collect at least 3 runs (5 for metric gates) and choose the aggregation method for each assertion
- Verdict: verified
- Evidence: LHCI configuration.md (`numberOfRuns` default 3; the four aggregation methods; docs default `{"aggregationMethod": "optimistic", "minScore": 1}`). `packages/utils/src/assertions.js` line 179: `minScore === undefined && !hadManualAssertion ? 0.9`. `representative-runs.js` uses the squared distance to the median `first-contentful-paint` and `interactive`. https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md ("The median Lighthouse score of 5 runs is twice as stable as 1 run").

### Assert facts (bytes, request counts) before conclusions (scores, TTI)
- Verdict: verified
- Evidence: LHCI troubleshooting.md ("Assert facts over conclusions"). `assertions.js` lines 312-318: the `size` key is read first, and `transferSize` is the fallback. Lighthouse `resource-summary` items have only `requestCount` and `transferSize`, so `transferSize` is used. `budgets-converter.js` multiplies by 1024. configuration.md: `budgetsFile` "cannot be used in conjunction with any other assert option". Lighthouse changelog 12.0.0 (2024-04-22) "remove budgets". Resource types come from `core/computed/resource-summary.js`.

### Emit User Timing marks at app milestones and assert them in CI
- Verdict: verified
- Evidence: `assertions.js` lines 327-336 (kebabCase with `alphanumericOnly`, `find` returns the first match, `duration` else `startTime`). Lighthouse `core/audits/user-timings.js` sorts measures before marks and then by `startTime`, and drops names that start with `goog_`. So when a mark and a measure share a name, the measure's duration is used. `core/config/constants.js`: `pauseAfterLoadMs`/`networkQuietThresholdMs`/`cpuQuietThresholdMs` 1000, `maxWaitForLoad` 45000, `nonSimulatedSettingsOverrides` 5250 (applied in `config.js` `overrideThrottlingWindows` when `throttlingMethod !== 'simulate'`). The MDN `Performance.mark` banner says "available across browsers since September 2017".

### Give each route class its own thresholds with assertMatrix
- Verdict: verified
- Evidence: `assertions.js` line 287 `new RegExp(pattern).test(lhr.finalUrl)`. Add from the same file (lines 460-465): `assertMatrix` throws "Cannot use assertMatrix with other options" when combined with `assertions`, `preset`, `budgetsFile` or `aggregationMethod`. So a preset must be repeated inside each matrix entry.

### Start from lighthouse:recommended and burn down failures; do not start from lighthouse:all
- Verdict: corrected
- Correction: "Performance metrics only warn" is not complete. In `presets/all.js`, `total-blocking-time` and `interaction-to-next-paint` are `off` (under "Not useful or invisible diagnostic audits"), and `recommended.js` does not turn them back on. So neither preset gates TBT. The metrics at `warn` are FCP, LCP, CLS, SI, TTI, max-potential-fid and FMP. The docs say "perfect score", but a bare `['error', {}]` uses `minScore` 0.9 in code. That is the same as perfect for binary audits, but not for fractional ones. The preset also lists Lighthouse 12 insight IDs (`lcp-phases-insight`, `interaction-to-next-paint-insight`). The rest is verified (`maxLength: 0` opportunities; `cache-insight`, `render-blocking-insight`, `dom-size-insight` at warn; the `no-pwa` TODO).
- Evidence: https://github.com/GoogleChrome/lighthouse-ci/blob/main/packages/utils/src/presets/all.js (lines 20-40, 103, 111). `recommended.js`, `no-pwa.js`. configuration.md lines 815-817.

### Pin the Lighthouse version and key assertions only to audit IDs that exist in it
- Verdict: corrected
- Correction: (1) "the `*-insight` audits" are not all shared between 12.6 and 13.5. Lighthouse 12.6.1 has `lcp-phases-insight` and `interaction-to-next-paint-insight`. Lighthouse 13.0.0+ renamed them to `lcp-breakdown-insight` and `inp-breakdown-insight`. Shared insight IDs include `cache-insight`, `cls-culprits-insight`, `document-latency-insight`, `dom-size-insight`, `image-delivery-insight`, `lcp-discovery-insight`, `network-dependency-tree-insight`, `render-blocking-insight` and `third-parties-insight`. (2) The blog's replacement table is not the full truth. `layout-shifts`, `redirects` and `server-response-time` are still in the 13.0.0 and 13.5.0 `default-config.js` (hidden group). This supports the notes' advice to trust `default-config.js`. (3) Date: the changelog gives 13.5.0 as 2026-09-17, and npm shows publication at 2026-09-18T14:13Z. The notes use both dates. It ships in Chrome 156 DevTools (changelog).
- Evidence: https://raw.githubusercontent.com/GoogleChrome/lighthouse/v12.6.1/core/config/default-config.js (lines 314-330, 416-431). https://github.com/GoogleChrome/lighthouse/blob/main/core/config/default-config.js (lines 197, 313-328, 473-475). https://developer.chrome.com/blog/lighthouse-13-0. https://registry.npmjs.org/lighthouse (engines `>=22.19` for 13.x, `>=18.20` for 12.6.1).

### Match Lighthouse emulation to the product: use the desktop preset for a desktop trading terminal
- Verdict: verified
- Evidence: Lighthouse `core/config/constants.js` (moto g power 412x823, DPR 1.75; desktop 1350x940, DPR 1). `desktop-config.js` (`desktopDense4G`). docs/throttling.md ("Latency: 150ms", "1.6Mbps down / 750 Kbps up", "a constant 4x CPU multiplier"). LHCI troubleshooting.md (desktop "changes throttling too").

### Stabilize the lab: dedicated runners, one run per machine, third parties blocked, CPU calibrated
- Verdict: verified
- Evidence: https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md ("Minimum 2 dedicated cores (4 recommended)", "Minimum 2GB RAM (4-8GB recommended)", m5.large / n2-standard-2 / D2, "scaling horizontally is better than scaling vertically"). docs/throttling.md (benchmarkIndex, the 4x multiplier moves a high-end desktop "into the mid-tier mobile bracket").

### Make GPU-rendered (WebGL/WebGPU) pages measurable in CI on purpose, and handle context loss in code
- Verdict: verified
- Evidence: https://chromestatus.com/feature/5166674414927872 ("Remove SwiftShader fallback", status Deprecated, desktop 139, Firefox and Safari "No signal"). https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md ("Chromium and other browsers do not guarantee WebGL availability"). Lighthouse `constants.js` `clearStorageTypes: ['file_systems', 'shader_cache', 'service_workers', 'cache_storage']`. LHCI configuration.md line 1208 `"chromeFlags": "--disable-gpu --no-sandbox"`.

### Test interactions with Lighthouse user flows (timespan mode); LHCI only tests cold navigations
- Verdict: verified
- Evidence: https://github.com/GoogleChrome/lighthouse/blob/main/docs/user-flows.md (v9.6.0; timespan "Does not provide an overall performance score", "Cannot analyze moment-based performance metrics"). Useful addition from `core/config/config.js` lines 184-188: in timespan mode, `throttlingMethod: 'simulate'` is changed to `devtools`. So timespan numbers are observed values with applied throttling and 5250 ms quiet windows.

### Keep reports of a private or financial app off public storage
- Verdict: corrected
- Correction: The LHCI server security wording is wrong. Default access: anyone with HTTP access can view projects and builds and create new projects. Uploading builds needs the build token, which the docs say to treat as public for open-source projects. Editing or deleting needs the admin token. The notes say "anyone with HTTP access can view data and create builds". The Eris Ventures LLC operator, "considered public information", and "3 days to 5 weeks" are verified.
- Evidence: https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/server.md#security (lines 70-85: "The _build token_ allows a user to _upload new data_"; "listing projects, viewing project and build data, and creating new projects are open to anyone with HTTP access"). https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/services-disclaimer.md

### Track history and commit diffs, and give LHCI the git context it needs
- Verdict: verified
- Evidence: LHCI troubleshooting.md ("Ancestor hash not determinable", `fetch-depth: 20`, base_ref fetch, `git commit --allow-empty`). getting-started.md (`ref: ${{ github.event.pull_request.head.sha }}`; "only run `lhci autorun` _ONCE_ per build"). configuration.md (`urlReplacementPatterns` "you will lose the defaults"; `isRepresentativeRun`; `deleteOldBuildsCron`). "The docs call it best for teams that manage their own infrastructure" is a paraphrase with no source. The docs only say the setup "will vary depending on your specific infrastructure setup". Also note that server.md still lists "Node v16 LTS" as a server requirement, which is outdated.

### Test authenticated pages with a login script or headers, and keep cold-load semantics
- Verdict: verified
- Evidence: LHCI configuration.md (puppeteerScript flow runs the script before each URL; "browser is kept open across all URLs"; `disableStorageReset` for localStorage; `extraHeaders` example; reserved settings `port`, `auditMode`, `gatherMode`, `output`, `outputPath`, `channel`, `cli-flags-path`; Puppeteer "v1.x or v2.x" wording). Lighthouse `constants.js` `disableStorageReset: false`.

### Monitor public production URLs with the PSI runner to get the current Lighthouse
- Verdict: corrected
- Correction: Add a caveat. With `method: 'psi'` the report comes from Lighthouse 13.x. The LHCI presets (`all`, `recommended`, `no-pwa`) still assert audit IDs that 13.0 removed (`offscreen-images`, `uses-rel-preconnect`, `uses-optimized-images`, `uses-responsive-images`, `uses-text-compression`, `efficient-animated-content`, `render-blocking-resources`, `uses-long-cache-ttl`, `lcp-phases-insight`, and others). `getStandardAssertionResults` fails any assertion whose audit is missing (`auditRan`), and nothing skips preset keys. So a PSI run with a preset gives false `error` failures. Use explicit assertions on 13.x IDs, or turn those keys `off`. The rest is verified: "no other collection options will be respected"; `psiStrategy`/`psiApiKey`/`psiCollectCron` exist; the changelog says releases reach PSI "within 2 weeks".
- Evidence: `packages/utils/src/assertions.js` lines 138-155 and 355-400. `presets/all.js` and `recommended.js`. https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md#method. https://github.com/GoogleChrome/lighthouse/blob/main/changelog.md

### Update the article's CI recipe versions before you copy it
- Verdict: verified
- Evidence: GitHub releases API: actions/checkout v7.0.1 (2026-07-20), actions/setup-node v7.0.0 (2026-07-14), treosh/lighthouse-ci-action 12.6.2 (2026-03-12, `@lhci/cli ^0.15.1`, runs on `node24`). https://github.com/nodejs/Release/blob/main/schedule.json: v18 end 2025-04-30, v20 end 2026-04-30, v22 end 2027-04-30, v24 end 2028-04-30 (maintenance from 2026-10-20). Note: Node 26 becomes LTS on 2026-10-28, so "LTS lines are 22 and 24" changes in one month.

---

## Cross-file conflicts

1. Preconnect idle timeout. 16-explore-fast-batch-05.md:56 ("within about 10 s") conflicts with 15-gaps-round-2.md:16-28 ("about 60 s in Chromium", with a source-code citation). 15-gaps-round-2 is correct (`kPreconnectIntervalSec = 60`). 02-course-loading.md:497 and 04-html-and-http-loading-features.md:118 also still say 10 s.
2. Safari and AVIF in `Accept`. 16-explore-fast-batch-05.md:67 says Safari omits `image/avif`. 02-course-loading.md:788-797 negotiates AVIF from `Accept` and calls it "universal". WebKit source supports 02 (Safari 16+ on macOS 13+/iOS 16+ sends `image/avif`).
3. Lighthouse 13 cache insight ID. 16-explore-fast-batch-04.md:245 and :429 use `use-cache-insight` (the ID printed in the "moving to insights" blog). The real audit ID in both 12.6.1 and 13.5.0 `default-config.js` is `cache-insight`. 16-explore-fast-batch-06.md:198 has it right.
4. Lighthouse 13 INP insight ID. 16-explore-fast-batch-03.md:412 says "Lighthouse 13 `interaction-to-next-paint-insight` replaced `work-during-interaction`". In 13.x the ID is `inp-breakdown-insight`. `interaction-to-next-paint-insight` is the 12.x ID. 16-explore-fast-batch-06.md:198 has the 13.x ID right, but see the correction above about 12.6.1.
5. Audits that "became" insights but still exist. 16-explore-fast-batch-05.md:642 ("`layout-shifts` became `cls-culprits-insight`"), 16-explore-fast-batch-03.md:252 ("merged `layout-shifts` into `cls-culprits-insight`") and 16-explore-fast-batch-04.md:245 ("`redirects`, `server-response-time` … became `document-latency-insight`") all follow the Lighthouse 13 blog. The 13.0.0 and 13.5.0 `default-config.js` still register `layout-shifts`, `redirects` and `server-response-time` as hidden audits, so assertions on them still resolve.
6. Non-composited animations. 16-explore-fast-batch-02.md:357 says Lighthouse 13 "folded 'Avoid non-composited animations' into `cls-culprits-insight`". The Lighthouse 13 blog says "non-composited-animations and unsized-images still remaining as a separate diagnostic audit". 16-explore-fast-batch-05.md:580 and 05-css-rendering.md:94 are correct.
7. Facade audit. 16-explore-fast-batch-05.md:201 says no tool flags missing facades after Lighthouse 13. 16-explore-fast-batch-06.md says LHCI 0.15.1 runs Lighthouse 12.6.1, which still has `third-party-facades`.
8. LHCI maintenance state and date. 16-explore-fast-index.md:158 says the tool "is still maintained (GitHub release v0.15.1, 2025-06-26)". 16-explore-fast-batch-06.md:47 says "treat LHCI as maintenance-mode" (0.15.1 on 2025-06-25; no main commits since 2025-06-26). The dates differ only by time zone (npm 2025-06-25T23:52Z; commit 2025-06-26T00:01Z). The "maintained" wording conflicts with the evidence of no main-branch commits in 15 months.

## Missing but important

1. Scroll anchoring for lists that grow above the viewport ("load older trades", chat and log history). `overflow-anchor` became Baseline newly available on 2026-09-14 with Safari 27. Before Safari 27, Safari needs manual `scrollTop` compensation. Sources: web-features `overflow-anchor`; https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow-anchor (05-css-rendering.md:840 covers the CSS side, but the long-list section does not).
2. `contain-intrinsic-size: auto <length>` together with `content-visibility: auto`. The `auto` keyword remembers the last rendered size, so off-screen rows keep their real height and the scrollbar does not jump. Source: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/contain-intrinsic-size
3. Normalize the image-CDN cache key when you send `Vary: Accept`: map raw Accept strings to avif, webp or other before the cache lookup. Source: https://www.fastly.com/blog/best-practices-using-vary-header
4. Client Hints to a cross-origin image CDN need delegation. `Accept-CH` alone does not send `Sec-CH-DPR`/`Sec-CH-Width` to a third-party origin. The page must also send `Permissions-Policy: ch-dpr=(self "https://img.example.com")` or use an Accept-CH meta with delegation. This is Chromium only. Sources: https://wicg.github.io/client-hints-infrastructure/ ; https://css-tricks.com/3-steps-to-enable-client-hints-on-your-image-cdn/
5. `sizes="auto"` on `loading="lazy"` images that use an image-CDN `srcset`, so the browser picks from the laid-out width. It is not Baseline: Chrome 126 and Firefox 150, no Safari. Keep an explicit `sizes` fallback after `auto`. Source: web-features `sizes-auto`.
6. Long Animation Frames (LoAF) script attribution (`scripts[].sourceURL`, `invoker`) to prove which CMP or tag script made a consent click or tag fire slow in the field. It is Chrome 123+ only and not Baseline. Source: https://developer.chrome.com/docs/web-platform/long-animation-frames
7. The web-vitals attribution build (`web-vitals/attribution`) to find the element and script behind consent-banner CLS and INP in RUM, alongside the "cookie-free RUM" advice. Source: https://github.com/GoogleChrome/web-vitals (README "attribution build").
8. `loading="lazy"` on `<video>` and `<audio>` embeds is new: Chrome 150 only, not Baseline. Do not rely on it. Use the facade pattern or `preload="none"`. Source: web-features `loading-lazy-media`.
9. For LHCI on a streaming terminal: stub or mock the live WebSocket/SSE feed and the continuous render loop in the CI build. Lighthouse waits for 1 s network and CPU quiet windows (5250 ms with devtools throttling), up to `maxWaitForLoad` 45 s. A page that never goes quiet gives slow and noisy runs. This is an inference from `constants.js` plus the "page nondeterminism" section of variability.md. Sources: https://github.com/GoogleChrome/lighthouse/blob/main/core/config/constants.js ; https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md
10. Assert TBT explicitly in LHCI. Neither `lighthouse:recommended` nor `lighthouse:all` asserts `total-blocking-time` (it is `off` in `all.js`). A TBT gate for main-thread regressions must be added by hand, for example `'total-blocking-time': ['error', {maxNumericValue: 200, aggregationMethod: 'median'}]`. Source: https://github.com/GoogleChrome/lighthouse-ci/blob/main/packages/utils/src/presets/all.js
