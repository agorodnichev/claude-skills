# Verify: 11-gpu-webgpu.md

Checked on 2026-09-23 against these sources:
- webstatus.dev (live API)
- MDN browser-compat-data 8.1.2 (2026-09-17). This is the latest npm release; the copy is in `raw/verify/02/bcd.json`, and the query helper is `raw/verify/11/b.py`.
- web-features 3.39.0
- the gpuweb Editor's Draft and the WGSL Editor's Draft (both 21 Sept 2026)
- chromestatus.com (live API)
- every "What's New in WebGPU" post, Chrome 113 to 153-154
- WebKit: the Safari 27.0 feature post (Sept 17 2026) and `HardwareCapabilities.mm` on main, with its commit history
- MDN Firefox release notes 141-157
- Mozilla Bugzilla (live)
- the gpuweb Implementation-Status wiki (live copy, same as the researcher's saved copy)

All 83 source URLs cited in the notes return HTTP 200. The only exception is the BCD directory prefix `https://bcd.developer.mozilla.org/bcd/api/v0/current/`, which is not a page.
Raw evidence fetched for this check is in `raw/verify/11/`. The researcher's saved copies of the primary sources are in `raw/gpu-webgpu/`.

**Summary: 50 items checked. 31 verified, 18 corrected, 1 disputed, 0 unverified.**

Most important corrections:
1. `uncapturederror` does fire in workers. The current spec exposes `GPUUncapturedErrorEvent` on `(Window, Worker)`. The 2019 design doc that the notes cite is out of date.
2. Immediates shipped **by default** in Chrome 150 (chromestatus ship stage 150, `flag: false`). They are not behind a flag. "Experimental" is only a BCD status label.
3. WGSL `@align(n)`: n must be a **multiple** of `RequiredAlignOf`. It does not "divide" it. The notes copied a wording error from the Chrome 133 post.
4. Subgroup sizes are powers of two in **[4, 128]**, not 16-64. `subgroup-size-control` shipped in **Chrome 152**.
5. Safari 27.0 (released Sept 17 2026) supports `clip-distances`, so "Chrome only" is out of date. WebKit also exposes `float32-filterable` and `texture-compression-bc` on capable Apple GPUs, although BCD says it does not.
6. WebGL does have async shader compile (`KHR_parallel_shader_compile`) and async readback (PBO + `fenceSync`). This conflicts with 10-gpu-webgl.md.

---

### Feature-detect WebGPU, then fall back to WebGL, never assume it
- Verdict: corrected
- Correction:
  - (1) The `isFallbackAdapter` check does nothing in Chrome today. The Chrome 136 post says: "Since Chrome has not yet shipped support for fallback adapters, `isFallbackAdapter` is at the moment always false on users' devices." Keep the check, but do not rely on it to detect Chrome's software-only mode.
  - (2) Status: `GPUAdapterInfo.isFallbackAdapter` is also in Firefox 141 (partial), per BCD. The notes list only Chrome 136 and Safari 26. The old `GPUAdapter.isFallbackAdapter` was removed in Chrome 140.
  - (3) The WebGL fallback can also fail. Chrome desktop 139+ removed the automatic SwiftShader fallback for WebGL, so `getContext` returns `null` when there is no usable GPU. The fallback chain must end in Canvas2D or a message (chromestatus 5166674414927872: "Please test and handle WebGL context creation failure and fall back to other web APIs such as Canvas2D").
  - All other facts check out: the null-adapter causes, the platform list, the Firefox gaps (Intel Mac, Linux and Android are not on by default), and "Limited availability".
- Evidence: https://developer.chrome.com/blog/new-in-webgpu-136 ; https://developer.chrome.com/blog/new-in-webgpu-140 ; https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips ; https://api.webstatus.dev/v1/features/webgpu (baseline "limited"; chrome 144, chrome_android 121, safari 26) ; https://github.com/mdn/browser-compat-data/blob/main/api/GPUAdapterInfo.json ; https://chromestatus.com/feature/5166674414927872 ; https://github.com/gpuweb/gpuweb/wiki/Implementation-Status

### Choose `powerPreference` on purpose, and prefer "low-power" or no hint for chart UIs
- Verdict: verified
- Evidence:
  - The spec note says "low-power" "may significantly improve battery life", and that with "high-performance" "user agents are more likely to force device loss". https://gpuweb.github.io/gpuweb/#dom-gpurequestadapteroptions-powerpreference
  - Chrome 115 says: "the discrete GPU is returned when the user's device is on AC power". https://developer.chrome.com/blog/new-in-webgpu-115
  - BCD `api.GPU.requestAdapter.discrete_adapter_default_ac` shows Chrome 115, "dual GPU macOS devices only".
  - Chrome's Windows note: "powerPreference option doesn't have any impact". https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
  - toji says the WebGL and WebGPU GPU choice can differ. https://toji.dev/webgpu-best-practices/webgl-performance-comparison
  - Note: "unset" and `'low-power'` are not the same on dual-GPU Macs on AC power. Unset gets the discrete GPU there.

### Request only the limits and features you use, after checking the adapter
- Verdict: verified
- Evidence:
  - The spec limits table has these defaults: `maxStorageBufferBindingSize` 134217728, `maxBufferSize` 268435456, `maxUniformBufferBindingSize` 65536, `maxBindGroups` 4. https://gpuweb.github.io/gpuweb/#limits
  - The spec supports the rule directly: "Even where supported, enabling features is not necessarily desirable, as doing so may have a performance impact" (§3.6.1). The spec also says "setting 'better' limits is not necessarily desirable, as doing so may have a performance impact" (§3.6.2).
  - `undefined` limits: Chrome 133. https://developer.chrome.com/blog/new-in-webgpu-133 ; BCD `api.GPUAdapter.requestDevice.undefined_limits` is Chrome-only.

### Consider compatibility mode to reach older GPUs, and code within its limits
- Verdict: verified
- Evidence:
  - The spec lists these compat defaults: `maxStorageBuffersInVertexStage` 0, `maxUniformBufferBindingSize` 16384, `maxTextureDimension2D` 4096, `maxColorAttachments` 4. The compat default for `maxComputeInvocationsPerWorkgroup` is also 128. https://gpuweb.github.io/gpuweb/#limits
  - webgpufundamentals: "~45% of these old devices do not support storage buffers in vertex shaders". https://webgpufundamentals.org/webgpu/lessons/webgpu-compatibility-mode.html
  - Chrome 146 shipped it (chromestatus 6436406437871616, milestone 146). BCD `api.GPU.requestAdapter.options_featureLevel` is Chrome 146 partial, "Android 10.0 and above (running OpenGL ES 3.1 and above)", and not in Firefox or Safari. https://developer.chrome.com/blog/new-in-webgpu-146

### Handle `device.lost`: get a new adapter, recreate GPU objects, keep app state in JS
- Verdict: corrected
- Correction:
  - The example does not call `watchLoss(next)` again after recovery, so a second loss goes unhandled. Add `watchLoss(next)` after `rebuildGpuResources(...)`, or do it inside `initGpu()`.
  - Also note that adapters can expire at any time, not only when they are consumed. The spec says "User agents may choose to expire adapters often, even when there has been no system state change". So always call `requestAdapter()` right before `requestDevice()`.
  - Other facts check out: Chrome 140 rejects a second `requestDevice()`. Safari 26 returns a lost device instead (BCD `handles_duplicate_calls`: Safari partial). The crash limits are 2 in 2 min per page and 3 in 2 min for all pages. The watchdog is about 10 s. `destroy()` unmaps buffers.
- Evidence: https://developer.chrome.com/blog/new-in-webgpu-140 ; https://toji.dev/webgpu-best-practices/device-loss ; https://gpuweb.github.io/gpuweb/#dom-gpu-requestadapter (adapter expiry note) ; https://github.com/mdn/browser-compat-data/blob/main/api/GPUAdapter.json

### Use one `GPUDevice` for all chart panes and canvases
- Verdict: corrected
- Correction: The notes give one WebGL cap of "about 16". The real caps are:
  - Chromium: 16 active WebGL contexts on desktop, **8 on Android**, and **4 per worker thread**.
  - WebKit: 16, and 4 in workers.
  - Firefox: much higher (1000 total, 300 per principal).
  - The Chrome doc's "Chrome and Safari can only use up to 16 WebGL canvases" is the desktop value.
- Evidence: https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu ; https://source.chromium.org/chromium/chromium/src/+/main:content/renderer/webgraphicscontext3d_provider_impl.cc (lines 122-127: `max_active_webgl_contexts = 8u` Android / `16u`, `max_active_webgl_contexts_on_worker = 4u`) ; https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/canvas/WebGLRenderingContextBase.cpp (`maxActiveContexts = 16`, `maxActiveWorkerContexts = 4`)

### Run WebGPU rendering in a worker with OffscreenCanvas when the main thread is busy
- Verdict: corrected
- Correction:
  - Remove "`uncapturederror` fires only on the Window event loop per the design doc". That rule comes from the old `design/ErrorHandling.md`. The current spec has `[Exposed=(Window, Worker), SecureContext] interface GPUUncapturedErrorEvent`, and `GPUDevice` (an EventTarget) is exposed in workers, so the event can fire in a worker.
  - Error scopes are still the right tool for known errors.
  - Add: drive the worker loop with `self.requestAnimationFrame`. This is supported in dedicated workers in Chrome 69, Firefox 99 and Safari 16.4, but not in nested workers in Chrome (BCD).
  - Status lines check out: `WorkerNavigator.gpu` and the OffscreenCanvas `webgpu` context are Chrome 113 (BCD shows 144 because of Linux), Android 121, Safari 26 and Firefox 141 partial. Service and shared workers are Chrome 124. `mapSync` needs `--enable-features=WebGPUMapSyncOnWorkers` (Chrome 145).
- Evidence: https://gpuweb.github.io/gpuweb/#gpuuncapturederrorevent ; https://github.com/gpuweb/gpuweb/blob/main/design/ErrorHandling.md (historical) ; https://developer.chrome.com/blog/new-in-webgpu-124 ; https://developer.chrome.com/blog/new-in-webgpu-145 ; https://github.com/mdn/browser-compat-data/blob/main/api/DedicatedWorkerGlobalScope.json

### Create pipelines with `createRenderPipelineAsync` / `createComputePipelineAsync` before the first frame
- Verdict: corrected
- Correction: "WebGL has no equivalent" is wrong. WebGL has `KHR_parallel_shader_compile`: poll `COMPLETION_STATUS_KHR` instead of blocking on `linkProgram`/`getProgramParameter`. BCD lists it in Chrome 76 and Safari 14.1 (iOS 14.5), not Firefox. 10-gpu-webgl.md has a rule for it. Say instead: "WebGL's equivalent is the `KHR_parallel_shader_compile` extension (not in Firefox); without it, link stalls show up at the first draw."
  - The rest checks out. The spec says "Use of this method is preferred whenever possible, as it prevents blocking the queue timeline work on pipeline compilation". The possible stall points are creation, `setPipeline()`, `finish()` and `submit()`. The promise rejects with `GPUPipelineError`. Errors are silenced after loss (Chrome 117).
- Evidence: https://gpuweb.github.io/gpuweb/#dom-gpudevice-createrenderpipelineasync ; https://gpuweb.github.io/gpuweb/#async-pipeline-creation ; https://developer.chrome.com/blog/new-in-webgpu-117 ; https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/ ; https://github.com/mdn/browser-compat-data/blob/main/api/KHR_parallel_shader_compile.json

### Reuse shader modules and pipelines; never create them per frame or per series
- Verdict: corrected
- Correction:
  - Attribution: webgpufundamentals says "createRenderPipeline is a slow call as your shaders might be adjusted" (webgpu-from-webgl lesson). Chrome did not say it. Change "Chrome states" to "webgpufundamentals states".
  - Spec §2.2.4 only says "it is expected that user agents will have compilation caches" and that they "should follow the best practices in storage partitioning". That is an expectation, not a guarantee, so do not say "browsers keep".
  - Chrome 117 added caching for `layout: 'auto'` pipelines.
- Evidence: https://webgpufundamentals.org/webgpu/lessons/webgpu-from-webgl.html ; https://gpuweb.github.io/gpuweb/#privacy-user-agent-state ; https://developer.chrome.com/blog/new-in-webgpu-117

### Specialize shaders with `override` constants or template strings instead of runtime branches
- Verdict: verified
- Evidence:
  - toji: "Whether or not using overrides for that kind of branch selection is optimized to remove the other branch is a task that's largely in the hands of your GPU driver", and overrides "can be applied without recreating the shader module". https://toji.dev/webgpu-best-practices/dynamic-shader-construction
  - WGSL says "An override-declaration requires a concrete scalar type", so no vectors or arrays. https://gpuweb.github.io/gpuweb/wgsl/#override-decls
  - https://webgpufundamentals.org/webgpu/lessons/webgpu-constants.html

### Define explicit bind group layouts; use `layout: 'auto'` only for one-off pipelines
- Verdict: corrected
- Correction: A `null` entry in `bindGroupLayouts` is **Chrome-only**. BCD `api.GPUDevice.createPipelineLayout.descriptor_bindGroupLayouts_parameter_accepts_null_values` lists Chrome 135 and not Firefox or Safari. Portable code must put an empty `GPUBindGroupLayout` in the gap and bind an empty bind group.
  - The rest checks out. toji says auto layouts "can only be used with the pipeline that generated the layout", that auto layouts drop resources the shader does not statically use, and "the driver will still do the work to make it accessible".
- Evidence: https://toji.dev/webgpu-best-practices/bind-groups ; https://developer.chrome.com/blog/new-in-webgpu-135 ; https://github.com/mdn/browser-compat-data/blob/main/api/GPUDevice.json

### Split bind groups by update frequency and put the least-changing group at index 0
- Verdict: verified
- Evidence:
  - Spec §8.3 note: "placing the most common and the least frequently changing bind groups at the 'bottom' of the layout, meaning lower bind group slot numbers". https://gpuweb.github.io/gpuweb/#gpupipelinelayout
  - toji, "Group indices matter" section. https://toji.dev/webgpu-best-practices/bind-groups
  - The spec says bundles reset the bind state. https://gpuweb.github.io/gpuweb/#bundles
  - Note: no source was found for "Implementations do not reliably skip redundant rebinds". Mark that clause as inference.

### Pack per-draw uniforms into one large buffer with dynamic offsets and one `writeBuffer` per frame
- Verdict: verified
- Evidence:
  - webgpufundamentals has the numbers: "~8000 cubes" at the start, "around 15000 objects at 75fps … about 87% more", and "9000 … 18000 … a 2x speed up". https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html
  - "using dynamic offsets is slightly slower … If you're only calling setBindGroup a few hundred times…". https://webgpufundamentals.org/webgpu/lessons/webgpu-bind-group-layouts.html
  - The spec on `minBindingSize`: "If this is 0 … draw/dispatch commands validate". https://gpuweb.github.io/gpuweb/#dom-gpubufferbindinglayout-minbindingsize
  - The spec defaults: 8 dynamic uniform buffers, 4 dynamic storage buffers, and a 256-byte `minUniformBufferOffsetAlignment`.

### Use immediates (`var<immediate>` + `setImmediates`) for tiny per-draw values where supported
- Verdict: corrected
- Correction:
  - (1) Status: immediates **shipped on by default in Chrome 150** on desktop, Android and WebView. chromestatus 5199437611794432 has a ship stage of 150 and `flag: false`, and the Chrome post links an intent to ship. BCD's `experimental: true` is a data label, not a runtime flag. Replace "(BCD, experimental flag in BCD)" with "(shipped by default; BCD marks it experimental)".
  - (2) "Only one `var<immediate>` per shader" is imprecise. WGSL says "Each entry point must statically access at most one immediate data variable", so a module can declare several.
  - The rest checks out:
    - `maxImmediateSize` defaults to 64 bytes.
    - `immediateSize` is set in `GPUPipelineLayoutDescriptor` and must be a multiple of 4.
    - Slots that are used but not set fail validation (`[[immediate_slots_set]]`).
    - Bundle execution clears the immediate state.
    - Chrome 151-152 throws `OperationError`.
    - BCD lists `setImmediates` in Chrome 150 only.
- Evidence: https://chromestatus.com/feature/5199437611794432 ; https://developer.chrome.com/blog/new-in-webgpu-149-150 ; https://gpuweb.github.io/gpuweb/#dom-gpubindingcommandsmixin-setimmediates ; https://gpuweb.github.io/gpuweb/wgsl/#address-spaces-immediate ; https://developer.chrome.com/blog/new-in-webgpu-151-152

### Use uniform buffers for small fixed data and storage buffers for large or variable arrays
- Verdict: verified
- Evidence:
  - webgpufundamentals: "Uniform buffers can be faster for their typical use-case". https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-buffers.html
  - The spec limits are 64 KiB and 128 MiB. https://gpuweb.github.io/gpuweb/#limits
  - The Chrome doc on storage buffers and runtime-sized arrays. https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu

### Lay out host data to WGSL alignment rules; compute offsets with a helper, not by hand
- Verdict: corrected
- Correction: The `@align` rule is the other way round. The WGSL align attribute says: "n must satisfy: n = k × RequiredAlignOf(T,AS) for some positive integer k". So n must be a **multiple of** the member type's required alignment, for address spaces other than uniform. Replace the caveat with: "Since Chrome 133, `@align(n)` must be a multiple of the member's required alignment (a too-small `@align` is now an error)." The Chrome 133 post's wording ("`@align(n)` divides RequiredAlignOf") contradicts its own sentence "no longer possible to provide a too-small alignment value" and the spec.
  - The rest checks out: `vec3f` aligns to 16, the uniform array stride is 16, and `uniform_buffer_standard_layout` is Chrome 144 only (BCD experimental).
- Evidence: https://gpuweb.github.io/gpuweb/wgsl/#align-attr ; https://developer.chrome.com/blog/new-in-webgpu-133 ; https://github.com/gpuweb/gpuweb/pull/4978 ; https://developer.chrome.com/blog/new-in-webgpu-144

### Default to `queue.writeBuffer()` for updates
- Verdict: verified
- Evidence:
  - toji: "the writeBuffer() method is always a safe fallback that doesn't have many downsides", and "if you are using WebGPU from WASM code, writeBuffer() is the preferred path". https://toji.dev/webgpu-best-practices/buffer-uploads
  - Chrome 144: "up to 2X better". https://developer.chrome.com/blog/new-in-webgpu-144
  - Chrome 126 has the Vulkan fast path. It needs host-visible memory "without any pending GPU operations on it", so the fast path does not apply while the GPU still reads the buffer. https://developer.chrome.com/blog/new-in-webgpu-126
  - MDN confirms that offsets are in elements for typed arrays and in bytes otherwise, and that sizes must be multiples of 4. https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/writeBuffer
  - Cross-file: see "Missing but important" #4. Views over resizable ArrayBuffers throw.

### Fill static buffers with `mappedAtCreation: true`
- Verdict: verified
- Evidence:
  - toji: "COPY_DST is not required!", "User agent must zero out the buffer before it's mapped", and "If data is already in an ArrayBuffer, requires another CPU-side copy". https://toji.dev/webgpu-best-practices/buffer-uploads
  - Chrome 138 `RangeError`: https://developer.chrome.com/blog/new-in-webgpu-138

### Use a ring of pre-mapped staging buffers only when uploads are a measured bottleneck
- Verdict: verified
- Evidence:
  - webgpufundamentals "Use Mapped Buffers": the step ends at 15000 objects / 87% overall, and the gain of that single step is not isolated. https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html
  - The spec allows `MAP_WRITE` only with `COPY_SRC`. https://gpuweb.github.io/gpuweb/#buffer-usage
  - Dawn's `BufferMapWriteExtendedUsages` is native-only (the Dawn updates in the Chrome 153-154 post). https://developer.chrome.com/blog/new-in-webgpu-153-154
  - Note: "2-3 buffers" is inference. No source gives a count.

### Preallocate series buffers with headroom, because WebGPU buffers cannot be resized
- Verdict: verified
- Evidence:
  - Chrome doc: "buffers and textures are immutable … You can only change their contents." https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu
  - The spec `copyBufferToBuffer` usage rules. The spec also makes `destroy()` after `submit()` safe: work already submitted completes. https://gpuweb.github.io/gpuweb/#dom-gpucommandencoder-copybuffertobuffer

### Call `destroy()` on buffers and textures you no longer need
- Verdict: verified
- Evidence: the explainer §3.2.2 says: "a single WebGPU object can hold on to MBs or GBs of memory without the GC knowing and never trigger the memory pressure event". https://gpuweb.github.io/gpuweb/explainer/#early-destruction-of-webgpu-objects

### Shrink vertex data with packed, interleaved and normalized formats
- Verdict: verified
- Evidence:
  - Chrome 133 added the "1-component vertex formats" ("previously at least twice as much was required for 8 and 16-bit data types") and `unorm8x4-bgra`. https://developer.chrome.com/blog/new-in-webgpu-133
  - The webgpufundamentals optimization lesson covers interleaving. https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html
  - BCD has no entries for the 1-component formats, so support in other browsers stays unverified. The notes already say to check.

### Rebase large coordinates to a local origin before upload (no f64 in WGSL)
- Verdict: verified
- Evidence: WGSL floating-point types are `f32` and optional `f16` only. https://gpuweb.github.io/gpuweb/wgsl/#floating-point-types
  - Useful detail: at 1.7e12 ms, f32 values are 2^17 ms apart (about 131 s). The error is about two minutes, not a few milliseconds.

### Read back with a pool of `MAP_READ` buffers and never `await` the map inside the frame
- Verdict: corrected
- Correction: "WebGL's `readPixels` blocks the calling thread instead" is an overgeneralization. Only CPU `readPixels` blocks. WebGL2 has an async path: `readPixels` into a `PIXEL_PACK_BUFFER`, then `fenceSync`, poll with `getSyncParameter`/`clientWaitSync(…, 0, 0)`, then `getBufferSubData`. 10-gpu-webgl.md has this as a rule.
  - The WebGPU facts check out: the `mapAsync` offset must be a multiple of 8 and the size a multiple of 4, and a second `mapAsync` while not "unmapped" rejects with `OperationError`.
  - The Firefox timer polling is **still open**: bug 1870699 "Don't poll WebGPU from a timer" has status ASSIGNED as of 2026-09-23.
- Evidence: https://gpuweb.github.io/gpuweb/#dom-gpubuffer-mapasync ; https://registry.khronos.org/webgl/specs/latest/2.0/ ; https://bugzilla.mozilla.org/show_bug.cgi?id=1870699 ; https://mozillagfx.wordpress.com/2025/07/15/shipping-webgpu-on-windows-in-firefox-141/

### Encode one command buffer per frame, submit once, and keep object creation out of the loop
- Verdict: verified
- Evidence:
  - Chrome 114 has the 40% cut ("0.5 ms per 10K draws to around 0.3 ms"). https://developer.chrome.com/blog/new-in-webgpu-114
  - Chrome 126 made submitted command buffers unique. https://developer.chrome.com/blog/new-in-webgpu-126
  - https://gpuweb.github.io/gpuweb/#gpucommandbuffer

### Draw many similar marks with instancing or one storage-backed draw, not one draw per mark
- Verdict: corrected
- Correction: The example comment is wrong. `draw(18, …)` in a triangle-list is 6 triangles, which is **3 quads** (body plus 2 wicks), not "6 quads-ish". Replace the comment with `// 3 quads (body + upper/lower wick) = 18 vertices`.
  - The rest checks out. webgpufundamentals draws "all 100 triangles in a single draw call", and the optimization lesson says "hundreds or more of the same thing". A direct `draw()` with a non-zero `firstInstance` needs no feature.
- Evidence: https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-buffers.html ; https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html

### Expand lines and points into triangles yourself (WebGPU rasterizes only 1-pixel lines and points)
- Verdict: verified
- Evidence:
  - webgpufundamentals: "points are only 1 pixel in WebGPU" and "WGSL only supports lines and points 1 pixel wide". https://webgpufundamentals.org/webgpu/lessons/webgpu-from-webgl.html
  - Chrome 131 depth-bias validation. https://developer.chrome.com/blog/new-in-webgpu-131

### Record static draw sequences into render bundles and replay them
- Verdict: verified
- Evidence:
  - The spec: after a bundle executes, "the render pass's pipeline, bind group, immediate data, and vertex/index buffer state is cleared". https://gpuweb.github.io/gpuweb/#bundles
  - toji covers the bundle limits (no viewport/scissor, no occlusion queries), the GPU-bound caveat and the external-texture caveat. https://toji.dev/webgpu-best-practices/render-bundles
  - web.dev: "approximately 10 times faster" (Babylon.js Snapshot Rendering). https://web.dev/blog/webgpu-supported-major-browsers

### Drive dynamic draw counts with indirect draws, and keep all indirect args in one buffer
- Verdict: verified
- Evidence:
  - toji: "~3ms" of "~6ms" with 412 indirect buffers, "dropped from 3ms to just over 10μs"; the hidden dispatches are not in pass timestamps. toji also notes that Vulkan backends can behave the same as D3D12. https://toji.dev/webgpu-best-practices/indirect-draws
  - The spec no-op rule for `firstInstance`. https://gpuweb.github.io/gpuweb/#dom-gpurendercommandsmixin-drawindirect
  - Multi-draw indirect in Chrome 131 needs "Unsafe WebGPU Support". https://developer.chrome.com/blog/new-in-webgpu-131
  - BCD `indirect-first-instance` lists Chrome and Safari 26, not Firefox. WebKit's `HardwareCapabilities.mm` always appends it.

### Throttle heavy GPU submissions with `onSubmittedWorkDone()`
- Verdict: corrected
- Correction: The spec anchor is wrong. The sentence "The device may become lost if shader execution does not end in a reasonable amount of time" is in §23.1 Computing (https://gpuweb.github.io/gpuweb/#computing-operations), not `#vertex-processing`. The advice itself checks out: MDN names "Throttling work" as one of its two use cases.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/onSubmittedWorkDone ; https://gpuweb.github.io/gpuweb/#computing-operations

### Do data preparation (decimation, scaling, culling) in compute shaders and keep results on the GPU
- Verdict: verified
- Evidence:
  - toji: generating data on the GPU has "the massive upside of not requiring any staging buffers". https://toji.dev/webgpu-best-practices/buffer-uploads
  - webgpufundamentals has the ~30x slower single-invocation result and "Drawing the histogram on the GPU". https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram.html ; https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram-part-2.html
  - ChartGPU docs: "'lttb', 'min', 'max' … eligible null-gap-free lines can run on the GPU". https://chartgpu.io/docs/performance/
  - The 2^24 = 16,777,216 exactness limit is correct.

### Size workgroups at 64 and reduce in workgroup memory instead of global atomics
- Verdict: verified
- Evidence:
  - webgpufundamentals: "choose a workgroup size of 64 unless you have a specific reason". https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders.html
  - The histogram lesson: "4x faster than JavaScript", "11ms", and "under 1ms". https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram.html
  - WGSL atomics are u32/i32. `atomic<vec2<u32>>` supports only `atomicStoreMin`/`atomicStoreMax`, via `enable atomic_vec2u_min_max;`. https://gpuweb.github.io/gpuweb/wgsl/#atomic-types
  - The spec limits are 256 / 16384 / 65535. The compat default is 128 invocations.

### Use subgroup operations for reductions where the `subgroups` feature exists
- Verdict: corrected
- Correction:
  - (1) "reduce across 16-64 lanes" is wrong. WGSL says: "All subgroup sizes are powers of two within the range [4, 128]". A device may support only one size, and subgroups may be partial.
  - (2) `subgroup-size-control` shipped in **Chrome 152** (chromestatus 5077657663438848, milestone 152). Change "Chrome 151+" to "Chrome 152+". It also needs the `'subgroup-size-control'` device feature plus `enable subgroups; enable subgroup_size_control;`. Since Chrome 153-154, `subgroups` is enabled automatically by `subgroup_size_control`. The size must be a power of 2 within `[subgroupMinSize, subgroupMaxSize]`.
  - (3) Watch Safari: WebKit `main` added `WGPUFeatureName_Subgroups` for Metal 3 GPUs in commit "[WebGPU] Subgroups" (2026-07-14). The Safari 27.0 notes do not list it, so it has not shipped yet.
  - The rest checks out. Google Meet saw 2.3-2.9x (Chrome 134). BCD/webstatus list Chrome 144 (desktop, because of Linux), marked experimental, and not in Firefox or Safari.
- Evidence: https://gpuweb.github.io/gpuweb/wgsl/#subgroup-size ; https://chromestatus.com/feature/5077657663438848 ; https://developer.chrome.com/blog/new-in-webgpu-151-152 ; https://developer.chrome.com/blog/new-in-webgpu-153-154 ; https://developer.chrome.com/blog/new-in-webgpu-134 ; https://github.com/WebKit/WebKit/blob/main/Source/WebGPU/WebGPU/HardwareCapabilities.mm ; https://api.webstatus.dev/v1/features/webgpu-subgroups

### Use `shader-f16` only for bandwidth-bound data that tolerates 16-bit precision
- Verdict: verified
- Evidence:
  - Chrome 120: "28% improvement in prefill speed and a 41% improvement in decoding speed" on an Apple M1 Pro; `alias` pattern. https://developer.chrome.com/blog/new-in-webgpu-120
  - BCD `feature_shader-f16`: Chrome 120, Safari 26, Firefox false.
  - WebKit always appends `ShaderF16`.

### Load images with `fetch` + `createImageBitmap` + `copyExternalImageToTexture`
- Verdict: verified
- Evidence:
  - toji (updated "as of early 2026"): ImageBitmap decode happens "off the main thread". With an `<img>`, the decode "to be performed synchronously. (This is the current behavior in Chrome.)". https://toji.dev/webgpu-best-practices/img-textures
  - BCD `api.GPUQueue.copyExternalImageToTexture.htmlimageelement_imagedata_source`: Chrome 118, Firefox false, Safari false.
  - Chrome 118: https://developer.chrome.com/blog/new-in-webgpu-118
  - Nuance: set `createImageBitmap(..., { premultiplyAlpha })` to match the destination `premultipliedAlpha`. The spec says conversion "might not be necessary" when they match (§3.11.2).

### Build text and icon atlases on a 2D canvas and copy them with `copyExternalImageToTexture`
- Verdict: corrected
- Correction: Add `premultipliedAlpha: true` to the destination in the example: `copyExternalImageToTexture({ source: atlas }, { texture: atlasTex, premultipliedAlpha: true }, …)`, and blend with premultiplied math.
  - Canvas 2D contents are premultiplied. `GPUCopyExternalImageDestInfo.premultipliedAlpha` defaults to `false`, so the default forces an un-premultiply conversion, which costs time and gives dark fringes. The spec says conversion "might not be necessary" only when `premultipliedAlpha` matches the source.
  - To follow 12-canvas2d-and-images.md, also copy only the dirty sub-rectangle (source `origin` + destination `origin` + copy size) instead of the whole 1024×1024 atlas.
  - The fast-path claim checks out (toji: "almost certainly produced the canvas contents with the same GPU backend"; this applies only to WebGL or Canvas2D canvases).
- Evidence: https://gpuweb.github.io/gpuweb/#dom-gpucopyexternalimagedestinfo-premultipliedalpha ; https://toji.dev/webgpu-best-practices/img-textures ; 12-canvas2d-and-images.md lines 449-487

### Use `importExternalTexture` for video frames, created and used in the same callback
- Verdict: corrected
- Correction: "An `await` between import and use destroys the texture" is an overgeneralization.
  - The spec says an external texture from an `HTMLVideoElement` "expires … automatically in a task after it is imported". An `await` that stays in the same task (for example on an already-resolved promise, which is a microtask) does not expire it. An `await` that yields to a later task (I/O, timers) does.
  - An external texture from a `VideoFrame` "expires … when, and only when, the source VideoFrame is closed".
  - The UA may "un-expire and return the same GPUExternalTexture again". This commonly happens unless the app runs at the video frame rate (for example with `requestVideoFrameCallback()`).
  - Status: Firefox 144 is partial and **Windows only** (BCD note). Mozilla meta bug 1827116 is still NEW.
- Evidence: https://gpuweb.github.io/gpuweb/#gpuexternaltexture ; https://github.com/mdn/browser-compat-data/blob/main/api/GPUDevice.json ; https://bugzilla.mozilla.org/show_bug.cgi?id=1827116

### Generate mipmaps yourself only for textures that are minified
- Verdict: verified
- Evidence:
  - Chrome doc: "In WebGPU, you must generate mipmaps yourself. There is no built-in function". https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu
  - webgpufundamentals timing: "5x faster" by timestamps, and the render-pass method "was 20% faster … on one machine, and 8% faster on another". https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html
  - The compat per-layer view rule. https://webgpufundamentals.org/webgpu/lessons/webgpu-compatibility-mode.html

### Pick texture formats by filtering needs and size
- Verdict: disputed
- Correction:
  - (1) "`float32-filterable` is Chrome-only" is contradicted by WebKit source. `HardwareCapabilities.mm` appends `WGPUFeatureName_Float32Filterable` when `device.supports32BitFloatFiltering`. The same code was present at WebKit commit d5c8c97 (2025-07-09), before Safari 26.0 shipped. BCD 8.1.2 still says Safari false. Treat it as "Chrome; Safari on capable Apple GPUs per WebKit source (BCD disagrees)" and feature-detect.
  - (2) `texture-compression-bc`: WebKit appends it when `device.supportsBCTextureCompression` (Apple silicon Macs and BC-capable iPads). BCD is internally inconsistent: `feature_texture-compression-bc` is Safari false, but `feature_texture-compression-bc-sliced-3d`, which requires BC, is Safari 26.
  - (3) "which also forces an explicit bind group layout" is only partly true. In the current spec, the default (auto) layout sets `sampleType: "unfilterable-float"` for an f32 texture used without a sampler (for example `textureLoad` only). An explicit layout is needed only when you sample `r32float` with a non-filtering sampler.
- Evidence: https://github.com/WebKit/WebKit/blob/main/Source/WebGPU/WebGPU/HardwareCapabilities.mm ; https://github.com/WebKit/WebKit/blob/d5c8c97b14855f39820c6337bfbffea2f7693f39/Source/WebGPU/WebGPU/HardwareCapabilities.mm ; https://github.com/mdn/browser-compat-data/blob/main/api/GPUSupportedFeatures.json ; https://gpuweb.github.io/gpuweb/#default-pipeline-layout ; https://webgpufundamentals.org/webgpu/lessons/webgpu-textures.html

### Configure the canvas with `getPreferredCanvasFormat()` and `alphaMode: 'opaque'` unless you need transparency
- Verdict: verified
- Evidence:
  - toji: "for Chrome it's Android and Mac specifically … an extra texture copy". toji's code does use `alpha:` rather than `alphaMode`, so the notes' remark is right. https://toji.dev/webgpu-best-practices/webgl-performance-comparison
  - The spec on "opaque": "this incurs a clear of the alpha channel" when other APIs read it, and "If an application needs a canvas only for interop (not presentation), avoid 'opaque'". https://gpuweb.github.io/gpuweb/#canvas-configuration
  - BCD `configure.toneMapping`: Chrome 129 (experimental), not Firefox or Safari.

### Size the drawing buffer from `ResizeObserver`, clamp it, and change it only when needed
- Verdict: verified
- Evidence:
  - webgpufundamentals optimization: "Don't set the canvas size if it's already that size as it may be slow". https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html
  - The resizing lesson has the clamp to `maxTextureDimension2D`. https://webgpufundamentals.org/webgpu/lessons/webgpu-resizing-the-canvas.html
  - Note: `devicePixelContentBoxSize` is not in Safari (BCD `api.ResizeObserverEntry.devicePixelContentBoxSize`: Safari false), so keep the DPR fallback that the example uses. See "Missing but important" #1 for the DPR cap.

### Implement MSAA explicitly and cheaply: reuse the 4x target, resolve once, discard samples
- Verdict: corrected
- Correction: The transient-attachment rules in the notes are incomplete. The spec requires:
  - `usage` **exactly** `TRANSIENT_ATTACHMENT | RENDER_ATTACHMENT`
  - `viewFormats` `[]`
  - `dimension` `"2d"`
  - on the attachment, `loadOp` **must be `"clear"`** and `storeOp` **must be `"discard"`** (for depth: `depthLoadOp` "clear", `depthStoreOp` "discard")
  - it must not be a `resolveTarget`

  The example already meets these rules; add them to the caveats so readers do not use `'load'` with a transient target. The Status facts check out: Chrome 146 (chromestatus 5562829589577728), Firefox 157 partial, not in Safari (BCD). `sampleCount` "must be either 1 or 4" (spec).
- Evidence: https://gpuweb.github.io/gpuweb/#dom-gputextureusage-transient_attachment ; https://gpuweb.github.io/gpuweb/#dom-gpudevice-createtexture ; https://developer.chrome.com/blog/new-in-webgpu-146 ; https://developer.chrome.com/blog/new-in-webgpu-149-150 ; https://chromestatus.com/feature/5562829589577728

### Prefer `loadOp: 'clear'` and `storeOp: 'discard'` when you do not need old or later contents
- Verdict: verified
- Evidence: the spec note: "On some GPU hardware (primarily mobile), 'clear' is significantly cheaper because it avoids loading data from main memory into tile-local memory". https://gpuweb.github.io/gpuweb/#enumdef-gpuloadop

### Write clean, modular WGSL and let the driver optimize; remove work instead of micro-tuning
- Verdict: verified
- Evidence:
  - Corentin Wallez (Apr 2023): "There are no optimizations done at this time", and driver optimizations: "lots of them". https://groups.google.com/g/dawn-graphics/c/bbCgIrYYdng
  - Chrome 141: "up to a seven times speed improvement" in Tint internals. The integer range analysis was "progressively rolling out … will soon be enabled by default", so say "rolling out since 141". https://developer.chrome.com/blog/new-in-webgpu-141
  - Chrome 133 discard. https://developer.chrome.com/blog/new-in-webgpu-133
  - Chrome 131 `strictMath` behind "WebGPU Developer Features". https://developer.chrome.com/blog/new-in-webgpu-131

### Feature-detect WGSL language extensions and declare them with `requires`
- Verdict: verified
- Evidence:
  - WGSL: "A language extension is an extension which is automatically available if the implementation supports it", and a requires-directive "documents the program's use". https://gpuweb.github.io/gpuweb/wgsl/#language-extension
  - BCD `WGSLLanguageFeatures`: Chrome 115, Safari 26, Firefox 141 partial. Every listed extension is Chrome-only (`linear_indexing` Chrome 148, `subgroup_id`/`uniform_buffer_standard_layout` Chrome 144). `buffer_view` is Chrome 153 (chromestatus 5094091886034944). https://developer.chrome.com/blog/new-in-webgpu-153-154

### Measure GPU pass time with `timestamp-query`, averaged, and confirm with throughput tests
- Verdict: corrected
- Correction: "`writeTimestamp()` on encoders is deprecated" understates it. `GPUCommandEncoder.writeTimestamp()` was **removed** from the spec and from Chrome (BCD: Chrome 113-121, deprecated, non-standard). Firefox 141 still exposes it (partial). Pass-encoder `writeTimestamp` exists only as Chrome's non-standard experimental extension. Use `timestampWrites` only.
  - The rest checks out. Chrome 120 quantizes to 100 µs unless `enable-webgpu-developer-features` is on. The timestamp result was "5x faster" and the throughput test disagreed. BCD `timestampWrites` shows Safari false, but `feature_timestamp-query` shows Safari 26. WebKit exposes the feature only when a Metal timestamp counter set exists.
- Evidence: https://github.com/mdn/browser-compat-data/blob/main/api/GPUCommandEncoder.json ; https://developer.chrome.com/blog/new-in-webgpu-120 ; https://developer.chrome.com/blog/new-in-webgpu-121 ; https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html

### Keep error scopes around synchronous setup code, not in the per-frame loop
- Verdict: verified
- Evidence:
  - toji: awaits between push and pop break scopes; scoped messages are suppressed from the console. https://toji.dev/webgpu-best-practices/error-handling
  - The Chrome doc on `getError()` sync IPC. https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu
  - BCD `uncapturederror_event`: Chrome, Firefox 141 partial, Safari 27. Safari 27.0 "Fixed GPUDevice.onuncapturederror event handler attribute not working". https://webkit.org/blog/18325/webkit-features-for-safari-27-0/
  - Nuance: the spec's normative note says UAs should still log uncaptured errors to the console "unless the event's defaultPrevented is true". A listener alone silences the console only in some implementations (toji says it does). Re-logging is still the safe advice. https://gpuweb.github.io/gpuweb/#telemetry

### Label every GPU object and use debug groups, also in production
- Verdict: verified
- Evidence:
  - toji: "Setting a label has very little overhead, and should be done even for release versions of your app". https://toji.dev/webgpu-best-practices/error-handling
  - The Chrome doc: labels are used "in GPUError messages, console warnings, and browser developer tools". https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu

### Port from WebGL by restructuring, and benchmark fairly
- Verdict: verified
- Evidence:
  - toji: Chrome picks "a low-powered GPU for WebGPU if it detects that your laptop is on battery power"; WebGL defaults to the compositor GPU. https://toji.dev/webgpu-best-practices/webgl-performance-comparison
  - Chrome troubleshooting "WebGPU: Hardware accelerated". https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
  - Firefox IPC: bug 1968122 is FIXED in 142. The timer polling (bug 1870699) is still open. https://bugzilla.mozilla.org/show_bug.cgi?id=1968122

### Treat WebGPU as a progressive enhancement with per-feature detection
- Verdict: corrected
- Correction:
  - (1) `clip-distances` is **not Chrome-only**. Safari 27.0 (released Sept 17 2026): "Safari 27.0 now supports the clip_distances built-in value in WGSL shaders". WebKit appends `WGPUFeatureName_ClipDistances` (commit 2026-04-23). BCD 8.1.2 has not caught up.
  - (2) `float32-filterable` is disputed as "Chrome only". See the texture-format item.
  - (3) Firefox Linux: release channel 152+ has WebGPU behind `about:config` `dom.webgpu.enabled` (user report, gpuweb issue #6331; the wiki still says "Nightly"). It is off by default. The Mozilla meta bug 2006676 "Release WebGPU on Linux" is still NEW. Intel Mac bug 2004105 is still NEW.
  - (4) Firefox 155 `dual-source-blending` is confirmed (MDN Firefox 155 notes).
  - (5) Add to "Some BCD entries disagree": `texture-compression-bc` (Safari false) and `texture-compression-bc-sliced-3d` (Safari 26).
  - The rest checks out: the Chrome platform list, Safari 26 ("validation performed was streamlined recently to minimize overhead"), and webstatus "limited".
- Evidence: https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ; https://github.com/WebKit/WebKit/blob/main/Source/WebGPU/WebGPU/HardwareCapabilities.mm ; https://github.com/gpuweb/gpuweb/issues/6331 ; https://bugzilla.mozilla.org/show_bug.cgi?id=2006676 ; https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/155 ; https://github.com/gpuweb/gpuweb/wiki/Implementation-Status ; https://api.webstatus.dev/v1/features/webgpu

---

## Cross-file conflicts

1. **Async shader compile in WebGL.** 11 ("Create pipelines…async") says "WebGL has no equivalent". 10-gpu-webgl.md has "Use KHR_parallel_shader_compile and warm up programs before interaction" (Chrome 76, Safari 14.1, not Firefox). 10 is correct.
2. **WebGL readback.** 11 (readback item Why, and the table row "Readback | Blocking `readPixels`") conflicts with 10-gpu-webgl.md:826 "Read back asynchronously with PIXEL_PACK_BUFFER + fenceSync". Only CPU `readPixels` blocks. Change the table cell to "`readPixels` (sync) or PBO + `fenceSync` (async, WebGL2)".
3. **WebGL context cap.** 11 (the multi-pane item and the table: "~16 live contexts in Chrome/Safari") is incomplete. verify/10 and 13-scichart.md:346 say 16 on desktop, **8 on Chrome Android**, and 4 per worker (Chrome and Safari). Chromium and WebKit source confirm this.
4. **Canvas-to-texture premultiply.** 12-canvas2d-and-images.md:455 says to pass `premultipliedAlpha: true` in `copyExternalImageToTexture` for canvas sources. 11's atlas example leaves the default (`false`), which forces a conversion. 12 is correct per the spec (§3.11.2 conversion elision).
5. **Atlas uploads.** 12-canvas2d-and-images.md:469 says "Upload only the dirty sub-rectangle into a preallocated atlas texture". 11 copies the whole atlas "only when the atlas changes". This is not a contradiction, but 12's rule is more efficient. Merge them.
6. **Hit testing.** 10-gpu-webgl.md:852 says "Hit-test chart data on the CPU instead of GPU picking with readPixels". 11's readback item lists "interaction (hit tests)" as a readback use. Align them: CPU hit-test first, and GPU readback only for GPU-only data.
7. **Software-adapter detection.** 14-devtools-mcp-and-webmcp.md:165 and 11 both use `isFallbackAdapter: true` to reject software runs. Chrome always reports `false` on user devices (Chrome 136 post), so neither check catches Chrome's software-only WebGPU. Use `chrome://gpu` ("WebGPU: Hardware accelerated") or the `adapter.info` vendor/architecture instead.
8. **OffscreenCanvas WebGPU version.** 07-js-web-apis.md:269 says "Chrome 144 (Android 121)" and 11 says "Chrome 113+". Both are consistent once you apply BCD's convention (144 = Linux added). 11's wording is the more precise one. Add a note to 07.
9. **Resizable buffers.** 08-v8-batch-08.md:288 and 09-v8-consolidated.md:414 say that views over resizable ArrayBuffers throw `TypeError` in WebGPU uploads (measured in Chrome 152). 11's `writeBuffer` item does not mention this. This is missing, not contradictory.

## Missing but important

1. **Cap devicePixelRatio for the WebGPU canvas.** webgpufundamentals: "many phones have device pixel ratios as high as 4 … Drawing 16x the pixels is literally up to 16x slower … consider limiting … `dpr = Math.min(2, devicePixelRatio)`." 18-skills-survey-github.md also lists a DPR cap. Source: https://webgpufundamentals.org/webgpu/lessons/webgpu-resizing-the-canvas.html
2. **Avoid unneeded `viewFormats`** on textures and in `context.configure()`. Spec: "Adding a format to this list may have a significant performance impact … on some systems any texture with a format or viewFormats entry including 'rgba8unorm-srgb' will perform less optimally." Source: https://gpuweb.github.io/gpuweb/#dom-gputexturedescriptor-viewformats
3. **End the fallback chain in Canvas2D.** On Chrome desktop 139+, WebGL no longer falls back to SwiftShader and `getContext` returns `null`, so "WebGPU → WebGL" is not enough. Source: https://chromestatus.com/feature/5166674414927872
4. **Never pass views over resizable ArrayBuffers (or Wasm `toResizableBuffer()` memory) to `writeBuffer`/`writeTexture`.** WebIDL rejects them because WebGPU's `AllowSharedBufferSource` lacks `[AllowResizable]`. 08-v8-batch-08 measured `TypeError` in Chrome 152. Stage data in fixed-length buffers. Sources: https://webidl.spec.whatwg.org/#AllowResizable ; https://gpuweb.github.io/gpuweb/#dom-gpuqueue-writebuffer ; 09-v8-consolidated.md:414
5. **Use `writeTexture` for small texture updates, and pad rows to 256 bytes for buffer↔texture copies.** Spec: `copyBufferToTexture`/`copyTextureToBuffer` need `bytesPerRow` "a multiple of 256". `writeTexture` has "no alignment requirement on either dataLayout.bytesPerRow or dataLayout.offset". This matters for label or heatmap sub-rect updates and for chart snapshot export. Source: https://gpuweb.github.io/gpuweb/#dom-gpuqueue-writetexture
6. **Match premultiplication and color space on every external-image copy** (`createImageBitmap` `premultiplyAlpha`/`colorSpaceConversion` ↔ `premultipliedAlpha`/`colorSpace` on the destination), so that the UA can skip the conversion pass. Source: https://gpuweb.github.io/gpuweb/#color-space-conversion-elision
7. **Run the worker's frame loop with `self.requestAnimationFrame`.** It is supported in dedicated workers in Chrome 69, Firefox 99 and Safari 16.4 (BCD), but not in nested workers in Chrome. Without it, a worker renderer needs `setTimeout` pacing. Source: https://github.com/mdn/browser-compat-data/blob/main/api/DedicatedWorkerGlobalScope.json
8. **`device.destroy()` on full teardown (SPA unmount).** Spec: it unmaps all buffers, and "implementations can abort outstanding asynchronous operations immediately and free resource allocations". This frees everything in one call instead of relying on per-object `destroy()` plus GC. Source: https://gpuweb.github.io/gpuweb/#dom-gpudevice-destroy
