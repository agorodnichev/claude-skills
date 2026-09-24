# Verify: 12-canvas2d-and-images.md

Checked on 2026-09-23. Data used:
- MDN BCD 8.1.2 (npm latest, 2026-09-17) and web-features 3.39.0 (npm latest). The saved copies in `raw/verify/02/` are identical to npm latest, so I reused them.
- Chromium `main` source. The saved copies in `raw/canvas2d/` (2026-09-22) were used, plus new fetches (2026-09-23) of `cached_color.h`, `canvas_2d_recorder_context.cc`, `canvas_font_cache.cc`, `core/dom/document.cc`, `core/dom/node.cc`, `runtime_enabled_features.json5`, and `canvas_hibernation_handler.{h,cc}`.
- WebKit `main` source (`CanvasBase.cpp`) and two WebKit commits.
- chromestatus API, Bugzilla REST API, the WebKit Safari 27.0 release notes (2026-09-17), and the scichart 5.2.69 package source on jsDelivr.
- Raw files for this check are in `raw/verify/12/`.

## Summary counts

| Verdict | Count |
|---|---|
| Items checked | 47 |
| verified | 31 |
| corrected | 16 |
| disputed | 0 |
| unverified | 0 |

The main corrections:
1. iOS Safari canvas limits are stale. WebKit raised the iOS max canvas area to 8192×8192 in March 2024 (it shipped in iOS 18). WebKit removed the "Total canvas memory" cap in June 2023.
2. SciChart label-cache facts come from old v4 prose docs. The shipped source (4.0.933 and 5.2.69) sets `useSharedCache = true`. The cache is an LRU with 200 entries, not "one minute".
3. A detached `document.createElement('canvas')` does NOT force a style update in Chromium. `UpdateStyleAndLayoutTreeForElement` returns early when the element is not connected.
4. HTML-in-canvas origin trial: it was extended to Chrome 154 and then to Chrome 160 (chromestatus, updated 2026-09-08).
5. `devicePixelRatio` is "limited" on webstatus because Safari does not change it on page zoom. The reason is not "sub-feature differences".
6. `img.decode()` Baseline dates are wrong. It became newly available 2020-01-15 and widely available 2022-07-15.
7. Worker fonts: `self.fonts.ready` alone does not load a FontFace that you only `add()`ed. Await `face.load()` instead.
8. The rAF-coalescing item overstates the problem for Chrome. Chrome 60+ already dispatches `pointermove` at most once per frame, right before rAF.

---

### Declare `willReadFrequently` explicitly on every 2D context
- Verdict: verified
- Evidence: `raw/canvas2d/chromium-base_rendering_context_2d.cc` lines 495-531: `read_count_ >= kFallbackToCPUAfterReadbacks` → `DisableAcceleration()`, only when `WillReadFrequently::kUndefined`, and never when `IsDesynchronized()`. The console text matches exactly. `base_rendering_context_2d.h:99` gives `kFallbackToCPUAfterReadbacks = 2`. `chromium-html_canvas_element.cc:157-158,1678-1684` gives `kDisableAccelerationThreshold = 100` and `kDisableAccelerationPercent = 95`, which apply only to undeclared canvases. BCD `api.HTMLCanvasElement.getContext.2d_context.options_willReadFrequently_parameter`: Chrome 99, Firefox 28, Safari 18. web-features `canvas-2d-willreadfrequently`: baseline low 2024-09-16. Spec: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently ("major exception being readback").
- Note: the demotion is not fully "silent". Chrome prints the console warning on the 2nd read. `AcceleratedSmallCanvases` is `stable` in `runtime_enabled_features.json5`, so the 128×129 minimum size for acceleration does not apply in current Chrome, and small scratch canvases are GPU-backed too.

### Use `alpha: false` only on opaque 2D canvases, never as a WebGL speed trick
- Verdict: verified
- Evidence: MDN WebGL best practices: "On some platforms, this capability unfortunately comes at a significant performance cost. The RGB back buffer may have to be emulated on top of an RGBA surface" (https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices). Spec: "starts off as opaque black ... clearRect() always results in opaque black pixels". BCD 2D `options_alpha_parameter`: Chrome 32, Firefox 30, Safari false. web-features `canvas-2d-alpha`: baseline false.

### Keep label and overlay canvases in the default color format (`srgb`, `unorm8`)
- Verdict: corrected
- Correction: Change "Safari 27 beta adds `srgb-linear`/`display-p3-linear`" to "Safari 27.0 (released 2026-09-17) adds `srgb-linear` and `display-p3-linear` to `PredefinedColorSpace`". The HTML spec enum is now `{ "srgb", "srgb-linear", "display-p3", "display-p3-linear" }`. All other facts are correct: `colorSpace` Chrome 92 / Safari 15.2 / Firefox no; `colorType` Chrome 137, experimental; `colorType` values `"unorm8"`, `"float16"`. Chromium converts texture-backed images to `unpack_color_space_` on the GPU before the copy (`TexImageStaticBitmapImage`).
- Evidence: https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ; https://html.spec.whatwg.org/multipage/canvas.html (CanvasColorType, PredefinedColorSpace) ; `raw/canvas2d/chromium-webgl_rendering_context_base.cc` (`TexImageStaticBitmapImage`) ; BCD `api.HTMLCanvasElement.getContext.2d_context.options_colorType_parameter`.

### Use `desynchronized: true` only for a pointer-following layer, with no DOM above it
- Verdict: corrected
- Correction: The status line needs platform detail. BCD records desktop Chrome 81+ support with the note "ChromeOS and Windows" (Chrome 75-81 was partial, ChromeOS only), and Chrome Android 75. So on macOS and Linux Chrome, do not expect a latency gain. Safari 15 accepts the option. Firefox does not support it. The Chrome article's check is `ctx.getContextAttributes().desynchronized`. All other claims match the source: tearing, the translucent canvas "must not have any other DOM elements above it", clear flicker, and no readback CPU fallback (`!IsDesynchronized()`).
- Evidence: BCD `api.HTMLCanvasElement.getContext.2d_context.options_desynchronized_parameter` ; https://developer.chrome.com/blog/desynchronized (last updated 2019-05-02) ; `raw/canvas2d/chromium-base_rendering_context_2d.cc:521-525`.

### Handle `contextlost`/`contextrestored` on 2D canvases that hold caches
- Verdict: verified
- Evidence: BCD `api.HTMLCanvasElement.contextlost_event`, `contextrestored_event`, `api.OffscreenCanvas.contextlost_event`, `api.CanvasRenderingContext2D.isContextLost`: Chrome 99, Firefox 125, Safari no. web-features `canvas-context-lost`: baseline false. https://developer.chrome.com/blog/canvas2d.
- Note (add as a caveat): The 2D event semantics are the opposite of WebGL. The HTML "context lost steps" are: "Reset the rendering context to its default state ... Let shouldRestore be the result of firing an event named contextlost ... cancelable ... If shouldRestore is false, then abort these steps." So `e.preventDefault()` in a 2D `contextlost` handler STOPS the restore. In WebGL you must call `preventDefault()` to GET a restore (10-gpu-webgl.md:217). Also, loss resets transform, font, and styles, so re-apply state in `contextrestored`. Sources: `raw/webappapis.txt` (update-the-rendering steps) ; https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/contextlost_event.

### Batch many segments into one path and one stroke per style
- Verdict: verified
- Evidence: web.dev (last updated 2011-08-16): "better to put all of the points into the path, rather than rendering the segments separately", and the small-bounding-box exception is present (https://web.dev/articles/canvas-performance). MDN: "draw a polyline instead of multiple separate lines" (https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas, modified 2026-08-25).

### Group draws by style so state changes happen once per group
- Verdict: verified
- Evidence: web.dev: "it's cheaper to render by color rather than by placement on the canvas". Chromium `setStrokeStyle`/`setFillStyle` return early on `IsUnparsedStrokeColor(v8_string)` (`raw/verify/12/canvas_2d_recorder_context.cc:925-931`).

### Reuse a few constant color strings; vary opacity with `globalAlpha`
- Verdict: corrected
- Correction: Fix the Why mechanism. Chromium first calls `v8_string->InternalizeString(isolate)` and keys the 8-entry cache by the internalized string. So a template literal that produces the SAME text (for example, the same `rgba(...)` every frame) still hits the cache. The real misses come from many DISTINCT strings (for example, per-item opacity values), and more than 8 distinct values in a loop evict each other. The GC-pressure part stays true (one new string per assignment). The quoted words are exact: `kColorCacheMaxSize = 8` and "parsing the color from the string is expensive".
- Evidence: `raw/verify/12/canvas_2d_recorder_context.cc:379, 877-918, 925` (Chromium main, fetched 2026-09-23).

### Avoid `save()`/`restore()` per item in hot loops; set the transform directly
- Verdict: verified
- Evidence: `Canvas2DRecorderContext::save()` does `state_stack_.push_back(MakeGarbageCollected<CanvasRenderingContext2DState>(GetState(), ...))` and `canvas->save()`. `setTransform` = `resetTransform()` + `transform()` (`raw/verify/12/canvas_2d_recorder_context.cc:395-418, 1532-1545`). BCD `resetTransform`: Chrome 31, Firefox 36, Safari 10.1.

### Snap geometry to device pixels, with a half-pixel offset for odd-width lines
- Verdict: verified
- Evidence: MDN Drawing shapes ("2 pixels wide instead of 1, but also appears gray") and Applying styles and colors ("creating the path from centers of pixels"). MDN Optimizing canvas: "round all co-ordinates used in calls to drawImage()". web.dev: "this sort of optimization should no longer matter once canvas implementations are GPU accelerated".

### Reuse `Path2D` objects for static shapes and for hit testing
- Verdict: corrected
- Correction: (1) Status: `Path2D` became Baseline newly available on 2016-08-02 and widely available on 2019-02-02 (web-features per-key `api.Path2D`). MDN's banner "available across browsers since August 2016" gives the newly-available date, not the widely-available date. The other versions are correct (addPath Chrome 68 / Firefox 34 / Safari 9; `isPointInPath` path argument Chrome 36 / Firefox 31 / Safari 7). (2) Add a caveat for the hit-test advice. For `isPointInPath(path, x, y)` and `isPointInStroke(path, x, y)`, the path is transformed by the CURRENT transform, but x and y are "in the canvas coordinate space unaffected by the current transformation" (bitmap/device pixels). So set the item's transform (the same one you drew with) before the test, and pass pointer coordinates × DPR. `isPointInStroke` also uses the current `lineWidth`.
- Evidence: `raw/verify/02/wf.json` (`canvas-2d` by_compat_key `api.Path2D`: low 2016-08-02, high 2019-02-02) ; https://html.spec.whatwg.org/multipage/canvas.html (is point in path steps) ; https://developer.mozilla.org/en-US/docs/Web/API/Path2D.

### Keep `shadowBlur` and `ctx.filter` out of per-frame drawing
- Verdict: verified
- Evidence: MDN: "Avoid the shadowBlur property whenever possible". web.dev: "Avoid shadowBlur ... can be very expensive". BCD `api.CanvasRenderingContext2D.filter`: Chrome 52, Firefox 49, Safari 18 behind a flag. The Safari 27.0 notes add no canvas filter. `OffscreenCanvasRenderingContext2D.filter`: Chrome 69, Firefox 116, Safari no.

### Pre-render repeated sprites into snug caches; do not scale in `drawImage`
- Verdict: verified
- Evidence: web.dev: "make sure that your temporary canvas fits snugly around the image". MDN: "Cache various sizes of your images on an offscreen canvas when loading as opposed to constantly scaling them in drawImage()". web-features `offscreen-canvas`: high 2025-09-27.

### Split layers by update rate; put static backgrounds in CSS
- Verdict: corrected
- Correction: Change "Safari 27 beta fixed a case where a 2D canvas forced an unnecessary compositing layer" to "Safari 27.0 (released 2026-09-17) fixed ... (172864747)". The rest is verified (MDN layered canvases and CSS background).
- Evidence: https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ (Canvas section) ; https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas.

### Redraw only the dirty region of an overlay
- Verdict: verified
- Evidence: web.dev: "you might also know this technique as 'redraw regions'". MDN: "Render screen differences only".

### Coalesce overlay redraws into one `requestAnimationFrame` per frame
- Verdict: corrected
- Correction: (1) Fix the Impact/Why premise for Chrome: "Starting in Chrome 60, the input pipeline will delay dispatching continuous events (wheel, mousewheel, touchmove, pointermove, mousemove) and dispatch them right before the requestAnimationFrame() callback". So in Chrome, pointermove does not arrive several times per frame. The benefit comes from merging several redraw triggers (pointer, wheel, data ticks, resize) into one draw per frame. For INP, drawing in rAF instead of the handler moves the work but does not remove it from the same frame. Reduce the Impact to medium. (2) Add status for `getCoalescedEvents()`: Chrome 58, Firefox 59, Safari 18.2. Firefox for Android is partial and "always returns an empty array", so fall back to the event itself when the array is empty.
- Evidence: https://developer.chrome.com/blog/aligning-input-events (2017-06-22) ; BCD `api.PointerEvent.getCoalescedEvents`.

### Clear with `clearRect` or `reset()`, never by reassigning `width`
- Verdict: verified
- Evidence: Spec: "set, removed, changed, or redundantly set to the value they already have" → set bitmap dimensions. `reset()` steps: clear to transparent black, empty subpaths, clear state stack, reset state. BCD/web-features `canvas-reset`: Chrome 99, Firefox 113, Safari 17.2; low 2023-12-11, high 2026-06-11.
- Note: MDN Optimizing canvas still says "Try different ways to clear the canvas (clearRect() vs. fillRect() vs. resizing the canvas)". The spec supports the notes' stance, so this is a source tension, not a refutation.

### Hit-test geometrically instead of reading pixels
- Verdict: verified
- Evidence: `FinalizeFrame(FlushReason::kOther)` then `GetImage()` snapshot (`chromium-base_rendering_context_2d.cc:491-535`). Spec "major exception being readback". MDN getImageData: "random subtle noise is introduced ... with certain privacy settings (such as fingerprinting protection)".
- Note: WebKit `CanvasBase.cpp` has `canvasNoiseHashSaltIfNeeded()` driven by `NoiseInjectionPolicy::Minimal/Enhanced`, so Safari's fingerprinting protection is one concrete case (https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/CanvasBase.cpp).

### Set `ctx.font` from a small fixed set of strings, and only when it changes
- Verdict: verified
- Evidence: `canvas_font_cache.cc:22-26`: 50 / 5 (low-end) / hard 250 / 20 (low-end) / hidden 1. `BaseRenderingContext2D::setFont` returns early when `new_font == state.UnparsedFont() && CurrentFontResolvedAndUpToDate()`. That check runs AFTER `WillSetFont()`, which already updated style. So the JS-side "skip if same" advice saves more than Chromium's own early return (`raw/canvas2d/chromium-base_rendering_context_2d.cc:900-915`). The spec default after reset is `10px sans-serif`.

### Do not interleave DOM style writes with canvas text calls; rasterize text on OffscreenCanvas
- Verdict: corrected
- Correction: Remove "A detached `document.createElement('canvas')` still belongs to the document and still pays this cost." It is false in Chromium. `Document::UpdateStyleAndLayoutTreeForElement` begins with `if (!element->InActiveDocument()) return;`, and `Node::InActiveDocument()` is `isConnected() && GetDocument().IsActive()`. So only canvases connected to the DOM force a style update in `setFont`, `fillText`/`strokeText`, and `measureText`. The rest is correct: the three call sites exist, and connected canvases pay the cost. OffscreenCanvas is still the better choice for workers and portability.
- Evidence: `raw/verify/12/document.cc:2981-3002` ; `raw/verify/12/node.cc:1696-1698` ; `raw/canvas2d/chromium-canvas_rendering_context_2d.cc:573-585` ; `raw/canvas2d/chromium-base_rendering_context_2d.cc:1085-1100, 1252-1265`.

### Cache `measureText` results; rebuild caches when fonts load or DPR changes
- Verdict: verified
- Evidence: `measureText` calls `UpdateStyleAndLayoutTreeForElement`, then `AccessFont`, then `MakeGarbageCollected<TextMetrics>` (`chromium-base_rendering_context_2d.cc:1252-1275`). BCD `TextMetrics.fontBoundingBoxAscent`: Chrome 87, Firefox 116, Safari 11.1. web-features `font-loading`: high 2022-07-15.

### Load web fonts inside the worker before rasterizing text on an OffscreenCanvas there
- Verdict: corrected
- Correction: In the Do line, change "wait for `self.fonts.ready` (or `face.load()`)" to "await `face.load()` (or `self.fonts.load('11px Inter')`)". `add()` does not start a load. With only an unloaded, unused FontFace in the set, nothing is pending, so `fonts.ready` can resolve before the font loads. The spec's own worker example uses `fonts.ready`, but it relies on the font being requested some other way. The example code (which uses `await face.load()`) is correct. Status verified: `WorkerGlobalScope.fonts` Chrome 69, Firefox 105, Safari 15. OffscreenCanvas `font` is partial in Safari 16.4-18.4 (font-weight not reflected).
- Evidence: https://drafts.csswg.org/css-font-loading/ (FontFaceSet ready, "pending on the environment") ; https://html.spec.whatwg.org/multipage/canvas.html ("the font is only loaded inside the worker") ; BCD `api.WorkerGlobalScope.fonts`, `api.OffscreenCanvasRenderingContext2D.font`.

### Choose the label technique by label count and update rate
- Verdict: corrected
- Correction: Update SciChart facts to the current release (5.2.69 latest stable; 6.0.0-alpha.197). Native text is still on by default ("Default true (was false before v4)"). The v5 default native font is Arimo Regular (`nativeFontFamily = "default"` → "loads Arimo Regular font"; the canvas-text fallback is Arial). It is not "only Arial by default". The `fontStyle`/`fontWeight` limit and the `.ttf` / `registerFont()` path are still correct. Cite the v5 docs, not v4. I could not find the quoted phrase "a large performance benefit in multi-chart dashboards" on the v4 native-text page. That page says native text "offers performance benefits in situations where you have many axes with many labels". webgl2fundamentals presents DOM-node pooling as a guess ("I'm just guessing ... You'd have to profile").
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartDefaults.js (lines 13, 27-36, 82-92) ; https://www.scichart.com/documentation/js/v4/2d-charts/axis-api/axis-labels/performance-considerations-native-text-axis-abels/ ; https://webgl2fundamentals.org/webgl/lessons/webgl-text-html.html ; 13-scichart.md:362-371, 722-727.

### Use a glyph atlas for small closed character sets; per-string textures (with LRU) for free text
- Verdict: corrected
- Correction: Replace "SciChart exposes a shared label texture cache (`useSharedCache`, default false; keeps labels one minute across charts)" with "`SciChartDefaults.useSharedCache = true` in the shipped source since 4.0.933 (also 5.2.69). The v4/v5 prose docs still say 'not enabled by default' and 'retained ... for a minute'. The 5.2.69 `labelCache` is an LRU: `maxSize = 200` entries, prune at most every `minAge = 200` ms. Tune it with `labelCache.setMaxSize()`/`setMinAge()`." The webgl2fundamentals claims are verified ("re-generating the textures and re-uploading them to the GPU is a relatively slow operation"; "Reuse the same arrays"). "Browsers keep glyph caches as fixed-size LRU atlases" has no source cited. Mark it as an inference or remove it.
- Evidence: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/SciChartDefaults.js ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/Axis/LabelProvider/LabelCache.js (lines 95-128) ; https://www.scichart.com/documentation/js/v4/2d-charts/performance-tips/performance-tips-and-tricks/ ("Labels are retained in the cache for a minute", "not enabled by default").

### Use SDF glyphs when labels scale, rotate, or need halos
- Verdict: verified
- Evidence: mapbox-gl-native wiki: "When we generate SDFs, we always draw them with a 24 point font." TinySDF 2.2.0 `index.js`: defaults `fontSize = 24, buffer = 3, radius = 8, cutoff = 0.25`, `getContext('2d', {willReadFrequently: true})`, `new OffscreenCanvas(size, size)`. package `type: module`, and the README says "provided as a ES module".

### Rasterize text at the device pixel ratio and place it on the device pixel grid; rebuild on DPR change
- Verdict: corrected
- Correction: Replace the status reason "webstatus lists it 'limited' because of sub-feature differences" with "BCD marks Safari and iOS Safari as partial: '`devicePixelRatio` does not change when the page is zoomed' (WebKit bug 124862). So web-features `devicepixelratio` is not Baseline." Add a caveat: in Safari, page zoom does not fire the `matchMedia` resolution watcher, so atlases are not rebuilt on zoom there. Moving to another display still changes DPR. The rest is verified (MDN zoom and matchMedia; MDN WebGL moiré note).
- Evidence: BCD `api.Window.devicePixelRatio` (safari 3 PARTIAL, safari_ios 2 PARTIAL, note) ; web-features `devicepixelratio` (baseline false, no Safari entry) ; https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio.

### Keep canvas-to-texture uploads premultiplied from end to end
- Verdict: verified
- Evidence: webgl2fundamentals: "the Canvas 2D API produces only premultiplied alpha values". WebGPU `GPUCopyExternalImageDestInfo { premultipliedAlpha = false }` and the note "If premultipliedAlpha matches the source image, conversion might not be necessary" (https://www.w3.org/TR/webgpu/). Bugzilla 1246410: status NEW, S3/P3, last change 2025-04-05. Comment 3 names un-premultiply in `WebGLTexelConversions` as the slow path, and comment 42 (2024) says it still reproduces.

### Upload only the dirty sub-rectangle into a preallocated atlas texture
- Verdict: verified
- Evidence: WebGL 2 spec: "Subrect selection is possible using UNPACK_ params. UNPACK_SKIP_PIXELS and UNPACK_SKIP_ROWS determine the origin of the subrect, with the width and height arguments determining the size" (https://registry.khronos.org/webgl/specs/latest/2.0/). MDN: "some drivers might unconditionally allocate the whole mip-chain (+30% memory!)". 2048²×4 = 16 MiB (arithmetic).

### Do texture uploads at the start of the frame, before draw calls
- Verdict: verified
- Evidence: MDN WebGL best practices, "texImage/texSubImage uploads (esp. videos) can cause pipeline flushes" and "Prefer doing uploads before starting drawing, or at least between pipelines".

### Keep upload sources GPU-backed and 2D-targeted so Chrome can copy GPU-to-GPU
- Verdict: verified
- Evidence: `CanUseTexImageViaGPU` excludes `GL_RED_INTEGER`, `GL_FLOAT` on Android, `GL_HALF_FLOAT_OES`, `GL_UNSIGNED_SHORT_5_5_5_1` on Mac, and any function other than `kTexImage2D`/`kTexSubImage2D` (crbug 612542). `TexImageStaticBitmapImage` does the GPU copy only if `image->IsTextureBacked()` (`raw/canvas2d/chromium-webgl_rendering_context_base.cc:6213-6254`).

### Set flip, premultiply, and color conversion when creating an ImageBitmap, not with `pixelStorei`
- Verdict: verified
- Evidence: WebGL spec: "If the TexImageSource is an ImageBitmap, then these three parameters will be ignored. Instead the equivalent ImageBitmapOptions should be used". HTML spec: "There used to be a 'none' enum value. It was renamed to 'from-image'. In the future, 'none' will be added back with a different meaning." BCD: `premultiplyAlpha` Chrome 52 / Firefox 93 / Safari 17 (15-17 partial for ImageData); `from-image` Chrome 112 / Firefox 111 / Safari 16. BCD `imageOrientation.none`: no browser.

### Keep atlas pages at 4096×4096 or smaller
- Verdict: verified
- Evidence: https://web3dsurvey.com/webgl2/parameters/MAX_TEXTURE_SIZE: 4096 → 100%, 8192 → 97%, 16384 → 86%, 32768 → 1%. The page shows no date range. 4096²×4 = 64 MiB.

### Decode images for canvas/WebGL with `createImageBitmap(blob)`, not from an `<img>`
- Verdict: verified
- Evidence: `ImageBitmapLoader::ScheduleAsyncImageBitmapDecoding` → `worker_pool::PostTask(... DecodeImageOnDecoderThread ...)` (`raw/canvas2d/chromium-image_bitmap_factories.cc:420-470`). `ImageBitmap::ImageBitmap(ImageElementBase*)` creates an `ImageDecoder` and calls `GetSkImageFromDecoder` inline (`chromium-image_bitmap.cc:273-310`). SVG uses `ImageBitmap::CreateAsync` (`chromium-image_element_base.cc:203-216`). Chrome 2016 post: "if you call createImageBitmap() on the main thread, that's exactly where the decoding will be done". web-features: `api.createImageBitmap` low 2021-09-20 / high 2024-03-20; full feature `createimagebitmap` low 2023-12-11 / high 2026-06-11.

### Ask `createImageBitmap` for the final size and format
- Verdict: verified
- Evidence: Spec `ResizeQuality { "pixelated", "low", "medium", "high" }`, default `"low"`. BCD: `resizeWidth` Chrome 54 / Firefox 98 / Safari 15; `resizeQuality` Chrome 54 / Firefox 149 / Safari 15 (web-features per-key low 2026-03-24). The Blob decoder decodes at full size (no target size passed to `ImageDecoder::Create`). 4000×3000×4 = 48 MB.

### Call `close()` on ImageBitmaps you no longer need
- Verdict: verified
- Evidence: Spec `close()`: "Set this's [[Detached]] internal slot value to true. Unset this's bitmap data." Width/height return 0 when detached. BCD `api.ImageBitmap.close`: Chrome 52, Firefox 46, Safari 15.

### Await `img.decode()` before inserting overlay images; use `decoding="async"` only for non-critical images
- Verdict: corrected
- Correction: Status: `decode()` became Baseline newly available on 2020-01-15 and widely available on 2022-07-15 (web-features per-key `api.HTMLImageElement.decode`; versions Chrome 64, Firefox 68, Safari 11.1 / iOS 11.3). It is not "widely available since 2020-01". The `decoding` attribute has the same dates (Chrome 65, Firefox 63, Safari 11.1). The spec quote is verified: "User agents should ensure that the decoded media data stays readily available until at least the end of the next successful update the rendering step ... would only be violated in low-memory situations". The tunetheweb conclusions are verified (2023-06-26).
- Evidence: `raw/verify/02/wf.json` (`img` by_compat_key) ; https://html.spec.whatwg.org/multipage/embedded-content.html ; https://www.tunetheweb.com/blog/what-does-the-image-decoding-attribute-actually-do/.

### Consider WebCodecs `ImageDecoder` in a worker for animated or frame-by-frame images
- Verdict: verified
- Evidence: BCD `api.ImageDecoder`: Chrome 94, Firefox 133, Safari "preview", iOS no. Note: web-features rolls ImageDecoder into `webcodecs`, whose top-level support lists Safari 26. That is for other WebCodecs parts, not ImageDecoder. The Safari 27.0 notes mention only VideoDecoder changes.

### Move heavy canvas rendering to a worker with `transferControlToOffscreen()`
- Verdict: verified
- Evidence: web.dev: "there is no synchronization between the two" and "Caution: Examples in this video use the deprecated commit() call. Use worker.requestAnimationFrame instead." BCD: `transferControlToOffscreen` Chrome 69 / Firefox 105 / Safari 16.4; OffscreenCanvas webgl/webgl2 contexts Safari 17; worker rAF Chrome 69 / Firefox 99 / Safari 16.4 (Chrome note: not in nested workers). `OffscreenCanvasRenderingContext2D.commit`: deprecated, Safari 16.4-18 only. web-features `offscreen-canvas` and `request-animation-frame-workers`: high 2025-09-27.
- Note: 15-gaps-round-1.md:708-715 answers the open question. SciChart v5 has no worker/OffscreenCanvas rendering path, so "not checked" can become "not supported (v5.2.69)".

### Use `OffscreenCanvas` (not a detached `<canvas>`) for caches, atlases, and scratch work
- Verdict: corrected
- Correction: Fix the Why. The Chromium style-update cost applies only to canvases connected to the document. A detached `<canvas>` skips `UpdateStyleAndLayoutTreeForElement` (`!element->InActiveDocument()` → return). Valid reasons to prefer OffscreenCanvas: it works in workers, it has no element or style dependency by design (the same behavior in all engines), and it supports `transferToImageBitmap()`/`convertToBlob()`. Reduce the Impact to low-medium on the main thread.
- Evidence: `raw/verify/12/document.cc:2981-2990` ; `raw/verify/12/node.cc:1696-1698` ; https://web.dev/articles/offscreen-canvas.

### Show worker frames with `transferToImageBitmap()` + `bitmaprenderer`, and remember it clears the source
- Verdict: verified
- Evidence: Spec: ImageBitmapRenderingContext is "a low overhead method ... uses transfer semantics ... avoiding intermediate compositing"; "two copies of the decoded image existing in memory"; transferToImageBitmap: "replaced with a new blank image". web-features `imagebitmaprenderingcontext`: high 2022-07-15. BCD `transferToImageBitmap`: Chrome 69, Firefox 105, Safari 16.4.

### Transfer ImageBitmaps and OffscreenCanvases between threads; do not copy pixels
- Verdict: verified
- Evidence: Spec IDL: `[Exposed=(Window,Worker), Serializable, Transferable] interface ImageBitmap` and `Transferable ... OffscreenCanvas`. Chrome 2016 post: `self.postMessage({ imageBitmap }, [imageBitmap]);`.

### Set `canvas.width/height` only when the integer backing size changes, then re-apply state
- Verdict: verified
- Evidence: Spec "redundantly set to the value they already have" → set bitmap dimensions (resets the context). web.dev device-pixel-content-box: "the callback function of a ResizeObserver will be called before paint and after layout". web-features `resize-observer`: high 2023-01-28.

### Size the backing store from `devicePixelContentBoxSize` where supported
- Verdict: verified
- Evidence: BCD `api.ResizeObserverEntry.devicePixelContentBoxSize`: Chrome 84, Firefox 108 (93-108 partial, snapping bug), Safari no. The Safari 27.0 notes do not add it. MDN WebGL best practices uses `{ box: "device-pixel-content-box" }`.

### Budget canvas memory and clamp sizes to per-browser limits
- Verdict: corrected
- Correction: (1) iOS max area: WebKit commit 276145@main (2024-03-15), "[iOS] Increase the limit on the canvas size to 8192x8192". Current `maxCanvasArea()` is `8192 * 8192` on IOS_FAMILY and `16384 * 16384` elsewhere. Third-party testing reports that the change shipped in iOS 18.0. So on iOS 18+ the clamp is 67,108,864 px (8192²). Keep 4096² (16,777,216 px) only for iOS ≤ 17. The canvas-size docs table and MDN's canvas page ("iOS devices limit the canvas size to only 4,096 x 4,096") are out of date. (2) The iOS "total canvas memory" cap (384 MB on iOS 15, `getContext` → null) was removed from WebKit in commit 265628@main (2023-06-29): "we've decided to remove the canvas limit and just let the page follow the same memory restrictions as all other Web features. This might mean more pages crash (jetsam) than break." So on current Safari, too much canvas memory kills or reloads the tab (jetsam). `getContext` does not return null for this reason. Keep the budget advice, and change the failure mode. The other numbers are verified against canvas-size docs: Chrome 73+ desktop 65,535 side / 16,384² area; Firefox 122+ 32,767 side / 23,168² area.
- Evidence: https://github.com/WebKit/WebKit/commit/d1f63c061eadee6c83dc9fa06a2725c3d099a86b ; https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/CanvasBase.cpp (`maxCanvasArea()`) ; https://github.com/WebKit/WebKit/commit/6bd11f3792f05b4e58e5647bf173212879fa62cc ; https://lionpuro.com/posts/canvas-is-finally-usable-on-safari/ (third-party, iOS 18.0 test) ; https://github.com/jhildenbiddle/canvas-size (docs table) ; https://pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit/ (2022-01-12).

### Release canvases explicitly when a chart or panel is destroyed
- Verdict: corrected
- Correction: Keep the Do. Replace the Why: "WebKit does not reclaim canvas memory at once when you drop the reference; it waits for GC (WebKit commit 265628@main). The old 'Total canvas memory use exceeds the maximum limit' error was removed in 2023, so on current Safari the risk is a jetsam tab kill, not a null context. Shrinking to 0×0 or 1×1 frees the backing store immediately." The pqina fix is 1×1 plus `clearRect`, from 2022-01-12. The MDN WebGL "Lose contexts eagerly" is verified.
- Evidence: https://github.com/WebKit/WebKit/commit/6bd11f3792f05b4e58e5647bf173212879fa62cc ; https://pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit/ ; https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices.

### Export charts with `toBlob`/`convertToBlob`, not `toDataURL`
- Verdict: verified
- Evidence: Spec toBlob: "set result to a copy of this canvas element's bitmap. Run these steps in parallel: ... serialization". convertToBlob: "Let bitmap be a copy ... Run these steps in parallel". BCD `convertToBlob`: Chrome 69, Firefox 105, Safari 16.4; WebP type not in Safari (web-features per-key baseline false, Chrome/Firefox only).

### Do not depend on HTML-in-canvas yet; track it for accessible chart labels
- Verdict: corrected
- Correction: Status: the origin trial started in Chrome 148 (first run 148-150). It was extended through Chrome 154 and then extended again through Chrome 160 (chromestatus feature 5172548013916160, updated 2026-09-08; the OT stage lists extensions ending at 154 and 160). Chrome status is "In development", with no ship milestone. The flag `chrome://flags/#canvas-draw-element` and Finch name `CanvasDrawElement` are verified. web-features `canvas-html`: baseline false, no support. On API names: the Chrome post (2026-05-19) uses `layoutsubtree`, `drawElementImage()`, `texElementImage2D()`, `copyElementImageToTexture()`, a `paint` event, and `getElementTransform()`. The WICG README on `main` now uses `drawable`, `texElementSubImage2D`, and `drawElementImageToTexture`. So the names are not final.
- Evidence: https://chromestatus.com/feature/5172548013916160 (API JSON saved as `raw/verify/12/cs-5172548013916160.json`) ; https://developer.chrome.com/blog/html-in-canvas-origin-trial ; https://github.com/WICG/html-in-canvas/blob/main/README.md ; `raw/verify/12/rt.json5` (`CanvasDrawElement`, `origin_trial_feature_name: "HTMLInCanvas"`, status experimental).

---

## Cross-file conflicts

1. **SciChart label cache and fonts: 12 vs 13-scichart.md.** 12 says `useSharedCache` is off by default, keeps labels "one minute", and native text is "only Arial by default" (v4 docs). 13-scichart.md:368-370, 722-727 says (source-verified, which I confirmed) `useSharedCache = true` since 4.0.933 and the v5 default native font is Arimo. 13 is right. Update 12 §C items 5-6.
2. **`img.decode()` Baseline date: 12 and 01-critical-rendering-path.md:792 share the same error.** Both say "Baseline widely available since 2020-01". Correct: newly 2020-01-15, widely 2022-07-15. 02-course-loading.md:872 ("Both widely available") and 04:376 have no dates and are fine.
3. **2D vs WebGL context-loss semantics (risk of a merged rule).** 10-gpu-webgl.md:217 says to call `preventDefault()` on `webglcontextlost` "otherwise no restore event comes". For 2D `contextlost`, `preventDefault()` does the opposite: it cancels the restore (HTML context lost steps; MDN). 12 does not say this. A skill rule that merges both would break 2D restore.
4. **SciChart worker rendering: 12 vs 15-gaps-round-1.md:708-715.** 12 F1 says "Whether SciChart.js can run in a worker was not checked". 15-gaps-round-1 says v5.2.69 has no worker or OffscreenCanvas rendering path (it has a main-thread WebGL context and shared-context monitoring). Use 15's answer. 07-js-web-apis.md:1031 has the same open question.
5. **Clearing by resize: 12 vs MDN Optimizing canvas (the source 12 cites).** MDN still lists "resizing the canvas" as a clear method to try. 12 says never do it. 12 is better supported by the spec (resize = full context reset + reallocation). Flag the source tension so the skill does not cite MDN for the opposite claim.
6. **No conflict, consistent:** `alpha:false` for WebGL (10:63-70), `devicePixelContentBoxSize` status (10:159), ImageBitmap unpack flags ignored (10:738), premultiplied canvas uploads (10:749-750), createImageBitmap Baseline dates (07:288, 04:376), OffscreenCanvas statuses (01:969, 07:269), MAX_TEXTURE_SIZE 4096 / 86% at 16384 (10:796).

## Missing but important

1. **Chrome canvas hibernation in hidden tabs.** Accelerated 2D canvases in a hidden page are snapshotted to CPU memory after a random delay of up to `kMaxHibernationDelay = base::Minutes(4)`, and compressed (zlib or zstd, `kCanvasHibernationSnapshotZstd`) after `kBeforeCompressionDelay = base::Minutes(5)`. For a trading app left in a background tab, the first frame after the tab returns pays decompression and re-upload. Redraw on `visibilitychange` and do not treat that first frame as a regression. Source: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/canvas_hibernation_handler.h (saved `raw/verify/12/canvas_hibernation_handler.h:85-92`).
2. **`PointerEvent.getPredictedEvents()` for crosshair and drawing-tool latency.** Chrome 77, Firefox 89, Safari 18.2; web-features `pointer-events-api` per-key Baseline newly available 2024-12-11. It is a cheaper latency win than `desynchronized`, and it works on all engines. Source: BCD `api.PointerEvent.getPredictedEvents`; `raw/verify/02/wf.json`.
3. **2D `contextlost` handler rules** (see cross-file conflict 3). Do not call `preventDefault()` unless you want to stay lost, and re-apply transform, font, and styles after `contextrestored`, because loss resets the context. Source: HTML "update the rendering" context lost steps (`raw/webappapis.txt`); https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/contextlost_event.
4. **Safari canvas readback noise** (a concrete engine for the hit-test caveat). WebKit injects noise into canvas readback under `NoiseInjectionPolicy::Minimal`/`Enhanced` (Advanced Fingerprinting Protection), so color-ID picking and pixel-exact tests can fail in Safari with that protection on. Source: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/CanvasBase.cpp (`canvasNoiseHashSaltIfNeeded`, `shouldInjectNoiseBeforeReadback`).
5. **iOS jetsam as the canvas-memory failure mode.** Since the total-canvas-memory cap was removed (WebKit 265628@main), too much canvas memory on iOS reloads the tab instead of returning a null context. Budget checks must be proactive, because there is no error to catch. Source: https://github.com/WebKit/WebKit/commit/6bd11f3792f05b4e58e5647bf173212879fa62cc.
