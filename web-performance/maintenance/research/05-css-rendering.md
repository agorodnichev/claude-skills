# CSS rules and properties that change rendering cost

Scope: CSS choices that change the cost of style, layout, paint, raster, and composite work, plus CSS delivery (critical CSS, `@import`, `media`), fonts for CLS, and scrolling. Status is checked as of 2026-09-22 against webstatus.dev and MDN browser-compat-data (BCD).
Sources: the web.dev rendering-performance set (compositor-only properties, layout thrashing, style calculation, paint complexity, content-visibility, animations guide and overview), MDN, developer.chrome.com, the Microsoft Edge selector-stats docs and blog, and Chromium, Firefox, and WebKit source files (read directly for current compositor data). Blogs used: CSS Wizardry, Smashing Magazine, Igalia, and Paul Irish's gist.

Legend for engine data: "Chromium source" means files on `chromium.googlesource.com` `main` or release `branch-heads`. "Firefox source" means searchfox or mozilla-firefox `main`. "WebKit source" means GitHub `WebKit/WebKit` `main`.

---

## A. Compositor-only animation

### Animate only properties that the compositor can run
- Layer: css
- Stage: composite, style, layout, paint
- Metrics: FPS/smoothness, INP, CLS
- When: animation/render-loop
- Impact: high. A compositor animation keeps running when the main thread is busy. A layout or paint animation does main-thread work on every frame.
- Do: Animate `transform`, the individual `translate`/`rotate`/`scale` properties, and `opacity`. Treat `filter` (only non-blur functions) and `backdrop-filter` as compositor-eligible in Chromium and WebKit only. Treat every other property as a main-thread animation unless the table below says otherwise.
- Why: The pipeline starts again at the first stage that a change touches. A layout change forces paint and composite, and a paint change forces composite. Compositor animations skip style, layout, and paint for each frame. Per-engine lists of compositor-animatable properties, from the source files (2026-09):

| Engine | Runs on compositor | Source |
|---|---|---|
| Chromium | `transform`, `translate`, `rotate`, `scale`, `opacity`, `filter` (fails if a keyframe has a pixel-moving filter such as `blur()` or `drop-shadow()`), `backdrop-filter`, `background-color` (Chrome 142+, with conditions), `clip-path` (Chrome 152+, with conditions), and custom properties only when a CSS Paint API worklet uses them | `compositor_animations.cc`, `runtime_enabled_features.json5` |
| Firefox | `transform`, `translate`, `rotate`, `scale`, `opacity`, `offset-path`, `offset-distance`, `offset-rotate`, `offset-anchor`, `offset-position`, `background-color` (pref `gfx.omta.background-color` defaults to true) | `ServoCSSPropList.h` `CanAnimateOnCompositor`, `StaticPrefList.yaml` |
| WebKit | always: `opacity`, `filter`, `backdrop-filter`, `transform`, `translate`, `scale`, `rotate`; "threaded-only": `offset-*` (needs threaded animation resolution, enabled in Safari Technology Preview 238) | `CSSProperties.json` `animation-wrapper-acceleration` |

- Example:
```css
/* Before: layout on every frame */
.toast { transition: top 200ms, height 200ms; }
/* After: compositor only */
.toast { transition: translate 200ms, opacity 200ms; }
.toast[hidden-state] { translate: 0 -12px; opacity: 0; }
```
- Avoid/caveats: The web.dev articles (2015) say "only transform and opacity". That was true for Chrome at the time and is still the only list that is safe in all engines. An animated property that the compositor cannot run makes the browser run that property on the main thread (Chromium reports failure reasons for each animation).
- Status: `transform`/`opacity` animations are universal. Individual transform properties are Baseline widely available (low date 2022-08-05, webstatus.dev).
- Sources: https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count ; https://web.dev/articles/animations-overview ; https://web.dev/articles/animations-guide ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.cc ; https://searchfox.org/mozilla-central/search?q=CanAnimateOnCompositor ; https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/css/CSSProperties.json

### Rewrite geometry animations as transform animations (FLIP, scaleX progress bars)
- Layer: css
- Stage: layout, paint, composite
- Metrics: FPS/smoothness, INP, CLS
- When: animation/render-loop, interaction
- Impact: high. Animating `width`, `top`, or `left` runs layout for the element and possibly for the whole document on each frame.
- Do: Move elements with `translate`/`transform`, not with `top`/`left`/`margin`. Grow bars with `scale`/`scaleX()` and a `transform-origin`, not with `width`. For layout changes (reorder, expand), measure the start and end boxes one time, then animate the difference with a transform (FLIP).
- Why: Transform changes do not change layout geometry, so they do not move other boxes. Lighthouse also notes that non-composited animations can add to CLS, and composited ones do not.
- Example:
```css
/* Before */ .fill { transition: width 150ms; }
/* After  */ .fill { width: 100%; transform-origin: 0 50%; transition: scale 150ms; }
```
```js
fill.style.scale = `${ratio} 1`; // ratio in [0, 1]
```
- Avoid/caveats: Text and borders inside a scaled box also scale. Use scaling only on plain fills, or counter-scale the children. Percentage `translate` values are composited in Chrome 89+ only when the box size does not change every frame.
- Status: Baseline (transform is universal).
- Sources: https://web.dev/articles/animations-guide ; https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations ; https://developer.chrome.com/blog/hardware-accelerated-animations

### Fade a pre-blurred layer instead of animating the blur radius
- Layer: css
- Stage: paint, raster, composite
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium. In Chromium, a `filter` keyframe with `blur()` or `drop-shadow()` fails the compositor check (`kFilterRelatedPropertyMayMovePixels`), and blur paint is expensive.
- Do: Keep the blur value constant on a layer and animate that layer's `opacity`. Keep `filter` animations to non-pixel-moving functions (`brightness()`, `contrast()`, `grayscale()`, `saturate()`, `opacity()`, `hue-rotate()`, `invert()`, `sepia()`).
- Why: Pixel-moving filters change the visual bounds of the layer, so Chromium cannot run them on the compositor. WebKit notes a related limit: an accelerated filter animation is only possible in some cases when `drop-shadow()` is the last function.
- Example:
```css
/* Before: blur radius animates, main thread + blur paint every frame */
.bg { transition: filter 300ms; } .stage.dim .bg { filter: blur(12px); }
/* After: a second, statically blurred copy stacked on top; only its opacity animates */
.bg-blurred { filter: blur(12px); opacity: 0; transition: opacity 300ms; }
.stage.dim .bg-blurred { opacity: 1; }
```
- Avoid/caveats: The constant blur still costs paint and raster one time. If the content behind the blur changes, the cost repeats (see the `backdrop-filter` item).
- Status: `filter` Baseline widely available. `backdrop-filter` Baseline newly available 2024-09-16 (webstatus.dev).
- Sources: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.h ; https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas ; https://www.mail-archive.com/webkit-changes@lists.webkit.org/msg210491.html (search summary only)

### Keep a composited animation eligible: avoid the known fallback conditions
- Layer: css
- Stage: composite, style
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: medium. A small detail can move a transform or opacity animation back to the main thread without any visible warning.
- Do: Use `composite: "replace"` (the default) and `iterationComposite: "replace"`. Do not use `animation-composition: add|accumulate` on hot animations. Do not animate a property that has an `!important` declaration. Do not mix `offset-*` motion paths with compositor animations in Chrome. Do not put `will-change: contents` on an ancestor. For SVG in Chrome, animate `transform`, not `translate`/`rotate`/`scale`. For WAAPI on custom properties, use the same value type in every keyframe.
- Why: Chromium lists these as `FailureReason` values: `kEffectHasNonReplaceCompositeMode`, `kEffectHasNonReplaceIterationCompositeMode`, `kAffectsImportantProperty`, `kTargetHasCSSOffset`, `kTargetHasInvalidCompositingState` (set by `will-change: contents` in the subtree), `kSVGTargetHasIndependentTransformProperty`, `kMixedKeyframeValueTypes`, and `kTimelineSourceHasInvalidCompositingState` (the scroller of a scroll timeline is not composited). Lighthouse reads the same failure reasons from the trace.
- Example:
```js
// Before: 'add' composite forces main-thread animation in Chromium
el.animate({ translate: ['0 0', '0 8px'] }, { duration: 300, composite: 'add' });
// After
el.animate({ translate: ['0 0', '0 8px'] }, { duration: 300 });
```
- Avoid/caveats: The list is Chromium-specific. Use the Lighthouse `non-composited-animations` diagnostic (still present in Lighthouse 13) or the DevTools Animations panel to check.
- Status: current Chromium `main` (2026-09).
- Sources: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.h ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.cc ; https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations ; https://developer.chrome.com/blog/lighthouse-13-0

### Do not rely on composited background-color or clip-path animations across browsers
- Layer: css
- Stage: paint, composite
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium. These animations are composited only in new Chrome releases and only under strict conditions. Other cases paint on every frame.
- Do: For a flash or highlight on a hot path (for example, price-tick cells), put the color on an overlay or pseudo-element and animate its `opacity`. Use `clip-path` animations for rare transitions only.
- Why: Chromium runs `background-color` (flag `CompositeBGColorAnimation`, "stable" from branch 142) and `clip-path` (flag `CompositeClipPathAnimation`, "stable" from branch 152) through a native paint worklet. Conditions from the source: only one animation of that property on the element; no positive `delay` for background-color; no underlying or additive effects; no pixel-moving filter between the element and its composited ancestor; for clip-path, only basic shapes or paths, `border-box` only, no `url()` reference clip paths, and no `shape()` arcs with different radii. Firefox composites `background-color`. WebKit composites neither.
- Example:
```css
/* Before: paints each frame in most engines */
.cell.flash { animation: flash 400ms; }
@keyframes flash { from { background-color: #1e7a3a; } }
/* After: opacity on an overlay */
.cell { position: relative; }
.cell::before { content: ""; position: absolute; inset: 0; background: #1e7a3a; opacity: 0; }
.cell.flash::before { animation: fade 400ms; }
@keyframes fade { from { opacity: 1; } to { opacity: 0; } }
```
- Avoid/caveats: The overlay adds a layer while it animates (memory, overlap). Keep overlays small. I found no release note for these two Chrome launches. The version numbers come only from the flag status in each release branch.
- Status: Chrome 142+ (bg-color) and Chrome 152+ (clip-path). Firefox: bg-color. Safari: no.
- Sources: https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7444/third_party/blink/renderer/platform/runtime_enabled_features.json5 ; https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7977/third_party/blink/renderer/platform/runtime_enabled_features.json5 ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/csspaint/nativepaint/native_css_paint_definition.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/csspaint/nativepaint/background_color_paint_definition.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/csspaint/nativepaint/clip_path_paint_definition.cc ; https://developer.chrome.com/blog/hardware-accelerated-animations

### Use CSS animations or WAAPI, not per-frame style writes, and do not animate custom properties on hot paths
- Layer: css, js
- Stage: main-thread-task, style, composite
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: high for busy pages. A `requestAnimationFrame` loop that writes `style.transform` needs the main thread for every frame. A declared CSS or WAAPI animation of `transform`/`opacity` does not.
- Do: Declare fixed-path animations with CSS `@keyframes`, transitions, or `element.animate()`. Keep `requestAnimationFrame` for values that are computed from live input. Do not animate registered custom properties (for example, `--angle` for a rotating gradient) on elements that must stay smooth.
- Why: CSS animations and Web Animations are usually handled on the compositor thread. Custom property animations (registered or not) run on the main thread in Chromium. They are composited only when a CSS Paint API worklet uses them.
- Example:
```js
// Before: main thread every frame
function tick(t) { dot.style.transform = `translateX(${(t / 5) % 300}px)`; requestAnimationFrame(tick); }
// After: compositor
dot.animate({ transform: ['translateX(0)', 'translateX(300px)'] }, { duration: 1500, iterations: Infinity });
```
- Avoid/caveats: If the animation triggers layout or paint, CSS versus JS does not matter much, because the rendering work is larger than the script work (web.dev).
- Status: Web Animations Baseline widely available.
- Sources: https://web.dev/articles/animations-overview ; https://web.dev/blog/at-property-performance ; https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/CSS_JavaScript_animation_performance

### Drive scroll-linked effects with scroll-driven animations of composited properties
- Layer: css
- Stage: composite, main-thread-task
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: medium. `scroll` events arrive asynchronously and main-thread effects stutter. A scroll timeline that animates `transform`/`opacity` can stay off the main thread.
- Do: Use `animation-timeline: scroll()` or `view()` (or `new ScrollTimeline()`) for progress bars, parallax, and reveal effects. Animate `transform`/`opacity` only (for example, `scaleX` for a progress bar). Keep a JS fallback behind `@supports (animation-timeline: scroll())`.
- Why: Scroll-driven animations use the same Web Animations and CSS Animations model, so they can run off the main thread. In a Chrome demo, the CSS version was not affected by heavy JS and the scroll-listener version stuttered (Chrome 116+). Safari 26.4 runs scroll-driven animations on the compositor thread.
- Example:
```css
@supports (animation-timeline: scroll()) {
  #progress { transform-origin: 0 50%; animation: grow linear both; animation-timeline: scroll(block root); }
  @keyframes grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
}
```
- Avoid/caveats: Animating `width` with a scroll timeline brings back main-thread work. In Chromium, the animation falls back if the scroller is not composited.
- Status: limited availability. Chrome 115+ and Safari 26+. No Firefox release (webstatus.dev, 2026-09).
- Sources: https://developer.chrome.com/blog/scroll-animation-performance-case-study ; https://developer.chrome.com/docs/css-ui/scroll-driven-animations ; https://webkit.org/blog/17862/webkit-features-for-safari-26-4/ ; https://api.webstatus.dev/v1/features/scroll-driven-animations

### Keep view transitions small: short update callback, few named elements
- Layer: css, js
- Stage: main-thread-task, layout, composite, gpu-upload, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: interaction
- Impact: medium. The page is frozen until the update callback's promise resolves. Each named element becomes a snapshot and a composited layer.
- Do: Fetch data before you call `document.startViewTransition()`. Keep the callback to a DOM swap, and use a short timeout if you wait for fonts or images. Give `view-transition-name` only to the few elements that need their own motion. For many elements, prefer the root crossfade. When size does not change, keep old and new boxes the same size so the group animation stays a transform.
- Why: Chrome docs say the page is frozen while the callback runs. Snapshots come from the compositor (no extra layout or paint), and the old view stays visible for a few frames. The default `::view-transition-group` animates `width` and `height`, which runs layout per frame in Chrome ("optimization hasn't been implemented yet"). Chromium has the compositing reasons `kViewTransitionElement` and `kViewTransitionPseudoElement`.
- Example:
```js
const data = await fetchNextView();                 // before: page stays interactive
document.startViewTransition(() => render(data));   // callback: DOM swap only
```
- Avoid/caveats: `blocking="render"` for cross-document transitions delays first render, so measure it first. Snapshotting pages with thousands of named elements increases memory (blog claim, not measured here).
- Status: same-document transitions are Baseline newly available (2025-10-14). Cross-document transitions have limited availability (Chrome 126, Safari 18.2, no Firefox). Element-scoped transitions: Chrome 147 only.
- Sources: https://developer.chrome.com/docs/web-platform/view-transitions/same-document ; https://developer.chrome.com/blog/view-transitions-misconceptions ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing_reasons.h ; https://api.webstatus.dev/v1/features/view-transitions

### Remove non-essential motion for users who ask for reduced motion
- Layer: css
- Stage: style, layout, paint, composite
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: low. Less animation means less rendering work on low-power devices.
- Do: Put decorative animations inside `@media (prefers-reduced-motion: no-preference)`. Cut animations that do not carry meaning.
- Why: Every animation that is not on the compositor adds work to each frame. MDN recommends fewer animations and a user control on low-power devices.
- Example:
```css
@media (prefers-reduced-motion: no-preference) { .ticker { animation: slide 20s linear infinite; } }
```
- Avoid/caveats: Keep feedback animations short. Do not remove state feedback.
- Status: Baseline widely available.
- Sources: https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/CSS

---

## B. Compositing layers and GPU memory

### Promote only elements that will animate, only while they animate
- Layer: css, gpu
- Stage: composite, raster, gpu-upload, gc-memory
- Metrics: memory, FPS/smoothness
- When: animation/render-loop, long-lived session
- Impact: high on memory-limited devices. Each layer is a GPU texture of about width × height × 4 bytes × DPR².
- Do: Set `will-change: transform` (or `opacity`) just before a known change, for example on `pointerenter` or when a drag starts. Set it back to `auto` when the animation ends. Put it in a stylesheet only for elements that change often (sliding panels, a drag layer). Never use `* { will-change: transform }` or `translateZ(0)` on many elements.
- Why: Every layer needs memory and management, and its texture must be uploaded to the GPU. Example math (Smashing, blog): 10 images of 800×600 with `will-change: transform` need 800 × 600 × 4 × 10 ≈ 19 MB, before the DPR multiplier. `will-change` applies to the whole subtree, and the browser keeps the optimization for as long as the property is set.
- Example:
```js
panel.addEventListener('pointerdown', () => { panel.style.willChange = 'transform'; });
panel.addEventListener('transitionend', () => { panel.style.willChange = 'auto'; });
```
- Avoid/caveats: MDN calls `will-change` a last resort for existing problems. `will-change: opacity` (and others) creates a stacking context immediately. Animated `transform`/`opacity` already counts as `will-change` during the animation, so do not add it inside `@keyframes`.
- Status: `will-change` is Baseline widely available (2020-01-15).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/will-change ; https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count ; https://www.smashingmagazine.com/2016/12/gpu-animation-doing-it-right/ ; https://api.webstatus.dev/v1/features/will-change

### Prevent layer explosion from overlap (implicit compositing)
- Layer: css, gpu
- Stage: composite, raster, gc-memory
- Metrics: memory, FPS/smoothness
- When: animation/render-loop, long-lived session
- Impact: medium. Content painted above a composited layer may need its own layer. This can create many unplanned layers, repaints at the start and end of animations, and flicker.
- Do: Put animated or promoted elements high in the stacking order (for example, in a portal near `body`), so fewer elements paint above them. Check the DevTools Layers panel for layers whose reason is "overlap".
- Why: Chromium lists `kOverlap` as a compositing reason that it decides after paint. Smashing (2016, blog) describes how elements above a composited layer get promoted too, and how each promotion or demotion repaints.
- Example:
```html
<!-- Before: animated tooltip under many siblings that paint above it -->
<!-- After: render the tooltip in a top-level layer container -->
<div id="overlay-root" style="position: fixed; inset: 0; pointer-events: none; z-index: 1000"></div>
```
- Avoid/caveats: Chromium now "squashes" many overlapping elements into shared layers, so the effect is smaller than in 2016. Measure before you restructure.
- Status: engine behavior (current Chromium `main`).
- Sources: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing_reasons.h ; https://www.smashingmagazine.com/2016/12/gpu-animation-doing-it-right/

### Know which CSS creates a compositing layer, and do not add one by accident
- Layer: css, gpu
- Stage: composite, gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium.
- Do: Expect a layer from these Chromium reasons: 3D transforms (including `translateZ(0)` = `kTrivial3DTransform`), active transform/opacity/filter/backdrop-filter animations, `will-change` on `transform`/`scale`/`rotate`/`translate`/`opacity`/`filter`/`backdrop-filter`/`clip-path`/`mix-blend-mode`/`mask`, `position: fixed`, `position: sticky`, anchor positioning, `backdrop-filter`, `<video>`, accelerated `<canvas>`, `<iframe>`, composited overflow scrolling, `backface-visibility: hidden`, and view-transition names. Remove old "force GPU" hacks (`translateZ(0)`, `backface-visibility: hidden`) that no measured problem needs.
- Why: Each reason adds a texture and management cost. The web.dev note says fixed elements are promoted automatically on high-DPI screens. On low-DPI screens they are not, because promotion changes text from subpixel to grayscale anti-aliasing.
- Example:
```css
/* Before: legacy hack on every card */ .card { transform: translateZ(0); }
/* After: nothing, or will-change only on the card being dragged */ .card.dragging { will-change: transform; }
```
- Avoid/caveats: The reason list is Chromium-internal and changes between versions. Firefox and Safari have their own heuristics. Safari's Web Inspector Layers sidebar shows memory per layer.
- Status: Chromium `main`, 2026-09.
- Sources: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing_reasons.h ; https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas ; https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/CSS

### Do not keep `will-change: transform` on content you zoom by script if it must stay sharp
- Layer: css, gpu
- Stage: raster
- Metrics: FPS/smoothness
- When: interaction, animation/render-loop
- Impact: low to medium. This is a trade-off between speed and sharpness.
- Do: While a script-driven scale gesture runs, keep `will-change: transform` for speed. When the gesture ends, remove it (or set it again) so that Chrome re-rasters at the final scale.
- Why: Since Chrome 53, content re-rasters when its transform scale changes, unless it has `will-change: transform` or an accelerated animation. With the hint, Chrome keeps the old raster and scales it, so text can look blurry.
- Example:
```js
zoomLayer.style.willChange = 'transform';        // during pinch
onGestureEnd(() => { zoomLayer.style.willChange = 'auto'; }); // crisp re-raster
```
- Avoid/caveats: Removing the hint causes one full raster of the layer. Do not toggle it every frame.
- Status: Chrome 53+ behavior (chromestatus 5637351992721408).
- Sources: https://chromestatus.com/feature/5637351992721408

### Keep layer textures small (scale up a small layer when quality allows)
- Layer: css, gpu
- Stage: raster, gpu-upload, gc-memory
- Metrics: memory
- When: animation/render-loop
- Impact: low. This is useful only for solid or blurry layers such as scrims and glows.
- Do: For a large solid or blurry composited layer, make the box small and enlarge it with `transform: scale()`.
- Why: The texture size follows the box size before the transform. A 10×10 layer scaled ×10 uses 400 bytes, but a 100×100 layer uses 40,000 bytes (Smashing, blog).
- Example:
```css
.scrim { width: 10vw; height: 10vh; transform: scale(10); transform-origin: 0 0; will-change: transform; }
```
- Avoid/caveats: Detailed content becomes blurry. Do not use this for text or chart content.
- Status: technique (no API).
- Sources: https://www.smashingmagazine.com/2016/12/gpu-animation-doing-it-right/

---

## C. Containment and skipped rendering

### Put `contain: content` on independent widgets, and `contain: strict` plus a size on fixed panels
- Layer: css
- Stage: style, layout, paint
- Metrics: INP, FPS/smoothness
- When: interaction, long-lived session
- Impact: high for dense UIs. A change inside a contained subtree does not relayout or repaint the rest of the document.
- Do: Add `contain: content` (= `layout paint style`) to cards, list rows, dashboard tiles, and third-party slots whose contents never overflow on purpose. Add `contain: strict` (= `size layout paint style`) with an explicit `width`/`height` or `contain-intrinsic-size` to panels whose size the page sets, for example a chart panel in a grid or a drawer.
- Why: Layout is usually scoped to the whole document. Containment tells the engine that the subtree is an island. Measured (CSS Wizardry, 2026): opening a dropdown in a drawer went from 11.21 ms of layout rooted at `#document` (4,371 nodes visited, 41 relaid) to 1.89 ms rooted at the drawer (73 nodes) after `contain: strict` on the drawer root.
- Example:
```css
.tile { contain: content; }
.chart-panel { contain: strict; width: 100%; height: 420px; }
```
- Avoid/caveats: `layout`/`paint` containment creates a stacking context, a containing block for `fixed`/`absolute` children, and a block formatting context. Tooltips, dropdowns, and shadows that must overflow are clipped. Size containment without a size makes the box 0 px. Do not put it on page-level wrappers or small inline elements. BCD lists the `style` keyword only from Safari 27, but webstatus.dev lists style containment as widely available. Do not depend on `style` containment for behavior in older Safari.
- Status: `contain` is Baseline widely available (low date 2022-03-14). `inline-size` is widely available (2022-09-12).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/contain ; https://csswizardry.com/2026/04/what-is-css-containment-and-how-can-i-use-it/ ; https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing ; https://api.webstatus.dev/v1/features/contain

### Skip offscreen sections with `content-visibility: auto` and `contain-intrinsic-size: auto <length>`
- Layer: css
- Stage: style, layout, paint
- Metrics: startup, LCP, INP, CLS
- When: load, long-lived session
- Impact: high on long pages. web.dev's demo went from 232 ms to 30 ms of initial rendering (7×).
- Do: Split long content into sections and give each section `content-visibility: auto` with `contain-intrinsic-size: auto <estimate>`. Do not call layout-reading APIs (`getBoundingClientRect`, `offsetHeight`, `getComputedStyle`) on skipped subtrees. Add `aria-hidden="true"` to offscreen landmarks that are hidden with `display: none`, because skipped styles do not apply to the accessibility tree.
- Why: Off-screen `auto` elements get size containment, and the engine skips style, layout, paint, and hit-testing of their subtrees. The `auto` keyword makes the engine remember the last rendered size, so scrollbars stop jumping after the first render.
- Example:
```css
.feed-section { content-visibility: auto; contain-intrinsic-size: auto 640px; }
```
- Avoid/caveats: Without an intrinsic size, sections are 0 px tall, so scrollbars jump and you get layout shifts. Chromium prints verbose console messages when an API forces rendering of a `content-visibility: hidden` subtree. Sections that are always in the first viewport gain nothing.
- Status: `content-visibility` is Baseline newly available (2025-09-15). The `auto` value arrived in Safari 26 (BCD), so it is not in Safari 18 to 25. `contain-intrinsic-size` is Baseline widely available (low date 2023-09-18).
- Sources: https://web.dev/articles/content-visibility ; https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility ; https://developer.mozilla.org/en-US/docs/Web/CSS/contain-intrinsic-size ; https://api.webstatus.dev/v1/features/content-visibility ; https://bcd.developer.mozilla.org/bcd/api/v0/current/css.properties.content-visibility.json

### Hide inactive views with `content-visibility: hidden`, not `display: none`, when you will show them again soon
- Layer: css
- Stage: style, layout, paint
- Metrics: INP
- When: interaction, long-lived session
- Impact: medium. Showing the view again reuses cached rendering state.
- Do: For SPA tabs or workspace layouts that users switch between, use `content-visibility: hidden` on the inactive container. Use `display: none` for content that rarely comes back.
- Why: `display: none` destroys rendering state, so showing the element again costs as much as a first render. `visibility: hidden` keeps the state but still updates it and keeps geometry. `content-visibility: hidden` keeps state and skips updates until the element is shown. Facebook reported up to 250 ms faster return navigations to cached views.
- Example:
```css
.workspace[data-active="false"] { content-visibility: hidden; }
```
- Avoid/caveats: Hidden content is not findable or focusable (like `display: none`). The element still takes its box space unless you also size it or take it out of flow.
- Status: `hidden` is available since Chrome 85, Firefox 125, and Safari 18 (BCD).
- Sources: https://web.dev/articles/content-visibility ; https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility

### Stop canvas and WebGL render loops for charts that the browser skips
- Layer: css, js, canvas2d, gpu
- Stage: gpu-draw, main-thread-task
- Metrics: FPS/smoothness, INP, memory
- When: long-lived session
- Impact: high for multi-chart dashboards. An offscreen chart that keeps drawing uses the main thread and the GPU for nothing.
- Do: Wrap each chart in a `content-visibility: auto` section. Listen for `contentvisibilityautostatechange` and pause the chart's draw loop while `event.skipped` is true. Resume it when `skipped` is false.
- Why: MDN describes this event as the way to start or stop rendering work, such as canvas drawing, when the content is skipped.
- Example:
```js
section.addEventListener('contentvisibilityautostatechange', (e) => {
  e.skipped ? chart.suspendRendering() : chart.resumeRendering(); // your chart's pause API
});
```
- Avoid/caveats: The event needs `content-visibility: auto` on that element. Where it is not supported, use `IntersectionObserver`. The pause and resume method names depend on the chart library. Check the SciChart API before you use them.
- Status: event in Chrome 108, Firefox 130, and Safari 18 (BCD).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility ; https://bcd.developer.mozilla.org/bcd/api/v0/current/api.Element.contentvisibilityautostatechange_event.json

### Use `container-type: inline-size`, and do not resize query containers on every frame
- Layer: css
- Stage: style, layout
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium. A change in container size makes the engine re-run style for the dependent subtree between layout passes.
- Do: Prefer `container-type: inline-size` over `size`. Make only the components that need queries into containers. Do not animate a query container's size, and do not drag-resize it without throttling. During a drag, resize with a transform preview and commit the final size once.
- Why: A container query makes style depend on the laid-out size of an ancestor, so Blink must interleave style recalc and layout (BlinkNG). The spec says `size` applies style and size containment, and `inline-size` applies style and inline-size containment. Neither applies layout containment. (The CSS Wizardry article says layout containment applies; the spec text does not.)
- Example:
```css
.widget { container-type: inline-size; }
@container (width < 360px) { .widget .legend { display: none; } }
```
- Avoid/caveats: `container-type: size` makes the box ignore its children for height, so it needs an explicit height. I found no primary benchmark of container-query cost. Treat the cost as proportional to the dependent subtree.
- Status: size container queries are Baseline widely available (low date 2023-02-14). Style queries are Baseline newly available (2026-05-19).
- Sources: https://developer.chrome.com/docs/chromium/blinkng ; https://drafts.csswg.org/css-conditional-5/ ; https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/container-type ; https://api.webstatus.dev/v1/features/container-queries

---

## D. Style recalculation scope

### Write simple, targeted selectors, then check the costly ones with Selector Stats
- Layer: css, tooling
- Stage: style
- Metrics: INP, FPS/smoothness
- When: interaction, testing
- Impact: medium. Selector matching is about half of Blink's style-computation time. The worst case is elements × selectors.
- Do: Prefer one class per rule (`.final-box-title`) over long descendant chains and positional pseudo-classes. Remove accidental universal selectors: `.meta ::selection` (with a space) means `.meta *::selection`. Replace substring attribute selectors (`[class*="icon-"]`) with real classes. Replace `html[dir=rtl] ...` overrides with logical properties. Then record a trace with Selector Stats turned on. Fix the selectors with high Elapsed time, many Match Attempts, few matches, and a high "% of slow-path non-matches".
- Why: Engines match right to left. Long chains and substring checks do more work for each candidate element. In the Edge case study (about 5,000 elements, CPU slowed 4×), a Recalculate Style of about 900 ms dropped to about 300 ms after these fixes.
- Example:
```css
/* Before */ .gallery .photo .meta li strong:empty { margin-left: .125rem; }
/*           html[dir="rtl"] .gallery .photo .meta li strong:empty { margin-right: .125rem; } */
/* After  */ .photo-meta-value:empty { margin-inline-start: .125rem; }
```
- Avoid/caveats: The Edge team warns against blind rules and linting: measure the scenario that matters, because the gain depends on DOM size and how often the DOM changes. Selector Stats adds overhead to traces, so turn it off after use.
- Status: Selector Stats is in Chrome DevTools and Edge DevTools (Edge 109+). Edge has an "Invalidation count" column.
- Sources: https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations ; https://learn.microsoft.com/en-us/microsoft-edge/devtools/performance/selector-stats ; https://blogs.windows.com/msedgedev/2023/01/17/the-truth-about-css-selector-performance/ ; https://developer.chrome.com/docs/devtools/performance/selector-stats

### Toggle state on the smallest element that needs it
- Layer: css, js
- Stage: style
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium to high. A class or attribute change on `html`, `body`, or a large container can invalidate every descendant that a rule like `.state .x` matches.
- Do: Put frequently changing classes, attributes, and `:hover` rules on the leaf element that changes (the row, the cell, the button). Do not write rules such as `.grid:hover .cell` or `body.dragging .item` for high-frequency states. Keep global classes (theme, density) for rare changes.
- Why: Blink compiles each rule into invalidation sets. When `c1` is added to an element, a rule `.c1 .c2` marks all `.c2` descendants for recalc. Blink uses dynamic restyle flags for `:hover`, so only elements whose rules actually test `:hover` react.
- Example:
```css
/* Before */ .book:hover .row { background: var(--row-hover); }
/* After  */ .row:hover { background: var(--row-hover); }
```
- Avoid/caveats: Engines err on the side of correctness, so some extra elements are always invalidated. Check the element count shown on each Recalculate Style event in DevTools.
- Status: engine behavior (Blink documentation).
- Sources: https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/css/style-invalidation.md ; https://blogs.igalia.com/blee/posts/2023/05/31/how-blink-invalidates-styles-when-has-in-use.html

### Do not style frequently-mutated lists with `:nth-child()` or sibling combinators
- Layer: css
- Stage: style
- Metrics: INP, FPS/smoothness
- When: long-lived session, animation/render-loop
- Impact: medium to high for streaming lists (order books, trade tapes, logs). Each insertion can restyle every following sibling.
- Do: For zebra stripes or "first N" styling, put a class on the row when you render it, or paint stripes with a repeating background on the container. Do not use `+`/`~` combinators across rows that are inserted and removed often.
- Why: When a rule tests `:nth-child()`, Blink sets an `:nth` flag on the parent. After that, inserting an element invalidates all of its next siblings. Prepending a row at the top of a 500-row list therefore restyles about 500 rows.
- Example:
```css
/* Before */ .tape > .row:nth-child(odd) { background: var(--stripe); }
/* After  */ .tape { background: repeating-linear-gradient(var(--stripe) 0 24px, transparent 24px 48px); }
/* (row height fixed at 24px) */
```
- Avoid/caveats: The gradient trick needs a fixed row height. A render-time class is the general fix.
- Status: Blink behavior (Igalia, 2023).
- Sources: https://blogs.igalia.com/blee/posts/2023/05/31/how-blink-invalidates-styles-when-has-in-use.html

### Anchor `:has()` to narrow containers and limit its argument
- Layer: css
- Stage: style
- Metrics: INP
- When: interaction, long-lived session
- Impact: medium. A broad `:has()` makes every DOM change inside the anchor's subtree re-check the condition.
- Do: Do not use `body:has()`, `:root:has()`, or `*:has()`. Anchor to a specific component (`.panel:has(...)`). Limit the argument with `>` or `+` (`:has(> .x)`). Do not end arguments with `*` or broad descendant parts (`:has(.foo > *)`).
- Why: For `A:has(B)`, the engine walks the subtree of A (and sometimes ancestors) when elements that match B change. Blink limits this with mutation filters and flags, but a broad anchor or argument removes the benefit.
- Example:
```css
/* Before */ :root:has(.modal.open) { overflow: hidden; }
/* After  */ .app-shell:has(> .modal.open) { overflow: hidden; }
```
- Avoid/caveats: MDN notes these costs may drop as engines improve, but the main limit stays the same: keep the subtree small.
- Status: `:has()` is Baseline widely available (high date 2026-06-19).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/:has ; https://blogs.igalia.com/blee/posts/2023/05/31/how-blink-invalidates-styles-when-has-in-use.html ; https://api.webstatus.dev/v1/features/has

### Keep fast-changing custom properties off `:root`, and register them with `inherits: false`
- Layer: css, js
- Stage: style
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: high when the value changes at pointer or tick rate (crosshair position, live price, scroll progress).
- Do: Set per-frame custom properties on the element that uses them, not on `:root`/`html`. Register them with `@property` and `inherits: false`. Keep theme tokens on `:root` only for rare changes.
- Why: Unregistered custom properties always inherit, so a change on `:root` restyles the whole document. Chrome benchmark (M1 Pro, about 1,000-node tree): an inherited property change cost about 3.9 ms per run. A registered `inherits: false` property cost about 4.7 µs per run, roughly 850× faster. Registration adds almost nothing (about 0.06 ms). 25,000 registrations cost about 30 ms one time.
- Example:
```css
@property --cursor-x { syntax: "<length>"; inherits: false; initial-value: 0px; }
.crosshair { translate: var(--cursor-x) 0; }
```
```js
crosshair.style.setProperty('--cursor-x', `${x}px`); // not document.documentElement
```
- Avoid/caveats: With `inherits: false`, children do not see the value. Set it on each consumer, or use a direct `transform` write instead. Custom property animations still run on the main thread.
- Status: registered custom properties are Baseline newly available (2024-07-09).
- Sources: https://web.dev/blog/at-property-performance ; https://api.webstatus.dev/v1/features/registered-custom-properties

### Reduce the number of elements that match style rules
- Layer: css, html
- Stage: style, layout
- Metrics: INP, startup
- When: load, interaction
- Impact: medium. Style cost grows with the number of elements that must be checked. web.dev calls this often more important than selector complexity.
- Do: Keep the DOM small (virtualize long lists, remove hidden duplicates). Do not add broad rules that set many properties on every element (`body * { ... }`). Let inherited properties such as `font-size` inherit instead of setting them on every node.
- Why: Worst-case style cost is about the number of elements × the number of selectors. Shadow DOM scopes styles to each component tree.
- Example:
```css
/* Before */ body * { font-size: 14px; }
/* After  */ body { font-size: 14px; }
```
- Avoid/caveats: The Edge case study removed `* { box-sizing: border-box }` for a gain on a 5,000-element page. That is case-specific. Measure before you drop common resets.
- Status: general guidance.
- Sources: https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations ; https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/CSS ; https://blogs.windows.com/msedgedev/2023/01/17/the-truth-about-css-selector-performance/

### Apply `text-wrap: balance` only to short headings
- Layer: css
- Stage: layout
- Metrics: INP, startup
- When: load
- Impact: low. Balancing runs several line-breaking iterations for each block.
- Do: Set `text-wrap: balance` on headings, captions, and blockquotes only. Use `text-wrap: pretty` for body paragraphs where the look matters.
- Why: Chromium balances only blocks of six lines or fewer. Setting it everywhere wastes work and "may impact page render speed" (Chrome docs).
- Example:
```css
/* Before */ * { text-wrap: balance; }
/* After  */ h1, h2, h3, figcaption { text-wrap: balance; }
```
- Avoid/caveats: Text in live-updating cells does not need balancing.
- Status: `text-wrap: balance` is Baseline newly available (2024-05-13). `text-wrap: pretty` has limited availability (Chrome 117, Safari 26).
- Sources: https://developer.chrome.com/docs/css-ui/css-text-wrap-balance ; https://developer.chrome.com/blog/css-text-wrap-pretty ; https://api.webstatus.dev/v1/features?q=text-wrap

---

## E. Layout

### Batch layout reads before style writes (no forced synchronous layout)
- Layer: js, css
- Stage: style, layout, main-thread-task
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: high. A read after a write forces style and layout in the middle of script. In a loop, this repeats for each item (layout thrashing).
- Do: Read all geometry first (the previous frame's values are free), then write. Cache values outside loops. Do not read after a write in the same task. Watch for forcing APIs: `offset*`, `client*`, `getBoundingClientRect()`, `getClientRects()`, `scroll*` (read or set), `scrollTo/By/IntoView()`, `focus()`, `innerText`, `window.scrollX/Y`, `elementFromPoint()`, and `getComputedStyle()` for geometry properties (Paul Irish's list).
- Why: The browser must apply pending style changes and run layout to return a correct value. Chrome DevTools has a "Forced reflow" insight, and LoAF script entries report `forcedStyleAndLayoutDuration` in the field.
- Example:
```js
// Before: read/write interleaved
for (const p of paras) p.style.width = `${box.offsetWidth}px`;
// After: one read, many writes
const w = box.offsetWidth; for (const p of paras) p.style.width = `${w}px`;
```
- Avoid/caveats: `ResizeObserver` gives sizes without a forced layout, after layout runs.
- Status: general. LoAF is Chromium-only.
- Sources: https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing ; https://gist.github.com/paulirish/5d52fb081b3570c81e3a

### Know which property changes cause layout, paint, or only property-tree updates (current Blink data)
- Layer: css
- Stage: style, layout, paint, composite
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: high as a decision aid.
- Do: On interaction paths, prefer changes in the last two groups below. Treat the first group as layout work for the element's containing layout scope.
- Why: Blink's `css_properties.json5` lists an `invalidate` field for each property (2026-09 `main`):

| Group | Examples (Blink `invalidate` value) |
|---|---|
| Layout (then paint) | `width`, `height`, `margin-*` (layout, scroll-anchor); `padding-*`, `line-height`, `display`, `flex-grow`, `grid-template-columns`, `row-gap`, `column-gap`, `text-shadow`, `overflow-x` (layout, paint); `top`/`left` (inset, scroll-anchor); `position`; `container-type`, `contain`, `content-visibility` (layout); `text-transform` (reshape) |
| Paint only | `box-shadow` (paint, visual-overflow); `background-color`; `color`; `border-*-radius` (border-radius, paint); `outline-*`; `visibility`; `fill`/`stroke`; `image-rendering`; `object-fit`/`object-position`; `mix-blend-mode`; `isolation` |
| Property trees / compositing | `transform`, `translate`, `rotate`, `scale`, `transform-origin`, `perspective`, `offset-path`/`offset-distance` (transform data); `opacity`; `filter` (filter-data); `backdrop-filter`, `will-change`, `backface-visibility` (compositing); `clip-path`; `z-index` |

- Example:
```css
/* Hover lift. Before: layout */ .btn:hover { margin-top: -2px; }
/* After: transform only */      .btn:hover { translate: 0 -2px; }
```
- Avoid/caveats: `box-shadow` is paint-only and does not change layout. MDN's CSS performance page lists it among geometry-changing properties, which is inaccurate. Some properties (`font-size`, `letter-spacing`, `font-family`) are not listed with an `invalidate` field but affect text layout. csstriggers.com is from about 2016 and outdated. Use engine data and DevTools.
- Status: Chromium `main` (2026-09). Other engines differ in detail.
- Sources: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/css_properties.json5 ; https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas ; https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/CSS

---

## F. Paint and raster

### Make repaint areas small and separate
- Layer: css
- Stage: paint, raster
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, interaction
- Impact: medium. The browser can merge two dirty areas into one, so a small change at the top and one at the bottom can repaint the whole screen.
- Do: Keep continuously changing regions (tickers, blinking cursors, live cells) small and away from other changing regions. Give a region that repaints often its own layer only if profiling shows a gain. Check with Rendering → Paint flashing.
- Why: web.dev: browsers union the areas that need painting, so a fixed header plus a change at the bottom can repaint everything.
- Example:
```css
.live-clock { contain: paint; } /* keep its paint local */
```
- Avoid/caveats: Promotion also costs memory (see section B).
- Status: general.
- Sources: https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas ; https://web.dev/articles/animations-guide

### Do not repaint blur effects often (box-shadow, filter blur, text-shadow)
- Layer: css
- Stage: paint, raster
- Metrics: FPS/smoothness
- When: animation/render-loop, interaction
- Impact: medium. Anything with a blur costs more to paint than a solid box. An animated shadow repaints the blur on every frame.
- Do: Do not animate `box-shadow` or blur radii. Put the "raised" shadow on a pseudo-element and animate its `opacity`. Use small blur radii on elements that repaint often.
- Why: web.dev states that `background: red` and a blurred `box-shadow` look similar in CSS but differ greatly in paint cost. The paint profiler shows it.
- Example:
```css
.card { position: relative; }
.card::after { content: ""; position: absolute; inset: 0; border-radius: inherit;
  box-shadow: 0 8px 24px rgb(0 0 0 / .25); opacity: 0; transition: opacity 150ms; }
.card:hover::after { opacity: 1; }
```
- Avoid/caveats: The pseudo-element layer exists while it animates. The paint happens one time, not on each frame.
- Status: general.
- Sources: https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas ; https://web.dev/articles/animations-guide

### Do not place `backdrop-filter` over content that changes every frame
- Layer: css, gpu
- Stage: composite, gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop, long-lived session
- Impact: medium to high. The blur must run again each time the content behind it changes, for example when a chart redraws, a video plays, or a list scrolls.
- Do: Do not put frosted-glass toolbars or tooltips over live chart canvases, video, or scrolling feeds. Use a semi-opaque solid background there. If you keep it, make the area small and the blur radius small.
- Why: `backdrop-filter` is a compositing reason in Chromium, and the filter reads what is behind it. Field reports (issue trackers, not primary docs) show frame drops while scrolling and a 30% framerate gain after the blur was removed.
- Example:
```css
/* Before */ .chart-toolbar { backdrop-filter: blur(20px); background: rgb(20 20 20 / .4); }
/* After  */ .chart-toolbar { background: rgb(20 20 20 / .85); }
```
- Avoid/caveats: The evidence is from bug reports and blogs, not a vendor benchmark. Profile on target GPUs.
- Status: `backdrop-filter` is Baseline newly available (2024-09-16).
- Sources: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing_reasons.h ; https://github.com/vuejs/vitepress/issues/1049 ; https://bugzilla.mozilla.org/show_bug.cgi?id=1718471 ; https://api.webstatus.dev/v1/features/backdrop-filter

### Do not wrap animated layers or canvases in rounded `overflow: hidden` clips without need
- Layer: css, gpu
- Stage: composite, gpu-draw
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: low to medium. A rounded clip around composited content can need a separate render surface or a mask layer.
- Do: Round the corners of the composited element itself (`border-radius` on the canvas or the moving element), not of a clipping ancestor. Use uniform radii.
- Why: Chromium's compositor has a "fast rounded corner" path that tries to avoid a render surface (`is_fast_rounded_corner` in `cc/trees/effect_node.h`). If the fast path does not apply, it falls back to more expensive masks. Search-result summaries report that non-uniform radii on macOS need a mask layer. I did not confirm that claim in source.
- Example:
```css
/* Before */ .chart-frame { border-radius: 8px; overflow: hidden; } /* canvas inside */
/* After  */ .chart-frame canvas { border-radius: 8px; }
```
- Avoid/caveats: The evidence is partial (a source comment plus secondary summaries). Measure with DevTools Layers and the GPU rows of the performance trace.
- Status: Chromium internal behavior.
- Sources: https://chromium.googlesource.com/chromium/src/+/main/cc/trees/effect_node.h ; https://issues.chromium.org/issues/41321934

### Do not animate large gradient or image backgrounds, and do not ship oversized images
- Layer: css, network
- Stage: paint, raster, gpu-upload, gc-memory
- Metrics: FPS/smoothness, memory, LCP
- When: load, animation/render-loop
- Impact: medium.
- Do: Do not animate `background-position`, `background-size`, or gradient stops on large areas. Move a separate layer with `transform` instead. Serve background images near their displayed size.
- Why: Background changes are paint-only, but they repaint the whole painted area on every frame. Decoded images and textures take about width × height × 4 bytes, whatever the file size.
- Example:
```css
/* Before */ .hero { animation: pan 10s linear infinite; } @keyframes pan { to { background-position: 100% 0; } }
/* After  */ .hero::before { content: ""; position: absolute; inset: 0 -50% 0 0; background: url(bg.avif);
  animation: pan2 10s linear infinite; } @keyframes pan2 { to { transform: translateX(-33%); } }
```
- Avoid/caveats: The moving layer costs memory as big as its box.
- Status: general.
- Sources: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/css_properties.json5 ; https://www.smashingmagazine.com/2016/12/gpu-animation-doing-it-right/ ; https://developer.chrome.com/docs/chromium/renderingng-architecture

### Use `image-rendering: pixelated` for deliberately upscaled low-resolution canvases
- Layer: css, canvas2d
- Stage: composite
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low. This is mainly a quality lever. It lets you draw into a smaller backing store and scale it up without blur.
- Do: For heatmaps or pixel grids drawn at low resolution and enlarged with CSS, set `image-rendering: pixelated` (nearest neighbor). Keep the default for photos and anti-aliased chart lines.
- Why: `pixelated`/`crisp-edges` keep hard edges when scaling. `smooth` uses bilinear-type filtering. `high-quality` is defined but no browser supports it. `optimizeSpeed` is a legacy synonym for `pixelated`.
- Example:
```css
canvas.heatmap { width: 800px; height: 400px; image-rendering: pixelated; } /* backing store 200x100 */
```
- Avoid/caveats: I found no primary source that measures a speed difference between the scaling modes.
- Status: Baseline widely available (low date 2021-10-05).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering ; https://api.webstatus.dev/v1/features/image-rendering

---

## G. CSS delivery (load)

### Inline critical CSS and load the rest without blocking render
- Layer: css, html, build
- Stage: network, cssom, html-parse
- Metrics: FCP, LCP
- When: load, build
- Impact: medium to high on slow networks. Every stylesheet in `<head>` blocks first render.
- Do: Inline the styles for the first viewport in `<head>`, and aim to keep the first-round-trip content under about 14 KB compressed. Load the remaining CSS with `<link rel="preload" as="style" onload="this.onload=null;this.rel='stylesheet'">` plus a `<noscript>` fallback, or a `<link>` near the end of `<body>`. Generate critical CSS in the build (Critical, Penthouse, criticalCSS).
- Why: The browser must download and parse CSS before first render. Inlining removes a request. TCP slow start sends about 10 packets (about 14 KB) in the first round trip.
- Example:
```html
<style>/* critical: shell, header, first chart frame sizes */</style>
<link rel="preload" href="/app.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="/app.css"></noscript>
```
- Avoid/caveats: Inlined CSS is not cached across pages. Large inlines delay the HTML. A CSP can block inline `onload`. Deferred CSS can cause a flash of unstyled content (FOUC) and layout shifts if the critical set is wrong.
- Status: technique.
- Sources: https://web.dev/articles/extract-critical-css ; https://web.dev/articles/defer-non-critical-css ; https://web.dev/learn/performance/optimize-resource-loading

### Remove unused CSS and split CSS by route
- Layer: css, build
- Stage: network, cssom, style
- Metrics: FCP, LCP, bundle-size
- When: build, load
- Impact: medium. The browser downloads and parses all rules, including unused ones.
- Do: Use the DevTools Coverage panel to find large unused blocks. Move route-specific CSS into files loaded by that route, and delete dead rules.
- Why: Fewer rules means a shorter download and parse, and faster matching during style recalc.
- Example:
```html
<!-- Before: one 400 KB bundle on every page -->
<!-- After -->
<link rel="stylesheet" href="/core.css"><link rel="stylesheet" href="/trade-ticket.css">
```
- Avoid/caveats: web.dev says you should not expect zero unused CSS. Focus on big wins.
- Status: technique.
- Sources: https://web.dev/learn/performance/optimize-resource-loading ; https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/CSS

### Replace CSS `@import` with `<link>` elements
- Layer: css, html, build
- Stage: network, preload-scan, cssom
- Metrics: FCP, LCP
- When: load, build
- Impact: medium. Each `@import` adds a serial request that the preload scanner cannot see.
- Do: List stylesheets as `<link rel="stylesheet">` in HTML, or let the bundler inline `@import`s. If an `@import` is necessary (for example, a third-party sheet or a layer import), add `<link rel="preload" as="style">` for the imported file.
- Why: The browser finds an `@import` only after it downloads the parent sheet, so the requests form a chain, and the result is a late-discovered render-blocking resource.
- Example:
```css
/* Before (app.css) */ @import url("theme.css");
```
```html
<!-- After -->
<link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css">
```
- Avoid/caveats: Sass/Less `@import` or `@use` is resolved at build time and does not have this cost.
- Status: `@import` is Baseline widely available. The guidance applies in all engines.
- Sources: https://web.dev/learn/performance/optimize-resource-loading

### Put a `media` attribute on conditional stylesheets
- Layer: html, css
- Stage: network, cssom
- Metrics: FCP, LCP
- When: load
- Impact: low to medium.
- Do: Give print-only or viewport-specific sheets a `media` attribute (`media="print"`, `media="(width <= 480px)"`) so that they do not block render when they do not apply.
- Why: The browser still downloads a non-matching sheet, but it does not block rendering on it. This makes the render-blocking CSS smaller.
- Example:
```html
<link rel="stylesheet" href="/print.css" media="print">
<link rel="stylesheet" href="/narrow.css" media="(width <= 480px)">
```
- Avoid/caveats: Styles in a sheet that does not match at load still apply later if the media starts to match (for example, on resize).
- Status: Baseline widely available.
- Sources: https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/CSS

---

## H. Fonts and CLS

### Choose `font-display` by role: `optional` plus preload for body text, `swap` only with a metric-matched fallback
- Layer: css, html
- Stage: network, layout, paint
- Metrics: CLS, FCP, LCP
- When: load
- Impact: medium. A font swap after first render moves text and causes layout shifts.
- Do: For body text, use `font-display: optional` and `<link rel="preload" as="font" type="font/woff2" crossorigin>`. For brand or heading fonts that must appear, use `swap` or `fallback` together with a size-matched fallback face (next item).
- Why: `block` has a short block period (invisible text). `swap` has a very small block period and an unlimited swap period. `fallback` has a very small block period and a short swap period. `optional` has a very small block period and no swap period. Since Chrome 83, a preloaded `optional` font blocks rendering for up to about 100 ms, so the first frame either has the web font or keeps the fallback. This removes both the invisible-text flash and the shift.
- Example:
```html
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>
<style>@font-face { font-family: Inter; src: url(/fonts/inter-var.woff2) format("woff2"); font-display: optional; }</style>
```
- Avoid/caveats: With `optional`, a first visit on a slow network can keep the fallback font. Preloading too many fonts delays other resources. Lighthouse 13 replaced the `font-display` audit with `font-display-insight`.
- Status: `font-display` is Baseline widely available (2020-01-15).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display ; https://web.dev/articles/preload-optional-fonts ; https://developer.chrome.com/blog/lighthouse-13-0

### Build a metric-matched fallback `@font-face` with `size-adjust` and metric overrides
- Layer: css, build
- Stage: layout
- Metrics: CLS
- When: load, build
- Impact: medium. A matched fallback takes almost the same space as the web font, so the swap moves almost nothing.
- Do: Declare a fallback face with `src: local("Arial")` (plus `local("Roboto")` for Android) and set `size-adjust`, `ascent-override`, `descent-override`, and `line-gap-override`. Compute them as follows: `size-adjust = avgCharWidth(web) / avgCharWidth(fallback)`, and `ascent-override = ascent / (UPM × size-adjust)` (same for descent and line gap). Let tools generate the values (Next.js `next/font`, `@nuxtjs/fontaine`, Fontaine, Capsize).
- Why: The overrides set the vertical metrics. `size-adjust` scales glyph width and height. Together they can match both axes. Fixing `line-height` instead does not address the cause (Chrome docs).
- Example:
```css
@font-face { font-family: "Inter Fallback"; src: local("Arial");
  size-adjust: 107%; ascent-override: 90%; descent-override: 22%; line-gap-override: 0%; }
body { font-family: Inter, "Inter Fallback", sans-serif; } /* numbers are illustrative; generate real ones */
```
- Avoid/caveats: The metric tables differ between macOS (`hhea`) and Windows (`typo`/`win`) for about 10% of Google Fonts. Those fonts need OS-specific values. Safari supports `size-adjust` but not the three overrides, so on Safari the match is only partial.
- Status: `size-adjust` descriptor: Chrome 92, Firefox 92, Safari 17 (BCD). `ascent-override`/`descent-override`/`line-gap-override`: Chrome 87, Firefox 89, Safari only in Technology Preview, so limited availability (webstatus.dev "font-metric-overrides").
- Sources: https://developer.chrome.com/blog/font-fallbacks ; https://web.dev/articles/css-size-adjust ; https://bcd.developer.mozilla.org/bcd/api/v0/current/css.at-rules.font-face.size-adjust.json ; https://bcd.developer.mozilla.org/bcd/api/v0/current/css.at-rules.font-face.ascent-override.json ; https://api.webstatus.dev/v1/features/font-metric-overrides

### Subset fonts and scope them with `unicode-range`
- Layer: css, build
- Stage: network
- Metrics: FCP, LCP, bundle-size
- When: load, build
- Impact: low to medium.
- Do: Subset fonts to the scripts you ship and declare `unicode-range` on each face. Use two or three families at most.
- Why: The browser loads a face only when an element uses it and the page contains characters in its range. Font files can be several megabytes.
- Example:
```css
@font-face { font-family: Inter; src: url(/f/inter-latin.woff2) format("woff2"); unicode-range: U+0000-00FF, U+2013-2014; }
```
- Avoid/caveats: User-generated text in other scripts falls back to system fonts. Check the numerals and currency signs your app uses.
- Status: Baseline widely available.
- Sources: https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/CSS

### Reserve the scrollbar gutter where content can overflow later
- Layer: css
- Stage: layout
- Metrics: CLS
- When: load, interaction
- Impact: low.
- Do: Set `scrollbar-gutter: stable` on scroll containers whose content can grow past their height after load, so the content width does not jump when the scrollbar appears.
- Why: A classic scrollbar that appears takes inline space and reflows the content.
- Example:
```css
.order-book { overflow-y: auto; scrollbar-gutter: stable; }
```
- Avoid/caveats: This has no effect with overlay scrollbars (macOS default, mobile).
- Status: Baseline newly available (2024-12-11).
- Sources: https://api.webstatus.dev/v1/features/scrollbar-gutter

---

## I. Scrolling

### Make touch and wheel listeners passive, and declare chart gestures with `touch-action`
- Layer: js, css
- Stage: main-thread-task, composite
- Metrics: FPS/smoothness
- When: interaction
- Impact: medium to high. A non-passive `touchstart`/`touchmove`/`wheel` listener makes the browser wait for the handler before it scrolls.
- Do: Pass `{ passive: true }` to scroll-related listeners that do not call `preventDefault()`. On chart canvases that handle pan and zoom themselves, set `touch-action: none` (or `pan-y` if the page must still scroll vertically). Then only the wheel handler for zoom needs `{ passive: false }`.
- Why: Chrome made `touchstart`/`touchmove` (Chrome 56) and `wheel`/`mousewheel` (Chrome 73) listeners on `window`, `document`, and `body` passive by default. Listeners on other elements are not passive by default. `touch-action` tells the browser before any listener runs which gestures it may handle.
- Example:
```css
.chart-canvas { touch-action: none; }
```
```js
chartEl.addEventListener('pointermove', onPan);                 // no scroll blocking
chartEl.addEventListener('wheel', onZoom, { passive: false });  // only because it calls preventDefault()
listEl.addEventListener('touchstart', onTouch, { passive: true });
```
- Avoid/caveats: `touch-action: none` also blocks pinch-zoom there, which is an accessibility cost. Lighthouse 13 removed the `uses-passive-event-listeners` audit, so this is no longer flagged automatically.
- Status: `passive` option: Chrome 51, Firefox 49, Safari 10 (BCD). `touch-action`: Baseline (MDN).
- Sources: https://developer.chrome.com/blog/scrolling-intervention-2 ; https://developer.chrome.com/docs/lighthouse/best-practices/uses-passive-event-listeners ; https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action ; https://developer.chrome.com/blog/lighthouse-13-0

### Use `overscroll-behavior: contain` on nested scrollers instead of JS scroll locks
- Layer: css
- Stage: composite, main-thread-task
- Metrics: FPS/smoothness
- When: interaction
- Impact: low to medium. It replaces non-passive `touchmove` + `preventDefault()` hacks that hurt scrolling.
- Do: Set `overscroll-behavior: contain` on side panels, order books, and modal bodies to stop scroll chaining to the page. Set `overscroll-behavior-y: none` on the root to disable pull-to-refresh in app-like views.
- Why: `contain` stops scroll chaining. `none` also removes the overscroll effect (glow or bounce). No listener is needed, so scrolling stays on the compositor.
- Example:
```css
.order-book { overflow-y: auto; overscroll-behavior: contain; }
```
- Avoid/caveats: Before Chrome 144 and Firefox 150, and in all Safari versions (16+), the property has no effect on scroll containers without scrollable overflow. For modals with short content, give the container overflow or keep a fallback.
- Status: webstatus.dev lists limited availability because of the newer rule for non-overflowing containers (Chrome 144, Firefox 150). The basic case works in all three engines (Safari 16+, partial).
- Sources: https://developer.chrome.com/blog/overscroll-behavior ; https://bcd.developer.mozilla.org/bcd/api/v0/current/css.properties.overscroll-behavior.json ; https://api.webstatus.dev/v1/features/overscroll-behavior

### Keep scroll anchoring on, and opt out only per container
- Layer: css
- Stage: layout
- Metrics: CLS
- When: long-lived session
- Impact: low to medium. Scroll anchoring stops content jumps when content above the viewport changes size.
- Do: Leave `overflow-anchor: auto` (the default). Set `overflow-anchor: none` only on a container whose behavior you control yourself, for example a feed that pins new rows at the top on purpose. Do not animate `top`/`left`/`margin`/`padding`/size/transform on the anchor node or its ancestors, because those changes suppress anchoring.
- Why: The browser shifts the scroll position to keep the visible anchor node in place. Changes to position, box model, size, or transform on the anchor chain, and `position` changes anywhere in the scroller, suppress it. An opted-out subtree cannot opt back in.
- Example:
```css
.trade-tape { overflow-y: auto; overflow-anchor: none; } /* newest row stays at the top on purpose */
```
- Avoid/caveats: Scroll listeners that set scroll positions can fight anchoring.
- Status: Baseline newly available in September 2026 (Safari 27 added it; Chrome 56, Firefox 66).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-anchor ; https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll_anchoring/Scroll_anchoring ; https://bcd.developer.mozilla.org/bcd/api/v0/current/css.properties.overflow-anchor.json

---

## J. Tooling and verification

### Check rendering changes with the right DevTools view before and after
- Layer: tooling
- Stage: style, layout, paint, composite, raster
- Metrics: INP, FPS/smoothness, memory, CLS
- When: testing
- Impact: high as process. Several items above are trade-offs that only profiling can decide.
- Do: Record with CPU throttling (4× or more). Check the element count on Recalculate Style and the "nodes that need layout / tree size" on Layout events. Use the Selector Stats tab, the "Forced reflow" insight, the Rendering tab (Paint flashing, Layer borders, Layout Shift Regions, FPS meter with a dropped-frames percentage), the Layers panel (compositing reasons, memory), Lighthouse `non-composited-animations`, and in the field LoAF `forcedStyleAndLayoutDuration` and style/layout durations. In Safari, use the Web Inspector Layers sidebar (Safari 26.4 shows real layer snapshots). In Firefox, use paint flashing and the Waterfall "Recalculate Style" markers.
- Why: web.dev's goal is about 4 to 5 ms of compositing during scroll or transitions, and a 16.7 ms frame budget at 60 FPS. Edge and Chrome document the Selector Stats columns (Elapsed, Match Attempts, Match Count, % slow-path non-matches). Edge adds an Invalidation count.
- Example: (process) Record the interaction → select the long Recalculate Style → Selector Stats → sort by Elapsed → fix → record again.
- Avoid/caveats: Selector Stats and advanced paint instrumentation add overhead, so do not compare absolute times with them on.
- Status: current Chrome, Edge, Safari, and Firefox DevTools.
- Sources: https://developer.chrome.com/docs/devtools/performance/selector-stats ; https://learn.microsoft.com/en-us/microsoft-edge/devtools/performance/selector-stats ; https://web.dev/articles/animations-guide ; https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count ; https://webkit.org/blog/17862/webkit-features-for-safari-26-4/

---

## Sources read
- https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count
- https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing
- https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations
- https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas
- https://web.dev/articles/content-visibility
- https://web.dev/articles/animations-guide
- https://web.dev/articles/animations-overview
- https://web.dev/blog/at-property-performance
- https://web.dev/articles/css-size-adjust
- https://web.dev/articles/preload-optional-fonts
- https://web.dev/articles/defer-non-critical-css
- https://web.dev/articles/extract-critical-css
- https://web.dev/learn/performance/optimize-resource-loading
- https://developer.chrome.com/blog/hardware-accelerated-animations
- https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations
- https://developer.chrome.com/docs/lighthouse/best-practices/uses-passive-event-listeners
- https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources
- https://developer.chrome.com/blog/lighthouse-13-0
- https://developer.chrome.com/docs/devtools/performance/selector-stats
- https://developer.chrome.com/blog/scroll-animation-performance-case-study
- https://developer.chrome.com/docs/css-ui/scroll-driven-animations
- https://developer.chrome.com/blog/view-transitions-misconceptions
- https://developer.chrome.com/docs/web-platform/view-transitions/same-document
- https://developer.chrome.com/blog/font-fallbacks
- https://developer.chrome.com/blog/framework-tools-font-fallback
- https://developer.chrome.com/blog/scrolling-intervention-2
- https://developer.chrome.com/blog/overscroll-behavior
- https://developer.chrome.com/docs/chromium/renderingng-architecture
- https://developer.chrome.com/docs/chromium/blinkng
- https://developer.chrome.com/docs/css-ui/css-text-wrap-balance
- https://developer.chrome.com/blog/css-text-wrap-pretty
- https://chromestatus.com/feature/5637351992721408 (API v0)
- https://learn.microsoft.com/en-us/microsoft-edge/devtools/performance/selector-stats
- https://blogs.windows.com/msedgedev/2023/01/17/the-truth-about-css-selector-performance/
- https://developer.mozilla.org/en-US/docs/Web/CSS/will-change
- https://developer.mozilla.org/en-US/docs/Web/CSS/contain
- https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility
- https://developer.mozilla.org/en-US/docs/Web/CSS/contain-intrinsic-size
- https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Using_CSS_containment
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/container-type
- https://developer.mozilla.org/en-US/docs/Web/CSS/:has
- https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display
- https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/CSS
- https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/CSS_JavaScript_animation_performance
- https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-anchor
- https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll_anchoring/Scroll_anchoring
- https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action
- https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering
- https://drafts.csswg.org/css-conditional-5/ (container-type definitions)
- https://api.webstatus.dev/v1/features/{content-visibility, contain, contain-intrinsic-size, container-queries, container-style-queries, has, registered-custom-properties, scroll-driven-animations, view-transitions, cross-document-view-transitions, will-change, overscroll-behavior, overflow-anchor, font-display, font-metric-overrides, font-size-adjust, image-rendering, backdrop-filter, individual-transforms, contain-inline-size, contain-style, scrollbar-gutter} and feature search (text-wrap, @scope, nesting, and others)
- https://bcd.developer.mozilla.org/bcd/api/v0/current/{css.at-rules.font-face.size-adjust, css.at-rules.font-face.ascent-override, css.at-rules.font-face.descent-override, css.at-rules.font-face.line-gap-override, css.properties.overscroll-behavior, css.properties.overflow-anchor, css.properties.image-rendering, css.properties.content-visibility, css.properties.contain, css.properties.will-change, api.EventTarget.addEventListener.options_parameter.options_passive_parameter, api.Element.contentvisibilityautostatechange_event, api.ContentVisibilityAutoStateChangeEvent, api.Element.checkVisibility}.json
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.cc
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.h
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/runtime_enabled_features.json5 (plus `refs/branch-heads/` 6099, 6422, 6723, 6943, 7049, 7151, 7258, 7390, 7444, 7499, 7559, 7632, 7680, 7727, 7778, 7827, 7871, 7922, 7977, 8010, 8037, 8059)
- https://chromiumdash.appspot.com/fetch_milestones (milestone to branch map)
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/csspaint/nativepaint/native_css_paint_definition.cc
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/csspaint/nativepaint/background_color_paint_definition.cc
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/csspaint/nativepaint/clip_path_paint_definition.cc
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing_reasons.h
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/css_properties.json5
- https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/css/style-invalidation.md
- https://chromium.googlesource.com/chromium/src/+/main/cc/trees/effect_node.h
- https://searchfox.org/mozilla-central/search?q=CanAnimateOnCompositor and ?q=omta.background-color
- https://raw.githubusercontent.com/mozilla-firefox/firefox/main/modules/libpref/init/StaticPrefList.yaml
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/css/CSSProperties.json
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/animation/KeyframeEffect.cpp
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/style/StyleInterpolation.cpp
- https://webkit.org/blog/18304/release-notes-for-safari-technology-preview-252/
- https://webkit.org/blog/17862/webkit-features-for-safari-26-4/
- https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- https://blogs.igalia.com/blee/posts/2023/05/31/how-blink-invalidates-styles-when-has-in-use.html
- https://csswizardry.com/2026/04/what-is-css-containment-and-how-can-i-use-it/
- https://www.smashingmagazine.com/2016/12/gpu-animation-doing-it-right/
- https://gist.github.com/paulirish/5d52fb081b3570c81e3a
- https://github.com/motiondivision/motion/issues/3786
- https://groups.google.com/a/chromium.org/g/paint-dev/c/3bXUo0X3C5I
- https://github.com/GoogleChrome/developer.chrome.com/issues/6816
- https://blog.logrocket.com/container-queries-2026/ (no usable perf data)

## Not covered / could not access
- Release notes for Chrome's composited `background-color` (flag stable from branch 142) and `clip-path` (flag stable from branch 152) animations: not found. The versions come only from `runtime_enabled_features.json5` in each release branch, and a Finch kill switch could still disable `CompositeClipPathAnimation`. Gitiles blame and log pages need sign-in, so I could not get the exact commits.
- WebKit threaded animation resolution (accelerated `offset-*`): seen in Safari Technology Preview 238 notes (search summary only). I did not confirm that a stable Safari release enables it by default.
- Firefox version that turned on `gfx.omta.background-color` by default: not found. Only the current default (`true` in `main`) is confirmed.
- Container-query cost: no vendor benchmark found. The rule rests on the BlinkNG explanation and the spec.
- Rounded-corner clip cost: only the Chromium `is_fast_rounded_corner` source comment plus secondary summaries. The claim about non-uniform radii on macOS is unverified.
- `backdrop-filter` cost: only field reports and bug trackers, no vendor benchmark.
- `image-rendering` speed difference between modes: no primary data.
- `contain: style` in Safari: BCD says Safari 27, but webstatus.dev says widely available since 2022. The conflict is not resolved.
- GPU raster internals (tile sizes, the Out-of-Process Raster (OOP-R) default per platform): only the RenderingNG overview was read. I found no current doc with numbers.
- `background-attachment: fixed` scroll cost in current Chromium: not verified (Chromium lists `kFixedAttachmentBackground` as a compositing reason, which suggests it may now be composited). I left it out.
- `@scope`, CSS nesting, and cascade layers: I found no primary source about their rendering cost, so they are not covered.
- web.dev `font-best-practices` and `css-web-vitals` were assigned to another agent and were not reread here.
