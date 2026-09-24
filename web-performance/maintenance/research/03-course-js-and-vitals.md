# web.dev Learn Performance (part B: JS, lazy loading, speculation, workers) + Core Web Vitals guides

Scope: code-level rules from the web.dev "Learn Performance" modules "Code-split JavaScript", "Lazy load images and iframe elements", "Prefetching, prerendering, and service worker precaching", "An overview of web workers" and "A concrete web worker use case". The course has no "Conclusion" module any more (the URL gives 404; the course ends with the worker demo and a quiz). Then the web.dev Core Web Vitals guides: Optimize LCP (with sub-parts), Optimize CLS, Optimize INP (plus its linked sub-guides: optimize long tasks, optimize input delay, script evaluation and long tasks, layout thrashing, style calculation, DOM size, client-side rendering, content-visibility, off-main-thread), Back/forward cache, the code-level parts of Optimize TTFB, the LCP/INP/CLS metric pages, "Web Vitals" and "The most effective ways to improve Core Web Vitals". Support status was checked on 2026-09-22 against MDN browser-compat-data (2026-09-17 build), webstatus.dev, caniuse (2026-08-24 build) and developer.chrome.com.

## Reference: Core Web Vitals thresholds (p75 of page loads, mobile and desktop segmented)

| Metric | Good | Needs improvement | Poor | Source |
|---|---|---|---|---|
| LCP | <= 2.5 s | 2.5-4.0 s | > 4.0 s | https://web.dev/articles/lcp |
| INP | <= 200 ms | 200-500 ms | > 500 ms | https://web.dev/articles/inp |
| CLS | <= 0.1 | 0.1-0.25 | > 0.25 | https://web.dev/articles/cls |
| TTFB (not a CWV, rough guide) | <= 0.8 s | 0.8-1.8 s | > 1.8 s | https://web.dev/articles/optimize-ttfb |

All three CWV are "Stable" (INP replaced FID in 2024). A page passes when all three meet "good" at p75 (https://web.dev/articles/vitals).

LCP sub-part breakdown (no gaps, no overlap, they add up to LCP), with web.dev's target share of total LCP (relative guides, not absolute budgets):

| Sub-part | From -> to | Target share |
|---|---|---|
| Time to First Byte | navigation start -> first byte of HTML | ~40% |
| Resource load delay | TTFB -> LCP resource request start (0 for text in a system font) | <10% |
| Resource load duration | LCP resource request start -> end (0 if no resource) | ~40% |
| Element render delay | LCP resource end -> LCP element fully rendered | <10% |

INP sub-parts: input delay (input -> first event callback starts), processing duration (all callbacks for the interaction), presentation delay (callbacks end -> next frame presented). Measure them across all event entries in the same frame (for example pointerup + mouseup + click), as the web-vitals library does (https://web.dev/articles/optimize-inp).

Other numbers used below: long task = any task > 50 ms (https://web.dev/articles/optimize-long-tasks); layout shifts within 500 ms of a discrete input are excluded from CLS (https://web.dev/articles/cls); CLS session window = shifts less than 1 s apart, window max 5 s (https://web.dev/articles/cls).

---

## A. Code-split JavaScript

### Split non-startup JavaScript behind dynamic import()
- Layer: js
- Stage: network, script-compile, script-run, main-thread-task
- Metrics: INP, TBT, bundle-size, startup
- When: load
- Impact: high, because parse + compile + execute of unused startup JS blocks the main thread exactly when users try to interact (TBT correlates with INP).
- Do: Split the bundle into "needed at load" and "needed later". Load the second part with `import()` at the moment of need (an interaction, a condition, a feature flag, a polyfill check). Cache the returned promise so the module loads once.
- Why: A static `import` or a `<script>` makes the module part of the startup parse/compile/execute work. A dynamic `import()` moves download, compile and evaluation to a later, separate task, and bundlers treat every `import()` as a split point.
- Example:
  ```js
  // Before: indicator math is in the startup bundle
  import { computeIchimoku } from './indicators/ichimoku.js';
  addBtn.addEventListener('click', () => addSeries(computeIchimoku(bars)));

  // After: loaded on first use, then reused
  let ichimoku;
  addBtn.addEventListener('click', async () => {
    ichimoku ??= import('./indicators/ichimoku.js');
    const { computeIchimoku } = await ichimoku;
    addSeries(computeIchimoku(bars));
  });
  ```
- Avoid/caveats: On-demand loading adds latency to the first use (network + compile). Warm the chunk at idle or on intent (see "Prefetch likely-next resources"). A dynamic import of a very large module still makes one large evaluation task. React's `React.lazy` is the same mechanism.
- Status: dynamic `import()` works in all current browsers (caniuse: Chrome 63, Firefox 67, Safari 11.1).
- Sources: https://web.dev/learn/performance/code-split-javascript, https://web.dev/articles/script-evaluation-and-long-tasks

### Find split candidates with Coverage and script-execution data before you split
- Layer: tooling
- Stage: script-compile, script-run
- Metrics: TBT, INP, bundle-size
- When: testing
- Impact: medium, because it tells you which code is actually unused at load.
- Do: Use the DevTools Coverage panel to find code that does not run during load. Use the Lighthouse per-script execution-time data to find the heaviest scripts. Split or remove those first.
- Why: The course says Lighthouse warns when JS execution takes more than 2 s and fails above 3.5 s; unused code still costs parse/compile.
- Avoid/caveats: The 2 s / 3.5 s values come from a 2023 course page; current Lighthouse versions present many audits as "insights", so re-check the numbers in your Lighthouse version.
- Status: tooling; n/a.
- Sources: https://web.dev/learn/performance/code-split-javascript, https://web.dev/articles/top-cwv

### Bundle modules for production; do not ship deep unbundled module graphs
- Layer: build
- Stage: network, script-compile
- Metrics: LCP, INP, startup
- When: build
- Impact: high, because each unbundled module is a separate request and nested static imports form a request chain.
- Do: Use a bundler (webpack, Rollup/Vite, esbuild, Parcel) for production. If you must ship native modules unbundled, add `<link rel="modulepreload">` for the deep modules so the browser fetches them in parallel.
- Why: `a.js` imports `b.js` imports `c.js` means three sequential round trips. v8.dev: unbundled modules are acceptable only for small apps with fewer than about 100 modules and a shallow tree.
- Example:
  ```html
  <!-- If unbundled: flatten the chain -->
  <link rel="modulepreload" href="/js/chart-core.js">
  <link rel="modulepreload" href="/js/chart-axes.js">
  <script type="module" src="/js/app.js"></script>
  ```
- Avoid/caveats: modulepreload is only a mitigation; the course still prefers bundles for load performance.
- Status: `modulepreload` Baseline widely available (webstatus: newly 2023-09-18, widely 2026-03-18; Chrome 66, Firefox 115, Safari 17).
- Sources: https://web.dev/learn/performance/code-split-javascript, https://web.dev/articles/script-evaluation-and-long-tasks, https://v8.dev/features/modules, https://api.webstatus.dev/v1/features?q=name:modulepreload

### Configure bundler splitting explicitly and check the output
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, INP, startup
- When: build
- Impact: medium, because wrong settings silently merge lazy code into the initial chunk or duplicate modules.
- Do: In webpack keep `splitChunks.chunks` at `'async'` (default) or use `'all'` to share chunks between async and initial imports; use `maxSize` to cut very large chunks. In esbuild enable `splitting: true` with `format: 'esm'` (esbuild does not split by default). Name output files with a content hash.
- Why: webpack `chunks: 'initial'` merges the dynamic chunk into the main bundle; `splitChunks: false` duplicates shared modules into every chunk. esbuild docs state splitting "currently only works with the esm output format". Hashed file names let unchanged chunks stay cached.
- Example:
  ```js
  // esbuild
  await build({ entryPoints: ['src/main.ts'], bundle: true,
                splitting: true, format: 'esm', outdir: 'dist',
                entryNames: '[name]-[hash]', chunkNames: 'chunks/[name]-[hash]' });
  ```
- Avoid/caveats: Many tiny chunks lose compression efficiency and add requests on a cold cache.
- Status: bundler features; n/a.
- Sources: https://web.dev/learn/performance/code-split-javascript, https://esbuild.github.io/api/#splitting

### Balance chunk size: evaluation cost vs compression vs cache hits (about 100 KB per script)
- Layer: build
- Stage: script-compile, script-run, network
- Metrics: TBT, INP, bundle-size, startup
- When: build
- Impact: medium, because one huge bundle is one huge evaluation task and one cache-invalidation unit.
- Do: Aim for scripts of roughly 100 KB each (web.dev's stated target). Keep framework/vendor code in a separate, long-lived chunk from app code. Hash file names.
- Why: Each classic `<script>` gets its own evaluation task, so several smaller scripts give the main thread gaps for input. Bigger files compress better, but one app-code change invalidates the whole combined file.
- Avoid/caveats: The 100 KB figure is a rule of thumb, not a spec. Smaller files compress worse and add round trips on a cold cache.
- Status: n/a.
- Sources: https://web.dev/articles/script-evaluation-and-long-tasks, https://web.dev/learn/performance/code-split-javascript

### Know how browsers turn scripts into tasks
- Layer: v8
- Stage: script-compile, script-run, main-thread-task
- Metrics: INP, TBT
- When: load
- Impact: medium, because the loading method decides how evaluation work is chunked.
- Do: Expect one evaluation task per classic `<script>` element. In Chromium, expect all `defer` scripts (and `type="module"` scripts, which are deferred by default) to run in the same task as `DOMContentLoaded`, which can form one long task; keep deferred startup code small. Load heavy libraries inside workers so their evaluation is off the main thread.
- Why: Chromium compiles each module in its own "Compile module" task; Safari and Firefox evaluate each module in a separate task. Dynamic `import()` gives each imported module its own task in all engines.
- Avoid/caveats: These engine details come from a 2023 article and can change; profile in each engine.
- Status: engine behavior as described 2023-05; not re-verified.
- Sources: https://web.dev/articles/script-evaluation-and-long-tasks

---

## B. Lazy loading images and iframes

### Add loading="lazy" to below-the-fold images and iframes
- Layer: html
- Stage: network, layout
- Metrics: LCP, INP, bundle-size (bytes), memory
- When: load
- Impact: medium, because off-screen images and iframes compete with critical resources for bandwidth, and iframes bring whole documents with their own JS.
- Do: Put `loading="lazy"` on `<img>` and `<iframe>` elements that are clearly outside the initial viewport on every device. On `<picture>`, put the attribute on the inner `<img>`, not on `<picture>`. Give lazy iframes `width`/`height` (or CSS size).
- Why: The browser fetches a lazy element only when it is within a browser-defined distance of the viewport, which frees bandwidth for LCP candidates. Lazy iframes also delay the frame's scripts that can hurt INP during startup. The course cites savings of more than 500 KiB for a YouTube embed and more than 200 KiB for a Facebook Like button.
- Example:
  ```html
  <picture>
    <source type="image/avif" srcset="/img/news-1.avif">
    <img src="/img/news-1.jpg" width="640" height="360" alt="" loading="lazy">
  </picture>
  <iframe src="https://example.com/embed" width="560" height="315" loading="lazy" title="Embed"></iframe>
  ```
- Avoid/caveats: The load distance varies by browser and connection type. `loading` does not change fetch priority. `sizes="auto"` (lets the browser choose from `srcset` using the laid-out width of a lazy image) is limited-availability: Chrome/Edge 126, Firefox 150, no Safari (webstatus).
- Status: Baseline widely available for images and iframes (webstatus: newly 2023-12-19, widely 2026-06-19; iframe support Firefox 121, Safari 16.4).
- Sources: https://web.dev/learn/performance/lazy-load-images-and-iframe-elements, https://api.webstatus.dev/v1/features/loading-lazy

### Never lazy-load the LCP image or anything likely above the fold
- Layer: html
- Stage: preload-scan, network, layout
- Metrics: LCP
- When: load
- Impact: high, because a lazy image in the viewport is requested only after CSS is loaded and layout runs, not when the preload scanner first sees it.
- Do: Leave `loading` off (or `eager`) on hero images, logos and any image near the top of the layout on any device size. If you are not sure whether an image is in the initial viewport, do not lazy-load it.
- Why: Lazy loading needs layout to decide visibility, so it adds resource load delay. The note in the course also says `fetchpriority="high"` does not fix this: a lazy in-viewport image still waits for all CSS.
- Example:
  ```html
  <!-- Before --> <img src="/hero.webp" loading="lazy" fetchpriority="high" alt="">
  <!-- After  --> <img src="/hero.webp" fetchpriority="high" width="1200" height="600" alt="">
  ```
- Avoid/caveats: Tablets in portrait and large desktops show more vertical space; "below the fold" differs per device.
- Status: n/a (behavior of Baseline `loading`).
- Sources: https://web.dev/learn/performance/lazy-load-images-and-iframe-elements, https://web.dev/articles/optimize-lcp, https://web.dev/articles/top-cwv

### Use native lazy loading, not JavaScript libraries, for images and iframes
- Layer: html
- Stage: preload-scan, script-run
- Metrics: LCP, INP, bundle-size
- When: load
- Impact: medium, because JS lazy loaders hide URLs in `data-src` from the preload scanner and add script cost.
- Do: Use `src`/`srcset` with `loading="lazy"`. Do not use `data-src`/`data-srcset` swap patterns for images or iframes.
- Why: Hidden URLs cannot be discovered until the library runs. top-cwv reports 7% of pages hide their LCP image behind `data-src`.
- Avoid/caveats: JS (IntersectionObserver) is still needed for resources without native lazy loading (see next items).
- Status: n/a.
- Sources: https://web.dev/learn/performance/lazy-load-images-and-iframe-elements, https://web.dev/articles/top-cwv

### Replace heavy third-party embeds with facades
- Layer: html
- Stage: network, script-run, main-thread-task
- Metrics: INP, LCP, TBT, bundle-size
- When: load, interaction
- Impact: high for pages with video players, chat widgets or social embeds, because those pull large JS bundles that most users never use.
- Do: Render a static look-alike (image + button). Load the real iframe or widget only on a clear user intent (click, or a sustained hover). Use existing facades such as `lite-youtube-embed`, `lite-vimeo-embed` or React Live Chat Loader.
- Why: If the user never interacts, the embed's resources are never downloaded; if they do, the cost moves to the moment of need.
- Example:
  ```js
  facadeBtn.addEventListener('click', () => {
    const frame = Object.assign(document.createElement('iframe'), {
      src: `${embedUrl}?autoplay=1`, width: 560, height: 315, title: 'Video', allow: 'autoplay',
    });
    facadeBtn.replaceWith(frame);
  }, { once: true });
  ```
- Avoid/caveats: The first interaction now waits for the embed to load; show loading feedback. Size the facade to the embed size to avoid CLS.
- Status: pattern; n/a.
- Sources: https://web.dev/learn/performance/lazy-load-images-and-iframe-elements

### Lazy-load video, posters and CSS background images yourself (or with native video/audio loading in Chrome 148+)
- Layer: js
- Stage: network
- Metrics: LCP, bundle-size (bytes), memory
- When: load
- Impact: medium, because video files are large and these resources have no Baseline native lazy loading.
- Do: For `<video>`, `poster` and CSS `background-image`, use an IntersectionObserver that swaps `data-src` to `src` when near the viewport. Replace animated GIFs with `<video autoplay muted loop playsinline>` (much smaller). Where Chrome-only is acceptable, `loading="lazy"` on `<video>`/`<audio>` now works natively.
- Why: The course notes lazy loading these is not a browser-level feature (as of 2023) and recommends lazysizes or yall.js, which use IntersectionObserver (plus MutationObserver for late DOM).
- Example:
  ```js
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const s of e.target.querySelectorAll('source[data-src]')) s.src = s.dataset.src;
      e.target.load();
      io.unobserve(e.target);
    }
  }, { rootMargin: '200px' });
  document.querySelectorAll('video.lazy').forEach((v) => io.observe(v));
  ```
- Avoid/caveats: Never apply this to the LCP element (a `<video>` poster or a background image can be the LCP element).
- Status: native `loading` on video/audio: Chrome 148 per the "New in Chrome 148" post (MDN BCD and webstatus list 150); not in Firefox or Safari; limited availability.
- Sources: https://web.dev/learn/performance/lazy-load-images-and-iframe-elements, https://developer.chrome.com/blog/new-in-chrome-148, https://api.webstatus.dev/v1/features?q=name:lazy

---

## C. Prefetching, prerendering, service worker precaching

### Prefetch likely-next resources at low priority
- Layer: html
- Stage: network, idle
- Metrics: INP (of the later interaction), LCP (of the next page)
- When: load, interaction
- Impact: medium, because it removes download latency from deferred features without competing with the current page.
- Do: For a feature you deferred (for example a date picker), add `<link rel="prefetch" as="script|style" href=...>` or insert the link from JS when intent appears. Prefetch only on fast connections and skip it when `Save-Data` is on.
- Why: The browser fetches prefetch hints at lowest priority into the HTTP cache, so the later `import()` or stylesheet load is served from disk.
- Example:
  ```js
  const saveData = navigator.connection?.saveData;
  if (!saveData) {
    const l = Object.assign(document.createElement('link'),
      { rel: 'prefetch', as: 'script', href: '/chunks/drawing-tools-3f9a.js' });
    document.head.append(l);
  }
  ```
- Avoid/caveats: It is only a hint; browsers may ignore it. Do not prefetch cross-origin documents (duplicate-request issue) or personalized same-origin HTML (not cacheable, likely unused). Unused prefetches waste the user's data.
- Status: not Baseline: Chrome, Edge, Firefox yes; Safari only behind the `LinkPrefetch` flag (caniuse 2026-08; MDN BCD). Requires a secure context in Chrome/Firefox (BCD note).
- Sources: https://web.dev/learn/performance/prefetching-prerendering-precaching, https://api.webstatus.dev/v1/features/link-rel-prefetch

### Use speculation rules for next-page prefetch/prerender, with conservative eagerness
- Layer: html
- Stage: network, html-parse, script-run, idle
- Metrics: LCP, CLS, FCP, TTFB (of the next navigation)
- When: load, interaction
- Impact: high for multi-page flows, because a correct prerender makes the next navigation near-instant (near-zero LCP).
- Do: Add `<script type="speculationrules">` (or a `Speculation-Rules` header). Prefer document rules with `where` and `eagerness: "moderate"` or `"conservative"`. Use `"immediate"` list rules only for URLs you are very sure about. Exclude logout and state-changing URLs.
- Why: Speculation-rules prefetches go into a per-document memory cache (faster than the HTTP cache); prerender also runs the page's JS in the background. Chrome eagerness: `immediate` (default for list rules) = at once; `eager` = 10 ms hover on desktop, 50 ms in viewport on mobile (Chrome 143+); `moderate` = 200 ms hover or pointerdown on desktop, viewport heuristics on mobile; `conservative` (default for document rules) = pointer/touch down. Limits: `immediate` 50 prefetches / 10 prerenders; other levels 2 each, FIFO.
- Example:
  ```html
  <script type="speculationrules">
  { "prerender": [{ "where": { "and": [
        { "href_matches": "/markets/*" },
        { "not": { "selector_matches": "[data-no-prerender]" } } ] },
      "eagerness": "moderate" }] }
  </script>
  ```
- Avoid/caveats: Wrong speculations waste server and client resources. Chrome skips speculation with Save-Data, Energy Saver on low battery, low memory, the "Preload pages" setting off, or in background tabs. Inline rules need `'inline-speculation-rules'` in CSP `script-src`. Chrome keeps prefetched pages about 5 minutes (MDN). `prerender_until_script` (prerender that pauses at the first blocking script) is an origin trial from Chrome 144; one blog says it runs through Chrome 150.
- Status: experimental, limited availability: Chrome/Edge 109+ (prerender 105+, prefetch 110+, eagerness 121+); Safari 26.2 behind a flag (prefetch only, partial eagerness); Firefox no (MDN BCD 2026-09-17).
- Sources: https://web.dev/learn/performance/prefetching-prerendering-precaching, https://developer.chrome.com/docs/web-platform/prerender-pages, https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API, https://web.dev/articles/top-cwv

### Make pages safe to prerender: defer side effects until activation
- Layer: js
- Stage: script-run
- Metrics: LCP (correctness of measurement), memory
- When: load
- Impact: medium, because prerendered pages run JS before the user sees them (analytics, ads, connections).
- Do: Check `document.prerendering`; run analytics, timers, real-time connections and ad calls after the `prerenderingchange` event. On the server, read `Sec-Purpose: prefetch` / `prefetch;prerender` if you must treat speculative requests differently.
- Why: Many APIs are deferred until activation (for example Web Locks, BroadcastChannel.postMessage, Notifications, geolocation, Web Audio start), and Chrome does not render cross-origin iframes until activation. Page-view analytics would count views that never happened.
- Example:
  ```js
  function whenActivated(fn) {
    if (document.prerendering) {
      document.addEventListener('prerenderingchange', fn, { once: true });
    } else fn();
  }
  whenActivated(() => { openMarketDataSocket(); sendPageView(); });
  ```
- Avoid/caveats: For LCP and other timings of prerendered pages, measure from `activationStart` (web-vitals does this).
- Status: `document.prerendering` and `activationStart`: Chrome 108+, experimental, not in Firefox/Safari (MDN BCD).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API, https://developer.chrome.com/docs/web-platform/prerender-pages

### Do not use <link rel="prerender">
- Layer: html
- Stage: network
- Metrics: LCP
- When: load
- Impact: low, because it no longer prerenders.
- Do: Replace `<link rel="prerender">` with speculation rules.
- Why: Since Chrome 63 it only does a "NoState Prefetch" (fetches subresources, runs no JS, renders nothing). MDN describes it as deprecated and superseded.
- Avoid/caveats: none.
- Status: deprecated/non-standard (MDN).
- Sources: https://web.dev/learn/performance/prefetching-prerendering-precaching, https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API

### Precache only likely-needed, versioned assets in the service worker
- Layer: js
- Stage: network, gc-memory
- Metrics: LCP, TTFB (of later navigations), memory
- When: long-lived session, build
- Impact: medium, because precached files are served almost instantly and this works in every modern browser (including Safari, unlike rel=prefetch).
- Do: Precache at service-worker install the assets for the next likely pages (for example the CSS/JS of a detail page). Generate a precache manifest at build time with a `revision` for unhashed files (hashed files can use `revision: null`); Workbox `precacheAndRoute()` does the routing and removes stale entries. Precache too little rather than too much, and use runtime caching for the rest.
- Why: Precache uses a cache-only strategy: the network is used only during install; afterwards the Cache API answers. The Cache API is script-controlled and separate from the HTTP cache controlled by `Cache-Control`.
- Example:
  ```js
  // sw.js (Workbox), manifest injected at build time
  import { precacheAndRoute } from 'workbox-precaching';
  precacheAndRoute(self.__WB_MANIFEST); // [{url:'/app-8c1d.js',revision:null},{url:'/index.html',revision:'a1b2'}]
  ```
- Avoid/caveats: Precaching consumes bandwidth, storage and CPU at install, competing with the first visit. Without version tracking you serve stale files.
- Status: service workers Baseline widely available (webstatus: widely since 2020-10-30).
- Sources: https://web.dev/learn/performance/prefetching-prerendering-precaching, https://api.webstatus.dev/v1/features?q=name:worker

---

## D. Web workers

### Move expensive non-DOM work into a dedicated worker
- Layer: js
- Stage: main-thread-task, script-run, script-compile
- Metrics: INP, TBT, LCP, FPS/smoothness
- When: interaction, long-lived session, load
- Impact: high for data-heavy apps, because parsing, decoding, aggregation and heavy math otherwise create long tasks.
- Do: Put fetch + decode + transform pipelines (for example parsing binary market data, computing indicators, extracting metadata) in a `Worker`. Import heavy libraries inside the worker so their download, parse and compile also leave the main thread. Send only the final, render-ready result back; do DOM or chart updates on the main thread.
- Why: A worker runs on its own thread; in the course demo everything except inserting the result HTML moved off the main thread, including loading the `exif-reader` library.
- Example:
  ```js
  // main.ts
  const worker = new Worker(new URL('./bars.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => series.appendRange(data.x, data.y);
  worker.postMessage({ url: '/api/bars?sym=EURUSD' });

  // bars.worker.ts
  import { decodeBars } from './codec'; // parsed/compiled in the worker
  self.onmessage = async ({ data }) => {
    const buf = await (await fetch(data.url)).arrayBuffer();
    const { x, y } = decodeBars(buf); // Float64Arrays
    self.postMessage({ x, y }, [x.buffer, y.buffer]); // transfer, no copy
  };
  ```
- Avoid/caveats: OMT does not reduce total work; message overhead can make the total slightly slower. The gain is responsiveness and robustness on slow devices (PROXX case: UI keeps shipping frames). Workers cannot access the DOM or many APIs (WebRTC, Web Audio, WebUSB).
- Status: dedicated workers Baseline widely available (webstatus). OffscreenCanvas and `requestAnimationFrame()` in workers are Baseline widely available since 2025-09-27 (webstatus), which enables worker-side canvas drawing.
- Sources: https://web.dev/learn/performance/web-worker-overview, https://web.dev/learn/performance/web-worker-demo, https://web.dev/articles/off-main-thread

### Create module workers with new URL(..., import.meta.url)
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, startup
- When: build
- Impact: low, because it mainly makes bundling of worker code correct and lets workers use static `import`.
- Do: Write `new Worker(new URL('./x.worker.js', import.meta.url), { type: 'module' })` directly in the call. Webpack 5 and Vite detect this pattern and emit a separate worker chunk. Use `importScripts()` only for classic workers.
- Why: The 2019 off-main-thread article says bundlers need plugins; that is outdated: webpack 5 supports workers "without worker-loader", and Vite calls the constructor form the recommended way.
- Avoid/caveats: Vite only detects the pattern when `new URL()` is used directly inside `new Worker()`.
- Status: module workers Baseline widely available (webstatus: newly 2023-06-06, widely 2025-12-06; Chrome 80, Firefox 114, Safari 15).
- Sources: https://web.dev/learn/performance/web-worker-demo, https://webpack.js.org/guides/web-workers/, https://vite.dev/guide/features, https://api.webstatus.dev/v1/features/js-modules-workers

### Keep worker messages small; transfer large binary data
- Layer: js
- Stage: main-thread-task, gc-memory
- Metrics: INP, memory, FPS/smoothness
- When: long-lived session
- Impact: medium, because structured-clone of big object graphs costs time on both threads.
- Do: Send typed arrays and transfer their buffers (second argument of `postMessage`) instead of large JSON-like objects. Batch updates rather than one message per item. Consider Comlink for RPC-style calls when the protocol grows.
- Why: Surma's 2019 guidance: copying stays inside the performance budget when the object's JSON form is under about 10 KB; for larger data use ArrayBuffer (or WebAssembly).
- Avoid/caveats: A transferred buffer becomes unusable (detached) on the sending side. The 10 KB figure is from a 2019 article and a single author.
- Status: postMessage with transfer lists is long supported; n/a.
- Sources: https://web.dev/articles/off-main-thread, https://web.dev/learn/performance/web-worker-overview

### Fetch only the bytes you need (HTTP Range)
- Layer: network
- Stage: network, gc-memory
- Metrics: memory, bundle-size (bytes), INP
- When: interaction
- Impact: low to medium, because it avoids downloading and decoding whole files when a header or slice is enough.
- Do: When you need only metadata or a slice of a large resource, send a `Range: bytes=0-65535` request (the course demo reads only the first 64 KiB of a JPEG for Exif).
- Why: Less transfer and less data to parse.
- Avoid/caveats: The server must support range requests; cross-origin needs CORS.
- Status: n/a.
- Sources: https://web.dev/learn/performance/web-worker-demo

---

## E. LCP

### Make the LCP resource discoverable in the initial HTML
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP
- When: load
- Impact: high, because resource load delay is the largest avoidable LCP cost (top-cwv: poor-LCP pages delay the LCP image by 1,290 ms at p75, and 35% of LCP image URLs were not in the initial HTML).
- Do: Use an `<img>` with `src`/`srcset` in server HTML. If the LCP resource is a CSS background image or a web font, add `<link rel="preload">` (or a `Link` header) for it. Prefer SSR/SSG over client-rendered markup for the LCP element.
- Why: The preload scanner can start the fetch only for URLs it sees in the HTML. Images added by JS, hidden in `data-src`, referenced from CSS files, or in inline `style` attributes wait for scripts/CSS.
- Example:
  ```html
  <link rel="stylesheet" href="/app.css">
  <link rel="preload" as="image" href="/hero.avif" type="image/avif" fetchpriority="high">
  ```
- Avoid/caveats: Rule of thumb: the LCP resource should start loading together with the first subresource; also check it relative to TTFB.
- Status: preload Baseline; n/a.
- Sources: https://web.dev/articles/optimize-lcp, https://web.dev/articles/top-cwv

### Give the LCP image fetchpriority="high" (only one or two), and lower hidden images
- Layer: html
- Stage: network
- Metrics: LCP
- When: load
- Impact: high, because images start at low priority (not render-blocking) and the boost gives them bandwidth earlier.
- Do: Put `fetchpriority="high"` on the likely LCP `<img>` or its preload. Put `fetchpriority="low"` on early-in-DOM but invisible images (carousel slides 2..n).
- Why: Priority hints change the browser's queueing and bandwidth share; top-cwv notes only 15% of eligible pages used it.
- Example: `<img src="/slide-3.webp" fetchpriority="low" alt="">`
- Avoid/caveats: Marking more than one or two resources high cancels the effect. Always verify priority in DevTools and in the field.
- Status: Baseline newly available since 2024-10-29 (Chrome 102/103, Firefox 132, Safari 17.2); widely available expected 2027-04 (webstatus).
- Sources: https://web.dev/articles/optimize-lcp, https://api.webstatus.dev/v1/features/fetch-priority

### Serve the LCP resource from the page's own origin
- Layer: network
- Stage: network
- Metrics: LCP
- When: load
- Impact: medium, because a new origin needs DNS + TCP + TLS before the first byte.
- Do: Host critical images and fonts on the HTML origin, or proxy the (image) CDN through your origin. If you cannot, add `<link rel="preconnect">` to that origin.
- Why: Reusing the existing connection removes connection setup from resource load delay.
- Avoid/caveats: Preconnect only a few origins; unused preconnects waste sockets.
- Status: n/a.
- Sources: https://web.dev/articles/optimize-lcp

### Remove render-blocking work that delays the LCP element after its resource arrives
- Layer: html
- Stage: cssom, script-compile, script-run, html-parse
- Metrics: LCP, FCP
- When: load
- Impact: high, because element render delay should be under 10% of LCP.
- Do: Do not put synchronous `<script src>` in `<head>`; use `defer`/`async`/`type="module"`, or inline only tiny scripts. Keep render-blocking CSS smaller than the LCP resource: remove unused CSS, split critical vs deferred CSS, minify and compress. Inline CSS only when it is small.
- Why: A stylesheet or sync script that loads slower than the LCP image blocks rendering of the already-downloaded image.
- Example:
  ```html
  <!-- Before --> <head><script src="/main.js"></script></head>
  <!-- After  --> <head><script src="/main.js" defer></script></head>
  ```
- Avoid/caveats: Inlined CSS/JS cannot be cached across pages.
- Status: n/a.
- Sources: https://web.dev/articles/optimize-lcp

### Do not hide or build the LCP element with JavaScript
- Layer: js
- Stage: script-run, layout, paint
- Metrics: LCP
- When: load
- Impact: high, because optimizing the download is useless if JS reveals the element later (the saved time only moves to element render delay).
- Do: Render the LCP element in server HTML (SSR or, better, SSG). Do not hide content until an A/B-testing or client-render script finishes.
- Why: Improvements to one sub-part can shift time to another sub-part without improving LCP.
- Avoid/caveats: SSR adds server time (TTFB), usually worth it because server time is under your control.
- Status: n/a.
- Sources: https://web.dev/articles/optimize-lcp

### Keep the main thread free during load so the LCP image can paint
- Layer: js
- Stage: main-thread-task, paint
- Metrics: LCP, TBT
- When: load
- Impact: medium, because all browsers render images on the main thread; a long unrelated task delays the paint.
- Do: Split and defer large startup scripts; yield in long startup work (see INP section); move work to workers.
- Why: Even a fully downloaded image waits for the current long task to end.
- Status: n/a.
- Sources: https://web.dev/articles/optimize-lcp, https://web.dev/articles/off-main-thread

### Shorten LCP resource load duration: smaller bytes, closer server, less contention, cache
- Layer: network
- Stage: network
- Metrics: LCP
- When: load
- Impact: medium, because web.dev's data says load duration is usually not the main bottleneck, but it still is ~40% of a good LCP.
- Do: Serve right-sized, modern-format, compressed images (an image CDN automates this). Use a CDN. Avoid many simultaneous high-priority requests. Use long `Cache-Control` for repeat visits. For a text LCP, use a `font-display` other than `auto`/`block` so text does not wait for the font. Inline a very small LCP image as a data URL only when it is tiny.
- Why: Each lever removes network time; caching removes it completely on repeat visits.
- Avoid/caveats: Data URLs cannot be cached and can add decode time. Third-party image CDNs add a connection cost.
- Status: n/a.
- Sources: https://web.dev/articles/optimize-lcp

### Measure LCP sub-parts in the field, not only in the lab
- Layer: tooling
- Stage: network, paint
- Metrics: LCP, TTFB
- When: testing, long-lived session
- Impact: medium, because it shows which sub-part to fix.
- Do: Collect LCP with the web-vitals attribution build (it computes the four sub-parts from the LCP, Navigation Timing and Resource Timing APIs). Report only the last LCP entry; ignore pages loaded in a background tab. Set `Timing-Allow-Origin` on cross-origin LCP images for exact render time.
- Why: Lab loads often have warm caches and no redirects. LCP entries stop after the first user input (tap, scroll, key). Since Chrome 133 a coarsened render time is exposed even without `Timing-Allow-Origin`.
- Example:
  ```js
  import { onLCP } from 'web-vitals/attribution';
  onLCP(({ value, attribution: a }) => send({ value,
    ttfb: a.timeToFirstByte, delay: a.resourceLoadDelay,
    load: a.resourceLoadDuration, render: a.elementRenderDelay }));
  ```
- Avoid/caveats: `<svg>` elements are not LCP candidates (an `<img src="x.svg">` is). Chromium ignores opacity-0, full-viewport and low-entropy placeholder images as LCP candidates.
- Status: LCP entries now Baseline newly available (2025-12-12): Chrome 77, Firefox 122, Safari 26.2 (webstatus). Attribution property names checked against the web-vitals README (v6.2.2, main branch, 2026-09).
- Sources: https://web.dev/articles/optimize-lcp, https://web.dev/articles/lcp, https://api.webstatus.dev/v1/features/largest-contentful-paint

---

## F. TTFB (code-level parts only)

### Link to final URLs; avoid redirect chains and cache-busting query strings
- Layer: html
- Stage: network
- Metrics: TTFB, LCP, FCP
- When: load
- Impact: medium, because each redirect adds a full request round trip before any HTML.
- Do: Link with the `https://` scheme and the canonical trailing-slash form. Give advertisers and newsletters the final URL. Use HSTS (and the preload list) to skip HTTP-to-HTTPS redirects. Do not add unique analytics query parameters that make CDN caches miss.
- Why: Same-origin redirects are fully in your control; unique query strings look like different documents to the CDN edge.
- Status: n/a.
- Sources: https://web.dev/articles/optimize-ttfb, https://web.dev/articles/optimize-lcp

### Stream HTML (streaming SSR or static files)
- Layer: build
- Stage: network, html-parse
- Metrics: TTFB, FCP, LCP, INP
- When: load
- Impact: high for server-rendered apps, because the browser parses and renders streamed chunks incrementally and yields between them.
- Do: Use the streaming server-render APIs of your framework (for example React's streaming renderer on Node/Deno), or pre-generate static HTML at build time for pages that are not personalized.
- Why: Synchronous SSR holds all bytes until the whole page is ready. Streamed HTML gives free incremental parsing and automatic yielding, which also helps INP during load.
- Status: n/a.
- Sources: https://web.dev/articles/optimize-ttfb, https://web.dev/articles/client-side-rendering-of-html-and-interactivity

### Use service-worker strategies that answer navigations from cache when safe
- Layer: js
- Stage: network
- Metrics: TTFB, LCP
- When: load, long-lived session
- Impact: medium, because a cache hit in the service worker makes document TTFB nearly instant.
- Do: Use stale-while-revalidate for documents that rarely change and for non-critical assets; use network-first for personalized or authenticated HTML; use an app-shell model for client-rendered apps. Advanced: a streaming service worker that combines cached shell parts with a network body stream.
- Why: The service worker is a proxy between page and server.
- Avoid/caveats: A service worker that goes to the network anyway adds its own startup time; stale content risk.
- Status: service workers Baseline widely available.
- Sources: https://web.dev/articles/optimize-ttfb, https://web.dev/articles/client-side-rendering-of-html-and-interactivity

### Send 103 Early Hints for render-critical resources when the backend is slow
- Layer: network
- Stage: network, preload-scan
- Metrics: FCP, LCP
- When: load
- Impact: medium for pages with long server think time, low for static sites.
- Do: While the server builds the HTML, send `103` with `Link: </app.css>; rel=preload; as=style` and `rel=preconnect` for critical origins. Measure real server time with `Server-Timing` or `finalResponseHeadersStart`, because 103 makes TTFB look faster.
- Why: The browser starts critical downloads during server think time.
- Avoid/caveats: Browsers process only the first 103 and drop it on a cross-origin redirect; send it only over HTTP/2+.
- Status: Chrome 103, Firefox 120 (preload from 123), Safari 17 (preconnect only; no preload) (MDN BCD 2026-09-17).
- Sources: https://web.dev/articles/optimize-ttfb, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/103

### Instrument the backend with Server-Timing
- Layer: tooling
- Stage: network
- Metrics: TTFB
- When: testing, long-lived session
- Impact: low (diagnostic), because it tells you which backend step causes slow TTFB.
- Do: Emit `Server-Timing: db;dur=121.3, ssr;dur=212.2` (entries separated by commas, parts by semicolons). Read it in RUM from the navigation entry's `serverTiming`. Also emit CDN cache hit/miss. Provide a way to bypass CDN caches when testing.
- Why: Field TTFB includes redirects and cache misses that lab runs miss.
- Example:
  ```js
  const [nav] = performance.getEntriesByType('navigation');
  for (const t of nav.serverTiming) report(t.name, t.duration, t.description);
  ```
- Avoid/caveats: The guide's own snippet calls `getEntries('navigation')`; the correct call is `getEntriesByType('navigation')`.
- Status: Server-Timing Baseline widely available (webstatus: widely 2025-09-27).
- Sources: https://web.dev/articles/optimize-ttfb, https://api.webstatus.dev/v1/features?q=name:timing

---

## G. CLS

### Set width and height on every image and video
- Layer: html
- Stage: layout
- Metrics: CLS
- When: load
- Impact: high, because unsized images start at 0 px height and push content down when they load (66% of pages have at least one unsized image).
- Do: Add `width`/`height` attributes (intrinsic pixel values) and CSS `width: 100%; height: auto` (or `max-width`). Keep all `srcset` candidates at the same aspect ratio. For art direction, put `width`/`height` on each `<source>` inside `<picture>`. Use CSS `aspect-ratio` for other boxes.
- Why: Browsers map the attributes to `aspect-ratio: auto W / H` before the image loads; `auto` lets the real image ratio win after load.
- Example:
  ```html
  <picture>
    <source media="(max-width: 799px)" srcset="/chart-sm.webp" width="480" height="400">
    <img src="/chart-lg.webp" width="800" height="400" alt="Chart preview">
  </picture>
  ```
- Avoid/caveats: A wrong ratio still shifts a little after load, but less than 0 x 0.
- Status: `aspect-ratio` Baseline widely available (2024-03-20); `width`/`height` on `<source>`: Chrome 90, Firefox 108, Safari 15 (MDN BCD).
- Sources: https://web.dev/articles/optimize-cls, https://web.dev/articles/top-cwv

### Reserve space for ads, embeds, iframes and late content
- Layer: css
- Stage: layout
- Metrics: CLS
- When: load
- Impact: high, because late-loading third-party content is a top CLS cause.
- Do: Give slots a `min-height` (or `aspect-ratio`) matching the most likely or smallest size, per breakpoint with media queries. Keep the space (show a placeholder) when nothing is returned. If you cannot reserve space, place injected content lower on the page.
- Why: Any size is better than the 0 px default of an empty container; removing reserved space shifts content as much as inserting it.
- Example:
  ```css
  .ad-slot { min-height: 250px; }
  @media (max-width: 600px) { .ad-slot { min-height: 100px; } }
  .embed { aspect-ratio: 16 / 9; width: 100%; }
  ```
- Avoid/caveats: Over-reserving leaves blank space.
- Status: CSS features Baseline widely available.
- Sources: https://web.dev/articles/optimize-cls, https://web.dev/articles/top-cwv

### Never insert content above existing content without a user action
- Layer: js
- Stage: layout
- Metrics: CLS
- When: interaction, long-lived session
- Impact: high for live-updating UIs (feeds, lists, banners), because post-load shifts count for the whole page life.
- Do: Load new items on a user action ("Load more", "Refresh") and prefetch them first so they appear within 500 ms. Or replace content inside a fixed-size container (disable its controls during the transition). Or load off-screen and show an overlay notice ("New items, scroll to top"). Overlay banners instead of pushing content; use skeletons with the final size. If a fetch will take longer than 500 ms, reserve the final space immediately inside the 500 ms window.
- Why: Only shifts within 500 ms of a discrete input (not hover or scroll) are excluded from CLS.
- Avoid/caveats: Shifts on hover and during scroll always count.
- Status: n/a.
- Sources: https://web.dev/articles/optimize-cls, https://web.dev/articles/cls

### Animate transform and opacity, never layout properties
- Layer: css
- Stage: layout, composite
- Metrics: CLS, FPS/smoothness, INP
- When: animation/render-loop
- Impact: high, because animating `top`/`left`/`margin`/`width`/`border` causes layout shifts even for absolutely positioned elements (pages animating margin or border widths have "poor" CLS at about twice the overall rate).
- Do: Use `transform: translate()/scale()` for movement and size effects. Animate layout properties only as a direct response to a tap or key press (not hover).
- Why: Composited `transform` animations do not run layout and do not count toward CLS; they can run off the main thread.
- Example:
  ```css
  /* Before */ .toast { transition: top .3s; top: -60px; } .toast.show { top: 0; }
  /* After  */ .toast { transition: transform .3s; transform: translateY(-100%); } .toast.show { transform: none; }
  ```
- Avoid/caveats: Respect `prefers-reduced-motion`.
- Status: n/a.
- Sources: https://web.dev/articles/optimize-cls, https://web.dev/articles/top-cwv, https://web.dev/articles/cls

### Minimize font-swap shifts
- Layer: css
- Stage: layout, paint, network
- Metrics: CLS, LCP
- When: load
- Impact: medium, because both FOUT and FOIT re-lay out text when the web font arrives.
- Do: Use `font-display: optional` where acceptable. Always end `font-family` with a matching generic family (`sans-serif`), not the default serif. Match fallback metrics with `size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`. Preload critical fonts.
- Why: Invisible text is still laid out with the fallback font, so it shifts the same way when swapped.
- Example:
  ```css
  @font-face { font-family: "Inter-fallback"; src: local("Arial"); size-adjust: 107%; ascent-override: 90%; }
  body { font-family: "Inter", "Inter-fallback", sans-serif; }
  ```
- Avoid/caveats: `optional` can mean the web font is not used on the first visit.
- Status: not re-verified here (fonts are covered by another note).
- Sources: https://web.dev/articles/optimize-cls

### Measure CLS over the whole page life and find the cause, not the victim
- Layer: tooling
- Stage: layout
- Metrics: CLS
- When: testing, long-lived session
- Impact: medium, because lab tools see only load CLS; CrUX sees post-load shifts too.
- Do: Use DevTools Performance "Layout shifts" track and live metrics while interacting; use web-vitals attribution in RUM. Remember Lighthouse lists the shifted elements, often below the real cause (the inserted element above).
- Why: Disagreement between CrUX and Lighthouse CLS usually means post-load shifts (lazy content while scrolling, hover shifts, slow SPA transitions > 500 ms).
- Avoid/caveats: Shifts inside iframes are visible to users and counted by CrUX but not observable by web APIs.
- Status: `LayoutShift` API is Chromium-only (Chrome 77; MDN BCD).
- Sources: https://web.dev/articles/optimize-cls

---

## H. INP

### Yield to the main thread with scheduler.yield() (with a fallback)
- Layer: js
- Stage: main-thread-task, microtask
- Metrics: INP, TBT, FPS/smoothness
- When: interaction, load, long-lived session
- Impact: high, because tasks run to completion and any task > 50 ms blocks input handling and rendering.
- Do: Insert `await yieldToMain()` between chunks of work, especially after the user-visible update. Use `scheduler.yield()` where available; fall back to `setTimeout(0)`. `await` every yield; do not yield inside `Array.prototype.forEach` callbacks.
- Why: The continuation after `scheduler.yield()` runs before other queued tasks of the same priority (including third-party tasks), unlike `setTimeout`, which goes to the back of the queue.
- Example:
  ```js
  const yieldToMain = () => globalThis.scheduler?.yield
    ? scheduler.yield()
    : new Promise((r) => setTimeout(r, 0));

  async function onApplyTemplate() {
    applyVisibleStyles();      // user-visible first
    await yieldToMain();       // let the frame paint
    persistTemplate();         // background work
    sendAnalytics();
  }
  ```
- Avoid/caveats: Do not yield between two updates that must appear together. The one-liner `await globalThis.scheduler?.yield?.()` only waits a microtask where unsupported (no real yield). The article says nested `setTimeout` is clamped to 5 ms after 5 levels; the HTML spec says the clamp is 4 ms when nesting level > 5.
- Status: `scheduler.yield()` Chrome/Edge 129, Firefox 142, no Safari (MDN BCD 2026-09-17); not Baseline. `scheduler.postTask()` Chrome 94, Firefox 142, no Safari; priorities `user-blocking`, `user-visible` (default), `background`.
- Sources: https://web.dev/articles/optimize-long-tasks, https://web.dev/articles/optimize-inp, https://developer.mozilla.org/en-US/docs/Web/API/Prioritized_Task_Scheduling_API, https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html

### Yield by time budget, not after every item
- Layer: js
- Stage: main-thread-task
- Metrics: INP, TBT
- When: interaction, long-lived session
- Impact: medium, because yielding has overhead; many tiny jobs would spend more time yielding than working.
- Do: Process a queue in a loop and yield only when about 50 ms have passed since the last yield (tune the deadline).
- Example:
  ```js
  async function runJobs(jobs, budgetMs = 50) {
    let last = performance.now();
    for (const job of jobs) {
      job();
      if (performance.now() - last > budgetMs) { await yieldToMain(); last = performance.now(); }
    }
  }
  ```
- Avoid/caveats: A shorter budget improves responsiveness but lengthens total completion time.
- Status: n/a.
- Sources: https://web.dev/articles/optimize-long-tasks

### Run only the next-frame update inside the event handler; defer the rest
- Layer: js
- Stage: main-thread-task, paint
- Metrics: INP
- When: interaction
- Impact: high, because processing duration and presentation delay include everything the handler does before the frame.
- Do: In the handler, apply only the visual change for the next frame. Queue secondary work (counters, validation, persistence, analytics) with `requestAnimationFrame(() => setTimeout(work, 0))` or after a yield.
- Why: The rAF + setTimeout pair schedules a task after the next frame in all browsers, so the paint is not blocked.
- Example:
  ```js
  input.addEventListener('input', (e) => {
    renderValue(e.target.value);                 // visible now
    requestAnimationFrame(() => setTimeout(() => {
      recalcTotals(); validate(); saveDraft();   // after the frame
    }, 0));
  });
  ```
- Avoid/caveats: Deferred work can still block the next interaction; keep it small or yield inside it.
- Status: n/a.
- Sources: https://web.dev/articles/optimize-inp, https://web.dev/articles/optimize-long-tasks

### Do not use isInputPending() for yielding decisions
- Layer: js
- Stage: main-thread-task
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: low, because the fix is to remove it.
- Do: Yield unconditionally (by time budget) instead of only when `navigator.scheduling.isInputPending()` is true.
- Why: It can return false after real input, and input is not the only reason to yield (rendering and animations matter too). Google reversed its recommendation in 2024.
- Status: Chromium-only (87+); no longer recommended by web.dev.
- Sources: https://web.dev/articles/optimize-long-tasks, https://web.dev/articles/top-cwv

### Read layout before you write styles; never interleave in loops
- Layer: js
- Stage: style, layout
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: high, because each read after a write forces a synchronous style + layout (layout thrashing).
- Do: Batch all reads (`offsetWidth`, `getBoundingClientRect()`, and similar) first, then all writes. Read values at the start of a rAF callback where the previous frame's layout is still valid.
- Example:
  ```js
  // Before: layout per iteration
  for (const p of rows) p.style.width = `${header.offsetWidth}px`;
  // After: one read, many writes
  const w = header.offsetWidth;
  for (const p of rows) p.style.width = `${w}px`;
  ```
- Why: The browser must apply pending style changes and run layout to answer a geometry read.
- Avoid/caveats: Find cases with the DevTools "Forced reflow" insight, and in the field with LoAF script attribution `forcedStyleAndLayoutDuration`.
- Status: LoAF Chromium-only (Chrome 123; MDN BCD).
- Sources: https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing, https://web.dev/articles/optimize-inp

### Avoid layout-triggering style changes where you can
- Layer: css
- Stage: style, layout
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium, because layout is usually scoped to the whole document and scales with DOM size.
- Do: Prefer changes that do not alter geometry (`transform`, `opacity`) over `width`/`height`/`left`/`top`. When layout is necessary, limit how many elements it touches.
- Why: One trace in the article showed 28 ms of layout per frame against a 16 ms frame budget.
- Status: n/a.
- Sources: https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing

### Keep the DOM small and shallow; add DOM on demand
- Layer: html
- Stage: style, layout, paint, gc-memory
- Metrics: INP, LCP, memory
- When: load, interaction
- Impact: medium to high, because style/layout/paint work grows with DOM size (not linearly), both at first render and on each update.
- Do: Flatten wrapper-div chains; use framework fragments (React, Preact, Vue, Svelte); use flexbox/grid instead of nesting for layout. Leave initially hidden UI out of the DOM and add it when the user opens it (show a loading indicator if it needs data). Avoid `querySelectorAll` on huge node sets that you keep in memory.
- Why: Lighthouse (per the 2023 article) warns above 800 nodes and flags "excessive" above 1,400 nodes.
- Avoid/caveats: The additive approach moves cost to the interaction that adds the DOM. The 800/1,400 thresholds were not re-checked against the current Lighthouse insight.
- Status: n/a.
- Sources: https://web.dev/articles/dom-size-and-interactivity, https://web.dev/articles/optimize-inp

### Skip off-screen rendering with content-visibility
- Layer: css
- Stage: style, layout, paint
- Metrics: INP, LCP, FPS/smoothness
- When: load, interaction, long-lived session
- Impact: medium to high for long pages and panels, because off-screen subtrees skip style, layout and paint (demo: 232 ms to 30 ms rendering).
- Do: Apply `content-visibility: auto` with `contain-intrinsic-size: auto <estimate>` to independent sections. Use `content-visibility: hidden` for inactive views/tabs you will show again (keeps rendering state, unlike `display: none`). Add `aria-hidden="true"` to off-screen landmark elements that are hidden by styles if accessibility-tree clutter matters.
- Why: `auto` adds layout/style/paint containment, and size containment while off-screen; `contain-intrinsic-size: auto` remembers the last rendered size, so the scrollbar stays stable.
- Example:
  ```css
  .panel-section { content-visibility: auto; contain-intrinsic-size: auto 480px; }
  .view[inactive] { content-visibility: hidden; }
  ```
- Avoid/caveats: DOM APIs that force rendering (geometry reads) on skipped subtrees cancel the benefit. A wrong intrinsic size estimate can cause scroll jumps.
- Status: `content-visibility` Baseline newly available since 2025-09-15 (Chrome 85/108, Firefox 125/130, Safari 18/26 depending on source); `contain-intrinsic-size` Baseline widely available (2026-03-18) (webstatus, caniuse).
- Sources: https://web.dev/articles/content-visibility, https://web.dev/articles/dom-size-and-interactivity, https://api.webstatus.dev/v1/features/content-visibility

### Limit client-side HTML rendering; prefer server-streamed HTML
- Layer: js
- Stage: html-parse, style, layout, main-thread-task
- Metrics: INP, LCP, TBT
- When: load, interaction
- Impact: medium, because large `innerHTML` or DOM construction runs as one unbroken task, and JS-created markup hides resources from the preload scanner.
- Do: Server-render (and hydrate) the initial view. When you must build DOM on the client, create small amounts per task and yield between batches. Never use `document.write`.
- Why: Streamed server HTML is parsed in chunks with automatic yields; client-rendered HTML is not.
- Avoid/caveats: Hydration still costs JS time.
- Status: n/a.
- Sources: https://web.dev/articles/client-side-rendering-of-html-and-interactivity, https://web.dev/articles/optimize-inp

### Avoid heavy recurring timers
- Layer: js
- Stage: main-thread-task
- Metrics: INP
- When: long-lived session
- Impact: medium, because a `setInterval` callback that fires during an interaction adds to its input delay.
- Do: Remove timers you do not need; keep timer callbacks tiny; prefer a recursive `setTimeout` that schedules the next run after the current one ends. Audit third-party scripts for intervals.
- Why: Recurring timers are statistically likely to collide with user input.
- Status: n/a.
- Sources: https://web.dev/articles/optimize-input-delay

### Debounce rapid input and abort stale requests
- Layer: js
- Stage: main-thread-task, network
- Metrics: INP
- When: interaction
- Impact: medium, because overlapping interactions (fast typing) queue expensive handlers and fetch callbacks.
- Do: Debounce expensive work on key or input events. Abort the previous `fetch` with `AbortController` when a new query starts; the same `signal` can remove event listeners.
- Example:
  ```js
  let ctrl;
  search.addEventListener('input', debounce(async (e) => {
    ctrl?.abort();
    ctrl = new AbortController();
    try {
      const res = await fetch(`/api/symbols?q=${encodeURIComponent(e.target.value)}`, { signal: ctrl.signal });
      renderResults(await res.json());
    } catch (err) { if (err.name !== 'AbortError') throw err; }
  }, 150));
  ```
- Status: `AbortController` Baseline widely available (not re-checked here).
- Sources: https://web.dev/articles/optimize-input-delay

### Prefer composited CSS animations over requestAnimationFrame-driven JS animations
- Layer: css
- Stage: composite, main-thread-task
- Metrics: INP, FPS/smoothness
- When: animation/render-loop
- Impact: medium, because many rAF callbacks compete with input handling on the main thread.
- Do: Use CSS animations/transitions of compositor-friendly properties for decorative motion; keep rAF loops for work that truly needs per-frame script (for example canvas/WebGL drawing) and keep each callback short.
- Why: Composited animations run mainly on the compositor thread/GPU, not on the main thread.
- Status: n/a.
- Sources: https://web.dev/articles/optimize-input-delay

### Simplify CSS selectors and reduce the number of invalidated elements
- Layer: css
- Stage: style
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: low to medium, because style recalculation is part of presentation delay; element count usually matters more than selector complexity.
- Do: Prefer single class selectors over structural ones like `.box:nth-last-child(-n+1) .title`. Change classes on the smallest subtree that needs it. Use DevTools "Selector stats" to find expensive selectors.
- Why: Worst-case style cost is about elements x selectors; about half of Blink style time is selector matching.
- Avoid/caveats: Shadow DOM scopes styles per component, which helps.
- Status: n/a (article dated 2015 with later updates).
- Sources: https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations

### Ship less JavaScript at startup
- Layer: build
- Stage: script-compile, script-run
- Metrics: INP, TBT, bundle-size, startup
- When: build, load
- Impact: high, because script evaluation during load is the main source of input delay for early interactions.
- Do: Use Baseline widely available platform features instead of JS re-implementations; remove unused code (Coverage panel); code-split; prune tag-manager tags. Load third-party scripts late.
- Why: Every script needs parse, compile and execute on the main thread before interactions can be handled.
- Status: n/a.
- Sources: https://web.dev/articles/top-cwv, https://web.dev/articles/script-evaluation-and-long-tasks

### Remember each iframe has its own main thread, but INP includes iframe interactions
- Layer: html
- Stage: main-thread-task
- Metrics: INP
- When: interaction
- Impact: low to medium, because a slow embed can give the page a bad INP.
- Do: When an INP interaction is inside an iframe, profile that frame's main thread. Lazy-load or facade heavy iframes.
- Why: INP is reported at page level, including slow interactions in iframes; on weak devices threads still compete for the same CPU.
- Status: n/a.
- Sources: https://web.dev/articles/optimize-inp

### Measure INP in the field with attribution
- Layer: tooling
- Stage: main-thread-task
- Metrics: INP
- When: testing, long-lived session
- Impact: medium, because lab tests rarely reproduce the slow interaction.
- Do: Use a RUM tool or the web-vitals library (attribution build) to capture the interaction target, type, load state and the three sub-parts. If you use the raw Event Timing API, also observe `first-input` and set `durationThreshold` (minimum 16 ms; default reporting starts at 104 ms). Interact during load in the lab, when the main thread is busiest.
- Example:
  ```js
  import { onINP } from 'web-vitals/attribution';
  onINP(({ value, attribution: a }) => send({ value, target: a.interactionTarget,
    input: a.inputDelay, proc: a.processingDuration, pres: a.presentationDelay }));
  ```
- Status: Event Timing Baseline newly available (2025-12-12); `interactionId` Chrome 96, Firefox 144, Safari 26.2 (MDN BCD), so INP is now measurable cross-browser in RUM. CrUX data is still Chrome-only.
- Sources: https://web.dev/articles/optimize-inp, https://web.dev/articles/inp, https://api.webstatus.dev/v1/features/event-timing

---

## I. Back/forward cache (bfcache)

### Never register unload; use pagehide (and lock it with Permissions-Policy)
- Layer: js
- Stage: main-thread-task
- Metrics: LCP, CLS, INP (of back/forward navigations)
- When: long-lived session
- Impact: high, because an `unload` listener makes pages ineligible for bfcache in Firefox desktop and the handler is unreliable elsewhere.
- Do: Replace every `unload` listener (including in third-party code) with `pagehide`. Send `Permissions-Policy: unload=()` so no script or extension can add one.
- Why: `pagehide` fires whenever `unload` would, and also when the page enters bfcache.
- Example:
  ```js
  // Before: window.addEventListener('unload', flush);
  window.addEventListener('pagehide', flush);
  ```
- Avoid/caveats: Lighthouse has a `no-unload-listeners` audit.
- Status: Chrome is removing `unload` by default: top-50 sites done in M142 (2025-10-22), all sites rolled out 1% to 100% across M146-M154 (M154 = 2026-09-22, 100%); page last updated 2026-07-14. `Permissions-Policy: unload` Chrome 115+, experimental, Chromium-only.
- Sources: https://web.dev/articles/bfcache, https://developer.chrome.com/docs/web-platform/deprecating-unload

### Add beforeunload only while there are unsaved changes
- Layer: js
- Stage: main-thread-task
- Metrics: LCP, CLS (of back/forward navigations)
- When: long-lived session
- Impact: low, because modern browsers no longer block bfcache for it, but it was a blocker before and is unreliable.
- Do: Add the listener when the state becomes dirty; remove it right after saving.
- Example:
  ```js
  const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
  store.onDirtyChange((dirty) => dirty
    ? addEventListener('beforeunload', warn)
    : removeEventListener('beforeunload', warn));
  ```
- Status: `beforeunload` limited availability per webstatus (behavior differences).
- Sources: https://web.dev/articles/bfcache

### Use Cache-Control: no-store only for truly sensitive pages
- Layer: network
- Stage: network
- Metrics: LCP, CLS
- When: load
- Impact: medium, because `no-store` on the document blocks bfcache in some browsers.
- Do: For "always fresh but not sensitive" HTML use `Cache-Control: no-cache` or `max-age=0`. Keep `no-store` for pages that must never be restored.
- Why: bfcache restores from memory and ignores revalidation directives; `no-cache` does not affect bfcache eligibility.
- Avoid/caveats: Chrome now bfcaches `no-store` pages when safe: it evicts them on any cookie change and on WebSocket/WebTransport/WebRTC use or `no-store` fetch/XHR responses, with a 3-minute timeout (normal pages: 10 minutes). Other browsers may still block.
- Status: Chrome rollout to 100% in March-April 2025 (developer.chrome.com, updated 2025-09-09).
- Sources: https://web.dev/articles/bfcache, https://developer.chrome.com/docs/web-platform/bfcache-ccns

### Refresh stale or sensitive state on pageshow with persisted=true
- Layer: js
- Stage: main-thread-task, network
- Metrics: INP (of the restored page), CLS
- When: long-lived session
- Impact: medium, because restored pages show a snapshot: prices, carts or signed-out state can be stale.
- Do: On `pageshow` with `event.persisted`, re-fetch time-sensitive data, reconnect live feeds, and reload if the session ended.
- Example:
  ```js
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    if (!hasSessionCookie()) return location.reload();
    reconnectQuotes(); refreshPositions();
  });
  ```
- Status: `pageshow`/`pagehide` Baseline widely available (page transition events).
- Sources: https://web.dev/articles/bfcache

### Close IndexedDB, WebSocket and WebRTC connections on pagehide; reopen on pageshow
- Layer: js
- Stage: network, gc-memory
- Metrics: LCP, CLS
- When: long-lived session
- Impact: high for real-time apps, because open connections and in-flight fetch/XHR make pages ineligible in some browsers.
- Do: In `pagehide` (or `freeze`), close DB connections, sockets and peer connections, and disconnect observers. In `pageshow` (or `resume`), reopen them; guard against opening twice if you listen to several events.
- Example:
  ```js
  let ws;
  const open = () => { ws ??= connectQuotes(); };
  addEventListener('pageshow', open);
  addEventListener('pagehide', () => { ws?.close(); ws = undefined; });
  ```
- Why: Pausing tasks tied to cross-tab APIs (IndexedDB, Web Locks, WebSockets) could block other tabs, so browsers refuse to cache.
- Avoid/caveats: Chrome (as of 149) and Safari no longer block on open WebSockets; other browsers do (web.dev, updated 2026-07-02).
- Status: `freeze`/`resume` are Chromium-only (Chrome 68, experimental); use `pagehide`/`pageshow` cross-browser.
- Sources: https://web.dev/articles/bfcache

### Avoid window.opener relationships
- Layer: html
- Stage: network
- Metrics: LCP, CLS
- When: long-lived session
- Impact: low, because `noopener` is now the default for `target=_blank`.
- Do: Do not rely on `window.opener`; keep `rel="noopener"`. Avoid `window.open()` + controlling the opened window when possible.
- Why: A page with a live opener reference (either side) cannot enter bfcache.
- Status: n/a.
- Sources: https://web.dev/articles/bfcache

### Keep iframes from blocking the parent's bfcache
- Layer: html
- Stage: network
- Metrics: LCP, CLS
- When: load
- Impact: low to medium, because an embedded frame using a blocking API makes the whole page ineligible.
- Do: Restrict embeds with `sandbox` and Permissions Policy (`allow` attribute / header) so they cannot use APIs that block bfcache.
- Why: The main frame is cached with its iframes; iframes are not cached separately.
- Status: n/a.
- Sources: https://web.dev/articles/bfcache

### Test and monitor bfcache; adjust analytics and RUM for restores
- Layer: tooling
- Stage: network
- Metrics: LCP, INP, CLS
- When: testing, long-lived session
- Impact: medium, because a regression (a new unload listener, a new API) silently removes instant back/forward navigations.
- Do: Use DevTools Application > Back/forward cache "Run test" and the Lighthouse bfcache audit. In the field, read `notRestoredReasons` from the navigation entry, report navigation type (`back_forward_cache` on restore), send a page view on `pageshow` persisted, and in custom RUM reset CLS and INP to 0 on restore and use pageshow-to-next-frame as LCP (web-vitals does this).
- Why: 1 in 10 desktop and 1 in 5 mobile navigations are back/forward (Chrome data). bfcache does not apply to SPA soft navigations.
- Example:
  ```js
  const [nav] = performance.getEntriesByType('navigation');
  if (nav.notRestoredReasons) report('bfcache-miss', nav.notRestoredReasons);
  ```
- Avoid/caveats: Do not expect 100% hit rate (browser restart, tab duplicate, memory eviction).
- Status: `notRestoredReasons` Chrome 125+, experimental, Chromium-only (MDN BCD). bfcache itself exists in all major browsers.
- Sources: https://web.dev/articles/bfcache, https://web.dev/articles/top-cwv

---

## Sources read
- https://web.dev/learn/performance (course index)
- https://web.dev/learn/performance/code-split-javascript
- https://web.dev/learn/performance/lazy-load-images-and-iframe-elements
- https://web.dev/learn/performance/prefetching-prerendering-precaching
- https://web.dev/learn/performance/web-worker-overview
- https://web.dev/learn/performance/web-worker-demo
- https://web.dev/learn/performance/conclusion (404)
- https://web.dev/articles/optimize-lcp
- https://web.dev/articles/optimize-cls
- https://web.dev/articles/optimize-inp
- https://web.dev/articles/bfcache
- https://web.dev/articles/optimize-ttfb
- https://web.dev/articles/lcp
- https://web.dev/articles/inp
- https://web.dev/articles/cls
- https://web.dev/articles/vitals
- https://web.dev/articles/top-cwv
- https://web.dev/articles/optimize-long-tasks
- https://web.dev/articles/optimize-input-delay
- https://web.dev/articles/script-evaluation-and-long-tasks
- https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing
- https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations
- https://web.dev/articles/dom-size-and-interactivity
- https://web.dev/articles/client-side-rendering-of-html-and-interactivity
- https://web.dev/articles/content-visibility
- https://web.dev/articles/off-main-thread
- https://developer.chrome.com/docs/web-platform/prerender-pages
- https://developer.chrome.com/docs/web-platform/deprecating-unload
- https://developer.chrome.com/docs/web-platform/bfcache-ccns
- https://developer.chrome.com/blog/new-in-chrome-148
- https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/103
- https://developer.mozilla.org/en-US/docs/Web/API/Prioritized_Task_Scheduling_API
- https://v8.dev/features/modules
- https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html
- https://esbuild.github.io/api/
- https://webpack.js.org/guides/web-workers/
- https://vite.dev/guide/features
- https://raw.githubusercontent.com/GoogleChrome/web-vitals/main/README.md (v6.2.2)
- MDN browser-compat-data 8.1.2 (2026-09-17), via https://unpkg.com/@mdn/browser-compat-data/data.json
- caniuse data (2026-08-24), via https://raw.githubusercontent.com/Fyrd/caniuse/main/fulldata-json/data-2.0.json
- webstatus.dev API: https://api.webstatus.dev/v1/features/ (scheduler, fetch-priority, speculation-rules, content-visibility, loading-lazy, js-modules-workers, largest-contentful-paint, event-timing, aspect-ratio, link-rel-prefetch, and name searches)
- Search result only (not opened): https://developer.chrome.com/blog/prerender-until-script-origin-trial and the blog https://www.corewebvitals.io/pagespeed/prerender-until-script-speculation-rule (Chrome 144-150 origin-trial window)

## Not covered / could not access
- The course has no "Conclusion" module: https://web.dev/learn/performance/conclusion returns 404, and the course index lists only the 14 modules plus a quiz. Nothing to extract.
- Embedded demos (dynamic import demo, lazy-loading demos, prefetch/prerender demos, EXIF worker demo pages) were not run.
- TTFB hosting/CDN-vendor advice skipped by design (only code-level parts kept). CDN notes kept only where they change code (edge caching of HTML, query strings).
- Linked sub-guides not read: "Find slow interactions in the field", "Diagnose slow interactions in the lab", "Optimize animation-induced layout shifts", "Debug layout shifts", "Precaching dos and don'ts", "Rendering on the web", "Faster multipage applications with streams", "Improved font fallbacks", "Threading the web with module workers", "Common misconceptions about how to optimize LCP", "Implementing speculation rules for complex sites".
- The course claim that V8 streaming compilation needs the `.mjs` extension for modules is not confirmed: v8.dev says the file extension does not matter on the web as long as the MIME type is JavaScript. Treat as unverified.
- Lighthouse numbers (JS execution warn 2 s / fail 3.5 s; DOM size warn 800 / excessive 1,400 nodes) come from 2023 pages and were not re-checked against current Lighthouse insights.
- Workbox maintenance status was not verified in depth (search results only show ongoing GitHub activity).
- Lazy video/audio version conflict: Chrome blog says 148; MDN BCD and webstatus list 150.
