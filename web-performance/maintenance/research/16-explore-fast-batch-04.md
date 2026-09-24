# web.dev "Fast" collection, batch 4 of 6: measurement workflow, text encoding, CDNs

Scope: eight web.dev articles from https://web.dev/explore/fast. Six are about measurement (Web Vitals, user-centric metrics, RUM vs CrUX, lab vs field, Google tools workflow). Two are about transfer (text compression and minification, CDNs).
The levers that change how code is written are: how RUM code is instrumented, which headers the server and CDN send, how assets are built and compressed, and how lab tests are set up.
Status checked on 2026-09-23 against MDN browser-compat-data (main branch), webstatus.dev API, npm registry, RFCs and Chrome docs. Raw pages are saved in `raw/fast-batch-4/`.

## Article index (date, and what is outdated today)

| Article | Date | Outdated or changed since publish (checked 2026-09) |
|---|---|---|
| [Web Vitals](https://web.dev/articles/vitals) | Pub 2020-05-04, upd 2024-10-31 | Current. Its beacon code (`sendBeacon` or `fetch` with `keepalive`) still works. The web-vitals README now uses only `sendBeacon`. |
| [User-centric performance metrics](https://web.dev/articles/user-centric-performance-metrics) | 2023-08-02 | Mostly current. The Long Tasks API is still Chromium-only and experimental. LoAF is still Chromium-only. |
| [Getting started with measuring Web Vitals](https://web.dev/articles/vitals-measurement-getting-started) | 2025-09-09 | It says web-vitals is "~2KB". The README now says about 3K brotli, plus about 1.5K for the attribution build. It lists CrUX Vis twice. CrUX Dashboard was retired after November 2025. |
| [Why is CrUX data different from my RUM data?](https://web.dev/articles/crux-and-rum-differences) | Pub 2022-08-15, upd 2025-12-17 | It says soft navigations are "work underway". Soft navigation entries shipped in Chrome 151 (webstatus: 2026-07-28), and web-vitals v6 (2026-07-21) supports them. |
| [Why lab and field data can be different](https://web.dev/articles/lab-and-field-data-differences) | 2022-07-18 | It still says "FID" in the INP section. It mentions AMP and Signed Exchanges preloading: Cloudflare removed SXG support from 2025-10-20, and Google Search docs removed SXG references on 2026-07-01. |
| [Core Web Vitals workflows with Google tools](https://web.dev/articles/vitals-tools) | Pub 2020-05-28, upd 2025-02-28 | It still mentions FID. Chrome tools and CrUX dropped FID on 2024-09-09. Lighthouse 13 (2025-10-10) replaced most audits with "insights". |
| [Optimize the encoding and transfer size of text-based assets](https://web.dev/articles/optimizing-content-efficiency-optimize-encoding-and-transfer) | 2023-12-11 | It covers only gzip and Brotli. zstd became Baseline 2026 (Safari 26.3, 2026-02-11). Compression Dictionary Transport (`dcb`/`dcz`) exists in Chromium 130+. |
| [Content delivery networks (CDNs)](https://web.dev/articles/content-delivery-networks) | 2023-12-05 (text from about 2020) | It says HTTP/3 "isn't fully standardized". HTTP/3 is RFC 9114 (2022) and Baseline 2024. The RFC 7540 HTTP/2 priority tree is deprecated by RFC 9113. The ishttp2fastyet.com link is dated. `immutable` is still not in Chromium, so the article is still right on that point. |

---

## RUM instrumentation (JS that ships to users)

### Measure Core Web Vitals in the field with the web-vitals library, not hand-rolled observers
- Layer: js
- Stage: main-thread-task, idle
- Metrics: LCP, INP, CLS, FCP, TTFB
- When: load, long-lived session
- Impact: high, because only field data shows what real users get, and hand-rolled observers often get the metric rules wrong
- Do: Import `onLCP`, `onINP`, `onCLS` (and `onFCP`, `onTTFB` for diagnosis) from `web-vitals` v6. Use `web-vitals/attribution` when you need the cause, not just the number. Use `metric.rating`, and do not compute ratings yourself.
- Why: The metrics are built on lower-level APIs (for example, CLS uses the Layout Instability API with session windows). The library applies the same rules that CrUX and the Google tools use: bfcache restores, prerender, background tabs, and when to finalize the value.
- Example:
  ```ts
  // Before: raw observer. It misses session windows, bfcache and hidden-page rules.
  new PerformanceObserver(l => l.getEntries().forEach(e => cls += (e as any).value))
    .observe({ type: 'layout-shift', buffered: true });

  // After
  import { onCLS, onINP, onLCP } from 'web-vitals/attribution';
  onCLS(report); onINP(report); onLCP(report);
  ```
- Avoid/caveats: The standard build is about 3K brotli. The attribution build adds about 1.5K, so load it with low priority. `onFID` was removed in v5. `reportAllChanges` is only for debugging. It reports only when the metric value changes, not for every input.
- Status: web-vitals 6.2.2 (2026-09-14, npm). v5 (2025-05) removed `onFID`. v6 (2026-07-21) added soft navigations. Library code targets Baseline Widely available. `onCLS` works only in Chromium. `onLCP`, `onINP`, `onFCP` and `onTTFB` work in Chromium, Firefox and Safari (README "Browser Support").
- Sources: https://web.dev/articles/vitals, https://web.dev/articles/vitals-measurement-getting-started, https://github.com/GoogleChrome/web-vitals, https://raw.githubusercontent.com/GoogleChrome/web-vitals/main/CHANGELOG.md

### Queue metric reports and flush them in one beacon when the page becomes hidden
- Layer: js
- Stage: main-thread-task, network
- Metrics: INP, memory
- When: long-lived session
- Impact: medium, because it cuts beacon count to about one per visit and does not lose the final CLS or INP values
- Do: Put each metric in a queue keyed by `metric.id`. On `visibilitychange` with `document.visibilityState === 'hidden'`, send the whole queue with `navigator.sendBeacon`. Do not use `unload` or `beforeunload`. Send `id` and `delta` (or the last `value` per `id`) so the server can dedupe or sum.
- Why: CLS and INP keep changing until the page is hidden. The library reports them again each time the page becomes hidden and after a bfcache restore (with a new `id`). `sendBeacon` survives page teardown. Unload handlers are unreliable and can make the page ineligible for bfcache.
- Example:
  ```ts
  import { onCLS, onINP, onLCP, type Metric } from 'web-vitals';
  const pending = new Map<string, Metric>();
  const keep = (m: Metric) => pending.set(m.id, m);   // latest value wins per id
  onCLS(keep); onINP(keep); onLCP(keep);
  addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || pending.size === 0) return;
    navigator.sendBeacon('/rum', JSON.stringify([...pending.values()].map(m => ({
      name: m.name, value: m.value, id: m.id, rating: m.rating,
      nav: m.navigationType, url: m.navigationURL ?? location.href,
    }))));
    pending.clear();
  });
  ```
- Avoid/caveats: Do not `JSON.stringify` the whole `Metric`, because `entries` holds DOM references and makes large payloads. The server must keep the last value per `id`, because a later flush can resend a larger CLS for the same `id`. `fetchLater()` (deferred fetch that the browser sends on unload, on bfcache entry or after `activateAfter`, with a 64 KiB quota) is Chromium-only and experimental, so do not depend on it.
- Status: `sendBeacon` works in Chrome 39, Firefox 31 and Safari 11.1 (BCD). `fetchLater` is Chrome 135+ only, "limited" on webstatus.dev.
- Sources: https://github.com/GoogleChrome/web-vitals#batch-multiple-reports-together, https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater

### Register each web-vitals listener once per document, not per component mount or route
- Layer: js
- Stage: gc-memory, main-thread-task
- Metrics: memory, INP
- When: long-lived session
- Impact: medium, because repeated calls leak observers and listeners in a trading terminal that stays open for hours
- Do: Call `onCLS`/`onINP`/`onLCP` once, in the app bootstrap module. Do not call them in a component's mount hook or a route effect. To attribute metrics to SPA views, use `reportSoftNavs` and `metric.navigationURL`, not new registrations.
- Why: The README warns that each call creates a `PerformanceObserver` and event listeners that live as long as the page. Calling them many times grows memory.
- Avoid/caveats: v5.3+ lets you call `onINP()` more than once with different options on purpose, but keep this to a fixed small number.
- Status: web-vitals README (v6).
- Sources: https://github.com/GoogleChrome/web-vitals#basic-usage

### Measure SPA route changes as soft navigations and label each metric with its own URL
- Layer: js
- Stage: main-thread-task, paint
- Metrics: LCP, INP, CLS, FCP
- When: interaction, long-lived session
- Impact: high for SPAs, because without it all INP and CLS from hours of use go to the first URL
- Do: Use web-vitals v6 with `{ reportSoftNavs: true }`, and send `metric.navigationURL` and `metric.navigationId`, not `location.href`. To keep numbers comparable with CrUX, which does not report soft navigations yet, register a second set of callbacks without the flag. Make route changes follow the browser rule: user interaction, then a URL change through the History or Navigation API, then a visible paint.
- Why: From Chrome 151 the browser emits `soft-navigation` and `interaction-contentful-paint` entries. It resets CLS and INP at each soft navigation and reports TTFB as 0. Metrics can be reported after the URL has already changed, so `location.href` gives the wrong page.
- Example:
  ```ts
  import { onINP, onCLS, onLCP } from 'web-vitals';
  for (const on of [onINP, onCLS, onLCP]) {
    on(sendCrUXLike);                            // hard-navigation view, like CrUX
    on(sendPerRoute, { reportSoftNavs: true });  // per-route view on Chromium 151+
  }
  // in sendPerRoute: route = metric.navigationURL, kind = metric.navigationType ('soft-navigation' | ...)
  ```
- Avoid/caveats: The heuristic can give false positives, for example a URL change for a filter, and false negatives, for example a route change that paints nothing. The flag changes how the first page load is measured, because its metrics are finalized at the first soft navigation. Only elements that repaint after the navigation count for LCP, so persistent chrome is ignored. Firefox and Safari do not emit these entries. The CrUX treatment is "still to be determined".
- Status: Soft navigation entries shipped in Chrome/Edge 151 (webstatus.dev "limited", Chrome 2026-07-28). The Chrome doc was last updated 2026-09-02. web-vitals v6.0.0 (2026-07-21).
- Sources: https://developer.chrome.com/docs/web-platform/soft-navigations, https://web.dev/articles/crux-and-rum-differences, https://github.com/GoogleChrome/web-vitals#report-metrics-for-soft-navigations

### Add a custom "first chart frame" metric, because canvas and WebGL content is not an LCP candidate
- Layer: js / canvas2d / gpu
- Stage: gpu-draw, paint
- Metrics: LCP, FCP, startup
- When: load
- Impact: high for chart-first pages, because LCP and Element Timing cannot see the chart the user is waiting for
- Do: After the first frame with real data is drawn, call `performance.mark('chart:first-frame')` inside the next `requestAnimationFrame`. Then measure from `navigationStart` or from a `chart:init` mark, and send it with the Web Vitals beacon. Treat LCP on chart pages as the time of the largest text or image, not the chart.
- Why: The Paint Timing spec lists the timing-eligible elements for LCP and Element Timing: `img`, SVG `image`, video poster, CSS `background-image` and text. `canvas` is not in the list. But a `canvas` with a rendering context counts as contentful for FCP, so FCP can fire on an empty chart surface. The user-centric metrics article says custom metrics exist for pages where the largest element is not the main content.
- Example:
  ```ts
  performance.mark('chart:init');
  surface.renderedToDestination.subscribe(function once() {   // any first-draw hook
    surface.renderedToDestination.unsubscribe(once);
    requestAnimationFrame(() => {
      performance.mark('chart:first-frame');
      const m = performance.measure('chart:ttfc', { start: 0, end: 'chart:first-frame' });
      queueRum({ name: 'TTFC', value: m.duration });
    });
  });
  ```
- Avoid/caveats: Mark after data is drawn, not after the WebGL context is created. Do not add many marks in hot render loops, because each mark allocates an entry. Use only a fixed set of names. The SciChart hook name above is an example. Check the real API in the SciChart docs.
- Status: User Timing is Baseline widely available. Canvas is timing-ineligible per the W3C Paint Timing editor's draft (fetched 2026-09-23). Element Timing (`elementtiming`) is Chromium-only and experimental (BCD).
- Sources: https://web.dev/articles/user-centric-performance-metrics, https://w3c.github.io/paint-timing/, https://web.dev/articles/lcp, https://developer.mozilla.org/en-US/docs/Web/API/PerformanceElementTiming

### Send `Timing-Allow-Origin` on cross-origin assets that affect metrics
- Layer: network
- Stage: network, paint
- Metrics: LCP, TTFB
- When: load
- Impact: medium, because it makes RUM timings for CDN-hosted images, fonts, scripts and WASM accurate
- Do: On static-asset hosts (CDN subdomain, font host, WASM/JS host), send `Timing-Allow-Origin: https://app.example.com` (or `*` for public assets). Keep the LCP resource same-origin where you can.
- Why: Without TAO, the browser hides detailed Resource Timing fields, and older browsers gave only the load time (not the render time) for a cross-origin LCP image. That can make LCP look earlier than FCP. Chrome 133+ gives a coarsened render time without TAO, but TAO still gives the exact values and the Resource Timing detail.
- Example: `Timing-Allow-Origin: https://app.tradester.example`
- Avoid/caveats: TAO exposes timing to the named origins. Do not use `*` on responses that depend on the user.
- Status: TAO works in Chrome 54, Firefox 45 and Safari 11. The coarsened cross-origin LCP `renderTime` shipped in Chrome 133, Firefox 141 and Safari 26.2 (BCD).
- Sources: https://web.dev/articles/crux-and-rum-differences, https://web.dev/articles/lcp, https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Timing-Allow-Origin

### Expose backend and CDN phases with the `Server-Timing` header so RUM can split TTFB
- Layer: network
- Stage: network
- Metrics: TTFB, LCP
- When: load
- Impact: medium, because it turns a single TTFB number into "CDN miss + DB 120 ms", which you can act on
- Do: Add `Server-Timing` entries for cache status and the main backend phases on the document and on key API responses. In RUM, read `performance.getEntriesByType('navigation')[0].serverTiming` and send it with the metrics.
- Why: The user-centric metrics article lists Server Timing among the standard low-level APIs for custom metrics. TTFB is the first milestone of LCP, so you need the server-side breakdown to fix a slow TTFB.
- Example: `Server-Timing: cdn-cache;desc=MISS, db;dur=118, render;dur=22`
- Avoid/caveats: Do not put secrets or internal hostnames in `desc`. Cross-origin responses expose these values only with TAO. Keep the header small.
- Status: Baseline widely available (webstatus.dev: newly 2023-03-27, widely 2025-09-27).
- Sources: https://web.dev/articles/user-centric-performance-metrics, https://w3c.github.io/server-timing/

### Keep metric-critical content out of iframes, or instrument inside the iframe
- Layer: html / js
- Stage: paint, main-thread-task
- Metrics: LCP, INP, CLS
- When: load, interaction
- Impact: medium, because RUM cannot see iframe content (even same-origin), but CrUX can, so the two sources disagree
- Do: Render the main content (hero, chart, order ticket) in the top-level document. If you must use an iframe, load web-vitals inside it and `postMessage` the results to the parent for aggregation.
- Why: Page-level Web APIs have no access to iframe performance entries. CrUX is measured by the browser and does include iframes. On pages with iframes, `onCLS` in fact measures DCLS (document CLS).
- Avoid/caveats: Embedded video players in iframes can be the LCP element in CrUX while RUM never sees them.
- Status: Current limitation (web-vitals README, 2026).
- Sources: https://web.dev/articles/crux-and-rum-differences, https://github.com/GoogleChrome/web-vitals#limitations

### Count bfcache restores, prerenders and discard-restores as their own navigation types in RUM
- Layer: js
- Stage: network, paint
- Metrics: LCP, INP, CLS, TTFB
- When: load
- Impact: medium, because leaving out bfcache restores makes the RUM LCP worse than CrUX, and mixing prerenders in without a label hides real load costs
- Do: Send `metric.navigationType` (`navigate`, `reload`, `back-forward`, `back-forward-cache`, `prerender`, `restore`, `soft-navigation`) with every beacon and segment by it. Keep pages bfcache-eligible, so that returning users get near-instant loads that count in the field.
- Why: CrUX counts bfcache restores as page views, but the browser APIs do not treat them as loads. The library reports them again with new ids. Lab tools never see bfcache or warm caches. Pages loaded in a background tab are dropped by CrUX, and web-vitals does not report CLS, FCP or LCP for them.
- Avoid/caveats: Do not drop `back-forward-cache` rows as outliers. They are real user experience.
- Status: web-vitals v6 Metric interface (README).
- Sources: https://web.dev/articles/crux-and-rum-differences, https://web.dev/articles/lab-and-field-data-differences, https://github.com/GoogleChrome/web-vitals#metric

### Record the browser engine with each beacon, and compare with CrUX only on Chrome at p75 over 28 days
- Layer: tooling
- Stage: network
- Metrics: LCP, INP, CLS
- When: long-lived session, testing
- Impact: medium, because it prevents false alarms and wrong priorities when RUM and CrUX disagree
- Do: Tag each beacon with engine, device form factor (phone, tablet, desktop) and navigation type. To compare with CrUX, filter to Chrome on the same form factor, take the 75th percentile, and use a 28-day window. For your own goals, report the share of "good" visits, not the median.
- Why: CrUX is opted-in Chrome users only (no iOS Chrome, no Android WebView, but it includes Custom Tabs). It uses a 28-day sliding window at p75. CLS exists only in Chromium. Firefox and Safari measure LCP and INP to `paintTime`, while Chrome measures to `presentationTime`, which gives small differences. The median hides the slow tail.
- Avoid/caveats: Very short RUM windows are noisy. Consent banners can remove first visits (cold cache) from RUM, which makes RUM look faster than reality. Choose a sample rate that stays representative.
- Status: LCP and Event Timing (INP) are Baseline 2025 (Safari 26.2, 2025-12-12). Layout Instability is Chromium-only (webstatus "limited"). `LargestContentfulPaint.paintTime` exists in Chrome 145+, Firefox 140 and Safari 26.2 (BCD).
- Sources: https://web.dev/articles/crux-and-rum-differences, https://web.dev/articles/vitals-measurement-getting-started, https://web.dev/blog/lcp-and-inp-are-now-baseline-newly-available

---

## Lab testing setup

### Test INP-sensitive flows with real or scripted interactions, not only TBT
- Layer: tooling
- Stage: main-thread-task
- Metrics: INP, TBT
- When: testing
- Impact: high, because TBT does not see user timing, tap delay or long interactions after load, so a page can pass TBT and fail INP
- Do: Use TBT as a load-time proxy only. For key interactions (order entry, symbol switch, chart zoom), script them with Lighthouse user flows or Puppeteer, or use the DevTools Performance panel live metrics while you interact. Record a trace for any slow one.
- Why: INP measures when users actually interact, over the whole page life. TBT counts only long-task time between FCP and TTI. A 300 ms tap delay is not a long task, so TBT misses it.
- Avoid/caveats: Lab INP from one scripted run is one sample, not a p75.
- Status: Lighthouse 13.5.0 (2026-09-18). DevTools live metrics is current (vitals-tools, 2025).
- Sources: https://web.dev/articles/lab-and-field-data-differences, https://web.dev/articles/vitals-tools

### Declare a mobile viewport so taps have no 300 ms delay
- Layer: html
- Stage: main-thread-task
- Metrics: INP
- When: interaction
- Impact: high on mobile, because a delay of about 300 ms alone uses more than the 200 ms INP budget
- Do: Always ship `<meta name="viewport" content="width=device-width, initial-scale=1">`. For controls that need fast repeated taps, you can also set `touch-action: manipulation`. Do not turn off pinch-zoom (`user-scalable=no`), because it is an accessibility feature.
- Why: Without a mobile viewport, the browser waits to check for a double-tap zoom before it fires `click`. That wait counts in INP but not in TBT.
- Example:
  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>.order-buttons button { touch-action: manipulation; }</style>
  ```
- Avoid/caveats: The Chrome blog (2013, updated to 2016) says Safari does not support `touch-action`. This is outdated.
- Status: The viewport fix works from Chrome 32 and iOS 9.3. `touch-action: manipulation` is Baseline widely available (webstatus: newly 2019-09-19, widely 2022-03-19; Safari 13, iOS 9.3).
- Sources: https://web.dev/articles/lab-and-field-data-differences, https://developer.chrome.com/blog/300ms-tap-delay-gone-away

### Test many states in the lab: warm and cold cache, several viewports, deep links, logged-in and personalized views
- Layer: tooling
- Stage: network, layout, paint
- Metrics: LCP, CLS
- When: testing
- Impact: medium, because a single cold-load run of the base URL on one emulated phone shows a different LCP element and different shifts than users get
- Do: Run each key page at more than one viewport size, with warm and cold cache, with a `#fragment` or text-fragment deep link, and as logged-in, personalized and A/B variants. For CLS, scroll and interact after load. Lab tools that only load the page miss shifts from lazy content without dimensions and from late personalized inserts.
- Why: The LCP element depends on screen size, installed fonts, personalization, A/B tests and the scroll position from fragments. In the field, LCP stops at the first input. Lab LCP waits for full load. Cache and bfcache make field CLS and LCP better than the lab.
- Avoid/caveats: Do not "fix" the lab LCP element if field attribution (`attribution.target`) shows users get a different element.
- Status: Current.
- Sources: https://web.dev/articles/lab-and-field-data-differences, https://web.dev/articles/vitals-measurement-getting-started

### Gate CI on Lighthouse audits (lint-style), not on raw timings, and pin the Lighthouse version
- Layer: tooling
- Stage: network, main-thread-task
- Metrics: LCP, CLS, TBT, bundle-size
- When: build, testing
- Impact: medium, because it catches regressions before release, and most performance gains regress within about six months (Google research cited in vitals-tools)
- Do: Run Lighthouse CI on each PR and assert on audit or insight pass and fail (render-blocking, cache TTL, text compression, image delivery) and on budgets. Use timing assertions only with multiple runs and a tolerance. Also run Lighthouse and traces locally. CI alone misses issues.
- Why: Timings vary from run to run. Audits are deterministic signals of bad practice. The Lighthouse performance score often does not correlate with field CWV.
- Avoid/caveats: `@lhci/cli` 0.15.1 (2025-06-25) still bundles Lighthouse 12.6.1, which has the old audit IDs. Lighthouse 13 renamed or removed many of them, for example `uses-long-cache-ttl` became `use-cache-insight`, `render-blocking-resources` became `render-blocking-insight`, and `redirects`, `server-response-time` and `uses-text-compression` became `document-latency-insight`. Update the assertion keys when you upgrade.
- Status: Lighthouse 13.0 was released 2025-10-10. Lighthouse 13.5.0 is from 2026-09-18 (npm).
- Sources: https://web.dev/articles/vitals-tools, https://developer.chrome.com/blog/lighthouse-13-0, https://github.com/GoogleChrome/lighthouse-ci

---

## Text encoding and compression (build and server)

### Pre-compress static text assets at build time with maximum settings, and compress dynamic responses at mid settings
- Layer: build / network
- Stage: network
- Metrics: LCP, FCP, TTFB, bundle-size
- When: build, load
- Impact: high, because Brotli or gzip removes 65–86% of JS library bytes (article table, max levels)
- Do: At build time, write `.br` (Brotli 11) and, if the server supports it, `.gz` (gzip 9) and `.zst` next to each hashed JS, CSS, HTML, SVG, JSON and WASM file, and serve them by `Accept-Encoding`. For responses made per request, use Brotli about 4–5, zstd about 12, or gzip 6. Prefer Brotli over gzip when both are available.
- Why: Higher levels cost much more CPU. Pre-compressing moves that cost to build time. Mid levels keep TTFB low for dynamic responses. The CDN article recommends Brotli-4 at the origin for dynamic content and Brotli-11 for static. A blog benchmark (Paul Calvano, 2024) found Brotli 11 about 19% smaller than gzip 6, and zstd 19 about 14% smaller.
- Example:
  ```bash
  # build step
  find dist -regex '.*\.\(js\|css\|html\|svg\|json\|wasm\)' -size +1k \
    -exec brotli -q 11 -k {} \; -exec gzip -9 -k {} \;
  ```
- Avoid/caveats: Minification and compression add up. Compression does not replace minification. The zstd level numbers come only from a blog.
- Status: Brotli is Baseline widely available (since 2020-03).
- Sources: https://web.dev/articles/optimizing-content-efficiency-optimize-encoding-and-transfer, https://web.dev/articles/content-delivery-networks, https://paulcalvano.com/2024-03-19-choosing-between-gzip-brotli-and-zstandard-compression/

### Offer zstd for dynamically compressed responses
- Layer: network
- Stage: network
- Metrics: TTFB, LCP
- When: load
- Impact: medium, because it gives about Brotli-5 size at lower CPU cost for per-request compression (blog data)
- Do: Where the server or CDN supports `zstd`, enable it for dynamic HTML and API JSON, and keep Brotli for pre-compressed static files. Always send `Vary: Accept-Encoding`.
- Why: zstd compresses faster than Brotli at similar ratios for on-the-fly work. At the highest levels Brotli still wins on size.
- Avoid/caveats: CDN support for zstd varies. The web.dev article (2023) does not mention zstd.
- Status: Baseline newly available since 2026-02-11. Chrome 123 (2024-03), Firefox 126 (2024-05), Safari 26.3 (webstatus.dev, BCD).
- Sources: https://api.webstatus.dev/v1/features/zstd, https://paulcalvano.com/2024-03-19-choosing-between-gzip-brotli-and-zstandard-compression/

### Do not compress already-compressed or tiny responses
- Layer: network
- Stage: network
- Metrics: TTFB
- When: load
- Impact: low, because it saves CPU and avoids small size increases
- Do: Skip content encoding for JPEG, PNG, WebP, AVIF, WOFF2 and video. Set a minimum size threshold on the server (the article says this is usually a few KB or less).
- Why: Data that is already compressed gains nothing. For very small bodies, the compression overhead can be larger than the saving.
- Status: Current.
- Sources: https://web.dev/articles/optimizing-content-efficiency-optimize-encoding-and-transfer

### Compress the HTML document instead of adding many preloads, and compress SVG LCP images
- Layer: network / html
- Stage: network, preload-scan, html-parse
- Metrics: LCP, FCP
- When: load
- Impact: medium, because a smaller HTML body arrives sooner, so the preload scanner finds subresources earlier without the bandwidth fight that many `rel=preload` hints cause
- Do: Make sure the navigation response is compressed. Use only a few `preload` hints, for resources that cannot be discovered otherwise. Serve SVG images with Brotli or gzip. Minify and compress CSS so that text LCP with system fonts paints sooner.
- Why: The preload scanner can act only on bytes it has received. SVG is text, so text compression cuts its load time, unlike raster formats. With system fonts, CSS is the main thing that blocks text rendering.
- Status: Current.
- Sources: https://web.dev/articles/optimizing-content-efficiency-optimize-encoding-and-transfer

### Minify in the build with source maps, not at the CDN edge
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, LCP
- When: build
- Impact: medium, because minification is additive to compression (for example, Angular 1.8.3 is 1,346 KiB unminified and 173 KiB minified)
- Do: Let the bundler minify JS, CSS and HTML, strip comments, and merge duplicate CSS rules. Run SVGO on SVG. Publish source maps for debugging. Do not depend on CDN auto-minify.
- Why: The origin build knows the code and can minify more aggressively than a generic edge minifier. Cloudflare removed Auto Minify on 2024-08-05. It reported that the feature saved less than 0.1% of page size, because build tools already minify.
- Avoid/caveats: Keep meaningful whitespace inside text runs. CSS rule merging is not always safe (for example, the same selector in different media queries).
- Status: The CDN article (2023) still suggests CDN minification as a fallback. This is outdated for Cloudflare. The Cloudflare fact comes from a vendor announcement and secondary reports.
- Sources: https://web.dev/articles/optimizing-content-efficiency-optimize-encoding-and-transfer, https://web.dev/articles/content-delivery-networks, https://community.cloudflare.com/t/deprecating-auto-minify/655677

### Use Compression Dictionary Transport to ship frequently deployed bundles as deltas (Chromium)
- Layer: network / build
- Stage: network
- Metrics: LCP, bundle-size, startup
- When: build, load
- Impact: medium to high for apps that deploy often and have returning users, because a new bundle can be sent as a delta against the cached old version (MDN cites ratios 5–10x better than Brotli or zstd alone in delta cases)
- Do: Send `Use-As-Dictionary: match="/assets/app.*.js"` on hashed bundles. When a request has `Available-Dictionary: :<sha256>:` and `Accept-Encoding` includes `dcb` or `dcz`, return the delta-compressed variant with `Content-Encoding: dcb` or `dcz` and `Vary: accept-encoding, available-dictionary`. Otherwise fall back to `br` or `zstd`.
- Why: The browser keeps the previous version and advertises its hash. The server compresses the new file with that version as a dictionary, so only the changed bytes travel.
- Example:
  ```http
  # response for app.3f9c.js
  Use-As-Dictionary: match="/assets/app.*.js"
  # later request for app.8a21.js
  Accept-Encoding: gzip, br, zstd, dcb, dcz
  Available-Dictionary: :pZGm1Av0IEBKARczz7exkNYsZb8LzaMrV7J32a2fFG4=:
  # response
  Content-Encoding: dcb
  Vary: accept-encoding, available-dictionary
  ```
- Avoid/caveats: The dictionary must be same-origin, or CORS with a `crossorigin` attribute. It is partitioned like the HTTP cache and allowed by CSP `connect-src`. The build must produce delta files for the old versions you choose to support. The server must check the hash. The CDN must support it. Not in the web.dev article.
- Status: Chromium 130+ only (BCD: Firefox "preview", Safari no). webstatus "limited". The spec is RFC 9842.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression_dictionary_transport, https://developer.chrome.com/blog/shared-dictionary-compression

---

## CDN and HTTP caching (headers the server sends)

### Put the whole site through the CDN, including HTML and uncacheable API responses
- Layer: network
- Stage: network
- Metrics: TTFB, LCP
- When: load
- Impact: high, because the TCP and TLS handshakes end at a nearby PoP, and the PoP reaches the origin over warm, pooled connections on tuned routes
- Do: Point the main hostname (CNAME) at the CDN, not only a `static.` subdomain. Send dynamic and uncacheable responses through it too.
- Why: Each new connection costs several round trips. A short round trip to the edge plus a pre-warmed long-haul connection is faster than one long cold connection to the origin. A separate static hostname also adds a DNS lookup and a new connection.
- Avoid/caveats: CDN performance changes by region and time. Measure TTFB in RUM per country.
- Status: Current practice.
- Sources: https://web.dev/articles/content-delivery-networks

### Give hashed static assets a one-year TTL and add `immutable`
- Layer: network / build
- Stage: network
- Metrics: LCP, FCP, TTFB
- When: load
- Impact: high for repeat visits, because assets load with no network trip and no revalidation
- Do: Put a content hash in each asset filename. Serve it with `Cache-Control: public, max-age=31536000, immutable`. Never change the bytes behind a hashed URL.
- Why: A long TTL raises the CDN cache hit ratio and lets the browser reuse the asset. `immutable` tells Firefox and Safari not to send conditional requests on reload.
- Example:
  ```http
  # /assets/chart-core.8a21f.js
  Cache-Control: public, max-age=31536000, immutable
  # /index.html
  Cache-Control: no-cache
  ```
- Avoid/caveats: Never use this on unhashed URLs or on HTML. Chromium ignores `immutable`. Since 2017 Chrome's normal reload revalidates only the main resource, so the effect is mostly the same.
- Status: `immutable` works in Firefox 49 and Safari 11. Chrome has no support (BCD `version_added: false`, crbug 41253661), as the article says.
- Sources: https://web.dev/articles/content-delivery-networks, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control

### Micro-cache hot public dynamic responses at the CDN for a few seconds, and never cache private data there
- Layer: network
- Stage: network
- Metrics: TTFB
- When: load, long-lived session
- Impact: high during traffic spikes, because a TTL of about 5 seconds turns thousands of origin hits into one per PoP per 5 seconds
- Do: For responses that are the same for everyone (instrument lists, public snapshots, the home page), set `Cache-Control: public, s-maxage=5, stale-while-revalidate=30`. For anything user-specific (account, orders, positions), set `Cache-Control: private` or `no-store`.
- Why: Short shared caching takes load off the origin with little loss of freshness. `s-maxage` affects only shared caches, so the browser policy stays separate.
- Avoid/caveats: A missing `private` on a user-specific response can leak one user's data to another through the CDN. `stale-while-revalidate` behavior at CDNs varies by vendor.
- Status: `s-maxage` is standard (RFC 9111). `stale-while-revalidate` works in Chrome 75, Firefox 68 and Safari 14 (BCD).
- Sources: https://web.dev/articles/content-delivery-networks, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control

### Use long CDN TTLs plus tag-based purge ("hold-till-told") for content that changes at unknown times
- Layer: network
- Stage: network
- Metrics: TTFB
- When: build, long-lived session
- Impact: medium, because content that is rarely edited gets a CDN hit ratio close to static content
- Do: Give such responses a long `s-maxage` and a short browser `max-age`. Attach cache tags (surrogate keys) such as `footer` or `instrument:AAPL`. On update, purge by tag from the deploy or CMS pipeline.
- Why: Purge removes stale entries at once, so you do not need to guess the TTL. Tags let one purge call remove every page that embeds a shared fragment.
- Avoid/caveats: This needs a CDN with near-instant purge. The tag header name depends on the vendor.
- Status: Vendor feature. The concept is from the article.
- Sources: https://web.dev/articles/content-delivery-networks

### Normalize cache keys: ignore tracking query params, sort params, and send `No-Vary-Search` for the browser
- Layer: network
- Stage: network
- Metrics: TTFB, LCP
- When: load
- Impact: medium, because `?utm_source=` and changes in parameter order otherwise split one resource into many cache entries
- Do: In the CDN config, drop tracking params from the cache key and sort the rest. On responses where some params do not change the content, send `No-Vary-Search` so the browser HTTP cache and speculation prefetch can reuse entries too.
- Why: Caches key on the full URL by default. `No-Vary-Search` lets the browser treat URLs that differ only in listed params, or only in param order, as one entry.
- Example: `No-Vary-Search: key-order, params=("utm_source" "utm_medium" "utm_campaign" "ref")`
- Avoid/caveats: Never ignore a param that changes the response (for example, `symbol`). Prerendered pages may start with different params, so read params after activation.
- Status: `No-Vary-Search` for the HTTP cache: Chrome 141, Firefox 154, no Safari (BCD). Speculation-rules prefetch use from Chrome 121. Not in the web.dev article.
- Sources: https://web.dev/articles/content-delivery-networks, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/No-Vary-Search

### Do not send `Set-Cookie` or wide `Vary` on cacheable responses
- Layer: network
- Stage: network
- Metrics: TTFB
- When: load
- Impact: medium, because either one can silently make a static asset uncacheable at the CDN
- Do: Remove `Set-Cookie` from static and public responses. Use `Vary` only for `Accept-Encoding` (and the dictionary headers above). If you must vary on `Accept-Language`, normalize the header at the edge to a small set of values first.
- Why: Most caches do not store responses with `Set-Cookie`. Many CDNs have limited `Vary` support. Values that are almost the same (`en-US` vs `en-US,en;q=0.9`) make separate cache entries.
- Status: Current.
- Sources: https://web.dev/articles/content-delivery-networks

### Target a CDN cache hit ratio of about 90%, and audit cache headers on every static response
- Layer: tooling / network
- Stage: network
- Metrics: TTFB, LCP
- When: testing, long-lived session
- Impact: medium, because it catches assets with no TTL, which go back to the origin each time
- Do: Check that each static response has `max-age`, `s-maxage` or `Expires`. Watch the CHR in CDN analytics. In Lighthouse 13 use `use-cache-insight` (it replaced `uses-long-cache-ttl`).
- Why: Without a freshness header, a CDN may not cache the response at all.
- Status: The audit was renamed in Lighthouse 13 (2025-10).
- Sources: https://web.dev/articles/content-delivery-networks, https://developer.chrome.com/blog/lighthouse-13-0

### Choose tiered caching (edge plus a central shield) when your users are spread thin across PoPs
- Layer: network
- Stage: network
- Metrics: TTFB
- When: load
- Impact: low to medium, because it trades a little latency for a higher hit ratio
- Do: Turn on the CDN's tiered cache or origin shield if the edge CHR is low because traffic is split over many PoPs.
- Why: More PoPs give lower latency but split the cache. A central tier catches edge misses before they reach the origin.
- Status: Vendor feature.
- Sources: https://web.dev/articles/content-delivery-networks

### Enable TLS 1.3, HTTP/2 and HTTP/3 at the edge
- Layer: network
- Stage: network
- Metrics: TTFB, LCP
- When: load
- Impact: medium, with most effect on high-latency and lossy mobile networks
- Do: Turn on TLS 1.3 and HTTP/3 (QUIC), and keep HTTP/2 as the fallback.
- Why: TLS 1.3 needs one handshake round trip instead of two (about 33% less connection setup on HTTP/1 and HTTP/2), and 0-RTT on resumption. HTTP/3 runs over QUIC on UDP, so one lost packet stalls only its own stream, not the whole connection (no TCP head-of-line blocking).
- Avoid/caveats: 0-RTT early data can be replayed, so allow it only for idempotent requests.
- Status: HTTP/3 is RFC 9114 (2022) and Baseline newly available since 2024-09-16 (Safari 18). The article says HTTP/3 "isn't fully standardized" and is "experimental". Both statements are outdated. TLS 1.3 has about 96% global support (caniuse).
- Sources: https://web.dev/articles/content-delivery-networks, https://api.webstatus.dev/v1/features/http3

### Emit only lowercase, ASCII-safe header names and values before you enable HTTP/2 or HTTP/3
- Layer: network
- Stage: network
- Metrics: TTFB
- When: build, testing
- Impact: high when it breaks, because the resource fails with `ERR_HTTP2_PROTOCOL_ERROR`
- Do: Write header names in lowercase, and never put non-ASCII characters in values set by app or middleware code. Run tests over h2 and h3 before you switch.
- Why: HTTP/1 is forgiving about these errors. RFC 9113 says a message with uppercase field names is malformed.
- Status: RFC 9113 (June 2022).
- Sources: https://web.dev/articles/content-delivery-networks, https://www.rfc-editor.org/rfc/rfc9113.html

### Do not depend on the HTTP/2 priority tree, and do not split bundles into hundreds of tiny files
- Layer: network / build
- Stage: network
- Metrics: LCP, bundle-size
- When: build, load
- Impact: medium, because priority now comes from the browser's own signals, and larger files compress better
- Do: Control priority with markup (`fetchpriority`, preload, ordering). The browser maps this to the RFC 9218 `Priority` header. Keep bundles at a moderate chunk count. Multiplexing removes the per-request connection cost, but not the per-file compression loss.
- Why: The article says servers may ignore stream priorities and CDN support "varies wildly". RFC 9113 has since deprecated the RFC 7540 priority signals in favor of RFC 9218.
- Status: The `Priority` request header is in Chrome 124 and Firefox 128, not Safari (BCD). RFC 7540 priorities are deprecated (RFC 9113 §5.3.2).
- Sources: https://web.dev/articles/content-delivery-networks, https://www.rfc-editor.org/rfc/rfc9113.html

### Do not invest in AMP or Signed Exchanges for load speed
- Layer: network
- Stage: network
- Metrics: LCP
- When: load
- Impact: low, because the ecosystem is going away
- Do: Use your own `preload` and speculation rules for next-page speed instead of SXG or AMP cache preloading.
- Why: The lab-vs-field article (2022) credits AMP and SXG with field LCP gains. Since then, Cloudflare removed AMP and SXG support from 2025-10-20, and Google Search docs removed SXG references on 2026-07-01.
- Status: Effectively deprecated. The Cloudflare fact is from a vendor community post. The Google fact is from the Search Central changelog.
- Sources: https://web.dev/articles/lab-and-field-data-differences, https://developers.google.com/search/docs/appearance/signed-exchange, https://community.cloudflare.com/t/amp-and-signed-exchanges-deprecation-october-20th/831238

---

## Standard levers seen
- Core Web Vitals "good" thresholds at p75, split by mobile and desktop: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. `web-vitals` exports `LCPThresholds [2500, 4000]`, `INPThresholds [200, 500]` and `CLSThresholds [0.1, 0.25]`. A page with no interactions passes on LCP and CLS alone. (vitals, crux-and-rum-differences)
- A stable CWV changes at most once per year. The lifecycle is experimental, then pending (at least 6 months), then stable. FID was retired, INP became stable in March 2024, and Chrome tools dropped FID on 2024-09-09. (vitals)
- Use TTFB and FCP as LCP milestones. For example, a 1.8 s TTFB makes a good LCP almost impossible, so fix the server, CDN or redirects first. (vitals-tools)
- Use TBT as the lab proxy for INP during load. Lighthouse cannot measure INP without user input. (vitals, vitals-measurement-getting-started)
- Give lazy-loaded images and iframes explicit dimensions, so there is no layout shift when the user scrolls. (lab-and-field)
- Optimize web fonts and set cache headers to cut first-visit CLS and LCP. (lab-and-field)
- Make pages bfcache-eligible, because restores are near-instant and count in field data. (lab-and-field, crux-and-rum)
- The V8 code cache means cached JS costs less to process on repeat visits, which helps field INP. (lab-and-field, links v8.dev code caching)
- Use field data to set priorities. Use lab data for diagnosis and to reach users with slow devices and networks. Do not optimize for the Lighthouse score. (lab-and-field, vitals-tools)
- Tools: PageSpeed Insights (CrUX p75 over 28 days plus Lighthouse), Search Console CWV report (page groups), CrUX API (daily) and History API (weekly), CrUX Vis, the DevTools Performance panel (live metrics with CrUX comparison, traces, Insights sidebar, Layout Shifts track, long tasks marked with red triangles), Lighthouse user flows, WebPageTest. (vitals-tools, getting-started)
- The workflow is a loop: evaluate with field data, then debug with lab tools and traces, then monitor with CI and RUM alerts. (vitals-tools)
- Low-level APIs for custom metrics: User Timing, Long Tasks (Chromium only), Long Animation Frames (Chromium 123+ only), Element Timing (Chromium only), Navigation Timing, Resource Timing, Server Timing. (user-centric-performance-metrics)
- Strip EXIF and other metadata from images. It can be tens of KB per image. (encoding article)
- CDN image optimization (strip metadata, lossless recompress, convert to modern formats). Images are about 50% of bytes on the median page. (CDN article)
- Check compression in DevTools Network. The footer shows transferred size vs resource size. (encoding article)
- Brotli from origin requires the CDN to cache several encodings per URL. Automatic CDN Brotli serves a fast level on the first request and recompresses cacheable files at level 11 offline. (CDN article)
- If the origin cannot do Brotli, use gzip 6 for dynamic and gzip 9 for static. (CDN article)

## Outdated or deprecated advice found in these articles (as of 2026-09)
- "HTTP/3 isn't fully standardized yet" and "experimental support" (CDN article). HTTP/3 is RFC 9114 (2022) and Baseline 2024.
- Relying on HTTP/2 stream prioritization and "Is HTTP/2 Fast Yet?" (CDN article). The RFC 7540 priority scheme is deprecated (RFC 9113). Use RFC 9218 `Priority` and `fetchpriority`.
- CDN minification as a fallback (CDN article). Cloudflare Auto Minify was removed 2024-08-05. Minify in the build.
- Only gzip and Brotli (encoding article, 2023). zstd is Baseline 2026. Dictionary transport (`dcb`/`dcz`) is in Chromium 130+.
- FID mentioned as a live metric (lab-and-field, vitals-tools). It was removed from CrUX, PSI and web-vitals v5 (2024-09-09 / 2025-05).
- AMP and Signed Exchanges as field LCP boosters (lab-and-field). Cloudflare dropped them (2025-10-20), and Google Search docs removed SXG references (2026-07-01).
- "Soft navigations: work is underway" (crux-and-rum). Shipped in Chrome 151 (2026-07). web-vitals v6 has `reportSoftNavs`.
- "`touch-action` isn't supported in Safari" (linked Chrome blog). `touch-action: manipulation` is Baseline widely available (Safari 13, iOS 9.3).
- web-vitals "~2KB" (getting-started). It is now about 3K brotli, plus about 1.5K for attribution.
- Lighthouse audit names such as `uses-long-cache-ttl`, `render-blocking-resources` and `uses-text-compression` (linked from the CDN and vitals-tools articles). Lighthouse 13 replaced them with insights.
- CrUX Dashboard. It was retired after November 2025. Use CrUX Vis or the History API.
- Still true (not outdated): Chromium does not support `Cache-Control: immutable` (BCD 2026: `false`).

## Sources read
- https://web.dev/articles/vitals
- https://web.dev/articles/user-centric-performance-metrics
- https://web.dev/articles/vitals-measurement-getting-started
- https://web.dev/articles/crux-and-rum-differences
- https://web.dev/articles/lab-and-field-data-differences
- https://web.dev/articles/vitals-tools
- https://web.dev/articles/optimizing-content-efficiency-optimize-encoding-and-transfer
- https://web.dev/articles/content-delivery-networks
- https://web.dev/articles/lcp (candidate elements, TAO, Chrome 133)
- https://web.dev/blog/lcp-and-inp-are-now-baseline-newly-available
- https://github.com/GoogleChrome/web-vitals (README and CHANGELOG, raw)
- https://registry.npmjs.org/web-vitals, https://registry.npmjs.org/lighthouse, https://registry.npmjs.org/@lhci/cli
- https://developer.chrome.com/docs/web-platform/soft-navigations
- https://developer.chrome.com/blog/lighthouse-13-0
- https://developer.chrome.com/blog/300ms-tap-delay-gone-away
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/No-Vary-Search
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression_dictionary_transport
- https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater
- https://developer.mozilla.org/en-US/docs/Web/API/PerformanceElementTiming
- https://github.com/mdn/browser-compat-data (Cache-Control, Content-Encoding, Accept-Encoding, No-Vary-Search, dictionary headers, Timing-Allow-Origin, Server-Timing, Priority, LayoutShift, LargestContentfulPaint, PerformanceEventTiming, LoAF, Element Timing, Long Tasks, fetchLater, sendBeacon, touch-action)
- https://api.webstatus.dev/v1/features/{zstd, largest-contentful-paint, event-timing, layout-instability, compression-dictionary-transport, fetchlater, long-animation-frames, server-timing, brotli, http3, soft-navigations, touch-action}
- https://w3c.github.io/paint-timing/ (contentful and timing-eligible definitions)
- https://www.rfc-editor.org/rfc/rfc9113 (priority deprecation §5.3.2, uppercase field names)
- https://developers.google.com/search/docs/appearance/signed-exchange
- https://paulcalvano.com/2024-03-19-choosing-between-gzip-brotli-and-zstandard-compression/ (blog)
- Search results only (not opened): Cloudflare Auto Minify deprecation (community.cloudflare.com and secondary sites), Cloudflare AMP/SXG deprecation, CrUX Dashboard deprecation (developer.chrome.com/blog/crux-dashboard-deprecation), FID end of support (web.dev/blog/fid), Chrome 2017 reload change (techcrunch, HN)
- https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/tls1-3.json

## Not covered / could not access
- `developer.chrome.com/docs/web-platform/compression-dictionary-transport` returned 404. I used MDN and the search summary of the Chrome blog instead.
- I did not open the linked deep-dive guides (Optimize LCP, INP and CLS; Best practices for measuring Web Vitals in the field; Debug performance in the field; bfcache; http-cache; Lighthouse user flows). Other batches or agents cover them.
- I did not verify which CDNs support zstd, dictionary transport or `stale-while-revalidate` today. Vendor support varies, and the only claim here comes from a 2024 blog.
- The "improvements regress within six months" figure comes from a Google video cited in vitals-tools. I did not watch it.
- The web.dev pages render charts and screenshots (PSI, CrUX distributions) as images. I read only their captions.
- `chart:first-frame` uses a SciChart hook name as an example. I did not verify the SciChart API name.
