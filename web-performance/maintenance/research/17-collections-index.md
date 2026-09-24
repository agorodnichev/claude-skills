# 17 — Index of four web.dev collections (INP, Core Web Vitals, Network reliability, Animations)

Research for the personal Claude Code skill "web-performance". Fetched 2026-09-22.

Collections:
- https://web.dev/explore/how-to-optimize-inp
- https://web.dev/explore/learn-core-web-vitals
- https://web.dev/explore/reliable
- https://web.dev/explore/animations

## Method

- Downloaded the raw HTML of each collection with curl and parsed every heading and `<a href>` inside `<article>` (raw: `raw/collections-index/explore-*.html`, link lists: `raw/collections-index/links-*.txt`, parser: `raw/collections-index/links.py`). Every card link sits inside an `<h4>`. The only other article links are the 3 breadcrumb links per page.
- Cross-check: WebFetch of `/explore/reliable` and `/explore/animations` returned the same 21 and 10 links (WebFetch printed "12" as the animations total but listed 10; the raw parse also has 10).
- Downloaded every link that is not covered (44 pages, raw HTML in `raw/collections-index/pages/`, plain text in `raw/collections-index/text/`, redirects in `raw/collections-index/fetch-log.txt`). curl followed redirects; 5 links redirect (see "Redirects").
- One level deep: the only overview/hub link is the MDN "Web Animations API" overview (Animations collection). I opened it and listed its guides and further-reading links (raw in `raw/collections-index/pages/42..44` and `raw/collections-index/pages-l2/`). "Workers overview" (Reliable collection) is the first article of a 4-part series; its "next steps" links are the 3 sibling articles already in the collection plus `off-main-thread` (covered). No link is another `/explore/` page, a `/learn/` course, or a "see all" list.
- Dates: "Pub/Upd" = the Published / Last updated line printed on the article. "Footer" = the devsite footer "Last updated" date (same value as the page's `dateModified` metadata); many older web.dev articles show only this. "MDN mod" = MDN "last modified" date.
- Covered = in `assigned-urls.txt`, marked covered in `16-explore-fast-index.md`, a Learn Performance module, or in the task's named list (optimize LCP/CLS/INP/long tasks/TTFB, bfcache, preload scanner, render-blocking, rendering-performance articles, content-visibility).
- Classes for a developer who writes web code today: **high** (current guidance that changes how we write HTML/CSS/JS, animate, cache, or load; for Reliable: service worker, caching strategy, offline levers for speed or reliability), **medium** (background, measurement, debugging), **low** (outdated, case study with no new levers, pure UX without a performance or reliability lever), **covered**.

## Counts

| Scope | covered | high | medium | low | total |
|---|---|---|---|---|---|
| How to optimize INP | 13 | 0 | 0 | 7 | 20 |
| Learn Core Web Vitals | 22 | 0 | 0 | 3 | 25 |
| Network reliability | 0 | 7 | 9 | 5 | 21 |
| Animations | 0 | 2 | 7 | 1 | 10 |
| One level deep: MDN Web Animations API overview (guides + further reading, excluding the duplicate "Using the WAAPI" link) | 0 | 0 | 5 | 8 | 13 |
| **All** | **35** | **9** | **21** | **24** | **89** |

The MDN overview body also links 16 reference entries (11 API members, the `Document` and `Element` interface pages, 2 CSS property pages, and the Web Animations spec draft). They are reference pages, not articles, so they are listed but not counted (see the end of the Animations section).

## 1. How to optimize INP (https://web.dev/explore/how-to-optimize-inp)

| # | Section | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|---|
| I1 | Familiarize | Interaction to Next Paint (INP) | https://web.dev/articles/inp | Pub 2022-05-06, Upd 2025-09-02 | covered | assigned-urls |
| I2 | Familiarize | Optimize Interaction to Next Paint | https://web.dev/articles/optimize-inp | Pub 2023-05-19, Upd 2025-09-02 | covered | task list |
| I3 | Familiarize | The most effective ways to improve INP | https://web.dev/articles/top-cwv#inp | Footer 2024-10-31 | covered | anchor into top-cwv (assigned-urls) |
| I4 | Troubleshooting | Find slow interactions in the field | https://web.dev/articles/find-slow-interactions-in-the-field | Footer 2024-06-07 | covered | assigned-urls |
| I5 | Troubleshooting | Manually diagnose slow interactions in the lab | https://web.dev/articles/manually-diagnose-slow-interactions-in-the-lab | Pub 2023-05-09, Footer 2024-10-17 | covered | assigned-urls |
| I6 | JavaScript | Optimize long tasks | https://web.dev/articles/optimize-long-tasks | Pub 2022-09-30, Upd 2024-12-19 | covered | task list |
| I7 | JavaScript | Optimize input delay | https://web.dev/articles/optimize-input-delay | Footer 2023-05-09 | covered | assigned-urls |
| I8 | JavaScript | Script evaluation and long tasks | https://web.dev/articles/script-evaluation-and-long-tasks | Footer 2023-05-09 | covered | assigned-urls |
| I9 | JavaScript | Use web workers to run JavaScript off the browser's main thread | https://web.dev/articles/off-main-thread | Footer 2019-12-05 | covered | assigned-urls |
| I10 | Rendering | Avoid large, complex layouts and layout thrashing | https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing | Pub 2015-03-20, Upd 2025-05-07 | covered | task list |
| I11 | Rendering | Reduce the scope and complexity of style calculations | https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations | Footer 2015-03-20 | covered | task list |
| I12 | Rendering | How large DOM sizes affect interactivity | https://web.dev/articles/dom-size-and-interactivity | Footer 2023-05-09 | covered | assigned-urls |
| I13 | Rendering | Client-side rendering of HTML and interactivity | https://web.dev/articles/client-side-rendering-of-html-and-interactivity | Footer 2023-05-09 | covered | assigned-urls |
| I14 | Case studies | QuintoAndar reduced INP by 80% | https://web.dev/case-studies/quintoandar-inp | Pub 2025-01-22 | low | Case study: React `useTransition`, debouncing, `scheduler.yield`, LoAF monitoring, performance governance. Levers already in covered INP guides. |
| I15 | Case studies | Disney+ Hotstar (living-room devices) | https://web.dev/case-studies/hotstar-inp | Footer 2024-05-22 | low | Case study on TV tray navigation: custom carousel reads dimensions once per tray (no layout thrashing) with composited animations, lazy-loads off-screen trays, splits rendering with `setTimeout` yields. Levers are in covered layout-thrashing and long-task guides. |
| I16 | Case studies | PubTech consent platform | https://web.dev/case-studies/pubconsent-inp | Footer 2024-02-28 | low | Case study: yield by task priority with `scheduler.yield`/`postTask`; same as covered optimize-long-tasks. |
| I17 | Case studies | Taboola used LoAF | https://web.dev/case-studies/taboola-inp | Footer 2024-02-01 | low | Case study: a third-party script vendor used LoAF to measure its own script's share of slow frames on publisher sites, then built a yielding scheduler on `scheduler.postTask`; no new API. |
| I18 | Case studies | Economic Times quest for fixing INP | https://web.dev/case-studies/economic-times-inp | Footer 2023-05-10 | low | Case study: TBT-driven work (less main-thread JS, `requestIdleCallback`, smaller DOM). |
| I19 | Case studies | redBus improved INP | https://web.dev/case-studies/redbus-inp | Footer 2023-05-10 | low | Case study: debounced `scroll` handler, render work in `requestAnimationFrame`, smaller lazy-load batches (30 → 10 results per fetch cut INP), expensive reducer on input `change`. Levers are in covered input-delay/long-task guides. |
| I20 | Case studies | Trendyol reduced INP by 50% | https://web.dev/case-studies/trendyol-inp | Footer 2023-12-11 | low | Case study: `scheduler.yield` in an IntersectionObserver-driven list; covered levers. |

## 2. Learn Core Web Vitals (https://web.dev/explore/learn-core-web-vitals)

| # | Section | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|---|
| C1 | Overview | Web Vitals | https://web.dev/articles/vitals | Pub 2020-05-04, Upd 2024-10-31 | covered | assigned-urls |
| C2 | Overview | The business impact of Core Web Vitals | https://web.dev/case-studies/vitals-business-impact | Footer 2021-09-01 | low | Business case-study roundup; no code levers. |
| C3 | Overview | Optimizing Core Web Vitals for business decision makers | https://web.dev/articles/optimize-cwv-business | Footer 2023-10-27 | low | Written for managers; no new levers. |
| C4 | Metrics | Largest Contentful Paint (LCP) | https://web.dev/articles/lcp | Pub 2019-08-08, Upd 2025-09-04 | covered | assigned-urls |
| C5 | Metrics | Cumulative Layout Shift (CLS) | https://web.dev/articles/cls | Footer 2023-04-12 | covered | assigned-urls |
| C6 | Metrics | Interaction to Next Paint (INP) | https://web.dev/articles/inp | see I1 | covered | assigned-urls |
| C7 | Metrics | Defining the Core Web Vitals metrics thresholds | https://web.dev/articles/defining-core-web-vitals-thresholds | Pub 2020-05-21, Upd 2025-05-07 | low | Research rationale for thresholds and p75; the numbers are already in C1. |
| C8 | Measure | Getting started with measuring Web Vitals | https://web.dev/articles/vitals-measurement-getting-started | Footer 2025-09-09 | covered | assigned-urls |
| C9 | Measure | Core Web Vitals workflows with Google tools | https://web.dev/articles/vitals-tools | Footer 2025-02-28 | covered | assigned-urls |
| C10 | Measure | Best practices for measuring Web Vitals in the field | https://web.dev/articles/vitals-field-measurement-best-practices | Footer 2022-05-11 | covered | assigned-urls |
| C11 | Measure | Why is CrUX data different from my RUM data? | https://web.dev/articles/crux-and-rum-differences | Pub 2022-08-15, Upd 2025-12-17 | covered | assigned-urls |
| C12 | Debug | Why lab and field data can be different | https://web.dev/articles/lab-and-field-data-differences | Footer 2022-07-18 | covered | assigned-urls |
| C13 | Debug | Debug layout shifts | https://web.dev/articles/debug-layout-shifts | Pub 2021-03-11, Upd 2025-02-07 | covered | assigned-urls |
| C14 | Debug | Debug performance in the field | https://web.dev/articles/debug-performance-in-the-field | Footer 2024-10-06 | covered | assigned-urls |
| C15 | Improve | Optimize Largest Contentful Paint | https://web.dev/articles/optimize-lcp | Pub 2020-04-30, Upd 2025-03-31 | covered | task list |
| C16 | Improve | Optimize Cumulative Layout Shift | https://web.dev/articles/optimize-cls | Pub 2020-05-05, Upd 2025-02-07 | covered | task list |
| C17 | Improve | Optimize Interaction to Next Paint | https://web.dev/articles/optimize-inp | see I2 | covered | task list |
| C18 | Improve | The most effective ways to improve Core Web Vitals | https://web.dev/articles/top-cwv | Footer 2024-10-31 | covered | assigned-urls |
| C19 | Best practices | Best practices for carousels | https://web.dev/articles/carousel-best-practices | Footer 2021-01-26 | covered | assigned-urls |
| C20 | Best practices | Best practices for cookie notices | https://web.dev/articles/cookie-notice-best-practices | Footer 2024-06-13 | covered | assigned-urls |
| C21 | Best practices | Best practices for fonts | https://web.dev/articles/font-best-practices | Footer 2022-10-04 | covered | assigned-urls |
| C22 | Best practices | Best practices for tags and tag managers | https://web.dev/articles/tag-best-practices | Footer 2022-08-24 | covered | assigned-urls |
| C23 | Best practices | Best practices for using third-party embeds | https://web.dev/articles/embed-best-practices | Footer 2021-10-05 | covered | assigned-urls |
| C24 | Best practices | Infinite scroll without layout shifts (Addy Osmani) | https://addyosmani.com/blog/infinite-scroll-without-layout-shifts/ | Blog 2020-07-30 | covered | assigned-urls |
| C25 | Best practices | CSS for Web Vitals | https://web.dev/articles/css-web-vitals | Footer 2021-06-02 | covered | assigned-urls |

## 3. Network reliability (https://web.dev/explore/reliable)

| # | Section | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|---|
| R1 | Measure | What is network reliability and how do you measure it? | https://web.dev/articles/network-connections-unreliable | Footer 2018-11-05 | low | Short intro ("offline" vs "reliably fast on lie-fi"). Its yardstick, the Lighthouse "responds with 200 when offline" audit, is gone: Lighthouse 12 removed the whole PWA category (PageSpeed Insights release notes, 2024-05-10). |
| R2 | Measure | Identify resources loaded from the network | https://web.dev/articles/identify-resources-via-network-panel | Footer 2018-11-05 | low | Basic DevTools Network-panel tutorial (Name/Type/Waterfall). Only idea: cache critical-path requests hard, late requests less; R9 says it better. |
| R3 | Measure | Measuring offline usage | https://web.dev/articles/measuring-offline-usage | Footer 2020-10-28 | medium | Measurement: `online`/`offline` events only know about network access, not Internet access, and miss SPA failures; better: a service-worker catch handler posts `network_fail` messages to the page for analytics. Caveat: its `workbox-google-analytics` recipe is dead (the module page says it is deprecated because it does not work with GA4). |
| R4 | Toolbox | Prevent unnecessary network requests with the HTTP Cache | https://web.dev/articles/http-cache | Footer 2018-11-05 | **high** | Core header rules: hashed/versioned URLs get `Cache-Control: max-age=31536000` (+`immutable`); unversioned URLs (HTML) get `no-cache` plus `ETag` for cheap 304 revalidation; `no-store` only for never-cache data; `private` vs `public`; a missing `Cache-Control` still caches by heuristic; use consistent URLs; split fast-changing code from stable library code; `stale-while-revalidate` when staleness is OK. |
| R5 | Toolbox | Love your cache | https://web.dev/articles/love-your-cache | Footer 2020-12-11 | **high** | Repeat-visit rules: a safe default is `max-age=0, must-revalidate` (= `no-cache`) served from a CDN; fingerprinted assets `max-age=31536000, immutable`; heuristic caching (about 10% of the file's age since `Last-Modified`) can mix files from different releases, so do not give CSS/JS that must match the HTML a "middle" TTL. Note: MDN BCD lists `immutable` as unsupported in Chrome (Firefox 49, Safari 11), so it helps only those engines. |
| R6 | Toolbox | The Cache API: A quick guide | https://web.dev/articles/cache-api-quick-guide | Footer 2017-10-03 | medium | Reference: `add`/`addAll` reject on non-2xx and cannot store opaque responses (`put` can); matching uses URL, query string, `Vary`, and method (`ignoreSearch`/`ignoreVary`/`ignoreMethod`); no search API, so keep an index in IndexedDB; usable from window and workers, not only the service worker. |
| R7 | Toolbox | Service workers and the Cache Storage API | https://web.dev/articles/service-workers-cache-storage | Footer 2018-11-05 | medium | Two rules worth keeping: Cache Storage ignores `Cache-Control` and never expires entries (your code must evict), and filling it reads through the HTTP cache, so a long TTL on an unversioned URL puts stale content into the SW cache. R9 covers the strategy side in more depth. |
| R8 | Toolbox | Workbox: your high-level service worker toolkit | https://web.dev/articles/workbox | Footer 2018-11-05 | low | Outdated 2018 intro: Workbox 3.6.3 CDN `importScripts` with the old `workbox.strategies.cacheFirst` namespace API, and create-react-app integration (React deprecated CRA on 2025-02-14). Use R11/R12 (current Workbox docs) instead. Workbox itself is maintained: v7.4.1 released 2026-05-05 (GitHub API). |
| R9 | Toolbox | Service worker caching and HTTP caching | https://web.dev/articles/service-worker-caching-and-http-caching | Footer 2020-07-17 | **high** | Request order: SW cache → HTTP cache → network. Strategy per data type: network-only (payments, balances), network-first (prices, rates, order status), stale-while-revalidate (feeds, messages), cache-first (app shell), cache-only (static). SW TTL may be longer than HTTP `max-age`; network-first/SWR need extra cache-busting because the HTTP cache can answer the SW's "network" fetch. |
| R10 | Strategies | The Offline Cookbook (now titled "Common techniques to build offline applications") | https://web.dev/articles/offline-cookbook | Footer 2014-12-09 (body refreshed: uses `navigator.storage.estimate()`) | **high** | Canonical SW patterns. When to cache: install (as a dependency or not), activate (delete old caches, migrate IndexedDB), on user action, on network response, SWR. How to serve: cache-only, network-only, cache-first, cache-network race, network-first (flaw: users on flaky links wait for the network to fail), cache-then-network (render cached first, then update without moving what the user is reading), generic fallback. `navigator.storage.estimate()`/`persist()` for quota and eviction. The hand-written `promiseAny` can now be `Promise.any()` (Baseline widely available). |
| R11 | Strategies | Precaching with Workbox | https://developer.chrome.com/docs/workbox/modules/workbox-precaching | Footer 2017-11-27 (current v7 docs) | **high** | Precache from a build-generated manifest only (`{url, revision}`; `revision: null` for hashed URLs); never hand-write revisions; old entries are removed in `activate`; `precacheAndRoute()` must run before other `registerRoute()` calls; `cleanupOutdatedCaches()`; optional `integrity` (SRI) per entry. |
| R12 | Strategies | Runtime caching with Workbox | https://developer.chrome.com/docs/workbox/caching-resources-during-runtime | Footer 2021-12-07 | **high** | Do not precache large, rarely used, device- or locale-specific assets; route with match callbacks on `request.destination` (not file extensions); separate caches per type; `ExpirationPlugin` (`maxEntries`/`maxAgeSeconds`) for quota; `no-cors` subresources give opaque responses, so add `crossorigin` if the SW must read them; never cache opaque responses cache-first (a cached error sticks); opaque responses are padded heavily in quota accounting. |
| R13 | Strategies | Handling navigation requests | https://web.dev/articles/handling-navigation-requests | Footer 2020-07-13 | **high** | Answering navigations (`request.mode === 'navigate'`) from the SW is the biggest SW speed win. HTML stays `Cache-Control: no-cache`. SPA: serve one precached app-shell HTML for every navigation (Workbox `navigateFallback` with allow/deny lists). If navigations still go to the network, enable navigation preload so SW startup does not add latency (MDN BCD: Chrome 59, Firefox 99, Safari 15.4). |
| R14 | Advanced | Resilient search experiences (codelab) | https://web.dev/articles/codelab-building-resilient-search-experiences | Footer 2020-06-23 | low | Codelab using the old namespaced Workbox API; its offline-fallback page is in R10/R12, and its Background Sync queue is Chromium-only (webstatus.dev "limited"; MDN BCD: no Firefox, no Safari). |
| R15 | Advanced | Instant navigation experiences | https://web.dev/case-studies/instant-navigation-experiences | Footer 2020-06-23 | medium | SW-assisted prefetch: precache shared subresources of next pages, extend `<link rel=prefetch>` lifetime (Chrome keeps prefetched resources about 5 min) with a runtime cache, or delegate prefetch lists to the SW with `postMessage`; warns to use navigation preload. Speculation Rules (Chromium-only, webstatus.dev "limited") now cover document prefetch. |
| R16 | Advanced | Offline UX design guidelines | https://web.dev/articles/offline-ux-design-guidelines | Pub 2016-11-10 | low | UX guidance (tell users the connection state, show what is available offline, skeletons, do not block content); no code lever. |
| R17 | Advanced | Extending Workbox → redirects to "Using plugins" | https://web.dev/extending-workbox → https://developer.chrome.com/docs/workbox/using-plugins | Footer 2022-02-02 | medium | Built-in plugins (BackgroundSync, BroadcastUpdate, CacheableResponse, Expiration, RangeRequests) and the lifecycle callbacks for custom plugins (for example, a `cacheWillUpdate` check). Useful only if the SW uses Workbox. |
| R18 | Workers | Workers overview | https://web.dev/articles/workers-overview | Footer 2020-12-08 | medium | Background: web worker (per page, offload computation, dies with the tab) vs service worker (one per scope, network proxy, outlives tabs); Comlink and `workbox-window`. Overlaps the covered off-main-thread and worker modules. |
| R19 | Workers | Imperative caching guide | https://web.dev/articles/imperative-caching-guide | Footer 2020-12-08 | medium | Page → SW one-way messages to prefetch and cache data (for example JSON for likely next views) off the main thread; best-effort, the page never waits on the result. |
| R20 | Workers | Broadcast updates to pages with service workers | https://web.dev/articles/broadcast-updates-guide | Footer 2020-12-08 | medium | SW → page messages: show "new version available" on `workbox-window` `installed` with `isUpdate`, or tell the page that cached data changed; BroadcastChannel (Baseline widely available 2024-09-14), `Client.postMessage`, MessageChannel. Relevant to the stale-app-shell problem after deploys. |
| R21 | Workers | Two-way communication with service workers | https://web.dev/articles/two-way-communication-guide | Footer 2020-12-08 | medium | `messageSW()`/MessageChannel request-response with the SW, progress reporting; Background Sync and Background Fetch are Chromium-only (webstatus.dev "limited"). |

## 4. Animations (https://web.dev/explore/animations)

| # | Section | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|---|
| A1 | How browsers render | Why are some animations slow? | https://web.dev/articles/animations-overview | Footer 2020-10-06 | medium | Background: style → layout → paint → composite; only `transform` and `opacity` are cheap; CSS/WAAPI animations of those can run on the compositor thread; each layer costs memory and GPU upload. Duplicates the covered compositor-only article; assumes a 60 fps target (16.7 ms), which ignores high-refresh displays. |
| A2 | CSS | CSS animations API guide (MDN "Using CSS animations") | https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Animations/Using_CSS_animations → https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Animations/Using | MDN mod 2025-12-15 | medium | Reference for `@keyframes`/`animation-*` and animation events. Perf notes: browser-driven animations can skip frames and throttle in hidden tabs; `animation-fill-mode: forwards` keeps the element's stacking context after the end; animate a wrapper with `transform` instead of box-model properties; section on animating `display`/`content-visibility`. |
| A3 | CSS | How to create high-performance CSS animations | https://web.dev/articles/animations-guide | Footer 2020-10-06 | medium | Concrete but mostly a duplicate of the covered compositor-only article: move/scale/rotate with `transform`, fade with `opacity`; `will-change` only for elements that change often, else set it from JS shortly before the change and remove it after; `translateZ(0)` fallback is legacy. DevTools checks (Performance summary, paint flashing, frame stats) date from 2020. |
| A4 | CSS | Examples of high-performance CSS animations | https://web.dev/articles/animations-examples | Footer 2020-10-23 | low | Walkthrough of three CodePen demos that already follow A3; no new lever. |
| A5 | CSS | prefers-reduced-motion: Sometimes less movement is more | https://web.dev/articles/prefers-reduced-motion | Footer 2019-03-11 | **high** | Changes how we write animation code: put non-essential motion under `@media (prefers-reduced-motion: no-preference)`; for JS/WAAPI animations listen to `matchMedia('(prefers-reduced-motion: reduce)')` `change` events and stop running animations (parentheses are required); `<picture>` `<source media>` to swap animated images for static ones. Baseline widely available since 2022-07-15 (webstatus.dev). Two caveats: the tip that `<link media="(prefers-reduced-motion: no-preference)">` spares the download is wrong (browsers still fetch non-matching stylesheets, at Lowest priority and without blocking render; see T. Steiner's post), and the `Sec-CH-Prefers-Reduced-Motion` hint is Chrome-only (MDN BCD: Chrome 108; no Firefox or Safari). |
| A6 | CSS | Debug CSS animations with Chrome DevTools | https://developers.google.com/web/tools/chrome-devtools/inspect-styles/animations → https://developer.chrome.com/docs/devtools/css/animations/ | Footer 2024-04-16 | medium | Animations panel: capture animation groups, slow down/replay, scrub timing, edit `@keyframes` live, inspect `::view-transition` pseudo-elements. |
| A7 | CSS | Debug CSS animations with Firefox DevTools | https://developer.mozilla.org/en-US/docs/Tools/Page_Inspector/How_to/Work_with_animations → https://firefox-source-docs.mozilla.org/devtools-user/page_inspector/how_to/work_with_animations/index.html | no date shown | medium | Firefox's animation inspector marks which properties run on the compositor (lightning bolt) and explains why one does not, for example `transform` stays on the main thread while a geometric property such as `left` animates on the same element. |
| A8 | JavaScript | Web Animations API overview (MDN) | https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API | MDN mod 2026-09-11 | medium | Hub page (opened one level deep, see below): interface list and links to the guides; accessibility pointers to reduced-motion resources. |
| A9 | JavaScript | Web Animations API guide (MDN "Using the Web Animations API") | https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API | MDN mod 2025-11-07 | **high** | How to write JS animations without rAF loops: `element.animate(keyframes, {duration, iterations, easing})` (durations in ms), `play/pause/reverse/updatePlaybackRate`, `finished` promise, `document.getAnimations()` for global control; keep the end state with `commitStyles()` and then cancel, not with `fill: 'forwards'`; the browser auto-removes replaced filling animations unless `persist()` is called. Web Animations is Baseline widely available (webstatus.dev, 2023-03-16). |
| A10 | JavaScript | Web Animations API improvements in Chromium 84 | https://web.dev/blog/web-animations | Pub 2020-05-27 | medium | Background on the same features: `ready`/`finished` promises for sequencing, replaceable animations (automatic cleanup prevents memory growth when you create an animation per `pointermove`), `replaceState`/`commitStyles()`/`persist()`, composite modes `replace`/`add`/`accumulate`. A9 is the current reference. |

### One level deep: MDN Web Animations API overview (A8)

Guides (the overview's own articles; "Using the Web Animations API" is A9 and not repeated):

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| A8.1 | Web Animations API Concepts | https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Web_Animations_API_Concepts | MDN mod 2025-04-03 | medium | Background: timing model vs animation model, timeline, `Animation`, `KeyframeEffect`, and how CSS animations/transitions map onto WAAPI. |
| A8.2 | Keyframe Formats | https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Keyframe_Formats | MDN mod 2025-11-07 | medium | Reference: array vs object keyframes, implicit from/to keyframes, `offset`, per-keyframe `easing` and `composite`. |
| A8.3 | Web animation API tips and tricks | https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Tips | MDN mod 2025-12-17 | medium | Replay a finished animation with `element.animate()`; wait for `finish` before restarting; animated properties act as if listed in `will-change`, so with fill `forwards`/`both` a new stacking context stays after the end. |

Further-reading links in the overview's Accessibility and See-also sections:

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| A8.4 | prefers-reduced-motion (MDN reference) | https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion | MDN mod 2026-06-10 | medium | Current syntax and support reference for A5. |
| A8.5 | CSS scroll-driven animations (MDN guide hub) | https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations | MDN mod 2026-09-22 | medium | Newer lever that no web.dev article in this collection covers: `animation-timeline` scroll/view timelines instead of scroll listeners. Availability is limited (webstatus.dev: Chrome 115 in 2023-07, Safari 26 in 2025-09, no Firefox). |
| A8.6 | Sec-CH-Prefers-Reduced-Motion (MDN) | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-CH-Prefers-Reduced-Motion | MDN mod 2025-12-17 | low | Chrome-only client hint (MDN BCD: Chrome 108; no Firefox or Safari). |
| A8.7 | HTTP Client hints (MDN guide, "user agent client hint" link) | https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Client_hints | MDN mod 2025-12-15 | low | General HTTP guide; outside animation performance. |
| A8.8 | Designing Safer Web Animation For Motion Sensitivity (A List Apart) | https://alistapart.com/article/designing-safer-web-animation-for-motion-sensitivity/ | Pub 2015-09-08 | low | Design and accessibility essay; no performance lever. |
| A8.9 | An Introduction to the Reduced Motion Media Query (CSS-Tricks) | https://css-tricks.com/introduction-reduced-motion-media-query/ | Pub 2017-02-10, Mod 2019-04-24 | low | Older duplicate of A5. |
| A8.10 | Responsive Design for Motion (WebKit blog) | https://webkit.org/blog/7551/responsive-design-for-motion/ | Pub 2017-05-15 | low | Original 2017 announcement of the media query; duplicate of A5. |
| A8.11 | MDN Understanding WCAG, Operable (guideline 2.2) | https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG/Operable | MDN mod 2026-09-03 | low | Accessibility guidance (enough time, pause controls); no performance lever. |
| A8.12 | Understanding Success Criterion 2.2.2 (W3C WCAG 2.0) | https://www.w3.org/TR/UNDERSTANDING-WCAG20/time-limits-pause.html | no date shown | low | Pause/stop/hide rule for auto-moving content; accessibility, not performance. |
| A8.13 | CSS animations (MDN module hub) | https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Animations | MDN mod 2026-02-15 | low | Index page; its content is in A2. |

Reference entries linked from the overview body (not articles, not counted, 16): `Animation`, `Animation()` constructor, `KeyframeEffect`, `KeyframeEffect()` constructor, `AnimationTimeline`, `DocumentTimeline`, `AnimationEvent`, `Document.timeline`, `Document.getAnimations()`, `Element.animate()`, `Element.getAnimations()`, the `Document` and `Element` interface pages, CSS `animation`, CSS `animation-timeline`, and the spec draft https://drafts.csswg.org/web-animations/. The MDN sidebar also lists `ScrollTimeline`, `ViewTimeline`, and `AnimationPlaybackEvent`. Support per MDN BCD (2026-09-17 build): `Element.animate` Chrome 36 / Firefox 48 / Safari 13.1; `commitStyles`, `persist`, `getAnimations` Chrome 84 / Firefox 75 / Safari 13.1.

## Redirects found

| Link on the collection page | Final URL |
|---|---|
| https://web.dev/extending-workbox | https://developer.chrome.com/docs/workbox/using-plugins |
| https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Animations/Using_CSS_animations | https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Animations/Using |
| https://developers.google.com/web/tools/chrome-devtools/inspect-styles/animations | https://developer.chrome.com/docs/devtools/css/animations/ |
| https://developer.mozilla.org/en-US/docs/Tools/Page_Inspector/How_to/Work_with_animations | https://firefox-source-docs.mozilla.org/devtools-user/page_inspector/how_to/work_with_animations/index.html |
| https://web.dev/articles/offline-cookbook | same URL; page title is now "Common techniques to build offline applications" |

## Verification notes (web checks, 2026-09-22)

| Claim | Source | Result |
|---|---|---|
| Lighthouse offline audit (R1) still exists | PageSpeed Insights release notes, https://developers.google.com/speed/docs/insights/release_notes | Lighthouse 12.0 (2024-05-10) removed the PWA category, which held the offline audits. Lighthouse 13.0 shipped 2025-10-20. |
| Workbox is maintained (R8, R11, R12, R17) | GitHub API, GoogleChrome/workbox; npm `workbox-precaching` | Latest release v7.4.1 (2026-05-05), v7.4.0 (2025-11-19); repo not archived, last push 2026-09-02. |
| `workbox-google-analytics` (R3) | https://developer.chrome.com/docs/workbox/modules/workbox-google-analytics | The page says the module is deprecated because it does not work with GA4. |
| create-react-app (R8) | https://react.dev/blog/2025/02/14/sunsetting-create-react-app | Deprecated for new apps on 2025-02-14. |
| `Cache-Control: immutable` (R4, R5) | MDN BCD 8.1.2 (`raw/bcd.json`) | Firefox 49, Safari 11, Chrome not supported. `stale-while-revalidate`: Chrome 75, Firefox 68, Safari 14. |
| Navigation preload (R13, R15) | MDN BCD `api.NavigationPreloadManager` | Chrome 59, Firefox 99, Safari 15.4. |
| Background Sync / Background Fetch (R14, R21) | webstatus.dev `background-sync`, `background-fetch`; MDN BCD | "limited": Chrome/Edge only. |
| BroadcastChannel (R20) | webstatus.dev `broadcast-channel` | Baseline widely available (low 2022-03-14, high 2024-09-14). |
| SW static routing (`InstallEvent.addRoutes`, a newer "race network and fetch handler" lever missing from R10) | webstatus.dev `service-workers-static-routes`; MDN BCD | webstatus.dev: Chrome 2024-03-19 only, "limited". MDN BCD 8.1.2: Chrome 123, Safari 27, no Firefox. |
| Storage manager (`estimate`, `persist`) (R10) | webstatus.dev `storage-manager`; MDN BCD | Baseline widely available (low 2023-09-18, high 2026-03-18); `persist()` Chrome 55 / Firefox 57 / Safari 15.2. |
| `Promise.any()` (R10) | webstatus.dev `promise-any` | Baseline widely available (high 2023-03-16). |
| Stylesheet with non-matching `media` is skipped (A5 claim) | Thomas Steiner, "Why Browsers Download Stylesheets With Non-Matching Media Queries", https://blog.tomayac.com/2018/11/08/why-browsers-download-stylesheets-with-non-matching-media-queries-180513/ | False: browsers still download it, at Lowest priority and without blocking render. |
| prefers-reduced-motion (A5) | webstatus.dev `prefers-reduced-motion` | Baseline widely available (high 2022-07-15). |
| Web Animations (A9) | webstatus.dev `web-animations` | Baseline widely available (high 2023-03-16). |

## Gaps these collections do not cover (for other research files)

- Animations collection has nothing on View Transitions (webstatus.dev: Baseline newly available 2025-10-14; cross-document view transitions "limited": Chrome, Safari), `@starting-style` and `transition-behavior: allow-discrete` (both Baseline newly available 2024-08-06), individual transform properties `translate`/`rotate`/`scale` (Baseline widely available 2025-02-05), `linear()` easing (Baseline widely available 2026-06-11), or scroll-driven animations (limited). No canvas/WebGL/WebGPU or OffscreenCanvas animation guidance (OffscreenCanvas: Baseline widely available; `requestAnimationFrame()` in workers: Baseline widely available since 2023-03-27).
- Reliability collection predates: SW static routing API, Speculation Rules (Chromium-only), and HTTP cache partitioning. Zstandard and compression dictionaries are also absent (see file 16).
- No article in these four collections on caching streaming or WebSocket data; the SW strategy table (R9) is the closest guidance for API data such as prices and balances.
