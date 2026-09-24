# Web APIs that help performance (or hurt it when misused)

Scope: browser Web APIs (MDN) that change how app code is written: workers and messaging, shared memory and cross-origin isolation, OffscreenCanvas and image decode, observers, page visibility / lifecycle / bfcache, fetch control, streams and compression, storage, memory hygiene, measurement APIs, adaptive-loading signals, Compute Pressure, WebAssembly.
Status was checked on 2026-09-22 against the web-features dataset (Chrome 153 / Safari 27 era snapshot) and @mdn/browser-compat-data 8.1.2 (2026-09-17), then cross-checked with chromestatus, Chrome release notes, and webkit.org release posts. "Baseline YYYY" = newly available date from web-features; "widely" = 30 months later.
Primary sources: MDN, web.dev, developer.chrome.com, WHATWG HTML/DOM specs, W3C registries, webkit.org, v8.dev, hacks.mozilla.org. Claims that come only from a blog are marked "(blog)". Main-thread scheduling (scheduler.yield, rIC, rAF, timers in depth) is covered in the event-loop notes; this file only cross-references it.

---

## A. Workers and messaging

### Move heavy non-DOM work into a long-lived module worker
- Layer: js
- Stage: main-thread-task, script-run
- Metrics: INP, TBT, FPS/smoothness
- When: interaction | long-lived session
- Impact: high, because INP and frame rate share one main-thread budget and a worker takes parsing, aggregation, and indicator math out of it.
- Do: Put CPU work that does not touch the DOM (feed parsing, candle aggregation, indicator math, order-book diffing) in a dedicated worker. Create it with `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` so bundlers can resolve and hash it. Keep input handlers, DOM writes, and UI state on the main thread.
- Why: A worker is a separate OS-level thread with its own event loop, so its long tasks do not delay input or rendering on the main thread. Off-main-thread work does not reduce total work; it removes contention, which matters most on slow devices where main-thread time is unpredictable.
- Example:
  ```ts
  // main.ts
  const calc = new Worker(new URL('./indicators.worker.ts', import.meta.url), { type: 'module', name: 'indicators' });
  calc.onmessage = (e: MessageEvent<{ id: number; ema: Float64Array }>) => chart.setSeries(e.data.id, e.data.ema);
  calc.postMessage({ id: 7, kind: 'ema', period: 21 });
  ```
- Avoid/caveats: Workers have no DOM or `window`; web.dev lists WebUSB, WebRTC, and Web Audio as main-thread-only. Each round trip costs a clone plus two tasks, so small jobs (a few ms) can be slower in a worker. LoAF script attribution does not cover worker code.
- Status: Dedicated workers Baseline widely available (since 2015). Module workers (`type: 'module'`) Baseline 2023 (newly 2023-06-06, widely 2025-12-06). Source: web-features; BCD `api.Worker.Worker.options_type_parameter` Chrome 80, Firefox 114, Safari 15.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers, https://web.dev/articles/off-main-thread, https://web.dev/learn/performance/web-worker-overview

### Start workers once and reuse them; size pools from hardwareConcurrency
- Layer: js
- Stage: main-thread-task, gc-memory
- Metrics: memory, startup, INP
- When: load | long-lived session
- Impact: medium, because each worker has a real start-up and memory cost.
- Do: Create workers at app start (or on first need) and keep them alive; send work as messages. For parallel jobs, size a pool as `hardwareConcurrency - 1` with a low cap. Never create a worker per task, per chart, or per update. Call `terminate()` on workers you no longer need.
- Why: The HTML spec says workers are relatively heavy-weight and are expected to be long-lived, with a high start-up cost and a high per-instance memory cost. The spec also lets browsers report fewer logical processors than the machine has.
- Example:
  ```ts
  const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 2) - 1));
  const pool = Array.from({ length: size }, (_, i) =>
    new Worker(new URL('./calc.worker.ts', import.meta.url), { type: 'module', name: `calc-${i}` }));
  ```
- Avoid/caveats: Every worker loads and compiles its own copy of its module graph. For state shared across tabs use a SharedWorker (below), not one worker per tab.
- Status: `navigator.hardwareConcurrency` Baseline 2022 (widely 2024-09-14), also on `WorkerNavigator`. Source: web-features, BCD.
- Sources: https://html.spec.whatwg.org/multipage/workers.html, https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency

### Keep each postMessage payload small; send deltas, not whole state
- Layer: js
- Stage: main-thread-task, gc-memory
- Metrics: INP, FPS/smoothness
- When: interaction | animation/render-loop | long-lived session
- Impact: high for streaming UIs, because structured clone runs on both threads for every message.
- Do: Send only what changed (patches, new ticks, dirty ranges) or compact binary. On frame-critical paths keep messages near 10 KiB; for one-off responses stay under about 100 KiB (low-end budgets from Surma's measurements). Coalesce many ticks into one message per frame instead of one message per tick (design inference from the patching and chunking advice).
- Why: `postMessage` serializes the value in the sending realm and deserializes it in the receiving realm; both block their thread, and cost grows with payload size and object depth/breadth. Surma measured that Chrome and Safari defer deserialization until `event.data` is read, while Firefox deserializes before dispatch (blog, 2019). web.dev gives the same rule: if the JSON form of the object is under 10 KB you are unlikely to break a frame budget.
- Example:
  ```ts
  // worker: batch ticks, flush once per animation frame
  const pending: Tick[] = [];
  onTick = (t: Tick) => { pending.push(t); if (pending.length === 1) requestAnimationFrame(flush); };
  function flush() { postMessage(pending.splice(0)); }
  ```
- Avoid/caveats: Manual `JSON.stringify` gave no clear win over plain `postMessage` in the same benchmark (blog). Do not send a full order book or series on every update.
- Status: `postMessage` Baseline widely available. `requestAnimationFrame` in dedicated workers Baseline 2023 (widely 2025-09-27).
- Sources: https://surma.dev/things/is-postmessage-slow/ (blog), https://web.dev/articles/off-main-thread

### Transfer ArrayBuffers instead of copying them
- Layer: js
- Stage: main-thread-task, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: animation/render-loop | long-lived session
- Impact: high for bulk numeric data (series, vertex buffers), because a transfer moves ownership at near-constant cost instead of copying.
- Do: Put bulk numbers in typed arrays and list their `.buffer` in the transfer list (`postMessage(msg, [buf])` or `structuredClone(v, { transfer: [buf] })`). Return the buffer to the sender when done (ping-pong) to avoid new allocations. Use `ArrayBuffer.prototype.transfer(newLength)` to move-and-resize without a copy where the engine can.
- Why: Transferable objects are moved, not cloned; after transfer the original is detached (byteLength 0) and any access throws. Transferable types: ArrayBuffer, AudioData, ImageBitmap, MediaSourceHandle, MediaStreamTrack, MessagePort, MIDIAccess, OffscreenCanvas, ReadableStream, RTCDataChannel, TransformStream, VideoFrame, WebTransportReceiveStream, WebTransportSendStream, WritableStream.
- Example:
  ```ts
  // worker -> main, zero-copy
  const close = new Float64Array(n);            // fill...
  postMessage({ symbol, close }, [close.buffer]);
  // after this line close.byteLength === 0 in the worker
  ```
- Avoid/caveats: Typed arrays themselves are not transferable; their buffer is, and the whole buffer moves, even if the view covers only part of it. Do not transfer a buffer that other code still reads. `SharedArrayBuffer` is not transferable (it is shared).
- Status: Transfer lists: long supported (channel messaging Baseline widely). `ArrayBuffer.prototype.transfer()` Baseline 2024 (newly 2024-03-05, widely 2026-09-05). Resizable ArrayBuffer Baseline 2024 (newly 2024-07-09). Source: web-features.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/transfer

### Use structuredClone for deep copies and send only plain data across threads
- Layer: js
- Stage: script-run, gc-memory
- Metrics: INP, memory
- When: interaction | long-lived session
- Impact: low to medium; mostly correctness plus removing a JSON round trip.
- Do: Use `structuredClone(value)` instead of `JSON.parse(JSON.stringify(value))` for deep copies. Send plain objects, arrays, Map/Set, Date, and typed arrays across threads; convert class instances to plain data first.
- Why: Structured clone keeps cycles and supports Map, Set, Date, RegExp (without `lastIndex`), Error types, ArrayBuffer, typed arrays, Blob, File, ImageBitmap, ImageData, and more. Functions and DOM nodes throw `DataCloneError`; prototypes, getters/setters, property descriptors, and private fields are lost, so class instances arrive as plain objects.
- Example:
  ```ts
  const snapshot = structuredClone(layoutState);            // before: JSON round trip lost Dates and Maps
  worker.postMessage({ orders: orders.map(o => o.toJSON()) }); // not class instances
  ```
- Avoid/caveats: A deep clone still costs time proportional to the data; do not clone large state on every change.
- Status: `structuredClone()` Baseline 2022 (widely 2024-09-14).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone, https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm

### Connect workers directly with MessageChannel, and transfer streams for continuous flows
- Layer: js
- Stage: main-thread-task
- Metrics: INP, FPS/smoothness
- When: long-lived session
- Impact: medium, because it removes a main-thread relay hop from worker-to-worker pipelines.
- Do: When a socket worker feeds a calc worker, create a `MessageChannel` on the main thread and transfer one port to each worker; data then never passes through the main thread. For continuous byte or object flows, transfer a `ReadableStream`/`WritableStream` to the worker so backpressure works across threads.
- Why: Ports and streams are transferable; the main thread only sets up the pipe once.
- Example:
  ```ts
  const { port1, port2 } = new MessageChannel();
  socketWorker.postMessage({ type: 'connect-out', port: port1 }, [port1]);
  calcWorker.postMessage({ type: 'connect-in', port: port2 }, [port2]);
  ```
- Avoid/caveats: With `addEventListener('message')` on a port you must call `port.start()`. Close ports you drop (`port.close()`).
- Status: Channel messaging Baseline widely available. Transferable streams: Chrome 87, Firefox 103, Safari 27 (released 2026-09-14 per webkit.org) — now in all three engines; the web-features snapshot used here still lists it as limited.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects, https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

### Use SharedArrayBuffer + Atomics only for hot shared-memory paths, gated on crossOriginIsolated
- Layer: js
- Stage: main-thread-task, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop | long-lived session
- Impact: medium to high for per-frame producer/consumer data, because there is no clone and no message per update.
- Do: For data exchanged every frame (for example, a tick ring buffer written by a socket worker and read by the render loop), use a `SharedArrayBuffer` with `Atomics.store/load` for indices and `Atomics.notify` to wake a waiting worker. Check `self.crossOriginIsolated` first and fall back to transfers. Never block the main thread: use `Atomics.waitAsync` there; `Atomics.wait` is only for workers. Put `Atomics.pause()` in short spin loops.
- Why: Both threads see the same memory, so nothing is copied. Without cross-origin isolation the `SharedArrayBuffer` constructor is hidden and posting one throws. Atomics give ordering guarantees; plain reads/writes can be seen late by the other thread.
- Example:
  ```ts
  if (crossOriginIsolated) {
    const sab = new SharedArrayBuffer(8 + 4096 * 8);
    const head = new Int32Array(sab, 0, 1);         // write index
    const data = new Float64Array(sab, 8);
    // writer (worker): data[i % 4096] = px; Atomics.store(head, 0, i + 1); Atomics.notify(head, 0);
    // reader (main, per frame): const end = Atomics.load(head, 0);
  } else { /* transfer Float64Array batches instead */ }
  ```
- Avoid/caveats: Races and torn reads are easy; keep the shared protocol tiny. A growable `SharedArrayBuffer` can only grow. Requires the isolation headers (next item), which has costs.
- Status: SharedArrayBuffer and Atomics Baseline 2021 (widely 2024-06-13), only when cross-origin isolated. `Atomics.waitAsync` Baseline 2025 (newly 2025-11-11, Firefox 145). `Atomics.pause` Baseline 2025 (newly 2025-04-01). Source: web-features, BCD.
- Sources: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/waitAsync

### Turn on cross-origin isolation deliberately (COOP + COEP, or Document-Isolation-Policy)
- Layer: network
- Stage: network
- Metrics: FPS/smoothness, memory
- When: load
- Impact: medium; it is the gate for SharedArrayBuffer, Wasm threads, `measureUserAgentSpecificMemory`, and 5 µs `performance.now()` resolution.
- Do: Send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`) on the top-level document. Roll out with `Cross-Origin-Opener-Policy-Report-Only` / `Cross-Origin-Embedder-Policy-Report-Only` first. Make every cross-origin subresource CORS-enabled (`crossorigin` attribute) or served with `Cross-Origin-Resource-Policy`. In Chromium, `Document-Isolation-Policy: isolate-and-require-corp` (or `isolate-and-credentialless`) isolates one document without COOP/COEP and without breaking popups.
- Why: Isolation puts the page in its own process group so high-precision shared memory cannot leak cross-origin data.
- Example:
  ```http
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```
- Avoid/caveats: COOP `same-origin` cuts `window.opener` links to cross-origin popups (OAuth, payment windows). Third-party embeds without CORP/CORS stop loading. Safari has no COEP `credentialless`. Isolated iframes under DIP cannot synchronously script non-isolated same-origin frames.
- Status: COOP/COEP headers Chrome 83, Firefox 79, Safari 15.2. COEP `credentialless` Chrome 96, Firefox 119, not Safari. `crossOriginIsolated` Chrome 87, Firefox 72, Safari 15.2 (BCD). Document-Isolation-Policy: Chrome desktop 137, Chrome Android 146 (chromestatus); no other engine.
- Sources: https://web.dev/articles/cross-origin-isolation-guide, https://developer.chrome.com/blog/document-isolation-policy, https://chromestatus.com/feature/5141940204208128

### Share one connection and one cache across tabs with a SharedWorker
- Layer: js
- Stage: network, main-thread-task, gc-memory
- Metrics: memory, INP, startup
- When: long-lived session
- Impact: medium to high for multi-tab users, because N tabs otherwise open N sockets and parse the same feed N times.
- Do: Run the market-data connection, cache, and parsing in a `SharedWorker`; each tab talks to it through its `port`. Where you need async work to finish after the last tab closes (flush to IndexedDB, final upload), Chromium offers `new SharedWorker(url, { extendedLifetime: true })`.
- Why: One shared worker instance serves all same-origin documents. With `extendedLifetime`, Chrome keeps it alive up to 30 seconds after the last client unloads, which replaces unload-time work.
- Example:
  ```ts
  const feed = new SharedWorker(new URL('./feed.shared.ts', import.meta.url), { type: 'module', name: 'feed' });
  feed.port.onmessage = (e) => applyUpdate(e.data);   // setting onmessage starts the port
  feed.port.postMessage({ subscribe: ['BTCUSD'] });
  ```
- Avoid/caveats: The worker shuts down when the last client goes away (unless extended). Firefox does not share a worker between private and non-private windows. Debug via `chrome://inspect/#workers`.
- Status: SharedWorker Baseline 2026 (newly 2026-05-05, when Chrome Android 148 re-enabled it). Module shared workers Baseline 2026. `extendedLifetime`: Chrome/Edge 148 only.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers, https://developer.chrome.com/release-notes/148, https://developer.chrome.com/blog/extended-lifetime-shared-workers-origin-trial

### Elect one tab with Web Locks and fan results out with BroadcastChannel
- Layer: js
- Stage: network, main-thread-task
- Metrics: memory, INP
- When: long-lived session
- Impact: medium; a fallback or complement to SharedWorker for "only one tab does this" work (sync, polling, socket).
- Do: Have each tab request the same exclusive lock; the holder does the shared work and posts results on a `BroadcastChannel`; when it closes, the next queued tab gets the lock.
- Why: `navigator.locks.request()` holds the lock until the callback's promise settles, and queued requests take over automatically.
- Example:
  ```ts
  navigator.locks.request('feed-leader', async () => {
    const bc = new BroadcastChannel('feed');
    await runFeed(msg => bc.postMessage(msg));   // resolves when this tab stops
  });
  ```
- Avoid/caveats: Every tab receives and clones every broadcast message; keep them small. Out-of-order nested locks can deadlock. Release locks on `freeze` (Chromium lifecycle).
- Status: Web Locks Baseline 2022 (widely 2024-09-14); BroadcastChannel Baseline 2022 (widely 2024-09-14). Secure contexts; available in workers.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API

## B. Service worker and Cache API

### Keep the service worker off the critical path: no no-op fetch handlers, use static routes
- Layer: js
- Stage: network
- Metrics: TTFB, FCP, LCP
- When: load
- Impact: medium to high on navigations, because a service worker must boot before its fetch handler runs.
- Do: Add a `fetch` listener only when it does real work (caching, offline). In `install`, call `event.addRoutes()` to send pass-through traffic (API calls, POSTs, streaming endpoints) straight to `"network"` or a named cache, optionally only when `runningStatus: "not-running"`.
- Why: web.dev measured service-worker boot at about 50 ms on desktop, about 250 ms on mobile, and over 500 ms in extreme cases. Chrome 115 skips no-op fetch handlers, and static routes let the browser route without starting the worker.
- Example:
  ```js
  self.addEventListener('install', (event) => {
    event.addRoutes?.([
      { condition: { urlPattern: '/api/*' }, source: 'network' },
      { condition: { requestMethod: 'post' }, source: 'network' },
    ]);
  });
  ```
- Avoid/caveats: `"race-network-and-fetch-handler"` requires a fetch handler. Route conditions are static; keep them simple.
- Status: Service workers Baseline widely (2020). Static routing (`InstallEvent.addRoutes`) Chrome 123, Safari 27; not Firefox. No-op handler skipping: Chrome 115 (chromestatus).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes, https://developer.chrome.com/blog/service-worker-static-routing, https://chromestatus.com/feature/5136946693668864, https://web.dev/blog/navigation-preload

### Enable navigation preload when navigations go to the network
- Layer: js
- Stage: network
- Metrics: TTFB, FCP, LCP
- When: load
- Impact: medium, because the navigation request starts in parallel with service-worker boot.
- Do: In `activate`, call `registration.navigationPreload.enable()`; in the fetch handler, use `await event.preloadResponse` before calling `fetch()`.
- Why: The preload request runs while the service worker starts, hiding the boot delay.
- Example:
  ```js
  self.addEventListener('activate', e => e.waitUntil(self.registration.navigationPreload?.enable()));
  self.addEventListener('fetch', e => {
    if (e.request.mode !== 'navigate') return;
    e.respondWith((async () => (await e.preloadResponse) ?? fetch(e.request))());
  });
  ```
- Avoid/caveats: If you enable it but still call `fetch(event.request)`, navigations are requested twice. Not needed for cache-first navigations.
- Status: `NavigationPreloadManager` Chrome 59, Firefox 99, Safari 15.4 (BCD) — all engines.
- Sources: https://web.dev/blog/navigation-preload

### Do not fill Cache Storage with opaque responses; bound runtime caches
- Layer: js
- Stage: network, gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium, because quota can run out fast and trigger eviction.
- Do: Request cross-origin assets in CORS mode (`crossorigin="anonymous"`, `mode: 'cors'`) before caching them. Cap runtime caches by entry count and age.
- Why: Opaque responses hide their status, so you may cache an error forever, and Chrome counts each cached opaque response as roughly 7 MB of quota.
- Avoid/caveats: Cache API is not the HTTP cache; entries never expire unless you delete them.
- Status: Cache / CacheStorage: Chrome 40/43, Firefox 41, Safari 11.1 (widely available).
- Sources: https://developer.chrome.com/docs/workbox/caching-resources-during-runtime

## C. Canvas, images, observers

### Render canvases from a worker with OffscreenCanvas when the renderer supports it
- Layer: canvas2d | gpu | js
- Stage: main-thread-task, paint, gpu-draw
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: high where supported, because drawing keeps its frame rate when the main thread is busy, and main-thread work stops blocking drawing.
- Do: Call `canvas.transferControlToOffscreen()`, transfer the result to a worker, and draw there using `requestAnimationFrame` in the worker. Forward pointer, wheel, and resize data from the main thread as small messages. For off-screen composition (sprites, glyph atlases), create `new OffscreenCanvas(w, h)` in a worker and hand results back with `transferToImageBitmap()`.
- Why: OffscreenCanvas does not depend on the DOM, so 2D, WebGL, WebGL2, and WebGPU contexts can run in workers.
- Example:
  ```ts
  const off = canvasEl.transferControlToOffscreen();
  renderWorker.postMessage({ type: 'init', canvas: off, dpr: devicePixelRatio }, [off]);
  canvasEl.addEventListener('pointermove', e => renderWorker.postMessage({ type: 'pm', x: e.offsetX, y: e.offsetY }), { passive: true });
  ```
- Avoid/caveats: After transfer the main thread cannot call `getContext()` on that canvas, and the worker must set the bitmap size. Input and ResizeObserver stay on the main thread. Check that your chart library supports worker rendering before planning on it (SciChart.js support was not verified here). The old `commit()` pattern is replaced by rAF in workers.
- Status: OffscreenCanvas Baseline 2023 (widely 2025-09-27). WebGL/WebGL2 contexts in OffscreenCanvas: Safari 17. WebGPU context in OffscreenCanvas: Chrome 144 (Android 121), Firefox 141, Safari 26 (BCD). rAF in workers Baseline 2023.
- Sources: https://web.dev/articles/offscreen-canvas, https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas

### Decode images off the main thread with createImageBitmap(blob), and close() them
- Layer: canvas2d | gpu | js
- Stage: raster, gpu-upload, main-thread-task, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: load | animation/render-loop
- Impact: medium, because decode of large images otherwise lands on a frame.
- Do: For canvas/WebGL images, `fetch()` → `blob()` → `createImageBitmap(blob, options)` (in a worker if you like) and upload the bitmap. Use options to do work during decode: `resizeWidth`/`resizeHeight`/`resizeQuality`, `imageOrientation: 'flipY'` for GL, `premultiplyAlpha: 'none'` and `colorSpaceConversion: 'none'` when the shader expects raw data. Call `bitmap.close()` after upload. For DOM `<img>` inserted by script, `await img.decode()` before insertion.
- Why: The HTML spec reads and decodes a Blob source "in parallel" to the calling thread. `img.decode()` lets the browser decode before the element is attached, avoiding decode jank on insert.
- Example:
  ```ts
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { resizeWidth: 256, resizeHeight: 256, imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  bmp.close();
  ```
- Avoid/caveats: Option values: `imageOrientation` `from-image` | `flipY` | `none`; `premultiplyAlpha` `none` | `premultiply` | `default`; `colorSpaceConversion` `none` | `default`; `resizeQuality` `pixelated` | `low` | `medium` | `high`. A bitmap holds decoded pixels until closed or collected.
- Status: createImageBitmap Baseline 2023 (newly 2023-12-11, widely 2026-06-11; Safari 17.2 for full support). `resizeQuality` Firefox 149. `ImageBitmap.close()` widely available. `HTMLImageElement.decode()` Chrome 64, Firefox 68, Safari 11.1.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap, https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html, https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode

### Size canvases from ResizeObserver, preferring device-pixel-content-box
- Layer: canvas2d | gpu | js
- Stage: layout, paint
- Metrics: FPS/smoothness, CLS
- When: load | interaction
- Impact: medium; exact pixel sizing avoids blur and moiré and avoids polling layout.
- Do: Observe the canvas with `{ box: 'device-pixel-content-box' }` and set `canvas.width/height` from `devicePixelContentBoxSize`; fall back to `contentBoxSize × devicePixelRatio` (rounded) where it is missing. Use one observer for all canvases.
- Why: The callback runs after layout and before paint, and gives exact device-pixel sizes; `getBoundingClientRect() × devicePixelRatio` can be off because of pixel snapping of fractional CSS sizes.
- Example:
  ```ts
  const ro = new ResizeObserver(entries => {
    for (const e of entries) {
      const c = e.target as HTMLCanvasElement;
      const dp = e.devicePixelContentBoxSize?.[0];
      c.width  = dp ? dp.inlineSize : Math.round(e.contentBoxSize[0].inlineSize * devicePixelRatio);
      c.height = dp ? dp.blockSize  : Math.round(e.contentBoxSize[0].blockSize  * devicePixelRatio);
      scheduleRedraw(c);
    }
  });
  try { ro.observe(canvas, { box: 'device-pixel-content-box' }); } catch { ro.observe(canvas); }
  ```
- Avoid/caveats: Do not change the observed element's layout size inside the callback; that can loop and raise "ResizeObserver loop completed with undelivered notifications". The observer stays alive while it observes targets; `disconnect()` on teardown.
- Status: ResizeObserver Baseline 2020 (widely 2023-01-28). `devicePixelContentBoxSize`: Chrome 84, Firefox 108, not Safari.
- Sources: https://web.dev/articles/device-pixel-content-box, https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver, https://drafts.csswg.org/resize-observer/

### Replace scroll/resize polling with IntersectionObserver, and pause off-screen charts
- Layer: js
- Stage: main-thread-task, layout, paint
- Metrics: INP, FPS/smoothness, memory
- When: interaction | long-lived session
- Impact: medium to high on dashboards with many widgets.
- Do: Observe each chart container; when it is not intersecting, stop its render loop and throttle or drop its live subscription; resume (and resync from a snapshot) when it becomes visible. Use `rootMargin` to start work slightly before a widget scrolls in. Keep callbacks short. Use `trackVisibility` only when you must detect occlusion.
- Why: Scroll handlers that call `getBoundingClientRect()` force layout on the main thread; the observer computes intersections inside the browser and calls you only when thresholds are crossed.
- Example:
  ```ts
  const io = new IntersectionObserver(es => es.forEach(e => charts.get(e.target)!.setActive(e.isIntersecting)), { rootMargin: '200px' });
  for (const el of chartEls) io.observe(el);
  ```
- Avoid/caveats: `trackVisibility` is expensive; MDN says to set `delay` (minimum 100 ms) with it. Many thresholds mean many callbacks.
- Status: IntersectionObserver Baseline 2019 (widely 2021-09-25). `scrollMargin` Chrome 120, Firefox 141, Safari 26. `trackVisibility`/`delay` Chromium only.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API, https://developer.chrome.com/blog/timer-throttling-in-chrome-88

### Scope MutationObserver narrowly and keep its callback cheap
- Layer: js
- Stage: microtask, main-thread-task
- Metrics: INP, TBT
- When: interaction | long-lived session
- Impact: medium, because a broad observer runs on every DOM change the app makes.
- Do: Observe the smallest subtree that matters, use `attributeFilter`, and avoid `subtree: true` on `document` or `body`. Request `attributeOldValue`/`characterDataOldValue` only when needed. Call `disconnect()` on teardown (use `takeRecords()` first if you must flush).
- Why: The DOM spec delivers records in a microtask after the mutating script, so a heavy callback extends the same task. Nodes hold strong references to their registered observers, while the observer holds only weak references to nodes; an observer on a long-lived node lives as long as that node.
- Avoid/caveats: Do not use MutationObserver to watch your own renders; update derived state where you mutate.
- Status: MutationObserver Baseline widely (2015).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe, https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/disconnect, https://dom.spec.whatwg.org/

## D. Visibility, lifecycle, bfcache

### Stop render loops and polling while the page is hidden; resync on return
- Layer: js
- Stage: main-thread-task, idle
- Metrics: memory, FPS/smoothness (on return)
- When: long-lived session
- Impact: medium to high for always-open trading tabs (battery, CPU, backlog on return).
- Do: On `visibilitychange` to `hidden`, stop animation loops, heavy recomputation, and polling; keep only what must run (for example, alerts). On `visible`, fetch a fresh snapshot instead of replaying a backlog. Prefer push sources (sockets, observers) over timers.
- Why: rAF stops in hidden tabs, and timers are throttled. In Chrome, hidden-page timers are checked once per second; after 5 minutes hidden, with a chain of 5+ timers, 30 s of silence, and no WebRTC, they run once per minute (Chrome 88). MDN describes budget-based throttling in Firefox and Chrome and lists audio, WebSocket/WebRTC, and IndexedDB as exempt from that budget; Chrome's intensive throttling lists only audio and WebRTC as exceptions.
- Example:
  ```ts
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { renderLoop.stop(); feed.setMode('alerts-only'); }
    else { feed.setMode('full'); feed.resyncFromSnapshot(); renderLoop.start(); }
  });
  ```
- Avoid/caveats: Do not use hidden-tab timers for heartbeats or order timeouts; they will drift by seconds to a minute.
- Status: Page Visibility Baseline widely (2015).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API, https://developer.chrome.com/blog/timer-throttling-in-chrome-88

### Save state on visibilitychange→hidden; never register unload
- Layer: js
- Stage: main-thread-task, network
- Metrics: memory (bfcache hits improve back/forward load)
- When: long-lived session
- Impact: high for back/forward navigations and data safety.
- Do: Persist state and flush analytics when the page becomes hidden (also `pagehide`). Never add an `unload` listener. Add `beforeunload` only while there are unsaved changes and remove it after save. Block third-party unload handlers with `Permissions-Policy: unload=()`.
- Why: `unload` is unreliable (especially on mobile) and blocks bfcache in Firefox and Chrome desktop. Chrome is deprecating `unload`: 80% of page loads at M152 (2026-08-25) and 100% planned at M154 (2026-09-22).
- Avoid/caveats: `beforeunload` is not supported on iOS Safari (BCD). Do not do synchronous XHR or heavy work in `pagehide`.
- Status: `pagehide` widely available; `unload` deprecated in Chrome (staged rollout).
- Sources: https://developer.chrome.com/docs/web-platform/deprecating-unload, https://web.dev/articles/bfcache, https://developer.chrome.com/docs/web-platform/page-lifecycle-api

### Keep pages bfcache-eligible: close shared connections in pagehide, reopen on pageshow
- Layer: js
- Stage: network, gc-memory
- Metrics: LCP, FCP (instant back/forward), INP
- When: long-lived session
- Impact: high for users who navigate back and forth.
- Do: In `pagehide` (or `freeze`), close IndexedDB connections, stop in-flight fetches, and close WebSocket/WebRTC connections; reopen in `pageshow` (check `event.persisted`) or `resume`. After a bfcache restore, refresh stale prices and auth. Avoid `Cache-Control: no-store` on HTML unless the page is sensitive. Read `performance.getEntriesByType('navigation')[0].notRestoredReasons` to find blockers.
- Why: Browsers skip bfcache for pages holding cross-tab resources: open IndexedDB connections, in-progress fetch/XHR, WebSocket/WebRTC (Chrome 149+ and Safari no longer block on open WebSockets; others do).
- Example:
  ```ts
  addEventListener('pagehide', () => { db?.close(); db = null; socket.close(1000); });
  addEventListener('pageshow', e => { if (e.persisted) { reconnect(); refreshQuotes(); } });
  ```
- Avoid/caveats: Do not open duplicate connections if you reconnect from several events.
- Status: `notRestoredReasons` Chrome 125 only. bfcache behavior is per-browser.
- Sources: https://web.dev/articles/bfcache

### Handle freeze, resume, and discards (Chromium)
- Layer: js
- Stage: gc-memory, network
- Metrics: memory
- When: long-lived session
- Impact: low to medium; Chromium freezes and discards background tabs to save resources.
- Do: On `freeze`, close IndexedDB, BroadcastChannel, and WebRTC; release Web Locks; stop polling; save view state to `sessionStorage`. On `resume`, reconnect. On load, if `document.wasDiscarded`, restore the saved view.
- Why: A frozen page runs no JavaScript; held cross-tab resources block other tabs. A discarded page reloads from scratch.
- Status: `freeze`/`resume` events and `document.wasDiscarded` Chromium 68+ only (BCD, experimental).
- Sources: https://developer.chrome.com/docs/web-platform/page-lifecycle-api

## E. Network control and streams

### Lower the fetch priority of background requests
- Layer: network | js
- Stage: network
- Metrics: LCP, INP, TTFB (of the requests that matter)
- When: load | interaction
- Impact: medium when requests compete for bandwidth.
- Do: Pass `priority: 'low'` for prefetches, history backfill, analytics, and speculative loads; keep user-blocking requests at the default or `'high'`.
- Why: `fetch()` is High priority by default in Chrome, so background fetches compete with critical ones. Values are `'high'`, `'low'`, `'auto'` (default).
- Example:
  ```ts
  fetch(`/api/candles?sym=${s}&from=${older}`, { priority: 'low' });   // backfill
  fetch('/api/order', { method: 'POST', body, priority: 'high' });     // user action
  ```
- Avoid/caveats: It is a relative hint; with no contention it changes nothing. Marking everything high cancels the benefit.
- Status: Fetch priority Baseline 2024 (newly 2024-10-29, Firefox 132).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/RequestInit, https://web.dev/articles/fetch-priority

### Cancel superseded work with AbortController, AbortSignal.timeout, and AbortSignal.any
- Layer: js | network
- Stage: network, main-thread-task, gc-memory
- Metrics: INP, memory
- When: interaction
- Impact: medium; avoids downloading and processing stale responses (symbol switch, search-as-you-type).
- Do: Keep one controller per user intent; abort the previous one before starting the next. Use `AbortSignal.timeout(ms)` instead of a manual timer, and `AbortSignal.any([...])` to combine user cancel and timeout. Pass the same signal to `fetch`, `pipeTo`, `addEventListener`, and Web Locks.
- Why: An aborted fetch stops network work and rejects, so the stale response is never parsed or rendered.
- Example:
  ```ts
  let current: AbortController | undefined;
  async function loadSymbol(sym: string) {
    current?.abort();
    current = new AbortController();
    const signal = AbortSignal.any([current.signal, AbortSignal.timeout(8000)]);
    const res = await fetch(`/api/snapshot/${sym}`, { signal });
    render(await res.json());
  }
  ```
- Avoid/caveats: Handle `AbortError`/`TimeoutError` quietly. `keepalive` requests should not share a UI abort signal.
- Status: AbortController Baseline widely (2021). `AbortSignal.timeout()` Baseline 2024 (newly 2024-04-18). `AbortSignal.any()` Baseline 2024 (newly 2024-03-19; 30-month mark 2026-09-19).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/RequestInit, https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal

### Consume large or long responses as streams with backpressure
- Layer: js | network
- Stage: network, script-run, gc-memory
- Metrics: memory, INP, LCP (time to first data)
- When: load | long-lived session
- Impact: medium; process the first rows while the rest downloads, and avoid holding the whole body.
- Do: Read `response.body` incrementally (`for await` where supported, else a `getReader()` loop). Chain `pipeThrough(new TextDecoderStream())` and a small `TransformStream` for NDJSON. Use byte streams with BYOB readers to reuse buffers. Do not `tee()` or `Response.clone()` a large body unless both branches are read at similar speed.
- Why: Pipes propagate backpressure, so a slow consumer slows the producer. A teed stream backpressures only at the faster branch's rate, so unread data piles up in the slower branch without limit; if only one clone is read, the whole body is buffered.
- Example:
  ```ts
  const lines = res.body!.pipeThrough(new TextDecoderStream()).pipeThrough(splitLines());
  for await (const line of lines) onRow(JSON.parse(line));   // fallback: getReader() loop
  ```
- Avoid/caveats: Very small chunks create many microtasks; batch rows before updating UI.
- Status: Streams Baseline 2022 (widely 2024-12-28). Readable byte streams Baseline 2026 (newly 2026-03-24). Async-iterable streams Baseline 2026 (newly 2026-09-14, Safari 27). `ReadableStream.from()` Firefox 117, Safari 27, not Chromium.
- Sources: https://web.dev/articles/streams, https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/tee, https://developer.mozilla.org/en-US/docs/Web/API/Response/clone

### Use CompressionStream / DecompressionStream instead of JS compression libraries
- Layer: js | build
- Stage: script-run, network
- Metrics: bundle-size, memory
- When: long-lived session
- Impact: low to medium; removes a JS library (such as pako) from the bundle.
- Do: Compress app-level data (large IndexedDB snapshots, uploads of logs or layouts) with `new CompressionStream('gzip')` or `'deflate-raw'`, and decompress with `DecompressionStream`.
- Why: The codec is built into the browser, so you ship no compression code.
- Example:
  ```ts
  const gz = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(gz).arrayBuffer());
  ```
- Avoid/caveats: HTTP `Content-Encoding` already handles network compression; do not double-compress. `'brotli'` is only in Firefox 147 and Safari 18.4 (not Chromium); `'zstd'` is behind a flag in Firefox only.
- Status: Compression streams Baseline 2023 (widely 2025-11-09). Formats in all engines: `gzip`, `deflate`, `deflate-raw` (BCD).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API

### Apply backpressure to real-time sockets; parse feeds off the main thread
- Layer: js | network
- Stage: network, main-thread-task, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: long-lived session
- Impact: high for high-rate market data.
- Do: Receive and parse socket messages in a worker; coalesce updates to the display rate before posting to the main thread. On the send side check `bufferedAmount` before sending more. Where available, use `WebSocketStream` so a slow consumer slows reading; consider WebTransport for multiplexed streams or datagrams.
- Why: Classic `WebSocket` `onmessage` has no backpressure: messages keep arriving and buffering even while your handler is still busy.
- Example:
  ```ts
  if ('WebSocketStream' in self) {
    const wss = new WebSocketStream(url);
    const { readable } = await wss.opened;
    for await (const msg of readable) await handle(msg);   // reading pauses while handle() runs
  }
  ```
- Avoid/caveats: Do not render per message; render per frame.
- Status: WebSocketStream Chrome/Edge 124 only (BCD, non-standard track). WebTransport Baseline 2026 (newly 2026-03-24, Safari 26.4).
- Sources: https://developer.chrome.com/docs/capabilities/web-apis/websocketstream

### Send end-of-session data with keepalive / sendBeacon (or fetchLater), never with blocking work
- Layer: js | network
- Stage: network
- Metrics: INP (no blocking at hide), memory
- When: long-lived session
- Impact: low to medium; reliable delivery without blocking navigation.
- Do: On `visibilitychange` to hidden, send small payloads with `navigator.sendBeacon()` or `fetch(url, { method: 'POST', body, keepalive: true })`. In Chromium, `fetchLater(url, { method: 'POST', body, activateAfter })` queues a request that the browser sends at page destroy/bfcache eviction or after the timeout; abort and re-create it to update the payload.
- Why: These requests survive page unload without holding the page open.
- Example:
  ```ts
  let pending: AbortController | undefined;
  function queueMetrics(body: string) {
    if (!('fetchLater' in window)) return;             // fall back to sendBeacon on hidden
    pending?.abort(); pending = new AbortController();
    fetchLater('/rum', { method: 'POST', body, signal: pending.signal, activateAfter: 60_000 });
  }
  ```
- Avoid/caveats: `keepalive` bodies are limited to 64 KiB. `fetchLater` quota: 640 KiB per top-level document, 64 KiB per reporting origin; it throws `QuotaExceededError` when over.
- Status: `sendBeacon` Baseline widely (2020). `keepalive`: Chrome 66, Safari 13, Firefox 133. `fetchLater`: Chromium 135 only.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/RequestInit, https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater, https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Deferred_Fetch

## F. Storage

### Keep localStorage and sessionStorage off hot paths
- Layer: js
- Stage: main-thread-task
- Metrics: INP, TBT, startup
- When: load | interaction
- Impact: medium; every call is synchronous on the main thread.
- Do: Read small settings once at startup into memory; write back rarely and debounced. Store larger or structured data in IndexedDB (or OPFS).
- Why: web.dev: Web Storage is synchronous and blocks the main thread, holds strings only (~5 MB), and is not available in workers or service workers.
- Avoid/caveats: Do not `JSON.stringify` a big object into localStorage on every change.
- Status: Baseline widely available (2015).
- Sources: https://web.dev/articles/storage-for-the-web

### Write IndexedDB in small records and batched transactions; read with getAll ranges
- Layer: js
- Stage: main-thread-task, gc-memory
- Metrics: INP, TBT, memory
- When: long-lived session
- Impact: medium to high for apps that persist a lot of state.
- Do: Split state into many small records and write only the ones that changed. Put many writes in one transaction. Read pages with `getAll(range, count)` / `getAllKeys` instead of cursors; use `getAllRecords()` where available to get keys and values together. Leave durability at the default (relaxed) and ask for `{ durability: 'strict' }` only for data that must survive power loss. Do heavy IndexedDB work in a worker. Close connections on `pagehide`/`freeze` for bfcache.
- Why: Storing an object makes a structured clone on the calling thread; large objects mean long tasks. Chrome's switch to relaxed durability by default (Chrome 121) gave 3×–30× speed-ups in real examples. Nolan Lawson measured 20–50%+ faster reads with `getAll` pagination over cursors (blog, 2021). `getAllRecords()` showed a 350 ms gain on one Microsoft workload (Chrome 141 notes, seen only as a search snippet).
- Example:
  ```ts
  const tx = db.transaction('candles', 'readwrite');
  for (const c of dirtyCandles) tx.objectStore('candles').put(c);   // one transaction, many small puts
  tx.commit?.();
  ```
- Avoid/caveats: Very large single `getAll()` calls cause memory spikes; page them. Relaxed durability can lose the last writes on OS crash.
- Status: IndexedDB Baseline widely (2024-03-20). `durability` option Chrome 83, Firefox 126, Safari 15. `IDBTransaction.commit()` widely available. `getAllRecords()` Chrome 141, Firefox 153; Safari only in Technology Preview.
- Sources: https://web.dev/articles/indexeddb-best-practices-app-state, https://developer.chrome.com/blog/indexeddb-durability-mode-now-defaults-to-relaxed, https://nolanlawson.com/2021/08/22/speeding-up-indexeddb-reads-and-writes/ (blog), BCD `api.IDBObjectStore.getAllRecords`

### Use OPFS synchronous access handles in a worker for large binary data
- Layer: js
- Stage: main-thread-task, gc-memory
- Metrics: memory, INP
- When: long-lived session
- Impact: medium for large archives (tick history, Wasm SQLite).
- Do: In a dedicated worker, get a file from `navigator.storage.getDirectory()`, open `createSyncAccessHandle()`, and `read`/`write` at byte offsets; `flush()` and `close()` when done.
- Why: Sync handles avoid promise overhead and allow in-place byte access; they exist only in workers, where blocking is safe.
- Avoid/caveats: One sync handle per file at a time (exclusive lock). Not for small structured records; IndexedDB fits those better.
- Status: Origin private file system Baseline 2023 (widely 2025-09-27). `FileSystemSyncAccessHandle` Chrome 102 (Android 109), Firefox 111, Safari 15.2.
- Sources: https://web.dev/articles/origin-private-file-system

### Check quota and request persistence before caching large datasets
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: low to medium; avoids surprise eviction and quota errors.
- Do: Call `navigator.storage.estimate()` before bulk writes and handle `QuotaExceededError`. Call `navigator.storage.persist()` for data the user cannot easily re-fetch.
- Why: Best-effort storage is evicted under pressure (LRU by origin). Safari caps script-writable storage at seven days without user interaction unless the site is an installed web app or has persistent storage (web.dev).
- Status: Storage manager Baseline 2023 (widely 2026-03-18).
- Sources: https://web.dev/articles/storage-for-the-web

## G. Memory hygiene

### Tie every listener, timer, observer, and subscription to one teardown AbortSignal
- Layer: js
- Stage: gc-memory
- Metrics: memory, INP (over long sessions)
- When: long-lived session
- Impact: high for SPAs that mount/unmount widgets for hours.
- Do: Give each component one `AbortController`. Pass its signal to every `addEventListener` and `fetch`; register cleanup for everything else (timers, observers, rAF, workers, sockets, object URLs) on `signal`'s `abort` event; call `abort()` on unmount.
- Why: Common leaks are listeners on `window`/`document`, uncleared intervals, observers never disconnected, never-settled promises, and ever-growing stores (Nolan Lawson, blog). A listener or observer attached to a long-lived target keeps its closure (and everything it captures) alive.
- Example:
  ```ts
  function mountChart(el: HTMLElement) {
    const ac = new AbortController(); const { signal } = ac;
    window.addEventListener('resize', onResize, { signal });
    const ro = new ResizeObserver(onBox); ro.observe(el);
    const id = setInterval(pollStatus, 5000);
    signal.addEventListener('abort', () => { ro.disconnect(); clearInterval(id); });
    return () => ac.abort();
  }
  ```
- Avoid/caveats: To find leaks, take a heap snapshot, repeat the action 7 times, snapshot again, and look for object counts that grew by multiples of 7 (blog).
- Status: `addEventListener` `signal` option Chrome 90, Firefox 86, Safari 15 (all engines).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener, https://nolanlawson.com/2020/02/19/fixing-memory-leaks-in-web-applications/ (blog)

### Drop references to removed DOM nodes; key element metadata by WeakMap
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium to high; one stale reference keeps a whole detached subtree alive.
- Do: Do not keep removed elements in arrays, maps, closures, or module state. Store per-element data in a `WeakMap` keyed by the element. Check DevTools Memory → heap snapshot filtered by "Detached", or the Detached elements profile.
- Why: A node removed from the document but still referenced from JS is "detached"; that reference keeps the node and all its children in memory.
- Example:
  ```ts
  const meta = new WeakMap<Element, RowMeta>();   // before: Map<Element, RowMeta> kept rows forever
  ```
- Status: WeakMap Baseline widely (2015).
- Sources: https://developer.chrome.com/docs/devtools/memory-problems

### Use WeakRef and FinalizationRegistry only for optional caches and backstops
- Layer: js | v8
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: low; wrong use creates heisenbugs.
- Do: Use `WeakRef` for caches whose entries may disappear; always handle `deref()` returning `undefined`. Use `FinalizationRegistry` only as a backstop (for example, freeing Wasm memory you forgot to free); free essential resources explicitly.
- Why: MDN says to avoid WeakRef where possible: GC timing differs between engines and versions, and a finalization callback may run late or never. A target you just `deref()`ed stays alive until the current job ends.
- Avoid/caveats: The held value must not reference the target, or the target never dies.
- Status: Weak references Baseline 2021 (widely 2023-10-26).
- Sources: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakRef, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry

### Release large native-backed objects explicitly
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium; these objects can pin large buffers until closed.
- Do: Call `ImageBitmap.close()` and `VideoFrame.close()` after use, `URL.revokeObjectURL()` after an object URL is consumed, `worker.terminate()` / `port.close()` for unused workers and ports, and `db.close()` for idle IndexedDB connections.
- Why: An object URL keeps its Blob alive until revoked or until the document unloads; `close()` releases a bitmap's pixel data right away.
- Example:
  ```ts
  const url = URL.createObjectURL(csvBlob);
  a.href = url; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  ```
- Status: `ImageBitmap.close()` widely; `VideoFrame.close()` Chrome 94, Firefox 130, Safari 16.4; object URLs widely (not in service workers).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static, https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap

### Clear User Timing and Resource Timing buffers in long-lived sessions
- Layer: js | tooling
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium for apps that mark every update for hours.
- Do: Consume entries with a `PerformanceObserver`, then call `performance.clearMarks()`/`clearMeasures()` (by name) and `performance.clearResourceTimings()`. Do not mark per tick in production; sample.
- Why: The W3C entry-type registry gives `mark`, `measure`, and `navigation` an infinite buffer, so marks accumulate forever. The resource buffer holds 250 entries by default and then fires `resourcetimingbufferfull`; read entries through a PerformanceObserver instead of polling `getEntriesByType('resource')`, and clear the buffer after you ship them.
- Example:
  ```ts
  new PerformanceObserver(list => { ship(list.getEntries()); performance.clearMeasures('render'); })
    .observe({ type: 'measure', buffered: true });
  ```
- Status: User Timing and Resource Timing widely available; `clearResourceTimings()` Chrome 46, Firefox 35, Safari 11.
- Sources: https://w3c.github.io/timing-entrytypes-registry/, https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Resource_timing, https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/User_timing

### Measure field memory with performance.measureUserAgentSpecificMemory(), not performance.memory
- Layer: js | tooling
- Stage: gc-memory
- Metrics: memory
- When: long-lived session | testing
- Impact: medium for leak and regression detection in production.
- Do: When `crossOriginIsolated`, call `performance.measureUserAgentSpecificMemory()` at random intervals (web.dev suggests a Poisson process averaging about one call per 5 minutes) and report `bytes` plus `breakdown`. Compare only within the same browser and version.
- Why: It includes JS and DOM memory for the page, iframes, and workers. It may take a while to resolve; web.dev says it forces a GC after a 20-second timeout.
- Avoid/caveats: `performance.memory` is non-standard and deprecated (BCD) and reports only the JS heap.
- Status: Chromium 89+ only, experimental; requires cross-origin isolation.
- Sources: https://web.dev/articles/monitor-total-page-memory-usage

## H. Measurement APIs

### Time code with performance.now(), not Date.now()
- Layer: js | tooling
- Stage: script-run
- Metrics: INP, FPS/smoothness (for your own measurements)
- When: testing | long-lived session
- Impact: low; correctness of every timing you collect.
- Do: Use `performance.now()` for durations and `event.timeStamp` for input start times. When you compare times across a worker and the page, convert with `performance.timeOrigin + performance.now()`.
- Why: It is monotonic and not affected by clock changes. Resolution is coarsened to 100 µs normally and 5 µs when cross-origin isolated. Workers have their own `timeOrigin`.
- Avoid/caveats: On non-Windows platforms Chrome, Firefox, and Safari do not advance it during system sleep; use `Date.now()` for wall-clock spans that may cross sleep.
- Status: Baseline widely.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Performance/now

### Mark app phases with User Timing; show them as DevTools custom tracks
- Layer: js | tooling
- Stage: script-run
- Metrics: INP, LCP, FPS/smoothness
- When: testing | long-lived session
- Impact: medium; makes app-specific work visible in traces and RUM.
- Do: Use `performance.mark(name, { detail })` and `performance.measure(name, { start, end, detail })`; a measure can start at `event.timeStamp`. In Chrome DevTools, put `detail: { devtools: { dataType: 'track-entry', track, trackGroup, color } }` to draw custom tracks, or use the extended `console.timeStamp(label, start, end, track, trackGroup, color)` for near-zero cost when DevTools is not recording.
- Example:
  ```ts
  const t0 = performance.now();
  applySnapshot(s);
  performance.measure('apply-snapshot', { start: t0, detail: { devtools: { track: 'Feed', color: 'secondary' }, rows: s.length } });
  ```
- Avoid/caveats: Marks never expire (see buffer item). DevTools colors: `primary`, `primary-light`, `primary-dark`, `secondary`(…), `tertiary`(…), `error`.
- Status: User Timing Baseline widely; `detail` Chrome 78, Firefox 101/103, Safari 14.1. DevTools extensibility is Chrome tooling only.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/User_timing, https://developer.chrome.com/docs/devtools/performance/extension

### Register PerformanceObservers early with type + buffered: true, and feature-detect entry types
- Layer: js | tooling
- Stage: script-run
- Metrics: LCP, INP, CLS, FPS/smoothness
- When: load
- Impact: medium; late or wrong registration loses entries.
- Do: Observe one entry type per call with `{ type, buffered: true }` (buffered does not work with `entryTypes`). Check `PerformanceObserver.supportedEntryTypes.includes(type)` first. For `event`, set `durationThreshold` (default 104 ms, minimum 16 ms, 8 ms granularity).
- Why: `buffered` replays entries recorded before you subscribed, but each type has a cap: first-input 1, paint 2, soft-navigation 50, visibility-state 50, element/event/LCP/layout-shift/interaction-contentful-paint 150, longtask/long-animation-frame 200, resource 250, mark/measure/navigation unlimited.
- Avoid/caveats: Keep observer callbacks cheap; batch and send later.
- Status: PerformanceObserver Chrome 52, Firefox 57, Safari 11; `supportedEntryTypes` Chrome 73, Firefox 68, Safari 13; available in workers.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver/observe, https://w3c.github.io/timing-entrytypes-registry/

### Collect Core Web Vitals in the field with web-vitals v6 (attribution build)
- Layer: js | tooling
- Stage: network, script-run
- Metrics: LCP, INP, CLS, FCP, TTFB
- When: load | long-lived session
- Impact: high for knowing real-user performance; low runtime cost (about 3 KB brotli; attribution build about 1.5 KB more).
- Do: Use `onLCP`, `onINP`, `onCLS`, `onFCP`, `onTTFB` from `web-vitals` (latest 6.2.2, 2026-09-14), the `/attribution` build for INP breakdown (`interactionTarget`, `inputDelay`, `processingDuration`, `presentationDelay`, `longAnimationFrameEntries`). Call each function once per page load. Queue results and send them on `visibilitychange` to hidden with `sendBeacon`. For SPAs, pass `{ reportSoftNavs: true }`.
- Why: The library handles bfcache restores, hidden-page cut-offs, and INP percentile logic that ad-hoc code gets wrong. v6 adds soft-navigation support and bfcache reporting of small INP interactions.
- Avoid/caveats: `onFID` no longer exists (INP replaced FID). `onCLS` works only in Chromium. Soft-nav reporting changes how the first page's metrics finalize.
- Status: LCP entries and Event Timing Baseline 2025 (newly 2025-12-12, Safari 26.2; Firefox 122/89). `performance.interactionCount` Chrome 144, Firefox 144, Safari 26.2. Layout instability (CLS): Chromium only. Soft navigations: Chromium 151+.
- Sources: https://github.com/GoogleChrome/web-vitals (README and CHANGELOG), https://webkit.org/blog/17640/webkit-features-for-safari-26-2/

### Diagnose slow interactions and frames with Event Timing and Long Animation Frames
- Layer: js | tooling
- Stage: main-thread-task, style, layout, paint
- Metrics: INP, FPS/smoothness, TBT
- When: interaction | animation/render-loop
- Impact: high for finding the real cause of slow INP in the field.
- Do: From `event` entries, split each interaction: input delay = `processingStart - startTime`, processing = `processingEnd - processingStart`, presentation = the rest of `duration`; group by `interactionId`. In Chromium, observe `long-animation-frame` (buffered) and report frames with high `blockingDuration`, including `scripts[]` (`invoker`, `invokerType`, `sourceURL`, `sourceFunctionName`, `forcedStyleAndLayoutDuration`).
- Why: LoAF marks rendering updates delayed beyond 50 ms; `blockingDuration` sums the part of each task over 50 ms (plus render in the longest task), which is the part that blocks input. Scripts over 5 ms get attribution.
- Example:
  ```ts
  new PerformanceObserver(l => l.getEntries().forEach((f: any) => {
    if (f.blockingDuration > 100 && f.firstUIEventTimestamp) report(f.scripts.map((s: any) => [s.sourceURL, s.invoker, s.duration]));
  })).observe({ type: 'long-animation-frame', buffered: true });
  ```
- Avoid/caveats: LoAF gives no script attribution for workers, cross-origin iframes, or extensions. Event entries exclude continuous events (`pointermove`, `wheel`, `touchmove`). Long Tasks API is superseded by LoAF.
- Status: Event Timing Baseline 2025 (newly 2025-12-12); `interactionId` Chrome 96, Firefox 144, Safari 26.2. LoAF Chromium 123+ only; LoAF style-duration fields in origin trial in Chrome 148.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming, https://developer.chrome.com/docs/web-platform/long-animation-frames, https://developer.chrome.com/release-notes/148

### Time your own key elements with Element Timing (Chromium)
- Layer: html | js | tooling
- Stage: paint
- Metrics: LCP (app-specific equivalent)
- When: load
- Impact: low to medium; measures when the element users care about (for example, the main chart placeholder or price header) paints.
- Do: Add `elementtiming="name"` to an `<img>`, SVG `<image>`, video poster, background-image element, or text block, and observe `{ type: 'element', buffered: true }`.
- Why: LCP picks the largest element, which may not be your key content.
- Avoid/caveats: `renderTime` is 0 for cross-origin images without `Timing-Allow-Origin`. Canvas drawing is not an eligible element. Container Timing (`containertiming` attribute) is in origin trial in Chrome 148.
- Status: Element Timing Chromium 77+ only.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceElementTiming, https://developer.chrome.com/release-notes/148

### Break down network time with Navigation, Resource, and Server Timing
- Layer: js | network | tooling
- Stage: network
- Metrics: TTFB, LCP, FCP
- When: load
- Impact: medium; separates server, network, and cache time in RUM.
- Do: Read `performance.getEntriesByType('navigation')[0]` (`responseStart` for TTFB, `activationStart` for prerendered pages) and `resource` entries (`transferSize === 0` usually means a cache hit; `nextHopProtocol`; `encodedBodySize`/`decodedBodySize`). Send `Timing-Allow-Origin` from your CDNs/APIs to expose cross-origin details. Emit `Server-Timing` headers from your backend and read `entry.serverTiming`.
- Why: Without TAO most cross-origin timing fields are 0.
- Avoid/caveats: Do not use `performance.timing` (PerformanceTiming, deprecated).
- Status: Navigation timing Baseline widely (2024-04-25). Resource timing widely. Server timing Baseline widely (2025-09-27). `renderBlockingStatus` Chromium 107; `deliveryType` Chrome 117, Safari 26.4; `contentType` Chrome 148; `activationStart`, `notRestoredReasons`, `confidence` Chromium only.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Resource_timing, https://developer.chrome.com/release-notes/148

### Make SPA route changes measurable as soft navigations
- Layer: js | tooling
- Stage: script-run, paint
- Metrics: LCP, INP, CLS (per route)
- When: interaction
- Impact: medium for SPAs; per-route vitals instead of one long page.
- Do: Change routes from a user interaction, update the URL with the History or Navigation API, and paint new content; Chromium then emits `soft-navigation` and `interaction-contentful-paint` entries. Use `web-vitals` with `reportSoftNavs: true`.
- Why: Chrome 151 detects a soft navigation when a user action causes a visible URL change and a visible paint; LCP, INP, and CLS reset at each one.
- Avoid/caveats: Chromium only; other browsers keep whole-page metrics. The `soft-navigation` buffer holds 50 entries.
- Status: Soft navigation entries Chrome/Edge 151 (shipped by default).
- Sources: https://developer.chrome.com/docs/web-platform/soft-navigations

### Sample field CPU profiles with the JS Self-Profiling API (Chromium)
- Layer: js | tooling
- Stage: script-run
- Metrics: INP, TBT
- When: testing | long-lived session
- Impact: low to medium; field stack samples for hot code.
- Do: Serve the document with `Document-Policy: js-profiling`, then `new Profiler({ sampleInterval: 10, maxBufferSize: 10000 })` for short windows and `await profiler.stop()`; aggregate in a worker; send CORS headers on your scripts for attribution.
- Avoid/caveats: The profiler has overhead; sample a small share of sessions.
- Status: Chromium 94+ only, experimental.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/JS_Self-Profiling_API

## I. Adaptive loading and device signals

### Adapt heavy features to device class, and treat "unknown" as mid-range
- Layer: js
- Stage: script-run, gpu-draw
- Metrics: INP, FPS/smoothness, memory, bundle-size
- When: load
- Impact: medium; lets low-end devices get fewer series, less animation, or lower chart update rates.
- Do: Read `navigator.deviceMemory` (GiB, power of two, clamped), `navigator.hardwareConcurrency`, and in Chromium 152+ `navigator.cpuPerformance` (0 unknown, 1–4 tiers) once at startup; pick a device class. Only lower quality on a clear low signal; missing values mean "unknown", not "low". Server side, `Sec-CH-Device-Memory` gives the same bucket.
- Why: The spec for `cpuPerformance` maps tiers roughly to core counts (1: single core, 2: 2–4, 3: 5–10, 4: 11+), with ±1 adjustment for known CPU models.
- Example:
  ```ts
  const mem = (navigator as any).deviceMemory as number | undefined;
  const tier = (navigator as any).cpuPerformance as number | undefined;
  const low = (mem !== undefined && mem <= 2) || tier === 1 || (navigator.hardwareConcurrency ?? 4) <= 2;
  chart.configure(low ? { maxPoints: 20_000, animate: false } : { maxPoints: 200_000, animate: true });
  ```
- Avoid/caveats: Values are coarse on purpose (anti-fingerprinting); users can override the CPU tier in Chrome settings. `Device-Memory` header is deprecated in favor of `Sec-CH-Device-Memory`.
- Status: `deviceMemory` Chromium only (63+; worker 65). `hardwareConcurrency` Baseline 2022. `cpuPerformance` Chrome 152 only, experimental, `Navigator` only, secure contexts.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory, https://wicg.github.io/cpu-performance/, https://developer.chrome.com/blog/new-in-chrome-152, https://web.dev/articles/adaptive-loading-cds-2019

### Respect Save-Data and slow connections (Chromium signal)
- Layer: js | network
- Stage: network
- Metrics: LCP, bundle-size
- When: load
- Impact: low to medium; mostly mobile users.
- Do: If `navigator.connection?.saveData` is true or `effectiveType` is `'slow-2g' | '2g' | '3g'`, skip prefetching, autoplay, and speculative history backfill; listen for `change`. On the server, honor the `Save-Data: on` request header.
- Why: The browser derives `effectiveType` from recently observed RTT and downlink.
- Avoid/caveats: Not available in Firefox or Safari; code must work without it.
- Status: Network Information and Save-Data Chromium only (not Baseline).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation/effectiveType, https://web.dev/articles/adaptive-loading-cds-2019

### React to live CPU pressure with the Compute Pressure API
- Layer: js
- Stage: main-thread-task, gpu-draw
- Metrics: FPS/smoothness, INP
- When: long-lived session
- Impact: medium on laptops that heat up under many live charts.
- Do: Create a `PressureObserver`, `observe('cpu', { sampleInterval: 2000 })`, and on `serious` or `critical` lower chart refresh rate, decimate series, or pause non-visible widgets; restore on `nominal`/`fair`.
- Why: States: `nominal` (fine), `fair` (slightly elevated), `serious` (consistently high, throttling possible), `critical` (needs cooling). Updates arrive at most once per `sampleInterval`.
- Example:
  ```ts
  if ('PressureObserver' in self) {
    const po = new PressureObserver(([r]) => chart.setMaxFps(r.state === 'serious' || r.state === 'critical' ? 20 : 60));
    await po.observe('cpu', { sampleInterval: 2000 });
  }
  ```
- Avoid/caveats: Only source today is `cpu`. Works in windows, dedicated and shared workers, same-origin iframes (`compute-pressure` permissions policy, default `'self'`); not in service workers.
- Status: Chrome/Edge 125 desktop only (BCD shows no Chrome Android), experimental.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Compute_Pressure_API, https://developer.chrome.com/docs/web-platform/compute-pressure

## J. WebAssembly

### Use WebAssembly for measured CPU-bound kernels, not by default
- Layer: v8 | build
- Stage: script-compile, script-run
- Metrics: INP, FPS/smoothness, bundle-size
- When: build | interaction
- Impact: medium when it fits; negative when it does not.
- Do: Profile first and optimize the JS first. Choose Wasm for predictable performance without warm-up (Liftoff code is fast from the first call; no deopts), or to reuse an existing C/C++/Rust library.
- Why: Surma found optimized JS matched or beat AssemblyScript on several benchmarks and matched C++ in one; memory management and allocation patterns dominated results (blog, 2021).
- Avoid/caveats: Wasm plus glue can be larger than the JS it replaces.
- Status: WebAssembly Baseline widely (2020).
- Sources: https://surma.dev/things/js-to-asc/ (blog), https://v8.dev/docs/wasm-compilation-pipeline

### Cross the JS↔Wasm boundary rarely and in bulk
- Layer: v8 | js
- Stage: script-run, gc-memory
- Metrics: INP, FPS/smoothness
- When: animation/render-loop
- Impact: high for per-point work; per-element calls erase Wasm's gains.
- Do: Write inputs into Wasm linear memory once (a typed-array view over `memory.buffer`), make one call per batch, and read results from memory. Pass numbers, not objects or strings. Re-create views after `memory.grow()`. Use JS String Builtins (`builtins: ['js-string']`) when Wasm code must handle JS strings.
- Why: Calls themselves became fast in engines (Firefox 2018 work), but non-numeric values still need conversion or copying. Every `grow()` detaches the old non-shared `ArrayBuffer`, so old views read zero length.
- Example:
  ```ts
  const inPtr = wasm.alloc(n * 8);
  new Float64Array(wasm.memory.buffer, inPtr, n).set(closes);   // one copy in
  const outPtr = wasm.ema(inPtr, n, 21);                         // one call
  const ema = new Float64Array(wasm.memory.buffer, outPtr, n).slice(); // re-read buffer after possible grow
  ```
- Status: JS String Builtins Chrome 130, Firefox 134, Safari 26.2 (BCD) — all engines.
- Sources: https://hacks.mozilla.org/2018/10/calls-between-javascript-and-webassembly-are-finally-fast-%F0%9F%8E%89/, https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/JavaScript_builtins, https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow

### Load Wasm with instantiateStreaming and keep the module URL stable
- Layer: build | network | v8
- Stage: network, script-compile
- Metrics: startup, TBT
- When: load
- Impact: medium for large modules.
- Do: Serve `.wasm` with `Content-Type: application/wasm` and load it with `WebAssembly.instantiateStreaming(fetch(url), imports)` (or `compileStreaming`), ideally in a worker. Keep the URL stable between releases and return `304` when unchanged.
- Why: Streaming compiles while bytes download. V8 caches optimized code for streamed modules (threshold was 128 kB in 2019), and a URL change forces full recompilation. Liftoff compiles fast; hot functions tier up to TurboFan in the background.
- Avoid/caveats: The code cache is invalidated when the module or Chrome version changes.
- Status: `compileStreaming`/`instantiateStreaming` Chrome 60, Firefox 58, Safari 15.
- Sources: https://v8.dev/blog/wasm-code-caching, https://v8.dev/docs/wasm-compilation-pipeline

### Use Wasm SIMD freely; use Wasm threads only under isolation with a pre-started pool
- Layer: v8 | build
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: build | animation/render-loop
- Impact: medium for numeric kernels.
- Do: Build with fixed-width SIMD. For threads, require cross-origin isolation, pre-create the worker pool (Emscripten `-pthread -s PTHREAD_POOL_SIZE=...`, or `-s PROXY_TO_PTHREAD` to keep the main thread free; Rust `wasm-bindgen-rayon`), and ship a single-thread fallback chosen by feature detection.
- Why: Workers start asynchronously, so a `pthread_create` followed by a blocking join on the main thread can deadlock without a pre-created pool.
- Avoid/caveats: Relaxed SIMD and Memory64 are not in Safari. JSPI helps port synchronous code that awaits promises.
- Status: Fixed-width SIMD Baseline 2023 (widely 2025-09-27). Threads and atomics Baseline 2021 (needs isolation). Relaxed SIMD Chrome 114, Firefox 146. Memory64 Chrome 133, Firefox 134. JSPI Baseline 2026 (newly 2026-09-14). Wasm GC Baseline 2024.
- Sources: https://web.dev/articles/webassembly-threads, https://webkit.org/blog/18325/webkit-features-for-safari-27-0/

## K. Cross-reference: scheduling

### Yield inside long main-thread tasks (details in the event-loop notes)
- Layer: js
- Stage: main-thread-task
- Metrics: INP, TBT
- When: interaction | load
- Impact: high, but covered in depth elsewhere.
- Do: Break long work with `await scheduler.yield()` where available, with a `setTimeout`/`MessageChannel` fallback; lower-priority work via `scheduler.postTask(..., { priority: 'background' })`.
- Status: `scheduler.yield` Chrome 129, Firefox 142, not Safari; `scheduler.postTask` Chrome 94, Firefox 142, not Safari; `requestIdleCallback` not in Safari stable (Technology Preview flag). `isInputPending` is deprecated.
- Sources: BCD 8.1.2; see the event-loop notes file.

---

## Deprecated APIs and myths (as of 2026-09)
- `performance.memory`: non-standard and deprecated (BCD); use `measureUserAgentSpecificMemory()`.
- `performance.timing` / `PerformanceTiming`: deprecated (web-features "discouraged"); use `PerformanceNavigationTiming`.
- `unload` event: being removed from Chrome (80% of page loads by M152, 100% planned M154); use `pagehide`/`visibilitychange`.
- Long Tasks API: superseded by Long Animation Frames for attribution.
- `navigator.scheduling.isInputPending()`: deprecated (web-features "discouraged").
- `onFID` in web-vitals: removed; FID was replaced by INP.
- `Device-Memory` request header: deprecated; use `Sec-CH-Device-Memory`.
- OffscreenCanvas `commit()`: old pattern; use `requestAnimationFrame` in the worker.
- Myth: "workers make code faster". They move work off the main thread; total work and messaging cost stay or grow.
- Myth: "JSON.stringify before postMessage is faster". No clear winner in measurements (blog).
- Myth: "WebAssembly is always faster than JS". Often it is not; profile first (blog).
- Myth: "SharedArrayBuffer is available everywhere". Only in cross-origin-isolated contexts.
- Myth: "MutationObserver keeps observed nodes alive". The DOM spec gives the observer weak references to nodes; nodes keep the observer alive.
- Myth: "localStorage is fast because it is small". It is synchronous main-thread I/O.
- Myth: "IntersectionObserver visibility tracking is cheap". `trackVisibility` is expensive and Chromium-only.

## Sources read
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
- https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/transfer
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/waitAsync
- https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode
- https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
- https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
- https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe
- https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/disconnect
- https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
- https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API
- https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/tee
- https://developer.mozilla.org/en-US/docs/Web/API/Response/clone
- https://developer.mozilla.org/en-US/docs/Web/API/RequestInit
- https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakRef
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry
- https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static
- https://developer.mozilla.org/en-US/docs/Web/API/Performance/now
- https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/User_timing
- https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver/observe
- https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Resource_timing
- https://developer.mozilla.org/en-US/docs/Web/API/PerformanceElementTiming
- https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming
- https://developer.mozilla.org/en-US/docs/Web/API/JS_Self-Profiling_API
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency
- https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation/effectiveType
- https://developer.mozilla.org/en-US/docs/Web/API/Compute_Pressure_API
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes
- https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater
- https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Deferred_Fetch
- https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/JavaScript_builtins
- https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow
- https://web.dev/articles/off-main-thread
- https://web.dev/learn/performance/web-worker-overview
- https://web.dev/articles/cross-origin-isolation-guide
- https://web.dev/articles/offscreen-canvas
- https://web.dev/articles/device-pixel-content-box
- https://web.dev/articles/bfcache
- https://web.dev/articles/streams
- https://web.dev/articles/indexeddb-best-practices-app-state
- https://web.dev/articles/storage-for-the-web
- https://web.dev/articles/origin-private-file-system
- https://web.dev/articles/monitor-total-page-memory-usage
- https://web.dev/articles/adaptive-loading-cds-2019
- https://web.dev/articles/webassembly-threads
- https://web.dev/articles/fetch-priority (local copy saved by another agent)
- https://web.dev/blog/navigation-preload
- https://developer.chrome.com/release-notes/148
- https://developer.chrome.com/blog/extended-lifetime-shared-workers-origin-trial
- https://developer.chrome.com/blog/document-isolation-policy
- https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- https://developer.chrome.com/docs/web-platform/deprecating-unload
- https://developer.chrome.com/blog/timer-throttling-in-chrome-88 (local copy saved by another agent)
- https://developer.chrome.com/docs/web-platform/long-animation-frames (local copy saved by another agent)
- https://developer.chrome.com/docs/web-platform/soft-navigations
- https://developer.chrome.com/blog/indexeddb-durability-mode-now-defaults-to-relaxed
- https://developer.chrome.com/docs/workbox/caching-resources-during-runtime
- https://developer.chrome.com/docs/devtools/memory-problems
- https://developer.chrome.com/docs/devtools/performance/extension
- https://developer.chrome.com/docs/capabilities/web-apis/websocketstream
- https://developer.chrome.com/docs/web-platform/compute-pressure
- https://developer.chrome.com/blog/new-in-chrome-152
- https://chromestatus.com/feature/5141940204208128 (Document-Isolation-Policy, via API)
- https://chromestatus.com/feature/5136946693668864 (skip no-op fetch handler, via API)
- https://chromestatus.com/feature/5185352976826368 (SW static routing, via API)
- https://chromestatus.com/feature/5189864286978048 (CPU Performance API, via API)
- https://html.spec.whatwg.org/multipage/workers.html
- https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html
- https://dom.spec.whatwg.org/
- https://drafts.csswg.org/resize-observer/ (local copy saved by another agent, "ResizeObserver Lifetime")
- https://w3c.github.io/timing-entrytypes-registry/
- https://wicg.github.io/cpu-performance/
- https://webkit.org/blog/17640/webkit-features-for-safari-26-2/
- https://webkit.org/blog/18325/webkit-features-for-safari-27-0/
- https://v8.dev/docs/wasm-compilation-pipeline
- https://v8.dev/blog/wasm-code-caching
- https://hacks.mozilla.org/2018/10/calls-between-javascript-and-webassembly-are-finally-fast-%F0%9F%8E%89/
- https://github.com/GoogleChrome/web-vitals (README.md, CHANGELOG.md) and https://registry.npmjs.org/web-vitals
- https://surma.dev/things/is-postmessage-slow/ (blog)
- https://surma.dev/things/js-to-asc/ (blog)
- https://nolanlawson.com/2020/02/19/fixing-memory-leaks-in-web-applications/ (blog)
- https://nolanlawson.com/2021/08/22/speeding-up-indexeddb-reads-and-writes/ (blog)
- web-features dataset (web-features.json, Chrome 153 / Safari 27 snapshot) and @mdn/browser-compat-data 8.1.2 (2026-09-17), downloaded by another agent into the shared raw folder
- Search results only (not opened): Chrome 141 getAllRecords release notes/intent (350 ms figure), Chrome intensive-throttling enterprise policy page

## Not covered / could not access
- Could not confirm whether dedicated-worker timers are exempt from Chrome's intensive wake-up throttling in hidden tabs; no primary source found. Do not rely on it.
- Could not verify whether SciChart.js can render from a worker with OffscreenCanvas; check the vendor docs before planning worker rendering.
- `https://developer.chrome.com/docs/web-platform/service-worker-static-routing` returned 404; used MDN and chromestatus instead.
- MDN has no page for `navigator.cpuPerformance` yet (404); used the WICG spec, BCD, and Chrome 152 notes.
- The web-features snapshot lags Safari 27 for some items (transferable streams); status for those was derived from the webkit.org release post plus BCD.
- Did not quantify Cache API or localStorage internal costs (for example, first-access load of the whole localStorage map); no primary source read.
- Float16Array (Baseline 2025) and other JS-language features are left to the V8/JS notes; WebGL/WebGPU buffer APIs are left to the GPU notes; scheduling APIs are summarized only.
- No local benchmarks were run; all numbers come from the cited sources.
