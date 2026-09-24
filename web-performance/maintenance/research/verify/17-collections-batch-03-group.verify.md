# Verify: 17-collections-batch-03.md, 17-collections-batch-04.md

Checked on 2026-09-23. Data: MDN BCD 8.1.2 and web-features 3.39.0 (both published 2026-09-17, the latest on npm today), Chromium `main` source (`compositor_animations.cc`, `runtime_enabled_features.json5`, `http_cache_transaction.cc`), chromestatus API, the saved source pages (2026-09-22) and fresh MDN JSON. Raw files: `raw/verify/17b/`.

Summary counts:

| File | Items | Verified | Corrected | Disputed | Unverified |
|---|---|---|---|---|---|
| 17-collections-batch-03.md | 20 | 11 | 9 | 0 | 0 |
| 17-collections-batch-04.md | 18 | 13 | 5 | 0 | 0 |
| Total | 38 | 24 | 14 | 0 | 0 |

Most important corrections:
1. `composite: 'add'`/`'accumulate'` makes Chromium run the animation on the main thread, also for `transform` (`kEffectHasNonReplaceCompositeMode`). Two items say the opposite.
2. Chromium also refuses the compositor when an animation stacks on a running or filling animation of the same property (`kTargetHasIncompatibleAnimations`). This affects the retarget and per-event patterns.
3. Implicit to/from keyframes are not Baseline. Safari support is "partial" in BCD, and web-features marks the key `baseline: false`.
4. Replaceable animations shipped in Chrome 84. Chrome 83 had them only behind a flag.
5. Composited `background-color` (Chrome 142) and `clip-path` (Chrome 152) animations have shipped.
6. The navigation preload item is too broad. A second notes file already resolves this.

Systematic nit (several items): the notes write "Baseline widely available since <date>", but the date given is the Baseline *low* date. The MDN banner date means "available across browsers since". Exact web-features dates: `will-change` low 2020-01-15, high 2022-07-15. `Element.animate` low 2020-03-24, high 2022-09-24. `Animation.play` low 2020-03-24, high 2022-09-24. `persist`/`commitStyles`/`Element.getAnimations` low 2020-07-28, high 2023-01-28. `finished` low 2020-07-27, high 2023-01-27. CSS animations (`AnimationEvent`) low 2015-09-30, high 2018-03-30. Write "Baseline since <low>, widely available since <high>".

---

## 17-collections-batch-03.md

### Run DOM UI animations as CSS or WAAPI on compositable properties, not as rAF style writes
- Verdict: corrected
- Correction: The caveat "Chromium announced composited `background-color` and `clip-path` animations in 2021. I could not confirm a shipped version" is out of date. Current Chromium `runtime_enabled_features.json5` has `CompositeBGColorAnimation` and `CompositeClipPathAnimation` at `status: "stable"`. The branch history in 05-css-rendering.verify.md gives stable from M142 (background-color) and M152 (clip-path). Chromium's compositable list (`kCompositableProperties`) is: `backdrop-filter`, `filter`, `opacity`, `rotate`, `scale`, `transform`, `translate`, plus `background-color` and `clip-path` through native paint worklets (with conditions). Firefox also composites `background-color` (OMTA). Replace "`top`, `width`, `background-color` ... still need the main thread" with "`top`, `width` ... still need the main thread. `background-color` is composited in Chrome 142+ and Firefox, but not in Safari." The core claim (compositor animations continue during main-thread long tasks, rAF style writes stop) is correct. Chromium exceptions are listed in the two composite items below.
- Evidence: https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/runtime_enabled_features.json5 ; https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/animation/compositor_animations.cc (lines 78-84) ; verify/05-css-rendering.verify.md ("stable from M142 ... stable from M152")

### Omit the start keyframe to retarget an animation from where it is now
- Verdict: corrected
- Correction: (1) Status: implicit to/from keyframes are **not Baseline**. BCD `api.Element.animate.implicit_tofrom` has Chrome 84, Firefox 75, and Safari 13.1 as `partial_implementation` ("Implementation seems somewhat buggy"). web-features 3.39.0 `by_compat_key` gives `baseline: false` (support: Chrome, Edge, Firefox only). (2) Add a Chromium caveat. A new animation whose start is an implicit (neutral) keyframe is "affected by underlying animations". Chromium marks it `kTargetHasIncompatibleAnimations` when another animation on the same property is still running, or when a finished/paused filling one sits below it. The retargeted animation then runs on the main thread, so under a busy main thread (a chart rendering) the retarget can jank. It still removes the forced layout read.
- Evidence: BCD `api.Element.animate.implicit_tofrom` (raw/verify/02/bcd.json, 8.1.2) ; web-features 3.39.0 `web-animations` by_compat_key ; https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/animation/compositor_animations.cc (`ConsiderAnimationAsIncompatible`, `HasIncompatibleAnimations`) ; https://web.dev/blog/web-animations

### Let the browser remove replaced fill animations, and never call persist() in hot handlers
- Verdict: corrected
- Correction: "They first shipped in Chromium 83" is wrong. The web.dev article says "introduced in Chromium 83", but chromestatus "Replaceable animations" is "In developer trial (Behind a flag)" at 83. The feature shipped enabled by default in Chrome 84 (BCD `persist`, `replaceState`, `remove_event`: Chrome 84, Firefox 75, Safari 13.1). Safari 13.1 (2020-03) and Firefox 75 (2020-04) shipped it before Chrome. Mechanism is correct per Web Animations 1 §5.5.2: the replacing animation must also be replaceable (finished, filling), and CSS animations/transitions with an owning element are never removed. Extra caveat for the example: in Chromium, each new per-`pointermove` animation that starts while the previous one still runs gets `kTargetHasIncompatibleAnimations` and runs on the main thread. This supports the note's own advice to use one rAF-coalesced style write for 1:1 tracking.
- Evidence: https://chromestatus.com/feature/5127767286874112 ; BCD `api.Animation.persist` ; https://drafts.csswg.org/web-animations-1/#removing-replaced-animations ; compositor_animations.cc

### Commit the final state with commitStyles(), then cancel(), instead of filling forever
- Verdict: verified
- Evidence: MDN commitStyles (mod 2026-09-07): "There is no way to feature check for this new behavior. For now most code should continue to set fill" ; BCD `api.Animation.commitStyles.endpoint_inclusive_commitStyles`: Chrome 144, Firefox 142, Safari 26.2 ; web-features: commitStyles low 2020-07-28 ; https://developer.mozilla.org/en-US/docs/Web/API/Animation/commitStyles

### Sequence animations with animation.finished and animation.ready, not timers or delay arithmetic
- Verdict: verified
- Evidence: MDN `cancel()` (mod 2026-08-27): "the current finished promise is rejected with a DOMException named AbortError" ; BCD `finished`/`ready` Chrome 84, Firefox 63, Safari 13.1 (low 2020-07-27) ; https://web.dev/blog/web-animations

### Control CSS animations from JS with getAnimations(), for example to pause them in hidden panels
- Verdict: verified
- Note: The example calls `a.play()` on every animation when the panel becomes active. `play()` restarts animations that had already finished (MDN `play()`), so finite entry animations replay. Track which ones you paused. `getAnimations({ subtree: true })` (options parameter) is Chrome 84, Firefox 75, Safari 13.1 (BCD).
- Evidence: BCD `api.Element.getAnimations`, `api.Element.getAnimations.options_parameter`, `api.Document.getAnimations` (Safari 14) ; https://developer.mozilla.org/en-US/docs/Web/API/Animation/play

### Layer micro-effects on a base animation with composite: 'add' or 'accumulate'
- Verdict: corrected
- Correction: The caveat "Use `transform` to stay on the compositor" is wrong for Chromium. In `compositor_animations.cc`, any keyframe with a composite other than `replace` (and not neutral) sets `kEffectHasNonReplaceCompositeMode`. That animation is not composited, whatever the property. Also, the example's second animation stacks on a finished `fill: 'forwards'` base of the same property, and an additive effect is "affected by underlying animations", which also sets `kTargetHasIncompatibleAnimations`. Replace the Stage "style, composite" with "style, main-thread-task (Chromium)". Add: "In Chromium, `add`/`accumulate` animations run on the main thread, so they stall during long tasks. Use them only for short micro-effects, not while the chart renders." The composite numbers (`rotate(720deg) scale(1.96)` add, `rotate(720deg) scale(1.8)` accumulate) match the article. Status (`composite` Baseline 2022-09-12, `iterationComposite` not in Chrome) is correct.
- Evidence: https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/animation/compositor_animations.cc (lines 376-383) ; compositor_animations.h `kEffectHasNonReplaceCompositeMode = 1 << 4` ; 05-css-rendering.md:85 ("'add' composite forces main-thread animation in Chromium")

### Replace scroll listeners and IntersectionObserver effects with CSS scroll-driven animations
- Verdict: corrected
- Correction: (1) `timeline-scope` is Chrome/Edge **116**, not 115 (BCD). The other keys are 115. (2) "Scroll-driven animations of transform/opacity run off the main thread" is true in Chrome 115+ but in Safari only from **26.4** ("Safari 26.4 adds support for threaded Scroll-driven Animations", WebKit, 2026-03-24). Safari 26.0-26.3 run them on the main thread. (3) "Firefox has no support" → Firefox has it only in preview builds (BCD `preview`). The rest is correct: "completely unaffected" is an exact quote from the Chrome case study (2023-07-12), `view()` has no scroller argument (MDN), and web-features `scroll-driven-animations` is not Baseline.
- Evidence: BCD `css.properties.timeline-scope`, `css.properties.animation-timeline`, `api.ScrollTimeline` ; https://webkit.org/blog/17862/webkit-features-for-safari-26-4/ ; https://developer.chrome.com/blog/scroll-animation-performance-case-study

### Declare animation-timeline after the animation shorthand, and give scroll-driven animations a 1ms duration
- Verdict: verified
- Note: BCD `css.properties.animation-duration.auto` adds support for the 1ms advice: Chrome 115 and Safari 18.4 accept `auto`, and the Firefox note says "only accepts values in seconds or milliseconds. It's recommended that 1ms is used until auto is supported." Spec drift: the css-animations-2 editor's draft (2026-08-18) grammar for `<single-animation>` now includes `<single-animation-timeline>`, but MDN and the engines still treat `animation-timeline` as reset-only. Declaring it after the shorthand is correct in both cases.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timelines ("The animation-timeline is reset to the default auto value by the animation shorthand property, but cannot be set using the shorthand") ; BCD `css.properties.animation-duration.auto` ; https://drafts.csswg.org/css-animations-2/

### Choose view-timeline ranges so that the effect finishes while the element is visible
- Verdict: verified
- Evidence: MDN Timeline range names: "If the animated element is the same size as its container, the animation still happens, but over 0px" ; "with these two values, the animation attachment range is never larger than the container" (entry/exit) ; BCD `css.properties.animation-range` Chrome 115, Safari 26, Firefox preview

### Inspect DOM animations in the DevTools Animations drawer, and canvas/WebGL animations in the Performance panel
- Verdict: verified
- Evidence: https://developer.chrome.com/docs/devtools/css/animations/ ("`requestAnimationFrame` animations are not yet supported"; "Keyframe and Bezier editing isn't supported"; scroll-driven groups "In pixels")

### Enable navigation preload whenever a service worker has a fetch handler
- Verdict: corrected
- Correction: The title and impact are too broad. Enable navigation preload only when the fetch handler answers navigations network-first or network-only. With cache-first navigations it only adds a request (the item's own caveat, and web.dev: boot time "isn't a problem if you're responding from the cache"). Change the Impact to medium. Where supported, prefer static routing (`InstallEvent.addRoutes`) for routes that never need the handler (Chrome 123, Safari 27, no Firefox: confirmed in BCD and in the Safari 27 release notes). New context: Chrome has an optional "ServiceWorkerAutoPreload" mode (chromestatus: "Chrome 154 includes an optional browser optimization mode ... the browser issues the network request in parallel with the service worker bootstrap"). It is controlled by an enterprise policy and is not a default you can rely on. Status (Chrome 59, Firefox 99, Safari 15.4) is correct. The header name `Service-Worker-Navigation-Preload` is correct.
- Evidence: 15-gaps-round-1.md:11-35 (resolution for this exact item) ; https://web.dev/blog/navigation-preload ; BCD `api.NavigationPreloadManager`, `api.InstallEvent.addRoutes` ; raw/verify/02/safari27.txt ("Safari 27.0 adds support for the Service Worker static routing API") ; https://chromestatus.com/feature/5194817700364288

### Treat `<link rel="prefetch">` as a short-lived, non-Safari hint, and prefer Speculation Rules for next documents
- Verdict: corrected
- Correction: (1) "The article's 'as of Chrome 85, 5 minutes' still matches MDN's current note for Chrome" is misattributed. The MDN `rel=prefetch` page (mod 2026-04-22) no longer mentions 5 minutes. The MDN 5-minute note ("Chrome for example caches them for 5 minutes") is on the Speculation Rules page and is about speculation-rules prefetch. The rel=prefetch 5-minute reuse is still in Chromium: `http_cache_transaction.cc` has "Cached entry less than 5 minutes old, unused_since_prefetch is true". (2) MDN lists "doesn't get blocked by Cache-Control" under **prerender**, not prefetch. For speculation-rules prefetch, the WICG prefetch spec sets a fixed expiry ("currentTime + 300000 (i.e., five minutes)"), and the MDN Speculative loading guide lists "potentially blocked by Cache-Control headers" as a `rel=prefetch` problem. So the claim holds, but cite those sources. (3) BCD marks `rel=prefetch` in Chrome and Firefox as "Requires secure context". The numbers (Virgilio Sport 78% and 45%) and the status (Chrome 109, Safari 26.2 flag "SpeculationRules prefetch", no Firefox, BCD experimental) are correct.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/prefetch ; https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API ; https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Speculative_loading ; https://raw.githubusercontent.com/WICG/nav-speculation/main/prefetch.bs (line 270) ; https://raw.githubusercontent.com/chromium/chromium/main/net/http/http_cache_transaction.cc (lines 796-808) ; BCD `html.elements.link.rel.prefetch`, `html.elements.script.type.speculationrules`

### Extend prefetched pages past the 5-minute window with a service worker runtime cache
- Verdict: corrected
- Correction: "With `maxAgeSeconds` alone, an expired response can be served once before cleanup. Also set `maxEntries`." The first sentence is true only for responses without a usable `Date` header. Workbox source: "If the response has a 'Date' header, then a light weight expiration check is performed and the response will not be used". `maxEntries` does not change this. It only limits the entry count. Fix: "If responses lack a `Date` header, an expired entry can be served once. Set `maxEntries` too, to limit storage." The rest is correct: module names, Workbox 7.4.1 (npm 2026-05-04T20:21Z), and Chrome's Aurora team as the owner (README: "Chrome's Aurora team will be the new owners of Workbox").
- Evidence: raw/verify/17a/wb/workbox-expiration_src_ExpirationPlugin.ts (lines 41-45, 158) ; https://registry.npmjs.org/workbox-expiration ; https://github.com/GoogleChrome/workbox (README)

### Delegate prefetch fan-out and post-processing to the service worker with a fire-and-forget postMessage
- Verdict: verified
- Evidence: https://web.dev/articles/imperative-caching-guide (sample `for (let i in urls) { fetchAsync(urls[i]); }` has no `waitUntil`; "resources are not cached (which means, they have a `Cache-control` header of `no-cache`)") ; BCD `api.ExtendableMessageEvent` Safari 11.1 ; web-features `service-workers` low 2018-04-30

### Prefetch on intent: the top N at load time, the rest on hover
- Verdict: verified
- Note: "Hover usually comes a few hundred ms before a click" is supported by instant.page: after 65 ms of hover, preload starts, "leaving on average over 300 ms". On touch the lead is about 90 ms. Chrome `moderate` eagerness: 200 ms hover or `pointerdown`. `eager` on mobile has used viewport heuristics since January 2026 (Chrome prerender docs, updated 2026-01-23).
- Evidence: https://web.dev/articles/imperative-caching-guide ("top 9 items", `mouseover`) ; https://instant.page/ ; https://developer.chrome.com/docs/web-platform/prerender-pages

### Gate speculative fetching on connection quality, with feature detection
- Verdict: verified
- Evidence: BCD `api.NetworkInformation.effectiveType` Chrome 61, `saveData` Chrome 65, Firefox and Safari no ; web-features `network-information`/`savedata` not Baseline ; imperative-caching guide: "Prefetching techniques consume extra bytes for resources that are not immediately needed"

### Choose the worker type by the job: web workers for compute, the service worker for network proxy and caching
- Verdict: verified
- Evidence: https://web.dev/articles/workers-overview ("if the task takes too long the browser will terminate the service worker, otherwise it's a risk to the user's privacy and battery")

### Use SharedArrayBuffer under cross-origin isolation for zero-copy data between threads (the article's "no shared memory" is out of date)
- Verdict: corrected
- Correction: (1) "`Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`)": Safari does not support COEP `credentialless` (BCD: Chrome 96, Firefox 119, Safari no). A page that uses `credentialless` is not cross-origin isolated in Safari, so `SharedArrayBuffer` is not available there. Use `require-corp` for Safari. (2) Status: Chrome **Android** is 89 (desktop 68). (3) A missing option: `Document-Isolation-Policy` (chromestatus milestones: desktop 137, Android 146; no other engine) isolates one document without COOP/COEP on the whole page. 07-js-web-apis.md:157 and 08-v8-batch-07.md:303 already say this.
- Evidence: BCD `http.headers.Cross-Origin-Embedder-Policy.credentialless`, `javascript.builtins.SharedArrayBuffer` ; web-features `shared-memory` low 2021-12-13 ; https://chromestatus.com/feature/5141940204208128

### Pick the channel by the conversation shape: MessageChannel for request/response, BroadcastChannel for cross-tab fan-out, Clients for SW-to-tab
- Verdict: verified
- Evidence: https://web.dev/articles/two-way-communication-guide (port stored in `let communicationPort;`; "other browsers, like Safari, don't support it") ; web-features `broadcast-channel` low 2022-03-14 ; BCD `api.Clients.matchAll` Safari 11.1

---

## 17-collections-batch-04.md

### 1. Do not leave `fill: forwards` / `animation-fill-mode: forwards` on after the motion ends
- Verdict: corrected
- Correction: (1) Status: `will-change` is Baseline since 2020-01-15, **widely available since 2022-07-15** (web-features). It is not "widely available since 2020-01". (2) The `will-change` quote "for a much longer time" is about `will-change` written in a stylesheet ("adding will-change directly to a stylesheet implies ... the browser will keep the optimizations for a much longer time"). It is not about fill. Applying it to filling animations is an inference, so label it as one. The rest is exact: the Using and Tips pages both say that forwards-filled properties "keep the will-change status" and keep a stacking context. The quote about missing `from`/`to` keyframes matches. CSS animations low 2015-09-30 and high 2018-03-30 match.
- Evidence: raw/collections-batch-04/mdn-will-change.txt:108 ; waapi-tips.txt:120 ; css-animations-using.txt:62,88 ; web-features `will-change`, `animations-css`

### 2. Keep a WAAPI end state with `commitStyles()` and then `cancel()`, not an indefinite fill
- Verdict: verified
- Evidence: BCD `api.Animation.commitStyles.endpoint_inclusive_commitStyles` Chrome 144, Firefox 142, Safari 26.2 ; Web Animations 1: "If, after applying any pending style changes, target is not being rendered, throw an 'InvalidStateError'" ; MDN commitStyles "There is no way to feature check for this new behavior"

### 3. Let the browser auto-remove replaced WAAPI animations; call `persist()` only on purpose
- Verdict: verified
- Note: The replacing animations must also be finished and filling ("an animation effect associated with a replaceable animation with a higher composite order"). In Chromium, a new flash that starts while the previous one still runs on the same property is not composited (`kTargetHasIncompatibleAnimations`). The "widely available (since 2020-07)" date is the low date. High is 2023-01-28.
- Evidence: https://drafts.csswg.org/web-animations-1/ §5.5.2 ; BCD `api.Animation.persist` Chrome 84, Firefox 75, Safari 13.1 ; compositor_animations.cc

### 4. Replay with WAAPI `play()` on a kept `Animation`, not by toggling a class and forcing a reflow
- Verdict: verified
- Note: "Baseline widely available since 2020-03" is the low date for `Element.animate`/`play()`. High is 2022-09-24.
- Evidence: MDN WAAPI Tips ("You can't just set the element's animation-play-state to 'running' again once the animation ends") ; MDN `play()` ("If the animation is finished, calling play() restarts the animation, playing it from the beginning")

### 5. Stop rapid re-triggers from stacking animations: gate on `finished`, or extend the running one
- Verdict: verified
- Evidence: MDN WAAPI Tips (disable the button, re-enable on `finish`; check for a running animation and add iterations) ; MDN `cancel()` AbortError text ; BCD `api.AnimationEffect.updateTiming` Chrome 75, Firefox 63, Safari 13.1 ; `options_id_parameter` Chrome 50

### 6. Attach animation listeners before the animation starts, and listen for `animationcancel` for cleanup
- Verdict: verified
- Note: chromestatus has "Expose 'onanimationcancel' event to GlobalEventHandlers" at "Proposed" (milestone 145). BCD 8.1.2 still marks Chrome as partial, so the note is current. New related API: `AnimationEvent.animation` and `TransitionEvent.animation` (Chrome 151, Firefox 152, Safari 27, BCD) give the `Animation` object from the event.
- Evidence: BCD `api.Element.animationcancel_event` (note cites crbug 41404325) ; web-features by_compat_key `baseline: false` ; https://chromestatus.com/feature/5160464445210624 ; MDN Using CSS animations ("all three possible animation events")

### 7. Give inline text `display: inline-block` before you animate its transform, and scale a wrapper instead of animating `font-size`
- Verdict: verified
- Evidence: MDN Using CSS animations: "changing any properties that impact the box model negatively impacts performance" ; "the transform properties do not affect non-replaced inline-level content" ; web-features `individual-transforms` low 2022-08-05, high 2025-02-05

### 8. Use the individual `translate` / `scale` / `rotate` properties so separate animations do not overwrite one transform
- Verdict: verified
- Note: Chromium composites `translate`, `scale` and `rotate` as separate properties (`kCompositableProperties`). The old reason `kObsoleteMultipleTransformAnimationsOnSameTarget` is obsolete, so the two animations in the example do not block each other.
- Evidence: BCD `css.properties.translate/scale/rotate` Chrome 104, Firefox 72, Safari 14.1 ; compositor_animations.h

### 9. Layer extra motion with `composite: 'add'` (WAAPI) or `animation-composition: add` (CSS) instead of recomputing the full value in JS
- Verdict: corrected
- Correction: (1) Add the Chromium cost: keyframes with `add`/`accumulate` set `kEffectHasNonReplaceCompositeMode`, so the animation runs on the main thread even for `translate`/`transform`. An additive animation over an existing animation is also "affected by underlying animations" (`kTargetHasIncompatibleAnimations`). Remove "composite" from Stage for Chromium, and add "Do not use on hot or long animations while the chart renders" (same as 05-css-rendering.md:85). (2) The "Before" example is invalid CSS: `calc(${base} + 3px)` with a two-value `translate` such as `0px 0px` does not parse. Use a single-axis value, or simply show the read (`getComputedStyle`) as the cost. Status values are correct: `composite` low 2022-09-12, high 2025-03-12. `animation-composition` low 2023-07-04, high 2026-01-04. `iterationComposite` Firefox 80, Safari 16.4, no Chrome.
- Evidence: https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/animation/compositor_animations.cc (lines 376-383, 86-110) ; web-features `animation-composition` ; BCD `api.KeyframeEffect.iterationComposite`

### 10. Start from the current state with an implicit keyframe instead of reading the start value yourself
- Verdict: corrected
- Correction: Status: "within the Baseline 'Web animations' feature (widely available since 2023-03)" is misleading. web-features excludes this key: `api.Element.animate.implicit_tofrom` is `baseline: false`, because BCD marks Safari 13.1+ as partial ("Implementation seems somewhat buggy"). Also add the Chromium caveat: an implicit-keyframe animation that interrupts a running animation of the same property (or sits on a filling one) is not composited (`kTargetHasIncompatibleAnimations`). So "interrupted motion continues smoothly" is true for the start value but not for main-thread independence. The `offset: 0` and `offset: 0.5` examples match MDN Keyframe Formats.
- Evidence: BCD `api.Element.animate.implicit_tofrom` ; web-features 3.39.0 `web-animations` by_compat_key ; https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Keyframe_Formats ; compositor_animations.cc

### 11. Write keyframes in a valid form, and know which easing applies where
- Verdict: corrected
- Correction: "A `float` keyframe has no effect, because `float` is not animatable (Keyframe Formats page)". The Keyframe Formats page says this, but MDN's own `float` reference (mod 2026-07-21) and mdn/data `css/properties.json` give **Animation type: discrete**. Under the Web Animations model a `cssFloat` keyframe flips at the midpoint. Replace with: "Write `float` as `cssFloat`. It animates discretely (flips at 50%), so it is rarely useful." The rest (offset rules, segment vs iteration easing, repeating `easing`/`composite` lists, CSS list cycling) matches MDN.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/float ; https://raw.githubusercontent.com/mdn/data/main/css/properties.json (`float.animationType = "discrete"`) ; https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Keyframe_Formats

### 12. End exit animations in `display: none`, not in `opacity: 0`, and give Firefox a JS fallback
- Verdict: corrected
- Correction: (1) The example comment "`panel.hidden = true; // leaves layout/paint in every engine`" is overgeneralized. The `hidden` attribute works through the UA rule `[hidden] { display: none }`, so any author rule that sets `display` on the panel (for example `.panel { display: flex }`) wins and the panel stays rendered. Set `panel.style.display = 'none'`, or add a global author rule `[hidden] { display: none !important; }`, or use a hiding class with enough specificity. (2) Add: Firefox also lacks `display` **transitions** (BCD `css.properties.display.is_transitionable`: Chrome 117, Safari 18, Firefox no, bug 1882408), not only keyframes (bug 1834877 is correct). (3) `content-visibility: hidden` skips the contents' rendering but keeps the element's own box (size containment), so it does not "leave rendering" like `display: none`. The versions (Chrome 116, Safari 18) are correct. web-features `display-animation` is not Baseline (support Chrome 117 because it includes transitions).
- Evidence: BCD `css.properties.display.keyframe_animatable`, `css.properties.display.is_transitionable`, `css.properties.content-visibility.keyframe_animatable` ; https://html.spec.whatwg.org/multipage/rendering.html#hidden-elements

### 13. Honor `prefers-reduced-motion` in CSS, WAAPI and chart animations, and tone motion down instead of only removing it
- Verdict: verified
- Evidence: MDN prefers-reduced-motion (mod 2026-06-10): "removes, reduces, or replaces motion-based animations" ; "@media (prefers-reduced-motion) is equivalent to @media (prefers-reduced-motion: reduce)" ; `ui.prefersReducedMotion` ; example switches `pulse` (scale) to `dissolve` (opacity) ; web-features low 2020-01-15, high 2022-07-15 ; SciChart v4 Animations API: `animation` constructor option, `runAnimation`, `enqueueAnimation`

### 14. Do not build on the `Sec-CH-Prefers-Reduced-Motion` client hint; if you use it, know that `Critical-CH` costs a retry
- Verdict: verified
- Evidence: BCD `http.headers.Sec-CH-Prefers-Reduced-Motion` Chrome 108, experimental ; MDN header page: "The client automatically retries the request (due to Critical-CH being specified above)" ; WAAPI hub: "(or equivalent user agent client hint Sec-CH-Prefers-Reduced-Motion)"

### 15. Give auto-playing motion a pause control, and implement it with `document.getAnimations()`
- Verdict: verified
- Evidence: MDN WAAPI hub (WCAG 2.2.2 link; ADHD, vestibular disorders, epilepsy, migraine) ; MDN `Document.getAnimations()`: "This array includes CSS Animations, CSS Transitions, and Web Animations" ; web-features low 2020-09-16, high 2023-03-16

### 16. In browser tests, finish or pause all animations through WAAPI instead of waiting on timers
- Verdict: verified
- Note: Playwright has this built in: `toHaveScreenshot({ animations: 'disabled' })` fast-forwards finite animations and cancels infinite ones. See Missing below.
- Evidence: Web Animations 1 §4.5.13 ("If animation's effective playback rate is zero, or if ... associated effect end is infinity, throw an 'InvalidStateError'") ; MDN WAAPI Concepts ("It can be used in automated tests")

### 17. Use native WAAPI for DOM motion; do not ship the `web-animations-js` polyfill or a large library for simple transitions
- Verdict: verified
- Evidence: GitHub API `web-animations/web-animations-js`: `pushed_at` 2021-06-20T11:58:39Z, `archived: false` ; npm `web-animations-js` latest 2.3.2 (2019-06-25) ; web-features `web-animations` high 2023-03-16

### 18. Treat scroll and view timelines as progressive enhancement; the "only one timeline" text is outdated
- Verdict: verified
- Note: As in batch-03, Safari runs scroll-driven animations on the compositor only from 26.4.
- Evidence: MDN WAAPI Concepts ("As of this writing, there's only one kind of timeline object") ; BCD `api.Element.animate.options_rangeStart_parameter` Chrome 115, Safari 26, Firefox preview ; https://drafts.csswg.org/web-animations-2/ (updated 2026-09-04; `GroupEffect` and `SequenceEffect` still present; no BCD entry)

---

## Notes on the non-item sections

- batch-03 "Standard levers": "Animate only `transform` and `opacity` (and `filter` in Chromium)" is too narrow. WebKit also accelerates `filter` and `backdrop-filter`. Chromium also composites `backdrop-filter`, individual transforms, and `background-color`/`clip-path` (Chrome 142/152). Firefox composites `background-color`. Source: verify/05-css-rendering.verify.md and compositor_animations.cc. "`will-change` is Baseline (widely available since 2020-01)" → widely available since 2022-07-15.
- batch-03 outdated table: all rows confirmed (BCD 8.1.2, web-features 3.39.0, npm).
- batch-04 "Outdated or incomplete advice": all rows confirmed.

## Cross-file conflicts

1. **Composite modes and the compositor.** 05-css-rendering.md:85-86 says "Do not use `animation-composition: add|accumulate` on hot animations" because Chromium sets `kEffectHasNonReplaceCompositeMode`. 17-collections-batch-03.md ("Layer micro-effects...", Stage "composite", "Use `transform` to stay on the compositor") and 17-collections-batch-04.md item 9 (Stage "composite") contradict it. The Chromium source supports 05.
2. **Navigation preload scope.** 15-gaps-round-1.md:32 says 17-collections-batch-03.md:235 "is wrong" (too broad, impact too high). 07-js-web-apis.md:220, 17-collections-batch-01.md:72 and 04-html-and-http-loading-features.md:691 limit it to network navigations, as 15-gaps does. This check agrees with 15-gaps.
3. **Composited background-color/clip-path.** 17-collections-batch-03.md (item 1: "could not confirm a shipped version") and 01-critical-rendering-path.md:740 ("not verified") are out of date. 05-css-rendering.md and its verify report give Chrome 142 and 152.
4. **`will-change` Baseline date.** 17-collections-batch-03.md:11, 17-collections-batch-04.md item 1, 01-critical-rendering-path.md:758 and 05-css-rendering.md:210 say "widely available (2020 / 2020-01-15)". 17-collections-batch-02.md:230 has the correct split: low 2020-01-15, high 2022-07-15.
5. **Cross-origin isolation.** 17-collections-batch-03.md (SAB item) offers `credentialless` without the Safari gap and omits Document-Isolation-Policy. 07-js-web-apis.md:156-157 and 08-v8-batch-07.md:303-313 include both.
6. **Implicit keyframes status.** 17-collections-batch-01.md:449 correctly says Safari is "partial and buggy". 17-collections-batch-03.md ("Baseline since 2020") and 17-collections-batch-04.md item 10 ("within the Baseline ... feature") say it is Baseline.
7. **Scroll-driven duration.** 05-css-rendering.md:151 uses `animation: grow linear both;` (no duration, so it relies on `auto`). 17-collections-batch-03.md says to use `1ms` because Firefox (preview) does not accept `auto`. The two are compatible only if 05 keeps the `@supports` gate. Adopt `1ms` in both.
8. **Connection threshold.** 17-collections-batch-03.md skips prefetch on `slow-2g`/`2g`. 07-js-web-apis.md:822 also skips on `3g`. Pick one rule for the skill.
9. **Workbox 7.4.1 date.** 17-collections-batch-01.md:17,47 say 2026-05-05 (GitHub release). 17-collections-batch-02/03 say 2026-05-04 (npm publish 2026-05-04T20:21Z). This is only a time-zone and source difference. Use the npm date.

## Missing but important

1. **Chromium compositor fallback conditions for WAAPI.** A second animation on the same property while one is running, a filling animation below an additive or implicit-keyframe animation (`kTargetHasIncompatibleAnimations`), and non-replace composite (`kEffectHasNonReplaceCompositeMode`) all move DOM motion to the main thread. Check this with the Lighthouse "Avoid non-composited animations" diagnostic or the Performance panel. Sources: https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/animation/compositor_animations.cc ; https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations
2. **`AnimationEvent.animation` / `TransitionEvent.animation`** (Chrome 151, Firefox 152, Safari 27). Use them to get the `Animation` from `animationend`/`transitionend`, so cleanup and `commitStyles()` do not need `getAnimations()` scans. Source: BCD `api.AnimationEvent.animation`, `api.TransitionEvent.animation` ; raw/verify/02/safari27.txt line 183.
3. **`Animation.overallProgress`** (Chrome 133, Firefox 142, Safari 26.2). It reads progress (0-1) without computing it from `currentTime`/duration. Useful to sync a canvas overlay with a DOM animation. Source: BCD `api.Animation.overallProgress`.
4. **Scroll-triggered animations (`animation-trigger`)**, Chrome 146, experimental (BCD). Reveal-on-scroll without IntersectionObserver JS. Chromium only, so treat it as progressive enhancement. Sources: BCD `css.properties.animation-trigger` ; https://chromestatus.com/feature/5181996801982464
5. **Document-Isolation-Policy** (Chrome desktop 137, Android 146). It gives `crossOriginIsolated` (and so `SharedArrayBuffer`) for one document without site-wide COOP/COEP. Source: https://chromestatus.com/feature/5141940204208128
6. **Service Worker static routing is now cross-engine in two engines** (Chrome 123, Safari 27). Use it before navigation preload for routes that never need the fetch handler. Sources: BCD `api.InstallEvent.addRoutes` ; https://developer.chrome.com/blog/service-worker-static-routing
7. **Clear stale speculative prefetches** with `Clear-Site-Data: "prefetchCache"` after a state change (log out, account switch). MDN: "Stale prefetches can be cleared using the prefetchCache value of the Clear-Site-Data response header". Chrome 138 only (04-html-and-http-loading-features.md:522). Source: https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API
8. **Playwright built-ins for animation-safe tests**: `expect(page).toHaveScreenshot({ animations: 'disabled' })` ("finite animations are fast-forwarded to completion ... infinite animations are canceled to initial state") and `page.emulateMedia({ reducedMotion: 'reduce' })`. Source: https://playwright.dev/docs/api/class-pageassertions
9. **Safari 26.4 threaded scroll-driven animations.** Eligible properties run on the compositor in Safari from 26.4 only. Set the support floor for "off main thread" claims to Chrome 115 and Safari 26.4. Source: https://webkit.org/blog/17862/webkit-features-for-safari-26-4/
10. **Chrome ServiceWorkerAutoPreload** (optional mode, Chrome 154, enterprise policy `ServiceWorkerAutoPreloadEnabled`). The browser can start the navigation request in parallel with SW boot by itself. Do not rely on it, but know that it can change navigation-preload measurements. Source: https://chromestatus.com/feature/5194817700364288
