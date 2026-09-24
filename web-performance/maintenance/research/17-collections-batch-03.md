# web.dev collections deep read, batch 3 of 4 (animations + reliable)

Scope: levers that change how DOM animations, scroll effects, service workers and workers are written. Sources: web.dev "Web Animations API improvements in Chromium 84" (2020-05-27), "Why are some animations slow?" (2020-10-06), "Instant navigation experiences" (2020-06-23), "Imperative caching guide", "Two-way communication with service workers" and "Workers overview" (all 2020-12-08), the MDN CSS scroll-driven animations hub (2026-09-22) plus its three child guides, and Chrome DevTools "Animations" (2024-04-16).
Status checks: MDN Baseline banners and MDN browser-compat-data (BCD) API, read on 2026-09-22. Most of the web.dev articles are 4-6 years old. Each item marks the advice that is out of date.

## Standard levers seen

- Animate only `transform` and `opacity` (and `filter` in Chromium). Other properties restart the pipeline at style, layout or paint. Source: animations-overview (2020). Other agents cover this in detail.
- Layout animation cost grows with the size of the affected tree, and one change can cause layout "all the way back up to the top". Source: animations-overview.
- Paint is often the longest pipeline step. Keep repaint areas small and on their own layers. Source: animations-overview.
- Promote layers with care: each layer uses memory, and its textures must go to the GPU (CPU to GPU bandwidth). Source: animations-overview. `will-change` is Baseline (widely available since 2020-01, MDN).
- Frame budget = 1000 ms / refresh rate. The article gives 16.7 ms for 60 Hz. On 120 Hz screens it is about 8.3 ms (arithmetic, not from the article).
- Serve HTML navigations with `Cache-Control: no-cache`, not long max-age, so that HTML and the requests that follow it stay fresh. Source: instant-navigation (2020).
- Precache build-time static pages and hashed subresources (JS, CSS) at service worker install, with a revision for each entry. Source: instant-navigation.
- Move heavy computation (game logic, state) to a web worker so that the main thread stays free for input and animation (the PROXX example). Source: workers-overview. Comlink (a small RPC library, npm 4.4.2, last release 2024-11) wraps postMessage.
- Respect `prefers-reduced-motion` (Baseline since 2020-01, MDN).
- Background Sync (`SyncManager`) and Background Fetch (`BackgroundFetchManager`) retry sends and run long downloads after the tab closes. Both are still **Chromium only** (MDN "Limited availability", BCD: Chrome 49 / 74, no Firefox, no Safari). Background Fetch is still marked experimental. Use them only as progressive enhancements.

## Outdated or superseded advice in these articles (as of 2026-09)

| Article claim | Status today | Source |
|---|---|---|
| "The majority of painting ... is done in software rasterizers" (animations-overview, 2020) | Out of date for Chromium. Raster runs on the GPU main thread in the Viz process and makes GPU texture tiles. | developer.chrome.com/docs/chromium/renderingng-architecture |
| WAAPI works "in the browsers that support the API"; Chromium 84 adds the features | `Element.animate()` is Baseline since 2020-03. `finished`, `getAnimations()`, `commitStyles()`, `persist()` and the `remove` event are Baseline since 2020-07. | MDN Baseline banners |
| Composite modes are "now supported" (Chromium 84) | `KeyframeEffect.composite` is Baseline since 2022-09 (Safari 16). `iterationComposite` is still not in Chrome (BCD). | MDN, BCD |
| Future: "Scroll-linked animations with the Houdini API", GroupEffect, mutable timelines | Scroll-linked effects shipped as CSS scroll-driven animations (`ScrollTimeline`, `ViewTimeline`), not as Houdini Animation Worklet. GroupEffect and Animation Worklet have no entries in MDN BCD. | MDN scroll-driven hub, BCD |
| BroadcastChannel: "Safari ... don't support it yet" | Safari 15.4. Baseline since 2022-03. | MDN BroadcastChannel |
| Workers have no shared memory | `SharedArrayBuffer` is Baseline since 2021-12. It needs a secure context and cross-origin isolation (COOP + COEP). | MDN SharedArrayBuffer |
| Workbox `workbox.expiration.Plugin`, global `workbox.*` namespace | Workbox v5+ uses the module import `ExpirationPlugin` from `workbox-expiration`. The latest is workbox 7.4.1 (npm, 2026-05-04), now owned by Chrome's Aurora team. | developer.chrome.com/docs/workbox/modules/workbox-expiration, npm |
| `<link rel="prefetch">` is the default prefetch tool | MDN: "Limited availability". Safari supports it only behind a flag. For documents, MDN recommends the Speculation Rules API (Chromium only; Safari 26.2 behind a flag). | MDN rel=prefetch (mod 2026-04-22), BCD |
| Network Information API to skip prefetch on 2G | Still Chromium only. `effectiveType` and `saveData` are not in Firefox or Safari. | MDN, BCD |

---

### Run DOM UI animations as CSS or WAAPI on compositable properties, not as rAF style writes
- Layer: css | js
- Stage: composite, main-thread-task
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: high. On a busy page (for example, a WebGL chart drawing each frame) only compositor-driven animations keep a steady frame rate.
- Do: Animate DOM chrome (toolbars, popovers, crosshair labels, toasts) with CSS transitions/animations or `element.animate()` on `transform`/`opacity`. Keep `requestAnimationFrame` for canvas/WebGL drawing.
- Why: CSS animations and Web Animations on compositable properties run on the compositor thread. Long tasks on the main thread do not interrupt them. A rAF loop that writes `style.left` or `style.transform` each frame runs on the main thread and stops when the main thread is busy. If an animation causes layout or paint, the main thread must work either way, and CSS versus JS then makes little difference.
- Example:
  ```js
  // Before: main-thread loop, janks while the chart renders
  function tick(t) { panel.style.transform = `translateY(${ease(t) * 40}px)`; if (t < 1) requestAnimationFrame(tick); }
  // After: compositor-driven, one call
  panel.animate([{ transform: 'translateY(40px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
                { duration: 180, easing: 'ease-out' });
  ```
- Avoid/caveats: If you animate `top`, `width`, `background-color` and similar properties with WAAPI, they still need the main thread. Chromium announced composited `background-color` and `clip-path` animations in 2021. I could not confirm a shipped version.
- Status: `Element.animate()` is Baseline widely available since 2020-03 (MDN).
- Sources: https://web.dev/articles/animations-overview, https://web.dev/blog/web-animations, https://developer.chrome.com/blog/hardware-accelerated-animations

### Omit the start keyframe to retarget an animation from where it is now
- Layer: js
- Stage: style, layout, main-thread-task
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: medium. It removes a style/layout read (`getComputedStyle`, `getBoundingClientRect`) from pointer handlers.
- Do: Pass only the end keyframe to `element.animate()`. The browser takes the start value from the current underlying value, including a transition that is still running.
- Why: Partial keyframes let the engine infer the start position. The handler does not need to read the current position, so no forced style or layout happens. A new animation on the same property replaces the one in progress and does not jump.
- Example:
  ```js
  // Before: reads layout, then animates from the measured point
  const r = box.getBoundingClientRect();
  box.animate([{ transform: `translate(${r.x}px,${r.y}px)` }, { transform: `translate(${x}px,${y}px)` }], 300);
  // After: end keyframe only
  box.animate([{ transform: `translate(${x}px,${y}px)` }], { duration: 300, fill: 'forwards' });
  ```
- Avoid/caveats: This needs `fill: 'forwards'` or a committed final style, or the element snaps back at the end (see commitStyles below).
- Status: Baseline since 2020 (partial keyframes are part of `Element.animate()`, MDN).
- Sources: https://web.dev/blog/web-animations

### Let the browser remove replaced fill animations, and never call persist() in hot handlers
- Layer: js
- Stage: gc-memory, style
- Metrics: memory, FPS/smoothness
- When: interaction, long-lived session
- Impact: medium. Without auto-removal, an animation per `pointermove` grows the effect stack and memory without limit.
- Do: If you must create an animation per pointer or scroll event, use `fill: 'forwards'` on the same properties so that each finished animation replaces the one before. Do not call `persist()` on them. To check that removal happens, count `remove` events.
- Why: Browsers auto-remove a finished filling animation when a later, finished animation in the composite order animates the same properties (`replaceState` becomes `'removed'`, and `remove` fires). `persist()` turns this off.
- Example:
  ```js
  let removed = 0;
  area.addEventListener('pointermove', (e) => {
    const a = dot.animate({ transform: `translate(${e.clientX}px,${e.clientY}px)` },
                          { duration: 400, fill: 'forwards' });
    a.onremove = () => { removed++; };      // should approach the created count
  });
  ```
- Avoid/caveats: Engineering judgement (not in the article): for 1:1 pointer tracking such as a crosshair, one `style.transform` write per frame, coalesced in rAF, is cheaper than a new Animation object per event. Use per-event animations only when you need easing or a trail.
- Status: Replaceable animations (`persist`, `replaceState`, `remove` event) are Baseline since 2020-07 (MDN). They first shipped in Chromium 83.
- Sources: https://web.dev/blog/web-animations, https://developer.mozilla.org/en-US/docs/Web/API/Animation/remove_event

### Commit the final state with commitStyles(), then cancel(), instead of filling forever
- Layer: js
- Stage: style, gc-memory
- Metrics: memory, INP
- When: interaction, long-lived session
- Impact: medium. An animation with an indefinite fill stays in the effect stack and overrides normal styles, so later class or style changes seem to fail.
- Do: Await `animation.finished`, call `commitStyles()`, then `cancel()`.
- Why: `commitStyles()` writes the computed end values into the element's `style` attribute. Animations rank above all static styles, so an indefinite fill blocks later styling. MDN discourages indefinitely filling animations.
- Example:
  ```js
  const a = sheet.animate({ transform: 'translateY(0)' }, { duration: 200, fill: 'forwards' });
  await a.finished;
  a.commitStyles();   // final transform now lives in style=""
  a.cancel();         // drop the animation effect
  ```
- Avoid/caveats: In newer engines `commitStyles()` works without `fill`. MDN says this cannot be feature-detected, so keep `fill: 'forwards'` and then cancel. Another option is to put the end state in CSS first and animate from the old state.
- Status: `commitStyles()` is Baseline since 2020-07 (MDN).
- Sources: https://web.dev/blog/web-animations, https://developer.mozilla.org/en-US/docs/Web/API/Animation/commitStyles

### Sequence animations with animation.finished and animation.ready, not timers or delay arithmetic
- Layer: js
- Stage: main-thread-task
- Metrics: FPS/smoothness
- When: animation/render-loop, interaction
- Impact: low. This is mostly about correctness: steps stay in sync with real playback (pause, reverse, slow-down) and no timer is left behind.
- Do: Chain steps with `await a.finished`. Use `a.ready` before you read state after `play()`/`pause()`. Use `reverse()` for close effects, and do not build a second animation for them.
- Why: Promises settle on the animation's own timeline. `setTimeout` chains and `animation-delay` percentages drift from the real state after a pause or an interruption.
- Example:
  ```js
  await menu.animate(openFrames, { duration: 160 }).finished;
  items.forEach((el, i) => el.animate(fadeIn, { duration: 120, delay: i * 20, fill: 'backwards' }));
  ```
- Avoid/caveats: `finished` rejects when an animation is cancelled. Catch the rejection so that it does not become an unhandled rejection.
- Status: Baseline since 2020-07 (MDN).
- Sources: https://web.dev/blog/web-animations

### Control CSS animations from JS with getAnimations(), for example to pause them in hidden panels
- Layer: js
- Stage: composite, main-thread-task
- Metrics: FPS/smoothness, memory
- When: long-lived session
- Impact: low to medium. Infinite spinners and pulses in collapsed or background panels keep the frame pipeline busy.
- Do: Use `el.getAnimations({ subtree: true })` to get the CSS animations, CSS transitions and WAAPI animations of a panel, and pause, cancel or finish them when the panel hides.
- Why: `getAnimations()` returns every animation on the element, no matter how it was created. You can control CSS-declared animations without CSS class tricks. The article uses it to read a running transition and build a cross-fade.
- Example:
  ```js
  function setPanelActive(panel, active) {
    for (const a of panel.getAnimations({ subtree: true })) active ? a.play() : a.pause();
  }
  ```
- Avoid/caveats: The pause-when-hidden use is my inference from the API. The article shows only the cross-fade use. `display: none` already stops CSS animations. Use this for panels that are hidden by `visibility`, `opacity` or overlap.
- Status: `Element.getAnimations()` Baseline 2020-07; `Document.getAnimations()` is also Baseline (Safari 14) (MDN/BCD).
- Sources: https://web.dev/blog/web-animations

### Layer micro-effects on a base animation with composite: 'add' or 'accumulate'
- Layer: js
- Stage: style, composite
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low. It removes JS that merges keyframes, and effects combine smoothly.
- Do: Run a base animation and add a short second animation with `composite: 'add'` (or `'accumulate'`) on the same property, so that you do not recompute combined keyframes.
- Why: `'replace'` (the default) replaces the underlying value. `'add'` appends transform functions (rotation adds, scale multiplies). `'accumulate'` merges values (scale sums). The article's example: two effects that end at `rotate(360deg) scale(1.4)` in replace mode reach `rotate(720deg) scale(1.96)` with add and `rotate(720deg) scale(1.8)` with accumulate.
- Example:
  ```js
  const base = chip.animate({ transform: ['translateY(-24px)', 'none'] }, { duration: 220, fill: 'forwards' });
  await base.finished;
  chip.animate({ transform: ['none', 'translateY(4px)', 'none'] }, { duration: 180, composite: 'add' });
  ```
- Avoid/caveats: The article's drop-down demo composites `top`, which is a layout property. Use `transform` to stay on the compositor.
- Status: `KeyframeEffect.composite` Baseline since 2022-09. `iterationComposite` is not in Chrome (BCD 2026-09).
- Sources: https://web.dev/blog/web-animations

### Replace scroll listeners and IntersectionObserver effects with CSS scroll-driven animations
- Layer: css
- Stage: composite, main-thread-task
- Metrics: FPS/smoothness, INP, TBT
- When: animation/render-loop
- Impact: high where supported. Scroll-linked effects stay in sync with scrolling during main-thread load.
- Do: Link keyframes to scroll with `animation-timeline: scroll(<scroller> <axis>)` (scroll position) or `view(<axis> <inset>)` (the element's visibility in its nearest scroller). Name timelines with `scroll-timeline`/`view-timeline` when another element must drive the animation. Use `timeline-scope` to let a non-ancestor use the name. Animate compositable properties. From JS, use `new ScrollTimeline({ source, axis })` or `new ViewTimeline({ subject })` with `element.animate()`.
- Why: Scrolling runs on its own thread and delivers `scroll` events to the main thread asynchronously, so JS-driven effects lag and jank. Scroll-driven animations of `transform`/`opacity` run off the main thread. In Chrome's case study, a heavy loop on the main thread made the JS version janky, and the CSS version was "completely unaffected".
- Example:
  ```css
  .reading-progress {
    transform-origin: 0 50%;
    animation: grow 1ms linear;          /* shorthand first */
    animation-timeline: scroll(root block); /* then the timeline */
  }
  @keyframes grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @supports not (animation-timeline: scroll()) { .reading-progress { display: none; } }
  ```
- Avoid/caveats: The scroller must really overflow, or no timeline exists. `view()` has no scroller argument; it always uses the nearest ancestor scroller. Firefox has no support, so give a static fallback with `@supports`. Do not add a JS polyfill that brings the scroll listener back on the main thread.
- Status: **Limited availability** (MDN, 2026-09). BCD: Chrome/Edge 115, Safari 26 (macOS and iOS), Firefox "preview" only. This covers `animation-timeline`, `scroll-timeline`, `view-timeline`, `animation-range`, `timeline-scope`, `ScrollTimeline` and `ViewTimeline`.
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations, https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timelines, https://developer.chrome.com/blog/scroll-animation-performance-case-study

### Declare animation-timeline after the animation shorthand, and give scroll-driven animations a 1ms duration
- Layer: css
- Stage: style
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium. If you get this wrong, the animation silently runs on the time-based document timeline, or it does not apply in Firefox.
- Do: Put `animation-timeline` after any `animation` shorthand (the shorthand resets it to `auto`). Set the duration to `1ms`. For reduced motion, set `animation-timeline: none` with a selector that the shorthand cannot override.
- Why: The shorthand cannot set `animation-timeline`, but it resets it. The duration does not control scroll progress. Firefox needs a non-zero duration to apply the animation, and durations can change non-linear view timelines. With `1ms`, an unsupported timeline also finishes out of sight. `none` removes the element from every timeline, including the document timeline.
- Example:
  ```css
  .card { animation: reveal 1ms linear both; animation-timeline: view(); }
  @media (prefers-reduced-motion: reduce) { .card.card { animation-timeline: none; } }
  ```
- Avoid/caveats: With `1ms` on a time-based fallback, animation events still fire. Do not put logic on `animationend` for these elements.
- Status: See the scroll-driven item: Limited availability. The advice comes from the MDN Timelines guide (mod 2026-03-29).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timelines

### Choose view-timeline ranges so that the effect finishes while the element is visible
- Layer: css
- Stage: style
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low. This is correctness of scroll reveals, and it prevents wasted frames on off-screen progress.
- Do: Use `animation-range: entry` for reveal-on-enter, `exit` for leave effects, and `contain` for "fully visible" effects. For subjects taller than the scrollport, use `entry-crossing`/`exit-crossing`. If you keep the default `cover`, end the visible change at the 20-80% keyframes.
- Why: The default range (`normal`, which resolves to `cover`) runs from the first pixel entering to the last pixel leaving. 100% is reached only off-screen. `entry`/`exit` are the subject's size clamped to the scrollport. The `*-crossing` ranges are not clamped. Length insets count from the start of the named range. Percentages are relative to the range, not to the scrollport, so they move with subject size.
- Example:
  ```css
  .row { animation: fade-in 1ms linear both; animation-timeline: view(); animation-range: entry 10% entry 90%; }
  ```
- Avoid/caveats: `contain` on a subject that is exactly as tall as the scrollport gives a range of 0 px (instant). An end inset beyond the scroll extent (for example `exit 250px` near the page end) may never be reached, so the animation never finishes.
- Status: Limited availability (Chrome 115, Safari 26; no Firefox) (MDN/BCD).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timeline_range_names, https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timeline_insets

### Inspect DOM animations in the DevTools Animations drawer, and canvas/WebGL animations in the Performance panel
- Layer: tooling
- Stage: composite, main-thread-task
- Metrics: FPS/smoothness
- When: testing
- Impact: low. It shortens tuning loops, but it has a gap for rAF.
- Do: Open "Show Animations" and trigger the animation with the drawer open (reload for load-time animations). Slow down, scrub and replay the group. Drag to change duration, delay and keyframe offsets. Edit `@keyframes` live in Styles. Pause first to inspect `::view-transition-*` pseudo-elements. rAF-driven animation (for example SciChart render loops) does not show in this drawer. Profile it in the Performance panel.
- Why: The drawer captures CSS animations, CSS transitions, WAAPI animations and View Transitions. It groups animations by start time. It shows scroll-driven groups on a pixel timeline and time-based groups in milliseconds. The page says that `requestAnimationFrame` animations "are not yet supported".
- Avoid/caveats: Edits apply as inline styles, so copy them back to the source. Keyframe and Bezier editing are not in the drawer (use the Styles pane easing editor). Async-started animations land in separate groups.
- Status: Current Chrome DevTools feature (page updated 2024-04-16).
- Sources: https://developer.chrome.com/docs/devtools/css/animations/

### Enable navigation preload whenever a service worker has a fetch handler
- Layer: network | js
- Stage: network
- Metrics: TTFB, FCP, LCP
- When: load
- Impact: high for sites with a service worker. SW startup otherwise adds to every navigation that is not served from cache.
- Do: In `activate`, call `self.registration.navigationPreload.enable()`. In `fetch`, use `await event.preloadResponse` before you fall back to `fetch(event.request)`.
- Why: If the browser boots the service worker and the worker does not answer the navigation, the page pays the startup latency. Navigation preload starts the network request in parallel with SW startup. The request carries a `Service-Worker-Navigation-Preload` header, which the server can use.
- Example:
  ```js
  self.addEventListener('activate', (e) => e.waitUntil(self.registration.navigationPreload?.enable()));
  self.addEventListener('fetch', (e) => {
    if (e.request.mode !== 'navigate') return;
    e.respondWith((async () => (await e.preloadResponse) || fetch(e.request))());
  });
  ```
- Avoid/caveats: If the worker serves navigations cache-first, preload wastes a request. The newer Service Worker Static Routing API (`InstallEvent.addRoutes`) can skip SW startup for chosen routes. BCD: Chrome 123, Safari 27, no Firefox. I did not read its docs in this batch.
- Status: `NavigationPreloadManager` is Baseline since 2022-04 (Chrome 59, Firefox 99, Safari 15.4) (MDN).
- Sources: https://web.dev/case-studies/instant-navigation-experiences, https://developer.mozilla.org/en-US/docs/Web/API/NavigationPreloadManager

### Treat `<link rel="prefetch">` as a short-lived, non-Safari hint, and prefer Speculation Rules for next documents
- Layer: html | network
- Stage: network, idle
- Metrics: LCP, FCP, TTFB (of the next navigation)
- When: load, interaction
- Impact: high for multi-page flows. Virgilio Sport reported 78% faster article loads and 45% more article impressions with SW prefetch of popular posts.
- Do: Prefetch only likely next pages (for example the next results page when the user scrolls to the end of a list). For documents, use `<script type="speculationrules">` where supported, with a `<link rel="prefetch">` or SW fallback.
- Why: `rel=prefetch` fetches at the lowest priority into the HTTP cache. Chrome keeps it for about 5 minutes, and then the normal `Cache-Control` rules apply. `no-cache`/`no-store` can block reuse, and cache partitioning makes cross-site prefetch useless. Speculation rules prefetch into a per-document memory cache that `Cache-Control` does not block. They skip work in Battery Saver or Data Saver mode.
- Example:
  ```html
  <script type="speculationrules">
  { "prefetch": [{ "where": { "href_matches": "/instrument/*" }, "eagerness": "moderate" }] }
  </script>
  ```
- Avoid/caveats: Prefetch spends bytes on pages that may not be visited. Data can be up to about 5 minutes old at activation.
- Status: `rel=prefetch`: MDN "Limited availability" (Chrome 8, Firefox 2; Safari only behind a flag). Speculation Rules: MDN "Limited availability", BCD experimental (Chrome 109; Safari 26.2 behind a flag; no Firefox). The article's "as of Chrome 85, 5 minutes" still matches MDN's current note for Chrome.
- Sources: https://web.dev/case-studies/instant-navigation-experiences, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/prefetch, https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API

### Extend prefetched pages past the 5-minute window with a service worker runtime cache
- Layer: js | network
- Stage: network
- Metrics: LCP, TTFB (of later navigations)
- When: load, long-lived session
- Impact: medium. Repeat visits to prefetched pages come from the cache, and they also work offline.
- Do: Route prefetched document URLs through a stale-while-revalidate strategy with an expiration plugin (max age and max entries).
- Why: The SW cache does not follow the prefetch timeout. Stale-while-revalidate serves the cached copy at once and refreshes it from the network in the background.
- Example (current Workbox module names; the article uses the pre-v5 `workbox.expiration.Plugin`):
  ```js
  import { registerRoute } from 'workbox-routing';
  import { StaleWhileRevalidate } from 'workbox-strategies';
  import { ExpirationPlugin } from 'workbox-expiration';
  registerRoute(({ request, url }) => request.destination === 'document' && url.pathname.startsWith('/product/'),
    new StaleWhileRevalidate({ cacheName: 'docs', plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 7 * 86400 })] }));
  ```
- Avoid/caveats: Stale HTML can show old prices or state. Do not use this for pages whose freshness matters, such as live quotes. With `maxAgeSeconds` alone, an expired response can be served once before cleanup. Also set `maxEntries`.
- Status: Cache API (`CacheStorage`) is Baseline since 2018 (BCD: Safari 11.1). The latest Workbox is 7.4.1 (2026-05).
- Sources: https://web.dev/case-studies/instant-navigation-experiences, https://developer.chrome.com/docs/workbox/modules/workbox-expiration

### Delegate prefetch fan-out and post-processing to the service worker with a fire-and-forget postMessage
- Layer: js
- Stage: main-thread-task, network
- Metrics: INP, TBT
- When: load, interaction
- Impact: medium. It takes JSON parsing, URL discovery and many `<link>` injections off the main thread.
- Do: Send the SW one message with the URL list (`navigator.serviceWorker.controller?.postMessage({ type: 'PREFETCH', urls })`). In the SW, fetch, cache and parse follow-up URLs (for example product images found in the JSON). Wrap the work in `event.waitUntil()`.
- Why: The SW runs on another thread and is shared by all tabs in its scope. A failure does not affect the page: the next navigation is only slower. In client-rendered lists, injecting prefetch tags from an API response costs main-thread time.
- Example:
  ```js
  // sw.js
  self.addEventListener('message', (event) => {
    if (event.data?.type !== 'PREFETCH') return;
    event.waitUntil((async () => {
      const cache = await caches.open('prefetch');
      await Promise.allSettled(event.data.urls.map(async (u) => {
        const res = await fetch(u);
        if (res.ok) await cache.put(u, res.clone());
      }));
    })());
  });
  ```
- Avoid/caveats: The article's sample calls `fetch` without `waitUntil`, so the browser can end the SW before the work completes. `ExtendableMessageEvent` extends the event lifetime (Baseline since 2018-04). `controller` is null on the first load before `clients.claim()`. Storing `no-cache` responses in the SW cache overrides server freshness on purpose. Limit it to data that can be a little stale.
- Status: `postMessage` to a SW and the `message` event are Baseline since 2018-04 (MDN).
- Sources: https://web.dev/articles/imperative-caching-guide, https://developer.mozilla.org/en-US/docs/Web/API/ExtendableMessageEvent

### Prefetch on intent: the top N at load time, the rest on hover
- Layer: js | network
- Stage: network, idle
- Metrics: LCP/TTFB of the next view, bandwidth
- When: interaction
- Impact: medium. Most clicks hit a warm cache, and you do not fetch the whole list.
- Do: At load time, prefetch data for the few items most likely to be opened (1-800-Flowers: top 9 products' JSON). For the other items, start the fetch on `pointerover`/`mouseover`, and only once per item.
- Why: Hover usually comes a few hundred ms before a click. That time is enough to fetch small JSON. On click, the view reads the cached response.
- Example:
  ```js
  const warmed = new Set();
  list.addEventListener('pointerover', (e) => {
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (id && !warmed.has(id)) { warmed.add(id); navigator.serviceWorker.controller?.postMessage({ type: 'PREFETCH', urls: [`/api/item/${id}`] }); }
  });
  ```
- Avoid/caveats: There is no hover on touch devices, so also use `pointerdown` or viewport visibility. Throttle this on data-saver or slow connections (next item). Speculation rules `eagerness: "moderate"` gives hover-based prefetch for documents in Chromium.
- Status: Uses Baseline APIs only.
- Sources: https://web.dev/articles/imperative-caching-guide

### Gate speculative fetching on connection quality, with feature detection
- Layer: js | network
- Stage: network
- Metrics: bandwidth, memory
- When: load
- Impact: low to medium. It stops prefetch from competing with critical requests on slow or metered links.
- Do: Skip prefetch when `navigator.connection?.saveData` is true or `effectiveType` is `'slow-2g'`/`'2g'`. If the API is missing, choose a safe default (for example, prefetch only on hover).
- Why: Prefetch spends bytes on resources that are "not immediately needed" (imperative-caching guide). Virgilio Sport turned it off on 2G.
- Example:
  ```js
  const c = navigator.connection;
  const allowPrefetch = !(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType)));
  ```
- Avoid/caveats: Safari and Firefox users get no signal. Do not treat "missing" as "fast".
- Status: Network Information API is **Limited availability** (MDN). `effectiveType` and `saveData` are Chromium only (BCD: Chrome 61/65, no Firefox, no Safari).
- Sources: https://web.dev/case-studies/instant-navigation-experiences, https://web.dev/articles/imperative-caching-guide, https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation

### Choose the worker type by the job: web workers for compute, the service worker for network proxy and caching
- Layer: js
- Stage: main-thread-task
- Metrics: INP, TBT, FPS/smoothness
- When: long-lived session
- Impact: high when misused. A long task in a SW gets killed, and compute in the SW is shared by every tab.
- Do: Put CPU work (parsing, indicator math, state) in dedicated web workers, one or more per page. Put request interception, caching and offline logic in the service worker. Do not keep long-running or streaming work (for example market-data sockets) in a service worker.
- Why: Neither worker type has DOM access. A page can start many web workers, and they end with the tab. One service worker serves all tabs in its scope, and its lifetime does not depend on the tab. The browser ends it when a task runs too long, to protect privacy and battery.
- Avoid/caveats: Every hop through postMessage costs a structured clone. Batch messages. The articles do not cover transferables; see the Web APIs notes.
- Status: Web Workers and Service Workers are Baseline (MDN).
- Sources: https://web.dev/articles/workers-overview, https://web.dev/articles/two-way-communication-guide

### Use SharedArrayBuffer under cross-origin isolation for zero-copy data between threads (the article's "no shared memory" is out of date)
- Layer: js | network
- Stage: main-thread-task, gc-memory
- Metrics: memory, INP, FPS/smoothness
- When: long-lived session
- Impact: medium to high for large, often-updated buffers (tick series) shared between a worker and the renderer.
- Do: Serve the page with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`). Check `crossOriginIsolated`. Then share a `SharedArrayBuffer` and coordinate with `Atomics`.
- Why: Without shared memory, each postMessage copies (clones) the payload. With cross-origin isolation, `postMessage()` no longer throws for a SharedArrayBuffer, and several threads can read the same memory.
- Example:
  ```js
  if (crossOriginIsolated) {
    const sab = new SharedArrayBuffer(4 * 1_000_000);
    worker.postMessage({ sab });            // no copy
    const prices = new Float32Array(sab);   // worker writes, renderer reads
  }
  ```
- Avoid/caveats: COEP blocks cross-origin resources that do not opt in (CORP/CORS), which can break third-party widgets and iframes. Without isolation, fall back to transferable `ArrayBuffer`s.
- Status: `SharedArrayBuffer` Baseline since 2021-12 (Chrome 68, Firefox 79, Safari 15.2). It needs a secure context and cross-origin isolation (MDN).
- Sources: https://web.dev/articles/workers-overview, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer

### Pick the channel by the conversation shape: MessageChannel for request/response, BroadcastChannel for cross-tab fan-out, Clients for SW-to-tab
- Layer: js
- Stage: main-thread-task
- Metrics: INP, memory, bandwidth
- When: long-lived session
- Impact: medium. With several terminal tabs open, you can do shared work once and broadcast it, and each tab does not repeat it.
- Do: For a reply, send a `MessageChannel` port with the message and answer on `event.ports[0]`, so that there is no global dispatch or ID matching. To sync state across same-origin tabs and workers without references, use `new BroadcastChannel(name)`. From the SW, reach tabs with `clients.matchAll()` + `client.postMessage()`. Workbox's `messageSW()` wraps the MessageChannel pattern.
- Why: A port is a private 1:1 pipe. BroadcastChannel delivers to every context that listens on the name. The SW sees all its clients, so one context can do the fetch or computation and inform the others.
- Example:
  ```js
  // page: ask the SW and await one reply
  function askSW(msg) {
    return new Promise((resolve) => {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = (e) => resolve(e.data);
      navigator.serviceWorker.controller.postMessage(msg, [port2]);
    });
  }
  // sw: event.ports[0].postMessage(result)
  ```
- Avoid/caveats: Close ports that you no longer need. BroadcastChannel echoes to all listeners, but not to the sender object. Keep payloads small or transfer them. A SW can be stopped between messages, so do not rely on a port stored in a SW global (the article's pattern) surviving idle periods.
- Status: MessageChannel Baseline (all engines for many years). `Clients.matchAll()` Baseline since 2018-04. **BroadcastChannel Baseline since 2022-03** (Safari 15.4). The article's "Safari doesn't support it" is out of date (MDN).
- Sources: https://web.dev/articles/two-way-communication-guide, https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel

## Sources read

- https://web.dev/blog/web-animations (Published 2020-05-27)
- https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations (mod 2026-09-22)
- https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timelines (mod 2026-03-29)
- https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timeline_range_names (mod 2026-08-27)
- https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timeline_insets (mod 2026-08-27)
- https://web.dev/articles/animations-overview (updated 2020-10-06)
- https://web.dev/case-studies/instant-navigation-experiences (updated 2020-06-23)
- https://web.dev/articles/imperative-caching-guide (updated 2020-12-08)
- https://web.dev/articles/two-way-communication-guide (updated 2020-12-08)
- https://web.dev/articles/workers-overview (updated 2020-12-08)
- https://developer.chrome.com/docs/devtools/css/animations/ (updated 2024-04-16)
- https://developer.chrome.com/blog/scroll-animation-performance-case-study (2023-07-12)
- https://developer.chrome.com/blog/hardware-accelerated-animations (2021-02-22)
- https://developer.chrome.com/docs/chromium/renderingng-architecture (updated 2021-07-26)
- https://developer.chrome.com/docs/workbox/modules/workbox-expiration
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/prefetch (mod 2026-04-22)
- https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API (mod 2026-09-10)
- MDN Baseline banners: Element/animate, Element/getAnimations, Animation/finished, persist, commitStyles, remove_event, KeyframeEffect/composite, animation-timeline, scroll-timeline, view-timeline, animation-range, timeline-scope, ScrollTimeline, NavigationPreloadManager, BroadcastChannel, SharedArrayBuffer, ExtendableMessageEvent, ServiceWorkerGlobalScope/message_event, SyncManager, BackgroundFetchManager, NetworkInformation, prefers-reduced-motion, will-change, Clients/matchAll
- MDN BCD API (https://bcd.developer.mozilla.org/bcd/api/v0/current/<key>.json) for the version numbers above, InstallEvent.addRoutes, Animation.overallProgress and Scheduler
- npm registry: workbox-window (7.4.1, 2026-05-04), comlink (4.4.2, 2024-11-07)

## Not covered / could not access

- Could not confirm which Chrome version (if any) ships composited `background-color` and `clip-path` animations by default. The 2021 Chrome post only says "soon", and a Chrome Platform Status search did not find the entry.
- Did not read the linked deeper pages: "How to create high-performance animations", "GPU Animation: Doing It Right", "Broadcast updates" (the fourth article in the workers series), the Background Fetch guide, the Resilient search experiences guide, or the Service Worker Static Routing API docs. Other agents cover the CSS rendering and Web API areas.
- The CodePen demos embedded in the web.dev animation article (getAnimations cross-fade, play/pause/reverse) were not run. The notes rely on the article text.
- The Web Animations article's "Group Effect", "Mutable timelines" and Houdini scroll-linked links were not followed. Status is inferred from their absence in MDN BCD.
