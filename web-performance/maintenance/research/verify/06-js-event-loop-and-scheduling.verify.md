# Verify: 06-js-event-loop-and-scheduling.md

Summary counts: 44 items checked. 39 verified, 5 corrected, 0 disputed, 0 unverified.

The two most important corrections for a trading terminal:
1. Chrome starts intensive timer throttling (1 wake-up per minute) after **1 minute** hidden, not 5 minutes, when the page was fully loaded before it was hidden. The 5-minute grace period applies only to pages that are still loading.
2. Safari does not follow the "nested > 5 → 4 ms" rule for `setTimeout`. WebKit clamps one-shot timers only from nesting level 10, has no 1 ms minimum for `setTimeout`, and was measured at a 26.7 ms median per nested `setTimeout` in Safari 18.4. The `MessageChannel`/`postMessage` fallback matters more in Safari than the notes say.

Checks run (2026-09-23):
- MDN browser-compat-data 8.1.2 (timestamp 2026-09-17) and web-features 3.39.0. Both are still `latest` on npm today. Files: `raw/verify/03/bcd.json`, `raw/verify/03/wf.json`. Query helper: `raw/verify/06/q.py`. I queried every Status line.
- Chromium `main` source, fetched today to `raw/verify/06/`: `core/scheduler/dom_timer.cc`, `platform/scheduler/common/features.h` and `features.cc`, `main_thread/page_scheduler_impl.cc`, `main_thread/frame_scheduler_impl.cc`, `modules/websockets/websocket_channel_impl.cc`.
- WebKit `main`: `page/DOMTimer.cpp`, `page/DOMTimer.h`, `page/Page.cpp`, `platform/graphics/AnimationFrameRate.h`, `WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`. The last commit on `DOMTimer.cpp` is 2026-05-08.
- Firefox `main`: `modules/libpref/init/StaticPrefList.yaml`, `dom/base/TimeoutManager.cpp`.
- React `main`: `scheduler/src/SchedulerFeatureFlags.js` (`frameYieldMs = 5`) and `scheduler/src/forks/Scheduler.js`. `scheduler-polyfill` 1.3.0 README and `src/host-callback.js`.
- chromestatus JSON for 4889002157015040, 5072451480059904, 4718288976216064 and 5580139453743104.
- GitHub API: WebKit standards-positions #361; interop #1398, #1413, #1372, #1120, #1067; mozilla/standards-positions #929. WebKit bug 285049 (REST API).
- Nolan Lawson, "Why do browsers throttle JavaScript timers?" (2025-08-31), through WebFetch.
- The research's saved pages in `raw/js-event-loop/` (saved 2026-09-22): HTML spec webappapis and timers, WICG scheduling (Draft CG Report 2025-05-30), the IO and RO specs, the web.dev and developer.chrome.com articles, and the MDN pages. I grepped them for every quote and number that the notes use.
- The CSS Containment 2 draft and the DOM Standard (fetched today). The Pointer Events spec source (`w3c/pointerevents` gh-pages).
- Safari 27.0 release notes (`raw/verify/02/safari27.txt`). They add nothing on `scheduler`, `requestIdleCallback`, `devicePixelContentBoxSize`, or LoAF.
- 21 cited URLs checked with curl: all return HTTP 200.

---

## A. The event loop model

### Place each piece of work in the right slot of the frame: task, microtask, or rendering step
- Verdict: verified
- Note: The step order in the Why line matches the current spec text. The spec also has steps that the notes leave out (reveal, flush autofocus candidates, the content-visibility proximity check, record rendering time, process top layer removals). None of them changes the advice. "Filter non-renderable documents" also removes documents whose "rendering is suppressed for view transitions".
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model ("queue a global task on the rendering task source given navigable's active window to update the rendering"; "60Hz", "30 rendering opportunities per second", "4 rendering opportunities per second, or even less")

### Know that microtasks run whenever the JS stack empties, not only at the end of a task
- Verdict: verified
- Evidence: https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/ ; https://html.spec.whatwg.org/multipage/webappapis.html (clean up after running script → microtask checkpoint)

### Keep every task under 50 ms, and much shorter while something animates
- Verdict: verified
- Note: web.dev: "keep your JavaScript to something in the region of 3-4ms" during animation. React `main` still has `frameYieldMs = 5`.
- Evidence: https://web.dev/articles/optimize-javascript-execution ; https://web.dev/articles/optimize-long-tasks ("the task's total time minus 50 milliseconds is known as the task's blocking period") ; https://raw.githubusercontent.com/facebook/react/main/packages/scheduler/src/SchedulerFeatureFlags.js

### Do not expect a frame between every small task; get visible progress through rAF
- Verdict: verified
- Evidence: https://developer.chrome.com/docs/web-platform/long-animation-frames ("the browser will typically continue the current frame well past 16.66 milliseconds no matter how well broken up the tasks are within it") ; HTML spec ("a user agent might wish to coalesce timer callbacks together, with no intermediate rendering updates")

## B. Timers

### Never drive visual updates with setTimeout/setInterval; use rAF
- Verdict: verified
- Evidence: https://www.andreaverlicchi.eu/en/blog/jake-archibald-in-the-loop-jsconf-asia-talk-transposed/ ("three or four per frame"; "you can end up with drift") ; https://web.dev/articles/optimize-javascript-execution ; web-features `request-animation-frame` (Baseline low 2015-07-29)

### Account for the 4 ms nesting clamp when you yield with setTimeout
- Verdict: corrected
- Correction:
  - (1) The Status line "Spec rule, all browsers" is wrong for Safari. Chromium follows the spec: `kSpecCompliantMaxTimerNestingLevel = 6`, with the level incremented before use, and `kMinimumInterval = 4 ms`. Firefox also follows it: `dom.clamp.timeout.nesting.level = 5`, `dom.min_timeout_value = 4`. WebKit `main` uses `maxTimerNestingLevelForOneShotTimers = 10` and `maxTimerNestingLevelForRepeatingTimers = 5`. So in Safari, `setTimeout` gets the 4 ms minimum only from nesting level 10, and `setInterval` gets it from level 5.
  - (2) "Per the Chromium intent thread, Safari still applies a 1 ms minimum" is wrong for `setTimeout`. WebKit has `minIntervalForOneShotTimers { 0_ms }` and `minIntervalForRepeatingTimers { 1_ms }`, so the 1 ms minimum applies only to `setInterval`. chromestatus 4889002157015040 lists Safari as "Shipped/Shipping" for the `setTimeout(0)` change (WebKit bug 221124), and 5072451480059904 lists "No signal" for `setInterval`.
  - (3) Add this Safari measurement: Nolan Lawson (2025) measured a median of 4.2 ms (Chrome 139), 4.72 ms (Firefox 142) and 26.73 ms (Safari 18.4) per `setTimeout` in a 101-deep chain. In the same test, `MessageChannel` took 0.52 ms and `window.postMessage` took 0.05 ms in Safari. The cause of the 26.7 ms is not explained.
  - (4) The Chrome version numbers are correct: 101 for `setTimeout(0)` and 135 for `setInterval`.
  - (5) The local test ran in a hidden pane. Chrome aligns hidden-page timers to 1 s wake-ups after `kThrottlingDelayAfterBackgrounding = 10 s`, so a longer hidden run would give different numbers. Repeat the measurement in a visible tab.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/scheduler/dom_timer.cc (lines 59–63, 331–335, 350–352) ; https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/DOMTimer.cpp (lines 56–61, 418–433) ; https://github.com/mozilla-firefox/firefox/blob/main/modules/libpref/init/StaticPrefList.yaml (`dom.clamp.timeout.nesting.level`, `dom.min_timeout_value`) ; https://chromestatus.com/feature/4889002157015040 ; https://chromestatus.com/feature/5072451480059904 ; https://nolanlawson.com/2025/08/31/why-do-browsers-throttle-javascript-timers/

### Do not rely on timers for correctness in background tabs
- Verdict: corrected
- Correction:
  - (1) The trigger "hidden > 5 min" is stale for loaded pages. Chromium `main` has `kIntensiveWakeUpThrottling_GracePeriodSeconds_Default = 5 * 60` and `kIntensiveWakeUpThrottling_GracePeriodSecondsLoaded_Default = 60`. `GetIntensiveWakeUpThrottlingGracePeriod(loading)` returns the 60 s value when the page is not loading and no enterprise policy overrides it. So a fully loaded page that is hidden and silent gets 1-per-minute wake-ups for chained timers (chain count ≥ 5) after **1 minute**. Pages that are still loading when hidden wait 5 minutes. This is the "Quick intensive timer throttling of loaded background pages" feature. In its blink-dev intent, the API owners offered to approve "1 minute instead of 10 seconds". The chromestatus entry was not updated after the launch, but the source is current.
  - (2) Add the Firefox detail behind the MDN WebSocket claim. Firefox `TimeoutManager::BudgetThrottlingEnabled()` returns false when the window has open WebSockets, active IndexedDB databases, or peer connections, so these windows skip *budget* throttling. The 1 s background minimum (`dom.min_background_timeout_value = 1000`) still applies.
  - (3) Chromium confirms the notes' warning. `websocket_channel_impl.cc` registers WebSocket with only `DisableBackForwardCache()` and does not use `DisableAggressiveThrottling`. An open WebSocket does not protect timers from intensive throttling in Chrome.
  - (4) Add freezing: from Chrome 133, when Energy Saver is on, Chrome freezes CPU-heavy tabs that have been hidden and silent for more than 5 minutes.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/scheduler/common/features.h (lines 40–41) ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/scheduler/common/features.cc (lines 66–83) ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/scheduler/main_thread/page_scheduler_impl.cc (line 690) ; https://groups.google.com/a/chromium.org/g/blink-dev/c/5SZB2CFFGqE ; https://chromestatus.com/feature/5580139453743104 ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/websockets/websocket_channel_impl.cc (lines 309–315) ; https://github.com/mozilla-firefox/firefox/blob/main/dom/base/TimeoutManager.cpp (lines 1320–1370) ; https://developer.chrome.com/blog/freezing-on-energy-saver

### Replace recurring timers and polling with events, observers, or push
- Verdict: verified
- Note: web.dev says that timers "can contribute to input delay". "A main source" is a small overstatement.
- Evidence: https://web.dev/articles/optimize-input-delay ; https://web.dev/articles/find-slow-interactions-in-the-field ("'user-callback' indicates the blocking task was from setInterval, setTimeout, or even requestAnimationFrame")

### Use a MessageChannel task when you need a zero-delay macrotask without the clamp
- Verdict: verified
- Note: React `main` still has "We prefer MessageChannel because of the 4ms setTimeout clamping" and prefers `setImmediate` in Node and jsdom. `scheduler-polyfill` 1.3.0 uses `PostMessageCallbackMananger` over a `MessageChannel`. Nolan Lawson (2025) found that Safari 18.4 "seems to have some additional throttling for MessageChannel": 0.52 ms against 0.05 ms for `window.postMessage` to self. Both are far better than Safari's `setTimeout` (26.7 ms).
- Evidence: https://raw.githubusercontent.com/facebook/react/main/packages/scheduler/src/forks/Scheduler.js ; https://github.com/GoogleChromeLabs/scheduler-polyfill/blob/main/src/host-callback.js ; https://nolanlawson.com/2025/08/31/why-do-browsers-throttle-javascript-timers/ ; web-features `channel-messaging` (Baseline low 2015-09-22)

## C. Microtasks, promises, await

### Never "yield" with a promise or queueMicrotask
- Verdict: verified
- Evidence: https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#microtask-queuing ("scheduling a lot of microtasks has the same performance downsides as running a lot of synchronous code") ; https://web.dev/articles/optimize-long-tasks ("progressive enhancement")

### Use queueMicrotask only for consistent ordering and same-task batching
- Verdict: verified
- Evidence: MDN Microtask guide ("exceptions thrown by the callback are reported as rejected promises rather than being reported as standard exceptions") ; web-features `queuemicrotask` (low 2020-07-28, high 2023-01-28)

### Keep awaits off per-item hot paths and ship native async/await
- Verdict: verified
- Evidence: https://v8.dev/blog/fast-async ("As of V8 v7.2 and Chrome 72, --harmony-await-optimization is enabled by default. The patch to the ECMAScript specification was merged.")

## D. requestAnimationFrame

### Coalesce high-frequency inputs and data into one rAF per frame
- Verdict: verified
- Note: The 2019 cross-browser table is old. Firefox `main` still coalesces `mousemove` and `touchmove` on the content side (`dom.events.coalesce.mousemove` and `dom.events.coalesce.touchmove` are both `true`). I did not confirm rAF alignment in Firefox. The "no extra frame" claim comes from Nolan Lawson, citing Jake Archibald.
- Evidence: https://developer.chrome.com/blog/aligning-input-events ; https://nolanlawson.com/2019/08/14/browsers-input-events-and-frame-throttling/ ("an extra rAF won't add an extra frame delay")

### Drive animation from the rAF timestamp, never from an assumed 16.7 ms
- Verdict: verified
- Note: WebKit `AnimationFrameRate.h` has the throttling reasons `LowPowerMode`, `NonInteractedCrossOriginFrame`, `ThermalMitigation`, `AggressiveThermalMitigation`, `VisuallyIdle` and `OutsideViewport`, and `HalfSpeedThrottlingFramesPerSecond = 30`. Also, the WebKit preference `PreferPageRenderingUpdatesNear60FPSEnabled` is `default: true` (only visionOS is `false`), so Safari renders near 60 fps even on 120 Hz displays. Safari 27 fixed "requestAnimationFrame() not providing sub-millisecond timestamp precision in cross-origin isolated contexts".
- Evidence: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/AnimationFrameRate.h ; https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml ; https://developer.chrome.com/blog/memory-and-energy-saver-mode ("your animations will run twice as slow") ; MDN requestAnimationFrame ("equal to document.timeline.currentTime")

### Stop rAF loops when nothing changes (render on demand)
- Verdict: verified
- Evidence: HTML spec "Unnecessary rendering" step ("doc's map of animation frame callbacks is empty") ; MDN requestAnimationFrame ("prefer unattainable values such as null")

### Keep rAF callbacks to visual work only
- Verdict: verified
- Evidence: https://web.dev/articles/find-slow-interactions-in-the-field (`rafDuration = styleAndLayoutStart - renderStart`; "executed after event handlers have finished running, but just prior to style recalculation and layout work")

### To run code after the next paint, use rAF then a task, not a double rAF
- Verdict: verified
- Note: `requestPostAnimationFrame` is not in BCD 8.1.2 (no key). The task runs after the main thread has finished the frame's rendering work. It is not necessarily after the compositor has put the frame on screen.
- Evidence: https://web.dev/articles/optimize-inp ("an effective method that works in all browsers to prevent non-critical code from blocking the next frame")

### Prefer CSS or Web Animations for declarative motion
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-input-delay ; https://developer.chrome.com/blog/timer-throttling-in-chrome-88 ("the browser can perform additional optimizations like automatic compositing") ; web-features `web-animations` (high 2023-03-16)

## E. Observers inside the frame

### Read element sizes from ResizeObserver/IntersectionObserver instead of forcing layout
- Verdict: verified
- Note: BCD 8.1.2: `contentBoxSize` Chrome 84, Firefox 92 (69–92 partial), Safari 15.4. `devicePixelContentBoxSize` Chrome 84, Firefox 108 (93–108 partial), Safari no (not added in Safari 27). The IO spec queues delivery "on the IntersectionObserver task source". For long sessions: Safari 27 "Fixed a performance issue where ResizeObserver callbacks became increasingly sluggish over time". Safari 26.x and older still have that problem.
- Evidence: https://w3c.github.io/IntersectionObserver/ ; https://drafts.csswg.org/resize-observer/ ; https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ; BCD `api.ResizeObserverEntry.*`

### Do not change observed sizes inside a ResizeObserver callback without a guard
- Verdict: verified
- Evidence: https://drafts.csswg.org/resize-observer/ ("If targetDepth is greater than depth then add observation to [[activeTargets]]. Else add observation to [[skippedTargets]]"; "ResizeObserver loop completed with undelivered notifications.")

## F. Idle and prioritized scheduling

### Break up long tasks with scheduler.yield(), with a fallback
- Verdict: verified
- Note: BCD 8.1.2 and web-features `scheduler`: Chrome/Edge 129, Firefox 142, no Safari, not Baseline. WebKit standards-positions #361 is still open with only `venue: WICG` and `from: Google` labels (last comment 2024-07-03). New since the notes: the Interop 2027 focus-area proposal "Scheduler API" (#1413, opened 2026-09-18) is open. The Interop 2026 proposal "Prioritized Task Scheduling" (#1120) was closed. Because Safari clamps nested `setTimeout` heavily (see the 4 ms item), use the `MessageChannel`/`postMessage` fallback, not `setTimeout`, for Safari.
- Evidence: https://developer.chrome.com/blog/use-scheduler-yield ; https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield ; https://wicg.github.io/scheduling-apis/ (`Promise<undefined> yield();`) ; https://github.com/WebKit/standards-positions/issues/361 ; https://github.com/web-platform-tests/interop/issues/1413

### Yield on a time budget, not after every item
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-long-tasks ("A common deadline is 50 milliseconds") ; https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/performance.md ("< 50ms: Execute synchronously. 50ms - 250ms: Slice tasks... > 250ms: Offload to a Web Worker."; file returns HTTP 200 today)

### In input handlers, apply the visible feedback first, then yield; call preventDefault before any await
- Verdict: verified
- Note: The comment `await yieldToMain(); // let the frame paint` promises a little too much. A yield lets the browser render, but it does not force a render before the continuation. This is especially true with the `setTimeout`/`MessageChannel` fallback (see "Do not expect a frame between every small task"). When the rest of the work must run after the paint, use the rAF + task pattern.
- Evidence: https://web.dev/articles/optimize-inp ; https://github.com/github/eslint-plugin-github/blob/main/docs/rules/async-preventdefault.md (HTTP 200)

### Use scheduler.postTask priorities, TaskController, and abort signals for ordered background work
- Verdict: verified
- Note: The spec table is correct (background 0/1, user-visible 2/3, user-blocking 4/5). "If option's priority is specified, then that TaskPriority will be used to schedule the task, and the task's priority is immutable." The polyfill README says that `"user-blocking"` tasks "do not have a higher event loop priority" and that `yield()` continuations are always `"user-visible"`.
- Evidence: https://wicg.github.io/scheduling-apis/ ; https://github.com/GoogleChromeLabs/scheduler-polyfill ; BCD `api.TaskSignal.any_static` (Chrome 116, Firefox 142)

### Use requestIdleCallback only for deferrable work, always with a timeout and a Safari fallback
- Verdict: verified
- Note: WebKit `main` still has `RequestIdleCallbackEnabled` with `status: testable` and `defaultValue: false`. WebKit bug 285049 ("Enable requestIdleCallback") is REOPENED. The WebKit engineer wrote on 2025-06-03 that "this feature is in a bit of limbo given we observed a page load time regression on google.com". The interop issue text says "disabled it due to regressions (which are now fixed?)", with a question mark. The Interop 2026 proposal (#1005) was closed. The Interop 2027 proposal (#1398) is open.
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html ("Let deadline be this event loop's last idle period start time plus 50") ; https://bugs.webkit.org/show_bug.cgi?id=285049 ; https://github.com/web-platform-tests/interop/issues/1398 ; BCD `api.Window.requestIdleCallback` (Safari "preview", flag)

### Do not use navigator.scheduling.isInputPending()
- Verdict: verified
- Note: The MDN page shows "Deprecated" and "Experimental". BCD 8.1.2 still has `deprecated: false, experimental: true`. web-features marks `is-input-pending` as `discouraged`, with `scheduler` as the alternative. The Chrome article has the note "Conditional yielding on user input is no longer recommended."
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/Scheduling/isInputPending ; https://developer.chrome.com/docs/capabilities/web-apis/isinputpending ; https://web.dev/articles/optimize-long-tasks

### Pick the scheduling primitive by what must happen before it
- Verdict: corrected
- Correction: (1) `setTimeout` row: "4 ms clamp when nested > 5" is true for Chrome and Firefox. Add "Safari: from nesting level 10 for `setTimeout` (WebKit), and heavy delays were measured (≈27 ms median in Safari 18.4)". (2) "Only when idle" row: `postTask({priority: 'background'})` is the lowest priority, but it does not wait for an idle period and has no `IdleDeadline`. Describe it as "lowest priority, not idle-gated". The polyfill maps `background` to `requestIdleCallback` only where rIC exists. The other rows and the MDN ordering example ("user-blocking postTask, user-visible yield, user-visible postTask") are correct.
- Evidence: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/DOMTimer.cpp ; https://nolanlawson.com/2025/08/31/why-do-browsers-throttle-javascript-timers/ ; https://wicg.github.io/scheduling-apis/ ; https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield

## G. Measuring long tasks and INP

### Observe long-animation-frame entries in the field, not only longtask
- Verdict: corrected
- Correction: (1) "Add `crossorigin="anonymous"` to third-party scripts" needs a condition. The third-party server must send `Access-Control-Allow-Origin`. Without it, a CORS-mode script fails to load, which is worse than missing attribution. Write: "Add `crossorigin="anonymous"` only to third-party scripts whose server sends CORS headers." 17-collections-batch-01 (line 222) states this condition correctly. (2) Add to Status: the LoAF spec became a W3C First Public Working Draft (2026-04-28). Mozilla's position is "positive" (standards-positions #929), but Firefox has no implementation. The Interop 2026 proposal (#1067) was closed on 2026-02-19, and an Interop 2027 proposal (#1372, 2026-09-05) is open. All other facts are correct: the 200-entry buffer, `blockingDuration`, script entries only for scripts over 5 ms, no attribution for cross-origin iframes, workers and extensions, entry point only, Chrome 123, `paintTime`/`presentationTime` from Chrome 145, and "no plans to deprecate the Long Tasks API".
- Evidence: https://developer.chrome.com/docs/web-platform/long-animation-frames ("This can be resolved by fetching those scripts using CORS by adding crossOrigin = "anonymous"") ; https://github.com/mozilla/standards-positions/issues/929 ; https://github.com/web-platform-tests/interop/issues/1372 ; https://w3c.github.io/long-animation-frames/ ; BCD `api.PerformanceLongAnimationFrameTiming.paintTime` (Chrome 145)

### Diagnose INP by subpart before you optimize
- Verdict: verified
- Note: web-vitals `latest` is 6.2.2. The README still has `interactionTarget`, `inputDelay`, `processingDuration`, `presentationDelay`, `longAnimationFrameEntries`, `longestScript` and `totalScriptDuration`.
- Evidence: https://web.dev/articles/inp ; https://cdn.jsdelivr.net/npm/web-vitals/README.md ; web-features `event-timing` (low 2025-12-12) ; BCD `api.PerformanceEventTiming.interactionId` (Chrome 96, Firefox 144, Safari 26.2)

## H. Layout thrashing and DOM work

### Batch DOM reads first, then writes; never alternate them in a loop
- Verdict: verified
- Evidence: https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing ; https://developer.chrome.com/docs/performance/insights/forced-reflow

### Know the APIs that force style or layout
- Verdict: verified
- Note: The gist history has content revisions in 2020-04 and two small edits on 2023-10-26. "Updated slightly April 2020" is still the gist's own footer.
- Evidence: https://gist.github.com/paulirish/5d52fb081b3570c81e3a (GitHub gists API history)

### Do not write styles in continuous input handlers and then read layout in rAF
- Verdict: verified
- Evidence: https://web.dev/articles/debounce-your-input-handlers ("Input handlers, like those for scroll and touch, are scheduled to run just before any requestAnimationFrame callbacks")

### Keep the DOM small; virtualize long lists and build large DOM in chunks
- Verdict: verified
- Note: The notes correctly call 800/1,400 "historical". The current rule is the DevTools/Lighthouse 13 insight "Optimize DOM size": it fails only when a layout (over 100 layout objects) or a style recalculation (over 300 elements) takes more than 40 ms. Put that rule in the Why line, as 01 (line 631) does.
- Evidence: https://web.dev/articles/dom-size-and-interactivity ; https://developer.chrome.com/docs/performance/insights/dom-size

### Batch DOM writes by avoiding interleaved reads, not by relying on DocumentFragment
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/DocumentFragment ("The performance benefit of DocumentFragment is often overstated")

## I. Events and input

### Use event delegation for large or frequently re-rendered collections
- Verdict: verified
- Evidence: MDN Event bubbling ; BCD `api.EventTarget.addEventListener.options_parameter.options_signal_parameter` (Chrome 90, Firefox 86, Safari 15)

### Mark scroll-blocking listeners passive; use touch-action when you need to block gestures
- Verdict: verified
- Note: The DOM Standard now defines a "default passive value". It is true for `touchstart`, `touchmove`, `wheel` and `mousewheel` when the target is the Window, the Document, the document element (`<html>`), or the body. So "on window, document and body" should also name `<html>`. MDN's sentence "The specification ... defines the default value for the passive option as always being false" is out of date. The BCD numbers in the notes are correct (default-passive touch: Chrome 55, Firefox 61, Safari 11.1; wheel: Chrome 73, Firefox 84, Safari no).
- Evidence: https://dom.spec.whatwg.org/ ("The default passive value, given an event type type and an EventTarget eventTarget...") ; https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener ; BCD `options_passive_parameter_default_true_touch`, `..._wheel`

### Use getCoalescedEvents for precise drawing and getPredictedEvents to cut perceived latency
- Verdict: verified
- Note: In the Pointer Events spec IDL, `getCoalescedEvents()` and `onpointerrawupdate` are `[SecureContext]`, and `getPredictedEvents()` is not. BCD `pointerrawupdate` note: "Before version 142, pointerrawupdate events were exposed to non-secure contexts" (Chrome).
- Evidence: https://w3c.github.io/pointerevents/ ; BCD `api.PointerEvent.getCoalescedEvents` (firefox_android 79 partial: "always returns an empty array") ; web-features per-key status (`getPredictedEvents` low 2024-12-11; `getCoalescedEvents` not Baseline)

### Throttle visual reactions to rAF; debounce and abort only non-visual expensive work; use scrollend
- Verdict: verified
- Evidence: web-features `scrollend` (low 2025-12-12; Chrome 114, Firefox 109, Safari 26.2) ; https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/defer-work-until-scroll-ends.md (HTTP 200)

### Reduce interaction overlap: cancel superseded work
- Verdict: verified
- Evidence: https://web.dev/articles/optimize-input-delay ("Use AbortController to cancel outgoing fetch requests so the main thread doesn't become congested handling fetch callbacks")

### Keep input handlers minimal: move logging, persistence, and analytics off the critical path
- Verdict: verified
- Evidence: https://developer.chrome.com/docs/web-platform/long-animation-frames ("pauseDuration: Total time spent in "pausing" synchronous operations (alert, synchronous XHR)")

## J. Visibility and lifecycle

### On visibilitychange to hidden, stop rendering work and flush state; on visible, render once from the latest state
- Verdict: verified
- Note: web-features `page-visibility`: `visibilitychange_event` is Baseline low 2021-04-26 and high 2023-10-26. BCD: `VisibilityStateEntry` Chrome 115, `freeze`/`resume` Chrome 68, experimental. See the background-timers item for Chrome 133 freezing on Energy Saver.
- Evidence: https://developer.chrome.com/docs/web-platform/page-lifecycle-api ; https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event

### Pause off-screen heavy renderers
- Verdict: corrected
- Correction:
  - (1) Add a layout caveat. For `content-visibility: auto`, the spec says that "layout containment, style containment, and paint containment persist even if the element is not skipped". An on-screen chart pane therefore clips any tooltip, crosshair label or menu that overflows it, and the pane becomes the containing block for `position: fixed`/`absolute` descendants. Put overflowing UI in the top layer (popover/dialog) or in a portal outside the pane, or use `overflow-clip-margin`. 01 (line 677) already says "paint containment clips overflow such as tooltips".
  - (2) The Status line must also say that the `auto` value is partial in Safari 18.x ("Skipped content is not findable via find-in-page") and full from Safari 26 (BCD). Gate the code with `CSS.supports('content-visibility', 'auto')` and fall back to IntersectionObserver, as 15-gaps-round-1 (lines 49–74) does.
  - (3) The event versions are correct. web-features gives `contentvisibilityautostatechange_event` its own Baseline low date, 2024-09-16.
- Evidence: https://drafts.csswg.org/css-contain-2/ ("Note that in the content-visibility: auto case, layout containment, style containment, and paint containment persist even if the element is not skipped") ; BCD `css.properties.content-visibility.auto` ; https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/efficient-background-processing.md

## K. Startup and off-main-thread

### Split script evaluation into several smaller tasks
- Verdict: verified
- Note: I found no source that says Chromium has stopped running all `defer` scripts in the `DOMContentLoaded` task. The web.dev statement ("A potential solution is being explored") is the latest source.
- Evidence: https://web.dev/articles/script-evaluation-and-long-tasks ("a limit of 100 kilobytes per individual script is a good target")

### Move long pure computation to a worker
- Verdict: verified
- Note: BCD notes that Chromium does not support rAF in *nested* dedicated workers (crbug 41483010).
- Evidence: web-features `request-animation-frame-workers` (high 2025-09-27) ; https://web.dev/articles/script-evaluation-and-long-tasks ("any script requested by a web worker is evaluated off the main thread")

---

## Cross-file conflicts

- **Chrome intensive throttling trigger.** 06 (B, background tabs) and 07 (line 354, "after 5 minutes hidden ... they run once per minute (Chrome 88)") both say 5 minutes. Chromium `main` uses 60 s for pages that were loaded when hidden (`kIntensiveWakeUpThrottling_GracePeriodSecondsLoaded_Default = 60`). Both files need the correction.
- **setTimeout clamp.** 01 (line 862) says "clamps to 5 ms after nesting". 06 and 03 (line 703) say 4 ms per the spec, and 5 ms is the web.dev figure (4 ms plus overhead). All three files miss that WebKit clamps one-shot timers only from nesting level 10 and that Safari was measured at ≈27 ms per nested timer.
- **setTimeout as the Safari fallback.** 01 (line 861), 08-v8-batch-02 (line 361), 09-v8-consolidated (line 912), 16-explore-fast-batch-01 (line 822) and 16-explore-fast-batch-02 (lines 41, 366) recommend a plain `setTimeout` fallback for `scheduler.yield()`. 06 and 07 (line 911) offer `MessageChannel`. Because of Safari's timer clamp, the skill should prefer `MessageChannel`/`postMessage` in its fallback helper.
- **postTask version.** 01 (line 875) says "`scheduler.yield`/`postTask`: Chrome 129". `postTask` is Chrome 94 (BCD; 03 line 704, 06 and 07 line 912 agree).
- **LoAF `crossorigin` advice.** 06 says to add `crossorigin="anonymous"` to third-party scripts without a condition. 17-collections-batch-01 (line 222) pairs it with "make the CDN send CORS headers", which is the correct form.
- **content-visibility in Safari.** 05 (line 315) and 01 (line 649) say that `auto` exists only from Safari 26. 06 says that the event exists from Safari 18. 15-gaps-round-1 (lines 49–74) resolves this: `auto` is partial in 18.x and full in 26, and the event exists from 18. 06 should add the partial note.
- **devicePixelContentBoxSize Firefox version.** 01 (line 934), 07 (line 313) and 10 (line 159) say Firefox 108. 06 says "Firefox 93 (full 108)". These agree: BCD has 93–108 partial and 108 full.
- **isInputPending label.** 06 ("MDN: deprecated") and 07 ("deprecated") against 03 and 16 ("no longer recommended"). This is not a real conflict: MDN shows the Deprecated banner, BCD has `deprecated: false`, and web-features says `discouraged`.

## Missing but important

1. **Chrome freezing on Energy Saver (Chrome 133+).** When Energy Saver is on, Chrome freezes a browsing context group that has been hidden and silent for more than 5 minutes and that uses a lot of CPU. Freezing suspends all tasks, including WebSocket message handling. Audio/video conferencing and external-device tabs are exempt. There is an opt-out origin trial (`BackgroundPageFreezeOptOut`), and you can check eligibility in `chrome://discards`. A trading tab that keeps a socket and does heavy background work can be frozen. Sources: https://developer.chrome.com/blog/freezing-on-energy-saver ; https://chromestatus.com/feature/5158599457767424
2. **Enterprise switch for managed desktops.** The Chrome policy `IntensiveWakeUpThrottlingEnabled` (read in `features.cc` as a policy override) lets admins turn intensive wake-up throttling off, or force it on. For B2B terminal deployments this is the only reliable way to keep hidden-tab timers at 1 s granularity. Source: https://chromeenterprise.google/policies/intensive-wake-up-throttling-enabled/
3. **Safari timer alignment rules.** The notes say that no primary WebKit source was found. `DOMTimer.h` gives the rules: `hiddenPageAlignmentInterval() = 1_s`, `defaultAlignmentIntervalInLowPowerOrThermallyMitigatedMode() = 30_ms`, `nonInteractedCrossOriginFrameAlignmentInterval() = 30_ms`. `Page.cpp` can increase the hidden-page alignment over time (`hiddenPageDOMTimerThrottlingAutoIncreases`; the embedder controls it). Source: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/DOMTimer.h
4. **`window.postMessage` to self as the fastest Safari yield.** In Safari 18.4 it measured 0.05 ms, against 0.52 ms for `MessageChannel` and 26.7 ms for `setTimeout`. You must filter your own messages by a unique token, and third-party `message` listeners will see them. Source: https://nolanlawson.com/2025/08/31/why-do-browsers-throttle-javascript-timers/
5. **Safari renders near 60 fps on 120 Hz displays.** The WebKit preference `PreferPageRenderingUpdatesNear60FPSEnabled` is `default: true` (except visionOS). Frame-budget math and "one frame" latency estimates for Safari should use 16.7 ms, not 8.3 ms. Source: https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml
6. **Interop 2027 watch list for this topic.** "Scheduler API" (#1413), "Long Animation Frames API" (#1372) and "requestIdleCallback" (#1398) are open focus-area proposals. If Interop 2027 selects them, the Safari fallbacks in this file can later be removed. Sources: https://github.com/web-platform-tests/interop/issues/1413 ; https://github.com/web-platform-tests/interop/issues/1372 ; https://github.com/web-platform-tests/interop/issues/1398
7. **Safari 27 ResizeObserver fix for long sessions.** Before Safari 27, ResizeObserver callbacks "became increasingly sluggish over time". This matters for a terminal that stays open for hours and sizes every chart pane with ResizeObserver. Test long sessions on Safari 26.x. Source: https://webkit.org/blog/18325/webkit-features-for-safari-27-0/
