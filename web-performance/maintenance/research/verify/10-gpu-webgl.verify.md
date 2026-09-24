# Verify: 10-gpu-webgl.md

Checked 2026-09-23. 64 items: 54 verified, 10 corrected, 0 disputed, 0 unverified.

Data used:
- BCD 8.1.2 (npm build 2026-09-17, `raw/verify/02/bcd.json`)
- web-features `data.json` (read 2026-09-22), including `by_compat_key` Baseline dates
- Live web3dsurvey.com/webgl2 and /webgl, fetched 2026-09-23. They match the notes' numbers exactly.
- The live Khronos WebGL 1.0 and 2.0 editor's drafts (2026-06-30). Byte-identical to the saved copies.
- The live MDN "WebGL best practices" page (last modified 2025-11-03). Byte-identical to the saved copy.
- Current source: Chromium, WebKit and Firefox (`main`)

Raw files are in `raw/verify/10/`.

**Systematic wording fix (not counted per item):** many Status lines say "Baseline Widely available since September 2021" (WebGL2 APIs), "since July 2015" (WebGL1 APIs) or "since April 2018" (`WEBGL_lose_context`). These dates are when each feature became Baseline *newly* available. The widely-available dates are 30 months later:

| Feature | Newly available | Widely available |
|---|---|---|
| `webgl2` | 2021-09-20 | 2024-03-20 |
| `webgl` | 2015-07-29 | 2018-01-29 |
| `webgl-lose-context` | 2018-04-30 | 2020-10-30 |

As of 2026-09, all of them are widely available, so only the "since" date needs a fix. Suggested wording: "Baseline Widely available (newly available Sept 2021, widely available Mar 2024)". Evidence: https://webstatus.dev/features/webgl2 ; https://webstatus.dev/features/webgl ; https://webstatus.dev/features/webgl-lose-context

### Create a WebGL2 context and treat WebGL1 as the fallback
- Verdict: verified
- Evidence: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ("observed to give a solid 3-7% speed improvement"; "Unreal Engine 4 ... yielded 7% faster throughput"). The spec's "Extension Functionality Moved to Core" list includes OES_standard_derivatives and OES_texture_float but "not OES_texture_float_linear": https://registry.khronos.org/webgl/specs/latest/2.0/ . BCD `api.HTMLCanvasElement.getContext.webgl2_context`: Chrome 56, Firefox 51, Safari 15 (the `WebGL2RenderingContext` interface is Chrome Android 58). web3dsurvey reports "97.21% overall support": https://web3dsurvey.com/webgl2
- Note: The 3-7% number comes from Emscripten/Wasm ports, where WebGL1 needed `subarray()` views on the heap. Hand-written TypeScript gains less unless it would otherwise create views per call. See the Baseline wording fix above.

### Request only the drawing-buffer features you use (depth, stencil, antialias)
- Verdict: corrected
- Correction: The Why line cites Emscripten's "minimum set of alpha, depth, stencil and MSAA features". But Emscripten's full sentence also says canvas alpha "should be disabled", which contradicts the next item (keep `alpha: true`). Scope the citation to depth, stencil and MSAA, and point to the alpha item for alpha. The other facts check out: the spec defaults (`alpha:true, depth:true, stencil:false, antialias:true`), the rule that "`true`" is a request while "`false`" must be obeyed, and the first-`getContext`-only rule. The memory arithmetic (8.29 MB per 1080p RGBA8 plane; 66.4 MB for 4x MSAA color + depth) is correct.
- Evidence: https://registry.khronos.org/webgl/specs/latest/1.0/ ("The depth, stencil and antialias attributes, when set to true, are requests, not requirements"). https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ("support for alpha blending the canvas against the HTML page background is not needed, and should be disabled"). https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/getContextAttributes

### Keep preserveDrawingBuffer false and read the canvas in the same task as the draw
- Verdict: verified
- Evidence: https://registry.khronos.org/webgl/specs/latest/1.0/ ("it can cause significant performance loss on some platforms. Whenever possible this flag should remain false"). https://developer.chrome.com/blog/desynchronized recommends `preserveDrawingBuffer: true` to avoid flicker in desynchronized mode. That article was last updated 2019-05-02.

### Keep alpha: true and write opaque alpha instead of reaching for alpha: false
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("Avoid alpha:false, which can be expensive"). https://webgl2fundamentals.org/webgl/lessons/webgl-and-alpha.html ("This is probably the best option"). https://emscripten.org/docs/optimizing/Optimizing-WebGL.html (alpha "should be disabled")
- Note: The conflict has three sources, not two: Emscripten sides with webgl2fundamentals. The item's "measure first" framing stays correct. Firefox also has a `webgl.default-no-alpha` pref (default false).

### Write premultiplied colors when premultipliedAlpha is true
- Verdict: verified
- Evidence: https://registry.khronos.org/webgl/specs/latest/1.0/ ("vec4(1.0, 0.0, 0.0, 0.5) might display as green instead of red ... left undefined due to the intractible performance impact")

### Leave powerPreference at "default"; ask for "high-performance" only with evidence
- Verdict: verified
- Evidence: https://registry.khronos.org/webgl/specs/latest/1.0/ ("User Agents are very likely to decide to lose background high-performance contexts"). BCD `options_powerPreference_parameter`: Chrome 75 and Firefox 63 are partial ("respects the GPU hint on macOS only"), Safari 10.1 / 15. web-features marks this key as not Baseline. https://github.com/mdn/browser-compat-data/blob/main/api/HTMLCanvasElement.json

### Probe failIfMajorPerformanceCaveat to detect software rendering
- Verdict: corrected
- Correction:
  - **Firefox ignores the flag by default.** The pref `webgl.disable-fail-if-major-performance-caveat` is `true`, and `ClientWebGLContext::CreateHostContext` sets `options.failIfMajorPerformanceCaveat = false`. The only remaining check is for a software WebRender compositor. So in Firefox the probe almost never fails, even on a slow GPU.
  - **Chrome desktop 139+ no longer falls back to SwiftShader.** When no usable GPU exists, `getContext` returns `null` instead of a slow context (chromestatus 5166674414927872, "Deprecated", desktop 139). An experiment uses D3D11 WARP as the software fallback on Windows. So the retry without the flag can also return `null`, and the code must go to Canvas2D or a message.
  - Add the size of the problem: web3dsurvey says "3.75% may run with reduced performance" (WebGL2).
  - BCD versions are correct: WebGL option Chrome 33 / Firefox 41 / Safari 10.1; WebGL2 option Chrome 56 / Firefox 41 / Safari 15.
- Evidence: https://searchfox.org/mozilla-central/source/modules/libpref/init/StaticPrefList.yaml (`webgl.disable-fail-if-major-performance-caveat`, value `true`). https://searchfox.org/mozilla-central/source/dom/canvas/ClientWebGLContext.cpp (line 876). https://chromestatus.com/feature/5166674414927872 ("WebGL context creation will fail instead of falling back to SwiftShader"). https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md . https://issues.chromium.org/issues/402163834 (WARP experiment). https://web3dsurvey.com/webgl2

### Use desynchronized only for pen-latency work, and only where Chrome honors it
- Verdict: verified
- Evidence: BCD `options_desynchronized_parameter`: Chrome 81 ("ChromeOS and Windows"; 75-81 ChromeOS only), Chrome Android 75, Firefox and Safari no. web-features `webgl-desynchronized` and `webgl2-desynchronized` are not Baseline. https://developer.chrome.com/blog/desynchronized ("must not have any other DOM elements above it")

### Size the backing store in device pixels, and only when the size changes
- Verdict: verified
- Evidence: BCD `api.ResizeObserverEntry.devicePixelContentBoxSize`: Chrome 84, Firefox 108 (93-108 partial), Safari no (BCD 8.1.2, 2026-09-17). WebKit bug 219005 is still open: https://bugs.webkit.org/show_bug.cgi?id=219005 . BCD `drawingBufferStorage`: Chrome 122, experimental. The spec says "a drawing buffer with smaller dimensions shall be created" and describes `drawingBufferStorage` as "efficiently respecifying width and height together": https://registry.khronos.org/webgl/specs/latest/1.0/ . MDN also offers a CSS "pre-snap" fallback for browsers without `device-pixel-content-box`.

### Cap the pixel count: limit devicePixelRatio or render to a smaller back buffer
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("Consider rendering to a smaller back buffer"). https://webgl2fundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html ("drawing 9 times as many pixels"). https://webgl2fundamentals.org/webgl/lessons/webgl-qna-optimize-drawing-lots-of-large-images.html ("late 2018 Macbook Air with Intel UHD Graphics 617 I can only draw about 5 million pixels per frame at 60fps"). 5120x2880 = 14,745,600 pixels.

### Render many charts through one context with viewport + scissor
- Verdict: corrected
- Correction: The default cap is now confirmed in source.
  - Chromium: 16 active contexts on desktop, 8 on Android, 4 in workers (`content/renderer/webgraphicscontext3d_provider_impl.cc` lines 122-127: `max_active_webgl_contexts = 8u` on Android, else `16u`, and `max_active_webgl_contexts_on_worker = 4u`). The `--max-active-webgl-contexts` flag overrides both.
  - WebKit/Safari: `maxActiveContexts = 16`, `maxActiveWorkerContexts = 4`.
  - Firefox: `webgl.max-contexts` 1000 and `webgl.max-contexts-per-principal` 300.

  Replace "default number not confirmed in source ... bug reports cite 16" with these numbers. The eviction mechanism is correct: `ActivateContext` → `ForciblyLoseOldestContext`, which picks the lowest `GetLastFlushIdCHROMIUM` and logs "WARNING: Too many active WebGL contexts. Oldest context will be lost."
- Evidence: https://source.chromium.org/chromium/chromium/src/+/main:content/renderer/webgraphicscontext3d_provider_impl.cc ; https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc ; https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/canvas/WebGLRenderingContextBase.cpp (lines 193-194) ; https://searchfox.org/mozilla-central/source/modules/libpref/init/StaticPrefList.yaml ; https://webgl2fundamentals.org/webgl/lessons/webgl-multiple-views.html ("For many it's as low as 8")

### Lose the context of a destroyed chart explicitly
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("Lose contexts eagerly ... don't add an unload event handler just for this purpose"). web3dsurvey `WEBGL_lose_context` 99.99%. See the Baseline wording fix above.
- Note: Chromium restores force-evicted contexts (those whose page called `preventDefault`) only when an active context is garbage-collected (`RestoreEvictedContext`). Explicit loss plus dropping references frees a slot sooner.

### Handle context loss and restore, and keep the data needed to rebuild
- Verdict: corrected
- Correction: "Create functions return `null` while lost" is outdated. The current spec declares `WebGLBuffer createBuffer()`, `createTexture()`, `createProgram()` and the other create functions as non-nullable, and says "A WebGLObject created while the context is lost (e.g. a WebGLBuffer via createBuffer()) begins life with its invalidated flag set." Chromium, Firefox and WebKit IDLs all declare these as non-nullable; Chromium's `createBuffer()` has no lost-context check. Rewrite the Why line: objects created while lost are non-null but invalidated, and all old objects are invalid after restore. The advice (rebuild everything from CPU-side data; do not keep state on WebGL objects) is unchanged. The other facts check out: `preventDefault()` is needed for restore, completion queries return `true` while lost, and MDN lists the causes.
- Evidence: https://registry.khronos.org/webgl/specs/latest/1.0/ (IDL `WebGLBuffer createBuffer();` and the context-lost section). https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.idl (line 513) ; https://searchfox.org/mozilla-central/source/dom/webidl/WebGLRenderingContext.webidl (line 580) ; https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/canvas/WebGLRenderingContextBase.idl (line 523). https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/ ("When the context is lost, completion status queries must return true unconditionally")

### Move rendering to an OffscreenCanvas in a worker when the main thread is busy
- Verdict: corrected
- Correction:
  - Chromium and WebKit both cap WebGL contexts in workers at 4 (see the multi-chart item). Replace "a separate, lower active-context cap for workers" with "4 contexts per worker thread in Chrome and Safari". With several worker-rendered charts, share one context.
  - Status addition: WebGL/WebGL2 on `OffscreenCanvas` is Baseline widely available since 2026-03-18 (newly available 2023-09-18, Safari 17). The 2025-09-27 widely-available date covers only the 2D context.
  - The other versions are correct: OffscreenCanvas Chrome 69 / Firefox 105 / Safari 16.4; worker rAF Chrome 69 / Firefox 99 / Safari 16.4, with the nested-worker note.
- Evidence: web-features `offscreen-canvas` `by_compat_key` `api.OffscreenCanvas.getContext.webgl2_context`: high, 2023-09-18 → 2026-03-18 (https://webstatus.dev/features/offscreen-canvas). BCD `api.DedicatedWorkerGlobalScope.requestAnimationFrame`. https://source.chromium.org/chromium/chromium/src/+/main:content/renderer/webgraphicscontext3d_provider_impl.cc ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-rendering-slowly-over-time.html ("most GPUs do not support pre-emptive multitasking")

### Render on demand and coalesce data ticks into one frame
- Verdict: verified
- Evidence: https://registry.khronos.org/webgl/specs/latest/1.0/ ("WebGL presents its drawing buffer ... only if at least one of the following have been called since the previous compositing operation")

### Drive frames with requestAnimationFrame and flush only outside rAF
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("Because RAF is directly followed by the frame boundary, an explicit webgl.flush() isn't really needed with RAF"). Current Chromium source: `WebGLRenderingContextBase::finish()` calls `ContextGL()->Flush(); // Intentionally a flush, not a finish.` (webgl_rendering_context_base.cc)

### Cache static layers in a texture and redraw only the layers that change
- Verdict: verified
- Evidence: https://webgl2fundamentals.org/webgl/lessons/webgl-qna-how-to-optimize-rendering-a-ui.html ("Draw the inventory in to a texture ... Only update the parts of the texture that change")

### Put fast-changing overlays and sparse text in DOM or a 2D layer
- Verdict: verified
- Evidence: https://webgl2fundamentals.org/webgl/lessons/webgl-qna-how-to-optimize-rendering-a-ui.html ("It might be faster to just use HTML"). https://webgl2fundamentals.org/webgl/lessons/webgl-text-html.html (text nodes created once)

### Batch draw calls by shared state; use atlases and strip joins
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("If you have 1000 sprites to paint, try to do it as a single drawArrays() or drawElements() call"). https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ("using vertex shader primitive restart index would cause the GL driver to fall back to running vertex shaders in software"). http://nical.github.io/onGameStart2013/ ("This is generally the most important optimization!")
- Note: In WebGL2 primitive restart is always on and applies only to indexed draws (spec, "PRIMITIVE_RESTART_FIXED_INDEX is always enabled").

### Use instancing for repeated marks (candles, bars, markers, segments)
- Verdict: verified
- Evidence: https://webgl2fundamentals.org/webgl/lessons/webgl-qna-the-fastest-way-to-draw-many-circles.html ("20k-30k quads at 60fps"; "60k-66k in all cases in Chrome"; "as of 2019-10"; repeated geometry gave the same speed). BCD `api.WebGL2RenderingContext.drawArraysInstanced` (Baseline 2021-09-20, widely 2024-03-20)

### Draw thick lines as instanced quads, never with gl.lineWidth
- Verdict: verified
- Evidence: https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html ("you should basically assume the max line thickness is 1.0"). https://wwwtyro.net/2019/11/18/instanced-lines.html: 5 lines × 100,000 points = 500k points at interactive speed "on an old chromebook", with one buffer for both endpoint attributes.

### Use WEBGL_multi_draw for many ranges with one program, with a loop fallback
- Verdict: verified
- Evidence: BCD `api.WEBGL_multi_draw`: Chrome 86, Safari 15, Firefox no. Firefox's extension list (dom/canvas/WebGLContextExtensions.cpp) has no WEBGL_multi_draw. web3dsurvey 93.1%. https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_multi_draw ("reduces binding costs in the renderer and speeds up GPU thread time with uniform data"; `#extension GL_ANGLE_multi_draw`)

### Build one VAO per geometry layout at init and do not mutate VAOs per draw
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("For unchanged VAOs, browsers can cache the fetch limits"). https://webgl2fundamentals.org/webgl/lessons/webgl-drawing-multiple-things.html ("9 to 16 calls to setup the attributes")

### Sort draws by target, program, then bindings, and skip redundant state calls
- Verdict: verified
- Evidence: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ("a renderer that inherently avoids redundant state calls ... is generally more efficient than one that relies heavily on state caching"). https://webgl2fundamentals.org/webgl/lessons/webgl-drawing-multiple-things.html ("with vertex array objects I'm not so sure the optimizations matter that much")

### Look up locations, parameters and extensions once
- Verdict: verified
- Evidence: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ("Do not call glGetUniformLocation() at render time"). http://nical.github.io/onGameStart2013/ ("Avoid gl.uniform1f(gl.getUniformLocation(program, "time"), time)"). https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html
- Note: The caveat's "breaks under context loss" is now about stale or invalidated objects, not `null` (see the context-loss item).

### Put shared per-frame uniforms in a uniform buffer object
- Verdict: verified
- Evidence: https://registry.khronos.org/webgl/specs/latest/2.0/ ("Only std140 layout supported in uniform blocks"; "UNIFORM_BUFFER_OFFSET_ALIGNMENT must be divisible by 4"; "Active Uniform Block Backing" → INVALID_OPERATION). web3dsurvey `MAX_UNIFORM_BLOCK_SIZE`: ≥16384 in 100% of reports, ≥32768 in 74%.

### Keep vertex attribute 0 enabled as an array
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("in desktop OpenGL, nothing gets drawn if vertex attrib 0 is not array-enabled")

### Use WEBGL_provoking_vertex FIRST convention with flat varyings
- Verdict: verified
- Evidence: BCD 8.1.2 has no `api.WEBGL_provoking_vertex` (confirmed missing). web3dsurvey 76.86%. Firefox implements it and exposes it on ANGLE ("Better on D3D"): dom/canvas/WebGLContextExtensions.cpp. https://registry.khronos.org/webgl/extensions/WEBGL_provoking_vertex/

### Allocate buffers once with headroom and update sub-ranges with bufferSubData
- Verdict: verified
- Evidence: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ("use std::vector-style geometric array grow semantics"; "Prefer calling glBufferSubData() ... even when the whole contents ... changes"). https://registry.khronos.org/webgl/specs/latest/2.0/ (srcOffset and length in elements)

### Do not orphan buffers; rotate two or three buffers instead
- Verdict: verified
- Evidence: https://groups.google.com/g/webgl-dev-list/c/vMNXSNRAg8M (2014-07-11). Jeff Gilbert, posting as "Jeff Dash": bufferData(null) "causes us to upload a calloc'd buffer ... strictly worse". Ken Russell: "keeping around two buffers of the same size and alternating". https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ("double- or even triple-buffering VBOs")

### Stream appended points into a ring-buffer region
- Verdict: verified
- Evidence: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html (sub-range updates). The ring pattern is the notes' own synthesis, labeled as such. The example's `head * 8` byte offset is correct for float32 xy pairs.

### Pick buffer usage hints that match the real update rate
- Verdict: verified
- Evidence: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ("Prefer using GL_DYNAMIC vertex buffers over GL_STREAM"). https://registry.khronos.org/webgl/specs/latest/2.0/ ("Avoid overuse of buffers allocated with _READ usage hints, as they may incur overhead in maintaining a shadow copy")

### Interleave attributes that change together and split static from dynamic
- Verdict: verified
- Evidence: https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/TechniquesforWorkingwithVertexData/TechniquesforWorkingwithVertexData.html ("An exception to this rule is when your app needs to update some vertex data at a rate different from the rest"). https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/vertexAttribPointer

### Use the smallest vertex type that keeps enough precision
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/vertexAttribPointer (20-byte vertex; stride "Cannot be negative or larger than 255"). BCD `javascript.builtins.Float16Array`: Chrome 135, Firefox 129, Safari 18.2. web-features `float16array`: Baseline newly available 2025-04-04. The Apple guide recommends `GL_UNSIGNED_BYTE` colors and 4-byte alignment.

### Prefer Uint16 indices and avoid rewriting index buffers
- Verdict: corrected
- Correction: Fix the attribution. Kelsey Gilbert wrote that Firefox "invalidate[s] at upload time (and make[s] a cpu-side copy)" and validates indices at draw time "with a (pretty naive) cache". It does not validate at upload. Ken Russell wrote "In Chrome also this cache is only supposed to be revalidated during draw calls." The thread (2022-08-01) was about pauses during `bufferSubData`. The claim that "large, often-updated index buffers cause pauses" is an inference; label it as one. The spec facts are correct: primitive restart is always on, and indices above `MAX_ELEMENT_INDEX` cause INVALID_OPERATION. web3dsurvey `MAX_ELEMENT_INDEX` ≥ 1073741823 in 100% of reports.
- Evidence: https://groups.google.com/g/webgl-dev-list/c/8gfFD7eTUYQ ; https://registry.khronos.org/webgl/specs/latest/2.0/ ("Range Checking"; "PRIMITIVE_RESTART_FIXED_INDEX is always enabled") ; https://web3dsurvey.com/webgl2

### Reuse typed arrays and use the WebGL2 srcOffset/length overloads
- Verdict: verified
- Evidence: https://registry.khronos.org/webgl/specs/latest/2.0/ (WebGL2RenderingContextOverloads). https://webgl2fundamentals.org/webgl/lessons/webgl-text-glyphs.html ("allocates new Float32Arrays each time ... probably going to eventually cause garbage collection hiccups")

### Never put raw Unix-millisecond timestamps in float32
- Verdict: verified
- Evidence: Recomputed: float32 spacing at 1.79e12 is 131,072 ms, and `Math.fround(1790000000000)` = 1789999972352 (−27,648 ms). Spacing is 8 ms within 1 day, 256 ms within 30 days and 2,048 ms within 1 year. 65,000 has a spacing of 0.00390625. https://help.agi.com/AGIComponents/html/BlogPrecisionsPrecisions.htm ("The largest number that allows approximate 1 cm increments is 131,071")

### Transform relative to the visible origin, and split doubles for extreme ranges
- Verdict: verified
- Evidence: https://help.agi.com/AGIComponents/html/BlogPrecisionsPrecisions.htm ("1.353 cm"; "a typical vertex is 32 bytes ... would be 44 bytes"). https://godotengine.org/article/emulating-double-precision-gpu-render-large-worlds/ (2022-10-17; `float(some_double - double(some_float1))`; says nothing about compiler reordering). https://deck.gl/docs/developer-guide/coordinate-systems ("deck.gl may apply a dynamic translation to common-space positions, determined by the viewport")

### Use highp for coordinates and allow mediump only for bounded values
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices. The ESSL300 table gives mediump "IEEE float16 (-2^14, 2^14) ... 2^-10 relative" and lowp "10-bit signed fixed (-2, 2)". The page also says "iOS requires that you use `highp sampler2D foo;`". https://webgl2fundamentals.org/webgl/lessons/webgl-precision-issues.html ("1000*1000 is 1000000")
- Note: The vertex language's implicit default is also `precision lowp sampler2D`. The `highp sampler2D` rule therefore also applies to vertex-shader `texelFetch` (see the texelFetch item).

### Check float render, filter and blend support before using float targets
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("Float16-blending is always supported"). BCD `api.EXT_float_blend`: Safari iOS 15-16 (removed). BCD `api.OES_texture_float_linear`: Safari iOS note "Only supported on iPadOS". web3dsurvey: EXT_color_buffer_float 99.94%, OES_texture_float_linear 90.58%, EXT_float_blend 93.76%.
- Note: By web3dsurvey numbers, OES_texture_float_linear (90.58%) is no longer the most-missing WebGL2 extension. EXT_disjoint_timer_query_webgl2 is at 67.1%, KHR_parallel_shader_compile at 75.45% and WEBGL_provoking_vertex at 76.86%. webgl2fundamentals says "Probably the most common missing extension on WebGL1 and WebGL2", not "on mobile".

### Compile all shaders, link all programs, then check LINK_STATUS once
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("many browsers can compile and link in parallel on background threads"; "Don't check shader compile status unless linking fails"; "querying compile status is a synchronous call, which breaks pipelining")

### Use KHR_parallel_shader_compile and warm up programs before interaction
- Verdict: verified
- Evidence: BCD `api.KHR_parallel_shader_compile`: Chrome 76, Safari 14.1 (iOS 14.5), Firefox no. Firefox's source extension list does not include it. web-features: not Baseline. web3dsurvey 75.45%. https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/

### Create GPU objects at load and delete them eagerly, but outside the frame loop
- Verdict: verified
- Evidence: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ("glDelete*() can introduce a full pipeline flush if the driver detects that any of the resources are in use"). https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("Delete objects eagerly"). MDN says shader handles can be deleted "after attaching them to a program object"; deleting after link, as the notes say, is also valid.

### Move per-pixel work to the vertex shader and use builtins
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("Prefer doing work in the vertex shader"; "Prefer builtins"). http://nical.github.io/onGameStart2013/ ("Branching is slow! Often the cost of computing both A and B"). The Apple shader guide ranks branches: constant best, uniform acceptable, computed potentially slow.

### Avoid discard, needless blending and overdraw
- Verdict: verified
- Evidence: https://webgl2fundamentals.org/webgl/lessons/webgl-qna-the-fastest-way-to-draw-many-circles.html ("my impression is discard is slower"). https://emscripten.org/docs/optimizing/Optimizing-WebGL.html (overdraw; sort by FBO, which "helps tile based renderers"). Additional support for "alpha coverage over discard": https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/Performance/Performance.html ("Instead of using alpha testing or discard instructions to kill pixels, use alpha blending with alpha set to zero")

### Allocate textures with texStorage2D and update with texSubImage2D
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("some drivers might unconditionally allocate the whole mip-chain (+30% memory!)"). https://registry.khronos.org/webgl/specs/latest/2.0/ ("Uninitialized Compressed Textures ... Users can use texStorage2D with a compressed internal format to allocate zero-initialized compressed textures")

### Mipmap only textures that are drawn minified
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("only 30% overhead"; `TEXTURE_MIN_FILTER` "Defaults to NEAREST_MIPMAP_LINEAR"). https://webgl2fundamentals.org/webgl/lessons/webgl-qna-optimize-drawing-lots-of-large-images.html ("slower to draw a 2x2 quad using a 1024x1024 texture without mips")

### Use RGBA8 instead of RGB8, and budget depth/stencil at 4 bytes per pixel
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("RGB8 in particular is often surprisingly slow"; "Assume that the memory usage of depth and stencil formats is rounded up to the nearest four bytes")

### Upload DOM-sourced textures before drawing, preferably from ImageBitmap
- Verdict: corrected
- Correction:
  - **Color space.** In the spec's `texImage2D(... TexImageSource)` text, color-space conversion to `unpackColorSpace` (unless `UNPACK_COLORSPACE_CONVERSION_WEBGL` is `NONE`) "applies to ImageBitmap objects as well". Only the *other* unpack parameters (`UNPACK_FLIP_Y_WEBGL`, `UNPACK_PREMULTIPLY_ALPHA_WEBGL`) are ignored for ImageBitmaps. The Pixel Storage Parameters section still says all three are ignored, so the spec contradicts itself. Say "flipY and premultiply are ignored; set `colorSpaceConversion: 'none'` on the ImageBitmap and treat the WebGL colorspace setting as possibly still applied".
  - **ImageBitmap support is weak.** The cited webgl2fundamentals Q&A is skeptical of ImageBitmap: "There's no reason to use createImageBitmap in a worker", and "I see jank every 6 or so images" even with ImageBitmap. Keep "upload before drawing" (MDN), but weaken "preferably from ImageBitmap" to "ImageBitmap may avoid a re-decode; measure".
  - **Status additions.** web-features `createimagebitmap` is Baseline widely available since 2026-06-11 (newly 2023-12-11); `premultiplyAlpha` is widely available since 2026-03-18. The BCD versions in the notes are correct.
- Evidence: https://registry.khronos.org/webgl/specs/latest/1.0/ (texImage2D TexImageSource: "This color space conversion applies to ImageBitmap objects as well, though other texture unpack parameters do not apply to ImageBitmaps"). https://webgl2fundamentals.org/webgl/lessons/webgl-qna-how-to-load-images-in-the-background-with-no-jank.html . https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices . https://webstatus.dev/features/createimagebitmap

### Avoid per-upload conversions (premultiply, flip, color space)
- Verdict: verified
- Evidence: https://webgl2fundamentals.org/webgl/lessons/webgl-and-alpha.html ("when you transfer them to WebGL and UNPACK_PREMULTIPLY_ALPHA_WEBGL is false WebGL will convert them back to un-premultipiled"; "pre-multiplied is lossy"). https://registry.khronos.org/webgl/specs/latest/1.0/ (Pixel Storage Parameters: "If set to NONE, no colorspace conversion is applied")

### Draw text from a glyph atlas (or DOM), not one texture or draw per label
- Verdict: verified
- Evidence: https://webgl2fundamentals.org/webgl/lessons/webgl-text-glyphs.html ("Unfortunately it's SLOW ... we're individually drawing 73 quads"; the OS and browsers use a glyph texture cache that replaces the least recently used glyph)

### Use compressed textures (KTX2 / Basis Universal) for large image assets
- Verdict: corrected
- Correction: "S3TC desktop only" is not what BCD says. BCD `api.WEBGL_compressed_texture_s3tc` lists Chrome 26, Firefox 22, Safari 8 **and Safari iOS 8**; only Chrome Android is `false`. Real availability depends on the hardware (web3dsurvey 86.08% of WebGL2 reports). The other versions and numbers are correct: ASTC Chrome 47 / Firefox 53 / Safari 12; ETC Chrome 63 / Firefox 55 / Safari 13.1; ASTC 47.49%, ETC 48.34%, BPTC 84%. The spec's "Required compressed texture formats" (ETC and/or S3TC + S3TC_sRGB + RGTC) is also correct.
- Evidence: https://github.com/mdn/browser-compat-data/blob/main/api/WEBGL_compressed_texture_s3tc.json ; https://registry.khronos.org/webgl/specs/latest/2.0/ ; https://web3dsurvey.com/webgl2 ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices

### Store bulk per-item data in textures and fetch it with texelFetch when attributes do not fit
- Verdict: verified
- Evidence: https://webgl2fundamentals.org/webgl/lessons/webgl-qna-sorting-and-optimizing-instanced-rendering.html ("drawing 2000 independent objects from 4 different models in 1 draw call ... Pulling data from textures like this is likely slower than not"). https://webgl2fundamentals.org/webgl/lessons/webgl-pulling-vertices.html ("might be slower than the more traditional way")
- Note: Declare `highp sampler2D`/`highp usampler2D` in the vertex shader too, because the vertex default is `lowp sampler2D` (MDN "Implicit defaults").

### Stay within portable limits and query them once at init
- Verdict: verified
- Evidence: MDN's "Understand system limits" block (MAX_TEXTURE_SIZE 4096 … MAX_FRAGMENT_UNIFORM_VECTORS 64, ALIASED_POINT_SIZE_RANGE [1,100]). web3dsurvey WebGL2 MAX_TEXTURE_SIZE: ≥4096 100%, ≥16384 86%. https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html ("doesn't mean that GPU has enough memory")
- Note: MDN's list is conservative. web3dsurvey reports MAX_FRAGMENT_UNIFORM_VECTORS ≥ 256 and MAX_TEXTURE_IMAGE_UNITS ≥ 16 in 100% of WebGL1 reports.

### Build framebuffers once and switch with one bind
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("setting the pref webgl.perf.max-warnings to -1 in about:config will enable performance warnings"). Firefox pref default `webgl.perf.max-warnings` = 0 (StaticPrefList.yaml). https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ("prefer to set up multiple immutable/static FBOs")

### Invalidate depth, stencil and MSAA attachments after their last use
- Verdict: corrected
- Correction: Add to Avoid/caveats: **Firefox makes it a no-op by default.** `WebGL2Context::InvalidateFramebuffer` calls the driver only when `mAllowFBInvalidation` is set, and the pref `webgl.allow-fb-invalidation` defaults to `false` ("No-op for now"). The call is safe to keep, but no gain appears in Firefox. The spec text ("contents ... either stay unchanged or become cleared") and MDN's tiled-GPU rationale are correct.
- Evidence: https://searchfox.org/mozilla-central/source/dom/canvas/WebGL2ContextFramebuffers.cpp (lines ~183-206) ; https://searchfox.org/mozilla-central/source/modules/libpref/init/StaticPrefList.yaml (`webgl.allow-fb-invalidation`, value false) ; https://registry.khronos.org/webgl/specs/latest/2.0/ ("Framebuffer contents after invalidation")

### Read back asynchronously with PIXEL_PACK_BUFFER + fenceSync
- Verdict: verified
- Evidence: https://registry.khronos.org/webgl/specs/latest/2.0/ ("This is a blocking operation ... Consider instead using readPixels into a PIXEL_PACK_BUFFER"; "a sync object must never transition to the signaled state in the same frame"; "It is acceptable for an implementation to impose a zero maximum timeout"). web3dsurvey MAX_CLIENT_WAIT_TIMEOUT_WEBGL ≥ 1e9 ns in 7% of reports. MDN's `readPixelsAsync` sample uses `STREAM_READ`.

### Hit-test chart data on the CPU instead of GPU picking with readPixels
- Verdict: verified
- Evidence: https://webgl2fundamentals.org/webgl/lessons/webgl-picking.html (frustum covering "1 pixel"). The CPU-first recommendation is labeled as inference in the notes.

### Keep blocking queries out of production hot paths
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("Even basic requests can take as long as 1ms, but they can take even longer ..."; "within Firefox, the only time glGetError is checked is after allocations"). https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ("Never call glGetError() or glCheckFramebufferStatus() at render time")

### Time GPU work with EXT_disjoint_timer_query_webgl2, not gl.finish
- Verdict: verified
- Evidence: BCD `api.EXT_disjoint_timer_query_webgl2`: Chrome 70 (and 56-62), Edge 80, Firefox, Safari and Chrome Android no. web3dsurvey 67.1%. Chromium enables timer queries only where site isolation is active; `gpu_util.cc` also enables them on Android desktop. Chromium `finish()` is "Intentionally a flush". https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/ (last modified 2023-06-01)
- Note: The Mozilla 2013 talk suggests `gl.finish()` "(but not in production!)" for profiling. The item's advice is the more current one.

### Budget VRAM per pixel and track the bytes of every resource
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("One technique pioneered by the Google Maps team is the notion of a per-pixel VRAM budget")

### Ship with zero WebGL errors and read the browser's performance warnings
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("After too many errors (32 in Firefox)"). Firefox pref `webgl.max-warnings-per-context` = 32. https://webgl2fundamentals.org/webgl/lessons/webgl-qna-tex-image-texture_2d-level-0-is-incurring-lazy-initialization.html ("the workaround to stop the warning is worse than the warning itself")

### Find the bottleneck by shrinking the canvas and zeroing draw counts
- Verdict: verified
- Evidence: https://webgl2fundamentals.org/webgl/lessons/webgl-qna-a-simple-way-to-show-the-load-on-the-gpu-s-vertex-and-fragment-processing-.html
- Note: The "pipelining makes profilers blame the wrong calls" point comes from the Mozilla 2013 talk ("Due to pipelining, calls that show up in profiles are not always the ones that actually take time"), not from Emscripten. Emscripten lists the profilers.

### Test on low-end and mobile GPUs, not only the development desktop
- Verdict: corrected
- Correction: A "software-rendering run (`failIfMajorPerformanceCaveat` path)" is not reachable by default any more. Chrome desktop 139+ returns `null` instead of falling back to SwiftShader; testing software WebGL needs `--enable-unsafe-swiftshader` or `--use-angle=swiftshader` (15-gaps-round-2 found platform-dependent results). Firefox ignores `failIfMajorPerformanceCaveat` by default. Change the matrix entry to a "no-GPU run" that checks the `null`-context fallback, plus an optional opt-in SwiftShader run. The "100x faster" and "mediump is highp on desktop" claims are correct.
- Evidence: https://chromestatus.com/feature/5166674414927872 ; https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md ; https://searchfox.org/mozilla-central/source/dom/canvas/ClientWebGLContext.cpp ; https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html ("A top end GPU probably runs 100x faster than a low-end GPU")

## Cross-file conflicts

1. **Context cap.** 10 says the Chromium default is "not confirmed" (with "as low as 8" from webgl2fundamentals). 11-gpu-webgpu.md's table says "~16 live contexts in Chrome/Safari". 13-scichart.md:346 says "16 for Chrome/Edge/Safari desktop and iOS, 8 for Chrome Android, 300 for Firefox". Source resolves it: Chromium 16 desktop / 8 Android / 4 per worker; WebKit 16 / 4 workers; Firefox 1000 total / 300 per principal. 13 is correct. 11 and 10 should add Android 8 and workers 4.
2. **Software fallback.** 10 (probe `failIfMajorPerformanceCaveat` → reduced mode; "software-rendering run") conflicts with 15-gaps-round-2.md:231-254 and 16-explore-fast-batch-06.md:245-246. Those files say Chrome 139+ returns `null` (no SwiftShader) and that WebGL2 absence needs an error path. 10 should adopt that and add that Firefox ignores the flag.
3. **alpha: false.** 10 (keep `alpha: true`), 12-canvas2d-and-images.md:37 and 19-skill-design.md:1136 agree. 11-gpu-webgpu.md:1052's WebGL-vs-WebGPU benchmark example uses `alpha: false`. Emscripten, cited by 10's own item 2, also says to disable alpha. Align 11's example or state that it is a benchmark-only setting.
4. **Readback.** 11-gpu-webgpu.md:1100 (table) says WebGL readback is "Blocking `readPixels`". 10 documents non-blocking WebGL2 readback (PIXEL_PACK_BUFFER + fenceSync + getBufferSubData). 11's table should say "blocking by default; async via PBO + fence in WebGL2".
5. **OffscreenCanvas WebGL status.** 01-critical-rendering-path.md:969 says WebGL/WebGL2 on OffscreenCanvas is "widely available (since 2026-03)", which is correct per web-features. 10 gives only versions, and 03/06/07/16 give 2025-09-27, which is the 2D-context date. Not wrong, but the WebGL-specific date is 2026-03-18.
6. **createImageBitmap Baseline.** 12-canvas2d-and-images.md:556 says "MDN: Baseline widely since 2021-09". 04:376 and 07:288 say Baseline 2023, widely available 2026-06-11 (web-features). 10 gives versions only. web-features' 2026-06-11 is the authoritative whole-feature date.
7. **powerPreference hint default.** 11-gpu-webgpu.md:32-38 ("prefer 'low-power' or no hint") and 10 ("leave at 'default'; 'low-power' for light charts") are consistent. No conflict, noted for completeness.

## Missing but important

1. **Handle a `null` WebGL2 context and read `webglcontextcreationerror`.** Chrome desktop 139+ gives no SwiftShader fallback. The spec's `webglcontextcreationerror` event carries a `statusMessage` for telemetry; web-features says it has been widely available since 2019-03-20. Emscripten also recommends it. Sources: https://chromestatus.com/feature/5166674414927872 ; https://registry.khronos.org/webgl/specs/latest/1.0/ (context creation error event) ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html
2. **Worker context cap of 4 (Chrome and Safari).** This limits "one worker per chart" designs; share one worker context. Sources: https://source.chromium.org/chromium/chromium/src/+/main:content/renderer/webgraphicscontext3d_provider_impl.cc ; https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/canvas/WebGLRenderingContextBase.cpp
3. **One context → many canvases without CPU readback.** Render into an `OffscreenCanvas` WebGL context, call `transferToImageBitmap()`, and hand the bitmap to each chart canvas's `bitmaprenderer` context with `transferFromImageBitmap()` (ownership transfer, not a copy). This names the "copies into per-chart canvases" step that 10 leaves vague. WebGL on OffscreenCanvas is widely available since 2026-03-18. Sources: https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmapRenderingContext/transferFromImageBitmap ; https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/transferToImageBitmap
4. **Detect software rendering with a second signal.** Firefox ignores `failIfMajorPerformanceCaveat`. Read `WEBGL_debug_renderer_info` / `UNMASKED_RENDERER_WEBGL` (99.99% of reports) and match SwiftShader, llvmpipe, WARP or "Basic Render". Firefox sanitizes the renderer string (`webgl.sanitize-unmasked-renderer` = true), so matches there are coarse. Sources: https://web3dsurvey.com/webgl2 ; https://searchfox.org/mozilla-central/source/modules/libpref/init/StaticPrefList.yaml ; 15-gaps-round-2.md:283 (regex already in the notes set)
5. **Firefox no-ops `invalidateFramebuffer`.** Do not count on tile-memory savings in Firefox; measure on Safari and Chrome mobile. Source: https://searchfox.org/mozilla-central/source/dom/canvas/WebGL2ContextFramebuffers.cpp
6. **Evicted contexts come back only when a slot frees up.** Chromium re-enables force-evicted contexts (those that called `preventDefault`) only when an active context is garbage-collected. Explicit `loseContext()` plus dropping references on unmount lets evicted charts recover. Source: https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc (`RestoreEvictedContext`)
7. **`EXT_color_buffer_half_float` in WebGL2.** Some devices can render to RGBA16F but not to float32. Check it when `EXT_color_buffer_float` is missing (web3dsurvey 92.37%). Source: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ("EXT_color_buffer_half_float is present on systems which only support rendering to float16 textures")
8. **`EXT_texture_norm16` for data textures.** R16/RG16/RGBA16 normalized textures are filterable at half the bytes of float32, useful for heatmap bodies (web3dsurvey 84.97%). Sources: https://web3dsurvey.com/webgl2 ; https://registry.khronos.org/webgl/extensions/EXT_texture_norm16/
