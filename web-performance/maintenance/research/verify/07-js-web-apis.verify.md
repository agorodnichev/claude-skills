# Verify: 07-js-web-apis.md

Checked on 2026-09-23.

Summary counts: 55 items. 39 verified, 16 corrected, 0 disputed, 0 unverified.

Data used:
- `@mdn/browser-compat-data` 8.1.2 (2026-09-17). This is still the npm `latest` today.
- `web-features` 3.39.0 (2026-09-17). Its `data.json` is byte-identical (same MD5) to the snapshot the notes used.
- The Chrome release schedule from chromiumdash: 152 = 2026-08-25, 153 = 2026-09-08, 154 = 2026-09-22 (stable), 155 = 2026-10-06. Chrome now ships every 2 weeks.
- Engine source code read today:
  - Firefox `nsRFPService.cpp` and `StaticPrefList.yaml`
  - WebKit `Performance.cpp` and `Seconds.h`
  - Chromium `features.h` / `features-renderer.cc`
- chromestatus API entries.
- The pages cited below.

Raw files are in `raw/verify/07/`. The helpers there are `q.py` (BCD), `w.py` (web-features) and `g.sh` (grep of the other notes).

Most important fixes:
1. `performance.now()` resolution of "100 µs / 5 µs isolated" is true only in Chromium. Firefox gives 1 ms with jitter, or 20 µs when the page is isolated. WebKit gives 1 ms, or 20 µs in its high-precision mode.
2. In Chrome, intensive timer throttling starts after 1 minute for pages that finished loading. It does not wait 5 minutes.
3. Chrome 154 (2026-09-22) finished the `unload` rollout at 100%. `unload` handlers no longer fire in Chrome by default.
4. `fetchLater` sends when the page enters bfcache, not when it is evicted from bfcache.
5. Since Chrome 133, Element Timing `renderTime` is no longer 0 for cross-origin images that have no TAO. It is coarsened to 4 ms.
6. `imageOrientation: 'none'` is not a valid value. Use `'from-image'`.
7. V8 Wasm has deopts since Chrome 137.
8. The 128 kB Wasm code-cache rule is obsolete.
9. Chrome 147 changed the `deviceMemory` buckets.

---

### Move heavy non-DOM work into a long-lived module worker
- Verdict: corrected
- Correction:
  - The list "WebUSB, WebRTC, and Web Audio are main-thread-only" comes from a 2019 web.dev page. It is partly stale:
    - WebUSB is exposed in Chromium dedicated workers (Chrome 70+; BCD `api.WorkerNavigator.usb`, partial).
    - `RTCDataChannel` is transferable to a worker (Chrome 130, Firefox 144, Safari 15; BCD `api.RTCDataChannel.transferable`). The notes' own Transferable list includes it.
    - `AudioContext` and `RTCPeerConnection` stay window-only.
  - The web.dev learn page that is cited (web-worker-overview) does not contain the list. Only `web.dev/articles/off-main-thread` (last updated 2019-12-05) has it.
  - The status claims are all correct: module workers newly 2023-06-06 and widely 2025-12-06; `options_type_parameter` Chrome 80, Firefox 114, Safari 15. LoAF gives no worker attribution, as the LoAF doc confirms.
- Evidence: https://web.dev/articles/off-main-thread ; https://web.dev/learn/performance/web-worker-overview ; BCD `api.WorkerNavigator.usb`, `api.RTCDataChannel.transferable`, `api.Worker.Worker.options_type_parameter` ; web-features `js-modules-workers`

### Start workers once and reuse them; size pools from hardwareConcurrency
- Verdict: verified
- Evidence:
  - HTML spec: "relatively heavy-weight, and are not intended to be used in large numbers … expected to be long-lived, have a high start-up performance cost, and a high per-instance memory cost".
  - HTML spec on `hardwareConcurrency`: "using lower values only in cases where there are user-agent specific limits … or when the user agent desires to limit fingerprinting".
  - web-features `hardware-concurrency`: low 2022-03-14, high 2024-09-14.
  - https://html.spec.whatwg.org/multipage/workers.html

### Keep each postMessage payload small; send deltas, not whole state
- Verdict: verified
- Note: One problem is in the example, not in the claims. `requestAnimationFrame` in a worker pauses in hidden tabs, as MDN says. The `pending` array then grows without a limit while the tab is hidden. Put a cap on it, or flush with a timer when the tab is hidden. This is inferred from the MDN rAF text.
- Evidence:
  - Surma (2019-07-15): "Both Chrome and Safari defer running StructuredDeserialize() until you actually access the .data property … Firefox … deserializes before dispatching". Budgets: 100 KiB for a 100 ms budget and 10 KiB for animations. JSON.stringify gives "no clear winner".
  - web.dev: "you shouldn't break your performance budget if your object's stringified JSON representation is less than 10 KB".
  - https://surma.dev/things/is-postmessage-slow/ ; https://web.dev/articles/off-main-thread ; https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope/requestAnimationFrame

### Transfer ArrayBuffers instead of copying them
- Verdict: verified
- Evidence:
  - The MDN "Supported objects" list matches the notes exactly (15 types).
  - MDN note: "Typed arrays … are serializable, but not transferable".
  - web-features `transferable-arraybuffer`: low 2024-03-05, high 2026-09-05.
  - web-features `resizable-buffers`: low 2024-07-09.
  - https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects

### Use structuredClone for deep copies and send only plain data across threads
- Verdict: verified
- Evidence:
  - MDN: "The lastIndex property of RegExp objects is not preserved". Also: "Class private elements are not duplicated", and functions and DOM nodes throw `DataCloneError`.
  - web-features `structured-clone`: low 2022-03-14, high 2024-09-14.
  - https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm

### Connect workers directly with MessageChannel, and transfer streams for continuous flows
- Verdict: verified
- Evidence:
  - The Safari 27 post: "the ability to transfer a ReadableStream, WritableStream and TransformStream across contexts via postMessage()".
  - BCD 8.1.2 and web-features 3.39.0 still show no Safari support for `transferable-streams`. The notes already say this.
  - https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ; BCD `api.ReadableStream.transferable`

### Use SharedArrayBuffer + Atomics only for hot shared-memory paths, gated on crossOriginIsolated
- Verdict: verified
- Evidence:
  - web-features `shared-memory`: low 2021-12-13, high 2024-06-13.
  - `atomics-wait-async`: low 2025-11-11 (Firefox 145).
  - `atomics-pause`: low 2025-04-01 (Chrome 133, Firefox 137, Safari 18.4).
  - Chrome 133 release notes about `Atomics.pause`.
  - https://developer.chrome.com/release-notes/133

### Turn on cross-origin isolation deliberately (COOP + COEP, or Document-Isolation-Policy)
- Verdict: corrected
- Correction:
  - "5 µs `performance.now()` resolution" is true only in Chromium.
    - Firefox clamps isolated contexts to 20 µs (`RFP_TIMER_UNCONDITIONAL_VALUE 20`, used when the caller type is `CrossOriginIsolated`). Non-isolated contexts get the 1000 µs pref value with jitter.
    - WebKit uses `timePrecision { 1_ms }` by default, and `highTimePrecision()` = 20 µs after `allowHighPrecisionTime()`.
    - MDN's generic "5 µs isolated / 100 µs non-isolated" describes Chromium.
  - The rest is correct:
    - COOP/COEP: Chrome 83, Firefox 79, Safari 15.2.
    - COEP `credentialless`: Chrome 96, Firefox 119, not in Safari.
    - `crossOriginIsolated`: Chrome 87, Firefox 72, Safari 15.2.
    - DIP ships on desktop from 137 and on Android from 146 (chromestatus stages).
    - Add: Mozilla's standards position on DIP is "Positive" and WebKit's is "Negative" (chromestatus). Do not expect DIP outside Chromium soon.
- Evidence: https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/resistfingerprinting/nsRFPService.cpp ; https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Performance.cpp ; https://github.com/WebKit/WebKit/blob/main/Source/WTF/wtf/Seconds.h ; https://chromestatus.com/feature/5141940204208128 ; BCD `http.headers.Cross-Origin-Embedder-Policy.credentialless`

### Share one connection and one cache across tabs with a SharedWorker
- Verdict: verified
- Evidence:
  - Chrome 148 release notes: "SharedWorker on Android" and "Extended lifetime shared workers" both shipped.
  - Chrome blog: "30 seconds for Chrome". The origin trial started in Chrome 139, and the feature shipped in 148.
  - Firefox bug 1177621 ("Do not share a SharedWorker between a private and a non-private document").
  - web-features `shared-workers` and `js-modules-shared-workers`: low 2026-05-05.
  - https://developer.chrome.com/release-notes/148 ; https://developer.chrome.com/blog/extended-lifetime-shared-workers-origin-trial ; https://bugzilla.mozilla.org/show_bug.cgi?id=1177621

### Elect one tab with Web Locks and fan results out with BroadcastChannel
- Verdict: verified
- Evidence:
  - web-features `web-locks` and `broadcast-channel`: low 2022-03-14, high 2024-09-14.
  - https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API

### Keep the service worker off the critical path: no no-op fetch handlers, use static routes
- Verdict: verified
- Evidence:
  - chromestatus 5136946693668864 "Skip service worker no-op fetch handler": enabled by default in 115.
  - chromestatus 5185352976826368: static routing ships in 123.
  - BCD `api.InstallEvent.addRoutes`: Chrome 123, Safari 27, no Firefox.
  - The MDN example uses lowercase `requestMethod: "post"`.
  - web.dev: boot time is "usually around 50ms. On mobile … 250ms … can be over 500ms".
  - The Safari 27 post also fixes "Service Worker routes were not matched when no fetch event handler was set".
  - https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes ; https://web.dev/blog/navigation-preload

### Enable navigation preload when navigations go to the network
- Verdict: verified
- Evidence:
  - web.dev: "If you use fetch(event.request) instead of event.preloadResponse, you'll end up with double requests for navigations". It also says boot-up is not a problem for cache responses.
  - BCD `api.NavigationPreloadManager`: Chrome 59, Firefox 99, Safari 15.4.
  - https://web.dev/blog/navigation-preload

### Do not fill Cache Storage with opaque responses; bound runtime caches
- Verdict: verified
- Evidence:
  - Workbox docs: "the minimum size that any single cached opaque response contributes to the overall storage used is approximately 7 megabytes".
  - https://developer.chrome.com/docs/workbox/caching-resources-during-runtime

### Render canvases from a worker with OffscreenCanvas when the renderer supports it
- Verdict: corrected
- Correction: The WebGPU-in-OffscreenCanvas status is simplified too much. BCD 8.1.2 gives these values:
  - Chrome 113–143: partial (ChromeOS, macOS and Windows only).
  - Chrome 144: full, which adds Linux, but only on Intel Gen12+ GPUs.
  - Chrome Android: 121.
  - Firefox 141: partial, Windows only.
  - Safari 26.
- The other claims are correct: OffscreenCanvas newly 2023-03-27, widely 2025-09-27; WebGL/WebGL2 contexts Safari 17; rAF in workers widely 2025-09-27.
- Evidence: BCD `api.OffscreenCanvas.getContext.webgpu_context`, `...webgl_context`, `...webgl2_context` ; web-features `offscreen-canvas`, `request-animation-frame-workers`

### Decode images off the main thread with createImageBitmap(blob), and close() them
- Verdict: corrected
- Correction:
  - `imageOrientation` values are `from-image` | `flipY`. The HTML spec IDL is `enum ImageOrientation { "from-image", "flipY" }`.
  - BCD lists `none` as supported by no browser. `from-image` is supported in Chrome 112, Firefox 111 and Safari 16.
  - Remove `none` from the list. 12-canvas2d-and-images.md already says "do not pass it".
  - The other enums match the spec: `premultiplyAlpha` `none` | `premultiply` | `default`; `colorSpaceConversion` `none` | `default`; `resizeQuality` `pixelated` | `low` | `medium` | `high`.
  - The "in parallel" Blob read is confirmed. Statuses are correct: newly 2023-12-11, widely 2026-06-11; `resizeQuality` Firefox 149; `decode()` Chrome 64, Firefox 68, Safari 11.1.
- Evidence: https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html ; BCD `api.createImageBitmap.options_imageOrientation_parameter.none` / `.from-image`

### Size canvases from ResizeObserver, preferring device-pixel-content-box
- Verdict: verified
- Evidence:
  - BCD `api.ResizeObserverEntry.devicePixelContentBoxSize`: Chrome 84, Firefox 108 (93–107 partial because of a snapping bug), no Safari.
  - web-features `resize-observer`: high 2023-01-28.
  - https://web.dev/articles/device-pixel-content-box

### Replace scroll/resize polling with IntersectionObserver, and pause off-screen charts
- Verdict: verified
- Evidence:
  - MDN: "clamped to 100 or greater if trackVisibility is true … this is a computationally intensive operation".
  - BCD `scrollMargin`: Chrome 120, Firefox 141, Safari 26.
  - `trackVisibility` and `delay`: Chromium only, experimental.
  - https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver/delay

### Scope MutationObserver narrowly and keep its callback cheap
- Verdict: verified
- Evidence:
  - The DOM spec defines the observer's node list as a list of weak references, and records are delivered in a microtask.
  - web-features `mutationobserver`: high 2018-01-29.
  - https://dom.spec.whatwg.org/

### Stop render loops and polling while the page is hidden; resync on return
- Verdict: corrected
- Correction:
  - Chromium `main` sets two grace periods: `kIntensiveWakeUpThrottling_GracePeriodSeconds_Default = 5 * 60` and `kIntensiveWakeUpThrottling_GracePeriodSecondsLoaded_Default = 60`.
  - `GetIntensiveWakeUpThrottlingGracePeriod(loading)` returns 60 s when the page is not loading and no enterprise policy overrides it.
  - So a hidden page that finished loading gets intensive throttling after 1 minute: 1 wake-up per minute for chained timers (chain ≥ 5), with 30 s of silence and no WebRTC. The 5-minute value applies only to pages that are still loading.
  - Also, the 1-second alignment of hidden-page timers starts after about 10 s hidden (verify/06).
  - Same finding as verify/06.
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/scheduler/common/features.h (lines 40–41) ; raw/verify/06/features-renderer.cc (lines 66–84) ; https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API

### Save state on visibilitychange→hidden; never register unload
- Verdict: corrected
- Correction:
  - The rollout table confirms "Milestone 152 Aug 25, 2026 … 80". Chrome 154 became stable on 2026-09-22, so the 100% step is now done, not "planned". The page says "Version numbers and dates are subject to change".
  - The Chrome deprecation works by "changing the default so that unload handlers stop firing on pages unless a page explicitly opts in".
  - So "blocks bfcache in … Chrome desktop" is stale for Chrome 154+. It still holds in Firefox desktop, and in Chrome pages that opt back in (Permissions-Policy `unload=(self)` or the enterprise policy `ForcePermissionPolicyUnloadDefaultEnabled`).
  - Update line 920 in the Deprecated list the same way.
- Evidence: https://developer.chrome.com/docs/web-platform/deprecating-unload (last updated 2026-07-14; saved copy raw/js-web-apis/chrome-deprecating-unload.txt lines 20–23, 76–127) ; https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=154 ; BCD `api.Window.beforeunload_event` (safari_ios false)

### Keep pages bfcache-eligible: close shared connections in pagehide, reopen on pageshow
- Verdict: verified
- Note: Chrome 149+ does more than stop blocking bfcache on WebSockets. It disconnects the active WebSockets itself when the page enters bfcache, so `pageshow` must always reconnect. The enterprise policy `BackForwardCacheForWebSocketsAllowed` = Disabled restores the old blocking behavior on managed desktops.
- Evidence:
  - web.dev (last updated 2026-09-03): "Chrome (as of 149) and Safari do no block on open WebSockets but other browsers do".
  - chromestatus 5068439115923456: "active WebSockets are now disconnected when a page is cached".
  - BCD `notRestoredReasons`: Chrome 125 only.
  - https://web.dev/articles/bfcache ; https://chromestatus.com/feature/5068439115923456

### Handle freeze, resume, and discards (Chromium)
- Verdict: verified
- Evidence: BCD `api.Document.freeze_event`, `resume_event` and `wasDiscarded` are Chrome 68 only and experimental. web-features `page-lifecycle` is not Baseline.

### Lower the fetch priority of background requests
- Verdict: verified
- Evidence:
  - web.dev: "If you use the JavaScript fetch() API … the browser assigns it High priority".
  - web-features `fetch-priority`: low 2024-10-29 (Firefox 132).
  - https://web.dev/articles/fetch-priority

### Cancel superseded work with AbortController, AbortSignal.timeout, and AbortSignal.any
- Verdict: verified
- Evidence:
  - web-features `abortsignal-any`: low 2024-03-19. Its 30-month widely date is 2026-09-19, which falls after the 2026-09-17 data release.
  - `abortsignal-timeout`: low 2024-04-18.
  - `aborting`: high 2021-09-25.

### Consume large or long responses as streams with backpressure
- Verdict: verified
- Evidence:
  - web-features `streams`: high 2024-12-28.
  - `readable-byte-streams`: low 2026-03-24.
  - `async-iterable-streams`: low 2026-09-14.
  - `readablestream-from`: Firefox 117 and Safari 27, no Chromium. chromestatus has no shipping entry for it.
  - MDN `tee()` and `Response.clone()` pages.

### Use CompressionStream / DecompressionStream instead of JS compression libraries
- Verdict: verified
- Evidence:
  - BCD `CompressionStream.brotli`: Firefox 147 and Safari 18.4, no Chrome.
  - `zstd`: Firefox 138 behind a flag only.
  - `deflate-raw`: Chrome 103, Firefox 113, Safari 16.4.
  - A 2026-06-08 BCD issue that claimed Chrome brotli/zstd support mixed this up with HTTP content-encoding. It was "Closed as not planned".
  - web-features `compression-streams`: high 2025-11-09.
  - https://github.com/mdn/browser-compat-data/issues/29824

### Apply backpressure to real-time sockets; parse feeds off the main thread
- Verdict: verified
- Evidence:
  - BCD `api.WebSocketStream`: Chrome 124 only, experimental, `standard_track: false`.
  - web-features `webtransport`: low 2026-03-24 (Safari 26.4).
  - https://developer.chrome.com/docs/capabilities/web-apis/websocketstream

### Send end-of-session data with keepalive / sendBeacon (or fetchLater), never with blocking work
- Verdict: corrected
- Correction:
  - `fetchLater` sends when the page is destroyed or **enters** bfcache, or when `activateAfter` expires, whichever comes first. It does not wait for bfcache eviction. MDN: "sent once the page is navigated away from (it is destroyed or enters the bfcache)". chromestatus: "all pending requests will be flushed upon document entering bfcache".
  - The keepalive limit is 64 KiB for the sum of all in-flight keepalive request bodies in the fetch group, not 64 KiB per body. The Fetch spec: "If the sum of contentLength and inflightKeepaliveBytes is greater than 64 kibibytes, then return a network error".
  - The `fetchLater` quotas are correct: 640 KiB per top-level document (512 KiB top-level plus 128 KiB for cross-origin subframes, 8 KiB each by default), and 64 KiB per reporting origin. The size includes the URL and headers.
  - Statuses are correct: `fetchLater` Chrome 135; `keepalive` Chrome 66, Safari 13, Firefox 133.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/Window/fetchLater ; https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Deferred_Fetch ; https://fetch.spec.whatwg.org/ ; https://chromestatus.com/feature/4654499737632768

### Keep localStorage and sessionStorage off hot paths
- Verdict: verified
- Evidence:
  - web.dev: "synchronous and will block the main thread. It is limited to about 5MB and can contain only strings … not accessible from web workers or service workers".
  - https://web.dev/articles/storage-for-the-web

### Write IndexedDB in small records and batched transactions; read with getAll ranges
- Verdict: verified
- Note: The exact numbers from Nolan Lawson's pagination test (batch size 100, 50,000 items) are Chrome −41%, Firefox −23%, Safari −95%. The notes' "20–50%+" is correct but loose. He also notes that "you cannot build a paginated cursor in descending order". Chrome 141 fixes this with `direction` on `getAll()`/`getAllKeys()`/`getAllRecords()` (see Missing).
- Evidence:
  - Chrome blog: "changing from strict to relaxed from Chrome 121". Speed-ups were "between a factor of 3 and 30", and other browsers already use `relaxed`.
  - web.dev: "the structured cloning process happens on the main thread".
  - BCD `getAllRecords`: Chrome 141, Firefox 153, Safari preview.
  - The 350 ms figure appears in Chrome 141 search snippets.
  - https://developer.chrome.com/blog/indexeddb-durability-mode-now-defaults-to-relaxed ; https://nolanlawson.com/2021/08/22/speeding-up-indexeddb-reads-and-writes/ ; https://developer.chrome.com/release-notes/141

### Use OPFS synchronous access handles in a worker for large binary data
- Verdict: corrected
- Correction:
  - "One sync handle per file at a time (exclusive lock)" is only the default and the standard behavior.
  - Chromium 121+ accepts `createSyncAccessHandle({ mode })`:
    - `'readwrite'`: exclusive, the default.
    - `'read-only'`: many readers.
    - `'readwrite-unsafe'`: many writers, no lock.
  - BCD marks `mode` as Chrome 121, experimental and non-standard; it is not in Firefox or Safari.
  - Statuses are correct: Chrome 102 (Android 109), Firefox 111, Safari 15.2; OPFS widely 2025-09-27.
- Evidence: BCD `api.FileSystemFileHandle.createSyncAccessHandle.mode` ; https://web.dev/articles/origin-private-file-system

### Check quota and request persistence before caching large datasets
- Verdict: corrected
- Correction:
  - web.dev gives only one exemption from Safari's 7-day deletion: "This eviction policy does not apply to installed PWAs that have been added to the home screen". Remove "or has persistent storage".
  - WebKit's storage-policy post says that persistent mode excludes an origin from eviction under storage pressure. It does not say that persistent mode protects against the ITP no-interaction deletion. WebKit also grants `persist()` "based on heuristics like whether the website is opened as a Home Screen Web App".
  - Useful numbers from the same post: origin quota is up to 60% of disk for a browser app and 15% for other apps; cross-origin frames get 10% of the main-frame quota; eviction is LRU by origin.
  - Storage manager status is correct: low 2023-09-18, high 2026-03-18.
- Evidence: https://web.dev/articles/storage-for-the-web ; https://webkit.org/blog/14403/updates-to-storage-policy/

### Tie every listener, timer, observer, and subscription to one teardown AbortSignal
- Verdict: verified
- Evidence: BCD `api.EventTarget.addEventListener.options_parameter.options_signal_parameter`: Chrome 90, Firefox 86, Safari 15. https://nolanlawson.com/2020/02/19/fixing-memory-leaks-in-web-applications/

### Drop references to removed DOM nodes; key element metadata by WeakMap
- Verdict: verified
- Evidence:
  - DevTools docs (updated 2024-11-06): "Type Detached in the Class filter", and "The Detached elements profile shows you detached elements".
  - https://developer.chrome.com/docs/devtools/memory-problems

### Use WeakRef and FinalizationRegistry only for optional caches and backstops
- Verdict: verified
- Evidence: web-features `weak-references`: low 2021-04-26, high 2023-10-26. See the MDN WeakRef and FinalizationRegistry pages.

### Release large native-backed objects explicitly
- Verdict: verified
- Evidence:
  - BCD `api.VideoFrame.close`: Chrome 94, Firefox 130, Safari 16.4.
  - `api.ImageBitmap.close`: widely available.
  - `URL.createObjectURL` notes: it is not available in a service worker.

### Clear User Timing and Resource Timing buffers in long-lived sessions
- Verdict: verified
- Evidence:
  - The W3C registry table has `mark`, `measure` and `navigation` at Infinite and `resource` at 250.
  - BCD `clearResourceTimings`: Chrome 46, Firefox 35, Safari 11.
  - https://w3c.github.io/timing-entrytypes-registry/

### Measure field memory with performance.measureUserAgentSpecificMemory(), not performance.memory
- Verdict: verified
- Evidence:
  - web.dev: a Poisson process with a 5-minute mean. "Calling the API forces a garbage collection after some timeout, which is currently set to 20 seconds". The result covers "JavaScript and DOM memory of all iframes, related windows, and web workers in the current process".
  - BCD: `measureUserAgentSpecificMemory` is Chrome 89 and experimental. `performance.memory` is deprecated and non-standard.
  - https://web.dev/articles/monitor-total-page-memory-usage

### Time code with performance.now(), not Date.now()
- Verdict: corrected
- Correction:
  - Replace "coarsened to 100 µs normally and 5 µs when cross-origin isolated" with per-engine values:
    - Chromium: 100 µs, or 5 µs when isolated (MDN).
    - Firefox: 1 ms plus jitter by default (`privacy.resistFingerprinting.reduceTimerPrecision.microseconds = 1000`, `privacy.reduceTimerPrecision = true`), or 20 µs when isolated.
    - WebKit: 1 ms by default, or 20 µs in high-precision mode.
  - The sleep claim is correct as MDN states it: "only browsers on Windows keep ticking during sleep".
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/Performance/now ; raw/verify/06/ff-StaticPrefList.yaml (lines 18216–18316) ; raw/verify/07/nsRFPService.cpp (lines 121, 548–555, 885–905) ; raw/verify/07/wk-Performance.cpp (lines 73, 179–182) ; https://github.com/WebKit/WebKit/blob/main/Source/WTF/wtf/Seconds.h

### Mark app phases with User Timing; show them as DevTools custom tracks
- Verdict: verified
- Evidence:
  - DevTools reference: `dataType?: "track-entry"; // Defaults to "track-entry"`, so the example without `dataType` is valid.
  - The color list matches.
  - `console.timeStamp` is "designed for minimal runtime overhead … does not add entries to the browser's internal performance timeline".
  - BCD `PerformanceMark.detail`: Chrome 78, Firefox 101, Safari 14.1. `PerformanceMeasure.detail`: Firefox 103.
  - https://developer.chrome.com/docs/devtools/performance/extension

### Register PerformanceObservers early with type + buffered: true, and feature-detect entry types
- Verdict: verified
- Evidence:
  - The W3C registry values match the notes: first-input 1, paint 2, soft-navigation 50, visibility-state 50, element/event/LCP/layout-shift/interaction-contentful-paint 150, longtask/long-animation-frame 200, resource 250.
  - The registry also lists `container` at 150.
  - BCD `supportedEntryTypes`: Chrome 73, Firefox 68, Safari 13.
  - https://w3c.github.io/timing-entrytypes-registry/

### Collect Core Web Vitals in the field with web-vitals v6 (attribution build)
- Verdict: verified
- Evidence:
  - npm `latest` = 6.2.2 (2026-09-14).
  - README: "~3K, brotli'd", and the attribution build is larger "by about 1.5K, brotli'd".
  - `reportSoftNavs` targets "Chromium-based browsers on version 151+", and `onCLS()` is Chromium only.
  - CHANGELOG v6.0.0: "Add Soft Navigation support" and "Add bfcache support for reporting small INP interactions".
  - BCD `interactionCount`: Chrome 144, Firefox 144, Safari 26.2.
  - https://github.com/GoogleChrome/web-vitals

### Diagnose slow interactions and frames with Event Timing and Long Animation Frames
- Verdict: verified
- Evidence:
  - The LoAF doc confirms the 50 ms threshold, the `blockingDuration` definition, script attribution over 5 ms, and that there is no attribution for workers, cross-origin iframes or extensions.
  - Chrome 148 notes: "Add styleDuration and forcedStyleDuration" is in an origin trial.
  - BCD `interactionId`: Chrome 96, Firefox 144, Safari 26.2.
  - https://developer.chrome.com/docs/web-platform/long-animation-frames ; https://developer.chrome.com/release-notes/148

### Time your own key elements with Element Timing (Chromium)
- Verdict: corrected
- Correction:
  - "`renderTime` is 0 for cross-origin images without `Timing-Allow-Origin`" is stale.
  - Since Chrome 133, element-timing and LCP entries have a non-zero `renderTime` without TAO. It is coarsened to a 4 ms multiple when the document is not cross-origin isolated.
  - BCD `api.PerformanceElementTiming.renderTime.cross-origin` is Chrome 133.
  - Keep sending TAO when you need exact values.
  - Container Timing is in origin trial in Chrome 148, which is correct.
- Evidence: https://developer.chrome.com/release-notes/133 ; https://chromestatus.com/feature/5128261284397056 ; https://developer.mozilla.org/en-US/docs/Web/API/PerformanceElementTiming/renderTime

### Break down network time with Navigation, Resource, and Server Timing
- Verdict: corrected
- Correction:
  - `contentType` is Chrome 148 **and Firefox 129**, not Safari (BCD `api.PerformanceResourceTiming.contentType`).
  - `transferSize === 0` also happens for cross-origin resources without TAO, so do not count those as cache hits.
  - The other statuses match BCD and web-features: navigation widely 2024-04-25; server-timing widely 2025-09-27; `renderBlockingStatus` 107; `deliveryType` Chrome 117 and Safari 26.4; `confidence` Chrome 145.
- Evidence: BCD `api.PerformanceResourceTiming.contentType` ; https://developer.chrome.com/release-notes/148

### Make SPA route changes measurable as soft navigations
- Verdict: verified
- Evidence:
  - Chrome doc (updated 2026-09-02): "initiated by a user action … visible URL change … visible paint". It is on by default from Chrome 151, and LCP, INP and CLS reset.
  - The registry gives `soft-navigation` 50.
  - https://developer.chrome.com/docs/web-platform/soft-navigations

### Sample field CPU profiles with the JS Self-Profiling API (Chromium)
- Verdict: verified
- Evidence: BCD `api.Profiler` is Chrome 94 and experimental. web-features `profiler` is Chromium only. https://developer.mozilla.org/en-US/docs/Web/API/JS_Self-Profiling_API

### Adapt heavy features to device class, and treat "unknown" as mid-range
- Verdict: corrected
- Correction:
  - Add the Chrome 147 buckets:
    - Desktop reports 2, 4, 8, 16 or 32.
    - Android reports 1, 2, 4 or 8.
    - Before 147, all platforms reported 0.25–8.
  - The same change applies to `Sec-CH-Device-Memory` and to the deprecated `Device-Memory` header.
  - On desktop, 2 is now the floor, so `mem <= 2` matches only the smallest desktops.
  - `Sec-CH-Device-Memory` needs an `Accept-CH` opt-in.
  - `cpuPerformance` is correct: IDL `[SecureContext, Exposed=Window] … unsigned short cpuPerformance`; tier mapping 1 / 2–4 / 5–10 / 11+ cores with ±1; the user override is "Settings > Performance > Speed > Override CPU performance tier", plus the enterprise policy `CpuPerformanceTierOverride`.
- Evidence: BCD `api.Navigator.deviceMemory` notes ("From Chrome 147, reported values are 2, 4, 8, 16, and 32" / Android "1, 2, 4, and 8") ; https://wicg.github.io/cpu-performance/ ; https://chromestatus.com/feature/5189864286978048

### Respect Save-Data and slow connections (Chromium signal)
- Verdict: verified
- Evidence: BCD `NetworkInformation.effectiveType`: Chrome 61 (Android 38). `saveData`: Chrome 65. The `Save-Data` header: Chrome 49. There is no Firefox or Safari support.

### React to live CPU pressure with the Compute Pressure API
- Verdict: verified
- Note: "Only source today is `cpu`" is true for implementations. The spec also defines `"thermals"`, so check `PressureObserver.knownSources` (MDN).
- Evidence:
  - MDN confirms the state definitions and the contexts: Window, Worker and SharedWorker, not service workers.
  - MDN confirms `compute-pressure` with default `'self'`.
  - BCD `api.PressureObserver`: Chrome 125 desktop, no Android.
  - https://developer.mozilla.org/en-US/docs/Web/API/Compute_Pressure_API

### Use WebAssembly for measured CPU-bound kernels, not by default
- Verdict: corrected
- Correction:
  - "no deopts" is stale. V8 shipped Wasm deoptimization with speculative `call_indirect` inlining in Chrome 137 (2025-06-24 post). Wasm is still more predictable than JS, but optimized Wasm can now deoptimize.
  - "Liftoff code is fast from the first call" should say that V8 compiles each function lazily with Liftoff on its first call. That first call pays a small compile cost. After that, hot functions tier up to TurboFan in the background, and there is no on-stack replacement.
- Evidence: https://v8.dev/blog/wasm-speculative-optimizations ; https://v8.dev/docs/wasm-compilation-pipeline ; 08-v8-batch-07.md:552,606

### Cross the JS↔Wasm boundary rarely and in bulk
- Verdict: corrected
- Correction:
  - JS String Builtins: Chrome 130, Firefox 134, Safari 26.2 for `compile()`/`instantiate()`.
  - Safari accepts the `{ builtins: ['js-string'] }` options on `compileStreaming()`/`instantiateStreaming()` only from **Safari 26.6**. This matters because the next item recommends the streaming path.
  - web-features 3.39.0 still marks `wasm-string-builtins` as not Baseline, with no Safari entry. BCD has Safari 26.2.
- Evidence: https://webkit.org/blog/18178/webkit-features-for-safari-26-6/ ; https://webkit.org/blog/17640/webkit-features-for-safari-26-2/ ; BCD `webassembly.jsStringBuiltins`

### Load Wasm with instantiateStreaming and keep the module URL stable
- Verdict: corrected
- Correction:
  - The 128 kB module-size threshold (2019) is obsolete. With dynamic tiering, Chrome caches only TurboFan code, and "Code caching gets triggered whenever the amount of generated TurboFan code reaches a certain threshold". Small or cold modules may never be cached.
  - Liftoff code is never cached.
  - The URL-stability and 304 advice is still correct: "changing the URL of a resource (including any query parameters!) creates a new entry".
- Evidence: https://v8.dev/docs/wasm-compilation-pipeline ; https://v8.dev/blog/wasm-code-caching ; 08-v8-batch-04.md:60–69

### Use Wasm SIMD freely; use Wasm threads only under isolation with a pre-started pool
- Verdict: verified
- Evidence:
  - web-features: `wasm-simd` high 2025-09-27; `wasm-threads` high 2024-06-13; `wasm-simd-relaxed` Chrome 114 and Firefox 146; `wasm-memory64` Chrome 133 and Firefox 134 (Safari preview only for both); `wasm-jspi` low 2026-09-14; `wasm-garbage-collection` low 2024-12-11.
  - web.dev: "pthread_create only schedules a new Worker … pthread_join immediately blocks the event loop".
  - https://web.dev/articles/webassembly-threads

### Yield inside long main-thread tasks (details in the event-loop notes)
- Verdict: verified
- Evidence:
  - BCD `api.Scheduler.yield`: Chrome 129, Firefox 142. `postTask`: Chrome 94, Firefox 142. Neither is in Safari.
  - `requestIdleCallback`: Safari preview behind a flag.
  - web-features `is-input-pending` is discouraged.

---

## Cross-file conflicts

1. **Intensive timer throttling trigger.**
   - 07:354 says "after 5 minutes hidden". 06 says the same.
   - Chromium `main` uses 60 s for pages that finished loading. verify/06 already flagged both files.
   - Use "1 minute (loaded pages), 5 minutes (still loading)".
2. **`fetchLater` send trigger.**
   - 07:508 says "at page destroy/bfcache eviction".
   - 04-html-and-http-loading-features.md:740 and MDN say "destroyed or enters bfcache".
   - 04 is correct.
3. **`unload` and bfcache.**
   - 07:373 says `unload` "blocks bfcache in Firefox and Chrome desktop" and "100% planned at M154".
   - 03-course-js-and-vitals.md:935 says "Firefox desktop".
   - 15-gaps-round-1.md:106 says "Chrome 154+ does not run `unload` by default".
   - 03 and 15 are current; 07 is stale.
4. **Element Timing `renderTime` without TAO.**
   - 07:756 says 0.
   - 15-gaps-round-2.md:63 and 16-explore-fast-batch-04.md:140 say coarsened since Chrome 133.
   - 16-explore-fast-batch-04 cites LCP BCD (Chrome 133, Firefox 141, Safari 26.2). For Element Timing, only Chrome 133 applies, because the API is Chromium-only.
5. **`deviceMemory` buckets.**
   - 07:803/812/813 lack the Chrome 147 change.
   - 15-gaps-round-2.md:30–55 has it.
6. **Worker API list.**
   - 07:26 ("WebUSB, WebRTC, Web Audio main-thread-only") conflicts with 07:74 (`RTCDataChannel` is transferable).
   - It also conflicts with 15-gaps-round-2.md:62.
7. **`imageOrientation` values.**
   - 07:287 lists `none`.
   - 12-canvas2d-and-images.md:520 says `none` was renamed to `from-image` and must not be passed. 12 is correct.
8. **Wasm deopts.**
   - 07:855 says "no deopts".
   - 08-v8-batch-07.md:552 and :606 say Wasm deopts are on by default since Chrome 137. 08 is correct.
9. **Wasm code-cache threshold.**
   - 07:886 still frames caching around "128 kB".
   - 08-v8-batch-04.md:60–69 marks the 128 kB rule OBSOLETE and gives the current top-tier trigger. 08 is correct.
10. **Version header.**
    - 07:4 says "Chrome 153 / Safari 27 era".
    - Chrome 154 is stable since 2026-09-22 (15-gaps-round-1.md:106, 15-gaps-round-2.md:67).
11. **No conflict found** for these topics: OffscreenCanvas status (01:969, 03:356, 10:228 agree), SharedWorker Baseline date (15-gaps-round-1:403 agrees), WebSocketStream (15-gaps-round-1:363 agrees), Compute Pressure (15-gaps-round-1:422 agrees) and `durationThreshold` (16-explore-fast-batch-02:79 agrees).

## Missing but important

1. **Chrome freezes hidden, CPU-heavy tabs on Energy Saver (Chrome 133+).**
   - A browsing context group that is hidden and silent for more than 5 minutes and uses a lot of CPU is frozen. All tasks stop, including WebSocket handling.
   - There is an opt-out origin trial (`BackgroundPageFreezeOptOut`).
   - This matters for always-open trading tabs.
   - Found by verify/06. I did not read it again today.
   - Source: https://developer.chrome.com/blog/freezing-on-energy-saver ; https://chromestatus.com/feature/5158599457767424
2. **Chrome 149 disconnects WebSockets on bfcache entry.**
   - The app must reconnect in `pageshow` even if it did not close the socket.
   - Managed desktops can keep the old behavior with `BackForwardCacheForWebSocketsAllowed`.
   - Source: https://chromestatus.com/feature/5068439115923456
3. **IndexedDB `getAll()`/`getAllKeys()` options object with `direction` (Chrome 141).**
   - It gives descending pages without cursors, which removes Nolan Lawson's "no descending pagination" limit.
   - Source: BCD `api.IDBObjectStore.getAll.object_parameter` (Chrome 141, experimental) ; https://developer.chrome.com/release-notes/141
4. **Transfer an `RTCDataChannel` to a worker** (Chrome 130, Firefox 144, Safari 15).
   - A WebRTC data feed can then be received and parsed off the main thread.
   - Source: BCD `api.RTCDataChannel.transferable`
5. **`paintTime` / `presentationTime` on LCP, Element Timing and LoAF entries** (Chrome 145; LCP `paintTime` also in Firefox 140 and Safari 26.2).
   - They split "render done" from "pixels on screen" in RUM.
   - Source: BCD `api.LargestContentfulPaint.paintTime`, `api.PerformanceLongAnimationFrameTiming.paintTime` ; https://chromestatus.com/feature/5162859838046208
6. **Storage Buckets API** (Chrome 122, experimental).
   - It gives separate buckets, each with its own `durability`, `persisted` setting and quota. For example, a strict bucket for user layouts and a relaxed, evictable bucket for tick history.
   - Source: BCD `api.StorageBucketManager` ; web-features `storage-buckets`
7. **Permission and opt-in controls for the Chrome-only levers in this file.**
   - Examples: `IntensiveWakeUpThrottlingEnabled`, `ForcePermissionPolicyUnloadDefaultEnabled`, `CpuPerformanceTierOverride`.
   - Enterprise deployments of a trading terminal can pin these behaviors.
   - Source: https://chromeenterprise.google/policies/intensive-wake-up-throttling-enabled/ ; https://developer.chrome.com/docs/web-platform/deprecating-unload ; https://chromestatus.com/feature/5189864286978048
8. **`ImageDecoder` (WebCodecs)** for frame-level decode in a worker, with control over animated images.
   - Status: Chrome 94, Firefox 133, Safari preview only.
   - It complements `createImageBitmap` when you need per-frame decode or progressive decode.
   - Source: BCD `api.ImageDecoder`
