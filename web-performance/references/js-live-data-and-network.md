# Live data and network (DATA-)

Open this when you write code that receives or loads data: a WebSocket or SSE feed, a message or subscription handler, the store that live data fills, `fetch()` calls, or a service worker.
Stage cards: `pipeline.md` §H (`network`, `tasks`, `memory`). Frame, task and memory budgets: SKILL.md "Budgets and the chart contract".

## Checklist

| ID | Do this | Impact | First stage |
|---|---|---|---|
| §A | **Feed contract** | | |
| DATA-01 | Write the feed contract (rates, sizes, loss policy, hidden-tab mode) before the code | high | network |
| §B | **Ingest** | | |
| DATA-02 | Transport by direction; server heartbeats; capped, jittered reconnects; resync by sequence | medium | network |
| DATA-03 | Binary or compact payloads; decode in a worker when decoding breaks the frame budget | high | tasks |
| DATA-04 | A cap on every queue between the socket and the UI; conflate state, aggregate events | high | memory |
| §C | **Store** | | |
| DATA-05 | Preallocated typed-array rings; the latest value per key; times as float64 | high | memory |
| §D | **Deliver to the UI** | | |
| DATA-06 | Flush to the UI once per frame; the latest value per key wins | high | tasks |
| DATA-07 | Apply deltas: append or update the last point; never rebuild per message | high | js |
| DATA-08 | Per-message values out of reactive state; batch the consumers that do not draw | high | js |
| §E | **Tabs and lifecycle** | | |
| DATA-09 | One feed connection for all tabs: a SharedWorker, or a Web Locks leader | medium | network |
| DATA-10 | Hidden tab: no UI delivery, a bounded backlog; on return, resync from a snapshot | high | tasks |
| §F | **Degradation** | | |
| DATA-11 | Degrade by a written policy that frame time drives; show the degraded state | high | tasks |
| §G | **`fetch()`** | | |
| DATA-12 | Abort superseded data requests; a late answer never overwrites newer data | medium | network |
| DATA-13 | `priority: 'low'` for background fetches; the default for data the user waits for | medium | network |
| DATA-14 | Stream large responses and parse them in batches; `CompressionStream` for app data | medium | network |
| §H | **Service worker** | | |
| DATA-15 | No service worker on the critical path; capped caches; no cache-first opaque responses | medium | network |
| One-line | **One-line rules** | | |
| DATA-16 | Ask the server to conflate and batch per channel | medium | network |
| DATA-17 | Pick the starting detail level from the device class | medium | tasks |
| DATA-18 | Skip speculative fetches under Save-Data or a slow connection | low | network |
| DATA-19 | Paint cached data first, then replace it in place | medium | network |
| DATA-20 | Register the service worker after `load` | low | network |
| DATA-21 | Precache only the versioned app shell | low | network |

- → EVT-03, EVT-12 pointer input: one rAF per frame; cancel superseded work per user intent
- → TASK-10, TASK-11 one long-lived worker; small messages and transferred buffers
- → LIFE-06, LIFE-07, LIFE-08 hidden tabs, bfcache and freezing: stop work, close sockets, reconnect
- → DOM-04 live rows and log lines: a fixed row set that is updated in place
- → SC-02, SC-04 chart library streams: one `appendRange` per frame into a FIFO series; replace data on the same series
- → GPU-14 no raw epoch-millisecond times in float32

## §A Feed contract

### DATA-01 Write the feed contract before the feed code
stage: network, tasks, memory · metric: frame, INP, memory · when: build, session · impact: high — without rates, sizes and a loss policy, no batch, buffer or cap can be sized, and the code gets tested with 10 messages instead of the peak · support: n/a · also: DATA-04, DATA-10, DATA-11
- Do: Before you write a socket, SSE or polling client, write the contract in the module header or the plan: normal and peak message rate (and burst shape), message size and kind (full snapshot or delta, with a sequence number), the consumers, the maximum staleness per consumer, which messages may be conflated and which must each reach the user, the hidden-tab mode, the resync path, the degradation steps, and the teardown owner. For views with charts, the chart contract in SKILL.md adds its fields to this one.
- Why: Every later choice is a function of these numbers: the flush size (DATA-06), the queue caps (DATA-04), the ring size (peak rate × window, DATA-05), and the degradation trigger (DATA-11). Agents write happy-path code at demo scale by default, and a feed that is fine at 10 messages per second can fill every frame at 500.
- Detect: `rg -l "new (WebSocket|EventSource|SharedWorker)\(|\.subscribe\(" -g '*.{ts,js,tsx,jsx,svelte,vue}' | xargs rg -L -i 'peak|per second|msg/s|contract'`, then read each file: no stated rate, size or loss policy means no contract. Also check that fixtures and tests replay the peak rate.
- Verify: measure.md#fps with `run_scenario` `stream` at the contract's peak rate (the `rate` option), in the default lab profile. Pass: frame-interval p95 and long frames stay inside the SKILL.md budgets, and the queue counters in `window.__perf.counters()` stay under the contract's caps.
- Example:
  ```ts
  /** Feed contract (status feed → dashboard tiles, event log, throughput chart). Rate: 50 msg/s, peak 400
   * in bursts of 40. Size: 32-byte binary deltas with a seq. Staleness: tiles 1 frame, background panels 1 s.
   * Conflate tile state only; log events each reach the user (newest 10,000). Hidden: latest per key, event
   * counts; on return, snapshot + seq. Degrade: background panels to 1/s, chart window 5 → 1 min, hide
   * sparklines, badge. Owner: FeedService, closed by the app's teardown signal. */
  ```
- Avoid: Do not invent the numbers: ask the user or read the server's documentation, and mark each guess as a guess. Keep one contract per feed, not one per consumer. A contract that nobody tests at its peak rate is only a comment: wire the peak into the fixture.
- Source: https://github.com/openai/plugins/blob/main/plugins/build-web-data-visualization/skills/dashboards-and-real-time-visualization/references/performance-and-degradation.md ; https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_long_is_too_long

## §B Ingest

### DATA-02 Pick the transport by direction; add heartbeats and capped, jittered reconnects
stage: network · metric: bytes, memory · when: session · impact: medium — a silently dead socket shows old data as live, and clients that retry in step after an outage overload the server · support: baseline, webtransport · also: DATA-09, DATA-10, LIFE-07
- Do: Use `EventSource` (SSE) for one-way text push: it reconnects by itself and resumes with `Last-Event-ID`. Use a WebSocket for two-way traffic or binary frames, and WebTransport datagrams only for values that the next value replaces, with an HTTP/3 server that you control. Have the server send a heartbeat and treat 2–3 missed beats as a dead link; reconnect after `random(0, min(cap, base × 2 ** attempt))` ms, reset `attempt` after a stable period, resubscribe from the last sequence number, and queue outgoing messages while down or fail them visibly.
- Why: The WebSocket API does not expose ping and pong frames, so a link that a network device dropped can look open with no error; only app messages prove that data still flows. "Full jitter" spreads the reconnects of many clients over the whole delay window (AWS measured the fewest total calls with it); a fixed delay makes all clients retry at the same moment.
- Detect: `rg -n -A6 "addEventListener\(\s*['\"]close|onclose\s*=" -g '*.{ts,js,tsx,jsx,svelte,vue}'`, then check the delay: an immediate `connect()` or a fixed `setTimeout(connect, N)` is the bad case. `rg -l 'new WebSocket\(' -g '*.{ts,js,tsx,jsx,svelte,vue}' | xargs rg -L -i 'heartbeat|lastMessageAt|stale'` finds sockets with no liveness check.
- Verify: measure.md#fps with `stream`; stop the feed server for 30 s, then start it again. Pass: the dev log of attempts (one console line each, read with `list_console_messages`) shows growing, uneven delays, `window.__perf.counters()` shows exactly one open socket after recovery, and the view shows data that is newer than the outage.
- Avoid: Over HTTP/1.1 a browser allows about 6 connections per host for all tabs together, so SSE streams can stall other requests: use HTTP/2 or later, or share one stream (DATA-09). SSE sends UTF-8 text only and cannot set custom headers. Chromium closes open sockets when a page enters the bfcache, so also reconnect from `pageshow` (LIFE-07). Never replay queued actions that have side effects without the user's consent. DevTools network emulation throttles the WebSocket handshake and bandwidth, not each message's round trip: to test latency, add the delay at the server or in a proxy.
- Source: https://websockets.spec.whatwg.org/#ping-and-pong-frames ; https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/

### DATA-03 Use binary or compact payloads; move decoding to a worker when it breaks the frame budget
stage: tasks, js, memory · metric: frame, INP, memory · when: session, render-loop · impact: high — at hundreds of messages per second, `JSON.parse` and one object graph per message fill frames and feed the garbage collector · support: baseline · also: TASK-10, TASK-11, V8-05, DATA-05
- Do: For high-rate channels, send fixed-layout binary records (or at least compact deltas) and keep JSON for low-rate control messages. Set `binaryType = 'arraybuffer'` right after you open the socket, and read records with `DataView` or typed arrays. When decoding costs more than a few ms per frame at peak, open the socket in a module worker, decode there, and post one batch of typed arrays per frame with a transfer list.
- Why: The spec default `binaryType` is `"blob"`, which the browser may spool to disk, and each Blob needs an async read. Fixed records create no object per message, while JSON builds strings and objects that the next minor GC must visit. A transferred `ArrayBuffer` moves to the other thread with no copy.
- Detect: `rg -n -A4 "onmessage|addEventListener\(\s*['\"]message" -g '*.{ts,js,tsx,jsx,svelte,vue}' | rg 'JSON\.parse|\.arrayBuffer\(\)|\.text\(\)'` in main-thread modules; `rg -l 'new WebSocket\(' | xargs rg -L 'binaryType'` for binary feeds; `postMessage\(` of typed arrays with no transfer list.
- Verify: measure.md#fps with `stream` at peak, 5 runs per side. Pass: compare-runs "win" on frame-interval p95, `__wpProbe.loaf.read()` no longer lists the message handler among the top scripts, and "Minor GC" time in the trace-summary window goes down.
- Example: a worker that owns the socket and posts about one batch per frame.
  ```ts
  const CAP = 4096;
  let t = new Float64Array(CAP), v = new Float64Array(CAP), n = 0;
  function flush() {
    if (!n) return;
    postMessage({ n, t, v }, [t.buffer, v.buffer]);   // transfer, no copy: t and v detach here
    t = new Float64Array(CAP); v = new Float64Array(CAP); n = 0;
  }
  const ws = new WebSocket(FEED_URL);
  ws.binaryType = 'arraybuffer';                      // the default 'blob' needs an async read per message
  ws.onmessage = ({ data }) => {                      // 16-byte records: float64 time, float64 value
    const d = new DataView(data as ArrayBuffer);
    for (let o = 0; o + 16 <= d.byteLength; o += 16) { t[n] = d.getFloat64(o, true); v[n] = d.getFloat64(o + 8, true); if (++n === CAP) flush(); }
  };
  setInterval(flush, 16);
  ```
- Avoid: "Binary beats JSON" is a mechanism argument, not a benchmark: measure with your schema. At low rates a worker only adds a hop and code, so keep small feeds on the main thread. At very high rates, send the arrays back after use and reuse them instead of allocating per batch. Small, frequent `postMessage` calls cost more than one batch (TASK-11).
- Source: https://websockets.spec.whatwg.org/#dom-websocket-binarytype ; https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects

### DATA-04 Bound every queue between the socket and the UI: conflate state, aggregate events
stage: memory, tasks · metric: memory, frame · when: session · impact: high — a WebSocket has no receive backpressure, so a busy or hidden page queues messages without limit · support: baseline, websocket-stream · also: DATA-06, DATA-10, DATA-11, LIFE-05
- Do: Give each buffer between the socket and the UI a cap from the contract. For state (the status of a key, a latest reading), keep only the newest value per key. For events that the user must see (log lines, alerts, errors), keep them up to the cap, then count or aggregate the rest and show the count. On the send side, check `bufferedAmount` before you send more. Where support.md allows, `WebSocketStream` lets a slow reader slow the socket; feature-detect it and keep the classic path.
- Why: A classic `WebSocket` fires `message` for each message as fast as it arrives, even while the handler is behind, so an unbounded array grows with the burst and with every second that rAF-based flushing is paused. Conflating by key bounds the buffer by the number of keys, not by time.
- Detect: `rg -n -A6 "onmessage|addEventListener\(\s*['\"]message|\.subscribe\(" -g '*.{ts,js,tsx,jsx,svelte,vue}' | rg '\.push\('`, then check for a cap; `rg -n '\.send\(' -g '*.{ts,js,tsx,jsx}'` in loops or timers with no `bufferedAmount` check.
- Verify: measure.md#mem with `stream` at twice the peak rate for 60 s, then 60 s with the tab hidden. Pass: the queue counters in `window.__perf.counters()` stay at or under their caps, and heap growth after warm-up is within noise.
- Example:
  ```ts
  const latest = new Map<string, Status>(), events: LogLine[] = []; let skipped = 0;
  const EVENT_CAP = 5_000;                           // from the contract: peak rate × longest flush gap
  function onMessage(m: FeedMessage) {
    if (m.kind === 'status') latest.set(m.key, m.status);      // state: the newest value per key wins
    else if (events.length < EVENT_CAP) events.push(m.line);
    else skipped++;                                  // the view shows "N lines skipped" (DATA-11)
    scheduleFlush();                                 // DATA-06 drains both
  }
  ```
- Avoid: Never conflate or drop messages that each carry meaning (acknowledgements, errors, alerts) without showing it. `bufferedAmount` counts only data that `send()` queued. `WebSocketStream` is a Chromium-only, non-standard API. Prefer conflation at the server (DATA-16): it saves bytes and decode time too.
- Source: https://developer.chrome.com/docs/capabilities/web-apis/websocketstream ; https://websockets.spec.whatwg.org/#dom-websocket-bufferedamount

## §C Store

### DATA-05 Keep live series in preallocated typed-array rings, with times as float64 numbers
stage: memory, js · metric: memory, frame · when: session, render-loop · impact: high — one object per point and arrays that only grow make GC work every frame and memory that grows with session length · support: baseline · also: GPU-14, V8-04, LIFE-05, SC-02
- Do: Store numeric series as columns (`Float64Array` for time and value) in a ring buffer sized from the contract (peak rate × window), written in place and never reallocated. Keep state feeds as a `Map` of the latest value per key. Keep times as float64 JS numbers (epoch ms, or ms since an origin); convert them to float32 only at GPU upload, as offsets from a float64 origin (GPU-14). When a chart library keeps its own copy (a FIFO series, SC-02), keep only the pending batch, not a second full copy.
- Why: Typed-array columns hold numbers unboxed in one allocation, so appends allocate nothing and the heap stays flat once the ring is full. An array of `{ t, v }` objects allocates per point, and every survivor makes the next GC copy more. Float32 has 24 significand bits, so current epoch-ms times snap to steps of about two minutes.
- Detect: `rg -n -A6 "onmessage|addEventListener\(\s*['\"]message|\.subscribe\(" -g '*.{ts,js,tsx,jsx,svelte,vue}' | rg '\.push\(\s*\{'`; `rg -n '\.(shift|splice)\(\s*0' -g '*.{ts,js,tsx,jsx}'` on live arrays; `new Float32Array` next to `Date.now|timestamp` (→ GPU-14).
- Verify: measure.md#mem with `stream` for 60 s after the window is full. Pass: the heap is flat after the ring fills, and "Minor GC" time per second in the trace-summary window is lower than the baseline.
- Example:
  ```ts
  class Ring {                                       // fixed size: no allocation per point, no growth
    readonly t: Float64Array; readonly v: Float64Array; head = 0; size = 0;
    constructor(readonly cap: number) { this.t = new Float64Array(cap); this.v = new Float64Array(cap); }
    push(time: number, value: number) {              // time: float64 epoch ms
      this.t[this.head] = time; this.v[this.head] = value;
      this.head = (this.head + 1) % this.cap; this.size = Math.min(this.size + 1, this.cap);
    }
    index(i: number) { return (this.head - this.size + i + this.cap) % this.cap; }  // i = 0: the oldest point
  }
  const lastFiveMinutes = new Ring(400 * 300);       // peak 400/s × 300 s, from the feed contract
  ```
- Avoid: A cap that is too small loses data silently, so size it from the contract and count overwrites. Do not pre-offset times that a chart library stores as float64 itself; append them in the unit that its time axis expects (SC-05). Rings suit append-only series; data that arrives out of order needs a sorted insert or a drop rule from the contract.
- Source: https://v8.dev/blog/trash-talk ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Float64Array

## §D Deliver to the UI

### DATA-06 Flush live data to the UI once per frame; the latest value per key wins
stage: tasks, style, layout, paint · metric: frame, INP · when: render-loop, session · impact: high — messages outnumber frames, and each extra render in a frame costs script, style and layout but shows nothing · support: baseline · also: EVT-03, CNV-01, DOM-04, SC-02, DATA-04
- Do: In message and subscription handlers, only store the data (DATA-04, DATA-05) and request one rAF when none is pending. In that rAF, apply everything that arrived since the last frame as one batch: one DOM pass, one chart call per series, one GPU upload. Parse or format only what the flush draws: for full snapshots, keep the newest raw message and parse it in the flush.
- Why: The screen shows one frame per refresh interval, so at 200 messages per second and 60 Hz about 3 renders run per frame and only the last one reaches the screen. The rest delay input handlers and the next frame. rAF runs right before style and layout, so one batch there costs one layout.
- Detect: `rg -n -A8 "onmessage|addEventListener\(\s*['\"]message|\.subscribe\(" -g '*.{ts,js,tsx,jsx,svelte,vue}' | rg 'render|innerHTML|textContent|setState|\.update\(|appendRange|\.append\(|draw'`, then confirm the call runs per message, not inside a flush.
- Verify: measure.md#fps with `run_scenario` `stream` at peak, 5 runs per side. Pass: compare-runs "win" on frame-interval p95 and long frames per 10 s, LoAF script time in the message handler goes down, and trace-summary counts about one `Layout` per frame in the window.
- Example:
  ```ts
  const pending = new Map<string, Status>();          // the latest value per key
  let queued = false;
  feed.subscribe((m) => {                             // store only: no DOM, no chart call
    pending.set(m.key, m.status);
    if (!queued) { queued = true; requestAnimationFrame(flush); }
  }, { signal });
  function flush() {
    queued = false;
    if (signal.aborted) return;                       // no render after teardown
    for (const [key, s] of pending) tiles.get(key)?.update(s);   // one batch of writes, one layout
    pending.clear();
  }
  ```
- Avoid: rAF pauses in hidden tabs. A keyed `Map` stays bounded, but an append buffer grows, so cap it (DATA-04) and switch to the hidden mode (DATA-10). Deltas with sequence numbers must be applied in order inside the flush, not dropped. Do not throttle with `setTimeout(…, 16)`: it drifts against the display. Keep the model update in the handler when other code reads it between frames; only the UI work waits for the frame.
- Source: https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering ; https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame

### DATA-07 Apply deltas: append or update the last point; never rebuild the dataset per message
stage: js, memory, gpu-upload · metric: frame, memory, INP · when: render-loop, session · impact: high — a rebuild per message costs work and allocation in proportion to the whole dataset instead of the change, and large allocate-then-drop bursts start major GCs · support: baseline · also: SC-02, SC-04, DOM-04, GPU-08, DATA-12
- Do: Send deltas, not snapshots, for high-rate feeds. In the flush, append new points with the library's bulk call, or update the last point in place when the new value belongs to the same bucket (the current minute, the current aggregate). Replace the whole dataset only for a real change of data source, and keep the visible range across that replace. To prepend history, rebuild once, then restore the visible range.
- Why: Re-parsing a snapshot and mapping it to new objects on every message allocates the whole graph each time. The major GC then runs more often and has more to compact, and the renderer re-uploads every point. An append touches only the new points.
- Detect: `rg -n -A8 "onmessage|addEventListener\(\s*['\"]message|\.subscribe\(" -g '*.{ts,js,tsx,jsx,svelte,vue}' | rg 'setData\(|\.clear\(\)|\.map\(|\[\.\.\.'` — a replace, a clear or a spread per message is a candidate.
- Verify: measure.md#fps with `stream`, then measure.md#mem. Pass: script time per update and the "Major GC" count in the trace-summary window go down, and the heap is flat after warm-up.
- Avoid: Deltas need a protocol with sequence numbers: on a gap or a reconnect, load a snapshot and apply only the newer deltas (DATA-10). Full snapshots are fine at low rates (a few per second) and small sizes; conflate them to the newest per frame (DATA-06). A library that copies appended data into its own memory (SC-02) needs no second copy on your side.
- Source: https://v8.dev/blog/trash-talk

### DATA-08 Keep per-message values out of reactive state; batch the consumers that do not draw
stage: js, tasks · metric: frame, INP · when: render-loop, session · impact: high — each reactive write runs dependency tracking and schedules component updates, so writes at message rate run many update passes per frame · support: n/a · also: LIFE-11, EVT-03, DATA-06, EVT-13
- Do: Keep values that change per message or per frame (the latest reading per key, counters, the last value) in plain variables, `Map`s or typed arrays. Expose one reactive signal to the framework (a `$state` counter in Svelte 5, one state value in React), bumped once per frame by the flush (DATA-06), and let components read the plain store then. Run consumers that do not draw (persistence, analytics, alert rules, summaries) on their own slower cadence or in the worker, with batched input.
- Why: A framework cannot know that 200 writes per second will all be overwritten before the next paint. It tracks each write and may re-render on each, so the cost grows with the message rate, not with the frame rate. A version counter turns this into one update per frame.
- Detect: `rg -n -A6 "onmessage|addEventListener\(\s*['\"]message|\.subscribe\(" -g '*.{ts,js,tsx,jsx,svelte,vue}' | rg '\$state|set[A-Z]\w*\(|\.value\s*=|\.set\(|\.update\('`, then check whether the target is reactive framework state.
- Verify: measure.md#fps with `stream`. Pass: frame-interval p95 wins, LoAF shows framework update work once per frame instead of once per message, and a render counter in `window.__perf.counters()` grows by at most one per frame.
- Avoid: Move only high-rate values out: state that changes rarely or that the user edits stays reactive. Large data that you replace as a whole goes in shallow state (LIFE-11). A value that a component reads outside the flush can be one frame old, which is fine for display but not for logic that must see every message.
- Source: https://svelte.dev/docs/svelte/$state ; https://vuejs.org/guide/best-practices/performance.html

## §E Tabs and lifecycle

### DATA-09 Share one feed connection across tabs: a `SharedWorker`, or a Web Locks leader
stage: network, tasks, memory · metric: memory, bytes · when: session · impact: medium — with N tabs open, the server holds N connections and each tab decodes the same feed · support: shared-workers · also: DATA-02, TASK-12, LIFE-08
- Do: When users keep the app open in several tabs, run the connection, the decoding and the cache in a module `SharedWorker`; each tab subscribes through its `port` and gets only the keys it shows. Where `SharedWorker` is missing, let each tab request the same exclusive Web Lock: the holder runs the feed and posts small deltas on a `BroadcastChannel`, and the next tab in the queue takes over when it closes.
- Why: One shared worker instance serves all same-origin tabs, so the feed is received and decoded once. A lock is held until its callback's promise settles, so leadership moves to a waiting tab with no extra code.
- Detect: `rg -n 'new (WebSocket|EventSource)\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'` in window code (not in a worker) of an app that users keep open in several tabs, with no `SharedWorker` or `navigator.locks` in the project.
- Verify: measure.md#mem with the app open in 3 tabs (`new_page` twice). Pass: the feed server or the worker's counter reports 1 connection, `window.__perf.counters()` in each tab shows no socket of its own, and the heap of each extra tab holds no copy of the feed cache.
- Avoid: Do not count on the worker learning that a tab went away: have tabs unsubscribe on `pagehide`, subscribe again on `pageshow`, and drop ports that stop answering. Each `BroadcastChannel` message is cloned into every tab, so send deltas, not state. Do not hold a feed socket in the service worker: the browser stops idle service workers. A shared worker stops when its last tab closes, unless it asks for an extended lifetime (support.md: `shared-workers`). Release Web Locks on `freeze` (LIFE-08).
- Source: https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker ; https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API

### DATA-10 Hidden tab: stop UI delivery and bound the backlog; on return, resync from a snapshot
stage: tasks, memory, network · metric: frame, memory · when: session · impact: high — a hidden tab still receives every message, and a return that replays the backlog one message at a time makes long frames · support: baseline · also: LIFE-06, LIFE-07, LIFE-08, CNV-20, DATA-04
- Do: When the page is hidden, stop UI delivery: keep only the latest value per key, count events instead of storing them, and unsubscribe from channels that only feed visible detail. When it is visible again, buffer new deltas, load a snapshot with its sequence number, replace the store in one step, apply only the buffered deltas that are newer than the snapshot, render once, and then go live. Run the same resync after `pageshow` with `persisted` and after `resume`.
- Why: rAF stops in hidden tabs, but socket messages keep arriving, so a flush that waits for a frame never drains an append buffer. The newest state is all the user needs on return; replaying minutes of messages costs frames and shows nothing new.
- Detect: `rg -l "new (WebSocket|EventSource)\(|\.subscribe\(" -g '*.{ts,js,tsx,jsx,svelte,vue}' | xargs rg -L 'visibilitychange|document\.hidden|visibilityState'`; resync code that loops over queued messages and applies them one by one.
- Verify: measure.md#mem with `stream`, then hide the tab for 90 s (`new_page` in front, then `select_page` back). Pass: the queue counters and the heap stay flat while hidden, and the first frames after the return show current data with no long animation frame from a backlog.
- Example:
  ```ts
  async function resync() {                          // on visible, on `pageshow` with `persisted`, on `resume`
    feed.setMode('buffer');                          // hold new deltas while the snapshot loads
    const snap = await loadSnapshot({ signal });     // full state plus its sequence number
    store.replace(snap.state);                       // one replace and one render, no replay
    feed.drain((d) => d.seq > snap.seq);             // then only the deltas newer than the snapshot
    feed.setMode('live');
  }
  ```
- Avoid: If the product must alert while hidden, keep that one channel live and small. Chromium freezes hidden, CPU-heavy tabs when Energy Saver is on and closes sockets on bfcache entry, so the resync must also run after `resume` and `pageshow` (LIFE-07, LIFE-08). Hidden-tab timers are throttled hard: base liveness on server heartbeats and elapsed `performance.now()` time, not on client timers (LIFE-06).
- Source: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API ; https://developer.chrome.com/blog/freezing-on-energy-saver

## §F Degradation

### DATA-11 Degrade by a written policy that frame time drives, and show the degraded state
stage: tasks, gpu-draw, memory · metric: frame, INP · when: render-loop, session · impact: high — without a policy, frame time grows during bursts until input stalls, or detail disappears with no sign to the user · support: long-animation-frames, compute-pressure · also: DATA-01, CNV-05, CNV-20, CNV-21, SC-10
- Do: Write the steps in order in the feed contract, each one reversible: lower the update rate of background views, aggregate older samples or narrow the window, hide secondary series, lower the canvas DPR, pause off-screen views. Step down when a rolling p95 of rAF intervals (visible tab only) stays over the budget or LoAF `blockingDuration` stays high; `PressureObserver` states `serious` and `critical` are an extra trigger where they exist. Step up with hysteresis and a minimum dwell time, and show a "reduced detail" badge while any step is on.
- Why: Static device rules cannot see a burst, but frame time can. The user must know when a view shows less than all data, or they read a thinned view as the truth.
- Detect: `rg -l "new (WebSocket|EventSource)\(|appendRange|requestAnimationFrame" -g '*.{ts,js,tsx,jsx,svelte,vue}' | xargs rg -L -i 'degrad|reduced detail|stepDown|quality'` finds streaming views with no policy.
- Verify: measure.md#fps with `stream` at twice the peak rate in the default lab profile. Pass: frame-interval p95 comes back under 1.5 × the refresh interval within a few seconds, `take_snapshot` shows the badge, and after the rate drops the steps undo and the badge goes away.
- Example:
  ```ts
  const steps = [backgroundRate(1), windowMinutes(1), hideSecondary(), capDpr(1), pauseOffscreen()];
  let level = 0, changedAt = 0;
  function onFrameStats(p95: number, interval: number, now: number) { // interval: median rAF delta, visible tab only
    if (p95 > interval * 1.5 && level < steps.length) { steps[level++].apply(); changedAt = now; }
    else if (p95 < interval * 1.1 && level > 0 && now - changedAt > 5_000) { steps[--level].undo(); changedAt = now; }
    badge.hidden = level === 0;                       // "Reduced detail" while degraded
  }
  ```
- Avoid: rAF intervals grow when the tab is hidden or throttled: ignore those samples. Derive the thresholds from the measured refresh interval, not from 60 Hz: rAF deltas never fall below the interval, so a step-up test under it never passes. Never degrade messages that each carry meaning. Do not decimate in your code what a chart library already resamples (SC-10). `PressureObserver` is Chromium desktop only: feature-detect it.
- Source: https://w3c.github.io/long-animation-frames/ ; https://developer.mozilla.org/en-US/docs/Web/API/Compute_Pressure_API

## §G `fetch()`

### DATA-12 Abort superseded data requests, and never let a late answer overwrite newer data
stage: network, tasks · metric: INP, frame, bytes · when: interaction, session · impact: medium — stale responses cost download, parse and render work, and a late one can put old data on screen · support: abortsignal-any, abortsignal-timeout · also: EVT-12, LIFE-02, DATA-07
- Do: Keep one `AbortController` per data key (a visible range, a page of results, a panel's refresh) and abort the previous request before you start the next. Give requests a deadline with `AbortSignal.timeout()` combined by `AbortSignal.any()`. Before you apply a response, compare its server version or sequence number with the store's, because a push delta can be newer than a fetch that started first.
- Why: An aborted `fetch` stops the network work and rejects, so its callbacks never parse or render. Arrival order is not data order: a slow range request can finish after a socket delta that already moved the store forward.
- Detect: `rg -n -B4 'fetch\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'` in handlers for pan, zoom, scroll, pagination or refresh with no `signal`; results written to the store with no version or sequence check.
- Verify: measure.md#fps with `run_scenario` `pan` or `zoom` (repeat 10). Pass: `list_network_requests` shows the superseded requests canceled, the screen shows only the last range, and script time in the trace-summary window goes down.
- Avoid: Handle `AbortError` and `TimeoutError` quietly (EVT-12). An abort ends the client work only, so never abort requests that change server state. One global controller cancels unrelated loads: keep one per key.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal ; https://web.dev/articles/optimize-input-delay

### DATA-13 Send background fetches with `priority: 'low'`; keep the default for data the user waits for
stage: network · metric: INP, LCP · when: load, interaction, session · impact: medium — a `fetch()` gets High priority by default, so background requests compete with the one that answers a click · support: fetch-priority · also: MEDIA-02, DATA-18
- Do: Add `priority: 'low'` to prefetches, history backfill, analytics pulls, warm-up requests and data for panels that are not visible. Keep the default for data the user waits for, and use `'high'` only for the one awaited request when many requests compete.
- Why: The browser's request scheduler and the HTTP/2 or HTTP/3 priority signal use this value, so low-priority requests yield bandwidth and connection slots to the request that answers the user.
- Detect: `rg -n 'fetch\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'` in prefetch, backfill, analytics, polling and warm-up code, then check for `priority:`.
- Verify: measure.md#load with the background fetches active. Pass: the `ResourceSendRequest` events in the saved trace (filter them with a script; never read the raw trace) show `Low` priority for the background requests, and the median time of the awaited request, or LCP, wins or stays neutral.
- Avoid: It is a relative hint: with no contention it changes nothing, and marking every request high cancels it. Do not lower requests that the user waits for.
- Source: https://web.dev/articles/fetch-priority ; https://developer.mozilla.org/en-US/docs/Web/API/RequestInit

### DATA-14 Stream large responses and parse them in batches; compress app data natively
stage: network, js, memory · metric: memory, INP, bytes · when: load, interaction · impact: medium — the first rows show before the download ends, peak memory stays near one chunk, and no compression library ships · support: baseline · also: DATA-03, DATA-06, TASK-03
- Do: For large or long responses (exports, history, log tails), read `response.body` as a stream: decode with `TextDecoderStream`, split NDJSON lines, and hand rows to the UI in batches with a yield between batches. Compress and decompress app-level data (snapshots saved to IndexedDB, large uploads) with `CompressionStream` and `DecompressionStream` instead of a JS library.
- Why: A pipe carries backpressure from the reader to the network, and each chunk is freed after use, while `await res.json()` holds the whole body and parses it in one long task. The built-in codecs cost no bundle bytes.
- Detect: `rg -n 'await (res|response)\.(json|text)\(\)' -g '*.{ts,js,tsx,jsx}'` on export, history or log endpoints; `rg -n "from ['\"](pako|fflate)" -g '*.{ts,js,tsx,jsx}'`; `\.tee\(\)|\.clone\(\)` on large bodies.
- Verify: measure.md#inp on the action that loads the data (measure.md#load for page data). Pass: the first rows show before the download ends, `__wpProbe.loaf.read()` has no long frame from one big `JSON.parse`, and the peak heap in `__wpProbe.memory.sample()` goes down.
- Avoid: A single JSON array cannot be parsed in parts: ask the server for NDJSON or pages. Very small chunks make many microtasks, so batch rows before UI work. `tee()` and `clone()` buffer whatever the slower branch has not read. HTTP compression already covers the network: do not compress twice. Use `gzip`, `deflate` or `deflate-raw`; the other formats are not in Chromium (support.md: `compression-streams`).
- Source: https://web.dev/articles/streams ; https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API

## §H Service worker

### DATA-15 Keep the service worker off the critical path, and cap what it caches
stage: network, memory · metric: TTFB, LCP, memory · when: load, session · impact: medium — every request that a fetch handler intercepts waits for the worker to start first · support: service-workers-static-routes · also: DATA-13, DATA-20, DATA-21, LIFE-09
- Do: Add a `fetch` handler only when it does real work. Send pass-through traffic (API calls, POSTs, streams) to the network with static routes (`event.addRoutes()` in `install`). Enable navigation preload only when navigations go to the network, and then always use `event.preloadResponse`. Choose one strategy per request class: network-only for live and account data, stale-while-revalidate for lists, cache-first for hashed assets and the versioned shell. Give each runtime cache its own name and an entry and age cap, and request cross-origin assets in CORS mode before you cache them.
- Why: web.dev measured service worker startup at about 50 ms on desktop and about 250 ms on mobile, and more in bad cases. Static routes let the browser answer without starting the worker, and navigation preload starts the request while the worker starts. An opaque response hides its status, so an error can stay cached for good.
- Detect: `rg -n "addEventListener\(\s*['\"]fetch" -g '*{sw,service-worker,worker}*.{js,ts}'` with a handler that often returns without `respondWith`; `navigationPreload.enable` with no `preloadResponse`; `caches.open\(|new (CacheFirst|StaleWhileRevalidate)\(` with no expiration; `mode: 'no-cors'`.
- Verify: measure.md#load warm (service worker installed), 5 runs per side. Pass: the TTFB and LCP medians win or stay neutral, and the server log shows one request per navigation, not two.
- Avoid: Navigation preload with cache-first navigations only adds a request, and `fetch(event.request)` after you enable it requests each navigation twice. Keep `install` and `activate` short: fetch events wait while activation runs. Chromium pads each cached opaque response by a random 0 to about 14 MiB of quota. Browsers evict whole origins in least-recently-used order, and caches share the origin quota with IndexedDB and OPFS. Never serve cached live or account data as live: label it. Feature-detect `addRoutes` when support.md puts it above the Chromium floor.
- Source: https://web.dev/blog/navigation-preload ; https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes

## One-line rules

- **DATA-16** Ask the server to conflate and batch per channel: the latest state every few hundred ms for background views and once per frame for the focused one, many keys per message; conflate only state, never messages that each carry meaning. It saves bytes, decode time and GC together. [network · bytes, frame · medium] https://websockets.spec.whatwg.org/
- **DATA-17** Pick the starting detail level once at startup from the device class (`navigator.deviceMemory`, `hardwareConcurrency`, and `navigator.cpuPerformance` where it exists), treat missing values as mid-range, and let DATA-11 adjust from there (support.md: `device-memory`, `cpu-performance`). [tasks · frame · medium] https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
- **DATA-18** Skip speculative fetches (prefetch, history backfill, warm-up) when `navigator.connection.saveData` is true or `effectiveType` is `slow-2g`, `2g` or `3g`, and listen for `change`; the code must also work when `connection` is missing (support.md: `save-data`). [network · bytes · low] https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation/saveData
- **DATA-19** Paint cached data first while the network request runs: start both reads at once, show the cache only if the network has not answered, replace it in place (no layout shift), and label it stale until then; a flag keeps the cache answer from overwriting newer network data. [network · LCP, CLS · medium] https://web.dev/articles/offline-cookbook
- **DATA-20** Register the service worker after the `load` event, so its install downloads do not compete with the first load. [network · LCP · low] https://web.dev/articles/service-workers-registration
- **DATA-21** Precache only the versioned app shell, from a build manifest that gives each entry a revision (hashed URLs need none); never precache image sets, icon sets, polyfills or data. [network · bytes · low] https://developer.chrome.com/docs/workbox/modules/workbox-precaching
