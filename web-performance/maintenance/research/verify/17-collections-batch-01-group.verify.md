# Verify: 17-collections-batch-01.md, 17-collections-batch-02.md

Checked on 2026-09-23.

## Summary counts

| File | Items | Verified | Corrected | Disputed | Unverified |
|---|---|---|---|---|---|
| 17-collections-batch-01.md | 22 | 13 | 9 | 0 | 0 |
| 17-collections-batch-02.md | 26 | 19 | 7 | 0 | 0 |
| Total | 48 | 32 | 16 | 0 | 0 |

## Method and data

- Status data: MDN BCD 8.1.2 (2026-09-17, the current npm `latest`) and web-features 3.39.0 (the current npm `latest`). I reused the copies in `raw/verify/02/` (`bcd.json`, `wf.json`) and the `q.py` helper, copied to `raw/verify/17a/q.py`.
- Browser release dates come from the BCD `browsers` data: Safari 27 on 2026-09-14, Chrome 149 on 2026-06-02, Chrome 152 on 2026-08-25, Chrome 153 (current) on 2026-09-08, Firefox 121 on 2023-12-19.
- Source files saved in `raw/verify/17a/`:
  - Workbox 7.4.1 sources from jsdelivr, in `wb/`.
  - Chromium `padding_key.cc`, `http_response_headers.cc` and `web_scheduler_tracked_feature.cc`.
  - Firefox `AnimationPerformanceWarning.h`, `layout_errors.properties` and `KeyframeEffect.cpp`.
- Other sources: GitHub releases API (Workbox), npm registry, Bugzilla REST (bugs 1540906, 1876321, 1623469, 1743310), and WebFetch of each cited article.
- Browser test: Chromium 152 (the Browser pane, at https://example.com, with test elements injected by script and no page state changed). The test checked two things:
  - Which events the reduced-motion reset fires.
  - Whether `Animation.finish()` works on an animation with infinite iterations.

---

## 17-collections-batch-01.md

### Choose one caching strategy per request class, by freshness need
- Verdict: verified
- Evidence:
  - The table in the article matches the notes. Network only: "Payments and checkouts", "Balance statements". Network falling back to cache: "Prices and rates (requires disclaimers)". Source: https://web.dev/articles/service-worker-caching-and-http-caching (last updated 2020-07-17).
  - The Offline Cookbook says "This can take an extremely long time and is a frustrating user experience". Source: https://web.dev/articles/offline-cookbook.
  - Service workers: web-features `service-workers` gives Baseline low 2018-04-30 and high 2020-10-30.
  - `Request.destination`: BCD gives Chrome 65, Firefox 61, Safari 10.1.
  - Workbox v7.4.1: GitHub release published 2026-05-05T08:33Z (tag created 2026-05-04T20:21Z). Source: https://api.github.com/repos/GoogleChrome/workbox/releases.

### Answer navigation requests from the service worker without waiting for the network
- Verdict: verified
- Evidence:
  - The article says "This is the single biggest performance win that comes from a service worker, versus what's possible with HTTP caching." Source: https://web.dev/articles/handling-navigation-requests (2020-07-13).
  - `denylist` wins. Workbox 7.4.1 `NavigationRoute.ts` says "If both `denylist` and `allowlist` are provided, the `denylist` will take precedence". Source: https://cdn.jsdelivr.net/npm/workbox-routing@7.4.1/src/NavigationRoute.ts.

### Enable navigation preload when navigations must go to the network, and always consume it
- Verdict: verified
- Evidence:
  - The article says "It's usually around 50ms. On mobile it's more like 250ms. In extreme cases (slow devices, CPU in distress) it can be over 500ms." It also warns that if you use `fetch(event.request)` instead, "you'll end up with double requests", and it describes `Vary: Service-Worker-Navigation-Preload`. Source: https://web.dev/blog/navigation-preload.
  - BCD for `NavigationPreloadManager` and `FetchEvent.preloadResponse`: Chrome 59, Firefox 99 (2022-04-05), Safari 15.4.
  - `workbox-navigation-preload` 7.4.1 is on npm and not deprecated.

### Declare static routes so the browser can skip service worker startup for requests the worker does not handle
- Verdict: verified
- Evidence:
  - MDN (modified 2026-07-04) lists these sources: `"cache"`, `"fetch-event"`, `"network"`, `"race-network-and-fetch-handler"`, `{cacheName}`.
  - MDN lists these conditions: `urlPattern`, `requestMethod`, `requestMode`, `requestDestination`, `runningStatus`, `or`, `not`.
  - MDN says "`or` cannot be combined with another condition type" (TypeError). A TypeError is also thrown for `"fetch-event"` when the worker has no fetch handler.
  - MDN says that for a missing cache or entry, "the browser defaults to using the network". Source: https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes.
  - BCD `api.InstallEvent.addRoutes`: Chrome 123, Safari 27, Firefox false.
  - web-features `service-workers-static-routes`: `baseline: false`.
  - Chrome blog: "From Chrome 123". Source: https://developer.chrome.com/blog/service-worker-static-routing.

### Give the service worker cache a longer lifetime than HTTP max-age, and bypass the HTTP cache when the worker revalidates
- Verdict: corrected
- Correction: The Avoid/caveats line says "the HTTP cache does not help offline". That is too broad. A fresh HTTP-cache entry (inside its `max-age`) is reused without a network request, so it also loads when the device is offline. The correct statement: only the service worker can answer navigations, serve stale entries, or return a fallback when the network is down. You also cannot choose which HTTP-cache entries survive. Everything else in the item is correct:
  - The article's example is 90 days (service worker) against 30 days (HTTP).
  - The lookup order is service worker cache, then HTTP cache, then server. The article notes that some browsers have a memory cache.
- Evidence:
  - https://web.dev/articles/service-worker-caching-and-http-caching
  - https://www.rfc-editor.org/rfc/rfc9111 (section 4.2: a fresh response can be reused without validation)

### Precache only the versioned app shell, from a build-generated manifest
- Verdict: corrected
- Correction: The Status line says "String manifest entries were deprecated in Workbox v5 and removed in v6". That is wrong. The docs say "In version 5 this is deprecated". But Workbox 7.4.1 still accepts strings:
  - `addToCacheList(entries: Array<PrecacheEntry | string>)`.
  - `createCacheKey()` treats a string as an already versioned URL.
  - Workbox only logs "Workbox is precaching URLs without revision info: … This is generally NOT safe."
  - Replacement text: "Deprecated since v5. Still accepted in v7.4.1, with a console warning. Always pass `{url, revision}`, and use `revision: null` for hashed URLs (no warning)."
  - One more detail: `cleanupOutdatedCaches()` only deletes precaches made by older *Workbox versions* ("clean up incompatible precaches that were created by older versions of Workbox"). It does not delete your old app revisions. The precache controller already does that on `activate`.
- Evidence:
  - https://developer.chrome.com/docs/workbox/modules/workbox-precaching
  - https://cdn.jsdelivr.net/npm/workbox-precaching@7.4.1/src/PrecacheController.ts (lines 125-185)
  - https://cdn.jsdelivr.net/npm/workbox-precaching@7.4.1/src/utils/createCacheKey.ts
- The other facts are verified:
  - Default `ignoreURLParametersMatching = [/^utm_/, /^fbclid$/]`, `directoryIndex = 'index.html'`, `cleanURLs = true` (`generateURLVariations.ts`).
  - "call it early … before registering any additional routes".
  - "Never hardcode revision info…"

### Register the service worker after the page has loaded
- Verdict: verified
- Evidence: The article says "Unless you change the URL of the service worker script, `navigator.serviceWorker.register()` is effectively a no-op during subsequent visits". It also gives the `clients.claim()` exception. Last updated 2016-11-28. Source: https://web.dev/articles/service-workers-registration.

### Keep install and activate handlers small; put only true dependencies in waitUntil
- Verdict: verified
- Note: BCD puts `Cache` at Chrome 40 (service workers only until Chrome 43) and `CacheStorage` at Chrome 43 (partial, service workers only, from Chrome 40). "Chrome 43" is correct for all contexts.
- Evidence: The Offline Cookbook says "During activation, events such as fetch are put into a queue, thus a long activation could block page loads." Source: https://web.dev/articles/offline-cookbook.

### Cap every runtime cache with expiration rules and separate cache names
- Verdict: corrected
- Correction: The Impact line says unbounded caches "make the origin a first target for eviction". That is wrong. Browsers evict whole origins in least-recently-used order, not by size. MDN says "Least Recently Used (LRU)". WebKit says "a least-recently-used policy", and it excludes origins with an active page or with persistent mode. A large cache makes storage pressure happen sooner. It does not move the origin to the front of the eviction queue. The rest is correct. `ExpirationPlugin` throws `expire-custom-caches-only` on the default runtime cache name. The docs say it "can only be used with registered routes using a strategy that has a configured cacheName".
- Evidence:
  - https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
  - https://webkit.org/blog/14403/updates-to-storage-policy/
  - https://cdn.jsdelivr.net/npm/workbox-expiration@7.4.1/src/ExpirationPlugin.ts
  - https://developer.chrome.com/docs/workbox/caching-resources-during-runtime

### Request CORS for cross-origin assets you cache, and do not cache opaque responses cache-first
- Verdict: verified
- Evidence:
  - Chromium main `storage/common/quota/padding_key.cc`: `constexpr uint64_t kPaddingRange = 14431 * 1024;`. The padding is `HMAC(...) % kPaddingRange`, so it is uniform over 0 to about 14.09 MiB, with a mean of about 7.05 MiB. `opaqueredirect` responses are padded too.
  - The Workbox doc still says "the minimum size … is approximately 7 megabytes", which is wrong.
  - Sources: https://chromium.googlesource.com/chromium/src/+/main/storage/common/quota/padding_key.cc, https://developer.chrome.com/docs/workbox/caching-resources-during-runtime
- Note (missing caveat): a `crossorigin` request without credentials and a normal credentialed request to the same CDN host do not share one connection. Mix the two modes, and the page can pay for a second connection. A `preconnect` must use the same `crossorigin` value as the requests it serves. Source: https://web.dev/articles/preconnect-and-dns-prefetch.

### Ask for persistent storage for offline-critical data, and check quota before large writes
- Verdict: corrected
- Correction: The Why line says "Cache Storage, IndexedDB, OPFS and localStorage share one origin quota". `localStorage` does not share it. MDN says Web Storage "is limited to 10 MiB of data maximum on all browsers", with 5 MiB for `localStorage` and 5 MiB for `sessionStorage` per origin. It throws `QuotaExceededError` on its own limit. The replacement text: "Cache Storage, IndexedDB and OPFS share the origin quota. `localStorage` has a separate 5 MiB limit, but Safari's 7-day rule deletes it too." The rest is correct:
  - WebKit gives 60% of disk per origin for browser apps and 15% for other apps.
  - WebKit grants persistence "based on whether the website is opened as a Home Screen Web App".
  - Persistent origins are excluded from eviction.
  - The ITP list includes "Service Worker registrations and cache".
  - Home Screen apps "have their own counter of days of use".
  - BCD: `persist()` Chrome 55, Firefox 57, Safari 15.2. `estimate()` Chrome 61, Firefox 57, Safari 17.
  - web-features `storage-manager`: Baseline low 2023-09-18, high 2026-03-18.
- Evidence:
  - https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria (modified 2026-01-05)
  - https://webkit.org/blog/14403/updates-to-storage-policy/
  - https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/

### Show cached data first, then replace it with network data without moving what the user is reading
- Verdict: verified
- Evidence: This is the Offline Cookbook "cache then network" pattern, with the `networkDataReceived` flag ("Don't overwrite newer network data"). Source: https://web.dev/articles/offline-cookbook.

### Race cache and network only for small assets, and use Promise.any
- Verdict: corrected
- Correction: The Why line says "a cache miss that throws". A cache miss does not throw. `caches.match()` *resolves* with `undefined`. The problem with `Promise.race` is that it settles with the first promise to settle, so a quick `undefined` (a miss) or a quick network rejection wins. The example is still correct, because it turns a miss into a rejection.
- Evidence:
  - https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage/match ("If no matching response to the specified request is found, the promise resolves with `undefined`.")
  - web-features `promise-any`: Baseline low 2020-09-16, high 2023-03-16.

### Precache a generic fallback and return it when both cache and network fail
- Verdict: verified
- Evidence: `PrecacheFallbackPlugin` is in `workbox-precaching@7.4.1/src/PrecacheFallbackPlugin.ts` (HTTP 200). `setCatchHandler` is in workbox-routing. Source: https://developer.chrome.com/docs/workbox/modules/workbox-precaching.

### Send an explicit Cache-Control on every response; never rely on heuristic freshness
- Verdict: corrected
- Correction: The Avoid/caveats line says "Heuristic freshness also applies to 3xx". That is too broad. RFC 9110 lists these heuristically cacheable codes: 200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414, 501. So 302, 303 and 307 are not in the list. Chromium does two things:
  - It uses the 10% heuristic only for 200, 203 and 206 that have `Last-Modified` (`(date_value - last_modified_value) / 10`). Otherwise the heuristic freshness is 0 s.
  - It treats 300, 301, 308 and 410 as "implicitly fresh" with `freshness = base::TimeDelta::Max()`. So a 301 without `Cache-Control` is cached with no end date.
  - Replacement text: "In Chromium, 300, 301, 308 and 410 responses without explicit freshness are cached with no end date. Send `Cache-Control` on redirects too." The rest is verified. RFC 9111 4.2.2 says "A typical setting of this fraction might be 10%". love-your-cache gives the "about another three days" example.
- Evidence:
  - https://www.rfc-editor.org/rfc/rfc9110#section-15.1
  - https://www.rfc-editor.org/rfc/rfc9111#section-4.2.2
  - https://raw.githubusercontent.com/chromium/chromium/main/net/http/http_response_headers.cc (lines 1341-1368)
  - https://web.dev/articles/love-your-cache

### Pair long-lived hashed assets with no-cache HTML, and keep old hashed files deployed after a release
- Verdict: verified
- Evidence:
  - love-your-cache says the site "may exist in _pieces_", with the `/images/foo.jpeg` example. It also says "it's only needed for Safari and Firefox".
  - BCD `http.headers.Cache-Control.immutable`: Chrome false, Firefox 49, Safari 11.
  - MDN (modified 2026-09-17) says `max-age=0, must-revalidate` "is equivalent to `no-cache`" and "for now, you can simply use `no-cache` instead". It also gives the `private` guidance.
  - Sources: https://web.dev/articles/love-your-cache, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control

### Use a middle-ground TTL only for assets whose content has its own lifetime
- Verdict: verified
- Evidence: The article shows `Cache-Control: max-age=3600,immutable,public` and says "avoid CSS, as it causes changes in how your HTML is rendered". Source: https://web.dev/articles/love-your-cache.

### Do not count on cross-site cache hits for shared CDN libraries
- Verdict: corrected
- Correction: The Why line says the article's claim is outdated, namely that the HTTP cache is "per-origin" and "shared by subdomains". That is half wrong. Subdomains of one site still share cache entries. The Chrome partitioning post says "Because the key is created based on 'scheme://eTLD+1', subdomains and port numbers are ignored." What changed is *cross-site* sharing. The replacement text: "The article's 'per-origin' wording was never exact. Same-site subdomains still share the HTTP cache, but different top-level sites do not." The same fix applies to:
  - the batch-01 table row ("is no longer shared per origin; it is partitioned").
  - the first bullet under "Outdated advice and myths".
  - The numbers are verified: "about 3.6%" more cache misses, "~0.3%" FCP, "around 4%" more bytes from the network, Chrome 86. Firefox 85 was released on 2021-01-26.
- Evidence: https://developer.chrome.com/blog/http-cache-partitioning, https://web.dev/articles/service-worker-caching-and-http-caching

### Avoid no-store on HTML unless the page is truly sensitive, because it limits bfcache
- Verdict: corrected
- Correction: The Avoid/caveats line ends with "close or pause sockets on `pagehide` if bfcache matters". That does not help a `no-store` page. In Chromium, WebSocket use on a `Cache-Control: no-store` page is a *sticky* blocker:
  - Chromium has `kWebSocketSticky`, named "websocket-used-with-ccns" with the text "WebSocket used in the page with Cache-Control: no store". It is in the `StickyFeatures()` set.
  - The Chrome doc says these APIs "block bfcache on Cache-Control: no-store pages even if they are not being used at the time of leaving the page".
  - Replacement text: "If a `no-store` page ever opened a WebSocket, Chrome will not bfcache it, even if you close the socket. To get bfcache, drop `no-store` (use `private, no-cache`)."
  - For pages *without* `no-store`, Chrome 149+ disconnects active WebSockets on bfcache entry, so the page can be cached. The page must then reconnect on `pageshow`, because "the browser fires the error and close events" (chromestatus 5068439115923456). Firefox still blocks bfcache for pages with an open WebSocket, so closing the socket on `pagehide` helps there.
  - The rest is verified: eviction on cookie or authorization changes, a 3-minute limit (not 10), rollout "over March and April 2025", doc last updated 2025-09-09.
  - This also closes the open question in 15-gaps-round-2.md:716.
- Evidence:
  - https://developer.chrome.com/docs/web-platform/bfcache-ccns
  - https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/common/scheduler/web_scheduler_tracked_feature.cc (lines 28-32, 246-250)
  - https://chromestatus.com/feature/5068439115923456
  - https://web.dev/articles/bfcache

### Run script-controlled DOM animations through element.animate(), and animate only transform and opacity
- Verdict: verified
- Note: "Keep to `transform` and `opacity`" is safe advice, but other properties are also composited:
  - Chromium composites `filter`, `backdrop-filter`, `translate`, `rotate` and `scale`. It also composites `background-color` (stable in Chrome 142) and `clip-path` (stable in Chrome 152). See verify/05-css-rendering.verify.md.
  - Firefox composites `background-color`.
- Evidence:
  - MDN (modified 2025-11-07): "in the Web Animations API the default easing is `linear`". It uses `Infinity` and milliseconds. The Alice keyframes animate `color` (`color: "#431236", offset: 0.3`). Source: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API.
  - web-features `web-animations`: Baseline low 2020-09-16, high 2023-03-16.

### Persist an animation's end state with commitStyles(), not with an endless fill
- Verdict: verified
- Evidence:
  - BCD for `commitStyles`, `persist`, `replaceState` and the `remove` event: Chrome 84, Firefox 75, Safari 13.1.
  - BCD `endpoint_inclusive_commitStyles`: Chrome 144, Firefox 142, Safari 26.2.
  - MDN (modified 2026-09-07): "There is no way to feature check for this new behavior. For now most code should continue to set `fill`". Source: https://developer.mozilla.org/en-US/docs/Web/API/Animation/commitStyles.

### Control playback with the Animation object: updatePlaybackRate, finished, and document.getAnimations()
- Verdict: corrected
- Correction: The example is wrong for infinite animations. `Animation.finish()` throws `InvalidStateError` when "the animation's playback rate is greater than 0 and the end time of the animation is infinity". It also throws when the playback rate is 0. So `for (const a of document.getAnimations()) a.finish();` stops at the first spinner with `iterations: Infinity`. Chromium 152 test result: "InvalidStateError: … Cannot finish Animation with an infinite target effect end."
  - Replacement: `for (const a of document.getAnimations()) { const end = a.effect?.getComputedTiming().endTime; if (end === Infinity || a.playbackRate === 0) a.cancel(); else a.finish(); }`. The simpler option is to call `cancel()` on all of them.
  - The status numbers are verified (BCD): `updatePlaybackRate` Chrome 76, Firefox 60, Safari 13.1. `finished` Chrome 84, Firefox 63, Safari 13.1. `Document.getAnimations` Chrome 84, Firefox 75, Safari 14 (13.1 partial). MDN says `updatePlaybackRate()` "produces a smooth update".
- Evidence:
  - https://developer.mozilla.org/en-US/docs/Web/API/Animation/finish (Exceptions)
  - https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API

---

## 17-collections-batch-02.md

### Put non-essential motion behind `prefers-reduced-motion: no-preference`
- Verdict: verified
- Evidence:
  - web-features `prefers-reduced-motion`: Baseline low 2020-01-15, high 2022-07-15.
  - BCD: Chrome 74, Edge 79, Firefox 63, Safari 10.1.
  - The article names "macOS Mojave's Reduce motion" and "Android Pie's Remove animations". Source: https://web.dev/articles/prefers-reduced-motion.

### Listen for the media query `change` event and stop JS, WAAPI, canvas and WebGL animations yourself
- Verdict: corrected
- Correction: The advice and the status are correct:
  - BCD `MediaQueryList.change_event`: Chrome 39, Edge 79, Firefox 55, Safari 14.
  - `addListener` has `deprecated: true`.
  - The article example uses parentheses.
  - The example has the same bug as batch-01's playback item. `runningAnimations.forEach((a) => a.finish())` throws `InvalidStateError` on any animation with infinite iterations or a playback rate of 0, and the `forEach` stops. Use `cancel()` for those animations (or for all of them). The fix was tested in Chromium 152.
- Evidence: https://developer.mozilla.org/en-US/docs/Web/API/Animation/finish, https://web.dev/articles/prefers-reduced-motion

### Load animation-only CSS with `<link media="(prefers-reduced-motion: no-preference)">`, but do not expect it to save bytes
- Verdict: verified
- Evidence:
  - The rendering article says "the browser still downloads the CSS asset, albeit with a lower priority for non-blocking resources". Source: https://web.dev/articles/critical-rendering-path/render-blocking-css.
  - The reduced-motion article's claim "spare your opted-out users from downloading it" is therefore wrong. Source: https://web.dev/articles/prefers-reduced-motion.
  - BCD `html.elements.link.media`: all browsers.

### Serve a static image instead of an animated GIF, WebP or AVIF to reduced-motion users with `<picture>`
- Verdict: verified
- Evidence: BCD `html.elements.source.media`: Chrome 3, Firefox 15, Safari 3.1. The article has the `<picture>` example. Source: https://web.dev/articles/prefers-reduced-motion.

### Use the `Sec-CH-Prefers-Reduced-Motion` client hint only as a Chromium-only extra
- Verdict: verified
- Evidence:
  - BCD `http.headers.Sec-CH-Prefers-Reduced-Motion`: Chrome/Edge 108, Firefox and Safari false, `experimental: true`.
  - BCD `http.headers.Critical-CH`: Chrome 91 only, `experimental: true`, `standard_track: false`.
  - BCD `Accept-CH`: Chrome 46 only.

### Do not rely on a global "1 ms duration" reset to stop motion; stop script and canvas animation explicitly
- Verdict: corrected
- Correction: The Do and Why lines say "Then `animationend` and `transitionend` still fire". That is true only for animations. With `transition-duration: 1ms` and `transition-delay: -1ms`, no transition starts at all. CSS Transitions starts a transition only when the "combined duration is greater than 0s", where the combined duration is max(duration, 0) + delay = 1 ms + (-1 ms) = 0.
  - Chromium 152 test: an element with the article's reset fired no `transitionrun`, no `transitionstart` and no `transitionend`, and it had 0 running animations. The same element with `transition-delay: 0s` fired all three. The `@keyframes` element fired `animationstart` and `animationend` in both cases.
  - Replacement: keep `animation-duration: 1ms; animation-delay: -1ms; animation-iteration-count: 1`. For transitions, use `transition-duration: 1ms` (or `0.01ms`) with `transition-delay: 0s`. The web.dev snippet has the same problem (it uses `-1ms` for both).
- Evidence: https://drafts.csswg.org/css-transitions-1/#starting (definition of "combined duration"), https://web.dev/articles/prefers-reduced-motion

### Do not animate a geometric property and `transform` on the same element at the same time
- Verdict: corrected
- Correction: The Impact and Why lines say that Firefox "keeps the `transform` animation off the compositor". Firefox removed this rule.
  - Bug 1540906 "Let de-synchronization of transform and geometric animations ride the trains" landed 2023-11-15 in Firefox 121 (released 2023-12-19).
  - Bug 1876321 "Remove mainthread sync with geometric animations pref" landed in Firefox 124.
  - Current Firefox source has no `TransformWithGeometricProperties` warning type. `AnimationPerformanceWarning::Type` now lists only ContentTooLarge, ContentTooLargeArea, NonScalingStroke, TransformSVG, TransformFrameInactive, TransformIsBlockedByImportantRules, OpacityFrameInactive, HasRenderingObserver and HasCurrentColor. `layout_errors.properties` no longer has the message.
  - The Firefox DevTools page that the notes quote ("cannot be run on the compositor when geometric properties are animated on the same element") is out of date.
  - The Do line is still good advice for another reason: `left`, `width` and other geometric properties run layout on the main thread every frame in all engines. Replacement text for the Why line: "Geometric properties force layout on every frame. Since Firefox 121, the transform part stays on the compositor, but the geometric part still janks under main-thread load." Drop the Firefox-specific impact claim.
- Evidence:
  - https://bugzilla.mozilla.org/show_bug.cgi?id=1540906
  - https://bugzilla.mozilla.org/show_bug.cgi?id=1876321
  - https://raw.githubusercontent.com/mozilla-firefox/firefox/main/dom/animation/AnimationPerformanceWarning.h
  - https://raw.githubusercontent.com/mozilla-firefox/firefox/main/dom/locales/en-US/chrome/layout/layout_errors.properties
  - Lighthouse 13.5.0 (2026-09-18) still has `non-composited-animations` in its default config (`raw/verify/05/lh-default-config.js`, line 199).

### Check that animations run on the compositor with the Firefox Animations panel lightning bolt
- Verdict: verified
- Evidence:
  - The docs describe a white bolt for "all the animation properties" and a grey bolt for "only some". The bar colors are blue for transitions, orange for `@keyframes` and green for WAAPI. Source: https://firefox-source-docs.mozilla.org/devtools-user/page_inspector/how_to/work_with_animations/index.html.
  - Current Firefox strings: "All animation properties are optimized" and "Some animation properties are optimized" (`devtools/client/locales/en-US/animationinspector.properties`).
  - The geometric-property example on that page is stale (see the item above).

### Verify with Chrome DevTools, using the current tool names (FPS meter, Waterfall and Firefox paint flashing are outdated)
- Verdict: verified
- Evidence:
  - The DevTools rendering page (updated 2022-04-13) describes the **Frame rendering stats** overlay: blue lines are rendered frames, yellow lines are partially presented frames, red lines are dropped frames. Source: https://developer.chrome.com/docs/devtools/rendering/performance.
  - The blink-dev PSA of 2020-07-02 ("update the name to 'Frame Rendering Stats'"): https://groups.google.com/a/chromium.org/g/blink-dev/c/iHULoSyUxOQ.
  - Bug 1743310 "Remove paint flashing support from DevTools", target milestone 96: https://bugzilla.mozilla.org/show_bug.cgi?id=1743310.
  - The Performance reference still has "Enable advanced paint instrumentation" and "View paint profiler" (last updated 2025-04-03). Source: https://developer.chrome.com/docs/devtools/performance/reference.

### Do not animate blur or shadow; fade a pre-painted layer instead
- Verdict: corrected
- Correction: The Impact line says "Blur-based effects (shadows, `filter: blur`) … animating them repaints every frame". That is correct for `box-shadow`, `text-shadow` and `ctx.shadowBlur`. It is wrong for the CSS `filter` property. Chromium's compositor accepts `filter` and `backdrop-filter` animations, and WebKit accelerates `filter` and `backdrop-filter`. So an animated `filter: blur()` runs on the GPU without repaint, but it still costs a blur shader pass over the whole layer on every frame. Firefox does not composite `filter`. The replacement text:
  - "Animating `box-shadow` repaints every frame."
  - "Animating `filter: blur()` is composited in Chromium and WebKit, but each frame still runs an expensive GPU blur. Prefer the opacity fade of a pre-painted layer for both."
  - The article quote is verified: "anything that involves a blur (like a shadow, for example) takes longer to paint than drawing a red box".
- Evidence:
  - https://web.dev/articles/animations-guide
  - verify/05-css-rendering.verify.md (Chromium `compositor_animations.cc` accepts `kFilter` and `kBackdropFilter`; WebKit `animation-wrapper-acceleration`)

### Add `will-change` just before a change and remove it after; drop the `translateZ(0)` hack
- Verdict: verified
- Evidence:
  - The guide says "To force layer creation in a browser without support for `will-change`, you can set `transform: translateZ(0)`" (obsolete) and "use it only if you notice graphics issues". Source: https://web.dev/articles/animations-guide.
  - web-features `will-change`: Baseline low 2020-01-15, high 2022-07-15. BCD: Chrome 36, Firefox 36, Safari 9.1.

### Configure HTTP `Cache-Control` correctly before you add Cache Storage, and bypass the HTTP cache when you precache unversioned URLs
- Verdict: verified
- Note: Workbox precaching already does the bypass. `PrecacheController` uses `cacheMode = entry.revision ? 'reload' : 'default'`. The manual `cache: 'reload'` is needed only in a hand-written service worker, or for entries that have no revision.
- Evidence:
  - The article says "misconfigured `Cache-Control` headers … you can end up making things worse by adding that stale content to the Cache Storage API" and "The `Cache-Control` header on a given `Response` is effectively ignored". Source: https://web.dev/articles/service-workers-cache-storage.
  - BCD `Request.cache`: Chrome 64, Firefox 48, Safari 10.1.
  - https://cdn.jsdelivr.net/npm/workbox-precaching@7.4.1/src/PrecacheController.ts (lines 145-146)

### Give every runtime cache an explicit size and age limit
- Verdict: verified
- Evidence:
  - `ExpirationPlugin.ts` (7.4.1) says "responses may be used *once* after expiring … If the response has a "Date" header, then a light weight expiration check is performed". It also says "the entry least-recently requested will be removed". `_isResponseDateFresh()` returns true when the `Date` header cannot be parsed.
  - `purgeOnQuotaError` exists in 7.4.1.
  - Sources: https://cdn.jsdelivr.net/npm/workbox-expiration@7.4.1/src/ExpirationPlugin.ts, https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria

### Check quota and ask for persistence; do not trust the old "hundreds of MB" figure
- Verdict: corrected
- Correction: Two fixes in the Why line.
  - (1) "Cache API, IndexedDB, OPFS and Wasm code cache share one origin quota" is too broad. MDN lists IndexedDB, the Cache API and OPFS as the quota-managed storage. MDN names Wasm code caching only as other data that browsers store "in addition to the above". In Chrome, the Wasm code cache is part of the browser code cache, keyed on the response URL (see 09-v8-consolidated.md:2064). It counts against the origin quota only when the module is served from Cache Storage, where Blink stores the code as Cache Storage metadata (08-v8-batch-04.md:79). Replacement text: "Cache API, IndexedDB and OPFS share one origin quota. Wasm code for modules served from Cache Storage is stored with them."
  - (2) The Firefox best-effort limit is "whichever is the smaller of" 10% of the disk or 10 GiB (the group limit per eTLD+1). The persistent limit is 50% of the disk, "capped at 8 TiB".
  - The other numbers are verified: Chromium 60%, Safari 60% and 15% (macOS 14, iOS 17), the 7-day rule, "at least a couple of hundred megabytes" in the 2017 article, and `persist()` in Safari 15.2.
- Evidence:
  - https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
  - https://webkit.org/blog/14403/updates-to-storage-policy/
  - https://web.dev/articles/cache-api-quick-guide

### Choose `add`/`addAll` or `put` on purpose, and guard what `put` stores (opaque responses cost about 7 MB each)
- Verdict: corrected
- Correction: The title ("about 7 MB each") and the Why line ("counts each cached opaque response as at least about 7 MB of quota") are wrong. Chromium pads each opaque response by `HMAC(url, response time, site, method, side-data size) % (14431 * 1024)`. That is a stable pseudo-random value from 0 to about 14.1 MiB, with a mean of about 7 MiB. There is no minimum. The Workbox doc wording "the minimum size … is approximately 7 megabytes" is itself wrong. Replacement text: "Chrome pads each cached opaque response by 0 to about 14 MiB (about 7 MiB on average)." This matches batch-01. The rest is verified:
  - The article: "if the status code of the response is not in the 200 range, then nothing is stored and the Promise rejects".
  - The article's `cache.put('/data.json')` with one argument is a real article bug.
  - Workbox 7.4.1: `StrategyHandler._ensureResponseSafeToCache()` keeps only status 200 when no plugin exists (CacheFirst, CacheOnly), and `NetworkFirst` adds `cacheOkAndOpaquePlugin` (status 200 or 0).
  - BCD `addAll`: Chrome 46, Firefox 41, Safari 11.1.
- Evidence:
  - https://chromium.googlesource.com/chromium/src/+/main/storage/common/quota/padding_key.cc
  - https://web.dev/articles/cache-api-quick-guide
  - https://cdn.jsdelivr.net/npm/workbox-strategies@7.4.1/src/StrategyHandler.ts
  - https://cdn.jsdelivr.net/npm/workbox-strategies@7.4.1/src/plugins/cacheOkAndOpaquePlugin.ts

### Match cache keys on purpose: query string, `Vary` and method all make a different key
- Verdict: verified
- Evidence:
  - The article says "Two requests are considered different if they have different query strings, Vary headers, or HTTP methods" and "If more than one cached request matches then the one that was created first is returned". Source: https://web.dev/articles/cache-api-quick-guide.
  - Workbox plugins doc: "`mode` is either 'read' or 'write'". Source: https://developer.chrome.com/docs/workbox/using-plugins.

### Do not search Cache Storage by iterating `keys()`; keep an index in IndexedDB
- Verdict: verified
- Evidence:
  - The article says "Since this is the kind of operation that IndexedDB was designed for it has much better performance with large numbers of entries". Source: https://web.dev/articles/cache-api-quick-guide.
  - web-features `indexeddb`: Baseline high 2024-03-20.

### Store numeric payloads as binary `Response` bodies and read them with `arrayBuffer()`
- Verdict: verified
- Note: `new Response(closes.buffer)` stores the *whole* underlying buffer. If `closes` is a `subarray()` view, the stored body contains extra bytes. `new Response(closes)` accepts the typed array directly, because it is a BufferSource, and it respects the view's offset and length.
- Evidence: BCD `Response.bytes`: Chrome 132, Firefox 128, Safari 18. The article lists "Blob, ArrayBuffer, FormData objects, and strings". Source: https://web.dev/articles/cache-api-quick-guide.

### Serve cached data with stale-while-revalidate and broadcast the refresh; send validators so the comparison works
- Verdict: verified
- Evidence: Workbox 7.4.1 `BroadcastCacheUpdate.ts` confirms each claim:
  - The default payload is `updatedURL: data.request.url`.
  - The default `headersToCheck` is `['content-length', 'etag', 'last-modified']`.
  - "Without two responses there is nothing to compare", so nothing is sent on the first write.
  - "Neither of the Responses can be opaque".
  - `responsesAreSame()` returns true (no message) when none of the headers is present. This supports "send validators".
  - The web.dev sample uses `const {cacheName, updatedUrl} = event.data.payload;`, which is an article bug. Source: https://web.dev/articles/broadcast-updates-guide.

### Register service-worker `message` listeners early, and call `startMessages()` when you use `addEventListener`
- Verdict: verified
- Note: The Safari reason comes only from a Workbox source comment ("Safari does not currently implement postMessage buffering"). I did not re-test it in current WebKit. Workbox also waits 3500 ms when `resultingClientExists()` finds no client.
- Evidence:
  - BCD `ServiceWorkerContainer.startMessages`: Chrome 74, Edge 79, Firefox 64, Safari 11.1. So Baseline low is 2020-01-15.
  - `BroadcastCacheUpdate.ts` lines 175-196 (`await timeout(3500)` for navigations in Safari).

### Pick the page and service-worker channel by fan-out: BroadcastChannel (all), `Client.postMessage` (selected), MessageChannel (one port)
- Verdict: verified
- Evidence:
  - The article says "at the moment of this writing, Safari doesn't support this API" (outdated).
  - web-features `broadcast-channel`: Baseline low 2022-03-14, high 2024-09-14 (Safari 15.4).
  - `channel-messaging`: high 2018-03-22.
  - BCD `Clients.matchAll`: Chrome 42, Firefox 54 (partial from 44), Safari 11.1. BCD notes "Client objects returned in most recent focus order", which supports the article's "last focused tab" point that the notes left unchecked.

### Tell the user about a new service worker; do not reload a working session on your own
- Verdict: corrected
- Correction: The example calls `location.reload()` on `installed` with `isUpdate`. This does not activate a new worker that is waiting. The workbox-window doc says "in many cases refreshing the page will not activate the installed worker" and that the new worker "will not activate until all pages controlled by the currently active service worker have unloaded".
  - The Do line should be: listen for the `waiting` event. When the user accepts, call `wb.messageSkipWaiting()`, and reload in a `controlling` listener. The service worker must handle the message: `self.addEventListener('message', (e) => { if (e.data?.type === 'SKIP_WAITING') self.skipWaiting(); })`. Workbox sends `{type: 'SKIP_WAITING'}` (`Workbox.ts` line 32).
  - Replacement example: `wb.addEventListener('waiting', () => showUpdateBanner(() => { wb.addEventListener('controlling', () => location.reload()); wb.messageSkipWaiting(); }));`.
  - Verified: the README says "Chrome's Aurora team will be the new owners of Workbox". The article's Tinder and Squoosh examples are correct.
- Evidence:
  - https://developer.chrome.com/docs/workbox/modules/workbox-window
  - https://cdn.jsdelivr.net/npm/workbox-window@7.4.1/src/Workbox.ts
  - https://raw.githubusercontent.com/GoogleChrome/workbox/v7/README.md

### Measure offline failures in the service worker, not with `online`/`offline` events
- Verdict: verified
- Evidence:
  - The article says "only knows about network access, not internet access" and that the events "can fire for just a split second". Its privacy point is general ("as little data as possible should be collected"). It is not specifically about URLs. Source: https://web.dev/articles/measuring-offline-usage.
  - BCD `Response.error()`: all engines.

### Queue beacons offline and replay them; do not use `workbox-google-analytics`
- Verdict: verified
- Evidence:
  - Workbox 7.4.1 `Queue.ts`: `const MAX_RETENTION_TIME = 60 * 24 * 7; // 7 days in minutes`.
  - The docs say "deprecated, because it is not compatible with newer Google Analytics versions starting with version 4".
  - The article says "hits sent more than four hours deferred may not be processed".
  - web-features `background-sync`: `baseline: false`, Chrome 49 and Edge 79 only.
  - Sources: https://developer.chrome.com/docs/workbox/modules/workbox-google-analytics, https://web.dev/articles/measuring-offline-usage

### Use Workbox plugin callbacks for cross-cutting cache policy and timing, not copied handler code
- Verdict: verified
- Evidence:
  - The docs say `cacheWillUpdate` can "return `null`".
  - `fetchDidFail` "will not fire when the browser has a network connection, but receives an error (for example, `404 Not Found`)".
  - `handlerDidComplete` runs "after all extend lifetime promises … have settled".
  - The `handler*` callbacks are "new in Workbox starting from version 6".
  - In `cacheDidUpdate`, "`newResponse.bodyUsed` is `true`".
  - Source: https://developer.chrome.com/docs/workbox/using-plugins (2022-02-02).

### Use `RangeRequestsPlugin` when you serve cached audio or video
- Verdict: verified
- Evidence: `RangeRequestsPlugin` is in the Workbox-provided plugin list. `workbox-range-requests` 7.4.1 is on npm and not deprecated. Source: https://developer.chrome.com/docs/workbox/using-plugins.

---

## Cross-file conflicts

1. **Opaque response padding.**
   - 17-collections-batch-01.md:221,231,451: 0 to about 14.1 MiB, mean about 7 MiB. This is correct per `padding_key.cc`.
   - 17-collections-batch-02.md:282,293: "about 7 MB each" and "at least about 7 MB". This is wrong.
   - 07-js-web-apis.md:247: "roughly 7 MB". This is acceptable only as an average.
   - Keep the batch-01 wording.
2. **What shares the origin quota.**
   - 17-collections-batch-01.md:242 adds `localStorage`, which has a separate 5 MiB limit.
   - 17-collections-batch-02.md:277 adds the "Wasm code cache", which is in quota only when served from Cache Storage.
   - 08-v8-batch-04.md:79 and 09-v8-consolidated.md:2064 support the narrower statement.
   - The correct set is Cache API, IndexedDB and OPFS.
3. **Workbox 7.4.1 date.**
   - batch-01 and 17-collections-index.md:172 give 2026-05-05 (the GitHub release `published_at`).
   - batch-02 and 17-collections-batch-03.md:29,433 give 2026-05-04 (npm publish and the tag's `created_at`).
   - Both dates are real. Pick one and say which one it is.
4. **no-store and WebSocket bfcache.** 15-gaps-round-2.md:716 left this open. The Chromium source resolves it:
   - `kWebSocketSticky` ("websocket-used-with-ccns") is sticky. So on a `no-store` page, any WebSocket use blocks bfcache, even after close.
   - The Chrome 149 change (disconnect on bfcache entry; verify/03 and verify/07) applies to pages *without* `no-store`.
   - 17-collections-batch-01.md:366 ("close or pause sockets on `pagehide`") needs the fix given above.
   - 16-explore-fast-batch-02.md:309 and 03-course-js-and-vitals.md:972 are consistent with the Chrome doc.
5. **Navigation preload scope.**
   - 17-collections-batch-03.md:235 says "whenever a service worker has a fetch handler".
   - 17-collections-batch-01.md:72 limits it to network-bound navigations.
   - 15-gaps-round-1.md:32 already resolved this in favor of batch-01. This check agrees: the web.dev article limits the benefit to navigations that go to the network.
6. **HTTP cache and subdomains.**
   - 17-collections-batch-01.md:12,353,446 call the "subdomains share it" part outdated.
   - The Chrome partitioning post says subdomains are ignored in the key, so same-site subdomains still share. No other file contradicts this.
7. **Firefox transform plus geometric properties.**
   - 17-collections-batch-02.md:151-153 and 17-collections-index.md:125 (A7 summary) repeat the Firefox DevTools doc.
   - Firefox 121+ no longer has this rule.
   - No other file contradicts the fix.
8. **commitStyles.** batch-01:406, 17-collections-batch-03.md:111 and 17-collections-batch-04.md:58 agree (Chrome 144, Firefox 142, Safari 26.2; there is no feature test). No conflict.
9. **`immutable` and SW static routing.** batch-01 agrees with 04-html-and-http-loading-features.md:615,709, 16-explore-fast-batch-04.md:371-372 and 07-js-web-apis.md:217. No conflict.

## Missing but important

1. **Set `Cache-Control` on permanent redirects.** Chromium caches 300, 301, 308 and 410 responses that have no freshness information with `freshness = base::TimeDelta::Max()` ("implicitly fresh"). A wrong 301 on a trading domain then stays in users' caches with no end date. Source: https://raw.githubusercontent.com/chromium/chromium/main/net/http/http_response_headers.cc (lines 1356-1364).
2. **Remove no-op fetch handlers.** Chrome 115+ skips a no-op `fetch` listener ("Skip service worker no-op fetch handler", enabled by default in M115). A handler that does real work always costs worker startup. 07-js-web-apis.md covers this, but these two files do not. Source: https://chromestatus.com/feature/5136946693668864.
3. **Reconnect WebSockets after a bfcache restore.** Chrome 149+ closes active WebSockets on bfcache entry (for pages without `no-store`) and "fires the error and close events" on restore. A live quote feed must reconnect on `pageshow` (`persisted`). Enterprise policy `BackForwardCacheForWebSocketsAllowed` restores the old behavior. Source: https://chromestatus.com/feature/5068439115923456.
4. **`Clear-Site-Data` on sign-out.** Send `Clear-Site-Data: "storage"` (Chrome 61, Firefox 63, Safari 17; header Baseline widely available 2026-03-18) so that service worker caches and IndexedDB with account data do not survive a sign-out. `"cache"` is partial in Chromium (BCD: "Some requests may still be taken from the cache…" and "may cause seconds-long hangs"). Source: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data.
5. **Keep `updateViaCache` at its default (`'imports'`).** "Starting in Chrome 68, HTTP requests that check for updates to the service worker script will no longer be fulfilled by the HTTP cache by default." BCD `ServiceWorkerRegistration.updateViaCache`: Chrome 68, Firefox 57, Safari 11.1. Do not set `'all'`. A wrong `Cache-Control` on `sw.js` then cannot delay the updates. Source: https://developer.chrome.com/blog/fresher-sw.
6. **The `crossorigin` mode splits connections.** Requests with and without credentials to one CDN host do not share a connection. `preconnect` must carry the same `crossorigin` value ("If you omit the crossorigin attribute, the browser only performs the DNS lookup" for anonymous-mode resources). This matters when batch-01 tells readers to add `crossorigin="anonymous"` to cached assets. Source: https://web.dev/articles/preconnect-and-dns-prefetch.
7. **Workbox precache already bypasses the HTTP cache.** Entries that have a `revision` are fetched with `cache: 'reload'` (`PrecacheController.ts` lines 145-146). Hand-written `cache: 'reload'` (batch-02) is needed only without Workbox. Source: https://cdn.jsdelivr.net/npm/workbox-precaching@7.4.1/src/PrecacheController.ts.
8. **More compositor-eligible animation properties in Chromium.** `filter`, `backdrop-filter`, `translate`, `rotate` and `scale` are composited. `background-color` is stable from Chrome 142 (2025-10-28), and `clip-path` from Chrome 152 (2026-08-25), with conditions. This is relevant to both WAAPI items, which say "transform and opacity only". Source: verify/05-css-rendering.verify.md (Chromium `compositor_animations.cc`, runtime_enabled_features).
9. **Storage Buckets API (Chromium-only).** `navigator.storageBuckets` (Chrome 122, not Baseline per web-features `storage-buckets`) lets low-value caches (logos, news) live in a separate bucket that can be evicted, apart from offline-critical data. Use it only as a progressive enhancement. Source: https://developer.chrome.com/docs/web-platform/storage-buckets.
