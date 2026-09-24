# Canvas 2D, text-to-texture, and image decoding (the glue around WebGL charts)

Scope: the Canvas 2D API, OffscreenCanvas, ImageBitmap, image decoding, and the path from 2D-rasterized text or images into WebGL/WebGPU textures (axis labels, overlays, annotations, crosshairs, tooltips, legends).
Sources: MDN (Optimizing canvas, getContext, createImageBitmap, decode, OffscreenCanvas, WebGL best practices, tutorials), web.dev (canvas-performance 2011, offscreen-canvas, device-pixel-content-box), developer.chrome.com (canvas2d, desynchronized, createImageBitmap, HTML-in-canvas OT), WHATWG HTML canvas/ImageBitmap/img specs, Khronos WebGL 1/2 specs, W3C WebGPU spec, Chromium source on `main` (read 2026-09-22), MDN BCD API + webstatus.dev API (queried 2026-09-22), WebKit release notes, webgl2fundamentals, TinySDF, SciChart.js docs, and a few blogs (marked).
Note: web.dev "Improving HTML5 Canvas performance" is from 2011; items that depend on it carry a caveat. Chromium-internal behavior is quoted from source and applies to Chrome/Edge only.

---

## A. Context creation and lifecycle

### Declare `willReadFrequently` explicitly on every 2D context
- Layer: canvas2d
- Stage: raster, gpu-upload, main-thread-task
- Metrics: FPS/smoothness, INP, memory
- When: load (context creation)
- Impact: high, because an undeclared value lets Chrome silently move a GPU canvas to the CPU after two reads.
- Do: Pass `willReadFrequently: true` for canvases you read with `getImageData` often (text measurement by pixels, SDF generation, color-pick hit canvases). Pass `willReadFrequently: false` for display and texture-source canvases that you read rarely. Never leave it unset on a canvas that is ever read.
- Why: The spec says the flag tells the UA to prefer a software (CPU) bitmap, which makes readback cheap but drawing slower. In Chromium, when the flag is left undefined, each `getImageData` on an accelerated canvas increments a counter and after `kFallbackToCPUAfterReadbacks = 2` reads Chrome calls `DisableAcceleration()` (the pre-flag legacy behavior); with an explicit `false` it stays on the GPU. Chrome also prints the console warning "Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true" on the second read. A document-level counter also starts new undeclared canvases on the CPU once 100+ canvases (and 95%) lost acceleration.
- Example:
  ```js
  // before: undeclared, Chrome may demote the chart overlay to CPU after 2 reads
  const overlay = canvas.getContext('2d');
  // after
  const overlay = canvas.getContext('2d', { willReadFrequently: false }); // display, stays GPU
  const scratch = new OffscreenCanvas(256, 64).getContext('2d', { willReadFrequently: true }); // pixel reads
  ```
- Avoid/caveats: `true` makes drawing and texture upload slower (CPU bitmap → CPU upload path in Chrome, see D4). Context attributes are fixed at first `getContext` call; a second call with other options returns the same context.
- Status: Chrome 99, Firefox 28, Safari 18. Baseline newly available since 2024-09-16 (webstatus `canvas-2d-willreadfrequently`).
- Sources: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently ; https://developer.chrome.com/blog/canvas2d ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/canvas/canvas2d/base_rendering_context_2d.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/html/canvas/html_canvas_element.cc ; https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext

### Use `alpha: false` only on opaque 2D canvases, never as a WebGL speed trick
- Layer: canvas2d
- Stage: composite, raster
- Metrics: FPS/smoothness
- When: load
- Impact: low, because it is only a hint for the 2D compositor, and on WebGL it can cost more.
- Do: For a 2D canvas that always paints an opaque background (a chart background layer), create it with `{ alpha: false }`. For WebGL, keep `alpha: true` and write alpha = 1.0 in the shader instead of `alpha: false`.
- Why: MDN says an opaque 2D backdrop lets the browser optimize drawing and compositing. For WebGL, MDN's best practices say `alpha:false` can force RGB emulation on an RGBA surface with a significant cost on some platforms.
- Avoid/caveats: With `alpha:false` the bitmap starts opaque black and `clearRect` yields black, not transparent (spec). Do not use it on overlay layers that must show the chart beneath.
- Status: 2D `alpha` option: Chrome 32, Firefox 30, Safari not supported (BCD). webstatus `canvas-2d-alpha`: limited availability.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://html.spec.whatwg.org/multipage/canvas.html

### Keep label and overlay canvases in the default color format (`srgb`, `unorm8`)
- Layer: canvas2d
- Stage: gpu-upload, gc-memory
- Metrics: memory, FPS/smoothness
- When: load
- Impact: medium, because `float16` doubles bytes per pixel and a color-space mismatch adds a conversion on every upload.
- Do: Leave `colorSpace` and `colorType` at defaults for canvases whose pixels go into a WebGL texture. Only choose `display-p3`/`float16` when the whole pipeline (WebGL `drawingBufferColorSpace`/`unpackColorSpace`, WebGPU `colorSpace`) uses the same space.
- Why: `float16` stores 8 bytes per pixel instead of 4 (spec ImageData `rgba-float16`). Chromium converts an accelerated image to the WebGL unpack color space on the GPU before the copy; the WebGPU spec says conversion "might not be necessary" only when the destination `colorSpace` matches the source.
- Avoid/caveats: Wide-gamut brand colors in labels may look slightly different in sRGB; this is a visual, not a performance, decision.
- Status: 2D `colorSpace`: Chrome 92, Safari 15.2, Firefox no. `colorType`: Chrome 137 only, experimental (BCD). Safari 27 beta adds `srgb-linear`/`display-p3-linear` predefined color spaces.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext ; https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html ; https://www.w3.org/TR/webgpu/ ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc ; https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/

### Use `desynchronized: true` only for a pointer-following layer, with no DOM above it
- Layer: canvas2d
- Stage: composite, paint
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: medium, because it removes compositor latency for crosshair/drawing-tool feedback but can tear.
- Do: Create a separate small overlay (crosshair, drawing-in-progress stroke) with `getContext('2d', { desynchronized: true })`. Check `ctx.getContextAttributes().desynchronized` to detect support. Keep other DOM elements from overlapping a transparent desynchronized canvas.
- Why: The hint lets the UA bypass the normal DOM/compositor update and, on some devices, send the buffer straight to the display controller (front-buffer rendering). The spec warns this can introduce tearing.
- Avoid/caveats: Clearing the whole canvas in a desynchronized context can flicker; Chrome's article suggests drawing into an offscreen buffer and copying. A translucent desynchronized canvas "must not have any other DOM elements above it". In Chromium, desynchronized canvases do not take the readback CPU fallback.
- Status: 2D: Chrome 81, Safari 15, Firefox no. WebGL/WebGL2 desynchronized: Chrome only. webstatus `canvas-2d-desynchronized`: limited.
- Sources: https://developer.chrome.com/blog/desynchronized ; https://html.spec.whatwg.org/multipage/canvas.html ; BCD api.HTMLCanvasElement.getContext

### Handle `contextlost`/`contextrestored` on 2D canvases that hold caches
- Layer: canvas2d
- Stage: gpu-upload, gc-memory
- Metrics: memory, FPS/smoothness
- When: long-lived session
- Impact: medium, because a GPU reset or memory pressure silently empties atlas/source canvases in long trading sessions.
- Do: Listen for `contextlost` on 2D canvases (and OffscreenCanvas) that you use as caches or texture sources; on `contextrestored`, re-rasterize and mark dependent WebGL textures dirty. Check `ctx.isContextLost()` before reusing a cached canvas.
- Why: Chrome added 2D context-loss events so pages can redraw after a GPU process crash or out-of-memory event. Without a handler, the cache is blank and every texture made from it is blank too.
- Example:
  ```js
  labelCanvas.addEventListener('contextrestored', () => { atlas.rebuildAll(); atlas.markAllPagesDirty(); });
  ```
- Avoid/caveats: Safari does not fire these events; keep a rebuild path you can also call on WebGL context restore.
- Status: Chrome 99, Firefox 125, Safari no. webstatus `canvas-context-lost`: limited.
- Sources: https://developer.chrome.com/blog/canvas2d ; https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/contextlost_event ; BCD api.OffscreenCanvas

---

## B. Drawing: paths, state, pixels

### Batch many segments into one path and one stroke per style
- Layer: canvas2d
- Stage: raster, main-thread-task
- Metrics: FPS/smoothness, TBT
- When: animation/render-loop
- Impact: high, because per-segment `beginPath`/`stroke` multiplies API calls and raster work (grid lines, tick marks, candle wicks).
- Do: Call `beginPath()` once, add every segment with `moveTo`/`lineTo`, then call `stroke()` once for each style.
- Why: Loading the state machine with many commands and then painting once is cheaper than many small paint operations (web.dev; MDN "Batch canvas calls together").
- Example:
  ```js
  // before: one stroke per grid line
  for (const x of xs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  // after: one path, one stroke
  ctx.beginPath();
  for (const x of xs) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  ctx.stroke();
  ```
- Avoid/caveats: web.dev notes an exception: primitives with small bounding boxes (short horizontal/vertical lines) can be faster drawn separately; measure. Very long single paths with self-overlap can raster slowly (joins); split per style, not per segment.
- Status: Core Canvas 2D, all browsers.
- Sources: https://web.dev/articles/canvas-performance ; https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas

### Group draws by style so state changes happen once per group
- Layer: canvas2d
- Stage: raster, main-thread-task
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because each style change is parsed/validated and may split internal batches.
- Do: Sort or bucket items by `fillStyle`/`strokeStyle`/`lineWidth`/`font`, set the state once per bucket, then draw all items in the bucket. Skip assignments when the value did not change.
- Why: The 2D context is a state machine; web.dev measured interleaved color changes as slower than "render by color". Chromium early-returns when the same string is assigned again, but every distinct change still costs a parse/lookup.
- Example:
  ```js
  // before: alternate colors per candle
  for (const c of candles) { ctx.fillStyle = c.up ? UP : DOWN; ctx.fillRect(c.x, c.y, c.w, c.h); }
  // after: two passes
  ctx.fillStyle = UP;   for (const c of ups)   ctx.fillRect(c.x, c.y, c.w, c.h);
  ctx.fillStyle = DOWN; for (const c of downs) ctx.fillRect(c.x, c.y, c.w, c.h);
  ```
- Avoid/caveats: Changing draw order changes overlap; only reorder items that do not overlap or where order does not matter.
- Status: Core Canvas 2D.
- Sources: https://web.dev/articles/canvas-performance ; https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas

### Reuse a few constant color strings; vary opacity with `globalAlpha`
- Layer: canvas2d, js
- Stage: script-run, main-thread-task
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, because building a new `rgba(...)` string per item defeats Chrome's color-parse cache and creates garbage.
- Do: Precompute the palette as string constants. For per-item opacity, keep the base color constant and set `ctx.globalAlpha` (a number). Keep the number of distinct color strings in a hot loop at 8 or fewer.
- Why: Chromium comments that parsing a color from a string "is expensive", so it keeps an LRU cache of parsed colors with `kColorCacheMaxSize = 8`, keyed by the internalized string. Template-literal colors are new strings each time and add parse cost and GC pressure.
- Example:
  ```js
  // before
  ctx.fillStyle = `rgba(38,166,154,${p.opacity})`;
  // after
  const UP = '#26a69a';
  ctx.fillStyle = UP; ctx.globalAlpha = p.opacity; /* draw */ ctx.globalAlpha = 1;
  ```
- Avoid/caveats: `globalAlpha` also affects images and text drawn afterwards; reset it. The cache size is a Chromium detail and can change.
- Status: `globalAlpha` universal. Cache: Chromium `main` as of 2026-09.
- Sources: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/canvas/canvas2d/canvas_2d_recorder_context.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/canvas/canvas2d/cached_color.h

### Avoid `save()`/`restore()` per item in hot loops; set the transform directly
- Layer: canvas2d
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: low, because the cost is per call, but it adds up for thousands of labels or markers.
- Do: For per-item positioning, use `ctx.setTransform(a, b, c, d, e, f)` (or pass coordinates directly) and restore the base transform once after the loop. Use `save()`/`restore()` around groups, not around each item.
- Why: In Chromium, `save()` allocates a garbage-collected copy of the full drawing state and records a save op. Direct transform assignment avoids the allocation.
- Example:
  ```js
  const dpr = devicePixelRatio;
  for (const m of markers) { ctx.setTransform(dpr, 0, 0, dpr, m.x * dpr, m.y * dpr); ctx.fill(markerPath); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ```
- Avoid/caveats: `save()` is still the correct tool for clip regions, which `setTransform` does not undo.
- Status: `setTransform`/`resetTransform` universal (resetTransform: Chrome 31, Firefox 36, Safari 10.1).
- Sources: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/canvas/canvas2d/canvas_2d_recorder_context.cc ; https://html.spec.whatwg.org/multipage/canvas.html (drawing state contents)

### Snap geometry to device pixels, with a half-pixel offset for odd-width lines
- Layer: canvas2d
- Stage: raster
- Metrics: FPS/smoothness (visual quality)
- When: animation/render-loop
- Impact: medium, because fractional coordinates blur 1px grid lines, tick marks, and blitted sprites; the speed gain is small on GPU canvases.
- Do: Round positions in device pixels, not CSS pixels. For a line whose device-pixel width is odd, place it at pixel center (`n + 0.5`). Round `drawImage` destination coordinates to integers.
- Why: Canvas coordinates name pixel edges. A 1-unit line at an integer x covers half of two pixels and renders as a 2-pixel gray line (MDN). Non-integer `drawImage` positions force anti-aliased resampling (MDN, web.dev).
- Example:
  ```js
  // crisp 1-device-pixel vertical line on a dpr-scaled context
  const dpr = devicePixelRatio;
  const xDev = Math.round(xCss * dpr) + 0.5;           // center of a device pixel
  ctx.setTransform(1, 0, 0, 1, 0, 0);                   // draw in device space
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(xDev, 0); ctx.lineTo(xDev, canvas.height); ctx.stroke();
  ```
- Avoid/caveats: web.dev (2011) says the performance part "should no longer matter" once canvas is GPU-accelerated; treat this as a crispness rule first. Do not round smooth animation paths (visible jitter).
- Status: Core Canvas 2D.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Drawing_shapes ; https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Applying_styles_and_colors ; https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas ; https://web.dev/articles/canvas-performance

### Reuse `Path2D` objects for static shapes and for hit testing
- Layer: canvas2d
- Stage: script-run, raster
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, interaction
- Impact: medium, because rebuilding marker/annotation paths every frame repeats many binding calls.
- Do: Build marker glyphs, annotation shapes, and icons once as `Path2D` (optionally from an SVG path string). Draw them with `ctx.fill(path)`/`ctx.stroke(path)` under a transform. Hit-test annotations with `ctx.isPointInPath(path, x, y)` / `isPointInStroke(path, x, y)`.
- Why: MDN says `Path2D` lets you "cache or record these drawing commands" and replay them, to simplify code and improve performance. `isPointInPath` with a stored path avoids re-tracing geometry on every pointer move.
- Example:
  ```js
  const triangleUp = new Path2D('M0 -5 L5 4 L-5 4 Z');   // built once
  for (const s of signals) { ctx.setTransform(dpr, 0, 0, dpr, s.x * dpr, s.y * dpr); ctx.fill(triangleUp); }
  ```
- Avoid/caveats: Speed-up figures for Path2D (for example "40-60% FPS") come only from blogs; measure. A `Path2D` whose points change each frame gives no benefit; rebuild only when data changes.
- Status: Path2D Baseline widely available since 2016 (MDN); `addPath` Chrome 68, Firefox 34, Safari 9; path argument to `isPointInPath` Chrome 36, Firefox 31, Safari 7.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Path2D ; https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Drawing_shapes ; https://reintech.io/blog/optimizing-canvas-performance-large-scale-apps (blog, search snippet only)

### Keep `shadowBlur` and `ctx.filter` out of per-frame drawing
- Layer: canvas2d
- Stage: raster
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because blur is a multi-pass image filter over the drawn area.
- Do: Do not use `shadowBlur` or `filter` on items redrawn every frame (tooltips, crosshair labels). If a glow or shadow is needed, pre-render it once into a cached canvas/ImageBitmap and blit it, or draw it in the WebGL shader.
- Why: MDN and web.dev both list `shadowBlur` as a thing to avoid; blur operations are expensive in any graphics stack.
- Avoid/caveats: `ctx.filter` is not shipped in Safari (flag only), so do not depend on it for appearance anyway.
- Status: `shadowBlur` universal. `filter`: Chrome 52, Firefox 49, Safari 18 behind a flag (BCD 2026-09).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas ; https://web.dev/articles/canvas-performance ; BCD api.CanvasRenderingContext2D.filter

### Pre-render repeated sprites into snug caches; do not scale in `drawImage`
- Layer: canvas2d
- Stage: raster, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, because re-drawing complex vector icons or text each frame costs more than one blit.
- Do: Rasterize repeated items (price-tag backgrounds, icons, static label text) once into an OffscreenCanvas sized tightly to the content at device resolution, then `drawImage` it 1:1. Cache one version per needed size instead of scaling at draw time.
- Why: web.dev shows pre-rendering is a large win for expensive operations such as text, but a "loose" cache canvas loses the gain because copy cost grows with source size. MDN: cache sizes up front instead of scaling in `drawImage`.
- Avoid/caveats: Each cache costs width × height × 4 bytes; invalidate on DPR, theme, or font change.
- Status: Core Canvas 2D; OffscreenCanvas Baseline widely available (2025-09).
- Sources: https://web.dev/articles/canvas-performance ; https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas

### Split layers by update rate; put static backgrounds in CSS
- Layer: canvas2d, css
- Stage: raster, composite
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, because redrawing a static grid under a 60 Hz crosshair wastes raster time.
- Do: Stack absolutely positioned canvases: static/slow layer (grid, watermark), data layer (WebGL chart), fast overlay (crosshair, hover tooltip). Redraw each only when its own inputs change. Put static images in a CSS background behind the canvas.
- Why: Clearing and redrawing the foreground never touches the background; the GPU compositor blends the layers (web.dev, MDN).
- Example:
  ```html
  <div class="chart" style="position:relative">
    <canvas class="gl"      style="position:absolute;inset:0"></canvas>
    <canvas class="overlay" style="position:absolute;inset:0;pointer-events:none"></canvas>
  </div>
  ```
- Avoid/caveats: Every full-size layer costs a full backing store (w × h × dpr² × 4 bytes) and a composited layer; do not add layers that change at the same rate. Safari 27 beta fixed a case where a 2D canvas forced an unnecessary compositing layer.
- Status: Core; all browsers.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas ; https://web.dev/articles/canvas-performance ; https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/

### Redraw only the dirty region of an overlay
- Layer: canvas2d
- Stage: raster
- Metrics: FPS/smoothness, INP
- When: interaction
- Impact: medium, because a full-canvas clear/redraw at DPR 2-3 touches millions of pixels per pointer move.
- Do: Track the bounding boxes drawn last frame (crosshair lines, cursor label) and clear/redraw only those rectangles.
- Why: Drawing less is cheaper; web.dev calls this "redraw regions".
- Example:
  ```js
  ctx.clearRect(prev.x - 1, 0, 3, h); ctx.clearRect(0, prev.y - 1, w, 3); // old crosshair only
  ```
- Avoid/caveats: Pad the rectangle for anti-aliasing and line width; if more than roughly half the canvas is dirty, a full clear is simpler.
- Status: Core.
- Sources: https://web.dev/articles/canvas-performance ; https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas

### Coalesce overlay redraws into one `requestAnimationFrame` per frame
- Layer: js, canvas2d
- Stage: main-thread-task, paint
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: high, because pointer events can arrive several times per frame and each synchronous redraw extends the event handler.
- Do: In `pointermove`, store the latest position and schedule at most one rAF; draw in the rAF callback.
- Why: rAF runs once before each frame and pauses in background tabs (web.dev, MDN); drawing inside input handlers adds to input delay and presentation delay.
- Example:
  ```js
  let pending = false, last;
  el.addEventListener('pointermove', (e) => {
    last = e;
    if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; drawCrosshair(last); }); }
  });
  ```
- Avoid/caveats: For drawing tools that need every sample, read `e.getCoalescedEvents()` inside the rAF instead of dropping points.
- Status: Universal.
- Sources: https://web.dev/articles/canvas-performance ; https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas

### Clear with `clearRect` or `reset()`, never by reassigning `width`
- Layer: canvas2d
- Stage: gc-memory, raster
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, because a width assignment is a full bitmap resize, not a clear.
- Do: Use `ctx.clearRect(0, 0, w, h)` (with an identity transform) per frame. Use `ctx.reset()` when you also want all state back to defaults.
- Why: The spec runs "set bitmap dimensions" on every width/height set (even to the same value): it resets the context and resizes the output bitmap. `reset()` clears the bitmap, paths, and state stack without resizing. The old `canvas.width = canvas.width` trick came from 2011-era Chrome (web.dev).
- Avoid/caveats: `clearRect` respects the current transform and clip; reset the transform first.
- Status: `reset()`: Chrome 99, Firefox 113, Safari 17.2; Baseline widely available since 2026-06-11 (webstatus `canvas-reset`).
- Sources: https://html.spec.whatwg.org/multipage/canvas.html ; https://developer.chrome.com/blog/canvas2d ; https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/reset ; https://web.dev/articles/canvas-performance

### Hit-test geometrically instead of reading pixels
- Layer: canvas2d
- Stage: gpu-upload (readback), main-thread-task
- Metrics: INP
- When: interaction
- Impact: high, because `getImageData` on a GPU canvas flushes queued drawing and does a synchronous GPU readback.
- Do: Hit-test annotations with math or `isPointInPath`/`isPointInStroke` on stored `Path2D`s. If you must use a color-ID pick canvas, make it a separate small `willReadFrequently: true` canvas and read a 1×1 rectangle.
- Why: Chromium's `getImageData` calls `FinalizeFrame()` to draw recorded commands, then snapshots and reads back the bitmap; the spec says readback is the "major exception" where GPU canvases are slower. Some privacy modes add random noise to `getImageData` output (MDN), which breaks exact color-ID matching.
- Avoid/caveats: Reading back a WebGL canvas has the same stall; see the WebGL agent's notes on async `readPixels`.
- Status: Core; noise behavior varies by browser privacy settings.
- Sources: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/canvas/canvas2d/base_rendering_context_2d.cc ; https://html.spec.whatwg.org/multipage/canvas.html ; https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData

---

## C. Text on canvas: fonts, measuring, atlases

### Set `ctx.font` from a small fixed set of strings, and only when it changes
- Layer: canvas2d
- Stage: style, script-run
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: medium, because each new font string is CSS-parsed and resolved, and on a DOM canvas each set also updates style.
- Do: Define font strings as constants (for example `AXIS_FONT = '11px Inter, sans-serif'`), group labels by font, and skip the assignment when the current font already matches. Use absolute `px` sizes.
- Why: The spec parses `font` as a CSS `font` value; relative units (`em`, `%`, `larger`) resolve against the canvas element's computed style. Chromium keeps an LRU of parsed font strings (soft max 50, hard max 250; 5/20 on low-end devices; 1 when the page is hidden) and early-returns when the same string is set again.
- Avoid/caveats: A canvas resize resets the context state, including `font`, to `10px sans-serif`; if you cache "current font" in JS to skip sets, invalidate that cache on resize or `reset()`.
- Status: Core; cache sizes are Chromium `main` as of 2026-09.
- Sources: https://html.spec.whatwg.org/multipage/canvas.html ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/html/canvas/canvas_font_cache.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/canvas/canvas2d/base_rendering_context_2d.cc

### Do not interleave DOM style writes with canvas text calls; rasterize text on OffscreenCanvas
- Layer: canvas2d, js
- Stage: style, main-thread-task
- Metrics: INP, TBT
- When: animation/render-loop, interaction
- Impact: medium, because on a DOM `<canvas>` every `font` set, `fillText`, `strokeText`, and `measureText` first brings style up to date for that canvas.
- Do: Run all canvas text work before (or after) DOM writes in a frame, not between them. For label/atlas rasterization, use an `OffscreenCanvas` context, which has no element and no style dependency.
- Why: Chromium calls `UpdateStyleAndLayoutTreeForElement(canvas)` in `setFont` (via `WillSetFont`), in the text draw path, and in `measureText`. If a DOM write dirtied style, the next text call forces a synchronous style recalc (a "style thrash" similar to layout thrash). OffscreenCanvas contexts resolve fonts against a default style.
- Example:
  ```js
  // before: tooltip.className = ...; ctx.fillText(...); legend.style.width = ...; ctx.measureText(...)
  // after: all canvas text first, DOM writes last (or text on an OffscreenCanvas)
  const labelCtx = new OffscreenCanvas(1024, 256).getContext('2d', { willReadFrequently: false });
  ```
- Avoid/caveats: This is Chromium behavior verified in source; other engines were not checked. A detached `document.createElement('canvas')` still belongs to the document and still pays this cost.
- Status: OffscreenCanvas 2D Baseline widely available (2025-09).
- Sources: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/canvas/canvas2d/canvas_rendering_context_2d.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/canvas/canvas2d/base_rendering_context_2d.cc

### Cache `measureText` results; rebuild caches when fonts load or DPR changes
- Layer: canvas2d, js
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, long-lived session
- Impact: high, because axis layout measures many labels per frame and each call shapes text and allocates a `TextMetrics` object.
- Do: Keep a `Map` keyed by `font + '\u0000' + text` (and letterSpacing if used) storing width and ascent/descent. For numeric labels, measure each glyph of `0-9 . , - + %` once and sum widths (tabular digits make this exact). Clear the cache on `document.fonts` `loadingdone`, on DPR change, and on theme font change.
- Why: Chromium's `measureText` updates style (DOM canvas), resolves the font, and returns a new garbage-collected `TextMetrics`. The spec says a font used before it loads is treated as unknown and falls back, so widths measured before load are wrong and must be discarded.
- Example:
  ```js
  const widths = new Map();
  function textWidth(ctx, font, s) {
    const k = font + '\u0000' + s;
    let w = widths.get(k);
    if (w === undefined) { if (ctx.font !== font) ctx.font = font; w = ctx.measureText(s).width; widths.set(k, w); }
    return w;
  }
  document.fonts.addEventListener('loadingdone', () => widths.clear());
  await document.fonts.load(AXIS_FONT); // before first layout
  ```
- Avoid/caveats: Bound the map (LRU) for free-text annotations. Glyph-sum widths ignore kerning; use them only for tabular numerals.
- Status: `measureText` universal; `fontBoundingBoxAscent/Descent`: Chrome 87, Firefox 116, Safari 11.1; Font Loading API Baseline widely available (2022-07).
- Sources: https://html.spec.whatwg.org/multipage/canvas.html ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/canvas/canvas2d/base_rendering_context_2d.cc ; https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/measureText

### Load web fonts inside the worker before rasterizing text on an OffscreenCanvas there
- Layer: canvas2d
- Stage: network, script-run
- Metrics: FPS/smoothness (correctness of first frames)
- When: load
- Impact: medium, because a worker does not see `document.fonts`; text silently falls back to a default font and all cached metrics are wrong.
- Do: In the worker, create `new FontFace(name, url)`, `self.fonts.add(face)`, and wait for `self.fonts.ready` (or `face.load()`) before the first `fillText`/`measureText`.
- Why: The spec resolves fonts for an OffscreenCanvas in a worker against the `WorkerGlobalScope`; its example notes the font "is only loaded inside the worker".
- Example:
  ```js
  // worker.js
  const face = new FontFace('Inter', 'url(/fonts/inter.woff2)');
  self.fonts.add(face); await face.load();
  ctx.font = '11px Inter'; // now real metrics
  ```
- Avoid/caveats: The font is fetched again (HTTP cache usually helps). Before Safari 18.4, OffscreenCanvas 2D `font` was partial (font-weight not reflected back).
- Status: `WorkerGlobalScope.fonts`: Chrome 69, Firefox 105, Safari 15.
- Sources: https://html.spec.whatwg.org/multipage/canvas.html ; BCD api.WorkerGlobalScope.fonts ; BCD api.OffscreenCanvasRenderingContext2D.font

### Choose the label technique by label count and update rate
- Layer: canvas2d, gpu, html
- Stage: layout, raster, gpu-upload, gpu-draw
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop
- Impact: high, because the wrong technique multiplies per-frame text cost across every chart pane.
- Do: Few, rarely changing, interactive labels (legend, tooltip): DOM elements positioned with `transform`, pooled and reused. Tens of labels changing with pan/zoom: one 2D overlay canvas redrawn per frame. Hundreds of labels or many charts: WebGL text from a glyph atlas (SciChart.js "native text", default `true` in v4).
- Why: DOM text is accessible and styled but each change can trigger style/layout; webgl2fundamentals pools DOM nodes and hides unused ones instead of removing them. SciChart docs say native WebGL text gives "a large performance benefit in multi-chart dashboards".
- Avoid/caveats: SciChart native text limits: no `fontStyle`/`fontWeight`, only Arial by default, custom fonts via `.ttf` on the server or `registerFont()`. WebGL text has no accessibility; mirror critical values in DOM/ARIA.
- Status: Library/technique choice; SciChart.js v4 docs.
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-text-html.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-text-canvas2d.html ; https://www.scichart.com/documentation/js/v4/2d-charts/axis-api/axis-labels/performance-considerations-native-text-axis-abels/ ; https://www.scichart.com/documentation/js/v4/2d-charts/performance-tips/performance-tips-and-tricks/

### Use a glyph atlas for small closed character sets; per-string textures (with LRU) for free text
- Layer: gpu, canvas2d
- Stage: gpu-upload, gpu-draw, raster
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: high, because re-rasterizing and re-uploading a texture per label per frame is the most common text bottleneck.
- Do: For tick labels and prices (digits, sign, separators, a few unit letters), rasterize each glyph once into an atlas and draw all labels in one draw call with per-glyph quads. For arbitrary annotation text, rasterize whole strings into atlas slots keyed by text+style, evict least-recently-used slots, and reuse vertex buffers.
- Why: webgl2fundamentals: per-string textures are what browsers do for static content, but "re-generating the textures and re-uploading them" is slow when text changes often; a glyph atlas lets one texture serve many strings. Atlases also enable batching (MDN WebGL: texture atlasing merges draw calls). Browsers keep glyph caches as fixed-size LRU atlases.
- Example:
  ```js
  // per frame: only layout quads; no canvas or texture work unless a new glyph appears
  for (const lbl of ticks) for (const ch of lbl.text) pushQuad(atlas.glyph(ch), lbl.x + penX, lbl.y);
  ```
- Avoid/caveats: Per-glyph placement loses kerning, ligatures, and complex-script shaping (Arabic, Indic); keep those in per-string rasterization. Reuse the same typed arrays for quads to avoid GC (webgl2fundamentals). SciChart exposes a shared label texture cache (`useSharedCache`, default false; keeps labels one minute across charts).
- Status: Technique; WebGL 1/2 everywhere.
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-text-texture.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-text-glyphs.html ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://www.scichart.com/documentation/js/v4/2d-charts/performance-tips/performance-tips-and-tricks/

### Use SDF glyphs when labels scale, rotate, or need halos
- Layer: gpu, canvas2d
- Stage: raster, gpu-upload, gpu-draw
- Metrics: FPS/smoothness, memory
- When: load, animation/render-loop
- Impact: medium, because one SDF atlas serves many sizes and rotations without re-rasterizing.
- Do: Generate signed-distance-field glyphs (for example TinySDF with `fontSize`, `buffer`, `radius`, `cutoff`) once per font, store them in the atlas, and threshold in the fragment shader. Generate on an OffscreenCanvas with `willReadFrequently: true` because each glyph is read back.
- Why: Mapbox renders glyph SDFs at one base size (24 pt) and scales them to `text-size`; SDF allows scaling, rotation, and cheap halos. TinySDF draws each glyph with Canvas 2D, reads it with `getImageData`, and runs a distance transform; its source uses `OffscreenCanvas` and `willReadFrequently: true`.
- Avoid/caveats: Plain SDF rounds sharp corners and small sizes lose hinting; MSDF fixes corners. SDF generation is CPU work per glyph; do it lazily or in a worker. For fixed-size axis text, a plain bitmap atlas at device resolution is sharper.
- Status: Technique; TinySDF is ESM-only.
- Sources: https://github.com/mapbox/tiny-sdf ; https://github.com/mapbox/tiny-sdf/blob/main/index.js ; https://github.com/mapbox/mapbox-gl-native/wiki/Text-Rendering

### Rasterize text at the device pixel ratio and place it on the device pixel grid; rebuild on DPR change
- Layer: canvas2d, gpu
- Stage: raster, gpu-upload, gpu-draw
- Metrics: FPS/smoothness (visual quality), memory
- When: load, long-lived session
- Impact: medium, because text rasterized at 1x and stretched looks blurry on Retina, and stale atlases stay blurry after zoom or monitor change.
- Do: Rasterize labels with `ctx.scale(dpr, dpr)` into a backing store of `ceil(w * dpr) × ceil(h * dpr)`. Position quads at integer device pixels and sample 1:1. Watch `matchMedia('(resolution: ' + dpr + 'dppx)')` and rebuild atlases and metric caches when it stops matching.
- Why: MDN: DPR changes with page zoom and when the window moves to another display; MDN shows `matchMedia` to detect it. MDN WebGL notes non-integer DPR (Windows scaling, zoom) causes moiré unless the canvas snaps to device pixels.
- Example:
  ```js
  function watchDpr(onChange) {
    const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => { onChange(devicePixelRatio); watchDpr(onChange); }, { once: true });
  }
  watchDpr(() => { atlas.rebuild(); widths.clear(); });
  ```
- Avoid/caveats: Atlas memory grows with dpr²; at DPR 3 a 2048² atlas fills faster. SciChart offers `DpiHelper.IsDpiScaleEnabled = false` to trade sharpness for 4x fewer pixels on Retina.
- Status: `devicePixelRatio` works in all engines (webstatus lists it "limited" because of sub-feature differences); `matchMedia` universal.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://www.scichart.com/documentation/js/v4/2d-charts/performance-tips/performance-tips-and-tricks/

---

## D. From canvas/image to GPU texture

### Keep canvas-to-texture uploads premultiplied from end to end
- Layer: gpu, canvas2d
- Stage: gpu-upload, gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: high in Firefox, because un-premultiplying a canvas upload runs on the CPU there; medium elsewhere (quality).
- Do: Before `texImage2D`/`texSubImage2D` from a 2D canvas, set `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)` and blend with `gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)`. In WebGPU, pass `premultipliedAlpha: true` in `copyExternalImageToTexture`'s destination.
- Why: Canvas 2D only produces premultiplied pixels; un-premultiplying is lossy and gives dark fringes (webgl2fundamentals). WebGPU says conversion "might not be necessary" when `premultipliedAlpha` matches the source. Firefox bug 1246410 (still NEW) reports canvas→WebGL uploads about 100x slower than Chrome because un-premultiplication moved to the CPU.
- Example:
  ```js
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, labelCanvas);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  // WebGPU
  device.queue.copyExternalImageToTexture({ source: labelCanvas }, { texture, premultipliedAlpha: true }, [w, h]);
  ```
- Avoid/caveats: Tint in the shader by multiplying RGB and A together (`texel * color` with premultiplied `color`). The Firefox issue is from a bug report; verify with a profile.
- Status: WebGL universal; WebGPU `copyExternalImageToTexture` ships where WebGPU ships (webstatus `webgpu`: limited).
- Sources: https://webgl2fundamentals.org/webgl/lessons/webgl-text-texture.html ; https://www.w3.org/TR/webgpu/ ; https://bugzilla.mozilla.org/show_bug.cgi?id=1246410

### Upload only the dirty sub-rectangle into a preallocated atlas texture
- Layer: gpu
- Stage: gpu-upload, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: high, because re-uploading a whole 2048² atlas for one new glyph moves 16 MB.
- Do: Allocate atlas pages once with `texStorage2D` (WebGL 2). When new glyphs are rasterized into the staging canvas, upload only that region with `texSubImage2D(target, 0, dstX, dstY, w, h, format, type, canvas)` after setting `UNPACK_SKIP_PIXELS`/`UNPACK_SKIP_ROWS` to the source origin. Pad glyph slots by 1-2 px to stop filtering bleed.
- Why: WebGL 2 spec: for DOM sources, `UNPACK_SKIP_PIXELS`/`UNPACK_SKIP_ROWS` pick the sub-rectangle origin and width/height its size. MDN: prefer `texStorage` + `texSubImage` because `texImage*` lets drivers defer allocation and some allocate a full mip chain ("+30% memory").
- Example:
  ```js
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, dirty.x);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, dirty.y);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, dirty.x, dirty.y, dirty.w, dirty.h, gl.RGBA, gl.UNSIGNED_BYTE, stagingCanvas);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  ```
- Avoid/caveats: WebGL 1 has no sub-rect selection for DOM sources; there, rasterize new glyphs into a small canvas and upload it at the offset. Text atlases usually should not use mipmaps.
- Status: `texStorage2D`: Chrome 56, Firefox 51, Safari 15 (WebGL 2 Baseline widely available 2024-03).
- Sources: https://registry.khronos.org/webgl/specs/latest/2.0/ ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices

### Do texture uploads at the start of the frame, before draw calls
- Layer: gpu
- Stage: gpu-upload, gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because an upload from a DOM source between draws inserts hidden program/framebuffer switches.
- Do: Collect all atlas/label uploads for the frame and issue them before the first `useProgram`/draw of the frame.
- Why: MDN: uploads from DOM elements often run an internal pass (y-flip, color transform, alpha (un)premultiply) with its own program, which causes pipeline flushes; doing uploads before drawing avoids extra flushes.
- Avoid/caveats: None beyond keeping one upload queue per frame.
- Status: Guidance applies to all WebGL implementations.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices

### Keep upload sources GPU-backed and 2D-targeted so Chrome can copy GPU-to-GPU
- Layer: gpu, canvas2d
- Stage: gpu-upload
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium, because a CPU-backed source forces a CPU→GPU pixel transfer per upload.
- Do: Rasterize label content on a canvas created with `willReadFrequently: false` (GPU-backed) or into an ImageBitmap from a GPU canvas, and upload into `TEXTURE_2D` with `texImage2D`/`texSubImage2D`. Avoid uploading canvases into 3D textures or 2D-array layers in hot paths.
- Why: Chromium's `CanUseTexImageViaGPU` allows the GPU copy only for texture-backed sources and only for `texImage2D`/`texSubImage2D` (not 3D/array targets), with a few format exclusions (half-float OES, float on Android, `RED_INTEGER`). Flip and premultiply are handled in the GPU copy. Otherwise the pixels are read on the CPU and uploaded.
- Avoid/caveats: This conflicts with `willReadFrequently: true` (A1): if you both read pixels and upload, split into two canvases. Chromium-only behavior.
- Status: Chromium `main` 2026-09.
- Sources: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc

### Set flip, premultiply, and color conversion when creating an ImageBitmap, not with `pixelStorei`
- Layer: gpu, js
- Stage: gpu-upload
- Metrics: FPS/smoothness
- When: load
- Impact: medium, because WebGL ignores the unpack flags for ImageBitmap sources, so wrong flags cause a second conversion or wrong output.
- Do: Call `createImageBitmap(src, { imageOrientation: 'flipY', premultiplyAlpha: 'premultiply' | 'none', colorSpaceConversion: 'none' })` to match what the shader expects, then upload with default `pixelStorei` state.
- Why: WebGL spec: for an ImageBitmap, `UNPACK_FLIP_Y_WEBGL`, `UNPACK_PREMULTIPLY_ALPHA_WEBGL`, and `UNPACK_COLORSPACE_CONVERSION_WEBGL` "will be ignored"; use ImageBitmapOptions instead (color space conversion to `unpackColorSpace` still applies late).
- Avoid/caveats: `imageOrientation: 'none'` was renamed to `'from-image'`; the spec reserves `'none'` for a future meaning, so do not pass it.
- Status: `premultiplyAlpha` option: Chrome 52, Firefox 93, Safari 17; `from-image`: Chrome 112, Firefox 111, Safari 16.
- Sources: https://registry.khronos.org/webgl/specs/latest/1.0/ ; https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html ; https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap

### Keep atlas pages at 4096×4096 or smaller
- Layer: gpu
- Stage: gpu-upload, gc-memory
- Metrics: memory
- When: load
- Impact: low, because it only matters on devices near the limit, but a too-large page fails outright.
- Do: Cap each atlas page at 4096² (2048² is usually enough for text at DPR ≤ 3) and add pages instead of growing one texture. Check `gl.getParameter(gl.MAX_TEXTURE_SIZE)` once at startup.
- Why: web3dsurvey reports 4096 supported by 100% of WebGL 2 devices and 16384 by about 86%. A 4096² RGBA8 page is 64 MB.
- Avoid/caveats: Adding pages means extra texture binds or a texture array; group labels by page.
- Status: Survey data (no date range shown).
- Sources: https://web3dsurvey.com/webgl2/parameters/MAX_TEXTURE_SIZE

---

## E. Image decoding and ImageBitmap

### Decode images for canvas/WebGL with `createImageBitmap(blob)`, not from an `<img>`
- Layer: js
- Stage: main-thread-task, network
- Metrics: INP, TBT, FPS/smoothness
- When: load, interaction
- Impact: high for large images (logos, backgrounds, symbol icons sheets), because decoding is CPU-heavy.
- Do: `fetch` the image, get a `Blob`, and call `createImageBitmap(blob, options)`; or do the whole thing in a worker and transfer the bitmap. Draw/upload the resulting ImageBitmap.
- Why: In Chromium, a Blob source is decoded on a worker-pool thread (`worker_pool::PostTask(... DecodeImageOnDecoderThread ...)`), but an `HTMLImageElement` source is decoded synchronously inside the ImageBitmap constructor on the calling thread, even though the API returns a promise. Chrome's 2016 post already warned that calling it on the main thread decodes there, and recommended workers. The spec defines ImageBitmap as paintable "without undue latency".
- Example:
  ```js
  const blob = await (await fetch('/img/watermark.png')).blob();
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  bmp.close();
  ```
- Avoid/caveats: SVG sources are rasterized separately (Chromium uses an async path for SVG). Firefox/Safari threading was not verified.
- Status: `createImageBitmap` core since Safari 15 (MDN: Baseline widely since 2021-09); webstatus counts the full feature (with options and SVG sources) as Baseline since 2023-12-11 and widely available since 2026-06-11.
- Sources: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/canvas/imagebitmap/image_bitmap_factories.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/imagebitmap/image_bitmap.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/html/canvas/image_element_base.cc ; https://developer.chrome.com/blog/createimagebitmap-in-chrome-50/ ; https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html

### Ask `createImageBitmap` for the final size and format
- Layer: js, gpu
- Stage: gc-memory, gpu-upload
- Metrics: memory, FPS/smoothness
- When: load
- Impact: medium, because a 4000×3000 image kept at full size costs 48 MB and a full-size upload.
- Do: Pass `resizeWidth`/`resizeHeight` (one is enough; the other keeps aspect ratio) and `resizeQuality` (`'low'` default, `'medium'`, `'high'`, `'pixelated'`), plus `premultiplyAlpha` and `colorSpaceConversion` that match the consumer, so no later conversion pass is needed.
- Why: The spec scales the bitmap to the requested output size using `resizeQuality` as a hint, and applies premultiply/color conversion at creation. Chromium maps `premultiplyAlpha`/`colorSpaceConversion` straight into decoder options for Blob sources.
- Avoid/caveats: In Chromium the full image is still decoded before resizing, so resize saves memory and upload, not decode time. `resizeQuality` arrived late in Firefox (149).
- Status: `resizeWidth/Height`: Chrome 54, Firefox 98, Safari 15; `resizeQuality`: Chrome 54, Firefox 149, Safari 15.
- Sources: https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html ; https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap ; BCD api.createImageBitmap

### Call `close()` on ImageBitmaps you no longer need
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium, because bitmaps hold decoded (often GPU) memory until GC runs.
- Do: After uploading to a texture or drawing into a cache, call `bitmap.close()`. Also close bitmaps you replace (for example on theme change).
- Why: The spec's `close()` sets the bitmap detached and unsets its bitmap data; MDN says it disposes all graphical resources. Waiting for GC delays that release.
- Avoid/caveats: After `close()`, width/height read 0 and using it throws; do not close a bitmap that another consumer still needs. A bitmap passed to `transferFromImageBitmap` is transferred, not closed by you.
- Status: Chrome 52, Firefox 46, Safari 15.
- Sources: https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html ; https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap/close

### Await `img.decode()` before inserting overlay images; use `decoding="async"` only for non-critical images
- Layer: html, js
- Stage: paint, main-thread-task
- Metrics: INP, CLS, LCP
- When: load, interaction
- Impact: low, because it mainly avoids a blank or late frame for JS-inserted images.
- Do: For images inserted by script (symbol logos in tooltips, news thumbnails), set `src`, `await img.decode()`, then append or swap. Use `decoding="async"` on large, non-LCP `<img>` in markup.
- Why: The spec: `decode()` decodes in parallel and resolves when decoding is done; the UA "should" keep the decoded data available at least until the next rendering update. Barry Pollard's measurements (blog) show `decoding` has small effects and `decode()` is the better tool for JS-inserted images.
- Avoid/caveats: `decode()` does not keep pixels decoded for later canvas draws (low-memory eviction is allowed); for canvas/WebGL use ImageBitmap. A changed `src` rejects the promise with `EncodingError`.
- Status: `decode()`: Baseline widely available since 2020-01. `decoding` attribute: Chrome 65, Firefox 63, Safari 11.1.
- Sources: https://html.spec.whatwg.org/multipage/embedded-content.html ; https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode ; https://www.tunetheweb.com/blog/what-does-the-image-decoding-attribute-actually-do/ (blog)

### Consider WebCodecs `ImageDecoder` in a worker for animated or frame-by-frame images
- Layer: js
- Stage: main-thread-task
- Metrics: INP, FPS/smoothness
- When: load
- Impact: low for charts, because few chart assets are animated.
- Do: When you need individual frames of GIF/WebP/AVIF animations or explicit decode control, use `ImageDecoder` in a worker, then draw `VideoFrame`s or convert to ImageBitmap. Feature-detect and fall back to `createImageBitmap(blob)`.
- Why: It exposes decoding without an `<img>` and works in workers.
- Status: Chrome 94, Firefox 133, Safari not shipped (Technology Preview only) per BCD 2026-09.
- Sources: BCD api.ImageDecoder (https://bcd.developer.mozilla.org/bcd/api/v0/current/api.ImageDecoder.json)

---

## F. OffscreenCanvas and workers

### Move heavy canvas rendering to a worker with `transferControlToOffscreen()`
- Layer: canvas2d, js
- Stage: main-thread-task, paint
- Metrics: INP, TBT, FPS/smoothness
- When: load, animation/render-loop
- Impact: high, because it removes canvas rendering from the thread that handles input.
- Do: Call `canvas.transferControlToOffscreen()` once (before any `getContext`), post it to a worker with a transfer list, and render there with the worker's `requestAnimationFrame`. Forward pointer/resize/DPR data via `postMessage`; set `offscreen.width/height` inside the worker.
- Why: web.dev: a busy main thread no longer stops the worker's animation, and main-thread work stays responsive. The spec lets UAs push worker frames to the display without waiting for the busy window event loop.
- Example:
  ```js
  // main
  const off = canvas.transferControlToOffscreen();
  worker.postMessage({ type: 'init', canvas: off, dpr: devicePixelRatio }, [off]);
  new ResizeObserver(([e]) => worker.postMessage({ type: 'resize', w: e.contentRect.width, h: e.contentRect.height, dpr: devicePixelRatio })).observe(canvas);
  // worker
  onmessage = ({ data }) => { if (data.type === 'resize') { off.width = Math.round(data.w * data.dpr); off.height = Math.round(data.h * data.dpr); } };
  ```
- Avoid/caveats: After transfer, the element's size cannot change from the main thread and `getContext` on it throws. No DOM, no events, no `document.fonts` in the worker. Libraries that read `canvas.style` need stubs (web.dev Three.js note). The old `commit()` is deprecated; use worker rAF. Whether SciChart.js can run in a worker was not checked.
- Status: OffscreenCanvas Baseline widely available since 2025-09-27 (2D from Safari 16.4, WebGL from Safari 17); worker rAF Baseline widely available since 2025-09-27.
- Sources: https://web.dev/articles/offscreen-canvas ; https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas ; https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/transferControlToOffscreen ; https://html.spec.whatwg.org/multipage/canvas.html

### Use `OffscreenCanvas` (not a detached `<canvas>`) for caches, atlases, and scratch work
- Layer: canvas2d
- Stage: style, main-thread-task
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: medium, because a DOM canvas couples text work to document style and carries element overhead.
- Do: Create cache/staging surfaces with `new OffscreenCanvas(w, h)` on the main thread or in workers.
- Why: web.dev: OffscreenCanvas is decoupled from the DOM, so there is "no synchronization between the two". In Chromium, text calls on a DOM canvas update document style first (C2); OffscreenCanvas contexts do not.
- Avoid/caveats: `OffscreenCanvas` cannot be put in the DOM; display through `drawImage`, a texture upload, or `bitmaprenderer`.
- Status: Baseline widely available (2025-09).
- Sources: https://web.dev/articles/offscreen-canvas ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/canvas/canvas2d/base_rendering_context_2d.cc

### Show worker frames with `transferToImageBitmap()` + `bitmaprenderer`, and remember it clears the source
- Layer: canvas2d
- Stage: composite, gc-memory
- Metrics: memory, FPS/smoothness
- When: animation/render-loop
- Impact: medium, because transfer semantics avoid copies and a second decoded copy in memory.
- Do: For one-shot frames or thumbnails produced off-DOM, call `offscreen.transferToImageBitmap()` and pass it (transfer list) to a canvas with `getContext('bitmaprenderer')`, then `transferFromImageBitmap(bitmap)`.
- Why: The spec calls ImageBitmapRenderingContext a low-overhead, transfer-based display path that avoids the intermediate compositing of `drawImage` and avoids holding two decoded copies of an image. `transferToImageBitmap()` hands over the current bitmap and gives the OffscreenCanvas a new blank bitmap.
- Avoid/caveats: Because the source is cleared, do not use `transferToImageBitmap()` on an incrementally built atlas; use `createImageBitmap(offscreen)` (copy) there.
- Status: ImageBitmapRenderingContext Baseline widely available (2022-07); `transferToImageBitmap` Chrome 69, Firefox 105, Safari 16.4.
- Sources: https://html.spec.whatwg.org/multipage/canvas.html ; https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas ; https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmapRenderingContext

### Transfer ImageBitmaps and OffscreenCanvases between threads; do not copy pixels
- Layer: js
- Stage: main-thread-task, gc-memory
- Metrics: memory, INP
- When: animation/render-loop
- Impact: medium, because structured-cloning pixel arrays copies megabytes per message.
- Do: Put the bitmap/canvas in the `postMessage` transfer list (`postMessage(msg, [bitmap])`). Send `ImageBitmap`, not `ImageData`, for rendered label pages.
- Why: ImageBitmap and OffscreenCanvas are Transferable per spec; Chrome's createImageBitmap article transfers bitmaps back from the decode worker the same way.
- Avoid/caveats: The sender loses access after transfer.
- Status: Universal where ImageBitmap/OffscreenCanvas exist.
- Sources: https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html ; https://developer.chrome.com/blog/createimagebitmap-in-chrome-50/

---

## G. Size, memory, and export

### Set `canvas.width/height` only when the integer backing size changes, then re-apply state
- Layer: canvas2d, js
- Stage: gc-memory, raster, layout
- Metrics: FPS/smoothness, memory, INP
- When: interaction, long-lived session
- Impact: high, because each assignment clears the canvas, resets all context state, and reallocates the bitmap (and GPU memory).
- Do: Compute the target size in device pixels, compare it with the current `width/height`, and assign only if different. After a real resize, re-apply `setTransform(dpr, …)`, `font`, and styles, invalidate JS state caches, and redraw in the same frame. Read sizes from `ResizeObserver`, not `getBoundingClientRect()` in the render loop.
- Why: The spec runs "set bitmap dimensions" whenever the attributes are set, "or redundantly set to the value they already have"; that resets the context to defaults and resizes the bitmap. ResizeObserver callbacks run after layout and before paint, so resizing and drawing there avoids one stretched frame (web.dev).
- Example:
  ```js
  function resizeTo(cssW, cssH, dpr) {
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w; canvas.height = h;           // clears + resets state
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); lastFont = null; // re-apply, invalidate caches
    return true;
  }
  ```
- Avoid/caveats: During a continuous drag-resize, one resize per frame is the ceiling; ResizeObserver already coalesces per frame.
- Status: Core; ResizeObserver Baseline widely available (2023-01).
- Sources: https://html.spec.whatwg.org/multipage/canvas.html ; https://web.dev/articles/device-pixel-content-box

### Size the backing store from `devicePixelContentBoxSize` where supported
- Layer: canvas2d, js
- Stage: layout, raster
- Metrics: FPS/smoothness (visual quality)
- When: load, interaction
- Impact: medium, because `round(cssWidth × dpr)` can be off by one device pixel and produce blur or moiré at fractional DPR.
- Do: Observe with `{ box: 'device-pixel-content-box' }` and use `entry.devicePixelContentBoxSize[0].inlineSize/blockSize`; fall back to `Math.round(contentRect.width * devicePixelRatio)` when absent.
- Why: The browser pixel-snaps elements; only this box reports the exact physical pixel count, so canvas pixels map 1:1 to screen pixels (web.dev; MDN WebGL best practices).
- Example:
  ```js
  const ro = new ResizeObserver(([e]) => {
    const s = e.devicePixelContentBoxSize?.[0];
    const w = s ? s.inlineSize : Math.round(e.contentRect.width * devicePixelRatio);
    const h = s ? s.blockSize  : Math.round(e.contentRect.height * devicePixelRatio);
    setBackingSize(w, h); // same guard as resizeTo(), but in device pixels
  });
  try { ro.observe(canvas, { box: 'device-pixel-content-box' }); } catch { ro.observe(canvas); }
  ```
- Avoid/caveats: Safari has not implemented it (BCD 2026-09); keep the fallback.
- Status: Chrome 84, Firefox 108, Safari no.
- Sources: https://web.dev/articles/device-pixel-content-box ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; BCD api.ResizeObserverEntry.devicePixelContentBoxSize

### Budget canvas memory and clamp sizes to per-browser limits
- Layer: canvas2d, gpu
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: high on iOS, because exceeding limits makes the canvas unusable without an exception.
- Do: Estimate bytes as `width × height × 4` per canvas (× 2 for `float16`; the UA may keep extra buffers). Keep the sum of all canvases, caches, and atlases under a budget scaled to window pixels (MDN's per-pixel VRAM budget). Clamp any single canvas to 4096 × 4096 area on iOS Safari; check `getContext` for `null`.
- Why: MDN: exceeding max dimensions or area makes drawing commands "not work". canvas-size test results: iOS Safari max area 4,096² (16.7 M px); Chrome desktop 16,384² area, 65,535 max side; Firefox 122+ 23,168² area, 32,767 max side. iOS Safari also has a total canvas memory cap (384 MB on iOS 15 per a blog) after which `getContext` returns `null`. The spec notes UAs may use extra bitmaps for double buffering.
- Example:
  ```js
  const MAX_AREA_IOS = 4096 * 4096;
  if (w * h > MAX_AREA_IOS) { const s = Math.sqrt(MAX_AREA_IOS / (w * h)); w = Math.floor(w * s); h = Math.floor(h * s); }
  ```
- Avoid/caveats: The iOS total-memory figure comes from a blog and forum reports and varies by device and iOS version; the canvas-size table is from a third-party library.
- Status: Limits are implementation-defined.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas ; https://github.com/jhildenbiddle/canvas-size (docs/index.md test results) ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit/ (blog)

### Release canvases explicitly when a chart or panel is destroyed
- Layer: canvas2d, js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium, because Safari keeps canvas backing stores until GC, and multi-chart layouts create and destroy many canvases.
- Do: On teardown, set `canvas.width = 0; canvas.height = 0` (or 1×1) for 2D canvases and OffscreenCanvases, `close()` ImageBitmaps, and drop references. For WebGL canvases use `WEBGL_lose_context` when truly done (MDN).
- Why: Shrinking the canvas frees its bitmap immediately instead of waiting for GC; the pqina blog shows this avoids Safari's "Total canvas memory use exceeds the maximum limit". MDN recommends deleting WebGL objects and losing contexts eagerly.
- Avoid/caveats: Do not do this for canvases you will show again soon; reallocation costs more than keeping them. Blog-sourced for the Safari part.
- Status: Core.
- Sources: https://pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit/ (blog) ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices

### Export charts with `toBlob`/`convertToBlob`, not `toDataURL`
- Layer: canvas2d
- Stage: main-thread-task, gc-memory
- Metrics: INP, memory
- When: interaction
- Impact: medium, because PNG encoding of a DPR-2 chart is large CPU work and a base64 string is about 33% larger than the bytes.
- Do: Use `canvas.toBlob(cb, 'image/png')` or `await offscreen.convertToBlob({ type: 'image/png' })` and `URL.createObjectURL(blob)` for downloads.
- Why: The spec copies the bitmap synchronously but encodes "in parallel" for `toBlob`, then queues the callback; `toDataURL` returns the encoded string synchronously.
- Avoid/caveats: The bitmap copy (readback) is still synchronous; export from the WebGL canvas right after a render (or with `preserveDrawingBuffer`), as covered by the WebGL notes.
- Status: `toBlob` universal; `convertToBlob` Chrome 69, Firefox 105, Safari 16.4 (WebP type Chrome/Firefox only).
- Sources: https://html.spec.whatwg.org/multipage/canvas.html ; BCD api.OffscreenCanvas.convertToBlob

---

## H. Experimental

### Do not depend on HTML-in-canvas yet; track it for accessible chart labels
- Layer: canvas2d, gpu, html
- Stage: paint, gpu-upload
- Metrics: FPS/smoothness, INP
- When: load
- Impact: low today, because it is an origin trial only.
- Do: Keep text on the paths above. Prototype `layoutsubtree` + `drawElementImage()` (2D), `texElementImage2D()` (WebGL), `copyElementImageToTexture()` (WebGPU) only behind feature detection and an origin-trial token.
- Why: The API draws live, styled, accessible DOM (legends, axes with rich text) into canvas or textures. Chrome's post warns that drawing runs in JavaScript in the `paint` event, so scrolling and animation cannot update independently of script.
- Avoid/caveats: Cross-origin content is blocked. API names changed during incubation (explainer mentions `drawable`, `texElementSubImage2D`, `drawElementImageToTexture`); read the current explainer before use.
- Status: Origin trial Chrome 148-150 (Chrome post updated 2026-05-19); flag `chrome://flags/#canvas-draw-element`; webstatus `canvas-html`: limited; no Firefox/Safari support.
- Sources: https://developer.chrome.com/blog/html-in-canvas-origin-trial ; https://github.com/WICG/html-in-canvas/blob/main/README.md ; https://api.webstatus.dev/v1/features/canvas-html

---

## Sources read
- https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext
- https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode
- https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/transferControlToOffscreen
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas
- https://developer.mozilla.org/en-US/docs/Web/API/Path2D
- https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/measureText
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
- https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmapRenderingContext
- https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/contextlost_event
- https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/reset
- https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap/close
- https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Applying_styles_and_colors
- https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Drawing_shapes
- https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Pixel_manipulation_with_canvas
- https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
- https://web.dev/articles/canvas-performance
- https://web.dev/articles/offscreen-canvas
- https://web.dev/articles/device-pixel-content-box
- https://developer.chrome.com/blog/desynchronized
- https://developer.chrome.com/blog/canvas2d
- https://developer.chrome.com/blog/createimagebitmap-in-chrome-50/
- https://developer.chrome.com/blog/taking-advantage-of-gpu-acceleration-in-the-2d-canvas
- https://developer.chrome.com/blog/html-in-canvas-origin-trial
- https://html.spec.whatwg.org/multipage/canvas.html
- https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html
- https://html.spec.whatwg.org/multipage/embedded-content.html
- https://registry.khronos.org/webgl/specs/latest/1.0/
- https://registry.khronos.org/webgl/specs/latest/2.0/
- https://www.w3.org/TR/webgpu/
- https://bcd.developer.mozilla.org/bcd/api/v0/current/{api.HTMLCanvasElement.getContext, api.OffscreenCanvas, api.HTMLCanvasElement.transferControlToOffscreen, api.createImageBitmap, api.HTMLImageElement.decode, api.CanvasRenderingContext2D, api.Path2D, api.HTMLCanvasElement.contextlost_event, api.ImageBitmap, api.ImageBitmapRenderingContext, api.ImageDecoder, api.ResizeObserverEntry.devicePixelContentBoxSize, api.HTMLImageElement.decoding, api.WorkerGlobalScope.fonts, api.OffscreenCanvasRenderingContext2D, api.OffscreenCanvasRenderingContext2D.font, api.TextMetrics, api.DedicatedWorkerGlobalScope.requestAnimationFrame, api.GPUQueue.copyExternalImageToTexture, api.WebGLRenderingContext.texSubImage2D, api.WebGL2RenderingContext.texStorage2D, api.CanvasRenderingContext2D.drawImage}.json (queried 2026-09-22/23, BCD 8.1.2)
- https://api.webstatus.dev/v1/features (full list, 2026-09-22) and https://api.webstatus.dev/v1/features/canvas-html
- Chromium source (main, read 2026-09-22): third_party/blink/renderer/modules/canvas/canvas2d/base_rendering_context_2d.cc, canvas_rendering_context_2d.cc, canvas_2d_recorder_context.cc, cached_color.h, base_rendering_context_2d.h; third_party/blink/renderer/core/html/canvas/html_canvas_element.cc, canvas_font_cache.cc, image_element_base.cc; third_party/blink/renderer/core/imagebitmap/image_bitmap.cc; third_party/blink/renderer/modules/canvas/imagebitmap/image_bitmap_factories.cc; third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc; third_party/blink/renderer/platform/graphics/canvas_hibernation_handler.h; third_party/blink/renderer/platform/runtime_enabled_features.json5 (all under https://chromium.googlesource.com/chromium/src/+/main/)
- https://webgl2fundamentals.org/webgl/lessons/webgl-text-texture.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-text-glyphs.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-text-canvas2d.html
- https://webgl2fundamentals.org/webgl/lessons/webgl-text-html.html
- https://github.com/mapbox/tiny-sdf (README.md, index.js)
- https://github.com/mapbox/mapbox-gl-native/wiki/Text-Rendering
- https://www.scichart.com/documentation/js/v4/2d-charts/axis-api/axis-labels/performance-considerations-native-text-axis-abels/
- https://www.scichart.com/documentation/js/v4/2d-charts/performance-tips/performance-tips-and-tricks/
- https://github.com/jhildenbiddle/canvas-size (README.md, docs/index.md)
- https://pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit/ (blog)
- https://bugzilla.mozilla.org/show_bug.cgi?id=1246410
- https://www.tunetheweb.com/blog/what-does-the-image-decoding-attribute-actually-do/ (blog)
- https://web3dsurvey.com/webgl2/parameters/MAX_TEXTURE_SIZE
- https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/
- https://webkit.org/blog/17862/webkit-features-for-safari-26-4/
- https://github.com/WICG/html-in-canvas/blob/main/README.md

## Not covered / could not access
- Mapbox blog "Drawing text with signed distance fields" returned HTTP 403; SDF details come from the mapbox-gl-native wiki and TinySDF instead. MSDF was not researched in depth.
- Firefox (Gecko) and Safari (WebKit) internals were not read. Claims about readback fallback, font/color caches, forced style updates, GPU-GPU texture copies, and Blob-vs-img decode threading are Chromium-only.
- No benchmarks were run. The web.dev canvas article (2011) jsperf links are dead; its speed claims (state changes, integer coordinates, clearing) may not hold on today's GPU canvases.
- Path2D speed-up numbers exist only in blog/search snippets; not verified.
- iOS Safari total canvas memory cap (384 MB on iOS 15) is from a blog and forum reports; no WebKit primary source was found.
- Chrome canvas hibernation (backgrounded canvases compressed to CPU memory) was seen in source only; its timing and first-frame cost after tab return were not researched.
- SciChart.js non-native label path (`getLabelTexture`, label cache internals) and whether SciChart.js can run in a worker with OffscreenCanvas were not checked.
- `CanvasFilter` objects, `ctx.lang`, `imageSmoothingQuality`, and `captureStream` were out of scope or not researched for performance.
