# Survey: web-performance coding skills and rule sets on GitHub (2026-09-22)

## How I searched

- **Tools.** The `gh` CLI is not installed on this machine, so GitHub *code* search (`filename:SKILL.md ...`) was not available (it needs auth). I used:
  - GitHub REST API without auth: repository search (25 queries, rate limit 10/min was hit twice), `git/trees` listings, `commits?path=` for last-update dates, and raw file reads from `raw.githubusercontent.com`.
  - WebSearch and WebFetch for discovery (skills.sh install counts, Chrome/Svelte/OpenAI skill pages).
  - Grep over the READMEs of 7 curated lists: VoltAgent/awesome-agent-skills, ComposioHQ/awesome-claude-skills, travisvn/awesome-claude-skills, BehiSecc/awesome-claude-skills, hesreallyhim/awesome-claude-code, finfin/awesome-frontend-skills, PatrickJS/awesome-cursorrules. Plus sanjeed5/awesome-cursor-rules-mdc and nedcodes-ok/cursorrules-collection trees.
  - Direct checks of `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` in 13 well-known graphics/UI repos (tldraw, excalidraw, lightweight-charts, uPlot, perspective, deck.gl, pixijs, three.js, echarts, react, svelte, vscode, next.js) and in ABTSoftware/SciChart.JS.Examples.
- **Repository search queries (examples).** `web performance skill`, `core web vitals skill`, `performance agent skills`, `claude skills performance`, `cursor rules performance`, `web-performance claude`, `agent-skills frontend`, `webgl performance skill`, `react best practices skill`, `svelte skills agent`, `vue agent skills`, `awesome claude skills`, `awesome cursorrules`, `awesome agent skills`, `INP skill`, `canvas performance skill`, `scichart skill`, `scichart claude`.
- **"Latest" checks.** Browser-support and deprecation claims were checked against MDN browser-compat-data 8.1.2 (published 2026-09-17), the `web-features` Baseline data, web.dev, and developer.chrome.com. Raw evidence: `raw/18-skills-survey-github/compat-facts.txt`.
- **Volume.** About 200 repository rows scanned in search results, about 60 files read in full from 22 rule sets (listed below, best first). Raw copies are in `raw/18-skills-survey-github/`.
- **Ranking rule.** "Best" means most useful for *our* skill: rules that change how Claude **writes** HTML, CSS, JS/TS and WebGL/WebGPU chart code (SciChart.js), not rules for auditing a live site.

---

## Addy Osmani — web-quality-skills (`performance`, `core-web-vitals`) — https://github.com/addyosmani/web-quality-skills

- **Kind:** Claude skill (SKILL.md), multi-agent packaging (Claude plugin, Codex, Gemini).
- **Signals:** 2,826 stars. `skills/performance/SKILL.md` last commit 2026-08-24 by Addy Osmani (Chrome team). skills.sh: `performance` 36.3K installs, `core-web-vitals` 27.1K installs. Version 2.0 ("evidence-led" rewrite, see CHANGELOG).
- **Scope and structure:** 6 skills. `performance/SKILL.md` 13.8 KB + `references/MEASUREMENT.md` (7.4 KB) + `references/RUM.md` (3.1 KB). `core-web-vitals/SKILL.md` 9.8 KB + `references/LCP.md`, `INP.md`, `CLS.md` (4–5 KB each). Good progressive disclosure: each reference has a "read this when..." line. Classification: the CWV skill is organized **by metric** (LCP, INP, CLS); the performance skill is organized **by resource/layer** (server response, resource loading, JS, images, fonts, caching, runtime, third parties, measurement).
- **Trigger:** The descriptions list user phrases such as "speed up my site", "fix LCP", "reduce CLS". These are audit phrases. They will not fire while Claude writes a new component.
- **Strong rules (paraphrased):**
  - Static inspection without a running page produces **hypotheses**, not measured regressions; attach the command that verifies each one.
  - Never compare one lab value with a field p75 as if they were the same kind of sample; claim field improvement only after new RUM/CrUX data arrives.
  - Preload only a resource whose late discovery shows in a trace; each extra high-priority request competes for bandwidth.
  - INP: first find which phase dominates (input delay, processing, presentation delay), then pick the fix. A table maps each phase to evidence and fixes.
  - Give visible feedback, yield, then do heavy work; push analytics to idle time.
  - Insert late content into a **pre-sized slot** (`replaceChildren`) instead of `prepend` above visible content.
  - Derive `size-adjust`/`ascent-override` values from the real font pair; never copy numbers between fonts.
  - Gate analytics/ads on `prerenderingchange` when Speculation Rules can prerender the page.
  - Prefer the `web-vitals` attribution build over hand-rolled observers for production RUM.
- **Weak points:**
  - Debounces a scroll handler (100 ms) as the example fix; a passive listener, rAF coalescing or IntersectionObserver is the modern default.
  - LCP example sets `decoding="sync"` with no evidence that it helps.
  - Variable-font example uses `format('woff2-variations')`, which MDN BCD marks as non-standard; plain `format('woff2')` or `tech(variations)` is the standard form.
  - Says same-document View Transitions are "Baseline 2026"; `web-features` gives Baseline newly available on 2025-10-14 (Firefox 144).
  - Recommends the `preload` + `onload` CSS swap trick, which a strict CSP (no inline handlers) blocks (the Copilot rule set below warns about this).
  - Budgets are page-weight budgets for content/commerce pages. Nothing on frame budgets, canvas, workers, or long-lived SPA memory.

## OpenAI — build-web-data-visualization plugin (`canvas2d-data-visualization`, `dashboards-and-real-time-visualization`) — https://github.com/openai/plugins/tree/main/plugins/build-web-data-visualization

- **Kind:** Codex skill (SKILL.md format, portable to Claude).
- **Signals:** openai/plugins has 7,119 stars. `canvas2d-data-visualization/SKILL.md` last commit 2026-05-26 (cching-openai). The plugin has 19 visualization skills.
- **Scope and structure:** `SKILL.md` 9.2 KB + `references/performance-playbook.md` 6.7 KB, `rendering-architecture.md` 7.5 KB, `high-density-interaction.md` 11 KB, `sparklines-and-microcharts.md` 5.5 KB. Classification: first **renderer choice** (SVG/HTML vs Canvas2D vs WebGL), then **subsystems** (backing store, layers, hit testing, pointer input, performance, accessibility overlay).
- **Trigger:** Loads for charts with high mark counts, fast redraws, immediate-mode drawing, custom hit testing, or hybrid Canvas + SVG/HTML layouts. This is a **code-writing** trigger, which is what we want.
- **Strong rules (paraphrased):** (closest match to a SciChart trading chart in the whole survey)
  - Backing-store memory = CSS width × CSS height × DPR² × 4 bytes × layers × instances. Compute it for dashboards; cap DPR on mobile when memory or thermal limits matter.
  - Separate layers: static background, data marks, hover/selection, interaction overlay. Hover and drag previews redraw only the overlay layer.
  - Rebuild picking buffers and cached `Path2D` only when positions, z-order or the viewport transform change.
  - Reduce work before micro-tuning: cull off-screen marks, decimate/aggregate when the viewport cannot resolve points, coalesce `pointermove` to one rAF.
  - Draw one polyline per trace; group draws by fill/stroke/alpha/line width to cut context state changes; typed arrays for geometry; no allocations in the render loop; cache text metrics or put labels in HTML.
  - `willReadFrequently: true` only on canvases that call `getImageData()` often; `alpha: false` on opaque canvases.
  - Streaming: ring buffers, versioned data buffers, precomputed screen coordinates. Decide a **degradation policy** before building (drop frames, aggregate old samples, pause off-screen charts) and show the degraded state to the user.
  - Pointer: `setPointerCapture` for drags and cleanup on `pointerup`, `pointercancel` and `lostpointercapture`; decide `touch-action` on purpose.
- **Weak points:** Canvas2D-centric; WebGL is only a "move up when needed" note. No measurement workflow or pass/fail checks. "Budget 16 ms frames only when truly needed" ignores 120 Hz displays (8.3 ms). No lifecycle rules (context loss, teardown).

## Vercel — agent-skills `react-best-practices` — https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices

- **Kind:** Claude skill (SKILL.md) plus a compiled `AGENTS.md`.
- **Signals:** 31,473 stars. `SKILL.md` last commit 2026-04-14 (Shu Ding). skills.sh: 736.1K installs (the most-installed performance skill found).
- **Scope and structure:** `SKILL.md` 7.3 KB is an **index only**: 70 rules in 8 categories, each category has an impact level and a filename prefix (`async-`, `bundle-`, `server-`, `client-`, `rerender-`, `rendering-`, `js-`, `advanced-`). Each rule is one file (0.5–4 KB) with frontmatter `title`, `impact`, `impactDescription`, `tags`, then "Incorrect" and "Correct" code. A build package compiles all rules into `AGENTS.md` (108 KB) for tools without progressive disclosure, and a `test-cases.json` (68 KB) feeds validation. Classification: **by impact priority**, which also maps roughly to pipeline stage (network waterfalls → bundle → server → client → re-render → rendering → JS).
- **Trigger:** Fires when writing, reviewing or refactoring React/Next.js code. It is a write-time trigger.
- **Strong rules (paraphrased):**
  - Keep high-frequency values (pointer position, scroll offset) in refs and write `transform` directly; do not put them in component state.
  - Interleaved style writes and layout reads force synchronous layout; group writes, then read once, or toggle a class.
  - Passive listeners for touch/wheel only when the handler never calls `preventDefault` (custom zoom and swipe are the exceptions).
  - Deduplicate global listeners (one shared `resize`/`keydown` subscription).
  - Version and minimize `localStorage` data; cache storage reads.
  - Import from the module path, not a barrel file.
  - Use a single loop for min/max instead of sorting; hoist `RegExp`; use `Set`/`Map` for repeated lookups; `toSorted()` to avoid mutating props.
- **Weak points:**
  - Impact labels are asserted, not measured. `rendering-content-visibility` claims about 10× faster initial render with no source.
  - "Animate a div wrapper, not the SVG, for hardware acceleration" is a browser-specific claim with no version or source.
  - Several `js-` rules (cache property access in loops, length check first) are micro-optimizations that modern JITs already handle; they add noise.
  - `requestIdleCallback` rule: Safari still ships it only in Technology Preview behind a flag (MDN BCD 8.1.2); the rule does include a `setTimeout` fallback.
  - `metadata.json` says "40+ rules" while `SKILL.md` says 70: stale sediment.

## Chrome DevTools team — chrome-devtools-mcp skills (`debug-optimize-lcp`, `memory-leak-debugging`) — https://github.com/ChromeDevTools/chrome-devtools-mcp/tree/main/skills

- **Kind:** Claude skill (SKILL.md), tied to the Chrome DevTools MCP server.
- **Signals:** 52,491 stars. `debug-optimize-lcp/SKILL.md` last commit 2026-08-24. skills.sh: 2.6K installs. 6 first-party skills in total (a11y, CLI, LCP, memory leaks, troubleshooting, general).
- **Scope and structure:** LCP skill 6.6 KB + 4 references (subpart breakdown, element types, JS snippets, strategies). Memory skill 4.3 KB + `common-leaks.md`. Classification: LCP **by its 4 subparts**; leaks **by retainer category** (detached DOM, event handlers, closures, console, unbounded caches).
- **Trigger:** Rich symptom phrases (slow page load, hero image slow, "CWV"); memory skill fires on high memory, OOM, heap snapshots.
- **Strong rules (paraphrased):**
  - LCP subpart targets: TTFB about 40%, resource load delay under 10%, resource load duration about 40%, element render delay under 10%. Do not shrink one subpart without checking the others, because the saved time can move into render delay.
  - Never lazy-load the LCP image; add `fetchpriority="high"`; preload only if it is not in the HTML.
  - Re-run the same trace after the fix; emulate 4× CPU and a slow network.
  - Keep pages eligible for bfcache.
  - Memory: repeat the suspect interaction about 10 times to amplify a leak; take baseline, target and after-revert snapshots; detached DOM may be an intentional cache, so ask before nulling references; never read raw `.heapsnapshot` files into context.
- **Weak points:** Diagnostic only; needs the MCP server (and a `--memoryDebugging` flag for the heap tools). No INP or rendering skill. The "73% of mobile pages" LCP statistic has no citation in the file.

## cazala — webgpu-skill — https://github.com/cazala/webgpu-skill

- **Kind:** Claude/Codex skill (SKILL.md) with a Vite starter and a validation script.
- **Signals:** 32 stars. `SKILL.md` last commit 2026-07-23 (Juan Cazala).
- **Scope and structure:** `SKILL.md` 6.9 KB + 8 references (init/lifecycle, WGSL data layout, compute, rendering, debugging-and-performance, compatibility, recipes, current-sources) + `assets/starter/`. Classification: five **contracts** (capability, data, pass, presentation, lifecycle) and a ranked **optimization ladder**.
- **Trigger:** WebGPU/WGSL work: pipelines, buffers, canvas sizing, device loss, readback, performance problems.
- **Strong rules (paraphrased):**
  - Do not create buffers, textures, samplers, bind groups or pipelines per frame unless their descriptors change.
  - No full GPU→CPU readback inside animation or pointer loops; compact on the GPU and map a small staging buffer.
  - Size the backing store from rendered CSS size × DPR, clamp to device limits, and skip no-op assignments (reassigning equal sizes causes flicker and wasted work).
  - Surface shader compilation messages, `uncapturederror` and `device.lost`; stop animation and observers before destroying resources.
  - Optimization order: algorithm and invocation count → CPU/GPU sync and readback → resource churn → bandwidth/overdraw → draw/dispatch count → workgroup tuning → shader arithmetic.
  - Measure CPU frame time separately from GPU time; FPS is a symptom, not a metric; profile with debug readback disabled.
  - Test zero-size/hidden startup, DPR change, background tab, teardown and re-create.
- **Weak points:** WebGPU only (SciChart.js uses WebGL). Very low adoption. Main file has no browser-support dates (they are in `compatibility.md`).

## GitHub — awesome-copilot `performance-optimization.instructions.md` — https://github.com/github/awesome-copilot/blob/main/instructions/performance-optimization.instructions.md

- **Kind:** Copilot instructions (`*.instructions.md`).
- **Signals:** repo 39,294 stars. File last commit 2026-04-10 (Gonzalo Fleming). One 27 KB file.
- **Scope and structure:** 50+ anti-patterns with IDs by family: L1–L10 loading/LCP, R1–R8 rendering/hydration, J1–J8 JS/INP/memory, C1–C7 CSS, I1–I8 media/fonts, B1–B6 bundle, then Next.js, Angular, React and Vue families. Each has **severity** (CRITICAL/IMPORTANT/SUGGESTION), a **detection regex**, and the **metric affected**. Classification: by metric-linked family. No progressive disclosure: `applyTo: '**'` loads all 27 KB for every file.
- **Trigger:** Always on (glob `**`).
- **Strong rules (paraphrased):**
  - Each rule carries a grep-able detection pattern, so the agent (or a linter) can check its own output.
  - Remove listeners with an `AbortController` signal; clear every interval in cleanup.
  - Avoid the `media="print" onload` trick under a strict CSP; extract critical CSS at build time instead.
  - `will-change` must not sit permanently in base CSS.
  - Pair `content-visibility: auto` with `contain-intrinsic-size`.
  - Use Long Animation Frames for INP attribution; Vue: `shallowRef` for large data; Angular: zoneless + signals.
- **Weak points:**
  - Always-on 27 KB file: high context cost, low relevance for most files.
  - States `scheduler.yield()` ships in Firefox 129+; MDN BCD 8.1.2 and web.dev say Firefox **142**.
  - L1 "good" example preloads a stylesheet that it links normally on the next line (no gain).
  - L4 marks "LCP image not preloaded" as CRITICAL in all cases; Chrome and Addy guidance say preload only when discovery is late.
  - Barrel files and CommonJS are tagged as INP problems; their main cost is bundle size and load.
  - C5 flags `*` selectors as a performance issue; the gain is negligible.

## Addy Osmani — agent-skills `performance-optimization` — https://github.com/addyosmani/agent-skills/blob/main/skills/performance-optimization/SKILL.md

- **Kind:** Claude skill (SKILL.md) in a 25-skill lifecycle pack.
- **Signals:** 98,491 stars. File last commit 2026-08-28.
- **Scope and structure:** 21.7 KB SKILL.md + `references/performance-checklist.md` (13 KB) + a `web-performance-auditor` agent. Classification: **workflow** (measure → identify → fix → verify → guard) plus a symptom decision tree (first load / sluggish interaction / after navigation / backend). About half is backend (SQL plans, pools, caches).
- **Trigger:** Performance requirements, suspected regressions, CWV, N+1 queries, profiling results.
- **Strong rules (paraphrased):**
  - A change that does not beat run-to-run variance is **reverted**, not kept as "harmless".
  - Change one thing per measurement; re-measure with the same command and conditions.
  - Correctness gates the metric: a "win" that needed a test changed or deleted is a regression.
  - Keep a ledger of attempts (kept and reverted) so dead ideas are not re-tried.
  - A "common rationalizations" table rebuts excuses such as "it's fast on my machine".
  - The auditor agent has a "metric-honesty rule": never invent LCP/INP/CLS from source code; label static findings as potential impact.
- **Weak points:** Budget list still includes "Time to Interactive < 3.5 s" (Lighthouse 10 removed TTI on 2023-02-09) and "Lighthouse score ≥ 90". The checklist recommends `isInputPending()`; web.dev now says it no longer recommends that API. Large backend share costs context on frontend tasks.

## Svelte team — ai-tools `svelte-core-bestpractices` (+ svelte repo `performance-investigation`, `writing-great-skills`) — https://github.com/sveltejs/ai-tools

- **Kind:** Claude plugin skill (SKILL.md). Also an internal skill in the Svelte monorepo (`.agents/skills/performance-investigation/`) and a meta skill on writing skills.
- **Signals:** ai-tools 328 stars; `svelte-core-bestpractices/SKILL.md` last commit 2026-07-27; skills.sh 8.3K installs.
- **Scope and structure:** 7.2 KB SKILL.md + 9 small references (`attach`, `each`, `snippet`, ...). Not a performance skill, but it holds the performance rules that matter for Svelte 5.
- **Trigger:** Any time Claude writes, edits or analyzes a Svelte component or module (write-time trigger).
- **Strong rules (paraphrased):**
  - Only make a variable `$state` if something reactive reads it.
  - Deep `$state` proxies cost CPU; for large objects/arrays that are **replaced, not mutated** (API responses, chart data batches) use `$state.raw`.
  - Compute with `$derived`, not `$effect` + assignment; effects are an escape hatch.
  - Sync external libraries (D3, chart engines) with `{@attach ...}` rather than effects.
  - Keyed `{#each}` with a real id, never the index.
  - `$inspect.trace(label)` inside a derived/effect shows which dependency re-ran it.
  - Svelte monorepo skill: compare branches with `pnpm bench:compare`, read the Markdown summaries generated from `.cpuprofile` files, change one thing at a time.
  - `writing-great-skills`: run a **no-op test** on every sentence (does it change behavior versus the default?), use one strong "leading word" per concept, give each step a checkable completion criterion.
- **Weak points:** No rendering/paint rules, no guidance on large lists or canvas. Async Svelte features are marked experimental, which can age quickly.

## Harsha Varma — zero-jank-scroll — https://github.com/harshavarma02/zero-jank-scroll-agent-skill

- **Kind:** Claude skill (SKILL.md).
- **Signals:** 1 star; last commit 2026-07-02. Low adoption, high quality.
- **Scope and structure:** 12.5 KB SKILL.md + 4 references (performance, architecture matrix, frameworks, accessibility) + eval cases. Classification: **architecture choice first** (native scroll, CSS scroll-driven animation, observers, libraries), then failure causes.
- **Trigger:** Sticky/pinned sections, scroll-linked animation, "scrolling feels laggy". It also says when *not* to fire (plain overflow lists, backend pagination), which is rare and useful.
- **Strong rules (paraphrased):**
  - Never drive framework state on every scroll frame; keep continuous values in refs, animation primitives or CSS custom properties; use state for discrete changes only.
  - Pause or dispose hidden work: autoplay video, canvas loops, rAF callbacks, WebGL scenes, timers.
  - Transforms and opacity are safer defaults, not a guarantee; layer size and count still cost memory.
  - **Honest output:** allowed statements describe what was measured; forbidden statements include "runs at 60 FPS" without measurement, "GPU accelerated, so no jank", "Lighthouse 100" without a report.
- **Weak points:** Narrow scope (scroll); no numeric budgets.

## Gary Basin — dejank — https://github.com/gbasin/dejank

- **Kind:** Claude/Codex skill (SKILL.md).
- **Signals:** 30 stars; last commit 2026-03-25.
- **Scope and structure:** 5.2 KB SKILL.md + 7 references (18 static patterns with severity, browser path, React path, field path, Playwright probe, tooling and budgets). Classification: **by visible symptom** (flash/blink, jump/snap, sticky/stutter, pop-in, whole pane rebuilt), then by layer (React identity vs layout/paint/composite).
- **Trigger:** Jank, flicker, layout shift, "feels off", render-stability audit.
- **Strong rules (paraphrased):**
  - Two modes: static pattern scan for PR review; runtime investigation only for a reported symptom. Maximum two escalation layers, then report unknowns.
  - LoAF `scripts[].forcedStyleAndLayoutDuration` points directly at layout thrashing.
  - Starting per-interaction budgets (report-only first): non-input CLS < 0.02, INP < 200 ms, zero LoAF > 50 ms, max frame gap < 75 ms, zero flicker/replacement of tracked stable panes.
- **Weak points:** React-only static catalog. "Up to 7× faster" for `content-visibility` is uncited.

## Cloudflare — skills `web-perf` — https://github.com/cloudflare/skills/blob/main/skills/web-perf/SKILL.md

- **Kind:** Claude skill (SKILL.md).
- **Signals:** 2,895 stars; file last commit 2026-09-05; skills.sh 79.5K installs.
- **Scope and structure:** 8.3 KB single file: 5-phase audit (trace, CWV insights, network, accessibility snapshot, codebase/bundler analysis). Classification: **by audit phase**.
- **Trigger:** Audit, diagnose or optimize loading/interaction performance, CWV, Lighthouse scores.
- **Strong rules (paraphrased):**
  - First line: model knowledge of thresholds and APIs may be stale; retrieve from web.dev/Chrome docs before quoting numbers.
  - Skip non-issues: if an insight estimates 0 ms savings, mention it but do not recommend work.
  - Be specific ("compress hero.png 450 KB to WebP"), and say so when a page is already fast.
  - Before recommending removal of a preconnect, confirm zero requests went to that origin.
- **Weak points:** Audit-only (not write-time). Mixes an accessibility phase into a performance skill. Includes Speed Index thresholds, which are low-value diagnostics.

## Emanuel Lorenzo — three-agent-skills `three-best-practices` — https://github.com/emalorenzo/three-agent-skills

- **Kind:** Claude skill (SKILL.md), Vercel-style index + rule files.
- **Signals:** 51 stars; last commit 2026-01-28; claims Three.js r182+.
- **Scope and structure:** 13 KB SKILL.md index of 120+ rule IDs in 22 prioritized categories, but only about 27 rule files exist; the rest live in a 45 KB compiled `THREE_BEST_PRACTICES.md`. Classification: by impact and GPU subsystem (memory, render loop, draw calls, geometry, materials, shaders, ...).
- **Trigger:** Writing, reviewing or optimizing Three.js/WebGL/WebGPU code.
- **Strong rules (paraphrased):** dispose geometries, materials, textures and render targets on teardown; one rAF loop; render on demand for static scenes; no allocations in the loop; InstancedMesh/BatchedMesh to cut draw calls; cap pixel ratio at 2; handle `webglcontextlost`/`webglcontextrestored` and test it with `WEBGL_lose_context`.
- **Weak points:** Core Web Vitals rule still names **FID**; INP replaced FID on 2024-03-12. "Use power-of-two textures" is a WebGL1 restriction (MDN describes the NPOT limits as WebGL1 behavior). "Limit to 3 lights", "~2× faster mediump" are uncited absolutes. Many index entries have no file (dangling pointers).

## GreenSock — gsap-skills `gsap-performance` — https://github.com/greensock/gsap-skills/blob/main/skills/gsap-performance/SKILL.md

- **Kind:** Claude skill (SKILL.md).
- **Signals:** 15,594 stars; file last commit 2026-03-09; skills.sh 54.2K installs.
- **Scope and structure:** 4.1 KB single file. Classification: by technique.
- **Trigger:** Optimizing GSAP animations, jank, FPS.
- **Strong rules (paraphrased):** reuse one tween for high-frequency targets (`gsap.quickTo`) instead of a new tween per `mousemove`; call `ScrollTrigger.refresh()` only on real layout change; kill off-screen or inactive tweens; never set `will-change`/`force3D` on everything.
- **Weak points:** Library-specific; "smooth 60fps" framing ignores high-refresh displays; tells users to put `will-change` in CSS on animated elements, which can leave layers promoted permanently.

## iart.ai — web-animation-skills `60fps-animation` — https://github.com/iart-ai/web-animation-skills/blob/main/skills/60fps-animation/SKILL.md

- **Kind:** Claude skill (SKILL.md).
- **Signals:** 27 stars; last commit 2026-06-22.
- **Scope and structure:** 10.8 KB SKILL.md + profiling reference. Classification: **by pipeline stage** (layout → paint → composite) with a property-to-replacement table.
- **Trigger:** Janky CSS animation, FLIP, animating `height: auto`, choppy hover/scroll.
- **Strong rules (paraphrased):** map each expensive property to a compositor-only equivalent (shadow via pseudo-element opacity, FLIP for true resizing); **verify** by recording a trace and asserting no Layout/Paint events during the animation window; set `will-change` just before animating and remove it after.
- **Weak points:** Calls the `grid-template-rows: 0fr → 1fr` trick "compositor-friendly enough"; it runs layout every frame. `interpolate-size` works only in Chromium (MDN BCD: Chrome 129, no Firefox/Safari).

## Vue.js AI — skills `vue-best-practices` (perf references) — https://github.com/vuejs-ai/skills

- **Kind:** Claude skill (SKILL.md) + many rule references.
- **Signals:** 2,869 stars; SKILL.md last commit 2026-02-10.
- **Scope and structure:** 8.8 KB SKILL.md; perf rules in `references/perf-*.md` (virtualize large lists, `v-once`/`v-memo`, avoid component abstraction in lists, `updated` hook cost). Frontmatter per rule: impact, `impactDescription`, tags.
- **Trigger:** "MUST be used for Vue.js tasks": very pushy, write-time.
- **Strong rules (paraphrased):** performance is a **post-correctness pass**; in hot list paths, each extra wrapper component multiplies instance cost (100 rows × 4 wrappers = 400 instances), so flatten list items.
- **Weak points:** Vue-only; no measurement guidance beyond Vue DevTools.

## Vercel — web-interface-guidelines (used by the `web-design-guidelines` skill) — https://github.com/vercel-labs/web-interface-guidelines

- **Kind:** Rule set fetched at run time by a Claude skill.
- **Signals:** Skill in vercel-labs/agent-skills (31K stars). The skill fetches `command.md` fresh before each review, so rules never go stale in the installed copy.
- **Strong rules (paraphrased):** no layout reads (`getBoundingClientRect`, `offsetHeight`, `scrollTop`) during render; controlled inputs must be cheap per keystroke; mutations (`POST/PATCH/DELETE`) finish under 500 ms; test with CPU/network throttling, in macOS Safari and iOS Low Power Mode, and with extensions disabled.
- **Weak points:** Terse one-liners without "why"; the run-time fetch depends on network access and trusts remote content.

## affaan-m — ECC (`rules/web/performance.md`, `skills/react-performance`) — https://github.com/affaan-m/ECC

- **Kind:** Claude Code rules (`.md` with `paths:` frontmatter) + skills.
- **Signals:** 265,522 stars (API value on 2026-09-22); `rules/web/performance.md` last commit 2026-07-04.
- **Scope and structure:** 2 KB web rule scoped with `paths:` to `*.css/*.html/*.tsx/*.vue/*.svelte`, so it loads only when Claude reads matching files. `react-performance` (18 KB) is an attributed adaptation of Vercel's rules.
- **Trigger:** Path-based (rule) and description-based (skill).
- **Strong rules:** budgets per page type (landing vs app vs microsite); dynamic import of heavy animation libraries; replace scroll handlers with IntersectionObserver.
- **Weak points:** Thin; FCP target (< 1.5 s) differs from web.dev's 1.8 s "good"; duplicate content of Vercel's skill (two sources of truth).

## Garry Tan — gstack (`benchmark`, `review/specialists/performance.md`) — https://github.com/garrytan/gstack

- **Kind:** Claude skill + review checklist.
- **Signals:** 133,946 stars; active (pushed 2026-09-23 UTC).
- **Scope and structure:** `benchmark/SKILL.md` 29 KB (baseline capture, comparison, trends). Review checklist 2.6 KB with JSON output schema per finding.
- **Strong rules:** stores immutable, timestamped baselines and compares branches; explicit regression thresholds (timing > 50 % or > 500 ms; bundle/transfer > 25 %; request count > 30 % = warning); each review finding is a JSON line with path, line, severity and fix.
- **Weak points:** Single-run timings with no variance handling; generic React memo advice; no rendering/GPU content.

## Cursor rule collections — PatrickJS/awesome-cursorrules, sanjeed5/awesome-cursor-rules-mdc, nedcodes-ok/cursorrules-collection — https://github.com/PatrickJS/awesome-cursorrules

- **Kind:** Cursor rules (`.mdc` / `.cursorrules`).
- **Signals:** 40,822 / 3,573 / 37 stars.
- **Findings:** No dedicated web-performance or CWV `.mdc` exists in these collections. `rules/svelte.mdc` (PatrickJS) is a clear anti-example: every line is "Use proper X" (no-op rules) and it teaches Svelte 4 patterns (stores, slots, event dispatching). `nedcodes practices/performance.mdc` is `alwaysApply: true`, mostly backend, and says "most selective column first" for composite indexes, a disputed rule. `sanjeed5 three-js.mdc` has useful BAD/GOOD pairs for draw calls and `dispose()`.
- **Lesson:** Glob-scoped rules are a good *loading* mechanism, but the content in these collections is too vague to change behavior.

## Real-world project instructions (AGENTS.md / copilot-instructions) — tldraw, excalidraw, svelte

- **Kind:** AGENTS.md / Copilot instructions.
- **Findings:** Of 13 graphics/UI repos checked, none has a web-performance section. Useful fragments: tldraw requires every subsystem that subscribes to events or holds a resource to register cleanup with the editor's disposer and to use editor-owned timers/frames. Excalidraw asks for allocation-free implementations where possible and to trade RAM for CPU. Svelte's AGENTS.md routes performance work to a repo skill that runs branch benchmarks.
- **Lesson:** Project-level instructions prefer *ownership and disposal contracts* over generic tips.

## Anthropic — anthropics/skills — https://github.com/anthropics/skills

- **Kind:** Claude skills (official examples).
- **Signals:** 177,671 stars; active.
- **Findings:** No web-performance skill. `frontend-design` has no performance content. `skill-creator` gives design guidance used below: descriptions should be a little "pushy" because Claude tends to under-trigger; keep SKILL.md under 500 lines; big references need a table of contents; test triggering with near-miss negative queries.

## SciChart (vendor) — no public skill — https://github.com/ABTSoftware/SciChart.Claude

- **Findings:** `ABTSoftware/SciChart.Claude` ("Claude plugins to aid development with SciChart") exists but the repository is empty (API: "Git Repository is empty", last push 2026-02-25). `SciChart.JS.Examples` has no AGENTS.md/CLAUDE.md/copilot file. scichart.com publishes an `llms.txt` (marketing/doc index) and describes a customer-only "SciChart MCP" in testing. **No public SciChart.js performance rule set exists**, so our skill must carry its own SciChart rules (verified against SciChart docs by another research track).

---

## Design lessons for our skill

1. **Separate write-time rules from diagnosis workflows.** Almost every popular skill is an audit ("speed up my site", "run a trace"). Their triggers do not fire while Claude writes a component. Our skill needs a write-time trigger (Vercel and Svelte skills do this well) and should push trace/measurement workflows into references that load only when a symptom or a runnable page exists.
2. **Trigger by file type as well as by words.** Claude Code skills accept `paths` (glob patterns that limit auto-activation) and `when_to_use`; `description` + `when_to_use` are truncated at 1,536 characters in the listing (code.claude.com/docs/en/skills). A path-scoped `.claude/rules/*.md` loads when Claude reads matching files (ECC uses this). Use globs such as `**/*.{svelte,ts,css,html}` and chart folders, and add explicit "do not use for" lines (zero-jank-scroll pattern).
3. **Index + one file per rule, with a pipeline-stage prefix.** Vercel's format (index table in SKILL.md; each rule = frontmatter + Incorrect/Correct code) scales to 70 rules at 7 KB of always-loaded text. Replace Vercel's framework prefixes with **pipeline stages**: `net-`, `parse-`, `script-`, `style-`, `layout-`, `paint-`, `composite-`, `gpu-`, `memory-`. Keep references one level deep and SKILL.md under 500 lines / about 5,000 tokens (agentskills.io spec).
4. **Every rule needs a detection signal and a verification.** Copilot's instructions attach a regex to each anti-pattern; iart's animation skill asserts "no Layout/Paint events in the animation window"; dejank gives numeric per-interaction budgets. Rules without a check (the Cursor "use proper X" style) are no-ops.
5. **Metric honesty is a rule, not a tone.** Static findings are hypotheses; never claim "60 fps", "GPU accelerated so smooth", or a Lighthouse score without a recorded measurement (zero-jank "honest output", Addy auditor, web-quality-skills v2).
6. **Retrieve, do not remember, version-sensitive facts.** Cloudflare's skill opens by distrusting pre-training; Vercel's design skill fetches rules at run time. For us: keep one dated `support.md` (API → Chrome/Firefox/Safari versions, Baseline date, source = MDN BCD / web-features, checked-on date) and make rules link to it. This survey found three stale facts in top skills (Firefox version for `scheduler.yield`, FID, TTI).
7. **Decide the renderer and its budget before code.** OpenAI's canvas skill starts with DOM/SVG vs Canvas2D vs WebGL and a backing-store memory formula; webgpu-skill starts with capability/data/pass/presentation/lifecycle contracts. For SciChart charts, the equivalent is a short "chart contract": series count, points per series, update rate, instances per page, DPR cap, degradation policy, teardown owner.
8. **Route symptoms to pipeline stages.** Good skills map a symptom to the stage first: INP phases (Addy), LCP subparts (Chrome), visual symptom buckets (dejank), "what is slow?" tree (Addy agent-skills). A small routing table in SKILL.md keeps the body short and sends the agent to the right reference.
9. **Process discipline for optimizations.** One change per measurement, beat run-to-run variance, revert neutral changes, keep an attempts ledger (Addy agent-skills). This stops agents from shipping "optimizations" that only add complexity.
10. **Prune with the no-op test and avoid sediment.** Svelte's `writing-great-skills`: delete any sentence that does not change default behavior; prefer one strong leading word; keep one source of truth. Counter-examples found: Vercel metadata "40+" vs "70 rules", three-agent-skills index entries with no rule file, ECC duplicating Vercel's rules.

## Rules to consider adding

Each rule is paraphrased, with the source that proposed it. Code examples are original.

1. **Canvas backing store = CSS size × DPR, clamped, set only on change; budget its memory.** Memory ≈ w × h × DPR² × 4 × layers × instances; cap DPR on constrained devices. Sources: https://github.com/openai/plugins/blob/main/plugins/build-web-data-visualization/skills/canvas2d-data-visualization/references/performance-playbook.md, https://github.com/cazala/webgpu-skill/blob/main/SKILL.md
   ```ts
   function syncBackingStore(canvas: HTMLCanvasElement, dprCap = 2): boolean {
     const dpr = Math.min(globalThis.devicePixelRatio || 1, dprCap);
     const w = Math.round(canvas.clientWidth * dpr);
     const h = Math.round(canvas.clientHeight * dpr);
     if (canvas.width === w && canvas.height === h) return false; // no-op: avoid clear + flicker
     canvas.width = w;
     canvas.height = h;
     return true;
   }
   ```
2. **Split layers by change rate; hover redraws only the overlay.** Static background, data series, hover/selection, interaction overlay; rebuild hit-test geometry only when positions or the viewport transform change. Source: openai canvas2d SKILL.md (URL above).
3. **Coalesce high-frequency input to one frame; never push it through framework state.** `pointermove`/`wheel` update a ref or plain object; one rAF applies it. Sources: https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/rules/rerender-use-ref-transient-values.md, https://github.com/harshavarma02/zero-jank-scroll-agent-skill/blob/main/skills/zero-jank-scroll/references/performance.md
   ```ts
   let pending: PointerEvent | null = null;
   el.addEventListener('pointermove', (e) => {
     if (pending === null) requestAnimationFrame(flush);
     pending = e; // keep only the latest event
   }, { signal });
   function flush() { const e = pending!; pending = null; crosshair.moveTo(e.offsetX, e.offsetY); }
   ```
4. **No per-frame GPU object creation and no full GPU→CPU readback in render or pointer loops.** Source: https://github.com/cazala/webgpu-skill/blob/main/references/debugging-and-performance.md
5. **Own the lifecycle: handle context/device loss and tear down in order.** Listen for `webglcontextlost`/`webglcontextrestored` (or `device.lost`); on destroy, stop rAF loops and observers first, then delete/dispose GPU resources. Sources: webgpu-skill SKILL.md; https://github.com/emalorenzo/three-agent-skills/blob/main/skills/three-best-practices/rules/error-handling-recovery.md
6. **Pause hidden work.** Off-screen charts, hidden tabs/panels and background tabs stop rAF, timers, canvas/WebGL redraws and observers. Sources: zero-jank-scroll performance reference; https://github.com/openai/plugins/blob/main/plugins/build-web-data-visualization/skills/dashboards-and-real-time-visualization/references/performance-and-degradation.md
7. **Write a degradation policy before building a streaming view, and show degraded state.** Ring buffers, aggregate older samples, lower update rate, pause off-screen charts under load. Source: openai dashboards performance-and-degradation.md (URL above).
8. **Reduce marks before tuning draws.** Decimate/aggregate when the viewport cannot resolve points; cull off-screen data; one polyline per trace; group by style state; typed arrays; zero allocations per frame. Source: openai canvas2d performance-playbook.md (URL in rule 1).
9. **Context flags on purpose.** `willReadFrequently: true` only for readback canvases (color picking); `alpha: false` for opaque canvases. Source: openai canvas2d SKILL.md and performance-playbook.md.
10. **Svelte 5: `$state.raw` for large replaced data; `$derived` over `$effect`; `{@attach}` to bind chart engines.** Source: https://github.com/sveltejs/ai-tools/blob/main/plugins/claude/svelte/skills/svelte-core-bestpractices/SKILL.md
    ```svelte
    <script lang="ts">
      let candles = $state.raw<Candle[]>([]);            // replaced per batch, never mutated in place
      const visible = $derived(candles.slice(-500));     // derived, not assigned in an effect
      function onBatch(next: Candle[]) { candles = next; } // one reassignment = one update
    </script>
    ```
11. **Cleanup via `AbortController`; one shared global listener per event.** Clear every interval/timeout in teardown. Sources: https://github.com/github/awesome-copilot/blob/main/instructions/performance-optimization.instructions.md (J3, J4), https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/rules/client-event-listeners.md
12. **Passive `touch*`/`wheel` listeners unless the handler must call `preventDefault` (chart zoom/pan must opt out explicitly and say why).** Source: https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/rules/client-passive-event-listeners.md
13. **Yield inside long tasks with `scheduler.yield()` and a `setTimeout` fallback; do not use `isInputPending()`.** Support today: Chrome 129, Firefox 142, no Safari (MDN BCD 8.1.2); web.dev no longer recommends `isInputPending`. Sources: https://github.com/addyosmani/web-quality-skills/blob/main/skills/core-web-vitals/references/INP.md, https://web.dev/articles/optimize-long-tasks
14. **Paint feedback first, then heavy work; send analytics to idle time with a timeout and a Safari fallback** (`requestIdleCallback` is not shipped in Safari; MDN BCD 8.1.2). Sources: Addy INP.md (URL above), https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/rules/js-request-idle-callback.md
15. **Late content goes into a pre-sized slot, never above visible content.** Source: https://github.com/addyosmani/web-quality-skills/blob/main/skills/core-web-vitals/references/CLS.md
16. **Animations must be compositor-only, and the check is a trace, not a belief.** No Layout/Paint events during the animation window; `will-change` added just before and removed after. Sources: https://github.com/iart-ai/web-animation-skills/blob/main/skills/60fps-animation/SKILL.md, https://github.com/greensock/gsap-skills/blob/main/skills/gsap-performance/SKILL.md
17. **Per-interaction budgets for CI (report-only first).** Non-input CLS < 0.02 per interaction, INP < 200 ms, zero LoAF > 50 ms, max frame gap < 75 ms. Source: https://github.com/gbasin/dejank/blob/main/references/tooling-and-signals.md
18. **Metric honesty.** Static findings are labeled "hypothesis"; no "60 fps", "GPU accelerated", or score claims without a recorded run (device, browser, throttling stated). Sources: zero-jank-scroll SKILL/performance reference; https://github.com/addyosmani/agent-skills/blob/main/agents/web-performance-auditor.md
19. **Neutral optimization = revert; one change per measurement; beat run-to-run variance; log attempts.** Source: https://github.com/addyosmani/agent-skills/blob/main/skills/performance-optimization/SKILL.md
20. **RUM coverage is wider than most skills assume.** INP (`interactionId`) and LCP now report in Safari 26.2+ and Firefox (LCP 122+, `interactionId` 144+); CLS (`LayoutShift`) and LoAF are still Chromium-only. Use the `web-vitals` attribution build and segment by browser. Sources: MDN browser-compat-data 8.1.2 and web-features (event-timing and LCP Baseline 2025-12-12); https://github.com/addyosmani/web-quality-skills/blob/main/skills/performance/references/RUM.md
