# GPU canvas and frames: render loops, canvas size, Canvas 2D drawing and text (CNV-)

Open this when you write your own `<canvas>` code or render loop: `requestAnimationFrame`, `getContext('2d')`, canvas `width`/`height` and `devicePixelRatio`, a `ResizeObserver` on a canvas, Canvas 2D paths and text, `OffscreenCanvas`, `createImageBitmap`. WebGL and WebGPU buffers, shaders and textures are in `gpu-webgl-webgpu.md`. A chart library that runs its own loop has its own reference file.
Stage cards: `pipeline.md` §H (`tasks`, `paint`, `gpu-upload`, `gpu-draw`, `memory`). Where rAF and ResizeObserver callbacks run inside one frame: `pipeline.md` §C.

## Checklist

| ID | Do this | Impact | First stage |
|---|---|---|---|
| **§A Frame loop** | | | |
| CNV-01 | One rAF owner per surface: handlers set dirty flags, the frame draws the latest state | high | tasks |
| CNV-02 | Render on demand; every loop has exits and a cancel on teardown | high | tasks |
| CNV-03 | Time motion by the rAF timestamp; only drawing in rAF; after-frame work as a task | high | tasks |
| **§B Backing store and DPR** | | | |
| CNV-04 | Size from `device-pixel-content-box`; assign only on change; re-apply state and redraw | high | layout |
| CNV-05 | Cap DPR and pixel count; budget canvas memory before you add a surface | high | paint |
| CNV-06 | Handle a zero-size or hidden start, and DPR changes | medium | layout |
| **§C Layers by change rate** | | | |
| CNV-07 | Static, data and overlay layers; hover redraws only dirty overlay rectangles | high | paint |
| CNV-08 | DOM for a tooltip, a legend and a few labels, moved with `transform` | medium | composite |
| **§D Canvas 2D drawing and text** | | | |
| CNV-09 | One path and one stroke per style group; state set once per group | high | paint |
| CNV-10 | Constant color strings plus `globalAlpha`; `setTransform()` per item, not `save()` | medium | js |
| CNV-11 | Snap lines and blits to device pixels | low | paint |
| CNV-12 | Reuse `Path2D`; no `shadowBlur` or `ctx.filter` per frame; snug sprite caches | medium | paint |
| CNV-13 | Clear with `clearRect()` or `reset()`, never by assigning `width` | medium | paint |
| CNV-14 | Hit-test with geometry, not `getImageData()` | high | tasks |
| CNV-15 | Text: fixed fonts, cached widths, no DOM writes between text calls, fonts loaded first | high | js |
| CNV-16 | Choose DOM, a 2D overlay or GPU glyphs by label count and update rate | high | paint |
| CNV-17 | Set `willReadFrequently`, `alpha` and `desynchronized` on purpose | medium | paint |
| **§E Off the main thread** | | | |
| CNV-18 | `transferControlToOffscreen()` when the main thread is the measured bottleneck | high | tasks |
| CNV-19 | `createImageBitmap(blob)` at the final size; transfer it; `close()` it | medium | tasks |
| **§F Visibility** | | | |
| CNV-20 | Pause when the tab is hidden or the surface is off-screen; draw once on resume | high | tasks |
| **§G Fewer marks** | | | |
| CNV-21 | Choose the renderer by mark count; draw the visible range; min-max per pixel column | high | js |
| **§H One-line rules** | | | |
| CNV-22 | Export with `toBlob()` or `convertToBlob()`, not `toDataURL()` | medium | tasks |
| CNV-23 | Rebuild 2D caches on `contextrestored` | medium | memory |
| CNV-24 | Release the canvases and bitmaps of a destroyed surface | medium | memory |
| CNV-25 | `transferToImageBitmap()` plus `bitmaprenderer` for finished frames | low | composite |
| CNV-26 | Load fonts into the worker before `OffscreenCanvas` text | medium | network |

- → EVT-03, EVT-04 pointer input: coalesce to one rAF; coalesced events only for freehand strokes
- → DATA-06, DATA-11 data ticks: flush once per frame; degrade by a written policy under load
- → GPU-24, GPU-25 GPU text: rasterize only on change; glyph atlas, per-string textures or SDF
- → GPU-29, GPU-30 WebGL and WebGPU context loss and teardown
- → CSS-07, CSS-02 no rounded clips, masks or `backdrop-filter` around a live canvas
- → LIFE-06 hidden tab: stop work, flush state, render once on return

## §A Frame loop

### CNV-01 One rAF owner per surface: handlers set dirty flags, the frame draws the latest state
stage: tasks, gpu-draw · metric: frame, INP · when: render-loop, interaction · impact: high — several redraw triggers and data messages often land in one frame, and every extra draw costs full raster or GPU work that nobody sees · support: baseline · also: EVT-03, DATA-06, CNV-02
- Do: Send every reason to redraw (pointer, wheel, data message, resize, theme) through one scheduler per canvas or surface. Handlers only update state and mark the layers that changed. At most one `requestAnimationFrame` callback is pending, and it draws each dirty layer once from the latest state. Never draw inside an event or message handler, and never let two modules request frames for the same surface.
- Why: A pointer move, a wheel step, several data messages and a resize can all arrive before one frame, but the screen shows one frame per refresh, so a draw per trigger repeats work that nobody sees. Chrome already delivers continuous input once per frame, just before rAF, so the rAF step adds no delay. For a single event, drawing in rAF instead of the handler does not remove the work from that frame: the saving comes from merging triggers.
- Detect: `rg -n -A8 "addEventListener\(\s*['\"](pointermove|mousemove|wheel|message)|onmessage\s*=" -g '*.{ts,tsx,js,jsx,svelte,vue}'`, then look for draw calls (`draw(`, `render(`, `stroke(`, `fillRect(`, `drawArrays(`) in the handler body. Also more than one `requestAnimationFrame(` call site that draws the same canvas.
- Verify: measure.md#fps with the `stream` or `pan` scenario. Pass: `__wpProbe.loaf.read()` shows no draw time under `event-listener` scripts, trace-summary counts at most one "Animation frame fired" per frame, and frame p95 wins or stays neutral.
- Example:
  ```ts
  let dataDirty = false, overlayDirty = false, frame: number | null = null;
  export function invalidate(layer: 'data' | 'overlay') {
    if (layer === 'data') dataDirty = true; else overlayDirty = true;
    frame ??= requestAnimationFrame(drawFrame);      // at most one pending frame
  }
  function drawFrame(now: number) {
    frame = null;
    const data = dataDirty, overlay = overlayDirty;
    dataDirty = overlayDirty = false;                // a draw below may invalidate again
    if (data) drawData(state, now);                  // the latest state, not a queue of events
    if (overlay) drawOverlay(state.pointer);         // nothing dirty: no new frame, the loop stops
  }
  export function dispose() { if (frame !== null) cancelAnimationFrame(frame); frame = null; }
  ```
- Avoid: rAF does not run in hidden tabs, so keep model updates in the handler or a worker and put only drawing in rAF. A freehand stroke needs every sample: read `getCoalescedEvents()` in the handler (EVT-04) and draw the points in the frame. A chart library with its own loop needs no second loop: call its invalidate API.
- Source: https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames ; https://developer.chrome.com/blog/aligning-input-events

### CNV-02 Render on demand, and give every loop its exits and a cancel on teardown
stage: tasks, gpu-draw, paint · metric: frame, INP · when: render-loop, session · impact: high — a loop that always asks for the next frame runs the rendering steps and a full redraw every frame, also when nothing changed · support: baseline · also: CNV-01, CNV-20, CSS-18, LIFE-01
- Do: Request the next frame only while something is dirty or still animating, and keep the handle `null` while idle. Give every loop explicit exits: nothing changed, the animation ended, the tab is hidden or the surface is off-screen (CNV-20), and teardown, where the owner's cleanup calls `cancelAnimationFrame()`. The CNV-01 example is such a loop.
- Why: The browser skips the rendering steps of a document only when nothing visible changed and no animation frame callback is waiting, so a self-renewing loop forces them every frame. A WebGL canvas presents a new buffer only after a draw, a resize or context creation, so a frame without a draw keeps the last image on screen.
- Detect: `rg -n -A12 'requestAnimationFrame\(' -g '*.{ts,tsx,js,jsx,svelte,vue}'`, then read each callback: an unconditional re-request at its end is the bad case. Files that request frames but never cancel them: `rg -l 'requestAnimationFrame' | xargs rg -L 'cancelAnimationFrame'`. Also `setInterval(` that draws.
- Verify: measure.md#fps with an idle window: load the fixture, mark `wp:start` and `wp:end` around 5 s with no input and no data, and trace it without the frame probe (the probe's own rAF keeps frames alive). Pass: trace-summary counts 0 "Animation frame fired" in the idle window.
- Avoid: Do not throttle an idle loop to 30 fps: a stopped loop costs nothing. A callback requested inside a rAF callback runs in the next frame, not in the current one. Request ids are not guaranteed to be above 0, so use `null`, not 0, for "no frame pending". To stop a library's own loop, use the library's pause API.
- Source: https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering ; https://registry.khronos.org/webgl/specs/latest/1.0/#THE_DRAWING_BUFFER

### CNV-03 Time motion by the rAF timestamp; keep rAF for drawing; queue after-frame work as a task
stage: tasks, js · metric: INP, frame · when: render-loop, interaction · impact: high — rAF time is part of the presentation delay of every interaction, and motion counted in frames runs at the wrong speed at other refresh rates · support: baseline · also: EVT-01, EVT-13, DATA-03, CNV-01
- Do: Compute animation progress from the timestamp that rAF passes in, and use that one value for all drawing in the frame. In rAF, only draw and write styles; parse, aggregate, compute indicators, log and save in the message handler, a later task or a worker. For work that must wait until this frame is done, queue a task from rAF (`requestAnimationFrame(() => setTimeout(work, 0))`), not a second rAF.
- Why: rAF callbacks run after event handlers and just before style and layout, so their time adds to the INP presentation delay. Displays run from 30 to 144 Hz and more, and Chrome's Energy Saver can lower the frame rate, so a fixed 16.7 ms step runs too fast or too slow. A task queued from rAF runs after the frame's rendering work, while a nested rAF waits a whole frame.
- Detect: `rg -n "1000\s*/\s*60|16\.6|16\.7|(frame|tick)(Count)?\s*(\+\+|\+=)" -g '*.{ts,tsx,js,jsx}'` in animation code; `rg -n -A15 'requestAnimationFrame\(' -g '*.{ts,tsx,js,jsx}' | rg 'JSON\.parse|\.sort\(|\.reduce\(|fetch\(|sendBeacon|localStorage'`; `requestAnimationFrame\(\(\) => requestAnimationFrame`.
- Verify: measure.md#inp for an interaction that redraws, then measure.md#fps. Pass: `FrameRequestCallback` scripts in `__wpProbe.loaf.read()` take less time, the INP presentation delay wins, and frame p95 is not worse.
- Avoid: Do not move the visual change itself out of rAF to shorten the frame: that only delays the pixels. The timestamp can be coarse, so do not use it to time code. A task queued from rAF runs after the main thread finishes the frame, not after the frame is on screen.
- Source: https://web.dev/articles/find-slow-interactions-in-the-field ; https://web.dev/articles/optimize-inp

## §B Backing store and DPR

### CNV-04 Size the backing store from `device-pixel-content-box`; assign only on change, then redraw
stage: layout, paint, memory · metric: frame, memory · when: load, interaction · impact: high — every `width` or `height` assignment clears the bitmap, resets all context state and reallocates memory, and a wrong size blurs lines or wastes pixels · support: device-pixel-content-box · also: CNV-05, CNV-06, EVT-08
- Do: Let CSS size the canvas. Observe it once with `{ box: 'device-pixel-content-box' }`, read `devicePixelContentBoxSize[0]` (`inlineSize`, `blockSize`), and apply the DPR cap from CNV-05. Assign `width` and `height` only when the integer size differs. In the same callback, re-apply the transform, font and styles (WebGL: the viewport from `drawingBufferWidth` and `drawingBufferHeight`) and redraw at once, so this frame does not show an empty canvas.
- Why: Setting either attribute runs the "set bitmap dimensions" steps, even when the value does not change. CSS size × `devicePixelRatio` can differ by one pixel from the device-pixel size that the browser snaps to, which blurs 1-pixel lines at fractional DPR. ResizeObserver callbacks run after layout and before paint, so a redraw there shows the new size in the same frame.
- Detect: `rg -n '\.(width|height)\s*=' -g '*.{ts,tsx,js,jsx,svelte,vue}'` on canvases with no equality check first, or inside draw functions and rAF; `rg -n "addEventListener\(\s*['\"]resize|(innerWidth|clientWidth|offsetWidth)\s*\*\s*devicePixelRatio"`.
- Verify: measure.md#fps with `pan`, then one layout change of the panel. Pass: an app counter of backing-store resizes in `window.__perf.counters()` stays at 0 during `pan` and rises by 1 per real size change, and 1-device-pixel lines are sharp in a `take_screenshot` at DPR 2.
- Example:
  ```ts
  const DPR_CAP = 2;                                                   // from the chart contract (CNV-05)
  const ro = new ResizeObserver(([entry]) => {
    const box = entry.devicePixelContentBoxSize[0], css = entry.contentBoxSize[0];
    if (!box.inlineSize || !box.blockSize) return;                     // hidden or collapsed (CNV-06)
    const s = Math.min(1, DPR_CAP / devicePixelRatio);
    const w = Math.max(1, Math.round(box.inlineSize * s)), h = Math.max(1, Math.round(box.blockSize * s));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w; canvas.height = h;                               // clears the bitmap and all state
    ctx.setTransform(w / css.inlineSize, 0, 0, h / css.blockSize, 0, 0);  // draw in CSS pixels
    drawAll(performance.now());                                        // same frame: no blank canvas
  });
  ro.observe(canvas, { box: 'device-pixel-content-box' });
  ```
- Avoid: Do not change the observed element's size inside the callback: the browser runs layout again, and it reports "ResizeObserver loop completed with undelivered notifications" when it gives up. A window `resize` event misses size changes that come from layout. After `transferControlToOffscreen()`, the worker sets the size (CNV-18). The target is Chromium, so this rule has no fallback code for engines without this box (support.md).
- Source: https://web.dev/articles/device-pixel-content-box ; https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-set-bitmap-dimensions

### CNV-05 Cap DPR and pixel count, and budget canvas memory before you add a surface
stage: paint, gpu-draw, memory · metric: frame, memory · when: render-loop, session · impact: high — raster and fragment work grow with DPR², so DPR 2 draws 4 times and DPR 3 draws 9 times the pixels of DPR 1 · support: baseline · also: CNV-04, CNV-07, GPU-22
- Do: Take the DPR cap from the chart contract (default 2) and apply it to every backing store; lower it for a heavy data layer on weak GPUs, but keep text and thin-line layers sharp. Before you add a surface or a layer, estimate its memory: CSS width × CSS height × DPR² × 4 bytes × layers × instances, plus caches and atlases, and keep the sum under a budget per window pixel. Check `getContext()` for `null`, and keep each canvas inside the browser's maximum side and area.
- Why: Every layer is a full bitmap, and the browser can keep a second buffer for double buffering. One 1440 × 900 CSS-pixel layer at DPR 2 is 2880 × 1800 device pixels, about 21 MB, so three layers on four panels are about 250 MB before any texture. MDN describes a VRAM budget per window pixel, which scales the limit with the screen.
- Detect: `rg -n 'devicePixelRatio' -g '*.{ts,tsx,js,jsx,svelte,vue}'`, then check for a cap (`Math.min(devicePixelRatio`) where backing sizes are set; full-size stacked canvases per component (`rg -c '<canvas'`); `getContext\(` results used without a `null` check.
- Verify: measure.md#gpu at DPR 1 and DPR 2 (`1440x900x1`, `1440x900x2`). Pass: frame p95 at the capped DPR meets the frame budget, and the memory estimate in the chart contract matches the canvas count from `__wpProbe.memory.sample()`.
- Avoid: Below the native DPR, 1-pixel lines and small text get soft: cap the heavy layer, not the text layer. A cap that changes during a gesture reallocates the bitmap twice per gesture: do it only when frame measurements need it. For a canvas drawn at low resolution on purpose, scale it up with `image-rendering: pixelated` (CSS-25).
- Source: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://webgl2fundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html

- **CNV-06** Start safely and follow DPR changes: draw nothing and create no GPU resources while the observed size is 0 (a hidden tab or a closed panel), and listen for `change` on a `matchMedia('(resolution: …dppx)')` query built from the current `devicePixelRatio`, then re-apply the CNV-04 transform and rebuild text caches and atlases (CNV-15). Browser zoom can change DPR while the device-pixel size stays the same, so the ResizeObserver alone may not fire. [layout, paint · frame, memory · medium] https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio

## §C Layers by change rate

### CNV-07 Split a surface into layers by change rate; hover redraws only dirty overlay rectangles
stage: paint, gpu-draw · metric: frame, INP · when: interaction, render-loop · impact: high — a hover or crosshair that redraws the data layer on each pointer move multiplies raster or GPU work by the data size · support: baseline · also: CNV-08, CNV-05, DOM-08
- Do: Stack absolutely positioned canvases by update rate: a static layer (grid, frame, watermark, or a CSS background), a data layer, and an overlay for hover, selection, crosshair and drag previews (`pointer-events: none`). Redraw a layer only when its own inputs change. On the overlay, clear and redraw only the rectangles drawn in the last frame, padded for line width and anti-aliasing. WebGL: render content that changes rarely into a texture once per view change, and draw it as one quad under the live parts.
- Why: The compositor blends the canvases, so redrawing the overlay never touches the data layer. A pointer move then costs a few small rectangles instead of a redraw of every mark.
- Detect: `rg -n -A10 "pointermove|mousemove" -g '*.{ts,tsx,js,jsx,svelte,vue}'`, then check whether the frame it schedules redraws every series; one `<canvas>` per chart that holds both data and crosshair; a full `clearRect(0, 0, …)` of the overlay on every move.
- Verify: measure.md#inp with a hover sweep, then measure.md#fps with `pan`. Pass: the data-layer draw counter in `window.__perf.counters()` does not change during the hover sweep, the INP presentation delay wins, and frame p95 wins.
- Avoid: Each full-size layer costs a full backing store and a composited layer (CNV-05), so add a layer only for a different change rate. A cached layer must be rebuilt on pan, zoom, resize, DPR or theme change. When more than about half of the overlay is dirty, one full clear is simpler.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas ; https://webgl2fundamentals.org/webgl/lessons/webgl-qna-how-to-optimize-rendering-a-ui.html

- **CNV-08** Put a tooltip, a legend and up to a few dozen labels in absolutely positioned DOM over the canvas: create them once, change text through a kept Text node, move them with `transform: translate(…)`, and hide unused ones instead of removing them. A DOM tooltip then needs only compositing per pointer move, not a canvas redraw, and it stays accessible; hundreds of moving labels belong in a canvas or a GPU atlas (CNV-16). [composite, paint · INP, frame · medium] https://webgl2fundamentals.org/webgl/lessons/webgl-text-html.html

## §D Canvas 2D drawing and text

### CNV-09 Draw each style group as one path and one stroke, with the state set once per group
stage: paint, js · metric: frame · when: render-loop · impact: high — a `beginPath()` and `stroke()` per segment multiplies calls and raster passes for grid lines, ticks and bars · support: baseline · also: CNV-10, CNV-21
- Do: Bucket marks by style (`strokeStyle`, `fillStyle`, `lineWidth`, `font`). For each bucket, set the state once, add every segment to one path with `moveTo()` and `lineTo()` (or `rect()`), then call `stroke()` or `fill()` once. Skip a state assignment when the value did not change.
- Why: The 2D context is a state machine: many path commands followed by one paint cost less than many small paints, and each style change is parsed and can split the browser's internal batches.
- Detect: `rg -n -B4 '\.(stroke|fill)\(\)' -g '*.{ts,tsx,js,jsx}'`, then look for `beginPath()` and `stroke()` in the same loop body; `(fillStyle|strokeStyle)\s*=` inside per-mark loops.
- Verify: measure.md#fps with `pan` at the point count of the chart contract. Pass: frame p95 wins, and the draw function's time in `__wpProbe.loaf.read()` drops.
- Avoid: Reordering changes which mark is on top: bucket only marks whose order does not matter. A very long, self-crossing path can raster slowly at its joins, so split per style, not per segment. For short axis-aligned lines, `fillRect()` can be faster than a stroke: measure.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas ; https://web.dev/articles/canvas-performance

- **CNV-10** In per-mark loops, keep a few constant color strings and vary opacity with `globalAlpha` (reset it after), because Chromium caches only a few parsed colors, and a color string that changes per mark (a template string with the opacity) is parsed again each time; place marks with `setTransform()` and keep `save()`/`restore()` for groups and clips, since each `save()` copies the whole drawing state. [js, paint · frame, memory · medium] https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/canvas/canvas2d/cached_color.h
- **CNV-11** Snap to device pixels: round positions in device pixels, put odd-width lines on pixel centers (`n + 0.5`), and round `drawImage()` targets; do not round smooth motion paths, which then jitter. This is mainly for sharpness. [paint · frame · low] https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Applying_styles_and_colors

### CNV-12 Reuse `Path2D` shapes, keep blur out of per-frame drawing, and blit snug sprite caches
stage: paint, js · metric: frame, memory · when: render-loop · impact: medium — rebuilt shapes, blur filters and scaled blits repeat, in every frame, work that could run once · support: baseline · also: CNV-18, CNV-05
- Do: Build repeated shapes (markers, icons, annotation outlines) once as `Path2D`, and draw them with `fill(path)` or `stroke(path)` under `setTransform()`. Keep `shadowBlur` and `ctx.filter` out of anything that you draw each frame. Draw glows, shadows and complex icons once into an `OffscreenCanvas` sized tightly to the content at device resolution, then `drawImage()` it at 1:1 scale and integer positions.
- Why: A blur runs a filter pass over the drawn area on every draw. A cache blit costs in proportion to its source size, so a loose cache loses the gain, and scaling in `drawImage()` adds resampling.
- Detect: `rg -n 'shadowBlur\s*=|\.filter\s*=' -g '*.{ts,tsx,js,jsx}'` in draw paths; `new Path2D\(` inside draw loops or rAF.
- Verify: measure.md#fps with `pan`. Pass: frame p95 wins, and the draw function's time in `__wpProbe.loaf.read()` drops.
- Avoid: A `Path2D` whose points change every frame gives no gain: rebuild it only when data changes. Each cache costs width × height × 4 bytes and must be rebuilt when DPR, theme or font changes. Published `Path2D` speed-ups come from blogs: measure.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/Path2D ; https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas

- **CNV-13** Clear with `ctx.clearRect()` under an identity transform, or `ctx.reset()` to also restore every state value, never with `canvas.width = canvas.width`: any `width` or `height` assignment, also of the same value, makes a new bitmap and resets the context. Find it with `rg -nP '(\w+)\.width\s*=\s*\1\.width'`. On an `alpha: false` canvas, fill the background instead of clearing. [paint, memory · frame, memory · medium] https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-set-bitmap-dimensions

### CNV-14 Hit-test marks with geometry, not by reading pixels
stage: tasks, gpu-upload · metric: INP · when: interaction · impact: high — `getImageData()` on a GPU canvas flushes queued drawing and waits for a GPU readback inside the handler · support: baseline · also: CNV-17, GPU-28, V8-01
- Do: Find the mark under the pointer with math on cached geometry: a binary search on the sorted x column plus a distance check, a spatial grid, or `isPointInPath()` and `isPointInStroke()` on stored `Path2D` shapes. Rebuild that geometry only when positions or the view transform change. If you cannot avoid a color-ID pick buffer, draw it on a separate small canvas with `willReadFrequently: true` and read 1 × 1 pixel.
- Why: A pixel read must finish all recorded drawing and copy the result back from the GPU, so it stalls the thread in the middle of input handling. In Chrome, a few reads also move a canvas without an explicit `willReadFrequently` value to the CPU, which slows all later drawing on it.
- Detect: `rg -n 'getImageData\(|readPixels\(' -g '*.{ts,tsx,js,jsx}'` in pointer handlers, hover code or rAF.
- Verify: measure.md#inp with a hover sweep over dense data. Pass: INP processing time wins.
- Avoid: `isPointInPath(path, x, y)` applies the current transform to the path, but takes `x` and `y` in bitmap pixels: set the transform that you drew with, and pass pointer coordinates × DPR. Privacy settings can add noise to `getImageData()` output, which breaks exact color matching. Tooltips and hit tests read the raw data, not a decimated copy (CNV-21).
- Source: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently ; https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/isPointInPath

### CNV-15 Text: fixed fonts, cached widths, no DOM writes between text calls, fonts loaded first
stage: js, style · metric: frame, INP · when: render-loop, load · impact: high — axis and label code measures many strings per frame, each `measureText()` shapes text and allocates, and on a canvas in the document a text call can force a style update · support: baseline · also: CNV-06, CNV-16, CNV-26, MEDIA-07
- Do: Keep font strings as `px` constants, group text by font, and assign `ctx.font` only when it changes. Cache widths in a bounded `Map` keyed by font and text; for tabular digits, measure each glyph once and add. Run all canvas text calls of a frame before its DOM writes, and measure on an `OffscreenCanvas`, which has no element and no style to update. Before the first draw, `await document.fonts.load(FONT)` with a timeout, and clear width caches on the `document.fonts` `loadingdone` event and on a theme font change; rasterized text caches also need a rebuild on a DPR change (CNV-06).
- Why: `ctx.font` is parsed as a CSS `font` value, and `measureText()` shapes the string and returns a new object. In Chromium, font, draw and measure calls on a canvas that is in the document first bring its style up to date, even when the font string is the same. So a repeated `font` assignment still costs a style check, and a DOM write between two text calls forces a style recalculation. Canvas text does not wait for web fonts: text drawn before the font loads uses a fallback, and widths measured then are wrong.
- Detect: `rg -n 'measureText\(' -g '*.{ts,tsx,js,jsx}'` in loops or rAF with no cache; `rg -n '\.font\s*=\s*\x60'` (a font string built per label); `\.font\s*=.*\d(em|rem|%)`; `fillText\(` in a module with no `document.fonts.load` or `fonts.ready`.
- Verify: measure.md#fps with `zoom`, so labels change. Pass: the label code's time in `__wpProbe.loaf.read()` drops, "Recalculate style" in trace-summary does not grow with the label count, and a screenshot after load shows the real font.
- Example:
  ```ts
  const AXIS_FONT = '11px Inter, sans-serif';
  const measure = new OffscreenCanvas(1, 1).getContext('2d')!;   // no element: no style update
  measure.font = AXIS_FONT;
  const widths = new Map<string, number>();
  export function labelWidth(text: string): number {
    let w = widths.get(text);
    if (w === undefined) {
      if (widths.size >= 5000) widths.clear();                   // keep the cache bounded
      widths.set(text, (w = measure.measureText(text).width));
    }
    return w;
  }
  document.fonts.addEventListener('loadingdone', () => { measure.font = AXIS_FONT; widths.clear(); });
  ```
- Avoid: A resize or `reset()` sets `font` back to `10px sans-serif`, so clear any JS "current font" cache then. Relative units such as `em` resolve against the canvas element's style. Summed glyph widths ignore kerning: use them only for tabular digits. A worker has no `document.fonts` (CNV-26).
- Source: https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-font ; https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/measureText

### CNV-16 Choose the label technique by label count and update rate: DOM, a 2D overlay or GPU glyphs
stage: paint, gpu-upload · metric: frame, INP, memory · when: render-loop · impact: high — the wrong technique multiplies text cost by the number of labels on every panel · support: baseline · also: CNV-08, GPU-24, GPU-25
- Do: Write the peak label count and update rate into the chart contract, then choose. A few labels that change rarely or take input (tooltip, legend) go in DOM (CNV-08). Tens of labels that move with pan and zoom go on one 2D overlay canvas. Hundreds of labels, or labels on many WebGL or WebGPU charts, go through a glyph atlas drawn in one call (GPU-25) and rasterized only when a string changes (GPU-24); use SDF glyphs when labels scale or rotate.
- Why: Each technique pays for a different thing: DOM text pays style and layout per change, a 2D overlay pays raster per frame, and GPU text pays one upload per new string and almost nothing per frame after that.
- Detect: `rg -n 'fillText\(' -g '*.{ts,tsx,js,jsx}'` inside per-point loops; `texImage2D|texSubImage2D|copyExternalImageToTexture` fed from a canvas inside rAF; one DOM element per data point for labels.
- Verify: measure.md#fps with `zoom` at the peak label count of the contract. Pass: frame p95 meets the frame budget, and the label-upload counter in `window.__perf.counters()` does not rise in frames where no string changed.
- Avoid: A per-glyph atlas loses kerning, ligatures and complex-script shaping: keep such strings as whole-string textures. GPU and canvas text is not accessible: mirror key values in DOM or ARIA. Plain SDF rounds sharp corners, and fixed-size axis text is sharper from a bitmap atlas at device resolution.
- Source: https://webgl2fundamentals.org/webgl/lessons/webgl-text-glyphs.html ; https://webgl2fundamentals.org/webgl/lessons/webgl-text-html.html

### CNV-17 Set `willReadFrequently`, `alpha` and `desynchronized` on purpose when you create a context
stage: paint, gpu-upload · metric: frame, INP · when: load · impact: medium — a wrong flag moves a canvas between CPU and GPU or adds work to every frame, and the flags cannot change after creation · support: canvas-2d-willreadfrequently, canvas-2d-alpha, canvas-2d-desynchronized · also: GPU-02, CNV-14
- Do: Pass `willReadFrequently: true` on canvases that you read often (pick buffers, glyph scratch for SDF), and `false` on display and texture-source canvases. Use `alpha: false` only on an opaque 2D background layer; for WebGL, keep `alpha: true` and write opaque alpha (GPU-02). Use `desynchronized: true` only for a small layer that follows the pointer (a freehand stroke) with no DOM above it, and read `getContextAttributes().desynchronized` to see whether the platform honors it; not every desktop platform does (support.md).
- Why: `willReadFrequently: true` asks for a CPU bitmap: reads get cheap, and drawing and texture uploads get slower. When the flag is not set, Chrome moves a GPU canvas to the CPU after a few reads, while an explicit `false` keeps it on the GPU. `desynchronized` lets the browser skip the normal compositor path, which cuts latency but can tear.
- Detect: `rg -n "getContext\(\s*['\"]2d['\"]\s*\)" -g '*.{ts,tsx,js,jsx,svelte,vue}'` in files that also call `getImageData`; `alpha:\s*false` on overlay canvases or WebGL contexts; `desynchronized:\s*true`.
- Verify: measure.md#fps for the canvas that changed. Pass: `list_console_messages` shows no `willReadFrequently` warning, frame p95 wins or stays neutral, and `getContextAttributes()` returns the flags that you set.
- Avoid: The first `getContext()` call fixes the attributes; a later call with other options returns the same context. With `alpha: false`, `clearRect()` gives black, not transparency. A canvas that you both read and upload needs two canvases: one CPU-backed for reads, one GPU-backed for uploads. Leave `colorSpace` at its default unless the whole pipeline uses the same space, or each upload pays a conversion.
- Source: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently ; https://developer.chrome.com/blog/desynchronized

## §E Off the main thread

### CNV-18 Draw in a worker with `transferControlToOffscreen()` when the main thread is the bottleneck
stage: tasks, gpu-draw · metric: INP, frame · when: render-loop, interaction · impact: high — drawing and input handling stop competing for one thread, so a long task no longer freezes the canvas · support: baseline · also: TASK-10, TASK-11, DATA-03, CNV-26
- Do: When a trace shows other main-thread work delaying frames, or drawing delaying input, call `canvas.transferControlToOffscreen()` once, before any `getContext()`, transfer the result to a long-lived worker, and draw there with the worker's `requestAnimationFrame`. Send pointer positions (client coordinates, mapped in the worker with a rect cached as in EVT-08), wheel input and the `device-pixel-content-box` size as small messages, and set `width` and `height` in the worker only when they change. For caches, atlases and scratch drawing on either thread, use `new OffscreenCanvas(w, h)`, not a detached `<canvas>`.
- Why: The worker has its own event loop, so a long main-thread task does not stop its frames. An `OffscreenCanvas` works on both threads, never waits for document style, and offers `transferToImageBitmap()` and `convertToBlob()`.
- Detect: long `FrameRequestCallback` scripts from draw code in `__wpProbe.loaf.read()` while `rg -n 'transferControlToOffscreen'` finds nothing; `rg -n "createElement\(\s*['\"]canvas"` used only as a cache that a worker could own.
- Verify: measure.md#fps with `stream` while a scenario keeps the main thread busy, then measure.md#inp. Pass: main-thread LoAF blocking time and INP win, and the worker's own frame intervals (the worker posts its rAF-delta p95 each second) win or stay neutral.
- Avoid: After the transfer, the main thread cannot call `getContext()` or set the size. The worker has no DOM and no `document.fonts` (CNV-26). A worker does not make a GPU-bound chart faster: the GPU is shared. Chrome allows fewer WebGL contexts per worker than per page (support.md), so let several charts share one worker context. Check that a chart library supports worker rendering before you plan on it.
- Source: https://web.dev/articles/offscreen-canvas ; https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-transfercontroltooffscreen

### CNV-19 Decode canvas images with `createImageBitmap(blob)` at the final size; transfer; `close()`
stage: tasks, gpu-upload, memory · metric: INP, frame, memory · when: load, interaction · impact: medium — a large decode on the main thread lands in a frame, and full-size bitmaps hold decoded memory until garbage collection · support: baseline · also: MEDIA-06, GPU-26, LIFE-01
- Do: For images that you draw into a canvas or upload as textures, `fetch()` the file, take its `Blob`, and call `createImageBitmap(blob, options)` with the final `resizeWidth` and `resizeHeight`, a `resizeQuality`, and the `premultiplyAlpha`, `colorSpaceConversion` and `imageOrientation` values that the consumer needs. When you decode in a worker, transfer the bitmap (`postMessage(msg, [bitmap])`). Call `bitmap.close()` after the upload or when you replace the bitmap.
- Why: In Chromium, a `Blob` source decodes on a background thread, while an `<img>` source decodes on the calling thread inside the call. Options applied at creation remove a later conversion pass, and `close()` frees the decoded pixels now instead of at the next garbage collection.
- Detect: `rg -n "createImageBitmap\(\s*\w*(img|image|Img|Image)\b" -g '*.{ts,tsx,js,jsx}'`; `createImageBitmap\(` in a file with no `.close()`; `new Image\(\)` passed to `texImage2D` or `drawImage` in frame code.
- Verify: measure.md#inp (or measure.md#load) for the action that shows the image, then measure.md#mem. Pass: no long decode or script on the main thread in the action window (trace-summary top events), and after 10 repeats the canvas count and the heap return to baseline.
- Avoid: Chromium decodes the full image before it resizes, so resizing saves memory and upload time, not decode time. `imageOrientation` takes only `from-image` or `flipY`. A closed bitmap has a size of 0 and throws on use. For `<img>` elements that script inserts into the page, use `img.decode()` instead (MEDIA-06).
- Source: https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap ; https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap

## §F Visibility

### CNV-20 Pause a surface while the tab is hidden or the surface is off-screen; draw once on resume
stage: tasks, gpu-draw · metric: frame, memory · when: session, render-loop · impact: high — surfaces that nobody sees keep spending main-thread and GPU time on every update, in long sessions with many panels · support: content-visibility · also: CNV-02, CSS-09, LIFE-06, DATA-10
- Do: Give each surface `pause()` and `resume()`. Pause it when `document.hidden` becomes true, and when it leaves the screen: if its container has `content-visibility: auto` (CSS-09), listen for `contentvisibilityautostatechange` on that element and read `event.skipped`; otherwise observe it with one shared IntersectionObserver and a `rootMargin`. On resume, draw once from the latest state, then let the loop run again.
- Why: rAF stops in hidden tabs, but timers, sockets and the draws that they trigger keep running. The event follows the browser's own decision to skip rendering of the subtree, including a margin before the region scrolls in, so drawing starts again just before the region shows.
- Detect: `rg -l 'requestAnimationFrame|getContext\(' -g '*.{ts,tsx,js,jsx,svelte,vue}' | xargs rg -L 'visibilitychange|contentvisibilityautostatechange|IntersectionObserver'`; `content-visibility:\s*auto` on panels that hold a `<canvas>` but have no listener.
- Verify: measure.md#fps with `stream`, first with all surfaces on screen, then with the panel scrolled away, then with the tab hidden. Pass: the draw counter of the unseen surface in `window.__perf.counters()` stops rising, "Animation frame fired" in trace-summary drops, and the first frame after return shows current data.
- Example:
  ```ts
  export function pauseWhenUnseen(host: HTMLElement, s: Surface, signal: AbortSignal) {
    let onScreen = host.firstElementChild?.checkVisibility({ contentVisibilityAuto: true }) ?? true; // late listener
    const sync = () => (onScreen && !document.hidden ? s.resume() : s.pause());
    document.addEventListener('visibilitychange', sync, { signal });
    host.addEventListener('contentvisibilityautostatechange', (e) => {   // on the host itself
      onScreen = !(e as ContentVisibilityAutoStateChangeEvent).skipped;
      sync();
    }, { signal });
    sync();                                                             // apply the start state
  }
  ```
- Avoid: `content-visibility: auto` keeps layout, style and paint containment while the region is on screen, so overflowing tooltips are clipped and the panel becomes the containing block for fixed children (CSS-09). Without `contain-intrinsic-size`, a skipped panel collapses. IntersectionObserver sees only geometry: not a panel covered by another panel, and not a hidden tab, hence the `visibilitychange` check. After some minutes in a hidden tab, Chrome moves 2D canvases to compressed CPU memory, so the first frame after a long absence is slower: redraw on return, and do not count that frame as a regression. This rule stops drawing only: what the feed does while the tab is hidden is DATA-10 and LIFE-06. A chart library with a built-in freeze option already does this: use one mechanism, not both. The first `contentvisibilityautostatechange` fires once, when the element is first rendered: add the listener before the host enters the DOM or gets `content-visibility: auto`, or read the start state with `checkVisibility({ contentVisibilityAuto: true })` on a child, as the example does.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/Element/contentvisibilityautostatechange_event ; https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API

## §G Fewer marks

### CNV-21 Pick the renderer by mark count; draw the visible range; one min-max per pixel column
stage: js, paint, gpu-draw · metric: frame, memory · when: render-loop · impact: high — draw cost grows with the marks drawn, not with what the screen can show · support: baseline · also: DOM-14, GPU-17, V8-01
- Do: Write the peak mark count into the chart contract and choose: DOM or SVG for up to a few hundred interactive marks, Canvas 2D for thousands, WebGL or WebGPU with instancing (GPU-17) beyond that or for many charts. Draw only the marks in the visible range: binary-search the sorted x column for the first and last index, and add one point on each side. When a series has more points than device-pixel columns, draw the minimum and maximum of each column, and recompute them when the range or the width changes.
- Why: A plot 3,000 device pixels wide cannot show more than 3,000 distinct x positions. Min-max per column keeps the spikes that plain sampling drops, and it limits the draw to about two vertices per column at any data size.
- Detect: `rg -n 'for\s*\(.*\.length' -g '*.{ts,tsx,js,jsx}'` in draw functions with no visible-range start and end; `\.(filter|map)\(` over the whole dataset inside rAF; one SVG or DOM element per data point.
- Verify: measure.md#fps with `pan` and `zoom` at the maximum points of the contract. Pass: frame p95 meets the frame budget, and it stays within noise when the data outside the view doubles.
- Example:
  ```ts
  // xs sorted ascending, i0 <= i1; writes [column, min, max] triples and returns their count
  function minMaxColumns(xs: Float64Array, ys: Float64Array, i0: number, i1: number,
                         toPx: (x: number) => number, out: Float64Array): number {
    let n = 0, col = Math.floor(toPx(xs[i0])), lo = ys[i0], hi = ys[i0];
    for (let i = i0 + 1; i <= i1; i++) {
      const c = Math.floor(toPx(xs[i])), y = ys[i];
      if (c === col) { if (y < lo) lo = y; else if (y > hi) hi = y; continue; }
      out[n++] = col; out[n++] = lo; out[n++] = hi;
      col = c; lo = hi = y;
    }
    out[n++] = col; out[n++] = lo; out[n++] = hi;
    return n / 3;
  }
  ```
- Avoid: Reduce only what you draw: tooltips and hit tests read the raw data (CNV-14). A chart library that resamples on its own needs no second reduction in JS. Long history still belongs on the server as aggregated buckets, for network and memory. The count limits are rough starting points from other skills: measure on the target hardware.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices ; https://github.com/openai/plugins/tree/main/plugins/build-web-data-visualization

## One-line rules

- **CNV-22** Export an image with `canvas.toBlob()` or `offscreen.convertToBlob()` and an object URL, not `toDataURL()`: the encoding runs in parallel to the calling thread, and the result is bytes, not a base64 string about a third larger. [tasks · INP, memory · medium] https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-toblob
- **CNV-23** On 2D canvases and `OffscreenCanvas` objects that hold caches or texture sources, handle `contextrestored`: re-apply the transform, font and styles (the loss resets them), rebuild the cache, mark the textures made from it dirty, and check `ctx.isContextLost()` before you reuse a cache. Do not call `preventDefault()` in a 2D `contextlost` handler: unlike WebGL, it cancels the restore (support.md: `canvas-context-lost`). [memory, gpu-upload · frame · medium] https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/contextlost_event
- **CNV-24** When a surface is destroyed and will not come back soon, stop its loop, set `width` and `height` of its 2D canvases and `OffscreenCanvas` objects to 0, `close()` its bitmaps and drop the references, so the memory goes now and not at a later garbage collection; lose WebGL contexts as in GPU-30. [memory · memory · medium] https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-set-bitmap-dimensions
- **CNV-25** To show a finished off-DOM frame without a copy, call `offscreen.transferToImageBitmap()` and give the bitmap to a `bitmaprenderer` context with `transferFromImageBitmap()`; one WebGL context can feed many canvases this way. Do not use it on an atlas that you keep building: it hands over the bitmap and leaves the `OffscreenCanvas` blank. [composite, memory · memory, frame · low] https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmapRenderingContext/transferFromImageBitmap
- **CNV-26** In a worker, load each font into `self.fonts` (`new FontFace(name, url)`, `self.fonts.add(face)`, `await face.load()`) before the first `fillText()` or `measureText()` on an `OffscreenCanvas`: the worker cannot see `document.fonts`, so text falls back to a default font and cached widths are wrong. `self.fonts.ready` alone does not load a font that you only added. [network, js · frame · medium] https://html.spec.whatwg.org/multipage/canvas.html#offscreencanvasrenderingcontext2d
