# JS events and input (EVT-)

Open this when you write or change an event listener or a gesture: pointer, mouse, touch, wheel, key, click, input, scroll, resize, drag.
Stage cards: `pipeline.md` §H, the `tasks`, `style`, `layout` and `composite` cards. INP subparts: §G. The order of work in one frame: §C.

## Checklist

| ID | Do this | Impact | First stage |
|---|---|---|---|
| **§A The INP model** | | | |
| EVT-01 | Paint the feedback first, then yield; call `preventDefault()` before any `await` | high | tasks |
| EVT-02 | Find the dominant INP subpart before you change code | high | tasks |
| **§B High-rate input** | | | |
| EVT-03 | Coalesce `pointermove`, `wheel` and scroll visuals into one rAF; the latest value wins | high | tasks |
| EVT-04 | `getCoalescedEvents()` only for freehand paths; `getPredictedEvents()` to cut lag | medium | tasks |
| EVT-05 | Drag with `setPointerCapture`; end on `pointerup`, `pointercancel` and `lostpointercapture` | medium | tasks |
| EVT-06 | No style writes in continuous handlers that the next rAF pays for with a forced layout | medium | layout |
| **§C Layout reads** | | | |
| EVT-07 | Read layout first, then write; never alternate reads and writes in a loop | high | layout |
| EVT-08 | Use a rect cached from ResizeObserver and scroll; no geometry reads per pointer event | high | layout |
| **§D Listener options** | | | |
| EVT-09 | Passive touch and wheel listeners; block scrolling only on the surface that needs it | high | composite |
| EVT-10 | Delegate for large or re-rendered collections; one shared listener per global event | medium | js |
| **§E Debounce, throttle, cancel** | | | |
| EVT-11 | Throttle visuals with rAF; debounce only non-visual work; use `scrollend` | medium | tasks |
| EVT-12 | Cancel superseded work with one `AbortController` per user intent | medium | tasks |
| EVT-13 | Keep logging, analytics and persistence off the input path | medium | tasks |
| **§F Pointers** | | | |
| → LIFE-01 | One teardown `AbortSignal` per owner removes every listener, timer and observer | | |
| → LIFE-02 | A new controller per call for methods that run many times | | |
| → TASK-03 | The `yieldToMain()` helper and its fallback | | |
| → DATA-06 | Data ticks: flush once per frame, like pointer input | | |
| → DATA-08 | High-rate values (pointer position, scroll offset) stay out of reactive state | | |
| → DOM-09 | Popover and anchor positioning instead of scroll and resize listeners that place tooltips | | |
| **§G One-line rules** | | | |
| EVT-14 | Start `import()` of a lazy feature on intent, before the click needs it | medium | network |
| EVT-15 | Put a final-size placeholder in the same frame when the result comes later | medium | layout |
| EVT-16 | Move elements with `transform` during drags, pans and scrolls | medium | layout |
| EVT-17 | Profile the iframe when the slow interaction is inside it | low | tasks |
| EVT-18 | Sliders: apply the visual value per frame, run the expensive part on `change` | medium | tasks |

## §A The INP model

### EVT-01 Paint the feedback first, then yield; call `preventDefault()` before any `await`
stage: tasks, paint · metric: INP · when: interaction · impact: high — INP ends at the next paint, so work that this frame does not need only delays it · support: scheduler-yield · also: TASK-03, TASK-02, EVT-13
- Do: In a click, key, change or submit handler, first make the smallest visible change: a pressed state, a spinner, an optimistic value. Then yield with the `yieldToMain()` helper (TASK-03) and do the rest: filtering, validation, requests. Call `preventDefault()` and `stopPropagation()` synchronously, before the first `await`. When the rest must start only after the frame is painted, use `requestAnimationFrame(() => setTimeout(rest))`.
- Why: INP is input delay plus processing (all handlers of the interaction) plus presentation delay, up to the next presented frame. Event dispatch is synchronous, so a `preventDefault()` after an `await` runs after dispatch has ended and does nothing. A yield lets the browser render, but it does not force a frame before the continuation; rAF followed by a task does.
- Detect: `rg -n -A8 "addEventListener\(\s*['\"](click|keydown|input|change|submit|pointerup)" -g '*.{ts,js,tsx,jsx,svelte,vue}'`, then read the handler: heavy calls before the visible change are candidates. `rg -n -U 'await[^;]*;[^}]*\.preventDefault\(\)' -g '*.{ts,js,tsx,jsx}'` finds `preventDefault()` after an `await`.
- Verify: measure.md#inp with the interaction. Pass: compare-runs verdict "win" on the processing time of the worst interaction, the presentation delay is not worse, and the feedback shows in the first frame after the input.
- Example:
  ```ts
  // Before: 300 ms of filtering runs before the pressed state can paint
  filterButton.addEventListener('click', () => {
    applyFilters(products);
    filterButton.setAttribute('aria-pressed', 'true');
  });
  // After: feedback in the next frame, heavy work in a later task
  filterButton.addEventListener('click', async (e) => {
    e.preventDefault();                               // synchronous, before any await
    filterButton.setAttribute('aria-pressed', 'true');
    grid.classList.add('is-updating');
    await yieldToMain();                              // helper: TASK-03
    applyFilters(products);                           // still over 50 ms? slice it (TASK-02)
  }, { signal });
  ```
- Avoid: Do not yield between two changes that must appear in the same frame. A yield does not make 300 ms of work cheap: the next input still waits behind it (TASK-02). Network time is not in INP, but the user still needs a pending state. `requestIdleCallback` does not shorten an interaction (TASK-07).
- Source: https://web.dev/articles/optimize-inp ; https://github.com/github/eslint-plugin-github/blob/main/docs/rules/async-preventdefault.md

### EVT-02 Find the dominant INP subpart before you change code
stage: tasks, style, layout · metric: INP · when: interaction · impact: high — each subpart has a different fix, and the fix for the wrong one moves time instead of removing it · support: event-timing, long-animation-frames · also: TASK-06, EVT-07, EVT-13
- Do: Measure the slow interaction and split it: input delay, processing duration, presentation delay. Fix only the largest one. Input delay: shorten the task that was running when the input came (startup evaluation, a timer, an earlier handler). Processing: a shorter handler and a yield (EVT-01). Presentation delay: less rAF work, a narrower style and layout scope, fewer DOM nodes.
- Why: In a long animation frame, the `invokerType` of the script that ran before the input names the cause of input delay: `classic-script` or `module-script` (startup evaluation), `user-callback` (a timer or rAF), `event-listener` (an earlier input), `resolve-promise` (an async continuation). `forcedStyleAndLayoutDuration` shows layout thrashing inside a handler (EVT-07).
- Detect: `rg -n "from 'web-vitals" -g '*.{ts,js,tsx,jsx}'`, then check that INP comes from the `web-vitals/attribution` build and that the three subparts are sent. In a review, a change to an interaction that names no subpart is a finding.
- Verify: measure.md#inp. Pass: the dominant subpart and its number are recorded before the change, and after the change that subpart is lower while the other two are not higher.
- Avoid: INP does not measure scroll, hover, pan or zoom, and `pointermove` is not an interaction (only the `pointerdown` and `pointerup` of a drag are): use measure.md#fps for those. A tap gives `pointerdown`, `pointerup` and `click` with one `interactionId`, so check the handlers of all three. Event Timing skips entries under 104 ms by default; set `durationThreshold` (minimum 16) in your own collector. Lab INP is a proxy for field INP, and TBT is not INP.
- Source: https://web.dev/articles/find-slow-interactions-in-the-field ; https://web.dev/articles/inp

## §B High-rate input

### EVT-03 Coalesce `pointermove`, `wheel` and scroll visuals into one rAF; the latest value wins
stage: tasks, style, layout, paint · metric: frame, INP · when: interaction, render-loop · impact: high — input can arrive faster than frames, and each extra render in a frame costs time but shows nothing · support: baseline · also: DATA-06, DATA-08, EVT-08
- Do: In `pointermove`, `wheel`, `scroll` and `resize` handlers, only store the latest value (for `wheel`, add the delta to a sum) and request one rAF when none is pending. Render once in that rAF from the stored state. Keep the value in a plain variable, not in reactive framework state (DATA-08). Data ticks use the same pattern (DATA-06).
- Why: A mouse sends about 100 events per second, and pens and gaming mice send more. Chromium already dispatches continuous events about once per frame, just before rAF, but a discrete event (a key, a click) flushes them early, and a render in each handler still repeats work that only the last one needed. The rAF throttle adds no frame of delay.
- Detect: `rg -n -A6 "addEventListener\(\s*['\"](pointermove|mousemove|touchmove|wheel|scroll|resize)" -g '*.{ts,js,tsx,jsx,svelte,vue}'`, then check that the handler only stores state and schedules one rAF. DOM writes, `render(`, `draw(` or state setters in the handler body are candidates.
- Verify: measure.md#fps with a pan or drag scenario (`run_scenario`). Pass: frame p95 wins or stays neutral, and `trace-summary.mjs --between wp:start wp:end` counts fewer `Layout` and `Paint` events than the baseline.
- Example:
  ```ts
  let x = 0, y = 0, queued = false;
  pane.addEventListener('pointermove', (e) => {
    x = e.clientX; y = e.clientY;                   // store only; the latest value wins
    if (!queued) { queued = true; requestAnimationFrame(paint); }
  }, { signal });                                   // teardown: LIFE-01
  function paint() {
    queued = false;
    marker.style.transform = `translate(${x - rect.left}px, ${y - rect.top}px)`; // rect: EVT-08
  }
  ```
- Avoid: Do not throttle visuals with a fixed interval (16 or 20 ms): it drifts against the display (EVT-11). rAF does not run in hidden tabs, so keep model updates out of it; only drawing goes there. Do not drop events that carry meaning (`pointerup`, the wheel delta sum); coalesce only positions.
- Source: https://developer.chrome.com/blog/aligning-input-events ; https://nolanlawson.com/2019/08/14/browsers-input-events-and-frame-throttling/

### EVT-04 `getCoalescedEvents()` only for freehand paths; `getPredictedEvents()` to cut lag
stage: tasks · metric: frame · when: interaction · impact: medium — one sample per frame loses detail in a fast freehand stroke, and drawing per sample wastes the frame · support: coalesced-events, predicted-events · also: EVT-03
- Do: For freehand paths, handwriting or a signature pad, read `e.getCoalescedEvents()` in `pointermove` and push every sample into the path; draw once per frame (EVT-03). Use `?.` and fall back to `[e]`: the method exists only in secure contexts. To hide latency, draw a provisional segment to the last `getPredictedEvents()` point and discard it on the next event. For a cursor, a hover or a pan, read only the event itself.
- Why: The browser merges high-rate samples into about one `pointermove` per frame. Coalesced events give back the merged samples without extra dispatch. They are never dispatched on their own, so `preventDefault()` on them does nothing.
- Detect: `rg -n 'getCoalescedEvents|getPredictedEvents|pointerrawupdate' -g '*.{ts,js,tsx,jsx,svelte,vue}'`: a draw call per sample, or use outside a path tool, is a candidate. Also freehand code (`lineTo(` inside a `pointermove` handler) that reads only the event itself.
- Verify: measure.md#fps with a drag scenario. Pass: frame p95 is neutral or a win against the one-sample version, and a screenshot of a fast stroke shows a smooth path.
- Example:
  ```ts
  surface.addEventListener('pointermove', (e) => {
    if (!e.buttons) return;
    const samples = e.getCoalescedEvents?.() ?? [];
    for (const p of samples.length ? samples : [e]) stroke.push(p.clientX - rect.left, p.clientY - rect.top);
    predicted = e.getPredictedEvents?.().at(-1) ?? null;  // drawn once, then dropped
    requestRender();                                       // one rAF (EVT-03)
  }, { signal });
  ```
- Avoid: Coalesced events do not raise the handler rate, but work per sample does: push numbers, do not draw. `pointerrawupdate` sends unaligned events at a higher rate; use it only when measured latency needs it, and keep its handler tiny.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents ; https://w3c.github.io/pointerevents/

### EVT-05 Drag with `setPointerCapture`; end on `pointerup`, `pointercancel` and `lostpointercapture`
stage: tasks, memory · metric: frame, memory · when: interaction · impact: medium — drags without capture and a full cleanup leave document-wide listeners that run on every move · support: baseline, abortsignal-any · also: LIFE-01, EVT-09
- Do: On `pointerdown`, call `setPointerCapture(e.pointerId)` on the dragged element and listen for `pointermove` on that element only. End the drag in one function that runs on `pointerup`, `pointercancel` and `lostpointercapture`. Give each drag its own `AbortController`, so the end removes all drag listeners in one call. Declare `touch-action` on the drag surface (EVT-09).
- Why: Capture sends every event of that pointer to the element, also outside its box, so the drag needs no listener on `window` or `document`. Without `pointercancel` and `lostpointercapture`, a drag that the browser takes over (a touch scroll, a lost focus, a removed element) never ends: the move listener stays and the state stays "dragging".
- Detect: `rg -n "(window|document)\.addEventListener\(\s*['\"](pointermove|mousemove|touchmove)" -g '*.{ts,js,tsx,jsx,svelte,vue}'` in drag code; `rg -n 'setPointerCapture' -g '*.{ts,js,tsx,jsx,svelte,vue}'`, then check that `pointercancel` and `lostpointercapture` end the drag.
- Verify: measure.md#mem with 10 drags. Pass: the app counters that `__wpProbe.memory.sample()` reads from `window.__perf.counters()` (active drags, drag listeners) return to baseline after each drag, and heap growth per drag stays within noise.
- Example:
  ```ts
  card.addEventListener('pointerdown', (e) => {
    card.setPointerCapture(e.pointerId);
    const drag = new AbortController();
    const opts = { signal: AbortSignal.any([drag.signal, viewSignal]) }; // view teardown: LIFE-01
    const end = (ev: PointerEvent) => {
      if (drag.signal.aborted) return;
      drag.abort();
      finishDrag(ev.type === 'pointerup');                             // commit or roll back
    };
    card.addEventListener('pointermove', onDragMove, opts);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) card.addEventListener(type, end, opts);
  }, { signal: viewSignal });
  ```
- Avoid: Do not keep a `pointermove` listener on `window` for the whole life of a view "for drags". Capture does not replace `touch-action`: without it, a touch drag can turn into a page scroll and end in `pointercancel`. Capture is released on its own after `pointerup`; call `releasePointerCapture` only to end a drag early.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture ; https://w3c.github.io/pointerevents/

### EVT-06 No style writes in continuous handlers that the next rAF pays for with a forced layout
stage: layout, style · metric: frame, INP · when: interaction, render-loop · impact: medium — a style write in the handler makes the first geometry read of the frame a forced layout · support: baseline · also: EVT-03, EVT-07
- Do: In `scroll`, `pointermove`, `touchmove` and `wheel` handlers, only record values (`lastTop = list.scrollTop`) and request one rAF. In the rAF callback, do all reads first, then all writes (EVT-07). If a handler must toggle a class, make no geometry read after it in the same frame.
- Why: These handlers run just before the rAF callbacks of the same frame. A class or style write in the handler invalidates style, so the first `offsetHeight` or `getBoundingClientRect()` in rAF runs style and layout inside script, and the frame then runs layout again after rAF.
- Detect: `rg -n -A8 "addEventListener\(\s*['\"](scroll|pointermove|touchmove|wheel)" -g '*.{ts,js,tsx,jsx,svelte,vue}' | rg '\.style\.|classList\.|setAttribute\('`, then look for geometry reads in the rAF callback that follows.
- Verify: measure.md#fps with a scroll or drag scenario. Pass: "Forced by script" in `trace-summary.mjs --between wp:start wp:end` lists no layout from that handler or its rAF, and frame p95 wins or stays neutral.
- Avoid: Reading `scrollTop` in the handler is fine while nothing is dirty; the cost comes from the write before a read. Moving all work into rAF does not help if rAF itself alternates reads and writes.
- Source: https://web.dev/articles/debounce-your-input-handlers

## §C Layout reads

### EVT-07 Read layout first, then write; never alternate reads and writes in a loop
stage: layout, style · metric: INP, frame · when: interaction, render-loop · impact: high — each read after a write forces style and layout in script, and in a loop it does so once per item · support: baseline · also: EVT-08, DOM-07
- Do: In a handler or a rAF callback, read all geometry first into local variables, then do all writes. Hoist reads out of loops. Treat these as reads: `offset*`, `client*`, `scroll*` (read or set), `getBoundingClientRect()`, `getClientRects()`, `getComputedStyle()` for geometry, `innerText`, `focus()`, `scrollIntoView()`, `elementFromPoint()`, `window.scrollX/Y`, `innerWidth` and `MouseEvent.offsetX/Y`. Use `textContent` for text.
- Why: Before the first write in a frame, the last layout is still valid, so a read is cheap. After a write, a read makes the browser run style and layout at once, inside script (a forced synchronous layout). In a loop this is layout thrashing: one layout per item instead of one per frame.
- Detect: `rg -n -B3 -A3 '\.(offset(Width|Height|Top|Left)|client(Width|Height)|scroll(Top|Left|Width|Height)|innerText)\b|getBoundingClientRect\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'` inside loops, or after `.style.`, `classList.` or a node insert in the same function.
- Verify: measure.md#inp, or measure.md#fps for per-frame code. Pass: the `ForcedReflow` insight is gone or smaller, "Forced by script" in `trace-summary.mjs` drops for that function, and `forcedLayoutMs` in `__wpProbe.loaf.read()` goes down.
- Example:
  ```ts
  // Before: one layout per cell
  for (const cell of cells) cell.style.width = `${header.offsetWidth}px`;
  // After: one read, then the writes
  const width = header.offsetWidth;
  for (const cell of cells) cell.style.width = `${width}px`;
  ```
- Avoid: A read is free only when nothing is invalid: a class change, a node insert or a focus change invalidates. The list of forcing APIs is not complete; the trace decides. Batching writes into a `DocumentFragment` is not the fix: writes in one task already cost one layout, and the forced reads are the cost (DOM-07).
- Source: https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing ; https://gist.github.com/paulirish/5d52fb081b3570c81e3a

### EVT-08 Use a rect cached from ResizeObserver and scroll; no geometry reads per pointer event
stage: layout · metric: frame, INP · when: interaction, render-loop · impact: high — a geometry read in a pointer handler becomes a forced layout on every event once anything has written styles · support: baseline · also: EVT-07, EVT-03
- Do: Compute pointer positions as `e.clientX - rect.left` from a cached rect. Refresh the rect in a `ResizeObserver` callback, in a passive capture `scroll` listener on `window`, and after your own code moves the element. Do not read `e.offsetX/Y` or `layerX/Y`, and do not call `getBoundingClientRect()`, in `pointermove`.
- Why: `offsetX/Y` and `layerX/Y` force layout in Chromium, and so does `getBoundingClientRect()`. When a style changed since the last frame, each event then pays a full layout. ResizeObserver callbacks run in the rendering step after layout, so a read there is cheap.
- Detect: `rg -n -A10 "(pointermove|mousemove|touchmove)" -g '*.{ts,js,tsx,jsx,svelte,vue}' | rg 'offsetX|offsetY|layerX|layerY|getBoundingClientRect\(|getComputedStyle\('`
- Verify: measure.md#fps with a hover or drag scenario. Pass: "Forced by script" in `trace-summary.mjs --between wp:start wp:end` shows no layout from the pointer handler, and frame p95 wins or stays neutral.
- Example:
  ```ts
  let rect = pane.getBoundingClientRect();                      // once, at mount
  const refresh = () => { rect = pane.getBoundingClientRect(); };
  const ro = new ResizeObserver(refresh);                       // ro.disconnect() on teardown: LIFE-01
  ro.observe(pane);
  window.addEventListener('scroll', refresh, { passive: true, capture: true, signal }); // nested scrollers too
  pane.addEventListener('pointermove', (e) => {
    hover.moveTo(e.clientX - rect.left, e.clientY - rect.top);  // no layout read here
  }, { signal });
  ```
- Avoid: The cache goes stale when the element moves without a resize or a scroll (a side panel opens, content above it grows): refresh it from that code too. An `IntersectionObserver` entry has a rect, but it arrives in a later task, so do not use it for positions in the current frame.
- Source: https://gist.github.com/paulirish/5d52fb081b3570c81e3a ; https://drafts.csswg.org/resize-observer/

## §D Listener options

### EVT-09 Passive touch and wheel listeners; block scrolling only on the surface that needs it
stage: composite, tasks · metric: frame · when: interaction · impact: high — a listener that may cancel scrolling makes the compositor wait for the main thread before it scrolls · support: baseline · also: EVT-05, EVT-10
- Do: Pass `{ passive: true }` to every `touchstart`, `touchmove` and `wheel` listener that does not cancel scrolling, also where it is the default. When a surface handles pan or zoom itself (a canvas chart, a map, a zoomable image), declare the gestures in CSS with `touch-action` (`none`, or `pan-y` when the page must still scroll). Attach the one `wheel` listener that calls `preventDefault()` to that surface only, with `{ passive: false }` and a comment that says why.
- Why: While a listener can cancel the scroll, the compositor cannot scroll that region on its own, so a long task on the main thread freezes scrolling there. `touch-action` tells the browser before any script runs which gestures it may handle, so touch listeners can stay passive. Chromium makes touch and wheel listeners on the window, the document, `<html>` and `<body>` passive by default; listeners on other elements are not.
- Detect: `rg -n "addEventListener\(\s*['\"](touchstart|touchmove|wheel|mousewheel)['\"]" -g '*.{ts,js,tsx,jsx,svelte,vue}'`, then check for `passive`; `rg -n 'passive:\s*false'` on `window`, `document` or `body`; `preventDefault()` in a touch handler where `touch-action` would do.
- Verify: measure.md#fps with a trusted wheel or touch scroll while the scenario keeps the main thread busy. A scripted `WheelEvent` does not scroll, so when the tools cannot send real input, ask the user to turn on "Scrolling performance issues" in the DevTools Rendering drawer. Pass: `trace-summary.mjs --between wp:start wp:end` counts fewer `DroppedFrame` events than the baseline, or the drawer marks no blocking region outside the declared surface.
- Avoid: `preventDefault()` in a passive listener is ignored (with a console warning), so a zoom handler marked passive breaks without an error. `touch-action: none` also blocks pinch-zoom on that element, which is an accessibility cost: keep it to the surface. A delegated non-passive handler on `body` blocks scrolling for the whole page. `scroll` events cannot be canceled, so `passive` changes nothing for them. Lighthouse no longer audits this; the review must.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener ; https://developer.chrome.com/blog/scrolling-intervention-2

### EVT-10 Delegate for large or re-rendered collections; one shared listener per global event
stage: js, memory · metric: memory, INP · when: load, session · impact: medium — per-row listeners are added and removed on every re-render, and their number grows with the rows · support: baseline · also: LIFE-01, DOM-02
- Do: Attach one listener to the container of a list, table or grid, and find the row with `(e.target as Element).closest('[data-id]')`; return early for other targets. For global events (`resize`, `keydown`, `visibilitychange`), keep one listener per event type that calls the subscribers, not one `addEventListener` per component instance.
- Why: Bubbling lets one parent handle events from any number of rows, also rows added later, so a re-render does not remove and add thousands of listeners. N components with their own `window` listener run N handlers for each event. MDN documents the pattern; the cost claim is an inference, so measure it.
- Detect: `rg -n -B4 "addEventListener\(" -g '*.{ts,js,tsx,jsx,svelte,vue}'` inside `forEach`, `for` or row-render functions; `window.addEventListener('resize'` or `('keydown'` in a component that mounts many times.
- Verify: measure.md#mem with 10 re-renders of the list, and measure.md#inp for a click on a row. Pass: the DOM node count and the app counters in `__wpProbe.memory.sample()` return to baseline after each re-render, and the processing time of the click is not worse.
- Example:
  ```ts
  table.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('tr[data-id]');
    if (!row || !table.contains(row)) return;
    selectRow(row.dataset.id!);
  }, { signal });
  ```
- Avoid: `focus`, `blur`, `mouseenter` and `mouseleave` do not bubble: use `focusin`, `focusout`, `pointerover` and `pointerout`, or a capture listener. A delegated handler runs for every event in the subtree, so keep it cheap, and never make it non-passive for touch or wheel (EVT-09). Some frameworks already delegate template handlers (React, Svelte); check before you rewrite them.
- Source: https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Event_bubbling

## §E Debounce, throttle, cancel

### EVT-11 Throttle visuals with rAF; debounce only non-visual work; use `scrollend`
stage: tasks · metric: frame, INP · when: interaction · impact: medium — a debounced visual update lags behind the input, and a fixed-interval throttle fights the display rate · support: scrollend · also: EVT-03, EVT-12, CSS-19
- Do: For visual updates from continuous input (a scroll progress bar, a resize layout), keep the latest value and render once per rAF (EVT-03), or use CSS or an observer instead of a listener. Debounce only expensive work that is not visual: a search request, server validation, a save. Show typed text at once and debounce only the expensive part. For work after a scroll, listen to `scrollend`, not a `setTimeout` debounce of `scroll`.
- Why: rAF runs at the display rate; a 20 ms throttle is too fast or too slow for it. A debounced `scroll` handler can fire while the user still scrolls; `scrollend` fires after the scroll and any snap have settled. For size changes, `ResizeObserver` reports the new size after layout, with no `window` listener.
- Detect: `rg -n 'debounce\(|throttle\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'`, then check what the wrapped function does: DOM writes, `render(` or draw calls are candidates. `rg -n -A4 "['\"]scroll['\"]" -g '*.{ts,js,tsx,jsx,svelte,vue}' | rg 'setTimeout|clearTimeout'` finds a hand-made scroll end.
- Verify: measure.md#fps for scroll visuals; measure.md#inp for typing. Pass: frame p95 wins or stays neutral during the scroll, and the processing time of a keystroke wins with no stale result shown.
- Example:
  ```ts
  // Before: the end of the scroll is guessed with a timer
  list.addEventListener('scroll', () => { clearTimeout(timer); timer = setTimeout(loadDetails, 150); });
  // After
  list.addEventListener('scrollend', loadDetails, { signal });
  ```
- Avoid: This replaces the common advice "debounce the scroll handler". A long debounce makes the UI feel slow even when INP looks good. A debounce does not fix a heavy visual handler: make the handler cheap. Do not write a listener for what CSS does without script: `position: sticky` headers, scroll-driven animations (CSS-19).
- Source: https://web.dev/articles/optimize-input-delay ; https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollend_event

### EVT-12 Cancel superseded work with one `AbortController` per user intent
stage: tasks, network · metric: INP · when: interaction · impact: medium — stale responses and jobs from the last input run callbacks that become input delay for the next input · support: abortsignal-any, abortsignal-timeout · also: DATA-12, TASK-08, LIFE-02
- Do: Keep one `AbortController` per user intent (a search box, a filter, a view switch). Abort the previous one before you start the next, and pass its signal to `fetch`, to chunked jobs (check `signal.aborted` after each yield) and to `scheduler.postTask` (TASK-08). Combine a user cancel and a deadline with `AbortSignal.any([ctrl.signal, AbortSignal.timeout(ms)])`, not with a manual timer. Ignore `AbortError` and `TimeoutError` quietly.
- Why: When interactions overlap (fast typing, quick view switches), the handler and rendering work of one becomes input delay for the next. An aborted `fetch` rejects with an `AbortError`, so its response is never parsed or rendered.
- Detect: `rg -n -A10 "addEventListener\(\s*['\"](input|change|keyup)" -g '*.{ts,js,tsx,jsx,svelte,vue}' | rg 'fetch\('`, then check for a `signal`; `rg -n 'setTimeout\([^)]*abort\(\)' -g '*.{ts,js,tsx,jsx}'` finds a manual timeout.
- Verify: measure.md#inp with fast typing (5 keys, 50 ms apart). Pass: the processing time of the last key wins, `list_network_requests` shows the older requests canceled, and the last result is the one on screen.
- Example:
  ```ts
  let current: AbortController | undefined;
  search.addEventListener('input', debounce(async () => {
    current?.abort();
    current = new AbortController();
    const signal = AbortSignal.any([current.signal, AbortSignal.timeout(8000)]);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(search.value)}`, { signal });
      renderResults(await res.json());
    } catch (err) {
      if (!['AbortError', 'TimeoutError'].includes((err as Error).name)) throw err;
    }
  }, 150), { signal: viewSignal });
  ```
- Avoid: An abort stops the client work, not server work that has started, so do not abort requests that change data. `keepalive` requests and beacons must not share a UI signal. Do not reuse one controller for many calls: an aborted signal stays aborted (LIFE-02).
- Source: https://web.dev/articles/optimize-input-delay ; https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static

### EVT-13 Keep logging, analytics and persistence off the input path
stage: tasks · metric: INP · when: interaction · impact: medium — all handlers of an interaction count as processing time, also the work that the user never sees · support: baseline · also: EVT-01, TASK-07, TASK-08
- Do: In handlers, do only the state change and the visible update. Send analytics, save drafts, write `localStorage` and update secondary widgets (counters, badges) after the frame: `requestAnimationFrame(() => setTimeout(work))`, a `background` task (TASK-08), or an idle callback with a timeout (TASK-07). Never call synchronous XHR, `alert()`, `confirm()` or `prompt()` in a handler.
- Why: Processing time covers every handler of the interaction, and the presentation delay starts only after the last one ends. `localStorage` and `JSON.stringify` of large state are synchronous. Long animation frames report synchronous pauses (`alert`, sync XHR) as `pauseDuration`.
- Detect: `rg -n -A10 "addEventListener\(\s*['\"](click|keydown|input|change|submit|pointerup)" -g '*.{ts,js,tsx,jsx,svelte,vue}' | rg 'track\(|analytics|gtag\(|dataLayer\.push|console\.(log|table)|localStorage\.setItem|JSON\.stringify|alert\(|confirm\('`
- Verify: measure.md#inp. Pass: the processing time of the handler wins, and `__wpProbe.loaf.read()` no longer lists the analytics or storage script in `topScripts` for the interaction frame.
- Avoid: Deferred work still runs on the main thread; when it is long, it becomes input delay for the next input, so slice it (TASK-02). Do not defer a write that the next screen reads. End-of-session data goes out when the page becomes hidden (LIFE-07), not from an input handler.
- Source: https://web.dev/articles/optimize-inp ; https://developer.chrome.com/docs/web-platform/long-animation-frames

## §G One-line rules

- **EVT-14** Start `import()` of a lazy feature on intent (`focusin` on its form, `pointerenter` on its trigger, with `{ once: true }`), so the click does not wait for download and compile; `import()` also runs the module's top-level code, so when that code must not run yet, inject `<link rel="modulepreload">` instead. [network · INP · medium] https://web.dev/articles/preload-critical-assets
- **EVT-15** When a click starts work that can take over 500 ms, insert a placeholder with the final size in the same frame and fill it later: a shift more than 500 ms after the input counts toward CLS. [layout · CLS · medium] https://web.dev/articles/cls
- **EVT-16** During drags, pans and scrolls, move elements with `transform`, not `top`, `left` or size: continuous gestures are not recent input, so their layout shifts count toward CLS. [layout · CLS · medium] https://web.dev/articles/cls
- **EVT-17** When the slow interaction is inside an iframe, profile that frame's main thread: page INP includes it, but the parent's `web-vitals` cannot see it. [tasks · INP · low] https://web.dev/articles/optimize-inp
- **EVT-18** For sliders and other continuous `input` streams, apply the visible value once per frame (EVT-03) and run the expensive part on `change` or debounced (EVT-11). [tasks · INP · medium] https://web.dev/articles/optimize-input-delay
