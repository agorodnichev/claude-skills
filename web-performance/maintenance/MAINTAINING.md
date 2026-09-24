# Maintaining the web-performance skill

Claude never loads this folder at run time. It holds:

- `MAINTAINING.md`: this guide. The table of retired rule IDs is at the end.
- `lint-skill.mjs`: the lint. Run it after every change.
- `crosswalk.tsv`: one row per research-note item. Columns, tab-separated: source note file, item heading, rule ID(s) or `dropped: <reason>`. The first row can be a header.

## Run the lint

```sh
node ~/.claude/skills/web-performance/maintenance/lint-skill.mjs            # after each change
node ~/.claude/skills/web-performance/maintenance/lint-skill.mjs --release  # before a release
```

| Option | Effect |
|---|---|
| `--root <folder>` | Lint another copy, for example a staging folder. The default is the folder above `maintenance/`. |
| `--today YYYY-MM-DD` | Set the date for the staleness checks. |
| `--release` | Also fail on warnings and on missing files. |

Exit code 0 is a pass, 1 is a fail, 2 is a bad argument. The report lists each file with its size and limit. It also lists the facts that the lint read (rule counts, next free IDs, frontmatter length, support.md dates), the checks it skipped because a file is missing, and the errors and warnings with `file:line`. The numeric limits are in `LIMITS` and `FILES` at the top of the lint. Change them there.

| Area | The lint checks (error unless marked) |
|---|---|
| IDs | Format `<PREFIX>-<nn>`. The prefix matches line 1 of its file. Each ID is defined once. Every ID in SKILL.md, a reference file or the crosswalk resolves, also after `→`, `->` and `also:`. No retired ID is defined or named. Every gap in the numbers is in the retired table. |
| Full rules | The tag line is the line directly under the title. Tags and values are allowed. Do, Why, Detect, Verify, Avoid and Source are each present once. Detect has a pattern in backticks. Verify has `measure.md#<recipe>` and `Pass:`. Source has a URL. A rule has at most 18 lines, not counting example code, and at most 14 lines of example code. A title over 90 characters is a warning. |
| One-line rules | `[<stage> · <metric> · <impact>]` with allowed values, and a URL. |
| Checklist | `## Checklist` is the first `## ` heading, with "Open this when …" above it. Every rule of the file has a row. A row's impact and first stage match the rule. A rule from another file appears only as `→ ID`. More than 6 `→ ID` lines is a warning. |
| Pointers | `references/…`, `scripts/…`, `x.md` names and `measure.md#<recipe>` point to things that exist. |
| support.md | Each `support:` key is a row in §A. The header has "Checked:" and "Stale after:". Older than 90 days is a warning. |
| Versions and dates | No browser or OS version, `x.y.z` version, date or "Baseline <year>" outside support.md, in SKILL.md, `references/`, `scripts/` or `assets/`. In code files, only browser versions and dates are checked. Inside a URL it is a warning. |
| SKILL.md | At most 270 lines and 18,000 characters (no 15% allowance). Frontmatter on line 1. `description` + `when_to_use` at most 1,536 characters. No `paths`, `allowed-tools`, `context` or `arguments`, no `disable-model-invocation: true`, no `user-invocable: false`. No unescaped `$ARGUMENTS` or `$<digit>` (write `\$1`). The stages in "The pipeline on one screen" match pipeline.md §J. |
| Sizes | Each reference file stays within its line budget + 15%. `gpu-webgl-webgpu.md` must split past 500 lines. `scripts/probes.js` and `assets/perf-hooks.dev.ts` have budgets too, because Claude reads them into its context. |
| Crosswalk | Each row has 3 tab-separated columns, and the third holds rule IDs or `dropped: <reason>`. |
| Other | Code fences close. The JSON files in `evals/` parse. |

The lint does not check section pointers such as "`html-loading` §D", MCP flags or API shapes outside support.md, the tables of contents of the files that hold no rules, or whether a rule is true. Check these by hand.

## Rule format

```markdown
### <PREFIX>-<nn> <Imperative title, at most 90 characters>
stage: <stages> · metric: <metrics> · when: <when> · impact: <high|medium|low> — <one-clause reason> · support: <key|baseline|n/a> · also: <IDs>
- Do: 1–3 sentences: the action and its scope. When WebGL and WebGPU differ, add "WebGL:" and "WebGPU:" lines.
- Why: 1–3 sentences: the mechanism in pipeline words, and at most one number with its source.
- Detect: `<ripgrep pattern>` in <globs>, and the context where a match is bad.
- Verify: measure.md#<recipe>. Pass: <condition>.
- Example: optional. Before and After, at most 14 lines of original code.
- Avoid: when the rule is wrong, what it costs, and the wrong advice it replaces.
- Source: 1–2 URLs, primary first.
```

- One-line rule: `- **<PREFIX>-<nn>** <imperative>. [<stage> · <metric> · <impact>] <one URL>`
- `stage`: the words in pipeline.md §J. The first stage is where the saving shows in a trace. `metric`: LCP, INP, CLS, FCP, TTFB, frame, memory, bytes, startup. `when`: load, interaction, render-loop, session, build. `support`: a key in support.md §A, `baseline` or `n/a`, with an optional note in parentheses. `also` is optional.
- A rule file: line 1 `# <Title> (<PREFIX>-)`, line 3 "Open this when you write …", line 4 the stage cards to read. Then `## Checklist`: one table row per rule (ID, imperative, impact, first stage), grouped by section letter. It is the table of contents. Then the sections with full rules, then `## One-line rules`.
- Style: ASD-STE100 Simplified Technical English, American spelling. No versions or dates: name the support key.

## Where a rule lives

1. The home is the file where the code that the rule changes gets typed. Use the SKILL.md router: an `<img>` attribute goes to `html-media-and-fonts.md`, a `pointermove` handler to `js-events-and-input.md`, a GPU buffer to `gpu-webgl-webgpu.md`.
2. If two files qualify, the home is the file that the router opens first for that code. The other file gets a `→ ID` line in its checklist, never a copy.
3. A SciChart-specific API always lives in `scichart.md`. The general mechanism stays in its layer file, and the SC rule links to it with `also:`.
4. The prefix is the file's category. A rule that moves to a file with another prefix gets a new ID.

## Add a rule

1. Search first: `grep -rn '<API name>' references/`. If a rule covers the mechanism, extend that rule.
2. Choose the home file. Take the next free ID for its prefix: the lint prints it under "Facts". Never fill a gap.
3. Write the rule and its checklist row. Add a `→ ID` line to other checklists only where the router sends the same code there.
4. If the feature is not Baseline Widely available, add or update its row in support.md §A, and name the key in `support:`.
5. Add crosswalk rows for the note items that the rule came from.
6. If the rule replaces a common agent habit, update "Default habits to replace" or "Always-on rules" in SKILL.md.
7. Run the lint. If the file goes over its budget, cut the rules with the lowest impact for a typical web app first.

## Merge, move or remove a rule

IDs are stable after the first release. Never renumber and never reuse an ID. Before the first release, you can renumber to close gaps.

1. Keep one ID. When you merge, keep the ID with more references. When you move a rule to another prefix, give it a new ID in the new file.
2. Add each ID that goes away to "Retired rule IDs" below, with the date, the replacement and the reason.
3. Replace each reference to the old ID: `grep -rn '<old ID>' SKILL.md references/ maintenance/crosswalk.tsv`. The lint lists the references that you miss.
4. In the crosswalk, point the rows to the kept ID, or write `dropped: <reason>`.

## Refresh support.md

support.md is the only file with browser versions, Baseline dates, DevTools MCP versions and flags, WebMCP status and library versions. Chrome ships a stable release every two weeks, so these facts go stale fast.

- When: after "Stale after" (the lint warns), before a release, when a rule starts to use a new feature, and when the installed SciChart.js or DevTools MCP version changes.
- Browsers: the target is Chromium only (Chrome and Edge). Rules have no fallback code for Firefox or Safari. A feature that is not Baseline still gets a row, so that its Chrome version is on record.

1. Ask the user before you browse. For each row, read `https://api.webstatus.dev/v1/features/<key>` (fields `baseline` and `browser_implementations`) or the MDN browser-compat-data JSON. Never run a retrieval CLI through npx.
2. Update the row and its checked date. If two sources disagree, keep both values and name each source.
3. Set "Checked:" to today and "Stale after:" to today + 90 days.
4. SciChart.js: read the installed version in `node_modules/scichart/package.json`. Check the docs-against-source conflicts in §D against the installed `.d.ts` typings.
5. DevTools MCP and WebMCP: check the tool names, flags and API shape against the installed server and the current spec. If they changed, update §C, the tool cheat sheet in measure.md, and `assets/perf-hooks.dev.ts`.
6. Run the lint, and tell the user which rows changed.

## Release checklist

1. `lint-skill.mjs --release` exits with 0.
2. If SKILL.md, its frontmatter, the router or a rule's Do line changed: run the skill-creator evals in `evals/` (`evals.json` and `trigger-queries.json`) with and without the skill. Do not ship a drop in the results.
3. Every new note item has a crosswalk row.
4. Tell the user what changed: added, merged and retired IDs, and changed support.md rows.

## Retired rule IDs

The lint reads this table. Add a row for each ID that goes away, and never delete a row. "Replaced by" holds rule IDs, or "—" when nothing replaces the rule. An ID that the build skipped (a gap that was never used) also needs a row, with the reason "never used"; before the first release, you can renumber instead.

| ID | Retired on | Replaced by | Reason |
|---|---|---|---|
