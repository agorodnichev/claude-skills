# web.dev "Fast" collection: batch 2 of 6 (INP, CLS, field INP attribution, top CWV levers, preload, preconnect/dns-prefetch, prefetch, image lazy loading)

Scope: a full read of the 8 web.dev articles in `batches/fast-batch-02.md` (raw HTML and stripped text are in `raw/fast-batch-2/`). From each one I took every actionable lever and its mechanism. Browser support and deprecation status was checked on 2026-09-23 against MDN browser-compat-data (BCD) v8.1.2 (dated 2026-09-17), the webstatus.dev API, the web-vitals README (v6.2.2 on `main`), Chromium source (`settings.json5`), and the Chrome docs.
Standard levers that other research files cover (Core Web Vitals guides, HTML loading attributes, CSS rendering, event loop) are listed once each in "## Standard levers seen". The detail goes to levers that are new, more specific, or changed since each article was written.

## Article dates and advice that is out of date (as of 2026-09-23)

| Article | Last updated | Out of date or changed |
|---|---|---|
| Interaction to Next Paint (INP) | 2025-09-02 (published 2022-05-06) | Current. Since the update, Event Timing (with `interactionId`) became Baseline newly available on 2025-12-12 (Safari 26.2; Firefox 144 has `interactionId`), so INP can now be measured in all three engines. Chrome 151+ reports soft navigations (web-vitals `reportSoftNavs`). |
| Cumulative Layout Shift (CLS) | 2023-04-12 | Definitions are current. The Layout Instability API (`layout-shift` entries) is still **Chromium only** (BCD: Firefox and Safari `false`), so field CLS comes only from Chromium users. |
| Find slow interactions in the field | 2024-06-07 | Written for web-vitals v4. The library is now v6.2.2. `interactionType` is now `'pointer' \| 'keyboard'`. v5+ adds `longestScript` (with `subpart`), `totalScriptDuration`, `totalStyleAndLayoutDuration`, `totalPaintDuration`, `totalUnattributedDuration`, `loadState`, `nextPaintTime`. One code sample reads `script.sourceLocation`, which is **not** a real property: use `sourceURL`. LoAF is still Chromium only; it gained `paintTime`/`presentationTime` in Chrome 145. |
| The most effective ways to improve Core Web Vitals | 2024-10-31 | `Cache-Control: no-store` no longer blocks bfcache in Chrome (rollout finished Mar-Apr 2025, with limits). The `unload` deprecation reaches 100% of page loads in Chrome 154 (2026-09-22). Speculation rules are still Chromium only (Safari 26.2 behind a flag, Firefox no). The Lighthouse "Avoid non-composited animations" audit was folded into `cls-culprits-insight` in Lighthouse 13 (it stays as a diagnostic). `scheduler.yield()` is still not in Safari. |
| Preload critical assets to improve loading speed | footer 2018-11-05 (body was edited later: it names INP) | Mentions Time to Interactive; TTI was removed from Lighthouse in v10. The Lighthouse "Preload key requests" (`uses-rel-preload`) audit was removed in Lighthouse 13 ("risks of over recommending"). For ES modules, use `modulepreload` (Baseline widely available 2026-03-18), not `preload as=script`. The webpack magic comment is still valid but bundler specific. |
| Establish network connections early | footer 2019-07-30 (body edited later: it names `fetchpriority`) | **The claim "without `crossorigin` the browser only performs the DNS lookup" is misleading.** The newer Learn Performance module says the browser opens a new connection for the CORS fetch and does not reuse the preconnected one. The `dns-prefetch` as fallback for missing `preconnect` support is obsolete: `preconnect` is Baseline widely available (2022-07-15). The TTI numbers are from a removed metric. The "closes unused connection after 10 s" figure is from 2019 and I did not re-verify it. |
| Prefetch resources to speed up future navigations | 2025-02-08 (published 2019-09-12) | "Safari does not support prefetch" is **still true** (BCD: Safari 13.1 behind a flag only). The note that the double-keyed HTTP cache "will ship" is out of date: Chrome shipped cache partitioning in Chrome 86 (2020). Network Information API and `Save-Data` are Chromium only. Uses TTI numbers (removed metric). |
| Browser-level image lazy loading for the web | 2024-08-13 | Current. `loading` on `img` and `iframe` became Baseline widely available on 2026-06-19. The Chromium thresholds in the article (1250 px on 4G, 2500 px on 3G for images) still match `settings.json5`. The Lighthouse "Defer offscreen images" audit was removed in Lighthouse 13. |

---

## Interaction to Next Paint (web.dev/articles/inp, 2025-09-02)

### Give visual feedback in the very next frame after a click, tap, or key press
- Layer: js
- Stage: main-thread-task, style, layout, paint
- Metrics: INP
- When: interaction
- Impact: high. INP measures only the time until the next paint is unblocked, not the time until all async work is done.
- Do: In the event handler, make the smallest visual change first (pressed state, spinner, optimistic value), let the frame paint, then do the heavy or async work. Treat network results and later UI updates as outside the INP window.
- Why: INP latency = input delay + processing duration (all handlers for the interaction in that frame) + presentation delay (until the frame is presented). The metric is the longest interaction of the visit, with one outlier dropped for every 50 interactions, at the 75th percentile across page views. Good is ≤ 200 ms, poor is > 500 ms.
- Example:
  ```js
  // Before: the handler blocks the next paint with heavy work
  button.addEventListener('click', () => {
    recalcAllIndicators(); // 300 ms
    button.classList.add('active');
  });
  // After: paint the feedback first, then continue in a new task
  const yieldToMain = () => globalThis.scheduler?.yield
    ? globalThis.scheduler.yield()
    : new Promise((resolve) => setTimeout(resolve, 0)); // Safari fallback
  button.addEventListener('click', async () => {
    button.classList.add('active');
    await yieldToMain();
    recalcAllIndicators();
  });
  ```
- Avoid/caveats: Only click (mouse), tap (touch), and key press count. Hover, scroll, wheel, and pinch-zoom are not measured for INP (but they still matter for smoothness). For a chart, the `pointerdown` and `pointerup` of a drag are part of an interaction, but `pointermove` is not. Interactions inside iframes count in CrUX but are not visible to the page's own JS.
- Status: Event Timing entries are Baseline newly available since 2025-12-12 (webstatus `event-timing`). `interactionId`: Chrome 96, Firefox 144, Safari 26.2 (BCD). `scheduler.yield()`: Chrome 129, Firefox 142, not Safari (BCD).
- Sources: https://web.dev/articles/inp

### Measure INP across the whole lifetime of long-lived tabs and report it on every `visibilitychange` to hidden
- Layer: js
- Stage: idle
- Metrics: INP, CLS
- When: long-lived session, testing
- Impact: high for dashboards and trading terminals that stay open for hours or days. Without this, the final value is never sent.
- Do: Report the current value each time the page becomes hidden, not on `unload`. Compute the final value on the backend (take the last value per page view). Reset the value when the page is restored from bfcache (`pageshow` with `persisted`). Use the web-vitals library, which does all of this.
- Why: Users can keep a tab open for weeks. Mobile browsers often do not run unload callbacks for background tabs. `visibilitychange` fires both when the tab is hidden and before unload. A bfcache restore is a new visit for the user, so INP/CLS start again at zero.
- Example:
  ```js
  import {onINP, onCLS} from 'web-vitals';
  const send = (m) => navigator.sendBeacon('/rum', JSON.stringify({
    id: m.id, name: m.name, value: m.value, delta: m.delta,
  }));
  onINP(send); // web-vitals calls this again on each hidden event
  onCLS(send);
  ```
- Avoid/caveats: The callback can run more than once per page view, so send `id` + `delta` or dedupe on the server. Cross-origin iframes cannot be measured from the parent. Same-origin iframes need the library in each frame and a `postMessage` to the parent.
- Status: `visibilitychange` and `sendBeacon` are Baseline widely available (BCD). `unload` handlers no longer run by default in Chrome (100% at Chrome 154, 2026-09-22).
- Sources: https://web.dev/articles/inp, https://github.com/GoogleChrome/web-vitals (README), https://developer.chrome.com/docs/web-platform/deprecating-unload

### Know the Event Timing API gaps when you write your own INP collector
- Layer: tooling
- Stage: idle
- Metrics: INP, memory
- When: testing, long-lived session
- Impact: medium. A naive `PerformanceObserver` misses fast pages and keeps too much data.
- Do: Pass `durationThreshold` (minimum 16 ms) when you observe `event` entries, and also observe `first-input` so that every page with an interaction reports some value. Keep only the 10 worst interactions to estimate the p98 instead of storing all samples.
- Why: By default, `event` entries shorter than 104 ms are not dispatched. The `first-input` entry is always dispatched. For a high percentile like p98, a small list of the worst N is a good approximation and uses constant memory. web-vitals uses a threshold of 40 ms after it starts; before that the 104 ms default applies.
- Example:
  ```js
  const worst = []; // keep top 10 by duration, grouped by interactionId
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (!e.interactionId) continue;
      worst.push(e); worst.sort((a, b) => b.duration - a.duration);
      worst.length = Math.min(worst.length, 10);
    }
  }).observe({type: 'event', durationThreshold: 16, buffered: true});
  ```
- Avoid/caveats: A threshold of 16 ms runs the callback for almost every interaction. That is overhead on the main thread in an app with many key presses. Durations are rounded to 8 ms. Group entries by `interactionId`: one tap gives `pointerdown`, `pointerup`, and `click`, and the longest one is the interaction latency.
- Status: see the first INP item. `durationThreshold` is part of the Event Timing spec and is used by web-vitals v6.
- Sources: https://web.dev/articles/inp, https://github.com/GoogleChrome/web-vitals (README, `durationThreshold`)

### Reproduce slow interactions in the lab by interacting while the page loads
- Layer: tooling
- Stage: main-thread-task, script-run
- Metrics: INP, TBT
- When: testing
- Impact: medium. Lab tools that only load the page report no INP.
- Do: Start from field data. In the lab, follow the common user flows and click or type while the page is still loading, when the main thread is busiest. Use TBT only as a proxy when there is no interaction.
- Why: The value of INP depends on which interactions happen. A load-only lab run has no interactions, and TBT only estimates the main-thread blocking that input would meet.
- Avoid/caveats: Emulate a slow CPU. A fast developer machine hides long tasks.
- Status: n/a (method).
- Sources: https://web.dev/articles/inp

---

## Cumulative Layout Shift (web.dev/articles/cls, 2023-04-12)

### Insert new content where it does not move existing visible elements
- Layer: html, js, css
- Stage: layout
- Metrics: CLS
- When: load, long-lived session
- Impact: high for live lists (trade tapes, order books, notifications). Every insertion that moves rows that are already on screen adds to the score.
- Do: Append after the visible content, or into a slot that already has its final size. When a new item must go above existing items (sorted lists, newest-first feeds), keep a fixed pool of fixed-height row elements and rewrite their contents in place, or move the items with `transform`, so that the layout start positions of the visible elements do not change.
- Why: A layout shift happens only when a visible element that already existed changes its start position (top-left in the default writing mode) between two frames. A new element, or an element that only changes size, is not a shift unless it moves other visible elements. The score of one shift = impact fraction (union of old and new visible areas / viewport area) × distance fraction (largest move / largest viewport dimension). CLS is the largest "session window" of shifts: gaps under 1 s, window up to 5 s.
- Example:
  ```js
  // Before: prepending pushes every visible row down (layout shift)
  tape.prepend(renderRow(trade));
  // After: 30 fixed-height rows created once; only their text changes
  const rows = [...tape.children]; // row height fixed in CSS
  function showTrades(latest30) {
    latest30.forEach((t, i) => { rows[i].textContent = formatTrade(t); });
  }
  ```
- Avoid/caveats: The "after" example is my own application of the rule, not from the article. Test it with a `layout-shift` observer. I did not verify whether compensating a prepend with `scrollTop` avoids a reported shift, so do not rely on that. Elements that move partly out of the viewport count only for their visible area. Content drawn inside a `<canvas>` (for example, a chart) does not produce DOM layout shifts, but the DOM around it still can.
- Status: Layout Instability API: Chrome 77, not Firefox, not Safari (BCD, experimental). The metric exists only in Chromium.
- Sources: https://web.dev/articles/cls

### Reserve space at the moment of the interaction when the result arrives later than 500 ms
- Layer: js, css
- Stage: layout
- Metrics: CLS
- When: interaction
- Impact: medium. Shifts caused by slow async results are counted, even when a user started them.
- Do: When a click starts a network request, insert a placeholder with the final size (with a loading indicator) in the same frame. When the data arrives, replace its contents only.
- Why: Only shifts within 500 ms after a discrete input (tap, click, key press) get `hadRecentInput = true` and are excluded. A panel that appears 2 s after the click counts as an unexpected shift.
- Avoid/caveats: **Scrolls, drags, and pinch-zoom are not "recent input".** Layout shifts during a chart pan or drag-resize count toward CLS. During continuous gestures, move elements with `transform`, not with layout properties.
- Status: `hadRecentInput` is part of the Layout Instability API (Chromium only).
- Sources: https://web.dev/articles/cls

### Measure CLS with the reference implementation, not a raw sum
- Layer: tooling
- Stage: idle
- Metrics: CLS
- When: testing, long-lived session
- Impact: medium. A raw sum of all `layout-shift` values overstates CLS for long sessions.
- Do: Use `onCLS` from web-vitals. It groups shifts into session windows, drops shifts with `hadRecentInput`, reports on hidden, resets on bfcache restore, and reports nothing when the page loaded in the background.
- Why: The metric changed from "sum over the lifetime" to "largest burst" (session window). Lab tools see only the shifts during load, so the field CLS is often higher than the lab CLS.
- Avoid/caveats: With iframes, `onCLS` measures only the document's own shifts (DCLS). CrUX includes iframe shifts.
- Status: Chromium only (web-vitals README: `onCLS()`: Chromium).
- Sources: https://web.dev/articles/cls, https://github.com/GoogleChrome/web-vitals (README)

---

## Find slow interactions in the field (web.dev/articles/find-slow-interactions-in-the-field, 2024-06-07)

### Collect INP with the web-vitals attribution build and send the phase breakdown
- Layer: tooling
- Stage: idle
- Metrics: INP
- When: testing, long-lived session
- Impact: high. CrUX tells you only that INP is bad. The attribution tells you which element, which phase, and which script.
- Do: Import from `web-vitals/attribution`. Send `interactionTarget`, `interactionType`, `loadState`, `inputDelay`, `processingDuration`, `presentationDelay`, and the `longestScript` summary. Give a `generateTarget` function that returns a stable name (for example `data-name`) instead of a generated CSS selector.
- Why: Each phase has different causes. A big input delay means other work was on the main thread. A big processing duration means slow handlers. A big presentation delay means rendering work (rAF, observers, style/layout, paint, and also compositor/GPU/raster work).
- Example:
  ```js
  import {onINP} from 'web-vitals/attribution';
  onINP(({value, attribution: a}) => {
    navigator.sendBeacon('/rum', JSON.stringify({
      value, target: a.interactionTarget, type: a.interactionType,
      load: a.loadState, input: a.inputDelay, proc: a.processingDuration,
      pres: a.presentationDelay,
      script: a.longestScript && {
        subpart: a.longestScript.subpart,             // which phase it ran in
        url: a.longestScript.entry.sourceURL,
        fn: a.longestScript.entry.sourceFunctionName,
        invoker: a.longestScript.entry.invoker,
      },
    }));
  }, {generateTarget: (el) => el?.closest?.('[data-name]')?.dataset.name});
  ```
- Avoid/caveats: The article's samples use v4 (they sort `loaf.scripts` by hand). Since v5, `longestScript` does this for you. `interactionTarget` is an empty string when the element was removed from the DOM after the interaction, which is common in virtualized UIs.
- Status: web-vitals v6.2.2 (README on `main`). `onINP` works in Chromium, Firefox, and Safari. The LoAF fields (`longAnimationFrameEntries`, `longestScript`, `total*Duration`) are filled only in Chromium.
- Sources: https://web.dev/articles/find-slow-interactions-in-the-field, https://github.com/GoogleChrome/web-vitals (README)

### Use Long Animation Frame script attribution to find the exact slow function
- Layer: tooling
- Stage: main-thread-task, script-run, style, layout
- Metrics: INP, FPS/smoothness
- When: testing, long-lived session
- Impact: high. It points to file, character position, and function name in production code, and it shows whether the code is first-party or third-party.
- Do: For each LoAF entry, read `scripts[]`: `invoker` (for example `BUTTON#save.onclick`, `Window.requestAnimationFrame`, `Response.json.then`), `invokerType`, `sourceURL`, `sourceCharPosition`, `sourceFunctionName`, `forcedStyleAndLayoutDuration`. Ship source maps so that you can map the character position back to your source.
- Why: A LoAF entry covers one frame of more than 50 ms: `startTime`, `duration` (up to the end of layout, without paint/composite), `blockingDuration`, `renderStart` (rAF and ResizeObserver callbacks begin), `styleAndLayoutStart`, `firstUIEventTimestamp`. Script entries are reported only above 5 ms.
- Avoid/caveats: LoAF sees only work in frames of 50 ms or more. Short-but-many frames are "unattributed". One article sample reads `script.sourceLocation`; that property does not exist, so use `sourceURL`.
- Status: `PerformanceLongAnimationFrameTiming` and `PerformanceScriptTiming`: Chrome/Edge 123, not Firefox, not Safari (BCD, experimental). `paintTime` and `presentationTime`: Chrome 145.
- Sources: https://web.dev/articles/find-slow-interactions-in-the-field, https://developer.chrome.com/docs/web-platform/long-animation-frames

### Diagnose input delay from the `invokerType` of the script that ran before the interaction
- Layer: js
- Stage: script-compile, script-run, main-thread-task, microtask
- Metrics: INP
- When: load, long-lived session
- Impact: high. It tells you which kind of background work to break up.
- Do: Read the longest script of the first LoAF entry of the interaction, then act on its type:
  - `classic-script` / `module-script`: script evaluation during load. Split bundles, defer code that is not needed at start, remove unused code.
  - `user-callback`: a `setInterval`, `setTimeout`, or `requestAnimationFrame` callback. Make periodic work smaller, or yield inside it.
  - `event-listener`: an earlier input that is still being processed. Make handlers shorter.
  - `resolve-promise` / `reject-promise`: async work that settled at the moment of the input (for example a large `Response.json()` continuation). Split the continuation or move parsing off the main thread.
- Why: Input delay is the time from the input to the start of the first handler. It is caused by whatever task is running at that time. After load, the usual cause is periodic timers or queued callbacks.
- Example:
  ```js
  // Before: one timer tick processes the whole batch of updates (long task)
  setInterval(() => applyAll(pendingUpdates.splice(0)), 250);
  // After: process in slices and yield between slices
  setInterval(async () => {
    const batch = pendingUpdates.splice(0);
    for (let i = 0; i < batch.length; i += 200) {
      applyAll(batch.slice(i, i + 200));
      await yieldToMain(); // helper from the first INP item
    }
  }, 250);
  ```
- Avoid/caveats: Check `loadState` too. Interactions in `dom-interactive` point to load work, not to steady-state work.
- Status: `invokerType` values are from the LoAF spec (Chromium only). `scheduler.yield()` is not in Safari, so keep the fallback.
- Sources: https://web.dev/articles/find-slow-interactions-in-the-field

### Keep `requestAnimationFrame` callbacks to visual writes only
- Layer: js, canvas2d, gpu
- Stage: main-thread-task, style, layout, gpu-draw
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: high for render loops. rAF work runs after the event handlers and before style/layout, so all of it adds to presentation delay.
- Do: In rAF, do only work that changes what is painted (DOM/style writes, canvas or WebGL draw calls). Move data processing, parsing, aggregation, and analytics out of rAF (into the event handler after feedback, a later task, or a worker).
- Why: The LoAF gap `styleAndLayoutStart − renderStart` is roughly the time spent in rAF (and ResizeObserver) callbacks. In the article's example, 500 ms of rAF work delayed the frame by 500 ms.
- Example:
  ```js
  // Before
  requestAnimationFrame(() => {
    const candles = aggregate(ticks); // CPU work, no pixels
    chart.draw(candles);
  });
  // After: aggregate when data arrives; rAF only draws
  socket.onmessage = (e) => { candles = aggregate(parse(e.data)); dirty = true; };
  requestAnimationFrame(function loop() {
    if (dirty) { chart.draw(candles); dirty = false; }
    requestAnimationFrame(loop);
  });
  ```
- Avoid/caveats: Doing the aggregation in the message handler moves the cost to input delay if it is large. Batch it or move it to a worker when it is more than a few ms.
- Status: LoAF timing fields are Chromium only (BCD).
- Sources: https://web.dev/articles/find-slow-interactions-in-the-field

### Measure style and layout cost of an interaction from LoAF timestamps
- Layer: tooling, css
- Stage: style, layout
- Metrics: INP
- When: testing
- Impact: medium. It separates "slow JS" from "slow rendering" inside presentation delay.
- Do: Compute end-of-frame style/layout as `(startTime + duration) − styleAndLayoutStart`. Read `forcedStyleAndLayoutDuration` on script entries for layouts that JS forced inside handlers. If these are large, reduce selector complexity and DOM size, and remove read-after-write patterns.
- Why: LoAF gives only the start of the style/layout phase, not its length. The frame end (`startTime + duration`) is the end of layout. Forced layout is counted in the handler's processing time, not in the presentation delay.
- Avoid/caveats: web-vitals v5+ already gives `totalStyleAndLayoutDuration` (end-of-frame + forced) and `totalPaintDuration`, so you do not need to compute them yourself.
- Status: Chromium only.
- Sources: https://web.dev/articles/find-slow-interactions-in-the-field, https://github.com/GoogleChrome/web-vitals (README)

---

## The most effective ways to improve Core Web Vitals (web.dev/articles/top-cwv, 2024-10-31)

### Put the LCP image URL in the server HTML as `<img src|srcset>`, never behind `data-src` or an inline style
- Layer: html
- Stage: html-parse, preload-scan, network
- Metrics: LCP
- When: load
- Impact: high. On pages with poor LCP, the image download is usually under 10% of LCP, but the start of the download is delayed by 1,290 ms at p75.
- Do: Use a plain `<img>` with `src`/`srcset` in the HTML response. If the image is set in external CSS, in JS, or in an inline `style="background-image:…"`, add `<link rel="preload" as="image" fetchpriority="high">`.
- Why: Only URLs in real `src`/`srcset`/`href` attributes are found by the preload scanner. Images in inline styles are in the HTML but the scanner does not see them, so their discovery waits for other resources. 35% of LCP images were not discoverable from the initial HTML, and 7% were behind `data-src` (Web Almanac 2024).
- Example:
  ```html
  <!-- Before: invisible to the preload scanner -->
  <div class="hero" style="background-image:url(/img/hero.webp)"></div>
  <!-- After -->
  <link rel="preload" as="image" href="/img/hero.webp" fetchpriority="high">
  <div class="hero" style="background-image:url(/img/hero.webp)"></div>
  ```
- Avoid/caveats: In a client-rendered SPA, markup does not exist until JS runs, so prefer SSR or preload the LCP resource. `<canvas>` is not an LCP candidate type (web.dev/articles/lcp lists img, svg image, video, `url()` backgrounds, text blocks), so for a chart-first page the LCP element is usually text or an image around the chart.
- Status: `preload` Baseline widely available; `fetchpriority` Baseline newly available (2024-10-29).
- Sources: https://web.dev/articles/top-cwv, https://web.dev/articles/lcp

### Keep pages eligible for bfcache: no `unload`, and close live connections on `pagehide`
- Layer: js, network
- Stage: network, idle
- Metrics: LCP, CLS, INP
- When: load, long-lived session
- Impact: high. A bfcache restore shows the page at once, with no layout shifts. It was the biggest CLS improvement of 2022.
- Do: Never add `unload` listeners (use `pagehide` or `visibilitychange`). Close WebSocket/WebRTC connections and IndexedDB connections in `pagehide`, and reopen them in `pageshow` when `event.persisted` is true. Refresh stale data after a restore. Use `rel="noopener"` on links that open new windows. Find field blockers with `PerformanceNavigationTiming.notRestoredReasons`.
- Why: Open connections, `unload` handlers, and a non-null `window.opener` block bfcache. A restored page must be updated because its data may be old.
- Example:
  ```js
  addEventListener('pagehide', () => marketSocket?.close());
  addEventListener('pageshow', (e) => {
    if (e.persisted) { marketSocket = connect(); refreshQuotes(); }
  });
  ```
- Avoid/caveats: Chrome now lets `Cache-Control: no-store` pages into bfcache, but only for 3 minutes, and it evicts them on cookie changes, on a `no-store` fetch/XHR response, and when WebSocket, WebTransport, or WebRTC is in use. Keep `no-store` only for pages with sensitive data. To opt the whole page out of unload handlers now, send `Permissions-Policy: unload=()`.
- Status: Chrome `unload` deprecation: 100% of page loads at Chrome 154 (2026-09-22) (Chrome docs, updated 2026-07-14). bfcache for `no-store` pages: rollout completed in Chrome in Mar-Apr 2025. `notRestoredReasons`: Chrome 125, not Firefox/Safari (BCD).
- Sources: https://web.dev/articles/top-cwv, https://web.dev/articles/bfcache, https://developer.chrome.com/docs/web-platform/bfcache-ccns, https://developer.chrome.com/docs/web-platform/deprecating-unload

### Prerender likely next pages with speculation rules, and match eagerness to your confidence
- Layer: html
- Stage: network, html-parse, script-run
- Metrics: LCP, TTFB, CLS
- When: load
- Impact: high where it works. A correct prerender gives a near-zero LCP.
- Do: Add `<script type="speculationrules">` with document rules. Use `conservative` or `moderate` unless analytics show that a target is very likely. In the prerendered page, delay analytics and other side effects until `document.prerendering` is false (`prerenderingchange` event).
- Why: The browser loads and renders the page before the click. A wrong guess costs server and client resources.
- Example:
  ```html
  <script type="speculationrules">
  {"prerender": [{"where": {"href_matches": "/markets/*"}, "eagerness": "moderate"}]}
  </script>
  ```
- Avoid/caveats: In Chrome, `moderate` on desktop starts after 200 ms of hover or on `pointerdown`. `eager` starts after 10 ms of hover (since Chrome 143). Non-immediate speculations are limited to 2 (FIFO). Chrome skips speculation with Save-Data, energy saver on low battery, and memory pressure. A single-page app gets no benefit for in-app route changes.
- Status: Chrome/Edge 109+, eagerness 121+. Firefox: no. Safari 26.2: behind a flag (BCD). Limited availability (webstatus).
- Sources: https://web.dev/articles/top-cwv, https://developer.chrome.com/docs/web-platform/prerender-pages

### Serve HTML from a CDN edge, and cache it even for a short time
- Layer: network
- Stage: network
- Metrics: TTFB, FCP, LCP
- When: load
- Impact: medium. Nothing starts until the first byte of HTML arrives. Only 33% of HTML responses came from a CDN (Web Almanac 2024).
- Do: Cache static or semi-static HTML at the edge, even for a few minutes, and move simple dynamic logic to edge compute.
- Why: A shorter distance and a cache hit cut TTFB. Even a cache miss goes faster over the CDN's optimized connection to the origin.
- Avoid/caveats: Personalized or sensitive HTML must not be shared in the cache. Use short TTLs with revalidation.
- Status: n/a (infrastructure).
- Sources: https://web.dev/articles/top-cwv

### Never animate layout properties, even on absolutely positioned elements
- Layer: css
- Stage: layout, composite
- Metrics: CLS, FPS/smoothness
- When: animation/render-loop
- Impact: medium. Pages that animate `margin` or `border` widths have "poor" CLS at almost twice the overall rate.
- Do: Animate `transform: translate()/scale()` and `opacity`. Do not animate `top`/`left`/`width`/`height`/`margin`/`border-width`, unless it is a direct response to a tap or key press (hover does not count).
- Why: Any layout-property animation moves start positions frame by frame, which is a layout shift, even when the element is out of flow and pushes nothing. `transform` does not change layout and can run on the compositor.
- Example:
  ```css
  /* Before */ .toast { position: fixed; top: -60px; transition: top .3s; }
  /* After  */ .toast { position: fixed; top: 0; transform: translateY(-100%); transition: transform .3s; }
  ```
- Avoid/caveats: Respect `prefers-reduced-motion`. Slide-in banners (cookie, notification) are a frequent cause.
- Status: Lighthouse 13 folded "Avoid non-composited animations" into `cls-culprits-insight`; it still shows as a diagnostic.
- Sources: https://web.dev/articles/top-cwv, https://web.dev/articles/cls, https://developer.chrome.com/blog/moving-lighthouse-to-insights

### Do not use `isInputPending()` for yielding decisions
- Layer: js
- Stage: main-thread-task
- Metrics: INP
- When: interaction, load
- Impact: low. It is a reversed recommendation.
- Do: Yield on a fixed budget (for example, every ~50 ms) or after each unit of work with `scheduler.yield()` or a `setTimeout` fallback. Do not ask `navigator.scheduling.isInputPending()`.
- Why: In October 2024, web.dev reversed its advice to use `isInputPending` (reasons are in the "Optimize long tasks" article). Yielding also lets rendering happen, not only input.
- Status: `isInputPending()` is Chromium only (webstatus, limited).
- Sources: https://web.dev/articles/top-cwv

---

## Preload critical assets (web.dev/articles/preload-critical-assets, footer 2018-11-05)

### Always set a correct `as` (and `type`) on `rel=preload`
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP, FCP, bundle-size
- When: load
- Impact: medium. A missing or wrong `as` gives the wrong priority and can download the file twice.
- Do: Set `as` to `script`, `style`, `font`, `image`, `fetch`, and so on. Add `type` (for example `font/woff2`, `image/avif`) so that browsers that cannot use the format skip the preload.
- Why: `as` sets the priority, the `Accept` headers, and the cache match key. Without it, the preload is treated like an XHR and the later real request may not match it. With `type`, an unsupported format is not downloaded.
- Example:
  ```html
  <link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
  ```
- Avoid/caveats: Unused preloads cause a Chrome console warning about 3 s after `load`. Treat that warning as a bug.
- Status: `preload` Baseline widely available (low 2021-01-26, high 2023-07-26, webstatus).
- Sources: https://web.dev/articles/preload-critical-assets

### Add `crossorigin` when you preload fonts (and other CORS resources)
- Layer: html
- Stage: network
- Metrics: LCP, CLS
- When: load
- Impact: medium. Without it, the font downloads twice.
- Do: Put `crossorigin` on every font preload, even for same-origin fonts.
- Why: Fonts are always fetched in CORS anonymous mode. A preload without `crossorigin` is a no-CORS request, so the cache entry does not match the font request and the font is fetched again.
- Status: Current (Learn Performance "resource hints" repeats it, 2023-11-01).
- Sources: https://web.dev/articles/preload-critical-assets, https://web.dev/learn/performance/resource-hints

### Preload only late-discovered resources, and only a few
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP, FCP, INP
- When: load
- Impact: medium. Too many preloads fight for bandwidth, which is worst on slow networks.
- Do: Preload only what the browser finds late: fonts from `@font-face`, CSS background images, resources that JS requests, and the critical chunks of a split bundle. Do not preload what is already in the HTML.
- Why: Preload is mandatory for the browser (unlike `preconnect`/`prefetch`, which are hints). Lighthouse marks resources at the third level of the critical request chain as late-discovered. "If too many resources are prioritized, effectively none of them are."
- Avoid/caveats: The Lighthouse `uses-rel-preload` audit was removed in Lighthouse 13 because it over-recommended preload. Its request-chain view is now `network-dependency-tree-insight`.
- Status: see above.
- Sources: https://web.dev/articles/preload-critical-assets, https://developer.chrome.com/blog/moving-lighthouse-to-insights

### Use preload to separate download from execution of JS
- Layer: html, build
- Stage: network, script-compile, script-run
- Metrics: LCP, INP, startup
- When: load, build
- Impact: medium.
- Do: Preload the critical chunks of a split bundle so that they download in parallel. For ES modules, use `<link rel="modulepreload">`. Let the bundler emit these tags (webpack: `import(/* webpackPreload: true */ './chunk')`; Vite emits `modulepreload` for you).
- Why: Preloaded scripts are downloaded and cached but not run. The browser runs them only when the page asks for them, so the download is no longer on the critical path.
- Avoid/caveats: `preload as=script` for a module does not parse its dependencies. `modulepreload` fetches and parses the module, and some browsers also fetch its dependencies.
- Status: `modulepreload`: Chrome 66, Firefox 115, Safari 17. Baseline widely available 2026-03-18 (webstatus).
- Sources: https://web.dev/articles/preload-critical-assets

### Preload a lazy chunk when the user shows intent, before the interaction needs it
- Layer: js, build
- Stage: network, script-compile
- Metrics: INP
- When: interaction
- Impact: medium. It removes the network wait from the interaction when code splitting delays a handler.
- Do: When a user shows intent (focuses a form field, hovers or focuses a menu trigger, opens a panel), inject a preload for the chunk that the next interaction needs. The article's example is to preload validation code when a form field gets focus.
- Why: With code splitting, an interaction that needs a chunk that is not loaded must wait for download and compile. Loading it on intent hides that wait.
- Example:
  ```js
  const orderForm = document.querySelector('#order-form');
  orderForm.addEventListener('focusin', () => {
    import('./order-validation.js'); // starts fetch + compile, result is cached
  }, {once: true});
  ```
- Avoid/caveats: Preloading too much JS at startup competes for bandwidth. Load on intent, not at load time.
- Status: Dynamic `import()` is Baseline widely available.
- Sources: https://web.dev/articles/preload-critical-assets

### Choose the `font-display` value and preload together, with CLS in mind
- Layer: css, html
- Stage: network, layout, paint
- Metrics: CLS, LCP, FCP
- When: load
- Impact: medium.
- Do: Pick one of three patterns: (1) preload + `font-display: block` (no font-swap shift, but text is hidden for a short time); (2) preload + `font-display: fallback` (very short block, then fallback); (3) `font-display: optional` without preload for fonts that are not critical (fallback text stays; the font is used on the next page view). Serve WOFF2 only.
- Why: A swap from the fallback font to the web font changes text metrics, which moves layout. `optional` removes the swap in bad conditions. Preload shortens the time until the font is available.
- Avoid/caveats: Confirm with field CLS. Lab tests often have fonts in the cache. For metric matching, `size-adjust` is Chrome 92/Firefox 92/Safari 17, but `ascent-override` is not in Safari (BCD, preview only).
- Status: `font-display` Baseline widely available.
- Sources: https://web.dev/articles/preload-critical-assets

### Send preload hints in the `Link` response header
- Layer: network
- Stage: network, preload-scan
- Metrics: LCP, FCP
- When: load
- Impact: low to medium.
- Do: Send `Link: </css/app.css>; rel=preload; as=style` on the HTML response when the server knows the critical resources.
- Why: The browser can start the fetch before it parses any HTML.
- Avoid/caveats: The article does not mention 103 Early Hints, which sends the same header before the final response (Chrome 103, Firefox 120, Safari 17 in BCD). `fetchpriority` in the `Link` header: Chrome 103, Firefox 132, Safari 17.2.
- Status: `Link` header preload is Baseline.
- Sources: https://web.dev/articles/preload-critical-assets

---

## Establish network connections early (web.dev/articles/preconnect-and-dns-prefetch, footer 2019-07-30)

### Preconnect only to the few cross-origin hosts you will use within seconds, with the correct `crossorigin` mode
- Layer: html, network
- Stage: network
- Metrics: LCP, FCP, TTFB
- When: load
- Impact: medium. It saves 100–500 ms of DNS + TCP + TLS round trips per origin.
- Do: Use `<link rel="preconnect" href="https://cdn.example.com">` for 1–3 critical third-party origins, typically where you know the host but not the exact URL (versioned CDN paths, image CDN URLs that depend on runtime checks, media streams). Add `crossorigin` when the requests to that origin are CORS requests (fonts, `fetch()` in cors mode). Add a second preconnect without `crossorigin` if the same origin also serves no-CORS requests.
- Why: The browser keeps separate connection pools for credentialed/no-CORS and anonymous CORS requests. A preconnect in the wrong mode opens a connection that the real request cannot use. Preconnect has no effect for your own origin, because that connection is already open.
- Example:
  ```html
  <link rel="preconnect" href="https://fonts.example-cdn.com" crossorigin>
  <link rel="dns-prefetch" href="https://analytics.example.com">
  ```
- Avoid/caveats: The 2019 article says that the browser closes a connection that is not used in 10 s, and that each extra preconnect costs bandwidth for TLS certificates. Too many preconnects delay other resources. Use `preconnect` only when the resource cannot be made discoverable or preloaded; prefer an HTML `src` or a `preload` with `fetchpriority="high"` for the LCP resource.
- Status: `preconnect` Baseline widely available (high 2022-07-15, webstatus). The "only DNS lookup without `crossorigin`" sentence in the article is not correct; Learn Performance (2023-11-01) says a new connection is opened and the preconnected one is not reused.
- Sources: https://web.dev/articles/preconnect-and-dns-prefetch, https://web.dev/learn/performance/resource-hints, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preconnect

### Use `dns-prefetch` for the long tail of third-party origins, in separate `<link>` tags
- Layer: html
- Stage: network
- Metrics: LCP, FCP
- When: load
- Impact: low. It saves only the DNS step (about 20–120 ms).
- Do: Use `dns-prefetch` for origins that you will use but that are not critical. If you pair it with `preconnect` for the same origin, use two separate tags, never `rel="preconnect dns-prefetch"`.
- Why: A DNS lookup is cheap compared with a full connection. The combined `rel` value caused a Safari bug that cancelled the preconnect (2019).
- Avoid/caveats: The article's reason for the pairing ("fallback for browsers without `preconnect`") is obsolete; all current browsers support `preconnect`.
- Status: `dns-prefetch` Baseline newly available 2025-09-15 (Firefox 127 full support, Safari iOS 26) (webstatus, BCD).
- Sources: https://web.dev/articles/preconnect-and-dns-prefetch

### Send `preconnect` in a `Link` header on subresource responses
- Layer: network
- Stage: network
- Metrics: LCP, FCP
- When: load
- Impact: low to medium.
- Do: When a stylesheet or script will make the browser contact another origin, send `Link: <https://other.example>; rel=preconnect` on the stylesheet or script response (Google Fonts does this for its font host).
- Why: The hint does not wait for markup parsing, and the file that causes the later request can carry the hint for it.
- Status: Baseline (same as `preconnect`).
- Sources: https://web.dev/articles/preconnect-and-dns-prefetch

---

## Prefetch resources for future navigations (web.dev/articles/link-prefetch, 2025-02-08)

### Prefetch next-page or next-route resources at lowest priority, and only cacheable ones
- Layer: html, network
- Stage: network, idle
- Metrics: TTFB, FCP, LCP, INP
- When: load
- Impact: medium. A later navigation or chunk request becomes a cache hit.
- Do: Use `<link rel="prefetch">` for resources of the likely next page or route (documents, CSS, JS chunks, fonts that the current page does not use). Make sure they have cache headers that allow reuse. In Chromium, skip prefetch when `navigator.connection.saveData` is true or `effectiveType` is slow.
- Why: Prefetch runs at the "Lowest" priority in idle time, so it does not compete with the current page. The file is stored in the HTTP cache only if it is cacheable; otherwise it is thrown away. In Chrome, if a navigation starts while its prefetch is in flight, the navigation takes over that request. A prefetched stylesheet also prefetches its background images.
- Example:
  ```js
  const c = navigator.connection;
  if (!(c?.saveData || /2g/.test(c?.effectiveType ?? ''))) {
    const l = document.createElement('link');
    l.rel = 'prefetch'; l.href = '/assets/order-ticket.js';
    document.head.append(l);
  }
  ```
- Avoid/caveats: Safari does not support `rel=prefetch` (flag only). The article suggests a `fetch()` fallback for it. HTTP cache partitioning (Chrome 86+, and also Safari and Firefox) means that a prefetched subresource from `b.com` is not reused on another top-level site. For page navigations, speculation rules are better where supported: they handle non-cacheable documents and cross-origin prefetch in the same way every time. Each prefetch costs data for bytes that may never be used.
- Status: `rel=prefetch`: Chrome 8, Firefox 2, Safari 13.1 behind a flag (BCD). Limited availability (webstatus). Network Information `saveData`/`effectiveType`: Chromium only (BCD).
- Sources: https://web.dev/articles/link-prefetch, https://developer.chrome.com/blog/http-cache-partitioning

### Prefetch on-demand chunks that a later action will need
- Layer: build, js
- Stage: network, idle
- Metrics: INP
- When: build, interaction
- Impact: medium. The handler that does the dynamic `import()` no longer waits for the network.
- Do: Mark likely-soon chunks for prefetch in the bundler (webpack: `import(/* webpackPrefetch: true */ './picker.js')` emits a `rel=prefetch` tag). Or prefetch links as they enter the viewport during idle time (quicklink uses IntersectionObserver + `requestIdleCallback`).
- Why: The chunk is in the HTTP cache before the event that imports it.
- Avoid/caveats: quicklink uses `requestIdleCallback`, which Safari does not ship (BCD: preview behind flag). Prefetch does not compile the code; compile still happens at the time of `import()`.
- Status: see above.
- Sources: https://web.dev/articles/link-prefetch

---

## Browser-level image lazy loading (web.dev/articles/browser-level-image-lazy-loading, 2024-08-13)

### Lazy-load only images outside the first viewport, and always give them dimensions
- Layer: html
- Stage: network, layout
- Metrics: LCP, CLS, bundle-size
- When: load
- Impact: medium. It saves bandwidth. On images in the first viewport it hurts LCP.
- Do: Put `loading="lazy"` only on images below the initial viewport, together with `width` and `height` (or CSS sizes). Leave images in the first viewport eager (no attribute). In `<picture>`, put `loading` on the fallback `<img>` only.
- Why: A lazy image cannot start until layout knows where it is. Without dimensions, every lazy image is 0×0, so in a gallery all of them may seem to be in the viewport and all load at once. Dimensions also prevent layout shifts when the image loads late.
- Example:
  ```html
  <img src="/img/asset-1.webp" width="160" height="90" alt="">                <!-- in first viewport -->
  <img src="/img/asset-9.webp" width="160" height="90" alt="" loading="lazy"> <!-- below the fold -->
  ```
- Avoid/caveats: `loading="eager"` does not raise priority; use `fetchpriority="high"` for that. `lazy` + `fetchpriority="high"` is not useful. Lazy loading defers only when JS is enabled. CSS background images cannot use `loading`. All lazy images and iframes load when the page is printed.
- Status: `img loading`: Chrome 77, Firefox 75, Safari 15.4. `iframe loading`: Chrome 77, Firefox 121, Safari 16.4 (BCD). Baseline widely available 2026-06-19 (webstatus `loading-lazy`).
- Sources: https://web.dev/articles/browser-level-image-lazy-loading

### Know the Chromium distance thresholds and hidden-image behavior before you rely on lazy loading
- Layer: html
- Stage: network
- Metrics: LCP, bundle-size
- When: load
- Impact: low. It explains unexpected loads.
- Do: Expect Chromium to start a lazy image 1,250 px before it reaches the viewport on 4G and 2,500 px on 3G (iframes: 2,500 px on 4G, 3,500 px on 3G). Hide images with `display: none` (on the image or a parent) if they must not load. `opacity: 0` images still load.
- Why: The margins are fixed in Chromium's `settings.json5` and vary by effective connection type. There is no API to change them. Since Chrome 121, horizontal scrollers (carousels) use the same thresholds as vertical scrolling, so carousel images load earlier (more downloads, fewer visible pop-ins).
- Avoid/caveats: For custom thresholds, use an IntersectionObserver with a `rootMargin` instead of `loading="lazy"`.
- Status: Values checked in Chromium `main` `settings.json5` on 2026-09-23: `lazyLoadingImageMarginPx4G` = 1250, `…3G` = 2500, `lazyLoadingFrameMarginPx4G` = 2500, `…3G` = 3500. Lite mode and `loading="auto"` were removed (Chrome M100).
- Sources: https://web.dev/articles/browser-level-image-lazy-loading, https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/frame/settings.json5

### Remove lazy-loading libraries and `data-src` swaps
- Layer: html, js
- Stage: script-run, preload-scan
- Metrics: LCP, bundle-size
- When: load, build
- Impact: low to medium. It removes a JS dependency and makes images visible to the preload scanner.
- Do: Use the native attribute. Keep a library (for example lazysizes) only if you need custom thresholds or very old browsers, and load it only when `'loading' in HTMLImageElement.prototype` is false.
- Why: All major browsers support the attribute, and a browser without support ignores it with no harm. `data-src` hides the URL from the preload scanner and needs JS to show the image.
- Avoid/caveats: The Lighthouse "Defer offscreen images" audit was removed in Lighthouse 13, because browsers already deprioritize offscreen images.
- Status: see above.
- Sources: https://web.dev/articles/browser-level-image-lazy-loading, https://developer.chrome.com/blog/moving-lighthouse-to-insights

---

## Standard levers seen
- Break long tasks (> 50 ms) and yield often; `scheduler.yield()` keeps the task's place in the queue (top-cwv). Chrome 129/Firefox 142, not Safari.
- Ship less JS: use Baseline features instead of JS copies, find unused code with the DevTools Coverage tool, code-split code that is not needed for the first render, and remove old tag-manager tags (top-cwv).
- Group DOM reads before DOM writes to avoid forced layout and layout thrashing (top-cwv, find-slow-interactions).
- Keep the DOM small; layout cost grows with DOM size (top-cwv).
- Use CSS containment / `content-visibility` to skip rendering off-screen DOM (top-cwv). `content-visibility` Baseline newly available 2025-09-15.
- Put `fetchpriority="high"` on the LCP `<img>` or its preload, and never `loading="lazy"` on it (top-cwv, lazy-loading).
- Defer non-critical resources (move to the end, lazy-load images/iframes, load async) so the LCP resource gets bandwidth (top-cwv).
- Prefer SSR over CSR so that the LCP markup is in the HTML (top-cwv, preload).
- Set `width`/`height` on images; use `aspect-ratio` for embeds and ads; use `min-height` when the final size is unknown (top-cwv, cls, lazy-loading). `aspect-ratio` Baseline widely available.
- Use `transform: scale()/translate()` instead of `width`/`height`/`top`/`left` for movement (cls).
- Respect `prefers-reduced-motion` (cls).
- Lazy-load offscreen iframes with `loading="lazy"` (lazy-loading, top-cwv).
- Preload critical CSS that is loaded late in the critical-CSS pattern (preload).
- Serve fonts as WOFF2 (preload).
- Use CrUX (PageSpeed Insights, Search Console) to see whether a problem exists, and RUM to see why (inp, find-slow-interactions).
- Use `navigator.sendBeacon` to send RUM data (find-slow-interactions).

## Sources read
- https://web.dev/articles/inp
- https://web.dev/articles/cls
- https://web.dev/articles/find-slow-interactions-in-the-field
- https://web.dev/articles/top-cwv
- https://web.dev/articles/preload-critical-assets
- https://web.dev/articles/preconnect-and-dns-prefetch
- https://web.dev/articles/link-prefetch
- https://web.dev/articles/browser-level-image-lazy-loading
- https://web.dev/articles/bfcache (status check, via WebFetch)
- https://web.dev/articles/lcp (LCP candidate types, via WebFetch)
- https://web.dev/learn/performance/resource-hints (preconnect `crossorigin`, via WebFetch)
- https://developer.chrome.com/docs/web-platform/deprecating-unload (updated 2026-07-14)
- https://developer.chrome.com/docs/web-platform/bfcache-ccns (updated 2025-09-09)
- https://developer.chrome.com/docs/web-platform/prerender-pages (updated 2026-01-23)
- https://developer.chrome.com/blog/moving-lighthouse-to-insights
- https://developer.chrome.com/blog/http-cache-partitioning
- https://developer.chrome.com/blog/lighthouse-10-0 (search result summary only: TTI removed in Lighthouse 10)
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preconnect
- https://github.com/GoogleChrome/web-vitals README (raw, `main`, package version 6.2.2)
- MDN browser-compat-data v8.1.2 (2026-09-17), via https://cdn.jsdelivr.net/npm/@mdn/browser-compat-data/data.json
- webstatus.dev API: https://api.webstatus.dev/v1/features (event-timing, long-animation-frames, speculation-rules, fetch-priority, link-rel-preload, link-rel-prefetch, link-rel-preconnect, link-rel-dns-prefetch, modulepreload, loading-lazy, aspect-ratio, scheduler, bfcache-blocking-reasons, layout-instability, content-visibility, network-information, savedata, is-input-pending)
- Chromium `third_party/blink/renderer/core/frame/settings.json5` (main, via chromium.googlesource.com)

## Not covered / could not access
- The "10 seconds" idle timeout for unused preconnected sockets (2019 article) was not re-verified against current Chromium source.
- The Safari bug with `rel="preconnect dns-prefetch"` in one tag (2019) was not re-tested. It is not important now, because the fallback is no longer needed.
- The Chrome console warning for unused preloads ("about 3 s after load") was taken from the article; I did not check the current Chromium string or timing.
- I did not follow the linked deep guides (Optimize INP, Optimize long tasks, Optimize LCP, Optimize CLS, bfcache, Fetch Priority); other research files cover them.
- Whether Guess.js and quicklink are still maintained was not checked.
- Whether `preconnect` helps WebSocket connections (important for market-data feeds) is not in the articles, and I did not verify it.
- The "Insert new content where it does not move existing visible elements" example (fixed row pool, text rewritten in place) is my own application of the CLS definition; the article does not give it. I did not verify how the Layout Instability API treats a prepend that is compensated with `scrollTop`. The claim that canvas pixel changes produce no layout shift is also my inference from the definition (only DOM element start positions count).
