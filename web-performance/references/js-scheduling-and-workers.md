# JS scheduling and workers (TASK-)

Open this when you write code that can hold the main thread for more than a few milliseconds: loops, sorts, filters and parses over data that grows, startup initialization, `setTimeout`, `setInterval`, `requestIdleCallback`, `scheduler.*`, `new Worker`, `postMessage`, `SharedArrayBuffer`, `WebAssembly.*`.
Stage cards: `pipeline.md` §H, the `tasks`, `js` and `script-load` cards. Event-loop slots: §D. INP subparts: §G.

## Checklist

| ID | Do this | Impact | First stage |
|---|---|---|---|
| **§0 Primitive map** | Which primitive runs when, and what each one is for | | |
| **§A Tasks and frames** | | | |
| TASK-01 | Keep each task under 50 ms, and script per frame to a few ms while something moves | high | tasks |
| **§B Size the work** | | | |
| TASK-02 | Time the work first: under 50 ms inline, 50–250 ms sliced, over 250 ms in a worker | high | tasks |
| **§C Yield** | | | |
| TASK-03 | Yield with `scheduler.yield()` on a deadline, through one `yieldToMain()` helper | high | tasks |
| TASK-04 | Never "yield" with a promise or `queueMicrotask`; no `await` per item in hot loops | high | tasks |
| TASK-05 | A `MessageChannel` task, not chained `setTimeout(0)`; rAF then a task for after-paint work | medium | tasks |
| TASK-06 | Split startup: yield between init phases; `import()` what the first view does not need | medium | script-load |
| **§D Priorities and idle** | | | |
| TASK-07 | `requestIdleCallback` only for deferrable work, with a `timeout`; never `isInputPending()` | medium | tasks |
| TASK-08 | `scheduler.postTask` priorities for background jobs; abort them with `TaskController` | medium | tasks |
| **§E Timers** | | | |
| TASK-09 | No timers for visuals; events, observers or push instead of polling | medium | tasks |
| **§F Workers** | | | |
| TASK-10 | One long-lived module worker per job, created once; pools sized from `hardwareConcurrency` | high | tasks |
| TASK-11 | Small messages and deltas, batched per frame; transfer `ArrayBuffer`s; `structuredClone` | high | tasks |
| TASK-12 | `MessageChannel` between workers; `SharedArrayBuffer` only under cross-origin isolation | medium | tasks |
| **§G Wasm** | | | |
| TASK-13 | Wasm only for measured kernels; cross the boundary rarely and in bulk | medium | js |
| TASK-14 | Stream-compile Wasm from a stable `application/wasm` URL; ship the SIMD build | medium | script-load |
| **Pointers** | | | |
| → EVT-01 | An input handler paints its feedback first, then yields | | |
| → EVT-13 | Logging, analytics and persistence off the input path | | |
| → DATA-03 | Decode high-rate feeds in a worker and post typed arrays | | |
| → CNV-18 | Draw in a worker with `OffscreenCanvas` when the main thread is the limit | | |
| → LIFE-06 | Hidden tab: stop polls and timers, resync on return | | |
| → LIFE-15 | Close ports and terminate workers that a view owned | | |
| **§H One-line rules** | | | |
| TASK-15 | In a module worker, attach the message handler before the first top-level `await` | medium | tasks |
| TASK-16 | Start independent async work together; `await Promise.all` | medium | network |
| TASK-17 | No top-level `await` in modules that other modules import | medium | script-load |
| TASK-18 | Wrap worker calls in a small RPC layer, and batch the calls | low | tasks |
| TASK-19 | Put hot Wasm loops in functions that are called many times | medium | js |
| TASK-20 | Treat Wasm memory as a heap that never shrinks | medium | memory |

## §0 Primitive map

Pick the primitive by what must happen before the code runs. The slot model behind this table is `pipeline.md` §D.

| Primitive | When it runs | Use it for | Not for |
|---|---|---|---|
| Synchronous code | Now, in the current task | Work under a few ms; the visible answer to an input | Work that grows with data size (TASK-02) |
| `queueMicrotask`, `await` on a resolved value | When the JS stack empties, before any other task | Ordering; one flush for many calls in one task | Yielding: input and paint never get in (TASK-04) |
| `requestAnimationFrame` | Once per frame, before style and layout; stops in hidden tabs | DOM writes and drawing for the next frame | Model updates, network, analytics |
| rAF, then a task | After the frame's rendering work | Non-visual follow-up of an input (TASK-05) | Changes that the next frame must show |
| `scheduler.yield()` | A new task, ahead of other tasks of its priority | Continuing one long job after input and paint (TASK-03) | Separate jobs with their own priority |
| `scheduler.postTask()` | A new task, in priority order | Independent jobs with a priority and an abort signal (TASK-08) | Idle-only work: `background` is not idle-gated |
| `MessageChannel` message | A new task at the back of the queue, no clamp | The `yieldToMain()` fallback; a next-task helper (TASK-05) | Priority: it gets no boost |
| `setTimeout(fn, ms)` | A timer task after `ms` or later; 4 ms minimum when nested more than 5 deep; throttled in hidden tabs | Real delays and timeouts | Visuals (TASK-09); yield loops (TASK-05) |
| `setInterval` | Repeating timer tasks, also while the last run is slow | Almost nothing: use events or a self-rescheduling `setTimeout` | Polling, animation |
| `requestIdleCallback` | After a frame when no task waits; deadline 50 ms at most | Optional work, with a `timeout` (TASK-07) | DOM writes; work an input waits for |
| Dedicated worker | Another thread with its own event loop | CPU work over about 250 ms, or work per message (TASK-10) | DOM work; jobs of a few ms |
| Wasm | On the thread that calls it | Measured numeric kernels; existing native libraries (TASK-13) | Replacing JS by default |

## §A Tasks and frames

### TASK-01 Keep each task under 50 ms, and script per frame to a few ms while something moves
stage: tasks · metric: INP, frame · when: interaction, render-loop, load · impact: high — tasks run to the end, so input and the next frame wait for all of the running task · support: n/a · also: TASK-02, TASK-03, EVT-01
- Do: Treat 50 ms as the limit for any one task, at load and after it. While the user scrolls, drags or pans, or while a view streams data, keep script to a few ms per frame (web.dev: about 3–4 ms), so that style, layout and paint still fit. When chunked work must show progress, apply each visual step in a rAF callback: do not expect a paint between two small tasks.
- Why: Input that arrives during a task waits for its end (input delay), and so does the frame. Long Tasks and LoAF count the time over 50 ms as blocking time. With no input pending, Chromium can run many queued small tasks before it renders once, so short tasks help INP but do not give smooth frames by themselves.
- Detect: `rg -n '\.(sort|filter|map|reduce|forEach)\(|for \(const |JSON\.parse\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'` in input handlers, message handlers, rAF callbacks and startup code, over data that grows with the session (10k+ items). A match is a candidate: time it (TASK-02).
- Verify: measure.md#inp for handlers, measure.md#fps for motion or streams, measure.md#load for startup. Pass: the `Tasks` line of `trace-summary.mjs --between wp:start wp:end` shows no task over 50 ms from app code, and `__wpProbe.loaf.read()` names no app script in a long frame.
- Avoid: 50 ms is a responsiveness limit, not a frame budget: a stream can drop frames with no long task at all. Splitting does not remove work; when frames still drop, do less or move it off the thread (TASK-10). Do not split code that a trace has not shown as long.
- Source: https://web.dev/articles/optimize-long-tasks ; https://developer.chrome.com/docs/web-platform/long-animation-frames

## §B Size the work

### TASK-02 Time the work first: under 50 ms inline, 50–250 ms sliced, over 250 ms in a worker
stage: tasks, js · metric: INP, frame · when: interaction, load, session · impact: high — a guess puts 300 ms of work in a handler, or puts 2 ms of work behind a worker round trip · support: n/a · also: TASK-01, TASK-03, TASK-10
- Do: Time the work with the largest input that the app accepts, on the lab profile (CPU 4x): `performance.now()` before and after, or `performance.measure()`. Under 50 ms: run it inline. 50 to 250 ms: slice it and yield on a deadline (TASK-03). Over 250 ms, or work that repeats for each message: move it to a worker (TASK-10). Then fix the algorithm and the allocations (`v8-hot-code.md`).
- Why: The thresholds are a heuristic from Chrome's Modern Web Guidance, not a spec. Slicing keeps input responsive but adds yield overhead, so the job takes longer in total. A worker removes the contention but adds a structured clone and two tasks for each round trip.
- Detect: in a review, a new loop, sort, filter or parse over session-sized data (TASK-01 Detect) with no measured duration in the change, and no `performance.(now|mark|measure)` around it, is a finding.
- Verify: measure.md#inp or measure.md#fps with the largest fixture. Pass: the duration is recorded before the choice, and after the change each task of the job stays under 50 ms (`Tasks` line of `trace-summary.mjs`), with the total job time reported next to it.
- Avoid: A fast laptop without throttling hides the cost: use the CPU profile in measure.md §2. `performance.now()` is coarsened, so repeat sub-millisecond work in a loop before you time it. `Date.now()` can jump with clock changes. Numbers from the dev fixture say nothing about the largest real input.
- Source: https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/performance.md ; https://web.dev/articles/optimize-long-tasks

## §C Yield

### TASK-03 Yield with `scheduler.yield()` on a deadline, through one `yieldToMain()` helper
stage: tasks · metric: INP · when: interaction, load, session · impact: high — a yield ends the task, so input and rendering run, and the job continues before other queued tasks of its priority · support: scheduler-yield · also: TASK-02, TASK-04, TASK-05, EVT-01, EVT-12
- Do: Keep one `yieldToMain()` helper in the project and use it everywhere. In a long loop, check a deadline and `await yieldToMain()` only when it has passed: about 50 ms for background batches, about 4–8 ms while something moves on screen. After each yield, stop if the job's `AbortSignal` is aborted (EVT-12). Keep the `nextTask()` fallback only while support.md puts `scheduler-yield` above the Chromium floor.
- Why: `scheduler.yield()` resolves in a new task, so input and rendering can run between chunks. Its continuation runs ahead of other tasks of the same priority, also third-party timers; a `setTimeout` or `MessageChannel` continuation waits at the back of the queue. Each yield costs time, so yield on a deadline, not per item (web.dev: "A common deadline is 50 milliseconds").
- Detect: `rg -n 'scheduler\.yield|yieldToMain|=> *setTimeout\(\w+(, *0)?\)' -g '*.{ts,js,tsx,jsx,svelte,vue}'`: two or more yield helpers, a yield per item with no deadline, or a timer promise as the yield are candidates. A long loop (TASK-01 Detect) with no yield is a finding.
- Verify: measure.md#inp with a click while the job runs. Pass: no task over 50 ms from the job in `trace-summary.mjs`, `inputDelayMs` of the click wins, and the total job time is reported (it grows a little).
- Example:
  ```ts
  const ch = new MessageChannel(), queued: Array<() => void> = [];
  ch.port1.onmessage = () => queued.shift()?.();
  export const nextTask = () => new Promise<void>((r) => { queued.push(r); ch.port2.postMessage(null); });
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  export const yieldToMain = () => (sched?.yield ? sched.yield() : nextTask());

  export async function eachSliced<T>(items: readonly T[], fn: (item: T) => void, budgetMs = 50) {
    let deadline = performance.now() + budgetMs;
    for (const item of items) {
      fn(item);
      if (performance.now() >= deadline) { await yieldToMain(); deadline = performance.now() + budgetMs; }
    }
  }
  ```
- Avoid: A yield lets the browser render but does not force a frame; for "after the next paint", use rAF, then a task (TASK-05). Do not yield between two DOM changes that must show in the same frame. `await scheduler?.yield?.()` is only a microtask where the method is missing (TASK-04). `forEach` does not wait for async callbacks. Do not yield only when `isInputPending()` says so (TASK-07).
- Source: https://developer.chrome.com/blog/use-scheduler-yield ; https://web.dev/articles/optimize-long-tasks

### TASK-04 Never "yield" with a promise or `queueMicrotask`; no `await` per item in hot loops
stage: tasks, js · metric: INP, frame · when: interaction, render-loop · impact: high — the microtask queue drains fully before the event loop continues, so a promise chain blocks input and paint like synchronous code · support: baseline · also: TASK-03, V8-11
- Do: Use a task-level yield (TASK-03) when input or rendering must get in. Use `await` on resolved values and `queueMicrotask` only for order: to make a callback always async, or to merge many calls in one task into one flush. Keep functions that run for each item or each message synchronous when they do no I/O; `await` once per batch, never once per item, and never `for await` over a plain array.
- Why: After each callback, the browser drains the microtask queue, also the microtasks added while it drains, before it goes back to the event loop. The HTML spec warns that many microtasks cost the same as synchronous code. Each `async` function allocates a promise, and each `await` costs at least one microtask tick.
- Detect: `rg -n 'await (Promise\.resolve\(\)|null|undefined|0);|queueMicrotask\(|for await \(' -g '*.{ts,js,tsx,jsx,svelte,vue}'` inside loops; `async` on functions that run per item or per message and do no I/O.
- Verify: measure.md#inp (measure.md#fps for a render loop). Pass: `trace-summary.mjs` shows the loop as tasks under 50 ms instead of one long task with microtasks inside, and `inputDelayMs` wins.
- Example:
  ```ts
  // Before: one long task; each await is only a microtask
  for (const row of rows) { indexRow(row); await Promise.resolve(); }
  // After: real yields on a deadline (TASK-03)
  await eachSliced(rows, indexRow);
  ```
- Avoid: `queueMicrotask` is correct for batching store updates in one task into one render request; it is wrong as a yield. A test that calls `el.click()` runs microtasks after all listeners, but a real click runs them between listeners. Ship native `async`/`await`: transpiled async and promise polyfills add ticks (V8-11).
- Source: https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#microtask-queuing ; https://v8.dev/blog/fast-async

### TASK-05 A `MessageChannel` task, not chained `setTimeout(0)`; rAF then a task for after-paint work
stage: tasks · metric: INP, frame · when: interaction, session · impact: medium — nested zero-delay timers get a 4 ms minimum, so a timer-based yield loop idles about 4–5 ms per yield after the first few · support: baseline · also: TASK-03, EVT-01, EVT-13
- Do: For "run this in the next task" (the `yieldToMain()` fallback, a job queue, a deferred flush), post a message on one reused `MessageChannel`: `nextTask()` in TASK-03. For work after the next frame (saves, analytics after an input), use `requestAnimationFrame(() => setTimeout(work))`: one timer is not nested, so it gets no clamp. Keep `setTimeout` for real delays.
- Why: The HTML timer steps raise the delay to 4 ms once the nesting level passes 5, and Chromium follows them. A posted message is not a timer, so no clamp applies; React's scheduler uses `MessageChannel` for this reason. The rAF-then-task pair queues the task at the start of the frame, so it runs after that frame's rendering work.
- Detect: `rg -n 'new Promise\(\(?\w+\)? *=> *setTimeout\(\w+(, *0)?\)\)|setImmediate\(|new MessageChannel\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'`: a timer promise inside a loop or a recursive scheduler, `setImmediate` in browser code, or a new channel per call.
- Verify: measure.md#inp with a click that starts the chunked job. Pass: the job's own `performance.measure()` duration, read with `evaluate_script`, wins in compare-runs, and `trace-summary.mjs` still shows no task over 50 ms.
- Avoid: A `MessageChannel` continuation still waits at the back of the queue; only `scheduler.yield()` gets the boost. Create one channel per module, not per call. An open port can keep a Node or jsdom test process alive: close it in test teardown. A double rAF waits a whole frame and still runs before the next paint.
- Source: https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers ; https://github.com/facebook/react/blob/main/packages/scheduler/src/forks/Scheduler.js

### TASK-06 Split startup: yield between init phases; `import()` what the first view does not need
stage: script-load, tasks · metric: INP, startup · when: load · impact: medium — top-level code of one module runs as one task, so a click during startup waits for all of it · support: baseline · also: TASK-03, TASK-17, EVT-02
- Do: In the entry module, run what the first view needs, then `await yieldToMain()` between the next init phases (live updates, secondary panels, warm-up). Load features that the first view does not show with `import()`, and start that import on intent (`pointerenter`, `focus`) or when idle, so that its evaluation task does not land inside a click. Import heavy libraries that need no DOM (parsers, codecs, math) inside a worker (TASK-10). Chunk sizes and code splitting: `html-loading.md` §E.
- Why: Each classic script runs in its own task, and each dynamic `import()` gets its own tasks; current Chromium also runs each deferred and module script in its own task (older versions ran all of them in the `DOMContentLoaded` task, support.md §C). LoAF shows startup evaluation as `invokerType` `classic-script` or `module-script`.
- Detect: an entry file (`main.ts`, `index.ts`, `app.ts`) with a run of `init*()`, `setup*()` or `register*()` calls and no yield between them; `rg -n "^import .* from '.*(dialog|settings|editor|export|report|admin)" -g '*.{ts,js,tsx,jsx}'` in the entry graph.
- Verify: measure.md#start, and measure.md#inp with a click on the first view while the page still loads. Pass: no evaluation task over 50 ms from app chunks in `trace-summary.mjs`, the click's `inputDelayMs` wins, and measure.md#load LCP is not worse.
- Example:
  ```ts
  renderFirstView(initialData);                // what the user sees first
  await yieldToMain();                         // a click can run here
  connectLiveUpdates();
  await yieldToMain();
  reportButton.addEventListener('pointerenter', () => void import('./report-builder'), { once: true });
  ```
- Avoid: A large dynamic chunk still evaluates as one long task when the click needs it: keep lazy chunks small too. Smaller chunks compress worse and add requests. Do not await network data before the first render when cached or server-rendered data can show first.
- Source: https://web.dev/articles/script-evaluation-and-long-tasks ; https://web.dev/articles/optimize-long-tasks

## §D Priorities and idle

### TASK-07 `requestIdleCallback` only for deferrable work, with a `timeout`; never `isInputPending()`
stage: tasks · metric: INP, memory · when: session, load · impact: medium — idle callbacks can wait for seconds, and a long one still blocks the next input · support: request-idle-callback · also: TASK-03, TASK-08, EVT-13
- Do: Put optional work in idle callbacks: cache pruning, precomputation, batched logging. Pass `{ timeout }` when the work must run in the end, check `deadline.timeRemaining()` per unit of work, and schedule the rest again. Make no DOM changes there: schedule them in rAF. Remove `navigator.scheduling.isInputPending()` checks and yield on a deadline instead (TASK-03).
- Why: The idle deadline is at most 50 ms after the idle period starts, cut short by the next frame and by pending timers; on a busy page, only the timeout makes the callback run. The frame is already done, so a DOM write there costs an extra style and layout. `isInputPending()` can return false after real input, and paint also needs the thread; web.dev withdrew its advice to use it.
- Detect: `rg -n 'requestIdleCallback\(|isInputPending' -g '*.{ts,js,tsx,jsx,svelte,vue}'`: an idle callback with no `timeout`, with DOM writes, or called from an input handler "to make it faster"; any `isInputPending`.
- Verify: measure.md#inp with the idle work pending. Pass: the idle work runs as tasks under 50 ms in `trace-summary.mjs`, and the interaction's `inputDelayMs` is not worse than the base.
- Example:
  ```ts
  function prune(deadline: IdleDeadline) {
    while (deadline.timeRemaining() > 2 && cache.size > MAX_ENTRIES) evictOldest(cache);
    if (cache.size > MAX_ENTRIES) requestIdleCallback(prune, { timeout: 5000 });
  }
  requestIdleCallback(prune, { timeout: 5000 });
  ```
- Avoid: This replaces the advice "use `requestIdleCallback` to make an interaction faster": it only moves work, and moved work that is long becomes input delay for the next input. Idle callbacks do not exist in workers. Do not resolve promises in them: the reactions run right after the callback returns, outside its deadline. A timeout makes the callback run on a busy page too.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback ; https://web.dev/articles/optimize-long-tasks

### TASK-08 `scheduler.postTask` priorities for background jobs; abort them with `TaskController`
stage: tasks · metric: INP, LCP · when: load, session · impact: medium — warm-up, prefetch and analytics then wait behind input and visible work instead of competing with it · support: scheduler-post-task · also: TASK-07, EVT-12, EVT-13
- Do: Post independent jobs with `scheduler.postTask(fn, { priority, signal })`: `background` for work nobody waits for, the default `user-visible` for work that updates the screen soon, `user-blocking` only for chunks of an input's own work. Use a `TaskController` when a view can raise the priority later (`setPriority()`) or close (`abort()`). Use the `delay` option instead of a separate `setTimeout`.
- Why: Tasks posted through the scheduler run in strict priority order, and `scheduler.yield()` inside a posted task keeps its priority and signal. `background` is the lowest priority but is not idle-gated: it gets no `IdleDeadline` and can run during a busy frame, so keep each task short.
- Detect: `rg -n 'setTimeout\([^)]*(prefetch|warm|precompute|analytics|track|sync)' -g '*.{ts,js,tsx,jsx,svelte,vue}'` (background jobs on bare timers); `postTask\(` with no `signal` in components that unmount; `'user-blocking'` on work that no input waits for.
- Verify: measure.md#inp with the background jobs queued at the same time. Pass: the interaction's input delay and processing win or stay neutral, and after the view closes an app counter in `__wpProbe.memory.sample()` shows no aborted job still running.
- Example:
  ```ts
  const warm = new TaskController({ priority: 'background' });
  scheduler.postTask(() => buildSearchIndex(products), { signal: warm.signal })
    .catch((e) => { if (e.name !== 'AbortError') throw e; });   // abort() on close rejects
  searchBox.addEventListener('focus', () => warm.setPriority('user-visible'), { once: true });
  onPanelClose(() => warm.abort());
  ```
- Avoid: A `priority` option makes the task's priority fixed, and a signal's priority is then ignored. A flood of `background` tasks can wait a long time under load, so do not put data that the user waits for there. `user-blocking` does not block rendering. Catch only the `AbortError` of aborted tasks, not every error.
- Source: https://wicg.github.io/scheduling-apis/ ; https://developer.mozilla.org/en-US/docs/Web/API/Prioritized_Task_Scheduling_API

## §E Timers

### TASK-09 No timers for visuals; events, observers or push instead of polling
stage: tasks · metric: INP, frame, memory · when: session · impact: medium — a recurring timer that fires during an interaction becomes its input delay, and hidden tabs run timers late · support: baseline · also: LIFE-06, EVT-11, CNV-02, DATA-10
- Do: Draw with rAF (`gpu-canvas-and-frames.md`), never with `setInterval(draw, 16)`. Replace polling with the signal of the change: `ResizeObserver`, `IntersectionObserver`, `MutationObserver`, a WebSocket or SSE push, media events. When periodic work is necessary, schedule the next run after the current one ends, keep each run small, and stop while the tab is hidden (LIFE-06). Compute elapsed time from `performance.now()` or server time, never by counting timer calls.
- Why: Timer tasks are not aligned to frames, so a 16 ms interval drifts: some frames get two updates and some none. LoAF reports timer work in input delay as `invokerType: 'user-callback'`. In a hidden tab, Chromium aligns timers to one wake-up per second, and after a loaded, silent page has been hidden for about a minute, chained timers wake once per minute; an open WebSocket gives no exemption (support.md §C).
- Detect: `rg -n 'setInterval\(|setTimeout\([^,]+, *(16|17|33|1000 */ *60)\)' -g '*.{ts,js,tsx,jsx,svelte,vue}'`, then read the callback: drawing, DOM writes, polling (`fetch(`, `getBoundingClientRect(`, `offsetWidth`, `scrollTop`) or a counter of calls are candidates.
- Verify: measure.md#inp with the timer running (5 clicks at random times), and the idle check of measure.md#fps. Pass: `__wpProbe.loaf.read()` lists no `user-callback` timer script in the interactions' long frames, and the idle window shows no app timer that draws.
- Example:
  ```ts
  // Before: fixed cadence, also while hidden and while the last run is slow
  setInterval(refreshStatus, 5000);
  // After: the next run starts after this one ends; stops while hidden
  let timer = 0, gen = 0;
  async function poll(g = ++gen) {
    if (document.hidden || g !== gen) return;
    await refreshStatus();
    if (g === gen) timer = window.setTimeout(() => poll(g), 5000);
  }
  document.addEventListener('visibilitychange', () => { clearTimeout(timer); void poll(); }, { signal });
  void poll();
  ```
- Avoid: This replaces "throttle visuals with a timer": throttle them with rAF (EVT-11). Keep heartbeats and expiry logic in the protocol or on the server; client timers in a hidden tab can be a minute late or frozen. A 1 s clock may use a timer that requests one rAF render. Third-party scripts often own intervals: LoAF `sourceURL` names them.
- Source: https://web.dev/articles/optimize-input-delay ; https://developer.chrome.com/blog/timer-throttling-in-chrome-88

## §F Workers

### TASK-10 One long-lived module worker per job, created once; pools sized from `hardwareConcurrency`
stage: tasks, js · metric: INP, frame, startup · when: interaction, session · impact: high — parsing, sorting and math in a worker no longer delay input or frames on the main thread · support: baseline · also: TASK-02, TASK-11, TASK-15, DATA-03, CNV-18
- Do: Move CPU work that needs no DOM and runs over about 250 ms, or runs for each message (decoding, filtering, aggregation, search indexing, chart math), into a dedicated worker: `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`, written inline so that the bundler emits the chunk. Create it once, at startup or on first need, and keep it; import heavy libraries inside it. For parallel jobs, use a pool of `hardwareConcurrency - 1` workers (at least 1) with a small cap. Terminate the workers that a view owns when it closes (LIFE-15).
- Why: A worker has its own thread and event loop, so its long tasks block neither input nor rendering; its module graph also downloads, compiles and runs off the main thread. The HTML spec calls workers heavy-weight, with a high start-up cost and a high memory cost per instance.
- Detect: `rg -n 'new Worker\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'` inside functions that run per request, per item or per render; a worker URL kept in a variable (the bundler cannot see it); main-thread code that TASK-02 timed over 250 ms.
- Verify: measure.md#inp (measure.md#fps for streams) with the heavy job running during the interaction. Pass: `__wpProbe.loaf.read()` no longer lists the job's script in the interaction's frames, `inputDelayMs` or frame p95 wins, and the job's end-to-end time is reported.
- Example:
  ```ts
  const worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module', name: 'search' });
  const pending = new Map<number, (ids: Uint32Array) => void>();
  let seq = 0;
  worker.onmessage = (e: MessageEvent<{ id: number; ids: Uint32Array }>) => {
    pending.get(e.data.id)?.(e.data.ids);
    pending.delete(e.data.id);
  };
  export const search = (query: string) =>
    new Promise<Uint32Array>((resolve) => { const id = ++seq; pending.set(id, resolve); worker.postMessage({ id, query }); });
  ```
- Avoid: "Workers make code faster" is a myth: the work stays, and each round trip adds a clone and two tasks, so a job of a few ms can get slower. Workers have no DOM, no `AudioContext` and no `RTCPeerConnection`. Do not put long or streaming work in the service worker: one instance serves every tab, and the browser stops it when a task runs too long. LoAF does not attribute worker code: read the worker's thread in the trace.
- Source: https://html.spec.whatwg.org/multipage/workers.html ; https://web.dev/articles/off-main-thread

### TASK-11 Small messages and deltas, batched per frame; transfer `ArrayBuffer`s; `structuredClone`
stage: tasks, memory · metric: frame, INP, memory · when: render-loop, session · impact: high — structured clone runs on both threads for each message, and its cost grows with size and object count · support: baseline · also: TASK-10, DATA-03, DATA-06
- Do: Send only what changed (new rows, dirty ranges, patches), batched per frame, not per item. Put bulk numbers in typed arrays and list their buffers in the transfer list; at high rates, send the buffers back and reuse them. Send plain data (objects, arrays, `Map`, `Set`, `Date`, typed arrays), not class instances. Copy deeply with `structuredClone(value)`, not `JSON.parse(JSON.stringify(value))`.
- Why: `postMessage` serializes in the sender and deserializes in the receiver, and both steps block their thread. Surma measured about 10 KiB (as JSON) per message as safe inside a frame, and about 100 KiB inside a 100 ms response. A transfer moves ownership with no copy and detaches the sender's buffer.
- Detect: `rg -n 'postMessage\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'`, then check for whole-state payloads (`getState()`, the full list), one message per item inside a loop, and typed arrays with no transfer list; `rg -n 'JSON\.parse\(JSON\.stringify\('` for copies.
- Verify: measure.md#fps with the streaming or batch scenario. Pass: frame p95 and `longFramesPer10s` win or stay neutral, and the "Minor GC" time in the `trace-summary.mjs` window goes down.
- Example:
  ```ts
  // worker: one batch per frame, no copy
  const xs = new Float64Array(rows.length), ys = new Float64Array(rows.length);
  rows.forEach((r, i) => { xs[i] = r.time; ys[i] = r.value; });
  postMessage({ kind: 'batch', xs, ys }, [xs.buffer, ys.buffer]);  // xs and ys detach here
  ```
- Avoid: A typed array is not transferable: its buffer is, and the whole buffer moves even when the view covers part of it. Never transfer a buffer that other code still reads. rAF in a worker stops in hidden tabs, so a queue that flushes only in rAF grows without a limit: also flush when it is full (DATA-03). Class instances arrive as plain objects, and functions or DOM nodes throw `DataCloneError`.
- Source: https://surma.dev/things/is-postmessage-slow/ ; https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects

### TASK-12 `MessageChannel` between workers; `SharedArrayBuffer` only under cross-origin isolation
stage: tasks, memory · metric: frame, INP · when: render-loop, session · impact: medium — a relay through the main thread adds two tasks per message there, and shared memory removes the clone for per-frame data · support: shared-memory, document-isolation-policy · also: TASK-11, DATA-09
- Do: When one worker feeds another, create a `MessageChannel` on the main thread and transfer one port to each, so that the data never passes through the main thread. For a request with one reply, send a port with the message and answer on `event.ports[0]`. Use `SharedArrayBuffer` and `Atomics` only for measured per-frame hand-offs, only when `crossOriginIsolated` is true, with transfers as the other path; the main thread reads shared state once per frame with `Atomics.load` and never blocks.
- Why: Ports are transferable, so the main thread only sets up the pipe. Shared memory is not cloned: the writer does plain writes, then publishes an index with `Atomics.store`, and a reader that gets that index with `Atomics.load` sees the writes. On the window, `Atomics.wait` throws; `Atomics.waitAsync` returns a promise.
- Detect: main-thread `message` handlers that only `postMessage` the data on to another worker; `rg -n 'SharedArrayBuffer|Atomics\.wait\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'` with no `crossOriginIsolated` check, `Atomics.wait` in window code, or spin loops.
- Verify: measure.md#fps with the streaming scenario. Pass: the relay handler is gone from the `__wpProbe.loaf.read()` top scripts, frame p95 wins or stays neutral, and `env().crossOriginIsolated` is true where shared memory is used.
- Example:
  ```ts
  const { port1, port2 } = new MessageChannel();
  parserWorker.postMessage({ type: 'out', port: port1 }, [port1]);
  statsWorker.postMessage({ type: 'in', port: port2 }, [port2]);
  // shared memory only when isolated; otherwise transfer batches (TASK-11)
  const ring = crossOriginIsolated ? new SharedArrayBuffer(8 + 8 * 65_536) : null;
  ```
- Avoid: Cross-origin isolation (COOP `same-origin` plus COEP `require-corp` or `credentialless`) cuts `window.opener` to cross-origin popups (sign-in, payment) and blocks cross-origin resources without CORP or CORS; `Document-Isolation-Policy` isolates one document without site-wide headers. Keep the shared protocol tiny: one producer, one consumer, `Atomics` on the head and tail only. A port with `addEventListener('message')` needs `port.start()`. Close ports that you drop (LIFE-15).
- Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer ; https://v8.dev/features/atomics

## §G Wasm

### TASK-13 Wasm only for measured kernels; cross the boundary rarely and in bulk
stage: js, memory · metric: frame, INP · when: render-loop, interaction · impact: medium — a call per item erases the gain, and a stale memory view reads nothing and gives no error · support: baseline · also: TASK-10, TASK-19, TASK-20, LIFE-01
- Do: Profile and fix the JS first; choose Wasm for a measured hot numeric kernel or an existing C, C++ or Rust library. Write the input into linear memory once through a typed-array view, make one call per batch or frame with numeric arguments (pointers and lengths as `i32`, values as `f64`), and read the result from memory. Make a new view after any call that can grow memory. Call `delete()` or `free()` on every JS wrapper of a Wasm object in the owner's teardown (LIFE-01).
- Why: Calls are cheap, but objects and strings need conversion or copies, and each `i64` that crosses becomes a BigInt. `memory.grow()` detaches the old buffer, so an old view has length 0: reads give `undefined` and writes are lost. The garbage collector cannot collect cycles that go through linear memory.
- Detect: `rg -n 'exports\.\w+\(' -g '*.{ts,js,tsx,jsx}'` inside `for`, `forEach` or `map` (a Wasm call per item); `new (Float64|Float32|Int32|Uint8)Array\(\w*\.?memory\.buffer` kept in module scope with no buffer check; `>> 2` or `>> 3` on pointers.
- Verify: measure.md#fps (measure.md#inp for one computation) against the JS version, both under the same conditions (measure.md §10: an attached debugger runs Wasm as debug code). Pass: frame p95 or processing time wins, and the Wasm memory counter in `__perf.counters()` stays flat after warm-up.
- Example:
  ```ts
  let heap = new Float64Array(memory.buffer);
  const f64 = () => (heap.buffer === memory.buffer ? heap : (heap = new Float64Array(memory.buffer)));
  const ptr = exports.alloc(values.length * 8) >>> 0;            // pointers are unsigned
  f64().set(values, ptr >>> 3);                                   // one copy in
  exports.smooth(ptr, values.length, 21);                         // one call per batch
  const out = f64().slice(ptr >>> 3, (ptr >>> 3) + values.length); // view again: memory may have grown
  exports.free(ptr);
  ```
- Avoid: "Wasm is always faster" is a myth: optimized JS often matches it, and Wasm plus glue can be larger than the JS. V8 can also deoptimize optimized Wasm now, so warm up before you compare. Do not keep a view across an `await`. A chart or engine library owns its boundary: follow its rule file (`scichart.md`).
- Source: https://v8.dev/docs/wasm-compilation-pipeline ; https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow

### TASK-14 Stream-compile Wasm from a stable `application/wasm` URL; ship the SIMD build
stage: script-load, network · metric: startup, INP · when: load, build · impact: medium — only the streaming path compiles during the download and uses the Wasm code cache, so any other path compiles from zero on each visit · support: baseline, shared-memory · also: SC-36, TASK-06, TASK-12
- Do: Load with `WebAssembly.instantiateStreaming(fetch(url), imports)` (or `compileStreaming`), never with `arrayBuffer()` and then `instantiate()`. Serve `Content-Type: application/wasm` with no parameters and a 2xx or 304 status. Put a content hash in the file name, never a per-load query string. Compile and warm the module after first paint or in a worker, and build it with fixed-width SIMD. Use Wasm threads only under cross-origin isolation (TASK-12), with a worker pool that starts before the first job.
- Why: The code cache is keyed by the URL of the streamed response, so a new URL or new bytes force a cold compile. Chrome caches only the optimized code of hot functions, so a small or cold module may never be cached, and each V8 update, security updates too, drops the cache (support.md §C). Each function compiles on its first call, on the thread that calls it.
- Detect: `rg -n 'WebAssembly\.(instantiate|compile)\(' -g '*.{ts,js,tsx,jsx}'` next to `arrayBuffer()`; `rg -n "\.wasm(\?|['\"] *\+)" -g '*.{ts,js,tsx,jsx}'` (query strings, built URLs); server or CDN config that serves `.wasm` with another type or with a `charset`.
- Verify: measure.md#start, a cold load and then a warm load. Pass: the response has `Content-Type: application/wasm`, the console shows no streaming-fallback message, and the compile time of the warm load in `trace-summary.mjs` is lower than the cold one.
- Avoid: A bundler that inlines the module as base64 or a `data:` URL turns off streaming and the cache. Loaders (Emscripten output, chart engines) can fall back to the uncached path with only a console message (SC-36). Use relaxed SIMD only for visual math, because its results can differ between CPUs. Stay on wasm32 unless one tab needs more than 4 GiB.
- Source: https://v8.dev/blog/wasm-code-caching ; https://v8.dev/docs/wasm-compilation-pipeline

## §H One-line rules

- **TASK-15** In a module worker, set `self.onmessage` before the first top-level `await` and queue messages until init ends: messages can arrive while the module still awaits. [tasks · startup · medium] https://html.spec.whatwg.org/multipage/workers.html#run-a-worker
- **TASK-16** Start independent async work together and `await Promise.all([...])` (`allSettled` when one failure must not reject the rest): awaits in a row add up each latency. [network · startup · medium] https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all
- **TASK-17** Keep top-level `await` out of modules that other modules import: export a memoized `init()` and await it once in the entry module, because an awaiting module holds back every module that imports it. [script-load · startup · medium] https://v8.dev/features/top-level-await
- **TASK-18** Wrap worker calls in a small RPC layer (for example Comlink's `expose` and `wrap`) instead of a hand-written protocol, and batch the calls: each call is one message round trip, and every argument and return value is copied unless you wrap large typed arrays in `Comlink.transfer()`. [tasks · INP · low] https://web.dev/articles/off-main-thread
- **TASK-19** Put hot Wasm loops in functions that are called many times (per chunk or per frame), not in one long call: V8 has no on-stack replacement for Wasm, so a running call stays in baseline code. [js · frame · medium] https://v8.dev/blog/wasm-dynamic-tiering
- **TASK-20** Treat Wasm memory as a heap that never shrinks: allocate long-lived buffers once, grow them by doubling up to a set maximum, instead of `malloc` and `free` per message; its peak size stays reserved for the life of the tab. [memory · memory · medium] https://v8.dev/blog/wasm-gc-porting
