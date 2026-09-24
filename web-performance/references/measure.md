# Measure: prove a change with Chrome DevTools MCP, probes and scenario hooks

Open this when the user asks to measure, profile, trace or benchmark, gives a URL, reports a symptom, or when you are about to call a change faster or smoother. The order is fixed: baseline → one change → the same runs again → compare. Only then make a claim.
Browser: Chromium only. Tool names are those of the chrome-devtools-mcp server; in Claude Code they are `mcp__chrome-devtools__<tool>`. Every page tool needs `pageId` (from `new_page` or `list_pages`). The server version, its options (flags) and what each option unlocks are in support.md §C; WebMCP status is the support.md row `webmcp`.
"Kit check" numbers come from one real run of this kit in Chrome through DevTools MCP (desktop profile, 120 Hz display; the setup is in support.md §C). They show scale and behavior, not targets.
Contents: §0 Preflight · §1 The loop · §2 Lab profiles · §3 Driving scenarios · §4 Recipes (`#load`, `#inp`, `#cls`, `#fps`, `#fps-css`, `#gpu`, `#mem`, `#start`) · §5 Probes · §6 Compare and verdict · §7 Field data · §8 Files and tokens · §9 Report and ledger · §10 Pitfalls · §11 Tool cheat sheet

## §0 Preflight

1. **Tools.** Check which `mcp__chrome-devtools__*` tools exist. The heap analysis tools, the WebMCP tools and `click_at` load only with server options (support.md §C). If a tool is missing, say which one, and use the fallback in the recipe. Never change the user's MCP configuration or browser flags: the user turns them on. If `evaluate_script` is missing (one server option removes it), the probes and hooks cannot run: say so, and use traces and insights only. With no DevTools MCP at all, ask the user to record in the DevTools Performance panel and save the trace; `trace-summary.mjs` reads that file too.
2. **One page.** Get the `pageId` from `list_pages` or `new_page {url}`. Close every other page with `close_page`. A page that is open but not selected still reports `visible` and still runs rAF (kit check), so it takes frames from the measured page.
3. **Environment.** Use headed Chrome with the hardware GPU for frame and GPU work. Install the probe (§5), then run `async () => window.__wpProbe.env()` **before** `emulate`. `emulate` empties `navigator.userAgentData` (kit check), and after it `env()` reports only a reduced browser string. Record `browser`, `platform`, `glRenderer`, `webgpu`, `dpr` and `cores`. When `warnings` says "software renderer", do not report frame or GPU numbers.
4. **Build.** Use a production preview build for `#load` and `#start`. A dev build is acceptable only to compare frames or interactions on the same code path. Write the build into the run file and the report.
5. **Files.** Traces, snapshots, run files and the ledger go to the session scratchpad, not into the repository, unless the user asks. The server can refuse the scratchpad; §8 says where to save.
6. **Hooks.** Canvas and streaming scenarios need the hook template in the project (§3). Ask the user before you copy it.

## §1 The loop

1. **Define** the claim, the metric, the scenario steps, the pass condition (from the rule's Verify line) and the profile, before the first run. Take the data scale from the chart contract (SKILL.md) when the view has one.
2. **Baseline** on unchanged code: 5 runs. Slow load traces can use 3; `compare-runs.mjs` then marks the verdict "low N". If the change is already in the working tree, measure `HEAD` from a separate worktree: `git worktree add <scratchpad>/wp-base HEAD`, install its dependencies, and serve it on a second port. Never stash, reset or check out over the user's changes. Remove the worktree when you finish (`git worktree remove <path>`).
3. **Interleave.** When both builds can run, alternate them (B1 A1 B2 A2 …) in the same page, with a new navigation for each run. Then heat, caches and background work affect both sides equally.
4. **One change.** Rebuild. Confirm with `take_snapshot` or a screenshot that the view still shows the same data.
5. **After:** the same steps, profile, cache state, run count and file-name pattern (`<change>-base-<n>`, `<change>-after-<n>`).
6. **Compare** with `compare-runs.mjs` (§6). Also compare the insight lists: a removed insight, or smaller "estimated savings", supports the claim; a new insight is a regression to explain. Check side effects: CLS, console errors, request count, transfer bytes, heap.
7. **Decide.** Keep a win. Revert a neutral or regressed change, or keep it for a stated reason that is not performance. A win that needed a test changed or deleted is a regression.
8. **Record** one ledger row (§9).

For a diagnosis ("why is X slow?"), run the baseline and the recipes only. Report the cause with its numbers, propose the fix, and wait for the user before you change code.

## §2 Lab profiles

Set every option in **one** `emulate` call. When you omit an option, `emulate` resets it: the CPU rate goes back to 1, network throttling goes off, and the viewport, user agent and color scheme are cleared. Only extra HTTP headers persist.

| Profile | `emulate` arguments (with `pageId`) | Use |
|---|---|---|
| Desktop (default) | `viewport: "1440x900x2"`, `cpuThrottlingRate: 4`, no `networkConditions` | `#inp`, `#cls`, `#fps`, `#fps-css`, `#gpu` |
| Desktop load | the same plus `networkConditions: "Fast 4G"` | `#load`, `#start` |
| DPR sweep | the default at `"1440x900x1"`, then at `"1440x900x2"` | canvas and GPU work: pixels grow with DPR² |
| Mobile | `viewport: "412x823x1.75,mobile,touch"`, `cpuThrottlingRate: 4`, `networkConditions: "Slow 4G"` | public pages; the Lighthouse mobile preset |
| Memory | `viewport: "1440x900x2"` only | `#mem`: throttling only makes the run slower |

- **Confirm.** The `emulate` reply echoes "Emulating CPU throttling: 4x slowdown". After each trace, the summary header must read `CPU throttling: 4x` and `Network throttling: none` (or the preset). Discard a run when they differ.
- **Order.** `env()` → `emulate` → `wait_for` and setup → the load that you measure. Emulation stays set across `navigate_page` and reloads of the same page; a new page starts without it. A change of the `,mobile` or `,touch` flags can reload the page, and then setup that you did before it is lost.
- **Emulate before the load you measure.** The viewport changes layout and shift scores: in the kit check, one banner shift scored 0.0494 before `emulate` and 0.0344 after it.
- **GPU.** CPU throttling slows only the renderer main thread, not the GPU. Treat throttled frame times of GPU-heavy views as a lower limit, and label GPU-bound results "needs a real-device check".
- **Limits.** The CPU rate is relative to the host, so numbers from two machines do not compare. Network presets throttle WebSocket bandwidth and the handshake, not the latency of each message: to test message latency, add the delay in a replay server or proxy, and say so. Network throttling is refused while URL-blocking options are set.

## §3 Driving scenarios

Give every run the same input.

- **DOM controls.** Call `take_snapshot` before the trace, then `click`, `hover`, `fill`, `type_text` or `press_key` with the element `uid`. These tools send trusted input, so Event Timing records it. A tap is one interaction: `pointerdown`, `pointerup` and `click` share one `interactionId`, so check the handlers of all three.
- **Canvas and continuous input** (pan, zoom, drag inside a canvas, a live stream). `drag` moves from one uid to another uid, so it cannot pan inside one canvas, and `click_at` needs a server option. Do not count on script-dispatched events for input timing; a scripted wheel event does not scroll. Use scenario hooks.
- **Programmatic scroll.** Without hooks, a loop that sets `el.scrollTop` once per rAF for a few seconds measures the render cost of a list or table scroll. It skips the input path (scroll-blocking listeners), so say so.

**Scenario hooks: `assets/perf-hooks.dev.ts`.** The template registers dev-only WebMCP tools and puts the same API on `window.__perf`. With the user's approval:

1. Copy it into the project, next to the app entry.
2. Write a `PerfAdapter`: `fixtures` (seeded local data; each resolves when its data is on screen and returns `{ points }`), `scenarios` (time-boxed; each stops when its `signal` aborts), `reset()`, and `counters()` (numbers that must return to baseline: mounted views, listeners, canvases, a wasm heap size). Keep the names in the template's `SCENARIOS` list that fit the app (`stream`, `pan`, `zoom`, …); rename or drop the rest.
3. Load it only in development, so production bundles drop it:
   ```ts
   if (import.meta.env.DEV) {
     const { registerPerfHooks } = await import('./perf-hooks.dev');
     const dispose = registerPerfHooks(adapter);
     import.meta.hot?.dispose(dispose); // a duplicate tool name rejects: dispose before you register again
   }
   ```
4. Recommend `Permissions-Policy: tools=()` on production servers as a second defense. Chrome can log a console warning for it on pages without WebMCP.

Any agent or extension on the page can call these tools. Keep them harmless: seeded local data and measurement only, no network writes, no account data. The template feature-detects `document.modelContext`: without WebMCP it sets up only `window.__perf`, and app behavior never depends on either.

| WebMCP tool | `window.__perf` | Input (clamped; default) | Output |
|---|---|---|---|
| `load_fixture_data` | `loadFixture(name)` | `fixture`: a name from `fixtures` | `{ fixture, points, ms }` |
| `run_scenario` | `run(name, options)` | `scenario`; `seconds` 1–30 (5); `repeat` 1–50 (10); `rate` 1–5000 per s (300) | `{ scenario, ms, seconds, repeat, rate }` |
| `get_frame_stats` | `frameStats(durationMs)` | `durationMs` 200–10000 (2000) | `{ frames, hz, p50Ms, p95Ms, p99Ms, maxGapMs, over16_7, over33 }` |
| `get_perf_summary` | `summary()` | none | `{ last, loaf: { count, blockingMs, worstMs }, counters }` |
| `reset_state` | `reset()` | none | `{ reset: true }` |

- `run` sets `performance.mark('wp:start', { detail: <name> })` and `wp:end`, so `trace-summary.mjs --between wp:start wp:end` can window a trace. One scenario runs at a time; a second call fails with "already running".
- **With WebMCP.** Page-tool replies list the WebMCP tools registered at that moment; in the kit check, the `new_page` reply came before the hooks registered, and the `navigate_page` reply listed them. So after the page shows its ready text, call `list_webmcp_tools {pageId}`, then `execute_webmcp_tool {pageId, toolName: "run_scenario", input: "{\"scenario\":\"stream\",\"seconds\":5}"}`: `input` is a JSON string. The `status` is `Completed`, `Canceled` or `Error`. After `Completed`, also check `output.error`: in the kit check, Chrome dropped the message of a thrown error (`errorText` was empty), so the template returns `{ error }` instead of throwing. Chrome did not check the input against the schema enums; the template does.
- **Without WebMCP.** Call the same API through `evaluate_script`, for example `async () => window.__perf.run('pan', { seconds: 5 })`. Here errors throw.
- **Keep hooks out of the measured window.** A tool call is main-thread work in the trace. Call `load_fixture_data` before `performance_start_trace`, only `run_scenario` inside the trace, and `get_frame_stats` or `get_perf_summary` after the trace stops.
- **Empty tool list.** The template logs "[perf-hooks] <name> was not registered" when registration fails, for example in a page that is not origin-keyed. Read `list_console_messages`.
- Kit check: `load_fixture_data` loaded 50,000 points in 69.7 ms; a 5 s `stream` took 5001.2 ms; `get_perf_summary` gave 26 LoAFs and 265.1 ms of blocking; `window.__perf.run` clamped `repeat: 999` to 50.

**Marks without hooks.** Around manual steps, call `() => { performance.mark('wp:start'); }` before and `() => { performance.mark('wp:end'); }` after, through `evaluate_script` with `waitForStableDom: false`.
**Waits.** There is no sleep tool. Use `evaluate_script` with `() => new Promise((r) => setTimeout(() => r({ waitedMs: 1000 }), 1000))`, or `wait_for {pageId, text: ["ready"]}` for visible text.
**Hidden tab.** A page that is not selected stays `visible` (kit check). For a hidden-tab test, read `document.visibilityState` first; if it stays `visible`, ask the user to switch tabs or minimize the window.
**App phases in a trace.** `performance.measure(name, { start, detail: { devtools: { track, color } } })` or `console.timeStamp(label, start, end, track, group, color)` draw custom tracks, and the MCP summary lists them under "# Custom tracks". Aggregate per frame: each `console` call costs about 30 times more while MCP is attached (about 4.9 µs).

## §4 Recipes

Each recipe assumes §0 and one `emulate` call from §2. Put probe and hook calls in `evaluate_script` with `waitForStableDom: false`.

### Reading `trace-summary.mjs`

`node ${CLAUDE_SKILL_DIR}/scripts/trace-summary.mjs <trace.json[.gz]> [--between <startMark> <endMark>] [--thread <pid:tid>] [--top <n>] [--json]` reads a saved trace (MCP or DevTools, gzip or plain) and prints a short summary. Times are inclusive, so rows overlap.

| Line | Meaning |
|---|---|
| `Window` | The whole trace, or each `<startMark>` → next `<endMark>` pair. With no pair, it fails and lists the marks it found |
| `Main thread` | The renderer main thread: from `--thread`, else the thread of the start mark, else the busiest one |
| `Throttling` | "not in the file" for MCP traces: take the profile from the MCP summary header |
| `Tasks` | Top-level tasks: busy time, tasks over 50 ms, the longest, and blocking time (the sum over 50 ms) |
| Event table | Evaluate and compile, function calls, events, timers, "Animation frame fired", microtasks, GC, Recalculate style, Layout, Pre-paint, Paint, Layerize, Commit, parsing; then the top other events |
| `Style`, `Layout` | Recalculations and elements styled; layouts that were partial or for the whole document, `dirtyObjects`, `totalObjects`, layout roots |
| `Forced by script` | Style or layout with a JS stack, as `function (file:line:column)`, 1-based as in the trace |
| `Layout shifts`, `Interactions` | The shift score without recent input; the worst interaction and its event type |
| `Frames`, `Off main thread` | BeginFrame, DrawFrame, DroppedFrame; `GPUTask` and `RasterTask` time |

Kit check: a load trace (5073 ms) showed 16 tasks over 50 ms (the longest 61.1 ms), 169.6 ms of blocking, 111 dropped frames, and one forced layout at `draw (app.js:61:31)`; the fixed page showed none of these. A `--between wp:start wp:end` window of 3001.7 ms held 10 tasks over 50 ms and 60 dropped frames.

### `#load` Page load: LCP, FCP, TTFB, load CLS

1. **Warm:** `navigate_page {pageId, type: "url", url}` → `emulate` (desktop load) → `performance_start_trace {pageId, reload: true, autoStop: true, filePath}`. The navigation fills the HTTP cache, so this trace is warm.
   **Cold:** `new_page {url: "about:blank", isolatedContext: "run-<n>"}` → `emulate` on the new `pageId` → `performance_start_trace {reload: false, autoStop: false}` → `navigate_page {type: "url", url}` → `wait_for` → `performance_stop_trace {filePath}`. Or trace a `navigate_page {type: "reload", ignoreCache: true}`, which also bypasses the service worker. Neither form closes open connections or clears DNS, so TTFB can beat a real first visit. Write "cold" or "warm"; never mix them in one comparison.
2. `autoStop` ends the trace 5 s after `load`. Later work (a fetch, then the first chart frame) needs the manual form. The reload also drops fixtures in memory: for load traces, let the page choose its fixture at boot (a dev-only URL parameter).
3. From the summary, note LCP and its subparts, CLS, the insight set id (`NAVIGATION_0`) and the listed insights. Call `performance_analyze_insight {pageId, insightSetId, insightName}` for `LCPBreakdown`, then for the largest subpart: TTFB → `DocumentLatency`; load delay → `LCPDiscovery`, `NetworkDependencyTree`; render delay → `RenderBlocking`, `ForcedReflow`. Targets: TTFB about 40%, load delay under 10%, load duration about 40%, render delay under 10%. Read insights in detail on run 1; after that, record the numbers.
4. Install the probe and call `() => window.__wpProbe.paint()` for FCP, TTFB, DCL, load time and bytes by type. The summary does not print FCP or TTFB.
5. A canvas is never the LCP element: on a chart page, LCP is a text or image element. Add an app mark after the first frame that shows data (`performance.mark('app:first-frame')`) and read it: `() => performance.getEntriesByName('app:first-frame')[0]?.startTime`.
- Run-file metrics: `lcpMs`, `fcpMs`, `ttfbMs`, `cls`, `firstFrameMs`. Pass: the LCP median wins; the targeted subpart moved, and the time did not move into render delay; no new insight.

### `#inp` One interaction: INP and its three subparts

1. Setup: navigate, `wait_for` the ready text, install the probe, `emulate` (desktop), `take_snapshot` for the uid.
2. `() => [window.__wpProbe.interaction.start(), window.__wpProbe.loaf.start()]`.
3. `performance_start_trace {pageId, reload: false, autoStop: false}` → the interaction (`click {pageId, uid}`, `press_key`, `type_text`, or `run_scenario` for a canvas) → wait 1000 ms → `performance_stop_trace {pageId, filePath}`.
4. Read INP from the summary. Use the insight set id that it lists: `NO_NAVIGATION`, or `NAVIGATION_<n>` when the interaction started a soft navigation. Analyze `INPBreakdown`, and `ForcedReflow` and `DOMSize` when they are listed.
5. `async () => ({ ix: await window.__wpProbe.interaction.read(), loaf: await window.__wpProbe.loaf.read() })`: the worst interactions with `inputDelayMs`, `processingMs` and `presentationMs`, and the top LoAF scripts with `forcedLayoutMs`. `under16Ms` counts interactions too fast to get an Event Timing entry.
- Kit check (a 150 ms click handler, desktop profile): the probe read 168 ms (1.2 / 151 / 15.9 ms) and the trace read 168 ms (1 / 151 / 16 ms). The top LoAF script was the click listener (150.2 ms). Event Timing rounds durations to 8 ms. The first click after load read 264 ms because a long frame came at the same time: take 5 runs, never one.
- To reproduce a slow interaction reported from the field, also run it while the page still loads, when the main thread is busiest. Keep those runs separate from the settled ones.
- Run-file metrics: `inpMs` (the worst `latencyMs`), `inputDelayMs`, `processingMs`, `presentationMs`, `loafCount`. Pass: the targeted subpart wins, and the other two are not worse.

### `#cls` Layout shifts at load and after interactions

- **Load CLS.** Wait until the load and every delayed insert are done, then call `async () => window.__wpProbe.shift.read()` **without** `shift.start()`. The buffered entries go back to the navigation, and `start()` drops them.
- **Interaction CLS.** `shift.start()` → the interaction or scenario → wait past the app's delayed work → `shift.read()`. Shifts within 500 ms after input carry `hadRecentInput` and do not count.
- **Trace.** Use a reload trace plus the scripted steps, and analyze `CLSCulprits` (unsized images, web fonts, injected iframes, animations that are not composited).
- `read()` returns `cls` (the largest session window: gaps under 1 s, at most 5 s long), `sumNoInput`, and the 3 worst shifts with their source nodes.
- Kit check: a result row inserted 800 ms after a click shifted 0.0103 (`hadRecentInput: false`; sources `canvas#gl` and `p#ready`); the trace read 0.01.
- Run-file metrics: `cls`, `shiftPerInteraction`. Pass: CLS wins, and the shift without input stays under 0.02 per interaction.

### `#fps` Frames during pan, zoom, drag or streaming

1. Setup outside any window: navigate, ready text, probe, `emulate`, then `load_fixture_data` (or `window.__perf.loadFixture(name)`).
2. **Frame run** (the numbers for the run file). Use **one** `evaluate_script`, so that your own time between tool calls stays out of the window:
   ```js
   async () => {
     const p = window.__wpProbe;
     p.frame.start();
     const scenario = await window.__perf.run('stream', { seconds: 5, rate: 300 });
     return { scenario, frame: p.frame.stop() };
   }
   ```
   Split calls add agent time: a scripted 5.5 s window read 9.4–11.3 s in the kit check. Without hooks, replace the `run` line with a wait while the motion runs.
3. **Traced run** of the same scenario, as a separate run without the frame probe: `performance_start_trace {reload: false, autoStop: false}` → `execute_webmcp_tool` `run_scenario` → `performance_stop_trace {filePath}` → `node ${CLAUDE_SKILL_DIR}/scripts/trace-summary.mjs <file> --between wp:start wp:end`. Then `async () => window.__wpProbe.loaf.read()` names the scripts behind long frames.
- **Read.** `hz` is the display rate (the frame budget is 1000 / `hz` ms). `longFrames` are frames over 1.5 × the refresh period. `truncated` means: raise `maxFrames`. The MCP summary has no frame, FPS or GPU data; `trace-summary.mjs` prints BeginFrame, DrawFrame and DroppedFrame counts and `GPUTask` time (CPU time in the GPU process, not shader time).
- **Which metric shows what.** rAF intervals jitter by about ±25%, so p95 stays near the refresh period on a smooth page, and rare long frames (3% in the kit check) do not move it. p95 shows steady overload. `longFramesPer10s`, `frameP99Ms`, `maxGapMs` and the LoAF count show jank. Compare rates, not counts, because window lengths differ.
- Kit check (a 60 ms frame every 30 frames, 120 Hz display), before → after: p95 10.3 → 10 ms (neutral); p99 58.9 → 10.3 ms, long frames per 10 s 33.3 → 0, max gap 143 → 10.4 ms, LoAF count 35 → 0 (all "win").
- **Idle check.** To prove that a loop stops when nothing changes, trace an idle window between `wp:` marks without the frame probe (its own rAF keeps frames running). Pass: 0 "Animation frame fired" in the window.
- Run-file metrics: `frameP95Ms`, `frameP99Ms`, `longFramesPer10s`, `maxGapMs`, `loafCount`. Pass: the metric that the rule names wins, and none of the five regresses. Lab budgets are in SKILL.md: no LoAF over 50 ms, max frame gap under 75 ms.

### `#fps-css` CSS motion that must stay on the compositor

1. Setup, and `take_snapshot` for the uid of the control that starts the motion.
2. `performance_start_trace {reload: false, autoStop: false}` → mark `wp:start` → run the motion 5 times (`click` with a wait per animation, or a scenario) → mark `wp:end` → `performance_stop_trace {filePath}`.
3. `trace-summary.mjs <file> --between wp:start wp:end`: read the Layout, Pre-paint, Paint, Layerize and Commit rows and "Forced by script".
4. Animations that failed to composite carry `compositeFailed` on `Animation` trace events. Print them without reading the trace into context:
   ```sh
   node -e "const f=require('fs'),z=require('zlib');let b=f.readFileSync(process.argv[1]);if(b[0]===31)b=z.gunzipSync(b);const d=JSON.parse(b);for(const e of d.traceEvents??d){const a=e.args?.data;if(e.name==='Animation'&&a?.compositeFailed)console.log(a.displayName??a.name,a.nodeName,a.compositeFailed,(a.unsupportedProperties??[]).join(' '))}" <trace>
   ```
- Pass: 0 Layout and 0 Paint in the window for `transform` and `opacity` motion (at most one per run of the motion where the rule allows it), and no composite failure for the element. For layer counts, ask the user to check the DevTools Layers panel.

### `#gpu` Find what limits a canvas or GPU frame

1. Check `env()`: a hardware `glRenderer`, and `webgpu.fallback` false. A software renderer gives functional results only.
2. Run `#fps` at `"1440x900x1"` and at `"1440x900x2"`. Frame time that grows with the pixel count points at fill or raster cost.
3. Run it again with the canvas at a quarter of its area, then with the draw calls skipped (dev options in the adapter). No change with draws skipped: the limit is on the CPU side (data preparation, uploads, script). Long frames with little main-thread time in LoAF and `trace-summary.mjs`: the limit is the GPU.
4. In a dev build, read GPU timer queries where the device supports them (the `gpu-` rule files). Call `list_console_messages {pageId, types: ["error", "warn"]}` for GL errors and performance warnings.
- Pass: a named limit (fill, vertex, upload or CPU) with the frame numbers of each step. Label GPU-bound results "needs a real-device check".

### `#mem` Growth per repeated action

1. Memory profile (§2). Warm up: do the action twice. Call `() => window.__wpProbe.memory.start()`.
2. `take_heapsnapshot {pageId, filePath: "<dir>/s0.heapsnapshot"}`. A snapshot forces a full GC first, so snapshot growth is retained memory.
3. Do the action 10 times (open and close a panel, mount and unmount a view, switch the data set). After each one, `async () => window.__wpProbe.memory.sample()`: DOM nodes, canvases, the app counters, and each one's change from the first sample.
4. Snapshot S1, then 10 more actions, then snapshot S2.
5. With the heap tools: `get_heapsnapshot_summary {filePath}` for each size; `compare_heapsnapshots {baseFilePath: S1, currentFilePath: S2}` for the steady state (S0 → S1 shows warm-up); for the top growing class, `get_heapsnapshot_class_nodes {filePath, id}` (the class id comes from `get_heapsnapshot_details`; add `filterName: "objectsRetainedByDetachedDomNodes"`, `"objectsRetainedByEventHandlers"`, `"objectsRetainedByContexts"` or `"objectsRetainedByConsole"`) and `get_heapsnapshot_retaining_paths {filePath, nodeId}`; `close_heapsnapshot {filePath}` at the end. Without the heap tools, use the counters and the slope, and ask the user to open the snapshots in the DevTools Memory panel.
- **Why S1 → S2.** One before-and-after pair cannot tell a leak from a cache that fills once. Growth per repetition after warm-up can. Fit a line to the samples; a leak is a slope above noise.
- **Limits.** Never take a snapshot inside a trace: it pauses the page. `sample({ uaMemory: true })` adds `measureUserAgentSpecificMemory()` (support.md row `measure-memory`): it needs `crossOriginIsolated`, forces a GC and can take 20 s or more. Never use `performance.memory`. Wasm memory only grows, and a snapshot shows it as one buffer: read its size from an app counter. A detached node or a large `Map` can be an intended cache: ask before you remove references.
- Run-file metrics: `heapPerActionMb` ((S2 − S1) / 10), `domNodesDelta`, and each counter's change. Pass: S1 → S2 growth per action is within noise, the counters return to baseline, and no detached canvas remains.

### `#start` Startup JavaScript

1. A cold `#load` trace on the production preview build.
2. `list_network_requests {pageId, resourceTypes: ["script"], pageSize: 50}` lists the requests; it shows no sizes or times.
3. `() => window.__wpProbe.paint()`: `byType.script` gives the count, `transferKB`, `decodedKB` and render-blocking count. A cross-origin file without `Timing-Allow-Origin` reports 0 bytes.
4. `trace-summary.mjs <file>`: the "Evaluate script", "Evaluate module", "Compile script", "Compile code" and "Compile module" rows, and the tasks over 50 ms.
5. Bytes per chunk come from the bundler's own report, when the project has one.
- Run-file metrics: `scriptTransferKB`, `evaluateMs`, `compileMs`, `lcpMs`. Pass: bytes or evaluation time win, and `#load` LCP and `#inp` are not worse.

## §5 Probes: `scripts/probes.js`

One idempotent function that installs `window.__wpProbe` (Chromium only).

- **Install.** Read the file and pass its whole text, unchanged, as the `function` of `evaluate_script`, with `waitForStableDom: false`. The reply is `{"installed":true,"version":<n>}`. A second install in the same document replies `installed: false` and keeps the running observers; a probe with another `VERSION` is replaced. The tool wraps the text as `(<text>)`, so the file must start with the function and must not end in a line comment. Install again after every navigation or reload.
- **Cost.** One install is about 15 K characters of tool input. Run several probe windows per page load when the recipe allows it.
- **Call** with small functions: `() => window.__wpProbe.frame.start()`, `async () => window.__wpProbe.interaction.read()`.
- **Early install.** The observers use `buffered: true`, so entries from before the install count, up to each buffer (LoAF 200 entries; event and layout-shift 150). An install after load is fine for short runs. For long sessions, pass `(<file text>)()` as the `initScript` of `navigate_page`. It applies to that one navigation only, not to later ones or to the reload inside `performance_start_trace`. The kit check installed the probe this way from a served copy of the file, at 21 ms.

| Call | Returns | Notes |
|---|---|---|
| `env()` async | `browser`, `platform`, `dpr`, `viewport`, `glRenderer`, `webgpu` {vendor, arch, fallback}, `cores`, `deviceMemoryGB`, `crossOriginIsolated`, `webmcp`, `perfHooks`, `warnings` | Before `emulate`. It creates one short-lived WebGL2 context, so on a page with many contexts call it first |
| `frame.start({ maxFrames })`, `frame.stop()` | `frames`, `spanMs`, `hz`, `p50Ms`, `p95Ms`, `p99Ms`, `maxGapMs`, `over16_7`, `over33`, `longFrames`, `longFramesPer10s`, `loaf` {count, blockingMs}, `truncated` | The probe's own rAF keeps frames running: it measures cadence, not an idle page that renders on demand |
| `interaction.start()`, `interaction.read()` async | `count`, `under16Ms`, `top` (5): type, target, latencyMs, inputDelayMs, processingMs, presentationMs | Support row `event-timing`; lab interactions, not field INP |
| `shift.start()`, `shift.read()` async | `count`, `withInput`, `cls`, `sumNoInput`, `worst` (3): t, v, input, src | Support row `layout-instability`; `read()` without `start()` gives load CLS |
| `loaf.start()`, `loaf.read()` async | `count`, `blockingMs`, `worstFrameMs`, `worst` (3), `topScripts` (6): ms, n, forcedLayoutMs, type, invoker, src, fn | Support row `long-animation-frames`; scripts over 5 ms only; none from workers or cross-origin frames |
| `paint()` | `navType`, `protocol`, `ttfbMs`, `fpMs`, `fcpMs`, `dclMs`, `loadMs`, `docTransferKB`, `cacheHits`, `byType` | Times count from `activationStart` |
| `memory.start()`, `memory.sample({ uaMemory })` async | `i`, `domNodes`, `canvases`, `counters`, `uaMB`, `delta` | `counters` come from `window.__perf.counters()` |
| `dispose()` | `{ disposed: true }` | Disconnects the observers |

## §6 Compare and verdict: `scripts/compare-runs.mjs`

Write one run file per side, from the probe and trace numbers of each run:

```json
{ "label": "base", "profile": "desktop 1440x900 DPR 2, CPU 4x, network off", "build": "prod preview",
  "env": { "browser": "<env().browser>", "glRenderer": "<env().glRenderer>", "dpr": 2 },
  "runs": [ { "id": "base-1", "frameP95Ms": 10.3, "frameP99Ms": 58.9, "longFramesPer10s": 34.1, "inpMs": 176 } ] }
```

- Every finite number in a run is a metric; `id` and other strings are ignored. Use the same metric names on both sides.
- `profile`: copy the trace header lines here. A saved MCP trace has no throttling keys (its metadata holds only Chrome's own fields, such as `command_line`, `gpu-gl-renderer` and `cpu-num-cores`), so `trace-summary.mjs` prints "Throttling: not in the file".
- Run `node ${CLAUDE_SKILL_DIR}/scripts/compare-runs.mjs base.json after.json`, optionally with `--floor <metric>=<value>` and `--higher <metric>`.
- Lower is better, unless the name contains `fps` or is listed in `--higher`. Noise band T = max(2 × MAD of base, 5% of the base median, floor). **Win:** after median < base median − T. **Regression:** after median > base median + T. Otherwise **neutral**. Fewer than 3 runs on a side: "insufficient runs". 3–4 runs: the verdict carries "(low N)". A metric on one side only: "missing in <label>".
- Default floors, by metric name: INP, interaction, processing, input delay and presentation 10 ms; LCP 50 ms; long frames 1 per 10 s; frame percentiles 0.5 ms; heap per action 0.1 MB. They are starting values: change them with `--floor` after real runs, and say so in the report.
- When `profile`, `build` or a shared `env` key differs, the output starts with "WARNING: conditions differ". The comparison is then not valid: fix the conditions and measure again.
- The output is a Markdown table (Metric, Before median (MAD), After median (MAD), Δ, Δ%, Noise band, Verdict) and a tally such as "Verdicts: 3 neutral, 6 win".

## §7 Field data

- Lab results prove lab behavior. Lab INP is one sample of one interaction, not a p75. Claim a field improvement only after new field data arrives.
- Collect with the `web-vitals` attribution build (`onINP`, `onLCP`, `onCLS` from `web-vitals/attribution`; its version is in support.md §D). Register each listener once per page load, not per component mount. Queue values and send them with `navigator.sendBeacon` when `visibilitychange` reports hidden; send `id` and `delta`, and deduplicate on the server. `reportSoftNavs: true` reports per route in an SPA (support.md row `soft-navigations`). The INP attribution includes the LoAF entries of the slow interaction.
- Report p75 from per-instance values (watch p90 and p95 too), split by browser, device class and connection, and tag every value with the deploy version.
- CLS and LoAF entries exist only in Chromium (rows `layout-instability`, `long-animation-frames`). A canvas is never an LCP candidate: send the app's first-frame mark as a custom metric.
- For public URLs, the trace summary prints CrUX field data: fix what is bad in the field first. The server sends trace URLs to the CrUX API unless CrUX is off (support.md §C). For localhost and private URLs, tell the user when it is on.

## §8 Files and tokens

- Save every trace with `filePath` as `.json.gz`: 1.0–2.6 MB for 5–7 s in the kit check, against 19.3 MB of plain `.json` for 5 s. Save every heap snapshot to a `.heapsnapshot` file. Never read a raw trace or snapshot into the context: use insights, `trace-summary.mjs` and the heap tools.
- **Where the server can write.** Only inside its roots: the client's announced roots, a workspace folder set by a server option, or, when neither exists, the OS temp directory. In the kit check, the session scratchpad was refused ("not within any of the configured workspace roots"). Save to the OS temp directory (on macOS usually `/var/folders/…/T/`, which `getconf DARWIN_USER_TEMP_DIR` prints), then copy the file into the scratchpad with Bash.
- Analyze every insight you need before the next trace: the server keeps only the last trace, and only one trace can run at a time.
- Call `take_snapshot` before a trace, not inside it. Prefer it to screenshots. For visual proof, use `take_screenshot {format: "webp", quality: 80}` or a `filePath`.
- Paginate with `pageSize`: `list_network_requests`, and `list_console_messages {types: ["error", "warn", "issue"]}`. Keep probe output small; send a large result to the `filePath` of `evaluate_script`.
- `trace-summary.mjs` never loads the trace into the context. Add `--json` for machine-readable output, `--thread <pid:tid>` when it picks the wrong renderer main thread, and `--top <n>` for more rows.

## §9 Report and ledger

```markdown
## Measured result: <change> (<date>)
Profile: desktop 1440x900, DPR 2, CPU 4x, network off · Build: <prod preview | dev> · Browser: <env().browser> · GPU: <glRenderer> · Runs: <n> + <n>, interleaved · Cache: <cold | warm>
| Metric | Before median (MAD) | After median (MAD) | Δ% | Verdict |
|---|---|---|---|---|
| <rows from compare-runs.mjs> |
Traces: <paths> · Insights read: <names> · Console errors: <n> · Kept: <yes | reverted>
Limits: lab only; CPU throttling does not slow the GPU; <debug tier, when wasm-heavy (§10)>.
```

Rows from the kit check (3 + 3 runs, so every verdict is "low N"): `frameP99Ms` 58.9 (0.5) → 10.3 (0), −82.5%, win; `inpMs` 168 (0) → 32 (0), −81%, win; `presentationMs` 17 (0.6) → 25.2 (0.1), +48%, neutral, because 8.2 ms is inside the 10 ms floor.

Keep a ledger in the scratchpad: one row per attempt, kept or reverted. A review's "Attempts ledger" uses the same columns.

| Date | Commit | Change | Scenario · profile | Metric | Before median (MAD) | After median (MAD) | Verdict | Kept | Files |
|---|---|---|---|---|---|---|---|---|---|

State the device, browser, profile, build and run count with every number. Never write "60 fps", "smooth" or "faster" from one run.

## §10 Pitfalls

- **Load traces have no interactions**, so they cannot show INP. Long main-thread blocking during load is only a proxy for INP risk.
- **The trace summary omits** TBT, FCP, frame rate and GPU data. Use `paint()`, the frame probe and `trace-summary.mjs`.
- **`lighthouse_audit` excludes performance** in this server. Use it for accessibility and best practices only.
- **Wasm can run as debug code while MCP is attached.** The server keeps the debugger on, and V8 then runs wasm as unoptimized debug code (found by reading the source; the size of the effect is not measured). Label absolute timings of wasm-heavy work "debug tier", and compare only runs made under the same conditions. For production numbers, measure in a Chrome window with no MCP or other debugger client attached: in-page marks sent to a log, or a DevTools Performance recording by the user. The Performance panel lifts the debug tier only when it is the only debugger client, and the first seconds of a recording can still run debug code.
- **Debugger rows.** The attached debugger adds `v8::Debugger::AsyncTask…` and `AsyncStackTrace::capture` events (2.2 ms in 6.7 s in the kit check). They wrap callbacks: do not add them to totals.
- **Noise.** Other open pages, background apps and heat add noise: close pages, interleave runs, and repeat. The first interaction after load can include a long frame.
- **Console errors.** A run with errors can look fast because work was skipped. Call `list_console_messages {pageId, types: ["error", "warn", "issue"]}` after each run; a run with new errors is not valid.
- **Insight sets.** An interaction that starts a soft navigation creates a `NAVIGATION_<n>` set: read the id from the summary.
- **Selector costs.** `SlowCSSSelector` never appears in MCP traces. Ask the user to record once in the Performance panel with "Enable CSS selector stats".
- **Human-only panels.** Paint flashing, Layout Shift Regions, the Layers panel and the Animations track need a person: ask the user, and name what to look for.
- **Software rendering.** A software renderer (SwiftShader) gives functional results only. In headless or CI browsers, check `glRenderer` before every run.

## §11 Tool cheat sheet

Required parameters are in bold. `pageId` is required on every tool that acts on a page.

| Group | Tool | Key parameters | Use |
|---|---|---|---|
| Pages | `list_pages` | none | page ids |
| | `new_page` | **url**, `background`, `isolatedContext`, `timeout` | a clean context; cold loads |
| | `navigate_page` | **pageId**, `type` (`url`, `back`, `forward`, `reload`), `url`, `ignoreCache`, `initScript`, `timeout` | loads; `initScript` for one navigation |
| | `select_page`, `close_page` | **pageId**, `bringToFront` | close other pages before runs |
| | `wait_for` | **pageId**, **text** (array; any match), `timeout` | the ready text |
| Emulation | `emulate` | **pageId**, `cpuThrottlingRate` (1–20), `networkConditions` (`Offline`, `Slow 3G`, `Fast 3G`, `Slow 4G`, `Fast 4G`), `viewport` (`WxHxDPR[,mobile][,touch][,landscape]`), `colorScheme`, `userAgent` | the profile, in one call |
| | `resize_page` | **pageId**, **width**, **height** | window size only, no DPR |
| Performance | `performance_start_trace` | **pageId**, `reload` (default true), `autoStop` (default true), `filePath` | load: both true; interaction: both false |
| | `performance_stop_trace` | **pageId**, `filePath` | end a manual trace |
| | `performance_analyze_insight` | **pageId**, **insightSetId**, **insightName** | one insight of the last trace; names in `pipeline.md` §I |
| Network | `list_network_requests` | **pageId**, `resourceTypes` (lower case: `script`, `image`, `font`, `fetch`, `websocket`, …), `pageSize`, `pageIdx`, `includePreservedRequests` | the request list, no sizes or times |
| | `get_network_request` | **pageId**, `reqid`, `requestFilePath`, `responseFilePath` | headers and bodies |
| Script | `evaluate_script` | **pageId**, **function**, `args` (uids), `filePath`, `waitForStableDom` (default true; false for reads) | probes, hooks, marks, waits |
| Console | `list_console_messages` | **pageId**, `types`, `includeStackTraces`, `includePreservedMessages`, `pageSize` | errors after each run |
| | `get_console_message` | **pageId**, **msgid** | one message with its stack |
| State | `take_snapshot` | **pageId**, `filePath`, `verbose` | uids and text state |
| | `take_screenshot` | **pageId**, `format`, `quality`, `fullPage`, `uid`, `filePath` | visual proof |
| | `get_css_styles` | **pageId**, **uid**, `pageSize`, `pageIdx` | the cascade of one element |
| Input | `click`, `hover` | **pageId**, **uid**, `dblClick` (`click`) | trusted input |
| | `fill`, `type_text`, `press_key` | **pageId**; `fill` **uid**, **value**; `type_text` **text**, `submitKey`; `press_key` **key** | trusted typing |
| | `drag` | **pageId**, **from_uid**, **to_uid** | element to element only |
| | `click_at` | **pageId**, **x**, **y** (server option) | a point on a canvas |
| Memory | `take_heapsnapshot` | **pageId**, **filePath** (`.heapsnapshot`) | forces a GC; never inside a trace |
| | `compare_heapsnapshots` | **baseFilePath**, **currentFilePath**, `classIndex` | growth by class (server option) |
| | `get_heapsnapshot_summary`, `get_heapsnapshot_class_nodes`, `get_heapsnapshot_retaining_paths`, `close_heapsnapshot` | **filePath**; `class_nodes` **id**, `filterName`; `retaining_paths` **nodeId** | find the retainer (server option) |
| WebMCP | `list_webmcp_tools` | **pageId** | the page's hooks (server option) |
| | `execute_webmcp_tool` | **pageId**, **toolName**, `input` (a JSON string) | run a hook; check `status` and `output.error` |
| Quality | `lighthouse_audit` | **pageId**, `device`, `mode`, `outputDirPath` | accessibility and best practices, not speed |
