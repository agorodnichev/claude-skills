# Design A: pipeline stage first, for the `web-performance` skill

Date: 2026-09-22. Angle: A (the browser pipeline is the primary axis; layers are secondary tags).
Target: `~/.claude/skills/web-performance/` (user level, all projects).

Inputs read for this design:

- `18-skills-survey-github.md` and `18-skills-survey-web.md` in full.
- The headings of every notes file, plus item bodies from `01`, `05`, `10`, `11`, `12` and the phase map in `01-critical-rendering-path.md`.
- `verify/01-critical-rendering-path.verify.md` (format and corrections).
- `08-v8-index.md` sections 1, 2, 7 and 8.
- `raw/18-skills-survey-web/claude-code-skills-doc.md` (frontmatter, listing cap, compaction budget).
- `raw/cdmcp-tools.md` (DevTools MCP tool names).
- `raw/webmcp*.txt` (WebMCP API).
- `raw/scichart/*.d.ts` (SciChart typings).

Summary in five lines:

1. Every rule has one home: the pipeline stage where its saving shows in a trace. There are 13 stages, in pipeline order: `01-network` … `13-memory-and-lifecycle`.
2. SKILL.md is small: a one-screen pipeline map, about 30 always-on rules, three routing tables (by what you write, by symptom, and by the user's own categories), and the three output modes.
3. Each rule serves all three modes. `Do` applies when Claude writes code, `Detect` when it reviews code, and `Verify` when it measures.
4. SciChart.js v5 has its own file, but that file is also split into sections by stage.
5. Version facts live in one dated file (`support.md`). Measurement uses fixed scripts, not scripts that Claude improvises.

---

## 1. Classification axis

### 1.1 Primary axis: the pipeline stage where the cost lands

The notes already use one shared Stage vocabulary, taken from the phase map in `01-critical-rendering-path.md`. A grep of `- Stage:` over all notes gives these counts. An item can carry several tags, so the counts overlap.

| # | Stage (reference file) | Notes Stage tags that map here | Tagged items | Pass |
|---|---|---|---|---|
| 01 | Network | `network` | 257 | load, next navigation |
| 02 | Parse and discovery | `html-parse`, `preload-scan` | 63 + 59 | load |
| 03 | CSSOM and fonts | `cssom` (+ font items) | 50 | load |
| 04 | Script load | `script-compile`, `startup` (JS) | 38 + 7 | load |
| 05 | Tasks and scheduling | `main-thread-task`, `microtask`, `idle` | 163 + 11 + 28 | frame |
| 06 | JS execution | `script-run` (hot paths) | 132 | frame |
| 07 | Style and layout | `style`, `layout` | 104 + 119 | load + frame |
| 08 | Paint and raster | `paint`, `raster` (incl. image decode, Canvas 2D draw) | 96 + 39 | load + frame |
| 09 | Composite and animation | `composite` | 66 | frame |
| 10 | Canvas and GPU setup | `gpu-draw` items whose When is `load` (context, device, backing store, shader compile), `startup` (GPU) | ~35 | load |
| 11 | GPU upload | `gpu-upload` | 54 | load + frame |
| 12 | GPU draw | `gpu-draw` (per frame) | ~62 | frame |
| 13 | Memory and lifecycle | `gc-memory`, `memory` | 80 + 4 | session |

The skill shows three passes:

- **Load pass.** The stages run in order: 01 → 02 → 03 → 04 → 07 → 08 → 09. Then 10 → 11 → 12 for each canvas.
- **Frame pass** (each rendering opportunity after load). Input arrives. Then 05 → 06 → rAF → 07 → 08 → 09 → 11/12 → present.
- **Session.** Stage 13 grows over hours. The trading terminal stays open all day, so this stage matters more than it does on a content site.

### 1.2 Placement rule (one home for each rule)

> A rule lives at the stage where its saving shows in a trace. If the saving shows at two stages, the rule lives at the earlier stage. The other stages get a pointer in the rule's `also` tag and in their table of contents. They do not get a second copy.

Examples of how the rule decides:

| Rule subject | Where the saving shows | Home |
|---|---|---|
| No `loading="lazy"` on the LCP image | The request starts late (LCP "resource load delay") | 02 PARSE |
| `fetchpriority="high"` on the LCP image | Priority and bandwidth competition ("resource load duration") | 01 NET |
| `width`/`height` on `<img>` | Layout shift | 07 LAYOUT |
| `img.decode()` before insert | Decode in raster | 08 PAINT |
| `will-change` just in time | Layer count and memory | 09 COMP |
| No float32 Unix-millisecond timestamps | Data format at upload | 11 GPUUP |
| One `appendRange` per frame into SciChart | Main-thread task time | scichart.md, section "05 Tasks" |
| One `AbortController` for each owner | Retained memory | 13 MEM |

### 1.3 Secondary tags (one grep-able line under each rule title)

```
tags: <layers> · <metrics> · <when> · impact <high|medium|low> · also <STAGE,...>
```

- **layers:** `html`, `css`, `js`, `v8`, `canvas2d`, `webgl`, `webgpu`, `shader`, `wasm`, `http`, `build`, `scichart`
- **metrics:** `TTFB`, `FCP`, `LCP`, `INP`, `CLS`, `FPS` (frame time), `memory`, `bundle`
- **when:** `load`, `interaction`, `render-loop`, `session`
- **also:** other stage prefixes

The tag line gives the user's own categories as grep views over the same rules, with no second copy (section 1.5).

### 1.4 Why this axis

1. **The user asked for it.** The user's first category is "the critical rendering path phases (from first HTML bytes to paint) and what code affects each". A stage axis is that category, applied to every rule.
2. **Most of the classification work is done.** About 650 note items (plus the notes still in progress) already carry Stage tags from the same vocabulary. Most of the work is mechanical, so the result is consistent.
3. **One axis serves all three output modes.**
   - DevTools trace events and insights map 1:1 to stages. For example, "Recalculate style" and `SlowCSSSelector` map to stage 07, and `LCPDiscovery` maps to stage 02.
   - So the rule file that tells Claude how to write code is also the file that says what to look for in a trace.
   - The review report that the user asked for is "grouped by pipeline stage", so it falls out directly.
4. **A stage explains why.** skill-creator prefers mechanisms to MUSTs. Each stage file opens with a short "stage card": what runs, on which thread, what blocks it, and how it shows in a trace. That teaches the mechanism once, and every rule in the file relies on it.
5. **The axis is stable.** The browser pipeline changes slowly. APIs, frameworks and metrics change faster. Metric-first skills needed rewrites for FID → INP and TTI. Stage files do not.
6. **GPU chart work fits at the end of the same pipeline.** The stages are setup, then upload, then draw. This mirrors compile → data → run on the CPU side. The user's chart path (SciChart on WebGL now, WebGPU soon) sits at stages 10–12, and the DOM rules stay out of that path.

### 1.5 The user's categories on this axis (crosswalk)

| User category | Where it lives | Category view without duplication |
|---|---|---|
| Critical rendering path phases and the code that affects each | `pipeline-map.md` (full phase tables) + the stage card at the top of each file 01–13 | Read `pipeline-map.md` |
| HTML directives that load early or lazily | 02 (script attributes, discovery, preload, lazy) + 01 (priority, hints, speculation rules) | `grep -n '^tags:.*\bhtml\b' references/0[1-4]-*.md` |
| CSS (GPU, layers, `will-change`, `contain`) | 03 (delivery), 07 (containment, selectors), 08 (paint cost), 09 (layers, animations) | `grep -n '^tags:.*\bcss\b' references/*.md` |
| JS (event loop, micro/macro tasks, rAF, rIC, Web APIs) | 05 (+ 13 lifecycle APIs, 01 network APIs) | `grep -n '^tags:.*\bjs\b' references/05-*.md references/13-*.md` |
| Micro-optimizations (V8 blog) | 06 (+ 04 for startup: code cache, compile hints) | `grep -n '^tags:.*\bv8\b' references/*.md` |
| GPU (WebGL/WebGPU textures, shaders, data types) | 10 setup, 11 upload (data types, textures), 12 draw (shaders, draw calls) | `grep -nE '^tags:.*\b(webgl\|webgpu\|shader)\b' references/*.md` |
| Chrome DevTools MCP and WebMCP | `measure.md` + `scripts/` + `assets/perf-scenario-hook.ts` | none needed |

---

## 2. Directory tree

```
~/.claude/skills/web-performance/
├── SKILL.md                               ~285 lines (hard cap 18,000 chars ≈ 4,500 tokens)
├── references/
│   ├── pipeline-map.md                    ~170   full phase maps, threads, trace names → stage
│   ├── 01-network.md                      ~300   NET     24 rules
│   ├── 02-parse-and-discovery.md          ~280   PARSE   21 rules
│   ├── 03-cssom-and-fonts.md              ~200   CSSOM   14 rules
│   ├── 04-script-load.md                  ~220   JSLOAD  16 rules
│   ├── 05-tasks-and-scheduling.md         ~330   TASK    26 rules
│   ├── 06-js-execution.md                 ~250   JSRUN   19 rules
│   ├── 07-style-and-layout.md             ~300   STYLE 6 + LAYOUT 18 rules
│   ├── 08-paint-and-raster.md             ~300   PAINT   23 rules
│   ├── 09-composite-and-animation.md      ~260   COMP    19 rules
│   ├── 10-canvas-and-gpu-setup.md         ~250   GPUSET  18 rules
│   ├── 11-gpu-upload.md                   ~300   GPUUP   22 rules
│   ├── 12-gpu-draw.md                     ~340   GPUDRAW 26 rules + WebGL→WebGPU table
│   ├── 13-memory-and-lifecycle.md         ~280   MEM     20 rules
│   ├── scichart.md                        ~300   SC      22 rules, sections by stage
│   ├── measure.md                         ~280   output mode 3 + field RUM + WebMCP
│   ├── review.md                          ~130   output mode 2 procedure + report template
│   └── support.md                         ~220   version-sensitive facts, dated, one place
├── scripts/
│   ├── frame-sampler.js                   ~70    rAF cadence stats (p50/p95/p99, max gap, long frames)
│   ├── loaf-collector.js                  ~50    Long Animation Frames + script attribution (Chrome)
│   └── event-timing-collector.js          ~50    interactions split into input delay / processing / presentation
├── assets/
│   └── perf-scenario-hook.ts              ~70    dev-only scenario hook: WebMCP tool + window fallback
└── evals/
    ├── evals.json                         ~90    4 task evals with assertions (skill-creator format)
    └── trigger-queries.json               ~60    10 should-trigger + 10 near-miss queries
```

Totals: about 5,300 lines on disk, and about 294 rules (sum of the counts above). Claude loads a small slice for each task:

- A small edit loads SKILL.md only.
- A typical component loads SKILL.md plus 1–2 stage files (≤ 11,000 tokens).
- A GPU renderer loads SKILL.md plus files 10, 11 and 12 (≈ 17,000 tokens).

| File | Purpose |
|---|---|
| `SKILL.md` | Trigger, the pipeline at a glance, budgets, always-on rules, routing, the three output modes, honesty rules. |
| `pipeline-map.md` | Mechanism reference. It holds the initial-load table (12 phases) and the update-frame table (spec order), threads, DevTools event names and insight names for each stage, LCP subparts and INP phases mapped to stages, and a glossary of stage tags. Open it for reviews, measurement, or when you are unsure where a cost lands. |
| `01`–`13` | One file for each stage. Each file has a stage card, a table of contents, the rules, and an "Also consider" tail of one-line rules that were demoted. |
| `scichart.md` | SciChart.js v5 rules, sectioned by the same stages. The source-of-truth order is: installed typings, then docs, then memory. |
| `measure.md` | The Chrome DevTools MCP workflows (load, interaction/frame, memory), the compare and verdict rules, the insight → stage map, field RUM, and WebMCP scenario hooks. |
| `review.md` | The review procedure and the report template, grouped by stage. |
| `support.md` | Browser support, Baseline tiers, deprecations, facts that other skills get wrong, disputed facts, and how to re-verify. All of it is dated. |
| `scripts/*.js` | Fixed measurement code for `evaluate_script`. Each script installs a collector with `start()`/`stop()` that returns JSON. Using fixed scripts, not scripts written on the fly, makes runs repeatable (Chrome DevTools MCP issue #1114 and the nucliweb skills). |
| `assets/perf-scenario-hook.ts` | A template that Claude copies into a project's dev entry point only with the user's approval. It registers deterministic scenarios (stream at N msg/s, pan for T ms, load P points) as a WebMCP tool, with a `window.__perfScenarios` fallback. |
| `evals/*` | Used by skill-creator only. Never loaded at run time. |

---

## 3. Frontmatter (exact)

```yaml
---
name: web-performance
description: >-
  Rendering-pipeline performance rules for frontend code. Use whenever you
  write, change or review HTML, CSS, JS/TS, Svelte or other UI components,
  event handlers, animations, canvas, WebGL/WebGPU, shaders, workers, or
  SciChart.js chart code, even if the user never says "performance": it
  places each choice at its pipeline stage (network, parse, CSSOM, script,
  tasks, style, layout, paint, composite, GPU, memory), picks the cheaper
  pattern, and names the trade-off. Also use it to write a performance
  review report grouped by stage, and to measure a change with Chrome
  DevTools MCP (baseline trace, change, re-trace, compare) before calling
  it faster.
when_to_use: >-
  Examples: "add a crosshair tooltip to the chart", "stream trades into the
  candles", "render 1M points", "add price labels to the drawing tool",
  "this panel janks on scroll", "why is INP/LCP/CLS bad", "the tab uses
  2 GB after a day", "review OrderBook.svelte for performance", "is it
  faster now?", "trace localhost:5173". Skip for backend or Node-only code,
  CLI tools, database work, and type-only refactors with no browser runtime
  effect.
argument-hint: "[review|measure] [file, folder or URL]"
---
```

The combined `description` + `when_to_use` is 1,129 characters after YAML folding (674 + 455), under the 1,536-character listing cap (checked with Python). The key use case comes first, as the Claude Code docs ask.

Decisions:

- **No `paths`.**
  - The docs say that with `paths` set, "Claude loads the skill automatically only when working with files matching the patterns".
  - Output mode 3 ("trace localhost:5173") and design questions ("how should a 1M-point chart stream?") often touch no file, so a `paths` glob would block them.
  - A frontend glob (`*.ts`) also matches backend TypeScript, so `paths` would add little precision.
  - Recall wins here. The description does the scoping instead.
- **No `context: fork`.** Write-time rules must be in the main context, where Claude writes the code.
- **`argument-hint`** enables manual `/web-performance review src/lib/OrderBook.svelte` and `/web-performance measure http://localhost:5173`. SKILL.md reads `ARGUMENTS:` (Claude Code appends it when no placeholder is used) and uses it to pick the mode.
- **No `allowed-tools`.** Tool grants clear after one message anyway, and MCP permission prompts are the user's control.

---

## 4. SKILL.md outline

**Budget.** SKILL.md has at most 18,000 characters (about 4,500 tokens). Why: after auto-compaction, Claude Code "re-attaches the most recent invocation of each skill after the summary, keeping the first 5,000 tokens of each" (Claude Code skills doc). If SKILL.md stays under that budget, all of it survives compaction. The most-used parts come first, in case a long session drops the tail.

Claude Code also "does not re-read the skill file on later turns". So every section is a standing instruction, not a one-time step.

| # | Heading | Contents | Lines |
|---|---|---|---|
| 0 | frontmatter | Section 3 | 20 |
| 1 | `# Web performance` | One paragraph: rules are organized by the stage where the cost lands. Table of the three modes: mode, when, output, where to read more. | 10 |
| 2 | `## How to use this skill` | Steps 1–5, listed below this table. | 14 |
| 3 | `## The pipeline on one screen` | The 13-row stage table (below), the three passes in one line each, and the placement rule in one line. | 30 |
| 4 | `## Budgets` | Frame budgets, task limit, metric thresholds, and the work-size rule. Listed below. | 12 |
| 5 | `## Always-on rules` | About 30 one-line rules with IDs, grouped by stage (drafted below). Then one paragraph on first-draft mistakes. | 55 |
| 6 | `## Where to read more` | Routing tables A (what you are writing), B (symptom) and C (category views), drafted below. | 50 |
| 7 | `## Mode 1: while you write code` | Apply the rules. After the code, add `Performance notes`. The format is below. | 18 |
| 8 | `## Mode 2: performance review` | Steps in 6 lines. Open `references/review.md` for the template. Be conservative: report fewer, stronger findings, and say nothing rather than nitpick. | 10 |
| 9 | `## Mode 3: measure before you claim` | The 7-step loop in short form. Open `references/measure.md`. The verdict rule. | 16 |
| 10 | `## Browser support and library facts` | Never state browser versions from memory: read `support.md` (checked 2026-09-22). Baseline policy. Library facts come from the installed package: read `package.json` and the `.d.ts` typings. An API that is not in the typings does not exist. | 12 |
| 11 | `## Honest claims` | Static findings are hypotheses. Words that need a measurement: "faster", "60 fps", "smooth", "GPU-accelerated", "no layout". One change per measurement. A neutral change is reverted. Correctness comes before performance. | 10 |

Total: about 257 lines, with margin up to 285.

Section 2, "How to use this skill", has five steps:

1. Read the code you will change, and the installed versions of the libraries it uses. Only then apply this skill. Vercel's evals showed that "explore, then consult" beats "consult first".
2. Name the stages the code touches (routing table A).
3. For small edits (about 30 lines or less), the always-on rules are enough. For hot paths, render loops, streaming or GPU code, open the stage files and read the stage card and the table of contents. Then read only the rules you need.
4. If `ARGUMENTS:` starts with `review` or `measure`, use that mode.
5. These are standing instructions for the whole session.

Section 4, "Budgets", holds these numbers:

- A 60 Hz frame is 16.7 ms, of which about 10 ms is for app work. A 120 Hz frame is 8.3 ms.
- A task takes 50 ms or less.
- INP ≤ 200 ms, LCP ≤ 2.5 s and CLS ≤ 0.1, all at p75.
- Work-size rule: under 50 ms, run it inline. From 50 to 250 ms, slice it and yield. Over 250 ms, use a worker (Modern Web Guidance).
- For long sessions, memory must not grow with each repeated operation.

### 4.1 The stage table in SKILL.md (exact content)

| # | Stage | Read | What costs time here | How it shows in a trace |
|---|---|---|---|---|
| 01 | Network | `01-network.md` | connections, bytes, priority, caching, next navigation | Network track; `DocumentLatency` |
| 02 | Parse and discovery | `02-parse-and-discovery.md` | HTML parser, preload scanner, script attributes, lazy loading | "Parse HTML"; `LCPDiscovery`, `RenderBlocking` |
| 03 | CSSOM and fonts | `03-cssom-and-fonts.md` | render-blocking CSS, font loading and swap | `RenderBlocking`, `FontDisplay` |
| 04 | Script load | `04-script-load.md` | download, compile, evaluate startup JS and Wasm | "Compile script", "Evaluate script" |
| 05 | Tasks and scheduling | `05-tasks-and-scheduling.md` | event loop, input handlers, rAF, timers, workers | long tasks, `INPBreakdown`, LoAF |
| 06 | JS execution | `06-js-execution.md` | hot-path JS in V8: shapes, arrays, allocation, builtins | Bottom-up self time, "Minor GC" |
| 07 | Style and layout | `07-style-and-layout.md` | selector matching, layout, forced reflow, layout shifts | "Recalculate style", "Layout"; `ForcedReflow`, `CLSCulprits`, `DOMSize` |
| 08 | Paint and raster | `08-paint-and-raster.md` | paint records, raster, image decode, Canvas 2D drawing | "Paint", "Rasterize paint", "Image decode" |
| 09 | Composite and animation | `09-composite-and-animation.md` | layers, compositor-only animation | "Layerize", "Commit", Animations track |
| 10 | Canvas and GPU setup | `10-canvas-and-gpu-setup.md` | context/device, backing-store size, shader and pipeline compile | first-frame hitch, GPU track |
| 11 | GPU upload | `11-gpu-upload.md` | buffers, textures, data formats, text-to-texture | frame spikes when data changes |
| 12 | GPU draw | `12-gpu-draw.md` | draw calls, state, passes, readback | GPU track, frame time |
| 13 | Memory and lifecycle | `13-memory-and-lifecycle.md` | GC, leaks, teardown, hidden or off-screen work | heap snapshots, "Major GC" |

Two more lines follow the table:

- **SciChart.js:** `scichart.md`, sectioned by the same stages.
- **Unsure where a cost lands:** `pipeline-map.md`.

### 4.2 Always-on rules (draft; about 30 lines with 1–2 lines each)

Each line is a summary and a pointer. The rule in the reference file is the single source of truth. A build check confirms that every ID here exists in the references (section 9).

- **Load**
  - PARSE-06: App scripts use `type="module"` or `defer`. Use `async` only for scripts that nothing depends on. Why: a classic `<script>` in `<head>` stops the parser, and it also waits for pending CSS.
  - PARSE-11 + NET-08:
    - The LCP image is a plain `<img>` in the server HTML, with `fetchpriority="high"`.
    - Never put `loading="lazy"` on it.
    - Lazy-load only below-the-fold images and iframes.
  - CSSOM-02: No CSS `@import`. Link each sheet with `<link>`.
  - JSLOAD-01: Load features that are not on the first view (dialogs, rare tools, off-screen chart libraries) with `import()`.
  - LAYOUT-12: Reserve space. Put `width`/`height` or `aspect-ratio` on media and canvases. Late content goes into pre-sized slots, never above the content that the user is reading.
- **Tasks**
  - TASK-06: Coalesce `pointermove`, `wheel`, scroll and data ticks. Keep only the latest value, and apply it in one rAF.
  - TASK-07: Keep high-frequency values out of reactive framework state. These are pointer position, last price and scroll offset. Write them to a canvas or a `transform`.
  - TASK-04: In input handlers, paint the visible response first, then yield before heavy work. Call `preventDefault()` before any `await`.
  - TASK-12/13/14: Yield on a 50 ms deadline with `scheduler.yield()`, with a `setTimeout` fallback. `await Promise.resolve()` does not yield.
  - TASK-05: Touch and wheel listeners are passive. The exception is a chart surface that must call `preventDefault` for zoom and pan. That surface declares `touch-action`, and the code says why.
  - TASK-20: Render on demand. No rAF loop runs when nothing changed. Motion uses the rAF timestamp, not an assumed 16.7 ms.
- **JS execution**
  - JSRUN-04/05/09: Give each kind of hot object one shape. The constructor sets every field, and an empty number is `NaN`, not `null`. Keep numeric series in `Float64Array`.
  - JSRUN-12/15: No allocations in per-frame or per-tick code. Reuse arrays, objects and `Intl.NumberFormat` instances.
- **Style and layout**
  - LAYOUT-01/03: Read layout before you write styles. Never call `getBoundingClientRect()` or read `offsetX` for each pointer event. Cache the rect from `ResizeObserver` and from scroll events.
  - LAYOUT-05: Put `contain: strict` and a size on chart panes, and `contain: content` on rows and tiles. Put `content-visibility: auto` and `contain-intrinsic-size` on off-screen panels.
  - STYLE-03: Do not style lists that change often with `:nth-child()` or sibling combinators. Toggle state on the smallest element that needs it.
- **Paint and composite**
  - COMP-01:
    - Animate only `transform` and `opacity`.
    - Position overlays and tooltips with `transform`, not with `left`/`top`.
  - COMP-08: Add `will-change` just before an animation and remove it after. Never put it in base CSS for many elements.
  - PAINT-02: Do not repaint `blur`, `box-shadow` or `backdrop-filter` often, and do not put `backdrop-filter` over content that changes.
  - PAINT-09/18: Canvas 2D:
    - Draw one path and one stroke for each style group.
    - Set context state once for each group.
    - Clear with `clearRect`. Never clear by assigning `width`.
- **GPU**
  - GPUSET-01/02: The backing store is CSS size × DPR, with a DPR cap. Set it only when the integer size changes, from `ResizeObserver` with `device-pixel-content-box`.
  - GPUSET-05: Choose context attributes on purpose:
    - `preserveDrawingBuffer: false`.
    - `depth: false` for 2D charts.
    - Decide `antialias` explicitly.
    - For WebGL, write opaque alpha instead of using `alpha: false`.
  - GPUUP-01: Never put Unix-millisecond timestamps in float32. Subtract a float64 origin first.
  - GPUUP-05: Allocate GPU buffers once with headroom. Update sub-ranges, and stream into a ring region.
  - GPUUP-18: Rasterize and upload label text only when the string changes. Use an atlas and dirty sub-rectangles.
  - GPUDRAW-03/23: Keep these out of the frame loop: GPU object creation, shader compiles, `readPixels`, `getError()` and synchronous readback.
  - GPUDRAW-06: Draw repeated marks (candles, bars, markers) with instancing, and batch by state.
- **Memory**
  - MEM-01:
    - Tie every listener, timer, observer, subscription and rAF to one `AbortController` for its owner.
    - Call `delete()` or `destroy()` on every GPU, Wasm and SciChart object.
  - MEM-10: Stop rendering hidden views (`visibilitychange`) and off-screen views (`content-visibility`, IntersectionObserver, SciChart `freezeWhenOutOfView`).
  - MEM-14: Handle `webglcontextlost` and `device.lost`. Keep the data that you need to rebuild.
- **SciChart**
  - SC-04: Flush streamed data once per frame with `appendRange`. Use `fifoCapacity` for scrolling windows. Set the sort and NaN flags when you create the series.
  - SC-20: Create one surface for each mount. On destroy, call `delete()` on the surface and on its data series.

After the list, SKILL.md has one paragraph on first-draft mistakes (from the Mapbox skill and LogRocket):

- Happy-path-only render code: no error path, no teardown, and test data that is too small (10 points instead of 1M).
- A new dependency where a platform API exists.
- `setTimeout` to sync an animation.
- A synchronous filter over a large list.
- Replacing the whole dataset on each tick.

### 4.3 Routing tables (exact content for SKILL.md section 6)

**A. What are you writing?** Open these files, in this order:

| You write or change | Open | Why these stages |
|---|---|---|
| `<head>`, `index.html`, SSR template, preload or preconnect | 02, 01, 03 | discovery, priority, render-blocking CSS |
| `<img>`, `<video>`, icons, web fonts | 02, 01, 07 (+ 03 for fonts) | discovery and lazy loading, bytes and priority, reserved space |
| Stylesheet, selectors, theme variables | 07, 03 | style scope, delivery |
| CSS or WAAPI animation, transition, hover effect | 09, 08 | compositor-only animation, paint cost |
| Event handler; pointer, wheel, scroll or drag logic | 05, 07 | input delay and scheduling, forced layout |
| Long list, table, order book, watchlist | 07, 05 | DOM size, containment, virtualization, update batching |
| Streaming data or WebSocket/SSE feed into the UI | 05, 01, 06 (+ scichart) | one flush per frame, backpressure, hot-path JS |
| Data code: indicators, aggregation, parsing | 06, 05 | V8 hot paths, worker offload |
| Canvas 2D overlay, labels, hit testing | 08, 10 | 2D drawing, canvas sizing |
| WebGL/WebGPU renderer, shader, buffer, texture | 10, 11, 12 | setup, upload, draw |
| Drawings or annotations with text on a GPU chart | 11, 08, 12 | text-to-texture, canvas text, draw |
| SciChart surface, series, modifiers, annotations | `scichart.md`, then the stage file that the SciChart rule names | framework rules, with a stage for each rule |
| Component mount/unmount, subscriptions, long-lived views | 13 | ownership, teardown |
| Worker, Wasm, OffscreenCanvas | 05, 04, 10 | messaging, loading, rendering off the main thread |
| Bundler or code-split config, dynamic imports | 04 | ship less, compile less |
| Service worker, HTTP caching, prefetch, navigation | 01 | network |

**B. What is the symptom?** Start with the first stage:

| Symptom or metric part | First | Then |
|---|---|---|
| LCP: TTFB is high | 01 | — |
| LCP: resource load delay | 02 | 01 |
| LCP: resource load duration | 01 | — |
| LCP: element render delay | 03, 04 | 07 |
| INP: input delay | 05 (long tasks), 04 (startup work) | 06 |
| INP: processing duration | 05, 06 | 07 |
| INP: presentation delay | 07, 08, 09 | 05 |
| CLS | 07 | 03 (font swap) |
| Jank while panning, zooming or streaming a chart | 05 | 12, 11, 08, scichart |
| Jank in a CSS animation or in scrolling | 09 | 08, 07 |
| Slow first chart render | 04 (Wasm, chunk) | 10, 11 |
| Memory grows over hours | 13 | 11 (buffers), scichart |
| Slow or heavy when the tab comes back | 13 | 01 (bfcache) |

**C. The user's categories as views.** This table holds the grep commands from section 1.5, with `${CLAUDE_SKILL_DIR}` in each path, so Claude can list every HTML directive, CSS rule, V8 rule or GPU rule across the stage files.

### 4.4 Mode 1 output format (exact content for SKILL.md section 7)

After the code, add at most 4 bullets. Name only the choices that are not the default. Use the format "stage (rule): choice; trade-off". Label a claim as measured only if it was measured.

```
Performance notes
- Tasks (TASK-06): pointer moves are coalesced into one rAF; trade-off: the crosshair can lag input by up to one frame.
- Layout (LAYOUT-03): the pane rect is cached from ResizeObserver and scroll; trade-off: refresh it if the pane moves without a resize.
- GPU upload (GPUUP-18): the label texture is rebuilt only when the formatted price changes. Not measured.
```

Scope limits (from the ibelick skill): do not migrate libraries or add dependencies for performance unless the user asks. Apply the rules inside the existing stack. Performance is a pass after correctness.

---

## 5. Reference files

### 5.1 Common structure of a stage file

```
# NN · <Stage name>
> Stage card (≤ 15 lines): what runs; thread; what blocks it; how it shows in a trace
>   (event names + insights); metrics it feeds; budget; common wrong beliefs.
## Contents              ← ID · title · impact, grouped by section (first ~35 lines)
## A. <section> … ## F. <section>
### <ID> · <imperative title>
tags: …
- Do / Why / Code / Detect / Verify / Limits / Support / Sources
## Pointers              ← rules from other stages that people look for here
## Also consider         ← demoted one-line rules (no code), each with a source
```

Every file over 100 lines has a table of contents. Anthropic's skill best practices ask for a TOC on reference files over 100 lines, which is stricter than the 300 lines that skill-creator asks for. The TOC comes first, so Claude can read the head of a file and then jump to a rule.

### 5.2 Each reference file

In this section, "01-CRP" means `01-critical-rendering-path.md` (plus `run2-new`), and "verify" means the `verify/` reports. Section letters refer to the notes' own headings.

**`pipeline-map.md`** (~170 lines)

- Scope: the mechanism, and only the mechanism. Rules live elsewhere.
- Fed by:
  - 01-CRP phase map (a) and (b), corrected by verify: paint holding is now "FCP or 500 ms", and cross-origin since 2021.
  - `raw/how_cc_works.md`.
  - The event names in `raw/TimelineUIUtils.ts` and `raw/Styles.ts`.
  - 14-devtools-mcp notes (insight names).
- Contents:
  1. Threads and processes.
  2. Initial load: 12 phases.
  3. Update frame in spec order.
  4. DevTools event name → stage.
  5. Insight → stage.
  6. LCP subparts and INP phases → stages.
  7. Stage-tag glossary.

**`01-network.md`** (NET, ~300 lines, 24 rules)

- Scope: how fast a known request finishes, and the next navigation. Discovery (when a request starts) belongs to 02.
- Fed by:
  - 01-CRP "Navigation and TTFB".
  - 02-course-loading (HTML considerations, resource hints, image bytes).
  - 03-course-js-and-vitals C, F, I.
  - 04-html-http B (preconnect, dns-prefetch), C, F, G, H.
  - 07-js-web-apis B, E, I.
  - 17-collections batches 1–3 (reliable: SW strategies, HTTP cache).
  - 16-explore-fast batches (third parties, delivery).
  - verify corrections (bfcache and `no-store`, speculation eagerness).
- Contents:
  - A. Document and TTFB, NET-01..05: stream and flush the head; no redirects; compression; 103 Early Hints; Server-Timing; hashed immutable assets with revalidated HTML.
  - B. Connections and priority, NET-06..10: preconnect ≤ 2 with `crossorigin`; `dns-prefetch` for the rest; `fetchpriority` on the LCP image and low priority on hidden images; `fetch(…, {priority})` for background data; `fetchpriority` on scripts instead of preload hacks.
  - C. Bytes, NET-11..14: right-sized images with `srcset`/`sizes` and a cap of about 2x; AVIF/WebP through `<picture>`; zstd/Brotli and dictionaries; Save-Data and device class.
  - D. Next navigation, NET-15..18: speculation rules; side effects that are safe under prerender; bfcache eligibility (`pagehide`/`pageshow`); no `unload` (use `fetchLater`/`sendBeacon`).
  - E. Service worker, NET-19..20: static routes and navigation preload, no no-op fetch handler; bounded caches and no opaque responses.
  - F. Live data, NET-21..24: choose SSE or WebSocket by direction; heartbeats and capped backoff; backpressure and abort of superseded requests; streams for large responses.

**`02-parse-and-discovery.md`** (PARSE, ~280 lines, 21 rules)

- Scope: when the parser is blocked, and how early each resource is known.
- Fed by:
  - 01-CRP (HTML parse and head; preload scanner; scripts).
  - 02-course-loading (critical path; resource loading; lazy loading).
  - 03-course B, E.
  - 04-html-http A, B (preload, modulepreload), D.
  - 12-canvas2d (none).
  - verify corrections.
- Contents:
  - A. Head order, PARSE-01..05: charset in the first 1024 bytes; viewport; tiny inline scripts above the stylesheets; a lean head; no `document.write`.
  - B. Script attributes, PARSE-06..09: `defer`/`module` by default; `async` only for independent scripts; no injected startup scripts; `blocking="render"` only for a known flash.
  - C. Discovery, PARSE-10..15: critical resources as markup; the LCP image as an `<img>` in server HTML; preload only resources discovered late, with `as` and `crossorigin`; responsive preload with `imagesrcset`; `modulepreload`; no large inline blobs.
  - D. Lazy loading, PARSE-16..19: native lazy loading below the fold only; facades for embeds; `sizes="auto"`; video `preload="none"`/`"metadata"` with a poster.
  - E. Server HTML, PARSE-20..21: server-render the first view; declarative shadow DOM and out-of-order streaming as progressive enhancement.

**`03-cssom-and-fonts.md`** (CSSOM, ~200 lines, 14 rules)

- Scope: CSS that blocks the first render, and font loading and swap.
- Fed by:
  - 01-CRP (CSSOM; fonts).
  - 02-course (CSS sections; web fonts module).
  - 04-html-http E.
  - 05-css G, H.
  - 12-canvas2d (fonts in workers: pointer only).
- Contents:
  - A. Render-blocking CSS, CSSOM-01..07: remove unused CSS and split it by route; `@import` → `<link>`; inline critical CSS with a CSP-safe async rest (no inline `onload`); a `media` attribute on conditional sheets; body-level sheets for sections.
  - B. Fonts, CSSOM-08..14: `@font-face` that the parser can discover; preload 1–2 fonts with `crossorigin` and no `fetchpriority`; WOFF2 only; subsets with `unicode-range`; `font-display` by role; a metric-matched fallback (`size-adjust` from the real font pair); fewer files (`system-ui`, variable fonts).

**`04-script-load.md`** (JSLOAD, ~220 lines, 16 rules)

- Scope: download, compile and evaluate of startup JS and Wasm.
- Fed by:
  - 01-CRP scripts.
  - 02-course (minify).
  - 03-course A.
  - `09-v8-consolidated` (cost of JS, code caching, compile hints, lazy parsing, module bundling).
  - 04-html-http I (native HTML instead of JS libraries).
  - 07-js-web-apis J (Wasm loading).
  - 16-explore-fast (third parties, JS).
- Contents:
  - A. Ship less, JSLOAD-01..06: `import()`; chunks of about 100 KB; bundle deep module graphs; modern output with no ES5, `nomodule` or promise polyfills; native `popover`, `<dialog>`, anchor positioning instead of libraries; third-party facades.
  - B. Compile and evaluate, JSLOAD-07..11: split evaluation into tasks; stable external URLs for the code cache; compile hints only for a small core file; `JSON.parse` for big literals; do not client-render the LCP element.
  - C. Wasm and workers at startup, JSLOAD-12..15: `instantiateStreaming` with a stable URL; create workers once; module workers with `new URL(…, import.meta.url)`.
  - D. Find candidates, JSLOAD-16: the Coverage panel.

**`05-tasks-and-scheduling.md`** (TASK, ~330 lines, 26 rules)

- Scope: the event loop and everything that decides when main-thread work runs, including INP input delay and processing.
- Fed by:
  - 06-js-event-loop A–K (main source).
  - 03-course H.
  - 01-CRP update-frame items.
  - 07-js-web-apis A, K.
  - 17-collections index (INP collection).
  - survey rules 3, 12, 13, 14 and web rules 3, 4.
- Contents:
  - A. Frame model, TASK-01..03: task, microtask and rendering slot table; tasks ≤ 50 ms; no frame between small tasks.
  - B. Input, TASK-04..11: 04 feedback first, then yield, with `preventDefault` before `await`; 05 passive listeners and `touch-action`; 06 coalesce to one rAF (coalesced and predicted events only for drawing, in Limits); 07 high-frequency values out of reactive state; 08 cancel superseded work; 09 debounce only non-visual work, and `scrollend`; 10 delegation for large collections; 11 logging and analytics off the input path.
  - C. Yield, TASK-12..17: 12 `scheduler.yield()` with a fallback; 13 a 50 ms deadline; 14 never yield with a promise; 15 `postTask` priorities and abort; 16 `requestIdleCallback` with a timeout and a Safari fallback; 17 `MessageChannel` instead of the `setTimeout` clamp. `isInputPending()` goes to support.md "Do not use".
  - D. rAF, TASK-18..21: 18 visual writes in rAF; 19 timestamp-driven motion; 20 render on demand; 21 "after the next paint" = rAF, then a task.
  - E. Off the main thread, TASK-22..26: 22 the work-size rule; 23 a long-lived module worker; 24 transfer ArrayBuffers and send small deltas; 25 SharedArrayBuffer only under isolation; 26 one feed connection for each browser (SharedWorker, or Web Locks with BroadcastChannel).

**`06-js-execution.md`** (JSRUN, ~250 lines, 19 rules)

- Scope: hot-path JavaScript in V8. Apply only to code that runs per frame, per tick or per item, or that a profile shows as hot.
- Fed by:
  - `09-v8-consolidated` (merge of `08-v8-batch-*`; the draft rules in `08-v8-index` §8).
  - 07-js-web-apis (structuredClone, DataView, Wasm boundary).
  - survey rules (Set/Map, single-pass min/max, RegExp hoisting). Leave out the "cache property access" and "length check" micro-rules that modern JITs make no-ops.
- Contents:
  - A. Algorithm first, JSRUN-01..03: binary search on sorted time; single pass; Set/Map.
  - B. Shapes and inline caches, JSRUN-04..07: 04 the constructor sets every field in the same order; 05 `NaN`, not `null`, for empty numeric fields; 06 no `delete` and no late fields; 07 no prototype mutation.
  - C. Arrays and numbers, JSRUN-08..11: packed arrays of one kind; `Float64Array`; `DataView`; BigInt out of hot loops.
  - D. Allocation, JSRUN-12..14.
  - E. Builtins, JSRUN-15..18: reuse `Intl` formatters; the JSON fast path; RegExp; `toSorted` and `structuredClone` allocate.
  - F. Wasm boundary, JSRUN-19.

**`07-style-and-layout.md`** (STYLE and LAYOUT, ~300 lines, 24 rules)

- Scope: selector matching and invalidation, layout, forced reflow, layout stability.
- Fed by:
  - 05-css C, D, E, H (scrollbar gutter), I.
  - 01-CRP "Style and layout".
  - 03-course G, H.
  - 06-js-event-loop H.
  - 04-html-http D (width and height).
  - verify.
- Contents:
  - A. Style scope, STYLE-01..06: simple selectors checked with Selector Stats; the smallest element; no `:nth-child()` on lists that change; `:has()` anchored to a narrow container; fast custom properties off `:root` with `inherits: false`; `text-wrap: balance` only on short text.
  - B. Forced layout, LAYOUT-01..04.
  - C. Containment, LAYOUT-05..08: `contain`; `content-visibility: auto`; `content-visibility: hidden` for views that come back; container queries.
  - D. DOM size, LAYOUT-09..11: small DOM; virtualization; build in chunks.
  - E. Stability, LAYOUT-12..16.
  - F. Observers, LAYOUT-17..18.

**`08-paint-and-raster.md`** (PAINT, ~300 lines, 22 rules)

- Scope: paint cost of CSS, image decode, and Canvas 2D drawing (the page's own paint).
- Fed by:
  - 05-css F.
  - 01-CRP "Paint, layers".
  - 02-course (decode).
  - 04-html-http D (decoding).
  - `12-canvas2d-and-images` A (flags go to 10), B, C, E.
  - survey canvas rules (OpenAI).
- Contents:
  - A. CSS paint, PAINT-01..05.
  - B. Image decode, PAINT-06..08.
  - C. Canvas 2D drawing, PAINT-09..19: 09 one path and one stroke for each style group, with state set once for each group; 10 constant colors with `globalAlpha`; 11 no `save`/`restore` for each item; 12 pixel snapping; 13 reuse `Path2D`; 14 no `shadowBlur` in frames; 15 sprite caches; 16 layers by update rate; 17 dirty-rect overlays; 18 `clearRect`, never a `width` reset; 19 geometric hit testing.
  - D. Canvas text, PAINT-20..23: a fixed set of `ctx.font` strings; a `measureText` cache; no DOM style writes between canvas text calls; choose the label technique by count.

**`09-composite-and-animation.md`** (COMP, ~260 lines, 19 rules)

- Scope: layers, compositor-only animation, WAAPI, scroll-driven animations, view transitions, reduced motion.
- Fed by:
  - 05-css A, B.
  - 01-CRP paint and layers.
  - 03-course G.
  - 06-js-event-loop D.
  - 17-collections batches 1–4 (animations, WAAPI).
  - survey (iart, ibelick, GSAP).
- Contents:
  - Property → stage table (which property triggers layout, paint or composite; current Blink data).
  - B. Compositor-only, COMP-01..07.
  - C. Layers, COMP-08..12.
  - D. WAAPI hygiene, COMP-13..16: `commitStyles()` then `cancel()`; `finished` instead of timers; `getAnimations()` to pause hidden panels; one animation owner, and a stop condition for each rAF loop.
  - E. Scroll and view transitions, COMP-17..18.
  - F. Reduced motion, COMP-19: also stop JS, canvas and WebGL motion.

**`10-canvas-and-gpu-setup.md`** (GPUSET, ~250 lines, 18 rules)

- Scope: everything decided once for each canvas: context or device, attributes, backing store, shader and pipeline compile, rendering off the main thread.
- Fed by:
  - 10-gpu-webgl (context attributes, sizing, pixel cap, one context for many charts, compile/link, parallel compile, OffscreenCanvas).
  - 11-gpu-webgpu A, B, C (layouts), I (canvas config).
  - 12-canvas2d A, F, G (sizing).
  - 07-js-web-apis C.
- Contents:
  - A. Backing store, GPUSET-01..04: 01 device pixels, set only on change, from `ResizeObserver`; 02 cap the pixel count and DPR; 03 budget canvas memory and clamp to per-browser limits; 04 zero-size or hidden start, and DPR changes.
  - B. Context attributes, GPUSET-05..06: 05 WebGL and WebGPU attributes (`depth`, `stencil`, `antialias`, `alpha`, `premultipliedAlpha`, `preserveDrawingBuffer`, `alphaMode`); 06 2D flags (`willReadFrequently`, `alpha: false` on opaque canvases only, `desynchronized`).
  - C. Contexts and devices, GPUSET-07..10: WebGL2 first; one context or device for many panes; WebGPU feature detection with a WebGL fallback; `powerPreference` and limits.
  - D. Shaders and pipelines, GPUSET-11..15: link and check once; parallel compile and warm-up; async pipelines before the first frame; reuse; `override` constants.
  - E. Off the main thread, GPUSET-16..18.

**`11-gpu-upload.md`** (GPUUP, ~300 lines, 22 rules)

- Scope: CPU → GPU data: data types and precision, buffers, textures, text-to-texture.
- Fed by:
  - 10-gpu-webgl (buffers, vertex types, float32 time, RTC origin, textures, glyph atlas, compressed textures).
  - 11-gpu-webgpu D, H.
  - 12-canvas2d D, E (ImageBitmap), C (atlases).
- Contents:
  - A. Data types, GPUUP-01..04: float32 time; relative-to-center and split doubles; the smallest vertex type that is still precise enough, and normalized types; Uint16 indices.
  - B. Buffers, GPUUP-05..10: allocate once, update sub-ranges, a ring buffer, rotate instead of orphaning, usage hints, split static from dynamic; WebGPU `writeBuffer` by default, `mappedAtCreation`, a staging ring only when measured.
  - C. Textures, GPUUP-11..14: `texStorage2D`/`texSubImage2D`; RGBA8; mipmaps only for minified textures; KTX2 for large assets.
  - D. Images and text, GPUUP-15..20: 15 ImageBitmap sources, with flip, premultiply and color options set at creation; 16 premultiplied end to end; 17 glyph atlas or per-string textures, chosen by label count; 18 rasterize and upload text only when the string changes; 19 dirty sub-rectangles into a preallocated atlas; 20 atlas pages ≤ 4096.
  - E. Upload timing, GPUUP-21..22: before the first visible frame; at frame start, before draws.

**`12-gpu-draw.md`** (GPUDRAW, ~340 lines, 26 rules)

- Scope: per-frame GPU work: submission, draw count, state, shaders, passes, readback, compute preparation, GPU timing.
- Fed by: 10-gpu-webgl (draw, state, shader, framebuffer, readback, timing) and 11-gpu-webgpu E, F, G, I (MSAA, load/store ops), J, K.
- Contents:
  - A. Submission, GPUDRAW-01..04: render on demand and coalesce ticks; one command buffer for each frame; no object creation; throttle with `onSubmittedWorkDone`.
  - B. Draw count, GPUDRAW-05..10: batch by state; instancing; thick lines as quads; multi-draw; render bundles; indirect draws.
  - C. State and bindings, GPUDRAW-11..14.
  - D. Shaders, GPUDRAW-15..18: `highp` for coordinates; per-pixel work moved to the vertex shader; `discard` and overdraw; clean WGSL.
  - E. Passes, GPUDRAW-19..21.
  - F. Readback and sync, GPUDRAW-22..24.
  - G. Compute preparation, GPUDRAW-25.
  - H. Timing, GPUDRAW-26.
  - The WebGL → WebGPU change table (from 11-gpu-webgpu). This is the one place that says what changes when the user moves the chart to WebGPU.

**`13-memory-and-lifecycle.md`** (MEM, ~280 lines, 20 rules)

- Scope: ownership and teardown, releasing native, GPU and Wasm memory, hidden and off-screen work, context and device loss, long sessions.
- Fed by:
  - 07-js-web-apis D, G.
  - 06-js-event-loop J.
  - 10-gpu-webgl (lose context, restore, VRAM budget).
  - 11-gpu-webgpu (`destroy`, `device.lost`).
  - 12-canvas2d G (release canvases, `close()`).
  - 03-course I (bfcache lifecycle: pointer to NET).
  - survey (VS Code leak audit, Chrome memory skill, tldraw disposer lesson).
- Contents:
  - A. Ownership, MEM-01..04: one `AbortSignal` for each owner; a controller for each call of a method that runs many times; once-only listeners for lifecycle events; tests that fail on leaks.
  - B. Release, MEM-05..09.
  - C. Hidden and off-screen, MEM-10..13.
  - D. Loss and recovery, MEM-14..16.
  - E. Long sessions, MEM-17..20: bounded caches; clear performance buffers; WeakRef only for optional caches; prove a leak fix by its slope.

**`scichart.md`** (SC, ~300 lines, 22 rules)

- Scope: SciChart.js v5 only. The file uses the same rule format. Its sections follow the stages, and each rule's tag line names its stage, so review reports can group SciChart findings by stage.
- Fed by:
  - `13-scichart.md` (in progress).
  - `raw/scichart/*.d.ts`: `fifoCapacity`, `capacity`, `isSorted`/`dataIsSortedInX`, `containsNaN`, `dataEvenlySpacedInX`, `appendRange`, `appendBufferRangeN`, `suspendUpdates`/`resumeUpdates`, `freezeWhenOutOfView`, `invalidateElement`, `delete()`, `create` vs `createSingle` and their Wasm contexts.
  - 10-gpu-webgl (context limits).
- Contents:
  - Front matter:
    - How to confirm the installed version (`node_modules/scichart/package.json`).
    - The source-of-truth order: installed typings, then SciChart docs, then the SciChart MCP when available, then memory.
    - Each rule carries `verified-in:` with the version, or `unverified`.
  - Sections by stage:
    - 04 Load, SC-01..03: lazy chart chunk; Wasm loading and version match; `create` (shared context) vs `createSingle`.
    - 05 Tasks, SC-04..07: one flush per frame (example rule); `suspendUpdates` around changes to several series; SciChart data out of reactive state; indicator math in a worker with transferred `Float64Array`.
    - 06 JS, SC-08: typed arrays and `appendBufferRangeN` with the flags set.
    - 07 Layout, SC-09..10: host `contain: strict` with a size; no resize storms.
    - 09 Composite, SC-11..12: DOM overlays moved with `transform`; built-in modifiers instead of per-frame DOM.
    - 11 Upload, SC-13..14: `fifoCapacity` and `capacity`; data flags.
    - 12 Draw, SC-15..19: resampling; series and annotation counts; text labels; `invalidateElement` instead of forced renders; WebGPU readiness (flagged `unverified` until the notes confirm it).
    - 13 Memory, SC-20..22: one surface for each mount with `delete()` on destroy; `freezeWhenOutOfView`; context loss and limits.

**`measure.md`** (~280 lines): see section 7.2.

**`review.md`** (~130 lines): see section 7.1.

**`support.md`** (~220 lines): see section 8.

### 5.3 Notes that are still in progress: where they go

| Notes file | Goes to | Watch for |
|---|---|---|
| `12-canvas2d-and-images.md` (now 836 lines, 47 items) | A, F → 10; B, C, E → 08; D → 11; G → 10 and 13; H (HTML-in-canvas) → support.md "disputed/experimental" only | Its "`alpha: false` only on opaque 2D canvases, never as a WebGL speed trick" conflicts with the OpenAI survey rule. The rule text must keep the 2D vs WebGL split. |
| `13-scichart.md` | `scichart.md` | Record `verified-in` versions. Replace any rule text above that the notes contradict. Mark doc claims that could not be read (the pages return 403) as `unverified`. |
| `14-devtools-mcp-and-webmcp.md` | `measure.md`, `scripts/`, `assets/`, and the insight names in `pipeline-map.md` | Exact insight names, flags (`--memoryDebugging`, `--categoryExperimentalWebmcp`), and WebMCP status. |
| `08-v8-batch-*` → `09-v8-consolidated.md` | 06 (hot paths), 04 (startup: code cache, compile hints, lazy parsing) | Remove Crankshaft-era advice. Put the Chrome-only details (`allFunctionsCalledOnLoad`, the JSON fast path version) into support.md. |
| `16-explore-fast-batch-*` | 01, 02, 03, 04 (third parties, images, fonts, budgets) | These overlap the Learn Performance course a lot. Expect mostly merges, not new rules. |
| `15-gaps-round-*` | Wherever the item's Stage tag and the placement rule send it | The critic's corrections take precedence (section 9). |

---

## 6. Rule entry format

```
### <PREFIX>-<nn> · <imperative title, ≤ 90 chars>
tags: <layers> · <metrics> · <when> · impact <high|medium|low> · also <PREFIX,...>
- Do: 1–3 imperative sentences. The action and its scope.
- Why: the mechanism in 1–2 sentences, plus at most one number with its source.
- Code: an original Wrong → Right pair, ≤ 12 lines, in trading-terminal context.
- Detect: a static signal for review mode (a regex or code shape).
- Verify: a measured signal for measure mode (trace event, insight, or script metric).
- Limits: when the rule does not apply, the trade-off, the fallback, and wrong advice that it replaces.
- Support: support.md key(s) + Baseline tier word, or "n/a". No browser versions here.
- Sources: ≤ 2 URLs, primary first.
```

Why each field:

- **Do, Detect and Verify** map to the three output modes. A rule without a Detect signal is a no-op in review mode, like the Cursor "use proper X" rules.
- **Why** follows skill-creator: explain instead of MUST.
- **Limits** carries the conflict resolutions, so a review does not repeat bad advice. Examples are "debounce scroll" and "`will-change` in base CSS".
- **Support** keeps versions in one place (section 8). The tier word (widely, newly or limited) can only move toward "widely", so a stale tier word errs on the safe side.

### 6.1 Example rule 1 (HTML/CSS, stage 07)

````markdown
### LAYOUT-05 · Contain each panel: `contain: strict` + size on chart panes, `contain: content` on rows and tiles
tags: css · INP FPS · interaction render-loop session · impact high · also PAINT
- Do: Give each region whose size comes from the page grid (chart pane, order book,
  watchlist, drawer) `contain: strict` and an explicit block size. Give repeated items
  whose content sets their height (rows, cards, tiles) `contain: content`.
- Why: Without containment, a DOM change inside a panel can invalidate layout from the
  document root. Layout containment makes the panel a layout root, and paint containment
  clips its descendants so the browser can skip them. Measured (CSS Wizardry, 2026): a
  dropdown in a drawer took 11.21 ms of layout over 4,371 nodes from `#document`; with
  `contain: strict` on the drawer it took 1.89 ms over 73 nodes.
- Code:
  ```css
  /* Wrong: a price-cell update can relayout the whole terminal */
  .chart-pane { width: 100%; }
  /* Right */
  .chart-pane { contain: strict; inline-size: 100%; block-size: 420px; }
  .book-row   { contain: content; }
  ```
- Detect: a pane, row or tile selector whose content changes often and that has no
  `contain` or `content-visibility`; `contain: strict|size` with no block size (the box
  collapses to 0 px).
- Verify: in a trace of an update inside the panel, the "Layout" event shows a layout
  root inside the panel (Layout scope "Partial"), not `#document`, and fewer "Nodes that
  need layout" than the baseline.
- Limits: `layout`/`paint` containment creates a stacking context and a containing block
  for `position: fixed` children, and it clips overflow. Tooltips and dropdowns must render
  in the top layer (`popover`, `<dialog>`) or outside the panel. Do not put it on
  page-level wrappers or small inline elements. Do not rely on the `style` keyword in older
  Safari.
- Support: `contain` → support.md#contain (Baseline widely available).
- Sources: https://csswizardry.com/2026/04/what-is-css-containment-and-how-can-i-use-it/ ;
  https://developer.mozilla.org/en-US/docs/Web/CSS/contain
````

Facts in this rule come from `05-css-rendering.md` §C and `01-critical-rendering-path.md` "Contain independent widgets". The verify report marks the latter "verified".

### 6.2 Example rule 2 (GPU/SciChart, `scichart.md`, section "05 Tasks")

````markdown
### SC-04 · Stream ticks into SciChart once per frame: buffer, then one `appendRange` into a FIFO series
tags: scichart js wasm · FPS INP · render-loop session · impact high · stage TASK · also GPUUP MEM
- Do: Push incoming messages into a plain JS buffer. Flush it once per animation frame with
  one `appendRange(xs, ys)` per data series. For a scrolling window, create the series with
  `fifoCapacity` (constructor only) instead of `append` + `removeRange`. When you create the
  series, set `isSorted`, `containsNaN` and `dataEvenlySpacedInX` to what is true of the data.
- Why: SciChart data series live in WebAssembly memory (`delete()` frees "native
  (WebAssembly) memory"), so each `append` is one JS→Wasm crossing plus change processing.
  The typings call `appendRange` faster and recommend it "for best performance on drawing
  large datasets". The surface redraws when the renderer is free (`invalidateElement`), so
  a point that arrives between two frames cannot show before the next frame anyway. The
  typings say FIFO mode "is much more efficient than appending and removing for achieving
  scrolling data", and the sort and NaN flags select the fastest indexing and ranging code.
- Code:
  ```ts
  // Wrong: one Wasm call per message, 200+ per second
  socket.onmessage = (m) => { const t = parse(m.data); series.append(t.time, t.price); };
  // Right: buffer, flush once per frame
  const series = new XyDataSeries(wasmContext, { fifoCapacity: 100_000, isSorted: true, containsNaN: false });
  let xs: number[] = [], ys: number[] = [], queued = false;
  socket.onmessage = (m) => {
    const t = parse(m.data); xs.push(t.time); ys.push(t.price);
    if (!queued) { queued = true; requestAnimationFrame(flush); }
  };
  function flush() { queued = false; series.appendRange(xs, ys); xs = []; ys = []; }
  ```
- Detect: `.append(` or `.update(` inside a socket, subscription or stream callback;
  `removeAt(0)`/`removeRange` used to scroll; a new data series for each update; a
  time-ordered feed whose series has no sort or NaN flags.
- Verify: drive a fixed feed (200 msg/s for 10 s through the scenario hook). Compare
  `frame-sampler.js` p95 frame time and long-frame count, and LoAF script time attributed
  to the socket handler, before and after (N=5 each side).
- Limits: rAF does not run in hidden tabs. Cap the buffer at `fifoCapacity` points, or
  flush on `visibilitychange` (MEM-10). For the forming candle, update the last point
  instead of appending (check the OHLC series typings of the installed version). FIFO series
  do not support insert or remove, and Spline and Stacked series do not support FIFO mode
  (typings). If parsing costs more than a few ms per frame, parse in a worker and transfer
  `Float64Array`s (TASK-24).
- Support: SciChart.js v5. verified-in: typings in raw/scichart (version not recorded);
  re-check names against `node_modules/scichart` before use.
- Sources: SciChart typings `BaseDataSeries.d.ts`, `XyDataSeries.d.ts`,
  `SciChartSurfaceBase.d.ts`; 13-scichart notes (pending).
````

Every API name and every quoted phrase comes from `raw/scichart/BaseDataSeries.d.ts`, `XyDataSeries.d.ts` and `SciChartSurfaceBase.d.ts`. `13-scichart.md` will add a docs source and the package version.

---

## 7. Output modes 2 and 3

### 7.1 Performance review report (mode 2), in `references/review.md`

The procedure is in `review.md` §1. It has six steps:

1. **Scope.** Record the files, the runtime context (SPA, charts, target browsers from the project's browserslist or AGENTS.md), and the evidence level (static, or measured with the environment stated).
2. **Map the code to stages** with routing table A. Open those stage files.
3. **Check** each stage's `Detect` signals against the code. Keep a finding only if the code shown supports it (Front-End Checklist audit stance).
4. **Rank** by impact × frequency: per-frame beats per-interaction, and per-interaction beats per-load. Report at most 10 findings. For a small scope, report the 1–3 strongest.
5. **Write fixes** as code diffs.
6. **List the stages that you checked** and found clean. This shows what the review covered.

The template is in `review.md` §2:

````markdown
# Performance review: <scope>
Date · commit <sha> · evidence: static (hypotheses) | measured (<env line>)
Runtime context: <SPA/chart/…> · target browsers: <source>

## Summary
| # | Stage | Finding (rule) | Impact · metric | Evidence | Effort |
|---|---|---|---|---|---|
| F1 | 05 Tasks | pointermove writes reactive state each event (TASK-07) | high · INP, FPS | static | S |
Top actions: 1) … 2) … 3) …

## Findings by pipeline stage
<!-- Pipeline order 01→13, then SciChart findings under the stage their rule names. Skip empty stages here. -->
### 05 · Tasks and scheduling
#### F1 · TASK-07 · <one-line title> — impact high (INP, FPS)
- Where: `src/…/Crosshair.svelte:42`
  > `pointer = { x: e.offsetX, y: e.offsetY };`
- Why it costs: <mechanism, one or two sentences>
- Fix:
  ```diff
  - pointer = { x: e.offsetX, y: e.offsetY };
  + latest = e; if (!queued) { queued = true; requestAnimationFrame(apply); }
  ```
- Verify: <trace event / insight / script metric> · expected: <signal>
- Evidence: static hypothesis | measured: <numbers, N, env>

## Checked, no findings
01 Network · 02 Parse · … (stages in scope that were checked)

## Not checked / needs measurement
<what static review cannot decide; the measure-mode command to decide it>

## Attempts ledger (only if measurement ran)
| Change | Metric | Before (median, range) | After (median, range) | Verdict |
````

Why this shape:

- Findings grouped by stage are what the user asked for.
- The quoted line, the why and the fix follow ibelick's review output.
- The evidence label follows the honesty rules from the Addy auditor and zero-jank-scroll.
- The ledger follows Addy agent-skills.
- The "Checked, no findings" list stops a reviewer from implying coverage that the review did not have.

### 7.2 Measurement workflow (mode 3), in `references/measure.md`

`measure.md` has these sections:

- A. Principles
- B. Setup
- C. Load workflow
- D. Interaction and frame workflow
- E. Memory workflow
- F. Compare and verdict
- G. Insight → stage map
- H. Field data (RUM)
- I. WebMCP scenario hooks
- J. Pitfalls

The tool names are those of chrome-devtools-mcp. In Claude Code they appear as `mcp__<server>__<tool>`, for example `mcp__chrome-devtools__performance_start_trace`.

The workflow has eight steps, 0 to 7.

**0. Preconditions**

- The chrome-devtools MCP server is connected.
- For load metrics, use a production build (for example `vite build && vite preview`).
- A dev server is acceptable only to compare frames or interactions on the same code path. The report must say which build was used.
- Record Chrome version, machine, DPR, display refresh rate and data size.

**1. Define the scenario and the success criterion before you measure.** Pick the metrics by stage:

- Load: LCP and its subparts, CLS, and the stage insights.
- Interaction: `INPBreakdown` plus `event-timing-collector.js`.
- Render loop: `frame-sampler.js` p95 frame time, long frames and maximum gap, plus `loaf-collector.js`.
- Memory: heap growth for each repetition.

**2. Fix the conditions.** Use `emulate` with `cpuThrottlingRate: 4`, and a `viewport` with the DPR. Use `networkConditions: "Slow 4G"` for load runs only. Keep the same URL, the same data and the same scenario. Discard one warm-up run.

**3. Baseline.** Measure on the unchanged code. Prefer a separate worktree or a second preview port. Ask before you stash the user's changes. Then do N = 5 runs.

- Load run:
  1. `navigate_page`.
  2. `performance_start_trace {reload: true, autoStop: true, filePath: <scratch>/base-<i>.json.gz}`.
  3. Read the insight list.
  4. `performance_analyze_insight` for the insights of the stages in scope.
- Frame or interaction run:
  1. `evaluate_script` installs the collectors from `scripts/*.js` and calls `start()`.
  2. `performance_start_trace {reload: false}`.
  3. Drive the scenario with `execute_webmcp_tool` (scenario hook), or `evaluate_script` → `window.__perfScenarios.run(...)`, or `click`/`drag`.
  4. `performance_stop_trace {filePath}`.
  5. `evaluate_script` calls `stop()` and returns JSON.
- Save raw traces to files. Never paste them into the context (Dallacqua, Chrome skill).

**4. Change.** Apply one change only.

**5. Re-measure.** Repeat step 3 with the same steps and N = 5.

**6. Compare.** Make a table for each metric with the median, the minimum–maximum range, and the delta.

- **Faster:** the after median beats the baseline median by at least 5% or by at least a meaningful step (10 ms of INP, 1 long frame for each 10 s), and the two ranges do not overlap.
- **Inconclusive:** the median improves but the ranges overlap. Run N = 10, or keep the change only for reasons other than performance.
- **No measurable change:** revert the part of the change that was made for performance (Addy agent-skills).
- The 5% threshold is a starting default. Tune it after the first measurements.

**7. Verdict and ledger.**

- Report the table, the environment line and the verdict.
- Record each attempt, kept or reverted.
- Never claim a field improvement from lab data. INP needs field data to confirm (corewebvitals.io).

**Memory workflow (E).**

1. Take a baseline `take_heapsnapshot` (saved to a file).
2. Repeat the suspect operation 10 times (mount and unmount a chart panel, or switch the symbol).
3. Take another snapshot.
4. Compare with `compare_heapsnapshots` if the server exposes it (`--memoryDebugging`). If not, compare the summary counts.

Also check detached DOM nodes. Before you null a reference, ask whether it is an intentional cache (Chrome memory skill). Prove a fix by its slope over repetitions, not with one pair of snapshots (VS Code leak audit).

**WebMCP (I).**

- **The hook.** In a dev build only (`import.meta.env.DEV`), `assets/perf-scenario-hook.ts` registers a `perf_run_scenario` tool with `document.modelContext.registerTool({ name, description, inputSchema, execute })`. The input is an enum of scenarios the app implements: `stream`, `pan`, `zoom`, `loadHistory`, `switchSymbol`.
- **Why a hook.** The hook makes the "change" step comparable. The same code-driven scenario runs before and after, not a hand-made series of clicks.
- **Setup.**
  - The DevTools MCP server needs `--categoryExperimentalWebmcp`.
  - WebMCP is an origin trial from Chrome 149, and the local flag is `chrome://flags/#enable-webmcp-testing`.
  - The user turns on the flag, not Claude.
- **Fallback.** Without WebMCP, `evaluate_script` calls `window.__perfScenarios`.
- **Safety.** Never register the hook in production builds. A registered tool is callable by any agent that visits the page.

Honest-claim rule (in SKILL.md): any "faster" claim in any mode needs this table. Otherwise use the words "expected to reduce <stage> work; not measured".

---

## 8. Version-sensitive facts: one place, dated

`references/support.md` is the only file that holds browser versions, Baseline dates, deprecation dates and product version numbers. Rules carry only a key and a tier word.

Structure:

```
# Browser support and deprecations — checked 2026-09-22
Data: web-features 3.39.0 (webstatus.dev), MDN browser-compat-data 8.1.2 (2026-09-17), Chrome docs.
## 1. Policy
## 2. Feature table        key | tier + date | Chrome | Firefox | Safari | fallback | source | checked
## 3. Do not use           old | status | use instead | source
## 4. Facts other skills get wrong (check your memory against these)
## 5. Disputed or moving   (re-check before relying)
## 6. How to re-verify
```

**Policy (from Modern Web Guidance, adapted).**

- Baseline widely available: no fallback needed.
- Newly available: use a fallback if the project supports older browsers.
- Limited or Chromium-only: feature detection plus a fallback, always. Diagnostics such as LoAF are the exception: they only add detail, so they need no fallback.
- The project's own policy (browserslist, AGENTS.md) wins. If the user names a restricted runtime, suggest that they write the policy into their CLAUDE.md or AGENTS.md.

**Example rows.** All facts come from the notes and surveys, which checked them on 2026-09-22.

| Key | Tier (date) | Chrome | Firefox | Safari | Fallback | Source |
|---|---|---|---|---|---|---|
| `scheduler-yield` | limited | 129 | 142 | no | `setTimeout`/`MessageChannel` promise | BCD 8.1.2 |
| `request-idle-callback` | limited | yes | yes | no (Technology Preview flag only) | `setTimeout` with a budget | BCD 8.1.2 |
| `content-visibility` | newly (2025-09-15) | 85 (`auto`) | 125 | 26 (`auto`) | IntersectionObserver to pause work | web-features; verify |
| `contain` | widely (high 2024-09-14) | yes | yes | yes (`style` keyword late) | — | web-features |
| `event-timing` (`interactionId`) | newly (2025-12-12) | yes | 144 | 26.2 | — | web-features |
| `long-animation-frames` | limited | 123 | no | no | none needed (diagnostic) | web-features |
| `webgpu` | limited | 113 (Win/macOS/ChromeOS), Android 121 | 141 Windows; 145/147 macOS | 26 | WebGL2 path | gpuweb wiki; webstatus |
| `early-hints-preload` | — | 103 | 123 | no (preconnect only, 17) | `<link rel=preload>` in HTML | BCD |
| `speculation-rules` | limited | 109 | no | 26.2 behind a flag, no prerender | none (progressive) | BCD; verify |
| `webmcp` | origin trial | 149 (flag for local dev) | no | no | `evaluate_script` + `window.__perfScenarios` | Chrome WebMCP doc (2026-08-07) |

**Do not use.** Each row gives the item and its replacement.

- FID → INP. INP replaced FID on 2024-03-12.
- TTI and Lighthouse score targets. TTI was removed in Lighthouse 10 on 2023-02-09.
- `isInputPending()` → `scheduler.yield()`.
- `unload` → `pagehide` or `fetchLater`. Chrome deprecates `unload` for 100% of page loads from Chrome 154.
- `performance.memory` → `measureUserAgentSpecificMemory()`.
- `<link rel=prerender>` → speculation rules.
- HTTP/2 Server Push → 103 Early Hints. Push was removed in Chrome 106 and Firefox 132.
- `format('woff2-variations')` → `format('woff2')`.
- `translateZ(0)` hacks → `will-change` just in time.

**Facts other skills get wrong** (§4). This list is a test for Claude's own memory:

- `scheduler.yield` ships in Firefox 142, not 129.
- `Cache-Control: no-store` no longer always blocks bfcache in Chrome. Chrome finished the rollout in March–April 2025.
- Power-of-two textures are a WebGL1 limit only.
- `lighthouse_audit` in DevTools MCP has no performance category. Use traces.
- The `interpolate-size` property is Chromium-only (Chrome 129).
- Scroll-driven animations are limited: Chrome 115 and Safari 26, no Firefox.

**Disputed or moving** (§5):

- Native lazy loading for `<video>`/`<audio>`: `03-course` says Chrome 148+, and the web survey says Chrome/Edge 150 on webstatus (2026-06-30). Re-check before you rely on it.
- The Chrome version that turned on cross-origin paint holding by default was not found (verify report).
- The Safari row for JSPI is missing from webstatus.
- HTML-in-canvas is an origin trial.
- WebGPU optional features (`shader-f16`, `timestamp-query`, `subgroups`) are still moving. Detect them at run time.

**Re-verify** (§6). Re-check a row when:

- a decision depends on a row whose `checked` date is more than 6 months old, or
- the row is missing, or
- the project targets a browser that the row lists as "no".

To re-check: query `https://api.webstatus.dev/v1/features/<id>` or the MDN BCD JSON with WebFetch (this needs the user's web permission). Then update the row and its date, and tell the user the date. Never run a retrieval CLI through `npx` (Modern Web Guidance does this; running downloaded code is not allowed). Never state a version from memory.

**Library versions follow the same rule.** SciChart rules carry `verified-in:`. SKILL.md tells Claude to read `node_modules/scichart/package.json` and the typings first. Typings win over docs and over memory (TradingView skill lesson).

---

## 9. What to leave out, and how to deduplicate

### 9.1 Leave out

- **Server and CDN operations** beyond what frontend code controls: CDN choice, HTTP/3 setup, compression server config. Keep only the one-line "Also consider" entries in 01.
- **Video encoding and codecs, and image CDN negotiation.** These are content-site concerns. Keep only markup rules (lazy loading, poster, facade).
- **Framework-specific rules** (React, Vue, Svelte runes). The user asked for no Svelte file. Keep framework-neutral forms instead, such as "high-frequency values out of reactive state".
- **Workbox API details and service-worker messaging trivia.** Keep 2 NET rules.
- **Metric history and thresholds that are no longer used** (FID, TTI, Speed Index, Lighthouse score targets). These go to support.md "Do not use" only.
- **The 154-post V8 index, engine internals, and Crankshaft-era "optimization killers".** Also leave out the micro-rules that modern JITs make no-ops: caching `length` and caching property access.
- **Origin-trial or experimental APIs as rules.** HTML-in-canvas, `prerender_until_script` and per-function compile hints stay out. WebMCP stays in only as an optional measurement aid.
- **Raw traces, long source lists, and long Why paragraphs.** Each rule keeps ≤ 2 sources. The full source lists stay in the notes.
- **Accessibility and security content,** except reduced motion (COMP-19) and the dev-only guard on WebMCP hooks.
- **Copied text from sources.** Rules are paraphrased, and all code is original.

### 9.2 Deduplicate: about 850 note items → about 294 rules

This is done once at build time, with a scratch script in the scratchpad. The script is not shipped.

1. **Extract.** Parse every `### ` item into a record with these fields: file, title, Layer, Stage, Metrics, When, Impact, Do, Why, Example, Avoid, Status and Sources.
2. **Apply corrections first.** Join the `verify/` reports by title and replace the corrected text. Drop "disputed" claims, or move them to support.md §5. Precedence order:
   1. verify corrections
   2. `15-gaps-round` corrections
   3. the note with the newest BCD/web-features date
   4. first-pass notes
   5. rules imported from the surveys
3. **Place.** Give each record a home stage with the placement rule (section 1.2). The notes' Stage tags are multi-valued, and the first tag is not always the home: the canvas2d items list `raster` first but also `main-thread-task`. Record the other stages as `also`.
4. **Cluster.** Within each home stage, group records by subject key: the main API, property or element (the backticked tokens in Do) plus the action verb.
   - For example, five items about lazy-loading the LCP image (in 01-CRP, 02-course, 03-course, 04-html-http, run2) become two rules: PARSE-11 "LCP image as `<img>` in server HTML, never lazy" and NET-08 "`fetchpriority=high` on the LCP image only".
5. **Merge.**
   - Do: the most specific wording that is verified.
   - Why: one mechanism, plus the best number from a primary source (spec, Chrome docs, MDN, v8.dev before blogs).
   - Code: a new original pair.
   - Limits: the union of the caveats, deduplicated, plus the conflict resolution.
   - Support: the key.
   - Sources: ≤ 2.
6. **Filter.**
   - The **no-op test** (Svelte `writing-great-skills`): delete a rule when Claude already does it by default ("minify in production", "use HTTPS").
   - **Relevance:** keep what matters to an SPA trading terminal with charts.
   - **Evidence:** delete numbers that have no source. Examples are Vercel's "10×" and dejank's "7×".
   - **Freshness:** deprecated advice goes to the "Do not use" table.
7. **Cap.** Each file has a rule cap (section 2). Rules over the cap become one-line "Also consider" entries with no code.
8. **Build checks** (scratch script, run before publishing):
   - Every rule ID is unique.
   - Every ID named in SKILL.md exists.
   - Every `Support:` key exists in support.md.
   - Every file is within its line cap.
   - SKILL.md is ≤ 18,000 characters.
   - No `### ` rule is missing Detect or Verify.
   - No browser version number appears outside support.md (regex: `(Chrome|Firefox|Safari) \d+`).

   These checks stop the drift that the surveys found in other skill sets: an index that says "40+" rules while the skill has 70, and index entries that point to missing files.

**Conflicts found so far, resolved in rule Limits:**

- `alpha: false`: acceptable on opaque 2D canvases. For WebGL, write opaque alpha instead (notes 10 and 12, against the OpenAI survey).
- `will-change`: just in time, not in base CSS (against GSAP).
- Scroll handlers: use rAF, `scrollend` or IntersectionObserver, not a debounced scroll handler (against Addy and Mapbox).
- The `preload` + `onload` CSS trick breaks under a strict CSP (against Modern Web Guidance and Addy).
- `requestIdleCallback` does not shorten an interaction (against dembrandt).
- The `grid-template-rows` 0fr→1fr trick runs layout every frame (against iart).

---

## 10. Four test prompts for skill-creator evals

The prompts are written the way the user types while coding. None of them names the API that the answer should use. This follows the Chrome eval lesson: "make my images load faster", not "add fetchpriority".

**E1. Write-time, GPU text.** "Add price labels to each level of the Fibonacci channel drawing. The labels must follow the handle while the user drags it."

A good answer:

- builds a label texture only when the formatted string changes (cache key: string + font + DPR);
- reuses one `Intl.NumberFormat`;
- caches `measureText` results;
- uploads dirty sub-rectangles into a preallocated atlas;
- creates no GPU objects in the drag loop;
- coalesces the drag with rAF;
- rebuilds on a DPR change;
- deletes textures on teardown;
- ends with `Performance notes` that cite GPUUP-18, TASK-06 and JSRUN-12.

A baseline usually creates a canvas and a texture on each pointermove, calls `toFixed`/`toLocaleString` and `measureText` on every frame, and leaks textures.

Grader checks (grep on the diff):

- no `createTexture`/`texImage2D` inside the pointer or rAF handler;
- one `new Intl.NumberFormat` outside the handler;
- a cache keyed by string;
- a `Performance notes` section.

**E2. Write-time, SciChart streaming.** "Hook the trades WebSocket into the 1m candle chart. We get around 200 messages a second."

A good answer:

- buffers messages and flushes once per frame (`appendRange` for closed candles, an in-place update for the forming candle);
- uses a FIFO or preset `capacity`;
- sets the sort and NaN flags;
- keeps chart data out of reactive state;
- caps or flushes the buffer when the tab is hidden;
- aborts the socket on destroy and calls `delete()` on the series;
- says that it checked the installed SciChart typings.

A baseline calls `append` in `onmessage`, or rebuilds the dataset on each message, and does not clean up.

Grader checks:

- no `.append(` in the message callback;
- `requestAnimationFrame` or one batch flush;
- `fifoCapacity` or `capacity` present;
- teardown with `delete()`/`AbortController`.

**E3. Review.** "Can you review OrderBook.svelte and its styles for performance? It updates on every depth message."

A good answer:

- follows the `review.md` template, grouped by stage (05, 07, 08/09, 13);
- gives file:line with quoted lines;
- labels findings "static hypothesis";
- makes 3–7 strong findings (for example `:nth-child` zebra stripes on a list that changes, flash via `background-color` animation, no `contain` on rows, a layout read in an update loop, one DOM update for each message);
- gives code fixes;
- ends with a "Checked, no findings" list and a measure-mode command for anything it cannot decide.

A baseline gives an unordered list of generic tips ("use memoization", "debounce"), with no locations and no evidence labels.

Grader checks:

- stage headings in pipeline order;
- every finding has a `file:line`;
- at least one "Verify" line;
- no "faster" claim without numbers.

**E4. Measure.** "I moved the drawings layer to its own canvas and added will-change. Is it faster now? Dev server is on localhost:5173."

A good answer:

- asks before it stashes changes, and uses a worktree or a baseline commit;
- sets fixed conditions (CPU 4×, viewport and DPR);
- defines the scenario (a 10 s drag over a chart with N drawings);
- runs 5+5 runs with `frame-sampler.js` and `loaf-collector.js` and saved traces;
- shows a compare table with medians and ranges;
- gives a verdict under the non-overlap rule;
- notes that the dev build limits the conclusion;
- checks the Layers or Animations evidence for `will-change`.

A baseline answers "yes, will-change promotes to a GPU layer, so it is faster" with no measurement, or runs one Lighthouse audit (which has no performance category in DevTools MCP).

Grader checks:

- `performance_start_trace` is called at least twice (baseline and after);
- the compare table has medians;
- the verdict word is one of faster, inconclusive or no measurable change.

**Trigger evals** (`evals/trigger-queries.json`):

- 10 should-trigger queries, for example "make the watchlist rows flash green on uptick", "port the candle renderer to WebGPU", "why does the tab eat memory overnight".
- 10 near-miss queries that should not trigger, for example "add an index to the trades table", "write a Node script to backfill candles", "fix this TypeScript type error in the API client", "update the CI workflow". These test the description's "Skip for" line and the missing `paths`.

---

## 11. Risks of this design and how to reduce them

| # | Risk | Why it comes from Angle A (or not) | Mitigation |
|---|---|---|---|
| 1 | One artifact spans several stage files. An `<img>` tag touches 01, 02, 07 and 08, so Claude opens one file and misses rules. | Direct cost of a stage axis. | Routing table A lists all the stage files for each artifact. The always-on rules cover the top cross-stage cases. The `also` tags and "Pointers" sections link the stages. The tag greps give a layer view. E1–E3 evals test this. |
| 2 | Placement is ambiguous, which leads to duplicate rules or rules in a surprising file. | Stage tags in the notes are multi-valued. | One written placement rule with examples. The build check makes IDs unique. Other stages get pointers, not copies. |
| 3 | Developers think in tasks and metrics ("fix INP"), not in stages. | Axis mismatch. | Routing table B (symptom, LCP subpart, INP phase → stage) and `pipeline-map.md` §6. |
| 4 | GPU work needs three files (10, 11, 12), which costs about 17,000 tokens. | Splitting the GPU pipeline by stage. | Each file ≤ 340 lines, with the TOC first. The GPU always-on rules in SKILL.md cover small edits. The WebGL → WebGPU table is kept in one place (12). |
| 5 | The skill does not trigger during ordinary coding. Vercel measured 56% non-invocation with default triggering. | Not specific to Angle A. | A pushy description that leads with writing tasks. `when_to_use` examples. No `paths`, which would block URL-only work. An optional 2-line pointer in a project CLAUDE.md or AGENTS.md, which the user decides to add; the skill never writes it. Trigger evals with near misses. |
| 6 | Context cost and compaction: long sessions drop the skill text. | Not specific. | SKILL.md ≤ 18,000 characters, so it fits the 5,000-token re-attach budget. The most-used content comes first. References load on demand. If a reference was dropped, re-open it. |
| 7 | Facts go stale (versions, deprecations). | Not specific. | One dated `support.md`, rules without version numbers, a 6-month re-verify rule, and the "facts other skills get wrong" memory check. |
| 8 | SciChart facts are unverified (the docs return 403) or depend on the version. | Framework file. | Installed typings are the source of truth. Each SC rule carries `verified-in:`. `13-scichart` notes fill in the gaps. Mark as `unverified` any rule that is not in the typings. |
| 9 | Over-optimization: workers for tiny work, micro-optimizations everywhere, more complexity. | A rich rule set invites it. | The work-size rule. "Performance after correctness". JSRUN applies only to hot paths. The no-op test at build time. Neutral changes are reverted. "Performance notes" list only choices that are not the default. |
| 10 | Measurement is noisy or not representative (dev build, laptop, HMR). | Not specific. | Production build for load metrics. A stated environment line. N = 5 per side with the non-overlap rule. Fixed scripts. A WebMCP or window scenario hook for repeatable input. Lab results never claim field wins. |
| 11 | The WebMCP hook leaks into production, or modifies the user's code without consent. | Measurement design. | The hook is a template in `assets/`. Claude adds it only with approval, behind `import.meta.env.DEV`. The `evaluate_script` fallback needs no code change. |
| 12 | Claims without measurement ("60 fps", "GPU-accelerated so smooth"). | Not specific. | The honest-claims section in SKILL.md, evidence labels in reports, and the E4 eval. |
| 13 | Rules drift away from the notes as the notes are updated (sediment). | Many files. | Build checks (section 9.2 step 8). IDs are never reused. "Also consider" holds demotions, so no rule is silently lost. |
| 14 | Pipeline details differ by browser engine (the notes describe Chromium RenderingNG). | Stage axis and engine specifics. | Stage cards say "Chromium; other engines differ in detail". Rules state the mechanism at the level that holds across engines. Engine-specific tips carry a `chromium` note in Limits. |
