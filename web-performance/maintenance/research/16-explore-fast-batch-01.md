# web.dev "Fast" collection: batch 1 of 6 (Fetch Priority, input delay, DOM size, script evaluation, client-side rendering, fonts, field measurement, lazy video)

Scope: a full read of the 8 web.dev articles in `batches/fast-batch-01.md`. From each one I took every actionable lever and its mechanism. Browser support and deprecation status was checked on 2026-09-23 against MDN browser-compat-data (BCD) v8.1.2 (dated 2026-09-17), the webstatus.dev API, chromestatus.com, the Chrome docs, and the web-vitals README and npm registry.
Standard levers that other research files cover (Core Web Vitals guides, HTML loading attributes, CSS rendering, event loop) are listed once each in "## Standard levers seen". The detail goes to levers that are new, more specific, or changed since each article was written.

## Article dates and advice that is out of date (as of 2026-09-23)

| Article | Last updated | Out of date or changed |
|---|---|---|
| Optimize resource loading with the Fetch Priority API | 2023-11-14 | Still current. `fetchpriority` and `fetch(..., {priority})` are Baseline newly available since 2024-10-29 (Firefox 132). The priority tables describe Chrome only. |
| Optimize input delay | 2023-05-09 | The note says `scheduler.yield` "solves" third-party interleaving. It has shipped since then (Chrome 129, Firefox 142), but Safari does not support it yet. |
| How large DOM sizes affect interactivity | 2023-05-09 | **The Lighthouse thresholds (warn above 800 nodes, fail above 1,400) are out of date.** The DevTools/Lighthouse "Optimize DOM size" insight (2025-10-08) fails only when a layout or style recalculation takes more than 40 ms. `content-visibility: auto` became Baseline only on 2025-09-15. Svelte 5 no longer uses `<svelte:fragment>`. |
| Script evaluation and long tasks | 2023-05-09 | The note that "a potential solution is being explored" for Chromium running all deferred scripts in one task links to WHATWG issue #6230. That issue is still open, and I found no evidence that the behavior has changed. Module workers are now Baseline widely available (2025-12-06). |
| Client-side rendering of HTML and interactivity | 2023-05-09 | `document.write()` is marked deprecated in BCD. New APIs: `setHTMLUnsafe()`/`Document.parseHTMLUnsafe()` are Baseline 2025. Streaming insertion methods (`streamAppendHTML()` and related) are planned for Chrome 155, and the spec PR is still open. |
| Best practices for fonts | 2022-10-04 | **"Safari blocks text rendering indefinitely" is wrong.** WebKit has used a 3 s block since 2016. The `font-display` example in the article has CSS syntax errors, so do not copy it. The article names only `size-adjust`. `ascent-override`/`descent-override`/`line-gap-override` are still not supported in Safari, and `font-size-adjust` is now Baseline (2024). |
| Best practices for measuring Web Vitals in the field | 2022-05-11 | web-vitals is now v6.2.2 (2026-09-14). LCP and INP entries now exist in Firefox and in Safari 26.2 (Baseline 2025-12-12). CLS is Chromium only. Chrome 151 reports soft navigations. `unload` handlers stop running by default in Chrome, reaching 100% at Chrome 154 (2026-09-22). `fetchLater()` shipped in Chrome 135. `requestIdleCallback` is still not in Safari. |
| Lazy loading video | 2026-07-02 (first published 2019-08-16) | Current. `loading="lazy"` on `<video>`/`<audio>` is Chrome/Edge 150 only. Firefox and Safari implementations are in progress. |

---

## Fetch Priority (web.dev/articles/fetch-priority, 2023-11-14)

### Start the LCP image at High priority with `fetchpriority="high"` instead of waiting for the layout boost
- Layer: html
- Stage: network, preload-scan
- Metrics: LCP
- When: load
- Impact: high. Without the hint, an in-viewport image does not get High priority until layout has run.
- Do: Put `fetchpriority="high"` on the one `<img>` that is the LCP element, in the server HTML. Do not also put `loading="lazy"` on it.
- Why: In Chrome, images start at Low. Only after layout does Chrome find the in-viewport ones and raise them to High. Since Chrome 117, the first five images larger than 10,000 px² start at Medium, and during the early "tight mode" only two of them load in parallel. The attribute makes the image start at High as soon as the preload scanner finds it. In the article's Google Flights test, LCP went from 2.6 s to 1.9 s.
- Example:
  ```html
  <!-- Before: starts Low, raised to High only after layout -->
  <img src="/hero/btc-chart.webp" width="1200" height="600" alt="">
  <!-- After: starts High -->
  <img src="/hero/btc-chart.webp" width="1200" height="600" alt="" fetchpriority="high">
  ```
- Avoid/caveats: Mark only one or two images. When every image is high, the hint no longer helps. The hint does not make the image discoverable any earlier. If the image is created by JS or set as a CSS background, you also need a preload (see the next item). The priority tiers above are Chrome's. Firefox and Safari use their own heuristics.
- Status: `fetchpriority` on `img`/`link`/`script` is Chrome/Edge 101, Firefox 132, Safari 17.2. Baseline newly available since 2024-10-29 (webstatus.dev `fetch-priority`; BCD 8.1.2).
- Sources: https://web.dev/articles/fetch-priority

### Pair `preload` (for discovery) with `fetchpriority="high"` (for priority) for CSS-background and poster LCP images
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP
- When: load
- Impact: high. A preloaded image still gets the default Low/Medium image priority.
- Do: When the LCP image is a CSS `background-image` or a `<video poster>`, add `<link rel="preload" as="image" href="…" fetchpriority="high">` near the top of `<head>`.
- Why: Preload is a required fetch that fixes late discovery, but it keeps the priority for its destination. Image preloads default to Low or Medium, so they can wait behind other early resources. `fetchpriority` changes only the priority and does not help discovery. Together they fix both. If the preload is already the first item in `<head>`, adding `high` changes little. The later the preload sits, the more `high` helps.
- Example:
  ```html
  <link rel="preload" as="image" href="/img/depth-bg.avif" fetchpriority="high">
  ```
- Avoid/caveats: A preload is a mandatory download. A wrong or unused preload wastes bandwidth and triggers a console warning.
- Status: `link rel=preload` is Baseline widely available (2021). `fetchpriority` is Baseline 2024 (see above).
- Sources: https://web.dev/articles/fetch-priority, https://web.dev/articles/lazy-loading-video

### Lower in-viewport-but-unimportant images with `fetchpriority="low"` rather than relying on `loading="lazy"`
- Layer: html
- Stage: network
- Metrics: LCP
- When: load
- Impact: medium. It frees bandwidth for the LCP image. In the article's Oodle test, page load time dropped by about 2 s.
- Do: In carousels, tab panels, and other groups of above-the-fold images, give the first visible image `high` and the hidden slides `low`.
- Why: Hidden slides can sit "close enough" to the viewport that `loading="lazy"` still loads them, and the layout boost can raise them to High. `low` lowers their priority relative to the default and keeps them from competing with the visible image.
- Example:
  ```html
  <div class="slides">
    <img src="s1.webp" fetchpriority="high" alt="">
    <img src="s2.webp" fetchpriority="low" alt="">
    <img src="s3.webp" fetchpriority="low" alt="">
  </div>
  ```
- Avoid/caveats: Do not mark as low an image the user sees right away.
- Status: Baseline 2024 (as above).
- Sources: https://web.dev/articles/fetch-priority

### Raise important `async` scripts with `fetchpriority="high"` instead of the preload hack, and lower late parser-blocking scripts with `fetchpriority="low"`
- Layer: html
- Stage: network, preload-scan, script-run
- Metrics: LCP, INP, TBT
- When: load
- Impact: medium. It controls the order of script downloads without changing when the scripts run.
- Do: For a script that must not block the parser but is needed early (for example, the bootstrap that attaches handlers to the trading ticket), use `<script async fetchpriority="high">`. For a classic blocking script that runs late in the body and is not critical, add `fetchpriority="low"` so content before it gets bandwidth first.
- Why: In Chrome, `async` and `defer` scripts default to Low, and the common workaround was an extra `<link rel=preload>` for the same URL. The attribute states the intent directly. A low-priority blocking script still blocks the parser when the parser reaches it, but its download stops competing with earlier resources.
- Example:
  ```html
  <script src="/js/order-entry.js" async fetchpriority="high"></script>
  <script src="/js/legacy-widget.js" fetchpriority="low"></script>
  ```
- Avoid/caveats: `async` scripts run in the order they arrive, so do not use `async` for code that depends on DOM state or on other scripts. For that, use `defer`, or `async` at the end of the body.
- Status: Baseline 2024.
- Sources: https://web.dev/articles/fetch-priority

### Give background data fetches `priority: 'low'` so they do not compete with fetches that respond to user input
- Layer: js, network
- Stage: network
- Metrics: INP, LCP
- When: load, interaction, long-lived session
- Impact: medium. A plain `fetch()` defaults to High, the same as critical resources.
- Do: Keep the default priority for data the user is waiting for. Add `{priority: 'low'}` to prefetches, analytics pulls, "suggested" panels, and history backfills for charts that are not visible.
- Why: With no specific destination, a `fetch()` gets the same priority as an async XHR (High in Chrome). Many parallel background fetches can delay the one fetch that answers a click. The priority is applied inside the browser's request scheduler and also sent as an HTTP/2 or HTTP/3 priority signal.
- Example:
  ```ts
  const quote = await fetch(`/api/quote/${symbol}`);                       // default: high
  void fetch(`/api/candles/${symbol}?tf=1D&from=${start}`, { priority: 'low' }); // backfill
  ```
- Avoid/caveats: This is a hint. On an uncongested HTTP/2 or HTTP/3 connection the effect can be close to zero. It helps most on HTTP/1.x or with low bandwidth.
- Status: `RequestInit.priority`: Chrome 101, Firefox 132, Safari 17.2 (BCD `api.Request.Request.options_parameter.priority`). Baseline 2024.
- Sources: https://web.dev/articles/fetch-priority, https://developer.mozilla.org/en-US/docs/Web/API/RequestInit

### Lower non-critical preloads with `fetchpriority="low"`, including a non-blocking stylesheet preload
- Layer: html
- Stage: network, preload-scan
- Metrics: LCP, FCP
- When: load
- Impact: medium. Preloads load in parser order at their destination's priority, so extra preloads can push critical ones back.
- Do: Keep full priority only for preloads that affect the first render. Add `fetchpriority="low"` to preloads that only warm the cache (a theme stylesheet, a script needed later).
- Why: Preloads with Medium priority or higher start in the order the parser finds them. A low-priority preload still gets an early, parser-independent start, but the browser moves it behind critical work.
- Example:
  ```html
  <link rel="preload" as="script" href="/js/chart-core.js">
  <link rel="preload" as="script" href="/js/indicators-extra.js" fetchpriority="low">
  <link rel="preload" as="style" href="/css/theme-dark.css" fetchpriority="low" onload="this.rel='stylesheet'">
  ```
- Avoid/caveats: The `onload` swap pattern needs JS and a `<noscript>` fallback, and an inline `onload` does not work under a strict CSP. Early `<head>` CSS stays High even with `low`.
- Status: Baseline 2024.
- Sources: https://web.dev/articles/fetch-priority

### Treat `fetchpriority` as relative, and know where it cannot help
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP
- When: load
- Impact: low. Mainly prevents wrong expectations.
- Do: Expect the hint to move a resource up or down one tier from its default, not to set an absolute level. Do not use `fetchpriority="high"` on a `media`-mismatched stylesheet to make it early.
- Why: In Chrome, early `<head>` CSS is VeryHigh/Highest, and `low` only brings it down to High. Late-body CSS is Medium by default and can move to High or Low. CSS whose `media` does not match is not fetched by the preload scanner at all. The main parser fetches it when it reaches the element, so the hint cannot make it early. Images start at Low and can move to High. Media files (video and audio) are Low.
- Example: `<link rel="stylesheet" href="print.css" media="print" fetchpriority="high">` is still fetched late. Do not do this.
- Avoid/caveats: The browser may ignore the hint to resolve conflicts, and CDNs apply HTTP/2 and HTTP/3 priorities unevenly. The in-browser scheduling still takes effect, because low-priority resources are held back while the critical `<head>` items are processed.
- Status: Baseline 2024. The tier tables are Chromium-specific.
- Sources: https://web.dev/articles/fetch-priority

### Place preloads by type so that preloads do not delay one another
- Layer: html, network
- Stage: preload-scan, network
- Metrics: LCP, FCP
- When: load
- Impact: medium. Preload position decides the start order.
- Do: (1) Remember that a preload sent in a `Link:` HTTP header starts before everything in the HTML. (2) Put font preloads at the end of `<head>` or the start of `<body>`, not above critical CSS. (3) Put `modulepreload` or preloads for a dynamic import after the `<script>` that needs them, so that script can compile while its dependencies download. (4) Image preloads are Low or Medium, so place them in the order you want relative to async scripts and other low-priority tags.
- Why: For resources at Medium or higher, preloads download in the order the parser finds them. So a large preload at the top of `<head>` can delay the critical CSS.
- Example:
  ```html
  <head>
    <link rel="stylesheet" href="/css/app.css">
    <script type="module" src="/js/main.js"></script>
    <link rel="modulepreload" href="/js/chart-engine.js">
    <link rel="preload" as="font" type="font/woff2" href="/f/inter-var.woff2" crossorigin>
  </head>
  ```
- Avoid/caveats: HTTP-header preloads for large files can delay the HTML itself.
- Status: `modulepreload` is Baseline widely available (low date 2023-09-18, high date 2026-03-18, per webstatus).
- Sources: https://web.dev/articles/fetch-priority

### Check the priority each request actually got in DevTools before and after you add hints
- Layer: tooling
- Stage: network
- Metrics: LCP
- When: testing
- Impact: medium. Priority bugs are invisible unless you look.
- Do: In the Chrome DevTools Network panel, turn on the Priority column (right-click the header). Turn on "Big request rows" to see both the initial and the final priority. Add hints only when the result is not what you expect.
- Why: The browser downloads resources of equal priority in the order it finds them. The article suggests adding Fetch Priority late in development, once you can see the real priority assignments.
- Example: If the hero `<img>` shows "Low → High", it is a candidate for `fetchpriority="high"`.
- Avoid/caveats: Test on a throttled, congested connection. The effect is small on a fast lab network.
- Status: A DevTools feature (Chrome).
- Sources: https://web.dev/articles/fetch-priority

---

## Optimize input delay (web.dev/articles/optimize-input-delay, 2023-05-09)

### Keep recurring timers light, and prefer self-rescheduling `setTimeout` to `setInterval` for periodic work
- Layer: js
- Stage: main-thread-task
- Metrics: INP
- When: long-lived session, interaction
- Impact: high for long-lived dashboards. A timer callback that runs when the user clicks adds directly to that interaction's input delay.
- Do: Ask whether each timer is needed. Keep the work inside each timer callback small. For polling, schedule the next run only after the current run finishes, and stop timers while the tab is hidden. Push expensive work to a worker. Find the third-party scripts whose intervals appear in traces, and discuss them with their owners.
- Why: A `setInterval` callback runs forever at a fixed rate, so it is much more likely than a one-off `setTimeout` to land at the moment of an interaction. A self-rescheduling `setTimeout` also yields between runs and never stacks runs on top of each other.
- Example:
  ```ts
  // Before: fixed cadence, runs even when the last run was slow or the tab is hidden
  setInterval(refreshWatchlist, 1000);

  // After: reschedules only after the work completes, and pauses while hidden
  async function poll() {
    if (document.visibilityState === 'visible') await refreshWatchlist();
    timer = setTimeout(poll, 1000);
  }
  let timer = setTimeout(poll, 1000);
  ```
- Avoid/caveats: A self-rescheduling loop can still do too much work in each run. Measure the duration of each run. For streaming prices, push-based transport (WebSocket or SSE) with per-frame coalescing is usually better than polling.
- Status: Timers are Baseline widely available.
- Sources: https://web.dev/articles/optimize-input-delay

### Debounce bursty input handlers and abort superseded network requests
- Layer: js
- Stage: main-thread-task, network
- Metrics: INP
- When: interaction
- Impact: medium. Stops overlapping interactions from queuing behind one another.
- Do: For fast repeated input (typing a symbol search, dragging a slider), debounce the expensive part. When a new request replaces an old one, call `AbortController.abort()` on the old one, so its response and callbacks never reach the main thread. Use an `AbortSignal` to remove groups of event listeners.
- Why: When interactions overlap, the rendering and handler work of one interaction becomes input delay for the next. Stale responses that arrive later still run `then` callbacks and DOM updates, which crowds the main thread.
- Example:
  ```ts
  let inflight: AbortController | undefined;
  const search = debounce(async (q: string) => {
    inflight?.abort();
    inflight = new AbortController();
    try {
      const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}`, { signal: inflight.signal });
      renderResults(await res.json());
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') throw e;
    }
  }, 150);
  input.addEventListener('input', (e) => search((e.target as HTMLInputElement).value));
  ```
- Avoid/caveats: Debounce only the expensive part. Update the visible input value (and any cheap immediate feedback) right away, so the next paint is fast. A debounce delay that is too long makes the UI feel slow even when INP looks good.
- Status: Abortable fetch is Baseline widely available (2019). `addEventListener({signal})` is Chrome 90, Firefox 86, Safari 15 (BCD).
- Sources: https://web.dev/articles/optimize-input-delay

---

## How large DOM sizes affect interactivity (web.dev/articles/dom-size-and-interactivity, 2023-05-09)

### Judge DOM size by how long style and layout take, not by a fixed node count
- Layer: tooling, html
- Stage: style, layout
- Metrics: INP
- When: testing, interaction
- Impact: medium. It sends the fix to the updates that are actually expensive.
- Do: To diagnose a slow interaction, select the "Recalculate Style" event in the Performance panel and read the number of affected elements. Use the Performance monitor to plot DOM nodes, layouts per second, and style recalculations per second together. Treat a style recalculation over 300 elements, or a layout over 100 layout objects, that takes more than 40 ms as the signal.
- Why: The article cites Lighthouse limits of a warning above 800 nodes and a failure above 1,400. **Those limits are out of date.** The current "Optimize DOM size" insight in Chrome DevTools and Lighthouse (2025-10-08) counts elements including shadow roots, reports total elements, depth, and most children, and fails only when a large layout or style recalculation takes more than 40 ms. It notes that depth alone is not a performance problem.
- Example: In the console, `document.querySelectorAll('*').length` gives the number of elements (it does not count text or comment nodes).
- Avoid/caveats: A page with a large DOM that is mostly static and never invalidated can be fine. The cost comes from invalidating large subtrees.
- Status: The insight has been in Chrome DevTools and Lighthouse since 2025.
- Sources: https://web.dev/articles/dom-size-and-interactivity, https://developer.chrome.com/docs/performance/insights/dom-size

### Flatten wrapper nesting with framework fragments and flex or grid
- Layer: html, css
- Stage: style, layout
- Metrics: INP, memory
- When: build, interaction
- Impact: medium. Fewer elements means less to match, lay out, and paint on every update.
- Do: Remove `div` wrappers that exist only because a component needs a single root. Return a fragment instead (React `<>…</>`, Preact `Fragment`, Vue 3 multi-root templates). In Svelte 5, components and snippets already allow several top-level nodes. Use flex or grid on one container instead of nested layout boxes.
- Why: Deep "div soup" usually comes from component composition. Removing it lowers the element count and often simplifies the selectors too.
- Example:
  ```tsx
  // Before
  const Row = () => <div><Cell /><Cell /></div>;
  // After
  const Row = () => <><Cell /><Cell /></>;
  ```
- Avoid/caveats: Keep a wrapper when it provides a containment boundary (`contain`, `content-visibility`) or accessibility semantics.
- Status: `<svelte:fragment>` is legacy in Svelte 5: "this concept is obsolete, as snippets don't create a wrapping element" (svelte.dev).
- Sources: https://web.dev/articles/dom-size-and-interactivity, https://svelte.dev/docs/svelte/legacy-svelte-fragment

### Add hidden parts of the UI to the DOM when they are needed, not at startup (the "additive" approach)
- Layer: js, html
- Stage: html-parse, style, layout
- Metrics: INP, LCP, TBT
- When: load, interaction
- Impact: medium. Less DOM at startup means less rendering work, which competes less with early interactions.
- Do: Leave out of the initial HTML any panels, menus, dialogs, and tabs that are not visible. Build them the first time the user opens them. If building needs data, show a loading indicator right away.
- Why: The initial payload is smaller and renders faster, and early interactions compete with less work. Later re-renders are also cheaper while the tree stays small.
- Example: Render the order-history tab's table only on the first `click` of the tab, and keep it afterwards (do not rebuild it on every open).
- Avoid/caveats: The DOM grows again over the session. Remove panels that are closed and unlikely to return. Network time is not counted in INP, but users still feel it. Paint a pending state in the same frame as the click.
- Status: A pattern, not an API.
- Sources: https://web.dev/articles/dom-size-and-interactivity

### Do not keep large `querySelectorAll` results alive
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: low. Mostly matters for very large DOMs and long sessions.
- Do: Query narrowly (scope to a container, use a specific selector), and drop references to NodeLists or arrays of elements when you are done with them.
- Why: A query keeps references to every matched element. A broad query on a large DOM costs memory, and it keeps detached nodes from being garbage-collected if you hold on to it.
- Example: `panel.querySelectorAll(':scope > .row')` instead of `document.querySelectorAll('div')`.
- Avoid/caveats: none.
- Status: n/a
- Sources: https://web.dev/articles/dom-size-and-interactivity

---

## Script evaluation and long tasks (web.dev/articles/script-evaluation-and-long-tasks, 2023-05-09)

### Split large classic bundles so each `<script>` creates a smaller evaluation task (about 100 KB per script as a starting target)
- Layer: build, html
- Stage: script-compile, script-run, main-thread-task
- Metrics: INP, TBT
- When: load, build
- Impact: high. One large script means one long "Evaluate Script" task that blocks input during load.
- Do: Configure the bundler to emit several medium-sized chunks instead of one large bundle. The article suggests about 100 KB per script (it does not say whether compressed) as a balance between compression, download time, and evaluation time.
- Why: In Chromium, Safari, and Firefox, each classic `<script>` element starts its own task that parses, compiles, and runs it. More, smaller scripts give the browser points between tasks where it can handle input.
- Example: webpack `optimization.splitChunks` with `maxSize`. Rollup, esbuild, and Vite split at dynamic `import()` boundaries and `manualChunks`.
- Avoid/caveats: Smaller files compress less well and add request overhead. Every chunk that loads at startup is still evaluated at startup, so splitting spreads the cost but does not remove it. Ship less JS first.
- Status: n/a (build practice).
- Sources: https://web.dev/articles/script-evaluation-and-long-tasks

### Do not count on `defer` or `type=module` to split evaluation: Chromium runs the ready ones in one task with `DOMContentLoaded`
- Layer: html, js
- Stage: script-run, main-thread-task
- Metrics: INP, TBT
- When: load
- Impact: medium. Several deferred scripts can combine into one long task.
- Do: If the deferred or module scripts together are heavy, move the work that is not needed at startup behind a dynamic `import()`, or yield inside the startup code (`await scheduler.yield()` where supported, otherwise `setTimeout`) between phases.
- Why: The article says Chromium runs all loaded `defer` scripts, and module scripts (which are deferred by default), in the same task as `DOMContentLoaded`. That means fewer layouts but a longer task. By the spec, the event loop should spin between deferred scripts. The spec question is WHATWG issue #6230, which is still open. Its last activity was in 2023, and I found nothing showing that Chromium has changed.
- Example:
  ```ts
  // main.ts (module, deferred)
  initCriticalUi();
  await scheduler.yield?.() ?? new Promise((r) => setTimeout(r));
  const { initIndicators } = await import('./indicators');
  initIndicators();
  ```
- Avoid/caveats: `async` scripts can run in any order.
- Status: Behavior as described in the article (2023). WHATWG html#6230 is open. `scheduler.yield`: Chrome 129, Firefox 142, no Safari (BCD).
- Sources: https://web.dev/articles/script-evaluation-and-long-tasks, https://github.com/whatwg/html/issues/6230

### Native ES modules: per-module compile tasks help, but unbundled static import chains create request waterfalls, so bundle or `modulepreload` them
- Layer: build, html
- Stage: network, script-compile, script-run
- Metrics: LCP, INP, startup
- When: load, build
- Impact: medium.
- Do: In production, bundle modules into a few chunks, or add `<link rel="modulepreload">` for each module in the static graph so the browser fetches the whole graph at once.
- Why: Chromium runs a separate "Compile module" task for each module, and then "Evaluate module" work. Safari and Firefox evaluate each module in its own task. That breaks up compile work. But each static `import` is found only after its parent downloads and parses, so a→b→c becomes three round trips in sequence. Module code also always runs in strict mode, which lets engines optimize more.
- Example:
  ```html
  <script type="module" src="/js/app.js"></script>
  <link rel="modulepreload" href="/js/store.js">
  <link rel="modulepreload" href="/js/ws-client.js">
  ```
- Avoid/caveats: Do not ship many small unbundled modules in production without preloads.
- Status: `modulepreload` is Baseline widely available (2026-03-18). Import maps are Baseline widely available.
- Sources: https://web.dev/articles/script-evaluation-and-long-tasks

### Use dynamic `import()` as split points so each loaded module compiles and evaluates in its own task, and keep each chunk small
- Layer: js, build
- Stage: script-compile, script-run, network
- Metrics: INP, TBT, bundle-size
- When: load, interaction
- Impact: high. Less JS at startup, and evaluation split per module.
- Do: Load features that are not needed on the first screen with `import()` (drawing tools, indicator catalog, settings). Start the import before the user needs it, for example when the pointer hovers or during idle time, so the evaluation task does not run inside an interaction.
- Why: Each `import()` call compiles and evaluates its module separately, and this works the same way in all engines. Bundlers turn each `import()` into its own file.
- Example:
  ```ts
  button.addEventListener('pointerenter', () => void import('./drawing-tools'), { once: true });
  button.addEventListener('click', async () => (await import('./drawing-tools')).open());
  ```
- Avoid/caveats: A large dynamic chunk that is evaluated during a click still creates a long task, so keep dynamic chunks small too.
- Status: Dynamic import is Baseline widely available.
- Sources: https://web.dev/articles/script-evaluation-and-long-tasks

### Balance chunk size against compression and cache hits, and always use content-hashed file names
- Layer: build
- Stage: network
- Metrics: bundle-size, LCP, startup
- When: build
- Impact: medium. Granular chunks keep repeat visits cached after a deploy.
- Do: Emit file names with content hashes. Keep libraries that rarely change (for example the charting engine) in their own long-cached chunk, separate from app code that changes often.
- Why: With one large bundle, any change downloads everything again. With split chunks, only the changed ones are fetched again. Larger files compress better, so this is a trade-off, not a rule to split as much as possible.
- Example: `vendor-scichart.[hash].js` (immutable, cached for a year) and `app.[hash].js`.
- Avoid/caveats: Too many chunks cost more requests and compress worse.
- Status: n/a
- Sources: https://web.dev/articles/script-evaluation-and-long-tasks

---

## Client-side rendering of HTML and interactivity (web.dev/articles/client-side-rendering-of-html-and-interactivity, 2023-05-09)

### Stream HTML from the server so the parser does the chunking and yielding for you
- Layer: network, html
- Stage: network, html-parse, main-thread-task
- Metrics: INP, TBT, FCP, LCP, TTFB
- When: load
- Impact: high. Server-streamed HTML is parsed and rendered in chunks, and the browser yields between chunks.
- Do: Render the first screen on the server, and use the framework's streaming renderer (React `renderToPipeableStream` or `renderToReadableStream`, SvelteKit SSR, Vue SSR). Do not use a buffered `renderToString`, which delays TTFB.
- Why: When HTML arrives in chunks, the browser parses a bit, yields, renders, and can handle input between chunks. The same markup built by client JS runs in one uninterrupted task. Rendering on the server also lowers TBT, which the article says correlates with INP.
- Example: SvelteKit pages render on the server by default. Keep components that need `window` out of SSR only where necessary.
- Avoid/caveats: Interactive components still need hydration, and hydration costs main-thread time. Components that read `window` or other browser globals during render cannot run on the server.
- Status: React APIs checked on react.dev (`renderToPipeableStream`, `renderToReadableStream`, and `prerender*`).
- Sources: https://web.dev/articles/client-side-rendering-of-html-and-interactivity, https://react.dev/reference/react-dom/server

### Keep LCP-critical resource URLs in the server HTML, because the preload scanner cannot see markup that client JS creates
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP
- When: load
- Impact: high. Resources referenced in client-built HTML are found only after the JS runs.
- Do: Put the LCP `<img>` (and its `src` and `srcset`) and the critical CSS and font URLs in the HTML document itself. When that is not possible, add `<link rel="preload">` in the server `<head>`.
- Why: The preload scanner reads only the raw HTML bytes. HTML created with `innerHTML` or `createElement` during startup is out of its view, so the fetch starts late.
- Example: A single-page app shell with `<div id="app"></div>` and a JS-inserted hero image means the hero image is discovered late.
- Avoid/caveats: none.
- Status: n/a
- Sources: https://web.dev/articles/client-side-rendering-of-html-and-interactivity

### When you build DOM on the client, choose the API deliberately and split large insertions across tasks
- Layer: js
- Stage: html-parse, script-run, style, layout, main-thread-task
- Metrics: INP, TBT
- When: interaction, load
- Impact: medium. Client-side DOM construction is never split into chunks automatically.
- Do: For large insertions (long lists, big tables), build and insert in slices and yield between them, or virtualize the list. Never use `document.write()`. To parse a trusted HTML string, `innerHTML`, `setHTMLUnsafe()`, or `Document.parseHTMLUnsafe()` all work. Use `createElement` or `<template>` cloning for structured updates that repeat.
- Why: Setting `innerHTML` or appending nodes runs synchronously in the current task, and style and layout for everything inserted happen before the next paint.
- Example:
  ```ts
  async function appendRows(tbody: HTMLElement, rows: Row[]) {
    for (let i = 0; i < rows.length; i += 200) {
      const frag = document.createDocumentFragment();
      for (const r of rows.slice(i, i + 200)) frag.append(rowTemplate(r));
      tbody.append(frag);
      await (globalThis.scheduler?.yield?.() ?? new Promise((r) => setTimeout(r)));
    }
  }
  ```
- Avoid/caveats: `*Unsafe` methods do not sanitize, so never pass them user-supplied strings. Use `setHTML()` (Sanitizer API) or text APIs for untrusted input.
- Status: `document.write()` is deprecated (BCD). `setHTMLUnsafe`/`parseHTMLUnsafe` are Baseline newly available since 2025-09-15 (Chrome 124, Firefox 123/128, Safari 26). New streaming insertion methods (`streamHTMLUnsafe()`, `streamAppendHTML()`, and others, which return a `WritableStream`) and positional `appendHTML()` and similar methods are still proposals: WHATWG html PRs #12758 and #12753 are open, and the chromestatus "Renewed HTML insertion&streaming methods" entry targets Chrome 155. Not shipped as of 2026-09. The Sanitizer API ships in Chrome (2026-03) and Firefox (2026-02), with no Safari support (webstatus).
- Sources: https://web.dev/articles/client-side-rendering-of-html-and-interactivity, https://github.com/whatwg/html/pull/12758, https://chromestatus.com/feature/5054329641893888, https://api.webstatus.dev/v1/features/parse-html-unsafe

### Consider a streaming service-worker architecture for multi-page apps
- Layer: js, network
- Stage: network, html-parse
- Metrics: FCP, LCP, TTFB, INP
- When: load
- Impact: medium. Navigations feel instant without the costs of client-side rendering.
- Do: In a service worker, answer navigations with a `ReadableStream` that first sends the cached header and shell partials from `CacheStorage`, then pipes in the page-specific body from the network, and then sends the cached footer. (The article points to Workbox streams.)
- Why: The browser still gets streamed HTML, so it keeps incremental parsing and automatic yielding. The first bytes come from the local cache, and less HTML travels over the network.
- Example: `new Response(concatStreams([cachedHead, fetch(bodyUrl).then(r => r.body), cachedFoot]), { headers: { 'Content-Type': 'text/html' } })` (sketch).
- Avoid/caveats: The article calls this advanced. Service-worker startup can add latency on a cold start. Consider navigation preload. It does not fit apps whose shell changes per user.
- Status: Service workers, Streams, and Cache API are Baseline widely available.
- Sources: https://web.dev/articles/client-side-rendering-of-html-and-interactivity

---

## Best practices for fonts (web.dev/articles/font-best-practices, 2022-10-04)

### Inline `@font-face` rules (and the rules that use them) in `<head>` so font discovery does not wait for an external stylesheet
- Layer: html, css
- Stage: cssom, network
- Metrics: FCP, LCP, CLS
- When: load
- Impact: high. Fonts are requested only after the CSSOM shows that some visible text uses them.
- Do: Put the `@font-face` rules and the base `font-family` rules in an inline `<style>` in `<head>`. Do not inline the font files as base64.
- Why: A font request starts only after the browser knows both the `@font-face` rule and a rendered element that uses that family. With an external stylesheet, discovery waits for that stylesheet to download. Base64 fonts inside the HTML make the document larger and delay everything else in it.
- Example:
  ```html
  <style>
    @font-face { font-family: "Inter"; src: url("/f/inter-var.woff2") format("woff2"); font-display: optional; }
    body { font-family: "Inter", system-ui, sans-serif; }
  </style>
  ```
- Avoid/caveats: The browser still waits for all render-blocking CSS before it decides which fonts are needed, so inlining only part of the CSS does not remove that wait.
- Status: n/a
- Sources: https://web.dev/articles/font-best-practices

### Remember that a font downloads only when rendered content uses it, and load canvas-chart fonts explicitly
- Layer: css, js, canvas2d
- Stage: cssom, network, paint
- Metrics: FCP, CLS, FPS/smoothness
- When: load
- Impact: medium. It explains fonts that seem to be "missing" and fonts that load late.
- Do: Remove unused `@font-face` rules and unused font CSS, and split stylesheets, so pages do not trigger fonts they do not show. For text drawn in `<canvas>` (chart axes, labels), load the font first with `new FontFace(...).load()` or `document.fonts.load('12px Inter')`, then draw or redraw.
- Why: A `@font-face` rule alone does not trigger a download. A rule such as `h1 { font-family: X }` downloads X only if an `<h1>` exists. Canvas text does not wait for a web font. It draws with a fallback font if the web font is not ready.
- Example:
  ```ts
  await document.fonts.load('11px "Inter"');
  chart.invalidate(); // redraw axis labels with the real font
  ```
- Avoid/caveats: Use a timeout on `document.fonts.load()` so a failed font download cannot hold up the first chart paint.
- Status: CSS Font Loading API is Baseline widely available (webstatus `font-loading`).
- Sources: https://web.dev/articles/font-best-practices, https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/font

### Preconnect to third-party font origins, with `crossorigin` on the origin that serves the font files
- Layer: html, network
- Stage: network
- Metrics: FCP, LCP
- When: load
- Impact: medium. Saves the DNS, TCP, and TLS setup on the critical path.
- Do: Put two preconnects in `<head>` when the CSS host and the font-file host are different. Font files are always fetched with CORS, so the font origin needs `crossorigin`. Load third-party font CSS with a `<link>` placed early, not with an `@import`.
- Why: A preconnect without `crossorigin` opens a connection that a CORS font request cannot reuse. `@import` inside CSS adds one more step in sequence before the font CSS is found.
- Example:
  ```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  ```
- Avoid/caveats: Preconnect only to origins you use in the first seconds. Unused preconnects waste sockets.
- Status: `preconnect`: Chrome 46, Firefox 39, Safari 11.1 (BCD).
- Sources: https://web.dev/articles/font-best-practices

### Preload fonts only as a targeted fix, and set `crossorigin` and a single format
- Layer: html
- Stage: preload-scan, network
- Metrics: FCP, LCP, CLS
- When: load
- Impact: medium. It helps when fonts are in external CSS, and it hurts when it takes bandwidth from critical resources.
- Do: Prefer fixing discovery (inline `@font-face`, as above). If you preload, preload only the one or two fonts used above the fold, in WOFF2, with `type="font/woff2"` and `crossorigin`.
- Why: A preload bypasses the browser's font selection. It ignores `unicode-range` and cannot choose between formats, so you may download a file the page never uses. Without `crossorigin`, the preload does not match the later CORS font request, and the font downloads twice.
- Example: `<link rel="preload" as="font" type="font/woff2" href="/f/inter-latin.woff2" crossorigin>`
- Avoid/caveats: Put font preloads after the critical CSS (see "Place preloads by type").
- Status: `rel=preload as=font` is Chrome 50, Firefox 85, Safari 11.1 (BCD). MDN says font preloads need `crossorigin`.
- Sources: https://web.dev/articles/font-best-practices, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload

### Self-host fonts only with a CDN and HTTP/2 or later, and copy what font services do for you
- Layer: network, build
- Stage: network
- Metrics: FCP, LCP
- When: build
- Impact: medium.
- Do: If you self-host, serve fonts from a CDN over HTTP/2 or HTTP/3. Subset them, compress them to WOFF2, and serve them with long-lived immutable caching. Measure the transfer time (including connection setup) against the third-party option before you switch.
- Why: Self-hosting removes a separate connection. But Web Almanac data showed sites with third-party fonts rendering faster than sites with first-party fonts, because services subset and compress automatically. Check the font license for subsetting and self-hosting rights.
- Example: n/a
- Avoid/caveats: CJK fonts are hard to subset well.
- Status: n/a
- Sources: https://web.dev/articles/font-best-practices

### Serve only WOFF2
- Layer: build, css
- Stage: network
- Metrics: FCP, LCP
- When: build
- Impact: low. WOFF2 compresses about 30% better than WOFF, and dropping other formats removes the risk of downloading two formats.
- Do: List only a `woff2` source in `@font-face`. Browsers too old for WOFF2 get the fallback font.
- Why: WOFF2 uses Brotli. The article cites the 2022 Web Almanac: "Use only WOFF2 and forget about everything else."
- Example: `src: url("/f/inter.woff2") format("woff2");`
- Avoid/caveats: none.
- Status: WOFF2 in `@font-face`: Chrome 36, Firefox 39, Safari 10 (BCD).
- Sources: https://web.dev/articles/font-best-practices

### Subset fonts and split them with `unicode-range`
- Layer: build, css
- Stage: network
- Metrics: FCP, LCP
- When: build
- Impact: medium. Latin fonts have 100 to 1,000 glyphs. CJK fonts can have more than 10,000.
- Do: Create subset files (for example Latin, Latin-ext, and Cyrillic) with glyphhanger, subfont, or fonttools. Declare each subset with a matching `unicode-range` so the browser downloads only the subsets the page's characters need. For a tiny fixed string such as a logo, use Google Fonts' `text=` parameter.
- Why: The browser downloads a face only if the page contains a character in its range. Self-hosted copies often lose the subsetting that Google Fonts applies by default.
- Example:
  ```css
  @font-face { font-family: "Inter"; src: url(/f/inter-latin.woff2) format("woff2");
    unicode-range: U+0000-00FF, U+2013-2014, U+20AC; }
  @font-face { font-family: "Inter"; src: url(/f/inter-cyrillic.woff2) format("woff2");
    unicode-range: U+0400-04FF; }
  ```
- Avoid/caveats: Make sure the subsets include the digits and symbols a trading UI needs (currency signs, minus sign U+2212, arrows). If they are missing, those characters render in a fallback font.
- Status: `unicode-range` is supported everywhere (BCD). Incremental Font Transfer (the successor idea for large fonts) is "Proposed" on chromestatus and not shipped.
- Sources: https://web.dev/articles/font-best-practices, https://chromestatus.com/feature/5135917565214720

### Use fewer web fonts: `system-ui` for UI text, and a variable font only when you need many styles
- Layer: css
- Stage: network, paint
- Metrics: FCP, LCP, CLS
- When: build
- Impact: medium. A font you never request costs nothing.
- Do: Use `font-family: system-ui` for body and UI text where the brand allows it. Choose one variable font instead of several static weights only when you really use many weights or styles.
- Why: System fonts are already installed. A variable font puts many styles into one file, but that file is larger than any single static style, so it only pays off when you use several styles.
- Example: `body { font-family: system-ui, sans-serif; } .brand { font-family: "Brand", system-ui; }`
- Avoid/caveats: `system-ui` looks different on each OS. Check the widths of tabular numbers in price columns, or add `font-variant-numeric: tabular-nums`.
- Status: `font-variation-settings` is Baseline widely available (2018).
- Sources: https://web.dev/articles/font-best-practices

### Choose `font-display` by priority: `optional` for performance, `swap` for brand text that must appear, and preload any `optional` font that matters
- Layer: css
- Stage: paint, layout
- Metrics: FCP, LCP, CLS
- When: load
- Impact: high. It decides whether text is invisible, and whether a later font swap moves the layout.
- Do: Use `font-display: optional` for body text (at most about 100 ms of blocking and no swap later, so no layout shift from the font). Use `swap` for brand or display text, and deliver it early. You can mix both on one page.
- Why: The article's periods (block, then swap): `auto` depends on the browser. `block` is about 2 to 3 s, then an unlimited swap. `swap` is about 0 ms, then an unlimited swap. `fallback` is about 100 ms, then 3 s. `optional` is about 100 ms, with no swap. Since Chrome 83, an `optional` font that is preloaded skips the first render cycle and causes no relayout, because Chrome holds rendering up to about 100 ms for it. On slow connections Chrome may shorten the `auto` timeout (a browser intervention since Chrome 49).
- Example:
  ```css
  @font-face { font-family: "Inter"; src: url(/f/inter.woff2) format("woff2"); font-display: optional; }
  @font-face { font-family: "Brand"; src: url(/f/brand.woff2) format("woff2"); font-display: swap; }
  ```
- Avoid/caveats: **Out of date in the article:** "Safari blocks text rendering indefinitely." WebKit has shown invisible text for at most 3 s and then used a fallback since 2016 (webkit.org). **The article's own `font-display` code sample has CSS syntax errors** (a list in `font-family`, and commas instead of semicolons), so do not copy it. With `optional`, first-time visitors on slow networks may never see the web font.
- Status: `font-display` is Baseline widely available (2022-07-15). The Chrome 83 `optional` change is on chromestatus.
- Sources: https://web.dev/articles/font-best-practices, https://web.dev/articles/preload-optional-fonts, https://webkit.org/blog/6643/improved-font-loading/, https://chromestatus.com/feature/5636954674692096

### Replace icon fonts with SVG
- Layer: html, build
- Stage: paint, layout, network
- Metrics: CLS, FCP
- When: build
- Impact: medium. Icon-font fallbacks look nothing like the icons, change meaning, and shift layout.
- Do: Use inline SVG, an SVG sprite with `<use>`, or `<img src="*.svg">` for icons.
- Why: No `font-display` value works well for icons. Fallback glyphs have different metrics, which causes shifts. SVG is also better for accessibility.
- Example: `<svg class="icon" aria-hidden="true"><use href="/icons.svg#arrow-up"/></svg>`
- Avoid/caveats: Very large inline SVG sprites add to the HTML. Use an external sprite for large icon sets.
- Status: n/a
- Sources: https://web.dev/articles/font-best-practices

### Match fallback-font metrics to the web font to shrink swap shifts
- Layer: css
- Stage: layout
- Metrics: CLS
- When: load
- Impact: medium. It reduces the shift when a `swap` or `fallback` font arrives.
- Do: Declare a fallback `@font-face` that points at a local font with `size-adjust`. In Chromium and Firefox, add `ascent-override`, `descent-override`, and `line-gap-override`. Or use `font-size-adjust` on the element.
- Why: The shift comes from the difference between the fallback's and the web font's advance widths and vertical metrics. Scaling the fallback to match makes both occupy almost the same box.
- Example:
  ```css
  @font-face { font-family: "Inter Fallback"; src: local("Arial");
    size-adjust: 107%; ascent-override: 90%; descent-override: 22%; line-gap-override: 0%; }
  body { font-family: "Inter", "Inter Fallback", sans-serif; }
  ```
- Avoid/caveats: The override values depend on the font pair, so compute them with a tool. Safari ignores the `*-override` descriptors.
- Status: `size-adjust` is Chrome 92, Firefox 92, Safari 17, so Baseline since Safari 17 (2023-09). `ascent-override`/`descent-override`/`line-gap-override` are Chrome 87 and Firefox 89, with Safari only in preview (BCD 8.1.2). webstatus lists them as "limited". `font-size-adjust` is Baseline newly available since 2024-07-25.
- Sources: https://web.dev/articles/font-best-practices, https://api.webstatus.dev/v1/features/font-metric-overrides, https://api.webstatus.dev/v1/features/font-size-adjust

---

## Best practices for measuring Web Vitals in the field (web.dev/articles/vitals-field-measurement-best-practices, 2022-05-11)

### Measure Core Web Vitals in the field with the `web-vitals` library and report them as custom metrics or events
- Layer: js, tooling
- Stage: idle
- Metrics: LCP, INP, CLS, FCP, TTFB
- When: long-lived session, testing
- Impact: high. Without field data you cannot tell whether a change helped real users.
- Do: Import `onLCP`, `onINP`, and `onCLS` (and optionally `onFCP` and `onTTFB`) from `web-vitals`, and send each metric to your analytics as a custom metric with its `id`. Use the `web-vitals/attribution` build (about 1.5 KB larger, brotli) when you need the causes: INP `interactionTarget`, the LCP element, the CLS `largestShiftTarget`, and LoAF entries with `longestScript`.
- Why: The library handles the edge cases: bfcache restores, pages loaded in the background, reporting again when the page becomes hidden, and browser bugs with `visibilitychange`.
- Example:
  ```ts
  import { onCLS, onINP, onLCP } from 'web-vitals/attribution';
  const queue = new Set<object>();
  const add = (m: { name: string; value: number; id: string; navigationType: string }) =>
    queue.add({ name: m.name, value: m.value, id: m.id, nav: m.navigationType, build: __BUILD_ID__ });
  onCLS(add); onINP(add); onLCP(add);
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && queue.size) {
      navigator.sendBeacon('/rum', JSON.stringify([...queue]));
      queue.clear();
    }
  });
  ```
- Avoid/caveats: Call each `on*()` only once per page. Each call creates a `PerformanceObserver` and listeners for the life of the page, which costs memory. Use `reportAllChanges` only for debugging. Metrics are not visible inside iframes. INP is not reported if the user never interacts.
- Status: **The article's API is still valid, but the library has moved on:** npm `latest` is 6.2.2 (2026-09-14). Support per the README: `onCLS` Chromium only. `onFCP`, `onINP`, `onLCP`, and `onTTFB` work in Chromium, Firefox, and Safari. LCP and Event Timing entries are Baseline newly available since 2025-12-12 (Safari 26.2). Soft-navigation reporting (`reportSoftNavs: true`, with a `navigationURL` on each metric) needs Chromium 151 or later. Long Animation Frames (used by attribution) are Chromium only (Chrome 123).
- Sources: https://web.dev/articles/vitals-field-measurement-best-practices, https://github.com/GoogleChrome/web-vitals (README), https://registry.npmjs.org/web-vitals, https://api.webstatus.dev/v1/features/largest-contentful-paint, https://api.webstatus.dev/v1/features/event-timing

### Report percentiles from a per-instance distribution, not averages
- Layer: tooling
- Stage: idle
- Metrics: LCP, INP, CLS
- When: testing, long-lived session
- Impact: medium. Averages hide the slow tail of users.
- Do: Store every metric instance with a unique id (the library's `metric.id`) so no grouping happens. Report the 75th percentile as the pass or fail line, and also watch p90 and p95 for slow devices and networks. If the tool has no quantile function, sort the values and take the value 75% of the way through the list, in each segment.
- Why: The Core Web Vitals thresholds are defined at p75. Outliers distort a mean in misleading ways.
- Example: In SQL: `APPROX_QUANTILES(value, 100)[OFFSET(75)] ... GROUP BY name, build_id, device_class`.
- Avoid/caveats: Segment by device class and connection type, or one fast group can hide a slow one.
- Status: n/a
- Sources: https://web.dev/articles/vitals-field-measurement-best-practices

### Send beacons when the page becomes hidden (`visibilitychange` → `hidden`), never in `unload` or `beforeunload`
- Layer: js
- Stage: idle, network
- Metrics: CLS, INP, memory
- When: long-lived session
- Impact: high. CLS and INP are final only at the end of the page's life, and `unload` handlers are unreliable and block the bfcache.
- Do: Queue the metrics and flush them with `navigator.sendBeacon()` when `visibilityState` becomes `hidden`. Use `pagehide` if you need a navigation-away signal. You can also send a `Permissions-Policy: unload=()` header so that no script (including third-party) can register an `unload` handler.
- Why: Mobile operating systems can close the browser without firing `unload`. They do fire `visibilitychange` for tab switches, app switches, and closes. After `hidden`, there is no guarantee your script runs again. `unload` handlers also make the page ineligible for the bfcache.
- Example: See the web-vitals example above. For a simpler call, the v6 README uses plain `navigator.sendBeacon(url, body)` without the `fetch` fallback that the article shows.
- Avoid/caveats: `sendBeacon` and `fetch({keepalive:true})` bodies are limited (keepalive bodies: 64 KiB in flight), so batch small payloads. `fetchLater(url, {method:'POST', body, activateAfter})` queues a request that the browser sends when the page is destroyed or enters the bfcache, or when a timeout passes. Use it only as a progressive enhancement.
- Status: **Changed since the article:** Chrome is removing `unload` handlers by default. Rollout to all sites went from 1% (Chrome 146) to 100% at Chrome 154 (2026-09-22). Opt-back-in is possible through the Permissions Policy and the enterprise policy `ForcePermissionPolicyUnloadDefaultEnabled` (developer.chrome.com, updated 2026-07-14). `sendBeacon` is Baseline widely available. `fetchLater` is Chrome/Edge 135, experimental, "limited" (BCD, webstatus).
- Sources: https://web.dev/articles/vitals-field-measurement-best-practices, https://developer.chrome.com/docs/web-platform/deprecating-unload, https://web.dev/articles/bfcache, https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater, https://developer.mozilla.org/en-US/docs/Web/API/RequestInit

### Tag every metric with a deploy version and a server-assigned experiment group
- Layer: tooling
- Stage: idle
- Metrics: LCP, INP, CLS
- When: testing, build
- Impact: medium. Before/after comparisons by date are unreliable because of HTTP, service-worker, and CDN caches.
- Do: Attach a build id (and an experiment arm, if any) to each metric as a dimension. Assign experiment groups on the server.
- Why: Old cached builds keep reporting after a deploy. Client-side A/B tools often block rendering until they choose a variant, which hurts the LCP you are trying to measure.
- Example: `define: { __BUILD_ID__: JSON.stringify(gitSha) }` in the bundler, sent with every beacon.
- Avoid/caveats: none.
- Status: n/a
- Sources: https://web.dev/articles/vitals-field-measurement-best-practices

### Load RUM and analytics code last and asynchronously, and inline only the tiny part that must run early
- Layer: html, js
- Stage: network, script-run
- Metrics: LCP, INP, TBT
- When: load
- Impact: medium. Measurement code must not change what it measures.
- Do: Load the analytics bundle with `async` or `defer`, or dynamically after load. If one metric needs an early hook, inline only that small snippet in `<head>` (inline, so it does not block rendering) and defer the rest.
- Why: The performance APIs support late observers through `PerformanceObserver.observe({type, buffered: true})`, so loading late loses nothing.
- Example:
  ```ts
  new PerformanceObserver((l) => l.getEntries().forEach(report))
    .observe({ type: 'largest-contentful-paint', buffered: true });
  ```
- Avoid/caveats: Do not load all the analytics early just because one metric needs an early hook.
- Status: n/a
- Sources: https://web.dev/articles/vitals-field-measurement-best-practices

### Keep measurement code free of long tasks: run passive work when idle, and collect only data you will use
- Layer: js
- Stage: idle, main-thread-task
- Metrics: INP, TBT, memory
- When: long-lived session
- Impact: medium.
- Do: Run passive processing (serializing, aggregating Resource Timing) during idle time, using the "idle-until-urgent" pattern: schedule the work in idle time, but run it right away if the page is being hidden. Do not read layout (DOM measurements) in analytics handlers. Do not record every Resource Timing entry unless you will use it.
- Why: Analytics often runs in response to input, so heavy work there adds to INP. A large analytics bundle is also a long evaluation task.
- Example:
  ```ts
  const idle = (cb: () => void) =>
    'requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 2000 }) : setTimeout(cb, 1);
  ```
- Avoid/caveats: **`requestIdleCallback` is still not in Safari** (only in Technology Preview behind a flag, per BCD 8.1.2), so always include a fallback.
- Status: `requestIdleCallback` is Chrome 47 and Firefox 55, not Safari. webstatus lists it as "limited".
- Sources: https://web.dev/articles/vitals-field-measurement-best-practices, https://api.webstatus.dev/v1/features/requestidlecallback

---

## Lazy loading video (web.dev/articles/lazy-loading-video, updated 2026-07-02)

### Add `loading="lazy"` to below-the-fold `<video>` and `<audio>`, together with `preload` and `poster`
- Layer: html
- Stage: network, preload-scan
- Metrics: LCP, bandwidth
- When: load
- Impact: medium. It defers the poster, the media bytes, and autoplay until the element is near the viewport.
- Do: Add `loading="lazy"` to media that is not visible at load. Keep `preload`, `poster`, and `autoplay`, because the lazy attribute works together with them and does not replace them.
- Why: When the attribute is supported, the browser does not fetch the poster or media, and does not start autoplay, until layout shows the element near the viewport. Browsers without support ignore the attribute, so the poster loads at once and `preload` decides how much media to fetch.
- Example:
  ```html
  <video controls loading="lazy" preload="none" poster="/v/tutorial.jpg" width="640" height="360">
    <source src="/v/tutorial.webm" type="video/webm">
    <source src="/v/tutorial.mp4" type="video/mp4">
  </video>
  ```
- Avoid/caveats: Never lazy-load a video that is the LCP element.
- Status: Chrome/Edge 150 (BCD 8.1.2 marks it experimental; webstatus dates it 2026-06-30; the chromestatus entry lists 148 as planned). Firefox: position "Positive", implementation in progress. Safari: position "Support", implementation in progress. Limited availability.
- Sources: https://web.dev/articles/lazy-loading-video, https://chromestatus.com/feature/5200068565139456, https://api.webstatus.dev/v1/features/loading-lazy-media

### Use `preload="none"` on videos that do not autoplay, and raise it to `metadata` on hover
- Layer: html
- Stage: network
- Metrics: LCP, bandwidth
- When: load, interaction
- Impact: medium. With the default `metadata`, the browser can fetch more bytes than expected.
- Do: Set `preload="none"` and a `poster`. On `mouseenter` or `focus`, change `preload` to `metadata` so the duration appears and playback starts faster.
- Why: Most browsers default to `metadata`, which they fetch with range requests. The browser cannot know where the metadata sits in the file, so it may download a large part of it.
- Example:
  ```ts
  video.addEventListener('pointerenter', () => { video.preload = 'metadata'; }, { once: true });
  ```
- Avoid/caveats: none.
- Status: `preload` is supported everywhere.
- Sources: https://web.dev/articles/lazy-loading-video

### For a video that is the LCP element, preload its poster with high priority
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP
- When: load
- Impact: high on pages with a hero video.
- Do: Give the video a `poster`, and add `<link rel="preload" as="image" href="poster" fetchpriority="high">`, because the `poster` attribute has no `fetchpriority` of its own. Do not use `loading="lazy"` on it.
- Why: For `<video>`, LCP uses either the poster load time or the time the first frame is shown, whichever comes first. A poster image is much smaller than the first frame of the video.
- Example: See "Pair preload with fetchpriority" above.
- Avoid/caveats: none.
- Status: Baseline 2024 for `fetchpriority`.
- Sources: https://web.dev/articles/lazy-loading-video, https://web.dev/articles/lcp

### Replace animated GIFs with `<video autoplay muted loop playsinline>`
- Layer: html, build
- Stage: network, paint
- Metrics: LCP, bandwidth
- When: build
- Impact: medium. GIFs can reach several MB, and an equivalent video is much smaller.
- Do: Encode the animation as WebM and MP4, and use `autoplay muted loop playsinline` (iOS needs `playsinline` for inline autoplay). Add `loading="lazy"` where supported.
- Why: Video codecs compress motion much better than GIF.
- Example: `<video autoplay muted loop playsinline loading="lazy" width="480" height="270"><source src="demo.webm" type="video/webm"><source src="demo.mp4" type="video/mp4"></video>`
- Avoid/caveats: Respect `prefers-reduced-motion`, for example by showing a poster and not autoplaying.
- Status: n/a
- Sources: https://web.dev/articles/lazy-loading-video

### Where `loading="lazy"` is not supported, lazy-start video with an IntersectionObserver
- Layer: js
- Stage: network
- Metrics: bandwidth, LCP
- When: load
- Impact: low to medium.
- Do: In the markup, leave out `autoplay`, and add `preload="none"`, a `poster`, a `controls` fallback, and a marker class. When the element intersects the viewport, remove `preload` and `controls`, set `autoplay = true`, and stop observing it.
- Why: The browser does not fetch anything until the element becomes visible. `controls` keeps the video usable if the JS never runs.
- Example:
  ```ts
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const v = e.target as HTMLVideoElement;
      v.removeAttribute('preload'); v.removeAttribute('controls'); v.autoplay = true;
      io.unobserve(v);
    }
  });
  document.querySelectorAll<HTMLVideoElement>('video.lazy').forEach((v) => io.observe(v));
  ```
- Avoid/caveats: Remove this code once `loading="lazy"` on media is Baseline. The article lists vanilla-lazyload and lozad.js, which are based on IntersectionObserver.
- Status: IntersectionObserver is Baseline widely available (2019).
- Sources: https://web.dev/articles/lazy-loading-video

---

## Standard levers seen

One line each. Other research files cover these in depth.
- Order `<script>`/`<link>` tags the way you want them downloaded, because resources with equal priority load in the order they are found (fetch-priority).
- Use `async` or `defer` so scripts do not block other downloads. Lazy-load content below the fold so bandwidth goes to above-the-fold resources (fetch-priority).
- Preload resources the parser cannot find (fonts in CSS, CSS backgrounds, resources loaded by script). A preload is a required fetch, not a hint (fetch-priority).
- Preconnect to known cross-origin hosts to cut connection time (fetch-priority, fonts).
- Break up long tasks by yielding. Prefer `scheduler.yield()` (Chrome 129, Firefox 142, no Safari) with a `setTimeout` fallback, so third-party tasks do not run between your chunks (optimize-input-delay).
- Do as little work on the main thread as possible during interactions (optimize-input-delay).
- Prefer composited CSS animations (`transform`, `opacity`) to animations driven by `requestAnimationFrame`, which fill frames and delay other interactions (optimize-input-delay).
- Keep CSS selectors simple to reduce style recalculation cost (dom-size).
- Use `content-visibility: auto` and CSS containment to skip rendering of off-screen subtrees. `content-visibility` is Baseline newly available since 2025-09-15 (Safari 26 added `auto`). Firefox has had it since 125 (dom-size).
- Use TBT in the lab as a stand-in for load-time INP (script-evaluation, client-side-rendering).
- Move heavy JS into Web Workers. Scripts a worker loads (`importScripts` or module `import`) are evaluated off the main thread. Module workers are Baseline widely available (2025-12-06) (script-evaluation).
- Ship less JavaScript (script-evaluation).
- Render components on the server and hydrate only what must be interactive (client-side-rendering).
- Keep the DOM created on the client small (client-side-rendering).
- Do not lazy-load the LCP element (lazy-loading-video).
- Give media explicit `width` and `height` to reserve space (lazy-loading-video example).

## Sources read

- https://web.dev/articles/fetch-priority (2023-11-14)
- https://web.dev/articles/optimize-input-delay (2023-05-09)
- https://web.dev/articles/dom-size-and-interactivity (2023-05-09)
- https://web.dev/articles/script-evaluation-and-long-tasks (2023-05-09)
- https://web.dev/articles/client-side-rendering-of-html-and-interactivity (2023-05-09)
- https://web.dev/articles/font-best-practices (2022-10-04)
- https://web.dev/articles/vitals-field-measurement-best-practices (2022-05-11)
- https://web.dev/articles/lazy-loading-video (2026-07-02)
- https://developer.chrome.com/docs/performance/insights/dom-size (2025-10-08; an earlier saved copy in `raw/ins-dom-size.txt`)
- https://developer.chrome.com/docs/web-platform/deprecating-unload (updated 2026-07-14)
- https://web.dev/articles/bfcache (grep for the `unload` Permissions-Policy syntax)
- https://web.dev/articles/preload-optional-fonts (2020-03-18)
- https://web.dev/articles/lcp (2025-09-04; `<video>` LCP rule)
- https://webkit.org/blog/6643/improved-font-loading/ (2016-06-27)
- https://github.com/whatwg/html/issues/6230 (open)
- https://github.com/whatwg/html/pull/12758 and https://github.com/whatwg/html/pull/12753 (open)
- https://chromestatus.com/feature/5200068565139456 (lazy media), https://chromestatus.com/feature/5054329641893888 (HTML insertion and streaming methods), https://chromestatus.com/feature/5636954674692096 (web-font adaptive timeout), chromestatus search results for "Incremental font transfer", "font-display: optional without relayout", and "scheduler.yield()"
- https://github.com/GoogleChrome/web-vitals README (main branch) and https://registry.npmjs.org/web-vitals (latest 6.2.2)
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload (font `crossorigin`)
- https://developer.mozilla.org/en-US/docs/Web/API/RequestInit (`priority`, `keepalive` 64 KiB)
- https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater
- https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/font (loading fonts for canvas)
- https://svelte.dev/docs/svelte/legacy-svelte-fragment
- https://react.dev/reference/react-dom/server (API names)
- webstatus.dev API: features `fetch-priority`, `content-visibility`, `modulepreload`, `js-modules-workers`, `font-display`, `font-metric-overrides`, `font-size-adjust`, `requestidlecallback`, `fetchlater`, `largest-contentful-paint`, `event-timing`, `long-animation-frames`, `loading-lazy-media`, `parse-html-unsafe`, `font-loading`, `abortable-fetch`, `intersection-observer`, `scheduler`, `beacons`, `html-streaming-setters`, `html-setters`, `sanitizer`, `soft-navigations`, `document-write`, `import-maps`
- MDN browser-compat-data v8.1.2 (2026-09-17, local copy `raw/bcd.json`): keys for `@font-face` descriptors, `Scheduler.yield/postTask`, `requestIdleCallback`, `fetchLater`, `sendBeacon`, `video/audio.loading`, `fetchpriority`, `Request` `priority`, `setHTMLUnsafe`, `parseHTMLUnsafe`, LoAF, `interactionId`, `LargestContentfulPaint`, `content-visibility`, `addEventListener` `signal`, `document.write`, `modulepreload`, `preload as=font`, `preconnect`, `FontFaceSet.load`, `TaskController`

## Not covered / could not access

- I did not open the pages that the batch articles only link to: "Rendering on the web", "Faster multipage applications with streams" (Workbox), "Reduce the scope and complexity of style calculations", "content-visibility", Philip Walton's "idle-until-urgent" (a blog post), and "css-size-adjust". Their levers belong to other research files.
- The Chromium "defer scripts run in one task" behavior: I found no source newer than 2023 confirming or denying a change, so the claim is unverified for 2026. The WHATWG issue is still open.
- The shipping milestone for `loading="lazy"` on media conflicts between sources: chromestatus lists 148, while BCD and webstatus say 150. I report 150 because it matches the webstatus date (2026-06-30).
- The Chrome priority tiers ("first 5 images > 10,000 px² start at Medium", "tight mode") come only from the 2023 article, and I did not re-verify them against current Chromium source. Firefox and Safari priority mappings are not described.
- The ~100 KB per-script target is the article's rule of thumb. I found no measured source for it.
- The Google Fonts `text=` parameter and the subsetting tools (glyphhanger, subfont) were not re-checked for current behavior.
