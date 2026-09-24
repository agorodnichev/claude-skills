# Lifecycle, memory and long sessions (LIFE-)

Open this when you write mount and unmount code, subscriptions, observers, caches, storage, hidden-tab or back/forward handling, or state that holds large or fast data, in an app that stays open for hours.
Stage cards: `pipeline.md` §H (`memory`, `tasks`, `network`). The leak recipe and the memory pass conditions: measure.md#mem.

## Checklist

| ID | Do this | Impact | First stage |
|---|---|---|---|
| §A | **Ownership and teardown** | | |
| LIFE-01 | One teardown `AbortSignal` per owner releases every listener, timer, observer and subscription | high | memory |
| LIFE-02 | A new controller per call for methods that run many times; abort the previous call | high | memory |
| LIFE-03 | Tear down in order: stop producers, release resources, then drop references | medium | memory |
| LIFE-04 | Pooled items own their cleanup; tests fail when live counters do not return to zero | medium | memory |
| §B | **Bounded growth** | | |
| LIFE-05 | A cap and eviction on every cache, `Map` and log; `WeakMap` for per-object data | high | memory |
| §C | **Hidden, background, back/forward** | | |
| LIFE-06 | Hidden: stop polls and timers, save state; visible: resync, then render once | high | tasks |
| LIFE-07 | bfcache: no `unload`; close connections on `pagehide`, reconnect on `pageshow` | high | network |
| LIFE-08 | Handle `freeze`, `resume` and discarded tabs | medium | memory |
| §D | **Storage** | | |
| LIFE-09 | `localStorage` off hot paths; batched IndexedDB; big files in a worker; quota checked | medium | tasks |
| §E | **Proving no leaks** | | |
| LIFE-10 | Prove a leak and its fix by slope over N repetitions, not by one snapshot pair | high | memory |
| §F | **Reactive state** | | |
| LIFE-11 | Large replaced data in shallow state; derive values; engines in mount hooks | medium | js |
| One-line | **One-line rules** | | |
| LIFE-12 | Clear the User Timing and Resource Timing buffers | medium | memory |
| LIFE-13 | Do not log live objects per update or in production | low | memory |
| LIFE-14 | Register page-wide observers once per document | medium | memory |
| LIFE-15 | Revoke object URLs; close frames, ports, workers and idle databases | medium | memory |
| LIFE-16 | Create long-lived callbacks in scopes that hold no large data | medium | memory |
| LIFE-17 | Report bfcache misses and restores in field data | low | network |

- → CNV-02, CNV-24 render loops cancel on teardown; release the canvases and bitmaps of a destroyed surface
- → CNV-20 pause surfaces while the tab is hidden or the surface is off-screen
- → DATA-09, DATA-10 one feed connection for all tabs; feed delivery while hidden, and the resync
- → GPU-30, SC-28 GPU resources and chart surfaces on destroy
- → EVT-05, EVT-12 drag listeners end with the drag; cancel superseded work
- → TASK-09 no timers for visuals or polling; timers in background tabs

## §A Ownership and teardown

### LIFE-01 Give each owner one teardown `AbortSignal` for listeners, timers, observers and feeds
stage: memory, tasks · metric: memory, INP · when: session · impact: high — a listener, timer or observer that outlives its view keeps the view and everything it captures alive, and it keeps running · support: baseline · also: LIFE-03, LIFE-15, EVT-05, CNV-24, GPU-30
- Do: Create one `AbortController` per component, view, panel or service instance. Pass its signal to every `addEventListener()` and `fetch()`; for APIs with no signal option (timers, observers, rAF, subscriptions, sockets, workers), register the release on the signal's `abort` event where you create the resource. Call `delete()`, `destroy()` or `close()` for native, GPU, Wasm and chart objects from the same teardown, and let unmount call `abort()` once.
- Why: An event target holds its listeners strongly, and a listener's closure holds its component and everything that it captures. So a listener on `window`, `document`, a socket or a shared store keeps a closed view alive for the whole session and still runs on every event. The JS garbage collector does not see Wasm or GPU memory, so only an explicit call frees it.
- Detect: `rg -n '(window|document|self)\.addEventListener\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'` with no `signal` and no matching `removeEventListener`; `rg -n 'setInterval\(|new (Resize|Intersection|Mutation|Performance)Observer\(|\.subscribe\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'` in components whose cleanup (`onDestroy`, an effect's returned function, `disconnectedCallback`, `dispose()`) does not release them.
- Verify: measure.md#mem with the view opened and closed 10 times. Pass: DOM nodes, canvases and the app counters (listeners, timers, subscriptions, surfaces) in `__wpProbe.memory.sample()` return to baseline, and the snapshot compare shows no retained instance of the closed view.
- Example:
  ```ts
  export function mountSidePanel(el: HTMLElement, feed: Feed) {
    const life = new AbortController(), { signal } = life;
    const onEnd = (release: () => void) => signal.addEventListener('abort', release, { once: true });
    window.addEventListener('resize', relayout, { signal });             // native signal support
    const ro = new ResizeObserver(relayout); ro.observe(el); onEnd(() => ro.disconnect());
    const timer = setInterval(refreshStatus, 30_000); onEnd(() => clearInterval(timer));
    onEnd(feed.subscribe(render));                                       // subscribe() returns its unsubscribe
    const chart = createChart(el); onEnd(() => chart.destroy());         // memory the GC cannot see
    return () => life.abort();                                           // unmount calls this once
  }
  ```
- Avoid: `removeEventListener()` needs the same function and the same capture flag, so an inline arrow never matches; the signal removes this leak. Give a request that must finish after unmount (a save) its own signal. An aborted signal stays aborted: a view that mounts again needs a new controller. Make each release safe to run twice.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener ; https://v8.dev/features/weak-references

### LIFE-02 Give methods that run many times a new controller per call, and abort the previous call
stage: memory, tasks · metric: memory, INP · when: interaction, session · impact: high — per-call listeners on the owner's signal pile up until unmount, and each one runs on every event · support: baseline, abortsignal-any · also: LIFE-01, EVT-12
- Do: When a method that runs many times (`show()`, `setData()`, `connect()`, a render function) adds listeners, timers or subscriptions, create an `AbortController` per call, abort the previous call's controller first, and combine it with the owner's signal through `AbortSignal.any()`. Do not register per-call work on the owner's lifetime signal.
- Why: The owner's signal fires only at unmount. Per-call listeners on it add one more listener with each call, and all of them run on every event until the view closes. The VS Code team's leak audit names this pattern and this fix.
- Detect: `rg -n -B8 'addEventListener\(|\.subscribe\(|setInterval\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'`, then read the methods other than the constructor and the mount function: each call must remove what the previous call added.
- Verify: measure.md#mem with the method called 20 times (open and close the panel, or switch the data set). Pass: the listener and subscription counters in `window.__perf.counters()` stay flat, and do not grow by one per call.
- Example:
  ```ts
  class DetailPanel {
    #life = new AbortController();                     // the owner: aborted in dispose()
    #call: AbortController | null = null;              // the current call: aborted by the next call
    show(item: Item) {
      this.#call?.abort(); this.#call = new AbortController();
      const signal = AbortSignal.any([this.#call.signal, this.#life.signal]);
      document.addEventListener('keydown', (e) => this.onKey(e, item), { signal });  // shortcuts for this item
    }
    dispose() { this.#life.abort(); }
  }
  ```
- Avoid: "Per call" means per call that registers things, not per event: a controller per `pointermove` only makes garbage. If support.md puts `AbortSignal.any()` above the Chromium floor, abort the call controller from the owner's `abort` event instead.
- Source: https://github.com/microsoft/vscode/blob/main/.github/skills/memory-leak-audit/SKILL.md ; https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static

### LIFE-03 Tear down in order: stop producers, release resources, then drop references
stage: memory, tasks · metric: memory, frame · when: session · impact: medium — a queued callback that runs after release draws with deleted objects, throws, or re-creates what teardown freed · support: baseline · also: LIFE-01, CNV-02, GPU-30, SC-28
- Do: In one idempotent `dispose()`, first stop what produces work: cancel rAF, abort the signal (listeners, observers, subscriptions) and stop worker jobs. Then release resources: native, GPU, Wasm and chart objects, workers, ports, object URLs. Then drop references: null the fields that hold large data and remove the owner from registries. Listen for one-time lifecycle events (`load`, a "ready" event) with `{ once: true }`, so the listener does not stay for the session.
- Why: Callbacks that are already queued (a rAF, a message, an observer entry) can run after release starts. If they still reach the objects, they draw with a deleted buffer or start a loop again. Dropping references last lets the garbage collector take the whole graph at once.
- Detect: `rg -n -A12 'dispose\(\)|destroy\(\)|onDestroy|disconnectedCallback' -g '*.{ts,js,tsx,jsx,svelte,vue}'`, then check the order: `delete()` or `destroy()` before `cancelAnimationFrame()` or before the abort is a candidate; so is async setup with no disposed check after each `await`.
- Verify: measure.md#mem: mount and unmount 10 times while `stream` runs. Pass: `list_console_messages` shows no errors from callbacks after teardown, and the counts return to baseline.
- Avoid: Async setup can finish after unmount: check a disposed flag after each `await`, and release what setup created (SC-28). If bulk GPU deletes make a long frame, spread them over frames (GPU-30). Do not await slow work inside `dispose()`: the next view waits for it.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/AbortController ; https://github.com/cazala/webgpu-skill

### LIFE-04 Give pooled items their own cleanup, and make tests fail when live counters stay up
stage: memory · metric: memory · when: session, build · impact: medium — a pool lives for the session, so item listeners registered on it are never freed, and a leak fixed without a test comes back · support: n/a · also: LIFE-01, LIFE-10, DOM-02
- Do: When items are reused (virtualized rows, pooled tooltips, a worker pool, dashboard panes), give each item its own controller or disposer, and release what its last use registered before the next use. In dev and test builds, count live listeners, timers, sockets and surfaces, expose them through the `counters()` of the perf hooks adapter (assets/perf-hooks.dev.ts), and in tests mount and unmount N times and assert that they return to the start value.
- Why: Cleanup that belongs to the pool runs only when the pool dies, so every reuse adds to it. Counters are exact where heap sizes are noisy, so a unit test can fail on the change that adds a leak. The VS Code team makes its tests fail on leaked disposables.
- Detect: `rg -n 'acquire\(|release\(|recycle|reuse' -g '*.{ts,js,tsx,jsx}'`, then check that `release()` removes what `acquire()` or `bind()` added; test files that mount components but never assert after unmount.
- Verify: measure.md#mem with a scroll over the whole list (rows reused) or 100 uses of the pool. Pass: the listener counters stay at the pool size, not at pool size × uses.
- Example:
  ```ts
  export const live = { listeners: 0, timers: 0, sockets: 0 };        // read by counters() in the perf hooks adapter
  export function track(kind: keyof typeof live, signal: AbortSignal) {
    live[kind]++; signal.addEventListener('abort', () => live[kind]--, { once: true });
  }
  // Test: for (let i = 0; i < 20; i++) mount(host)(); expect(live).toEqual({ listeners: 0, timers: 0, sockets: 0 });
  ```
- Avoid: Keep the counters out of hot paths, or count only in dev and test builds. Heap-size asserts in unit tests are flaky: use counters there, and the slope (LIFE-10) in browser tests.
- Source: https://github.com/microsoft/vscode/blob/main/.github/skills/memory-leak-audit/SKILL.md

## §B Bounded growth

### LIFE-05 Cap every cache, `Map` and log that grows with time; key per-object data with `WeakMap`
stage: memory, js · metric: memory · when: session · impact: high — a store with no cap grows with session length until the tab slows down or crashes · support: baseline · also: LIFE-10, LIFE-12, DATA-05
- Do: Give every cache, `Map`, `Set`, array log, undo history and client store that grows with use a cap and an eviction rule: LRU by count or by age, or a ring buffer for time series (DATA-05). Store data about objects you do not own (DOM elements, library objects) in a `WeakMap` keyed by the object, and never keep removed elements in arrays, maps, closures or module state. Use `WeakRef` only for entries that you can compute again, and call `deref()` once per task.
- Why: Anything reachable from a root stays alive. A `Map` keyed by elements keeps each removed element and its whole detached subtree; a `WeakMap` keeps a value only while its key is alive. Garbage-collection timing is not specified, so a `WeakRef` target can go at any time, and a `FinalizationRegistry` callback can run late or never.
- Detect: `rg -n 'new (Map|Set)\(|: (Map|Set)<' -g '*.{ts,js,tsx,jsx,svelte,vue}'` at module or class level, then check for `delete`, a size check or eviction; `Map<(HTML)?Element` and `Map<Node`; arrays that only `push`; `new WeakRef(` or `FinalizationRegistry` used for required cleanup.
- Verify: measure.md#mem with the action that fills the store repeated 10 times. Pass: after warm-up, heap growth per action is within noise, and the snapshot compare shows no growing `Map` or array and no detached elements retained by the store.
- Avoid: A cap that is too small turns the cache into a miss on each use: size it from the data contract. Do not make a cache weak only to skip sizing it. Required cleanup is explicit (LIFE-01); a finalizer is at most a backstop that reports a missed release, and its held value must not reference the target.
- Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakRef ; https://developer.chrome.com/docs/devtools/memory-problems

## §C Hidden, background, back/forward

### LIFE-06 On hidden, stop polls and timers and save state; on visible, resync and render once
stage: tasks, network, memory · metric: memory, frame, INP · when: session · impact: high — an always-open tab keeps timers, polls and feed handling busy for hours in the background, and a return that replays the backlog makes long frames · support: baseline · also: CNV-20, DATA-10, LIFE-07, TASK-09
- Do: Handle `visibilitychange` in one place per app. On hidden, stop the polls and timers that serve the view, pause surfaces (CNV-20), switch the feed to what must still run (DATA-10), save view state and flush telemetry (LIFE-07). On visible, take a fresh snapshot, render once from it, then restart polls and loops; do not replay the missed updates one by one.
- Why: rAF stops in hidden tabs, but timers, sockets and promise callbacks keep running. About 10 s after the tab hides, Chromium aligns timers to 1 s wake-ups; after about 1 minute, chained timers wake at most once per minute, also with an open WebSocket. With Energy Saver on, Chromium can freeze a CPU-heavy tab that stays hidden for 5 minutes (LIFE-08). The change to hidden is the last event that fires reliably before a discard or a close.
- Detect: `rg -l 'setInterval\(|setTimeout\(' -g '*.{ts,js,tsx,jsx,svelte,vue}' | xargs rg -L 'visibilitychange|document\.hidden|visibilityState'`; heartbeats, countdowns or session timeouts that client timers drive.
- Verify: measure.md#fps with `stream`, then hide the tab for 90 s (`new_page` in front, then `select_page` with `bringToFront`). Pass: the poll and draw counters in `window.__perf.counters()` stay flat while hidden, and the first frame after return shows current data with no long animation frame from a backlog.
- Example:
  ```ts
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { poller.stop(); surfaces.pauseAll(); feed.setMode('essential'); saveViewState(); flushTelemetry(); }
    else { feed.setMode('full'); feed.snapshot().then((s) => { store.replace(s); surfaces.resumeAll(); poller.start(); }); }
  }, { signal });
  ```
- Avoid: Do not drive heartbeats, countdowns or retry deadlines from timers in a hidden tab: they drift by up to a minute. Compute elapsed time from `performance.now()` or server time when the timer fires and on return, and keep liveness checks in the protocol. A page can start hidden, so read `document.visibilityState` at startup. Hiding an element or an iframe with CSS does not change the visibility state.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API ; https://developer.chrome.com/blog/freezing-on-energy-saver

### LIFE-07 Keep pages bfcache-ready: no `unload`; close connections on `pagehide`, reopen on `pageshow`
stage: network, memory · metric: LCP, CLS, INP · when: session, load · impact: high — a back/forward restore skips network, parsing and startup, and a restored page that does not reconnect shows stale data · support: baseline, fetch-later, not-restored-reasons, permissions-policy-unload · also: LIFE-06, LIFE-17, DATA-10, EVT-13
- Do: Never add `unload` listeners: use `pagehide` and `visibilitychange`, and send `Permissions-Policy: unload=()` so that third-party code cannot add one. In `pagehide`, close sockets, IndexedDB connections and `BroadcastChannel`s and abort in-flight requests; in `pageshow` with `event.persisted`, reconnect once and refresh time-sensitive data and auth state. Add `beforeunload` only while there are unsaved changes. Send end-of-session data on hidden with `navigator.sendBeacon()` or `fetch(url, { keepalive: true })`, or queue it with `fetchLater()`.
- Why: The bfcache keeps the page in memory and shows it again with no network, parse or startup work. Chromium is turning off `unload` handlers by default (support.md §C), so state flushed there can be lost. Chromium also disconnects open WebSockets when the page enters the bfcache, and the page then gets `error` and `close`, so it must reconnect on `pageshow` in any case. The main frame is cached with its iframes, so one blocking iframe blocks the page.
- Detect: `rg -n "addEventListener\(\s*['\"](unload|beforeunload)|on(before)?unload\s*=" -g '*.{ts,js,tsx,jsx,svelte,vue,html}'`; `rg -l 'new (WebSocket|EventSource|BroadcastChannel)\(|indexedDB\.open\(' -g '*.{ts,js,tsx,jsx,svelte,vue}' | xargs rg -L 'pagehide'`; `no-store` in the headers of app HTML.
- Verify: measure.md#load, then a round trip: `evaluate_script` sets `window.__bf = 1`, `navigate_page` goes to another URL, then `navigate_page` with `type: "back"`. Pass: `window.__bf` is still 1 (the page came from the bfcache) and the feed reconnected once; on a miss, `performance.getEntriesByType('navigation')[0].notRestoredReasons` names the blocker.
- Example:
  ```ts
  let socket: WebSocket | null = null;
  const connect = () => { socket ??= openFeed(() => { socket = null; }); };  // the callback runs on close
  addEventListener('pageshow', (e) => { connect(); if (e.persisted) refreshSnapshot(); });
  addEventListener('pagehide', () => { socket?.close(1000); socket = null; db?.close(); db = null; });
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') navigator.sendBeacon('/telemetry', JSON.stringify(drainQueue()));
  });
  ```
- Avoid: Keep `Cache-Control: no-store` for HTML with sensitive data and use `private, no-cache` otherwise: on a `no-store` page, any WebSocket use blocks the bfcache, even after close. Do not opt back in with `Permissions-Policy: unload=(self)`. All in-flight `keepalive` bodies share 64 KiB, so batch small payloads. `fetchLater()` sends the body given at call time: abort and queue it again when the data changes, and feature-detect it when support.md puts it above the Chromium floor. Route changes inside a SPA do not use the bfcache.
- Source: https://web.dev/articles/bfcache ; https://developer.chrome.com/docs/web-platform/deprecating-unload

- **LIFE-08** Handle the Chromium page lifecycle: on `freeze`, close IndexedDB, `BroadcastChannel` and WebRTC connections, release Web Locks and save view state to `sessionStorage`; on `resume`, reconnect; at startup, restore the saved view when `document.wasDiscarded` is true. A frozen page runs no JavaScript, socket messages included, and Energy Saver freezes CPU-heavy tabs that stay hidden (support.md: `page-lifecycle`). [memory, network · memory · medium] https://developer.chrome.com/docs/web-platform/page-lifecycle-api

## §D Storage

### LIFE-09 Keep storage off hot paths: `localStorage` read once, batched IndexedDB, OPFS in a worker
stage: tasks, memory · metric: INP, frame, memory · when: interaction, session · impact: medium — Web Storage is synchronous and IndexedDB clones each object on the calling thread, so both land in input handlers and frames · support: baseline, indexeddb-getallrecords · also: EVT-13, LIFE-07, TASK-10
- Do: Read small settings from `localStorage` once at startup into memory, and write them back rarely and after the frame, never per change or per update. Keep larger or structured data in IndexedDB as small records: write only changed records, many puts in one transaction, and read pages with `getAll(range, count)` or `getAllRecords()` instead of cursors. Do heavy IndexedDB work and large binary files (OPFS `createSyncAccessHandle()`) in a worker. Before bulk writes, check `navigator.storage.estimate()`, handle `QuotaExceededError`, and call `navigator.storage.persist()` for data that the user cannot fetch again.
- Why: `localStorage` blocks the main thread and holds only strings, up to about 5 MiB per origin. IndexedDB makes a structured clone of each stored object on the calling thread, so one large object is one long task. Chromium runs IndexedDB transactions with relaxed durability by default, which is much faster than strict. Under storage pressure the browser evicts a best-effort origin as a whole, and IndexedDB, Cache Storage and OPFS share one quota.
- Detect: `rg -n 'localStorage\.(setItem|getItem)|sessionStorage\.setItem' -g '*.{ts,js,tsx,jsx,svelte,vue}'` in handlers, effects, subscriptions or render code; `\.transaction\(` inside loops; `openCursor\(` for paged reads; `put\(` of the whole app state.
- Verify: measure.md#inp on the interaction that saves (measure.md#fps with `stream` when state is saved per update). Pass: `__wpProbe.loaf.read()` no longer lists storage calls or `JSON.stringify` in the top scripts of the frame, and the processing subpart wins.
- Avoid: Relaxed durability can lose the last writes on an OS crash: ask for `{ durability: 'strict' }` only for data that must survive a power loss. One huge `getAll()` spikes memory: read in pages. A sync access handle locks its file by default. `estimate()` values are approximate. `localStorage` has its own limit, apart from the origin quota.
- Source: https://web.dev/articles/indexeddb-best-practices-app-state ; https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria

## §E Proving no leaks

### LIFE-10 Prove a leak and its fix by slope over N repetitions, not by one pair of snapshots
stage: memory · metric: memory · when: session, build · impact: high — one snapshot pair cannot tell a leak from a warm cache, so a leak claim or a fix without a slope is a guess · support: measure-memory · also: LIFE-04, LIFE-05, LIFE-01
- Do: Warm up twice, then repeat the suspect action (open and close a panel, switch the data set, mount and unmount a chart) 10–20 times, force a GC after each, and sample the JS heap, DOM nodes, canvases and app counters. Fit a line: growth per repetition above noise is a leak, and counts must return to baseline. Then find the retainer with a snapshot compare and retaining paths (measure.md#mem). In browser tests, force GC with the CDP command `HeapProfiler.collectGarbage`; in the field, sample `performance.measureUserAgentSpecificMemory()` on cross-origin-isolated pages, never `performance.memory`.
- Why: A heap snapshot forces a full GC, so growth between snapshots is retained memory, but one pair also holds warm caches and lazy setup. A slope over many repetitions separates the cost per action from one-time cost. `measureUserAgentSpecificMemory()` counts the JS and DOM memory of the page, its iframes and its workers; `performance.memory` is deprecated and non-standard, and it counts the JS heap only.
- Detect: `rg -n 'performance\.memory' -g '*.{ts,js,tsx,jsx,svelte,vue}'`; a leak fix claimed from one snapshot or one heap reading; long-lived views with no mount and unmount test (LIFE-04).
- Verify: measure.md#mem. Pass: S1→S2 growth per action is within noise, counts return to baseline, and no detached DOM or canvas of the closed view remains.
- Example:
  ```ts
  // Samples taken after each repetition and a forced GC; drop the 2 warm-up samples first
  function slope(ys: number[]) {                        // units per repetition: bytes, nodes, listeners
    const n = ys.length, mx = (n - 1) / 2, my = ys.reduce((a, y) => a + y, 0) / n;
    let num = 0, den = 0;
    ys.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
    return num / den;
  }
  ```
- Avoid: Detached DOM can be an intended cache (a view that comes back soon): ask the user before you remove the reference. Wasm linear memory never shrinks and shows as one buffer in snapshots, so read the library's own memory counter. Never take snapshots or force GC inside a performance trace. `measureUserAgentSpecificMemory()` can wait up to 20 s and then forces a GC: sample it rarely, at random times.
- Source: https://web.dev/articles/monitor-total-page-memory-usage ; https://github.com/microsoft/vscode/blob/main/.github/skills/memory-leak-audit/SKILL.md

## §F Reactive state

### LIFE-11 Put large replaced data in shallow state, derive values, and create engines in mount hooks
stage: js, memory · metric: INP, frame, memory · when: interaction, render-loop, session · impact: medium — deep proxies on large arrays cost time and memory per item, and an engine created in a block that re-runs leaks one instance per run · support: n/a · also: DATA-08, LIFE-01, LIFE-03
- Do: Keep large data that you replace as a whole (responses, data batches, point arrays) in shallow state: Svelte `$state.raw`, Vue `shallowRef`, or a plain field plus a version counter. Compute values with derived state (`$derived`, `computed`, a memo), not by assigning state inside an effect. Create chart, map or editor engines once in the mount hook, destroy them in its cleanup, and pass changing inputs through a separate update call.
- Why: A deep reactive proxy wraps nested objects and tracks each read, which costs CPU and memory per item and gains nothing when the whole array is replaced. State assigned inside an effect starts a second update pass and can loop. A reactive block runs again when any value that it reads changes, so an engine created there is created again while the old one stays alive.
- Detect: `rg -n '\$state\(|\b(ref|reactive)\(' -g '*.{svelte,vue,ts}'` on arrays or large objects that are replaced; `rg -n -A6 '\$effect\(|watchEffect\(|useEffect\(' -g '*.{svelte,vue,ts,tsx}'` whose body assigns state, or creates an engine (`new `, `create(`) with no returned cleanup.
- Verify: measure.md#fps with `stream` (or measure.md#inp with a data-set switch), then measure.md#mem with the view mounted 10 times. Pass: script time per update wins, and the engine counter stays at one per mounted view.
- Example:
  ```svelte
  <script lang="ts">
    let rows = $state.raw<Row[]>([]);                      // replaced per batch, never mutated
    const visible = $derived(rows.filter(isVisible));       // derived, not assigned in an effect
    function chart(node: HTMLElement) {                     // attachment: runs once per mount
      const c = createChart(node); $effect(() => c.setData(visible)); return () => c.destroy();
    }
  </script>
  <div {@attach chart}></div>
  ```
- Avoid: Shallow state does not react to mutation in place: replace the array or bump the version. Keep values that change per frame or per message out of reactive state entirely (DATA-08). Give libraries that cannot take proxies a plain copy (`$state.snapshot()`, `toRaw()`).
- Source: https://svelte.dev/docs/svelte/$state ; https://vuejs.org/guide/best-practices/performance.html

## One-line rules

- **LIFE-12** In sessions that last hours, read performance entries with a `PerformanceObserver`, then call `performance.clearMarks()` and `clearMeasures()` by name and `performance.clearResourceTimings()`: the mark and measure buffers have no limit. Do not mark per update in production. [memory · memory · medium] https://w3c.github.io/timing-entrytypes-registry/
- **LIFE-13** Do not `console.log` live objects (DOM nodes, large arrays, chart objects) per update or in production builds, and clear the console before a leak hunt: the console keeps logged objects reachable, and a heap snapshot shows them as retained by the console. [memory · memory · low] https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots
- **LIFE-14** Register page-wide observers (web-vitals `onINP()` and `onCLS()`, a `PerformanceObserver`, listeners on `window`) once per document in the startup module, not per mount or per route: each registration lives as long as the page. [memory, tasks · memory, INP · medium] https://github.com/GoogleChrome/web-vitals
- **LIFE-15** Release what the garbage collector frees late or never: `URL.revokeObjectURL()` once the object URL is used, `close()` on each `VideoFrame`, `port.close()` and `worker.terminate()` for idle ports and workers, `db.close()` for idle IndexedDB connections; canvases and bitmaps: CNV-24. [memory · memory · medium] https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static
- **LIFE-16** Create listeners, timers and subscriptions that outlive a function in a small separate function that gets only the values it needs: in V8, closures created in one scope share its captured variables, so a small listener can keep a large sibling capture alive. [memory · memory · medium] https://v8.dev/features/weak-references
- **LIFE-17** In field data, report `notRestoredReasons` from the navigation entry of back/forward loads that missed the bfcache, and count restores (`pageshow` with `persisted`, or the web-vitals `back-forward-cache` navigation type) as their own navigation type (support.md: `not-restored-reasons`). [network · LCP, INP, CLS · low] https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Monitoring_bfcache_blocking_reasons
