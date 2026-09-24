# WebGL / WebGL2 efficiency

Scope: rules that change how WebGL / WebGL2 code is written for high-throughput 2D charts (SciChart.js-style: many series, streaming ticks, Unix-millisecond X axis). The notes cover context setup, canvas sizing, draw submission, buffers, vertex formats, precision, shaders, textures, framebuffers, readback, sync points, memory, context loss and workers.
Sources: MDN "WebGL best practices" (full page, last modified 2025-11-03) and related MDN API pages; the WebGL 1.0 and 2.0 specifications (Khronos registry, editor's draft 2026-06-30); webgl2fundamentals.org lessons and Q&A (by Gregg Tavares, ex-Google Chrome); Emscripten "Optimizing WebGL" (Mozilla origin); webgl-dev-list threads with answers from Chrome (Ken Russell) and Firefox (Jeff Gilbert / Kelsey Gilbert) engineers; MDN browser-compat-data (BCD) raw JSON; web3dsurvey.com hardware statistics (read 2026-09-22); Chromium source; precision articles from AGI (STK) and Godot.
Status numbers: "BCD" means MDN browser-compat-data main branch, read 2026-09-22. "web3dsurvey" means the share of WebGL2 reports that expose the extension, read 2026-09-22 (rolling data; the page gives no date window).

### Create a WebGL2 context and treat WebGL1 as the fallback
- Layer: js
- Stage: script-run, gpu-draw, gc-memory
- Metrics: FPS/smoothness, TBT, memory
- When: load
- Impact: medium, because WebGL2 entry points avoid temporary JS garbage and unlock instancing, VAOs, UBOs, texStorage, PBOs and fences in core.
- Do: Call `canvas.getContext('webgl2', attrs)` first. Fall back to `'webgl'` plus extensions only if it returns `null`. Write shaders as `#version 300 es`.
- Why: Emscripten reports that WebGL2's garbage-free JS bindings alone gave a 3-7% speed-up, and Unreal Engine 4 got 7% faster with no other change. WebGL2 also moves ANGLE_instanced_arrays, OES_vertex_array_object, OES_element_index_uint, float/half-float textures and more into core, so no extension checks are needed for them.
- Example:
  ```ts
  const gl = canvas.getContext('webgl2', attrs) as WebGL2RenderingContext | null;
  if (!gl) { /* WebGL1 path or Canvas2D fallback */ }
  ```
- Avoid/caveats: WebGL1 and WebGL2 are not source compatible (sized internal formats, `HALF_FLOAT` enum value changed from 0x8D61 to 0x140B, `#version 100` shaders lose OES_standard_derivatives in WebGL2). Keep one code path if possible.
- Status: WebGL2 context: Chrome 56, Firefox 51, Safari 15 (BCD); WebGL2 methods are "Baseline Widely available" since September 2021 (MDN). 97.21% of reports support WebGL2 (web3dsurvey).
- Sources: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext ; https://web3dsurvey.com/webgl2 ; https://webgl2fundamentals.org/webgl/lessons/webgl2-whats-new.html

### Request only the drawing-buffer features you use (depth, stencil, antialias)
- Layer: gpu
- Stage: gpu-draw, composite, gc-memory
- Metrics: memory, FPS/smoothness
- When: load
- Impact: high for memory on HiDPI screens, because each default-framebuffer attachment scales with device pixels and MSAA multiplies it.
- Do: Pass `depth: false` for pure 2D charts (the default is `true`). Keep `stencil: false` (default). Decide `antialias` on purpose: if lines and markers are antialiased in the shader, pass `antialias: false`.
- Why: The spec defaults are `alpha: true, depth: true, stencil: false, antialias: true`. Emscripten advises creating the context with the minimum set of alpha, depth, stencil and MSAA features. Example estimate (own arithmetic, real allocation is implementation-defined): a 1920x1080 device-pixel canvas needs about 8.3 MB for RGBA8 color and about 8.3 MB for a 24/8 depth-stencil; 4x MSAA of both adds about 66 MB before the resolve buffer.
- Example:
  ```ts
  const gl = canvas.getContext('webgl2', {
    depth: false, stencil: false, antialias: false, // shader-side AA for lines
    preserveDrawingBuffer: false, powerPreference: 'default',
  });
  ```
- Avoid/caveats: `depth`, `stencil` and `antialias: true` are requests, not guarantees; `false` is binding. Attributes apply only to the first `getContext` call; a second call with other attributes returns the same context. Read back the real values with `getContextAttributes()`.
- Status: Baseline Widely available since July 2015 (MDN getContextAttributes).
- Sources: https://registry.khronos.org/webgl/specs/latest/1.0/ (WebGLContextAttributes) ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/getContextAttributes

### Keep preserveDrawingBuffer false and read the canvas in the same task as the draw
- Layer: gpu
- Stage: composite, gpu-draw
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, because preserving the buffer can block buffer swapping and costs performance on some hardware.
- Do: Leave `preserveDrawingBuffer: false`. For screenshots or export, render and then call `toBlob`/`readPixels` in the same task, or set a flag that the render loop handles after drawing. For content that builds up over several frames, draw into your own framebuffer object.
- Why: The spec says preserving the drawing buffer "can cause significant performance loss on some platforms" and recommends synchronous access in the rendering function or an FBO instead. With the default, the buffer is cleared after compositing.
- Example:
  ```ts
  let wantShot = false;
  function frame() {
    drawChart();
    if (wantShot) { wantShot = false; canvas.toBlob(saveBlob); } // same task as the draw
  }
  ```
- Avoid/caveats: With `false`, reading the canvas later (another task) gives undefined content. The Chrome `desynchronized` guide recommends `preserveDrawingBuffer: true` to avoid flicker in that low-latency mode only.
- Status: Baseline Widely available (spec default since WebGL 1.0).
- Sources: https://registry.khronos.org/webgl/specs/latest/1.0/ (The Drawing Buffer) ; https://webgl2fundamentals.org/webgl/lessons/webgl-tips.html

### Keep alpha: true and write opaque alpha instead of reaching for alpha: false
- Layer: gpu
- Stage: composite
- Metrics: FPS/smoothness
- When: load
- Impact: medium, because on some platforms an RGB back buffer is emulated on an RGBA surface at a significant cost.
- Do: Keep the default `alpha: true` and make the final alpha 1.0 (clear with alpha 1 and write alpha 1, or mask alpha writes after an initial clear with `colorMask(true, true, true, false)`). Use `alpha: false` only after measuring on your target platforms.
- Why: MDN says `alpha:false` can have a significant performance cost on some platforms because the implementation must hide the alpha channel of an RGBA surface. webgl2fundamentals gives the opposite advice ("probably the best option"); the MDN text is newer and written from the implementer side. Treat this as a conflict to measure.
- Example:
  ```ts
  gl.clearColor(bg.r, bg.g, bg.b, 1); // opaque chart background
  gl.clear(gl.COLOR_BUFFER_BIT);
  ```
- Avoid/caveats: If you blend with destination alpha you need a real alpha channel. A canvas with non-1 alpha is composited with the page behind it.
- Status: Baseline Widely available (alpha attribute: Chrome 32, Firefox 30, Safari 10.1 per BCD).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://webgl2fundamentals.org/webgl/lessons/webgl-and-alpha.html

### Write premultiplied colors when premultipliedAlpha is true
- Layer: gpu
- Stage: composite, gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low for speed, high for correctness, because out-of-range colors composite unpredictably.
- Do: With the default `premultipliedAlpha: true`, output `rgb * a` and blend with `gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)`. Never output a color channel larger than alpha.
- Why: The spec says pixels sent to the compositor must have color less than or equal to alpha, otherwise the result is undefined (for example red can show as green) because consistent behavior would cost too much.
- Example:
  ```glsl
  out vec4 o; // fragment shader
  void main() { float a = coverage * u_color.a; o = vec4(u_color.rgb * a, a); }
  ```
- Avoid/caveats: Canvas 2D and most image sources are premultiplied; mixing conventions forces conversions at upload (see the texture conversion rule).
- Status: Baseline Widely available.
- Sources: https://registry.khronos.org/webgl/specs/latest/1.0/ (premultipliedAlpha) ; https://webgl2fundamentals.org/webgl/lessons/webgl-and-alpha.html

### Leave powerPreference at "default"; ask for "high-performance" only with evidence
- Layer: gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness, memory
- When: load, long-lived session
- Impact: low to medium, because the hint only chooses between GPUs on dual-GPU machines and can drain battery.
- Do: Use `'default'`. Use `'low-power'` for light charts (static or 1 fps dashboards). Use `'high-performance'` only when profiling proves the integrated GPU is the bottleneck, and then handle context loss well.
- Why: The spec says the hint may be ignored, that `high-performance` may significantly reduce battery life, and that user agents are likely to lose background high-performance contexts and restore them without the request. BCD notes Chrome and Firefox respect the GPU hint on macOS only.
- Avoid/caveats: A context switch between GPUs appears to the page as context loss (MDN isContextLost).
- Status: powerPreference: Chrome 75 (partial, macOS only), Firefox 63 (partial, macOS only), Safari 10.1 WebGL / 15 WebGL2 (BCD).
- Sources: https://registry.khronos.org/webgl/specs/latest/1.0/ (powerPreference) ; https://github.com/mdn/browser-compat-data/blob/main/api/HTMLCanvasElement.json ; https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/isContextLost

### Probe failIfMajorPerformanceCaveat to detect software rendering
- Layer: js
- Stage: script-run, gpu-draw
- Metrics: FPS/smoothness, INP
- When: load
- Impact: medium, because a software rasterizer can be orders of magnitude slower and will jank the page.
- Do: First try `getContext('webgl2', { failIfMajorPerformanceCaveat: true, ... })`. If it fails, create a context without the flag and switch to a reduced mode (lower DPR, fewer points, no MSAA, fewer layers), or use a Canvas2D fallback.
- Why: The spec defines the flag to fail creation when performance would be dramatically lower than native, for example with a software rasterizer or a read-back-before-composite path. Emscripten recommends probing with it to cut graphics fidelity.
- Example:
  ```ts
  let gl = c.getContext('webgl2', { ...attrs, failIfMajorPerformanceCaveat: true });
  const lowEnd = !gl;
  if (!gl) gl = c.getContext('webgl2', attrs);
  ```
- Avoid/caveats: Once a context exists on a canvas, its attributes are fixed. The retry above assumes a failed creation leaves the canvas without a context (not tested in every browser this session); if in doubt, probe on a throwaway canvas.
- Status: Chrome 33, Firefox 41, Safari 10.1 (WebGL) / 15 (WebGL2) (BCD).
- Sources: https://registry.khronos.org/webgl/specs/latest/1.0/ (failIfMajorPerformanceCaveat) ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html

### Use desynchronized only for pen-latency work, and only where Chrome honors it
- Layer: gpu
- Stage: composite
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: low for charts, because it trades tearing for lower input-to-pixel latency.
- Do: Do not set `desynchronized: true` by default. If you use it (for example a freehand drawing tool), check `gl.getContextAttributes().desynchronized` and set `preserveDrawingBuffer: true` to avoid flicker.
- Why: The flag lets the browser bypass the normal compositor path, even front-buffer rendering, which can tear. The Chrome guide says a translucent desynchronized canvas must not have other DOM elements above it.
- Avoid/caveats: Chart overlays (tooltips, crosshair DOM) above the canvas conflict with the alpha rule.
- Status: Chrome 81 (ChromeOS and Windows), Chrome Android 75; not Firefox, not Safari (BCD). Not Baseline.
- Sources: https://developer.chrome.com/blog/desynchronized ; https://registry.khronos.org/webgl/specs/latest/1.0/ (desynchronized) ; https://github.com/mdn/browser-compat-data/blob/main/api/HTMLCanvasElement.json

### Size the backing store in device pixels, and only when the size changes
- Layer: js
- Stage: layout, gpu-draw, gc-memory
- Metrics: FPS/smoothness, memory, CLS
- When: load, interaction
- Impact: high, because a wrong size blurs or wastes pixels and every resize reallocates the drawing buffer.
- Do: Let CSS size the canvas. Observe it with `ResizeObserver` using `box: 'device-pixel-content-box'` where supported, fall back to `content-box` times `devicePixelRatio`. Set `canvas.width/height` only when the value differs, then call `gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)`.
- Why: `canvas.width * devicePixelRatio` gives moire with fractional DPR; only `devicePixelContentBoxSize` gives the exact device-pixel size the compositor uses. The drawing buffer can be smaller than requested (GPU limits), so viewport and picking math must use `drawingBufferWidth/Height`. WebGL never changes the viewport for you after a resize.
- Example:
  ```ts
  const ro = new ResizeObserver(([e]) => {
    const d = e.devicePixelContentBoxSize?.[0];
    const w = d ? d.inlineSize : Math.round(e.contentRect.width * devicePixelRatio);
    const h = d ? d.blockSize : Math.round(e.contentRect.height * devicePixelRatio);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; requestRender(); }
  });
  try { ro.observe(canvas, { box: 'device-pixel-content-box' }); }
  catch { ro.observe(canvas, { box: 'content-box' }); }
  ```
- Avoid/caveats: Do not size from `window.innerWidth` or the `resize` event (misses layout-driven size changes). Setting width then height can cause two reallocations; `drawingBufferStorage(format, w, h)` sets both at once but is Chrome-only and experimental.
- Status: `devicePixelContentBoxSize`: Chrome 84, Firefox 108, Safari no (BCD), so not Baseline. `drawingBufferStorage`: Chrome 122, experimental (BCD).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://webgl2fundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-anti-patterns.html ; https://registry.khronos.org/webgl/specs/latest/1.0/ (Drawing Buffer, Viewport, drawingBufferStorage) ; https://github.com/mdn/browser-compat-data/blob/main/api/ResizeObserverEntry.json

### Cap the pixel count: limit devicePixelRatio or render to a smaller back buffer
- Layer: gpu
- Stage: raster, gpu-draw
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: high on HiDPI and mobile, because fragment cost grows with the square of DPR.
- Do: Clamp the DPR used for the backing store (for example to 2), and lower it further on low-end devices or while the user pans/zooms, then restore full resolution when idle. Keep the CSS size constant.
- Why: MDN suggests rendering into a smaller back buffer and upscaling as the easy quality/speed trade-off. webgl2fundamentals notes DPR 3 means 9x the pixels. A measured example: a 2018 MacBook Air (Intel UHD 617) drew only about 5 million pixels per frame at 60 fps in WebGL; one full layer at 5120x2880 is 14.7 million pixels.
- Example:
  ```ts
  const dpr = Math.min(devicePixelRatio, lowEnd ? 1 : 2);
  ```
- Avoid/caveats: Thin 1-device-pixel lines and text lose sharpness below native DPR. The dynamic "lower while interacting" variant is a common practice, not a quoted source rule.
- Status: n/a (technique on Baseline APIs).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://webgl2fundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-optimize-drawing-lots-of-large-images.html

### Render many charts through one context with viewport + scissor
- Layer: gpu
- Stage: gpu-draw, gpu-upload, gc-memory
- Metrics: memory, startup, FPS/smoothness
- When: load, long-lived session
- Impact: high for multi-chart layouts, because contexts cannot share resources and browsers evict the oldest context past a cap.
- Do: For a grid of charts, use one WebGL context and draw each chart into its rectangle with `gl.viewport` + `gl.enable(gl.SCISSOR_TEST)` + `gl.scissor`. Either use one large canvas behind the layout, or one shared context that renders and then copies into per-chart canvases.
- Why: Each context must compile its own shaders and upload its own buffers and textures. webgl2fundamentals says many browsers cap simultaneous contexts ("as low as 8") and creating one more loses the oldest. Chromium's `ActivateContext` force-loses the context with the oldest flush when the cap is reached and logs a console warning; the cap comes from GPU preferences and has a separate worker value (default number not confirmed in source this session; bug reports cite 16 on desktop). `gl.clear` ignores the viewport, so the scissor test is required for per-chart clears.
- Example:
  ```ts
  gl.enable(gl.SCISSOR_TEST);
  for (const c of charts) {
    const [x, y, w, h] = c.deviceRect; // bottom-left origin
    gl.viewport(x, y, w, h); gl.scissor(x, y, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT); c.draw(gl);
  }
  ```
- Avoid/caveats: A page-sized canvas under scrolling content must redraw on scroll; skip charts whose rect is off screen. Mixing DOM between charts is easier with a fixed background canvas.
- Status: Technique on Baseline APIs.
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-multiple-views.html ; https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc

### Lose the context of a destroyed chart explicitly
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium in SPAs that mount and unmount charts, because a dead context holds GPU memory and counts against the active-context cap until GC.
- Do: On chart destroy, delete your GPU objects, then call `gl.getExtension('WEBGL_lose_context')?.loseContext()`. Do not add an unload handler just for this.
- Why: MDN recommends eagerly losing contexts you are done with; the context otherwise lives until garbage collection.
- Avoid/caveats: After `loseContext()` the canvas cannot be reused for a new context; create a new canvas.
- Status: WEBGL_lose_context Baseline Widely available since April 2018 (MDN); 99.99% (web3dsurvey).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_lose_context

### Handle context loss and restore, and keep the data needed to rebuild
- Layer: js
- Stage: script-run, gpu-upload
- Metrics: FPS/smoothness, memory
- When: long-lived session
- Impact: high for a trading terminal that runs for hours, because GPU resets, GPU switches, driver updates and context eviction all lose the context.
- Do: Listen for `webglcontextlost` on the canvas and call `event.preventDefault()` (otherwise no restore event comes), stop the rAF loop, and drop all WebGL object references. On `webglcontextrestored`, re-enable extensions and recreate programs, buffers, textures, VAOs, FBOs and state from your own model data. Test with `WEBGL_lose_context.loseContext()` / `restoreContext()`.
- Why: After restore, all old WebGL objects are invalid and enabled extensions are gone (spec). Create functions return `null` while lost, so code that hangs properties on WebGL objects crashes (webgl2fundamentals anti-pattern). MDN lists causes: too much GPU demand, dual-GPU switch, GPU reset caused by another page, driver update. With KHR_parallel_shader_compile, completion queries return `true` while lost, so polling loops end.
- Example:
  ```ts
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); gpu = null; });
  canvas.addEventListener('webglcontextrestored', () => { gpu = createGpu(gl, model); requestRender(); });
  ```
- Avoid/caveats: Keep the CPU-side source (or a way to regenerate it) for everything you upload; freeing typed arrays after upload saves memory but makes restore impossible. `isContextLost()` is cheap; use it to skip error reporting when link status fails because of loss.
- Status: `webglcontextlost` Baseline Widely available since July 2015 (MDN); WEBGL_lose_context Baseline since April 2018 (MDN).
- Sources: https://registry.khronos.org/webgl/specs/latest/1.0/ (Context Lost / Restored events) ; https://webgl2fundamentals.org/webgl/lessons/webgl-anti-patterns.html ; https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/isContextLost ; https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/

### Move rendering to an OffscreenCanvas in a worker when the main thread is busy
- Layer: js
- Stage: main-thread-task, script-run, gpu-draw
- Metrics: INP, TBT, FPS/smoothness
- When: animation/render-loop, interaction
- Impact: high when the main thread runs heavy UI/data work, because chart frames then no longer compete with input handling.
- Do: `canvas.transferControlToOffscreen()`, transfer it to a worker, create the WebGL2 context there and drive it with the worker's `requestAnimationFrame`. Forward pointer/wheel input and size changes (device pixels) from the main thread with `postMessage`; transfer data as `ArrayBuffer` (transferable) instead of copying.
- Why: MDN and web.dev describe OffscreenCanvas as decoupling canvas rendering from the DOM so a busy main thread does not stall the animation, and vice versa.
- Example:
  ```ts
  // main
  const off = canvas.transferControlToOffscreen();
  worker.postMessage({ type: 'init', canvas: off }, [off]);
  // worker
  onmessage = ({ data }) => { if (data.type === 'init') gl = data.canvas.getContext('webgl2', attrs); };
  ```
- Avoid/caveats: A GPU overloaded by the worker still slows the whole machine (webgl2fundamentals: most GPUs do not pre-empt). After transfer, `canvas.width/height` must be set in the worker. Chromium keeps a separate, lower active-context cap for workers. Nested workers lack rAF in Chrome (BCD note).
- Status: OffscreenCanvas Baseline Widely available (MDN: across browsers since March 2023). WebGL/WebGL2 context on OffscreenCanvas: Chrome 69, Firefox 105, Safari 17 (BCD). Worker `requestAnimationFrame`: Chrome 69, Firefox 99, Safari 16.4 (BCD).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas ; https://web.dev/articles/offscreen-canvas ; https://github.com/mdn/browser-compat-data/blob/main/api/OffscreenCanvas.json ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-rendering-slowly-over-time.html

### Render on demand and coalesce data ticks into one frame
- Layer: js
- Stage: script-run, gpu-draw, idle
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop, long-lived session
- Impact: high for power and headroom, because an idle chart that redraws at 60-120 Hz wastes GPU and CPU time.
- Do: Keep a dirty flag. Schedule at most one `requestAnimationFrame` when data, viewport, size or style changes. Apply all ticks that arrived since the last frame in that one frame (one upload, one draw pass).
- Why: The spec presents the drawing buffer only if a draw, resize or context creation happened since the last composite, so skipping a frame leaves the last image on screen even with `preserveDrawingBuffer: false`. webgl2fundamentals recommends triggering redraws (for example from ResizeObserver) for apps that do not redraw every frame.
- Example:
  ```ts
  let queued = false;
  function requestRender() { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; flushTicksAndDraw(); }); } }
  socket.onmessage = (m) => { pending.push(parse(m)); requestRender(); };
  ```
- Avoid/caveats: Continuous animations (live price flash) still need a loop while they run; stop it when they end.
- Status: Technique on Baseline APIs.
- Sources: https://registry.khronos.org/webgl/specs/latest/1.0/ (The Drawing Buffer) ; https://webgl2fundamentals.org/webgl/lessons/webgl-anti-patterns.html

### Drive frames with requestAnimationFrame and flush only outside rAF
- Layer: js
- Stage: script-run, gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because timers are not synchronized with presentation and can drop or double frames.
- Do: Render from `requestAnimationFrame`. If you render from another callback (for example a worker message without rAF), call `gl.flush()` at the end so queued commands start executing.
- Why: MDN notes rAF is followed by the frame boundary, so an explicit flush is not needed there; outside rAF a flush encourages eager execution. Emscripten recommends rAF over `setTimeout`. rAF also stops in hidden tabs (webgl2fundamentals Q&A).
- Avoid/caveats: `gl.finish()` is not a synchronization tool (Chrome implements it as a flush).
- Status: Baseline.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-recording-fps-in-webgl.html

### Cache static layers in a texture and redraw only the layers that change
- Layer: gpu
- Stage: gpu-draw, raster
- Metrics: FPS/smoothness
- When: animation/render-loop, interaction
- Impact: high for dense charts, because a streaming tick often changes only the last bar while thousands of historical bars stay the same.
- Do: Render expensive, rarely changing content (grid, history series, heatmap body) into an FBO texture once per view change. Each frame, draw that texture as one quad and then the dynamic parts (last candle, live line tail, crosshair) on top.
- Why: webgl2fundamentals suggests drawing UI parts into a texture and updating only changed parts, like the browser's own layer tiles, and rendering heavy content to a texture over several frames. This turns an O(points) redraw into O(1) plus the changed part.
- Avoid/caveats: The cache must be rebuilt on pan, zoom, resize, DPR or style change; it costs one full-size texture (see VRAM budget). Keep the FBO texture at device-pixel size to avoid blur.
- Status: Technique on Baseline APIs.
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-qna-how-to-optimize-rendering-a-ui.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-rendering-slowly-over-time.html

### Put fast-changing overlays and sparse text in DOM or a 2D layer
- Layer: html
- Stage: paint, composite, gpu-draw
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: medium, because a crosshair or tooltip that forces a full WebGL redraw on every pointer move multiplies GPU work.
- Do: Draw the crosshair, tooltip and a small number of labels in an absolutely positioned DOM or Canvas2D layer over the WebGL canvas. Reuse elements (create once, update text nodes and transforms, hide unused ones).
- Why: webgl2fundamentals shows HTML overlays for text and suggests HTML may be faster for UI; it keeps elements around instead of creating and removing them.
- Avoid/caveats: Hundreds of moving labels are cheaper in WebGL from a glyph atlas (see text rule). Do not combine a DOM overlay with `desynchronized` + alpha.
- Status: Baseline.
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-text-html.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-how-to-optimize-rendering-a-ui.html

### Batch draw calls by shared state; use atlases and strip joins
- Layer: gpu
- Stage: script-run, gpu-draw
- Metrics: FPS/smoothness, TBT
- When: animation/render-loop
- Impact: high, because each WebGL call is validated by the browser and often crosses a process boundary, so CPU cost scales with call count.
- Do: Draw everything that shares program, textures and blend state in one `drawArrays`/`drawElements`. Pack small images into a texture atlas. Join separate strips with degenerate triangles, or in WebGL2 with the primitive-restart index.
- Why: MDN: 1000 sprites should be one draw call where possible; atlases remove texture-switch splits. Emscripten: WebGL validates every call, so fewer calls help CPU-bound apps. Mozilla's 2013 talk calls batching "generally the most important optimization".
- Avoid/caveats: Very large single batches cannot be partially culled; keep chunked buffers so off-screen chunks are skipped. Emscripten notes one driver ran vertex shaders in software when primitive restart was used; measure.
- Status: Baseline.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; http://nical.github.io/onGameStart2013/

### Use instancing for repeated marks (candles, bars, markers, segments)
- Layer: gpu
- Stage: gpu-draw, gpu-upload
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: high, because N marks become 1 draw call and per-mark data shrinks to one record.
- Do: Put one small template (a quad) in a static buffer. Put per-mark data (time offset, open, high, low, close, color) in an instance buffer with `vertexAttribDivisor(loc, 1)`, and draw with `drawArraysInstanced`/`drawElementsInstanced`.
- Why: webgl2fundamentals shows 15 calls for 5 objects shrinking to 2 calls (one upload, one draw), and 400 objects x 7 calls = 2800 calls replaced by one draw. A 2019 test drew 20k-30k (Firefox) and 60k-66k (Chrome) instanced quads per frame at 60 fps on one laptop.
- Example:
  ```ts
  // per-candle: [dt, open, high, low, close] as float32 = 20 bytes
  gl.bindBuffer(gl.ARRAY_BUFFER, candleBuf);
  gl.vertexAttribPointer(locDt, 1, gl.FLOAT, false, 20, 0);
  gl.vertexAttribPointer(locOhlc, 4, gl.FLOAT, false, 20, 4);
  gl.vertexAttribDivisor(locDt, 1); gl.vertexAttribDivisor(locOhlc, 1);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, candleCount); // body; wicks in same shader or 2nd pass
  ```
- Avoid/caveats: Instances of one draw cannot be interleaved with other draws for sorting (webgl2fundamentals Q&A); for transparency across models use vertex pulling. The same test showed repeated geometry was as fast as instancing on that GPU; instancing mainly saves memory and upload.
- Status: `drawArraysInstanced` Baseline Widely available since September 2021 (MDN); WebGL1 via ANGLE_instanced_arrays (universally supported per MDN).
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-instanced-drawing.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-the-fastest-way-to-draw-many-circles.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-sorting-and-optimizing-instanced-rendering.html ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/drawArraysInstanced

### Draw thick lines as instanced quads, never with gl.lineWidth
- Layer: gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: high for line series, because `gl.LINES` width above 1 is not portable and 1-pixel lines cannot be antialiased in the shader.
- Do: Draw each segment as a quad instance. Bind the same point buffer to two attributes, `pointA` at offset 0 and `pointB` at offset of one point, both with divisor 1, and draw `pointCount - 1` instances. Expand the quad in the vertex shader in pixel space and antialias with a distance-based alpha in the fragment shader.
- Why: webgl2fundamentals says the maximum line width is 1 on most platforms now. The two-attribute trick reuses one buffer without duplication (Rye Terrell's instanced-lines write-up reports interactive 500k-point plots).
- Example:
  ```ts
  gl.bindBuffer(gl.ARRAY_BUFFER, xyBuf); // [x0,y0,x1,y1,...] float32
  gl.vertexAttribPointer(locA, 2, gl.FLOAT, false, 8, 0);
  gl.vertexAttribPointer(locB, 2, gl.FLOAT, false, 8, 8);
  gl.vertexAttribDivisor(locA, 1); gl.vertexAttribDivisor(locB, 1);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, pointCount - 1); // corners from gl_VertexID
  ```
- Avoid/caveats: Joins (miter/round) need extra geometry or a wider quad plus fragment math. Check `ALIASED_LINE_WIDTH_RANGE` only for debug overlays.
- Status: WebGL2 core; WebGL1 needs ANGLE_instanced_arrays.
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html ; https://wwwtyro.net/2019/11/18/instanced-lines.html (blog) ; https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/lineWidth

### Use WEBGL_multi_draw for many ranges with one program, with a loop fallback
- Layer: gpu
- Stage: script-run, gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because it turns N draws of the same program (for example N series in one buffer) into one call and exposes `gl_DrawID` for per-series data.
- Do: Put many series in one buffer, get `WEBGL_multi_draw`, and call `multiDrawArraysWEBGL(mode, firsts, 0, counts, 0, n)`. Read per-series style by `gl_DrawID` (shader needs `#extension GL_ANGLE_multi_draw : require`). Without the extension, loop over `drawArrays` and pass the series index as a uniform.
- Why: MDN says the extension reduces binding costs and speeds up GPU thread time with uniform data.
- Avoid/caveats: Keep the `Int32Array` argument arrays preallocated.
- Status: Limited availability (MDN): Chrome 86, Safari 15, not Firefox (BCD); 93.1% of WebGL2 reports (web3dsurvey).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_multi_draw ; https://registry.khronos.org/webgl/extensions/WEBGL_multi_draw/ ; https://web3dsurvey.com/webgl2

### Build one VAO per geometry layout at init and do not mutate VAOs per draw
- Layer: gpu
- Stage: script-run, gpu-draw
- Metrics: FPS/smoothness
- When: load, animation/render-loop
- Impact: medium, because static VAOs let the browser cache validation (fetch limits) and remove many attribute calls per draw.
- Do: At init, create a VAO per layout and set `vertexAttribPointer`/`enableVertexAttribArray`/divisors/element buffer once. At draw time only `bindVertexArray`.
- Why: MDN: static VAOs are faster than re-pointing the same VAO for each draw because browsers must revalidate when VAOs change. webgl2fundamentals: in WebGL1 a draw often needed 9-16 attribute calls; with VAOs it is one call.
- Avoid/caveats: Re-allocating a buffer bound in a VAO (bufferData) is fine; changing the pointer layout is what triggers revalidation.
- Status: WebGL2 core; OES_vertex_array_object universally available in WebGL1 (MDN).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://webgl2fundamentals.org/webgl/lessons/webgl-drawing-multiple-things.html ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html

### Sort draws by target, program, then bindings, and skip redundant state calls
- Layer: js
- Stage: script-run, gpu-draw
- Metrics: FPS/smoothness, TBT
- When: animation/render-loop
- Impact: medium, because every call costs validation and IPC even when it changes nothing.
- Do: Order draws by framebuffer, then program, then textures/VAO. Track the last bound program, VAO, textures and blend/depth state in JS and skip identical calls. Never "reset to a ground state" after each draw (for example `useProgram(null)`, unbinding buffers, disabling all attributes).
- Why: Emscripten lists redundant calls and reset patterns as a common CPU cost and recommends lazy state setting; it also says a renderer that avoids redundant calls by design beats a deep low-level cache.
- Avoid/caveats: With VAOs the gains are smaller (webgl2fundamentals); do not over-engineer a full lazy-state cache before profiling.
- Status: n/a (technique).
- Sources: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-drawing-multiple-things.html

### Look up locations, parameters and extensions once
- Layer: js
- Stage: script-run
- Metrics: FPS/smoothness, TBT
- When: load
- Impact: medium, because `getUniformLocation`, `getParameter` and `getExtension` in the loop add calls and some cause synchronous round trips.
- Do: After linking, store all uniform locations and uniform block indices. Fix attribute locations with `layout(location = N)` (WebGL2) or `bindAttribLocation` before linking. Read limits and extensions once at init and keep them in a JS object.
- Why: Emscripten: never call `glGetUniformLocation` at render time; query `glGet*` at startup. Mozilla's talk shows `gl.uniform1f(gl.getUniformLocation(p, 'time'), t)` as the anti-pattern. Attribute locations are not guaranteed to be 0, 1, 2 unless you set them (webgl2fundamentals).
- Example:
  ```ts
  const loc = { scale: gl.getUniformLocation(p, 'u_scale')!, color: gl.getUniformLocation(p, 'u_color')! };
  // per frame: gl.uniform2f(loc.scale, sx, sy);
  ```
- Avoid/caveats: Do not attach locations as properties on `WebGLProgram` objects (breaks under context loss); keep them in a plain object.
- Status: Baseline.
- Sources: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; http://nical.github.io/onGameStart2013/ ; https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html

### Put shared per-frame uniforms in a uniform buffer object
- Layer: gpu
- Stage: script-run, gpu-upload
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because one `bufferSubData` replaces many `uniform*` calls per program per frame.
- Do: Declare a `layout(std140) uniform View { ... }` block shared by all chart programs. At init: `uniformBlockBinding(prog, blockIndex, 0)` and `bindBufferBase(UNIFORM_BUFFER, 0, viewUbo)`. Each frame: fill a reused `Float32Array` and upload it with one `bufferSubData`.
- Why: webgl2fundamentals: 16 uniforms are 16 calls in WebGL1, while a UBO is filled in JS and uploaded in one call. Emscripten recommends UBOs over individual `glUniform*`.
- Example:
  ```glsl
  layout(std140) uniform View { vec4 u_xform; vec4 u_viewport; }; // pack into vec4s
  ```
- Avoid/caveats: Only `std140` layout is supported in WebGL2 (spec), so pad to vec4 rules. Query `UNIFORM_BUFFER_OFFSET_ALIGNMENT` once before using `bindBufferRange` offsets (spec only guarantees it is divisible by 4). Every reported device has `MAX_UNIFORM_BLOCK_SIZE` of at least 16 KB; 74% have 32 KB (web3dsurvey). Drawing with a block not backed by a large enough buffer is an error.
- Status: `uniformBlockBinding` Baseline Widely available since September 2021 (MDN).
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl2-whats-new.html ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; https://registry.khronos.org/webgl/specs/latest/2.0/ ; https://web3dsurvey.com/webgl2

### Keep vertex attribute 0 enabled as an array
- Layer: gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low to medium, because a disabled attribute 0 forces the browser to emulate it on desktop OpenGL (for example macOS).
- Do: Bind the always-used attribute (position) to location 0 (`layout(location = 0)` or `bindAttribLocation(p, 0, 'a_pos')`) and keep it array-enabled.
- Why: MDN: in desktop OpenGL nothing is drawn if attribute 0 is not an array, so the browser must emulate.
- Status: Baseline.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-can-i-mute-the-warning-about-vertex-attrib-0-being-disabled-.html

### Use WEBGL_provoking_vertex FIRST convention with flat varyings
- Layer: gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: load
- Impact: low, because it only matters for `flat` varyings on backends (D3D, Metal, Vulkan) that must emulate the OpenGL last-vertex rule.
- Do: If you use `flat` interpolation (for example a per-series id), get `WEBGL_provoking_vertex` and call `provokingVertexWEBGL(FIRST_VERTEX_CONVENTION_WEBGL)`; arrange data so the first vertex carries the flat value.
- Why: The extension is exposed only where the first-vertex convention is more efficient (Khronos spec); MDN says emulation of the OpenGL convention can be expensive.
- Status: Not in BCD; 76.86% of WebGL2 reports (web3dsurvey).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://registry.khronos.org/webgl/extensions/WEBGL_provoking_vertex/

### Allocate buffers once with headroom and update sub-ranges with bufferSubData
- Layer: gpu
- Stage: gpu-upload, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop, long-lived session
- Impact: high for streaming charts, because re-creating storage every update allocates, zero-fills and revalidates.
- Do: Allocate with `bufferData(target, capacityBytes, usage)` once. Grow geometrically (for example x2) when full. Upload only the changed range with `bufferSubData(target, dstByteOffset, src, srcOffset, length)`, even when most of the buffer changes. Do not shrink eagerly.
- Why: Emscripten: avoid `glBufferData`/`glTexImage2D` resizes at runtime, use vector-style growth, prefer `glBufferSubData` even for full updates. The spec requires storage created without data to be zero-initialized, so `bufferData(size)` is not free.
- Avoid/caveats: `srcOffset` and `length` count elements of the typed array, `dstByteOffset` counts bytes (spec).
- Status: `bufferSubData` (WebGL2 overloads) Baseline Widely available since September 2021 (MDN).
- Sources: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; https://registry.khronos.org/webgl/specs/latest/2.0/ (Buffer objects) ; https://registry.khronos.org/webgl/specs/latest/1.0/ (Resource Restrictions)

### Do not orphan buffers; rotate two or three buffers instead
- Layer: gpu
- Stage: gpu-upload
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because the native-GL orphaning trick (`bufferData(null)` then fill) becomes a zeroed upload in WebGL.
- Do: For data rewritten every frame, keep 2-3 buffers of the same size and alternate: fill one with `bufferSubData` while the GPU draws from another. Do not call `bufferData(size)` before each update.
- Why: On webgl-dev-list, Ken Russell (Chrome) advised against the orphaning call and suggested alternating two buffers; Jeff Gilbert (Firefox) said `bufferData(null)` uploads a calloc'd buffer, so it is strictly worse. Emscripten also recommends double or triple buffering dynamic VBOs. (Thread from 2014; the zero-init rule is still in the current spec.)
- Avoid/caveats: Multiple buffers multiply memory; use them only for large per-frame rewrites, not for append-only data (use a ring region instead).
- Status: Technique on Baseline APIs.
- Sources: https://groups.google.com/g/webgl-dev-list/c/vMNXSNRAg8M ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html

### Stream appended points into a ring-buffer region
- Layer: gpu
- Stage: gpu-upload, gpu-draw
- Metrics: FPS/smoothness, memory
- When: animation/render-loop, long-lived session
- Impact: high for tick streams, because shifting a full buffer to append one point re-uploads everything.
- Do: Preallocate a capacity, write new points at the head with `bufferSubData`, and draw the valid window as up to two ranges (`first`/`count`), or as one range with an offset uniform. Keep the CPU mirror in a matching ring `Float32Array`.
- Why: This applies the sub-range update rule (Emscripten) to append-only data: each tick uploads bytes proportional to the new points only. (Pattern synthesis; not a quoted source rule.)
- Example:
  ```ts
  function append(xy: Float32Array) { // xy pairs, assumes no wrap inside this write
    gl.bindBuffer(gl.ARRAY_BUFFER, ring);
    gl.bufferSubData(gl.ARRAY_BUFFER, head * 8, xy);
    head = (head + xy.length / 2) % capacity;
  }
  ```
- Avoid/caveats: A line strip across the wrap point needs a split draw or a duplicated boundary point. Do not rewrite index buffers per tick (see index rule).
- Status: Technique on Baseline APIs.
- Sources: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html

### Pick buffer usage hints that match the real update rate
- Layer: gpu
- Stage: gpu-upload, gc-memory
- Metrics: FPS/smoothness, memory
- When: load
- Impact: low to medium, because hints guide where the driver and browser keep the data.
- Do: `STATIC_DRAW` for data written once (template quads, historical chunks), `DYNAMIC_DRAW` for data updated often and drawn many times. Prefer `DYNAMIC_DRAW` over `STREAM_DRAW`. Use `*_READ` hints only for buffers you read back.
- Why: MDN defines the hints; Emscripten prefers dynamic over stream for vertex buffers. The WebGL2 spec warns that `_READ` buffers may keep a shadow copy, so overuse costs memory.
- Status: Baseline (READ/COPY hints: WebGL2).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/bufferData ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; https://registry.khronos.org/webgl/specs/latest/2.0/ (getBufferSubData)

### Interleave attributes that change together and split static from dynamic
- Layer: gpu
- Stage: gpu-upload, gpu-draw
- Metrics: FPS/smoothness
- When: load
- Impact: medium, because interleaving improves vertex cache locality, while splitting by update rate shrinks uploads.
- Do: Interleave attributes of one vertex that are written together into one buffer. Keep attributes with different update rates (static template vs per-tick values) in separate buffers. Do not store per-series constants per vertex; use a uniform or a constant attribute (`vertexAttrib4f`).
- Why: Emscripten prefers interleaved data in one VBO; MDN says interleave and use the smallest adequate type; Apple's (legacy OpenGL ES) guide makes the exception for data updated at a different rate.
- Status: Baseline.
- Sources: https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/vertexAttribPointer ; https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/TechniquesforWorkingwithVertexData/TechniquesforWorkingwithVertexData.html

### Use the smallest vertex type that keeps enough precision
- Layer: gpu
- Stage: gpu-upload, gpu-draw, gc-memory
- Metrics: memory, FPS/smoothness
- When: load
- Impact: medium, because vertex bandwidth and upload bytes scale with the byte size per vertex.
- Do: Colors: 4 x `UNSIGNED_BYTE` normalized (4 bytes, not 16). Bounded values (UVs, 0..1 ratios): `UNSIGNED_SHORT` normalized or `HALF_FLOAT` (WebGL2; fill from `Float16Array`). Ids: integer attributes with `vertexAttribIPointer`. Keep positions/time offsets in `FLOAT`. Start each attribute at a 4-byte-aligned offset.
- Why: MDN's vertexAttribPointer guide interleaves a float32 position with byte normals and ushort UVs in a 20-byte vertex and aligns to 32 bits. Offsets and strides must be multiples of the type size (spec); stride is at most 255.
- Example:
  ```ts
  gl.vertexAttribPointer(locColor, 4, gl.UNSIGNED_BYTE, true, 12, 8); // RGBA8 at byte 8 of a 12-byte vertex
  ```
- Avoid/caveats: Half floats have about 3 significant decimal digits; never use them for prices or time.
- Status: `HALF_FLOAT`, `INT_2_10_10_10_REV`, integer attributes: WebGL2. `Float16Array`: Chrome 135, Firefox 129, Safari 18.2 (BCD), so Baseline 2025.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/vertexAttribPointer ; https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/Float16Array.json ; https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/TechniquesforWorkingwithVertexData/TechniquesforWorkingwithVertexData.html

### Prefer Uint16 indices and avoid rewriting index buffers
- Layer: gpu
- Stage: gpu-upload, script-run
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, because browsers validate index ranges on the CPU and Firefox keeps a CPU copy of index data.
- Do: Use `Uint16Array` indices for meshes under 65,535 vertices, `Uint32Array` only when needed. Keep index buffers static; prefer instancing or `drawArrays` for streaming data. Remember that in WebGL2 the maximum value (65535 / 0xFFFFFFFF) always means primitive restart.
- Why: In a 2022 webgl-dev-list thread, Kelsey Gilbert (Firefox) explained Firefox validates and copies index data at upload and validates at draw with a cache; Ken Russell (Chrome) said Chrome validates at draw with a cache, so large, often-updated index buffers cause pauses. The WebGL2 spec keeps primitive restart always on (to avoid pitfalls on D3D) and errors on indices above `MAX_ELEMENT_INDEX` (at least 2^30-1 on all reports, web3dsurvey).
- Avoid/caveats: WebGL1 needs `OES_element_index_uint` for 32-bit indices (universally available per MDN).
- Status: Baseline.
- Sources: https://groups.google.com/g/webgl-dev-list/c/8gfFD7eTUYQ ; https://registry.khronos.org/webgl/specs/latest/2.0/ (PRIMITIVE_RESTART_FIXED_INDEX, Range Checking) ; https://web3dsurvey.com/webgl2

### Reuse typed arrays and use the WebGL2 srcOffset/length overloads
- Layer: js
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, because per-frame `new Float32Array` or `subarray()` creates garbage and GC pauses.
- Do: Preallocate scratch `Float32Array`s. Upload parts with `bufferSubData(target, dstByte, src, srcOffset, length)` and `uniformMatrix4fv(loc, false, data, srcOffset, 16)` instead of creating views. Write math results into existing arrays.
- Why: The WebGL2 IDL adds `srcOffset`/`srcLength` overloads for buffers, textures and uniforms; Emscripten credits WebGL2's garbage-free bindings with reduced stutter. webgl2fundamentals warns that allocating new Float32Arrays per call eventually causes GC hiccups.
- Status: WebGL2 core (Baseline Widely available since September 2021).
- Sources: https://registry.khronos.org/webgl/specs/latest/2.0/ (WebGL2RenderingContextOverloads) ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-text-glyphs.html

### Never put raw Unix-millisecond timestamps in float32
- Layer: js
- Stage: script-run, gpu-upload
- Metrics: FPS/smoothness
- When: load, animation/render-loop
- Impact: high for time axes, because float32 cannot represent 2026 timestamps to better than about two minutes.
- Do: Keep times as float64 in JS. For each data chunk choose a float64 origin (for example the chunk's first time) and store `time - origin` in the `Float32Array`. Keep chunks short enough that offsets stay small relative to the pixel resolution you need.
- Why: float32 has a 24-bit significand. Own arithmetic (checked in Python): at 1.79e12 ms (2026-09) the float32 spacing is 131,072 ms, and `Math.fround(1790000000000)` is off by 27,648 ms. Offsets from an origin have spacing 8 ms within 1 day, 256 ms within 30 days and 2,048 ms within 1 year. The same effect makes objects jitter in globe renderers (AGI: float32 keeps about 1 cm only up to 131,071 m).
- Example:
  ```ts
  // Before: xs[i] = t[i];              // ~2-minute quantization
  // After:
  const origin = t[0];                  // float64
  for (let i = 0; i < n; i++) xs[i] = t[i] - origin; // small float32 offsets
  ```
- Avoid/caveats: Prices are usually fine in float32 (65,000.00 has 0.0039 spacing), but tiny-increment assets (1e-8) or very large volumes need the same origin trick. Subtracting the view start inside the shader does not help if the attribute already lost the bits.
- Status: n/a (numeric rule).
- Sources: https://help.agi.com/AGIComponents/html/BlogPrecisionsPrecisions.htm ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices (ESSL300 highp = IEEE float32)

### Transform relative to the visible origin, and split doubles for extreme ranges
- Layer: gpu
- Stage: script-run, gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop, interaction
- Impact: high at deep zoom, because a large translation in a float32 matrix or uniform quantizes every vertex.
- Do: Compute the difference between each chunk origin and the view origin in float64 on the CPU and pass the small result as a uniform (relative-to-center). The vertex shader computes `(a_dt + u_chunkShift) * u_pxPerMs`. If one draw spans a range too large for that, store each value as a high/low float pair and subtract a high/low view origin in the shader (GPU relative-to-eye).
- Why: AGI describes rendering relative-to-center (CPU float64 then small float32 translation) and GPU relative-to-eye with a high/low split that reaches about 1.35 cm error at planetary scale; Godot uses the same `float(d)` plus `float(d - float(d))` split for large worlds; deck.gl applies a viewport-based dynamic translation for the same reason.
- Example:
  ```ts
  gl.uniform1f(loc.chunkShift, chunk.originMs - view.leftMs); // float64 math, small result
  // split for GPU RTE:
  const hi = Math.fround(v); const lo = Math.fround(v - hi);
  ```
  ```glsl
  float x = (a_tHi - u_viewHi) + (a_tLo - u_viewLo); // highp in the vertex shader
  ```
- Avoid/caveats: The split doubles position bytes (AGI: 32 to 44 bytes per vertex). Verify on target GPUs that the compiler keeps the subtraction order. SciChart.js states it uses a 64-bit coordinate pipeline, but its article could not be read (403).
- Status: n/a (technique).
- Sources: https://help.agi.com/AGIComponents/html/BlogPrecisionsPrecisions.htm ; https://godotengine.org/article/emulating-double-precision-gpu-render-large-worlds/ ; https://deck.gl/docs/developer-guide/coordinate-systems

### Use highp for coordinates and allow mediump only for bounded values
- Layer: gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop, testing
- Impact: medium, because mediump is faster on mobile but its float16 range and precision corrupt coordinate math silently.
- Do: Compute positions in the vertex shader (highp by default). In the fragment shader, use `mediump` only for colors, 0..1 coverage and other small ranges; keep `highp` for anything derived from pixels, distances or time. Use `highp sampler2D` for float data textures. In WebGL1, guard with `GL_FRAGMENT_PRECISION_HIGH`; never use `#ifdef GL_ES`.
- Why: MDN's ESSL300 table: mediump is at least IEEE float16, range (-2^14, 2^14), relative precision 2^-10; lowp is 10-bit fixed in (-2, 2). Desktop GPUs run mediump as highp, so bugs appear only on mobile (webgl2fundamentals). iOS gives low-precision samples from float textures unless the sampler is highp (MDN). Emscripten recommends the lowest precision that is enough.
- Example:
  ```glsl
  precision highp float;           // vertex math
  // fragment: mediump for color, highp for distance-to-line in pixels
  in highp float v_distPx;
  ```
- Avoid/caveats: `normalize`, `length`, `dot` overflow in mediump for values near 1000 (1000^2 exceeds 2^14 range per the webgl2fundamentals example). A 32-bit int passed between stages needs `highp`.
- Status: Baseline (WebGL2 guarantees highp float in fragment shaders; WebGL1 does not).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://webgl2fundamentals.org/webgl/lessons/webgl-precision-issues.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-when-to-choose-highp--mediump--lowp-in-shaders.html ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html

### Check float render, filter and blend support before using float targets
- Layer: gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: load
- Impact: medium, because a missing capability gives an incomplete framebuffer, an INVALID_OPERATION on draw, or black textures.
- Do: Before rendering to float textures call `getExtension('EXT_color_buffer_float')` (WebGL2) and check `checkFramebufferStatus` once at setup. Before `LINEAR` filtering of float32 textures check `OES_texture_float_linear`; otherwise use `NEAREST` and `texelFetch`. Before blending into float32 check `EXT_float_blend`. Prefer RGBA16F render targets: float16 blending is always supported.
- Why: MDN: render-to-float is not implied by float texture support; float32 blending is not implied by render-to-float; half-float blending always works. webgl2fundamentals: OES_texture_float_linear is the most commonly missing extension on mobile.
- Avoid/caveats: `generateMipmap` fails on formats that are not color-renderable.
- Status: EXT_color_buffer_float Baseline Widely available since September 2021 (MDN), 99.94% (web3dsurvey). OES_texture_float_linear 90.58% of WebGL2 reports; BCD notes iOS support only on iPadOS. EXT_float_blend Limited availability (MDN), removed from Safari iOS 16 (BCD), 93.76%.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://developer.mozilla.org/en-US/docs/Web/API/EXT_color_buffer_float ; https://developer.mozilla.org/en-US/docs/Web/API/EXT_float_blend ; https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html ; https://web3dsurvey.com/webgl2

### Compile all shaders, link all programs, then check LINK_STATUS once
- Layer: gpu
- Stage: script-compile, main-thread-task
- Metrics: startup, TBT, INP
- When: load
- Impact: high at startup, because a status query right after each compile blocks until that compile finishes and prevents parallel compilation.
- Do: Call `compileShader` for every shader, then `linkProgram` for every program, then query `LINK_STATUS`. Read shader info logs only when linking fails.
- Why: MDN: many browsers compile and link on background threads, and status queries are synchronous and break pipelining. The ESSL3 spec lets errors surface at link time, so compile-status checks add stalls without adding safety.
- Example:
  ```ts
  for (const s of shaders) gl.compileShader(s);
  for (const p of programs) gl.linkProgram(p);
  for (const p of programs) if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) report(p);
  ```
- Avoid/caveats: Shader compilation can take seconds on some drivers and blocks if forced synchronously (Mozilla talk). Keep the set of program variants small; use uniforms for style differences.
- Status: Baseline.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; http://nical.github.io/onGameStart2013/

### Use KHR_parallel_shader_compile and warm up programs before interaction
- Layer: gpu
- Stage: script-compile, idle, main-thread-task
- Metrics: startup, INP, TBT
- When: load
- Impact: medium, because polling completion avoids blocking the main thread while programs link.
- Do: Get the extension; after issuing links, poll `getProgramParameter(p, ext.COMPLETION_STATUS_KHR)` once per frame, and query `LINK_STATUS` only when complete. Start compiling while data downloads. Link every program the chart may need before the first user interaction.
- Why: MDN and the Khronos spec: the extension adds a non-blocking completion query; without it there is no way to check status without a possible stall. Emscripten suggests compiling in parallel with asset downloads.
- Example:
  ```ts
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  const ready = (p: WebGLProgram) => !ext || gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR);
  ```
- Avoid/caveats: Total wall time is similar; the win is responsiveness. Without the extension, the first status query blocks.
- Status: Limited availability (MDN): Chrome 76, Safari 14.1, not Firefox (BCD); 75.45% of WebGL2 reports (web3dsurvey).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/KHR_parallel_shader_compile ; https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/ ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html

### Create GPU objects at load and delete them eagerly, but outside the frame loop
- Layer: gpu
- Stage: gpu-upload, gc-memory
- Metrics: FPS/smoothness, memory
- When: load, long-lived session
- Impact: medium, because creation calls and deletes of in-use resources can cause pipeline syncs, while waiting for GC wastes GPU memory.
- Do: Create buffers, textures, programs and FBOs at load or a few frames before first use. Delete shader objects right after linking. When a chart or chunk is gone, call `delete*` explicitly, between frames, not right after drawing with the object in the same frame.
- Why: MDN: delete eagerly; deleting releases the handle, and the driver frees the object when no longer used. Emscripten: avoid `glGen*/glCreate*` at render time, and deleting a just-used resource can flush the pipeline.
- Avoid/caveats: Keep a small pool for frequently recycled objects (ring buffers, PBOs) instead of create/delete churn.
- Status: Baseline.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html

### Move per-pixel work to the vertex shader and use builtins
- Layer: gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because fragment shaders run far more often than vertex shaders.
- Do: Compute anything linear across a primitive (colors, UV transforms, pixel-space offsets) per vertex and pass it as a varying. Use `dot`, `mix`, `normalize`, `smoothstep`, `clamp` instead of hand-written equivalents. Keep branches uniform-driven (coherent) rather than data-divergent.
- Why: MDN: varying interpolation is cheap fixed-function work; builtins may map to special hardware instructions. Mozilla's talk: divergent branches often cost both sides; coherence helps.
- Avoid/caveats: If a mesh has more vertices than covered pixels (dense series), reduce vertex count (LOD/decimation to about pixel density) instead of moving work to the fragment stage (MDN).
- Status: Baseline.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; http://nical.github.io/onGameStart2013/

### Avoid discard, needless blending and overdraw
- Layer: gpu
- Stage: gpu-draw, raster
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: high when fill-rate bound, because every covered pixel costs shading and blending bandwidth.
- Do: Disable blending for opaque passes and enable it only for antialiased edges or translucent fills. Prefer alpha coverage over `discard`. Do not draw full-screen translucent layers every frame. Skip marks that fall outside the viewport or overlap into the same pixel column (decimate). If depth is on, draw opaque content front to back.
- Why: webgl2fundamentals Q&A: `discard` seemed slower because the GPU cannot know the depth result before running the shader; blending must read the destination; a 2018 MacBook Air drew only about 5 million pixels per frame at 60 fps. Emscripten recommends measuring overdraw and sorting to cut it; tile-based GPUs suffer from dependent writes.
- Avoid/caveats: Exact costs vary by GPU; measure with the "shrink the canvas" test.
- Status: n/a (technique).
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-qna-the-fastest-way-to-draw-many-circles.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-optimize-drawing-lots-of-large-images.html ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-drawing-multiple-things.html

### Allocate textures with texStorage2D and update with texSubImage2D
- Layer: gpu
- Stage: gpu-upload, gc-memory
- Metrics: memory, FPS/smoothness
- When: load, animation/render-loop
- Impact: medium, because mutable `texImage2D` levels cannot be prepared until draw time and may allocate a full mip chain.
- Do: In WebGL2 allocate each texture once with `texStorage2D(target, levels, sizedFormat, w, h)` (levels = 1 unless mipmapped) and fill or update regions with `texSubImage2D`. For streaming data textures (heatmaps), update only the changed rows/columns.
- Why: MDN: with `texImage*` each level can differ in size until draw, so the driver cannot allocate early, and some drivers allocate the whole mip chain (+30%). The spec also allows zero-initialized compressed textures only through `texStorage2D`.
- Example:
  ```ts
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, rowData);
  ```
- Avoid/caveats: `texStorage` textures are immutable in size and format; resizing means a new texture. Creating a texture without data forces a zero-fill (webgl2fundamentals: supplying zeros yourself is even more work).
- Status: `texStorage2D` Baseline Widely available since September 2021 (MDN).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/texStorage2D ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-tex-image-texture_2d-level-0-is-incurring-lazy-initialization.html

### Mipmap only textures that are drawn minified
- Layer: gpu
- Stage: gpu-draw, gc-memory
- Metrics: memory, FPS/smoothness
- When: load
- Impact: low to medium, because mipmaps cost about 30% more memory but make minified sampling cache-friendly.
- Do: Generate mipmaps for images that are drawn smaller than their size (icons at many scales). For 1:1 UI textures and data textures set `TEXTURE_MIN_FILTER` to `LINEAR` or `NEAREST` (the default expects mipmaps) and allocate 1 level.
- Why: MDN: sampling a zoomed-out texture without mips ruins texture cache locality; 2D resources that are never minified should not pay the 30%. webgl2fundamentals: a 2x2 quad from a 1024x1024 texture without mips is slower.
- Status: Baseline; NPOT mipmaps and wrap modes are fully supported in WebGL2 only (WebGL1 needs power-of-two for mips).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-optimize-drawing-lots-of-large-images.html ; https://registry.khronos.org/webgl/specs/latest/2.0/ (Non-Power-of-Two Texture Access)

### Use RGBA8 instead of RGB8, and budget depth/stencil at 4 bytes per pixel
- Layer: gpu
- Stage: gpu-upload, gpu-draw, gc-memory
- Metrics: FPS/smoothness, memory
- When: load
- Impact: low to medium, because three-channel formats are often emulated with masking or blend patching.
- Do: Use `RGBA8` and ignore alpha yourself. When estimating memory, count depth and stencil formats as 4 bytes per pixel.
- Why: MDN: RGB8 is often surprisingly slow; RGB32F is often RGBA32F; DEPTH_COMPONENT24 or STENCIL_INDEX8 often become 32-bit formats.
- Status: Baseline.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices

### Upload DOM-sourced textures before drawing, preferably from ImageBitmap
- Layer: gpu
- Stage: gpu-upload, main-thread-task
- Metrics: FPS/smoothness, INP
- When: load, animation/render-loop
- Impact: medium, because a `texImage2D` from an image, canvas or video in the middle of a pass runs an internal conversion draw that flushes the pipeline.
- Do: Do all texture uploads at the start of the frame (before binding your first program) or between passes. Decode images with `createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'premultiply' | 'none', colorSpaceConversion: 'none' })` off the render path and call `bitmap.close()` after upload. For video, upload only when a new frame exists (`requestVideoFrameCallback`).
- Why: MDN shows the hidden program switch and extra draw (y-flip, color transform, premultiply) per DOM upload. The WebGL spec says `UNPACK_FLIP_Y_WEBGL`, `UNPACK_PREMULTIPLY_ALPHA_WEBGL` and `UNPACK_COLORSPACE_CONVERSION_WEBGL` are ignored for ImageBitmap sources; set the equivalent ImageBitmap options instead. webgl2fundamentals found `texImage2D`, not decoding, caused jank, and notes Chrome copies the pixels to the GPU process (4 MB for a 1024x1024 RGBA image).
- Avoid/caveats: Large uploads can still jank; split huge images into tiles or upload a few rows per frame with `texSubImage2D`.
- Status: `createImageBitmap`: Chrome 50, Firefox 42, Safari 15; `premultiplyAlpha` option Safari 17; `imageOrientation: 'flipY'` Chrome 52, Firefox 93, Safari 15 (BCD). `requestVideoFrameCallback`: Chrome 83, Firefox 132, Safari 15.4 (BCD). Firefox Android lacks video-element texture sources (BCD texImage2D note).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://registry.khronos.org/webgl/specs/latest/1.0/ (Pixel Storage Parameters) ; https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-how-to-load-images-in-the-background-with-no-jank.html

### Avoid per-upload conversions (premultiply, flip, color space)
- Layer: gpu
- Stage: gpu-upload
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low to medium, because each mismatch between source and requested layout adds conversion work and can lose precision.
- Do: For Canvas2D sources (label atlases) set `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` and blend premultiplied, because 2D canvases are premultiplied already. Flip V in the shader or in UVs instead of setting `UNPACK_FLIP_Y_WEBGL`. For images that carry data (not colors), set `UNPACK_COLORSPACE_CONVERSION_WEBGL = gl.NONE`.
- Why: webgl2fundamentals: with the default (false), WebGL converts premultiplied canvas data back to unpremultiplied, which is lossy. The spec: browser-default color conversion may transform the pixels; `NONE` skips it. (Treating UV flipping as cheaper than unpack flipping is an inference from MDN's description of the conversion pass.)
- Status: Baseline.
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-and-alpha.html ; https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/pixelStorei ; https://registry.khronos.org/webgl/specs/latest/1.0/ (Pixel Storage Parameters)

### Draw text from a glyph atlas (or DOM), not one texture or draw per label
- Layer: gpu
- Stage: gpu-draw, gpu-upload, script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium for axis labels and price tags, because per-glyph or per-label draws explode call counts.
- Do: Rasterize the needed glyphs once into an atlas (for example with Canvas2D), build one vertex buffer of glyph quads, and draw all labels in one call. Update only the label vertices that change, and reuse arrays.
- Why: webgl2fundamentals: 73 individually drawn glyph quads were already slow; an atlas plus one buffer is the usual approach; browsers themselves use an LRU glyph cache in an atlas.
- Avoid/caveats: Full Unicode does not fit in one atlas; use a cache. For a handful of labels, DOM text is simpler (see overlay rule).
- Status: Baseline.
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-text-glyphs.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-how-to-optimize-rendering-a-ui.html

### Use compressed textures (KTX2 / Basis Universal) for large image assets
- Layer: build
- Stage: network, gpu-upload, gc-memory
- Metrics: memory, startup
- When: build, load
- Impact: low for charts (few large images), high for image-heavy scenes, because GPU-compressed formats cut VRAM and sampling bandwidth.
- Do: Ship large color textures as KTX2 with Basis Universal supercompression and transcode at load (WASM, in a worker) to the best supported format: ASTC, BC7/BC1-3 (S3TC), or ETC2. Check `gl.getExtension(...)` for each format; keep PNG as the fallback.
- Why: MDN: compressed formats are smaller in GPU memory and faster to sample, but no format is universal; Basis Universal transcodes one file to all common formats and is close to JPEG size over the wire. The WebGL2 spec (editor's draft) requires ETC2/EAC or the S3TC + S3TC-sRGB + RGTC suite. WebGL offers no compressor; data must already be compressed.
- Avoid/caveats: Quality is worse than JPG and unsuitable for data (MDN). Hardware availability varies: ASTC 47.49%, ETC 48.34%, S3TC 86.08%, BPTC 84% of WebGL2 reports (web3dsurvey).
- Status: API extensions exist in all engines (BCD: ASTC Chrome 47 / Firefox 53 / Safari 12; ETC Chrome 63 / Firefox 55 / Safari 13.1; S3TC desktop only). Real availability is hardware-bound.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Compressed_texture_formats ; https://registry.khronos.org/webgl/specs/latest/2.0/ (Required compressed texture formats) ; https://github.com/BinomialLLC/basis_universal/blob/master/webgl/README.md ; https://web3dsurvey.com/webgl2

### Store bulk per-item data in textures and fetch it with texelFetch when attributes do not fit
- Layer: gpu
- Stage: gpu-upload, gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because one draw can then render thousands of differently styled items in any order.
- Do: Put per-series or per-object data (matrices, colors, offsets) in an RGBA32F or integer texture with `NEAREST` filtering; give each vertex an object id and read the data with `texelFetch` in the vertex shader. Update the texture with one `texSubImage2D` per frame.
- Why: webgl2fundamentals: 2000 objects from 4 models drawn in one call; vertex pulling allows arbitrary order (useful for transparency sorting across models). Float textures are not filterable by default, so use `NEAREST`.
- Avoid/caveats: The author notes texture fetches may be slower than attributes on some GPUs; measure. Watch `MAX_TEXTURE_SIZE` for row-per-object layouts.
- Status: `texelFetch` and integer textures: WebGL2 core.
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-qna-drawing-many-different-models-in-a-single-draw-call.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-pulling-vertices.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-data-textures.html

### Stay within portable limits and query them once at init
- Layer: gpu
- Stage: script-run
- Metrics: FPS/smoothness
- When: load, testing
- Impact: medium, because code tuned to a desktop's limits fails or falls back slowly on common devices.
- Do: Design for `MAX_TEXTURE_SIZE` 4096 (all reports have at least 4096; 86% have 16384), point sizes up to 100, 16 vertex attributes, and the WebGL2 minimums for uniforms and texture units. Read the actual values once and pick a code path.
- Why: MDN lists practical minimums (for example `MAX_TEXTURE_SIZE: 4096`, `ALIASED_POINT_SIZE_RANGE: [1,100]`, `MAX_FRAGMENT_UNIFORM_VECTORS: 64` for WebGL1-class devices). webgl2fundamentals: the maximum texture size is not a promise of memory for that size.
- Avoid/caveats: The drawing buffer can be clamped below the requested canvas size; always use `drawingBufferWidth/Height`.
- Status: Baseline.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html ; https://web3dsurvey.com/webgl2

### Build framebuffers once and switch with one bind
- Layer: gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: load, animation/render-loop
- Impact: medium, because changing FBO attachments invalidates completeness and forces revalidation.
- Do: Create one FBO per render target with fixed attachments at setup. Switch targets with a single `bindFramebuffer`. Recreate FBOs only on resize.
- Why: MDN: almost any attachment change invalidates completeness; set up hot framebuffers ahead of time. Emscripten: use multiple immutable FBOs instead of mutating one.
- Avoid/caveats: In Firefox, `webgl.perf.max-warnings = -1` in about:config shows completeness-invalidation warnings.
- Status: Baseline.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html

### Invalidate depth, stencil and MSAA attachments after their last use
- Layer: gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium on mobile tile-based GPUs, because storing attachments you never read back costs memory bandwidth.
- Do: After the last draw that needs them (for example after `blitFramebuffer` resolves an MSAA target), call `gl.invalidateFramebuffer(target, [gl.DEPTH_STENCIL_ATTACHMENT, gl.COLOR_ATTACHMENT0])` for contents you will not read. Clear attachments at the start of a pass instead of loading old contents.
- Why: MDN: storing unneeded data is costly on tiled GPUs; depth/stencil and multisampled attachments are prime candidates. Emscripten also recommends discarding FBO contents and sorting by target first.
- Avoid/caveats: The spec allows implementations to make it a no-op, and contents become unchanged or cleared, never garbage. Do not invalidate the color you will sample or present.
- Status: Baseline Widely available since September 2021 (MDN).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/invalidateFramebuffer ; https://registry.khronos.org/webgl/specs/latest/2.0/ (Framebuffer contents after invalidation)

### Read back asynchronously with PIXEL_PACK_BUFFER + fenceSync
- Layer: gpu
- Stage: gpu-draw, main-thread-task
- Metrics: FPS/smoothness, INP, TBT
- When: animation/render-loop, interaction
- Impact: high, because `readPixels` into a CPU array waits for all prior GPU work and an inter-process round trip.
- Do: `readPixels` into a buffer bound to `PIXEL_PACK_BUFFER` (allocated with `STREAM_READ`), insert `fenceSync`, call `flush()`, poll in later frames with `getSyncParameter(sync, SYNC_STATUS)` or `clientWaitSync(sync, 0, 0)`, then `getBufferSubData`. Reuse the PBO.
- Why: The WebGL2 spec calls CPU `readPixels` blocking and expensive in multi-process browsers, and recommends a pack buffer plus a fence before `getBufferSubData`. Sync results never become available in the same frame. `MAX_CLIENT_WAIT_TIMEOUT_WEBGL` may be 0; only 7% of reports allow at least 1 s (web3dsurvey), so never block on it.
- Example:
  ```ts
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
  gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!; gl.flush();
  const poll = () => {
    if (gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED) return requestAnimationFrame(poll);
    gl.deleteSync(sync);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); onData(out);
  };
  requestAnimationFrame(poll);
  ```
- Avoid/caveats: The result is at least one frame late. Only RGBA/UNSIGNED_BYTE (normalized targets) is a guaranteed format pair; query `IMPLEMENTATION_COLOR_READ_FORMAT/TYPE` for others.
- Status: `fenceSync`, `clientWaitSync`, `getBufferSubData` Baseline Widely available since September 2021 (MDN).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://registry.khronos.org/webgl/specs/latest/2.0/ (Reading back pixels, getBufferSubData, clientWaitSync, sync objects) ; https://webgl2fundamentals.org/webgl/lessons/webgl-readpixels.html ; https://web3dsurvey.com/webgl2

### Hit-test chart data on the CPU instead of GPU picking with readPixels
- Layer: js
- Stage: script-run, main-thread-task
- Metrics: INP
- When: interaction
- Impact: medium, because a pointer-move `readPixels` stalls every move, while chart data is sorted by time and can be searched in O(log n).
- Do: Convert the pointer to data space with the same float64 transform the renderer uses, then binary-search the time array and test nearby points or bars. Use GPU id-buffer picking only for shapes without a cheap CPU test, and then read back asynchronously (1x1 pixel).
- Why: webgl2fundamentals' GPU picking reads one pixel per frame (it renders a 1-pixel frustum to reduce cost), and `readPixels` to CPU is a full stall (MDN, spec). The CPU-first recommendation for sorted chart data is an inference, not a source quote.
- Status: n/a (technique).
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-picking.html ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices

### Keep blocking queries out of production hot paths
- Layer: js
- Stage: main-thread-task, gpu-draw
- Metrics: FPS/smoothness, TBT, INP
- When: animation/render-loop
- Impact: high, because each synchronous query can flush and wait for the GPU process (up to about 1 ms or a full finish) and can jank the whole page.
- Do: Remove `getError`, `get*Parameter`, `checkFramebufferStatus`, `getShader/ProgramParameter`, `get*InfoLog`, `getBufferSubData` (without a fence) and CPU `readPixels` from the frame loop. Wrap error checks in a debug-only flag. Read limits once at init.
- Why: MDN lists these as flush plus round-trip calls; `getError` alone forces a flush and a trip to the GPU process. Emscripten: never call `glGetError` or `glCheckFramebufferStatus` at render time, and query `glGet*` at startup. Mozilla's talk names `getError`, `readPixels` and `finish` as sync points that block the JS thread.
- Example:
  ```ts
  const check = DEBUG ? (tag: string) => { const e = gl.getError(); if (e) console.warn(tag, e); } : () => {};
  ```
- Avoid/caveats: Firefox checks GL errors internally only after allocations to catch OUT_OF_MEMORY; a well-formed page should produce no errors other than OUT_OF_MEMORY and CONTEXT_LOST.
- Status: Baseline.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; http://nical.github.io/onGameStart2013/

### Time GPU work with EXT_disjoint_timer_query_webgl2, not gl.finish
- Layer: tooling
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: testing
- Impact: low in production, high for diagnosis, because CPU timers around WebGL calls measure submission, not GPU time.
- Do: In development builds, wrap passes with `beginQuery(ext.TIME_ELAPSED_EXT, q)` / `endQuery`, and read results in later frames when `QUERY_RESULT_AVAILABLE` is true and `GPU_DISJOINT_EXT` is false. Fall back to frame-time sampling when the extension is missing.
- Why: webgl2fundamentals: in Chrome `gl.finish` is only a flush, and timing with finish includes stalls that do not happen in real use. The Khronos spec makes query results available only after control returns to the browser.
- Example:
  ```ts
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (tq) { gl.beginQuery(tq.TIME_ELAPSED_EXT, q); drawSeries(); gl.endQuery(tq.TIME_ELAPSED_EXT); }
  ```
- Avoid/caveats: Use all bits of the 64-bit result. Results can be disjoint (discard them).
- Status: Chrome 70 desktop, Edge 80; not Chrome Android, Firefox or Safari (BCD); 67.1% of WebGL2 reports (web3dsurvey).
- Sources: https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/ ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-is-it-possible-to-measure-rendering-time-in-webgl-using-gl-finish---.html ; https://github.com/mdn/browser-compat-data/blob/main/api/EXT_disjoint_timer_query_webgl2.json

### Budget VRAM per pixel and track the bytes of every resource
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: high for long sessions with many symbols and timeframes, because WebGL has no portable VRAM query and running out leads to OUT_OF_MEMORY or context loss.
- Do: Pick a maximum VRAM for a reference machine, divide by its maximized window size in device pixels to get bytes per pixel, and cap all GPU caches (buffers, textures, FBO layer caches) at that constant times the current window's device pixels. Track estimated bytes per resource and evict least-recently-used chunks when above the cap; recompute on resize.
- Why: MDN describes this per-pixel budget technique, pioneered by the Google Maps team, as portable across devices.
- Example:
  ```ts
  const budget = BYTES_PER_PIXEL * innerWidth * innerHeight * devicePixelRatio ** 2;
  while (gpuBytes > budget) evictOldestChunk();
  ```
- Avoid/caveats: Include hidden costs: the drawing buffer (and MSAA copies), depth/stencil rounded to 4 bytes, mip chains (+30%), and browser shadow copies (index buffers in Firefox, `_READ` buffers).
- Status: n/a (technique).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://groups.google.com/g/webgl-dev-list/c/8gfFD7eTUYQ ; https://registry.khronos.org/webgl/specs/latest/2.0/

### Ship with zero WebGL errors and read the browser's performance warnings
- Layer: tooling
- Stage: script-run
- Metrics: FPS/smoothness
- When: testing
- Impact: medium, because errors hide real bugs and some warnings name real costs (lazy texture clears, attribute-0 emulation, FBO revalidation).
- Do: In CI or dev runs, fail on WebGL console errors. Enable Firefox performance warnings (`webgl.perf.max-warnings = -1`). Treat "lazy initialization" warnings as information, not as a reason to upload zeros yourself.
- Why: MDN: every WebGL error becomes a console warning, and after too many (32 in Firefox) the messages stop, which hinders debugging. webgl2fundamentals: the lazy-init warning means the browser zeroed a texture; filling it from JS costs more.
- Status: n/a (process).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-tex-image-texture_2d-level-0-is-incurring-lazy-initialization.html

### Find the bottleneck by shrinking the canvas and zeroing draw counts
- Layer: tooling
- Stage: gpu-draw, script-run
- Metrics: FPS/smoothness
- When: testing
- Impact: medium, because fixing the wrong stage (CPU, vertex, fragment) wastes effort.
- Do: Temporarily set the canvas (or FBO) to 1x1: a large speed-up means fragment-bound. Then set draw counts to 0: still slow means CPU-bound (JS or WebGL call overhead), fast means vertex-bound. Use the Firefox Profiler or Chrome tracing for call-level costs.
- Why: webgl2fundamentals Q&A gives this triage; Emscripten notes that pipelining makes profilers blame the wrong calls and lists browser and native profilers.
- Status: n/a (process).
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-qna-a-simple-way-to-show-the-load-on-the-gpu-s-vertex-and-fragment-processing-.html ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html ; http://nical.github.io/onGameStart2013/

### Test on low-end and mobile GPUs, not only the development desktop
- Layer: tooling
- Stage: gpu-draw
- Metrics: FPS/smoothness, memory
- When: testing
- Impact: high, because desktop GPUs hide mediump bugs, have larger limits and can be about 100x faster than low-end GPUs.
- Do: Keep a test matrix with an integrated-GPU laptop, an Android phone, an iPhone/iPad (Safari, ANGLE on Metal) and a software-rendering run (`failIfMajorPerformanceCaveat` path). Check precision artifacts, extension fallbacks and frame time on each.
- Why: webgl2fundamentals: a top GPU may be 100x faster than a low-end one, limits vary, and mediump is highp on desktop. Emscripten: driver behavior differs, so benchmarking across hardware is almost required.
- Status: n/a (process).
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html ; https://emscripten.org/docs/optimizing/Optimizing-WebGL.html

## Sources read
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices (full page)
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Types
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Data
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Compressed_texture_formats
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Using_Extensions
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event
- https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/getContextAttributes
- https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/bufferData
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/bufferSubData
- https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/vertexAttribPointer
- https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/pixelStorei
- https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texImage2D
- https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/getError
- https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/lineWidth
- https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/isContextLost
- https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/drawingBufferColorSpace
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/texStorage2D
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/invalidateFramebuffer
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/fenceSync
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/clientWaitSync
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/drawArraysInstanced
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/uniformBlockBinding
- https://developer.mozilla.org/en-US/docs/Web/API/KHR_parallel_shader_compile
- https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_multi_draw
- https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_lose_context
- https://developer.mozilla.org/en-US/docs/Web/API/EXT_color_buffer_float
- https://developer.mozilla.org/en-US/docs/Web/API/EXT_float_blend
- https://developer.mozilla.org/en-US/docs/Web/API/OES_texture_float_linear
- https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
- https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap
- MDN browser-compat-data raw JSON (main branch, 2026-09-22): api/KHR_parallel_shader_compile, WEBGL_multi_draw, EXT_disjoint_timer_query_webgl2, EXT_float_blend, WEBGL_compressed_texture_astc, WEBGL_compressed_texture_etc, WEBGL_compressed_texture_s3tc, EXT_texture_compression_bptc, EXT_color_buffer_half_float, EXT_color_buffer_float, OES_texture_float_linear, EXT_texture_norm16, OES_draw_buffers_indexed, WebGLRenderingContext, WebGL2RenderingContext, ResizeObserverEntry, OffscreenCanvas, HTMLCanvasElement, ImageBitmap, _globals/createImageBitmap, HTMLVideoElement, DedicatedWorkerGlobalScope, WEBGL_lose_context; javascript/builtins/Float16Array (https://github.com/mdn/browser-compat-data)
- https://registry.khronos.org/webgl/specs/latest/1.0/ (editor's draft 2026-06-30)
- https://registry.khronos.org/webgl/specs/latest/2.0/ (editor's draft 2026-06-30)
- https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/
- https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/
- https://registry.khronos.org/webgl/extensions/WEBGL_provoking_vertex/
- https://webgl2fundamentals.org/ (index) and https://webgl2fundamentals.org/webgl/lessons/webgl-qna.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-anti-patterns.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-cross-platform-issues.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-drawing-multiple-things.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-instanced-drawing.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-precision-issues.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-readpixels.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-multiple-views.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-and-alpha.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-tips.html
- https://webgl2fundamentals.org/webgl/lessons/webgl2-whats-new.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-text-html.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-text-glyphs.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-picking.html (skimmed)
- https://webgl2fundamentals.org/webgl/lessons/webgl-data-textures.html (skimmed)
- https://webgl2fundamentals.org/webgl/lessons/webgl-pulling-vertices.html (skimmed)
- https://webgl2fundamentals.org/webgl/lessons/webgl-qna-how-to-optimize-rendering-a-ui.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-qna-rendering-slowly-over-time.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-qna-tex-image-texture_2d-level-0-is-incurring-lazy-initialization.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-qna-the-fastest-way-to-draw-many-circles.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-qna-how-to-load-images-in-the-background-with-no-jank.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-qna-is-it-possible-to-measure-rendering-time-in-webgl-using-gl-finish---.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-qna-sorting-and-optimizing-instanced-rendering.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-qna-when-to-choose-highp--mediump--lowp-in-shaders.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-qna-optimize-drawing-lots-of-large-images.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-qna-drawing-many-different-models-in-a-single-draw-call.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-qna-a-simple-way-to-show-the-load-on-the-gpu-s-vertex-and-fragment-processing-.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-qna-can-i-mute-the-warning-about-vertex-attrib-0-being-disabled-.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-qna-recording-fps-in-webgl.html
- https://emscripten.org/docs/optimizing/Optimizing-WebGL.html
- http://nical.github.io/onGameStart2013/ (Nicolas Silva, Mozilla, 2013 talk slides)
- https://developer.chrome.com/blog/desynchronized
- https://web.dev/articles/offscreen-canvas
- https://groups.google.com/g/webgl-dev-list/c/vMNXSNRAg8M (2014; Ken Russell, Jeff Gilbert)
- https://groups.google.com/g/webgl-dev-list/c/8gfFD7eTUYQ (2022; Kelsey Gilbert, Ken Russell)
- https://web3dsurvey.com/webgl2 and https://web3dsurvey.com/webgl (read 2026-09-22)
- https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc
- https://help.agi.com/AGIComponents/html/BlogPrecisionsPrecisions.htm
- https://godotengine.org/article/emulating-double-precision-gpu-render-large-worlds/
- https://deck.gl/docs/developer-guide/coordinate-systems
- https://wwwtyro.net/2019/11/18/instanced-lines.html (blog)
- https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/TechniquesforWorkingwithVertexData/TechniquesforWorkingwithVertexData.html (legacy OpenGL ES guide)
- https://github.com/BinomialLLC/basis_universal/blob/master/webgl/README.md

## Not covered / could not access
- Khronos WebGL wiki (HandlingContextLost, HandlingHighDPI, WebGL_and_OpenGL_Differences): wikis.khronos.org returns 403 behind a Cloudflare challenge; the Wayback copy returned an empty body. Context-loss and HiDPI rules above rely on the WebGL spec, MDN and webgl2fundamentals instead.
- SciChart blog "Nanosecond Precision ... 64-bit precision" and SciChart.js docs: 403 (Cloudflare). The claim that SciChart.js uses a 64-bit coordinate pipeline comes only from a search-result summary and is unverified.
- Default value of Chromium's active WebGL context cap: the source reads it from GPU preferences; I did not find the default in source. "16 on desktop" comes from third-party bug reports; webgl2fundamentals says "as low as 8" in some browsers.
- Google I/O / Khronos meetup video talks on WebGL performance (video only); covered indirectly by MDN (written with browser implementers), Emscripten and webgl-dev-list answers by Chrome/Firefox engineers.
- hacks.mozilla.org "WebGL off the main thread" (2016) not read; MDN and web.dev OffscreenCanvas pages were used.
- Vendor GPU guides (Arm Mali, Apple Metal, Qualcomm Adreno) for tile-based specifics were not read; tile-based advice comes from MDN and Emscripten.
- WebGPU equivalents are out of scope for this file.
- Not verified: whether GPU shader compilers can reorder the high/low subtraction in the RTE shader, and exact per-browser costs of `UNPACK_FLIP_Y_WEBGL` vs flipping UVs.
- WebGL2 line/point limits (`ALIASED_LINE_WIDTH_RANGE`) are not published by web3dsurvey; the "max line width is 1" statement comes from webgl2fundamentals.
