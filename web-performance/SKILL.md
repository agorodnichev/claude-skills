---
name: web-performance
description: >-
  Performance rules for browser frontend code, applied while you write it. Use
  this skill before you write, change or review HTML, CSS, JS/TS, Svelte, React,
  Vue or other UI components, event handlers, animations, workers, canvas,
  WebGL/WebGPU shaders, or SciChart.js chart code, even when nobody says
  "performance": ordinary code (a pointermove handler, a layout read after a
  style write, a dataset replaced on every message, a missing teardown) causes
  most slowdowns. It routes the code you are writing to rules filed by layer
  (HTML loading, CSS, JS event loop and Web APIs, V8 hot paths, GPU) and tagged
  by rendering-pipeline stage, and it names the trade-offs. Also use it to write
  a performance review grouped by pipeline stage, and to measure a change with
  Chrome DevTools MCP (baseline trace, change, re-trace, compare) before you
  call it faster.
when_to_use: >-
  Examples: "add infinite scroll to the product list", "animate the sidebar",
  "stream 300 msgs/s into a chart", "render 1M points", "add a tooltip that
  follows the pointer", "port the heatmap renderer to WebGPU", "the dashboard
  janks when I scroll", "memory grows after a day", "review DataTable.vue for
  performance", "is it faster now?", "trace localhost:5173". Also on: slow, lag,
  jank, stutter, flicker, INP, LCP, CLS, FPS, leak, profile. Skip for backend or
  Node-only code, CLI scripts, database, CI and infra work, and for edits that
  change only text, types or names.
argument-hint: "[review|measure] [path or URL]"
---

# Web performance

Goal: fast, reliable web UIs. Rules are filed by layer and tagged by pipeline stage. Project rules (CLAUDE.md, AGENTS.md, the user's words) win over this skill.

The skill folder is `${CLAUDE_SKILL_DIR}`. In the reference files, `${CLAUDE_SKILL_DIR}` and `<skill>` mean this folder.

## Pick the mode

| The request | Mode | Output |
|---|---|---|
| Write or change frontend code | 1 Write | The code, then "Performance notes" |
| "review", "audit", "check before the PR", or `ARGUMENTS: review …` | 2 Review | A report from `references/review.md`. No code edits unless asked |
| "is it faster?", "profile", "trace", a URL, `ARGUMENTS: measure …`, or you are about to call a change faster | 3 Measure | A measured-result table from `references/measure.md` |
| "why is X slow?", "find the cause" | Diagnose | The cause and a proposed fix, with evidence labels. Read-only until the user decides |

## How to work

1. Explore first: the code you will change, its callers, and the installed library versions (`package.json`, the `.d.ts` typings in `node_modules`). Then apply this skill.
2. Find what you are writing in the router and open only those files: the checklist at the top, then only the rules you need (`grep -n '^### CSS-08 ' <file>`, about 20 lines).
3. Small, low-risk edits (text, spacing, colors, types, renames): apply the always-on rules, open nothing, write no notes.
4. Hot paths (per frame, per message, per point), render loops, live data, GPU code and long-lived views: open the files even when the edit is small.
5. These instructions stand for the whole session. If compaction dropped a reference, open it again.

## Router: what are you writing?

| You are writing or changing… | Code signals | Open |
|---|---|---|
| The HTML document, `<head>`, script/style/link tags, resource hints, bundle or route splitting, startup JS | `index.html`, `<script`, `<link rel=`, `fetchpriority`, `vite.config`, `import(` | `references/html-loading.md` |
| Images, icons, fonts, video, embeds, the largest above-the-fold element | `<img`, `<picture`, `srcset`, `@font-face`, `<video`, `<iframe` | `references/html-media-and-fonts.md` |
| CSS rules, layout, containment, transitions, animations, WAAPI, view transitions, scroll effects | `.css`, `<style>`, `transition`, `@keyframes`, `will-change`, `contain`, `.animate(` | `references/css-rendering.md` |
| Event handlers: pointer, wheel, touch, key, scroll, resize, drag, gestures | `addEventListener`, `onpointermove`, `onwheel`, `setPointerCapture`, `touch-action` | `references/js-events-and-input.md` |
| Work that can take over 50 ms (parse, math, sort, filter), yielding, timers, workers, Wasm | loops over 10k+ items, `setTimeout`, `setInterval`, `new Worker`, `postMessage`, `WebAssembly.` | `references/js-scheduling-and-workers.md` |
| DOM building, long lists and tables (virtualized grids, live tables, logs), dialogs, popovers | `{#each`, `.map(` to nodes, `innerHTML`, `createElement`, 100+ rows | `references/js-dom-and-lists.md` |
| Live data and network: WebSocket or SSE feeds, message handlers, `fetch()`, service worker | `WebSocket`, `EventSource`, `onmessage`, `fetch(`, `serviceWorker` | `references/js-live-data-and-network.md` |
| Mount/unmount, subscriptions, observers, caches, storage, hidden tabs, bfcache, reactive state with big or fast data | `onDestroy`, effect cleanup, `Map` caches, `localStorage`, `visibilitychange`, `pagehide`, `$state` | `references/js-lifecycle-and-memory.md` |
| Code that runs per message, per frame or per point: object models, numeric arrays, formatting, JSON, RegExp | arrays of `{ x, y }` objects, `toLocaleString`, `Intl.`, `JSON.`, `new RegExp` in loops | `references/v8-hot-code.md` |
| Your own canvas or render loop: size, DPR, Canvas 2D drawing and text, layers, OffscreenCanvas | `<canvas`, `getContext('2d')`, `requestAnimationFrame`, `devicePixelRatio`, `ResizeObserver` | `references/gpu-canvas-and-frames.md` |
| WebGL2 or WebGPU: buffers, shaders, textures, draws, readback, context loss | `gl.`, `WebGL2RenderingContext`, `GPUDevice`, `.wgsl`, `.glsl`, `#version 300 es` | `references/gpu-webgl-webgpu.md` |
| SciChart.js surfaces, data series, renderable series, annotations, modifiers | imports from `scichart`, `SciChartSurface`, `XyDataSeries`, `wasmContext` | `references/scichart.md` |
| A performance review | "review", "audit", a diff or a path | `references/review.md`, then the rows above |
| A measurement, "is it faster?", a trace, a profile | a URL, "trace", "profile", "measure", "benchmark" | `references/measure.md` |
| A pipeline stage, a DevTools event or insight name, "why does X cost" | "Recalculate style", "Layerize", LoAF, "presentation delay" | `references/pipeline.md` |
| Browser support, a deprecation, a version | "is X supported", "can I use", "deprecated" | `references/support.md` |

Common pairs:
- Chart with live data → `js-live-data-and-network` + `scichart` (+ `gpu-webgl-webgpu` for a custom renderable series)
- Drag interaction on a chart or canvas overlay → `js-events-and-input` + `scichart` (or `gpu-canvas-and-frames` for your own canvas)
- Text labels on a GPU chart → `gpu-canvas-and-frames` §D + `gpu-webgl-webgpu` §F
- Live table or list (metrics, logs, statuses) → `js-live-data-and-network` + `js-dom-and-lists` + `css-rendering` §C
- Heavy computation over long history → `js-scheduling-and-workers` + `v8-hot-code`

## Router: symptoms

For a symptom or metric part (LCP or INP subpart, CLS, stutter, memory, busy CPU): `references/pipeline.md` §G maps it to a stage, file and section. INP does not measure scroll, hover, pan or zoom. Those are frame-time problems: measure them with `measure.md#fps`.

## The pipeline on one screen

| # | Stage (tag) | What costs time | Rules mostly in |
|---|---|---|---|
| 1 | Network (`network`) | connections, bytes, priority, caching | html-loading, js-live-data-and-network |
| 2 | Parse and discovery (`parse`) | HTML parser, preload scanner, lazy loading | html-loading, html-media-and-fonts |
| 3 | Render-blocking CSS and fonts (`cssom`) | blocking stylesheets, `@import`, font swap | html-loading, html-media-and-fonts |
| 4 | Script load (`script-load`) | download, compile, evaluate startup JS | html-loading, scichart |
| 5 | Tasks and scheduling (`tasks`) | event loop, input handlers, timers, rAF, workers | js-events-and-input, js-scheduling-and-workers |
| 6 | JS execution (`js`) | hot-path JS in V8: shapes, arrays, allocation | v8-hot-code |
| 7 | Style (`style`) | selector matching, invalidation scope | css-rendering |
| 8 | Layout (`layout`) | layout, forced reflow, shifts, DOM size | css-rendering, js-events-and-input, js-dom-and-lists |
| 9 | Paint and raster (`paint`) | paint, raster, image decode, Canvas 2D drawing | css-rendering, gpu-canvas-and-frames |
| 10 | Composite (`composite`) | layers, compositor-only animation | css-rendering |
| 11 | GPU upload (`gpu-upload`) | buffers, textures, data types, text to texture | gpu-webgl-webgpu, gpu-canvas-and-frames, scichart |
| 12 | GPU draw (`gpu-draw`) | draw calls, state, passes, readback | gpu-webgl-webgpu, scichart |
| 13 | Memory and lifecycle (`memory`) | GC, leaks, teardown, hidden work | js-lifecycle-and-memory, scichart |

Stage cards (thread, blockers, trace events, budget, wrong beliefs): `references/pipeline.md` §H; insights → stage → file: §I; initial-load phases and the code that controls each: §B.

## Budgets and the chart contract

- Frame: 16.7 ms at 60 Hz, 8.3 ms at 120 Hz. Keep app script to about half of it. Read the real refresh rate from rAF deltas; do not assume 60 Hz.
- Task: 50 ms at most. Input: the visible response comes in the next frame.
- Field "good" at p75: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. Guides: FCP ≤ 1.8 s, TTFB ≤ 0.8 s.
- Lab, per scenario (report only at first): no long animation frame over 50 ms, max frame gap < 75 ms, non-input CLS per interaction < 0.02.
- Memory: after warm-up, growth per repeated action stays within noise; DOM nodes, canvases, contexts and chart surfaces return to baseline.
- Canvas memory = CSS width × CSS height × DPR² × 4 bytes × layers × instances. Default DPR cap: 2.
- Chart contract: before you build or change a chart feature, write 8 values in a comment or the plan: surfaces per view; series per surface; points per series (initial, maximum); update rate (normal, peak); visible window; DPR cap; degradation policy (what drops first); teardown owner. It sets the test scale and the measurement scenario.

## Always-on rules

Apply these to every edit, even when no reference is open.
1. Feedback first: an input handler makes the visible change for the next frame, then yields (EVT-01).
2. One visual update per frame: coalesce pointer, wheel and data messages; the latest value wins (EVT-03, DATA-06).
3. Read layout, then write styles. Never read layout after a style write in the same task; cache geometry from ResizeObserver (EVT-07, EVT-08).
4. Size the work before you place it: under 50 ms, run it inline; 50–250 ms, slice it and yield on a 50 ms deadline; over 250 ms, use a worker (TASK-02).
5. Render on demand: every loop has a stop condition, and it stops when nothing changed, when the tab is hidden, or when the panel is off-screen (CNV-02, CNV-20).
6. Per frame or per message: no allocations kept across frames, no GPU object creation, no shader compiles, no synchronous readback (V8-07, GPU-05, GPU-27).
7. Keep high-rate values (pointer position, latest value, scroll offset) out of reactive framework state (DATA-08).
8. Every listener, timer, observer, subscription, socket, chart and GPU resource has one owner that tears it down (LIFE-01).
9. A happy path alone is not done: add the error and teardown paths, and test at the chart-contract scale, not with 10 points.
10. Use the platform before a new dependency; stay in the existing stack. Check `references/support.md` before a newer feature.

## Default habits to replace

| Default habit | Replace with | Rule |
|---|---|---|
| `pointermove` reads `getBoundingClientRect()` or `offsetX` and writes `style.left/top` | Rect cached from ResizeObserver and scroll; one `transform` write in rAF | EVT-08 |
| `debounce(100)` on scroll or resize for a visual update | Passive listener + rAF; `scrollend`; ResizeObserver | EVT-11 |
| `setTimeout(…, 300)` to wait for an animation | `animation.finished`, `transitionend` | CSS-16 |
| Animating `top`, `left`, `width`, `height`, blur or shadow | `transform` and `opacity`; FLIP; fade a pre-painted layer | CSS-01, CSS-02 |
| `will-change` or `translateZ(0)` in base CSS | Add it just before the motion, remove it after | CSS-05 |
| `toLocaleString()` or `new Intl.NumberFormat()` per message | One cached formatter per locale and options | V8-09 |
| Arrays of `{ x, y, … }` objects for 1M points | Typed-array columns (`Float64Array`) | V8-04 |
| `await Promise.resolve()` or `queueMicrotask` as a "yield"; `await` per item | `scheduler.yield()` on a 50 ms deadline, through one helper | TASK-03, TASK-04 |
| `requestIdleCallback` for input work; `isInputPending()` | Feedback, then yield; rIC only for deferrable work, with a timeout | TASK-07 |
| `setInterval` polling; timers that drive visuals | Events, observers, push; rAF for visuals | TASK-09 |
| `series.append` per message; the dataset replaced on every message | Buffer, one `appendRange` per frame; update the still-open last point in place | SC-02, SC-04 |
| A chart created in a reactive block that runs again | Create once per mount; `delete()` once in cleanup | SC-28 |
| Unix-ms timestamps in a `Float32Array` or a float uniform | Subtract a float64 origin first | GPU-14 |
| A new canvas or texture per label per frame | Rasterize only when the string changes; atlas with dirty sub-rectangles | GPU-24 |
| `loading="lazy"` on the hero image; preload everything | `fetchpriority="high"` on the LCP image; preload only late-discovered resources | MEDIA-02, HTML-12 |
| A new library for a dialog, tooltip, menu or positioning | `<dialog>`, `popover`, anchor positioning (check `support.md`) | DOM-09 |
| FID, TTI, `performance.memory` or a Lighthouse score as the target | INP, LCP, CLS, frame p95, memory slope; traces and insights | `measure.md` |
| "It is GPU-accelerated, so it is smooth" | "Hypothesis; verify with measure.md#fps" | Honesty rules |

## Mode 1: performance notes

After code on a hot path, load path, render loop or lifecycle, add at most 4 bullets that name non-default choices: "<Stage> (<rule>): <choice>. Cost: <trade-off>." End with "Not measured" and the recipe unless you measured. Skip it for trivial edits.

Performance notes
- Tasks (EVT-03): pointer moves are coalesced into one rAF. Cost: the tooltip can trail the pointer by one frame.
- Layout (EVT-08): the pane rect comes from ResizeObserver and scroll. Cost: refresh it if the pane moves without a resize.
- GPU upload (GPU-24): the label texture is rebuilt only when its text changes. Cost: one atlas page of GPU memory.
- Not measured. Verify: measure.md#fps, drag scenario.

## Mode 2: review

1. Scope the files or the diff. Read them and the installed library versions.
2. Route each region with the router. Read those checklists. Run their Detect patterns over the scope (`grep -E '^### [A-Z0-9]+-[0-9]{2} |^- Detect:' <files>`), then confirm each match by reading the code.
3. Also check what is missing: teardown, error path, test scale, hidden-tab behavior, degradation policy, chart contract.
4. Keep at most 10 findings, strongest first. Prefer silence to nitpicks. If the code is already fast, say so.
5. Group findings by pipeline stage, label the evidence (M, S, H), and give a fix and a Verify line for each. Template: `references/review.md`.

## Mode 3: measure

Define the scenario, metric and pass condition → baseline, 5 runs on unchanged code (use a separate git worktree when the change already exists; never stash or reset the user's changes) → one change → the same 5 runs → `node ${CLAUDE_SKILL_DIR}/scripts/compare-runs.mjs base.json after.json` → keep a win; revert a neutral or regressed change → one ledger row.
Record the Chrome version, GPU renderer, DPR, profile and build. Save traces and heap snapshots to files; never read them raw into the context. Steps, recipes and the kit: `references/measure.md`. Copy `assets/perf-hooks.dev.ts` into a project only with the user's approval.

## Honesty rules

1. A finding from reading code is a hypothesis. Label it "not measured" and name the recipe that would verify it.
2. Write "faster", "smooth", "60 fps", "no jank" or "GPU-accelerated" only with a recorded measurement. State the device, profile, build and run count with every number.
3. Change one thing per measurement. A change that does not beat run-to-run noise is neutral: revert it, or keep it for a stated non-performance reason.
4. Correctness gates the metric. A win that needed a test changed or deleted is a regression.
5. Lab data does not prove field INP. Claim a field improvement only after new field data arrives.
6. When the checks show no problem, say that the code is already fast. Do not invent work.

## Browser support, versions and library facts

- Target: Chromium (Chrome, Edge) at or above the floor in `references/support.md`; no fallbacks for other engines unless the project's policy asks.
- Never state a browser version, support status, API shape, MCP flag or library version from memory. Grep the key's row in `references/support.md`, follow its "At the floor" column (use, detect, gated, engine, not shipped), and quote its checked date. Past "Stale after" or no row: re-check on api.webstatus.dev or MDN (ask before you browse), update the row, and say so.
- Library facts come from the installed package: an API missing from its typings does not exist.

## Reading the references

- A rule is an ID and title, one tag line (stage · metric · when · impact · support · also), then Do, Why, Detect, Verify, Example, Avoid, Source.
- `→ ID` in a checklist means that the rule lives in another file.
- Rules by stage: `grep -n -B1 '^stage: [^·]*\blayout\b' ${CLAUDE_SKILL_DIR}/references/*.md`. Rules by category: the file prefix (`html-`, `css-`, `js-`, `v8-`, `gpu-`).

## Scope

- Not for backend, CI or infra code.
- Add no dependencies and migrate no libraries for performance unless the user asks.
- Correctness first. Performance is a pass after correctness.
