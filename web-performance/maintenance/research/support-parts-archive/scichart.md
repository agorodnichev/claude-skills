# Support keys and library facts used by references/scichart.md

Checked: 2026-09-23. Sources: the npm registry document for `scichart` (`raw/verify/13/npm-scichart.json`); the scichart 5.2.69 package typings and source saved by the fact-check (`raw/verify/13/s5/`, `raw/verify/13/bin/index.d.ts`, `raw/verify/13/bin/index.min.js`) and the 6.0.0-alpha.196 and 6.0.0-alpha.197 files (`raw/verify/13/s6/`); the fact-check reports `verify/13-scichart.verify.md`, `verify/10-gpu-webgl.verify.md` and `verify/12-canvas2d-and-images.verify.md`; api.webstatus.dev JSON saved on 2026-09-23 (`raw/verify/13/ws-*.json`). Target: Chromium only (Chrome and Edge).

Rule of this part: the installed typings win over the docs. Every SC rule names only APIs that are in the 5.2.69 typings or in the 5.2.69 source that the fact-check read; the version that a project has installed wins over this record (scichart.md §0).

## Rows for references/support.md §A (feature table)

| Key | What it covers | Chrome / Edge | Baseline | Fallback in code | Rules | Checked | Source |
|---|---|---|---|---|---|---|---|
| `webgpu` | WebGPU core (same key as the gpu-webgl-webgpu part: merge the Rules column, do not add a second row) | Chrome and Edge 113 on Windows, macOS and ChromeOS; Chrome Android 121; Linux from 144. webstatus lists chrome 144, chrome_android 121, edge 144 (the Linux convention) | limited (Safari 26; no Firefox entry on webstatus) | the chart library's stable WebGL2 backend | SC-40 | 2026-09-23 | https://api.webstatus.dev/v1/features/webgpu |
| `wasm-memory64` | WebAssembly Memory64 (64-bit linear memory), used by the opt-in 64-bit build of the chart library's next major version | Chrome 133 (2025-02-04), Chrome Android 133, Edge 133 (2025-02-06) | limited (Firefox 134; Safari Technology Preview only per BCD 8.1.2) | the 32-bit wasm build, which is the library default (`EUseWasm64.Never`) | SC-33 (one-line rule; named in its text) | 2026-09-23 | https://api.webstatus.dev/v1/features/wasm-memory64 |

Features that scichart.md tags `baseline` and that need no row: IntersectionObserver (SC-18; web-features `intersection-observer`, widely available, high date 2021-09-25, Chrome 58); WebAssembly SIMD (SC-36; `wasm-simd`, widely available, low date 2023-03-27, high date 2025-09-27, Chrome 91); dynamic `import()` (SC-35; widely available); WebGL2, which the stable library major requires (widely available, high date 2024-03-20, per verify/13).

## Facts for references/support.md §C (engine and tool facts)

- WebGL live-context cap (SC-16, SC-40): Chromium allows 16 active WebGL contexts on desktop, 8 on Android and 4 per worker; WebKit 16; Firefox 300 per principal and 1000 in total (verify/10 and verify/13, from engine source). Past the cap the oldest context is lost. The gpu-webgl-webgpu part records the same fact: keep one copy.
- No software WebGL fallback on Chrome desktop (SC-48): from milestone 139, `getContext('webgl2')` returns `null` where Chrome used SwiftShader before (chromestatus 5166674414927872); Windows keeps a software path only for devices with no GPU or a blocklisted GPU (15-gaps-round-2, unchecked; the milestone is confirmed by verify/10). The gpu-webgl-webgpu part records the same fact.
- V8 wasm code cache (SC-36): V8 caches compiled wasm only for `compileStreaming`/`instantiateStreaming` and for modules of 128 kB or more; the cache is tied to the URL, a `200 OK` replaces it and a `304` keeps it (https://v8.dev/blog/wasm-code-caching; verify/13, Missing 2).
- Debugger attachment (scichart.md §J): chrome-devtools-mcp 1.10.1 keeps the DevTools Debugger domain enabled for each page, and V8 tiers wasm down to debug code while a debugger is enabled; effect size not measured (15-gaps-round-1, source reading, unchecked).

## Facts for references/support.md §D (library versions and conflicts)

- Print the installed version: `node -p "require('./node_modules/scichart/package.json').version"`.
- npm dist-tags on 2026-09-23: `latest` 5.2.69 (published 2026-09-08); `alpha` 6.0.0-alpha.197 (published 2026-09-23; alpha.196 was published 2026-09-22 and differs only by one debug log line in `WebGpuHelper.js`); `beta` 5.2.0-beta.6 (older than latest). The SC rules were checked against 5.2.69 on 2026-09-23.
- Stable major 5 is WebGL2 only (breaking-changes page v4 to v5). The next major, 6, is in alpha: WebGPU backend, opt-in Memory64 (`SciChartDefaults.useWasm64 = EUseWasm64.Auto`, default `Never`, file `scichart-64.wasm`), `preloadWasm()`, an `esm/` build with an `exports` map (still no `sideEffects: false`), and new wasm file names (`scichart.wasm`, `scichart-nosimd.wasm`, `scichart-64.wasm`, `scichart-charting3d.wasm`, `scichart-charting3d-nosimd.wasm`, `scichart-charting3d-64.wasm`).
- 6.0.0-alpha.196 and .197 WebGPU auto mode (SC-40): `esm/constants/app.js` sets `IS_WEB_GPU` when the `IS_WEB_GPU` localStorage flag is `"1"`, or in auto mode when the user agent matches `/Mac/i`; `WebGpuHelper.isAppleGpuAdapter` then requires an adapter `vendor` of `apple` or an `architecture` that matches `apple|metal`. iPhone and iPad user agents also match. A `requestDevice` rejection falls back to WebGL. The adapter is requested with `powerPreference: "high-performance"`; optional features `float32-filterable` and `texture-compression-bc` are requested when present. The flag value `"0"` forces WebGL.
- 5.2.69 also requests `powerPreference: "high-performance"` for its WebGL2 context (in `index.min.js`), with no public option to change it (SC-39).
- `createSingle()` page limit (SC-16): the typings say "there is a limit (16)". `createSingle()` registers a `webglcontextlost` listener that logs "WebGL context lost. Reloading the page." and calls `location.reload()`; the shared `create()` context restores itself (source reading of 5.2.69, confirmed by verify/13, Missing 1; re-check after each upgrade).
- Wasm heap ceiling (SC-33): 4 GB in major 5 (changelog 5.0.170, "Increased max WASM memory from 2GB to 4GB"); Memory64 raises it to 16 GB at about 10% lower speed in the vendor's test (vendor blog, 2026-07-23, updated 2026-08-04).
- 5.2.69 sizes (SC-35, SC-36): `index.min.js` 2,151,691 bytes raw, about 454 KB with gzip -9; `index.min.mjs` 2,266,401 bytes; `scichart2d.wasm` 1,278,913 bytes raw, about 659 KB with gzip -9. `package.json` has `main: index.js` (CommonJS) and no `module`, `exports` or `sideEffects` field.
- Release history that the rules rely on: appendRange boost of 50–100% in 3.1.3333 (2023-04-25); FIFO series from 3.2.446 (2023-07-28); `createSuspended` and `PerformanceDebugHelper` from 3.3.567 (2024-02-12); a workaround for a Chrome slowdown under very fast invalidation in 3.4.672 (2024-09-27, SC-01); spline and render-data-transform FIFO support claimed in 3.5.687 (2024-10-11); `freezeWhenOutOfView` from 3.5.727 (2025-02-17); SVG annotation first-frame cost of 300 ms for 1,000 annotations in 3.5.711 (SC-21); native text and the shared label cache on by default from 4.0.828; `vectorToArrayViewF64` from 4.0.873 (2025-09-25); label-cache leak fixes in 5.0.211, promoted to 5.1.0 (2026-03-19); a line-rendering freeze fixed in 5.2.11 (2026-05-12); non-uniform heatmap caching (3–5× FPS) in 5.2.55 (2026-07-16) (SC-41).

Doc-versus-source conflicts (the shipped 5.2.69 source wins unless the row says otherwise):

| Topic | Docs, blog or typings comment | Shipped source | Rules |
|---|---|---|---|
| `SciChartDefaults.useSharedCache` default | performance-tips page: "not enabled by default"; `LabelProviderBase2D.useSharedCache` typings comment: "Currently default false" | `true` from 4.0.828 through 5.2.69 (`false` in 3.5.x) | SC-20 |
| `useNativeText` and `useSharedCache` | a vendor blog post (2025-02): not on by default | both `true` from 4.0.828 | SC-20 |
| `dataEvenlySpacedInX` | resampling docs: detected automatically; typings comment: "defaults to true" | constructor default `false`, and no detection | SC-03 |
| FIFO with spline series | changelog 3.5.687: spline and render-data-transform series support FIFO | 5.2.69 typings: spline and stacked series do not support FIFO | SC-02 |
| Default native font | native-text page: only Arial is bundled | major 5 default is Arimo (`nativeFontFamily` "default"); the canvas-text fallback is Arial | SC-20 |
| Render event name | render-events page prose: `renderedToWebGL` | `renderedToWebGl` (typings and the page's own code sample) | SC-14 |
| WebGPU auto mode in major 6 | vendor blog (2026-07-02, updated 2026-07-16): WebGPU wherever the browser supports it | alpha.196 and .197: WebGPU only for a `/Mac/` user agent with an Apple GPU adapter | SC-40 |
| `MemoryUsageHelper` switch | docs: off when `NODE_ENV` is "prod" or "production" | off only for "production"; if `process.env` is not defined, the check throws, is logged, and debug stays off | SC-32 |
| Engine processing buffers | memory docs: "theoretical maximum = 8 x wasmBufferSizesKb" | `SciChartDefaults.js` comment: 10 buffers, up to 80 MB; the buffers grow with use | SC-16, SC-34 |
| Memory64 in Firefox | vendor Memory64 blog: Firefox 143 or later | BCD 8.1.2, webstatus and the alpha typings: Firefox 134 | SC-33 |
| `useWasmFromCDN()` | research notes: "can error in React" | typings: deprecated because the `use` prefix trips the react-hooks lint rule; use `loadWasmFromCDN()` | SC-36 |

Source-only behaviors (no doc states them; re-check after each upgrade): the `createSingle()` reload on context loss; the cached WebGL2 probe in `WebGlHelper` (SC-48; 15-gaps-round-2, unchecked); resampling of hidden streaming series in `SciChartRenderer.prepareSeriesRenderData()` (SC-44; 15-gaps-round-1, unchecked); the value-equality check in the `visibleRange` setter (SC-42; 15-gaps-round-2, unchecked); point-marker texture rebuilds on style changes (SC-46; 15-gaps-round-1, unchecked); no `OffscreenCanvas` or worker rendering path in 5.2.69 or 6.0.0-alpha.197 (SC-02).

## Rows for references/support.md §G (disputed and watch list)

- The WebGPU backend of the chart library's next major version: the auto-mode gate changed between the blog and the alpha source; re-check it in each new alpha (SC-40).
- The `esm/` build and `exports` map of the next major version: re-check whether it allows tree-shaking when it ships (SC-35).
- Memory64 in the chart library: opt-in and experimental in the alpha (SC-33).
