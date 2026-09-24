# V8 deep read, batch 4: Wasm code cache, RegExp fast paths, ES2015+ shipping, v7.6 (JSON/frozen/Intl), Maglev, Ignition+TurboFan, Indicium

Scope: developer-facing rules from seven v8.dev posts (Wasm code caching 2019, RegExp speed-up 2017, high-performance ES2015 2017, V8 v7.6 release 2019, Maglev 2023, launching Ignition and TurboFan 2017, Indicium system analyzer 2020).
Each rule names the engine mechanism, marks advice that later V8 versions made obsolete, and gives the status as of 2026-09.
"Latest" status was checked against V8 `main` source fetched 2026-09-23 (flag-definitions.h, feature-flags.h, regexp-utils.cc, json-parser.cc, js-objects.cc, elements-kind.h, intl-objects.cc, js-date-time-format.cc, isolate.cc, builtins-intl.cc, ic.cc, module-compiler.cc, BUILD.gn), V8 commit history (2026 IC changes), Blink's `v8_wasm_response_extensions.cc`, the v8.dev Wasm pipeline doc, web-features/BCD, and the SciChart.js 5.2.69 Emscripten loader.

---

## A. WebAssembly code caching (post: 2019-06-17, updated by dynamic tiering)

### Load .wasm with WebAssembly.instantiateStreaming / compileStreaming on a fetch() Response
- Layer: v8
- Stage: network, script-compile
- Metrics: startup, TBT, LCP
- When: load
- Impact: high, it is the only path that reads and writes Chrome's Wasm code cache, and it compiles while bytes download.
- Do: Pass the `fetch()` promise (or Response) straight to `WebAssembly.instantiateStreaming(fetchPromise, imports)`. Do not `await res.arrayBuffer()` and then call `WebAssembly.instantiate(bytes)`. If a library (Emscripten output, SciChart.js) loads the module, confirm its loader takes the streaming branch.
- Why: Chrome keys the Wasm code cache on the resource URL of the streamed response; the ArrayBuffer path has no URL, so V8 compiles from scratch every page load. On a hot run Chrome reads the resource cache and the code cache in parallel and V8 deserializes machine code instead of compiling.
- Example:
  ```js
  // Before: no code cache, no streaming compile
  const bytes = await (await fetch('/engine.wasm')).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, imports);

  // After
  const { instance } = await WebAssembly.instantiateStreaming(fetch('/engine.wasm'), imports);
  ```
- Avoid/caveats: The SciChart.js 5.2.69 loader (`_wasm/scichart2d.js`) already calls `instantiateStreaming` when `fetch` exists and the URL is not a `data:` URI. On failure it logs "wasm streaming compile failed" and falls back to ArrayBuffer instantiation, which silently loses streaming and the code cache. Do not inline .wasm as a data URI or base64 string for a large module.
- Status: `compileStreaming`/`instantiateStreaming`: Chrome 60, Firefox 58, Safari 15 (BCD). The code-cache behavior is Chrome/V8 only.
- Sources: https://v8.dev/blog/wasm-code-caching ; https://v8.dev/docs/wasm-compilation-pipeline ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/_wasm/scichart2d.js

### Serve .wasm with exactly `Content-Type: application/wasm` and a 2xx status
- Layer: network
- Stage: network, script-compile
- Metrics: startup, TBT
- When: load / build (server config)
- Impact: high, a wrong header makes streaming throw, and library loaders then fall back to the uncached ArrayBuffer path.
- Do: Configure the server/CDN to send `Content-Type: application/wasm` with no parameters (no `; charset=...`). Return 200 or 304, not an error page.
- Why: Blink compares the full Content-Type header against `application/wasm` case-insensitively and rejects any extra parameters, and it rejects non-ok responses with "HTTP status code is not ok" (source comment: the spec disallows extras on the header).
- Example:
  ```nginx
  types { application/wasm wasm; }   # and do NOT add charset to this type
  ```
- Avoid/caveats: Some static hosts append `charset=utf-8` to all types; check the response headers in DevTools Network. Watch the console for the Emscripten fallback message.
- Status: Current Chromium `v8_wasm_response_extensions.cc` (checked 2026-09-23). Spec rule in the WebAssembly Web API.
- Sources: https://v8.dev/blog/wasm-code-caching ; https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/bindings/core/v8/v8_wasm_response_extensions.cc

### Keep the .wasm URL and bytes stable between visits; version it by content hash, not a per-load query string
- Layer: network
- Stage: network, script-compile
- Metrics: startup, TBT
- When: build / load
- Impact: high, any URL change or a new 200 response discards the cached machine code and forces a cold compile.
- Do: Put a content hash in the file name (`engine.3f9a1c.wasm`) and serve it with a long `Cache-Control` lifetime, or answer revalidation with 304. Never append `?t=Date.now()` or a build timestamp that changes when the bytes did not change. Ship new .wasm builds only when the code changed.
- Why: The cached code is looked up by URL (query string included). A 200 response replaces the cached resource and invalidates the code cache; a 304 keeps both valid. Current Blink also stores a SHA-256 digest of the wire bytes with the cached code and throws the entry away (trace event `v8.wasm.moduleCacheInvalidDigest`) when the bytes differ. A new Chrome/V8 version also invalidates the entry (about every release).
- Avoid/caveats: Library files like `scichart2d.wasm` must be copied from the same package version as the JS; a hash in the name also prevents a JS/wasm version mismatch.
- Status: Current Chromium source (digest check, URL key). The 2019 post's "about every 6 weeks" V8 update interval is now every 4 weeks (Chrome moved to a 4-week milestone cycle starting with Chrome 94, 2021), so expect one cold compile per browser update.
- Sources: https://v8.dev/blog/wasm-code-caching ; Chromium `v8_wasm_response_extensions.cc` (kWireBytesDigestSize = 32, SHA-256) ; https://blog.chromium.org/2021/03/speeding-up-release-cycle.html

### Expect the Wasm code cache to hold only hot TurboFan code; the 128 kB module-size rule is obsolete
- Layer: v8
- Stage: script-compile, idle
- Metrics: startup
- When: long-lived session / load
- Impact: medium, it sets the right expectation for cold versus warm starts and for what to measure.
- Do: Do not pad or merge modules to pass a size threshold. Expect the second visit to be fast only for functions that ran hot in an earlier session. Measure warm starts after a session that exercised the real hot paths (for example, rendering a chart with data) for several seconds.
- Why: Since dynamic tiering, V8 compiles every function lazily with Liftoff on first call and recompiles only hot functions with TurboFan in the background. Chrome caches only TurboFan code; Liftoff code is never cached because Liftoff compiles almost as fast as a cache load. On V8 `main`, a caching event fires when at least `--wasm-caching-threshold` (1,000) of new top-tier code exists and no new TurboFan code appeared for `--wasm-caching-timeout-ms` (2,000 ms), or at once past `--wasm-caching-hard-threshold` (1,000,000). Small or cold modules may never get cached.
- Avoid/caveats: These flag values are internal tuning and can change. The 2019 post also named a cap of about 150 MB of compiled Wasm per entry (half the cache); that cap was not re-verified. Per the v8.dev pipeline doc, V8 does no on-stack replacement for Wasm, so a long call that started in Liftoff finishes in Liftoff.
- Status: OBSOLETE (2019 post): "cache only if .wasm >= 128 kB, after the full TurboFan compile". Replaced by the incremental top-tier trigger (dynamic tiering tried in Chrome 96, 2021; current flags checked 2026-09-23).
- Sources: https://v8.dev/blog/wasm-code-caching ; https://v8.dev/blog/wasm-dynamic-tiering ; https://v8.dev/docs/wasm-compilation-pipeline ; V8 `src/flags/flag-definitions.h`, `src/wasm/module-compiler.cc`

### Warm large Wasm modules in a worker or service worker so the first compile is off the critical path
- Layer: v8
- Stage: script-compile, main-thread-task, idle
- Metrics: startup, TBT, INP
- When: load / long-lived session
- Impact: medium, every site pays at least one full cold compile per browser version; a worker hides it.
- Do: Pre-fetch and `WebAssembly.compileStreaming()` the module from a worker or service worker (for example after first paint or on install), from the same URL the page will use. Keep the Response in Cache Storage if you serve it from a service worker.
- Why: The post says Wasm code caching is enabled for workers and service workers. Current Blink passes the Cache Storage cache name when it stores Wasm code metadata, so responses served from Cache Storage also get cached code.
- Avoid/caveats: A compile in a worker produces a Module you must transfer (`postMessage(module)`) or recompile; the cache only helps if the page then streams the same URL. Background compile still uses CPU cores that app workers may need.
- Status: Chrome behavior (post 2019, Blink source 2026-09).
- Sources: https://v8.dev/blog/wasm-code-caching ; Chromium `v8_wasm_response_extensions.cc`

### Verify Wasm caching with trace events, and never benchmark Wasm with DevTools open
- Layer: tooling
- Stage: script-compile
- Metrics: startup
- When: testing
- Impact: medium, open DevTools changes which Wasm tier runs and gives wrong numbers.
- Do: Record a trace with the `devtools.timeline` category (disabled by default) in a clean profile and filter for `v8.wasm`. Cold run: `v8.wasm.streamFromResponseCallback` + `v8.wasm.compiledModule`, then `v8.wasm.cachedModule`. Hot run: `v8.wasm.streamFromResponseCallback` + `v8.wasm.moduleCacheHit`. `v8.wasm.moduleCacheInvalid` / `...InvalidDigest` means stale cache. For compile timing use the `v8.wasm` category (`wasm.BaselineFinished`, `wasm.TopTierFinished`). Run speed tests with DevTools closed, or inside a Performance recording.
- Why: Opening DevTools tiers all Wasm down to Liftoff for debuggability; starting a Performance recording tiers it back up to TurboFan.
- Avoid/caveats: chrome://tracing is deprecated in favor of the Perfetto UI (ui.perfetto.dev); the categories are the same. `moduleCacheInvalidDigest` exists only in newer Chromium.
- Status: Event names checked in current Chromium source (2026-09-23).
- Sources: https://v8.dev/blog/wasm-code-caching ; https://v8.dev/docs/wasm-compilation-pipeline ; https://perfetto.dev/docs/getting-started/chrome-tracing (search result only)

---

## B. RegExp built-ins (post: 2017-01-10)

### Keep RegExp instances and RegExp.prototype unmodified, do not subclass RegExp in hot code, and keep lastIndex a non-negative integer
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT
- When: interaction / load (parsing, tokenizing, formatting)
- Impact: medium, any of these sends `exec`, `test`, `match`, `replace`, `split` and `matchAll` to the generic slow path for every call.
- Do: Treat regexes as immutable values: no expando properties on a regex, no patches to `RegExp.prototype` (including `exec`), no `RegExp[Symbol.species]` or `constructor` tricks, no `class X extends RegExp` on hot paths. Only write integers >= 0 to `lastIndex`.
- Why: The CSA/Torque fast path runs only when (V8 `main`, `RegExpUtils::IsUnmodifiedRegExp`): the receiver still has the initial JSRegExp map (an added property or a subclass changes the map); the prototype still has its initial map; the `exec` property is still constant; the RegExp species protector is intact; and `lastIndex` is a non-negative Smi (so no user code can run inside `ToLength(lastIndex)`).
- Example:
  ```js
  const TICKER = /^[A-Z]{1,5}$/;
  TICKER.lastMatchedAt = Date.now(); // Before: expando -> new map -> slow path forever
  const meta = new WeakMap();        // After: keep side data outside the regex
  meta.set(TICKER, { lastMatchedAt: Date.now() });
  ```
- Avoid/caveats: Patching `RegExp.prototype` anywhere on the page (for example by a polyfill) slows every regex on the page, not just yours.
- Status: Current. The fast-path conditions in the 2017 post are still in V8 `main` (checked 2026-09-23), plus the Smi `lastIndex` rule, which the post does not mention.
- Sources: https://v8.dev/blog/speeding-up-regular-expressions ; V8 `src/regexp/regexp-utils.cc`

---

## C. Shipping and using ES2015+ (post: 2017-02-17)

### Ship ES2015+ syntax untranspiled to modern browsers; target Baseline, not ES5
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, startup, TBT
- When: build
- Impact: high, ES5 output was 2x to 6.5x larger in the post's examples, and every byte is downloaded, parsed and compiled.
- Do: Set the build target with Browserslist `"baseline widely available"` (or a `baseline 20XX` year) so Babel/SWC/esbuild keep classes, spread, destructuring, `for...of`, async/await and async generators native. Do not include regenerator-runtime or ES5 helper polyfills in the modern bundle. If legacy browsers must be served, build a separate legacy bundle.
- Why: The post measured Babel ES5 output: the Redux reducer went from 203 to 588 characters (176 to 367 bytes gzipped), and an async generator went from 187 to 2,987 characters (150 to 971 bytes gzipped) plus the regenerator runtime. Transpiled helpers also run slower than native features that V8 optimizes.
- Example:
  ```json
  // package.json
  { "browserslist": ["baseline widely available"] }
  ```
- Avoid/caveats: Check that dependencies in `node_modules` are not pre-transpiled to ES5. Features newer than your target still need a transform or a guard.
- Status: Browserslist added Baseline queries in 2025 (web.dev, 2025-09-16). Destructuring, spread, template literals, async generators and async iterators are Baseline widely available (web-features, high since 2022-07-15). The web.dev "publish modern JavaScript" article was removed as outdated (page updated 2024-12-13).
- Sources: https://v8.dev/blog/high-performance-es2015 ; https://web.dev/blog/browserslist-supports-baseline ; https://web.dev/articles/use-baseline-with-browserslist

### Use native destructuring, spread, for...of, generators and async functions instead of hand-desugared ES5 for speed
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT
- When: interaction / animation/render-loop
- Impact: medium, hand-desugaring no longer buys speed and costs bytes and readability.
- Do: Write `const [first] = arr`, `for (const x of arr)`, `async function*` directly. In hot loops over large arrays that you measure, an indexed `for` loop is still a fine choice, but do not avoid these features by rule.
- Why: Ignition and TurboFan support the full language, including exception handling. Ignition lowers generator control flow into plain bytecodes, so TurboFan only needs to save and restore state at `yield`. The post shows array destructuring reaching parity with `data[0]` and being much faster than the Babel `_slicedToArray` helper.
- Avoid/caveats: The post's parity numbers are from Chrome 58 (2017); later posts (spread elements, fast async) continued this work. `for...of` over a non-array iterable still pays the iterator protocol.
- Status: Current direction; the Crankshaft limits it describes are gone since V8 5.9 / Chrome 59.
- Sources: https://v8.dev/blog/high-performance-es2015 ; https://v8.dev/blog/launching-ignition-and-turbofan

### Copy plain objects with object spread, not an Object.assign helper; keep sources plain data objects
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, memory
- When: interaction (reducers, immutable state updates)
- Impact: medium, spread has a dedicated inline cache that can reuse the source's hidden class.
- Do: Write `{ ...state, filter }` for immutable updates of plain objects. Keep the source a plain object whose properties are all enumerable data fields (no getters, no non-enumerable or private fields) created in the same realm.
- Why: V8 handles `{...src}` with the CloneObject IC. When the source map is a plain `Object` literal map (Object constructor, `Object.prototype`, not a prototype map) the clone reuses the same map (`kIdenticalMap`); class instances and read-only/non-configurable fields get a fresh literal map (`kDifferentMap`); accessors, non-enumerable keys, private names, double (unboxed) elements, or a map from another realm fall to the slow path (V8 `main` `ic.cc`). The 2017 post notes Babel lowers spread to `Object.assign`, which does not use this IC.
- Example:
  ```js
  // Before (transpiled shape): Object.assign({}, state, { filter: f })
  // After
  const next = { ...state, filter: f };
  ```
- Avoid/caveats: Semantics differ: `Object.assign` calls setters on the target; spread defines properties. Spreading a large object in a per-frame loop still allocates; mutate a reusable object there instead.
- Status: Object spread: Chrome 60+ (v8.dev feature page); Baseline widely available (web-features `spread`). CloneObject IC checked in V8 `main` 2026-09-23. No verified speed number: a "50x" figure in search results is not from a primary source.
- Sources: https://v8.dev/blog/high-performance-es2015 ; https://v8.dev/features/object-rest-spread ; V8 `src/ic/ic.cc` (GetCloneModeForMap)

---

## D. V8 v7.6 release items (post: 2019-06-19)

### Emit JSON arrays of objects with identical keys in identical order and consistent value types
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, TBT, memory
- When: load / interaction (API responses, WebSocket snapshots)
- Impact: medium, homogeneous rows let `JSON.parse` reuse one hidden class and match keys with a byte compare.
- Do: Serialize every row with the same key set in the same order (`{"t":..,"o":..,"h":..,"l":..,"c":..}`); do not omit keys for some rows or reorder them; keep each key's value type stable (always a number, not sometimes `null` or a string).
- Why: V8 v7.6 buffers properties before it creates an object, so it allocates exactly the in-object space needed (up to 128 named properties) and exact-size arrays. On V8 `main`, the parser also passes the previous sibling's map as feedback to the next object: if every key matches that map's descriptors in exact order, no extra keys follow, and the value types fit the recorded field representations, it builds the object directly with that map and skips the generic builder.
- Example:
  ```json
  [{"t":1727000000,"o":101.2,"c":101.9},{"t":1727000060,"o":101.9,"c":102.4}]
  ```
- Avoid/caveats: For large numeric series, a columnar layout (`{"t":[...],"c":[...]}`) or a binary format is smaller still. The feedback fast path is an implementation detail of V8 `main`.
- Status: v7.6 parser: Chrome 76 (2019). Sibling-map fast path: V8 `main` `json-parser.cc` (checked 2026-09-23).
- Sources: https://v8.dev/blog/v8-release-76 ; V8 `src/json/json-parser.cc` (BuildJsonObject, ParseJsonObject)

### Keep numeric JSON arrays free of null and strings so they parse to unboxed double arrays
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: memory, INP
- When: load / interaction
- Impact: medium, one `null` turns a raw float array into an array of boxed HeapNumbers.
- Do: Send price/value arrays that contain only numbers. Represent gaps with a separate index or mask array, or a sentinel number agreed with the client, then copy into a `Float64Array` for charting.
- Why: V8 builds a JSON array of only small integers as PACKED_SMI_ELEMENTS, a number array with any non-Smi value as PACKED_DOUBLE_ELEMENTS (raw doubles), and any array with a non-number as PACKED_ELEMENTS (tagged, each double boxed on the heap).
- Example:
  ```json
  // Before: {"close":[101.2,null,101.9]}  -> PACKED_ELEMENTS
  // After:  {"close":[101.2,101.9],"gaps":[1]} -> PACKED_DOUBLE_ELEMENTS
  ```
- Avoid/caveats: JSON cannot carry NaN; do not replace null with a string. Integers beyond the Smi range (31-bit with pointer compression) make the array a double array, which is fine.
- Status: V8 `main` `json-parser.cc` BuildJsonArray/ParseJsonArray (checked 2026-09-23).
- Sources: V8 `src/json/json-parser.cc` ; https://v8.dev/blog/v8-release-76

### Do not use a JSON.parse reviver on large payloads; post-process only the fields you need
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT
- When: load / interaction
- Impact: low, a reviver adds a JS call per value and switches off some parser fast paths.
- Do: Parse without a reviver, then convert the few fields that need it (dates, BigInt strings) in a typed loop.
- Why: With a reviver, V8 walks the whole result and calls the function for every property and element. With the three-argument reviver (JSON source text access), the parser also tracks source positions and does not use mutable HeapNumbers.
- Avoid/caveats: Source-derived; not benchmarked here. A reviver is still the right tool for small payloads.
- Status: V8 `main` `json-parser.cc` (JsonParseInternalizer). JSON source text access (`context.source`): Baseline newly available 2025-03-31 (web-features `json-raw`).
- Sources: V8 `src/json/json-parser.cc`

### Accept that JSON.parse handles deep nesting; it no longer overflows the native stack
- Layer: v8
- Stage: script-run
- Metrics: INP
- When: load
- Impact: low, it removes a reason to flatten payloads or wrap parse in try/catch for depth.
- Do: Do not add depth workarounds for JSON.parse in Chrome. Keep depth limits only as input validation for untrusted data.
- Why: Up to v7.5 the parser was recursive on the native stack; v7.6 made it iterative with its own stack, limited only by memory. Current `main` starts recursive and switches to the iterative parser when a stack check fails.
- Status: Chrome 76+ (2019); still true on V8 `main`.
- Sources: https://v8.dev/blog/v8-release-76 ; V8 `src/json/json-parser.cc`

### Freeze constant lookup arrays freely, but do not freeze hot numeric arrays; use typed arrays for numeric data
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: memory, FPS/smoothness
- When: animation/render-loop / long-lived session
- Impact: medium, freezing a double array boxes every element.
- Do: Use `Object.freeze` on config and enum-like arrays (their `indexOf`, `includes`, spread and `apply` calls stay fast). Keep numeric series in `Float64Array`/`Float32Array` and protect them by module encapsulation, not by freezing.
- Why: Since v7.6, frozen, sealed and non-extensible arrays keep fast elements kinds (PACKED/HOLEY_FROZEN/SEALED/NONEXTENSIBLE_ELEMENTS) instead of dictionary elements. But on V8 `main`, sealing or freezing a PACKED_SMI or PACKED_DOUBLE array first transitions it to PACKED_ELEMENTS (HOLEY stays HOLEY), because only object-kind frozen/sealed kinds exist, so raw doubles become boxed HeapNumbers. A typed array with elements cannot be frozen or sealed at all (TypeError).
- Example:
  ```js
  const SIDES = Object.freeze(['buy', 'sell']);              // fine
  const closes = Object.freeze([101.2, 101.9, 102.4]);       // Before: now PACKED_ELEMENTS, boxed doubles
  const closesF64 = Float64Array.from([101.2, 101.9, 102.4]); // After: raw doubles; freeze() would throw
  ```
- Avoid/caveats: Freezing an empty typed array succeeds; freezing a non-empty one throws.
- Status: v7.6 fast frozen/sealed arrays: Chrome 76. Boxing on freeze: V8 `main` `js-objects.cc` PreventExtensionsWithTransition (checked 2026-09-23). Typed array rule is in the spec.
- Sources: https://v8.dev/blog/v8-release-76 ; V8 `src/objects/js-objects.cc` ; V8 `src/objects/elements-kind.h`

### Create each Intl formatter once per (locale, options) and reuse it; never pass an options object to toLocaleString in a loop
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: animation/render-loop / interaction (axis labels, tooltips, order book cells)
- Impact: high for per-frame or per-row formatting, each uncached call builds a new ICU formatter.
- Do: Hoist `new Intl.NumberFormat(locale, opts)` and `new Intl.DateTimeFormat(locale, opts)` to module scope or a cache keyed by locale+options, and call `.format()` / `.formatToParts()`. Use the same formatter for BigInt values (`nf.format(123n)`). Use `dateStyle`/`timeStyle` and `formatRange` on the reused instance instead of building strings by hand.
- Why: `Number/BigInt.prototype.toLocaleString`, `Date.prototype.toLocale(Date|Time)String` and `String.prototype.localeCompare` construct a full ICU formatter per call. V8 caches one instance per kind (collator, number format, three date formats) only when `locales` is a string or undefined AND `options` is undefined, and each kind holds only the most recently used locale, so alternating locales also misses the cache.
- Example:
  ```js
  // Before: new ICU formatter on every label
  labels.map(v => v.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  // After
  const PRICE = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 });
  labels.map(v => PRICE.format(v));
  ```
- Avoid/caveats: Formatters hold ICU memory; do not create one per chart instance if the options are the same.
- Status: `Intl.NumberFormat` BigInt support, `formatRange`, `dateStyle`/`timeStyle` shipped in Chrome 76 (post). BCD: `formatRange` Chrome 76, Firefox 91, Safari 14.1; BigInt `toLocaleString` Chrome 67, Firefox 68, Safari 14. Cache rules: V8 `main` `intl-objects.cc`, `js-date-time-format.cc`, `isolate.h/.cc` (checked 2026-09-23).
- Sources: https://v8.dev/blog/v8-release-76 ; V8 `src/objects/intl-objects.cc` (NumberToLocaleString, StringLocaleCompare) ; V8 `src/execution/isolate.cc` (get_cached_icu_object)

### For option-free string sorting, localeCompare with a listed locale is fast; with options, reuse one Intl.Collator
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT
- When: interaction (sorting symbol lists, tables)
- Impact: low to medium, it decides whether an ASCII fast path runs for large sorts.
- Do: For plain sorts, write `a.localeCompare(b)` or `a.localeCompare(b, 'en')` with no options. When you need options (`numeric`, `sensitivity`), create one `Intl.Collator` and pass `collator.compare` to `sort`; never call `localeCompare(b, loc, opts)` inside a comparator.
- Why: `localeCompare` without options uses the cached default collator and, for locales on a fixed list (en-US, en, fr, es, de, pt, it, ca, de-AT, fi, id, id-ID, ms, nl, pl, ro, sl, sv, sw, vi, en-DE, en-GB), tries an ASCII weight-table fast path. `Intl.Collator.prototype.compare` calls the comparison with the fast path off (`kNone`), and `localeCompare` with options builds a new collator per call. v7.6 had already doubled `localeCompare` throughput for one-byte strings.
- Example:
  ```js
  const byNumeric = new Intl.Collator('en', { numeric: true });
  symbols.sort(byNumeric.compare);           // options: reuse one collator
  names.sort((a, b) => a.localeCompare(b, 'en')); // no options: cached + ASCII fast path
  ```
- Avoid/caveats: Source-derived; relative speed of the two paths not benchmarked here. Non-ASCII strings leave the fast path at the first such character.
- Status: V8 `main` `intl-objects.cc` (CompareStringsOptionsFor, kFastLocales) and `builtins-intl.cc` (CollatorInternalCompare), checked 2026-09-23.
- Sources: https://v8.dev/blog/v8-release-76 ; V8 `src/objects/intl-objects.cc` ; V8 `src/builtins/builtins-intl.cc`

### Start independent async work together and await it with Promise.all / Promise.allSettled
- Layer: js
- Stage: network, microtask
- Metrics: LCP, startup
- When: load
- Impact: low, it removes serial waits when several requests do not depend on each other.
- Do: Start all independent fetches first, then `await Promise.allSettled([...])` when partial failure is acceptable (for example, optional panels), or `Promise.all` when any failure should abort.
- Why: `allSettled` resolves when every input settles, fulfilled or rejected, so one failed optional request does not block or reject the rest (post explainer). The post presents it as a language feature, not a speed feature; the latency gain comes from not awaiting in series.
- Example:
  ```js
  const [quotes, news] = await Promise.allSettled([fetch('/q'), fetch('/news')]);
  ```
- Status: Baseline widely available (web-features `promise-allsettled`, high since 2023-01-28).
- Sources: https://v8.dev/blog/v8-release-76

---

## E. Tiers: Ignition, Sparkplug, Maglev, TurboFan (posts: 2017-05-15, 2023-12-05)

### Drop Crankshaft-era "optimization killer" workarounds (try/catch isolation, avoiding for...of, generators, destructuring)
- Layer: v8
- Stage: script-run
- Metrics: bundle-size
- When: build / code review
- Impact: medium, the workarounds add code and indirection for no gain on current engines.
- Do: Put `try/catch/finally` where the logic needs it; do not move it into a helper "so the caller can be optimized". Do not ban `for...of`, generators, async functions or destructuring on performance grounds. Remove lint rules and comments that cite these limits.
- Why: Crankshaft could not optimize `try/catch/finally` (and therefore `for...of`, which has an implicit `finally`) or generators. Since V8 5.9 / Chrome 59, Ignition + TurboFan run all JavaScript and support the whole language; Full-codegen and Crankshaft were removed.
- Status: DEPRECATED advice since 2017 (V8 5.9, Chrome 59). Current tiers (Sparkplug, Maglev, TurboFan) all compile from Ignition bytecode.
- Sources: https://v8.dev/blog/launching-ignition-and-turbofan ; https://v8.dev/blog/high-performance-es2015

### Keep hot property-access sites monomorphic; a stable shape lets Maglev and TurboFan emit one map check and a direct field load
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: animation/render-loop / interaction
- Impact: high for hot loops, it decides between an offset load and a generic lookup.
- Do: Pass objects of one shape (same constructor, same property order) to each hot function (renderers, reducers, hit-testing). Keep separate code paths for truly different object kinds instead of one function that handles many shapes.
- Why: For `o.x` with one observed shape, Maglev emits a CheckMap node and a LoadField at a fixed offset, then records that it knows `o`'s shape, so later accesses skip the check. Polymorphic feedback needs a chain of checks; megamorphic falls back to a generic stub cache lookup.
- Avoid/caveats: Do not merge unrelated types into one shape with dummy fields just to be monomorphic unless measurement shows a hot site.
- Status: Current. Changes in 2026 on V8 `main`: the polymorphic limit rose from 4 to 10 maps (commit f2c89563c0, 2026-08-26; about +1% JetStream 3), and a new "homomorphic" IC state (between polymorphic and megamorphic) for many maps that share one own-data-field handler was enabled by default (commit 77b7016561, 2026-09-15). Both reach Chrome Stable only in a later milestone (not verified which). So "more than 4 shapes = megamorphic" is outdated, but monomorphic is still the fastest.
- Sources: https://v8.dev/blog/maglev ; https://github.com/v8/v8/commit/f2c89563c0 ; https://github.com/v8/v8/commit/ab86d353fe ; https://github.com/v8/v8/commit/77b7016561

### Never add or delete properties on objects after hot code has used their shape
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: long-lived session / animation/render-loop
- Impact: medium, one late transition makes the shape "unstable" for every object that shares it and adds checks to optimized code.
- Do: Define every field when the object is created (use `null`/`0` placeholders). Store optional, late-added data in a separate `Map` or a dedicated field (`extra: null`), not as new properties. Do not `delete` fields; set them to `undefined`/`null`.
- Why: Maglev and TurboFan treat a map as stable while no object has ever transitioned away from it. They then register a dependency instead of re-checking the shape, even across calls to unknown functions. The first transition away from that map invalidates the dependency, deoptimizes dependent code, and later code must re-check shapes after calls.
- Example:
  ```js
  // Before: late field on a few candles
  if (isGap) candle.gap = true;
  // After: field always present
  class Candle { constructor(t, o, h, l, c) { this.t = t; this.o = o; this.h = h; this.l = l; this.c = c; this.gap = false; } }
  ```
- Status: Current (Maglev post 2023; same model in TurboFan).
- Sources: https://v8.dev/blog/maglev

### Use const for top-level values that never change, and do not reassign module/global state read by hot code after startup
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: long-lived session
- Impact: low to medium, a de-facto constant is embedded into machine code; a later write deoptimizes that code.
- Do: Declare configuration and lookup tables with `const`. Put mutable app state in object fields (for example `state.theme`), not in top-level `let` bindings that hot functions read and that change at runtime.
- Why: Maglev loads a global that has not changed since initialization at compile time and embeds the value in the machine code, with a dependency; if the runtime later mutates that global, V8 invalidates and deoptimizes the code. On V8 `main`, `--script-context-cells` (default on) extends this to "const tracking let" and mutable numbers in script contexts, and `--function-context-cells` to small function contexts.
- Avoid/caveats: A one-time change (for example at login) costs one deopt and is fine. Module-scope behavior was not verified separately.
- Status: Maglev post 2023; flags checked on V8 `main` 2026-09-23.
- Sources: https://v8.dev/blog/maglev ; V8 `src/flags/flag-definitions.h`

### Keep numeric variables type-stable (small ints stay ints, doubles stay doubles, never mixed with undefined/null)
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium, stable numeric types let optimized code keep values unboxed in registers.
- Do: Initialize accumulators and loop variables with a number of the final kind (`let sum = 0` for floats is fine; not `let sum` or `let max = null`). Do not return `undefined` from a numeric function to mean "no value"; return `NaN` or use a separate flag. Keep integer counters within the Smi range.
- Why: V8 stores small integers as 31-bit tagged Smis (pointer compression). Optimizing tiers pick a representation per value from feedback and can unbox floats into FP registers. At control-flow merges (phis), a representation must fit all inputs; loop phis get a separate selection pass. A non-number input forces a tagged representation and heap-number boxing.
- Example:
  ```js
  // Before
  let hi; for (const p of prices) if (hi === undefined || p > hi) hi = p;
  // After
  let hi = -Infinity; for (let i = 0; i < prices.length; i++) if (prices[i] > hi) hi = prices[i];
  ```
- Status: Current (Maglev post 2023; phi untagging flags on by default on V8 `main`).
- Sources: https://v8.dev/blog/maglev ; V8 `src/flags/flag-definitions.h` (maglev_untagged_phis, turbolev_untagged_phis)

### Optimize and measure warm code, not only hot loops; warm up before you time anything
- Layer: tooling
- Stage: script-run
- Metrics: INP, TBT
- When: testing
- Impact: medium, most interaction code never reaches TurboFan, and early iterations run in lower tiers.
- Do: Benchmark real user flows (Speedometer-style) as well as micro loops. In micro-benchmarks, run thousands of warm-up iterations, and check for deopts with `--trace-deopt` when numbers jump. Do not conclude from the first few calls.
- Why: Tiers on V8 `main`: Ignition interprets bytecode; a feedback vector is allocated after 8 invocations (flag), then Sparkplug compiles bytecode to machine code almost instantly; Maglev after about 400 invocations (1,000 on Android); TurboFan after about 3,000; loops tier up by OSR (Maglev OSR at 100, TurboFan at 500). The Maglev post shows Speedometer spends much time in functions that never get hot enough for TurboFan: Sparkplug gave +41% over Ignition there, and Maglev compiles about 10x faster than TurboFan and 10x slower than Sparkplug, and cut energy use by 10% on Speedometer.
- Avoid/caveats: The counts are internal tuning values scaled by budgets and can change between releases. Turbolev (Maglev front end + Turboshaft) exists but `--turbolev` is off by default on `main` (2026-09).
- Status: Maglev shipped in Chrome M117 desktop (2023). Current BUILD.gn builds Maglev by default on arm, arm64 and x64 (so Android arm64 too), with an Android-specific threshold.
- Sources: https://v8.dev/blog/maglev ; https://v8.dev/blog/launching-ignition-and-turbofan ; V8 `src/flags/flag-definitions.h` ; V8 `BUILD.gn`

---

## F. Indicium system analyzer (post: 2020-10-01)

### Initialize every instance property in the constructor, unconditionally and in the same order
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: animation/render-loop / interaction
- Impact: high for hot methods, a conditional field creates a second map and makes call sites polymorphic (about 3x slower in the post's example).
- Do: Assign all fields in the constructor on every path, in a fixed order; compute conditional values into the field (`this.isNegative = x < 0 || y < 0`) instead of adding the field only on some paths. Prefer class field declarations, which define all fields up front.
- Why: Each property addition is a map transition. `if (cond) this.flag = true;` before `this.x = x` creates two transition trees ({x, y} and {flag, x, y}). Methods that see both maps go from monomorphic to polymorphic ICs, which need extra checks.
- Example:
  ```js
  // Before
  constructor(x, y) { if (x < 0 || y < 0) this.isNegative = true; this.x = x; this.y = y; }
  // After
  constructor(x, y) { this.isNegative = x < 0 || y < 0; this.x = x; this.y = y; }
  ```
- Status: Current (the 2026 polymorphic/homomorphic IC changes reduce but do not remove the cost).
- Sources: https://v8.dev/blog/system-analyzer

### Find map and IC problems with Indicium (V8 system analyzer) and V8 log flags
- Layer: tooling
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: testing
- Impact: medium, it shows which source line created an extra map and which ICs went polymorphic or megamorphic.
- Do: Launch Chrome with a throwaway profile and `--js-flags="--log-maps --log-ic"` (add `--log-deopt`, `--log-source-code`, or `--log-all` as needed; d8/Node take the same flags), reproduce the flow, then load the `v8.log` into the system analyzer. Group IC events by function name, open the map transition tree, and click the file position to find the line that adds the stray property.
- Why: Indicium links map events (creation, transitions) with IC state changes on one timeline, which the older IC Explorer and Map Processor tools could not do. IC states in the tool's legend: 0 uninitialized, X no feedback, 1 monomorphic, ^ recompute handler, P polymorphic, N megamorphic, G generic.
- Example:
  ```sh
  chrome --user-data-dir="$(mktemp -d)" --no-first-run --js-flags="--log-maps --log-ic --logfile=/tmp/v8.log" https://localhost:5173
  ```
- Avoid/caveats: Logging slows the page heavily; use it for diagnosis, not timing. `--log-deopt` is a developer-only flag on current V8. The tool URL moved: v8.dev/tools/head/system-analyzer redirects to v8.github.io.
- Status: Tool live at https://v8.github.io/tools/head/system-analyzer/ (checked 2026-09-23); flags `log_maps`, `log_ic`, `log_source_code`, `log_all`, `prof` exist on V8 `main`.
- Sources: https://v8.dev/blog/system-analyzer ; https://v8.github.io/tools/head/system-analyzer/ ; V8 `src/flags/flag-definitions.h`

---

## Deprecated or changed advice found in this batch
- "Wasm code is cached only for modules >= 128 kB, after the full TurboFan compile" (2019): replaced by incremental caching of hot TurboFan code under dynamic tiering (thresholds 1,000 / 2,000 ms / 1,000,000 on `main`).
- "Chrome/V8 changes every 6 weeks" (2019): Chrome now ships every 4 weeks, so cached code is invalidated more often.
- Crankshaft limits (try/catch, for...of, generators not optimizable): obsolete since V8 5.9 / Chrome 59 (2017).
- "Polymorphic ICs hold at most 4 maps": V8 `main` raised it to 10 (2026-08-26) and added homomorphic ICs (default on 2026-09-15); not yet verified in a Chrome Stable milestone.
- "Maglev is desktop-only" (2023 post): current BUILD.gn enables Maglev on arm/arm64/x64, with an Android threshold of 1,000 invocations.
- chrome://tracing: deprecated in favor of the Perfetto UI (per search results; not fetched).

## Sources read
- https://v8.dev/blog/wasm-code-caching
- https://v8.dev/blog/speeding-up-regular-expressions
- https://v8.dev/blog/high-performance-es2015
- https://v8.dev/blog/v8-release-76
- https://v8.dev/blog/maglev
- https://v8.dev/blog/launching-ignition-and-turbofan
- https://v8.dev/blog/system-analyzer
- https://v8.dev/blog/wasm-dynamic-tiering
- https://v8.dev/docs/wasm-compilation-pipeline
- https://v8.dev/features/object-rest-spread
- https://v8.github.io/tools/head/system-analyzer/ (tool index page)
- https://web.dev/blog/browserslist-supports-baseline
- https://blog.chromium.org/2021/03/speeding-up-release-cycle.html
- https://web.dev/articles/publish-modern-javascript (page says removed as outdated)
- V8 source, `main`, fetched 2026-09-23 (GitHub mirror https://github.com/v8/v8): src/flags/flag-definitions.h, src/flags/feature-flags.h, src/regexp/regexp-utils.cc, src/json/json-parser.cc, src/objects/js-objects.cc, src/objects/elements-kind.h, src/objects/intl-objects.cc, src/objects/intl-objects.h, src/objects/js-date-time-format.cc, src/objects/js-collator.cc, src/builtins/builtins-intl.cc, src/execution/isolate.h, src/execution/isolate.cc, src/ic/ic.cc, src/wasm/module-compiler.cc, BUILD.gn, gni/v8.gni
- V8 commits: https://github.com/v8/v8/commit/f2c89563c0 , https://github.com/v8/v8/commit/ab86d353fe , https://github.com/v8/v8/commit/77b7016561 , https://github.com/v8/v8/commit/cccc5b5ba0
- Chromium source: third_party/blink/renderer/bindings/core/v8/v8_wasm_response_extensions.cc (main, fetched 2026-09-23)
- SciChart.js loader: https://cdn.jsdelivr.net/npm/scichart@5.2.69/_wasm/scichart2d.js and the package file list at https://data.jsdelivr.com/v1/packages/npm/scichart@5.2.69
- web-features and BCD data (local copies from this research run) for Baseline/support lines
- Search results only (not fetched): https://perfetto.dev/docs/getting-started/chrome-tracing , https://issues.chromium.org/issues/40110077

## Not covered / could not access
- The High-Speed ES2015 talk video and V8's "ES2015 and beyond performance plan" doc linked from the 2017 post were not opened.
- The "fast frozen & sealed elements in V8" design doc (Google Docs) linked from the v7.6 post was not opened; the elements-kind behavior comes from V8 source instead.
- No benchmarks were run: the localeCompare-versus-Collator difference, the JSON sibling-map fast path, and freeze boxing are source-derived, not measured.
- The Chrome milestone that first ships the 2026 IC changes (polymorphic limit 10, homomorphic ICs) was not determined.
- Whether module-scope `let` bindings get the same const tracking as script-context `let` was not verified.
- The current Chrome size cap for one cached Wasm module (the 2019 post said about 150 MB) and the current resource-size cutoff in the Chromium code cache host were not re-verified.
- Windows ETW native stack walking (v7.6) and the Indicium panel UI details were skipped as tooling internals with no effect on how code is written.
- Other engines (SpiderMonkey, JavaScriptCore) were not checked for the same fast paths; every V8-internal rule here is Chrome/Edge/Node-specific.
