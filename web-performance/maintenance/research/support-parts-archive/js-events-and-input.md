# Support keys used by references/js-events-and-input.md

Checked: 2026-09-23, against the research copies of MDN browser-compat-data 8.1.2 (`raw/bcd.json`, build 2026-09-17) and web-features (`raw/web-features.json`), and the fact-check reports `verify/06-js-event-loop-and-scheduling.verify.md` and `verify/05-css-rendering.verify.md`. Target: Chromium only (Chrome and Edge). Other engines are listed only through the Baseline column.

Rows for references/support.md §A (feature table):

| Key | What it covers | Chrome / Edge | Baseline | Fallback in code | Rules | Checked | Source |
|---|---|---|---|---|---|---|---|
| `scheduler-yield` | `scheduler.yield()` (web-features `scheduler`, which also holds `scheduler.postTask`) | Chrome 129, Edge 129 (`postTask`: Chrome 94) | limited (Firefox 142; no Safari) | the `yieldToMain()` helper in TASK-03 (a `MessageChannel` task) when the Chromium floor is below 129 | EVT-01 (through TASK-03) | 2026-09-23 | https://api.webstatus.dev/v1/features/scheduler |
| `event-timing` | Event Timing entries with `interactionId`: the INP subparts input delay, processing and presentation delay | Chrome 76, Edge 79; `interactionId` Chrome 96 | newly, 2025-12-12 | none (diagnostic) | EVT-02 | 2026-09-23 | https://api.webstatus.dev/v1/features/event-timing |
| `long-animation-frames` | `long-animation-frame` entries: `scripts[]`, `invokerType`, `forcedStyleAndLayoutDuration`, `pauseDuration` | Chrome 123, Edge 123 | limited (Chromium only) | none (diagnostic) | EVT-02; used in the Verify lines of EVT-07 and EVT-13 | 2026-09-23 | https://developer.chrome.com/docs/web-platform/long-animation-frames |
| `coalesced-events` | `PointerEvent.getCoalescedEvents()`; `[SecureContext]` in the Pointer Events IDL, so it is missing on insecure origins | Chrome 58, Edge 79 | not Baseline (web-features `pointer-events-api` by compat key; Firefox for Android returns an empty array) | `[e]` when the method is missing or returns an empty array (EVT-04 does this) | EVT-04 | 2026-09-23 | https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents |
| `predicted-events` | `PointerEvent.getPredictedEvents()` | Chrome 77, Edge 79 | newly, 2024-12-11 (by compat key in `pointer-events-api`) | none needed | EVT-04 | 2026-09-23 | https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getPredictedEvents |
| `abortsignal-any` | `AbortSignal.any()` | Chrome 116, Edge 116 | newly (low 2024-03-19). The 30-month mark for Widely available was 2026-09-19, but the web-features copy still says low: re-check on build day | none needed at a Chromium floor of 116 or later | EVT-05, EVT-12 | 2026-09-23 | https://api.webstatus.dev/v1/features/abortsignal-any |
| `abortsignal-timeout` | `AbortSignal.timeout()` | Chrome 124, Edge 124 (Chrome 103 to 123: partial, it aborted with `AbortError`, not `TimeoutError`) | newly, 2024-04-18 | handle both `AbortError` and `TimeoutError` (EVT-12 does) | EVT-12 | 2026-09-23 | https://api.webstatus.dev/v1/features/abortsignal-timeout |
| `scrollend` | the `scrollend` event on elements and the document | Chrome 114, Edge 114 | newly, 2025-12-12 | none needed at a Chromium floor of 114 or later | EVT-11 | 2026-09-23 | https://api.webstatus.dev/v1/features/scrollend |

Facts that the rules state without a version (for §B or §C, if the support.md writer wants them on record):

- Default-passive listeners: touch listeners on the window, the document, `<html>` and `<body>` are passive by default from Chrome 55 (web-features: Widely available); wheel listeners there from Chrome 73 (not Baseline: no Safari). EVT-09 always sets `passive` explicitly, so it needs no row. Source: the DOM Standard "default passive value"; BCD `api.EventTarget.addEventListener.options_parameter.options_passive_parameter_default_true_touch` and `..._wheel`.
- `pointerrawupdate`: Chrome 77, not Baseline; secure contexts only from Chrome 142 (BCD note). EVT-04 names it only in Avoid.
- Lighthouse removed the `uses-passive-event-listeners` audit in Lighthouse 13 (verify/05). EVT-09 says only "Lighthouse no longer audits this".
- The `addEventListener` `signal` option (Chrome 90) and `setPointerCapture` (Chrome 55) are Baseline Widely available, so the rules tag them `baseline`.
