# 16 — Index of web.dev "Fast load times" (https://web.dev/explore/fast)

Research for the personal Claude Code skill "web-performance". Fetched 2026-09-22.

## Method

- Downloaded the raw HTML of https://web.dev/explore/fast with curl and parsed every `<h3>`/`<h4>` and `<a href>` inside `<article>` (raw: `raw/fast-index/explore-fast.html`, link list: `raw/fast-index/explore-fast-links.txt`).
- Downloaded every linked page (55 unique URLs; raw HTML in `raw/fast-index/pages/`, plain text in `raw/fast-index/text/`). curl followed redirects; 4 links redirect (see "Redirects").
- Opened the only collection link inside the article, https://web.dev/learn/performance, one level deep: it lists exactly the 14 course modules that other agents cover (raw in `raw/fast-index/course/`).
- The page's left site navigation also links two performance collections (`/explore/learn-core-web-vitals`, `/explore/how-to-optimize-inp`). They are site chrome, not part of the "Fast load times" content, but they are performance collections, so I opened them one level deep and list the extra articles in Appendix A (raw in `raw/fast-index/nav/`). Other site-nav collections (animations, media, reliable, PWA, etc.) are not performance-specific and are not expanded.
- Dates: "Pub/Upd" = the Published / Last updated line printed on the article. "Footer" = the devsite footer date ("Last updated YYYY-MM-DD UTC"), which is the last page edit; many older articles show only this.
- Classes: **covered** (another agent has it), **high** (current guidance that changes how we write HTML/CSS/JS or load resources), **medium** (background, measurement, debugging), **low** (outdated, case study with no new levers, or duplicate of a covered item), **none** (not an article: duplicate link or anchor).

## Counts

| Scope | covered | high | medium | low | none | total |
|---|---|---|---|---|---|---|
| explore/fast content (incl. course landing) | 9 | 3 | 22 | 20 | 1 | 55 |
| Appendix A (site-nav perf collections, extra articles only) | 1 | 5 | 11 | 8 | 1 | 26 |
| **All** | **10** | **8** | **33** | **28** | **2** | **81** |

## Top cards (page header)

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| 1 | What is speed? | https://web.dev/articles/what-is-speed | Footer 2019-05-01 | low | 2019 overview; still names Time to Interactive and Speed Index as load signals; no levers. |
| 2 | Why does speed matter? | https://web.dev/learn/performance/why-speed-matters | Footer 2023-11-01 | covered | Learn Performance module. |
| 3 | How to measure speed? | https://web.dev/articles/how-to-measure-speed | Footer 2019-05-01 | low | 2019 two-paragraph lab-vs-field intro; superseded by vitals-tools and lab-and-field-data-differences. |
| 4 | How to stay fast? | https://web.dev/articles/how-to-stay-fast | Footer 2019-05-01 | low | 2019 budget intro with TTI-on-slow-3G examples; outdated metrics. |
| 5 | Learn Performance (course landing) | https://web.dev/learn/performance | no date shown | covered | Collection; all 14 modules are covered (list below). |

### Learn Performance course (opened one level deep) — all covered

| Module | URL | Footer date |
|---|---|---|
| Welcome to Learn Performance! | https://web.dev/learn/performance/welcome | 2023-11-27 |
| Why speed matters | https://web.dev/learn/performance/why-speed-matters | 2023-11-01 |
| General HTML performance considerations | https://web.dev/learn/performance/general-html-performance | 2023-11-01 |
| Understanding the critical path | https://web.dev/learn/performance/understanding-the-critical-path | 2023-11-27 |
| Optimize resource loading | https://web.dev/learn/performance/optimize-resource-loading | 2023-11-01 |
| Assist the browser with resource hints | https://web.dev/learn/performance/resource-hints | 2023-11-01 |
| Image performance | https://web.dev/learn/performance/image-performance | 2023-11-01 |
| Video performance | https://web.dev/learn/performance/video-performance | 2026-04-02 |
| Optimize web fonts | https://web.dev/learn/performance/optimize-web-fonts | 2023-11-01 |
| Code-split JavaScript | https://web.dev/learn/performance/code-split-javascript | 2023-12-04 |
| Lazy load images and iframe elements | https://web.dev/learn/performance/lazy-load-images-and-iframe-elements | 2023-11-01 |
| Prefetching, prerendering, and service worker precaching | https://web.dev/learn/performance/prefetching-prerendering-precaching | 2023-11-01 |
| An overview of web workers | https://web.dev/learn/performance/web-worker-overview | 2023-11-01 |
| A concrete web worker use case | https://web.dev/learn/performance/web-worker-demo | 2023-11-01 |

The course landing lists no other modules (checked all `learn/performance/*` links on the page).

I used the course modules to judge overlap. What the modules already contain: resource-hints covers preconnect (with `crossorigin`), dns-prefetch, preload with `fetchpriority="high"`, prefetch, Fetch Priority. image-performance covers `srcset`/`sizes`, AVIF/WebP, `<picture>`, `decoding`. video-performance covers the GIF-to-`<video autoplay muted loop playsinline>` swap and `preload="none"`. optimize-web-fonts covers preload with `crossorigin`, inline `@font-face`, WOFF2, subsetting, `font-display`. It does NOT cover `size-adjust` or `unicode-range`.

## Overview → Core Web Vitals

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| 6 | Web Vitals | https://web.dev/articles/vitals | Pub 2020-05-04, Upd 2024-10-31 | medium | Canonical thresholds (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75 per device class), metric lifecycle (experimental → pending → stable), `web-vitals` library usage. |
| 7 | User-centric performance metrics | https://web.dev/articles/user-centric-performance-metrics | Footer 2023-08-02 | medium | Metric taxonomy plus the list of low-level APIs for custom metrics (User Timing, Long Tasks, Long Animation Frames, Element Timing, Navigation/Resource/Server Timing). |
| 8 | Defining the Core Web Vitals metrics thresholds | https://web.dev/articles/defining-core-web-vitals-thresholds | Pub 2020-05-21, Upd 2025-05-07 | low | Research rationale for the thresholds and p75 choice; no code levers (numbers already in #6). |
| 9 | Largest Contentful Paint (LCP) | https://web.dev/articles/lcp | Pub 2019-08-08, Upd 2025-09-04 | medium | Which elements qualify, how size is computed, when reporting stops; PerformanceObserver `largest-contentful-paint` code and metric-vs-API differences. |
| 10 | Cumulative Layout Shift (CLS) | https://web.dev/articles/cls | Footer 2023-04-12 | medium | Session windows (shifts < 1 s apart, window max 5 s); shifts within 500 ms of a discrete input (tap, click, key) get `hadRecentInput` and are excluded, but continuous input (scroll, drag) does not; `transform` animations do not cause layout shifts; reserve space and show a loading indicator for slow async results; JS measurement code. |
| 11 | Interaction to Next Paint (INP) | https://web.dev/articles/inp | Pub 2022-05-06, Upd 2025-09-02 | medium | What counts as an interaction (click, tap, key; not hover/scroll), Event Timing API, `durationThreshold` minimum 16 ms, INP vs FID. |
| 12 | Optimize Largest Contentful Paint | https://web.dev/articles/optimize-lcp | Pub 2020-04-30, Upd 2025-03-31 | covered | |
| 13 | Optimize Cumulative Layout Shift | https://web.dev/articles/optimize-cls | Pub 2020-05-05, Upd 2025-02-07 | covered | |
| 14 | Optimize Interaction to Next Paint | https://web.dev/articles/optimize-inp | Pub 2023-05-19, Upd 2025-09-02 | covered | |
| 15 | The most effective ways to improve Core Web Vitals | https://web.dev/articles/top-cwv | Footer 2024-10-31 (changelog Oct 2024) | medium | Ranked 3+3+3 checklist (yield often, avoid unneeded JS, avoid large render updates; discoverable + prioritized LCP resource, instant navigations, CDN; explicit sizes, bfcache, no layout-inducing animations). Items duplicate covered guides; the ranking is the value. |
| 16 | Core Web Vitals workflows with Google tools | https://web.dev/articles/vitals-tools | Pub 2020-05-28, Footer 2025-02-28 | medium | When to use CrUX, PSI, Search Console, Lighthouse, DevTools Performance panel (live metrics); a 3-step evaluate → debug → monitor workflow. |
| 17 | Optimizing Core Web Vitals for business decision makers | https://web.dev/articles/optimize-cwv-business | Footer 2023-10-27 | low | Written for non-developers; no new levers. |

## Measure performance in the field

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| 18 | Using the Chrome UX Report to look at performance in the field | https://web.dev/articles/chrome-ux-report → redirects to https://developer.chrome.com/docs/crux | Footer 2024-02-08 | low | Now a ~160-word CrUX dataset overview on developer.chrome.com; no levers. |
| 19 | Why lab and field data can be different (and what to do about it) | https://web.dev/articles/lab-and-field-data-differences | Footer 2022-07-18 | medium | Debugging: LCP element, cache state, bfcache, user interaction and personalization make lab and field differ; TBT is not INP. AMP/SXG parts are dated. |
| 20 | Why is CrUX data different from my RUM data? | https://web.dev/articles/crux-and-rum-differences | Pub 2022-08-15, Upd 2025-12-17 | medium | RUM pitfalls: population, aggregation, iframes, cross-origin resources, background tabs, bfcache; SPA soft navigations are not seen by CWV APIs (article says work is still in progress). Relevant to an SPA terminal's own RUM. |

## Optimize your resource delivery

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| 21 | Optimize Time to First Byte | https://web.dev/articles/optimize-ttfb | Pub 2023-01-19, Upd 2025-11-28 | covered | |
| 22 | Content delivery networks (CDNs) | https://web.dev/articles/content-delivery-networks | Footer 2023-12-05 | medium | CDN caching and cache-hit-ratio tuning (query params, `Vary`, cookies), Brotli over gzip, TLS 1.3, HTTP/2 vs HTTP/3. Infrastructure, not page code. No mention of Zstandard. |
| 23 | Prioritize resources | https://web.dev/articles/prioritize-resources → redirects to https://web.dev/articles/fetch-priority ("Optimize resource loading with the Fetch Priority API") | Footer 2023-11-14 | **high** | `fetchpriority="high\|low\|auto"` on img/script/link, `fetch(url, {priority: 'low'})` for non-critical data, lower priority for hidden carousel images and late scripts, preload vs priority differences, CDN priority caveats. Baseline newly available 2024-10-29 (webstatus.dev: Chrome/Edge 103, Firefox 132, Safari 17.2). |
| 24 | Preload critical assets to improve loading speed | https://web.dev/articles/preload-critical-assets | Footer 2018-11-05 (body updated: has CWV sections) | medium | `rel=preload` with `as`; fonts need `crossorigin` or they are fetched twice; unused preloads warn in the Chrome console about 3 s after load; preload for CSS-defined resources. Overlaps the covered resource-hints module. Cites the "Preload key requests" audit, which Lighthouse 13 removed (`uses-rel-preload`). |
| 25 | Establish network connections early to improve perceived page speed | https://web.dev/articles/preconnect-and-dns-prefetch | Footer 2019-07-30 | medium | Preconnect only to origins used soon (article: the browser closes a connection not used within 10 s); limit the count; `crossorigin` for font origins; `Link:` header form; dns-prefetch fallback. Overlaps the covered module. |
| 26 | Prefetch resources to speed up future navigations | https://web.dev/articles/link-prefetch | Pub 2019-09-12, Upd 2025-02-08 | medium | `rel=prefetch` for next-route chunks; runs at Lowest priority; kept only if HTTP-cacheable; Chrome reuses an in-flight prefetch for the navigation; Speculation Rules preferred for documents. quicklink/Guess.js/webpack parts are dated. |
| 27 | Don't fight the browser preload scanner | https://web.dev/articles/preload-scanner | Footer 2022-05-13 | covered | |
| 28 | Fast playback with audio and video preload | https://web.dev/articles/fast-playback-with-preload | Footer 2017-08-17 | low | The page itself warns that `<link rel=preload as=video>` does not work in Chrome or Safari; MSE/Range/service-worker tricks from 2017; Save-Data heuristics. |

## Optimize your images

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| 29 | Choose the right image format | https://web.dev/articles/choose-the-right-image-format | Footer 2024-08-13 | medium | Vector vs raster decision, high-DPR implications, format feature table (AVIF and WebP in all modern browsers). Overlaps the covered image module. |
| 30 | Choose the correct level of compression | https://web.dev/articles/compress-images | Footer 2018-08-30 | low | Compression theory plus a checklist the covered image module already has. |
| 31 | Replace animated GIFs with video for faster page loads | https://web.dev/articles/replace-gifs-with-videos | Footer 2018-11-05 | low | Duplicate of the covered video module (ffmpeg commands, `autoplay loop muted playsinline`). |
| 32 | Serve responsive images | https://web.dev/articles/serve-responsive-images | Footer 2018-11-05 | low | `srcset`/`sizes` + sharp/ImageMagick; duplicates the covered image module; cites the old "Properly size images" audit; no `sizes="auto"`. |
| 33 | Serve images with correct dimensions | https://web.dev/articles/serve-images-with-correct-dimensions | Footer 2018-11-05 | medium | How to compute the needed intrinsic size from rendered CSS size × DPR; `width`/`height` attributes or CSS `aspect-ratio` (+ `object-fit`) to prevent shifts. |
| 34 | Use image CDNs to optimize images | https://web.dev/articles/image-cdns | Footer 2019-08-14 (body updated: LCP section) | medium | URL-based transforms, automatic format negotiation, same-origin/preconnect and `fetchpriority="high"` for the LCP image. |

## Lazy-load images and video

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| 35 | Lazy loading video | https://web.dev/articles/lazy-loading-video | Pub 2019-08-16, Upd 2026-07-02 | **high** | New `loading="lazy"` on `<video>`/`<audio>` (defers poster, data and autoplay until near viewport); `preload="none"` + poster; switch to `preload="metadata"` on hover; LCP video: preload the poster with `fetchpriority="high"` and never lazy-load it. Support: chromestatus ships in Chrome 148, webstatus.dev lists Chrome/Edge 150; Firefox and WebKit implementations under way; unsupported browsers ignore the attribute. |
| 36 | Browser-level image lazy loading for the web | https://web.dev/articles/browser-level-image-lazy-loading | Footer 2024-08-13 | medium | Deeper reference for the covered lazy-load module: Chrome distance thresholds (1250 px fast / 2500 px slow networks), `loading=lazy` + `fetchpriority=high` still waits for viewport, `<picture>` support, CSS backgrounds cannot use it, always eager-load first-viewport images, set `width`/`height`. Baseline widely available (webstatus.dev). |
| 37 | The performance effects of too much lazy loading | https://web.dev/articles/lcp-lazy-loading | Footer 2022-03-31 | medium | HTTP Archive + A/B data: lazy-loading in-viewport images makes LCP worse; eager-load the first content images, lazy-load the rest. Mostly a WordPress case study. |

## Optimize web fonts

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| 38 | Best practices for fonts | https://web.dev/articles/font-best-practices | Footer 2022-10-04 | **high** | Inline `@font-face` in `<head>`; preload fonts with care (preload ignores `unicode-range`, steals bandwidth); self-host vs third-party trade-off; WOFF2 only; subsetting with `unicode-range`; fewer fonts via `system-ui` or variable fonts; `font-display: optional` for body text vs `swap` for branding; icon-font caveat; fallback-metric overrides (`size-adjust`) to cut CLS. Adds items the covered font module lacks. |

## Optimize your CSS

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| 39 | Reduce the scope and complexity of style calculations | https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations | Footer 2015-03-20 | covered | |

## Optimize your third-party resources

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| 40 | Third-party JavaScript performance | https://web.dev/articles/third-party-javascript | Footer 2019-08-13 | low | 2019 overview that only points to #41–#42. |
| 41 | Identify slow third-party JavaScript | https://web.dev/articles/identify-slow-third-party-javascript | Footer 2019-08-14 | low | Built on Lighthouse audits that Lighthouse 13 replaced (`third-party-summary` → `third-parties-insight`). The DevTools "block request and compare" method is the only lasting idea. |
| 42 | Efficiently load third-party JavaScript | https://web.dev/articles/efficiently-load-third-party-javascript | Footer 2019-08-14 | low | async/defer and preconnect duplicate covered modules; calls Chrome 76 lazy loading "recent" and recommends lazysizes. The self-host vs CDN and service-worker caching notes are small extras. |
| 43 | Best practices for tags and tag managers | https://web.dev/articles/tag-best-practices | Pub 2021-07-29, Footer 2022-08-24 | medium | GTM rules: load libraries with `<script src>` instead of pasting code into Custom HTML tags, prefer Custom Templates + `injectScript`, pixels over scripts, specific triggers, one container per page, remove duplicate tags, server-side tagging. Only relevant if a site uses a tag manager. |

## Optimize your JavaScript

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| 44 | Optimize long tasks | https://web.dev/articles/optimize-long-tasks | Pub 2022-09-30, Upd 2024-12-19 | covered | |
| 45 | Reduce JavaScript payloads with code splitting | https://web.dev/articles/reduce-javascript-payloads-with-code-splitting | Footer 2018-11-05 | low | 640-word 2018 intro to dynamic `import()`; duplicates the covered code-split module. |
| 46 | Remove unused code | https://web.dev/articles/remove-unused-code | Footer 2018-11-05 | medium | Debugging: DevTools Coverage panel and bundle treemaps to find unused or oversized libraries; replace heavy libraries. webpack-centric and old; cites the "Reduce unused JavaScript" audit. |
| 47 | Minify and compress network payloads | https://web.dev/articles/reduce-network-payloads-using-text-compression → redirects to https://web.dev/articles/optimizing-content-efficiency-optimize-encoding-and-transfer ("Optimize the encoding and transfer size of text-based assets") | Footer 2023-12-11 | medium | Minification, gzip levels 1–9 vs Brotli 0–11, static (max level, build time) vs dynamic (mid level) compression, CDN auto-compression. Gap: no Zstandard, which is Baseline newly available since 2026-02-11 (webstatus.dev: Chrome 123, Firefox 126, Safari 26.3). |

## Build a performance culture

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| 48 | The value of speed | https://web.dev/articles/value-of-speed | Footer 2019-06-13 | low | Revenue math for stakeholders. |
| 49 | How can performance improve conversion? | https://web.dev/articles/how-can-performance-improve-conversion | Footer 2019-06-11 | low | E-commerce funnel essay. |
| 50 | What should you measure to improve performance? | https://web.dev/articles/what-should-you-measure-to-improve-performance → redirects to https://web.dev/articles/vitals-tools | same as #16 | none | Redirect duplicate of #16. |
| 51 | Fixing website speed cross-functionally | https://web.dev/articles/fixing-website-speed-cross-functionally | Footer 2020-02-28 | low | Organizational process. |
| 52 | Relating site speed and business metrics | https://web.dev/articles/site-speed-and-business-metrics | Footer 2020-07-17 | low | A/B-test methodology for business metrics. |

## Set performance budgets

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| 53 | Performance budgets 101 | https://web.dev/articles/performance-budgets-101 | Footer 2018-11-05 | low | Budget idea is sound, but examples use TTI and 3G and tools like bundlesize. |
| 54 | Your first performance budget | https://web.dev/articles/your-first-performance-budget | Footer 2018-11-05 | low | TTI-based milestone budgets (TTI appears 11 times); outdated metrics. |
| 55 | Performance monitoring with Lighthouse CI | https://web.dev/articles/lighthouse-ci | Footer 2020-07-27 | medium | LHCI CLI, GitHub Action, status checks, LHCI server, assertions to catch regressions. Tool is still maintained (GitHub release v0.15.1, 2025-06-26). |

## Redirects found

| Link on explore/fast | Final URL |
|---|---|
| /articles/chrome-ux-report | https://developer.chrome.com/docs/crux |
| /articles/prioritize-resources | https://web.dev/articles/fetch-priority |
| /articles/reduce-network-payloads-using-text-compression | https://web.dev/articles/optimizing-content-efficiency-optimize-encoding-and-transfer |
| /articles/what-should-you-measure-to-improve-performance | https://web.dev/articles/vitals-tools (same as #16) |

## Appendix A — site-nav performance collections (extra articles only)

Items already listed above are not repeated. Source pages: https://web.dev/explore/learn-core-web-vitals and https://web.dev/explore/how-to-optimize-inp.

### From /explore/learn-core-web-vitals

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| A1 | The business impact of Core Web Vitals | https://web.dev/case-studies/vitals-business-impact | Footer 2021-09-01 | low | Business case studies. |
| A2 | Getting started with measuring Web Vitals | https://web.dev/articles/vitals-measurement-getting-started | Footer 2025-09-09 | medium | RUM vs lab setup, `web-vitals` library, aggregation and interpretation basics. |
| A3 | Best practices for measuring Web Vitals in the field | https://web.dev/articles/vitals-field-measurement-best-practices | Footer 2022-05-11 | **high** | Rules for analytics code: report on `visibilitychange` → hidden, send with `navigator.sendBeacon()` or `fetch(..., {keepalive: true})`, defer analytics, never create long tasks in measurement code, use non-blocking APIs, report distributions (not averages), version changes. |
| A4 | Debug layout shifts | https://web.dev/articles/debug-layout-shifts | Pub 2021-03-11, Upd 2025-02-07 | medium | Layout Instability API sources, DevTools workflow to find and reproduce shift causes. |
| A5 | Debug performance in the field | https://web.dev/articles/debug-performance-in-the-field | Footer 2024-10-06 | medium | Attribution data for CLS/LCP/INP and the `web-vitals` attribution build; how to report it. |
| A6 | Best practices for carousels | https://web.dev/articles/carousel-best-practices | Footer 2021-01-26 | medium | Render slides in HTML, animate with transforms, CSS scroll-snap, LCP rules for carousels (Chrome 88, Chrome 121 threshold changes). |
| A7 | Best practices for cookie notices | https://web.dev/articles/cookie-notice-best-practices | Footer 2024-06-13 | medium | Load consent scripts async but directly, preconnect/preload when needed, avoid shifts, INP impact of the banner. |
| A8 | Best practices for using third-party embeds | https://web.dev/articles/embed-best-practices | Footer 2021-10-05 | medium | Script ordering, `loading="lazy"` iframes, facades for heavy embeds, reserve space for embeds. More current than #42. |
| A9 | Infinite scroll without layout shifts (Addy Osmani blog) | https://addyosmani.com/blog/infinite-scroll-without-layout-shifts/ | Blog, 2020-07-30 | medium | Blog only: reserve space or prefetch the next page before appending items; keep footers out of the growing list; virtualized lists. |
| A10 | CSS for Web Vitals | https://web.dev/articles/css-web-vitals | Footer 2021-06-02 | medium | CSS-side rules: reserve space for late-inserted content (cookie notices, ads, embeds), explicit image dimensions, font block periods (article: about 3 s in Chromium/Firefox, no limit in Safari) and similar-metric fallbacks, animate `transform`/`opacity`/`filter`, critical CSS. Partly overlaps the covered CLS guide; cites old Lighthouse audit names. |

### From /explore/how-to-optimize-inp

| # | Title | URL | Date | Class | Reason |
|---|---|---|---|---|---|
| A11 | The most effective ways to improve INP | https://web.dev/articles/top-cwv#inp | — | none | Anchor into #15. |
| A12 | Find slow interactions in the field | https://web.dev/articles/find-slow-interactions-in-the-field | Footer 2024-06-07 | medium | CrUX first, then `web-vitals` attribution build and Long Animation Frames (LoAF) to split input delay / processing / presentation delay. |
| A13 | Manually diagnose slow interactions in the lab | https://web.dev/articles/manually-diagnose-slow-interactions-in-the-lab | Pub 2023-05-09, Footer 2024-10-17 | medium | DevTools live metrics and trace reading for each INP phase. |
| A14 | Optimize input delay | https://web.dev/articles/optimize-input-delay | Footer 2023-05-09 | **high** | Avoid recurring timers (`setInterval`/`setTimeout`) that do heavy main-thread work; handle interaction overlap by debouncing input and cancelling stale `fetch` calls with `AbortController`; avoid long tasks. Directly relevant to streaming-data UIs. |
| A15 | Script evaluation and long tasks | https://web.dev/articles/script-evaluation-and-long-tasks | Footer 2023-05-09 | **high** | How classic `<script>`, `type=module`, dynamic `import()` and workers map to evaluation tasks; smaller chunks shorten tasks but cost compression efficiency; cache-invalidation and nested-module trade-offs. |
| A16 | Use web workers to run JavaScript off the browser's main thread | https://web.dev/articles/off-main-thread | Footer 2019-12-05 | medium | Worker threading model, Comlink RPC, what to move off-thread; overlaps covered worker modules. |
| A17 | Avoid large, complex layouts and layout thrashing | https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing | Pub 2015-03-20, Upd 2025-05-07 | covered | |
| A18 | How large DOM sizes affect interactivity | https://web.dev/articles/dom-size-and-interactivity | Footer 2023-05-09 | **high** | Large or deep DOMs slow style/layout on every interaction; cut depth, add nodes only when needed ("additive approach"), limit selector complexity, `content-visibility`. Lighthouse node counts it cites (800 warn / 1,400 fail) may be dated. |
| A19 | Client-side rendering of HTML and interactivity | https://web.dev/articles/client-side-rendering-of-html-and-interactivity | Footer 2023-05-09 | **high** | Server-streamed HTML is parsed in chunks with yields; `innerHTML`/`createElement` rendering runs as one long task; send as much HTML from the server as possible and limit client-created nodes. |
| A20 | QuintoAndar INP case study | https://web.dev/case-studies/quintoandar-inp | Pub 2025-01-22 | low | Case study; levers already covered. |
| A21 | Disney+ Hotstar INP case study | https://web.dev/case-studies/hotstar-inp | Footer 2024-05-22 | low | Case study (TV tray navigation). |
| A22 | PubTech consent platform INP case study | https://web.dev/case-studies/pubconsent-inp | Footer 2024-02-28 | low | Case study; yielding by task priority is covered in optimize-long-tasks. |
| A23 | Taboola LoAF/INP case study | https://web.dev/case-studies/taboola-inp | Footer 2024-02-01 | low | Case study; LoAF + yielding scheduler, no new public API. |
| A24 | Economic Times INP case study | https://web.dev/case-studies/economic-times-inp | Footer 2023-05-10 | low | Case study (TBT, DOM size). |
| A25 | redBus INP case study | https://web.dev/case-studies/redbus-inp | Footer 2023-05-10 | low | Case study. |
| A26 | Trendyol INP case study | https://web.dev/case-studies/trendyol-inp | Footer 2023-12-11 | low | Case study. |

## Verification notes (web checks, 2026-09-22)

| Claim | Source | Result |
|---|---|---|
| Fetch Priority support | webstatus.dev API, feature `fetch-priority` | Baseline newly available 2024-10-29; Chrome/Edge 103, Firefox 132, Safari 17.2. (The article's widget says Chrome 102.) |
| `loading="lazy"` on `<video>`/`<audio>` | Chrome 148 release notes (developer.chrome.com/release-notes/148) and chromestatus feature 5200068565139456 | Chrome 148 per both; webstatus.dev `loading-lazy-media` lists Chrome/Edge 150, "limited" availability. Firefox (Positive, implementation under way) and WebKit (implementation under way) per chromestatus. Treat as progressive enhancement. |
| Image `loading=lazy` | webstatus.dev `loading-lazy` | Baseline widely available (low date 2023-12-19). |
| `<img sizes="auto">` (not mentioned in any indexed article) | webstatus.dev `sizes-auto` | Chrome/Edge 126, Firefox 150; no Safari; "limited". |
| Zstandard content encoding | webstatus.dev `zstd` | Baseline newly available 2026-02-11 (Chrome 123, Firefox 126, Safari 26.3). |
| Lighthouse audits retired | developer.chrome.com/blog/moving-lighthouse-to-insights (2025-04-28) | Lighthouse 13 (target Oct 2025) removes `uses-rel-preload`, `offscreen-images`, `third-party-facades`, `no-document-write`, `uses-passive-event-listeners`, `first-meaningful-paint`; maps `third-party-summary` → `third-parties-insight`, `uses-rel-preconnect` → `network-dependency-tree-insight`, `font-display` → `font-display-insight`. |
| Lighthouse CI maintained | GitHub API, GoogleChrome/lighthouse-ci | Latest release v0.15.1 (2025-06-26); repo not archived; last push 2026-03-27. |

## Gaps the index does not cover (for other research files)

- Zstandard and compression dictionaries are absent from #22 and #47.
- `sizes="auto"` for lazy images is absent from #32, #33 and #36.
- No article on Speculation Rules beyond one caution line in #26 (the covered prefetch module has it).
- No article on WebGL/WebGPU, canvas, or OffscreenCanvas; worker coverage is #A16 plus covered modules.
