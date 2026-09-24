# HTML media and fonts: images, the LCP element, fonts, video and reserved space (MEDIA-)

Open this when you write an `<img>`, `<picture>`, `srcset` or `sizes`, an SVG icon, a CSS background image, `@font-face` or a font `<link>`, a `<video>`, `<audio>` or `<iframe>` embed, the largest element of the first view, or UI that appears after load (banners, toasts, result panels, promo slots).
Stage cards: `pipeline.md` §H (`network`, `parse`, `cssom`, `layout`, `paint`). LCP subparts and candidates, and how CLS counts shifts: `pipeline.md` §G.

## Checklist

| ID | Do this | Impact | First stage |
|---|---|---|---|
| **§A LCP element** | | | |
| MEDIA-01 | The LCP image is an `<img>` in the server HTML, not a background, `data-src` or a JS insert | high | parse |
| MEDIA-02 | `fetchpriority="high"` on the LCP image, never `loading="lazy"`; `low` on hidden first-view images | high | network |
| **§B Images** | | | |
| MEDIA-03 | Display size × DPR (cap near 2x) through `srcset` and `sizes`, in AVIF or WebP; SVG or CSS instead | high | network |
| MEDIA-04 | A box before load: `width`/`height` on images and video, `aspect-ratio` on embeds and chart hosts | high | layout |
| MEDIA-05 | Native `loading="lazy"` below the fold only; `sizes="auto, <list>"`; no `data-src` loaders | medium | network |
| MEDIA-06 | `await img.decode()` before script inserts or swaps an image | medium | paint |
| **§C Fonts** | | | |
| MEDIA-07 | `@font-face` inline in the head; preload at most two WOFF2 files, with `crossorigin` | medium | cssom |
| MEDIA-08 | `font-display` by role: `optional` for body text, `swap` only with a matched fallback | high | cssom |
| MEDIA-09 | One fallback face per local font, with generated `size-adjust` and metric overrides | medium | layout |
| MEDIA-10 | Fewer, smaller font files: WOFF2, `unicode-range` subsets, system fonts, SVG icons | medium | network |
| **§D Video and embeds** | | | |
| MEDIA-11 | Poster plus `preload="none"`; video instead of GIF; a facade for video players | medium | network |
| **§E Reserved space** | | | |
| MEDIA-12 | Late content in pre-sized slots or overlays, never above what the user reads; `scrollbar-gutter` | high | layout |
| **§F One-line rules** | | | |
| MEDIA-13 | A CSS background LCP image: `image-set()` plus a matching preload | medium | parse |
| MEDIA-14 | No fade-in, page hiding or blurry placeholder on the LCP element | medium | paint |
| MEDIA-15 | Images and fonts from the page's own origin, or a preconnect to the CDN | medium | network |
| MEDIA-16 | Carousels: first slide in the HTML, all slides the same intrinsic size | medium | parse |
| MEDIA-17 | Optimize and compress SVG; an external sprite for large icon sets | low | network |
| MEDIA-18 | `Timing-Allow-Origin` on cross-origin images and fonts | low | network |

- → HTML-12 preload a late-discovered image or font: matching `as`, `crossorigin`, `imagesrcset`; → HTML-03 server-render the first view
- → CNV-15, CNV-19 canvas text waits for its font; `createImageBitmap()` for images drawn on a canvas
- → CSS-01, CSS-09, CSS-24 move elements with `transform`; `contain-intrinsic-size` on `content-visibility` regions; keep scroll anchoring on
- → DOM-12, DOM-13 tabular numbers in live cells; infinite lists append into pre-sized slots
- → DATA-13 `priority` on background `fetch()` calls

## §A LCP element

### MEDIA-01 Put the LCP image in server HTML as an `<img>`: no CSS background, `data-src` or JS insert
stage: parse, network · metric: LCP · when: load · impact: high — the preload scanner starts only the `src` and `srcset` URLs that it reads in the HTML, so any other form starts the LCP request late · support: baseline · also: MEDIA-02, MEDIA-13, HTML-03, HTML-12
- Do: Write the likely LCP image of each page type (a hero, the first image of a product grid, the first card thumbnail) as `<img src srcset sizes width height alt>` in the HTML that the server sends, or in the app shell of a client-rendered app. If it must stay a CSS background, use MEDIA-13. If script must create it, preload it with `fetchpriority="high"` (HTML-12).
- Why: The preload scanner reads the raw markup ahead of the parser and starts `src` and `srcset` fetches at once. It does not read `data-*` attributes, run scripts or match CSS, and it skips `url()` in inline `style` attributes, so those images wait for CSS, script or layout. On pages with poor LCP, the LCP image request starts 1,290 ms late at p75 (web.dev, top-cwv).
- Detect: `rg -n 'data-(src|srcset)=|style=.[^>]*background(-image)?:\s*url\(' -g '*.{html,svelte,vue,jsx,tsx,astro}'` in first-view templates; `background(-image)?:\s*url\(` on hero or banner selectors in CSS; `new Image\(|createElement\(.img.\)` in startup code that builds a first-view image.
- Verify: measure.md#load (cold, 5 runs each side). Pass: the `LCPDiscovery` insight passes, resource load delay is under 10% of LCP, and compare-runs gives the LCP median "win".
- Example:
  ```html
  <!-- Before: the scanner cannot see a URL in an inline style -->
  <div class="hero" style="background-image: url(/img/hero-1600.avif)"></div>
  <!-- After: found at once, sized, first in the queue -->
  <img class="hero" src="/img/hero-1600.avif" width="1600" height="600" alt="…" fetchpriority="high"
       srcset="/img/hero-800.avif 800w, /img/hero-1600.avif 1600w" sizes="100vw">
  ```
- Avoid: A preload is a second copy of the candidate list: when it does not match what the `<img>` or the CSS picks, the browser downloads two files. Never send a responsive image preload in a `Link` header or 103 Early Hints: the viewport is not known yet. Earlier discovery does not help while render-blocking CSS or script holds the paint: the saved time only moves to element render delay. A `<canvas>` or an inline `<svg>` is never an LCP candidate, so a chart needs its own first-frame mark (measure.md#load). This replaces JS lazy-loaders and client-built heroes.
- Source: https://web.dev/articles/preload-scanner ; https://web.dev/articles/top-cwv

### MEDIA-02 Mark the LCP image `fetchpriority="high"`, never lazy; mark hidden first-view images `low`
stage: network · metric: LCP · when: load · impact: high — Chromium starts most images at Low and raises visible ones only after layout, and a lazy image waits for layout, so the LCP request starts late · support: fetch-priority · also: MEDIA-01, MEDIA-05, MEDIA-16, DATA-13
- Do: Put `fetchpriority="high"` on the one image that is most likely the LCP element (two at most), and on its preload too when it has one. Leave `loading` off every image that can be in the first viewport at a common window size. Put `fetchpriority="low"` on first-view images that are not visible at start (slide 2 and later, inactive tabs). When the server cannot know the viewport (a product grid, a feed), keep the first one to three content images eager and lazy-load the rest.
- Why: Chromium starts the first five images larger than 10,000 px² at Medium and all others at Low, and raises in-viewport images to High only after layout. `high` starts the request at High as soon as the preload scanner finds it. A lazy image waits for layout, and layout waits for all render-blocking CSS, so `fetchpriority="high"` cannot rescue a lazy LCP image.
- Detect: `rg -n 'loading=.lazy' -g '*.{html,svelte,vue,jsx,tsx,astro}'` in headers, heroes and the first items of lists; more than two `fetchpriority=.high` per page; a likely LCP `<img>` with no `fetchpriority`. In a dev build, warn from a `largest-contentful-paint` observer when `entry.element?.getAttribute('loading') === 'lazy'`.
- Verify: measure.md#load (cold). Pass: the `LCPDiscovery` insight passes all three checks (`fetchpriority=high` on the image and on its preload, discoverable in the HTML, not lazy), and compare-runs gives the LCP median "win" or "neutral" with a lower resource load delay.
- Avoid: `high` on many images cancels the effect, and it does not fix late discovery (MEDIA-01). `loading="eager"` does not raise priority. An explicit `fetchpriority` also turns off the Medium start for that image. The hint changes the browser's queue, but a CDN may ignore HTTP/2 and HTTP/3 priorities: check the result, not the markup. Slides near the viewport load even with `loading="lazy"`, so `low` is the tool for them. This replaces "lazy-load every image".
- Source: https://web.dev/articles/fetch-priority ; https://developer.chrome.com/docs/performance/insights/lcp-discovery

## §B Images

### MEDIA-03 Serve images at display size × DPR (cap near 2x) with `srcset` and `sizes`, in AVIF or WebP
stage: network, paint, memory · metric: LCP, bytes, memory · when: load, build · impact: high — the browser downloads and decodes the whole file even when it paints it smaller, and decoded memory grows with the pixel area · support: avif · also: MEDIA-04, MEDIA-05, CNV-05
- Do: For fluid images, list `w` candidates and write `sizes` that match the real CSS slot width at each breakpoint. For fixed-size images (logos, avatars, thumbnails), use `1x, 2x` candidates. Cap candidates near 2x the display size. Encode photos and screenshots as AVIF, or as lossy WebP when AVIF encoding is too slow; a `<picture>` type fallback is needed only when your Edge floor is older than AVIF support (support.md row `avif`). Use SVG for icons, logos and line art, CSS for gradients and shadows, and live text instead of text in images. An image CDN can do all of this from one URL (width, format and quality in the path).
- Why: The browser multiplies the `sizes` slot width by the DPR and picks the smallest candidate that covers it, before layout. Without `sizes`, `w` candidates assume `100vw`, so a 400 px card downloads a full-width file. A decoded image takes width × height × 4 bytes, so a 3x file holds 9 times the pixels of a 1x file (web.dev).
- Detect: `rg -n 'srcset=' -g '*.{html,svelte,vue,jsx,tsx,astro}'`, then check each tag for `sizes`; `rg -n 'src=.[^ >]*\.(png|jpe?g|gif)\b'` for photos and animations; `sizes=.100vw` on images in narrow slots. In a load trace, the `ImageDelivery` insight names oversized and legacy-format images.
- Verify: measure.md#load. Pass: `ImageDelivery` has no finding for the changed images, `paint().byType.img.transferKB` goes down, and the LCP median is not worse.
- Example:
  ```html
  <!-- Before: one 2400 px JPEG for a 400 px product card -->  <img src="/img/p-2400.jpg" alt="…">
  <!-- After -->
  <img src="/img/p-800.avif" width="400" height="300" alt="…" sizes="(min-width: 1024px) 400px, 50vw"
       srcset="/img/p-400.avif 400w, /img/p-800.avif 800w, /img/p-1200.avif 1200w">
  ```
- Avoid: `srcset` is a hint: the browser can take a cached larger file, or a smaller one under Save-Data. Do not mix `x` and `w` candidates in one `srcset`, and keep one aspect ratio across candidates. Use `<source media>` only for art direction or a hard size cap, and keep variants few: every size and format is a separate cache entry. When one URL returns several formats by `Accept`, send `Vary: Accept` and normalize the CDN cache key to AVIF, WebP or other. An SVG with thousands of paths can cost more to paint than a raster image.
- Source: https://web.dev/learn/performance/image-performance ; https://web.dev/articles/choose-the-right-image-format

### MEDIA-04 Size every image, video, embed and chart host before load: `width`/`height` or `aspect-ratio`
stage: layout · metric: CLS · when: load · impact: high — an unsized box starts at 0 px high and grows when its file arrives, which moves all content below it · support: baseline · also: MEDIA-05, MEDIA-12
- Do: Put the intrinsic `width` and `height` (unitless pixels) on every `<img>` and `<video>`, also on the ones that script creates, and let CSS scale them (`max-inline-size: 100%; block-size: auto`). In an art-directed `<picture>`, put `width` and `height` on each `<source>` whose ratio differs. Give iframes, embeds and chart or canvas hosts a CSS `aspect-ratio` or a fixed block size before their script runs. When CSS forces a ratio that differs from the file, add `object-fit: cover` (`contain` for logos and charts).
- Why: The browser maps the attributes to `aspect-ratio: auto W / H` before the image loads, so the box gets its final height as soon as its width is known. web.dev found at least one unsized image on 66% of pages.
- Detect: `rg -n '<(img|video|iframe)\b' -g '*.{html,svelte,vue,jsx,tsx,astro}'`, then check each tag for `width` and `height` or a class with `aspect-ratio`; `createElement\(.(img|video|iframe).\)` with no size set; `height:\s*auto` in rules that target iframes. The `CLSCulprits` insight names unsized images.
- Verify: measure.md#cls (load CLS), plus `CLSCulprits` on a reload trace. Pass: `CLSCulprits` names no unsized image or iframe, `shift.read()` lists no image, embed or content below one among the worst shifts, and load CLS is a "win".
- Avoid: On an `<iframe>`, `width` and `height` set a fixed size and no ratio, so `height: auto` collapses it to 150 px: use `aspect-ratio`. An image with `sizes="auto"` and no size renders at 300 × 150. A wrong ratio still shifts a little, and over-reserving leaves a gap that shifts when it closes. This replaces "`width: 100%` with no height".
- Source: https://web.dev/articles/optimize-cls ; https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img

### MEDIA-05 Lazy-load below-the-fold images and iframes natively; `sizes="auto"` plus a fallback list
stage: network · metric: LCP, bytes · when: load · impact: medium — off-screen images and iframes compete with the LCP image for bandwidth, and each iframe loads a document with its own scripts · support: sizes-auto · also: MEDIA-02, MEDIA-04, MEDIA-11
- Do: Put `loading="lazy"` on `<img>` and `<iframe>` elements that start outside the first viewport at every common window size, always with a size (MEDIA-04); in a `<picture>`, put it on the inner `<img>`. Keep the real URL in `src` and `srcset`, and remove `data-src` swaps and lazy-loading libraries. On lazy images with `w` candidates, write `sizes="auto, <your sizes list>"`: Chromium picks by the laid-out width, and a Chromium below the `sizes-auto` row in support.md uses the list.
- Why: The browser fetches a lazy element when it comes within a fixed distance of the viewport; in Chromium, 1,250 px for images on a fast connection and 2,500 px on a slow one. A `data-src` URL is invisible to the preload scanner and waits for the loader script.
- Detect: `rg -n -i 'data-(src|srcset)=|lazysizes|lozad|lazyload' -g '*.{html,svelte,vue,jsx,tsx,astro,ts,js}'`; `<img` and `<iframe` in list, grid and footer templates with no `loading=`; `sizes=.auto` on an image without `loading=.lazy`, or with no list after `auto`.
- Verify: measure.md#load. Pass: `paint().byType.img` shows fewer requests and less `transferKB` at load, the LCP median is not worse, and `LCPDiscovery` still passes.
- Example:
  ```html
  <img loading="lazy" width="400" height="300" alt="…" src="/img/p-800.avif"
       srcset="/img/p-400.avif 400w, /img/p-800.avif 800w, /img/p-1200.avif 1200w"
       sizes="auto, (min-width: 1024px) 400px, 50vw">
  <iframe loading="lazy" src="/embed/store-map" width="560" height="315" title="Store map"></iframe>
  ```
- Avoid: The gain is bandwidth, not lab LCP. `sizes="auto"` is valid only with `loading="lazy"`. Lazy loading defers only while JavaScript is on; `display: none` images do not load, and `opacity: 0` images do. Horizontal scrollers use the same distances, so carousel slides load early: use `fetchpriority="low"` for them. CSS backgrounds cannot use the attribute, and `loading` takes only `lazy` or `eager`. This replaces JS lazy-loaders and "lazy-load everything".
- Source: https://web.dev/articles/browser-level-image-lazy-loading ; https://html.spec.whatwg.org/multipage/images.html#sizes-attributes

### MEDIA-06 Await `img.decode()` before you insert or swap an image from script
stage: paint, tasks · metric: frame, INP · when: interaction · impact: medium — a large decode lands in the frame that first shows the image, or that frame paints an empty box · support: baseline · also: CNV-19
- Do: For images that script creates or swaps (the full image after a thumbnail, the next gallery item, product cards after a filter, avatars in a live list), set `src`, `await img.decode()`, then insert or swap in one step. Start the decode early (on hover, or when the next item is known). Use `decoding="async"` only on large images that are not the LCP element and not part of a coordinated swap. For a canvas or WebGL, decode with `createImageBitmap()` (CNV-19).
- Why: Image decode is the most expensive part of raster, and each decode is its own task. `decode()` resolves when the image is decoded and safe to append, so the frame that shows it neither waits for the decode nor paints an empty box first.
- Detect: `rg -n -A5 'new Image\(|createElement\(.img.\)' -g '*.{ts,tsx,js,jsx,svelte,vue}'` where the image is appended, or a visible image's `src` is swapped, with no `decode()`; `decoding=.async` on the LCP image.
- Verify: measure.md#fps with the swap as the scenario (for example 10 gallery steps). Pass: `frameP99Ms` and `maxGapMs` are a "win" or "neutral", and a screenshot during a swap shows no empty box.
- Example:
  ```ts
  async function showFull(thumb: HTMLImageElement, url: string): Promise<void> {
    const img = Object.assign(new Image(), { src: url, alt: thumb.alt, width: thumb.width, height: thumb.height });
    await img.decode().catch(() => {}); // EncodingError: insert anyway; the image then loads the normal way
    thumb.replaceWith(img);
  }
  ```
- Avoid: `decode()` rejects with `EncodingError` after a network error, a corrupt file or a `src` change, so catch it. It does not keep the pixels decoded for later canvas draws: the browser can drop them under memory pressure. `decoding="async"` on the LCP image or on a script-inserted image can show the background for a frame, and on static `<img>` tags the attribute rarely has a visible effect, so do not treat it as the fix.
- Source: https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode ; https://html.spec.whatwg.org/multipage/embedded-content.html#dom-img-decode

## §C Fonts

### MEDIA-07 Inline `@font-face` in the head; preload at most two WOFF2 files, with `crossorigin`
stage: cssom, network · metric: FCP, LCP, CLS · when: load · impact: medium — a font request starts only after the CSSOM shows that rendered text uses it, so a font declared in an external stylesheet starts late · support: baseline · also: MEDIA-08, MEDIA-10, CNV-15, HTML-12
- Do: Put the `@font-face` rules and the base `font-family` rules in an inline `<style>` in the head. Self-host fonts on the page's origin with long-lived caching. If a font service stays, load its CSS with a `<link>` (never CSS `@import`) and preconnect to both origins, with `crossorigin` on the one that serves the files. Preload only the one or two files that first-view text uses, `<link rel="preload" as="font" type="font/woff2" href="…" crossorigin>`, after the critical CSS. Text drawn on a canvas: CNV-15.
- Why: The browser requests a face only when it knows both the `@font-face` rule and a rendered element that uses the family, and only after all render-blocking CSS has loaded. Fonts are fetched in CORS mode, so a preload without `crossorigin` does not match the font request, and the file downloads twice.
- Detect: `rg -n '@import\s+url\(.?https?://' -g '*.{css,scss}'`; `rg -n 'as=.font'` tags with no `crossorigin`, or more than two per page; `rg -n 'url\(.?data:(font|application/(x-)?font)'`; `@font-face` rules that exist only in an external stylesheet.
- Verify: measure.md#load (cold). Pass: `list_network_requests {pageId, resourceTypes: ["font"]}` shows each font file once, `list_console_messages` has no unused-preload warning, and the FCP and LCP medians are a "win" or "neutral".
- Avoid: Never inline font files as base64: they bloat the HTML and delay everything that the scanner finds after them. A preload is mandatory: it takes bandwidth from CSS and the LCP image, ignores `unicode-range`, and fetches the file even when the page does not use it, so each extra font preload delays what the first view needs. A shared font CDN gives no cross-site cache hit, because HTTP caches are partitioned per site. This replaces "preload every font".
- Source: https://web.dev/articles/font-best-practices ; https://web.dev/learn/performance/optimize-web-fonts

### MEDIA-08 Choose `font-display` by role: `optional` for body text, `swap` only with a matched fallback
stage: cssom, layout, paint · metric: CLS, LCP, FCP · when: load · impact: high — the default hides text for up to about 3 s, and a late font swap lays out every line of that text again · support: baseline · also: MEDIA-07, MEDIA-09
- Do: Set `font-display` on every `@font-face`, and `display=` on font-service URLs. For body and UI text, use `optional` and preload that font (MEDIA-07), so that it is usually ready for the first render. For brand or heading text that must show the web font, use `swap` (or `fallback`) together with a metric-matched fallback face (MEDIA-09). Keep `block` off text faces, and replace icon fonts with SVG (MEDIA-10).
- Why: The value sets a block period (invisible text) and a swap period: the default `auto` acts like `block` in Chromium, about 3 s and then a swap at any time; `swap` almost 0 ms, then a swap at any time; `fallback` about 100 ms, then about 3 s; `optional` about 100 ms and no swap. Chromium holds the first render for up to about 100 ms for a preloaded `optional` font, so the view shows either the web font or the fallback, with no invisible text and no swap shift.
- Detect: `rg -n -A8 '@font-face' -g '*.{css,scss,html,svelte,vue}'`, then check each block for `font-display`; `font-display:\s*(block|auto)`; font-service URLs with no `display=` parameter.
- Verify: measure.md#load and measure.md#cls, cold cache. Pass: the `FontDisplay` insight is not listed, no worst shift in `shift.read()` is a text block at the moment the font arrives, and the FCP median is not worse.
- Avoid: With `optional`, a first visit on a slow network keeps the fallback for that page view: that is the trade. `fallback` and `optional` still block for about 100 ms, so text LCP can wait that long; only `swap` paints at once. `block` shifts layout too, because invisible text is laid out with the fallback font. Lab runs often have fonts in the cache, so measure cold. This replaces "`swap` everywhere", which trades invisible text for layout shifts.
- Source: https://web.dev/articles/font-best-practices ; https://web.dev/articles/preload-optional-fonts

### MEDIA-09 Add a metric-matched fallback face per local font: generated `size-adjust` and overrides
stage: layout · metric: CLS · when: load, build · impact: medium — a matched fallback takes almost the same box as the web font, so the swap moves almost nothing · support: font-metric-overrides · also: MEDIA-08
- Do: For each web font shown with `swap` or `fallback`, declare one fallback `@font-face` per local font (for example one over `local("Arial")` for desktop and one over `local("Roboto")` for Android), each with `size-adjust`, `ascent-override`, `descent-override` and `line-gap-override`. Generate the values from the real font files with a tool (Capsize, Fontaine or a framework font utility). List the faces after the web font, and end the list with the generic family.
- Why: The swap shift is the difference in glyph widths and line metrics between the two fonts. `size-adjust` scales the fallback glyphs (the ratio of the average character widths), and the overrides set ascent, descent and line gap (each metric ÷ (units per em × `size-adjust`)), so both fonts fill the same box. A `line-height` change does not remove the cause.
- Detect: `rg -l 'font-display:\s*(swap|fallback)' -g '*.{css,scss,html,svelte,vue}'`, then check those files for `size-adjust`; `font-family:` lists that end in a named font with no generic family.
- Verify: measure.md#cls on a cold load. Pass: no shift in `shift.read()` has a text block as its source when the web font arrives, and load CLS is a "win".
- Example:
  ```css
  /* Placeholder values: generate them for your font pair. Add a second face over local("Roboto"). */
  @font-face { font-family: "Body Fallback"; src: local("Arial"); size-adjust: 104%;
    ascent-override: 92%; descent-override: 24%; line-gap-override: 0%; }
  body { font-family: "Body", "Body Fallback", sans-serif; }
  ```
- Avoid: One face with two `local()` sources gets one set of values that fits only one of the fonts. About 10% of Google Fonts have different metric tables on macOS and Windows and need values per OS. Values copied from an article fit another font pair, not yours. A list that ends in the default serif font shifts more than one that ends in a matching generic family.
- Source: https://developer.chrome.com/blog/font-fallbacks ; https://web.dev/articles/css-size-adjust

### MEDIA-10 Ship fewer, smaller font files: WOFF2 only, `unicode-range` subsets, system fonts, SVG icons
stage: network · metric: FCP, LCP, bytes · when: build · impact: medium — each face is a request on the critical path, and a full font carries glyphs that the page never shows · support: baseline · also: MEDIA-07, DOM-12
- Do: Give each face one `format("woff2")` source. Subset fonts per script (Latin, Latin-ext, Cyrillic) with glyphhanger, subfont or fonttools, and declare each subset with its `unicode-range`; keep every character that the UI shows (digits, the minus sign U+2212, currency signs, arrows). Use `system-ui` for UI text where the brand allows it, and one variable font instead of several static weights only when you use several weights. Replace icon fonts with SVG (an external `<use>` sprite or `<img>`).
- Why: The browser downloads a face only when the page has a character in its range and an element uses it. WOFF2 is about 30% smaller than WOFF (web.dev). System fonts need no request, and icon-font fallbacks draw wrong glyphs and shift layout with every `font-display` value.
- Detect: `rg -n 'format\(.(woff|truetype|opentype|embedded-opentype).\)|\.(ttf|otf|eot)\b' -g '*.{css,scss}'`; large families whose `@font-face` blocks have no `unicode-range`; `rg -n -i 'font-family:[^;]*(icon|awesome|material)'`.
- Verify: measure.md#load (cold). Pass: `list_network_requests {pageId, resourceTypes: ["font"]}` lists fewer font files, and the FCP and LCP medians are a "win" or "neutral".
- Avoid: A variable font is larger than any one static style, so it pays off only with several weights. `system-ui` differs per OS, so check number widths in tables (DOM-12). A preload bypasses `unicode-range` (MEDIA-07). User text in other scripts falls back to system fonts. Check the font license before you subset or self-host.
- Source: https://web.dev/articles/font-best-practices ; https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@font-face/unicode-range

## §D Video and embeds

### MEDIA-11 Load video on demand: poster, `preload="none"`, video for GIFs, a facade for players
stage: network, tasks · metric: LCP, bytes, INP · when: load · impact: medium — the browser can fetch video bytes at parse time, and a third-party player loads a whole document with its own scripts · support: loading-lazy-media · also: MEDIA-02, MEDIA-04, MEDIA-05, HTML-18
- Do: Give click-to-play video `preload="none"`, a small `poster` and a size, and raise `preload` to `metadata` on hover or focus. Replace animated GIFs with `<video autoplay muted loop playsinline>` (WebM or MP4, with the audio track removed). For a video that is the LCP element, preload its poster with `fetchpriority="high"` (a `poster` has no priority of its own) and never lazy-load it. On off-screen video, add `loading="lazy"` when your Chromium floor supports it. Put a facade (the poster and a play button at the player's final size) in front of a third-party video player: create the iframe on click, and preconnect on hover or focus. Chat widgets, maps and other third-party scripts: HTML-18.
- Why: Chromium desktop already defaults to `preload="metadata"`, fetched with range requests that can pull a large part of the file, so only `preload="none"` saves bytes there. For `<video>`, LCP takes the earlier of the poster load and the first painted frame. On the median site, one large video platform's embed blocked the main thread for more than 1.7 s (web.dev, HTTP Archive).
- Detect: `rg -n '<video\b' -g '*.{html,svelte,vue,jsx,tsx,astro}'`, then check for `preload=` and `poster=`; `rg -n '\.gif\b'` in image sources; `rg -n -i '<iframe[^>]*(youtube|vimeo|player|video)'` in templates that render at load; `autoplay` with no `muted`.
- Verify: measure.md#load, then measure.md#start for embeds. Pass: `list_network_requests {pageId, resourceTypes: ["media"]}` shows no request at load for click-to-play video, the player's script requests are gone before the first click, and the LCP median is not worse.
- Example:
  ```html
  <video controls preload="none" poster="/media/tour-poster.avif" width="1280" height="720">
    <source src="/media/tour.webm" type="video/webm"><source src="/media/tour.mp4" type="video/mp4">
  </video>
  <video autoplay muted loop playsinline width="480" height="270" src="/media/how-to.webm"></video>
  ```
- Avoid: In the Chromium builds with partial support (support.md row `loading-lazy-media`), `loading` ignores `<source>` children, so put the URL in `src` when you rely on it; below the floor, `preload="none"` is the saving, and off-screen autoplay video can start from an IntersectionObserver. A facade's first click waits for the player: show a loading state. Honor reduced motion: show the poster and do not autoplay. Never lazy-load or hide behind a facade a video that is the LCP element.
- Source: https://web.dev/articles/lazy-loading-video ; https://web.dev/articles/embed-best-practices

## §E Reserved space

### MEDIA-12 Put late content in pre-sized slots or overlays, never above what the user is reading
stage: layout · metric: CLS · when: load, interaction, session · impact: high — every insert that moves visible content adds to CLS for the whole page life, and shifts during a scroll or a drag always count · support: scrollbar-gutter · also: MEDIA-04, CSS-01, CSS-24, DOM-13
- Do: Reserve the final size of late UI (banners, promo slots, embeds, widgets, result panels) from the first render with `min-height` or `aspect-ratio` per breakpoint, and keep the space when nothing arrives. Show toasts, notices and consent bars as overlays (`position: fixed` or the top layer), and slide them in with `transform`. Append new items below the visible ones or into slots of the final size; for newest-first lists, show a "new items" control instead of pushing rows down. When a click starts work that takes over 500 ms, insert a placeholder of the final size in the same frame. Set `scrollbar-gutter: stable` on containers that can start to overflow after load.
- Why: A shift is a visible element whose start position changes between two frames, and CLS is the worst window of shifts (gaps under 1 s, at most 5 s long). Only shifts within 500 ms after a tap, click or key press are excused: scroll, drag and pinch are not such input, and a result that arrives 2 s after the click is not excused either. A classic scrollbar that appears takes inline space and reflows the content.
- Detect: `rg -n '\.prepend\(|insertBefore\(|insertAdjacentHTML\(\s*.afterbegin' -g '*.{ts,tsx,js,jsx,svelte,vue}'` in feed, list and banner code; `position:\s*sticky` on bars that appear after load; containers that `fetch` fills with no `min-height` or `aspect-ratio`; `overflow(-y)?:\s*(auto|scroll)` on containers that grow later, with no `scrollbar-gutter`.
- Verify: measure.md#cls: load CLS, then `shift.start()` → the action → a wait past the delayed work → `shift.read()`. Pass: load CLS is a "win", and the shift without input stays under 0.02 per interaction.
- Example:
  ```css
  .promo-slot { min-height: 250px; }                               /* the smallest likely size */
  @media (max-width: 599px) { .promo-slot { min-height: 100px; } }
  .toast { position: fixed; inset: auto 1rem 1rem auto; translate: 0 150%; transition: translate .2s; }
  .toast[data-open] { translate: none; }  .search-results { overflow-y: auto; scrollbar-gutter: stable; }
  ```
- Avoid: Removing reserved space shifts content as much as inserting it: collapse it only off-screen. Over-reserving leaves a gap. `scrollbar-gutter` does nothing with overlay scrollbars. A fixed overlay can cover the last rows, so add bottom padding. Keep scroll anchoring on (CSS-24) instead of `scrollTop` corrections, and give `content-visibility` regions a `contain-intrinsic-size` (CSS-09). This replaces "insert the banner at the top and push the page down".
- Source: https://web.dev/articles/optimize-cls ; https://web.dev/articles/cls

## One-line rules

- **MEDIA-13** When the LCP image must stay a CSS background, pick it with `image-set()` and `type()`, and preload the same candidates with `imagesrcset`, `type` and `fetchpriority="high"`; a preload that does not match the `image-set()` choice downloads a second image. [parse · LCP · medium] https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/image/image-set
- **MEDIA-14** Do not fake an early LCP: no fade-in from `opacity: 0`, no script that hides the page until a test or a render finishes, no large low-detail placeholder; Chromium ignores those paints, so the real paint stays the LCP and the hiding only adds render delay. [paint · LCP · medium] https://web.dev/articles/lcp
- **MEDIA-15** Serve images and fonts from the page's own origin (proxy the image CDN through it), or preconnect to the CDN origin (HTML-11); a new origin adds DNS, TCP and TLS before the LCP request can start. [network · LCP · medium] https://web.dev/articles/optimize-lcp
- **MEDIA-16** In carousels, write the first slide as an `<img>` in the HTML, give every auto-advancing slide the same intrinsic size, and do not autoplay: a later, larger slide can become the LCP, and every autoplay step with a layout change is a shift without input. [parse, paint · LCP, CLS · medium] https://web.dev/articles/carousel-best-practices
- **MEDIA-17** Optimize SVG like text (svgo, then Brotli or gzip); inline only small icons, and use an external `<use>` sprite for large icon sets, because inline SVG adds to every HTML response and the HTTP cache cannot keep it. [network · bytes · low] https://web.dev/learn/performance/image-performance
- **MEDIA-18** Send `Timing-Allow-Origin` on cross-origin image and font responses (an image CDN), so field data gets exact LCP render times and resource sizes; without it, render times are coarsened and sizes read 0. [network · LCP · low] https://web.dev/articles/lcp
