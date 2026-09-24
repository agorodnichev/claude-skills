# V8 blog index, classified for JS/TS app performance (08)

Checked: 2026-09-22. Author: research subagent for the "web-performance" skill.

## 1. Scope and method

- Source index: https://v8.dev/blog ("Blog post archive", one page, no pagination). Parsed from raw HTML. **154 posts**, from "Hello, world!" (2015-07-10) to "How we made JSON.stringify more than twice as fast" (2025-08-04).
- Completeness check: the GitHub source folder `v8/v8.dev/src/blog` (API listing) has the same 154 post files, no more and no less. The Atom feed https://v8.dev/blog.atom also starts at 2025-08-04. The last commit to `src/blog` is 2025-08-21 (a link fix). Result: **the V8 blog has published no new post between 2025-08-04 and 2026-09-22.**
- Feature explainers: https://v8.dev/features has **46 items** (2017-06-06 to 2025-05-09). Classified only for runtime-performance effect (section 6).
- Added on request: 2 mathiasbynens.be posts (section 5). "The cost of JavaScript in 2019" is already a v8.dev post.
- Every post was downloaded and converted to text (raw copies: `raw/v8-index/posts/*.html|.txt`, `raw/v8-index/features/*`). One-line reasons come from reading the post text, not from titles only.

Legend:

| Class | Meaning |
|---|---|
| high | Guidance that changes how we write JS/TS or Wasm glue (shapes, ICs, arrays, numbers, strings, classes, async, parsing/startup/code cache, GC, RegExp, JSON, builtins, Wasm loading). |
| medium | Engine behavior that informs a coding or build choice, or removes an old "avoid X" rule. |
| low | Release notes, internals, security, tools, history; no developer action. |
| none | No performance content (spec tutorials, launch post). |

Blog counts (154): high 19, medium 26, low 104, none 5. Plus 2 external high posts. Features (46): high 2, medium 6, low 10, none 28.

## 2. High, ranked by expected value to a JS/TS chart-app developer

| # | Date | Post | Source | Why (rule for the skill) |
|---|---|---|---|---|
| 1 | 2018-06-14 | [JavaScript engine fundamentals: Shapes and Inline Caches](https://mathiasbynens.be/notes/shapes-ics) | mathiasbynens.be | Shapes (hidden classes) and inline caches: initialize objects the same way (same keys, same order); do not change property attributes of array elements. |
| 2 | 2017-09-12 | [Elements kinds in V8](https://v8.dev/blog/elements-kinds) | v8.dev/blog | Keep arrays packed and single-type (SMI, DOUBLE, ELEMENTS); do not read past length, create holes, or mix kinds; prefer real arrays over array-likes. |
| 3 | 2019-06-25 | [The cost of JavaScript in 2019](https://v8.dev/blog/cost-of-javascript-2019) | v8.dev/blog | Download and execution dominate; split bundles >50-100 kB, avoid inline scripts >1 kB, JSON.parse for large (>=10 kB) data literals. |
| 4 | 2017-08-30 | [Fast properties in V8](https://v8.dev/blog/fast-properties) | v8.dev/blog | Hidden classes; in-object vs. fast vs. slow (dictionary) properties; adding and deleting many properties moves an object to slow dictionary properties. |
| 5 | 2019-08-28 | [The story of a V8 performance cliff in React](https://v8.dev/blog/react-cliff) | v8.dev/blog | Field representations (Smi, Double, HeapObject, Tagged), shape deprecation, and a freeze/preventExtensions cliff; init fields the same way, never null for numbers (NaN for empty doubles). |
| 6 | 2019-04-25 | [Faster and more feature-rich internationalization APIs](https://v8.dev/blog/intl) | v8.dev/blog | Create and reuse Intl.NumberFormat/DateTimeFormat/Collator objects instead of toLocaleString/localeCompare per call. |
| 7 | 2018-08-16 | [JavaScript engine fundamentals: optimizing prototypes](https://mathiasbynens.be/notes/prototypes) | mathiasbynens.be | Prototype loads are cached through ValidityCells; changing a prototype invalidates them, so do not mutate prototypes after startup. |
| 8 | 2020-09-24 | [Slack tracking in V8](https://v8.dev/blog/slack-tracking) | v8.dev/blog | V8 sizes in-object property space from the first constructions; add all properties in the constructor so they stay in-object and on one shape family. |
| 9 | 2025-08-04 | [How we made JSON.stringify more than twice as fast](https://v8.dev/blog/json-stringify) | v8.dev/blog | JSON.stringify fast path (Chrome 138+): no replacer/space arg, no toJSON, no integer-like keys on objects; arrays of same-shape objects hit a faster "express lane". |
| 10 | 2019-04-08 | [Code caching for JavaScript developers](https://v8.dev/blog/code-caching-for-devs) | v8.dev/blog | Keep code and URLs stable, deterministic startup, no inline scripts, files >=1 KiB, precache scripts in the service worker install step for a full code cache. |
| 11 | 2018-11-12 | [Faster async functions and promises](https://v8.dev/blog/fast-async) | v8.dev/blog | Native async/await is now faster than hand-written promise chains; await on a native promise costs 1 microtick; do not transpile or polyfill promises. |
| 12 | 2017-11-21 | [[feature] Dynamic import()](https://v8.dev/features/dynamic-import) | v8.dev/features | import() defers download, parse and compile of code until the user needs it (lazy routes, dialogs, rare tools). |
| 13 | 2018-06-18 | [[feature] JavaScript modules](https://v8.dev/features/modules) | v8.dev/features | Performance section: keep bundling for large module graphs (~300 modules loaded slower unbundled), use fine-grained modules, <link rel="modulepreload">, code splitting. Advice dates from 2018. |
| 14 | 2020-03-30 | [Pointer Compression in V8](https://v8.dev/blog/pointer-compression) | v8.dev/blog | Heap slots are 32-bit, Smis are 31-bit, double fields are boxed; for number-crunching arrays store data in Float64Array (or Wasm) instead of object fields. |
| 15 | 2019-01-03 | [Trash talk: the Orinoco garbage collector](https://v8.dev/blog/trash-talk) | v8.dev/blog | Generational GC: short-lived objects are cheap, survivors cost; parallel/concurrent/idle-time GC; explains GC pauses in animation. |
| 16 | 2025-04-29 | [Giving V8 a Heads-Up: Faster JavaScript Startup with Explicit Compile Hints](https://v8.dev/blog/explicit-compile-hints) | v8.dev/blog | Put //# allFunctionsCalledOnLoad at the top of a small "core" startup file for eager background compile (Chrome 136+); use sparingly. |
| 17 | 2019-04-15 | [Blazingly fast parsing, part 2: lazy parsing](https://v8.dev/blog/preparser) | v8.dev/blog | Lazy parsing and PIFE heuristic: parenthesized functions compile eagerly; put large object literals at top level or in a PIFE to avoid double parsing. |
| 18 | 2018-09-18 | [Improving DataView performance in V8](https://v8.dev/blog/dataview) | v8.dev/blog | DataView is as fast as TypedArray since V8 6.9; use it for mixed-type/endian binary protocol parsing without a speed penalty. |
| 19 | 2018-12-04 | [Speeding up spread elements](https://v8.dev/blog/spread-elements) | v8.dev/blog | [...x] and Array.from(x) take fast paths for arrays, strings, Sets and Maps when the spread is first and iterators are unmodified; holey double arrays need an elements-kind conversion. |
| 20 | 2022-04-20 | [Faster initialization of instances with new class features](https://v8.dev/blog/faster-class-features) | v8.dev/blog | Class field initializers and private methods now use inline caches (V8 9.7+); declare fields as class fields without a speed penalty. |
| 21 | 2025-02-25 | [Turbocharging V8 with mutable heap numbers](https://v8.dev/blog/mutable-heap-number) | v8.dev/blog | Script-level mutable numeric let bindings are now updated in place without allocation when their type stays stable (Smi/Int32/double); a type change deopts. |
| 22 | 2019-06-17 | [Code caching for WebAssembly developers](https://v8.dev/blog/wasm-code-caching) | v8.dev/blog | Use instantiateStreaming with application/wasm, keep URL and bytes stable (304), cache threshold 128 kB (2019), compile in a worker/service worker. |
| 23 | 2017-01-10 | [Speeding up V8 regular expressions](https://v8.dev/blog/speeding-up-regular-expressions) | v8.dev/blog | Do not modify RegExp instances or RegExp.prototype and avoid RegExp subclasses; they force the slow path. |

## 3. Medium, ranked

| # | Date | Post | Source | Why |
|---|---|---|---|---|
| 1 | 2017-02-17 | [High-performance ES2015 and beyond](https://v8.dev/blog/high-performance-es2015) | v8.dev/blog | Native ES2015+ features reached ES5 speed; transpiling to ES5 bloats code (650% for async generators), so ship modern syntax. |
| 2 | 2019-06-19 | [V8 release v7.6](https://v8.dev/blog/v8-release-76) | v8.dev/blog | JSON.parse became up to 2.7x faster and iterative; frozen/sealed arrays became fast for indexOf/includes/spread. |
| 3 | 2023-12-05 | [Maglev - V8’s Fastest Optimizing JIT](https://v8.dev/blog/maglev) | v8.dev/blog | Explains the 4 tiers (Ignition, Sparkplug, Maglev, TurboFan), feedback and deopts; informs warm-up and how to benchmark. |
| 4 | 2017-05-15 | [Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) | v8.dev/blog | New pipeline (V8 5.9) optimizes try/catch and other old "optimization killers"; old Crankshaft-era advice is obsolete. |
| 5 | 2020-10-01 | [Indicium: V8 runtime tracer tool](https://v8.dev/blog/system-analyzer) | v8.dev/blog | Indicium tool: visualizes map (shape) transitions, IC states and deopts; use to diagnose shape/IC problems. |
| 6 | 2021-02-15 | [Faster JavaScript calls](https://v8.dev/blog/adaptor-frame) | v8.dev/blog | Calling with more or fewer args than declared params no longer pays an adaptor-frame cost (V8 8.9); optional-param APIs are fine. |
| 7 | 2019-09-27 | [V8 release v7.8](https://v8.dev/blog/v8-release-78) | v8.dev/blog | Preloaded scripts now stream-compile off the main thread; object destructuring is as fast as plain property loads. |
| 8 | 2018-04-24 | [Improved code caching](https://v8.dev/blog/improved-code-caching) | v8.dev/blog | Code cache is created after top-level execution, so functions run during startup are cached too. |
| 9 | 2018-03-26 | [Background compilation](https://v8.dev/blog/background-compilation) | v8.dev/blog | Streamed scripts compile on a background thread; external async/defer scripts keep the main thread free. |
| 10 | 2018-01-29 | [Optimizing hash tables: hiding the hash code](https://v8.dev/blog/hash-code) | v8.dev/blog | Object-keyed Map/Set/WeakMap store the hash in the properties backing store; object keys with mixed shapes no longer hit megamorphic lookups. |
| 11 | 2019-07-09 | [[feature] Weak references and finalizers](https://v8.dev/features/weak-references) | v8.dev/features | WeakRef/FinalizationRegistry for memory-sensitive caches; GC timing is not predictable, so use them sparingly and never for program logic. |
| 12 | 2018-03-01 | [Tracing from JS to the DOM and back again](https://v8.dev/blog/tracing-js-dom) | v8.dev/blog | Cross-component tracing: JS-to-DOM cycles are collected and shown in heap snapshots; helps find detached-DOM leaks. |
| 13 | 2017-03-01 | [Fast for-in in V8](https://v8.dev/blog/fast-for-in) | v8.dev/blog | for-in is fast via the enum cache when the object shape is stable and the prototype chain has no enumerable properties. |
| 14 | 2018-09-28 | [Getting things sorted in V8](https://v8.dev/blog/array-sort) | v8.dev/blog | Array.prototype.sort is stable Timsort (V8 7.0); use a consistent comparator; accessors, holes and prototype tricks are slow and not optimized. |
| 15 | 2017-10-05 | [Optimizing ES2015 proxies in V8](https://v8.dev/blog/optimizing-proxies) | v8.dev/blog | Proxy construction and traps moved to CSA and got much faster, but each trap is still a call; keep Proxies out of hot paths. |
| 16 | 2019-10-04 | [Improving V8 regular expressions](https://v8.dev/blog/regexp-tier-up) | v8.dev/blog | Since Chrome 79 a regexp is interpreted first and compiled to native code once reused; keep hot regexps as reused literals/objects. |
| 17 | 2021-01-11 | [An additional non-backtracking RegExp engine](https://v8.dev/blog/non-backtracking-regexp) | v8.dev/blog | Explains catastrophic backtracking; the linear engine is flag-only (--enable-experimental-regexp-engine, l flag), so avoid nested quantifiers on untrusted input. |
| 18 | 2021-02-18 | [Super fast super property access](https://v8.dev/blog/fast-super) | v8.dev/blog | super.x now uses inline caches (V8 9.0); near normal property speed when optimized, still slower when interpreted. |
| 19 | 2018-05-02 | [Adding BigInts to V8](https://v8.dev/blog/bigint) | v8.dev/blog | BigInts are heap-allocated and were not optimized at launch (2018); keep them out of hot numeric loops. |
| 20 | 2019-10-08 | [[feature] Top-level await](https://v8.dev/features/top-level-await) | v8.dev/features | Top-level await delays evaluation of modules that import the awaiting module (siblings still run); keep it out of shared startup modules. |
| 21 | 2019-08-14 | [[feature] Subsume JSON a.k.a. JSON ⊂ ECMAScript](https://v8.dev/features/subsume-json) | v8.dev/features | Repeats the JSON.parse trick: large (10 kB+) data literals parse faster as JSON.parse('...'). |
| 22 | 2020-01-30 | [[feature] Fast, parallel applications with WebAssembly SIMD](https://v8.dev/features/simd) | v8.dev/features | Wasm SIMD (128-bit) speeds data-parallel compute; demo went from ~14 to ~38 FPS. |
| 23 | 2020-09-24 | [[feature] Atomics.wait, Atomics.notify, Atomics.waitAsync](https://v8.dev/features/atomics) | v8.dev/features | Atomics.wait blocks and throws on the main thread; Atomics.waitAsync (V8 8.7) works on the main thread for SharedArrayBuffer sync. |
| 24 | 2021-10-29 | [WebAssembly Dynamic Tiering ready to try in Chrome 96](https://v8.dev/blog/wasm-dynamic-tiering) | v8.dev/blog | Wasm starts in Liftoff and only hot functions get TurboFan; startup gets faster, peak speed arrives after warm-up. |
| 25 | 2018-08-20 | [Liftoff: a new baseline compiler for WebAssembly in V8](https://v8.dev/blog/liftoff) | v8.dev/blog | Liftoff baseline Wasm compiler: fast startup, background TurboFan tier-up; explains Wasm warm-up. |
| 26 | 2025-06-24 | [Speculative Optimizations for WebAssembly using Deopts and Inlining](https://v8.dev/blog/wasm-speculative-optimizations) | v8.dev/blog | Wasm now gets feedback-based inlining of indirect calls and deopts (Chrome 137); Wasm code also has warm-up and can deoptimize. |
| 27 | 2020-11-12 | [[feature] WebAssembly integration with JavaScript BigInt](https://v8.dev/features/wasm-bigint) | v8.dev/features | i64 crosses the JS/Wasm boundary as BigInt without "legalization"; about 18% faster in the post's microbenchmark. |
| 28 | 2020-05-14 | [Up to 4GB of memory in WebAssembly](https://v8.dev/blog/4gb-wasm-memory) | v8.dev/blog | Wasm memory up to 4 GB (emcc -s ALLOW_MEMORY_GROWTH -s MAXIMUM_MEMORY=4GB, Chrome 83+); hand-written JS glue must treat pointers as unsigned (>>> not >>). |
| 29 | 2024-07-01 | [Introducing the WebAssembly JavaScript Promise Integration API](https://v8.dev/blog/jspi) | v8.dev/blog | JSPI lets synchronous Wasm code call Promise-based Web APIs without Asyncify code bloat; shipped in Chrome/Edge 137 and Firefox 153 (webstatus.dev; check Safari, see section 7). |
| 30 | 2023-12-14 | [V8 is Faster and Safer than Ever!](https://v8.dev/blog/holiday-season-2023) | v8.dev/blog | 2023 summary: Maglev, Turboshaft, faster DOM allocation, TDZ-check elision for let/const, resizable ArrayBuffer and ArrayBuffer.transfer shipped. |
| 31 | 2023-11-01 | [A new way to bring garbage collected programming languages efficiently to WebAssembly](https://v8.dev/blog/wasm-gc-porting) | v8.dev/blog | WasmGC vs. shipping your own GC in linear memory: size, speed and memory trade-offs for GC-language ports. |
| 32 | 2019-03-25 | [Blazingly fast parsing, part 1: optimizing the scanner](https://v8.dev/blog/scanner) | v8.dev/blog | Scanner speed internals; parse cost scales with source size and non-Latin1 identifiers cost more. |

## 4. Full blog list (all 154 posts, newest first)

| # | Date | Post | Tags | Class | Reason |
|---|---|---|---|---|---|
| 1 | 2025-08-04 | [How we made JSON.stringify more than twice as fast](https://v8.dev/blog/json-stringify) | internals | high | JSON.stringify fast path (Chrome 138+): no replacer/space arg, no toJSON, no integer-like keys on objects; arrays of same-shape objects hit a faster "express lane". |
| 2 | 2025-06-24 | [Speculative Optimizations for WebAssembly using Deopts and Inlining](https://v8.dev/blog/wasm-speculative-optimizations) | WebAssembly,internals | medium | Wasm now gets feedback-based inlining of indirect calls and deopts (Chrome 137); Wasm code also has warm-up and can deoptimize. |
| 3 | 2025-04-29 | [Giving V8 a Heads-Up: Faster JavaScript Startup with Explicit Compile Hints](https://v8.dev/blog/explicit-compile-hints) | JavaScript | high | Put //# allFunctionsCalledOnLoad at the top of a small "core" startup file for eager background compile (Chrome 136+); use sparingly. |
| 4 | 2025-03-25 | [Land ahoy: leaving the Sea of Nodes](https://v8.dev/blog/leaving-the-sea-of-nodes) | JavaScript,internals | low | Turboshaft compiler IR internals; no coding change. |
| 5 | 2025-02-25 | [Turbocharging V8 with mutable heap numbers](https://v8.dev/blog/mutable-heap-number) | JavaScript,benchmarks,internals | high | Script-level mutable numeric let bindings are now updated in place without allocation when their type stays stable (Smi/Int32/double); a type change deopts. |
| 6 | 2024-07-01 | [Introducing the WebAssembly JavaScript Promise Integration API](https://v8.dev/blog/jspi) | WebAssembly | medium | JSPI lets synchronous Wasm code call Promise-based Web APIs without Asyncify code bloat; shipped in Chrome/Edge 137 and Firefox 153 (webstatus.dev; check Safari, see section 7). |
| 7 | 2024-06-04 | [WebAssembly JSPI has a new API](https://v8.dev/blog/jspi-newapi) | WebAssembly | low | Interim JSPI API change; superseded by the "Introducing JSPI" post. |
| 8 | 2024-04-04 | [The V8 Sandbox](https://v8.dev/blog/sandbox) | security | low | Security architecture (heap sandbox); no coding change. |
| 9 | 2024-03-06 | [WebAssembly JSPI is going to origin trial](https://v8.dev/blog/jspi-ot) | WebAssembly | low | JSPI origin-trial announcement; superseded. |
| 10 | 2024-02-05 | [Static Roots: Objects with Compile-Time Constant Addresses](https://v8.dev/blog/static-roots) | JavaScript | low | Read-only heap addressing internals. |
| 11 | 2023-12-14 | [V8 is Faster and Safer than Ever!](https://v8.dev/blog/holiday-season-2023) | JavaScript,WebAssembly,security,benchmarks | medium | 2023 summary: Maglev, Turboshaft, faster DOM allocation, TDZ-check elision for let/const, resizable ArrayBuffer and ArrayBuffer.transfer shipped. |
| 12 | 2023-12-05 | [Maglev - V8’s Fastest Optimizing JIT](https://v8.dev/blog/maglev) | JavaScript | medium | Explains the 4 tiers (Ignition, Sparkplug, Maglev, TurboFan), feedback and deopts; informs warm-up and how to benchmark. |
| 13 | 2023-11-01 | [A new way to bring garbage collected programming languages efficiently to WebAssembly](https://v8.dev/blog/wasm-gc-porting) | WebAssembly | medium | WasmGC vs. shipping your own GC in linear memory: size, speed and memory trade-offs for GC-language ports. |
| 14 | 2023-10-09 | [Control-flow Integrity in V8](https://v8.dev/blog/control-flow-integrity) | security | low | Security hardening internals. |
| 15 | 2023-07-27 | [Speeding up V8 heap snapshots](https://v8.dev/blog/speeding-up-v8-heap-snapshots) | memory,tools | low | Heap snapshot tool got faster; tooling only. |
| 16 | 2023-04-06 | [WebAssembly tail calls](https://v8.dev/blog/wasm-tail-call) | WebAssembly | low | Wasm tail calls for functional-language toolchains; niche for C++/Rust chart code. |
| 17 | 2022-11-28 | [Pointer compression in Oilpan](https://v8.dev/blog/oilpan-pointer-compression) | internals,memory,cppgc | low | Blink C++ GC internals. |
| 18 | 2022-06-17 | [Discontinuing release blog posts](https://v8.dev/blog/discontinuing-release-posts) | release | low | Meta: release posts stopped; features move to explainers and Chrome release notes. |
| 19 | 2022-06-14 | [Retrofitting temporal memory safety on C++](https://v8.dev/blog/retrofitting-temporal-memory-safety-on-c++) | internals,memory,security | low | C++ memory-safety internals. |
| 20 | 2022-04-20 | [Faster initialization of instances with new class features](https://v8.dev/blog/faster-class-features) | internals | high | Class field initializers and private methods now use inline caches (V8 9.7+); declare fields as class fields without a speed penalty. |
| 21 | 2022-01-31 | [V8 release v9.9](https://v8.dev/blog/v8-release-99) | release | low | Release notes: Intl.Locale extensions, Intl enumeration. |
| 22 | 2021-11-10 | [Oilpan library](https://v8.dev/blog/oilpan-library) | internals,memory,cppgc | low | C++ GC library for embedders. |
| 23 | 2021-11-05 | [V8 release v9.7](https://v8.dev/blog/v8-release-97) | release | low | Release notes: findLast/findLastIndex. |
| 24 | 2021-10-29 | [WebAssembly Dynamic Tiering ready to try in Chrome 96](https://v8.dev/blog/wasm-dynamic-tiering) | WebAssembly | medium | Wasm starts in Liftoff and only hot functions get TurboFan; startup gets faster, peak speed arrives after warm-up. |
| 25 | 2021-10-13 | [V8 release v9.6](https://v8.dev/blog/v8-release-96) | release | low | Release notes: Wasm reference types. |
| 26 | 2021-09-21 | [V8 release v9.5](https://v8.dev/blog/v8-release-95) | release | low | Release notes: Intl.DisplayNames v2, Wasm exception handling. |
| 27 | 2021-09-06 | [V8 release v9.4](https://v8.dev/blog/v8-release-94) | release | low | Release notes: class static blocks. |
| 28 | 2021-08-09 | [V8 release v9.3](https://v8.dev/blog/v8-release-93) | release | low | Release notes: Sparkplug batch compilation, Object.hasOwn, error cause. |
| 29 | 2021-07-16 | [V8 release v9.2](https://v8.dev/blog/v8-release-92) | release | low | Release notes: at(), shared pointer-compression cage. |
| 30 | 2021-05-27 | [Sparkplug — a non-optimizing JavaScript compiler](https://v8.dev/blog/sparkplug) | JavaScript | low | Baseline (non-optimizing) compiler internals; no coding change. |
| 31 | 2021-05-06 | [Short builtin calls](https://v8.dev/blog/short-builtin-calls) | JavaScript | low | Builtin call placement internals. |
| 32 | 2021-05-04 | [V8 release v9.1](https://v8.dev/blog/v8-release-91) | release | low | Release notes: FastTemplateCache (embedder), TLA, #x in obj. |
| 33 | 2021-03-17 | [V8 release v9.0](https://v8.dev/blog/v8-release-90) | release | low | Release notes: RegExp match indices, faster super, faster JS-to-Wasm calls. |
| 34 | 2021-03-04 | [Faster releases](https://v8.dev/blog/faster-releases) | - | low | Release cadence announcement. |
| 35 | 2021-02-18 | [Super fast super property access](https://v8.dev/blog/fast-super) | JavaScript | medium | super.x now uses inline caches (V8 9.0); near normal property speed when optimized, still slower when interpreted. |
| 36 | 2021-02-15 | [Faster JavaScript calls](https://v8.dev/blog/adaptor-frame) | internals | medium | Calling with more or fewer args than declared params no longer pays an adaptor-frame cost (V8 8.9); optional-param APIs are fine. |
| 37 | 2021-02-04 | [V8 release v8.9](https://v8.dev/blog/v8-release-89) | release | low | Release notes: TLA, faster args-mismatch calls (see adaptor-frame post). |
| 38 | 2021-01-11 | [An additional non-backtracking RegExp engine](https://v8.dev/blog/non-backtracking-regexp) | internals,RegExp | medium | Explains catastrophic backtracking; the linear engine is flag-only (--enable-experimental-regexp-engine, l flag), so avoid nested quantifiers on untrusted input. |
| 39 | 2020-10-23 | [V8 release v8.7](https://v8.dev/blog/v8-release-87) | release | low | Release notes: Atomics.waitAsync, embedder fast API calls. |
| 40 | 2020-10-01 | [Indicium: V8 runtime tracer tool](https://v8.dev/blog/system-analyzer) | tools,system-analyzer | medium | Indicium tool: visualizes map (shape) transitions, IC states and deopts; use to diagnose shape/IC problems. |
| 41 | 2020-09-24 | [Slack tracking in V8](https://v8.dev/blog/slack-tracking) | internals | high | V8 sizes in-object property space from the first constructions; add all properties in the constructor so they stay in-object and on one shape family. |
| 42 | 2020-09-21 | [V8 release v8.6](https://v8.dev/blog/v8-release-86) | release | low | Release notes: faster Number.prototype.toString, Wasm SIMD on Liftoff. |
| 43 | 2020-07-21 | [V8 release v8.5](https://v8.dev/blog/v8-release-85) | release | low | Release notes: Promise.any, replaceAll, logical assignment. |
| 44 | 2020-06-30 | [V8 release v8.4](https://v8.dev/blog/v8-release-84) | release | low | Release notes: WeakRefs, private methods, Wasm startup. |
| 45 | 2020-05-26 | [High-performance garbage collection for C++](https://v8.dev/blog/high-performance-cpp-gc) | internals,memory,cppgc | low | Oilpan C++ GC sweeping internals. |
| 46 | 2020-05-19 | [Understanding the ECMAScript spec, part 4](https://v8.dev/blog/understanding-ecmascript-part-4) | ECMAScript,Understanding ECMAScript | none | Spec-reading tutorial; no performance content. |
| 47 | 2020-05-14 | [Up to 4GB of memory in WebAssembly](https://v8.dev/blog/4gb-wasm-memory) | WebAssembly,JavaScript,tooling | medium | Wasm memory up to 4 GB (emcc -s ALLOW_MEMORY_GROWTH -s MAXIMUM_MEMORY=4GB, Chrome 83+); hand-written JS glue must treat pointers as unsigned (>>> not >>). |
| 48 | 2020-05-04 | [V8 release v8.3](https://v8.dev/blog/v8-release-83) | release | low | Release notes: faster ArrayBuffer tracking in GC. |
| 49 | 2020-04-27 | [What’s in that .wasm? Introducing: wasm-decompile](https://v8.dev/blog/wasm-decompile) | WebAssembly,tooling | low | Wasm inspection tool. |
| 50 | 2020-04-01 | [Understanding the ECMAScript spec, part 3](https://v8.dev/blog/understanding-ecmascript-part-3) | ECMAScript,Understanding ECMAScript | none | Spec-reading tutorial. |
| 51 | 2020-03-30 | [Pointer Compression in V8](https://v8.dev/blog/pointer-compression) | internals,memory | high | Heap slots are 32-bit, Smis are 31-bit, double fields are boxed; for number-crunching arrays store data in Float64Array (or Wasm) instead of object fields. |
| 52 | 2020-03-02 | [Understanding the ECMAScript spec, part 2](https://v8.dev/blog/understanding-ecmascript-part-2) | ECMAScript,Understanding ECMAScript | none | Spec-reading tutorial. |
| 53 | 2020-02-25 | [V8 release v8.1](https://v8.dev/blog/v8-release-81) | release | low | Release notes: Intl.DisplayNames. |
| 54 | 2020-02-03 | [Understanding the ECMAScript spec, part 1](https://v8.dev/blog/understanding-ecmascript-part-1) | ECMAScript,Understanding ECMAScript | none | Spec-reading tutorial. |
| 55 | 2019-12-18 | [V8 release v8.0](https://v8.dev/blog/v8-release-80) | release | low | Release notes: pointer compression, inlining through Function.prototype.apply/Reflect.apply/array HOFs. |
| 56 | 2019-11-21 | [Outside the web: standalone WebAssembly binaries using Emscripten](https://v8.dev/blog/emscripten-standalone-wasm) | WebAssembly,tooling | low | Standalone (WASI) Wasm builds outside the web. |
| 57 | 2019-11-20 | [V8 release v7.9](https://v8.dev/blog/v8-release-79) | release | low | Release notes: no shape deprecation for Double to Tagged field change, OSR caching. |
| 58 | 2019-10-04 | [Improving V8 regular expressions](https://v8.dev/blog/regexp-tier-up) | internals,RegExp | medium | Since Chrome 79 a regexp is interpreted first and compiled to native code once reused; keep hot regexps as reused literals/objects. |
| 59 | 2019-09-27 | [V8 release v7.8](https://v8.dev/blog/v8-release-78) | release | medium | Preloaded scripts now stream-compile off the main thread; object destructuring is as fast as plain property loads. |
| 60 | 2019-09-12 | [A lighter V8](https://v8.dev/blog/v8-lite) | internals,memory,presentations | low | Lazy feedback allocation and bytecode flushing (memory); no coding change. |
| 61 | 2019-08-28 | [The story of a V8 performance cliff in React](https://v8.dev/blog/react-cliff) | internals,presentations | high | Field representations (Smi, Double, HeapObject, Tagged), shape deprecation, and a freeze/preventExtensions cliff; init fields the same way, never null for numbers (NaN for empty doubles). |
| 62 | 2019-08-13 | [V8 release v7.7](https://v8.dev/blog/v8-release-77) | release | low | Release notes: lazy feedback allocation. |
| 63 | 2019-07-01 | [Emscripten and the LLVM WebAssembly backend](https://v8.dev/blog/emscripten-llvm-wasm) | WebAssembly,tooling | low | Emscripten switch to the upstream LLVM Wasm backend. |
| 64 | 2019-06-25 | [The cost of JavaScript in 2019](https://v8.dev/blog/cost-of-javascript-2019) | internals,parsing | high | Download and execution dominate; split bundles >50-100 kB, avoid inline scripts >1 kB, JSON.parse for large (>=10 kB) data literals. |
| 65 | 2019-06-19 | [V8 release v7.6](https://v8.dev/blog/v8-release-76) | release | medium | JSON.parse became up to 2.7x faster and iterative; frozen/sealed arrays became fast for indexOf/includes/spread. |
| 66 | 2019-06-17 | [Code caching for WebAssembly developers](https://v8.dev/blog/wasm-code-caching) | WebAssembly,internals | high | Use instantiateStreaming with application/wasm, keep URL and bytes stable (304), cache threshold 128 kB (2019), compile in a worker/service worker. |
| 67 | 2019-05-16 | [V8 release v7.5](https://v8.dev/blog/v8-release-75) | release | low | Release notes: script streaming from network, implicit Wasm caching. |
| 68 | 2019-04-25 | [Faster and more feature-rich internationalization APIs](https://v8.dev/blog/intl) | ECMAScript,Intl | high | Create and reuse Intl.NumberFormat/DateTimeFormat/Collator objects instead of toLocaleString/localeCompare per call. |
| 69 | 2019-04-23 | [A year with Spectre: a V8 perspective](https://v8.dev/blog/spectre) | security | low | Spectre mitigations and site isolation; explains coarse timers, no coding change. |
| 70 | 2019-04-15 | [Blazingly fast parsing, part 2: lazy parsing](https://v8.dev/blog/preparser) | internals,parsing | high | Lazy parsing and PIFE heuristic: parenthesized functions compile eagerly; put large object literals at top level or in a PIFE to avoid double parsing. |
| 71 | 2019-04-08 | [Code caching for JavaScript developers](https://v8.dev/blog/code-caching-for-devs) | internals | high | Keep code and URLs stable, deterministic startup, no inline scripts, files >=1 KiB, precache scripts in the service worker install step for a full code cache. |
| 72 | 2019-03-25 | [Blazingly fast parsing, part 1: optimizing the scanner](https://v8.dev/blog/scanner) | internals,parsing | medium | Scanner speed internals; parse cost scales with source size and non-Latin1 identifiers cost more. |
| 73 | 2019-03-22 | [V8 release v7.4](https://v8.dev/blog/v8-release-74) | release | low | Release notes: JIT-less mode, faster args-mismatch calls, bytecode flushing. |
| 74 | 2019-03-13 | [JIT-less V8](https://v8.dev/blog/jitless) | internals | low | JIT-less mode for locked-down platforms; not for normal web pages. |
| 75 | 2019-02-07 | [V8 release v7.3](https://v8.dev/blog/v8-release-73) | release | low | Release notes: async stack traces, faster await. |
| 76 | 2019-01-03 | [Trash talk: the Orinoco garbage collector](https://v8.dev/blog/trash-talk) | internals,memory,presentations | high | Generational GC: short-lived objects are cheap, survivors cost; parallel/concurrent/idle-time GC; explains GC pauses in animation. |
| 77 | 2018-12-18 | [V8 release v7.2](https://v8.dev/blog/v8-release-72) | release | low | Release notes: faster parsing, async/await, spread (covered by dedicated posts). |
| 78 | 2018-12-04 | [Speeding up spread elements](https://v8.dev/blog/spread-elements) | ECMAScript,benchmarks | high | [...x] and Array.from(x) take fast paths for arrays, strings, Sets and Maps when the spread is first and iterators are unmodified; holey double arrays need an elements-kind conversion. |
| 79 | 2018-11-12 | [Faster async functions and promises](https://v8.dev/blog/fast-async) | ECMAScript,benchmarks,presentations | high | Native async/await is now faster than hand-written promise chains; await on a native promise costs 1 microtick; do not transpile or polyfill promises. |
| 80 | 2018-10-31 | [V8 release v7.1](https://v8.dev/blog/v8-release-71) | release | low | Release notes: embedded builtins memory, structured clone of Wasm modules. |
| 81 | 2018-10-15 | [V8 release v7.0](https://v8.dev/blog/v8-release-70) | release | low | Release notes: Wasm threads preview. |
| 82 | 2018-09-28 | [Getting things sorted in V8](https://v8.dev/blog/array-sort) | ECMAScript,internals | medium | Array.prototype.sort is stable Timsort (V8 7.0); use a consistent comparator; accessors, holes and prototype tricks are slow and not optimized. |
| 83 | 2018-09-18 | [Improving DataView performance in V8](https://v8.dev/blog/dataview) | ECMAScript,benchmarks | high | DataView is as fast as TypedArray since V8 6.9; use it for mixed-type/endian binary protocol parsing without a speed penalty. |
| 84 | 2018-09-11 | [Celebrating 10 years of V8](https://v8.dev/blog/10-years) | benchmarks | low | History retrospective. |
| 85 | 2018-08-20 | [Liftoff: a new baseline compiler for WebAssembly in V8](https://v8.dev/blog/liftoff) | WebAssembly,internals | medium | Liftoff baseline Wasm compiler: fast startup, background TurboFan tier-up; explains Wasm warm-up. |
| 86 | 2018-08-14 | [Embedded builtins](https://v8.dev/blog/embedded-builtins) | internals | low | Builtins memory internals. |
| 87 | 2018-08-07 | [V8 release v6.9](https://v8.dev/blog/v8-release-69) | release | low | Release notes: Liftoff, faster DataView and WeakMap GC. |
| 88 | 2018-06-21 | [V8 release v6.8](https://v8.dev/blog/v8-release-68) | release | low | Release notes: faster array destructuring, Object.assign, TypedArray sort. |
| 89 | 2018-06-11 | [Concurrent marking in V8](https://v8.dev/blog/concurrent-marking) | internals,memory | low | GC marking on background threads; no coding change. |
| 90 | 2018-05-04 | [V8 release v6.7](https://v8.dev/blog/v8-release-67) | release | low | Release notes: BigInt, untrusted code mitigations. |
| 91 | 2018-05-02 | [Adding BigInts to V8](https://v8.dev/blog/bigint) | ECMAScript | medium | BigInts are heap-allocated and were not optimized at launch (2018); keep them out of hot numeric loops. |
| 92 | 2018-04-24 | [Improved code caching](https://v8.dev/blog/improved-code-caching) | internals | medium | Code cache is created after top-level execution, so functions run during startup are cached too. |
| 93 | 2018-03-27 | [V8 release v6.6](https://v8.dev/blog/v8-release-66) | release | low | Release notes: code caching after execution, background compilation. |
| 94 | 2018-03-26 | [Background compilation](https://v8.dev/blog/background-compilation) | internals | medium | Streamed scripts compile on a background thread; external async/defer scripts keep the main thread free. |
| 95 | 2018-03-01 | [Tracing from JS to the DOM and back again](https://v8.dev/blog/tracing-js-dom) | internals,memory | medium | Cross-component tracing: JS-to-DOM cycles are collected and shown in heap snapshots; helps find detached-DOM leaks. |
| 96 | 2018-02-12 | [Lazy deserialization](https://v8.dev/blog/lazy-deserialization) | internals | low | Snapshot deserialization internals. |
| 97 | 2018-02-01 | [V8 release v6.5](https://v8.dev/blog/v8-release-65) | release | low | Release notes: Wasm streaming compilation, untrusted code mode. |
| 98 | 2018-01-29 | [Optimizing hash tables: hiding the hash code](https://v8.dev/blog/hash-code) | internals | medium | Object-keyed Map/Set/WeakMap store the hash in the properties backing store; object keys with mixed shapes no longer hit megamorphic lookups. |
| 99 | 2018-01-24 | [Chrome welcomes Speedometer 2.0!](https://v8.dev/blog/speedometer-2) | benchmarks | low | Benchmark announcement. |
| 100 | 2017-12-19 | [V8 release v6.4](https://v8.dev/blog/v8-release-64) | release | low | Release notes: speed and memory items. |
| 101 | 2017-12-13 | [JavaScript code coverage](https://v8.dev/blog/javascript-code-coverage) | internals | low | How V8 collects coverage for DevTools; tooling only. |
| 102 | 2017-11-29 | [Orinoco: young generation garbage collection](https://v8.dev/blog/orinoco-parallel-scavenger) | internals,memory | low | Parallel young-generation GC internals (covered by Trash talk). |
| 103 | 2017-11-16 | [Taming architecture complexity in V8 — the CodeStubAssembler](https://v8.dev/blog/csa) | internals | low | CodeStubAssembler internals. |
| 104 | 2017-11-06 | [Announcing the Web Tooling Benchmark](https://v8.dev/blog/web-tooling-benchmark) | benchmarks,Node.js | low | Benchmark announcement. |
| 105 | 2017-10-25 | [V8 release v6.3](https://v8.dev/blog/v8-release-63) | release | low | Release notes: speed and memory items. |
| 106 | 2017-10-05 | [Optimizing ES2015 proxies in V8](https://v8.dev/blog/optimizing-proxies) | ECMAScript,benchmarks,internals | medium | Proxy construction and traps moved to CSA and got much faster, but each trap is still a call; keep Proxies out of hot paths. |
| 107 | 2017-10-04 | [An internship on laziness: lazy unlinking of deoptimized functions](https://v8.dev/blog/lazy-unlinking) | memory,internals | low | Deopt bookkeeping internals. |
| 108 | 2017-09-22 | [Temporarily disabling escape analysis](https://v8.dev/blog/disabling-escape-analysis) | security | low | Security fix note. |
| 109 | 2017-09-12 | [Elements kinds in V8](https://v8.dev/blog/elements-kinds) | internals,presentations | high | Keep arrays packed and single-type (SMI, DOUBLE, ELEMENTS); do not read past length, create holes, or mix kinds; prefer real arrays over array-likes. |
| 110 | 2017-09-11 | [V8 release v6.2](https://v8.dev/blog/v8-release-62) | release | low | Release notes: speed items, low-memory mode. |
| 111 | 2017-08-30 | [Fast properties in V8](https://v8.dev/blog/fast-properties) | internals | high | Hidden classes; in-object vs. fast vs. slow (dictionary) properties; adding and deleting many properties moves an object to slow dictionary properties. |
| 112 | 2017-08-11 | [About that hash flooding vulnerability in Node.js…](https://v8.dev/blog/hash-flooding) | security | low | Node.js security fix. |
| 113 | 2017-08-03 | [V8 release v6.1](https://v8.dev/blog/v8-release-61) | release | low | Release notes: asm.js to Wasm, binary size. |
| 114 | 2017-06-09 | [V8 release v6.0](https://v8.dev/blog/v8-release-60) | release | low | Release notes: SharedArrayBuffer, object rest/spread. |
| 115 | 2017-05-15 | [Launching Ignition and TurboFan](https://v8.dev/blog/launching-ignition-and-turbofan) | internals | medium | New pipeline (V8 5.9) optimizes try/catch and other old "optimization killers"; old Crankshaft-era advice is obsolete. |
| 116 | 2017-04-27 | [V8 release v5.9](https://v8.dev/blog/v8-release-59) | release | low | Release notes: Ignition+TurboFan launch. |
| 117 | 2017-04-12 | [Retiring Octane](https://v8.dev/blog/retiring-octane) | benchmarks | low | Benchmark philosophy: micro-benchmarks mislead; measure real workloads. |
| 118 | 2017-03-20 | [V8 release v5.8](https://v8.dev/blog/v8-release-58) | release | low | Release notes: heap size, startup. |
| 119 | 2017-03-01 | [Fast for-in in V8](https://v8.dev/blog/fast-for-in) | internals | medium | for-in is fast via the enum cache when the object shape is stable and the prototype chain has no enumerable properties. |
| 120 | 2017-02-17 | [High-performance ES2015 and beyond](https://v8.dev/blog/high-performance-es2015) | ECMAScript | medium | Native ES2015+ features reached ES5 speed; transpiling to ES5 bloats code (650% for async generators), so ship modern syntax. |
| 121 | 2017-02-14 | [Help us test the future of V8!](https://v8.dev/blog/test-the-future) | internals | low | Call for testers (2017). |
| 122 | 2017-02-09 | [One small step for Chrome, one giant heap for V8](https://v8.dev/blog/heap-size-limit) | memory | low | Heap limit change in Chrome. |
| 123 | 2017-02-06 | [V8 release v5.7](https://v8.dev/blog/v8-release-57) | release | low | Release notes: native async functions, faster RegExp. |
| 124 | 2017-01-10 | [Speeding up V8 regular expressions](https://v8.dev/blog/speeding-up-regular-expressions) | internals,RegExp | high | Do not modify RegExp instances or RegExp.prototype and avoid RegExp subclasses; they force the slow path. |
| 125 | 2016-12-21 | [How V8 measures real-world performance](https://v8.dev/blog/real-world-performance) | benchmarks | low | How V8 measures real sites (RCS, WebPageReplay). |
| 126 | 2016-12-15 | [V8 ❤️ Node.js](https://v8.dev/blog/v8-nodejs) | Node.js | low | Node.js news (2016). |
| 127 | 2016-12-02 | [V8 release v5.6](https://v8.dev/blog/v8-release-56) | release | low | Release notes (2016). |
| 128 | 2016-10-31 | [WebAssembly browser preview](https://v8.dev/blog/webassembly-browser-preview) | WebAssembly | low | Wasm preview announcement (2016). |
| 129 | 2016-10-24 | [V8 release v5.5](https://v8.dev/blog/v8-release-55) | release | low | Release notes (2016). |
| 130 | 2016-10-07 | [Optimizing V8 memory consumption](https://v8.dev/blog/optimizing-v8-memory) | memory,benchmarks | low | Heap and zone memory reductions (2016). |
| 131 | 2016-09-09 | [V8 release v5.4](https://v8.dev/blog/v8-release-54) | release | low | Release notes (2016). |
| 132 | 2016-08-23 | [Firing up the Ignition interpreter](https://v8.dev/blog/ignition-interpreter) | internals | low | Interpreter introduction (2016). |
| 133 | 2016-07-21 | [V8 at the BlinkOn 6 conference](https://v8.dev/blog/blinkon-6) | presentations | low | Conference talk list. |
| 134 | 2016-07-18 | [V8 release v5.3](https://v8.dev/blog/v8-release-53) | release | low | Release notes (2016). |
| 135 | 2016-06-04 | [V8 release v5.2](https://v8.dev/blog/v8-release-52) | release | low | Release notes (2016). |
| 136 | 2016-04-29 | [ES2015, ES2016, and beyond](https://v8.dev/blog/modern-javascript) | ECMAScript | low | ES2015/ES2016 status (2016). |
| 137 | 2016-04-23 | [V8 release v5.1](https://v8.dev/blog/v8-release-51) | release | low | Release notes (2016). |
| 138 | 2016-04-12 | [Jank Busters Part Two: Orinoco](https://v8.dev/blog/orinoco) | internals,memory | low | Early parallel GC work (2016). |
| 139 | 2016-03-15 | [V8 release v5.0](https://v8.dev/blog/v8-release-50) | release | low | Release notes (2016). |
| 140 | 2016-03-15 | [Experimental support for WebAssembly in V8](https://v8.dev/blog/webassembly-experimental) | WebAssembly | low | Experimental Wasm (2016). |
| 141 | 2016-02-26 | [RegExp lookbehind assertions](https://v8.dev/blog/regexp-lookbehind-assertions) | ECMAScript,RegExp | low | Feature explainer; no performance content. |
| 142 | 2016-02-04 | [V8 extras](https://v8.dev/blog/v8-extras) | internals | low | Embedder self-hosting API. |
| 143 | 2016-01-26 | [V8 release v4.9](https://v8.dev/blog/v8-release-49) | release | low | Release notes (2016). |
| 144 | 2015-12-17 | [There’s Math.random(), and then there’s Math.random()](https://v8.dev/blog/math-random) | ECMAScript,internals | low | Math.random uses xorshift128+ (not cryptographic); use crypto.getRandomValues for security. |
| 145 | 2015-11-25 | [V8 release v4.8](https://v8.dev/blog/v8-release-48) | release | low | Release notes (2015). |
| 146 | 2015-10-30 | [Jank Busters Part One](https://v8.dev/blog/jank-busters) | memory | low | Early GC jank work (2015). |
| 147 | 2015-10-14 | [V8 release v4.7](https://v8.dev/blog/v8-release-47) | release | low | Release notes (2015). |
| 148 | 2015-09-25 | [Custom startup snapshots](https://v8.dev/blog/custom-startup-snapshots) | internals | low | Embedder snapshots. |
| 149 | 2015-08-28 | [V8 release v4.6](https://v8.dev/blog/v8-release-46) | release | low | Release notes (2015). |
| 150 | 2015-08-07 | [Getting garbage collection for free](https://v8.dev/blog/free-garbage-collection) | internals,memory | low | Idle-time GC scheduling (2015); informs that frame idle time helps GC. |
| 151 | 2015-07-27 | [Code caching](https://v8.dev/blog/code-caching) | internals | low | First code cache (2015); superseded by later code-caching posts. |
| 152 | 2015-07-17 | [V8 release v4.5](https://v8.dev/blog/v8-release-45) | release | low | Release notes (2015). |
| 153 | 2015-07-13 | [Digging into the TurboFan JIT](https://v8.dev/blog/turbofan-jit) | internals | low | TurboFan introduction (2015). |
| 154 | 2015-07-10 | [Hello, world!](https://v8.dev/blog/hello-world) | - | none | Blog launch post. |

## 5. External posts added on request

| Date | Post | Class | Reason |
|---|---|---|---|
| 2018-06-14 | [JavaScript engine fundamentals: Shapes and Inline Caches](https://mathiasbynens.be/notes/shapes-ics) | high | Shapes (hidden classes) and inline caches: initialize objects the same way (same keys, same order); do not change property attributes of array elements. |
| 2018-08-16 | [JavaScript engine fundamentals: optimizing prototypes](https://mathiasbynens.be/notes/prototypes) | high | Prototype loads are cached through ValidityCells; changing a prototype invalidates them, so do not mutate prototypes after startup. |
| 2019-06-25 | [The cost of JavaScript in 2019](https://v8.dev/blog/cost-of-javascript-2019) | high | Already in the blog list (row 64). |

## 6. v8.dev/features (46 items), runtime-performance view only

| Date | Feature | Class | Reason |
|---|---|---|---|
| 2025-05-09 | [JavaScript's New Superpower: Explicit Resource Management](https://v8.dev/features/explicit-resource-management) | low | using / Symbol.dispose for deterministic cleanup of resources (not a speed feature); Safari has no support. |
| 2024-03-27 | [Iterator helpers](https://v8.dev/features/iterator-helpers) | low | Lazy iterator map/filter/take avoid intermediate arrays, but the explainer makes no performance claim; its support table is stale. |
| 2024-01-31 | [Import attributes](https://v8.dev/features/import-attributes) | none | Language/API feature explainer with no runtime-performance content. |
| 2022-06-27 | [RegExp v flag with set notation and properties of strings](https://v8.dev/features/regexp-v-flag) | none | Language/API feature explainer with no runtime-performance content. |
| 2021-10-27 | [Finding elements in Arrays and TypedArrays](https://v8.dev/features/finding-in-arrays) | none | Language/API feature explainer with no runtime-performance content. |
| 2021-07-13 | [at method for relative indexing](https://v8.dev/features/at-method) | none | Language/API feature explainer with no runtime-performance content. |
| 2021-07-07 | [Error causes](https://v8.dev/features/error-cause) | none | Language/API feature explainer with no runtime-performance content. |
| 2021-07-01 | [Object.hasOwn](https://v8.dev/features/object-has-own) | none | Language/API feature explainer with no runtime-performance content. |
| 2021-06-15 | [Import assertions](https://v8.dev/features/import-assertions) | none | Language/API feature explainer with no runtime-performance content. |
| 2021-04-14 | [Private brand checks a.k.a. #foo in obj](https://v8.dev/features/private-brand-checks) | none | Language/API feature explainer with no runtime-performance content. |
| 2021-03-30 | [Class static initialization blocks](https://v8.dev/features/class-static-initializer-blocks) | none | Language/API feature explainer with no runtime-performance content. |
| 2020-11-12 | [WebAssembly integration with JavaScript BigInt](https://v8.dev/features/wasm-bigint) | medium | i64 crosses the JS/Wasm boundary as BigInt without "legalization"; about 18% faster in the post's microbenchmark. |
| 2020-09-24 | [Atomics.wait, Atomics.notify, Atomics.waitAsync](https://v8.dev/features/atomics) | medium | Atomics.wait blocks and throws on the main thread; Atomics.waitAsync (V8 8.7) works on the main thread for SharedArrayBuffer sync. |
| 2020-05-07 | [Logical assignment](https://v8.dev/features/logical-assignment) | none | Language/API feature explainer with no runtime-performance content. |
| 2020-02-13 | [Intl.DisplayNames](https://v8.dev/features/intl-displaynames) | low | Native display names remove locale data from bundles. |
| 2020-01-30 | [Fast, parallel applications with WebAssembly SIMD](https://v8.dev/features/simd) | medium | Wasm SIMD (128-bit) speeds data-parallel compute; demo went from ~14 to ~38 FPS. |
| 2019-12-17 | [RegExp match indices](https://v8.dev/features/regexp-match-indices) | none | Language/API feature explainer with no runtime-performance content. |
| 2019-11-11 | [String.prototype.replaceAll](https://v8.dev/features/string-replaceall) | none | Language/API feature explainer with no runtime-performance content. |
| 2019-10-08 | [Top-level await](https://v8.dev/features/top-level-await) | medium | Top-level await delays evaluation of modules that import the awaiting module (siblings still run); keep it out of shared startup modules. |
| 2019-09-17 | [Nullish coalescing](https://v8.dev/features/nullish-coalescing) | none | Language/API feature explainer with no runtime-performance content. |
| 2019-08-27 | [Optional chaining](https://v8.dev/features/optional-chaining) | none | Language/API feature explainer with no runtime-performance content. |
| 2019-08-14 | [Subsume JSON a.k.a. JSON ⊂ ECMAScript](https://v8.dev/features/subsume-json) | medium | Repeats the JSON.parse trick: large (10 kB+) data literals parse faster as JSON.parse('...'). |
| 2019-08-08 | [Intl.NumberFormat](https://v8.dev/features/intl-numberformat) | low | Native Intl.NumberFormat features (units, compact, notation) replace formatting libraries; reuse rule is in the "intl" blog post. |
| 2019-07-16 | [globalThis](https://v8.dev/features/globalthis) | none | Language/API feature explainer with no runtime-performance content. |
| 2019-07-09 | [Weak references and finalizers](https://v8.dev/features/weak-references) | medium | WeakRef/FinalizationRegistry for memory-sensitive caches; GC timing is not predictable, so use them sparingly and never for program logic. |
| 2019-07-02 | [Stable Array.prototype.sort](https://v8.dev/features/stable-sort) | low | Array.prototype.sort is stable; the performance story is in the "array-sort" blog post. |
| 2019-06-25 | [Symbol.prototype.description](https://v8.dev/features/symbol-description) | none | Language/API feature explainer with no runtime-performance content. |
| 2019-06-18 | [Object.fromEntries](https://v8.dev/features/object-fromentries) | none | Language/API feature explainer with no runtime-performance content. |
| 2019-06-12 | [Promise combinators](https://v8.dev/features/promise-combinators) | none | Language/API feature explainer with no runtime-performance content. |
| 2019-06-11 | [Array.prototype.flat and Array.prototype.flatMap](https://v8.dev/features/array-flat-flatmap) | none | Language/API feature explainer with no runtime-performance content. |
| 2019-05-28 | [Numeric separators](https://v8.dev/features/numeric-separators) | none | Language/API feature explainer with no runtime-performance content. |
| 2019-02-02 | [String.prototype.matchAll](https://v8.dev/features/string-matchall) | none | Language/API feature explainer with no runtime-performance content. |
| 2018-12-18 | [Intl.ListFormat](https://v8.dev/features/intl-listformat) | low | Native list formatting removes CLDR data from bundles. |
| 2018-12-18 | [Module namespace exports](https://v8.dev/features/module-namespace-exports) | none | Language/API feature explainer with no runtime-performance content. |
| 2018-12-13 | [Public and private class fields](https://v8.dev/features/class-fields) | low | Syntax explainer; the performance story is in the "faster-class-features" blog post. |
| 2018-10-22 | [Intl.RelativeTimeFormat](https://v8.dev/features/intl-relativetimeformat) | low | Native relative-time formatting removes CLDR data from bundles. |
| 2018-09-11 | [Well-formed JSON.stringify](https://v8.dev/features/well-formed-json-stringify) | none | Language/API feature explainer with no runtime-performance content. |
| 2018-06-18 | [JavaScript modules](https://v8.dev/features/modules) | high | Performance section: keep bundling for large module graphs (~300 modules loaded slower unbundled), use fine-grained modules, <link rel="modulepreload">, code splitting. Advice dates from 2018. |
| 2018-05-01 | [BigInt: arbitrary-precision integers in JavaScript](https://v8.dev/features/bigint) | low | Native BigInt replaces userland big-number libraries (less code, faster); perf details are in the "Adding BigInts" blog post. |
| 2018-03-27 | [Optional catch binding](https://v8.dev/features/optional-catch-binding) | none | Language/API feature explainer with no runtime-performance content. |
| 2018-03-26 | [String.prototype.trimStart and String.prototype.trimEnd](https://v8.dev/features/string-trimming) | none | Language/API feature explainer with no runtime-performance content. |
| 2018-03-25 | [Revised Function.prototype.toString](https://v8.dev/features/function-tostring) | none | Language/API feature explainer with no runtime-performance content. |
| 2017-11-21 | [Dynamic import()](https://v8.dev/features/dynamic-import) | high | import() defers download, parse and compile of code until the user needs it (lazy routes, dialogs, rare tools). |
| 2017-10-23 | [Promise.prototype.finally](https://v8.dev/features/promise-finally) | none | Language/API feature explainer with no runtime-performance content. |
| 2017-10-04 | [Intl.PluralRules](https://v8.dev/features/intl-pluralrules) | low | Native plural rules remove locale data from bundles. |
| 2017-06-06 | [Object rest and spread properties](https://v8.dev/features/object-rest-spread) | none | Language/API feature explainer with no runtime-performance content. |
## 7. Freshness checks (done 2026-09-22)

| Claim in a post | Status today | Evidence |
|---|---|---|
| Explicit compile hints, per-file `//# allFunctionsCalledOnLoad` (Chrome 136) | Shipped in Chrome only. Per-function hints are still "Proposed". Firefox and Safari: no position ("N/A"). | chromestatus API, feature 5100466238652416 (ship stage desktop_first 136) and feature 5153430045458432 (status "Proposed", last update 2025-11-26). |
| JSON.stringify fast path | V8 13.8 / Chrome 138 and later. Chrome-only engine detail; other engines differ. | Post text ("available in V8 starting with version 13.8 (Chrome 138)"). |
| JSPI (Wasm JS Promise Integration) | Chrome/Edge 137, Firefox 153. webstatus.dev sets baseline "newly" with low_date 2026-09-14, but its Safari row is missing from the API reply. Check Safari before you rely on it. | api.webstatus.dev/v1/features/wasm-jspi |
| Iterator helpers ("Firefox: no support, Safari: no support" in the v8.dev table) | The v8.dev table is stale. Baseline "newly available" since 2025-03-31 (Chrome 122, Firefox 131, Safari 18.4). | api.webstatus.dev/v1/features/iterator-methods |
| Explicit resource management (v8.dev table: Firefox 134) | Baseline "limited": Chrome/Edge 134, Firefox 141 (webstatus), no Safari. | api.webstatus.dev/v1/features/explicit-resource-management |
| Code cache numbers (1 KiB minimum, 72-hour window, Wasm 128 kB threshold) | From 2019 posts. Heuristics "may change" (the posts say so). Treat numbers as approximate. | code-caching-for-devs, cost-of-javascript-2019, wasm-code-caching |
| BigInt "not particularly optimized" | 2018 statement. Not re-verified here. Keep the rule "keep BigInt out of hot numeric loops" as a safe default. | bigint post |
| Module loading advice (bundle when ~300 modules, modulepreload, HTTP/2 push) | 2018 advice. HTTP/2 server push was later removed from Chrome, so ignore that part. Bundling and modulepreload remain valid. | features/modules; push removal not re-verified in this task |

All engine behavior in these posts is V8 (Chrome, Edge, Node.js, Deno). SpiderMonkey and JavaScriptCore use similar ideas (shapes, ICs, elements kinds) but details and thresholds differ.

## 8. Draft rules for the skill (from the high posts; original examples)

1. **One shape per "kind" of object.** Create objects through one constructor or factory that sets every field, in the same order, with a value of the final type. Do not add fields later; do not `delete`. (shapes-ics, fast-properties, slack-tracking, react-cliff)

   ```ts
   // Good: one constructor sets every field, same order, final types.
   class Candle {
     constructor(
       public time: number,    // integer ms -> Smi-friendly
       public open: number,    // real prices -> Double fields from birth
       public high: number,
       public low: number,
       public close: number,
       public volume: number,
     ) {}
   }
   // If a double field must start "empty", use NaN (a non-Smi double), never null or 0.
   // React used this fix for its V8 cliff (react-cliff post).
   class Stats { avg = Number.NaN; max = Number.NaN; }
   // Bad: shape and field representation change after creation.
   const c: any = {}; c.time = t; if (hasVol) c.volume = v; c.open = null;
   ```

   Note: `0.0` is the Smi `0` in JS, so it does not make a field a Double. The post also warns not to tune code for one engine version; the stable rule is "same fields, same order, same types".

2. **Arrays stay packed and single-kind.** Pre-size with a loop that pushes, not `new Array(n)` with holes; never write past `length`; never mix ints, doubles and objects in one array. For large numeric series use `Float64Array` (unboxed), not arrays of objects with double fields. (elements-kinds, pointer-compression)

   ```ts
   const closes = new Float64Array(count);           // unboxed doubles
   for (let i = 0; i < count; i++) closes[i] = src[i].close;
   ```

3. **Do not mutate prototypes, RegExp instances or RegExp.prototype at runtime; avoid RegExp subclasses.** (prototypes, speeding-up-regular-expressions)

4. **Reuse Intl formatters.** Build `Intl.NumberFormat` / `Intl.DateTimeFormat` once per locale+options and call `.format()`; never call `toLocaleString()` per tick. (intl)

   ```ts
   const priceFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
   label.textContent = priceFmt.format(price);        // hot path
   ```

5. **JSON on the fast path.** Call `JSON.stringify(value)` with no replacer and no indent in hot paths; no `toJSON`; no integer-like keys on plain objects; arrays of same-shape objects serialize fastest. For big static data shipped in JS, `JSON.parse('...')` beats an object literal (>= ~10 kB). (json-stringify, cost-of-javascript-2019)

6. **Startup: ship less, split, keep scripts external and stable.** Split bundles above ~50-100 kB, lazy-load with `import()`, avoid inline scripts over ~1 kB, keep URLs and startup execution deterministic for the code cache, mark one small core startup file with `//# allFunctionsCalledOnLoad` (Chrome 136+, sparingly). (cost-of-javascript-2019, code-caching-for-devs, explicit-compile-hints, features/dynamic-import, features/modules)

7. **Async: native async/await and native Promises.** Do not transpile async functions to ES5 or use promise polyfills. (fast-async, high-performance-es2015)

8. **Allocation: short-lived objects are cheap, survivors cost.** Avoid keeping per-frame temporary objects alive (caches, closures, arrays kept across frames). (trash-talk)

9. **Binary data: `DataView` is fine for mixed-type/endian parsing; spread/Array.from are fast for arrays, Sets, Maps and strings.** (dataview, spread-elements)

10. **Wasm loading: `WebAssembly.instantiateStreaming(fetch(url))` with `Content-Type: application/wasm`, stable URL and bytes (304 responses), compile/cached in a worker or service worker.** (wasm-code-caching)
