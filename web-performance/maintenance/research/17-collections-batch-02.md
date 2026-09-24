# web.dev collections deep read, batch 2 of 4 (animations + reliable)
Scope: eight articles from the web.dev "animations" and "reliable" collections, read in full from raw HTML: prefers-reduced-motion, high-performance CSS animations, Firefox DevTools animation inspector, service workers + Cache Storage, Cache API quick guide, broadcast updates, measuring offline usage, and Workbox plugins.
Status checks use MDN browser-compat-data 8.1.2 (2026-09-17) and the web-features dataset, plus Workbox 7.4.1 source (npm, published 2026-05-04). Advice that is outdated or wrong today is marked **OUTDATED** or **ARTICLE BUG**.

## Article dates and what is outdated (summary)

| Article | Footer date | Outdated or wrong today |
|---|---|---|
| prefers-reduced-motion | 2019-03-11 | `media` on `<link>` does not skip the download (only lowers priority). `Sec-CH-Prefers-Reduced-Motion` is still Chromium-only and experimental. |
| Service workers and the Cache Storage API | 2018-11-05 | Still valid. |
| Broadcast updates | 2020-12-08 | "Safari doesn't support BroadcastChannel" is outdated (Safari 15.4; Baseline widely available 2024-09-14). The sample reads `updatedUrl`, but Workbox sends `updatedURL`. |
| How to create high-performance CSS animations | 2020-10-06 | The `translateZ(0)` fallback is obsolete. "FPS meter" is now "Frame rendering stats". Firefox "Waterfall" is now the Firefox Profiler. The Firefox paint-flashing button was removed in Firefox 96. |
| Work with animations (Firefox DevTools) | no date | Current. |
| Measuring offline usage | 2020-10-28 | `workbox-google-analytics` is deprecated and does not work with GA4. Universal Analytics stopped processing hits on 2023-07-01. Background Sync is still Chromium-only. |
| The Cache API: A quick guide | 2017-10-03 | `cache.put('/data.json')` with one argument is invalid. The quota numbers are old. |
| Using plugins (Workbox) | 2022-02-02 | Still valid for Workbox 7.4.1. |

---

### Put non-essential motion behind `prefers-reduced-motion: no-preference`
- Layer: css
- Stage: style, composite, paint
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium. It is required for accessibility, and it removes continuous compositor and paint work for users who opt out.
- Do: Write decorative animations inside `@media (prefers-reduced-motion: no-preference)`, so the default is "no motion". Keep motion that carries meaning (feedback that an action was received), but make it shorter and smaller when the user asks for reduced motion. Remove parallax, zoom effects and autoplaying motion under `reduce`.
- Why: The query reflects the OS setting ("Reduce motion" on macOS, "Remove animations" on Android). `reduce` asks that all non-essential movement be removed. Parallax, where layers move at different speeds, can cause dizziness and nausea for users with vestibular disorders.
- Example:
  ```css
  /* Before: always animates */
  .price-flash { animation: flash 400ms ease-out; }

  /* After: motion is opt-in; the reduced-motion users get an instant color change */
  .price-flash { background: var(--flash-bg); }
  @media (prefers-reduced-motion: no-preference) {
    .price-flash { animation: flash 400ms ease-out; }
  }
  ```
- Avoid/caveats: "Reduce" does not mean "no feedback". Replace movement with an instant state change or a short opacity fade. Do not hide information inside an animation.
- Status: Baseline widely available (low 2020-01-15, high 2022-07-15). Chrome 74, Edge 79, Firefox 63, Safari 10.1 (web-features `prefers-reduced-motion`).
- Sources: https://web.dev/articles/prefers-reduced-motion, https://developer.mozilla.org/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion

### Listen for the media query `change` event and stop JS, WAAPI, canvas and WebGL animations yourself
- Layer: js
- Stage: script-run, main-thread-task, gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop, long-lived session
- Impact: medium. CSS rules update automatically, but script-driven animation (WAAPI, requestAnimationFrame loops, chart-library transitions) does not. Without a listener, the preference is ignored until the next reload.
- Do: Read `matchMedia('(prefers-reduced-motion: reduce)')` once. Branch on `.matches` when you start an animation. Subscribe with `addEventListener('change', …)` so that you can cancel running animations or restart them. Put the parentheses around the feature: `matchMedia('prefers-reduced-motion: reduce')` without parentheses is not a valid query.
- Why: The browser re-evaluates CSS media queries itself. A JS animation only knows about the preference when your code reads it. For a WebGL chart, animated zoom, series "sweep-in" and animated range changes are all JS-driven.
- Example:
  ```ts
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function zoomTo(range: Range) {
    if (reducedMotion.matches) chart.setVisibleRange(range);          // jump
    else chart.animateVisibleRange(range, { durationMs: 250 });       // tween
  }
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) runningAnimations.forEach((a) => a.finish());
  });
  ```
  (`chart.*` names are placeholders, not SciChart API.)
- Avoid/caveats: Do not use the deprecated `MediaQueryList.addListener()`. Remove the listener when the component unmounts, or the session keeps the closure alive.
- Status: `MediaQueryList` `change` event: Chrome 39, Edge 79, Firefox 55, Safari 14. `addListener` is marked deprecated (MDN BCD 8.1.2). Web Animations API is Baseline widely available (high 2023-03-16).
- Sources: https://web.dev/articles/prefers-reduced-motion

### Load animation-only CSS with `<link media="(prefers-reduced-motion: no-preference)">`, but do not expect it to save bytes
- Layer: html
- Stage: network, cssom
- Metrics: FCP, LCP
- When: load
- Impact: low. It takes the file off the render-blocking path. It does not skip the download.
- Do: Move large animation-only stylesheets into a separate file with a `media` attribute, so that they do not block the first render for anyone. If you want to skip the bytes, add the stylesheet from JS only when the query matches.
- Why: A stylesheet whose `media` does not match is non-render-blocking. The article says users who opted out are spared the download. That is **OUTDATED/inaccurate**: web.dev's own rendering article states that "the browser still downloads the CSS asset, albeit with a lower priority".
- Example:
  ```html
  <!-- Non-blocking for everyone; still fetched at low priority -->
  <link rel="stylesheet" href="/motion.css" media="(prefers-reduced-motion: no-preference)">
  ```
  ```ts
  // Bytes actually skipped for reduced-motion users
  if (matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    document.head.append(Object.assign(document.createElement('link'),
      { rel: 'stylesheet', href: '/motion.css' }));
  }
  ```
- Avoid/caveats: With the JS approach, a user who later turns reduced motion off gets no animations until reload, unless you also listen for `change`.
- Status: `link` `media` is supported in all browsers (BCD).
- Sources: https://web.dev/articles/prefers-reduced-motion, https://web.dev/articles/critical-rendering-path/render-blocking-css

### Serve a static image instead of an animated GIF, WebP or AVIF to reduced-motion users with `<picture>`
- Layer: html
- Stage: network, raster, paint
- Metrics: FPS/smoothness, LCP
- When: load, animation/render-loop
- Impact: low. It avoids continuous frame decode and repaint of animated images for users who opt out, and they download only the smaller static file.
- Do: Put the animated sources in `<source media="(prefers-reduced-motion: no-preference)">`. Make the `<img>` fallback the static frame, with `width`/`height` set.
- Why: `<picture>` picks the first `<source>` whose `media` matches, so the non-matching animated file is not fetched. This is unlike `<link media>`.
- Example:
  ```html
  <picture>
    <source srcset="/demo.webp" type="image/webp" media="(prefers-reduced-motion: no-preference)">
    <img src="/demo-still.png" alt="Order ticket demo" width="480" height="270">
  </picture>
  ```
- Avoid/caveats: Only one file downloads per preference. If the preference changes, the browser may fetch the other source.
- Status: `source` `media`: supported in all browsers (BCD).
- Sources: https://web.dev/articles/prefers-reduced-motion

### Use the `Sec-CH-Prefers-Reduced-Motion` client hint only as a Chromium-only extra
- Layer: network
- Stage: network
- Metrics: TTFB, FCP
- When: load
- Impact: low. The server can inline the right CSS, but only Chromium sends the hint.
- Do: If the server tailors inlined CSS, send `Accept-CH: Sec-CH-Prefers-Reduced-Motion` and `Vary: Sec-CH-Prefers-Reduced-Motion`. Keep a client-side `@media` fallback for every browser.
- Why: The browser sends the hint only after the server opts in. On the first visit, `Critical-CH` makes the browser retry the request with the hint, which costs an extra round trip on first load.
- Avoid/caveats: `Vary` fragments CDN caches. `Critical-CH` adds a request on first load. Firefox and Safari send nothing.
- Status: Experimental, not Baseline. Chrome/Edge 108+. Firefox and Safari do not support it. `Critical-CH` is Chromium 91+ only (MDN BCD 8.1.2).
- Sources: https://web.dev/articles/prefers-reduced-motion, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-CH-Prefers-Reduced-Motion

### Do not rely on a global "1 ms duration" reset to stop motion; stop script and canvas animation explicitly
- Layer: css
- Stage: style
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low. A reset has no effect on WAAPI, JS or canvas/WebGL motion.
- Do: If you add a global reduced-motion reset, shorten durations (for example, 1 ms with a negative delay) instead of using `animation: none`. Then `animationend` and `transitionend` still fire, and logic that waits for them keeps working. Handle Web Animations API, rAF and canvas motion in code, as the matchMedia rule above describes.
- Why: The article's user-stylesheet trick forces every CSS animation and transition to finish almost at once. `animation: none` would suppress end events, and some UIs wait for those events. The article notes the trick "can't stop motion" started with the Web Animations API.
- Example:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, ::before, ::after {
      animation-duration: 1ms !important; animation-delay: -1ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 1ms !important; transition-delay: -1ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```
- Avoid/caveats: `!important` on `*` is a blunt tool. Prefer per-component rules in your own code. Use the global reset only as a safety net.
- Status: All properties used are Baseline.
- Sources: https://web.dev/articles/prefers-reduced-motion

### Do not animate a geometric property and `transform` on the same element at the same time
- Layer: css
- Stage: layout, composite
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium. Firefox then keeps the `transform` animation off the compositor, so a cheap animation becomes main-thread work.
- Do: Animate `transform` (or `translate`/`scale`) and `opacity` alone. If one element must change `left`/`width` and also move, animate a wrapper's geometry and the inner element's transform, or replace the geometry change with `scale`/`translate`.
- Why: The Firefox animation inspector explains that when `left` and a `transform` translation run together, the two effects cannot stay in sync. Firefox deliberately does not hand `transform` to the compositor in that case. The inspector marks the lost property with a dotted underline and a tooltip. Its own example also animates `width` next to `opacity`, and `width` is never compositor-only.
- Example:
  ```css
  /* Before: left + transform on one element -> transform not composited (Firefox) */
  @keyframes slide { to { left: 200px; transform: translateX(20px); } }

  /* After: one compositor-only property */
  @keyframes slide { to { transform: translateX(220px); } }
  ```
- Avoid/caveats: This is documented for Firefox. Chrome has its own list of non-composited reasons, which it reports in the trace and in the Lighthouse "Avoid non-composited animations" audit. Check both browsers.
- Status: Behavior is documented in the current Firefox DevTools docs (undated page, live in 2026). The Lighthouse audit is still active (page updated 2024-12-08).
- Sources: https://firefox-source-docs.mozilla.org/devtools-user/page_inspector/how_to/work_with_animations/index.html, https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations

### Check that animations run on the compositor with the Firefox Animations panel lightning bolt
- Layer: tooling
- Stage: composite
- Metrics: FPS/smoothness
- When: testing
- Impact: medium. It gives a fast, per-property yes/no answer on compositing, with the reason when the answer is no.
- Do: Inspect the animated element, open the "Animations" tab, and play the animation. A white bolt means all properties are compositor-optimized. A grey bolt means only some are. Hover the dotted-underlined property to read why. Use the scrubber and the playback rate to find the frame where the jank occurs.
- Why: The panel shows CSS transitions (blue bars), `@keyframes` (orange) and WAAPI animations (green), with delay, `endDelay`, easing and fill. It marks each property that ran on the compositor thread.
- Avoid/caveats: The panel sees only CSS and WAAPI animations. It does not see rAF, canvas or WebGL rendering (use a profiler for those).
- Status: Current Firefox feature.
- Sources: https://firefox-source-docs.mozilla.org/devtools-user/page_inspector/how_to/work_with_animations/index.html

### Verify with Chrome DevTools, using the current tool names (FPS meter, Waterfall and Firefox paint flashing are outdated)
- Layer: tooling
- Stage: layout, paint, composite
- Metrics: FPS/smoothness
- When: testing
- Impact: medium. It confirms that no layout or paint runs per frame.
- Do: Record in the Performance panel and check that the Rendering and Painting summary time is near zero during a transform/opacity animation. Enable Rendering > "Frame rendering stats" and watch for red (dropped) and yellow (partially presented) frames. Enable "Paint flashing" to see what repaints. Enable "Enable advanced paint instrumentation" to open the Paint Profiler on costly paints.
- Why: A nonzero Rendering time during an animation shows that style or layout runs every frame.
- Avoid/caveats: **OUTDATED**:
  - The article shows the old FPS meter readout ("NN% … dropped of …"). The tool is now "Frame rendering stats", with per-frame colored lines and GPU raster and GPU memory data (renamed in 2020, per the blink-dev PSA).
  - Firefox's old Performance "Waterfall" is replaced by the Firefox Profiler.
  - The Firefox "Toggle paint flashing" toolbox button was removed in Firefox 96 (bug 1743310).
- Status: The Chrome Rendering-tab options are listed on the DevTools page (updated 2022-04-13). The paint profiler and advanced paint instrumentation are still documented in the Performance reference (updated 2025-04-03).
- Sources: https://web.dev/articles/animations-guide, https://developer.chrome.com/docs/devtools/rendering/performance, https://developer.chrome.com/docs/devtools/performance/reference, https://groups.google.com/a/chromium.org/g/blink-dev/c/iHULoSyUxOQ, https://bugzilla.mozilla.org/show_bug.cgi?id=1743310, https://firefox-source-docs.mozilla.org/devtools-user/performance/index.html

### Do not animate blur or shadow; fade a pre-painted layer instead
- Layer: css
- Stage: paint, raster
- Metrics: FPS/smoothness
- When: animation/render-loop, interaction
- Impact: medium. Blur-based effects (shadows, `filter: blur`) are much costlier to paint than flat fills, and animating them repaints every frame.
- Do: Paint the final shadow once on a pseudo-element and animate its `opacity`. Do not animate `box-shadow` or blur radius. Use paint flashing and the paint profiler to find costly paints, and look for a cheaper property that gives the same look.
- Why: The guide says "anything that involves a blur … takes longer to paint than drawing a red box". Opacity on an already-painted layer is a compositor operation.
- Example:
  ```css
  /* Before: repaints the shadow every frame */
  .card:hover { box-shadow: 0 8px 24px rgb(0 0 0 / .3); transition: box-shadow .2s; }

  /* After: shadow painted once, only opacity changes */
  .card { position: relative; }
  .card::after { content: ""; position: absolute; inset: 0; border-radius: inherit;
    box-shadow: 0 8px 24px rgb(0 0 0 / .3); opacity: 0; transition: opacity .2s; }
  .card:hover::after { opacity: 1; }
  ```
- Avoid/caveats: The extra pseudo-element can become a layer. Do not apply this to hundreds of rows in a list.
- Status: Baseline techniques.
- Sources: https://web.dev/articles/animations-guide

### Add `will-change` just before a change and remove it after; drop the `translateZ(0)` hack
- Layer: css, js
- Stage: composite, raster, gc-memory
- Metrics: FPS/smoothness, memory
- When: interaction, animation/render-loop
- Impact: medium. It can remove the first-frame layer-promotion hitch, but each promoted layer costs GPU memory.
- Do: Use `will-change` only after you see a graphics problem. Put it in a stylesheet only for elements that change all the time (for example, a slide-out drawer). Otherwise, set it from JS shortly before the change (for example, on `pointerenter`) and reset it to `auto` on `transitionend`/`animationend`.
- Why: The hint lets the browser promote the element to its own layer ahead of time, so the element repaints without repainting the rest. Too many layers use memory and slow compositing. `will-change` with a stacking-context property also creates a stacking context up front, and it makes the element a containing block for `position: fixed` descendants.
- Example:
  ```ts
  panel.addEventListener('pointerenter', () => { panel.style.willChange = 'transform'; });
  panel.addEventListener('transitionend', () => { panel.style.willChange = 'auto'; });
  ```
- Avoid/caveats: **OUTDATED**: the article's fallback "`transform: translateZ(0)` for browsers without will-change" is obsolete. `will-change` is Baseline widely available. Be careful with a fixed-position tooltip inside an element that has `will-change: transform`, because the tooltip then positions against that element.
- Status: `will-change`: Baseline widely available (low 2020-01-15, high 2022-07-15) (web-features).
- Sources: https://web.dev/articles/animations-guide, https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/will-change

### Configure HTTP `Cache-Control` correctly before you add Cache Storage, and bypass the HTTP cache when you precache unversioned URLs
- Layer: network
- Stage: network
- Metrics: TTFB, LCP, startup
- When: load, build
- Impact: high. If the HTTP headers are wrong, the service worker copies stale files into a cache that never expires, and the bug becomes permanent.
- Do: Use `Cache-Control: max-age=31536000` on content-hashed URLs and `Cache-Control: no-cache` on unversioned URLs (HTML, `sw.js`, manifests). When a service worker fetches unversioned URLs to cache them, make the request with `cache: 'no-cache'` or `'reload'`, so it goes to the server.
- Why: Filling Cache Storage goes through a normal fetch, and a normal fetch can be answered from the HTTP cache. For hashed URLs this saves a request. For an unversioned URL with a long `max-age`, the service worker stores the stale copy, and Cache Storage has no expiry. The HTML, CSS and JS can then come from mismatched versions.
- Example:
  ```ts
  // sw.ts, install step
  const SHELL = ['/', '/app.webmanifest'];                     // unversioned
  await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
  ```
- Avoid/caveats: Hashed assets do not need the bypass. It only adds network cost for them. `Cache-Control: immutable` is ignored by Chrome (BCD: Chrome no; Firefox 49, Safari 11).
- Status: `Request.cache` is supported in Chrome 64, Firefox 48, Safari 10.1 (BCD). Cache Storage is part of the service-workers feature: Baseline widely available (high 2020-10-30).
- Sources: https://web.dev/articles/service-workers-cache-storage, https://jakearchibald.com/2016/caching-best-practices/

### Give every runtime cache an explicit size and age limit
- Layer: network
- Stage: network, gc-memory
- Metrics: memory, TTFB
- When: long-lived session
- Impact: medium. Cache Storage ignores `Cache-Control` and never evicts entries on its own, so runtime caches (images, API responses) grow until the quota is reached and the whole origin is evicted.
- Do: Cap each runtime cache by entry count and by age. With Workbox, add `ExpirationPlugin({ maxEntries, maxAgeSeconds, purgeOnQuotaError: true })` to the strategy. Without Workbox, delete the oldest keys after each `put`.
- Why: Items stay until code removes them. `maxEntries` removes the least-recently-requested entry first. When the browser runs short of space, it evicts a whole best-effort origin, including IndexedDB.
- Example:
  ```ts
  registerRoute(({ request }) => request.destination === 'image',
    new CacheFirst({ cacheName: 'img-v1', plugins: [
      new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 7 * 86400, purgeOnQuotaError: true }),
    ] }));
  ```
- Avoid/caveats: Per the Workbox source, a response that has expired by `maxAgeSeconds` can still be served once, because cleanup runs after use. A `Date` header enables a lightweight freshness check. `ExpirationPlugin` needs a strategy with a `cacheName`.
- Status: Workbox 7.4.1 (2026-05-04).
- Sources: https://web.dev/articles/service-workers-cache-storage, https://developer.chrome.com/docs/workbox/using-plugins, https://cdn.jsdelivr.net/npm/workbox-expiration@7.4.1/src/ExpirationPlugin.ts, https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria

### Check quota and ask for persistence; do not trust the old "hundreds of MB" figure
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium. A `QuotaExceededError` or an eviction removes the offline cache and IndexedDB data together.
- Do: Call `navigator.storage.estimate()` before large writes. Handle `QuotaExceededError` on `cache.put`/`addAll`. Call `navigator.storage.persist()` for data the user cannot lose.
- Why: Cache API, IndexedDB, OPFS and Wasm code cache share one origin quota. Current limits: Chromium allows up to 60% of the disk per origin. Firefox allows 10% of the disk or 10 GiB in best-effort mode, and 50% of the disk when persistent. Safari (macOS 14/iOS 17+) allows about 60% for browser apps and about 15% for WKWebView apps. Safari also deletes script-written data after 7 days of browser use without user interaction.
- Avoid/caveats: `estimate()` values are approximate and padded.
- Status: StorageManager is Baseline widely available (high 2026-03-18). `persist()` is supported in Safari 15.2+.
- Sources: https://web.dev/articles/cache-api-quick-guide, https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria

### Choose `add`/`addAll` or `put` on purpose, and guard what `put` stores (opaque responses cost about 7 MB each)
- Layer: network, js
- Stage: network, gc-memory
- Metrics: memory, startup
- When: load, long-lived session
- Impact: medium. One bad precache URL makes the whole install fail. Unchecked `put` calls store error pages and padded opaque responses.
- Do:
  - Use `addAll` for the precache list, and keep the list small and reliable, because the whole call fails if any request fails.
  - Use `put` for responses you already fetched, but check `response.ok` first.
  - Prefer CORS (`mode: 'cors'`) for cross-origin assets you cache.
  - Do not use cache-first on opaque responses.
- Why: `add` and `addAll` reject on a non-2xx status and on opaque (no-CORS, status 0) responses. `put` accepts anything. Chrome counts each cached opaque response as at least about 7 MB of quota. Workbox defaults: `CacheFirst` caches only status 200. `NetworkFirst` and `StaleWhileRevalidate` cache status 0 and 200.
- Example:
  ```ts
  const res = await fetch(url, { mode: 'cors' });
  if (res.ok) await cache.put(url, res.clone());   // never cache 404/500 by accident
  ```
- Avoid/caveats: **ARTICLE BUG**: the Cache API guide shows `cache.put('/data.json')` and `cache.put('https://example.com/data.json')` with a single argument. `put` needs a `Response` as its second argument, so these calls reject.
- Status: Cache methods are in all browsers (`addAll`: Chrome 46, Firefox 41, Safari 11.1) (BCD).
- Sources: https://web.dev/articles/cache-api-quick-guide, https://developer.chrome.com/docs/workbox/caching-resources-during-runtime, https://developer.chrome.com/docs/workbox/modules/workbox-cacheable-response

### Match cache keys on purpose: query string, `Vary` and method all make a different key
- Layer: network
- Stage: network
- Metrics: TTFB
- When: load, interaction
- Impact: medium. Keys that change with every request (cache-busting params, tracking params) give a 0% hit rate and fill the cache with duplicates.
- Do: Normalize keys when you write and when you read. Use Workbox `cacheKeyWillBeUsed` (it runs in both `'read'` and `'write'` mode) to strip volatile query parameters. Use `ignoreSearch`/`ignoreVary`/`ignoreMethod` on `match` only when the variants really are the same resource.
- Why: Two requests differ when the query, the `Vary`-listed headers or the HTTP method differ. When several entries match, the one created first is returned. `caches.match()` searches every cache of the origin, and `cache.match()` searches one named cache.
- Example:
  ```ts
  const stripVolatileParams = {
    cacheKeyWillBeUsed: async ({ request }: { request: Request }) => {
      const u = new URL(request.url);
      ['_', 'utm_source', 'ts'].forEach((p) => u.searchParams.delete(p));
      return u.href;           // same key for read and write
    },
  };
  ```
- Avoid/caveats: `ignoreSearch` on an API route that uses query parameters returns the wrong data, for example the wrong symbol or time range.
- Status: `Cache.match`/`matchAll` options are in all browsers (BCD). `cacheKeyWillBeUsed` is in Workbox 7.4.1.
- Sources: https://web.dev/articles/cache-api-quick-guide, https://developer.chrome.com/docs/workbox/using-plugins

### Do not search Cache Storage by iterating `keys()`; keep an index in IndexedDB
- Layer: js
- Stage: main-thread-task, microtask
- Metrics: INP, memory
- When: interaction, long-lived session
- Impact: medium. Iterating every cache and every key and awaiting each `match` is slow on large caches, and it creates many `Request`/`Response` objects.
- Do: When you need lookups by an attribute, store `{url, attributes…}` in an IndexedDB object store with an index, query it, and then `cache.match(url)` only for the hits.
- Why: The Cache API has no query feature other than request matching. IndexedDB indexes are built for this lookup and scale better, as the article states.
- Example:
  ```ts
  // Before: O(all entries) scan
  for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) { /* filter */ }
  // After: indexed lookup, then one match
  const url = await db.getFromIndex('snapshots', 'bySymbol', 'AAPL');
  const res = url && (await caches.match(url));
  ```
  (`db.getFromIndex` uses the `idb` wrapper style. It is not a dependency recommendation.)
- Avoid/caveats: The index and the cache can go out of sync. Update both in one code path, and handle a missing cache entry.
- Status: IndexedDB is Baseline widely available (high 2024-03-20).
- Sources: https://web.dev/articles/cache-api-quick-guide

### Store numeric payloads as binary `Response` bodies and read them with `arrayBuffer()`
- Layer: js
- Stage: script-run, gc-memory
- Metrics: INP, memory
- When: load, interaction
- Impact: low. It avoids JSON parsing and string allocation for large numeric series. (The chart use is an inference from the article's `Response` constructor list.)
- Do: For cached tick or candle arrays, store `new Response(float64Array.buffer, { headers: { 'Content-Type': 'application/octet-stream' } })` and read `await res.arrayBuffer()` into a typed array. Set `Content-Type` for text and JSON bodies.
- Why: `Response` accepts Blob, ArrayBuffer, FormData and string bodies. The body readers (`arrayBuffer`, `blob`, `text`, `json`, `formData`, `body` stream) each return a different type. A typed-array view on an ArrayBuffer needs no parsing.
- Example:
  ```ts
  await cache.put(key, new Response(closes.buffer, { headers: { 'Content-Type': 'application/octet-stream' } }));
  const closesBack = new Float64Array(await (await cache.match(key))!.arrayBuffer());
  ```
- Avoid/caveats: A body can be read only once. Use `clone()` if two consumers need it. `Response.bytes()` returns a `Uint8Array` directly (Chrome/Edge 132, Firefox 128, Safari 18), but a Float64 view still needs `.buffer`.
- Status: Cache API: Baseline widely available (service-workers). `Response.bytes()`: see above (BCD 8.1.2).
- Sources: https://web.dev/articles/cache-api-quick-guide

### Serve cached data with stale-while-revalidate and broadcast the refresh; send validators so the comparison works
- Layer: network, js
- Stage: network, script-run
- Metrics: TTFB, LCP
- When: load, long-lived session
- Impact: medium. The page renders from cache at once and updates when fresh data arrives, with no request on the critical path.
- Do: Use `StaleWhileRevalidate` with `BroadcastUpdatePlugin` for API routes whose data can be stale for a moment. Make the server send `ETag` or `Last-Modified` (or a stable `Content-Length`), because the plugin compares only those headers. In the page, re-read the cache entry named in the message and patch the UI.
- Why: The plugin compares `content-length`, `etag` and `last-modified` by default, not bodies, for speed on large responses. It never fires on the first cache write (there is no old response to compare), never for opaque responses, and never for precached URLs.
- Example:
  ```ts
  navigator.serviceWorker.addEventListener('message', async (e) => {
    if (e.data?.meta !== 'workbox-broadcast-update') return;
    const { cacheName, updatedURL } = e.data.payload;       // note: updatedURL
    const fresh = await (await caches.open(cacheName)).match(updatedURL);
    if (fresh) render(await fresh.json());
  });
  ```
- Avoid/caveats: **ARTICLE BUG**: the web.dev sample destructures `updatedUrl`. Workbox's default payload uses `updatedURL` (Workbox 7.4.1 source), so the sample gets `undefined`. Do not use this for data that must be live, such as order status or balances. Use a live channel for that.
- Status: Workbox 7.4.1 (2026-05-04).
- Sources: https://web.dev/articles/broadcast-updates-guide, https://developer.chrome.com/docs/workbox/modules/workbox-broadcast-update, https://cdn.jsdelivr.net/npm/workbox-broadcast-update@7.4.1/src/BroadcastCacheUpdate.ts

### Register service-worker `message` listeners early, and call `startMessages()` when you use `addEventListener`
- Layer: js
- Stage: html-parse, script-run
- Metrics: startup
- When: load
- Impact: low. Without it, update messages sent during load arrive only after `DOMContentLoaded`, or they are lost in Safari.
- Do: Attach the listener in an early module. If you use `addEventListener('message')`, call `navigator.serviceWorker.startMessages()` to receive messages before `DOMContentLoaded`. Setting `onmessage` starts delivery automatically.
- Why: Messages from the controlling service worker are queued until the document is parsed. For navigation requests, Workbox waits for the new client. In Safari it waits 3.5 s more, because Safari does not buffer these messages.
- Status: `startMessages()` is Baseline widely available (MDN: available across browsers since January 2020).
- Sources: https://web.dev/articles/broadcast-updates-guide, https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/startMessages, https://developer.chrome.com/docs/workbox/modules/workbox-broadcast-update

### Pick the page and service-worker channel by fan-out: BroadcastChannel (all), `Client.postMessage` (selected), MessageChannel (one port)
- Layer: js
- Stage: main-thread-task
- Metrics: INP
- When: long-lived session
- Impact: low. Choosing the right channel avoids waking tabs that do not need the message, and avoids hand-built routing.
- Do:
  - Use `BroadcastChannel` for "tell every tab" events.
  - Use `self.clients.matchAll({ type: 'window' })` and then `client.postMessage` to target selected tabs, or `clients.get(event.clientId)` for the tab that made the request.
  - Use a `MessageChannel` port pair for a long-running two-way conversation.
  - Keep messages small and structured-clone-friendly.
- Why: BroadcastChannel needs no handshake. The Clients API reaches service-worker-controlled windows. MessageChannel needs the page to send `port2` first, but after that it is a direct pipe.
- Avoid/caveats: **OUTDATED**: the article says Safari lacks BroadcastChannel. Safari 15.4 shipped it, and it is Baseline widely available (high 2024-09-14). A BroadcastChannel message also reaches every same-origin context, including background tabs. Each of those tabs runs its handler, so keep the handler cheap or check `document.visibilityState` in it.
- Status: BroadcastChannel is Baseline widely available (high 2024-09-14). Channel messaging is Baseline (high 2018-03-22). `Clients.matchAll`: Chrome 42, Firefox 54, Safari 11.1 (BCD).
- Sources: https://web.dev/articles/broadcast-updates-guide

### Tell the user about a new service worker; do not reload a working session on your own
- Layer: js
- Stage: script-run
- Metrics: startup
- When: long-lived session
- Impact: medium. In a trading terminal, an unplanned reload loses chart state and open forms. A prompt lets the user choose when to reload.
- Do: Register through `workbox-window` (or listen for `updatefound`/`statechange`). When `installed` fires with `isUpdate === true`, show an "Update available" control. Activate and reload only when the user accepts.
- Why: `workbox-window` wraps the lifecycle events into `installed`, `waiting`, `controlling` and `activated`. Production PWAs (Tinder, Squoosh) show an "update available" banner or a "ready to work offline" toast from these events.
- Example:
  ```ts
  const wb = new Workbox('/sw.js');
  wb.addEventListener('installed', (e) => { if (e.isUpdate) showUpdateBanner(() => location.reload()); });
  wb.register();
  ```
- Status: `workbox-window` 7.4.1 (2026-05-04). Workbox is owned by the Chrome Aurora team.
- Sources: https://web.dev/articles/broadcast-updates-guide, https://github.com/GoogleChrome/workbox

### Measure offline failures in the service worker, not with `online`/`offline` events
- Layer: js, network
- Stage: network
- Metrics: (reliability, field data)
- When: long-lived session, testing
- Impact: medium. In SPAs and lazy-loaded pages, parts of the page fail with no error shown to the user. SW-side failure reports show which resources break.
- Do: Catch network failures in the service worker (Workbox `setCatchHandler`, or a custom route handler that wraps `NetworkOnly` in try/catch). `postMessage` `{url, destination}` to the requesting client, and return `Response.error()`. In the page, turn these messages into analytics events and into a visible offline or stale state.
- Why: `navigator.onLine` knows only whether there is network access, not internet access. The events can flap for split seconds. Also, pings sent while offline never arrive. A service worker sees every failed fetch with its `destination`.
- Example:
  ```ts
  setCatchHandler(async ({ event }) => {
    const fe = event as FetchEvent;
    const client = fe.clientId ? await self.clients.get(fe.clientId) : undefined;
    client?.postMessage({ type: 'network-fail', url: fe.request.url, dest: fe.request.destination });
    return Response.error();
  });
  ```
- Avoid/caveats: Report only aggregated counts, not every URL, to limit the data collected (the article raises the privacy point). Scope reports to important routes (for example `/api/`).
- Status: Online status is Baseline widely available. Workbox routing is 7.4.1.
- Sources: https://web.dev/articles/measuring-offline-usage

### Queue beacons offline and replay them; do not use `workbox-google-analytics`
- Layer: network
- Stage: network, idle
- Metrics: (field data completeness)
- When: long-lived session
- Impact: low. Offline sessions stop disappearing from your RUM and analytics data.
- Do: Send analytics and RUM beacons through a route with `BackgroundSyncPlugin` (it stores failed requests in IndexedDB and replays them). Mark offline-replayed hits with a flag so you can segment them.
- Why: Background Sync replays when connectivity returns, even after the tab closes (Chromium). In other browsers, Workbox replays the queue whenever the service worker starts. The default `maxRetentionTime` is 7 days (10080 minutes, per the Workbox source).
- Avoid/caveats: **OUTDATED**: the article's `workbox-google-analytics` example and its "four hours" `qt` limit apply to Universal Analytics. The Workbox docs now call the module deprecated and "not compatible with newer Google Analytics versions starting with version 4". UA standard properties stopped processing on 2023-07-01. Beacons replayed days later can skew time-based metrics, so drop old entries.
- Status: Background Sync is not Baseline (Chrome/Edge 49+/79+ only; no Firefox or Safari support). `workbox-background-sync` 7.4.1.
- Sources: https://web.dev/articles/measuring-offline-usage, https://developer.chrome.com/docs/workbox/modules/workbox-google-analytics, https://developer.chrome.com/docs/workbox/modules/workbox-background-sync, https://cdn.jsdelivr.net/npm/workbox-background-sync@7.4.1/src/Queue.ts, https://searchengineland.com/google-deprecate-universal-analytics-on-july-1-2023-382648

### Use Workbox plugin callbacks for cross-cutting cache policy and timing, not copied handler code
- Layer: network, tooling
- Stage: network
- Metrics: TTFB
- When: build, long-lived session
- Impact: medium. One plugin adds a policy (reject bad responses, normalize keys, fallbacks, timing) to every strategy.
- Do:
  - Return `null` from `cacheWillUpdate` to refuse caching (for example, a 200 with an error payload).
  - Use `handlerDidError` to return an offline fallback `Response`.
  - Record the start time in `handlerWillStart` (in the per-plugin `state` object) and report cache-versus-network latency in `handlerDidComplete`, which runs after all `waitUntil` work settles.
  - Use `fetchDidFail` for real network failures only. It does not fire on 404 or 500.
- Why: A strategy calls each callback at a fixed point, with the request, response, event and a `state` object that is private to that plugin and that invocation. The `handler*` callbacks exist since Workbox v6.
- Example:
  ```ts
  const timing = {
    handlerWillStart: async ({ state }) => { state.t0 = performance.now(); },
    handlerDidComplete: async ({ request, state, error }) => {
      reportSwTiming(request.url, performance.now() - state.t0, !error);
    },
  };
  ```
- Avoid/caveats: The request body may already be consumed when later callbacks run. Store `request.clone()` in `state` from `requestWillFetch` if you need it later. In `cacheDidUpdate`, `newResponse.bodyUsed` is true, so re-read the entry from the cache. `event` can be missing, so check for it.
- Status: Workbox 7.4.1 (2026-05-04). The page is still current (2022-02-02).
- Sources: https://developer.chrome.com/docs/workbox/using-plugins

### Use `RangeRequestsPlugin` when you serve cached audio or video
- Layer: network
- Stage: network
- Metrics: (media playback reliability)
- When: load
- Impact: low. Media elements send `Range` requests, and a full cached `Response` does not answer them correctly without this plugin.
- Do: Add `RangeRequestsPlugin` to the route that serves cached media.
- Why: The plugin creates a partial response from the full cached body for requests that carry a `Range` header.
- Status: Workbox 7.4.1.
- Sources: https://developer.chrome.com/docs/workbox/using-plugins

## Standard levers seen
- Animate `transform` (translate, rotate, scale) and `opacity` only; they stay on the composite stage (animations-guide).
- Move with `transform: translate()`, not `top`/`left`. The guide's demo drops about 50% of frames with `top`/`left` and about 1% with `transform` (animations-guide).
- Resize with `scale`, not `width`/`height`. Hide and show with `opacity` (animations-guide).
- Check each non-transform/opacity property for the pipeline stages it triggers. Avoid layout- and paint-triggering properties in animations (animations-guide).
- Use the DevTools Performance panel and Paint flashing to confirm that no layout or paint runs per frame (animations-guide).
- Keep hashed assets on `max-age=31536000` and HTML on `no-cache` (service-workers-cache-storage).
- Use the asynchronous Cache API or IndexedDB instead of synchronous `localStorage` for bulk data (service-workers-cache-storage).
- Use stale-while-revalidate for data that can be briefly stale (service-workers-cache-storage, broadcast-updates-guide).
- Feature-detect with `'caches' in self` and `'serviceWorker' in navigator` (cache-api-quick-guide, measuring-offline-usage).
- Add an offline fallback page first, then richer offline content (measuring-offline-usage).
- Clean up old caches with `caches.delete(name)`, and delete entries with `cache.delete(req, options)` (cache-api-quick-guide).

## Sources read
- https://web.dev/articles/prefers-reduced-motion (footer 2019-03-11)
- https://web.dev/articles/service-workers-cache-storage (footer 2018-11-05)
- https://web.dev/articles/broadcast-updates-guide (footer 2020-12-08)
- https://web.dev/articles/animations-guide (footer 2020-10-06)
- https://firefox-source-docs.mozilla.org/devtools-user/page_inspector/how_to/work_with_animations/index.html (no date)
- https://web.dev/articles/measuring-offline-usage (footer 2020-10-28)
- https://web.dev/articles/cache-api-quick-guide (footer 2017-10-03)
- https://developer.chrome.com/docs/workbox/using-plugins (footer 2022-02-02)
- Verification: https://cdn.jsdelivr.net/npm/@mdn/browser-compat-data/data.json (v8.1.2, 2026-09-17); https://cdn.jsdelivr.net/npm/web-features/data.json
- https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-CH-Prefers-Reduced-Motion
- https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/startMessages
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/will-change
- https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- https://web.dev/articles/critical-rendering-path/render-blocking-css
- https://jakearchibald.com/2016/caching-best-practices/
- https://developer.chrome.com/docs/workbox/modules/workbox-google-analytics
- https://developer.chrome.com/docs/workbox/modules/workbox-broadcast-update
- https://developer.chrome.com/docs/workbox/modules/workbox-cacheable-response
- https://developer.chrome.com/docs/workbox/modules/workbox-background-sync
- https://developer.chrome.com/docs/workbox/caching-resources-during-runtime
- https://developer.chrome.com/docs/devtools/rendering/performance
- https://developer.chrome.com/docs/devtools/performance/reference
- https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations
- https://groups.google.com/a/chromium.org/g/blink-dev/c/iHULoSyUxOQ
- https://firefox-source-docs.mozilla.org/devtools-user/performance/index.html
- https://bugzilla.mozilla.org/show_bug.cgi?id=1743310 (REST API: target milestone "96 Branch")
- https://cdn.jsdelivr.net/npm/workbox-broadcast-update@7.4.1/src/BroadcastCacheUpdate.ts
- https://cdn.jsdelivr.net/npm/workbox-expiration@7.4.1/src/ExpirationPlugin.ts
- https://cdn.jsdelivr.net/npm/workbox-background-sync@7.4.1/src/Queue.ts
- https://registry.npmjs.org/workbox-window (and -strategies, -broadcast-update, -google-analytics): latest 7.4.1, 2026-05-04
- WebSearch results: Workbox ownership (github.com/GoogleChrome/workbox); UA sunset 2023-07-01 (searchengineland.com)

## Not covered / could not access
- The linked "Why are some animations slow?" (web.dev/articles/animations-overview) was not read. It is the theory behind the animations guide, and other agents probably cover it.
- The Chrome compositor's current list of animatable properties (for example, composited `background-color`/`clip-path`) was not verified here. The Lighthouse page does not list failure reasons.
- The exact Chrome version that renamed the FPS meter was not confirmed. The blink-dev PSA is dated 2020-07-02.
- I did not check the article's claim that `clients.matchAll()` returns the last-focused tab first against the Service Worker spec.
- SciChart.js reduced-motion and animation APIs were not checked. The chart method names in the examples are placeholders.
- No live demos (the prefers-reduced-motion demo, the animation-with-top-left/transform demos) were run.
