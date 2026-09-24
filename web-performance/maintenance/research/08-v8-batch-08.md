# V8 deep read, batch 8 of 8: scanner, Wasm BigInt integration, 4 GB Wasm memory, JSPI, the V8 2023 roundup, WasmGC porting

Scope: developer-facing rules from six v8.dev posts: "Blazingly fast parsing, part 1: optimizing the scanner" (2019-03-25), "WebAssembly integration with JavaScript BigInt" (2020-11-12), "Up to 4GB of memory in WebAssembly" (2020-05-14), "Introducing the WebAssembly JavaScript Promise Integration API" (2024-07-01, later edited for Chrome 137), "V8 is Faster and Safer than Ever!" (2023-12-14), and "A new way to bring garbage collected programming languages efficiently to WebAssembly" (2023-11-01).
"Latest" status was checked on 2026-09-23 against V8 `main` (commit a81b3eb9dec6, 2026-09-23: `flag-definitions.h`, `wasm-limits.h`, `builtins-arraybuffer.cc`, `backing-store.cc`, `json-parser.cc`), V8 commit history plus chromiumdash (first Chrome release of a commit), web-features (jsDelivr `data.json`), webstatus.dev, BCD 8.1.2 (2026-09-17), the WebIDL, WebGL, WebGPU and Wasm JS API specs, MDN, the JSPI proposal, and the Emscripten `settings.js` and ChangeLog (6.0.10, 2026-09-21).
Some claims were measured in Chrome 152.0.7977.130 (Claude desktop browser pane, macOS) on 2026-09-23. These are marked "measured". Raw pages and source files are in `raw/v8-batch-8/`.

---

## A. Scanner ("Blazingly fast parsing, part 1", 2019-03-25)

### Minify production JavaScript: strip whitespace and comments, and mangle local names to short identifiers
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, startup, FCP, LCP, TBT
- When: build, load
- Impact: medium, because every script byte goes through the scanner before the parser can run, and short tokens let V8 produce more tokens per second.
- Do: Keep the production minifier on for all client bundles (Vite 8 default: `build.minify: 'oxc'`; esbuild `--minify`; Terser with `mangle`). Let the minifier remove whitespace and ordinary comments and rename local variables to one or two characters. Do not turn off identifier mangling to make stack traces readable; use source maps for that.
- Why: The scanner treats each run of whitespace or each comment as a WHITESPACE token and loops until it finds a real token, so fewer whitespace and comment tokens mean fewer loop iterations. The post measured "tokens per second" against token length and found that shorter identifiers give more tokens per second. Longer identifiers only look faster in MB/s because they carry less information per byte. V8 deduplicates every identifier and string literal between the scanner and the parser; for one-character ASCII names it uses a direct lookup table instead of a hash-table lookup.
- Example:
  ```ts
  // vite.config.ts (Vite 8): keep the default minifier for client builds, ship hidden source maps
  export default defineConfig({
    build: { minify: 'oxc', sourcemap: 'hidden' },
  });
  ```
- Avoid/caveats: Do not read the post as "long identifiers scan faster"; the post itself warns against that reading. `keepNames`-style options (esbuild `keepNames`, Terser `keep_fnames`/`keep_classnames`) add code; use them only where code needs `Function.name`. Property mangling is a separate, risky option; it is not what this rule asks for.
- Status: Current. The scanner design in the post is still in V8. Vite 8 defaults: `build.minify` is `'oxc'` for client builds and `false` for SSR (Vite docs, read 2026-09-23).
- Sources: https://v8.dev/blog/scanner ; https://vite.dev/config/build-options

### Keep identifiers ASCII, and let the build escape or isolate non-Latin1 text
- Layer: build (js)
- Stage: script-compile
- Metrics: startup
- When: build
- Impact: low, because the extra cost applies only to the identifiers and literals that contain such characters.
- Do: Write identifiers in ASCII (no `π`, `Δ`, Cyrillic, or emoji names). Leave non-Latin1 UI text (arrows, ellipses, CJK, Cyrillic) in string literals or translation data, and let the bundler decide how to emit it. esbuild escapes all non-ASCII characters by default (`charset: 'ascii'`); do not switch to `charset: 'utf8'` unless you also serve the script with a UTF-8 charset.
- Why: The scanner has a 128-entry ASCII flag table for `ID_Start`/`ID_Continue`, so ASCII identifiers take one table lookup and one branch per character. Non-ASCII identifiers take the slow Unicode-property path, and supplementary-plane characters also need surrogate-pair combining. For strings and identifiers, V8 first buffers characters as Latin1 and converts the buffer to UTF-16 at the first character that does not fit Latin1 (the post's footnote 2).
- Example:
  ```ts
  // Before
  const Δprice = next.price - prev.price;
  // After
  const deltaPrice = next.price - prev.price;
  ```
- Avoid/caveats: Escaping (`→`) makes output slightly larger; esbuild's docs name that trade-off. Charset correctness matters more than speed: a non-ASCII script served without a UTF-8 charset can be decoded wrongly. The post's advice to "avoid non-ASCII identifiers where possible" is about identifiers; do not move all user-visible text out of JS only for scanner speed.
- Status: Current (scanner post, esbuild API docs read 2026-09-23).
- Sources: https://v8.dev/blog/scanner ; https://esbuild.github.io/api/#charset

### Check the shipped bundle for leftover comments (JSDoc, license banners) and move legal text to a separate file
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, startup
- When: build
- Impact: low, because only large banners or preserved JSDoc blocks add measurable scan work.
- Do: After a production build, search the output for `/**` and `@license`. Keep only the legal comments that licenses require. Where the bundler supports it, write legal comments to a separate file (esbuild `legalComments: 'external'` or `'linked'`) instead of inline.
- Why: A comment is still scanned: the post made multi-line comment scanning 2.1x faster, but the scanner still reads every comment character. Rolldown documents `output.comments` with a default of `true`, which keeps legal, annotation, and JSDoc comments; whether the minifier strips them again depends on the pipeline, so check the real output.
- Example:
  ```bash
  # After `vite build`: list chunks that still contain JSDoc or license blocks
  grep -l -E '/\*\*|@license' dist/assets/*.js
  ```
- Avoid/caveats: Do not remove comments that a license requires. `/*#__PURE__*/` and similar annotations matter only at build time; they need not survive into the shipped output.
- Status: Current. Not verified: the exact comment behavior of Vite 8 with `minify: 'oxc'`.
- Sources: https://v8.dev/blog/scanner ; https://rolldown.rs/reference/OutputOptions.comments ; https://esbuild.github.io/api/#legal-comments

---

## B. WebAssembly and JavaScript BigInt integration (2020-11-12)

### Pass Wasm `i64` values as BigInt; never hand-split them into two `i32` halves
- Layer: build (js)
- Stage: script-run
- Metrics: startup, bundle-size
- When: build
- Impact: medium, because legalization adds split/combine work on every crossing (the post measured the BigInt path as 18% faster in a call-heavy benchmark) and an extra Binaryen pass at build time.
- Do: Build Wasm with JS BigInt integration (Emscripten: on by default since 4.0.0; do not pass `-sWASM_BIGINT=0`). In hand-written JS glue for `i64` parameters, pass a BigInt and expect a BigInt back. Delete old "low/high" glue that rebuilds 64-bit values from two 32-bit numbers.
- Why: Before BigInt integration, a Wasm signature with `i64` threw `TypeError` at the JS boundary, so toolchains "legalized" it: an `i64` parameter became two `i32` parameters, and an `i64` result became a low `i32` plus a side channel for the high bits. That costs extra instructions per call, changes the JS-visible signature (glue that reads only the first argument silently gets the low 32 bits), and needs a Binaryen pass. With the integration, the VM maps `i64` to BigInt directly, so the toolchain can skip legalization and the build is faster.
- Example:
  ```js
  // Before (legalized glue): the i64 arrives as two numbers
  send_i64(low, high) { const v = high * 2 ** 32 + (low >>> 0); /* loses precision above 2^53 */ }
  // After (BigInt integration): one exact value
  send_i64(v /* bigint */) { log(v.toString(16)); }
  ```
- Avoid/caveats: A Number passed to an `i64` parameter throws `TypeError` (measured in Chrome 152: "Cannot convert 5 to a BigInt"); convert explicitly. BigInt integration is the only mode Emscripten still supports for Wasm output; legalization remains only for `-sWASM=0` (JS output).
- Status: Baseline widely available (webstatus.dev `wasm-bigint`: newly 2021-04-26, widely 2023-10-26; Chrome 85, Firefox 78, Safari 14.1). Emscripten: default since 4.0.0 (2025-01-14); `WASM_BIGINT` deprecated in 6.0.8 (2026-08-20); `LEGALIZE_JS_FFI` removed in 6.0.8. OBSOLETE in the post: `-s WASM_BIGINT` as an opt-in flag, and the Node.js flag `--experimental-wasm-bigint`.
- Sources: https://v8.dev/features/wasm-bigint ; https://api.webstatus.dev/v1/features/wasm-bigint ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/ChangeLog.md ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/src/settings.js

### Keep `i64` out of hot JS-to-Wasm signatures when the value fits in 53 bits; if `i64` must stay, keep it a BigInt on the JS side
- Layer: js (gpu-adjacent Wasm glue)
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop, interaction
- Impact: medium, because a per-call BigInt-to-Number round trip cost about 30x more than an `f64` parameter in a measured 5-million-call loop.
- Do: For millisecond timestamps, prices, sizes, and counts (all below 2^53), declare Wasm exports and imports with `f64` (or `i32`) instead of `i64`. When a value really needs 64 bits (nanosecond clocks, 64-bit ids), keep it as BigInt in JS end to end and convert to Number only once, outside the loop. Batch several values per call instead of one call per point.
- Why: Every `i64` crossing creates or reads a BigInt, which is a heap value; converting it with `BigInt(n)` and `Number(b)` in the same loop adds two more conversions and allocations. Measured in Chrome 152 (identity export, 5,000,000 calls, median of 5): `f64` parameter 3.0 ms; `i64` with BigInt kept in JS 13.3 ms; `i64` with `BigInt()`/`Number()` on every call 90.8 ms. Batch 7 also found that TurboFan inlines the JS-to-Wasm wrapper only for simple numeric signatures.
- Example:
  ```c
  // Before: one i64 per call, called per candle from JS
  EMSCRIPTEN_KEEPALIVE double price_at(int64_t ts_ms);
  // After: epoch milliseconds are exact in a double up to 2^53
  EMSCRIPTEN_KEEPALIVE double price_at(double ts_ms);
  ```
- Avoid/caveats: The benchmark measures call overhead only, on one machine; real kernels hide it when each call does enough work. Do not store 64-bit ids in `f64`: values above 2^53 lose precision. See batch 6 G for the general BigInt rules (Number for prices and ms timestamps, BigInt only for true 64-bit integers).
- Status: Current (measured 2026-09-23).
- Sources: https://v8.dev/features/wasm-bigint ; batch 6 (`08-v8-batch-06.md`, section G) ; batch 7 (`08-v8-batch-07.md`, section F)

---

## C. Up to 4 GB of memory in WebAssembly (2020-05-14)

### Treat Wasm pointers as unsigned 32-bit values in JS glue: use `>>>`, never `>>`, and compare pointers as unsigned
- Layer: js
- Stage: script-run
- Metrics: memory
- When: long-lived session
- Impact: medium, because a signed shift turns every address at or above 2 GiB into a negative index, which reads `undefined` or writes nowhere without an error.
- Do: In any hand-written glue that reads Wasm memory, convert byte addresses with unsigned shifts (`ptr >>> 2` for `HEAP32`/`HEAPF32`, `ptr >>> 3` for `HEAPF64`) and normalize pointers returned from Wasm with `ptr >>> 0` before you compare or store them. Build with a `MAXIMUM_MEMORY` above 2 GB only when the program needs it, so that Emscripten emits unsigned pointer code everywhere.
- Why: Wasm `i32` values reach JS as signed Numbers, and `>>` is a signed operation, so `(2 ** 31) >> 2` gives `-536870912`. Emscripten emits `>>>` for all heap accesses, `subarray` and `copyWithin` calls only when the build allows memory above 2 GB (one extra character per shift, which is why it is opt-in). Your own glue does not get that rewrite. Manual comparisons between a signed and an unsigned pointer also fail above 2 GiB.
- Example:
  ```js
  // Before: wrong for addresses >= 2 GiB
  const first = HEAPF64[ptr >> 3];
  const ok = ptr < endPtr; // one of them may be negative
  // After
  const first = HEAPF64[ptr >>> 3];
  const ok = (ptr >>> 0) < (endPtr >>> 0);
  ```
- Avoid/caveats: For Memory64 builds, pointers are `i64` and arrive as BigInt; `>>>` does not apply there (see the Memory64 rule below).
- Status: Current. Emscripten `MAXIMUM_MEMORY` default is still 2147483648 (2 GiB) in `settings.js` on 2026-09-23.
- Sources: https://v8.dev/blog/4gb-wasm-memory ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/src/settings.js

### Start Wasm memory small, grow it on demand up to a set maximum, and handle allocation failure
- Layer: build (js)
- Stage: gc-memory, main-thread-task
- Metrics: memory, startup, FPS/smoothness
- When: load, long-lived session
- Impact: high, because a large up-front reservation can fail or push low-memory devices into memory pressure, while unlimited growth hides leaks until the tab dies.
- Do: Set a small initial memory, turn on growth (Emscripten `-sALLOW_MEMORY_GROWTH`), and set `MAXIMUM_MEMORY` to the real budget (2 GB default; `4GB` only with the unsigned-pointer rule above). Handle a failed `malloc()` (it returns 0 when growth is on) and a `RangeError` from `memory.grow()` with a user-visible fallback (for example, load less history). Grow ahead of predictable bursts (for example, when a symbol with deep history opens) instead of in the middle of a frame.
- Why: The post ends with this advice: 2-4 GB "is a lot of memory", many machines do not have it free, so start small and grow. Emscripten grows geometrically (`MEMORY_GROWTH_GEOMETRIC_STEP = 0.20`, capped at 96 MiB per step) and its settings file describes each resize as a hiccup "on the order of ~20 msecs". V8 caps Wasm32 memory at 65,536 pages (4 GiB) on 64-bit platforms, but at 32,767 pages (2 GiB minus 64 KiB) when the pointer size is 4 bytes (32-bit builds, for example on older Android devices).
- Example:
  ```bash
  emcc engine.c -O3 -sALLOW_MEMORY_GROWTH -sINITIAL_HEAP=33554432 -sMAXIMUM_MEMORY=2GB -o engine.js
  ```
- Avoid/caveats: With `ALLOW_MEMORY_GROWTH`, C++ `operator new` still aborts on failure when exceptions are off (Emscripten `ABORTING_MALLOC` notes); use `std::nothrow` where you can recover. Growth combined with pthreads adds a per-access check in JS glue; Emscripten's `GROWABLE_ARRAYBUFFERS=2` removes it but has Web-API limits (see section E). For SciChart.js, the heap ceiling is set by the library build (batch 13).
- Status: Current (V8 `wasm-limits.h` and Emscripten `settings.js`, 2026-09-23).
- Sources: https://v8.dev/blog/4gb-wasm-memory ; https://raw.githubusercontent.com/v8/v8/main/src/wasm/wasm-limits.h ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/src/settings.js ; batch 13 (`13-scichart.md`, "Plan for the wasm heap ceiling")

### Re-create typed-array views over Wasm memory after any call that can grow it
- Layer: js
- Stage: script-run
- Metrics: memory
- When: long-lived session, animation/render-loop
- Impact: high, because a stale view after growth has length 0: reads return `undefined` and writes are dropped without an error.
- Do: Never keep a `Float64Array(memory.buffer)` (or `HEAPF64`) across a call into Wasm that can allocate. Before you use a cached view, check that its buffer is still `memory.buffer` and rebuild it if not. Alternatively, when the memory has a declared maximum and you only read it from JS, switch it once with `memory.toResizableBuffer()` and use length-tracking views (no length argument), which follow growth.
- Why: Every `memory.grow()` on non-shared memory detaches the old `ArrayBuffer`, "even for `grow(0)`" (MDN), so its `byteLength` becomes 0. Shared memory does not detach, but the old `SharedArrayBuffer` keeps its old length. `toResizableBuffer()` replaces the buffer with a resizable one whose length follows `memory.grow()`; it throws `TypeError` if the memory has no maximum (Wasm JS API spec; measured in Chrome 152: a length-tracking view grew from 65,536 to 131,072 elements after `grow(1)`).
- Example:
  ```js
  let heap = new Float64Array(memory.buffer);
  function f64View() {
    if (heap.buffer !== memory.buffer) heap = new Float64Array(memory.buffer); // memory grew
    return heap;
  }
  function readSeries(ptr, n) {
    const start = ptr >>> 3;
    return f64View().subarray(start, start + n);
  }
  ```
- Avoid/caveats: Views over a resizable buffer cannot be passed to WebGL or WebGPU upload calls (TypeError, see section E). Emscripten's `GROWABLE_ARRAYBUFFERS` default went back to 0 in 6.0.3 for that Web-API reason, and its settings note that the feature "was not usable on Firefox until Firefox 154" even though BCD lists Firefox 145.
- Status: `Memory.prototype.grow` detaching: long-standing, all browsers. `toResizableBuffer()`/`toFixedLengthBuffer()`: Chrome 144, Firefox 145, Safari 26.2 per BCD 8.1.2 (2026-09-17); not grouped in web-features, so no Baseline label.
- Sources: https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow ; https://webassembly.github.io/spec/js-api/ ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/ChangeLog.md

### Stay on wasm32 unless the data truly needs more than 4 GiB; treat Memory64 as an opt-in with costs
- Layer: build
- Stage: script-run, gc-memory
- Metrics: memory, FPS/smoothness
- When: build, long-lived session
- Impact: medium, because Memory64 doubles pointer size, can add bounds checks, turns JS-side pointers into BigInt, and does not run in Safari.
- Do: Keep Wasm builds on wasm32 (up to 4 GiB). Choose Memory64 (`-m64` / `--target=wasm64`) only when one tab must hold more than 4 GiB, and then keep a wasm32 build for browsers without it and measure both.
- Why: The post notes that wasm64 pointers "take twice as much memory". With Memory64, `memory.grow()` and pointer-returning exports give BigInt values in JS, and BigInt conversions are costly per call (section B). SpiderMonkey measured 10% to over 100% slowdowns because it must bounds-check every access (search result only). V8 uses trap-handler bounds checks for Memory64 on x64, arm64, riscv64 and loong64 (`wasm_memory64_trap_handling`, landed October 2023), so the check cost is lower in Chrome, but SciChart measured about 10% slower execution for its wasm64 build (batch 13). V8 caps Memory64 at 262,144 pages (16 GiB) on 64-bit platforms.
- Example:
  ```bash
  # Default: wasm32
  emcc engine.c -O3 -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=4GB -o engine.js
  # Only if >4 GiB is required, as a second build selected by feature detection
  emcc engine.c -O3 -m64 -sALLOW_MEMORY_GROWTH -o engine64.js
  ```
- Avoid/caveats: The Emscripten `MEMORY64` setting is deprecated in favor of `-m64`. OBSOLETE in the post: "wasm64 is planned"; it shipped.
- Status: Limited availability (web-features `wasm-memory64`: Chrome/Edge 133, Firefox 134, no Safari, as of 2026-09).
- Sources: https://v8.dev/blog/4gb-wasm-memory ; https://api.webstatus.dev/v1/features/wasm-memory64 ; https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h ; https://groups.google.com/g/v8-reviews/c/VdlZacHKm_4 ; https://spidermonkey.dev/blog/2025/01/15/is-memory64-actually-worth-using.html (search result only) ; batch 13 (`13-scichart.md`)

---

## D. WebAssembly JavaScript Promise Integration, JSPI (2024-07-01, edited later)

### Use JSPI, not Asyncify, when synchronous Wasm code must call promise-based web APIs
- Layer: build (js)
- Stage: script-run, microtask
- Metrics: bundle-size, startup, INP
- When: build, load
- Impact: medium, because Asyncify instruments code for stack unwinding (Emscripten: "something like 50%" size and speed overhead), while JSPI leaves the Wasm code size the same.
- Do: Build Emscripten code that awaits JS promises with `-sJSPI` and list async entry points in `JSPI_EXPORTS` and async imports in `JSPI_IMPORTS` (or mark library functions `_async`). With raw Wasm, wrap each promise-returning import in `new WebAssembly.Suspending(fn)` and each export that can reach one in `WebAssembly.promising(fn)`. Feature-detect `'Suspending' in WebAssembly` and keep an Asyncify build (with `ASYNCIFY_ONLY`/`ASYNCIFY_ADVISE` to limit instrumentation) for older browsers only while your targets need it.
- Why: JSPI intercepts the promise that a wrapped import returns, suspends the Wasm stack, and returns a promise from the wrapped export; when the import's promise settles, the Wasm code resumes. The post calls suspend and resume "essentially constant time". Asyncify rewrites the Wasm code itself to unwind and rewind the stack, which grows code and slows every instrumented function.
- Example:
  ```js
  const imports = {
    env: {
      // async import: Wasm code calls it like a normal function
      read_chunk: new WebAssembly.Suspending(async (offset, len) => fetchChunk(offset, len)),
    },
  };
  const { instance } = await WebAssembly.instantiateStreaming(fetch('/engine.wasm'), imports);
  const loadDataset = WebAssembly.promising(instance.exports.load_dataset); // returns a Promise
  await loadDataset(datasetId);
  ```
- Avoid/caveats: JSPI cannot suspend JavaScript frames: if a JS function sits on the stack between the `promising` export and the `Suspending` import, the call traps (`WebAssembly.SuspendError` in the JS API). A `Suspending` import that returns a non-promise does not suspend. OBSOLETE in the post: "Firefox 139" (BCD and the Firefox 153 release notes give Firefox 153 as the first default-on release; 152 had it behind `javascript.options.wasm_js_promise_integration`); "phase 4" (the proposals list now shows phase 5); Emscripten `-sASYNCIFY=2` (deprecated since 3.1.59; use `-sJSPI`).
- Status: Baseline newly available since 2026-09-14 (web-features `wasm-jspi`: Chrome/Edge 137, Firefox 153, Safari 27).
- Sources: https://v8.dev/blog/jspi ; https://github.com/WebAssembly/js-promise-integration/blob/main/proposals/js-promise-integration/Overview.md ; https://github.com/WebAssembly/proposals ; https://emscripten.org/docs/porting/asyncify.html ; https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/153 (search result only) ; https://cdn.jsdelivr.net/npm/web-features/data.json

### Wrap only the imports that return promises and only the exports that reach them; keep suspension points out of hot loops
- Layer: js
- Stage: script-run, microtask
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium, because each suspension costs about 1 µs and a trip through the event loop, and every call to a `promising` export returns a promise even when nothing suspended.
- Do: Leave synchronous exports (per-frame compute, hit tests, formatting) unwrapped so JS calls them directly and gets the result synchronously. Suspend at coarse boundaries (load a file, fetch a dataset), not per item. Batch the async work so one suspension covers many items.
- Why: The post's benchmark computed Fibonacci with a promise-returning JS add and found about 1 µs per JSPI suspension; `fib(15)` took about 1,225 µs with suspensions against 13 µs with plain JS calls. The post also advises not to wrap exports and imports whose paths never call async APIs. A suspended module resumes only after the JS that called it has returned to the browser; the proposal resumes it from the promise's reaction (a microtask), and later suspensions of the same call return to the event loop (post footnote 1). Emscripten notes that with JSPI an async embind export "will always return a `Promise` regardless if the export suspended". Batch 7 found that TurboFan does not inline JS-to-Wasm wrappers for `promising` exports.
- Example:
  ```js
  // Before: every export wrapped "just in case"
  const computeFrame = WebAssembly.promising(instance.exports.compute_frame);
  function onFrame() { computeFrame(now).then(draw); } // one extra promise per frame
  // After: only the loader is async
  const computeFrame = instance.exports.compute_frame;
  function onFrame() { draw(computeFrame(now)); }
  ```
- Avoid/caveats: Do not await a promise-returning import in a loop that runs per data point; fetch all needed data first.
- Status: As above (Baseline 2026).
- Sources: https://v8.dev/blog/jspi ; https://emscripten.org/docs/porting/asyncify.html ; batch 7 (`08-v8-batch-07.md`, section F)

### Load rarely used Wasm code on its first call with a JSPI stub, and prefetch it when use becomes likely
- Layer: js
- Stage: network, script-compile
- Metrics: bundle-size, startup, LCP
- When: load, interaction
- Impact: low, because it helps only apps with large, rarely used Wasm features.
- Do: Split cold Wasm features (exporters, rare indicators) into a side module that imports the main module's memory. Call it through a function pointer that starts as a stub; the stub loads the side module with `WebAssembly.instantiateStreaming`, replaces the pointer with the loaded function, and calls it. Prefetch the side module on idle or on hover when a user is likely to need it.
- Why: `fetch` and `instantiateStreaming` return promises, and JSPI lets code deep in a synchronous call chain wait for them. After the first call the pointer targets the loaded code, so later calls pay no loading cost (the post's demo logs the load message only once for two calls).
- Example:
  ```js
  // JSPI import that the C stub calls on first use
  const loadIndicators = new WebAssembly.Suspending(async () => {
    const { instance } = await WebAssembly.instantiateStreaming(fetch('/indicators.wasm'), { env: { memory } });
    return registerFunction(instance.exports.ichimoku); // returns a table index for the stub to store
  });
  ```
- Avoid/caveats: The first call waits for network and compile time; do not put it on an interaction path without a prefetch. The post itself says this is not the definitive answer for dynamic linking. Serve side modules with `application/wasm` so streaming compile works (batch 4).
- Status: Needs JSPI (Baseline 2026).
- Sources: https://v8.dev/blog/jspi ; batch 4 (`08-v8-batch-04.md`, section A)

---

## E. V8 2023 roundup ("V8 is Faster and Safer than Ever!", 2023-12-14)

### Grow CPU-side binary buffers with a resizable ArrayBuffer, and hand buffers over with same-length `transfer()`; know which calls copy in V8
- Layer: js
- Stage: script-run, gc-memory
- Metrics: memory, FPS/smoothness
- When: long-lived session, animation/render-loop
- Impact: medium, because growing a 256 MB buffer by copy took about 41 ms (measured), while an in-place resize took under 1 ms.
- Do: For a CPU-side store that grows (tick history, decoded frames), allocate `new ArrayBuffer(initial, { maxByteLength })`, grow with `resize()`, and read through length-tracking views (no length argument). To hand a buffer to another owner without a copy, use `buffer.transfer()` with no new length (or `transferToFixedLength()` on a fixed-length buffer), or a `postMessage` transfer list. Do not expect `transfer(newLength)` to be cheaper than allocate-and-copy.
- Why: V8 allocates a resizable ArrayBuffer by reserving address space for `maxByteLength` and committing pages only up to the current length (`TryAllocateAndPartiallyCommitMemory`); `resize()` commits or decommits pages in place (`ResizeInPlace`), so data does not move and shrinking returns pages. `transfer()` reuses the backing store only when the source is not resizable, the result is not resizable, and the length is unchanged; in every other case V8 allocates a new store and copies (source comments call this "Case 3"). Measured in Chrome 152: `transfer()` of 256 MB at the same length 0 ms; `transfer(len + 8)` 41 ms; `resize()` from 8 MB to 256 MB 0 ms.
- Example:
  ```js
  const store = new ArrayBuffer(1 << 20, { maxByteLength: 512 << 20 });
  const closes = new Float64Array(store); // length-tracking: follows resize()
  function ensureCapacity(count) {
    const need = count * 8;
    if (need > store.byteLength) {
      store.resize(Math.min(store.maxByteLength, Math.max(need, store.byteLength * 2)));
    }
  }
  ```
- Avoid/caveats: `maxByteLength` reserves virtual address space; keep it realistic. Views over resizable buffers are rejected by WebGL, WebGPU and most other Web APIs (next rule). Transferring detaches the source; any old view reads length 0.
- Status: Resizable buffers Baseline newly available since 2024-07-09 (Chrome 111, Firefox 128, Safari 16.4). `transfer()`/`transferToFixedLength()`/`detached` Baseline widely available since 2026-09-05 (newly 2024-03-05). Source: web-features/webstatus.dev.
- Sources: https://v8.dev/blog/holiday-season-2023 ; https://raw.githubusercontent.com/v8/v8/main/src/builtins/builtins-arraybuffer.cc ; https://raw.githubusercontent.com/v8/v8/main/src/objects/backing-store.cc ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/transfer ; https://api.webstatus.dev/v1/features/resizable-buffers ; https://api.webstatus.dev/v1/features/transferable-arraybuffer

### Never pass views over resizable buffers (including Wasm `toResizableBuffer()` memory) to WebGL or WebGPU uploads; stage GPU data in fixed-length buffers
- Layer: gpu (js)
- Stage: gpu-upload
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: high, because the upload call throws `TypeError`, so the frame does not draw.
- Do: Keep vertex and uniform staging data in fixed-length ArrayBuffers (grow by capacity doubling and copy). If data lives in a resizable buffer, copy the needed range into a fixed-length staging buffer before `bufferData`, `bufferSubData`, or `queue.writeBuffer`. Do not switch Wasm memory to `toResizableBuffer()` if the renderer uploads directly from Wasm memory views.
- Why: WebIDL throws `TypeError` when a buffer or view backed by a non-fixed-length ArrayBuffer reaches an IDL type without the `[AllowResizable]` extended attribute. WebGL 1/2 (`AllowSharedBufferSource`, `[AllowShared] ArrayBufferView`) and WebGPU (`AllowSharedBufferSource`) do not use `[AllowResizable]`. Measured in Chrome 152: `bufferData`, `bufferSubData` (also with a `subarray`), and `GPUQueue.writeBuffer` all threw "The provided ArrayBufferView value must not be resizable". Emscripten reverted its `GROWABLE_ARRAYBUFFERS` default to 0 in 6.0.3 because it "found issues with Web API compatibility".
- Example:
  ```js
  // Before: throws TypeError
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(resizableStore, 0, n));
  // After: fixed-length staging buffer, grown by doubling
  let staging = new Float32Array(4096);
  function upload(src /* Float32Array on a resizable store */) {
    if (src.length > staging.length) staging = new Float32Array(Math.max(src.length, staging.length * 2));
    staging.set(src);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, staging, 0, src.length);
  }
  ```
- Avoid/caveats: `slice()` also makes a fixed-length copy but allocates per call; reuse one staging buffer in a render loop. SharedArrayBuffer-backed views are allowed by these APIs (`[AllowShared]`), resizable ones are not.
- Status: Spec behavior (WebIDL, WebGL IDL, WebGPU spec read 2026-09-23); measured in Chrome 152. Not tested in Firefox or Safari.
- Sources: https://webidl.spec.whatwg.org/#js-buffer-source-types ; https://registry.khronos.org/webgl/specs/latest/2.0/webgl2.idl ; https://gpuweb.github.io/gpuweb/ ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/ChangeLog.md

### If you must use a `JSON.parse` reviver, write it as an arrow function with exactly two parameters; read `context.source` only where you need exact source text
- Layer: js (v8)
- Stage: script-run, gc-memory
- Metrics: INP, TBT, memory
- When: load, interaction
- Impact: medium, because any reviver makes `JSON.parse` several times slower, and a three-parameter reviver makes V8 record source text for every value.
- Do: Parse hot payloads (snapshots, order books, history) with no reviver and post-process only the fields you need (batch 4). When a reviver is needed, pass `(key, value) => …`: no `arguments`, no rest parameter, no third parameter. For 64-bit ids or exact decimals, prefer that the server sends them as strings; use the third `context` argument (`context.source`) only for small payloads, and `JSON.rawJSON()` to serialize such values without precision loss.
- Why: V8 collects source strings (`ParseJsonValue<true>` with per-object snapshots) whenever the reviver is callable, unless it can prove the reviver reads only fixed formal parameters and declares fewer than three of them; a V8 source comment says the first run still takes the slow path. The commit that added this check (Chrome 143) reports a 36% run-time cut for reviver parses, still "about five times slower than the fast parser", and names the arrow-function form as the way to get it; a follow-up extends it to some non-arrow functions. Measured in Chrome 152 (200,000 small records, median of 7): no reviver 12.2 ms; `(k, v) =>` 88.3 ms; `function (k, v)` 151.1 ms; `(k, v, ctx) =>` 150.6 ms; `function` that reads `arguments` 164.6 ms.
- Example:
  ```ts
  // Before: third parameter makes V8 track source for every value
  const rows = JSON.parse(text, (key, value, ctx) => (key === 'ts' ? value * 1000 : value));
  // After (best): no reviver on the hot path
  const rows: Row[] = JSON.parse(text);
  for (const r of rows) r.ts *= 1000;
  // After (if a reviver is unavoidable): arrow, exactly two parameters
  const rows2 = JSON.parse(text, (key, value) => (key === 'ts' ? value * 1000 : value));
  ```
- Avoid/caveats: The benchmark is one machine and one payload shape. Revivers that change the object graph (through `this`) can defeat V8's optimizations; arrow functions have no own `this`. Since Chrome 152, V8 also has a direct-layout fast path for arrays of same-shaped objects in reviver-free parses, which strengthens batch 4's "identical keys in identical order" rule.
- Status: JSON source text access (`context.source`, `JSON.rawJSON`, `JSON.isRawJSON`): Baseline newly available since 2025-03-31 (Chrome 114, Firefox 135, Safari 18.4; web-features `json-raw`). Two-parameter reviver detection: Chrome 143+ (chromiumdash for V8 commits be082f4011 and 2b6d499abb). Homogeneous-array fast path: Chrome 152+ (commit 72a5044f96).
- Sources: https://v8.dev/blog/holiday-season-2023 ; https://raw.githubusercontent.com/v8/v8/main/src/json/json-parser.cc ; https://github.com/v8/v8/commit/be082f4011a9fe520f9463949be9096101d875e7 ; https://github.com/v8/v8/commit/2b6d499abb6ab9423af94c11acda73c93ebf0c1a ; https://github.com/v8/v8/commit/72a5044f96ec63a70d33fa662edc8fd14a351dc8 ; https://chromiumdash.appspot.com/fetch_commit?commit=be082f4011a9fe520f9463949be9096101d875e7 ; batch 4 (`08-v8-batch-04.md`, section D)

### Use `Promise.all` to await independent work; use `Array.fromAsync` only for async iterables such as streams
- Layer: js
- Stage: network, microtask
- Metrics: LCP, INP, startup
- When: load, interaction
- Impact: medium, because `Array.fromAsync` over a lazily started source serializes the waits (MDN's example: 5 x 100 ms becomes about 500 ms instead of about 100 ms).
- Do: When you have N independent requests, start them all and `await Promise.all(...)` (or `Promise.allSettled`). Use `Array.fromAsync` to collect an async iterable (a `ReadableStream`, an async generator) whose items really arrive one after another.
- Why: `Array.fromAsync` pulls the next value only after the previous one has settled. With a generator that creates each promise on demand, each request starts only after the previous one finished. `Promise.all` receives promises that are all already running.
- Example:
  ```ts
  function* snapshotRequests(symbols: string[]) {
    for (const s of symbols) yield fetchSnapshot(s); // starts each fetch lazily
  }
  // Before: sequential, one round trip per symbol
  const a = await Array.fromAsync(snapshotRequests(symbols));
  // After: concurrent
  const b = await Promise.all(symbols.map(fetchSnapshot));
  ```
- Avoid/caveats: With an array of promises that already started, `Array.fromAsync` does not add latency, but it still gives no benefit over `Promise.all`. Limit concurrency for very large N (a small pool) to avoid flooding the connection.
- Status: `Array.fromAsync` Baseline widely available since 2026-07-25 (newly 2024-01-25; Chrome 121, Firefox 115, Safari 16.4).
- Sources: https://v8.dev/blog/holiday-season-2023 ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/fromAsync ; https://api.webstatus.dev/v1/features/array-fromasync

### Write `let` and `const`; do not hand-convert declarations to `var` for speed
- Layer: js
- Stage: script-run
- Metrics: startup, TBT
- When: build
- Impact: low, because V8 now removes TDZ checks that an earlier check in the same function already covers, and bundlers that care already rewrite top-level declarations.
- Do: Use `const` by default and `let` for reassigned bindings; declare them before the functions that use them run. Do not add Babel's block-scoping transform or hand-edit to `var` to chase old benchmark numbers. If a profile shows TDZ checks in a hot closure over module-level bindings, move the value into a local or a parameter.
- Why: A `let`, `const` or `class` binding throws if read before initialization, so V8 must emit a "hole check" wherever it cannot prove initialization. In 2023 the TypeScript team measured about 10% (8-12%) speedup in parts of `tsc` from converting to `var` (V8 issue 13723). The holiday post reports that V8 now elides redundant TDZ checks; on V8 `main`, `ignition_elide_redundant_tdz_checks` is `true` ("elide TDZ checks dominated by other TDZ checks"). Checks in closures that read an outer binding can remain. esbuild rewrites top-level `let`/`const`/`class` to `var` when bundling, partly for this reason.
- Example:
  ```ts
  // Hot closure reads a module-level binding on every call
  let scale = 1;
  export const toPx = (v: number) => v * scale;
  // Better for a hot path: capture the value once per frame
  export function drawFrame(values: Float64Array, s: number) {
    for (let i = 0; i < values.length; i++) plot(i, values[i] * s);
  }
  ```
- Avoid/caveats: Converting to `var` changes semantics (hoisting, function scope) and can hide real bugs; the gain is small after the 2023 change. See batch 3 G for keeping script-scope `let` values type-stable.
- Status: Current. OBSOLETE (in part): "let/const are 10% slower than var" (2023 report) after V8's 2023 elision work; the esbuild FAQ still cites TDZ costs.
- Sources: https://v8.dev/blog/holiday-season-2023 ; https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h ; https://groups.google.com/g/v8-reviews/c/drZ8jJcE5Xo ; https://esbuild.github.io/faq/#top-level-var

### Use iterator helpers for early-exit pipelines over large or lazy sources, not as a general replacement for loops
- Layer: js
- Stage: script-run, gc-memory
- Metrics: memory, INP
- When: interaction
- Impact: low, because the win appears only when a chain stops early or would otherwise build large intermediate arrays.
- Do: For "first N matches" or "does any match" over a big Map, Set, or generator, use `iter.filter(...).map(...).take(n)` or `.some()`/`.find()` on the iterator instead of `[...map.values()].filter().map().slice(0, n)`. For a full pass over a dense array or typed array in a hot path, keep a plain indexed loop.
- Why: Iterator helpers are lazy: each value flows through the whole chain, and `take`, `some`, and `find` stop pulling as soon as they have the answer, so no intermediate arrays are built. The price is one iterator-protocol step per value per stage, which is more work per element than an indexed loop over packed elements.
- Example:
  ```ts
  // Before: copies every order, filters all, then keeps 20
  const top = [...orders.values()].filter((o) => o.open).map(toRow).slice(0, 20);
  // After: stops after 20 open orders, no intermediate arrays
  const top2 = orders.values().filter((o) => o.open).map(toRow).take(20).toArray();
  ```
- Avoid/caveats: The claim that plain loops are faster for full passes is from the mechanism, not a measurement in this batch; measure before you rewrite hot code.
- Status: Baseline newly available since 2025-03-31 (web-features `iterator-methods`: Chrome 122, Firefox 131, Safari 18.4). The holiday post says V8 unshipped iterator helpers in 2023 for web compatibility and planned to reship; Chrome 122 is the reship.
- Sources: https://v8.dev/blog/holiday-season-2023 ; https://cdn.jsdelivr.net/npm/web-features/data.json

### Build C++ Wasm code that throws with native Wasm exception handling, not JS-based emulation
- Layer: build
- Stage: script-run
- Metrics: bundle-size, startup
- When: build
- Impact: low, because it matters only for C++ code that uses exceptions (not for prebuilt libraries you consume).
- Do: Compile and link with `-fwasm-exceptions` instead of `-fexceptions` when targets are Baseline browsers. When your targets all support `exnref`, build with `-sWASM_LEGACY_EXCEPTIONS=0` to emit the standardized instructions.
- Why: Emscripten describes JS-based exceptions as having "relatively high overhead" and says native Wasm exceptions reduce code size and performance overhead. The holiday post notes that V8 implemented the updated exception-handling proposal (exnref) and still runs the older format.
- Example:
  ```bash
  emcc engine.cpp -O3 -fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=0 -o engine.js
  ```
- Avoid/caveats: Emscripten's `WASM_LEGACY_EXCEPTIONS` still defaults to `true` (settings.js, 2026-09-23). If exceptions are not needed, leave catching disabled (the default).
- Status: Legacy Wasm exception handling Baseline widely available (web-features `wasm-exception-handling`). `exnref` Baseline newly available since 2025-05-29 (Chrome 137, Firefox 131, Safari 18.4).
- Sources: https://v8.dev/blog/holiday-season-2023 ; https://emscripten.org/docs/porting/exceptions.html ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/src/settings.js ; https://cdn.jsdelivr.net/npm/web-features/data.json

---

## F. WasmGC porting (2023-11-01)

### Treat Wasm linear memory as a heap that never shrinks and can fragment: reuse long-lived buffers and avoid transient peaks
- Layer: js (Wasm glue)
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: high for a trading terminal that runs for hours on Wasm-backed charts, because peak memory stays reserved for the life of the tab and fragmentation can force growth or out-of-memory errors.
- Do: Allocate long-lived buffers in Wasm once and reuse them (one scratch buffer grown by doubling, not `malloc`/`free` per tick). Load very large data in bounded chunks rather than one huge transient allocation. Reserve capacity up front for series that grow steadily. For SciChart.js, follow batch 13 (reserve capacity, `clear()` to refill, `delete()` when done).
- Why: C, C++ and Rust allocations in linear memory cannot move, so small live blocks can split free space; the post's example has 2 MB total with a tiny allocation in the middle, and a 1.5 MB request fails. Wasm memory can only grow: there is `memory.grow` but no shrink, and the "Memory control" proposal is still at phase 1 (2026-09). A WasmGC heap is managed and compacted by the browser GC, which avoids this problem.
- Example:
  ```js
  // Before: allocate and free a Wasm buffer on every tick
  function onTick(points /* Float64Array */) {
    const p = mod._malloc(points.byteLength);
    mod.HEAPF64.set(points, p >>> 3);
    mod._ingest(p, points.length);
    mod._free(p);
  }
  // After: one scratch buffer, grown rarely
  let scratch = 0, capacity = 0;
  function onTick(points) {
    if (points.byteLength > capacity) {
      if (scratch) mod._free(scratch);
      capacity = Math.max(points.byteLength, capacity * 2);
      scratch = mod._malloc(capacity);
    }
    mod.HEAPF64.set(points, scratch >>> 3);
    mod._ingest(scratch, points.length);
  }
  ```
- Avoid/caveats: Do not over-reserve on many series at once (batch 13). A per-tick `malloc`/`free` of the same size usually reuses the same block, so measure `memory.buffer.byteLength` over a long session before you optimize.
- Status: Current (Wasm core spec has no shrink; proposals list read 2026-09-23).
- Sources: https://v8.dev/blog/wasm-gc-porting ; https://github.com/WebAssembly/proposals ; https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow ; batch 13 (`13-scichart.md`)

### Release every JS-to-linear-memory link explicitly; the garbage collector cannot see through linear memory
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: high, because objects kept alive through Wasm tables, handle slabs, or C++ wrappers leak until the tab closes.
- Do: For every JS wrapper of a Wasm-side object (embind classes, wasm-bindgen handles, SciChart surfaces, series, and data series), call its `delete()`/`free()` in the owner's teardown (Svelte `$effect` cleanup, `onDestroy`). Remove JS objects that Wasm holds (callbacks, DOM nodes in an externref table or handle map) when the Wasm side is done with them. Use `FinalizationRegistry` only as a backstop.
- Why: In a linear-memory (MVP) module, links to JS objects live in a Wasm table, and links back from JS can only point at the whole instance, so the JS garbage collector cannot find or collect a cycle that passes through linear memory. With WasmGC, Wasm objects are GC objects, so JS-to-Wasm cycles are collected like JS cycles.
- Example:
  ```ts
  $effect(() => {
    const series = new FastLineRenderableSeries(wasmContext, { dataSeries });
    surface.renderableSeries.add(series);
    return () => {
      surface.renderableSeries.remove(series); // default: deletes the series and its data series
    };
  });
  ```
- Avoid/caveats: See batch 13 for SciChart's `callDeleteOnChildren` defaults, and batch 5 F for why finalizers must not carry required cleanup.
- Status: Current.
- Sources: https://v8.dev/blog/wasm-gc-porting ; batch 13 (`13-scichart.md`) ; batch 5 (`08-v8-batch-05.md`, section F)

### Measure Wasm memory with Wasm-side counters; heap snapshots show linear memory only as one opaque buffer
- Layer: tooling
- Stage: gc-memory
- Metrics: memory
- When: testing, long-lived session
- Impact: medium, because leaks inside linear memory do not appear as objects in DevTools heap snapshots.
- Do: In long-session tests, record `memory.buffer.byteLength` (total reserved) and the allocator's in-use bytes (for Emscripten, `mallinfo()` or the library's own counters) at fixed points, and fail the test when they grow without bound. Use DevTools heap snapshots for JS objects and WasmGC objects.
- Why: In a linear-memory port, DevTools sees only untyped bytes in one ArrayBuffer. With WasmGC, the VM manages the objects, so the Chrome heap profiler shows them by type and field name (the post's `$Node`/`$next` example), with shallow and retained sizes.
- Example:
  ```ts
  function wasmMemoryMb(memory: WebAssembly.Memory) {
    return memory.buffer.byteLength / 2 ** 20; // never shrinks; track the peak per session
  }
  ```
- Avoid/caveats: `byteLength` shows reserved memory, not live data; pair it with allocator statistics.
- Status: Current.
- Sources: https://v8.dev/blog/wasm-gc-porting

### Run Binaryen `wasm-opt` on every release Wasm build
- Layer: build
- Stage: script-compile, script-run
- Metrics: bundle-size, startup, FPS/smoothness
- When: build
- Impact: medium, because `wasm-opt` made J2Wasm (Java to WasmGC) output 1.9x faster on average, and it also shrinks MVP output.
- Do: Build release Wasm at `-O2`/`-O3`/`-Os` so Emscripten runs Binaryen, or run `wasm-opt -O3` (speed) or `-Oz` (size) yourself on toolchains that do not. Do not ship `-O0` builds, even though they build faster.
- Why: For WasmGC, general optimizations run after lowering, in one shared Wasm-to-Wasm optimizer: escape analysis, devirtualization, global dead-code elimination, type-aware flow analysis (GUFA), cast removal, and type refining. For MVP output, the BigInt post notes that optimized builds run the Binaryen optimizer, "which is important for size".
- Example:
  ```bash
  emcc engine.c -O3 -o engine.js      # Emscripten runs wasm-opt at -O2 and above
  wasm-opt -O3 app.wasm -o app.opt.wasm # other toolchains
  ```
- Avoid/caveats: `-O0` skips Binaryen and speeds up debug builds only.
- Status: Current.
- Sources: https://v8.dev/blog/wasm-gc-porting ; https://v8.dev/features/wasm-bigint

### For code written in garbage-collected languages, prefer WasmGC builds over shipping a runtime and GC in linear memory
- Layer: build
- Stage: network, script-compile, gc-memory
- Metrics: bundle-size, memory, startup
- When: build
- Impact: low for a TypeScript codebase; medium when you choose a Kotlin, Dart, or Java library compiled to Wasm.
- Do: When you adopt Wasm code from Kotlin, Dart/Flutter, Java (J2Wasm), OCaml, or Scheme, choose its WasmGC target over a build that compiles the language VM into linear memory.
- Why: A WasmGC module needs no GC and no `malloc`/`free` in the binary (the post's `fannkuch` example: 2.3 K for WasmGC against 6.1-9.6 K for C or Rust, because of `dlmalloc` 6 K or `emmalloc` more than 1 K). The browser GC is generational and incremental, reacts to memory pressure, compacts the heap, and collects JS-Wasm cycles. V8 also speculatively inlines WasmGC indirect calls (about 30% speedup on the Google Sheets calc engine).
- Example: Not applicable (toolchain choice).
- Avoid/caveats: WasmGC ports may change language semantics (fixed struct fields, no interior pointers). Keep call sites monomorphic for speculative inlining (batch 7 F).
- Status: Baseline newly available since 2024-12-11 (web-features `wasm-garbage-collection`: Chrome 119, Firefox 120, Safari 18.2).
- Sources: https://v8.dev/blog/wasm-gc-porting ; https://cdn.jsdelivr.net/npm/web-features/data.json ; batch 7 (`08-v8-batch-07.md`, section F)

---

## Cross-references to other batches
- Maglev (Chrome 117) and Turboshaft (Chrome 120) in the holiday post: no new code rule. See batch 4 E ("Optimize and measure warm code, not only hot loops; warm up before you time anything").
- Streamable UTF-8 script delivery: batch 5 D. Lazy parsing and PIFEs (scanner series part 2): batch 3 C.
- JSON.parse without a reviver, and identical key order in JSON arrays: batch 4 D (strengthened by Chrome 152's homogeneous-array fast path, see section E above).
- BigInt versus Number for prices and timestamps: batch 6 G.
- Wasm streaming compile, code cache, `application/wasm`: batch 4 A. Wasm tiering and speculative inlining: batch 7 E and F.
- SciChart.js Wasm heap ceiling, Memory64 in the v6 alpha, and `delete()` rules: batch 13.

## Deprecated or changed advice found in this batch
| Post claim | Status on 2026-09-23 | Evidence |
|---|---|---|
| Build with `-s WASM_BIGINT` (opt-in); Node needs `--experimental-wasm-bigint` | OBSOLETE: default since Emscripten 4.0.0; setting deprecated in 6.0.8; Baseline widely | Emscripten ChangeLog; webstatus.dev |
| wasm64/Memory64 "is planned" | CHANGED: shipped in Chrome 133 and Firefox 134; no Safari; V8 limit 16 GiB | web-features; `wasm-limits.h` |
| Test 4 GB memory on "Chrome M83 (Beta)" | OBSOLETE: 4 GiB is the normal 64-bit limit; 32-bit builds stay at 2 GiB minus 64 KiB | `wasm-limits.h` |
| JSPI "phase 4", "available in Chrome 137 and Firefox 139" | CHANGED: phase 5; Firefox default-on in 153 (152 behind a pref); Safari 27; Baseline 2026-09-14 | proposals repo; BCD; web-features |
| JSPI resumes via "the browser's task runner" | CLARIFIED: the proposal resumes from the promise reaction (microtask); only later suspensions return to the event loop | JSPI Overview.md; post footnote 1 |
| Emscripten `-sASYNCIFY=2` for JSPI | OBSOLETE: deprecated since 3.1.59; use `-sJSPI` | Emscripten ChangeLog |
| Iterator helpers unshipped (2023) | CHANGED: reshipped in Chrome 122; Baseline 2025-03-31 | web-features |
| `let`/`const` are about 10% slower than `var` in V8 (2023 report) | MOSTLY OBSOLETE: dominated TDZ checks are elided (flag on in `main`); some checks remain in closures | `flag-definitions.h`; V8 issue 13723 |
| WasmGC "Firefox 120 is expected" | DONE: Chrome 119, Firefox 120, Safari 18.2; Baseline 2024-12-11 | web-features |

## Sources read
- https://v8.dev/blog/scanner
- https://v8.dev/features/wasm-bigint
- https://v8.dev/blog/4gb-wasm-memory
- https://v8.dev/blog/jspi
- https://v8.dev/blog/holiday-season-2023
- https://v8.dev/blog/wasm-gc-porting
- https://api.webstatus.dev/v1/features/wasm-bigint , /wasm-memory64 , /resizable-buffers , /transferable-arraybuffer , /promise-withresolvers , /array-fromasync , /array-group , /wasm-multi-memory , /wasm-exception-handling
- https://cdn.jsdelivr.net/npm/web-features/data.json (features: wasm-jspi, wasm-garbage-collection, json-raw, iterator-methods, wasm-exnref-exceptions, wasm-tail-call-optimization, wasm-string-builtins, resizable-buffers, transferable-arraybuffer)
- BCD 8.1.2 `data.json` (2026-09-17), saved earlier as `raw/bcd.json`: `webassembly.api.Suspending`, `promising_static`, `SuspendError`, `Memory.toResizableBuffer`, `Memory.toFixedLengthBuffer`, `javascript.builtins.JSON.rawJSON`
- https://raw.githubusercontent.com/emscripten-core/emscripten/main/src/settings.js
- https://raw.githubusercontent.com/emscripten-core/emscripten/main/ChangeLog.md
- https://emscripten.org/docs/porting/asyncify.html
- https://emscripten.org/docs/porting/exceptions.html
- https://github.com/WebAssembly/js-promise-integration/blob/main/proposals/js-promise-integration/Overview.md
- https://github.com/WebAssembly/proposals
- https://webassembly.github.io/spec/js-api/
- https://webidl.spec.whatwg.org/
- https://registry.khronos.org/webgl/specs/latest/1.0/webgl.idl
- https://registry.khronos.org/webgl/specs/latest/2.0/webgl2.idl
- https://gpuweb.github.io/gpuweb/
- https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/transfer
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/fromAsync
- https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h
- https://raw.githubusercontent.com/v8/v8/main/src/wasm/wasm-limits.h
- https://raw.githubusercontent.com/v8/v8/main/src/builtins/builtins-arraybuffer.cc
- https://raw.githubusercontent.com/v8/v8/main/src/objects/backing-store.cc
- https://raw.githubusercontent.com/v8/v8/main/src/json/json-parser.cc , json-parser.h , json-stringifier.cc
- https://api.github.com/repos/v8/v8/commits?path=src/json/json-parser.cc and commits be082f4011, 2b6d499abb, 72a5044f96
- https://chromiumdash.appspot.com/fetch_commit?commit=<sha> for the three commits above
- https://groups.google.com/g/v8-reviews/c/drZ8jJcE5Xo (V8 issue 13723)
- https://groups.google.com/g/v8-reviews/c/VdlZacHKm_4 (Memory64 trap handling review)
- https://esbuild.github.io/api/ (charset, legal comments)
- https://esbuild.github.io/faq/ (top-level var)
- https://vite.dev/config/build-options
- https://rolldown.rs/reference/OutputOptions.comments
- Search results only: https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/153 ; https://spidermonkey.dev/blog/2025/01/15/is-memory64-actually-worth-using.html
- Measurements in Chrome 152.0.7977.130 (Claude desktop browser pane, macOS, 2026-09-23): WebGL `bufferData`/`bufferSubData` and WebGPU `writeBuffer` with resizable-backed views; `ArrayBuffer.transfer`/`resize` timings; `Memory.toResizableBuffer` behavior; `JSON.parse` reviver variants; Wasm `i64` versus `f64` call cost.

## Not covered / could not access
- MDN page for `WebAssembly.Memory.prototype.toResizableBuffer()` returned 404; the Wasm JS API spec and BCD were used instead.
- Not measured: resizable-buffer and length-tracking typed-array access speed in V8 hot loops; iterator helpers against plain loops; TDZ check cost after the 2023 change; JSPI behavior in Firefox and Safari; WebGL/WebGPU resizable-buffer rejection in Firefox and Safari.
- Not verified: whether Vite 8 (Rolldown with the Oxc minifier) keeps JSDoc comments in minified output; Firefox 154 release date (Emscripten says `toResizableBuffer` was not usable before Firefox 154).
- Skipped as engine internals or non-performance features: scanner internals (perfect hashing for keywords, `AdvanceUntil`, surrogate handling), TypedArray prototype-chain lookups for huge indices, Oilpan page pool, the faster Blink HTML parser, sandboxing and CFI, `Promise.withResolvers`, `Object.groupBy`/`Map.groupBy`, `String.prototype.isWellFormed`/`toWellFormed`, the RegExp `v` flag, Wasm multi-memory and tail calls, and WasmGC language-semantics trade-offs.
