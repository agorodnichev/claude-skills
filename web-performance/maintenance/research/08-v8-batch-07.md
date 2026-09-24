# V8 deep read, batch 7 of 8: top-level await, JSON ⊂ ECMAScript, Wasm SIMD, Atomics, Wasm tiering (Liftoff, dynamic tiering), speculative Wasm inlining and deopts

Scope: developer-facing rules from seven v8.dev posts: Top-level await (2019-10-08), Subsume JSON (2019-08-14), WebAssembly SIMD (2020-01-30, updated 2022-11-06), Atomics.wait/notify/waitAsync (2020-09-24), WebAssembly dynamic tiering (2021-10-29), Liftoff (2018-08-20), Speculative optimizations for WebAssembly (2025-06-24). The v8.dev "WebAssembly compilation pipeline" doc was read as the current reference for tiering.
"Latest" status was checked on 2026-09-23 against V8 `main` (commit a81b3eb9dec6, 2026-09-23: `flag-definitions.h`, `feature-flags.h`, `wasm-features.h`, `liftoff-compiler.cc`, `js-call-reducer.cc`, `builtins-sharedarraybuffer-gen.cc`), the V8 commit history, Chromium `gin/gin_features.cc`, web-features/BCD (2026-09-22 copy), webstatus.dev, the WHATWG HTML spec, ECMA-262, MDN, and toolchain docs (Emscripten, esbuild, Rolldown).
Wasm streaming compilation, the Wasm code cache, `application/wasm`, and "DevTools open tiers Wasm down" are already in batch 4 (`08-v8-batch-04.md`, section A). This file only cross-references them. Raw pages and source files are in `raw/v8-batch-7/`.

---

## A. Top-level await (post: 2019-10-08)

### Keep top-level await out of shared modules; await only in the entry module or behind an exported init function
- Layer: js
- Stage: script-run
- Metrics: startup, LCP, FCP
- When: load
- Impact: high, because one awaiting module stops the evaluation of every module that imports it, up to the entry point, and Safari 15-26 throws a ReferenceError when more than one module imports a module that contains top-level await.
- Do: Do not put `await` at the top level of a module that more than one module imports (config, API client, stores, chart setup). Export a memoized `init()`/`load()` function that returns a promise, and await it once in the entry module. Put a timeout and a fallback on any network `await` that must stay at the top level.
- Why: Modules evaluate in post-order. When a module awaits, its evaluation stops until the promise settles; its parent (and the parent's parents) cannot start their bodies until the child and all its siblings have exported their bindings. Sibling subtrees that do not depend on the awaiting module can still run. A promise that never settles blocks its dependents forever. WebKit bug 242740 ("ReferenceError when multiple modules are simultaneously importing a module containing a top-level await") made BCD mark Safari 15-26 as a partial implementation; Safari 27 is the first full one.
- Example:
  ```js
  // Before: config.ts, imported by chart.ts, orders.ts and main.ts
  export const config = await fetch('/api/config').then((r) => r.json());

  // After: config.ts
  let pending: Promise<Config> | undefined;
  export function loadConfig(): Promise<Config> {
    return (pending ??= fetch('/api/config').then((r) => r.json()));
  }
  // main.ts (entry): the only module with top-level await
  const config = await loadConfig();
  ```
- Avoid/caveats: Top-level await in the entry module is fine; it only delays the code after the `await`. Circular imports that include a top-level await can deadlock (the post's own warning). `import defer` (see batch 2) evaluates modules that contain top-level await eagerly, so they also lose that benefit. Do not use an async IIFE as a replacement in shared modules: the post notes it makes graph execution less deterministic, and importers cannot wait for it.
- Status: webstatus.dev: Baseline newly available since 2026-09-14 (Chrome/Edge 89, Firefox 89, Safari 27). BCD: Safari 15 to 26 partial. The post's support table (Firefox and Safari "no support") is out of date.
- Sources: https://v8.dev/features/top-level-await ; https://api.webstatus.dev/v1/features/top-level-await ; https://raw.githubusercontent.com/mdn/browser-compat-data/main/javascript/operators/await.json ; https://bugs.webkit.org/show_bug.cgi?id=242740

### Start independent async work before the first top-level await; do not rely on sibling modules' awaits running in parallel after bundling
- Layer: build (js)
- Stage: network, script-run
- Metrics: startup, LCP
- When: load, build
- Impact: medium, because sequential awaits add their latencies (for example 2 x 150 ms round trips become 300 ms).
- Do: Inside a module, create all independent promises first and await them together with `Promise.all`. Do not design startup so that two sibling modules each await a fetch and "run in parallel"; in a bundle they run one after the other.
- Why: Unbundled, the spec lets sibling modules with top-level await make progress at the same time. A bundler that concatenates modules into one chunk cannot keep that: the Rolldown docs say that bundling TLA changes the original code's behavior "from concurrent to sequential" (Rolldown is Vite's only bundler since Vite 8, March 2026). esbuild's first TLA implementation also evaluated sibling TLA modules serially (search result only).
- Example:
  ```js
  // Before: two round trips in series
  const symbols = await fetchSymbols();
  const layout = await fetchLayout();

  // After: one round trip of wall time
  const [symbols, layout] = await Promise.all([fetchSymbols(), fetchLayout()]);
  ```
- Avoid/caveats: `Promise.all` rejects on the first failure; use `Promise.allSettled` when each part can fail on its own. See batch 2 and batch 4 for the general `Promise.all` rule.
- Status: Current bundler behavior (Rolldown docs read 2026-09-23).
- Sources: https://v8.dev/features/top-level-await ; https://rolldown.rs/in-depth/tla-in-rolldown ; https://vite.dev/blog/announcing-vite8 (search result only) ; https://newreleases.io/project/github/evanw/esbuild/release/v0.10.0 (search result only)

### Emit ESM output from the bundler when any module uses top-level await
- Layer: build
- Stage: script-compile
- Metrics: startup, bundle-size
- When: build
- Impact: low, because it is a build failure or a silent format change, not a runtime cost.
- Do: Keep the output format `esm` (`format: 'es'`/`'esm'`) for app and worker bundles that contain top-level await, and load them with `<script type="module">` or `new Worker(url, { type: 'module' })`. Do not add top-level await to code that must also ship as IIFE or CommonJS.
- Why: esbuild can transform TLA, but "bundling code containing top-level await is only supported when the output format is set to esm". Rolldown states the same rule. Top-level await is part of the module grammar only; classic scripts and CommonJS have no top-level await.
- Avoid/caveats: The DevTools console and Node REPL accept top-level await in a non-standard way. The post warns to test the real app, not the REPL.
- Status: esbuild docs (read 2026-09-23); Rolldown docs.
- Sources: https://esbuild.github.io/content-types/ ; https://rolldown.rs/in-depth/tla-in-rolldown ; https://v8.dev/features/top-level-await

### Do not treat DOMContentLoaded or `load` as "app ready" when module scripts use top-level await; publish an explicit ready signal
- Layer: html (js)
- Stage: html-parse, script-run
- Metrics: LCP, INP
- When: load, testing
- Impact: medium, because code (and RUM or test harnesses) that waits for DOMContentLoaded can run before the awaited part of the module graph has finished.
- Do: When the entry module awaits, mark readiness yourself after the await (a custom event, a resolved promise on a known object, or a `data-` attribute) and make tests and interaction handlers wait for it.
- Why: HTML's "execute the script element" calls "run a module script", which returns the evaluation promise of `record.Evaluate()`, and the script element does not wait for that promise. The element's `load` event fires right after, and the parser continues to DOMContentLoaded. The code after the first top-level `await` runs later, in a promise job.
- Example:
  ```js
  // main.ts (type="module")
  const config = await loadConfig();
  mountChart(config);
  document.documentElement.dataset.ready = 'true';
  dispatchEvent(new Event('app:ready'));
  ```
- Avoid/caveats: None, beyond keeping the signal name stable for tests.
- Status: WHATWG HTML Living Standard (checked 2026-09-22 copy).
- Sources: https://html.spec.whatwg.org/multipage/webappapis.html#run-a-module-script ; https://html.spec.whatwg.org/multipage/scripting.html#execute-the-script-element

### In module workers, attach the message handler before the first top-level await
- Layer: js
- Stage: script-run, main-thread-task
- Metrics: startup, INP
- When: load
- Impact: medium, because messages that arrive while the worker is still awaiting can reach no listener and be lost; the page then waits for a reply that never comes.
- Do: In a `type: 'module'` worker, set `self.onmessage` (or `addEventListener('message', …)`) at the top of the module, before any `await`. Queue the messages until initialization is done, then drain the queue.
- Why: In the HTML "run a worker" steps, the worker first runs the module script and then enables the port message queue. "Run a module script" returns at the first top-level `await` suspension, so message events can be dispatched before the rest of the module body has run.
- Example:
  ```js
  // data-worker.ts (module worker)
  const early: unknown[] = [];
  let handle = (msg: unknown) => { early.push(msg); };
  self.onmessage = (e) => handle(e.data);      // attached before any await
  const engine = await createEngine();         // top-level await
  handle = (msg) => engine.process(msg);
  early.splice(0).forEach(handle);
  ```
- Avoid/caveats: The same applies to `connect` events in shared workers.
- Status: WHATWG HTML Living Standard; module workers are Baseline widely available (2025-12-06).
- Sources: https://html.spec.whatwg.org/multipage/workers.html#run-a-worker ; web-features `js-modules-workers`

### Choose runtime variants with `await import()` so only one variant downloads, and preload the likely one
- Layer: js (build)
- Stage: network, script-compile
- Metrics: bundle-size, startup
- When: load
- Impact: medium, because only the chosen locale/theme/engine variant is downloaded and compiled.
- Do: Pick locale data, environment builds, or engine variants (for example a SIMD or non-SIMD Wasm glue module) with a dynamic `import()` whose path depends on a runtime value. Keep the path analyzable by the bundler (a relative prefix and a file extension). If the server can predict the variant, add `<link rel="modulepreload">` for it.
- Why: The post shows two TLA patterns, "dynamic dependency pathing" and "dependency fallbacks" (try CDN A, then CDN B). A static `import` of every variant fetches and evaluates all of them. A dynamic import fetches only one, but the fetch starts only when the importing code runs, which adds a network round trip after the parent module.
- Example:
  ```js
  const locale = navigator.language.startsWith('de') ? 'de' : 'en';
  const { messages } = await import(`./i18n/${locale}.js`);
  ```
- Avoid/caveats: Each fallback `import()` waits for the previous attempt to fail; with no timeout, a hanging CDN blocks the importer. Loading third-party code from a fallback CDN also needs Subresource Integrity or an import map with `integrity` (not covered here).
- Status: Dynamic `import()` is Baseline widely available (not re-checked in this batch; see batch 2).
- Sources: https://v8.dev/features/top-level-await

---

## B. JSON ⊂ ECMAScript (post: 2019-08-14)

### In code generators, write large data as `JSON.parse(<JSON.stringify(JSON.stringify(data))>)`; `JSON.stringify` output is a valid JS literal
- Layer: build
- Stage: script-compile, script-run
- Metrics: startup, TBT, LCP
- When: build
- Impact: medium for data of 10 kB or more, because JSON parses faster than an equivalent JS object literal (1.7x in V8 per the "cost of JavaScript 2019" post). See batch 1 for the size rule and the Vite default.
- Do: In build scripts that emit JS, turn data into a string literal with a second `JSON.stringify` and wrap it in `JSON.parse(...)`. Do not hand-write escaping for U+2028 and U+2029 inside string literals. Prefer the bundler's JSON handling (Vite `json.stringify: 'auto'`) over custom generators.
- Why: Since ES2019, string literals may contain raw U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR, so JSON's grammar is a subset of ECMAScript and `JSON.stringify` output always parses as a JS literal. The inner `JSON.stringify` makes the JSON text; the outer one makes a JS string literal that contains it. The well-formed `JSON.stringify` change (lone surrogates are escaped) keeps the output valid UTF-8 on disk.
- Example:
  ```js
  // build/emit-symbols.mjs
  const json = JSON.stringify(symbolTable);          // JSON text
  const literal = JSON.stringify(json);              // JS string literal
  await writeFile('src/generated/symbols.js', `export default JSON.parse(${literal});\n`);
  ```
- Avoid/caveats: The gain holds only if the string is parsed once. For small objects (below about 10 kB) a literal is fine. Never edit the generated file by hand (repository rule); change the generator.
- Status: JSON superset and well-formed stringify are in the Baseline "JSON" feature (widely available). Chrome 66, Node 10.
- Sources: https://v8.dev/features/subsume-json ; https://v8.dev/blog/cost-of-javascript-2019 ; web-features `json`

### When you inline data into an HTML page, put it in a `<script type="application/json">` data block and `JSON.parse` it, or escape `<`, U+2028 and U+2029
- Layer: html
- Stage: html-parse, script-compile, script-run
- Metrics: startup, TBT, LCP
- When: load
- Impact: medium, because the data block is not compiled as JavaScript, and a wrong escape is an XSS hole.
- Do: For server-rendered initial state, emit `<script type="application/json" id="boot">…</script>` and read it with `JSON.parse(el.textContent)`. If you must emit executable JS, escape every `<` as `<` (which covers `</script`, `<script` and `<!--`) and escape U+2028/U+2029 whenever the value is not placed inside a JS string literal.
- Why: The post shows that U+2028/U+2029 are still line terminators outside string literals, so JSON injected into a `//` comment or another non-literal position can break out and run as code. HTML says a `script` whose `type` is not a JavaScript MIME type (and not `module`, `importmap` or `speculationrules`) is a data block that the user agent does not process. HTML also recommends escaping `<!--`, `<script` and `</script` in script contents. Parsing the text with `JSON.parse` keeps the fast JSON path from the rule above (this pairing is my inference from the two sources).
- Example:
  ```html
  <script type="application/json" id="boot">{"symbols":["AAPL","MSFT"],"theme":"dark"}</script>
  <script type="module">
    const boot = JSON.parse(document.getElementById('boot').textContent);
  </script>
  ```
- Avoid/caveats: The server must still escape `<` inside the JSON so that a value cannot contain `</script>`. Do not use `innerHTML` to read or write the block.
- Status: HTML Living Standard (data blocks, "Restrictions for contents of script elements").
- Sources: https://v8.dev/features/subsume-json ; https://html.spec.whatwg.org/multipage/scripting.html#the-script-element ; https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements

### Load static JSON as JSON (bundler JSON import or `with { type: 'json' }`), never as a hand-written JS object-literal module
- Layer: js (build)
- Stage: script-compile, script-run
- Metrics: startup, bundle-size
- When: load, build
- Impact: low to medium, depending on size; it keeps large data on the JSON parser path.
- Do: Keep data files as `.json` and import them through the bundler, or in unbundled code with `import data from './levels.json' with { type: 'json' }`. Serve such files with a JSON MIME type.
- Why: Same mechanism as above: JSON's grammar is simpler than JavaScript's, so the JSON parser is faster than the JS parser on the same bytes. A JSON module is parsed as JSON, not compiled as script (spec detail not re-read in this batch).
- Avoid/caveats: An unbundled JSON module is one more request. Vite with `json.stringify: 'auto'` turns only files over 10 kB into `JSON.parse`; smaller ones become JS with named exports (tree-shakeable).
- Status: web-features `json-modules` ("JSON import attributes"): Baseline newly available since 2025-04-29 (Chrome 123, Firefox 138, Safari 17.2).
- Sources: https://v8.dev/features/subsume-json ; web-features `json-modules`

---

## C. WebAssembly SIMD (post: 2020-01-30, updated 2022-11-06)

### Compile compute-heavy Wasm with SIMD enabled (`-msimd128`, Rust `+simd128`) at `-O2`/`-O3`
- Layer: build (v8)
- Stage: script-run
- Metrics: FPS/smoothness, INP, TBT
- When: build, animation/render-loop
- Impact: high for data-parallel kernels (decimation, indicators, min/max scans, color conversion), because one instruction processes 4 x i32/f32 or 2 x f64 lanes. The post's MediaPipe demo went from 14-15 FPS to 38-40 FPS.
- Do: For your own C/C++ Wasm, pass `-msimd128` with `-O2` or `-O3` (Emscripten/clang). For Rust, set `RUSTFLAGS="-C target-feature=+simd128"`. Write hot loops as simple counted loops over contiguous arrays so that LLVM's autovectorizer can use them.
- Why: The flag enables the 128-bit `v128` type and LLVM's loop and SLP vectorizers. The post shows a scalar `i32.mul` loop turned into `v128.load` + `i32x4.mul` + `v128.store`, four elements per iteration.
- Example:
  ```sh
  emcc -O3 -msimd128 indicators.c -o indicators.js
  RUSTFLAGS="-C target-feature=+simd128" cargo build --release --target wasm32-unknown-unknown
  ```
- Avoid/caveats: The vectorizer must prove that arrays do not alias and must handle unaligned heads and tails, so it adds checking code. SIMD does not help pointer-chasing or branchy code. Measure: `f64x2` gives only 2 lanes. The Emscripten docs list `-fno-vectorize -fno-slp-vectorize` to turn the autovectorizer off if it grows code without gain.
- Status: Fixed-width SIMD: Baseline widely available since 2025-09-27 (Chrome 91, Firefox 89, Safari 16.4). Wasm 2.0 feature.
- Sources: https://v8.dev/features/simd ; https://emscripten.org/docs/porting/simd.html ; web-features `wasm-simd`

### Ship one SIMD build for Baseline-widely-available targets; keep a second non-SIMD build only for older browsers
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, startup
- When: build, load
- Impact: low to medium, because a dual build doubles build and cache variants and adds a feature-detection step before the Wasm fetch.
- Do: If your browser support target is "Baseline widely available" (or newer than Safari 16.4 / Chrome 91 / Firefox 89), build only the SIMD variant. If you must support older engines, keep the post's pattern: detect with `wasm-feature-detect` (`simd()`), then `import()` the matching glue module.
- Why: A module that uses SIMD opcodes fails validation in an engine without SIMD, so a single build was not safe in 2020-2023. Since Safari 16.4 (March 2023) all engines validate it, and the feature became Baseline widely available on 2025-09-27.
- Avoid/caveats: Relaxed SIMD is a different story (see below). Detection with `WebAssembly.validate()` on a tiny SIMD module is what `wasm-feature-detect` does internally (not re-read here).
- Status: OBSOLETE (for Baseline-widely targets): the post's "build two versions and feature-detect" advice. Still valid for relaxed SIMD.
- Sources: https://v8.dev/features/simd ; web-features `wasm-simd` ; https://emscripten.org/docs/porting/simd.html

### Hand-write SIMD intrinsics for the hottest kernels, and guarantee alignment, no aliasing and a lane-multiple length (or handle the tail)
- Layer: build (v8)
- Stage: script-run
- Metrics: FPS/smoothness, bundle-size
- When: animation/render-loop
- Impact: medium, because hand-written SIMD code is often smaller and faster than autovectorized code for the same loop.
- Do: For the few kernels that dominate a profile, use `wasm_simd128.h` intrinsics (C/C++) or `core::arch::wasm32` (Rust). Allocate input and output buffers 16-byte aligned, do not pass overlapping buffers, and either pad lengths to a multiple of the lane count or process the tail with scalar code. For existing SSE/NEON code, compile it with Emscripten's compatibility headers (`-msse…`/`-mfpu=neon` plus `-msimd128`).
- Why: The post explains that the autovectorizer cannot assume alignment, non-aliasing or a size that is a multiple of four, so it emits extra code for those cases; intrinsics code that knows these facts skips it. Emscripten maps SSE/AVX/NEON intrinsics to Wasm SIMD where it can and scalarizes the rest.
- Example:
  ```c
  #include <wasm_simd128.h>
  // n is a multiple of 4; a, b, out are 16-byte aligned and do not overlap
  void mul4(float* out, const float* a, const float* b, int n) {
    for (int i = 0; i < n; i += 4)
      wasm_v128_store(out + i, wasm_f32x4_mul(wasm_v128_load(a + i), wasm_v128_load(b + i)));
  }
  ```
- Avoid/caveats: Rust no longer needs nightly for this: the `core::arch::wasm32` SIMD intrinsics are stable since Rust 1.54 (2021). The post's `#![feature(wasm_simd)]` and the `packed_simd` crate are out of date.
- Status: Current (Emscripten docs 2026-09-23; Rust 1.54 release notes, search result only).
- Sources: https://v8.dev/features/simd ; https://emscripten.org/docs/porting/simd.html ; https://blog.rust-lang.org/2021/07/29/Rust-1.54.0/ (search result only)

### Avoid Wasm SIMD operations that are slow on x86 in hot loops (IEEE float min/max, i8x16 shifts, i64x2 multiply, saturating float-to-int)
- Layer: build (v8)
- Stage: script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: medium for min/max-heavy chart kernels (for example the y-range of visible data), because one Wasm op can become 7-14 x86 instructions.
- Do: For min/max over data without NaN, use the pseudo-min/max ops (`wasm_f32x4_pmin`/`pmax`, `wasm_f64x2_pmin`/`pmax`) instead of `f32x4.min`/`max`. Avoid `i8x16` shifts, `i64x2.shr_s`, `i8x16`/`i64x2` multiply and `trunc_sat` conversions in inner loops, or restructure the math. Compile SSE ports with `#define WASM_SIMD_COMPAT_SLOW` to get warnings for slow paths.
- Why: Wasm SIMD fixes NaN and signed-zero semantics that x86 does not match with one instruction, so the engine emits fix-up sequences. The Emscripten table lists float min/max at 7-10 x86 instructions, i8x16 shifts at 5-11, `i64x2.shr_s` at 6-12, saturating truncation at 8-14, and i8x16/i64x2 multiply at about 10.
- Avoid/caveats: `pmin`/`pmax` return one of the inputs when a NaN or ±0 is involved; use them only when your data cannot hold NaN or when that result is acceptable. The numbers are for x86; ARM costs differ.
- Status: Emscripten SIMD docs (read 2026-09-23).
- Sources: https://emscripten.org/docs/porting/simd.html

### Use relaxed SIMD only where results may differ between machines, feature-detect it, and never use it for values that must be bit-exact
- Layer: build (v8)
- Stage: script-run
- Metrics: FPS/smoothness
- When: build, animation/render-loop
- Impact: low to medium: relaxed FMA, swizzle and dot products are faster on hardware that has them, but results can change by CPU.
- Do: Enable relaxed SIMD (`-mrelaxed-simd` with `-msimd128`) only in a separately feature-detected build, and only for visual output (for example pixel or vertex math). Keep prices, P&L, indicator values and anything compared across clients on fixed-width SIMD or scalar code.
- Why: Relaxed SIMD adds 20 instructions whose results are implementation-defined: `relaxed_madd`/`nmadd` may be fused (one rounding) or not; `relaxed_min`/`max` may return either input for NaN or ±0; `relaxed_trunc` may return 0 or an extreme value for NaN and out-of-range lanes; `relaxed_swizzle` may return 0 or wrap for indices 16-255; the dot products may treat high-bit lanes as signed or unsigned. Each engine picks one behavior and keeps it within that environment, so a machine is self-consistent, but two machines may differ.
- Avoid/caveats: Safari has no support, so a module that uses relaxed ops fails to validate there.
- Status: Relaxed SIMD is a finished proposal (Wasm 3.0, WG 2024-07-10). web-features `wasm-simd-relaxed`: limited availability (Chrome 114, Firefox 146, no Safari). V8 `main` lists `relaxed_simd` as an always-on (non-flag) feature.
- Sources: https://v8.dev/features/simd ; https://github.com/WebAssembly/relaxed-simd/blob/main/proposals/relaxed-simd/Overview.md ; https://raw.githubusercontent.com/WebAssembly/proposals/main/finished-proposals.md ; https://emscripten.org/docs/porting/simd.html ; web-features `wasm-simd-relaxed` ; V8 `src/wasm/wasm-features.h`

### Do not use SIMD.js or JS "SIMD" polyfills; move data-parallel kernels to Wasm SIMD (or to the GPU)
- Layer: js
- Stage: script-run
- Metrics: FPS/smoothness, bundle-size
- When: build
- Impact: low, because SIMD.js does not exist in any shipping engine; a polyfill only adds bytes and scalar code.
- Do: Keep JavaScript kernels as plain typed-array loops. When a kernel is hot enough to need SIMD, write it in Wasm with SIMD, or move it to a WebGL/WebGPU shader when the output goes to the GPU anyway.
- Why: TC39 archived the SIMD.js proposal in favor of SIMD in WebAssembly. V8 does not expose vector types to JavaScript.
- Avoid/caveats: A JS-to-Wasm hop has a cost per call; see the JS-to-Wasm rule in section F.
- Status: DEPRECATED: SIMD.js (archived proposal, per the post).
- Sources: https://v8.dev/features/simd

---

## D. Atomics.wait, Atomics.notify, Atomics.waitAsync (post: 2020-09-24)

### Never block or spin on the main thread: no `Atomics.wait`, no busy loops; use `Atomics.waitAsync` or check shared state once per frame
- Layer: js
- Stage: main-thread-task, script-run
- Metrics: INP, FPS/smoothness, TBT
- When: interaction, animation/render-loop
- Impact: high, because a blocked or spinning main thread cannot render or handle input.
- Do: On the window thread, wait for a worker with `Atomics.waitAsync(i32, index, expected, timeoutMs)`, or read a shared sequence counter with `Atomics.load` at the start of each `requestAnimationFrame` callback. Keep `Atomics.wait` and spin loops in workers only.
- Why: `Atomics.wait` suspends the whole agent. HTML creates the similar-origin window agent with `[[CanBlock]]` false and says "Only shared and dedicated worker agents allow the use of JavaScript Atomics APIs to potentially block", so `Atomics.wait` throws a `TypeError` on the window (the post), and it cannot block in service workers or worklets (for example an AudioWorklet) either. `Atomics.waitAsync` returns at once with `{ async: false, value: 'not-equal' | 'timed-out' }` or `{ async: true, value: promise }`; the promise resolves to `'ok'` or `'timed-out'` and never rejects.
- Example:
  ```js
  // main thread: wake when the worker bumps ctrl[SEQ]
  async function waitForData(seen) {
    const r = Atomics.waitAsync(ctrl, SEQ, seen, 1000);
    if (r.async) await r.value;          // 'ok' or 'timed-out'
    return Atomics.load(ctrl, SEQ);
  }
  ```
- Avoid/caveats: For a render loop, polling one `Atomics.load` per frame is simpler and cheaper than `waitAsync`, because the frame is the natural consumer tick.
- Status: `Atomics.waitAsync`: Baseline newly available since 2025-11-11 (Chrome 90 per BCD, Firefox 145, Safari 16.4). The post says Chrome 87 and "Firefox/Safari: no support"; that table is out of date. `SharedArrayBuffer`/Atomics: Baseline widely available (2024-06-13).
- Sources: https://v8.dev/features/atomics ; web-features `atomics-wait-async`, `shared-memory` ; https://html.spec.whatwg.org/multipage/webappapis.html#integration-with-the-javascript-agent-formalism

### Make `SharedArrayBuffer` available with cross-origin isolation, check `crossOriginIsolated`, and keep a transfer-based fallback
- Layer: network (js)
- Stage: network, script-run
- Metrics: INP, FPS/smoothness
- When: load, build (server config)
- Impact: high for any design that uses Atomics, because without isolation `SharedArrayBuffer` is not available and `postMessage` of one throws.
- Do: Serve the document with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless` where supported). In Chrome 137+ desktop you can use `Document-Isolation-Policy: isolate-and-require-corp` or `isolate-and-credentialless` instead. At run time, branch on `globalThis.crossOriginIsolated`; if it is false, fall back to transferring `ArrayBuffer`s with `postMessage(buf, [buf])`.
- Why: MDN states that the document must be a secure context and cross-origin isolated, and that otherwise "the various postMessage() APIs will throw for SharedArrayBuffer objects". The same rule applies to shared `WebAssembly.Memory` (Wasm threads). Document-Isolation-Policy applies per document and makes no requirements of subframes, unlike COEP.
- Example:
  ```js
  const ring = crossOriginIsolated
    ? new SharedArrayBuffer(1 << 20)
    : null;                       // fallback: transfer ArrayBuffers per batch
  worker.postMessage({ ring });
  ```
- Avoid/caveats: `require-corp` blocks cross-origin subresources (CDN fonts, images, third-party iframes) that do not send `Cross-Origin-Resource-Policy` or CORS. `credentialless` is not in Safari. Document-Isolation-Policy is Chrome-only and desktop-only per its launch post.
- Status: COOP/COEP: Chrome 83, Firefox 79, Safari 15.2 (BCD). COEP `credentialless`: Chrome 96, Firefox 119, Safari no (BCD). Document-Isolation-Policy: Chrome 137 desktop (Chrome blog); Android status not verified.
- Sources: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer ; https://developer.chrome.com/blog/document-isolation-policy ; BCD `http/headers/Cross-Origin-Embedder-Policy.json`, `Cross-Origin-Opener-Policy.json`

### Build a mutex with `compareExchange` plus `wait`/`notify` on an `Int32Array`, retry in a loop after every wake-up, and notify one waiter
- Layer: js
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: long-lived session
- Impact: medium, because a wrong wait value or a missing retry loop gives lost wake-ups (a stuck worker) or two holders of the lock.
- Do: Keep the lock word in an `Int32Array` (or `BigInt64Array`) over a `SharedArrayBuffer`. Acquire with `Atomics.compareExchange(a, i, UNLOCKED, LOCKED)`; if that fails, `Atomics.wait(a, i, LOCKED)` (worker) or `await Atomics.waitAsync(a, i, LOCKED).value` (any thread), then loop and try again. Release with a state change and `Atomics.notify(a, i, 1)`.
- Why: `wait` and `waitAsync` sleep only if the word still holds the expected value; otherwise they return `'not-equal'` at once. That closes the race where the holder unlocks between the failed `compareExchange` and the `wait`. After a wake-up another thread can take the lock first (the lock is not fair), so the waiter must try again. `notify` wakes waiters in FIFO order; waking one avoids waking every waiter only to have all but one go back to sleep. Only `Int32Array` and `BigInt64Array` are valid for `wait`/`notify`; `notify` on a non-shared buffer returns 0.
- Avoid/caveats: The post's `AsyncLock.executeLocked(f)` runs `f` synchronously after acquiring the lock; keep `f` short, because every waiter is blocked for its duration. For fairness or heavy contention, use more states (next rule).
- Status: Current (ECMA-262 `DoWait`, `Atomics.notify` text checked 2026-09-23).
- Sources: https://v8.dev/features/atomics ; https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics.notify

### Use a three-state lock (unlocked, locked, locked with waiters) so an uncontended unlock skips `Atomics.notify`
- Layer: js
- Stage: script-run
- Metrics: FPS/smoothness
- When: long-lived session
- Impact: low to medium: it removes one call and one waiter-list critical section from every uncontended unlock.
- Do: Mark the lock as 2 ("contended") when a thread must wait, and call `Atomics.notify` in `unlock` only when the old state was 2.
- Why: The post says a realistic lock "may use several states" to tell "locked" from "locked with contention". In the spec, `Atomics.notify` enters the waiter list's critical section even when nobody waits. The design below is the classic futex mutex; it is not from the post.
- Example:
  ```js
  // 0 = unlocked, 1 = locked, 2 = locked and someone may be waiting (worker only)
  function lock(a) {
    let c = Atomics.compareExchange(a, 0, 0, 1);
    if (c === 0) return;
    if (c !== 2) c = Atomics.exchange(a, 0, 2);
    while (c !== 0) { Atomics.wait(a, 0, 2); c = Atomics.exchange(a, 0, 2); }
  }
  function unlock(a) {
    if (Atomics.sub(a, 0, 1) !== 1) {   // old value was 2: there may be waiters
      Atomics.store(a, 0, 0);
      Atomics.notify(a, 0, 1);
    }
  }
  ```
- Avoid/caveats: Do not write your own lock when a message or a lock-free queue (below) is enough. Test with more than two workers.
- Status: Pattern; APIs Baseline widely available.
- Sources: https://v8.dev/features/atomics ; https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics.notify

### In workers, spin briefly with `Atomics.pause()` before falling back to `Atomics.wait`
- Layer: js
- Stage: script-run
- Metrics: FPS/smoothness, memory
- When: long-lived session
- Impact: low: for short critical sections a few spins avoid a sleep/wake cycle; the pause hint saves power and helps the other hyper-thread.
- Do: In a worker lock, try `compareExchange` in a short loop (about 10 tries) with `Atomics.pause()` between tries, then wait. Never spin on the main thread.
- Why: `Atomics.wait` schedules the thread off the core and back, which is expensive when the lock is released a few nanoseconds later. ECMA-262 defines `Atomics.pause()` (no arguments) as a hint that the code is in a spin-wait loop; engines are expected to emit a CPU pause/yield instruction and to bound the pause to tens to hundreds of nanoseconds.
- Example:
  ```js
  for (let i = 0; i < 10; i++) {
    if (Atomics.compareExchange(a, 0, 0, 1) === 0) return;   // got it
    Atomics.pause();
  }
  // slow path: three-state wait loop from the previous rule
  ```
- Avoid/caveats: MDN warns that spinlocks may not beat plain waits unless designed carefully. Measure under contention.
- Status: `Atomics.pause`: Baseline newly available since 2025-04-01 (Chrome 133, Firefox 137, Safari 18.4).
- Sources: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/pause ; https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics.pause ; web-features `atomics-pause`

### Expect `Atomics.waitAsync` to resume in a new task, not in a microtask
- Layer: js
- Stage: main-thread-task, microtask
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: low to medium: the continuation runs after any queued tasks, and rendering can happen before it.
- Do: Do not use `waitAsync` to hand off work that must finish in the same frame. For per-frame data, read the shared state in the `requestAnimationFrame` callback. For latency-sensitive handoff, keep the consumer in a worker.
- Why: ECMA-262 resolves the `waitAsync` promise through `HostEnqueueGenericJob`. HTML implements that hook as "queue a global task on the JavaScript engine task source", so the resolution waits its turn in the task queue before the `await` continuation (a microtask) can run.
- Avoid/caveats: The task source is not prioritized; under a busy main thread, the delay grows with the backlog.
- Status: WHATWG HTML Living Standard (`HostEnqueueGenericJob`).
- Sources: https://html.spec.whatwg.org/multipage/webappapis.html#hostenqueuegenericjob ; https://v8.dev/features/atomics

### Stream worker data through a single-producer/single-consumer ring buffer: use Atomics only on the head and tail indexes, and plain typed-array access for the payload
- Layer: js
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop, long-lived session
- Impact: medium to high for tick streams: no per-message allocation, no structured clone, and no lock.
- Do: Put `[head, tail]` in an `Int32Array` and the payload in a `Float64Array` on the same `SharedArrayBuffer`. The producer writes payload slots with plain stores, then publishes with `Atomics.store(head)`. The consumer reads `head` with `Atomics.load`, reads the slots with plain loads, then publishes `tail` with `Atomics.store`.
- Why: Atomics operations are sequentially consistent, so a plain write that happens before an `Atomics.store` is visible to a thread that later reads that value with `Atomics.load`. In V8 each `Atomics.*` call validates the typed array and the index (CSA builtins in `builtins-sharedarraybuffer-gen.cc`); I found no TurboFan reduction for them in `js-call-reducer.cc`, so plain element access is the cheaper path for bulk data (inference from source, not measured).
- Example:
  ```js
  // Layout: ctrl = Int32Array(sab, 0, 2) -> [head, tail]; buf = Float64Array(sab, 8, CAP)
  function push(v) {                                   // worker (producer)
    const head = Atomics.load(ctrl, 0);
    const next = (head + 1) % CAP;
    if (next === Atomics.load(ctrl, 1)) return false;  // full
    buf[head] = v;                                     // plain write
    Atomics.store(ctrl, 0, next);                      // publish
    return true;
  }
  function drain(sink) {                               // main thread, once per frame
    let tail = Atomics.load(ctrl, 1);
    const head = Atomics.load(ctrl, 0);
    while (tail !== head) { sink(buf[tail]); tail = (tail + 1) % CAP; }
    Atomics.store(ctrl, 1, tail);
  }
  ```
- Avoid/caveats: Exactly one producer and one consumer; more of either needs `compareExchange`. Decide what "full" means for market data (drop oldest, coalesce, or block the worker). The pattern is not from the post; it applies the post's primitives.
- Status: APIs Baseline widely available; requires cross-origin isolation (see above).
- Sources: https://v8.dev/features/atomics ; https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics-object ; V8 `src/builtins/builtins-sharedarraybuffer-gen.cc`, `src/compiler/js-call-reducer.cc` (main, 2026-09-23)

### Give `Atomics.wait` a timeout in any worker that must also handle messages
- Layer: js
- Stage: main-thread-task, script-run
- Metrics: INP
- When: long-lived session
- Impact: medium, because a worker that is waiting runs no event loop: its `onmessage`, timers and cancel requests all stay queued.
- Do: Pass a finite `timeout` (milliseconds) to `Atomics.wait` in workers that also receive `postMessage` commands, and return to the event loop between waits. Use a worker that only waits on shared memory (no message protocol) when you need an unbounded wait.
- Why: `Atomics.wait` suspends the agent until `notify` or the timeout (default `Infinity`); the post lists the return values `'ok'`, `'not-equal'`, `'timed-out'`. Tasks for that worker cannot run while it is suspended.
- Avoid/caveats: Short timeouts in a loop turn into polling; choose the timeout from the latency you need for control messages.
- Status: Current.
- Sources: https://v8.dev/features/atomics ; https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics.wait

---

## E. WebAssembly tiering: Liftoff (post: 2018-08-20), dynamic tiering (post: 2021-10-29), and the current pipeline

Current pipeline (v8.dev pipeline doc and V8 `main` flags): functions are compiled lazily with Liftoff on their first call (`--wasm-lazy-compilation`, default on since 2022-11, commit 29131d5e3e). Liftoff code charges a per-function budget (`--wasm-tiering-budget` = 13,000,000, "rough approximation of bytes executed") at loop back edges and returns; when the budget runs out, TurboFan recompiles that function on a background thread (`--wasm-dynamic-tiering`, V8 default since 2022-04, commit bfe12807c1). New calls use the TurboFan code. There is no on-stack replacement.

### Put hot Wasm loops in functions that are called many times, not in one long-running call
- Layer: v8 (build)
- Stage: script-run
- Metrics: FPS/smoothness, TBT
- When: animation/render-loop, long-lived session
- Impact: medium to high: a loop that runs inside a single call stays in Liftoff code for that whole call. The Liftoff post measured Liftoff code about 50% slower than TurboFan on Unity benchmarks on desktop, about 70% on a MacBook, and 18-54% slower on PSPDFKit.
- Do: Structure Wasm work as a function called per chunk, per frame, or per batch (for example `processBatch(ptr, len)` called many times), not as one `run()` that loops for seconds. When a long job is unavoidable, split it into chunks that each call the kernel again.
- Why: The pipeline doc says V8 does not do on-stack replacement for Wasm: "if TurboFan code becomes available after the function was called, the function call will complete its execution with Liftoff code". The dynamic tiering post warns that execution "can be stuck in a loop in Liftoff code". Liftoff charges the tier-up budget on loop back edges, so the hot function does get queued for TurboFan, but only later calls benefit.
- Example:
  ```js
  // Before: one call, runs in Liftoff for its whole lifetime
  wasm.exports.decimateAll(ptr, totalPoints);

  // After: repeated calls pick up TurboFan code once it is ready (and can yield between chunks)
  for (let off = 0; off < totalPoints; off += CHUNK) {
    wasm.exports.decimateChunk(ptr, off, Math.min(CHUNK, totalPoints - off));
  }
  ```
- Avoid/caveats: Chunking also lets JS yield between chunks (see the scheduling rules in file 06). Do not make chunks so small that the JS-to-Wasm call overhead dominates.
- Status: Current (pipeline doc; no Wasm OSR flag exists in V8 `main` 2026-09-23; `liftoff-compiler.cc` `TierupCheck` on loop back edges and returns).
- Sources: https://v8.dev/docs/wasm-compilation-pipeline ; https://v8.dev/blog/wasm-dynamic-tiering ; https://v8.dev/blog/liftoff ; V8 `src/wasm/baseline/liftoff-compiler.cc`, `src/flags/flag-definitions.h`

### Warm up the Wasm code paths that the first interaction will use, off the interaction
- Layer: v8
- Stage: script-compile, main-thread-task
- Metrics: INP, startup
- When: load, interaction
- Impact: low to medium: each first call of a Wasm function compiles it with Liftoff synchronously on the calling thread, and a first interaction that touches many new functions (first zoom, first series type) pays for all of them.
- Do: After the first render, while the page is idle, exercise the likely paths once (for example render a chart with a small data set, or call the zoom/pan kernels on dummy data). Do the same in the worker that will run the Wasm module.
- Why: The pipeline doc: "Initially, V8 does not compile any functions in a WebAssembly module", and in lazy mode "the function is first compiled with Liftoff (blocking execution)". Liftoff compiles "tens of megabytes per second", so one small function costs little, but hundreds of functions add up. Warm-up also starts the tier-up budget earlier.
- Avoid/caveats: Warm-up costs CPU at load; schedule it after LCP and in idle time. It does not help functions the warm-up never calls. Not measured in this batch.
- Status: Current (lazy compilation default since 2022-11, V8 commit 29131d5e3e; exact Chrome milestone not verified).
- Sources: https://v8.dev/docs/wasm-compilation-pipeline ; V8 `src/flags/flag-definitions.h` (`wasm_lazy_compilation`, true)

### Measure Wasm at steady state after tier-up, and use the `v8.wasm` trace events to see when tiering finished
- Layer: tooling
- Stage: script-compile, script-run
- Metrics: FPS/smoothness, startup
- When: testing
- Impact: medium, because early samples mix Liftoff code, lazy compiles, and (since 2025) deopts, and give wrong numbers.
- Do: Run the workload until timings stabilize before you record numbers, or report cold and warm numbers separately. Use a trace with the `v8.wasm` category: `wasm.BaselineFinished` marks the end of Liftoff compilation, `wasm.TopTierFinished` the end of TurboFan compilation, and `v8.wasm.detailed` gives per-function compile times. Keep DevTools closed or record inside the Performance panel (batch 4).
- Why: Only functions that used up their tier-up budget run TurboFan code, and speculative Wasm inlining (section F) needs feedback collected by Liftoff code first. In 2018 the Liftoff post measured 18-70% slower Liftoff code.
- Avoid/caveats: `chrome://tracing` is superseded by the Perfetto UI; the categories are the same (batch 4).
- Status: Current (pipeline doc).
- Sources: https://v8.dev/docs/wasm-compilation-pipeline ; https://v8.dev/blog/liftoff ; https://v8.dev/blog/wasm-speculative-optimizations

### Keep Wasm binaries small; code that is never called still costs download, decoding and validation
- Layer: build
- Stage: network, script-compile
- Metrics: startup, bundle-size, memory
- When: build, load
- Impact: medium: the Liftoff post notes that compile time is roughly linear in binary size (39.5 MB and 36.8 MB apps took over 30 s on many machines in 2018). Lazy compilation removes most of the compile cost for cold code, but not the transfer and decoding cost.
- Do: Strip unused code (link-time dead code elimination, `wasm-opt -O`/`-Oz`), avoid pulling whole libraries for one function, and split rarely used features into a separately loaded module when they are large.
- Why: With lazy compilation V8 compiles only called functions. The WebAssembly JS API still has to reject an invalid module in `compile`/`instantiate`, so the whole binary is downloaded and checked before instantiation (spec reasoning; V8's exact validation timing was not verified in this batch). Eager whole-module TurboFan compilation also used to double code memory temporarily (Liftoff post); dynamic tiering keeps TurboFan code only for hot functions.
- Avoid/caveats: For a third-party engine such as SciChart.js you cannot shrink the binary; make sure it streams and caches (batch 4) and load it early.
- Status: Current.
- Sources: https://v8.dev/blog/liftoff ; https://v8.dev/blog/wasm-dynamic-tiering ; https://v8.dev/docs/wasm-compilation-pipeline

### Leave CPU headroom for background TurboFan compiles when you size worker pools
- Layer: js
- Stage: script-compile, main-thread-task
- Metrics: startup, INP, TBT
- When: load
- Impact: low to medium on machines with few cores, during the first seconds after a large Wasm module starts.
- Do: Size compute worker pools below `navigator.hardwareConcurrency` (for example `hardwareConcurrency - 1`, at least 1), and start heavy worker jobs after the Wasm module has warmed up when startup matters.
- Why: The dynamic tiering post says that "CPU cores that execute TurboFan compilation in the background can block other tasks that would require the CPU, e.g. workers of the web application". Dynamic tiering reduces this by compiling only hot functions, but hot functions still compile in the background (up to `--wasm-num-compilation-tasks` = 128 parallel tasks in V8 `main`).
- Avoid/caveats: This rule is an inference from the post; not measured.
- Status: Current behavior (dynamic tiering default).
- Sources: https://v8.dev/blog/wasm-dynamic-tiering ; V8 `src/flags/flag-definitions.h`

### Test chart and Wasm performance with the V8 optimizer turned off, because some users run Liftoff-only
- Layer: tooling
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: testing
- Impact: medium for users on Chrome's Advanced Protection (Android) or with the per-site "JavaScript optimization & security" setting off: their JS runs without optimizing tiers and their Wasm without TurboFan.
- Do: Run one test pass with the site setting "Javascript optimization & security" set to off for your origin. Make sure the chart stays usable (for example lower the point density or decimate more when frame times are high).
- Why: V8's `--disable-optimizing-compilers` implies `--liftoff` and turns off Wasm tier-up ("Wasm code must execute with Liftoff"). Google's security blog says the setting has existed per site since Chrome 133 and that Advanced Protection users have the optimizers disabled by default.
- Avoid/caveats: Do not detect or block these users; degrade gracefully.
- Status: Current (Chrome 133+; blog 2025-07).
- Sources: https://blog.google/security/advancing-protection-in-chrome-on/ ; V8 `src/flags/flag-definitions.h` (`disable_optimizing_compilers`)

---

## F. Speculative optimizations for WebAssembly: deopts and inlining (post: 2025-06-24)

### Keep hot indirect calls monomorphic (at most 4 targets per call site) and keep hot callees small
- Layer: v8 (build)
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: medium to high for Wasm built from C++ virtual calls, Rust trait objects, function-pointer tables, or WasmGC languages: the post's microbenchmark went from 675 ms to 90 ms, Dart microbenchmarks gained 1.59x on average, and real apps 1-8%.
- Do: In C/C++/Rust code that becomes Wasm, keep hot dispatch sites to one target (or a few). Devirtualize hot loops (templates/generics, `final` classes, a `switch` on a small enum). Keep hot helper functions short so the inliner accepts them.
- Why: Liftoff records call targets per call site in a feedback vector: uninitialized, monomorphic, polymorphic (up to 4 targets), or megamorphic (more than 4, no inlining). TurboFan reads the feedback and inlines up to 4 targets behind target checks, then constant-folds across the inlined body. V8 `main` limits: `--wasm-inlining-max-size` = 500 wire bytes (larger functions are never inlined), `--wasm-inlining-budget` = 5000 TurboFan nodes per function, and at most 3x growth of the caller graph. The post notes that spending the budget on 16 `call_indirect` sites once made three benchmarks slower.
- Example:
  ```cpp
  // Before: virtual call per point in the hot loop (call_indirect)
  for (auto* s : series) s->project(xs, ys, n);

  // After: group by concrete type so each loop has one target
  for (auto& s : lineSeries) s.project(xs, ys, n);   // direct call, inlinable
  for (auto& s : bandSeries) s.project(xs, ys, n);
  ```
- Avoid/caveats: The toolchain (Binaryen/LLVM) can devirtualize ahead of time when it can prove the target; runtime speculation only covers the rest. Inlining does not change semantics; this is a speed lever only.
- Status: Shipped in Chrome M137 (post). V8 `main`: `wasm_inlining` and `wasm_inlining_call_indirect` default true (enabled 2025-04-07, commit e8301c0028). `call_ref` inlining shipped earlier with WasmGC.
- Sources: https://v8.dev/blog/wasm-speculative-optimizations ; V8 `src/flags/flag-definitions.h`

### Do not change function-table entries or hot function pointers after warm-up
- Layer: v8 (build)
- Stage: script-run
- Metrics: FPS/smoothness
- When: long-lived session
- Impact: medium: each broken assumption costs a deoptimization, Liftoff re-compilation of the inlined functions, slower code until the next tier-up, and after 10 deopts the function loses deopt-based speculation.
- Do: Fill `call_indirect` tables and function-pointer slots at startup and leave them alone in hot paths. Model changing behavior with data (flags, enums) read inside a stable function instead of swapping the function.
- Why: Speculatively inlined code checks the table index bounds, the instance, and the target. On a mismatch it jumps to a deopt exit; the deoptimizer rebuilds Liftoff frames (it recompiles each inlined function with Liftoff to learn the frame layout) and continues in baseline code, which records the new target. V8 `main` sets `--wasm-deopts-per-function-limit` = 10, after which TurboFan emits no more deopt points for that function and uses a generic slow path. The post shows why deopts matter: with inlining but no deopts the benchmark took 180 ms instead of 90 ms.
- Avoid/caveats: One-time changes (plugin load) are fine; a target that flips every frame is not.
- Status: Wasm deopts default on since 2025-04-07 (commit bec1fa5a87), shipped in Chrome M137.
- Sources: https://v8.dev/blog/wasm-speculative-optimizations ; V8 `src/flags/flag-definitions.h` (`wasm_deopt`, `wasm_deopts_per_function_limit`)

### Keep hot Wasm-to-Wasm calls inside one module instance
- Layer: v8 (build)
- Stage: script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low to medium: calls into another instance (for example through an imported table) are not inlined and take the deopt path when the check fails.
- Do: Link hot code into one Wasm module. Do not split a hot kernel and its callbacks across instances connected by imported tables or imported functions.
- Why: Wasm functions close over their instance (globals, tables, imports). For `call_indirect` inlining V8 checks that the target's instance is the current instance and deoptimizes on "wrong instance"; `call_ref` compares the `WasmFuncRef`, which includes the instance.
- Avoid/caveats: Dynamic linking (Emscripten side modules) and plugin architectures create several instances by design; keep them off the hot path.
- Status: Current per the post (2025). V8 may extend cross-instance inlining later.
- Sources: https://v8.dev/blog/wasm-speculative-optimizations

### Give Wasm exports that hot JS calls a numeric signature (i32/i64/f32/f64/externref, at most one result), call them from monomorphic sites, and batch work per call
- Layer: v8 (js)
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: animation/render-loop, interaction
- Impact: medium: in optimized JS the JS-to-Wasm wrapper is inlined into the caller for such signatures; other signatures go through a generic wrapper call.
- Do: Pass pointers (offsets into Wasm memory) and lengths as `i32`, and numbers as `f64`/`f32`; return one value or write results into Wasm memory that JS reads through a typed-array view. Call each export from a call site that always calls the same function. Move per-point work into one call per batch or per frame.
- Why: V8's TurboFan inlines JS-to-Wasm wrappers when the Wasm signature has at most one return and only `i32`, `i64` (64-bit platforms), `f32`, `f64` or `externref` types, the export is not a JSPI "promising" function, and the call site allows speculation (`CanInlineJSToWasmCall` / `ReduceCallWasmFunction` in `js-call-reducer.cc`). This has been on by default since 2022-08 (V8 10.6 era, commit f1a4104ff9). The 2025 post lists inlining across the JS-Wasm boundary (Wasm body into JS) as future work; in V8 `main` it exists only in the Turbolev pipeline (`--wasm-in-js-inlining-body`, default true since 2026-06-11), and `--turbolev` itself is off by default, and Chromium's `gin_features.cc` has no Turbolev switch.
- Example:
  ```js
  // Before: one boundary crossing and one object per point
  for (const p of points) out.push(wasm.exports.project(p));
  // After: one crossing per frame; data lives in Wasm memory
  xsView.set(xs); ysView.set(ys);
  wasm.exports.projectAll(xsPtr, ysPtr, n);   // (i32, i32, i32) -> void
  ```
- Avoid/caveats: Emscripten embind APIs (SciChart.js uses Emscripten) add JS glue in front of the Wasm export, so these wrapper details apply only partly; the batching advice applies fully (prefer range/array APIs over per-point calls). Re-create typed-array views after `memory.grow`, because the old `ArrayBuffer` is detached.
- Status: Wrapper inlining current (V8 `main` 2026-09-23). Wasm-body-into-JS inlining: not active in Chrome by default (Turbolev off).
- Sources: https://v8.dev/blog/wasm-speculative-optimizations ; V8 `src/compiler/js-call-reducer.cc`, `src/flags/flag-definitions.h` ; V8 commits f1a4104ff9 (2022-08-05), 6ada6a90ee, 39d66a986e (2026-06-11) ; Chromium `gin/gin_features.cc`

---

## Cross-references to other batches

- Streaming Wasm compile, `Content-Type: application/wasm`, the Wasm code cache (TurboFan code only, incremental caching), warming in a service worker, and "DevTools open tiers Wasm down to Liftoff": batch 4, section A (`08-v8-batch-04.md`).
- "Keep top-level await out of modules on the critical path" and `import defer` status: batch 2 (`08-v8-batch-02.md`).
- "Ship large static data (10 kB or more) as `JSON.parse('…')`": batch 1 (`08-v8-batch-01.md`). JSON shapes and revivers: batch 4.
- WasmGC, JSPI, Wasm BigInt, 4 GB memory: batch 8.

## Deprecated or changed advice found in this batch

- Top-level await support table in the 2019 post ("Firefox: no", "Safari: 15"): Firefox has supported it since 89. Safari 15-26 is partial (ReferenceError when several modules import a TLA module, WebKit bug 242740); Safari 27 is the first full version. Baseline newly available 2026-09-14.
- "Build a SIMD and a non-SIMD Wasm and pick with wasm-feature-detect" (SIMD post): not needed for Baseline-widely targets since 2025-09-27; still needed for relaxed SIMD.
- Rust SIMD needs nightly, `#![feature(wasm_simd)]`, or the `packed_simd` crate (SIMD post): the `core::arch::wasm32` intrinsics are stable since Rust 1.54 (2021).
- SIMD.js: archived; there is no SIMD in JavaScript.
- Atomics.waitAsync "Chrome 87 only" (Atomics post): Baseline newly available since 2025-11-11 (BCD records Chrome 90).
- Liftoff "eager tier-up" (compile the whole module with Liftoff, then all of it with TurboFan in the background): replaced by lazy Liftoff compilation (2022-11) plus budget-based dynamic tiering (2022-04). The "Chrome uses at most 10 background compile threads" note is also old; V8 `main` allows up to 128 Wasm compilation tasks.
- Dynamic tiering "enable with `--enable-blink-features=WebAssemblyDynamicTiering` or an origin trial": it is the default; remove such flags and tokens.
- "There is no JS-to-Wasm inlining yet" (2025 post, future work): wrapper inlining has been on in TurboFan since 2022; Wasm-body inlining into JS exists only behind Turbolev, which is off by default.
- Old advice that Wasm never deoptimizes: since Chrome M137, optimized Wasm can deoptimize (speculative `call_indirect` inlining, and more speculative optimizations are planned).

## Sources read

- https://v8.dev/features/top-level-await
- https://v8.dev/features/subsume-json
- https://v8.dev/features/simd
- https://v8.dev/features/atomics
- https://v8.dev/blog/wasm-dynamic-tiering
- https://v8.dev/blog/liftoff
- https://v8.dev/blog/wasm-speculative-optimizations
- https://v8.dev/docs/wasm-compilation-pipeline
- https://v8.dev/blog/cost-of-javascript-2019 (JSON section, from the batch-1 raw copy)
- V8 `main` source (GitHub mirror, commit a81b3eb9dec6, 2026-09-23): `src/flags/flag-definitions.h`, `src/flags/feature-flags.h`, `src/wasm/wasm-features.h`, `src/wasm/baseline/liftoff-compiler.cc`, `src/compiler/js-call-reducer.cc`, `src/builtins/builtins-sharedarraybuffer-gen.cc`
- V8 commits: bfe12807c1 (dynamic tiering default, 2022-04-06), 4976642bbd (budget-based tiering, 2021-11-12), 29131d5e3e (lazy compilation default, 2022-11-14), bec1fa5a87 (Wasm deopts default, 2025-04-07), e8301c0028 (call_indirect inlining default, 2025-04-07), 6ada6a90ee and f1a4104ff9 (JS-to-Wasm wrapper inlining, 2021 and 2022-08-05), 39d66a986e (Wasm-in-JS body inlining default under Turbolev, 2026-06-11), plus GitHub commit search results used to find them
- Chromium `gin/gin_features.cc` (main, 2026-09-23)
- https://html.spec.whatwg.org/multipage/webappapis.html (run a module script, HostEnqueueGenericJob, agent formalism; local copy 2026-09-22)
- https://html.spec.whatwg.org/multipage/scripting.html (execute the script element, data blocks, restrictions for contents of script elements; local copy 2026-09-22)
- https://html.spec.whatwg.org/multipage/workers.html (run a worker)
- https://tc39.es/ecma262/multipage/structured-data.html (Atomics.pause, wait, waitAsync, notify)
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/pause
- https://developer.chrome.com/blog/document-isolation-policy
- https://blog.google/security/advancing-protection-in-chrome-on/ (redirect target of security.googleblog.com/2025/07/advancing-protection-in-chrome-on.html)
- https://emscripten.org/docs/porting/simd.html
- https://github.com/WebAssembly/relaxed-simd/blob/main/proposals/relaxed-simd/Overview.md
- https://raw.githubusercontent.com/WebAssembly/proposals/main/finished-proposals.md and README.md
- https://esbuild.github.io/content-types/
- https://rolldown.rs/in-depth/tla-in-rolldown
- https://bugs.webkit.org/show_bug.cgi?id=242740 (title only)
- BCD: `javascript/operators/await.json` (and its commit history), `http/headers/Cross-Origin-Embedder-Policy.json`, `http/headers/Cross-Origin-Opener-Policy.json`
- https://api.webstatus.dev/v1/features/top-level-await ; web-features dataset (local copy 2026-09-22): `top-level-await`, `json`, `json-modules`, `json-raw`, `atomics-pause`, `atomics-wait-async`, `shared-memory`, `wasm-simd`, `wasm-simd-relaxed`, `wasm-branch-hinting`, `wasm-threads`, `js-modules-workers`
- Web search results only (not opened): https://vite.dev/blog/announcing-vite8 ; https://blog.rust-lang.org/2021/07/29/Rust-1.54.0/ ; https://newreleases.io/project/github/evanw/esbuild/release/v0.10.0

## Not covered / could not access

- Exact Chrome milestones for three V8 default changes were not mapped: dynamic tiering (V8 commit 2022-04-06; the commit says Chromium flipped its own default in a separate change), lazy Wasm compilation (2022-11-14), and JS-to-Wasm wrapper inlining (2022-08-05). The notes give V8 commit dates only.
- I did not verify whether current V8 validates all Wasm function bodies at compile time or lazily; the "download, decode and validate" claim rests on the JS API rule that `compile` must reject invalid modules.
- I did not verify whether TurboFan or Maglev inline `Atomics.*` calls anywhere other than `js-call-reducer.cc`; the ring-buffer rule marks the cost claim as an inference.
- Document-Isolation-Policy status on Android and in other browsers was not verified (BCD has no entry that I could parse).
- No local measurements in this batch. The speed numbers are the posts' own (2018 Liftoff, 2020 MediaPipe, 2025 speculative inlining).
- Wasm branch hinting (Baseline newly available 2026-02-24 per web-features; always on in V8 `main`) and the compilation-hints proposal (Phase 2; experimental flag in V8) are related levers, but no toolchain documentation was read, so no rule is given.
- I did not check whether SciChart.js's Wasm build uses SIMD, or how its embind layer calls into Wasm; the SciChart notes in file 13 cover its public API.
- The WebKit bug page returned only its title (no comments or fix details).
