# Verify: 01-critical-rendering-path.run2-new.md

Checked on 2026-09-23. Data: BCD 8.1.2 (build 2026-09-17) and web-features, both from `raw/verify/02/` (current). Chromium source is from `chromium.googlesource.com` HEAD (chrome/VERSION 156.0.8072.0). Chromium milestones are from chromiumdash `fetch_commit`. Raw copies are in `raw/verify/01n/`.

Summary: 13 items checked. 4 verified, 9 corrected, 0 disputed, 0 unverified.

Main findings:
1. The Chromium pipeline facts are out of date in 3 places. Non-Blocking Commit is on by default since Chrome 122, so a commit usually does not block the main thread. Layerize runs on the main thread, not on the compositor thread. Since Chrome 145, each deferred or module script runs in its own task.
2. The "Why" line of the fetchpriority item is wrong. The cited web.dev table shows that `fetchpriority="high"` on an async script also gives High priority, which is the same result as a preload.
3. Status labels: responsive image preload became Baseline widely available on 2026-06-11. 2023-12 is the "newly available" date. IntersectionObserver became widely available on 2021-09-25, not in 2019.

---

### Threads and processes (Chromium RenderingNG; other engines differ in detail)
- Verdict: corrected
- Correction:
  - Compositor thread row: remove "decides layerization". In current Chromium (after Composite After Paint), Layerize runs on the **main thread**, in `PaintArtifactCompositor::Update()`. `LocalFrameView::PushPaintArtifactToCompositor()` calls it after paint and before commit. The BlinkNG article says that the RenderingNG diagram "shows layerization as being off the main thread, whereas currently it's still on the main thread". Moving layerization off the main thread is a future project. The main-thread row of the table is correct.
  - "Commit blocks the main thread while data is copied (How cc works)": this is out of date. Non-Blocking Commit was turned on by default in Chrome 122 (commit 093aa4c5, stable 122.0.6261.43), and the feature flag was removed in 2024-11. In current `cc/trees/proxy_main.cc`, the main thread waits for the commit to finish only when `block_on_next_commit_` is set. `ProxyMain::SetInputResponsePending()` sets it when the frame contains the visual response to an input event. The main thread also waits in `WaitForProtectedSequenceCompletion()` if it must change the committed state before the commit ends. `how_cc_works.md` was not updated for this change.
  - Compositor animations: "(transform, opacity, filter)" is too short a list. Chromium also composites `backdrop-filter` and the individual `translate`/`rotate`/`scale` properties. It composites `background-color` animations (stable from M142) and `clip-path` animations (stable from M152) through paint worklets that run on the compositor worker threads. See `verify/05-css-rendering.verify.md`.
  - Browser process row: "network requests" is not correct on most platforms. The network service runs in its own utility process by default. It runs inside the browser process only on Android (and in `--single-process`).
  - Web workers row: only **dedicated** workers have `requestAnimationFrame` (`DedicatedWorkerGlobalScope.requestAnimationFrame`: Chrome 69, Firefox 99, Safari 16.4; nested workers not supported in Chromium).
  - Verified as written: the stage list (Animate … Draw, with Commit listed before Layerize), one main thread and one compositor thread per render process, the main-thread helpers, the Viz GPU main thread and the display compositor thread. The sentence "gpu raster is limited to one worker thread at a time, although image decoding can proceed in parallel" is still in HEAD `how_cc_works.md`. The DevTools trace event names include both `Layerize` and `Commit` (DevTools `TraceEvents.ts` `Name` enum).
- Evidence:
  - https://developer.chrome.com/docs/chromium/blinkng ("currently it's still on the main thread"; Non-Blocking Commit and Off-main-thread Compositing are described as future work, March 2022)
  - https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/paint/README.md ("LocalFrameView::PushPaintArtifactToCompositor() / PaintArtifactCompositor::Update()")
  - https://chromiumdash.appspot.com/commit/093aa4c5069eaa9808ca78f1064dc534c3fc2f95 ("Enable NonBlockingCommit by default", stable 122.0.6261.43); saved as `raw/verify/01n/cd-nonblocking-commit.json`
  - https://chromium.googlesource.com/chromium/src/+/HEAD/cc/trees/proxy_main.cc (`bool blocking = block_on_next_commit_;` and `SetInputResponsePending()`)
  - https://chromium.googlesource.com/chromium/src/+/HEAD/services/network/README.md ("The in-process configuration is the default on Android")
  - https://chromium.googlesource.com/chromium/src/+/HEAD/docs/how_cc_works.md
  - https://developer.chrome.com/docs/chromium/renderingng-architecture
  - BCD `api.DedicatedWorkerGlobalScope.requestAnimationFrame`

### Put small inline head scripts above external stylesheets
- Verdict: corrected
- Correction:
  - Why line: the HTML spec does not limit this to stylesheets "in the head". An element "contributes a script-blocking style sheet" when all of these are true: the parser created it; it is a `<style>` element or a stylesheet `<link>`; its `media` matches; the sheet is enabled; and the UA has not given up on loading it. This applies to stylesheets in the `<body>` too. A stylesheet in the container (parent) document also blocks. A `<link rel=stylesheet media=print>` on screen does not block scripts. The rest of the Why is correct, and the rule applies to inline scripts too.
  - Caveat line: the Firefox claim has a primary source. MDN's "Speculative parsing" glossary page says that Firefox (since Firefox 4) "runs the HTML tree construction algorithm speculatively" while scripts download and run. Speculation fails when `document.write()` changes the tree-builder state. Replace "not confirmed in a primary source" with this MDN reference.
  - Extra support for the Do line: Harry Roberts's "Get Your Head Straight" head order puts synchronous JS before synchronous CSS.
- Evidence:
  - https://html.spec.whatwg.org/multipage/semantics.html#interactions-of-styling-and-scripting (definition of "contributes a script-blocking style sheet" and "has a style sheet that is blocking scripts")
  - https://web.dev/learn/performance/optimize-resource-loading ("A parser-blocking `<script>` must also wait for any in-flight render-blocking CSS")
  - https://developer.mozilla.org/en-US/docs/Glossary/Speculative_parsing (last modified 2025-07-11)
  - https://speakerdeck.com/csswizardry/get-your-head-straight

### Use an img element for the LCP image, not a CSS background or data-src
- Verdict: corrected
- Correction:
  - Status: use "Responsive image preload (`imagesrcset`/`imagesizes`) is Baseline widely available since 2026-06-11 (newly available 2023-12-11, Safari 17.2). Chrome 73, Firefox 78, Safari 17.2." The item gave the newly-available date (2023-12) with the widely-available label.
  - Caveat line: "Omit `href`" is correct (web.dev: "exclude the src attribute" so that browsers without responsive preload do not fetch the fallback). Now that the feature is widely available, this only matters for browsers older than Safari 17.2. "Place preloads after stylesheet links" is not in the cited sources. Add a source for it: the csswizardry head order puts preload after synchronous CSS.
  - Why line, small precision: the preload scanner does not read CSS files. A CSS background image is requested when style resolution finds an element that matches the rule, not when the CSSOM is built. The Impact line already says this correctly ("downloaded and matched").
- Evidence:
  - web-features `preloading-responsive-images`: baseline high, low 2023-12-11, high 2026-06-11 (`raw/verify/02/wf.json`); BCD `html.elements.link.imagesrcset` / `imagesizes`
  - https://webstatus.dev/features/preloading-responsive-images
  - https://web.dev/learn/performance/resource-hints ("You should also exclude the src attribute…")
  - https://web.dev/articles/preload-scanner ("The preload scanner only scans HTML")
  - https://speakerdeck.com/csswizardry/get-your-head-straight

### Do not inline large blobs into the HTML
- Verdict: verified
- Evidence: https://web.dev/articles/preload-scanner. It gives LCP "about 3.5 seconds" vs "just over 7 seconds", and FCP "roughly 2.7 seconds" vs "roughly 5.8 seconds". It also says "base64 is an inefficient format for binary resources" and that inlined fonts are "downloaded whether they're needed … or not". It adds that inlining is not recommended "except for very small resources". Extra support: V8, "if the script is over 1 kB, avoid inlining it", because the code cache is used only for external scripts (https://v8.dev/blog/cost-of-javascript-2019).

### Raise a critical async script with fetchpriority, not with preload
- Verdict: corrected
- Correction:
  - Why line is wrong. The cited web.dev Fetch Priority table shows "Script (async/defer)" with a default of Low (◉) and ⬆ = **High** for `fetchpriority="high"`. A preloaded async script is also "promoted to High" (preload-scanner article). So both methods give the same priority, and both can contend for bandwidth with the Highest-priority CSS. Replace the Why with: "`fetchpriority` raises the async script to High from the `<script>` element itself. You do not need a second `<link rel=preload>` that can go out of sync with the script (for example `crossorigin`/`integrity` mismatches that cause a double fetch). web.dev calls it 'better semantics than the current most common hack'. The preload scanner already finds a static `<script async src>`. A preload helps only for a script that is injected at run time."
  - Do line: `fetchpriority="low"` has an effect only on late parser-blocking scripts (Medium → Low). On `async`/`defer` scripts it does nothing in Chrome, because they are already Low (◉ and ⬇ are in the same Low column).
  - Impact line: the Low default for async/defer is Chrome's priority table. Firefox and Safari use different mappings.
  - Status is correct: Baseline newly available 2024-10-29 (Chrome 101/102, Firefox 132, Safari 17.2; `html.elements.script.fetchpriority`).
- Evidence:
  - https://web.dev/articles/fetch-priority (priority table, and the line "Increasing the priority of async scripts, using better semantics…")
  - https://web.dev/articles/preload-scanner ("the script's priority has been promoted to 'High'")
  - web-features `fetch-priority` (low 2024-10-29)

### Split script evaluation into smaller tasks and defer non-critical features
- Verdict: corrected
- Correction:
  - New engine fact: since **Chrome 145**, Chromium runs each deferred classic script and each module script in its own task. Before this change, all of them ran in the task of `DOMContentLoaded`. The runtime flag `SeparateDeferModuleScriptTasks` is "stable" (commit e7e02f3c, "Enable SeparateDeferModuleScriptTasks by default", 2026-01-09, stable 145.0.7632.26). `HTMLParserScriptRunner::ExecuteScriptsWaitingForParsing()` now posts a task between scripts. The cited web.dev article (last updated 2023-05-09) still says "Chromium-based browsers will execute all loaded scripts with the `defer` attribute in the same task". That statement is out of date. Add to Avoid/caveats: "Chrome ≤144 runs all `defer`/module scripts in one task with `DOMContentLoaded`. Chrome 145+ gives each one its own task."
  - Why line: "(parse, compile, run) happens on the main thread" is too general. V8 streams parse and compile of external scripts on a background thread while the bytes download. Top-level execution, lazy function compilation and some finalization stay on the main thread. Suggested text: "Execution, and the compile work that streaming cannot do, happens on the main thread, in one task per classic script."
  - Example: the `import()` inside a click handler adds network time and compile time to the first click. Prefetch or `modulepreload` the chunk on `pointerenter`/`focus`/idle (this matches `09-v8-consolidated.md:1107`).
  - Verified: "a limit of 100 kilobytes per individual script is a good target" (web.dev; it does not say if this is compressed or uncompressed). "Safari and Firefox … each of them is evaluated in a separate task" and "Compile module" per module in Chromium come from the 2023 article; I did not test them again on 2026 engines. Dynamic import is Baseline widely available (`javascript.operators.import`: low 2020-01-15, high 2022-07-15).
- Evidence:
  - https://chromiumdash.appspot.com/commit/e7e02f3ceba01c4519f58ab4b4c2445ba7566609 (saved as `raw/verify/01n/cd-separate-defer.json`)
  - https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/runtime_enabled_features.json5 (`name: "SeparateDeferModuleScriptTasks", status: "stable"`)
  - https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/script/html_parser_script_runner.cc ("execute scripts one at a time with event loop yields between them")
  - https://www.mail-archive.com/blink-dev@chromium.org/msg14673.html (blink-dev PSA, 2025-09-19, crbug 40894694)
  - https://web.dev/articles/script-evaluation-and-long-tasks
  - https://v8.dev/blog/cost-of-javascript-2019 ("some work still has to happen on the main thread")

### Keep inactive views with content-visibility:hidden instead of display:none
- Verdict: corrected
- Correction:
  - Status is correct for the `hidden` value. BCD `css.properties.content-visibility.hidden`: Chrome 85, Firefox 125, Safari 18. The web-features per-key status is newly available 2024-09-16. Add: webstatus.dev shows the whole `content-visibility` feature as newly available on **2025-09-15**, because `auto` was partial in Safari 18–26 (skipped content was not findable by find-in-page).
  - Add a caveat: the change from `display: none` is not a drop-in change. With `hidden`, the element itself still makes a box. It gets size containment and is sized as if empty, but it keeps its own padding, border, background and any explicit size (`height: 100%`, `flex: 1`, grid track). In a stacked tab layout, inactive panels can still take space. Take them out of flow too (for example `position: absolute`, or one grid cell for all panels), or put `hidden` on an inner wrapper. Contents are also removed from find-in-page, tab order and the accessibility tree, which is the same as `display: none`.
  - Verified: web.dev says `display: none` "destroys its rendering state" and `content-visibility: hidden` preserves it.
- Evidence:
  - https://web.dev/articles/content-visibility
  - https://drafts.csswg.org/css-contain-2/#content-visibility (when an element skips its contents, the UA turns on "layout containment, style containment, paint containment, and size containment". For `hidden`: "similar to giving the contents display: none")
  - BCD 8.1.2 `css.properties.content-visibility.*`; web-features `content-visibility` `by_compat_key`

### Avoid layout-forcing reads in pointer handlers
- Verdict: corrected
- Correction:
  - Example bug: `addEventListener('scroll', …, { passive: true })` on `window` does not see scrolling of nested scroll containers. Per CSSOM View, only a `scroll` event fired at a Document bubbles. An element's `scroll` event does not bubble. Use `addEventListener('scroll', update, { capture: true, passive: true })`, or listen on the scroll container itself.
  - Verified in current Chromium: `MouseEvent::layerX/layerY/offsetX/offsetY` call `ComputeRelativePosition()`, which calls `GetDocument().UpdateStyleAndLayout(DocumentUpdateReason::kInput)`. The result is cached per event. The Status label is correct (gist, with Chromium source).
- Evidence:
  - https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/events/mouse_event.cc (lines 458–580; saved as `raw/verify/01n/mouse_event.cc`)
  - https://gist.github.com/paulirish/5d52fb081b3570c81e3a ("mouseEvt.layerX, mouseEvt.layerY, mouseEvt.offsetX, mouseEvt.offsetY")
  - https://drafts.csswg.org/cssom-view/#document-run-the-scroll-steps ("If target is a Document … fire an event named type that bubbles"; otherwise "fire an event named type at target")

### Treat IntersectionObserver callbacks as next-task, and use them to pause off-screen work
- Verdict: corrected
- Correction:
  - Status: "Baseline widely available since 2021-09-25 (newly available 2019-03-25; Chrome 51/58, Firefox 55, Safari 12.1)". The item gave the newly-available year (2019) with the widely-available label.
  - Mechanism is verified. HTML "update the rendering" runs "update intersection observations", which queues an intersection observer task on the IntersectionObserver task source. The callback therefore runs after that frame.
  - Missing caveats: IO reports only geometric intersection. It does not detect occlusion by another panel or modal, and it does not tell you that the tab is hidden. Also check `document.visibilityState`, because WebSocket-driven processing continues in hidden tabs. With the implicit root, `rootMargin` is ignored for a cross-origin-domain target, for example a chart inside a cross-origin iframe (IO spec: the offsets "are only applied when handling same-origin-domain targets").
- Evidence:
  - web-features `intersection-observer` (low 2019-03-25, high 2021-09-25)
  - https://w3c.github.io/IntersectionObserver/#queue-intersection-observer-task
  - https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering

### Keep preserveDrawingBuffer false for WebGL charts
- Verdict: verified
- Evidence: https://registry.khronos.org/webgl/specs/latest/1.0/ (drawing buffer section: "it can cause significant performance loss on some platforms. Whenever possible this flag should remain false". Also: after compositing, the buffer "shall be cleared" when the flag is false, and reads "after the rendering function has returned" are undefined). Default `preserveDrawingBuffer = false` is in the IDL. This agrees with `verify/10-gpu-webgl.verify.md`. The only exception in 10-gpu-webgl is `desynchronized: true`, where `preserveDrawingBuffer: true` is recommended to avoid flicker.

### Do not build large DOM subtrees in one task
- Verdict: verified
- Evidence: https://web.dev/articles/client-side-rendering-of-html-and-interactivity. It says client-side JavaScript tasks "are not automatically chunked up". Streamed server HTML gives "automatic yielding to the main thread for free". https://web.dev/articles/dom-size-and-interactivity (Lighthouse warns at 800 nodes and flags as excessive at 1,400).

### Use the Rendering drawer to see paint, layers and frame drops live
- Verdict: verified
- Evidence: https://developer.chrome.com/docs/devtools/rendering/performance (last updated 2022-04-13). Paint flashing "green". Layout Shift Regions "purple". Layer Borders "orange and olive", tiles "cyan". Frame rendering stats: FPS, frames rendered (blue), partially presented (yellow) and dropped (red), GPU raster on/off, GPU memory. Scrolling Performance Issues shows scroll-related listeners. The page date is old, and I did not check the overlay in Chrome 154 itself.

### Find unused CSS and JS with the Coverage panel
- Verdict: corrected
- Correction:
  - Sources: cite the Coverage panel page, https://developer.chrome.com/docs/devtools/coverage (last updated 2026-04-13). The cited Lighthouse page is legacy. It says "This audit has moved into the Render-blocking requests insight as of Lighthouse 13". It mentions the Coverage tab only in passing (last updated 2019-05-02).
  - Add these steps from the current doc: choose **Per function** or **Per block** scope; click **Reload** to record load; the recording continues while you interact; **Stop instrumenting coverage and show results**; filter by URL and type; **Export coverage**.
  - Add a caveat: "unused" means not used in this recording. CSS for hover/focus states, other media queries, other routes or error states shows as unused. Split such CSS out of the critical path, but do not delete it only because Coverage shows it as unused.
- Evidence: https://developer.chrome.com/docs/devtools/coverage ; https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources

---

## Cross-file conflicts

1. **Deferred and module scripts in one task (Chromium).** These notes say Chromium runs all deferred (and module) scripts in the `DOMContentLoaded` task: `01-critical-rendering-path.md:36` (pipeline table row 5), `01-critical-rendering-path.md:501`, `03-course-js-and-vitals.md:127`, `06-js-event-loop-and-scheduling.md:776`, `16-explore-fast-batch-01.md:13`, `:318` and `:867`. This was true through Chrome 144. It is **not true for Chrome 145+**: `SeparateDeferModuleScriptTasks` is on by default, and each script gets its own task. `verify/06` (line 253) and `verify/03` (line 48) said no newer source existed. The chromiumdash commit above is that source.
2. **Commit blocks the main thread.** `01-critical-rendering-path.md:40` (pipeline table row 9, "main thread blocked during commit") and the threads table in this file say that commit blocks the main thread. Since Chrome 122, the main thread is not blocked, except for frames that contain an input response and for writes to state that is still being committed.
3. **Layerization thread.** The threads table in this file puts layerization on both the main thread and the compositor thread. `01-critical-rendering-path.md:40` and `:64` correctly put Layerize on the main thread. Only the compositor-thread row is wrong.
4. **offsetX in pointer handlers.** `07-js-web-apis.md:266` sends `e.offsetX/e.offsetY` from a `pointermove` handler, and `18-skills-survey-github.md:322` reads `e.offsetX` in a rAF flush. This file (and `06-js-event-loop-and-scheduling.md:575`, `19-skill-design.md:423`/`:581` EVT-08) says `offsetX/offsetY` force layout in Chromium. Change both examples to `clientX/Y` minus a cached rect.
5. **Responsive preload Baseline label.** This file and `01-critical-rendering-path.md:311` say "widely available (2023-12…)". `02-course-loading.md:585` and `04-html-and-http-loading-features.md:172` correctly say newly available 2023-12-11 and widely available 2026-06-11. `15-gaps-round-1.md:749` already reported this.
6. **IntersectionObserver Baseline year.** `15-gaps-round-1.md:752` calls "Baseline widely available (2019)" correct. By web-features, 2019-03-25 is the newly-available date. Widely available is 2021-09-25.
7. **Preload vs fetchpriority for async scripts.** `02-course-loading.md:625` uses the same reasoning as this file ("a preload … competes with CSS"). The web.dev table shows that `fetchpriority="high"` gives the same High priority. Fix both the same way. `01-critical-rendering-path.md:355` and `04-html-and-http-loading-features.md:36` give the same advice (use `fetchpriority`, not preload) without this wrong reason, so they can stay as they are.
8. **Compositor-animated properties.** This file lists transform, opacity and filter. `01-critical-rendering-path.md:740` says the composited background-color/clip-path status was "not verified". `verify/05-css-rendering.verify.md` (lines 35 and 241) confirms stable from M142 (background-color) and M152 (clip-path).

No conflicts found for: the inline-blob numbers (`02-course-loading.md:474` matches), the `content-visibility: hidden` advice (`03:809`, `05:318–328` match; neither has the box-still-in-layout caveat), `preserveDrawingBuffer` (`10-gpu-webgl.md:43–59` matches), and the 100 KB target (`03:109–117`, `06:775`, `16-explore-fast-batch-01.md:298–304` match. The 50–100 kB V8 heuristic in `08`/`09` comes from a different, 2019 source).

## Missing but important

1. **Chrome 145: separate tasks for defer/module scripts.** With this change, splitting deferred bundles now shortens tasks in Chromium too, and it helps INP during load. Sources: https://chromiumdash.appspot.com/commit/e7e02f3ceba01c4519f58ab4b4c2445ba7566609 ; https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/script/html_parser_script_runner.cc
2. **Non-Blocking Commit (Chrome 122) and its input exception.** Main-thread JS can overlap commit, except in frames that contain an input response, where the main thread waits so the compositor can do critical work. Update the pipeline table and add this to the explanation of INP "presentation delay". Sources: https://chromiumdash.appspot.com/commit/093aa4c5069eaa9808ca78f1064dc534c3fc2f95 ; https://chromium.googlesource.com/chromium/src/+/HEAD/cc/trees/proxy_main.cc
3. **`content-visibility: auto` + `contentvisibilityautostatechange` to pause off-screen canvas work.** This is an alternative to IntersectionObserver for the off-screen chart item. The event's `skipped` flag tells the page when rendering of the element is skipped. It is in `05-css-rendering.md` but not in 01. Status: the event is Baseline newly available 2024-09-16 (Chrome 108, Firefox 130 for the event handler, Safari 18). Sources: https://drafts.csswg.org/css-contain-2/#content-visibility-auto-state-change ; https://developer.mozilla.org/en-US/docs/Web/API/Element/contentvisibilityautostatechange_event
4. **Pause chart work on `visibilitychange`.** IntersectionObserver does not report a hidden tab. rAF stops in a hidden tab, but WebSocket parsing and model updates continue. Source: https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event
5. **Prefetch `import()` chunks on intent.** Load the chunk on `pointerenter`/`focus` or at idle time, or use `<link rel=modulepreload>`, so that the first click does not pay network and compile time. It is in `09-v8-consolidated.md:1098–1107`, but the split-script item in this file does not say it. Source: https://web.dev/articles/script-evaluation-and-long-tasks (modulepreload); https://v8.dev/blog/cost-of-javascript-2019
6. **Keep scripts over about 1 KB external.** V8 uses the code cache only for external scripts, and inline scripts are compiled again on every visit. This belongs with the "Do not inline large blobs" item. Source: https://v8.dev/blog/cost-of-javascript-2019 ("if the script is over 1 kB, avoid inlining it")
7. **`Document-Policy: expect-no-linked-resources` (Chrome 134).** It tells the UA that it can skip the preload scanner for large HTML that has no subresources. It is in `15-gaps-round-2.md:175–183`, but not in 01. Source: https://chromestatus.com/feature/5202800863346688
8. **Use the "Render-blocking requests" insight, not the Lighthouse audit.** Lighthouse 13 moved `render-blocking-resources` into this Performance-panel insight. Pair it with Coverage. Source: https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources (warning banner); https://developer.chrome.com/docs/performance/insights/render-blocking
