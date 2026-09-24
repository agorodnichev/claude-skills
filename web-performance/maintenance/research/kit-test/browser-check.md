# Browser check of the web-performance measurement kit (2026-09-23)

This was the first run of the kit in a real browser. Before this, the kit was tested only in Node with fake APIs.

**Result:** the kit works end to end in Chrome 153 through DevTools MCP, and WebMCP was available. I found 8 bugs and fixed them (see "Changes"). After the fixes, the problem page and the fixed page give a clear win in `compare-runs.mjs`: 6 wins and 3 neutral metrics.

## Setup

| Item | Value |
|---|---|
| Browser | Google Chrome 153.0.8010.53, headed, started by chrome-devtools-mcp with `--enable-features=WebMCP` (the flag is in the trace metadata `command_line`) |
| Machine | Mac16,5, Apple M4 Max, 16 cores, macOS 27.0.0, 120 Hz display |
| GPU | `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)`. WebGPU is `apple/metal-3` (not the fallback adapter). |
| Profile | One `emulate` call: `{cpuThrottlingRate: 4, viewport: "1440x900x2"}`, network off. Each tool reply echoes "Emulating CPU throttling: 4x slowdown". |
| Page | `page/index.html` (the problem page) has a WebGL2 rAF loop with a 60 ms frame every 30 frames, a 150 ms click handler, a banner inserted 1 s after load and a result row inserted 800 ms after each click. `page/fixed.html` reserves space for the banner and the row and uses a 5 ms handler. There is no busy frame. |
| Hooks | `page/perf-hooks.dev.js` is made by `page/build.mjs` (`stripTypeScriptTypes`, `import.meta.env.DEV` → `true`). The same script copies `probes.js` to `page/kit/`. |
| Server | `python3 -m http.server 63125 --bind 127.0.0.1`. It was stopped at the end, and all pages that I opened are closed. |

## What ran and the real numbers

**Probes around a trusted `click` (problem page).**

- Interaction: `pointerdown+pointerup+click` on `button#heavy`. Latency was 168–176 ms: input delay 0.4–1.2 ms, processing 150.6–151.4 ms, presentation 16–24 ms. The first click after load was 264 ms, because a long rAF frame came at the same time.
- LoAF: the worst frame was 155 ms, `ui: true`. The top scripts were `onHeavyClick` (event-listener, `BUTTON#heavy.onclick`, 150.2 ms) and `draw` (FrameRequestCallback).
- Shift: 0.0103 from the late row. `hadRecentInput` was false, and the sources were `canvas#gl` and `p#ready`.
- The load CLS was 0.0344 when read without `shift.start()`.

**Cross-check against the trace (`traces/problem-inp.json.gz`).**

| Metric | Trace | Probe |
|---|---|---|
| INP | 168 ms (MCP summary) | 168 ms |
| INP subparts: input delay / processing / presentation | 1 / 151 / 16 ms (`INPBreakdown`) | 1.2 / 151 / 15.9 ms |
| CLS | 0.01 | 0.0103 |
| Load CLS | `LayoutShift` 0.0344 in `problem-load.json.gz` | 0.0344 |

**`trace-summary.mjs` on the real files.**

| File | Main findings |
|---|---|
| `problem-load.json.gz` (reload, autoStop, 1.0 MB) | 5073 ms. 16 tasks over 50 ms (max 61.1 ms), 169.6 ms blocking. BeginFrame 604, DrawFrame 487, DroppedFrame 111. The forced layout is at `draw (app.js:61:31)`. |
| `fixed-load.json` (plain JSON, 19.3 MB) | 0 tasks over 50 ms, 0 blocking. DroppedFrame 0. Layout shifts 0. |
| `problem-stream.json.gz`, `--between wp:start wp:end` | 1 window of 3001.7 ms. The main thread was chosen by the start mark. 10 tasks over 50 ms, 102.8 ms blocking. BeginFrame 360, DrawFrame 300, DroppedFrame 60. The marks are `wp:start` 1x and `wp:end` 1x. |
| `problem-inp.json.gz` | 1 interaction, worst 167.9 ms (`pointerdown`). |

**Runs.** I made 3 problem runs and 3 fixed runs, interleaved P1 F1 P2 F2 P3 F3 in one tab, with a new navigation for each run. The raw data is in `runs/raw-*.json`, and `runs/make-run-files.mjs` writes `runs/problem.json` and `runs/fixed.json`. The output of `compare-runs.mjs problem.json fixed.json` (also in `runs/compare-output.txt`) is:

| Metric | Before median (MAD) | After median (MAD) | Δ% | Verdict |
|---|---|---|---|---|
| frameP95Ms | 10.3 (0) | 10 (0) | −2.9% | neutral (low N) |
| frameP99Ms | 58.9 (0.5) | 10.3 (0) | −82.5% | win (low N) |
| longFramesPer10s | 33.3 (0.1) | 0 (0) | −100% | win (low N) |
| maxGapMs | 143 (0.5) | 10.4 (0) | −92.7% | win (low N) |
| loafCount | 35 (3) | 0 (0) | −100% | win (low N) |
| inpMs | 168 (0) | 32 (0) | −81% | win (low N) |
| inputDelayMs | 0.9 (0) | 1.1 (0) | +22% | neutral (low N) |
| processingMs | 151 (0.2) | 5.8 (0.2) | −96% | win (low N) |
| presentationMs | 17 (0.6) | 25.2 (0.1) | +48% | neutral (low N) |

**WebMCP.** `document.modelContext` exists. `registerPerfHooks` registered all 5 tools. `list_webmcp_tools` listed them, with `readOnly: true` on `get_frame_stats` and `get_perf_summary`. `execute_webmcp_tool` ran these tools:

- `load_fixture_data`: 50,000 points in 69.7 ms.
- `run_scenario` stream 5 s: 5001.2 ms. I also ran it inside a trace (the marks window above).
- `get_perf_summary`: 26 LoAFs, 265.1 ms blocking.
- `get_frame_stats`: 120 Hz after the fix.
- `reset_state`.

I also tested the `window.__perf` fallback through `evaluate_script`. `repeat` 999 was clamped to 50, and the busy and unknown-name errors worked. The mark detail was `"stream"`, and `reset()` cleared the marks.

## What failed, and the changes (kit files)

| # | File | Bug seen in the browser | Change |
|---|---|---|---|
| 1 | `probes.js` `frame.stop()`, `perf-hooks.dev.ts` `sampleFrames` | `hz: 149` on a 120 Hz display. `longFrames` 75 compared to 24 real long frames, because rAF intervals jitter from 6.3 to 10.5 ms even without throttling and the 5th percentile was taken as vsync. | Vsync is now the median of the fast cluster (intervals < 1.75 × the 10th percentile). The browser now gives `hz: 120` and `longFrames` = `over16_7` = the LoAF count. |
| 2 | `probes.js` `env()` | After `emulate`, `navigator.userAgentData` is empty. `browser` was `"Chrome/153.0.0.0"` and `platform` was `" "`. | Empty hints now count as missing: `platform` falls back to `navigator.platform`, and a warning says to run `env()` before `emulate`. Before `emulate`, `env()` gives `Google Chrome 153.0.8010.53`, `macOS 27.0.0`. |
| 3 | `trace-summary.mjs` forced layout | `lineNumber + 1` showed `app.js:62` (the `clientHeight` line), but trace stack frames are 1-based: `61:31` is the start of `clientWidth`. | The line and column are now printed as they are in the trace: `draw (app.js:61:31)`. |
| 4 | `trace-summary.mjs` marks | Navigation-timing events (`navigationStart`, `domComplete`, …) use `blink.user_timing` too. They showed as "User timing marks" and in the `--between` error text. | These names are now excluded, as DevTools does. |
| 5 | `trace-summary.mjs` table | The names were cut at 23 characters, so 3 different `v8::Debugger::AsyncTask*` rows looked the same. | The name column now grows to fit the longest name, up to 40 characters, with "…" when a name is longer. |
| 6 | `trace-summary.mjs` | `worstMs` was printed without rounding (`167.869`). | `worstMs` is now rounded to 0.1 ms. |
| 7 | `perf-hooks.dev.ts` | An error that `execute` throws reached the agent as `{"status":"Error","errorText":""}`, so the message was lost. This happened for an unknown scenario and for a busy scenario. | The registered `execute` now returns `{ error: <message> }` (status "Completed"). `window.__perf` still throws. The header comment says this. |
| 8 | `probes.js` `interaction.read()` | An interaction under 16 ms has no Event Timing entry, so `count: 0` looked like "no click". | The new field `under16Ms` comes from `performance.interactionCount`. It is present only when some interactions have no entry. |
| — | `probes.js` | The probe changed, but `VERSION` did not. A reinstall in an open page kept the old code. | `VERSION` is now 2. The comment says to bump it on every change. |

The public names did not change. `compare-runs.mjs` did not change: it worked on the real run files and on the author's 5 synthetic cases (win, neutral, regression, low N with a warning, insufficient).

**Harness updates and reruns.**

- `probes-harness.mjs`: it now expects version 2. I added two tests: jittered 120 Hz intervals, and `under16Ms`.
- `hooks-harness.mjs`: the WebMCP error cases now expect `{ error }`. I added two tests: a busy call through WebMCP, and jittered 120 Hz intervals for `get_frame_stats`.
- Results: probes 14/14 PASS, hooks 11/11 PASS, `typecheck-hooks.cjs` 0 diagnostics (TypeScript 6.0.3).
- The new frame test fails on the old estimator (157 Hz, 120 expected).
- After the fixes, I ran steps 3–6 again: probes around a click, `trace-summary.mjs` on all 4 traces, the 6 runs, and WebMCP.

**Not verified:** network throttling profiles, `#mem` with snapshots, `uaMemory` with `crossOriginIsolated`, and the mobile profile.

I did not pass the literal `(<file>)()` as `initScript`. I passed a synchronous XHR read of the same bytes, which installed the probe at 21 ms.

After the first two exact-text installs (the v1 file on the problem page, and the final v2 file on fixed run 3), the other installs used `(0, eval)('(' + text + ')')()` on the same served bytes. This works on the test page only.

## What measure.md must say

1. **Install.** Pass the whole `probes.js` text as `function` with `waitForStableDom: false`. The expected reply is `{"installed":true,"version":2}`. The tool evaluates `(<text>)`, so the file must start with the function and must not end in a line comment. Then call small functions, for example `() => window.__wpProbe.frame.start()` or `async () => window.__wpProbe.interaction.read()`. One install costs about 14.8 K characters, so do several probe windows per page load when that is valid.
2. **pageId.** `pageId` is required on page tools. Get it from the `new_page` or `list_pages` output.
3. **Order.** Call `env()` before `emulate`, because `emulate` empties `navigator.userAgentData`. Call `emulate` before the load that you measure: the same banner shift was 0.0494 before `emulate` and 0.0344 after. Emulation stays set across `navigate_page` and reloads in the same page.
4. **filePath.** The session scratchpad is refused ("not within any of the configured workspace roots"). The OS temp directory (`$TMPDIR`, `/var/folders/…/T/`) works, so save there and copy the file. Use `.json.gz`: 1.0–2.6 MB for 5–7 s, compared to 19.3 MB of plain `.json` for 5 s.
5. **Trace metadata.** An MCP-saved trace has no `cpuThrottling` or `networkThrottling` keys. It has only Chrome tracing metadata: `command_line`, `gpu-gl-renderer`, `hardware-class`, `revision` (`…branch-heads/8010…`), `trace-capture-datetime`, the reduced `user-agent`, `cpu-num-cores` and `physical-memory`. Copy the MCP header lines "CPU throttling: 4x" and "Network throttling: none" into the run file `profile`.
6. **Marks in a trace.** `performance.mark` becomes `ph: "I"`, `cat: "blink.user_timing"`, with `args.data.detail` as a JSON string. Measures are `b`/`e` pairs. Stack frames on `Layout` and `UpdateLayoutTree` are 1-based.
7. **Other pages.** Pages that are open but not selected still report `visible` and still run rAF. Close them, and interleave A and B by navigating one page.
8. **Window length.** Agent time between tool calls goes into a probe window: a scripted wait of 1.5 s + 4 s gave `spanMs` of 9.4–11.3 s. Compare rates (per 10 s), not counts. For frame-only runs, call `start`, wait and `stop` in one `evaluate_script`.
9. **Which frame metrics show jank.** rAF intervals jitter by about ±25% in this Chrome, so `frameP95Ms` stays near 10.3 ms on a smooth 120 Hz page. Rare long frames (3% here) do not move p95. For jank, use `longFramesPer10s`, `frameP99Ms`, `maxGapMs` and the LoAF count.
10. **Waits.** There is no sleep tool. Use `evaluate_script` with `() => new Promise((r) => setTimeout(() => r({ waitedMs: N }), N))`. `interaction.read()` right after the `click` tool was correct. Delayed app work (here, the row 800 ms after the click) needs an explicit wait before `shift.read()`.
11. **Load CLS.** Call `shift.read()` without `shift.start()`. The buffered entries go back to the navigation, and `start()` drops earlier shifts.
12. **initScript.** `initScript` applies to that one navigation only. It does not apply to later navigations or to the trace's own reload.
13. **WebMCP tool list.** The `new_page` output did not list the WebMCP tools, but the `navigate_page` output did. Call `list_webmcp_tools` after the page shows its ready text.
14. **WebMCP behavior in Chrome 153.** `execute` receives `(input, { signal })`. Chrome does not check the input against the `inputSchema` enums (`"zoom"` reached `execute`). A thrown error shows as an empty `errorText`, so check `output.error`. A page-side `executeTool` needs a JSON string: an object gives "Failed to parse input arguments".
15. **Event Timing.** Durations are rounded to 8 ms (168, 176, 32). The first interaction after load can include a long rAF frame (264 ms compared to 168 ms), so repeat the runs.
16. **Debugger events.** The debugger that the MCP attaches adds `v8::Debugger::AsyncTask*` and `AsyncStackTrace::capture` events (2.2 ms in 6.7 s here). These rows wrap callbacks, so do not add them to the totals.
