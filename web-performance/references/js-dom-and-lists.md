# DOM building, lists and native components (DOM-)

Open this when you write code that creates or updates many DOM nodes: long lists, tables and grids, live-updating rows, search results, menus, dialogs and popovers.
Stage cards: `pipeline.md` §H (`style`, `layout`, `tasks`, `memory`). DOM size thresholds and the `DOMSize` insight: `pipeline.md` §I.

## Checklist

| ID | Do this | Impact | First stage |
|---|---|---|---|
| §A | **DOM size** | | |
| DOM-01 | Keep the DOM small: build hidden UI when it opens, remove wrapper elements | high | style |
| §B | **Lists and tables** | | |
| DOM-02 | Virtualize long lists: visible rows plus overscan, at a fixed row height | high | style |
| DOM-03 | Key list items by a stable id from the data, never by the index | medium | js |
| DOM-04 | High-rate rows: a fixed row set, changed cells only, Text node writes | high | style |
| DOM-05 | Keep rows flat: no wrapper components or wrapper elements per row | medium | js |
| §C | **Building DOM** | | |
| DOM-06 | Build large DOM in slices across tasks, and yield between slices | high | tasks |
| DOM-07 | Clone a parsed `<template>`; no HTML parsing per update; a fragment is no speed-up | medium | js |
| DOM-08 | Keep hover and selection state apart from data and geometry state | medium | js |
| §D | **Native components** | | |
| DOM-09 | `<dialog>`, `popover`, anchor positioning and `<details>` before a UI library | medium | script-load |
| One-line | **One-line rules** | | |
| DOM-10 | Reorder rows in the document with `moveBefore()` | medium | style |
| DOM-11 | Highlight matches with the Custom Highlight API, not `<mark>` wrappers | medium | style |
| DOM-12 | Live tables: fixed table layout, fixed-width tabular numbers | medium | layout |
| DOM-13 | Infinite lists: prefetch early, append into pre-sized slots, no footer below | medium | layout |
| DOM-14 | SVG charts: one path per series, no per-point elements | medium | style |
| DOM-15 | Scope `querySelectorAll()` and drop large results | low | memory |

- → EVT-10 event delegation: one listener on the list, not one per row
- → EVT-07, EVT-08 read layout, then write; cached rects instead of layout reads per event
- → CSS-08, CSS-09 contain rows and panels; `content-visibility` for long static sections
- → CSS-13 no `:nth-child()` or sibling selectors on lists that mutate
- → DATA-06, DATA-08 flush live data once per frame; high-rate values out of reactive state
- → HTML-03 server-render the first view instead of building it in client JS

## §A DOM size

### DOM-01 Keep the DOM small: build hidden UI when it opens, and remove wrapper elements
stage: style, layout, memory · metric: INP, LCP, memory · when: load, interaction, session · impact: high — every element costs creation time and memory, and style and layout work grows with the elements that an update touches · support: n/a · also: DOM-05, CSS-09
- Do: Leave closed menus, dialogs, inactive tabs and collapsed panels out of the DOM until the user opens them. Keep them after the first open if the user comes back often, and remove them when that is unlikely. Remove `<div>` wrappers that exist only to give a component one root: use fragments or multi-root templates, and one flex or grid container instead of nested boxes.
- Why: Style recalculation and layout visit the elements that a change invalidates, and layout usually starts at the document root, so a larger tree makes each update slower. The `DOMSize` insight fails only when one layout (over 100 objects) or one style recalculation (over 300 elements) takes more than 40 ms, so judge the size by those events, not by a node count.
- Detect: `rg -n 'style="display:\s*none"|class="[^"]*\bhidden\b|v-show=' -g '*.{html,svelte,vue,tsx,jsx}'` on large subtrees that render at startup but stay hidden; component files whose only element is a wrapper around `children` or a `<slot>`.
- Verify: measure.md#inp on the interaction that updates the largest region. Pass: `DOMSize` no longer fails, and the trace-summary `Style:` element count and the processing subpart are lower than the baseline.
- Avoid: Building on demand moves the cost to the first open: paint a pending state in the same frame, and build large panels in slices (DOM-06). Keep a wrapper that is a containment boundary (`contain`, `content-visibility`) or that carries accessibility semantics. The old fixed node limits (800 and 1,400) are obsolete; do not cite them. Depth alone is not a cost.
- Source: https://developer.chrome.com/docs/performance/insights/dom-size ; https://web.dev/articles/dom-size-and-interactivity

## §B Lists and tables

### DOM-02 Virtualize long lists: render the visible rows plus overscan, at a fixed row height
stage: style, layout, memory · metric: INP, frame, memory · when: interaction, session · impact: high — without a window, node count, style, layout and memory grow with the data, not with the viewport · support: n/a · also: DOM-04, EVT-03, CSS-09
- Do: For a list, table or grid that can grow to hundreds of rows or more, use one scroll container, a spacer with the full height, and a reused pool of row elements for the visible range plus a few rows of overscan. On a passive `scroll` listener, schedule one rAF; in it, read `scrollTop`, then move the pool with `transform` and refill only rows whose item changed. Give rows a fixed height, so the offset is `index × rowHeight` and no row must be measured.
- Why: With a window, the DOM stays at about visible rows plus overscan for any data size, so style, layout and memory stay flat. A fixed row height needs no layout read to place rows, and appends below the window do not shift content.
- Detect: `rg -n '\{#each|\.map\(|v-for=|\*ngFor|@for \(' -g '*.{svelte,tsx,jsx,vue,html}'` over collections that come from a feed, a query or a log, then check for a windowing layer (a virtualizer, or a `scrollTop / rowHeight` calculation).
- Verify: measure.md#fps with a scroll over the full data set, and measure.md#mem while the data grows. Pass: `__wpProbe.memory.sample()` `domNodes` stays flat as rows are added, and frame-interval p95 and long frames win.
- Example:
  ```ts
  const ROW = 28, OVERSCAN = 6;                       // the same fixed row height in CSS
  const pool = Array.from({ length: Math.ceil(viewport.clientHeight / ROW) + 2 * OVERSCAN }, () => spacer.appendChild(makeRow()));
  let queued = false; const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  viewport.addEventListener('scroll', schedule, { passive: true, signal });   // also call schedule() when items change
  function paint() {
    queued = false;
    const first = Math.max(0, Math.floor(viewport.scrollTop / ROW) - OVERSCAN);   // read first, then write
    spacer.style.blockSize = `${items.length * ROW}px`;
    pool.forEach((row, i) => {
      const item = items[first + i];
      row.hidden = !item;
      if (item) { row.style.transform = `translateY(${(first + i) * ROW}px)`; fillRow(row, item); }   // DOM-04
    });
  }
  ```
- Avoid: Rows outside the window are not in the DOM, so find-in-page and screen readers see only the window: set `aria-rowcount` and `aria-rowindex`, and keep keyboard focus on a data id, not on a recycled element. Variable row heights need measurement and offset correction. For a few hundred static rows that must stay findable, `content-visibility: auto` (CSS-09) is simpler. Do not debounce the scroll handler: blank rows show (EVT-11).
- Source: https://web.dev/articles/dom-size-and-interactivity ; https://addyosmani.com/blog/infinite-scroll-without-layout-shifts/

### DOM-03 Key list items by a stable id from the data, never by the index
stage: js, style, layout · metric: INP, frame · when: interaction, session · impact: medium — with index keys, one insert at the top patches every row and moves row state to the wrong item · support: n/a · also: DOM-04, DOM-10
- Do: Give every keyed block a stable primitive id from the data: `key={row.id}` in JSX, `:key="row.id"` in Vue, `(row.id)` in a Svelte `{#each}`, `track row.id` in Angular. Use the index only for a list that never reorders, inserts or deletes and has no per-row state.
- Why: The framework matches old and new items by key. With index keys, an insert at the top changes the item at every position, so every row is patched, and focus, input values, selection and running animations stay with the position. With id keys, the framework inserts, moves or removes only the affected nodes.
- Detect: `rg -n 'key=\{(i|idx|index)\}|:key="(i|idx|index)"|, (i|idx|index) \((i|idx|index)\)\}|track \$index' -g '*.{tsx,jsx,vue,svelte,html}'`
- Verify: measure.md#inp (or measure.md#fps for a live list) with an insert at the top of a long list. Pass: the trace-summary `Style:` element count and "Function call" time in the window go down, and a focused row keeps focus after the insert.
- Avoid: A key must be unique and stable across updates: not a random value, not an object that each response recreates, not a value that changes when a cell changes. If the data has no id, assign one once at ingest. Keyed moves still cost: when a list re-sorts on each update, move only the rows whose rank changed (DOM-10). A fixed-slot view whose rows change on almost every update and carry no per-row state (a top-N ranking, a live leaderboard) is cheaper with slots: rewrite the text in place (DOM-04) and move no nodes; key by id only when focus, selection or per-row animation must follow the item.
- Source: https://svelte.dev/docs/svelte/each ; https://react.dev/learn/rendering-lists

### DOM-04 Update high-rate rows in place: a fixed row set, changed cells only, Text node writes
stage: style, layout, memory · metric: frame, INP, CLS · when: render-loop, session · impact: high — rebuilding rows on each update restyles every row and creates garbage many times per second · support: baseline · also: DATA-06, DATA-08, CSS-08, DOM-12
- Do: For a live table, log tail or ranked list that updates many times per second, create the row elements and one Text node per cell once. In the per-frame flush (DATA-06), write `text.data = next` only when the formatted string changed. For newest-first lists, keep a fixed pool of fixed-height rows and rewrite their contents; do not insert rows above visible rows. Flash a change with an `opacity` animation on a cell overlay (a pseudo-element), not with a `background-color` animation.
- Why: Setting `textContent` replaces the children with a new Text node, and `innerHTML` also runs the HTML parser; writing `data` on an existing Text node changes it in place, and an unchanged string costs nothing. An insert above visible rows moves every row below it, and a shift that no input caused counts toward CLS. `opacity` animates in the compositor; a `background-color` animation repaints each frame unless it is one of the simple cases that Chromium composites (CSS-03).
- Detect: `rg -n '\.(innerHTML|textContent|innerText)\s*=' -g '*.{ts,js,svelte,vue,tsx}'` inside `onmessage`, subscription or rAF callbacks; `rg -n '\.(prepend|insertBefore)\(|afterbegin'` in live lists; `@keyframes` or `transition` on `background-color` for row flashes.
- Verify: measure.md#fps with `run_scenario` `stream` at peak rate, then measure.md#cls on the same stream. Pass: frame-interval p95 and long frames win, the `Style:` element count per frame and "Minor GC" time go down, and the stream adds no shift without input.
- Example:
  ```ts
  // Before: new nodes, and an HTML parse, for every cell on every update
  tr.innerHTML = `<td>${item.name}</td><td>${fmt.format(item.value)}</td>`;
  // After: one Text node per cell, created once
  function makeLiveRow(columns: number) {
    const tr = document.createElement('tr');
    const texts = Array.from({ length: columns }, () => tr.insertCell().appendChild(document.createTextNode('')));
    return { tr, texts };
  }
  function paintRow(row: { texts: Text[] }, values: string[]) {   // called from the per-frame flush
    values.forEach((s, i) => { if (row.texts[i].data !== s) row.texts[i].data = s; });
  }
  ```
- Avoid: A template binding that prints a value as text already updates one Text node: do not route values through raw-HTML bindings (`{@html}`, `v-html`, `dangerouslySetInnerHTML`). Reading `innerText` forces layout. `innerHTML` with feed data is also an injection risk. Give numeric cells fixed widths (DOM-12), so a new value cannot resize the column.
- Source: https://dom.spec.whatwg.org/#dom-node-textcontent ; https://web.dev/articles/cls

### DOM-05 Keep list rows flat: no wrapper components or wrapper elements per row
stage: js, style, memory · metric: INP, memory · when: load, interaction · impact: medium — each wrapper in a row is multiplied by the row count · support: n/a · also: DOM-01, DOM-02
- Do: Render each row of a long list as one component, or as plain elements, with the fewest elements that the layout needs. Inline small per-cell pieces (a badge, a formatted number) into the row, and use fragments instead of wrapper elements.
- Why: A component instance costs more than a plain element: creation time, memory and reactive bookkeeping. In a long list this cost is paid once per row, so one wrapper removed from the row template removes hundreds of instances.
- Detect: `rg -n -A3 '\{#each|\.map\(\(|v-for=' -g '*.{svelte,tsx,jsx,vue}'`, then count the component layers from the list item down to its elements; a row component that only wraps `children` or a `<slot>` is a candidate.
- Verify: measure.md#inp on the action that renders the list (first open or a filter change). Pass: the processing subpart wins, and `__wpProbe.memory.sample()` `domNodes` is lower for the same rows.
- Avoid: Do not flatten short lists or rarely rendered views; readability wins there. Keep a wrapper that is a containment boundary (`contain: content` on a row, CSS-08) or that carries table or ARIA semantics (`<tr>`, `role="row"`).
- Source: https://vuejs.org/guide/best-practices/performance.html ; https://web.dev/articles/dom-size-and-interactivity

## §C Building DOM

### DOM-06 Build large DOM in slices across tasks, and yield between slices
stage: tasks, style, layout · metric: INP, LCP · when: interaction, load · impact: high — a client-side build runs as one task, so nothing paints and no input runs until it ends · support: n/a · also: TASK-03, DOM-02, HTML-03
- Do: When code must insert many nodes at once (a first render of a large table, a large search result, a log backfill), insert the first screen first, then the rest in slices, and yield between slices with the TASK-03 helper. Size a slice so that its script, style and layout stay well under 50 ms. Prefer virtualization (DOM-02) for long lists, and server HTML for the first view (HTML-03).
- Why: The parser handles streamed server HTML in chunks and yields between them, but `innerHTML`, `append()` and a framework render run to the end in the current task. Style and layout for all inserted nodes then run before the next paint, so one big insert becomes one long task and one long frame.
- Detect: `rg -n -B3 '\.(append|appendChild|insertAdjacentHTML|replaceChildren)\(|\.innerHTML\s*=' -g '*.{ts,js}'` inside a loop over a whole data set with no yield; `innerHTML = items.map(…).join('')` on large arrays.
- Verify: measure.md#inp on the action that builds the DOM (measure.md#load for a startup build). Pass: `__wpProbe.loaf.read()` shows no frame over 50 ms from the build, and the first slice paints in the next frame.
- Example:
  ```ts
  async function appendInSlices(tbody: HTMLElement, items: Item[], signal: AbortSignal) {
    for (let i = 0; i < items.length; i += 200) {           // tune: script + style + layout well under 50 ms
      tbody.append(...items.slice(i, i + 200).map(makeRow));
      await yieldToMain();                                   // the TASK-03 helper
      if (signal.aborted) return;                            // a newer query replaced this build
    }
  }
  ```
- Avoid: Slices make the total time longer and show a partial list for a moment: put the visible rows in the first slice, and sort and filter the data, not the DOM. Abort a build that a newer query replaced. `requestIdleCallback` is wrong for visible content (TASK-07). A `DocumentFragment` does not split the work (DOM-07).
- Source: https://web.dev/articles/client-side-rendering-of-html-and-interactivity ; https://web.dev/articles/optimize-long-tasks

### DOM-07 Clone a parsed `<template>` for repeated structure; never parse HTML strings per update
stage: js, style · metric: INP, frame · when: interaction, render-loop · impact: medium — the HTML parser runs on each `innerHTML` write, and a fragment removes no style or layout work · support: baseline · also: DOM-04, EVT-07
- Do: Define the row structure once in a `<template>` (or build it once with `createElement`), create each row with `cloneNode(true)`, and fill its text. Insert many nodes with one `append(...nodes)` or `replaceChildren(...nodes)` call. Never write `innerHTML` in a per-message, per-frame or per-row path.
- Why: `innerHTML` runs the HTML parser on each write; a clone copies a tree that is already parsed. The browser does not render in the middle of a task, so many DOM writes in one task cost one style and layout pass. Batching comes from not reading layout between writes (EVT-07), not from `DocumentFragment`: MDN says its speed benefit is often overstated.
- Detect: `rg -n '\.innerHTML\s*\+?=|insertAdjacentHTML\(' -g '*.{ts,js,svelte,vue}'` in functions called per message, per frame or per row; `createDocumentFragment\(` added for speed in hot paths.
- Verify: measure.md#inp (a list render) or measure.md#fps (live updates). Pass: "Parse HTML" count and time in the window (trace-summary) drop to near zero, and the processing subpart or frame p95 wins.
- Example:
  ```ts
  // HTML, parsed once: <template id="row-tpl"><tr><td></td><td class="num"></td></tr></template>
  const tpl = (document.getElementById('row-tpl') as HTMLTemplateElement).content.firstElementChild!;
  function makeRow(item: Item) {
    const tr = tpl.cloneNode(true) as HTMLTableRowElement;
    tr.cells[0].textContent = item.name; tr.cells[1].textContent = fmt.format(item.value);
    return tr;
  }
  tbody.replaceChildren(...visibleItems.map(makeRow));   // one insert, one style and layout pass
  ```
- Avoid: `innerHTML`, `insertAdjacentHTML()` and `setHTMLUnsafe()` do not sanitize: never pass them data from a feed or a user; use text APIs. For one-time static markup, `innerHTML` is fine. A fragment is still a clean way to insert many nodes; it is only not the speed-up.
- Source: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/template ; https://developer.mozilla.org/en-US/docs/Web/API/DocumentFragment

### DOM-08 Keep hover and selection state apart from data and geometry state
stage: js, layout, paint · metric: frame, INP · when: interaction · impact: medium — when hover lives in the data state, each pointer move recomputes paths, rows or layout · support: n/a · also: CNV-07, EVT-03
- Do: Store hover and pointer state (hovered index, tooltip position, crosshair) in its own small store. Code that builds geometry (SVG paths, row lists, scales) must not read it. Draw the hover effect as one overlay moved with `transform` or `opacity`. In SVG charts, build `d` once after the enter animation, pan or zoom with `transform` on a `<g>`, and rebuild paths only when the data or the visible range changes.
- Why: A reactive framework re-runs everything that reads a changed value. If geometry reads the hover state, each pointer move rebuilds paths, restyles and repaints the whole chart or list. An isolated overlay changes one small element per frame.
- Detect: `rg -n '(hover|hovered|active)(Index|Id|Point|Row)' -g '*.{svelte,tsx,jsx,vue,ts}'`, then check whether the same component, memo or derived value also builds paths (`d=`, `line(`, `area(`) or list items.
- Verify: measure.md#fps with a hover sweep across the chart or list. Pass: trace-summary shows no "Layout" and fewer `Style:` elements per frame in the window, and frame p95 wins.
- Avoid: Chromium composites a `transform` animation on an SVG element only in plain cases: not for the `rotate`, `scale` or `translate` properties, not on an `<svg>` or `<use>` with its own `viewBox` or x/y, not with SMIL, and not when the subtree has `vector-effect`. A `transform` that script writes on each pan frame is a style change, not an animation: it repaints the group on the main thread, which is still cheaper than rebuilding `d`. Animate an HTML wrapper when you can, and check the Animations track. A scaled `<g>` also scales text and strokes: keep labels outside it; `vector-effect: non-scaling-stroke` keeps strokes thin, but it stops the group's animation from compositing.
- Source: https://github.com/bklit/bklit-ui/blob/main/.agents/skills/bklit-studio-chart-performance/SKILL.md ; https://developer.chrome.com/blog/hardware-accelerated-animations

## §D Native components

### DOM-09 Use `<dialog>`, `popover`, anchor positioning and `<details>` before a JS UI library
stage: script-load, layout · metric: bytes, INP, frame · when: load, interaction · impact: medium — positioning and modal libraries add bytes and read layout on each scroll and resize; native elements need no script · support: popover, invoker-commands, anchor-positioning, hidden-until-found, details-name · also: EVT-08, CSS-08
- Do: Build menus, dropdowns and tooltips with `popover` (buttons with `popovertarget` or `commandfor`), modals with `<dialog>` and `showModal()`, blocked regions with `inert`, and disclosure with `<details>` (`name` for exclusive groups) or `hidden="until-found"`. Place popups with CSS anchor positioning: name the anchor, always set `position-anchor`, use `anchor()` insets or `position-area`, and add `position-try-fallbacks`. Feature-detect only what support.md places above the Chromium floor.
- Why: The browser puts popovers and modal dialogs in the top layer and handles light dismiss, Esc and focus return, so no z-index or focus-trap code runs. It resolves anchor positions during layout and applies the default anchor's scroll offset after layout, so a popup follows scrolling with no script that reads `getBoundingClientRect()` and writes `top` and `left`. `hidden="until-found"` skips rendering of collapsed content, but find-in-page can still reveal it.
- Detect: `rg -n "from '(@floating-ui|@popperjs|tippy\.js|focus-trap|body-scroll-lock|micromodal|a11y-dialog)" -g '*.{ts,js,tsx,jsx,svelte,vue}'`; `rg -n -A6 "addEventListener\(\s*'(scroll|resize)'" | rg 'getBoundingClientRect|style\.(top|left)'`.
- Verify: measure.md#start for bytes, and measure.md#fps for a scroll with an open popup. Pass: first-route JS bytes go down, and trace-summary shows no "Forced by script" layout and no per-frame "Layout" from positioning code in the window.
- Example:
  ```html
  <button id="filter-btn" popovertarget="filter-menu">Filter</button>
  <div id="filter-menu" popover>…</div>
  <style>
    #filter-btn  { anchor-name: --filter; }
    #filter-menu { position-anchor: --filter; inset: auto; margin: 0;   /* drop the popover centering */
                   top: anchor(bottom); left: anchor(left);
                   position-try-fallbacks: flip-block, flip-inline; }  /* stay on screen */
  </style>
  ```
- Avoid: The initial value of `position-anchor` changed across Chromium releases (support.md), so set it explicitly. An anchor that moves by `transform`, such as a virtualized row, can make the popup lag by a few frames. Popover alone positions nothing. Many open top-layer elements still cost style and layout. A panel with paint containment clips popups that are not in the top layer (CSS-08).
- Source: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/popover ; https://drafts.csswg.org/css-anchor-position-1/

## One-line rules

- **DOM-10** Reorder rows that are already in the document with `moveBefore()`, and move only rows whose rank changed; it keeps running animations, focus and custom-element state (support.md: `move-before`; below the Chromium floor, use `insertBefore()`). [style, layout · INP, frame · medium] https://developer.mozilla.org/en-US/docs/Web/API/Element/moveBefore
- **DOM-11** Highlight search and filter matches with `CSS.highlights`, `StaticRange` and `::highlight()` instead of wrapping text in `<mark>` on each keystroke; rebuild the ranges after the text changes (support.md: `highlight`). [style, layout · INP · medium] https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API
- **DOM-12** In live tables, set `table-layout: fixed` with explicit table and column widths, and give numeric cells a fixed `inline-size` and `font-variant-numeric: tabular-nums`, so a new value cannot resize a column. [layout · frame, CLS · medium] https://developer.mozilla.org/en-US/docs/Web/CSS/table-layout
- **DOM-13** In infinite lists, start the next-page fetch from an IntersectionObserver sentinel with a large `rootMargin`, append below the visible rows into slots of the final row height, and put no footer under the list. [layout · CLS · medium] https://web.dev/articles/cls
- **DOM-14** In SVG charts, draw one `<path>` per series, decimated to about one vertex per pixel column; draw markers only for hovered or last points, and move dense series to a canvas (CNV-21). [style, layout, paint · frame, memory · medium] https://github.com/bklit/bklit-ui/blob/main/.agents/skills/bklit-studio-chart-performance/SKILL.md
- **DOM-15** Scope `querySelectorAll()` to a container, and do not keep large NodeLists or element arrays after use. [memory · memory · low] https://web.dev/articles/dom-size-and-interactivity
