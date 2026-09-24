# Rendering pipeline: first bytes to pixels, and each frame after load

Open this when you need the mechanism behind a rule: which stage a change costs, where a callback runs in a frame, what a DevTools event or insight means, or which stage a metric part points to.
This file holds no rules. Each stage card in §H names the rule files to open. Scope: Chromium (Chrome and Edge). Where Chromium behavior changed between releases, the text names a key in `support.md`, which holds the versions.

## §0 How to use this file

Find the question, then read only that section. §A: which thread does the work. §B: what blocks the first render, and the code that controls each phase. §C: the order of one frame after load. §D: where tasks, microtasks, rAF, observers and idle callbacks run. §E: whether a CSS change costs layout, paint or only composite. §F: reads that force style or layout. §G: which stages a metric or a metric part points to. §H: one card per stage (what runs, what blocks it, trace events, insights, budget, wrong beliefs, rule files). §I: a DevTools insight name. §J: the 13 stage tags and greps by stage.

## §A Threads and processes (Chromium)

| Thread or process | Pipeline work | Note |
|---|---|---|
| Renderer main thread (one per renderer process) | Script, event dispatch, hit test, HTML and CSS parse, style, layout, pre-paint, paint (display lists), layerize, commit; rAF, ResizeObserver, intersection computation | A long task here delays input handling and the next frame |
| Compositor thread (one per renderer process) | Gets input first; scrolls; runs compositor animations by changing property trees; schedules raster and decode; activates the committed tree; builds compositor frames | Scroll and compositor animations go on while the main thread is busy, unless a non-passive `touch*` or `wheel` listener covers the input point |
| Raster and decode worker threads | Raster tasks, image decode, paint worklets (also some `background-color` and `clip-path` animations, §E) | GPU raster uses one worker at a time; decodes run in parallel |
| GPU process: GPU main thread | GPU raster of tiles; runs WebGL and WebGPU command buffers (`GPUTask` in a trace) | Its CPU time is not the GPU's shader time |
| GPU process: display compositor | Joins the compositor frames of all renderers and the browser UI, then draws them | — |
| Dedicated workers | Script with their own event loop; rAF for `OffscreenCanvas` | They reach the main thread only through messages, which arrive as tasks |
| Network service (its own process on desktop) | All requests, also those of the preload scanner | — |
| Browser process | Receives raw input and routes it to the renderer | — |

## §B Initial load: 12 phases from navigation to first pixels

| # | Phase (tag) | Blocked by | Code that controls it | DevTools event, insight | Rules in |
|---|---|---|---|---|---|
| 1 | Navigation, TTFB (`network`) | Redirects, DNS, TCP and TLS, server time, no compression, cache miss, service worker start | Links to final URLs, streamed HTML with an early head flush, 103 Early Hints, `preconnect`, service worker routes | Network track, document row; `DocumentLatency` | html-loading.md |
| 2 | HTML parse (`parse`) | Parser-blocking classic scripts, which also wait for the stylesheets above them; a late `<meta charset>` (re-parse); `document.write` | Tag order and attributes; streamed server HTML | "Parse HTML"; gaps between parse chunks mean a blocked parser; `CharacterSet` | html-loading.md |
| 3 | Preload scanner (`parse`) | It reads only markup. It misses JS-inserted tags, `data-src`, CSS backgrounds, fonts and `@import` inside CSS files, client-rendered markup, `import()`. Large inline blobs delay it | Critical resources as plain tags; `rel=preload` and `modulepreload` for late ones | Network track: start time, initiator, priority; `LCPDiscovery`, `NetworkDependencyTree` | html-loading.md, html-media-and-fonts.md |
| 4 | CSSOM and fonts (`cssom`) | Stylesheets in `<head>` with a matching `media` block render and later scripts; the CSSOM is not incremental; `@import` chains; first paint also waits for `<body>`; web fonts hide text or swap it later | Size, count, `media` and place of each stylesheet; no `@import`; `font-display`; font preload | "Parse stylesheet"; render-blocking mark on network rows; `RenderBlocking`, `FontDisplay` | html-loading.md, html-media-and-fonts.md |
| 5 | Script load (`script-load`) | Download; compile (streamed off the main thread for external scripts); evaluation on the main thread, one task per classic script. `async` runs when fetched, in any order. `defer` and `type=module` run after parsing, in order, before `DOMContentLoaded`; current Chromium runs each one in its own task (`separate-defer-module-tasks`) | `<script>` attributes, bundle split, `import()`, `fetchpriority`, `modulepreload` | "Compile script", "Compile module", "Evaluate script", "Evaluate module", "Streaming compile task"; `LegacyJavaScript`, `DuplicatedJavaScript` | html-loading.md |
| 6 | Style (`style`) | A render-blocked document; cost grows with elements × rules and with the width of invalidation | Selectors, DOM size, where classes change | "Recalculate style" | css-rendering.md |
| 7 | Layout (`layout`) | Style; DOM size; forced layout from script reads | DOM size, layout modes, sizes of images and embeds, containment | "Layout"; `DOMSize`, `CLSCulprits` | css-rendering.md, js-dom-and-lists.md |
| 8 | Pre-paint and paint (`paint`) | Layout | Blur, shadows, filters, paint area | "Pre-paint", "Paint" | css-rendering.md |
| 9 | Layerize and commit (`composite`) | Paint. Commit hands the frame to the compositor; the main thread waits for it only in frames that answer input (`non-blocking-commit`) | `will-change`, compositor animations, canvas and video (own layers) | "Layerize", "Commit" | css-rendering.md |
| 10 | Raster and image decode (`paint`) | Commit; image decode is the most expensive part of raster | Image size and format; layer count and size | "Rasterize paint", "Image decode" (thread pool) | html-media-and-fonts.md, css-rendering.md |
| 11 | Activate, aggregate, draw (`composite`, `gpu-draw`) | Every tile that the frame needs must be rastered | Filters and blend modes add render passes | GPU track, Frames track | css-rendering.md, gpu-webgl-webgpu.md |
| 12 | Display (`gpu-draw`) | Vsync. Paint Holding keeps the old page on screen until the new page's FCP or a 500 ms timeout (`paint-holding`) | None directly | Screenshots; Timings track (FP, FCP, LCP, DCL, L) | — |

The first render waits for the start of the HTML, render-blocking CSS in `<head>` and parser-blocking scripts in `<head>`. It does not wait for the rest of the HTML, images, fonts (text waits or swaps), `async` and deferred scripts, CSS with a non-matching `media`, or CSS in `<body>` (that CSS blocks only the parser below it).

## §C The update frame, in spec order

A rendering opportunity follows the display refresh: about 16.7 ms at 60 Hz, 8.3 ms at 120 Hz. Read the real rate from rAF deltas. Under load the browser can drop to 30 frames per second; a hidden page gets a few or none. A frame is skipped when the page is hidden or render-blocked, or when nothing changed and no rAF callback waits.

| Step | Thread | What runs, and its trigger | Code that controls it | Trace event | Tag |
|---|---|---|---|---|---|
| 0 Input arrives | browser, then compositor | The compositor scrolls at once, unless a non-passive `touch*` or `wheel` listener covers the point: then it waits for the main thread | Listener `passive`, `touch-action` | Interactions track | `tasks` |
| 1 Compositor-only work | compositor | Scroll; declared animations of compositor properties (§E); no main thread needed | CSS, `element.animate()` | Animations track (a red mark names why an animation is not composited) | `composite` |
| 2 Tasks | main | Discrete input (`pointerdown`, `keydown`, `click`) dispatches at once. Continuous input (`pointermove`, `mousemove`, `touchmove`, `wheel`) is coalesced and dispatched just before rAF. Socket and worker messages and timers are tasks too. Microtasks run after each callback | Handlers, timers, data feeds | "Event", "Timer fired", "Receive WebSocket message", "Run microtasks" | `tasks`, `js` |
| 3 Resize, scroll, media queries | main | `resize` and `scroll` events fire here, once per frame | Listeners | "Event" | `js` |
| 4 Animations | main | CSS transitions and animations, WAAPI; animation events | CSS, WAAPI | Animations track | `style` |
| 5 rAF callbacks | main | Every callback registered before this frame, after the event handlers; microtasks after each | `requestAnimationFrame` | "Animation frame fired" | `tasks`, `js` |
| 6 Style and layout | main | Dirty style and layout; `content-visibility: auto` checks | CSS, DOM writes | "Recalculate style", "Layout" | `style`, `layout` |
| 7 ResizeObserver | main | After layout, before paint. A callback that changes layout makes style and layout run again. Each round delivers only targets deeper than the last; a skipped target reports "ResizeObserver loop completed with undelivered notifications" and waits for the next frame | Observer callbacks | "Function call" after "Layout" in the same frame | `layout` |
| 8 Focus fix-up, view transitions | main | Focus repair; view transition steps | View transitions | — | `style` |
| 9 Intersection observation | main | Computed here; the callback comes in a later task, after this frame | Observer targets | "Compute intersections" | `layout` |
| 10 Paint | main | Pre-paint, paint, layerize, commit | Paint cost of CSS; layers | "Pre-paint", "Paint", "Layerize", "Commit" | `paint`, `composite` |
| 11 Raster, activate | raster workers, compositor | Tiles and decodes; slow raster makes the compositor draw without the newest commit (high-latency mode) | Layer count, image size | "Rasterize paint", "Image decode" | `paint` |
| 12 Draw, present | GPU process | Joins and draws the frames | Render passes | Frames track: green on time, yellow partly presented, red dropped | `gpu-draw` |

Canvas and GPU work in this frame: Canvas 2D calls in a rAF callback are main-thread script. WebGL and WebGPU calls are validated in the calling task and run in the GPU process. A canvas is its own composited layer. A WebGL canvas presents its drawing buffer at the next composite, and only when something was drawn, the context was created or the canvas was resized.
Field view of one frame: Long Animation Frames split it into work before `renderStart`, rAF from `renderStart` to `styleAndLayoutStart`, then style and layout, which also hold ResizeObserver callbacks and the extra style and layout that they cause (a chart that redraws in ResizeObserver shows there as script); each script entry has `forcedStyleAndLayoutDuration` (`long-animation-frames`).

## §D Event-loop slots

One loop turn: run one task, drain all microtasks, then maybe run the rendering steps (§C). The browser chooses which task queue to serve, and input usually goes first, so do not depend on order across task sources.

| Slot | Filled by | Runs | Watch for |
|---|---|---|---|
| Task | Event dispatch, `setTimeout`, `MessageChannel`, `postMessage`, socket and worker messages, `scheduler.postTask()` | One at a time, to the end | A task over 50 ms is long: input and the next frame wait for all of it |
| Microtask | Promise reactions, `await`, `queueMicrotask()`, MutationObserver | Each time the JS stack empties: after each listener, each rAF callback and each task | The queue drains fully, new entries too, so a microtask chain blocks like sync code. It is not a yield. After a real click, microtasks run between listeners; after `el.click()`, only after all listeners |
| rAF | `requestAnimationFrame()` | Once per rendering opportunity, before style and layout | Stops in hidden tabs. Keep it to visual work |
| ResizeObserver | `new ResizeObserver()` | After layout, in the same frame | Sizes are fresh, so a read there forces nothing |
| IntersectionObserver | `new IntersectionObserver()` | Computed in the frame, delivered in a later task | Not for per-frame positioning; it does not see a hidden tab |
| Idle | `requestIdleCallback()` | After a frame, when no task waits; the deadline is at most 50 ms | It can wait a long time: give a `timeout`. It does not make an interaction shorter |
| Yield continuation | `await scheduler.yield()` (`scheduler-yield`) | A new task, ahead of other tasks of the same priority | A yield lets the browser render; it does not force a frame |
| Timer | `setTimeout(fn, 0)` | A timer task, after the tasks already queued | At least 4 ms after 5 nested levels. Hidden tab: aligned to 1 s, and after about a minute hidden, one wake-up per minute for timer chains |

Order check: when sync code schedules a `setTimeout`, a `requestAnimationFrame` and a `queueMicrotask` callback, the sync code finishes first, then the microtask runs, then the rAF callback and the timer run in either order: the next rendering opportunity decides.
"After the next paint" means `requestAnimationFrame(() => setTimeout(fn, 0))`, or a `MessageChannel` message posted from the rAF callback. The task is queued at the start of the frame, so it runs after the main thread finishes that frame's rendering work; the frame may not be on screen yet. A double rAF waits a whole frame and runs before the next paint. To choose a primitive for a job, read `js-scheduling-and-workers.md` §0.

## §E Property change → pipeline cost

Data: the `invalidate` field in Blink's `css_properties.json5`, plus `background-*` and `font-*`, which have no such field. A change restarts the pipeline at the first stage that it touches, and every later stage runs too.

| A change of | Runs | Properties |
|---|---|---|
| Geometry, text or display | style → layout → paint → composite | `width`, `height`, `margin-*`, `padding-*`, `border-*-width`, `top`, `left`, `inset`, `position`, `display`, flex and grid properties, `gap`, `line-height`, `font-*`, `letter-spacing`, `text-transform`, `text-shadow`, `overflow-*`, `contain`, `container-type`, `content-visibility` |
| Paint only | style → paint → composite | `color`, `background-*`, `box-shadow` (paint and visual overflow, no layout), `border-*-radius`, `outline-*`, `visibility`, `fill`, `stroke`, `object-fit`, `object-position`, `mix-blend-mode`, `isolation`, `z-index` (repaints its stacking context), `clip-path` (clip update plus paint) |
| Property trees only | style → composite | `transform`, `translate`, `rotate`, `scale`, `transform-origin`, `perspective`, `offset-path`, `offset-distance`, `opacity`, `filter`, `backdrop-filter`, `will-change`, `backface-visibility` |

On the compositor, with no main-thread work per frame, when declared as a CSS transition, CSS animation or `element.animate()`: `transform`, `translate`, `rotate`, `scale`, `opacity`, `filter` without pixel-moving functions (`blur()`, `drop-shadow()`), and `backdrop-filter`. Chromium also runs `background-color` and `clip-path` animations there through a native paint worklet, only under strict conditions (`composited-bg-color-animation`, `composited-clip-path-animation`).
The same properties written from script every frame still cost script, style and a commit each frame. Custom property animations run on the main thread. Every layer costs GPU memory; what creates one is in `css-rendering.md` §B. Old trigger tables are out of date: count Layout and Paint events in `scripts/trace-summary.mjs` instead.

## §F Reads that force style or layout

A read that returns layout data makes the engine bring style and layout up to date first. With nothing dirty it is cheap. After a DOM or style write in the same task, it is a forced synchronous layout; inside a loop, it is layout thrashing.

| Group | Reads and calls |
|---|---|
| Box metrics | `offsetLeft/Top/Width/Height/Parent`, `clientLeft/Top/Width/Height`, `getBoundingClientRect()`, `getClientRects()` |
| Scroll | `scrollWidth/Height`; reading or setting `scrollLeft/Top`; `scrollBy()`, `scrollTo()`, `scrollIntoView()` |
| Window | `window.scrollX/Y`, `innerWidth/innerHeight`, `visualViewport` sizes and offsets, `document.elementFromPoint()` |
| Pointer events | `offsetX/Y`, `layerX/Y` on mouse and pointer events |
| Focus and text | `focus()`, `select()`, `innerText`, `computedRole`, `computedName`, `Range.getClientRects()` and `getBoundingClientRect()`, many `contenteditable` operations |
| Computed style | `getComputedStyle()`: always style; also layout for geometry values (sizes, insets, margins, padding, transforms, grid templates) and when viewport media queries exist |
| SVG | `getBBox()`, `getComputedTextLength()` and other text metrics |
| Style only | `document.scrollingElement` |

No forced layout: `clientX/Y` on events minus a rect cached before any write; ResizeObserver and IntersectionObserver entries; `textContent` instead of `innerText`.
See it: "Forced by script" in `trace-summary.mjs` output (a JS stack on Layout or Recalculate style), the `ForcedReflow` insight, and `forcedStyleAndLayoutDuration` in Long Animation Frames (`__wpProbe.loaf.read()` sums it as `forcedLayoutMs`). The list is not complete: the trace decides.

## §G Metrics → stages

Thresholds and lab budgets are in SKILL.md, "Budgets and the chart contract".

| Metric tag | What it measures | Stages | Recipe |
|---|---|---|---|
| `LCP` | Paint of the largest image or text block in the viewport, during load | `network`, `parse`, `cssom`, `script-load`, `paint` | measure.md#load |
| `INP` | The worst click, tap or key latency to the next presented frame | `tasks`, `js`, `style`, `layout`, `paint` | measure.md#inp |
| `CLS` | The largest window of unexpected layout shifts | `layout` | measure.md#cls |
| `FCP` | First text or image painted | `network`, `parse`, `cssom`, `script-load` | measure.md#load |
| `TTFB` | First byte of the HTML document | `network` | measure.md#load |
| `frame` | Frame intervals during scroll, pan, zoom, drag, animation and streaming | `tasks`, `js`, `style`, `layout`, `paint`, `composite`, `gpu-upload`, `gpu-draw` | measure.md#fps, measure.md#fps-css, measure.md#gpu |
| `memory` | Growth per repeated action; DOM nodes, canvases and contexts kept | `memory` | measure.md#mem |
| `bytes`, `startup` | Transfer size; script evaluation and Wasm start before the app can be used | `network`, `script-load` | measure.md#start |

| LCP subpart | From → to | Target share | Stages | Rules in |
|---|---|---|---|---|
| Time to first byte | navigation start → first HTML byte | about 40% | `network` | html-loading.md |
| Resource load delay | first byte → LCP resource request start | under 10% | `parse`, `network` | html-media-and-fonts.md, html-loading.md |
| Resource load duration | request start → request end | about 40% | `network` | html-media-and-fonts.md |
| Element render delay | request end → element painted | under 10% | `cssom`, `script-load`, `tasks`, `paint` | html-loading.md |

The four parts add up to LCP with no gaps; text in a system font has no load delay or duration. Candidates are images, video posters or first frames, `url()` backgrounds and text blocks. A `<canvas>` is not an LCP candidate, so mark the first drawn frame of a canvas chart yourself with `performance.mark()`. Chromium ignores elements with opacity 0, full-viewport elements and low-detail placeholder images, and stops recording candidates at the first tap, scroll or key press.

| INP subpart | From → to | Stages | Rules in |
|---|---|---|---|
| Input delay | input → first handler starts | `tasks`, `script-load` | js-scheduling-and-workers.md |
| Processing duration | all handlers of the interaction, in the same frame | `tasks`, `js`, forced `style` and `layout` | js-events-and-input.md, v8-hot-code.md |
| Presentation delay | last handler ends → next frame presented | `style`, `layout`, `paint`, `composite` | css-rendering.md, js-dom-and-lists.md |

INP takes the worst interaction of the visit (one ignored per 50), judged at p75. `pointerdown`, `pointerup` and `click` of one tap share one `interactionId`, so check the handlers of all three. In a frame that answers input, the main thread also waits for the commit (`non-blocking-commit`), which adds to presentation delay. INP does not measure scroll, hover, pan, zoom or the pointer moves of a drag: those are `frame` problems. A load trace holds no interaction, so it cannot show INP.
CLS: the largest session window of shifts (gaps under 1 s, window at most 5 s) over the whole page life. Shifts within 500 ms after a discrete input do not count. Scrolls, drags and pinch-zoom are not such input, so shifts during them count. A load trace sees only the load.
`frame`: rAF-interval percentiles, frames over one refresh interval, the largest frame gap, dropped or partly presented frames, and long animation frames. Many short tasks lower INP blocking time but not frame cost: for smoothness, cut the total work. A long frame with little main-thread time points to the GPU side (§H `gpu-draw`).

Symptoms → stage → file (the symptom router; SKILL.md points here):

| Symptom or metric part | Check this stage first | Open |
|---|---|---|
| First load slow or blank; LCP resource load delay | parse, network | `html-loading` §D, `html-media-and-fonts` §A |
| LCP: high TTFB or long resource load duration | network | `html-loading` §G, `html-media-and-fonts` §B |
| LCP: element render delay | cssom, script-load | `html-loading` §B–§C |
| Click or key feels late (INP): input delay | tasks, script-load | `js-scheduling-and-workers` |
| INP: processing duration | tasks, js | `js-events-and-input`, `v8-hot-code` |
| INP: presentation delay | style, layout, paint | `css-rendering` §C–§D, `js-dom-and-lists` |
| Content jumps (CLS), flicker, pop-in | layout | `html-media-and-fonts` §E, `css-rendering` §C, `gpu-canvas-and-frames` §B |
| Pan, zoom, drag or streaming stutters | tasks, gpu-upload, gpu-draw | `gpu-canvas-and-frames`, `scichart`, `gpu-webgl-webgpu` |
| A CSS animation or scrolling janks | composite, paint | `css-rendering` §A–§B |
| The first chart is slow to appear | script-load, gpu-draw | `scichart` §H, `gpu-webgl-webgpu` §B |
| Memory grows over hours; the tab crashes | memory | `js-lifecycle-and-memory`, `scichart` §G |
| CPU or fans busy while the app is idle | tasks, gpu-draw | `gpu-canvas-and-frames` §A and §F, `js-lifecycle-and-memory` §C |
| Slow after the user returns to the tab | memory, network | `js-lifecycle-and-memory` §C |

## §H Stage cards

### 1. `network` — Network
- Runs (network service; main thread only for callbacks): DNS, connections, requests, caches, the service worker, the next navigation.
- Blocked by: redirects, server time, no compression, cache misses; early request limits: until `<body>` exists, Chromium starts low-priority requests only while fewer than two are in flight (tight mode).
- Trace and insights: Network track (priority, initiator, render-blocking mark); `DocumentLatency`, `NetworkDependencyTree`, `Cache`, `ModernHTTP`, `ImageDelivery`, `ThirdParties`.
- Budget: TTFB at most about 0.8 s as a guide, and about 40% of LCP; server response under 600 ms.
- Wrong beliefs: "Preload all important files": preloads compete for bandwidth, and a preload without `as` downloads twice. "Preconnect to every origin": keep it to the one or two critical origins.
- Rules: html-loading.md, js-live-data-and-network.md; image bytes: html-media-and-fonts.md. Measure: measure.md#load.

### 2. `parse` — Parse and discovery
- Runs (main thread; requests go to the network service): the HTML parser in chunks as bytes arrive; the preload scanner reads the raw markup ahead and starts requests.
- Blocked by: parser-blocking classic scripts and the stylesheets they wait for; a late `<meta charset>`; `document.write`; large inline blobs that delay the scanner.
- Trace and insights: "Parse HTML" (it shows the line range); idle gaps between parse chunks; request start times; `LCPDiscovery`, `NetworkDependencyTree`, `CharacterSet`, `Viewport`.
- Budget: LCP resource load delay under 10% of LCP: the LCP resource starts with the first requests.
- Wrong beliefs: "The browser finds every resource in the HTML": the scanner misses JS-inserted tags, `data-src`, CSS backgrounds, fonts and `@import` inside CSS files, and client-rendered markup. "`async` and `defer` are the same": `async` runs when fetched, in any order, and pauses the parser then; `defer` waits for the parser and keeps order.
- Rules: html-loading.md, html-media-and-fonts.md. Measure: measure.md#load.

### 3. `cssom` — Render-blocking CSS and fonts
- Runs (main thread): download and parse of render-blocking CSS, the CSSOM build, web-font loads.
- Blocked by: every `<head>` stylesheet with a matching `media`, all of it (the CSSOM is not incremental); `@import` chains; text that waits for a web font, or swaps to it later.
- Trace and insights: "Parse stylesheet"; render-blocking mark on network rows; Layout shifts track for font swaps; `RenderBlocking`, `FontDisplay`, `CLSCulprits`.
- Budget: no render-blocking request that the first view does not need; element render delay under 10% of LCP.
- Wrong beliefs: "`@import` is the same as `<link>`": it chains a request that the scanner cannot see. "`font-display: swap` is free": it turns invisible text into a layout shift unless the fallback font metrics match.
- Rules: html-loading.md, html-media-and-fonts.md. Measure: measure.md#load, measure.md#cls.

### 4. `script-load` — Script load
- Runs (network; a background thread streams the compile; the main thread evaluates): download, parse and compile, top-level evaluation, module graph fetch, Wasm compile and instantiation.
- Blocked by: sync scripts block the parser; one evaluation task per classic script; `defer` and module scripts all run before `DOMContentLoaded` (§B phase 5); deep static import chains are request waterfalls.
- Trace and insights: "Compile script", "Compile code", "Compile module", "Evaluate script", "Evaluate module", "Streaming compile task"; long tasks at startup; `LegacyJavaScript`, `DuplicatedJavaScript`, `ThirdParties`, `RenderBlocking`.
- Budget: about 100 KB per script (web.dev target); each evaluation task under 50 ms.
- Wrong beliefs: "`defer` makes script cost free": evaluation still runs on the main thread and delays the first interactions. "Inline scripts save a request": a large inline script gets no code cache and compiles on every visit; keep scripts over about 1 KB external.
- Rules: html-loading.md; Wasm: js-scheduling-and-workers.md; SciChart.js start-up: scichart.md. Measure: measure.md#start.

### 5. `tasks` — Tasks and scheduling
- Runs (main thread; workers have their own loops): event handlers, timers, socket and worker messages, rAF and observer callbacks, microtasks after each.
- Blocked by: whatever task runs now, because tasks run to the end; microtask chains; GC pauses; startup evaluation (input delay).
- Trace and insights: "Task" (a red corner over 50 ms), "Event", "Timer fired", "Animation frame fired", "Run microtasks", "Fire idle callback", "Receive WebSocket message"; Interactions track; long animation frames with `blockingDuration` and `invokerType`; `INPBreakdown`.
- Budget: a task under 50 ms; a few ms of script per frame while something moves; the visible answer to input in the next frame.
- Wrong beliefs: "`await` yields to the browser": a resolved promise is a microtask and blocks like sync code. "A yield means a paint": it lets the browser render but does not force a frame. "`requestIdleCallback` makes an interaction shorter": it only moves work to idle time.
- Rules: js-events-and-input.md, js-scheduling-and-workers.md, js-live-data-and-network.md. Measure: measure.md#inp, measure.md#fps.

### 6. `js` — JS execution
- Runs (main thread, or the worker that runs the code): V8 on hot paths: property access, array work, allocation, parse and format of data (JSON, `Intl`, RegExp).
- Blocked by: the CPU work itself; deoptimization when object shapes or element kinds change; allocation that fills the young generation and starts a GC.
- Trace and insights: Bottom-up self time by function; "Function call", "Minor GC", "Major GC"; script entries of long animation frames. No insight covers it.
- Budget: app script about half of a frame (about 8 ms at 60 Hz, 4 ms at 120 Hz); a handler for each data message far less.
- Wrong beliefs: "Micro-optimize first": without a profile of a per-frame or per-message path, the change is noise; fix the algorithm and the allocations first. "A worker makes code faster": it moves the work off the main thread; the work and the message copies still cost CPU.
- Rules: v8-hot-code.md; moving work off the thread: js-scheduling-and-workers.md. Measure: measure.md#inp, measure.md#fps.

### 7. `style` — Style
- Runs (main thread): selector matching and style computation for dirty elements; style updates from animations.
- Blocked by: dirty elements × rules to match; wide invalidation (a class on `body` or a large container, a custom property on `:root` that many elements inherit, `:has()` and sibling selectors over changing lists); `getComputedStyle()` after a write.
- Trace and insights: "Recalculate style" (elements affected, and the stack that invalidated); "Schedule style recalculation"; `DOMSize`; `SlowCSSSelector` only with selector stats on.
- Budget: a style recalculation over 300 elements that takes over 40 ms fails `DOMSize`.
- Wrong beliefs: "Only the changed element restyles": the invalidation scope decides, so toggle state on the smallest element that needs it. "A custom property is a free variable": a change on `:root` restyles every element that inherits it.
- Rules: css-rendering.md. Measure: measure.md#inp.

### 8. `layout` — Layout
- Runs (main thread): box geometry for dirty boxes, from a layout root: the document, or a containment root.
- Blocked by: style; DOM size; layout scope; reads after writes (§F); ResizeObserver callbacks that resize their own targets.
- Trace and insights: "Layout" (scope Partial or Whole document, nodes that need layout, layout tree size; `trace-summary.mjs` prints `partialLayout`, `dirtyObjects`, `totalObjects`); "Invalidate layout"; Layout shifts track; `ForcedReflow`, `DOMSize`, `CLSCulprits`.
- Budget: no forced reflow over 30 ms; a layout over 100 objects that takes over 40 ms fails `DOMSize`; shift limits as in §G.
- Wrong beliefs: "Ten DOM writes cost ten layouts": writes in one task cost one layout at frame time; reads after writes are the cost, and a `DocumentFragment` does not fix them. "`box-shadow` changes layout": it is paint only.
- Rules: css-rendering.md, js-events-and-input.md, js-dom-and-lists.md; reserved space: html-media-and-fonts.md. Measure: measure.md#inp, measure.md#cls.

### 9. `paint` — Paint and raster
- Runs (main thread for pre-paint, paint and Canvas 2D calls; raster and decode on worker threads; GPU raster in the GPU process): display lists, tiles, image decode.
- Blocked by: layout; heavy effects (blur, large shadows, filters, big gradients); large paint areas; image decode, the most expensive part of raster.
- Trace and insights: "Pre-paint", "Paint", "Paint image"; "Rasterize paint" and "Image decode" on the thread pool; `ImageDelivery` for oversized images.
- Budget: paint and raster fit in the frame beside style and layout; zero Paint events in a compositor-only animation.
- Wrong beliefs: "Only `transform` and `opacity` skip paint": compositor-run `filter` and `backdrop-filter` animations do too (§E). "The download is the image cost": decode and raster of a large image can cost more; size images to their display size.
- Rules: css-rendering.md; Canvas 2D: gpu-canvas-and-frames.md; image size and decode: html-media-and-fonts.md. Measure: measure.md#fps-css, measure.md#fps.

### 10. `composite` — Composite
- Runs (main thread for layerize and commit, then the compositor thread): layer lists, commit, activation, compositor animations and scroll, frame building.
- Blocked by: paint; the commit in frames that answer input (`non-blocking-commit`); tiles not rastered yet; many or large layers; non-passive input listeners that make scroll wait for the main thread.
- Trace and insights: "Layerize", "Commit"; Animations track (why an animation is not composited); Frames track; `CLSCulprits` (non-composited animation).
- Budget: a compositor-only animation has zero Layout and zero Paint events per frame.
- Wrong beliefs: "`transform` means no jank": only a declared CSS or WAAPI animation runs without the main thread; a transform that script writes each frame waits for script, style and commit. "More layers are faster": each layer costs GPU memory and management; `translateZ(0)` hacks and a permanent `will-change` add them.
- Rules: css-rendering.md; passive listeners: js-events-and-input.md. Measure: measure.md#fps-css.

### 11. `gpu-upload` — GPU upload
- Runs (calls on the main thread or a worker; execution in the GPU process): buffer writes, texture uploads, text or images drawn into a texture.
- Blocked by: the bytes to copy; new buffers or textures instead of reused ones; full re-uploads when only a range changed; premultiply, flip or color-space conversions during an image upload.
- Trace and insights: GPU track (`GPUTask`) spikes when data changes; main-thread time in the upload call. No insight covers it.
- Budget: per frame, upload only what changed; create no buffer or texture per frame.
- Wrong beliefs: "`float32` holds any value a chart needs": at Unix-millisecond scale, neighboring `float32` values are about two minutes apart; upload offsets from a base value. "A new `bufferData()` is a cheap update": new storage is allocated, zero-filled and validated again; allocate once with headroom and write ranges with `bufferSubData()`.
- Rules: gpu-webgl-webgpu.md, gpu-canvas-and-frames.md; SciChart.js charts: scichart.md. Measure: measure.md#gpu, measure.md#fps.

### 12. `gpu-draw` — GPU draw
- Runs (GPU process; validation on the calling thread): draw calls, state changes and passes, shader compile at first use, readback, and the compositor's own draw.
- Blocked by: call and state-change count (validated per call); fragment cost (overdraw; pixels grow with DPR²); sync readback and state queries (`readPixels()`, `getError()`) that wait for the GPU; first-use shader compile.
- Trace and insights: GPU track (`GPUTask` is CPU time on the GPU main thread, not shader time); Frames track (red dropped, yellow partly presented); long frames with little main-thread time. The chrome-devtools-mcp trace summary has no frame or GPU data: use the saved trace and an in-page rAF probe.
- Budget: no long frame (over 1.5 × the refresh interval) during pan, zoom or streaming; frame-interval p95 stays near the refresh interval (rAF deltas never fall below it, so "p95 under the interval" never passes).
- Wrong beliefs: "DevTools CPU throttling slows the GPU too": it slows only the renderer main thread, so throttled frame times of GPU-heavy views are a lower limit. "A software-renderer run shows GPU cost": it measures the CPU; reject runs on SwiftShader.
- Rules: gpu-webgl-webgpu.md, gpu-canvas-and-frames.md; SciChart.js charts: scichart.md. Measure: measure.md#gpu, measure.md#fps.

### 13. `memory` — Memory and lifecycle
- Runs (main thread for GC pauses; GPU memory in the GPU process): allocation and garbage collection, view teardown, hidden-tab and off-screen behavior, caches and storage.
- Blocked by: allocation rate (GC pauses land inside frames); objects kept alive by listeners, timers, observers, subscriptions, closures and caches; detached DOM; canvases and GPU contexts that no owner releases; Wasm memory, which only grows.
- Trace and insights: "Minor GC", "Major GC", "DOM GC"; Memory counters; heap snapshots and app counters. No insight covers it.
- Budget: after warm-up, growth per repeated action stays within noise; DOM nodes, canvases and contexts return to baseline. A canvas backing store is CSS width × CSS height × DPR² × 4 bytes.
- Wrong beliefs: "A hidden tab does no work": rAF stops, but socket messages, model updates and throttled timers go on. "The JS heap is the memory cost": canvas backing stores, textures and Wasm memory are outside it.
- Rules: js-lifecycle-and-memory.md; SciChart.js charts: scichart.md. Measure: measure.md#mem.

## §I DevTools insights → stage → file

The 19 insights of the Performance panel. chrome-devtools-mcp lists only the insights that fail in a trace: pass the name exactly as listed.

| `insightName` | Title in DevTools | Stage | Open | Fails when, or what it shows |
|---|---|---|---|---|
| `LCPBreakdown` | LCP breakdown | by subpart (§G) | html-loading.md, html-media-and-fonts.md | Always shown with LCP: the 4 subparts. Fix the largest delay first |
| `LCPDiscovery` | LCP request discovery | `parse` | html-media-and-fonts.md | The LCP image is not in the HTML, is lazy-loaded, or has no `fetchpriority="high"` |
| `RenderBlocking` | Render-blocking requests | `cssom`, `script-load` | html-loading.md | Any request blocks the first paint |
| `NetworkDependencyTree` | Network dependency tree | `network`, `parse` | html-loading.md | A critical request is found late (a chain); names preconnect candidates |
| `DocumentLatency` | Document request latency | `network` | html-loading.md | Redirects, a server response over 600 ms, or no compression |
| `ImageDelivery` | Improve image delivery | `network` | html-media-and-fonts.md | Images larger than shown, badly compressed or in a heavy format |
| `ModernHTTP` | Modern HTTP | `network` | html-loading.md | Requests over HTTP/1.1 |
| `DuplicatedJavaScript` | Duplicated JavaScript | `script-load` | html-loading.md | One module in several bundles |
| `LegacyJavaScript` | Legacy JavaScript | `script-load` | html-loading.md | Polyfills and transforms for Baseline features |
| `ThirdParties` | 3rd parties | `network`, `tasks` | html-loading.md | Bytes and main-thread time per third party |
| `Cache` | Use efficient cache lifetimes | `network` | html-loading.md | Short cache lifetimes on static files |
| `FontDisplay` | Font display | `cssom` | html-media-and-fonts.md | A web font without `font-display: swap` or `optional` |
| `CharacterSet` | Declare a character encoding | `parse` | html-loading.md | No charset in the first 1024 bytes or in the `Content-Type` header |
| `Viewport` | Optimize viewport for mobile | `parse` | html-loading.md | No mobile viewport meta, so a tap can wait up to 300 ms |
| `CLSCulprits` | Layout shift culprits | `layout` | html-media-and-fonts.md, css-rendering.md | The worst shift cluster; causes: injected iframe, web font, non-composited animation, unsized image |
| `INPBreakdown` | INP breakdown | by subpart (§G) | js-events-and-input.md, js-scheduling-and-workers.md | Always shown when an interaction was traced: the 3 subparts |
| `DOMSize` | Optimize DOM size | `layout`, `style` | js-dom-and-lists.md | A layout over 100 objects or a style recalculation over 300 elements took over 40 ms |
| `ForcedReflow` | Forced reflow | `layout` | js-events-and-input.md | A forced reflow took over 30 ms; it names the call frames |
| `SlowCSSSelector` | CSS selector costs | `style` | css-rendering.md | Information only. It needs "Enable CSS selector stats" in the Performance panel, so chrome-devtools-mcp traces do not list it |

## §J Stage vocabulary

| Tag | Report heading | Research note tags | The saving shows in |
|---|---|---|---|
| `network` | Network | `network` | request timing, TTFB, bytes |
| `parse` | Parse and discovery | `html-parse`, `preload-scan` | "Parse HTML", request start times |
| `cssom` | Render-blocking CSS and fonts | `cssom`, and font-swap items | render-blocking requests, FCP, font shifts |
| `script-load` | Script load | `script-compile`, `startup` | compile and evaluate events at startup |
| `tasks` | Tasks and scheduling | `main-thread-task`, `microtask`, `idle` | long tasks, input delay, LoAF blocking time |
| `js` | JS execution | `script-run` | function self time, GC |
| `style` | Style | `style` | "Recalculate style" |
| `layout` | Layout | `layout` | "Layout", forced reflow, shifts |
| `paint` | Paint and raster | `paint`, `raster` | "Paint", "Rasterize paint", "Image decode" |
| `composite` | Composite | `composite` | "Layerize", "Commit", the Animations track |
| `gpu-upload` | GPU upload | `gpu-upload` | GPU track spikes when data changes |
| `gpu-draw` | GPU draw | `gpu-draw` | GPU track, dropped frames |
| `memory` | Memory and lifecycle | `gc-memory`, `memory` | heap growth, GC, retained objects |

The first `stage:` value of a rule is the stage where its saving shows first in a trace. A review report groups findings by that value, in the order above.

```sh
R="${CLAUDE_SKILL_DIR}/references"
grep -n -B1 '^stage: [^·]*\blayout\b' "$R"/*.md   # every rule that touches layout (the line above is the title)
grep -n -B1 '^stage: layout\b' "$R"/*.md          # rules whose saving shows first in layout
grep -n '\[layout ·' "$R"/*.md                    # one-line rules tagged layout
grep -h '^- Detect:' "$R"/css-rendering.md        # the Detect lines of one file
grep -n 'support: scheduler-yield' "$R"/*.md      # rules that depend on one support key
```

## Sources

- Event loop and "update the rendering": https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering
- Threads, commit and raster: https://developer.chrome.com/docs/chromium/renderingng-architecture ; https://chromium.googlesource.com/chromium/src/+/HEAD/docs/how_cc_works.md ; https://developer.chrome.com/docs/chromium/blinkng
- Property costs: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/css/css_properties.json5 ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.cc
- Forcing reads: https://gist.github.com/paulirish/5d52fb081b3570c81e3a
- Metrics: https://web.dev/articles/optimize-lcp ; https://web.dev/articles/lcp ; https://web.dev/articles/inp ; https://web.dev/articles/cls
- Insights and trace events: https://developer.chrome.com/docs/performance/insights ; https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/insights/Models.ts ; https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/types/TraceEvents.ts
- CPU throttling and the GPU: https://developer.chrome.com/blog/devtools-grounded-real-world
