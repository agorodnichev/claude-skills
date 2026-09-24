# SciChart.js performance (v5, with v6-alpha notes)

Scope: code-level levers for SciChart.js v5 (latest stable on npm is 5.2.69, published 2026-09-08; 6.0.0-alpha.196 published 2026-09-22) covering DataSeries ingestion, resampling, redraw control, multi-chart layouts, text and annotations, animation, WebAssembly (wasm) memory lifetime, wasm loading, and the WebGPU/Memory64 work in v6 alpha.
Sources: the v5 docs (performance tips, memory pages, DataSeries API, suspend/manual-render/render-events, native text, SubCharts, what's-new and breaking-change pages, plus a keyword sweep of all 363 v5 doc pages from the sitemap), the SciChart.js changelog and blog, and the published package source on jsDelivr (5.2.69 and 6.0.0-alpha.196). Where the prose docs and the shipped source disagree, the notes say so and trust the source.

Version legend used below: "v3.2+", "v4.0+", "v5.0+" means the API exists from that release (first npm releases: 3.2 = 2023-07, 3.5 = 2024-10, 4.0 = 2025-08, 5.0 = 2026-01, 5.1 = 2026-03, 5.2 = 2026-05, per the npm registry).

---

## A. DataSeries ingestion (the hot path for live trading data)

### Append in batches with appendRange, never point by point
- Layer: js
- Stage: script-run, main-thread-task
- Metrics: INP, FPS/smoothness, TBT
- When: animation/render-loop, long-lived session
- Impact: high, the docs measure 100k single appends at 69 ms against 1 ms for one appendRange call.
- Do: Push new points with `appendRange(xs, ys)`, `insertRange(i, xs, ys)` and `removeRange(i, count)`. Do not loop over `append`, `insert` or `removeAt`. For OHLC use the OHLC form of `appendRange` (x, open, high, low, close arrays).
- Why: Each single-point call crosses the JS-to-wasm boundary, updates distribution state and raises a data-changed notification that invalidates the surface. A range call does this once per batch. The docs say the gap is largest for insert and remove.
- Example:
  ```ts
  // Before: one wasm call + one invalidate per tick
  for (const t of ticks) series.append(t.time, t.price);

  // After: one call per batch
  xBuf.set(times, 0); yBuf.set(prices, 0);
  series.appendRange(xBuf.subarray(0, n), yBuf.subarray(0, n));
  ```
- Avoid/caveats: The changelog also notes a Chrome slowdown when a chart is invalidated very rapidly by per-point append/insert/update calls, and repeats that appendRange is preferred.
- Status: All versions. appendRange got a further 50-100% boost in v3.2 and 2.4x faster append-line charts in v5.0 (release notes).
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/append-insert-update-remove/ ; https://www.scichart.com/changelog/scichart-js/

### Coalesce streaming ticks into one appendRange per animation frame
- Layer: js
- Stage: script-run, main-thread-task, microtask
- Metrics: FPS/smoothness, INP, TBT
- When: animation/render-loop, long-lived session
- Impact: high, the engine draws at most once per frame anyway, so work done more often than once per frame is wasted.
- Do: Buffer incoming WebSocket ticks into typed arrays and drain them once per `requestAnimationFrame` with a single `appendRange` per series. Keep chart data out of framework state (React/Svelte stores); write it straight to the DataSeries.
- Why: SciChart debounces redraws so the chart draws at most once per 1/60 s regardless of how many data changes happen, but every data call still costs CPU. SciChart's own v6 F1 telemetry demo uses one rAF loop that drains column-oriented typed-array buffers and hands each chart its slice, and decodes the socket in a worker.
- Example:
  ```ts
  const pendX = new Float64Array(4096), pendY = new Float64Array(4096);
  let n = 0;
  socket.onmessage = (e) => { const t = decode(e.data); pendX[n] = t.x; pendY[n] = t.y; n++; };
  const pump = () => {
    if (n > 0) { series.appendRange(pendX.subarray(0, n), pendY.subarray(0, n)); n = 0; }
    requestAnimationFrame(pump);
  };
  requestAnimationFrame(pump);
  ```
- Avoid/caveats: rAF stops in background tabs; if the socket keeps writing, the pending buffer must be bounded or flushed (see fifoCapacity). Subarray views passed to appendRange are copied into wasm, so reusing the backing buffer after the call is safe.
- Status: Pattern, all versions. The worker/broker pattern comes from a SciChart blog post, not from the API docs.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/realtime-updates/ ; https://www.scichart.com/blog/scichart-js-v6-in-alpha-webgpu-incredible-performance-gains-and-more/

### Declare dataIsSortedInX and containsNaN when you create the series
- Layer: js
- Stage: script-run
- Metrics: FPS/smoothness, INP, startup
- When: load, animation/render-loop
- Impact: medium, the docs measure 1M-point creation at 55 ms without flags and 11 ms with them, and say updates get about 5x faster.
- Do: Pass `dataIsSortedInX: true` (alias `isSorted`) and `containsNaN: false` in the constructor options when you know them. If the data later changes shape, set `series.isSorted` / `series.containsNaN` again.
- Why: When flags are undefined, SciChart scans the data on every append/insert/update to detect sort order and NaN, then picks drawing, hit-test and resampling algorithms. Given flags skip that scan.
- Example:
  ```ts
  const candles = new OhlcDataSeries(wasmContext, {
    dataIsSortedInX: true,
    containsNaN: false,
    capacity: 50_000,
  });
  ```
- Avoid/caveats: The docs warn that wrong flags give undefined behaviour (wrong drawing, wrong hit-tests). If you set `containsNaN: false` and later append NaN gaps, update the flag. In dev builds SciChart prints a one-time console warning suggesting these flags (`SciChartDefaults.performanceWarnings`, default true).
- Status: v2.x+. In 5.2.69 source, `isSorted` and `containsNaN` default to undefined (auto-detect).
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/data-series-api-overview/ ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/resampling/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.js ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/constants/performanceWarnings.js

### Set dataEvenlySpacedInX only when X spacing is truly uniform
- Layer: js
- Stage: script-run, gpu-draw
- Metrics: FPS/smoothness
- When: load, animation/render-loop
- Impact: medium, it selects the faster evenly-spaced resamplers, but a wrong value gives wrong output.
- Do: Pass `dataEvenlySpacedInX: true` only for fixed-step X (bar index, fixed sample rate without gaps). For Unix-time candles with weekend/session gaps, leave it unset (false).
- Why: The resampling modes `MinMax`, `Mid`, `Min`, `Max` assume evenly spaced data; `MinMaxWithUnevenSpacing` does not. `Auto` picks one based on the flags.
- Avoid/caveats: Docs conflict with source. The docs list "evenly spaced" as auto-detected and the d.ts comment says the flag "defaults to true", but the 5.2.69 constructor sets `isEvenlySpacedProperty = false` and has no detection for it. Treat false as the real default.
- Status: v2.x+; behaviour read from 5.2.69 source.
- Sources: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.js ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.d.ts ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Numerics/Resamplers/ResamplingMode.d.ts

### Keep time-series data sorted in X
- Layer: js
- Stage: script-run, gpu-draw
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, interaction
- Impact: high, the docs rate it a large rendering win on all browsers.
- Do: Append in time order. If a late tick arrives, update the last bar or drop it instead of inserting out of order. Use scatter (unsorted) only when the data really is unordered.
- Why: Hit-test (cursors, tooltips), indexing of the visible range and drawing all have faster paths for sorted X. Unsorted data forces full scans.
- Avoid/caveats: v5 made unsorted scatter/line up to 2.2x/1.7x faster, but sorted is still the fast path.
- Status: All versions.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/

### Pre-size DataSeries with capacity when the final size is known
- Layer: js
- Stage: script-run, gc-memory
- Metrics: memory, FPS/smoothness
- When: load, long-lived session
- Impact: low, the docs measure 22 ms against 15 ms for 1M points.
- Do: Pass `capacity: expectedCount` in the constructor, or set `series.capacity = n` before a large load.
- Why: DataSeries grow geometrically, so many appends cause several reallocations and copies of the wasm vectors. The d.ts also says a larger initial capacity avoids memory fragmentation (wasm memory never shrinks).
- Avoid/caveats: Do not over-reserve on many series; the memory is held until delete(). The docs example has a bug: it declares `CAPACITY = 1_000_000` but passes `capacity: COUNT` (10k).
- Status: All versions.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/get-set-value-at-index/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.d.ts

### Use fifoCapacity for rolling windows instead of removeRange + appendRange
- Layer: js
- Stage: script-run, gc-memory
- Metrics: memory, FPS/smoothness
- When: long-lived session, animation/render-loop
- Impact: high for streaming charts, it bounds memory and v5 made FIFO scrolling lines up to 3.9x faster than v4.
- Do: Create the series with `fifoCapacity: N` and only call `appendRange`. Scroll with an increasing X plus a moving `visibleRange`, or use a CategoryAxis.
- Why: FIFO mode pre-allocates a circular buffer of N points and overwrites the oldest points, so no shifting, no reallocation and no unbounded growth.
- Example:
  ```ts
  // Before: memory copy on every tick
  series.removeRange(0, xs.length); series.appendRange(xs, ys);
  // After
  const series = new XyDataSeries(wasmContext, { fifoCapacity: 5_000, dataIsSortedInX: true, containsNaN: false });
  series.appendRange(xs, ys);
  ```
- Avoid/caveats: `fifoCapacity` can only be set in the constructor; a FIFO series cannot be resized and does not support insert/insertRange/remove/removeRange. The 5.2.69 d.ts says spline and stacked series do not support FIFO, while the v3.5 changelog says spline and RenderDataTransform series do. Test before relying on FIFO with those types.
- Status: v3.2+.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/realtime-updates/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.d.ts ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/ ; https://www.scichart.com/changelog/scichart-js/

### Use fifoSweeping for wrap-around (ECG-style) displays
- Layer: js
- Stage: script-run
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, it gives a sweep display with no data shifting.
- Do: Set `fifoCapacity`, `fifoSweeping: true` and optionally `fifoSweepingGap`. Use a CategoryAxis, or a NumericAxis with `x % fifoCapacity`.
- Why: Sweeping draws the circular buffer without unwrapping it first.
- Avoid/caveats: X values outside 0..fifoCapacity on a NumericAxis break the sweep.
- Status: v3.2+.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/realtime-updates/

### Pass Float64Array buffers and reuse them
- Layer: js
- Stage: script-run, gc-memory
- Metrics: memory, TBT, FPS/smoothness
- When: animation/render-loop, long-lived session
- Impact: low to medium, the docs measure 24 to 21 ms for Float64Array and 40 to 24 ms for buffer reuse (1M points in 10k batches).
- Do: Allocate `Float64Array` scratch buffers once per series or per feed, fill them each frame, and pass them (or `subarray` views) to `appendRange`.
- Why: A typed array copies into the wasm heap without per-element boxing checks. Reusing the buffer removes per-frame allocations and GC work.
- Avoid/caveats: `NumberArray` in the d.ts is `number[] | Float64Array` only; do not pass Float32Array or Int arrays. v5 also accepts Float64Array for UniformHeatmapDataSeries (`Float64Array[]`), UniformGridDataSeries3D and XyzDataSeries3D.
- Status: Float64Array input for 2D XY since early versions; heatmap/3D Float64Array v5.0+.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/types/NumberArray.d.ts ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/

### Replace data with clear() + appendRange() on the same series
- Layer: js
- Stage: script-run, gc-memory
- Metrics: memory, FPS/smoothness
- When: animation/render-loop
- Impact: medium, it avoids creating and deleting wasm objects every update.
- Do: For "replace everything" views (order-book depth, spectrum, reloaded history), keep one DataSeries and call `clear()` then `appendRange()`. Do not assign a new DataSeries each time.
- Why: `clear()` removes points but keeps the reserved wasm memory, so the next load needs no reallocation. A new DataSeries per update allocates wasm memory and leaks it unless you delete the old one.
- Avoid/caveats: Because `clear()` keeps capacity, a series that once held 10M points keeps that memory; delete and recreate it if the size drops for good.
- Status: All versions.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/realtime-updates/ ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/deleting-memory/

### Read DataSeries values back with vectorToArrayViewF64, not get(i) loops
- Layer: js
- Stage: script-run
- Metrics: INP, TBT
- When: interaction (export, custom indicators, hit-testing in app code)
- Impact: high for bulk reads, the docs table shows 1M points at 400 ms with `getNativeXValues().get(i)`, 62 ms with `vectorToArray()` (deep copy), 4 ms with `vectorToArrayViewF64()` (view).
- Do: Use `vectorToArrayViewF64(series.getNativeXValues(), wasmContext)` for a fast read, and use the view at once. Use `vectorToArray()` when you need a stable copy to pass around. To clone a series, set `dest.capacity = src.count()` first, then `dest.appendRange(viewX, viewY)` (1M points about 13 ms).
- Why: The view maps the wasm heap directly; get(i) crosses into wasm per element.
- Example:
  ```ts
  const xs = vectorToArrayViewF64(series.getNativeXValues(), wasmContext);
  const ys = vectorToArrayViewF64(series.getNativeYValues(), wasmContext);
  const last = ys[series.count() - 1]; // use now, do not store xs/ys
  ```
- Avoid/caveats: The view is not a copy. If any series grows, wasm memory may move and the view's buffer detaches (TypeError on detached ArrayBuffer). Never keep the view across frames. Writing through the view mutates chart data without notifications.
- Status: v4.0.873+.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/get-set-value-at-index/

### Update heatmaps in place and prefer the uniform heatmap
- Layer: js
- Stage: script-run, gpu-upload
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, heatmap updates are full texture uploads; v5 made real-time 2D heatmaps up to 2x faster.
- Do: Mutate the existing z array and call `heatmapDataSeries.notifyDataChanged()`, or call `setZValues(newArray)`. Use `UniformHeatmapRenderableSeries` when cells are equal size; use the non-uniform heatmap only when needed.
- Why: Heatmap series have no append/insert API; the whole grid is re-sent. The non-uniform type does extra per-cell work (the docs say uniform is faster).
- Avoid/caveats: v5 lifted the old 4000x4000 limit up to the GPU's max texture size (for example 16384x16384); large textures cost GPU memory. 5.2.55 added a non-uniform heatmap caching fix (3-5x FPS) per the changelog.
- Status: v5.0+ for Float64Array[] and larger grids.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/uniform-heatmap-renderable-series/updating-realtime/ ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/non-uniform-heatmap-renderable-series/ ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/ ; https://www.scichart.com/changelog/scichart-js/

---

## B. Resampling (point reduction)

### Leave resampling on Auto; never ship debugDisableResampling
- Layer: gpu
- Stage: script-run, gpu-upload, gpu-draw
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, interaction
- Impact: high, resampling is what lets SciChart draw 10M points in under 25 ms (docs claim).
- Do: Keep `resamplingMode: EResamplingMode.Auto` (default) and `SciChartDefaults.debugDisableResampling = false` (default). Use `EResamplingMode.None` per series only for small series that must show every vertex.
- Why: Auto picks a min-max style reducer from the series type, data size and distribution flags. It keeps peaks and troughs, so the result looks the same but draws far fewer vertices. Gains start around 100,000 points; below 1M points it barely matters.
- Avoid/caveats: `resamplingPrecision` default 0; 1 doubles output points for about 20% more cost. Other modes (`MinMax`, `Mid`, `Min`, `Max`, `MinMaxWithUnevenSpacing`, experimental `MinOrMax`) should stay unused unless SciChart support advises. The global flag was renamed from `enableResampling` to `debugDisableResampling` in v3.5. v5 SIMD speeds resampling 2-4x.
- Status: v2.1+; SIMD speed-up v5.0+.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/resampling/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Numerics/Resamplers/ResamplingMode.d.ts ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/

### Do not pre-downsample in the browser; aggregate on the server for long history
- Layer: network
- Stage: network, script-run
- Metrics: bundle-size, memory, startup, TTFB
- When: load
- Impact: medium, it cuts bytes over the wire and wasm memory for multi-year history.
- Do: Send pre-aggregated bars (1m/1h/1d rollups) for long ranges and fetch finer data for the zoomed window. Do not run your own LTTB/min-max in JS before handing data to a sorted SciChart series.
- Why: SciChart already resamples sorted series on every draw, so a JS downsampler duplicates work on the main thread. Server aggregation is the lever that reduces network and memory, which resampling does not.
- Avoid/caveats: This rule comes from a SciChart blog post plus the resampling docs; it is an inference, not a documented SciChart rule.
- Status: Pattern.
- Sources: https://www.scichart.com/blog/how-to-visualize-millions-of-data-points-efficiently/ ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/resampling/

### Keep spline interpolationPoints low
- Layer: gpu
- Stage: script-run, gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, N interpolation points multiply the drawn vertex count by N.
- Do: Use FastLineRenderableSeries for dense data; if you need a spline, keep `interpolationPoints` small or lower it as the zoom-out point count grows.
- Why: Each real point becomes `interpolationPoints` generated points; 0 draws a plain line. v5 made the spline/Bezier transform up to 4.6x faster, but the multiplier remains.
- Status: All versions.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/spline-line-renderable-series/ ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/

---

## C. Redraw control and the render loop

### Know the render loop: invalidate, then one draw on the next frame
- Layer: js
- Stage: main-thread-task, gpu-draw, composite
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: high, it tells you where to batch and what not to do per event.
- Do: Treat every property set, data call, series add or resize as "invalidate". Group many changes into one frame. Do not call `invalidateElement()` in a loop.
- Why: A change issues an internal invalidate; the engine's `requestAnimationFrame` loop draws each invalidated surface once on the next frame. Resize, DPR change and tab visibility changes use a forced invalidate that ignores suspension. `SciChartSurface.invalidateOnTabVisible` (default true) redraws when a tab becomes visible because hidden tabs can lose canvas content.
- Status: v5 docs; rAF-based loop in all versions.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/batching-updates-or-temporary-suspending-drawing/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurfaceBase.d.ts

### Wrap multi-step updates in suspendUpdates / resumeUpdates (or suspender.lock)
- Layer: js
- Stage: main-thread-task, gpu-draw
- Metrics: FPS/smoothness, INP
- When: interaction, animation/render-loop
- Impact: medium, it prevents intermediate frames and visual tearing when you change several things.
- Do: Call `surface.suspendUpdates()`, make all changes (series, axes, visibleRange, annotations), then `surface.resumeUpdates()`. Prefer `const unlock = surface.suspender.lock(); ... unlock();` when other code might force-resume. Create charts with `createSuspended: true` (or `SciChartDefaults.createSuspended`) when you build them in several async steps.
- Why: While suspended, invalidate requests are ignored; resume can trigger one redraw (`invalidateOnResume`).
- Example:
  ```ts
  surface.suspendUpdates();
  try {
    candleSeries.dataSeries.appendRange(t, o, h, l, c);
    volumeSeries.dataSeries.appendRange(t, v);
    xAxis.visibleRange = new NumberRange(from, to);
  } finally {
    surface.resumeUpdates({ invalidateOnResume: true });
  }
  ```
- Avoid/caveats: suspend/resume is counter-based; every suspend needs one resume (or `resumeUpdates({ force: true })`). A forgotten resume or unlock freezes the chart, including mouse input. Check `surface.isSuspended` when debugging.
- Status: Suspend API all versions; `suspender.lock`, `createSuspended`, `nextStateRender` documented in v5 (createSuspended added in a v3.x release per changelog).
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/batching-updates-or-temporary-suspending-drawing/ ; https://www.scichart.com/changelog/scichart-js/

### Drive rendering yourself only when you own the frame loop (disableEngineLoop)
- Layer: js
- Stage: main-thread-task, gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, it lets several charts and non-chart canvases paint on the same tick.
- Do: Create with `disableEngineLoop: true` and call `wasmContext.TSRRequestDraw()` from your own rAF after you apply data. For a temporary batch, use `wasmContext.TSRSetDrawRequestsEnabled(false)`, apply updates, call `TSRRequestDraw()`, then re-enable.
- Why: `TSRRequestDraw()` immediately draws every invalidated surface on that wasm context; `TSRRequestCanvasDraw(id)` only marks one canvas.
- Avoid/caveats: The setting applies to the whole context: with `create()` it changes every chart that shares it; 2D, 3D and every `createSingle()` chart have separate contexts that each need a call. A resize clears the canvas; if the container has no fixed CSS size, a resize arrives right after init and blanks your first manual draw, so draw inside rAF after layout.
- Status: v5.0+ (new in v5 per what's-new).
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/manual-render/ ; https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/

### Hook the right render event so changes land in the same frame
- Layer: js
- Stage: main-thread-task, layout
- Metrics: FPS/smoothness
- When: animation/render-loop, interaction
- Impact: medium, a change in the wrong hook costs an extra full frame.
- Do: Style changes in `preRender`/`preRenderAll`; visible-range or layout changes in `genericAnimationsRun`; annotation repositioning that needs coordinates or hit-tests in `layoutMeasured`. Custom WebGL drawing in `renderedToWebGL`, 2D canvas overlay drawing in `renderedToDestination`.
- Why: Handlers that run before layout measurement suspend invalidation, so changes made there show in the current frame without requesting a new one. v5 moved Rollover/Cursor/VerticalSlice to SVG-only updates, so code that read their annotation positions in `preRender` must move to `layoutMeasured`.
- Avoid/caveats: Do not change data or visible range in `layoutMeasured` (changelog warns). `redrawRequested` and `preRenderAll` fire only on the parent surface, not sub-charts.
- Status: `layoutMeasured` added in a v3.x release; v5 migration note.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/render-events/ ; https://www.scichart.com/documentation/js/v5/whats-new/breaking-changes-v4-v5/ ; https://www.scichart.com/changelog/scichart-js/

### Measure chart frames with render events and PerformanceDebugHelper
- Layer: tooling
- Stage: gpu-draw, composite, main-thread-task
- Metrics: FPS/smoothness, startup
- When: testing
- Impact: medium, it gives per-chart render time instead of guessing.
- Do: Time `preRenderAll` to `renderedToDestination` (render) and to `painted` (frame committed). Create with `createSuspended: true` and `await surface.nextStateRender({ resumeBefore: true, invalidateOnResume: true, suspendAfter: false })` to time the first frame. Turn on `PerformanceDebugHelper.enableDebug = true` to get SciChart's `performance.mark` entries (engine init, invalidate, data update, render) and read them with `PerformanceDebugHelper.getMeasures()` or `outputLogs()`.
- Why: With `create()`, a frame is "render to shared WebGL canvas" plus "copy to 2D canvas"; `renderedToWebGL` splits the two. `receiveNextEvent(surface.painted)` promisifies one event.
- Avoid/caveats: Leave the debug helper off in production. Keep `SciChartDefaults.performanceWarnings` on in development; its one-time warnings flag missing data flags, over-generated data labels, label cache churn and missing no-SIMD wasm.
- Status: v5 docs; PerformanceDebugHelper added in a v3.x release.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/render-events/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/utils/performance.d.ts ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/constants/performanceWarnings.js

---

## D. Many charts on one page

### Set freezeWhenOutOfView on charts inside scroll views, tabs or collapsible panels
- Layer: gpu
- Stage: gpu-draw, composite, main-thread-task
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, long-lived session
- Impact: high, in SciChart's 100-chart React demo it moved FPS from 13 to 57-60 with 20-30 charts visible.
- Do: Pass `freezeWhenOutOfView: true` to `SciChartSurface.create()` / `createSingle()` (or set the property) for every chart that can leave the viewport.
- Why: SciChart uses IntersectionObserver plus the suspend API to stop drawing surfaces that are not visible; data updates still apply and the chart redraws when it scrolls back.
- Avoid/caveats: Data still accumulates while frozen, so pair it with `fifoCapacity` for live feeds. Charts hidden by `display:none` or zero size are a different case; not documented whether freeze covers them. IntersectionObserver is Baseline widely available (webstatus).
- Status: v3.5.727+.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://www.scichart.com/blog/creating-a-react-drag-drop-chart-dashboard/ ; https://api.webstatus.dev/v1/features/intersection-observer

### Group dense panel layouts into SubCharts on one parent surface
- Layer: gpu
- Stage: gpu-draw, composite
- Metrics: FPS/smoothness, memory, startup
- When: animation/render-loop
- Impact: high, SciChart's 128-chart test went from 13 FPS (separate charts with native text) to 28.9 FPS with SubCharts, and the docs report 10x for hundreds of charts.
- Do: For a trading layout with price + indicator panes, or a grid of mini charts, create one `SciChartSurface` and add panes with `SciChartSubSurface.createSubSurface(parent, { position: new Rect(x, y, w, h), ... })`. Link X axes for synchronised zoom.
- Why: All sub-charts share one WebGL canvas, one context and one draw loop, so the engine batches draw calls and does one copy to screen instead of one per chart. The docs say this helps most on Firefox and Safari, which are slow at copying WebGL output to many canvases.
- Avoid/caveats: With `isTransparent: false`, the sub-chart background must be a plain color, not a gradient (SciChart prints a performance warning). Sub-charts render in insertion order after the parent.
- Status: v3.0+ (SubCharts API).
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/subcharts-api/subcharts-api-overview/ ; https://www.scichart.com/documentation/js/v5/2d-charts/subcharts-api/exampe-dynamic-multi-panel-charts-with-sub-charts/ ; https://www.scichart.com/blog/pushing-the-boundaries-of-javascript-chart-dashboard-performance/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/constants/performanceWarnings.js

### Default to SciChartSurface.create(); use createSingle() only for a few heavy charts
- Layer: gpu
- Stage: gpu-draw, composite, script-compile, gc-memory
- Metrics: FPS/smoothness, memory, startup
- When: load, animation/render-loop
- Impact: medium, it trades draw speed against memory, startup time and the WebGL context limit.
- Do: Use `create()` (one shared engine and WebGL context, readback copy per chart) for dashboards. Use `createSingle()` (one engine and context per chart) only for a small number of very heavy charts, mainly to help Firefox/Safari.
- Why: The shared path pays a GPU-to-2D-canvas copy per chart each frame; the single path avoids the copy but instantiates a wasm engine per chart (up to 80 MB static buffers each at default `wasmBufferSizesKb`) and consumes a WebGL context. Browsers cap live contexts; SciChart's table gives about 16 for Chrome/Edge/Safari desktop and iOS, 8 for Chrome Android, 300 for Firefox; past the cap the browser drops the oldest contexts.
- Avoid/caveats: The 16-context figure is SciChart's approximation. In v5, the first `create()` chart initialises in about 250 ms on an empty cache and later charts in under 10 ms. In v6 with WebGPU the readback cost disappears (see F).
- Status: All versions.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-best-practices/ ; https://www.scichart.com/documentation/js/v5/2d-charts/surface/new-scichart-surface/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartDefaults.js

### Strip axis decoration on small or numerous charts
- Layer: gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, in the 100-chart demo it moved FPS from 30-40 to 60.
- Do: On small panels set `drawMinorGridLines: false`, `drawMinorTickLines: false`, `drawMajorTickLines: false`, `drawMajorBands: false`, and cap labels with `maxAutoTicks: 5`; hide labels (`drawLabels: false`) where they are not read.
- Why: Each axis can add about 10 major and 50 minor gridlines plus ticks; across 100 charts that is thousands of extra primitives and labels per frame.
- Status: All versions.
- Sources: https://www.scichart.com/blog/creating-a-react-drag-drop-chart-dashboard/ ; https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/

### Keep native text and the shared label cache on for axis labels
- Layer: gpu
- Stage: gpu-draw, raster
- Metrics: FPS/smoothness, startup
- When: animation/render-loop, load
- Impact: high on multi-chart screens, the 100-chart demo ran at 5.5 FPS with canvas labels and no cache, 60 FPS with native text and cache.
- Do: Leave `SciChartDefaults.useNativeText = true` and `SciChartDefaults.useSharedCache = true` (both default true since v4.0). Override per axis with `useNativeText` / `useSharedCache` options. If you override `getLabelTexture`, make each text+style combination unique so the shared cache does not return a wrong texture.
- Why: Native text draws labels with WebGL from a font atlas; the shared cache reuses label textures across axes and charts, so switching to a chart with the same labels skips recreation.
- Avoid/caveats: Docs conflict with source: the v5 performance-tips page says `useSharedCache` "is not enabled by default", but `SciChartDefaults.js` sets it to true in 4.0.933 and 5.2.69 (false in 3.5.727). Native text does not support `fontStyle`/`fontWeight`; custom fonts must be hosted as `.ttf` or loaded with `await surface.registerFont(name, url)` (fallback after `nativeFontTimeout`, default 2000 ms; no 302 redirects). If `labelCache` warns it grows too fast, tune `labelCache.setMaxSize()` / `setMinAge()` (min age default 200 ms). Async labels are deprecated.
- Status: Native text v3.0+, default on v4.0+; shared cache default on v4.0+; label cache pruning and leak fixes in v5.1.0.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartDefaults.js ; https://www.scichart.com/documentation/js/v5/typedoc/classes/scichartdefaults.html ; https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/native-text-api/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/Axis/LabelProvider/LabelCache.d.ts ; https://www.scichart.com/blog/creating-a-react-drag-drop-chart-dashboard/

### Turn native text off only to cut first-chart startup when labels are static
- Layer: gpu
- Stage: script-run, gpu-upload
- Metrics: startup, LCP
- When: load
- Impact: low, it saves the font atlas build on first chart.
- Do: Set `SciChartDefaults.useNativeText = false` before the first chart only for pages with one or two charts whose labels rarely change.
- Why: Native text needs a font atlas at init; canvas labels skip that but cost more per frame.
- Avoid/caveats: It hurts FPS on multi-chart or fast-zooming charts. v5 changed the default native font from Arial to Arimo (`SciChartDefaults.autoFontName`).
- Status: v4.0+.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://www.scichart.com/documentation/js/v5/whats-new/breaking-changes-v4-v5/

### Set autoColorMode to Never or Once when you give series explicit colors
- Layer: js
- Stage: script-run
- Metrics: FPS/smoothness
- When: load, interaction
- Impact: low, the docs say auto coloring can cost with many series.
- Do: Set `surface.autoColorMode = EAutoColorMode.Never` (or `Once`) when strokes/fills are set in code.
- Why: The default `OnAddRemoveSeries` re-resolves AUTO_COLOR whenever the series collection changes; `Always` does it every render.
- Status: All v5.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/styling-and-theming/auto-coloring/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/types/AutoColorMode.d.ts

---

## E. Annotations, tooltips and data labels

### Prefer render-context annotations over SVG and HTML annotations
- Layer: gpu
- Stage: gpu-draw, layout, style, paint
- Metrics: FPS/smoothness, INP
- When: interaction, animation/render-loop
- Impact: medium to high with many annotations, the changelog reports about 300 ms for the first frame of 1000 SVG annotations.
- Do: Use `NativeTextAnnotation`, `LineAnnotation`, `HorizontalLineAnnotation`, `VerticalLineAnnotation`, `BoxAnnotation`, `AxisMarkerAnnotation` (all extend `RenderContextAnnotationBase`, drawn in WebGL). Use `TextAnnotation` / `CustomAnnotation` (SVG) or `HtmlTextAnnotation` / `HtmlCustomAnnotation` (DOM) only for features WebGL cannot do.
- Why: SVG and DOM annotations create and measure DOM nodes, so the browser runs style, layout and paint for them; render-context annotations are batched into the WebGL frame.
- Avoid/caveats: Keep `SciChartDefaults.alwaysRedrawFullChartOnSvgChange = false` (default) so SVG-only annotation edits do not redraw the whole chart (v5.0+); per annotation, `reDrawChartOnChange` controls it.
- Status: Class hierarchy from 5.2.69 source; SVG-only redraw behaviour v5.0+.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/annotations-api/html-annotation/ ; https://www.scichart.com/documentation/js/v5/2d-charts/annotations-api/native-text-annotation/ ; https://www.scichart.com/changelog/scichart-js/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartDefaults.js

### Keep isSvgOnly on for cursor and rollover tooltips
- Layer: js
- Stage: main-thread-task, style, paint
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: high on big datasets, a mouse move no longer triggers a WebGL redraw of millions of points.
- Do: Leave `isSvgOnly: true` (default) on `CursorModifier`, `RolloverModifier` and `VerticalSliceModifier`. Do not set it to false for styling reasons unless you accept a full redraw per mouse move.
- Why: With SVG-only mode, crosshair and tooltip updates change only the SVG layer above the WebGL canvas.
- Avoid/caveats: Code that repositions annotations from modifier state belongs in `layoutMeasured` (v5 breaking change).
- Status: v5.0+ (default true in 5.2.69 d.ts).
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-modifier-api/cursor-modifier/cursor-modifier-overview/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/ChartModifiers/RolloverModifier.d.ts ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/

### Limit data labels before SciChart has to generate them
- Layer: gpu
- Stage: script-run, gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop, interaction
- Impact: medium, the default overlap skip still formats and measures every label before it throws most away.
- Do: Set `skipNumber` (labels generated = points / (skipNumber + 1)), or `pointGapThreshold` (about 1 for evenly spaced smooth data) or `pointCountThreshold` (for jagged data) so labels appear only when zoomed in. Set `calculateTextBounds: false` when label size does not matter. Override `shouldGenerate` for a custom rule.
- Why: The default `skipMode` `SkipIfOverlapPrevious` computes text, size and position for all labels. SciChart warns in the console when more than 80% are skipped.
- Status: v3.0+ data labels API.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-point-labels/data-label-skip-modes-and-culling/ ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-point-labels/data-label-positioning/

### In custom native-text drawing, batch and avoid early flushes
- Layer: gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: low, it matters for custom annotations/series that draw lots of text.
- Do: Get fonts with `renderContext.getFont(...)` (cached; do not delete); request `advanced: true` (signed distance field) only for rotated or scaled text. Avoid calling `font.End()` yourself; avoid `drawImmediate` on `NativeTextAnnotation` and `renderNativeAxisLabelsImmediately` unless layering needs it.
- Why: Native text is queued and drawn in one batch at the end of the render; each early `End()` or immediate draw splits the batch. SDF fonts use more memory and are slower to first frame.
- Status: v3.0+ native text API.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/native-text-api/ ; https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/ordered-rendering/

---

## F. Per-point styling, transforms and filters

### Make custom PaletteProviders cacheable (shouldUpdatePalette, isRangeIndependant)
- Layer: js
- Stage: script-run, gpu-upload
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, interaction
- Impact: medium to high, without it the palette callback runs for every vertex on every render, including pure pan/zoom frames.
- Do: In a custom palette provider, implement `shouldUpdatePalette()` and return false when inputs have not changed; set `isRangeIndependant = true` when colors do not depend on the visible range.
- Why: The interface comment says a missing `shouldUpdatePalette` means a recompute on every render; the built-in `DefaultPaletteProvider.shouldUpdatePalette()` returns true in 5.2.69, so the "reuse by default in v4" plan announced in the changelog did not land for the default class.
- Example:
  ```ts
  class UpDownPalette extends DefaultPaletteProvider {
    private dirty = true;
    get isRangeIndependant() { return true; }
    shouldUpdatePalette() { const d = this.dirty; this.dirty = false; return d; }
    markDirty() { this.dirty = true; }
    overrideStrokeArgb(x: number, y: number, i: number, opacity?: number, meta?: IPointMetadata) {
      return y >= 0 ? 0xff26a69a : 0xffef5350;
    }
  }
  ```
- Avoid/caveats: Call your `markDirty()` whenever data or thresholds change, or colors go stale. v5 made PaletteProvider up to 5.5x faster.
- Status: `shouldUpdatePalette` since a v3.x release; default behaviour read from 5.2.69 source.
- Sources: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/IPaletteProvider.d.ts ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/IPaletteProvider.js ; https://www.scichart.com/changelog/scichart-js/ ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/

### Write RenderDataTransforms that reuse their point series
- Layer: js
- Stage: script-run, gc-memory
- Metrics: memory, FPS/smoothness
- When: animation/render-loop
- Impact: medium, a new point series per run leaks wasm memory.
- Do: Extend `XyBaseRenderDataTransform` (or Xyy/Ohlc variants), clear and push into the existing `this.pointSeries` vectors in `runTransformInternal`, and set `requiresTransform = true` only when an outside input changes. Set `useForYRange = true` when the transform changes the Y range, so autorange reuses the result.
- Why: The base class runs the transform only when data or the index range changes; creating new vectors each time allocates wasm memory that is never freed.
- Status: v3.4.662+ for the derived base classes.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/render-data-transforms-api/

### Implement incremental hooks in custom data filters
- Layer: js
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: medium for streaming indicators, it turns an O(n) refilter per tick into O(new points).
- Do: Besides `filterAll`, implement `filterOnAppend(count)`, `filterOnUpdate(index)`, `filterOnInsert(start, count)`, `filterOnRemove(start, count)` and `onClear()` in filters derived from `XyFilterBase` and friends.
- Why: Without them the filter recomputes the whole output on every source change.
- Status: v5 docs; v5 made data filters up to 3.5x faster.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-filters-api/custom-filter/ ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/

### Give DiscontinuousDateAxis an explicit dataGap
- Layer: js
- Stage: script-run
- Metrics: FPS/smoothness
- When: load, interaction
- Impact: low, it removes an auto-calculation.
- Do: Set `dataGap` (for example one bar interval in seconds) and `autoRange: EAutoRange.Never` when you drive the visible range yourself.
- Why: The docs' best-practice list says an unset gap is auto-calculated.
- Status: v5.0+ (new axis type for gapped financial data).
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/axis-api/axis-types/discontinuous-date-axis/

---

## G. Animation

### Skip series animations on live and multi-chart views; reuse the animation DataSeries
- Layer: gpu
- Stage: script-run, gpu-draw
- Metrics: FPS/smoothness, memory, LCP
- When: load, animation/render-loop
- Impact: medium, each running animation forces redraws for its duration and delays the final chart.
- Do: Do not attach startup animations (`WaveAnimation`, `SweepAnimation` etc.) to real-time trading charts or dense dashboards. For dataset animations, keep one temporary DataSeries, register it with `surface.addDeletable(tmp)`, and `clear()` + `appendRange()` it before each `runAnimation`. Prefer built-in series animations over `GenericAnimation` for large data.
- Why: Dataset animations interpolate every point per frame and need before/after vectors of equal length; the docs warn that a new DataSeries per animation leaks and eventually crashes. The docs say built-in animations are optimised per series type.
- Avoid/caveats: `enqueueAnimation` chains; `runAnimation` (or setting `animation`) cancels running ones. Axis `autoRangeAnimation` also animates via the same mechanism.
- Status: v2.x+.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/animations-api/animations-api-overview/ ; https://www.scichart.com/documentation/js/v5/2d-charts/animations-api/dataset-animations/ ; https://www.scichart.com/documentation/js/v5/2d-charts/animations-api/generic-animations/

---

## H. WebAssembly memory lifetime

### Call sciChartSurface.delete() once on unmount
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: high, wasm memory has no garbage collector, so a missed delete leaks for the whole session.
- Do: Keep the surface reference and call `sciChartSurface.delete()` in the framework destroy hook (Svelte `onDestroy`/`$effect` cleanup, React unmount, Angular `ngOnDestroy`). `<SciChartReact />` does it for you.
- Why: Delete cascades to axes, series, DataSeries, annotations and modifiers attached at that moment.
- Example:
  ```ts
  let surface: SciChartSurface | undefined;
  onMount(async () => { ({ sciChartSurface: surface } = await SciChartSurface.create(el, { freezeWhenOutOfView: true })); });
  onDestroy(() => surface?.delete());
  ```
- Avoid/caveats: If the component unmounts before `create()` resolves, delete the surface when the promise settles. Objects that were detached earlier are not covered.
- Status: All versions.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-best-practices/ ; https://www.scichart.com/documentation/js/v5/get-started/tutorials-react/tutorial-01-setting-up-project-with-scichart-react/

### Delete what you swap out; know that collection remove/clear delete by default
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session, interaction
- Impact: high for apps that switch symbols/indicators, each orphaned DataSeries keeps its wasm buffers.
- Do: When you replace `series.dataSeries`, call `old.delete()`. When you move a series or annotation to another chart, pass `false`: `surface.renderableSeries.remove(s, false)`. Use `clear()` to empty a DataSeries you will refill; use `delete()` only when done.
- Why: `ObservableArray.remove`, `removeAt` and `clear` have `callDeleteOnChildren = true` by default in 5.2.69, and `renderableSeries.delete()` also deletes its DataSeries, so a plain remove-then-add to another chart hands over a deleted object.
- Avoid/caveats: A deleted object cannot be reused (`getIsDeleted()` returns true).
- Status: Optional delete flag v3.2+; default read from 5.2.69 source.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/deleting-memory/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Core/ObservableArray.js ; https://www.scichart.com/changelog/scichart-js/

### Tie timers and helper objects to the surface with addDeletable
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium, it prevents timers from writing into deleted series.
- Do: Register side resources: `surface.addDeletable({ delete: () => clearInterval(timer) })` and `surface.addDeletable(tempDataSeries)`.
- Why: `surface.delete()` then cleans them up together with the chart.
- Status: v5 docs examples.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/batching-updates-or-temporary-suspending-drawing/ ; https://www.scichart.com/documentation/js/v5/2d-charts/animations-api/dataset-animations/

### Decide when the shared wasm context is disposed in a SPA
- Layer: js
- Stage: gc-memory
- Metrics: memory, startup
- When: long-lived session
- Impact: medium, it trades freed memory against re-initialising the engine (hundreds of ms) on the next chart page.
- Do: Keep the default (context kept alive) if users move between chart routes often. If charts are rare, set `SciChartSurface.autoDisposeWasmContext = true` with `SciChartSurface.wasmContextDisposeTimeout = <ms>` (default false/0), or call `SciChartSurface.disposeSharedWasmContext()` when leaving the charting area.
- Why: `createSingle()` contexts die with their surface once references are gone; the shared `create()` context lives until disposed, on purpose, to avoid re-init on SPA navigation. SciChart logs a warning that auto dispose is off.
- Avoid/caveats: wasm linear memory can only grow; only disposing the context returns it to the OS.
- Status: All v5 (flags exist since a v3.x release).
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-best-practices/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurfaceBase.d.ts ; https://www.scichart.com/blog/memory64-unlocking-webassemblys-true-potential-with-16gb-of-in-browser-memory/

### Hunt leaks with MemoryUsageHelper in development
- Layer: tooling
- Stage: gc-memory
- Metrics: memory
- When: testing
- Impact: medium, it names the objects that were never deleted.
- Do: In dev only, set `MemoryUsageHelper.isMemoryUsageDebugEnabled = true`, exercise mount/unmount cycles, then call `MemoryUsageHelper.objectRegistry.log()`. Fix `collectedNotDeleted` (missing delete) and `deletedNotCollected` (JS reference still held). Track your own objects with `MemoryUsageHelper.register(obj, id)`.
- Why: The helper wraps every IDeletable and native entity in a proxy and records its lifecycle.
- Avoid/caveats: Works only when `process.env.NODE_ENV` is not "prod"/"production"; proxies add overhead.
- Status: v3.2+.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-leak-debugging/

### Lower wasmBufferSizesKb only in memory-constrained targets
- Layer: gpu
- Stage: gc-memory, gpu-upload
- Metrics: memory, FPS/smoothness
- When: load
- Impact: low, up to 80 MB static per engine at the default.
- Do: Before the first chart, set `SciChartDefaults.wasmBufferSizesKb` (default 8192, clamped 1024..32768) to 2048 or 1024 on kiosks or low-RAM devices.
- Why: The 2D engine keeps 10 processing buffers per engine; with `createSingle()` that cost is per chart.
- Avoid/caveats: Smaller buffers can slow drawing; the value cannot change after charts exist.
- Status: v3.2+.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-best-practices/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartDefaults.js

### Plan for the wasm heap ceiling (4 GB in v5; opt-in Memory64 in v6 alpha)
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium for very large histories, hitting the ceiling is an out-of-memory error, not a slowdown.
- Do: Budget about 16 bytes per XY point (double X + double Y) before engine overhead; v5 caps the heap at 4 GB (about 200M XY points). In v6 alpha, opt in with `SciChartDefaults.useWasm64 = EUseWasm64.Auto` and serve `scichart-64.wasm`.
- Why: v5 is built with `MAXIMUM_MEMORY=4GB` (up from 2 GB in v4). Memory64 lifts it to 16 GB in browsers that support it.
- Avoid/caveats: SciChart measured about 10% slower execution for wasm64. Default is `EUseWasm64.Never`. Memory64 is "limited availability": Chrome/Edge 133+, Firefox 134+ per webstatus.dev, no Safari (SciChart's blog says Firefox 143+; the alpha d.ts says 134+). Out-of-memory in append now throws with a clear message (v4+ changelog).
- Status: 4 GB limit v5.0+; Memory64 is a v6 alpha proof of concept, not stable.
- Sources: https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/ ; https://www.scichart.com/blog/memory64-unlocking-webassemblys-true-potential-with-16gb-of-in-browser-memory/ ; https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.196/types/types/EUseWasm64.d.ts ; https://api.webstatus.dev/v1/features/wasm-memory64

---

## I. Loading, build and startup

### Serve both SIMD and no-SIMD wasm and keep useWasmSimd on Auto
- Layer: build
- Stage: network, script-compile
- Metrics: startup, FPS/smoothness, bundle-size
- When: build, load
- Impact: high, SIMD gives 2-4x on big-data resampling and autorange; a missing file breaks chart creation.
- Do: Copy `scichart2d.wasm` and `scichart2d-nosimd.wasm` (plus the 3D pair if used) to the build output, from the same package version as the JS. Keep `SciChartDefaults.useWasmSimd = EUseWasmSimd.Auto`. Use `Always` only if you serve just the SIMD file and accept no fallback.
- Why: Auto detects SIMD and falls back to the no-SIMD binary. Wasm SIMD is Baseline widely available (Chrome 91, Firefox 89, Safari 16.4; widely since 2025-09-27).
- Avoid/caveats: Mismatched wasm/JS versions throw "Could not load SciChart WebAssembly module". v5 needs WebGL 2 (WebGL 1 fallback removed).
- Status: v5.0+.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/surface/deploying-wasm/ ; https://www.scichart.com/documentation/js/v5/whats-new/breaking-changes-v4-v5/ ; https://api.webstatus.dev/v1/features/wasm-simd ; https://www.scichart.com/documentation/js/v5/user-manual/minimum-browser-requirements/

### Self-host the wasm next to your app; use the CDN only when you have no bundler
- Layer: network
- Stage: network, script-compile
- Metrics: startup, LCP
- When: load
- Impact: medium, it avoids a third-party connection on the chart's critical path.
- Do: Copy the wasm files in the build and point to them with `SciChartSurface.configure({ wasmUrl, wasmNoSimdUrl })` if they are not next to the page. `useWasmFromCDN()` / `loadWasmFromCDN()` fetch from jsDelivr.
- Why: The first chart downloads (about 1 MB per wasm in v5) and compiles the engine; v5 cut wasm size by 45% and first-chart init by up to 300 ms.
- Avoid/caveats: The claim that self-hosting is faster is an inference (one fewer origin), not a SciChart statement. The docs note `useWasmFromCDN()` can error in React and point to `loadWasmFromCDN()` (d.ts comment).
- Status: v5 API names.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/surface/deploying-wasm/ ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurface.d.ts

### Load the chart library off the critical path
- Layer: build
- Stage: network, script-compile, script-run
- Metrics: bundle-size, LCP, TBT, startup
- When: build, load
- Impact: medium, `index.min.js` is about 1.9 MB in v5 plus about 1 MB of wasm.
- Do: Import `scichart` with dynamic `import()` in the route or component that shows a chart, and start wasm download early on that route (in v6 alpha: `await preloadWasm()`; in v5 there is no preload API, so a `<link rel="preload" as="fetch" crossorigin>` for the SIMD wasm is an option).
- Why: Pages without charts should not parse the library. v6 `preloadWasm()` pre-fetches and pre-compiles the module so `create()`/`createSingle()` only pay instantiation (under 10 ms per its doc comment).
- Avoid/caveats: The dynamic-import and `<link rel=preload>` advice is general web practice, not in SciChart docs; a preload that does not match SciChart's own fetch (URL, mode, credentials) downloads twice. Preload only the variant that will be used (SIMD in almost all browsers).
- Status: `preloadWasm` exists only in 6.0.0-alpha builds.
- Sources: https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/ ; https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.196/types/Charting/Visuals/preloadWasm.d.ts

### Size the chart container with CSS before creating the surface
- Layer: css
- Stage: layout, gpu-draw
- Metrics: CLS, startup, FPS/smoothness
- When: load
- Impact: medium, a late size change clears the canvas and forces another full draw.
- Do: Give the host div an explicit height (and width) in CSS before `create()`; avoid relying on the 3:2 aspect fallback (`widthAspect`/`heightAspect`) or `disableAspect` defaults for layout.
- Why: The canvas is cleared on every resize; without a fixed size the browser resizes right after init and the first frame is wasted (and causes layout shift).
- Status: All versions.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/manual-render/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurfaceBase.d.ts

---

## J. GPU, display density and backends

### Consider disabling DPI scaling on large charts for low-end GPUs
- Layer: gpu
- Stage: raster, gpu-draw, composite
- Metrics: FPS/smoothness, memory
- When: load
- Impact: medium, a Retina (DPR 2) chart renders 4x the pixels.
- Do: For fill-rate-bound cases (very large or many charts on weak GPUs), set `DpiHelper.IsDpiScaleEnabled = false` before any surface is created. Measure first.
- Why: Since v2 every element renders at native resolution and is scaled down, which costs 4x pixel work at DPR 2.
- Avoid/caveats: Text and lines become blurry on high-DPI screens and no longer scale with browser zoom (accessibility). Keep `SciChartSurface.AntiAliasWebGlBackbuffer` false (default); series and labels are anti-aliased separately.
- Status: v2.0+.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/retina-support-and-browser-zoom/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurfaceBase.d.ts

### Check which GPU the browser uses before you blame the chart
- Layer: tooling
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: testing
- Impact: medium, dual-GPU laptops default to the slower integrated GPU.
- Do: Open `chrome://gpu`, read GL_RENDERER, and test on both GPUs. Report browser and GPU with any benchmark; Chrome is SciChart's fastest browser, Firefox and Safari are slower at WebGL-to-canvas copies.
- Status: Testing advice.
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/

### Do not depend on WebGPU yet; v6 alpha gates it to Apple GPUs
- Layer: gpu
- Stage: gpu-draw, composite
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: high for 20+ live panels when it ships, SciChart's F1 demo ran 60+ FPS on WebGPU against 15-30 FPS on WebGL fallback.
- Do: Build on v5 (WebGL 2). If you trial `scichart@alpha`, test both backends: set `localStorage.IS_WEB_GPU = "1"` to force WebGPU and `"0"` to force WebGL.
- Why: WebGPU lets one GPU device render straight to many canvases, removing the per-chart GPU-to-CPU readback that shared-context WebGL needs and the context cap. In 6.0.0-alpha.196 source, auto mode uses WebGPU only on Apple Silicon Macs (Apple adapter), WebGL elsewhere, and falls back to WebGL if the adapter or device fails; it requests `powerPreference: "high-performance"`.
- Avoid/caveats: The July 2026 blog says v6 auto-uses WebGPU wherever supported; the September alpha source is narrower, so behaviour is still moving. WebGPU is "limited availability" on webstatus.dev (no Firefox entry). v6 also changes wasm file names (`scichart.wasm`, `scichart-nosimd.wasm`, `scichart-64.wasm`, plus `scichart-charting3d*.wasm` in the alpha file list), so build copy rules will change.
- Status: v6 alpha only (not stable as of 2026-09-22).
- Sources: https://www.scichart.com/blog/scichart-js-v6-in-alpha-webgpu-incredible-performance-gains-and-more/ ; https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.196/esm/constants/app.js ; https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.196/esm/Core/WebGpuHelper.js ; https://api.webstatus.dev/v1/features/webgpu ; https://www.scichart.com/scichart-js-v5-0-211-released/

### Stay on the latest v5 minor
- Layer: build
- Stage: gpu-draw, script-run, gc-memory
- Metrics: FPS/smoothness, memory, startup
- When: build
- Impact: medium, recent minors fixed label-cache leaks (5.1.0), a line rendering freeze (5.2.11) and gave 3-5x on non-uniform heatmaps (5.2.55).
- Do: Track 5.2.x patch releases; upgrade the JS and both wasm files together.
- Status: Latest stable 5.2.69 (2026-09-08) per npm.
- Sources: https://www.scichart.com/changelog/scichart-js/ ; https://registry.npmjs.org/scichart ; https://www.scichart.com/scichart-js-v5-0-211-released/ ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.2/

---

## Doc-versus-source conflicts found (5.2.69)

| Topic | v5 docs say | Shipped source says |
|---|---|---|
| `SciChartDefaults.useSharedCache` default | Performance tips: not enabled by default | `true` since 4.0.933 (was `false` in 3.5.727) |
| `dataEvenlySpacedInX` | Listed as auto-detected; d.ts says defaults to true | Constructor default `false`, no detection |
| FIFO with spline series | v3.5 changelog: supported | 5.2.69 d.ts: spline and stacked not supported |
| Default native font | Native text page: only Arial is bundled | v5 default is Arimo (`nativeFontFamily` "default") |
| v6 WebGPU auto mode | Blog (Jul 2026): use WebGPU where supported | alpha.196: WebGPU only on Apple GPUs in auto mode |
| Blog (Feb 2025) | useNativeText/useSharedCache not on by default | Both default true since v4.0 |

## Sources read
- https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/
- https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-best-practices/
- https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-leak-debugging/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/data-series-api-overview/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/append-insert-update-remove/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/realtime-updates/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/resampling/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/deleting-memory/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/get-set-value-at-index/
- https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/batching-updates-or-temporary-suspending-drawing/
- https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/manual-render/
- https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/render-events/
- https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/native-text-api/
- https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/retina-support-and-browser-zoom/
- https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/ordered-rendering/
- https://www.scichart.com/documentation/js/v5/2d-charts/axis-api/axis-labels/performance-considerations-native-text-axis-abels/
- https://www.scichart.com/documentation/js/v5/2d-charts/axis-api/axis-labels/label-provider-api-overview/
- https://www.scichart.com/documentation/js/v5/2d-charts/axis-api/axis-types/discontinuous-date-axis/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-point-labels/data-label-skip-modes-and-culling/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-point-labels/data-label-positioning/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/uniform-heatmap-renderable-series/updating-realtime/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/non-uniform-heatmap-renderable-series/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/palette-provider-api/fast-line-renderable-series/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/render-data-transforms-api/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-filters-api/custom-filter/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/spline-line-renderable-series/
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-modifier-api/cursor-modifier/cursor-modifier-overview/
- https://www.scichart.com/documentation/js/v5/2d-charts/annotations-api/html-annotation/
- https://www.scichart.com/documentation/js/v5/2d-charts/styling-and-theming/auto-coloring/
- https://www.scichart.com/documentation/js/v5/2d-charts/animations-api/animations-api-overview/
- https://www.scichart.com/documentation/js/v5/2d-charts/animations-api/dataset-animations/
- https://www.scichart.com/documentation/js/v5/2d-charts/animations-api/generic-animations/
- https://www.scichart.com/documentation/js/v5/2d-charts/subcharts-api/subcharts-api-overview/
- https://www.scichart.com/documentation/js/v5/2d-charts/subcharts-api/example-using-sub-charts-to-create-large-dashboard/
- https://www.scichart.com/documentation/js/v5/2d-charts/subcharts-api/exampe-dynamic-multi-panel-charts-with-sub-charts/
- https://www.scichart.com/documentation/js/v5/2d-charts/surface/scichart-surface-type-overview/
- https://www.scichart.com/documentation/js/v5/2d-charts/surface/new-scichart-surface/
- https://www.scichart.com/documentation/js/v5/2d-charts/surface/deploying-wasm/
- https://www.scichart.com/documentation/js/v5/get-started/tutorials-react/tutorial-01-setting-up-project-with-scichart-react/
- https://www.scichart.com/documentation/js/v5/get-started/faqs/faq-20250722/
- https://www.scichart.com/documentation/js/v5/user-manual/minimum-browser-requirements/
- https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/
- https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.2/
- https://www.scichart.com/documentation/js/v5/whats-new/breaking-changes-v4-v5/
- https://www.scichart.com/documentation/js/v5/whats-new/breaking-changes-v5.1-v5.2/
- https://www.scichart.com/documentation/js/v5/typedoc/classes/scichartdefaults.html
- https://www.scichart.com/documentation/js/v5/sitemap.xml (plus a keyword sweep of all 363 v5 doc pages for "performance", "faster", "overhead", "memory leak", ".delete()")
- https://www.scichart.com/changelog/scichart-js/
- https://www.scichart.com/blog/scichart-js-v6-in-alpha-webgpu-incredible-performance-gains-and-more/
- https://www.scichart.com/blog/memory64-unlocking-webassemblys-true-potential-with-16gb-of-in-browser-memory/
- https://www.scichart.com/blog/creating-a-react-drag-drop-chart-dashboard/
- https://www.scichart.com/blog/pushing-the-boundaries-of-javascript-chart-dashboard-performance/
- https://www.scichart.com/blog/how-to-visualize-millions-of-data-points-efficiently/
- https://www.scichart.com/blog/what-javascript-chart-performance-really-means/
- https://www.scichart.com/scichart-js-v5-0-211-released/ (v5.1.0 release post)
- https://registry.npmjs.org/scichart and https://registry.npmjs.org/scichart-react
- https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartDefaults.js (also compared 3.5.727, 4.0.933, 5.1.0)
- https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurface.d.ts
- https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurfaceBase.d.ts
- https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.d.ts and BaseDataSeries.js, XyDataSeries.d.ts
- https://cdn.jsdelivr.net/npm/scichart@5.2.69/types/NumberArray.d.ts, types/EUseWasmSimd.d.ts, types/AutoColorMode.d.ts
- https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Numerics/Resamplers/ResamplingMode.d.ts
- https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/RenderableSeries/BaseRenderableSeries.d.ts
- https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/IPaletteProvider.d.ts and IPaletteProvider.js
- https://cdn.jsdelivr.net/npm/scichart@5.2.69/Core/ObservableArray.d.ts and ObservableArray.js
- https://cdn.jsdelivr.net/npm/scichart@5.2.69/constants/performanceWarnings.js
- https://cdn.jsdelivr.net/npm/scichart@5.2.69/utils/performance.d.ts
- https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/ChartModifiers/RolloverModifier.d.ts, CursorModifier.d.ts
- https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/Axis/LabelProvider/LabelCache.d.ts
- https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/Annotations/*.d.ts (TextAnnotation, CustomAnnotation, AxisMarkerAnnotation, BoxAnnotation, LineAnnotation, HorizontalLineAnnotation, VerticalLineAnnotation, NativeTextAnnotation, LineArrowAnnotation, HtmlTextAnnotation, HtmlCustomAnnotation)
- https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.196/types/Charting/Visuals/SciChartDefaults.d.ts, types/Charting/Visuals/preloadWasm.d.ts, types/Core/WebGpuHelper.d.ts, types/types/EUseWasm64.d.ts, esm/Core/WebGpuHelper.js, esm/constants/app.js
- https://data.jsdelivr.com/v1/packages/npm/scichart@6.0.0-alpha.196?structure=flat (file list)
- https://api.webstatus.dev/v1/features/webgpu, /wasm-simd, /wasm-memory64, /intersection-observer, /offscreen-canvas

## Not covered / could not access
- SciChart forum threads (www.scichart.com/questions/js/...) show a Cloudflare bot-verification page in the browser; I did not try to get past it. Forum-only tips (for example the "Firefox performance decreased dramatically" thread) are not included.
- Worker/OffscreenCanvas rendering: no SciChart v5 doc covers rendering in a Web Worker; only data decoding in a worker is described (v6 blog). Treat chart rendering as main-thread only.
- WebGL context loss and restore handling in SciChart: no doc found.
- Cost of `EAutoRange.Always` on streaming Y axes: v5 notes say AutoRange got faster with SIMD, but no doc compares Always against explicit `visibleRange` updates.
- Tree-shaking or partial imports of the `scichart` package: not documented; bundle size figure (about 1.9 MB `index.min.js`) is from the v5 release notes.
- 3D chart (SciChart3DSurface) performance specifics were not studied beyond create/createSingle and v5 speed-ups.
- scichart-react 1.0.0 README has no performance section; `SciChartGroup` shared-context behaviour comes only from the 100-chart blog.
- Numbers quoted (ms, FPS) are SciChart's own measurements on their hardware; I did not reproduce them.
