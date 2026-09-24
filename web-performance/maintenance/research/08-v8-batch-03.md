# V8 deep read, batch 3: GC, compile hints, lazy parsing, DataView, spread, class fields, mutable heap numbers

Scope: developer-facing rules from seven v8.dev posts (Orinoco GC 2019, explicit compile hints 2025, lazy parsing 2019, DataView 2018, spread elements 2018, class features 2022, mutable heap numbers 2025).
Each rule names the engine mechanism, marks advice that newer V8 versions made obsolete, and gives the status as of 2026-09.
"Latest" status was checked against V8 `main` source (flag-definitions.h, parser-base.h, commit history), Chrome Platform Status, web-features (Baseline), and the WICG explainer.
Version rule of thumb: V8 X.Y ships in Chrome XY (V8 9.7 = Chrome 97). Where a Chrome version comes from a commit date and not from a post, the note says "estimate".

---

## A. Garbage collection (Orinoco, "Trash talk", 2019-01-03)

### Let temporary objects die young; do not retain them "just in case"
- Layer: v8
- Stage: gc-memory, script-run
- Metrics: memory, FPS/smoothness, INP
- When: animation/render-loop, long-lived session
- Impact: medium, because a minor GC costs time in proportion to surviving objects, not to allocated objects
- Do: Create short-lived helper objects (tuples, iterator results, small `{x, y}` records) freely inside one task, and let them become unreachable before the task ends. Do not park them in fields, module-level arrays, or closures "for later".
- Why: V8 allocates new objects in the nursery. The Scavenger (minor GC) copies only reachable objects; everything else is reclaimed for free. An object that survives one scavenge moves to "intermediate"; if it survives a second, it is copied again into the old generation, where only the major GC (mark-compact) can reclaim it. Objects that live "a few frames" pay two copies plus a later major GC.
- Example:
  ```js
  // Before: per-frame scratch objects kept alive in a long-lived array
  this.lastHits = points.map(p => ({ x: p.x, y: p.y })); // survives several scavenges, then dies in old space

  // After: compute and consume in the same task
  for (const p of points) {
    const hit = hitTest(p.x, p.y); // temporary, dies young
    if (hit) { select(hit.id); break; }
  }
  ```
- Avoid/caveats: "Cheap" is not "free": a very high allocation rate in a 60 fps loop still triggers frequent scavenges, and each scavenge is a (parallel) main-thread pause. Profile before and after (DevTools Performance panel shows "Minor GC" events).
- Status: V8 mechanism (Chrome, Edge, Node.js, Deno). The Scavenger is still the default young-generation collector in V8 `main` (2026-09): the alternative `minor_ms` (young-generation mark-sweep) is defined with `DEFINE_EXPERIMENTAL_FEATURE`, which defaults to false.
- Sources: https://v8.dev/blog/trash-talk ; https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h

### Reuse large buffers, not small objects; do not build object pools by default
- Layer: v8
- Stage: gc-memory
- Metrics: memory, FPS/smoothness
- When: animation/render-loop
- Impact: medium, because pooling moves objects into old space and adds write-barrier work, while reusing big buffers removes real allocation cost
- Do: Allocate large typed arrays (vertex buffers, scratch `Float32Array`s) once and reuse them across frames. Allocate small short-lived objects normally. Add a pool only when a profile shows GC time inside frames and the pool proves faster.
- Why: The post says short-lived objects are "actually very cheap" for a generational GC, because only survivors cost work. Pooled objects live forever: they get promoted to old space, and every time you store a fresh young object into a pooled (old) object, the write barrier records an old-to-new reference that the next scavenge must process.
- Example:
  ```js
  // Good: one reusable upload buffer per series
  const scratch = new Float32Array(MAX_POINTS * 2);
  function uploadFrame(xs, ys, n) {
    for (let i = 0; i < n; i++) { scratch[2 * i] = xs[i]; scratch[2 * i + 1] = ys[i]; }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratch.subarray(0, 2 * n));
  }
  ```
- Avoid/caveats: A pool that is larger than needed wastes memory for the whole session. A pool that hands out objects which still hold references to old data can leak.
- Status: V8 mechanism; general guidance (the pooling trade-off is derived from the post's mechanism, not stated as a rule in the post).
- Sources: https://v8.dev/blog/trash-talk

### Keep bulk numeric data in typed arrays, not in arrays of objects
- Layer: v8
- Stage: gc-memory
- Metrics: memory, FPS/smoothness
- When: long-lived session
- Impact: high, because a chart with millions of points as objects gives the major GC millions of objects to mark and possibly copy
- Do: Store long-lived series data (timestamps, prices, volumes) in `Float64Array`/`Float32Array` columns (struct-of-arrays). Keep objects for low-count entities (series, axes, drawings).
- Why: Marking starts at the roots (stack, global object) and follows every pointer; compaction copies surviving objects on fragmented pages. A typed array is one object whose contents are raw numbers with no pointers, so the collector has nothing inside it to trace or update.
- Example:
  ```js
  // Before: 1M objects, 1M+ heap cells to mark
  const candles = rows.map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4] }));

  // After: 5 objects total
  const n = rows.length;
  const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n),
        l = new Float64Array(n), c = new Float64Array(n);
  for (let i = 0; i < n; i++) { const r = rows[i]; t[i] = r[0]; o[i] = r[1]; h[i] = r[2]; l[i] = r[3]; c[i] = r[4]; }
  ```
- Avoid/caveats: Typed arrays have fixed length; plan growth (capacity doubling, or resizable `ArrayBuffer`, Baseline 2024). SciChart.js keeps its data series in WebAssembly memory, which already follows this rule; do not copy that data back into JS objects.
- Status: Typed arrays Baseline widely available (2015). Mechanism from the post; the "typed arrays hold no pointers" point follows from how typed arrays store raw bytes.
- Sources: https://v8.dev/blog/trash-talk

### Do not store freshly allocated objects into long-lived containers on every frame
- Layer: v8
- Stage: gc-memory, script-run
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, because each such store creates an old-to-new reference and forces the new object to survive and be promoted
- Do: When a long-lived structure (a cache, a store, a component field) must change every frame, write numbers into existing typed arrays or mutate existing objects. Do not replace its entries with new objects each frame.
- Why: V8 finds young objects that old objects point to through a write-barrier list of old-to-new references, which the scavenger uses as extra roots. A new object stored into an old container is reachable, so it survives, gets copied twice, and ends up as old-space garbage when the next frame replaces it. Only a major GC can reclaim it.
- Example:
  ```js
  // Before: new object per point per frame into a long-lived array
  for (let i = 0; i < n; i++) this.screenPts[i] = { x: toX(t[i]), y: toY(c[i]) };

  // After: reuse numeric storage
  for (let i = 0; i < n; i++) { this.sx[i] = toX(t[i]); this.sy[i] = toY(c[i]); }
  ```
- Avoid/caveats: Mutating shared objects in place can break reactive frameworks that rely on identity changes (for example Svelte `$state` or immutable stores). Keep hot numeric buffers outside reactive state.
- Status: V8 mechanism (write barriers, remembered old-to-new set); derived rule.
- Sources: https://v8.dev/blog/trash-talk

### Leave idle time in each frame so Chrome can run GC idle tasks
- Layer: v8
- Stage: idle, gc-memory, main-thread-task
- Metrics: FPS/smoothness, memory, INP
- When: animation/render-loop, long-lived session
- Impact: medium, because GC work that cannot run in idle slices runs later as forced work inside frames
- Do: Finish per-frame work well inside the frame budget (about 16.6 ms at 60 Hz). Render only on change (dirty flag) instead of redrawing an unchanged chart every `requestAnimationFrame`. Stop the render loop when the tab or chart is hidden.
- Why: V8 posts optional "idle tasks" for GC; Chrome runs them in spare time between the end of frame work and the next frame. The post reports idle-time GC cut Gmail's JS heap by 45% when idle. A loop that uses the whole budget every frame leaves no idle slices.
- Example:
  ```js
  let dirty = true;
  function frame() {
    if (dirty) { draw(); dirty = false; }
    rafId = requestAnimationFrame(frame);
  }
  // mark dirty on data or viewport change only
  ```
- Avoid/caveats: JS cannot trigger GC directly (`gc()` exists only with `--expose-gc`); do not try to force it.
- Status: Chrome/V8 behavior (embedder-provided idle time). Other engines schedule GC differently.
- Sources: https://v8.dev/blog/trash-talk

### Release references to data you no longer need
- Layer: v8
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: high, because in a trading terminal that stays open for hours, anything reachable from a root is never collected
- Do: Remove event listeners, cancel subscriptions and timers, clear caches, and null out fields that hold large data when a chart, panel, or symbol is closed. Use `WeakMap` for side tables keyed by objects (DOM nodes, series), so the entry dies with the key.
- Why: V8 decides liveness by reachability from the root set (execution stack and global object) and marks everything reachable. A single forgotten reference (listener on `window`, closure in a global registry, module-level `Map`) keeps a whole object graph alive.
- Example:
  ```js
  const meta = new WeakMap();       // entry goes away with the series object
  meta.set(series, { lastDrawMs: 0 });

  function destroyChart(chart) {
    window.removeEventListener('resize', chart.onResize);
    chart.unsubscribe();
    chart.data = null;
  }
  ```
- Avoid/caveats: Do not use `WeakRef`/`FinalizationRegistry` for normal cleanup; collection timing is not guaranteed.
- Status: WeakMap Baseline widely available. Mechanism from the post.
- Sources: https://v8.dev/blog/trash-talk

### Update large data sets incrementally instead of rebuilding them
- Layer: v8
- Stage: gc-memory, script-run
- Metrics: FPS/smoothness, memory, INP
- When: long-lived session, interaction
- Impact: medium, because large allocate-then-drop bursts push the heap toward its limit and fragment old-space pages
- Do: Append new ticks/candles to existing buffers and update in place. Do not re-parse the full JSON snapshot or rebuild the full object graph on every update.
- Why: The major GC starts concurrent marking when the heap nears a dynamically computed limit, then pauses the main thread for marking finalization (a rescan of roots), parallel compaction of fragmented pages, and pointer updates. Big bursts of long-lived-then-dropped objects grow the heap, trigger that cycle more often, and create fragmentation that compaction must copy.
- Example:
  ```js
  // Before: every websocket message rebuilds 100k candles
  ws.onmessage = e => { state.candles = JSON.parse(e.data).candles.map(toCandle); };
  // After: message carries only the delta
  ws.onmessage = e => { const d = JSON.parse(e.data); appendCandle(buffers, d); };
  ```
- Avoid/caveats: None beyond design effort; concurrent marking and sweeping already reduce pauses (the post reports up to 50% lower pause times in heavy WebGL games).
- Status: V8 mechanism.
- Sources: https://v8.dev/blog/trash-talk

---

## B. Explicit compile hints (2025-04-29)

### Mark a startup-critical file with `//# allFunctionsCalledOnLoad`
- Layer: v8
- Stage: script-compile, network
- Metrics: startup, FCP, LCP, TBT
- When: load
- Impact: medium, because V8 then compiles the file's functions on a background thread while the script downloads, instead of lazily on the main thread at first call
- Do: Put the exact comment `//# allFunctionsCalledOnLoad` at the top of a JS file whose functions actually run during page load. Only other comments may come before it. Use it on one small "core" file, not on the whole app.
- Why: Without a hint V8 must preparse each function (a full syntax pass to find where it ends) and later fully parse and compile it when called, on the main thread. With the hint, the full parse happens once, off the main thread, and partly overlaps the download. In the V8 team's test, 17 of 20 popular pages got faster, with 630 ms less foreground parse and compile time on average.
- Example:
  ```js
  //# allFunctionsCalledOnLoad
  // core.js: bootstrap code that runs on every page load
  export function initTerminal(root) { /* ... */ }
  export function mountChart(el, cfg) { /* ... */ }
  ```
- Avoid/caveats: The post: "This feature should be used sparingly". Eagerly compiling functions that do not run during load costs CPU and memory (bytecode). The hint applies to all functions in that file after the comment; it cannot be placed mid-file. The browser may ignore the hint.
- Status: Shipped in Chrome 136 (per-file variant; origin trials in Chrome 115 and 132 per Chrome Platform Status). Firefox and Safari: no implementation; the comment is ignored harmlessly. Per-function variant (`//# functionsCalledOnLoad=<base64>`) is "Proposed" on Chrome Platform Status (last updated 2025-11-26) and not shipped; V8 `main` parser has a flag for it.
- Sources: https://v8.dev/blog/explicit-compile-hints ; https://github.com/WICG/explicit-javascript-compile-hints-file-based/blob/main/README.md ; https://chromestatus.com/feature/5100466238652416 ; https://chromestatus.com/feature/5153430045458432

### Make the compile hint survive bundling and minification
- Layer: build
- Stage: script-compile
- Metrics: startup, bundle-size
- When: build
- Impact: medium, because bundlers strip the comment by default and the hint then silently does nothing
- Do: Split startup-only code into its own chunk, then add the comment at output time to that chunk only. With esbuild, use the `banner` option. With Rollup/Vite, use `output.banner` as a function of the chunk. Check the final minified file on disk still starts with the comment.
- Why: esbuild keeps only hashbangs and legal comments by default; its author recommends `banner` for this engine-specific comment (esbuild issue #4247, closed 2025-12-17). Rollup adds `banner` before the chunk is rendered, so a minifier that runs later can still remove it; the WICG explainer lists minification as a known pitfall.
- Example:
  ```js
  // rollup/vite config (output options)
  output: {
    manualChunks: { core: ['src/boot/core.ts'] },
    banner: chunk => (chunk.name === 'core' ? '//# allFunctionsCalledOnLoad' : ''),
  }
  // Terser: keep it with format: { comments: /allFunctionsCalledOnLoad/ }
  ```
- Avoid/caveats: Applying the banner to every chunk turns off lazy compilation for the whole app (worse startup, more memory). Prepending a line after source-map generation shifts mappings; prefer the bundler's own banner option.
- Status: esbuild: `banner` supported, no automatic preservation (as of issue close, 2025-12). Rollup `output.banner` accepts `(chunk: RenderedChunk) => string`.
- Sources: https://github.com/evanw/esbuild/issues/4247 ; https://raw.githubusercontent.com/rollup/rollup/master/docs/configuration-options/index.md ; https://github.com/terser/terser/blob/master/README.md

### Verify eager vs lazy compilation with V8 function-event logging
- Layer: tooling
- Stage: script-compile
- Metrics: startup
- When: testing
- Impact: low, because it is a measurement step, but it prevents shipping a hint that does nothing
- Do: Start Chrome with a fresh profile and `--js-flags=--log-function_events`, load the page, and grep the log for your function names. A `parse-function` event at call time means the function was compiled lazily; no such event means it was compiled eagerly.
- Why: Code caching from earlier visits hides the difference, so the profile must be clean.
- Example:
  ```sh
  rm -rf /tmp/chromedata && google-chrome --no-first-run --user-data-dir=/tmp/chromedata \
    --js-flags=--log-function_events > log.txt
  grep mountChart log.txt
  ```
- Avoid/caveats: Measure repeat visits separately; the code cache changes the picture on warm loads.
- Status: Chrome/V8 command-line flags (developer use only).
- Sources: https://v8.dev/blog/explicit-compile-hints

---

## C. Lazy parsing and PIFEs ("Blazingly fast parsing, part 2", 2019-04-15)

### Ship less JavaScript at startup; split code that is not needed during load
- Layer: build
- Stage: network, script-compile
- Metrics: startup, TBT, INP, bundle-size, memory
- When: load, build
- Impact: high, because every shipped function still gets downloaded and preparsed even if it never runs
- Do: Move features that are not used on first render (settings dialogs, rarely used indicators, drawing tools not yet selected) behind dynamic `import()`. Keep the first-interaction code path small.
- Why: Lazy parsing does not skip code: the preparser still validates syntax and tracks variable declarations and references for every function it skips. Only the AST and bytecode are deferred. When a lazy function is first called, V8 fully parses and compiles it on the main thread at that moment, which adds to that interaction's latency. V8 also flushes bytecode that stays unused for a while, so rarely used code can be recompiled again later.
- Example:
  ```js
  button.addEventListener('click', async () => {
    const { openIndicatorEditor } = await import('./indicator-editor.js');
    openIndicatorEditor();
  });
  ```
- Avoid/caveats: Too many tiny chunks add request overhead; group by feature.
- Status: Lazy parsing in all major engines (per the post). Dynamic `import()` Baseline widely available.
- Sources: https://v8.dev/blog/preparser

### Load scripts with `<script>` tags so Chrome can compile them off the main thread
- Layer: html
- Stage: preload-scan, network, script-compile
- Metrics: startup, TBT, FCP
- When: load
- Impact: medium, because streamed scripts are downloaded, parsed, and compiled in the background
- Do: Reference scripts with `<script src>` (`type="module"`, `defer`, or `async`) in the HTML. Do not fetch script text and run it with `eval`/`new Function`, and do not inject large inline scripts late.
- Why: The preload scanner discovers `<script>` tags early, and Chrome downloads, parses, and compiles them without blocking the main thread. Everything V8 decides to compile eagerly (PIFEs, compile hints) is compiled off the main thread in that path, which magnifies the benefit of eager hints.
- Example:
  ```html
  <script type="module" src="/assets/core.js"></script>
  ```
- Avoid/caveats: Module graphs with deep import chains still need round trips; use `<link rel="modulepreload">` for known dependencies.
- Status: Chrome behavior described in the post (2019); still how Chromium script streaming works (not re-verified in a newer V8 post).
- Sources: https://v8.dev/blog/preparser

### Wrap only profiled startup-critical functions as PIFEs
- Layer: v8
- Stage: script-compile
- Metrics: startup
- When: load, build
- Impact: low, because the gain is small on modern V8 and only applies to functions that really run at startup
- Do: If profiling shows a function expression runs immediately at load, write it in a form V8 treats as a "possibly-invoked function expression" (PIFE). The parser decides before it parses the body, so the hint must be at the start.
- Why: V8 skips the preparse and compiles eagerly when it sees these patterns (checked in V8 `main` `parser-base.h`, 2026-09):
  - `(function` or `(async function`: a function right after an opening parenthesis.
  - `!function`: a negated function expression (UglifyJS/Terser style), since V8 5.7 / Chrome 57.
  - `,function` when the function before the comma was a PIFE (`!function(){}(),function(){}()`).
  - An arrow function whose parameter list starts right after an opening parenthesis: `(() => {...})`, `((a) => ...)`, `(a => ...)`.
  - A function literal used directly as a template tag.
- Example:
  ```js
  // Eager: parenthesized, run immediately at startup
  const boot = (() => { registerSeriesTypes(); return createTerminal(); })();

  // Lazy (not a PIFE): callback passed as an argument without extra parentheses
  onIdle(() => warmCaches());
  ```
- Avoid/caveats: A callback passed as a plain argument `f(() => ...)` is not a PIFE (the call's parenthesis does not count). Bundlers already use PIFEs for module wrappers (Rolldown PR #5319, merged 2025-07-24, reported about 2x faster init on a 10,000-module test); do not fight the bundler output.
- Status: V8/Chrome only; other engines ignore the hint (no harm).
- Sources: https://v8.dev/blog/preparser ; https://raw.githubusercontent.com/v8/v8/main/src/parsing/parser-base.h ; https://github.com/rolldown/rolldown/pull/5319

### OBSOLETE: do not wrap functions in parentheses automatically (optimize-js, Terser `wrap_func_args`)
- Layer: build
- Stage: script-compile, gc-memory
- Metrics: startup, memory
- When: build
- Impact: medium, because blanket eager compilation regresses load time and memory
- Do: Do not use optimize-js or similar static heuristics. Keep Terser `format.wrap_func_args` at its current default `false`. Leave `wrap_iife` at default unless you have a measured reason.
- Why: The trick paid off when V8 (≤6.2) re-preparsed inner functions. After the parser improvements, the post shows default V8 7.5 faster than optimize-js output on V8 6.1, and warns that heuristics like "every function passed as an argument runs at startup" compile whole late modules eagerly, which costs memory and load time.
- Example:
  ```js
  // Don't: tool output wraps every callback
  define(['dep'], (function (dep) { /* huge module used later */ }));
  ```
- Avoid/caveats: none.
- Status: Obsolete since V8 6.3 (Chrome 63) and V8 7.5 parser work. Terser v5.43.0 changed `wrap_func_args` default to `false` ("Do not wrap callbacks in parentheses").
- Sources: https://v8.dev/blog/preparser ; https://github.com/terser/terser/blob/master/CHANGELOG.md ; https://github.com/terser/terser/blob/master/README.md

### OBSOLETE: do not flatten or hoist nested functions for parse speed
- Layer: v8
- Stage: script-compile
- Metrics: startup
- When: build
- Impact: low, because nesting depth no longer changes parse cost
- Do: Nest functions where it reads best (closures, IIFE-wrapped modules, class methods). Do not restructure code to reduce nesting for the parser.
- Why: Before V8 6.3 / Chrome 63, each level of nesting caused inner functions to be preparsed again, so cost grew non-linearly with depth. Now the preparser does full scope resolution and stores a compact per-variable allocation record, so each function is preparsed at most once and fully parsed once (plus one reparse after bytecode flushing).
- Example: none needed.
- Avoid/caveats: none.
- Status: Obsolete since V8 6.3 (Chrome 63).
- Sources: https://v8.dev/blog/preparser

### Keep hot-loop variables local; do not capture them in closures without need
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: low, because optimizing tiers handle context loads well, but captured variables still live in heap contexts
- Do: In hot functions, keep counters and accumulators as plain locals. Create closures outside hot loops. Do not let a small callback capture a scope that also holds large data.
- Why: A variable referenced by an inner function cannot live on the stack; V8 allocates it in a heap "context" object that the closure points to. Top-level variables of classic scripts always live in the script context. Context variables are memory loads/stores, and the context stays alive as long as any closure that uses it.
- Example:
  ```js
  // Before: sum is captured by the callback, so it lives in a heap context
  let sum = 0; data.forEach(v => { sum += v; });
  // After: plain local in a loop
  let s = 0; for (let i = 0; i < data.length; i++) s += data[i];
  ```
- Avoid/caveats: Derived from the mechanism in the post, not a measured rule; measure before rewriting readable code. See section G for how V8 now optimizes numeric context slots.
- Status: V8 mechanism.
- Sources: https://v8.dev/blog/preparser

---

## D. DataView ("Improving DataView performance in V8", 2018-09-18)

### OBSOLETE: do not replace DataView with hand-written byte shims
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, startup
- When: load, long-lived session
- Impact: medium, because DataView is now up to 3x faster than a `Uint8Array` byte-assembly wrapper
- Do: Use `DataView` getters/setters to decode and encode mixed-type binary data (network frames, file formats, interleaved GPU vertex records). Remove old `Uint8Array` shift-and-or shims written to avoid DataView.
- Why: DataView methods used to be C++ runtime calls (up to 4x slower than a JS shim). V8 6.9 moved them to Torque/CSA builtins and taught TurboFan to inline them, so optimized code has no call at all. Result: about 16x faster than the old DataView, and almost the same speed as TypedArrays for aligned access in native byte order.
- Example:
  ```js
  // Before
  const u32 = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
  // After
  const u32 = view.getUint32(o, true);
  ```
- Avoid/caveats: For homogeneous numeric arrays, a TypedArray is still the natural and simplest choice.
- Status: Obsolete advice since V8 6.9 (Chrome 69). DataView Baseline widely available (2015). `getFloat16`/`setFloat16` and `Float16Array` are Baseline newly available since 2025-04-04 (Chrome 135, Firefox 129, Safari 18.2), useful for half-float GPU data.
- Sources: https://v8.dev/blog/dataview ; https://cdn.jsdelivr.net/npm/web-features/data.json

### Always pass the `littleEndian` argument; use `true` for native-order data
- Layer: v8
- Stage: script-run, gpu-upload
- Metrics: FPS/smoothness
- When: animation/render-loop, long-lived session
- Impact: medium, because the default is big-endian, which is both a byte swap on x86/ARM and a common correctness bug
- Do: Pass `true` as the last argument for little-endian data: WebGL/WebGPU buffers, WebAssembly memory, and most binary protocols. Pass `false` explicitly only for big-endian formats.
- Why: When the argument is omitted, DataView reads and writes big-endian. The post measured near-TypedArray speed only for access "aligned in the native endianness" (little-endian on Intel; ARM in browsers is also little-endian). The Torque code shows the extra byte reassembly for the non-native order.
- Example:
  ```js
  // Interleaved vertex: float32 x, float32 y, uint8 r,g,b,a  (stride 12)
  view.setFloat32(off, x, true);
  view.setFloat32(off + 4, y, true);
  view.setUint32(off + 8, rgba, true);
  ```
- Avoid/caveats: Keep multi-byte fields aligned to their size where the format allows it.
- Status: DataView Baseline widely available.
- Sources: https://v8.dev/blog/dataview

### Check bounds yourself; do not use RangeError to find the end of the data
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: long-lived session
- Impact: medium, because a throw leaves TurboFan's fast code and runs the slow builtin
- Do: Compare `offset + size` with `view.byteLength` before each read in parser loops. Keep offsets as small integers.
- Why: To keep optimized DataView code small, TurboFan code does not handle error cases: when an access would throw (out of bounds), it deoptimizes back to the baseline builtin. TurboFan code also only supports offsets in Smi range; larger offsets use the slow path. With pointer compression, Chrome's Smi range is 31-bit signed (about ±1 GiB).
- Example:
  ```js
  // Before: relies on the exception
  try { for (;;) { read(view, o); o += 16; } } catch { /* end */ }
  // After
  while (o + 16 <= view.byteLength) { read(view, o); o += 16; }
  ```
- Avoid/caveats: Not relevant for cold code.
- Status: V8 behavior described in 2018; the Smi-width detail is from the 2025 mutable-heap-number post.
- Sources: https://v8.dev/blog/dataview ; https://v8.dev/blog/mutable-heap-number

### Use fixed DataView method names at each hot call site
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low, because it matters only in hot decode/encode loops
- Do: Call `view.getFloat32(...)`, `view.getUint16(...)` directly. Do not select the method at run time (`view['get' + type](o)`) inside hot loops; generate a specialized reader per record layout instead.
- Why: The speedup depends on TurboFan recognizing that a call targets a known DataView builtin and inlining it. A call site that sees many different targets cannot be replaced by one inlined builtin.
- Example:
  ```js
  // Before
  for (const f of fields) rec[f.name] = view['get' + f.type](o + f.offset, true);
  // After: one reader per layout
  const readTick = (v, o) => { tick.t = v.getFloat64(o, true); tick.p = v.getFloat32(o + 8, true); };
  ```
- Avoid/caveats: Derived from the inlining mechanism in the post; measure.
- Status: V8 mechanism.
- Sources: https://v8.dev/blog/dataview

---

## E. Spread elements ("Speeding up spread elements", 2018-12-04)

### OBSOLETE: do not avoid `[...arr]` or `Array.from(x)` for speed; put the spread first
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: animation/render-loop, interaction
- Impact: medium, because the fast path is about 3x faster than the old iterator path and about 25% faster than a hand-written copy loop
- Do: Use `[...arr]`, `[...arr, x, y]`, or `Array.from(iterable)` (without a map function) for shallow copies. In hot code, keep the spread at the start of the literal.
- Why: Since V8 7.2, when the spread source is a fast array (one of the six common elements kinds), V8 skips the iterator object, skips the per-step `{value, done}` result objects, and allocates the result at its final size. The fast path applies when the spread is first (`[...a]`, `[...a, 1, 2]`) but not when other elements come before it (`[1, 2, ...a]`). `Array.from(x)` without a mapping function reuses the same fast path. `[...string]` is about 5x faster, and faster than a TurboFan-optimized `for-of`.
- Example:
  ```js
  const copy = [...prices];            // fast path
  const withNext = [...prices, next];  // fast path
  const withPrev = [prev, ...prices];  // generic iteration path
  ```
- Avoid/caveats: `arr.slice()` keeps holes; spread turns holes into `undefined` (different semantics). Not verified in this batch: whether a second spread (`[...a, ...b]`) and `Array.from(x, mapFn)` get fast paths; measure or use `a.concat(b)` / `arr.map(fn)`.
- Status: Obsolete "spread is slow" advice since V8 7.2 (Chrome 72). Spread syntax Baseline widely available.
- Sources: https://v8.dev/blog/spread-elements

### Spread Map keys/values and Sets, not Map entries, in hot code
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: interaction, animation/render-loop
- Impact: low, because it matters only for large collections on hot paths
- Do: Use `[...set]`, `[...set.keys()]`, `[...set.values()]`, `[...map.keys()]`, `[...map.values()]`. Treat `[...map]` and `[...map.entries()]` as the slower generic path.
- Why: V8 added fast paths for sets (about 18x faster) and for map key/value iterators (about 14x faster). It left out spreading a map directly and the `entries()` iterator as uncommon.
- Example:
  ```js
  const ids = [...seriesById.keys()];     // fast path
  const pairs = [...seriesById];          // generic iterator path
  ```
- Avoid/caveats: If you need pairs, it is fine to use entries; just do not assume the same speed.
- Status: V8 7.2+ (Chrome 72+).
- Sources: https://v8.dev/blog/spread-elements

### Never patch array or iterator built-ins
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: load, long-lived session
- Impact: medium, because one patch can disable fast paths for every array in the page
- Do: Do not define an own `Symbol.iterator` on arrays, and do not overwrite `next` on `%ArrayIteratorPrototype%` (or Set/Map/String iterator prototypes). Audit polyfills and libraries that do so.
- Why: Spread is specified through the iteration protocol, so V8 takes the fast path only while the original iteration machinery is untouched. Patching the shared iterator prototype affects all arrays, so every spread and `Array.from` falls back to the generic path.
- Example:
  ```js
  // Don't
  Object.getPrototypeOf([][Symbol.iterator]()).next = customNext;
  ```
- Avoid/caveats: none.
- Status: V8 7.2+.
- Sources: https://v8.dev/blog/spread-elements

### Avoid holey arrays, especially holey double arrays that you copy
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low, because the hole handling is still fast for Smi/object arrays; the expensive case is HOLEY_DOUBLE_ELEMENTS
- Do: Build arrays with literals or `push`, or use a typed array. Do not create holes: no elisions (`[a, , c]`), no `new Array(n)` followed by index writes, no writes past the end (`arr[arr.length + 3] = v`), no growing `arr.length`, no `delete arr[i]`.
- Why: An array with a hole switches to a HOLEY elements kind and, by default, stays holey forever. Spreading or `Array.from` must turn holes into `undefined`. A HOLEY_DOUBLE_ELEMENTS array stores unboxed doubles and cannot hold `undefined`, so copying it needs a costly elements-kind transition to a tagged kind.
- Example:
  ```js
  // Before: holey double array
  const ys = new Array(n);              // HOLEY_SMI_ELEMENTS from the start
  for (let i = 0; i < n; i++) ys[i] = price(i); // becomes HOLEY_DOUBLE_ELEMENTS
  // After: packed (or use Float64Array)
  const ys2 = [];
  for (let i = 0; i < n; i++) ys2.push(price(i)); // PACKED_DOUBLE_ELEMENTS
  ```
- Avoid/caveats: New exception (V8 commit 2025-02-28, about Chrome 135, estimate): when `Array.prototype.fill` overwrites every element of an array that still has its initial array map, V8 transitions it to the best packed kind, so `new Array(n).fill(0)` is packed. The v8.dev elements-kinds post was updated on 2025-02-28 to note this exception. For numeric series, a typed array avoids elements kinds altogether.
- Status: V8 behavior; fill exception in V8 `main` since 2025-02-28.
- Sources: https://v8.dev/blog/spread-elements ; https://v8.dev/blog/elements-kinds ; https://github.com/v8/v8/blob/main/src/builtins/builtins-array.cc

---

## F. Class features ("Faster initialization of instances with new class features", 2022-04-20)

### OBSOLETE: do not avoid class fields or `#private` fields for speed; emit them natively
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, startup
- When: load, animation/render-loop
- Impact: medium, because field initialization was a runtime call per field before V8 9.7 and now uses inline caches like normal property stores
- Do: Declare instance state as class fields (`x = 0;`, `#cache = null;`). Compile TypeScript with `target` ES2022 or later so fields reach V8 as native class fields.
- Why: Before V8 9.7, each field initializer called `%CreateDataProperty` or `%AddPrivateField` in the runtime. V8 9.7 routes them through `DefineNamedOwnIC` (named public fields) and `DefineKeyedOwnIC` (private and computed fields), with feedback that records the key and the hidden-class transition, so repeated construction takes pre-generated fast code.
- Example:
  ```ts
  class Series {
    #points: Float64Array;
    visible = true;
    constructor(n: number) { this.#points = new Float64Array(n); }
  }
  ```
- Avoid/caveats: Fields use define semantics: they do not call setters inherited from a base class. TypeScript `useDefineForClassFields` defaults to `true` when `target` is ES2022 or higher (including ESNext). With `useDefineForClassFields: true` and an older target, TypeScript emits `Object.defineProperty` calls, which do not use the optimized native path (not measured here). Node.js returned to private fields in core classes after this fix with no benchmark regressions.
- Status: Obsolete advice since V8 9.7 (Chrome 97; Node.js 18). Public class fields Baseline since 2022-09-12; private fields 2021-07-13; private methods 2021-09-20 (all widely available now).
- Sources: https://v8.dev/blog/faster-class-features ; https://cdn.jsdelivr.net/npm/web-features/data.json ; https://github.com/microsoft/TypeScript-Website/blob/v2/packages/tsconfig-reference/scripts/tsconfigRules.ts

### Keep instance initialization predictable so the field IC stays on the fast path
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: animation/render-loop, load
- Impact: medium, because each unpredictable construction falls back to a runtime call
- Do: Construct hot types the same way every time. Do not return a different object or a `Proxy` from a base-class constructor. Do not let a base constructor create a property that a subclass also declares as a field.
- Why: The IC fast path applies when fields are initialized in the same order on instances with the same hidden class. V8 falls back to the runtime when the target is a proxy, when the field being defined already exists on the object, or when the object has a hidden class the IC has not seen.
- Example:
  ```ts
  // Before: subclass re-defines a property the base already created -> runtime path
  class Base { constructor() { this.color = 'red'; } }
  class Line extends Base { color = 'blue'; }

  // After: one owner per field
  class Base2 { color: string; constructor(c = 'red') { this.color = c; } }
  class Line2 extends Base2 { constructor() { super('blue'); } }
  ```
- Avoid/caveats: The "return override" trick (base constructor returns another object) is rare; keep it out of hot types.
- Status: V8 9.7+.
- Sources: https://v8.dev/blog/faster-class-features

### Call `super()` directly in the constructor of classes with private methods
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low, because the slow case is rare
- Do: In a derived class that has `#methods` or `#accessors`, call `super()` in the constructor body, not from a nested arrow function.
- Why: After `super()` returns, V8 installs a private "brand" on the instance. With a direct call it uses the fast `DefineKeyedOwnProperty` bytecode; from a nested arrow it must walk the context chain in the runtime (`%AddPrivateBrand`), so construction is slower. Private methods themselves are memory-cheap: they are stored once per class in a context, and each instance holds only the brand.
- Example:
  ```ts
  class Tool extends Base {
    #snap() {}
    constructor(opts) { super(opts); } // not: const s = () => super(opts); s();
  }
  ```
- Avoid/caveats: none.
- Status: V8 9.7+.
- Sources: https://v8.dev/blog/faster-class-features

---

## G. Mutable heap numbers ("Turbocharging V8 with mutable heap numbers", 2025-02-25)

### Keep numeric variables in script and closure scopes type-stable
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop, long-lived session
- Impact: medium, because a type change deoptimizes every function that depends on that variable's slot type
- Do: A `let` that holds a number must only ever hold numbers. Do not write `undefined`, `null`, a string, or an object into it later; use a separate flag variable or `NaN`/`-1` sentinels.
- Why: V8 now tracks a type per context slot (constant, Smi, Int32, double, or generic "other"). For a number slot it owns a mutable HeapNumber and updates it in place, so optimized code allocates nothing on update. Optimized code depends on that slot type; writing a different type deoptimizes it, and "other" is a sink state with no way back. Before this change, every update of a non-Smi number in a context slot allocated a new immutable HeapNumber.
- Example:
  ```js
  // Before: sentinel of a different type
  let lastPrice = undefined;   // slot becomes generic
  // After
  let lastPrice = NaN;         // always a number
  let hasLastPrice = false;
  ```
- Avoid/caveats: The post covers the script context (top-level `let`/`const` of classic scripts). V8 `main` also enables `function_context_cells` (commit 2025-05-20, about Chrome 138, estimate) but limits it to function contexts with at most 2 slots (`function_context_cells_max_size = 2`). Not verified here: ES module scope. The gain appears only in optimized code (a 2024-11-27 commit disables the feature when the top tier is unoptimized code).
- Status: V8/Chrome: script-context mutable heap numbers enabled 2024-11-25 and Int32 slots 2025-01-09 in V8 `main` (about Chrome 133 and 134, estimate). Other engines store doubles differently; the type-stability advice still costs nothing there.
- Sources: https://v8.dev/blog/mutable-heap-number ; https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h ; https://github.com/v8/v8/commits/main (GitHub commit search)

### Keep integer state in Int32 range with signed bitwise operators
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low, because it matters for hash, PRNG, index, and bit-packing code in hot paths
- Do: Normalize integer math with `| 0` or `& mask` so values stay signed 32-bit integers. Avoid `>>> 0` for state you store back, because results at or above 2^31 are outside Int32 and turn the slot into a double.
- Why: If a slot only receives Int32 values, V8 stores the value as a raw Int32 inside the mutable HeapNumber and optimized code uses integer instructions. The post's PRNG got about 2.5x faster on async-fs (about 1.6% on JetStream2) because the bit masks keep `seed` in Int32.
- Example:
  ```js
  let seed = 12345;
  function rand() {
    seed = (seed + 0x6d2b79f5) | 0;               // stays Int32
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // unsigned only in the returned temp
  }
  ```
- Avoid/caveats: Bitwise operators truncate to 32 bits; do not use them on prices, timestamps, or other values that need more than 32 bits.
- Status: V8 (Int32 slots enabled 2025-01-09 in `main`, about Chrome 134, estimate).
- Sources: https://v8.dev/blog/mutable-heap-number

### Use `const` for values that never change, and do not reassign "constant" `let`s later
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: load, long-lived session
- Impact: low, because it affects only code that reads such values in hot paths
- Do: Declare configuration values and feature flags with `const`. If a top-level `let` is set once at init, set it before hot code runs, not later in the session.
- Why: V8's const tracking treats script-context `let` variables that were initialized but never modified as constants, so optimized code can fold them. The first later write invalidates that assumption and the dependent optimized code.
- Example:
  ```js
  const MAX_POINTS = 1_000_000;          // folded
  let debugOverlay = false;              // tracked as constant until the first write
  ```
- Avoid/caveats: none.
- Status: V8 (const-tracking let; flag `script_context_cells` defaults to true in `main`).
- Sources: https://v8.dev/blog/mutable-heap-number ; https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h

### Remember that Smis are 31-bit; store large integers such as epoch-ms timestamps in `Float64Array`
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: memory, FPS/smoothness
- When: long-lived session
- Impact: medium, because timestamps and large ids are never Smis, so in tagged slots they are HeapNumbers
- Do: Keep bulk timestamps, volumes, and large ids in `Float64Array` columns. For single values in object fields or closures, keep the field always a double (do not mix with strings or `null`).
- Why: On the default 64-bit V8 configuration (pointer compression) each tagged value is 32 bits; a tag bit leaves a 31-bit Smi (about -1.07e9 to 1.07e9). Numbers outside that range or with fractions live in HeapNumbers. Epoch milliseconds (about 1.7e12) are therefore always doubles. Double arrays store unboxed doubles (PACKED_DOUBLE_ELEMENTS), and object fields and (now) context slots use mutable boxes updated in place, but mixed types break both.
- Example:
  ```js
  const time = new Float64Array(capacity); // epoch ms, unboxed, no per-value allocation
  time[i] = Date.now();
  ```
- Avoid/caveats: Node.js builds without pointer compression use 32-bit Smis; the Chrome limit is the one that matters in the browser.
- Status: V8 with pointer compression (Chrome 64-bit desktop and Android).
- Sources: https://v8.dev/blog/mutable-heap-number ; https://v8.dev/blog/spread-elements

---

## Sources read
- https://v8.dev/blog/trash-talk
- https://v8.dev/blog/explicit-compile-hints
- https://v8.dev/blog/preparser
- https://v8.dev/blog/dataview
- https://v8.dev/blog/spread-elements
- https://v8.dev/blog/faster-class-features
- https://v8.dev/blog/mutable-heap-number
- https://v8.dev/blog/elements-kinds (for exact HOLEY causes and the 2025-02-28 fill update)
- https://github.com/WICG/explicit-javascript-compile-hints-file-based/blob/main/README.md
- https://chromestatus.com/feature/5100466238652416 (read through the chromestatus JSON API)
- https://chromestatus.com/feature/5153430045458432 (read through the chromestatus JSON API)
- https://github.com/evanw/esbuild/issues/4247 (issue and comments through the GitHub API)
- https://raw.githubusercontent.com/rollup/rollup/master/docs/configuration-options/index.md (output.banner)
- https://github.com/terser/terser/blob/master/README.md and CHANGELOG.md (wrap_func_args, wrap_iife, negate_iife)
- https://github.com/rolldown/rolldown/pull/5319 (bundler PIFE use; blog-level claim about arrow PIFEs, verified in V8 source)
- https://github.com/oxc-project/oxc/pull/26938 (PIFE detection; open PR)
- https://raw.githubusercontent.com/v8/v8/main/src/parsing/parser-base.h (PIFE patterns, compile-hint flags)
- https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h (minor_ms experimental; script_context_cells, function_context_cells)
- https://raw.githubusercontent.com/v8/v8/main/src/builtins/builtins-array.cc and V8 commit "[array] Array.fill tries to transition to optimal elements kind" (2025-02-28)
- V8 commit history via GitHub commit search (mutable heap number and Int32 slot enablement dates)
- https://www.mail-archive.com/v8-dev@googlegroups.com/msg162435.html (fill discussion, 2025-02-12)
- https://cdn.jsdelivr.net/npm/web-features/data.json (Baseline dates: class fields, private methods, Float16Array, DataView, spread, Array.from, resizable buffers)
- https://github.com/microsoft/TypeScript-Website (useDefineForClassFields default rule)

## Not covered / could not access
- chromestatus.com HTML pages render with JavaScript; WebFetch returned only the title. I used the chromestatus JSON API instead. The per-file feature record still shows "Origin trial" as its status text, but its ship stage is Chrome 136, which matches the V8 post.
- Exact Chrome milestones for mutable heap numbers (script and function contexts) and for the `fill` packed transition are not in any post; I estimated them from V8 commit dates against the Chrome branch schedule.
- Not verified: whether mutable number slots apply to ES module scope; whether `[...a, ...b]` (second spread) or `Array.from(x, mapFn)` get fast paths; DataView speed in Maglev and on resizable `ArrayBuffer`s; the cost of TypeScript's downleveled `Object.defineProperty` field emit.
- The "Minor Mark-Sweep" young-generation collector exists in V8 but is experimental (off by default) as of V8 `main` 2026-09; no v8.dev post announces it as default, so GC rules above assume the Scavenger.
- Idle-time GC details come from the 2019 post (and its linked ACM paper, not read); I found no newer post that changes the guidance.
