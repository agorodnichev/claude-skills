# Merged design: the `web-performance` skill

- Date: 2026-09-22 (build day). Target: `~/.claude/skills/web-performance/` (user level, all projects).
- Method: judge designs A (pipeline first), B (task first) and C (outcome first), then merge them on the best base.
- Read in full: `19-design-a-pipeline.md`, `19-design-b-task.md`, `19-design-c-symptom.md`, `18-skills-survey-github.md`, `18-skills-survey-web.md`.
- Also read: the headings of every notes file; item bodies in `05`, `13` and `14`; the `13` conflicts table and §J; the `14` tool inventory, insight list, WebMCP status and agent playbook; `verify/02` (format and corrections); the raw Claude Code skills doc (frontmatter fields, the 1,536-character listing cap, the 5,000-token compaction re-attach); `raw/TraceEvents.ts` (the `Layout` event arguments).

## Scores (1 = poor, 5 = excellent)

| Criterion | A: pipeline | B: task | C: outcome |
|---|---|---|---|
| 1. Loads during any frontend coding, quiet otherwise | **4**. Pushy description with examples and a skip list; no `paths`. | **5**. Starts with the act of writing, says "even when the user does not mention speed", lists file types and APIs, has no `paths`, and adds a "light trigger" eval class. | **3**. `paths` also matches backend `.ts` files, and it can block symptom and URL-only prompts (C's own risk R2). |
| 2. Low token cost per use | **3**. A pointer handler needs stage files 05 and 07. GPU work opens 10, 11 and 12 (about 17,000 tokens by A's own count). | **4**. One task file per edit, checklist first. The GPU file is 480 lines. | **4**. Reads rules by ID, which is the cheapest. But the router carries ID ranges, and GPU rules scatter across outcome sections. |
| 3. Fidelity to the user's classification | **5**. The CRP phases are the axis; the layers are grep views. | **3**. The files happen to follow the layers, but the user's categories are only a map. | **2**. Outcome axis. CSS is in 3 files. V8 is hidden in `responsiveness.md` §G. |
| 4. Actionable rules | **4**. Do, Why, Code, Detect, Verify, Limits. Verify has no pass condition. | **4**. Do, Why, Detect, Verify, Example, Caveat, and a one-line form. No pass condition. | **5**. Detect is a ripgrep regex with globs. Verify names a recipe and a Pass condition. Avoid says when the rule is wrong. |
| 5. Maintainability | **4**. Placement rule and one dated support file. The checks are a scratch script that does not ship. | **4**. One owner per rule and `→ ID` pointers. The ID registry in MAINTAINING.md is a second list that can drift. | **5**. A shipped lint, no versions outside `support.md`, a crosswalk, myths and a watch list. |
| 6. Supports the three output modes | **4**. All three modes. The verdict uses range overlap only. | **4**. Evidence levels M, S, H and detailed steps. No deterministic compare. | **5**. Mode picker with read-only diagnosis, honesty rules, recipes with pass conditions, probes, trace summary, MAD-based verdict, worktree baseline. |
| 7. Fit for SciChart.js trading charts | **3**. No chart contract. GPU knowledge is split over 3 files. | **5**. Live-data, canvas, GPU and SciChart files, and "common pairs". One wrong fact: it says `dataEvenlySpacedInX` defaults to true (the 5.2.69 source says false). | **5**. Uses the finished `13` notes (5.2.69, conflicts, v6 alpha). Splits pan and zoom (smoothness) from INP. Has a chart contract. |
| **Total (of 35)** | **27** | **29** | **29** |

Tie-break between B and C: **B is the base.** B's axis is the nearest to the user's categories, because its files already split along HTML, CSS, JS, V8 and GPU lines. B's triggering has no `paths` risk. C's strengths are self-contained parts (rule fields, scripts, honesty rules, lint), so they graft onto any axis. An axis cannot be grafted.

## Rationale (5 lines)

1. Base = B: Claude can name the task file from the code in front of it, so one lookup finds the rules, and the description fires on the act of writing, not on audit words.
2. From A: the user's categories become the top level: each rule file carries its category prefix (`html-`, `css-`, `js-`, `v8-`, `gpu-`), and `pipeline.md` (phase maps plus 13 stage cards) is category 1 and the stage vocabulary for tags and review reports.
3. From C: the rule fields (Detect regex, Verify recipe with a Pass condition, Avoid), the honesty rules, the mode picker with read-only diagnosis, the chart contract, "pan and zoom are not INP", and the measurement kit (`probes.js`, `trace-summary.mjs`, `compare-runs.mjs`, `lint-skill.mjs`).
4. From notes `13` and `14`, which the designs saw only in part: SciChart 5.2.69 facts and doc/source conflicts, DevTools MCP 1.9.0 names and flags, "CPU throttling does not slow the GPU", the WebMCP origin trial (Chrome 149–156), and hooks kept out of the measured window.
5. Fixes to all three: no `paths`; a 90-day staleness window, because Chrome now ships every two weeks; the crosswalk and the lint live inside the skill folder, because the scratchpad is temporary.

---

## 1. Classification axis

### 1.1 Primary axis: the code Claude is writing, filed under the user's category

The skill has two levels.

- **Level 1: the user's category.** It is fixed, and it is the file-name prefix:

  | Prefix | User category |
  |---|---|
  | `pipeline.md` | Critical rendering path phases (first HTML bytes to pixels) and the code that affects each |
  | `html-` | HTML directives that load early or lazily |
  | `css-` | CSS: GPU, layers, `will-change`, `contain` |
  | `js-` | JS: event loop, micro and macro tasks, rAF, rIC, Web APIs |
  | `v8-` | Micro-optimizations (V8 blog) |
  | `gpu-` and `scichart.md` | GPU: WebGL/WebGPU textures, shaders, data types; SciChart.js v5 |
  | `measure.md` | Chrome DevTools MCP and WebMCP for performance testing |

- **Level 2: the task file.** It is the kind of code Claude types in one edit, for example "an input handler", "a live feed", "WebGL or WebGPU code", "a SciChart series". Claude can name it from the file it edits, with no reference open. The router in SKILL.md lists **code signals** for each file, for example `addEventListener('pointermove'`, `new XyDataSeries(`, `gl.bufferSubData`, `<link rel=`.

Why this axis:

1. **The user's categories are visible.** They are the top level of the tree, not a map at the end. "All CSS rules" is `references/css-*.md`. "All V8 rules" is `references/v8-*.md`.
2. **One hop at write time.** When Claude writes code, it knows the artifact (a handler, a shader, a series update). It does not know the stage yet, because one handler touches tasks, style, layout and paint. A task file needs one lookup. A stage-first design (A) needs a translation step and then 3–4 files: an `<img>` touches A's stage files 01, 02, 07 and 08.
3. **The pipeline stays the backbone.** Each rule carries a `stage:` tag from one 13-word vocabulary. `pipeline.md` holds the phase maps and one stage card per stage. The review report groups findings by stage. So all three of the user's framings (phases, layers, report by stage) work, and no rule has a second copy.
4. **Evidence from the surveys.** Skills that fire at write time are organized by developer task: Chrome Modern Web Guidance ("classified by developer task"), Vercel react-best-practices, the OpenAI canvas skill. Audit skills organized by metric (Addy CWV) or by audit phase (Cloudflare) "will not fire while Claude writes a new component" (`18-skills-survey-github.md`).
5. **Rejected alternatives.**
   - Pure stage files (A): high fidelity, but a GPU edit loads 3 files and an `<img>` edit loads 4.
   - Outcome files (C): the axis does not match the user's categories. At write time, Claude knows the code shape, not the outcome.

### 1.2 Secondary tags: one tag line under each rule title

```
stage: <stages> · metric: <metrics> · when: <when> · impact: <high|medium|low> — <one-clause reason> · support: <key|baseline|n/a> · also: <IDs>
```

| Tag | Values | Used for |
|---|---|---|
| `stage` | `network`, `parse`, `cssom`, `script-load`, `tasks`, `js`, `style`, `layout`, `paint`, `composite`, `gpu-upload`, `gpu-draw`, `memory`. The first value is the stage where the saving shows in a trace (A's placement rule). | Review grouping (mode 2); `pipeline.md` stage cards; the grep index |
| `metric` | `LCP`, `INP`, `CLS`, `FCP`, `TTFB`, `frame` (frame time, smoothness), `memory`, `bytes`, `startup` | Choosing the measurement recipe (mode 3) |
| `when` | `load`, `interaction`, `render-loop`, `session`, `build` | Hot path or not; review ranking |
| `impact` | `high`: visible on target hardware in normal use (a task over 50 ms after input, dropped frames during pan, zoom or streaming, a CWV threshold crossed, unbounded memory growth). `medium`: visible under load, on low-end devices, or it grows with data size. `low`: small or rare; apply it when you touch that code anyway. | Checklist order; review severity |
| `support` | A key in `support.md`, `baseline` (Widely available), or `n/a` | Feature detection and fallbacks; no versions in rules |
| `also` | Rule IDs in other files | Cross-links instead of copies |

The 17 stage tags in the notes collapse into the 13 words:

| Skill tag | Notes tags |
|---|---|
| `network` | `network` |
| `parse` | `html-parse`, `preload-scan` |
| `cssom` | `cssom` (plus font-swap items) |
| `script-load` | `script-compile`, `startup` |
| `tasks` | `main-thread-task`, `microtask`, `idle` |
| `js` | `script-run` |
| `style` | `style` |
| `layout` | `layout` |
| `paint` | `paint`, `raster` |
| `composite` | `composite` |
| `gpu-upload` | `gpu-upload` |
| `gpu-draw` | `gpu-draw` |
| `memory` | `gc-memory`, `memory` |

### 1.3 Home rule: one home for each rule

1. The home is the file where the code that the rule changes gets typed. Examples:
   - an `<img>` attribute goes to `html-media-and-fonts.md`;
   - a `pointermove` handler goes to `js-events-and-input.md`;
   - a GPU buffer goes to `gpu-webgl-webgpu.md`.
2. If two files qualify, the home is the file that the router opens first for that code. The other file gets a `→ ID` line in its checklist. It never gets a copy.
3. A SciChart-specific API always lives in `scichart.md`. The general mechanism stays in its layer file, and the SciChart rule links to it with `also:`.
4. The `stage:` tag lists the stage where the saving shows first. This is A's placement rule, used here as a tag and not as a folder.

| Rule idea | Home | Why |
|---|---|---|
| Never lazy-load the LCP image | `html-media-and-fonts.md` MEDIA-02 | The attribute is typed on the `<img>` |
| Coalesce `pointermove` into one rAF | `js-events-and-input.md` EVT-03 | Typed in the handler |
| Pause a chart loop when its panel is skipped | `gpu-canvas-and-frames.md` CNV-20 | Typed in the render loop; `css-rendering` CSS-09 points to it |
| `appendRange` once per frame into a FIFO series | `scichart.md` SC-02 | SciChart API; `also: DATA-06` |
| Close sockets on `pagehide` | `js-lifecycle-and-memory.md` LIFE-07 | Lifecycle code; `js-live-data-and-network` DATA-10 points to it |
| No float32 Unix-ms timestamps | `gpu-webgl-webgpu.md` GPU-14 | Typed where vertex data is built; DATA-05 points to it |

### 1.4 Where each user category lives, and how Claude lists it

| User category | Files | "Show me all of it" |
|---|---|---|
| CRP phases and the code that affects each | `pipeline.md` §B (initial load, with a "code that controls it" column), §C (update frame), §H (13 stage cards) | Read `pipeline.md` §B and §H |
| HTML directives that load early or lazily | `html-loading.md` (with a §0 directive map: `preload`, `modulepreload`, `preconnect`, `fetchpriority`, `async`, `defer`, `type=module`, `blocking`, `media`, speculation rules → rule IDs) and `html-media-and-fonts.md` (`loading`, `decoding`, `sizes="auto"`, `preload` on video) | `references/html-*.md` |
| CSS (GPU, layers, `will-change`, `contain`) | `css-rendering.md`; the property → layout/paint/composite table is `pipeline.md` §E | `references/css-*.md` |
| JS (event loop, micro/macro tasks, rAF, rIC, Web APIs) | `js-events-and-input`, `js-scheduling-and-workers` (with a §0 "which primitive when" table: task, microtask, rAF, rIC, `postTask`, `MessageChannel`, `setTimeout`, worker), `js-dom-and-lists`, `js-live-data-and-network`, `js-lifecycle-and-memory`; the slot model is `pipeline.md` §D | `references/js-*.md` |
| Micro-optimizations (V8 blog) | `v8-hot-code.md`; V8 startup items (code cache, compile hints) are HTML-17 | `references/v8-*.md` |
| GPU (textures, shaders, data types) | `gpu-webgl-webgpu.md`, `gpu-canvas-and-frames.md`, `scichart.md` | `references/gpu-*.md references/scichart.md` |
| Chrome DevTools MCP and WebMCP | `measure.md`, `scripts/`, `assets/perf-hooks.dev.ts`; tool facts in `support.md` §C | Read `measure.md` |

By stage, across all files: `grep -n -B1 '^stage: [^·]*\blayout\b' ${CLAUDE_SKILL_DIR}/references/*.md` (the line above the tag line is the rule title).

---

## 2. Directory tree

```
~/.claude/skills/web-performance/
├── SKILL.md                         260  Modes, how to work, two routers, pipeline table, budgets and
│                                          chart contract, always-on rules, default habits, output formats,
│                                          honesty rules, support policy. Hard cap: 18,000 characters.
├── references/                            Loaded on demand, one level deep. Every rule file opens with a
│   │                                      checklist that is also its table of contents.
│   ├── pipeline.md                  300  CAT 1. Threads; initial load (12 phases); update frame; event-loop
│   │                                      slots; property cost table; layout-forcing APIs; metric → stage;
│   │                                      13 stage cards; insight → stage → file; stage vocabulary. No rules.
│   ├── html-loading.md              320  CAT 2. HTML-: directive map; head; scripts; CSS delivery; discovery
│   │                                      and priority; bundles and startup JS; next navigation; HTTP one-liners.
│   ├── html-media-and-fonts.md      200  CAT 2. MEDIA-: LCP element; images; fonts; video and embeds;
│   │                                      reserved space.
│   ├── css-rendering.md             340  CAT 3. CSS-: compositor-only motion; layers and will-change;
│   │                                      containment; style scope; paint cost; WAAPI; scroll effects, view
│   │                                      transitions, reduced motion.
│   ├── js-events-and-input.md       260  CAT 4. EVT-: INP phases; high-rate input; layout reads; listener
│   │                                      options; debounce, throttle, cancel.
│   ├── js-scheduling-and-workers.md 280  CAT 4. TASK-: primitive map; task size; yield; priorities and idle;
│   │                                      timers; workers and transfer; Wasm.
│   ├── js-dom-and-lists.md          180  CAT 4. DOM-: DOM size; virtualized lists and tables (order book,
│   │                                      watchlist, blotter); chunked builds; native dialog and popover.
│   ├── js-live-data-and-network.md  260  CAT 4. DATA-: feed contract; WebSocket/SSE ingest; store; flush
│   │                                      per frame; tabs and lifecycle; degradation; fetch(); service worker.
│   ├── js-lifecycle-and-memory.md   240  CAT 4. LIFE-: ownership and teardown; bounded growth; hidden tabs
│   │                                      and bfcache; storage; leak proof; reactive state.
│   ├── v8-hot-code.md               200  CAT 5. V8-: hot-path gate; algorithm; shapes; arrays; allocation;
│   │                                      builtins; async; myths.
│   ├── gpu-canvas-and-frames.md     280  CAT 6. CNV-: frame loop; backing store and DPR; layers by change
│   │                                      rate; Canvas 2D drawing and text; OffscreenCanvas; pausing; fewer marks.
│   ├── gpu-webgl-webgpu.md          460  CAT 6. GPU-: optimization ladder; context and device; shaders and
│   │                                      pipelines; buffers and data types; draws; fragment cost; textures
│   │                                      and text; readback; loss; profiling; WebGL → WebGPU table.
│   ├── scichart.md                  360  CAT 6. SC-: lookup order; ingestion; resampling; redraw control;
│   │                                      many charts; text and annotations; styling; wasm memory; loading;
│   │                                      GPU and backends; measure hooks.
│   ├── measure.md                   380  CAT 7 and mode 3. Preflight; the loop; lab profiles; scenario driving;
│   │                                      recipes with pass conditions; probes; compare; field data; token
│   │                                      hygiene; report; pitfalls; tool cheat sheet.
│   ├── review.md                    170  Mode 2. Procedure; evidence levels and severity; report template;
│   │                                      one worked finding.
│   └── support.md                   260  The only file with versions and dates: policy; feature table;
│                                          Chromium-only extras; engine and tool facts; library versions and
│                                          conflicts; do-not-use; myths; watch list.
├── scripts/                               Fixed measurement code, so runs repeat (DevTools MCP issue #1114).
│   ├── probes.js                    220  evaluate_script body: installs window.__wpProbe (env, frame,
│   │                                      interaction, shift, loaf, paint, memory). Idempotent.
│   ├── trace-summary.mjs            130  node: event counts and times in a saved .json.gz trace, for the whole
│   │                                      trace or between two performance marks; Layout root data.
│   └── compare-runs.mjs             110  node: median, MAD, delta and verdict for two run files.
├── assets/
│   └── perf-hooks.dev.ts             90  Template. Dev-only WebMCP scenario tools plus a window.__perf
│                                          fallback. Claude copies it into a project only with approval.
├── maintenance/                           Never loaded at run time.
│   ├── MAINTAINING.md                80  Add or merge a rule; home rule; refresh support.md; run the lint;
│   │                                      release checklist.
│   ├── lint-skill.mjs               120  Checks IDs, pointers, fields, support keys, versions, sizes, TOCs,
│   │                                      frontmatter length.
│   └── crosswalk.tsv               ~780  One row per note item: source file, heading, rule ID or
│                                          "dropped: <reason>".
└── evals/                                 skill-creator only. Never loaded at run time.
    ├── evals.json                   140  The 4 task evals in §10 with assertions.
    ├── trigger-queries.json          70  12 should-trigger, 4 light-trigger, 8 should-not-trigger queries.
    └── fixtures/terminal/          ~400  Small Vite + TS app: SciChart pane with a drawing layer,
                                           OrderBook.svelte + order-book.css, ws-mock.ts, toolbar component.
```

Size on disk: about 4,470 lines of references, 460 lines of scripts, 90 lines of assets. About 260 rule IDs: about 190 full rules and 70 one-line rules.

Load cost per use:

| Use | What loads | About |
|---|---|---|
| Small edit (color, spacing, rename) | SKILL.md only | 4,500 tokens, once per session |
| Typical component | SKILL.md + 1–2 checklists (about 40 lines each) + 3–6 rules (about 15 lines each) | +1,500–2,500 tokens |
| GPU renderer | + `gpu-webgl-webgpu.md` checklist and 6–10 rules | +3,000–4,000 tokens |
| Review | + `review.md` + 2–4 checklists + Detect lines by grep | +5,000–7,000 tokens |
| Measure | + `measure.md` sections §0–§6 | +5,000 tokens |

---

## 3. Frontmatter (exact)

```yaml
---
name: web-performance
description: >-
  Performance rules for browser frontend code, applied while you write it. Use
  this skill before you write, change or review HTML, CSS, JS/TS, Svelte or
  other UI components, event handlers, animations, workers, canvas,
  WebGL/WebGPU shaders, or SciChart.js chart code, even when nobody says
  "performance": ordinary code (a pointermove handler, a layout read after a
  style write, a dataset replaced per tick, a missing teardown) causes most
  slowdowns. It routes the code you are writing to rules filed by layer (HTML
  loading, CSS, JS event loop and Web APIs, V8 hot paths, GPU) and tagged by
  rendering-pipeline stage, and it names the trade-offs. Also use it to write
  a performance review grouped by pipeline stage, and to measure a change with
  Chrome DevTools MCP (baseline trace, change, re-trace, compare) before you
  call it faster.
when_to_use: >-
  Examples: "add a crosshair to the chart", "stream trades into the candles",
  "render 1M points", "add price labels to the drawing tool", "flash the order
  book rows on update", "port the candle renderer to WebGPU", "the panel janks
  when I pan", "memory grows after a day", "review OrderBook.svelte for
  performance", "is it faster now?", "trace localhost:5173". Also on: slow,
  lag, jank, stutter, flicker, INP, LCP, CLS, FPS, leak, profile. Skip for
  backend or Node-only code, CLI scripts, database, CI and infra work, and for
  edits that change only text, types or names.
argument-hint: "[review|measure] [path or URL]"
---
```

Checks done on this text (Python, folded YAML):

- `description` is 831 characters and `when_to_use` is 568: 1,399 in total. The cap is 1,536. The Claude Code skills doc says: "the combined `description` and `when_to_use` text is truncated at 1,536 characters in the skill listing".
- The key use case comes first ("applied while you write it"), as the doc asks, so a cut in a full listing removes the least useful words.
- The push ("even when nobody says 'performance'") answers Vercel's finding that with default triggering the skill "was never invoked in 56% of cases" (`18-skills-survey-web.md`).

Decisions:

- **No `paths`.** The doc says `paths` means "Claude loads the skill automatically only when working with files matching the patterns". Modes 2 and 3 and symptom questions often start before Claude opens a file ("trace localhost:5173", "the chart gets choppy after hours"). A glob such as `**/*.ts` also matches backend TypeScript, so it adds little precision. The "Skip for …" sentence does the scoping instead. This is C's risk R2, avoided.
- **No `allowed-tools`.** A model-invoked skill must not pre-approve `navigate_page` or `evaluate_script`. Measurement stays under the user's normal permission prompts.
- **No `context: fork`.** Write-time rules must be in the main context, where the code is written.
- **`argument-hint`** enables `/web-performance review src/lib/OrderBook.svelte` and `/web-performance measure http://localhost:5173`. SKILL.md has no argument placeholder. Claude Code then appends `ARGUMENTS: <value>`, and the mode table reads it. The lint fails if SKILL.md contains `$ARGUMENTS` or `$<digit>` by accident.
- **Optional trigger reinforcement** (open question 1): a 3-line pointer in the user's `~/.claude/CLAUDE.md`. Vercel measured 53% → 79% with explicit instructions, and "explore first, then use the skill" beat "you MUST invoke first". The skill never writes this pointer itself.

---

## 4. SKILL.md outline

**Budget: at most 270 lines and 18,000 characters (about 4,500 tokens).** Why: after auto-compaction, Claude Code "re-attaches the most recent invocation of each skill after the summary, keeping the first 5,000 tokens of each". Under that size, all of SKILL.md survives compaction. Claude Code also "does not re-read the skill file on later turns", so every section is a standing instruction. If a build goes over 18,000 characters, move "Router: symptoms" to `pipeline.md` §G and keep a 2-line pointer.

| # | Heading | Contents | Lines |
|---|---|---|---|
| 0 | frontmatter | §3 | 26 |
| 1 | `# Web performance` | Goal: a reliable, fast trading UI. Rules are filed by the user's layer categories and tagged by pipeline stage. Three modes. "Project rules (CLAUDE.md, AGENTS.md) win over this skill." | 5 |
| 2 | `## Pick the mode` | Table 4.1 | 9 |
| 3 | `## How to work` | 5 steps (4.2) | 9 |
| 4 | `## Router: what are you writing?` | Table 4.3 (16 rows) plus 5 common pairs | 28 |
| 5 | `## Router: symptoms` | Table 4.4 (13 rows) plus the INP note | 18 |
| 6 | `## The pipeline on one screen` | Table 4.5 (13 stages); pointer to `pipeline.md` for stage cards | 18 |
| 7 | `## Budgets and the chart contract` | 4.6 | 14 |
| 8 | `## Always-on rules` | 10 lines with IDs (4.7) | 13 |
| 9 | `## Default habits to replace` | 18-row table (4.8) | 22 |
| 10 | `## Mode 1: performance notes` | Format and example (4.9) | 12 |
| 11 | `## Mode 2: review` | 5 steps (4.10) | 8 |
| 12 | `## Mode 3: measure` | The loop in short form (4.10) | 9 |
| 13 | `## Honesty rules` | 6 lines (4.11) | 8 |
| 14 | `## Browser support, versions and library facts` | 4.12 | 7 |
| 15 | `## Reading the references` | Rule shape, `→ ID`, greps by stage and category | 7 |
| 16 | `## Scope` | 3 lines (4.12) | 4 |
| | **Total** | about 215 lines of content plus blank lines | **~255** |

The order puts the most-used parts first.

### 4.1 Pick the mode (exact)

```markdown
| The request | Mode | Output |
|---|---|---|
| Write or change frontend code | 1 Write | The code, then "Performance notes" |
| "review", "audit", "check before the PR", or `ARGUMENTS: review …` | 2 Review | A report from `references/review.md`. No code edits unless asked |
| "is it faster?", "profile", "trace", a URL, `ARGUMENTS: measure …`, or you are about to call a change faster | 3 Measure | A measured-result table from `references/measure.md` |
| "why is X slow?", "find the cause" | Diagnose | The cause and a proposed fix, with evidence labels. Read-only until the user decides |
```

### 4.2 How to work (exact)

```markdown
1. Explore first. Read the code you will change, its callers, and the installed versions of the libraries it uses (`package.json`; for SciChart also the `.d.ts` typings in `node_modules/scichart`). Then apply this skill.
2. Find what you are writing in the router. Open only those files. Read the checklist at the top, then only the rules you need: `grep -n '^### CSS-08 ' <file>`, then read about 20 lines.
3. Small, low-risk edits (text, spacing, colors, types, renames): apply the always-on rules, open nothing, write no notes.
4. Hot paths (per frame, per tick, per point), render loops, live data, GPU code and long-lived views: open the files even when the edit is small.
5. These are standing instructions for the whole session. If compaction dropped a reference, open it again.
```

### 4.3 Router: what are you writing? (exact; this is the routing table)

```markdown
| You are writing or changing… | Code signals | Open |
|---|---|---|
| The HTML document, `<head>`, script/style/link tags, resource hints, bundle or route splitting, startup JS | `index.html`, `app.html`, `<script`, `<link rel=`, `fetchpriority`, `vite.config`, `import(` | `references/html-loading.md` |
| Images, icons, fonts, video, embeds, the largest above-the-fold element | `<img`, `<picture`, `srcset`, `@font-face`, `<video`, `<iframe` | `references/html-media-and-fonts.md` |
| CSS rules, layout, containment, transitions, animations, WAAPI, view transitions, scroll effects | `.css`, `<style>`, `transition`, `@keyframes`, `will-change`, `contain`, `.animate(` | `references/css-rendering.md` |
| Event handlers: pointer, wheel, touch, key, scroll, resize, drag, gestures | `addEventListener`, `onpointermove`, `onwheel`, `setPointerCapture`, `touch-action` | `references/js-events-and-input.md` |
| Work that can take over 50 ms (parse, indicator math, sort, filter), yielding, timers, workers, Wasm | loops over 10k+ items, `setTimeout`, `setInterval`, `new Worker`, `postMessage`, `WebAssembly.` | `references/js-scheduling-and-workers.md` |
| DOM building, long lists and tables (order book, watchlist, blotter), dialogs, popovers | `{#each`, `.map(` to nodes, `innerHTML`, `createElement`, 100+ rows | `references/js-dom-and-lists.md` |
| Live data and network: WebSocket or SSE feeds, tick handlers, `fetch()`, service worker | `WebSocket`, `EventSource`, `onmessage`, `fetch(`, `serviceWorker` | `references/js-live-data-and-network.md` |
| Mount and unmount, subscriptions, observers, caches, storage, hidden tabs, bfcache, reactive state that holds big or fast data | `onDestroy`, effect cleanup, `Map` caches, `localStorage`, `visibilitychange`, `pagehide`, `$state` | `references/js-lifecycle-and-memory.md` |
| Code that runs per tick, per frame or per point: object models, numeric arrays, formatting, JSON, RegExp | `class Candle`, arrays of objects, `toLocaleString`, `Intl.`, `JSON.`, `new RegExp` in loops | `references/v8-hot-code.md` |
| Your own canvas or render loop: size, DPR, Canvas 2D drawing and text, layers, OffscreenCanvas | `<canvas`, `getContext('2d')`, `requestAnimationFrame`, `devicePixelRatio`, `ResizeObserver` | `references/gpu-canvas-and-frames.md` |
| WebGL2 or WebGPU: buffers, shaders, textures, draws, readback, context loss | `gl.`, `WebGL2RenderingContext`, `GPUDevice`, `.wgsl`, `.glsl`, `#version 300 es` | `references/gpu-webgl-webgpu.md` |
| SciChart.js surfaces, data series, renderable series, annotations, modifiers | imports from `scichart`, `SciChartSurface`, `XyDataSeries`, `wasmContext` | `references/scichart.md` |
| A performance review | "review", "audit", a diff or a path | `references/review.md`, then the rows above |
| A measurement, "is it faster?", a trace, a profile | a URL, "trace", "profile", "measure", "benchmark" | `references/measure.md` |
| A pipeline stage, a DevTools event or insight name, "why does X cost" | "Recalculate style", "Layerize", LoAF, "presentation delay" | `references/pipeline.md` |
| Browser support, a deprecation, a version | "is X supported", "can I use", "deprecated" | `references/support.md` |

Common pairs in trading UIs:
- Chart feature with live data → `js-live-data-and-network` + `scichart` (+ `gpu-webgl-webgpu` for a custom renderable series)
- Drawing tool or annotation with drag → `js-events-and-input` + `scichart` (or `gpu-canvas-and-frames` for your own canvas)
- Text labels on a GPU chart → `gpu-canvas-and-frames` §D + `gpu-webgl-webgpu` §F
- Order book, watchlist, blotter → `js-live-data-and-network` + `js-dom-and-lists` + `css-rendering` §C
- Indicator over long history → `js-scheduling-and-workers` + `v8-hot-code`
```

### 4.4 Router: symptoms (exact)

```markdown
| Symptom or metric part | Check this stage first | Open |
|---|---|---|
| First load slow or blank; LCP resource load delay | parse, network | `html-loading` §D, `html-media-and-fonts` §A |
| LCP: high TTFB or long resource load duration | network | `html-loading` §G, `html-media-and-fonts` §B |
| LCP: element render delay | cssom, script-load | `html-loading` §B–§C |
| Click or key feels late (INP): input delay | tasks, script-load | `js-scheduling-and-workers` |
| INP: processing duration | tasks, js | `js-events-and-input`, `v8-hot-code` |
| INP: presentation delay | style, layout, paint | `css-rendering` §C–§D, `js-dom-and-lists` |
| Content jumps (CLS), flicker, pop-in | layout | `html-media-and-fonts` §E, `css-rendering` §C, `gpu-canvas-and-frames` §B |
| Pan, zoom, drag or streaming stutters | tasks, gpu-upload, gpu-draw | `gpu-canvas-and-frames`, `scichart`, `gpu-webgl-webgpu` |
| A CSS animation or scrolling janks | composite, paint | `css-rendering` §A–§B |
| The first chart is slow to appear | script-load, gpu-draw | `scichart` §H, `gpu-webgl-webgpu` §B |
| Memory grows over hours; the tab crashes | memory | `js-lifecycle-and-memory`, `scichart` §G |
| CPU or fans busy while the app is idle | tasks, gpu-draw | `gpu-canvas-and-frames` §A, `js-lifecycle-and-memory` §C |
| Slow after the user returns to the tab | memory, network | `js-lifecycle-and-memory` §C |

INP does not measure scroll, hover, pan or zoom. Those are frame-time problems: measure them with `measure.md#fps`.
```

### 4.5 The pipeline on one screen (exact)

```markdown
| # | Stage (tag) | What costs time | In a trace | Rules mostly in |
|---|---|---|---|---|
| 1 | Network (`network`) | connections, bytes, priority, caching, next navigation | Network track; `DocumentLatency`, `NetworkDependencyTree`, `Cache` | html-loading, js-live-data-and-network |
| 2 | Parse and discovery (`parse`) | HTML parser, preload scanner, script attributes, lazy loading | "Parse HTML"; `LCPDiscovery`, `RenderBlocking` | html-loading, html-media-and-fonts |
| 3 | Render-blocking CSS and fonts (`cssom`) | blocking stylesheets, `@import`, font swap | "Parse stylesheet"; `RenderBlocking`, `FontDisplay` | html-loading, html-media-and-fonts |
| 4 | Script load (`script-load`) | download, compile, evaluate startup JS and Wasm | "Compile script", "Evaluate script"; `LegacyJavaScript`, `DuplicatedJavaScript` | html-loading, scichart |
| 5 | Tasks and scheduling (`tasks`) | event loop, input handlers, timers, rAF, workers | long tasks, LoAF, "Animation frame fired"; `INPBreakdown` | js-events-and-input, js-scheduling-and-workers |
| 6 | JS execution (`js`) | hot-path JS in V8: shapes, arrays, allocation | Bottom-up self time, "Minor GC" | v8-hot-code |
| 7 | Style (`style`) | selector matching, invalidation scope | "Recalculate style"; `SlowCSSSelector` | css-rendering |
| 8 | Layout (`layout`) | layout, forced reflow, shifts, DOM size | "Layout"; `ForcedReflow`, `CLSCulprits`, `DOMSize` | css-rendering, js-events-and-input, js-dom-and-lists |
| 9 | Paint and raster (`paint`) | paint, raster, image decode, Canvas 2D drawing | "Pre-paint", "Paint", "Rasterize paint", "Image decode" | css-rendering, gpu-canvas-and-frames |
| 10 | Composite (`composite`) | layers, compositor-only animation | "Layerize", "Commit"; Animations track | css-rendering |
| 11 | GPU upload (`gpu-upload`) | buffers, textures, data types, text to texture | frame spikes when data changes; GPU track | gpu-webgl-webgpu, gpu-canvas-and-frames, scichart |
| 12 | GPU draw (`gpu-draw`) | draw calls, state, passes, readback | GPU track; long frames with little main-thread time | gpu-webgl-webgpu, scichart |
| 13 | Memory and lifecycle (`memory`) | GC, leaks, teardown, hidden or off-screen work | heap snapshots, "Major GC" | js-lifecycle-and-memory, scichart |

Stage cards (what runs, thread, what blocks it, budget, wrong beliefs): `references/pipeline.md` §H. Initial-load phases and the code that controls each: §B.
```

`pipeline.md` is the source for this table. The SKILL.md copy is an index of names and file pointers only. The lint checks that the 13 stage words match `pipeline.md` §J.

### 4.6 Budgets and the chart contract (exact)

```markdown
- Frame: 16.7 ms at 60 Hz, 8.3 ms at 120 Hz. Keep app script to about half of it. Read the real refresh rate from rAF deltas; do not assume 60 Hz.
- Task: 50 ms at most. Input: the visible response comes in the next frame.
- Field "good" at p75: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. Guides: FCP ≤ 1.8 s, TTFB ≤ 0.8 s.
- Lab, per scenario (report only at first): no long animation frame over 50 ms, max frame gap < 75 ms, non-input CLS per interaction < 0.02.
- Memory: after warm-up, growth per repeated action stays within noise; DOM nodes, canvases, contexts and chart surfaces return to baseline.
- Canvas memory = CSS width × CSS height × DPR² × 4 bytes × layers × instances. Default DPR cap: 2.
- Chart contract. Before you build or change a chart feature, write 8 values in a comment or the plan: surfaces per view; series per surface; points per series (initial and maximum); update rate (normal and peak); visible window; DPR cap; degradation policy (what drops first under load); teardown owner. The contract sets the test scale and the measurement scenario.
```

Sources: web.dev vitals thresholds (`03` reference table, `verify/02`); dejank per-interaction budgets; Modern Web Guidance work-size heuristic; OpenAI canvas memory formula; webgpu-skill and OpenAI "contracts" (both surveys).

### 4.7 Always-on rules (exact)

```markdown
Apply these to every edit, even when no reference is open.
1. Feedback first: an input handler makes the visible change for the next frame, then yields (EVT-01).
2. One visual update per frame: coalesce pointer, wheel and data ticks; the latest value wins (EVT-03, DATA-06).
3. Read layout, then write styles. Never read layout after a style write in the same task; cache geometry from ResizeObserver (EVT-07, EVT-08).
4. Size the work before you place it: under 50 ms, run it inline; 50–250 ms, slice it and yield on a 50 ms deadline; over 250 ms, use a worker (TASK-02).
5. Render on demand: every loop has a stop condition, and it stops when nothing changed, when the tab is hidden, or when the panel is off-screen (CNV-02, CNV-20).
6. Per frame or per tick: no allocations kept across frames, no GPU object creation, no shader compiles, no synchronous readback (V8-07, GPU-05, GPU-27).
7. Keep high-rate values (pointer position, last price, scroll offset) out of reactive framework state (DATA-08).
8. Every listener, timer, observer, subscription, socket, chart and GPU resource has one owner that tears it down (LIFE-01).
9. Code with only a happy path is not done: add the error path and the teardown path, and test at the scale in the chart contract, not with 10 points.
10. Use the platform before a new dependency, and work inside the existing stack. Feature-detect anything that is not Baseline Widely available (`support.md`).
```

### 4.8 Default habits to replace (exact)

These are the mistakes that agents make by default (Mapbox "happy path only", LogRocket's comparison, TradingView, and the stale facts found in both surveys).

```markdown
| Default habit | Replace with | Rule |
|---|---|---|
| `pointermove` reads `getBoundingClientRect()` or `offsetX` and writes `style.left/top` | Rect cached from ResizeObserver and scroll; one `transform` write in rAF | EVT-08 |
| `debounce(100)` on scroll or resize for a visual update | Passive listener + rAF; `scrollend`; ResizeObserver | EVT-11 |
| `setTimeout(…, 300)` to wait for an animation | `animation.finished`, `transitionend` | CSS-16 |
| Animating `top`, `left`, `width`, `height`, blur or shadow | `transform` and `opacity`; FLIP; fade a pre-blurred layer | CSS-01, CSS-02 |
| `will-change` or `translateZ(0)` in base CSS | Add it just before the motion, remove it after | CSS-05 |
| `toLocaleString()` or `new Intl.NumberFormat()` per tick | One cached formatter per locale and options | V8-09 |
| Arrays of `{ time, open, … }` objects for 1M points | `Float64Array` columns | V8-04 |
| `await Promise.resolve()` or `queueMicrotask` as a "yield"; `await` per item | `scheduler.yield()` on a 50 ms deadline, with a fallback | TASK-03, TASK-04 |
| `requestIdleCallback` for input work; `isInputPending()` | Feedback, then yield; rIC only for deferrable work, with a timeout and a Safari fallback | TASK-07 |
| `setInterval` polling; timers that drive visuals | Events, observers, push; rAF for visuals | TASK-09 |
| `series.append` per message; the dataset replaced per tick | Buffer, one `appendRange` per frame; update the forming candle in place | SC-02, SC-04 |
| A chart created in a reactive block that runs again | Create once per mount; `delete()` once in cleanup | SC-28 |
| Unix-ms timestamps in a `Float32Array` or a float uniform | Subtract a float64 origin first | GPU-14 |
| A new canvas or texture per label per frame | Rasterize only when the string changes; atlas with dirty sub-rectangles | GPU-24 |
| `loading="lazy"` on the hero image; preload everything | `fetchpriority="high"` on the LCP image; preload only late-discovered resources | MEDIA-02, HTML-12 |
| A new library for a dialog, tooltip, menu or positioning | `<dialog>`, `popover`, anchor positioning (check `support.md`) | DOM-09 |
| FID, TTI, `performance.memory` or a Lighthouse score as the target | INP, LCP, CLS, frame p95, memory slope; traces and insights | `measure.md` |
| "It is GPU-accelerated, so it is smooth" | "Hypothesis; verify with measure.md#fps" | Honesty rules |
```

### 4.9 Mode 1: performance notes (exact)

```markdown
After code that touches a hot path, a load path, a render loop or a lifecycle, add at most 4 bullets. Name only choices that are not the default. Format: "<Stage> (<rule>): <choice>. Cost: <trade-off>." End with "Not measured" and the recipe, unless you measured. Skip the block for trivial edits.

Performance notes
- Tasks (EVT-03): pointer moves are coalesced into one rAF. Cost: the label can trail the pointer by one frame.
- Layout (EVT-08): the pane rect comes from ResizeObserver and scroll. Cost: refresh it if the pane moves without a resize.
- GPU upload (GPU-24): the label texture is rebuilt only when the formatted price changes. Cost: one atlas page of GPU memory.
- Not measured. Verify: measure.md#fps, drag scenario.
```

### 4.10 Mode 2 and mode 3 in SKILL.md (exact)

```markdown
## Mode 2: review
1. Scope the files or the diff. Read them and the installed library versions.
2. Route each region with the router. Read those checklists. Run their Detect patterns over the scope (`grep -h '^- Detect:' <files>`), then confirm each match by reading the code.
3. Also check what is missing: teardown, error path, test scale, hidden-tab behavior, degradation policy, chart contract.
4. Keep at most 10 findings, strongest first. Prefer silence to nitpicks. If the code is already fast, say so.
5. Group findings by pipeline stage, label the evidence (M, S, H), and give a fix and a Verify line for each. Template: `references/review.md`.

## Mode 3: measure
Define the scenario, metric and pass condition → baseline, 5 runs on unchanged code (use a separate git worktree when the change already exists; never stash or reset the user's changes) → one change → the same 5 runs → `node ${CLAUDE_SKILL_DIR}/scripts/compare-runs.mjs base.json after.json` → keep a win; revert a neutral or regressed change → one ledger row.
Record the Chrome version, GPU renderer, DPR, profile and build. Save traces and heap snapshots to files; never read them raw into the context. Steps and recipes: `references/measure.md`.
```

### 4.11 Honesty rules (exact)

```markdown
1. A finding from reading code is a hypothesis. Label it "not measured" and name the recipe that would verify it.
2. Write "faster", "smooth", "60 fps", "no jank" or "GPU-accelerated" only with a recorded measurement. State the device, profile, build and run count with every number.
3. Change one thing per measurement. A change that does not beat run-to-run noise is neutral: revert it, or keep it for a stated non-performance reason.
4. Correctness gates the metric. A win that needed a test changed or deleted is a regression.
5. Lab data does not prove field INP. Claim a field improvement only after new field data arrives.
6. When the checks show no problem, say that the code is already fast. Do not invent work.
```

Sources: Addy Osmani agent-skills and auditor (metric honesty, revert neutral changes, correctness gates), zero-jank-scroll "honest output", Cloudflare "skip non-issues", corewebvitals.io (lab vs field). All in the two surveys.

### 4.12 Support, reading, scope (exact)

```markdown
## Browser support, versions and library facts
Never state a browser version, Baseline status, API shape, DevTools MCP flag or library version from memory. Read the row in `references/support.md` and quote its "checked" date. If the date is more than 90 days old, or the row is missing, re-check on api.webstatus.dev or MDN (ask before you browse), update the row, and say so.
Policy: Widely available → use freely. Newly available → use it and name the fallback in the notes. Limited → feature-detect and ship the fallback in code. Chromium-only diagnostics (LoAF, measureUserAgentSpecificMemory) need no fallback. The project's own policy (browserslist, AGENTS.md) wins.
Library facts come from the installed package. An API name that is not in the installed typings does not exist.

## Reading the references
- A rule is an ID and title, one tag line (stage · metric · when · impact · support · also), then Do, Why, Detect, Verify, Example, Avoid, Source.
- `→ ID` in a checklist means that the rule lives in another file.
- Rules by stage: `grep -n -B1 '^stage: [^·]*\blayout\b' ${CLAUDE_SKILL_DIR}/references/*.md`. Rules by category: the file prefix (`html-`, `css-`, `js-`, `v8-`, `gpu-`).

## Scope
- Not for backend, CI or infra code. Project rules (CLAUDE.md, AGENTS.md) win over this skill.
- Do not add dependencies or migrate libraries for performance unless the user asks. Apply the rules inside the existing stack.
- Correctness first. Performance is a pass after correctness.
```

---

## 5. Reference files

### 5.0 Conventions for every rule file

- Line 1: `# <Title> (<PREFIX>-)`. Line 3: "Open this when you write …". Line 4: the stage cards to read (`pipeline.md` §H, by stage).
- Then `## Checklist`: one table row per rule (ID · imperative · impact · first stage), grouped under the section letters. Up to 6 `→ ID` lines point to rules in other files. **The checklist is the table of contents.** skill-creator asks for a TOC on references over 300 lines; Anthropic's best-practices page asks for one over 100 lines. The checklist meets both.
- Then the sections with full rules, then `## One-line rules`.
- A full rule has at most 18 lines. An example has at most 14 lines of code. IDs are `<PREFIX>-<nn>`. An ID is stable after release, and a removed rule leaves a gap that is never reused.
- "Feeds" below names the notes and their section letters. The `verify/*` corrections apply first. `01-critical-rendering-path.md` is the canonical copy (`.run2.md` is byte-identical, `.run1.md` is superseded, `.run2-new.md` is a subset).

### 5.1 `pipeline.md` (~300 lines, no rules)

- **Scope:** the mechanism, and only the mechanism. It is category 1 (CRP phases and the code that affects each), and it holds the stage vocabulary for tags and reports.
- **Feeds:** `01` phase map (tables a and b, threads); `verify/01` (Paint Holding: FCP or 500 ms); `05` §E (which property change causes layout, paint or only composite); `06` §A (slots), §H (layout-forcing APIs); `03` thresholds table; `14` insight table (19 names); `raw/TraceEvents.ts`, `raw/TimelineUIUtils.ts`, `raw/tl-ref.txt` (event names and `Layout` arguments); `raw/how_cc_works.md` (threads); `raw/ins-*.txt` (insight pages).
- **TOC:**
  - §0 How to use this file
  - §A Threads and processes (Chromium; other engines differ in detail)
  - §B Initial load, 12 phases: phase · what blocks it · **code that controls it** · DevTools event · stage tag · rule file
  - §C The update frame in spec order: input → event tasks → rAF → style → layout → ResizeObserver → IntersectionObserver → paint → commit → raster → draw → present
  - §D Event-loop slots (task, microtask, rAF, ResizeObserver, idle) and "after the next paint" = rAF, then a task
  - §E Property → pipeline cost (layout, paint, composite only), from current Blink data
  - §F The APIs that force style or layout
  - §G Metrics → stages: LCP subparts (targets: TTFB about 40%, load delay under 10%, load duration about 40%, render delay under 10%); INP phases; CLS; "INP does not cover scroll, hover, pan or zoom"; the smoothness metrics
  - §H Stage cards, 13 × about 9 lines: what runs · thread · what blocks it · trace events · insights · budget · common wrong beliefs · rule files (by name, no ID lists)
  - §I Insight name (19) → stage → rule file
  - §J Stage vocabulary (13 tags ↔ 17 note tags) and the greps

### 5.2 `html-loading.md` (HTML-, ~320 lines, about 20 full + 8 one-line)

- **Scope:** the document, the `<head>`, script and link tags, resource hints, fetch priority, bundles and startup JS, next navigation, and the HTTP headers that the front end controls.
- **Feeds:** `01` (Navigation and TTFB; HTML parse and the head; Preload scanner and fetch priority, without image items; CSSOM; Scripts; Tooling: Coverage); `02` (General HTML; Critical path; Optimize resource loading; Resource hints); `03` §A, §C, §F; `04` §A, §B, §C (not images), §E, §F, §G; `05` §G; `08-v8-index` §8 rule 6 and `09-v8-consolidated` (pending: code cache, compile hints, lazy parsing, `JSON.parse`); `17-collections-batch-03` (prefetch, speculation); `16-explore-fast-batch-*` (pending: JS, CSS, third parties, budgets); `verify/01`, `verify/02`.
- **TOC:**
  - §0 Directive map (about 20 lines): each HTML directive → early / late / priority effect → rule ID
  - §A Document and head: HTML-01 charset in the first 1024 bytes, and the viewport · HTML-02 a lean head in order; small inline scripts above stylesheets; no `document.write` · HTML-03 server-render or stream the first view; never build the LCP element in client JS
  - §B Scripts: HTML-04 `type="module"` or `defer` by default; `async` only for independent scripts · HTML-05 no injected startup scripts; `fetchpriority` on scripts instead of preload hacks · HTML-06 `blocking="render"` only for a known flash (one-line)
  - §C CSS delivery: HTML-07 no CSS `@import` · HTML-08 small render-blocking CSS, split by route and `media` · HTML-09 inline critical CSS only with a CSP-safe loader (no inline `onload`)
  - §D Discovery and priority: HTML-10 critical resources as plain tags in server HTML · HTML-11 preconnect to at most 2 origins with `crossorigin`; `dns-prefetch` for the rest · HTML-12 preload only late-discovered resources, with matching `as`, `crossorigin` and `imagesrcset`; `modulepreload` for module waterfalls · → DATA-13 `priority` on background `fetch()`
  - §E Bundles and startup JS: HTML-14 `import()` for features that are not in the first view (dialogs, rare tools, the chart library → SC-35) · HTML-15 chunks of about 100 KB; module paths, not barrel files, on startup routes · HTML-16 modern output: no `nomodule`, no promise polyfills, no ES5 · HTML-17 code cache: stable external URLs and deterministic startup; compile hints only on a small core file; `JSON.parse` for big literals · HTML-18 third-party facades, loaded after interaction; self-host critical third-party code with SRI
  - §F Next navigation: HTML-19 speculation rules with conservative eagerness; prerender only side-effect-safe pages · HTML-20 SPA route changes as soft navigations (feature-detect)
  - §G HTTP headers the front end controls (one-line rules): hashed immutable assets with `no-cache` HTML; `private, no-cache` (not `no-store`) for personalized HTML that is not sensitive; Brotli or zstd; 103 Early Hints; Server-Timing; no redirect hops
  - §H One-line rules
  - Pointers: → MEDIA-01, MEDIA-02 (LCP image) · → LIFE-07 (bfcache) · → DOM-09 (native HTML instead of JS libraries)

### 5.3 `html-media-and-fonts.md` (MEDIA-, ~200 lines, about 12 full + 6 one-line)

- **Scope:** every `<img>`, `<picture>`, SVG icon, `@font-face`, `<video>` or embed, the LCP element, and reserved space.
- **Feeds:** `01` (LCP image items; Fonts and media on the critical path); `02` (Image performance; Video; Web fonts); `03` §B, §E, §G; `04` §D; `05` §H; `12` §E (`img.decode()`, `decoding`); `16-explore-fast-batch-*` (pending: images, lazy loading, fonts); `verify/02` (`fetchpriority` versions; `sizes="auto"` in Safari 27 with a fallback list).
- **TOC:**
  - §A LCP element: MEDIA-01 an `<img>` in server HTML, not a CSS background, `data-src` or a JS insert · MEDIA-02 `fetchpriority="high"` on it, never `loading="lazy"`; low priority for hidden above-the-fold images
  - §B Images: MEDIA-03 display size × DPR (cap about 2×), `srcset` and `sizes`, AVIF or WebP through `<picture>` · MEDIA-04 `width`/`height` or `aspect-ratio` on every image, video and canvas host · MEDIA-05 native lazy loading below the fold only; `sizes="auto, <fallback list>"` · MEDIA-06 `img.decode()` before inserting JS-created images; `decoding="async"` only for non-critical images
  - §C Fonts: MEDIA-07 `@font-face` that the parser can find; preload 1–2 fonts with `crossorigin`; no `fetchpriority` on fonts · MEDIA-08 `font-display` by role · MEDIA-09 a metric-matched fallback derived from the real font pair · MEDIA-10 WOFF2, subsets, `unicode-range`, fewer files (system or variable fonts)
  - §D Video and embeds: MEDIA-11 poster, `preload="none"` or `"metadata"`, muted loop video instead of GIF, facades for heavy embeds
  - §E Reserve space: MEDIA-12 late content goes into pre-sized slots, never above what the user is reading; toasts in an overlay; `scrollbar-gutter` · → CSS-09 (`content-visibility` needs `contain-intrinsic-size`)
  - §F One-line rules

### 5.4 `css-rendering.md` (CSS-, ~340 lines, about 21 full + 10 one-line)

- **Scope:** every CSS rule and every piece of motion on DOM elements.
- **Feeds:** `01` (Style and layout; Paint, layers and compositing); `03` §G, §H (selectors); `05` §A–§F, §I, §J; `06` §D (prefer CSS or WAAPI); `17-collections-batch-01` (WAAPI items), `-02` (reduced motion, blur, `will-change`), `-03` (WAAPI, scroll-driven), `-04` (18 animation items); surveys: ibelick, iart, GSAP (conflict on `will-change`), Modern Web Guidance (`content-visibility` on panels that stay on screen).
- **TOC:**
  - §0 Pointer: the property → layout/paint/composite table is `pipeline.md` §E
  - §A Compositor-only motion: CSS-01 animate `transform` and `opacity`; FLIP or `scaleX` for size changes · CSS-02 fade a pre-blurred layer; no animated blur, shadow, or `backdrop-filter` over changing content · CSS-03 keep a composited animation eligible (known fallback conditions); do not animate custom properties that feed `transform` or `opacity`, or inherited ones · CSS-04 individual `translate`, `scale`, `rotate`; never animate geometry and `transform` on one element
  - §B Layers and GPU memory: CSS-05 `will-change` just before the motion, removed after; no `translateZ(0)` · CSS-06 avoid layer explosion from overlap; keep layer textures small · CSS-07 no rounded `overflow: hidden` clips around animated layers or canvases without need
  - §C Containment and skipped rendering: **CSS-08 contain each independent panel (example rule, §6.1)** · CSS-09 `content-visibility: auto` with `contain-intrinsic-size: auto <length>` on off-screen or self-contained regions (→ CNV-20 to pause loops) · CSS-10 `content-visibility: hidden` for views that come back soon · CSS-11 `container-type: inline-size`; never resize query containers every frame
  - §D Style recalculation scope: CSS-12 simple selectors, checked with Selector Stats; toggle state on the smallest element · CSS-13 no `:nth-child()` or sibling combinators on lists that mutate; anchor `:has()` narrowly · CSS-14 fast-changing custom properties off `:root`, registered with `inherits: false`
  - §E Paint cost: CSS-15 small, separate repaint areas; no large animated gradients or backgrounds
  - §F WAAPI and CSS animation mechanics: CSS-16 sequence with `finished` and `ready`, not timers · CSS-17 `commitStyles()` then `cancel()`, no endless fill; retarget with an implicit start keyframe; `play()` on a kept Animation instead of a class toggle plus a reflow · CSS-18 one animation owner per element; `getAnimations()` to pause hidden panels; gate re-triggers on `finished`
  - §G Scroll effects, view transitions, reduced motion: CSS-19 scroll-driven animations only as progressive enhancement · CSS-20 small view transitions (short callback, few named elements) · CSS-21 `prefers-reduced-motion` also stops JS, WAAPI, canvas and WebGL motion (listen for `change`)
  - §H One-line rules (`text-wrap: balance` on short text only, `overscroll-behavior: contain`, scroll anchoring, `image-rendering: pixelated`, `display: none` at the end of exit animations, and others)

### 5.5 `js-events-and-input.md` (EVT-, ~260 lines, about 13 full + 5 one-line)

- **Scope:** every event listener and every gesture, including drawing-tool drags.
- **Feeds:** `01` (The update frame: passive listeners, coalesced events, layout reads in pointer handlers, paint first); `03` §H; `05` §I; `06` §G, §H, §I; `17-collections-index` §1 (INP collection); surveys: Vercel transient values and passive listeners, Copilot J3/J4, OpenAI pointer capture.
- **TOC:**
  - §A The INP model: EVT-01 feedback first, then yield; `preventDefault()` before any `await` · EVT-02 diagnose by subpart before you fix (→ `pipeline.md` §G)
  - §B High-rate input: EVT-03 coalesce `pointermove`, `wheel` and scroll-driven visuals into one rAF; the latest value wins · EVT-04 `getCoalescedEvents()` only for drawing precision; `getPredictedEvents()` for latency · EVT-05 drags with `setPointerCapture`, and cleanup on `pointerup`, `pointercancel` and `lostpointercapture` · EVT-06 no style writes in input handlers followed by layout reads in rAF
  - §C Layout reads: EVT-07 read layout first, then write; never alternate in a loop · EVT-08 a rect cached from ResizeObserver and scroll instead of `getBoundingClientRect()` or `offsetX` per event
  - §D Listener options: EVT-09 passive touch and wheel listeners; non-passive only on the chart surface, with `touch-action` declared and a comment that says why · EVT-10 delegation for large or re-rendered collections; one shared global listener per event type
  - §E Debounce, throttle, cancel: EVT-11 throttle visual reactions to rAF; debounce only non-visual work; `scrollend` · EVT-12 cancel superseded work (`AbortController`, `AbortSignal.any`, `AbortSignal.timeout`) · EVT-13 logging, analytics and persistence off the input path
  - §F Pointers: → LIFE-01, LIFE-02 (listener lifetime)
  - §G One-line rules

### 5.6 `js-scheduling-and-workers.md` (TASK-, ~280 lines, about 14 full + 6 one-line)

- **Scope:** anything that can block the main thread; the scheduling primitives; timers; workers; Wasm.
- **Feeds:** `06` §A, §B, §C, §F, §K; `01` (break long tasks; paint the response first); `03` §D, §H; `07` §A, §J, §K; `17-collections-batch-03` (worker types, SharedArrayBuffer, channels); Modern Web Guidance (deadline yield, work-size heuristic); `09-v8-consolidated` (pending: async, Wasm).
- **TOC:**
  - §0 Primitive map (about 15 lines): task, microtask, rAF, rIC, `postTask`, `MessageChannel`, `setTimeout`, worker → when each runs → use it for
  - §A Tasks and frames: TASK-01 each task at most 50 ms, and shorter while something animates; there is no frame between small tasks
  - §B Size the work: TASK-02 time it with `performance.now()`; under 50 ms inline, 50–250 ms slice and yield, over 250 ms a worker
  - §C Yield: TASK-03 `scheduler.yield()` with a fallback, on a 50 ms deadline · TASK-04 never "yield" with a promise or `queueMicrotask`; no `await` per item in hot loops · TASK-05 a `MessageChannel` task instead of the 4 ms `setTimeout` clamp · TASK-06 split startup evaluation into smaller tasks
  - §D Priorities and idle: TASK-07 `requestIdleCallback` only for deferrable work, with a timeout and a Safari fallback; never `isInputPending()` · TASK-08 `scheduler.postTask` priorities and `TaskController` abort
  - §E Timers: TASK-09 no timers for visuals; replace polling with events, observers or push; timers are throttled in background tabs
  - §F Workers: TASK-10 one long-lived module worker, created once; pool size from `hardwareConcurrency` · TASK-11 small messages and deltas; transfer `ArrayBuffer`s; `structuredClone`, not JSON round trips · TASK-12 `MessageChannel` between workers; `SharedArrayBuffer` and `Atomics` only under cross-origin isolation, for measured hot paths
  - §G Wasm: TASK-13 Wasm only for measured CPU-bound kernels; cross the boundary rarely and in bulk · TASK-14 `instantiateStreaming` with `application/wasm` and a stable URL; SIMD freely; threads only under isolation
  - §H One-line rules

### 5.7 `js-dom-and-lists.md` (DOM-, ~180 lines, about 9 full + 5 one-line)

- **Scope:** code that creates or updates many nodes: lists, tables, grids, dialogs, menus.
- **Feeds:** `01` (keep the DOM small; do not build large DOM in one task); `03` §H (DOM size); `04` §I (native HTML instead of JS); `06` §H (virtualize; the DocumentFragment myth), §I (delegation); `16-explore-fast-index` (client-side rendering); `15-gaps-round-*` (pending; virtualization expected); surveys: Vue (flatten list items), bklit (split hover state from geometry).
- **TOC:**
  - §A DOM size: DOM-01 a small DOM; create hidden UI on demand (DOMSize thresholds: `pipeline.md` §I)
  - §B Lists and tables: DOM-02 virtualize long lists with fixed row heights · DOM-03 key by id, never by index · DOM-04 high-rate rows (order book, watchlist): a fixed row set updated in place (`textContent`), changed rows only; flash with an opacity overlay, not a `background-color` animation · DOM-05 flatten list items: no wrapper components per row
  - §C Building DOM: DOM-06 build large DOM in chunks across tasks · DOM-07 clone a `<template>`; no `innerHTML` parse per tick; `DocumentFragment` is not the speed-up (write batching is) · DOM-08 keep hover state apart from data and geometry state, so a hover does not recompute geometry
  - §D Native components: DOM-09 `<dialog>`, `popover`, anchor positioning, `<details>`, `inert`, `hidden="until-found"` before a JS library
  - §E Pointers: → EVT-10 (delegation) · → CSS-08, CSS-09 (containment)
  - §F One-line rules

### 5.8 `js-live-data-and-network.md` (DATA-, ~260 lines, about 14 full + 6 one-line)

- **Scope:** the path from a socket or a `fetch()` to pixels in a trading UI; service worker at low depth.
- **Feeds:** `07` §A (SharedWorker, Web Locks, BroadcastChannel), §B, §E; `06` §D (coalesce), §I (cancel); `10` "Render on demand and coalesce data ticks into one frame"; `13` §A (pointer to SC-02); `17-collections-batch-01/02/03` (cache strategies, bounded caches, cached data first, navigation preload); surveys: TradingView (incremental updates), OpenAI (degradation policy), wondelai (transport, heartbeat, backoff).
- **TOC:**
  - §A Feed contract: DATA-01 write it before code (peak rate, payload size, consumers, maximum latency, degradation policy)
  - §B Ingest: DATA-02 transport by direction (SSE one-way, WebSocket two-way); heartbeats; reconnect with capped exponential backoff; queue outgoing messages while down · DATA-03 compact or binary payloads; decode in a worker when decoding breaks the frame budget; transfer `Float64Array`s · DATA-04 backpressure: bounded queues; drop or aggregate by the policy
  - §C Store: DATA-05 ring buffers and typed-array columns; the latest value wins per key; a float64 time origin (→ GPU-14)
  - §D Deliver to the UI: DATA-06 flush once per frame · DATA-07 append, or update the last point; never replace the dataset per tick (→ SC-02, SC-04) · DATA-08 high-rate values out of reactive state; throttle consumers that are not visual
  - §E Tabs and lifecycle: DATA-09 one feed connection for all tabs (SharedWorker, or Web Locks plus BroadcastChannel) · DATA-10 hidden tab: pause UI delivery, and resync from the latest state on return (→ LIFE-06, LIFE-07)
  - §F Degradation: DATA-11 drop or aggregate old ticks, lower the update rate, pause off-screen consumers, and show the degraded state to the user
  - §G `fetch()`: DATA-12 abort superseded requests · DATA-13 `priority: "low"` for background fetches · DATA-14 stream large responses with backpressure; `CompressionStream` instead of JS libraries
  - §H Service worker (low relevance for the terminal): DATA-15 off the critical path (no no-op fetch handler, static routes, navigation preload); bounded caches; no cache-first opaque responses
  - §I One-line rules

### 5.9 `js-lifecycle-and-memory.md` (LIFE-, ~240 lines, about 11 full + 6 one-line)

- **Scope:** a trading terminal stays open for hours. Ownership, growth, background behavior, bfcache, storage, and the proof that nothing leaks.
- **Feeds:** `07` §D, §F, §G, §H (clear buffers; `measureUserAgentSpecificMemory`); `06` §J; `03` §I; `04` §H; `12` §G (→ CNV for canvases); `17-collections-batch-02` (quota and persistence); surveys: VS Code leak audit (per-call ownership, proof by slope), Chrome memory skill (×10, detached DOM may be a cache), tldraw (disposer contract), Svelte (`$state.raw`).
- **TOC:**
  - §A Ownership and teardown: LIFE-01 one teardown `AbortSignal` per owner for listeners, timers, observers, subscriptions and sockets; `delete()` or `destroy()` for native, GPU and chart objects · LIFE-02 a new controller per call for methods that run many times · LIFE-03 teardown order: stop loops and observers, then release resources, then drop references; `{ once: true }` for lifecycle events · LIFE-04 in pools, each item owns its cleanup; tests that fail on leaks
  - §B Bounded growth: LIFE-05 a cap and eviction on every cache and `Map`; `WeakMap` for element metadata; `WeakRef` only for optional caches; clear the User Timing and Resource Timing buffers; no retained console objects
  - §C Hidden, background, bfcache: LIFE-06 `visibilitychange` to hidden: stop rendering and polling, flush state; to visible: render once from the latest state · LIFE-07 bfcache: no `unload`; close shared connections in `pagehide`, reopen in `pageshow` when `persisted`; `fetchLater` or `sendBeacon` for end-of-session data · LIFE-08 freeze, resume and discards (Chromium) (one-line)
  - §D Storage: LIFE-09 `localStorage` off hot paths; batched IndexedDB transactions; OPFS in a worker; quota and persistence
  - §E Proving no leaks: LIFE-10 repeat N times with GC between, fit the slope; counts back to baseline; `measureUserAgentSpecificMemory()`, never `performance.memory`; detached DOM can be an intentional cache, so ask before you remove references
  - §F Reactive state: LIFE-11 large data that is replaced as a whole goes in non-deep state (Svelte 5: `$state.raw`); derive, do not assign in effects; bind chart engines through the framework's mount and cleanup hooks
  - §G One-line rules

### 5.10 `v8-hot-code.md` (V8-, ~200 lines, about 10 full + 6 one-line)

- **Scope:** code on a hot path. The file opens with a gate: "Fix the algorithm and the call count first. Apply these rules to code that a profile shows as hot, or to code that runs per tick, per frame or per point."
- **Feeds:** `08-v8-index` §2, §3, §7, §8 now; `09-v8-consolidated` (pending; it replaces the §8 drafts); `07` §H (`performance.now()`); surveys: patterns.dev (`Set`/`Map`, hoisted RegExp, with its caveats); Vercel `js-` rules (drop the no-op ones).
- **TOC:**
  - §A Algorithm first: V8-01 binary search on sorted time; one pass for min and max; `Set`/`Map` for repeated lookups; rolling sums for windowed indicators
  - §B Object shapes: V8-02 one constructor sets every field, in the same order, with the final types; no `delete`, no late fields · V8-03 `NaN`, not `null`, for an empty numeric field
  - §C Arrays and numbers: V8-04 packed single-kind arrays; `Float64Array` columns for numeric series · V8-05 `DataView` for binary protocols; BigInt out of hot loops
  - §D Allocation: V8-06 short-lived objects are cheap; survivors cost · V8-07 no closures, arrays or objects per frame that live across frames; reuse scratch buffers
  - §E Builtins: V8-08 hoist `RegExp`; never mutate prototypes, `RegExp` instances or `RegExp.prototype` · V8-09 one cached `Intl` formatter per locale and options · V8-10 the `JSON.stringify` fast path (no replacer, no indent, no `toJSON`); `toSorted()` and `structuredClone` allocate
  - §F Async: V8-11 native `async`/`await`; no transpiled async and no promise polyfills (→ TASK-04)
  - §G Pointers: → HTML-17 (code cache, compile hints) · → TASK-13 (Wasm boundary)
  - §H Myths, do not apply: caching `length`, "try/catch deopts", `DocumentFragment` speed, "Wasm is always faster" (one line each; details in `support.md` §F)

### 5.11 `gpu-canvas-and-frames.md` (CNV-, ~280 lines, about 17 full + 8 one-line)

- **Scope:** your own canvas, a render loop, and Canvas 2D drawing and text. SciChart runs its own loop, so `scichart.md` points here only for custom overlays.
- **Feeds:** `12` §A, §B, §C, §E, §F, §G; `01` (update-frame canvas items); `05` §C (stop loops for skipped charts), §F; `06` §D, §E; `07` §C; `10` (backing store, pixel cap, render on demand, static layers, DOM or 2D overlays); surveys: OpenAI canvas (layers, memory formula, renderer by mark count), Modern Web Guidance (`device-pixel-content-box`, `contentvisibilityautostatechange`), Mapbox (render path by count).
- **TOC:**
  - §A Frame loop: CNV-01 one rAF owner per surface; dirty flags; the latest value wins · CNV-02 render on demand; every loop has a stop condition · CNV-03 motion from the rAF timestamp; only visual work in rAF; "after the next paint" = rAF, then a task
  - §B Backing store and DPR: CNV-04 device pixels from ResizeObserver `device-pixel-content-box` (fallback: `contentRect × DPR`, rounded); set only when the integer size changes; re-apply context state · CNV-05 cap DPR and pixel count; memory = w × h × DPR² × 4 × layers × instances; clamp to per-browser limits · CNV-06 zero-size or hidden start, and DPR changes (one-line)
  - §C Layers by change rate: CNV-07 static, data, hover/selection and overlay layers; hover redraws only the overlay; dirty-rectangle overlays · CNV-08 DOM for sparse text and tooltips, moved with `transform`
  - §D Canvas 2D drawing and text: CNV-09 one path and one stroke per style group; state set once per group · CNV-10 constant color strings plus `globalAlpha`; no `save()`/`restore()` per item · CNV-11 snap to device pixels · CNV-12 reuse `Path2D`; no `shadowBlur` or `ctx.filter` per frame; snug sprite caches · CNV-13 clear with `clearRect` or `reset()`, never by reassigning `width` · CNV-14 geometric hit testing, not pixel reads · CNV-15 text: `ctx.font` from a fixed set; a cached `measureText`; no DOM style writes between canvas text calls; rebuild caches when fonts load or DPR changes · CNV-16 label technique by count and update rate (DOM, Canvas 2D, atlas, SDF) · CNV-17 context flags on purpose (`willReadFrequently` stated; `alpha: false` only on opaque 2D canvases; `desynchronized` only for a pointer layer)
  - §E Off the main thread: CNV-18 `transferControlToOffscreen()` when the main thread is the measured bottleneck; OffscreenCanvas for caches and atlases · CNV-19 `createImageBitmap(blob)` at the final size; transfer; `close()`
  - §F Visibility: CNV-20 pause on `visibilitychange`, on `contentvisibilityautostatechange` (listen on the element) and with IntersectionObserver
  - §G Fewer marks: CNV-21 choose the renderer by mark count; cull; decimate to pixel columns (min and max per column)
  - §H One-line rules (`toBlob` export, 2D `contextlost` handling, and others)

### 5.12 `gpu-webgl-webgpu.md` (GPU-, ~460 lines, about 28 full + 12 one-line)

- **Scope:** WebGL2 now and WebGPU next. One rule per mechanism. When the APIs differ, the rule's Do has a `WebGL:` line and a `WebGPU:` line. This removes most of the overlap between notes `10` and `11`, and the WebGPU migration reads one file. **Split rule:** if the file grows past 500 lines, split it at §E into `gpu-setup-and-upload.md` (§0–§C, §F) and `gpu-draw-and-readback.md` (§D–§E, §G–§J).
- **Feeds:** `10` (all 64 items); `11` §A–§K (§L goes to `support.md`); the `11` "WebGL → WebGPU at a glance" table; `12` §D (canvas to texture, atlases, premultiplied, uploads at frame start, pages ≤ 4096); surveys: webgpu-skill (optimization ladder, lifecycle tests), PixiJS (upload before the first frame, text re-raster, mask order, spread destruction), three.js skill (test loss with `WEBGL_lose_context`), Mapbox (`preserveDrawingBuffer` and `antialias` only for a stated need).
- **TOC:**
  - §0 Optimization ladder: algorithm and count → CPU–GPU sync and readback → resource churn → bandwidth and overdraw → draw count → shader arithmetic
  - §A Context and device: GPU-01 WebGL2 first; WebGPU behind feature detection, with a WebGL path · GPU-02 context attributes on purpose (`depth`, `stencil`, `antialias` only when used; `preserveDrawingBuffer: false`; WebGL: keep `alpha: true` and write opaque alpha; WebGPU: `alphaMode`) · GPU-03 one context or device for many panes (viewport plus scissor) · GPU-04 `powerPreference` left at default; probe `failIfMajorPerformanceCaveat`; query limits and extensions once
  - §B Shaders and pipelines: GPU-05 create GPU objects at load, never in the frame loop · GPU-06 compile all, link all, then check status once; `KHR_parallel_shader_compile` and warm-up; `createRenderPipelineAsync` before the first frame · GPU-07 reuse pipelines; `override` constants (one-line)
  - §C Buffers and data types: GPU-08 allocate once with headroom; update sub-ranges (WebGL: `bufferSubData` with `srcOffset`/`length`; WebGPU: `writeBuffer`) · GPU-09 stream into a ring region; rotate 2–3 buffers instead of orphaning · GPU-10 split static from dynamic data; interleave by change rate; usage hints that match the real rate · GPU-11 the smallest vertex type that is precise enough; normalized types; Uint16 indices · GPU-12 WebGPU: `writeBuffer` by default, `mappedAtCreation` for initial data, a staging ring only when measured · GPU-13 upload before the first visible frame, and at frame start before draws · GPU-14 never put raw Unix-ms timestamps in float32 · GPU-15 transforms relative to the visible origin; split doubles for extreme ranges · GPU-16 `highp` for coordinates; `mediump` only for bounded values
  - §D Draw submission: GPU-17 instancing for candles, bars and markers · GPU-18 thick lines as instanced quads, never `lineWidth` · GPU-19 sort draws by target, program and bindings; skip redundant state; per-frame uniforms in one uniform buffer; bind groups by update rate · GPU-20 multi-draw, render bundles and indirect draws where they fit · GPU-21 WebGPU: one command buffer per frame; throttle with `onSubmittedWorkDone`
  - §E Fragment cost: GPU-22 move per-pixel work to the vertex shader; avoid `discard`, needless blending and overdraw (→ CNV-05 for the pixel cap)
  - §F Textures and text: GPU-23 `texStorage2D` plus `texSubImage2D`; RGBA8; mipmaps only for minified textures · GPU-24 text: rasterize and upload only when the string changes; dirty sub-rectangles into a preallocated atlas; pages ≤ 4096 · GPU-25 choose glyph atlas, per-string textures (LRU) or SDF by label count and transform · GPU-26 `ImageBitmap` sources with flip, premultiply and color set at creation; premultiplied end to end · one-line: KTX2 for large assets; data textures with `texelFetch`
  - §G Readback and picking: GPU-27 no synchronous readback in frame or input paths; use an async PBO with a fence, or a `mapAsync` buffer pool · GPU-28 hit-test on the CPU with cached geometry
  - §H Loss and teardown: GPU-29 handle `webglcontextlost`/`webglcontextrestored` and `device.lost`; keep the data to rebuild; test with `WEBGL_lose_context` · GPU-30 on destroy: stop loops, delete resources outside the frame, spread bulk destruction over frames, `loseContext()`; stay under the live-context cap · GPU-31 invalidate depth, stencil and MSAA attachments after their last use (one-line)
  - §I Profiling: GPU-32 timer queries (`EXT_disjoint_timer_query_webgl2`, `timestamp-query`); no blocking queries in hot paths · GPU-33 zero GL errors; read the browser's performance warnings · GPU-34 find the bottleneck: shrink the canvas, zero the draw counts; test on low-end GPUs
  - §J The WebGL → WebGPU table (about 20 lines). This is the one place that says what changes when the chart moves to WebGPU.
  - §K One-line rules

### 5.13 `scichart.md` (SC-, ~360 lines, about 27 full + 14 one-line)

- **Scope:** SciChart.js v5 only (the user's decision). Only the API choices that change cost. General GPU and JS mechanics stay in their layer files, and SC rules link to them with `also:`.
- **Feeds:** `13-scichart.md` (all 51 items; its conflicts table goes to `support.md` §D); `raw/scichart/*.d.ts`; `10` (context cap); surveys: TradingView (installed typings win; create once per mount; update the last point), SciChart MCP (if the user configures it).
- **TOC:**
  - §0 Lookup order: print the installed version (`node_modules/scichart/package.json`); grep the installed `.d.ts`; an API name that is not in the installed typings does not exist; use the SciChart MCP server only if it is configured; docs last. When the docs and the shipped source disagree, trust the source (`support.md` §D conflicts).
  - §1 Chart contract: → SKILL.md; plus the SciChart fields (`create()` or `createSingle()` or SubCharts; FIFO windows)
  - §A Ingestion: SC-01 batch data calls (`appendRange`, `insertRange`, `removeRange`), never per-point loops · **SC-02 stream ticks: one `appendRange` per series per frame into a `fifoCapacity` series (example rule, §6.2)** · SC-03 declare `dataIsSortedInX` and `containsNaN` at creation; `dataEvenlySpacedInX: true` only for truly uniform X · SC-04 replace data with `clear()` plus `appendRange()` on the same series; update the forming candle in place · SC-05 pre-size with `capacity`; pass and reuse `Float64Array` buffers · SC-06 read back with `vectorToArrayViewF64`, not `get(i)` loops · one-line: SC-07 keep X sorted (update or drop late ticks); SC-08 `fifoSweeping` for wrap-around; SC-09 heatmaps updated in place
  - §B Resampling: SC-10 leave resampling on Auto; never ship `debugDisableResampling` · SC-11 aggregate long history on the server, not in the browser · SC-12 low spline `interpolationPoints` (one-line)
  - §C Redraw control: SC-13 invalidate means one draw on the next frame; wrap multi-step updates in `suspendUpdates`/`resumeUpdates` · SC-14 hook the render event that lands a change in the same frame · SC-15 `disableEngineLoop` only when you own the frame loop
  - §D Many charts: SC-16 `SciChartSurface.create()` by default; `createSingle()` only for a few heavy charts (the limit is in `support.md`) · SC-17 SubCharts for dense panel layouts · SC-18 `freezeWhenOutOfView` for charts in scroll views, tabs and collapsible panels · SC-19 strip axis decoration on small or many charts (one-line)
  - §E Text, annotations, tooltips: SC-20 native text and the shared label cache stay on · SC-21 render-context annotations before SVG or HTML ones; `isSvgOnly` tooltips; limit data labels · SC-22 native text off only to cut first-chart startup with static labels (one-line)
  - §F Styling, transforms, animation, interaction: SC-23 cacheable PaletteProviders · SC-24 RenderDataTransforms that reuse their point series; incremental hooks in custom filters · SC-25 `autoColorMode` Never or Once with explicit colors (one-line) · SC-26 no series animations on live or multi-chart views · SC-27 built-in modifiers first; custom modifiers coalesce pointer input (→ EVT-03)
  - §G Wasm memory lifetime: SC-28 one surface per mount; `delete()` once on unmount, also when unmount comes before `create()` resolves · SC-29 delete what you swap out; collection `remove` and `clear` delete by default · SC-30 `addDeletable` for timers and helpers · SC-31 decide when the shared wasm context is disposed in the SPA · SC-32 `MemoryUsageHelper` in development · one-line: SC-33 the wasm heap ceiling; SC-34 `wasmBufferSizesKb` only for constrained targets
  - §H Loading: SC-35 load the chart library off the critical path · SC-36 self-host SIMD and no-SIMD wasm, version-matched; `useWasmSimd` on Auto · SC-37 size the container with CSS before creating the surface
  - §I GPU, DPR, backends: SC-38 DPI scaling off only for measured fill-bound cases on weak GPUs · SC-39 check which GPU the browser uses before you blame the chart · SC-40 do not depend on WebGPU yet (v6 alpha); when you trial it, test both backends · SC-41 stay on the latest v5 minor (one-line)
  - §J Measure hooks: render events and `PerformanceDebugHelper` (→ `measure.md#fps`)
  - §K One-line rules
- **SciChart rule sources** cite the `.d.ts` symbol or the docs page. The version that was checked lives in `support.md` §D, not in the rules.

### 5.14 `measure.md` (~380 lines)

Scope, feeds and steps are in §7.2. TOC: §0 Preflight · §1 The loop · §2 Lab profiles · §3 Driving scenarios · §4 Recipes (`#load`, `#inp`, `#cls`, `#fps`, `#fps-css`, `#gpu`, `#mem`, `#start`) · §5 Probes · §6 Compare and verdict · §7 Field data · §8 Token hygiene · §9 Measured-result report and ledger · §10 Pitfalls · §11 Tool cheat sheet (exact tool names and key parameters from DevTools MCP 1.9.0).

Feeds: `14` (all of it: tool inventory, insight names, playbook, WebMCP status and hook rules); `01` §Tooling; `07` §H; `13` §C (render events, `PerformanceDebugHelper`), §H (`MemoryUsageHelper`); `raw/cdmcp-tools.md`, `raw/webmcp*.txt`; surveys: Chrome LCP skill (subpart order), Chrome memory skill (×10; ask before you remove caches), Addy (one change, revert neutral, ledger), nucliweb and issue #1114 (fixed scripts), Dallacqua (save traces to files), Karel (field INP), VS Code (slope), dejank (per-interaction budgets).

### 5.15 `review.md` (~170 lines)

Scope and template are in §7.1. TOC: §A Procedure · §B Evidence levels and severity · §C Report template · §D One worked finding. Feeds: surveys (ibelick quoted line, why and fix; Front-End Checklist conservative stance; Cloudflare "skip 0 ms savings"; gstack per-finding fields; dejank's two modes; Addy "hypotheses, not measured regressions").

### 5.16 `support.md` (~260 lines)

Structure and rules are in §8. Feeds: every note's `Status:` line; `11` §L; `13` scope line, §J and the conflicts table; `14` status table (WebMCP) and header (MCP 1.9.0); `raw/web-features.json`, `raw/bcd.json`; `verify/01`, `verify/02`; the compat facts in both surveys.

---

## 6. Rule entry format

```markdown
### <PREFIX>-<nn> <Imperative title, at most 90 characters>
stage: <stages> · metric: <metrics> · when: <when> · impact: <level> — <one-clause reason> · support: <key|baseline|n/a> · also: <IDs>
- Do: 1–3 sentences. The action and its scope. When WebGL and WebGPU differ, add "WebGL:" and "WebGPU:" lines.
- Why: 1–3 sentences. The mechanism in pipeline words, plus at most one number with its source.
- Detect: `<ripgrep regex>` in <globs>, and the context where it is bad. A match is a candidate; confirm it by reading the code.
- Verify: measure.md#<recipe>. Pass: <condition>.
- Example: Before and After, at most 14 lines, original code, trading context. Leave it out when Do is enough.
- Avoid: when the rule is wrong, what it costs, and the wrong advice it replaces.
- Source: 1–2 URLs, primary first (spec, MDN, web.dev, developer.chrome.com, v8.dev, vendor typings).
```

One-line rule (low impact or obvious): `- **<ID>** <imperative>. [<stage> · <metric> · <impact>] <one URL>`

Why each field:

- **Do, Detect and Verify** map to the three modes. Mode 1 applies Do. Mode 2 greps `^- Detect:`. Mode 3 runs the Verify recipe. A rule without a Detect signal does nothing in a review. The Cursor "use proper X" rules are the counter-example (`18-skills-survey-github.md`, lesson 4).
- **Pass conditions** (from C) turn "check the trace" into a yes or no.
- **Why** follows skill-creator: explain the mechanism instead of writing MUST.
- **Avoid** carries the conflict resolutions (§9.4), so a review does not repeat bad advice such as "debounce scroll" or "`will-change` in base CSS".
- **One field per line** (from C), so `grep '^- Detect:'` extracts a whole column.
- **No versions in rules.** `support:` points to `support.md`. The lint fails on `(Chrome|Firefox|Safari|Edge) \d{2,3}` outside `support.md`.
- **Style:** ASD-STE100 Simplified Technical English, American spelling ("color").

### 6.1 Example rule 1 (HTML/CSS, in `css-rendering.md` §C)

````markdown
### CSS-08 Contain each independent panel: `contain: strict` plus a size for grid panes, `contain: content` for rows
stage: layout, style, paint · metric: INP, frame · when: interaction, render-loop · impact: high — without containment, one update inside a panel can re-lay out the whole terminal · support: contain · also: CSS-09, DOM-04, CNV-20
- Do: Give each panel whose size the page grid sets (chart pane, order book, watchlist, drawer) `contain: strict` and an explicit block size. Give repeated items whose content sets their height (book rows, tiles, cards) `contain: content`. Do not put it on page-level wrappers or small inline elements.
- Why: Layout usually starts at the document root. Layout and paint containment make the panel a layout root and clip its paint, so an update inside it re-lays out and repaints only that panel. Measured (CSS Wizardry, 2026): a dropdown in a drawer took 11.21 ms of layout rooted at `#document` (4,371 nodes visited); with `contain: strict` on the drawer it took 1.89 ms (73 nodes).
- Detect: `rg -n -g '*.{css,scss,svelte}' '^\s*\.[\w-]*(pane|panel|book|watchlist|blotter|drawer|tile|row)\b[^{]*\{'`, then check that the block has `contain` or `content-visibility`. Also `rg -n 'contain:\s*(strict|size)'`, then check that the same block sets `block-size`, `height` or `contain-intrinsic-size`; without a size, the box collapses to 0 px.
- Verify: measure.md#inp (or #fps for streaming updates), one update inside the panel. Pass: `trace-summary.mjs --between wp:start wp:end` shows `partialLayout: true` on the update's Layout events, and `totalObjects` is lower than the baseline; `ForcedReflow` is not worse.
- Example:
  ```css
  /* Before: one depth update in the order book can re-lay out the whole grid */
  .book-panel { overflow: hidden; }
  /* After */
  .book-panel { contain: strict; block-size: 100%; }   /* the size comes from the grid track */
  .book-row   { contain: content; }                    /* the height comes from content */
  ```
- Avoid: `layout` and `paint` containment create a stacking context and a containing block for `position: fixed` children, and they clip overflow. Render tooltips and menus in the top layer (`popover`, `<dialog>`) or outside the panel. Size containment without a size gives a 0 px box. Do not depend on the `style` keyword for behavior in older Safari. A contained panel that is off-screen still runs its canvas loop: pause it (CNV-20).
- Source: https://developer.mozilla.org/en-US/docs/Web/CSS/contain ; https://csswizardry.com/2026/04/what-is-css-containment-and-how-can-i-use-it/
````

Fact check: the measurement, the caveats and the Safari `style` note come from `05-css-rendering.md` §C ("Put `contain: content` on independent widgets…"). The `partialLayout`, `dirtyObjects` and `totalObjects` arguments of the `Layout` trace event are in `raw/TraceEvents.ts` (lines 2108–2110). Support key `contain`: Baseline Widely available (low date 2022-03-14, per `05`).

### 6.2 Example rule 2 (GPU/SciChart, in `scichart.md` §A)

````markdown
### SC-02 Stream ticks with one `appendRange` per series per frame, into a `fifoCapacity` series
stage: tasks, gpu-upload, memory · metric: frame, INP, memory · when: render-loop, session · impact: high — at market open, ticks outnumber frames, and each single-point call crosses into wasm and invalidates the surface · support: n/a (library; version checked in support.md §D) · also: DATA-06, DATA-04, LIFE-01, SC-28
- Do: Buffer incoming ticks in reused `Float64Array`s. Drain them with one `appendRange` per series per animation frame, and schedule the frame only when data arrives. For a rolling window, create the series with `fifoCapacity` (constructor only), sized for peak rate × window, and scroll with the X axis visible range, not by removing points. Set `dataIsSortedInX` and `containsNaN` from the feed contract (SC-03).
- Why: Each single-point call crosses the JS-to-wasm boundary, updates state and invalidates the surface. SciChart draws at most once per frame, so extra calls in one frame cost CPU and show nothing. The docs measure 100k single appends at 69 ms against 1 ms for one `appendRange`. FIFO mode overwrites the oldest points in a pre-allocated circular buffer: no shifting, no reallocation, no unbounded growth.
- Detect: `rg -n -A8 'onmessage|addEventListener\(\s*.message|\.subscribe\(' -g '*.{ts,svelte}' | rg '\.append\(|\.removeAt\(|\.removeRange\('`; `rg -n 'new (Xy|Ohlc|Xyy|Hlc)DataSeries\('` in streaming modules, then check for `fifoCapacity` or `capacity`; `.clear()` followed by `appendRange` on every message.
- Verify: measure.md#fps with the replay scenario (peak rate, 10 s, desktop profile, CPU 4×, 5 runs each side). Pass: compare-runs verdict "win" on frame-interval p95 and long-frame count, and LoAF script time attributed to the message handler goes down. Then measure.md#mem: once the FIFO is full, heap and wasm memory stay flat over 60 s.
- Example:
  ```ts
  // Before: one wasm call and one invalidate per message; a shift on every tick
  ws.onmessage = (e) => { const t = decode(e.data); series.append(t.time, t.price);
    if (series.count() > MAX) series.removeAt(0); };
  // After: bounded window, one bulk call per frame
  const series = new XyDataSeries(wasmContext, { fifoCapacity: MAX, dataIsSortedInX: true, containsNaN: false });
  const xs = new Float64Array(4096), ys = new Float64Array(4096);
  let n = 0, queued = false;
  const flush = () => { queued = false; if (n) { series.appendRange(xs.subarray(0, n), ys.subarray(0, n)); n = 0; } };
  ws.addEventListener('message', (e) => {
    const t = decode(e.data); xs[n] = t.time; ys[n] = t.price; n++;
    if (n === xs.length) flush();                  // rAF pauses in hidden tabs: flush when full
    else if (!queued) { queued = true; requestAnimationFrame(flush); }
  }, { signal });                                   // one teardown owner: LIFE-01, SC-28
  ```
- Avoid: A FIFO series cannot be resized and does not support insert or remove. The 5.2.69 typings say spline and stacked series do not support FIFO; an older changelog says spline does, so test first. Wrong sort or NaN flags draw wrong data. For the forming candle, update the last point in place (SC-04); do not append. If decoding costs more than a few ms per frame at peak, decode in a worker and transfer `Float64Array`s (DATA-03). Check every name in the installed typings first (§0).
- Source: https://www.scichart.com/documentation/js/v5/2d-charts/chart-types/data-series-api/realtime-updates/ ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Model/BaseDataSeries.d.ts
````

Fact check: the 69 ms against 1 ms numbers, "draws at most once per frame", the FIFO behavior, "constructor only", the spline and stacked conflict, and "subarray views are copied into wasm, so reuse of the backing buffer is safe" all come from `13-scichart.md` §A. `dataIsSortedInX` (alias `isSorted`) and `containsNaN` are the 5.2.69 option names in `13` §A. The rule does not set `dataEvenlySpacedInX`: its 5.2.69 constructor default is false, and trades are not evenly spaced (`13`, conflicts table). This corrects design B's example, which said the flag defaults to true.

---

## 7. Output modes 2 and 3

### 7.0 Where each part lives

| Part | File | Loaded when |
|---|---|---|
| Mode detection and short procedures | SKILL.md §Pick the mode, §Mode 2, §Mode 3 | Always, on trigger |
| Review procedure, evidence levels, severity, template, worked finding | `references/review.md` | A review is asked for |
| Measurement loop, profiles, scenarios, recipes, verdict, report | `references/measure.md` | Measurement is asked for, a symptom is reported, or Claude is about to claim a speed-up |
| Probe code | `scripts/probes.js` | Passed as the `function` of `evaluate_script` |
| Trace event counts | `scripts/trace-summary.mjs` | Run with node on a saved trace |
| Verdict | `scripts/compare-runs.mjs` | Run with node on two run files |
| Scenario hooks | `assets/perf-hooks.dev.ts` | Copied into a project only with the user's approval |

### 7.1 Performance review (mode 2): `review.md`

**§A Procedure.**

1. **Scope.** List the files or the diff. Read them. Read the installed versions of the main libraries (SciChart, the framework). Record the runtime context (SPA, charts, target browsers from browserslist or AGENTS.md).
2. **Route.** For each region, find its row in the router and read those checklists. Name the stages in play.
3. **Detection sweep.** `grep -h '^- Detect:' <files in scope>`; run the patterns over the scope with ripgrep; keep a list of candidates.
4. **Confirm.** Read each candidate in context. A pattern match is not a finding. Quote the line.
5. **Missing contracts.** Check what is absent, not only what is present: teardown, error path, test scale, hidden-tab behavior, degradation policy, chart contract.
6. **Rank and cap.** Severity × confidence. At most 10 findings, strongest first; for a small scope, the 1–3 strongest. Prefer silence to nitpicks. No micro-optimization finding without a profile or a per-frame/per-tick path. Skip a finding whose estimated saving is 0 ms (Cloudflare).
7. **Report** with the template. Offer measurement for H findings. Do not edit code in a review unless the user asks (read-only diagnosis).

**§B Evidence levels and severity.**

| Evidence | Meaning |
|---|---|
| M, measured | A trace, probe output or run file exists; numbers and conditions are given |
| S, static, mechanism certain | The code does it on every event or frame, for example a layout read after a style write inside `pointermove` |
| H, hypothesis | The cost depends on data size or hardware; it needs a measurement |

| Severity | Meaning |
|---|---|
| high | On a hot path (per frame, per tick, per input event), on the LCP critical path, or a leak that grows with each repeated action |
| medium | Once per discrete interaction, or on a secondary view |
| low | A one-time cost under 50 ms, or a rare path. Report only when the user asks for a full audit |

**§C Report template.**

````markdown
# Performance review: <scope> (<YYYY-MM-DD>)
Commit <sha> · Mode: static | measured · Build: dev | prod preview · Profile: <desktop, CPU 4×, DPR 2> (measured only)
Context: <libraries and installed versions; data scale assumed, for example 500k points and 300 ticks/s at peak>
Evidence: M = measured · S = static, mechanism certain · H = hypothesis, needs measurement

## Verdict
<1–3 sentences: the biggest risk, and whether the change is safe to ship as is. If nothing material was found, say that the code is already fast.>

## Summary
| # | Stage | Finding (file:line) | Rule | Severity · metric | Ev. | Effort |
|---|---|---|---|---|---|---|
| F1 | Tasks and scheduling | depth store updated per message (`OrderBook.svelte:31`) | DATA-06 | high · frame, INP | S | S |

## Findings by pipeline stage
<!-- Pipeline order: Network · Parse and discovery · Render-blocking CSS and fonts · Script load ·
     Tasks and scheduling · JS execution · Style · Layout · Paint and raster · Composite ·
     GPU upload · GPU draw · Memory and lifecycle. A SciChart finding goes under the first
     stage in its rule's tag line. Omit empty stages. -->

### Tasks and scheduling
#### F1 [high] <one-line title> — `src/lib/OrderBook.svelte:31`
- Rule: DATA-06 · Metric: frame (also INP) · Evidence: S
- Code:
  > `socket.onmessage = (m) => { depth.set(parse(m.data)); };`
- Why it costs: <the mechanism in 1–2 sentences>
- Fix:
  ```diff
  - socket.onmessage = (m) => { depth.set(parse(m.data)); };
  + socket.onmessage = (m) => { latest = parse(m.data); if (!queued) { queued = true; requestAnimationFrame(apply); } };
  ```
- Verify: measure.md#fps, replay at peak rate. Pass: <condition from the rule>

## Missing contracts
<teardown, error path, test scale, hidden-tab behavior, degradation policy, chart contract: only what is missing>

## Checked, no findings
<stages and patterns that were checked and are fine>

## Not checked
<what static review cannot decide, and why>

## Measurement plan
1. <recipe · scenario · pass condition>, in severity order

## Attempts ledger (only when measurement ran)
| Change | Metric | Before median (MAD) | After median (MAD) | Verdict | Kept |
|---|---|---|---|---|---|
````

Why this shape: the user asked for findings grouped by pipeline stage (A's grouping). The quoted line, "why" and fix follow ibelick. The evidence letters are B's. "Missing contracts" is C's. "Checked, no findings" stops a report from implying coverage that it did not have. The ledger follows Addy agent-skills.

### 7.2 Measurement workflow (mode 3): `measure.md`

The order is fixed, as the user asked: **baseline trace → one change → the same trace again → compare** before any claim that a change is faster. Tool names are those of chrome-devtools-mcp 1.9.0. In Claude Code they appear as `mcp__chrome-devtools__<tool>`.

**§0 Preflight.**

1. Check which DevTools MCP tools exist in the session. Some need server flags: heap analysis (`compare_heapsnapshots` and others) needs `--memoryDebugging`; WebMCP needs `--categoryExperimentalWebmcp` and `--chromeArg=--enable-features=WebMCP`; `click_at` needs `--experimentalVision`. If a tool is missing, say so and use the fallback in the recipe. Never change the user's MCP configuration.
2. Use headed Chrome with the hardware GPU for frame and GPU work. Run `__wpProbe.env()` and record the Chrome version, the WebGL renderer, the WebGPU adapter and the DPR. Reject a run on a software renderer (SwiftShader, or `isFallbackAdapter: true`).
3. Use a production preview build for load and startup metrics. A dev build is acceptable only to compare frames or interactions on the same code path. The report says which build.
4. Output files (traces, snapshots, run files, the ledger) go to the session scratchpad, not the repository, unless the user asks.

**§1 The loop.**

1. **Define** the claim, the metric, the scenario steps, the pass condition and the profile, before any measurement. The scenario uses the scale of the chart contract.
2. **Baseline** on unchanged code, N = 5 runs (3 minimum for slow load traces). If the change already exists in the working tree, create a git worktree at `HEAD`, serve it on a second port, and measure both. Never stash, reset or check out over the user's changes. When both builds run at once, interleave the runs (A, B, A, B…) to cancel drift.
3. **One change.**
4. **After:** the same steps, conditions, file-name pattern (`<change>-after-<n>`) and run count.
5. **Compare** with `compare-runs.mjs`. Also compare the insight lists: a removed insight or lower "estimated savings" supports the claim; a new insight is a regression to explain. Check side effects: CLS, console errors, request count, transfer bytes, heap.
6. **Decide:** keep a win; revert a neutral or regressed change (or keep it for a stated non-performance reason); a win that needed a test change is a regression.
7. **Record** one ledger row: date, commit, change, scenario, profile, metric before → after, verdict, kept or reverted, file paths.

**§2 Lab profiles.** Set every option in **one** `emulate` call, then confirm the "CPU throttling" and "Network throttling" header lines in the trace summary. If they do not match, discard the run.

| Profile | `emulate` | Use |
|---|---|---|
| Desktop terminal (default) | `viewport: "1440x900x2"`, `cpuThrottlingRate: 4`; network off for INP, frames and memory; `"Fast 4G"` for load and startup | Most work |
| Render loop | as desktop, repeated at `"1440x900x1"` and `"1440x900x2"` | Canvas and GPU cost grows with DPR² |
| Mobile | `viewport: "412x915x2.625,mobile,touch"`, `cpuThrottlingRate: 4`, `networkConditions: "Slow 4G"` | Public pages only |
| Memory | no throttling | Heap snapshots |

CPU throttling slows only the renderer main thread, not the GPU. Treat throttled frame times for GPU-heavy charts as a lower limit, and mark GPU-bound results "needs a real-device check" (`14`, "Do not trust CPU throttling for WebGL/WebGPU chart frame times").

**§3 Driving scenarios.** The same input on every run.

1. **DOM controls:** MCP input tools (`click`, `press_key`, `type_text`, `fill`, `hover`) with element uids from `take_snapshot`. Take the snapshot **before** the trace starts. They send trusted input, so Event Timing sees it.
2. **Canvas interactions** (pan, zoom, drag a drawing, replay ticks): MCP `drag` works from one uid to another uid, so it cannot pan inside one canvas. Script-dispatched pointer events can land at the wrong canvas coordinates at DPR 2 (seen in this user's chart project). Use app scenario hooks:
   - With WebMCP: `assets/perf-hooks.dev.ts` registers `load_fixture_data`, `run_scenario` (enum: `stream`, `pan`, `zoom`, `drag_drawing`, `switch_symbol`, `toggle_toolbar`; clamped inputs), `get_frame_stats`, `get_perf_summary`, `reset_state`. Claude finds them with `list_webmcp_tools` and runs them with `execute_webmcp_tool`.
   - Without WebMCP: the same module on `window.__perf.run(name, options)`, called with `evaluate_script`.
   - Each scenario sets `performance.mark('wp:start')` and `performance.mark('wp:end')`, so `trace-summary.mjs` can window the trace.
3. **Keep hooks out of the measured window.** A WebMCP tool runs on the page's main thread. Call `load_fixture_data` before `performance_start_trace`. Inside the trace, call only `run_scenario`. Read stats after the trace stops.

**§4 Recipes.**

| Recipe | Steps, in order | Read | Pass |
|---|---|---|---|
| `#load` | `navigate_page` → `emulate` → `performance_start_trace {reload: true, autoStop: true, filePath}`; say "cold" or "warm" cache; `performance_analyze_insight` for the listed `LCPBreakdown`, `LCPDiscovery`, `RenderBlocking`, `DocumentLatency`, `NetworkDependencyTree` (in detail on run 1 only); `__wpProbe.paint()` for FCP and TTFB, because the summary does not print them | LCP and subparts, CLS, FCP, TTFB, insight savings | LCP median wins; the targeted subpart moved, and the time did not move into render delay; no new insight |
| `#inp` | `take_snapshot` → `__wpProbe.interaction.start()` → `performance_start_trace {reload: false, autoStop: false}` → the interaction (MCP input or `run_scenario`) → `performance_stop_trace {filePath}` → `INPBreakdown`, `ForcedReflow`, `DOMSize` → `__wpProbe.interaction.read()`, `__wpProbe.loaf.read()` | worst interaction latency and its 3 subparts; top LoAF scripts with `forcedStyleAndLayoutDuration` | the targeted subpart wins; the others are not worse |
| `#cls` | trace with reload plus the scripted interactions; `__wpProbe.shift` running | CLS, `CLSCulprits`, shift sources, `hadRecentInput` | CLS wins; non-input shift per interaction < 0.02 |
| `#fps` | `load_fixture_data` → `__wpProbe.frame.start()` → `run_scenario` for 5–10 s → `__wpProbe.frame.stop()`; a separate traced run of the same scenario, then `trace-summary.mjs --between wp:start wp:end` | frame interval p50, p95, p99; frames over 16.7 and 33 ms; max gap; LoAF count; main-thread event totals | p95 and long-frame count win beyond noise |
| `#fps-css` | trace without reload; toggle the animation 5 times between marks | `trace-summary.mjs` Layout and Paint counts in the window | 0 Layout and 0 Paint in the window; no "compositing failed" reason on the Animations track |
| `#gpu` | `#fps` at DPR 1 and 2; then with the canvas at a quarter of its area; then with draw counts set to zero; timer queries where available; `list_console_messages` for GL errors and performance warnings | which side limits the frame | a named bottleneck with numbers |
| `#mem` | warm up 2 times → `take_heapsnapshot` S0 → the action 10 times, `__wpProbe.memory.sample()` after each → S1 → 10 more → S2 → `compare_heapsnapshots` S0→S1 and S1→S2 → retaining paths for the top growing class | growth per action; detached DOM; canvases; app counters (SciChart surfaces; wasm memory from `MemoryUsageHelper` in dev) | S1→S2 growth per action within noise; counts back to baseline; zero detached canvases |
| `#start` | cold load trace on the prod preview → `list_network_requests {resourceTypes: ["script"]}` → `trace-summary.mjs` for "Evaluate script" and compile totals; the bundler report for bytes | JS bytes on the first route, evaluation time, wasm init time | bytes or evaluation time win, and load and INP are not worse |

Heap snapshots run a full GC before capture, so snapshot-to-snapshot growth is retained memory. Wasm linear memory only grows. To see SciChart native memory, the app exposes a counter.

**§5 Probes (`scripts/probes.js`).** One idempotent function. Claude reads the file and passes its text as the `function` argument of `evaluate_script` (with `waitForStableDom: false`) after each navigation. It installs `window.__wpProbe`:

| Probe | Records | Limits |
|---|---|---|
| `env()` | Chrome version, WebGL renderer, WebGPU adapter and `isFallbackAdapter`, DPR | Test browser only, never production logic |
| `frame.start()/stop()` | rAF intervals in a preallocated array; percentiles after sampling | The probe's own rAF keeps frames alive, so it measures cadence, not render-on-demand |
| `interaction.start()/read()` | Event Timing entries (`durationThreshold: 16`) by `interactionId`; the three subparts | Lab interactions only; not field INP |
| `shift.start()/read()` | `layout-shift` entries, sources, `hadRecentInput` | Chromium only |
| `loaf.read()` | Long animation frames: `blockingDuration`, top scripts, `forcedStyleAndLayoutDuration` | Chromium only |
| `paint()` | FCP, TTFB, navigation and resource timing summary | — |
| `memory.sample()` | DOM node count, canvas count, `window.__perf?.counters?.()`, `measureUserAgentSpecificMemory()` when `crossOriginIsolated` | Never `performance.memory` |

Each output is compact JSON (under about 1.5 K characters). Save larger results with the `filePath` argument.

**§6 Compare and verdict (`scripts/compare-runs.mjs`).** Input: two run files `{ label, profile, build, env, runs: [{ <metric>: <value> }] }`. Output per metric: the median and MAD of each side, delta, delta %, verdict.

- Fewer than 3 runs on a side: "insufficient runs". 3–4 runs: the verdict carries "low N".
- For a lower-is-better metric: **win** when `after < base − max(2 × MAD_base, 5% × base, floor)`; **regression** when `after > base + max(2 × MAD_base, 5% × base, floor)`; otherwise **neutral**.
- Default floors: INP and processing time 10 ms; LCP 50 ms; frame p95 0.5 ms; long frames 1 per 10 s; heap growth 0.1 MB per action. These are starting values; tune them after the first real runs.

**§7 Field data.** Lab results prove lab behavior. For field INP and CLS, use the `web-vitals` v6 attribution build and Long Animation Frames, and segment by browser (`support.md` says which browsers report which entries). Claim a field change only after new field data arrives.

**§8 Token hygiene.** Save every trace with `filePath` (`.json.gz`) and every snapshot to a file. Never read a raw trace or `.heapsnapshot` into the context. Use insights, `trace-summary.mjs` and the snapshot tools. Paginate network lists. Keep probe output small.

**§9 Measured-result report and ledger.**

```markdown
## Measured result: <change> (<date>)
Profile: desktop, CPU 4×, network off · Build: prod preview · Chrome <version> · GPU: <renderer> · DPR 2 · Runs: 5 + 5, interleaved
| Metric | Before median (MAD) | After median (MAD) | Δ | Verdict |
|---|---|---|---|---|
| Frame interval p95 (ms) | 21.4 (1.1) | 15.9 (0.8) | −26% | win |
| Long frames per 10 s | 14 (3) | 2 (1) | −86% | win |
Traces: <paths> · Insights read: <names> · Kept: yes
Limits: lab only; CPU throttling does not slow the GPU.
```

(The numbers above show the format only.)

**§10 Pitfalls.** Lab INP is a proxy. Load traces contain no interactions, so they cannot show INP. The trace summary does not print TBT or FCP. `lighthouse_audit` in this server excludes performance: never use it for speed. Thermal throttling and background tabs add noise: repeat, and interleave. Never state "60 fps" from one run.

**§11 Tool cheat sheet.** The exact tool names and key parameters from `14` Part 1 (navigation, emulation, performance, network, debugging, memory, input, WebMCP), about 25 lines.

**WebMCP hook rules (in §3 and `assets/perf-hooks.dev.ts`).**

- Load the hook module only in development: `if (import.meta.env.DEV) await import('./perf-hooks.dev')`. Recommend `Permissions-Policy: tools=()` on production servers.
- Register with `document.modelContext.registerTool(tool, { signal })`. Abort the old registration on HMR dispose or unmount before you register again; a duplicate name rejects.
- Feature-detect `document.modelContext`. App behavior never depends on it.
- Small, bounded tools: enums for scenario names, clamped numbers, `readOnlyHint: true` on measurement tools, outputs under about 1.5 K characters, and the `signal` honored.
- Status: origin trial in Chrome 149–156; local flag `chrome://flags/#enable-webmcp-testing`. The user turns on flags, not Claude.
- A registered tool is callable by any agent on the page, so tools stay harmless: no network writes, no account actions.

---

## 8. Version-sensitive facts: one place, dated

**The place:** `references/support.md`. No other file contains a browser version, a Baseline date, an API shape that is still moving, a DevTools MCP flag or version, or a library version. The lint enforces this.

**Header (exact):**

```markdown
# Dated facts: browser support, deprecations, tools and library versions
Checked: 2026-09-22. Sources: MDN browser-compat-data 8.1.2 (2026-09-17); web-features 3.39.0 via api.webstatus.dev; developer.chrome.com; web.dev; chrome-devtools-mcp 1.9.0 docs; SciChart.js 5.2.69 package source (jsDelivr).
Stale after: 2026-12-21 (90 days). Chrome now ships a stable release every two weeks (Chrome 154 on 2026-09-22), so re-check a row before a decision that depends on it after that date.
Refresh: read https://api.webstatus.dev/v1/features/<key> (fields `baseline`, `browser_implementations`) or the MDN BCD JSON, update the row and its date, and tell the user. Ask before you browse. Never run a retrieval CLI through npx.
Policy: Widely available → use freely. Newly available → use it, and name the fallback in the notes. Limited → feature-detect and ship the fallback in code. Chromium-only diagnostics (§B) need no fallback. A project policy (browserslist, CLAUDE.md, AGENTS.md) wins; if the user names a restricted runtime, suggest writing it there.
```

**Sections:**

- **§A Feature table** — key (web-features id where one exists) · Chrome · Firefox · Safari · Baseline and date · fallback in code · rules · checked. Seed rows (all from the notes, surveys and `verify/*`, checked 2026-09-22):

  | Key | Chrome | Firefox | Safari | Baseline | Fallback | Rules |
  |---|---|---|---|---|---|---|
  | `scheduler-yield` | 129 | 142 | no | limited | `setTimeout` or `MessageChannel` promise | TASK-03 |
  | `request-idle-callback` | yes | yes | no (Technology Preview flag) | limited | `setTimeout` with a budget | TASK-07 |
  | `contain` | yes | yes | yes (`style` keyword late) | widely (low 2022-03-14) | — | CSS-08 |
  | `content-visibility` | yes | yes | `auto` from 26 | newly, 2025-09-15 | `contain` plus IntersectionObserver | CSS-09, CSS-10 |
  | `fetch-priority` | 101 (Link header 103) | 132 | 17.2 | newly, 2024-10-29 | none needed (a hint) | MEDIA-02, DATA-13 |
  | `scrollend` | yes | yes | yes | newly, 2025-12-12 | a debounced scroll end | EVT-11 |
  | `event-timing` (`interactionId`) | yes | 144 | 26.2 | newly, 2025-12-12 | — | measure.md |
  | `long-animation-frames` | 123 | no | no | limited | none (diagnostic) | measure.md |
  | `sizes-auto` | 126 | 150 | 27 (2026-09-14; not yet in BCD 8.1.2) | pending | fallback list after `auto` | MEDIA-05 |
  | `view-transitions` (same document) | yes | 144 | yes | newly, 2025-10-14 | none (progressive) | CSS-20 |
  | `scroll-driven-animations` | 115 | no | 26 | limited | none (progressive) | CSS-19 |
  | `speculation-rules` | 109 | no | no prerender | limited | none (progressive) | HTML-19 |
  | `soft-navigations` | 151 | no | no | limited | feature-detect entry types | HTML-20 |
  | `webgpu` | 113 (Win, macOS, ChromeOS); Android 121; Linux 144+ by vendor | 141 Windows; 145/147 macOS | 26 | limited | the WebGL2 path | GPU-01, SC-40 |
  | `webmcp` (`document.modelContext`) | origin trial 149–156 | no (neutral) | no (oppose) | limited | `window.__perf` via `evaluate_script` | measure.md |

  The builder re-reads each row from BCD and webstatus on build day. A row with conflicting sources keeps both values and names each source.
- **§B Chromium-only extras** (no fallback needed): LoAF; `measureUserAgentSpecificMemory`; Element Timing; JS Self-Profiling; Compute Pressure; explicit compile hints; the `JSON.stringify` fast path (an engine detail).
- **§C Engine and tool facts:** Chrome's two-week release cadence; tight mode and "the first 5 large images at Medium priority" (Chrome 117); Paint Holding (FCP or 500 ms); bfcache for `no-store` pages (rolled out March–April 2025; 3-minute timeout; evicted on cookie change, WebSocket, WebTransport or WebRTC); open WebSockets no longer block bfcache in Chrome 149+ and Safari, but do in Firefox; the WebGL live-context cap; Speculation Rules eagerness limits. DevTools MCP 1.9.0 (2026-09-08): flags; the 19 insight names; `lighthouse_audit` excludes performance; the trace summary does not print TBT or FCP. WebMCP API shape: `registerTool(tool, {exposedTo, signal})`; `navigator.modelContext` is gone; `provideContext`, `clearContext` and `unregisterTool` removed.
- **§D Library versions and conflicts:** SciChart.js latest stable 5.2.69 (2026-09-08); the SC rules were checked against it on 2026-09-22. 6.0.0-alpha.196 (2026-09-22): in auto mode, WebGPU only on Apple GPUs, with a WebGL fallback. The `createSingle()` limit of 16. The doc-versus-source conflicts table from `13` (6 rows: `useSharedCache` default, `dataEvenlySpacedInX`, FIFO with spline, default native font, v6 WebGPU auto mode, native text defaults). `web-vitals` v6. Command to print the installed version.
- **§E Do not use (and do not cite):** FID (replaced by INP on 2024-03-12); TTI (removed in Lighthouse 10, 2023-02-09); Lighthouse score targets; `isInputPending()`; `unload` (Chrome removal reached 100% of page loads in Chrome 154, 2026-09-22) → `pagehide`, `fetchLater`; `performance.memory` → `measureUserAgentSpecificMemory()`; `<link rel=prerender>` → speculation rules; HTTP/2 Server Push → 103 Early Hints; `format('woff2-variations')` → `format('woff2')`; the `translateZ(0)` hack; `nomodule` bundles; `document.write`; power-of-two textures as a WebGL2 rule (a WebGL1 limit only).
- **§F Myths:** "`await` yields to the browser"; "workers make code faster"; "`transform` means no jank"; "`DocumentFragment` is much faster"; "Wasm is always faster"; "cache `array.length`"; "try/catch kills optimization"; "`requestIdleCallback` shortens an interaction". Each with a one-line correction and a source.
- **§G Disputed and watch list (do not build on yet):** lazy loading for `<video>`/`<audio>` (sources disagree: Chrome 148 vs 150); HTML-in-canvas (origin trial); `prerender_until_script`; WebGPU optional features (`shader-f16`, `timestamp-query`, `subgroups`) — detect at run time; SciChart v6 WebGPU (moving between alpha builds).

**How rules use it:** a rule says `support: scheduler-yield`. When Claude must state support to the user, it reads that row and says "per support.md, checked 2026-09-22". For a Limited feature, the rule's Do already includes the fallback code. SciChart API **names** are not in this file: they come from the installed typings at run time (`scichart.md` §0). Only the version landscape lives here.

---

## 9. What to leave out, and how to deduplicate

### 9.1 Leave out

| Leave out | Why | What stays instead |
|---|---|---|
| Rules that Claude already follows ("minify in production", "use HTTPS", "use HTTP/2") | They fail the no-op test (Svelte `writing-great-skills`) | Nothing, or one line in `html-loading` §H |
| Server, CDN and protocol setup (CDN choice, HTTP/3, compression settings) | Not frontend code | The headers that frontend code sets (`html-loading` §G, one-liners) |
| Deep service-worker strategy (Workbox plugins, cache-key trivia, offline analytics, Range requests) | Low value for a live trading terminal | DATA-15 plus one-liners |
| React, Vue, Angular, Next.js rules; a Svelte file | The user's decision | Framework-neutral rules; at most 3 Svelte 5 lines inside rules (LIFE-11, DATA-08, SC-28) |
| Metrics and targets that are no longer used (FID, TTI, Speed Index, FMP, Lighthouse scores, `performance.memory`) | Stale or misleading | `support.md` §E only |
| JIT micro-myths and Crankshaft-era advice | No effect in modern engines | `v8-hot-code` §H and `support.md` §F, one line each |
| Origin-trial or experimental APIs as rules (HTML-in-canvas, `prerender_until_script`) | Unstable | `support.md` §G only. WebMCP stays only as an optional measurement aid |
| WAAPI trivia (composite modes, keyframe syntax, easing rules) | Not performance | CSS-16 to CSS-18 only |
| Video encoding details, image CDN negotiation, JPEG XL, art direction | Content-site concerns | MEDIA-03, MEDIA-11 |
| DevTools UI clicks for a human (Rendering drawer, Layers panel) | The agent cannot click them | One line in `measure.md` §10: "ask the user to check X" |
| Numbers without a source ("10× faster", "7× faster") | False precision | Mechanisms plus a Verify step |
| The notes' "Sources read" and "Not covered" sections; `01-…run1.md`, `.run2.md`, `.run2-new.md` | Research provenance; duplicates | `maintenance/crosswalk.tsv` keeps the provenance |
| Any rule with no Detect or no Verify | It does nothing in modes 2 and 3 | A one-line rule at most |
| Copied text and copied code from sources | Copyright and quality | Paraphrased rules; all code is original |

### 9.2 Deduplication procedure (build time)

The notes hold about 780 items: `01` 62, `02` 69, `03` 63, `04` 48, `05` 46, `06` 44, `07` 55, `08` §8 10, `10` 64, `11` 50, `12` 47, `13` 51, `14` 39, `16` 3, `17` 86, plus the pending files. They share one item format (Layer, Stage, Metrics, When, Impact, Do, Why, Example, Avoid, Status, Sources), so most of the work is scripted.

1. **Canonical inputs.** Use `01` plus `verify/01`. Use `09-v8-consolidated.md` when it exists, instead of `08-v8-batch-*`.
2. **Corrections first.** Apply each "corrected" verdict in `verify/*` to its item before merging. Precedence: `verify/*` → `15-gaps-round-*` corrections → the note with the newest BCD or web-features date → first-pass notes → rules imported from the surveys. Drop "disputed" claims from rules and move them to `support.md` §G.
3. **Extract.** A scratch script turns each `### ` item into a row: file, heading, the 10 fields, and the backticked API tokens in the heading and Do line.
4. **Home.** Assign a file with the home rule (§1.3): the code signal of the Do line gives the file. The first Stage value becomes the first `stage:` tag (A's placement rule). Review each assignment by hand.
5. **Cluster and merge.** Group rows by shared API tokens and stage. Merge each cluster into one rule: the corrected text, the most specific Do, one mechanism in Why with the best-sourced number, a new original example, the union of caveats (deduplicated) in Avoid, the newest Status as a `support:` key, and at most 2 primary sources. The largest clusters (item counts from design C's script over 14 notes files):

   | Topic | Files | Items | Becomes |
   |---|---|---|---|
   | Workers and messaging | 10 | 32 | TASK-10 to TASK-12, DATA-03, CNV-18 |
   | Pause hidden or off-screen work | 9 | 19 | CNV-20, LIFE-06, SC-18, CSS-09 |
   | rAF discipline | 6 | 15 | CNV-01 to CNV-03, EVT-03, TASK-09 |
   | Lazy loading | 4 | 14 | MEDIA-02, MEDIA-05 |
   | LCP image and `fetchpriority` | 4 | 12 | MEDIA-01, MEDIA-02 |
   | bfcache and page lifecycle | 5 | 12 | LIFE-07 |
   | Yielding | 4 | 10 | TASK-03 to TASK-05 |
   | Canvas backing-store size | 6 | 8 | CNV-04, CNV-05 |
   | Reserve space | 6 | 8 | MEDIA-04, MEDIA-12 |
   | Read/write batching | 4 | 7 | EVT-07, EVT-08 |
   | WAAPI fill and `commitStyles` | 4 | 7 | CSS-17 |
   | `content-visibility` | 3 | 5 | CSS-09, CSS-10 |

6. **No-op test.** Run the 4 evals in §10 without the skill. A rule whose behavior the baseline already shows is cut or shrunk to one line. Every row in "Default habits to replace" stays: those are known misses.
7. **Tier and cap.** High and medium impact → full rule. Low or obvious → one-line rule. Below that → dropped, with the reason in the crosswalk. If a file passes its line budget, drop the lowest impact × relevance to a desktop trading SPA with SciChart, then the oldest source.
8. **Crosswalk.** Write `maintenance/crosswalk.tsv`: one row per note item, with its rule ID or "dropped: <reason>". It lives in the skill folder, because the scratchpad is temporary. Later note updates find their rule through it.
9. **Lint** (`maintenance/lint-skill.mjs`, run before every release):
   - IDs are unique and match `^(HTML|MEDIA|CSS|EVT|TASK|DOM|DATA|LIFE|V8|CNV|GPU|SC)-\d{2}$`;
   - every ID named in SKILL.md, in a checklist, in `also:` or in a `→` line exists;
   - every full rule has the tag line and the Do, Why, Detect, Verify, Avoid and Source fields;
   - every `support:` key exists in `support.md`;
   - no `(Chrome|Firefox|Safari|Edge) \d{2,3}` outside `support.md`;
   - SKILL.md ≤ 270 lines and ≤ 18,000 characters, with no `$ARGUMENTS` or `$<digit>`;
   - the 13 stage words in SKILL.md match `pipeline.md` §J;
   - every reference file is within its line budget + 15%, and every rule file starts with a checklist;
   - folded `description` + `when_to_use` ≤ 1,536 characters.

   These checks stop the drift that the surveys found in other skills: an index that said "40+" rules for a skill with 70, and index entries with no rule file.

### 9.3 Notes still in progress

| Notes | State on 2026-09-22 | Feeds | The builder must confirm |
|---|---|---|---|
| `12-canvas2d-and-images.md` | done, 47 items, §A–§H | `gpu-canvas-and-frames` §A–§G; `gpu-webgl-webgpu` §F (from `12` §D); MEDIA-06; `support.md` §G (§H, HTML-in-canvas) | Keep the split in CNV-17: `alpha: false` only on opaque 2D canvases, never as a WebGL speed trick |
| `13-scichart.md` | done, 51 items, conflicts table | `scichart.md`; `support.md` §D | Re-check the 6 doc/source conflicts against the installed version at build time |
| `14-devtools-mcp-and-webmcp.md` | done, 39 items, playbook | `measure.md`; `scripts/probes.js`; `assets/perf-hooks.dev.ts`; `pipeline.md` §I; `support.md` §C | Tool names against the MCP version installed on the user's machine |
| `08-v8-batch-*` → `09-v8-consolidated.md` | pending | `v8-hot-code`; HTML-17; TASK-13, TASK-14 | Which of the 10 draft rules in `08` §8 survive the no-op test |
| `16-explore-fast-batch-*` | pending | `html-loading`, `html-media-and-fonts` | Mostly merges into existing rules (they overlap the Learn Performance course) |
| `15-gaps-round-*` | pending | Any file, by the home rule; may add a router row | Critic corrections take precedence (§9.2 step 2) |
| `verify/*` for notes `03`–`14` | only `01` and `02` exist | all files | Facts that enter `support.md` get a fact-check at least |

Every rule file has about 15% line headroom for these.

### 9.4 Conflicts already resolved (kept in the rule's Avoid field)

- `alpha: false`: acceptable on opaque 2D canvases; for WebGL, keep `alpha: true` and write opaque alpha (notes `10` and `12`, against the OpenAI survey). CNV-17, GPU-02.
- `will-change`: just in time, not in base CSS (against GSAP and the Vercel agent). CSS-05.
- Scroll handlers: rAF, `scrollend` or IntersectionObserver, not a debounced scroll handler (against Addy, Mapbox, dembrandt). EVT-11.
- The `preload` + `onload` CSS trick breaks under a strict CSP (against Modern Web Guidance and Addy). HTML-09.
- `requestIdleCallback` does not shorten an interaction (against dembrandt). TASK-07.
- The `grid-template-rows: 0fr → 1fr` trick runs layout every frame (against iart). CSS-01.
- `Cache-Control: no-store` on personalized HTML: use `private, no-cache` unless the page is sensitive (`verify/02`, against the 2023 course text). `html-loading` §G.
- `dataEvenlySpacedInX`: the 5.2.69 constructor default is false; the d.ts comment says true (`13`, against design B's example). SC-03.
- Open WebSockets and bfcache: Chrome 149+ and Safari no longer block, Firefox still does, so keep "close in `pagehide`" (`verify/02`). LIFE-07.

---

## 10. Test prompts for skill-creator evals

Each eval runs with and without the skill (skill-creator benchmark mode) on `evals/fixtures/terminal/`. The prompts are the kind the user types while coding. Three of them do not say "performance", and none names the API the answer should use (Chrome's lesson: "make my images load faster", not "add fetchpriority").

### E1: write mode, GPU text on a drawing tool

> add price labels to each level of the fib channel drawing. they should follow the handle while I drag it

| A good answer with the skill | A typical baseline |
|---|---|
| Reads the existing drawing layer and the installed SciChart typings first. If the drawing is a SciChart annotation, uses native text or a render-context annotation (SC-20, SC-21). If it is the app's own GPU layer: rasterizes a label only when the formatted string changes (cache key: string + font + DPR) and uploads a dirty sub-rectangle into a preallocated atlas (GPU-24); one `Intl.NumberFormat` outside the drag path (V8-09); cached `measureText` (CNV-15); the drag coalesced into one rAF (EVT-03); no texture or canvas creation in `pointermove` or rAF (GPU-05); a rebuild on DPR change; textures and listeners released on teardown (LIFE-01, GPU-30). Ends with "Performance notes" that name the one-frame lag and "Not measured". | Creates a canvas and a texture (or a DOM node) per label per `pointermove`; calls `toFixed` or `toLocaleString` and `measureText` every frame; no teardown; no notes. |

Assertions (grep on the diff and the answer):
- no `createTexture`, `texImage2D`, `new OffscreenCanvas` or `createElement('canvas')` inside the pointer or rAF handlers;
- `new Intl.NumberFormat` appears once, outside the handlers;
- a cache keyed by the label string;
- a cleanup path (`abort()`, `delete`, `deleteTexture` or `destroy`);
- a "Performance notes" block with at most 4 bullets that contains "Not measured".

### E2: write mode, streaming into SciChart

> hook the trades websocket into the tick chart so it shows the last 5 minutes live. messages are json {t, p, q}, can be ~300/s at the open

| A good answer with the skill | A typical baseline |
|---|---|
| Writes the chart contract (peak 300/s × 300 s = 90k points). Uses a FIFO series sized for the peak, sort and NaN flags from the feed, one `appendRange` per frame, a bounded buffer that flushes when full (hidden tab), and the X visible range for the 5-minute window (SC-02, SC-03). Judges that 300 small JSON messages per second fit well under the frame budget, so no worker yet, and says so (TASK-02). Handles heartbeat and capped backoff (DATA-02). Closes the socket and deletes the surface in teardown (LIFE-01, SC-28). Notes with trade-offs. | `series.append` per message; `removeAt(0)` or `removeRange` to keep 5 minutes; no teardown; no hidden-tab handling; claims it is "efficient". |

Assertions:
- `fifoCapacity` is present;
- `appendRange` is called from a rAF callback or a buffer flush, not per message;
- no `removeAt` or `removeRange` in the message path;
- the buffer is bounded;
- the socket is closed and the surface is deleted in teardown;
- no `dataEvenlySpacedInX: true`.

### E3: review mode, before a pull request

> can you review OrderBook.svelte and order-book.css before I open the PR? the book re-renders on every depth update

| A good answer with the skill | A typical baseline |
|---|---|
| Uses the `review.md` template: verdict, summary, findings grouped by stage in pipeline order (Tasks and scheduling, JS execution, Style, Layout, Paint and raster, Composite, Memory and lifecycle). Each finding has file:line, a quoted line, a rule ID, an evidence letter, a fix and a Verify line. Likely findings: a store update per message (DATA-06, DATA-08); all rows re-rendered and keyed by index (DOM-03, DOM-04); `:nth-child` striping on a mutating list (CSS-13); a flash via `background-color` animation instead of an opacity overlay (DOM-04, CSS-02); no containment on the panel (CSS-08); `toLocaleString` per cell (V8-09); a missing unsubscribe (LIFE-01). At most 10 findings, "Missing contracts", "Checked, no findings", a measurement plan, and no file edits. | A flat list of generic tips ("memoize", "debounce"); no stages; no locations; no evidence labels; "this will fix the jank"; or it edits files unasked. |

Assertions:
- the headings match the template, and the stage headings are in pipeline order;
- every finding has a `file:line`, a `Rule:` line, an `Evidence:` line and a `Verify:` line;
- at most 10 findings;
- no file in the fixture changed;
- no "faster" claim without "not measured" or "hypothesis".

### E4: measure mode, prove a change

> I switched the drawing toolbar show/hide from a height transition to transform. is it actually smoother now? dev server is on 5173

| A good answer with the skill | A typical baseline |
|---|---|
| Checks which DevTools MCP tools exist. Measures the baseline from `HEAD` in a separate worktree on a second port, without touching the uncommitted change. Defines the scenario (toggle the toolbar 10 times while the chart streams, through `run_scenario` or trusted clicks on uids), the metrics (Layout and Paint counts in the `wp:` window; frame p95 and long frames), the profile (desktop, CPU 4×, DPR 2), and records the Chrome version and GPU renderer. Runs 5 interleaved runs per side, saves traces to the scratchpad, runs `trace-summary.mjs` and `compare-runs.mjs`, and reports the verdict with conditions. Notes from CSS-01 Avoid that `scaleY` distorts text and that the toolbar's space is not released. Says a dev build limits the conclusion. | "Yes, `transform` is GPU-accelerated, so it is smoother", with no measurement; or one `lighthouse_audit` (which excludes performance); or one trace per side. |

Assertions:
- at least 5 measured runs per side (trace or probe calls);
- no `git stash`, `git reset` or `git checkout -- <file>` in the transcript;
- trace `filePath` values under the scratchpad;
- the verdict word is one of win, neutral, regression or insufficient runs;
- the report states the profile, build and GPU renderer, and "CPU throttling does not slow the GPU".

### Trigger evals (`evals/trigger-queries.json`)

- **Should trigger (12):** "make the watchlist rows flash green on uptick"; "port the candle renderer to WebGPU"; "why does the tab eat memory overnight"; "add a crosshair to the chart"; "lazy load the settings dialog"; "add a volume histogram under the candles"; "the chart gets choppy after I leave the terminal open for a couple of hours" (must trigger before any file is read); "hook the order book to the depth feed"; "animate the drawer open"; "render 1M points"; "trace localhost:5173"; "review chart-panel.ts for performance".
- **Light trigger (4)** — the skill may load, but the answer opens no reference and writes no notes block: "make the order-book rows 2 px taller"; "change the toolbar icon color to the accent token"; "rename FloatingToolbar to DrawingToolbar across the package"; "fix the TypeScript error in drawing-consts.ts".
- **Should not trigger (8):** "write a Python script that backfills 1-minute candles from the exchange API"; "update the GitHub Actions workflow to cache pnpm"; "add an index on orders(created_at) in the Postgres migration"; "fix the typo in README.md"; "write a bash script that prunes docker images older than 30 days"; "add a Node CLI that exports trades to CSV"; "fix the type error in the backend API client"; "rotate the AWS credentials in the deploy script".

---

## 11. Risks of this design and how to reduce them

| # | Risk | Where it comes from | Mitigation |
|---|---|---|---|
| 1 | The skill does not trigger during ordinary coding | Skills under-trigger (Vercel: not invoked in 56% of cases) | Description that starts with the act of writing; "even when nobody says 'performance'"; `when_to_use` examples; no `paths`; trigger evals with near misses; `/web-performance` for manual use; optional CLAUDE.md pointer (open question 1) |
| 2 | It triggers too often and adds noise to trivial edits | A pushy description | "Skip for … edits that change only text, types or names"; step 3 of "How to work"; the light-trigger evals; notes only for non-default choices |
| 3 | A task spans 2–3 files, or Claude picks the wrong file | Mixed edits (a chart feature with a feed and a handler) | "Common pairs"; checklists first, so 3 files cost about 120 lines; `→ ID` pointers; the always-on rules cover the top cross-file cases |
| 4 | A rule straddles two categories (canvas rAF is JS and GPU; containment is CSS and DOM) | Level-1 categories are layers; code is not always one layer | The home rule (the file where the code is typed); `also:` and `→ ID`; the stage greps work across all files |
| 5 | The review needs stage grouping, but files are by category and task | The axis choice | A `stage:` tag on every rule; the 13-stage vocabulary in `pipeline.md` §J; the template orders by stage; the grep index is live, so it cannot go stale |
| 6 | Context cost and compaction | SKILL.md loads once per frontend session | SKILL.md ≤ 18,000 characters, under the 5,000-token re-attach; the "symptoms" table moves out if the budget is hit; references load on demand; checklists first |
| 7 | SciChart facts are wrong for the installed version | Docs return 403 to scripts; doc/source conflicts; v6 is moving | §0 lookup order (installed typings win); version landscape only in `support.md` §D; `13` source checks for 5.2.69; conflicts in Avoid fields |
| 8 | Stale browser facts | Two-week Chrome releases; the surveys found FID, TTI and wrong `scheduler.yield` versions in popular skills | One dated `support.md`; 90-day re-check; no versions in rules (lint); "facts other skills get wrong" in §E and §F |
| 9 | False speed claims | Models like to say "faster" | Honesty rules in SKILL.md; evidence letters in reviews; compare-runs verdicts; E3 and E4 graders |
| 10 | Over-optimization adds complexity | A rich rule set invites it | Impact tiers; the V8 gate (profile first); the work-size rule; "revert neutral changes"; no new dependencies unless asked; notes must name each cost |
| 11 | Noisy or unrepresentative lab numbers | Dev builds, HMR, thermal limits, CPU throttling that does not slow the GPU, synthetic input on canvas at DPR 2 | Prod preview build; one `emulate` call confirmed in the trace header; renderer check; 5 interleaved runs with medians and MAD; trusted input or scenario hooks; "needs a real-device check" label for GPU-bound results |
| 12 | Measurement touches the user's working tree | The baseline needs the old code | A separate worktree at `HEAD`; outputs in the scratchpad; never stash or reset; the E4 grader checks it |
| 13 | A WebMCP hook ships to production, or edits a project without consent | Measurement design | A template in `assets/`; added only with approval; `import.meta.env.DEV` dynamic import; `Permissions-Policy: tools=()` recommended; the `window.__perf` fallback needs no WebMCP |
| 14 | MCP tools or flags are missing | Heap tools and WebMCP need server flags | Preflight lists the tools; each recipe has a fallback; Claude never changes the MCP configuration |
| 15 | Rules drift from the notes, or the skill collects sediment | Many files and pending notes | The crosswalk inside the skill folder; stable IDs, never reused; the lint before each release; 15% headroom per file; the GPU split rule |
| 16 | The node scripts fail on a machine without Node, or on a new trace format | `trace-summary.mjs` parses Chrome's trace JSON | Node is present in the user's projects; the scripts fail with a clear message; the recipes still work from insights and probes alone |

---

## Open questions for the user

1. **Trigger reinforcement.** May the skill's install step add a 3-line pointer to your global `~/.claude/CLAUDE.md` ("Before you write or review HTML, CSS, JS/TS, Svelte, canvas, WebGL/WebGPU or chart code, load the web-performance skill. Explore the target code first, then apply it.")? Vercel measured 53% → 79% with such an instruction, but it applies to every session on this machine.
2. **Research notes archive.** The notes and the crosswalk sources are in the session scratchpad, which is temporary. Where should the notes be kept for later updates: `~/.claude/skills/web-performance/maintenance/research/` (about 2 MB on disk, never loaded), a private repository, or nowhere?
3. **Target hardware for measurement.** The default lab profile is a desktop at 1440×900, DPR 2, CPU 4×. What hardware do your traders really use (for example, a laptop with an integrated GPU, or a multi-monitor desktop at DPR 1)? This sets the default profile and the pass floors.
4. **Browser support floor.** Which browsers must the terminal support: Chromium only, or also Safari and Firefox? If Chromium only, "Limited" features such as `scheduler.yield()`, LoAF and WebGPU need no fallback code. The answer should also go into the project's AGENTS.md.
5. **WebMCP in measurement.** Do you want the WebMCP scenario hooks (dev-only `perf-hooks.dev.ts`, plus WebMCP flags in the test Chrome, origin trial 149–156)? Or should measurement use only the `window.__perf` fallback through `evaluate_script`, which needs no flags?
