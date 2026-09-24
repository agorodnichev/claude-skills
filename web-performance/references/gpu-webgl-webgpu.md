# GPU: WebGL2 and WebGPU buffers, shaders, textures, draws, readback and loss (GPU-)

Open this when you write WebGL2 or WebGPU code: `getContext('webgl2')`, `gl.` calls, `navigator.gpu`, `GPUDevice`, `.wgsl` or `.glsl` shaders, `#version 300 es`, vertex and uniform buffers, textures, draw calls, readback, context or device loss. The canvas element, its size, DPR and the render loop are in `gpu-canvas-and-frames.md`. A chart library that owns its renderer has its own reference file. When WebGL and WebGPU differ, a rule's Do has a "WebGL:" part and a "WebGPU:" part; §J lists what changes in a move to WebGPU.
Stage cards: `pipeline.md` §H (`gpu-upload`, `gpu-draw`, `memory`, `tasks`). Where GPU work sits in a frame: `pipeline.md` §C.

## Checklist

| ID | Do this | Impact | First stage |
|---|---|---|---|
| **§0 Optimization ladder** (fix the rung that a measurement names) | | | |
| **§A Context and device** | | | |
| GPU-01 | WebGL2 first, WebGPU behind detection, a Canvas 2D or message path at the end | high | gpu-draw |
| GPU-02 | No unused depth, stencil or MSAA; opaque output; no preserved buffer | medium | gpu-draw |
| GPU-03 | One WebGL context or one `GPUDevice` for many panes: viewport plus scissor | high | gpu-draw |
| GPU-04 | Default `powerPreference`; only the limits and features you use; look them up once | medium | gpu-draw |
| **§B Shaders and pipelines** | | | |
| GPU-05 | Create GPU objects at load or on data change, never in the frame | high | tasks |
| GPU-06 | Batch compile and link checks; poll completion; async pipelines before the first frame | high | tasks |
| GPU-07 | Reuse pipelines; per-series values in buffers; a bounded set of `override` variants | medium | gpu-draw |
| **§C Buffers and data types** | | | |
| GPU-08 | Allocate once with headroom; upload only changed ranges from reused arrays | high | gpu-upload |
| GPU-09 | Append into a ring region; rotate 2–3 buffers instead of orphaning | high | gpu-upload |
| GPU-10 | Split static from dynamic data; usage hints that match the real rate | medium | gpu-upload |
| GPU-11 | Smallest vertex and index types that keep precision; static index buffers | medium | gpu-upload |
| GPU-12 | WebGPU: `writeBuffer` by default, `mappedAtCreation` for initial data, staging only when measured | medium | gpu-upload |
| GPU-13 | Upload before the first visible frame, and at frame start before any draw | medium | gpu-upload |
| GPU-14 | No raw Unix-ms timestamps in float32: subtract a float64 origin | high | gpu-upload |
| GPU-15 | Shift relative to the visible origin on the CPU; high/low split for extreme ranges | high | gpu-draw |
| GPU-16 | `highp` for coordinates; `mediump` only for bounded values | medium | gpu-draw |
| **§D Draw submission** | | | |
| GPU-17 | Instancing for repeated marks: one record per mark, one draw | high | gpu-draw |
| GPU-18 | Thick lines as instanced quads, never `lineWidth` | high | gpu-draw |
| GPU-19 | Sort draws by state; one shared per-frame uniform buffer; bind groups by rate | high | gpu-draw |
| GPU-20 | Multi-draw, render bundles and indirect draws where the draw list repeats | medium | gpu-draw |
| GPU-21 | WebGPU: one command buffer per frame; throttle bulk GPU work | medium | js |
| **§E Fragment cost** | | | |
| GPU-22 | Per-vertex math; no needless blending, `discard` or overdraw | high | gpu-draw |
| **§F Textures and text** | | | |
| GPU-23 | Fixed texture storage, region updates, formats chosen by use | medium | gpu-upload |
| GPU-24 | GPU text: rasterize only on change; upload dirty atlas sub-rectangles | high | gpu-upload |
| GPU-25 | Glyph atlas, per-string slots with LRU, or SDF, by label set and transform | medium | gpu-upload |
| GPU-26 | Premultiplied uploads end to end; flip and color options set on the bitmap | medium | gpu-upload |
| GPU-35 | KTX2 and Basis Universal for large static images | low | gpu-upload |
| GPU-36 | Per-item data in a data texture read with `texelFetch()` | medium | gpu-draw |
| **§G Readback and picking** | | | |
| GPU-27 | No synchronous readback or state queries in frame or input paths | high | tasks |
| GPU-28 | Hit-test on the CPU with cached geometry | high | tasks |
| **§H Loss and teardown** | | | |
| GPU-29 | Handle context and device loss; keep the data to rebuild; test it | high | gpu-upload |
| GPU-30 | On destroy: stop the loop, free GPU objects between frames, release the context | high | memory |
| GPU-31 | Do not store attachments that nobody reads | medium | gpu-draw |
| **§I Profiling** | | | |
| GPU-32 | Timer and timestamp queries in development, read in later frames | medium | gpu-draw |
| GPU-33 | Zero WebGL and WebGPU errors; error scopes at setup; labels | medium | tasks |
| GPU-34 | Name the limit first: shrink the canvas, zero the draws, test weak GPUs | high | gpu-draw |
| **§J WebGL2 → WebGPU** (a table, no rules) | | | |
| **§K One-line rules** | | | |
| GPU-37 | Check float render, filter and blend support once at setup | medium | gpu-draw |
| GPU-38 | WebGPU compute for decimation; results stay on the GPU | medium | gpu-draw |
| GPU-39 | `f16` and subgroups only behind detection, for data that tolerates them | low | gpu-draw |
| GPU-40 | Immediates for a few bytes of per-draw data, where supported | low | gpu-draw |
| GPU-41 | WGSL struct layout from one helper, not by hand | medium | gpu-upload |
| GPU-42 | Video: external textures used in the same task; upload only new frames | low | gpu-upload |
| GPU-43 | Attribute 0 as an array; first provoking vertex for `flat` varyings | low | gpu-draw |
| GPU-44 | Draw in rAF; `flush()` outside it; never `finish()` to wait | low | gpu-draw |

- → CNV-01, CNV-02 one rAF owner per surface; render on demand; every loop stops
- → CNV-04, CNV-05 backing-store size from `device-pixel-content-box`; DPR and pixel cap; memory budget
- → CNV-07, CNV-08 cache static layers in a texture; DOM or 2D overlays for tooltips and sparse text
- → CNV-16 choose the label technique (DOM, 2D overlay or GPU glyphs) by count and update rate
- → CNV-18, CNV-25 render in a worker with `OffscreenCanvas`; one context feeds many canvases through `bitmaprenderer`
- → CNV-20 pause when the tab is hidden or the surface is off-screen

## §0 Optimization ladder

Measure first (GPU-34), then fix the highest rung that the measurement names:
1. Algorithm and count: draw only what the screen can show (CNV-21), cull, decimate (GPU-38).
2. CPU–GPU sync: no synchronous readback or state queries in a frame (GPU-27).
3. Resource churn: no creation, compile or reallocation per frame (GPU-05, GPU-06, GPU-08).
4. Bandwidth and overdraw: bytes per vertex, upload size, covered pixels (GPU-11, GPU-22, CNV-05).
5. Draw count: instancing, state sorting, bundles (GPU-17, GPU-19, GPU-20).
6. Shader arithmetic: last, and only after a profile points to it (GPU-22).

## §A Context and device

### GPU-01 Start with WebGL2, add WebGPU behind detection, end the chain in Canvas 2D
stage: gpu-draw, tasks · metric: startup, frame · when: load · impact: high — a null WebGL2 context or a null adapter is a normal state on some machines, and without a path the chart area stays blank · support: webgpu · also: GPU-04, GPU-29, GPU-34
- Do: Put both back ends behind one renderer interface and one JS data model. Choose once at startup: an adapter and a device → WebGPU; else a WebGL2 context → WebGL2; else a Canvas 2D view or a clear message, plus a telemetry event with the reason (`webglcontextcreationerror` carries a `statusMessage`). Probe on a throwaway canvas, because the first `getContext()` call fixes the context type of a canvas.
- Why: `requestAdapter()` returns `null` when the GPU is blocklisted, acceleration is off or the GPU process crashed repeatedly. Chrome desktop no longer falls back to the SwiftShader software renderer for WebGL, so `getContext('webgl2')` can also return `null` (support.md §C). WebGL2 has instancing, VAOs, uniform buffers, `texStorage2D`, pack buffers and fences in core, which later rules use.
- Detect: `rg -n "getContext\(\s*['\"]webgl2?['\"]|requestAdapter\(" -g '*.{ts,tsx,js,jsx,svelte,vue}'`, then look for the `null` branch; `requestAdapter\(\)\)!|adapter!\.` (a non-null assertion); a module with WebGL setup and no `webglcontextcreationerror` listener.
- Verify: measure.md#load on the normal GPU, then one run in a browser without a usable GPU (ask the user to start one with `--disable-gpu`). Pass: `__wpProbe.env()` names a hardware renderer in the first run; in the second, the fallback view renders, the reason reaches telemetry, and `list_console_messages` shows no uncaught error.
- Example:
  ```ts
  type Backend = { kind: 'webgpu'; device: GPUDevice } | { kind: 'webgl2' } | { kind: 'canvas2d'; reason: string };
  export async function pickBackend(): Promise<Backend> {
    const adapter = await navigator.gpu?.requestAdapter();             // null is a normal answer
    const device = await adapter?.requestDevice().catch(() => null);
    if (device) return { kind: 'webgpu', device };
    const probe = document.createElement('canvas');                    // throwaway: keeps its first context type
    let reason = 'no WebGL2';
    probe.addEventListener('webglcontextcreationerror', (e) => { reason = (e as WebGLContextEvent).statusMessage || reason; });
    const gl = probe.getContext('webgl2');
    if (gl) { gl.getExtension('WEBGL_lose_context')?.loseContext(); return { kind: 'webgl2' }; }  // free the slot
    return { kind: 'canvas2d', reason };                                // light view, and report `reason`
  }
  ```
- Avoid: Do not reject WebGPU on `adapter.info.isFallbackAdapter` alone: Chrome reports `false` on user devices today, so check the renderer in tests instead (GPU-34). Do not tell users to restart or to set flags because no adapter exists. WebGPU is not faster by default: a one-to-one port can be slower (§J).
- Source: https://chromestatus.com/feature/5166674414927872 ; https://toji.dev/webgpu-best-practices/device-loss

### GPU-02 Request only the buffers you use: no spare depth, stencil or MSAA, no preserved buffer
stage: gpu-draw, composite, memory · metric: frame, memory · when: load · impact: medium — each default attachment grows with device pixels, and 4× MSAA multiplies it · support: baseline, webgpu · also: CNV-17, GPU-31
- Do: WebGL: pass `depth: false` for 2D drawing (the default is `true`), keep `stencil: false`, set `antialias: false` when shaders antialias lines themselves, keep `preserveDrawingBuffer: false`, and keep `alpha: true` while you clear with alpha 1 and write alpha 1. WebGPU: call `configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' })` once per canvas, create MSAA and depth textures only when a pass uses them, and leave `viewFormats` empty.
- Why: At 1920 × 1080 device pixels, 4× MSAA of color plus depth-stencil adds about 66 MB before the resolve (arithmetic in the WebGL notes). A preserved drawing buffer can block the cheap buffer swap on some platforms, a non-preferred WebGPU format adds a copy per frame on some platforms, and extra view formats can slow every texture that lists them.
- Detect: `rg -n "getContext\(\s*['\"]webgl2?['\"]\s*\)" -g '*.{ts,tsx,js,jsx}'` (no attribute object); `preserveDrawingBuffer:\s*true`; `alpha:\s*false` in WebGL context options; `\.configure\(\{` without `getPreferredCanvasFormat`; `viewFormats:\s*\[\s*['"]`.
- Verify: measure.md#gpu at DPR 1 and DPR 2. Pass: `gl.getContextAttributes()` returns the attributes that you meant, and frame p95 at DPR 2 wins or stays neutral.
- Avoid: Sources disagree on `alpha: false` for WebGL (MDN warns that it can be expensive; webgl2fundamentals and Emscripten recommend it), so keep `alpha: true` with opaque writes unless a measurement on the target GPUs says otherwise; CNV-17 covers 2D. `true` for depth, stencil and antialias is only a request, and `false` is binding. The first `getContext()` call fixes the attributes. For a screenshot, call `toBlob()` in the same task as the draw instead of preserving the buffer. With premultiplied output (the WebGL default), never write a color channel above alpha.
- Source: https://registry.khronos.org/webgl/specs/latest/1.0/#WEBGLCONTEXTATTRIBUTES ; https://gpuweb.github.io/gpuweb/#canvas-configuration

### GPU-03 Draw many panes through one WebGL context or one `GPUDevice`, with viewport and scissor
stage: gpu-draw, gpu-upload, memory · metric: memory, startup, frame · when: load, session · impact: high — each context compiles its own shaders and holds its own buffers, and past the live-context cap the browser loses the oldest one · support: baseline, webgpu · also: CNV-25, GPU-29, GPU-30
- Do: WebGL: draw each pane of a dashboard into its rectangle of one context with `viewport()`, `SCISSOR_TEST` and `scissor()`: one canvas behind the panes, or one off-screen context whose frames go to the pane canvases through `bitmaprenderer` (CNV-25). WebGPU: create one device per page or worker, `configure()` each pane canvas with it, encode all panes into one command encoder and submit once per frame. Skip panes that are off-screen or not dirty.
- Why: Contexts share nothing, so each extra context compiles the same programs and uploads the same atlases again. Chrome keeps a limited number of live WebGL contexts per page and fewer per worker (support.md §C); one more context loses the oldest, which stays blank until a slot frees. A WebGPU device can render to any number of canvases.
- Detect: `rg -n "getContext\(\s*['\"](webgl2?|webgpu)['\"]|requestDevice\(" -g '*.{ts,tsx,js,jsx,svelte,vue}'` inside a component that repeats per pane; the console warning "Too many active WebGL contexts".
- Verify: measure.md#mem with the dashboard at its maximum pane count, then measure.md#start. Pass: an app counter of live contexts in `window.__perf.counters()` reads 1, `list_console_messages` has no context warning, and startup time wins.
- Avoid: A page-sized canvas under scrolling content must redraw on every scroll: prefer a fixed canvas or the `bitmaprenderer` hand-off. Many small WebGPU canvases still cost compositing each (not measured in the sources). One shared context is one shared failure: a loss blanks every pane, so GPU-29 covers all of them.
- Source: https://webgl2fundamentals.org/webgl/lessons/webgl-multiple-views.html ; https://webgpufundamentals.org/webgpu/lessons/webgpu-multiple-canvases.html

### GPU-04 Leave `powerPreference` at the default; request only the limits and features that you use
stage: gpu-draw, tasks · metric: frame, startup · when: load, session · impact: medium — the hint picks the GPU on dual-GPU machines, and code tuned to one desktop's limits fails on common hardware · support: baseline, webgpu · also: GPU-01, GPU-29
- Do: Leave `powerPreference` unset (WebGL: `'default'`); ask for `'high-performance'` only when a measurement shows the integrated GPU is the limit, and then handle loss (GPU-29). WebGL: read limits and extensions once at init into a plain object, fix attribute locations with `layout(location = N)`, and store uniform locations after linking. WebGPU: read `adapter.limits` and `adapter.features`, pass only what the app needs as `requiredLimits` and `requiredFeatures`, and keep a path for each optional feature.
- Why: A high-performance context or adapter can cost battery life, and user agents are more likely to lose it to switch GPUs. A device created without requests gets the spec's default limits, so code that asks for "everything the adapter has" passes on a desktop and fails on a phone. `getParameter()`, `getExtension()` and `getUniformLocation()` can each cost a round trip to the GPU process.
- Detect: `powerPreference:\s*['"]high-performance`; `rg -n 'getUniformLocation\(|getAttribLocation\(|getParameter\(|getExtension\(' -g '*.{ts,js}'` inside draw or frame functions; `requiredLimits:\s*adapter\.limits`.
- Verify: measure.md#gpu. Pass: `__wpProbe.env()` names the expected GPU, and a dev build that counts `getParameter` and `getUniformLocation` calls reads 0 during the `pan` scenario.
- Avoid: On Windows, Chrome gives WebGPU the same adapter as the rest of the browser, so the hint changes nothing there; on dual-GPU Macs on AC power, unset and `'low-power'` differ. `failIfMajorPerformanceCaveat: true` still flags a slow path, but the retry without it can now return `null` too (GPU-01). Plan for `MAX_TEXTURE_SIZE` 4096, which every reported WebGL2 device has; the maximum is not a promise of memory.
- Source: https://registry.khronos.org/webgl/specs/latest/1.0/#WEBGLCONTEXTATTRIBUTES ; https://webgpufundamentals.org/webgpu/lessons/webgpu-limits-and-features.html

## §B Shaders and pipelines

### GPU-05 Create GPU objects at load or on data change, never in the frame loop
stage: tasks, gpu-draw, memory · metric: frame, INP · when: render-loop · impact: high — every create call goes to the GPU process and some compile or validate, so a create per frame makes every frame slower · support: baseline, webgpu · also: GPU-06, GPU-07, GPU-30
- Do: Create buffers, textures, programs, VAOs, framebuffers, samplers, pipelines and bind groups at load, a few frames before first use, or when data or size changes. In the frame, only bind, update contents and draw. WebGL: build one VAO per vertex layout and one framebuffer per render target at setup, and switch each with one bind. WebGPU: reuse render pass descriptors and change only the `view`; create per-frame bind groups only for external (video) textures.
- Why: WebGL validates every call and sends it to a separate GPU process; VAOs and framebuffers that do not change let the browser cache that validation. A WebGPU pipeline compiles shaders and a bind group is validated at creation, so creating them per frame moves that cost into every frame.
- Detect: `rg -n -A25 'requestAnimationFrame\(|function (draw|render|frame)\w*\(' -g '*.{ts,js}' | rg 'create(Buffer|Texture|Program|Shader|VertexArray|Framebuffer|Sampler|BindGroup|RenderPipeline|ShaderModule)\('`; `vertexAttribPointer\(` or `framebufferTexture2D\(` inside draw functions.
- Verify: measure.md#fps with the `pan` scenario. Pass: an app counter of created GPU objects in `window.__perf.counters()` stays flat during `pan`, and frame p95 wins or stays neutral.
- Avoid: Deleting a resource right after a draw that used it can stall the pipeline: delete between frames (GPU-30). Keep a small pool for objects that you recycle often (ring buffers, readback buffers). Per-series differences (color, width, offset) go in uniforms or storage buffers, not in new pipelines (GPU-07).
- Source: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html

### GPU-06 Compile and link without blocking: batch status checks, poll completion, warm up early
stage: tasks, gpu-draw · metric: startup, INP · when: load · impact: high — a status query right after each compile waits for that compile and stops the browser from compiling in parallel · support: khr-parallel-shader-compile, webgpu · also: GPU-05
- Do: WebGL: call `compileShader()` for every shader, then `linkProgram()` for every program, and only then read `LINK_STATUS`; read shader logs only when a link fails. With `KHR_parallel_shader_compile`, poll `COMPLETION_STATUS_KHR` once per frame and draw a series only when its program is ready. WebGPU: create every pipeline that a view can need with `createRenderPipelineAsync()` or `createComputePipelineAsync()` during load, cache the promise by a key, and draw only with resolved pipelines. Start while data downloads, and finish before the first interaction.
- Why: Many browsers compile and link on background threads, but a status query is synchronous and waits for the result. A pipeline created synchronously can stall the device at its first use, while the async variant does not block queue work.
- Detect: `rg -n -A2 'compileShader\(' -g '*.{ts,js}' | rg 'COMPILE_STATUS'`; `LINK_STATUS` read right after each `linkProgram`; `createRenderPipeline\(` (sync) outside setup; programs linked on the first use of a feature.
- Verify: measure.md#start, then measure.md#inp for the first use of each series type. Pass: trace-summary shows no long task from compile or link calls, and the first interaction's processing time wins.
- Avoid: Without the extension, the first status query blocks; the batch order still lets the driver work in parallel. Total compile time stays about the same: the gain is responsiveness. While the context is lost, completion queries return `true`, so check `isContextLost()` before you report a link error. The async pipeline promise rejects with `GPUPipelineError`: catch it. Keep the number of program variants small.
- Source: https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/ ; https://gpuweb.github.io/gpuweb/#dom-gpudevice-createrenderpipelineasync

- **GPU-07** Reuse shader modules and pipelines: key each pipeline by the state that really differs (topology, blend, target format, sample count, vertex layout), keep per-series values (color, width, offsets) in uniforms or storage buffers, and specialize with WGSL `override` constants or generated WGSL text; each distinct override set is one more pipeline to compile, so keep the set bounded and the generated text stable, so that a browser compile cache can hit. [gpu-draw, tasks · frame, startup · medium] https://toji.dev/webgpu-best-practices/dynamic-shader-construction

## §C Buffers and data types

### GPU-08 Allocate buffers once with headroom, and upload only the changed byte range
stage: gpu-upload, memory · metric: frame, memory · when: render-loop, session · impact: high — recreating storage per update allocates, zero-fills and revalidates, and re-sends bytes that did not change · support: baseline, webgpu · also: GPU-09, GPU-12
- Do: Size each buffer for the expected window plus headroom, and double it when it is full. Upload only the range that changed, from typed arrays that you reuse. WebGL: `bufferData(target, capacityBytes, usage)` once, then `bufferSubData(target, dstByteOffset, src, srcOffset, length)`, also when most of the buffer changes. WebGPU: sizes are fixed, so grow by creating a larger buffer (with `COPY_SRC | COPY_DST` in its usage), `copyBufferToBuffer()` the used bytes, rebuild the bind groups that pointed at the old buffer, and `destroy()` it.
- Why: Storage created without data must be zero-filled, so a `bufferData(size)` per update pays an allocation and a clear before your data arrives. The WebGL2 `srcOffset` and `length` overloads upload part of a typed array without a new view, so the frame allocates nothing.
- Detect: `rg -n 'bufferData\(' -g '*.{ts,js}'` in update or frame functions; `new (Float32|Uint16|Uint32)Array\(` or `\.subarray\(` inside the frame loop; `device\.createBuffer\(` in append or message handlers.
- Verify: measure.md#fps with the `stream` scenario at the peak rate of the chart contract, then measure.md#mem. Pass: bytes uploaded per frame (an app counter) follow the new points, not the series size; frame p95 wins; the heap stays flat.
- Avoid: In the WebGL2 overloads, `srcOffset` and `length` count elements of the typed array, while `dstByteOffset` counts bytes. Do not shrink eagerly. Never pass a view of a resizable `ArrayBuffer` (for example Wasm memory from `toResizableBuffer()`) to `writeBuffer()`: it throws; copy into a fixed-length buffer first.
- Source: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu

### GPU-09 Stream appended points into a ring region; alternate 2–3 buffers instead of orphaning
stage: gpu-upload, gpu-draw · metric: frame, memory · when: render-loop, session · impact: high — shifting a full buffer to append one point re-uploads the whole series on every update · support: baseline · also: GPU-08, GPU-28
- Do: For append-only data (a live sensor series, a log timeline), preallocate a capacity, write new points at the head with one sub-range upload per frame (WebGPU: `writeBuffer()` at the head offset), and draw the valid window as up to two ranges or as one range with an offset uniform. Keep a CPU mirror of the ring in a typed array for hit tests and rebuilds. For data that you rewrite completely every frame, keep 2–3 buffers of the same size and fill one while the GPU reads another.
- Why: Each frame then uploads bytes in proportion to the new points only. The native-GL "orphaning" idiom (`bufferData(size)`, then fill) becomes a zero-filled allocation in WebGL, and browser engineers advise alternating buffers instead.
- Detect: `rg -n 'copyWithin\(|\.shift\(\)|\.splice\(0' -g '*.{ts,js}'` on arrays that feed `bufferSubData` or `writeBuffer`; `bufferData\(` called before each fill of the same buffer.
- Verify: measure.md#fps with `stream` for 10 s at the peak rate, 5 runs each side. Pass: compare-runs verdict "win" on frame p95, and upload bytes per frame stay flat while the series grows.
- Example:
  ```ts
  const FLOATS = 2;                                  // x, y per point (float32 offsets: GPU-14)
  export function appendPoints(xy: Float32Array) {   // xy.length is a multiple of FLOATS
    let left = xy.length / FLOATS, src = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, ring);
    while (left > 0) {                               // at most two writes: to the end, then from 0
      const run = Math.min(left, capacity - head);
      gl.bufferSubData(gl.ARRAY_BUFFER, head * FLOATS * 4, xy, src * FLOATS, run * FLOATS);
      head = (head + run) % capacity; src += run; left -= run;
    }
    count = Math.min(capacity, count + xy.length / FLOATS);
  }
  // Draw: oldest = (head - count + capacity) % capacity; one range to the end, one from 0.
  ```
- Avoid: A line strip across the wrap point needs two draws or a repeated boundary point. Extra buffers multiply memory, so rotate only full per-frame rewrites. Keep index buffers static (GPU-11).
- Source: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; https://groups.google.com/g/webgl-dev-list/c/vMNXSNRAg8M

- **GPU-10** Split vertex data by change rate: template geometry and history chunks in `STATIC_DRAW` buffers, per-frame values in separate `DYNAMIC_DRAW` buffers (not `STREAM_DRAW`), interleave only the attributes that change together, and pass per-series constants as uniforms or constant attributes, not per vertex; use `*_READ` hints only for buffers that you read back, because they can keep a shadow copy. [gpu-upload · frame, memory · medium] https://emscripten.org/docs/optimizing/Optimizing-WebGL.html

### GPU-11 Use the smallest vertex and index types that keep enough precision
stage: gpu-upload, gpu-draw, memory · metric: frame, memory · when: load, render-loop · impact: medium — upload bytes and vertex fetch bandwidth grow with the bytes per vertex · support: baseline, webgpu · also: GPU-14, GPU-16
- Do: Colors: 4 normalized bytes (WebGL `UNSIGNED_BYTE` with `normalized: true`; WebGPU `unorm8x4`), not 4 floats. Bounded values (0–1 ratios, texture coordinates): normalized `UNSIGNED_SHORT` or half floats. Ids and series indices: integer attributes (`vertexAttribIPointer`; WebGPU `uint32`). Positions and time offsets stay float32 (GPU-14). Start each attribute at a 4-byte-aligned offset. Use `Uint16Array` indices below 65,535 vertices, and keep index buffers static.
- Why: A color in 4 bytes instead of 16 cuts upload size and vertex-fetch traffic for every vertex. Browsers check index ranges on the CPU and cache the result, so an index buffer that changes per frame pays the check again (an inference from browser engineers' comments).
- Detect: `rg -n "vertexAttribPointer\([^)]*gl\.FLOAT" -g '*.{ts,js}'` on color attributes; `format:\s*'float32x4'` on colors; `new Uint32Array\(` for small index buffers; `ELEMENT_ARRAY_BUFFER` uploads in update paths.
- Verify: measure.md#fps with `pan` at the maximum points of the chart contract, then measure.md#mem. Pass: frame p95 wins or stays neutral, and the GPU buffer bytes in the app counters drop.
- Avoid: Half floats keep about 3 significant digits: never use them for coordinates, timestamps or sums. In WebGL2 the maximum index value always means primitive restart. Offsets and strides must be multiples of the type size, and a WebGL stride is at most 255 bytes.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/vertexAttribPointer ; https://webgpufundamentals.org/webgpu/lessons/webgpu-vertex-buffers.html

- **GPU-12** WebGPU uploads: use `queue.writeBuffer()` by default (the buffer offset and size are multiples of 4, and typed-array offsets count elements), create static buffers with `mappedAtCreation: true` and fill `getMappedRange()` directly, and add a ring of `MAP_WRITE | COPY_SRC` staging buffers only when a trace shows upload as the limit; for small texture updates use `writeTexture()`, which needs no 256-byte row alignment, unlike `copyBufferToTexture()`. [gpu-upload · frame · medium] https://toji.dev/webgpu-best-practices/buffer-uploads

### GPU-13 Upload before the first visible frame, and at the start of each frame before any draw
stage: gpu-upload, tasks · metric: frame, startup · when: load, render-loop · impact: medium — an upload in the middle of a pass adds hidden conversion draws and flushes, and a first-use upload lands as a hitch on the first frame · support: baseline · also: GPU-24, GPU-26
- Do: Upload textures and geometry during load, before the view first shows them. In each frame, run all texture and buffer uploads first (one upload queue per frame), then bind programs and draw. Split very large images into tiles, or upload a few rows per frame with `texSubImage2D()`. Upload a video frame only when a new frame exists (`requestVideoFrameCallback()`).
- Why: A `texImage2D()` from an image, canvas or video can run an internal draw with its own program (flip, color conversion, premultiply), which splits your pass and flushes the pipeline. webgl2fundamentals traced a load-time jank to `texImage2D()`, not to image decoding.
- Detect: `rg -n 'tex(Sub)?Image2D\(|copyExternalImageToTexture\(|writeTexture\(' -g '*.{ts,js}'` between draw calls of one frame function, or in pointer handlers.
- Verify: measure.md#fps with the `zoom` scenario (labels change), then measure.md#start. Pass: frame p95 wins or stays neutral, and the longest frame after load (the `__wpProbe.frame` maximum gap) drops.
- Avoid: `ImageBitmap` sources can skip a second decode, but webgl2fundamentals still saw jank with them: measure before you promise a gain (GPU-26). "Before the first frame" means during load, not a blocking loop that delays the first paint.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-how-to-load-images-in-the-background-with-no-jank.html

### GPU-14 Never put raw Unix-millisecond timestamps in float32: subtract a float64 origin first
stage: gpu-upload, gpu-draw · metric: frame · when: load, render-loop · impact: high — float32 has 24 significand bits, so current epoch-millisecond times snap to steps of about two minutes, and points jump or merge · support: n/a · also: GPU-15, GPU-11
- Do: Keep times as float64 JS numbers. For each data chunk, choose a float64 origin (for example its first time), store `time - origin` in the `Float32Array`, and keep chunks short enough that the offsets stay precise at the deepest zoom (within one day of the origin, the float32 step is 8 ms). Apply the same rule to any large value used as a coordinate (cumulative counters, ids). WGSL has no f64 and GLSL `highp float` is float32, so WebGPU needs the same rule.
- Why: Near current epoch-millisecond values, adjacent float32 values are 131,072 ms apart (arithmetic checked in the WebGL notes).
- Detect: `rg -n 'Float32Array' -g '*.{ts,js}'` in files that also read `Date.now|getTime\(\)|timestamp`, then check for an origin subtraction; `uniform1f\([^)]*(time|Time|start|Start)` fed with raw epoch values.
- Verify: measure.md#fps with `zoom` to the deepest zoom that the chart contract allows. Pass: a `take_screenshot` at DPR 2 shows evenly spaced points with no clumps or steps, and a unit test finds every `Math.fround(t - origin) + origin` within one pixel's time of `t`.
- Example:
  ```ts
  // Before: xs[i] = times[i];                     // snaps to steps of about 131 s
  // After: small offsets from a float64 origin per chunk
  const origin = times[first];                     // float64 JS number
  for (let i = first; i < last; i++) xs[i - first] = times[i] - origin;
  chunk.originMs = origin;                         // stays in JS; the shift uniform uses it (GPU-15)
  ```
- Avoid: Subtracting the view start in the shader does not help once the attribute has lost the bits. Values of moderate size (sensor readings, percentages) are usually fine in float32; very small steps on large magnitudes need the same origin trick. Never use half floats for time.
- Source: https://help.agi.com/AGIComponents/html/BlogPrecisionsPrecisions.htm ; https://gpuweb.github.io/gpuweb/wgsl/#floating-point-types

### GPU-15 Transform relative to the visible origin; split high and low floats for extreme ranges
stage: gpu-draw, js · metric: frame · when: render-loop, interaction · impact: high — at deep zoom a large translation in a float32 uniform quantizes every vertex, so lines jitter while the view pans · support: n/a · also: GPU-14, GPU-28
- Do: On the CPU, compute `chunk.originMs - view.startMs` in float64 and pass the small result as a uniform; the vertex shader computes `(a_offset + u_shift) * u_pxPerUnit`. When one draw spans a range too large for that, store each value as a high and a low float32 (`hi = Math.fround(v)`, `lo = Math.fround(v - hi)`) and subtract a high/low view origin in the shader: `(a_hi - u_viewHi) + (a_lo - u_viewLo)`.
- Why: The float64 subtraction on the CPU removes the large common part before anything becomes float32, so the GPU sees only small numbers. The high/low split carries the bits that one float32 drops; globe and game engines use it for the same problem.
- Detect: `rg -n 'uniform(Matrix)?[1-4]f.*(origin|start|offset|translate)' -g '*.{ts,js}'` where the value is a raw epoch time or a large coordinate; shader code that subtracts a view origin from a raw attribute.
- Verify: measure.md#fps with `pan` at the deepest zoom that the chart contract allows. Pass: two screenshots one pan step apart show lines that move by whole pixels with no jitter, and frame p95 stays neutral.
- Avoid: The split doubles the position bytes. A shader compiler may reorder the subtraction: check on the target GPUs. Re-base the origin when the user pans far from it.
- Source: https://help.agi.com/AGIComponents/html/BlogPrecisionsPrecisions.htm ; https://godotengine.org/article/emulating-double-precision-gpu-render-large-worlds/

- **GPU-16** Use `highp` for positions and for anything derived from pixels, distances or time, and `mediump` only for colors, 0–1 coverage and other small ranges: `mediump` can be float16 (range ±16,384, about 3 decimal digits), and desktop GPUs run it as `highp`, so the bug shows only on some mobile GPUs; declare float data samplers `highp sampler2D`, also in vertex shaders, where samplers default to `lowp`. [gpu-draw · frame · medium] https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices

## §D Draw submission

### GPU-17 Draw repeated marks with instancing: one template, one record per mark, one draw
stage: gpu-draw, gpu-upload · metric: frame, memory · when: render-loop · impact: high — one draw per mark makes the CPU cost grow with the mark count, while instancing keeps it at one call · support: baseline, webgpu · also: GPU-18, GPU-36, CNV-21
- Do: Generate the template shape (a quad) from the vertex index, and put one record per mark (position, value range, color index) in an instance buffer. WebGL: `vertexAttribDivisor(loc, 1)` on the instance attributes, recorded once in a VAO, then `drawArraysInstanced()`. WebGPU: a vertex buffer with `stepMode: 'instance'`, or a `storage` array indexed by `instance_index`, then `draw(verticesPerMark, markCount, 0, firstVisible)`. Draw only the visible range (WebGL: the chunks that overlap the view).
- Why: Every WebGL call is validated and sent to the GPU process, and every WebGPU call is validated, so the call count sets the CPU cost of a frame. Instancing turns thousands of bars, markers or rectangles into one call and one compact record per mark.
- Detect: `rg -n -B3 'draw(Arrays|Elements)\(|\.draw\(' -g '*.{ts,js}'` inside a loop over data points; `uniform[1-4]f` set per mark before a draw.
- Verify: measure.md#fps with `pan` at the maximum mark count of the chart contract. Pass: frame p95 wins beyond noise, and the draw function's script time in `__wpProbe.loaf.read()` drops.
- Avoid: On some GPUs repeated geometry draws as fast as instancing; the sure gains are fewer calls and less memory. Instances of one draw cannot interleave with other draws for sorting; use a storage buffer or a data texture (GPU-36) when order across types matters. WebGPU: a non-zero `firstInstance` in an indirect draw needs the `indirect-first-instance` feature, or the draw does nothing.
- Source: https://webgl2fundamentals.org/webgl/lessons/webgl-instanced-drawing.html ; https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-buffers.html

### GPU-18 Draw thick lines as instanced quads expanded in the vertex shader, never with `lineWidth`
stage: gpu-draw · metric: frame · when: render-loop · impact: high — line primitives are 1 pixel wide on most platforms (always in WebGPU), and 1-pixel primitives get no shader antialiasing · support: baseline, webgpu · also: GPU-17, GPU-22
- Do: Draw each segment as one quad instance. Bind the same point buffer to two per-instance attributes, `a` at offset 0 and `b` at an offset of one point, and draw `pointCount - 1` instances of 4 vertices. In the vertex shader, convert both points to pixels and push the corners along the segment normal by half the width plus 1 pixel; in the fragment shader, fade alpha by the distance from the center line. Markers work the same way: one quad per point, shaped in the fragment shader.
- Why: WebGL implementations may cap line width at 1, so plan for 1, and WebGPU line and point topologies are always 1 pixel. The two-attribute trick reads one buffer twice, so no data is copied.
- Detect: `rg -n 'lineWidth\(|gl\.LINES|gl\.LINE_STRIP|line-list|line-strip|point-list|gl_PointSize' -g '*.{ts,js,glsl,wgsl}'` on data series that are meant to be wider than 1 pixel.
- Verify: measure.md#fps with `pan` at the maximum points of the chart contract. Pass: lines keep the designed width in a `take_screenshot` at DPR 2, and frame p95 meets the frame budget.
- Example:
  ```wgsl
  @vertex fn segment(@builtin(vertex_index) v: u32,
                     @location(0) a: vec2f, @location(1) b: vec2f) -> Out {   // both per instance
    let corner = array(vec2f(0, -1), vec2f(0, 1), vec2f(1, -1), vec2f(1, 1))[v];  // triangle strip
    let pa = toPixels(a); let pb = toPixels(b);
    let dir = normalize(pb - pa);                     // guard zero-length segments before this
    let half = view.halfWidthPx + 1.0;                // 1 extra pixel for the antialiased edge
    let p = mix(pa, pb, corner.x) + vec2f(-dir.y, dir.x) * corner.y * half;
    var out: Out; out.pos = vec4f(pixelsToClip(p), 0.0, 1.0);
    out.across = corner.y * half;                     // distance from the center line, in pixels
    return out;
  }
  ```
- Avoid: Joins need extra geometry (round or miter) or a wider quad with fragment math; plain quads leave small gaps at sharp angles. Guard zero-length segments before `normalize()`. A WebGPU `line-list` or `point-list` pipeline must not set a depth bias.
- Source: https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html ; https://webgpufundamentals.org/webgpu/lessons/webgpu-points.html

### GPU-19 Sort draws by state; share one per-frame uniform buffer; group bindings by update rate
stage: gpu-draw, js · metric: frame · when: render-loop · impact: high — every state call costs validation and a message to the GPU process, also when it changes nothing · support: baseline, webgpu · also: GPU-17, GPU-20
- Do: Order draws by framebuffer, then program or pipeline, then textures and buffers, and skip a bind when the object is already bound. Put per-frame values (view transform, viewport, time origin) in one uniform buffer that every program shares, written once per frame. WebGL: a `layout(std140) uniform Frame { … }` block, `uniformBlockBinding()` at init, one `bufferSubData()` per frame. WebGPU: explicit bind group layouts shared by all pipelines; group 0 per frame, group 1 per series, group 2 per draw; per-draw values in one buffer with a stride of `minUniformBufferOffsetAlignment`, one `writeBuffer()` and dynamic offsets. Clip with scissor rectangles before stencil or alpha masks.
- Why: A renderer that avoids redundant calls by design beats a deep state cache, and the WebGPU spec advises putting the least-changing groups at the lowest indices. In webgpufundamentals' test, one big uniform buffer with offsets, together with the other steps of that lesson, drew about 87% more objects at the same frame rate.
- Detect: `rg -n 'useProgram\(null\)|bindBuffer\([^,]+,\s*null\)|disableVertexAttribArray' -g '*.{ts,js}'` after each draw (a reset to a ground state); the same view uniforms set in several programs per frame; `layout:\s*'auto'` on pipelines that share data; `writeBuffer\(` inside a per-draw loop.
- Verify: measure.md#fps with `pan` and all series visible. Pass: frame p95 wins, and the draw function's script time in `__wpProbe.loaf.read()` drops.
- Avoid: With VAOs, a WebGL state cache gains less: do not build one before a profile shows call overhead. `std140` pads to 16 bytes, so pack uniforms into `vec4`s. A bind group made from a `layout: 'auto'` pipeline works only with that pipeline. Bundles reset bind state, so set shared groups inside each bundle (GPU-20).
- Source: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; https://toji.dev/webgpu-best-practices/bind-groups

### GPU-20 Use multi-draw, render bundles and indirect draws where the draw list repeats
stage: gpu-draw, js · metric: frame · when: render-loop · impact: medium — they cut per-draw CPU work when many series share one program, and they help only a CPU-bound frame · support: webgl-multi-draw, webgpu · also: GPU-19, GPU-21, GPU-38
- Do: WebGL: put many series in one buffer and draw their ranges with one `multiDrawArraysWEBGL()` from `WEBGL_multi_draw`, reading the per-series style by `gl_DrawID`; without the extension, loop over `drawArrays()` with a series-index uniform. WebGPU: record the draws that repeat every frame (grid, axes, every series when only buffer contents change) once into a render bundle and replay it with `executeBundles()`; let a compute pass write draw counts into one shared `INDIRECT | STORAGE` buffer, and call `drawIndirect()` per series at its offset.
- Why: A bundle is validated when it is recorded, so a replay skips most per-command work. On Chrome's D3D12 back end, each distinct indirect buffer adds a hidden validation dispatch: toji measured 412 separate buffers at about 3 ms of a 6 ms pass, and about 10 µs after merging them into one.
- Detect: `rg -n 'draw(Arrays|Elements)\(' -g '*.{ts,js}'` in a loop over series that share one program; `createRenderBundleEncoder\(` inside the frame function; `drawIndirect\(` with a new buffer per series.
- Verify: measure.md#gpu names the frame as CPU-bound, then measure.md#fps with `pan` at the maximum series count. Pass: compare-runs verdict "win" on frame p95.
- Avoid: A bundle cannot set viewport, scissor or blend constant, and it starts and ends with empty pipeline and bind state. Re-recording a bundle every frame gains nothing, and bundles do not help a fill-bound frame. The hidden indirect validation does not show in pass timestamps. Keep the multi-draw argument arrays preallocated.
- Source: https://toji.dev/webgpu-best-practices/render-bundles ; https://toji.dev/webgpu-best-practices/indirect-draws

- **GPU-21** WebGPU: per frame, use one command encoder, one `getCurrentTexture()` per canvas (never kept across frames: a resize or `configure()` invalidates it) and one `queue.submit()`, and encode nothing when nothing is dirty (CNV-02); slice bulk jobs (re-aggregating history, building an index) and `await device.queue.onSubmittedWorkDone()` between slices, never in the frame path, because a queue stuffed with long work delays every frame and can end in a device loss. [js, gpu-draw · frame, INP · medium] https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/onSubmittedWorkDone

## §E Fragment cost

### GPU-22 Keep fragment work small: per-vertex math, no needless blending, `discard` or overdraw
stage: gpu-draw, paint · metric: frame · when: render-loop · impact: high — fragment cost grows with covered pixels times layers, and a fill-bound frame ignores every CPU fix · support: baseline · also: CNV-05, CNV-21, GPU-34
- Do: Compute anything linear across a primitive (colors, texture-coordinate transforms, pixel offsets) per vertex and pass it as a varying; precompute per-draw constants in JS (multiply by `invSpan`, do not divide by `span` per pixel). Use built-ins (`mix`, `smoothstep`, `clamp`, `dot`) and branches that depend on uniforms, not on per-pixel data. Turn blending on only for translucent fills and antialiased edges, prefer coverage alpha to `discard`, draw no full-canvas translucent layer per frame, and reduce marks to about one per pixel column (CNV-21).
- Why: The fragment shader runs once per covered pixel per layer, far more often than the vertex shader, and `discard` and blending remove early depth and bandwidth savings. webgl2fundamentals measured a laptop GPU at about 5 million pixels per frame at 60 fps.
- Detect: `rg -n '\bdiscard\b' -g '*.{glsl,wgsl,frag,ts}'`; `gl\.enable\(gl\.BLEND\)` with no disable for opaque passes; divisions, `pow` or `exp` of uniform values in fragment shaders.
- Verify: measure.md#gpu (a quarter-area canvas, and DPR 1 against DPR 2). Pass: the frame-time drop from the shrink test gets smaller, and frame p95 at DPR 2 wins.
- Avoid: When a series has more vertices than covered pixels, reduce the vertices (decimation) instead of moving work into the fragment stage. Costs differ by GPU: confirm with the shrink test (GPU-34). The DPR and pixel cap is CNV-05.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-the-fastest-way-to-draw-many-circles.html

## §F Textures and text

### GPU-23 Allocate textures once with fixed storage, update regions, and pick formats by use
stage: gpu-upload, memory · metric: memory, frame · when: load, render-loop · impact: medium — mutable texture levels can allocate a full mip chain, and a wrong format wastes bytes or loses filtering · support: baseline, webgpu · also: GPU-24, GPU-35
- Do: WebGL: allocate with `texStorage2D(target, levels, sizedFormat, w, h)` (1 level unless the texture is drawn smaller than its size), then update regions with `texSubImage2D()`; for a data texture (a heatmap), update only the changed rows. Use `RGBA8`, not `RGB8`, and set `TEXTURE_MIN_FILTER` to `LINEAR` or `NEAREST` for 1-level textures. WebGPU: size and format are fixed, so create the texture when the source size is known; `rgba8unorm` for color, `r8unorm` or `r16float` for data that is filtered, `r32float` only with `textureLoad()`.
- Why: With `texImage2D()` each level can change size until draw time, so drivers cannot allocate early, and some allocate the whole mip chain (about 30% more memory). Three-channel formats are often emulated with a hidden fourth channel and extra work.
- Detect: `rg -n 'texImage2D\(' -g '*.{ts,js}'` for textures that change later; `gl\.RGB8?\b` formats; `generateMipmap\(` on UI, label or data textures; `format:\s*'r32float'` with a filtering sampler.
- Verify: measure.md#mem after 10 view changes. Pass: the GPU texture bytes in the app counters match the estimate (width × height × bytes per texel, per level), and they return to baseline after teardown.
- Avoid: A `texStorage2D()` texture cannot change size: a resize means a new texture. Filtering `r32float` needs the optional `float32-filterable` feature, so detect it. WebGPU has no `generateMipmap()`: build mips yourself, and only for textures drawn minified. Count depth and stencil formats as 4 bytes per pixel in budgets.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://webgpufundamentals.org/webgpu/lessons/webgpu-textures.html

### GPU-24 GPU text: rasterize and upload only when a string changes, into dirty atlas sub-rectangles
stage: gpu-upload, paint · metric: frame, memory · when: render-loop · impact: high — re-rasterizing and re-uploading label textures every frame is the most common text cost on GPU charts · support: baseline, webgpu · also: CNV-15, CNV-16, GPU-25
- Do: Keep the last formatted string per label and skip all work when it did not change. Rasterize new glyphs or strings on an `OffscreenCanvas` 2D context into free slots of a preallocated atlas page (with 1–2 pixels of padding against filter bleed), and upload only the dirty rectangle. WebGL: set `UNPACK_SKIP_PIXELS` and `UNPACK_SKIP_ROWS` to the rectangle origin, then `texSubImage2D()` with its size. WebGPU: `copyExternalImageToTexture()` with a source `origin`, a destination `origin`, `premultipliedAlpha: true` and the rectangle size. Keep pages at 4096 × 4096 or smaller, and add pages instead of growing one.
- Why: A 2048 × 2048 RGBA8 page is 16 MiB, so a new glyph that re-uploads the whole page moves 16 MiB instead of a few hundred bytes. Every reported WebGL2 device supports 4096 × 4096 textures, and larger sizes are not universal.
- Detect: `rg -n 'fillText\(' -g '*.{ts,js}'` in a module that also calls `texImage2D|texSubImage2D|copyExternalImageToTexture` in the frame function; a texture per label; a full-atlas upload on every change.
- Verify: measure.md#fps with `zoom`, so labels change. Pass: the label-upload counter in `window.__perf.counters()` rises only in frames where a string changed, and frame p95 wins.
- Example:
  ```ts
  export function uploadDirty(r: { x: number; y: number; w: number; h: number }) {
    if (backend === 'webgl2') {                       // UNPACK_PREMULTIPLY_ALPHA_WEBGL was set once (GPU-26)
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r.x); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, r.y);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    } else {
      device.queue.copyExternalImageToTexture(
        { source: atlasCanvas, origin: [r.x, r.y] },
        { texture: atlasTexture, origin: [r.x, r.y], premultipliedAlpha: true }, [r.w, r.h]);
    }
  }
  ```
- Avoid: A per-glyph atlas loses kerning, ligatures and complex-script shaping; keep such strings as whole-string slots (GPU-25). Text atlases rarely need mipmaps. A DPR change needs the atlas again at the new scale (CNV-06).
- Source: https://registry.khronos.org/webgl/specs/latest/2.0/ ; https://webgl2fundamentals.org/webgl/lessons/webgl-text-glyphs.html

- **GPU-25** Choose the GPU text technique by label set: a glyph atlas drawn with one instanced draw for closed character sets (digits, signs, separators and a few unit letters on axis labels); whole-string atlas slots keyed by text and style, with least-recently-used eviction, for free text, which keeps kerning and complex-script shaping; signed-distance-field glyphs for labels that scale, rotate or need halos, made once per font on an `OffscreenCanvas` with `willReadFrequently: true`, lazily or in a worker; for fixed-size axis text, a bitmap atlas at device resolution is sharper than SDF. [gpu-upload, gpu-draw · frame, memory · medium] https://webgl2fundamentals.org/webgl/lessons/webgl-text-glyphs.html

### GPU-26 Keep uploads premultiplied; set flip and color options when you create the bitmap
stage: gpu-upload · metric: frame · when: load, render-loop · impact: medium — a mismatch between the source and the requested layout adds a conversion per upload, loses precision and shows dark fringes · support: baseline, webgpu · also: CNV-19, GPU-13, GPU-24
- Do: Canvas 2D sources are premultiplied. WebGL: set `UNPACK_PREMULTIPLY_ALPHA_WEBGL` to `true` once, blend with `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`, and output premultiplied colors (`rgb * a`) from the shader. WebGPU: pass `premultipliedAlpha: true` in the copy destination. For images, make the bitmap in the layout that the shader expects (`createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha, colorSpaceConversion: 'none' })`) and upload with default unpack state; set `UNPACK_COLORSPACE_CONVERSION_WEBGL` to `NONE` for images that carry data. Keep upload sources GPU-backed (`willReadFrequently: false`) and upload into 2D textures.
- Why: WebGL ignores the flip and premultiply unpack flags for `ImageBitmap` sources, so the options at creation are the only switch, and un-premultiplying a canvas is lossy. Chromium copies a GPU-backed canvas into a 2D texture on the GPU, and it reads pixels on the CPU for other sources and for 3D or array textures.
- Detect: `rg -n 'UNPACK_(FLIP_Y|PREMULTIPLY_ALPHA|COLORSPACE_CONVERSION)_WEBGL' -g '*.{ts,js}'` next to `ImageBitmap` uploads; `copyExternalImageToTexture\(` without `premultipliedAlpha`; `blendFunc\(gl\.SRC_ALPHA,\s*gl\.ONE_MINUS_SRC_ALPHA\)` with canvas-sourced textures.
- Verify: measure.md#fps with `zoom` (labels upload), and a `take_screenshot` of label edges. Pass: no dark fringes around text, and the draw function's script time in `__wpProbe.loaf.read()` drops or stays neutral.
- Avoid: The WebGL spec contradicts itself on whether the context color-space setting still applies to an `ImageBitmap`, so set `colorSpaceConversion: 'none'` on the bitmap and treat the WebGL setting as possibly applied. Do not pass `imageOrientation: 'none'`: it was renamed to `'from-image'`. A color channel above alpha in premultiplied output composites undefined colors (red can show as green).
- Source: https://registry.khronos.org/webgl/specs/latest/1.0/#TEXIMAGE2D_HTML ; https://gpuweb.github.io/gpuweb/#dom-gpucopyexternalimagedestinfo-premultipliedalpha

- **GPU-35** Ship large static images as KTX2 with Basis Universal and transcode them at load, in a worker, to the best compressed format that `getExtension()` or `adapter.features` reports (ASTC, BC or ETC2), with PNG as the fallback: compressed textures use less GPU memory and sample faster, but they are lossy, unfit for data, and hardware support differs by device. [gpu-upload, memory · memory, startup · low] https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Compressed_texture_formats
- **GPU-36** When per-item data does not fit in attributes (styles, transforms, per-series parameters), put it in an `RGBA32F` or integer texture with `NEAREST` filtering (WebGPU: a storage buffer), read it by item id with `texelFetch()`, and update it with one `texSubImage2D()` per frame; one draw can then render thousands of differently styled items in any order, but texture fetches can be slower than attributes on some GPUs, so measure. [gpu-draw, gpu-upload · frame · medium] https://webgl2fundamentals.org/webgl/lessons/webgl-pulling-vertices.html

## §G Readback and picking

### GPU-27 No synchronous readback in frame or input paths: read through a fence or `mapAsync` later
stage: tasks, gpu-draw · metric: frame, INP · when: render-loop, interaction · impact: high — a CPU `readPixels()` or a state query waits for all earlier GPU work and a round trip to the GPU process · support: baseline, webgpu · also: GPU-28, GPU-33, CNV-14
- Do: Keep `readPixels()` into CPU memory, `getError()`, `getParameter()`, `checkFramebufferStatus()`, `get*InfoLog()` and a `getBufferSubData()` with no fence out of frame loops and input handlers. WebGL2: `readPixels()` into a `PIXEL_PACK_BUFFER`, insert `fenceSync()`, `flush()`, poll `getSyncParameter(sync, SYNC_STATUS)` in later frames, then `getBufferSubData()` into a reused array. WebGPU: copy into a `MAP_READ | COPY_DST` buffer from a small pool, `mapAsync(GPUMapMode.READ, offset, size)` only the bytes that you need, use the result when the promise resolves, and copy it out before `unmap()`.
- Why: The WebGL2 spec calls CPU `readPixels()` blocking and expensive in multi-process browsers, and a sync object never signals in the same frame. A WebGPU map completes only after the GPU work that writes the buffer, so an awaited map inside the frame makes CPU and GPU wait for each other.
- Detect: `rg -n 'readPixels\(|getError\(|checkFramebufferStatus\(|getBufferSubData\(|mapAsync\(' -g '*.{ts,js}'` inside rAF callbacks, draw functions or pointer handlers; `await [^;]*mapAsync` in the frame; `clientWaitSync\(` with a non-zero timeout.
- Verify: measure.md#fps with `pan`, then measure.md#inp for a click that reads back. Pass: trace-summary shows no long task from `readPixels`, `getError` or `getBufferSubData` in the window, and frame p95 wins.
- Example:
  ```ts
  export function requestRead(x: number, y: number, w: number, h: number, done: (px: Uint8Array) => void) {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, packBuf);                 // allocated once with STREAM_READ
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);      // into the buffer: no stall here
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.flush();        // start the GPU work now
    const poll = () => {
      if (gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED) return void requestAnimationFrame(poll);
      gl.deleteSync(sync);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, packBuf);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, scratch, 0, w * h * 4);   // a reused Uint8Array
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); done(scratch);
    };
    requestAnimationFrame(poll);
  }
  ```
- Avoid: The result comes at least one frame late: use it for export, tests or rare picks, not for hover (GPU-28). Only `RGBA` with `UNSIGNED_BYTE` is a guaranteed read format. Never block on `clientWaitSync()` with a timeout: the allowed maximum can be 0. WebGPU: the map offset is a multiple of 8, the size a multiple of 4, and a second map on a buffer that is not unmapped rejects. Prefer results that stay on the GPU (indirect draws, compute to render). Error checks go behind a debug flag (GPU-33).
- Source: https://registry.khronos.org/webgl/specs/latest/2.0/#readpixels ; https://gpuweb.github.io/gpuweb/#dom-gpubuffer-mapasync

### GPU-28 Hit-test on the CPU with cached geometry; pick on the GPU only when no cheap test exists
stage: tasks, js · metric: INP · when: interaction · impact: high — a readback per pointer move stalls every move, while sorted data answers a hit test with a binary search · support: baseline · also: CNV-14, GPU-15, GPU-27
- Do: Convert the pointer to data space with the same float64 transform that the renderer uses, binary-search the sorted x column, and test the nearby points or bars with distance math. Keep that geometry on the CPU (the ring mirror of GPU-09). Use an id-buffer pick only for shapes with no cheap CPU test, and then read 1 × 1 pixel asynchronously (GPU-27), with one frame of delay.
- Why: A pick buffer needs an extra draw plus a readback, and a synchronous readback waits for the GPU inside the handler. A binary search over a sorted column costs O(log n) and never touches the GPU.
- Detect: `rg -n -A12 'pointermove|mousemove' -g '*.{ts,js}' | rg 'readPixels|mapAsync|getBufferSubData'`; a pick framebuffer drawn again on every pointer move.
- Verify: measure.md#inp with a hover sweep over the densest series. Pass: INP processing time wins, and hover results match the drawn marks at the deepest zoom.
- Avoid: The hit-test transform must match the render transform exactly, including the origin shift (GPU-15), or hits land one mark away at deep zoom. Tooltips read the raw data, not the decimated draw data.
- Source: https://webgl2fundamentals.org/webgl/lessons/webgl-picking.html ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices

## §H Loss and teardown

### GPU-29 Handle WebGL context loss and WebGPU device loss, keep the data to rebuild, and test both
stage: gpu-upload, memory · metric: frame, memory · when: session · impact: high — GPU resets, driver updates, GPU switches and context eviction all lose the context, and an unhandled loss leaves a frozen or black chart with no error · support: baseline, webgpu · also: GPU-01, GPU-30, CNV-23
- Do: Keep every uploaded source (or a way to regenerate it) in JS, and create all GPU objects through one `createGpuResources(model)` function. WebGL: on `webglcontextlost`, call `preventDefault()`, stop the loop and drop all GL object references; on `webglcontextrestored`, get the extensions again, rebuild everything and draw once. WebGPU: attach `device.lost.then(…)` right after creation without awaiting it; unless the reason is `'destroyed'`, request a new adapter (never reuse one) and a new device, `configure()` the same canvases, rebuild, and watch the new device too.
- Why: After a loss, every old GPU object is invalid, and WebGL objects created while lost are not `null` but already invalid, so code that caches objects or hangs state on them breaks. `requestDevice()` consumes an adapter, and adapters can also expire, so a new device needs a new adapter.
- Detect: `rg --files-without-match 'webglcontextlost' $(rg -l "getContext\(\s*['\"]webgl2?['\"]" -g '*.{ts,js}')`; `rg --files-without-match '\.lost' $(rg -l 'requestDevice\(' -g '*.{ts,js}')`; typed arrays dropped right after upload with no way to rebuild.
- Verify: measure.md#mem with a loss test: `gl.getExtension('WEBGL_lose_context').loseContext()`, then `restoreContext()`, 5 times; for WebGPU, crash the GPU process once with `about:gpucrash` in another tab. Pass: each time the chart draws the same data again, and the context, buffer and texture counters return to baseline.
- Example:
  ```ts
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();                                           // without it, no restore event comes
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; gpu = null;                                     // every GL object is invalid now
  }, { signal });
  canvas.addEventListener('webglcontextrestored', () => { gpu = createGpuResources(gl, model); invalidate('data'); }, { signal });
  function watchDevice(device: GPUDevice) {
    device.lost.then(async (info) => {
      if (info.reason === 'destroyed' || signal.aborted) return;  // our own teardown
      const next = await initWebGpu(canvases);                    // new adapter and device, configure()
      if (next) { rebuild(next, model); watchDevice(next); } else switchToWebGl();
    });
  }
  ```
- Avoid: On a 2D canvas, `preventDefault()` on `contextlost` does the opposite: it cancels the restore (CNV-23). Freeing typed arrays after upload saves memory but makes a rebuild impossible. Chrome stops giving adapters to a page after repeated GPU-process crashes, so a loss loop must end in the WebGL or Canvas 2D path (GPU-01); two test crashes close together can already trigger that block (support.md §C).
- Source: https://registry.khronos.org/webgl/specs/latest/1.0/#CONTEXT_LOST ; https://toji.dev/webgpu-best-practices/device-loss

### GPU-30 On destroy, stop the loop, free GPU objects outside the frame, and release the context
stage: memory, gpu-draw · metric: memory, frame · when: session · impact: high — garbage collection does not see GPU memory, and a dead context keeps its memory and a live-context slot until it is collected · support: baseline, webgpu · also: GPU-03, GPU-29, CNV-24
- Do: In the owner's teardown, stop the loop and observers first; then delete buffers, textures, programs, VAOs and framebuffers between frames, and spread a large teardown over several frames. WebGL: last, call `gl.getExtension('WEBGL_lose_context')?.loseContext()` and drop the canvas, which cannot host a new context. WebGPU: `destroy()` each buffer and texture that you drop (also when a buffer grows or a view closes), and `device.destroy()` when the whole renderer unmounts. Track the bytes of every GPU resource against a per-window-pixel budget (CNV-05).
- Why: One WebGPU object can hold megabytes in the GPU process without any JS memory pressure, so a collection may never come. Chrome restores a context that it evicted at the live-context cap only when another context is collected, so an explicit loss frees the slot at once.
- Detect: `rg --files-without-match 'loseContext|delete(Buffer|Texture|Program|VertexArray|Framebuffer)|\.destroy\(\)' $(rg -l "getContext\(\s*['\"](webgl2?|webgpu)['\"]|requestDevice\(" -g '*.{ts,js,svelte,vue}')`; teardown that deletes resources inside the last rAF callback.
- Verify: measure.md#mem: mount and unmount the chart view 10 times. Pass: live contexts, the GPU buffer and texture counters, and the canvas count in `__wpProbe.memory.sample()` return to baseline, and no "Too many active WebGL contexts" warning appears.
- Avoid: Deleting a resource right after a draw that used it can flush the pipeline: delete it in the next frame. Destroying hundreds of objects in one frame freezes that frame: spread it. Do not add an `unload` handler only to lose contexts. Using a destroyed WebGPU object is a validation error, so drop the references too.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://gpuweb.github.io/gpuweb/explainer/#early-destroy

- **GPU-31** Do not store attachments that nobody reads: WebGL2: `invalidateFramebuffer()` for depth, stencil and MSAA attachments after their last use (for example after the `blitFramebuffer()` resolve); WebGPU: `loadOp: 'clear'` and `storeOp: 'discard'` on depth and MSAA attachments, one reused 4× MSAA texture resolved into the canvas once per frame, and `TRANSIENT_ATTACHMENT` usage where it exists, which requires `clear` and `discard` (support.md: `webgpu-transient-attachment`); on tile-based mobile and Apple GPUs this saves the write-back of every tile. [gpu-draw, memory · frame, memory · medium] https://gpuweb.github.io/gpuweb/#enumdef-gpuloadop

## §I Profiling

- **GPU-32** Time GPU passes in development builds with `EXT_disjoint_timer_query_webgl2` (read a result in a later frame, when `QUERY_RESULT_AVAILABLE` is true and `GPU_DISJOINT_EXT` is false) or with WebGPU `timestampWrites` (feature `timestamp-query`; Chrome rounds the values), average them, drop negative or disjoint values, and time JS encoding apart with `performance.now()`; CPU timers around GPU calls measure submission, not GPU time, `gl.finish()` does not wait (GPU-44), and timestamps can disagree with throughput, so confirm a win with frame times (support.md: `webgl-timer-query`, `webgpu-timestamp-query`). [gpu-draw · frame · medium] https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html

- **GPU-33** Ship with zero WebGL and WebGPU errors: fail dev and CI runs on WebGL console errors, call `getError()` only behind a debug flag, wrap WebGPU resource and pipeline creation in `pushErrorScope()`/`popErrorScope()` with no `await` between them and never await a pop inside the frame, listen for `uncapturederror` once (it fires in workers too) and log again, and give every GPU object and debug group a `label`; browsers stop reporting after many errors, and "lazy initialization" warnings are information, not a reason to upload zeros. [tasks · frame · medium] https://toji.dev/webgpu-best-practices/error-handling

### GPU-34 Find the limit before you optimize: shrink the canvas, zero the draws, test weak GPUs
stage: gpu-draw, js · metric: frame · when: render-loop · impact: high — CPU, vertex and fragment limits need opposite fixes, and a fix for the wrong one adds code with no gain · support: n/a · also: GPU-22, GPU-32, CNV-05
- Do: Before a GPU change, name the limit. Draw into a canvas or framebuffer of a quarter of the area: a large gain means fill-bound. Then set the draw counts to 0: still slow means CPU-bound (JS or API calls), fast means vertex-bound. Fix that rung of the §0 ladder. Test on an integrated-GPU laptop and on a phone, not only on the development desktop, and check the no-GPU path once (GPU-01).
- Why: A top desktop GPU can be about 100× faster than a low-end one, and desktops run `mediump` as `highp`, so both speed and precision bugs hide on the development machine. GPU work is pipelined, so a CPU profile often blames the wrong call.
- Detect: `rg -n 'getContext\(|requestAdapter\(' -g '*.{ts,js}'` in modules whose tests never record the renderer; a GPU performance claim in a plan or PR with no named limit.
- Verify: measure.md#gpu. Pass: the report names the limit (fill, vertex or CPU) with the frame-time numbers of each step, and `__wpProbe.env()` shows a hardware renderer, not SwiftShader.
- Avoid: Lab CPU throttling slows the main thread, not the GPU, so throttled frame times for GPU-heavy views are a lower limit: mark them "needs a real-device check". A software renderer gives functional results only: never report its frame times. Read GPU and frame tracks from a saved trace file, not from the MCP text summary (measure.md).
- Source: https://webgl2fundamentals.org/webgl/lessons/webgl-qna-a-simple-way-to-show-the-load-on-the-gpu-s-vertex-and-fragment-processing-.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html

## §J WebGL2 → WebGPU: what changes

Port by restructuring, not call by call: a one-to-one port can be slower. Compare fairly: the same GPU (`powerPreference` in both, checked through `adapter.info` and `WEBGL_debug_renderer_info`), the same antialiasing, depth, alpha mode, `preserveDrawingBuffer: false` and DPR.

| Area | WebGL2 | WebGPU | Write this | Rules |
|---|---|---|---|---|
| State | global and mutable; validated per call | immutable pipelines and bind groups | pipelines and layouts at load; bindings grouped by rate | GPU-05, GPU-19 |
| Shader compile | sync status queries; poll with `KHR_parallel_shader_compile` | `createRenderPipelineAsync()` | compile at load; never wait in a frame | GPU-06 |
| Errors | `getError()` round trip | error scopes, `uncapturederror` | no error polling per frame | GPU-33 |
| Canvases | one context per canvas; small live-context cap | one device, many canvases | one shared context or device | GPU-03 |
| Defaults | depth, MSAA and premultiplied alpha on | opaque, single-sample, no depth | make MSAA and depth yourself; choose `alphaMode` | GPU-02, GPU-31 |
| Buffers, textures | resizable (`bufferData`, `texImage2D`) | fixed size, usage and format | preallocate; grow by copy; `destroy()` | GPU-08, GPU-23 |
| Uploads | `bufferSubData`, `texSubImage2D` | `writeBuffer`, `writeTexture`, `copyExternalImageToTexture` | changed ranges only | GPU-08, GPU-12 |
| Per-frame values | `std140` uniform block | uniform buffer, bind groups, dynamic offsets | one write per frame | GPU-19 |
| Mipmaps | `generateMipmap()` | none built in | your own mip pass, or no mips | GPU-23 |
| Compute | none | compute shaders, storage buffers | decimation and culling on the GPU | GPU-38 |
| Repeated draws | issued again each frame | render bundles, indirect draws | record once; change buffer contents | GPU-20 |
| Lines and points | 1-pixel lines in practice; sized points | 1-pixel lines and points only | instanced quads | GPU-18 |
| Clip space | z −1…1; framebuffer y up | z 0…1; framebuffer y down | adjust projection and viewport math | — |
| Readback | `readPixels` (sync) or pack buffer + fence (async) | `mapAsync` | async, a frame later | GPU-27 |
| Loss | `webglcontextlost` and `webglcontextrestored` | `device.lost`; a new adapter and device | rebuild from JS data | GPU-29 |
| Precision | `highp float` is float32 | `f32` (optional `f16`), no f64 | a float64 origin on the CPU | GPU-14 |

## §K One-line rules

- **GPU-37** Before you render to, filter or blend float textures, check support once at setup: WebGL2 needs `EXT_color_buffer_float` to render to float (fall back to `EXT_color_buffer_half_float`), `OES_texture_float_linear` to filter float32 (else `NEAREST` plus `texelFetch()`), and `EXT_float_blend` to blend into float32; prefer `RGBA16F` targets, whose blending always works, and run `checkFramebufferStatus()` at setup, never per frame. [gpu-draw · frame · medium] https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
- **GPU-38** WebGPU: prepare large series on the GPU: upload raw samples once, and on pan or zoom run a compute pass that writes the minimum and maximum per pixel column (and the indirect draw counts) into a `STORAGE | VERTEX` buffer, which the render pass in the same encoder reads with no readback; start with `@workgroup_size(64)`, reduce in `var<workgroup>` memory instead of one global atomic per element, and keep a CPU path for small windows, because one GPU thread alone is slow. [gpu-draw, gpu-upload · frame, INP · medium] https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram.html
- **GPU-39** Use WGSL `f16` (feature `shader-f16`) only for bandwidth-bound data that tolerates about 3 significant digits (colors, normalized intensities), never for coordinates, time or sums, and use `subgroupMin()`/`subgroupMax()` (feature `subgroups`) only behind detection with a workgroup-memory fallback, because subgroup sizes differ by GPU (support.md: `webgpu-shader-f16`, `webgpu-subgroups`). [gpu-draw · frame, memory · low] https://gpuweb.github.io/gpuweb/#shader-f16
- **GPU-40** For a few bytes of per-draw data (a series index, a style index), use WGSL immediates (`var<immediate>`, `immediateSize` in the pipeline layout, `setImmediates()` before each draw) when `navigator.gpu.wgslLanguageFeatures.has('immediate_address_space')`, and keep the uniform-buffer path otherwise: this removes a buffer write and a bind-group change per draw, every used byte must be set, and bundles and new passes reset them (support.md: `webgpu-immediates`). [gpu-draw · frame · low] https://webgpufundamentals.org/webgpu/lessons/webgpu-immediates.html
- **GPU-41** Lay out host data by the WGSL alignment rules: order struct members from large to small, avoid `vec3f` in arrays (it aligns to 16 bytes), remember the 16-byte array stride in uniform buffers, and compute offsets with one helper or one checked table instead of by hand, because a misaligned struct reads wrong data with no error. [gpu-upload · memory · medium] https://webgpufundamentals.org/webgpu/lessons/webgpu-memory-layout.html
- **GPU-42** For video, call `device.importExternalTexture({ source })` and create its bind group in the same task as the draw, and never put external textures in render bundles: a texture from a video element expires when the task ends, and one from a `VideoFrame` lives until the frame is closed; in WebGL, upload a video frame only when `requestVideoFrameCallback()` reports a new one. [gpu-upload · frame, memory · low] https://gpuweb.github.io/gpuweb/#gpuexternaltexture
- **GPU-43** Avoid emulation paths in WebGL: keep attribute 0 enabled as an array (bind the position to location 0), and when you use `flat` varyings and `WEBGL_provoking_vertex` exists, switch to the first-vertex convention; both remove work that the browser adds on desktop GL, D3D or Metal back ends. [gpu-draw · frame · low] https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
- **GPU-44** Draw from `requestAnimationFrame`; when you draw from another callback (a worker message with no frame loop), call `gl.flush()` at the end so that the queued commands start, and never use `gl.finish()` to wait for the GPU, because Chrome runs it as a flush. [gpu-draw · frame · low] https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
