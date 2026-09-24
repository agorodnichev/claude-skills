# JavaScript, the event loop, and scheduling (INP and frames)

Scope: how main-thread JavaScript is scheduled (tasks, microtasks, the rendering steps, rAF, observers, timers, idle callbacks, the Prioritized Task Scheduling API), how that drives INP and frame smoothness, and the code patterns that keep input handlers and render loops short (yielding, read/write batching, event handling, lifecycle).
Sources: WHATWG HTML event loop, timers and animation-frame sections; WICG scheduling spec; ResizeObserver and IntersectionObserver specs; web.dev INP guides; developer.chrome.com LoAF, scheduler.yield, timer-throttling and aligned-input articles; MDN; Jake Archibald (blog + "In The Loop" text version); v8.dev; the React scheduler source; the GoogleChrome modern-web-guidance skill; support data from @mdn/browser-compat-data 8.1.2 (2026-09-17) and web-features (Safari 27 released 2026-09-14 is the newest Safari in that data).
Local check: one diagnostic script run in Chromium 152 (Claude desktop browser pane) to measure yield gaps (results cited in the items).

---

## A. The event loop model

### Place each piece of work in the right slot of the frame: task, microtask, or rendering step
- Layer: js
- Stage: main-thread-task, microtask, style, layout, paint
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: high, because every other rule in this file depends on this ordering
- Do: Treat one loop turn as: run one task -> drain all microtasks -> maybe run the rendering steps. Put visual DOM writes in the event handler or in a `requestAnimationFrame` (rAF) callback. Put non-visual follow-up work in a later task.
- Why: The HTML processing model picks one runnable task from an implementation-chosen task queue, runs it, then performs a microtask checkpoint. The "update the rendering" work is now itself queued as a task on the rendering task source when a rendering opportunity exists. Inside it, the order is: resize steps, scroll steps, media queries, Web Animations events, fullscreen, canvas context-lost, rAF callbacks, style + layout with the ResizeObserver loop, focus fix-up, view transitions, IntersectionObserver computation, paint timing, then paint. Documents that are hidden, render-blocked, or have nothing to draw (and no rAF callbacks) skip rendering. Rendering typically happens at display rate (the spec gives 60 Hz, 30 Hz under load, and about 4 Hz or less for hidden pages as examples).
- Example:
  ```js
  // Order of logs: sync, micro, (frame: raf), task
  setTimeout(() => console.log('task'), 0);
  requestAnimationFrame(() => console.log('raf'));
  queueMicrotask(() => console.log('micro'));
  console.log('sync');
  // 'raf' vs 'task' order is not fixed: it depends on when the next rendering opportunity comes.
  ```
- Avoid/caveats: The browser picks which task queue to serve (for example, input first), so do not rely on relative order across task sources. Rendering between two tasks is allowed but never guaranteed.
- Status: Spec model; the "rendering task" formulation is in the current HTML Living Standard (read 2026-09).
- Sources: https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model ; https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/ ; https://www.andreaverlicchi.eu/en/blog/jake-archibald-in-the-loop-jsconf-asia-talk-transposed/

### Know that microtasks run whenever the JS stack empties, not only at the end of a task
- Layer: js
- Stage: microtask
- Metrics: INP
- When: interaction
- Impact: medium, because it explains ordering bugs and "why did my promise chain block the frame"
- Do: Expect promise reactions and MutationObserver callbacks to run between two listeners of a user-dispatched event, and after every rAF callback. Expect them to run only after all listeners when you dispatch synchronously (`el.click()`, `dispatchEvent`).
- Why: The "clean up after running script" step performs a microtask checkpoint when the JS execution context stack becomes empty. With a real click, each listener is a separate callback from browser code, so the stack empties between listeners; with `el.click()`, the caller is still on the stack.
- Example:
  ```js
  btn.addEventListener('click', () => { Promise.resolve().then(() => log('micro-1')); log('L1'); });
  btn.addEventListener('click', () => log('L2'));
  // Real user click: L1, micro-1, L2
  // btn.click() from script: L1, L2, micro-1
  ```
- Avoid/caveats: Tests that call `el.click()` do not reproduce user-click microtask timing.
- Status: Spec behavior; all engines (Jake Archibald's 2015 article lists historical engine bugs, since fixed).
- Sources: https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/ ; https://html.spec.whatwg.org/multipage/webappapis.html

### Keep every task under 50 ms, and much shorter while something animates
- Layer: js
- Stage: main-thread-task
- Metrics: INP, TBT, FPS/smoothness
- When: interaction, animation/render-loop, load
- Impact: high, because a running task delays input handling and the next frame by its full length
- Do: Keep any single task under 50 ms (the long-task threshold). During scroll, drag, or chart animation, keep script per frame to a few milliseconds (web.dev suggests about 3-4 ms in animation; the React scheduler yields every 5 ms).
- Why: Tasks run to completion. The Long Tasks and LoAF APIs both use 50 ms; for a task over 50 ms, the time over 50 ms is the "blocking" part. A 60 Hz frame has about 16.7 ms for script, style, layout and paint together.
- Example: see "Yield on a time budget" below.
- Avoid/caveats: 50 ms is a responsiveness limit, not a smoothness budget. A chart that streams at 60 fps drops frames long before any task is "long".
- Status: Guidance; thresholds from web.dev and the Long Tasks/LoAF definitions.
- Sources: https://web.dev/articles/optimize-long-tasks ; https://web.dev/articles/optimize-javascript-execution ; https://raw.githubusercontent.com/facebook/react/main/packages/scheduler/src/SchedulerFeatureFlags.js

### Do not expect a frame between every small task; get visible progress through rAF
- Layer: js
- Stage: main-thread-task, paint
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, long-lived session
- Impact: medium, because progressive rendering can look frozen even when no task is long
- Do: When chunked work must show progress (for example, loading many chart series), apply each visual step in a rAF callback, or yield with an API that lets rendering in. Do not assume that 20 small `setTimeout` tasks give 20 painted frames.
- Why: Chrome's LoAF documentation explains that, with no pending input, the browser can keep processing queued tasks well past 16.7 ms before it renders, because one combined render is cheaper. Input still gets priority. The spec also allows the browser to skip rendering "for other reasons", such as coalescing timer callbacks.
- Avoid/caveats: Breaking work up still helps INP (low `blockingDuration`), but it does not by itself guarantee smoothness; for smoothness you must reduce total work.
- Status: Browser behavior described for Chrome; the spec permits it everywhere.
- Sources: https://developer.chrome.com/docs/web-platform/long-animation-frames ; https://html.spec.whatwg.org/multipage/webappapis.html

---

## B. Timers

### Never drive visual updates with setTimeout/setInterval; use rAF
- Layer: js
- Stage: main-thread-task, paint
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: high, because timer callbacks land anywhere in the frame, drift, and do work nobody sees
- Do: Schedule every visual update with `requestAnimationFrame`. Use timers only for real time delays.
- Why: Timer tasks are not aligned to frames. In Jake Archibald's demo, a `setTimeout(0)` loop ran 3-4 callbacks per frame, so most of the work was never displayed, and a `setTimeout(1000/60)` loop drifted so that one frame got no update and the next got two.
- Example:
  ```js
  // Before
  setInterval(() => drawChart(latest), 16);
  // After
  function frame(t) { if (dirty) { drawChart(latest); dirty = false; } rafId = requestAnimationFrame(frame); }
  rafId = requestAnimationFrame(frame);
  ```
- Avoid/caveats: For low-rate updates (a blinking cursor, a 1 s clock) combine a timer with rAF (see the background-throttling item).
- Status: rAF is Baseline widely available (2015).
- Sources: https://web.dev/articles/optimize-javascript-execution ; https://www.andreaverlicchi.eu/en/blog/jake-archibald-in-the-loop-jsconf-asia-talk-transposed/ ; https://developer.chrome.com/blog/timer-throttling-in-chrome-88

### Account for the 4 ms nesting clamp when you yield with setTimeout
- Layer: js
- Stage: main-thread-task, idle
- Metrics: INP, FPS/smoothness
- When: interaction, long-lived session
- Impact: medium, because a `setTimeout`-based yield loop wastes about 4-5 ms of idle time per yield after a few iterations
- Do: Do not yield with `setTimeout(0)` after every small item. Yield on a time budget (every ~5-50 ms of work), or use `scheduler.yield()` / a `MessageChannel` task, which have no clamp.
- Why: The HTML timer steps set the timeout to at least 4 ms when the timer nesting level is greater than 5 (MDN: after 5 nested calls). A local test in Chromium 152 showed that `await new Promise(r => setTimeout(r, 0))` in a loop gave ~0 ms gaps for the first 6 iterations and then ~5 ms per iteration, while `scheduler.yield()`, `scheduler.postTask()` and a `MessageChannel` round trip stayed at ~0 ms.
- Example:
  ```js
  // 1000 items, yield per item with setTimeout: ~1000 x 5 ms = ~5 s of pure waiting.
  for (const item of items) { process(item); await new Promise(r => setTimeout(r, 0)); }
  ```
- Avoid/caveats: web.dev says "a minimum 5 millisecond delay"; the spec says 4 ms. The observed ~5 ms is the 4 ms clamp plus overhead. Chrome removed the separate 1 ms minimum for `setTimeout(0)` (Chrome ~101) and for `setInterval` (Chrome 135); per the Chromium intent thread, Safari still applies a 1 ms minimum.
- Status: Spec rule, all browsers. Measurement: local Chromium 152 only (not repeated in Firefox/Safari).
- Sources: https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html ; https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout ; https://web.dev/articles/optimize-long-tasks ; https://chromestatus.com/feature/4889002157015040 ; https://chromestatus.com/feature/5072451480059904

### Do not rely on timers for correctness in background tabs
- Layer: js
- Stage: main-thread-task, idle
- Metrics: memory, long-lived session correctness
- When: long-lived session
- Impact: high for a trading terminal, because countdowns, heartbeats and polls can fire up to a minute late
- Do: Compute elapsed time from timestamps (`performance.now()`, server time) when a timer fires or when the page becomes visible. Keep heartbeats and expiry logic on the server or in the WebSocket protocol, not in client timers.
- Why: Chrome has three levels: minimal (visible or audible in the last 30 s; only the 4 ms clamp), throttled (hidden, checked once per second), and intensive since Chrome 88 (hidden > 5 min, chain count >= 5, silent >= 30 s, no WebRTC: checked once per minute). Firefox desktop uses a 1 s minimum in inactive tabs; Firefox Android uses 15 minutes and may unload the tab. Browsers also apply budget-based throttling and may freeze hidden pages, which suspends timers and fetch callbacks.
- Example:
  ```js
  const deadline = performance.now() + ttlMs;
  function check() { if (performance.now() >= deadline) expire(); else setTimeout(check, 1000); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  ```
- Avoid/caveats: MDN says tabs with WebSocket or WebRTC connections are not throttled, but Chrome's intensive-throttling rules exempt only WebRTC (the Chrome 88 test flag even enables throttling with WebSocket). Do not assume a WebSocket keeps your timers accurate.
- Status: Browser policy (Chrome 88+, Firefox); MDN reference as of 2026-09.
- Sources: https://developer.chrome.com/blog/timer-throttling-in-chrome-88 ; https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout ; https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API ; https://developer.chrome.com/docs/web-platform/page-lifecycle-api

### Replace recurring timers and polling with events, observers, or push
- Layer: js
- Stage: main-thread-task
- Metrics: INP, memory
- When: long-lived session
- Impact: medium, because `setInterval` work lands in front of interactions and becomes input delay
- Do: Use `ResizeObserver`, `IntersectionObserver`, `MutationObserver`, WebSocket/SSE/fetch streams, and media events instead of polling with timers. If a periodic job is required, keep it small and stop it when hidden.
- Why: web.dev names recurring timers as a main source of input delay; LoAF attribution shows them as `invokerType: 'user-callback'` in the input-delay part of INP.
- Avoid/caveats: Third-party scripts often own the intervals; LoAF `sourceURL` finds them.
- Status: Guidance; APIs are Baseline widely available.
- Sources: https://web.dev/articles/optimize-input-delay ; https://developer.chrome.com/blog/timer-throttling-in-chrome-88 ; https://web.dev/articles/find-slow-interactions-in-the-field

### Use a MessageChannel task when you need a zero-delay macrotask without the clamp
- Layer: js
- Stage: main-thread-task
- Metrics: INP
- When: interaction, long-lived session
- Impact: medium, as the fallback yield for Safari, which has no `scheduler.yield()`
- Do: For a fallback yield or a "run in the next task" helper, post a message on a reused `MessageChannel` port. Reuse one channel; queue resolvers in an array.
- Why: A `postMessage` task is not a timer, so the nesting clamp does not apply. React's scheduler prefers `MessageChannel` over `setTimeout` for this exact reason (its source comment names the 4 ms clamp) and yields every 5 ms. The Google `scheduler-polyfill` also uses `MessageChannel` internally.
- Example:
  ```js
  const ch = new MessageChannel(); const waiting = [];
  ch.port1.onmessage = () => waiting.shift()?.();
  export const nextTask = () => new Promise(r => { waiting.push(r); ch.port2.postMessage(0); });
  export const yieldToMain = () => globalThis.scheduler?.yield ? scheduler.yield() : nextTask();
  ```
- Avoid/caveats: The continuation goes to the back of the queue (no prioritized continuation), like `setTimeout`. An open `MessageChannel` keeps a Node.js process alive; React prefers `setImmediate` in Node and jsdom for this reason, so guard it in unit tests.
- Status: Channel messaging is Baseline widely available (2015).
- Sources: https://raw.githubusercontent.com/facebook/react/main/packages/scheduler/src/forks/Scheduler.js ; https://github.com/GoogleChromeLabs/scheduler-polyfill ; https://www.andreaverlicchi.eu/en/blog/jake-archibald-in-the-loop-jsconf-asia-talk-transposed/

---

## C. Microtasks, promises, await

### Never "yield" with a promise or queueMicrotask
- Layer: js
- Stage: microtask, main-thread-task
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: high, because a microtask chain blocks rendering and input exactly like synchronous code
- Do: Use a task-level yield (`scheduler.yield()`, `MessageChannel`, `setTimeout`) to let input and rendering run. Use `await` on already-resolved values only for ordering, never for responsiveness.
- Why: The microtask checkpoint drains the queue, including microtasks added while it drains, before the event loop can continue. Jake's demo shows a `Promise.resolve().then(loop)` loop freezes the tab like `while (true)`. The HTML spec warns that many microtasks have the same cost as synchronous code.
- Example:
  ```js
  // Before: does not yield
  for (const c of chunks) { work(c); await Promise.resolve(); }
  // After: yields to input and rendering
  for (const c of chunks) { work(c); await yieldToMain(); }
  ```
- Avoid/caveats: `await globalThis.scheduler?.yield?.()` becomes a single microtask in Safari; web.dev presents it as a deliberate "progressive enhancement" choice, not a real yield.
- Status: Spec behavior, all browsers.
- Sources: https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#microtask-queuing ; https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide ; https://web.dev/articles/optimize-long-tasks

### Use queueMicrotask only for consistent ordering and same-task batching
- Layer: js
- Stage: microtask
- Metrics: INP
- When: interaction
- Impact: low, as a correctness and batching tool
- Do: Use `queueMicrotask` to make a callback always asynchronous (cache hit vs miss) or to coalesce many calls in one task into one flush (for example, many store updates -> one render request). Prefer it over `Promise.resolve().then()` for this.
- Why: `queueMicrotask` runs after the current script and before any other task, reports exceptions normally, and avoids promise allocation overhead (MDN).
- Example:
  ```js
  let pending = false; const dirtySeries = new Set();
  function markDirty(id) {
    dirtySeries.add(id);
    if (!pending) { pending = true; queueMicrotask(() => { pending = false; scheduleFrame(dirtySeries); }); }
  }
  ```
- Avoid/caveats: If the goal is "before the next render", the spec says rAF is the right tool. Recursive microtasks starve the loop.
- Status: Baseline widely available (low 2020-07-28, high 2023-01-28).
- Sources: https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#microtask-queuing ; https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide

### Keep awaits off per-item hot paths and ship native async/await
- Layer: v8, build
- Stage: microtask, script-run
- Metrics: INP, FPS/smoothness
- When: animation/render-loop, build
- Impact: low to medium, because each await is at least one microtask tick plus a promise
- Do: Process synchronous data synchronously; do not wrap per-tick or per-point functions in `async`. Await once per batch, not once per item. Do not transpile async/await to generators or promise polyfills for modern targets.
- Why: Since V8 7.2 (Chrome 72), `await p` on a native promise takes one microtask tick instead of three and skips a throwaway promise; V8 recommends async functions over hand-written promise chains and native promises over libraries to get these shortcuts. Every async function still allocates a promise.
- Example:
  ```js
  // Before: 10k microtasks per frame
  for (const tick of ticks) await applyTick(tick);
  // After
  for (const tick of ticks) applyTickSync(tick);
  ```
- Avoid/caveats: Do not remove `await` where ordering with I/O matters.
- Status: V8 behavior since Chrome 72; the spec change is merged in ECMAScript.
- Sources: https://v8.dev/blog/fast-async

---

## D. requestAnimationFrame

### Coalesce high-frequency inputs and data into one rAF per frame
- Layer: js
- Stage: main-thread-task, style, layout
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, interaction
- Impact: high, for charts fed by WebSocket ticks, pointermove and wheel
- Do: In message and pointer handlers only store the latest state and set a dirty flag; request at most one rAF; render once from the latest state in that rAF.
- Why: Input can arrive at 100-2000 Hz and ticks faster still, but the display shows 60-144 frames. Jake Archibald recommends batching timer and network work into rAF. Chrome (since 60) already dispatches `pointermove`, `mousemove`, `touchmove`, `wheel` just before rAF, but other browsers differ, and a discrete event (key, click) flushes pending continuous events early (blog data, 2019). A manual rAF throttle adds no extra frame of delay in browsers that already align.
- Example:
  ```js
  let latest = null, queued = false;
  socket.onmessage = e => { latest = mergeTick(latest, e.data); if (!queued) { queued = true; requestAnimationFrame(flush); } };
  function flush() { queued = false; chart.update(latest); }
  ```
- Avoid/caveats: rAF does not run in hidden tabs, so do not put data-model updates (order book state) in rAF; only the drawing. Keep reads and writes separate inside the rAF (see layout thrashing).
- Status: rAF Baseline widely available; rAF-aligned input is Chrome behavior since Chrome 60.
- Sources: https://developer.chrome.com/blog/aligning-input-events ; https://nolanlawson.com/2019/08/11/high-performance-input-handling-on-the-web/ ; https://nolanlawson.com/2019/08/14/browsers-input-events-and-frame-throttling/ ; https://www.andreaverlicchi.eu/en/blog/jake-archibald-in-the-loop-jsconf-asia-talk-transposed/

### Drive animation from the rAF timestamp, never from an assumed 16.7 ms
- Layer: js
- Stage: main-thread-task
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because frame rate varies from 30 to 144+ Hz
- Do: Compute progress from the `timestamp` argument (elapsed time), not from a frame count. Use the same timestamp for all work in the frame.
- Why: All rAF callbacks in one frame get the same timestamp (equal to `document.timeline.currentTime` for windows). Refresh rates vary; Chrome Energy Saver lowers the refresh rate (animations that assume 16.67 ms run half speed); iOS Safari throttles rAF to 30 fps in Low Power Mode and in cross-origin iframes that the user has not interacted with (WebKit bugs 168837 and 170534, via motion.dev).
- Example:
  ```js
  function step(ts) { const p = Math.min((ts - start) / durationMs, 1); applyProgress(p); if (p < 1) requestAnimationFrame(step); }
  ```
- Avoid/caveats: The timestamp has at least 1 ms precision and may be coarsened; do not use it for high-resolution benchmarks.
- Status: Baseline widely available.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame ; https://developer.chrome.com/blog/memory-and-energy-saver-mode ; https://motion.dev/magazine/when-browsers-throttle-requestanimationframe

### Stop rAF loops when nothing changes (render on demand)
- Layer: js
- Stage: main-thread-task, paint, gpu-draw
- Metrics: FPS/smoothness, memory (power)
- When: animation/render-loop, long-lived session
- Impact: medium, because a perpetual loop keeps the rendering pipeline awake every frame
- Do: Request the next frame only while something is dirty or animating. Cancel with `cancelAnimationFrame` on teardown. Store the handle as `null` when idle, not 0.
- Why: The spec's "Unnecessary rendering" step skips a document only when nothing visible changed AND its rAF callback map is empty; a pending rAF forces the rendering steps to run. Chrome's Energy Saver article notes that constant rAF polling defeats energy saving.
- Example:
  ```js
  function invalidate() { if (rafId === null) rafId = requestAnimationFrame(render); }
  function render(ts) { rafId = null; draw(ts); if (isAnimating()) invalidate(); }
  ```
- Avoid/caveats: Callbacks requested inside a rAF callback run in the next frame, not the current one (the spec snapshots the callback list). Request IDs may overflow and are not guaranteed never to be 0 (MDN).
- Status: Baseline widely available.
- Sources: https://html.spec.whatwg.org/multipage/webappapis.html ; https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames ; https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame

### Keep rAF callbacks to visual work only
- Layer: js
- Stage: main-thread-task, style, layout
- Metrics: INP (presentation delay), FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium to high, because rAF time is part of every interaction's presentation delay
- Do: Do only DOM/style writes and draw calls in rAF. Move parsing, aggregation, analytics and storage to a task or a worker.
- Why: rAF callbacks run after event handlers and just before style/layout, so their time adds directly to the INP presentation delay; web.dev shows LoAF `styleAndLayoutStart - renderStart` isolating that cost.
- Avoid/caveats: JS-driven animations queue many rAF callbacks that can overlap with interactions; web.dev suggests CSS/composited animations where possible.
- Status: Guidance.
- Sources: https://web.dev/articles/find-slow-interactions-in-the-field ; https://web.dev/articles/optimize-input-delay

### To run code after the next paint, use rAF then a task, not a double rAF
- Layer: js
- Stage: main-thread-task, paint
- Metrics: INP
- When: interaction
- Impact: medium, because it removes non-critical work from the frame that shows feedback
- Do: For "after the frame is presented" work, queue a task from inside rAF (`requestAnimationFrame(() => setTimeout(fn, 0))`, or `scheduler.postTask` / `MessageChannel`).
- Why: web.dev uses this rAF + `setTimeout` pattern in `input` handlers: the task is queued at frame start and so runs after that frame's rendering. A nested rAF waits for the whole next frame (about 16 ms later) and runs before the next paint, not right after the current one.
- Example:
  ```js
  input.addEventListener('input', e => {
    renderQuery(e.target.value);                 // visible now
    requestAnimationFrame(() => setTimeout(() => { persistDraft(); updateSuggestions(); }, 0));
  });
  ```
- Avoid/caveats: `requestPostAnimationFrame` was proposed for this but is not shipped (not in browser-compat-data 8.1.2).
- Status: Works in all browsers.
- Sources: https://web.dev/articles/optimize-inp ; https://nolanlawson.com/2019/08/11/high-performance-input-handling-on-the-web/

### Prefer CSS or Web Animations for declarative motion
- Layer: css, js
- Stage: composite
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: medium, because composited animations need no main-thread rAF work
- Do: Use CSS transitions/animations or `element.animate()` on `transform`/`opacity` for UI motion (panels, tooltips, highlights). Keep rAF for data-driven drawing (canvas/WebGL).
- Why: web.dev (input delay) warns that JS animations fire many rAF calls that compete with interactions; Chrome's timer-throttling article notes the browser can composite CSS/WAAPI animations automatically.
- Avoid/caveats: Non-composited properties (width, top) still run layout every frame.
- Status: Baseline widely available.
- Sources: https://web.dev/articles/optimize-input-delay ; https://developer.chrome.com/blog/timer-throttling-in-chrome-88

---

## E. Observers inside the frame

### Read element sizes from ResizeObserver/IntersectionObserver instead of forcing layout
- Layer: js
- Stage: layout
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, long-lived session
- Impact: medium, because it removes forced layouts and polling
- Do: Size canvases and chart panes from `ResizeObserver` entries (`contentBoxSize`, `devicePixelContentBoxSize` where available). Get visibility and `boundingClientRect` from `IntersectionObserver` entries instead of calling `getBoundingClientRect()` in a loop or on scroll.
- Why: ResizeObserver callbacks run inside the rendering step right after layout, with sizes that are already computed. IntersectionObserver geometry is computed in the rendering step, and its callbacks are delivered in a separate task on the IntersectionObserver task source (so they arrive after that frame, not inside it).
- Example:
  ```js
  new ResizeObserver(([e]) => {
    const s = e.devicePixelContentBoxSize?.[0];
    const w = s ? s.inlineSize : Math.round(e.contentBoxSize[0].inlineSize * devicePixelRatio);
    const h = s ? s.blockSize : Math.round(e.contentBoxSize[0].blockSize * devicePixelRatio);
    resizeBackingStore(w, h);
  }).observe(chartHost);
  ```
- Avoid/caveats: `devicePixelContentBoxSize` is not in Safari (fallback shown). IO callbacks are not synchronous with paint; do not use them for per-frame positioning.
- Status: ResizeObserver and IntersectionObserver Baseline widely available; `contentBoxSize` Chrome 84, Firefox 92, Safari 15.4; `devicePixelContentBoxSize` Chrome 84, Firefox 93 (full 108), no Safari (BCD 8.1.2).
- Sources: https://html.spec.whatwg.org/multipage/webappapis.html ; https://w3c.github.io/IntersectionObserver/ ; https://drafts.csswg.org/resize-observer/ ; https://developer.chrome.com/blog/timer-throttling-in-chrome-88

### Do not change observed sizes inside a ResizeObserver callback without a guard
- Layer: js
- Stage: layout
- Metrics: FPS/smoothness, CLS
- When: animation/render-loop
- Impact: medium, because each size change inside the callback runs style and layout again in the same frame
- Do: In the callback, write only to elements deeper than the observed target, or compare against an expected size and skip no-op writes. If you must resize a shallower element, defer it to the next rAF.
- Why: The rendering step loops: layout -> gather observations deeper than the last depth -> callbacks -> layout again. Observations that are not deeper are skipped and an error "ResizeObserver loop completed with undelivered notifications." fires; the layout settles over several frames (visible flicker).
- Avoid/caveats: The error is a symptom; hiding it with an `error` listener does not remove the extra layouts.
- Status: Baseline widely available.
- Sources: https://drafts.csswg.org/resize-observer/ ; https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver

---

## F. Idle and prioritized scheduling

### Break up long tasks with scheduler.yield(), with a fallback
- Layer: js
- Stage: main-thread-task
- Metrics: INP, TBT
- When: interaction, load, long-lived session
- Impact: high, the main lever for processing duration and input delay
- Do: Insert `await scheduler.yield()` between chunks of long work. Feature-detect both `scheduler` and `yield`; fall back to a task-level yield (MessageChannel or `setTimeout`).
- Why: `scheduler.yield()` returns a promise resolved in a new task. Its continuation goes into a boosted queue: ahead of other tasks of the same priority (including third-party `setTimeout` tasks), behind higher-priority tasks. `setTimeout` or `postTask` continuations go to the back of the queue, so other queued tasks can delay the rest of your work.
- Example:
  ```js
  function yieldToMain() {
    if (globalThis.scheduler?.yield) return scheduler.yield();
    return new Promise(r => setTimeout(r, 0)); // or the MessageChannel nextTask()
  }
  ```
- Avoid/caveats: `yield()` takes no arguments (options were removed from the spec). It only schedules; the `await` pauses. `Array.prototype.forEach` does not await async callbacks. The `scheduler-polyfill` does not support priority or signal inheritance for `yield()`.
- Status: Chrome/Edge 129, Firefox 142; not in Safari (including Safari 27); not Baseline. WebKit standards position issue #361 is open with no position label.
- Sources: https://developer.chrome.com/blog/use-scheduler-yield ; https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield ; https://wicg.github.io/scheduling-apis/ ; https://web.dev/articles/optimize-long-tasks ; https://github.com/WebKit/standards-positions/issues/361

### Yield on a time budget, not after every item
- Layer: js
- Stage: main-thread-task
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium, because yielding has overhead and clamp costs
- Do: Keep a deadline; yield only when `performance.now()` passes it. Use about 50 ms for background batch work that runs when nothing animates, and about 4-8 ms while the user scrolls, drags, or a chart animates. Offload work that needs more than about 250 ms total to a worker.
- Why: web.dev says each yield has overhead and suggests batching with a ~50 ms deadline; Chrome's modern-web-guidance skill gives the heuristic "< 50 ms run synchronously, 50-250 ms slice and yield, > 250 ms use a Web Worker"; React yields every 5 ms to protect frames.
- Example:
  ```js
  async function runBatches(items, budgetMs = 8) {
    let deadline = performance.now() + budgetMs;
    for (const it of items) {
      handle(it);
      if (performance.now() >= deadline) { await yieldToMain(); deadline = performance.now() + budgetMs; }
    }
  }
  ```
- Avoid/caveats: The 50-250 ms and 250 ms numbers are heuristics from a Google guidance repo, not a spec.
- Status: Guidance.
- Sources: https://web.dev/articles/optimize-long-tasks ; https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/break-up-long-tasks.md ; https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/performance.md ; https://web.dev/articles/optimize-javascript-execution

### In input handlers, apply the visible feedback first, then yield; call preventDefault before any await
- Layer: js
- Stage: main-thread-task
- Metrics: INP
- When: interaction
- Impact: high, because INP stops at the next paint, not at the end of all work
- Do: In a click/key/change handler, do only the UI update for the next frame (state toggle, spinner, optimistic value), then `await yieldToMain()`, then the rest. Call `event.preventDefault()` and `stopPropagation()` synchronously, before the first `await`.
- Why: INP measures from input to the next presented frame; web.dev says only work needed for that frame should run before it. Event dispatch is synchronous: code after an `await` runs after dispatch has finished, so `preventDefault()` there is a no-op (GitHub's `async-preventdefault` ESLint rule documents this).
- Example:
  ```js
  orderForm.addEventListener('submit', async e => {
    e.preventDefault();               // must be synchronous
    setSubmitting(true);              // next-frame feedback
    await yieldToMain();              // let the frame paint
    const payload = buildOrder(new FormData(orderForm));
    await sendOrder(payload);
  });
  ```
- Avoid/caveats: Do not yield between two updates that must appear in the same frame. Network waits do not count in INP but the user still needs a pending indicator.
- Status: Pattern; `scheduler.yield()` status as above.
- Sources: https://web.dev/articles/optimize-inp ; https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield ; https://github.com/github/eslint-plugin-github/blob/main/docs/rules/async-preventdefault.md ; https://web.dev/articles/inp

### Use scheduler.postTask priorities, TaskController, and abort signals for ordered background work
- Layer: js
- Stage: main-thread-task, idle
- Metrics: INP, LCP (startup contention)
- When: load, long-lived session
- Impact: medium, because it keeps low-value work (analytics, prefetch, cache warm-up) out of the way of interactions
- Do: Post non-urgent work with `priority: 'background'`, visible-but-not-blocking work with the default `'user-visible'`, and urgent chunked input work with `'user-blocking'`. Use a `TaskController` when priority must change later (for example, prefetch that becomes visible) and `abort()` it when the panel closes. Use `delay` instead of `setTimeout` inside the scheduler.
- Why: Tasks posted through a `Scheduler` run in strict priority order; continuations have a higher effective priority than tasks of the same priority (spec table: background 0/1, user-visible 2/3, user-blocking 4/5). The spec notes `user-blocking` tasks are "not necessarily render-blocking". `yield()` inside a `postTask` callback inherits its priority and abort signal.
- Example:
  ```js
  const warm = new TaskController({ priority: 'background' });
  scheduler.postTask(() => precomputeIndicators(symbol), { signal: warm.signal });
  panel.onopen = () => warm.setPriority('user-visible');
  panel.onclose = () => warm.abort();
  ```
- Avoid/caveats: `options.priority` makes the priority immutable (a signal's priority is then ignored). A flood of `background` tasks can wait a long time under load. In Safari use the `scheduler-polyfill` or a manual queue; the polyfill cannot give `user-blocking` a real event-loop boost.
- Status: `postTask`, `TaskController`, `TaskSignal`: Chrome/Edge 94, Firefox 142; `TaskSignal.any()`: Chrome 116, Firefox 142; no Safari; not Baseline.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Prioritized_Task_Scheduling_API ; https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/postTask ; https://developer.mozilla.org/en-US/docs/Web/API/TaskController ; https://wicg.github.io/scheduling-apis/ ; https://github.com/GoogleChromeLabs/scheduler-polyfill

### Use requestIdleCallback only for deferrable work, always with a timeout and a Safari fallback
- Layer: js
- Stage: idle
- Metrics: INP, memory
- When: long-lived session, load
- Impact: low to medium
- Do: Put optional work (cache pruning, precomputation, logging) in `requestIdleCallback`, check `deadline.timeRemaining()` per unit of work, and pass `{ timeout }` for work that must eventually run. Do not change the DOM there; schedule DOM changes with rAF.
- Why: The spec computes the idle deadline as at most 50 ms after the idle period starts, cut short by the next expected render and by pending timers. Callbacks can wait seconds without a timeout (MDN). By the time an idle callback runs, the frame is done, so DOM writes cause extra style/layout.
- Example:
  ```js
  const idle = globalThis.requestIdleCallback
    ? (fn) => requestIdleCallback(fn, { timeout: 2000 })
    : (fn) => setTimeout(() => fn({ didTimeout: true, timeRemaining: () => 5 }), 50);
  idle(function prune(dl) { while (dl.timeRemaining() > 1 && cache.size > max) evictOne(); if (cache.size > max) idle(prune); });
  ```
- Avoid/caveats: A timeout forces the callback to run even when busy. MDN advises not to resolve promises in idle callbacks (their reactions run right after). Not available in workers. `postTask({priority:'background'})` is the closer modern equivalent where supported.
- Status: Chrome 47, Edge 79, Firefox 55; Safari only behind a feature flag (BCD: "preview", flag `requestIdleCallback`); an Interop 2027 focus-area proposal was opened 2026-09-15 saying WebKit disabled it due to regressions. Not Baseline.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback ; https://developer.mozilla.org/en-US/docs/Web/API/Background_Tasks_API ; https://html.spec.whatwg.org/multipage/webappapis.html ; https://github.com/web-platform-tests/interop/issues/1398

### Do not use navigator.scheduling.isInputPending()
- Layer: js
- Stage: main-thread-task
- Metrics: INP
- When: interaction, load
- Impact: low (avoid a dead end)
- Do: Yield on a time budget regardless of pending input; remove existing `isInputPending()` checks when you touch that code.
- Why: web.dev no longer recommends it: it can return false even after input, input is not the only reason to yield (rendering and animations also need the thread), and `scheduler.yield()`/`postTask()` replace it. MDN marks it deprecated.
- Status: Chrome/Edge 87 only; experimental; MDN: deprecated.
- Sources: https://web.dev/articles/optimize-long-tasks ; https://developer.mozilla.org/en-US/docs/Web/API/Scheduling/isInputPending ; https://developer.chrome.com/docs/capabilities/web-apis/isinputpending

### Pick the scheduling primitive by what must happen before it
- Layer: js
- Stage: main-thread-task, microtask, idle
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium, because the wrong primitive either blocks rendering or loses ordering
- Do: Choose from this table.

  | Need | Use | Runs | Notes |
  |---|---|---|---|
  | Finish before any other task, same logical step | `queueMicrotask` / `await` | Same task, after stack empties | Does not yield |
  | Visual update for the next frame | `requestAnimationFrame` | Rendering step, before style/layout | Paused when hidden |
  | Continue my long job, but let input/paint in first | `scheduler.yield()` | New task, front of its priority level | Chrome 129, Firefox 142, not Safari |
  | Independent follow-up task with a priority | `scheduler.postTask()` | New task, back of its priority level | Abort/priority via signals |
  | Next task, no clamp, any browser | `MessageChannel` post | New task, back of queue | Fallback yield |
  | Real delay, or last-resort yield | `setTimeout(fn, ms)` | Timer task, back of queue | 4 ms clamp when nested > 5; throttled when hidden |
  | Only when idle | `requestIdleCallback` / `postTask('background')` | Idle period / lowest priority | rIC not in Safari |
- Why: Chrome's scheduler.yield article: `setTimeout` and `postTask` continuations "typically run after any already-queued new tasks"; `yield()` continuations run before other tasks of the same priority. MDN's example shows a `user-blocking` postTask runs before a `user-visible` yield continuation, which runs before a `user-visible` postTask.
- Status: See per-API items.
- Sources: https://developer.chrome.com/blog/use-scheduler-yield ; https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield ; https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html

---

## G. Measuring long tasks and INP

### Observe long-animation-frame entries in the field, not only longtask
- Layer: tooling, js
- Stage: main-thread-task, style, layout
- Metrics: INP, FPS/smoothness
- When: long-lived session, testing
- Impact: high for diagnosis, because it names the script and the frame phase
- Do: Register `new PerformanceObserver(cb).observe({ type: 'long-animation-frame', buffered: true })` behind `PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')`. Keep only a few entries (for example, the worst 10 by `blockingDuration`, or those with `firstUIEventTimestamp > 0`) and send them on `visibilitychange` to hidden. Add `crossorigin="anonymous"` to third-party scripts to get full attribution.
- Why: A LoAF is a rendering update delayed beyond 50 ms, measured across all tasks in the frame. Entries give `renderStart`, `styleAndLayoutStart`, `blockingDuration` (sum over 50 ms per long task, including the final render), `firstUIEventTimestamp`, and `scripts[]` (for scripts > 5 ms) with `invoker`, `invokerType`, `sourceURL`, `sourceFunctionName`, `sourceCharPosition`, `forcedStyleAndLayoutDuration`, and `pauseDuration`. The Long Tasks API shows only duration and container. The entry buffer holds 200 entries, so use an observer. You can mirror entries into DevTools with `performance.measure()` and `detail.devtools` track options.
- Example:
  ```js
  if (PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) {
    const worst = [];
    new PerformanceObserver(l => {
      worst.push(...l.getEntries()); worst.sort((a, b) => b.blockingDuration - a.blockingDuration); worst.length = Math.min(worst.length, 10);
    }).observe({ type: 'long-animation-frame', buffered: true });
  }
  ```
- Avoid/caveats: No script attribution for cross-origin iframes, workers, or extensions. The reported source is the entry point (the handler), not the slow inner function. Frames with low `blockingDuration` but long `duration` hurt smoothness, not INP; fix those by reducing work, not by splitting it.
- Status: LoAF Chrome/Edge 123 only (experimental); `paintTime`/`presentationTime` added in Chrome 145. Long Tasks API: Chrome 58 only; no deprecation planned.
- Sources: https://developer.chrome.com/docs/web-platform/long-animation-frames ; https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming

### Diagnose INP by subpart before you optimize
- Layer: tooling, js
- Stage: main-thread-task, style, layout, paint
- Metrics: INP
- When: testing, long-lived session
- Impact: high, because each subpart has a different fix
- Do: Record INP with `web-vitals/attribution` and store `inputDelay`, `processingDuration`, `presentationDelay`, `interactionTarget`, and the longest script. Fix input delay by removing competing tasks (script evaluation, timers, earlier handlers); processing by shortening and yielding in handlers; presentation delay by reducing rAF work, style/layout cost, and DOM size.
- Why: INP is the worst click/tap/key interaction latency (ignoring 1 per 50 interactions), judged at p75: good <= 200 ms, poor > 500 ms. Latency = input delay + processing (all handlers in the frame) + presentation delay. Scroll, hover, and zoom are not measured. Event Timing entries under 104 ms are not reported by default; `durationThreshold` goes down to 16 ms. Report on `visibilitychange` and reset on bfcache restore.
- Example:
  ```js
  import { onINP } from 'web-vitals/attribution';
  onINP(({ value, attribution: a }) => beacon({ value, inputDelay: a.inputDelay, processing: a.processingDuration, presentation: a.presentationDelay, target: a.interactionTarget }));
  ```
- Avoid/caveats: Lab tools rarely see the real interaction; TBT is only a proxy. Interactions in iframes count toward the page's INP but are not visible to the parent's API.
- Status: Event Timing is Baseline newly available since 2025-12-12 (Chrome 76, Firefox 89, Safari 26.2); `interactionId` Chrome 96, Firefox 144, Safari 26.2. So INP is measurable in field RUM in all three engines from late 2025.
- Sources: https://web.dev/articles/inp ; https://web.dev/articles/optimize-inp ; https://web.dev/articles/find-slow-interactions-in-the-field ; https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/identify-inp-causes.md

---

## H. Layout thrashing and DOM work

### Batch DOM reads first, then writes; never alternate them in a loop
- Layer: js
- Stage: style, layout
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: high, because each read after a write forces a full style + layout pass
- Do: Read all geometry at the start (start of rAF, or before any write in a handler), cache it, then do all writes. In loops, hoist reads out of the loop.
- Why: Before any write in a frame, layout values from the last frame are still valid and cheap to read. After a write, a read forces synchronous style recalc and layout ("forced synchronous layout"); doing it repeatedly is layout thrashing. LoAF exposes it as `forcedStyleAndLayoutDuration`; DevTools has a "Forced reflow" insight.
- Example:
  ```js
  // Before: layout per row
  rows.forEach(r => { r.style.width = header.offsetWidth + 'px'; });
  // After: one read, many writes
  const w = header.offsetWidth; rows.forEach(r => { r.style.width = w + 'px'; });
  ```
- Avoid/caveats: A read is free only if nothing is invalidated; a class change, a node insert, even `:focus` invalidates.
- Status: Applies to all engines.
- Sources: https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing ; https://gist.github.com/paulirish/5d52fb081b3570c81e3a

### Know the APIs that force style or layout
- Layer: js
- Stage: style, layout
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium to high, because many of these hide inside libraries and event handlers
- Do: Treat these as reads and keep them before writes, or replace them with observer data: `offsetLeft/Top/Width/Height/Parent`; `clientLeft/Top/Width/Height`; `getClientRects()`, `getBoundingClientRect()`; `scrollWidth/Height`, reading or setting `scrollLeft/Top`, `scrollBy/To()`, `scrollIntoView()`; `focus()` (element and input), `select()`; `innerText` (use `textContent`); `computedRole/computedName`; `window.scrollX/Y`, `innerWidth/innerHeight`, `visualViewport` sizes and offsets; `document.elementFromPoint()`; `document.scrollingElement` (style only); `MouseEvent.offsetX/Y`, `layerX/Y`; `getComputedStyle()` (always style, often layout: width/height, insets, margins, padding, transform, grid templates, or when viewport media queries exist); `Range.getClientRects()/getBoundingClientRect()`; SVG `getBBox()`, `getComputedTextLength()` and other text metrics; many `contenteditable` operations.
- Why: Each returns layout-dependent data synchronously, so the engine must bring style and layout up to date first. The list comes from Blink source; WebKit and Gecko are mostly consistent.
- Example:
  ```js
  // In a pointer handler, prefer clientX/Y minus a cached rect over offsetX/Y (which forces layout).
  const x = e.clientX - cachedPaneRect.left;
  ```
- Avoid/caveats: The list is from 2020 (Paul Irish) and not exhaustive; verify in a trace.
- Status: Engine behavior; list last updated April 2020.
- Sources: https://gist.github.com/paulirish/5d52fb081b3570c81e3a ; https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/innerText

### Do not write styles in continuous input handlers and then read layout in rAF
- Layer: js
- Stage: style, layout
- Metrics: FPS/smoothness, INP
- When: interaction
- Impact: medium
- Do: In `scroll`, `pointermove`, `touchmove`, `wheel` handlers, only record values (for example `lastY = scrollY`) and request one rAF; do reads then writes inside that rAF.
- Why: These handlers run just before rAF callbacks. A style write in the handler leaves styles dirty, so the first geometry read in rAF forces a synchronous layout.
- Example:
  ```js
  let y = 0, queued = false;
  addEventListener('scroll', () => { y = scrollY; if (!queued) { queued = true; requestAnimationFrame(apply); } }, { passive: true });
  function apply() { queued = false; const h = header.offsetHeight; header.classList.toggle('compact', y > h); }
  ```
- Status: All browsers.
- Sources: https://web.dev/articles/debounce-your-input-handlers

### Keep the DOM small; virtualize long lists and build large DOM in chunks
- Layer: html, js
- Stage: style, layout, paint
- Metrics: INP, FPS/smoothness, memory
- When: interaction, long-lived session
- Impact: high for order books, trade logs, and symbol lists
- Do: Render only visible rows (windowing) for long tables; keep nesting shallow (use framework fragments); add hidden UI on demand. When you must insert many nodes, insert them in chunks across frames or tasks, and isolate regions with `contain`/`content-visibility` (CSS topic).
- Why: Style and layout cost grows with the number of affected elements, and layout is usually document-scoped. Client-side HTML creation is not chunked by the browser the way streamed server HTML is, so one big `innerHTML` or render becomes one long task. Large `querySelectorAll` results also hold memory. Lighthouse historically warned at 800 nodes and flagged over 1,400.
- Avoid/caveats: DOM-count thresholds are heuristics; measure "Recalculate Style" element counts in DevTools.
- Status: Guidance.
- Sources: https://web.dev/articles/dom-size-and-interactivity ; https://web.dev/articles/client-side-rendering-of-html-and-interactivity ; https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing

### Batch DOM writes by avoiding interleaved reads, not by relying on DocumentFragment
- Layer: js
- Stage: style, layout
- Metrics: INP
- When: interaction
- Impact: low (a myth correction)
- Do: Append many nodes with one `append(...nodes)` or `replaceChildren(...)` call when convenient, but spend effort on avoiding forced layouts and on reducing node count.
- Why: Rendering does not happen in the middle of a task, so ten writes in one task cost one style/layout pass at frame time (Jake Archibald: toggling `display` many times in a handler costs the same as setting the final value). MDN states the speed benefit of `DocumentFragment` is often overstated and can even be slower in some engines.
- Status: All browsers.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/DocumentFragment ; https://www.andreaverlicchi.eu/en/blog/jake-archibald-in-the-loop-jsconf-asia-talk-transposed/

---

## I. Events and input

### Use event delegation for large or frequently re-rendered collections
- Layer: js
- Stage: script-run, gc-memory
- Metrics: memory, startup, INP
- When: load, long-lived session
- Impact: low to medium
- Do: Attach one listener on the container (order book, watchlist) and resolve the row with `event.target.closest('[data-row]')`. Exit early for irrelevant targets.
- Why: Bubbling lets one parent listener handle events from any number of children, including rows added later, so re-renders do not add and remove thousands of listeners (MDN documents the pattern; the cost argument is our inference, not a measured claim in the source).
- Example:
  ```js
  book.addEventListener('click', e => { const row = e.target.closest('tr[data-price]'); if (row) selectPrice(row.dataset.price); });
  ```
- Avoid/caveats: Some events do not bubble (`focus`, `mouseenter`, `contentvisibilityautostatechange` in some engines); use `focusin` or a capture listener. A delegated handler runs for every event in the subtree, so keep it cheap. Use `{ signal }` from an `AbortController` to remove listeners in one call on teardown.
- Status: Bubbling and `closest()` Baseline widely available; `signal` option Baseline widely available (2021-09-20 low).
- Sources: https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Event_bubbling ; https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener

### Mark scroll-blocking listeners passive; use touch-action when you need to block gestures
- Layer: js, css
- Stage: main-thread-task, composite
- Metrics: FPS/smoothness
- When: interaction
- Impact: medium to high for touch and wheel scrolling
- Do: Add `{ passive: true }` to `touchstart`, `touchmove`, `wheel` listeners that do not cancel scrolling. For chart zoom that must cancel the wheel, set `{ passive: false }` explicitly and keep that handler tiny. For touch panning inside a chart, prefer CSS `touch-action: none` (or `pan-y`) on the chart element over `preventDefault()` in touch handlers.
- Why: A non-passive listener makes the compositor wait for the main thread before it scrolls, because the handler might call `preventDefault()`. Browsers default `passive` to true for `touchstart`/`touchmove` (and, outside Safari, `wheel`/`mousewheel`) on window, document and body, so explicit `false` is required when you really cancel.
- Example:
  ```js
  chartEl.addEventListener('wheel', e => { e.preventDefault(); zoomQueue.push(e.deltaY); requestZoomFrame(); }, { passive: false });
  document.addEventListener('touchmove', trackGesture, { passive: true });
  ```
- Avoid/caveats: `preventDefault()` in a passive listener is ignored (with a console warning). The basic `scroll` event cannot be cancelled, so `passive` does not matter for it. MDN prose says Safari does not default touch to passive, but BCD 8.1.2 lists default-passive touch in Safari 11.1+ and default-passive wheel only in Chrome 73+/Firefox 84+; set the option explicitly either way.
- Status: `passive` option Baseline widely available (2017-10-17 low).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener ; https://web.dev/articles/debounce-your-input-handlers

### Use getCoalescedEvents for precise drawing and getPredictedEvents to cut perceived latency
- Layer: js
- Stage: main-thread-task
- Metrics: FPS/smoothness, INP
- When: interaction
- Impact: medium for drawing tools and crosshair drags on charts
- Do: In `pointermove`, iterate `e.getCoalescedEvents()` to add every sampled point to a drawing path; fall back to `[e]` when the method is missing or the array is empty. Optionally draw a provisional segment to `e.getPredictedEvents()` and discard it on the next event. Update the canvas once per frame.
- Why: Browsers merge high-rate pointer samples into one `pointermove` (Chrome aligns continuous events to rAF since Chrome 60), which lowers work but loses path detail; coalesced events recover it without extra dispatch. Coalesced events are not hit-tested: `currentTarget`, `eventPhase` are default and `preventDefault()` on them does nothing.
- Example:
  ```js
  pane.addEventListener('pointermove', e => {
    const list = e.getCoalescedEvents?.() ?? [];
    for (const p of (list.length ? list : [e])) path.push(toChartCoords(p.clientX, p.clientY));
    predicted = e.getPredictedEvents?.().at(-1) ?? null;
    invalidate();
  });
  ```
- Avoid/caveats: Secure-context only in some browsers. Use `setPointerCapture` during drags. `pointerrawupdate` gives unaligned events with lower latency but more handler calls; it is not in Safari.
- Status: `getCoalescedEvents`: Chrome 58, Firefox 59, Safari 18.2; Firefox Android returns an empty array (partial), so not Baseline. `getPredictedEvents`: Baseline newly available 2024-12-11. `pointerrawupdate`: Chrome 77, Firefox 148, no Safari.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents ; https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getPredictedEvents ; https://developer.chrome.com/blog/aligning-input-events

### Throttle visual reactions to rAF; debounce and abort only non-visual expensive work; use scrollend
- Layer: js
- Stage: main-thread-task
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: medium
- Do: For visual updates from continuous input, keep the latest value and render once per rAF (no fixed-ms throttle). For expensive non-visual work on typing (symbol search, server validation), debounce with a time window and cancel stale requests with `AbortController`. For "scroll finished" work, listen to `scrollend` instead of a `setTimeout` debounce.
- Why: A fixed-interval throttle (for example 20 ms) is either faster or slower than the display; rAF matches it. Debounced scroll handlers can fire while the user is still scrolling; `scrollend` fires after the scroll and any snap have settled.
- Example:
  ```js
  let ctrl;
  const search = debounce(async q => { ctrl?.abort(); ctrl = new AbortController(); show(await fetchSymbols(q, { signal: ctrl.signal })); }, 150);
  list.addEventListener('scrollend', loadVisibleRowsDetails);
  ```
- Avoid/caveats: Debounce delays feedback, so show typed text immediately and debounce only the expensive part. `scrollend` needs a fallback before Safari 26.2.
- Status: `scrollend` Baseline newly available since 2025-12-12 (Chrome 114, Firefox 109, Safari 26.2).
- Sources: https://nolanlawson.com/2019/08/11/high-performance-input-handling-on-the-web/ ; https://web.dev/articles/optimize-input-delay ; https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/defer-work-until-scroll-ends.md

### Reduce interaction overlap: cancel superseded work
- Layer: js
- Stage: main-thread-task
- Metrics: INP
- When: interaction
- Impact: medium, because work from the previous keypress becomes input delay for the next one
- Do: When a new interaction supersedes the old one (typing, rapid timeframe switches), abort in-flight fetches and chunked jobs with an `AbortSignal` (pass it to `postTask`, check it between yields).
- Why: web.dev describes "interaction overlap": rendering and callbacks from one interaction delay the next; aborting stops fetch callbacks from congesting the main thread.
- Example:
  ```js
  let job;
  function onTimeframe(tf) { job?.abort(); job = new AbortController(); rebuildSeries(tf, job.signal); }
  async function rebuildSeries(tf, signal) { for (const c of chunksFor(tf)) { if (signal.aborted) return; build(c); await yieldToMain(); } }
  ```
- Status: `AbortController` Baseline widely available.
- Sources: https://web.dev/articles/optimize-input-delay

### Keep input handlers minimal: move logging, persistence, and analytics off the critical path
- Layer: js
- Stage: main-thread-task, idle
- Metrics: INP
- When: interaction
- Impact: medium
- Do: In handlers, do only the state change and the UI update. Send analytics, save drafts, and update secondary widgets (counters, spell checks) after the frame: `postTask(..., {priority:'background'})`, rAF + task, or idle callbacks. Never use synchronous XHR, `alert()`, or `confirm()` in handlers.
- Why: All handlers of one interaction count as processing duration. LoAF reports `pauseDuration` for synchronous pausing operations like `alert` and sync XHR.
- Status: Guidance.
- Sources: https://web.dev/articles/optimize-inp ; https://developer.chrome.com/docs/web-platform/long-animation-frames

---

## J. Visibility and lifecycle

### On visibilitychange to hidden, stop rendering work and flush state; on visible, render once from the latest state
- Layer: js
- Stage: main-thread-task, gpu-draw, idle
- Metrics: memory, FPS/smoothness (on return), long-lived session correctness
- When: long-lived session
- Impact: medium to high for dashboards and chart terminals that stay open for hours
- Do: On hidden: stop redraw schedulers and polling, persist state, send analytics (`sendBeacon`). Keep updating the data model from the socket only if you need it; do not draw. On visible: redraw once from the latest model, then resume the loop. Use `visibilitychange` and `pagehide`, never `unload`.
- Why: Hidden documents are skipped by the rendering steps and rAF is paused in background tabs and hidden iframes, but timers, sockets and promise callbacks can still run (throttled), and pages may be frozen (timers and fetch callbacks suspended) or discarded without further events. The transition to hidden is the last reliably observable event, especially on mobile.
- Example:
  ```js
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { renderer.pause(); saveLayout(); navigator.sendBeacon('/rum', rumBatch()); }
    else { renderer.drawNow(model); renderer.resume(); }
  });
  ```
- Avoid/caveats: `document.visibilityState` at script run time can miss an initial hidden period; `performance.getEntriesByType('visibility-state')` is exact but Chrome-only (115+). `freeze`/`resume` events exist only in Chromium (68+). Hiding an iframe with CSS does not change its visibility state.
- Status: Page Visibility Baseline widely available; `visibilitychange` Baseline widely available (MDN: since April 2021).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event ; https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API ; https://developer.chrome.com/docs/web-platform/page-lifecycle-api ; https://html.spec.whatwg.org/multipage/webappapis.html

### Pause off-screen heavy renderers
- Layer: js, css
- Stage: main-thread-task, gpu-draw
- Metrics: FPS/smoothness, memory
- When: long-lived session
- Impact: medium for multi-chart layouts
- Do: Stop the render loop of a chart pane when it is off-screen: listen to `contentvisibilityautostatechange` on a `content-visibility: auto` container (check `event.skipped`), or use `IntersectionObserver` with a `rootMargin` as a fallback.
- Why: The event is tied to the browser's own decision to skip or resume rendering the subtree, including a pre-render margin, so work resumes just before the pane is shown.
- Example:
  ```js
  pane.addEventListener('contentvisibilityautostatechange', e => e.skipped ? chart.pause() : chart.resume());
  ```
- Avoid/caveats: The event does not bubble in some engines; listen on the element or use capture. `content-visibility` needs `contain-intrinsic-size` to avoid layout shifts (CSS topic).
- Status: `content-visibility` Baseline newly available (2025-09-15); `contentvisibilityautostatechange` Chrome 108, Firefox 130 (partial from 124), Safari 18.
- Sources: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/efficient-background-processing.md

---

## K. Startup and off-main-thread

### Split script evaluation into several smaller tasks
- Layer: build, html
- Stage: script-compile, script-run, main-thread-task
- Metrics: INP (during load), TBT
- When: load, build
- Impact: medium to high, because a single large bundle evaluates as one long task
- Do: Keep initial chunks moderate (web.dev suggests about 100 KB per script as a balance), load feature code with dynamic `import()`, and do not let one `<script>` hold all startup work.
- Why: Each classic `<script>` element evaluates in its own task; Chromium compiles each module in its own task; dynamic imports get their own tasks. In Chromium, all `defer` scripts (and module scripts, which are deferred) run in the same task as `DOMContentLoaded`, which can make one long task. LoAF shows script evaluation as `invokerType: 'classic-script' | 'module-script'`.
- Avoid/caveats: Smaller files compress worse; unbundled nested modules create request chains (use `modulepreload`). Details belong to the loading/bundling topics.
- Status: Guidance; behavior per engine as described by web.dev.
- Sources: https://web.dev/articles/script-evaluation-and-long-tasks ; https://web.dev/articles/find-slow-interactions-in-the-field

### Move long pure computation to a worker
- Layer: js
- Stage: main-thread-task
- Metrics: INP, FPS/smoothness
- When: interaction, long-lived session
- Impact: high for indicator math, large sorts, and data decoding
- Do: Run work that does not need the DOM and takes more than a few frames (indicator recalculation over long history, CSV/binary decoding, sorting) in a Web Worker; post back only the result to draw.
- Why: The main thread runs JavaScript, style, layout and often paint; worker code (and scripts it imports) runs on its own thread. Google's guidance heuristic sends work over ~250 ms to a worker.
- Avoid/caveats: Workers have no DOM; message copying costs time for big payloads (use transferable buffers; details in the workers topic). `requestAnimationFrame` exists in dedicated workers for `OffscreenCanvas` rendering (Baseline widely available since 2025-09-27).
- Status: Web Workers Baseline widely available.
- Sources: https://web.dev/articles/optimize-javascript-execution ; https://web.dev/articles/script-evaluation-and-long-tasks ; https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames

---

## Deprecated, not shipped, and myths (quick list)
- `navigator.scheduling.isInputPending()`: Chromium-only, MDN-deprecated, web.dev says do not use.
- `setImmediate`: only legacy Edge (12-79); deprecated; use `MessageChannel` or `scheduler.postTask`.
- `requestPostAnimationFrame`: proposal only; not in browser-compat-data.
- `scheduler.yield(options)`: earlier drafts had options; the current spec and MDN take no arguments.
- Myth: "await / Promise.resolve() yields to the browser." It does not; it is a microtask.
- Myth: "DocumentFragment makes DOM inserts much faster." MDN says the benefit is overstated.
- Myth: "setTimeout(fn, 0) runs next." It runs after other queued tasks and is clamped to 4 ms after 5 nested levels.
- Myth: "Unload handlers are a safe place to save state." Use `visibilitychange`/`pagehide`.
- Myth (conflict to note): "WebSocket keeps background timers unthrottled." MDN says so, but Chrome's intensive throttling lists only WebRTC as an exemption.

## Sources read
- https://html.spec.whatwg.org/multipage/webappapis.html (event loops, processing model, microtask checkpoint)
- https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html (timers, nesting clamp, queueMicrotask)
- https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html (animation frames)
- https://wicg.github.io/scheduling-apis/
- https://w3c.github.io/IntersectionObserver/
- https://drafts.csswg.org/resize-observer/
- https://web.dev/articles/optimize-long-tasks
- https://web.dev/articles/optimize-inp
- https://web.dev/articles/inp
- https://web.dev/articles/optimize-input-delay
- https://web.dev/articles/dom-size-and-interactivity
- https://web.dev/articles/script-evaluation-and-long-tasks
- https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing
- https://web.dev/articles/client-side-rendering-of-html-and-interactivity
- https://web.dev/articles/find-slow-interactions-in-the-field
- https://web.dev/articles/debounce-your-input-handlers
- https://web.dev/articles/optimize-javascript-execution
- https://developer.chrome.com/docs/web-platform/long-animation-frames
- https://developer.chrome.com/blog/use-scheduler-yield
- https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- https://developer.chrome.com/docs/capabilities/web-apis/isinputpending
- https://developer.chrome.com/blog/aligning-input-events
- https://developer.chrome.com/blog/memory-and-energy-saver-mode
- https://developer.chrome.com/docs/web-platform/page-lifecycle-api (developer recommendations section)
- https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout
- https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide
- https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback
- https://developer.mozilla.org/en-US/docs/Web/API/Background_Tasks_API
- https://developer.mozilla.org/en-US/docs/Web/API/Prioritized_Task_Scheduling_API
- https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/postTask
- https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield
- https://developer.mozilla.org/en-US/docs/Web/API/TaskController
- https://developer.mozilla.org/en-US/docs/Web/API/Scheduling/isInputPending
- https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming
- https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents
- https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getPredictedEvents
- https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
- https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event
- https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
- https://developer.mozilla.org/en-US/docs/Web/API/DocumentFragment
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/innerText
- https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Event_bubbling
- https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/
- https://www.andreaverlicchi.eu/en/blog/jake-archibald-in-the-loop-jsconf-asia-talk-transposed/ (text version of Jake Archibald's "In The Loop"; blog)
- https://v8.dev/blog/fast-async
- https://gist.github.com/paulirish/5d52fb081b3570c81e3a (raw)
- https://nolanlawson.com/2019/08/11/high-performance-input-handling-on-the-web/ (blog)
- https://nolanlawson.com/2019/08/14/browsers-input-events-and-frame-throttling/ (blog, 2019 data)
- https://raw.githubusercontent.com/facebook/react/main/packages/scheduler/src/forks/Scheduler.js
- https://raw.githubusercontent.com/facebook/react/main/packages/scheduler/src/SchedulerFeatureFlags.js
- https://github.com/GoogleChromeLabs/scheduler-polyfill (README)
- https://github.com/GoogleChrome/modern-web-guidance (skills/modern-web-guidance/guides/performance: performance.md, break-up-long-tasks.md, schedule-tasks-by-priority.md, efficient-background-processing.md, defer-work-until-scroll-ends.md, identify-inp-causes.md, interactions-in-complex-layouts.md, detect-initial-visibility-state.md, batch-analytics-events.md)
- https://github.com/github/eslint-plugin-github/blob/main/docs/rules/async-preventdefault.md
- https://chromestatus.com/feature/4889002157015040 and https://chromestatus.com/feature/5072451480059904 (via the chromestatus JSON API)
- https://github.com/WebKit/standards-positions/issues/361 (via WebFetch summary)
- https://github.com/web-platform-tests/interop/issues/1398 (via WebFetch summary)
- https://webkit.org/blog/17848/release-notes-for-safari-technology-preview-238/ (via WebFetch summary; no scheduling APIs mentioned)
- https://motion.dev/magazine/when-browsers-throttle-requestanimationframe (via WebFetch summary; 2020)
- https://cdn.jsdelivr.net/npm/@mdn/browser-compat-data/data.json (v8.1.2, 2026-09-17)
- https://cdn.jsdelivr.net/npm/web-features/data.json (Baseline status)
- Local diagnostic: Chromium 152 (Claude desktop browser pane, page hidden) yield-gap measurement for setTimeout/MessageChannel/scheduler.yield/postTask.

## Not covered / could not access
- Jake Archibald's "In The Loop" video itself was not watched; I used a third-party text transposition (2024). The part on double-rAF CSS transitions is omitted in that text.
- Safari/WebKit and Firefox behavior for the setTimeout-promise yield clamp was not measured; only Chromium 152 was tested, and that page was in a hidden pane.
- WebKit's own position on the Prioritized Task Scheduling API: the issue is open with no position label; no WebKit comments were visible in the fetched summary.
- Exact Safari background timer throttling rules: no primary WebKit source found; MDN lists only Chrome and Firefox details.
- Whether Chrome gives rendering a guaranteed priority after N ms without a frame (rendering starvation rules) was not verified in a primary source.
- web.dev "Manually diagnose slow interactions in the lab" and "long-tasks-devtools" were downloaded but not read in detail (tooling topic).
- DevTools Performance panel workflows, Web Workers/OffscreenCanvas/transferables, CSS containment and content-visibility details, and bundling are only referenced here; they belong to other research topics.
- The Chromium intent thread for removing the 1 ms clamp (source of the "Safari keeps a 1 ms clamp" statement) was seen only through a search summary.
