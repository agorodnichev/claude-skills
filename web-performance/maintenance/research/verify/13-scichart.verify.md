# Verify: 13-scichart.md

Checked 2026-09-23. Sources used:
- npm registry: `latest` = 5.2.69 (2026-09-08), `alpha` = 6.0.0-alpha.197 (2026-09-23 06:24 UTC), `beta` = 5.2.0-beta.6.
- Shipped package source on jsDelivr: 5.2.69, 6.0.0-alpha.196 and 6.0.0-alpha.197, plus the SciChartDefaults of 3.5.727, 3.5.782, 4.0.828, 4.0.933 and 5.0.170.
- SciChart v5 docs (WebFetch).
- SciChart changelog and blogs. WebFetch and curl get 403 or a Cloudflare page for these, so I read them in the Browser pane. I did not interact with any challenge.
- Engine sources saved by earlier checkers: Chromium `webgraphicscontext3d_provider_impl.cc`, WebKit `WebGLRenderingContextBase.cpp` and Firefox `StaticPrefList.yaml`.
- BCD 8.1.2 (2026-09-17), web-features, and the live api.webstatus.dev.

Raw files are in `raw/verify/13/`: `s5/`, `s6/`, `bin/`, `npm-scichart.json`, `files5.json`, `files6*.json` and `ws-*.json`.

## Summary

| Verdict | Count |
|---|---|
| Items checked | 51 |
| verified | 36 |
| corrected | 14 |
| disputed | 1 |
| unverified | 0 (a few sub-claims are marked unverified inside items) |

Header note: the Scope line says the latest alpha is "6.0.0-alpha.196 published 2026-09-22". 6.0.0-alpha.197 was published 2026-09-23. It changes `WebGpuHelper.js` only by one debug log line, and the gating logic is the same.

Most important corrections:
1. The render event is `renderedToWebGl` (lowercase "l"), not `renderedToWebGL`. The 5.2.69 source (`SciChartSurfaceBase.d.ts:243`) and the docs' own code sample use `renderedToWebGl`. Only the docs' prose says `renderedToWebGL`.
2. The cited blog does not support "do not pre-downsample". It recommends "Apply LTTB or min-max downsampling before data reaches the renderer". Also, SciChart does not resample several series types (see 15-gaps-round-1.md:134).
3. `suspendUpdates` does not prevent intermediate frames for synchronous code. The engine already draws once per rAF tick. Suspend matters when changes span `await`s or several tasks. `suspender.lock()` is marked `@experimental` in `UpdateSuspender.d.ts`. The example also does not type-check, because `dataSeries` is typed `IDataSeries`, which has no `appendRange`.
4. `freezeWhenOutOfView` does freeze `display:none` hosts (`entry.isIntersecting` is false). It does not freeze charts that are hidden with `visibility:hidden`, covered by other elements, or have `opacity: 0`.
5. SciChart v5 already requests `powerPreference: "high-performance"` for its WebGL2 context. The "integrated GPU by default" warning applies only where the browser ignores the hint.
6. The v6 WebGPU auto gate is: the UA matches `/Mac/` and the adapter is an Apple GPU. This also matches iPhone and iPad UAs ("like Mac OS X") and any browser on Apple silicon, not only "Apple Silicon Macs".

---

### Append in batches with appendRange, never point by point
- Verdict: corrected
- Correction: The Status line says "appendRange got a further 50-100% boost in v3.2". The changelog entry "Performance Boost of 50-100% when calling dataSeries.appendRange" is under release "3.1.3333" (sic), dated 25 April 2023. That is v3.1 (the npm 3.1.x line), not v3.2. The other facts are verified:
  - 69 ms vs 1 ms (perf-tips).
  - "This performance difference is more noticeable with insert & remove" (perf-tips 1.x).
  - Chrome rapid-invalidate slowdown: changelog 3.4.672 (27 Sep 2024), "Worked around a new performance issue in Chrome which happens if the chart is invalidated very rapidly, eg by calling dataSeries.append/insert/update".
  - OHLC `appendRange(xValues, openValues, highValues, lowValues, closeValues, metadata?)` (OhlcDataSeries.d.ts:112).
  - v5 "Up to 2.4x faster: series‑append line charts" (sdk-5.0).
- Evidence: https://www.scichart.com/changelog/scichart-js/ ; https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/OhlcDataSeries.d.ts ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/

### Coalesce streaming ticks into one appendRange per animation frame
- Verdict: verified
- Note:
  - Docs quote: "Redraws are throttled so that a redraw only occurs every 1/60th of a second, no matter how often you update data." In the 5.2.69 bundle, the engine main loop uses `requestAnimationFrame`. The `1e3/60` timer is only the fallback when rAF does not exist. So the real limit is "once per display frame", which can be 120/s on 120 Hz screens. This is inferred from the minified bundle, not measured.
  - The v6 blog (published 2 Jul 2026, updated 16 Jul 2026) says: "A single animation-frame loop drains those buffers once per frame and hands each chart the slice of new data it needs". It also says the WebSocket is decoded in a web worker.
  - `appendRange` copies the data: `appendDoubleVectorFromJsArray` does `wasmContext.HEAPF64.set(source, …)`. So reusing the backing buffer is safe.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/realtime-updates/ ; https://www.scichart.com/blog/scichart-js-v6-in-alpha-webgpu-incredible-performance-gains-and-more/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/utils/ccall/appendDoubleVectorFromJsArray.js

### Declare dataIsSortedInX and containsNaN when you create the series
- Verdict: corrected
- Correction: "In dev builds SciChart prints a one-time console warning" is not exact. `OneTimePerformanceWarning.warn()` prints only when all three are true:
  - `SciChartDefaults.performanceWarnings` is true.
  - The warning was not printed before.
  - `licenseManager2dState.isDev` is true (the developer-licence state, not the bundler build mode).

  The auto-detection is incremental. `DataDistributionCalculator.onAppend` scans only the new X/Y values and stops scanning once the series is known to be unsorted or to contain NaN. It does not rescan the whole series. The other facts are verified:
  - 55 ms vs 11 ms (perf-tips).
  - "a factor of 5" for updates (resampling page).
  - "undefined behaviour will occur if these flags are set incorrectly" (DataSeries overview).
  - In 5.2.69 the constructor sets `isSortedProperty`/`containsNaNProperty` to undefined, and `dataIsSortedInX ?? isSorted` is used, so the alias exists.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Core/OneTimePerformanceWarning.js ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/DataDistributionCalculator/DataDistributionCalculator.js ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.js (lines 92-124) ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/data-series-api-overview/

### Set dataEvenlySpacedInX only when X spacing is truly uniform
- Verdict: verified
- Note:
  - The 5.2.69 constructor sets `_this.isEvenlySpacedProperty = false` and then `isEvenlySpaced = options.dataEvenlySpacedInX ?? false`.
  - `DataDistributionCalculator` has no even-spacing detection.
  - The d.ts says "(defaults to true)", and the resampling docs list "uniformly spaced" as auto-calculated. Both are wrong against the source.
  - `ResamplingMode.d.ts` says MinMax/Mid/Min/Max "Assumes Evenly-spaced data" and MinMaxWithUnevenSpacing "Does not assume Evenly-spaced data".
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.js ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.d.ts (lines 44-50) ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Numerics/Resamplers/ResamplingMode.d.ts

### Keep time-series data sorted in X
- Verdict: verified
- Note:
  - Perf-tips: "SciChart.js uses a number of optimised algorithms when your data is sorted in the X-direction", rated "Large Improvement to Rendering in apps on all browsers".
  - sdk-5.0: unsorted scatter up to 2.2x faster, unsorted line up to 1.7x faster.
  - In source, `getIndicesRange` does a binary search only when `isSortedAscending` is true.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.js

### Pre-size DataSeries with capacity when the final size is known
- Verdict: verified
- Note:
  - Perf-tips measures 22 ms vs 15 ms.
  - The docs code bug is real: `const CAPACITY = 1_000_000;` … `new XyDataSeries(webAssemblyContext, { capacity: COUNT })` with `COUNT = 10_000`.
  - d.ts: "You can avoid memory fragmentation by creating your series with a larger capacity".
  - "wasm memory never shrinks" is from the Memory64 blog: "WebAssembly linear memory can only grow, never shrink".
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.d.ts (lines 76-80) ; https://www.scichart.com/blog/memory64-unlocking-webassemblys-true-potential-with-16gb-of-in-browser-memory/

### Use fifoCapacity for rolling windows instead of removeRange + appendRange
- Verdict: verified
- Note:
  - d.ts: "can only be set in the constructor options … does not support insert/insertRange or remove/removeRange … Spline series and Stacked series currently do not support fifo mode".
  - Docs: "FIFO series … are internally handled as a circular buffer. They cannot be resized."
  - The conflict the notes report is real. Changelog 3.5.687 (11 Oct 2024) says "Spline series and series using RenderDataTransforms now support FifoCapactiy".
  - Speed-up: sdk-5.0 says 3.9x, and the changelog 5.0.170 says "4x faster for FIFO realtime series".
  - FIFO was added in 3.2.446 (28 Jul 2023).
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.d.ts (lines 55-64) ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/realtime-updates/ ; https://www.scichart.com/changelog/scichart-js/

### Use fifoSweeping for wrap-around (ECG-style) displays
- Verdict: verified
- Note: Docs say "X must range from 0...fifoCapacity" and "xValue[i] = i % fifoCapacity". `fifoSweepingGap` defaults to 1 (BaseDataSeries.js:99). Added in 3.2.446.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/realtime-updates/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.js

### Pass Float64Array buffers and reuse them
- Verdict: verified
- Note:
  - Perf-tips 1.6: number[] 24 ms vs Float64Array 21 ms, "minor performance improvements".
  - Perf-tips 1.7: buffer reuse, 40 ms vs 24 ms.
  - `NumberArray = number[] | Float64Array` (types/NumberArray.d.ts).
  - The copy is `HEAPF64.set(source, …)`, which is a straight memcpy for a Float64Array.
  - sdk-5.0 confirms Float64Array for heatmaps and 3D.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/types/NumberArray.d.ts ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/utils/ccall/appendDoubleVectorFromJsArray.js

### Replace data with clear() + appendRange() on the same series
- Verdict: verified
- Note: The deleting-memory page says clear "does not delete memory, just removes all data-points" and gives the example "xyDataSeries is cleared but retains memory". It also says "When re-assigning a dataseries, make sure to delete the old series".
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/deleting-memory/

### Read DataSeries values back with vectorToArrayViewF64, not get(i) loops
- Verdict: corrected
- Correction: Add a FIFO caveat. The example `ys[series.count() - 1]` is wrong for a FIFO series after it wraps. FIFO series store a circular buffer, and the logical index `i` is at physical index `(fifoStartIndex + i) % fifoCapacity` (BaseDataSeries.js:858 and 1065; the `fifoStartIndex` getter is at line 576). The notes recommend FIFO for live feeds, so this case is common. Use `series.fifoStartIndex` to unwrap. Other facts are verified:
  - Timings 400 / 62 / 4 ms and the 13 ms deep copy.
  - Added in 4.0.873 (25 Sep 2025).
  - Detached-buffer warning: "TypeError: Cannot perform %TypedArray%.prototype.set on a detached ArrayBuffer".
  - Signature: `vectorToArrayViewF64(vector, wasmContext)`.
  - Precision: the view detaches when the wasm memory grows for any reason (any allocation on that wasm context), not only when "any series grows".
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/get-set-value-at-index/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/utils/vectorToArray.d.ts ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.js

### Update heatmaps in place and prefer the uniform heatmap
- Verdict: verified
- Note:
  - Docs quote: "modify part of the existing the 2d array and calling heatmapDataSeries.notifyDataChanged()" and `setZValues(newZValues)`.
  - Non-uniform page: "use the Uniform Heatmap for faster performance".
  - Changelog 5.0.170: "fixed 4000x4000 memory out of bounds error and added Float64Array support to heatmaps".
  - sdk-5.0: "textures up to the WebGL max (for example, 16384×16384)".
  - Changelog 5.2.55 (16 Jul 2026): "NonUniformHeatmapRenderableSeries caching logic, resulting in a 3-5x FPS increase".
  - "Full texture upload per update" is an inference, and no source states it.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/uniform-heatmap-renderable-series/updating-realtime/ ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/non-uniform-heatmap-renderable-series/ ; https://www.scichart.com/changelog/scichart-js/

### Leave resampling on Auto; never ship debugDisableResampling
- Verdict: verified
- Note:
  - Docs quotes:
    - "10,000,000 (ten million) data-points in under 25 milliseconds".
    - "from around 100,000 datapoints or more".
    - "For smaller datasets Resampling will have no effect on performance. SciChart.js is already very highly optimised for datasets up to 1 million datapoints".
    - Precision 1.0: "approx ~20% performance decrease".
    - The rename: "Prior to version 3.5 this was called SciChartDefaults.enableResampling".
    - "New to SciChart.js v2.1!"
  - Enum values match `ResamplingMode.d.ts`, including `MinOrMax` "EXPERIMENTAL!".
  - SIMD 2-4x: changelog 5.0.170.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/resampling/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Numerics/Resamplers/ResamplingMode.d.ts ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartDefaults.js

### Do not pre-downsample in the browser; aggregate on the server for long history
- Verdict: disputed
- Correction:
  - The cited blog says the opposite of the "Do" line. It says "Apply LTTB or min-max downsampling before data reaches the renderer" and "A financial dashboard might combine rollup tables on the server with min-max decimation on the client for the same chart". The blog is generic, so it is not evidence for a SciChart rule. Only the resampling docs support the reasoning that SciChart already resamples sorted series.
  - Limit the rule to series that SciChart resamples. 15-gaps-round-1.md:134-151 shows, from the 5.2.69 `BaseRenderableSeries.supportsResampling`, that these get no resampling:
    - heatmaps and contours
    - bubble, error bars, box plot and line segment
    - stacked series
    - X-unsorted data on a non-category axis
    - `resamplingMode: None` without FIFO

    For these series, client-side decimation (in a worker) is a valid lever.
  - Server aggregation for long history is still correct.
- Evidence: https://www.scichart.com/blog/how-to-visualize-millions-of-data-points-efficiently/ ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/resampling/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/RenderableSeries/BaseRenderableSeries.js

### Keep spline interpolationPoints low
- Verdict: verified
- Note:
  - Docs quotes: "When the interpolationPoints property is set to zero, then this series renders and displays exactly like a FastLineRenderableSeries", and "10 … 10x the number of datapoints … adjust down the interpolationPoints depending on amount of data on the chart, or zoom level".
  - Add: the default is 10 (`interpolationPointsProperty = 10`, SplineLineRenderableSeries.js:65), so a default spline draws 10x vertices.
  - Splines run as a RenderDataTransform after resampling (changelog 3.4.662: "Ensure renderDataTransforms run if resampled data changes"), so the 10x applies to the resampled point count.
  - The 4.6x v5 speed-up is verified.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/spline-line-renderable-series/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/RenderableSeries/SplineLineRenderableSeries.js ; https://www.scichart.com/changelog/scichart-js/

### Know the render loop: invalidate, then one draw on the next frame
- Verdict: verified
- Note:
  - Docs quote: "Chart resizing, pixel ratio changes, or tab visibility changes call the `invalidateElement` method with the `force: true` option. This triggers a redraw regardless of the suspend state."
  - `invalidateOnTabVisible` is true in SciChartSurfaceBase.js:774. Its d.ts says "to deal with the issue of canvas data being cleared on an inactive tab".
  - The d.ts describes "an internal loop based on requestAnimationFrame which triggers a chart draw on any surfaces that have been invalidated".
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/batching-updates-or-temporary-suspending-drawing/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurfaceBase.d.ts ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurfaceBase.js

### Wrap multi-step updates in suspendUpdates / resumeUpdates (or suspender.lock)
- Verdict: corrected
- Correction:
  - (1) The Why and Impact lines overstate the effect. Invalidation only marks the surface, and the engine draws once in its next rAF tick. So a synchronous batch in one task (like the example) already gives one frame without suspend. Suspend prevents intermediate frames only when changes span `await`s, several tasks or several rAF callbacks. It also skips per-change invalidate work. Keep the advice for async multi-step builds (`createSuspended`) and for changes spread across callbacks.
  - (2) `IUpdateSuspender.lock()` is documented `@experimental` in `Charting/Visuals/UpdateSuspender.d.ts`. Do not present it as the preferred API without that label.
  - (3) The example does not type-check. `IRenderableSeries.dataSeries` is typed `IDataSeries`, which has no `appendRange`, and `FastCandlestickRenderableSeries` does not narrow the type. Keep typed references instead: `const candles = new OhlcDataSeries(...)`, then `candles.appendRange(t, o, h, l, c)`.
  - (4) The claim that a missing resume freezes "mouse input" is unverified. The docs only say "your chart appears frozen". The v5 SVG-only modifiers (`renderDomOnly`) run on their own rAF.
  - Verified parts:
    - The counter semantics.
    - `resumeUpdates({ force?, invalidateOnResume? })`, which matches the d.ts.
    - `createSuspended` (3.3.567) and `nextStateRender`.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/batching-updates-or-temporary-suspending-drawing/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/UpdateSuspender.d.ts ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/IDataSeries.d.ts ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/RenderableSeries/IRenderableSeries.d.ts (line 99)

### Drive rendering yourself only when you own the frame loop (disableEngineLoop)
- Verdict: verified
- Note:
  - Docs: "If you create a chart with `disableEngineLoop: true`, the engine calls `TSRSetDrawRequestsEnabled(false)`". `TSRRequestDraw` "Triggers an immediate draw of all charts associated with this wasmContext". `TSRRequestCanvasDraw` "Marks a specific canvas for redraw on the next frame".
  - d.ts: "2D and 3D charts, and all charts created using createSingle have separate webassemblyContexts so you must call TSRRequestDraw() on each one … for SciChartSurface.create this will change the behaviour of all existing charts".
  - Changelog 5.0.170: "Optional manual render control".
  - Docs: the canvas "is cleared and requires a full redraw whenever it is resized".
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/manual-render/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurfaceBase.d.ts (lines 97-104)

### Hook the right render event so changes land in the same frame
- Verdict: corrected
- Correction:
  - The event is `renderedToWebGl`, not `renderedToWebGL`. See `SciChartSurfaceBase.d.ts:243` (`renderedToWebGl: EventHandler<any>`), SciChartSurface.js:1589 and the docs' own code sample (`surface.renderedToWebGl.subscribe`). The misspelled name is `undefined` at runtime, and a TS compile error.
  - Add what the source does:
    - `renderedToDestination` is raised right after `renderedToWebGl` only for non-copy (`createSingle`) surfaces (`if (!this.isCopyCanvasSurface)`).
    - For `create()` surfaces, it fires after the copy to the 2D canvas.
    - The docs sample subscribes to `renderedToWebGl` only when `surface.isCopyCanvasSurface`.
  - Verified parts:
    - `redrawRequested` and `preRenderAll` "only fired on the main surface and does not apply to sub-charts".
    - "Some event handlers suspend internal chart invalidations".
    - Changelog 3.5.739 on `layoutMeasured`: "It is important not to change data, visible range or other layout related …".
    - Breaking-changes v4→v5: code that uses `preRender` and relies on Rollover/Cursor/VerticalSlice annotation positions must move to `layoutMeasured`.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurfaceBase.d.ts ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurface.js (lines 1589-1592) ; https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/render-events/ ; https://www.scichart.com/documentation/js/v5/whats-new/breaking-changes-v4-v5/ ; https://www.scichart.com/changelog/scichart-js/

### Measure chart frames with render events and PerformanceDebugHelper
- Verdict: corrected
- Correction:
  - Same name fix: the Why line's `renderedToWebGL` must be `renderedToWebGl`.
  - `painted` is raised through `runAfterFramePaint` only when it has handlers or `PerformanceDebugHelper.enableDebug` is on (SciChartSurface.js:1594-1598).
  - The performance warnings are gated on the developer-licence state (`licenseManager2dState.isDev`), except `wasmSimdWarning`.
  - Verified parts:
    - `PerformanceDebugHelper.enableDebug` (default false), `getMeasures()` and `outputLogs()`, which use `performance.mark`/`measure` (utils/performance.d.ts:241-252).
    - PerformanceDebugHelper was added in 3.3.567 (12 Feb 2024).
    - `receiveNextEvent` exists.
    - The `nextStateRender({ resumeBefore, suspendAfter, invalidateOnResume })` signature matches.
    - Docs: "To measure frame render time, use preRenderAll and renderedToDestination".
    - The one-time warning list matches `constants/performanceWarnings.js`.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/utils/performance.d.ts ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurface.js ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/constants/performanceWarnings.js ; https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/render-events/

### Set freezeWhenOutOfView on charts inside scroll views, tabs or collapsible panels
- Verdict: corrected
- Correction:
  - Replace "Charts hidden by display:none … not documented whether freeze covers them" with the source behavior. `Core/ObserveVisibility.js` uses `new IntersectionObserver(cb, { root: null, threshold: 0.01 })` and passes `entry.isIntersecting` to the surface. The surface takes `suspender.lock()` when it is false (SciChartSurfaceBase.js:438-448). A `display:none` host reports `isIntersecting: false`, so it is frozen.
  - Charts hidden with `visibility:hidden`, `opacity:0`, or covered by another panel (stacked tabs) still intersect the viewport and are not frozen. Suspend or detach those yourself.
  - Verified parts:
    - Added in 3.5.727 (17 Feb 2025).
    - Blog: "only 20-30 are visible at any one time … With Freeze Charts out of View: 57-60 FPS; Without: 13 FPS".
    - IntersectionObserver is Baseline widely available (high date 2021-09-25).
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Core/ObserveVisibility.js ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurfaceBase.js ; https://www.scichart.com/blog/creating-a-react-drag-drop-chart-dashboard/ ; https://api.webstatus.dev/v1/features/intersection-observer

### Group dense panel layouts into SubCharts on one parent surface
- Verdict: corrected
- Correction:
  - (1) "The docs report 10x for hundreds of charts" is wrong attribution. The 10x claim is in changelog 3.0.317 ("Performance Boost: 10x Faster Performance for hundreds of charts scenario by using SubCharts API"). The dashboard blog says "8-10 times faster than before", measured against a v2.x baseline, with native text and SubCharts combined. The v5 SubCharts docs give no multiplier.
  - (2) `position: new Rect(x, y, w, h)` is relative by default: "If coordinateMode is Relative (the default) then the values give the size as a proportion of the parent div, and all properties must be between 0 and 1".
  - (3) "Sub-charts render in insertion order after the parent" is only the default. `resolveSurfaceOrders()` sorts by `getSurfaceRenderOrder()` (a `surfaceRenderOrder` override exists) and skips sub-charts with `isVisible === false`.
  - Verified parts:
    - 128 charts: 13.0 FPS (native text) → 28.9 FPS (SubCharts), from the blog table.
    - The Firefox/Safari quote: "Mozilla (and even safari) are not optimised for high performance when copying WebGL content to multiple canvases".
    - The `subchartBackgroundNotSimpleColor` warning.
    - SubCharts were added in 3.0.317.
- Evidence: https://www.scichart.com/changelog/scichart-js/ ; https://www.scichart.com/blog/pushing-the-boundaries-of-javascript-chart-dashboard-performance/ ; https://www.scichart.com/documentation/js/v5/2d-charts/subcharts-api/subcharts-api-overview/ ; https://www.scichart.com/documentation/js/v5/2d-charts/subcharts-api/exampe-dynamic-multi-panel-charts-with-sub-charts/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurface.js (lines 1471-1487)

### Default to SciChartSurface.create(); use createSingle() only for a few heavy charts
- Verdict: verified
- Note:
  - The context caps match the engine sources:
    - Chromium: `max_active_webgl_contexts = 16u` on desktop and `8u` on Android, with 4 in workers.
    - WebKit: `maxActiveContexts = 16`.
    - Firefox: `webgl.max-contexts-per-principal = 300` and `webgl.max-contexts = 1000`.
  - The v6 blog: "Go past that and the browser starts silently destroying the oldest contexts".
  - The createSingle d.ts says "there is a limit (16)".
  - 80 MB: the SciChartDefaults.js comment says "10 buffers … maximum of 80MB". The memory docs say "theoretical maximum = 8 x wasmBufferSizesKb". This is a small doc/source mismatch.
  - The "250 ms first chart / sub-10 ms later" figures come from the v5.0 release post, not from new-scichart-surface. That page has no timing.
  - Mechanism (unverified detail): 5.2.69 copies the shared WebGL canvas with `ctx2d.drawImage(masterCanvas, …)` (`globalCompositeOperation = "copy"`). Whether this is a GPU-to-CPU readback depends on the browser's 2D canvas backend. "Readback" is SciChart's blog wording.
  - Missing caveat: `createSingle()` reloads the page on WebGL context loss (see Missing #1).
- Evidence: raw/verify/10/cr_content_renderer_webgraphicscontext3d_provider_impl.cc (lines 121-127) ; raw/verify/10/wk-WebGLRenderingContextBase.cpp (line 193) ; raw/verify/10/ff-StaticPrefList.yaml (lines 20526-20534) ; https://www.scichart.com/scichart-js-v5-released/ ; https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-best-practices/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurface.d.ts

### Strip axis decoration on small or numerous charts
- Verdict: verified
- Note:
  - Blog: "With Reduce Axis Elements: 60 FPS / Without: 30-40 FPS" and "10 major gridlines, 50 minor gridlines, as well as 10 major and 50 minor ticks … up to 12,000 extra elements".
  - All option names exist in 5.2.69 (`drawMinorGridLines`, `drawMinorTickLines`, `drawMajorTickLines`, `drawMajorBands`, `maxAutoTicks`, `drawLabels`).
- Evidence: https://www.scichart.com/blog/creating-a-react-drag-drop-chart-dashboard/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/Axis/AxisCore.d.ts

### Keep native text and the shared label cache on for axis labels
- Verdict: corrected
- Correction:
  - (1) "Async labels are deprecated" should say "removed". `ILabel2DOptions.asyncLabels` is "@deprecated This functionality has been removed. useNativeText: true provides much greater performance benefit".
  - (2) Add a third doc/source conflict: the `LabelProviderBase2D.useSharedCache` d.ts comment still says "Currently default false". The JS reads `options.useSharedCache ?? SciChartDefaults.useSharedCache`, which is true.
  - (3) The label-cache fixes are listed under 5.0.211 (12 Mar 2026), which the changelog says "has been promoted to 5.1.0". "v5.1.0" is acceptable.
  - Verified parts:
    - `useSharedCache`/`useNativeText` are false in 3.5.727 and 3.5.782, and true from 4.0.828 (first 4.0 stable) through 5.2.69.
    - Perf-tips still says "useSharedCache is not enabled by default".
    - The blog table: 5.5 FPS with canvas labels and no cache, 60 FPS with native text and cache.
    - `fontStyle`/`fontWeight` are not supported with native text.
    - `nativeFontTimeout` is 2000 ms, and "will not follow a http 302 redirection".
    - `labelCache` has maxSize 200 and minAge 200 ms.
    - Per-axis `useSharedCache` works because `INumericAxisOptions extends ILabel2DOptions`.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/Axis/LabelProvider/LabelProviderBase2D.d.ts ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/Axis/LabelProvider/LabelProviderBase2D.js (line 90) ; https://cdn.jsdelivr.net/npm/scichart@4.0.828/Charting/Visuals/SciChartDefaults.js ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/Axis/LabelProvider/LabelCache.js ; https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/native-text-api/

### Turn native text off only to cut first-chart startup when labels are static
- Verdict: verified
- Note:
  - Perf-tips section 3.4: native text "requires additional initialization time to create a font atlas". It also says: "If the app does not require updating/creating a lot of labels in real time disabling native text would be a good option to boost up the startup time".
  - Breaking-changes v4→v5: "Default native font has been change from Arial to Arimo".
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://www.scichart.com/documentation/js/v5/whats-new/breaking-changes-v4-v5/

### Set autoColorMode to Never or Once when you give series explicit colors
- Verdict: verified
- Note:
  - The docs say the default is `OnAddRemoveSeries`, and "With a fairly large number of series, Auto Coloring can potentially have a performance impact".
  - In source (SciChartSurface.js:745-750), `resolveAutoColors()` runs while `autoColorRequired` is true, and the flag is cleared unless the mode is `Always`. So `Always` resolves on every render.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/styling-and-theming/auto-coloring/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurface.js

### Prefer render-context annotations over SVG and HTML annotations
- Verdict: verified
- Note:
  - Class hierarchy in 5.2.69:
    - `LineAnnotation`, `BoxAnnotation`, `AxisMarkerAnnotation` and `NativeTextAnnotation` extend `RenderContextAnnotationBase`.
    - `HorizontalLineAnnotation` and `VerticalLineAnnotation` extend `LineAnnotation`.
    - `TextAnnotation` and `CustomAnnotation` extend `SvgAnnotationBase`.
    - `HtmlCustomAnnotation` extends `DomAnnotationBase`.
  - Changelog 3.5.711: "Creating a large amount of svg is still slow (300ms for the first frame for 1000 annotations) but subsequent frames are now 10ms".
  - `alwaysRedrawFullChartOnSvgChange = false` ("From v5.0 updates to svg annotations will not trigger a redraw of the whole chart").
  - `reDrawChartOnChange` exists.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/Annotations/LineAnnotation.d.ts ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartDefaults.js ; https://www.scichart.com/changelog/scichart-js/

### Keep isSvgOnly on for cursor and rollover tooltips
- Verdict: verified
- Note:
  - `isSvgOnly` is "@default true" in RolloverModifier.d.ts:101-105 and CursorModifier.d.ts:90-94. The JS default is `isSvgOnlyProperty = true`.
  - `VerticalSliceModifier extends RolloverModifier`.
  - Changelog 5.0.170: "SVG Mode for tooltips (to avoid a full render) improving performance of tooltips in large datasets".
  - In source, the SVG-only path schedules its own rAF with `renderDomOnly()`.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/ChartModifiers/RolloverModifier.d.ts ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/ChartModifiers/CursorModifier.d.ts ; https://www.scichart.com/changelog/scichart-js/

### Limit data labels before SciChart has to generate them
- Verdict: verified
- Note: Docs quotes:
  - "The number of labels generated is therefore pointCount / ( skipNumber + 1)".
  - "Setting pointGapThreshold to around 1 will cause labels to appear only when there is room".
  - For `pointCountThreshold`: "may give more predictable results" for jagged data.
  - "SciChart has to calculate the text, size and position of every label, and then throw most of them away".
  - "performance warnings … if more than 80% of labels were skipped".
  - "Set calculateTextBounds to false for a performance boost if rendering many labels and their size doesn't matter".
  - DataLabels were added in 3.0.317.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-point-labels/data-label-skip-modes-and-culling/ ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-point-labels/data-label-positioning/

### In custom native-text drawing, batch and avoid early flushes
- Verdict: verified
- Note:
  - Docs quotes:
    - "Fonts are cached and shared within webassembly, so there is no need to cache them in JS" and there is no need to delete them.
    - "SciChart automatically calls font.End on all fonts at the end of the render cycle … for optimum performance you want to do this as little as possible".
    - SDF: "much better rendering for rotated and scaled text", while normal fonts use "less memory and are slightly faster".
  - Ordered-rendering names `renderNativeAxisLabelsImmediately` and `drawImmediate`. Both exist in the 5.2.69 bundle.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/native-text-api/ ; https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/ordered-rendering/

### Make custom PaletteProviders cacheable (shouldUpdatePalette, isRangeIndependant)
- Verdict: verified
- Note:
  - In 5.2.69, `DefaultPaletteProvider.shouldUpdatePalette()` returns `true`, and its `isRangeIndependant` getter returns `false`.
  - The interface comment: "If this does NOT exist, the palette will be recalculated on every render. This default will change in v4."
  - The changelog history:
    - 3.2.538 added the API.
    - 3.2.543 said "We will be changing this default in version 4 to reuse if at all possible".
    - 3.2.549 said "Default false until v4".

    The change did not land.
  - v5 PaletteProvider is up to 5.5x faster.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/IPaletteProvider.js ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/IPaletteProvider.d.ts (lines 24-34) ; https://www.scichart.com/changelog/scichart-js/

### Write RenderDataTransforms that reuse their point series
- Verdict: verified
- Note: Docs quotes:
  - "Since 3.4.662 … XyBaseRenderDataTransform, XyyBaseRenderDataTransform, or OhlcBaseRenderDataTransform".
  - "You should clear and push to the vectors on BaseRenderDataTransform.pointSeries. Do NOT create a new pointSeries in runTransformInternal".
  - For `requiresTransform` and `useForYRange`, the docs text matches the notes.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/render-data-transforms-api/

### Implement incremental hooks in custom data filters
- Verdict: verified
- Note:
  - Signatures: `filterOnAppend(count)`, `filterOnUpdate(index)`, `filterOnInsert(startIndex, count)`, `filterOnRemove(startIndex, count)`, `onClear()`, plus the required `filterAll()`.
  - Base classes: `XyFilterBase`, `XyyFilterBase`, `XyzFilterBase` and `OhlcFilterBase`.
  - v5: "Up to 3.5x faster: Data Filters".
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-filters-api/custom-filter/ ; https://www.scichart.com/documentation/js/v5/whats-new/sdk-5.0/

### Give DiscontinuousDateAxis an explicit dataGap
- Verdict: verified
- Note:
  - Best-practice list: "Always specify `dataGap` when possible to avoid auto-calculation overhead" and "Set `autoRange: EAutoRange.Never` when manually controlling the visible range".
  - `dataGap` is "Auto-calculated from minimum gap if not specified".
  - Added in 5.0.170 ("BaseValueAxis and DiscontinuousDateAxis types").
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/axis-api/axis-types/discontinuous-date-axis/ ; https://www.scichart.com/changelog/scichart-js/

### Skip series animations on live and multi-chart views; reuse the animation DataSeries
- Verdict: verified
- Note: Docs quotes:
  - "Do not create a new DataSeries here or it will leak and eventually crash".
  - "register this so it is deleted along with the main surface".
  - "datasets need the same amount of X,Y datapoints before and after".
  - "use runAnimation method, or, alternatively setting the BaseRenderableSeries.animation property" cancels running animations.
  - "the built in animations are well optimised for each series type".
  - `autoRangeAnimation` uses the same technique.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/animations-api/dataset-animations/ ; https://www.scichart.com/documentation/js/v5/2d-charts/animations-api/animations-api-overview/ ; https://www.scichart.com/documentation/js/v5/2d-charts/animations-api/generic-animations/

### Call sciChartSurface.delete() once on unmount
- Verdict: verified
- Note:
  - Memory docs: "When calling delete on a parent, all child items are deleted so to properly clean-up an entire chart, you must only call sciChartSurface.delete() once".
  - React tutorial: "<SciChartReact /> automatically calls sciChartSurface.delete(), ensuring that all wasm memory is disposed on component unmount".
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-best-practices/ ; https://www.scichart.com/documentation/js/v5/get-started/tutorials-react/tutorial-01-setting-up-project-with-scichart-react/

### Delete what you swap out; know that collection remove/clear delete by default
- Verdict: verified
- Note:
  - In ObservableArray.js:86-123, `removeAt`, `remove` and `clear` default `callDeleteOnChildren = true`.
  - `BaseRenderableSeries.delete()` calls `deleteSafe(this.dataSeries)`.
  - The `dataSeries` setter only swaps subscriptions and does not delete the old series.
  - Docs: "Calling delete on a RenderableSeries will delete both the RenderableSeries and its DataSeries".
  - Optional delete was added in 3.2.446.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Core/ObservableArray.js ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/RenderableSeries/BaseRenderableSeries.js (lines 521-541, 805-815) ; https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/deleting-memory/

### Tie timers and helper objects to the surface with addDeletable
- Verdict: verified
- Note: `addDeletable` is used in SciChartSurfaceBase.js:184 and 200. `delete()` iterates over `this.deletables` (lines 480-503). The dataset-animation docs register a temporary DataSeries this way.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurfaceBase.js ; https://www.scichart.com/documentation/js/v5/2d-charts/animations-api/dataset-animations/

### Decide when the shared wasm context is disposed in a SPA
- Verdict: verified
- Note:
  - `autoDisposeWasmContext = false` and `wasmContextDisposeTimeout = 0` (SciChartSurfaceBase.js:764-768).
  - Docs: "for charts instantiated with SciChartSurface.createSingle() wasmContext is destroyed automatically upon surface deletion".
  - The `wasmContextAutoDisposeDisabled` warning exists. It is licence-gated like the others.
  - Memory64 blog: "WebAssembly linear memory can only grow, never shrink".
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurfaceBase.js ; https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-best-practices/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/constants/performanceWarnings.js

### Hunt leaks with MemoryUsageHelper in development
- Verdict: corrected
- Correction:
  - The docs say NODE_ENV "must not equal "prod" or "production"". The 5.2.69 source checks only `process.env.NODE_ENV !== "production"`, so "prod" does not disable it. The check runs inside `try`. If the bundler does not define `process.env`, the access throws, the error is only `console.warn`ed, and debug mode stays off.
  - Setting the flag also logs "Memory usage debug enabled! Make sure to disable it for production build!".
  - Verified parts:
    - `objectRegistry.log()` prints `collectedNotDeleted` and `deletedNotCollected`.
    - `register(entity, id?)` and `unregister(id)` exist.
    - The helper was added in 3.2.446.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/utils/MemoryUsageHelper.js (setter of `isMemoryUsageDebugEnabled`) ; https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-leak-debugging/

### Lower wasmBufferSizesKb only in memory-constrained targets
- Verdict: verified
- Note:
  - `wasmBufferSizesKb = 1024 * 8`, and the comment says "Do not set lower than 1024kb or higher than 32MB … clamped" and "needs to be set before charts created".
  - The source comment says buffers "grow with usage and caps out", so 80 MB is a ceiling, not a static allocation at startup.
  - The docs give "theoretical maximum = 8 x wasmBufferSizesKb", while the source comment says 10 buffers.
  - Added in 3.2.446 ("Allow configuring WebGL Buffer sizes in low-memory environments").
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartDefaults.js ; https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/memory-best-practices/

### Plan for the wasm heap ceiling (4 GB in v5; opt-in Memory64 in v6 alpha)
- Verdict: verified
- Note:
  - Changelog 5.0.170: "Increased max WASM memory from 2GB to 4GB".
  - Memory64 blog (23 Jul 2026, updated 4 Aug 2026): "roughly 200 million data points … 16 bytes per point", "~10% performance hit", and "Firefox >= 143". The Firefox figure is wrong. BCD 8.1.2 and webstatus say Firefox 134, and the alpha d.ts also says 134.
  - BCD lists Safari as "preview" (Technology Preview only). webstatus.dev says `limited`.
  - `useWasm64 = EUseWasm64.Never` in the alpha.197 SciChartDefaults.js.
  - Changelog 4.0.918: "If you ran out of memory when appending data, the error used to be swallowed. This is now rethrown with a more helpful message".
- Evidence: https://api.webstatus.dev/v1/features/wasm-memory64 ; https://www.scichart.com/blog/memory64-unlocking-webassemblys-true-potential-with-16gb-of-in-browser-memory/ ; https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.197/types/types/EUseWasm64.d.ts ; https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.197/esm/Charting/Visuals/SciChartDefaults.js ; raw/verify/02/bcd.json (`webassembly.memory64`)

### Serve both SIMD and no-SIMD wasm and keep useWasmSimd on Auto
- Verdict: verified
- Note:
  - Wasm SIMD is Baseline widely available: low 2023-03-27, high 2025-09-27; Chrome 91, Firefox 89, Safari 16.4.
  - The docs error text: "Could not load SciChart WebAssembly module. Check your build process and ensure that your scichart2d.wasm, scichart2d-nosimd.wasm and scichart2d.js are from the same version".
  - Breaking-changes v4→v5: "SciChart.js v5 is now WebGL 2 only". WebGL2 is Baseline widely available (high 2024-03-20).
  - Side note: the 5.2.69 `WebGlHelper` still has a `webgl` (WebGL1) detection branch, but the docs say WebGL1 is unsupported.
- Evidence: https://api.webstatus.dev/v1/features/wasm-simd ; https://www.scichart.com/documentation/js/v5/2d-charts/surface/deploying-wasm/ ; https://www.scichart.com/documentation/js/v5/whats-new/breaking-changes-v4-v5/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/types/EUseWasmSimd.d.ts

### Self-host the wasm next to your app; use the CDN only when you have no bundler
- Verdict: corrected
- Correction:
  - (1) `useWasmFromCDN()` does not "error in React". The d.ts marks it `@deprecated` because "the method name breaks eslint react-hooks/rules-of-hooks" (the `use` prefix). `useWasmLocal()` is deprecated for the same reason. The replacements are `loadWasmFromCDN()` and `loadWasmLocal()`.
  - (2) Size precision for 5.2.69: `scichart2d.wasm` is 1,278,913 bytes raw and about 659 KB with gzip -9. "About 1 MB" matches the sdk-5.0 wording but not the current file.
  - Verified parts:
    - `SciChartSurface.configure({ wasmUrl, wasmNoSimdUrl })` (`TSciChartConfig`).
    - "45% smaller wasm files".
    - "up to 300ms faster for first chart" (changelog 5.0.170).
    - Since v4.0 the `.data` file is embedded in the wasm (TSciChartConfig comment).
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurface.d.ts (lines 93-111) ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurfaceBase.d.ts (lines 25-43) ; https://data.jsdelivr.com/v1/packages/npm/scichart@5.2.69?structure=flat

### Load the chart library off the critical path
- Verdict: corrected
- Correction:
  - (1) Sizes for 5.2.69:
    - `index.min.js` is 2,151,691 bytes raw, about 454 KB with gzip -9.
    - `index.min.mjs` is 2,266,401 bytes.
    - `scichart2d.wasm` is 1.28 MB raw, about 659 KB with gzip.

    "About 1.9 MB" is the sdk-5.0 figure.
  - (2) Add the tree-shaking fact: the v5 package.json has `main: index.js` (CommonJS) and no `module`, `exports` or `sideEffects`. Bundlers cannot drop unused parts. 6.0 alpha adds `esm/` and an `exports` map (15-gaps-round-1.md:708-718).
  - Verified parts:
    - The preload advice. SciChart fetches the wasm with `fetch(url, { credentials: "same-origin" })` and `WebAssembly.instantiateStreaming`, so `<link rel="preload" as="fetch" crossorigin href=…scichart2d.wasm>` (CORS mode, same-origin credentials) matches.
    - `preloadWasm` exists only in 6.0 alpha builds (alpha.196 and alpha.197). Its doc says later surfaces pay "the cheap per-instance instantiation cost (typically <10ms)".
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/package.json ; https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.197/package.json ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/index.min.js ; https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.197/types/Charting/Visuals/preloadWasm.d.ts

### Size the chart container with CSS before creating the surface
- Verdict: verified
- Note:
  - The `widthAspect`/`heightAspect` d.ts says "if height of the div is not provided it will use width/height aspect ratio to calculate the height. The default ratio is 3/2".
  - `DEFAULT_WIDTH` is 900 and `DEFAULT_HEIGHT` is 600.
  - Manual-render docs: "The canvas is cleared and requires a full redraw whenever it is resized".
  - The CLS claim is an inference.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurfaceBase.d.ts (lines 77-91) ; https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/manual-render/

### Consider disabling DPI scaling on large charts for low-end GPUs
- Verdict: verified
- Note:
  - Docs: "starting from v2, every element is now rendered at the native resolution and scaled down" and "1,000 x 1,000 … rendered at 2,000 x 2,000 (4M Pixels)".
  - `DpiHelper.IsDpiScaleEnabled = true` by default (`Charting/Visuals/TextureManager/DpiHelper.js:137`).
  - `AntiAliasWebGlBackbuffer = false` (SciChartSurfaceBase.js:760).
  - The browser-zoom and accessibility effect is an inference. The docs do not describe the visual effect.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/miscellaneous-apis/retina-support-and-browser-zoom/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/TextureManager/DpiHelper.js

### Check which GPU the browser uses before you blame the chart
- Verdict: corrected
- Correction:
  - The Impact line says "dual-GPU laptops default to the slower integrated GPU". The docs say this only for macOS: "When using a browser (Safari or Chrome) on macOS, the operating system by default picks the slower, integrated GPU".
  - SciChart 5.2.69 already asks for the fast GPU. `WebGlHelper` creates its WebGL2 context with `{ powerPreference: "high-performance" }` (in the index.min.js bundle).
  - BCD lists `powerPreference` in Chrome and Firefox as partial, macOS only (10-gpu-webgl.md:106). So:
    - On Intel dual-GPU MacBooks, the browser should already switch to the discrete GPU.
    - All Apple-silicon Macs have one GPU.
    - On Windows, Chrome uses the adapter that the OS assigns to the browser (per-app Graphics settings). The page cannot change it (11-gpu-webgpu.md:44).
  - Keep the advice "read chrome://gpu GL_RENDERER and report the GPU with benchmarks". Change the reason to: on Windows, the OS setting decides.
- Evidence: https://www.scichart.com/documentation/js/v5/2d-charts/performance-tips/performance-tips-and-tricks/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/index.min.js (search `powerPreference:"high-performance"`) ; https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips

### Do not depend on WebGPU yet; v6 alpha gates it to Apple GPUs
- Verdict: corrected
- Correction:
  - The auto gate is broader than "Apple Silicon Macs". `esm/constants/app.js` (alpha.196 and alpha.197) sets `IS_WEB_GPU = isBrowser && (flag === "1" || (isAutoMode && /Mac/i.test(navigator.userAgent)))`. `WebGpuHelper.isAppleGpuAdapter` then requires `vendor` to match `/^apple$/i` or `architecture` to match `/apple|metal/i`.
  - iPhone and iPad UAs contain "like Mac OS X", so iOS/iPadOS Safari 26 with an Apple GPU also passes. So does any browser on an Apple-silicon Mac, including Firefox 145+ on macOS Tahoe per BCD. I did not test this on a device.
  - Two more facts:
    - A `requestDevice` rejection is caught, and SciChart falls back to WebGL.
    - Optional features `float32-filterable` and `texture-compression-bc` are requested when the adapter has them.
  - Latest alpha: 6.0.0-alpha.197 (2026-09-23), with the same logic.
  - Verified parts:
    - The blog says "SciChart.js v6 will auto detect and use WebGPU by default if your browser supports it" and "IS_WEB_GPU = 0" forces WebGL. The source is narrower.
    - 60+ FPS vs ~15-30 FPS.
    - `powerPreference: "high-performance"`.
    - webstatus WebGPU `limited`: Chrome 144, Chrome Android 121, Safari 26, no Firefox entry.
    - The v6 wasm file list: `scichart.wasm`, `scichart-nosimd.wasm`, `scichart-64.wasm`, `scichart-charting3d{,-nosimd,-64}.wasm`.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.197/esm/constants/app.js ; https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.197/esm/Core/WebGpuHelper.js ; https://www.scichart.com/blog/scichart-js-v6-in-alpha-webgpu-incredible-performance-gains-and-more/ ; https://api.webstatus.dev/v1/features/webgpu ; https://data.jsdelivr.com/v1/packages/npm/scichart@6.0.0-alpha.197?structure=flat

### Stay on the latest v5 minor
- Verdict: verified
- Note:
  - Latest stable is 5.2.69 (2026-09-08).
  - Changelog:
    - 5.2.11 (12 May 2026): "Line Rendering Freeze (SCJS-2397)".
    - 5.2.55 (16 Jul 2026): 3-5x FPS for non-uniform heatmaps.
    - Label-cache leak fixes are in 5.0.211 (12 Mar 2026), which is "promoted to 5.1.0" (19 Mar 2026).
- Evidence: https://registry.npmjs.org/scichart ; https://www.scichart.com/changelog/scichart-js/

---

## Cross-file conflicts

1. **12-canvas2d-and-images.md:392 and :409 vs 13-scichart.md:368-370.** File 12 says `useSharedCache` is "default false; keeps labels one minute" and native text is "only Arial by default". Both come from the v4 docs. The shipped source has `useSharedCache = true` since 4.0.828, an LRU of 200 entries with a 200 ms minAge, and the v5 native default font Arimo. 13 is right. 12's verify report already flags this.
2. **19-design-b-task.md:447 vs 13-scichart.md:84.** 19-design-b says `dataEvenlySpacedInX` "defaults to true", which is the d.ts comment. The 5.2.69 constructor sets `isEvenlySpacedProperty = false`, and there is no detection. 13 is right. 19-skill-design.md:18 also notes this error.
3. **15-gaps-round-1.md:134-151 vs 13-scichart.md:214.** 13 says "never pre-downsample in JS" without a scope. 15 shows from source that heatmaps, contours, bubble, error bars, box plot, line segment, stacked series and unsorted non-category X get no resampling. 15's scoped rule should replace 13's. The blog that 13 cites also recommends client-side LTTB and min-max.
4. **10-gpu-webgl.md:97 and 11-gpu-webgpu.md:32 vs SciChart behavior.** Files 10 and 11 advise `powerPreference` "default" or "low-power" for chart UIs. SciChart v5 hard-codes `"high-performance"` for its WebGL2 context, and v6 alpha hard-codes it for its WebGPU adapter. I found no public option to change this. So SciChart charts get the discrete GPU on dual-GPU Macs, which costs battery. This is not a factual conflict, but the skill should say the general rule does not apply to SciChart internals.
5. **15-gaps-round-1.md:660-670 vs 13-scichart.md:339-349.** 13 recommends `createSingle()` for "a few very heavy charts". 15 shows (confirmed here in the bundle) that the `createSingle` canvas registers `webglcontextlost` with `console.warn("WebGL context lost. Reloading the page.")` and `location.reload()`. 13's item should carry this caveat.
6. **15-gaps-round-1.md:708-718 vs 13-scichart.md:806 and :809.** 13 lists "tree-shaking not documented" and "worker rendering not covered" as open questions. 15 answers both from source: no tree-shaking in v5 (CommonJS, no `sideEffects`), and no OffscreenCanvas path.
7. **11-gpu-webgpu.md:1165.** File 11 says the SciChart WebGPU details are "unverified (403)". 13 and this report confirm them from the alpha source and the blog, including the Apple-GPU auto gate.
8. **07-js-web-apis.md:900 and 09-v8-consolidated.md:2356 vs the SciChart Memory64 blog.** Files 07 and 09 say Memory64 ships in Chrome 133 and Firefox 134, consistent with 13. SciChart's blog says "Firefox >= 143", which is wrong against BCD and webstatus. 13 already flags this.

## Missing but important

1. **`createSingle()` reloads the whole page on WebGL context loss.** The 5.2.69 bundle does `console.warn("WebGL context lost. Reloading the page."), e.preventDefault(), location.reload()`. The shared `create()` context restores itself. For a trading terminal, this is a reason to avoid `createSingle`, and file 13 does not mention it. Sources: https://cdn.jsdelivr.net/npm/scichart@5.2.69/index.min.js ; 15-gaps-round-1.md:660-670.
2. **Serve the wasm as `application/wasm`, compressed, at a stable URL with revalidation.**
   - SciChart uses `WebAssembly.instantiateStreaming`. On failure it logs "wasm streaming compile failed … falling back to ArrayBuffer instantiation" and loses streaming compile.
   - V8 caches compiled wasm code only for `compileStreaming`/`instantiateStreaming` and for modules of 128 kB or more. The cache is tied to the URL: "changing the URL … creates a new entry", and a `200 OK` "invalidates the code cache" while a `304` keeps it.
   - The wasm drops from 1.28 MB to about 0.66 MB with gzip.

   Sources: https://v8.dev/blog/wasm-code-caching ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/index.min.js
3. **v5 cannot be tree-shaken.** The package is CommonJS with `main: index.js` and no `module`, `exports` or `sideEffects`. v6 alpha adds an `esm/` build and an `exports` map. The practical lever in v5 is dynamic `import()` per route. Sources: https://cdn.jsdelivr.net/npm/scichart@5.2.69/package.json ; https://cdn.jsdelivr.net/npm/scichart@6.0.0-alpha.197/package.json
4. **Hidden streaming series still get resampled.** `isVisible = false` skips only the draw. Detach long-hidden streaming series, or stop appending to them. Hidden sub-charts are skipped entirely, because `resolveSurfaceOrders` filters on `s.isVisible`. Sources: 15-gaps-round-1.md:672-682 ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartSurface.js (lines 1471-1487)
5. **Do not benchmark SciChart wasm with DevTools, MCP or a debugger attached.** Wasm is tiered down to debug code. Measure in a clean window. Sources: 15-gaps-round-1.md:81-93 ; 09-v8-consolidated.md:2170.
6. **The cost of `EAutoRange.Always` on streaming Y axes.** A windowed min/max runs over the visible slice after each data change. It is a binary search plus a Wasm MinMax only when the data is sorted. Drive X with an explicit window. Sources: 15-gaps-round-1.md:684-694 ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.js (`getWindowedYRange`).
7. **The per-frame cost of point markers.** Do not animate marker style every frame. Use `lastPointOnly` for "current value" dots. Source: 15-gaps-round-1.md:696-706.
8. **Keep raw epoch timestamps as float64 in the DataSeries.** Do not pre-offset them. This matters for nanosecond and ms-epoch X precision; changelog 5.0.170 improved high-precision date formatting. Sources: 15-gaps-round-1.md:720 ; https://www.scichart.com/changelog/scichart-js/
9. **SVG-annotation creation cost is a one-time spike.** 300 ms on the first frame for 1000 SVG annotations, then about 10 ms per frame when zooming (changelog 3.5.711). For drawing tools that create many SVG annotations at once, create them over several frames, or use render-context annotations. Source: https://www.scichart.com/changelog/scichart-js/
10. **Chart rendering in a worker is not supported in v5 or v6 alpha.** No file uses `OffscreenCanvas` or `transferControlToOffscreen`. Only data decoding moves to a worker, as in the v6 F1 demo. State this as a fact, not an open question. Sources: 15-gaps-round-1.md:708-718 ; https://www.scichart.com/blog/scichart-js-v6-in-alpha-webgpu-incredible-performance-gains-and-more/
