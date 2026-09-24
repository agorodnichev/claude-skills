# Verify: 05-css-rendering.md

Summary: 46 items checked. 33 verified, 11 corrected, 2 disputed, 0 unverified.

Data used (checked 2026-09-23):
- MDN browser-compat-data 8.1.2 (timestamp 2026-09-17), `raw/bcd.json`. web-features snapshot with Safari 27 (2026-09-14), Chrome 153, Firefox 156, `raw/web-features.json`. Query helper: `raw/verify/04/q.py`.
- Chromium `main` files fetched again on 2026-09-23 (saved in `raw/verify/05/`): `compositing_reasons.h`, `css_properties.json5`, `clip_path_paint_definition.cc`, `paint_layer.cc`, `picture_layer_impl.cc`, `layer_impl.cc`, `property_tree_manager.cc`. Also `runtime_enabled_features.json5` for branch-heads 7339 (M140) and 7390 (M141), added to the saved 142–155 files.
- WebKit `main`: `CSSProperties.json`, `GraphicsLayerCA.cpp`, `PlatformCALayerCocoa.mm`. Firefox `main`: `servo/components/style/properties/longhands.toml`. Lighthouse `main`: `core/config/default-config.js` (release 13.5.0, 2026-09-17).
- The research's own saved pages in `raw/css-rendering/`. Safari 26.4 notes in `raw/canvas2d/webkit-safari264.html`. Safari 27 notes in `raw/verify/02/safari27.txt`.

---

### Animate only properties that the compositor can run
- Verdict: verified
- Note: All three engine rows match the current source. Chromium: `compositor_animations.cc` accepts `kBackdropFilter`, `kFilter`, `kOpacity`, `kRotate`, `kScale`, `kTransform`, `kTranslate`, `kBackgroundColor`, `kClipPath`, and `kVariable` only through a paint worklet. Firefox: `CAN_ANIMATE_ON_COMPOSITOR` is on `background-color`, `opacity`, `transform`, `translate`, `rotate`, `scale`, and `offset-anchor/-distance/-path/-position/-rotate`. `gfx.omta.background-color` is `true`. WebKit: `animation-wrapper-acceleration` is "always" on `opacity`, `filter`, `backdrop-filter`, `transform`, `translate`, `scale`, `rotate`, and "threaded-only" on `offset-*`. Source name: the Firefox flag now lives in `servo/components/style/properties/longhands.toml`, and `ServoCSSPropList.h` is generated from it. Individual transforms: Baseline low 2022-08-05, high 2025-02-05.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.cc ; https://raw.githubusercontent.com/mozilla-firefox/firefox/main/servo/components/style/properties/longhands.toml ; https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/css/CSSProperties.json ; web-features `individual-transforms`

### Rewrite geometry animations as transform animations (FLIP, scaleX progress bars)
- Verdict: verified
- Note: The Chrome blog says: "as long as the layout size is not changing", percentage transforms are composited from Chromium 89. Lighthouse says non-composited animations "can also increase the Cumulative Layout Shift (CLS)".
- Evidence: https://developer.chrome.com/blog/hardware-accelerated-animations ; https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations

### Fade a pre-blurred layer instead of animating the blur radius
- Verdict: corrected
- Correction: The Chromium part is correct (`kFilterRelatedPropertyMayMovePixels`). The WebKit sentence is wrong. `GraphicsLayerCA::createFilterAnimationsFromKeyframes` does not hardware-animate any filter list that contains `drop-shadow()`: "FIXME: We can't currently hardware animate shadows." The rule "drop-shadow() only if it is last" (`PlatformCALayerCocoa::filtersCanBeComposited`) is for static composited filters, not for animations. WebKit can hardware-animate `blur()`, so this technique helps mainly in Chromium. Keep it as cross-engine advice, because the pre-blurred layer is also cheap in WebKit.
- Evidence: https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/graphics/ca/GraphicsLayerCA.cpp ; https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/graphics/ca/cocoa/PlatformCALayerCocoa.mm ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.h

### Keep a composited animation eligible: avoid the known fallback conditions
- Verdict: verified
- Note: All 8 `FailureReason` names are in current `compositor_animations.h`. `kTargetHasInvalidCompositingState` is set when `SubtreeWillChangeContents()` is true (source comment: "Elements with subtrees containing will-change: contents are not composited for animations"). Nuance: Chrome does not expose `KeyframeEffect.iterationComposite` (BCD: Chrome no, Firefox 80, Safari 16.4). The Chromium reason exists, but web code cannot trigger it through WAAPI in Chrome. `non-composited-animations` is still a diagnostic in Lighthouse `main` (13.5.0).
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.h ; https://raw.githubusercontent.com/GoogleChrome/lighthouse/main/core/config/default-config.js ; BCD `api.KeyframeEffect.iterationComposite`

### Do not rely on composited background-color or clip-path animations across browsers
- Verdict: corrected
- Correction: The version numbers are confirmed. `CompositeBGColorAnimation` is "experimental" in M140 (7339) and M141 (7390), and "stable" from M142 (7444). `CompositeClipPathAnimation` is "experimental" through M151 (7922), and "stable" from M152 (7977). Two conditions need a fix. (1) Any `shape()` that has an arc command is not composited. The check rejects all `kPathSegArcAbs`/`kPathSegArcRel` segments, not only arcs with different radii. The source comment gives different radii as the reason. (2) background-color also falls back when colors are changed at paint time (source: "Prevent compositing when colors are modified at paint-time"). Note: `CompositeBGColorAnimation` has `base_feature: "none"`, so Finch cannot turn it off. `CompositeClipPathAnimation` has a default base feature, so a kill switch is possible.
- Evidence: https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7390/third_party/blink/renderer/platform/runtime_enabled_features.json5 ; https://chromium.googlesource.com/chromium/src/+/refs/branch-heads/7444/third_party/blink/renderer/platform/runtime_enabled_features.json5 ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/csspaint/nativepaint/clip_path_paint_definition.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/csspaint/nativepaint/background_color_paint_definition.cc

### Use CSS animations or WAAPI, not per-frame style writes, and do not animate custom properties on hot paths
- Verdict: verified
- Note: web.dev: transform/opacity animations "are typically handled on a thread known as the compositor thread". The at-property article: custom properties "registered or not–animate on the Main Thread". Current Chromium still allows `kVariable` only through a paint worklet.
- Evidence: https://web.dev/articles/animations-overview ; https://web.dev/blog/at-property-performance ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.cc

### Drive scroll-linked effects with scroll-driven animations of composited properties
- Verdict: verified
- Note: BCD `css.properties.animation-timeline`: Chrome 115, Safari 26, Firefox "preview" (Nightly only). The Chrome case study says the gains are "available from Chrome 116". Safari 26.4: "animations driven by scroll position run on the compositor thread".
- Evidence: https://developer.chrome.com/blog/scroll-animation-performance-case-study ; https://webkit.org/blog/17862/webkit-features-for-safari-26-4/ ; web-features `scroll-driven-animations`

### Keep view transitions small: short update callback, few named elements
- Verdict: verified
- Note: The same-document doc says: "During this time, the page is frozen" and "This optimization hasn't been implemented yet" (about `width`/`height` on `::view-transition-group`). The misconceptions post says snapshots come "directly from the compositor". I did not find a source for the claim that "the old view stays visible for a few frames". Status: same-document Baseline low 2025-10-14 (Firefox 144). Cross-document: Chrome 126, Safari 18.2. `Element.startViewTransition`: Chrome 147 only.
- Evidence: https://developer.chrome.com/docs/web-platform/view-transitions/same-document ; https://developer.chrome.com/blog/view-transitions-misconceptions ; BCD `api.Element.startViewTransition`

### Remove non-essential motion for users who ask for reduced motion
- Verdict: verified
- Note: `prefers-reduced-motion` is Baseline high (low 2020-01-15). MDN: "cut down on all unnecessary animations" and offer a control for low-powered devices.
- Evidence: https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/CSS

### Promote only elements that will animate, only while they animate
- Verdict: verified
- Note: Smashing's figures are correct (800×600×4×10 ≈ 19 MB). The texture formula is an upper bound. Chromium rasters only tiles near the viewport, and a solid-color layer needs no texture ("no need to spend raster work or gpu memory on it", How cc Works). `will-change` is Baseline high, low 2020-01-15.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/CSS/will-change ; https://www.smashingmagazine.com/2016/12/gpu-animation-doing-it-right/ ; https://chromium.googlesource.com/chromium/src/+/main/docs/how_cc_works.md

### Prevent layer explosion from overlap (implicit compositing)
- Verdict: verified
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing_reasons.h (`kOverlap`: "based on overlapping relationship among pending layers")

### Know which CSS creates a compositing layer, and do not add one by accident
- Verdict: verified
- Note: All the reasons in the list exist in current `compositing_reasons.h` (`kTrivial3DTransform`, `kWillChangeClipPath`, `kWillChangeMixBlendMode`, `kWillChangeMask`, `kAnchorPosition`, `kFixedPosition`, `kStickyPosition`, `kCanvas`, `kIFrame`, `kVideo`, `kOverflowScrolling`, `kBackfaceVisibilityHidden`, `kViewTransitionElement`). The list leaves out `kPreserve3DWith3DDescendants`, `kPerspectiveWith3DDescendants`, and `kFixedAttachmentBackground`. The high-DPI note for fixed elements comes from a web.dev page from 2015.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing_reasons.h

### Do not keep `will-change: transform` on content you zoom by script if it must stay sharp
- Verdict: verified
- Note: chromestatus 5637351992721408 (Chrome 53) is confirmed. Current `picture_layer_impl.cc` gives more detail: a `will-change: transform` layer keeps its raster scale while it is at least `MinimumRasterContentsScaleForWillChangeTransform()`. That minimum is the native scale (DPR × page scale), or 0.25 × ideal when the ideal scale is below 0.25 × native. So scaling up above 1× stays at native resolution and looks blurry. Scaling down keeps the higher-resolution raster.
- Evidence: https://chromestatus.com/feature/5637351992721408 ; https://chromium.googlesource.com/chromium/src/+/main/cc/layers/picture_layer_impl.cc

### Keep layer textures small (scale up a small layer when quality allows)
- Verdict: disputed
- Correction: In current Chromium this saves no texture memory for painted content. `LayerImpl::GetIdealContentsScale()` uses the screen-space transform, and `RecalculateRasterScales()` sets `raster_contents_scale_ = ideal_contents_scale_`. So a 10×10 box with `scale(10)` is rastered at about 100×100 CSS px × DPR², the same as a 100×100 box. With `will-change: transform`, the raster scale is never below the native scale. Two exceptions: a solid-color layer uses no texture at all, and a "directly composited image" (a layer with only one image draw) is rastered near the image's intrinsic size. The Smashing numbers (400 vs 40,000 bytes) are from 2016 and do not match current Chromium code. I did not check WebKit. For images, use a small image, not a small box.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/cc/layers/layer_impl.cc ; https://chromium.googlesource.com/chromium/src/+/main/cc/layers/picture_layer_impl.cc ; https://chromium.googlesource.com/chromium/src/+/main/docs/how_cc_works.md

### Put `contain: content` on independent widgets, and `contain: strict` plus a size on fixed panels
- Verdict: corrected
- Correction: The Safari "conflict" is not real. BCD `css.properties.contain.style` has Safari 15.4–27 with the note "Style containment does not affect quotes", and Safari 27 full. Safari 27 notes: "adds support for contain: style applying to CSS quotes". So style containment works from Safari 15.4, and only quote scoping is new in 27. Replace the caveat with: "In Safari before 27, `contain: style` does not scope quotes." Add a Safari caveat: Safari 27 "Fixed a performance issue where contain: layout caused significantly slower forced layouts when all siblings created their own formatting context". The CSS Wizardry numbers are confirmed: 11.21 ms / 4,371 nodes / 41 relaid, then 1.89 ms / 73 nodes / 40 relaid.
- Evidence: BCD 8.1.2 `css.properties.contain.style` ; https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ; https://csswizardry.com/2026/04/what-is-css-containment-and-how-can-i-use-it/

### Skip offscreen sections with `content-visibility: auto` and `contain-intrinsic-size: auto <length>`
- Verdict: corrected
- Correction: The sentence "The `auto` value arrived in Safari 26 (BCD), so it is not in Safari 18 to 25" is wrong. BCD `css.properties.content-visibility.auto`: Safari 18 partial ("Skipped content is not findable via find-in-page"), and Safari 26 full. Safari versions 19 to 25 do not exist. Correct text: "`auto` skips rendering from Safari 18. Find-in-page reaches skipped content only from Safari 26." The other numbers are confirmed: 232 ms → 30 ms ("7x"), the `aria-hidden="true"` advice, and the Chromium console messages.
- Evidence: BCD 8.1.2 `css.properties.content-visibility.auto` ; https://web.dev/articles/content-visibility ; web-features `content-visibility` (low 2025-09-15)

### Hide inactive views with `content-visibility: hidden`, not `display: none`, when you will show them again soon
- Verdict: verified
- Note: BCD `content-visibility.hidden`: Chrome 85, Firefox 125, Safari 18. Facebook "up to 250ms improvement" is in web.dev.
- Evidence: https://web.dev/articles/content-visibility ; BCD `css.properties.content-visibility.hidden`

### Stop canvas and WebGL render loops for charts that the browser skips
- Verdict: verified
- Note: BCD `contentvisibilityautostatechange`: Chrome 108, Firefox 130 (124–129 partial: no `on…` handler property, so `addEventListener` works from 124/125), Safari 18. For SciChart, 13-scichart.md recommends the built-in `freezeWhenOutOfView: true` (and `suspendUpdates()`/`resumeUpdates()`), so the placeholder names `suspendRendering`/`resumeRendering` should point there.
- Evidence: BCD `api.Element.contentvisibilityautostatechange_event` ; https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility

### Use `container-type: inline-size`, and do not resize query containers on every frame
- Verdict: verified
- Note: The spec change log says "Dimensional query containers no longer apply layout containment" (CSSWG #10544: "does not force layout containment, but does force an independent formatting context"). Browsers made the change in Chrome 129, Firefox 133, and Safari 18.4 (BCD `container-type.weak_containment`). The CSS Wizardry sentence describes the older behavior. If you want layout isolation, add `contain: layout` yourself.
- Evidence: https://drafts.csswg.org/css-conditional-5/ ; https://github.com/w3c/csswg-drafts/issues/10544 ; BCD `css.properties.container-type.weak_containment`

### Write simple, targeted selectors, then check the costly ones with Selector Stats
- Verdict: verified
- Note: web.dev: "Roughly half of the time". Edge: "more than 900 milliseconds" to "around 300ms", about 5000 elements, CPU slowed 4×. The column names match Chrome and Edge docs. Edge's "Invalidation count" column was added in Edge 140 ("aggregated count of DOM nodes ... invalidated"). Edge 109 is correct for the first Selector Stats release.
- Evidence: https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations ; https://blogs.windows.com/msedgedev/2023/01/17/the-truth-about-css-selector-performance/ ; https://learn.microsoft.com/en-us/microsoft-edge/devtools/whats-new/2025/09/devtools-140

### Toggle state on the smallest element that needs it
- Verdict: verified
- Evidence: https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/css/style-invalidation.md ; https://blogs.igalia.com/blee/posts/2023/05/31/how-blink-invalidates-styles-when-has-in-use.html

### Do not style frequently-mutated lists with `:nth-child()` or sibling combinators
- Verdict: verified
- Note: Igalia: "If the flag set, the style engine invalidates all next siblings of the inserted element". The flag is set only when the rest of the compound matches (`.row`), which is true in the example.
- Evidence: https://blogs.igalia.com/blee/posts/2023/05/31/how-blink-invalidates-styles-when-has-in-use.html

### Anchor `:has()` to narrow containers and limit its argument
- Verdict: verified
- Note: MDN's "Performance considerations" section matches the rules and examples (`body`/`:root`/`*` anchors, `>`/`+`, `.ancestor:has(.foo > *)`). Baseline high date 2026-06-19.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/CSS/:has ; web-features `has`

### Keep fast-changing custom properties off `:root`, and register them with `inherits: false`
- Verdict: corrected
- Correction: The benchmark tree is not "about 1,000 nodes". `makeTree($container, 1000)` makes 1,001 wrapper `div`s, each with 6 nested elements (about 7,000 elements). Numbers: unregistered inherited property 3.90 ms per run, registered `inherits: false` 4.67 µs per run (about 835×, not 850×). Registering an inherited property adds 0.06 ms. 25,000 registrations cost "a little over 30ms" (32.42 ms). `registered-custom-properties` Baseline low 2024-07-09 is confirmed.
- Evidence: https://web.dev/blog/at-property-performance ; web-features `registered-custom-properties`

### Reduce the number of elements that match style rules
- Verdict: verified
- Evidence: https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations ; https://blogs.windows.com/msedgedev/2023/01/17/the-truth-about-css-selector-performance/

### Apply `text-wrap: balance` only to short headings
- Verdict: verified
- Note: The Chrome doc says: "only works for six wrapped lines and under" and "may impact page render speed". `text-wrap-balance` Baseline low 2024-05-13. `text-wrap-pretty`: Chrome 117, Safari 26, no Firefox.
- Evidence: https://developer.chrome.com/docs/css-ui/css-text-wrap-balance ; BCD `css.properties.text-wrap.pretty`

### Batch layout reads before style writes (no forced synchronous layout)
- Verdict: verified
- Note: `PerformanceScriptTiming.forcedStyleAndLayoutDuration`: Chrome 123 only. The `forced-reflow-insight` is in Lighthouse `main`.
- Evidence: BCD `api.PerformanceScriptTiming.forcedStyleAndLayoutDuration` ; https://raw.githubusercontent.com/GoogleChrome/lighthouse/main/core/config/default-config.js

### Know which property changes cause layout, paint, or only property-tree updates (current Blink data)
- Verdict: corrected
- Correction: Almost every `invalidate` value in the table matches `css_properties.json5` on 2026-09-23. But `z-index` is not a property-tree-only change. `PaintLayer` sets `SetNeedsRepaint()` on the containing stacking context when `z_index_changed` is true ("we do need to repaint the containing stacking context, in order to generate new paint chunks in the correct order"). Move `z-index` to "paint (stacking context repaint)". `clip-path` has its own `clip-path` invalidation. Outside the Chrome 152+ composited-animation path, a clip-path change repaints, and item "Do not rely on composited background-color or clip-path animations" in this file says so ("Other cases paint on every frame"). Label `clip-path` as "clip property plus paint", not compositing only. `background-*` properties have no `invalidate` field in the file.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/paint/paint_layer.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/css_properties.json5

### Make repaint areas small and separate
- Verdict: disputed
- Correction: The Do line is fine. The Why line comes from web.dev (2015): "browsers union together two areas that need painting, and that can result in the entire screen being repainted". That does not describe current Chromium. How cc Works separates paint invalidation (Blink), raster invalidation ("parts of a layer that have changed and need to be re-rastered"), and damage ("draw invalidation", used for partial swap). Raster work follows the changed rects in each layer. The union happens only when the frame is drawn. I did not measure it, so I mark this as disputed and not as corrected.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/docs/how_cc_works.md (section "Damage") ; https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas

### Do not repaint blur effects often (box-shadow, filter blur, text-shadow)
- Verdict: verified
- Evidence: https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas

### Do not place `backdrop-filter` over content that changes every frame
- Verdict: verified
- Note: VitePress issue #1049 is confirmed ("improves the framerate by almost 30%"). Firefox bug 1718471 ("backdrop-filter: blur is laggy when many elements are rendered") is RESOLVED FIXED, so it is historical evidence for Firefox. Baseline low 2024-09-16 is confirmed.
- Evidence: https://github.com/vuejs/vitepress/issues/1049 ; https://bugzilla.mozilla.org/show_bug.cgi?id=1718471 ; web-features `backdrop-filter`

### Do not wrap animated layers or canvases in rounded `overflow: hidden` clips without need
- Verdict: corrected
- Correction: The source settles this. Blink `PropertyTreeManager::ShaderBasedRRect()` uses the fast shader path (`is_fast_rounded_corner`) for ancestor rounded clips too. Otherwise it uses a render surface with `RenderSurfaceReason::kRoundedCorner` and a mask layer. The fast path fails when: (1) a corner is elliptical (horizontal radius ≠ vertical radius); (2) on macOS the four radii are not equal ("Rounded corners that differ are not supported by the CALayerOverlay system on Mac"), which confirms the unverified claim; (3) the transform between the clip and the layer is more than a 2D translation (scale or rotate); (4) the clip is a `clip-path`; (5) rounded clips are nested (the outer ones force render surfaces). Replace the Do line with: "Use one uniform, circular radius. Do not put scaled or rotated composited content in a rounded clip. Do not nest rounded clips around animated layers." Rounding the element itself is not required.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing/property_tree_manager.cc ; https://chromium.googlesource.com/chromium/src/+/main/cc/trees/effect_node.h

### Do not animate large gradient or image backgrounds, and do not ship oversized images
- Verdict: verified
- Note: The cited `css_properties.json5` has no `invalidate` field for `background-position`, `background-size`, or `background-image`, so it does not support the "paint-only" claim directly. The claim is still correct.
- Evidence: https://www.smashingmagazine.com/2016/12/gpu-animation-doing-it-right/

### Use `image-rendering: pixelated` for deliberately upscaled low-resolution canvases
- Verdict: verified
- Note: MDN text is confirmed. BCD details: `smooth` is supported only in Firefox 93. `optimizeSpeed` is deprecated and not supported in Chrome. Unprefixed `crisp-edges` arrived in Chrome 148. `image-rendering` Baseline low 2021-10-05.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering ; BCD `css.properties.image-rendering.*`

### Inline critical CSS and load the rest without blocking render
- Verdict: corrected
- Correction: The `rel="preload" as="style"` + `onload` swap fetches the non-critical sheet at Highest priority. web.dev: "preload `as="style"` uses Highest priority". It then competes with the LCP image and fonts. Use `<link rel="stylesheet" href="/app.css" media="print" onload="this.media='all'">` plus the `<noscript>` fallback. A sheet with a media mismatch is fetched at Lowest priority. Or add `fetchpriority="low"` to the preload. The CSP caveat also applies to this pattern. The 14 KB compressed target and the tools are confirmed.
- Evidence: https://web.dev/articles/fetch-priority ; https://web.dev/articles/extract-critical-css ; https://web.dev/articles/defer-non-critical-css

### Remove unused CSS and split CSS by route
- Verdict: verified
- Evidence: https://web.dev/learn/performance/optimize-resource-loading

### Replace CSS `@import` with `<link>` elements
- Verdict: corrected
- Correction: "the preload scanner cannot see" is true only for `@import` inside an external stylesheet. Chromium's HTML preload scanner runs `CSSPreloadScanner` over inline `<style>` text and preloads `@import` rules, including `layer` and `layer(name)` imports (`CanPreloadImportRule()`). WebKit also has a CSS preload scanner: Safari 27 fixed it "failing to preload @import rules that follow an @layer statement rule". This is the same correction as in 02-course-loading.verify.md.
- Evidence: `raw/verify/02/css_preload_scanner.cc` (Chromium `main`) ; https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ; https://web.dev/learn/performance/optimize-resource-loading

### Put a `media` attribute on conditional stylesheets
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/CSS ; https://web.dev/articles/fetch-priority ("CSS (media mismatch)" at the lowest priority)

### Choose `font-display` by role: `optional` plus preload for body text, `swap` only with a metric-matched fallback
- Verdict: verified
- Note: web.dev: "Starting in Chrome 83", and "This timeout period is currently set at 100ms". This behavior is documented for Chrome only. Lighthouse `main` has `font-display-insight`, and Lighthouse 13.0 removed the old audits that insights replaced.
- Evidence: https://web.dev/articles/preload-optional-fonts ; https://raw.githubusercontent.com/GoogleChrome/lighthouse/main/core/config/default-config.js

### Build a metric-matched fallback `@font-face` with `size-adjust` and metric overrides
- Verdict: corrected
- Correction: The text "`src: local("Arial")` (plus `local("Roboto")` for Android)" can be read as one face with two local sources. That is wrong, because `size-adjust` and the overrides depend on the fallback font. Use one face for each local font: `poppins-fallback` (`local("Arial")`, `size-adjust: 60.85099821%`) and `poppins-fallback-android` (`local("Roboto")`, `size-adjust: 55.5193474%`), both listed in `font-family`. The formulas, "~90%" of Google Fonts that are OS-independent, and the support data are confirmed: `size-adjust` Chrome 92 / Firefox 92 / Safari 17; overrides Chrome 87 / Firefox 89 / Safari "preview" (BCD 8.1.2, after the Safari 27 release).
- Evidence: https://developer.chrome.com/blog/font-fallbacks ; BCD `css.at-rules.font-face.ascent-override` ; web-features `font-metric-overrides`

### Subset fonts and scope them with `unicode-range`
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/CSS

### Reserve the scrollbar gutter where content can overflow later
- Verdict: verified
- Note: BCD: Chrome 94, Firefox 97, Safari 18.2. Baseline low 2024-12-11.
- Evidence: web-features `scrollbar-gutter`

### Make touch and wheel listeners passive, and declare chart gestures with `touch-action`
- Verdict: verified
- Note: The Chrome blog says: "In Chrome 56, we fixed this issue for touchstart and touchmove" and "Now in Chrome 73" for wheel. BCD adds: passive by default for touch in Firefox 61 and Safari 11.1 / iOS 11.3. Passive by default for wheel in Firefox 84, and not in Safari. Lighthouse 13.0 removed `uses-passive-event-listeners`.
- Evidence: https://developer.chrome.com/blog/scrolling-intervention-2 ; BCD `api.EventTarget.addEventListener.options_parameter.options_passive_parameter_default_true_touch` / `_wheel` ; Lighthouse CHANGELOG 13.0.0

### Use `overscroll-behavior: contain` on nested scrollers instead of JS scroll locks
- Verdict: verified
- Note: BCD: Chrome 63–144 partial and 144 full. Firefox 59–150 partial and 150 full. Safari 16 partial ("no effect on scroll containers that have no scrollable overflow"). web-features: not Baseline.
- Evidence: BCD `css.properties.overscroll-behavior` ; web-features `overscroll-behavior`

### Keep scroll anchoring on, and opt out only per container
- Verdict: verified
- Note: MDN suppression triggers and "cannot be opted back in" are confirmed. Baseline low 2026-09-14 (Safari 27).
- Evidence: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll_anchoring/Scroll_anchoring ; web-features `overflow-anchor`

### Check rendering changes with the right DevTools view before and after
- Verdict: corrected
- Correction: "In Firefox, use ... the Waterfall 'Recalculate Style' markers" is out of date. Firefox removed the old Performance panel and its Waterfall (the old code was removed in Firefox 102). The Performance panel is now the Firefox Profiler, and style and layout work show in the Marker Chart as "Styles" and "Reflow" markers. The other claims are confirmed: web.dev "you should aim for around 4-5ms" of compositing, Safari 26.4 Layers tab "shows actual composited layer snapshots", and the Selector Stats columns. Edge's extra "Invalidation count" column is from Edge 140.
- Evidence: https://hacks.mozilla.org/2022/03/performance-tool-in-firefox-devtools-reloaded/ ; https://firefox-source-docs.mozilla.org/tools/profiler/markers-guide.html ; https://webkit.org/blog/17862/webkit-features-for-safari-26-4/ ; https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count

---

## Cross-file conflicts

1. Loading non-critical CSS. 05 (item "Inline critical CSS...") recommends `rel=preload` + `onload`. 01-critical-rendering-path.md:449 says "Do not use the old `rel=preload` + `onload` swap ... preload gives it top priority (priority inversion)" and uses the `media="print"` swap. The evidence supports 01 (web.dev fetch-priority: preload `as="style"` = Highest).
2. Composited background-color / clip-path. 01-critical-rendering-path.md:740 says the "shipping status was not verified". 05 shows (and this check confirms) stable from M142 and M152. 01 is out of date.
3. `content-visibility: auto` in Safari. 05:315 and 01-critical-rendering-path.md:649 say "`auto` since Safari 26", and 15-gaps-round-2.md:397 says "`content-visibility: auto` only from Safari 26". BCD and 15-gaps-round-1.md:72 say Safari 18 (partial, find-in-page only), full in 26.
4. `contain: style` in Safari. 05:298 and 05:963 leave the conflict open. 15-gaps-round-1.md:45 resolves it the same way as this report (Safari 15.4 without quote scoping, 27 full).
5. Passive by default. 01-critical-rendering-path.md:885 says "Browsers other than Safari already default `passive: true` for wheel/touchstart/touchmove". BCD: Safari has passive-by-default touch (11.1 / iOS 11.3) but not wheel. 05 mentions Chrome only (correct but incomplete).
6. `size-adjust` Baseline. 01-critical-rendering-path.md:583 says "Baseline widely available since 2026-03". web-features puts the descriptor under `font-size-adjust` (Baseline low 2024-07-25). 05 and 02-course-loading.md:1137 give versions only and agree with each other.
7. Pausing offscreen charts. 05 uses placeholder methods (`suspendRendering`/`resumeRendering`). 13-scichart.md:315 recommends the built-in `freezeWhenOutOfView: true`. 06-js-event-loop-and-scheduling.md:759 uses `chart.pause()`/`chart.resume()`. The skill should use one approach.
8. `@import` and the preload scanner. 05 and 01-critical-rendering-path.md:34/283 both say the scanner misses CSS `@import`. The 02 verification corrected this for inline `<style>` (same correction as above).
9. No conflict: Lighthouse `non-composited-animations`. 05 says "still present in Lighthouse 13". 16-explore-fast-batch-02.md:357 says it is folded into `cls-culprits-insight` but still a diagnostic. Lighthouse `main` has both.

## Missing but important

1. `font-variant-numeric: tabular-nums` on ticking numbers (prices, order-book sizes, clocks). Every digit then has the same width, so a value change does not change the text width, and neighbors do not move. Baseline high (low 2020-01-15). https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric
2. Render surfaces (offscreen passes). In cc, `mix-blend-mode`, `mask`, `clip-path`, rounded corners that are not on the fast path, filters, and backdrop filters over a subtree of layers can each force a render surface (`RenderSurfaceReason::kBlendMode`, `kMask`, `kClipPath`, `kRoundedCorner`, `kFilter`, `kBackdropFilter`). Keep these off large animated or scrolling subtrees. https://chromium.googlesource.com/chromium/src/+/main/cc/trees/effect_node.h
3. `position: sticky` instead of scroll listeners that move headers or toolbars. The browser updates sticky position during asynchronous scrolling. Firefox docs: "This version works well with asynchronous scrolling". https://firefox-source-docs.mozilla.org/performance/scroll-linked_effects.html
4. 3D-context compositing reasons. `transform-style: preserve-3d` and `perspective` with 3D descendants (`kPreserve3DWith3DDescendants`, `kPerspectiveWith3DDescendants`) are missing from the layer list in section B. https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/graphics/compositing_reasons.h
5. `interpolate-size: allow-keywords` / `calc-size()` (Chrome 129 only, not Baseline) make `height: auto` animations easy. They still animate `height`, which is a layout property (`invalidate: "layout"`), on every frame. Use them for rare disclosure UI only, and use FLIP or `scale` on hot paths. BCD `css.properties.interpolate-size` ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/css_properties.json5
6. Explicit `contain: layout` next to `container-type`. Since Chrome 129, Firefox 133, and Safari 18.4, `container-type` gives only an independent formatting context, not layout containment. Add `contain: layout` when a query container must also isolate layout. https://github.com/w3c/csswg-drafts/issues/10544 ; BCD `css.properties.container-type.weak_containment`
7. Safari before 27: `contain: layout` could make forced layouts much slower when all siblings create their own formatting context (fixed in Safari 27). Measure containment in Safari 26.x too. https://webkit.org/blog/18325/webkit-features-for-safari-27-0/
8. For a cheap upscaled texture, use an image, not a scaled box. A layer that only draws one image ("directly composited image") is rastered at about the image's intrinsic size. A painted box is rastered at screen scale (see the disputed item above). https://chromium.googlesource.com/chromium/src/+/main/docs/how_cc_works.md
