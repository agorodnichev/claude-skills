# V8 engine rules for fast JS/TS and Wasm glue (consolidated)

Scope: one deduplicated rule set from the eight V8 deep-read batches (`08-v8-batch-01.md` to `08-v8-batch-08.md`) and the V8 blog index (`08-v8-index.md`). Together they cover every performance-relevant v8.dev blog post and feature explainer from 2017 to 2025 (the blog has published nothing since 2025-08-04), two mathiasbynens.be engine-fundamentals posts, and checks against V8 and Chromium `main` source, V8 commits, chromiumdash, webstatus.dev, web-features, BCD and MDN up to 2026-09-23.
Each rule keeps the newest source and the engine mechanism. Thresholds are V8 internals. They apply to Chrome and Edge, and to Node and Deno with a version lag (Node 24 = V8 13.6, about Chrome 136). SpiderMonkey and JavaScriptCore use similar ideas with other numbers. As of 2026-09-23, Chrome 154 is stable (released 2026-09-22). Since Chrome 153 (2026-09-08), Chrome ships a new milestone every 2 weeks.
Cross-references such as "batch 03" point to the source batch file, which has the local test scripts and the full source-file list.

---

## 1. Objects, shapes and inline caches

### Give all objects of one kind one creation path: same properties, same order, same site
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness, TBT
- When: animation/render-loop | long-lived session
- Impact: high, because every property load in hot code checks the shape, and extra shapes make the inline cache (IC) polymorphic or megamorphic.
- Do: Create each kind of record in exactly one place (one class constructor, one factory, or one object literal), with every property present, in one fixed order. Write every property on every code path, and use `null`, `0` or `NaN` for "absent" instead of skipping the assignment. Make the server send JSON keys in one fixed order.
- Why: V8 stores property names and offsets in a shared hidden class (a "map"). An IC caches the map and the offset, so a repeat access is one compare and one load. A different property order, or a property added only on some paths, creates another branch of the map transition tree. An object literal starts at a map that already holds its keys. An object built as `{}` plus assignments walks a separate transition chain, so it ends on a different map even with the same order (batch 01 local test, V8 13.6). JSON.parse rows with one key order share the map of the equivalent literal. In the Indicium post, one conditional field made the call sites polymorphic and about 3x slower.
- Example:
  ```ts
  // Before: two creation paths plus a conditional field -> several maps
  const a = { time: t, price: p };
  const b: any = {}; b.time = t; b.price = p; if (gap) b.gap = true;
  // After: one factory, one literal, one order, every field always present
  const makeBar = (time: number, price: number, gap: boolean) => ({ time, price, gap });
  ```
- Avoid/caveats: This matters only on hot paths (per frame, per tick, per row). Do not merge unrelated types into one shape with dummy fields unless a profile shows a hot site. A field that holds both numbers and `null` keeps one shape, but its representation becomes Tagged (see section 3).
- Status: Common model in V8, SpiderMonkey and JavaScriptCore (Shapes post). Verified on V8 13.6 (batch 01) and V8 `main` 2026-09-23 (batch 04).
- Sources: https://v8.dev/blog/system-analyzer ; https://v8.dev/blog/slack-tracking ; https://mathiasbynens.be/notes/shapes-ics ; https://v8.dev/blog/fast-properties

### Declare every field at construction time; never add properties after hot code has used the shape
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: long-lived session | animation/render-loop
- Impact: medium, because late properties go to an out-of-object store (one extra pointer hop, grows by copying), and the first transition away from a stable map deoptimizes code that depends on it.
- Do: Assign every field in the constructor or declare it as an initialized class field, even when the first value is a placeholder. Build plain objects in one literal with all keys, not `{}` plus assignments. Do not attach "expando" properties later (for example `bar.cachedX = …` in a render loop).
- Why: Slack tracking: at the first construction, V8 gives the initial map room for the expected property count plus 8 in-object slots. It counts `this.x = …` assignments in the constructor source and parsed class fields over the constructor chain, capped at 252 slots. After 7 constructions it shrinks the instance size to the largest count used. An object literal with n keys gets exactly n in-object slots. An empty `{}` gets 4. Properties beyond the in-object slots go to the out-of-object property array. Maglev and TurboFan treat a map as stable while no object has left it and register a dependency instead of re-checking the shape. The first transition away from that map invalidates the dependency and deoptimizes the dependent code.
- Example:
  ```ts
  // Before: `label` is added after construction -> out-of-object slot, unstable map
  class Tick { constructor(public price: number, public size: number) {} }
  const t = new Tick(101.5, 3); (t as any).label = formatLabel(t);
  // After: the slot exists from the start
  class Tick2 {
    label: string | null = null;
    constructor(public price: number, public size: number) {}
  }
  ```
- Avoid/caveats: The first 7 instances of a class carry about 8 spare slots until the GC reclaims them. Assignments in helper methods (`this.init()`) are not counted, but can use the spare slots during the first 7 constructions. If TurboFan optimizes an allocation site earlier, slack tracking ends early. Do not add unused dummy fields "for speed".
- Status: V8 only. Checked on V8 `main` 2026-09-23: `kSlackTrackingCounterStart = 7`, `+= 8` in `JSFunction::CalculateExpectedNofProperties`, 252 in-object maximum (batch 02).
- Sources: https://v8.dev/blog/slack-tracking ; https://v8.dev/blog/maglev ; https://v8.dev/blog/fast-properties ; https://github.com/v8/v8/blob/main/src/objects/js-function.cc ; https://github.com/v8/v8/blob/main/src/heap/factory.cc

### Never use `delete` on objects that hot code reads; assign `undefined` or build a new object
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: long-lived session | animation/render-loop
- Impact: high, because one `delete` moves the object into dictionary (slow) mode for good, and ICs, the for-in enum cache and the JSON.stringify fast path stop working for it.
- Do: To "remove" a field, assign `undefined` or `null` and keep the shape. To get an object without some keys, build a new one with a literal or a rest copy. Use `Map`/`Set` when keys come and go.
- Why: A dictionary-mode object keeps its own hash table of properties instead of a shared map, so an IC cannot cache an offset. V8 removed the "fast delete of the last-added property" in January 2024 because it interacted badly with other optimizations. Local tests on V8 13.6: every `delete` variant (first property, last-added property, only property, warm code) gave `%HasFastProperties === false`, and for-in over the result was 11x slower (batches 01 and 06).
- Example:
  ```js
  // Before
  delete order.pendingPrice;               // order is now a dictionary-mode object
  // After
  order.pendingPrice = undefined;          // same shape, IC stays valid
  const { pendingPrice, ...rest } = order; // or a new object without the key
  ```
- Avoid/caveats: `delete` is fine on throwaway dictionaries that hot code never reads.
- Status: Chrome 122+ (V8 commit 389ea9be7d, 2024-01-11). Other engines differ, but the advice is safe everywhere.
- Sources: https://chromium-review.googlesource.com/c/v8/v8/+/5185340 ; https://v8.dev/blog/fast-properties

### Use `Map`/`Set` for dynamic keys; keep plain objects for fixed-shape records
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: long-lived session | interaction
- Impact: medium to high, because objects used as growing dictionaries silently switch to dictionary mode and lose every shape-based optimization.
- Do: Store symbol → quote, id → drawing and similar lookups in a `Map`. Do not grow objects with computed keys (`obj[key] = v`). For numeric keys such as price levels, use `Map<number, T>` or a typed array indexed by `(price - min) / tick`.
- Why: When a keyed store adds a new property, the object has no spare slots, and its out-of-object fields exceed the larger of 12 (`--fast-properties-soft-limit`) and its in-object count, V8 normalizes the object to dictionary mode (`Map::TooManyFastProperties`). Named stores (`o.x = v`) and prototypes are exempt from this soft limit. Measured on V8 13.6: `{}` filled through computed keys switched after about 20 keys. Other dictionary-mode starts: any object at 1020 own descriptors, JSON.parse objects with 128 or more keys, literals with 128 or more properties, `Object.create(null)` and `{__proto__: null}` (batches 01, 02, 05). MDN also states that Map performs better with frequent additions and removals.
- Example:
  ```ts
  // Before
  const bySymbol: Record<string, Quote> = {};
  for (const q of quotes) bySymbol[q.symbol] = q;   // keyed stores -> dictionary mode
  // After
  const bySymbol = new Map<string, Quote>();
  for (const q of quotes) bySymbol.set(q.symbol, q);
  ```
- Avoid/caveats: The thresholds are engine internals and change between versions. Do not design for "stay under 20 keys". Dictionary mode is correct for a real dictionary; the problem is only record-like hot objects that end up there. To send a Map as JSON, convert it to an array of records first (section 10).
- Status: V8 `main` 2026-09-23 (`fast_properties_soft_limit = 12`, `kMaxNumberOfDescriptors = 1020`). Map/Set are Baseline widely available.
- Sources: https://github.com/v8/v8/blob/main/src/objects/map-inl.h ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h ; https://v8.dev/blog/hash-code ; https://v8.dev/blog/fast-properties ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map

### Attach side data to objects through a `Map`/`WeakMap` keyed by the object, never through expando ids or properties
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: interaction | long-lived session
- Impact: medium, because an expando changes the object's map and can make hot code inside libraries (chart engine, framework) polymorphic, and a plain Map of dead objects leaks.
- Do: Key maps and sets by the object itself (series, drawing, DOM node, order, RegExp). Store metadata about objects you do not own in a `WeakMap` (`info.set(node, meta)`), not in `node._meta` or `obj.__id`. For your own classes, declare the field instead.
- Why: Since V8 6.3 an object's hash code lives in its properties slot: directly in the slot when there are no out-of-object properties, in spare bits of the property array's length field, or in its own dictionary slot. Reading it never changes the map. Before 6.3, the hash was a hidden symbol property, so using an object as a key changed its shape. A `WeakMap` is an ephemeron: it holds the value only while the key is alive.
- Example:
  ```js
  // Before: mutates every drawing's shape just to key it
  drawing.__id ??= nextId++; selection.set(drawing.__id, state);
  // After
  selection.set(drawing, state);
  const meta = new WeakMap(); meta.set(chartSeries, { lastDrawMs: 0 });
  ```
- Avoid/caveats: A Map or WeakMap lookup is a hash plus a table probe, slower than a declared field. Large WeakMaps add ephemeron work to GC marking (engine knowledge, not measured in the posts).
- Status: V8 6.3+ (Chrome 63). Map, Set and WeakMap Baseline widely available (webstatus high 2018-01-29).
- Sources: https://v8.dev/blog/hash-code ; https://v8.dev/features/weak-references ; https://github.com/v8/v8/blob/main/src/objects/property-array.h

### Never modify built-in prototypes at runtime, and never change an object's prototype after creation
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: long-lived session
- Impact: high, because one change to `Object.prototype` invalidates prototype-load ICs for every object and DOM prototype chain in the realm.
- Do: Load polyfills and prototype patches once, before any other code runs, and never add a method "temporarily" and then delete it. Use standalone functions instead of extending built-ins. Choose the prototype at creation (`class`, `new`, `Object.create(proto)`); do not call `Object.setPrototypeOf` or assign `__proto__` on live objects.
- Why: V8 gives each prototype a unique map with a ValidityCell. A prototype-load IC stores the receiver map, the holder, the offset and that cell. Any change to that prototype, or to one above it, invalidates the cell, and every dependent IC must warm up again. A DOM element's chain is about 6 prototypes deep, so a change to `Object.prototype` reaches all element types. The prototype link lives in the map, so changing it gives the object a new map. MDN calls prototype mutation a very slow operation in every engine.
- Example:
  ```js
  // Before
  Object.prototype.toPx = function () { /* … */ };   // invalidates all prototype ICs
  const tool = {}; Object.setPrototypeOf(tool, LineTool.prototype);
  // After
  const toPx = (v) => v;                              // plain function
  const tool2 = Object.create(LineTool.prototype);    // or: new LineTool()
  ```
- Avoid/caveats: Adding methods to your own class prototypes at setup time is fine: V8 keeps a prototype in dictionary "setup" mode while you add methods and makes it fast on first use. `Object.create(null)` gives a dictionary-mode object: fine for lookup tables, not for hot records. See section 11 for iterator built-ins and section 9 for `RegExp.prototype`.
- Status: Mechanism common to engines. Verified on V8 13.6 (batch 01).
- Sources: https://mathiasbynens.be/notes/prototypes ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/setPrototypeOf

### Keep hot property-access sites monomorphic: one shape and one elements kind per site
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: animation/render-loop | interaction
- Impact: high for hot loops, because it decides between one map check plus a direct field load and a generic lookup.
- Do: Pass objects of one shape (same constructor, same property order) and arrays of one elements kind to each hot function (renderers, reducers, hit-testing). Write type-specific hot helpers (for example `maxF64(a: Float64Array)`) instead of one generic helper that sees many shapes. When inputs must vary, prefer native built-ins (`map`, `forEach`, `reduce`), which handle elements-kind polymorphism better than hand-written generic loops.
- Why: For `o.x` with one observed map, Maglev emits one `CheckMap` and a `LoadField` at a fixed offset, and later accesses skip the check. A polymorphic site checks a list of maps. Past the limit it goes megamorphic and uses a generic stub-cache lookup. The polymorphic limit was 4 maps up to Chrome 153 and is 10 from Chrome 154 (about +1% JetStream 3). V8 also has a new "homomorphic" state for sites that see many maps that share one own-data-field handler; Maglev inlines that handler, TurboFan does a megamorphic lookup.
- Example:
  ```js
  // Before: one helper sees PACKED_SMI, PACKED_DOUBLE, generic arrays and Float64Array
  const each = (arr, fn) => { for (let i = 0; i < arr.length; i++) fn(arr[i]); };
  // After: one hot path per data type
  function maxF64(a) { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }
  ```
- Avoid/caveats: Polymorphism in cold code does not matter; profile first. The larger limit and the homomorphic state soften the cliff but do not remove it: monomorphic stays fastest. Node 24 (V8 13.6) still has the limit of 4.
- Status: Limit 10 in Chrome 154+ (commit f2c89563c0, 2026-08-26; chromiumdash: first stable 154.0.8037.21). Homomorphic state: added behind `--homomorphic-ic` (off by default) in Chrome 147 (commit ab86d353fe); the default-on commit 77b7016561 (2026-09-15) first appears in Chrome 156 canary, and Chrome 156 stable is scheduled for 2026-10-20 (chromiumdash, checked 2026-09-23).
- Sources: https://github.com/v8/v8/commit/77b7016561 ; https://github.com/v8/v8/commit/f2c89563c0 ; https://github.com/v8/v8/commit/ab86d353fe ; https://chromiumdash.appspot.com/fetch_commit?commit=77b70165610525a92dfd0a238bc109917441ead8 ; https://v8.dev/blog/maglev ; https://v8.dev/blog/elements-kinds ; https://mathiasbynens.be/notes/shapes-ics

### Copy plain objects with object spread, not an `Object.assign` helper; keep spread sources plain data objects
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, memory
- When: interaction
- Impact: medium, because spread has its own inline cache that can reuse the source's map.
- Do: Write `{ ...state, filter }` for immutable updates of plain objects. Keep the source a plain object with only enumerable data properties (no getters, no non-enumerable or private fields) from the same realm. Do not let a transpiler lower object spread to `Object.assign`.
- Why: V8 runs `{...src}` through the CloneObject IC. For a plain `Object`-literal map the clone reuses the same map. Class instances and read-only or non-configurable fields get a fresh literal map. Accessors, non-enumerable keys, private names, double elements or another realm's map take the slow path (`GetCloneModeForMap` in `ic.cc`).
- Example:
  ```js
  // Before (transpiled shape): Object.assign({}, state, { filter: f })
  const next = { ...state, filter: f };
  ```
- Avoid/caveats: `Object.assign` calls setters on the target; spread defines properties. Spread still allocates, so in a per-frame loop mutate a reusable object instead. No verified speed number exists; a "50x" figure in search results has no primary source.
- Status: Object spread Chrome 60+, Baseline widely available. CloneObject IC checked in V8 `main` 2026-09-23 (batch 04).
- Sources: https://github.com/v8/v8/blob/main/src/ic/ic.cc ; https://v8.dev/features/object-rest-spread ; https://v8.dev/blog/high-performance-es2015

### Keep `Proxy` objects out of hot data paths: unwrap before loops, never proxy large numeric data
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, INP, TBT
- When: animation/render-loop | interaction
- Impact: high, because a read through a proxy was 19-32x slower than a plain read, and summing a proxied 1e6-element array was about 100x slower (V8 13.6, batch 06).
- Do: Before a hot loop, take the raw target or a plain copy of the data. Keep series data, vertex buffers and indicator output in plain arrays or typed arrays, never behind a Proxy. Do not construct objects through a proxied constructor, and do not use `in`, for-in or `Object.keys` on proxies in hot code.
- Why: A Proxy has no shape that an IC can learn. Each `get`, `set`, `has` or `construct` loads the handler, looks up the trap, calls it and checks the result against the target. The 2017 work moved traps from C++ into CSA builtins (up to 5x faster calls) but kept the call per access. A for-in over a proxy can call 5 of the 13 traps. In shipping V8 the IC installs the slow `LoadProxy` handler. A monomorphic "fast proxy IC" (named `get` only) exists only behind `--future`.
- Example:
  ```js
  // Before: proxied array in the render loop
  for (let i = 0; i < state.points.length; i++) y += state.points[i];
  // After: unwrap once
  const pts = rawPoints; // Float64Array, not proxied
  for (let i = 0; i < pts.length; i++) y += pts[i];
  ```
- Avoid/caveats: Proxies are fine at cold boundaries (RPC wrappers such as Comlink, dev-time validation). Do not depend on the fast proxy IC.
- Status: Proxy Baseline widely available (2019-03-20). Fast proxy IC: V8 commit be455d8278 (2026-05-28), `fast_proxy_ic = false` in V8 `main` 2026-09-23.
- Sources: https://v8.dev/blog/optimizing-proxies ; https://github.com/v8/v8/commit/be455d8278 ; https://github.com/v8/v8/blob/main/src/ic/ic.cc

### In Svelte 5, hold large or numeric datasets in `$state.raw`, typed arrays or class instances, not in deep `$state`
- Layer: js
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: interaction | animation/render-loop | long-lived session
- Impact: high for chart data, because deep `$state` wraps arrays and plain objects in proxies recursively, so every element read pays the proxy cost above.
- Do: Store candles, ticks and series arrays with `$state.raw` and replace the whole value on change, or keep them in a `Float64Array` or a class instance (Svelte does not proxy those). Pass `$state.snapshot(value)` to chart libraries and GPU upload code that expect plain data.
- Why: The Svelte docs say state is proxied recursively until it reaches something that is not an array or a simple object, and that `$state.raw` avoids the cost of making large arrays and objects reactive.
- Example:
  ```js
  let candles = $state.raw([]);   // before: $state([]) -> a proxy per candle object
  candles = [...candles, next];   // reassign to update, or keep a typed array plus a version counter
  ```
- Avoid/caveats: With `$state.raw`, mutation does not trigger updates; you must reassign. `SvelteMap`/`SvelteSet` have their own per-operation cost.
- Status: Svelte 5 docs, read 2026-09-23 (batch 06).
- Sources: https://svelte.dev/docs/svelte/$state ; https://v8.dev/blog/optimizing-proxies

### Diagnose shapes, ICs and deopts with natives syntax, Indicium and V8 log flags
- Layer: tooling
- Stage: script-run
- Metrics: FPS/smoothness, INP, memory
- When: testing
- Impact: medium, because it turns guesses about hidden classes into facts and shows the source line that added a stray property.
- Do: For micro-tests, run Node or d8 with `--allow-natives-syntax` and use `%HaveSameMap(a, b)`, `%HasFastProperties(o)`, `%HasHoleyElements(a)`, `%HasDoubleElements(a)` and `%DebugPrint(x)`. For a real flow, start Chrome with a throwaway profile and `--js-flags="--log-maps --log-ic"` (add `--log-deopt`, `--log-source-code` as needed), then load `v8.log` into the system analyzer (Indicium) and open the map transition tree and the polymorphic or megamorphic ICs.
- Why: Intrinsics expose the engine's real representation. Indicium puts map creation, transitions and IC state changes on one timeline and links them to file positions. IC legend: 0 uninitialized, 1 monomorphic, P polymorphic, N megamorphic, G generic.
- Example:
  ```sh
  node --allow-natives-syntax -e "const a=[1,2]; a.push(-0); console.log(%HasDoubleElements(a))"  # true
  chrome --user-data-dir="$(mktemp -d)" --js-flags="--log-maps --log-ic --logfile=/tmp/v8.log" https://localhost:5173
  ```
- Avoid/caveats: Never ship `%` intrinsics (syntax error without the flag). Logging slows the page heavily; do not time with it. Node lags Chrome (Node 24 = V8 13.6) and uses 32-bit Smis instead of Chrome's 31-bit.
- Status: Developer-only flags present in V8 `main` 2026-09-23. The tool moved to https://v8.github.io/tools/head/system-analyzer/.
- Sources: https://v8.dev/blog/system-analyzer ; https://v8.github.io/tools/head/system-analyzer/ ; https://v8.dev/blog/elements-kinds

---

## 2. Arrays, elements kinds and typed arrays

### Keep each array in its most specific elements kind, and know which writes generalize it
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, memory
- When: animation/render-loop | long-lived session
- Impact: medium, because built-ins and optimized loops specialize on the elements kind, and transitions go one way (SMI → DOUBLE → ELEMENTS) for the life of the array.
- Do: Keep integer arrays pure Smi and double arrays pure double; never mix in strings, `null`, `undefined`, booleans or objects. Normalize `-0` with `v | 0` before you store into integer arrays, and use `-1`, not `NaN` or `Infinity`, as a sentinel in them. For numeric bulk data, prefer typed arrays.
- Why: V8 tracks a kind per array (PACKED_SMI, PACKED_DOUBLE, PACKED_ELEMENTS and HOLEY variants, 21 kinds). Local test, V8 13.6: a Smi array becomes DOUBLE on a fraction, `-0`, `NaN`, `Infinity` or an integer outside the Smi range, and becomes generic ELEMENTS on `undefined`, `null`, a string, a boolean, a BigInt or an object. Writing integers back never returns it to SMI. Hidden `-0` sources: `Math.round(-0.2)`, `Math.trunc(-0.5)`, `0 * -1`.
- Example:
  ```js
  const ticks = [];              // PACKED_SMI
  ticks.push(Math.round(v));     // Before: may push -0 -> PACKED_DOUBLE forever
  ticks.push(Math.round(v) | 0); // After: stays PACKED_SMI (|v| < 2^30)
  ```
- Avoid/caveats: `NaN` gaps are free in arrays that are already DOUBLE (prices). A transition costs once; the lasting cost is only in hot loops over big arrays.
- Status: V8 behavior, verified on V8 13.6 (2026-09, batch 01).
- Sources: https://v8.dev/blog/elements-kinds

### Build arrays without holes; pre-size with `new Array(n).fill(v)` or a typed array
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: animation/render-loop | load
- Impact: low to medium: a holey read needs prototype-chain checks (about 7% on a local sum loop), and copying a HOLEY_DOUBLE array needs a costly kind conversion.
- Do: Build arrays with literals, `push`, `a[a.length] = v`, `Array.from`, `Array.of`, spread, `map` or `filter`. To pre-size a plain array, fill the whole array at once: `new Array(n).fill(0)`.
- Why: Local test, V8 13.6. Makes HOLEY: `new Array(n)` (even if you fill it by index afterwards), elisions `[1,,3]`, writing at `length + k` (k ≥ 1), increasing `length`, `delete a[i]`, a partial `fill`, `Array.prototype.slice.call(arrayLike)`, `structuredClone(array)`. Stays PACKED: `push`, `pop`, `shift`, `unshift`, `splice`, shrinking `length`, `Array.from`, `Array.from({length: n}, fn)`, `Array.of`, spread, `map`/`filter`/`slice`/`concat`/`toSorted`/`with` of packed input, JSON.parse arrays. HOLEY is permanent, except that since Chrome 135 an `Array.prototype.fill` over every element of an array that still has its initial map moves it to the best packed kind (it can even go back from DOUBLE to SMI). A HOLEY_DOUBLE array cannot hold `undefined`, so spread and `Array.from` must first convert it to a tagged kind.
- Example:
  ```js
  // Before
  const xs = new Array(n); for (let i = 0; i < n; i++) xs[i] = f(i);  // HOLEY forever
  // After
  const ys = Array.from({ length: n }, (_, i) => f(i));               // PACKED
  const counts = new Array(bins).fill(0);                              // PACKED_SMI in Chrome 135+
  ```
- Avoid/caveats: Do not rewrite working code only for this; measure first (packed 275 ms vs holey 296 ms on a 100k-double sum loop). A partial fill, or an array with extra named properties, stays HOLEY. Older engines keep the fill result HOLEY (harmless). A typed array is still better for numeric buffers.
- Status: Fill exception: V8 commit 785a0f64 (2025-02-28), Chrome 135+; the elements-kinds post was updated on 2025-02-28 to note it.
- Sources: https://v8.dev/blog/elements-kinds ; https://chromium-review.googlesource.com/c/v8/v8/+/6285929 ; https://v8.dev/blog/spread-elements

### Never use arrays as sparse maps, and never give array indices non-default attributes
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory
- When: long-lived session
- Impact: medium, because dictionary elements make every indexed access a hash lookup and slow down all array built-ins.
- Do: Use a `Map` (or a typed array plus an offset) for sparse integer keys such as bar index → annotation. Do not write `arr[bigIndex] = v` into a short array. Do not call `Object.defineProperty(arr, i, …)` with non-default attributes; use `Object.freeze(arr)` or encapsulation for read-only data.
- Why: For large gaps V8 switches the backing store to dictionary elements to save memory (local test, V8 13.6: index 1023 into an empty array gave HOLEY_SMI, index 1025 or more gave DICTIONARY). Engines do not store per-element attributes, so one index with non-default attributes forces the whole store into a dictionary of index → attributes. `Object.freeze`/`seal`/`preventExtensions` use dedicated frozen/sealed kinds instead.
- Example:
  ```js
  // Before: const byBar = []; byBar[barIndex] = note;   // barIndex ~ 50_000
  const byBar = new Map(); byBar.set(barIndex, note);
  ```
- Avoid/caveats: The 1024 gap is an internal constant; treat it as "any large gap".
- Status: Verified on V8 13.6 (2026-09, batch 01).
- Sources: https://v8.dev/blog/fast-properties ; https://mathiasbynens.be/notes/shapes-ics

### Never read past the end of an array: loop with `i < length`
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, TBT
- When: animation/render-loop
- Impact: high for hot loops: an out-of-bounds load walks the prototype chain, keeps the load site in a slower mode, and the `undefined` it returns taints the math that follows.
- Do: Write the bound as `i < arr.length`, or use `for…of` or `forEach`. Never write `(x = a[i]) != null` as a loop condition, and guard `a[i + 1]` at the last element.
- Why: When the bounds check fails and the element is absent, V8 must check the prototype chain, and the load must handle that case from then on. The post measured 6x from one extra iteration over 10,000 elements; a local re-test on V8 13.6 gave 67 ms (`<`) vs 174 ms (`<=`).
- Example:
  ```js
  // Before: for (let i = 0; i <= pts.length; i++) if (pts[i] > max) max = pts[i];
  for (let i = 0; i < pts.length; i++) if (pts[i] > max) max = pts[i];
  for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);  // pairwise without overrun
  ```
- Avoid/caveats: Typed-array loops have the same bug pattern (they return `undefined` out of bounds). The post notes that `for…of` and `forEach` now perform about like a classic `for` loop.
- Status: Still valid on V8 13.6 (smaller factor than in 2017).
- Sources: https://v8.dev/blog/elements-kinds

### Use real arrays and rest parameters instead of `arguments` and array-likes
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: long-lived session
- Impact: low to medium, because array built-ins called with `.call` on array-likes miss the elements-kind fast paths.
- Do: Replace `arguments` with `...args`. If you call array methods more than once on a `NodeList` or other array-like, convert it once with `Array.from(x)`. Do not build your own array-like objects.
- Why: `Array.prototype.forEach.call(arrayLike, …)` works but misses specialized code. Local test, V8 13.6: `Array.prototype.slice.call(arrayLike)` gives a HOLEY array, `Array.from(arrayLike)` a PACKED one.
- Example:
  ```js
  // Before: function log() { Array.prototype.forEach.call(arguments, write); }
  const log = (...parts) => parts.forEach(write);
  const rows = Array.from(document.querySelectorAll('tr'));
  ```
- Avoid/caveats: For a single pass, iterate the array-like directly with `for…of`; no copy is needed.
- Status: Rest parameters and `Array.from` Baseline widely available (ES2015).
- Sources: https://v8.dev/blog/elements-kinds

### Store bulk numeric series in typed-array columns (struct of arrays), not arrays of objects
- Layer: v8
- Stage: script-run, gc-memory, gpu-upload
- Metrics: memory, FPS/smoothness
- When: long-lived session | animation/render-loop
- Impact: high for chart data: it removes per-value boxes and per-object headers, gives the GC nothing to trace inside, cannot change elements kind, and is already the layout that WebGL/WebGPU uploads need.
- Do: Keep time, open, high, low, close and volume as separate `Float64Array`s (or `Float32Array` when precision allows) with one shared length and capacity. Grow by doubling the capacity and copying with `set()`. Keep objects for low-count entities (series, axes, drawings).
- Why: Since pointer compression (Chrome 80), a tagged slot is 32 bits, so a double in an object field is a pointer to a separate HeapNumber box (double-field unboxing is gone, and the flag no longer exists). A typed array stores raw 8-byte values in a contiguous backing store outside the pointer-compression cage, and the GC has no pointers to follow inside it. Local memory test (Node 24, no pointer compression, 1M values): PACKED_DOUBLE array +10 MB, generic array of doubles +25.6 MB, Float64Array 7.6 MB, 1M `{t, p}` objects +78 MB, two Float64Arrays 15.3 MB.
- Example:
  ```js
  // Before: bars.push({ t, o, h, l, c });   // 1 object + boxed doubles per bar
  const cols = { t: new Float64Array(cap), c: new Float64Array(cap) }; let len = 0;
  function append(t, c) { if (len === cap) grow(); cols.t[len] = t; cols.c[len] = c; len++; }
  ```
- Avoid/caveats: A plain sum loop was not faster on Float64Array than on a PACKED_DOUBLE array (314 ms vs 275 ms locally); the gains are memory, GC, type stability and zero-copy upload. SciChart.js keeps series data in Wasm memory, which already follows this rule; do not copy that data back into JS objects.
- Status: Typed arrays Baseline widely available (2015). `unbox_double_fields` absent from V8 `main` 2026-09-23 (batch 02).
- Sources: https://v8.dev/blog/pointer-compression ; https://v8.dev/blog/trash-talk ; https://v8.dev/blog/elements-kinds ; https://github.com/v8/v8/blob/main/src/objects/js-objects-inl.h

### Freeze constant lookup arrays freely, but never freeze numeric arrays
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: memory, FPS/smoothness
- When: long-lived session
- Impact: medium, because freezing a double array boxes every element.
- Do: Use `Object.freeze` on config and enum-like arrays. Keep numeric series in typed arrays and protect them with module encapsulation, not freezing.
- Why: Since V8 7.6, frozen, sealed and non-extensible arrays keep fast elements kinds (and `indexOf`, `includes`, spread stay fast). But only object-kind frozen/sealed kinds exist, so freezing a PACKED_SMI or PACKED_DOUBLE array first moves it to PACKED_ELEMENTS, and raw doubles become boxed HeapNumbers. A non-empty typed array cannot be frozen at all (TypeError).
- Example:
  ```js
  const SIDES = Object.freeze(['buy', 'sell']);               // fine
  const closes = Object.freeze([101.2, 101.9]);               // Before: boxed doubles
  const closesF64 = Float64Array.from([101.2, 101.9]);        // After: raw doubles
  ```
- Avoid/caveats: The old reason to avoid `Object.freeze` (the React Smi → Double cliff) was fixed in V8 7.4; freezing is not a speed-up by itself either.
- Status: Chrome 76+ for fast frozen arrays; boxing on freeze checked in V8 `main` `js-objects.cc` 2026-09-23 (batch 04).
- Sources: https://v8.dev/blog/v8-release-76 ; https://github.com/v8/v8/blob/main/src/objects/js-objects.cc ; https://v8.dev/blog/react-cliff

### Decode and encode mixed-type binary data with `DataView`, and always pass `littleEndian`
- Layer: v8
- Stage: script-run, gpu-upload
- Metrics: FPS/smoothness, startup
- When: long-lived session | animation/render-loop
- Impact: medium: DataView is close to TypedArray speed and up to 3x faster than byte-assembly shims, and the default big-endian order is both a byte swap and a common bug.
- Do: Use `DataView` getters and setters for network frames, file formats and interleaved vertex records, and remove old `Uint8Array` shift-and-or shims. Pass `true` as the last argument for little-endian data (WebGL/WebGPU buffers, Wasm memory, most binary protocols). Keep multi-byte fields aligned where the format allows.
- Why: V8 6.9 moved DataView methods from C++ runtime calls to Torque/CSA builtins that TurboFan inlines, which made them about 16x faster. Near-TypedArray speed holds for aligned access in native byte order; the other order needs byte reassembly.
- Example:
  ```js
  // Before: const u32 = b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] << 24);
  const u32 = view.getUint32(o, true);
  view.setFloat32(off, x, true); view.setFloat32(off + 4, y, true); view.setUint32(off + 8, rgba, true);
  ```
- Avoid/caveats: For homogeneous numeric arrays, a TypedArray is simpler. For half-float GPU data, `Float16Array` and `getFloat16`/`setFloat16` exist.
- Status: DataView Baseline widely available (2015). `Float16Array`/`getFloat16` Baseline newly available since 2025-04-04 (Chrome 135, Firefox 129, Safari 18.2).
- Sources: https://v8.dev/blog/dataview ; https://cdn.jsdelivr.net/npm/web-features/data.json

### In hot decode loops, check bounds yourself and call fixed DataView methods
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: animation/render-loop | long-lived session
- Impact: medium, because a throw or a variable call target leaves the inlined fast code.
- Do: Compare `offset + size` with `view.byteLength` before each read instead of catching `RangeError`. Keep offsets as small integers. Call `view.getFloat32(…)` directly; do not pick the method at run time (`view['get' + type]`); generate one reader per record layout.
- Why: Optimized DataView code does not handle error cases: an access that would throw deoptimizes to the baseline builtin. It supports only Smi-range offsets (31-bit in Chrome, about ±1 GiB). The speed-up depends on TurboFan seeing one known builtin at the call site.
- Example:
  ```js
  // Before: try { for (;;) { read(view, o); o += 16; } } catch { /* end */ }
  while (o + 16 <= view.byteLength) { read(view, o); o += 16; }
  const readTick = (v, o) => { tick.t = v.getFloat64(o, true); tick.p = v.getFloat32(o + 8, true); };
  ```
- Avoid/caveats: Derived from the inlining mechanism; not relevant for cold code.
- Status: V8 behavior (2018 post); Smi width per the 2025 mutable-heap-number post.
- Sources: https://v8.dev/blog/dataview ; https://v8.dev/blog/mutable-heap-number

### Grow CPU-side binary buffers with a resizable `ArrayBuffer`, and hand them over with a same-length `transfer()`
- Layer: js
- Stage: script-run, gc-memory
- Metrics: memory, FPS/smoothness
- When: long-lived session | animation/render-loop
- Impact: medium: growing a 256 MB buffer by copy took about 41 ms, an in-place `resize()` under 1 ms (measured, Chrome 152).
- Do: For a CPU-side store that grows (tick history, decoded frames), allocate `new ArrayBuffer(initial, { maxByteLength })`, grow it with `resize()`, and read it through length-tracking views (no length argument). To give a buffer to another owner without a copy, use `buffer.transfer()` with no new length, `transferToFixedLength()`, or a `postMessage` transfer list.
- Why: V8 reserves address space for `maxByteLength` and commits pages only up to the current length; `resize()` commits or decommits in place, so data does not move. `transfer()` reuses the backing store only when neither source nor result is resizable and the length is unchanged; otherwise V8 allocates and copies.
- Example:
  ```js
  const store = new ArrayBuffer(1 << 20, { maxByteLength: 512 << 20 });
  const closes = new Float64Array(store);   // length-tracking view
  function ensureCapacity(count) {
    const need = count * 8;
    if (need > store.byteLength) store.resize(Math.min(store.maxByteLength, Math.max(need, store.byteLength * 2)));
  }
  ```
- Avoid/caveats: `maxByteLength` reserves virtual address space; keep it realistic. `transfer(newLength)` is not cheaper than allocate-and-copy. Transfer detaches the source (old views read length 0). WebGL and WebGPU reject views over resizable buffers (next rule).
- Status: Resizable buffers Baseline newly available since 2024-07-09 (Chrome 111, Firefox 128, Safari 16.4). `transfer()`/`transferToFixedLength()` Baseline widely available since 2026-09-05.
- Sources: https://v8.dev/blog/holiday-season-2023 ; https://github.com/v8/v8/blob/main/src/builtins/builtins-arraybuffer.cc ; https://api.webstatus.dev/v1/features/resizable-buffers ; https://api.webstatus.dev/v1/features/transferable-arraybuffer

### Never pass views over resizable buffers to WebGL or WebGPU uploads; stage GPU data in fixed-length buffers
- Layer: gpu
- Stage: gpu-upload
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: high, because the upload call throws `TypeError` and the frame does not draw.
- Do: Keep vertex and uniform staging data in fixed-length buffers grown by capacity doubling. If data lives in a resizable buffer (including Wasm memory after `toResizableBuffer()`), copy the range into one reused fixed-length staging buffer before `bufferData`, `bufferSubData` or `queue.writeBuffer`.
- Why: WebIDL throws `TypeError` when a view on a non-fixed-length buffer reaches an IDL type without `[AllowResizable]`, and WebGL 1/2 and WebGPU do not use that attribute. Measured in Chrome 152: `bufferData`, `bufferSubData` (also with `subarray`) and `writeBuffer` all threw. Emscripten reverted its `GROWABLE_ARRAYBUFFERS` default to 0 in 6.0.3 for this reason.
- Example:
  ```js
  let staging = new Float32Array(4096);
  function upload(src /* Float32Array on a resizable store */) {
    if (src.length > staging.length) staging = new Float32Array(Math.max(src.length, staging.length * 2));
    staging.set(src);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, staging, 0, src.length);
  }
  ```
- Avoid/caveats: `slice()` also makes a fixed-length copy but allocates per call. SharedArrayBuffer-backed views are allowed (`[AllowShared]`); resizable ones are not.
- Status: Spec behavior (WebIDL, WebGL IDL, WebGPU), measured in Chrome 152; not tested in Firefox or Safari.
- Sources: https://webidl.spec.whatwg.org/#js-buffer-source-types ; https://registry.khronos.org/webgl/specs/latest/2.0/webgl2.idl ; https://gpuweb.github.io/gpuweb/ ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/ChangeLog.md

---

## 3. Numbers (Smi, HeapNumber, doubles, BigInt)

### Keep hot integers inside the 31-bit Smi range; store large values in typed arrays or as offsets
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory, TBT
- When: animation/render-loop | long-lived session
- Impact: medium: integer ops (especially `%` and indexing) run as fast integer code, while fractions and out-of-range integers are HeapNumbers when stored in object fields or tagged arrays.
- Do: Use integer loop counters that start at 0 and derive fractional values from them. Keep counters, indices and ids in hot code between -1,073,741,824 and 1,073,741,823. Store epoch milliseconds (about 1.8e12), epoch seconds (about 1.79e9) and 32-bit hashes in typed arrays, or as offsets from a base value.
- Why: With pointer compression (Chrome 64-bit desktop and Android since Chrome 80), a tagged value is 32 bits and one bit marks Smi vs pointer, so a Smi has a 31-bit payload. Everything else (`-0`, `NaN`, `±Infinity`, fractions, larger integers) is a HeapNumber. The react-cliff post shows a `let i = 0.1` loop about 2x slower than an integer loop, and integer modulo has fast paths (especially for power-of-two divisors).
- Example:
  ```js
  // Before: for (let x = x0 + 0.5; x < x1; x += 1) draw(x);
  for (let i = 0, n = x1 - x0; i < n; i++) draw(x0 + i + 0.5);
  const tRel = epochSec - sessionStartSec;  // fits a Smi; the absolute value does not
  ```
- Avoid/caveats: Do not force integer math onto real-valued data (prices); store those as doubles, ideally in a `Float64Array`. Doubles in PACKED_DOUBLE arrays are stored unboxed. Node builds without pointer compression use 32-bit Smis; the Chrome limit is the one that matters in the browser.
- Status: V8 only. `kSmiValueSize = 31` for compressed builds in `include/v8-internal.h` (V8 `main` 2026-09-23).
- Sources: https://v8.dev/blog/mutable-heap-number ; https://v8.dev/blog/pointer-compression ; https://v8.dev/blog/react-cliff ; https://github.com/v8/v8/blob/main/include/v8-internal.h

### Initialize numeric fields with a number of their final kind (`NaN` for doubles), never with `null` or `undefined`
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop | long-lived session
- Impact: high for hot numeric objects: a Tagged field allocates a new HeapNumber on every non-Smi write (locally about 5x slower plus constant scavenges).
- Do: Give fields that will hold prices, timestamps or pixel offsets a double initial value (`NaN` or a real double). Give integer fields `0`. Never initialize numeric fields with `null`, `undefined`, `''` or an object, and never store another type into them later.
- Why: V8 records a representation per field on the map: Smi, Double, HeapObject or Tagged. A Double field holds a mutable box that V8 updates in place. A Tagged field must point to an immutable HeapNumber, so each new double allocates. Smi → Double creates a new map, deprecates the old one and migrates other objects lazily; optimized code that assumed the old representation deoptimizes. Local benchmark (5e7 writes of `o.v = o.v + 0.25`): fields that started as a double or a Smi took 33 ms with 0 scavenges; fields that started as `null`, `undefined` or a string took 155-172 ms with 1,145 scavenges.
- Example:
  ```js
  // Before
  class Viewport { constructor() { this.min = null; this.max = null; } }
  // After: Double representation from the start
  class Viewport2 { constructor() { this.min = NaN; this.max = NaN; } }
  ```
- Avoid/caveats: A `0` start is acceptable: it moves to Double once on the first fractional write, at the cost of one map deprecation per shape; `NaN` skips even that (React's fix). Object-typed fields can start as `null` without harm.
- Status: V8 only. Still present in V8 13.6 (batch 01); the 2025 mutable-heap-number post confirms that object double fields use mutable HeapNumber boxes.
- Sources: https://v8.dev/blog/mutable-heap-number ; https://v8.dev/blog/pointer-compression ; https://v8.dev/blog/react-cliff

### In TypeScript, never leave numeric class fields uninitialized when `useDefineForClassFields` is on
- Layer: build
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory
- When: build | animation/render-loop
- Impact: high for hot numeric objects: `x!: number;` emits a field that starts as `undefined`, which makes it Tagged (local benchmark 178 ms vs 35 ms).
- Do: Write `x = 0` or `x = NaN` in the class body, or assign only in the constructor and declare the field with `declare x: number;` so that no field definition is emitted. Avoid `x!: number;` and plain `x: number;` on hot numeric fields.
- Why: With `useDefineForClassFields` (default `true` for `target` ES2022 and later, including ESNext) TypeScript emits native class fields, which are defined as `undefined` first. The field's first representation is then Tagged before the constructor writes the number (previous rule). The same applies to plain JS class fields written as `x;`.
- Example:
  ```ts
  class Candle {
    open = NaN;               // Double from the start (before: open!: number;)
    declare close: number;    // no emitted field; assigned below
    constructor(c: number) { this.close = c; }
  }
  ```
- Avoid/caveats: Only objects written often with non-Smi numbers need this. Object-typed fields that start as `undefined` are harmless.
- Status: Measured on V8 13.6 (2026-09). TS default per the TSConfig reference.
- Sources: https://www.typescriptlang.org/tsconfig/#useDefineForClassFields ; https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html ; https://v8.dev/blog/react-cliff

### Keep numeric variables type-stable: accumulators, top-level `let` bindings and return values
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop | long-lived session
- Impact: medium: stable types let optimized code keep numbers unboxed in registers and update script-scope number slots in place; a type change deoptimizes every function that depends on the slot.
- Do: Initialize accumulators and loop variables with a number (`let hi = -Infinity`, not `let hi` or `let max = null`). A `let` that holds a number must only ever hold numbers; use `NaN` or `-1` sentinels plus a separate boolean flag. Return `NaN`, not `undefined`, from numeric functions for "no value".
- Why: Maglev and TurboFan choose a representation per value from feedback and can keep doubles in FP registers; at control-flow merges (phis) the representation must fit all inputs, and a non-number input forces tagged values and boxing. Since the 2025 mutable-heap-number work, V8 tracks a type per script-context slot (constant, Smi, Int32, double or "other") and updates number slots in place without allocation. Optimized code depends on that slot type; writing another type deoptimizes it, and "other" is a sink state with no way back.
- Example:
  ```js
  // Before
  let lastPrice = undefined;  let hi;
  for (const p of prices) if (hi === undefined || p > hi) hi = p;
  // After
  let lastPrice = NaN; let hasLastPrice = false;
  let hi2 = -Infinity; for (let i = 0; i < prices.length; i++) if (prices[i] > hi2) hi2 = prices[i];
  ```
- Avoid/caveats: The script-context gain covers top-level `let` of classic scripts; function contexts get it only when they have at most 2 slots (`function_context_cells_max_size = 2`). ES module scope was not verified. The gain appears only in optimized code. Do not restructure code for it; just avoid type changes.
- Status: V8 only. Script-context mutable heap numbers enabled in V8 `main` 2024-11-25 and Int32 slots 2025-01-09 (about Chrome 133 and 134, estimated from commit dates); `function_context_cells` 2025-05-20 (about Chrome 138, estimate). Maglev untagged phis on by default (V8 `main` 2026-09-23).
- Sources: https://v8.dev/blog/mutable-heap-number ; https://v8.dev/blog/maglev ; https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h

### Keep integer state in signed Int32 with `| 0` and `Math.imul`; use `>>> 0` only on temporaries
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low: it matters for hash, PRNG, index and bit-packing code on hot paths.
- Do: Normalize integer math with `| 0` or `& mask` so stored values stay signed 32-bit. Do not store `x >>> 0` back into state, because results at or above 2^31 leave Int32 and turn the slot into a double.
- Why: A slot that receives only Int32 values stores a raw Int32 inside its mutable HeapNumber, and optimized code uses integer instructions. The post's PRNG got about 2.5x faster on async-fs because bit masks kept `seed` in Int32.
- Example:
  ```js
  let seed = 12345;
  function rand() {
    seed = (seed + 0x6d2b79f5) | 0;                       // stays Int32
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;         // unsigned only in the returned temp
  }
  ```
- Avoid/caveats: Bitwise operators truncate to 32 bits; never use them on prices, timestamps or other values that need more.
- Status: V8 (Int32 slots enabled 2025-01-09 in `main`, about Chrome 134, estimate).
- Sources: https://v8.dev/blog/mutable-heap-number

### Use Number for prices, sizes and millisecond timestamps; use BigInt only for true 64-bit integers and convert at the boundary
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop | interaction | long-lived session
- Impact: medium to high in numeric loops: summing 1e6 small BigInts was 3x slower than Numbers, and a loop with a BigInt counter plus `BigInt(n)` per iteration was 34x slower (V8 13.6).
- Do: Keep chart math in Numbers (float64): millisecond timestamps and prices are exact below 2^53. Use BigInt only for values that need more than 53 bits (64-bit sequence numbers, nanosecond clocks, 64-bit ids), and convert them to Number or string once, when you decode them.
- Why: A BigInt is a heap object with a sign and 64-bit digits. In unoptimized code every arithmetic result allocates a new BigInt; multiplication and division use schoolbook algorithms; bitwise ops on negative BigInts convert to two's complement and back.
- Example:
  ```js
  // Before
  let volume = 0n; for (const t of trades) volume += BigInt(t.size);
  // After
  let volume2 = 0; for (const t of trades) volume2 += t.size;
  ```
- Avoid/caveats: Mixing BigInt and Number in one expression throws a TypeError. `JSON.stringify` throws on BigInt. Number loses precision above 2^53.
- Status: BigInt Baseline widely available (webstatus high 2023-03-16).
- Sources: https://v8.dev/blog/bigint ; https://webstatus.dev/features/bigint

### When BigInt is required in hot code, keep values in the 64-bit range with `BigInt64Array` and `BigInt.asIntN/asUintN(64, …)`
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop | long-lived session
- Impact: medium: optimized code keeps 64-bit BigInts in registers instead of allocating per operation (V8 13.6: `BigInt64Array` sum 1.34 ms vs plain BigInt array 1.73 ms vs `Float64Array` 0.53 ms, 1e6 elements).
- Do: Store 64-bit integer columns in `BigInt64Array`/`BigUint64Array`. Keep each hot operation's values within the signed or unsigned 64-bit range, and wrap results with `BigInt.asUintN(64, x)` when wraparound is acceptable. Do not send huge BigInts through the same code sites.
- Why: Since Chrome 108, TurboFan collects "BigInt64" feedback and lowers add, subtract, multiply, divide, modulus, bitwise ops, shifts, negate and compares to checked 64-bit machine ops, deoptimizing on overflow. Since Chrome 111, loads and stores on BigInt64 arrays stay 64-bit without allocation. In June 2026 Maglev also got BigInt specializations.
- Example:
  ```js
  const seq = new BigUint64Array(n);
  let h = 0n;
  for (let i = 0; i < n; i++) h = BigInt.asUintN(64, h * 31n + seq[i]);  // stays 64-bit when optimized
  ```
- Avoid/caveats: One out-of-range value at a site loses the speculation (deopt, then generic code). Interpreted and baseline code still allocate.
- Status: TurboFan BigInt64 (commits fced4e9e35, 2022-09-29 and b53f4d8247, 2022-12-16); Maglev (ae67ffb8a7, 2026-06-16). `BigInt64Array` Baseline widely available (2024-03-20).
- Sources: https://github.com/v8/v8/commit/ae67ffb8a7 ; https://github.com/v8/v8/commit/b53f4d8247 ; https://github.com/v8/v8/commit/fced4e9e35 ; https://v8.dev/blog/bigint

### Decode 64-bit wire fields that fit in 53 bits as two `getUint32` reads, not `getBigUint64` plus `Number()`
- Layer: js
- Stage: script-run, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: interaction | long-lived session
- Impact: medium for high-rate binary feeds: 12x faster locally (0.79 ms vs 9.8 ms per 1e6 fields) and no temporary BigInt.
- Do: For a u64 field that stays below 2^53 (millisecond timestamps, most trade ids), compute `hi * 2 ** 32 + lo` from two `getUint32` calls. If you control the protocol, send float64 or u32 for values that the chart uses as Numbers. Keep `getBigInt64` for fields that can exceed 2^53.
- Why: `getBigUint64` returns a BigInt, so code that is not fully optimized allocates a heap BigInt per read, and `Number()` converts it again. Two `getUint32` reads return Smis or doubles that stay in registers.
- Example:
  ```js
  // Before: const ts = Number(view.getBigUint64(off, true));
  const ts = view.getUint32(off + 4, true) * 2 ** 32 + view.getUint32(off, true);
  ```
- Avoid/caveats: Values above 2^53 lose precision silently; add a debug assertion `hi < 0x200000` when the range is not guaranteed.
- Status: DataView BigInt methods Baseline widely available; measured on V8 13.6.
- Sources: https://v8.dev/blog/bigint

---

## 4. Strings

### Create each `Intl` formatter once per (locale, options) and reuse it; never pass options to `toLocaleString` in hot code
- Layer: js
- Stage: script-run, main-thread-task
- Metrics: INP, FPS/smoothness, TBT
- When: animation/render-loop | interaction | long-lived session
- Impact: high for tickers, axes, tooltips and order-book cells: a per-call formatter with options was about 50x slower than a reused one (local, 100k calls).
- Do: Keep module-level (or per-locale cached) `Intl.NumberFormat`, `Intl.DateTimeFormat` and `Intl.Collator` instances and call `.format()`, `.formatToParts()`, `.formatRange()` or `.compare`. Format BigInt values with the same `NumberFormat`. Rebuild the cache when locale, time zone or precision changes.
- Why: Creating an Intl object means ICU locale resolution and formatter setup. `Number/BigInt.prototype.toLocaleString`, `Date.prototype.toLocale*String` and `String.prototype.localeCompare` build a full ICU object per call. V8 caches one instance per kind only when `locales` is a string or `undefined` AND `options` is `undefined`, and each kind keeps only the most recently used locale, so alternating locales also miss. Local numbers: `toLocaleString('en-US', opts)` 1,130 ms vs reused `format` 24 ms; `toLocaleTimeString` with options 2,149 ms vs reused `DateTimeFormat` 42 ms.
- Example:
  ```js
  const PRICE = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Before: cell.textContent = price.toLocaleString('en-US', { minimumFractionDigits: 2 });
  cell.textContent = PRICE.format(price);
  ```
- Avoid/caveats: Formatters hold ICU memory; share one per distinct option set instead of one per chart instance.
- Status: `NumberFormat`, `DateTimeFormat`, `Collator` Baseline widely available. `formatRange` Chrome 76, Firefox 91, Safari 14.1. Cache rule verified in V8 `main` `intl-objects.cc` and `isolate.cc` (2026-09-23).
- Sources: https://github.com/v8/v8/blob/main/src/objects/intl-objects.cc ; https://v8.dev/blog/v8-release-76 ; https://v8.dev/blog/intl

### Sort strings with option-free `localeCompare` or with one reused `Intl.Collator`
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT
- When: interaction
- Impact: low to medium: it decides whether a cached collator and an ASCII fast path run for large sorts (2k strings: 33 ms with `localeCompare` plus options vs 2 ms with a reused `Collator`).
- Do: For plain sorts, write `a.localeCompare(b)` or `a.localeCompare(b, 'en')` with no options. When you need options (`numeric`, `sensitivity`), create one `Intl.Collator` and pass `collator.compare` to `sort`. Never call `localeCompare(b, loc, opts)` inside a comparator.
- Why: Option-free `localeCompare` uses the cached default collator and, for locales on a fixed list (en, en-US, en-GB, de, fr, es, it, nl, pl, pt, sv, fi and others), tries an ASCII weight-table fast path. `Intl.Collator.prototype.compare` runs without that fast path but reuses its collator. `localeCompare` with options builds a new collator per call.
- Example:
  ```js
  const byNumeric = new Intl.Collator('en', { numeric: true });
  symbols.sort(byNumeric.compare);                  // options: one reused collator
  names.sort((a, b) => a.localeCompare(b, 'en'));   // no options: cached, ASCII fast path
  ```
- Avoid/caveats: The relative speed of the two good paths was not benchmarked. Non-ASCII strings leave the fast path at the first such character.
- Status: V8 `main` 2026-09-23 (`CompareStringsOptionsFor`, `kFastLocales`, `CollatorInternalCompare`).
- Sources: https://github.com/v8/v8/blob/main/src/objects/intl-objects.cc ; https://github.com/v8/v8/blob/main/src/builtins/builtins-intl.cc ; https://v8.dev/blog/v8-release-76

### Use built-in `Intl` APIs instead of shipping formatting libraries and locale data
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, startup
- When: build
- Impact: medium, because number, date, relative-time, list, plural and segmenter logic plus CLDR data stay out of the bundle.
- Do: Before you add a date or number formatting library, use `Intl.NumberFormat` (units, compact notation, currency, sign display), `Intl.DateTimeFormat` (`dateStyle`/`timeStyle`, `formatRange`), `Intl.RelativeTimeFormat`, `Intl.ListFormat`, `Intl.PluralRules` and `Intl.Segmenter`.
- Why: The browser does the work with its own ICU, so the page ships less code and data. V8 moved Intl into C++ builtins, which removed runtime-call overhead.
- Example: `new Intl.NumberFormat('en', { notation: 'compact' }).format(1_250_000) // "1.3M"`
- Avoid/caveats: Check each option against your browser matrix. Output strings and time-zone data can differ slightly between engines, so snapshot tests can differ by browser.
- Status: Most listed APIs are Baseline; per-API status was not re-verified in the V8 batches (check webstatus.dev).
- Sources: https://v8.dev/blog/intl ; https://v8.dev/features/intl-numberformat

### Keep machine-generated strings (keys, ids, protocol fields) ASCII or Latin-1
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: memory, INP
- When: long-lived session | interaction
- Impact: low: two-byte strings double string memory, and one of them switches a whole `JSON.stringify` result to a two-byte buffer.
- Do: Use ASCII for object keys, enum values, ids and protocol strings that you generate. Leave user-visible text as it is.
- Why: V8 stores strings with only characters up to U+00FF as one byte per character and all other strings as two bytes. JSON.stringify writes to a one-byte buffer until the first character above U+00FF, then switches the rest of the output to two bytes. The scanner also buffers literals as Latin-1 and converts to UTF-16 at the first wider character. Object keys also need no escaping (`"`, `\`, control characters) to use the fast JSON key copy (section 10).
- Example: `{ side: 'buy' }` rather than `{ side: '↑' }` for a value that only code reads.
- Avoid/caveats: Do not rewrite user text or translations for this. The JSON.stringify detail is V8 13.8+ (Chrome 138+).
- Status: V8 behavior per the 2025 JSON post and the 2019 scanner post.
- Sources: https://v8.dev/blog/json-stringify ; https://v8.dev/blog/scanner

---

## 5. Functions, closures and classes

### Declare instance state as native class fields and compile TypeScript to ES2022 or later
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, startup
- When: load | animation/render-loop
- Impact: medium: field initialization was a runtime call per field before V8 9.7 and now uses inline caches like normal stores.
- Do: Declare state as class fields (`x = 0;`, `#cache = null;`). Set TypeScript `target` to ES2022 or later so fields reach V8 as native fields.
- Why: V8 9.7 routes named public fields through `DefineNamedOwnIC` and private or computed fields through `DefineKeyedOwnIC`, with feedback that records the key and the map transition, so repeated construction runs pre-generated fast code. Private methods are stored once per class; each instance holds only a "brand".
- Example:
  ```ts
  class Series {
    #points: Float64Array;
    visible = true;
    constructor(n: number) { this.#points = new Float64Array(n); }
  }
  ```
- Avoid/caveats: Fields use define semantics and do not call inherited setters. With `useDefineForClassFields: true` and an older target, TypeScript emits `Object.defineProperty` calls, which do not use the native path. For numeric fields, see section 3 (initialize with a number).
- Status: V8 9.7 / Chrome 97+. Public fields Baseline widely available (since 2022-09-12), private fields and methods earlier.
- Sources: https://v8.dev/blog/faster-class-features ; https://cdn.jsdelivr.net/npm/web-features/data.json

### Keep instance initialization predictable: one owner per field, no proxy or return override from a base constructor
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: animation/render-loop | load
- Impact: medium, because each unpredictable construction falls back to a runtime call.
- Do: Construct hot types the same way every time. Do not return a different object or a `Proxy` from a base-class constructor. Do not let a base constructor create a property that a subclass also declares as a field.
- Why: The field IC fast path needs fields defined in the same order on objects with the same map. V8 falls back to the runtime when the target is a proxy, when the field already exists on the object, or when the map is new to the IC.
- Example:
  ```ts
  // Before: subclass re-defines a property the base already created -> runtime path
  class Base { color = 'red'; }  class Line extends Base { color = 'blue'; }
  // After: one owner per field
  class Base2 { color: string; constructor(c = 'red') { this.color = c; } }
  class Line2 extends Base2 { constructor() { super('blue'); } }
  ```
- Avoid/caveats: The return-override trick is rare; keep it out of hot types.
- Status: V8 9.7+.
- Sources: https://v8.dev/blog/faster-class-features

### Call `super()` directly in the constructor of derived classes that have private methods
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low, because the slow case is rare.
- Do: In a derived class with `#methods` or `#accessors`, call `super()` in the constructor body, not from a nested arrow function.
- Why: After `super()` returns, V8 installs the private brand. A direct call uses a fast bytecode; a call from a nested arrow must walk the context chain in the runtime (`%AddPrivateBrand`).
- Example: `constructor(opts) { super(opts); }  // not: const s = () => super(opts); s();`
- Avoid/caveats: None.
- Status: V8 9.7+.
- Sources: https://v8.dev/blog/faster-class-features

### Use named `super.x` and `super.m()` freely; keep keyed super access and super writes out of hot code
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: interaction | animation/render-loop
- Impact: low to medium: named super loads are now cached, but `super[name]`, `super.x = v`, `super.x += 1` and `super.x++` are still a C++ runtime call each time.
- Do: Call parent methods with `super.method(…)`; do not rewrite them as `Parent.prototype.method.call(this, …)` for speed. In hot methods, replace keyed super access with a named call and super writes with `this` writes.
- Why: Since V8 9.0 (Chrome 90) `super.x` uses a `LoadSuperIC` that caches the shape of the home object's prototype, and TurboFan compiles it like a normal load (the interpreter still does two extra loads). In V8 `main`, keyed super loads, super stores and the load part of compound super operations still use runtime calls.
- Example:
  ```js
  class FibTool extends Tool { hitTest(p) { return super.hitTest(p) || this.levels.some(l => l.near(p)); } }
  // Before: class B extends A { bump() { super.count += 1; } }
  class B2 extends A { bump() { this.count += 1; } }  // same effect for an instance data property
  ```
- Avoid/caveats: `this.x = v` equals `super.x = v` only when no setter on the prototype chain intercepts the write.
- Status: V8 `main` 2026-09-23 (`super_ic = true`; runtime calls in `bytecode-generator.cc`).
- Sources: https://v8.dev/blog/fast-super ; https://github.com/v8/v8/blob/main/src/interpreter/bytecode-generator.cc

### Do not build hot class hierarchies from mixin factories
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: animation/render-loop
- Impact: low to medium: the `super.m()` site inside a mixin body sees a different home object for each generated class, so it goes megamorphic.
- Do: For hot paths, use a fixed class hierarchy or composition (a helper object that the class calls) instead of `A(B(C(Base)))` factories. Keep mixins for cold code.
- Why: Every factory call creates a new class that shares the same method source and feedback. The `LoadSuperIC` records one prototype shape per generated class and goes past the polymorphic limit (10 in Chrome 154+).
- Example:
  ```js
  // Before: const Selectable = B => class extends B { hit(p) { return super.hit(p) && this.enabled; } };
  class Line extends Base { constructor() { super(); this.sel = new Selection(this); } }  // composition
  ```
- Avoid/caveats: None beyond design effort.
- Status: V8 `main` 2026-09-23.
- Sources: https://v8.dev/blog/fast-super

### Pass only the arguments you have; do not pad calls to the declared parameter count
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: interaction | animation/render-loop
- Impact: low: since Chrome 89 a call with too few or too many arguments costs about the same as a matched call.
- Do: Use optional trailing parameters and defaults freely. Delete code that exists only to match argument counts (explicit `undefined`s, one wrapper per arity, `fn.length` dispatch). Spend the effort on stable call targets instead.
- Why: V8 8.9 removed the arguments adaptor frame: it pushes arguments in reverse order and stores the actual count in the callee frame, pads missing arguments with `undefined` in place, and pops extra ones in the epilogue. The post measured up to 40% faster mismatched calls in optimized code.
- Example:
  ```js
  function drawSeries(ctx, points, color = '#0af', width = 1) { /* … */ }
  drawSeries(ctx, points);   // before: drawSeries(ctx, points, undefined, undefined)
  ```
- Avoid/caveats: A default initializer runs on every call that omits the argument, so `opts = {}` allocates each time in a hot path; use a shared frozen default or pass the object.
- Status: V8 8.9 / Chrome 89+.
- Sources: https://v8.dev/blog/adaptor-frame

### Keep hot-loop variables local and create closures outside hot loops
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: low: optimizing tiers handle context loads well, but captured variables live in heap contexts and may keep TDZ checks.
- Do: Keep counters and accumulators in plain locals in hot functions. Create callbacks outside hot loops. When a hot closure reads a module-level `let`, pass the value as a parameter or copy it into a local once per frame.
- Why: A variable that an inner function references cannot live on the stack; V8 puts it in a heap "context" object, and each access is a memory load or store. The context stays alive while any closure that uses it lives. A closure that reads an outer `let`/`const`/`class` binding can keep a TDZ hole check that V8 cannot remove.
- Example:
  ```js
  // Before: sum is captured by the callback -> heap context
  let sum = 0; data.forEach(v => { sum += v; });
  // After
  let s = 0; for (let i = 0; i < data.length; i++) s += data[i];
  ```
- Avoid/caveats: Derived from the mechanism, not a measured rule; measure before you rewrite readable code.
- Status: V8 mechanism (preparser post 2019, holiday post 2023).
- Sources: https://v8.dev/blog/preparser ; https://v8.dev/blog/holiday-season-2023

### Write `let` and `const`; do not hand-convert declarations to `var` for speed
- Layer: js
- Stage: script-run
- Metrics: startup, TBT
- When: build
- Impact: low: V8 now removes TDZ checks that an earlier check in the same function covers.
- Do: Use `const` by default and `let` for reassigned bindings, and declare them before the functions that use them run. Do not add Babel's block-scoping transform or hand-edit to `var`.
- Why: A `let`, `const` or `class` binding throws if read before initialization, so V8 emits a hole check where it cannot prove initialization. In 2023 the TypeScript team measured 8-12% gains in parts of `tsc` from converting to `var`. V8 then started to elide TDZ checks dominated by other checks (`ignition_elide_redundant_tdz_checks = true`). Checks in closures that read outer bindings can remain. esbuild rewrites top-level `let`/`const`/`class` to `var` when it bundles.
- Example: see the previous rule (pass the module-level value into the hot function).
- Avoid/caveats: `var` changes semantics (hoisting, function scope) and can hide bugs.
- Status: V8 `main` 2026-09-23. The "10% slower than var" claim is mostly obsolete.
- Sources: https://v8.dev/blog/holiday-season-2023 ; https://groups.google.com/g/v8-reviews/c/drZ8jJcE5Xo ; https://esbuild.github.io/faq/#top-level-var

### Use `const` for values that never change, and do not reassign module-level state that hot code reads
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: long-lived session
- Impact: low to medium: a de-facto constant is embedded in machine code, and a later write deoptimizes that code.
- Do: Declare configuration, feature flags and lookup tables with `const`. Put mutable app state in object fields (for example `state.theme`), not in top-level `let` bindings that hot functions read. If a top-level `let` is set once at init, set it before hot code runs.
- Why: Maglev loads a global that has not changed since initialization at compile time and embeds its value with a dependency; a later write invalidates and deoptimizes that code. V8 also tracks script-context `let` bindings that were never modified as constants (`script_context_cells`, default on), with the same invalidation on the first write.
- Example:
  ```js
  const MAX_POINTS = 1_000_000;       // folded into optimized code
  let debugOverlay = false;           // treated as constant until the first write
  ```
- Avoid/caveats: A one-time change (for example at login) costs one deopt and is fine. Module-scope behavior was not verified separately.
- Status: Maglev post 2023; flags checked on V8 `main` 2026-09-23.
- Sources: https://v8.dev/blog/maglev ; https://v8.dev/blog/mutable-heap-number ; https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h

### Do not create Errors, throw for expected outcomes, or read `error.stack` on hot paths
- Layer: js
- Stage: script-run, script-compile, gc-memory
- Metrics: INP, TBT, memory
- When: interaction | long-lived session
- Impact: medium when it happens per tick, per message or per frame.
- Do: Return a result value (for example `null`) for expected failures such as a malformed market-data message. Do not call `new Error().stack` or `console.trace()` in tick, render or input handlers. Read `.stack` once, when you report an error. Use `try/catch/finally` wherever correctness needs it.
- Why: Creating an Error walks the stack (up to `Error.stackTraceLimit`, default 10 frames), and the string is formatted on the first `.stack` read. Since V8 7.8, bytecode has no source-position tables by default, so the first symbolization of each function in a trace must reparse and recompile it. `try/catch` itself has been optimizable since Chrome 59; throwing is the cost.
- Example:
  ```js
  // Before: function parseRow(s) { if (!s.includes(',')) throw new Error('bad row'); /* … */ }
  function parseRow(s) { if (!s.includes(',')) return null; /* … */ }
  ```
- Avoid/caveats: With DevTools open, V8 collects source positions eagerly, so costs differ; measure with DevTools closed. Never set `Error.stackTraceLimit = 0` globally.
- Status: Lazy source positions still default (`v8_enable_lazy_source_positions = true`, V8 `BUILD.gn` 2026-09-23). `Error.stackTraceLimit` is non-standard.
- Sources: https://v8.dev/blog/v8-release-78 ; https://v8.dev/docs/stack-trace-api ; https://v8.dev/blog/launching-ignition-and-turbofan

---

## 6. Async, promises and shared memory

### Write async code with `async`/`await` on native promises; no promise polyfills, subclasses or custom thenables
- Layer: js
- Stage: microtask, script-run
- Metrics: INP, TBT, bundle-size
- When: interaction | long-lived session
- Impact: low to medium: `await` on a native promise costs one microtask tick and no throwaway promise, and native async functions avoid large transpiled state machines.
- Do: Write async code with `async`/`await` and `try/catch` around awaits. Remove Promise polyfills and userland promise libraries (Bluebird, Q) from modern bundles. Do not subclass `Promise`, change `promise.constructor`, or make hot-path objects "thenable". Do not transpile async functions to ES5.
- Why: Since V8 7.2 (and the matching spec change), `await` uses `PromiseResolve`, which returns a native promise unchanged, so the wrapper promise and two extra ticks are gone. Any other value is wrapped in a new promise, and a thenable also needs a `PromiseResolveThenableJob` (an extra microtask). Zero-cost async stack traces (default since V8 7.3) add `at async fn` frames across `await` and `Promise.all`, not across `.then()`.
- Example:
  ```ts
  // Before
  function load(id) { return fetchQuote(id).then(q => enrich(q)).then(render); }
  // After
  async function load2(id) { render(await enrich(await fetchQuote(id))); }
  ```
- Avoid/caveats: `await 42` (a non-promise) still wraps the value and costs a tick.
- Status: ECMAScript semantics in all engines; async functions Baseline widely available (webstatus high 2019-10-05).
- Sources: https://v8.dev/blog/fast-async ; https://api.webstatus.dev/v1/features/async-await

### Write `return await p` in async functions when latency or ordering matters
- Layer: js
- Stage: microtask
- Metrics: INP
- When: interaction
- Impact: low: it saves one microtask tick per call, which adds up in deep async call chains.
- Do: Use `return await p` inside async functions, and always inside `try` blocks for correct error handling.
- Why: Returning a promise from an async function resolves the implicit promise with a promise, which needs a `PromiseResolveThenableJob` plus a reaction (2 ticks); `return await p` needs 1. The TC39 "Faster Promise Adoption" proposal that would remove the difference is only at Stage 1.
- Example: `async function getBook(sym) { return await api.book(sym); }`
- Avoid/caveats: Older lint rules (`no-return-await`) flag this; `@typescript-eslint/return-await` supports it. Do not micro-tune cold code.
- Status: Current spec behavior (2026-09).
- Sources: https://github.com/tc39/proposal-faster-promise-adoption ; https://v8.dev/blog/fast-async

### Start independent async work together and await it with `Promise.all`; use `Array.fromAsync` only for true async streams
- Layer: js
- Stage: network, microtask
- Metrics: LCP, INP, startup
- When: load | interaction
- Impact: medium: sequential awaits add each latency (2 × 150 ms round trips become 300 ms), and `Array.fromAsync` over a lazy source serializes them too.
- Do: Start all independent requests first, then `await Promise.all([...])`, or `Promise.allSettled` when a failure of one part must not reject the rest. Use `Array.fromAsync` only to collect an async iterable whose items really arrive one after another (a `ReadableStream`, an async generator). Limit concurrency with a small pool for very large N.
- Why: Each `await` suspends until its promise settles, so awaits in sequence serialize work. `Array.fromAsync` pulls the next value only after the previous one settles, so a generator that creates each promise on demand starts each request late. Bundlers also concatenate modules, so two sibling modules that each top-level-await a fetch run one after the other in a bundle (Rolldown documents this change from concurrent to sequential). `Promise.all` became about 8x faster in V8 6.8 and is not a costly helper.
- Example:
  ```ts
  // Before
  const book = await api.book(s); const trades = await api.trades(s);
  // After
  const [book2, trades2] = await Promise.all([api.book(s), api.trades(s)]);
  ```
- Avoid/caveats: `Promise.all` rejects on the first failure.
- Status: `Promise.all`/`allSettled` Baseline widely available. `Array.fromAsync` Baseline widely available since 2026-07-25.
- Sources: https://v8.dev/blog/holiday-season-2023 ; https://rolldown.rs/in-depth/tla-in-rolldown ; https://v8.dev/blog/fast-async ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/fromAsync

### Keep hot synchronous helpers synchronous; never `for await` over plain arrays
- Layer: js
- Stage: microtask, script-run
- Metrics: INP, FPS/smoothness
- When: animation/render-loop
- Impact: low to medium: every async call allocates a promise and every `await` suspends, resumes and costs at least one tick.
- Do: Do not mark per-frame or per-tick functions `async` when they do no I/O. Iterate plain arrays with `for` or `for…of`, not `for await`.
- Why: An async function always returns a new promise. `for await` over a sync iterable wraps each value through an async-from-sync iterator, so each element costs a tick (spec behavior).
- Example:
  ```ts
  // Before: async function toPixel(v: number) { return v * scale; }
  function toPixel(v: number) { return v * scale; }
  ```
- Avoid/caveats: Clarity first outside hot paths.
- Status: ECMAScript semantics, all engines.
- Sources: https://v8.dev/blog/fast-async

### Break long script work into chunks and yield with `scheduler.yield()`, not with resolved promises
- Layer: js
- Stage: main-thread-task, microtask
- Metrics: INP, TBT
- When: load | interaction
- Impact: high for long work, because a busy main thread delays input even when the page looks ready, and microtasks never let the browser render.
- Do: Split start-up work and large computations into chunks and `await scheduler.yield()` between them, with a `setTimeout` fallback. Order loading so the first view's code runs first. Do not expect `await Promise.resolve()` or a loop of awaits to let the browser paint.
- Why: The cost-of-JavaScript post names execution time as a dominant cost after download. The microtask queue is always emptied before control returns to the event loop, so a loop of awaits on resolved values stays inside one task. `scheduler.yield()` ends the task and schedules a prioritized continuation.
- Example:
  ```ts
  const yieldToMain = () =>
    'scheduler' in globalThis && 'yield' in scheduler ? scheduler.yield() : new Promise<void>(r => setTimeout(r, 0));
  for (let i = 0; i < bars.length; i++) { process(bars[i]); if (i % 500 === 0) await yieldToMain(); }
  ```
- Avoid/caveats: Too many yields add overhead; yield about every 50 ms of work or at natural breakpoints. See the event-loop notes (file 06) for full scheduling rules.
- Status: `scheduler.yield()` Chrome/Edge 129, Firefox 142, no Safari: Baseline limited availability (webstatus.dev, 2026-09).
- Sources: https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield ; https://api.webstatus.dev/v1/features/scheduler ; https://v8.dev/blog/cost-of-javascript-2019 ; https://v8.dev/blog/fast-async

### Keep top-level `await` out of shared modules; await only in the entry module or behind an exported init function
- Layer: js
- Stage: script-run
- Metrics: startup, LCP, FCP
- When: load
- Impact: high: one awaiting module stops the evaluation of every module that imports it, up to the entry point, and Safari 15-26 throws a ReferenceError when several modules import a module with top-level await.
- Do: Do not put `await` at the top level of a module that other modules import (config, API client, stores, chart setup). Export a memoized `init()`/`load()` that returns a promise, and await it once in the entry module. Put a timeout and a fallback on any network `await` that must stay at the top level.
- Why: Modules evaluate in post-order. When a module awaits, its parents cannot run their bodies until it settles; unrelated sibling subtrees can still run. A promise that never settles blocks dependents forever. WebKit bug 242740 makes BCD mark Safari 15-26 as partial; Safari 27 is the first full version.
- Example:
  ```ts
  // Before (config.ts, imported by chart.ts, orders.ts, main.ts)
  export const config = await fetch('/api/config').then(r => r.json());
  // After
  let pending: Promise<Config> | undefined;
  export function loadConfig() { return (pending ??= fetch('/api/config').then(r => r.json())); }
  // main.ts (entry) is the only module with top-level await: const config = await loadConfig();
  ```
- Avoid/caveats: Circular imports that include a top-level await can deadlock. An async IIFE in a shared module is not a fix: importers cannot wait for it. `import defer` evaluates modules with top-level await eagerly.
- Status: Baseline newly available since 2026-09-14 (Chrome/Edge 89, Firefox 89, Safari 27; webstatus.dev). The v8.dev support table is out of date.
- Sources: https://api.webstatus.dev/v1/features/top-level-await ; https://bugs.webkit.org/show_bug.cgi?id=242740 ; https://v8.dev/features/top-level-await

### Emit ESM output when any module uses top-level await
- Layer: build
- Stage: script-compile
- Metrics: startup, bundle-size
- When: build
- Impact: low: the failure is a build error or a silent format change, not a runtime cost.
- Do: Keep the output format `esm` for app and worker bundles that contain top-level await, and load them with `<script type="module">` or `new Worker(url, { type: 'module' })`. Do not add top-level await to code that must also ship as IIFE or CommonJS.
- Why: esbuild and Rolldown support bundling top-level await only with ESM output; classic scripts and CommonJS have no top-level await.
- Example: `esbuild src/worker.ts --bundle --format=esm --outfile=dist/worker.js` (then `new Worker(url, { type: 'module' })`).
- Avoid/caveats: The DevTools console and the Node REPL accept top-level await in a non-standard way; test the real app.
- Status: esbuild and Rolldown docs (read 2026-09-23).
- Sources: https://esbuild.github.io/content-types/ ; https://rolldown.rs/in-depth/tla-in-rolldown

### Do not treat `DOMContentLoaded` or `load` as "app ready" when entry modules use top-level await; publish a ready signal
- Layer: js
- Stage: html-parse, script-run
- Metrics: LCP, INP
- When: load | testing
- Impact: medium: handlers, RUM code and test harnesses that wait for DOMContentLoaded can run before the awaited part of the module graph is done.
- Do: After the entry module's awaits finish, mark readiness yourself (a custom event, a resolved promise on a known object, or a `data-` attribute), and make tests and interaction handlers wait for it.
- Why: HTML's "run a module script" returns the module's evaluation promise, and the script element does not wait for it. The element's `load` event and DOMContentLoaded can fire while the code after the first top-level `await` still waits in a promise job.
- Example:
  ```js
  const config = await loadConfig();
  mountChart(config);
  document.documentElement.dataset.ready = 'true';
  dispatchEvent(new Event('app:ready'));
  ```
- Avoid/caveats: Keep the signal name stable for tests.
- Status: WHATWG HTML Living Standard (checked 2026-09-22).
- Sources: https://html.spec.whatwg.org/multipage/webappapis.html#run-a-module-script ; https://html.spec.whatwg.org/multipage/scripting.html#execute-the-script-element

### In module workers, attach the message handler before the first top-level `await`
- Layer: js
- Stage: script-run, main-thread-task
- Metrics: startup, INP
- When: load
- Impact: medium: messages that arrive while the worker still awaits can reach no listener, and the page then waits for a reply that never comes.
- Do: In a `type: 'module'` worker, set `self.onmessage` at the top of the module, before any `await`. Queue messages until initialization is done, then drain the queue.
- Why: In the HTML "run a worker" steps, the worker runs the module script and then enables its message port. "Run a module script" returns at the first top-level await, so message events can be dispatched before the rest of the module body runs.
- Example:
  ```js
  const early = []; let handle = (m) => early.push(m);
  self.onmessage = (e) => handle(e.data);   // attached before any await
  const engine = await createEngine();
  handle = (m) => engine.process(m); early.splice(0).forEach(handle);
  ```
- Avoid/caveats: The same applies to `connect` events in shared workers.
- Status: WHATWG HTML; module workers Baseline widely available (2025-12-06).
- Sources: https://html.spec.whatwg.org/multipage/workers.html#run-a-worker

### Never block or spin on the main thread; use `Atomics.waitAsync` or read shared state once per frame
- Layer: js
- Stage: main-thread-task, microtask
- Metrics: INP, FPS/smoothness, TBT
- When: interaction | animation/render-loop
- Impact: high: a blocked or spinning main thread cannot render or handle input.
- Do: On the window thread, wait for a worker with `Atomics.waitAsync(i32, index, expected, timeoutMs)`, or read a shared sequence counter with `Atomics.load` at the start of each `requestAnimationFrame` callback. Keep `Atomics.wait` and spin loops in workers.
- Why: HTML creates the window agent with `[[CanBlock]]` false, so `Atomics.wait` throws a TypeError there (and cannot block in service workers or worklets). `Atomics.waitAsync` returns at once with `{ async: false, value }` or `{ async: true, value: promise }`; the promise resolves to `'ok'` or `'timed-out'`. HTML resolves it by queuing a task, not a microtask, so the continuation waits behind other tasks and rendering can happen first.
- Example:
  ```js
  async function waitForData(seen) {
    const r = Atomics.waitAsync(ctrl, SEQ, seen, 1000);
    if (r.async) await r.value;   // 'ok' or 'timed-out'
    return Atomics.load(ctrl, SEQ);
  }
  ```
- Avoid/caveats: For a render loop, one `Atomics.load` per frame is simpler than `waitAsync`. Do not use `waitAsync` for hand-offs that must finish in the same frame.
- Status: `Atomics.waitAsync` Baseline newly available since 2025-11-11 (Chrome 90, Firefox 145, Safari 16.4). SharedArrayBuffer/Atomics Baseline widely available (2024-06-13).
- Sources: https://html.spec.whatwg.org/multipage/webappapis.html#integration-with-the-javascript-agent-formalism ; https://html.spec.whatwg.org/multipage/webappapis.html#hostenqueuegenericjob ; https://v8.dev/features/atomics

### Enable `SharedArrayBuffer` with cross-origin isolation, check `crossOriginIsolated`, and keep a transfer fallback
- Layer: network
- Stage: network, script-run
- Metrics: INP, FPS/smoothness
- When: load | build
- Impact: high for any Atomics design: without isolation `SharedArrayBuffer` is unavailable and posting one throws.
- Do: Serve the document with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`). In Chrome 137+ desktop, `Document-Isolation-Policy: isolate-and-require-corp` is an alternative. At run time branch on `globalThis.crossOriginIsolated`, and fall back to transferring `ArrayBuffer`s with `postMessage(buf, [buf])`.
- Why: MDN states that the document must be a secure, cross-origin-isolated context, otherwise `postMessage` throws for SharedArrayBuffer objects. The same rule applies to shared `WebAssembly.Memory`.
- Example: `const ring = crossOriginIsolated ? new SharedArrayBuffer(1 << 20) : null; // else transfer per batch`
- Avoid/caveats: `require-corp` blocks cross-origin subresources (CDN fonts, images, third-party iframes) without CORP or CORS. `credentialless` is not in Safari. Document-Isolation-Policy is Chrome desktop only.
- Status: COOP/COEP Chrome 83, Firefox 79, Safari 15.2; `credentialless` Chrome 96, Firefox 119, no Safari (BCD). Document-Isolation-Policy Chrome 137 desktop.
- Sources: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer ; https://developer.chrome.com/blog/document-isolation-policy

### Stream worker data through a single-producer, single-consumer ring buffer: Atomics on head and tail only, plain access for the payload
- Layer: js
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop | long-lived session
- Impact: medium to high for tick streams: no per-message allocation, no structured clone, no lock.
- Do: Put `[head, tail]` in an `Int32Array` and the payload in a `Float64Array` on one `SharedArrayBuffer`. The producer writes slots with plain stores and then publishes with `Atomics.store(head)`. The consumer reads `head` with `Atomics.load`, reads slots with plain loads, drains once per frame, and publishes `tail`.
- Why: Atomics operations are sequentially consistent, so plain writes before an `Atomics.store` are visible to a thread that later reads that value with `Atomics.load`. Each `Atomics.*` call validates the array and index in a builtin, so plain element access is the cheaper path for bulk data (inference from V8 source, not measured).
- Example:
  ```js
  function push(v) {                                  // worker (producer)
    const head = Atomics.load(ctrl, 0), next = (head + 1) % CAP;
    if (next === Atomics.load(ctrl, 1)) return false; // full
    buf[head] = v; Atomics.store(ctrl, 0, next); return true;
  }
  function drain(sink) {                              // main thread, once per frame
    let tail = Atomics.load(ctrl, 1); const head = Atomics.load(ctrl, 0);
    while (tail !== head) { sink(buf[tail]); tail = (tail + 1) % CAP; }
    Atomics.store(ctrl, 1, tail);
  }
  ```
- Avoid/caveats: Exactly one producer and one consumer. Decide what "full" means for market data (drop oldest, coalesce, or block the worker). The pattern applies the post's primitives; it is not in the post.
- Status: APIs Baseline widely available; needs cross-origin isolation.
- Sources: https://v8.dev/features/atomics ; https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics-object

### If you need a lock, build a three-state futex on an `Int32Array`: `compareExchange`, a short `Atomics.pause()` spin in workers, then wait, retry and notify one
- Layer: js
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: long-lived session
- Impact: medium: a wrong expected value or a missing retry loop gives lost wake-ups (a stuck worker) or two lock holders; the third state skips `notify` on uncontended unlocks.
- Do: Keep the lock word in an `Int32Array` over a SharedArrayBuffer (0 unlocked, 1 locked, 2 locked with waiters). Acquire with `compareExchange`; in a worker, spin about 10 times with `Atomics.pause()`; then `Atomics.wait(a, i, 2)` (worker) or `await Atomics.waitAsync(a, i, 2).value` and loop. Release by decrementing, and call `Atomics.notify(a, i, 1)` only when the old state was 2.
- Why: `wait`/`waitAsync` sleep only while the word still holds the expected value, which closes the unlock race. The lock is not fair, so a woken waiter must try again. `notify` enters the waiter list's critical section even when nobody waits. `Atomics.pause()` is a CPU spin hint bounded to tens or hundreds of nanoseconds, cheaper than a sleep/wake cycle for short sections. Only `Int32Array` and `BigInt64Array` work with `wait`/`notify`.
- Example:
  ```js
  function lock(a) {
    for (let i = 0; i < 10; i++) { if (Atomics.compareExchange(a, 0, 0, 1) === 0) return; Atomics.pause(); }
    let c = Atomics.exchange(a, 0, 2);
    while (c !== 0) { Atomics.wait(a, 0, 2); c = Atomics.exchange(a, 0, 2); }
  }
  function unlock(a) { if (Atomics.sub(a, 0, 1) !== 1) { Atomics.store(a, 0, 0); Atomics.notify(a, 0, 1); } }
  ```
- Avoid/caveats: Prefer a message or the ring buffer above when it is enough. Never spin on the main thread. Keep the locked section short. Test with more than two workers.
- Status: `Atomics.pause` Baseline newly available since 2025-04-01 (Chrome 133, Firefox 137, Safari 18.4). Other APIs Baseline widely available.
- Sources: https://v8.dev/features/atomics ; https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics.pause ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/pause

### Give `Atomics.wait` a timeout in any worker that must also handle messages
- Layer: js
- Stage: script-run, main-thread-task
- Metrics: INP
- When: long-lived session
- Impact: medium: a waiting worker runs no event loop, so its `onmessage`, timers and cancel requests stay queued.
- Do: Pass a finite timeout (ms) to `Atomics.wait` in workers that also receive commands, and return to the event loop between waits. Use a dedicated worker with no message protocol when you need an unbounded wait.
- Why: `Atomics.wait` suspends the agent until `notify` or the timeout (default `Infinity`).
- Example: `const r = Atomics.wait(ctrl, SEQ, seen, 50); // 'ok' | 'not-equal' | 'timed-out'`
- Avoid/caveats: Very short timeouts in a loop turn into polling; choose the timeout from the latency that control messages need.
- Status: Current (ECMA-262).
- Sources: https://v8.dev/features/atomics ; https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics.wait

---

## 7. Parsing, compilation, code caching and startup

### Ship less JavaScript at startup; load non-critical features with dynamic `import()` at the moment of user intent
- Layer: build
- Stage: network, script-compile, script-run
- Metrics: LCP, INP, TBT, bundle-size, startup
- When: build | load | interaction
- Impact: high: download and execution dominate script cost, they scale with bytes and device CPU, and every shipped function is still downloaded and pre-parsed even if it never runs.
- Do: Use static `import` only for code that the first view needs. Put dialogs, rare tools, secondary panels and not-yet-selected drawing tools behind `import()`, and start the import on `pointerenter`/`focus` or preload the chunk. The 2019 rule of thumb is to split bundles above about 50-100 kB.
- Why: Lazy parsing does not skip code: the preparser still checks syntax and tracks variables for every skipped function, and only the AST and bytecode are deferred. `import()` fetches, compiles and evaluates a module (and its dependencies) only when called, once per module. Reddit's JS took 3-4x longer on a median phone than on a high-end one (2019 post).
- Example:
  ```ts
  button.addEventListener('click', async () => {
    const { openIndicatorDialog } = await import('./indicator-dialog');
    openIndicatorDialog();
  });
  ```
- Avoid/caveats: The first use pays network plus compile time inside the interaction (INP), so prefetch on intent. Nested dynamic imports create waterfalls. Very many tiny chunks add request overhead, and chunks below 1 KiB get no code cache. The 50-100 kB figure is a 2019 heuristic.
- Status: `import()` Baseline widely available (Chrome 63, Firefox 67, Safari 11.1). Guidance current in direction (2026-09).
- Sources: https://v8.dev/blog/preparser ; https://v8.dev/blog/cost-of-javascript-2019 ; https://v8.dev/features/dynamic-import

### Keep bundling and code splitting for production; write small modules and import only what you use
- Layer: build
- Stage: network, script-compile
- Metrics: LCP, startup, bundle-size
- When: build
- Impact: high: in Chrome's 2018 test a ~300-module library loaded faster bundled than as unbundled modules.
- Do: Bundle for production and split by route or feature. Prefer fine-grained modules over "utils" files with many unrelated exports, and import named exports from the module that defines them. Ship unbundled native modules only for development or small apps (the post: under 100 modules and depth under 5).
- Why: Many small module requests, per-module overhead and level-by-level graph discovery cost load time. Static `import`/`export` lets bundlers remove unused exports; without tree-shaking, one import loads the whole module. Unbundled modules can win on warm caches, so measure cold and warm loads.
- Example: `import { pluck } from './collections/pluck.js'; // not from './utils.js'`
- Avoid/caveats: The thresholds date from 2018 and no newer v8.dev data replaces them. Barrel files that re-export everything have the same problem when the bundler cannot prove they are side-effect free.
- Status: Guidance consistent with current bundler practice (2026-09).
- Sources: https://v8.dev/features/modules

### Preload critical ES modules with `rel="modulepreload"`, never with `rel="preload" as="script"`
- Layer: html
- Stage: preload-scan, network, script-compile
- Metrics: LCP, FCP, startup
- When: load
- Impact: medium: the browser does not discover the graph level by level, and a classic/module mismatch throws away the background compile.
- Do: Add `<link rel="modulepreload">` for the entry module and each critical dependency (list them all). Use `rel="preload" as="script"` only for classic scripts. For a predicted next feature, inject a `modulepreload` link on user intent.
- Why: `modulepreload` fetches, parses and compiles the module and puts it in the module map. A `preload as=script` request streams as a classic script (unless unused and ending in `.mjs`), and when the module script takes the streamer Chromium drops the result as a type mismatch. The code-cache hash also includes an "is module" bit, so a classic cache never serves a module.
- Example:
  ```html
  <link rel="modulepreload" href="/assets/app-9d2e.js">
  <link rel="modulepreload" href="/assets/chart-core-41ab.js">
  <script type="module" src="/assets/app-9d2e.js"></script>
  ```
- Avoid/caveats: Too many preloads compete with LCP resources. Module requests are always CORS; the `crossorigin` value must match or the browser fetches twice.
- Status: `modulepreload` Baseline widely available since 2026-03-18 (Chrome 66, Firefox 115, Safari 17). Streaming type rules in Chromium `script_streamer.cc` (2026-09-23).
- Sources: https://api.webstatus.dev/v1/features/modulepreload ; https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload ; https://v8.dev/blog/v8-release-78 ; https://v8.dev/features/modules

### Reference startup scripts with `<script src>` (or a preload) so Chrome streams and compiles them off the main thread
- Layer: html
- Stage: preload-scan, network, script-compile
- Metrics: FCP, LCP, TBT, startup
- When: load
- Impact: medium: script-tag-to-run time dropped 5-20% on average in V8's experiment, and streamed scripts compile in the background.
- Do: Put startup scripts in the initial HTML as `<script src>` (`type="module"`, `defer` or `async`). For a script that a loader injects late, add `<link rel="preload" as="script">` in `<head>` (or `modulepreload` for modules).
- Why: Since Chrome 78, a script that the preload scanner or a preload fetches starts streaming: V8 parses and compiles it on a background thread while bytes arrive, instead of waiting for the HTML parser to reach the tag. Current Chromium starts streaming after the first 4 bytes (byte-order-mark check). Eager compiles (compile hints, PIFEs) also run off the main thread on this path. A script that already has a code cache is not streamed; the cache is deserialized off the main thread instead.
- Example: `<link rel="preload" as="script" href="/js/chart-bootstrap.3f9a.js">`
- Avoid/caveats: Preload only scripts that run in the first seconds. Deep module chains still need `modulepreload`.
- Status: Chrome 78+; Chromium `script_streamer.cc` main 2026-09-23. `<link rel="preload">` Baseline widely available.
- Sources: https://v8.dev/blog/v8-release-78 ; https://v8.dev/blog/preparser ; https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/bindings/core/v8/script_streamer.cc

### Ship startup JavaScript as external UTF-8 http(s) files; never run large code through `eval`, `new Function`, inline scripts or `blob:` URLs
- Layer: build
- Stage: network, script-compile, main-thread-task
- Metrics: TBT, INP, FCP, LCP, startup
- When: load | build
- Impact: medium to high: only fetched script resources are streamed, compiled in the background and code-cached.
- Do: Load JS with `<script src>` or `import()`. Do not fetch script text and run it with `eval`, `new Function` or `document.write`. Keep inline scripts below about 1 KB (for example a theme bootstrap). Serve JS as UTF-8 (`Content-Type: text/javascript; charset=utf-8`).
- Why: Since Chrome 66 V8 also builds bytecode on the background thread for streamed scripts. Inline and eval code parses and compiles on the main thread: Chromium's `kPrecompileInlineScripts` and `kInlineScriptCache` are disabled by default, so inline scripts get neither background compile nor a disk code cache. The streamer accepts only UTF-8, windows-1252, ISO-8859-1 and US-ASCII; UTF-16 sources are not streamed. `blob:` and `data:` scripts are never code-cached, and non-HTTP streaming is disabled on Android.
- Example:
  ```js
  // Before: main-thread compile, no streaming, no code cache
  new Function(await (await fetch('/js/indicators.js')).text())();
  // After
  await import('/js/indicators.3f9a.js');
  ```
- Avoid/caveats: "Inline workers" built from Blob URLs likely have the same limits (inference, not checked in the worker loader).
- Status: Chromium `script_streamer.cc`, `script_resource.cc`, `blink/common/features.cc` (main 2026-09-23).
- Sources: https://v8.dev/blog/background-compilation ; https://v8.dev/blog/code-caching-for-devs ; https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/common/features.cc

### Design for the code cache: external files of at least 1 KiB, stable content-hashed URLs, and a separate vendor chunk
- Layer: build
- Stage: network, script-compile
- Metrics: startup, TBT, LCP
- When: build | load
- Impact: medium: a hot load skips parse and compile of every function that was compiled on the warm run; caching after execution cut parse and compile time by 20-40%.
- Do: Give unchanged code an unchanged URL (content-hash file names, long cache lifetimes, 304 on revalidation). Never add per-deploy or per-session query strings (`?v=`, `?t=`) to script URLs. Put rarely changing dependencies (framework, chart library) in their own shared chunk. Merge scripts smaller than 1 KiB.
- Why: Chrome keys the disk code cache by script URL (query included) and attaches it to the HTTP cache entry. Load 1 stores a timestamp; a load within 72 hours of it (`kHotHours`) produces the cache after execution; the next load consumes it. A 200 response replaces the resource and its cache; a 304 keeps it. Scripts under 1024 characters are never cached. V8 rejects cache data when the V8 version, flags, source length or classic/module kind differ, and since Chrome 153 (2026-09-08) Chrome ships a new milestone every 2 weeks, so each user gets a cold compile about every 2 weeks.
- Example: `vendor.[hash].js` (stable for weeks) + `app.[hash].js` (changes each deploy).
- Avoid/caveats: The post admits a trade-off: merging a library with the code that calls it caches more of its functions, while splitting keeps its cache across deploys. Watch hash cascades (a changed leaf renames its importers); a runtime/manifest chunk or import maps can limit them (inference).
- Status: Chromium only; `v8_code_cache.cc` main 2026-09-23. Release cadence from the Chrome blog (2026-03-03) and chromiumdash.
- Sources: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/bindings/core/v8/v8_code_cache.cc ; https://developer.chrome.com/blog/chrome-two-week-release ; https://v8.dev/blog/improved-code-caching ; https://v8.dev/blog/code-caching-for-devs

### Keep the startup path deterministic, and run code that must be fast on repeat visits during the top-level run
- Layer: js
- Stage: script-compile, script-run
- Metrics: startup, TBT, INP
- When: load
- Impact: medium: the code cache holds only functions compiled by the end of the warm run.
- Do: Do not pick between large code paths at random at load (`Math.random()` A/B branches); make the choice stable per user. Call init code at the top level of a `defer` or module script instead of from a later event, so it is compiled before the cache is produced.
- Why: Since Chrome 66, Chrome creates the cache after top-level execution, so lazily compiled functions that already ran are included. Blink produces the classic-script cache right after the run, and the module cache in a task after evaluation. Functions that first run later (event handlers, promise continuations, timers, rAF callbacks) are not cached. For main-frame classic scripts, "local compile hints" (on by default) record the functions used until first meaningful paint or interactive and compile them eagerly next time; module scripts do not get this.
- Example:
  ```js
  // Before: document.addEventListener('DOMContentLoaded', () => initChartShell());
  initChartShell();   // in a defer/module script, which already runs after parsing
  ```
- Avoid/caveats: Heavy synchronous top-level work is a long task; do not move work to the top level only to game the cache. V8's first advice is still "do nothing": the heuristics change between releases.
- Status: Chromium main 2026-09-23 (`v8_script_runner.cc`, `kLocalCompileHints` enabled by default).
- Sources: https://v8.dev/blog/improved-code-caching ; https://v8.dev/blog/code-caching-for-devs ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/common/features.cc

### Precache critical classic scripts in the service worker `install` event
- Layer: network
- Stage: network, script-compile
- Metrics: startup, TBT
- When: load
- Impact: medium: Chrome creates a full code cache at install time, so even the first page load that uses the script can skip compilation.
- Do: Add critical scripts to Cache Storage inside `install` (`cache.addAll([...])`) and serve them from the service worker.
- Why: For scripts stored during `install`, Chrome compiles everything eagerly and stores a "full" cache. Scripts stored in Cache Storage at other times get a normal cache on their first load, without the heat check.
- Example:
  ```js
  self.addEventListener('install', (e) => {
    e.waitUntil(caches.open('core-v12').then((c) => c.addAll(['/assets/core-7c1e.js'])));
  });
  ```
- Avoid/caveats: A full cache costs more memory. The 2020 post says the full cache assumes a classic script in a UTF-8 page and is discarded for modules (not re-verified). Batch 05 could not confirm whether Chromium's `ServiceWorkerCodeCache` feature is on by default.
- Status: Chrome only (2019/2020 post, Cache Storage branch in `v8_code_cache.cc`). Service Worker and Cache API Baseline.
- Sources: https://v8.dev/blog/code-caching-for-devs ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/bindings/core/v8/v8_code_cache.cc

### Mark one small core startup file with `//# allFunctionsCalledOnLoad`, and make the comment survive the build
- Layer: build
- Stage: script-compile, network
- Metrics: startup, FCP, LCP, TBT
- When: build | load
- Impact: medium for the right file: its functions compile on a background thread during download instead of lazily on the main thread (V8: 630 ms less foreground parse and compile on average, 17 of 20 pages faster).
- Do: Put functions that always run at load into one small chunk and put `//# allFunctionsCalledOnLoad` as its first line (only other comments may come before it). Add it at output time with the bundler's banner for that chunk only (Rollup/Vite `output.banner` as a function, esbuild `banner`), keep it through the minifier, and check the file on disk.
- Why: Without a hint V8 pre-parses each function and fully parses and compiles it on first call, on the main thread. The hint makes V8 parse once, eagerly, off the main thread. The older PIFE trick (a parenthesis before `function`) also forces eager compile but is a heuristic to avoid unless needed.
- Example:
  ```js
  // vite/rollup output options
  output: {
    manualChunks: { core: ['src/boot/core.ts'] },
    banner: (chunk) => (chunk.name === 'core' ? '//# allFunctionsCalledOnLoad' : ''),
  }
  // Terser: format: { comments: /allFunctionsCalledOnLoad/ }
  ```
- Avoid/caveats: The post says to use it sparingly: eagerly compiled unused functions cost CPU and memory. A banner on every chunk turns off lazy compilation for the whole app. esbuild strips the comment by default (issue #4247). Other engines ignore it.
- Status: Chrome 136+ (per-file hint). Per-function hints (`//# functionsCalledOnLoad=…`) are "Proposed" on Chrome Platform Status (last update 2025-11-26), not shipped. Firefox and Safari: no implementation.
- Sources: https://v8.dev/blog/explicit-compile-hints ; https://chromestatus.com/feature/5100466238652416 ; https://chromestatus.com/feature/5153430045458432 ; https://github.com/evanw/esbuild/issues/4247 ; https://github.com/WICG/explicit-javascript-compile-hints-file-based

### Wrap only profiled startup-critical function expressions as PIFEs
- Layer: v8
- Stage: script-compile
- Metrics: startup
- When: load | build
- Impact: low: the gain is small on modern V8 and applies only to functions that really run at startup.
- Do: If a profile shows a function expression runs immediately at load, write it in a "possibly-invoked" form: `(function…`, `(async function…`, `!function…`, or an arrow right after an opening parenthesis `(() => …)`. Do not auto-wrap code with tools (optimize-js); keep Terser `wrap_func_args` at its default `false`.
- Why: V8's parser decides before it reads the body; for these patterns it skips the pre-parse and compiles eagerly. A callback passed as a plain argument (`f(() => …)`) is not a PIFE. Blanket wrapping compiles late modules eagerly and costs memory and load time.
- Example: `const boot = (() => { registerSeriesTypes(); return createTerminal(); })();  // eager`
- Avoid/caveats: Bundlers already use PIFEs for module wrappers (Rolldown PR #5319); do not fight their output.
- Status: V8 `main` `parser-base.h` (2026-09-23). Terser 5.43.0 changed `wrap_func_args` to `false`.
- Sources: https://v8.dev/blog/preparser ; https://raw.githubusercontent.com/v8/v8/main/src/parsing/parser-base.h ; https://github.com/terser/terser/blob/master/CHANGELOG.md ; https://github.com/rolldown/rolldown/pull/5319

### Expect lazily compiled functions to compile on the main thread at their first call; keep the first-interaction path small
- Layer: v8
- Stage: script-compile, main-thread-task
- Metrics: INP, TBT
- When: load | interaction
- Impact: medium: the first pan, zoom or order-ticket open pays a main-thread compile for every function it reaches for the first time.
- Do: Keep the code that the first interaction needs small, and put rarely used features behind `import()`. For a file whose functions nearly all run at load, use the compile hint above.
- Why: Only top-level code, PIFEs, hinted files and code-cached functions compile ahead of time. Other inner functions compile lazily, on the main thread, when first called. V8 also flushes bytecode that stays unused for a while, so rarely used code can be recompiled later.
- Example: see the dynamic `import()` rule.
- Avoid/caveats: Eagerly compiling everything costs memory and background time; hint only code that really runs early.
- Status: Current V8 behavior (lazy compilation default).
- Sources: https://v8.dev/blog/background-compilation ; https://v8.dev/blog/preparser

### Verify compile and code-cache behavior with a trace and V8 logs in a clean profile
- Layer: tooling
- Stage: script-compile
- Metrics: startup
- When: testing
- Impact: low (measurement), but it stops you from shipping a hint or cache strategy that does nothing.
- Do: Start Chrome with a fresh profile and no extensions. For caching, record a trace with the `v8` category over three loads within 72 hours: warm runs show `v8.compile` with `cacheProduceOptions`, hot runs `cacheConsumeOptions`. For eager vs lazy, add `--js-flags=--log-function_events` and grep for your function: a `parse-function` event at call time means lazy.
- Why: Earlier visits' code caches hide the difference, so the profile must be clean.
- Example:
  ```sh
  google-chrome --user-data-dir="$(mktemp -d)" --no-first-run --disable-extensions --js-flags=--log-function_events > log.txt
  grep mountChart log.txt
  ```
- Avoid/caveats: Tracing records the whole browser; close other tabs. Use the Perfetto UI; `chrome://tracing` is superseded. Whether current DevTools shows code-cache data was not verified.
- Status: Developer flags and trace categories current (2026-09).
- Sources: https://v8.dev/blog/code-caching-for-devs ; https://v8.dev/blog/explicit-compile-hints

### Ship modern syntax untranspiled to Baseline targets; drop `nomodule` fallback bundles
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, startup, TBT
- When: build
- Impact: high: ES5 output was 2x to 6.5x larger in the post's examples (an async generator went from 187 to 2,987 characters plus the regenerator runtime), and helpers run slower than native features.
- Do: Set Browserslist to `"baseline widely available"` (or a `baseline 20XX` year) so Babel/SWC/esbuild keep classes, spread, destructuring, `for…of`, async/await and async generators native. Remove regenerator-runtime, ES5 helpers and the `type="module"`/`nomodule` split. Check that dependencies are not pre-transpiled to ES5.
- Why: Ignition and TurboFan support the whole language, and later work made spread, destructuring and async functions as fast as or faster than hand-written ES5. Every supported browser now runs modules, so a `nomodule` bundle is dead weight.
- Example: `{ "browserslist": ["baseline widely available"] }`
- Avoid/caveats: Features newer than your target still need a transform or a guard. If legacy browsers must be served, build a separate legacy bundle.
- Status: Browserslist Baseline queries (2025). JS modules Baseline widely available since 2020-11. The web.dev "publish modern JavaScript" article was removed as outdated.
- Sources: https://v8.dev/blog/high-performance-es2015 ; https://web.dev/blog/browserslist-supports-baseline ; https://api.webstatus.dev/v1/features/js-modules

### Minify production bundles: strip whitespace and comments, mangle local names, move legal comments out
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, startup, FCP, LCP, TBT
- When: build
- Impact: medium: every byte goes through the scanner, and short tokens give more tokens per second.
- Do: Keep the production minifier on (Vite 8 default `build.minify: 'oxc'` for client builds, esbuild `--minify`, or Terser with `mangle`) and use source maps for readable stacks. After a build, grep the output for `/**` and `@license`, and write legal comments to a separate file where supported (esbuild `legalComments: 'external'`).
- Why: The scanner loops over every whitespace run and comment before it finds a real token. The post measured tokens per second against token length and found that shorter identifiers scan faster per token. V8 deduplicates identifiers and uses a direct table for one-character ASCII names.
- Example: `export default defineConfig({ build: { minify: 'oxc', sourcemap: 'hidden' } });`
- Avoid/caveats: Do not read the post as "long identifiers scan faster". `keepNames` options add code; use them only where code needs `Function.name`. Property mangling is a separate, risky option. Keep comments that licenses require.
- Status: Vite 8 defaults (docs read 2026-09-23). Rolldown keeps legal, annotation and JSDoc comments by default (`output.comments`); Vite 8 behavior with the Oxc minifier was not verified.
- Sources: https://v8.dev/blog/scanner ; https://vite.dev/config/build-options ; https://esbuild.github.io/api/#legal-comments ; https://rolldown.rs/reference/OutputOptions.comments

### Write identifiers in ASCII, and keep non-ASCII text in string data served as UTF-8
- Layer: build
- Stage: script-compile
- Metrics: startup
- When: build
- Impact: low: the extra cost applies only to identifiers and literals that contain such characters.
- Do: Name variables and properties in ASCII (no `Δ`, `π`, Cyrillic or emoji names). Leave non-Latin-1 UI text in string literals or translation data. With esbuild keep the default `charset: 'ascii'` unless you serve scripts with a UTF-8 charset.
- Why: The scanner checks ASCII identifier characters with a 128-entry flag table (one lookup and one branch); non-ASCII identifiers take the slow Unicode-property path, and supplementary characters need surrogate handling.
- Example: `const deltaPrice = next.price - prev.price; // not: const Δprice = …`
- Avoid/caveats: Escaping makes output slightly larger. A non-ASCII script served without a UTF-8 charset can be decoded wrongly, which matters more than speed.
- Status: Scanner post (2019), esbuild docs (2026-09-23).
- Sources: https://v8.dev/blog/scanner ; https://esbuild.github.io/api/#charset

### Write module scripts without `defer`; use `async` only for independent modules; resolve assets with `import.meta.url`
- Layer: html
- Stage: html-parse, network, script-run
- Metrics: FCP, LCP, startup
- When: load | build
- Impact: low: it states the right intent and keeps asset URLs hashed and cache-stable.
- Do: Write `<script type="module" src>` without `defer`; add `async` only when the module does not depend on DOM order or other scripts (analytics). Use `new URL('./file', import.meta.url)` for images, Wasm and worker entry files, and `new Worker(url, { type: 'module' })`. Use an import map when unbundled code needs bare specifiers or stable names.
- Why: Module scripts and their dependencies download in parallel with parsing and run after it, like `defer`. A module URL is evaluated once. `import.meta.url` is the module's own URL, and bundlers turn the `new URL` pattern into hashed assets.
- Example: `const worker = new Worker(new URL('./series-worker.ts', import.meta.url), { type: 'module' });`
- Avoid/caveats: An import map can let a changed leaf module get a new URL without renaming its importers (inference: protects their code cache).
- Status: Module workers Baseline widely available (2025-12-06); import maps Baseline widely available (2025-09-27); multiple import maps limited.
- Sources: https://v8.dev/features/modules ; https://api.webstatus.dev/v1/features/js-modules-workers ; https://api.webstatus.dev/v1/features/import-maps

### Use dynamic `import()` for lazy evaluation today; re-check support before you rely on `import defer`
- Layer: js
- Stage: script-run
- Metrics: startup, TBT
- When: load
- Impact: medium when available: `import defer` loads a module graph but runs a module only when code first reads its namespace.
- Do: Keep lazy evaluation on `import()` for now. Re-check support before using `import defer * as ns from './x.js'`.
- Why: `import defer` gives synchronous, lazy evaluation without the async friction of `import()`. Modules with top-level await in the deferred graph are still evaluated eagerly.
- Example: `import defer * as heavy from './indicator-math.js'; // later: heavy.ichimoku(data)`
- Avoid/caveats: Do not ship it without a fallback until it is Baseline.
- Status: Limited availability (webstatus.dev). Chrome Intent to Ship for M155 (2026-09-14; Chrome 155 stable is scheduled for 2026-10-06); WebKit shipping; Gecko positive. Not verified as shipped.
- Sources: https://api.webstatus.dev/v1/features/import-defer ; http://www.mail-archive.com/blink-dev@chromium.org/msg17443.html

### Measure warm code after tier-up, not only first calls; know V8's tiers
- Layer: tooling
- Stage: script-run
- Metrics: INP, TBT, FPS/smoothness
- When: testing
- Impact: medium: most interaction code never reaches TurboFan, and early iterations run in lower tiers.
- Do: Benchmark real user flows as well as micro loops. In micro-benchmarks, run thousands of warm-up iterations and check deopts with `--trace-deopt` when numbers jump.
- Why: Tiers in V8 `main`: Ignition interprets bytecode; after about 8 calls a feedback vector exists and Sparkplug compiles bytecode almost instantly; Maglev after about 400 calls (1,000 on Android); TurboFan after about 3,000; loops tier up by on-stack replacement (Maglev at 100, TurboFan at 500 iterations). On Speedometer, Sparkplug gave +41% over Ignition, Maglev compiles about 10x faster than TurboFan, and Maglev cut energy use by 10%.
- Example: `node --trace-deopt bench.mjs | grep -i deopt`
- Avoid/caveats: The counts are internal tuning and change between releases. Turbolev (Maglev front end + Turboshaft) is off by default (2026-09).
- Status: Maglev in Chrome 117 desktop; current `BUILD.gn` builds it on arm, arm64 and x64 (Android included) with an Android threshold.
- Sources: https://v8.dev/blog/maglev ; https://v8.dev/blog/launching-ignition-and-turbofan ; https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h

### Test performance with the V8 optimizers turned off, because some users run without them
- Layer: tooling
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: testing
- Impact: medium for users on Chrome's Advanced Protection or with the per-site "JavaScript optimization & security" setting off: their JS runs without optimizing tiers and their Wasm without TurboFan.
- Do: Run one test pass with that site setting turned off for your origin. Make sure the chart stays usable, for example by lowering point density or decimating more when frame times rise.
- Why: `--disable-optimizing-compilers` implies Liftoff-only Wasm and no tier-up. Google says the per-site setting exists since Chrome 133 and that Advanced Protection users have the optimizers off by default.
- Example: Chrome settings → Privacy and security → Site settings → JavaScript optimization & security → add your origin to "not allowed".
- Avoid/caveats: Do not detect or block these users; degrade gracefully.
- Status: Chrome 133+ (Google security blog, 2025-07).
- Sources: https://blog.google/security/advancing-protection-in-chrome-on/ ; https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h

---

## 8. Memory and garbage collection

### Let temporary objects die young; do not keep them "just in case"
- Layer: v8
- Stage: gc-memory, script-run
- Metrics: memory, FPS/smoothness, INP
- When: animation/render-loop | long-lived session
- Impact: medium: a minor GC costs time in proportion to surviving objects, not allocated ones.
- Do: Create short-lived helper objects (tuples, small `{x, y}` records, iterator results) freely inside one task, and let them become unreachable before the task ends. Do not park them in fields, module-level arrays or closures "for later".
- Why: V8 allocates new objects in the nursery. The Scavenger copies only reachable objects; everything else is reclaimed for free. An object that survives one scavenge moves to an intermediate space, and after a second it is copied into the old generation, where only the major mark-compact GC can reclaim it. Objects that live "a few frames" pay two copies plus a later major GC.
- Example:
  ```js
  // Before: per-frame scratch objects kept alive in a long-lived array
  this.lastHits = points.map(p => ({ x: p.x, y: p.y }));
  // After: compute and consume in the same task
  for (const p of points) { const hit = hitTest(p.x, p.y); if (hit) { select(hit.id); break; } }
  ```
- Avoid/caveats: Cheap is not free: a very high allocation rate at 60 fps still triggers frequent scavenges, and each is a (parallel) main-thread pause. The DevTools Performance panel shows "Minor GC" events.
- Status: V8 mechanism. The Scavenger is still the default young-generation GC; the alternative `minor_ms` is an experimental flag, off by default (V8 `main` 2026-09-23).
- Sources: https://v8.dev/blog/trash-talk ; https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h

### Reuse large buffers, not small objects; do not build object pools by default
- Layer: v8
- Stage: gc-memory
- Metrics: memory, FPS/smoothness
- When: animation/render-loop
- Impact: medium: reusing big buffers removes real allocation cost, while pools move small objects into old space and add write-barrier work.
- Do: Allocate large typed arrays (vertex buffers, scratch `Float32Array`s) once and reuse them across frames. Allocate small short-lived objects normally. Add a pool only when a profile shows GC time inside frames and the pool proves faster.
- Why: For a generational GC, short-lived objects are cheap because only survivors cost work. Pooled objects live forever: they are promoted, and each time you store a fresh young object into one, the write barrier records an old-to-new reference that the next scavenge must process.
- Example:
  ```js
  const scratch = new Float32Array(MAX_POINTS * 2);   // one upload buffer per series
  function uploadFrame(xs, ys, n) {
    for (let i = 0; i < n; i++) { scratch[2 * i] = xs[i]; scratch[2 * i + 1] = ys[i]; }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratch.subarray(0, 2 * n));
  }
  ```
- Avoid/caveats: A pool larger than needed wastes memory all session; a pool that hands out objects which still reference old data can leak. The pooling trade-off is derived from the post's mechanism.
- Status: V8 mechanism.
- Sources: https://v8.dev/blog/trash-talk

### Do not store freshly allocated objects into long-lived containers every frame; write numbers into existing storage
- Layer: v8
- Stage: gc-memory, script-run
- Metrics: FPS/smoothness, memory
- When: animation/render-loop
- Impact: medium: each such store creates an old-to-new reference, so the new object survives, is copied twice and becomes old-space garbage on the next frame.
- Do: When a long-lived structure (cache, store, component field) changes every frame, write numbers into existing typed arrays or mutate existing objects instead of replacing entries with new objects.
- Why: The scavenger uses the remembered set of old-to-new references as extra roots. A new object stored into an old container is reachable, so it survives, gets promoted, and is then dropped, where only a major GC can reclaim it.
- Example:
  ```js
  // Before: for (let i = 0; i < n; i++) this.screenPts[i] = { x: toX(t[i]), y: toY(c[i]) };
  for (let i = 0; i < n; i++) { this.sx[i] = toX(t[i]); this.sy[i] = toY(c[i]); }
  ```
- Avoid/caveats: In-place mutation can break reactive frameworks that rely on identity changes (Svelte `$state`, immutable stores); keep hot numeric buffers outside reactive state.
- Status: V8 mechanism (write barriers, remembered set); derived rule.
- Sources: https://v8.dev/blog/trash-talk

### Leave idle time in each frame: render on change and stop the loop when the chart is hidden
- Layer: v8
- Stage: idle, gc-memory, main-thread-task
- Metrics: FPS/smoothness, memory, INP
- When: animation/render-loop | long-lived session
- Impact: medium: GC work that cannot run in idle slices runs later as forced work inside frames.
- Do: Finish per-frame work well inside the frame budget (about 16.6 ms at 60 Hz). Redraw only when data or the viewport changed (dirty flag). Stop the `requestAnimationFrame` loop when the tab or chart is hidden.
- Why: V8 posts optional GC "idle tasks" that Chrome runs in the spare time between the end of frame work and the next frame. Idle-time GC cut Gmail's JS heap by 45% when idle. A loop that uses the whole budget every frame leaves no idle slices.
- Example:
  ```js
  let dirty = true;
  function frame() { if (dirty) { draw(); dirty = false; } rafId = requestAnimationFrame(frame); }
  ```
- Avoid/caveats: JS cannot trigger GC (`gc()` exists only with `--expose-gc`); do not try to force it.
- Status: Chrome/V8 behavior; other engines schedule GC differently.
- Sources: https://v8.dev/blog/trash-talk ; https://v8.dev/blog/free-garbage-collection

### Give every listener, timer and subscription a teardown, and drop references to big data when a view closes
- Layer: js
- Stage: gc-memory
- Metrics: memory, INP
- When: long-lived session
- Impact: high for a terminal that stays open for hours: anything reachable from a root is never collected, and a leaked listener keeps its whole component (and its growing arrays) alive.
- Do: Register listeners on long-lived targets (window, document, WebSocket, shared emitters) with an `AbortSignal` that the component owns, and call `abort()` in its teardown; use `{ once: true }` for one-shot listeners. Clear timers, rAF loops, observers and caches in the same teardown, and null out fields that hold large data.
- Why: The GC keeps everything reachable from the roots (stack, globals). An event target holds its listeners strongly, and a listener closure holds `this` and everything it captures. In the weak-references post, `stop()` sets `this.movingAvg = null`, but socket → listener → instance keeps the instance and its events array alive. The JS-to-DOM tracing post shows a parent `body` listener that keeps a removed iframe's whole window alive.
- Example:
  ```js
  class TickPanel {
    #ac = new AbortController();
    constructor(socket) {
      this.events = [];
      socket.addEventListener('message', (ev) => this.events.push(ev), { signal: this.#ac.signal });
      window.addEventListener('resize', () => this.layout(), { signal: this.#ac.signal });
    }
    dispose() { this.#ac.abort(); this.events = null; }
  }
  ```
- Avoid/caveats: `removeEventListener` needs the same function reference and capture flag; forgetting one is a common leak, which the signal avoids.
- Status: `signal` option Chrome 90, Firefox 86, Safari 15; AbortController Baseline widely available (2021-09-25).
- Sources: https://v8.dev/features/weak-references ; https://v8.dev/blog/tracing-js-dom ; https://v8.dev/blog/trash-talk ; https://webstatus.dev/features/aborting

### Create long-lived callbacks in small scopes that do not also hold large data
- Layer: v8
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium: one small listener can keep a large array or payload alive for the whole session.
- Do: Create listeners, timers and subscriptions that outlive a function in a separate small function that receives only the values it needs. Do not create a long-lived callback in a scope where another closure captures a large local.
- Why: In V8, closures reference their outer environment strongly, and closures created in the same scope share one environment. Any variable that a sibling closure captures stays alive while any closure from that scope lives.
- Example:
  ```js
  // Before: the tick listener shares a scope with `history`, which `summarize` captures
  function attach(feed) {
    const history = loadLargeHistory(); const summarize = () => history.length;
    feed.addEventListener('tick', (e) => render(e.data)); return summarize();
  }
  // After: the long-lived listener comes from its own scope
  function listenTicks(feed, signal) { feed.addEventListener('tick', (e) => render(e.data), { signal }); }
  ```
- Avoid/caveats: Engine-specific; other engines may retain less. Confirm with a heap-snapshot retaining path, and name callbacks so they are easy to find.
- Status: V8 behavior as described in the weak-references post (2019, updated 2020); not re-checked in source.
- Sources: https://v8.dev/features/weak-references

### Use `WeakRef` and `FinalizationRegistry` only as a safety net, never for required cleanup or program logic; call `deref()` once per task
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: medium: misuse gives leaks that only look fixed and behavior that changes with GC timing.
- Do: Give resource owners (Wasm-backed chart objects, WebGL/WebGPU buffers, sockets, workers) an explicit `dispose()` and call it. Use a FinalizationRegistry only to report forgotten disposals or free secondary resources as a fallback. Write `const t = ref.deref(); if (t) { … }` once per task, and use a size-bounded Map (LRU) instead of WeakRefs for caches of small objects.
- Why: A finalizer may run late, in any order, or never (tab closes, worker ends, registry collected). GC runs on JS-heap pressure, and a small JS wrapper gives it no hint of the GPU or Wasm memory it owns. A target returned by `deref()` stays alive until the current job ends; between jobs any GC can clear it, and V8 treats WeakRef targets weakly even in minor GCs.
- Example:
  ```js
  const gpuLeaks = new FinalizationRegistry(({ gl, buf, label }) => { console.warn(`${label} not disposed`); gl.deleteBuffer(buf); });
  class GpuSeries {
    constructor(gl, label) { this.gl = gl; this.buf = gl.createBuffer(); gpuLeaks.register(this, { gl, buf: this.buf, label }, this); }
    dispose() { this.gl.deleteBuffer(this.buf); gpuLeaks.unregister(this); }
  }
  ```
- Avoid/caveats: The held value must not reference the target, or the target is never collected; the target itself is a fine unregister token. Every WeakRef is extra GC work. `using`/`DisposableStack` give scope-based cleanup but are not Baseline (Chrome 134, Firefox 141, no Safari).
- Status: WeakRef/FinalizationRegistry Baseline widely available (2023-10-26); the v8.dev support table is stale. Explicit resource management: limited (webstatus).
- Sources: https://v8.dev/features/weak-references ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry ; https://webstatus.dev/features/explicit-resource-management

### Update large data sets incrementally instead of rebuilding them
- Layer: v8
- Stage: gc-memory, script-run
- Metrics: FPS/smoothness, memory, INP
- When: long-lived session | interaction
- Impact: medium: large allocate-then-drop bursts push the heap toward its limit, trigger major GCs more often and fragment old-space pages.
- Do: Append new ticks or candles to existing buffers and update in place. Do not re-parse the full snapshot or rebuild the whole object graph on every message.
- Why: The major GC starts concurrent marking when the heap nears a dynamic limit, then pauses the main thread to finalize marking, compact fragmented pages in parallel and update pointers. Big bursts of long-lived-then-dropped objects make that cycle more frequent and give compaction more to copy.
- Example:
  ```js
  // Before: ws.onmessage = e => { state.candles = JSON.parse(e.data).candles.map(toCandle); };
  ws.onmessage = e => { appendCandle(buffers, JSON.parse(e.data)); };   // message carries only the delta
  ```
- Avoid/caveats: Needs a delta protocol; concurrent marking and sweeping already reduce pauses (up to 50% lower in heavy WebGL games per the post).
- Status: V8 mechanism.
- Sources: https://v8.dev/blog/trash-talk

### Estimate Chrome object memory with 4-byte slots, and measure it in Chrome, not Node
- Layer: tooling
- Stage: gc-memory
- Metrics: memory
- When: testing | long-lived session
- Impact: medium: unit tests in Node use a different object layout than Chrome.
- Do: Estimate a Chrome object as a 12-byte header plus 4 bytes per in-object field (plus about 12 bytes per boxed double). Measure real memory in Chrome with heap snapshots, or `performance.measureUserAgentSpecificMemory()` on cross-origin-isolated pages. Bound the JS heap in long sessions (evict old ticks, use ring buffers).
- Why: Chrome uses pointer compression: tagged values are 4 bytes and an isolate's JS heap lives in a 4 GB region (Chrome caps it at 2 or 4 GB by device). Official Node builds do not enable pointer compression, so tagged slots are 8 bytes and Smis 32-bit there. ArrayBuffer data lives outside the cage.
- Example: `const bytesPerBar = 12 + 5 * 4 + 5 * 12; // object with 5 boxed double fields ≈ 92 B vs 40 B in 5 Float64Array columns`
- Avoid/caveats: The formula is an estimate; slack and property arrays add more. `measureUserAgentSpecificMemory` is Chromium-only and marked experimental in BCD.
- Status: Chrome 80+ pointer compression. Node default builds without it (Node issue #55735; not re-verified for Node 26).
- Sources: https://v8.dev/blog/pointer-compression ; https://github.com/nodejs/node/issues/55735

### Find leaks with heap-snapshot retaining paths, and name your callbacks
- Layer: tooling
- Stage: gc-memory
- Metrics: memory
- When: testing | long-lived session
- Impact: medium: this is how you find the one listener or cache that keeps a closed chart, panel or iframe alive.
- Do: Repeat the suspect action several times (open and close a chart panel), take a heap snapshot, and use the "Objects retained by detached nodes" filter or a "Detached elements" profile. Read the Retainers pane from the leaking object back to a root, and compare snapshots. Give listeners and callbacks function names. Clear the console first, or use the "retained by the DevTools console" filter.
- Why: Since Chrome 66, heap snapshots trace through Blink's C++ DOM objects, so retaining paths across the JS/DOM boundary are exact. Since Chrome 57, unreachable JS↔DOM cycles are collected, so only paths from live roots leak.
- Example: DevTools → Memory → Heap snapshot → filter "Objects retained by detached nodes" → select a `ChartPanel` → Retainers.
- Avoid/caveats: The console retains logged objects. Wasm linear memory appears as one opaque buffer (section 12).
- Status: Current DevTools profile types: Heap snapshot, Allocation instrumentation on timeline, Allocation sampling, Detached elements (developer.chrome.com, 2026-09-23).
- Sources: https://developer.chrome.com/docs/devtools/memory ; https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots ; https://v8.dev/blog/tracing-js-dom

---

## 9. Regular expressions

### Keep RegExp instances and `RegExp.prototype` unmodified, do not subclass RegExp in hot code, and keep `lastIndex` a non-negative integer
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT
- When: interaction | load
- Impact: medium to high: any of these sends `exec`, `test`, `match`, `replace`, `split` and `matchAll` to the generic slow path (V8 13.6: `replace` 13x and `split` 23x slower with one expando on the regex).
- Do: Treat regexes as immutable values: no expando properties, no patches to `RegExp.prototype` (including `exec`), no `Symbol.species` or `constructor` tricks, no `class X extends RegExp` on hot paths. Write only integers ≥ 0 to `lastIndex`. Keep side data in a `WeakMap`.
- Why: The fast path runs only when the receiver still has the initial JSRegExp map (an added property or a subclass changes it), the prototype still has its initial map, `exec` is unchanged, the species protector is intact, and `lastIndex` is a non-negative Smi (so no user code runs inside `ToLength(lastIndex)`).
- Example:
  ```js
  const TICKER = /^[A-Z]{1,5}$/;
  // Before: TICKER.lastMatchedAt = Date.now();   // new map -> slow path forever
  const meta = new WeakMap(); meta.set(TICKER, { lastMatchedAt: Date.now() });
  ```
- Avoid/caveats: A polyfill that patches `RegExp.prototype` slows every regex on the page.
- Status: V8 `main` 2026-09-23 (`RegExpUtils::IsUnmodifiedRegExp`, `BranchIfFastRegExp`).
- Sources: https://v8.dev/blog/speeding-up-regular-expressions ; https://github.com/v8/v8/blob/main/src/regexp/regexp-utils.cc ; https://github.com/v8/v8/blob/main/src/builtins/builtins-regexp-gen.cc

### Create each distinct RegExp once; cache dynamic patterns; use string methods for literal checks
- Layer: v8
- Stage: script-run, script-compile, gc-memory
- Metrics: INP, TBT, memory
- When: load | interaction
- Impact: medium: `new RegExp(string)` in a loop was 2x slower than a hoisted regex, and each new pattern costs a parse, a native-code compile and code memory.
- Do: Define fixed patterns once at module scope. Build run-time patterns (a search prefix, a symbol list) once per input and cache them by source and flags. Use `startsWith`, `endsWith`, `includes`, `indexOf` or `split(',')` for literal checks. Do not pre-run a regex to "warm it up".
- Why: V8 compiles a regex on first execution. From Chrome 79 to 151 it first interpreted bytecode and compiled native code on the second run; since Chrome 152 it compiles native code on first use. Compiled data sits in a compilation cache keyed by (source, flags) that has only 2 generations and ages on GC, so rarely used dynamic patterns get compiled again. A regex literal inside a loop creates a new object from a cached boilerplate, which is cheap.
- Example:
  ```js
  // Before: rows.filter(r => new RegExp('^' + prefix).test(r.symbol));
  const re = new RegExp('^' + RegExp.escape(prefix));   // once per prefix
  rows.filter(r => re.test(r.symbol));
  rows.filter(r => r.symbol.startsWith(prefix));        // or no regex at all
  ```
- Avoid/caveats: A shared regex with `g` or `y` keeps `lastIndex` between calls; reset it or use a non-global regex for `test`. JIT-less configurations always interpret regexes.
- Status: Single-tier native compile in V8 15.2 / Chrome 152+ (commit 4b2ab5e9cf, 2026-07-06). `RegExp.escape` Baseline newly available (2025-05).
- Sources: https://github.com/v8/v8/commit/4b2ab5e9cf58e2d9b13d36ec98f0a417686377ee ; https://v8.dev/blog/regexp-tier-up ; https://github.com/v8/v8/blob/main/src/codegen/compilation-cache.h

### Use `test()` when you need only a yes/no answer
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, TBT, memory
- When: interaction | load
- Impact: low to medium: `test()` was 2.2x faster than `exec()` on 2e5 lines because it builds no match array.
- Do: Use `re.test(s)` for filters and validation. Use `exec`/`match` only when you read captures or the index.
- Why: V8's `test` fast path runs the matcher and returns without creating the result array (index, input, groups, capture strings).
- Example: `if (ISO_TS.test(line)) count++;  // not: if (ISO_TS.exec(line)) count++;`
- Avoid/caveats: With `g` or `y`, `test()` also advances `lastIndex`.
- Status: V8 `main` 2026-09-23 (`regexp-test.tq`).
- Sources: https://github.com/v8/v8/blob/main/src/builtins/regexp-test.tq ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec

### Anchor whole-string patterns and use the sticky flag for tokenizers
- Layer: js
- Stage: script-run
- Metrics: INP, TBT
- When: interaction | load
- Impact: low: it matters for many regex calls on long inputs that usually fail.
- Do: Anchor patterns that must match the whole string (`/^\d+(\.\d+)?$/`). For tokenizers, use a sticky (`y`) regex and set `lastIndex`.
- Why: A search tries a match at each start position in turn. Since V8 7.8 V8 stops once the rest of the input is shorter than the pattern's minimum length (20% on UniPoker). An anchored or sticky pattern tries only one position.
- Example:
  ```js
  const NUM = /\d+(?:\.\d+)?/y;
  NUM.lastIndex = pos; const m = NUM.exec(src);   // tries only at pos
  ```
- Avoid/caveats: The anchoring advice is general regex-engine behavior, not a V8 measurement.
- Status: Sticky flag ES2015, all engines; cut-off in V8 7.8+.
- Sources: https://v8.dev/blog/v8-release-78

### Write backtracking-safe patterns: no nested or overlapping quantifiers, anchors, and a cap on input length
- Layer: v8
- Stage: script-run, main-thread-task
- Metrics: INP, TBT
- When: interaction | load
- Impact: high when it happens: match time grows exponentially (`/(a*)*b/` on 18, 20, 22, 24 characters: 17, 17, 71, 285 ms), and the tab freezes on longer input.
- Do: Never nest quantifiers over the same characters (`(a+)+`, `(\w+\s?)*$`). Make alternatives mutually exclusive (`(?:\d+|[a-z]+)`, not `(?:\w+|\d+)`). Anchor patterns and limit input length before you match.
- Why: V8's default engine (Irregexp) backtracks: on a failed match it tries every other way to split the input among ambiguous quantifiers. V8's linear-time engine is off by default (`--enable-experimental-regexp-engine-on-excessive-backtracks` is experimental, and Chrome keeps V8's default); even when enabled it only covers patterns without backreferences, lookaround or the `i`/`u` flags.
- Example:
  ```js
  // Before: const LIST = /^(\w+\s?)*$/;
  const LIST = /^\w+(?:\s\w+)*$/;
  if (line.length <= 256 && LIST.test(line)) { /* … */ }
  ```
- Avoid/caveats: Irregexp is much faster than the linear engine on common patterns, so do not wish for the linear engine as a general fix.
- Status: Linear engine experimental and off in V8 `main` and Chrome (2026-09-23).
- Sources: https://v8.dev/blog/non-backtracking-regexp ; https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h

### Escape user text with `RegExp.escape`, and run user-written patterns in a worker with a time limit
- Layer: js
- Stage: script-run, main-thread-task
- Metrics: INP, TBT
- When: interaction
- Impact: medium: it stops a symbol search or a log filter from turning input into a catastrophic pattern that blocks the main thread.
- Do: Wrap user text with `RegExp.escape(text)` before you put it in a regex, or use `includes`/`indexOf` when no regex feature is needed. If users can type real patterns (an advanced filter), run the match in a Worker and terminate it after a time budget.
- Why: Irregexp cannot stop a runaway match, and the linear fallback is off. Escaping turns every metacharacter into a literal, so the input cannot add nested quantifiers.
- Example:
  ```js
  const re = new RegExp(RegExp.escape(searchBox.value.trim()), 'i');
  const hits = symbols.filter(s => re.test(s.name));
  ```
- Avoid/caveats: For browsers without `RegExp.escape`, use a small helper that escapes `\^$.*+?()[]{}|/` and `-`.
- Status: `RegExp.escape` Baseline newly available (webstatus low 2025-05-01).
- Sources: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/escape ; https://webstatus.dev/features/regexp-escape ; https://v8.dev/blog/non-backtracking-regexp

---

## 10. JSON

### Call `JSON.stringify(value)` with no `replacer` and no `space` on hot paths
- Layer: v8
- Stage: script-run, main-thread-task
- Metrics: INP, TBT
- When: interaction | long-lived session
- Impact: high for large payloads: the fast path is more than 2x faster, and any replacer or indent argument disables it for the whole call.
- Do: Pass only the value. Build a plain DTO before the call instead of passing a replacer function or key array. Pretty-print only in debug tools. Do not build JSON strings by hand for speed.
- Why: `CanUseFastStringifier` requires `replacer` and `gap` to be `undefined`; otherwise V8 uses the general recursive serializer with all its defensive checks.
- Example:
  ```ts
  // Before
  localStorage.setItem('layout', JSON.stringify(layout, (k, v) => (k === 'cache' ? undefined : v), 2));
  // After
  const { cache, ...persisted } = layout;
  localStorage.setItem('layout', JSON.stringify(persisted));
  ```
- Avoid/caveats: The speed-up is V8-only; other engines have their own implementations.
- Status: V8 13.8 / Chrome 138+. `json_stringify_fast_path` default on; "TODO: Support gap on fast-path" still in V8 `main` (2026-09-23).
- Sources: https://v8.dev/blog/json-stringify ; https://github.com/v8/v8/blob/main/src/json/json-stringifier.cc

### Serialize only plain objects and arrays: no class instances, `toJSON`, `Date`, `Map`, dictionary-mode objects or integer-like keys
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT
- When: interaction | long-lived session
- Impact: medium to high: one unsupported value anywhere in the graph makes V8 throw away the fast-path work and restart the whole call on the slow path.
- Do: Convert domain objects to plain object literals before serialization. Store times as epoch-ms numbers, not `Date`. Do not define `toJSON` on your prototypes. Send collections keyed by numeric ids as arrays of records, or prefix the keys.
- Why: The fast path accepts strings, numbers, booleans, `null`, primitive wrappers, objects whose prototype is the realm's initial `Object.prototype` with fast properties and no elements, and arrays with the initial `Array.prototype`. Anything else (class instances with their own prototype, `Date`, `Map`, dictionary-mode objects, integer-like keys such as `'42'`, which are stored as elements, and cons strings) returns SLOW_PATH, and V8 restarts from the beginning.
- Example:
  ```ts
  // Before: Position instances with Date fields -> slow path for the whole array
  JSON.stringify(positions.map(p => ({ id: p.id, qty: p.qty, openedAt: p.openedAt.getTime() })));
  // Before: JSON.stringify({ [order.id]: order });  After: JSON.stringify([{ id: order.id, ...fields }]);
  ```
- Avoid/caveats: The `map` step allocates; do it only when the payload is large or frequent, and measure. The "initial prototype" check comes from source, not from the post (the post names custom `toJSON`). BigInt values make `JSON.stringify` throw; convert them first.
- Status: V8 13.8+ (Chrome 138+); `json-stringifier.cc` in V8 `main` (2026-09-23).
- Sources: https://v8.dev/blog/json-stringify ; https://github.com/v8/v8/blob/main/src/json/json-stringifier.cc

### Serialize and parse arrays of same-shape records: same keys, same order, simple keys, stable value types
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, TBT, memory
- When: load | interaction
- Impact: medium: V8 can copy all keys of a repeated map without per-key checks when it stringifies, and build each parsed object directly with its sibling's map.
- Do: Create each record with the same keys in the same order (one literal or factory), with keys that need no escaping (`"`, `\`, control characters), no Symbol keys and only enumerable properties. Make the server send every row with the same key set and order, and keep each key's value type stable (always a number, not sometimes `null` or a string).
- Why: After V8 serializes an object, it marks its map "fast-json-iterable" when keys need no escaping and all are enumerable; the next object with that map gets its keys copied directly. JSON.parse (since V8 7.6) buffers properties first and allocates exact in-object space (up to 128 named properties) and exact-size arrays. It passes the previous sibling's map as feedback; if keys match in order and value types fit the recorded field representations, it builds the object with that map directly. Chrome 152 added a direct-layout fast path for arrays of same-shape objects in reviver-free parses.
- Example:
  ```ts
  const toRow = (t: Trade) => ({ id: t.id, px: t.price, qty: t.qty, ts: t.time });  // one shape
  JSON.stringify(trades.map(toRow));
  // wire: [{"t":1727000000,"o":101.2,"c":101.9},{"t":1727000060,"o":101.9,"c":102.4}]
  ```
- Avoid/caveats: For large numeric series, a columnar layout (`{"t":[…],"c":[…]}`) or a binary format is smaller still. Strings above U+00FF switch the stringify output buffer to two bytes.
- Status: Stringify: Chrome 138+. Parse: V8 7.6 / Chrome 76; sibling-map feedback in V8 `main`; homogeneous-array fast path Chrome 152+ (commit 72a5044f96).
- Sources: https://v8.dev/blog/json-stringify ; https://github.com/v8/v8/commit/72a5044f96ec63a70d33fa662edc8fd14a351dc8 ; https://v8.dev/blog/v8-release-76 ; https://github.com/v8/v8/blob/main/src/json/json-parser.cc

### Keep numeric JSON arrays free of `null` and strings so they parse to unboxed double arrays
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: memory, INP
- When: load | interaction
- Impact: medium: one `null` turns a raw float array into an array of boxed HeapNumbers.
- Do: Send price and value arrays that contain only numbers. Mark gaps with a separate index or mask array (or an agreed sentinel number), then copy the data into a `Float64Array` for charting.
- Why: V8 builds a JSON array of small integers as PACKED_SMI, a number array with any non-Smi value as PACKED_DOUBLE (raw doubles), and any array with a non-number as PACKED_ELEMENTS (each double boxed).
- Example:
  ```json
  {"close":[101.2,101.9],"gaps":[1]}
  ```
- Avoid/caveats: JSON cannot carry NaN; do not replace `null` with a string.
- Status: V8 `main` `json-parser.cc` (2026-09-23).
- Sources: https://github.com/v8/v8/blob/main/src/json/json-parser.cc ; https://v8.dev/blog/v8-release-76

### Parse hot payloads without a reviver; if you need one, write an arrow function with exactly two parameters
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, TBT, memory
- When: load | interaction
- Impact: medium: any reviver makes JSON.parse several times slower, and a three-parameter reviver makes V8 record source text for every value.
- Do: Parse snapshots, order books and history without a reviver, then convert only the fields you need in a typed loop. When a reviver is needed, pass `(key, value) => …` (no `arguments`, no rest, no third parameter). For 64-bit ids or exact decimals, have the server send strings, and use `context.source` and `JSON.rawJSON()` only for small payloads.
- Why: With a reviver, V8 walks the whole result and calls the function per property and element. It collects source strings unless it can prove the reviver reads only fixed formal parameters and declares fewer than three. Measured in Chrome 152 (200,000 small records): no reviver 12.2 ms; `(k, v) =>` 88.3 ms; `function (k, v)` 151.1 ms; `(k, v, ctx) =>` 150.6 ms; a function that reads `arguments` 164.6 ms.
- Example:
  ```ts
  // Before: const rows = JSON.parse(text, (key, value, ctx) => (key === 'ts' ? value * 1000 : value));
  const rows: Row[] = JSON.parse(text);
  for (const r of rows) r.ts *= 1000;
  ```
- Avoid/caveats: One machine, one payload shape. Revivers that change the graph through `this` can defeat the optimization; arrows have no own `this`.
- Status: Two-parameter detection Chrome 143+ (commits be082f4011, 2b6d499abb). JSON source text access (`context.source`, `JSON.rawJSON`) Baseline newly available since 2025-03-31.
- Sources: https://github.com/v8/v8/commit/be082f4011a9fe520f9463949be9096101d875e7 ; https://github.com/v8/v8/commit/2b6d499abb6ab9423af94c11acda73c93ebf0c1a ; https://github.com/v8/v8/blob/main/src/json/json-parser.cc ; https://v8.dev/blog/holiday-season-2023

### Ship large static data (10 kB or more) as JSON: `JSON.parse('…')`, a bundler JSON import, or a JSON module
- Layer: build
- Stage: script-compile, script-run
- Metrics: startup, TBT, LCP
- When: build | load
- Impact: medium for big configs, symbol tables and fixtures: JSON.parse was 1.7x faster than the equivalent object literal in V8, with gains in all major engines.
- Do: Keep data as `.json` files and import them through the bundler (Vite `json.stringify: 'auto'` turns files over 10 kB into `JSON.parse("…")`), or in unbundled code with `import data from './levels.json' with { type: 'json' }`. In code generators, emit `JSON.parse(${JSON.stringify(JSON.stringify(data))})`. If a big literal must stay, put it at module top level, not inside a function.
- Why: JSON's grammar is much simpler than JavaScript's, so it parses faster. A big literal inside a lazily compiled function is pre-parsed once and parsed again when the function runs. Since ES2019, JSON is a subset of ECMAScript (U+2028/U+2029 are allowed in string literals), so double-stringified output is always a valid JS string literal.
- Example:
  ```js
  // build/emit-symbols.mjs
  const literal = JSON.stringify(JSON.stringify(symbolTable));
  await writeFile('src/generated/symbols.js', `export default JSON.parse(${literal});\n`);
  ```
- Avoid/caveats: The gain holds only if the string is parsed once. Objects from JSON.parse with 128 or more keys start in dictionary mode. Never hand-edit generated files; change the generator.
- Status: Still valid. JSON modules Baseline newly available since 2025-04-29 (Chrome 123, Firefox 138, Safari 17.2). Vite's `'auto'` default cites the V8 post.
- Sources: https://v8.dev/blog/cost-of-javascript-2019 ; https://v8.dev/features/subsume-json ; https://vite.dev/config/shared-options

### Inline server data in HTML as a `<script type="application/json">` block and parse it with `JSON.parse`
- Layer: html
- Stage: html-parse, script-compile, script-run
- Metrics: startup, TBT, LCP
- When: load
- Impact: medium: the data block is never compiled as JavaScript, and a wrong escape is an XSS hole.
- Do: Emit initial state as `<script type="application/json" id="boot">…</script>` and read it with `JSON.parse(el.textContent)`. Escape every `<` in the JSON as `<`. If you must emit executable JS, also escape U+2028/U+2029 wherever the value is not inside a string literal.
- Why: HTML treats a `script` whose type is not a JavaScript MIME type (or `module`, `importmap`, `speculationrules`) as a data block that it does not process. U+2028/U+2029 are still line terminators outside string literals, so JSON placed in other positions can break out.
- Example:
  ```html
  <script type="application/json" id="boot">{"symbols":["AAPL","MSFT"],"theme":"dark"}</script>
  <script type="module">const boot = JSON.parse(document.getElementById('boot').textContent);</script>
  ```
- Avoid/caveats: Do not read or write the block with `innerHTML`.
- Status: WHATWG HTML (data blocks, restrictions for contents of script elements).
- Sources: https://html.spec.whatwg.org/multipage/scripting.html#the-script-element ; https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements ; https://v8.dev/features/subsume-json

---

## 11. Iteration and built-ins

### Use for-in only on fast-mode objects with no integer-like keys and no enumerable prototype properties; define methods with class syntax
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT, FPS/smoothness
- When: interaction | animation/render-loop
- Impact: medium: on the fast path V8 reuses a cached key list and turns `obj[key]` into a map check plus a field load (1e6 loops over 6 keys: 9 ms fast, 106 ms dictionary mode, 283 ms integer keys; one enumerable prototype method: 130 ms vs 10 ms).
- Do: Iterate with for-in only over plain objects or class instances with a stable shape, and read `obj[key]` from the object you iterate. Declare methods in `class` bodies (non-enumerable), not as `Ctor.prototype.fn = …`, and never add enumerable properties to `Object.prototype`. Give hot fast-object loops their own function instead of a shared `forEachKey(obj, fn)` that also sees dictionary objects, arrays or proxies.
- Why: Each map's descriptor array has an EnumCache of enumerable named keys. `ForInEnumerate` uses it only if the receiver has an initialized cache (dictionary-mode objects never do), the receiver and all prototypes have no elements, and every prototype has zero enumerable properties; otherwise the C++ `KeyAccumulator` walks the chain and allocates keys on each loop entry. Each for-in site records feedback, and once it sees an object without a usable cache, Maglev and TurboFan compile the generic mode for every object that goes through it.
- Example:
  ```js
  // Before (ES5 style): enumerable method on the prototype disables the enum cache
  function Bar() { this.o = 1; this.c = 2; }  Bar.prototype.range = function () { return this.c - this.o; };
  // After
  class Bar2 { constructor() { this.o = 1; this.c = 2; } range() { return this.c - this.o; } }
  let sum = 0; for (const k in bar) sum += bar[k];   // map check + field load by index
  ```
- Avoid/caveats: Direct field access is faster still (see below). Loose-mode transpilation of classes to ES5 can bring enumerable prototype members back; keep an ES2015+ target.
- Status: V8 `main` 2026-09-23 (`CheckEnumCache`, `CheckPrototypeEnumCache`, `ForInMode`). The fast path shipped in Chrome 51/57.
- Sources: https://v8.dev/blog/fast-for-in ; https://github.com/v8/v8/blob/main/src/codegen/code-stub-assembler.cc

### Never use for-in on arrays or on objects keyed by integers; use indexed loops, `Map`, or a typed array
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: interaction | animation/render-loop | long-lived session
- Impact: high for order books and per-price tables: integer-like keys are elements, so every for-in takes the runtime path and creates index strings (31x slower than a fast object locally).
- Do: Iterate arrays with an index loop or `for…of`. For tables keyed by numeric price or id, use `Map<number, T>`, a sorted array plus binary search, or a typed array indexed by `(price - minPrice) / tick` for dense ranges.
- Why: Keys `"0"` to `"4294967294"` live in the elements store, not as named properties. The EnumCache holds only named keys, so any receiver with elements goes to the runtime, which converts every index to a string on each loop entry; the loop variable is then a string and `arr[key]` is a string-keyed load.
- Example:
  ```js
  // Before: const book = {}; book[10125] = 3; for (const p in book) total += book[p];
  const book = new Map([[10125, 3], [10150, 7]]);
  for (const [, size] of book) total += size;
  ```
- Avoid/caveats: A Map has its own per-entry cost.
- Status: V8 `main` 2026-09-23.
- Sources: https://v8.dev/blog/fast-for-in ; https://github.com/v8/v8/blob/main/src/codegen/code-stub-assembler.cc

### Do not add or delete properties on an object inside its own for-in loop
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: low to medium: after a shape change every remaining key goes through a slow lookup, and `delete` can send the object to dictionary mode.
- Do: Collect changes in a separate list and apply them after the loop, or build a new object.
- Why: `ForInNext` compares the receiver's current map with the cached one; if they differ, `ForInNextSlow` runs a full property lookup per key (the spec requires skipping deleted keys).
- Example:
  ```js
  // Before: for (const k in cfg) if (cfg[k] == null) delete cfg[k];
  const clean = {}; for (const k in cfg) if (cfg[k] != null) clean[k] = cfg[k];
  ```
- Avoid/caveats: None beyond the extra allocation.
- Status: V8 `main` 2026-09-23 (`interpreter-generator.cc`).
- Sources: https://v8.dev/blog/fast-for-in

### Read known fields directly in hot loops; never call `Object.entries` or `Object.keys` per frame
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop
- Impact: medium: direct access was 18x faster than for-in and 50x faster than `Object.entries` locally, and `entries` allocates an array per property per call.
- Do: When the shape is known (OHLC bars, points, series styles), write `b.open + b.high + …` or keep the values in typed-array columns. For generic iteration prefer for-in or `Object.values`, and compute a key list once and reuse it.
- Why: `Object.keys` copies the enum cache into a new array on every call. `Object.entries` allocates a two-element array per property plus the outer array. for-in with an enum cache allocates no key array; direct named loads are one field load each.
- Example:
  ```js
  // Before: for (const [k, v] of Object.entries(bar)) acc[k] += v;
  acc.open += bar.open; acc.high += bar.high; acc.low += bar.low; acc.close += bar.close;
  ```
- Avoid/caveats: TurboFan escape analysis can remove some short-lived arrays when everything inlines; do not rely on it.
- Status: V8 `main` 2026-09-23 (`builtins-object-gen.cc`).
- Sources: https://github.com/v8/v8/blob/main/src/builtins/builtins-object-gen.cc ; https://v8.dev/blog/fast-for-in

### Use native destructuring, spread, `for…of`, generators and async functions; do not desugar them by hand for speed
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT, bundle-size
- When: interaction | animation/render-loop
- Impact: low to medium: hand-desugaring buys no speed and costs bytes.
- Do: Write `const { open, high, low, close } = bar;`, `const [first] = arr`, `for (const x of arr)` and `async function*` directly. In measured hot loops over large arrays, an indexed `for` loop is still a fine choice.
- Why: Ignition and TurboFan support the whole language. Since V8 7.8 object destructuring compiles to the same bytecode as plain property loads. Array destructuring reached parity with `data[0]` and beats Babel's `_slicedToArray`.
- Example: `const { open, high, low, close } = bar;  // same bytecode as four property loads`
- Avoid/caveats: Array destructuring and `for…of` over non-arrays use the iterator protocol (fast only while array iterators are unpatched). Object rest (`const { a, ...rest } = o`) always allocates.
- Status: V8 7.8 / Chrome 78+ for destructuring; features Baseline widely available.
- Sources: https://v8.dev/blog/v8-release-78 ; https://v8.dev/blog/high-performance-es2015

### Copy arrays with a leading spread or `Array.from`; spread `Set`s and Map keys or values, not Map entries
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: animation/render-loop | interaction
- Impact: medium: the fast path is about 3x faster than the old iterator path and about 25% faster than a hand-written copy loop; Set and Map key/value spreads are 14-18x faster than before.
- Do: Use `[...arr]`, `[...arr, x]` or `Array.from(iterable)` (no map function) for shallow copies, with the spread first in the literal. Use `[...set]`, `[...map.keys()]`, `[...map.values()]`; treat `[...map]` and `[...map.entries()]` as the slower generic path. `[...string]` is also fast.
- Why: Since V8 7.2, when the source is a fast array, V8 skips the iterator object and the per-step result objects and allocates the result at its final size; this applies when the spread comes first, not after other elements. Sets and map key/value iterators have their own fast paths; direct Map spread and `entries()` were left out as uncommon.
- Example:
  ```js
  const copy = [...prices];          // fast path
  const withPrev = [prev, ...prices]; // generic iteration path
  const ids = [...seriesById.keys()]; // fast path
  ```
- Avoid/caveats: `arr.slice()` keeps holes; spread turns holes into `undefined`. Whether a second spread (`[...a, ...b]`) or `Array.from(x, fn)` get fast paths was not verified; use `a.concat(b)` or `arr.map(fn)` when unsure.
- Status: V8 7.2 / Chrome 72+.
- Sources: https://v8.dev/blog/spread-elements

### Never patch array or iterator built-ins
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: load | long-lived session
- Impact: medium: one patch can disable fast paths for every array in the page.
- Do: Do not define an own `Symbol.iterator` on arrays, and do not overwrite `next` on `%ArrayIteratorPrototype%` or the Set/Map/String iterator prototypes. Audit polyfills and libraries that do.
- Why: Spread, `Array.from`, array destructuring and `for…of` are specified through the iteration protocol, so V8 takes its fast paths only while the original machinery is untouched. Patching the shared iterator prototype affects all arrays.
- Example: `Object.getPrototypeOf([][Symbol.iterator]()).next = customNext; // never do this`
- Avoid/caveats: None.
- Status: V8 7.2+.
- Sources: https://v8.dev/blog/spread-elements

### Always pass a numeric comparator to `Array.prototype.sort` for numbers
- Layer: js
- Stage: script-run
- Metrics: INP, TBT
- When: interaction | load
- Impact: high for correctness and medium for speed: the default sort compares strings (`80` before `9`) and was 3.2x slower on 1e6 doubles.
- Do: Use `arr.sort((a, b) => a - b)` for ascending numbers; use a collator for strings (section 4).
- Why: Without a comparator the spec compares `ToString` results in UTF-16 order, so V8 calls `toString` on both values for every comparison.
- Example: `prices.sort((a, b) => a - b); // not prices.sort()`
- Avoid/caveats: `a - b` is correct for finite numbers only; remove or map `NaN` first.
- Status: Baseline widely available.
- Sources: https://v8.dev/blog/array-sort ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort

### Sort typed arrays with `.sort()` and no comparator; reverse for descending order
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT, memory
- When: interaction | load
- Impact: medium: the default path is a C++ sort on the raw buffer (61 ms vs 241 ms with `(a, b) => a - b` on 1e6 Float64 values) and allocates no JS objects.
- Do: For ascending numeric order on `Float64Array`, `Int32Array` and similar, call `ta.sort()`; for descending, `ta.sort().reverse()`. Pass a comparator only for a non-numeric order.
- Why: With no comparator V8 runs `std::sort` in place with a numeric compare (-0 before +0, NaN last). With a comparator it copies all elements into two tagged arrays (boxing doubles), merge-sorts while calling your function, and writes back.
- Example: `xs.sort(); xs.reverse(); // not xs.sort((a, b) => b - a)`
- Avoid/caveats: `std::sort` is not stable, which does not matter for plain numbers. To sort records by a numeric key, sort an index array or packed keys.
- Status: V8 `main` 2026-09-23 (`typed-array-sort.tq`, `Runtime_TypedArraySortFast`).
- Sources: https://github.com/v8/v8/blob/main/src/builtins/typed-array-sort.tq ; https://v8.dev/blog/array-sort

### Write pure, consistent, cheap comparators: precompute sort keys and never change the array while it sorts
- Layer: js
- Stage: script-run
- Metrics: INP, TBT
- When: interaction | load
- Impact: medium: the comparator runs O(n log n) times as a builtin-to-JS call, and a comparator that changes the array drops V8 to the generic path.
- Do: Return negative, zero or positive with no side effects (reflexive, anti-symmetric, transitive). When the comparator computes something (date parsing, `toLowerCase`, `localeCompare` with options), compute a key once per element, sort the keys or an index array, then reorder. Shuffle with Fisher-Yates, never with a random comparator.
- Why: V8 copies non-undefined values into a work array, sorts, and writes them back. After every return from user code it compares the receiver's map and length with the initial ones and switches to generic element accessors if they changed. A JS comparison is about an order of magnitude costlier than a memory access; in the Web Tooling Benchmark one comparator took a third of `chai`'s time.
- Example:
  ```js
  // Before: trades.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));   // parses n log n times
  const keyed = trades.map(t => ({ t, k: Date.parse(t.ts) }));
  keyed.sort((a, b) => a.k - b.k);
  const sorted = keyed.map(x => x.t);
  ```
- Avoid/caveats: The map-sort pattern allocates two arrays; use it only when the comparator is expensive. Sort never passes `undefined` to the comparator.
- Status: V8 `main` 2026-09-23 (`array-sort.tq`).
- Sources: https://v8.dev/blog/array-sort ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort

### Rely on stable sorting: remove index tie-breakers and "stable sort" helpers
- Layer: js
- Stage: script-run
- Metrics: bundle-size, INP
- When: build | interaction
- Impact: low: it removes comparator work and code.
- Do: Sort by the secondary key first and then by the primary key, or chain both keys in one comparator. Do not add an original-index field only to keep ties in order.
- Why: V8 made `Array.prototype.sort` stable in Chrome 70 (TimSort), and ES2019 requires stability in all engines. In 2026 V8 replaced TimSort with PowerSort, which is also a stable adaptive merge sort.
- Example: `rows.sort((a, b) => a.time - b.time); // before: decorate with index as a tie-breaker`
- Avoid/caveats: The default typed-array sort is not stable.
- Status: PowerSort in V8 14.9 / Chrome 149+ (stable 2026-06-02; commit 8899b945f6).
- Sources: https://github.com/v8/v8/commit/8899b945f6b95d5801e23f1021d2d576f3e73b70 ; https://v8.dev/blog/array-sort

### Let the sort use presorted runs; insert single late items with a binary search
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: interaction | long-lived session
- Impact: medium: a presorted 1e6-element array sorted in 6.8 ms vs 152 ms for random data.
- Do: For series that arrive mostly in order, append the few late ticks and call `sort`. For a stream of single inserts in a render loop, insert each item with a binary search instead of re-sorting.
- Why: TimSort and PowerSort detect ascending and strictly descending runs, reverse descending ones, and merge runs; sorted input is one run and costs O(n) comparisons.
- Example:
  ```js
  series.push(...lateTicks);
  series.sort((a, b) => a.t - b.t);   // near-linear on mostly sorted input
  ```
- Avoid/caveats: Each call still reads every element and calls the comparator at least n-1 times.
- Status: PowerSort keeps TimSort's behavior on sorted inputs (commit 8899b945f6).
- Sources: https://v8.dev/blog/array-sort ; https://github.com/v8/v8/commit/8899b945f6b95d5801e23f1021d2d576f3e73b70

### For small sorts in hot code, sort packed arrays with a comparator known at the call site
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: low to medium: arrays of 16 or fewer elements avoid the builtin-to-JS call per comparison (for example z-ordering a few series per frame).
- Do: Keep the array packed and of one elements kind per call site. Pass the comparator as an arrow literal at the call site or as a module-level constant. Sort a reused scratch array in place.
- Why: Since Chrome 149, `arr.sort(cmp)` becomes an inline insertion sort when the length is at most 16, the comparator is statically known, and all receiver maps share one elements kind. TurboFan supports PACKED_SMI and PACKED_ELEMENTS; Maglev all packed kinds. Deopts continue in the generic PowerSort.
- Example:
  ```js
  const byZ = (a, b) => a.z - b.z;
  function drawFrame(visible) { visible.sort(byZ); for (const s of visible) s.draw(); }
  ```
- Avoid/caveats: Holey arrays, TurboFan-compiled double arrays and comparators passed through a changing variable are not inlined. The gain is small unless the sort runs very often.
- Status: V8 14.9 / Chrome 149+ (commits 66a3f1e94d, e0562d87ad).
- Sources: https://github.com/v8/v8/commit/66a3f1e94d4b681bff6476a876067a3c79a853f0 ; https://github.com/v8/v8/blob/main/src/compiler/js-call-reducer.cc

### Sort scratch arrays in place; use `toSorted()` only when the original must not change
- Layer: js
- Stage: script-run, gc-memory
- Metrics: memory, FPS/smoothness
- When: animation/render-loop | interaction
- Impact: low: it avoids one array copy per call.
- Do: In per-frame code, sort a scratch array that you own in place. Use `toSorted()` in UI or state code where the source must stay unchanged (reactive state).
- Why: `toSorted()` copies the array and then runs the same sort. Every sort also allocates a sort state and a merge buffer of up to n/2, which are short-lived but add GC pressure in a render loop.
- Example: `scratch.length = 0; for (const s of series) scratch.push(s); scratch.sort(byZ);`
- Avoid/caveats: Do not reuse an array that other code still reads.
- Status: `toSorted` Baseline widely available since 2026-01-04.
- Sources: https://webstatus.dev/features/array-by-copy ; https://v8.dev/blog/array-sort

### Use iterator helpers for early-exit pipelines over large or lazy sources, not as a general loop replacement
- Layer: js
- Stage: script-run, gc-memory
- Metrics: memory, INP
- When: interaction
- Impact: low: the win appears only when a chain stops early or would build large intermediate arrays.
- Do: For "first N matches" or "any match" over a big Map, Set or generator, use `iter.filter(…).map(…).take(n)`, `.some()` or `.find()` on the iterator instead of copying to an array first. Keep plain indexed loops for full passes over dense arrays and typed arrays.
- Why: Iterator helpers are lazy: each value flows through the whole chain, and `take`, `some` and `find` stop pulling once they have the answer, so no intermediate arrays are built. Each stage costs one iterator-protocol step per value.
- Example:
  ```ts
  // Before: [...orders.values()].filter(o => o.open).map(toRow).slice(0, 20);
  const top = orders.values().filter(o => o.open).map(toRow).take(20).toArray();
  ```
- Avoid/caveats: "Plain loops win on full passes" is from the mechanism, not measured.
- Status: Baseline newly available since 2025-03-31 (Chrome 122, Firefox 131, Safari 18.4); the v8.dev support table is stale.
- Sources: https://v8.dev/features/iterator-helpers ; https://v8.dev/blog/holiday-season-2023 ; https://cdn.jsdelivr.net/npm/web-features/data.json

### Look up a `Map` once per operation: `get` and test for `undefined`, or `getOrInsertComputed`
- Layer: js
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: animation/render-loop | interaction
- Impact: low to medium, only in tight loops over large tables.
- Do: Write `let b = m.get(key); if (b === undefined) { b = []; m.set(key, b); }`, or `m.getOrInsertComputed(key, () => [])` where Baseline 2026 is acceptable. Avoid `has` + `get` + `set`.
- Why: Each call hashes the key and probes the table. For object keys that means reading the stored hash; for strings, the cached string hash. `has` then `get` does it twice.
- Example: `const bucket = byPrice.getOrInsertComputed(price, () => []);`
- Avoid/caveats: `getOrInsert(key, [])` evaluates its argument on every call, so it allocates. When `undefined` is a valid stored value you still need `has`.
- Status: `getOrInsert`/`getOrInsertComputed` Baseline newly available (webstatus low 2026-02-14; Chrome 145, Firefox 144, Safari 26.2).
- Sources: https://webstatus.dev/features/getorinsert ; https://v8.dev/blog/hash-code

---

## 12. WebAssembly interop

### Load `.wasm` with `WebAssembly.instantiateStreaming` on a `fetch()` response
- Layer: v8
- Stage: network, script-compile
- Metrics: startup, TBT, LCP
- When: load
- Impact: high: it is the only path that reads and writes Chrome's Wasm code cache, and it compiles while bytes download.
- Do: Pass the `fetch()` promise straight to `WebAssembly.instantiateStreaming(fetch(url), imports)` (or `compileStreaming`). Do not `await res.arrayBuffer()` and then call `WebAssembly.instantiate(bytes)`. If a library loads the module (Emscripten output, SciChart.js), confirm that its loader takes the streaming branch.
- Why: Chrome keys the Wasm code cache on the URL of the streamed response; the ArrayBuffer path has no URL, so V8 compiles from scratch on every load. On a hot run Chrome reads the resource and the cached code in parallel and deserializes machine code.
- Example:
  ```js
  // Before: const bytes = await (await fetch('/engine.wasm')).arrayBuffer(); await WebAssembly.instantiate(bytes, imports);
  const { instance } = await WebAssembly.instantiateStreaming(fetch('/engine.wasm'), imports);
  ```
- Avoid/caveats: The SciChart.js 5.2.69 loader uses streaming when `fetch` exists and the URL is not a `data:` URI; on failure it logs "wasm streaming compile failed" and silently falls back to the uncached path. Never inline a large module as base64 or a data URI.
- Status: `compileStreaming`/`instantiateStreaming` Chrome 60, Firefox 58, Safari 15. Code-cache behavior is Chrome only.
- Sources: https://v8.dev/blog/wasm-code-caching ; https://v8.dev/docs/wasm-compilation-pipeline ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/_wasm/scichart2d.js

### Serve `.wasm` with exactly `Content-Type: application/wasm` and a 2xx or 304 status
- Layer: network
- Stage: network, script-compile
- Metrics: startup, TBT
- When: load | build
- Impact: high: a wrong header makes streaming throw, and loaders then fall back to the uncached ArrayBuffer path.
- Do: Configure the server or CDN to send `Content-Type: application/wasm` with no parameters (no `; charset=…`). Check the header in DevTools Network and watch the console for loader fallback messages.
- Why: Blink compares the whole header to `application/wasm` (case-insensitive) and rejects extra parameters, and it rejects responses that are not ok.
- Example: `types { application/wasm wasm; }  # nginx, no charset on this type`
- Avoid/caveats: Some static hosts add `charset=utf-8` to every type.
- Status: Chromium `v8_wasm_response_extensions.cc` (main 2026-09-23); WebAssembly Web API rule.
- Sources: https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/bindings/core/v8/v8_wasm_response_extensions.cc ; https://v8.dev/blog/wasm-code-caching

### Keep the `.wasm` URL and bytes stable between visits; version by content hash, never by a per-load query string
- Layer: network
- Stage: network, script-compile
- Metrics: startup, TBT
- When: build | load
- Impact: high: a URL change, a new 200 response or changed bytes discard the cached machine code and force a cold compile.
- Do: Put a content hash in the file name (`engine.3f9a1c.wasm`) with a long `Cache-Control` lifetime, or answer revalidation with 304. Never append `?t=Date.now()`. Copy library `.wasm` files from the same package version as their JS.
- Why: Cached code is looked up by URL (query included). A 200 response replaces the cached resource; a 304 keeps it. Blink also stores a SHA-256 digest of the wire bytes and drops the entry when they differ. Every Chrome update invalidates the entry too, and since Chrome 153 updates come every 2 weeks (Extended Stable stays on 8 weeks).
- Example: `const url = new URL('./engine.3f9a1c.wasm', import.meta.url);`
- Avoid/caveats: Expect one cold compile per browser update per user.
- Status: Chromium source (digest check, URL key), 2026-09-23. Release cadence: Chrome blog 2026-03-03 and chromiumdash.
- Sources: https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/bindings/core/v8/v8_wasm_response_extensions.cc ; https://developer.chrome.com/blog/chrome-two-week-release ; https://v8.dev/blog/wasm-code-caching

### Expect the Wasm code cache to hold only hot, optimized code, and measure warm starts after a real session
- Layer: v8
- Stage: script-compile, idle
- Metrics: startup
- When: long-lived session | load
- Impact: medium: it sets the right expectation for cold versus warm starts.
- Do: Do not pad or merge modules to pass a size threshold. Measure a warm start only after a session that exercised the real hot paths (for example rendering a chart with data) for several seconds.
- Why: Under dynamic tiering V8 compiles each function lazily with Liftoff on first call and recompiles only hot functions with TurboFan in the background. Chrome caches only TurboFan code, because Liftoff compiles almost as fast as a cache load. In V8 `main` a caching event fires when at least 1,000 units of new top-tier code exist and no new TurboFan code appeared for 2,000 ms (or at once past 1,000,000). Small or cold modules may never be cached.
- Example: none (expectation rule).
- Avoid/caveats: These flag values are internal tuning. The 2019 post's cap of about 150 MB per entry was not re-verified.
- Status: Replaces the 2019 "cache only modules ≥ 128 kB after full TurboFan compile" rule (V8 flags checked 2026-09-23).
- Sources: https://v8.dev/docs/wasm-compilation-pipeline ; https://v8.dev/blog/wasm-dynamic-tiering ; https://v8.dev/blog/wasm-code-caching

### Compile and warm Wasm off the critical path: pre-compile in a worker or service worker, and exercise first-interaction code while idle
- Layer: v8
- Stage: script-compile, main-thread-task, idle
- Metrics: startup, INP, TBT
- When: load | interaction
- Impact: medium: every user pays at least one cold compile per browser version, and each first call of a Wasm function compiles it with Liftoff on the calling thread.
- Do: After first paint, pre-fetch and `WebAssembly.compileStreaming()` the module in a worker or service worker from the same URL the page uses (keep the response in Cache Storage if the service worker serves it). While the page is idle, call the likely first-interaction paths once (render a tiny data set, run zoom/pan kernels on dummy data), in the thread that will run them.
- Why: Wasm code caching works in workers and service workers, and responses served from Cache Storage also get cached code. V8 compiles no function up front; in lazy mode the first call compiles it with Liftoff and blocks. Liftoff is fast (tens of MB per second), but hundreds of functions add up, and warm-up also starts the tier-up budget earlier.
- Example: `requestIdleCallback(() => wasm.exports.renderPreview(tinyPtr, 64));`
- Avoid/caveats: A module compiled in a worker must be transferred (`postMessage(module)`) or recompiled; the cache helps only if the page then streams the same URL. Warm-up uses CPU; schedule it after LCP. It does not help functions that it never calls.
- Status: Chrome behavior (2019 post, Blink source 2026-09); lazy Wasm compilation default since V8 commit 29131d5e3e (2022-11).
- Sources: https://v8.dev/blog/wasm-code-caching ; https://v8.dev/docs/wasm-compilation-pipeline

### Put hot Wasm loops in functions that are called many times, not in one long call
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, TBT
- When: animation/render-loop | long-lived session
- Impact: medium to high: a loop inside a single call stays in Liftoff code for that whole call, and Liftoff code ran about 50-70% slower than TurboFan in the 2018 measurements.
- Do: Structure Wasm work as a function called per chunk, frame or batch (`processBatch(ptr, off, len)`), not as one `run()` that loops for seconds.
- Why: V8 has no on-stack replacement for Wasm: a call that started in Liftoff finishes in Liftoff even after TurboFan code is ready. Liftoff charges the tier-up budget at loop back edges, so the function gets queued, but only later calls benefit.
- Example:
  ```js
  // Before: wasm.exports.decimateAll(ptr, totalPoints);
  for (let off = 0; off < totalPoints; off += CHUNK)
    wasm.exports.decimateChunk(ptr, off, Math.min(CHUNK, totalPoints - off));
  ```
- Avoid/caveats: Chunking also lets JS yield between chunks. Do not make chunks so small that call overhead dominates.
- Status: Current (pipeline doc; no Wasm OSR flag in V8 `main` 2026-09-23).
- Sources: https://v8.dev/docs/wasm-compilation-pipeline ; https://v8.dev/blog/wasm-dynamic-tiering ; https://v8.dev/blog/liftoff

### Keep Wasm binaries small and run Binaryen `wasm-opt` on every release build
- Layer: build
- Stage: network, script-compile, script-run
- Metrics: bundle-size, startup, memory, FPS/smoothness
- When: build
- Impact: medium: never-called code still costs download, decoding and validation, and `wasm-opt` made J2Wasm output 1.9x faster on average.
- Do: Strip unused code (link-time dead-code elimination), avoid pulling whole libraries for one function, and split large rarely used features into a separately loaded module. Build release Wasm at `-O2`/`-O3`/`-Os` so Emscripten runs Binaryen, or run `wasm-opt -O3` (speed) or `-Oz` (size) yourself. Never ship `-O0` builds.
- Why: Lazy compilation removes most compile cost for cold code but not transfer and decoding cost. Binaryen runs escape analysis, devirtualization, global dead-code elimination and type-aware optimizations, and shrinks MVP output.
- Example: `emcc engine.c -O3 -o engine.js   # or: wasm-opt -O3 app.wasm -o app.opt.wasm`
- Avoid/caveats: For a third-party engine (SciChart.js) you cannot shrink the binary; make sure it streams and caches, and load it early.
- Status: Current (2023 WasmGC post, Liftoff post, pipeline doc).
- Sources: https://v8.dev/blog/wasm-gc-porting ; https://v8.dev/blog/liftoff ; https://v8.dev/features/wasm-bigint

### Leave CPU headroom for background TurboFan compiles when you size worker pools
- Layer: js
- Stage: script-compile, main-thread-task
- Metrics: startup, INP, TBT
- When: load
- Impact: low to medium on machines with few cores during the first seconds after a large module starts.
- Do: Size compute worker pools below `navigator.hardwareConcurrency` (for example `hardwareConcurrency - 1`, at least 1), and start heavy worker jobs after the module has warmed up when startup matters.
- Why: The dynamic-tiering post notes that background TurboFan compilation competes for cores with the app's workers; V8 `main` allows up to 128 Wasm compile tasks.
- Example: `const poolSize = Math.max(1, (navigator.hardwareConcurrency || 2) - 1);`
- Avoid/caveats: Inference from the post; not measured.
- Status: Current (dynamic tiering default).
- Sources: https://v8.dev/blog/wasm-dynamic-tiering

### Measure Wasm at steady state with `v8.wasm` trace events, and never benchmark Wasm with DevTools open
- Layer: tooling
- Stage: script-compile, script-run
- Metrics: FPS/smoothness, startup
- When: testing
- Impact: medium: early samples mix Liftoff code, lazy compiles and deopts, and open DevTools changes the tier.
- Do: Run the workload until timings stabilize, or report cold and warm numbers separately. In a clean profile, record a Perfetto trace: `devtools.timeline` events show `v8.wasm.compiledModule` and `v8.wasm.cachedModule` (cold), `v8.wasm.moduleCacheHit` (hot), `v8.wasm.moduleCacheInvalid…` (stale); the `v8.wasm` category shows `wasm.BaselineFinished` and `wasm.TopTierFinished`. Time runs with DevTools closed or inside a Performance recording.
- Why: Opening DevTools tiers all Wasm down to Liftoff for debugging; starting a Performance recording tiers it back up. Only functions that used their tier-up budget run TurboFan code, and speculative inlining needs feedback collected in Liftoff first.
- Example: Perfetto UI → Record → categories `devtools.timeline`, `v8.wasm` → load twice → filter `v8.wasm`.
- Avoid/caveats: `chrome://tracing` is superseded by the Perfetto UI; the categories are the same.
- Status: Event names in current Chromium source (2026-09-23).
- Sources: https://v8.dev/docs/wasm-compilation-pipeline ; https://v8.dev/blog/wasm-code-caching ; https://v8.dev/blog/wasm-speculative-optimizations

### Compile compute-heavy Wasm with SIMD (`-msimd128`, Rust `+simd128`) and ship one SIMD build for Baseline targets
- Layer: build
- Stage: script-run, network
- Metrics: FPS/smoothness, INP, bundle-size
- When: build | animation/render-loop
- Impact: high for data-parallel kernels (decimation, indicators, min/max scans, color conversion): one instruction handles 4 × i32/f32 or 2 × f64 lanes; the MediaPipe demo went from 14-15 to 38-40 FPS.
- Do: Pass `-msimd128` with `-O2`/`-O3` (Emscripten/clang) or `RUSTFLAGS="-C target-feature=+simd128"`. Write hot loops as simple counted loops over contiguous arrays so the autovectorizer can use them. If your target is "Baseline widely available", ship only the SIMD build; keep a feature-detected non-SIMD build only for older engines.
- Why: The flag enables the 128-bit `v128` type and LLVM's loop and SLP vectorizers. A module that uses SIMD opcodes fails validation in an engine without SIMD, so dual builds were needed until all engines shipped it (Safari 16.4, March 2023).
- Example:
  ```sh
  emcc -O3 -msimd128 indicators.c -o indicators.js
  RUSTFLAGS="-C target-feature=+simd128" cargo build --release --target wasm32-unknown-unknown
  ```
- Avoid/caveats: SIMD does not help pointer-chasing or branchy code; `f64x2` has only 2 lanes. `-fno-vectorize -fno-slp-vectorize` turn the autovectorizer off if it grows code without gain.
- Status: Fixed-width SIMD Baseline widely available since 2025-09-27 (Chrome 91, Firefox 89, Safari 16.4).
- Sources: https://v8.dev/features/simd ; https://emscripten.org/docs/porting/simd.html ; https://cdn.jsdelivr.net/npm/web-features/data.json

### Hand-write SIMD intrinsics for the hottest kernels, and avoid SIMD operations that are slow on x86
- Layer: build
- Stage: script-run
- Metrics: FPS/smoothness, bundle-size
- When: animation/render-loop
- Impact: medium: intrinsics that know alignment and lengths skip the autovectorizer's guard code, and one slow op can become 7-14 x86 instructions.
- Do: For kernels that dominate a profile, use `wasm_simd128.h` (C/C++) or `core::arch::wasm32` (Rust). Keep buffers 16-byte aligned and non-overlapping, and pad lengths to a lane multiple or handle the tail in scalar code. For min/max over data without NaN, use `pmin`/`pmax` instead of `min`/`max`; avoid `i8x16` shifts, `i64x2.shr_s`, `i8x16`/`i64x2` multiply and `trunc_sat` in inner loops.
- Why: The autovectorizer cannot assume alignment, non-aliasing or a lane-multiple length, so it adds code. Wasm SIMD fixes NaN and signed-zero semantics that x86 does not match in one instruction, so engines emit fix-up sequences (Emscripten table: float min/max 7-10 instructions, i8x16 shifts 5-11, `i64x2.shr_s` 6-12, saturating truncation 8-14).
- Example:
  ```c
  #include <wasm_simd128.h>
  // n is a multiple of 4; buffers are 16-byte aligned and do not overlap
  void mul4(float* out, const float* a, const float* b, int n) {
    for (int i = 0; i < n; i += 4)
      wasm_v128_store(out + i, wasm_f32x4_mul(wasm_v128_load(a + i), wasm_v128_load(b + i)));
  }
  ```
- Avoid/caveats: `pmin`/`pmax` return one of the inputs for NaN or ±0. Costs are for x86; ARM differs. `#define WASM_SIMD_COMPAT_SLOW` warns about slow paths in SSE ports. Rust intrinsics are stable since Rust 1.54 (no nightly needed).
- Status: Emscripten SIMD docs (2026-09-23).
- Sources: https://emscripten.org/docs/porting/simd.html ; https://v8.dev/features/simd

### Use relaxed SIMD only for visual output that may differ between machines, behind feature detection
- Layer: build
- Stage: script-run
- Metrics: FPS/smoothness
- When: build | animation/render-loop
- Impact: low to medium: relaxed FMA, swizzle and dot products are faster on hardware that has them, but results can change by CPU.
- Do: Enable relaxed SIMD (`-mrelaxed-simd` with `-msimd128`) only in a separately detected build and only for pixel or vertex math. Keep prices, P&L, indicator values and anything compared across clients on fixed-width SIMD or scalar code.
- Why: Its 20 instructions have implementation-defined results (fused or unfused multiply-add, NaN handling in min/max, out-of-range truncation and swizzle indices, signedness in dot products). Each machine is self-consistent, but two machines may differ.
- Example: `emcc -O3 -msimd128 -mrelaxed-simd render-kernels.c -o render-relaxed.js  # load only if detected`
- Avoid/caveats: Safari has no support, so a module that uses relaxed ops fails validation there.
- Status: Limited availability (Chrome 114, Firefox 146, no Safari; web-features). Finished proposal (Wasm 3.0).
- Sources: https://github.com/WebAssembly/relaxed-simd/blob/main/proposals/relaxed-simd/Overview.md ; https://emscripten.org/docs/porting/simd.html ; https://v8.dev/features/simd

### Keep hot indirect calls monomorphic and hot callees small so V8 can inline them
- Layer: build
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: medium to high for Wasm built from C++ virtual calls, Rust trait objects or function-pointer tables: the post's microbenchmark went from 675 ms to 90 ms, and real apps gained 1-8%.
- Do: In C/C++/Rust that becomes Wasm, keep hot dispatch sites to one target (or a few). Devirtualize hot loops (templates or generics, `final` classes, a `switch` on a small enum, grouping objects by concrete type). Keep hot helpers short.
- Why: Liftoff records call targets per site (monomorphic, polymorphic up to 4, megamorphic beyond, which is never inlined). TurboFan inlines up to 4 targets behind checks and constant-folds across them. Limits in V8 `main`: callees up to 500 wire bytes, a budget of 5,000 TurboFan nodes per function, and at most 3x caller growth.
- Example:
  ```cpp
  // Before: for (auto* s : series) s->project(xs, ys, n);   // call_indirect per series
  for (auto& s : lineSeries) s.project(xs, ys, n);          // one target, inlinable
  for (auto& s : bandSeries) s.project(xs, ys, n);
  ```
- Avoid/caveats: Binaryen and LLVM can devirtualize ahead of time when they can prove the target.
- Status: Shipped in Chrome 137 (`wasm_inlining_call_indirect` on since 2025-04-07).
- Sources: https://v8.dev/blog/wasm-speculative-optimizations ; https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h

### Fill function tables once and keep hot Wasm-to-Wasm calls inside one module instance
- Layer: build
- Stage: script-run
- Metrics: FPS/smoothness
- When: long-lived session | animation/render-loop
- Impact: medium: each broken speculation costs a deopt and slower code until the next tier-up, and after 10 deopts a function loses deopt-based speculation.
- Do: Fill `call_indirect` tables and function-pointer slots at startup and leave them alone on hot paths; model changing behavior with data (flags, enums) read inside a stable function. Link a hot kernel and its callbacks into one module, not several instances joined by imported tables or functions.
- Why: Inlined code checks the table index, the instance and the target, and on a mismatch it deoptimizes to Liftoff, which records the new target. Wasm functions close over their instance, so calls into another instance are not inlined and fail the instance check. With inlining but without deopts, the post's benchmark took 180 ms instead of 90 ms.
- Example: `// set once at init: g_project = &project_line;   not per frame: g_project = pick(frameNo);`
- Avoid/caveats: One-time changes (plugin load) are fine. Dynamic linking (Emscripten side modules) creates several instances by design; keep them off hot paths.
- Status: Wasm deopts on by default since 2025-04-07 (commit bec1fa5a87), Chrome 137+; `wasm_deopts_per_function_limit = 10`.
- Sources: https://v8.dev/blog/wasm-speculative-optimizations ; https://raw.githubusercontent.com/v8/v8/main/src/flags/flag-definitions.h

### Give Wasm exports that hot JS calls numeric signatures, call them from stable sites, and batch work per call
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop | interaction
- Impact: medium: optimized JS inlines the JS-to-Wasm wrapper only for simple numeric signatures, and a per-call `i64`/BigInt round trip cost about 30x an `f64` parameter (Chrome 152, 5 million calls).
- Do: Pass pointers and lengths as `i32` and numbers as `f64`/`f32`; return at most one value, or write results into Wasm memory that JS reads through a typed-array view. Declare millisecond timestamps, prices and counts as `f64` (or `i32`), not `i64`. Call each export from a site that always calls the same function, and move per-point work into one call per batch or frame.
- Why: TurboFan inlines the wrapper when the signature has at most one result and only `i32`, `i64` (64-bit platforms), `f32`, `f64` or `externref`, and the export is not a JSPI `promising` function. Every `i64` crossing creates or reads a heap BigInt. Measured in Chrome 152 (identity export, 5,000,000 calls): `f64` 3.0 ms; `i64` with BigInt kept in JS 13.3 ms; `i64` with `BigInt()`/`Number()` per call 90.8 ms. Inlining the Wasm body into JS exists only in Turbolev, which is off by default.
- Example:
  ```js
  // Before: for (const p of points) out.push(wasm.exports.project(p));
  xsView.set(xs); ysView.set(ys);
  wasm.exports.projectAll(xsPtr, ysPtr, n);   // (i32, i32, i32) -> void, one crossing per frame
  ```
- Avoid/caveats: Emscripten embind puts JS glue in front of exports (SciChart.js uses Emscripten), so the wrapper details apply only partly; batching applies fully. Do not store 64-bit ids in `f64` (precision above 2^53).
- Status: Wrapper inlining on since 2022-08 (commit f1a4104ff9); Turbolev off by default (V8 `main` 2026-09-23).
- Sources: https://v8.dev/blog/wasm-speculative-optimizations ; https://github.com/v8/v8/blob/main/src/compiler/js-call-reducer.cc ; https://v8.dev/features/wasm-bigint

### Pass Wasm `i64` values as BigInt; never hand-split them into two `i32` halves
- Layer: build
- Stage: script-run
- Metrics: startup, bundle-size
- When: build
- Impact: medium: legalization adds split and combine work on every crossing (the BigInt path was 18% faster in the post) and an extra Binaryen pass.
- Do: Build with JS BigInt integration (Emscripten default since 4.0.0; do not pass `-sWASM_BIGINT=0`). In hand-written glue, pass a BigInt to `i64` parameters and expect a BigInt back, and delete old low/high glue.
- Why: Before the integration, `i64` at the JS boundary threw, so toolchains "legalized" it into two `i32` values plus a side channel, which changed the JS-visible signature and cost instructions per call.
- Example:
  ```js
  // Before: send_i64(low, high) { const v = high * 2 ** 32 + (low >>> 0); }  // loses precision above 2^53
  function send_i64(v /* bigint */) { log(v.toString(16)); }
  ```
- Avoid/caveats: Passing a Number to an `i64` parameter throws TypeError; convert explicitly. See the previous rule for keeping `i64` out of hot signatures.
- Status: Baseline widely available (2023-10-26; Chrome 85, Firefox 78, Safari 14.1). Emscripten `WASM_BIGINT` deprecated and `LEGALIZE_JS_FFI` removed in 6.0.8 (2026-08-20).
- Sources: https://v8.dev/features/wasm-bigint ; https://api.webstatus.dev/v1/features/wasm-bigint ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/ChangeLog.md

### Treat Wasm pointers as unsigned 32-bit values in JS glue: `>>>`, never `>>`
- Layer: js
- Stage: script-run
- Metrics: memory
- When: long-lived session
- Impact: medium: a signed shift turns every address at or above 2 GiB into a negative index that reads `undefined` or writes nowhere, without an error.
- Do: In hand-written glue, convert byte addresses with `ptr >>> 2` (`HEAP32`/`HEAPF32`) or `ptr >>> 3` (`HEAPF64`), and normalize pointers returned from Wasm with `ptr >>> 0` before you compare or store them.
- Why: Wasm `i32` values reach JS as signed Numbers, and `>>` is signed: `(2 ** 31) >> 2` is `-536870912`. Emscripten emits `>>>` in its own glue only when the build allows memory above 2 GB; your glue gets no rewrite.
- Example:
  ```js
  // Before: const first = HEAPF64[ptr >> 3]; const ok = ptr < endPtr;
  const first = HEAPF64[ptr >>> 3];
  const ok = (ptr >>> 0) < (endPtr >>> 0);
  ```
- Avoid/caveats: Memory64 pointers are BigInt; `>>>` does not apply there.
- Status: Current. Emscripten `MAXIMUM_MEMORY` default is still 2 GiB (`settings.js`, 2026-09-23).
- Sources: https://v8.dev/blog/4gb-wasm-memory ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/src/settings.js

### Start Wasm memory small, grow it on demand up to a set maximum, and handle allocation failure
- Layer: build
- Stage: gc-memory, main-thread-task
- Metrics: memory, startup, FPS/smoothness
- When: load | long-lived session
- Impact: high: a large up-front reservation can fail or push low-memory devices into memory pressure, and unlimited growth hides leaks until the tab dies.
- Do: Set a small initial memory, turn on growth (`-sALLOW_MEMORY_GROWTH`), and set `MAXIMUM_MEMORY` to the real budget (2 GB default; 4 GB only with unsigned-pointer glue). Handle a failed `malloc()` (returns 0) and a `RangeError` from `memory.grow()` with a user-visible fallback (load less history). Grow before predictable bursts, not in the middle of a frame.
- Why: Emscripten grows geometrically (20% steps, capped at 96 MiB per step) and describes each resize as a hiccup of about 20 ms. V8 caps wasm32 memory at 65,536 pages (4 GiB) on 64-bit platforms and at 32,767 pages (2 GiB minus 64 KiB) on 32-bit builds.
- Example: `emcc engine.c -O3 -sALLOW_MEMORY_GROWTH -sINITIAL_HEAP=33554432 -sMAXIMUM_MEMORY=2GB -o engine.js`
- Avoid/caveats: With exceptions off, C++ `operator new` still aborts on failure; use `std::nothrow` where you can recover. For SciChart.js the heap ceiling is set by the library build (file 13).
- Status: V8 `wasm-limits.h` and Emscripten `settings.js` (2026-09-23).
- Sources: https://v8.dev/blog/4gb-wasm-memory ; https://raw.githubusercontent.com/v8/v8/main/src/wasm/wasm-limits.h ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/src/settings.js

### Re-create typed-array views over Wasm memory after any call that can grow it
- Layer: js
- Stage: script-run
- Metrics: memory
- When: long-lived session | animation/render-loop
- Impact: high: a stale view after growth has length 0, so reads return `undefined` and writes are dropped without an error.
- Do: Never keep `new Float64Array(memory.buffer)` across a Wasm call that can allocate; check `view.buffer === memory.buffer` before use and rebuild the view if not. If the memory has a declared maximum and JS only reads it, you can switch it once with `memory.toResizableBuffer()` and use length-tracking views.
- Why: Every `memory.grow()` on non-shared memory detaches the old ArrayBuffer, even `grow(0)`. Shared memory does not detach, but the old SharedArrayBuffer keeps its old length. `toResizableBuffer()` gives a buffer whose length follows growth; it throws if the memory has no maximum.
- Example:
  ```js
  let heap = new Float64Array(memory.buffer);
  function f64View() { if (heap.buffer !== memory.buffer) heap = new Float64Array(memory.buffer); return heap; }
  const readSeries = (ptr, n) => f64View().subarray(ptr >>> 3, (ptr >>> 3) + n);
  ```
- Avoid/caveats: Views over resizable buffers cannot go to WebGL or WebGPU uploads (section 2), so do not use `toResizableBuffer()` when the renderer uploads directly from Wasm memory.
- Status: `toResizableBuffer()` Chrome 144, Firefox 145, Safari 26.2 (BCD 8.1.2); Emscripten notes it was not usable in Firefox before 154.
- Sources: https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow ; https://webassembly.github.io/spec/js-api/ ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/ChangeLog.md

### Stay on wasm32 unless one tab must hold more than 4 GiB; treat Memory64 as an opt-in with costs
- Layer: build
- Stage: script-run, gc-memory
- Metrics: memory, FPS/smoothness
- When: build | long-lived session
- Impact: medium: Memory64 doubles pointer size, can add bounds checks, turns JS-side pointers into BigInt, and does not run in Safari.
- Do: Keep Wasm builds on wasm32. Build with `-m64` only when the data truly needs more than 4 GiB, keep a wasm32 build for other browsers, and measure both.
- Why: With Memory64, `memory.grow()` and pointer-returning exports give BigInts in JS, which cost per call. V8 uses trap-handler bounds checks on x64 and arm64, but SciChart measured its wasm64 build about 10% slower. V8 caps Memory64 at 16 GiB.
- Example: `emcc engine.c -O3 -m64 -sALLOW_MEMORY_GROWTH -o engine64.js  # second build, feature-detected`
- Avoid/caveats: The Emscripten `MEMORY64` setting is deprecated in favor of `-m64`.
- Status: Limited availability (Chrome/Edge 133, Firefox 134, no Safari; web-features, 2026-09).
- Sources: https://api.webstatus.dev/v1/features/wasm-memory64 ; https://v8.dev/blog/4gb-wasm-memory ; https://raw.githubusercontent.com/v8/v8/main/src/wasm/wasm-limits.h

### Use JSPI, not Asyncify, when synchronous Wasm code must await promise-based web APIs; wrap only what needs it
- Layer: build
- Stage: script-run, microtask
- Metrics: bundle-size, startup, INP
- When: build | load
- Impact: medium: Asyncify instruments code for stack unwinding (about 50% size and speed overhead per Emscripten), while JSPI leaves the Wasm code unchanged.
- Do: Build with `-sJSPI` and list async entry points and imports (`JSPI_EXPORTS`, `JSPI_IMPORTS`), or with raw Wasm wrap promise-returning imports in `new WebAssembly.Suspending(fn)` and the exports that reach them in `WebAssembly.promising(fn)`. Leave synchronous exports (per-frame compute, hit tests) unwrapped, and suspend at coarse boundaries (load a dataset), not per item.
- Why: JSPI suspends the Wasm stack when a wrapped import returns a promise and resumes it when the promise settles. Each suspension costs about 1 µs plus a trip through the promise machinery, and every call to a `promising` export returns a promise even when nothing suspended; TurboFan does not inline wrappers for `promising` exports.
- Example:
  ```js
  const imports = { env: { read_chunk: new WebAssembly.Suspending((off, len) => fetchChunk(off, len)) } };
  const { instance } = await WebAssembly.instantiateStreaming(fetch('/engine.wasm'), imports);
  const loadDataset = WebAssembly.promising(instance.exports.load_dataset);
  const computeFrame = instance.exports.compute_frame;   // sync export stays unwrapped
  ```
- Avoid/caveats: JSPI cannot suspend through JavaScript frames (the call traps with `SuspendError`). Keep an Asyncify build only while your targets lack JSPI. A JSPI stub can also lazy-load a rarely used side module on first call; prefetch it on hover, because the first call waits for network and compile.
- Status: Baseline newly available since 2026-09-14 (Chrome/Edge 137, Firefox 153, Safari 27; web-features). Emscripten `-sASYNCIFY=2` deprecated since 3.1.59.
- Sources: https://v8.dev/blog/jspi ; https://github.com/WebAssembly/js-promise-integration/blob/main/proposals/js-promise-integration/Overview.md ; https://emscripten.org/docs/porting/asyncify.html ; https://cdn.jsdelivr.net/npm/web-features/data.json

### Treat Wasm linear memory as a heap that never shrinks: reuse long-lived buffers and avoid transient peaks
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: high for a terminal that runs for hours: peak memory stays reserved for the life of the tab, and fragmentation can force growth or out-of-memory errors.
- Do: Allocate long-lived Wasm buffers once and grow them by doubling, instead of `malloc`/`free` per tick. Load very large data in bounded chunks. Reserve capacity up front for series that grow steadily (SciChart: reserve capacity, `clear()` to refill, file 13).
- Why: C, C++ and Rust allocations in linear memory cannot move, so small live blocks split free space (the post: 2 MB total with a tiny block in the middle, and a 1.5 MB request fails). Wasm memory can only grow; the "memory control" proposal is at phase 1.
- Example:
  ```js
  let scratch = 0, capacity = 0;
  function onTick(points /* Float64Array */) {
    if (points.byteLength > capacity) {
      if (scratch) mod._free(scratch);
      capacity = Math.max(points.byteLength, capacity * 2); scratch = mod._malloc(capacity);
    }
    mod.HEAPF64.set(points, scratch >>> 3); mod._ingest(scratch, points.length);
  }
  ```
- Avoid/caveats: Do not over-reserve for many series at once. A per-tick `malloc`/`free` of one size often reuses the same block, so measure `memory.buffer.byteLength` over a long session first.
- Status: Current (Wasm core spec has no shrink; proposals list 2026-09-23).
- Sources: https://v8.dev/blog/wasm-gc-porting ; https://github.com/WebAssembly/proposals

### Release every JS-to-Wasm-object link explicitly (`delete()`), because the GC cannot see through linear memory
- Layer: js
- Stage: gc-memory
- Metrics: memory
- When: long-lived session
- Impact: high: objects kept alive through Wasm tables, handle maps or C++ wrappers leak until the tab closes.
- Do: For every JS wrapper of a Wasm-side object (embind classes, wasm-bindgen handles, SciChart surfaces, series and data series), call `delete()`/`free()` in the owner's teardown (Svelte `$effect` cleanup, `onDestroy`). Remove JS callbacks and DOM nodes that Wasm holds when it no longer needs them. Use FinalizationRegistry only as a backstop.
- Why: In linear-memory modules, links to JS objects live in a Wasm table and links back can only point at the whole instance, so the JS GC cannot find or collect cycles through linear memory. WasmGC objects are GC objects, so such cycles are collected.
- Example:
  ```ts
  $effect(() => {
    const series = new FastLineRenderableSeries(wasmContext, { dataSeries });
    surface.renderableSeries.add(series);
    return () => { surface.renderableSeries.remove(series); };   // deletes series and data series by default
  });
  ```
- Avoid/caveats: See file 13 for SciChart's `callDeleteOnChildren` defaults.
- Status: Current.
- Sources: https://v8.dev/blog/wasm-gc-porting

### Measure Wasm memory with Wasm-side counters, because heap snapshots show linear memory as one opaque buffer
- Layer: tooling
- Stage: gc-memory
- Metrics: memory
- When: testing | long-lived session
- Impact: medium: leaks inside linear memory do not appear as objects in DevTools heap snapshots.
- Do: In long-session tests, record `memory.buffer.byteLength` (reserved) and the allocator's in-use bytes (Emscripten `mallinfo()` or the library's counters) at fixed points, and fail the test when they grow without bound.
- Why: DevTools sees linear memory as untyped bytes in one ArrayBuffer. WasmGC objects, by contrast, appear in heap snapshots by type and field name.
- Example: `const wasmMb = (m) => m.buffer.byteLength / 2 ** 20; // never shrinks: track the peak`
- Avoid/caveats: `byteLength` is reserved memory, not live data; pair it with allocator statistics.
- Status: Current.
- Sources: https://v8.dev/blog/wasm-gc-porting

### For code written in garbage-collected languages, prefer WasmGC builds over shipping a runtime and GC in linear memory
- Layer: build
- Stage: network, script-compile, gc-memory
- Metrics: bundle-size, memory, startup
- When: build
- Impact: low for a TypeScript codebase; medium when you adopt a Kotlin, Dart, Java, OCaml or Scheme library compiled to Wasm.
- Do: Choose the library's WasmGC target over a build that compiles the language VM and its allocator into linear memory.
- Why: A WasmGC module ships no GC and no `malloc` (the post's example: 2.3 K vs 6.1-9.6 K for C or Rust with `dlmalloc`/`emmalloc`), and the browser GC is generational, compacting and collects JS-Wasm cycles. V8 also speculatively inlines WasmGC indirect calls (about 30% on the Google Sheets calc engine).
- Example: not applicable (toolchain choice).
- Avoid/caveats: WasmGC ports can change language semantics (fixed struct fields, no interior pointers).
- Status: Baseline newly available since 2024-12-11 (Chrome 119, Firefox 120, Safari 18.2).
- Sources: https://v8.dev/blog/wasm-gc-porting ; https://cdn.jsdelivr.net/npm/web-features/data.json

### Build C++ Wasm that throws with native Wasm exception handling
- Layer: build
- Stage: script-run
- Metrics: bundle-size, startup
- When: build
- Impact: low: it matters only for C++ code that uses exceptions.
- Do: Compile and link with `-fwasm-exceptions` instead of `-fexceptions`. When all targets support `exnref`, add `-sWASM_LEGACY_EXCEPTIONS=0`.
- Why: Emscripten says JS-based exceptions have relatively high overhead, and native Wasm exceptions reduce code size and run-time cost. V8 runs both the legacy and the `exnref` formats.
- Example: `emcc engine.cpp -O3 -fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=0 -o engine.js`
- Avoid/caveats: Emscripten's `WASM_LEGACY_EXCEPTIONS` still defaults to `true`. If you do not need exceptions, leave catching off (the default).
- Status: Legacy Wasm EH Baseline widely available; `exnref` Baseline newly available since 2025-05-29 (Chrome 137, Firefox 131, Safari 18.4).
- Sources: https://emscripten.org/docs/porting/exceptions.html ; https://v8.dev/blog/holiday-season-2023 ; https://cdn.jsdelivr.net/npm/web-features/data.json

---

## Obsolete advice (myths)

Each row is advice that still appears in style guides, old posts or model memory. Do not generate code that follows the left column.

| # | Myth or outdated claim | Status on 2026-09-23 | Do instead | Evidence |
|---|---|---|---|---|
| 1 | "Avoid `try/catch` in hot functions; it prevents optimization." | Obsolete since V8 5.9 / Chrome 59 (2017): Crankshaft is gone; Ignition, Sparkplug, Maglev and TurboFan support the whole language. | Use `try/catch/finally` where correctness needs it; avoid frequent throws (stack capture). | launching-ignition-and-turbofan, maglev |
| 2 | "`for…of`, generators, destructuring and async functions are optimization killers." | Obsolete since Chrome 59; object destructuring = plain loads since Chrome 78. | Write native syntax (section 11). | high-performance-es2015, v8-release-78 |
| 3 | "Hand-written promise chains are faster than async/await." | Obsolete since V8 7.2 / Chrome 72. | Native async/await on native promises. | fast-async |
| 4 | "Deleting the most recently added property is cheap." | Removed in Chrome 122 (2024); every `delete` goes to dictionary mode. | Assign `undefined` or build a new object. | V8 commit 389ea9be7d |
| 5 | "A holey array stays holey forever." | Exception since Chrome 135: a full `fill()` restores the best packed kind. | `new Array(n).fill(v)`. | elements-kinds (2025 update), commit 785a0f64 |
| 6 | "Double fields are stored unboxed in objects." | Ended with pointer compression (Chrome 80); fields hold a mutable HeapNumber box; the flag is gone. | Typed-array columns for numeric data. | pointer-compression, V8 `main` flags |
| 7 | "Smis are 32-bit on 64-bit machines." | Only without pointer compression (Node default builds). Chrome: 31-bit. | Plan for ±2^30 in the browser. | pointer-compression, `v8-internal.h` |
| 8 | "More than 4 shapes at a site = megamorphic." | Limit is 10 from Chrome 154; a homomorphic state exists behind a flag (default-on first in Chrome 156 canary). | Still aim for monomorphic. | commits f2c89563c0, ab86d353fe, 77b7016561; chromiumdash |
| 9 | "Shape deprecation is going away." | Still present in V8 13.6: Smi → Double gives a new map and lazy migration. | Initialize doubles with `NaN`. | react-cliff; batch 01 local test |
| 10 | "Avoid `Object.freeze`/`preventExtensions`; they cause a performance cliff." | React cliff fixed in V8 7.4; frozen arrays keep fast kinds since 7.6. But freezing numeric arrays boxes them. | Freeze config arrays; never freeze numeric data. | react-cliff, v8-release-76, `js-objects.cc` |
| 11 | "Script streaming starts only after 30 kB." | Chromium starts after the byte-order-mark check (about 4 bytes). | Any external script streams. | `script_streamer.cc` |
| 12 | "Chrome caches inline scripts on the HTML document." | `kInlineScriptCache` and `kPrecompileInlineScripts` are disabled by default. | Keep code in external files ≥ 1 KiB. | Chromium `features.cc` |
| 13 | "Wrap functions in parentheses (optimize-js) to speed parsing." | Obsolete since V8 6.3 / 7.5; blanket eager compile costs load time and memory. Terser `wrap_func_args` default `false` since 5.43.0. | Compile hint on one core file; PIFE only for profiled functions. | preparser, Terser changelog |
| 14 | "Flatten nested functions for parse speed." | Obsolete since V8 6.3: each function is pre-parsed at most once. | Nest where it reads best. | preparser |
| 15 | "Wrap library code in an IIFE so it gets into the code cache." | Obsolete since Chrome 66: the cache is produced after top-level execution. | Deterministic startup; compile hints. | improved-code-caching |
| 16 | "DataView is slow; use byte-shift shims." | Obsolete since V8 6.9 / Chrome 69 (about TypedArray speed). | `DataView` with `littleEndian`. | dataview |
| 17 | "Spread and `Array.from` are slow; copy by hand." | Obsolete since V8 7.2 / Chrome 72. | Leading spread / `Array.from`. | spread-elements |
| 18 | "Avoid class fields and `#private` for speed." | Obsolete since V8 9.7 / Chrome 97. | Native class fields, TS target ES2022+. | faster-class-features |
| 19 | "`super.x` is an order of magnitude slower." | Obsolete for named loads since Chrome 90; still true for keyed super and super writes. | Named `super` freely. | fast-super |
| 20 | "Pad calls to the declared parameter count." | Obsolete since Chrome 89 (no adaptor frame). | Pass what you have. | adaptor-frame |
| 21 | "Using an object as a Map key changes its shape." | Obsolete since V8 6.3 (hash in the properties slot). | Key by the object itself. | hash-code |
| 22 | "for-in is always slow / always deoptimizes." | Obsolete for fast-mode objects (enum cache, Chrome 51/57). | for-in on stable objects; never on arrays. | fast-for-in |
| 23 | "`Array#sort` is unstable; add an index tie-breaker." | Stable since Chrome 70 and required by ES2019. | Drop tie-breakers. | array-sort, MDN |
| 24 | "V8 sorts with TimSort." | PowerSort since Chrome 149, plus inline insertion sort for packed arrays ≤ 16. | Pure, cheap comparators. | commits 8899b945f6, 66a3f1e94d |
| 25 | "A regex is interpreted first; warm it up." | Chrome 79-151 only; Chrome 152+ compiles native code on first use. Warm-up was never needed. | Hoist and reuse regexes. | regexp-tier-up, commit 4b2ab5e9cf |
| 26 | "V8 falls back to a linear-time regex engine on catastrophic backtracking." | Not by default: the fallback is still an experimental flag. | Write backtracking-safe patterns. | non-backtracking-regexp, V8 flags |
| 27 | "BigInt is never optimized and always heap-allocated." | TurboFan 64-bit BigInt since Chrome 108/111; Maglev since 2026. | Keep BigInt in the 64-bit range; Number for prices and ms. | commits fced4e9e35, b53f4d8247, ae67ffb8a7 |
| 28 | "Proxy traps are slow C++ calls; otherwise proxies are fine." | Traps moved to CSA in 2017, but shipping V8 still has no Proxy IC (`fast_proxy_ic` is behind `--future`). | Keep proxies out of hot paths. | optimizing-proxies, commit be455d8278 |
| 29 | "JSON.parse overflows on deep nesting; flatten payloads." | Iterative parser since Chrome 76. | Keep depth limits only as input validation. | v8-release-76 |
| 30 | "Build JSON strings by hand for speed." | JSON.stringify fast path is more than 2x faster since Chrome 138. | `JSON.stringify(value)` without replacer or space. | json-stringify |
| 31 | "`let`/`const` are about 10% slower than `var`." | Mostly obsolete: dominated TDZ checks are elided since 2023. | `const`/`let`. | holiday-season-2023, V8 flags |
| 32 | "Break JS ↔ DOM reference cycles by hand." | Obsolete since Chrome 57 (cross-component tracing); only paths from live roots leak. | Remove references from long-lived roots. | tracing-js-dom |
| 33 | "Wasm is cached only for modules ≥ 128 kB, after the full TurboFan compile." | Replaced by incremental caching of hot TurboFan code under dynamic tiering. | Measure warm starts after real use. | wasm-code-caching, pipeline doc |
| 34 | "Chrome releases every 6 weeks" (2019) / "every 4 weeks" (2021). | Every 2 weeks since Chrome 153 (2026-09-08); each update invalidates JS and Wasm code caches. | Expect a cold compile about every 2 weeks per user. | Chrome blog 2026-03-03; chromiumdash |
| 35 | "Build SIMD and non-SIMD Wasm variants and feature-detect." | Not needed for Baseline-widely targets since 2025-09-27; still needed for relaxed SIMD. | One SIMD build. | simd, web-features |
| 36 | "Rust Wasm SIMD needs nightly or `packed_simd`." | `core::arch::wasm32` intrinsics stable since Rust 1.54 (2021). | Stable Rust. | batch 07 |
| 37 | "Use SIMD.js." | Archived proposal; no engine ships it. | Wasm SIMD or GPU shaders. | simd |
| 38 | "Wasm never deoptimizes." | Wasm deopts since Chrome 137 (speculative inlining). | Stable function tables and targets. | wasm-speculative-optimizations |
| 39 | "Liftoff compiles the whole module, then TurboFan tiers everything up; enable dynamic tiering with a flag or origin trial." | Lazy Liftoff (2022-11) plus budget-based dynamic tiering (2022-04) are defaults; no Wasm OSR. | Hot loops in repeatedly called functions. | wasm-dynamic-tiering, pipeline doc |
| 40 | "There is no JS-to-Wasm inlining." | Wrapper inlining on since 2022-08 for numeric signatures; body inlining only in Turbolev (off). | Numeric export signatures. | batch 07, `js-call-reducer.cc` |
| 41 | "Opt in with `-s WASM_BIGINT`; legalize `i64` for JS." | Default since Emscripten 4.0.0; setting deprecated in 6.0.8; `LEGALIZE_JS_FFI` removed. | BigInt `i64`. | Emscripten ChangeLog |
| 42 | "Use `-sASYNCIFY=2` for JSPI; JSPI is Chrome-only / Firefox 139." | `-sJSPI`; JSPI Baseline newly 2026-09-14 (Firefox 153, Safari 27). | JSPI for async imports. | Emscripten docs, web-features |
| 43 | "wasm64 is planned; 4 GB Wasm needs Chrome M83 beta." | Memory64 shipped (Chrome 133, Firefox 134, no Safari); 4 GiB is the normal wasm32 limit. | wasm32 by default. | 4gb-wasm-memory, web-features |
| 44 | "Ship `nomodule` fallback bundles." | Obsolete: modules Baseline widely since 2020-11. | Modern syntax only. | webstatus js-modules |
| 45 | "Use HTTP/2 server push for module graphs." | Removed in Chrome 106 (2022). | `modulepreload`, 103 Early Hints. | developer.chrome.com/blog/removing-push |
| 46 | "Import maps are a proposal; module workers need a flag." | Both Baseline widely available (2025). | Use them. | webstatus |
| 47 | "Iterator helpers are unshipped / not in Firefox or Safari." | Baseline newly available since 2025-03-31. | Use for early-exit pipelines. | web-features |
| 48 | "Top-level await: no Firefox or Safari." | Baseline newly 2026-09-14; Safari 15-26 partial (multi-importer bug). | Entry module only. | webstatus, WebKit bug 242740 |
| 49 | "`Atomics.waitAsync` is Chrome-only; WeakRef has no Safari support" (v8.dev tables). | `waitAsync` Baseline newly 2025-11-11; WeakRef Baseline widely 2023-10-26. | Use with the rules in sections 6 and 8. | web-features |
| 50 | "Maglev is desktop-only." | Built on arm, arm64 and x64 (Android included) with an Android threshold. | Expect the same tiers on phones. | V8 `BUILD.gn` |
| 51 | "Inspect traces in `chrome://tracing`." | Superseded by the Perfetto UI (same categories). | ui.perfetto.dev. | batch 04 |
| 52 | "The default `toLocaleString` path is cached, so per-call calls are fine." | Cached only with no options and a string/undefined locale, one locale per kind. | Reuse Intl objects. | V8 `intl-objects.cc` |

---

## Conflicts resolved during consolidation

| Topic | Batch statements | Resolution (2026-09-23) | Evidence |
|---|---|---|---|
| Homomorphic IC milestone | Batch 01: "Chrome 147 added homomorphic ICs". Batch 04: "enabled by default 2026-09-15, later milestone". | Both partly right. Commit ab86d353fe (2026-03-02) added the state behind `--homomorphic-ic` (off by default, implied only by `--future`); it first shipped in Chrome 147 as dead code for normal users. Commit 77b7016561 (2026-09-15) turned it on; earliest build 156.0.8061.0 (canary), Chrome 156 stable scheduled for 2026-10-20. | GitHub commit messages; chromiumdash `fetch_commit` |
| Polymorphic limit 4 → 10 | Batch 01: Chrome 154. Batch 04: milestone not verified. | Chrome 154 (first stable 154.0.8037.21; Chrome 154 stable on 2026-09-22). | chromiumdash `fetch_commit`, `fetch_milestone_schedule` |
| Chrome release cadence | Batch 04: "4-week cycle since Chrome 94". Batch 06: "current stable 154" (which does not fit 4 weeks after Chrome 149 on 2026-06-02). | 4-week cycle through Chrome 152 (2026-08-25); 2-week cycle from Chrome 153 (2026-09-08): 154 on 09-22, 155 on 10-06, 156 on 10-20. Extended Stable stays on 8 weeks. | developer.chrome.com/blog/chrome-two-week-release (2026-03-03); chromiumdash |
| Dictionary-mode threshold for keyed stores | Batch 01: "about 20 keys" (measured). Batch 05: "roughly 16" (from source). | Kept the measured "about 20" and the source rule (soft limit 12 out-of-object fields plus spare slots). Numbers are internal; the rule does not depend on them. | Batches 01 and 05 |
| JSON reviver impact | Batch 04: low (source-derived). Batch 08: medium (measured 7x slower, Chrome 152). | Kept batch 08 (newer, measured). | Batch 08 |
| Fill exception milestone | Batch 01: Chrome 135 (commit). Batch 03: "about Chrome 135, estimate". | Chrome 135. | Batch 01 (chromiumdash-derived) |

---

## Sources read

Read in this consolidation run (2026-09-23):
- Local notes: `08-v8-index.md`, `08-v8-batch-01.md` … `08-v8-batch-08.md` (all read in full).
- https://api.github.com/repos/v8/v8/commits/ab86d353fe (commit message: homomorphic IC state, 2026-03-02)
- https://api.github.com/repos/v8/v8/commits/77b7016561 (commit message: enable homomorphic ICs by default, 2026-09-15)
- https://api.github.com/repos/v8/v8/commits/f2c89563c0 (commit message: polymorphic maps limit, 2026-08-26)
- https://chromiumdash.appspot.com/fetch_commit?commit=ab86d353fecd10d1195cad3f04213c342aeea5a8
- https://chromiumdash.appspot.com/fetch_commit?commit=77b70165610525a92dfd0a238bc109917441ead8
- https://chromiumdash.appspot.com/fetch_commit?commit=f2c89563c0233af55a27c37db201b577396d5ee4
- https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Windows&num=3
- https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=146 … 156
- https://developer.chrome.com/blog/chrome-two-week-release
- Web search "Chrome two-week release cycle stable milestone 2026" (result list only; used to find the Chrome blog post)
- Raw copies saved in `raw/v8-consolidate/`.

Primary sources read by the batch runs and cited above (see each batch file for the full list, dates and V8/Chromium source files):
- v8.dev blog: https://v8.dev/blog/elements-kinds ; https://v8.dev/blog/fast-properties ; https://v8.dev/blog/slack-tracking ; https://v8.dev/blog/react-cliff ; https://v8.dev/blog/pointer-compression ; https://v8.dev/blog/mutable-heap-number ; https://v8.dev/blog/maglev ; https://v8.dev/blog/launching-ignition-and-turbofan ; https://v8.dev/blog/system-analyzer ; https://v8.dev/blog/cost-of-javascript-2019 ; https://v8.dev/blog/code-caching-for-devs ; https://v8.dev/blog/improved-code-caching ; https://v8.dev/blog/background-compilation ; https://v8.dev/blog/explicit-compile-hints ; https://v8.dev/blog/preparser ; https://v8.dev/blog/scanner ; https://v8.dev/blog/json-stringify ; https://v8.dev/blog/v8-release-76 ; https://v8.dev/blog/v8-release-78 ; https://v8.dev/blog/v8-release-80 ; https://v8.dev/blog/v8-release-89 ; https://v8.dev/blog/fast-async ; https://v8.dev/blog/trash-talk ; https://v8.dev/blog/free-garbage-collection ; https://v8.dev/blog/tracing-js-dom ; https://v8.dev/blog/hash-code ; https://v8.dev/blog/dataview ; https://v8.dev/blog/spread-elements ; https://v8.dev/blog/faster-class-features ; https://v8.dev/blog/fast-super ; https://v8.dev/blog/adaptor-frame ; https://v8.dev/blog/fast-for-in ; https://v8.dev/blog/array-sort ; https://v8.dev/blog/optimizing-proxies ; https://v8.dev/blog/speeding-up-regular-expressions ; https://v8.dev/blog/regexp-tier-up ; https://v8.dev/blog/non-backtracking-regexp ; https://v8.dev/blog/bigint ; https://v8.dev/blog/intl ; https://v8.dev/blog/high-performance-es2015 ; https://v8.dev/blog/holiday-season-2023 ; https://v8.dev/blog/wasm-code-caching ; https://v8.dev/blog/wasm-dynamic-tiering ; https://v8.dev/blog/liftoff ; https://v8.dev/blog/wasm-speculative-optimizations ; https://v8.dev/blog/4gb-wasm-memory ; https://v8.dev/blog/jspi ; https://v8.dev/blog/wasm-gc-porting ; https://v8.dev/blog/sandbox ; https://v8.dev/blog (archive index, 154 posts)
- v8.dev features and docs: https://v8.dev/features/dynamic-import ; https://v8.dev/features/modules ; https://v8.dev/features/top-level-await ; https://v8.dev/features/subsume-json ; https://v8.dev/features/simd ; https://v8.dev/features/atomics ; https://v8.dev/features/weak-references ; https://v8.dev/features/wasm-bigint ; https://v8.dev/features/object-rest-spread ; https://v8.dev/features/iterator-helpers ; https://v8.dev/features/intl-numberformat ; https://v8.dev/docs/wasm-compilation-pipeline ; https://v8.dev/docs/stack-trace-api ; https://v8.github.io/tools/head/system-analyzer/
- Engine fundamentals: https://mathiasbynens.be/notes/shapes-ics ; https://mathiasbynens.be/notes/prototypes
- V8 and Chromium source and commits (GitHub mirror and Gerrit, `main` 2026-09-23): `src/flags/flag-definitions.h`, `src/objects/map*.{h,cc}`, `js-function.cc`, `js-objects*.{h,cc}`, `property-array.h`, `property-details.h`, `heap/factory.cc`, `json/json-parser.cc`, `json/json-stringifier.cc`, `regexp/regexp-utils.cc`, `builtins-regexp-gen.cc`, `regexp-test.tq`, `compilation-cache.h`, `intl-objects.cc`, `builtins-intl.cc`, `ic/ic.cc`, `code-stub-assembler.cc`, `interpreter-generator.cc`, `bytecode-generator.cc`, `js-call-reducer.cc`, `typed-array-sort.tq`, `array-sort.tq`, `builtins-arraybuffer.cc`, `backing-store.cc`, `wasm-limits.h`, `parser-base.h`, `include/v8-internal.h`, `BUILD.gn`; Chromium `script_streamer.cc`, `v8_code_cache.cc`, `v8_script_runner.cc`, `script_resource.cc`, `v8_wasm_response_extensions.cc`, `blink/common/features.cc`, `gin/gin_features.cc`; commits 389ea9be7d, 785a0f64, f2c89563c0, ab86d353fe, 77b7016561, 4b2ab5e9cf, 8899b945f6, 66a3f1e94d, be455d8278, fced4e9e35, b53f4d8247, ae67ffb8a7, be082f4011, 2b6d499abb, 72a5044f96, bec1fa5a87, e8301c0028, f1a4104ff9, 29131d5e3e, bfe12807c1.
- Status data: https://api.webstatus.dev/v1/features/ (js-modules, modulepreload, import-maps, js-modules-workers, top-level-await, async-await, scheduler, import-defer, wasm-bigint, wasm-memory64, resizable-buffers, transferable-arraybuffer, array-fromasync, bigint, bigint64array, proxy-reflect, regexp-escape, array-by-copy, getorinsert, weak-references, explicit-resource-management) ; https://cdn.jsdelivr.net/npm/web-features/data.json ; BCD 8.1.2 ; https://chromestatus.com/feature/5100466238652416 ; https://chromestatus.com/feature/5153430045458432
- Specs and docs: https://html.spec.whatwg.org/multipage/webappapis.html ; https://html.spec.whatwg.org/multipage/scripting.html ; https://html.spec.whatwg.org/multipage/workers.html ; https://tc39.es/ecma262/multipage/structured-data.html ; https://webidl.spec.whatwg.org/ ; https://registry.khronos.org/webgl/specs/latest/2.0/webgl2.idl ; https://gpuweb.github.io/gpuweb/ ; https://webassembly.github.io/spec/js-api/ ; https://github.com/WebAssembly/proposals ; https://github.com/WebAssembly/js-promise-integration/blob/main/proposals/js-promise-integration/Overview.md ; https://github.com/WebAssembly/relaxed-simd/blob/main/proposals/relaxed-simd/Overview.md ; MDN pages for Map, setPrototypeOf, Array.sort, localeCompare, RegExp.escape, RegExp.exec, SharedArrayBuffer, Atomics.pause, WeakRef, FinalizationRegistry, ArrayBuffer.transfer, Array.fromAsync, Memory.grow, Scheduler.yield, modulepreload ; https://developer.chrome.com/docs/devtools/memory ; https://developer.chrome.com/blog/document-isolation-policy ; https://developer.chrome.com/blog/removing-push ; https://blog.google/security/advancing-protection-in-chrome-on/
- Toolchains: https://www.typescriptlang.org/tsconfig/#useDefineForClassFields ; https://vite.dev/config/shared-options ; https://vite.dev/config/build-options ; https://esbuild.github.io/api/ ; https://esbuild.github.io/content-types/ ; https://esbuild.github.io/faq/ ; https://rolldown.rs/in-depth/tla-in-rolldown ; https://rolldown.rs/reference/OutputOptions.comments ; https://github.com/evanw/esbuild/issues/4247 ; https://github.com/terser/terser/blob/master/CHANGELOG.md ; https://github.com/rolldown/rolldown/pull/5319 ; https://emscripten.org/docs/porting/simd.html ; https://emscripten.org/docs/porting/asyncify.html ; https://emscripten.org/docs/porting/exceptions.html ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/src/settings.js ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/ChangeLog.md ; https://svelte.dev/docs/svelte/$state ; https://cdn.jsdelivr.net/npm/scichart@5.2.69/_wasm/scichart2d.js ; https://github.com/nodejs/node/issues/55735 ; https://github.com/tc39/proposal-faster-promise-adoption ; https://bugs.webkit.org/show_bug.cgi?id=242740 (title only)

## Not covered / could not access

- Other engines: SpiderMonkey and JavaScriptCore equivalents of every V8 threshold (dictionary limits, polymorphic limit, fill exception, code-cache heuristics, lazy source positions, hash storage) were not researched. Language-level rules (comparators, `test()`, `RegExp.escape`, Number vs BigInt, TLA placement) apply everywhere; engine-level numbers are Chrome/Edge only.
- Measurements: most local numbers come from Node 24.16 (V8 13.6, no pointer compression, 32-bit Smis) on one Apple M4 Max; batch 08 measured in Chrome 152. Nothing was re-measured in Chrome 154. Chrome 149+ inline sort, Chrome 152+ single-tier regex and Chrome 154 IC limits come from source and commits only.
- Homomorphic ICs: default-on reaches stable only if the commit is not reverted before Chrome 156 (scheduled 2026-10-20); not verifiable today.
- Exact Chrome milestones for script-context mutable heap numbers (about 133/134), function-context cells (about 138), Wasm dynamic tiering and lazy compilation defaults, and JS-to-Wasm wrapper inlining are estimates from commit dates.
- Not verified: const tracking and mutable number slots at ES module scope; fast paths for a second spread (`[...a, ...b]`) and `Array.from(x, fn)`; whether DevTools shows code-cache data; whether Chromium's `ServiceWorkerCodeCache` feature is on by default and whether a full service-worker cache is still discarded for modules; code caching and streaming for dedicated and Blob-URL workers; the current per-module Wasm code-cache size cap; Document-Isolation-Policy on Android; whether SciChart.js's Wasm build uses SIMD; Vite 8 (Oxc minifier) comment handling; `import defer` shipping in Chrome 155; whether weekly security updates continue with the 2-week cadence (the Chrome blog post does not say).
- Per-API Baseline status of every Intl constructor (Segmenter, DurationFormat and others) was not checked.
- Post images, charts and embedded talk videos were not read; numbers come from post text only. chromestatus HTML pages render with JS; their JSON API was used instead.
- Rules about scheduling (`scheduler.yield`), GPU uploads and SciChart specifics are only summarized here; their full treatment is in files 06, 10, 11 and 13.
