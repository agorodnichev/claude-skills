# Hot code in V8: algorithm, shapes, numbers, allocation and builtins (V8-)

Open this when you write code that runs per tick, per frame, per point or per row: record types and their constructors, numeric arrays and series, binary decoders, sorts, and `JSON`, `RegExp` or `Intl` calls inside loops, handlers and renderers.
Stage cards: `pipeline.md` §H (`js`, `memory`). Gate: fix the algorithm and the call count first (V8-01). Apply the other rules to code that a profile shows as hot, or to code that runs per tick, per frame or per point; in cold code they are noise.
Scope: V8 in Chrome and Edge. Limits and thresholds are engine internals that change between releases; the current values are in support.md §B and §F. Chrome and Edge on iOS run WebKit, not V8.

## Checklist

| ID | Do this | Impact | First stage |
|---|---|---|---|
| §A | **Algorithm first** | | |
| V8-01 | Fix the algorithm first: binary search, one pass, `Map` lookups, rolling sums | high | js |
| §B | **Object shapes** | | |
| V8-02 | One creation path per record type: every field, one order, no `delete`, no late fields | high | js |
| V8-03 | Numeric fields and variables hold only numbers: `NaN`, not `null`, for "no value" | high | js |
| §C | **Arrays and numbers** | | |
| V8-04 | Packed single-kind arrays; typed-array columns for bulk numeric data; no proxies | high | memory |
| V8-05 | `DataView` with an explicit byte order; Numbers, not BigInt, in hot loops | medium | js |
| §D | **Allocation** | | |
| V8-06 | Let small temporary objects die young; reuse large buffers; pool only after a profile | medium | memory |
| V8-07 | Per frame and per message, keep nothing new alive: write into existing storage | high | memory |
| §E | **Builtins** | | |
| V8-08 | Create each `RegExp` once; never patch built-ins or regex objects; write safe patterns | medium | js |
| V8-09 | One cached `Intl` formatter per locale and options | high | js |
| V8-10 | Plain same-shape data for `JSON`, no replacer, indent or reviver; no copies per frame | medium | js |
| One-line | **One-line rules** | | |
| V8-11 | Native `async`/`await`; no `async` on per-frame helpers | low | js |
| V8-12 | Numeric comparators; typed arrays sorted with `.sort()`; precomputed keys | medium | js |
| V8-13 | Benchmark warm code with `performance.now()`, then confirm in the real flow | low | js |
| V8-14 | Confirm a shape or inline-cache problem before you fix it | low | js |
| V8-15 | Return a value for expected failures; no `Error` objects per tick | medium | js |
| V8-16 | Built-in `Intl` before a formatting library | medium | script-load |
| V8-17 | Test once with the V8 optimizers off, and keep the app usable | medium | js |
| §H | **Myths: do not apply** (end of file) | | |

- → TASK-04 no `await` per item in hot loops; a resolved promise does not yield to rendering
- → TASK-13 Wasm only for measured CPU-bound kernels, called in bulk
- → DATA-03, DATA-05 binary payloads decoded with `DataView`; live series in typed-array rings
- → LIFE-05, LIFE-11 capped caches and `WeakMap` side data; large data in shallow reactive state
- → GPU-14 float64 time origins before float32 upload
- Startup code (code cache, compile hints, `JSON.parse` for large static data, modern output): html-loading.md

## §A Algorithm first

### V8-01 Fix the algorithm first: binary search, one pass, `Map` lookups, rolling sums
stage: js, tasks · metric: frame, INP · when: render-loop, interaction · impact: high — a scan per frame or a nested loop per message grows with the data, and no engine tuning can hide that · support: baseline · also: CNV-21, DATA-05, V8-12
- Do: Before any engine-level change, cut the work. Find the visible range of sorted data with a binary search; get min and max in one loop, not with `sort()` or `Math.max(...arr)`; look items up in a `Map` or `Set` that you build once and update with the data, not with `find()` or `includes()` in a loop; update windowed values (moving averages, rolling sums) by adding the new point and subtracting the one that leaves. Call `map.get()` once and test for `undefined`, not `has()` then `get()`. Merge repeated passes over the same data into one.
- Why: A binary search over 1,000,000 sorted points takes about 20 steps; a scan takes 1,000,000, every frame. `Math.max(...arr)` passes every element as a call argument, so it allocates and fails on very large arrays. The other rules in this file only shave a constant factor from the work that is left.
- Detect: `rg -n '\.(find|findIndex|filter|indexOf|includes|some)\(|\.sort\(|Math\.(min|max)\(\.\.\.' -g '*.{ts,js,tsx,jsx,svelte,vue}'` inside rAF callbacks, message handlers, `pointermove` handlers and per-row renderers; nested loops over the same collection; `.has(key)` followed by `.get(key)`.
- Verify: measure.md#fps with the `pan` or `stream` scenario, or measure.md#inp for a handler. Pass: compare-runs "win" on `frameP95Ms` (a steady cost per frame) or the targeted INP subpart, and the function's time in `__wpProbe.loaf.read()` `topScripts` goes down.
- Example:
  ```ts
  // Before: every frame filters all points, then spreads them into Math.max
  const top = Math.max(...points.filter((p) => p.t >= t0 && p.t <= t1).map((p) => p.v));
  // After: log(n) bounds on the sorted time column, then one pass
  function firstIndex(t: Float64Array, n: number, x: number, after = false) {
    let lo = 0, hi = n;                      // first i with t[i] >= x (t[i] > x when after)
    while (lo < hi) { const m = (lo + hi) >>> 1; if (t[m] < x || (after && t[m] === x)) lo = m + 1; else hi = m; }
    return lo;
  }
  const i0 = firstIndex(time, len, t0), i1 = firstIndex(time, len, t1, true);
  let max = -Infinity;
  for (let i = i0; i < i1; i++) if (value[i] > max) max = value[i];
  ```
- Avoid: A binary search needs data sorted by its key: keep the order an invariant of the store (append in order; insert a late item at its search position, V8-12). A `Map` built per call costs more than the scan it replaces. For a few dozen items a plain loop is fine. Decimate what you draw to the pixel columns (CNV-21) before you tune the loop that draws it.
- Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/max ; https://github.com/patternsdev/skills/blob/main/javascript/js-performance-patterns/SKILL.md

## §B Object shapes

### V8-02 Give each record type one creation path: every field, one order, no `delete`, no late fields
stage: js · metric: frame, INP · when: render-loop, interaction · impact: high — each property read in hot code checks the object's shape, and mixed shapes turn a one-compare load into a list check or a generic lookup · support: n/a · also: V8-03, V8-10, LIFE-05
- Do: Build each kind of record (row, point, item, event) in one constructor, factory or object literal that writes every field, in the same order, on every path; for "absent", write a placeholder of the field's type (`NaN` or `0` for numbers, V8-03; `null` for objects) instead of skipping the field. Never `delete` a field of an object that hot code reads: assign `undefined`, or build a new object. Declare every field up front instead of adding one later (`row.cached = …`). Keep keys that come and go in a `Map`, and data about objects you do not own in a `WeakMap`, not in added properties. Pass one record type to each hot function.
- Why: V8 gives objects with the same fields in the same order one hidden class (a "map"), and the inline cache at each property access remembers the map and the field offset. Another order, a field added on some paths only, or a late field creates another map; a site that sees several maps is polymorphic, and past a small limit megamorphic (a generic lookup). `delete` moves an object to slow dictionary mode for good, and many computed-key stores move it there too. In V8's system analyzer post, one conditional field made the code about 3 times slower.
- Detect: `rg -n '\bdelete\s+[\w$]+[.\[]' -g '*.{ts,js,tsx,jsx}'` on objects that loops or renderers read; `rg -n 'as any\)\.\w+\s*=[^=]' -g '*.{ts,tsx}'` for added properties; `Record<string,` or `{}` objects filled with `obj[key] = …` in loops; fields assigned inside `if` blocks after construction; one helper fed by records from several factories.
- Verify: measure.md#fps or measure.md#inp on the path that reads the records. Pass: compare-runs "win" on `frameP95Ms` or the processing subpart; for one site, V8-14 shows a single map and a monomorphic inline cache.
- Example:
  ```ts
  // Before: two creation paths and a conditional field give several maps; delete makes a dictionary
  const a: any = { id, price, qty };
  const b: any = {}; b.id = id; b.price = price; if (qty) b.qty = qty;
  delete a.qty;
  // After: one factory, one order, every field on every path
  const makeItem = (id: string, price: number, qty = 0): Item => ({ id, price, qty });
  const byId = new Map<string, Item>();            // keys that come and go
  ```
- Avoid: Shapes matter on hot paths only; do not merge unrelated types into one shape with dummy fields. The polymorphism limits are engine internals (support.md §B): aim for one shape per hot site, not for "fewer than N". A `Map` lookup costs more than a declared field, so use it for dynamic keys, not for fixed records. `delete` is fine on throwaway dictionaries that hot code never reads.
- Source: https://v8.dev/blog/system-analyzer ; https://v8.dev/blog/fast-properties

### V8-03 Keep numeric fields and variables numeric: `NaN`, not `null` or `undefined`, for "no value"
stage: js, memory · metric: frame, memory · when: render-loop, session · impact: high — a numeric field that starts as `null` or `undefined` allocates a new heap number on each fractional write, which feeds the garbage collector every frame · support: n/a · also: V8-02, V8-04
- Do: Give fields that will hold fractional numbers (coordinates, ratios, amounts, timestamps) a number as their first value: `NaN` when there is no value yet, else a real value; give integer fields `0`. Never store `null`, `undefined`, `''` or an object into them later. In TypeScript, write `x = NaN;`, or `declare x: number;` plus an assignment in the constructor, instead of `x!: number;` or a bare `x: number;`, which emit a field that starts as `undefined`. Start accumulators the same way (`let hi = -Infinity`), and return `NaN`, not `undefined`, from numeric functions; add a boolean when "no value" must be explicit.
- Why: V8 records a representation per field in the map: small integer, double, object or "tagged". A double field holds a box that V8 updates in place. A tagged field must point to a new heap number after each fractional write, and a change of representation deprecates the map and deoptimizes code that depends on it. React initializes such fields with `NaN` for this reason (V8's performance-cliff post).
- Detect: `rg -n '^\s*(?:(?:private|public|protected|readonly)\s+)*#?\w+!?:\s*number\s*;' -g '*.{ts,tsx}'` in classes with a constructor; `rg -n '(this\.\w+|\blet \w+)\s*=\s*(null|undefined)\s*;' -g '*.{ts,js,tsx,jsx}'` for values that later hold numbers; numeric returns of `undefined`.
- Verify: measure.md#fps and measure.md#mem on the scenario that writes the fields (`pan`, `stream`). Pass: "Minor GC" time in the trace-summary window goes down, and compare-runs shows no regression on `frameP95Ms`.
- Example:
  ```ts
  class Viewport {
    min = NaN; max = NaN;          // before: min: number | null = null (a new heap number per write)
    declare scale: number;         // no field is emitted here; the constructor sets it
    constructor(scale: number) { this.scale = scale; }
  }
  let hi = -Infinity;              // before: let hi; (undefined first, numbers later)
  ```
- Avoid: This matters for objects written often with fractional values. Fields that hold objects can start as `null`. A `0` start is acceptable: the field changes representation once. Keep integer values within the small-integer range (about ±1 billion); epoch milliseconds are doubles. Check the emitted class fields in the build output when you change the TypeScript target.
- Source: https://v8.dev/blog/react-cliff ; https://www.typescriptlang.org/tsconfig/#useDefineForClassFields

## §C Arrays and numbers

### V8-04 Keep arrays packed and single-kind, and bulk numeric data in typed-array columns
stage: memory, js · metric: memory, frame · when: session, render-loop · impact: high — arrays of objects or mixed values keep each number in its own heap box, and a large one costs memory and GC time for the whole session · support: baseline · also: DATA-05, GPU-14, LIFE-11
- Do: Keep each array to one kind of value: small integers, or doubles, or objects; never mix in `null`, `undefined` or strings. Build arrays without holes (`Array.from({ length: n }, fn)`, `new Array(n).fill(0)`, `push`), not `new Array(n)` filled by index, and loop with `i < a.length`, never `<=`. Store large numeric data (history, computed series, geometry) as columns: one `Float64Array` per field (`Float32Array` where the precision is enough) with a shared length. Unwrap reactive or other `Proxy` objects before a hot loop, and never keep numeric data behind one (LIFE-11). Do not freeze numeric arrays. Use a `Map` for sparse integer keys.
- Why: V8 tracks an elements kind per array (packed or holey, of small integers, doubles or any values), and changes go only toward the more general kind, for the life of the array. A typed array stores raw numbers in one backing store that the GC does not scan. In Chrome an object field is a 4-byte slot, so a fractional value in an object lives in a separate heap number: a record with 5 numeric fields takes about 92 bytes, against 40 bytes in 5 `Float64Array` columns.
- Detect: `rg -n 'new Array\([^)]*\)\s*[;,)]' -g '*.{ts,js,tsx,jsx}'` (no `.fill`); `rg -n '<=\s*[\w$.]+\.length\b'`; `rg -n '\.push\(\s*\{' -g '*.{ts,js,tsx,jsx}'` in code that builds series of thousands of points; `Object\.freeze\(\[` on numbers; a proxied store read in a loop.
- Verify: measure.md#mem with the full data set loaded, and measure.md#fps on `pan` or `zoom`. Pass: the heap snapshot after load is smaller than the baseline, "Minor GC" time in the window goes down, and `frameP95Ms` does not regress.
- Example:
  ```ts
  // Before: an object and boxed numbers per point, in an array with holes
  const pts = new Array(n); for (let i = 0; i < n; i++) pts[i] = { t: t0 + i * dt, v: read(i) };
  // After: columns of raw doubles
  const t = new Float64Array(n), v = new Float64Array(n);
  for (let i = 0; i < n; i++) { t[i] = t0 + i * dt; v[i] = read(i); }
  bins.push(Math.round(x) | 0);   // Math.round(-0.2) is -0; without | 0 it turns an integer array into doubles
  ```
- Avoid: A loop over a `Float64Array` was not faster than over a packed double array in local tests; the gains are memory, GC, type stability and zero-copy transfer or upload. Keep objects for low-count entities (series, panels, axes). `Float32Array` loses precision on large values such as epoch-ms times (GPU-14). Measure memory in Chrome, not Node: Node builds without pointer compression use 8-byte slots. For live windows, use the ring buffer of DATA-05.
- Source: https://v8.dev/blog/elements-kinds ; https://v8.dev/blog/pointer-compression

### V8-05 Decode binary data with `DataView` and an explicit byte order; keep BigInt out of hot loops
stage: js · metric: frame, INP · when: render-loop, session · impact: medium — byte-shift shims, a missing byte-order flag and per-value BigInt allocations cost time in every decoded message · support: baseline · also: DATA-03
- Do: Read and write mixed binary records with `DataView` getters and setters, and always pass the `littleEndian` argument (`true` for GPU buffers, Wasm memory and most protocols). Check `offset + size <= view.byteLength` before a read instead of catching `RangeError`, and call a fixed method per field, not `view['get' + type]`. Keep quantities and millisecond timestamps as Numbers. Read a 64-bit field that stays below 2^53 as `hi * 2 ** 32 + lo` from two `getUint32` calls, and keep BigInt (in `BigInt64Array` columns) for values that need all 64 bits.
- Why: V8 inlines `DataView` methods into optimized code, where they run close to typed-array speed; a throw, or a method chosen at run time, leaves that code. Without the flag, `DataView` reads big-endian. A BigInt is a heap object, so code that is not fully optimized allocates one per operation or per read.
- Detect: `rg -n '<<\s*(8|16|24)\b' -g '*.{ts,js}'` in decoders (byte assembly); `rg -n '\.get(Int|Uint|Float|BigInt|BigUint)(16|32|64)\([^,()]+\)|\.set(Int|Uint|Float|BigInt|BigUint)(16|32|64)\([^,()]+,[^,()]+\)'` (no byte-order argument); `rg -n 'BigInt\(|Number\([\w.]+\.getBig(Int|Uint)64'` inside loops.
- Verify: measure.md#fps with the `stream` scenario at peak rate. Pass: the decoder's time in `__wpProbe.loaf.read()` `topScripts` goes down, and "Minor GC" time does not rise.
- Avoid: For arrays of one numeric type, a typed-array view is simpler than `DataView`. Numbers above 2^53 lose precision without an error: assert the range in debug builds, or keep BigInt for those fields. Mixing BigInt and Number in one expression throws. When decoding breaks the frame budget, decode in a worker (DATA-03).
- Source: https://v8.dev/blog/dataview ; https://v8.dev/blog/bigint

## §D Allocation

### V8-06 Let small temporary objects die young; reuse large buffers; pool only after a profile
stage: memory, js · metric: frame, memory · when: render-loop, session · impact: medium — a young-generation GC costs time for the objects that survive, not for the ones that die, so pools and caches of small objects add GC work · support: n/a · also: V8-07, LIFE-05
- Do: Create small helper objects (tuples, `{ x, y }` results, iterator results) inside one task, and let them become unreachable before it ends. Allocate large typed arrays (upload buffers, scratch columns, decode buffers) once and reuse them. Add a pool for small objects only when a trace shows GC time inside frames and the pool measures faster.
- Why: V8 allocates new objects in a nursery, and the scavenger copies only the live ones; dead objects cost nothing to free. An object that survives two scavenges is copied into the old generation, which only the slower major GC reclaims. Pooled objects live for the whole session, and each young object stored into one adds an old-to-new reference that the next scavenge must process.
- Detect: `rg -n 'class \w*Pool\b|\.acquire\(|\.release\(' -g '*.{ts,js}'` for pools of small objects; `rg -n 'new (Float32|Float64|Int32|Uint8|Uint16|Uint32)Array\(' -g '*.{ts,js}'` inside rAF callbacks, message handlers and render functions (large buffers created per call).
- Verify: measure.md#fps and measure.md#mem on the `stream` or `pan` scenario. Pass: "Minor GC" and "Major GC" time in the trace-summary window go down, and `heapPerActionMb` is within noise.
- Avoid: Cheap is not free: a very high allocation rate still starts frequent scavenges, and each one pauses the main thread briefly. A pool larger than needed wastes memory for the whole session, and a pooled object that still references old data keeps that data alive.
- Source: https://v8.dev/blog/trash-talk

### V8-07 Keep nothing new alive across frames: write per-frame results into existing storage
stage: memory, js · metric: frame, memory · when: render-loop · impact: high — objects stored each frame into long-lived arrays, caches or fields survive, get copied twice and become old garbage one frame later · support: n/a · also: V8-06, DATA-06, GPU-05
- Do: In rAF callbacks, message handlers and per-row renderers, write numbers into typed arrays or fields that already exist, instead of storing new objects, arrays or closures into long-lived structures. Create callbacks once, outside hot loops. Read known fields directly (`p.x`), not through `Object.entries()` or `Object.keys()` per frame. Do not copy data per frame with `structuredClone`, spread or `toSorted()` (V8-10).
- Why: The scavenger treats references from old objects to young ones as roots. A new object stored into an old container therefore survives, is copied into the old generation, and is dropped a frame later, where only a major GC can reclaim it. `Object.entries()` allocates one array per property, plus the outer array, on every call.
- Detect: `rg -n -A12 'requestAnimationFrame\(|onmessage|addEventListener\(\s*.(message|pointermove|scroll)' -g '*.{ts,js,tsx,jsx,svelte,vue}' | rg '=\s*[\[{]|\.map\(|Object\.(entries|keys|values)\(|structuredClone\(|\.toSorted\('`, then check whether the result is kept in a field, a module variable or a cache.
- Verify: measure.md#fps with the scenario that runs the loop (`pan`, `zoom` or `stream`), 5 runs each side. Pass: compare-runs "win" on `frameP99Ms` or `longFramesPer10s`, no regression on `frameP95Ms`, and "Minor GC" time per second in the trace-summary window goes down.
- Example:
  ```ts
  // Before: a new object per point per frame, kept in a long-lived field
  this.screen = pts.map((p) => ({ x: toX(p.t), y: toY(p.v) }));
  // After: columns allocated once, grown by doubling, overwritten each frame
  if (this.sx.length < n) { this.sx = new Float32Array(n * 2); this.sy = new Float32Array(n * 2); }
  for (let i = 0; i < n; i++) { this.sx[i] = toX(t[i]); this.sy[i] = toY(v[i]); }
  ```
- Avoid: In-place writes do not notify frameworks that track identity (reactive stores, immutable state): keep per-frame numeric buffers outside reactive state (DATA-08). A growth step that allocates when capacity runs out is fine.
- Source: https://v8.dev/blog/trash-talk ; https://v8.dev/blog/fast-for-in

## §E Builtins

### V8-08 Create each `RegExp` once; never patch built-ins or regex objects; write safe patterns
stage: js, tasks · metric: INP, frame · when: interaction, render-loop · impact: medium — a regex built per call is compiled again, a patched regex or prototype sends every match to a generic slow path, and an ambiguous pattern can freeze the tab · support: regexp-escape · also: V8-02
- Do: Define fixed patterns once at module scope, and cache run-time patterns (a search term, a filter) by source and flags. Use `test()` for yes-or-no checks, and `startsWith`, `includes` or `indexOf` for literal text. Treat regex objects as immutable: no added properties, no subclasses, no changes to `RegExp.prototype`. Do not patch built-in prototypes or call `Object.setPrototypeOf` on live objects. Escape user text with `RegExp.escape()` before you put it in a pattern. Never nest quantifiers over the same characters (`(a+)+`, `(\w+\s?)*`), anchor whole-string patterns, and cap the input length.
- Why: V8 compiles each new pattern to native code and keeps the result in a small cache that ages out, so a pattern rebuilt per call is compiled again. The fast paths of `exec`, `test`, `replace` and `split` run only while the regex and `RegExp.prototype` keep their original maps, and a prototype change invalidates the inline caches of every object that inherits from it. V8's default regex engine backtracks, and its linear-time fallback is off by default, so an ambiguous pattern can take exponential time on long input.
- Detect: `rg -n 'new RegExp\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'` inside functions, handlers and loops; `rg -n 'RegExp\.prototype\.\w+\s*=|extends RegExp|(Array|Object|String|Number)\.prototype\.\w+\s*=|setPrototypeOf\('`; `rg -n '\([^()]*[+*?]\)[+*{]'` for nested quantifiers; `.match(` or `.exec(` whose result is only tested for truth.
- Verify: measure.md#inp on the keystroke or filter interaction (measure.md#fps when the regex runs per message). Pass: compare-runs "win" on the processing subpart, and no input length in the test data makes one match take over 50 ms.
- Avoid: A shared regex with the `g` or `y` flag keeps `lastIndex` between calls: reset it, or use a regex without the flag for `test()`. A regex literal inside a loop is cheap (V8 clones it from a cached template); `new RegExp(string)` is not. When users can type real patterns, run the match in a worker with a time limit (js-scheduling-and-workers.md). Below the Chromium floor for `RegExp.escape()`, use a small helper that escapes the metacharacters (support.md: `regexp-escape`).
- Source: https://v8.dev/blog/speeding-up-regular-expressions ; https://v8.dev/blog/non-backtracking-regexp

### V8-09 Create one `Intl` formatter per locale and options, and reuse it on every call
stage: js · metric: frame, INP · when: render-loop, interaction · impact: high — a format call with options sets up a new ICU formatter each time, in every cell, axis label and tooltip update · support: baseline · also: CNV-15, V8-16
- Do: Create `Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat` and `Intl.Collator` objects once per locale and option set (at module level, or in a small cache keyed by both), and call `.format()`, `.formatToParts()` or `.compare`. Never call `toLocaleString(locale, options)`, `toLocaleDateString(…, options)` or `localeCompare(b, locale, options)` in loops, renderers or comparators. Rebuild the cache when the locale, time zone or precision changes.
- Why: Creating an Intl object resolves the locale and builds an ICU formatter. `toLocale*String()` and `localeCompare()` build a full formatter on each call; V8 caches one only when the call passes no options, and only for the most recent locale of each kind.
- Detect: `rg -n 'toLocale(String|DateString|TimeString)\([^)]|localeCompare\(\s*[\w.]+\s*,|new Intl\.\w+\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'` inside render functions, loops, comparators, rAF callbacks and component bodies that run again on each update.
- Verify: measure.md#fps with the scenario that updates formatted values (`stream`), or measure.md#inp for a sort or filter. Pass: the formatting code leaves the `topScripts` of `__wpProbe.loaf.read()`, and compare-runs shows "win" on the targeted metric.
- Example:
  ```ts
  const AMOUNT = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const BY_NAME = new Intl.Collator(undefined, { numeric: true });
  cell.textContent = AMOUNT.format(total);                // before: total.toLocaleString(undefined, { minimumFractionDigits: 2 })
  rows.sort((a, b) => BY_NAME.compare(a.name, b.name));   // before: a.name.localeCompare(b.name, undefined, { numeric: true })
  ```
- Avoid: Each formatter holds ICU memory: share one per option set, not one per component instance. Option-free `localeCompare(b)` uses a cached collator and is fine. Output can differ slightly between engines and ICU versions, so text snapshots in tests can differ by browser.
- Source: https://github.com/v8/v8/blob/main/src/objects/intl-objects.cc ; https://v8.dev/blog/intl

### V8-10 Give `JSON` plain same-shape data and no replacer, indent or reviver; copy nothing per frame
stage: js · metric: INP, frame · when: interaction, session · impact: medium — a replacer, an indent, a `toJSON` or one class instance in the graph moves a whole `JSON.stringify` call to the slow serializer, and a reviver makes `JSON.parse` several times slower · support: n/a · also: V8-02, V8-07, DATA-03
- Do: On hot paths call `JSON.stringify(value)` with no replacer and no indent: build a plain object first instead of passing a replacer, and do not define `toJSON` on your classes. Serialize plain objects and arrays only: no class instances, `Date` (send epoch ms), `Map`, or integer-like keys such as `"42"`. Give every record the same keys in the same order, with stable value types, and keep numeric arrays free of `null`. Parse without a reviver, then convert the few fields you need in a loop. Do not deep-copy per frame or per message (`structuredClone`, `JSON.parse(JSON.stringify(x))`, `toSorted()` in a loop); copy once where ownership changes, and sort scratch arrays in place.
- Why: V8 has a fast serializer that runs only with no replacer and no indent, and only while every value is a plain object, a plain array or a primitive; the first other value restarts the whole call on the general path. V8 reported the fast path at more than twice as fast. Same-shape records let `JSON.stringify` copy keys without checks and let `JSON.parse` reuse the previous record's map. A reviver makes the parser walk the whole result and call a function per value.
- Detect: `rg -n 'JSON\.stringify\([^)]*,|JSON\.parse\([^)]*,|toJSON\s*\(' -g '*.{ts,js,tsx,jsx}'` on hot paths; `rg -n 'structuredClone\(|JSON\.parse\(\s*JSON\.stringify|\.toSorted\(' -g '*.{ts,js,tsx,jsx,svelte,vue}'` in handlers, stores and render loops.
- Verify: measure.md#inp (save, export or send) or measure.md#fps (`stream`) on the path that serializes. Pass: the serialize or parse call's time in `__wpProbe.loaf.read()` `topScripts` goes down, and compare-runs shows "win" on the targeted metric.
- Avoid: The fast path is a V8 detail (support.md §B); the rule costs nothing in other engines. Building a plain object also allocates: do it for large or frequent payloads only, and measure. `JSON.stringify` throws on BigInt values. For high-rate numeric feeds, a binary format beats any JSON (DATA-03). Keep `toSorted()` where the source must not change, such as immutable state.
- Source: https://v8.dev/blog/json-stringify ; https://github.com/v8/v8/blob/main/src/json/json-stringifier.cc

## One-line rules

- **V8-11** Write async code with `async`/`await` on native promises: no promise polyfills, promise subclasses or custom thenables, no async functions transpiled to ES5, no `async` on per-frame helpers that do no I/O, and no `for await` over plain arrays; an `await` on a resolved value does not let the browser render (TASK-04). [js · frame, INP · low] https://v8.dev/blog/fast-async
- **V8-12** Sort numbers with `(a, b) => a - b` (the default sort compares strings), and typed arrays with `.sort()` and no comparator (`.sort().reverse()` for descending); compute costly sort keys once per element; drop index tie-breakers, because the sort is stable; insert a single late item with a binary search instead of sorting again. [js · INP, frame · medium] https://v8.dev/blog/array-sort
- **V8-13** Benchmark an engine-level change on warm code: time it with `performance.now()` (Chromium rounds it to 100 µs, or 5 µs when cross-origin isolated), warm up for thousands of iterations first, run `node --trace-deopt` when numbers jump, and confirm the gain in the real flow with measure.md#fps or measure.md#inp; DevTools and an attached debugger change what runs, so compare only runs made the same way. [js · frame, INP · low] https://v8.dev/blog/maglev
- **V8-14** Confirm a shape or inline-cache problem before you fix it: test the code in Node with `--allow-natives-syntax` (`%HaveSameMap(a, b)`, `%HasFastProperties(o)`, `%DebugPrint(x)`), or record the real flow in a throwaway Chrome profile with `--js-flags="--log-maps --log-ic"` and open the log in the V8 system analyzer; never ship `%` calls, never time runs with logging on, and remember that Node lays out objects differently from Chrome. [js · frame · low] https://v8.dev/blog/system-analyzer
- **V8-15** In per-message and per-row code, return a result (`null`, a status) for expected failures instead of throwing, and do not create `Error` objects or read `.stack` on hot paths: each `Error` captures the stack, and the first `.stack` read formats it; `try`/`catch` itself does not block optimization. [js · INP, frame · medium] https://v8.dev/docs/stack-trace-api
- **V8-16** Before you add a date, number or relative-time formatting library, use `Intl.NumberFormat` (units, compact notation, currency), `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`, `Intl.ListFormat`, `Intl.PluralRules` or `Intl.Segmenter`: the browser already ships the code and the locale data. [script-load · bytes, startup · medium] https://v8.dev/blog/intl
- **V8-17** Run one test pass with the Chrome site setting "JavaScript optimization & security" turned off for your origin, as users under Advanced Protection have it, because JS then runs without the optimizing compilers; keep the app usable, for example by drawing fewer points when frame times rise. [js · frame, INP · medium] https://blog.google/security/advancing-protection-in-chrome-on/

## §H Myths: do not apply

- "`try`/`catch` stops optimization": not in current V8; a throw is what costs (V8-15).
- "Cache `array.length` in a local before the loop": it rarely helps in ordinary loops; loop with `i < a.length` and change it only when a profile points at the load.
- "`let` and `const` are slower than `var`": V8 removes the redundant checks; do not convert declarations.
- "`{ ...x }` is faster than `Object.assign({}, x)`": both take a fast clone path for plain objects; choose by meaning (spread defines properties, `assign` calls setters).
- "Desugar spread, destructuring and `for…of` by hand, and pad calls to the declared parameter count": the native forms are as fast or faster, and a call with fewer arguments costs about the same.
- "Build JSON strings by hand": `JSON.stringify` on plain data is faster (V8-10). "A `DocumentFragment` is much faster": batching the writes is the gain (DOM-07).
- "Wasm is always faster than JS": it pays off only for measured CPU-bound kernels that cross the boundary rarely (TASK-13).
