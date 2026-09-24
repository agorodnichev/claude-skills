# web.dev collections deep read, batch 4 of 4: animations (MDN CSS animations + Web Animations API)

Scope: the "animations" collection items that point to MDN: Using CSS animations, the Web Animations API (WAAPI) hub, WAAPI Concepts, WAAPI Tips, Keyframe Formats, and the `prefers-reduced-motion` reference. For status checks I also read MDN `commitStyles()`, `persist()`, `play()`, `cancel()`, `will-change`, `Sec-CH-Prefers-Reduced-Motion`, the Web Animations Level 1 and Level 2 editor's drafts, web-features 3.39.0 (published 2026-09-17) and MDN BCD 8.1.2 (API snapshot 2026-09-23). Detail goes to levers that change how DOM motion code is written in a long-lived trading UI. Standard levers (compositor-only properties, `will-change`) are one line each at the end.

Article dates (MDN "last modified"): Using CSS animations 2025-12-15; WAAPI Tips 2025-12-17; Keyframe Formats 2025-11-07; `prefers-reduced-motion` 2026-06-10; WAAPI hub 2026-09-11; WAAPI Concepts 2025-04-03 (text is much older: it still says only one timeline type exists).

Scope note for SciChart.js: CSS animations and WAAPI act on DOM elements only. Motion inside a SciChart WebGL surface runs in SciChart's own render loop, so the rules below apply to the DOM chrome around the chart (toolbars, panels, toasts, overlays, price flash cells). Item 13 is the one rule that also reaches into the chart.

---

### 1. Do not leave `fill: forwards` / `animation-fill-mode: forwards` on after the motion ends
- Layer: css
- Stage: style, composite, gc-memory
- Metrics: memory, FPS/smoothness
- When: long-lived session
- Impact: medium, because each filling animation keeps an effect alive for the rest of the session; in a terminal that stays open all day, many small UI animations add up.
- Do: Make the end state the element's normal style and animate only *from* the start state, so no fill is needed. If you must hold the end state, commit it (item 2) and cancel the animation.
- Why: Both MDN CSS pages say that animated properties act as if listed in `will-change`, and with `forwards`/`both` fill the element keeps that status after the end. So a stacking context created during the animation stays. The `will-change` page says the browser then keeps the optimization "for a much longer time", which costs memory. The `commitStyles()` page adds that animations win over all static styles, so an indefinite fill can block later styling of the element.
- Example:
  ```css
  /* Before: end state lives only in the filling animation */
  .toast { animation: toast-in 200ms ease-out forwards; }
  @keyframes toast-in { from { translate: 0 12px; opacity: 0; } to { translate: 0 0; opacity: 1; } }

  /* After: end state is the base style; keyframes give only the start */
  .toast { translate: 0 0; opacity: 1; animation: toast-in 200ms ease-out; }
  @keyframes toast-in { from { translate: 0 12px; opacity: 0; } } /* `to` = computed style */
  ```
- Avoid/caveats: The "missing `to` keyframe uses the computed value" rule is in the CSS article ("If from/0% or to/100% is not specified, the browser starts or finishes the animation using the computed values"). `backwards` fill (hold the first keyframe during `animation-delay`) is fine because it ends when the animation ends.
- Status: CSS animations Baseline widely available (low 2015-09-30, high 2018-03-30), web-features 3.39.0. `will-change` Baseline widely available since 2020-01.
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Animations/Using ; https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Tips ; https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/will-change ; https://developer.mozilla.org/en-US/docs/Web/API/Animation/commitStyles

### 2. Keep a WAAPI end state with `commitStyles()` and then `cancel()`, not an indefinite fill
- Layer: js
- Stage: style, gc-memory
- Metrics: memory, INP
- When: interaction, long-lived session
- Impact: medium, because it removes the filling effect and makes the element styleable again.
- Do: `await anim.finished`, call `anim.commitStyles()` to write the final values into the inline `style`, then `anim.cancel()`. For code that must also run on browsers from before 2026, keep `fill: 'forwards'` on the animation, because older engines lose the end values without it.
- Why: `commitStyles()` copies the current computed animated values into the `style` attribute. After that, the animation is no longer needed and `cancel()` drops its effect from the effect stack.
- Example:
  ```ts
  async function slidePanelOpen(panel: HTMLElement): Promise<void> {
    const anim = panel.animate(
      { translate: ['-100% 0', '0 0'] },
      { duration: 180, easing: 'ease-out', fill: 'forwards' },
    );
    try {
      await anim.finished;
    } catch {
      return; // cancelled by a newer interaction (AbortError)
    }
    anim.commitStyles();
    anim.cancel();
  }
  ```
- Avoid/caveats: Per the Web Animations Level 1 spec, `commitStyles()` first applies pending style changes, so each call can force a style recalc: do not call it once per element in a large loop. It throws `InvalidStateError` if the target is not rendered (for example, it is already `display: none`). Committed values are inline styles and beat stylesheet rules until you clear them. MDN says there is no feature check for the new no-fill behavior.
- Status: `commitStyles()` Baseline widely available (since 2020-07). The newer "commits even without fill" behavior shipped in Firefox 142 (2025-08-19), Safari 26.2 (2025-12-12) and Chrome 144 (2026-01-13) (MDN BCD `api.Animation.commitStyles.endpoint_inclusive_commitStyles`). MDN's advice "most code should continue to set fill" is still right for audiences on older versions, and less needed from 2026 on.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Animation/commitStyles ; https://drafts.csswg.org/web-animations-1/ ; https://bcd.developer.mozilla.org/bcd/api/v0/current/api.Animation.commitStyles.json

### 3. Let the browser auto-remove replaced WAAPI animations; call `persist()` only on purpose
- Layer: js
- Stage: gc-memory, style
- Metrics: memory
- When: long-lived session, interaction
- Impact: medium, because pointer- or tick-driven `element.animate()` calls with fill can otherwise pile up without limit.
- Do: When you start a new filling animation on each event (pointer move, price tick), make each new one fully override the same properties as the previous one, so the engine can drop the old ones. Do not call `persist()` on animations you create over and over. Listen for the `remove` event only when you need to know.
- Why: The Level 1 spec describes this exact case (a new forwards-filling animation per mouse move) and says it would cause an unbounded list and a memory leak. The spec's fix is "remove replaced animations": a finished, filling, script-created animation whose every target property is overridden by newer animations gets `replaceState = 'removed'` and leaves the effect stack. `persist()` stops this removal (MDN `persist()` page).
- Example:
  ```ts
  // Each tick replaces the previous flash on the same property,
  // so the older finished animations are auto-removed.
  function flashPrice(cell: HTMLElement, up: boolean): void {
    cell.animate(
      { backgroundColor: [up ? 'rgb(0 160 90 / 0.35)' : 'rgb(220 50 50 / 0.35)', 'transparent'] },
      { duration: 400, fill: 'forwards' },
    );
    // Do NOT call .persist() here.
  }
  ```
- Avoid/caveats: The removal applies only to animations that markup does not own. CSS animations and CSS transitions with an owning element are never auto-removed (spec condition "not prescribed by markup"). The removal needs the new animations to cover *all* the old one's properties; an old animation with an extra property stays. Better still, avoid the fill (item 1).
- Status: `replaceState`, `persist()`, `remove` event Baseline widely available (since 2020-07; Chrome 84, Firefox 75, Safari 13.1), web-features 3.39.0.
- Sources: https://drafts.csswg.org/web-animations-1/ ; https://developer.mozilla.org/en-US/docs/Web/API/Animation/persist

### 4. Replay with WAAPI `play()` on a kept `Animation`, not by toggling a class and forcing a reflow
- Layer: js
- Stage: style, layout, main-thread-task
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: medium, because the class-toggle replay needs a forced synchronous style/layout inside the input handler.
- Do: Create the animation once (paused, or on first use) and call `play()` to run it again. Or call `element.animate()` from the handler, as the Tips page does. Do not remove a class, read `offsetWidth`, and add the class back.
- Why: The Tips page says the CSS Animations spec has no way to rerun a finished animation, and setting `animation-play-state: running` again does nothing. The page now uses WAAPI for replay. MDN `play()` says that on a finished animation, `play()` restarts it from the beginning, so no style flush is needed to reset it. The old class-toggle trick needs a layout read (for example `offsetWidth`) between the two class changes so the engine sees a style change; that read forces style and layout at that point.
- Example:
  ```ts
  // Before: forced reflow on every click
  button.addEventListener('click', () => {
    badge.classList.remove('pulse');
    void badge.offsetWidth; // forces style + layout
    badge.classList.add('pulse');
  });

  // After: one Animation object, replayed
  const pulse = badge.animate({ scale: [1, 1.15, 1] }, { duration: 240 });
  pulse.cancel(); // idle until the first click
  button.addEventListener('click', () => pulse.play());
  ```
- Avoid/caveats: `play()` on a *running* animation does not restart it; call `pulse.currentTime = 0` first if you need a restart from the middle. Keep the `Animation` reference scoped to the element's lifetime so it can be collected when the element is removed.
- Status: `Element.animate()` Baseline widely available since 2020-03; `Animation.play()` Baseline widely available since 2020-03 (MDN).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Tips ; https://developer.mozilla.org/en-US/docs/Web/API/Animation/play

### 5. Stop rapid re-triggers from stacking animations: gate on `finished`, or extend the running one
- Layer: js
- Stage: main-thread-task, style
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: low, but it prevents stacked effects and visual jumps on repeated clicks or key repeats.
- Do: Before you start a new animation, check `el.getAnimations()`. Either ignore the trigger until `finished` resolves (the Tips page disables the button until `finish`), or extend the running one with `anim.effect.updateTiming({ iterations: n + 1 })`. Handle the `AbortError` that `finished` rejects with when the animation is cancelled.
- Why: Each `element.animate()` call makes a new `Animation`. The Tips page notes that clicking again restarts the motion abruptly from the start keyframe. The older animation still sits in the effect stack until it ends. MDN `cancel()` says cancelling a non-idle animation rejects its current `finished` promise with `AbortError`, so an `await` without `try/catch` shows up as an unhandled rejection.
- Example:
  ```ts
  function nudge(el: HTMLElement): void {
    const running = el.getAnimations().find((a) => a.id === 'nudge' && a.playState === 'running');
    if (running) {
      const n = Number(running.effect?.getTiming().iterations ?? 1);
      running.effect?.updateTiming({ iterations: n + 1 });
      return;
    }
    el.animate({ translate: ['0 0', '4px 0', '0 0'] }, { duration: 120, id: 'nudge' });
  }
  ```
- Avoid/caveats: Do not disable a control the user may need right away just to protect a cosmetic animation; for price or order controls prefer to let the new action run and cancel the old motion.
- Status: `getAnimations()`, `updateTiming()`, `finished` Baseline widely available (2020; web-features 3.39.0).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Tips ; https://developer.mozilla.org/en-US/docs/Web/API/Animation/cancel

### 6. Attach animation listeners before the animation starts, and listen for `animationcancel` for cleanup
- Layer: js
- Stage: main-thread-task, gc-memory
- Metrics: memory
- When: interaction, long-lived session
- Impact: low to medium, because cleanup code that waits only for `animationend` never runs when the animation is cancelled.
- Do: Add `animationstart`/`animationend` listeners first, then add the class that starts the animation (the CSS article does this so it does not miss `animationstart`). If cleanup (remove a node, clear `will-change`, drop a reference) waits on `animationend`, also listen for `animationcancel`, and use `addEventListener`, not `onanimationcancel`.
- Why: `animationstart` fires as soon as the animation starts, which can be before your script runs if the class is in the markup. The CSS article lists three events, but a fourth, `animationcancel`, fires when an animation stops early (for example the class is removed or the element goes `display: none`); `animationend` does not fire then. The CSS article also shows that `elapsedTime` values are near, not equal, to the expected times, so do not use events for exact timing.
- Example:
  ```ts
  function runExit(el: HTMLElement, done: () => void): void {
    const finish = () => {
      el.removeEventListener('animationend', finish);
      el.removeEventListener('animationcancel', finish);
      done();
    };
    el.addEventListener('animationend', finish);
    el.addEventListener('animationcancel', finish);
    el.classList.add('is-leaving'); // start after listeners are attached
  }
  ```
- Avoid/caveats: The article's line that there are "three possible animation events" is incomplete today (outdated). `animationiteration` does not fire after the last iteration; `animationend` fires instead.
- Status: `AnimationEvent` Baseline widely available (since 2015-09). `animationcancel`: Firefox 54, Safari 13.1, Chrome/Edge 83 as "partial" (the event fires, but the `onanimationcancel` handler property is not supported, crbug 41404325), so it is not Baseline (MDN BCD 8.1.2).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Animations/Using ; https://bcd.developer.mozilla.org/bcd/api/v0/current/api.Element.animationcancel_event.json

### 7. Give inline text `display: inline-block` before you animate its transform, and scale a wrapper instead of animating `font-size`
- Layer: css
- Stage: style, layout, paint, composite
- Metrics: FPS/smoothness, CLS
- When: animation/render-loop
- Impact: medium, because `font-size` animation relayouts the paragraph each frame, while `scale` on a wrapper does not.
- Do: To make one word grow or pulse (a ticker symbol, a changed price digit), wrap it in a `<span>`, set `display: inline-block`, and animate `scale`/`translate` and `color` on the span.
- Why: The CSS article says that changing properties that affect the box model hurts performance, so it wraps the word and scales the span. It also says the span needs `inline-block` because transform properties have no effect on non-replaced inline content, so on a plain inline `<span>` the animation silently does nothing.
- Example:
  ```css
  /* Before: relayouts the whole line every frame */
  @keyframes bump { 50% { font-size: 1.3em; } }
  .last-price { animation: bump 300ms; }

  /* After: compositor-friendly, no line reflow */
  .last-price { display: inline-block; }
  @keyframes bump { 50% { scale: 1.3; } }
  .last-price { animation: bump 300ms; }
  ```
- Avoid/caveats: `inline-block` changes line breaking (the span no longer wraps across lines). Animating `color` still repaints the span each frame; that is cheap for one word but not for a large table.
- Status: CSS animations Baseline widely available; individual transform properties Baseline widely available (low 2022-08-05, high 2025-02-05), web-features 3.39.0.
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Animations/Using

### 8. Use the individual `translate` / `scale` / `rotate` properties so separate animations do not overwrite one transform
- Layer: css
- Stage: style, composite
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low, because it mainly removes JS glue that merges transforms, and the bugs where one animation cancels another.
- Do: In keyframes and WAAPI, animate `translate`, `scale` and `rotate` as separate properties (as all the CSS article examples now do) instead of one `transform` string, when two effects must run on the same element.
- Why: Each individual property has its own animation stack, so a slide on `translate` and a pulse on `scale` both apply. With a single `transform`, the later animation replaces the whole value.
- Example:
  ```ts
  el.animate({ translate: ['0 8px', '0 0'] }, { duration: 200 });
  el.animate({ scale: [0.98, 1] }, { duration: 200 }); // does not undo the slide
  ```
- Avoid/caveats: If you need another order of operations, you still need `transform`. Do not mix `transform` and the individual properties for the same axis without a reason, as the combined result is hard to read.
- Status: Baseline widely available (low 2022-08-05, high 2025-02-05; Chrome 104, Firefox 72, Safari 14.1), web-features 3.39.0.
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Animations/Using

### 9. Layer extra motion with `composite: 'add'` (WAAPI) or `animation-composition: add` (CSS) instead of recomputing the full value in JS
- Layer: js, css
- Stage: style, composite, script-run
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: low to medium, because you no longer read the current value in JS (a style flush) and rebuild it.
- Do: To shake or nudge an element that already has a transform or an ongoing animation, animate only the delta with `composite: 'add'` so the engine adds it to the underlying value. Keyframes can also carry a per-keyframe `composite`.
- Why: The Keyframe Formats page describes `composite` as the way to combine a keyframe's values with the underlying value. Without it, you must read the current transform (for example with `getComputedStyle`, which forces a style recalc) and build a new absolute keyframe list.
- Example:
  ```ts
  // Before: read, then rebuild the absolute value
  const base = getComputedStyle(row).translate; // forces style
  row.animate({ translate: [base, `calc(${base} + 3px)`, base] }, 90);

  // After: add a delta on top of whatever is there
  row.animate({ translate: ['0 0', '3px 0', '0 0'] }, { duration: 90, composite: 'add' });
  ```
- Avoid/caveats: `animation-composition` is not part of the `animation` shorthand (CSS article), so set it as its own declaration. `iterationComposite` (accumulate across iterations) is not in Chrome (MDN BCD), so do not use it.
- Status: `KeyframeEffect.composite` and `animate()` `options.composite` Baseline since 2022-09 (widely 2025-03; Chrome 84, Firefox 80, Safari 16). CSS `animation-composition` Baseline widely available (low 2023-07-04, high 2026-01-04). `iterationComposite` not Baseline (Firefox 80, Safari 16.4, no Chrome).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Keyframe_Formats ; https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Animations/Using ; https://bcd.developer.mozilla.org/bcd/api/v0/current/api.Element.animate.json

### 10. Start from the current state with an implicit keyframe instead of reading the start value yourself
- Layer: js
- Stage: style, script-run
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: low to medium, because it removes a forced style read from the handler and makes interrupted motion continue smoothly.
- Do: Pass only the target keyframe to `animate()`; the engine takes the start from the element's current computed style. Use `offset: 0` on a single keyframe to animate *from* it back to the current state, or `offset: 0.5` for there-and-back.
- Why: The Keyframe Formats page says a single keyframe is treated as the end state and the start comes from the current computed style. So you do not need `getComputedStyle` in the handler, and a new animation that interrupts an old one starts from where the element actually is.
- Example:
  ```ts
  // Before
  const from = getComputedStyle(drawer).translate;
  drawer.animate({ translate: [from, '0 0'] }, 160);

  // After
  drawer.animate({ translate: '0 0' }, 160);           // current -> 0 0
  chip.animate({ scale: 1.2, offset: 0.5 }, 200);      // current -> 1.2 -> current
  ```
- Avoid/caveats: The implicit start is the computed style when the animation starts, which includes any running animation, not only the static style. Combine with item 2 if the end state must stay.
- Status: Implicit to/from keyframes: Chrome 84, Firefox 75, Safari 13.1 (MDN BCD `api.Element.animate.implicit_tofrom`), within the Baseline "Web animations" feature (widely available since 2023-03).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Keyframe_Formats

### 11. Write keyframes in a valid form, and know which easing applies where
- Layer: js, css
- Stage: style
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low, because these are correctness rules that stop animations from doing nothing or doing the wrong thing without an error.
- Do: Use the array form (the canonical form that `getKeyframes()` returns) when keyframes need their own `offset`/`easing`, and the property-indexed form (`{ opacity: [0, 1] }`) for simple fades. Keep offsets within 0 to 1 and in ascending order. Put the easing on the keyframe when it should apply to one segment, and on the options object when it should apply to the whole iteration. Use camelCase names, `cssFloat`, and `cssOffset` (because `offset` is the keyframe offset).
- Why: Keyframe easing applies only from that keyframe to the next one; options easing applies to the whole iteration. In the property-indexed form, the arrays can have different lengths and each is spaced out on its own; short `easing`/`composite` lists repeat. In CSS, comma lists on `animation-*` longhands cycle when there are fewer values than names, and extra values are ignored (CSS article).
- Example:
  ```ts
  // Segment easing vs whole-iteration easing
  el.animate(
    [{ opacity: 0, easing: 'ease-out' }, { opacity: 1, offset: 0.2 }, { opacity: 1 }],
    { duration: 1000, easing: 'linear' },
  );
  ```
- Avoid/caveats: A `float` keyframe has no effect, because `float` is not animatable (Keyframe Formats page).
- Status: Baseline "Web animations" (widely available since 2023-03-16), web-features 3.39.0.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Keyframe_Formats ; https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Animations/Using

### 12. End exit animations in `display: none`, not in `opacity: 0`, and give Firefox a JS fallback
- Layer: css, js
- Stage: layout, paint, style
- Metrics: FPS/smoothness, memory, INP
- When: interaction, long-lived session
- Impact: medium, because a panel hidden only by `opacity: 0` still takes layout, paint and hit-testing work (the article notes it "would always take up the space").
- Do: For closing panels and dialogs, put `display` (or `content-visibility`) in the exit keyframes so the element leaves rendering when the fade ends. In engines without keyframe-animatable `display`, run the fade with WAAPI and set `hidden`/`display: none` when `finished` resolves.
- Why: The CSS article explains that animating `display` from a visible value to `none` flips at 100%, so the content stays visible for the whole fade, and from `none` to visible flips at 0%. So you get a smooth fade and the element still leaves the render tree at the end.
- Example:
  ```ts
  async function closePanel(panel: HTMLElement): Promise<void> {
    const fade = panel.animate({ opacity: [1, 0] }, { duration: 150, easing: 'ease-in', fill: 'forwards' });
    try { await fade.finished; } catch { return; }
    panel.hidden = true; // leaves layout/paint in every engine
    fade.cancel();       // drop the fill once the element is hidden
  }
  ```
- Avoid/caveats: The article says "supporting browsers", and Firefox is not one of them: in Firefox the `display` value in keyframes is ignored, so the CSS-only fade-out from the article snaps shut. Do not call `commitStyles()` after hiding (item 2: it throws when the element is not rendered). For entry transitions from `display: none`, CSS transitions also need `@starting-style` and `transition-behavior: allow-discrete` (other agents cover these).
- Status: `display` keyframe-animatable: Chrome 116, Safari 18, Firefox not supported (bug 1834877). `content-visibility` keyframe-animatable: Chrome 116, Safari 18, no Firefox. web-features "display animation" is not Baseline (MDN BCD 8.1.2; web-features 3.39.0).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Animations/Using ; https://bcd.developer.mozilla.org/bcd/api/v0/current/css.properties.display.json

### 13. Honor `prefers-reduced-motion` in CSS, WAAPI and chart animations, and tone motion down instead of only removing it
- Layer: css, js
- Stage: style, composite, main-thread-task
- Metrics: FPS/smoothness
- When: load, animation/render-loop, long-lived session
- Impact: medium, because it is an accessibility requirement and it also removes GPU and main-thread work for those users.
- Do: Put the calm variant in a `@media (prefers-reduced-motion: reduce)` block after the default rules. Replace scale and pan with a short opacity change, as the MDN example does. In JS, read `matchMedia('(prefers-reduced-motion: reduce)')`, listen for `change`, and pass `duration: 0` or skip the start-up animation. For SciChart series, leave out the `animation` constructor option (for example a sweep or wave start-up animation) when the query matches.
- Why: The MDN reference says the setting asks for an interface that "removes, reduces, or replaces" motion, and that scaling or panning large objects can trigger vestibular symptoms. The reduced rules win because they have the same specificity and come later in source order. `@media (prefers-reduced-motion)` with no value is the same as `reduce`.
- Example:
  ```ts
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let motionMs = reduceMotion.matches ? 0 : 200;
  reduceMotion.addEventListener('change', (e) => { motionMs = e.matches ? 0 : 200; });

  function reveal(el: HTMLElement): Animation {
    return el.animate({ opacity: [0, 1] }, { duration: motionMs });
  }
  ```
  ```css
  .price-flash { animation: flash-scale 300ms; }
  @media (prefers-reduced-motion: reduce) {
    .price-flash { animation: flash-fade 300ms; } /* color/opacity only */
  }
  ```
- Avoid/caveats: "Reduce" is not "none": keep state changes readable (a short fade or a color change still tells the trader the price moved). The Firefox `ui.prefersReducedMotion` pref and the OS switches listed on the MDN page help you test.
- Status: `prefers-reduced-motion` Baseline widely available (low 2020-01-15, high 2022-07-15), MDN (2026-06-10) and web-features 3.39.0. SciChart.js v4 series take an `animation` constructor option and have `runAnimation()`/`enqueueAnimation()` (SciChart docs).
- Sources: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion ; https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API ; https://www.scichart.com/documentation/js/v4/2d-charts/animations-api/animations-api-overview/

### 14. Do not build on the `Sec-CH-Prefers-Reduced-Motion` client hint; if you use it, know that `Critical-CH` costs a retry
- Layer: network
- Stage: network
- Metrics: TTFB, FCP
- When: load
- Impact: low, because the header works only in Chromium, and the critical form adds a full request round trip.
- Do: Treat the client-side media query as the source of truth. Use the header only as an optional server hint for Chromium users. If you opt in, list it in `Accept-CH` and `Vary`, and think twice before you add it to `Critical-CH`.
- Why: The WAAPI hub names the header as an equivalent of the media query. The MDN header page shows the flow: the server sends `Accept-CH` (plus `Vary`, and optionally `Critical-CH`), and with `Critical-CH` the browser automatically retries the request with the hint. That retry is an extra round trip before the first byte of the real response. `Vary` also splits the HTTP cache per value.
- Example:
  ```http
  Accept-CH: Sec-CH-Prefers-Reduced-Motion
  Vary: Sec-CH-Prefers-Reduced-Motion
  ```
- Avoid/caveats: Firefox and Safari never send it, so the page must work without it. It is a secure-context-only, forbidden (`Sec-`) request header.
- Status: Experimental, not Baseline: Chrome/Edge 108+, no Firefox, no Safari (MDN BCD 8.1.2; MDN header page modified 2025-12-17). The WAAPI hub (2026-09-11) mentions it with no warning, so treat that mention as incomplete.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API ; https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-CH-Prefers-Reduced-Motion

### 15. Give auto-playing motion a pause control, and implement it with `document.getAnimations()`
- Layer: js
- Stage: composite, main-thread-task, idle
- Metrics: FPS/smoothness, memory
- When: long-lived session
- Impact: medium, because a trading screen can have many looping indicators (blinking status, spinners, marquees), and pausing them all stops their frame work at once.
- Do: Give the user a "pause animations" setting. Implement it by pausing (or finishing) every animation in the document, and apply the same setting to new animations. Do not loop blinking or flashing effects without end.
- Why: The WAAPI hub asks for a way to pause or disable animation and links WCAG success criterion 2.2.2 (Pause, Stop, Hide), and warns that blinking and flashing can harm users with ADHD, vestibular disorders, epilepsy or migraine. MDN `Document.getAnimations()` says the array "includes CSS Animations, CSS Transitions, and Web Animations", so one call reaches all of them.
- Example:
  ```ts
  function setMotionPaused(paused: boolean): void {
    document.documentElement.toggleAttribute('data-motion-paused', paused);
    for (const a of document.getAnimations()) {
      paused ? a.pause() : a.play();
    }
  }
  ```
  ```css
  :root[data-motion-paused] * { animation-play-state: paused !important; }
  ```
- Avoid/caveats: `getAnimations()` builds a new array each call; call it on a user action, not every frame. `play()` restarts animations that had already finished, so track which ones you paused if some had ended. Canvas and WebGL loops (SciChart) are not in this list; pause them through their own API.
- Status: `Document.getAnimations()` Baseline widely available (low 2020-09-16, high 2023-03-16), web-features 3.39.0.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API ; https://developer.mozilla.org/en-US/docs/Web/API/Document/getAnimations

### 16. In browser tests, finish or pause all animations through WAAPI instead of waiting on timers
- Layer: tooling
- Stage: main-thread-task
- Metrics: startup
- When: testing
- Impact: low, because it makes UI tests faster and less flaky and adds no production cost.
- Do: In `*.browser.test.ts` or Playwright tests, call `document.getAnimations().forEach((a) => a.finish())` before asserting on end states, or assert on `el.getAnimations()` to prove an animation started. Do not `sleep(duration)`.
- Why: The WAAPI Concepts page lists automated tests as a use of the API: tests can check that UI animations run. `finish()` jumps to the end state at once and resolves `finished`.
- Example:
  ```ts
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  await expect(page.locator('.panel')).toBeHidden();
  ```
- Avoid/caveats: `finish()` throws `InvalidStateError` for an infinite animation or a zero playback rate (Web Animations Level 1); filter those out or pause them instead.
- Status: `finish()` and `getAnimations()` Baseline widely available (2020), web-features 3.39.0.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Web_Animations_API_Concepts ; https://drafts.csswg.org/web-animations-1/

### 17. Use native WAAPI for DOM motion; do not ship the `web-animations-js` polyfill or a large library for simple transitions
- Layer: build, js
- Stage: network, script-compile
- Metrics: bundle-size, startup
- When: build
- Impact: low to medium, depending on what you would otherwise bundle.
- Do: Write DOM motion with CSS animations or `element.animate()`. Remove `web-animations-js` from dependencies. Use an animation library only for features WAAPI lacks (for example physics or timeline authoring tools).
- Why: The Concepts page says WAAPI is a performant base for animation libraries and can sometimes remove the need for one. Its "See also" still links the `web-animations-js` polyfill, but WAAPI has been Baseline widely available since 2023-03, and the polyfill repository was last pushed on 2021-06-20.
- Avoid/caveats: Some libraries give you sequencing and interruption handling that you would need to rebuild; judge by the features you actually use.
- Status: "Web animations" Baseline widely available (low 2020-09-16, high 2023-03-16), web-features 3.39.0. The polyfill link on the Concepts page is outdated (GitHub API: `pushed_at` 2021-06-20, not archived).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Web_Animations_API_Concepts ; https://github.com/web-animations/web-animations-js

### 18. Treat scroll and view timelines as progressive enhancement; the "only one timeline" text is outdated
- Layer: css, js
- Stage: composite, main-thread-task
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: low, because for this product it matters only if you drive UI from scroll position.
- Do: When an effect follows scroll (a sticky header shrink, a progress bar), prefer `animation-timeline: scroll()`/`view()` or `new ScrollTimeline()` over a `scroll` listener that writes styles, behind `@supports (animation-timeline: scroll())` or a `'ScrollTimeline' in window` check, with a static fallback.
- Why: The Concepts page (text from before 2023) says there is only one kind of timeline, the document timeline, and that scroll-based timelines may come "in the future". They exist now. The WAAPI hub also lists `animation-timeline` and the scroll-driven animations module. A timeline-driven animation needs no per-scroll JS on the main thread.
- Avoid/caveats: Not Baseline: Firefox has it only in preview builds. The Level 2 "group effects" and "sequence effects" that the Concepts page mentions are still only in the editor's draft (updated 2026-09-04) and ship in no browser; sequence with `await anim.finished` or `delay`.
- Status: `animation-timeline`, `ScrollTimeline`, `ViewTimeline`, `animate()` `rangeStart`/`rangeEnd`: Chrome/Edge 115, Safari 26, Firefox "preview" only (MDN BCD 8.1.2); web-features "Scroll-driven animations" not Baseline (3.39.0).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Web_Animations_API_Concepts ; https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API ; https://bcd.developer.mozilla.org/bcd/api/v0/current/css.properties.animation-timeline.json ; https://drafts.csswg.org/web-animations-2/

---

## Standard levers seen
- Prefer declarative CSS animations/WAAPI over JS that writes styles every frame: the engine can skip frames under load and lower the update rate in hidden tabs (Using CSS animations).
- Animate transform/opacity-type properties (`translate`, `scale`) instead of box-model properties such as `font-size` or `width` (Using CSS animations).
- Animated properties already act as `will-change`; set `will-change` before an animation starts, never inside `@keyframes`, and remove it afterwards (MDN `will-change`, Tips).
- `will-change` or a running opacity/transform animation creates a stacking context up front; expect z-order changes (Tips, `will-change`).
- Sequence and clean up on `finished`/`animationend`, not on `setTimeout(duration)` (Tips, Using CSS animations).
- Use the `animation` shorthand, but set `animation-composition` separately because the shorthand does not include it (Using CSS animations).

## Outdated or incomplete advice found (as of 2026-09-22)
- WAAPI Concepts (modified 2025-04-03): "only one kind of timeline object": outdated; `ScrollTimeline`/`ViewTimeline` ship in Chrome 115+ and Safari 26+ (Firefox preview only).
- WAAPI Concepts: link to the `web-animations-js` polyfill: not needed (WAAPI Baseline widely available since 2023-03; repository inactive since 2021-06).
- WAAPI Concepts: Group/Sequence effects "in the level 2 spec": still draft-only, no browser ships them.
- Using CSS animations (2025-12-15): "all three possible animation events": incomplete; `animationcancel` exists (not Baseline; Chrome supports it only through `addEventListener`).
- Using CSS animations: animating `display`/`content-visibility` "in supporting browsers": Firefox still does not support it (bug 1834877); not Baseline.
- MDN `commitStyles()`: "most code should continue to set fill": still safe, but from Chrome 144 / Firefox 142 / Safari 26.2 fill is no longer required.
- WAAPI hub (2026-09-11): suggests `Sec-CH-Prefers-Reduced-Motion` as an equivalent without saying it is experimental and Chromium-only.

## Sources read
- https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Animations/Using (modified 2025-12-15)
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Tips (modified 2025-12-17)
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Keyframe_Formats (modified 2025-11-07)
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion (modified 2026-06-10)
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API (modified 2026-09-11)
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Web_Animations_API_Concepts (modified 2025-04-03)
- https://developer.mozilla.org/en-US/docs/Web/API/Animation/commitStyles (modified 2026-09-07)
- https://developer.mozilla.org/en-US/docs/Web/API/Animation/persist (modified 2023-07-07)
- https://developer.mozilla.org/en-US/docs/Web/API/Animation/play (modified 2026-08-22)
- https://developer.mozilla.org/en-US/docs/Web/API/Animation/cancel (modified 2026-08-27)
- https://developer.mozilla.org/en-US/docs/Web/API/Document/getAnimations
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/will-change (modified 2026-08-04)
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-CH-Prefers-Reduced-Motion (modified 2025-12-17)
- https://drafts.csswg.org/web-animations-1/ (sections on replaced-animation removal and `commitStyles()`)
- https://drafts.csswg.org/web-animations-2/ (editor's draft updated 2026-09-04; checked for GroupEffect/SequenceEffect)
- https://cdn.jsdelivr.net/npm/web-features/data.json (web-features 3.39.0, published 2026-09-17)
- https://bcd.developer.mozilla.org/bcd/api/v0/current/ keys: css.properties.display, css.properties.content-visibility, css.properties.animation-timeline, api.Element.animationcancel_event, http.headers.Sec-CH-Prefers-Reduced-Motion, api.Animation.commitStyles, api.Element.animate (BCD 8.1.2)
- https://api.github.com/repos/web-animations/web-animations-js (activity check)
- https://www.scichart.com/documentation/js/v4/2d-charts/animations-api/animations-api-overview/ (series `animation` option name)

## Not covered / could not access
- The MDN "Using the Web Animations API" guide and the `Element.animate()` reference were not read in full (they are two levels deep); only the facts cited above were checked against BCD and the spec.
- The pages linked from the WAAPI hub's Accessibility section (A List Apart, CSS-Tricks 2019, WebKit 2017, WCAG 2.2.2 Understanding page) were not read; WCAG 2.2.2 is cited only by name, as the hub cites it.
- Compositor-thread behavior of WAAPI transform/opacity animations in each engine is not stated in these articles; that belongs to the CSS rendering and GPU topics covered by other agents.
- The MDN BCD tables on the pages render only with JavaScript; support data came from the BCD API and web-features instead.
