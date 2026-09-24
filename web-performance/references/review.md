# Performance review (mode 2)

Open this when the user asks to review, audit or check code for performance, or when the arguments start with `review`.
The output is one report, grouped by pipeline stage. A review is read-only: do not edit code unless the user asks. When the user accepts a fix, apply it in write mode.

Contents: §A Procedure · §B Evidence levels and severity · §C Report template · §D One worked finding

## §A Procedure

1. **Scope.** List the files, or the diff (`git diff --stat <base>...HEAD`, plus `git diff --stat` for uncommitted work). Read them in full.
   - In a diff, also read the unchanged code that the change puts on a hot path, for example an old helper that a new loop now calls for each row.
   - Read the installed versions of the main libraries (framework, chart or grid library, bundler) in `package.json` and the lockfile.
   - Record the runtime context: the app type, how long a view stays open, the data scale (the feed or chart contract, or the largest fixture), and the target browsers (browserslist or AGENTS.md; the skill's default is Chromium, see `references/support.md`).
   - Why: the same line is fine at 20 rows and a bug at 20,000. Severity needs the scale and the call rate.
2. **Route.** For each region of code, find its row in the SKILL.md router. Read the checklists of those files, not the whole files. Name the stages in play. `references/pipeline.md` §H has one card for each stage.
3. **Detection sweep.** Print each routed rule with its Detect line:
   `grep -E '^### [A-Z0-9]+-[0-9]{2} |^- Detect:' <skill>/references/<file>.md` (`<skill>` is the folder that holds SKILL.md).
   Run each backticked pattern with ripgrep over the files in scope only: replace the rule's globs with the scope's file list. Keep a candidate list: `path:line`, rule ID, pattern.
4. **Confirm.** Read each candidate in context. A match is a candidate, not a finding. Answer these questions, then keep the candidate or drop it:
   - How often does it run: once, per interaction, per input event, per frame, per message, per item in a loop?
   - At what scale: rows, points, messages per second? If the code and the contracts do not say, the finding is at most H (§B).
   - Is it already handled: inside a rAF flush, cached, behind a size check, in a worker?
   - Does the rule's Avoid field say that this case is fine?

   Quote the exact line (1–3 lines) in the finding.
5. **Missing contracts.** Check what is absent, not only what is present. For each long-lived view or live feed, ask:
   - Teardown: who removes each listener, timer, observer, subscription, socket, worker and chart when the view goes away?
   - Error path: what happens when the socket drops, a fetch fails or a payload is malformed?
   - Test scale: was the code tried at the scale of the contract, or with 10 rows?
   - Hidden tab and off-screen: do rendering and polling stop, and does the view resync from the latest state on return?
   - Degradation policy: what drops first at peak load, and does the user see it?
   - Chart contract (views with charts): the 8 values in SKILL.md "Budgets and the chart contract".

   Report only what is missing. Agents write happy-path-only code by default, so these gaps are common.
6. **Rank and cap.** Sort by severity, then by evidence (M, S, H), then by effort. Keep at most 10 findings, strongest first. For a small scope (one component or a short diff), keep the 1–3 strongest. Prefer silence to nitpicks:
   - One finding per root cause. List the other locations of the same cause inside that finding.
   - No micro-optimization (V8 level) without a profile, or without a per-frame, per-tick or per-point path.
   - No finding whose estimated saving is 0 ms, for example an insight with no estimated savings. Put it in "Checked, no findings".
   - Be specific. Name the file, the value and the change ("`reports.js` is 900 KB and loads on every route; import it on the reports route"), not "reduce the bundle".
   - Before you recommend a removal (a preconnect, a cache, retained DOM nodes), confirm that nothing uses it. Retained DOM can be an intentional cache: ask the user.
7. **Report** with the template in §C.
   - Give each fix as a small diff inside the existing stack. Add no dependency and migrate no library unless the user asks.
   - Read the rule's Avoid field before you write the fix. It lists advice that looks right and is wrong.
   - Offer to measure the H findings and the high S findings (`references/measure.md`).
   - If nothing material was found, say that the code is already fast.

**Review or diagnose.** A review starts with no reported symptom. When the user reports one ("the table stutters while it streams"), run steps 1–4 on the related files first. If a static finding explains the symptom, report it and offer the recipe that confirms it. If not, measure. Go at most two layers deep (for example a static sweep, then one trace), then report what you found and what is still unknown.

## §B Evidence levels and severity

| Evidence | Meaning | How to write it |
|---|---|---|
| M, measured | A trace, probe output or run file from the reviewed code exists | The numbers, with device, profile, build and run count |
| S, static, mechanism certain | The code does it on every event, frame or message, for example a layout read after a style write inside `pointermove` | "Not measured", and the recipe that would measure it |
| H, hypothesis | The cost depends on data size, hardware or timing that the code does not show | "Hypothesis, not measured", and the recipe that decides it |

- A static finding is a hypothesis about cost, never a measured regression. Put no timing numbers on S or H findings. Numbers from the code or the contracts (rows, message rate) are allowed.
- A trace or an insight counts as M only when it was recorded on the reviewed code, with its conditions stated.
- After a measurement, update the letter. A confirmed S or H finding becomes M. Remove a finding that the measurement does not confirm, and put its numbers in "Checked, no findings".

| Severity | Meaning |
|---|---|
| high | On a hot path (per frame, per tick or message, per input event), on the LCP critical path, or a leak that grows with each repeated action |
| medium | Once per discrete interaction, or on a secondary view |
| low | A one-time cost under 50 ms, or a rare path. Report it only when the user asks for a full audit |

- Start from the rule's `impact:` tag, then adjust it to the call rate in this code. A high-impact rule on a path that runs once at startup is medium or low here.
- Effort: `small` (one place, a few lines), `medium` (several files or a new helper), `large` (a structural change: a worker, virtualization, a new renderer).

## §C Report template

Keep the headings and their order. Omit empty stages. Under any other section with nothing to report, write "None." The attempts ledger appears only when measurement ran. Reply in the chat; write the report to a file only when the user asks.

````markdown
# Performance review: <scope> (<YYYY-MM-DD>)
Commit <sha> · Mode: static | measured · Build: dev | prod preview · Profile: desktop 1440x900, DPR 2, CPU 4x (measured only)
Context: <libraries and installed versions; app type; target browsers; data scale assumed, for example 20k rows and 200 updates/s at peak>
Evidence: M = measured · S = static, mechanism certain · H = hypothesis, needs measurement

## Verdict
<1–3 sentences: the biggest risk, and whether the change is safe to ship as is. If nothing material was found, say that the code is already fast.>

## Summary
| # | Stage | Finding (file:line) | Rule | Severity · metric | Ev. | Effort |
|---|---|---|---|---|---|---|
| F1 | <stage> | <short finding> (<file>:<line>) | <ID> | <severity> · <metrics> | <M, S or H> | <effort> |

## Findings by pipeline stage
<!-- Pipeline order, tag → heading: network Network · parse Parse and discovery · cssom Render-blocking CSS and fonts ·
     script-load Script load · tasks Tasks and scheduling · js JS execution · style Style · layout Layout ·
     paint Paint and raster · composite Composite · gpu-upload GPU upload · gpu-draw GPU draw · memory Memory and lifecycle.
     A finding goes under the first stage in its rule's tag line; library-specific rules too.
     Number findings F1, F2… in the Summary order (strongest first), so numbers can skip inside a stage. -->

### <Stage>
#### F1 [<severity>] <one-line title> — `<path>:<line>`
- Rule: <ID> · Metric: <metric> (also <metric>) · Evidence: <M, S or H>
- Code:
  > `<the exact line>`
- Why it costs: <the mechanism in 1–2 sentences, in pipeline words>
- Fix:
  ```diff
  - <old line>
  + <new line>
  ```
- Trade-off: <what the fix costs or changes in behavior; "none" is a valid answer>
- Verify: measure.md#<recipe>, <scenario>. Pass: <the condition from the rule>

## Missing contracts
<teardown, error path, test scale, hidden-tab behavior, degradation policy, chart contract: only what is missing, one line each, with file:line or the view name>

## Checked, no findings
<the stages and patterns that you checked and found fine, so that the report claims no coverage that it did not have>

## Not checked
<what static review cannot decide, and why: GPU cost, the real data scale, third-party scripts, server timing, files out of scope>

## Measurement plan
1. <recipe · scenario · pass condition>, in severity order

## Attempts ledger (only when measurement ran)
| Change | Metric | Before median (MAD) | After median (MAD) | Verdict | Kept |
|---|---|---|---|---|---|
````

Rules for the report:
- Every finding has `path:line`, a quoted line, a Rule line with its evidence letter, a fix, and a Verify line with a Pass condition.
- If no rule covers a real problem, write `Rule: none` and explain the mechanism. Do not force a near-miss rule ID.
- For S and H findings, do not write "faster", "smooth" or "fixes the jank". Write what the fix removes ("one render per frame instead of one per message"), and "not measured".
- The ledger comes from measure mode: one row per change, with the verdict of `scripts/compare-runs.mjs` (win, neutral, regression, insufficient runs).

## §D One worked finding

Scope: a diff that adds `src/status/status-table.ts`, a dashboard table fed by a WebSocket. The feed contract in the file header says: full snapshots of 300 rows, 200 messages/s at peak.

How the reviewer got to the finding:
- Sweep: a Detect pattern for UI updates in a message handler matched line 31.
- Confirm: the handler runs once per message. Each `rows.set()` notifies the table, and the table re-renders all rows. Nothing batches the updates. The call rate is in the contract, so the mechanism is certain: evidence S. It runs per message on a live view: severity high.
- Checked and kept out of the findings: the `Intl.NumberFormat` in the same file is created once, at module scope; the row keys are stable ids.

The finding in the report:

````markdown
### Tasks and scheduling
#### F1 [high] The table re-renders on every socket message — `src/status/status-table.ts:31`
- Rule: DATA-06 · Metric: frame (also INP) · Evidence: S
- Code:
  > `socket.onmessage = (m) => rows.set(JSON.parse(m.data));`
- Why it costs: each message parses a snapshot and re-renders 300 rows (script, then style and layout). At 200 messages/s that is about 3 renders per 60 Hz frame, but only the last one reaches the screen; the others delay input handlers and the next frame.
- Fix:
  ```diff
  - socket.onmessage = (m) => rows.set(JSON.parse(m.data));
  + let pending: string | null = null;              // the newest raw snapshot
  + socket.addEventListener('message', (m) => {
  +   if (pending === null) requestAnimationFrame(flush);
  +   pending = m.data;                               // parse only what gets drawn
  + }, { signal });                                   // the view's teardown signal
  + function flush() {
  +   const raw = pending!; pending = null;
  +   if (!signal.aborted) rows.set(JSON.parse(raw));   // no render after teardown
  + }
  ```
- Trade-off: intermediate snapshots are never drawn. This is correct only for full snapshots; for deltas, merge them into one pending map per frame. In a hidden tab rAF pauses, and only the newest snapshot waits, so memory stays bounded.
- Verify: measure.md#fps, `run_scenario` "stream" at 200 updates/s for 10 s, 5 runs per side. Pass: the compare-runs verdict is "win" on frame-interval p95 and on long frames per 10 s, and LoAF script time in the message handler goes down.
````

Its Summary row:

| # | Stage | Finding (file:line) | Rule | Severity · metric | Ev. | Effort |
|---|---|---|---|---|---|---|
| F1 | Tasks and scheduling | The table re-renders per message (status-table.ts:31) | DATA-06 | high · frame, INP | S | small |
