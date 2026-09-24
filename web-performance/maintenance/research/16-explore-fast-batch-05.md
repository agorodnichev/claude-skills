# web.dev "Fast" collection, batch 5 of 6: images, unused code, embeds, lists, consent, tags, carousels

Scope: eight articles from https://web.dev/explore/fast. Each was fetched as raw HTML with curl, stripped to text, and read in full: image CDNs, image formats, removing unused code, third-party embeds, infinite scroll (Addy Osmani blog), cookie notices, tags and tag managers, carousels.
Every API, attribute, header, and tool named in the articles was checked on 2026-09-23 against web-features 3.39.0 (Baseline data), @mdn/browser-compat-data 8.1.2 (2026-09-17), MDN, the WHATWG Fetch spec, developer.chrome.com, and the GitHub API (to see if a repo is archived).
Detail goes to levers that are specific to these articles. The well-known levers are listed one line each in "Standard levers seen".

## Article index and freshness

| Article | Date (footer) | Still accurate? |
|---|---|---|
| Use image CDNs to optimize images | 2019-08-14 (LCP section added later) | Mostly. Client Hints, Save-Data, and Network Information work only in Chromium. `fetchpriority` is now Baseline 2024. |
| Choose the right image format | 2024-08-13 | Yes. AVIF has been Baseline widely available since 2026-07-25. JPEG XL is not in the article and is still not Baseline. |
| Remove unused code | 2018-11-05 | The principle holds. The Firebase import example uses the old namespaced API. The webpack-libs-optimizations list is archived (2022). |
| Best practices for third-party embeds | 2021-10-05 | Partly outdated. `loading="auto"` is not a valid value. Chrome Lite mode was removed in Chrome 100 (2022). Layout Shift Terminator is archived (2026-03). The Lighthouse facades audit was removed in Lighthouse 13. lazysizes is no longer needed. |
| Infinite scroll without layout shifts (blog) | 2020-07-30 | The core advice holds. Its "future normalization" of CLS shipped in 2021 as session windows. |
| Best practices for cookie notices | 2024-06-13 | Yes. Its `preload` example leaves out `as="script"`, which is a bug in the example. |
| Best practices for tags and tag managers | published 2021-07-29, updated 2022-08-24 | Partly outdated. `fetch(..., {keepalive})` now works in all engines (Firefox 133). `unload` is being deprecated. The container-size number is not confirmed. |
| Best practices for carousels | 2021-01-26 (includes a Chrome 121 note) | Yes. Chromium 135+ adds CSS-only carousel pseudo-elements. |

---

## Images: image CDN, format, pixel budget

### Serve raster images through an image CDN with URL-driven size, format, and quality
- Layer: network
- Stage: network, raster
- Metrics: LCP, bundle-size
- When: load
- Impact: high, because the article cites 40–80% smaller image files and images are often the LCP element
- Do: Request each image through an image-CDN URL that encodes width, DPR, format, and quality (for example `w_800,f_auto,q_auto`). Pair it with `srcset`/`sizes` so every viewport gets the smallest adequate file. Use the CDN's "auto" format/quality modes rather than hard-coding a format.
- Why: An image CDN makes each variant on demand at the edge. It can tailor bytes per client better than a fixed build-time pipeline, and when the CDN adds a new codec, you get it without changing code.
- Example:
  ```html
  <!-- Before: one 2400px JPEG for every device -->
  <img src="/img/hero.jpg" alt="Market overview">
  <!-- After: CDN variants, format chosen by the CDN -->
  <img src="https://img.example.com/w_800,f_auto,q_auto/hero.jpg"
       srcset="https://img.example.com/w_400,f_auto,q_auto/hero.jpg 400w,
               https://img.example.com/w_800,f_auto,q_auto/hero.jpg 800w,
               https://img.example.com/w_1600,f_auto,q_auto/hero.jpg 1600w"
       sizes="(min-width: 960px) 800px, 100vw"
       width="800" height="450" alt="Market overview">
  ```
- Avoid/caveats: The response format can differ from the URL extension (the URL says `.jpg`, the bytes are AVIF). Tools that save the file to disk can then mislabel it. Turn on the CDN's signed-URL/"security key" feature so other people cannot create unlimited variants at your expense. Self-managed options named in the article: Thumbor, Imaginary, Imagor.
- Status: `srcset`/`sizes` are Baseline widely available. The CDN is a service choice, not a web-platform feature.
- Sources: https://web.dev/articles/image-cdns

### Put the image CDN on the page's own origin, or preconnect to it early
- Layer: network
- Stage: network
- Metrics: LCP
- When: load
- Impact: medium, because a cross-origin CDN adds DNS, TCP, and TLS setup before the LCP image can start
- Do: Proxy the image CDN through the main origin (for example `https://www.example.com/cdn-img/...`) so images reuse the existing connection. If you cannot proxy it and the LCP image is discovered late, add `<link rel="preconnect">` to the CDN origin. Use a custom domain you control so you can change CDN vendors without rewriting URLs.
- Why: A same-origin image reuses the HTTP/2 or HTTP/3 connection that is already warm. A new origin costs at least one extra round trip, and more on slow networks.
- Avoid/caveats: Preconnect only to origins the page will use within about 10 s. An unused preconnect wastes a socket.
- Status: `rel=preconnect` is Baseline widely available (since 2020-01-15, web-features).
- Sources: https://web.dev/articles/image-cdns

### Negotiate image format with the `Accept` header and send `Vary: Accept`; do not rely on Chromium-only hints
- Layer: network
- Stage: network
- Metrics: LCP, bundle-size
- When: load
- Impact: medium, because a negotiation mistake either sends a format the browser cannot decode or poisons a shared cache
- Do: When one URL can return different formats, choose the format from the request `Accept` header and return `Vary: Accept` (plus the correct `Content-Type`). Treat Client Hints (`Sec-CH-DPR`, `Sec-CH-Width`, `Sec-CH-Viewport-Width`), `Save-Data`, and `navigator.connection` as Chromium-only extras. Always have a fallback without them.
- Why: The article lists Client Hints, `Save-Data`, the User-Agent, and the Network Information API as CDN signals. Firefox and Safari send none of the first three. Safari's image `Accept` header also leaves out `image/avif` even though Safari decodes AVIF, so pure Accept-based logic sends WebP to Safari. Commercial CDNs add UA sniffing to fix this.
- Example:
  ```http
  GET /img/chart-thumb.jpg
  Accept: image/avif,image/webp,image/apng,image/*,*/*;q=0.8   (Chrome/Edge 121+)

  200 OK
  Content-Type: image/avif
  Vary: Accept
  Cache-Control: public, max-age=31536000, immutable
  ```
- Avoid/caveats: Without `Vary: Accept`, a shared cache can serve AVIF to a client that cannot decode it. The legacy `DPR`, `Width`, `Viewport-Width`, and `Content-DPR` headers are deprecated (BCD).
- Status: `Save-Data` is Chromium only and experimental (BCD). NetworkInformation `effectiveType` is Chromium only. `Sec-CH-*` image hints are Chromium 97+ only and experimental. The legacy hints are deprecated. The Accept values come from MDN's list of default Accept values.
- Sources: https://web.dev/articles/image-cdns, https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Content_negotiation/List_of_default_Accept_values

### Remove the image before you optimize it: use CSS, SVG, or live text
- Layer: css
- Stage: network, paint, raster
- Metrics: LCP, bundle-size
- When: load
- Impact: medium, because a removed image costs zero bytes and stays sharp at every zoom level
- Do: Draw shadows, gradients, and simple shapes with CSS. Use SVG for icons, logos, and geometric art. Never put text inside an image. Use real text with a web font.
- Why: Vector and CSS output does not depend on resolution, so one asset serves 1x, 2x, and 3x screens. Text in a raster image cannot be selected, searched, zoomed, translated, or read by assistive technology, and it compresses badly.
- Avoid/caveats: Complex SVG (thousands of paths) costs CPU to parse and paint, and for photos it can be larger than a raster file. Rendering fine detail at high DPR "may incur a higher processing cost" even though the asset is the same.
- Status: SVG is Baseline widely available.
- Sources: https://web.dev/articles/choose-the-right-image-format, https://web.dev/articles/carousel-best-practices

### Budget raster pixels by DPR squared
- Layer: html
- Stage: network, raster, gc-memory
- Metrics: LCP, memory, bundle-size
- When: load
- Impact: medium, because a 2x screen needs 4 times the pixels and a 3x screen needs 9 times
- Do: Compute decoded cost as `cssW × cssH × DPR² × 4 bytes`. Serve responsive variants per DPR, and consider capping DPR at 2 for large photos.
- Why: The article's table: a 100×100 CSS-pixel image is 40,000 bytes decoded at 1x, 160,000 at 2x, and 360,000 at 3x. File size and decode memory grow with the area.
- Example:
  ```html
  <img src="avatar-64.webp" srcset="avatar-64.webp 1x, avatar-128.webp 2x"
       width="64" height="64" alt="Trader avatar">
  ```
- Avoid/caveats: The same quadratic cost applies to `<canvas>` backing stores that are sized as `cssSize × devicePixelRatio`. This is our inference, not stated in the article, and it is relevant to WebGL/SciChart surfaces.
- Status: `srcset` x-descriptors are Baseline widely available.
- Sources: https://web.dev/articles/choose-the-right-image-format

### Choose the raster format by content type
- Layer: build
- Stage: network, raster
- Metrics: LCP, bundle-size
- When: build
- Impact: medium, because the format choice alone often changes bytes by 30–50% or more
- Do: Photos and screenshots: AVIF or lossy WebP, with JPEG as the fallback. Fine detail that must be lossless: lossless WebP (often smaller than PNG), or PNG. Animation: `<video>`, never GIF or APNG. Geometric art: SVG. For JPEG, try several quality levels and pick the smallest that looks right.
- Why: GIF allows at most 256 colors and is much larger than video. APNG is also much larger than video at similar quality. PNG applies no lossy step beyond the palette size, so files are large.
- Example:
  ```html
  <picture>
    <source type="image/avif" srcset="shot.avif">
    <source type="image/webp" srcset="shot.webp">
    <img src="shot.jpg" width="1200" height="675" alt="Order ticket">
  </picture>
  ```
- Avoid/caveats: With lossy WebP/AVIF, some colors can differ from the JPEG. Check brand colors. AVIF encodes slowly, so on-the-fly encoding needs a CDN or a cache.
- Status: WebP has been Baseline widely available since 2023-03-16. AVIF has been Baseline widely available since 2026-07-25 (newly available 2024-01-25). JPEG XL: web-features lists only Safari 17+. Blogs (not primary) report that Chrome 145 added a flagged Rust decoder that is still off by default, so do not ship JPEG XL without a fallback.
- Sources: https://web.dev/articles/choose-the-right-image-format, web-features data (avif, webp, jpegxl)

---

## JavaScript weight: find and remove unused code

### Measure unused JS and CSS before cutting it
- Layer: tooling
- Stage: network, script-compile
- Metrics: bundle-size, TBT, INP
- When: build | testing
- Impact: medium, because you cannot cut what you have not measured
- Do: Use the DevTools Coverage panel (start with a reload, choose "Per function" or "Per block", filter by JS or CSS). Use a bundle treemap (webpack-bundle-analyzer, or the Rollup/Vite visualizer plugins) and Lighthouse "Reduce unused JavaScript". Record while you use the app, because code a later interaction needs shows as "unused" at load.
- Why: Coverage shows unused bytes per file. The treemap shows which dependency causes them.
- Avoid/caveats: "Unused at load" does not mean dead. It can mean "split it and load it later". Disable the cache when you measure network size.
- Status: The Coverage panel is current (docs updated 2026-04-13). Lighthouse 13 (2025-10-10) did not list `unused-javascript` among removed audits.
- Sources: https://web.dev/articles/remove-unused-code, https://developer.chrome.com/docs/devtools/coverage, https://github.com/GoogleChrome/lighthouse/releases/tag/v13.0.0

### Import only the sub-modules you use, and prefer SDKs with modular (tree-shakable) APIs
- Layer: build
- Stage: network, script-compile, script-run
- Metrics: bundle-size, INP, LCP
- When: build
- Impact: high, because one namespace import can pull in a whole SDK
- Do: Import named functions from sub-paths rather than the package root. If an unknown package shows in the treemap, find the top-level dependency that pulls it in and import a narrower entry point. Remove libraries you do not use. For libraries that cannot be split, weigh a lighter alternative or a small custom solution.
- Why: Unused JS still costs download, parse, compile, and memory. Large JS that renders markup on the client also hides LCP resources from the preload scanner.
- Example:
  ```ts
  // Before (Firebase namespaced API, as in the 2018 article)
  import firebase from 'firebase/app';
  import 'firebase/database';
  // After (Firebase modular API: tree-shakable)
  import { getDatabase, ref, onValue } from 'firebase/database';
  ```
- Avoid/caveats: The article's own example predates Firebase v9. Firebase says the modular SDK can be about 80% smaller and that the compat (namespaced) libraries will be removed in a future major version. The GoogleChromeLabs "webpack-libs-optimizations" list that the article links to was archived in 2022.
- Status: Current practice. The build-tool plugins named in the article are ecosystem tools, not platform features.
- Sources: https://web.dev/articles/remove-unused-code, https://firebase.google.com/docs/web/modular-upgrade

---

## Third-party embeds (iframes, widgets, maps, video)

### Replace heavy interactive embeds with a facade, and load the real one on interaction
- Layer: js
- Stage: network, script-run, main-thread-task
- Metrics: LCP, TBT, INP, bundle-size
- When: load | interaction
- Impact: high, because many embeds ship 100 KB–2 MB of JS that most users never use
- Do: Render a static look-alike (image plus play/open button) in the embed's slot. On `pointerenter`/`focus`, preconnect to the provider. On click, swap in the real iframe or widget ("import on interaction"). For chat widgets you can also swap after a long idle period.
- Why: The page pays the embed's full JS and network cost only when the user shows intent. The preconnect on hover hides most of the connection setup before the click.
- Example:
  ```html
  <button class="video-facade" data-id="abc123" aria-label="Play: Platform tour"
          style="aspect-ratio:16/9;width:100%;background:url(/img/tour-poster.avif) center/cover"></button>
  <script type="module">
    const btn = document.querySelector('.video-facade');
    const warm = () => {
      const l = Object.assign(document.createElement('link'),
        { rel: 'preconnect', href: 'https://www.youtube-nocookie.com' });
      document.head.append(l);
    };
    btn.addEventListener('pointerenter', warm, { once: true });
    btn.addEventListener('focus', warm, { once: true });
    btn.addEventListener('click', () => {
      const f = Object.assign(document.createElement('iframe'), {
        src: `https://www.youtube-nocookie.com/embed/${btn.dataset.id}?autoplay=1`,
        title: 'Platform tour', allow: 'autoplay; encrypted-media', allowFullscreen: true });
      f.style.cssText = 'aspect-ratio:16/9;width:100%;border:0';
      btn.replaceWith(f);
    }, { once: true });
  </script>
  ```
- Avoid/caveats: The first click waits for the real embed to load, so show a loading state. On mobile, the first tap may start playback without sound or need a second tap. Named facades: lite-youtube-embed (maintained, last push 2025-11), lite-youtube, lite-vimeo-embed. react-live-chat-loader is archived (2026-05). Lighthouse 13 removed the `third-party-facades` audit, so no tool will flag missing facades for you.
- Status: A pattern, not an API. Lighthouse 13 removed the audit (release notes, 2025-10-10).
- Sources: https://web.dev/articles/embed-best-practices, https://developer.chrome.com/blog/lighthouse-13-0

### Use a static or generated image instead of an interactive embed when interaction is optional
- Layer: html
- Stage: network, script-run
- Metrics: LCP, TBT
- When: load
- Impact: medium, because one image replaces a whole iframe document plus its scripts
- Do: Show a screenshot or a static-map image (for example from a static maps API), wrapped in a link to the live version. Convert DevTools "Capture node screenshot" PNGs to WebP or AVIF.
- Why: An `<img>` costs one request and no script. An iframe embed is a full page with its own JS.
- Avoid/caveats: Do not put API keys in URLs you publish without the provider's referrer restrictions.
- Status: n/a (pattern).
- Sources: https://web.dev/articles/embed-best-practices

### Remove the embed, or link to it, when no loading technique makes it cheap enough
- Layer: html
- Stage: network, script-run
- Metrics: LCP, INP, TBT
- When: load
- Impact: medium, because the cheapest embed is the one you do not load
- Do: Replace the embed with a plain link that opens the content in a new tab. Audit third-party impact regularly, because vendor code changes without notice.
- Why: Embed source code changes silently, so its cost can grow between audits.
- Status: In Lighthouse 13, `third-party-summary` became `third-parties-insight`.
- Sources: https://web.dev/articles/embed-best-practices, https://developer.chrome.com/blog/lighthouse-13-0

### Reserve an embed's final size per breakpoint, then release the reservation
- Layer: css
- Stage: layout
- Metrics: CLS
- When: load
- Impact: high for script-injected embeds that ship with no dimensions
- Do: Give iframes `width`/`height` (or `aspect-ratio`). For script-injected widgets whose height is unknown, measure the rendered height at common viewport widths. Set `min-height` on a wrapper per media or container query, and remove it after the widget initializes.
- Why: When the browser knows the box size before the content arrives, nothing below it moves. This is how Layout Shift Terminator works: it measures at each viewport, then writes min-height rules.
- Example:
  ```css
  .feed-slot { min-height: 520px; }
  @media (min-width: 768px) { .feed-slot { min-height: 640px; } }
  .feed-slot[data-ready] { min-height: 0; } /* set by the embed's load callback */
  ```
- Avoid/caveats: If the reserved height is too large, you get a gap and a shift when it collapses. Collapse only when the element is out of the viewport, or let the content fill the space. Layout Shift Terminator (GoogleChromeLabs) was archived on 2026-03-27, so reuse the technique, not the tool.
- Status: `aspect-ratio` is Baseline widely available (since 2024-03-20). Size container queries are Baseline widely available (since 2025-08-14; web-features).
- Sources: https://web.dev/articles/embed-best-practices, https://github.com/GoogleChromeLabs/layout-shift-terminator

### Treat the embed article's iframe `loading` details as outdated
- Layer: html
- Stage: network
- Metrics: LCP, bundle-size
- When: load
- Impact: low, because only the details changed; `loading="lazy"` itself is still correct
- Do: Use only `loading="lazy"` or `"eager"` on iframes. Do not use `"auto"`. Do not load lazysizes for iframes or images. Do not set `frameborder`; use CSS `border:0`.
- Why: MDN lists only `eager` (the default) and `lazy`. Chrome Lite mode, which the article says auto-lazy-loads iframes, was removed in Chrome 100 (March 2022). Native lazy loading is deferred only when JavaScript is enabled (an anti-tracking rule).
- Status: `loading` on iframes: Chrome 77, Firefox 121, Safari 16.4. Baseline "Lazy-loading images and iframes" is widely available since 2026-06-19 (newly 2023-12-19). `frameborder` is deprecated (BCD). The lazysizes repo has had no push since 2024-04.
- Sources: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe, web-features (loading-lazy), BCD html.elements.iframe.frameborder

---

## Long lists: infinite scroll, "Load more", virtualization

### Reserve space for the next batch with skeletons that match the final item size
- Layer: css
- Stage: layout
- Metrics: CLS
- When: interaction | long-lived session
- Impact: high for feeds, blotters, and history tables that grow while the user watches
- Do: Before you fetch, insert placeholders with the exact height of the real rows or cards (fixed row height, or `aspect-ratio` for media). Then fill them in place.
- Why: A placeholder of the wrong size still shifts content when it is replaced. The blog shows Facebook's feed shifting for this reason.
- Example:
  ```css
  .row, .row--skeleton { block-size: 28px; }         /* same box for both */
  .card, .card--skeleton { aspect-ratio: 4 / 3; }
  ```
- Avoid/caveats: The data must fit the reserved box. Give rows a fixed height and clip overflow. The `line-clamp` feature is not Baseline in web-features, so prefer `-webkit-line-clamp` with a fixed block size as the fallback.
- Status: n/a (pattern). `aspect-ratio` is Baseline widely available.
- Sources: https://addyosmani.com/blog/infinite-scroll-without-layout-shifts/ (blog)

### Prefetch the next page early enough that appended content lands inside the 500 ms input window
- Layer: js
- Stage: network, layout
- Metrics: CLS, INP
- When: interaction
- Impact: medium, because a shift more than 500 ms after a click counts as unexpected CLS
- Do: Start fetching the next page well before the user reaches the end, for example with an IntersectionObserver sentinel and a large `rootMargin`. For "Load more", keep the next page ready so the click can render at once. If a delay is unavoidable, reserve the space at once and fill it later.
- Why: Chrome excludes shifts that happen within 500 ms of a discrete input (tap, click, keypress; `hadRecentInput`). Scroll, drag, and pinch do not count as input, so any shift during scroll-triggered appends counts toward CLS.
- Example:
  ```js
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) loadNextPage(); },
    { rootMargin: '0px 0px 1500px 0px' }); // start ~1.5 viewports early
  io.observe(document.querySelector('#list-sentinel'));
  ```
- Avoid/caveats: Prefetching too far wastes data and memory. Instagram is the blog's example of prefetching done well.
- Status: IntersectionObserver is Baseline widely available. `LayoutShift`/`hadRecentInput` is Chromium only (BCD, experimental), so CLS field data comes only from Chromium.
- Sources: https://addyosmani.com/blog/infinite-scroll-without-layout-shifts/ (blog), https://web.dev/articles/cls

### Do not put content below an unbounded list
- Layer: html
- Stage: layout
- Metrics: CLS
- When: long-lived session
- Impact: medium, because a footer under an infinite list shifts on every append
- Do: Remove the footer from infinite-scroll pages, move it to a side area or a fixed bar, or switch to "Load more" or pagination so the user controls growth.
- Why: Each append pushes the footer down. If the footer is in the viewport, each append is a layout shift.
- Status: n/a.
- Sources: https://addyosmani.com/blog/infinite-scroll-without-layout-shifts/ (blog)

### Virtualize long lists: render only the visible window of rows
- Layer: js
- Stage: style, layout, paint, gc-memory
- Metrics: INP, CLS, memory, FPS/smoothness
- When: long-lived session | animation/render-loop
- Impact: high for thousands of rows (order books, trade history, logs)
- Do: Use one scroll container whose inner spacer has the full list height. Absolutely position (or `translateY`) a small, reused pool of row elements for the visible range plus a small overscan. Update the pool on scroll, at most once per animation frame.
- Why: DOM size drives style, layout, and memory cost. With virtualization the DOM stays at about (viewport rows + overscan) no matter how many items there are. With fixed-height rows the scroll height never changes, so appends do not shift content.
- Example:
  ```js
  const ROW = 24, OVERSCAN = 8;
  let queued = false;
  scroller.addEventListener('scroll', () => {
    if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; paintRows(); }); }
  }, { passive: true });
  function paintRows() {
    spacer.style.height = `${data.length * ROW}px`;
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW) - OVERSCAN);
    pool.forEach((el, i) => {
      const idx = first + i;
      el.hidden = idx >= data.length;
      if (!el.hidden) { el.style.transform = `translateY(${idx * ROW}px)`; el.textContent = data[idx].label; }
    });
  }
  ```
- Avoid/caveats: Virtualization breaks browser find-in-page and makes accessibility harder (screen readers see only rendered rows, and keyboard focus can land on a recycled row). Variable-height rows need measurement and position correction. `content-visibility: auto` plus `contain-intrinsic-size` is a lighter option when you want to keep all DOM nodes; that is our addition, not from the blog. The blog names react-window (still maintained, pushed 2026-09).
- Status: `content-visibility` is Baseline 2025 (newly available 2025-09-15). `contain-intrinsic-size` is Baseline widely available (2026-03-18).
- Sources: https://addyosmani.com/blog/infinite-scroll-without-layout-shifts/ (blog), web-features (content-visibility, contain-intrinsic-size)

### Expect CLS to be counted per 5-second session window, including in long-lived SPAs
- Layer: tooling
- Stage: layout
- Metrics: CLS
- When: long-lived session | testing
- Impact: medium, because lab tools (load only) miss shifts that field data records until the page is hidden
- Do: Test layout stability after load: scrolling, "Load more", and live data. Use a RUM library (web-vitals) or the DevTools Performance panel, not only Lighthouse.
- Why: Since 2021, CLS is the largest "session window" of shifts (gap under 1 s, window at most 5 s). This replaced the blog's pure sum, so it limits but does not remove the build-up in long sessions. Field data (CrUX) measures until the page is hidden. Lighthouse sees only the load.
- Status: CLS thresholds: good ≤ 0.1, poor > 0.25 (web.dev/cls, updated 2023-04-12).
- Sources: https://web.dev/articles/cls, https://addyosmani.com/blog/infinite-scroll-without-layout-shifts/ (blog)

### Prefer "Load more" over automatic infinite scroll when accessibility matters
- Layer: html
- Stage: layout, gc-memory
- Metrics: memory, CLS
- When: long-lived session
- Impact: low for performance, high for usability
- Do: Offer a "Load more" button, keep a URL per page (pagination) for back-button and deep links, and restore scroll position on back.
- Why: Infinite scroll can make the footer unreachable, hurts keyboard and screen-reader navigation, and grows memory without limit (items the blog cites from WordPress accessibility guidance).
- Status: n/a.
- Sources: https://addyosmani.com/blog/infinite-scroll-without-layout-shifts/ (blog)

---

## Cookie and consent notices (and any "Accept"-style click that starts heavy work)

### After a heavy click, paint the acknowledgment first, then yield, then run callbacks; remove DOM later
- Layer: js
- Stage: main-thread-task, script-run, paint, idle
- Metrics: INP
- When: interaction
- Impact: high, because a consent "Accept" commonly starts all third-party tags in one long task
- Do: In the click handler, do only the visible change (hide the banner). Yield to the main thread. Then save state and run each vendor callback, yielding between callbacks. Hide with `display:none`, and remove the nodes later in an idle callback ("lazy de-rendering").
- Why: INP ends at the next paint after the handler. When the handler yields early, that paint can happen before the heavy work runs. PubTech used `scheduler.yield()` with a fallback to `scheduler.postTask()` (`user-blocking` priority for important work, `user-visible` for the rest) and then `setTimeout`, and deferred DOM removal with `requestIdleCallback`. The case study reports INP up to 65% better, and one customer going from 470 ms to 230 ms.
- Example:
  ```js
  const yieldToMain = () =>
    globalThis.scheduler?.yield ? scheduler.yield() : new Promise(r => setTimeout(r, 0));
  const whenIdle = globalThis.requestIdleCallback ?? (fn => setTimeout(fn, 300));

  acceptBtn.addEventListener('click', async () => {
    banner.style.display = 'none';        // cheap visual response
    await yieldToMain();                  // let this frame paint
    persistConsent('all');
    for (const cb of onConsent) { cb(); await yieldToMain(); }
    whenIdle(() => banner.remove());      // lazy de-render
  });
  ```
- Avoid/caveats: In the case study, PubTech yielded first and hid the dialog after it processed the settings. Hiding first (as shown here) is a variant that gives earlier visual feedback. Yielding lets other tasks run in between, so do not leave shared state half-updated. If you use a vendor CMP, ask the vendor for this.
- Status: `scheduler.yield`: Chrome/Edge 129, Firefox 142, not in Safari (BCD). The Scheduler API is not Baseline. `requestIdleCallback` is not in Safari (web-features, not Baseline), so keep the fallback.
- Sources: https://web.dev/articles/cookie-notice-best-practices, https://web.dev/case-studies/pubconsent-inp

### Load the consent script directly in the HTML, async, with early connections to each of its origins
- Layer: html
- Stage: preload-scan, network, html-parse
- Metrics: LCP, FCP, CLS
- When: load
- Impact: medium, because a consent script added by a tag manager is invisible to the preload scanner and starts late
- Do: Write `<script src=... async>` for the CMP in the page HTML (not through a tag manager). Add `preconnect` (or `dns-prefetch`) for every origin the CMP uses: each origin needs its own hint. Use `preload` only if the CMP is one of the few most critical resources, and always include `as="script"`.
- Why: The lookahead (preload) scanner finds only URLs in the markup. Injected scripts wait for the injector script to download and run. A synchronous script blocks the parser, which delays FCP and LCP.
- Example:
  ```html
  <!-- Before (as printed in the article: missing `as`) -->
  <link rel="preload" href="https://cmp.example/consent.js">
  <!-- After -->
  <link rel="preconnect" href="https://cmp.example">
  <link rel="preload" href="https://cmp.example/consent.js" as="script">
  <script src="https://cmp.example/consent.js" async></script>
  ```
- Avoid/caveats: MDN says `as` is required. Without it the browser cannot match the preload to the later `<script>` request, which can cause a second download (Chromium also logs a console warning). If the script is fetched with CORS (`crossorigin` or `type=module`), give the preload the same `crossorigin` mode. If the CMP must be synchronous (to block cookies), make that one request as fast as possible.
- Status: `rel=preload` and `rel=preconnect` are Baseline widely available. `rel=dns-prefetch` is Baseline 2025 (Safari iOS 26).
- Sources: https://web.dev/articles/cookie-notice-best-practices, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload

### Show notices as overlays, or reserve their space; never insert them above rendered content
- Layer: css
- Stage: layout, composite
- Metrics: CLS, LCP
- When: load
- Impact: high, because a top-inserted banner pushes the whole page down
- Do: Use a fixed or sticky footer bar or a small modal, or reserve the banner's height in the initial HTML. Animate slide-in with `transform`/`opacity`, not with `top`/`height`/`margin`. Keep banner text short on mobile, because a large text block can become the LCP element.
- Why: An overlay does not take part in the page's in-flow layout, so it cannot shift content. Transform animations do not cause layout shifts.
- Example:
  ```css
  .consent { position: fixed; inset: auto 0 0 0; transform: translateY(100%); transition: transform .25s; }
  .consent.is-open { transform: none; }
  ```
- Avoid/caveats: A full-screen modal can raise bounce rates, and "cookie wall" laws may apply. Late-loading fonts inside the banner can also shift it.
- Status: n/a.
- Sources: https://web.dev/articles/cookie-notice-best-practices

### Self-host or service-worker-cache third-party consent scripts, and check their styling chain
- Layer: network
- Stage: network
- Metrics: LCP, FCP
- When: load
- Impact: low to medium, because it removes an origin and gives you control of caching
- Do: Serve the CMP script from your own origin, or cache it with a service worker. Check what fonts and CSS the CMP loads for its custom styling, because third-party CMPs cannot reuse your page's fonts and often load styles at the end of long request chains.
- Why: A self-hosted script reuses the main connection and your cache headers. A third-party chain (script, then CSS, then font) adds round trips.
- Avoid/caveats: A self-hosted copy goes stale. You must update it when the vendor changes. The vendor's license or terms may forbid self-hosting.
- Status: n/a.
- Sources: https://web.dev/articles/cookie-notice-best-practices

### Test each consent state and each cache state; trust RUM over lab data
- Layer: tooling
- Stage: network, main-thread-task
- Metrics: LCP, INP, CLS
- When: testing
- Impact: medium, because lab tools by default measure only the "unanswered" first visit
- Do: Test accepted, rejected, and unanswered states, each with a cold and a warm cache. In WebPageTest, script a click (`combineSteps` / `navigate %URL%` / `clickAndWait id=...`; the script is tab-separated) or set a Cookie header. In Lighthouse CLI, pass `--extra-headers "{\"Cookie\":\"...\"}"`. PageSpeed Insights cannot set cookies. Use a RUM library that does not need cookies (web-vitals) so users who reject cookies still report data.
- Why: Accepting consent loads a different set of scripts, so each state is in effect a different page.
- Status: n/a (tooling).
- Sources: https://web.dev/articles/cookie-notice-best-practices

---

## Tags, tag managers, and telemetry beacons

### Never deliver UX-critical resources through a tag manager
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP, CLS
- When: load
- Impact: high, because tag-manager resources load late and ad blockers often block them
- Do: Put cookie notices, hero images, and product features in the page's own HTML and bundles. Keep the tag manager for non-essential marketing and analytics tags. The delay then becomes an advantage.
- Why: A tag manager must download and run before its tags start, and the preload scanner cannot see those tags. Users who block tag managers would get a broken site.
- Status: n/a.
- Sources: https://web.dev/articles/tag-best-practices

### Prefer pixels, then sandboxed templates; limit Custom HTML tags
- Layer: js
- Stage: script-run, layout, main-thread-task
- Metrics: INP, CLS, TBT
- When: load
- Impact: medium, because Custom HTML tags can inject any DOM and script, and tools attribute their cost to the tag manager
- Do: Use image/iframe pixels where the vendor supports them (look for a `<noscript>` pixel in the vendor snippet). Otherwise use Custom Templates with `injectScript`. In a Custom HTML tag, load libraries by `<script src>` (cacheable) and do not paste the code inline. Do not follow vendor advice to put a script "at the top of `<head>`": the `<head>` has usually been parsed already.
- Why: Pixels run no JS after firing (under 1 KB, no layout shifts). Inline-pasted libraries make the container larger and cannot be cached separately. Inserted elements force layout, which is worse on low-end devices and with large DOMs.
- Avoid/caveats: Use allow/deny lists (`gtm.allowlist`, `gtm.blocklist` in the dataLayer) to forbid `customScripts` entirely.
- Status: Google Tag Manager-specific.
- Sources: https://web.dev/articles/tag-best-practices

### Send fire-and-forget telemetry with sendBeacon or fetch keepalive on `visibilitychange`/`pagehide`, never on `unload`
- Layer: js
- Stage: network, main-thread-task
- Metrics: INP, memory
- When: long-lived session | interaction
- Impact: medium, because it keeps analytics off the critical path, keeps the page eligible for bfcache, and survives page exit
- Do: Queue events in memory. Flush with `navigator.sendBeacon()` (POST only, no custom headers), or with `fetch(url, {method:'POST', body, keepalive:true})` when you need other methods or headers. Flush when `visibilityState` becomes `hidden` and on `pagehide`.
- Why: Both APIs send requests that the browser completes after the page goes away, without blocking. In Chromium, `sendBeacon` is built on keepalive fetch. Pixels and XHR are likely to be dropped at unload.
- Example:
  ```js
  const q = [];
  export const track = (e) => q.push(e);
  function flush() {
    if (!q.length) return;
    const body = JSON.stringify(q.splice(0));
    if (!navigator.sendBeacon('/rum', body)) {
      fetch('/rum', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  }
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);
  ```
- Avoid/caveats: The Fetch spec caps all in-flight keepalive bodies in a fetch group at 64 KiB in total, not per request. Batch the events and keep payloads small. `sendBeacon` returns `false` when it cannot queue the data. The article's claim that keepalive has less support than sendBeacon is outdated. The article's mention of `unload` is outdated too: Chrome is deprecating `unload` for all sites (Chrome 146–154, 1% to 100%, March–September 2026). `fetchLater()` (Chromium 135+ only) is a newer deferred-send API.
- Status: sendBeacon is Baseline widely available (2018). `Request.keepalive`: Chrome 66, Edge 15, Safari 13, Firefox 133, so all engines. `fetchLater`: Chromium 135+ only, not Baseline.
- Sources: https://web.dev/articles/tag-best-practices, https://developer.mozilla.org/en-US/docs/Web/API/RequestInit, https://fetch.spec.whatwg.org/, https://developer.chrome.com/docs/web-platform/deprecating-unload

### Fire non-essential tags late, on narrow triggers, with few variables
- Layer: js
- Stage: main-thread-task, script-run, network
- Metrics: LCP, INP, TBT
- When: load
- Impact: medium, because the earlier a tag fires, the more it competes with page-load work
- Do: Fire non-essential tags after `Window Loaded`, or on a custom `dataLayer` event that you control (for example, after first render or on idle). Limit triggers to the pages that need them, and keep conditions simple. Delete unused variables. Consider loading the tag manager itself later.
- Why: Triggers and variables are JS in the container. Variables are evaluated again on every dataLayer push. Several click or timer triggers add a lot of work.
- Example:
  ```js
  // fire marketing tags only after the app has painted and gone idle
  requestAnimationFrame(() => setTimeout(() => dataLayer.push({ event: 'app-idle' }), 0));
  ```
- Avoid/caveats: Complex trigger conditions take CPU time too.
- Status: Google Tag Manager-specific.
- Sources: https://web.dev/articles/tag-best-practices

### Keep the tag container lean and governed
- Layer: tooling
- Stage: network, script-compile, script-run
- Metrics: bundle-size, INP, TBT
- When: build | testing
- Impact: medium, because containers only grow unless someone removes tags
- Do: Use one container per page (or a small "early" container and a larger "late" one). Pause or remove unused tags; blocking them with a trigger exception leaves their code in the container. Clean up orphaned triggers and variables. Use the dataLayer rather than direct DOM or JS-variable reads. Label every tag with an owner, name container versions, require approval for changes, and audit on a schedule. Consider server-side tagging so one client request fans out on the server.
- Why: Every tag, trigger, and variable adds bytes and evaluation time. A second container duplicates the core runtime (about 33 KB compressed, per the article).
- Avoid/caveats: The article says Google Tag Manager limits containers to 300 KB, and that the median is about 50 KB. The current Google help page states only the "above 70%" warning, not a KB number. Third-party blogs report 200 KB. Treat the number as unconfirmed.
- Status: Google Tag Manager-specific.
- Sources: https://web.dev/articles/tag-best-practices, https://support.google.com/tagmanager/answer/2772488

### Measure tags in isolation, not in Preview mode
- Layer: tooling
- Stage: script-run
- Metrics: INP, CLS, TBT
- When: testing
- Impact: low, because it improves attribution, not speed itself
- Do: Before release, test a tag on an empty page with a single-tag container to measure its script cost. Then test it on the real page for layout shifts. Do not compare Web Vitals from GTM Preview mode with production, because Preview adds overhead. Track tag execution time with the GTM Monitoring API.
- Why: Most tools attribute a Custom HTML tag's cost to the tag manager, which hides the tag that is really at fault.
- Status: n/a.
- Sources: https://web.dev/articles/tag-best-practices

---

## Carousels (and any auto-advancing or sliding UI)

### Put slides in the initial HTML, not injected by JavaScript
- Layer: html
- Stage: preload-scan, network
- Metrics: LCP
- When: load
- Impact: high, because the article calls JS-initiated slide loading probably the single biggest carousel performance mistake
- Do: Write at least the first slide's `<img>` in the markup, then add navigation and extra slides with JS as a progressive enhancement. On pages where users stay only briefly, a single static image can work as well.
- Why: The preload scanner starts fetching `<img src>` from the HTML at once. Images created by JS wait for the script to download and run.
- Example:
  ```js
  // Before: first slide created by script (late discovery)
  track.append(Object.assign(document.createElement('img'), { src: '/promo/1.avif' }));
  ```
  ```html
  <!-- After: first slide in HTML, prioritized -->
  <div class="track"><img src="/promo/1.avif" width="1200" height="500" alt="…" fetchpriority="high"></div>
  ```
- Status: `fetchpriority` is Baseline 2024 (newly available 2024-10-29).
- Sources: https://web.dev/articles/carousel-best-practices

### Animate slide transitions with `transform`, never with `left`/`top`/`width`/`margin`
- Layer: css
- Stage: layout, composite
- Metrics: CLS, FPS/smoothness
- When: animation/render-loop
- Impact: high for auto-advancing UI, because non-composited slides can add CLS on every tick, without end
- Do: Move the track with `transform: translateX()`. Show or hide navigation controls with `opacity`/`visibility`. Do not add or remove controls from the DOM on hover.
- Why: Changes to `transform` do not count as layout shifts, and they can run on the compositor. Changes to `left`/`margin` move boxes. A user-driven slide is excused by the 500 ms input window, but an autoplay slide has no input, so every transition counts.
- Example:
  ```css
  /* Before */ .track { position: relative; left: calc(var(--i) * -100%); transition: left .4s; }
  /* After  */ .track { transform: translateX(calc(var(--i) * -100%)); transition: transform .4s; }
  ```
- Avoid/caveats: When an element's position changes together with an equal and opposite change of `scrollLeft`/`scrollTop` in the same frame, it is not a layout shift. So scroll-driven carousels are safe. Chrome 88–90 fixed several CLS bugs that affected carousels.
- Status: Lighthouse `non-composited-animations` is still an audit after Lighthouse 13 (per the Chrome blog).
- Sources: https://web.dev/articles/carousel-best-practices, https://web.dev/articles/cls

### Keep all auto-advancing slide images at the same intrinsic size
- Layer: html
- Stage: paint
- Metrics: LCP
- When: load
- Impact: medium, because a later, larger slide can become the LCP element and push LCP later
- Do: Export every autoplay slide at identical intrinsic dimensions (at least as large as the display size), so the first slide stays the LCP element.
- Why: For each image, LCP counts the smaller of visible size and intrinsic size, and only a strictly larger candidate replaces the current one. Before the first interaction, any slide painted can become the LCP element. Since Chrome 88, images removed from the DOM stay candidates, so removing old slides no longer resets LCP.
- Avoid/caveats: LCP stops taking new candidates after the first tap, scroll, or keypress. For non-autoplay carousels, only the first slide matters.
- Status: LCP entries are Baseline 2025 (newly available 2025-12-12; Firefox 122, Safari 26.2).
- Sources: https://web.dev/articles/carousel-best-practices, https://web.dev/articles/lcp

### Build carousels with CSS scroll snap before you reach for a JS library
- Layer: css
- Stage: script-run, composite
- Metrics: INP, bundle-size, CLS
- When: load | interaction
- Impact: medium, because a CSS-only carousel ships no JS and scrolls on the compositor
- Do: Use `scroll-snap-type` and `scroll-snap-align` on an overflow container. Add Chromium's `::scroll-button()`/`::scroll-marker` as progressive enhancement. If you must use a library, prefer a modern, dependency-free one, and replace any carousel that shows long tasks.
- Why: Scroll snap uses native scrolling (with swipe support). The Chrome team says the performance of a CSS carousel is better than any JavaScript version, and that it needs no hydration.
- Example:
  ```css
  .slides { display: grid; grid-auto-flow: column; grid-auto-columns: 100%;
            overflow-x: auto; scroll-snap-type: x mandatory; overscroll-behavior-x: contain; }
  .slides > * { scroll-snap-align: start; }
  @supports selector(::scroll-marker) { /* add markers/buttons in Chromium 135+ */ }
  ```
- Avoid/caveats: Since Chrome 121, lazy-loaded images in horizontal scrollers use the same distance thresholds as vertical scrolling. They now load before they are visible, which means more downloads. Budget for it, or keep offscreen slides lighter.
- Status: Scroll snap is Baseline widely available (since 2022-07-15). `overscroll-behavior` (used in the example) is not marked Baseline in web-features, so treat it as an enhancement. `::scroll-button()`, `::scroll-marker`, `::scroll-marker-group`, and `:target-current` ship in Chrome/Edge 135+ only (not in Firefox or Safari; web-features).
- Sources: https://web.dev/articles/carousel-best-practices, https://developer.chrome.com/blog/carousels-with-css

### Do not autoplay; if you must, pause on hover and time each slide by its text length
- Layer: js
- Stage: main-thread-task, layout
- Metrics: CLS, FPS/smoothness
- When: animation/render-loop
- Impact: low to medium, because autoplay is the cause of carousel CLS that never stops, and it also distracts users
- Do: Let the user advance slides. If autoplay is required, stop it on hover or focus, and scale the time each slide shows with its text length. Keep text in HTML, not in the image.
- Why: With no autoplay, every transition follows an input, which removes the source of CLS that has no input. Users also tend to ignore auto-advancing content as ads.
- Status: n/a.
- Sources: https://web.dev/articles/carousel-best-practices

---

## Standard levers seen
(Other research tracks cover these in depth. One line each, with the article that repeats them.)
- Put `fetchpriority="high"` on the LCP image. (image-cdns, carousels) Baseline 2024.
- Use `<link rel="preload" as="image">` for an LCP image the HTML parser cannot find. (image-cdns)
- Preconnect or dns-prefetch to third-party origins you will use soon. (image-cdns, cookie notices)
- Serve responsive images with `srcset`/`sizes` and `width`/`height`. (image formats, carousels)
- Replace animated GIFs with `<video autoplay muted loop playsinline>`. (image formats)
- Optimize web fonts, since late fonts shift and block banners. (image formats, cookie notices)
- Code-split and lazy-load libraries that the first view does not need. (remove unused code)
- Load third-party scripts with `async`/`defer`, placed after first-party critical tags. (embeds, cookie notices)
- Add `loading="lazy"` to offscreen iframes and images, but never to the LCP or above-the-fold content. (embeds) Baseline widely available 2026-06-19.
- Set `width`/`height` on iframes and images to reserve space. (embeds)
- Break up long tasks and yield to the main thread. (cookie notices, via "Optimize long tasks")
- Avoid non-composited animations. (carousels)
- Treat RUM field data as the source of truth, and lab data as a diagnostic. (cookie notices, infinite scroll)
- Lighthouse 13 renames: `third-party-summary` became `third-parties-insight`, `layout-shifts` became `cls-culprits-insight`, `modern-image-formats`/`uses-optimized-images`/`efficient-animated-content` became `image-delivery-insight`, `uses-rel-preconnect` became `network-dependency-tree-insight`, and `uses-rel-preload` and `third-party-facades` were removed. (verified 2026-09 against developer.chrome.com)

## Sources read
- https://web.dev/explore/fast (collection, via the batch list)
- https://web.dev/articles/image-cdns
- https://web.dev/articles/choose-the-right-image-format
- https://web.dev/articles/remove-unused-code
- https://web.dev/articles/embed-best-practices
- https://addyosmani.com/blog/infinite-scroll-without-layout-shifts/
- https://web.dev/articles/cookie-notice-best-practices
- https://web.dev/articles/tag-best-practices
- https://web.dev/articles/carousel-best-practices
- https://web.dev/case-studies/pubconsent-inp
- https://web.dev/articles/cls
- https://web.dev/articles/lcp
- https://developer.chrome.com/docs/web-platform/deprecating-unload
- https://developer.chrome.com/blog/lighthouse-13-0
- https://github.com/GoogleChrome/lighthouse/releases/tag/v13.0.0
- https://developer.chrome.com/blog/carousels-with-css
- https://developer.chrome.com/docs/devtools/coverage
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
- https://developer.mozilla.org/en-US/docs/Web/API/RequestInit
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Content_negotiation/List_of_default_Accept_values
- https://fetch.spec.whatwg.org/ (keepalive 64 KiB in-flight quota, fetchLater quotas)
- https://firebase.google.com/docs/web/modular-upgrade
- https://support.google.com/tagmanager/answer/2772488
- https://cdn.jsdelivr.net/npm/web-features/data.json (v3.39.0) and https://cdn.jsdelivr.net/npm/@mdn/browser-compat-data/data.json (v8.1.2, 2026-09-17)
- GitHub API repo metadata: GoogleChromeLabs/layout-shift-terminator (archived), calibreapp/react-live-chat-loader (archived), GoogleChromeLabs/webpack-libs-optimizations (archived), aFarkas/lazysizes, paulirish/lite-youtube-embed, justinribeiro/lite-youtube, bvaughn/react-window
- Web search results (secondary sources): Chrome Lite mode removed in Chrome 100 (androidpolice, xda-developers); JPEG XL in Chrome 145 behind a flag (phoronix, corewebvitals.io); Chrome 121 horizontal lazy-load thresholds (the carousel article, repeated in search results)

## Not covered / could not access
- The embedded videos in Addy Osmani's post (YouTube) and the article screenshots were not viewed. The text alone gave the levers.
- The Chrome 121 horizontal lazy-loading change was confirmed only through the carousel article and search results. A dedicated developer.chrome.com post was not found (a guessed URL returned 404). The exact distance thresholds (covered by the HTML loading-attributes track) were not rechecked here.
- The Google Tag Manager container size limit (300 KB in the article, 200 KB in blogs) could not be confirmed on an official Google page.
- JPEG XL status in Chrome comes only from blogs and news sites. web-features shows Safari-only support.
- The claim that `unused-javascript` and `unused-css-rules` remain in Lighthouse 13 rests only on their absence from the removal lists. The audit list itself was not opened.
- Linked follow-up pages (install Thumbor, lazy-loading distance thresholds, debug layout shifts, efficiently load third-party JavaScript, optimize long tasks, Instagram engineering post, Telegraph third-party post, Simo Ahava's GTM monitor) were not read. Other research tracks cover most of them.
- Vendor-specific embed details (Facebook `data-lazy`, Instagram WordPress plugins, Tweetpik, Google Maps Embed/Static APIs) were not rechecked for current behavior. The notes present them only as examples of the facade and lazy-load patterns.
