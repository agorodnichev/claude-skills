# web.dev collections deep read, batch 1 of 4 (reliable + animations)

Scope: caching levers (HTTP cache, service worker cache, Workbox precaching and runtime caching, navigation handling) and the Web Animations API (WAAPI).
Sources: 6 web.dev "Network reliability" articles (2014-2021), 2 Workbox v7 docs pages (Chrome for Developers), and the MDN WAAPI guide (modified 2025-11-07).
All status claims were checked on 2026-09-22 against MDN browser-compat-data (BCD, GitHub main), webstatus.dev, RFC 9111, Chromium source and vendor blogs.
Tradester note: the articles themselves map "balances and payments" to network-only and "prices, rates, order status" to network-first. This matches a trading terminal directly.

Article dates (page footer "Last updated"):

| Article | Date | Freshness today |
|---|---|---|
| Service worker caching and HTTP caching | 2020-07-17 | One claim outdated (the HTTP cache is no longer shared per origin; it is partitioned) |
| Prevent unnecessary network requests with the HTTP Cache | 2018-11-05 | Core advice current; "one year is the maximum max-age" is a myth |
| Handling navigation requests | 2020-07-13 | Current; the Static Routing API now adds a new option |
| Common techniques to build offline applications (Offline Cookbook) | 2014-12-09 (body refreshed) | Patterns current; several code samples have API bugs; Background Sync is Chromium-only |
| Workbox: Caching resources during runtime | 2021-12-07 | Current for Workbox v7; the "7 MB minimum" opaque padding number is imprecise |
| Workbox: workbox-precaching | 2017-11-27 (v7 reference) | Current (Workbox v7.4.1, 2026-05-05, maintenance releases only) |
| MDN: Using the Web Animations API | 2025-11-07 | Current; the "at least two keyframes" note is outdated |
| Love your cache | 2020-12-11 | Current; its note about `immutable` is still correct |

---

### Choose one caching strategy per request class, by freshness need
- Layer: network
- Stage: network, main-thread-task
- Metrics: TTFB, LCP, FCP
- When: load, long-lived session
- Impact: high, because the strategy decides whether a request costs 0 ms (cache) or a full round trip, and whether the user can see stale money data.
- Do: Classify every request before you write a fetch handler: network-only (balances, orders, payments, non-GET), network-first with a timeout (quotes, order status, with a "last updated" label), stale-while-revalidate (lists, news, avatars), cache-first (app shell, hashed assets), cache-only (precached versioned files). Match routes by `request.destination`, `request.mode` and URL, not by file extension.
- Why: A service worker cache gives per-request control that the HTTP cache (time-based TTL only) cannot. The sw-http-cache article's own table puts "Balance statements" and "Payments and checkouts" in network-only and "Prices and rates (requires disclaimers)" in network-first. `request.destination` avoids wrong matches such as a `.js` URL that is really a JSON API.
- Example:
  ```js
  // sw.js (Workbox v7)
  import { registerRoute, Route } from 'workbox-routing';
  import { NetworkOnly, NetworkFirst, StaleWhileRevalidate, CacheFirst } from 'workbox-strategies';

  registerRoute(({ url }) => url.pathname.startsWith('/api/account/'), new NetworkOnly());
  registerRoute(({ url }) => url.pathname.startsWith('/api/quotes/'),
    new NetworkFirst({ cacheName: 'quotes', networkTimeoutSeconds: 3 }));
  registerRoute(new Route(({ request, sameOrigin }) =>
    sameOrigin && request.destination === 'image', new StaleWhileRevalidate({ cacheName: 'img' })));
  registerRoute(new Route(({ request }) =>
    request.destination === 'script' || request.destination === 'style',
    new CacheFirst({ cacheName: 'static' })));
  ```
- Avoid/caveats: Network-first without a timeout makes users on a flaky link wait for the network to fail (the Offline Cookbook says this "can take an extremely long time"); set `networkTimeoutSeconds`. Never serve cached balances or order state as if they were live. Do not route real-time market data (WebSocket, SSE) through a service worker cache at all.
- Status: Service workers are Baseline widely available (low 2018-04-30, high 2020-10-30, webstatus.dev). `Request.destination` Chrome 65, Firefox 61, Safari 10.1 (BCD). Workbox v7.4.1 released 2026-05-05 (GitHub releases).
- Sources: https://web.dev/articles/service-worker-caching-and-http-caching, https://developer.chrome.com/docs/workbox/caching-resources-during-runtime, https://developer.chrome.com/docs/workbox/modules/workbox-strategies, https://web.dev/articles/offline-cookbook

### Answer navigation requests from the service worker without waiting for the network
- Layer: network
- Stage: network, html-parse
- Metrics: TTFB, FCP, LCP
- When: load
- Impact: high, because the HTML response starts the whole request waterfall; the article calls this "the single biggest performance win" of a service worker compared with HTTP caching.
- Do: For a single-page app, precache one bare app-shell HTML and return it for every navigation (`request.mode === 'navigate'`), with an allowlist/denylist for URLs that must reach the server. For a small static site, precache all HTML files. Keep HTML itself on `Cache-Control: no-cache` at the HTTP layer.
- Why: With `no-cache` HTML, every navigation needs a revalidation round trip, so navigations are "not reliably fast". A precached shell removes that round trip; client JS then renders the route.
- Example:
  ```js
  import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
  import { NavigationRoute, registerRoute } from 'workbox-routing';

  precacheAndRoute(self.__WB_MANIFEST); // build tool injects [{url, revision}, ...]
  registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/auth\//, /^\/api\//], // denylist wins over allowlist
  }));
  ```
- Avoid/caveats: Runtime stale-while-revalidate for HTML updates each page separately, so different pages can come from different releases; use it only for a few, often-revisited URLs. A cached shell must not embed user state (sign-in, balances).
- Status: Workbox `NavigationRoute` and `createHandlerBoundToURL` are in the current v7 docs.
- Sources: https://web.dev/articles/handling-navigation-requests, https://developer.chrome.com/docs/workbox/modules/workbox-routing

### Enable navigation preload when navigations must go to the network, and always consume it
- Layer: network
- Stage: network
- Metrics: TTFB, LCP
- When: load
- Impact: medium, because it hides service worker boot time, which the Chrome team measured at about 50 ms on desktop, about 250 ms on mobile, and over 500 ms in extreme cases.
- Do: In `activate`, call `self.registration.navigationPreload.enable()` (feature-detect first). In `fetch`, `await event.preloadResponse` and use it before any `fetch(event.request)`. If the server varies output on the preload header, send `Vary: Service-Worker-Navigation-Preload`.
- Why: The browser starts the navigation request in parallel with service worker startup, so boot time and network time overlap instead of adding up.
- Example:
  ```js
  self.addEventListener('activate', (e) => {
    e.waitUntil(self.registration.navigationPreload?.enable());
  });
  self.addEventListener('fetch', (e) => {
    if (e.request.mode !== 'navigate') return;
    e.respondWith((async () => {
      const preloaded = await e.preloadResponse; // undefined if not enabled
      return preloaded ?? fetch(e.request);
    })());
  });
  ```
- Avoid/caveats: If you enable it and then call `fetch(event.request)` anyway, every navigation is requested twice. It gives little benefit when you answer navigations from cache (previous item). Workbox has `workbox-navigation-preload` for this.
- Status: `NavigationPreloadManager` and `FetchEvent.preloadResponse`: Chrome 59, Firefox 99, Safari 15.4 (BCD), so Baseline since 2022.
- Sources: https://web.dev/articles/handling-navigation-requests, https://web.dev/blog/navigation-preload (2017-02-15)

### Declare static routes so the browser can skip service worker startup for requests the worker does not handle
- Layer: network
- Stage: network
- Metrics: TTFB, LCP
- When: load
- Impact: medium, because a fetch handler that only passes most requests through still costs worker boot time on each cold start; static routes are evaluated before the worker runs.
- Do: In `install`, call `event.addRoutes()` with `urlPattern`/`requestDestination`/`requestMode`/`runningStatus` conditions and a source of `"network"`, `"cache"`, `{ cacheName }`, `"fetch-event"` or `"race-network-and-fetch-handler"`. Feature-detect and keep the normal fetch handler as the fallback path.
- Why: This is the newer answer to the "Everything else" case in the navigation article: instead of paying boot cost and mitigating it with preload, the browser does not start the worker at all for matched requests.
- Example:
  ```js
  self.addEventListener('install', (e) => {
    if (!('addRoutes' in e)) return; // Firefox: fetch handler still works
    e.addRoutes([
      { condition: { urlPattern: { pathname: '/api/*' } }, source: 'network' },
      { condition: { requestDestination: 'image' }, source: { cacheName: 'img' } },
      { condition: { requestMode: 'navigate', runningStatus: 'not-running' }, source: 'network' },
    ]);
  });
  ```
- Avoid/caveats: `or` cannot be combined with other conditions (TypeError). `"fetch-event"` throws if the worker has no fetch handler. If a named cache does not exist, the browser falls back to the network. `race-network-and-fetch-handler` spends data on two paths.
- Status: Limited availability. `InstallEvent.addRoutes` Chrome 123, Safari 27 (released 2026-09-14), Firefox not supported (BCD; webstatus.dev still says "limited"). MDN page modified 2026-07-04.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes, https://developer.chrome.com/blog/service-worker-static-routing

### Give the service worker cache a longer lifetime than HTTP max-age, and bypass the HTTP cache when the worker revalidates
- Layer: network
- Stage: network
- Metrics: TTFB, LCP
- When: load, long-lived session
- Impact: medium, because a `fetch()` inside the worker goes through the HTTP cache first, so a "revalidate" can silently return the same old HTTP-cached copy.
- Do: Do not mirror TTLs across layers; let the service worker keep entries longer (the article's example: 90 days SW vs 30 days HTTP for long-term). When a network-first or stale-while-revalidate step must reach the server, pass `cache: 'no-cache'` (or a cache-busting URL) to `fetch()`.
- Why: Lookup order is memory cache (Chrome), then the service worker, then the HTTP cache, then the server. With equal TTLs the HTTP layer adds nothing in the long-term case and blocks fresh data in the medium and short-term cases.
- Example:
  ```js
  // Before: may return the HTTP-cached copy, so the SW cache never gets newer data
  const fresh = await fetch(request);
  // After: forces a conditional request to the server (cheap 304 when unchanged)
  const fresh = await fetch(request, { cache: 'no-cache' });
  ```
- Avoid/caveats: A longer SW lifetime needs explicit expiration and a versioned cache name, or users keep old data. Only the service worker cache works when the network is down; the HTTP cache does not help offline.
- Status: `Request.cache` Chrome 64, Firefox 48, Safari 10.1 (BCD).
- Sources: https://web.dev/articles/service-worker-caching-and-http-caching

### Precache only the versioned app shell, from a build-generated manifest
- Layer: build
- Stage: network
- Metrics: LCP, startup, memory
- When: build, load
- Impact: medium, because precaching makes repeat visits network-free but downloads everything in the list on first install.
- Do: Generate the manifest with `workbox-build`, `workbox-webpack-plugin` or `workbox-cli` (or `injectManifest`); set `revision: null` for hashed URLs and a content hash for unhashed ones such as `index.html`. Call `precacheAndRoute()` before other `registerRoute()` calls. Turn on `cleanupOutdatedCaches`.
- Why: Workbox downloads only new or changed entries on each install, deletes removed entries in `activate`, and serves precached URLs cache-first. Route order matters: an earlier route that matches wins over the precache route.
- Example:
  ```js
  import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
  cleanupOutdatedCaches();
  precacheAndRoute(self.__WB_MANIFEST, {
    ignoreURLParametersMatching: [/^utm_/, /^fbclid$/], // the default
    cleanURLs: false,       // do not guess /about -> /about.html in an SPA
  });
  ```
- Avoid/caveats: Never hand-write revisions ("precached URLs will not be kept up to date"). Do not precache large, rarely used, device-specific (responsive images) or language-specific files; the runtime-caching article calls that an "anti-pattern". Default URL rewrites (`directoryIndex`, clean URLs) can surprise an SPA. Optional `integrity` per entry makes install fail on a mismatch.
- Status: String manifest entries were deprecated in Workbox v5 and removed in v6. Workbox is maintained with dependency updates (v7.4.0 2025-11-19, v7.4.1 2026-05-05).
- Sources: https://developer.chrome.com/docs/workbox/modules/workbox-precaching, https://github.com/GoogleChrome/workbox/releases

### Register the service worker after the page has loaded
- Layer: js
- Stage: network, main-thread-task
- Metrics: LCP, TBT, INP
- When: load
- Impact: medium on first visit, because worker startup and precache downloads compete with critical resources for bandwidth, CPU and memory; no effect on repeat visits.
- Do: Call `navigator.serviceWorker.register()` inside a `load` listener, or after the app signals its first render is done.
- Why: An inline register call is found early by the parser, so precaching can start before the critical assets finish. After activation, `register()` is effectively a no-op.
- Example:
  ```js
  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
  }
  ```
- Avoid/caveats: Register earlier only if you rely on `clients.claim()` plus runtime caching during the first visit, and then keep the install handler light.
- Status: Current guidance (article last updated 2016-11-28, still linked from web.dev).
- Sources: https://web.dev/articles/service-workers-registration

### Keep install and activate handlers small; put only true dependencies in waitUntil
- Layer: js
- Stage: network, main-thread-task
- Metrics: TTFB, LCP
- When: load
- Impact: medium, because fetch events are queued while the worker activates, so a slow `activate` blocks page loads.
- Do: In `install`, `waitUntil` only the files the app cannot run without. Start optional large downloads without returning them to `waitUntil` and handle their absence later. In `activate`, only delete old caches and run migrations that could not run while the old worker was active.
- Why: A rejected `waitUntil` promise (for example one failed `cache.addAll` URL) abandons the whole install. A long activate delays every queued fetch.
- Example:
  ```js
  self.addEventListener('install', (e) => {
    e.waitUntil(caches.open('shell-v12').then((c) => c.addAll(CORE))); // must succeed
    caches.open('extras-v12').then((c) => c.addAll(OPTIONAL)).catch(() => {}); // best effort
  });
  ```
- Avoid/caveats: The worker can be terminated after install ends, so best-effort downloads may not finish; re-check and retry later. Caches are shared by the whole origin: only delete names your worker owns.
- Status: Cache API Chrome 43, Firefox 41, Safari 11.1 (BCD); Baseline widely available.
- Sources: https://web.dev/articles/offline-cookbook

### Cap every runtime cache with expiration rules and separate cache names
- Layer: js
- Stage: gc-memory, network
- Metrics: memory
- When: long-lived session
- Impact: medium, because unbounded caches fill the origin quota, which is shared with IndexedDB, and make the origin a first target for eviction.
- Do: Give each asset type its own `cacheName` and attach `ExpirationPlugin` with `maxEntries` and/or `maxAgeSeconds`. Delete caches you no longer use.
- Why: Eviction under storage pressure removes whole origins, not single entries. Small, bounded caches keep the important data.
- Example:
  ```js
  import { ExpirationPlugin } from 'workbox-expiration';
  new CacheFirst({ cacheName: 'symbol-logos', plugins: [
    new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 3600 }),
  ] });
  ```
- Avoid/caveats: `ExpirationPlugin` works only on strategies with a configured `cacheName`.
- Status: Workbox v7 docs, current.
- Sources: https://developer.chrome.com/docs/workbox/caching-resources-during-runtime, https://web.dev/articles/offline-cookbook

### Request CORS for cross-origin assets you cache, and do not cache opaque responses cache-first
- Layer: html, network
- Stage: network, gc-memory
- Metrics: memory, LCP
- When: load, long-lived session
- Impact: medium, because an opaque (no-cors) response hides its status, so a cached error can stick forever, and Chromium pads each opaque entry's quota size by a pseudo-random 0 to about 14.1 MiB.
- Do: Add `crossorigin="anonymous"` to cross-origin `<img>`, `<link rel=stylesheet>` and `<script>` you want to cache, and make the CDN send CORS headers. Cache any remaining opaque responses only with network-first or stale-while-revalidate. Use `CacheableResponsePlugin({ statuses: [0, 200] })` with cache-first only when you are sure.
- Why: Without `crossorigin`, the browser makes no-cors requests even if the server allows CORS, so the response is opaque. Padding stops size-based cross-origin leaks but inflates quota use: 20 small opaque logos can count as about 140 MB on average.
- Example:
  ```html
  <!-- Before: opaque, status unknown, padded in quota -->
  <img src="https://cdn.example.com/logos/AAPL.png" alt="">
  <!-- After: CORS response, readable status, real size -->
  <img src="https://cdn.example.com/logos/AAPL.png" crossorigin="anonymous" alt="">
  ```
- Avoid/caveats: If the server does not send `Access-Control-Allow-Origin`, adding `crossorigin` makes the load fail. The Workbox doc says the Chrome padding minimum is "approximately 7 megabytes"; Chromium source (`storage/common/quota/padding_key.cc`, `kPaddingRange = 14431 * 1024`) shows a range starting at 0 with a mean of about 7 MiB, so treat 7 MB as an average, not a minimum.
- Status: Current Chromium main (checked 2026-09-22).
- Sources: https://developer.chrome.com/docs/workbox/caching-resources-during-runtime, https://chromium.googlesource.com/chromium/src/+/main/storage/common/quota/padding_key.cc

### Ask for persistent storage for offline-critical data, and check quota before large writes
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: low to medium, because without persistence the browser may drop the whole origin under storage pressure (and Safari drops it after 7 days of Safari use without interaction).
- Do: Call `navigator.storage.estimate()` before large cache writes. Call `navigator.storage.persist()` for data the user explicitly saved for offline use. Design for data loss anyway.
- Why: Cache Storage, IndexedDB, OPFS and localStorage share one origin quota. Persistent origins are excluded from LRU eviction in WebKit and Chromium.
- Example:
  ```js
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  if (quota - usage > 50e6 && (await navigator.storage.persist())) enableOfflineHistory();
  ```
- Avoid/caveats: Grants are heuristic (WebKit grants mainly to Home Screen web apps). Safari ITP deletes script-writable storage, including "Service Worker registrations and cache", after 7 days of Safari use without user interaction; installed Home Screen apps have their own counter. Safari 17 quotas: up to 60% of disk per origin in browser apps. The sw-http-cache article claims a much higher chance that SW-cached content stays; that is true only relative to the HTTP cache.
- Status: Storage Manager Baseline widely available (low 2023-09-18, high 2026-03-18, webstatus.dev). `persist()` Chrome 55, Firefox 57, Safari 15.2; `estimate()` Safari 17 (BCD).
- Sources: https://web.dev/articles/offline-cookbook, https://webkit.org/blog/14403/updates-to-storage-policy/ (2023-08-10), https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ (2020-03-24)

### Show cached data first, then replace it with network data without moving what the user is reading
- Layer: js
- Stage: network, layout
- Metrics: FCP, LCP, CLS
- When: load, interaction
- Impact: medium, because the page paints real content immediately instead of a spinner, but careless replacement causes layout shifts.
- Do: In the page, start the network request and the `caches.match()` read in parallel. Render cached data only if network data has not arrived yet. Insert newer rows above old ones and keep scroll position, or update values in place.
- Why: The cache read is local and fast; the network result is fresh. A flag prevents stale cache data from overwriting newer network data.
- Example:
  ```js
  let gotNetwork = false;
  const net = fetch('/api/watchlist').then((r) => r.json()).then((d) => { gotNetwork = true; render(d, { stale: false }); });
  caches.match('/api/watchlist').then((r) => r?.json()).then((d) => { if (d && !gotNetwork) render(d, { stale: true }); });
  await net.catch(showOfflineBanner);
  ```
- Avoid/caveats: Label stale prices or balances visibly. Replacing content in place can shift layout (CLS); reserve space. The service worker for this pattern must write network responses to the cache.
- Status: Standard Cache API and fetch; Baseline widely available.
- Sources: https://web.dev/articles/offline-cookbook

### Race cache and network only for small assets, and use Promise.any
- Layer: js
- Stage: network
- Metrics: LCP
- When: load
- Impact: low, because it helps only when disk reads are slower than the network (old disks, antivirus scans) and it spends data.
- Do: Use `Promise.any([caches.match(req), fetch(req)])` for small assets only. Prefer static routing `race-network-and-fetch-handler` where supported.
- Why: The first fulfilled source wins; `Promise.race` would reject on the first rejection (for example a cache miss that throws).
- Example:
  ```js
  // Before: hand-written promiseAny helper from the 2014 article
  // After:
  e.respondWith(Promise.any([
    caches.match(e.request).then((r) => r ?? Promise.reject(new Error('miss'))),
    fetch(e.request),
  ]));
  ```
- Avoid/caveats: Wastes the user's data when the cache would have been enough.
- Status: `Promise.any` Baseline widely available (low 2020-09-16, high 2023-03-16, webstatus.dev).
- Sources: https://web.dev/articles/offline-cookbook

### Precache a generic fallback and return it when both cache and network fail
- Layer: js
- Stage: network
- Metrics: FCP
- When: load
- Impact: low, because it improves offline failure UX, not speed.
- Do: Precache an offline page and placeholder images as install dependencies. Return them from a catch handler, or use Workbox `PrecacheFallbackPlugin({ fallbackURL })` or `setCatchHandler`. For failed POSTs, store the request in IndexedDB and tell the page it was kept.
- Why: A fallback that is not itself cached fails exactly when you need it.
- Avoid/caveats: Never queue trading orders offline for later replay without explicit user confirmation.
- Status: Workbox v7 docs, current.
- Sources: https://web.dev/articles/offline-cookbook, https://developer.chrome.com/docs/workbox/modules/workbox-precaching

### Send an explicit Cache-Control on every response; never rely on heuristic freshness
- Layer: network
- Stage: network
- Metrics: LCP, FCP
- When: load, build
- Impact: high on repeat visits, because without the header each file gets its own implicit lifetime, and users can run JS from one release with CSS from another.
- Do: Configure the server or CDN to send `Cache-Control` on every response class (see the next item for values).
- Why: Leaving out `Cache-Control` does not disable caching. Browsers use a heuristic lifetime of a fraction (RFC 9111: "A typical setting of this fraction might be 10%") of the time since `Last-Modified`, so a file changed a month ago is reused for about three more days, and files deployed at different times expire at different times.
- Avoid/caveats: Heuristic freshness also applies to 3xx and other heuristically cacheable responses.
- Status: RFC 9111 section 4.2.2 (current HTTP caching standard).
- Sources: https://web.dev/articles/love-your-cache, https://web.dev/articles/http-cache, https://www.rfc-editor.org/rfc/rfc9111

### Pair long-lived hashed assets with no-cache HTML, and keep old hashed files deployed after a release
- Layer: build, network
- Stage: network
- Metrics: LCP, FCP, TTFB
- When: build, load
- Impact: high, because hashed assets then cost zero requests on repeat visits while HTML revalidation still picks up a new release.
- Do: Put a content hash in every JS, CSS, font, icon and data file name (let the bundler do it) and send `Cache-Control: max-age=31536000, immutable`. Send `Cache-Control: no-cache` (with an `ETag`) for HTML and other unversioned URLs. Keep the previous release's hashed files on the server for a while after deploy.
- Why: A new hash means a new URL, so the old cached copy is never used for new HTML. "Love your cache" notes that your site may live "in pieces" in user caches: cached or bfcache-restored HTML can still reference an old `/images/foo.jpeg` or old chunk, so deleting old files breaks lazy loads and code-split chunks.
- Example:
  ```
  /assets/app.3f9c1a.js   Cache-Control: max-age=31536000, immutable
  /index.html             Cache-Control: no-cache   (+ ETag)
  /api/me                 Cache-Control: private, no-cache
  ```
- Avoid/caveats: `immutable` is not supported in Chromium; "Love your cache" says Chrome changed its reload behavior in 2017 so that it acts as if `immutable` were always set. Prefer `no-cache` over the older `max-age=0, must-revalidate` (MDN: equivalent, and `no-cache` is enough today). Add `private` to personalized responses so shared caches never store them.
- Status: `immutable`: Firefox 49, Safari 11, Chrome not supported (BCD). MDN Cache-Control page modified 2026-09-17.
- Sources: https://web.dev/articles/http-cache, https://web.dev/articles/love-your-cache, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control

### Use a middle-ground TTL only for assets whose content has its own lifetime
- Layer: network
- Stage: network
- Metrics: LCP
- When: load
- Impact: low to medium, because a TTL that matches the data's publish interval saves requests without serving wrong data.
- Do: Give an unversioned asset a TTL equal to how long its content stays valid (for example, hourly JSON gets `max-age=3600`). Do not give CSS a middle TTL, because it changes how other resources render. Do not cache one-off timely content (news, alerts) or its large images for long.
- Why: A middle TTL on an asset that depends on others creates version mismatches; on an asset with its own lifetime it cannot be wrong.
- Avoid/caveats: The article pairs `immutable` with `max-age=3600`; that combination means "do not revalidate for an hour", which is fine only if the content truly cannot change within the hour.
- Status: Current HTTP semantics (RFC 9111).
- Sources: https://web.dev/articles/love-your-cache

### Do not count on cross-site cache hits for shared CDN libraries
- Layer: network, build
- Stage: network
- Metrics: LCP, FCP
- When: load, build
- Impact: medium, because the HTTP cache is partitioned by top-level site in all major engines, so a library cached on another site is downloaded again on yours.
- Do: Self-host critical libraries and fonts on your own origin (with hashed names) instead of relying on a public CDN copy "probably already cached".
- Why: Chrome keys cache entries on top-level site, frame site and URL (Chrome 86, 2020); Firefox partitions by top-level site since Firefox 85 (2021); Safari uses top-level eTLD+1. The sw-http-cache article's claim that the HTTP cache is allocated "per-origin" and shared by subdomains is outdated.
- Avoid/caveats: Chrome measured the change as about 3.6% more cache misses and about 4% more bytes from the network.
- Status: Shipped in Chrome, Firefox and Safari.
- Sources: https://developer.chrome.com/blog/http-cache-partitioning (2020-10-06), https://blog.mozilla.org/security/2021/01/26/supercookie-protections/, https://web.dev/articles/service-worker-caching-and-http-caching

### Avoid no-store on HTML unless the page is truly sensitive, because it limits bfcache
- Layer: network
- Stage: network
- Metrics: LCP, INP (back/forward navigations)
- When: load
- Impact: medium, because a bfcache restore is an instant navigation, and `no-store` blocks or shortens it.
- Do: Use `no-cache` or `private, no-cache` for signed-in HTML. Use `no-store` only for responses that must never be written to disk.
- Why: Chrome now lets `Cache-Control: no-store` pages into bfcache only under conditions: it evicts them on cookie or other authorization changes, when the page uses WebSocket, WebTransport or WebRTC, or when a fetch/XHR response is also `no-store`, and it keeps them only 3 minutes (not 10). Other browsers may still block bfcache for such pages.
- Avoid/caveats: A trading terminal with an open WebSocket and `no-store` HTML will usually be evicted, so the bfcache benefit is lost anyway; close or pause sockets on `pagehide` if bfcache matters.
- Status: Chrome rolled this out to 100% in March-April 2025 (Chrome doc, last updated 2025-09-09).
- Sources: https://developer.chrome.com/docs/web-platform/bfcache-ccns, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control

### Run script-controlled DOM animations through element.animate(), and animate only transform and opacity
- Layer: js, css
- Stage: composite, style, main-thread-task
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, interaction
- Impact: medium, because WAAPI uses the browser's animation engine (the same one as CSS animations), so eligible properties can run off the main thread while JS stays busy.
- Do: Replace `requestAnimationFrame` loops that write `style.transform` with `el.animate(keyframes, { duration, easing })`. Keep keyframes to `transform` and `opacity`. Durations are in milliseconds; `iterations: Infinity` replaces `infinite`; the default `easing` is `linear` (CSS default is `ease`).
- Why: A rAF loop runs on the main thread each frame and janks when a long task runs. A WAAPI animation of `transform`/`opacity` is handed to the compositor. The MDN demo also animates `color`, which still needs main-thread style and paint every frame.
- Example:
  ```js
  // Before: main-thread loop
  function step(t) { panel.style.transform = `translateY(${ease(t) * 40}px)`; if (t < 1) requestAnimationFrame(step); }
  // After: compositor-eligible, cancellable, awaitable
  const anim = panel.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(40px)' }],
    { duration: 180, easing: 'ease-out' });
  ```
- Avoid/caveats: WAAPI is not a speed-up for layout or paint properties (width, top, color). Do not use it for canvas/WebGL chart content, which needs its own render loop. Pages with many simultaneous animations still cost memory for each `Animation` object.
- Status: Web Animations Baseline widely available (low 2020-09-16, high 2023-03-16, webstatus.dev).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API, https://web.dev/articles/animations-guide

### Persist an animation's end state with commitStyles(), not with an endless fill
- Layer: js
- Stage: style, gc-memory
- Metrics: memory, FPS/smoothness
- When: animation/render-loop, long-lived session
- Impact: low to medium, because forward-filling animations stay alive, keep costing resources, and override normal styles in the cascade.
- Do: After `await anim.finished`, call `anim.commitStyles()` and then `anim.cancel()`. Keep `fill: 'forwards'` for older engines, because there is no feature test for the newer behavior.
- Why: `commitStyles()` writes the current computed values into the element's inline `style`, after which the element can be restyled normally. Browsers auto-remove filling animations that a newer animation fully replaces (a `remove` event fires; `replaceState` becomes `removed`), unless you call `persist()`.
- Example:
  ```js
  const a = row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: 'forwards' });
  await a.finished;
  a.commitStyles(); // writes opacity: 1 to style=""
  a.cancel();       // frees the animation; no cascade override remains
  ```
- Avoid/caveats: `persist()` on many animations defeats auto-removal and can leak memory. Committed inline styles override stylesheet rules until you clear them.
- Status: `commitStyles`, `persist`, `replaceState`, `remove` event: Chrome 84, Firefox 75, Safari 13.1 (BCD). commitStyles without fill ("end-point inclusive"): Chrome 144, Firefox 142, Safari 26.2 (BCD), so MDN's "on older browsers you must specify fill" is now only about old versions.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API, https://developer.mozilla.org/en-US/docs/Web/API/Animation/commitStyles (modified 2026-09-07)

### Control playback with the Animation object: updatePlaybackRate, finished, and document.getAnimations()
- Layer: js
- Stage: main-thread-task, composite
- Metrics: FPS/smoothness, memory
- When: animation/render-loop, interaction, long-lived session
- Impact: low, because it removes timers and restarts, and lets you stop all motion in one place.
- Do: Change speed with `updatePlaybackRate()` (smooth and synchronized) instead of assigning `playbackRate`. Sequence with `await anim.finished` instead of `setTimeout(duration)`. Create animations that must wait for input with `new Animation(new KeyframeEffect(el, frames, timing))` and call `play()` later, instead of `animate()` then `pause()`. Derive linked durations from `effect.getComputedTiming()`. Use `document.getAnimations()` to slow, finish or cancel all animations (reduced motion, view teardown).
- Why: The `finished` promise resolves exactly at the end (and rejects on cancel), so there is no timer drift. `updatePlaybackRate()` applies the new rate after it syncs with the current playback position, so the speed change does not make the element jump (MDN: it "produces a smooth update").
- Example:
  ```js
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const a of document.getAnimations()) a.finish();
  }
  ```
- Avoid/caveats: `finished` rejects on `cancel()`, so catch it. `getAnimations()` also returns CSS animations and transitions.
- Status: `updatePlaybackRate` Chrome 76, Firefox 60, Safari 13.1; `finished` Chrome 84, Firefox 63, Safari 13.1; `Document.getAnimations` Chrome 84, Firefox 75, Safari 14 (BCD).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API

---

## Standard levers seen

- Clone a response before you both cache and return it; a body can be read only once (Offline Cookbook).
- Use `ETag` (preferred, content-based) or `Last-Modified` so expired entries revalidate with a small `304 Not Modified` (http-cache).
- Use `max-age=31536000` for fingerprinted URLs and `no-cache` for revalidate-every-time resources; use `no-store` only for never-cache data (http-cache).
- Serve the same content at one consistent URL; different URLs are downloaded and stored twice (http-cache appendix).
- Split often-changing code from stable library code into separate files with separate cache lifetimes, to reduce churn (http-cache appendix; bundler code splitting).
- HTTP `stale-while-revalidate` directive hides revalidation latency when some staleness is fine (http-cache appendix). Status: Chrome 75, Firefox 68, Safari 14 (BCD).
- Use a CDN close to users so `no-cache` revalidations stay cheap (love-your-cache).
- Lighthouse measures only an empty cache; Core Web Vitals field data includes repeat visits, so test warm-cache loads too (love-your-cache).
- Delete old versioned caches in `activate` (Offline Cookbook).
- Service-worker-side templating: combine a cached template with JSON for pages whose server HTML cannot be cached (Offline Cookbook).
- Use `will-change: transform` only where layer promotion is needed (MDN demo CSS; the web.dev animations guide says to use it only when you see problems).
- Use `steps(n)` easing for sprite-sheet animation instead of JS frame swapping (MDN demo).

## Outdated advice and myths found in these articles

- "The HTTP cache is allocated per origin and subdomains share it" (sw-http-cache, 2020): outdated. The HTTP cache is partitioned by top-level site in Chrome (86+), Firefox (85+) and Safari.
- "31,536,000 seconds is the maximum supported max-age" (http-cache, 2018): myth. RFC 9111 treats overflow as 2^31 seconds ("represents infinity (over 68 years)"). One year is a convention, not a limit.
- "`immutable` is only needed for Safari and Firefox" (love-your-cache, 2020): still correct per BCD (Chrome does not support it and does not need it).
- "At least two keyframes, or `animate()` may throw NotSupportedError" (MDN): outdated. Implicit from/to keyframes are supported in Chrome 84, Firefox 75, Safari 13.1 (Safari marked partial and buggy in BCD).
- "Set `fill: 'forwards'` to use `commitStyles()`" (MDN commitStyles): needed only for older versions; not needed in Chrome 144, Firefox 142, Safari 26.2+.
- Opaque response padding "minimum about 7 MB" (Workbox runtime doc): imprecise. Chromium pads by 0 to about 14.1 MiB, mean about 7 MiB.
- Offline Cookbook code bugs: `new WindowClient('/inbox/')` is not valid (use `clients.openWindow('/inbox/')`); sync events expose `event.tag`, not `event.id`; `requestURL.path` should be `pathname`; bare `request.method` should be `event.request.method`; the hand-written `promiseAny` is now `Promise.any`.
- Offline Cookbook "On background-sync" and Periodic Background Sync: Chromium-only (SyncManager Chrome 49, PeriodicSyncManager Chrome 80; no Firefox or Safari; webstatus.dev "limited"). Do not base core behavior on them. Push in the service worker now works in Safari 16+.
- Workbox runtime doc sample imports `NetworkFirst, StaleWhileRevalidate` but uses `CacheFirst`, and says "stale-while-validate": typos only; the API names in the rest of the doc are correct.

## Sources read

- https://web.dev/articles/service-worker-caching-and-http-caching (Last updated 2020-07-17)
- https://web.dev/articles/http-cache (Last updated 2018-11-05)
- https://web.dev/articles/handling-navigation-requests (Last updated 2020-07-13)
- https://web.dev/articles/offline-cookbook (Last updated 2014-12-09, body refreshed)
- https://developer.chrome.com/docs/workbox/caching-resources-during-runtime (Last updated 2021-12-07)
- https://developer.chrome.com/docs/workbox/modules/workbox-precaching (Last updated 2017-11-27, v7 reference)
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API (modified 2025-11-07)
- https://web.dev/articles/love-your-cache (Last updated 2020-12-11)
- Verification: https://developer.chrome.com/docs/workbox/modules/workbox-strategies, https://developer.chrome.com/docs/workbox/modules/workbox-routing, https://web.dev/blog/navigation-preload, https://web.dev/articles/service-workers-registration, https://web.dev/articles/animations-guide, https://developer.mozilla.org/en-US/docs/Web/API/InstallEvent/addRoutes, https://developer.mozilla.org/en-US/docs/Web/API/Animation/commitStyles, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control, https://developer.chrome.com/blog/http-cache-partitioning, https://developer.chrome.com/docs/web-platform/bfcache-ccns, https://webkit.org/blog/14403/updates-to-storage-policy/, https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/, https://www.rfc-editor.org/rfc/rfc9111, https://chromium.googlesource.com/chromium/src/+/main/storage/common/quota/padding_key.cc, https://github.com/GoogleChrome/workbox/releases (GitHub API), MDN browser-compat-data JSON (raw.githubusercontent.com/mdn/browser-compat-data/main: http/headers/Cache-Control, api/NavigationPreloadManager, api/SyncManager, api/PeriodicSyncManager, api/SyncEvent, api/WindowClient, api/StorageManager, api/InstallEvent, api/Cache, api/CacheStorage, api/Clients, api/FetchEvent, api/Request, api/Animation, api/Element, api/Document, api/KeyframeEffect, api/ServiceWorkerGlobalScope, browsers/safari), webstatus.dev API (service-workers, service-workers-static-routes, background-sync, periodic-background-sync, storage-manager, web-animations, promise-any)
- Search results only (not opened): Mozilla Firefox 85 network partitioning summary (blog.mozilla.org/security/2021/01/26/supercookie-protections/).

## Not covered / could not access

- The embedded "Love your cache" video (Chrome Dev Summit 2020) was not watched; only the article text was read.
- The Workbox precaching page's full API type reference was skimmed, not studied line by line.
- The CodePen demos linked from the MDN guide were not opened.
- Chrome's exact behavior for `Cache-Control: immutable` on reload was taken from BCD and the love-your-cache note; the 2017 Chrome "reload" blog post was not re-read.
- Whether one-off Background Sync shows a permission prompt in Chromium was not verified.
- Which WAAPI-animated properties beyond `transform` and `opacity` (for example `filter`, `background-color`) Chromium composites today was not verified; other agents cover CSS rendering.
