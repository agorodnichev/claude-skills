# V8 deep read, batch 5 of 8: arity-mismatch calls, v7.8 (preload streaming, destructuring, lazy source positions), code caching after execution, background compilation, hidden hash codes, WeakRef/FinalizationRegistry, JS-to-DOM tracing

Scope: developer-facing rules from seven v8.dev posts: Faster JavaScript calls (2021-02-15), V8 release v7.8 (2019-09-27), Improved code caching (2018-04-24), Background compilation (2018-03-26), Optimizing hash tables: hiding the hash code (2018-01-29), Weak references and finalizers (2019-07-09, updated 2020-06-19), Tracing from JS to the DOM and back again (2018-03-01).
Each rule names the engine mechanism and marks advice that later versions made obsolete. "Latest" status was checked on 2026-09-23 against Chromium `main` (`v8_code_cache.cc`, `v8_script_runner.cc`, `script_streamer.cc`, `script_resource.cc`, `script_cached_metadata_handler.cc`, `v8_local_compile_hints_producer.cc`, `local_frame.cc`, `blink/common/features.cc`, `runtime_enabled_features.json5`), V8 `main` (`flag-definitions.h`, `map.cc`, `map-inl.h`, `property-array.h`, `property-details.h`, `js-objects.h`, `code-serializer.cc`, `BUILD.gn`), BCD 8.1.2 (2026-09-17), webstatus.dev, MDN, and developer.chrome.com.
Raw pages and source files are saved in `raw/v8-batch-5/`. Related rules that other batches already cover are cross-referenced, not repeated.

---

## A. Faster JavaScript calls (2021-02-15): removal of the arguments adaptor frame

### Pass fewer or more arguments than declared when the API needs it; do not pad calls to match the parameter count (OBSOLETE workaround since V8 8.9)
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: low. Since Chrome 89 a mismatched call costs about the same as a matched call, so the old workaround gains nothing.
- Do: Use optional trailing parameters and default values freely. Delete code that exists only to match argument counts, for example passing explicit `undefined`s, one wrapper per arity, or `fn.length`-based dispatch for speed. Spend the effort on keeping each call site's target stable (monomorphic) instead.
- Why: Before V8 8.9, every call with an argument/parameter count mismatch went through `ArgumentsAdaptorTrampoline`. It built an extra frame and copied the arguments so the callee saw exactly its declared count, and optimized code paid the most. V8 8.9 pushes arguments in reverse order and stores the actual argument count in the callee frame. If there are too few arguments, V8 pads them with `undefined` in place. If there are too many, the callee's epilogue pops them. The post measured up to 40% faster mismatched calls in TurboFan code, 11.2% in the interpreter, and 4.6-7% on some real benchmarks. The micro-benchmark was built to show the largest possible effect.
- Example:
  ```js
  // Before (pre-2021 workaround): pad to the declared arity
  drawSeries(ctx, points, undefined, undefined);

  // After: pass what you have; defaults fill the rest
  function drawSeries(ctx, points, color = '#0af', width = 1) { /* ... */ }
  drawSeries(ctx, points);
  ```
- Avoid/caveats: `arguments` and rest parameters still create an object or array when the function uses them (see 08-v8-batch-01 "Use real arrays and rest parameters instead of array-likes and `arguments`"). A default initializer runs on every call that omits the argument, so `opts = {}` allocates a new object on each such call in a hot path. Prefer a shared frozen default, or pass the object.
- Status: V8 8.9 / Chrome 89 stable (March 2021) and later. Node.js 16+ ships V8 9.0 (Node 16.0.0 release notes). The post does not cover other engines.
- Sources: https://v8.dev/blog/adaptor-frame ; https://v8.dev/blog/v8-release-89 ; https://nodejs.org/en/blog/release/v16.0.0

---

## B. V8 release v7.8 (2019-09-27)

### Make every startup script visible to the preload scanner (or preload it) so that Chrome compiles it while it downloads
- Layer: html
- Stage: preload-scan, network, script-compile
- Metrics: FCP, LCP, TBT, startup
- When: load
- Impact: medium. In V8's experiment, the time between "`<script>` tag seen" and "script starts to run" dropped by 5-20% on average, and to zero in some cases.
- Do: Reference startup scripts with `<script src>` in the initial HTML. For a script that the parser finds late (injected by JS or by a loader), add `<link rel="preload" as="script" href="...">` in `<head>`. For ES modules, use `<link rel="modulepreload">` (next rule).
- Why: Since Chrome 76 (experiment) and Chrome 78 (default), a script that the preload scanner or a preload link fetches starts streaming. V8 parses and compiles it on a background thread while the bytes arrive, instead of waiting until the HTML parser reaches the tag. This matters most for parser-blocking scripts, because the parser can continue as soon as compilation is already done. Current Chromium starts streaming any http(s) script resource after the first 4 bytes arrive (the BOM check in `ResourceScriptStreamer::TryStartStreamingTask`).
- Example:
  ```html
  <head>
    <link rel="preload" as="script" href="/js/chart-bootstrap.3f9a.js">
    <!-- ... -->
  </head>
  ```
- Avoid/caveats: Every preload competes for bandwidth with LCP resources, so preload only scripts that run in the first seconds. Chrome does not stream a resource that already has a code cache. V8 deserializes the cache instead, and current Chrome also does that off the main thread (`kConsumeCodeCacheOffThread`, enabled by default). Streaming needs UTF-8 or Latin-1 source (see section D).
- Status: Chrome 78+. `<link rel="preload">` is Baseline widely available (webstatus: low 2021-01-26, high 2023-07-26).
- Sources: https://v8.dev/blog/v8-release-78 ; Chromium `third_party/blink/renderer/bindings/core/v8/script_streamer.cc` (main, 2026-09-23) ; https://webstatus.dev/features/link-rel-preload

### Preload ES modules with `rel="modulepreload"`: a `rel="preload" as="script"` module streams as classic and Chrome discards that work
- Layer: html
- Stage: preload-scan, script-compile
- Metrics: LCP, TBT, startup
- When: load
- Impact: medium. A mismatch throws away the background parse and compile, and the module compiles again when it runs.
- Do: `<link rel="modulepreload" href="/app/chart-core.js">` for every module on the critical path. Use `rel="preload" as="script"` only for classic scripts.
- Why: Chromium picks the streaming type from the initial request. A `preload as=script` request is classic, and it is treated as a module only when the preload is unused and its URL path ends in `.mjs` (crbug 1178198). When the module `<script>` takes the streamer, `ScriptStreamer::TakeFrom` finds a classic/module mismatch and drops the result (`kErrorScriptTypeMismatch`). The code cache has the same split: V8's code-cache source hash includes an "is module" bit, so a classic cache never serves a module (`SerializedCodeData::SourceHash`).
- Example:
  ```html
  <!-- Before: streamed as classic, then thrown away -->
  <link rel="preload" as="script" href="/app/chart-core.js">
  <!-- After -->
  <link rel="modulepreload" href="/app/chart-core.js">
  ```
- Avoid/caveats: For the module-graph and credentials details, see 08-v8-batch-02 "Declare the critical module graph with `<link rel="modulepreload">`".
- Status: `modulepreload` is Baseline widely available (webstatus: low 2023-09-18, high 2026-03-18; Chrome 66, Firefox 115, Safari 17).
- Sources: https://v8.dev/blog/v8-release-78 ; Chromium `script_streamer.cc` (`ScriptTypeForStreamingTask`, `TakeFrom`) ; V8 `src/snapshot/code-serializer.cc` ; https://webstatus.dev/features/modulepreload

### Use object destructuring freely: it compiles to the same bytecode as plain property loads (OBSOLETE: "destructuring is slower")
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: low. There is no cost left to avoid.
- Do: Write `const { open, high, low, close } = bar;` in hot code. Do not desugar it by hand for speed, and do not keep a transpiler transform for destructuring for performance reasons.
- Why: Since V8 7.8, `const {x, y} = o` produces the same bytecode as `const x = o.x; const y = o.y`. Before, V8 ran an explicit null/undefined check to throw the special "Cannot destructure" error. Now it lets the property load throw and changes the error message only when the throw came from a destructuring.
- Avoid/caveats: The post covers object destructuring only. Array destructuring (`const [a, b] = pair`) uses the iterator protocol. V8's fast paths for it depend on unmodified array iterators (see 08-v8-batch-03 "Never patch array or iterator built-ins"). For bulk numeric data, read typed arrays by index. Object rest (`const { a, ...rest } = o`) always allocates a new object.
- Status: V8 7.8 / Chrome 78 (October 2019). Destructuring is Baseline widely available (webstatus: high 2022-07-15).
- Sources: https://v8.dev/blog/v8-release-78 ; https://webstatus.dev/features/destructuring

### Do not create Errors or read `error.stack` on hot paths; read the stack only in the reporting path
- Layer: js
- Stage: script-run, script-compile, gc-memory
- Metrics: INP, TBT, memory
- When: interaction, long-lived session
- Impact: medium when it happens per tick, per message, or per frame; low otherwise.
- Do: Do not use `new Error().stack` or `console.trace()` to log call sites in tick, render, or input handlers. Do not throw for expected outcomes in tight loops, such as a malformed market-data message or an invalid user value. Return a result value instead. Read `.stack` once, when you actually report an error.
- Why: V8 walks the stack when it creates an Error (up to `Error.stackTraceLimit`, default 10 frames) and formats the string lazily on the first `.stack` access. Since V8 7.8, bytecode is compiled without source-position tables. The first time a stack is symbolized, V8 must reparse and recompile each function in the trace to rebuild its positions. In lab tests this saved 1-2.5% of V8 memory, but it makes the first symbolization of each function slow.
- Example:
  ```js
  // Before: throws and builds a stack for every bad row
  function parseRow(s) { if (!s.includes(',')) throw new Error('bad row'); /* ... */ }

  // After: expected failures are values
  function parseRow(s) {
    if (!s.includes(',')) return null;           // caller counts and skips
    /* ... */
  }
  ```
- Avoid/caveats: When DevTools or a profiler is attached, V8 collects source positions eagerly, so stack cost and memory differ from production. Measure with DevTools closed. `Error.stackTraceLimit` is non-standard. Setting it to `0` turns stack capture off, but it also removes the diagnostics, so never set it globally in app code.
- Status: Lazy source positions are still the default in V8 (`v8_enable_lazy_source_positions = true` in V8 `BUILD.gn`, 2026-09-23). `Error.captureStackTrace`: Chrome 3, Firefox 138, Safari 17.2. `Error.stackTraceLimit`: Chrome 3, Safari 11.1, Firefox 153, non-standard (BCD 8.1.2).
- Sources: https://v8.dev/blog/v8-release-78 ; https://v8.dev/docs/stack-trace-api ; V8 `BUILD.gn` and `src/flags/flag-definitions.h` (`stack_trace_limit` = 10)

### Anchor test and parse RegExps (`^...$` or the sticky `y` flag) so that the engine does not try every start position
- Layer: js
- Stage: script-run
- Metrics: INP, TBT
- When: interaction, load (parsing payloads)
- Impact: low. It matters only for many regex calls on long inputs that usually fail.
- Do: Anchor patterns that must match the whole string (`/^\d+(\.\d+)?$/`). For tokenizers, use a sticky regex with `lastIndex`. For fixed substrings, use `startsWith`, `endsWith`, or `includes` instead of a regex.
- Why: The post explains that a RegExp search tries a match at each start position in turn. Since V8 7.8, V8 stops trying once the remaining input is shorter than the pattern's minimum match length (20% on JetStream 2 UniPoker). An anchored or sticky pattern tries only one position.
- Avoid/caveats: The post measured only the automatic end-of-input cutoff. The anchoring advice is general regex-engine behavior, not a V8 measurement. For other RegExp fast-path rules, see 08-v8-batch-04 "Keep RegExp instances and RegExp.prototype unmodified...".
- Status: The cutoff ships in V8 7.8+. The sticky flag is ES2015 and all current engines support it.
- Sources: https://v8.dev/blog/v8-release-78

---

## C. Improved code caching (2018-04-24)

### Know what goes into Chrome's code cache: the functions compiled by the end of the script's top-level run, plus functions that local compile hints recorded
- Layer: v8
- Stage: script-compile, script-run
- Metrics: startup, TBT, INP (first interactions after load)
- When: load
- Impact: medium-high. Caching after execution cut parse and compile time by 20-40% in V8's benchmarks and in field data, and time-to-interactive on Android by 1-2%.
- Do: Make sure that code which must be fast on repeat visits runs (and so compiles) during the script's first top-level run, or mark its file with an explicit compile hint (see 08-v8-batch-03 "Mark a startup-critical file with `//# allFunctionsCalledOnLoad`"). Keep that path deterministic (see 08-v8-batch-02 "Keep the code path at startup deterministic"). Do not wrap library code in IIFEs only "to get it cached". That was the pre-Chrome-66 behavior.
- Why: Ignition keeps context-specific data in feedback vectors, apart from the bytecode, so bytecode can be serialized after it has run. Since Chrome 66, Chrome requests the cache (`ScriptCompiler::CreateCodeCache`) after top-level execution, so lazily compiled functions that already ran are included. Before, only eagerly compiled code (top-level code and IIFEs) was cached. Current Blink (`V8ScriptRunner::CompileAndRunScript`, 2026-09-23) still produces the classic-script cache synchronously, right after `RunCompiledScript`. For modules, it posts a task after successful module evaluation. Functions that first run later (event handlers, promise continuations, timers, rAF callbacks) are not in the cache. For main-frame classic scripts, Chrome's local compile hints (`LocalCompileHints`, enabled by default) record the functions used until first meaningful paint or interactive. On the next visit V8 compiles those eagerly, so the cache produced then includes them.
- Example:
  ```html
  <script src="/app.3f9a.js" defer></script>
  ```
  ```js
  // app.js
  // Before: init first runs from an event, after the cache was already produced
  document.addEventListener('DOMContentLoaded', () => initChartShell());
  // After: `defer` already runs after parsing, so call init at top level
  initChartShell();
  ```
- Avoid/caveats: Heavy synchronous top-level work is a long task, so do not move work to the top level only to game the cache (see 08-v8-batch-01 "Break long script execution into short tasks"). The local-compile-hints producer records only `ClassicScript`s in the main frame, so module-based apps (Vite/SvelteKit output) do not get this automatic help. The V8 team's first advice is still "do nothing": the heuristics change between releases.
- Status: Chrome 66+ (April 2018). Behavior confirmed on Chromium main, 2026-09-23. The mechanism is Chromium-only. Firefox and Safari have their own bytecode caches, which these posts do not cover.
- Sources: https://v8.dev/blog/improved-code-caching ; Chromium `v8_script_runner.cc`, `v8_local_compile_hints_producer.cc`, `local_frame.cc` (`MainFrameInteractive`, `MainFrameFirstMeaningfulPaint`), `blink/common/features.cc` (`kLocalCompileHints` ENABLED_BY_DEFAULT) ; https://v8.dev/blog/code-caching-for-devs

### Expect the disk code cache from the third load within 72 hours, and make scripts eligible for it
- Layer: network
- Stage: network, script-compile
- Metrics: startup, TBT
- When: load, testing
- Impact: medium. It removes most parse and compile time for returning users, and scripts that do not qualify never get it.
- Do: Serve startup JS as external http(s) files of at least 1 KiB (1024 characters), with stable content-hashed URLs and long cache lifetimes. Do not ship large code as inline `<script>` or as `blob:`/`data:` URLs, and do not `eval` or `new Function` fetched text, if you want repeat-visit savings. Test cold, warm, and hot runs separately.
- Why: Current Chromium (`V8CodeCache::GetCompileOptionsInternal`, 2026-09-23) works in three steps. Load 1 stores only a timestamp. A load within 72 hours of that timestamp (`kHotHours`) produces the code cache. The next load consumes it. Non-inline scripts under 1024 characters are never cached (`kNoCacheBecauseScriptTooSmall`). Inline scripts get no cache while the `InlineScriptCache` feature is disabled, which is the default. Only http-family URLs (plus some special schemes) get a cache handler (`ScriptResource::ResponseReceived`). A script served from Cache Storage skips the heat check and produces its cache on the first load. V8 rejects cache data when the V8 version, flags, source length, or classic/module kind do not match. In 2018 the hit rate for cacheable scripts was about 86%.
- Avoid/caveats: A deploy that changes a file's bytes resets its heat. Split rarely changing vendor code from app code (see 08-v8-batch-02 "Split stable library code from frequently changing app code"). Service-worker precache in `install` creates a full, eager cache (see 08-v8-batch-02 "Precache critical classic scripts in the service worker `install` event"). Each Chrome update also invalidates cached code (`CachedDataVersionTag`).
- Status: Chromium-only. The thresholds come from Chromium main (2026-09-23) and can change without notice.
- Sources: https://v8.dev/blog/improved-code-caching ; Chromium `v8_code_cache.cc`, `script_resource.cc`, `blink/common/features.cc` (`kInlineScriptCache` DISABLED_BY_DEFAULT, `min_script_length` 1024) ; V8 `code-serializer.cc`

---

## D. Background compilation (2018-03-26)

### Ship startup JS as external, streamable UTF-8 files: inline, `eval`, and `new Function` code compiles on the main thread
- Layer: v8
- Stage: network, script-compile, main-thread-task
- Metrics: TBT, INP, FCP, LCP, startup
- When: load
- Impact: medium-high. Background bytecode compilation alone cut main-thread compile time by 5-20% on typical sites in 2018, and later streaming work added to that.
- Do: Load JS with `<script src>` (classic `defer`/`async`, or `type="module"`). Do not fetch JS text and run it with `eval`, `new Function`, or `document.write`, and do not inline large scripts. Serve JS as UTF-8, for example `Content-Type: text/javascript; charset=utf-8` or UTF-8 bytes in a UTF-8 document.
- Why: Since Chrome 41, V8 parses streamed scripts on a background thread. Since Chrome 66, it also generates Ignition bytecode there, and only the short AST-internalization and bytecode-finalization steps stay on the main thread. Script streaming exists only for fetched script resources. Chromium's inline-script precompile experiment (`kPrecompileInlineScripts`) is disabled by default, so inline and `eval` code parses and compiles on the main thread. `ScriptStreamer::ConvertEncoding` accepts only UTF-8, windows-1252, ISO-8859-1, and US-ASCII. A UTF-16 script is not streamed, because two-byte sources are excluded to avoid handling endianness.
- Example:
  ```js
  // Before: main-thread compile, no streaming, no disk code cache
  const src = await (await fetch('/js/indicators.js')).text();
  new Function(src)();

  // After: streamed, compiled off-thread, cacheable
  await import('/js/indicators.3f9a.js');
  ```
- Avoid/caveats: A small inline bootstrap (under about 1 KB) is fine. `blob:` and `data:` scripts are never code-cached, and streaming for non-HTTP scripts is enabled on desktop but disabled on Android (`kScriptStreamingForNonHTTP`). This also applies to "inline worker" patterns that build a worker from a Blob URL. Blob-URL workers are an inference from these rules and were not checked in the worker loader.
- Status: Chrome 41 (streaming parse) and Chrome 66 (background bytecode compile). Current per Chromium main (`script_streamer.cc`, `blink/common/features.cc`, 2026-09-23).
- Sources: https://v8.dev/blog/background-compilation ; Chromium `script_streamer.cc`, `script_resource.cc`, `blink/common/features.cc`

### Expect lazily compiled inner functions to compile on the main thread at their first call, and keep the first-interaction path small
- Layer: v8
- Stage: script-compile, main-thread-task
- Metrics: INP, TBT
- When: load, interaction
- Impact: medium. The first pan, zoom, or order-ticket open pays a main-thread compile for every function it reaches for the first time.
- Do: Keep the code that the first user interaction needs small. For a file whose functions nearly all run at load, use the explicit compile hint (see 08-v8-batch-03 "Mark a startup-critical file with `//# allFunctionsCalledOnLoad`"). Put rarely used features behind dynamic `import()` so they do not grow startup files (see 08-v8-batch-02 "Load non-critical features with dynamic `import()` at the moment of user intent").
- Why: The 2018 post states that only top-level code and IIFEs compile in the background, while inner functions are compiled lazily, on the main thread, when they first run. That is still V8's default model. A function is only pre-parsed until its first call, unless an IIFE/PIFE heuristic, a compile hint, or the code cache supplies it.
- Avoid/caveats: Eagerly compiling everything costs memory and background time, so hint only code that really runs early. Automatic wrapping in parentheses is obsolete (see 08-v8-batch-03 "OBSOLETE: do not wrap functions in parentheses automatically").
- Status: Current V8 behavior (lazy compilation is the default).
- Sources: https://v8.dev/blog/background-compilation ; https://v8.dev/blog/improved-code-caching

---

## E. Optimizing hash tables: hiding the hash code (2018-01-29)

### Use objects directly as Map, Set, WeakMap, and WeakSet keys: adding a key does not change its shape
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium. Fixing this made the SixSpeed Map/Set benchmark about 500% faster and one Ember benchmark 18% faster.
- Do: Key maps and sets by the object itself (series, drawing, DOM node, order). Do not add `obj.__id` or symbol ids to objects only so that you can use them as keys, and do not avoid object keys out of concern for shapes.
- Why: V8's object hash code is a random number, so it must be stored. Before V8 6.3 it was stored as a hidden private-symbol property. This caused a hidden-class transition on the key, and lookups became megamorphic when keys had different shapes. Since V8 6.3 the hash lives in the object's properties slot. With no out-of-object properties it sits directly in that slot. With a property array it sits in the unused high bits of the array's Smi length field. With a dictionary it gets its own slot. Hash reads skip the property-lookup machinery and never change the object's map.
- Example:
  ```js
  // Before: mutates every drawing's shape just to key it
  drawing.__id ??= nextId++;
  selection.set(drawing.__id, state);

  // After
  selection.set(drawing, state);
  ```
- Avoid/caveats: A Map lookup is still a hash plus a table probe, which is slower than reading a declared field. For per-frame data on your own classes, store it in a constructor-initialized field.
- Status: V8 6.3+ (Chrome 63, December 2017). Map, Set, and WeakMap are Baseline widely available (webstatus: high 2018-01-29).
- Sources: https://v8.dev/blog/hash-code ; V8 `src/objects/property-array.h` (`LengthField` 10 bits, `HashField` in the remaining Smi bits) ; https://webstatus.dev/features/map

### Store metadata about objects you do not own in a WeakMap, not in an expando property
- Layer: js
- Stage: script-run, gc-memory
- Metrics: INP, memory
- When: interaction, long-lived session
- Impact: medium. Expandos on shared objects can make hot code in libraries (charting engine, framework) polymorphic, and a Map would keep dead objects alive.
- Do: Use `const info = new WeakMap(); info.set(node, meta);`, not `node._meta = meta`. Do this for DOM nodes, library objects (for example chart series or annotations), and objects that other modules share.
- Why: An expando adds a property, which causes a map transition. Objects that then reach the library's hot code with extra maps make its inline caches polymorphic or megamorphic. A WeakMap entry stores only the hash in the key's hidden properties slot, with no transition. The entry also dies with its key: a WeakMap is an ephemeron, which holds the value strongly only while the key is alive. A plain `Map` keeps every key alive.
- Avoid/caveats: A WeakMap lookup is slower than a field load. For your own classes, declare the field. That large WeakMaps add work to GC marking (ephemeron processing) is engine knowledge, not something these posts measure.
- Status: WeakMap is Baseline widely available (webstatus: high 2018-01-29).
- Sources: https://v8.dev/blog/hash-code ; https://v8.dev/features/weak-references ; https://webstatus.dev/features/weakmap

### Do not grow objects with computed keys: after about 12 extra properties added by keyed stores, V8 switches the object to dictionary mode
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: interaction, animation/render-loop, long-lived session
- Impact: medium-high for objects that hot code reads. Dictionary-mode objects lose fast inline-cached property access.
- Do: Use `Map` for dynamic key sets, such as quotes by symbol or series by id. For records, declare all fields in the constructor or in one object literal. Do not build large objects with `obj[key] = value`.
- Why: The post describes three states for the properties backing store: empty, array (limited to 1022 values in 2018), and dictionary. Current V8 (`Map::TooManyFastProperties`, `map-inl.h`, 2026-09-23) normalizes an object to dictionary mode when a keyed store (`o[k] = v`) adds a new property, the object has no spare field slots, and its out-of-object fields exceed the larger of `--fast-properties-soft-limit` (12) and its in-object property count. Named stores (`o.x = v`) and prototype objects are exempt from this soft limit. Any object that reaches 1020 own descriptors (`kMaxNumberOfDescriptors`) also becomes a dictionary. For `delete`, see 08-v8-batch-01.
- Example:
  ```js
  // Before: becomes a dictionary-mode object after roughly 16 symbols ({} has 4 in-object slots + 12)
  const lastPrice = {};
  for (const q of quotes) lastPrice[q.symbol] = q.price;

  // After
  const lastPrice = new Map();
  for (const q of quotes) lastPrice.set(q.symbol, q.price);
  ```
- Avoid/caveats: Dictionary mode is correct for a true dictionary. A `Map` just says so explicitly and adds `size` and cheap iteration. The "16" in the example depends on the in-object slack of `{}` (4 slots), which can change between V8 versions.
- Status: Current V8 main (`flag-definitions.h`: `fast_properties_soft_limit` = 12; `property-details.h`: `kMaxNumberOfDescriptors = (1 << 10) - 4`).
- Sources: https://v8.dev/blog/hash-code ; V8 `src/objects/map-inl.h`, `src/objects/map.cc` (`TransitionToDataProperty`), `src/flags/flag-definitions.h`, `src/objects/property-details.h`

### Look up a Map once per operation: use `get` and test for `undefined`, or `getOrInsertComputed`, not `has` + `get` + `set`
- Layer: js
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: animation/render-loop, interaction
- Impact: low-medium, and only in tight loops over large tables.
- Do: `let bucket = m.get(key); if (bucket === undefined) { bucket = []; m.set(key, bucket); }`. Where Baseline 2026 is acceptable, use `m.getOrInsertComputed(key, () => [])`.
- Why: Each call hashes the key and probes the table. For an object key, "hashing" means reading the stored hash (see above). For a string key, it means reading the string's cached hash. `has` followed by `get` does this twice. This follows from the data structure. The post measured hash storage, not call counts.
- Avoid/caveats: `getOrInsert(key, value)` evaluates its value argument on every call, so it allocates when that argument is `[]` or `{}`. Use `getOrInsertComputed` for allocated defaults. When `undefined` is a valid stored value, you still need `has`.
- Status: `Map.prototype.getOrInsert` / `getOrInsertComputed` (also on WeakMap): Baseline 2026, newly available (webstatus low date 2026-02-14; Chrome 145, Firefox 144, Safari 26.2).
- Sources: https://v8.dev/blog/hash-code ; https://webstatus.dev/features/getorinsert ; BCD 8.1.2 `javascript.builtins.Map.getOrInsertComputed`

---

## F. Weak references and finalizers (2019-07-09, updated 2020-06-19)

### Give every listener on a long-lived target a teardown: dropping your own reference does not free a listener's closure
- Layer: js
- Stage: gc-memory
- Metrics: memory, INP (GC pressure over time)
- When: long-lived session
- Impact: high for a trading terminal that stays open for hours. A leaked listener keeps its whole component alive, including arrays that keep growing.
- Do: Register each `addEventListener` on a longer-lived object (window, document, WebSocket, shared emitter) with an `AbortSignal` that the component owns, and call `abort()` in the teardown. Use `{ once: true }` for one-shot listeners. Also clear timers, rAF loops, and observers in the same teardown.
- Why: An event target holds its listeners strongly. A listener closure holds `this` and everything else it captures. In the post, `stop()` sets `this.movingAvg = null`, but the path socket → listener → `MovingAvg` instance keeps the instance and its `events` array alive. The JS-to-DOM tracing post shows the same thing for an iframe: a listener on the parent's `body` that captures `iframe.contentWindow` keeps the removed iframe's whole window, and all its globals, alive.
- Example:
  ```js
  class TickPanel {
    #ac = new AbortController();
    constructor(socket) {
      this.events = [];
      socket.addEventListener('message', (ev) => this.events.push(ev), { signal: this.#ac.signal });
      window.addEventListener('resize', () => this.layout(), { signal: this.#ac.signal });
    }
    dispose() { this.#ac.abort(); }   // removes both listeners
  }
  ```
- Avoid/caveats: `removeEventListener` needs the same function reference and capture flag, and forgetting one is a common leak. The signal removes all listeners without keeping those references. WeakRef-based "auto-removing" listeners (next rule) are not a replacement for this.
- Status: The `signal` option ships in Chrome 90, Firefox 86, and Safari 15 (BCD 8.1.2). AbortController/AbortSignal is Baseline widely available (webstatus: high 2021-09-25).
- Sources: https://v8.dev/features/weak-references ; https://v8.dev/blog/tracing-js-dom ; https://webstatus.dev/features/aborting

### Use WeakRef and FinalizationRegistry only as a safety net inside libraries, never for required cleanup, program logic, or metrics
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium. Misuse gives leaks that only look fixed, and behavior that changes with GC timing.
- Do: Give resource owners an explicit `dispose()` or `delete()` and call it. This applies to Wasm-backed chart objects, WebGL/WebGPU buffers and textures, sockets, and workers. Use a FinalizationRegistry only to report forgotten disposals or to free secondary resources as a fallback. For memory metrics, use `performance.measureUserAgentSpecificMemory()` in Chromium on cross-origin-isolated pages, not finalizers.
- Why: A finalizer may run long after collection, in a different order than objects were collected, or never (for example when the tab closes or the worker terminates, or when the registry itself is collected). Whether an object can be collected at all depends on engine details such as how closures are represented. GC runs on JS-heap pressure, and a small JS wrapper gives it no hint of the GPU memory or Wasm linear memory it owns.
- Example:
  ```js
  // Module scope: the registry must stay reachable
  const gpuLeaks = new FinalizationRegistry(({ gl, buf, label }) => {
    console.warn(`${label} was not disposed`);
    gl.deleteBuffer(buf);                 // fallback only
  });

  class GpuSeries {
    constructor(gl, label) {
      this.gl = gl; this.buf = gl.createBuffer();
      // held value must NOT reference `this`; `this` is the unregister token
      gpuLeaks.register(this, { gl, buf: this.buf, label }, this);
    }
    dispose() { this.gl.deleteBuffer(this.buf); gpuLeaks.unregister(this); }
  }
  ```
- Avoid/caveats: The registry holds the held value strongly, so if that value references the target, the target is never collected. It holds the unregister token weakly, and using the target itself as the token is fine (MDN). Explicit resource management (`using`, `Symbol.dispose`, `DisposableStack`) gives deterministic, scope-based cleanup. It is not Baseline: Chrome 134, Firefox 141, Safari in preview only (webstatus "limited"). Until then, use `try/finally`, or let TypeScript downlevel `using`.
- Status: WeakRef and FinalizationRegistry are Baseline widely available (webstatus: low 2021-04-26, high 2023-10-26; Chrome 84, Firefox 79, Safari 14.1). The support table on the v8.dev page is stale: it lists Chrome 74 and "Safari: no support". `measureUserAgentSpecificMemory`: Chrome 89 only, marked experimental in BCD 8.1.2.
- Sources: https://v8.dev/features/weak-references ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry ; https://webstatus.dev/features/weak-references ; https://webstatus.dev/features/explicit-resource-management ; https://webstatus.dev/features/measure-memory

### Create long-lived callbacks outside function scopes that hold large data: closures from one scope share one environment in V8
- Layer: v8
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium. One small listener can keep a large array or payload alive for the whole session.
- Do: Create listeners, timers, and subscriptions that outlive a function in a separate small function that receives only the values it needs. Do not create a long-lived callback in the same scope as a large local that another closure in that scope captures.
- Why: The post warns that in V8, closures strongly reference their outer environment, and closures created in the same scope share it. This is why its `addWeakListener` is a separate function: if the wrapper were created inside the `MovingAvg` constructor, the instance would stay reachable through the shared environment. Any variable that a sibling closure captures is kept alive for as long as any closure from that scope lives.
- Example:
  ```js
  // Before: the tick listener shares a scope with `history`, which `summarize` captures
  function attach(feed) {
    const history = loadLargeHistory();
    const summarize = () => history.length;
    feed.addEventListener('tick', (e) => render(e.data)); // can keep `history` alive
    return summarize();
  }

  // After: the long-lived listener comes from its own scope
  function listenTicks(feed, signal) {
    feed.addEventListener('tick', (e) => render(e.data), { signal });
  }
  function attach(feed, signal) {
    const history = loadLargeHistory();
    listenTicks(feed, signal);
    return history.length;
  }
  ```
- Avoid/caveats: This is engine-specific, and other engines may retain less. Confirm with a heap-snapshot retaining path (section G). Name callbacks so that they are easy to tell apart in the snapshot.
- Status: V8 behavior as the post describes it (2019, updated 2020). Not re-checked in V8 source for this batch.
- Sources: https://v8.dev/features/weak-references

### Call `deref()` once per task and keep the result in a local; do not use WeakRef as a cache for small objects
- Layer: js
- Stage: gc-memory, script-run
- Metrics: memory
- When: long-lived session
- Impact: low.
- Do: Write `const t = ref.deref(); if (t) { /* use t */ }`. For "expensive to compute, cheap to hold" results, use a size-bounded Map (LRU) instead of WeakRefs.
- Why: By spec, a target that was just wrapped in a WeakRef or returned by `deref()` stays alive until the end of the current job, including promise jobs at the end of a script job. So repeated `deref()` calls in one job agree, and a collection is visible only between event-loop turns. Between jobs, any GC can clear the target. Current V8 also treats WeakRef targets weakly in minor (young-generation) GCs (`handle_weak_ref_weakly_in_minor_gc` = true), so a young target can disappear within milliseconds.
- Avoid/caveats: Every WeakRef is an extra object and extra weak-processing work for the GC. Keep them few.
- Status: Baseline widely available (see above). The V8 flag default was checked on main, 2026-09-23.
- Sources: https://v8.dev/features/weak-references ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakRef ; V8 `src/flags/flag-definitions.h`

---

## G. Tracing from JS to the DOM and back again (2018-03-01)

### Find leaks with heap-snapshot retaining paths that cross JS and the DOM, and name your closures
- Layer: tooling
- Stage: gc-memory
- Metrics: memory
- When: testing, long-lived session
- Impact: medium. This is how you find the one listener or cache that keeps a closed chart, panel, or iframe alive.
- Do: In the DevTools Memory panel, repeat the suspect action several times (open and close a chart panel), then take a heap snapshot. Use the "Objects retained by detached nodes" filter, or record a "Detached elements" profile. Read the Retainers pane from the leaking object back to a root. Compare snapshots in the Comparison view. Give listeners and callbacks function names so that retaining paths are readable.
- Why: Since Chrome 66, heap snapshots trace through Blink's C++ DOM objects and record the real references between them. Retaining paths that cross the JS/DOM boundary are therefore exact. Chrome 65 and earlier showed only approximate paths after the first hop.
- Avoid/caveats: The DevTools console retains the objects you log. The snapshot filter "Objects retained by the DevTools console" separates these. Clear the console, or do not log, before you take the snapshot.
- Status: The current DevTools profile types are Heap snapshot, Allocation instrumentation on timeline, Allocation sampling, and Detached elements (developer.chrome.com, checked 2026-09-23).
- Sources: https://v8.dev/blog/tracing-js-dom ; https://developer.chrome.com/docs/devtools/memory ; https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots

### OBSOLETE: breaking JS-to-DOM reference cycles by hand; unreachable cycles are collected, and only paths from live roots leak
- Layer: v8
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: low. This removes teardown code that does nothing.
- Do: Do not write teardown code that only nulls `el.owner` or `this.el` to "break cycles" between a component and its DOM nodes. Remove the references from long-lived roots instead: listeners on window, document, or sockets, global maps and caches, timers, and observers.
- Why: Since Chrome 57, V8 and Blink use cross-component tracing. Liveness comes from tracing from roots through JS objects into the C++ DOM objects and back, so a cycle across the boundary with no path from a root is garbage. The earlier "object grouping" scheme (Chrome 56 and older) kept whole document groups alive, and it could collect JS wrappers too early, so that they lost their properties. The "break DOM/JS cycles" advice comes from older reference-counting DOMs, not from Chrome.
- Avoid/caveats: A cycle that a live root can still reach (for example, one listener on `window`) still leaks the whole cycle. Nulling references from long-lived objects remains correct.
- Status: Chrome 57+ (March 2017). The C++ side traces incrementally with write barriers, so it adds no stop-the-world pause.
- Sources: https://v8.dev/blog/tracing-js-dom

---

## Sources read
- https://v8.dev/blog/adaptor-frame
- https://v8.dev/blog/v8-release-78
- https://v8.dev/blog/improved-code-caching
- https://v8.dev/blog/background-compilation
- https://v8.dev/blog/hash-code
- https://v8.dev/features/weak-references
- https://v8.dev/blog/tracing-js-dom
- https://v8.dev/blog/v8-release-89
- https://v8.dev/docs/stack-trace-api
- https://v8.dev/blog/code-caching-for-devs (cross-check only; covered in batch 2)
- https://nodejs.org/en/blog/release/v16.0.0
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakRef
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry
- https://developer.chrome.com/docs/devtools/memory
- https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots
- webstatus.dev API: weak-references, explicit-resource-management, measure-memory, destructuring, modulepreload, link-rel-preload, aborting, weakmap, map, getorinsert
- BCD 8.1.2 (2026-09-17): Error.captureStackTrace, Error.stackTraceLimit, WeakRef, FinalizationRegistry, WeakMap, Map, Map.getOrInsertComputed, statements.using, Symbol.dispose, DisposableStack, EventTarget.addEventListener options, Performance.measureUserAgentSpecificMemory
- Chromium main (raw.githubusercontent.com/chromium/chromium, 2026-09-23): third_party/blink/renderer/bindings/core/v8/v8_code_cache.cc, v8_script_runner.cc, script_streamer.cc, v8_local_compile_hints_producer.cc; third_party/blink/renderer/core/loader/resource/script_resource.cc; third_party/blink/renderer/platform/loader/fetch/script_cached_metadata_handler.cc; third_party/blink/renderer/core/frame/local_frame.cc; third_party/blink/common/features.cc (saved as blink_features.cc); third_party/blink/renderer/platform/runtime_enabled_features.json5
- V8 main (raw.githubusercontent.com/v8/v8, 2026-09-23): src/flags/flag-definitions.h, src/objects/map.cc, src/objects/map-inl.h, src/objects/property-array.h, src/objects/property-details.h, src/objects/js-objects.h, src/snapshot/code-serializer.cc, BUILD.gn

## Not covered / could not access
- The v8.dev posts' figures (images) were not readable. All numbers above come from the post text.
- The V8 v7.8 items "WebAssembly C/C++ API" (embedder-only) and "Wasm wrapper compilation on background threads" (automatic, with no developer lever) were skipped as engine internals. The same applies to the Ignition bytecode, register-encoding, and x64 epilogue details in the adaptor-frame post, and to the AST-internalization and bytecode-finalization refactor in the background-compilation post.
- The "one shared environment per scope" closure-retention behavior was taken from the weak-references post and was not re-verified in current V8 source.
- `ServiceWorkerCodeCache` in `runtime_enabled_features.json5` has no `status` field, and `ScriptResource::ResponseReceived` skips the cache handler for responses fetched via a service worker when that feature is off. I could not confirm whether the content layer enables it by default, because GitHub code search needs auth and `gh` is not installed. So the service-worker code-cache behavior rests on the 2019 code-caching-for-devs post, plus the Cache Storage branch in `v8_code_cache.cc`.
- Whether code caching and streaming apply to dedicated-worker scripts, including Blob-URL workers, was not checked: the worker script loader was not read.
- Firefox (SpiderMonkey) and Safari (JavaScriptCore) equivalents of code caching, lazy source positions, and hash storage are outside these posts and were not researched.
- Array-destructuring performance was not measured or sourced. It is mentioned only as a caveat.
