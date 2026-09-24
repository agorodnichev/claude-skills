# CSS rendering: motion, layers, containment and style scope (CSS-)

Open this when you write CSS (selectors, `transition`, `animation`, `@keyframes`, `will-change`, `contain`, `content-visibility`, `filter`, `container-type`) or motion on DOM elements (`element.animate()`, animated class toggles, view transitions, scroll effects).
Stage cards: `pipeline.md` §H (`style`, `layout`, `paint`, `composite`, `memory`). What each property change costs: §0 below, and the full table in `pipeline.md` §E.

## Checklist

| ID | Do this | Impact | First stage |
|---|---|---|---|
| **§A Compositor-only motion** | | | |
| CSS-01 | Animate `transform` and `opacity`; FLIP or `scale` for size and position changes | high | layout |
| CSS-02 | Fade a pre-painted layer; no animated blur, shadow or color; no `backdrop-filter` over live content | medium | paint |
| CSS-03 | Keep composited animations eligible: `replace` composite, no animated custom properties | medium | composite |
| CSS-04 | Separate `translate`, `scale` and `rotate` when two motions share an element | low | composite |
| **§B Layers and GPU memory** | | | |
| CSS-05 | `will-change` just before the motion, removed after; no `translateZ(0)` | medium | composite |
| CSS-06 | Keep moving and promoted elements high in the stacking order; no accidental layers | medium | composite |
| CSS-07 | Uniform rounded clips; no masks, blend modes or filters around animated or canvas subtrees | medium | composite |
| **§C Containment and skipped rendering** | | | |
| CSS-08 | `contain: strict` plus a size for panels, `contain: content` for rows and cards | high | layout |
| CSS-09 | `content-visibility: auto` with `contain-intrinsic-size: auto <h>` on large regions | high | style |
| CSS-10 | `content-visibility: hidden` for views that come back soon | medium | style |
| CSS-11 | `container-type: inline-size`; never resize query containers every frame | medium | style |
| **§D Style recalculation scope** | | | |
| CSS-12 | State on the smallest element that changes; simple selectors; no rules on every element | medium | style |
| CSS-13 | No `:nth-child()` or sibling combinators on mutating lists; narrow `:has()` | medium | style |
| CSS-14 | Per-frame custom properties on the element that uses them, with `inherits: false` | high | style |
| **§E Paint cost** | | | |
| CSS-15 | Small, separate repaint areas; no animated large backgrounds or gradients | medium | paint |
| **§F Animation mechanics** | | | |
| CSS-16 | CSS or `element.animate()` for DOM motion; sequence with `finished`, not timers | high | tasks |
| CSS-17 | Commit and cancel, no endless fill; retarget and replay without layout reads | medium | style |
| CSS-18 | One animation owner per element; pause hidden panels; no stacked re-triggers | medium | layout |
| **§G Scroll, view transitions, reduced motion** | | | |
| CSS-19 | Scroll-driven animations and `position: sticky` instead of scroll listeners | medium | composite |
| CSS-20 | View transitions: data first, a short DOM-swap callback, few named elements | medium | tasks |
| CSS-21 | Reduced motion also stops WAAPI, rAF, canvas and WebGL motion | medium | tasks |
| **§H One-line rules** | | | |
| CSS-22 | `text-wrap: balance` only on short headings | low | layout |
| CSS-23 | `overscroll-behavior: contain` instead of JS scroll locks | low | composite |
| CSS-24 | Keep scroll anchoring on; opt out per scroller only | low | layout |
| CSS-25 | `image-rendering: pixelated` for small canvases enlarged on purpose | low | paint |
| CSS-26 | End exit animations out of rendering, not at `opacity: 0` | medium | layout |
| CSS-27 | No style-rule insertion on hot paths | medium | cssom |
| CSS-28 | One constructed stylesheet for many shadow roots | low | cssom |
| CSS-29 | Live grids: `minmax(0, 1fr)` or fixed tracks, not content-sized ones | medium | layout |
| CSS-30 | Measure before reveal with `visibility: hidden`, not by covering the element | low | layout |
| CSS-31 | CSS scroll snap before a JS carousel library | low | composite |

- → DOM-04, DOM-12 live rows: write only changed cells; fixed table layout and tabular numbers
- → EVT-07, EVT-08 read layout, then write styles; a cached rect instead of geometry reads per event
- → EVT-09, EVT-16 passive listeners and `touch-action` on gesture surfaces; `transform` during drags
- → DOM-09 menus and tooltips in the top layer, so contained panels do not clip them
- → CNV-20 pause a canvas or WebGL loop when its region is skipped or off-screen
- → HTML-07, HTML-08, HTML-09 CSS delivery (no `@import`, small render-blocking CSS, critical CSS); → MEDIA-12 reserved space and `scrollbar-gutter`

## §0 Property cost

Layout, then paint: geometry, text and display changes (`width`, `height`, `margin`, `padding`, `top`, `left`, `font-size`, `display`, grid and flex tracks). Paint only: `color`, `background-*`, `box-shadow`, `border-radius`, `outline`, `visibility`, `z-index` (repaints the stacking context). Composite only, and only when the compositor runs the animation: `transform`, `translate`, `scale`, `rotate`, `opacity`, `filter` without pixel-moving functions, `backdrop-filter`. The full table from Blink's data is in `pipeline.md` §E.

## §A Compositor-only motion

### CSS-01 Animate `transform` and `opacity`; use FLIP or `scale` for size and position changes
stage: layout, paint, composite · metric: frame, CLS, INP · when: interaction, render-loop · impact: high — a geometry animation runs style, layout and paint on the main thread every frame and stalls while a long task runs · support: baseline · also: CSS-04, CSS-16, EVT-16
- Do: Move with `translate` or `transform`, fade with `opacity`, and grow bars and fills with `scale` plus a `transform-origin`. Do not animate `top`, `left`, `margin`, `width`, `height`, `max-height`, `font-size` or `border-width`. For a real layout change (reorder, expand), measure the first and last boxes once, then animate the difference with a transform (FLIP). To grow one word, give its span `display: inline-block` and animate `scale`: transforms do nothing on plain inline boxes.
- Why: A change restarts the pipeline at the first stage it touches, so a geometry change pays layout, paint and composite each frame, while a declared `transform` or `opacity` animation runs on the compositor thread and keeps going when the main thread is busy. Geometry animations also count as layout shifts, even on absolutely positioned elements; web.dev found that pages that animate margin or border widths have poor CLS at almost twice the overall rate.
- Detect: `rg -n '(transition|animation)[^;]*\b(top|left|right|bottom|width|height|max-height|margin|padding|font-size|border-width|grid-template-rows)\b' -g '*.{css,scss,svelte,vue,tsx,jsx}'`, `@keyframes` that set those properties, `.animate(` with those keys, and `grid-template-rows: 0fr`. A match matters on hot or repeated motion (hover, toggles, live updates).
- Verify: measure.md#fps-css, the motion toggled 5 times between the `wp:` marks. Pass: Layout and Paint counts in the window do not grow with the frame count (0 for pure transform or opacity; at most one Layout per toggle for FLIP), and the Animations track shows no "compositing failed" reason.
- Example:
  ```css
  /* Before: `transition: width` on both, so layout and paint run on every frame */
  /* After: compositor only; the panel keeps its width and slides out */
  .side-panel { transition: translate 200ms; }
  .side-panel[data-closed] { translate: 100% 0; }
  .progress-fill { width: 100%; transform-origin: 0 50%; transition: scale 150ms; } /* script sets style.scale = `${ratio} 1` */
  ```
- Avoid: `scale` also scales text and borders, so use it on plain fills or counter-scale the children. A transform does not free layout space: a panel that must give its space back needs one layout change at the end, or an instant collapse. The `grid-template-rows: 0fr → 1fr`, `max-height` and `interpolate-size` height tricks still run layout every frame; keep them for rare disclosure UI, never on a busy page (this replaces advice that calls them compositor-friendly). Chromium composites a percentage `translate` only while the box size stays the same.
- Source: https://web.dev/articles/animations-guide ; https://developer.chrome.com/blog/hardware-accelerated-animations

### CSS-02 Paint once, then fade: animate a pre-painted layer, not blur, shadow or color
stage: paint, composite · metric: frame · when: interaction, render-loop · impact: medium — a blur, shadow or color animation repaints the element, and re-blurs it, on every frame · support: baseline · also: CSS-15, CSS-06, DOM-04
- Do: Paint the end state once on a pseudo-element or a second element (the raised shadow, a blurred copy, a highlight color) and animate only its `opacity`. Do not animate `box-shadow`, `text-shadow`, `filter: blur()` or `drop-shadow()`, SVG `filter="url(#…)"`, or the background color of large areas. Do not put `backdrop-filter` over content that changes every frame (a live chart, video, a scrolling list): use a mostly opaque solid background there.
- Why: Anything with a blur costs far more to paint than a flat fill, and an animated shadow repaints the blur each frame. Chromium cannot run a filter animation with a pixel-moving function on the compositor (failure reason `kFilterRelatedPropertyMayMovePixels`), so it falls back to the main thread. A backdrop filter must run again each time the content behind it changes.
- Detect: `rg -n '(transition|animation)[^;]*\b(box-shadow|text-shadow|filter|background(-color)?)\b' -g '*.{css,scss,svelte,vue}'`; `@keyframes` that set `box-shadow`, `blur(`, `drop-shadow(` or `background`; `rg -n 'backdrop-filter'`, then check what renders under it.
- Verify: measure.md#fps-css. Pass: at most one Paint per toggle in the window (when the layer is created), not one per frame.
- Example:
  ```css
  /* Before: the cell repaints on every frame of the highlight */
  .cell.changed { animation: flash 600ms; }
  @keyframes flash { from { background-color: #fde68a; } }
  /* After: the color is painted once on an overlay; only its opacity animates */
  .cell { position: relative; }
  .cell::after { content: ""; position: absolute; inset: 0; background: #fde68a; opacity: 0; pointer-events: none; }
  .cell.changed::after { animation: fade 600ms; } @keyframes fade { from { opacity: 1; } to { opacity: 0; } }
  ```
- Avoid: Each overlay is a layer while it animates, so highlight only the cells that changed (CSS-06, DOM-04). The fixed blur or shadow still costs one paint. Chromium composites some `background-color` animations, but only in simple cases and with no warning when it falls back (CSS-03): do not rely on it. To replay the highlight on the same element, see CSS-17.
- Source: https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.h

### CSS-03 Keep composited animations eligible: `replace` composite, no animated custom properties
stage: composite, style · metric: frame, INP · when: render-loop, interaction · impact: medium — one detail silently moves a transform or opacity animation back to the main thread · support: composited-bg-color-animation, composited-clip-path-animation · also: CSS-14, CSS-04, CSS-02
- Do: On motion that must stay smooth, keep the default `composite: 'replace'` (no `'add'` or `'accumulate'`, no `animation-composition`), no `!important` on the animated property, no `offset-path` motion, no `will-change: contents` on an ancestor, the same value type in every keyframe, and in SVG animate `transform`, not `translate`, `scale` or `rotate`. Do not animate a custom property that feeds `transform`, `opacity` or position: animate `translate` or `opacity` directly. Treat `background-color` and `clip-path` animations as main-thread work unless the trace shows them composited.
- Why: Chromium sends an animation to the compositor only when no failure reason applies (`compositor_animations.h`: non-replace composite mode, important property, CSS offset, invalid compositing state, independent transform properties on SVG, mixed keyframe value types, a scroll timeline whose scroller is not composited). Custom property animations, registered or not, run on the main thread, because only a paint worklet can use them on the compositor. Chromium composites `background-color` and `clip-path` only in recent releases (support.md) and only in simple cases: one animation of that property, no underlying effect, no `url()` clip path, no `shape()` arcs.
- Detect: `rg -n "composite:\s*['\"](add|accumulate)|animation-composition|offset-path|will-change:\s*contents" -g '*.{css,scss,ts,tsx,js,svelte,vue}'`; `@keyframes` that set `--` properties; `!important` on `transform`, `opacity`, `translate`, `scale` or `rotate`.
- Verify: measure.md#fps-css. Pass: no "compositing failed" reason on the Animations track for the animation, and 0 Layout and 0 Paint in the window.
- Example:
  ```js
  // Before: 'add' keeps this nudge on the main thread in Chromium
  row.animate({ translate: ['0 0', '4px 0', '0 0'] }, { duration: 120, composite: 'add' });
  // After: default 'replace'; if a translate animation already runs on the row, nudge a wrapper instead
  row.animate({ translate: ['0 0', '4px 0', '0 0'] }, { duration: 120 });
  ```
- Avoid: The failure list is Chromium-internal and changes between releases: trust the trace, not the list. A short main-thread animation on an idle page is fine; this matters while scripts or live updates keep the main thread busy. `composite: 'add'` saves a `getComputedStyle` read, which is why some guides recommend it, but it costs compositing in Chromium. `iterationComposite` does not exist in Chromium.
- Source: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.h ; https://web.dev/blog/at-property-performance

### CSS-04 Animate `translate`, `scale` and `rotate` separately when two motions share an element
stage: composite, style · metric: frame · when: interaction, render-loop · impact: low — it removes the code that merges transform strings and reads computed style, and keeps both motions on the compositor · support: baseline · also: CSS-03, CSS-17
- Do: When two effects move one element (a slide plus a press scale, a drag offset plus a hover lift), give each its own property: `translate`, `scale`, `rotate`. Keep `transform` for a static base value or for an unusual order of operations. Do not animate `left` or `width` and a transform on the same element: the geometry part keeps the cost of CSS-01.
- Why: Each individual property has its own animation stack, so a `scale` pulse does not replace a running `translate` slide. With one `transform` value, the later animation replaces the whole value, and code then reads the current matrix (`getComputedStyle`, a forced style update) to merge the two.
- Detect: `rg -n "getComputedStyle\([^)]*\)\.transform|style\.transform\s*\+?=" -g '*.{ts,tsx,js,svelte,vue}'`; two `@keyframes` or `.animate(` calls on one element that both set `transform`.
- Verify: measure.md#fps-css with both motions running. Pass: 0 Layout and 0 Paint in the window, and no style or layout "Forced by script" line in trace-summary.
- Avoid: The fixed order is `translate`, `rotate`, `scale`, then `transform`; use `transform` when you need another order. Do not animate one axis with both `transform` and `translate`: the result is hard to read.
- Source: https://developer.mozilla.org/en-US/docs/Web/CSS/translate ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.cc

## §B Layers and GPU memory

### CSS-05 Set `will-change` just before the motion and remove it after; drop `translateZ(0)`
stage: composite, memory · metric: frame, memory · when: interaction, session · impact: medium — each promoted layer holds a GPU texture, up to width × height × 4 bytes × DPR², for as long as the hint stays · support: baseline · also: CSS-06, CSS-16
- Do: Set `will-change: transform` (or `opacity`) from script just before a known motion (on `pointerdown` for a drag, on `pointerenter` for a hover effect) and reset it to `auto` when the motion ends. Keep it in a stylesheet only for the few elements that move all the time (a drag layer, a sliding drawer). Remove `translateZ(0)`, `translate3d(0, 0, 0)` and `backface-visibility: hidden` hacks that no measured problem needs.
- Why: The hint promotes the element and its subtree to a composited layer ahead of time, which removes the first-frame hitch, but the layer costs GPU memory and upload time for as long as the hint stays. A running `transform` or `opacity` animation gets a layer anyway, so the hint adds nothing inside `@keyframes` or during a declared animation.
- Detect: `rg -n 'will-change|translateZ\(0|translate3d\(0,\s*0,\s*0|backface-visibility:\s*hidden' -g '*.{css,scss,svelte,vue,tsx,jsx}'`, then check whether the hint sits in base CSS of repeated elements (rows, cards, list items) or on `*`.
- Verify: measure.md#fps-css. Pass: Paint and `Layerize` time in the window are not worse than with the hint in base CSS, and after the motion `getComputedStyle(el).willChange` is `auto` on every element that moved (read with `evaluate_script`).
- Example:
  ```ts
  // Before: `.card { will-change: transform; }` in CSS, so every card holds a layer all session
  // After: promote only the card being dragged, only while it is dragged (EVT-05)
  card.addEventListener('pointerdown', () => { card.style.willChange = 'transform'; });
  card.addEventListener('lostpointercapture', () => { card.style.willChange = 'auto'; });
  ```
- Avoid: MDN calls the hint a last resort for a measured problem. `will-change: transform` or `opacity` creates a stacking context at once, and `transform` also makes a containing block for `position: fixed` children, so a fixed tooltip inside positions against the element. Content that a script zooms with `scale` keeps its old raster while the hint stays and looks blurry: remove the hint when the gesture ends, so Chromium re-rasters at the final scale once. This replaces the advice to put `will-change: transform` on every animated element in CSS.
- Source: https://developer.mozilla.org/en-US/docs/Web/CSS/will-change ; https://chromestatus.com/feature/5637351992721408

### CSS-06 Keep moving elements high in the stacking order, and add no layers by accident
stage: composite, memory · metric: memory, frame · when: session, render-loop · impact: medium — content that paints above a composited layer can need its own layer, so one moving element can promote many others · support: n/a · also: CSS-05, CSS-02, DOM-09
- Do: Render moving or promoted elements (tooltips, toasts, drag images, popovers) in the top layer (`popover`, `<dialog>`) or in an overlay container at the end of `body`, so that few elements paint above them. Do not put layer reasons on repeated elements: 3D transforms and `transform-style: preserve-3d`, `position: fixed` or `sticky`, `will-change` on transform-like or filter properties, `backdrop-filter`. For a large, scaled-up background texture, use a small image, not a small painted box with `scale()`.
- Why: Chromium keeps paint order correct, so an element that overlaps a composited layer and paints above it gets a layer too (compositing reason `kOverlap`); Chromium squashes many of these into shared layers, but not all. Each layer costs raster tiles in GPU memory, upload and compositing work. Chromium rasters a painted layer at its on-screen scale, so a scaled-up small box saves no texture memory; a layer that draws only one image is rastered near the image's own size.
- Detect: `rg -n 'position:\s*(fixed|sticky)|will-change|translateZ|translate3d|preserve-3d|backdrop-filter' -g '*.{css,scss,svelte,vue}'` in styles of repeated elements (rows, cards, list items); animated elements rendered deep inside containers, below many later siblings.
- Verify: measure.md#fps with the motion running. Pass: `Layerize` and `Commit` time in the window (trace-summary) are lower than the baseline, and frame p95 is not worse. For the layer count, ask the user to check the DevTools Layers panel; the agent cannot open it.
- Avoid: Do not "fix" overlap by promoting more elements. The texture formula is an upper bound: Chromium rasters only tiles near the viewport, and a solid-color layer needs no texture. Squashing makes the effect smaller than older articles show, so measure before you restructure a layout.
- Source: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing_reasons.h ; https://chromium.googlesource.com/chromium/src/+/main/docs/how_cc_works.md

### CSS-07 Keep rounded clips, masks, blend modes and filters off animated and canvas subtrees
stage: composite, gpu-draw · metric: frame, memory · when: render-loop · impact: medium — off the fast path, a clip or effect around changing content costs an extra offscreen pass on every frame · support: n/a · also: CSS-06, CSS-02
- Do: Where an `overflow: hidden` or `clip` ancestor with `border-radius` wraps a canvas, a video or an animated layer, use one uniform, circular radius on all corners (no `a / b` elliptical radii, no per-corner values), do not scale or rotate the composited content inside it, and do not nest rounded clips around it. Keep `mix-blend-mode`, `mask`, `clip-path`, `filter` and `backdrop-filter` off large animated or scrolling subtrees.
- Why: Chromium draws a rounded clip with a fast shader path. When a corner is elliptical, the radii differ (on macOS), the content inside is scaled or rotated, the clip is a `clip-path`, or rounded clips nest, it uses a render surface with a mask instead. Blend modes, masks, clip paths and filters over a subtree of layers can each force a render surface too.
- Detect: `rg -n -A4 'border-radius' -g '*.{css,scss,svelte,vue}' | rg 'overflow:\s*(hidden|clip)'` on wrappers of `canvas`, `video` or animated children, then check for `/` or per-corner radii; `rg -n 'mix-blend-mode|mask(-image)?:|clip-path'` on ancestors of animated or scrolling content.
- Verify: measure.md#fps at DPR 2 with the canvas or animation running. Pass: trace-summary `GPUTask` time and frame p95 are lower than with the old clip, or not worse.
- Avoid: This comes from Chromium source, not from a measurement here: measure on the target GPU before you redesign a component. A static clip costs nothing per frame. Rounding the element itself is not required; one uniform radius on the wrapper is enough.
- Source: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing/property_tree_manager.cc ; https://chromium.googlesource.com/chromium/src/+/main/cc/trees/effect_node.h

## §C Containment and skipped rendering

### CSS-08 Contain independent panels: `contain: strict` plus a size, or `contain: content`
stage: layout, style, paint · metric: INP, frame · when: interaction, render-loop · impact: high — without containment, one update inside a panel can re-lay out the whole page · support: contain · also: CSS-09, DOM-04, CNV-20
- Do: Give each panel whose size the page layout sets (a side panel, a dashboard pane, a drawer, a chart container) `contain: strict` and an explicit block size. Give repeated items whose content sets their height (grid or flex rows, cards, tiles, list items) `contain: content`; in a `<table>`, put it on the `<td>` cells, because layout and paint containment have no effect on a `<tr>`. Do not put it on page-level wrappers or on small inline elements.
- Why: Layout usually starts at the document root. Layout and paint containment make the box a layout root and clip its paint, so an update inside it re-lays out and repaints only that box. In a CSS Wizardry test, opening a dropdown in a drawer took 11.21 ms of layout from `#document` (4,371 nodes visited); with `contain: strict` on the drawer it took 1.89 ms (73 nodes).
- Detect: `rg -n -g '*.{css,scss,svelte,vue}' '^\s*\.[\w-]*(panel|pane|sidebar|drawer|tile|card|widget|row)\b[^{]*\{'`, then check that the block has `contain` or `content-visibility`. Also `rg -n 'contain:\s*(strict|size)'`, then check that the same block sets `block-size`, `height` or `contain-intrinsic-size`; without a size, the box collapses to 0 px.
- Verify: measure.md#inp (or measure.md#fps for live updates), one update inside the panel. Pass: trace-summary shows the update's Layout events as partial ("whole document 0"), `totalObjects` is lower than the baseline, and forced layouts are not worse.
- Example:
  ```css
  /* Before: one update in a tile can re-lay out the whole dashboard */
  .tile { overflow: hidden; }
  /* After */
  .side-panel { contain: strict; block-size: 100%; }   /* the size comes from the grid track */
  .tile       { contain: content; }                    /* the height comes from content */
  ```
- Avoid: `layout` and `paint` containment create a stacking context, a containing block for `position: fixed` and absolute children, and an independent formatting context, and paint containment clips overflow: render tooltips and menus in the top layer (DOM-09) or outside the panel. Size containment without a size gives a 0 px box. `contain: style` scopes only counters and quotes, so it adds no speed. A contained panel still runs its canvas loop when off-screen: pause it (CNV-20).
- Source: https://developer.mozilla.org/en-US/docs/Web/CSS/contain ; https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing

### CSS-09 Skip off-screen regions: `content-visibility: auto` plus `contain-intrinsic-size: auto <h>`
stage: style, layout, paint · metric: INP, LCP, frame · when: load, interaction, session · impact: high — skipped regions cost no style, layout or paint; in web.dev's demo, rendering went from 232 ms to 30 ms · support: content-visibility · also: CSS-08, CSS-10, CNV-20, DOM-02
- Do: Give each large, self-contained region of a long page or a scrolling panel (feed sections, report blocks, dashboard rows below the fold, long settings groups) `content-visibility: auto` and `contain-intrinsic-size: auto <estimated height>`. It also isolates regions that stay on screen, because layout, style and paint containment stay on while the region is visible. Do not read layout inside a skipped region. If the region holds a canvas or WebGL loop, pause the loop while the region is skipped (CNV-20).
- Why: While the region is off-screen it also gets size containment, and Chromium skips style, layout, paint and hit testing for its subtree. With `auto` in the intrinsic size, the browser remembers the last rendered size, so the scrollbar stops jumping after the first render.
- Detect: `rg -n 'content-visibility:\s*auto' -g '*.{css,scss,svelte,vue}'`, then check the same block for `contain-intrinsic-size`; long repeated sections of static blocks (`{#each}`, `.map(`, `v-for`) with neither `content-visibility` nor windowing (DOM-02).
- Verify: measure.md#load for a long page, or measure.md#inp for an update inside a region. Pass: the trace-summary `Style:` element count and Layout `totalObjects` are lower than the baseline, and CLS is not worse (measure.md#cls).
- Example:
  ```css
  .report-section { content-visibility: auto; contain-intrinsic-size: auto 640px; }
  ```
- Avoid: Without an intrinsic size, skipped regions collapse to 0 px, so the scrollbar jumps and content shifts. Regions in the first viewport gain nothing: never use it on the LCP area. Containment stays on while visible, so overflowing tooltips and menus are clipped: render them in the top layer (DOM-09). A layout read (`getBoundingClientRect()`, `offsetHeight`, `getComputedStyle`) inside a skipped region forces it to render and cancels the gain.
- Source: https://web.dev/articles/content-visibility ; https://drafts.csswg.org/css-contain-2/

### CSS-10 Hide views that come back soon with `content-visibility: hidden`, not `display: none`
stage: style, layout, paint · metric: INP · when: interaction, session · impact: medium — showing the view again reuses its rendering state instead of paying for a first render · support: content-visibility · also: CSS-09, CSS-18, CNV-20
- Do: For tabs, workspaces and side panels that the user switches between often, hide the inactive container with `content-visibility: hidden`. The container stays in the layout as an empty box, so stack the views in one grid cell or position them out of flow. Use `display: none` for content that rarely comes back, and remove from the DOM what will not come back.
- Why: `display: none` discards the subtree's rendering state, so showing it again costs as much as a first render; `visibility: hidden` keeps the state but keeps updating it. `content-visibility: hidden` keeps the cached state and skips all rendering work until the view is shown; web.dev reports up to 250 ms faster switches back to cached views.
- Detect: `rg -n "display:\s*none|style\.display\s*=|v-show=|hidden=\{" -g '*.{css,scss,svelte,vue,tsx,jsx,ts}'` on tab, view or workspace containers that the user switches often.
- Verify: measure.md#inp on the switch back to a view. Pass: the processing and presentation subparts, the `Style:` element count and Layout `totalObjects` of the switch are lower than with `display: none`.
- Avoid: Hidden content is not findable, focusable or in the accessibility tree, like `display: none`. The kept subtree keeps its memory. Canvas loops and looping animations inside keep running: pause them (CSS-18, CNV-20).
- Source: https://web.dev/articles/content-visibility ; https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility

### CSS-11 Use `container-type: inline-size`, and never resize query containers on every frame
stage: style, layout · metric: INP, frame · when: interaction, render-loop · impact: medium — each container size change re-runs style for the dependent subtree between layout passes · support: baseline · also: CSS-08, CSS-01
- Do: Prefer `container-type: inline-size` to `size`, and make only the components that query their size into containers. Do not animate a query container's size and do not resize it on each pointer move: during a drag-resize, preview with a transform or an outline, then commit the final size once. If the container must also isolate layout, add `contain: layout` yourself.
- Why: A container query makes style depend on the laid-out size of an ancestor, so Blink runs style and layout in turns for that subtree whenever the size changes. Size container types force an independent formatting context, but not layout containment, so they do not give the isolation of CSS-08.
- Detect: `rg -n 'container-type:\s*size|container:\s*[\w-]+\s*/\s*size' -g '*.{css,scss,svelte,vue}'`; containers whose width or height is set in a `pointermove` handler or changed by a `transition`.
- Verify: measure.md#fps during a drag-resize (or measure.md#inp for one resize). Pass: fewer `Recalculate style` and Layout events per frame in the window than the baseline, and frame p95 is not worse.
- Avoid: `container-type: size` ignores the children for the block size, so the container needs an explicit height. No vendor benchmark of container-query cost exists: treat the cost as proportional to the dependent subtree, and measure. The claim that query containers get layout containment is out of date.
- Source: https://drafts.csswg.org/css-conditional-5/ ; https://github.com/w3c/csswg-drafts/issues/10544

## §D Style recalculation scope

### CSS-12 Toggle state on the smallest element that changes, and keep selectors simple
stage: style · metric: INP, frame · when: interaction, render-loop · impact: medium — a class change on `body` or a large container invalidates every descendant that a rule such as `.state .item` can match · support: n/a · also: CSS-13, CSS-14, DOM-01
- Do: Put frequently changing classes, attributes and `:hover` rules on the leaf that changes (the row, the cell, the button), not on `html`, `body` or a list container: no `.grid:hover .cell`, no `body.dragging .item` for high-rate states. Keep page-level classes for rare changes (theme, density). Prefer one class per rule to long descendant chains, substring attribute selectors (`[class*="icon-"]`) and accidental universal selectors (`.meta ::selection`). Let inherited properties inherit instead of rules like `body * { … }`.
- Why: Blink compiles each rule into invalidation sets: with a rule `.c1 .c2`, adding `c1` to an element marks all `.c2` descendants for recalculation. Selector matching takes about half of Blink's style time, and the worst case grows with elements × selectors, so the number of elements that a change reaches usually matters more than the selector shape.
- Detect: `rg -n "(document\.body|documentElement)\.(classList|dataset|setAttribute)" -g '*.{ts,tsx,js,svelte,vue}'` inside pointer, scroll or update handlers; `rg -n '(^|\s)(body|html|:root)[.\[][^{]*\s[.#\w]' -g '*.{css,scss}'`; `rg -n ':hover\s+[.#\w]'`; `body \*` and `\* \{` rules that set many properties.
- Verify: measure.md#inp on the interaction, with Selector Stats off. Pass: the trace-summary `Style:` element count for the interaction is lower than the baseline, and the processing and presentation subparts are not worse. To find costly selectors, ask the user to record once with "Enable CSS selector stats" on.
- Example:
  ```css
  body.is-dragging .card { pointer-events: none; }         /* Before: re-checks every .card on the page */
  .board[data-dragging] > .card { pointer-events: none; }  /* After: only the board that the drag affects */
  ```
- Avoid: Engines err toward correctness, so some extra elements are always invalidated. Do not lint selectors blindly: the gain depends on DOM size and on how often the DOM changes. Selector stats add overhead, so never compare timings recorded with them on.
- Source: https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/css/style-invalidation.md ; https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations

### CSS-13 No `:nth-child()` or sibling combinators on lists that mutate; anchor `:has()` narrowly
stage: style · metric: frame, INP · when: render-loop, session · impact: medium — with such a rule, each inserted row restyles every row after it · support: baseline · also: CSS-12, DOM-02, DOM-04
- Do: On lists and tables that insert, remove or reorder rows often (live logs, feeds, sortable results), set stripe and "first N" styles as classes when the row renders; do not use `:nth-child()`, `:nth-last-child()`, `+` or `~` across such rows. Anchor `:has()` to one component (`.panel:has(> .error)`), never `body:has()`, `:root:has()` or `*:has()`, and keep its argument narrow (`>` or `+`, no trailing `*`).
- Why: When a rule uses `:nth-child()`, Blink flags the parent, and each later insertion invalidates all following siblings, so prepending one row to a 500-row list restyles about 500 rows (Igalia, Blink invalidation). For `A:has(B)`, a change to an element that can match B makes the engine check A's subtree again, and a broad anchor extends that to the whole page.
- Detect: `rg -n ':nth-(last-)?(child|of-type)|\+\s*\.|~\s*\.' -g '*.{css,scss,svelte,vue}'` on row, item or list selectors; `rg -n '(body|html|:root|\*):has\(|:has\([^)]*\*\s*\)'`.
- Verify: measure.md#fps with rows streaming in (or measure.md#inp for one insert). Pass: the trace-summary `Style:` element count per insert drops to about the number of changed rows, and frame p95 is not worse.
- Example:
  ```css
  .log > .row:nth-child(odd) { background: var(--stripe); } /* Before: a prepended row restyles all rows after it */
  .log > .row.odd { background: var(--stripe); }            /* After: class set from the entry's sequence number */
  ```
- Avoid: A render-time class stays with its row when rows are inserted above, so stripes follow items, not positions; accept that, or restripe only the visible window. Short, static lists can keep `:nth-child()`.
- Source: https://developer.mozilla.org/en-US/docs/Web/CSS/:has ; https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/css/style-invalidation.md

### CSS-14 Set fast-changing custom properties on the element that uses them, with `inherits: false`
stage: style · metric: frame, INP · when: interaction, render-loop · impact: high — a custom property changed on `:root` at pointer or update rate restyles the whole document each time · support: registered-custom-properties · also: CSS-03, CSS-12, CSS-27
- Do: Write per-frame values (a cursor position, a progress value, a live number used in styles) with `el.style.setProperty('--x', …)` on the element that uses them, never on `:root`, `html` or `body`, and register them with `@property` and `inherits: false`. Keep `:root` for rare changes such as theme tokens. Where a direct `translate` or `transform` write does the same job, prefer it.
- Why: Unregistered custom properties always inherit, so a change on `:root` invalidates style for every element. In a web.dev benchmark of about 7,000 elements, a change of an inherited property cost 3.90 ms per run, and a change of a registered `inherits: false` property cost 4.67 µs, about 835 times less; registration itself added about 0.06 ms.
- Detect: `rg -n "(documentElement|document\.body)\.style\.setProperty|:root\.style" -g '*.{ts,tsx,js,svelte,vue}'`; `setProperty('--` calls inside pointer, scroll or message handlers; `@property` blocks with `inherits: true` for values that change often.
- Verify: measure.md#fps with the value changing (a pointer or live-update scenario). Pass: the trace-summary `Style:` element count per frame drops to about the size of the consumer subtree, and frame p95 is not worse.
- Example:
  ```css
  @property --cursor-x { syntax: "<length>"; inherits: false; initial-value: 0px; }
  .cursor-line { translate: var(--cursor-x) 0; } /* script: cursorLine.style.setProperty('--cursor-x', `${x}px`), not on documentElement */
  ```
- Avoid: With `inherits: false`, children do not see the value, so set it on each consumer. Animating a custom property still runs on the main thread (CSS-03): this rule is for script writes, not for `@keyframes`. Registrations cost time in bulk (about 32 ms for 25,000), so do not generate them at run time.
- Source: https://web.dev/blog/at-property-performance

## §E Paint cost

### CSS-15 Keep repaint areas small and separate; do not animate large backgrounds or gradients
stage: paint · metric: frame · when: render-loop, interaction · impact: medium — a region that changes every frame repaints and re-rasters all that its change invalidates · support: baseline · also: CSS-02, CSS-06, DOM-04
- Do: Keep continuously changing regions (a clock, a live counter, a blinking caret, progress text) small and apart from other painted content, with `contain: paint` or a fixed-size box so the invalidation stays local. Do not animate `background-position`, `background-size`, gradient stops or `background-image` on large areas: move a separate element with `transform`, or keep the background static. Give a region its own layer only when a trace shows that its repaint is the cost.
- Why: Only compositor-run `transform`, `opacity` and `filter` changes skip paint; every other visual change repaints the invalidated area, and raster work follows the changed rectangles of each layer. A background animation repaints the whole painted area on every frame.
- Detect: `rg -n -A3 '@keyframes' -g '*.{css,scss,svelte,vue}' | rg 'background'`; `transition` on `background-*`; a small live-updating text inside a large element with a gradient, an image or a shadow.
- Verify: measure.md#fps-css (or measure.md#fps while values update). Pass: the Paint count and Paint time in the window and the `RasterTask` time (trace-summary) are lower than the baseline.
- Example:
  ```css
  /* Before: the whole banner repaints on every frame */
  .banner { animation: shift 8s linear infinite; } @keyframes shift { to { background-position: 100% 0; } }
  /* After: a pre-painted child moves on the compositor */
  .banner { position: relative; overflow: hidden; }
  .banner::before { content: ""; position: absolute; inset: 0 -50% 0 0; background: var(--banner-bg); animation: slide 8s linear infinite; }
  @keyframes slide { to { translate: -33% 0; } }
  ```
- Avoid: The moving element is a layer that costs memory as big as its box (CSS-06). Older articles say that two dirty areas merge into one screen-wide repaint; current Chromium tracks changed rectangles per layer, so that alone is no reason to restructure.
- Source: https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas ; https://chromium.googlesource.com/chromium/src/+/main/docs/how_cc_works.md

## §F Animation mechanics

### CSS-16 Declare DOM motion with CSS or `element.animate()`; sequence it with `finished`, not timers
stage: tasks, composite · metric: frame, INP · when: interaction, render-loop · impact: high — a rAF loop that writes styles needs the main thread on every frame and stops while a long task runs; a declared transform or opacity animation does not · support: baseline · also: CSS-01, CSS-17, CNV-02, CNV-03
- Do: For fixed-path motion of DOM elements (panels, toasts, popovers, highlights), use CSS transitions, `@keyframes` or `element.animate()` on `transform` and `opacity`. Keep `requestAnimationFrame` for values computed from live input and for canvas or WebGL drawing (CNV-03). Chain steps with `await anim.finished` (or `transitionend` and `animationend`), wait for `anim.ready` before you read state after `play()` or `pause()`, close with `reverse()`, and change speed with `updatePlaybackRate()`.
- Why: CSS animations and Web Animations of compositable properties run on the compositor thread, so a busy main thread does not stop them. The `finished` promise settles on the animation's own timeline, so steps stay in sync after a pause, a speed change or an interruption; a `setTimeout` with the duration drifts and still fires after a cancel.
- Detect: `rg -n "setTimeout\([^,]+,\s*\d{2,4}\s*\)" -g '*.{ts,tsx,js,svelte,vue}'` next to `classList`, `.animate(` or a `transition`; `requestAnimationFrame` loops whose body only writes `style.transform`, `style.opacity` or `style.left` along a fixed path.
- Verify: measure.md#fps-css with a CPU-heavy scenario running at the same time. Pass: frame p95 and long frames win over the rAF version, and the window has 0 Layout and 0 Paint.
- Example:
  ```ts
  // Before: a main-thread loop, then a timer that guesses the end
  const t0 = performance.now(), step = (t: number) => { const k = Math.min(1, (t - t0) / 180);
    panel.style.transform = `translateY(${40 - 40 * k}px)`; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step); setTimeout(showContent, 180);
  // After: runs on the compositor; the next step waits for the real end
  await panel.animate({ translate: ['0 40px', '0 0'] }, { duration: 180, easing: 'ease-out' }).finished;
  showContent();
  ```
- Avoid: `finished` rejects with `AbortError` when the animation is cancelled, so catch it; a CSS `animationend` listener never fires on a cancel, so cleanup also listens for `animationcancel`. When the animated property needs layout or paint, CSS versus JS makes little difference: fix CSS-01 first. Do not use WAAPI for canvas or WebGL content, and do not ship the `web-animations-js` polyfill or a large library for simple transitions.
- Source: https://web.dev/articles/animations-overview ; https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API

### CSS-17 Commit and cancel instead of an endless fill; retarget and replay without layout reads
stage: style, memory · metric: memory, INP · when: interaction, session · impact: medium — a forever-filling animation stays in the effect stack and overrides later styles, and a class-toggle replay forces style and layout in the handler · support: baseline · also: CSS-16, CSS-18, EVT-07
- Do: Make the end state the element's normal style and animate only from the start (in CSS, omit the `to` keyframe and the `forwards` fill). When a WAAPI animation must hold its end, keep `fill: 'forwards'` until `await anim.finished`, then call `anim.commitStyles()` and `anim.cancel()`. To start from where the element is now, pass only the end keyframe; do not read `getComputedStyle()` or `getBoundingClientRect()` first. To replay an effect, keep the `Animation` and call `play()`; never remove a class, read `offsetWidth` and add the class back.
- Why: A filling animation ranks above all static styles, keeps the element promoted and lives for the whole session. `commitStyles()` writes the current values into the inline style, so `cancel()` can drop the effect. A missing start keyframe makes the engine start from the current computed value, so the handler needs no layout read and an interrupted motion continues smoothly. The class-toggle replay works only because the layout read forces style and layout inside the handler.
- Detect: `rg -n "fill:\s*['\"](forwards|both)|animation-fill-mode:\s*(forwards|both)|animation:[^;]*\b(forwards|both)\b" -g '*.{css,scss,ts,tsx,js,svelte,vue}'`; `void \w+\.offset(Width|Height)` between `classList.remove` and `classList.add`; `getComputedStyle` right before `.animate(`; `.persist()` in event handlers.
- Verify: measure.md#inp on the trigger, repeated 10 times. Pass: no style or layout "Forced by script" line for the handler in trace-summary, and after the repeats `document.getAnimations().length` (read with `evaluate_script`) is back to the baseline.
- Example:
  ```ts
  // Before: forced style and layout on every click
  badge.classList.remove('pulse'); void badge.offsetWidth; badge.classList.add('pulse');
  // After: one kept Animation, replayed; nothing fills
  const pulse = badge.animate({ scale: [1, 1.15, 1] }, { duration: 240 });
  pulse.cancel(); // idle until the first trigger
  button.addEventListener('click', () => pulse.play(), { signal });
  ```
- Avoid: `commitStyles()` throws when the element is not rendered, and it applies pending styles first, so do not call it per element in a large loop. Committed values are inline styles that beat stylesheet rules until you clear them. `play()` does not restart a running animation: set `currentTime = 0` first. The browser removes replaced filling animations by itself, unless you call `persist()`: never call it on animations made per event. In Chromium, a retarget with no start keyframe that interrupts a running or filling animation of the same property runs on the main thread, so it can still jank under load; it only removes the layout read.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/Animation/commitStyles ; https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Tips

### CSS-18 Give each element one animation owner, pause hidden panels, and do not stack re-triggers
stage: layout, composite, tasks · metric: frame, INP · when: interaction, session · impact: medium — two systems that read and write one element's layout force layout inside the frame, and loops in hidden panels keep the frame pipeline busy · support: baseline · also: CSS-10, CSS-16, CNV-02, LIFE-06
- Do: Choose one owner per animated element and property: CSS or WAAPI for declarative motion, or one rAF loop for data-driven motion. Remove the other writers (a FLIP helper plus a CSS transition on the same property, a drag library plus a resize handler). When a panel is hidden by `visibility`, `opacity` or overlap, pause its animations with `panel.getAnimations({ subtree: true })` and play them when it shows. Before you start an effect again, check `el.getAnimations()`: let the running one end, or extend it with `effect.updateTiming()`. Give looping indicators an end, or a user pause through `document.getAnimations()`.
- Why: When two systems each write styles and read geometry in one frame, their reads and writes interleave, and each read forces style and layout. `getAnimations()` returns CSS animations, CSS transitions and Web Animations alike, so one call reaches all of them; `display: none` stops CSS animations, but other kinds of hiding do not.
- Detect: `rg -n "animation:[^;]*\binfinite\b|iterations:\s*Infinity" -g '*.{css,scss,ts,tsx,js,svelte,vue}'` in panels that hide without `display: none`; one element that a `transition` rule and script `style.` writes both change; `.animate(` in click or `keydown` handlers with no `getAnimations()` check.
- Verify: measure.md#fps with the panel hidden (or measure.md#inp with 10 fast triggers). Pass: with the panel hidden, the window has no Paint or style work from its animations; after the fast triggers, `el.getAnimations().length` is at most 1.
- Avoid: `getAnimations()` builds a new array on each call: call it on state changes, not on every frame. `play()` restarts animations that had already finished, so track the ones you paused. Canvas and WebGL loops are not in the list: stop them in their own loop (CNV-02). Do not block a control that the user needs at once only to protect a cosmetic animation.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/Document/getAnimations ; https://github.com/ibelick/ui-skills/blob/main/skills/fixing-motion-performance/SKILL.md

## §G Scroll effects, view transitions, reduced motion

### CSS-19 Scroll-linked effects: scroll-driven animations and `position: sticky`, not listeners
stage: composite, tasks · metric: frame, INP · when: interaction · impact: medium — scroll events reach the main thread late, so script-driven scroll effects lag and stutter under load · support: scroll-driven-animations · also: EVT-11, CSS-01
- Do: For progress bars, reveal-on-scroll, header shrink and parallax, use `animation-timeline: scroll()` or `view()` (or `new ScrollTimeline()` and `new ViewTimeline()` with `element.animate()`), and animate only `transform` and `opacity`. Write `animation-timeline` after the `animation` shorthand, because the shorthand resets it. For view timelines, pick `animation-range` (`entry`, `exit`, `contain`) so the effect ends while the element is visible. Use `position: sticky` for headers and toolbars that stick. If the Chromium floor in support.md is below this feature, wrap it in `@supports (animation-timeline: scroll())` and show the static state.
- Why: Scroll-driven animations use the same model as CSS animations, so a timeline that animates compositable properties runs off the main thread and stays in step with scrolling. In Chrome's case study, heavy main-thread script made the scroll-listener version stutter, and the CSS version was not affected.
- Detect: `rg -n "addEventListener\(\s*['\"]scroll['\"]" -g '*.{ts,tsx,js,svelte,vue}'` whose handler writes `style.` or toggles a class for a visual effect; IntersectionObserver callbacks that only add a reveal class; `animation-timeline` written before an `animation:` shorthand in the same rule.
- Verify: measure.md#fps with a scroll scenario and a CPU-heavy task running. Pass: frame p95 and long frames win over the listener version, and trace-summary shows no scroll-handler `Event` time in the window.
- Example:
  ```css
  .read-progress { transform-origin: 0 50%; animation: grow linear both; animation-timeline: scroll(root block); }
  @keyframes grow { from { scale: 0 1; } to { scale: 1 1; } }
  ```
- Avoid: A timeline that animates `width` or `top` brings the main-thread work back. The scroller must overflow, or there is no timeline, and Chromium falls back to the main thread when the scroller is not composited. With the default `cover` range, a view timeline reaches 100% only off-screen. Do not add a polyfill that brings a scroll listener back. This replaces "throttle or debounce the scroll handler" for visual effects (EVT-11).
- Source: https://developer.chrome.com/blog/scroll-animation-performance-case-study ; https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations

### CSS-20 Keep view transitions small: data first, a short DOM-swap callback, few named elements
stage: tasks, composite, layout · metric: INP, frame, memory · when: interaction · impact: medium — the page is frozen until the update callback settles, and each named element becomes a snapshot and a layer · support: view-transitions · also: CSS-06, CSS-01
- Do: Fetch data and build state before you call `document.startViewTransition()`, and keep the callback to the DOM swap, with a short timeout on any wait for fonts or images. Give `view-transition-name` only to the few elements that need their own motion; for many elements, keep the root cross-fade. When a named element keeps its size, keep the old and new boxes the same size, so the group animation stays a transform.
- Why: Chrome's docs say that the page is frozen while the callback runs. Snapshots come from the compositor, but each named element is captured as its own layer, and the default `::view-transition-group` animation changes `width` and `height`, which runs layout on every frame when the size differs.
- Detect: `rg -n 'startViewTransition\(' -g '*.{ts,tsx,js,svelte,vue}'`, then check for `await fetch` or other network waits inside the callback; `rg -n 'view-transition-name'` on repeated elements (rows, cards) or set in a loop.
- Verify: measure.md#inp on the interaction that starts the transition. Pass: the presentation delay subpart and the long frames during the transition are lower than the baseline, and the transition window has few Layout events.
- Avoid: Many named elements cost snapshot memory (a blog claim, not measured here). A render-blocking wait for a cross-document transition delays the first render: measure it first (html-loading.md).
- Source: https://developer.chrome.com/docs/web-platform/view-transitions/same-document ; https://developer.chrome.com/blog/view-transitions-misconceptions

### CSS-21 Honor reduced motion in CSS and in script: WAAPI, rAF, canvas and WebGL; listen for `change`
stage: tasks, composite · metric: frame · when: render-loop, session · impact: medium — script motion ignores the CSS media query, so without code the setting does nothing for WAAPI, canvas and WebGL motion · support: baseline · also: CSS-16, CSS-18, LIFE-01
- Do: Put decorative CSS motion inside `@media (prefers-reduced-motion: no-preference)`, and give the reduced variant an instant change or a short fade, so that state feedback stays. In script, read `matchMedia('(prefers-reduced-motion: reduce)')` once, branch on `.matches` before you start motion (duration 0, a jump instead of an animated zoom or pan, no start-up sweep in charts), and listen for `change` to end or restart running motion.
- Why: The browser applies CSS media queries by itself, but script only knows the setting when it reads it. The setting asks for non-essential motion to be removed or reduced, because large pans, zooms and parallax can cause vestibular symptoms; it also removes frame work for those users.
- Detect: files with `.animate(`, `requestAnimationFrame` loops, chart animation options or `animation:` rules and no `prefers-reduced-motion`; `rg -n "\.addListener\("` on a `MediaQueryList` (deprecated); `matchMedia\(['\"]prefers-reduced-motion` without the parentheses (an invalid query).
- Verify: measure.md#fps-css on the reduced path (ask the user to turn on the OS setting; the MCP `emulate` tool has no reduced-motion option). Pass: the trigger leaves no running motion in `document.getAnimations()` (read with `evaluate_script`), and the window has no per-frame Paint or animation-frame work from it.
- Example:
  ```ts
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  reduce.addEventListener('change', () => { if (reduce.matches) for (const a of document.getAnimations()) a.cancel(); }, { signal }); // base styles hold the end state (CSS-17)
  panel.animate({ opacity: [0, 1] }, { duration: reduce.matches ? 0 : 200 });
  ```
- Avoid: "Reduce" does not mean "no feedback": keep state changes readable. A global `* { animation-duration: 1ms !important }` reset does not reach WAAPI, rAF, canvas or WebGL motion, and `animation: none` stops `animationend` events that code may wait for. A `<link media="(prefers-reduced-motion: no-preference)">` stylesheet is still downloaded, at low priority; it only stops blocking render. Remove the `change` listener with its owner (LIFE-01).
- Source: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion ; https://web.dev/articles/prefers-reduced-motion

## One-line rules

- **CSS-22** Set `text-wrap: balance` only on short headings and captions (Chromium balances only blocks of up to six lines), never on `*` or on live-updating text. [layout · INP · low] https://developer.chrome.com/docs/css-ui/css-text-wrap-balance
- **CSS-23** Stop scroll chaining from side panels, dialogs and dropdown lists with `overscroll-behavior: contain`, not with a non-passive `touchmove` or `wheel` listener that calls `preventDefault()`. [composite · frame · low] https://developer.chrome.com/blog/overscroll-behavior
- **CSS-24** Keep scroll anchoring on; set `overflow-anchor: none` only on a scroller that places content itself (a feed that pins new rows at the top), and do not animate position or size on the anchor node. [layout · CLS · low] https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll_anchoring/Scroll_anchoring
- **CSS-25** Draw deliberately low-resolution canvases (heatmaps, pixel grids) into a small backing store and enlarge them with CSS and `image-rendering: pixelated`; keep the default for photos and anti-aliased lines. [paint · frame · low] https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering
- **CSS-26** End exit animations with the element out of rendering: `display` in the exit keyframes (or `transition-behavior: allow-discrete`), or `style.display = 'none'` when `finished` resolves (an author `display` rule overrides the `hidden` attribute); a panel left at `opacity: 0` still costs layout, paint and hit testing. [layout · frame · medium] https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Animations/Using
- **CSS-27** Ship static CSS: do not insert style rules on hot paths (a new CSS-in-JS class per value, `insertRule` or a new `<style>` per update), because the next style update re-checks the whole tree scope; put per-instance values in inline styles or custom properties. [cssom · INP · medium] https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/style_engine.cc
- **CSS-28** For many instances of one web component, share one constructed stylesheet (`new CSSStyleSheet()`, `replaceSync()`, `adoptedStyleSheets`) and treat it as static: a change to it restyles every shadow root that adopts it. [cssom · memory · low] https://web.dev/articles/constructable-stylesheets
- **CSS-29** Size the grid tracks of live-updating panels with `minmax(0, 1fr)` or fixed lengths, not `auto` or content-sized tracks, and give grid and flex items `min-width: 0`, so a text change in one cell cannot re-size the whole grid. [layout · frame · medium] https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing
- **CSS-30** To lay out and measure an element before you reveal it, hide it with `visibility: hidden`, not by covering it or moving it off-screen in flow: a covered element that moves still counts as a layout shift. [layout · CLS · low] https://web.dev/articles/debug-layout-shifts
- **CSS-31** Build carousels and horizontal card rows with CSS scroll snap (`scroll-snap-type`, `scroll-snap-align`) before a JS library, and move a scripted track with `transform`, never `left` or `margin`. [composite · INP · low] https://developer.chrome.com/blog/carousels-with-css
