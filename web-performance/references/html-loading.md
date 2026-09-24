# HTML loading: document, head, scripts, hints, bundles and next navigation (HTML-)

Open this when you write the HTML document or its server template (`<head>`, `<script>`, `<link rel=…>`, `<meta>`), resource hints or `fetchpriority`, bundler output and code splitting, startup JavaScript, third-party tags, speculation rules, SPA routing, or HTTP headers that the app sets.
Stage cards: `pipeline.md` §H (`network`, `parse`, `cssom`, `script-load`, `tasks`). Load phases and the code that controls each: `pipeline.md` §B. Images, fonts, video and reserved space: html-media-and-fonts.md.

## Checklist

| ID | Do this | Impact | First stage |
|---|---|---|---|
| **§A Document and head** | | | |
| HTML-01 | Charset in the first 1024 bytes; a mobile viewport in the server HTML | medium | parse |
| HTML-02 | A lean head in a fixed order; small inline scripts above CSS; no `document.write` | high | parse |
| HTML-03 | Server-render or stream the first view; never build the LCP element in client JS | high | parse |
| **§B Scripts** | | | |
| HTML-04 | `type="module"` or `defer` by default; `async` only for independent scripts | high | parse |
| HTML-05 | Startup scripts as tags, not injected; `fetchpriority` on the script, not a preload | medium | network |
| HTML-06 | `blocking="render"` only for a known wrong first frame | low | parse |
| **§C CSS delivery** | | | |
| HTML-07 | No CSS `@import` at run time: one `<link>` per sheet | medium | network |
| HTML-08 | Small render-blocking CSS: split by route and by `media` | high | cssom |
| HTML-09 | Inline critical CSS only with a CSP-safe load of the rest | medium | cssom |
| **§D Discovery and priority** | | | |
| HTML-10 | Critical resources as plain tags in the server HTML | high | parse |
| HTML-11 | Preconnect to at most 2 origins with the right `crossorigin`; `dns-prefetch` for the rest | medium | network |
| HTML-12 | Preload only late-discovered resources, with matching `as`, `crossorigin`, `imagesrcset` | medium | network |
| HTML-13 | Flat module graphs: bundle, `modulepreload` the static graph, one import map first | medium | network |
| **§E Bundles and startup JS** | | | |
| HTML-14 | `import()` for everything that is not in the first view; start it on intent | high | script-load |
| HTML-15 | Chunks of about 100 KB with hashed names; no barrel imports on startup routes | medium | tasks |
| HTML-16 | Modern output: no `nomodule`, no polyfills for Baseline features, no ES5 | medium | script-load |
| HTML-17 | Code cache: stable external URLs, deterministic startup, one compile hint, JSON for data | medium | script-load |
| HTML-18 | Third parties late or behind facades; self-host the ones the first view needs | high | tasks |
| **§F Next navigation** | | | |
| HTML-19 | Speculation rules with moderate eagerness; prerender only pages safe to run early | medium | network |
| HTML-20 | SPA route changes as soft navigations: user action, URL change, paint | medium | tasks |
| **§G HTTP headers the front end controls** | | | |
| HTML-21 | Hashed files cached for a year; HTML with `no-cache` and an `ETag` | high | network |
| HTML-22 | `private, no-cache` for personalized HTML; `no-store` only when sensitive | medium | network |
| HTML-23 | Brotli or zstd for all text, pre-compressed at build time | high | network |
| HTML-24 | 103 Early Hints when the HTML is slow to build | medium | network |
| HTML-25 | `Server-Timing` on the document; `Timing-Allow-Origin` on reported assets | low | network |
| HTML-26 | No redirect hop before the document | medium | network |
| **§H One-line rules** | | | |
| HTML-27 | Compression dictionaries for bundles that deploy often | medium | network |
| HTML-28 | First-view server data as a JSON data block, sent once | medium | script-load |
| HTML-29 | Declarative shadow DOM; hydrate the existing root | low | parse |

- → MEDIA-01, MEDIA-02 the LCP image: an `<img>` in the server HTML with `fetchpriority="high"`, never lazy; → MEDIA-07 font discovery and preload
- → TASK-06, EVT-14 split startup into phases with yields; start `import()` on intent
- → DATA-13, DATA-15 `priority: 'low'` on background `fetch()`; no service worker on the critical path
- → LIFE-07 back/forward cache: no `unload`, close connections in `pagehide`
- → DOM-09 `<dialog>`, `popover` and `<details>` instead of UI libraries
- → SC-35, TASK-14, TASK-17 chart library by `import()` on chart routes; stream-compiled Wasm; no top-level `await` in shared modules

## §0 Directive map

| Directive | Effect on loading | Rule |
|---|---|---|
| `<meta charset>` in the first 1024 bytes | no second parse with another encoding | HTML-01 |
| `<script src>` with no attribute | stops the parser for download and run; waits for pending CSS | HTML-04 |
| `defer` or `type="module"` / `async` | parallel download at Low; run after parsing, in order / on arrival | HTML-04 |
| `fetchpriority="high"` / `"low"` | moves a request up or down from its default tier | HTML-05, HTML-12 |
| `blocking="render"`, `rel="expect"` | holds the first render, not the parser | HTML-06 |
| `<link rel="stylesheet">` in `<head>` | blocks the first render and the scripts after it | HTML-08 |
| `media` that does not match | not render-blocking; Lowest priority; the preload scanner skips it | HTML-08 |
| `@import` in an external sheet | found only after its parent: a serial chain | HTML-07 |
| `rel="preconnect"` / `dns-prefetch` | DNS, TCP and TLS early / DNS only | HTML-11 |
| `rel="preload"` | mandatory fetch at the default priority of its `as` | HTML-12 |
| `rel="modulepreload"`, `<script type="importmap">` | fetch, parse and compile one module / map specifiers, before every module | HTML-13 |
| `import()` | fetch, compile and run a module when called | HTML-14 |
| `<script type="speculationrules">`, `rel="prefetch"` | the next document in memory / a next-route file at Lowest | HTML-19 |
| `loading`, `sizes="auto"`, `img.decode()` | image and iframe timing | → MEDIA-05, MEDIA-06 |
| `103 Early Hints`, `Link:` header | hints before the HTML arrives | HTML-24 |

## §A Document and head

### HTML-01 Declare the charset in the first 1024 bytes and a mobile viewport in the server HTML
stage: parse · metric: FCP, LCP, INP · when: load · impact: medium — a late charset restarts parsing, and a missing viewport delays taps · support: baseline · also: HTML-02
- Do: Make `<meta charset="utf-8">` the first element of `<head>` (or send `Content-Type: text/html; charset=utf-8`), with no long comment or inline script before it. Next, put `<meta name="viewport" content="width=device-width, initial-scale=1">` in the server HTML, not from JS, and do not disable zoom.
- Why: When a late charset shows that the browser guessed the wrong encoding, it parses the document again from the start. Without a mobile viewport, mobile Chrome lays out a virtual page about 980 px wide and can hold a tap about 300 ms to check for a double tap; that wait counts in INP.
- Detect: `rg -n -i '<meta[^>]+charset' -g '*.{html,ejs,hbs,svelte,vue,tsx,jsx}'`, then check that it is the first child of `<head>`; `rg --files-without-match 'name="?viewport' -g '*.html'` for documents with no viewport.
- Verify: measure.md#load. Pass: the trace lists neither `CharacterSet` nor `Viewport`.
- Avoid: A viewport meta added by script is too late for the first layout. `user-scalable=no` blocks zoom for users who need it and does not make taps faster.
- Source: https://developer.chrome.com/docs/performance/insights/charset ; https://developer.chrome.com/docs/performance/insights/viewport

### HTML-02 Keep the head lean and in order: small inline scripts above CSS, no `document.write`
stage: parse, cssom · metric: FCP, LCP · when: load · impact: high — nothing paints until the head is parsed and every blocker in it resolves · support: baseline · also: HTML-04, HTML-08, HTML-17
- Do: Order the head: charset, viewport, title, preconnects, critical CSS (inline or one `<link>`), preloads for late-discovered resources, then module or `defer` scripts. Put small inline scripts that read no styles (theme class, flags) above the stylesheet links. Keep inline scripts under about 1 KB; ship larger code as files. Never use `document.write`. Move analytics and widgets out of the head (HTML-18).
- Why: The document stays render-blocked while `<body>` does not exist and while a render-blocking head resource is pending. A parser-inserted stylesheet whose `media` matches holds every later parser-blocking script, inline ones too, so the parser stops there and only the preload scanner goes on. While the head is processed, Chrome holds most low-priority requests back. `document.write` stops the parser and hides what it writes from the preload scanner.
- Example:
  ```html
  <!-- Before: the inline script waits for app.css, and the parser waits with it -->
  <link rel="stylesheet" href="/static/app.4c1d.css">
  <script>document.documentElement.dataset.theme = localStorage.getItem('theme') ?? 'light';</script>
  <!-- After: the script reads no styles, so it runs first; app code is deferred -->
  <script>document.documentElement.dataset.theme = localStorage.getItem('theme') ?? 'light';</script>
  <link rel="stylesheet" href="/static/app.4c1d.css">
  <script type="module" src="/static/main.9e2a.js"></script>
  ```
- Detect: `rg -n 'document\.write(ln)?\(' -g '*.{html,js,ts}'`; `rg -n -A4 'rel="?stylesheet' -g '*.{html,ejs,hbs}'`, then look for a `<script>` with no `src`, `defer`, `async` or `type="module"` after the link.
- Verify: measure.md#load. Pass: the FCP median wins or holds, `RenderBlocking` lists fewer requests, and LCP is not worse.
- Avoid: Do not move a script above the CSS when it reads computed style or layout. Do not inline a large script to save a request: inline code gets no background compile and no code cache (HTML-17).
- Source: https://html.spec.whatwg.org/multipage/semantics.html#interactions-of-styling-and-scripting ; https://web.dev/learn/performance/optimize-resource-loading

### HTML-03 Server-render or stream the first view; never build the LCP element in client JS
stage: parse, tasks, network · metric: LCP, FCP, INP · when: load · impact: high — client-built markup waits for download, compile and run, and it hides its resources from the preload scanner · support: baseline · also: HTML-10, DOM-06, MEDIA-01
- Do: Send the first view as HTML from the server or a static build, and stream it: flush the `<head>` before slow data work. Attach behavior after, and hydrate only the parts that are interactive. When a logged-in app shell must render on the client, send a skeleton with the final sizes, and put the LCP element's resource URL in the HTML or a preload. Never send a spinner and then fetch all data.
- Why: The browser parses streamed HTML in chunks and yields between them, and the preload scanner sees each URL as it arrives. Markup that client JS builds comes in one long task, and only after the bundle downloads, compiles and runs. Full hydration sends the UI twice: as HTML, and again as data plus code.
- Example:
  ```js
  // Before: nothing leaves the server until the data and the whole page are ready
  app.get('/products', async (req, res) => res.send(renderPage(await loadProducts(req))));
  // After: the head goes out first, so CSS and scripts load while the query runs
  app.get('/products', async (req, res) => {
    res.type('html').write(renderHead());   // charset, viewport, CSS, module scripts
    res.flush?.();                          // compression middleware holds bytes until a flush
    res.end(renderBody(await loadProducts(req)));
  });
  ```
- Detect: `rg -U -n '<body[^>]*>\s*<div id="(app|root)">\s*</div>' -g '*.html'` (an empty shell); `rg -n 'ssr\s*=\s*false|renderToString\(' -g '*.{js,ts}'`, then check that it is not in a root layout for every route.
- Verify: measure.md#load, cold, production build. Pass: the LCP median wins with a smaller load-delay subpart, the longest load task in `trace-summary.mjs` is shorter, and TTFB grows less than LCP falls.
- Avoid: Server rendering adds server time: stream it and measure TTFB with LCP. Status and headers are fixed after the first flush, so render errors inside the stream. Proxies and middleware that buffer undo streaming. Some frameworks send the shell at once and stream only data: check what yours streams.
- Source: https://web.dev/articles/client-side-rendering-of-html-and-interactivity ; https://web.dev/articles/rendering-on-the-web

## §B Scripts

### HTML-04 Load scripts with `type="module"` or `defer`; use `async` only for independent scripts
stage: parse, script-load, tasks · metric: FCP, LCP, INP · when: load · impact: high — a plain `<script src>` stops parsing for its download and its run · support: baseline · also: HTML-02, HTML-15, TASK-06
- Do: Give every external classic script `defer`, unless it must run before the rest of the page is parsed. Write module scripts without `defer` (they are deferred already). Use `async` only for self-contained scripts (RUM, analytics) that need no DOM order and no other script. Keep each deferred script small.
- Why: A classic script without attributes blocks the parser for download and run, and it also waits for pending stylesheets. `defer` and module scripts download in parallel and run after parsing, in document order, before `DOMContentLoaded`. Chromium runs each of them in its own task (support.md `separate-defer-module-tasks`), so one large bundle is still one long task. An `async` script runs when it arrives and can interrupt parsing.
- Detect: `rg -nP '<script(?![^>]*\b(defer|async|type="?module)\b)[^>]*\bsrc=' -g '*.{html,ejs,hbs,svelte,vue,tsx,jsx}'`; `rg -nP '<script[^>]*\basync\b[^>]*src="[^"]*(main|app|index|vendor)'` (an app bundle that races the parser).
- Verify: measure.md#load. Pass: `RenderBlocking` lists no script, the FCP median wins, and `trace-summary.mjs` shows no more tasks over 50 ms during load.
- Avoid: `defer` does nothing on inline classic scripts or on modules; `async` plus `defer` acts as `async`. Scripts inserted by script are `async` already. Splitting the bundle is HTML-15, not this rule.
- Source: https://html.spec.whatwg.org/multipage/scripting.html#attr-script-defer ; https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script

### HTML-05 Put startup scripts in the markup, and set `fetchpriority` on the script, not with a preload
stage: network, script-load · metric: LCP, INP · when: load · impact: medium — an injected script starts late and at Low priority · support: fetch-priority · also: HTML-04, HTML-12
- Do: Load scripts that startup needs with `<script src>` and `defer`, `async` or `type="module"`, not with `document.createElement('script')` from an inline snippet. To raise an `async` script that the first interaction needs, add `fetchpriority="high"` to that script tag. Add `fetchpriority="low"` only to a late, parser-blocking script that is not important. Inject only scripts that are really conditional or on demand.
- Why: The inline injector is itself a parser-blocking script, so it runs only after the pending CSS, and the script it adds starts at Low priority. The preload scanner finds a static `<script src>` at once. `fetchpriority="high"` gives an `async` or `defer` script the same High priority that a preload gives, with no second tag that can drift (a `crossorigin` or `integrity` mismatch fetches the file twice).
- Detect: `rg -n "createElement\(\s*['\"]script['\"]" -g '*.{html,js,ts,svelte,vue}'` in head snippets and entry code; `rg -n 'rel="?preload"?[^>]*as="?script'`, then check whether a `<script src>` for the same URL exists.
- Verify: measure.md#load. Pass: `NetworkDependencyTree` no longer shows the script behind the inline snippet, and the LCP median is not worse.
- Avoid: `fetchpriority="low"` does nothing on `async` or `defer` scripts (they are Low already). Priority is a hint: `high` on many requests cancels out, and it never changes when a script runs.
- Source: https://web.dev/articles/fetch-priority ; https://web.dev/articles/preload-scanner

- **HTML-06** Use `blocking="render"` only on a tiny head script or style whose absence paints a wrong first frame (theme, layout mode); it changes only `async`, `defer`, module and script-inserted elements, and `<link rel="expect" blocking="render">` belongs only to a cross-document view transition that needs one element in its first frame. [parse · FCP, CLS · low] https://html.spec.whatwg.org/multipage/urls-and-fetching.html#blocking-attributes

## §C CSS delivery

### HTML-07 Replace run-time CSS `@import` with one `<link>` per stylesheet
stage: network, cssom · metric: FCP, LCP · when: load · impact: medium — each import adds a serial round trip before the first render · support: baseline · also: HTML-08
- Do: List stylesheets as `<link rel="stylesheet">` in the HTML, or let the build inline them. Load third-party CSS (a font service) with `<link>` plus a preconnect, never with `@import` inside your CSS. If a run-time `@import` must stay (a cascade layer), put it in an inline `<style>` in the head, or preload the imported file.
- Why: The browser finds an `@import` inside an external stylesheet only after that sheet downloads and parses, so the requests form a chain, and every sheet in it blocks rendering. Chromium's preload scanner does read `@import` rules in an inline `<style>`, layer imports included.
- Detect: `rg -n '@import\s+(url\()?["\x27]' -g '*.css'` in the built CSS (for example the `dist` folder); Sass and Less imports in source files are resolved at build time and do not count.
- Verify: measure.md#load. Pass: `NetworkDependencyTree` no longer shows a stylesheet behind another stylesheet, and the FCP median wins or holds.
- Avoid: A `<link>` cannot assign a cascade layer; use the inline `<style>@import … layer(name)</style>` form for that.
- Source: https://web.dev/learn/performance/optimize-resource-loading ; https://developer.chrome.com/docs/performance/insights/network-dependency-tree

### HTML-08 Keep render-blocking CSS small: split it by route and by `media`
stage: cssom, network · metric: FCP, LCP · when: load, build · impact: high — the first render waits for every byte of matching head CSS, used or not · support: baseline · also: HTML-07, HTML-09
- Do: Ship in the head only the CSS that the first view of this route needs; put route and feature CSS in that route's chunk. Give print-only and viewport-only sheets a real `media` attribute. Remove large unused blocks that a coverage recording finds while you use the page. A section's non-critical CSS can go in the body, just before that section.
- Why: The CSSOM is not built incrementally, so the first render waits for every head stylesheet whose `media` matches. A sheet with a non-matching `media` does not block rendering and loads at Lowest priority, but the preload scanner skips it, so `fetchpriority="high"` cannot make it early. In Chromium, a stylesheet in the body blocks only the content after it; the parser still pauses there.
- Detect: `rg -n '<link[^>]+rel="?stylesheet' -g '*.{html,ejs,hbs,svelte,vue,tsx,jsx}'`, then check that each sheet is needed on this route or has a `media`; in the bundler report, one CSS file loaded on every route that is much larger than any route uses.
- Verify: measure.md#load, cold. Pass: `paint()` shows fewer render-blocking stylesheets or fewer blocking KB under `byType.link`, the FCP median wins, and CLS is not worse.
- Avoid: `fetchpriority="low"` on a matching head stylesheet does not stop the blocking; it only makes first paint later. "Unused" means unused in this recording: hover states, error states and other routes show as unused, so move that CSS off the critical path, do not delete it. Rule-merging minifiers can break the cascade order.
- Source: https://web.dev/articles/fetch-priority ; https://developer.chrome.com/docs/performance/insights/render-blocking

### HTML-09 Inline critical CSS only with a CSP-safe load of the rest
stage: cssom, network · metric: FCP, LCP, CLS · when: load, build · impact: medium — it saves one round trip on a cold first paint, but it is easy to get wrong · support: baseline · also: HTML-08
- Do: Inline CSS only when the full sheet delays first paint and the first view is stable. Generate the rules for the first viewport in the build (aim to fit the HTML head in about 14 KB compressed). Load the rest with a plain `<link rel="stylesheet">` at the end of `<body>`. If it must start earlier, switch `media` or `rel` from an external script, never from an inline `onload` attribute.
- Why: Inline CSS needs no request. The two common loaders differ: `media="print" onload=…` fetches at Lowest and late, and `rel="preload" as="style" onload=…` fetches at Highest (High with `fetchpriority="low"`), where it competes with the LCP image. Both need an inline event handler, which a strict Content Security Policy blocks, so the sheet never applies.
- Detect: `rg -n "onload=[\"']this\.(media|rel)" -g '*.{html,ejs,hbs,svelte,vue,tsx,jsx}'`; `rg -n 'rel="?preload"?[^>]*as="?style'`; large `<style>` blocks in head templates.
- Verify: measure.md#load, cold and warm as separate comparisons. Pass: the cold FCP median wins, warm FCP and CLS are not worse, and `list_console_messages` shows no CSP error.
- Avoid: This replaces critical-CSS guides that recommend the preload-and-`onload` swap. Inlined CSS is not cached, so every HTML response pays for it; if the sheet loads slower than the LCP resource, do not inline it. A wrong critical set flashes unstyled content and shifts layout when the rest arrives.
- Source: https://web.dev/articles/extract-critical-css ; https://web.dev/articles/fetch-priority

## §D Discovery and priority

### HTML-10 Keep critical resources as plain tags in the server HTML
stage: parse, network · metric: LCP, FCP · when: load · impact: high — the preload scanner fetches only what it sees in the raw HTML · support: baseline · also: HTML-03, HTML-12, MEDIA-01
- Do: Reference first-view CSS, scripts and the LCP image with `<link>`, `<script src>` and `<img src|srcset>` in the HTML that the server sends. Do not deliver UX-critical resources (a hero image, a cookie notice, a product feature) through a tag manager, a `data-src` swap, a CSS background or client-built markup. Keep large inline blobs (base64 fonts and images, big inline JSON) out of the head.
- Why: While the parser is blocked, the preload scanner reads raw HTML bytes only. It misses script-inserted elements, `data-*` attributes, `url()` inside external CSS, client-rendered markup and `import()`. A tag manager must download and run before its tags start. Bytes in front of a tag delay its discovery: in web.dev's test, CSS plus four base64 fonts inlined in the HTML moved LCP from about 3.5 s to over 7 s.
- Detect: `rg -n 'data-src(set)?=' -g '*.{html,svelte,vue,tsx,jsx}'`; `rg -n 'base64,' -g '*.{html,css}'`; tag-manager code (`gtm\.js|dataLayer\.push|googletagmanager`) that inserts UI, images or styles.
- Verify: measure.md#load. Pass: `LCPDiscovery` and `NetworkDependencyTree` are no longer listed, the load-delay subpart of `LCPBreakdown` shrinks, and the LCP median wins.
- Avoid: Do not fix discovery with a preload when a plain tag works: a preload is a second copy of the URL that can drift (HTML-12). A tiny inline SVG icon is fine. Tag managers are fine for marketing tags that nothing on screen needs.
- Source: https://web.dev/articles/preload-scanner ; https://web.dev/articles/tag-best-practices

### HTML-11 Preconnect to two critical origins at most, with the right `crossorigin`
stage: network · metric: LCP, FCP · when: load · impact: medium — it takes DNS, TCP and TLS off the first critical request to that origin · support: baseline · also: HTML-12, HTML-24, MEDIA-07
- Do: Add `<link rel="preconnect">` early in the head only for the 1–2 cross-origin hosts that the first view uses within seconds (font files, image CDN, API). Add `crossorigin` when the requests there use CORS (fonts, `fetch()`, module scripts); when both modes are used, write two preconnects. Use `dns-prefetch` alone, in its own tag, for less certain origins. Better still, serve critical files from the page's own origin.
- Why: A new origin costs DNS, TCP and TLS round trips, often 100–500 ms. CORS and no-CORS requests use separate connections, so a preconnect in the wrong mode is wasted. Chromium drops an unused preconnected socket after about 60 s, and each preconnect costs a TLS handshake that competes with critical requests.
- Detect: `rg -n 'rel="?(preconnect|dns-prefetch)' -g '*.{html,ejs,hbs,svelte,vue,tsx,jsx}'`: more than 2 preconnects, a font host without `crossorigin`, the page's own origin, or `rel="preconnect dns-prefetch"` in one tag.
- Verify: measure.md#load, cold. Pass: every preconnected origin gets a request during load in `list_network_requests`, and the LCP median wins or holds.
- Avoid: This replaces two old claims: that each `preconnect` needs a paired `dns-prefetch` as a fallback, and that a preconnect closes after 10 s. Do not preconnect to origins used only after an interaction. A `Link: <origin>; rel=preconnect` header on a stylesheet response also works.
- Source: https://web.dev/learn/performance/resource-hints ; https://web.dev/articles/preconnect-and-dns-prefetch

### HTML-12 Preload only late-discovered resources, with `as`, `crossorigin` and `imagesrcset` that match
stage: network, parse · metric: LCP, FCP, bytes · when: load · impact: medium — a missing or mismatched preload fetches late or twice · support: baseline · also: HTML-10, HTML-13, MEDIA-02
- Do: Preload only what the first view needs and the scanner cannot see: a font that only an external sheet names, a CSS-background LCP image, a JSON or `.wasm` file that startup code fetches. Always set `as`. Match the later request: `crossorigin` for fonts (same-origin too) and `as="fetch"`, the same URL, and for a responsive image `imagesrcset` and `imagesizes` copied from the element, with no `href`. Put `fetchpriority="high"` on an LCP image preload and on the `<img>`.
- Why: A preload is a mandatory fetch at the default priority of its `as`: Highest for style, Low or Medium for images. A different `as`, credentials mode or URL makes the browser fetch the file again. Many preloads compete with render-blocking CSS. Chromium ignores `rel=preload` in `Link` headers on subresource responses; put preload headers on the HTML response or in a 103.
- Example:
  ```html
  <link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/data/catalog.json" as="fetch" crossorigin>  <!-- startup code: fetch(url) -->
  <link rel="preload" as="image" fetchpriority="high"
        imagesrcset="/img/banner-800.avif 800w, /img/banner-1600.avif 1600w" imagesizes="100vw">
  ```
- Detect: `rg -n 'rel="?preload' -g '*.{html,ejs,hbs,svelte,vue,tsx,jsx}'`, then flag: no `as`; `as="font"` without `crossorigin`; an image `href` where the element has `srcset`; a URL that a plain tag in the same HTML already loads; more than about 4 preloads.
- Verify: measure.md#load. Pass: `list_console_messages` has no "preloaded but not used" warning, `list_network_requests` shows each preloaded URL once, and the LCP median wins or holds.
- Avoid: A responsive image preload in a `Link` header or a 103 is chosen before the viewport is known. Lighthouse dropped its "preload" audits because they over-recommended preloads: make the resource discoverable first (HTML-10). For a module, use `modulepreload` (HTML-13).
- Source: https://web.dev/articles/preload-critical-assets ; https://web.dev/articles/fetch-priority

### HTML-13 Flatten module graphs: bundle, `modulepreload` the static graph, one import map first
stage: network, script-load · metric: LCP, startup · when: load, build · impact: medium — each static import level costs one more round trip · support: baseline · also: HTML-12, HTML-17, EVT-14
- Do: Bundle production code into a few chunks. Where native modules ship, add `<link rel="modulepreload">` for every module in the entry's static graph, with a `crossorigin` value that matches the module load. Never use `rel="preload" as="script"` for a module. With an import map, write one inline `<script type="importmap">` before the first module script, `modulepreload` and `import()`; map stable names to hashed URLs, so a changed leaf does not rename its importers.
- Why: A module's static imports are found only after it downloads and parses, so a → b → c is three round trips. `modulepreload` fetches, parses and compiles a module into the module map; browsers do not have to fetch its dependencies, so list them. Chromium drops a classic-script preload of a module as a type mismatch. A later import map cannot remap specifiers that are already resolved.
- Example:
  ```html
  <script type="importmap">
    { "imports": { "ui-kit": "/static/ui-kit.51c2.js", "search": "/static/search.0b7e.js" } }
  </script>
  <link rel="modulepreload" href="/static/app.9d4f.js">
  <link rel="modulepreload" href="/static/ui-kit.51c2.js">  <!-- a static import of app.js -->
  <script type="module" src="/static/app.9d4f.js"></script>
  ```
- Detect: `rg -n 'rel="?preload"?[^>]*as="?script[^>]*\.m?js'` next to `type="module"`; an importmap after a module script or modulepreload; dozens of small script requests at startup in `list_network_requests`.
- Verify: measure.md#start, cold. Pass: `NetworkDependencyTree` is no longer listed or its longest chain is shorter, and LCP is not worse.
- Avoid: Do not `modulepreload` code that only an interaction needs; warm it on intent (EVT-14). Unbundled modules suit only small graphs (V8: under about 100 modules, depth under 5). Put a `modulepreload` for a dynamic import after the script that needs it. An import map applies only to the window: module workers resolve their imports without it, so give worker entry chunks and their imports plain hashed URLs.
- Source: https://web.dev/articles/modulepreload ; https://html.spec.whatwg.org/multipage/webappapis.html#import-maps

## §E Bundles and startup JS

### HTML-14 Load everything that is not in the first view with `import()`, started on intent
stage: script-load, tasks, network · metric: startup, INP, LCP · when: load, build · impact: high — every startup module is downloaded, compiled and run before input can be handled · support: baseline · also: HTML-15, EVT-14, TASK-06, SC-35
- Do: Import statically only what the first view needs. Put dialogs, settings, editors, rare tools, secondary panels and heavy libraries (charts, maps, PDF, rich text) behind `import()`. Start the import on intent (`pointerenter`, `focus`, idle time), so the click does not wait for it. Import named exports from narrow entry points, and prefer modular SDKs to whole-package imports.
- Why: A static import puts the module into the startup download, compile and run, on the main thread. `import()` moves that work to a later, separate task, and the module map loads each URL once. Code that never runs is still downloaded and pre-parsed.
- Example:
  ```js
  // Before: the editor is part of the startup bundle
  import { openEditor } from './report-editor.js';
  editButton.addEventListener('click', () => openEditor(report));
  // After: fetched on intent, compiled and run on first use
  const loadEditor = () => import('./report-editor.js');
  editButton.addEventListener('pointerenter', loadEditor, { once: true });
  editButton.addEventListener('focus', loadEditor, { once: true });
  editButton.addEventListener('click', async () => (await loadEditor()).openEditor(report));
  ```
- Detect: `rg -n "^import .* from ['\"][^'\"]*(dialog|modal|editor|settings|export|chart|map|pdf)" -g '*.{js,ts,jsx,tsx,svelte,vue}'` in entry and root-layout files; in the bundler report, a first-load chunk that holds a library used only after a click.
- Verify: measure.md#start, then measure.md#inp on the first use of the moved feature. Pass: `scriptTransferKB` and `evaluateMs` win at load, and first-use INP is not worse than the base.
- Avoid: The first use now pays network and compile inside the interaction, so warm it on intent. A large dynamic chunk that runs in a click is still one long task. Nested dynamic imports form a waterfall. `import defer` is not in stable Chromium yet (support.md `import-defer`).
- Source: https://web.dev/articles/script-evaluation-and-long-tasks ; https://v8.dev/blog/cost-of-javascript-2019

### HTML-15 Emit hashed chunks of about 100 KB; import module paths, not barrel files, at startup
stage: tasks, script-load, network · metric: INP, startup, bytes · when: build, load · impact: medium — one large script is one long evaluation task and one cache unit · support: baseline · also: HTML-14, HTML-17, TASK-06
- Do: Emit several medium chunks, about 100 KB per script as a starting target, with content-hashed file names. Keep libraries that rarely change in their own chunk, apart from app code. On startup routes, import from module paths, not from barrel files that re-export a whole folder. Read the bundler report after each dependency change, and set per-route byte budgets with warning and error levels against the base branch.
- Why: Each script is one evaluation task, so smaller scripts give the main thread gaps for input; Chromium also runs each deferred or module script in its own task (support.md `separate-defer-module-tasks`). With one bundle, any change downloads everything again and cold-starts its code cache. A barrel import can pull in modules that the bundler cannot prove free of side effects.
- Detect: `rg -n "export \* from" -g 'index.{js,ts}'` (barrels), then `rg -n "from ['\"](\.\.?/)+[\w-]+/?['\"]"` in startup files that import them; output names without a hash in the build folder; one chunk far over 100 KB in the bundler report.
- Verify: measure.md#start. Pass: `trace-summary.mjs` shows fewer tasks over 50 ms during load and a shorter longest task, and `scriptTransferKB` does not grow past the noise band.
- Avoid: Hundreds of tiny chunks compress worse and add requests on a cold cache. Splitting spreads startup cost; it does not remove it: ship less first (HTML-14). The 100 KB figure is a rule of thumb. Some bundlers renamed their splitting options (Vite on Rolldown uses `codeSplitting`, not the object form of `manualChunks`): check the current docs.
- Source: https://web.dev/articles/script-evaluation-and-long-tasks ; https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Performance_budgets

### HTML-16 Ship modern output: no `nomodule`, no polyfills for Baseline features, no ES5
stage: script-load, network · metric: startup, bytes · when: build · impact: medium — ES5 output is several times larger and slower than native syntax · support: baseline · also: V8-03, V8-11
- Do: Set the build target to the project's browser floor (the Chromium floor in support.md, or a Browserslist Baseline query), so classes, class fields, spread, destructuring, `async`/`await` and generators stay native. Remove `<script nomodule>` bundles, `regenerator-runtime`, and `core-js` polyfills for features the floor has. Check that dependencies do not ship pre-transpiled ES5. For TypeScript, target ES2022 or later.
- Why: In V8's examples, ES5 output was 2 to 6.5 times larger, and helper code runs slower than the native feature. Every supported browser runs modules, so a `nomodule` bundle is dead weight. Native `async`/`await` is faster than a transpiled state machine.
- Detect: `rg -n 'nomodule|regenerator-runtime|core-js|@babel/preset-env' -g '*.{html,json,js,cjs,mjs,ts}'`; `rg -n '"target"\s*:\s*"es(3|5|2015|2016|2017)"' -g 'tsconfig*.json'`; `LegacyJavaScript` or `DuplicatedJavaScript` in a `#load` trace.
- Verify: measure.md#start. Pass: `scriptTransferKB` and `evaluateMs` win, and a `#load` trace no longer lists `LegacyJavaScript`.
- Avoid: Features newer than the floor still need a guard or a transform. An ES2022 target changes TypeScript class-field semantics: initialize numeric fields (V8-03).
- Source: https://v8.dev/blog/high-performance-es2015 ; https://web.dev/blog/browserslist-supports-baseline

### HTML-17 Keep the code cache warm: stable external URLs, deterministic startup, one compile hint
stage: script-load · metric: startup, INP · when: load, build · impact: medium — a cache hit skips parse and compile of every function the last visit compiled · support: explicit-compile-hints · also: HTML-13, HTML-15, V8-10
- Do: Ship startup JS as external files of at least 1 KiB with content-hashed URLs; never add per-deploy or per-session query strings (`?v=`, `?t=`). Do not run code through `eval`, `new Function` or `blob:` URLs. Keep startup deterministic (no random choice between large code paths), and call init code at the top level of the module. Add `//# allFunctionsCalledOnLoad` as the first line of one small chunk whose functions all run at load. Ship static data over about 10 kB as JSON (`JSON.parse`, a JSON import).
- Why: Chrome compiles external scripts off the main thread while they download and caches code per URL: a load within 72 hours of the first one produces the cache, the next one uses it. Inline and `eval` code compiles on the main thread with no cache; `blob:` scripts and scripts under 1 KiB get no cache. The cache holds only functions compiled by the end of the top-level run, and a V8 version change in a Chrome update discards it. `JSON.parse` beats an equal object literal (1.7 times in V8's test).
- Example:
  ```js
  // Bundler output options: the hint on the one core chunk only
  output: { banner: (chunk) => (chunk.name === 'boot' ? '//# allFunctionsCalledOnLoad' : '') },
  // Build step: large static data as JSON.parse, which parses faster than a literal
  const literal = JSON.stringify(JSON.stringify(countryTable));
  await writeFile('src/data/countries.js', `export default JSON.parse(${literal});\n`);
  ```
- Detect: `rg -n '\?(v|t|ver|ts|cb)=' -g '*.{html,js,ts}'` on script URLs; `rg -n 'new Function\(|\beval\(' -g '*.{js,ts}'`; `rg -c 'allFunctionsCalledOnLoad'` in the build output (it must be exactly one chunk).
- Verify: measure.md#start with three warm loads per side. Pass: `compileMs` of the third load wins, and cold `evaluateMs` is not worse.
- Avoid: A hint on every chunk turns off lazy compile for the whole app and costs CPU and memory; minifiers can strip the comment, so check the file on disk. Chromium's automatic local compile hints skip module scripts, so for an all-module app the explicit hint is the only eager-compile help. Do not move heavy work to the top level only to fill the cache.
- Source: https://v8.dev/blog/code-caching-for-devs ; https://v8.dev/blog/explicit-compile-hints

### HTML-18 Load third parties late or behind facades; self-host the ones that the first view needs
stage: tasks, network · metric: INP, LCP · when: load, interaction · impact: high — third-party scripts run on your main thread, and their cost changes without notice · support: baseline · also: HTML-10, HTML-11, EVT-13, MEDIA-11
- Do: Load analytics, RUM, tag managers and A/B scripts with `async` or after `load`; fire marketing tags late, on narrow triggers. Replace chat widgets, maps and social embeds with a facade (an image and a button): preconnect on `pointerenter` or `focus`, and load the real widget on click. Self-host a third-party script that the first view needs (a consent notice), or pin a versioned vendor URL with `integrity`. Inline only the tiny part of RUM that must run early.
- Why: A facade means that users who never open the widget never pay for its code. A self-hosted copy reuses your connection and cache headers; a vendor chain (script, then CSS, then font) adds round trips. Observers with `buffered: true` still get most earlier entries, so a late RUM script loses little: only interactions under 104 ms and resource entries past the buffer of 250.
- Example:
  ```js
  const facade = document.querySelector('#chat-facade');  // a static image and a button
  facade.addEventListener('pointerenter', () => document.head.append(Object.assign(
    document.createElement('link'), { rel: 'preconnect', href: 'https://widget.example-chat.com' })), { once: true });
  facade.addEventListener('click', async () => {
    facade.setAttribute('aria-busy', 'true');
    const { mountChat } = await import('/vendor/chat-loader.js');  // self-hosted loader
    mountChat(facade);                                              // replaces the facade
  }, { once: true });
  ```
- Detect: `rg -n '<script[^>]+src="https?://' -g '*.{html,ejs,hbs,svelte,vue,tsx,jsx}'` without `async` or `defer`; third-party `<iframe>` or widget snippets in the first view; tag code that runs on every page for one page's need.
- Verify: measure.md#load, then measure.md#inp during load. Pass: `performance_analyze_insight` for `ThirdParties` shows less main-thread time, tasks over 50 ms during load are fewer, and the LCP median is not worse.
- Avoid: The first click on a facade waits for the real widget: show a loading state. A self-hosted copy goes stale, and some vendor terms forbid it. `integrity` breaks when a vendor edits a file in place, so pin a versioned URL. Video embeds: MEDIA-11.
- Source: https://web.dev/articles/embed-best-practices ; https://web.dev/articles/tag-best-practices

## §F Next navigation

### HTML-19 Speculate the next page with moderate eagerness; prerender only pages safe to run early
stage: network, parse · metric: LCP, TTFB · when: load, interaction · impact: medium — it helps only multi-page navigations, but there it removes most of the next load · support: speculation-rules · also: HTML-20, LIFE-07, DATA-18
- Do: Add `<script type="speculationrules">` with document rules (`where`) that exclude logout, cart, language switch and other state-changing URLs. Default to `prefetch` with `"eagerness": "moderate"`. Use `prerender` only for likely same-origin targets whose code can run early, and there start analytics, timers and sockets after activation (`document.prerendering`, `prerenderingchange`). Send `No-Vary-Search` for tracking parameters. Use `<link rel="prefetch">` only for cacheable same-site files of the next route.
- Why: A prefetch keeps the next document in a per-document memory cache; a prerender also loads and renders it in a hidden page, so activation shows it at once. From rules that are not `immediate`, Chrome keeps only 2 prefetches and 2 prerenders (first in, first out), and it skips speculation under Save-Data, energy saver, memory pressure, the "Preload pages" setting off, and in background tabs. `<link rel="prerender">` only does a no-state prefetch: replace it.
- Example:
  ```html
  <script type="speculationrules">
  { "prefetch": [{
      "where": { "and": [ { "href_matches": "/products/*" },
                          { "not": { "selector_matches": "[data-no-speculate]" } } ] },
      "eagerness": "moderate" }] }
  </script>
  ```
- Detect: `rg -n 'speculationrules|rel="?(prerender|prefetch)' -g '*.{html,ejs,hbs,svelte,vue,tsx,jsx}'`; code that records page views or opens sockets at the top level with no `document.prerendering` check.
- Verify: measure.md#load on the target page, reached by a hover and a `click` on the source page, with and without the rules. Pass: the target's `ttfbMs` and LCP medians win, and the server logs no speculative request (`Sec-Purpose: prefetch`) to an excluded URL.
- Avoid: Wrong guesses cost server and client work: roll out in steps and measure each. Speculation does nothing for SPA route changes (HTML-20). Inline rules need `'inline-speculation-rules'` in the CSP `script-src`. A prerendered page can show stale state: refresh it on activation. Do not build on `prerender_until_script` (an origin trial).
- Source: https://developer.chrome.com/docs/web-platform/prerender-pages ; https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API

### HTML-20 Make SPA route changes soft navigations: a user action, a URL change, then a paint
stage: tasks, network, paint · metric: LCP, INP, CLS · when: interaction · impact: medium — without it, every route of a long session is measured as one page · support: soft-navigations · also: HTML-14, HTML-19
- Do: Start each route change from a user action, update the URL with the History or Navigation API, and paint the new content in that flow. Fetch the next route's chunk and data on intent (hover, focus). Report per-route metrics with `web-vitals` and `reportSoftNavs: true` (measure.md §7), and feature-detect the entry type, because it is newer than some Chromium floors (support.md).
- Why: Chromium reports a soft navigation when a user action causes a visible URL change and a visible paint. It then resets LCP, INP and CLS, and emits `soft-navigation` and `interaction-contentful-paint` entries, so each route gets its own numbers. Without it, one LCP comes from the first load, and INP and CLS collect over the whole session.
- Example:
  ```js
  nav.addEventListener('click', async (e) => {
    const link = e.target.closest('a[data-route]'); if (!link) return;
    e.preventDefault();
    history.pushState({}, '', link.href);        // or navigation.navigate(link.href)
    await renderRoute(new URL(link.href));       // new content reaches the screen
  });
  const softNavs = PerformanceObserver.supportedEntryTypes.includes('soft-navigation');
  ```
- Detect: `rg -n 'pushState|replaceState|navigation\.navigate' -g '*.{js,ts,svelte,vue,tsx,jsx}'`, then check that a user event starts the change and that it paints; `rg -n 'reportSoftNavs'` in the RUM setup.
- Verify: measure.md#inp on a route link inside a manual trace. Pass: the summary lists an insight set `NAVIGATION_<n>` for the route change, and its INP and LCP are not worse than the base.
- Avoid: The heuristic gives false positives (a filter that changes the URL) and false negatives (a route change that paints nothing). A URL change without a user action is not counted. CrUX does not report soft navigations yet, so keep a whole-page view too. The entry buffer holds 50 soft navigations.
- Source: https://developer.chrome.com/docs/web-platform/soft-navigations ; https://github.com/GoogleChrome/web-vitals#report-metrics-for-soft-navigations

## §G HTTP headers the front end controls

- **HTML-21** Serve content-hashed static files with `Cache-Control: public, max-age=31536000` and never change the bytes behind a hashed URL; serve HTML with `no-cache` plus an `ETag` (a weak one is fine), so a repeat visit costs one 304. [network · bytes, TTFB · high] https://web.dev/articles/http-cache
- **HTML-22** Serve personalized HTML that is not sensitive with `Cache-Control: private, no-cache`, not `no-store`; keep `no-store` for pages with sensitive data, because it limits the back/forward cache (LIFE-07). [network · TTFB, LCP · medium] https://web.dev/articles/bfcache
- **HTML-23** Serve text (HTML, JS, CSS, SVG, JSON, Wasm) with Brotli or zstd per `Accept-Encoding` and `Vary: Accept-Encoding`: pre-compress static files at the highest level in the build (zstd window at most 8 MB), compress dynamic HTML at a middle level, and skip images, fonts and tiny bodies. [network · bytes, LCP · high] https://web.dev/articles/optimizing-content-efficiency-optimize-encoding-and-transfer
- **HTML-24** When the server needs time to build the HTML, send `103 Early Hints` over HTTP/2 or HTTP/3 with `preconnect` and `preload` for stable, cacheable critical CSS and fonts, and repeat them on the final response; never use HTTP/2 push. [network · FCP, LCP · medium] https://developer.chrome.com/docs/web-platform/early-hints
- **HTML-25** Send `Server-Timing` for backend phases and cache status on the document (no secrets in `desc`), read it in RUM from the navigation entry, and send `Timing-Allow-Origin` on cross-origin files whose timings you report. [network · TTFB · low] https://w3c.github.io/server-timing/
- **HTML-26** Link to final URLs (scheme, host, trailing slash) so no redirect comes before the document, use HSTS for the HTTP-to-HTTPS hop, and keep per-visit tracking parameters out of CDN cache keys. [network · TTFB, LCP · medium] https://developer.chrome.com/docs/performance/insights/document-latency

## §H One-line rules

- **HTML-27** For bundles that deploy often, send `Use-As-Dictionary` on hashed chunks and answer requests that offer a dictionary with a `dcb` or `dcz` delta and `Vary: accept-encoding, available-dictionary` (support.md `compression-dictionary-transport`). [network · bytes, startup · medium] https://developer.chrome.com/blog/shared-dictionary-compression
- **HTML-28** Put first-view server data in `<script type="application/json">`, escape every `<` in it as `\u003c`, read it once with `JSON.parse`, and do not send the same data again as HTML and as JSON for hydration. [script-load · startup, INP · medium] https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
- **HTML-29** Server-render web components with declarative shadow DOM (`<template shadowrootmode="open">`), and hydrate the existing root through `this.attachInternals().shadowRoot` before any `attachShadow()` call, which empties it. [parse · LCP, CLS · low] https://web.dev/articles/declarative-shadow-dom
