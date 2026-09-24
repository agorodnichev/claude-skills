# Gap fill round 2: stale facts, missing levers, cross-engine agents and MCP checks

Scope: the 13 gaps that the second completeness critic found in the notes files 01-18. Part A resolves the stale facts in files that had no verify pass and adds a sweep of more stale facts. Part B adds the missing platform levers. Part C covers SciChart multi-pane synchronization. Part D covers Safari and Firefox agent tools. Part E turns the open survey rules into items. Part F closes the open Chrome DevTools MCP questions with live runs.
Sources: BCD 8.1.2 (build 2026-09-17) and web-features in `raw/`, the live W3C/WHATWG/CSSWG drafts (Device Memory, CSS Anchor Positioning, CSS Highlight API, CSS Pseudo 4, DOM), the Chromium and Blink sources (`main`), chromestatus API, blink-dev, WebKit and Mozilla posts and repos, MDN, developer.chrome.com, react.dev, the chrome-devtools-mcp source (main 08b5e59, npm 1.10.1), devtools-frontend `main`, and the scichart 5.2.69 package on jsDelivr. Checked 2026-09-23.
Live runs (this session): Chrome 153.0.8010.53 on macOS (Apple M4 Max, 120 Hz), through the Chrome DevTools MCP server (headed) and through Chrome `--headless=new` started from Bash. Test pages, the local HTTP and WebSocket server and the raw copies are in `raw/gapfill-round-2/` (test pages in `raw/gapfill-round-2/mcp-test/`). Numbers from one fast machine are relative results, not budgets.

---

## A. Stale facts in files without a verify pass (gap 1)

### Preconnect only to origins the page uses soon; Chromium keeps an unused preconnected socket for about 60 s, not 10 s
- Layer: network
- Stage: network
- Metrics: LCP, FCP
- When: load
- Impact: medium. The wrong number leads to wrong advice: with 10 s, a writer may drop a useful preconnect for a resource that starts 15 s later, or may think that a stale preconnect costs nothing after 10 s.
- Do: Preconnect only to the 1-3 cross-origins that the current view needs in its first seconds. Write the timeout as: "Chromium drops an unused preconnected socket after about 60 s. The 2019 web.dev article says 10 s. Servers and CDNs can close idle connections sooner."
- Why: In Chromium `main`, `ClientSocketPoolManager::unused_idle_socket_timeout()` returns `kPreconnectIntervalSec = 60` seconds (net/socket/client_socket_pool_manager.cc, lines 208-212, re-read today). verify/02 found the same value and also found that used idle sockets stay for 300 s.
- Example:
  ```html
  <!-- Market-data REST origin is used in the first second; the news CDN is not. -->
  <link rel="preconnect" href="https://md.example-broker.com" crossorigin>
  <link rel="dns-prefetch" href="https://news-cdn.example.com">
  ```
- Avoid/caveats: Each preconnect still costs a TLS handshake and a certificate download. An idle socket also costs server resources. The 60 s value is Chromium only. I did not check Firefox or Safari.
- Resolution: Change 16-explore-fast-batch-05.md:56 ("within about 10 s"), 16-explore-fast-batch-02.md:486 (the 2019 "10 s" caveat), 16-explore-fast-batch-02.md:15 and :640 ("not re-verified", now verified), and 16-explore-fast-index.md:88. 04-html-and-http-loading-features.md:118 had a verify pass but still has the 2019 wording (verify/02, conflict 4). Use the sentence in "Do" in all of these places.
- Status: `rel=preconnect` Baseline widely available (web-features `link-rel-preconnect`: low 2020-01-15, high 2022-07-15). The 60 s timeout is Chromium `main` (2026-09).
- Sources: https://chromium.googlesource.com/chromium/src/+/main/net/socket/client_socket_pool_manager.cc, verify/02-course-loading.verify.md (preconnect item), https://web.dev/articles/preconnect-and-dns-prefetch

### Read `navigator.deviceMemory` with the Chrome 147 buckets: 2-32 on desktop, 1-8 on Android
- Layer: js, network
- Stage: script-run
- Metrics: FPS/smoothness, memory, INP
- When: load
- Impact: medium. Device-class code that was written for the old 0.25-8 range now misclassifies devices. A test for `mem < 1` never matches, and desktop machines with 16 GiB or 32 GiB are no longer reported as 8.
- Do: Treat `deviceMemory` as a coarse bucket per platform. On Chrome 147+ desktop, the values are 2, 4, 8, 16 and 32. On Chrome 147+ Android, they are 1, 2, 4 and 8. Classify by platform: for example, "low" is `<= 2` on Android and `== 2` on desktop. Treat a missing value (Firefox, Safari) as "unknown", not as "low". When you compare field data over time, split it at Chrome 147.
- Why: The spec rounds physical memory to the nearest power of two and then clamps it to an implementation-defined lower and upper bound, which "may differ on different device types" (W3C WD 2026-03-30). The chromestatus entry "Update Device Memory API limits" gives the new lists and ships in 147 on desktop and Android. BCD notes on `api.Navigator.deviceMemory` and `http.headers.Sec-CH-Device-Memory` confirm: "From Chrome 147, reported values are 2, 4, 8, 16, and 32" (desktop) and 1, 2, 4, 8 (Android). Before 147, both platforms reported 0.25, 0.5, 1, 2, 4 and 8.
- Example:
  ```ts
  // Before: assumes the old 0.25-8 range on every platform.
  const low = (navigator as any).deviceMemory <= 2;

  // After: bucket per platform; undefined means "unknown".
  function memoryClass(): 'low' | 'mid' | 'high' | 'unknown' {
    const gib = (navigator as any).deviceMemory as number | undefined;
    if (gib === undefined) return 'unknown';
    const mobile = (navigator as any).userAgentData?.mobile ?? /Android/.test(navigator.userAgent);
    if (mobile) return gib <= 2 ? 'low' : gib <= 4 ? 'mid' : 'high';
    return gib <= 2 ? 'low' : gib <= 8 ? 'mid' : 'high';
  }
  ```
- Avoid/caveats: The same change applies to the `Sec-CH-Device-Memory` hint and the deprecated `Device-Memory` header, so server-side device classes also shift at 147. On desktop, 2 is now the floor, so 2 means "2 GiB or less". Keep the other signals from 07 (`hardwareConcurrency`, `cpuPerformance`) and prefer measured frame time over device guesses for the degradation policy (15-gaps-round-1).
- Resolution: 07-js-web-apis.md:803 ("power of two, clamped", `mem <= 2` as low) is incomplete. Add the per-platform lists and the 147 change to :803 and :812 and to the Status line at :813. 04-html-and-http-loading-features.md:663 (the `Sec-CH-Device-Memory` hint) needs the same caveat. verify/04 already recorded the header change.
- Status: `navigator.deviceMemory` Chrome 63 (workers 65), Chromium only. `Sec-CH-Device-Memory` Chrome 97 (experimental in BCD). Chrome 147+: new buckets (BCD 8.1.2 notes; chromestatus 6330376953921536). No Firefox or Safari support.
- Sources: https://www.w3.org/TR/device-memory/, https://chromestatus.com/feature/6330376953921536, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-CH-Device-Memory, raw/bcd.json (`api.Navigator.deviceMemory`, `http.headers.Sec-CH-Device-Memory`)

**Sweep: other facts in unverified files that verify/01-04 or this round show to be stale** (a table, not an item)
I grepped files 05-14, 16 and 17 for every fact that verify/01-04 corrected, and for Status lines that say "no Safari". Each finding below was checked against the named source today.

| File:line | Stale text | Current fact | Source |
|---|---|---|---|
| 07-js-web-apis.md:26 and 16-explore-fast-batch-03.md:525 | Workers cannot use WebUSB, WebRTC and Web Audio (2019 list) | Workers have no DOM, no `AudioContext` and no `RTCPeerConnection`. `RTCDataChannel` can be transferred to a worker (Chrome 130, Firefox 144, Safari 15). WebUSB is partly exposed in Chromium dedicated workers. | verify/03 section D (BCD `worker_support`) |
| 07-js-web-apis.md:756 | `renderTime` is 0 for cross-origin images without `Timing-Allow-Origin` | From Chrome 133, a slightly coarsened render time is exposed without TAO. The old rule still holds in other engines. Keep sending `Timing-Allow-Origin`. | https://web.dev/articles/lcp (re-read today) |
| 16-explore-fast-batch-03.md:128 (Status) and 16-explore-fast-index.md:216 | `sizes="auto"`: "not in Safari" | Safari 27.0 supports `sizes="auto"` (WebKit post 2026-09-17). BCD 8.1.2 and webstatus lag behind. | https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ |
| 16-explore-fast-index.md:213 | Fetch Priority "Chrome/Edge 103" | Chrome 101 for the HTML attribute and `fetch()` `priority`, Chrome 103 for the `Link` header parameter. web-features gives 103 at feature level. | verify/02 conflict 1 (BCD 8.1.2) |
| 07-js-web-apis.md:373 and :375 | `unload` deprecation "100% planned at M154" | Done: Chrome 154 (2026-09-22) is at 100% of page loads. The 15-gaps-round-1 item "Treat unload as gone in Chrome 154+" already covers the rule. | https://developer.chrome.com/docs/web-platform/deprecating-unload (rollout table re-read) |
| 07-js-web-apis.md:4, :1026; 14-devtools-mcp-and-webmcp.md:5 | "Chrome 153" as the current version | Chrome 154 is stable since 2026-09-22. Chrome 153 remains correct as the test browser: the MCP browser in this session was 153.0.8010.53, one version behind stable. | chromiumdash (15-gaps-round-1), `navigator.userAgent` in this session |
| 16-explore-fast-batch-02.md:15, :640 | Preconnect 10 s "not re-verified" | 60 s in Chromium (item above). | Chromium source |
| 14-devtools-mcp-and-webmcp.md:781-792 | Open: WebMCP flags, WebSocket throttling, GPU in traces, no INP or render-loop trace | Closed in part F. | Part F |

Not found in 05-14, 16 or 17: the old Lighthouse audit names as current advice (16 already maps them to Lighthouse 13 insights), "Chrome 102" for Fetch Priority, `HTTP/1.1 103`, `private, no-store` for a logged-in shell, and the old DOM-size limits as current advice (16-batch-01 already flags them as out of date).

---

## B. Missing platform levers (gaps 2-8 and 13)

### Place tooltips, context menus and order-entry popups with CSS anchor positioning, not with scroll and resize listeners
- Layer: css, html
- Stage: layout, main-thread-task, script-run
- Metrics: INP, FPS/smoothness, bundle-size
- When: interaction, animation/render-loop
- Impact: medium. A JS positioning library reads `getBoundingClientRect()` and writes `top`/`left` on every scroll and resize event. That causes forced layouts on the main thread while the user scrolls a watchlist or order book. The CSS version needs no JS at all.
- Do: Give the anchor an `anchor-name` and the floating element `position: absolute` or `fixed`, a `position-anchor` and a `position-area`. Add `position-try-fallbacks: flip-block, flip-inline` for edge cases. For a popover, reset the UA centering with `inset: auto; margin: 0`. Name the anchor explicitly, or set `position-anchor: auto` when you rely on the implicit popover anchor. Gate the fallback with `@supports (anchor-name: --a)`. When you need broad coverage, load `@oddbird/css-anchor-positioning` only when `'anchorName' in document.documentElement.style` is false.
- Why: The browser resolves anchor positions during layout, so no script runs per frame. Scroll gets special handling (spec section 3.3): the scroll offset of the default anchor is applied after layout, "as if affected by a transform", so the popup follows the anchor on scroll without a new layout. The spec says that anchor references to other scroll containers are remembered and updated only at "anchor recalculation points" (when the element starts to be displayed or changes fallback). MDN says that the JS approach "added complexity and performance issues". Chrome's Modern Web Guidance lists Popper.js and Floating UI as the libraries this replaces (`resilient-context-menus-and-nested-dropdowns.md`).
- Example:
  ```html
  <td class="px"><button id="bid-101-25" popovertarget="ticket">101.25</button></td>
  <div id="ticket" popover>…order ticket…</div>
  ```
  ```css
  #bid-101-25 { anchor-name: --price-cell; }
  #ticket {
    position-anchor: --price-cell;
    inset: auto; margin: 0;                          /* drop popover centering */
    position-area: block-end span-inline-end;
    position-try-fallbacks: flip-block, flip-inline; /* stay on screen */
  }
  @supports not (anchor-name: --a) {
    #ticket { inset: auto 16px 16px auto; }          /* docked fallback, no JS */
  }
  ```
- Avoid/caveats: The default anchor gets scroll compensation, but anchors reached only through `anchor(--other …)` do not. Reference a scrolling anchor through `position-anchor`. The spec warns that if an anchor moves by `transform`, the anchored element "may be delayed by a few frames". Rows of a virtualized list that are placed with `translateY` are such a case. Transform-aware anchoring is in Chrome 144 (web-features `anchor-positioning-transforms`) and in Safari 27 (WebKit post). Firefox is not listed. I did not test how it places the popup when the anchor has a transform. The initial value of `position-anchor` changed in every engine: Chrome 125-126 `implicit`, 127-143 `auto`, 144-150 `none`, and 151+ `normal`. Firefox 147-150 used `auto`, and Safari 26.x used `auto`. Code that relies on the implicit anchor without setting `position-anchor` therefore behaves differently across versions. Do not use `position-visibility: anchor-visible`/`anchor-valid` (Safari 27 only). The old names `anchors-visible` (Chrome 125, Firefox 147, Safari 26.2) still work but are deprecated. The Oddbird polyfill does not support implicit anchors or `position-area` on popovers (Modern Web Guidance), so use explicit names and `anchor()` insets when the polyfill must work. Popover alone does not position anything: 04-html-and-http-loading-features.md:778 ("removes positioning … JS") is only true together with this item.
- Status: Core properties per BCD 8.1.2: `anchor-name`, `anchor()`, `anchor-size()`, `@position-try` and `position-try-order` in Chrome 125, Firefox 147 (148 for `position-try-order`) and Safari 26. `position-area` in Chrome 129, Firefox 147 and Safari 26. `position-try-fallbacks` in Chrome 128, Firefox 147 and Safari 26. Per-key Baseline newly available (web-features `by_compat_key`): `anchor-name`, `anchor()`, `position-area` and `position-try-fallbacks` on 2026-01-13, `position-try-order` on 2026-02-24, and `position-anchor` only on 2026-09-14, because earlier versions count as partial (different initial value). The web-features group `anchor-positioning` is not Baseline, and its support lists Safari 27 only, because the renamed `position-visibility` values and the `position-anchor: normal` initial value exist only in Chrome 151, Firefox 151 and Safari 27. Modern Web Guidance prints this group status ("Supported by: Safari 27"), which understates support of the core.
- Sources: https://drafts.csswg.org/css-anchor-position-1/ (WD 2026-09-06, sections 2 and 3.3), https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Anchor_positioning/Using, https://developer.chrome.com/blog/anchor-positioning-api, https://github.com/GoogleChrome/modern-web-guidance (guides/ui-atoms/resilient-context-menus-and-nested-dropdowns.md), https://webkit.org/blog/18325/webkit-features-for-safari-27-0/, raw/bcd.json, raw/web-features.json

### Do not inject style rules at runtime during rendering; ship static CSS and put dynamic values in inline styles or custom properties
- Layer: css, js
- Stage: cssom, style
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium to high for component-heavy terminals. Each rule insertion makes the next style update rebuild rule data and check the whole tree scope, and CSS-in-JS libraries insert rules while components render.
- Do: Extract static styles at build time into CSS files or CSS modules. Set per-instance values (price colors, row heights, cell widths) with `element.style` or a custom property on the element. If a runtime CSS-in-JS library stays, insert its rules in one batch before layout reads: `useInsertionEffect` in React, or before the first `getBoundingClientRect()` in other stacks. Never insert rules inside a live-update path such as a tick handler or per-row render.
- Why: react.dev lists two problems: runtime injection makes the browser recalculate styles "a lot more often", and injection at the wrong time in the lifecycle can be very slow. The React 18 working-group note (Markbåge, 2021-10-12) says that when rules change, the browser must match the old rules against the old nodes again, and that during concurrent rendering this repeats between yields. The Blink source shows the cost. `CSSStyleSheet::WillMutateRules()` clears the sheet's RuleSet, so the whole sheet is indexed again. `DidMutate()` marks the tree scope for an active-style update and calls `InvalidateMatchedPropertiesCache()` for the document. `StyleEngine::InvalidateForRuleSetChanges()` then walks every element of the tree scope and matches the changed rules against it. Blink uses a `RuleSetDiff` when it can, so only the new rules are matched, but the walk still visits all elements. When `@layer` rules change and the change is not a plain append, Blink rebuilds all at-rule registries and recalculates style for the whole document (`ApplyRuleSetChanges`). Local measurement (headless Chrome 153, 9,209 elements, forced style after each step): one `insertRule` cost 0.80 ms. One new `<style>` element cost 0.67 ms. One `insertRule` into an adopted constructed sheet cost 0.68 ms. The same color change through `element.style` cost 0.002 ms. Ten `insertRule` calls followed by one style update cost 0.95 ms. So the cost comes from each style update that follows a sheet change, not from each rule.
- Example:
  ```tsx
  // Before: a styled component that creates a new class for each price.
  const Cell = styled.td<{ up: boolean }>`color: ${(p) => (p.up ? 'green' : 'red')};`;

  // After: static CSS file plus a custom property or a class toggle.
  // cells.css: .cell { color: var(--tick-color, inherit); } .cell.up { --tick-color: green; } .cell.down { --tick-color: red; }
  <td className={`cell ${up ? 'up' : 'down'}`}>{price}</td>
  ```
- Avoid/caveats: Inline style changes also cause style recalculation, but only for the element and what inherits from it. A custom property set on a high ancestor makes all descendants recalculate (05 section D). Libraries with zero runtime (build-time extraction) do not have this cost. The 0.7-0.8 ms figures come from one fast desktop, so expect several times more on a mid-range phone. I did not measure Firefox or Safari.
- Status: Guidance. `insertRule` and `<style>` work in all engines. `useInsertionEffect` React 18+.
- Sources: https://react.dev/reference/react/useInsertionEffect, https://github.com/reactwg/react-18/discussions/110, https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/css_style_sheet.cc, https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/style_engine.cc, https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/active_style_sheets.cc, raw/gapfill-round-2/mcp-test/css.html

### Share one constructed stylesheet across shadow roots with `adoptedStyleSheets`, and change it rarely
- Layer: css, js
- Stage: cssom, style, gc-memory
- Metrics: memory, startup
- When: load, long-lived session
- Impact: low to medium. It matters when many web components (for example one per watchlist row or per chart widget) each carry the same `<style>`.
- Do: Create the component sheet once at module scope with `new CSSStyleSheet()` and `replaceSync(css)`, and add it with `shadowRoot.adoptedStyleSheets = [sheet]` in each instance. Use `replace()` (async) for large sheets off the critical path. Treat the shared sheet as static. Put per-instance values in custom properties on the host, not in rules added to the shared sheet.
- Why: One `CSSStyleSheet` object is shared by every root that adopts it, so no `<style>` node or parse is needed per instance. web.dev says that adopting is "fast and synchronous once the sheet has been loaded", and that an update to a shared sheet applies to every adopting root. Blink already reuses the parsed contents of identical `<style>` text through `text_to_sheet_cache_`, so in Chromium the saving is mainly DOM nodes and a single place to update. In Blink, one mutation of an adopted sheet marks every adopting tree scope for a style update (`DidMutate()` loops over `adopted_tree_scopes_`). A rule change in a sheet that 500 rows share therefore makes all 500 scopes recalculate.
- Example:
  ```js
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`:host { display: block; contain: content; } .px { color: var(--px-color); }`);
  class QuoteRow extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }).adoptedStyleSheets = [sheet]; }
  }
  customElements.define('quote-row', QuoteRow);
  ```
- Avoid/caveats: `replace()` and `replaceSync()` ignore `@import`. A mutation of a shared `<style>` in Blink copies the shared contents first (copy-on-write). I did not check whether Gecko and WebKit share parsed `<style>` text the way Blink does, so the parse saving there is not verified. WebKit fixed a bug where adopted sheets in cross-origin iframes were treated as UA sheets (Safari 27 notes).
- Status: Constructed stylesheets Baseline widely available (web-features `constructed-stylesheets`: low 2023-03-27, high 2025-09-27; Chrome 73, Firefox 101, Safari 16.4).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Document/adoptedStyleSheets, https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet/CSSStyleSheet, https://web.dev/articles/constructable-stylesheets, https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/style_engine.cc

### Mark per-frame and per-tick work with `console.timeStamp(label, start, end, track, group, color)`, not with `performance.measure`
- Layer: js, tooling
- Stage: script-run, main-thread-task
- Metrics: FPS/smoothness, memory
- When: animation/render-loop, long-lived session, testing
- Impact: medium. It makes custom tracks (chart render, tick ingest, indicator math) cheap enough to leave in production builds, and it adds nothing to the performance timeline buffer.
- Do: In hot paths, take `const t0 = performance.now()` and call `console.timeStamp('render', t0, performance.now(), 'Chart', 'Terminal', 'primary')` after the work. Keep `performance.mark`/`measure` with `detail.devtools` for rare events that need properties, tooltips or RUM export. Use the colors from the DevTools list (`primary`, `secondary`, `tertiary`, each with `-light`/`-dark`, and `error`).
- Why: Chrome 134 extended `console.timeStamp()` in a backward-compatible way with a start, an end, a track, a track group and a color. The DevTools docs say it is built for "minimal runtime overhead" and that it does not add entries to the browser's performance timeline. Local measurement (headless Chrome 153, no DevTools attached, 100,000 calls): `console.timeStamp` with all arguments added about 0.15 µs per call over the loop baseline. `performance.measure` with a `detail.devtools` object added about 0.7 µs per call and kept 100,000 entries in the buffer. `performance.getEntries()` showed 0 mark/measure entries after the `console.timeStamp` loop. The MCP trace summary lists these tracks under "# Custom tracks" (verified in part F).
- Example:
  ```ts
  function onFrame() {
    const t0 = performance.now();
    chart.applyPendingTicks();
    console.timeStamp('apply ticks', t0, performance.now(), 'Chart', 'Terminal', 'secondary');
  }
  ```
- Avoid/caveats: The call is cheap only when no inspector client listens to the console. With the Chrome DevTools MCP server attached (CDP console and runtime enabled), the same loop cost about 4.9 µs per call, about 30 times more. That is still fine per frame, but at 10,000 ticks per second it is about 5% of a core, so sample or aggregate per frame during agent runs. Other engines treat the extra arguments differently: BCD says that Firefox shows `console.timeStamp` markers in the profiler from Firefox 149 (98-148: callable, no marker). I did not verify how Firefox or Safari use the track arguments. The Performance panel shows the tracks only when "Show custom tracks" is on.
- Status: Extended signature Chrome 134+ (Chrome 134 beta post, DevTools docs). `console.timeStamp` exists in all engines (BCD: Chrome 15, Firefox 149 full, Safari 6). The extension is a DevTools convention, not a standard.
- Sources: https://developer.chrome.com/docs/devtools/performance/extension, https://developer.chrome.com/blog/chrome-134-beta, raw/bcd.json (`api.console.timeStamp_static`), raw/gapfill-round-2/mcp-test/bench.html

### Send `Document-Policy: expect-no-linked-resources` only for large HTML documents that link few or no subresources
- Layer: network, html
- Stage: html-parse, preload-scan
- Metrics: FCP, LCP, TBT
- When: load
- Impact: low. It helps only large documents with almost no subresources (for example a big server-rendered report, statement or log page with inline CSS). The terminal app shell does not fit this case.
- Do: Send `Document-Policy: expect-no-linked-resources` on the response of such a document. Combine it with other configuration points in one header, separated by commas (for example `Document-Policy: js-profiling, expect-no-linked-resources`). If you need a resource early, preload it with a `Link:` header or `<link rel=preload>` at the top. Do not send the policy on pages that have critical images, scripts or styles in the markup.
- Why: The browser runs a speculative parser (preload scanner) over the HTML to find subresources early. For large HTML with nothing to find, this pass costs main-thread time and gives nothing. The policy is a hint that lets the user agent skip that pass. The explainer says that fetches from the speculative parser "may be avoided". Those resources are then fetched when the main parser reaches them.
- Example:
  ```http
  HTTP/2 200
  content-type: text/html; charset=utf-8
  document-policy: expect-no-linked-resources
  ```
- Avoid/caveats: On a page with resources in the markup, discovery waits for the main parser. A late image or a script behind a parser-blocking script is then found later, so LCP gets worse. It is only a hint, and the browser may ignore it. There is no `<meta>` form: the explainer rejected it. I did not test whether `Link` preload headers and 103 Early Hints still work with the policy. They are not part of speculative parsing, so they should work (inference). Measure LCP before and after.
- Status: Chrome 134 desktop, Android and WebView (chromestatus 5202800863346688: "Enabled by default", ship stage 134; also in the Chrome 134 beta post). The blink-dev Intent to Ship (2024-12-10) targeted 133, and API owners asked for a stable spec venue. An origin trial of the earlier "skip preload scanning" design ran in Chrome 125-130. The Firefox and Safari positions on chromestatus are "Negative": Gecko runs speculative parsing inside its parser and expects no gain. The WHATWG HTML PR #10718 is open ("needs implementer interest"). Chromium only.
- Sources: https://github.com/explainers-by-googlers/expect-no-linked-resources, https://chromestatus.com/feature/5202800863346688, https://developer.chrome.com/blog/chrome-134-beta, https://github.com/whatwg/html/pull/10718, https://groups.google.com/a/chromium.org/d/msgid/blink-dev/6759101e.2b0a0220.23f11c.0000.GAE%40google.com

### Reorder live lists with `moveBefore()` where supported, so rows keep their animations, focus and iframes
- Layer: js
- Stage: style, layout, script-run
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium. A watchlist or order book sorted on each tick restarts every row's flash animation and drops focus from a row input when it moves rows with `insertBefore`. In one local test, `moveBefore` also cost less time.
- Do: When you move rows that already exist in the document, call `parent.moveBefore(row, ref)` if `'moveBefore' in Element.prototype`, and otherwise call `parent.insertBefore(row, ref)`. Use `insertBefore` or `append` for new or detached nodes, because `moveBefore` throws for them. In custom elements, implement `connectedMoveCallback()` so that a move does not run your teardown and setup (for example, disposing and recreating a chart).
- Why: DOM defines "move" as a separate primitive that does not run the removing and insertion steps. State that removal resets (CSS animations and transitions, iframe documents, focus, popover and modal dialog state, fullscreen) is kept. Custom elements get `connectedMoveCallback` instead of `disconnectedCallback` plus `connectedCallback`. Local measurement (MCP Chrome 153, 1,000 rows with a running 5 s CSS animation, full reorder plus a forced layout): `insertBefore` took 22.7-24.0 ms and every animation restarted (`currentTime` went back to 0). `moveBefore` took 12.1-15.8 ms and the animations continued (`currentTime` stayed at 258 ms).
- Example:
  ```js
  const move = 'moveBefore' in Element.prototype
    ? (parent, node, ref) => parent.moveBefore(node, ref)
    : (parent, node, ref) => parent.insertBefore(node, ref);
  function applyOrder(tbody, rowsInOrder) {           // rows already in tbody
    for (const row of rowsInOrder) move(tbody, row, null);
  }
  ```
- Avoid/caveats: `moveBefore` throws `HierarchyRequestError` when the node and the new parent do not have the same shadow-including root (so it fails for a detached node), and when the node is not an Element or CharacterData node. MutationObserver still reports a removed node and an added node. The fallback path still resets state in Safari. Moving fewer rows (only those whose rank changed) saves more than any API choice. The timing gain comes from one test on one machine.
- Status: Chrome 133, Firefox 144, not Safari (BCD 8.1.2; web-features `move-before`: not Baseline). WebKit standards position: "support" (issue #375, closed 2026-07-13). An Interop proposal is open (web-platform-tests/interop #1355).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Element/moveBefore, https://developer.chrome.com/blog/movebefore-api, https://dom.spec.whatwg.org/ ("move" algorithm), https://github.com/WebKit/standards-positions/issues/375, raw/gapfill-round-2/mcp-test/move.html

### Highlight search and filter matches with the CSS Custom Highlight API and `StaticRange`, not by wrapping text in `<mark>`/`<span>`
- Layer: css, js
- Stage: paint, style, layout, script-run
- Metrics: INP, memory
- When: interaction
- Impact: medium. Symbol search, log viewers and alert lists re-highlight on every keystroke. Wrapping text adds nodes and forces style and layout on each keystroke.
- Do: Keep the text nodes. For each match, create a `StaticRange` (or a `Range`) and register all of them with `CSS.highlights.set('hit', new Highlight(...ranges))`. Style them with `::highlight(hit) { background-color: …; color: … }`. Replace the whole highlight on each query. Use `Highlight.priority` when two highlights overlap. Feature-detect with `'highlights' in CSS` and fall back to `<mark>`.
- Why: Highlights paint over existing text without changing the DOM. The spec says that registry changes cause an async repaint, and that the APIs must not block while they wait for it. It advises `StaticRange` because the browser must update every live `Range` on each DOM change, which "has a significant performance cost". Local measurement (MCP Chrome 153, 5,000 rows, 20 queries, time to the second rAF): re-rendering the rows with `<mark>` took 133 ms median (max 178 ms) per keystroke. The Highlight API with `StaticRange` took 16.7 ms median, which is the two-frame floor at 120 Hz, and it added no nodes. A CSS-Tricks author reports about 5x in another demo (blog only). MDN makes no speed claim.
- Example:
  ```js
  function highlight(textNodes, query) {
    const q = query.toLowerCase(), ranges = [];
    for (const node of textNodes) {
      const s = node.data.toLowerCase();
      for (let at = s.indexOf(q); q && at !== -1; at = s.indexOf(q, at + q.length))
        ranges.push(new StaticRange({ startContainer: node, startOffset: at, endContainer: node, endOffset: at + q.length }));
    }
    CSS.highlights.set('hit', new Highlight(...ranges));
  }
  ```
- Avoid/caveats: Only a few properties apply to `::highlight()`: `color`, `background-color`, `text-decoration`, `text-shadow`, stroke and fill properties, and custom properties. CSS Pseudo 4 notes that only `color` and `background-color` work in all engines. `StaticRange` offsets go stale when the text changes, so rebuild them after DOM updates. The span-wrapping baseline in my test was the naive "re-render all rows" version. A version that touches only changed rows costs less. Screen readers do not announce custom highlights, so add another cue where the match matters.
- Status: web-features `highlight` Baseline newly available 2026-03-24 (Chrome 105, Firefox 149 for `::highlight()`, Safari 17.2). `Highlight`/`HighlightRegistry` Firefox 140. `StaticRange` constructor Chrome 90, Firefox 71, Safari 13.1. `highlightsFromPoint()` Chrome 140, Firefox 150, Safari Technology Preview only.
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API, https://drafts.csswg.org/css-highlight-api-1/ (ED 2026-01-09, section 5), https://drafts.csswg.org/css-pseudo-4/ (highlight styling), https://css-tricks.com/css-custom-highlight-api-early-look/ (blog), https://frontendmasters.com/blog/using-the-custom-highlight-api/ (blog), raw/gapfill-round-2/mcp-test/hl.html

### Handle a null WebGL2 context: Chrome no longer falls back to SwiftShader, and SciChart rejects without WebGL2
- Layer: gpu, js
- Stage: gpu-draw, script-run
- Metrics: startup, FPS/smoothness
- When: load
- Impact: high for a WebGL-only chart stack. On a machine with no usable GPU, `getContext('webgl2')` now returns `null` in Chrome, and `SciChartSurface.create()` throws. Without an error path the chart area stays blank.
- Do: Wrap chart creation in `try/catch`. On failure, show a clear message and a lighter view (a table of last prices, or a Canvas2D sparkline) and send a telemetry event with the reason. Probe once at startup with a throwaway canvas. After a failure, re-check only on reload, because SciChart caches its probe result. Keep the `failIfMajorPerformanceCaveat` probe from 10-gpu-webgl.md:109 for the slow-GPU case.
- Why: The chromestatus entry "Remove SwiftShader fallback" (milestone 139) says that WebGL context creation now fails instead of falling back to SwiftShader, for security (JIT code in the GPU process) and because of the poor experience. Its rollout notes say that macOS and Linux lose the fallback, and that Windows keeps SwiftShader only for devices with no GPU or a blocklisted GPU, with a Microsoft WARP experiment. The enterprise policy `EnableUnsafeSwiftShader` (Chrome 139+) says that WebGL creation will fail from M139 where it would have used SwiftShader. The blink-dev Intent to Remove (2025-02-13) gives the usage: about 2.7% of WebGL contexts, or about 0.5% of page loads. SciChart 5.2.69 `WebGlHelper.initialize()` throws "SciChart.js requires WebGL2 support" when the probe fails, and caches the result (`WebGlHelper.initialized = true`).
- Example:
  ```ts
  async function mountChart(el: HTMLDivElement) {
    try {
      const { sciChartSurface } = await SciChartSurface.create(el, { freezeWhenOutOfView: true });
      return sciChartSurface;
    } catch (err) {
      el.replaceChildren(renderPriceTableFallback());   // no WebGL2: usable, lighter view
      telemetry.send('chart_webgl_unavailable', { message: String(err) });
      return null;
    }
  }
  ```
- Avoid/caveats: Do not ask users to enable `--enable-unsafe-swiftshader`. It is a test-only switch. In my macOS test, `--disable-gpu` made WebGL2 `null`, which matches the removal. For headless and CI runs, see the next item.
- Status: Chrome 139+ (chromestatus 5166674414927872, "Deprecated", desktop 139). Enterprise policy `EnableUnsafeSwiftShader` from Chrome 139 ("temporary policy"). Firefox and Safari: "No signal" on chromestatus. Mobile is not affected: "SwiftShader is not used on mobile" (Intent to Remove).
- Sources: https://chromestatus.com/feature/5166674414927872, https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM, https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md, https://chromium.googlesource.com/chromium/src/+/main/components/policy/resources/templates/policy_definitions/Miscellaneous/EnableUnsafeSwiftShader.yaml, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Core/WebGlHelper.js

### In headless and CI browsers, check the WebGL renderer before every chart run, and set the software path on purpose
- Layer: tooling, gpu
- Stage: gpu-draw
- Metrics: FPS/smoothness
- When: testing
- Impact: high for test validity. A GPU-less CI runner now gets no WebGL at all, so chart tests fail at creation. A runner with a forced software renderer gives frame times that do not match users.
- Do: As the first step of each chart test, read `UNMASKED_RENDERER_WEBGL` (10-gpu-webgl.md, 14:165) and fail fast with a clear message when the context is null. On GPU machines, run the MCP server or Puppeteer with its defaults. On GPU-less Linux runners, choose SwiftShader explicitly with flags (MCP: `--chromeArg=<switch>`). Then verify the result with the renderer probe, because the flag combinations behave differently per platform. Label SwiftShader runs as functional tests, never as performance numbers.
- Why: Chrome 153 on macOS with `--headless=new`, run from Bash on 2026-09-23 (two runs of each case, same result each time):

  | Flags | WebGL2 result |
  |---|---|
  | none | hardware: "ANGLE Metal Renderer: Apple M4 Max" |
  | `--disable-gpu` | `null` |
  | `--disable-gpu --enable-unsafe-swiftshader` | context created, renderer string still said Apple M4 Max (not explained) |
  | `--use-angle=swiftshader` | SwiftShader ("Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0))") |
  | `--use-angle=swiftshader --enable-unsafe-swiftshader` | `null` (not explained) |
  | `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader` (the Chromium doc's "unsafe WebGL fallback" line) | `null` on macOS |

  So headless Chrome uses the real GPU on a Mac. The documented opt-in lines do not all work on macOS, and only the probe shows what you got. Puppeteer's default arguments contain no GPU or SwiftShader switch (ChromeLauncher.ts), and chrome-devtools-mcp adds only `--screen-info` in headless mode (BrowserManager.ts).
- Example:
  ```js
  // evaluate_script, first step of every chart scenario
  () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return { webgl2: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return { webgl2: true, renderer, software: /SwiftShader|llvmpipe|WARP|Basic Render/i.test(renderer) };
  }
  ```
- Avoid/caveats: I tested only macOS. The Linux and Windows results were not tested: on Windows, chromestatus says that SwiftShader or WARP can still serve GPU-less devices. The two unexplained rows may depend on the platform. `--enable-unsafe-swiftshader` lowers security, so use it only with trusted test pages.
- Status: Chrome 139+ behavior; observed on Chrome 153.0.8010.53 (macOS).
- Sources: https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md, https://raw.githubusercontent.com/puppeteer/puppeteer/main/packages/puppeteer-core/src/node/ChromeLauncher.ts, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/BrowserManager.ts, raw/gapfill-round-2/mcp-test/gpu.html

### Size dashboard grid columns with `fr` or `minmax(0, 1fr)`, not `auto`, when cells update live
- Layer: css
- Stage: layout
- Metrics: INP, FPS/smoothness
- When: animation/render-loop, interaction
- Impact: medium for live dashboards, based on one local benchmark. The critic rated the evidence weak. A local test now confirms a large difference, but only in Chrome.
- Do: For panels that contain live text, define columns as `repeat(n, minmax(0, 1fr))` (or `1fr` when the items clip their content) and rows as fixed or `minmax(0, 1fr)`. Give grid and flex items `min-width: 0`/`min-height: 0` or `overflow: hidden`, so that content does not set the track size. Keep content-sized tracks (`auto`, `min-content`, `max-content`, `fit-content()`) for static layouts.
- Why: With content-sized tracks, a text change in any cell can change the track size, so the browser must run intrinsic sizing again for the whole grid. With fixed or `minmax(0, 1fr)` tracks, the change stays inside the cell. Local measurement (headless Chrome 153, 24 panels, 7,248 elements; one "tick" = 50 price-text changes plus a forced layout; 4 runs each):

  | Grid variant | Layout per tick | Layout per width change |
  |---|---|---|
  | `repeat(4, auto)` columns, `auto` rows | 3.3-7.3 ms | 5.8-14.2 ms |
  | `auto` columns, fixed 320px rows | 5.1-7.3 ms | 10.4-13.7 ms |
  | `minmax(0, 1fr)` columns, `auto` rows | 0.45-0.60 ms | 9.8-13.8 ms |
  | `1fr` columns, fixed rows, `overflow: hidden` items | 0.34-0.41 ms | 12.9-15.2 ms |
  | `minmax(0, 1fr)` + fixed rows + `min-width: 0` | 0.27-0.47 ms | 6.1-14.4 ms |

  The column sizing decides the tick cost (about 10-20x). A width change costs about the same in every variant, because all content must lay out at the new width. Use `content-visibility`/`contain` (05 section E) for that cost.
- Example:
  ```css
  /* Before */ .dash { display: grid; grid-template-columns: repeat(4, auto); }
  /* After  */ .dash { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-auto-rows: minmax(0, 320px); }
  .dash > .panel { min-width: 0; overflow: hidden; }
  ```
- Avoid/caveats: The evidence is one synthetic benchmark in Chrome 153 on a fast desktop, with forced layouts. I did not measure Firefox or Safari and did not record a trace. The CSSWG issue on quadratic intrinsic sizing and the 2016 Chromium bug on nested grids (41258601) are old and describe the pre-LayoutNG engine. The blog numbers found in search (MoldStud, Savvy) are not usable. Plain `1fr` means `minmax(auto, 1fr)`, so without `overflow: hidden` or `min-width: 0`, long content still sets the track size.
- Status: CSS Grid and `minmax()` Baseline widely available. The performance claim is local-measurement only (2026-09-23).
- Sources: https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing, https://github.com/w3c/csswg-drafts/issues/1865, https://issues.chromium.org/issues/41258601, raw/gapfill-round-2/mcp-test/grid.html

---

## C. SciChart multi-pane synchronization (gap 10)

### Link pane X axes through `visibleRangeChanged` with value-equal ranges, and never transform the range in the handler
- Layer: js, gpu
- Stage: script-run, gpu-draw
- Metrics: FPS/smoothness, INP
- When: interaction, animation/render-loop
- Impact: medium. A zoom or pan on a price pane plus indicator panes must redraw each pane once per frame, not start a feedback loop.
- Do: For N panes, subscribe each X axis's `visibleRangeChanged` and assign `data.visibleRange` unchanged to the other axes. Subscribe after all surfaces are created (the SciChart demo does this in `configureAfterInit`). Use the same axis type and data units on every linked X axis. Do not round, clip, or convert the range in the handler. When the panes must differ (for example a category axis against a date axis), convert once through one owner and a re-entrancy guard.
- Why: In scichart 5.2.69, the `AxisCore.visibleRange` setter compares with `NumberRange.equals()`, which tests `min === min && max === max`. Only on a real change does it clear the coordinate cache, raise `visibleRangeChanged` and notify the parent. So with equal values, A→B→A stops after one bounce. With a transformed range (rounding, clipping by `visibleRangeLimit`, unit conversion), the values differ each time and the handlers can ping-pong. The redraw itself is merged: `SciChartSurface.invalidateElement()` returns early while a redraw is already pending, so N sets in one frame give one draw per surface. The forum advice to "pass the same NumberRange object" (search snippet of the 403 thread) is stricter than needed in 5.2.69: equal values are enough. Passing the same object also saves one allocation.
- Example:
  ```ts
  function linkXAxes(axes: AxisBase2D[]) {
    let syncing = false;                          // guard for any non-identity mapping
    for (const src of axes) {
      src.visibleRangeChanged.subscribe(({ visibleRange }) => {
        if (syncing) return;
        syncing = true;
        try { for (const dst of axes) if (dst !== src) dst.visibleRange = visibleRange; }
        finally { syncing = false; }
      });
    }
  }
  ```
- Avoid/caveats: With range animations (`animateVisibleRange`, inertia), the handlers run every animation frame. That is expected, but keep them cheap. The guard hides the second event, so other listeners on the target axes still see the change through their own subscriptions. SubCharts on one parent surface (13-scichart.md:327) avoid the per-surface copy cost. X linking is still needed there.
- Status: scichart 5.2.69 (source read: `Charting/Visuals/Axis/AxisCore.js` lines 390-399, `Core/NumberRange.js` `equals`, `Charting/Visuals/SciChartSurface.js` `invalidateElement`). The forum thread is not verified (HTTP 403).
- Sources: https://www.scichart.com/documentation/js/v5/2d-charts/chart-synchronization-api/synchronizing-multiple-charts/, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/Axis/AxisCore.js, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Core/NumberRange.js, https://github.com/ABTSoftware/SciChart.JS.Examples/blob/master/Examples/src/components/Examples/Charts2D/CreateStockCharts/MultiPaneStockCharts/drawExample.ts, https://www.scichart.com/questions/js/multiple-synchronised-charts-are-laggy (not readable)

### Align panes with `SciChartVerticalGroup`, and give the Y axes a fixed `axisThickness` so that a tick does not re-lay out every pane
- Layer: js, gpu
- Stage: layout, gpu-draw
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low to medium. Without a fixed thickness, a label width change in one pane (for example a price that gains a digit) can make every pane in the group redraw.
- Do: Add each pane with `verticalGroup.addSurfaceToGroup(surface)`. Set `axisThickness` on the Y axes of all panes to the widest expected label width (the typings say that it sets the minimum width and is "useful to align seriesViewRects"). Use a label format with a fixed number of decimals.
- Why: `addSurfaceToGroup` replaces the surface's layout manager with a `SynchronizedLayoutManager`. After each layout pass, `SciChartVerticalGroup.synchronizeAxisSizes()` calls `trySynchronizeLayouts()` on every member, and each member calls `invalidateElement()` when its outer axis size differs from the group maximum. So a width change in one pane makes the others draw again. With a fixed minimum thickness that is wider than any label, the group maximum stays the same (source reading; not measured).
- Example:
  ```ts
  const group = new SciChartVerticalGroup();
  for (const s of [priceSurface, macdSurface, rsiSurface]) {
    s.yAxes.get(0).axisThickness = 72;   // px, wider than the widest price label
    group.addSurfaceToGroup(s);
  }
  ```
- Avoid/caveats: `axisThickness` is a minimum, so a longer label still widens the axis. Remove panes with `group.removeSurface(s)` before `s.delete()`. `SciChartSurface.delete()` also calls it when the layout manager has a group.
- Status: scichart 5.2.69 (`Charting/LayoutManager/SciChartVerticalGroup.js`, `SynchronizedLayoutManager.js`, `AxisBase2D.d.ts`).
- Sources: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/LayoutManager/SciChartVerticalGroup.js, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/LayoutManager/SynchronizedLayoutManager.js, https://cdn.jsdelivr.net/npm/scichart@5.2.69/Charting/Visuals/Axis/AxisBase2D.d.ts

### Share the crosshair with `modifierGroup` only on the modifiers that need it
- Layer: js
- Stage: script-run, gpu-draw
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: low to medium. Each pointer move on one pane is copied to every other surface for each modifier group, so the cost grows with panes times grouped modifiers.
- Do: Put `modifierGroup` on the rollover or cursor modifier, which must mirror across panes. Keep zoom and pan modifiers ungrouped when X linking (item above) already syncs the range. Use one group name per layout.
- Why: In scichart 5.2.69 `MouseManager`, the master surface first sends the event to its own modifiers. Then, for each value in `chartModifierGroups`, it copies the arguments (`ModifierMouseArgs.copy`) to every surface in `otherSurfaces` and calls that surface's modifier handler. The SciChart docs say that mouse sync alone drifts by pixels unless the visible ranges are also linked, so grouped zoom modifiers add work without removing the need for range linking.
- Example:
  ```ts
  surface.chartModifiers.add(
    new ZoomPanModifier(),                                 // range linking syncs zoom
    new MouseWheelZoomModifier(),
    new RolloverModifier({ modifierGroup: 'panes', showTooltip: false }),
  );
  ```
- Avoid/caveats: The SciChart multi-pane demo groups only the `RolloverModifier` ("cursorGroup") and links the ranges in code, which matches this advice. I did not measure the per-event cost.
- Status: scichart 5.2.69 (`Core/Mouse/MouseManager.js`, `Charting/Visuals/SciChartSurfaceBase.js` `chartModifierGroups`).
- Sources: https://cdn.jsdelivr.net/npm/scichart@5.2.69/Core/Mouse/MouseManager.js, https://www.scichart.com/documentation/js/v5/2d-charts/chart-synchronization-api/synchronizing-multiple-charts/, https://github.com/ABTSoftware/SciChart.JS.Examples/blob/master/Examples/src/components/Examples/Charts2D/CreateStockCharts/MultiPaneStockCharts/drawExample.ts

---

## D. Cross-engine agent testing (gap 9)

### Check Safari-specific behavior with the Safari MCP server (`safaridriver --mcp`) before you claim a fix works in Safari
- Layer: tooling
- Stage: network, main-thread-task, layout
- Metrics: LCP, INP, FCP
- When: testing
- Impact: medium. Many rules have Safari-specific branches (no `scheduler.yield`, `content-visibility: auto` only from Safari 26, bfcache rules). An agent that tests only in Chrome cannot confirm them.
- Do: Enable Safari > Settings > Developer > "Allow remote automation and external agents" (and "Show features for web developers" first if needed). Register the server with `claude mcp add safari-mcp -- /usr/bin/safaridriver --mcp`. Use `evaluate_javascript` with PerformanceObserver to read Navigation Timing, Resource Timing, LCP and Event Timing (INP), and use `list_network_requests`/`get_network_request` for timings. Record "Safari 27.x, macOS, no throttling" with each number.
- Why: WebKit shipped the server in Safari 27.0. It gives the DOM, network requests, screenshots and console output, and the post lists performance analysis "with navigation timing and resource load times". The tool list in the introduction post (2026-07-01): `browser_console_messages`, `browser_dialogs`, `close_tab`, `create_tab`, `evaluate_javascript`, `get_network_request`, `get_page_content`, `list_network_requests`, `list_tabs`, `navigate_to_url`, `page_info`, `page_interactions`, `screenshot`, `set_emulated_media`, `set_viewport_size`, `switch_tab`, `wait_for_navigation`. Safari 26.2 added `PerformanceEventTiming` with `interactionId` and `LargestContentfulPaint` (BCD), so INP and LCP can be measured in the page.
- Example:
  ```js
  // evaluate_javascript in Safari: INP-style worst interaction since load
  new Promise((done) => {
    let worst = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) worst = Math.max(worst, e.duration); })
      .observe({ type: 'event', buffered: true, durationThreshold: 16 });
    setTimeout(() => done({ worstInteractionMs: worst }), 1000);
  });
  ```
- Avoid/caveats: The server has no trace, profiler, CPU throttling or network throttling tool, and no heap snapshot. Safari has no LoAF, `layout-shift` or `longtask` entries (BCD), so CLS and frame attribution cannot be measured there. Use rAF frame intervals for render loops. The server runs only on macOS, with Safari 27+ or Safari Technology Preview 247+.
- Status: Safari 27.0 (stable, WebKit post 2026-09-17). Safari Technology Preview 247+.
- Sources: https://webkit.org/blog/18325/webkit-features-for-safari-27-0/, https://webkit.org/blog/18136/introducing-the-safari-mcp-server-for-web-developers/, https://developer.apple.com/documentation/safari-developer-tools/connecting-an-ai-agent-to-safari (linked, not read), raw/bcd.json

### Profile Gecko-specific cost with Mozilla's `firefox-devtools-mcp` in the `developer` preset
- Layer: tooling
- Stage: main-thread-task, gpu-draw, network
- Metrics: FPS/smoothness, INP, LCP
- When: testing
- Impact: medium. Firefox behavior differs from Chrome for several rules (`scheduler.yield` only from Firefox 142, `sizes="auto"` from 150, `content-visibility` details). Firefox also has a real sampling profiler that agents can start.
- Do: Register it with `claude mcp add firefox-devtools npx @mozilla/firefox-devtools-mcp@latest -- --tool-preset developer` and a dedicated profile (`--profile-path`). Use `profiler_start` with `preset: 'web-developer'` (or `'graphics'` for WebGL work) around the scenario, then `profiler_stop`, which saves a profile file for the Firefox Profiler. Use `evaluate_script` for Event Timing and LCP numbers, as in Safari.
- Why: The server automates Firefox over WebDriver BiDi through Selenium, and uses Marionette for the rest. Presets add tool modules: `slim` < `basic` (default, includes `evaluate_script`) < `developer` (adds `debugging`, `network`, `console`, `profiler`) < `mozilla` (internal builds). The profiler tools are `profiler_is_active`, `profiler_start` (presets `web-developer`, `firefox-platform`, `graphics`, `media`, `ml`, `networking`, `power`, `debug`, or explicit entries, interval, features and threads) and `profiler_stop`.
- Example:
  ```text
  navigate_page → profiler_start {preset: "graphics"} → run the 10 s tick replay →
  profiler_stop → open the saved profile in profiler.firefox.com
  ```
- Avoid/caveats: `profiler_stop` returns a file path, not a summary. The agent cannot read the profile the way it reads the Chrome trace summary, so a human or a separate parser must analyze it. Firefox has no LoAF or `layout-shift` entries. The README warns never to point the server at your normal profile, because the agent can reach its cookies and sessions. Android mode wipes the app data on each session. The `screencast` tools need Firefox 154+.
- Status: `@mozilla/firefox-devtools-mcp` 0.10.4 (npm latest, 2026-09-23). Firefox 100+ required. Mozilla also documents it in the Firefox source docs ("It isn't complete yet").
- Sources: https://github.com/mozilla/firefox-devtools-mcp, https://github.com/mozilla/firefox-devtools-mcp/blob/main/docs/tools.md, https://firefox-source-docs.mozilla.org/ai-agent-tools/firefox-devtools-mcp.html, https://registry.npmjs.org/@mozilla/firefox-devtools-mcp/latest

---

## E. Survey rules without items (gap 11)

### Give each element one animation owner, and give every rAF loop a stop condition
- Layer: js, css
- Stage: style, layout, main-thread-task
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: medium. Two systems that each read and write the same element's layout (for example a FLIP helper plus a CSS transition, or a drag library plus a resize handler) force layout inside the frame and fight over the final value.
- Do: Pick one owner per animated element and property: CSS or WAAPI for declarative motion, or one rAF loop for data-driven motion. Remove the other writers. Every rAF loop needs an exit (target reached, element disconnected, tab hidden, chart frozen) and a cancel on teardown. Do all reads of a frame before all writes.
- Why: The ibelick motion skill lists "no requestAnimationFrame loops without a stop condition" and "do not mix multiple animation systems that each measure or mutate layout" among its critical rules. The mechanism is forced synchronous layout (web.dev): a style write followed by a geometry read in the same task makes the browser run style and layout at once. When two independent systems do this, their reads and writes interleave.
- Example:
  ```js
  // Before: a CSS transition animates `height` while a JS loop reads offsetHeight each frame.
  // After: one owner (the JS loop), transform only, and an exit condition.
  function slideTo(el, targetY) {
    let y = 0, id = 0;
    const step = () => {
      if (!el.isConnected) return;                       // exit: removed
      y += (targetY - y) * 0.25;
      el.style.transform = `translateY(${y}px)`;
      if (Math.abs(targetY - y) > 0.5) id = requestAnimationFrame(step); // exit: arrived
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);               // exit: teardown
  }
  ```
- Avoid/caveats: SciChart owns its own render loop. Do not add a second rAF loop that redraws the same surface, and use `freezeWhenOutOfView` and suspend (13-scichart.md) to stop it. A loop that is not running costs nothing, so stop loops instead of throttling them.
- Status: Guidance. `requestAnimationFrame`/`cancelAnimationFrame` Baseline widely available.
- Sources: https://github.com/ibelick/ui-skills/blob/main/skills/fixing-motion-performance/SKILL.md, https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing

### Ship every chart with an error path, a teardown path and a test fixture at production scale
- Layer: js, tooling
- Stage: gpu-draw, gc-memory, script-run
- Metrics: FPS/smoothness, memory, startup
- When: testing, long-lived session
- Impact: high. Code written only for the happy path passes a 10-point demo and fails in production: blank charts without WebGL, leaked engines after navigation, and frame drops at real data sizes.
- Do: For each chart component, write three things. (1) Error path: catch creation failure (no WebGL2, Wasm load error, context loss) and show a visible fallback (see the SwiftShader item). (2) Teardown path: `surface.delete()` on unmount (13-scichart.md:528), cancel loops, unsubscribe feeds. Test it by mounting and unmounting 20 times. (3) Fixture: seeded, deterministic data at the size and rate of the busiest real view (for example 1,000,000 points history plus the peak tick rate). Keep a smaller fixture only for unit tests.
- Why: The Mapbox skill names this agent default: first-pass code "often ships" with no error handler, no `remove()` call, and a tiny data set that never exercises the heavy path. It asks for error visibility, teardown and realistic scale. Performance cliffs (resampling thresholds, buffer growth, GC pauses) appear only at real sizes.
- Example:
  ```ts
  // Deterministic fixture: same data every run, production scale
  function makeTicks(n = 1_000_000, seed = 42) {
    let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const x = new Float64Array(n), y = new Float64Array(n);
    for (let i = 0, p = 100; i < n; i++) { x[i] = 1_700_000_000 + i; p += (rnd() - 0.5) * 0.1; y[i] = p; }
    return { x, y };
  }
  ```
- Avoid/caveats: Large fixtures make unit tests slow. Run them in a separate browser or performance suite. Name the fixture size in the test so that a reader sees the scale.
- Status: Guidance.
- Sources: https://github.com/mapbox/mapbox-agent-skills/blob/main/skills/mapbox-web-performance-patterns/SKILL.md

### Prove a leak fix by slope: repeat N times with a forced GC, fit a line, and fail above a growth threshold
- Layer: tooling
- Stage: gc-memory
- Metrics: memory
- When: testing, long-lived session
- Impact: high. A before/after snapshot pair cannot tell a leak from a warm cache. Growth per repetition can.
- Do: Run the operation (mount/unmount a chart, subscribe/unsubscribe a symbol, open/close a panel) N = 10-20 times. After each repetition, force GC and sample the JS heap and the DOM counters. Fit a least-squares line and fail when the slope is above a threshold per repetition. As starting values, we suggest 50 KB of heap and 0 DOM nodes and 0 listeners per chart mount (our proposal, not from a source; tune them). Drop the first 1-2 samples (warm-up). Keep the 14:309 snapshot compare (baseline, x10, compare) for finding the retainer after the slope shows a leak.
- Why: The VS Code memory-leak-audit skill verifies fixes this way: its chat leak checker forces GC between messages and runs a linear regression on heap and DOM samples, and it treats a slope above 2 MB per message as a leak. In Chrome, force GC with CDP `HeapProfiler.collectGarbage` (or `Memory.prepareForLeakDetection`, which also drops internal caches). Read nodes and listeners with `Memory.getDOMCounters` (`documents`, `nodes`, `jsEventListeners`; the Memory domain is experimental). On desktop, `performance.memory.usedJSHeapSize` is precise: Blink uses the precise mode when the process is locked to a site, and caches values for 50 ms. Without site isolation (most Android) it is bucketed and cached for 20 minutes (Blink `memory_info.cc`, `window_performance.cc`). In the MCP browser, a test allocation of 8.06 MB showed up in `performance.memory` 60 ms later, but `gc` was not exposed.
- Example:
  ```js
  // Playwright + CDP (Chromium)
  const cdp = await page.context().newCDPSession(page);
  const samples = [];
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.__scenario.mountUnmountChart());
    await cdp.send('HeapProfiler.collectGarbage');
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');
    const { nodes, jsEventListeners } = await cdp.send('Memory.getDOMCounters');
    samples.push({ i, usedSize, nodes, jsEventListeners });
  }
  const slope = (key) => { const s = samples.slice(2), n = s.length, mx = s.reduce((a, p) => a + p.i, 0) / n,
    my = s.reduce((a, p) => a + p[key], 0) / n;
    return s.reduce((a, p) => a + (p.i - mx) * (p[key] - my), 0) / s.reduce((a, p) => a + (p.i - mx) ** 2, 0); };
  expect(slope('usedSize')).toBeLessThan(50_000);
  expect(slope('nodes')).toBeLessThanOrEqual(0.5);
  ```
- Avoid/caveats: SciChart's Wasm memory is not in the JS heap. Also sample the Wasm memory size where the library exposes it, or use the process memory from `performance.measureUserAgentSpecificMemory()` (needs cross-origin isolation, Chromium only). With the MCP server alone there is no GC call: start Chrome with `--chromeArg=--js-flags=--expose-gc` and call `gc()` in `evaluate_script`, or use `take_heapsnapshot`, which forces GC but is slow. Never sample inside a performance trace.
- Status: CDP `HeapProfiler.collectGarbage` and `Memory.getDOMCounters` (Chromium only; the Memory domain is experimental). `performance.memory` is non-standard and Chromium only. `Runtime.getHeapUsage` is experimental.
- Sources: https://github.com/microsoft/vscode/blob/main/.github/skills/memory-leak-audit/SKILL.md, https://chromedevtools.github.io/devtools-protocol/tot/Memory/, https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/timing/memory_info.cc, https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/timing/window_performance.cc

### Gate interactions in CI with per-interaction budgets: no LoAF over 50 ms, frame gap under 75 ms, non-input CLS under 0.02
- Layer: tooling
- Stage: main-thread-task, layout, composite
- Metrics: INP, CLS, FPS/smoothness
- When: testing, build
- Impact: medium. The 15:498 budget item covers size, LCP and INP only. Chart jank happens during scripted interactions (zoom, symbol switch, tick burst), and INP alone does not show it.
- Do: For each scripted interaction, collect `long-animation-frame` entries (fail on any over 50 ms, and log `scripts[].sourceURL` and `invoker`), rAF intervals (fail when the largest gap is 75 ms or more), `layout-shift` entries with `hadRecentInput === false` (fail when the sum is 0.02 or more), and the INP of the interaction (fail at 200 ms or more). Start in report-only mode. Turn a budget into an assertion only after the interaction is stable.
- Why: The dejank skill proposes these starting budgets: CLS under 0.02 per interaction (stricter than the 0.1 field threshold), INP under 200 ms, 0 LoAF over 50 ms (at most 1 tolerated), and a max frame gap under 75 ms, "~4 dropped frames at 60fps". LoAF attributes the blocking script, which INP alone does not.
- Example:
  ```js
  // page.evaluate before the interaction; read window.__probe after it
  window.__probe = { loaf: [], cls: 0, maxGap: 0 };
  new PerformanceObserver((l) => l.getEntries().forEach((e) => e.duration > 50 &&
    __probe.loaf.push({ d: e.duration, s: e.scripts.map((x) => x.sourceURL) }))).observe({ type: 'long-animation-frame' });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) __probe.cls += e.value; }))
    .observe({ type: 'layout-shift' });
  let last = performance.now();
  (function tick(t) { __probe.maxGap = Math.max(__probe.maxGap, t - last); last = t; requestAnimationFrame(tick); })(last);
  ```
- Avoid/caveats: LoAF and `layout-shift` are Chromium only. In Firefox and Safari, only the frame-gap and Event Timing parts work. At 120 Hz, 75 ms is about 9 missed frames, so tighten it for high-refresh targets. CI machines are noisy: use several runs and compare against the base branch.
- Status: `PerformanceLongAnimationFrameTiming` Chrome 123 (experimental, BCD). `LayoutShift` Chrome 77 only. `PerformanceEventTiming.interactionId` Chrome 96, Firefox 144, Safari 26.2.
- Sources: https://github.com/gbasin/dejank/blob/main/references/tooling-and-signals.md, raw/bcd.json

### Report measured numbers only: label code-reading findings as hypotheses, and state device, browser and throttling for every number
- Layer: tooling
- Stage: main-thread-task
- Metrics: INP, LCP, CLS, FPS/smoothness
- When: testing
- Impact: medium. Agents often write "now runs at 60 fps" or "GPU accelerated, so smooth" without a run. Such claims hide regressions and waste review time.
- Do: Tag each finding as `measured` (with tool, device, browser version, CPU and network throttling, run count) or `hypothesis` (from reading code, with the exact command or trace that would verify it). Never write "60 fps", "no jank" or "GPU accelerated" without a recorded run. Keep lab, field and single-session numbers apart.
- Why: Addy Osmani's web-performance-auditor agent says "Never fabricate metrics". It marks the scorecard `not measured` when no tool data exists, and it tags static findings as `potential impact`. The web-quality-skills performance skill says that when no page can run, findings are hypotheses and each high-impact one needs a verification command. Part F of this file shows why the conditions matter: the same `console.timeStamp` loop cost 30 times more with an inspector attached, and headless Chrome used the real GPU on a Mac.
- Example:
  ```text
  measured: INP 227 ms (input delay 0.6, processing 200, presentation 26) —
    Chrome 153.0.8010.53, macOS M4 Max, headed, no throttling, MCP trace, 1 run
  hypothesis: `renderRows()` reads offsetHeight after writing styles (layout thrash) —
    verify: MCP trace of "type in symbol search", check ForcedReflow insight
  ```
- Avoid/caveats: None. It costs a few lines per report.
- Status: Guidance.
- Sources: https://github.com/addyosmani/agent-skills/blob/main/agents/web-performance-auditor.md, raw/18-skills-survey-github/addy/skills_performance_SKILL.md (web-quality-skills)

---

## F. Chrome DevTools MCP verification results (gap 12)

### Measure INP in MCP with `click` inside a manual trace, and check handlers on every event of the interaction
- Layer: tooling
- Stage: main-thread-task
- Metrics: INP
- When: testing
- Impact: medium. This confirms the 14 INP recipe with a live run. Before, it rested on source reading only.
- Do: Navigate first. Call `performance_start_trace` with `reload: false, autoStop: false`, then `take_snapshot`, `click` on the uid, wait about 2 s, and call `performance_stop_trace`. Then call `performance_analyze_insight` with `INPBreakdown`.
- Why: Live run (Chrome 153, test page `gpu.html`, a 200 ms busy `click` handler): the trace summary gave "INP: 227 ms". The insight split it into input delay 0.6 ms, processing 200 ms and presentation delay 26 ms, and called it "a `pointerdown`" although the handler listened to `click`. The pointer events and the click share one `interactionId`, so look for handlers on `pointerdown`, `pointerup` and `click`.
- Avoid/caveats: One run on a fast machine with no throttling. Add `emulate` with `cpuThrottlingRate` for realistic numbers.
- Status: chrome-devtools-mcp as installed in this session. Chrome 153.0.8010.53.
- Sources: raw/gapfill-round-2/mcp-test/gpu.html, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md

### Do not read frame rate or GPU time from the MCP trace summary; use an in-page frame probe and the saved trace
- Layer: tooling
- Stage: gpu-draw, composite
- Metrics: FPS/smoothness
- When: testing
- Impact: high for chart work. The summary of a render-loop trace looks clean even when frames drop.
- Do: For render loops, measure frame intervals in the page (rAF deltas: p50, p95, max) with `evaluate_script`. Also save the raw trace with `filePath` for GPU work, and open it in DevTools or Perfetto. Save it inside the MCP roots (see next item).
- Why: Live run: a 15 s trace of a WebGL2 loop (200,000-point line strip plus a heavy full-screen fragment shader, 120 Hz) produced a summary with URL, bounds, throttling, INP, CLS, one insight and a "# Custom tracks" section (it listed the `console.timeStamp` group "Test app" and track "Chart render"). It had no frame, FPS or GPU data. The in-page probe gave frame p50 8.3 ms, p95 10.2 ms and max 191.8 ms (the max is the 200 ms click). `PerformanceTraceFormatter.ts` has no GPU code path (grep). The GPU data is in the raw trace: `GPUTask` is emitted with `TRACE_DISABLED_BY_DEFAULT("devtools.timeline")` in Chromium `gpu/ipc/service/command_buffer_stub.cc`, and `disabled-by-default-devtools.timeline` is in DevTools `DefaultCategories`, which MCP uses. A Chrome trace recorded from Bash with that category (headless Chrome 153, 5 s of the same page) held 747 `GPUTask` events on "GPU Process / CrGpuMain", each with `renderer_pid` and `used_bytes` (p50 97 µs, p95 359 µs, max 11.4 ms, total 132.8 ms). This closes the round-1 open point "category of `GPUTask` not located".
- Avoid/caveats: `GPUTask` measures command-buffer work on the GPU process's main thread (CPU time). It is not the GPU hardware's shader time. For shader time, use timer queries (10, 11). I could not save an MCP trace file in this session (next item), so the `GPUTask` count comes from a Chrome trace recorded outside MCP with the same category, not from an MCP file.
- Status: chrome-devtools-mcp main (08b5e59), devtools-frontend main, Chromium main (2026-09-23).
- Sources: https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/ai_assistance/data_formatters/PerformanceTraceFormatter.ts, https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/types/TraceEvents.ts, https://chromium.googlesource.com/chromium/src/+/main/gpu/ipc/service/command_buffer_stub.cc, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/performance.ts

### Save MCP traces inside the client's workspace roots; paths elsewhere are refused
- Layer: tooling
- Stage: main-thread-task
- Metrics: FPS/smoothness
- When: testing
- Impact: low to medium. Without this, the "save the raw trace" advice fails.
- Do: Give `filePath` a path inside the project that the MCP client announced as a root, in a gitignored folder (for example `.perf/traces/run-03.json.gz`). When the client does not announce roots, the server allows only the OS temp directory unless it starts with `--workspace <dir>` (alias of `--filesystemRoot`). `--allowUnrestrictedPaths` is deprecated ("Use --workspace=/ instead").
- Why: Live run: `performance_stop_trace` with a file path in the session scratchpad (`/private/tmp/...`) failed with "Access denied: path … is not within any of the configured workspace roots". The option texts are in `src/config/mcp-options.ts`.
- Avoid/caveats: Traces contain URLs, and screenshots when enabled. Do not commit them.
- Status: chrome-devtools-mcp main (08b5e59) and the build in this session.
- Sources: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/config/mcp-options.ts

### Do not trust DevTools network emulation for WebSocket latency; it throttles WebSocket bandwidth and the handshake, not the per-message round trip
- Layer: tooling, network
- Stage: network
- Metrics: INP, FPS/smoothness
- When: testing
- Impact: medium for a trading terminal. Under "Slow 3G", a quote stream still arrives with about 60 ms of added round-trip time, not 2 s, so lab runs look more responsive than a real slow network.
- Do: Use MCP `emulate` `networkConditions` to test WebSocket throughput and connection setup. To test per-message latency and jitter, add the delay at the server or in a proxy (for example a replay server with a configurable delay), and document which one you used.
- Why: Live run through MCP (Chrome 153, local HTTP and WebSocket server, 5 pings, then a burst of 20 messages of 10 KB = 200 KB):

  | Emulation | `fetch` 4 KB | WS open | WS ping RTT | 200 KB WS burst |
  |---|---|---|---|---|
  | none | 3 ms | 4 ms | 0-1 ms | 3 ms |
  | Fast 4G | 180 ms | 176 ms | 6-12 ms | 304-316 ms |
  | Slow 3G | 2,097 ms | 2,029 ms | 58-70 ms | 6,063 ms |

  The handshake is an HTTP request and gets the full latency. The frames get the bandwidth limit (about 33 KB/s under Slow 3G). The per-request latency is not added to each message. DevTools added WebSocket throttling in Chrome 99 (Chromium issue 423246). The post does not say which parts are throttled.
- Avoid/caveats: One run per condition on localhost. The exact per-frame delay model is not documented, so this is an observation, not a specification.
- Status: Chrome 99+ throttles WebSockets (DevTools 99 post). Behavior observed on Chrome 153.0.8010.53.
- Sources: https://developer.chrome.com/blog/new-in-devtools-99, raw/gapfill-round-2/mcp-test/ws.html, raw/gapfill-round-2/mcp-test/server.py

### Enable WebMCP tools with `--categoryExperimentalWebmcp` and Chrome 150+ with `--enable-features=WebMCP`
- Layer: tooling
- Stage: script-run
- Metrics: INP
- When: testing
- Impact: low. It resolves the flag conflict that 14:781-792 and 15-gaps-round-1.md:838-850 listed.
- Do: Start the server with `--categoryExperimentalWebmcp --chromeArg=--enable-features=WebMCP`. Do not use `--categoryWebMCP`.
- Why: `src/tools/categories.ts` defines `WEBMCP = 'experimentalWebmcp'`. `src/config/category-options.ts` builds each flag as `` `category${Capitalize<T>}` ``, so the flag is `--categoryExperimentalWebmcp`, and it is off by default. Its description says: "Requires Chrome 150+ with the following flag: `--enable-features=WebMCP`".
- Avoid/caveats: The DevTools doc spelling `--categoryWebMCP` does not match the source. Trust the source.
- Status: chrome-devtools-mcp main (08b5e59, 2026-09-23), npm 1.10.1.
- Sources: https://raw.githubusercontent.com/ChromeDevTools/chrome-devtools-mcp/main/src/tools/categories.ts, https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/config/category-options.ts

---

## Status fixes

Survey rules that now have items:

| Survey rule | Now covered by | Status |
|---|---|---|
| web #13 leak proof by slope | "Prove a leak fix by slope…" (E) | CDP `HeapProfiler.collectGarbage`, `Memory.getDOMCounters` (experimental domain), `Runtime.getHeapUsage` (experimental): Chromium only. `performance.memory`: non-standard, Chromium only, precise on site-isolated desktop (50 ms cache), bucketed with a 20 min cache elsewhere. |
| web #15 one animation owner, rAF stop condition | "Give each element one animation owner…" (E) | Guidance. rAF Baseline widely available. |
| web #20 error path, teardown, realistic scale | "Ship every chart with an error path…" (E) and the SwiftShader item (B) | Guidance. SciChart 5.2.69 throws without WebGL2. Chrome 139+ has no SwiftShader fallback. |
| github #17 per-interaction CI budgets | "Gate interactions in CI…" (E) | LoAF Chrome 123 (experimental). `layout-shift` Chrome 77 only. `interactionId` Chrome 96, Firefox 144, Safari 26.2. |
| github #18 metric honesty | "Report measured numbers only…" (E) | Guidance. |

Status lines to change in files without a verify pass:

| File:line | Change the Status to |
|---|---|
| 07-js-web-apis.md:813 | "`deviceMemory` Chromium only (63+; workers 65). From Chrome 147: 2/4/8/16/32 on desktop, 1/2/4/8 on Android (before: 0.25-8). `hardwareConcurrency` Baseline 2022. `cpuPerformance` Chrome 152 only, experimental." |
| 16-explore-fast-batch-03.md (the `sizes="auto"` item Status, near :128) | "Chrome 126, Firefox 150, Safari 27.0 (WebKit post 2026-09-17; BCD 8.1.2 lags). Not Baseline." |
| 16-explore-fast-index.md:213 | "Fetch Priority: Chrome 101 (attribute and `fetch()` priority), Chrome 103 (`Link` header), Firefox 132, Safari 17.2. Baseline newly available 2024-10-29." |
| 16-explore-fast-batch-05.md:57 and 16-explore-fast-batch-02.md:487 | Keep the Baseline part. Add "unused preconnected socket closed after about 60 s in Chromium `main`". |
| 07-js-web-apis.md:375 | "`unload` deprecated in Chrome; at 100% of page loads from Chrome 154 (2026-09-22)." |

---

## Sources read
- https://chromium.googlesource.com/chromium/src/+/main/net/socket/client_socket_pool_manager.cc
- https://www.w3.org/TR/device-memory/ (WD 2026-03-30)
- https://chromestatus.com/feature/6330376953921536 (API JSON)
- raw/bcd.json (BCD 8.1.2) and raw/web-features.json: deviceMemory, Sec-CH-Device-Memory, anchor positioning keys, highlight, move-before, constructed-stylesheets, console.timeStamp_static, StaticRange, performance entry types, requestIdleCallback, scheduler, popover
- verify/01-04 cross-file conflict sections
- https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Anchor_positioning/Using
- https://developer.chrome.com/blog/anchor-positioning-api
- https://drafts.csswg.org/css-anchor-position-1/ (WD 2026-09-06)
- https://github.com/GoogleChrome/modern-web-guidance (repo page) and raw `skills/modern-web-guidance/guides/ui-atoms/resilient-context-menus-and-nested-dropdowns.md`
- https://webkit.org/blog/18325/webkit-features-for-safari-27-0/
- https://webkit.org/blog/18136/introducing-the-safari-mcp-server-for-web-developers/
- https://react.dev/reference/react/useInsertionEffect
- https://github.com/reactwg/react-18/discussions/110
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/css_style_sheet.cc
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/style_engine.cc
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/active_style_sheets.cc
- https://web.dev/articles/constructable-stylesheets
- https://developer.chrome.com/docs/devtools/performance/extension
- https://developer.chrome.com/blog/chrome-134-beta
- https://chromestatus.com/feature/5202800863346688 (API JSON)
- https://github.com/explainers-by-googlers/expect-no-linked-resources (README)
- https://api.github.com/repos/whatwg/html/pulls/10718
- https://groups.google.com/a/chromium.org/d/msgid/blink-dev/6759101e.2b0a0220.23f11c.0000.GAE%40google.com (via WebFetch summary)
- https://developer.mozilla.org/en-US/docs/Web/API/Element/moveBefore
- https://developer.chrome.com/blog/movebefore-api
- https://dom.spec.whatwg.org/ ("move" and `moveBefore()`)
- https://api.github.com/repos/WebKit/standards-positions/issues/375, https://api.github.com/repos/web-platform-tests/interop/issues/1355
- https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API
- https://drafts.csswg.org/css-highlight-api-1/, https://drafts.csswg.org/css-pseudo-4/
- https://css-tricks.com/css-custom-highlight-api-early-look/ (blog), https://frontendmasters.com/blog/using-the-custom-highlight-api/ (blog)
- https://chromestatus.com/feature/5166674414927872 (API JSON)
- https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM (via WebFetch summary)
- https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md
- https://chromium.googlesource.com/chromium/src/+/main/components/policy/resources/templates/policy_definitions/Miscellaneous/EnableUnsafeSwiftShader.yaml
- https://raw.githubusercontent.com/puppeteer/puppeteer/main/packages/puppeteer-core/src/node/ChromeLauncher.ts
- chrome-devtools-mcp main: src/BrowserManager.ts, src/config/browser-options.ts, src/config/mcp-options.ts, src/config/category-options.ts, src/tools/categories.ts, src/tools/performance.ts, src/bin/chrome-devtools.ts; https://registry.npmjs.org/chrome-devtools-mcp/latest
- devtools-frontend main: mcp/mcp.ts, front_end/models/trace/types/TraceEvents.ts, front_end/models/ai_assistance/data_formatters/PerformanceTraceFormatter.ts
- https://chromium.googlesource.com/chromium/src/+/main/gpu/ipc/service/command_buffer_stub.cc
- https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json and js_protocol.json
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/timing/memory_info.cc and window_performance.cc
- https://developer.chrome.com/blog/new-in-devtools-99
- https://www.scichart.com/documentation/js/v5/2d-charts/chart-synchronization-api/synchronizing-multiple-charts/ (via WebFetch summary)
- scichart 5.2.69 on jsDelivr: Charting/Visuals/Axis/AxisCore.js, Core/NumberRange.js, Charting/LayoutManager/SciChartVerticalGroup.js, SynchronizedLayoutManager.js, Charting/Visuals/SciChartSurface.js, SciChartSurfaceBase.js, Charting/Services/SciChartRenderer.js, Core/Mouse/MouseManager.js, Charting/Visuals/Axis/AxisBase2D.d.ts, Core/WebGlHelper.js, Charting/Visuals/sciChartInitCommon.js, Charting/Visuals/createMaster.js, index.d.ts
- https://github.com/ABTSoftware/SciChart.JS.Examples (MultiPaneStockCharts/drawExample.ts)
- https://github.com/mozilla/firefox-devtools-mcp (README, docs/tools.md), https://firefox-source-docs.mozilla.org/ai-agent-tools/firefox-devtools-mcp.html, https://registry.npmjs.org/@mozilla/firefox-devtools-mcp/latest
- https://raw.githubusercontent.com/addyosmani/agent-skills/main/agents/web-performance-auditor.md
- Saved copies in raw/18-skills-survey-web/ (ibelick-fixing-motion-performance.md, mapbox-web-performance-patterns.md, vscode-memory-leak-audit.md) and raw/18-skills-survey-github/ (dejank/tooling.md, addy/*)
- https://web.dev/articles/lcp, https://developer.chrome.com/docs/web-platform/deprecating-unload, https://developer.chrome.com/docs/web-platform/bfcache-ccns (via WebFetch summary)
- Search results only (not read as pages): SciChart forum "Multiple synchronised charts are laggy" snippet; MoldStud and Savvy grid-performance blogs; Chromium issue 41258601 (read only as issue-tracker JSON: title, dates, component)

## Not covered / could not access
- The SciChart forum thread returned HTTP 403 to curl and WebFetch. Its advice is known only from a search snippet. The 5.2.69 source was used instead.
- I could not save an MCP trace file: the MCP roots are the project repository, and this task forbids writing there. The `GPUTask` evidence comes from a Chrome startup trace with the same category, recorded outside MCP.
- The SwiftShader and headless tests ran on macOS only. Linux (the usual CI) and Windows (where chromestatus mentions a WARP experiment) were not tested. Two flag combinations gave results that I cannot explain.
- The EnableUnsafeSwiftShader policy page on chromeenterprise.google did not render in WebFetch. The policy YAML in the Chromium source was read instead.
- The blink-dev threads were read through WebFetch summaries only (API-owner discussion may be incomplete). The Intent to Ship for `expect-no-linked-resources` showed no LGTM in the summary, but chromestatus and the Chrome 134 beta post show it shipped.
- I did not verify that `Link` preload headers and 103 Early Hints still work under `expect-no-linked-resources`.
- How Firefox and Safari handle the extra `console.timeStamp` arguments was not tested.
- The benchmarks (style injection, grid tracks, highlights, `moveBefore`, `console.timeStamp`) ran once or a few times on one fast desktop in Chrome 153 only. No Firefox or Safari runs, and no traces for attribution.
- The Safari MCP and Firefox DevTools MCP servers were not run in this session (not installed as tools here). The items come from the vendor posts, README and tool docs. The Apple developer documentation page linked from the WebKit post was not read.
- The bfcache and WebSocket question stays open: the Chrome bfcache-ccns doc (updated 2025-09-09) still lists WebSocket use as a blocker for `no-store` pages, while verify/03 cites a blink-dev PSA (M148) that Chrome now closes WebSockets on bfcache entry. These may apply to different cases. I did not resolve this (16-explore-fast-batch-02.md:309, 17-collections-batch-01.md:365-366).
- 08-v8-batch-01.md:278 ("Chrome 147 added homomorphic ICs") differs from 09-v8-consolidated.md:152 (behind a flag, off by default). 09 is the consolidated file. I did not check the V8 source again.
- Whether "[Violation]" console entries reach `list_console_messages`, and whether `SlowCSSSelector` can appear in MCP traces, are still not verified (14 open list).
