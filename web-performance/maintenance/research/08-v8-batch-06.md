# V8 deep read, batch 6 of 8: for-in, Array#sort, Proxy, RegExp tiering and backtracking, super property access, BigInt

Scope: developer-facing rules from seven v8.dev posts: Fast for-in in V8 (2017-03-01), Getting things sorted in V8 (2018-09-28, updated 2019-06), Optimizing ES2015 proxies in V8 (2017-10-05), Improving V8 regular expressions (2019-10-04), An additional non-backtracking RegExp engine (2021-01-11), Super fast super property access (2021-02-18), Adding BigInts to V8 (2018-05-02).
Each rule names the engine mechanism. "Latest" status was checked on 2026-09-23 against V8 `main` (commit a81b3eb9, 2026-09-23) and the release branches `14.8-lkgr` to `15.4-lkgr`, the V8 commit history (GitHub mirror), Chromium `gin/` (Chrome feature defaults), chromiumdash (milestones), webstatus.dev, MDN and svelte.dev. Important 2026 changes found: Array#sort moved from TimSort to PowerSort and is inlined for small arrays (Chrome 149); RegExps now compile to native code on first use (Chrome 152); a fast Proxy IC exists only behind `--future`.
Local measurements: Node 24.16.0 (V8 13.6), Apple M4 Max, best of 5-7 runs. They are indicative only; scripts are in `raw/v8-batch-6/bench/`. Raw posts and V8 source files are in `raw/v8-batch-6/`. Rules that other batches already cover are cross-referenced, not repeated.

---

## A. Fast for-in in V8 (2017-03-01)

### Use for-in only on fast-mode objects that have no integer-like keys and no enumerable prototype properties; then read `obj[key]` from the same object
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium. On the fast path V8 reuses a cached key list and turns `obj[key]` into a map check plus a direct field load; off the path it collects and allocates keys on every loop entry (measured 9 ms fast vs 106 ms dictionary-mode vs 283 ms integer keys, 1e6 loops over 6 keys).
- Do: Iterate with for-in only over plain objects or class instances whose shape is stable. Inside the body, read the value with `obj[key]` from the object you iterate (or from another object with the same shape). Keep all other logic out of the key loop.
- Why: Each hidden class (map) has a descriptor array with an EnumCache that lists the enumerable named keys. `ForInEnumerate` uses the cache only if (V8 `main`, `CheckEnumCache` / `CheckPrototypeEnumCache`): the receiver's map has an initialized enum cache (dictionary-mode objects never have one), the receiver and every prototype have no elements (integer-indexed properties), and every prototype has zero enumerable properties. Otherwise V8 calls the C++ runtime (`KeyAccumulator`), which walks the prototype chain, removes shadowed and duplicate keys, and prepends element indices as new strings. In TurboFan, `ReduceJSLoadPropertyWithEnumeratedKey` rewrites `obj[key]` inside the loop into a map check plus `LoadFieldByIndex` when the for-in mode is `kUseEnumCacheKeysAndIndices`.
- Example:
  ```js
  // Fast: stable shape, no integer keys, no enumerable prototype members
  const bar = { open: 1, high: 2, low: 0.5, close: 1.5 };
  let sum = 0;
  for (const k in bar) sum += bar[k];   // map check + field load by index
  ```
- Avoid/caveats: For known fields, direct access is much faster still (see the next-but-three rule). V8 collects all keys before the first iteration: keys added during the loop are not visited, and deleted keys are skipped. Integer-like keys always come first in ascending numeric order.
- Status: Current in V8 `main` (2026-09-23). The 2016 work shipped in Chrome 51 and 57. OBSOLETE myth: "for-in is always slow / always deoptimizes" comes from the Crankshaft era. Crankshaft is gone since 2017, and for-in on fast-mode objects has had an enum-cache fast path since then.
- Sources: https://v8.dev/blog/fast-for-in ; V8 `src/codegen/code-stub-assembler.cc` (`CheckEnumCache`, `CheckPrototypeEnumCache`) ; V8 `src/interpreter/interpreter-generator.cc` (`ForInEnumerate`, `ForInNext`) ; V8 `src/compiler/js-native-context-specialization.cc` (`ReduceJSLoadPropertyWithEnumeratedKey`) ; V8 `src/compiler/js-operator.h` (`ForInMode`)

### Never use for-in on arrays or on objects keyed by integers (price levels, ids); use indexed loops and Map
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: interaction, animation/render-loop, long-lived session
- Impact: high for order books and per-price tables. Integer-like keys are elements, so every for-in takes the runtime path and creates index strings (measured 31x slower than a fast object).
- Do: Iterate arrays with `for (let i = 0; i < a.length; i++)` or `for...of`. For a table keyed by numeric price or numeric id, use `Map<number, T>` (or a sorted array plus binary search), not a plain object with `obj[price]`.
- Why: V8 stores integer-like keys (`"0"` to `"4294967294"`) in the elements backing store, not as named properties. The EnumCache holds only named keys, and `CheckPrototypeEnumCache` sends any receiver with non-empty elements to the runtime. There, `PrependElementIndices` converts every index into a string key on every loop entry. The loop variable is then a string, so `arr[key]` is also a string-keyed load.
- Example:
  ```js
  // Before: price levels as object keys -> elements -> slow for-in, string keys
  const book = {}; book[10125] = 3; book[10150] = 7;
  for (const p in book) total += book[p];

  // After
  const book = new Map([[10125, 3], [10150, 7]]);
  for (const [price, size] of book) total += size;
  ```
- Avoid/caveats: A Map has its own per-entry cost. For dense integer ranges, a typed array indexed by `(price - minPrice) / tick` is the fastest option.
- Status: Current in V8 `main` (2026-09-23). `Map` is Baseline widely available.
- Sources: https://v8.dev/blog/fast-for-in ; V8 `src/codegen/code-stub-assembler.cc` (`CheckPrototypeEnumCache`) ; local measurement `raw/v8-batch-6/bench/bench2.mjs`

### Do not put enumerable properties on prototypes: define methods with class syntax
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium. One enumerable property anywhere on the chain disables the enum-cache fast path for every instance (measured 130 ms vs 10 ms, 1e6 loops).
- Do: Declare methods in `class` bodies (they are non-enumerable). Do not write `Ctor.prototype.fn = function () {}` in new code, and do not add enumerable properties to `Object.prototype` or to shared prototypes (polyfills included). If you must add one, use `Object.defineProperty(proto, 'fn', { value: fn, enumerable: false })`.
- Why: `CheckPrototypeEnumCache` requires the enum length of every prototype map to be 0. With an enumerable prototype property, V8 must take the `KeyAccumulator` path each time. That path also tracks non-enumerable shadowing keys and filters duplicates. Your loop body also sees the method names, so code adds `hasOwn` checks that cost more.
- Example:
  ```js
  // Before (ES5 style): enumerable method on the prototype
  function Bar() { this.o = 1; this.c = 2; }
  Bar.prototype.range = function () { return this.c - this.o; };

  // After: class methods are non-enumerable
  class Bar { constructor() { this.o = 1; this.c = 2; } range() { return this.c - this.o; } }
  ```
- Avoid/caveats: Compiling classes down to ES5 functions can bring enumerable prototype members back, depending on the compiler's "loose" mode. Keep the build target at ES2015 or later (see 08-v8-batch-04, section C).
- Status: Current in V8 `main` (2026-09-23). Class syntax is Baseline widely available (webstatus: low 2016-03-08, high 2018-09-08).
- Sources: https://v8.dev/blog/fast-for-in ; V8 `src/codegen/code-stub-assembler.cc` ; https://webstatus.dev/features/class-syntax ; local measurement `raw/v8-batch-6/bench/bench2.mjs`, `bench6.mjs`

### Do not add or delete properties on an object inside its own for-in loop
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: interaction
- Impact: low to medium. After a shape change, every remaining key goes through a slow `HasProperty` filter, and the object can go to dictionary mode.
- Do: Collect the changes in a separate list and apply them after the loop, or build a new object.
- Why: `ForInNext` compares the receiver's current map with the cached map (`cache_type`). If they are equal, the key is valid without a check. If not, `ForInNextSlow` runs a full property lookup for each key (the spec requires skipping keys that were deleted during enumeration). `delete` also usually sends the object to dictionary mode (see 08-v8-batch-01, "Never use `delete` on objects that hot code reads").
- Example:
  ```js
  // Before
  for (const k in cfg) if (cfg[k] == null) delete cfg[k];
  // After
  const clean = {};
  for (const k in cfg) if (cfg[k] != null) clean[k] = cfg[k];
  ```
- Avoid/caveats: None beyond the extra object allocation.
- Status: Current in V8 `main` (2026-09-23).
- Sources: https://v8.dev/blog/fast-for-in ; V8 `src/interpreter/interpreter-generator.cc` (`ForInNext`)

### Keep a generic key-iterating helper away from dictionary-mode objects, arrays and proxies
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: medium. One slow-mode object sets the loop's feedback to generic for all later callers (measured 29 ms vs 9 ms for the same fast object).
- Do: Give hot fast-object code its own loop (or its own function). Do not send dictionary-mode objects, arrays or proxies through the same `forEachKey(obj, fn)` utility that hot code uses.
- Why: Each for-in site records feedback (`ForInHint`). Maglev and TurboFan pick `kUseEnumCacheKeysAndIndices`, `kUseEnumCacheKeys` or `kGeneric` from that feedback. Once the site has seen an object without a usable enum cache, it compiles the generic mode for every object that goes through it.
- Example:
  ```js
  // Hot path: dedicated loop for bar objects
  function sumBar(b) { let s = 0; for (const k in b) s += b[k]; return s; }
  // Cold path: generic utility for arbitrary config objects
  function describe(obj) { for (const k in obj) console.debug(k, obj[k]); }
  ```
- Avoid/caveats: Do not duplicate code everywhere. Apply this only to loops that a profile shows as hot.
- Status: Current in V8 `main` (2026-09-23). The measurement is from V8 13.6 (Node 24).
- Sources: V8 `src/compiler/js-operator.h` (`ForInMode`) ; V8 `src/objects/feedback-vector.h` (`GetForInFeedback`) ; local measurement `raw/v8-batch-6/bench/bench7.mjs`

### In hot loops, read known fields directly; if you must iterate keys, avoid `Object.entries` and per-frame `Object.keys`
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop
- Impact: medium. Direct access was 18x faster than for-in and 50x faster than `Object.entries` in the local test. Entries allocate one array per property per call.
- Do: When the shape is known (OHLC bars, points, series styles), write `b.open + b.high + ...` or keep the values in parallel typed arrays. When you need generic iteration, prefer for-in or `Object.values`. Do not call `Object.entries`/`Object.keys` inside per-frame loops; compute the key list once and reuse it.
- Why: `Object.keys` copies the enum cache into a new JSArray on every call (`ObjectKeys` builtin). `Object.entries` on its fast path (fast properties, no elements, no accessors) still allocates a two-element JSArray for each property plus the outer array (`FastGetOwnValuesOrEntries`). for-in with an enum cache allocates no key array. Direct named loads compile to one field load per property.
- Example:
  ```js
  // Before (per frame, per bar)
  for (const [k, v] of Object.entries(bar)) acc[k] += v;
  // After
  acc.open += bar.open; acc.high += bar.high; acc.low += bar.low; acc.close += bar.close;
  ```
- Avoid/caveats: Escape analysis in TurboFan can remove some short-lived arrays when everything inlines. Do not rely on it for large or polymorphic loops.
- Status: Current in V8 `main` (2026-09-23).
- Sources: V8 `src/builtins/builtins-object-gen.cc` (`ObjectKeys`, `FastGetOwnValuesOrEntries`) ; https://v8.dev/blog/fast-for-in ; local measurement `raw/v8-batch-6/bench/bench2.mjs`

---

## B. Getting things sorted in V8 (2018-09-28, updated 2019-06; engine changed again in 2026)

### Always pass a numeric comparator when you sort numbers with `Array.prototype.sort`
- Layer: js
- Stage: script-run
- Metrics: INP, TBT
- When: interaction, load
- Impact: high for correctness and medium for speed. The default sort converts every value to a string for each comparison: the order is wrong (`80` before `9`) and the sort was 3.2x slower on 1e6 doubles.
- Do: Use `arr.sort((a, b) => a - b)` for ascending numbers. For strings, see the collator rule below.
- Why: Without a comparator, the spec compares the `ToString` results in UTF-16 code-unit order. V8's default comparator calls `toString` on both values for each comparison, and user `toString` methods can run.
- Example:
  ```js
  const prices = [101.5, 99.25, 100];
  prices.sort();                  // Before: string order, slow
  prices.sort((a, b) => a - b);   // After: numeric order
  ```
- Avoid/caveats: `a - b` is correct for finite numbers only. It gives NaN when a value is NaN; remove or map NaN first.
- Status: Current. `Array.prototype.sort` is Baseline widely available (MDN: since July 2015).
- Sources: https://v8.dev/blog/array-sort ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort ; local measurement `raw/v8-batch-6/bench/bench1.mjs`

### Sort typed arrays with `.sort()` and no comparator; reverse afterwards for descending order
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT, memory
- When: interaction, load
- Impact: medium. The default path is a C++ `std::sort` on the raw buffer (measured 61 ms vs 241 ms with `(a, b) => a - b`, 1e6 Float64 values) and allocates no JS objects.
- Do: For numeric ascending order on `Float64Array`, `Int32Array` and similar, call `ta.sort()` with no argument. For descending order, call `ta.sort().reverse()`. Pass a comparator only when you need an order that is not numeric.
- Why: `TypedArray.prototype.sort` with `comparefn === undefined` calls `Runtime_TypedArraySortFast`, which runs `std::sort` in place with a numeric compare (it orders -0 before +0 and puts NaN last). With a comparator, V8 allocates two FixedArrays of length n, stores every element as a tagged value (non-Smi values become HeapNumbers), merge-sorts while calling your function, and then writes back. It throws a TypeError if the length exceeds the maximum FixedArray length.
- Example:
  ```js
  const xs = new Float64Array(samples);
  xs.sort();                        // ascending, C++ sort, no allocation per element
  xs.sort().reverse();              // descending
  // Avoid: xs.sort((a, b) => b - a);  // boxes values and calls JS n log n times
  ```
- Avoid/caveats: `std::sort` is not stable, which does not matter for plain numbers. To sort records by a numeric key, sort an index array or packed keys instead (see the key-precompute rule).
- Status: Current in V8 `main` (2026-09-23). `TypedArray.prototype.sort` default order is numeric per spec.
- Sources: V8 `src/builtins/typed-array-sort.tq` (`TypedArraySortCommon`) ; V8 `src/runtime/runtime-typedarray.cc` (`Runtime_TypedArraySortFast`) ; https://v8.dev/blog/array-sort ; local measurement `raw/v8-batch-6/bench/bench1.mjs`

### Rely on stable sorting: remove index tie-breakers and "stable sort" helper libraries
- Layer: js
- Stage: script-run, build
- Metrics: bundle-size, INP
- When: interaction, build
- Impact: low. It removes extra work in the comparator and extra code.
- Do: Sort by a secondary key first and then by the primary key, or chain both keys in one comparator. Do not add an original-index field only to keep equal items in order.
- Why: V8 made `Array.prototype.sort` stable in V8 7.0 / Chrome 70 (TimSort, 2018). ECMAScript 2019 requires stability in all engines. In April 2026 V8 replaced TimSort with PowerSort, which is also a stable, adaptive merge sort.
- Example:
  ```js
  // Before: decorate with index to keep ties stable
  rows.map((r, i) => [r, i]).sort((a, b) => a[0].time - b[0].time || a[1] - b[1]);
  // After
  rows.sort((a, b) => a.time - b.time);
  ```
- Avoid/caveats: The default `TypedArray` sort is not stable (see the previous rule); this matters only if you sort by a comparator on records.
- Status: Current. MDN: stability is required since ECMAScript 2019. PowerSort is in V8 14.9+ (Chrome 149, stable 2026-06-02; V8 commit 8899b945f6, 2026-04-20).
- Sources: https://v8.dev/blog/array-sort ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort ; V8 `third_party/v8/builtins/array-sort.tq` ; V8 commit https://github.com/v8/v8/commit/8899b945f6b95d5801e23f1021d2d576f3e73b70

### Write pure, consistent comparators and never change the array while it sorts
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT
- When: interaction
- Impact: medium. A comparator that changes the array makes V8 drop the fast path and continue on the generic accessor path. An inconsistent comparator gives an engine-specific order.
- Do: Make the comparator return a negative number, 0 or a positive number, with no side effects. It must be reflexive, anti-symmetric and transitive. Do not push to, pop from or reshape the array (or its elements' prototype chain) inside the comparator or inside `toString`. You do not need `undefined` checks: sort never passes `undefined` to the comparator.
- Why: V8 first copies all non-undefined values into a work array, counts `undefined`s, and skips holes. After sorting it writes values back, then the `undefined`s, then deletes the remaining indices. Each time control returns from user code, V8 compares the receiver's current map and length with the initial ones. If they changed, it switches the load/store accessors to the generic versions (the 2018 post says it restarts the run; the 2026 PowerSort `SortState` comment says it bails to the generic elements accessor).
- Example:
  ```js
  // Before: random comparator (inconsistent) and side effects
  items.sort(() => Math.random() - 0.5);
  // After: shuffle with Fisher-Yates, and keep comparators pure
  for (let i = items.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [items[i], items[j]] = [items[j], items[i]];
  }
  ```
- Avoid/caveats: Accessors on array indices and index properties on the prototype chain give implementation-defined results. Do not write code that depends on them.
- Status: Current in V8 `main` (2026-09-23).
- Sources: https://v8.dev/blog/array-sort ; V8 `third_party/v8/builtins/array-sort.tq` (`SortState`) ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort

### Keep comparators cheap: precompute sort keys and reuse one `Intl.Collator`
- Layer: js
- Stage: script-run
- Metrics: INP, TBT
- When: interaction, load
- Impact: medium. The comparator runs O(n log n) times, and each call is a builtin-to-JS transition, so its cost dominates the sort.
- Do: When the comparator computes something (string distance, parsing, date parsing, `toLowerCase`, `localeCompare` with options), compute the key once per element, sort the keys or an index array, and then reorder. For locale-aware string sorting, create one `Intl.Collator` and pass `collator.compare`.
- Why: The post notes that a comparison in JS is about an order of magnitude more expensive than a memory access, because it calls user code. Array#sort is a Torque builtin, so outside the small-array inline case (below), every comparison is a call from the builtin into JS. In the Web Tooling Benchmark, `chai` spent a third of its time in one comparator.
- Example:
  ```js
  // Before: parses dates n log n times
  trades.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  // After: parse once per element
  const keyed = trades.map(t => ({ t, k: Date.parse(t.ts) }));
  keyed.sort((a, b) => a.k - b.k);
  const sorted = keyed.map(x => x.t);
  // Strings
  const byName = new Intl.Collator('en', { sensitivity: 'base' });
  symbols.sort(byName.compare);
  ```
- Avoid/caveats: The map-sort pattern allocates two arrays. Use it only when the comparator is expensive. See also 08-v8-batch-04, "For option-free string sorting, localeCompare with a listed locale is fast; with options, reuse one Intl.Collator".
- Status: Current. MDN documents both the "Sorting with map" pattern and the collator advice for large string sorts.
- Sources: https://v8.dev/blog/array-sort ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare

### Let the sort exploit presorted runs: appending a few items and sorting again is near-linear
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: interaction, long-lived session
- Impact: medium. A presorted 1e6-element array sorted in 6.8 ms vs 152 ms for random data (22x).
- Do: For time series that arrive mostly in order (a few late ticks), append and call `sort`, or better, insert each late tick with a binary search. Do not write your own merge code for this case.
- Why: TimSort (2018) and PowerSort (2026) scan for existing ascending or strictly descending runs, reverse descending runs, and merge runs. Sorted input is one run, so the cost is O(n) comparisons. Short runs are extended with binary insertion sort. The post measured up to 17x over the old QuickSort on inputs made of two reverse-sorted runs.
- Example:
  ```js
  series.push(...lateTicks);          // mostly sorted already
  series.sort((a, b) => a.t - b.t);   // near-linear on this input
  ```
- Avoid/caveats: Each call still reads every element and calls the comparator at least n-1 times. For a stream of single inserts in a render loop, binary insertion is cheaper than a full sort per insert.
- Status: Current. PowerSort keeps TimSort's behavior on trivially sorted inputs (V8 commit 8899b945f6).
- Sources: https://v8.dev/blog/array-sort ; V8 `third_party/v8/builtins/array-sort.tq` ; https://github.com/v8/v8/commit/8899b945f6b95d5801e23f1021d2d576f3e73b70 ; local measurement `raw/v8-batch-6/bench/bench1.mjs`

### For small sorts in hot code, sort packed arrays with an inline or module-constant comparator (Chrome 149+ inlines them)
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: low to medium. It removes the builtin-to-JS transition on each comparison for arrays of 16 or fewer elements, for example z-ordering a few series or legend items per frame.
- Do: Keep the array PACKED (no holes; see 08-v8-batch-01). Pass the comparator as an arrow function literal at the call site or as a module-level constant function. Keep one elements kind per call site. Sort in place a scratch array that you reuse.
- Why: Since V8 14.9 (Chrome 149), `JSCallReducer::ReduceArraySort` replaces `arr.sort(cmp)` with an inline insertion sort when the length is at most `JSArray::kMaxInlineSortLength` (16), the comparator is statically known to be callable (a constant, a closure created at the site, or a checked closure), and all receiver maps have the same elements kind (fix from August 2026). TurboFan supports PACKED_SMI and PACKED_ELEMENTS only. Maglev supports all packed kinds, PACKED_DOUBLE included. Longer arrays call the PowerSort builtin. Every deopt continues in the generic PowerSort tail, so the result stays correct.
- Example:
  ```js
  const byZ = (a, b) => a.z - b.z;      // module-level constant
  function drawFrame(visible) {          // visible: packed array, <= 16 items
    visible.sort(byZ);
    for (const s of visible) s.draw();
  }
  ```
- Avoid/caveats: Holey arrays, TurboFan-compiled double arrays, and a comparator passed through a changing variable do not get inlined. The gain is small unless the sort runs thousands of times per second.
- Status: New in V8 14.9 / Chrome 149 (stable 2026-06-02). Commits 66a3f1e94d (2026-04-27) and e0562d87ad (2026-08-07, no inlining for mixed elements kinds).
- Sources: V8 `src/compiler/js-call-reducer.cc` (`ReduceArraySort`, `ReduceArrayPrototypeSort`) ; V8 `src/objects/js-array.h` (`kMaxInlineSortLength = 16`) ; https://github.com/v8/v8/commit/66a3f1e94d4b681bff6476a876067a3c79a853f0 ; https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=149

### Sort scratch arrays in place; use `toSorted()` only when you need an unchanged original
- Layer: js
- Stage: script-run, gc-memory
- Metrics: memory, FPS/smoothness
- When: animation/render-loop, interaction
- Impact: low. It avoids one array copy per call.
- Do: In per-frame or per-tick code, sort a scratch array that you own in place. Use `toSorted()` in UI or state code where the source array must not change (for example, reactive state).
- Why: `toSorted()` first copies the array and then runs the same sort. Every sort call also allocates a `SortState` and, for merges, a temporary array that can grow to n/2. The post found no memory regression because these are short-lived young-generation objects, but they still add GC pressure in a render loop.
- Example:
  ```js
  // Per frame
  scratch.length = 0; for (const s of series) scratch.push(s);
  scratch.sort(byZ);
  // UI state
  const view = rows.toSorted(byPrice);
  ```
- Avoid/caveats: Do not reuse an array that other code still reads.
- Status: `Array.prototype.toSorted` ("Array by copy") is Baseline widely available (webstatus: low 2023-07-04, high 2026-01-04).
- Sources: https://v8.dev/blog/array-sort ; https://webstatus.dev/features/array-by-copy ; V8 `third_party/v8/builtins/array-sort.tq`

---

## C. Optimizing ES2015 proxies in V8 (2017-10-05)

### Keep Proxy objects out of hot data paths: unwrap before loops, and never proxy large numeric arrays
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, INP, TBT
- When: animation/render-loop, interaction
- Impact: high. A property read through a proxy was 19-32x slower than a plain read, and summing a proxied 1e6-element array was about 100x slower (V8 13.6).
- Do: Before a hot loop, take the raw target or a plain copy of the data and use that. Keep series data, vertex buffers and indicator outputs in plain arrays or typed arrays, never behind a Proxy. Do not construct objects through a proxied constructor (`new P()`), and do not use `in`, for-in or `Object.keys` on proxies in hot code.
- Why: A Proxy has no shape that inline caches can learn. Each `get`, `set`, `has` or `construct` runs the trap protocol: load the handler, look up the trap, call it, and check the result against the target. The 2017 work moved traps from C++ into CSA builtins (calls up to 5x faster), but it did not remove the per-access trap call. Indexed `set` still bailed out to the runtime in 2017. A for-in over a proxy calls up to 5 of the 13 traps (`ownKeys`, `getPrototypeOf`, `getOwnPropertyDescriptor` per key, `has`, `get`). In V8 `main`, the IC for a proxy receiver installs the slow `LoadProxy` handler. The new monomorphic "fast proxy IC" (named `get` only, never elements or `has`) is behind `--future` (default off, 2026-09-23).
- Example:
  ```js
  // Before: proxied array in the render loop
  for (let i = 0; i < state.points.length; i++) y += state.points[i];
  // After: unwrap once (framework-specific: a raw state, a snapshot, or a typed array)
  const pts = rawPoints;               // Float64Array, not proxied
  for (let i = 0; i < pts.length; i++) y += pts[i];
  ```
- Avoid/caveats: Proxies are fine at cold boundaries (RPC wrappers like Comlink, dev-time validation). If a future V8 turns on the fast proxy IC, it will need: a plain handler object with a `get` function as a data property (not a class constructor), an extensible, non-dictionary target, and configurable target properties. Do not depend on it yet.
- Status: Proxy is Baseline widely available (webstatus "Proxy and Reflect": low 2016-09-20, high 2019-03-20). Fast proxy IC: V8 commit be455d8278 (2026-05-28), enabled only by `--future` (`DEFINE_BOOL(fast_proxy_ic, false, ...)`).
- Sources: https://v8.dev/blog/optimizing-proxies ; https://v8.dev/blog/fast-for-in ; V8 `src/ic/ic.cc` (JSPROXY case) ; V8 `src/flags/flag-definitions.h` ; https://github.com/v8/v8/commit/be455d8278 ; https://webstatus.dev/features/proxy-reflect ; local measurement `raw/v8-batch-6/bench/bench1.mjs`

### In Svelte 5, hold large or numeric datasets in `$state.raw`, typed arrays or class instances, not deep `$state`
- Layer: js
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: interaction, animation/render-loop, long-lived session
- Impact: high for chart data. Deep `$state` wraps arrays and plain objects in proxies recursively, so each element read pays the proxy cost from the rule above.
- Do: Store candles, ticks and series arrays with `$state.raw` and replace the whole value when it changes. Or keep them in a `Float64Array` or a class instance, which Svelte does not proxy. Pass `$state.snapshot(value)` to chart libraries (SciChart, WebGL upload code) that expect plain data.
- Why: Svelte documents that state is proxied recursively until it finds something that is not an array or a simple object, that class instances are not proxied, and that `$state.raw` "avoids the cost of making them reactive" for large arrays and objects. Every read through the proxy then runs a trap (see the V8 rule above).
- Example:
  ```js
  // Before
  let candles = $state([]);                 // deep proxy per candle object
  // After
  let candles = $state.raw([]);             // no proxy; reassign to update
  candles = [...candles, next];             // or keep a typed array and bump a version counter
  ```
- Avoid/caveats: With `$state.raw`, mutation does not trigger updates; you must reassign. Svelte's reactive `SvelteMap`/`SvelteSet` have their own per-operation cost.
- Status: Svelte 5 docs (read 2026-09-23).
- Sources: https://svelte.dev/docs/svelte/$state ; https://v8.dev/blog/optimizing-proxies

---

## D. Improving V8 regular expressions (2019-10-04), updated by the 2026 single-tier change

### Create each distinct RegExp once: hoist `new RegExp(...)` out of loops and do not generate many one-off patterns
- Layer: v8
- Stage: script-run, script-compile, gc-memory
- Metrics: INP, TBT, memory
- When: load, interaction
- Impact: medium. `new RegExp(string)` in a loop was 2x slower than a hoisted regex, and each new pattern costs a parse plus a native-code compile and code memory.
- Do: Define fixed patterns once at module scope. For patterns built at run time (a search term, a symbol list), build them once per input and cache them by source and flags. Prefer string methods (`startsWith`, `includes`, `indexOf`, `split(',')`) for literal checks instead of generating many tiny regexes. Do not pre-run a regex to "warm it up".
- Why: V8 compiles a regex on first execution. From Chrome 79 to Chrome 151 it first compiled to bytecode and interpreted it (saving 4-7% heap code size), and compiled to native code on the second execution (`regexp_tier_up_ticks = 1`). It compiled native code at once for subjects of 1000 or more characters and for global replace with a callback. Since V8 15.2 (Chrome 152) the default is single-tier: native code on first use (`regexp_tier_up_ticks = 0`). The compiled data is shared through a compilation cache keyed by (source, flags), but that cache has only 2 generations and ages on GC, so rarely used dynamic patterns get compiled again. A regex literal inside a loop creates a new object each time from a cached boilerplate, which is cheap (measured equal to hoisted).
- Example:
  ```js
  // Before: compiles or looks up a pattern per row
  rows.filter(r => new RegExp('^' + prefix).test(r.symbol));
  // After
  const re = new RegExp('^' + RegExp.escape(prefix));   // once per prefix
  rows.filter(r => re.test(r.symbol));
  // Or no regex at all
  rows.filter(r => r.symbol.startsWith(prefix));
  ```
- Avoid/caveats: A shared regex with the `g` or `y` flag keeps `lastIndex` state across calls. Reset `lastIndex = 0` or use a non-global regex for `test`. JIT-less configurations (V8 `--jitless` implies `--regexp-interpret-all`) always interpret regexes.
- Status: OBSOLETE detail: "the first execution is interpreted" holds for Chrome 79-151 only (V8 commit 4b2ab5e9cf, 2026-07-06; `15.2-lkgr` to `15.4-lkgr` have ticks = 0; `15.1-lkgr` has 1). The coding rule is unchanged. `RegExp.escape` is Baseline 2025 newly available (May 2025).
- Sources: https://v8.dev/blog/regexp-tier-up ; V8 `src/flags/flag-definitions.h` (`regexp_tier_up_ticks`) ; V8 `src/regexp/regexp.cc` ; V8 `src/objects/js-regexp.h` (`kTierUpForSubjectLengthValue = 1000`) ; V8 `src/codegen/compilation-cache.h` (`CompilationCacheRegExp`, `kGenerations = 2`) ; https://github.com/v8/v8/commit/4b2ab5e9cf58e2d9b13d36ec98f0a417686377ee ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/escape ; local measurement `raw/v8-batch-6/bench/bench4.mjs`

### Use `test()` when you need only a yes/no answer
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, TBT, memory
- When: interaction, load (parsing and filtering)
- Impact: low to medium. `test()` was 2.2x faster than `exec()` on 2e5 lines because it builds no result array.
- Do: Use `re.test(s)` for filters and validation. Use `exec`/`match` only when you read captures or the index.
- Why: V8's `RegExpPrototypeTest` fast path calls `RegExpPrototypeExecBodyWithoutResultFast`, which runs the matcher and returns without creating the match array (with `index`, `input`, `groups` and capture strings). MDN gives the same advice for clarity: use `test()` if you only care whether the regex matches.
- Example:
  ```js
  // Before
  if (ISO_TS.exec(line)) count++;
  // After
  if (ISO_TS.test(line)) count++;
  ```
- Avoid/caveats: With `g` or `y`, `test()` also advances `lastIndex`.
- Status: Current in V8 `main` (2026-09-23).
- Sources: V8 `src/builtins/regexp-test.tq` ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec ; local measurement `raw/v8-batch-6/bench/bench4.mjs`

---

## E. An additional non-backtracking RegExp engine (2021-01-11)

### Write backtracking-safe patterns: no nested or overlapping quantifiers, anchor them, and cap input length
- Layer: v8
- Stage: script-run, main-thread-task
- Metrics: INP, TBT
- When: interaction, load
- Impact: high when it happens. Match time grows exponentially: `/(a*)*b/` on 18, 20, 22 and 24 characters took 17, 17, 71 and 285 ms, and the tab freezes on longer input.
- Do: Do not nest quantifiers over the same characters (`(a+)+`, `(a*)*`, `(\w+\s?)*$`). Make alternatives mutually exclusive (`(?:\d+|[a-z]+)`, not `(?:\w+|\d+)`). Anchor patterns (`^...$`) and limit input length before you match. Do simple checks with string methods.
- Why: V8's default engine, Irregexp, is a backtracking engine. On a failed match it tries every other way to split the input among ambiguous quantifiers. V8 has a linear-time, breadth-first engine that tracks all automaton states at once (cost O(pattern × input)). But it is off by default: `--enable-experimental-regexp-engine-on-excessive-backtracks` is an experimental flag (V8 `main`), and Chrome's `kV8ExperimentalRegexpEngine` feature keeps V8's default. When enabled, it falls back only after 50,000 backtracks, and only for patterns without backreferences, lookaround, large bounded repeats, or the `i`/`u` flags. The `l` (linear) flag is non-standard and also flag-gated.
- Example:
  ```js
  // Before: ambiguous -> catastrophic on a long line with no match
  const LIST = /^(\w+\s?)*$/;
  // After: one way to match each part
  const LIST = /^\w+(?:\s\w+)*$/;
  if (line.length <= 256 && LIST.test(line)) { /* ... */ }
  ```
- Avoid/caveats: Irregexp is orders of magnitude faster than the linear engine on common patterns (per the post), so do not wish for the linear engine as a general fix. See 08-v8-batch-05, "Anchor test and parse RegExps", for start-position scanning.
- Status: The linear engine is still experimental and off by default in V8 `main` and in Chrome (2026-09-23).
- Sources: https://v8.dev/blog/non-backtracking-regexp ; V8 `src/flags/flag-definitions.h` (`enable_experimental_regexp_engine_on_excessive_backtracks`, `regexp_backtracks_before_fallback = 50000`) ; Chromium `gin/gin_features.cc`, `gin/v8_initializer.cc` ; local measurement (inline command, V8 13.6)

### Treat user text as literal: escape it with `RegExp.escape`, and run user-written patterns off the main thread with a time limit
- Layer: js
- Stage: script-run, main-thread-task
- Metrics: INP, TBT
- When: interaction
- Impact: medium. It stops a symbol search or a log filter from turning user input into a catastrophic pattern that blocks the main thread.
- Do: When you put user text into a regex, wrap it with `RegExp.escape(text)` (or use `includes`/`indexOf` when no regex feature is needed). If users can type real regex patterns (an advanced filter), run the match in a Worker and terminate the Worker after a time budget.
- Why: Irregexp cannot stop a runaway match, and the linear fallback is off by default (see the rule above). Escaping turns every metacharacter into a literal, so the pattern cannot contain user-made nested quantifiers. A Worker keeps a slow match away from input handling and rendering.
- Example:
  ```js
  const q = RegExp.escape(searchBox.value.trim());
  const re = new RegExp(q, 'i');
  const hits = symbols.filter(s => re.test(s.name));
  ```
- Avoid/caveats: For older browsers without `RegExp.escape`, use a small escape helper that escapes `\^$.*+?()[]{}|/` and `-`.
- Status: `RegExp.escape` is Baseline 2025 newly available (webstatus: low 2025-05-01).
- Sources: https://v8.dev/blog/non-backtracking-regexp ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/escape ; https://webstatus.dev/features/regexp-escape

---

## F. Super fast super property access (2021-02-18)

### Use `super.method()` and `super.prop` freely in class and object-literal methods
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: interaction, animation/render-loop
- Impact: low. It removes an old reason to avoid `super` or to copy parent logic into child classes.
- Do: Call parent methods with `super.method(...)` in subclasses (for example, a derived drawing tool that extends a base tool's `hitTest`). Do not rewrite them as `Parent.prototype.method.call(this, ...)` for speed.
- Why: Before V8 9.0, every `super.x` was a runtime call and about an order of magnitude slower than a normal property load. Since V8 9.0 (Chrome 90), the `LdaNamedPropertyFromSuper` bytecode uses a `LoadSuperIC` that caches the shape of the lookup start object (the home object's `__proto__`). TurboFan compiles it like a normal load, and it embeds the home object (stored in the class context) as a constant when possible. In the interpreter, it is still a little slower than a normal load (two extra loads).
- Example:
  ```js
  class Tool { hitTest(p) { return this.bbox.contains(p); } }
  class FibTool extends Tool {
    hitTest(p) { return super.hitTest(p) || this.levels.some(l => l.near(p)); }
  }
  ```
- Avoid/caveats: See the next two rules for the cases that are still slow.
- Status: Current. V8 `main` has `super_ic = true` (2026-09-23). Class syntax is Baseline widely available.
- Sources: https://v8.dev/blog/fast-super ; V8 `src/interpreter/bytecode-generator.cc` (`VisitNamedSuperPropertyLoad`) ; V8 `src/flags/flag-definitions.h` (`super_ic`)

### Keep keyed super access, super property writes and super compound assignment out of hot code
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: animation/render-loop, interaction
- Impact: low to medium. Each of these is still a C++ runtime call on every execution.
- Do: Use only named super loads (`super.x`, `super.m()`) in hot methods. Replace `super[name]`, `super.x = v`, `super.x += 1` and `super.x++` with plain `this` access (a write to `super.x` on a normal data property is a write to `this` anyway) or with a named method call.
- Why: In V8 `main`, the bytecode generator emits `CallRuntime(kLoadKeyedFromSuper)` for keyed super loads, `kStoreToSuper` / `kStoreKeyedToSuper` for super stores, and `kLoadFromSuper` for the load part of compound and count operations. Only the plain named load path uses the IC. The post also says super writes are not optimized.
- Example:
  ```js
  // Before
  class B extends A { bump() { super.count += 1; } }
  // After: same effect for a data property on the instance
  class B extends A { bump() { this.count += 1; } }
  ```
- Avoid/caveats: The rewrite is equal only when no setter on the prototype chain intercepts the write. Check that before you change it.
- Status: Current in V8 `main` (2026-09-23).
- Sources: https://v8.dev/blog/fast-super ; V8 `src/interpreter/bytecode-generator.cc`

### Do not build hot class hierarchies from mixin factories: one `super` site that sees many home objects goes megamorphic
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: animation/render-loop
- Impact: low to medium. The `super.m()` site in the mixin body sees a different lookup start object for each generated class, so its IC becomes megamorphic.
- Do: For hot paths, prefer a fixed class hierarchy or composition (a helper object that the class calls) over `const Mixed = A(B(C(Base)))` factories. Keep mixins for cold code.
- Why: Each factory call creates a new class, but all of them share the same method source and the same feedback. The `LoadSuperIC` at `super.m()` records the shape of each home object's prototype. With more shapes than the polymorphic limit, it becomes megamorphic and uses the slower generic lookup. The post names this case as not optimized.
- Example:
  ```js
  // Before
  const Selectable = B => class extends B { hit(p) { return super.hit(p) && this.enabled; } };
  class Line extends Selectable(Draggable(Base)) {}
  // After: composition, monomorphic calls
  class Line extends Base { constructor() { super(); this.sel = new Selection(this); } }
  ```
- Avoid/caveats: The IC polymorphic limit changed in 2026 (see 08-v8-batch-04, "Keep hot property-access sites monomorphic").
- Status: Current in V8 `main` (2026-09-23).
- Sources: https://v8.dev/blog/fast-super

---

## G. Adding BigInts to V8 (2018-05-02), updated by 2022-2026 optimizations

### Use Number for prices, sizes and millisecond timestamps; use BigInt only for true 64-bit integers, and convert at the boundary
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop, interaction, long-lived session
- Impact: medium to high in numeric loops. In V8 13.6, summing 1e6 small BigInts from an array was 3x slower than summing Numbers (1.73 ms vs 0.58 ms) even with the 64-bit optimization. A loop that also used a BigInt counter and called `BigInt(n)` on each iteration was 34x slower (1e7 iterations).
- Do: Keep chart math in Numbers (float64): millisecond timestamps (about 1.8e12) and prices fit exactly below 2^53. Use BigInt only for values that need more than 53 bits (64-bit sequence numbers, nanosecond timestamps, 64-bit ids). Convert those to Number or string once, when you decode them. Never mix BigInt and Number in one expression; it throws a TypeError.
- Why: A BigInt is a heap object with a sign and an array of 64-bit "digits" (32-bit on 32-bit machines). In unoptimized code, every arithmetic result allocates a new BigInt. Multiplication and division use Knuth's schoolbook algorithms. Bitwise operations on negative BigInts convert to a two's-complement form and back, so they cost more steps than on positive ones.
- Example:
  ```js
  // Before
  let volume = 0n; for (const t of trades) volume += BigInt(t.size);
  // After
  let volume = 0; for (const t of trades) volume += t.size;
  ```
- Avoid/caveats: `JSON.stringify` throws on BigInt values; convert them first. Number loses precision above 2^53 (9,007,199,254,740,991).
- Status: BigInt is Baseline widely available (webstatus: low 2020-09-16, high 2023-03-16). Shipped in Chrome 67.
- Sources: https://v8.dev/blog/bigint ; https://webstatus.dev/features/bigint ; local measurement `raw/v8-batch-6/bench/bench3.mjs`, `bench9.mjs`

### When BigInt is required in hot code, keep values in the 64-bit range and use `BigInt64Array` or `BigInt.asIntN(64, ...)`
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory
- When: animation/render-loop, long-lived session
- Impact: medium. Optimized code keeps 64-bit BigInts in registers instead of allocating a heap object per operation (V8 13.6: `BigInt64Array` sum 1.34 ms vs a plain BigInt array 1.73 ms vs `Float64Array` 0.53 ms, 1e6 elements).
- Do: Store 64-bit integer columns in `BigInt64Array`/`BigUint64Array`. Keep values in each hot operation within the signed or unsigned 64-bit range. When wraparound is acceptable, wrap results with `BigInt.asIntN(64, x)` or `BigInt.asUintN(64, x)`. Do not send huge BigInts through the same code sites.
- Why: The 2018 post said BigInts were not optimized and always heap-allocated. That is no longer true. Since V8 10.8 (Chrome 108) TurboFan collects "BigInt64" feedback and lowers add, subtract, multiply, divide, modulus, bitwise ops, shifts, negate and comparisons to checked Word64 machine operations. It deoptimizes on overflow or out-of-range input. Since V8 11.1 (Chrome 111) loads and stores on BigInt64 arrays stay as word64 without allocation. `BigInt.asIntN/asUintN(64)` let TurboFan truncate to 64 bits. Deopts rematerialize the BigInt. In June 2026 Maglev also got BigInt specializations.
- Example:
  ```js
  const seq = new BigUint64Array(n);          // 64-bit ids from the feed
  let h = 0n;
  for (let i = 0; i < n; i++) h = BigInt.asUintN(64, h * 31n + seq[i]);  // stays in word64 when optimized
  ```
- Avoid/caveats: A site that sees one value outside the 64-bit range loses the speculation (deopt, then generic code). Interpreted and baseline code still allocates.
- Status: OBSOLETE statement in the 2018 post: "BigInt support in the optimizing compiler is only a plan." Current: TurboFan BigInt64 lowering (commits fced4e9e35 2022-09-29, b53f4d8247 2022-12-16); Maglev BigInt specialization (commit ae67ffb8a7, 2026-06-16). `BigInt64Array` is Baseline widely available (webstatus: low 2021-09-20, high 2024-03-20).
- Sources: https://v8.dev/blog/bigint ; V8 `src/compiler/simplified-operator.h` (`SpeculativeBigInt*`) ; V8 `src/compiler/simplified-lowering.cc` (`BigIntOperationHint::kBigInt64`) ; https://github.com/v8/v8/commit/fced4e9e35 ; https://github.com/v8/v8/commit/b53f4d8247 ; https://github.com/v8/v8/commit/ae67ffb8a7 ; https://webstatus.dev/features/bigint64array

### Decode 64-bit wire fields that fit in 53 bits as two 32-bit reads, not `getBigUint64` plus `Number()`
- Layer: js
- Stage: script-run, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: interaction, long-lived session (binary WebSocket feeds)
- Impact: medium for high-rate feeds. It was 12x faster in the local test (0.79 ms vs 9.8 ms per 1e6 fields) and creates no temporary BigInt.
- Do: For a u64 field that you know stays below 2^53 (millisecond timestamps, most trade ids), read `hi * 2 ** 32 + lo` from two `getUint32` calls. If you control the protocol, send float64 or u32 fields for values that the chart uses as Numbers. Keep `getBigInt64` for fields that can exceed 2^53.
- Why: `DataView.prototype.getBigUint64` returns a BigInt, so in code that is not fully optimized each read allocates a heap BigInt, and `Number()` then converts it. Two `getUint32` reads return Smis or doubles that optimized code keeps in registers.
- Example:
  ```js
  // Before
  const ts = Number(view.getBigUint64(off, true));
  // After (little-endian u64 that fits in 53 bits)
  const ts = view.getUint32(off + 4, true) * 2 ** 32 + view.getUint32(off, true);
  ```
- Avoid/caveats: Values above 2^53 lose precision silently with this method. Add a debug assertion `hi < 0x200000` if the range is not guaranteed.
- Status: `DataView` BigInt methods are part of BigInt support (Baseline widely available). The measurement is from V8 13.6.
- Sources: https://v8.dev/blog/bigint ; local measurement `raw/v8-batch-6/bench/bench8.mjs`

---

## Cross-references and measurements that support rules from other batches

- RegExp instance hygiene (08-v8-batch-04, "Keep RegExp instances and RegExp.prototype unmodified..."): V8 13.6 measurement, 1e5 calls on a 340-character string: `replace` with a pristine `/,/g` took 48 ms; with one expando property on the regex 608 ms (13x); with a `RegExp` subclass instance 624 ms. `split` took 65 ms pristine vs 1490 ms with an expando (23x). V8 `main` `BranchIfFastRegExp` still requires the initial JSRegExp map, a non-negative Smi `lastIndex`, an unmodified prototype (`exec` plus the relevant symbol method), and an intact species protector (`src/builtins/builtins-regexp-gen.cc`, checked 2026-09-23). Script: `raw/v8-batch-6/bench/bench5.mjs`.
- `delete` and dictionary mode (08-v8-batch-01): in V8 13.6, `%HasFastProperties` was false after deleting the last-added property and after deleting the first property of a literal. for-in over that object was 11x slower.

## Deprecated or changed advice found in this batch

- "for-in is slow, never use it" (Crankshaft era): obsolete for fast-mode objects since 2016-2017. The fast path needs an enum cache, no elements and no enumerable prototype properties.
- "Array#sort is unstable, add an index tie-breaker": obsolete since V8 7.0 / Chrome 70 (2018) and ES2019.
- "V8 sorts with TimSort": changed. V8 14.9 / Chrome 149 (2026) uses PowerSort, and it inlines insertion sort for packed arrays of 16 or fewer elements.
- "The first execution of a regex is interpreted; it tiers up on the second" (2019): true for Chrome 79-151 only. Chrome 152+ compiles to native code on first use. There was never a need to warm up regexes.
- "V8 falls back to a linear-time engine on catastrophic backtracking": not true by default. The fallback is still an experimental flag in 2026.
- "super property access is an order of magnitude slower than normal access": obsolete for named loads since V8 9.0 / Chrome 90. Still true for keyed super access and super writes.
- "BigInts are never optimized and always heap-allocated" (2018): obsolete for values in the 64-bit range in TurboFan since Chrome 108/111 and in Maglev since 2026.
- "Proxy traps are slow C++ runtime calls" (pre-2017): partly obsolete, because the traps now run in CSA builtins. But proxies still have no inline caching in shipping V8 (the fast proxy IC is behind `--future`).

## Sources read

- https://v8.dev/blog/fast-for-in
- https://v8.dev/blog/array-sort
- https://v8.dev/blog/optimizing-proxies
- https://v8.dev/blog/regexp-tier-up
- https://v8.dev/blog/non-backtracking-regexp
- https://v8.dev/blog/fast-super
- https://v8.dev/blog/bigint
- V8 `main` source (GitHub mirror, commit a81b3eb9dec6, 2026-09-23): `src/flags/flag-definitions.h`, `src/regexp/regexp.cc`, `src/objects/js-regexp.h`, `src/builtins/builtins-regexp-gen.cc`, `src/builtins/regexp-test.tq`, `src/codegen/compilation-cache.h`, `src/builtins/typed-array-sort.tq`, `src/runtime/runtime-typedarray.cc`, `third_party/v8/builtins/array-sort.tq`, `src/objects/js-array.h`, `src/compiler/js-call-reducer.cc`, `src/compiler/js-native-context-specialization.cc`, `src/compiler/js-operator.h`, `src/objects/feedback-vector.h`, `src/interpreter/interpreter-generator.cc`, `src/interpreter/bytecode-generator.cc`, `src/builtins/builtins-object-gen.cc`, `src/codegen/code-stub-assembler.cc`, `src/ic/ic.cc`, `src/compiler/simplified-operator.h`, `src/compiler/simplified-lowering.cc`
- V8 release branches `14.8-lkgr`, `14.9-lkgr`, `15.0-lkgr`, `15.1-lkgr`, `15.2-lkgr`, `15.3-lkgr`, `15.4-lkgr` (`flag-definitions.h`, `array-sort.tq`, `js-array.h`, `include/v8-version.h`)
- V8 commits: 4b2ab5e9cf (single-tier regexp default), f104fdcb0c (regexp immediate JIT tier-up), 8899b945f6 (TimSort to PowerSort), 66a3f1e94d (inline Array.prototype.sort), be455d8278 (fast Load IC for proxies), fced4e9e35 and b53f4d8247 (BigInt64 in TurboFan), ae67ffb8a7 (Maglev BigInt), and the GitHub commit search results for "regexp tier", "PowerSort", "inline sort", "fast_proxy_ic", "BigInt64"
- Chromium `gin/gin_features.cc`, `gin/v8_initializer.cc` (main, 2026-09-23)
- https://chromiumdash.appspot.com/fetch_milestone_schedule (milestones 149-153) and fetch_releases (current stable 154)
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/escape
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec
- https://svelte.dev/docs/svelte/$state
- webstatus.dev API: array-by-copy, regexp-escape, bigint, bigint64array, proxy-reflect, class-syntax
- Web search: "V8 TurboFan BigInt64 optimization" (v8-reviews group results; used only to find the commits)

## Not covered / could not access

- The posts' charts are images; I did not read their exact values. The notes use only numbers from the post text.
- I did not read the Maglev inline-sort source. The Maglev claims (all packed kinds, PACKED_DOUBLE included) come from the commit message of 66a3f1e94d.
- All local measurements ran on Node 24.16 (V8 13.6). I did not measure Chrome 149+ (inline sort, PowerSort) or Chrome 152+ (single-tier regex). The rules for those versions come from source and commits only.
- `node --runtime-call-stats` printed nothing in the Node 24 release build, so I could not use V8 runtime call stats as a tooling rule.
- I did not check Firefox (SpiderMonkey) or Safari (JavaScriptCore) behavior for any of these engine mechanisms. The engine-level rules are V8-specific. The language-level rules (comparators, `test()`, `RegExp.escape`, Number vs BigInt) apply everywhere.
- The Chrome milestone for the proxy and super IC fixes from July-August 2026 (20d89dc0e0, 289fb32312) was not mapped because they do not change a coding rule.
