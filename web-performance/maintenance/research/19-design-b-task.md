# Design B: a task-first `web-performance` skill

- Date: 2026-09-22
- Angle: **B, coding task first.** Claude opens the file for the code it is writing now. Pipeline stage, metric and browser support are tags on each rule.
- Target: `~/.claude/skills/web-performance/` (user level, all projects).
- Inputs read: `18-skills-survey-github.md` and `18-skills-survey-web.md` (in full); the headings of every notes file; item bodies in `01`, `10`, `08` (§8); `verify/01-critical-rendering-path.verify.md`; the raw Claude Code skills doc copy (`raw/18-skills-survey-web/claude-code-skills-doc.md`); the raw DevTools MCP tool reference (`raw/cdmcp-tools.md`); the raw WebMCP pages; the raw SciChart typings (`raw/scichart/*.d.ts`).
- Notes still in progress are planned for in §5 ("Feeds") and §9.

## 0. Summary

1. **Primary axis = what Claude is writing.** There are 13 task references. Examples: "an event handler", "a live data feed", "WebGL or WebGPU code", "a SciChart series". Claude sees these things in the file it edits, so it can pick the file in one step. Each task file starts with a one-line checklist of its rules. The checklist is also the file's table of contents.
2. **The stage axis stays for reviews.** Every rule has a grep-able tag line: `stage: … | metric: … | impact: … | support: …`. The review template (output mode 2) groups findings by stage. `pipeline.md` holds the phase map from first HTML bytes to pixels. It uses the same stage words.
3. **Each rule has one owner.** A rule lives in the task file where the bad code gets typed. Other task files point to it by ID. The ~700 note items become about 260 rules: about 164 full rules and 98 one-line rules.
4. **Three trigger layers for write time:** a "pushy" description that starts with the writing task, a `when_to_use` that lists file types and APIs, and an optional path-scoped user rule that loads a 4-line pointer when Claude reads a frontend file. The skill does not use `paths:` in its own frontmatter, because that field can only narrow auto-loading.
5. **Honesty and freshness are structural.** A static finding is a hypothesis until `measure.md` produces numbers. All browser versions and deprecations live in one dated file, `support.md`. Rules never contain version numbers.

---

## 1. Classification axis

### 1.1 Primary axis: the coding task

A task is a kind of code that Claude writes or changes in one edit. The test for a good task boundary: when Claude looks at the file it is about to edit, can it name the task without reading a reference? The router in SKILL.md lists **code signals** for each task. Examples: `addEventListener('pointermove'`, `new XyDataSeries(`, `gl.bufferSubData`, `<link rel=`.

| # | Task (reference file) | Claude is writing… | Main stages (tags) |
|---|---|---|---|
| 1 | `page-shell.md` | the HTML document, `<head>`, script/style/link tags, bundle and route splitting, startup JS | network, parse, script |
| 2 | `network-and-caching.md` | `fetch()` calls, HTTP and cache headers, service worker, navigation (bfcache, speculation rules) | network |
| 3 | `images-fonts-media.md` | images, icons, fonts, video, the largest above-the-fold element | network, layout, composite |
| 4 | `styles-and-animation.md` | CSS rules, layout, containment, transitions, WAAPI, view transitions, scroll effects | style, layout, paint, composite |
| 5 | `dom-and-lists.md` | DOM building, long lists and tables (watchlist, order book, blotter), dialogs and popovers | script, style, layout |
| 6 | `events-and-input.md` | pointer, wheel, touch, key, scroll and resize handlers, drag and gestures | script, layout |
| 7 | `long-tasks-and-workers.md` | work that can take more than 50 ms, yielding, scheduling, workers, Wasm | script |
| 8 | `hot-code-v8.md` | code that runs per tick, per frame or per point: object models, numeric arrays, formatting, parsing | script, memory |
| 9 | `realtime-data.md` | WebSocket or SSE feeds, tick handlers, polling, flow of data from the feed to the UI | network, script, memory |
| 10 | `canvas-and-frames.md` | a canvas or a render loop: sizing, DPR, layers, Canvas2D, OffscreenCanvas, pausing | script, paint, gpu-draw |
| 11 | `gpu-webgl-webgpu.md` | WebGL2 or WebGPU code: buffers, shaders, textures, draws, readback, context loss | gpu-upload, gpu-draw |
| 12 | `scichart.md` | SciChart.js v5 surfaces, data series, renderable series, annotations, modifiers | script, gpu-draw, memory |
| 13 | `long-lived-sessions.md` | teardown, caches, timers, observers, storage, hidden tabs, leak checks in apps that stay open for hours | memory |

**Why task first (and not stage first or metric first):**

- **Write-time match.** When Claude writes code, it knows the artifact (a handler, a shader, a series update). It does not yet know the symptom. It also does not know the stage, because one handler touches script, style, layout and paint. A stage-first design needs a translation step ("pointer handler → which stages?") and then 3–4 files. A task-first design needs one lookup.
- **Small loads.** A typical edit opens 1 task file (180–320 lines). A chart feature with live data opens 2–3 files. The router lists these common pairs.
- **It follows the user's work.** Most of the user's work is trading charts, drawing tools, panels and live feeds. These tasks get their own files (`realtime-data`, `canvas-and-frames`, `gpu-webgl-webgpu`, `scichart`). They do not get a thin slice of a generic "JS" file.
- **Evidence from the surveys.** The skills that fire at write time are organized by what the developer does. Examples: Chrome Modern Web Guidance (guides "classified by developer task"), Vercel react-best-practices (index plus rule files, fires "when writing, reviewing or refactoring"), and the OpenAI canvas skill (renderer choice, then subsystems). The popular audit skills (Addy CWV by metric, Cloudflare by audit phase) use audit phrases as triggers, and "they will not fire while Claude writes a new component" (18-github).

**Costs of this axis (we accept them; §11 lists the mitigations):** some rules cut across tasks (layout reads after writes, rAF coalescing, teardown). The review mode needs stage grouping. The user's own categories are not the top-level folders.

### 1.2 Secondary tags (facets on every rule)

| Tag | Values | Used for |
|---|---|---|
| `stage` | `network`, `parse` (html-parse, preload-scan, cssom), `script` (script-compile, script-run, main-thread-task, microtask, idle), `style`, `layout`, `paint`, `composite` (composite, raster, decode), `gpu-upload`, `gpu-draw`, `memory` (gc-memory) | Review grouping (mode 2), `pipeline.md` index. The 17 note stage tags collapse to these 10. |
| `metric` | `LCP`, `INP`, `CLS`, `FCP`, `TTFB`, `frame` (FPS, smoothness), `memory`, `bytes`, `startup` | Choosing what to measure (mode 3) |
| `impact` | `high`, `medium`, `low` (defined in §6) | Ordering checklists and review findings |
| `support` | a key into `support.md`, or `baseline` for Baseline Widely available | Feature detection and fallbacks |
| `layer` | `html`, `css`, `js`, `gpu`, `network`, `build` | Only for the user's category map below; not shown in rule bodies |

The tag line is plain text on its own line, so this command finds every layout rule: `grep -n '^stage: .*layout' ${CLAUDE_SKILL_DIR}/references/*.md`. Because the index is a live grep, it cannot go stale.

### 1.3 The user's categories and where they live

The user asked to classify the knowledge into their own categories. In this design, those categories become cross-cutting views. The table shows where each one lives.

| User category | Where it lives | How Claude reaches it |
|---|---|---|
| Critical rendering path phases (first HTML bytes to paint) and the code that affects each | `pipeline.md` (phase map: initial load, then the update frame after load; threads; DevTools event names; stage → rule IDs) | Router row "a stage, metric or DevTools name"; the review mode |
| HTML directives that load early or lazily | `page-shell.md` §D "Discovery and priority", `images-fonts-media.md` §A–B, `network-and-caching.md` §D | `layer: html` rules; router by code signal (`<link rel=`, `loading=`, `fetchpriority`) |
| CSS (GPU, layers, `will-change`, `contain`, …) | `styles-and-animation.md` §A–E | Router by `.css`, `transition`, `will-change` |
| JS (event loop, micro/macrotasks, rAF, rIC, Web APIs) | `events-and-input.md`, `long-tasks-and-workers.md`, `canvas-and-frames.md` §A (rAF), `realtime-data.md`, `long-lived-sessions.md`; the event-loop model is in `pipeline.md` §B | Router by API names |
| Micro-optimizations (V8 blog) | `hot-code-v8.md` | Router by "per tick / per frame / per point" |
| GPU (WebGL/WebGPU textures, shaders, data types) | `gpu-webgl-webgpu.md`, `scichart.md` | Router by `gl.`, `GPUDevice`, `.wgsl`, `scichart` |
| Chrome DevTools MCP and WebMCP for performance testing | `measure.md`, `scripts/` | Output mode 3 |

---

## 2. Directory tree

```text
~/.claude/skills/web-performance/
├── SKILL.md                          250  Router, budgets, always-on rules, default habits to replace, the 3 output modes
├── MAINTAINING.md                     80  How to add or merge a rule, the ID registry, how to refresh support.md (the router never loads it)
├── references/
│   ├── page-shell.md                 300  TASK: document, head, scripts, CSS delivery, hints, priorities, bundles, startup JS
│   ├── network-and-caching.md        220  TASK: fetch() calls, HTTP caching and compression, service worker, bfcache, speculation rules
│   ├── images-fonts-media.md         200  TASK: LCP element, images, fonts, video, embeds, reserved space
│   ├── styles-and-animation.md       340  TASK: compositor-only motion, layers, containment, style scope, paint cost, WAAPI, reduced motion
│   ├── dom-and-lists.md              180  TASK: DOM size, virtualized lists and tables, chunked builds, native dialog and popover
│   ├── events-and-input.md           260  TASK: INP phases, high-rate input, layout reads, listener options, cancel, listener lifetime
│   ├── long-tasks-and-workers.md     260  TASK: size the work, yield, priorities, workers, transfer, Wasm, timers
│   ├── hot-code-v8.md                180  TASK: object shapes, arrays and typed arrays, allocation, builtins, async; myths not to apply
│   ├── realtime-data.md              200  TASK: feed contract, ingest, store, deliver once per frame, lifecycle, degradation policy
│   ├── canvas-and-frames.md          260  TASK: frame loop, canvas size and DPR, layers by change rate, Canvas2D, OffscreenCanvas, pausing
│   ├── gpu-webgl-webgpu.md           480  TASK: both APIs, one rule with "WebGL:" and "WebGPU:" lines; the WebGL → WebGPU table
│   ├── scichart.md                   320  TASK: SciChart.js v5 chart contract, surfaces, data series, batching, lifecycle, measuring
│   ├── long-lived-sessions.md        240  TASK: ownership and teardown, bounded growth, hidden tabs, storage, leak proof
│   ├── pipeline.md                   200  VIEW: CRP phase map, update frame, stage words, DevTools names, layout-forcing APIs, metric → stage
│   ├── review.md                     130  MODE 2: review procedure, evidence levels, report template
│   ├── measure.md                    240  MODE 3: DevTools MCP workflow, scenarios, frames, memory, WebMCP hooks, compare table
│   └── support.md                    220  FACTS: dated browser support, Chromium-only extras, deprecations, tool and library versions
├── scripts/
│   ├── frame-stats.js                 50  evaluate_script body: rAF frame-time percentiles and frame gaps during a scenario
│   ├── interaction-loaf.js            40  evaluate_script body: long-animation-frame entries, top scripts, forced style and layout time
│   └── memory-sample.js               35  evaluate_script body: DOM nodes, canvases, measureUserAgentSpecificMemory when isolated
└── evals/
    └── evals.json                    120  skill-creator evals: the 4 prompts in §10 plus should-not-trigger prompts
```

Total: about 4,800 lines. A typical load is SKILL.md plus one or two task files (500–800 lines).

**Outside the skill (optional; confirm before you install):** `~/.claude/rules/web-performance.md`, 8 lines. It is a path-scoped rule that loads when Claude reads a frontend file, and it contains only a pointer to the skill (text in §3.2). The Claude Code docs describe path-specific rules for `.claude/rules/`. Check that the user-level `~/.claude/rules/` folder is supported in the installed Claude Code version. If it is not, put the same 2 lines in `~/.claude/CLAUDE.md`.

---

## 3. Frontmatter

### 3.1 SKILL.md frontmatter (exact text)

```yaml
---
name: web-performance
description: >-
  Performance rules for writing and reviewing browser frontend code: HTML, CSS, JS/TS,
  Svelte and other components, event handlers, workers, canvas, WebGL/WebGPU, and
  SciChart.js charts with live data. Load it BEFORE you write or change such code, even
  when the user does not mention speed: it routes the kind of code you are writing (page
  shell, images and fonts, styles and animation, DOM and lists, input handlers, long
  tasks, hot loops, live feeds, canvas and GPU rendering, SciChart, long-lived sessions)
  to the rules to apply and the trade-offs to name. Also use it to review code for
  performance (findings grouped by rendering-pipeline stage) and to measure a change with
  Chrome DevTools MCP traces before you say it is faster.
when_to_use: >-
  Use when creating or editing .html, .css, .ts, .js, .svelte, .tsx, .glsl or .wgsl code
  that runs in a browser; when adding a listener, requestAnimationFrame loop, animation,
  worker, WebSocket or SSE handler, canvas, shader, or a SciChart surface, series or
  annotation; and on words such as slow, lag, jank, stutter, freeze, INP, LCP, CLS, FPS,
  memory leak, trace, profile, "is it faster". Not for backend-only code, Node CLI
  scripts, CI or infra config, or text-only edits.
argument-hint: "[review|measure] [path or URL]"
---
```

- Length: `description` 732 characters and `when_to_use` 473 characters, 1,205 in total. The cap is 1,536 (Claude Code skills doc: "the combined `description` and `when_to_use` text is truncated at 1,536 characters"). The key use case comes first, so a cut in an over-full listing removes the least important words.
- **Why the description is "pushy":** Vercel measured that with default triggering, the skill "was never invoked in 56% of cases" (18-web, Vercel blog 2026-01-27). "Even when the user does not mention speed" is the skill-creator style of push for under-triggering skills.
- **Why no `paths:`:** the docs say `paths` "limit when this skill is activated … Claude loads the skill automatically only when working with files matching the patterns". It can only narrow triggering. Output modes 2 and 3 often start before Claude reads a file ("trace localhost:5173"), and a `paths:` field would block them. Precision comes from `when_to_use` ("Not for …") instead.
- **Why no `allowed-tools`:** a model-invoked skill must not pre-approve `navigate_page` or `evaluate_script`. Measurement stays under the user's normal permission flow.
- **Why `argument-hint`:** `/web-performance review src/chart` and `/web-performance measure http://localhost:5173` select mode 2 or mode 3 directly. SKILL.md reads `$ARGUMENTS`.

### 3.2 Optional companion rule (`~/.claude/rules/web-performance.md`)

```markdown
---
paths:
  - "**/*.{html,css,scss,ts,tsx,js,jsx,mjs,svelte,vue,glsl,wgsl}"
---
Before you write or change browser code in this file, load the `web-performance` skill if it is not loaded yet. Then open only the reference for the kind of code you are writing. Skip this for Node-only scripts, tests and config files.
```

This is the third trigger layer from 18-web lesson 1. It fires at the exact write-time moment. It costs 4 lines of context only in sessions that touch frontend files. It holds no rules, so the skill stays the one source of truth.

---

## 4. SKILL.md outline

Budget: at most 260 lines, about 3,800 tokens. **Why this size:** after auto-compaction, Claude Code "re-attaches the most recent invocation of each skill after the summary, keeping the first 5,000 tokens of each" (skills doc). A SKILL.md under 5,000 tokens survives compaction whole. The most important content goes first in case it is cut.

| # | Heading | Contents | Lines |
|---|---|---|---|
| 1 | `# Web performance` | 3 lines: the goal (a reliable, fast, trustworthy trading UI); the 3 output modes; "project rules (CLAUDE.md, AGENTS.md) win over this skill". | 5 |
| 2 | `## How to use this skill` | The write-time loop: (1) read the code you will change and the installed library versions and typings first; (2) find your task(s) in the router and open only those files; read the checklist, then only the rule bodies that apply; (3) write the code; (4) add the "Performance notes" block (§4.4); (5) say "faster" only after `measure.md`. If `$ARGUMENTS` starts with `review`, go to `review.md`; with `measure`, go to `measure.md`. For small, low-risk edits (copy, spacing, colors), apply the always-on rules and open nothing. | 16 |
| 3 | `## Router: what are you writing?` | The task table (§4.1) and the common pairs for trading UIs. | 36 |
| 4 | `## Router: symptoms` | Symptom → first stage → files (§4.1, second table). Used by modes 2 and 3. | 12 |
| 5 | `## Budgets` | Frame: 16.7 ms at 60 Hz, 8.3 ms at 120 Hz, keep your script to about half of it. Task: at most 50 ms. Input: visible response in the next frame. Field targets at p75: INP ≤ 200 ms, LCP ≤ 2.5 s, CLS ≤ 0.1. Memory: flat after warm-up; less than 10 MB growth per hour of use (Mapbox target, 18-web). Why each number matters: 1 line. | 12 |
| 6 | `## Always-on rules` | 13 one-line rules with IDs (§4.2). These apply to every edit, even when no reference is open. | 30 |
| 7 | `## Default habits to replace` | Table: the habit → the replacement → the rule ID (§4.3). This names the mistakes agents make by default (18-web lesson 8). | 26 |
| 8 | `## Output mode 1: performance notes` | The notes block format with one example (§4.4). When to leave it out. | 16 |
| 9 | `## Output mode 2: review` | 6 lines: open `review.md`; group findings by stage; label evidence (measured, static, hypothesis); report fewer and stronger findings; no nitpicks. | 8 |
| 10 | `## Output mode 3: measure` | 10 lines: baseline trace, one change, the same trace again, compare medians and spread, revert a neutral change; open `measure.md`; save traces to files and never paste raw traces. | 12 |
| 11 | `## Reading a rule` | The tag line and the field names (Do, Why, Detect, Verify, Example, Caveat, Source); the checklist is the table of contents; `→ ID` means the rule lives in another file; the grep command to collect rules by stage. | 10 |
| 12 | `## Browser support and deprecations` | "Rules have no version numbers. Look them up in `support.md` (checked 2026-09-22). Baseline Widely available: use freely. Newly available: use it and name the fallback. Limited: feature-detect and ship the fallback. If the check date is more than 180 days old, verify on webstatus.dev before you quote a version." | 8 |
| 13 | `## Scope and boundaries` | Not for backend or CI. Do not migrate libraries or add dependencies unless the user asks (ibelick's tool boundary). Correctness first: a speed change that breaks a test is a regression. | 8 |
| | Total | | about 200 plus headings and blank lines, 250 at most |

### 4.1 The routing tables (exact text for SKILL.md)

```markdown
## Router: what are you writing?

Open only the rows that match the code you are about to write. Start with the file's checklist.

| You are writing or changing… | Code signals | Open |
|---|---|---|
| The HTML document, `<head>`, script/style/link tags, bundle or route splitting, startup JS | `index.html`, `app.html`, `<script`, `<link rel=`, `vite.config`, `import(` | `references/page-shell.md` |
| `fetch()` calls, HTTP or cache headers, service worker, back/forward cache, speculation rules | `fetch(`, `Cache-Control`, `sw.js`, `serviceWorker`, `pagehide`, `speculationrules` | `references/network-and-caching.md` |
| Images, icons, fonts, video, embeds, the largest above-the-fold element | `<img`, `<picture`, `srcset`, `@font-face`, `<video`, `<iframe`, inline SVG | `references/images-fonts-media.md` |
| CSS rules, layout, containment, transitions, animations, WAAPI, view transitions, scroll effects | `.css`, `<style>`, `transition`, `@keyframes`, `will-change`, `.animate(`, `contain` | `references/styles-and-animation.md` |
| DOM building, long lists and tables (watchlist, order book, blotter), dialogs, popovers, keyed updates | `{#each`, `.map(` to nodes, `innerHTML`, `createElement`, more than 100 rows | `references/dom-and-lists.md` |
| Event handlers: pointer, wheel, touch, key, scroll, resize, drag, gestures | `addEventListener`, `onpointermove`, `onwheel`, `setPointerCapture`, `touch-action` | `references/events-and-input.md` |
| Work that can take more than 50 ms (parse, indicator math, sort, filter, serialize), workers, Wasm | loops over 10k+ items, `new Worker`, `postMessage`, `await` inside loops | `references/long-tasks-and-workers.md` |
| Code that runs per tick, per frame or per point: object models, numeric arrays, formatting, JSON, RegExp | arrays of objects, `class Candle`, `toLocaleString`, `JSON.`, `new RegExp` in loops | `references/hot-code-v8.md` |
| Live data: WebSocket or SSE feeds, tick handlers, polling, updates from the feed to the UI | `WebSocket`, `EventSource`, `onmessage`, `setInterval` polling | `references/realtime-data.md` |
| A canvas or a render loop: size, DPR, layers, Canvas2D drawing, OffscreenCanvas, pausing | `<canvas`, `getContext(`, `requestAnimationFrame`, `devicePixelRatio`, `ResizeObserver` | `references/canvas-and-frames.md` |
| WebGL2 or WebGPU: buffers, shaders, textures, draw calls, readback, context loss | `gl.`, `WebGL2RenderingContext`, `GPUDevice`, `.wgsl`, `.glsl`, `#version 300 es` | `references/gpu-webgl-webgpu.md` |
| SciChart.js surfaces, data series, renderable series, annotations, modifiers, themes | imports from `scichart`, `SciChartSurface`, `XyDataSeries`, `wasmContext` | `references/scichart.md` |
| Lifetime in an app that stays open for hours: teardown, caches, timers, observers, storage, hidden tabs | `onDestroy`, effect cleanup, `setInterval`, `Map` caches, `localStorage`, `visibilitychange` | `references/long-lived-sessions.md` |
| A performance review | "review", "audit", a diff or a path | `references/review.md`, then the task files |
| A measurement or "is it faster?" | a URL, "trace", "profile", "measure", "benchmark" | `references/measure.md` |
| A pipeline stage, a metric or a DevTools event name you must explain | "Recalculate style", "Layerize", LoAF, "presentation delay" | `references/pipeline.md` |
| Browser support, a deprecation, a version | "is X supported", "can I use", "deprecated" | `references/support.md` |

Common pairs in trading UIs:
- Chart feature with live data → `realtime-data` + `scichart` (+ `gpu-webgl-webgpu` for a custom renderable series)
- Drawing tool or annotation with drag → `events-and-input` + `scichart` (or `canvas-and-frames` for your own canvas)
- Order book, watchlist, blotter → `realtime-data` + `dom-and-lists` (+ `styles-and-animation` §C for containment)
- Indicator over long history → `long-tasks-and-workers` + `hot-code-v8`

## Router: symptoms

| Symptom | Check this stage first | Open |
|---|---|---|
| First load is slow or blank | network, parse | `page-shell`, `images-fonts-media`, `measure` |
| A click or key press feels slow (INP) | script: input delay, processing, presentation delay | `events-and-input`, `long-tasks-and-workers` |
| Pan, zoom or streaming stutters | script, gpu-draw, layout | `canvas-and-frames`, `gpu-webgl-webgpu`, `scichart` |
| Content jumps (CLS) | layout | `images-fonts-media` §E, `dom-and-lists` |
| Memory grows over hours, the tab crashes | memory | `long-lived-sessions`, `scichart` §G |
| Fans spin or CPU is busy while the app is idle | script (idle loops), gpu-draw | `canvas-and-frames` §A, `long-lived-sessions` §C |
```

### 4.2 Always-on rules (exact text for SKILL.md; the IDs are provisional)

```markdown
## Always-on rules

Apply these to every edit. Each ID links to the full rule.

1. **Feedback first.** An input handler makes the visible change for the next frame, then yields; everything else runs after (EVT-01).
2. **One visual update per frame.** Coalesce high-rate input and data into one `requestAnimationFrame` write; the latest value wins (EVT-06, RT-07).
3. **No layout read after a style write in the same task.** Cache geometry from `ResizeObserver`; never read `getBoundingClientRect()` or `offsetX` per pointer event (EVT-09).
4. **Animate `transform` and `opacity` only.** Add `will-change` just before the motion and remove it after (STY-01, STY-06).
5. **Render on demand.** A render loop has a stop condition; it stops when nothing changes, when the tab is hidden, or when the panel is off-screen (CNV-02, LLS-09).
6. **No allocation and no GPU object creation per frame or per tick in hot paths.** Preallocate and reuse typed arrays and GPU buffers (HOT-06, GPU-08).
7. **Size the work before you place it.** Less than 50 ms: run it. 50–250 ms: yield about every 50 ms. More than 250 ms: use a worker (TASK-01).
8. **Every listener, timer, observer, subscription, chart and GPU resource has one owner that tears it down**, through one `AbortSignal` or an explicit `delete()` / `destroy()` (LLS-01).
9. **Keep high-rate values (pointer position, ticks, scroll offset) out of reactive framework state.** Write them to plain variables and flush once per frame (RT-09).
10. **Test at production scale**: 100k+ points, full order-book depth, all panes open. Do not test with 10 items (Mapbox's "happy path only" agent anti-pattern) (LLS-02).
11. **Prefer the platform over a new dependency.** Feature-detect anything that is not Baseline Widely available (see `support.md`).
12. **Explain the cost.** For each non-default performance choice, name what it costs (memory, complexity, latency) in the notes block.
13. **Be honest about metrics.** Reasoning from code gives a hypothesis. Say "faster", "60 fps" or "no jank" only with numbers from `measure.md`.
```

### 4.3 Default habits to replace (table in SKILL.md, 18 rows; the IDs are provisional)

| Default habit | Replace with | Rule |
|---|---|---|
| `pointermove` handler that reads `getBoundingClientRect()` or `offsetX` and writes `style.left/top` | Rect cached by `ResizeObserver` and scroll; one `transform` write in rAF | EVT-09 |
| `debounce(100)` on scroll or resize for a visual update | Passive listener + rAF; `scrollend`; `ResizeObserver` | EVT-12 |
| `setTimeout(…, 300)` to wait for an animation | `animation.finished`, `transitionend` | STY-19 |
| Animating `top`, `left`, `width`, `height` | `transform` / `opacity`; FLIP | STY-01 |
| `will-change: transform` in base CSS | Add it just before the motion, remove it after | STY-06 |
| `toLocaleString()` or `new Intl.NumberFormat()` per tick | One cached formatter per locale and options | HOT-09 |
| Arrays of `{ time, open, high, … }` objects for 1M points | `Float64Array` columns | HOT-04 |
| `JSON.parse(JSON.stringify(x))` to copy | No copy, or `structuredClone`; transfer across threads | TASK-14 |
| Replace the whole dataset on every tick | Append, or update the last point in place | RT-08, SC-07 |
| Create the chart in a reactive block that runs again | Create once per mount; `delete()` in cleanup | SC-03 |
| `setInterval` polling, or timers that drive visuals | Events, observers, push; rAF for visuals | TASK-19 |
| `await` per item in a 10k loop, or `await Promise.resolve()` to "yield" | Deadline-based `scheduler.yield()` with a fallback | TASK-05 |
| `requestIdleCallback` for input work; `isInputPending()` | Feedback, then yield; rIC only for deferrable work, with a timeout and a Safari fallback | TASK-09 |
| `loading="lazy"` on the hero image; preload everything | `fetchpriority="high"` on the LCP image; preload only late-discovered resources | MEDIA-02, SHELL-14 |
| A new dependency for a dialog, tooltip or menu | `<dialog>`, `popover`, invoker commands (check `support.md`) | DOM-10 |
| Code with no teardown, no error path, and 10-item test data | Teardown owner, error path, production-scale data | LLS-01, LLS-02 |
| "It is GPU-accelerated, so it is smooth" | "Hypothesis: … Measure: `measure.md` §Frames" | Always-on rule 13 |
| FID, TTI or the Lighthouse performance score as targets | INP, LCP, CLS; traces and insights | `support.md` §C |

### 4.4 Output mode 1: the notes block (format in SKILL.md)

Rules for the block:
- Add it after code that made a performance-relevant choice. Leave it out for trivial edits.
- Use 2–5 bullets.
- Each bullet names the choice, the rule ID, the cost, and the stage.
- Mark every unmeasured claim as a hypothesis. Add the one command or trace that would confirm it.

Example:

```markdown
**Performance notes**
- Coalesced `pointermove` into one rAF write (EVT-06). Cost: the crosshair can lag input by up to 1 frame. Saves a style and layout pass per event. Stage: script, layout.
- Price labels stay in a DOM overlay moved by `transform`, not WebGL text (CNV-12). Cost: one composited layer. Benefit: no glyph re-upload when the label changes.
- Hypothesis, not measured: panning with 20 series stays under 8 ms of script per frame. Check: `measure.md` §Frames, `scripts/frame-stats.js`.
```

---

## 5. Reference files

Conventions for all task files:
- Line 1 is the title.
- Line 3 is "Open this when you write …" (the scope).
- Then `## Checklist`: one line per rule (ID, imperative, impact). Up to 5 `→ ID` lines point to rules owned by other files. The checklist is the table of contents.
- Then the sections with full rules, then one-line rules.
- Files over 300 lines also get a section TOC under the checklist.
- A full rule has at most 18 lines. An example has at most 8 lines of code.

"Feeds" lists the notes that supply the rules, with section letters from the note headings. `verify/*` corrections apply first, in all files.

### 5.1 `page-shell.md` (SHELL), 300 lines, about 22 rules (15 full, 7 one-line)

- **Scope:** the document and `<head>`, script and style tags, resource hints, fetch priority, bundles and code splitting, startup JS cost.
- **Feeds:** `01` §HTML parse and the head, §Preload scanner and fetch priority (not the image items), §CSSOM, §Scripts, §Tooling (Coverage); `02` §Understanding the critical path, §Optimize resource loading, §Resource hints; `03` §A Code-split; `04` §A Scripts, §B Resource hints, §C Fetch priority (not images), §E Render-blocking CSS; `05` §G CSS delivery; `09-v8-consolidated` (pending) startup rules: cost of JS, code caching, explicit compile hints, `JSON.parse` for large literals, ship modern syntax; `16-explore-fast-batch-*` (pending): JavaScript, CSS, third parties, budgets.
- **TOC:** Checklist · A. Document and head order (charset, viewport, inline scripts above stylesheets, lean head, no `document.write`, server-render the first view) · B. Scripts (`defer` or `type=module`, `async` only for independent scripts, `fetchpriority` for scripts, no injected startup scripts, split evaluation, `blocking=render` only for a known flash) · C. CSS delivery (inline small critical CSS, no `@import`, media split, remove unused CSS, body-level CSS for progressive sections) · D. Discovery and priority (plain tags, preload only late-discovered resources with `as` and `crossorigin`, `modulepreload`, Chrome tight mode, no large inline blobs, preconnect to at most 2 origins) · E. Bundles and startup JS (split at routes and rare features with `import()`, about 100 KB chunks, no `nomodule` bundles, stable URLs for the code cache, compile hints used rarely, facades for third parties) · F. One-line rules.

### 5.2 `network-and-caching.md` (NET), 220 lines, about 18 rules (10 full, 8 one-line)

- **Scope:** `fetch()` calls from app code, HTTP headers that the frontend team controls, service worker, navigation performance.
- **Feeds:** `01` §Navigation and TTFB (redirects, 103, bfcache, speculation); `02` §General HTML (HTML caching, ETag, Server-Timing, compression, CDN); `03` §C Prefetch and precache, §F TTFB, §I bfcache; `04` §F Speculation rules, §G Server and HTTP, §H bfcache; `07` §B Service worker, §E Network control and streams, §I Adaptive loading; `17-collections-batch-01/02/03` (reliability: caching strategies, bounded caches, opaque responses, navigation preload, prefetch); `16-explore-fast-batch-*` (resource delivery).
- **TOC:** Checklist · A. `fetch()` calls (priority for background requests, abort superseded requests, streams with backpressure, Range requests, deduplicate) · B. HTTP caching and compression (hashed immutable assets with `no-cache` HTML, explicit `Cache-Control`, Brotli or zstd, Server-Timing) · C. Service worker (off the critical path, navigation preload, static routes, bounded caches, no cache-first for opaque responses) · D. Navigation (bfcache eligibility, `pagehide` and `pageshow`, conservative speculation rules, `No-Vary-Search`, Early Hints) · E. Adaptive loading (Save-Data, device class) · F. One-line rules.

### 5.3 `images-fonts-media.md` (MEDIA), 200 lines, about 18 rules (10 full, 8 one-line)

- **Scope:** any `<img>`, `<picture>`, SVG icon, `@font-face`, `<video>` or embed, and the LCP element.
- **Feeds:** `01` §LCP image items, §Fonts and media on the critical path, §Decode large images; `02` §Image, §Video, §Web fonts; `03` §B Lazy loading, §E LCP, §G CLS (dimensions, font swap); `04` §D Images, iframes and media; `05` §H Fonts and CLS; `12-canvas2d-and-images` (pending): `img.decode()`, `createImageBitmap`; `16-explore-fast-batch-*` (images, fonts).
- **TOC:** Checklist · A. The LCP element (`<img>`, not a CSS background; `fetchpriority="high"`; never lazy; discoverable in HTML; not built by JS) · B. Images (`srcset` and `sizes`, AVIF and WebP, DPR capped at 2, `width` and `height`, lazy below the fold, `sizes="auto"` where supported, `decode()`, SVG for icons) · C. Fonts (preload 1–2 fonts with `crossorigin`, `font-display` by role, metric-matched fallback, subsets and `unicode-range`, WOFF2 only, system and variable fonts) · D. Video and embeds (poster, `preload="none"` or `"metadata"`, video instead of GIF, facades) · E. Reserve space (CLS) · F. One-line rules.

### 5.4 `styles-and-animation.md` (STY), 340 lines, about 26 rules (16 full, 10 one-line)

- **Scope:** every CSS rule and every piece of motion on DOM elements.
- **Feeds:** `01` §Style and layout (selectors, DOM size, `content-visibility`, contain), §Paint, layers and compositing; `03` §G CLS (animate transform), §H INP (selectors); `05` §A–F, §I, §J; `06` §D (prefer CSS or WAAPI); `17-collections-batch-01..04` (WAAPI, `commitStyles`, reduced motion, scroll-driven animations, individual transform properties).
- **TOC:** Checklist · Section TOC · A. Compositor-only motion (transform, opacity and filter; FLIP; fade a pre-blurred layer; the conditions that stop compositing; do not animate custom properties or inherited variables; individual `translate`, `scale`, `rotate`) · B. Layers and GPU memory (promote just in time, avoid layer explosion, keep layer textures small, blurry text under scaled `will-change`) · C. Containment and skipped rendering (`contain`, `content-visibility: auto` and `hidden`, container queries) · D. Style recalculation scope (simple selectors, toggle state on the smallest element, anchored `:has()`, no `:nth-child()` on mutating lists, fast-changing custom properties off `:root`) · E. Paint cost (small repaint areas, blur and shadow, `backdrop-filter` over changing content, rounded clips over canvases, large gradients) · F. WAAPI and CSS animation mechanics (`commitStyles()` then `cancel()`, no endless fill, retarget without a start keyframe, `finished` instead of timers, `getAnimations()` to pause hidden panels) · G. Scroll effects, view transitions, reduced motion (scroll-driven animations as progressive enhancement, small view transitions, `prefers-reduced-motion` also for canvas and WebGL) · H. One-line rules.

### 5.5 `dom-and-lists.md` (DOM), 180 lines, about 13 rules (8 full, 5 one-line)

- **Scope:** code that creates or updates many nodes: lists, tables, grids, dialogs, menus.
- **Feeds:** `01` §Keep the DOM small, §Do not build large DOM subtrees in one task; `03` §H (DOM size, client-side HTML); `04` §I Native HTML instead of JavaScript; `06` §H (virtualize, the DocumentFragment myth), §I (event delegation); `16-explore-fast-index` A19 (client-side rendering); `15-gaps-round-*` (pending; virtualization is expected there).
- **TOC:** Checklist · A. DOM size and structure (create hidden UI on demand; the DOM-size insight thresholds are in `pipeline.md`) · B. Long lists and tables (virtualize with fixed row heights; key by id, never by index; for high-rate rows keep a fixed set of rows and update `textContent` in place; `content-visibility` for sections) · C. Building DOM (chunk large builds across tasks, clone templates, no `innerHTML` parse per tick, group the writes) · D. Native components (`<dialog>`, `popover`, `<details>`, `hidden="until-found"`, `inert`) · E. → EVT-15 event delegation · F. One-line rules.

### 5.6 `events-and-input.md` (EVT), 260 lines, about 18 rules (13 full, 5 one-line)

- **Scope:** every event listener and every gesture.
- **Feeds:** `01` §The update frame (passive listeners, coalesced events, layout-forcing reads in pointer handlers, paint first); `03` §H INP; `05` §I Scrolling (passive, `touch-action`, `overscroll-behavior`, scroll anchoring); `06` §D (coalesce into rAF), §F (feedback first, `preventDefault` before `await`), §G (INP subparts), §H (layout thrashing), §I (events and input); `07` §G (one teardown signal; → LLS); survey rules: Vercel transient values in refs, Copilot J3/J4, VS Code listener ownership per call.
- **TOC:** Checklist · A. The INP model (input delay, processing, presentation delay; feedback first, then yield; `preventDefault()` before any `await`) · B. High-rate input (coalesce to rAF, latest wins; `getCoalescedEvents()` for drawing precision; `getPredictedEvents()`; pointer capture with cleanup on `pointerup`, `pointercancel` and `lostpointercapture`) · C. Layout reads (read, then write; a cached rect instead of `offsetX` or `getBoundingClientRect()` per event; the full list of layout-forcing APIs is in `pipeline.md` §E) · D. Listener options (passive by default; non-passive `wheel` and `touch` only on the chart surface, with `touch-action`; delegation; one shared global listener per event type) · E. Debounce, throttle, `scrollend`; cancel superseded work with `AbortController` · F. Listener lifetime (one signal per owner; a new controller per call for methods that run many times; → LLS-01) · G. One-line rules.

### 5.7 `long-tasks-and-workers.md` (TASK), 260 lines, about 20 rules (13 full, 7 one-line)

- **Scope:** any job that can block the main thread; scheduling primitives; workers; Wasm.
- **Feeds:** `01` §Break long tasks, §Paint the response first; `03` §D Web workers, §H (yield); `06` §A Event loop model, §B Timers, §C Microtasks, §F Idle and prioritized scheduling, §K Startup and off-main-thread; `07` §A Workers and messaging, §J WebAssembly, §K; `17-collections-batch-03` (worker types, SharedArrayBuffer, channels); `16-explore-fast-batch-*` (JavaScript).
- **TOC:** Checklist · A. Size the work first (the 50 / 250 ms heuristic; time it with `performance.now()`) · B. Yield (`scheduler.yield()` with a fallback; yield on a 50 ms deadline; never "yield" with a promise or a microtask; MessageChannel fallback; the 4 ms `setTimeout` clamp) · C. Priorities (`postTask` priorities and `TaskController` abort; `requestIdleCallback` only for deferrable work, with a timeout and a Safari fallback; no `isInputPending()`) · D. Workers (one long-lived module worker; pool size from `hardwareConcurrency`; small messages and deltas; transfer `ArrayBuffer`s; `structuredClone` instead of JSON round-trips; MessageChannel between workers; SharedArrayBuffer and Atomics only under cross-origin isolation) · E. Wasm (only for measured kernels; cross the boundary rarely and in bulk; `instantiateStreaming`; SIMD) · F. Timers (never for visuals; throttled in background tabs; replace polling with events) · G. One-line rules.

### 5.8 `hot-code-v8.md` (HOT), 180 lines, about 14 rules (8 full, 6 one-line)

- **Scope:** code on a hot path. The file starts with a gate: "Fix the algorithm and the call count first. Apply these rules to code that a profile shows as hot, or to code that runs per tick, per frame or per point."
- **Feeds:** `08-v8-index` §2 and §8 now; `09-v8-consolidated` (pending) replaces them; `07` §H (`performance.now()`); survey patterns.dev (Set and Map lookups, hoisted RegExp), with its caveats (`toSorted()` and `structuredClone` allocate).
- **TOC:** Checklist · Gate · A. Object shapes (one constructor sets every field in the same order with its final type; `NaN`, not `null`, for an empty double; no `delete`; class fields are fine) · B. Arrays (packed and one kind, no holes, typed arrays for numeric series) · C. Allocation (short-lived objects are cheap and survivors cost; no per-frame closures or arrays kept across frames; reuse scratch buffers) · D. Builtins (reuse `Intl` formatters; the `JSON.stringify` fast path; do not mutate RegExp or its prototype; spread fast paths; `DataView` for binary protocols) · E. Async (native `async`/`await`, no promise polyfills, no `await` per item) · F. Myths: do not apply these (caching `length` in loops, "try/catch kills optimization", other Crankshaft-era advice) · G. One-line rules.

### 5.9 `realtime-data.md` (RT), 200 lines, about 15 rules (10 full, 5 one-line)

- **Scope:** the path from a socket to pixels in a trading UI.
- **Feeds:** `06` §D (coalesce), §J (visibility); `07` §A (SharedWorker, Web Locks, BroadcastChannel: one connection for all tabs), §E (backpressure, parse off the main thread); `03` §I (close sockets on `pagehide`); `10` "Render on demand and coalesce data ticks into one frame"; `13-scichart` (pending) for the series side; survey rules 5 (TradingView incremental updates), 7 (OpenAI degradation policy), 18 (bfcache and sockets), 19 (transport choice, heartbeat, backoff); `17-collections-batch-02` (cached data first, then network).
- **TOC:** Checklist · A. The feed contract, written before code (message rate at peak, payload size, consumers, maximum acceptable latency, degradation policy) · B. Ingest (transport by direction; compact or binary payloads; parse in a worker when parsing breaks the frame budget; backpressure; heartbeat and reconnect with capped exponential backoff) · C. Store (ring buffers and typed arrays; latest value wins per key; a float64 time origin before any float32 use, → GPU-14) · D. Deliver to the UI (flush once per frame; append or update the last point, never replace the dataset; keep high-rate values out of reactive state; throttle non-visual consumers) · E. Lifecycle (pause when hidden or off-screen and resync from the latest state; close on `pagehide`; one connection for all tabs) · F. Degradation (drop or aggregate old ticks, lower the update rate, show the degraded state to the user) · G. One-line rules.

### 5.10 `canvas-and-frames.md` (CNV), 260 lines, about 22 rules (14 full, 8 one-line)

- **Scope:** your own canvas, a render loop, and Canvas2D drawing. SciChart manages its own loop, so `scichart.md` points here only for custom overlays.
- **Feeds:** `01` §The update frame (rAF timestamp, render on demand, ResizeObserver sizing, IntersectionObserver as next task, OffscreenCanvas, `preserveDrawingBuffer`); `05` §C (stop render loops for skipped charts), §F (rounded clips, `image-rendering`); `06` §D, §E; `07` §C; `10` (backing-store size, cap pixels, render on demand, cache static layers, DOM or 2D overlays); `12-canvas2d-and-images` (pending: Canvas2D state batching, `Path2D`, cached text measurement, `willReadFrequently`, `alpha: false`, `desynchronized`, `reset()`); survey rules 1, 2, 8, 9 (OpenAI); MWG `contentvisibilityautostatechange`.
- **TOC:** Checklist · A. The frame loop (one rAF owner; drive motion from the timestamp; dirty flags and render on demand; a stop condition; only visual work in rAF; "after the next paint" = rAF, then a task) · B. Canvas size and pixels (`ResizeObserver` with `device-pixel-content-box`; set the size only when it changes; a DPR cap; the backing-store memory formula w × h × DPR² × 4 × layers × instances; do not resize the observed box inside its callback) · C. Layers by change rate (static, data, hover and selection, overlay; hover redraws only the overlay; DOM for sparse text and tooltips) · D. Canvas2D drawing (group draws by state; one path per trace; cache `Path2D` and text metrics; context flags; avoid `getImageData`) · E. Off the main thread (OffscreenCanvas in a worker; `createImageBitmap`) · F. Visibility (pause on `visibilitychange`, `contentvisibilityautostatechange` and IntersectionObserver) · G. Fewer marks (cull; decimate to pixel resolution with min/max per pixel column) · H. One-line rules.

### 5.11 `gpu-webgl-webgpu.md` (GPU), 480 lines, about 36 rules (22 full, 14 one-line)

- **Scope:** WebGL2 now and WebGPU next. One rule per mechanism, with `WebGL:` and `WebGPU:` lines in "Do". This stops the duplication between notes `10` and `11`, and it lets the WebGPU migration read one file.
- **Feeds:** `10-gpu-webgl` (64 items) and `11-gpu-webgpu` (50 items), merged; the survey webgpu-skill optimization ladder and lifecycle tests; PixiJS (upload before the first visible frame; text re-raster; mask cost order; spread bulk destruction over frames); three.js skill (dispose, test context loss with `WEBGL_lose_context`); Mapbox (`preserveDrawingBuffer` and `antialias` only for a stated need).
- **TOC:** Checklist (each line marked W, G or W+G) · Section TOC · 0. The optimization ladder (algorithm and count → CPU-GPU sync and readback → resource churn → bandwidth and overdraw → draw count → shader arithmetic) · A. Context and device (WebGL2 with a fallback; request only the features you use; `powerPreference` left at default; `failIfMajorPerformanceCaveat` probe; WebGPU feature detection with a WebGL fallback; one context or one device for many panes; query limits once) · B. Buffers and uploads (allocate once with headroom; sub-range updates; ring buffers for streams; no orphaning; usage hints; `writeBuffer` by default; `mappedAtCreation`; `destroy()`) · C. Vertex data and precision (the smallest type; interleave by change rate; **never put Unix-ms timestamps in float32**; transform relative to the visible origin; `highp` for coordinates; Uint16 indices) · D. Draw submission (instancing for candles and bars; thick lines as quads; multi-draw; sort by program and bindings; skip redundant state; UBOs and dynamic offsets; bind groups by update frequency; render bundles; one command buffer per frame; indirect draws) · E. Shaders and pipelines (compile everything, then check once; `KHR_parallel_shader_compile` and warm-up; `createRenderPipelineAsync` before the first frame; `override` constants; move work to the vertex shader; avoid `discard` and overdraw) · F. Textures and text (`texStorage2D` + `texSubImage2D`; RGBA8; mipmaps only when minified; upload from `ImageBitmap`; glyph-atlas text; compressed textures; data textures with `texelFetch`) · G. Readback and picking (async PBO + fence, or a `mapAsync` pool; CPU hit tests instead of `readPixels`) · H. Loss and teardown (context loss and restore; `device.lost`; `loseContext()` on destroy; delete eagerly but outside the frame; spread bulk destruction) · I. Profiling (timer queries and `timestamp-query`; no blocking queries in hot paths; zero GL errors; the shrink-the-canvas test for fill-bound work; low-end GPUs) · J. The WebGL → WebGPU table (from `11` §"What changes") · K. One-line rules.

### 5.12 `scichart.md` (SC), 320 lines, about 22 rules (14 full, 8 one-line)

- **Scope:** SciChart.js v5 only (a user decision). It covers the API choices that change cost. The generic GPU mechanics stay in `gpu-webgl-webgpu.md`.
- **Feeds:** `13-scichart` (pending; the main input); `raw/scichart/*.d.ts` typings (`BaseDataSeries`, `XyDataSeries`, `SciChartSurface`, `SciChartSurfaceBase`); survey TradingView lightweight-charts patterns (installed typings win over docs; update the last point; create once per mount; `ResizeObserver`); survey rule 7 (the chart contract).
- **Source-of-truth rule (top of the file):** "Read the installed version (`node_modules/scichart/package.json`) and grep the `.d.ts` typings before you use an API. If a name is not in the installed typings, it does not exist. If the vendor SciChart MCP server is available, use it for docs lookups." The survey found no public SciChart performance rule set, and the SciChart docs pages return 403 to scripts, so the typings are the verifiable source.
- **TOC:** Checklist · Section TOC · 0. Source of truth · A. The chart contract (series count, points per series, update rate, instances per page, DPR, degradation policy, teardown owner) · B. Surfaces (`create` compared with `createSingle`: the typings say `createSingle` "provides better performance for a single chart, but there is a limit (16)"; sub-charts for many panes; the shared wasm context; `freezeWhenOutOfView`; the engine loop and `disableEngineLoop` with `TSRRequestDraw()`) · C. Data series (`appendRange`, `fifoCapacity`, `capacity`, the flags `isSorted`, `dataEvenlySpacedInX` and `containsNaN`; update the forming candle in place; input array types) · D. Batching (`suspendUpdates()` and `resumeUpdates()` for many property changes; one bulk append per frame) · E. Rendering cost (resampling, point markers, stroke thickness, native compared with SVG annotations, axis label formatting) · F. Interaction (built-in modifiers before custom handlers; rollover and tooltip cost; → EVT) · G. Lifecycle (`surface.delete()` on unmount; `dataSeries.delete()` frees WebAssembly memory; never recreate in reactive blocks; `disposeSharedWasmContext()`; `invalidateOnTabVisible`) · H. WebGPU (only facts that `13-scichart` confirms for v5; otherwise the line "not verified") · I. Measuring SciChart (`renderedToWebGl` event timing; → `measure.md` §Frames) · J. One-line rules.

### 5.13 `long-lived-sessions.md` (LLS), 240 lines, about 18 rules (11 full, 7 one-line)

- **Scope:** a trading terminal stays open for hours. This file covers ownership, growth, background behavior and proof of no leaks.
- **Feeds:** `07` §D Visibility and lifecycle, §F Storage, §G Memory hygiene, §H (clear the User Timing and Resource Timing buffers); `06` §J; `03` §I (→ NET for bfcache); survey rules: VS Code (listener ownership, proof by slope), Mapbox (under 10 MB per hour), Chrome memory skill (repeat about 10 times; detached DOM can be an intentional cache, so ask first), tldraw (disposer contract); `17-collections-batch-02` (quota, persistence).
- **TOC:** Checklist · A. Ownership and teardown (one `AbortController` per owner; a new one per call for methods that run many times; `once` for lifecycle events; teardown order: stop loops and observers, then dispose resources; `WeakMap` metadata; drop references to removed DOM) · B. Bounded growth (caches with size and age limits, ring buffers, cleared performance buffers, no retained console objects) · C. Hidden and background (`visibilitychange`: stop rendering and polling, flush state; resume from the latest state; freeze and resume events; timer throttling) · D. Storage (`localStorage` off hot paths; batched IndexedDB transactions; OPFS in a worker; quota and persistence) · E. Proving no leaks (repeat N times with GC forced between runs, fit a slope, set a threshold; count DOM nodes, canvases and contexts; `measureUserAgentSpecificMemory()`, not `performance.memory`) · F. Reactive state (raw or immutable containers for large data that you replace; derive, do not assign in effects; framework-neutral, with one Svelte 5 line such as `$state.raw`) · G. One-line rules.

### 5.14 Views, modes and facts

| File | Scope | Feeds | Structure | Lines |
|---|---|---|---|---|
| `pipeline.md` | The mental model, and the stage words used by every tag | `01` §Phase map (tables a and b, threads), `verify/01` (Paint Holding correction), `06` §A, `raw/ins-*.txt` (insight pages) | A. Initial load phases 1–12 (condensed: blocker, code that controls it, DevTools name) · B. The update frame (input → rAF → style/layout → ResizeObserver → IntersectionObserver → paint → composite → present) · C. Threads · D. Stage vocabulary (10 review stages ↔ 17 note stages) · E. Layout-forcing APIs · F. Metric → stages (LCP subparts, INP phases, CLS) · G. DevTools insight → stage → task file · H. "Find rules by stage" grep | 200 |
| `review.md` | Output mode 2 | Survey lessons: dejank two modes, Front-End Checklist conservative stance, ibelick review output, gstack per-finding fields, Addy "hypotheses, not measured regressions" | §7.1 | 130 |
| `measure.md` | Output mode 3 | `14-devtools-mcp-and-webmcp` (pending), `raw/cdmcp-tools.md`, `raw/webmcp*.txt`, `01` §Tooling, `07` §H, survey: Chrome LCP skill, Addy variance rules, Dallacqua, Karel, nucliweb fixed scripts, VS Code slope | §7.2 | 240 |
| `support.md` | Every version-sensitive fact | Status lines of every note, `raw/web-features.json`, `raw/bcd.json`, survey compat files, `verify/*` | §8 | 220 |

---

## 6. Rule entry format

### 6.1 The fields

```markdown
### <ID> <Imperative title: what to do, in at most 12 words>
stage: <stages> | metric: <metrics> | impact: <high|medium|low> | support: <key or baseline>
- **Do:** 1–3 lines. The action. When WebGL and WebGPU differ, add "WebGL:" and "WebGPU:" lines.
- **Why:** 1–3 lines. The mechanism (what the browser or engine does), not a slogan.
- **Detect:** API names or a regex a reviewer can grep, and the context where the pattern is bad.
- **Verify:** how to confirm at run time: an insight name, a trace event or track, or a script in `scripts/`.
- **Example:** Before and After code, at most 8 lines, trading-flavored, original code.
- **Caveat:** 1–2 lines. When the rule does not apply, or what it breaks.
- **Source:** 1–3 URLs. Primary sources first (spec, MDN, web.dev, developer.chrome.com, vendor typings).
```

- **IDs:** `<PREFIX>-<nn>`, stable after release. The ID registry in MAINTAINING.md lists each ID once. The prefixes are SHELL, NET, MEDIA, STY, DOM, EVT, TASK, HOT, RT, CNV, GPU, SC, LLS.
- **Impact:** `high` means visible on target hardware in normal use (a task over 50 ms after input, dropped frames during pan, zoom or streaming, a CWV threshold crossed, unbounded memory growth). `medium` means visible under load or on low-end devices, or the cost grows with data size. `low` means small or rare; apply it when you touch that code anyway.
- **Why "Detect" and "Verify":** a rule with no check does nothing (18-github lesson 4: Copilot regexes, iart "no Layout or Paint events in the animation window"). Review mode greps "Detect". Measure mode uses "Verify".
- **One-line rule** (for low impact or obvious rules): `- **<ID>** <imperative>. [stage | metric | impact] <1 source URL>`.
- **Style:** simple technical English (short sentences, one instruction per sentence), American spelling ("color"), and "why" instead of "MUST" (skill-creator guidance).

### 6.2 Example 1 (CSS, in `styles-and-animation.md`)

~~~markdown
### STY-12 Contain each independent panel; let the browser skip hidden ones
stage: style, layout, paint | metric: INP, frame | impact: high | support: css-contain, content-visibility
- **Do:** Give each self-contained panel (chart pane, order book, watchlist, blotter) `contain: strict` and an explicit size when the grid sets its size, or `contain: content` when its content sets the height. On panels that can be off-screen or in an inactive tab, add `content-visibility: auto` with `contain-intrinsic-size: auto <typical height>`.
- **Why:** Layout and paint containment make the panel a boundary. A change inside one panel then re-lays out and repaints only that panel, not the whole page. `content-visibility: auto` adds the same containment, also while the panel is on screen, and skips style, layout and paint for panels outside the viewport. With 10+ panels that update several times per second, each update then costs about one panel of work.
- **Detect:** a panel root that updates often and has no `contain` or `content-visibility`; a trace "Layout" event with "Layout scope: Whole document" after a panel update.
- **Verify:** trace one update (`measure.md` §Interaction). The "Layout" event shows a partial layout scope and fewer "Nodes that need layout". The ForcedReflow insight is the same or better.
- **Example:**
  ```css
  /* Before: one order-book tick re-lays out the whole grid */
  .panel { overflow: hidden; }
  /* After */
  .panel      { contain: strict; block-size: 100%; }          /* size comes from the grid track */
  .panel-flow { contain: content; }                           /* height comes from content */
  .panel-tab  { content-visibility: auto; contain-intrinsic-size: auto 480px; }
  ```
- **Caveat:** size containment without a size collapses the box to 0. Paint containment clips overflow, so show tooltips and menus in the top layer (`popover`, `<dialog>`). A skipped panel keeps its canvas and WebGL context alive, so also pause its render loop (→ CNV-17).
- **Source:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/contain ; https://web.dev/articles/content-visibility ; https://developer.chrome.com/docs/devtools/performance/timeline-reference
~~~

(Facts from `01` "Contain independent widgets such as chart containers" and 18-web MWG "interactions-in-complex-layouts". The support keys resolve in `support.md`: `contain` is Baseline Widely available; `content-visibility` is Baseline Newly available since 2025-09-15.)

### 6.3 Example 2 (GPU and SciChart, in `scichart.md`)

~~~markdown
### SC-07 Feed live ticks with one bulk call per series per frame
stage: script, gpu-upload, memory | metric: frame, INP, memory | impact: high | support: scichart-v5
- **Do:** Buffer incoming ticks in preallocated `Float64Array` scratch arrays (→ RT-06). Once per frame, call `appendRange(xs, ys)` on each changed series. Update the forming candle or the last point in place with `update(index, …)`. For a scrolling window, create the series with `fifoCapacity`. For growing history, set `capacity` to the expected size. Set `isSorted`, `dataEvenlySpacedInX` and `containsNaN` to the true facts of the data. Trades are not evenly spaced, and that flag defaults to true.
- **Why:** Each `append` crosses from JS into SciChart's WebAssembly engine. The typings say `appendRange` "is considerably higher performance than append". FIFO mode "is much more efficient than appending and removing for achieving scrolling data". A preset `capacity` avoids "memory fragmentation". The three flags select "the correct, and fastest algorithms for drawing, indexing and ranging"; a wrong flag gives wrong drawing. The engine draws invalidated surfaces in its own rAF loop, so extra appends in one frame add JS-to-Wasm cost but no extra draws.
- **Detect:** `.append(` inside `onmessage` or per-tick code; `clear()` followed by `appendRange` of the full history on each tick; `removeAt(0)` to scroll; a streaming series with no `fifoCapacity` or `capacity`.
- **Verify:** `scripts/frame-stats.js` during a replayed feed at the peak production rate: p95 frame time and script time per frame, before and after. Heap stays flat over 10 minutes with FIFO (`measure.md` §Memory).
- **Example:**
  ```ts
  // Before: one Wasm call per tick, unbounded growth
  socket.onmessage = (m) => { const t = decode(m.data); series.append(t.time, t.price); };
  // After: bounded window, one bulk call per frame
  const series = new XyDataSeries(wasmContext, { fifoCapacity: 100_000, isSorted: true, dataEvenlySpacedInX: false, containsNaN: false });
  const xs = new Float64Array(4096), ys = new Float64Array(4096); let n = 0, queued = false;
  socket.onmessage = (m) => { const t = decode(m.data); if (n < xs.length) { xs[n] = t.time; ys[n++] = t.price; } // overflow → RT-11
    if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; if (n) series.appendRange(xs.subarray(0, n), ys.subarray(0, n)); n = 0; }); } };
  ```
- **Caveat:** a FIFO series does not support `insert` or `remove`, and spline and stacked series do not support FIFO (typings). Check in the installed `types/NumberArray.d.ts` which array types `appendRange` accepts. The engine may copy the arrays.
- **Source:** node_modules/scichart typings: `BaseDataSeries.d.ts` (`fifoCapacity`, `capacity`, `isSorted`, `dataEvenlySpacedInX`, `containsNaN`), `XyDataSeries.d.ts` (`append`, `appendRange`, `update`), `SciChartSurfaceBase.d.ts` (engine rAF loop). Raw copy read 2026-09-22; check again against the installed v5 package.
~~~

(All quotations come from `raw/scichart/BaseDataSeries.d.ts`, `XyDataSeries.d.ts` and `SciChartSurfaceBase.d.ts`. The raw typings link to "js/v4" docs pages, so `13-scichart` must confirm these names in v5 before release. This rule shows how the format handles library facts: the installed typings are the source, and support key `scichart-v5` records the version that was checked.)

### 6.4 Example of a one-line rule (in `hot-code-v8.md`)

```markdown
- **HOT-09** Create `Intl.NumberFormat` and `Intl.DateTimeFormat` once per locale and options, and call `.format()`; never call `toLocaleString()` per tick. [script | frame, INP | medium] https://v8.dev/blog/intl
```

---

## 7. Output modes 2 and 3

### 7.1 Performance review (mode 2): `references/review.md`

**When:** the user asks to review, audit or check code for performance, or runs `/web-performance review <path>`.

**Steps:**
1. **Scope.** List the files or the diff. Read them. Read the installed versions of the main libraries (SciChart, the framework).
2. **Route.** For each changed region, find the task in the router (by code signals). Read those task files' checklists.
3. **Scan.** Run the "Detect" hints of the listed rules over the changed code (grep, then read the context). Also check the always-on rules.
4. **Confirm each finding with a quoted line** and give it one evidence level:
   - **M, measured:** a trace, script output or numbers exist.
   - **S, static, mechanism certain:** the code does it on every event, for example a layout read after a style write inside `pointermove`.
   - **H, hypothesis:** the cost depends on data size or hardware; it needs a measurement.
5. **Be conservative.** Report at most about 10 findings, strongest first. Prefer silence to nitpicks. Skip anything with an estimated saving of 0 ms (Cloudflare). Say so when the code is already good.
6. **Group by stage**, in pipeline order: network → parse → script → style → layout → paint → composite → gpu-upload → gpu-draw → memory.
7. **Offer measurement** for H findings (→ `measure.md`). Do not edit code in a review unless the user asks.

**Template:**

```markdown
## Performance review: <scope> (<YYYY-MM-DD>)

**Verdict:** <1–3 lines: the biggest risk, and whether the change is safe to ship as is>
**Context:** <libraries and versions; data scale assumed, for example 500k points and 200 ticks/s>
**Evidence:** M = measured · S = static, mechanism certain · H = hypothesis, needs measurement

### <Stage, for example Layout>
| # | Finding (file:line) | Rule | Impact | Ev. | Fix |
|---|---|---|---|---|---|
| 1 | `chart-overlay.ts:88` reads `getBoundingClientRect()` inside `pointermove` after it writes `style.transform` | EVT-09 | high: forced layout on every event (INP, frame) | S | Cache the rect in a `ResizeObserver`; write once in rAF |

<For each high finding: the quoted line, why in 1 sentence, a code fix of at most 8 lines, and how to verify.>

### Not checked
<Areas not reviewed and why; facts that could not be confirmed>

### Measurement plan (optional)
<Scenario, metric, tool: 3 lines that point to measure.md>
```

### 7.2 Measurement (mode 3): `references/measure.md`

**When:** the user asks "is it faster?", "profile this", "trace it", or runs `/web-performance measure <URL>`; also before Claude says that a change is faster. The workflow order is fixed: **baseline trace → one change → the same trace again → compare** (the user requirement; Addy agent-skills "one change per measurement").

**Structure of `measure.md`:**
- §0 Preconditions
- §1 Scenario
- §2 Environment
- §3 Load
- §4 Interaction
- §5 Frames
- §6 Memory
- §7 Compare and verdict
- §8 Report
- §9 WebMCP test hooks
- §10 Pitfalls
- §11 Tool cheat sheet

**Steps:**

0. **Preconditions.** The Chrome DevTools MCP tools are available (`mcp__chrome-devtools__*`). If not, say so, and give the user the manual DevTools steps. Heap analysis tools need the server flag `--memoryDebugging=true`; WebMCP tools need `--categoryExperimentalWebmcp=true` (`raw/cdmcp-tools.md`). The dev server runs. Prefer a production preview build: dev builds add framework and HMR overhead. Always state which build you used.
1. **Scenario.** Write the fixed steps before you measure. Examples: "load symbol X; pan left 20 times by 300 px; zoom out 5 times", or "replay the feed at 200 msg/s for 30 s". Pick the metric by claim:
   - load → LCP, FCP, TTFB, render-blocking;
   - input → INP breakdown, LoAF;
   - pan, zoom or stream → frame stats;
   - hours of use → heap slope.
2. **Environment, the same for both sides.** Call `emulate` with `cpuThrottlingRate` (4 for a mid-range device; also 1 for the desktop terminal), `networkConditions` (`"Fast 4G"` or `"Slow 4G"` for load only), and `viewport` `"1440x900x2"` (DPR changes canvas cost). Close other tabs. Record the Chrome version.
3. **Baseline, load:** `navigate_page` to the URL, then `performance_start_trace` with `{ reload: true, autoStop: true, filePath: "<scratchpad>/perf/before-1.json.gz" }`. Read the listed insights, then call `performance_analyze_insight` only for the relevant ones (LCPBreakdown, DocumentLatency, RenderBlocking, NetworkDependencyTree, LCPDiscovery, and others). Use the exact names that the trace summary prints. `lighthouse_audit` "excludes performance", so do not use it for speed.
4. **Baseline, interaction:** `performance_start_trace` without reload, then drive the scenario with trusted input tools (`click`, `drag`, `hover`, `press_key`), or with a WebMCP test hook (§9), then `performance_stop_trace { filePath }`. Read INPBreakdown, ForcedReflow, DOMSize and CLSCulprits. Add `scripts/interaction-loaf.js` through `evaluate_script` for the worst frames' scripts and `forcedStyleAndLayoutDuration`.
5. **Frames (canvas, WebGL, SciChart):** start `scripts/frame-stats.js` through `evaluate_script` (it samples rAF deltas for N ms). Run the scenario and collect: frames, p50, p95 and p99 frame time, max frame gap, frames over 16.7 ms and over 33 ms, LoAF count over 50 ms.
6. **Repeat:** 5 runs for interaction and frames, at least 3 for load traces. Keep the median and the min–max range.
7. **Change one thing.** Then repeat steps 3–6 with the same steps, conditions and file names (`after-n`).
8. **Compare and decide:**

   | Metric | Before median (min–max) | After median (min–max) | Delta | Verdict |
   |---|---|---|---|---|

   - Call it an improvement only if the ranges do not overlap, or if the median moves by more than the run-to-run spread in a second batch too.
   - Otherwise write "no measurable difference". Revert the change unless it has another merit (correctness, readability) and say which.
   - A change that needed a test changed or deleted is a regression.
9. **Memory:**
   - Warm up.
   - Repeat the interaction 10 times.
   - Sample `scripts/memory-sample.js` (DOM nodes, canvases, `measureUserAgentSpecificMemory()` when `crossOriginIsolated`) or `take_heapsnapshot { filePath }` between rounds.
   - Fit the growth per repetition and compare it with a threshold.
   - Detached DOM can be an intentional cache: ask before you remove references.
   - Never read a raw `.heapsnapshot` into context.
10. **Report:** the conditions (Chrome version, throttling, viewport and DPR, build, data size), the trace file paths, the insight names read, the compare table, and a ledger of attempts (change → result → kept or reverted).
11. **WebMCP test hooks (optional, dev builds only):** the page registers deterministic scenario tools with `document.modelContext.registerTool(...)`, for example `load_symbol`, `set_visible_range`, `replay_feed({ rate, seconds })`, `add_indicators({ count })`. Claude lists them with `list_webmcp_tools` and runs them with `execute_webmcp_tool` between the start and stop of a trace. This replaces fragile synthetic mouse paths with repeatable steps. Status: an origin trial from Chrome 149 and a local flag `chrome://flags/#enable-webmcp-testing` (`raw/webmcp.txt`). The hooks must not ship to production.
12. **Pitfalls:**
    - A lab INP is a proxy; field INP needs RUM (Karel).
    - Script-dispatched pointer events can land at the wrong canvas coordinates at DPR 2. Use trusted input tools or hooks.
    - Traces are large: save them with `filePath` and read only the insights.
    - Thermal throttling and background tabs add noise, so repeat the runs.
    - Never state "60 fps" from one run.

---

## 8. Version-sensitive facts: one place, dated

**The place:** `references/support.md`. No other file contains a browser version, a Baseline date, or a "since Chrome N".

**Header:**

```markdown
# Browser support, deprecations and tool versions
Checked: 2026-09-22. Sources: MDN browser-compat-data 8.1.2 (2026-09-17); web-features 3.39.0 through api.webstatus.dev; developer.chrome.com; web.dev; installed package typings.
Policy: Baseline Widely available → use freely. Newly available → use it and name the fallback in the notes block. Limited → feature-detect and ship the fallback in code. Chromium-only diagnostics (§B) need no fallback, because they only add detail.
Staleness: if today is more than 180 days after "Checked", verify a row on api.webstatus.dev (or MDN) before you quote it, and say that you did.
```

**Sections:**
- **A. Feature table:** key · feature · Chrome · Firefox · Safari · Baseline status and date · fallback in code · source. Seed rows come from the notes' Status lines and the surveys. Examples: `scheduler-yield` (Chrome 129, Firefox 142, no Safari); `request-idle-callback` (no Safari); `content-visibility` (Newly available 2025-09-15); `scrollend` (Newly available 2025-12-12); `fetch-priority` (Newly available 2024-10-29); `view-transitions` (same-document Newly available 2025-10-14; cross-document limited); `scroll-driven-animations` (limited: no Firefox); `interpolate-size` (Chromium only); `sizes-auto`; `loading-lazy-media`; `speculation-rules` (Chromium; no Safari prerender); `soft-navigations` (Chrome 151); `zstd` (Newly available 2026-02-11); `webgpu` (per platform; from `11` §L); `sw-static-routes`; `webmcp` (origin trial from Chrome 149).
- **B. Chromium-only extras** (no fallback needed): LoAF, `measureUserAgentSpecificMemory`, explicit compile hints, the `JSON.stringify` fast path (engine detail), Compute Pressure, Element Timing, JS Self-Profiling.
- **C. Deprecated, removed or stale: do not use and do not cite:** FID (replaced by INP on 2024-03-12); TTI (removed in Lighthouse 10); `isInputPending()` (no longer recommended); `<link rel=prerender>`; HTTP/2 Server Push; `unload`; `performance.memory`; `format('woff2-variations')`; `document.write`; `nomodule` bundles; the `translateZ(0)` hack; the Lighthouse audits retired in Lighthouse 13; bfcache facts that changed (`no-store` rollout in 2025; WebSockets no longer block bfcache in Chrome 149+ and Safari, per `verify/01`).
- **D. Engine and tool numbers that change:** Chrome tight mode and the first 5 large images at Medium priority; the WebGL live-context limit; the SciChart `createSingle` limit of 16; the Speculation Rules eagerness limits and the Chrome 143 change; the Paint Holding timeout of 500 ms (`verify/01`).
- **E. Library and tool versions:** SciChart.js (the version whose typings the SC rules were checked against, and the command to print the installed version); Chrome DevTools MCP (the version, and the flags for memory and WebMCP); `web-vitals` v6 (attribution build).

**How rules point to it:** the tag `support: <key>`. For a Limited feature, the rule's "Do" includes the fallback in code (for example the `setTimeout` fallback for `scheduler.yield()`). The rule body never includes the version.

**Build step:** each note's Status line becomes a support row, deduplicated by feature key. The `verify/*` corrections override the notes. A row with conflicting sources (for example `fetchpriority`: BCD says Chrome 101, webstatus says Chrome 103) keeps both values and names each source.

---

## 9. What to leave out, and how to deduplicate

### 9.1 Leave out

| Leave out | Why | What stays instead |
|---|---|---|
| Rules that models already follow, such as "minify in production" and "use HTTP/2" | These fail the no-op test (Svelte `writing-great-skills`) | At most one one-line rule in `page-shell` §F when Claude edits build config |
| Server, CDN and backend work (server think time, CDN choice, DB) | Not frontend code; the user's backend is out of scope | The headers that frontend code sets (`network-and-caching` §B) |
| Case studies, history, statistics without a source ("10× faster") | They do not change the code; uncited numbers teach false precision | Mechanisms plus a Verify step |
| Framework rules for React, Vue, Angular and Next.js; a Svelte file | User decision: SciChart only | Framework-neutral rules; at most one Svelte 5 line inside a rule |
| Deprecated APIs as rules | They confuse retrieval | One row each in `support.md` §C |
| DevTools UI clicks for a human (Rendering drawer, Layers panel) | The agent cannot click them | `measure.md` §10: one line, "ask the user to check X" |
| Micro-optimizations that the JIT already handles (caching `length`, try/catch fears) | No effect; noise | `hot-code-v8` §F "Myths: do not apply" (one line each) |
| Workbox plugin details, video CRF tuning, JPEG XL, HTML-in-Canvas origin trial | Rare for this user; unstable | One-line rules at most, or nothing |
| Speed Index, Lighthouse score targets | Low-value diagnostics; an agent loop optimizes the score (Karel) | CWV thresholds and traces |
| Note sections "Sources read" and "Not covered" | Research sediment | MAINTAINING.md keeps a link to the notes folder |
| `01-…run1.md`, `01-…run2.md`, `01-…run2-new.md` | Older or duplicate passes (`run2` has the same size as `01`; the `run2-new` items are already in `01`) | `01-critical-rendering-path.md` + `verify/01` |

### 9.2 Deduplication procedure (build time)

The notes hold about 700 items (`01` 62, `02` 69, `03` 63, `04` 48, `05` 46, `06` 44, `07` 55, `10` 64, `11` 50, `17` 86, `08` §8 10, plus the pending files). Many items repeat across files. Examples:
- "Replace CSS `@import` with `<link>`" is in `01`, `02` and `05`.
- "Batch reads before writes" is in `01`, `03`, `05` and `06`.
- "Stop rAF loops when hidden" is in `01`, `05`, `06`, `07` and `10`.
- "Size canvases from ResizeObserver" is in `01`, `06`, `07`, `10` and `11`.
- "`scheduler.yield()` with a fallback" is in `01`, `03`, `06` and `07`.

1. **Extract.** A scratch script (not part of the skill) parses every `### ` item with its tags (Layer, Stage, Metrics, When, Impact, Status, Sources) into a CSV: file, line, title, tags, URLs.
2. **Cluster.** Normalize the titles (lowercase, remove stop words, map synonyms such as "rAF" and "requestAnimationFrame"). Group items that share their key API names or at least 2 source URLs. Review each cluster by hand, because the similarity key is only a hint.
3. **Pick one owner per cluster:** the task file where the bad code gets typed. Examples: layout thrashing → `events-and-input` (handlers are where it happens most); pausing hidden work → `canvas-and-frames` for loops and `long-lived-sessions` for polling and feeds. Other files get at most a `→ ID` line in their checklist.
4. **Merge the content:**
   - `verify/*` corrections first; the newest dated primary source wins.
   - Sources: the union, cut to at most 3, primary first.
   - Keep the clearest mechanism for "Why".
   - Write a new trading-flavored example: a candle, a tick, a pane, an order book.
5. **Apply the no-op test to every sentence.** Delete a sentence that does not change what Claude writes.
6. **Assign the tier.** High and medium impact → full rule. Low impact or obvious → one-line rule. Below that bar → left out, and logged in MAINTAINING.md with the reason, so nobody adds it back by mistake.
7. **Check.**
   - A small script confirms that each ID is defined exactly once, that each `→ ID` resolves, and that each `support:` key exists in `support.md`.
   - Each file stays within its line budget.
   - `grep -c '^### '` per file matches the ID registry.

### 9.3 Plan for the notes still in progress

| Pending note | Goes to | What to expect |
|---|---|---|
| `12-canvas2d-and-images.md` | `canvas-and-frames` §D–E, `images-fonts-media` §B | Canvas2D state and text rules, `createImageBitmap`, context flags |
| `13-scichart.md` | `scichart` (all), `support.md` §D–E | Replaces or confirms the typings-only facts; decides §H WebGPU |
| `14-devtools-mcp-and-webmcp.md` | `measure.md`, `scripts/`, `support.md` §E | Exact insight names, flags, WebMCP tool pattern |
| `08-v8-batch-*` → `09-v8-consolidated.md` | `hot-code-v8`, `page-shell` §E (startup), `long-tasks-and-workers` §E (Wasm) | Replaces `08` §8 draft rules |
| `16-explore-fast-batch-*` | `page-shell`, `network-and-caching`, `images-fonts-media` | Third parties, budgets, CSS and JS delivery |
| `15-gaps-round-*` | Classified by the same owner rule; can add a router row | Virtualization, anything the critic found |

Budget slack: every task file has about 15% headroom under its line target. `gpu-webgl-webgpu.md` can split into `gpu-webgl.md` and `gpu-webgpu.md` if the merged file passes 500 lines. The split rule is already defined: common rules stay in the WebGL file and the WebGPU file points to them.

---

## 10. Test prompts for skill-creator evals

Each eval runs with the skill and without it (skill-creator benchmark mode). Fixtures: a small Vite + TypeScript app in `evals/fixtures/terminal/` with a SciChart pane, an order-book list, a WebSocket mock, and an `indicators.ts` file.

| # | Prompt (as the user would type it) | Mode | A good answer with the skill | A typical baseline without it | Graders (deterministic where possible) |
|---|---|---|---|---|---|
| 1 | "Add a crosshair to the price chart. It follows the mouse and shows the price on the right axis and the time at the bottom." | 1 | Reads the installed SciChart typings first, then uses the built-in cursor modifier if it fits (SC §F). If the crosshair is custom: a passive `pointermove`, coalesced into one rAF; position from `clientX` minus a rect cached by `ResizeObserver`; labels moved with `transform`; one cached `Intl.NumberFormat`; listeners on an `AbortController` aborted on destroy; ends with a Performance notes block that names the 1-frame lag trade-off. | `mousemove` handler that calls `getBoundingClientRect()` and `toLocaleString()` per event, sets `style.left/top`, and has no cleanup and no notes. | No `getBoundingClientRect`, `offsetX` or `offsetY` inside the move handler; `requestAnimationFrame` or a built-in modifier; a cleanup path (`abort()`, `removeEventListener` or `delete()`); a cached formatter; a "Performance notes" heading with at least 1 bullet that names a cost. |
| 2 | "Hook the trades websocket up to the order book and the tick chart. We get about 200 messages a second at peak." | 1 | States the feed contract (rate, latency, degradation policy); buffers ticks in typed arrays and flushes once per frame; `appendRange` with `fifoCapacity` and `dataEvenlySpacedInX: false`; order-book rows updated in place (fixed row set, keyed, `textContent`) inside a contained panel; pause and resync on `visibilitychange`; heartbeat and capped backoff; close on `pagehide`; no reactive state write per message. | One `append()` and one store update per message (200 re-renders per second); no hidden-tab handling; no reconnect policy. | Exactly one rAF-driven flush; `appendRange`; `fifoCapacity`; `visibilitychange`; a backoff limit; no DOM write or `append(` inside `onmessage`. |
| 3 | "Review indicators.ts for performance. It computes RSI and Bollinger bands over the whole history when the user adds an indicator." (The fixture uses arrays of objects, `map`/`filter`/`reduce` chains, a full window recomputation per point, and a full recompute on every tick, all on the main thread.) | 2 | A report in the `review.md` template, grouped by stage (script, memory); findings: O(n·period) recomputation → rolling sums in O(n); a multi-second main-thread task for 2.6M points → a worker with transferred `Float64Array`s, plus incremental updates per tick; arrays of objects → typed columns; per-point allocations. Each finding has file:line, a rule ID, an evidence level (S or H) and a fix. At most about 10 findings; no nitpicks; a measurement plan. | Generic tips ("memoize", "debounce", "use a faster library"); no stage grouping; no evidence levels; states "this will be 10× faster". | Stage headings present; each row has `file:line`, a rule ID, an evidence letter and a fix; mentions a worker or yielding; mentions typed arrays; mentions a rolling or incremental algorithm; no speed claim without "hypothesis". |
| 4 | "I switched the candle series to one instanced draw. Is panning faster now? Dev server is on localhost:5173." | 3 | Checks that the DevTools MCP tools exist. Explains that a baseline needs the old code, and asks how to get it (for example a `git worktree` of HEAD on a second port), because it must not stash the user's working tree unasked. Writes a fixed pan scenario; calls `emulate` (CPU 4×, viewport with DPR 2); runs 5 before and 5 after with `frame-stats.js` and a trace saved to a file; shows the compare table with medians and ranges; the verdict follows the overlap rule; lists the conditions. | Reasons from the code ("instancing cuts draw calls, so yes"), or runs `lighthouse_audit`, which excludes performance. | No "faster" claim without a table; at least 3 runs per side; conditions stated (throttle, DPR, build); trace `filePath` used; no `git stash` or checkout without asking. |

**Should-not-trigger prompts** (for description tuning): "Write a Python script that backfills 1-minute candles from the exchange API"; "Update the GitHub Actions workflow to cache pnpm"; "Rename the price column in the Postgres migration"; "Fix the typo in README.md".

**Near-miss prompts that should trigger lightly** (always-on rules only, no reference opened, no notes block): "Make the order-book rows 2 px taller"; "Change the toolbar icon color to the accent token".

---

## 11. Risks and how to reduce them

| # | Risk | Why it happens in this design | How to reduce it |
|---|---|---|---|
| 1 | The skill does not trigger at write time | Skills under-trigger (Vercel: not invoked in 56% of cases) | A description that starts with the writing task and says "even when the user does not mention speed"; file types and APIs in `when_to_use`; the path-scoped user rule (§3.2) or a CLAUDE.md pointer; the trigger evals in §10; `/web-performance` for manual use |
| 2 | Cross-cutting rules are scattered or duplicated | The primary axis is the task, but layout thrashing, rAF and teardown occur in many tasks | One owner per rule; `→ ID` pointers in checklists; the most cross-cutting rules are also one-liners in SKILL.md "Always-on"; the ID check script (§9.2 step 7) |
| 3 | The review mode needs stage grouping, but the files are by task | The axis conflict | A `stage:` tag line on every rule; `pipeline.md` §G–H maps insights and stages to rules; review.md orders findings by stage; the grep index is live, so it cannot go stale |
| 4 | Claude picks the wrong task file, or a change spans 3 tasks | Mixed edits, such as a chart feature with a feed and a handler | "Common pairs" in the router; short checklists, so reading 2–3 costs about 60 lines; `→ ID` pointers catch misses |
| 5 | Context cost on small edits | 13 task files and a 250-line SKILL.md | Only SKILL.md loads by default; "for small, low-risk edits, open nothing"; references load on demand; SKILL.md stays under 5,000 tokens, so it also survives compaction |
| 6 | SciChart facts are wrong for v5 | The docs return 403; `13-scichart` is not finished; the raw typings link to v4 docs | The source-of-truth rule (installed typings win; a name not in the typings does not exist); every SC rule cites a `.d.ts` symbol; `support.md` §E records the checked version; the SciChart MCP when available |
| 7 | Stale browser facts | Browsers ship every 4 weeks; the surveys found FID, TTI and wrong `scheduler.yield` versions in popular skills | One dated `support.md`; no versions in rule bodies; the 180-day re-verify rule; `verify/*` passes before release |
| 8 | False speed claims | Models like to say "faster" | The always-on honesty rule; evidence levels in reviews; the compare table and overlap rule in `measure.md`; graders in evals 3 and 4 |
| 9 | Over-optimization adds complexity | Rules applied where they do not matter | Impact tiers; the `hot-code-v8` gate (profile first); "revert neutral changes"; the scope boundary (no library migration, no new dependency unless asked); a notes block that must name each cost |
| 10 | Noisy lab measurements | Dev builds, HMR, thermal throttling, synthetic input on canvas at DPR 2 | A production preview build; fixed `emulate` settings; 5 runs with medians and ranges; trusted input tools or WebMCP hooks; lab INP labeled as a proxy |
| 11 | MCP tools or flags are missing | Heap analysis needs `--memoryDebugging`; WebMCP needs a flag and is in an origin trial | `measure.md` §0 checks the tool list first and falls back to scripts or manual DevTools steps, and says so |
| 12 | Pending notes change the file list | 6 note sets are still in progress | §9.3 mapping; about 15% line headroom per file; a defined split rule for the GPU file |
| 13 | Conflict with project rules | Repositories have their own AGENTS.md (for example branded ids, no `export` unless imported) | SKILL.md line 1: "project rules win"; the skill never asks for repository-wide refactors |
| 14 | The design is harder for the user to navigate by their own categories | The user's categories are cross-cutting views, not folders | The §1.3 map goes into MAINTAINING.md and the top of `pipeline.md`, so the user can find "CSS layers" or "V8" in one step |
