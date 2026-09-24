# WebGPU efficiency and what changes compared with WebGL

Scope: rules that change how Claude writes WebGPU code (JS/TS + WGSL) for fast, smooth, memory-safe rendering and GPU compute, with a focus on 2D chart workloads (line/candle/scatter series, many panes, streaming data). Each rule also says what is different from WebGL.
Sources: the full toji.dev WebGPU best-practices series (10 articles), webgpufundamentals.org (optimization, timing, uniforms, storage buffers, memory layout, vertex buffers, textures, loading images, copying data, compute shaders + histogram parts 1-2, bind group layouts, immediates, constants, limits/features, compatibility mode, multisampling, transparency, points, resizing, multiple canvases, debugging, WGSL, from-WebGL), every "What's New in WebGPU" post from Chrome 113 to Chrome 153-154 (Sept 15 2026), Chrome docs (overview, from-WebGL, troubleshooting), the gpuweb spec (Editor's Draft 21 Sept 2026), explainer and error-handling design doc, the WGSL spec, MDN pages + MDN browser-compat-data (BCD 8.1.2, 2026-09-23), webstatus.dev, the gpuweb Implementation-Status wiki, Mozilla gfx blog, WebKit blog, web.dev.
Status line convention: versions are "first shipped" per BCD/webstatus unless noted. BCD records Chrome desktop as 144 because Linux arrived then; Windows/macOS/ChromeOS have had WebGPU since Chrome 113.

---

## A. Device and adapter setup

### Feature-detect WebGPU, then fall back to WebGL, never assume it
- Layer: js
- Stage: startup, script-run
- Metrics: startup, FPS/smoothness
- When: load
- Impact: high, because WebGPU is still "Limited availability" (not Baseline) and a null adapter is normal on many devices.
- Do: Check `'gpu' in navigator`, then `await navigator.gpu.requestAdapter()`, and treat `null` as "use the WebGL path". Also reject software adapters (`adapter.info.isFallbackAdapter`) for heavy chart work. Keep one renderer interface with two back ends.
- Why: `navigator.gpu` is absent on insecure contexts and unsupported browsers; `requestAdapter()` returns `null` when the GPU is blocklisted, hardware acceleration is off, or the GPU process crashed repeatedly. A fallback adapter can be much slower than WebGL on real hardware.
- Example:
  ```ts
  async function pickBackend(): Promise<'webgpu' | 'webgl'> {
    if (!('gpu' in navigator)) return 'webgl';
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter || adapter.info?.isFallbackAdapter) return 'webgl';
    return 'webgpu';
  }
  ```
- Avoid/caveats: Do not tell users to restart the browser only because there is no adapter; that is a normal "unsupported" state (toji). Firefox Android, Firefox Linux and Intel Macs in Firefox still have no WebGPU by default.
- Status: Limited availability (webstatus.dev, 2026-09): Chrome/Edge (Windows, macOS, ChromeOS since 113; Linux Intel Gen12+ since 144; Linux NVIDIA Wayland since 147; Android 12+ since 121), Safari 26 (macOS, iOS, iPadOS, visionOS), Firefox 141 Windows, 145/147 Apple-silicon macOS only. `isFallbackAdapter` on `GPUAdapterInfo`: Chrome 136, Safari 26.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API ; https://api.webstatus.dev/v1/features/webgpu ; https://github.com/gpuweb/gpuweb/wiki/Implementation-Status ; https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips ; https://developer.chrome.com/blog/new-in-webgpu-136 ; https://toji.dev/webgpu-best-practices/device-loss

### Choose `powerPreference` on purpose, and prefer "low-power" or no hint for chart UIs
- Layer: js
- Stage: startup
- Metrics: FPS/smoothness, memory (battery), startup
- When: load, long-lived session
- Impact: medium, because it selects the integrated vs discrete GPU on dual-GPU laptops and affects forced device loss.
- Do: Leave `powerPreference` unset or use `'low-power'` for charts with simple geometry. Use `'high-performance'` only when profiling proves the integrated GPU is the bottleneck, and then handle device loss.
- Why: The spec says `'low-power'` fits content that draws simple geometry or small canvases and can greatly improve battery life; with `'high-performance'`, user agents are more likely to force device loss to switch to a lower-power adapter. Chrome on dual-GPU macOS returns the discrete GPU on AC power when no hint is given.
- Example:
  ```ts
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
  ```
- Avoid/caveats: On Windows, Chrome always uses the same adapter as the rest of Chrome, so `powerPreference` has no effect there (Chrome troubleshooting doc). WebGL and WebGPU can pick different GPUs by default, which invalidates A/B benchmarks unless both set the same hint (toji).
- Status: Core API in all WebGPU browsers. The AC-power default is Chrome-only (dual-GPU macOS, Chrome 115).
- Sources: https://gpuweb.github.io/gpuweb/#dom-gpurequestadapteroptions-powerpreference ; https://developer.chrome.com/blog/new-in-webgpu-115 ; https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips ; https://toji.dev/webgpu-best-practices/webgl-performance-comparison

### Request only the limits and features you use, after checking the adapter
- Layer: js
- Stage: startup
- Metrics: startup, FPS/smoothness (portability)
- When: load
- Impact: medium, because a device silently gets the minimum default limits and no optional features.
- Do: Read `adapter.limits` and `adapter.features`, decide what the app truly needs, and pass only those as `requiredLimits` and `requiredFeatures`. Keep optional paths for missing features (for example, `shader-f16`, `timestamp-query`, `subgroups`).
- Why: `requestDevice()` without arguments returns the spec default limits (for example, 128 MiB `maxStorageBufferBindingSize`, 256 MiB `maxBufferSize`, 64 KiB `maxUniformBufferBindingSize`, 4 bind groups). Requesting "everything the adapter has" lets code exceed the defaults on a desktop and then fail on phones.
- Example:
  ```ts
  const features: GPUFeatureName[] = [];
  if (adapter.features.has('timestamp-query')) features.push('timestamp-query');
  if (adapter.features.has('shader-f16')) features.push('shader-f16');
  const needBytes = 512 * 1024 * 1024; // only if a single series buffer truly needs it
  const device = await adapter.requestDevice({
    requiredFeatures: features,
    requiredLimits: adapter.limits.maxBufferSize >= needBytes ? { maxBufferSize: needBytes } : {},
  });
  ```
- Avoid/caveats: A request above the adapter limit rejects the promise. Unknown limit names may be passed with `undefined` since Chrome 133.
- Status: Core API. Default limit values from the spec limits table (Editor's Draft 2026-09-21).
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-limits-and-features.html ; https://gpuweb.github.io/gpuweb/#limits ; https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu ; https://developer.chrome.com/blog/new-in-webgpu-133

### Consider compatibility mode to reach older GPUs, and code within its limits
- Layer: js, gpu
- Stage: startup
- Metrics: startup (reach), FPS/smoothness
- When: load
- Impact: medium, because it lets WebGPU run on OpenGL ES 3.1 devices instead of falling back to WebGL.
- Do: Request `requestAdapter({ featureLevel: 'compatibility' })` if you can live within its limits, and enable `'core-features-and-limits'` when the adapter offers it. In compatibility mode, avoid storage buffers in the vertex stage (read series data as vertex attributes), keep uniform bindings ≤ 16 KiB, textures ≤ 4096 px, and fix one texture view dimension per texture (`textureBindingViewDimension`).
- Why: Compatibility-mode defaults are stricter: `maxStorageBuffersInVertexStage` 0, `maxUniformBufferBindingSize` 16384, `maxTextureDimension2D` 4096, `maxColorAttachments` 4. webgpufundamentals notes about 45% of target old devices lack vertex-stage storage buffers. An app that follows the compat rules is also a valid core app.
- Example:
  ```ts
  const adapter = await navigator.gpu.requestAdapter({ featureLevel: 'compatibility' });
  const core = adapter?.features.has('core-features-and-limits');
  const device = await adapter!.requestDevice({ requiredFeatures: core ? ['core-features-and-limits'] : [] });
  const canPullVerticesFromStorage = device.limits.maxStorageBuffersInVertexStage > 0;
  ```
- Avoid/caveats: Vertex pulling from storage buffers (a common chart trick) fails in compatibility mode; keep a vertex-buffer path. Mipmap generation code that views array layers as '2d' breaks in compat mode.
- Status: Chrome 146 (Android 10+ with OpenGL ES 3.1); not in Firefox or Safari (BCD marks the option experimental). Browsers that do not support it treat the request as core.
- Sources: https://developer.chrome.com/blog/new-in-webgpu-146 ; https://webgpufundamentals.org/webgpu/lessons/webgpu-compatibility-mode.html ; https://gpuweb.github.io/gpuweb/#limits ; https://developer.chrome.com/blog/new-in-webgpu-136

### Handle `device.lost`: get a new adapter, recreate GPU objects, keep app state in JS
- Layer: js
- Stage: main-thread-task, gpu-upload
- Metrics: FPS/smoothness (frozen/black canvas), long-lived reliability
- When: long-lived session
- Impact: high for a trading terminal, because a lost device leaves a frozen or black chart with no error.
- Do: Attach `device.lost.then(...)` right after creation (do not `await` it). On loss with `reason !== 'destroyed'`, call `requestAdapter()` again (never reuse an adapter), `requestDevice()`, `context.configure()` with the new device, and re-upload series from JS-side state. Test with `device.destroy()` and Chrome `about:gpucrash`.
- Why: All buffers, textures and pipelines die with the device. Adapters are "consumed" by `requestDevice()`; since Chrome 140 a second request on the same adapter rejects. Unlike WebGL, the canvas context is independent of the device, so you can reconfigure the same canvas.
- Example:
  ```ts
  function watchLoss(device: GPUDevice) {
    device.lost.then(async (info) => {
      if (info.reason === 'destroyed') return;
      const next = await initGpu();          // new adapter + device
      if (!next) return switchToWebGL();
      context.configure({ device: next, format: navigator.gpu.getPreferredCanvasFormat() });
      rebuildGpuResources(next, seriesStore); // seriesStore lives in JS
    });
  }
  ```
- Avoid/caveats: After repeated GPU-process crashes, Chrome blocks new adapters for the page (2 crashes in 2 min) or for all pages (3 in 2 min). Long shaders (~10 s watchdog in Chrome) also cause loss. `destroy()`-based tests unmap buffers, unlike real loss.
- Status: Core API in all WebGPU browsers. "Adapter consumed" rejection: Chrome 140.
- Sources: https://toji.dev/webgpu-best-practices/device-loss ; https://developer.chrome.com/blog/new-in-webgpu-140 ; https://gpuweb.github.io/gpuweb/explainer/#canvas-output

### Use one `GPUDevice` for all chart panes and canvases
- Layer: js, canvas2d
- Stage: gpu-draw, composite, gc-memory
- Metrics: memory, FPS/smoothness, startup
- When: long-lived session
- Impact: high for multi-pane dashboards, because WebGL caps live contexts per page and duplicates resources per context.
- Do: Create one adapter/device per page (or per worker) and call `canvas.getContext('webgpu').configure({ device, ... })` on each pane canvas. Encode all panes into one command encoder and one `submit()` per frame. Skip panes that are off-screen with `IntersectionObserver`.
- Why: A WebGPU device can render to any number of canvases; WebGL creates one context per canvas and Chrome and Safari allow only about 16 live WebGL canvases (Chrome docs). Shared pipelines, glyph atlases and bind group layouts are created once.
- Example:
  ```ts
  const visible = new Set<Element>();
  const io = new IntersectionObserver((es) => es.forEach(e => e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)));
  panes.forEach(p => { p.ctx.configure({ device, format, alphaMode: 'opaque' }); io.observe(p.canvas); });
  function frame() {
    const enc = device.createCommandEncoder();
    for (const p of panes) if (visible.has(p.canvas) && p.dirty) encodePane(enc, p);
    device.queue.submit([enc.finish()]);
    requestAnimationFrame(frame);
  }
  ```
- Avoid/caveats: Many small canvases still cost compositing; one big canvas with viewports/scissors can be cheaper for dense grids (inference, not measured in sources).
- Status: Core API.
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-multiple-canvases.html ; https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu ; https://gpuweb.github.io/gpuweb/explainer/#canvas-output

### Run WebGPU rendering in a worker with OffscreenCanvas when the main thread is busy
- Layer: js
- Stage: main-thread-task, script-run
- Metrics: INP, TBT, FPS/smoothness
- When: animation/render-loop, interaction
- Impact: medium, because command encoding is JS work that competes with input handling.
- Do: `canvas.transferControlToOffscreen()`, post it to a dedicated worker, and call `getContext('webgpu')` there. Keep the device, uploads and encoding in the worker; send only compact data (transferable `ArrayBuffer`s) from the main thread.
- Why: `navigator.gpu` is exposed on `WorkerNavigator`, and `OffscreenCanvas.getContext('webgpu')` is supported, so all per-frame encoding can leave the main thread.
- Example:
  ```ts
  // main
  const off = canvas.transferControlToOffscreen();
  worker.postMessage({ canvas: off }, [off]);
  // worker
  onmessage = async ({ data }) => {
    const ctx = data.canvas.getContext('webgpu');
    const device = await (await navigator.gpu.requestAdapter())!.requestDevice();
    ctx.configure({ device, format: navigator.gpu.getPreferredCanvasFormat() });
  };
  ```
- Avoid/caveats: `uncapturederror` fires only on the Window event loop per the design doc; use error scopes in workers. Resizing must be forwarded from the main thread. Experimental `mapSync()` exists only in workers behind a Chrome flag.
- Status: `WorkerNavigator.gpu` and `OffscreenCanvas` webgpu context: Chrome 113+/Android 121, Safari 26, Firefox 141 (partial). Service/shared workers: Chrome 124.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API ; https://bcd.developer.mozilla.org/bcd/api/v0/current/api.OffscreenCanvas.json ; https://github.com/gpuweb/gpuweb/blob/main/design/ErrorHandling.md ; https://developer.chrome.com/blog/new-in-webgpu-145

---

## B. Pipelines and shader modules

### Create pipelines with `createRenderPipelineAsync` / `createComputePipelineAsync` before the first frame
- Layer: js, gpu
- Stage: startup, main-thread-task, gpu-draw
- Metrics: startup, FPS/smoothness (first-use hitch), INP
- When: load
- Impact: high, because synchronous pipeline creation can stall the GPU queue at first use.
- Do: Create every pipeline a chart can need (line, area, candle, scatter, text, per format and sample count) with the async variants during load or idle time. Cache the promise by a key so each variant compiles once. Draw a series only when its pipeline has resolved.
- Why: The spec notes that sync creation returns a handle at once but the real compile can stall the device timeline at creation, first `setPipeline()`, `finish()` or `submit()`; the async method is "preferred whenever possible" because it does not block queue work. WebGL has no equivalent: `linkProgram` stalls are hidden in the first draw.
- Example:
  ```ts
  // Before
  const linePipe = device.createRenderPipeline(lineDesc);          // may hitch the first frame
  // After
  const pipes = new Map<string, Promise<GPURenderPipeline>>();
  const pipeline = (key: string, desc: () => GPURenderPipelineDescriptor) =>
    pipes.get(key) ?? pipes.set(key, device.createRenderPipelineAsync(desc())).get(key)!;
  await Promise.all([pipeline('line', lineDesc), pipeline('candle', candleDesc)]);
  ```
- Avoid/caveats: The async promise rejects with `GPUPipelineError` instead of firing an uncaptured error; catch it. Errors from async creation are silenced after device loss (Chrome 117).
- Status: Core API in all WebGPU browsers.
- Sources: https://gpuweb.github.io/gpuweb/#dom-gpudevice-createrenderpipelineasync ; https://gpuweb.github.io/gpuweb/#pipeline-creation ; https://developer.chrome.com/blog/new-in-webgpu-117 ; https://webgpufundamentals.org/webgpu/lessons/webgpu-from-webgl.html

### Reuse shader modules and pipelines; never create them per frame or per series
- Layer: js
- Stage: script-run, gpu-draw, gc-memory
- Metrics: FPS/smoothness, memory, startup
- When: animation/render-loop, long-lived session
- Impact: high, because pipeline creation involves WGSL translation and a driver compile.
- Do: Key pipelines by the state that really differs (topology, blend, target format, sample count, vertex layout). Share one pipeline across all series of the same type; put per-series differences (color, width, offsets) in uniforms, storage buffers or immediates.
- Why: Chrome states `createRenderPipeline` is slow because shaders may be adjusted per settings. Browsers keep compilation caches per storage partition (spec §2.2.4), which only help if the same WGSL and descriptor are requested again.
- Example:
  ```ts
  const key = `${topology}|${format}|${sampleCount}|${blend ? 1 : 0}`;
  const pipe = await pipeline(key, () => makeSeriesPipeline(topology, format, sampleCount, blend));
  ```
- Avoid/caveats: Generate WGSL deterministically (stable order, no timestamps in source) so the browser cache can hit on the next visit (inference from spec §2.2.4). The first visit per site always pays the compile cost because caches are partitioned.
- Status: Core API.
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-from-webgl.html ; https://gpuweb.github.io/gpuweb/#user-agent-state ; https://developer.chrome.com/blog/new-in-webgpu-117

### Specialize shaders with `override` constants or template strings instead of runtime branches
- Layer: gpu, build
- Stage: script-compile, gpu-draw
- Metrics: FPS/smoothness, startup
- When: load
- Impact: medium, because it removes per-pixel branches and lets one module serve many pipelines.
- Do: Use WGSL `override` constants (scalars, booleans, `@workgroup_size`) set via `constants` in the pipeline descriptor for values fixed per pipeline. When a code path must be removed for sure, build the WGSL string with JS template literals (or a tiny tagged-template preprocessor), because WGSL has no `#define`/`#if`.
- Why: Override constants apply without recreating the shader module, which is cheaper for many variants; whether an override-selected branch is removed is up to the driver, while template-literal specialization guarantees it (toji).
- Example:
  ```wgsl
  override LOG_SCALE: bool = false;
  override WG: u32 = 64;
  fn toY(v: f32) -> f32 { if (LOG_SCALE) { return log2(v); } return v; }
  @compute @workgroup_size(WG) fn main() {}
  ```
  ```ts
  device.createComputePipelineAsync({ layout, compute: { module, constants: { LOG_SCALE: 1, WG: 128 } } });
  ```
- Avoid/caveats: Every distinct override set is a distinct pipeline to compile; do not generate unbounded variants. Overrides cannot be vectors or arrays.
- Status: Core WGSL feature.
- Sources: https://toji.dev/webgpu-best-practices/dynamic-shader-construction ; https://webgpufundamentals.org/webgpu/lessons/webgpu-constants.html

---

## C. Binding resources

### Define explicit bind group layouts; use `layout: 'auto'` only for one-off pipelines
- Layer: js
- Stage: gpu-draw, script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because auto layouts make bind groups pipeline-specific and force redundant `setBindGroup` calls.
- Do: Create `GPUBindGroupLayout`s and a `GPUPipelineLayout` once, and build all compatible pipelines from them. Use `'auto'` only for pipelines with unique resources (a one-off compute pass).
- Why: A bind group made from `pipeline.getBindGroupLayout()` of an auto pipeline works only with that pipeline, so switching pipelines means re-setting identical data. Auto layouts also drop bindings the shader does not statically use, which can break bind groups while debugging.
- Example:
  ```ts
  const frameBGL = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } } ] });
  const seriesBGL = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } } ] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [frameBGL, seriesBGL] });
  // line, area and scatter pipelines all use `layout`
  ```
- Avoid/caveats: With a shared layout, every group in it must be set before a draw, even if a shader ignores it (a `null` entry in `bindGroupLayouts` is allowed since Chrome 135). Resources in a shared group still cost binding work even when a pipeline ignores them.
- Status: Core API.
- Sources: https://toji.dev/webgpu-best-practices/bind-groups ; https://webgpufundamentals.org/webgpu/lessons/webgpu-bind-group-layouts.html ; https://developer.chrome.com/blog/new-in-webgpu-135

### Split bind groups by update frequency and put the least-changing group at index 0
- Layer: js, gpu
- Stage: gpu-draw, script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because each state change in a pass costs CPU validation and driver work.
- Do: Use group 0 for per-frame/per-pass data (viewport, time axis transform), group 1 for per-series or per-material data, group 2 for per-draw data. Sort draws so the outer loop changes group 0 least, and the inner loop changes the highest group.
- Why: The spec note on pipeline layouts says the least frequently changing groups belong at the lowest indices so the user agent can minimize state changes; native APIs prefer that order (toji). Implementations do not reliably skip redundant rebinds.
- Example:
  ```ts
  pass.setBindGroup(0, frameBG);                 // once per pane
  for (const s of seriesByPipeline) {
    pass.setPipeline(s.pipeline);
    pass.setBindGroup(1, s.dataBG);              // per series
    pass.draw(s.vertexCount, s.instanceCount);
  }
  ```
- Avoid/caveats: Default `maxBindGroups` is 4; three groups is the common split. Render bundles reset bind state, so shared groups must be re-set inside each bundle.
- Status: Core API.
- Sources: https://toji.dev/webgpu-best-practices/bind-groups ; https://gpuweb.github.io/gpuweb/#pipeline-layout

### Pack per-draw uniforms into one large buffer with dynamic offsets and one `writeBuffer` per frame
- Layer: js, gpu
- Stage: gpu-upload, script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: high for many series/panes, because thousands of small `writeBuffer` calls and bind groups cost more than one big upload.
- Do: Allocate one uniform buffer with a per-draw stride rounded up to `device.limits.minUniformBufferOffsetAlignment` (256 bytes by default). Fill one `Float32Array` for all draws and call `writeBuffer` once. Either pre-create one bind group per slice, or one bind group with `hasDynamicOffset: true` and pass the offset in `setBindGroup`.
- Why: In webgpufundamentals' optimization series (M1 Mac, 75 Hz), all steps together (split uniforms, one big uniform buffer with offsets, then mapped staging) raised the count from about 8000 to 15000 objects (+87%), and from 9000 to 18000 (2x) with rasterization turned off. Dynamic offsets avoid one bind group per draw, but their range check moves from bind-group creation to each `setBindGroup` call.
- Example:
  ```ts
  const align = device.limits.minUniformBufferOffsetAlignment;
  const stride = Math.ceil(STYLE_BYTES / align) * align;
  const styleBuf = device.createBuffer({ size: stride * MAX_DRAWS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const styleBGL = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: STYLE_BYTES } }] });
  const styleBG = device.createBindGroup({ layout: styleBGL, entries: [{ binding: 0, resource: { buffer: styleBuf, size: STYLE_BYTES } }] });
  const cpu = new Float32Array(stride / 4 * MAX_DRAWS);
  // ...fill cpu for n draws...
  device.queue.writeBuffer(styleBuf, 0, cpu, 0, (stride / 4) * n);
  for (let i = 0; i < n; i++) { pass.setBindGroup(2, styleBG, [i * stride]); pass.draw(counts[i]); }
  ```
- Avoid/caveats: Default limits allow 8 dynamic uniform and 4 dynamic storage buffers per pipeline layout. Dynamic offsets are slightly slower per call than static ones; with only hundreds of calls the difference is negligible (webgpufundamentals). Setting a non-zero `minBindingSize` moves the buffer-size check from each draw to pipeline creation (spec).
- Status: Core API.
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html ; https://webgpufundamentals.org/webgpu/lessons/webgpu-bind-group-layouts.html ; https://gpuweb.github.io/gpuweb/#dom-gpubufferbindinglayout-minbindingsize ; https://gpuweb.github.io/gpuweb/#limits

### Use immediates (`var<immediate>` + `setImmediates`) for tiny per-draw values where supported
- Layer: gpu, js
- Stage: gpu-draw, script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because it removes a buffer write and a bind group change for each draw.
- Do: Feature-detect `navigator.gpu.wgslLanguageFeatures.has('immediate_address_space')`. Put ≤ 64 bytes of per-draw data (series index, style index, a color) in one `var<immediate>` struct, declare `immediateSize` in the explicit pipeline layout, and call `pass.setImmediates(0, data)` before each draw. Index larger per-series data in storage buffers with those values.
- Why: Immediates (push/root constants) pass small data directly in the pass encoder, bypassing buffer creation and bind group management for per-draw values.
- Example:
  ```wgsl
  requires immediate_address_space;
  struct DrawIds { series: u32, style: u32 }
  var<immediate> ids: DrawIds;
  @group(1) @binding(0) var<storage, read> styles: array<vec4f>;
  ```
  ```ts
  const layout = device.createPipelineLayout({ bindGroupLayouts: [frameBGL, dataBGL], immediateSize: 8 });
  pass.setImmediates(0, new Uint32Array([seriesIndex, styleIndex]));
  pass.draw(vertexCount);
  ```
- Avoid/caveats: Only one `var<immediate>` per shader; all immediate bytes must be set before use (uninitialized is a validation error); values reset at a new pass and around `executeBundles`. Keep a uniform-buffer fallback for Safari and Firefox.
- Status: Chrome/Edge 150 (BCD, experimental flag in BCD); not in Firefox or Safari as of 2026-09. Validation failures throw `OperationError` since Chrome 151-152.
- Sources: https://developer.chrome.com/blog/new-in-webgpu-149-150 ; https://webgpufundamentals.org/webgpu/lessons/webgpu-immediates.html ; https://gpuweb.github.io/gpuweb/#dom-gpubindingcommandsmixin-setimmediates ; https://developer.chrome.com/blog/new-in-webgpu-151-152

### Use uniform buffers for small fixed data and storage buffers for large or variable arrays
- Layer: gpu
- Stage: gpu-draw, gpu-upload
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, because the wrong choice either hits the 64 KiB uniform limit or loses uniform-path speed.
- Do: Keep per-frame and per-draw parameters in `var<uniform>`. Put series samples, per-instance candles and lookup tables in `var<storage, read>` runtime-sized arrays, and index them with `instance_index`/`vertex_index`.
- Why: Uniform buffers can be faster for their typical use; storage buffers are much larger (128 MiB default binding vs 64 KiB), support runtime-sized arrays, read-write access and atomics. WebGL has no storage buffers, so WebGPU enables vertex pulling and single-draw instancing of whole series.
- Example:
  ```wgsl
  struct Candle { o: f32, h: f32, l: f32, c: f32 }
  @group(1) @binding(0) var<storage, read> candles: array<Candle>;
  @vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> @builtin(position) vec4f {
    let k = candles[i]; /* expand body/wick quad from v */ return vec4f(0.0);
  }
  ```
- Avoid/caveats: In compatibility mode the vertex stage may have 0 storage buffers; keep a vertex-attribute path. Runtime-sized array access gets bounds clamping in the generated code.
- Status: Core API.
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-buffers.html ; https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu ; https://gpuweb.github.io/gpuweb/#limits

### Lay out host data to WGSL alignment rules; compute offsets with a helper, not by hand
- Layer: js, gpu
- Stage: gpu-upload
- Metrics: memory, FPS/smoothness (correctness bugs)
- When: build, load
- Impact: medium, because misaligned structs silently read wrong data and padding wastes bandwidth.
- Do: Order struct members large-to-small; avoid `vec3f` in arrays (it aligns to 16 bytes); in uniform buffers, remember array elements are 16-byte strided unless `uniform_buffer_standard_layout` is available. Generate offsets with a tool (for example webgpu-utils `makeShaderDataDefinitions`) or a single hand-checked table.
- Why: Every WGSL type has an alignment and size; `vec3<f32>` has 16-byte alignment; uniform address space adds array-stride and nested-struct rules. Tightly packed 12-byte vec3 data read as `array<vec3f>` goes out of step (toji).
- Example:
  ```wgsl
  // Before: 32 bytes per point because vec3f aligns to 16
  struct P { pos: vec3f, value: f32, color: vec3f }
  // After: 32 bytes, no hidden padding, clear layout
  struct P { pos: vec3f, value: f32, color: vec4f }
  // Or pack scalars and rebuild vectors in the shader: array<f32>
  ```
- Avoid/caveats: Since Chrome 133, `@align(n)` must divide the required alignment. `uniform_buffer_standard_layout` removes the 16-byte uniform rules but needs feature detection.
- Status: Core rules. `uniform_buffer_standard_layout`: Chrome 144 (BCD experimental), not Safari/Firefox.
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-memory-layout.html ; https://toji.dev/webgpu-best-practices/compute-vertex-data ; https://developer.chrome.com/blog/new-in-webgpu-144 ; https://developer.chrome.com/blog/new-in-webgpu-133

---

## D. Uploads (CPU to GPU)

### Default to `queue.writeBuffer()` for updates
- Layer: js
- Stage: gpu-upload, script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because it is the simplest path and the browser picks an efficient transfer.
- Do: Use `device.queue.writeBuffer(buffer, byteOffset, typedArray, elemOffset, elemCount)` for most updates, including streaming appends of a slice. Upload only the changed range. Create target buffers with `COPY_DST`.
- Why: toji calls it a safe fallback with few downsides and the preferred path for WASM. Chrome made `writeBuffer`/`writeTexture` up to 2x faster in Chrome 144, and on Vulkan it can write straight into host-visible memory with no extra copy (Chrome 126).
- Example:
  ```ts
  // Append new ticks to a preallocated series buffer
  const bytesPerPoint = 8; // x (f32 relative), y (f32)
  device.queue.writeBuffer(seriesBuf, writeCursor * bytesPerPoint, newPoints /* Float32Array */);
  writeCursor += newPoints.length / 2;
  ```
- Avoid/caveats: `dataOffset` and `size` are in elements for typed arrays but bytes for `ArrayBuffer`; `bufferOffset` and byte size must be multiples of 4 (MDN). The write is ordered before later `submit()`s, so writing a buffer that the GPU is still reading forces the implementation to stage a copy.
- Status: Core API. Speed-ups are Chrome-specific.
- Sources: https://toji.dev/webgpu-best-practices/buffer-uploads ; https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/writeBuffer ; https://developer.chrome.com/blog/new-in-webgpu-144 ; https://developer.chrome.com/blog/new-in-webgpu-126

### Fill static buffers with `mappedAtCreation: true`
- Layer: js
- Stage: gpu-upload, gc-memory
- Metrics: startup, memory
- When: load
- Impact: low, because it saves one CPU-side copy only at creation time.
- Do: For buffers written once (static geometry, glyph quads, LUTs), create with `mappedAtCreation: true`, write straight into `getMappedRange()`, then `unmap()`. No `COPY_DST` usage is needed.
- Why: Generating data directly into the mapped range avoids building a temporary typed array and then copying it.
- Example:
  ```ts
  const buf = device.createBuffer({ size: quad.byteLength, usage: GPUBufferUsage.VERTEX, mappedAtCreation: true });
  new Float32Array(buf.getMappedRange()).set(quad);
  buf.unmap();
  ```
- Avoid/caveats: Size must be a multiple of 4 (Chrome 138 throws `RangeError` otherwise). If data already sits in an `ArrayBuffer`, `writeBuffer` avoids the extra copy. The browser must zero the mapping first.
- Status: Core API.
- Sources: https://toji.dev/webgpu-best-practices/buffer-uploads ; https://gpuweb.github.io/gpuweb/explainer/#buffer-mapping ; https://developer.chrome.com/blog/new-in-webgpu-138 ; https://webgpufundamentals.org/webgpu/lessons/webgpu-copying-data.html

### Use a ring of pre-mapped staging buffers only when uploads are a measured bottleneck
- Layer: js
- Stage: gpu-upload, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, because it saves one copy per frame for large per-frame uploads but adds complexity and memory.
- Do: Keep a pool of `MAP_WRITE | COPY_SRC` buffers. Each frame, take a mapped one (or create one with `mappedAtCreation`), write into it, `unmap()`, encode `copyBufferToBuffer` into the GPU buffer, submit, then call `mapAsync(GPUMapMode.WRITE)` and return it to the pool when the promise resolves.
- Why: `writeBuffer` copies data to the GPU process; mapping lets JS write into shared memory directly. In webgpufundamentals' series, the mapped-staging step was the last of several steps that together gave about 87% more objects at 75 fps; the gain of this step alone was not isolated.
- Example:
  ```ts
  const pool: GPUBuffer[] = [];
  function uploadFrame(enc: GPUCommandEncoder, dst: GPUBuffer, fill: (f: Float32Array) => void, bytes: number) {
    const staging = pool.pop() ?? device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
    fill(new Float32Array(staging.getMappedRange(0, bytes)));
    staging.unmap();
    enc.copyBufferToBuffer(staging, 0, dst, 0, bytes);
    return () => staging.mapAsync(GPUMapMode.WRITE).then(() => pool.push(staging)); // call after submit
  }
  ```
- Avoid/caveats: Mappable buffers cannot be vertex/uniform/storage buffers on the web (Dawn's `BufferMapWriteExtendedUsages` is native-only). The pool typically holds 2-3 buffers; cap it. Do not mix with `writeBuffer` for the same data without reason; toji advises starting with `writeBuffer`.
- Status: Core API.
- Sources: https://toji.dev/webgpu-best-practices/buffer-uploads ; https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html ; https://gpuweb.github.io/gpuweb/explainer/#buffer-mapping ; https://developer.chrome.com/blog/new-in-webgpu-153-154

### Preallocate series buffers with headroom, because WebGPU buffers cannot be resized
- Layer: js
- Stage: gpu-upload, gc-memory
- Metrics: memory, FPS/smoothness
- When: long-lived session
- Impact: medium, because re-creating and re-uploading a whole series on every append causes spikes.
- Do: Allocate capacity for the expected window (for example next power of two). When full, create a larger buffer, copy the old contents on the GPU with `copyBufferToBuffer`, rebuild the bind groups that point at it, and `destroy()` the old buffer. For fixed windows, use a GPU ring buffer and a start offset uniform.
- Why: In WebGPU, buffer and texture size, usage and format are immutable; only contents change. WebGL's `bufferData` reallocation pattern does not exist.
- Example:
  ```ts
  function grow(old: GPUBuffer, usedBytes: number): GPUBuffer {
    const next = device.createBuffer({ size: old.size * 2, usage: old.usage });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(old, 0, next, 0, usedBytes);
    device.queue.submit([enc.finish()]);
    old.destroy();
    return next; // caller rebuilds bind groups that referenced `old`
  }
  ```
- Avoid/caveats: The source needs `COPY_SRC` and the destination `COPY_DST` usage, so add both at creation. Respect `maxBufferSize` (256 MiB default).
- Status: Core API.
- Sources: https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu ; https://webgpufundamentals.org/webgpu/lessons/webgpu-from-webgl.html ; https://webgpufundamentals.org/webgpu/lessons/webgpu-copying-data.html

### Call `destroy()` on buffers and textures you no longer need
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: high for long sessions, because JS garbage collection does not see GPU memory.
- Do: Destroy series buffers when a chart or symbol closes, when you grow a buffer, and for per-frame temporary textures. Destroy MSAA/depth targets on resize before creating new ones.
- Why: A single WebGPU object can hold MBs or GBs in the GPU process without triggering JS memory pressure, so GC may never reclaim it (explainer §3.2.2).
- Example:
  ```ts
  function disposeSeries(s: GpuSeries) { s.vertexBuf.destroy(); s.minMaxBuf.destroy(); s.bindGroup = null; }
  ```
- Avoid/caveats: Using a destroyed object is a validation error at submit time; drop references too.
- Status: Core API.
- Sources: https://gpuweb.github.io/gpuweb/explainer/#early-destruction-of-webgpu-objects

### Shrink vertex data with packed, interleaved and normalized formats
- Layer: gpu, js
- Stage: gpu-upload, gpu-draw
- Metrics: memory, FPS/smoothness
- When: load, animation/render-loop
- Impact: medium, because bandwidth scales with bytes per vertex/instance.
- Do: Interleave attributes of one series into one buffer; use `unorm8x4` for colors, `float16`/`unorm16` 1-component formats where precision allows, and instance-step buffers (`stepMode: 'instance'`) for per-candle or per-point data.
- Why: One buffer means fewer `setVertexBuffer` calls and better memory locality (webgpufundamentals). A color as `unorm8x4` is 4 bytes instead of 16. Chrome 133 added 1-component 8/16-bit vertex formats that halve the fetched data compared with 2-component formats.
- Example:
  ```ts
  buffers: [{ arrayStride: 12, stepMode: 'instance', attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x2' },  // x, y
    { shaderLocation: 1, offset: 8, format: 'unorm8x4' },   // rgba
  ] }]
  ```
- Avoid/caveats: Keep price/time coordinates in `float32` (see precision rule). New 1-component formats and `unorm8x4-bgra` need recent browsers.
- Status: Core formats in all browsers; 1-component formats Chrome 133 (check other browsers before relying on them).
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html ; https://webgpufundamentals.org/webgpu/lessons/webgpu-vertex-buffers.html ; https://developer.chrome.com/blog/new-in-webgpu-133

### Rebase large coordinates to a local origin before upload (no f64 in WGSL)
- Layer: js, gpu
- Stage: gpu-upload, gpu-draw
- Metrics: FPS/smoothness (visual correctness)
- When: load, animation/render-loop
- Impact: medium, because epoch-millisecond timestamps and some prices lose precision in f32 and cause jitter when zoomed.
- Do: Subtract a per-series or per-viewport origin on the CPU (in f64 JS numbers) and upload small offsets as `f32`; pass the origin shift through a uniform. Never use `f16` for time or price.
- Why: WGSL has only `f32` and optional `f16` floating types; f32 keeps about 24 bits of mantissa, so values like 1.7e12 ms cannot represent single milliseconds.
- Example:
  ```ts
  const t0 = series.time[0];                         // JS number (f64)
  for (let i = 0; i < n; i++) xy[2 * i] = series.time[i] - t0; // small f32-safe offsets
  frameUniforms.set([ (viewStart - t0), msPerPx ], 0);
  ```
- Avoid/caveats: Re-base again when the user pans far from the origin.
- Status: Language constraint (WGSL spec).
- Sources: https://gpuweb.github.io/gpuweb/wgsl/#floating-point-types

---

## E. Readback (GPU to CPU)

### Read back with a pool of `MAP_READ` buffers and never `await` the map inside the frame
- Layer: js
- Stage: microtask, main-thread-task, gpu-upload
- Metrics: FPS/smoothness, INP
- When: interaction (hit tests), animation/render-loop (stats)
- Impact: high, because waiting on a map serializes CPU and GPU and adds at least one frame of latency.
- Do: Copy results into a `MAP_READ | COPY_DST` buffer, submit, and call `mapAsync(GPUMapMode.READ, offset, size)` for just the bytes you need. Consume the result when the promise resolves (next frame or later). Check `buffer.mapState === 'unmapped'` before reusing a buffer; keep 2-3 buffers so the loop never waits. Copy out of `getMappedRange()` before `unmap()`.
- Why: Mapping is an ownership transfer; it completes only after all earlier GPU work that uses the buffer. Mapping a smaller range avoids copying more than needed (explainer). WebGL's `readPixels` blocks the calling thread instead.
- Example:
  ```ts
  const readPool: GPUBuffer[] = [];
  function requestReadback(enc: GPUCommandEncoder, src: GPUBuffer, bytes: number, onData: (u: Uint32Array) => void) {
    const rb = readPool.find(b => b.mapState === 'unmapped') ?? device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    enc.copyBufferToBuffer(src, 0, rb, 0, bytes);
    return () => rb.mapAsync(GPUMapMode.READ, 0, bytes).then(() => {  // call after submit
      onData(new Uint32Array(rb.getMappedRange(0, bytes).slice(0)));
      rb.unmap(); if (!readPool.includes(rb)) readPool.push(rb);
    });
  }
  ```
- Avoid/caveats: `mapAsync` offset must be a multiple of 8 and size a multiple of 4. A second `mapAsync` while one is pending rejects. Prefer keeping results on the GPU (indirect draws, compute-to-render) over reading them back. Firefox 141 used an interval timer to detect GPU completion, which added latency to short tasks (Mozilla, fix tracked). Chrome's `mapSync()` in workers is experimental behind a flag (Chrome 145).
- Status: Core API.
- Sources: https://gpuweb.github.io/gpuweb/explainer/#buffer-mapping ; https://developer.mozilla.org/en-US/docs/Web/API/GPUBuffer/mapAsync ; https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html ; https://mozillagfx.wordpress.com/2025/07/15/shipping-webgpu-on-windows-in-firefox-141/ ; https://developer.chrome.com/blog/new-in-webgpu-145

---

## F. Command encoding per frame

### Encode one command buffer per frame, submit once, and keep object creation out of the loop
- Layer: js
- Stage: script-run, main-thread-task, gpu-draw
- Metrics: FPS/smoothness, INP, gc-memory
- When: animation/render-loop
- Impact: high, because every API call crosses into the browser and the GPU process.
- Do: Per frame: one `createCommandEncoder()`, one `getCurrentTexture()` per canvas, passes for all panes, one `queue.submit([...])`. Reuse render pass descriptor objects and only swap the `view`. Create buffers, bind groups, pipelines and samplers at load or on data change, never per frame (except external-texture bind groups). Render only when something changed (dirty flags) instead of every rAF tick.
- Why: WebGPU calls are validated and serialized to the GPU process; a bigger batch per submit lets the driver optimize. Chrome cut JS-to-C++ call cost by 40% for encoder methods in Chrome 114, but call count still dominates CPU time for many small draws.
- Example:
  ```ts
  const passDesc: GPURenderPassDescriptor = { colorAttachments: [{ view: undefined!, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
  function frame() {
    if (dirty) {
      (passDesc.colorAttachments as GPURenderPassColorAttachment[])[0].view = ctx.getCurrentTexture().createView();
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass(passDesc);
      drawAll(pass); pass.end();
      device.queue.submit([enc.finish()]);
      dirty = false;
    }
    requestAnimationFrame(frame);
  }
  ```
- Avoid/caveats: A command buffer can be submitted only once, and duplicates in one `submit()` are a validation error (Chrome 126); reuse work across frames with render bundles instead. Do not hold `getCurrentTexture()` across frames; resize or `configure()` invalidates it.
- Status: Core API.
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html ; https://gpuweb.github.io/gpuweb/explainer/#command-encoding-and-submission ; https://developer.chrome.com/blog/new-in-webgpu-114 ; https://developer.chrome.com/blog/new-in-webgpu-126 ; https://gpuweb.github.io/gpuweb/#gpucommandbuffer

### Draw many similar marks with instancing or one storage-backed draw, not one draw per mark
- Layer: gpu, js
- Stage: gpu-draw, script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: high, because draw-call count is the main CPU cost in WebGPU and WebGL alike.
- Do: Draw all candles, bars or markers of a series with one `draw(verticesPerMark, markCount)` and per-instance data from an instance-step vertex buffer or a storage buffer indexed by `instance_index`.
- Why: webgpufundamentals draws 100 differently scaled/colored triangles in a single call this way; its optimization article recommends instancing whenever the same thing is drawn hundreds of times.
- Example:
  ```ts
  pass.setPipeline(candlePipe);
  pass.setBindGroup(1, candleDataBG);      // storage array<Candle>
  pass.draw(18, visibleCandleCount, 0, firstVisibleCandle); // body + wicks as 6 quads-ish
  ```
- Avoid/caveats: Non-zero `firstInstance` in indirect draws needs the `indirect-first-instance` feature (see indirect rule).
- Status: Core API.
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-buffers.html ; https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html

### Expand lines and points into triangles yourself (WebGPU rasterizes only 1-pixel lines and points)
- Layer: gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness (visual correctness)
- When: load
- Impact: medium, because thick series lines, markers and anti-aliased strokes need geometry expansion.
- Do: For line width > 1 px or markers, draw instanced quads (two triangles per segment or point) and expand them in the vertex shader in pixel space using a resolution uniform; do anti-aliasing in the fragment shader or with MSAA.
- Why: `line-list`/`line-strip`/`point-list` topologies are always 1 px wide in WebGPU; WebGL also only guaranteed 1 px lines in practice, but point sizes > 1 px were available and are now gone.
- Example:
  ```wgsl
  @vertex fn vs(@builtin(vertex_index) v: u32, @location(0) a: vec2f, @location(1) b: vec2f) -> @builtin(position) vec4f {
    let corner = array(vec2f(0, -1), vec2f(1, -1), vec2f(0, 1), vec2f(1, 1))[v]; // triangle-strip, 4 verts per segment
    let pa = toPx(a); let pb = toPx(b);
    let n = normalize(vec2f(pb.y - pa.y, pa.x - pb.x));
    let p = mix(pa, pb, corner.x) + n * corner.y * frame.halfWidthPx;
    return vec4f(toClip(p), 0.0, 1.0);
  }
  ```
- Avoid/caveats: Point-list and line-list pipelines must not set depth bias (validation error since Chrome 131).
- Status: Core behavior.
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-from-webgl.html ; https://webgpufundamentals.org/webgpu/lessons/webgpu-points.html ; https://developer.chrome.com/blog/new-in-webgpu-131

### Record static draw sequences into render bundles and replay them
- Layer: js
- Stage: script-run, main-thread-task
- Metrics: FPS/smoothness, INP, TBT
- When: animation/render-loop
- Impact: high when CPU-bound, because bundle replay skips most per-command validation and IPC.
- Do: Encode draws that repeat unchanged across frames (grid lines, axes geometry, every series' draw calls when only buffer contents change) into a `GPURenderBundleEncoder` once, and call `pass.executeBundles([...])` each frame. Change what is drawn through buffer contents (uniforms, vertex data, indirect args), not by re-encoding. Put as many draws in one bundle as practical.
- Why: Bundle commands are validated at encode time, so execution avoids JS-to-GPU-process marshalling and revalidation. web.dev cites Babylon.js Snapshot Rendering (render bundles) at roughly 10x faster scene rendering.
- Example:
  ```ts
  const be = device.createRenderBundleEncoder({ colorFormats: [format], sampleCount: 4 });
  be.setPipeline(linePipe); be.setBindGroup(0, frameBG);
  for (const s of series) { be.setBindGroup(1, s.bg); be.setVertexBuffer(0, s.vb); be.drawIndirect(argsBuf, s.argsOffset); }
  const seriesBundle = be.finish();
  // every frame: update frame uniforms + indirect counts, then
  pass.executeBundles([seriesBundle]);
  ```
- Avoid/caveats: Each bundle starts with empty pipeline/bind group/vertex/immediate state and clears the pass state afterwards, so repeat shared state inside every bundle. Bundles cannot set viewport, scissor, blend constant or stencil reference, cannot run occlusion queries, and cannot nest. Rebuilding a bundle every frame gives no gain; do not bundle external (video) textures. Bundles do not help a GPU-bound (fill-rate) frame.
- Status: Core API in all WebGPU browsers.
- Sources: https://toji.dev/webgpu-best-practices/render-bundles ; https://gpuweb.github.io/gpuweb/#bundles ; https://web.dev/blog/webgpu-supported-major-browsers

### Drive dynamic draw counts with indirect draws, and keep all indirect args in one buffer
- Layer: gpu, js
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium to high, because it avoids CPU readback and on Chrome/D3D12 per-buffer hidden validation dispatches.
- Do: Let compute shaders write `[vertexCount, instanceCount, firstVertex, firstInstance]` (16 bytes; 20 for indexed) into one shared `INDIRECT | STORAGE` buffer, and call `drawIndirect(buffer, offset)` per series. Store all series' args in the same buffer at different offsets.
- Why: Indirect args let GPU-side culling/decimation decide how much to draw with no readback. On Chrome's D3D12 backend, each distinct indirect buffer adds a validation compute dispatch; toji measured 3 ms of 6 ms pass time with 412 separate buffers, dropping to about 10 µs after merging them into one.
- Example:
  ```ts
  const args = device.createBuffer({ size: 16 * MAX_SERIES, usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  // compute pass writes args[i] = (4, visibleSegments_i, 0, 0)
  for (let i = 0; i < n; i++) pass.drawIndirect(args, i * 16);
  ```
- Avoid/caveats: Without the `indirect-first-instance` feature a non-zero `firstInstance` makes the indirect draw a silent no-op. The hidden validation dispatch time does not show in pass timestamp queries. `multiDrawIndirect` is Chrome-experimental behind a flag, not standard.
- Status: Indirect draws: core in all WebGPU browsers. `indirect-first-instance`: Chrome, Safari 26; not Firefox (BCD). Multi-draw indirect: Chrome 131 experimental only.
- Sources: https://toji.dev/webgpu-best-practices/indirect-draws ; https://toji.dev/webgpu-best-practices/render-bundles ; https://gpuweb.github.io/gpuweb/#dom-gpurendercommandsmixin-drawindirect ; https://developer.chrome.com/blog/new-in-webgpu-131

### Throttle heavy GPU submissions with `onSubmittedWorkDone()`
- Layer: js
- Stage: gpu-draw, main-thread-task
- Metrics: FPS/smoothness, INP
- When: long-lived session (bulk compute, backfills)
- Impact: medium, because queuing too much GPU work adds latency for every frame and can trigger device loss.
- Do: For large background jobs (reprocessing history, building indexes), submit a slice, `await device.queue.onSubmittedWorkDone()`, then submit the next slice. Keep each dispatch short.
- Why: MDN notes that submitting too much work at once may get the work killed and suggests throttling this way; the spec says the device may be lost if shader execution does not end in reasonable time.
- Example:
  ```ts
  for (let start = 0; start < total; start += CHUNK) {
    encodeDecimateChunk(start, Math.min(CHUNK, total - start));
    await device.queue.onSubmittedWorkDone();
  }
  ```
- Avoid/caveats: Not needed before `mapAsync` (the map already waits). Do not use it in the per-frame render path.
- Status: Core API.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/onSubmittedWorkDone ; https://gpuweb.github.io/gpuweb/#vertex-processing ; https://toji.dev/webgpu-best-practices/device-loss

---

## G. Compute for data preparation

### Do data preparation (decimation, scaling, culling) in compute shaders and keep results on the GPU
- Layer: gpu
- Stage: gpu-draw, gpu-upload
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop, interaction (zoom/pan)
- Impact: high for large series, because it removes per-frame JS loops and uploads.
- Do: Upload raw samples once. On zoom/pan, run a compute pass that reduces them to per-pixel-column min/max (or LTTB/density), writes into a buffer with `STORAGE | VERTEX` usage, and optionally writes indirect args. Render from that buffer in the same command encoder; do not read it back.
- Why: Compute shaders exist only in WebGPU, not WebGL. toji calls generating data on the GPU the fastest way to fill a buffer because no staging copies are needed; webgpufundamentals' histogram follow-up draws results directly on the GPU instead of mapping them to JS. ChartGPU (library, not a primary source) runs LTTB/min-max decimation this way.
- Example:
  ```wgsl
  struct Params { first: u32, count: u32, perColumn: f32, _pad: u32 }
  @group(0) @binding(0) var<uniform> p: Params;
  @group(0) @binding(1) var<storage, read> ys: array<f32>;
  @group(0) @binding(2) var<storage, read_write> minMax: array<vec2f>; // buffer also has VERTEX usage
  const WG = 64u;
  var<workgroup> wMin: array<f32, WG>;
  var<workgroup> wMax: array<f32, WG>;

  @compute @workgroup_size(WG)
  fn decimate(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
    let col = wg.x;
    let begin = p.first + u32(f32(col) * p.perColumn);
    let end = min(p.first + u32(f32(col + 1u) * p.perColumn), p.first + p.count);
    var lo = 3.0e38;
    var hi = -3.0e38;
    for (var i = begin + li; i < end; i += WG) { lo = min(lo, ys[i]); hi = max(hi, ys[i]); }
    wMin[li] = lo; wMax[li] = hi;
    workgroupBarrier();
    for (var s = WG / 2u; s > 0u; s >>= 1u) {
      if (li < s) { wMin[li] = min(wMin[li], wMin[li + s]); wMax[li] = max(wMax[li], wMax[li + s]); }
      workgroupBarrier();
    }
    if (li == 0u) { minMax[col] = vec2f(wMin[0], wMax[0]); }
  }
  ```
  ```ts
  const cpass = enc.beginComputePass();
  cpass.setPipeline(decimatePipe); cpass.setBindGroup(0, decimateBG);
  cpass.dispatchWorkgroups(columns);           // one workgroup per pixel column (≤ 65535)
  cpass.end();
  const rpass = enc.beginRenderPass(passDesc); // same encoder: reads minMax as instance attribute
  rpass.setPipeline(minMaxBarPipe); rpass.setVertexBuffer(0, minMaxBuf); rpass.draw(4, columns);
  rpass.end();
  ```
- Avoid/caveats: `u32(f32(...))` column math loses exactness above about 16.7M samples; pass per-column start indices from JS for bigger windows. Empty columns keep the sentinel values; skip them in the vertex shader. A GPU is slow per thread: a single-invocation shader ran about 30x slower than JS in webgpufundamentals, so parallelize. For small windows (a few thousand points) a CPU path may be simpler.
- Status: Compute shaders: core in all WebGPU browsers.
- Sources: https://toji.dev/webgpu-best-practices/buffer-uploads ; https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram.html ; https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram-part-2.html ; https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu ; https://chartgpu.io/docs/performance/

### Size workgroups at 64 and reduce in workgroup memory instead of global atomics
- Layer: gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because bad workgroup shape and atomic contention can make GPU compute slower than JS.
- Do: Default to `@workgroup_size(64)` unless measured otherwise (set it through an `override` to tune). Reduce within a workgroup using `var<workgroup>` arrays and `workgroupBarrier()`, then combine workgroup results in a second pass (log2 reduce) rather than one global atomic per element. Keep barriers in uniform control flow.
- Why: Most GPUs run about 64 invocations in lockstep; larger sizes may drop to a slow path. In the histogram lessons, per-invocation global `atomicAdd` was only about 4x faster than JS, while chunked workgroup accumulation plus parallel reduction was much faster; a single-workgroup final sum took 11 ms and a multi-dispatch reduce fixed it.
- Example:
  ```wgsl
  override WG: u32 = 64;
  @compute @workgroup_size(WG) fn main(@builtin(global_invocation_id) id: vec3u) { /* ... */ }
  ```
- Avoid/caveats: WGSL atomics exist only for `i32`/`u32` (and `vec2u` min/max with the `atomic-vec2u-min-max` feature); there are no `f32` atomics, so float min/max must use workgroup reduction or an order-preserving float-to-uint mapping. Default limits: 256 invocations per workgroup, 16 KiB workgroup storage, 65535 workgroups per dimension.
- Status: Core WGSL. `atomic-vec2u-min-max` is a new optional feature in the spec (check support before use).
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders.html ; https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram.html ; https://gpuweb.github.io/gpuweb/wgsl/#atomic-types ; https://gpuweb.github.io/gpuweb/#limits

### Use subgroup operations for reductions where the `subgroups` feature exists
- Layer: gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because `subgroupMin`/`subgroupMax`/`subgroupAdd` reduce across 16-64 lanes without shared memory or barriers.
- Do: Check `adapter.features.has('subgroups')`, request it, add `enable subgroups;`, and replace the first reduction steps with `subgroupMin`/`subgroupMax`. Read `adapter.info.subgroupMinSize/subgroupMaxSize` if the algorithm depends on the size; `subgroup_size_control` (`@subgroup_size(n)`) can fix it on Chrome 151+.
- Why: Subgroups give SIMD-level cross-thread math; Google Meet saw 2.3-2.9x speed-ups on matrix-vector shaders versus packed dot products (Chrome 134 post).
- Example:
  ```wgsl
  enable subgroups;
  // after per-invocation lo/hi:
  let sgLo = subgroupMin(lo);
  let sgHi = subgroupMax(hi);
  ```
- Avoid/caveats: Subgroup size varies by GPU and is unknown before execution unless controlled; subgroups may be partial. Keep a workgroup-memory fallback.
- Status: Chrome/Edge 134 (BCD/webstatus list 144 for all desktop platforms, marked experimental in BCD); not in Safari or Firefox as of 2026-09. `subgroup_id`: Chrome 144; `subgroup_uniformity`: Chrome 145; `subgroup-size-control`: Chrome 151-152.
- Sources: https://developer.chrome.com/blog/new-in-webgpu-134 ; https://developer.chrome.com/blog/new-in-webgpu-144 ; https://developer.chrome.com/blog/new-in-webgpu-151-152 ; https://api.webstatus.dev/v1/features?q=webgpu ; https://gpuweb.github.io/gpuweb/wgsl/#subgroup-builtin-functions

### Use `shader-f16` only for bandwidth-bound data that tolerates 16-bit precision
- Layer: gpu
- Stage: gpu-draw, gpu-upload
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: low to medium for charts, because most chart data needs f32.
- Do: If `adapter.features.has('shader-f16')`, request it and `enable f16;` for colors, normalized offsets, heatmap intensities or ML-style kernels. Use a WGSL `alias` to compile one source as f16 or f32.
- Why: f16 halves storage and bandwidth; Chrome reports 28-41% speed-ups for an LLM workload on Apple M1 Pro.
- Example:
  ```ts
  const hasF16 = device.features.has('shader-f16');
  const code = `${hasF16 ? 'enable f16; alias real = f16;' : 'alias real = f32;'}
    @group(0) @binding(0) var<storage, read> intensity: array<real>;`;
  ```
- Avoid/caveats: f16 has about 3 significant decimal digits; never use it for prices, timestamps or cumulative sums.
- Status: Chrome 120, Safari 26; not Firefox (BCD, 2026-09).
- Sources: https://developer.chrome.com/blog/new-in-webgpu-120 ; https://gpuweb.github.io/gpuweb/#shader-f16 ; https://bcd.developer.mozilla.org/bcd/api/v0/current/api.GPUSupportedFeatures.json

---

## H. Textures and images

### Load images with `fetch` + `createImageBitmap` + `copyExternalImageToTexture`
- Layer: js, network
- Stage: network, main-thread-task, gpu-upload
- Metrics: startup, INP, TBT
- When: load
- Impact: medium, because it moves image decode off the main thread and avoids double decodes.
- Do: `fetch(url)` → `blob()` → `createImageBitmap(blob)` → create the texture with `TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT` → `queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [w, h])`. Use `flipY` in the source info if needed.
- Why: `createImageBitmap` decodes into a GPU-friendly form off the main thread (toji). An `<img>` source may decode synchronously on upload in Chrome and may decode twice if the element is also in the page.
- Example:
  ```ts
  async function loadTexture(url: string) {
    const bmp = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: 'none' });
    const tex = device.createTexture({ size: [bmp.width, bmp.height], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    device.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex }, [bmp.width, bmp.height]);
    bmp.close();
    return tex;
  }
  ```
- Avoid/caveats: The spec requires both `RENDER_ATTACHMENT` and `COPY_DST` on the destination, a 2D single-sample texture, and a unorm/float format. Sources must be origin-clean. Size is fixed at creation, so create the texture after the image loads (no WebGL-style 1x1 placeholder resize).
- Status: Core API. `HTMLImageElement`/`ImageData` sources: Chrome 118 (BCD experimental), not Safari/Firefox per BCD.
- Sources: https://toji.dev/webgpu-best-practices/img-textures ; https://gpuweb.github.io/gpuweb/#dom-gpuqueue-copyexternalimagetotexture ; https://webgpufundamentals.org/webgpu/lessons/webgpu-importing-textures.html ; https://developer.chrome.com/blog/new-in-webgpu-118

### Build text and icon atlases on a 2D canvas and copy them with `copyExternalImageToTexture`
- Layer: js, canvas2d, gpu
- Stage: raster, gpu-upload
- Metrics: FPS/smoothness, memory
- When: load, interaction (label changes)
- Impact: medium, because axis labels and glyphs are the usual text path for GPU charts.
- Do: Render glyphs or labels into an `OffscreenCanvas` 2D context, pack them in an atlas, and upload with `copyExternalImageToTexture({ source: offscreen })` only when the atlas changes. Draw all labels with one instanced draw sampling the atlas.
- Why: Canvas and OffscreenCanvas are direct sources; the browser can take a fast GPU-to-GPU path because it likely produced the canvas with the same GPU backend (toji). An atlas avoids one texture/draw per label (webgpufundamentals texture atlases).
- Example:
  ```ts
  const atlas = new OffscreenCanvas(1024, 1024);
  const g = atlas.getContext('2d')!; g.font = '12px system-ui'; /* draw glyphs, record uv rects */
  device.queue.copyExternalImageToTexture({ source: atlas }, { texture: atlasTex }, [1024, 1024]);
  ```
- Avoid/caveats: Upload only on change, not each frame. Copying from a WebGL canvas must happen in the same task as its rendering (or needs `preserveDrawingBuffer`).
- Status: Core API.
- Sources: https://toji.dev/webgpu-best-practices/img-textures ; https://webgpufundamentals.org/webgpu/lessons/webgpu-importing-textures.html ; https://gpuweb.github.io/gpuweb/#dom-gpuqueue-copyexternalimagetotexture

### Use `importExternalTexture` for video frames, created and used in the same callback
- Layer: js, gpu
- Stage: gpu-upload, gpu-draw
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium (video overlays only), because it can be zero-copy from the decoder.
- Do: Each frame, call `device.importExternalTexture({ source: videoOrVideoFrame })`, create its bind group, and draw in the same task. Sample with `textureSampleBaseClampToEdge` on a `texture_external` binding. Close `VideoFrame`s promptly.
- Why: External textures avoid copying decoded YUV frames. They expire automatically after the task (video element) or when the `VideoFrame` closes.
- Example:
  ```ts
  function frame() {
    const ext = device.importExternalTexture({ source: video });
    const bg = device.createBindGroup({ layout: videoBGL, entries: [{ binding: 0, resource: ext }, { binding: 1, resource: sampler }] });
    /* encode + submit here, no await in between */
    requestAnimationFrame(frame);
  }
  ```
- Avoid/caveats: An `await` between import and use destroys the texture. Do not put external textures in render bundles.
- Status: Chrome 113+, Safari 26, Firefox 144 (partial; not in Firefox 141).
- Sources: https://toji.dev/webgpu-best-practices/img-textures ; https://gpuweb.github.io/gpuweb/#gpuexternaltexture ; https://mozillagfx.wordpress.com/2025/07/15/shipping-webgpu-on-windows-in-firefox-141/ ; https://bcd.developer.mozilla.org/bcd/api/v0/current/api.GPUDevice.json

### Generate mipmaps yourself only for textures that are minified
- Layer: gpu, js
- Stage: gpu-upload, gpu-draw
- Metrics: FPS/smoothness, memory
- When: load
- Impact: low for 2D charts (textures are usually drawn near 1:1), medium for zoomed imagery.
- Do: Skip mips for atlases drawn at native size. When needed, create the texture with `mipLevelCount = floor(log2(max(w,h))) + 1` and `RENDER_ATTACHMENT`, then run one render pass per level that samples the previous level with a linear min filter (or use a library such as webgpu-utils). Cache the mip pipeline and sampler.
- Why: WebGPU has no `generateMipmap`; WebGL did it in one call.
- Example:
  ```ts
  const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
  const tex = device.createTexture({ size: [w, h], format: 'rgba8unorm', mipLevelCount: levels,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  ```
- Avoid/caveats: A timestamp test said a compute mip generator was 5x faster, but a throughput test showed the render-pass one 8-20% faster; measure with throughput. In compatibility mode, per-layer '2d' views of array textures are not allowed.
- Status: Core API (no built-in function).
- Sources: https://toji.dev/webgpu-best-practices/img-textures ; https://webgpufundamentals.org/webgpu/lessons/webgpu-importing-textures.html ; https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html ; https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu

### Pick texture formats by filtering needs and size
- Layer: gpu
- Stage: gpu-upload, gpu-draw
- Metrics: memory, FPS/smoothness
- When: load
- Impact: medium, because format choice sets bytes per texel and whether linear filtering works.
- Do: Use `rgba8unorm` for colors; `r16float` or `r8unorm` for heatmap/density data that must be filtered; `r32float` only with `textureLoad` (or with the `float32-filterable` feature). Prefer compressed formats (BC/ETC2/ASTC via Basis) for large static images where supported.
- Why: `r32float`/`rg32float`/`rgba32float` are "unfilterable-float" by default (many mobile GPUs cannot filter them), which also forces an explicit bind group layout. Compressed textures use less memory and upload faster (toji).
- Example:
  ```ts
  const heat = device.createTexture({ size: [cols, rows], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  ```
- Avoid/caveats: `float32-filterable` is Chrome-only (BCD experimental); `texture-compression-bc` is desktop-only; ASTC/ETC2 mostly mobile and Apple. Always feature-detect.
- Status: Core formats everywhere; optional features vary (BCD 2026-09).
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-textures.html ; https://toji.dev/webgpu-best-practices/img-textures ; https://bcd.developer.mozilla.org/bcd/api/v0/current/api.GPUSupportedFeatures.json

---

## I. Canvas, passes and attachments

### Configure the canvas with `getPreferredCanvasFormat()` and `alphaMode: 'opaque'` unless you need transparency
- Layer: canvas2d, gpu
- Stage: composite, raster, gpu-draw
- Metrics: FPS/smoothness, memory
- When: load
- Impact: medium, because a non-preferred format adds a full-canvas copy per frame on some platforms.
- Do: `context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' })`. Use `alphaMode: 'premultiplied'` only when the page must show through, and then write premultiplied colors. Call `configure()` once and again only on device change, not per frame.
- Why: On Chrome Android and Mac, a non-preferred format needs an extra texture copy before display (toji). With `'opaque'`, reads by other APIs may need an alpha clear, so for interop-only canvases the spec suggests avoiding it. WebGL defaulted to premultiplied alpha and antialiasing; WebGPU defaults to opaque and single-sampled.
- Example:
  ```ts
  const format = navigator.gpu.getPreferredCanvasFormat(); // 'bgra8unorm' or 'rgba8unorm'
  ctx.configure({ device, format, alphaMode: 'opaque' });
  // pipelines must target the same format
  ```
- Avoid/caveats: The option is `alphaMode` (toji's article writes `alpha`, which is not a spec member). Custom `usage` replaces the default, so include `RENDER_ATTACHMENT`. `rgba16float` + `toneMapping: { mode: 'extended' }` (HDR) doubles bandwidth and is Chrome-only.
- Status: Core API. `toneMapping` (HDR canvas): Chrome 129 per the Chrome post; BCD marks it experimental and lists no Firefox/Safari support.
- Sources: https://toji.dev/webgpu-best-practices/webgl-performance-comparison ; https://gpuweb.github.io/gpuweb/#dom-gpu-getpreferredcanvasformat ; https://gpuweb.github.io/gpuweb/#canvas-configuration ; https://webgpufundamentals.org/webgpu/lessons/webgpu-transparency.html

### Size the drawing buffer from `ResizeObserver`, clamp it, and change it only when needed
- Layer: js, canvas2d
- Stage: layout, gpu-draw
- Metrics: FPS/smoothness, memory, CLS
- When: interaction (resize), load
- Impact: medium, because fill cost scales with pixels and resizing reallocates textures.
- Do: Observe the canvas with `ResizeObserver`, compute device pixels (`devicePixelContentBoxSize` or CSS size × `devicePixelRatio`), clamp to `[1, device.limits.maxTextureDimension2D]`, and assign `canvas.width/height` only when they differ. Recreate MSAA/depth targets only on size change and `destroy()` the old ones.
- Why: Setting the canvas size even to the same value may be slow (webgpufundamentals), resizing invalidates the current texture, and sizes above the device limit produce errors.
- Example:
  ```ts
  new ResizeObserver(([e]) => {
    const w = Math.max(1, Math.min(device.limits.maxTextureDimension2D, Math.round(e.contentBoxSize[0].inlineSize * devicePixelRatio)));
    const h = Math.max(1, Math.min(device.limits.maxTextureDimension2D, Math.round(e.contentBoxSize[0].blockSize * devicePixelRatio)));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; recreateTargets(w, h); dirty = true; }
  }).observe(canvas);
  ```
- Avoid/caveats: Benchmarks that differ in DPR or canvas size are not comparable.
- Status: Core API.
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-resizing-the-canvas.html ; https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html ; https://gpuweb.github.io/gpuweb/explainer/#canvas-configuration

### Implement MSAA explicitly and cheaply: reuse the 4x target, resolve once, discard samples
- Layer: gpu
- Stage: gpu-draw, raster
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, because a 4x target is 4x the memory and bandwidth of the canvas.
- Do: Create one `sampleCount: 4` color texture per canvas size (reuse it each frame), set `resolveTarget` to the canvas view only in the last pass, and use `storeOp: 'discard'` on the MSAA attachment. Where available, add `GPUTextureUsage.TRANSIENT_ATTACHMENT` so the samples stay in tile memory. If shaders already anti-alias lines, skip MSAA.
- Why: WebGPU canvases are single-sampled; WebGL gave you MSAA by default. Sample count can only be 1 or 4. Transient attachments can avoid VRAM traffic and even VRAM allocation.
- Example:
  ```ts
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | ('TRANSIENT_ATTACHMENT' in GPUTextureUsage ? (GPUTextureUsage as any).TRANSIENT_ATTACHMENT : 0);
  const msaa = device.createTexture({ size: [w, h], sampleCount: 4, format, usage });
  const color = { view: msaa.createView(), resolveTarget: ctx.getCurrentTexture().createView(),
                  loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 1] } as const;
  ```
- Avoid/caveats: Transient textures need empty `viewFormats`, cannot be resolve targets, and their contents vanish after the pass (Chrome 149-150 validation). Pipelines must declare `multisample: { count: 4 }`.
- Status: MSAA: core. `TRANSIENT_ATTACHMENT`: Chrome 146; Firefox 157 partial (pre-release); not Safari (BCD).
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-multisampling.html ; https://developer.chrome.com/blog/new-in-webgpu-146 ; https://developer.chrome.com/blog/new-in-webgpu-149-150 ; https://toji.dev/webgpu-best-practices/webgl-performance-comparison

### Prefer `loadOp: 'clear'` and `storeOp: 'discard'` when you do not need old or later contents
- Layer: gpu
- Stage: gpu-draw, raster
- Metrics: FPS/smoothness (mobile especially)
- When: animation/render-loop
- Impact: medium on tile-based (mobile, Apple) GPUs, low elsewhere.
- Do: Clear attachments you redraw fully; discard depth/stencil and MSAA attachments after the pass. Use `'load'` only for incremental drawing (for example, appending new candles on top of a cached layer).
- Why: The spec notes `'clear'` can be much cheaper on mobile hardware because it avoids loading main memory into tile memory; discarded attachments need not be written back.
- Example:
  ```ts
  depthStencilAttachment: { view: depthView, depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'discard' }
  ```
- Avoid/caveats: Emulating WebGL `preserveDrawingBuffer` needs an intermediate texture with `'load'` plus a copy each frame; avoid it.
- Status: Core API.
- Sources: https://gpuweb.github.io/gpuweb/#enumdef-gpuloadop ; https://toji.dev/webgpu-best-practices/webgl-performance-comparison

---

## J. WGSL authoring

### Write clean, modular WGSL and let the driver optimize; remove work instead of micro-tuning
- Layer: gpu
- Stage: gpu-draw, script-compile
- Metrics: FPS/smoothness, startup
- When: build, load
- Impact: medium, because the WGSL translator does few optimizations while drivers do many.
- Do: Keep entry points small and specific (a module's unused functions and bindings are not part of a pipeline). Move per-draw constant math to JS/uniforms, per-vertex math out of the fragment shader, and use `textureLoad` for exact texel reads. Use `select()` for simple conditional values.
- Why: Dawn's lead said in 2023 that Tint did no optimizations and that driver compilers do "lots of them"; Tint now has an IR (up to 7x faster translation, Chrome 141), integer range analysis to drop redundant bounds checks (Chrome 141), and platform `discard` semantics that restore performance (Chrome 133). Only resources an entry point statically uses become required bindings.
- Example:
  ```wgsl
  // Before: per-pixel division by a per-draw constant
  let t = (x - frame.start) / frame.span;
  // After: JS precomputes invSpan once per frame
  let t = (x - frame.start) * frame.invSpan;
  ```
- Avoid/caveats: The Chrome `strictMath: false` shader option is a developer-flag experiment, not for production. Runtime-sized array indexing still carries bounds clamps; fixed-size arrays or provable ranges help.
- Status: Guidance; Tint changes are Chrome-specific.
- Sources: https://groups.google.com/g/dawn-graphics/c/bbCgIrYYdng ; https://developer.chrome.com/blog/new-in-webgpu-141 ; https://developer.chrome.com/blog/new-in-webgpu-133 ; https://developer.chrome.com/blog/new-in-webgpu-131 ; https://webgpufundamentals.org/webgpu/lessons/webgpu-wgsl.html

### Feature-detect WGSL language extensions and declare them with `requires`
- Layer: gpu, js
- Stage: script-compile, startup
- Metrics: startup (no failed compiles), FPS/smoothness
- When: load
- Impact: low, because it prevents invalid shader modules and keeps fast paths optional.
- Do: Check `navigator.gpu.wgslLanguageFeatures.has(name)` (for example `immediate_address_space`, `uniform_buffer_standard_layout`, `linear_indexing`, `subgroup_id`, `buffer_view`) before emitting the fast-path WGSL, and put `requires <name>;` at the top.
- Why: Language extensions are enabled automatically when supported, but support differs by browser; a `requires` directive states the portability risk.
- Example:
  ```ts
  const lf = navigator.gpu.wgslLanguageFeatures;
  const header = lf.has('linear_indexing') ? 'requires linear_indexing;\n' : '';
  ```
- Avoid/caveats: Most extensions listed here are Chrome-only as of 2026-09 (BCD); always keep the portable path.
- Status: `wgslLanguageFeatures`: Chrome 115+, Safari 26, Firefox 141 partial. Extensions: see BCD.
- Sources: https://developer.chrome.com/blog/new-in-webgpu-115 ; https://developer.chrome.com/blog/new-in-webgpu-147-148 ; https://developer.chrome.com/blog/new-in-webgpu-153-154 ; https://bcd.developer.mozilla.org/bcd/api/v0/current/api.WGSLLanguageFeatures.json

---

## K. Profiling, errors and debugging

### Measure GPU pass time with `timestamp-query`, averaged, and confirm with throughput tests
- Layer: tooling, gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: testing, long-lived session (telemetry)
- Impact: medium, because it separates GPU-bound from CPU-bound frames.
- Do: If the adapter has `'timestamp-query'`, request it, create one `GPUQuerySet` of type `'timestamp'` with 2 slots per pass, set `timestampWrites` on passes, `resolveQuerySet` into a `QUERY_RESOLVE | COPY_SRC` buffer, copy to a `MAP_READ` buffer only when it is unmapped, read as `BigUint64Array`, and keep a rolling average that ignores negative deltas. Time JS encode separately with `performance.now()`.
- Why: Results are nanoseconds but Chrome quantizes them to 100 µs (unless the developer flag is on); GPUs may reset counters. webgpufundamentals found a compute mip generator "5x faster" by timestamps but 8-20% slower in a throughput test, so timestamps alone are not a performance verdict.
- Example:
  ```ts
  const qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  const pass = enc.beginRenderPass({ ...passDesc, timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } });
  // after pass.end():
  enc.resolveQuerySet(qs, 0, 2, resolveBuf, 0);
  if (resultBuf.mapState === 'unmapped') enc.copyBufferToBuffer(resolveBuf, 0, resultBuf, 0, 16);
  ```
- Avoid/caveats: Values are implementation-defined; do not compare across GPUs or trust relative numbers across machines. Chrome's hidden indirect-draw validation does not show in pass timings. `writeTimestamp()` on encoders is deprecated; use `timestampWrites`. For a CPU-only view, render to a 1x1 canvas to remove fill cost (webgpufundamentals).
- Status: Chrome 121; Safari 26 lists the feature (BCD disagrees for `timestampWrites`, so feature-detect); not Firefox.
- Sources: https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html ; https://developer.chrome.com/blog/new-in-webgpu-121 ; https://developer.chrome.com/blog/new-in-webgpu-120 ; https://gpuweb.github.io/gpuweb/#timestamp ; https://toji.dev/webgpu-best-practices/indirect-draws

### Keep error scopes around synchronous setup code, not in the per-frame loop
- Layer: js
- Stage: microtask, main-thread-task
- Metrics: FPS/smoothness, INP
- When: load, long-lived session
- Impact: low to medium, because errors are async by design, but awaited scopes add round-trip latency.
- Do: Use `pushErrorScope('validation' | 'out-of-memory' | 'internal')` / `popErrorScope()` around resource and pipeline creation, especially for user-driven sizes (OOM on huge series). Pop in the same synchronous block (no `await` between push and pop). For telemetry, listen to `uncapturederror` once. Never `await popErrorScope()` inside the render loop.
- Why: WebGPU returns errors asynchronously so no sync IPC is needed (WebGL's `getError()` forces a round-trip and GPU sync). `popErrorScope()`'s promise resolves only after the enclosed operations complete and report back from the GPU process, so awaiting it serializes work. Scopes that span `await`s capture the wrong calls.
- Example:
  ```ts
  device.pushErrorScope('out-of-memory');
  const big = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.popErrorScope().then(err => { if (err) degradeToDecimatedUpload(); }); // not awaited in the frame
  device.addEventListener('uncapturederror', e => report(e.error.message, device.adapterInfo));
  ```
- Avoid/caveats: Do not parse error messages (implementation-specific). Listening to `uncapturederror` hides console output unless you re-log it.
- Status: Core API. `uncapturederror` event: Chrome, Firefox 141 partial, Safari 27 (BCD).
- Sources: https://toji.dev/webgpu-best-practices/error-handling ; https://gpuweb.github.io/gpuweb/explainer/#errors-errorscopes ; https://github.com/gpuweb/gpuweb/blob/main/design/ErrorHandling.md ; https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu

### Label every GPU object and use debug groups, also in production
- Layer: js, tooling
- Stage: script-run
- Metrics: (debuggability) FPS/smoothness indirectly
- When: build, testing, long-lived session
- Impact: low, because labels cost very little and make errors and native profiler captures readable.
- Do: Pass `label` on every descriptor (device, buffers, textures, pipelines, passes) and wrap pane/series encoding in `pushDebugGroup`/`popDebugGroup` (balanced per encoder).
- Why: Browsers include labels and the debug-group stack in error messages, and labels reach PIX/RenderDoc/Xcode captures. toji recommends keeping them in release builds.
- Example:
  ```ts
  const vb = device.createBuffer({ label: `series:${symbol}:ohlc`, size, usage });
  pass.pushDebugGroup(`pane:${paneId}`); drawPane(pass); pass.popDebugGroup();
  ```
- Avoid/caveats: Do not build label strings in hot per-draw loops; set them at creation.
- Status: Core API.
- Sources: https://toji.dev/webgpu-best-practices/error-handling ; https://gpuweb.github.io/gpuweb/explainer/#debug-markers-and-debug-groups

### Port from WebGL by restructuring, and benchmark fairly
- Layer: tooling, js
- Stage: gpu-draw, script-run
- Metrics: FPS/smoothness
- When: testing
- Impact: high for decisions, because a 1:1 port can be slower and unfair comparisons mislead.
- Do: Restructure around pipelines, bind groups by frequency, big buffers, instancing, bundles and compute. When comparing with WebGL, match GPU (`powerPreference` in both, verify `adapter.info` vs `WEBGL_debug_renderer_info`), antialiasing (WebGL `antialias: false` or WebGPU MSAA), depth/stencil, alpha mode, `preserveDrawingBuffer: false`, and resolution. Check `chrome://gpu` shows "WebGPU: Hardware accelerated".
- Why: WebGL applies defaults (MSAA, premultiplied alpha, depth buffer) that WebGPU does not, and each API may pick a different GPU (Chrome picks low-power WebGPU on battery). Chrome's troubleshooting page says direct translation may miss WebGPU's advantages.
- Example:
  ```ts
  const gl = canvas2.getContext('webgl2', { powerPreference: 'high-performance', antialias: false, alpha: false, depth: false, stencil: false });
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  ```
- Avoid/caveats: Firefox's WebGPU had significant IPC overhead at launch (improved in 142) and a timer-based completion check; results differ by browser.
- Status: Guidance.
- Sources: https://toji.dev/webgpu-best-practices/webgl-performance-comparison ; https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips ; https://webgpufundamentals.org/webgpu/lessons/webgpu-from-webgl.html ; https://mozillagfx.wordpress.com/2025/07/15/shipping-webgpu-on-windows-in-firefox-141/

---

## L. Browser support snapshot (2026-09)

### Treat WebGPU as a progressive enhancement with per-feature detection
- Layer: js
- Stage: startup
- Metrics: startup, FPS/smoothness
- When: load
- Impact: high, because optional features and extensions differ widely by browser.
- Do: Ship a WebGL path; enable WebGPU where an adapter exists; gate each fast path (`timestamp-query`, `shader-f16`, `subgroups`, `indirect-first-instance`, immediates, transient attachments, compatibility mode) on detection.
- Why / facts:
  - Chrome/Edge: Windows/macOS/ChromeOS since 113; Android 12+ (ARM, Qualcomm, Intel) since 121, Imagination Android 16+ since 139; Linux Intel Gen12+ since 144, NVIDIA (Wayland, driver 535.183.01+) since 147; Windows ARM64 behind a flag; Samsung Xclipse expected around 154.
  - Safari 26: macOS Tahoe, iOS/iPadOS 26, visionOS 26, on by default; WebKit says validation was streamlined for near-native overhead.
  - Firefox: Windows 141; Apple-silicon macOS 145 (Tahoe) and 147 (all macOS versions); Intel Macs and Linux only in Nightly; Android behind a flag; Firefox Android has no WebGPU.
  - Optional features (BCD): `shader-f16` and `timestamp-query` in Chrome and Safari 26, not Firefox; `subgroups`, `float32-filterable`, `clip-distances` Chrome only; `dual-source-blending` Chrome and Firefox 155; immediates Chrome 150 only.
- Example:
  ```ts
  const caps = { f16: adapter.features.has('shader-f16'), ts: adapter.features.has('timestamp-query'),
    sg: adapter.features.has('subgroups'), imm: navigator.gpu.wgslLanguageFeatures.has('immediate_address_space') };
  ```
- Avoid/caveats: BCD lists Chrome desktop as 144 because Linux support started then; Windows/macOS had it since 113. Some BCD entries disagree with each other (timestamp query sets in Safari); runtime detection is the source of truth.
- Status: Baseline "limited" (webstatus.dev, 2026-09).
- Sources: https://github.com/gpuweb/gpuweb/wiki/Implementation-Status ; https://api.webstatus.dev/v1/features/webgpu ; https://bcd.developer.mozilla.org/bcd/api/v0/current/api.GPUSupportedFeatures.json ; https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/ ; https://web.dev/blog/webgpu-supported-major-browsers ; https://developer.chrome.com/docs/web-platform/webgpu/overview

---

## WebGL → WebGPU: what changes, at a glance

| Area | WebGL | WebGPU | Code-writing consequence |
|---|---|---|---|
| State | Global mutable state | Immutable pipelines + bind groups | Build pipelines/layouts up front; group bindings by frequency |
| Errors | Sync `getError()` (IPC round-trip) | Async error scopes, `uncapturederror` | Never poll errors per frame |
| Canvas | One context per canvas; ~16 live contexts in Chrome/Safari | One device, many canvases | Share one device across panes |
| MSAA/depth/alpha | Automatic defaults | Explicit textures; opaque single-sample default | Create MSAA/depth yourself; choose `alphaMode` |
| Buffers/textures | Resizable (`bufferData`, `texImage2D`) | Immutable size/usage/format | Preallocate, grow with GPU copy, `destroy()` old |
| Mipmaps | `generateMipmap()` | None | Own mip pass or skip |
| Compute | None | Compute shaders, storage buffers, atomics | Move decimation/culling to GPU |
| Repeated commands | Re-issued each frame | Render bundles | Record static draws once |
| Lines/points | 1 px lines; sized points | 1 px lines and points only | Expand to instanced quads |
| Clip space | Z −1..1, framebuffer Y up | Z 0..1, framebuffer Y down | Adjust projection matrices |
| Readback | Blocking `readPixels` | Async `mapAsync` | Pool readback buffers, consume later |

---

## Sources read

- https://toji.dev/webgpu-best-practices/
- https://toji.dev/webgpu-best-practices/buffer-uploads
- https://toji.dev/webgpu-best-practices/bind-groups
- https://toji.dev/webgpu-best-practices/render-bundles
- https://toji.dev/webgpu-best-practices/indirect-draws
- https://toji.dev/webgpu-best-practices/webgl-performance-comparison
- https://toji.dev/webgpu-best-practices/img-textures
- https://toji.dev/webgpu-best-practices/error-handling
- https://toji.dev/webgpu-best-practices/device-loss
- https://toji.dev/webgpu-best-practices/compute-vertex-data
- https://toji.dev/webgpu-best-practices/dynamic-shader-construction
- https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-uniforms.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-buffers.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-memory-layout.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-vertex-buffers.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-textures.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-importing-textures.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-copying-data.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram-part-2.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-bind-group-layouts.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-immediates.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-constants.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-limits-and-features.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-compatibility-mode.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-multisampling.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-transparency.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-points.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-resizing-the-canvas.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-multiple-canvases.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-debugging.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-wgsl.html
- https://webgpufundamentals.org/webgpu/lessons/webgpu-from-webgl.html
- https://developer.chrome.com/docs/web-platform/webgpu/news (all "What's New in WebGPU" posts: new-in-webgpu-113 … 146, 147-148, 149-150, 151-152, 153-154; read in full: 114, 115, 116, 117, 120, 121, 126, 130, 131, 133, 134, 136, 137, 138, 140, 141, 144, 145, 146, 147-148, 149-150, 151-152, 153-154; headings of the rest)
- https://developer.chrome.com/docs/web-platform/webgpu/overview
- https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu
- https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
- https://gpuweb.github.io/gpuweb/ (Editor's Draft 21 Sept 2026: limits, features, pipeline creation, bundles, load/store ops, canvas, copyExternalImageToTexture, external textures, timestamps, user-agent caches)
- https://gpuweb.github.io/gpuweb/explainer/
- https://gpuweb.github.io/gpuweb/wgsl/ (float types, atomics, subgroup built-ins)
- https://github.com/gpuweb/gpuweb/blob/main/design/ErrorHandling.md
- https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- https://developer.mozilla.org/en-US/docs/Web/API/GPUBuffer/mapAsync
- https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/writeBuffer
- https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/onSubmittedWorkDone
- https://bcd.developer.mozilla.org/bcd/api/v0/current/ (api.GPU, GPUSupportedFeatures, GPURenderPassEncoder, GPUComputePassEncoder, GPURenderBundleEncoder, GPUDevice, GPUQueue, GPUCanvasContext, GPUBuffer, GPUTexture, GPUCommandEncoder, GPUAdapterInfo, WGSLLanguageFeatures, WorkerNavigator, OffscreenCanvas)
- https://api.webstatus.dev/v1/features/webgpu and https://api.webstatus.dev/v1/features?q=webgpu
- https://mozillagfx.wordpress.com/2025/07/15/shipping-webgpu-on-windows-in-firefox-141/
- https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/
- https://web.dev/blog/webgpu-supported-major-browsers
- https://groups.google.com/g/dawn-graphics/c/bbCgIrYYdng
- https://chartgpu.io/docs/performance/ (library docs; used only as a real-world example)

## Not covered / could not access

- SciChart.js WebGPU details: scichart.com returned HTTP 403 to both WebFetch and curl (blog "SciChart.js v6 in Alpha - WebGPU…" and forum "webgpu-support"). Search snippets claim v6 alpha adds WebGPU with automatic WebGL fallback, but this is unverified here; another agent should confirm the SciChart API and whether its WebGPU path is opt-in.
- No primary source gives a measured per-call cost for `pushErrorScope`/`popErrorScope`; the "not in the frame loop" rule is based on spec/explainer semantics (promise resolves after GPU-process completion), not a benchmark.
- No primary source on GPU min/max decimation for charts specifically; the compute example is original and combines webgpufundamentals reduction patterns with toji's "generate data on the GPU" advice. Not benchmarked.
- Canvas-count guidance ("one big canvas vs many canvases") for WebGPU is inference; no source measured it.
- `atomic-vec2u-min-max`, `texture-compression-unaligned` and the `buffer_view` extension appear in the Sept 2026 spec/Chrome 153-154 post, but browser support was not checked in detail.
- Toji's PIX / Xcode / RenderDoc profiling guides and the glTF case study were not read.
- WebKit-specific WebGPU performance guidance beyond the WWDC25 post (for example Safari 26.x release notes) was not read; Safari optional-feature support is taken from BCD only.
- Firefox release notes 142-156 were not read; the Firefox IPC/timer caveats are from the July 2025 blog and may be fixed now.
