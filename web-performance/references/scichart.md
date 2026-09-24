# SciChart.js: data series, redraw, many charts, text, wasm memory and loading (SC-)

Open this when you write or change SciChart.js code: imports from `scichart`, `SciChartSurface.create(` or `createSingle(`, `XyDataSeries` and the other data series, renderable series, axes, annotations, chart modifiers, `wasmContext`, `SciChartDefaults`. The library owns its WebGL2 renderer and its frame loop, so these rules are API choices; the general mechanisms stay in `gpu-webgl-webgpu.md`, `gpu-canvas-and-frames.md` and the `js-` files, and each SC rule links to them with `also:`. The library version that the rules were checked against, and the known doc-versus-source conflicts, are in `support.md` §D.
Stage cards: `pipeline.md` §H (`tasks`, `gpu-upload`, `gpu-draw`, `memory`, `script-load`).

## Checklist

| ID | Do this | Impact | First stage |
|---|---|---|---|
| **§0 Lookup order**, **§1 Chart contract** (no rules) | | | |
| **§A Ingestion** | | | |
| SC-01 | Batch data calls: `appendRange`, `insertRange`, `removeRange`; no per-point loops | high | tasks |
| SC-02 | Stream: one `appendRange` per series per frame into a `fifoCapacity` series | high | tasks |
| SC-03 | Declare `dataIsSortedInX` and `containsNaN`; `dataEvenlySpacedInX: true` only for uniform X | medium | tasks |
| SC-04 | Replace data with `clear()` plus `appendRange()`; update the still-open last point in place | medium | memory |
| SC-05 | Pre-size with `capacity`; pass reused `Float64Array` buffers | medium | tasks |
| SC-06 | Bulk reads with `vectorToArrayViewF64`, used at once; no `get(i)` loops | medium | tasks |
| SC-07 | Keep X sorted: update or drop late points | medium | gpu-draw |
| SC-08 | `fifoSweeping` for wrap-around sweep displays | low | gpu-draw |
| SC-09 | Heatmaps: change z values in place; the uniform heatmap for equal cells | medium | gpu-upload |
| **§B Resampling and ranging** | | | |
| SC-10 | Resampling on Auto; never ship `debugDisableResampling` | high | gpu-draw |
| SC-11 | Aggregate long history on the server; decimate in JS only series that are not resampled | medium | network |
| SC-12 | Keep spline `interpolationPoints` low | medium | gpu-draw |
| SC-43 | Move the X window with `visibleRange`; `EAutoRange.Always` on Y only with the data flags | medium | tasks |
| SC-44 | Remove long-hidden streaming series; `isVisible = false` skips only the draw | medium | tasks |
| **§C Redraw control** | | | |
| SC-13 | Change freely within one task; suspend updates only across awaits or callbacks | medium | gpu-draw |
| SC-14 | Put each change in the render event that lands it in the same frame | medium | tasks |
| SC-15 | `disableEngineLoop` only when you own the frame loop | medium | gpu-draw |
| **§D Many charts** | | | |
| SC-16 | `create()` by default; `createSingle()` only for a few heavy charts | high | gpu-draw |
| SC-17 | Sub-charts on one parent surface for dense multi-pane layouts | high | gpu-draw |
| SC-18 | `freezeWhenOutOfView` on charts that scroll, collapse or sit in tabs | high | gpu-draw |
| SC-19 | Strip axis decoration on small or many charts | medium | gpu-draw |
| SC-42 | Link pane X axes with equal ranges; group only the modifiers that mirror | medium | tasks |
| **§E Text, annotations, tooltips** | | | |
| SC-20 | Keep native text and the shared label cache on | high | gpu-draw |
| SC-21 | Render-context annotations first; SVG-only tooltips; fewer data labels | high | gpu-draw |
| SC-22 | Native text off only to cut first-chart startup when labels are static | low | script-load |
| SC-45 | Custom native text: cached fonts, one batch, no early flush | low | gpu-draw |
| **§F Styling, transforms, animation, interaction** | | | |
| SC-23 | Cacheable palette providers: `shouldUpdatePalette`, `isRangeIndependant` | medium | tasks |
| SC-24 | Render-data transforms reuse their point series; filters update incrementally | medium | tasks |
| SC-25 | `autoColorMode` `Never` or `Once` with explicit colors | low | tasks |
| SC-26 | No series animations on live or multi-chart views | medium | gpu-draw |
| SC-27 | Built-in modifiers first; custom modifiers do heavy work once per frame | medium | tasks |
| SC-46 | Point markers: styles set once; `lastPointOnly` for a current-value dot | medium | gpu-upload |
| SC-47 | `DiscontinuousDateAxis`: an explicit `dataGap` | low | tasks |
| **§G Wasm memory lifetime** | | | |
| SC-28 | One surface per mount; `delete()` once, also when unmount comes before `create()` resolves | high | memory |
| SC-29 | Delete what you swap out; collection `remove` and `clear` delete by default | high | memory |
| SC-30 | `addDeletable` for timers, feeds and helper series | medium | memory |
| SC-31 | Decide when the shared wasm context is disposed | medium | memory |
| SC-32 | `MemoryUsageHelper` in development to name undeleted objects | medium | memory |
| SC-33 | Budget the wasm heap ceiling for very long histories | medium | memory |
| SC-34 | Lower `wasmBufferSizesKb` only on memory-constrained targets | low | memory |
| **§H Loading and creation** | | | |
| SC-35 | Load the library with `import()` on chart routes only | medium | script-load |
| SC-36 | Self-host version-matched wasm as `application/wasm`; `useWasmSimd` on Auto | high | network |
| SC-37 | Size the host element in CSS before `create()` | medium | layout |
| SC-48 | Catch a failed `create()` and show a lighter view | high | gpu-draw |
| **§I GPU, DPR, backends** | | | |
| SC-38 | DPI scaling off only for measured fill-bound charts | low | gpu-draw |
| SC-39 | Read the GPU renderer before you blame the chart | medium | gpu-draw |
| SC-40 | Build on WebGL2; trial the WebGPU backend only with both backends tested | high | gpu-draw |
| SC-41 | Stay on the latest patch; upgrade the JS and wasm files together | medium | memory |
| **§J Measure hooks** (no rules) | | | |

- → DATA-06, DATA-03 flush a feed once per frame; decode in a worker only when decoding breaks the frame budget
- → EVT-03 coalesce pointer and wheel input into one rAF (custom modifiers, drag interactions on a chart)
- → GPU-01, GPU-14 the backend fallback chain; float64 time origins in your own float32 buffers
- → CNV-20 pause your own canvas loops when the tab is hidden or the surface is off-screen
- → LIFE-01 one teardown owner for listeners, timers, subscriptions and sockets

## §0 Lookup order

1. Print the installed version: `node -p "require('./node_modules/scichart/package.json').version"`. The rules were checked against the version in `support.md` §D. If the major version differs, re-check each API before you use it.
2. Grep the installed typings: `rg -n '<name>' node_modules/scichart -g '*.d.ts'`. An API name that is not in the installed typings does not exist.
3. If the user configured the vendor's SciChart MCP server, use it for examples and API lookups. Read the web docs last.
4. When the docs and the shipped source disagree, trust the source. The known conflicts are in `support.md` §D.

## §1 Chart contract: the SciChart fields

Write the 8 values of the chart contract (SKILL.md, "Budgets and the chart contract"). For SciChart, also write:
- creation: `create()`, `createSingle()` or sub-charts on one parent (SC-16, SC-17), and when the shared wasm context is disposed (SC-31);
- per series: the FIFO capacity (peak rate × visible window), the sort, NaN and spacing flags, and whether the library resamples it (SC-02, SC-03, SC-10);
- teardown: the owner that calls `surface.delete()`, and what it registers with `addDeletable` (SC-28, SC-30).

## §A Ingestion

### SC-01 Batch data calls with `appendRange`, `insertRange` and `removeRange`; never loop per point
stage: tasks, gpu-upload · metric: frame, INP · when: render-loop, session · impact: high — each single-point call crosses into wasm and requests a redraw, so per-point loops cost CPU in proportion to the point count · support: n/a (library) · also: SC-02
- Do: Collect points into arrays and pass them in one call: `appendRange(xs, ys)`, `insertRange(i, xs, ys)`, `removeRange(i, count)`; the multi-value series have range forms with more arrays. Never loop over `append`, `insert`, `update` or `removeAt` for more than a few points.
- Why: A single-point call crosses the JS-to-wasm boundary, updates the data-distribution state and raises a data-changed event; a range call pays this once per batch. The docs measure 100,000 single appends at 69 ms against 1 ms for one `appendRange`.
- Detect: `rg -n -B3 '\.(append|insert|update|removeAt)\(' -g '*.{ts,tsx,js,jsx,svelte,vue}'`, then look for a `for`, `forEach` or `map` around the call, or a call per message in a feed handler.
- Verify: measure.md#fps with the `stream` scenario at the contract's peak rate, 5 runs each side. Pass: compare-runs verdict "win" on frame p95 and long frames per 10 s, and the LoAF script time of the handler goes down.
- Avoid: Very fast per-point invalidation also triggered a Chrome slowdown that the library had to work around, so do not expect the engine to absorb per-point loops. A range call with one point is fine for rare events.
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/append-insert-update-remove/

### SC-02 Stream updates with one `appendRange` per series per frame, into a `fifoCapacity` series
stage: tasks, gpu-upload, memory · metric: frame, INP, memory · when: render-loop, session · impact: high — a live feed can deliver more messages than frames, and each extra call costs CPU but shows nothing · support: n/a (library) · also: DATA-06, LIFE-01, SC-28, SC-43
- Do: Write incoming values into reused `Float64Array` buffers and drain them with one `appendRange` per series per animation frame; schedule the frame only when data arrives, and flush when a buffer fills, because rAF does not run in hidden tabs. For a rolling window, create the series with `fifoCapacity` (constructor only), sized for the peak rate × the window, and move the X axis `visibleRange` (SC-43) instead of removing points.
- Why: The engine draws each invalidated surface at most once per display frame, so calls beyond one per frame only add JS-to-wasm crossings. A FIFO series is a preallocated circular buffer: the oldest points are overwritten, with no shifting, no reallocation and no unbounded growth.
- Detect: `rg -n -A8 'onmessage|onMessage\(|addEventListener\(\s*.message|\.subscribe\(' -g '*.{ts,tsx,js,jsx,svelte,vue}' | rg '\.append\(|\.removeAt\(|\.removeRange\('`; `rg -n 'new (Xy|Xyy|Ohlc|Hlc)DataSeries\('` in streaming modules with no `fifoCapacity`.
- Verify: measure.md#fps with `stream` at peak rate for 10 s (desktop profile, 5 runs each side), then measure.md#mem. Pass: "win" on frame p95 and long frames per 10 s; once the FIFO is full, the wasm and heap counters stay flat for 60 s.
- Example:
  ```ts
  // Before: one wasm call and one redraw request per message, plus a shift per message
  feed.onMessage((raw) => { const m = JSON.parse(raw); series.append(m.t, m.v);
    if (series.count() > MAX) series.removeAt(0); });
  // After: a bounded window and one bulk call per frame
  const series = new XyDataSeries(wasmContext, { fifoCapacity: MAX, dataIsSortedInX: true, containsNaN: false });
  const xs = new Float64Array(8192), ys = new Float64Array(8192);
  let n = 0, queued = false;
  const flush = () => { if (n) { series.appendRange(xs.subarray(0, n), ys.subarray(0, n)); n = 0; } };
  const stop = feed.onMessage((raw) => {
    const m = JSON.parse(raw); xs[n] = m.t; ys[n] = m.v; n++;
    if (n === xs.length) flush();                   // hidden tab: rAF is paused, so flush when full
    else if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; flush(); }); }
  });
  surface.addDeletable({ delete: stop });           // the feed stops with the chart (SC-30)
  ```
- Avoid: A FIFO series cannot be resized and supports no insert or remove. The typings say spline and stacked series do not support FIFO, while an older changelog says spline does: test first. Decode in a worker only when decoding breaks the frame budget (DATA-03); chart rendering has no worker or `OffscreenCanvas` path and stays on the main thread.
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/realtime-updates/ ; https://cdn.jsdelivr.net/npm/scichart/Charting/Model/BaseDataSeries.d.ts

### SC-03 Declare `dataIsSortedInX` and `containsNaN`; set `dataEvenlySpacedInX: true` only for uniform X
stage: tasks, gpu-draw · metric: frame, startup · when: load, render-loop · impact: medium — the flags skip data checks and select the fast drawing, hit-test and resampling paths, but wrong flags draw wrong data · support: n/a (library) · also: SC-07, SC-10
- Do: Pass `dataIsSortedInX` (alias `isSorted`) and `containsNaN` in the constructor options from the feed contract, and set `series.isSorted` or `series.containsNaN` again when the data changes shape (for example, NaN gaps appear). Set `dataEvenlySpacedInX: true` only for a fixed X step with no gaps (a sample index, a fixed sample rate); leave it unset for timestamps with gaps.
- Why: With undefined flags, the series checks each new batch for sort order and NaN before it picks its algorithms; the docs measure the creation of 1M points at 55 ms without the flags and 11 ms with them. The min-max resampling modes assume even spacing, and Auto chooses among them from these flags.
- Detect: `rg -n 'new (Xy|Xyy|Xyz|Ohlc|Hlc)DataSeries\(' -g '*.{ts,tsx,js,jsx,svelte,vue}'` with no `dataIsSortedInX` or `isSorted` in the options; `rg -n 'dataEvenlySpacedInX:\s*true'`, then check that X has a fixed step.
- Verify: measure.md#fps with `zoom` and `pan` at the contract's maximum point count. Pass: frame p95 is not worse than the unflagged run, and a `take_screenshot` after the zoom matches the unflagged baseline.
- Avoid: A typings comment says `dataEvenlySpacedInX` "defaults to true", but the constructor default is false and nothing detects it (support.md §D). The one-time console hint about missing flags prints only with `performanceWarnings` on and a developer license, so its absence proves nothing.
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/data-series-api-overview/ ; https://cdn.jsdelivr.net/npm/scichart/Charting/Model/BaseDataSeries.d.ts

### SC-04 Replace data with `clear()` plus `appendRange()`; update the still-open last point in place
stage: memory, tasks · metric: memory, frame · when: render-loop, session · impact: medium — a new data series per update allocates wasm memory, which leaks unless the old series is deleted · support: n/a (library) · also: SC-29, DATA-07
- Do: For a view that replaces all its data (a spectrum, a reloaded range, a new data source), keep one series and call `clear()`, then `appendRange()`. When the newest point is still changing (for example the current one-minute aggregate), change it with `update(index, y)` or `updateXy()`, and append only when a new bucket starts. Rebuild everything only on a real replace, and save and restore the visible range around it.
- Why: `clear()` removes the points but keeps the reserved wasm memory, so the next load does not reallocate. A full replace per message copies the whole dataset every time.
- Detect: `rg -n '\.dataSeries\s*=\s*new ' -g '*.{ts,tsx,js,jsx,svelte,vue}'` in update paths; `rg -n -A3 '\.clear\(\)'` followed by `appendRange` inside a per-message handler.
- Verify: measure.md#mem: replace the data 10 times, then stream for 60 s. Pass: the wasm and series counters return to their warm-up values, and frame p95 during streaming is not worse.
- Avoid: `clear()` keeps the capacity, so a series that once held 10M points keeps that memory: delete and recreate it when its size drops for good. On a FIFO series, check how the installed version maps an index to the circular buffer (`fifoStartIndex`) before you update by index.
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/deleting-memory/ ; https://cdn.jsdelivr.net/npm/scichart/Charting/Model/XyDataSeries.d.ts

### SC-05 Pre-size series with `capacity`, and pass reused `Float64Array` buffers
stage: tasks, memory · metric: frame, memory · when: load, render-loop · impact: medium — growth reallocates and copies wasm vectors, and new arrays per batch add garbage-collection work · support: n/a (library) · also: SC-02
- Do: Pass `capacity` in the constructor (or set `series.capacity`) when you know the final size. Allocate `Float64Array` scratch buffers once per series or feed, fill them, and pass them or `subarray()` views to the range calls. Append times in the unit that the date axis expects (Unix seconds by default; otherwise set `datePrecision` on its label provider), with no origin subtracted: the series stores float64 values.
- Why: A series grows its wasm vectors in steps, and each step copies the data. A `Float64Array` copies into the wasm heap as one block; the docs measure 40 ms against 24 ms when 1M points arrive in reused buffers.
- Detect: `rg -n 'appendRange\(\s*(\[|Array\.from|\w+\.map\()' -g '*.{ts,tsx,js,jsx,svelte,vue}'`; `rg -n 'new Float(32|64)Array\('` inside message handlers or rAF callbacks.
- Verify: measure.md#fps with `stream` at peak rate. Pass: `trace-summary.mjs --between wp:start wp:end` shows fewer Minor GC events than the baseline, and frame p95 is not worse.
- Avoid: The typings accept only `number[]` or `Float64Array` (`NumberArray`); do not pass `Float32Array` or integer arrays. Capacity is held until `delete()`, so do not over-reserve on many series. The float32 time-origin rule (GPU-14) is for your own GPU buffers, not for data inside the series. The typings do not show where the engine converts values for drawing: if a deep zoom on a time axis shows stepped lines, measure before you change the data.
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://cdn.jsdelivr.net/npm/scichart/types/NumberArray.d.ts

- **SC-06** For bulk reads (exports, derived values, app-side hit tests), use `vectorToArrayViewF64(series.getNativeXValues(), wasmContext)` in the same synchronous block, and `vectorToArray()` for a copy that must outlive it; never loop over `get(i)`, which crosses into wasm per point (the docs measure 1M points at 400 ms with `get(i)` and 4 ms with the view); any allocation on the wasm context can detach the view, and on a FIFO series logical index `i` is at `(series.fifoStartIndex + i) % fifoCapacity`. [tasks · INP · medium] https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/get-set-value-at-index/
- **SC-07** Append in X order; when a late point arrives, update the last point or drop it instead of inserting out of order, and use unsorted data only when the data really is unordered, because sorted X has the fast paths for drawing, hit tests and the visible-range search. [gpu-draw · frame · medium] https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/
- **SC-08** For a wrap-around sweep display, set `fifoCapacity`, `fifoSweeping: true` and optionally `fifoSweepingGap`, with a category axis or X values of `i % fifoCapacity` on a numeric axis: the circular buffer draws without being unwrapped. [gpu-draw · frame · low] https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/realtime-updates/
- **SC-09** Update a heatmap in place: change the existing z array and call `notifyDataChanged()`, or pass a new array to `setZValues()`; use the uniform heatmap when all cells have the same size, because the non-uniform one does more work per cell. [gpu-upload · frame · medium] https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/uniform-heatmap-renderable-series/updating-realtime/

## §B Resampling and ranging

### SC-10 Leave resampling on Auto; never ship `debugDisableResampling`
stage: gpu-draw, gpu-upload · metric: frame, INP · when: render-loop, interaction · impact: high — resampling keeps large series inside the frame budget; without it, every point goes to the GPU on every draw · support: n/a (library) · also: SC-03, SC-11, CNV-21
- Do: Keep `resamplingMode: EResamplingMode.Auto` (the default) and `SciChartDefaults.debugDisableResampling = false` (the default). Use `EResamplingMode.None` only on small series that must show every vertex, and do not pick another mode unless the vendor advises it.
- Why: Auto chooses a min-max reducer from the series type, size and data flags; it keeps peaks and troughs, so the picture stays the same with far fewer vertices. The docs say the gain starts at about 100,000 points.
- Detect: `rg -n 'debugDisableResampling|EResamplingMode\.(None|MinMax|Mid|Min|Max)' -g '*.{ts,tsx,js,jsx,svelte,vue}'`.
- Verify: measure.md#fps with `zoom` and `pan` at the contract's maximum point count. Pass: frame p95 is within the frame budget, and the production build contains no `debugDisableResampling`.
- Avoid: `resamplingPrecision: 1` doubles the output points for about 20% more cost. A hidden series is still resampled while it streams (SC-44). Heatmap, contour, bubble, error-bar, box-plot, line-segment and stacked series, and X-unsorted data on a non-category axis, are not resampled at all (SC-11).
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/resampling/ ; https://cdn.jsdelivr.net/npm/scichart/Charting/Numerics/Resamplers/ResamplingMode.d.ts

### SC-11 Aggregate long history on the server; decimate in JS only series that are not resampled
stage: network, memory, gpu-draw · metric: bytes, memory, frame · when: load · impact: medium — resampling cuts the drawn vertices, but not the bytes on the wire or the wasm memory · support: n/a (library) · also: SC-10, CNV-21, GPU-38
- Do: For long ranges, fetch pre-aggregated buckets (per minute, hour or day) and fetch finer data only for the zoomed window. Do not decimate X-sorted line, mountain, column or scatter data in JS before you hand it to the chart. Decimate or bin, preferably in a worker, only the series types that SC-10 lists as not resampled.
- Why: The library resamples X-sorted series in wasm on every draw, so a JS decimator repeats that work on the main thread; server aggregation is the lever that cuts network bytes and wasm memory.
- Detect: `rg -n -i 'lttb|downsampl|decimat' -g '*.{ts,tsx,js,jsx,svelte,vue}'` in modules that feed chart series; history requests with no resolution or bucket parameter.
- Verify: measure.md#load for the chart route with a long range. Pass: the history request transfers fewer bytes, the wasm counter is lower, and frame p95 during `zoom` is not worse.
- Avoid: The common advice to decimate before the renderer applies to your own renderers (CNV-21) and to the series that the library does not resample, not to resampled ones. Keep a JS decimator only where a measurement shows that it helps.
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/resampling/ ; https://cdn.jsdelivr.net/npm/scichart/Charting/Visuals/RenderableSeries/BaseRenderableSeries.js

- **SC-12** Keep spline `interpolationPoints` low, or use a plain line series for dense data: the default of 10 draws 10 generated points for each resampled point, and 0 draws a plain line. [gpu-draw · frame · medium] https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/spline-line-renderable-series/
- **SC-43** Drive a scrolling X window yourself: set the X axis to `autoRange: EAutoRange.Never` and move its `visibleRange` once per frame; use `EAutoRange.Always` on Y only when Y must follow the data and the sort and NaN flags are set, because `Always` recomputes the Y range over the visible slice after each data change, and on X it breaks the user's zoom and pan. [tasks · frame · medium] https://www.scichart.com/documentation/js/v5/2d-charts/axis-api/ranging-scaling/auto-range/
- **SC-44** When a streaming series stays hidden for more than a moment, detach it with `surface.renderableSeries.remove(series, false)` (the `false` keeps it alive for a quick re-add) or stop appending to it: `isVisible = false` skips only the draw, so a hidden series that streams is still resampled on every frame. [tasks · frame · medium] https://cdn.jsdelivr.net/npm/scichart/Charting/Services/SciChartRenderer.js

## §C Redraw control

### SC-13 Change a chart freely in one task; suspend updates only across awaits or callbacks
stage: gpu-draw, tasks · metric: frame · when: render-loop, interaction · impact: medium — a change that spans several tasks can show half-built states and pay for extra draws · support: n/a (library) · also: SC-14, CNV-01
- Do: Treat every property set, data call, series add and resize as an invalidation, and make related changes in one synchronous block; never call `invalidateElement()` in a loop. When a build or an update spans `await`s, timers or several callbacks, create the surface with `createSuspended: true`, or wrap the steps in `suspendUpdates()` and `resumeUpdates()` inside `try`/`finally`.
- Why: An invalidation only marks the surface, and the engine's rAF loop draws each marked surface once on the next frame, so synchronous changes in one task already give one draw. Between tasks, the engine can draw an intermediate state.
- Detect: `rg -n 'invalidateElement\(' -g '*.{ts,tsx,js,jsx,svelte,vue}'` inside loops; `rg -c 'suspendUpdates\('` against `rg -c 'resumeUpdates\('` per file (the counts must match); an `await` between chart changes in setup code.
- Verify: measure.md#fps with the scenario that builds or reloads the chart, and a dev render counter (§J). Pass: the counter rises by 1 per build, not once per step, and no screenshot shows a half-built chart.
- Avoid: Suspension is counter-based: every `suspendUpdates()` needs one `resumeUpdates()`, or the chart looks frozen. `surface.suspender.lock()` is marked experimental in the typings. Resize, DPR and tab-visibility changes force a redraw even while suspended. Keep typed references to your data series: `renderableSeries.dataSeries` is typed `IDataSeries`, which has no `appendRange`.
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/batching-updates-or-temporary-suspending-drawing/ ; https://cdn.jsdelivr.net/npm/scichart/Charting/Visuals/UpdateSuspender.d.ts

### SC-14 Put each change in the render event that lands it in the same frame
stage: tasks, gpu-draw · metric: frame · when: render-loop, interaction · impact: medium — a change made in the wrong hook requests one more full frame · support: n/a (library) · also: SC-13, SC-21
- Do: Make style changes in `preRender` or `preRenderAll`, visible-range and layout changes in `genericAnimationsRun`, and annotation moves that need coordinates or hit tests in `layoutMeasured`. Draw your own WebGL in `renderedToWebGl` and your 2D overlays in `renderedToDestination`.
- Why: Handlers that run before layout measurement suspend invalidation, so their changes show in the current frame without a new request. The built-in cursor, rollover and vertical-slice modifiers update only their SVG layer, so code that reads their annotation positions belongs in `layoutMeasured`.
- Detect: `rg -n 'renderedToWebGL|layoutMeasured\.subscribe' -g '*.{ts,tsx,js,jsx,svelte,vue}'`: the first is a misspelled event name (`undefined` at run time); in the second, look for writes to data or `visibleRange`.
- Verify: measure.md#fps with the interaction that triggers the change, and a dev render counter (§J). Pass: one render per change, not two, and frame p95 is not worse.
- Avoid: Do not change data, the visible range or layout inside `layoutMeasured`. `redrawRequested` and `preRenderAll` fire only on the parent surface, not on sub-charts. On `create()` surfaces, `renderedToWebGl` ends the WebGL render and `renderedToDestination` ends the copy to the chart's canvas; on `createSingle()` surfaces they fire together.
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/render-events/ ; https://cdn.jsdelivr.net/npm/scichart/Charting/Visuals/SciChartSurfaceBase.d.ts

- **SC-15** Set `disableEngineLoop: true` only when your own rAF loop must paint charts and other canvases on the same frame, and then call `wasmContext.TSRRequestDraw()` after you apply the data, once per context: with `create()` the setting changes every chart on the shared context, and 2D, 3D and each `createSingle()` chart have their own contexts. [gpu-draw · frame · medium] https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/manual-render/

## §D Many charts

### SC-16 Create surfaces with `create()`; use `createSingle()` only for a few heavy charts
stage: gpu-draw, memory · metric: frame, memory, startup · when: load, session · impact: high — each `createSingle()` chart holds its own wasm engine and WebGL context, and a lost context reloads the page · support: n/a (library) · also: GPU-03, GPU-29, SC-17, SC-31
- Do: Use `create()` for dashboards and for views with several charts: one shared engine and WebGL context, and one copy to each chart's canvas per frame. Use `createSingle()` only for one or two very heavy charts where a measurement shows that the copy is the limit, and only when a page reload after a context loss is acceptable.
- Why: A `createSingle()` chart draws straight to its canvas, but it starts a wasm engine whose processing buffers can grow to 80 MB at the default `wasmBufferSizesKb`, and it takes one of the browser's live WebGL contexts; past the cap, the browser drops the oldest context (support.md §C). The shared `create()` context restores itself after a loss when the browser sends `webglcontextrestored`.
- Detect: `rg -n 'createSingle\(' -g '*.{ts,tsx,js,jsx,svelte,vue}'`, then count how many can be live at once; `createSingle` inside a list, a grid or a per-item component.
- Verify: measure.md#mem: open every view that has charts, then read `list_console_messages`. Pass: no "Too many active WebGL contexts" warning; keep a `createSingle()` chart only if measure.md#fps on it gives a "win" over `create()`.
- Avoid: In the checked source, a `createSingle()` canvas calls `location.reload()` on `webglcontextlost`; no doc says so, so re-check it after each upgrade. Past the context cap, that reload can repeat in a loop. Vendor forum reports say some drivers never send `webglcontextrestored`: with `create()`, add a watchdog that deletes and recreates the surfaces (or reloads) when no restore arrives a few seconds after the loss. The typings also give a page limit for `createSingle()` charts (support.md §D).
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-best-practices/ ; https://cdn.jsdelivr.net/npm/scichart/Charting/Visuals/SciChartSurface.d.ts

### SC-17 Group dense multi-pane layouts into sub-charts on one parent surface
stage: gpu-draw, composite · metric: frame, memory, startup · when: render-loop · impact: high — separate surfaces pay one draw pass and one copy per chart; sub-charts share one canvas and one pass · support: n/a (library) · also: SC-16, SC-42, GPU-03
- Do: For stacked panes that share an X axis, or a grid of small charts, create one surface and add the panes with `addSubChart()`. Its `position` is relative to the parent (0 to 1) by default.
- Why: All sub-charts share one WebGL canvas, one context and one draw loop, so the engine batches their draws and copies to the screen once. In the vendor's 128-chart test, the frame rate went from 13 to 28.9 FPS.
- Detect: `rg -n 'SciChartSurface\.create(Single)?\(' -g '*.{ts,tsx,js,jsx,svelte,vue}'` inside loops or per-item components that render many panes or cells.
- Verify: measure.md#fps with all panes streaming, at the contract's surface count. Pass: compare-runs "win" on frame p95 against separate surfaces, and memory is not worse.
- Avoid: With `isTransparent: false`, give a sub-chart a plain background color, not a gradient (the library warns). `preRenderAll` and `redrawRequested` fire only on the parent (SC-14). Sub-charts render after the parent in insertion order unless you set a render order, and one with `isVisible = false` is skipped.
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/subcharts-api/subcharts-api-overview/ ; https://www.scichart.com/blog/pushing-the-boundaries-of-javascript-chart-dashboard-performance/

### SC-18 Set `freezeWhenOutOfView` on charts that scroll, collapse or sit in tabs
stage: gpu-draw, tasks · metric: frame, INP · when: render-loop, session · impact: high — charts that nobody sees still draw every frame while data streams · support: baseline (IntersectionObserver) · also: CNV-20, CSS-09, LIFE-06, SC-44
- Do: Pass `freezeWhenOutOfView: true` to `create()` (or set the property) on every chart that can leave the viewport, and bound its live data with a FIFO series (SC-02). For a chart hidden with `visibility: hidden`, `opacity: 0` or under another panel, suspend it yourself (`suspendUpdates()`) or detach its feed.
- Why: The library observes the host with an IntersectionObserver and suspends drawing while the host does not intersect; data updates still apply, and the chart draws once when it returns. In the vendor's 100-chart demo with 20 to 30 charts visible, the frame rate went from 13 to 57–60 FPS.
- Detect: `rg -n 'SciChartSurface\.create(Single)?\(' -g '*.{ts,tsx,js,jsx,svelte,vue}'` with no `freezeWhenOutOfView` in the options, in scrolling lists, tabs, accordions and dashboards.
- Verify: measure.md#fps with the chart scrolled out of view while `stream` runs, and a dev render counter (§J). Pass: the hidden chart's counter stays flat, and frame p95 wins against the unfrozen run.
- Avoid: A host with `display: none` counts as out of view and is frozen; elements that cover a chart do not. The freeze stops drawing only: your feed decoding and timers keep running (LIFE-06).
- Source: https://cdn.jsdelivr.net/npm/scichart/Core/ObserveVisibility.js ; https://www.scichart.com/blog/creating-a-react-drag-drop-chart-dashboard/

### SC-42 Link pane X axes by assigning equal ranges; group only the modifiers that must mirror
stage: tasks, gpu-draw · metric: frame, INP · when: interaction, render-loop · impact: medium — a zoom or pan on one pane must redraw each pane once per frame, not start a feedback loop · support: n/a (library) · also: SC-17, EVT-03
- Do: After all panes exist, subscribe each X axis's `visibleRangeChanged` and assign the received range unchanged to the other X axes; use the same axis type and units on all of them. Put `modifierGroup` only on the cursor or rollover modifier that must mirror across panes, not on zoom and pan modifiers. Align separate surfaces with `SciChartVerticalGroup`, and give their Y axes an `axisThickness` wider than the longest label.
- Why: The `visibleRange` setter raises its event only when the values change, so equal ranges stop after one bounce, and several sets in one frame still give one draw per surface. A grouped modifier copies every pointer event to every other surface in its group.
- Detect: `rg -n 'visibleRangeChanged\.subscribe' -g '*.{ts,tsx,js,jsx,svelte,vue}'`, then look for rounding, clipping or unit conversion of the range in the handler; `rg -n 'modifierGroup'` on zoom or pan modifiers.
- Verify: measure.md#fps with `pan` and `zoom` on one pane, and a dev render counter per pane (§J). Pass: no pane renders more often than once per frame, and frame p95 is not worse than the baseline.
- Avoid: A handler that transforms the range (rounding, `visibleRangeLimit` clipping, unit conversion) can ping-pong between panes: convert once in one owner with a re-entrancy guard. `axisThickness` is a minimum, so a longer label still widens its pane and makes the whole group lay out again. Remove a pane from the group before you delete it.
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/chart-synchronization-api/synchronizing-multiple-charts/ ; https://cdn.jsdelivr.net/npm/scichart/Charting/Visuals/Axis/AxisCore.js

- **SC-19** On small or numerous charts, turn off minor grid lines, tick lines and bands (`drawMinorGridLines`, `drawMinorTickLines`, `drawMajorTickLines`, `drawMajorBands`: false), cap the labels with `maxAutoTicks`, and set `drawLabels: false` where nobody reads them: each axis can add dozens of lines and labels per frame on every chart. [gpu-draw · frame · medium] https://www.scichart.com/blog/creating-a-react-drag-drop-chart-dashboard/

## §E Text, annotations, tooltips

### SC-20 Keep native text and the shared label cache on
stage: gpu-draw, gpu-upload · metric: frame, startup · when: render-loop, load · impact: high — on multi-chart screens, labels drawn on a canvas without a cache are rasterized again on every zoom · support: n/a (library) · also: CNV-16, GPU-24, SC-22
- Do: Leave `SciChartDefaults.useNativeText` and `SciChartDefaults.useSharedCache` at their defaults (true), and override them per axis only for a measured reason. If you override `getLabelTexture`, make each text-and-style combination unique, so that the shared cache cannot return a wrong texture. Host custom fonts as `.ttf` files, or load them with `await surface.registerFont(name, url)` before the first chart draws.
- Why: Native text draws labels from a font atlas in the WebGL pass, and the shared cache reuses label textures across axes and charts. In the vendor's 100-chart demo, canvas labels without a cache ran at 5.5 FPS, and native text with the cache at 60 FPS.
- Detect: `rg -n 'useNativeText\s*[:=]\s*false|useSharedCache\s*[:=]\s*false|getLabelTexture' -g '*.{ts,tsx,js,jsx,svelte,vue}'`.
- Verify: measure.md#fps with `zoom` on the view with the most charts. Pass: frame p95 is not worse than with the defaults, and `list_console_messages` shows no label-cache warning.
- Avoid: The performance-tips page and a typings comment still say that the shared cache is off by default; the shipped default is on (support.md §D). Native text has no `fontStyle` or `fontWeight`, a font URL must not redirect, and the fallback font comes after `nativeFontTimeout`. If the label cache warns that it grows too fast, tune `labelCache.setMaxSize()` or `setMinAge()`.
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/native-text-api/ ; https://cdn.jsdelivr.net/npm/scichart/Charting/Visuals/SciChartDefaults.js

### SC-21 Prefer render-context annotations, SVG-only tooltips and fewer data labels
stage: gpu-draw, style, layout · metric: frame, INP · when: interaction, render-loop · impact: high — SVG and HTML annotations add style, layout and paint work, and a tooltip that is not SVG-only redraws every point on each pointer move · support: n/a (library) · also: SC-14, DOM-14, CNV-08
- Do: Use the WebGL-drawn annotations (`NativeTextAnnotation`, `LineAnnotation`, `HorizontalLineAnnotation`, `VerticalLineAnnotation`, `BoxAnnotation`, `AxisMarkerAnnotation`) before the SVG ones (`TextAnnotation`, `CustomAnnotation`) or the DOM ones (`HtmlTextAnnotation`, `HtmlCustomAnnotation`). Keep `isSvgOnly` at its default (true) on `CursorModifier`, `RolloverModifier` and `VerticalSliceModifier`. For data labels, set `skipNumber`, `pointGapThreshold` or `pointCountThreshold` so that labels exist only when they fit, and `calculateTextBounds: false` when their size does not matter.
- Why: Render-context annotations are batched into the WebGL frame, but SVG and DOM annotations are nodes that the browser must style, lay out and paint. The default data-label skip mode formats and measures every label before it drops most of them.
- Detect: `rg -n 'new (TextAnnotation|CustomAnnotation|HtmlTextAnnotation|HtmlCustomAnnotation)\(|isSvgOnly:\s*false|alwaysRedrawFullChartOnSvgChange\s*=\s*true' -g '*.{ts,tsx,js,jsx,svelte,vue}'`; `dataLabels:` options with no skip or threshold setting.
- Verify: measure.md#inp with hover and crosshair moves, then measure.md#fps with `zoom`. Pass: pointer moves add no WebGL renders (the render counter stays flat), and the presentation subpart and frame p95 are not worse.
- Avoid: Creating many SVG annotations at once is a one-time spike (the changelog measured 300 ms for the first frame of 1,000 of them): create them over several frames, or use render-context annotations. Keep `SciChartDefaults.alwaysRedrawFullChartOnSvgChange` false, so SVG-only edits do not redraw the whole chart.
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-point-labels/data-label-skip-modes-and-culling/ ; https://cdn.jsdelivr.net/npm/scichart/Charting/ChartModifiers/RolloverModifier.d.ts

- **SC-22** Set `SciChartDefaults.useNativeText = false` before the first chart only on a page with one or two charts whose labels rarely change: it skips the font-atlas build at startup, but it costs frame time on zoom and on pages with many charts. [script-load · startup · low] https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/
- **SC-45** In custom drawing with native text, get fonts from `renderContext.getFont()` (they are cached; do not delete them), ask for `advanced` (signed-distance-field) fonts only for rotated or scaled text, and do not call `font.End()`, `drawImmediate` or `renderNativeAxisLabelsImmediately` unless the layer order needs it: each early flush splits the one text batch at the end of the render. [gpu-draw · frame · low] https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/native-text-api/

## §F Styling, transforms, animation, interaction

### SC-23 Make custom palette providers cacheable with `shouldUpdatePalette` and `isRangeIndependant`
stage: tasks, gpu-upload · metric: frame, INP · when: render-loop, interaction · impact: medium — without them, the color callback runs for every vertex on every render, also on pure pan and zoom frames · support: n/a (library) · also: SC-46
- Do: In a custom palette provider, implement `shouldUpdatePalette()` and return false while its inputs (data, thresholds, theme) have not changed; return true from `isRangeIndependant` when the colors do not depend on the visible range. Mark the provider dirty on every input change.
- Why: The interface says that a provider without `shouldUpdatePalette` is recomputed on every render, and the built-in `DefaultPaletteProvider` returns true, so a subclass that does not override it gets no caching.
- Detect: `rg -n 'extends DefaultPaletteProvider|implements I(Stroke|Fill|PointMarker)PaletteProvider' -g '*.{ts,tsx,js,jsx,svelte,vue}'`, then look for `shouldUpdatePalette` in the class.
- Verify: measure.md#fps with `pan` and `zoom` and no new data. Pass: compare-runs "win" on frame p95, and a dev counter of palette callbacks stays at 0 during the scenario.
- Avoid: A provider that is never marked dirty shows stale colors after new data arrives. On a streaming series whose colors depend on the data, the saving comes only on frames without new data.
- Source: https://cdn.jsdelivr.net/npm/scichart/Charting/Model/IPaletteProvider.d.ts ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/palette-provider-api/fast-line-renderable-series/

### SC-24 Reuse the point series in render-data transforms; update custom filters incrementally
stage: tasks, memory · metric: frame, memory · when: render-loop, session · impact: medium — a new point series per run leaks wasm memory, and a full recompute per message grows with the data · support: n/a (library) · also: SC-29
- Do: Extend `XyBaseRenderDataTransform` (or its Xyy and Ohlc forms), clear and refill the existing `this.pointSeries` vectors in `runTransformInternal`, set `requiresTransform = true` only when an outside input changes, and set `useForYRange = true` when the transform changes the Y range. In filters derived from `XyFilterBase` and its siblings, implement `filterOnAppend`, `filterOnUpdate`, `filterOnInsert`, `filterOnRemove` and `onClear` as well as `filterAll`.
- Why: The base transform runs only when the data or the index range changes, and vectors created per run hold wasm memory that nothing frees. Without the incremental hooks, a filter recomputes its whole output on every change of its source.
- Detect: `rg -n 'runTransformInternal|extends (Xy|Xyy|Xyz|Ohlc)FilterBase' -g '*.{ts,tsx,js,jsx,svelte,vue}'`, then look for a new point series inside `runTransformInternal`, or a filter with only `filterAll`.
- Verify: measure.md#mem while `stream` runs for 60 s, then measure.md#fps. Pass: the wasm counter stays flat after warm-up, and frame p95 wins or is not worse.
- Avoid: An incremental hook must give the same output as `filterAll`; test both paths on the same data before you ship.
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/render-data-transforms-api/ ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-filters-api/custom-filter/

### SC-26 Skip series animations on live views; reuse one data series for dataset animations
stage: gpu-draw, tasks, memory · metric: frame, LCP, memory · when: load, render-loop · impact: medium — each running animation forces a redraw on every frame for its duration and delays the final chart · support: n/a (library) · also: CSS-21, SC-30
- Do: Do not attach start-up animations (`WaveAnimation`, `SweepAnimation` and similar) to streaming charts or dense dashboards. For dataset animations, keep one temporary data series, register it with `surface.addDeletable()`, and `clear()` plus `appendRange()` it before each `runAnimation()`; prefer the built-in series animations to `GenericAnimation` for large data.
- Why: A dataset animation interpolates every point on every frame and needs before and after vectors of the same length; the docs warn that a new data series per animation leaks and can crash the page.
- Detect: `rg -n 'animation:\s*new|runAnimation\(|enqueueAnimation\(|new GenericAnimation\(' -g '*.{ts,tsx,js,jsx,svelte,vue}'` in chart modules that stream or render many charts.
- Verify: measure.md#fps from mount to the first final frame, and measure.md#mem over 10 dataset animations. Pass: the final state renders sooner than in the baseline, and the wasm counter stays flat.
- Avoid: `runAnimation()` (or setting `animation`) cancels running animations, and `enqueueAnimation()` chains them. The axis option `autoRangeAnimation` animates in the same way, so count it as an animation too. Honor reduced motion (CSS-21).
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/animations-api/dataset-animations/ ; https://www.scichart.com/documentation/js/v5/2d-charts/animations-api/animations-api-overview/

- **SC-25** Set `surface.autoColorMode = EAutoColorMode.Never` (or `Once`) when your code gives every series its colors: the default resolves the automatic colors again whenever the series collection changes, and `Always` does it on every render. [tasks · frame · low] https://www.scichart.com/documentation/js/v5/2d-charts/styling-and-theming/auto-coloring/
- **SC-27** Use the built-in modifiers (`ZoomPanModifier`, `MouseWheelZoomModifier`, `RolloverModifier`, `CursorModifier`) before a custom one; in a custom modifier, record the pointer in the event handler and do hit tests over large data, app-state writes and annotation moves once per frame (EVT-03), because one frame can receive several pointer and wheel events. [tasks · INP, frame · medium] https://www.scichart.com/documentation/js/v5/2d-charts/chart-modifier-api/cursor-modifier/cursor-modifier-overview/
- **SC-46** Set point-marker styles once: a change of `fill`, `stroke`, `width`, `height`, `strokeThickness` or `lastPointOnly` rebuilds the marker textures (a canvas draw plus an upload), and only `opacity` does not; for a pulsing current-value dot, use `lastPointOnly: true` and animate `opacity`, use a palette provider for per-point colors, and `delete()` the markers you replace. [gpu-upload · frame · medium] https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/common-series-apis/drawing-point-markers/
- **SC-47** On a `DiscontinuousDateAxis`, set `dataGap` (for example one bucket interval) and `autoRange: EAutoRange.Never` when you drive the visible range yourself: an unset gap is computed from the data. [tasks · frame · low] https://www.scichart.com/documentation/js/v5/2d-charts/axis-api/axis-types/discontinuous-date-axis/

## §G Wasm memory lifetime

### SC-28 Create one surface per mount; call `delete()` once on unmount, also when unmount comes first
stage: memory · metric: memory · when: session · impact: high — wasm memory has no garbage collector, so a surface that is not deleted leaks for the rest of the session · support: n/a (library) · also: LIFE-01, LIFE-11, GPU-30, SC-29
- Do: Create the surface in the component's mount hook, keep the reference, and call `sciChartSurface.delete()` once in its cleanup hook; never create it in a reactive block that runs again. If the component unmounts before `create()` resolves, delete the surface when the promise settles. A wrapper component that deletes on unmount is fine: check that it does.
- Why: `delete()` on the surface cascades to the axes, series, data series, annotations and modifiers attached at that moment, and frees their wasm memory.
- Detect: `rg -n 'SciChartSurface\.create(Single)?\(' -g '*.{ts,tsx,js,jsx,svelte,vue}'`, then look for `.delete()` in a cleanup path (`onDestroy`, an effect cleanup, `ngOnDestroy`, `disconnectedCallback`); a `create(` call inside `$effect`, a `useEffect` with no cleanup, or a watcher.
- Verify: measure.md#mem: mount and unmount the chart view 10 times. Pass: the canvas count and the surface and wasm counters in `__wpProbe.memory.sample()` return to baseline, and in a development build `MemoryUsageHelper.objectRegistry.log()` lists no `collectedNotDeleted` objects.
- Example:
  ```ts
  // Framework-neutral: call mountChart from the mount hook, and its result from the cleanup hook
  export function mountChart(host: HTMLDivElement): () => void {
    let surface: SciChartSurface | undefined;
    let disposed = false;
    SciChartSurface.create(host, { freezeWhenOutOfView: true }).then(
      ({ sciChartSurface }) => {
        if (disposed) sciChartSurface.delete();       // unmounted while create() was pending
        else surface = sciChartSurface;
      },
      (error) => showFallbackView(host, error),       // no WebGL2, or a wasm load error (SC-48)
    );
    return () => { disposed = true; surface?.delete(); surface = undefined; };
  }
  ```
- Avoid: Objects that you detached before the delete are not part of the cascade (SC-29). A deleted object cannot be used again: `getIsDeleted()` returns true. The delete does not stop your own timers and feeds unless you register them (SC-30).
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-best-practices/ ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/deleting-memory/

### SC-29 Delete what you swap out; remember that collection `remove` and `clear` delete by default
stage: memory · metric: memory · when: session, interaction · impact: high — each orphaned data series keeps its wasm buffers, and a removed series that you add to another chart is already deleted · support: n/a (library) · also: SC-04, SC-28, SC-44
- Do: When you assign a new `series.dataSeries`, call `delete()` on the old one. To move a series or an annotation to another chart, or to keep it for later, remove it with `false`: `surface.renderableSeries.remove(series, false)`. Empty a data series that you will refill with `clear()`, and call `delete()` only when you are done with it.
- Why: `remove`, `removeAt` and `clear` on the surface collections delete their children by default, and deleting a renderable series also deletes its data series, but the `dataSeries` setter does not delete the old series.
- Detect: `rg -n '\.dataSeries\s*=' -g '*.{ts,tsx,js,jsx,svelte,vue}'` with no `delete()` of the previous value; `rg -n '\.(renderableSeries|annotations|chartModifiers)\.(remove|removeAt|clear)\('`, then check whether the object is used again.
- Verify: measure.md#mem: switch the data source or toggle a derived series 10 times. Pass: the wasm counter stays flat after warm-up, and the console shows no error about a deleted object.
- Avoid: `delete()` cannot be undone; `getIsDeleted()` tells you whether an object is still usable. Keep the default delete on removal for objects that you do not need again: it is the leak-free path.
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/deleting-memory/ ; https://cdn.jsdelivr.net/npm/scichart/Core/ObservableArray.js

- **SC-30** Register side resources with the surface: `surface.addDeletable({ delete: () => clearInterval(timer) })` for timers and feed subscriptions, and `surface.addDeletable(tempSeries)` for helper data series, so that one `surface.delete()` releases them with the chart and no timer writes into a deleted series. [memory · memory · medium] https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/batching-updates-or-temporary-suspending-drawing/
- **SC-31** Decide when the shared wasm context is disposed, and write the choice into the chart contract: keep the default (the context stays alive, so a route change starts no new engine) when users move between chart views often; when charts are rare, set `SciChartSurface.autoDisposeWasmContext = true` with a `wasmContextDisposeTimeout`, or call `SciChartSurface.disposeSharedWasmContext()` when the user leaves the chart area, because wasm memory only grows and only a disposed context returns it (`createSingle()` contexts end with their surface). [memory · memory, startup · medium] https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-best-practices/
- **SC-32** In development only, set `MemoryUsageHelper.isMemoryUsageDebugEnabled = true`, repeat the mount-and-unmount cycle, and read `MemoryUsageHelper.objectRegistry.log()`: fix `collectedNotDeleted` (a missing `delete()`) and `deletedNotCollected` (a JS reference still held); it needs `process.env.NODE_ENV` defined and not "production", and its proxies slow the chart, so never measure speed with it on. [memory · memory · medium] https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-leak-debugging/
- **SC-33** Budget about 16 bytes per XY point before engine overhead: the wasm heap has a hard ceiling (support.md §D), and a full heap throws an out-of-memory error, not a slowdown; the 64-bit memory option of the next major version is opt-in and about 10% slower in the vendor's test (support.md: `wasm-memory64`). [memory · memory · medium] https://www.scichart.com/blog/memory64-unlocking-webassemblys-true-potential-with-16gb-of-in-browser-memory/
- **SC-34** Lower `SciChartDefaults.wasmBufferSizesKb` (clamped to 1024–32768) before the first chart only on kiosks or low-memory devices: the processing buffers of one engine can grow to 80 MB at the default, the cost repeats for each `createSingle()` chart, and smaller buffers can slow drawing. [memory · memory · low] https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-best-practices/

## §H Loading and creation

### SC-35 Load the chart library with `import()` on the routes that show charts
stage: script-load, network · metric: startup, LCP, bytes · when: build, load · impact: medium — the package cannot be tree-shaken, so every page that imports it statically loads and parses all of it · support: baseline (dynamic import) · also: EVT-14, SC-36
- Do: Import `scichart` only in chart routes and panels, with dynamic `import()`, and keep it in its own content-hashed chunk so that app deploys do not evict it from the cache. On a chart route, start the wasm download early with `<link rel="preload" as="fetch" crossorigin href="…/scichart2d.wasm">`, for the SIMD file only; the next major version adds a `preloadWasm()` API (support.md §D).
- Why: The package is CommonJS with no `module`, `exports` or `sideEffects` fields, so bundlers keep all of it; its minified bundle is about 2 MB before compression.
- Detect: `rg -n "^import [^t].* from 'scichart'" -g '*.{ts,tsx,js,jsx,svelte,vue}'` in modules that the first route loads (`import type` costs nothing); the startup chunk in the bundler report contains `scichart`.
- Verify: measure.md#start on a route without charts and on the chart route. Pass: `list_network_requests` shows no library chunk on the route without charts, and startup on the chart route is not worse.
- Avoid: A preload must match the library's own fetch (the URL, CORS mode and same-origin credentials), or the file downloads twice. A large chunk that evaluates during a click is still a long task: start the import on intent or when idle (EVT-14).
- Source: https://cdn.jsdelivr.net/npm/scichart/package.json ; https://web.dev/articles/script-evaluation-and-long-tasks

### SC-36 Self-host version-matched wasm files as `application/wasm`; keep `useWasmSimd` on Auto
stage: network, script-load · metric: startup, bytes · when: build, load · impact: high — a missing or mismatched wasm file breaks chart creation, and a wrong content type loses streaming compilation and the code cache · support: baseline (WebAssembly SIMD) · also: SC-35
- Do: Copy `scichart2d.wasm` and `scichart2d-nosimd.wasm` (and the 3D pair if you use 3D) from the same package version as the JS into the build output. Serve them from your origin as `application/wasm`, compressed, at a stable or content-hashed URL, and point to them with `SciChartSurface.configure({ wasmUrl, wasmNoSimdUrl })` if they are not next to the page. Keep `SciChartDefaults.useWasmSimd = EUseWasmSimd.Auto`.
- Why: The library compiles with `WebAssembly.instantiateStreaming`, which needs the `application/wasm` type, and V8 keeps compiled wasm code with the cache entry of that URL: a later load from the cache or a 304 can reuse it, and a new URL or a 200 compiles again.
- Detect: `rg -n 'loadWasmFromCDN|useWasmFromCDN|wasmUrl' -g '*.{ts,tsx,js,jsx,svelte,vue}'`; a build config that does not copy `scichart2d*.wasm`; a wasm response with another content type in `list_network_requests`.
- Verify: measure.md#start with a cold and a warm cache. Pass: the wasm responses show `content-type: application/wasm` and compression, the console has no "falling back to ArrayBuffer instantiation" message, and the warm run compiles less wasm.
- Avoid: Mismatched JS and wasm versions throw "Could not load SciChart WebAssembly module". `loadWasmFromCDN()` adds a third-party connection on the chart's critical path, so use it only without a bundler (`useWasmFromCDN()` is a deprecated name for it).
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/surface/deploying-wasm/ ; https://v8.dev/blog/wasm-code-caching

- **SC-37** Give the host element an explicit CSS height and width before `create()`: without a height the surface falls back to a 3:2 aspect ratio, and every later resize clears the canvas, forces a full redraw and can shift the layout. [layout · CLS, frame · medium] https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/manual-render/
- **SC-48** Handle a failed `SciChartSurface.create()` (a rejected promise or a `catch`): show a lighter view with a clear message and send the reason to telemetry, because without WebGL2 (a blocklisted or missing GPU where Chrome desktop no longer falls back to software rendering, support.md §C) the library throws, and it caches its WebGL probe until the next page load (GPU-01). [gpu-draw · startup · high] https://cdn.jsdelivr.net/npm/scichart/Core/WebGlHelper.js

## §I GPU, DPR, backends

### SC-40 Build on the WebGL2 backend; trial the WebGPU backend only with both backends tested
stage: gpu-draw · metric: frame · when: render-loop, build · impact: high — the WebGPU backend exists only in pre-release builds, and its automatic choice changes between them · support: webgpu · also: GPU-01, SC-16
- Do: Ship the stable major version, which is WebGL2 only. If you trial the pre-release, run every chart-contract scenario on both backends (set `localStorage.IS_WEB_GPU` to `"1"` to force WebGPU and to `"0"` to force WebGL), name the backend in each result, and expect new wasm file names in the build copy rules.
- Why: WebGPU lets one device render straight to many canvases, which removes the per-chart copy and the WebGL context cap. In the checked pre-release, auto mode uses WebGPU only on Apple GPUs and falls back to WebGL when the adapter or the device fails (support.md §D).
- Detect: `rg -n 'IS_WEB_GPU|useWasm64|preloadWasm' -g '*.{ts,tsx,js,jsx,svelte,vue}'`; a `scichart` version with `alpha` or `beta` in `package.json`.
- Verify: measure.md#gpu, then measure.md#fps with `stream` on each backend (desktop profile, 5 runs each). Pass: both backends meet the chart contract, and the report names the backend, the GPU renderer and the library version.
- Avoid: The vendor's announcement says that the next major version uses WebGPU wherever the browser supports it, but the checked source is narrower, so trust the installed source. The pre-release also asks for the high-performance adapter, which costs battery on dual-GPU laptops.
- Source: https://www.scichart.com/blog/scichart-js-v6-in-alpha-webgpu-incredible-performance-gains-and-more/ ; https://api.webstatus.dev/v1/features/webgpu

- **SC-38** Set `DpiHelper.IsDpiScaleEnabled = false` before any surface exists only when a measurement shows that a large chart is fill-bound on a weak GPU: at DPR 2 a chart renders 4× the pixels, and without scaling, text and lines blur on high-DPI screens; keep `SciChartSurface.AntiAliasWebGlBackbuffer` false. [gpu-draw · frame · low] https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/retina-support-and-browser-zoom/
- **SC-39** Before you blame the chart, read the GPU renderer (`glRenderer` from `__wpProbe.env()`, or `chrome://gpu`) and report it with every benchmark: the library already asks for the high-performance GPU, but on Windows the operating system's per-app graphics setting decides which GPU Chrome uses. [gpu-draw · frame · medium] https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/
- **SC-41** Stay on the latest patch release of your major version, and upgrade the JS and both wasm files together: recent patches fixed label-cache leaks, a line-rendering freeze and heatmap caching (support.md §D). [memory, gpu-draw · memory, frame · medium] https://www.scichart.com/changelog/scichart-js/

## §J Measure hooks

- Frame time per chart: time `preRenderAll` to `renderedToDestination`. On `create()` surfaces, `renderedToWebGl` splits the WebGL render from the copy to the chart's canvas. `painted` fires only when it has a handler or when the debug helper is on.
- First frame: create with `createSuspended: true`, then `await surface.nextStateRender({ resumeBefore: true, invalidateOnResume: true, suspendAfter: false })`.
- Development only: `PerformanceDebugHelper.enableDebug = true` adds the library's marks (engine init, invalidate, data update, render) to the trace; read them with `PerformanceDebugHelper.getMeasures()`. Keep `SciChartDefaults.performanceWarnings` on in development; its one-time hints print only under a developer license.
- Counters for measure.md#mem and measure.md#fps: return the surface and series counts, a render count per surface (a `renderedToDestination` subscription), a palette-callback count and a wasm heap size from the `counters()` of `assets/perf-hooks.dev.ts`; `__wpProbe.memory.sample()` reads them. For the wasm heap size, use a property that the installed typings expose, or process memory (`uaMemory: true`).
- An attached debugger (DevTools, or a DevTools MCP session) can run wasm as slower debug code. Compare runs made under the same conditions, and label absolute chart times from an MCP session "debug tier".
