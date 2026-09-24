# V8 deep read, batch 1 of 8: shapes, elements kinds, properties, representations, prototypes, script cost, Intl

Scope: developer-facing rules from seven V8 / "JavaScript engine fundamentals" posts (2017-2019): Shapes and Inline Caches, Elements kinds, Fast properties, the React performance cliff, optimizing prototypes, the cost of JavaScript in 2019, and the faster Intl APIs. Each rule was re-checked against later V8 posts (pointer compression 2020, slack tracking 2020, Maglev 2023, mutable heap numbers 2025, explicit compile hints 2025), V8 and Chromium source and commits, and local tests.
Local tests: Node 24.16.0 with V8 13.6.233.17 (the same V8 generation as Chrome 136), using `--allow-natives-syntax` (`%HasFastProperties`, `%HaveSameMap`, `%HasHoleyElements` and similar). Test scripts are in `scratchpad/v8b1/`. When a rule depends on a local measurement, the item says so. The numbers are micro-benchmarks. Use them to see the direction and rough size of an effect, not as exact values.

---

### Give all objects of one kind the same shape: same properties, same order, same creation path
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT, FPS/smoothness
- When: animation/render-loop | long-lived session
- Impact: high, because every property load in hot code is guarded by a shape check, and a mismatch makes the inline cache (IC) polymorphic or megamorphic.
- Do: Create each kind of record in exactly one place (one class constructor, one factory, or one object literal), with every property always present, in one fixed order. Do not build some instances as literals and others by adding properties one at a time. Make the server emit JSON keys in one fixed order.
- Why: Engines store property names and offsets in a shared Shape (V8 calls it a Map, or HiddenClass). An IC stores the shape and the offset, so a repeat access costs only one comparison. The order in which properties are added defines the shape: `{x, y}` and `{y, x}` are different shapes. In V8, an object literal starts directly at a shape that already holds its properties. An object built as `{}` plus assignments walks a separate transition chain, so it ends on a **different** map even when the order is the same (local test: `%HaveSameMap(mk(), {x:1,y:2})` is `false`). JSON.parse rows with the same key order share one map, and that map is the same as the map of the equivalent literal (local test).
- Example:
  ```js
  // Before: two creation paths give two maps, so `bar.price` sites become polymorphic
  const a = { time: t, price: p };
  const b = {}; b.time = t; b.price = p;
  // After: one factory, one literal, one order
  const makeBar = (time, price) => ({ time, price });
  ```
- Avoid/caveats: This matters only on hot paths (per-frame, per-tick, per-row code). Optional properties still break it. Prefer `field: null` (or better, a typed default, see below) over sometimes-absent keys.
- Status: The behavior is common to all major engines (V8, SpiderMonkey, JSC, Chakra, per the Shapes post). Verified in V8 13.6 (2026-09).
- Sources: https://mathiasbynens.be/notes/shapes-ics, https://v8.dev/blog/fast-properties

### Declare every field at construction time and never add properties later
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory
- When: long-lived session | animation/render-loop
- Impact: medium, because properties added after construction create more maps and can land in the out-of-object backing store, which adds one pointer step on each access.
- Do: Assign every field in the constructor, or list it as an initialized class field, even when its first value is a placeholder. Do not attach "expando" properties to objects later (for example, `bar.cachedX = …` in a render loop).
- Why: Each new named property moves the object to a new HiddenClass. In-object properties are the fastest kind. Their count comes from the object's initial size. V8 slack tracking gives constructor-made objects extra in-object slots and returns the unused slots after the 7th construction. Properties added after that go to a separate properties array. An empty `{}` literal gets only 4 in-object slots (slack tracking post). Adding array-index keys does not create new HiddenClasses.
- Example:
  ```js
  class Series { constructor() { this.min = 0.5; this.max = 0.5; this.visible = true; this.cache = null; } }
  // not: const s = new Series(); s.cache = computeCache(); // new map after construction
  ```
- Avoid/caveats: The cost of one extra field is small. The real cost is the shape spread when different code paths add different extras.
- Status: V8-specific mechanism (slack tracking post, 2020). It still applies in 2026.
- Sources: https://v8.dev/blog/fast-properties, https://v8.dev/blog/slack-tracking

### Never use `delete` on objects that hot code reads: set the property to `undefined`, or use a Map
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: long-lived session | animation/render-loop
- Impact: high, because one `delete` moves that object into dictionary (slow) mode for good. ICs then no longer apply to it.
- Do: To "remove" a field, assign `undefined` or `null` and keep the shape. For collections whose keys come and go, use `Map` or `Set`. When you need an object without some keys, build a new object with a literal or a rest/spread copy.
- Why: A dictionary-mode object keeps its own hash table of properties instead of sharing a HiddenClass, so ICs cannot cache the offset. **Update:** the old advice that "deleting the most recently added property is fine" is **obsolete**. V8 removed the fast last-property deletion on 2024-01-11 (commit "[runtime] Drop fast last-property deletion", Chrome 122). The commit says it "interacts badly with other optimizations". Local test on V8 13.6: every `delete` variant we tried (first property, last-added property, only property, warm code) gave `%HasFastProperties === false`. Assigning `undefined` kept the object fast.
- Example:
  ```js
  // Before
  delete order.pendingPrice;          // order is now in dictionary mode
  // After
  order.pendingPrice = undefined;     // same shape, IC stays valid
  const { pendingPrice, ...rest } = order; // or make a new object without the key
  ```
- Avoid/caveats: `delete` is fine on objects used as throwaway dictionaries that are never read on hot paths.
- Status: V8/Chrome 122+ (2024). Other engines differ, but the advice is safe everywhere.
- Sources: https://v8.dev/blog/fast-properties, https://chromium-review.googlesource.com/c/v8/v8/+/5185340 (V8 commit 389ea9be7d, found via the GitHub mirror and chromiumdash)

### Use Map/Set, not plain objects, for dynamic-key dictionaries
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, memory
- When: long-lived session
- Impact: medium, because objects used as hash maps fall into dictionary mode and also pollute shape feedback. Map is built for frequent adds and removals.
- Do: Store symbol→quote, id→drawing, and similar lookups in a `Map`. Keep plain objects for fixed-shape records.
- Why: V8 switches an object to dictionary ("slow") properties when many properties are added and removed. In V8 13.6, adding properties through computed keys (`o[key] = v`) switches after about 20 keys (flag `--fast-properties-soft-limit=12`, which counts out-of-object keyed stores). `JSON.parse` yields dictionary-mode objects at 128 keys or more. `Object.create(null)` and `{__proto__: null}` objects start in dictionary mode (all local tests). MDN says Map "performs better in scenarios involving frequent additions and removals of key-value pairs".
- Example:
  ```js
  // Before: const bySymbol = {}; bySymbol[sym] = quote; delete bySymbol[old];
  const bySymbol = new Map(); bySymbol.set(sym, quote); bySymbol.delete(old);
  ```
- Avoid/caveats: The thresholds are engine internals and they change. Do not design for "stay under 20 keys". Dictionary mode is the right choice for a real dictionary. The problem comes only when record-like hot objects end up there.
- Status: Map/Set are Baseline widely available. The thresholds were measured in V8 13.6 (2026-09).
- Sources: https://v8.dev/blog/fast-properties, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map

### Initialize numeric fields with a number, never with `null` or `undefined`, and give float fields a float from the start
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, INP, memory
- When: animation/render-loop | long-lived session
- Impact: high, because a field whose representation is "Tagged" allocates a new HeapNumber on every write of a non-Smi number. Locally that was about 5x slower plus constant GC.
- Do: Give numeric fields a numeric initial value (`0`, or better a real double such as `NaN` or `0.5` for fields that will hold prices, timestamps, or pixel offsets). Never initialize them with `null`, `undefined`, `''`, or an object. Keep each field's type stable for its whole life.
- Why: V8 tracks a representation for each field (Smi, Double, HeapObject, Tagged) on the shape. A Double field holds a box that is updated in place. A Tagged field must point to an immutable HeapNumber, so each new double value allocates. Changing Smi→Double gives the object a new map and deprecates the old one. Other objects migrate lazily when they are next touched (local test: maps differ until the other object is read). Local benchmark, 5e7 writes of `o.v = o.v + 0.25`: fields initialized with a double or with a Smi took 33 ms with 0 scavenges; fields initialized with `null`, `undefined`, or a string took 155–172 ms with 1,145 scavenges.
- Example:
  ```js
  // Before
  class Viewport { constructor() { this.min = null; this.max = null; } }
  // After
  class Viewport { constructor() { this.min = NaN; this.max = NaN; } } // Double from day one
  ```
- Avoid/caveats: A Smi initial value (`0`) is fine. It moves to Double once, on the first fractional write, at the cost of one map deprecation per shape. Use `NaN` or another double when you want to skip even that step (React's fix used this). The React-specific cliff (non-extensible object + Smi→Double makes orphan maps) was fixed in V8 7.4, see the obsolete item below.
- Status: V8 mechanism, still present in V8 13.6 (verified 2026-09). The 2025 mutable-heap-number post confirms that JSObject double fields still use mutable HeapNumber boxes.
- Sources: https://v8.dev/blog/react-cliff, https://v8.dev/blog/mutable-heap-number

### In TypeScript, do not leave numeric class fields uninitialized when useDefineForClassFields is on
- Layer: v8 (also build)
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory
- When: build | animation/render-loop
- Impact: high for hot numeric objects, because `x: number;` compiles to a field defined as `undefined` first. That makes the field Tagged, so each double write allocates (local benchmark: 178 ms compared with 35 ms).
- Do: Write `x = 0` or `x = NaN` in the class body, or assign only in the constructor and mark the declaration `declare x: number;` so that no field definition is emitted. Avoid `x!: number;` on hot numeric fields.
- Why: When `useDefineForClassFields` is on (the default for `target` ES2022 or later), TS emits native class fields. The TS 3.7 notes say declarations are "always initialized to `undefined`". The first store is therefore `undefined`, and the field representation becomes Tagged before the constructor writes the number (previous item).
- Example:
  ```ts
  class Candle {
    // Before: open!: number;  -> emits `open;` -> field starts as undefined
    open = NaN;                 // After: Double representation from the start
    declare close: number;      // or: no emitted field; assigned in constructor
    constructor(c: number) { this.close = c; }
  }
  ```
- Avoid/caveats: This concerns only objects written often with non-Smi numbers. For object-typed fields, `undefined`/`null` initial values are harmless. The same applies to plain JS class fields written as `x;`.
- Status: Measured on V8 13.6 (2026-09). The TS default is from the TSConfig reference.
- Sources: https://v8.dev/blog/react-cliff, https://www.typescriptlang.org/tsconfig/#useDefineForClassFields, https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html

### Keep loop counters, indices and integer math inside the Smi range
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, TBT
- When: animation/render-loop
- Impact: medium, because integer ops (especially `%` and indexing) run as fast machine integer code, and fractional or out-of-range values force float paths and heap boxes.
- Do: Use integer counters that start at 0 (`for (let i = 0; i < n; i++)`), not fractional steps. Compute an index as an integer, then derive fractional values from it. Remember that ms timestamps (~1.7e12) and values ≥ 2^30 are not Smis in Chrome.
- Why: V8 stores 31-bit signed integers (−2^30 … 2^30−1) as Smis inline. On 64-bit Chrome with pointer compression, a Smi has a 31-bit payload. Node builds without pointer compression use 32-bit Smis (local test: `2**30` stayed Smi in Node). Everything else (`-0`, `NaN`, `±Infinity`, fractions, larger integers) is a HeapNumber. The post shows a `let i = 0.1` loop running about 2x slower than an integer loop, and says integer modulo has fast paths, especially when the divisor is a power of two.
- Example:
  ```js
  // Before: for (let x = x0 + 0.5; x < x1; x += 1) draw(x);
  for (let i = 0, n = x1 - x0; i < n; i++) draw(x0 + i + 0.5);
  ```
- Avoid/caveats: Do not force integer math where the domain is real-valued (prices). Store those as doubles, ideally in Float64Array (see below).
- Status: V8 mechanism, confirmed by the pointer compression post (2020) and the mutable heap number post (2025).
- Sources: https://v8.dev/blog/react-cliff, https://v8.dev/blog/pointer-compression, https://v8.dev/blog/mutable-heap-number

### Keep arrays in the most specific elements kind: know exactly which writes generalize them
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, memory
- When: animation/render-loop | long-lived session
- Impact: medium, because built-ins and optimized loops specialize on the elements kind, and transitions go one way only (SMI → DOUBLE → ELEMENTS) for the life of the array.
- Do: Keep integer arrays pure Smi and double arrays pure double. Never mix in strings, `null`, `undefined`, booleans, or objects. Normalize `-0` before you store into integer arrays (`v | 0`). Do not use `NaN` or `Infinity` as sentinels in integer arrays (use `-1`). For numeric bulk data, prefer TypedArrays.
- Why: V8 tracks a kind for each array (21 kinds, for example PACKED_SMI_ELEMENTS, PACKED_DOUBLE_ELEMENTS, PACKED_ELEMENTS, and HOLEY variants). Local test on V8 13.6. A Smi array becomes DOUBLE when it receives: a fraction, `-0`, `NaN`, `Infinity`, or an integer outside the Smi range (`2**31`). It becomes PACKED_ELEMENTS (generic) when it receives: `undefined`, `null`, a string, a boolean, a BigInt, or an object. Writing an integer back into a DOUBLE array does not return it to SMI. Hidden `-0` sources: `Math.round(-0.2)`, `Math.trunc(-0.5)`, `0 * -1`. `| 0` removes the `-0`.
- Example:
  ```js
  const ticks = [];             // PACKED_SMI
  ticks.push(Math.round(v));    // Before: may push -0 -> PACKED_DOUBLE forever
  ticks.push(Math.round(v) | 0);// After: stays PACKED_SMI (if |v| < 2^30)
  ```
- Avoid/caveats: For DOUBLE data (prices), `NaN` gaps are free because the array is already double. Transitions cost once, and the lasting cost is only in hot loops over big arrays.
- Status: V8 behavior, verified in V8 13.6 (2026-09). The kinds lattice is from the 2017 post.
- Sources: https://v8.dev/blog/elements-kinds

### Do not create holes: exact list of what makes an array HOLEY (and what does not)
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: animation/render-loop | long-lived session
- Impact: low to medium. The post itself says the packed/holey difference is usually too small to measure, but holey reads need prototype-chain checks, and the HOLEY flag is permanent.
- Do: Build arrays with literals, `push`, `a[a.length] = v`, `Array.from`, `Array.of`, spread, `map`, or `filter`. To pre-size, use `new Array(n).fill(v)` (see next item) or a TypedArray.
- Why: A missing element means V8 must look up the prototype chain, so holey kinds carry extra checks. Local test on V8 13.6. **Makes HOLEY:** `new Array(n)` or `Array(n)` (even when fully filled afterwards by index, in any order); elisions `[1,,3]`; writing at index `length + k` with k ≥ 1; setting `a.length` larger; `delete a[i]` (even the last index); a partial `fill`; `Array.prototype.slice.call(arrayLike)`; `structuredClone(array)`. **Stays PACKED:** `push`, `a[a.length] = v`, `pop`, `shift`, `unshift`, `splice`, shrinking `length`, `Array.from(arrayLike)`, `Array.from({length:n}, fn)`, `Array.of`, spread, `map`/`filter`/`slice`/`concat`/`toSorted`/`with` of packed input, `JSON.parse` arrays.
- Example:
  ```js
  // Before
  const xs = new Array(n); for (let i = 0; i < n; i++) xs[i] = f(i);   // HOLEY_SMI forever
  // After
  const xs = Array.from({ length: n }, (_, i) => f(i));                // PACKED
  ```
- Avoid/caveats: Do not rewrite working code only for this. Measure first. Local sum loop over 100k doubles: packed 275 ms and holey 296 ms, about 7% apart.
- Status: Verified in V8 13.6 (2026-09).
- Sources: https://v8.dev/blog/elements-kinds, https://v8.dev/blog/fast-properties

### Pre-size arrays with `new Array(n).fill(value)` (Chrome 135+ turns it PACKED)
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: load | long-lived session
- Impact: low, because it restores the PACKED kind for a common pre-sizing pattern.
- Do: When you need a pre-sized plain array, fill the **whole** array right away: `new Array(n).fill(0)`.
- Why: The 2017 post says a HOLEY array stays holey forever. A 2025-02-28 update adds an exception for `Array.prototype.fill`. V8 commit 785a0f64 ("Array.fill tries to transition to optimal elements kind", first in Chrome 135) makes a fill over all elements switch the array to the best packed kind for the fill value. This can even go backwards in the lattice (local test: `[1.5,,2].fill(0)` → PACKED_SMI). It works only for arrays that still have the initial JSArray map. A partial fill, or an array with extra named properties, stays HOLEY (local test).
- Example:
  ```js
  const counts = new Array(bins).fill(0);   // PACKED_SMI in Chrome 135+ / V8 13.5+
  ```
- Avoid/caveats: In older engines this is still HOLEY (harmless). For numeric buffers, a TypedArray is still better (zero-filled, fixed type, no transitions).
- Status: Chrome 135+ (V8 13.5). Other engines: not applicable or unknown.
- Sources: https://v8.dev/blog/elements-kinds, https://chromium-review.googlesource.com/c/v8/v8/+/6285929

### Never use arrays as sparse maps: large index gaps switch to dictionary elements
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness, memory
- When: long-lived session
- Impact: medium, because dictionary elements make every indexed access a hash lookup, and array built-ins become much slower.
- Do: Use a `Map` (or a TypedArray plus an offset) for sparse integer keys such as bar index → annotation. Do not write `arr[bigIndex] = v` into a short array.
- Why: For large sparse arrays, V8 switches to a dictionary backing store to save memory. Local test on V8 13.6: writing index 1023 into an empty array gave HOLEY_SMI, and index 1025 or higher gave DICTIONARY elements. `Object.defineProperty` on an index with non-default attributes also switches the whole elements store to dictionary mode.
- Example:
  ```js
  // Before: const byBar = []; byBar[barIndex] = note;  // barIndex ~ 50_000
  const byBar = new Map(); byBar.set(barIndex, note);
  ```
- Avoid/caveats: The 1024 gap is an internal constant. Treat it as "any large gap".
- Status: Verified in V8 13.6 (2026-09).
- Sources: https://v8.dev/blog/fast-properties, https://mathiasbynens.be/notes/shapes-ics

### Never set non-default attributes on array indices (`Object.defineProperty(arr, i, …)`)
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: long-lived session
- Impact: medium, because a single such element moves the whole elements backing store into dictionary mode.
- Do: Keep array elements plain (writable, enumerable, configurable). To make an array read-only, use `Object.freeze(arr)` or keep it private instead.
- Why: Engines skip storing per-element attributes because indices normally have default attributes. One non-default index forces the whole store into a dictionary of index → attributes. In current V8, `Object.freeze`/`seal`/`preventExtensions` on arrays use dedicated frozen/sealed/non-extensible elements kinds instead of dictionaries (local test: `Object.freeze([1,2,3])` is not dictionary-mode).
- Example:
  ```js
  // Before: Object.defineProperty(levels, 0, { value: p, writable: false });
  const levels = Object.freeze([p, q, r]);
  ```
- Avoid/caveats: Do not freeze arrays that you still need to mutate. Freezing is not a speed-up by itself.
- Status: Verified in V8 13.6 (2026-09).
- Sources: https://mathiasbynens.be/notes/shapes-ics, https://v8.dev/blog/fast-properties

### Never read past the end of an array: loop with `i < length`, not `<=` or a "stop at undefined" test
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, TBT
- When: animation/render-loop
- Impact: high for hot loops. An out-of-bounds load forces a prototype-chain lookup, the load site stays in a slower mode, and the `undefined` it returns taints the arithmetic and comparisons that follow.
- Do: Write the bound as `i < arr.length`, or use `for…of` or `forEach`. Never write `for (let i = 0, x; (x = a[i]) != null; i++)`. Never index with `a[i + 1]` at the last element without a guard.
- Why: When the bounds check fails and the property is absent, V8 has to walk the prototype chain. The load then needs to handle special cases from that point on. The post measured a 6x slowdown from one extra iteration over 10,000 elements. Local re-test on V8 13.6: 67 ms (`<`) compared with 174 ms (`<=`), about 2.6x.
- Example:
  ```js
  // Before: for (let i = 0; i <= pts.length; i++) if (pts[i] > max) max = pts[i];
  for (let i = 0; i < pts.length; i++) if (pts[i] > max) max = pts[i];
  // Pairwise: for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
  ```
- Avoid/caveats: The same bug pattern hurts TypedArray loops too (they return `undefined` out of bounds).
- Status: Still valid in V8 13.6 (smaller factor than 2017). The post notes that `for…of` and `forEach` now perform about the same as a classic `for` loop.
- Sources: https://v8.dev/blog/elements-kinds

### Use real arrays and rest parameters instead of array-likes and `arguments`
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: long-lived session
- Impact: low to medium, because array built-ins called with `.call` on array-likes cannot use the fast paths that V8 has for real arrays.
- Do: Replace `arguments` with `...args`. If you call array methods more than once on a DOM `NodeList` or another array-like, convert it once with `Array.from(x)`. Do not build your own array-like objects.
- Why: `Array.prototype.forEach.call(arrayLike, …)` works but misses the elements-kind-specialized code. Converting once is cheap, and the later operations get the optimized paths. Update from local testing on V8 13.6: the post's `Array.prototype.slice.call(arrayLike)` conversion yields a **HOLEY** array, while `Array.from(arrayLike)` yields a PACKED one. Prefer `Array.from`.
- Example:
  ```js
  // Before: function log() { Array.prototype.forEach.call(arguments, write); }
  const log = (...parts) => parts.forEach(write);
  const rows = Array.from(document.querySelectorAll('tr')); // one conversion, then array methods
  ```
- Avoid/caveats: For a single pass, iterate the array-like directly with `for…of`. There is no need to copy it.
- Status: Rest parameters and `Array.from` are Baseline widely available (ES2015).
- Sources: https://v8.dev/blog/elements-kinds

### Keep hot call sites monomorphic: one shape and one elements kind per site
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness, INP
- When: animation/render-loop
- Impact: high, because each extra shape seen at a property-access site adds a check. Past the polymorphic limit, the site goes megamorphic and uses a generic lookup.
- Do: Do not pass objects of many shapes, or arrays of different elements kinds, through one generic hot helper. Split helpers per data type (for example `sumF64(arr: Float64Array)`), or normalize the data first. Prefer native built-ins (`Array.prototype.forEach`, `map`, `reduce`) over hand-written generic helpers when inputs vary, because the built-ins handle elements-kind polymorphism better.
- Why: An IC caches the shapes it has seen. With one shape it is monomorphic (fast). With a few shapes it is polymorphic (a chain of checks). Beyond the limit it is megamorphic. **Update:** V8's limit was 4 maps (`--max-valid-polymorphic-map-count=4` in V8 13.6). A commit dated 2026-08-26 raised it to 10 (Chrome 154). A new "homomorphic" IC state (Chrome 147) helps sites where many maps share one property handler. These changes soften the cliff but do not remove it.
- Example:
  ```js
  // Before: one helper sees PACKED_SMI, PACKED_DOUBLE, PACKED_ELEMENTS, Float64Array...
  const each = (arr, fn) => { for (let i = 0; i < arr.length; i++) fn(arr[i]); };
  // After: type-specific hot paths
  function maxF64(a) { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }
  ```
- Avoid/caveats: Polymorphism in cold code does not matter. Profile before splitting helpers. The thresholds differ between engines and versions.
- Status: V8-specific thresholds. Chrome 147 added homomorphic ICs and Chrome 154 raised the polymorphic limit from 4 to 10 (V8 commits ab86d353 and f2c89563, via chromiumdash).
- Sources: https://v8.dev/blog/elements-kinds, https://mathiasbynens.be/notes/shapes-ics, https://chromium-review.googlesource.com/c/v8/v8/+/7806913, https://chromium-review.googlesource.com/c/v8/v8/+/7460951

### Store bulk numeric series in Float64Array/Int32Array (struct of arrays), not arrays of objects
- Layer: v8 (also js, gpu)
- Stage: script-run, gc-memory, gpu-upload
- Metrics: memory, FPS/smoothness
- When: long-lived session | animation/render-loop
- Impact: high for chart data, because it removes per-element boxing and per-object headers, cannot suffer elements-kind transitions, and is already the layout that WebGL/WebGPU uploads need.
- Do: Keep time, open, high, low, close, and volume as separate `Float64Array`s (or `Float32Array` when precision allows) with one shared length and capacity. Grow them by doubling capacity and copying with `set()`. Do not keep `{t, o, h, l, c}` objects per bar on hot paths.
- Why: The elements-kinds post advises TypedArrays for math over arrays of numbers. The pointer-compression post says that since pointer compression, double object fields are no longer unboxed in the object, and it recommends Float64 TypedArrays (or Wasm) for number crunching. Local memory test (Node 24 without pointer compression, 1M values): PACKED_DOUBLE array +10.0 MB, a generic array holding doubles +25.6 MB, Float64Array 7.6 MB, 1M `{t,p}` objects +78 MB, and the same data as two Float64Arrays 15.3 MB.
- Example:
  ```js
  // Before: bars.push({ t, o, h, l, c });
  // After
  const cols = { t: new Float64Array(cap), c: new Float64Array(cap) }; let len = 0;
  function append(t, c) { if (len === cap) grow(); cols.t[len] = t; cols.c[len] = c; len++; }
  ```
- Avoid/caveats: A plain sum loop was not faster on Float64Array than on PACKED_DOUBLE (local: 314 ms compared with 275 ms). The gains are memory, GC, type stability, and zero-copy upload, not raw loop speed. TypedArrays have a fixed size, so manage capacity yourself.
- Status: TypedArrays are Baseline widely available. The mechanism is from the pointer compression post (2020).
- Sources: https://v8.dev/blog/elements-kinds, https://v8.dev/blog/pointer-compression

### Never modify built-in prototypes (Object.prototype, Array.prototype, …) while the app runs
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: long-lived session
- Impact: high, because one change to `Object.prototype` invalidates the prototype-load inline caches for every object and DOM prototype chain in the realm.
- Do: Load polyfills and prototype patches once, before any other code runs. Never add a method temporarily and then `delete` it ("cleaning up" invalidates everything a second time). Use standalone functions instead of extending built-ins.
- Why: V8 gives each prototype a unique shape with a ValidityCell. A prototype-load IC stores the instance shape, the holder prototype, the offset, and the ValidityCell. A change to a prototype, or to any prototype above it, invalidates that cell, and all dependent ICs miss and must warm up again. A DOM element's chain is about 6 prototypes deep, so a change to `Object.prototype` reaches every element type.
- Example:
  ```js
  // Before
  Object.prototype.toPx = function () { /* … */ };  // at runtime: invalidates all prototype ICs
  // After
  const toPx = (v) => /* … */ v;
  ```
- Avoid/caveats: Changing your own class prototypes at setup time is fine. V8 keeps a prototype in dictionary "setup" mode while methods are added and makes it fast on first use (local test: `F.prototype` was DICTIONARY after assigning methods and FAST after use).
- Status: The mechanism is common to engines (JSC and SpiderMonkey use similar tricks). Verified in V8 13.6.
- Sources: https://mathiasbynens.be/notes/prototypes

### Never change an object's prototype after creation
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: long-lived session
- Impact: medium, because a prototype change gives the object a new shape (the prototype link is stored in the shape) and defeats prototype-load caches for that object.
- Do: Choose the prototype at creation: `class`, `new`, or `Object.create(proto)`. Do not use `Object.setPrototypeOf(obj, …)` or `obj.__proto__ = …` on live objects, and do not "upgrade" objects in place to a subclass.
- Why: Engines put the prototype link in the Shape, so one shape check proves both that a property is absent and which prototype applies. That cuts prototype-lookup checks from 1+2N to 1+N. After a prototype change, the object must get a different shape. MDN warns that changing `[[Prototype]]` is "a very slow operation in every browser and JavaScript engine" and that the effects spread beyond the call itself.
- Example:
  ```js
  // Before: const tool = {}; Object.setPrototypeOf(tool, LineTool.prototype);
  const tool = Object.create(LineTool.prototype);   // or: new LineTool()
  ```
- Avoid/caveats: `Object.create(null)` gives a dictionary-mode object (local test). That is fine for lookup tables, but do not use it for hot records.
- Status: MDN warning (all engines).
- Sources: https://mathiasbynens.be/notes/prototypes, https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/setPrototypeOf

### Create each Intl formatter once and reuse it; never call `toLocaleString`/`localeCompare` with options in hot code
- Layer: js (v8 mechanism)
- Stage: script-run, main-thread-task
- Metrics: INP, FPS/smoothness, TBT
- When: animation/render-loop | interaction | long-lived session
- Impact: high for tickers, axes, and tables. Locally, a per-call formatter with options was about 50x slower than a reused one.
- Do: Keep module-level (or per-locale cached) `Intl.NumberFormat`, `Intl.DateTimeFormat`, and `Intl.Collator` instances, and call `.format()`, `.formatToParts()`, and `.compare`. Pass `collator.compare` directly to `sort`.
- Why: Creating an Intl object means ICU locale resolution and formatter setup. V8's own cache for `Number.prototype.toLocaleString`, `Date.prototype.toLocale*String`, and `String.prototype.localeCompare` applies **only** when `locales` is a string or `undefined` **and** `options` is `undefined` (V8 `intl-objects.cc`: `can_cache = (IsString(locales) || IsUndefined(locales)) && IsUndefined(options)`). Any options object builds a new formatter on every call. Local benchmark (100k calls): `toLocaleString('en-US', opts)` took 1,130 ms, reused `NumberFormat.format` took 24 ms. `toLocaleTimeString` with options took 2,149 ms, reused `DateTimeFormat` took 42 ms. Sorting 2k strings took 33 ms with `localeCompare` plus options and 2 ms with a reused `Collator`.
- Example:
  ```js
  const priceFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Before: cell.textContent = price.toLocaleString('en-US', { minimumFractionDigits: 2 });
  cell.textContent = priceFmt.format(price);
  ```
- Avoid/caveats: Invalidate the cached formatters when the user changes locale, time zone, or precision. The V8 post (2019) also reported that creating a `NumberFormat` became about 24x faster, but reuse still matters.
- Status: `Intl.NumberFormat`, `DateTimeFormat`, and `Collator` are Baseline widely available. The cache rule was verified in V8 main source and the numbers were measured in V8 13.6 (2026-09).
- Sources: https://v8.dev/blog/intl, https://github.com/v8/v8/blob/main/src/objects/intl-objects.cc

### Use built-in Intl APIs instead of shipping formatting libraries and locale data
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, startup
- When: build
- Impact: medium, because number, date, relative-time, list, plural, and segmenter logic plus locale data can stay out of the bundle.
- Do: Before you add a date or number formatting library, use `Intl.NumberFormat` (units, compact notation, currency, sign display), `Intl.DateTimeFormat` (`dateStyle`/`timeStyle`, `formatRange`), `Intl.RelativeTimeFormat`, `Intl.ListFormat`, `Intl.PluralRules`, and `Intl.Segmenter`.
- Why: The browser does the work with its bundled ICU, so you do not send "as much data or code over the wire" (V8 Intl post). V8 also moved Intl into C++ builtins, which removed runtime-call overhead and allows snapshotting.
- Example: `new Intl.NumberFormat('en', { notation: 'compact' }).format(1_250_000) // "1.3M"`
- Avoid/caveats: Check that each option is supported in your browser matrix. Time zone data and output strings can differ slightly between engines, so snapshot tests may differ by browser.
- Status: The 2019 post lists features that were then shipping or "in development". Most are now Baseline, but check each API on webstatus.dev or caniuse (not re-verified per API in this batch).
- Sources: https://v8.dev/blog/intl

### Split JS into modest external bundles and ship less, especially for mobile
- Layer: build (network)
- Stage: network, script-compile, script-run
- Metrics: LCP, INP, TBT, bundle-size, startup
- When: build | load
- Impact: high, because after parse/compile got cheap, download time and execution time are the dominant script costs, and they scale with bytes and with device CPU.
- Do: Load only the code a route needs, split out code that is not needed for the first view (dynamic `import()`), and avoid one huge bundle. The 2019 rule of thumb was to split bundles above about 50–100 kB. Do not wrap a whole large bundle in one outer function.
- Why: V8 streams parse and compile of external scripts on a worker thread while the bytes download, so several smaller scripts can compile in parallel. The post's Reddit example had 100 kB+ bundles wrapped in outer functions, which caused lazy compilation on the main thread. Reddit's JS took 3–4x longer on a median phone than on a high-end one, and more than 6x on a low-end one.
- Example: `const { openOrderTicket } = await import('./order-ticket.js'); // loaded when the user opens it`
- Avoid/caveats: Very many tiny files add request overhead, and each script below 1 KiB gets no code cache (see the code cache item). The 50–100 kB number is a 2019 heuristic, not a spec. **Update:** the "streaming starts after 30 kB" detail is obsolete. Current Chromium `ScriptStreamer` starts streaming once it has enough bytes to check the byte-order mark. It does not stream when a code cache already exists (the cache is used instead) or when the encoding is not UTF-8 or one-byte.
- Status: The guidance is still current in direction. Details verified in the Chromium source (2026-09).
- Sources: https://v8.dev/blog/cost-of-javascript-2019, https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/bindings/core/v8/script_streamer.cc

### Break long script execution into short tasks
- Layer: js
- Stage: main-thread-task, script-run
- Metrics: INP, TBT
- When: load | interaction
- Impact: high, because a busy main thread delays input even when the page already looks ready.
- Do: Split start-up work and large computations into chunks that yield to the event loop. Order loading so the code for the first view runs first.
- Why: The 2019 post names script execution as a dominant cost after download, and says long tasks keep the UI thread busy and delay interactivity. The main-thread cost is what the user feels.
- Example: See the scheduling batch (`scheduler.yield()` and chunked loops). This batch only records the V8 rationale.
- Avoid/caveats: Yielding too often adds overhead. Group work into chunks of roughly one frame budget.
- Status: General guidance. For the API status of yielding primitives, see the event-loop notes.
- Sources: https://v8.dev/blog/cost-of-javascript-2019

### Do not inline scripts larger than about 1 KB; serve them as external files
- Layer: html (build)
- Stage: html-parse, script-compile
- Metrics: FCP, LCP, TBT, startup
- When: load | build
- Impact: medium, because inline scripts are parsed and compiled on the main thread and cannot use the per-URL code cache.
- Do: Inline only tiny bootstrap code (well below 1 KiB). Put everything else in external `defer`, `async`, or module scripts with long-lived cache headers, served as UTF-8.
- Why: V8 streams external scripts off the main thread. Inline scripts are not streamed. Chrome's code cache has a 1 KiB minimum, and inline scripts have no resource of their own to attach a cache to. The code-caching post says Chrome tries to attach inline caches to the HTML document, but those caches are lost when anything in the document changes. **2026 check:** in Chromium main, `kInlineScriptCache` and `kPrecompileInlineScripts` are both `FEATURE_DISABLED_BY_DEFAULT`.
- Example:
  ```html
  <!-- Before: <script> /* 40 kB app bootstrap */ </script> -->
  <script type="module" src="/assets/app.3f9c.js"></script>
  ```
- Avoid/caveats: Tiny critical inline snippets (for example, reading a theme preference before paint) are fine.
- Status: Chromium behavior (2026-09). Other engines may differ, and the 2019 post notes that not every engine streams.
- Sources: https://v8.dev/blog/cost-of-javascript-2019, https://v8.dev/blog/code-caching-for-devs, https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/common/features.cc

### Ship large static data (≥10 kB) as `JSON.parse('…')`, not as a JS object literal
- Layer: build (js)
- Stage: script-compile, script-run
- Metrics: startup, TBT, LCP
- When: build | load
- Impact: medium for large configs, symbol tables, or embedded fixtures. The post measured JSON.parse at 1.7x faster in V8, with gains in all major engines.
- Do: Emit large data blobs as a JSON string parsed at run time. In Vite, keep `json.stringify: 'auto'` (the default), which emits `JSON.parse("…")` for imported JSON over 10 kB. If you must keep a big literal, put it at the top level of the module, not inside a function, so that it is not parsed twice.
- Why: JSON's grammar is much simpler than JavaScript's, so it parses faster. A big object literal inside a lazily compiled function is pre-parsed once and then fully parsed again when the function runs.
- Example:
  ```js
  // Before: export const SYMBOLS = { "AAPL": { "tick": 0.01 }, /* … 200 kB … */ };
  export const SYMBOLS = JSON.parse('{"AAPL":{"tick":0.01}}');
  ```
- Avoid/caveats: The gain holds only if the string is parsed once. Do not re-parse on every call. Measure. Objects from `JSON.parse` with 128 or more keys come out in dictionary mode (local test). Rows with the same key order share one map.
- Status: Still valid. Vite's default `'auto'` threshold cites this post.
- Sources: https://v8.dev/blog/cost-of-javascript-2019, https://vite.dev/config/shared-options

### Design for the code cache: stable URLs, a separate vendor chunk, deterministic top-level execution
- Layer: build (network)
- Stage: script-compile, network
- Metrics: startup, TBT, LCP
- When: build | load
- Impact: medium on repeat visits, because a "hot" load skips compilation of all functions that were compiled when the script first ran.
- Do: Give unchanged code an unchanged URL (content-hash file names and long cache lifetimes). Split rarely-changing libraries from app code. Avoid runtime A/B branches at the top level of scripts. Pre-cache critical scripts in the service worker `install` event.
- Why: Chrome produces the code cache on the second (warm) load after execution, and uses it from the third (hot) load onward. The 2019 post states that this happens when the first two visits are within 72 hours. The cache is dropped when the URL or the content changes, and it only holds functions compiled by the time execution ends. Scripts cached during service worker `install` get a "full" (eager) code cache.
- Example: `vendor.[hash].js` (stable for weeks) + `app.[hash].js` (changes per deploy).
- Avoid/caveats: The code-caching post admits a trade-off: merging a library with the code that uses it caches more functions, while splitting keeps its cache across deploys. Scripts below 1 KiB are never cached.
- Status: Chrome behavior per the 2019/2020 posts. The 72-hour figure was not re-verified in 2026.
- Sources: https://v8.dev/blog/cost-of-javascript-2019, https://v8.dev/blog/code-caching-for-devs

### Mark a small "core" startup file for eager compilation with `//# allFunctionsCalledOnLoad` (Chrome 136+)
- Layer: build (js)
- Stage: script-compile
- Metrics: startup, LCP, TBT
- When: build | load
- Impact: medium for startup-critical code. V8 reported an average saving of 630 ms in foreground parse and compile on 17 of 20 popular pages tested.
- Do: Put the functions that always run during page load into one file and add `//# allFunctionsCalledOnLoad` as its first line. Use it sparingly.
- Why: V8 compiles most functions lazily, so it must pre-parse a function to find its end and then fully parse it when it is called. That is duplicate work, and it happens on the main thread. Eager compilation happens on a background thread, interleaved with the download. The older trick of wrapping a function in parentheses (the PIFE/IIFE heuristic) also forces eager compilation, but V8 calls it an abuse of heuristics and advises against it unless necessary.
- Example:
  ```js
  //# allFunctionsCalledOnLoad
  export function bootChart() { /* always runs at load */ }
  ```
- Avoid/caveats: The post warns that "compiling too much will consume time and memory". Do not put it on large or rarely used files. Other engines treat it as an ordinary comment. Check that minifiers keep the comment.
- Status: Chrome 136+ (April 2025). Per-function hints are planned but not shipped per the post.
- Sources: https://v8.dev/blog/explicit-compile-hints, https://v8.dev/blog/code-caching-for-devs

### Keep module-level `let` counters and hot script-scope variables type-stable
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: FPS/smoothness
- When: animation/render-loop
- Impact: low to medium. V8 can now update script-scope numeric `let` slots in place as int32 or double values, but a type change deoptimizes the code that relies on it.
- Do: Give top-level mutable numbers (seeds, frame counters, accumulators) one numeric type for their whole life. Do not reuse them for strings or `null`. Keep constants as `const`.
- Why: The 2025 post added type tracking for script-context slots (constant, Smi, HeapNumber, tagged) and mutable HeapNumber slots, including a raw Int32 mode. This removes the allocation per write, but optimized code depends on the slot's type and deoptimizes when that type changes. Maglev also embeds globals that never change as constants.
- Example: `let frameNo = 0; function tick() { frameNo = (frameNo + 1) | 0; }`
- Avoid/caveats: This is a V8-internal gain. Do not restructure code for it. Just avoid type changes.
- Status: V8 blog post of 2025-02-25. The exact Chrome milestone was not verified.
- Sources: https://v8.dev/blog/mutable-heap-number, https://v8.dev/blog/maglev

### Inspect shapes and elements kinds with natives syntax when you tune a hot path
- Layer: tooling
- Stage: script-run
- Metrics: FPS/smoothness, memory
- When: testing
- Impact: low (diagnostic only), because it turns guesses about hidden classes into facts.
- Do: In Node or d8, run micro-tests with `--allow-natives-syntax` and use `%HaveSameMap(a, b)`, `%HasFastProperties(o)`, `%HasHoleyElements(a)`, `%HasDoubleElements(a)`, and `%DebugPrint(x)`. In a d8 debug build, use `--trace-elements-transitions`.
- Why: These intrinsics show the engine's real representation, which the language hides. The posts use `%DebugPrint` to show elements kinds.
- Example: `node --allow-natives-syntax -e "const a=[1,2]; a.push(-0); console.log(%HasDoubleElements(a))" // true`
- Avoid/caveats: Never ship code with `%` intrinsics, because it is a syntax error without the flag. Node's V8 lags Chrome's (Node 24 = V8 13.6 ≈ Chrome 136), and Node uses 32-bit Smis where Chrome uses 31-bit.
- Status: Developer-only V8 flags, stable for years.
- Sources: https://v8.dev/blog/elements-kinds

### OBSOLETE: "Avoid try/catch in hot functions, because it prevents optimization"
- Layer: v8
- Stage: script-run
- Metrics: FPS/smoothness
- When: long-lived session
- Impact: low. It is a myth to drop from style guides.
- Do: Use `try/catch/finally` wherever correctness needs it, including hot functions.
- Why: The old Crankshaft compiler could not optimize structured exception handling. TurboFan, which became V8's only optimizing compiler in V8 5.9 / Chrome 59 (2017), handles it. Sparkplug (Chrome 91) and Maglev (Chrome 117) came later.
- Example: none needed.
- Avoid/caveats: Throwing on hot paths is still costly (stack capture). The rule is "do not throw often", not "do not use try".
- Status: Obsolete since Chrome 59 (2017).
- Sources: https://v8.dev/blog/launching-ignition-and-turbofan, https://v8.dev/blog/maglev

### OBSOLETE / UPDATED: other claims in these posts that later V8 versions changed
- Layer: v8
- Stage: script-run, script-compile
- Metrics: startup, FPS/smoothness
- When: long-lived session
- Impact: low, but it keeps generated rules from citing stale mechanics.
- Do: Treat these as updated:
  1. **Tiers:** "Ignition → TurboFan" (2018 prototypes post) is now Ignition → Sparkplug (baseline, Chrome 91) → Maglev (fast optimizing, Chrome 117) → TurboFan.
  2. **preventExtensions/seal/freeze + Smi→Double cliff:** fixed in V8 7.4. A local test shows that frozen or non-extensible instances share maps and migrate correctly. Do not avoid `Object.freeze` for performance.
  3. **"Deleting the last-added property is cheap":** dropped in Chrome 122. Every `delete` goes to dictionary mode.
  4. **"Holey forever":** Chrome 135 adds a full-`fill` exception.
  5. **"Double fields are stored unboxed in the object":** ended with pointer compression (2020). Double fields are boxed in a mutable HeapNumber.
  6. **"Streaming starts after 30 kB":** Chromium now streams once there are enough bytes to check the byte-order mark.
  7. **Polymorphic IC limit of 4:** raised to 10 in Chrome 154, with a homomorphic state from Chrome 147.
  8. **Shape deprecation "being deprecated":** the 2019 post hoped to remove it, but in V8 13.6 a Smi→Double change still gives a new map and lazy migration (local test).
- Why: Engine internals change. The advice behind them (stable shapes and types, no deletes, packed arrays) still holds.
- Example: none.
- Avoid/caveats: Items 7 and 8 describe the Chrome versions current in Sept 2026. Node 24 still has the older behavior for item 7.
- Status: As of 2026-09. The sources are listed in the items above.
- Sources: https://mathiasbynens.be/notes/prototypes, https://v8.dev/blog/maglev, https://v8.dev/blog/react-cliff, https://v8.dev/blog/pointer-compression

---

## Sources read
- https://mathiasbynens.be/notes/shapes-ics (2018-06-14, full)
- https://v8.dev/blog/elements-kinds (2017-09-12, full, including the 2025-02-28 update note)
- https://v8.dev/blog/cost-of-javascript-2019 (2019-06-25, full)
- https://v8.dev/blog/fast-properties (2017-08-30, full)
- https://v8.dev/blog/react-cliff (2019-08-28, full)
- https://v8.dev/blog/intl (2019-04-25, full)
- https://mathiasbynens.be/notes/prototypes (2018-08-16, full)
- Verification sources:
  - https://v8.dev/blog/code-caching-for-devs
  - https://v8.dev/blog/explicit-compile-hints
  - https://v8.dev/blog/mutable-heap-number
  - https://v8.dev/blog/pointer-compression
  - https://v8.dev/blog/maglev
  - https://v8.dev/blog/launching-ignition-and-turbofan
  - https://v8.dev/blog/slack-tracking
- V8 commits (Gerrit REST, GitHub mirror API, chromiumdash):
  - 785a0f64 (Array.fill, Chrome 135)
  - 389ea9be (drop fast last-property deletion, Chrome 122)
  - f2c89563 (polymorphic maps 4→10, Chrome 154)
  - ab86d353 (homomorphic IC, Chrome 147)
- Source files:
  - V8 `src/objects/intl-objects.cc`
  - V8 `src/execution/isolate.h`
  - V8 `src/flags/flag-definitions.h`
  - Chromium `script_streamer.cc`
  - Chromium `third_party/blink/common/features.cc`
- Documentation:
  - https://vite.dev/config/shared-options
  - https://www.typescriptlang.org/tsconfig/#useDefineForClassFields
  - https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/setPrototypeOf
- Local experiments: Node 24.16.0 / V8 13.6.233.17, scripts in `scratchpad/v8b1/` (`ek.js`, `ek2.js`, `props*.js`, `rep.js`, `bench-*.js`, `mem.js`, `json.js`, `proto.js`).

## Not covered / could not access
- All seven assigned posts were readable. Their embedded videos (AgentConf, BlinkOn, and ChromeDevSummit talks) were not watched.
- Chromium Gerrit pages render with JS. We read the commit data through the Gerrit REST API and chromiumdash instead. The Gitiles history pages need sign-in.
- We did not re-run the local benchmarks in Chrome. Node 24 lacks pointer compression, so absolute memory numbers are larger than in Chrome, and the Smi range is 32-bit, not 31-bit.
- We did not verify the Chrome milestone that shipped the script-context mutable heap numbers (2025 post).
- We did not re-verify the 72-hour code-cache window or the 50–100 kB split heuristic against current Chrome.
- Intl feature-by-feature Baseline status (Segmenter, DurationFormat, and others) was not checked. The web-APIs batch should check it on webstatus.dev.
- We did not check the SpiderMonkey and JSC equivalents of the V8-specific thresholds (dictionary limits, polymorphic limit, Array.fill exception).
