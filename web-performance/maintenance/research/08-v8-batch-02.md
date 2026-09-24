# V8 deep read, batch 2 of 8: object layout, JSON, code cache, async, modules, pointer compression

Scope: rules that change how we write JS/TS for Chrome (V8), taken from seven v8.dev posts and checked against the current V8 and Chromium source (main branch, fetched 2026-09-23), webstatus.dev, MDN, and a few TC39/blink-dev pages.
Posts read in full: Slack tracking (2020-09-24), JSON.stringify 2x faster (2025-08-04), Code caching for JS developers (2019-04-08, updated 2020-06-16), Faster async functions and promises (2018-11-12), Dynamic import() (2017-11-21), JavaScript modules (2018-06-18), Pointer Compression (2020-03-30).
Engine rules marked "V8 only" can differ in SpiderMonkey and JavaScriptCore. Where a rule is my inference and not stated by a source, the item says so.

---

## A. Object layout and slack tracking

### Assign every instance field in the constructor or as a class field
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, FPS/smoothness, memory
- When: long-lived session, animation/render-loop
- Impact: medium, because fields added later live in a separate backing store that needs an extra pointer hop and grows by copying.
- Do: Declare all fields (also optional ones, with `null` or a typed default) in the constructor body or as class fields. Do not attach "expando" properties (caches, flags, labels) to instances later in hot code.
- Why: When a constructor first runs, V8 gives the initial map room for "expected properties + 8" in-object slots. The estimate counts `this.x = ...` assignments in the constructor source (and already-parsed class fields), summed over the constructor chain, capped at 252 slots. After 7 constructions ("slack tracking" ends), V8 shrinks the instance size to the largest number of slots that any map in that map tree used. A property added after that goes to the out-of-object property array. A constructor with no `this.x =` assignments gets an estimate of 2 (so 10 slots). Assignments made in helper methods (for example `this.init()`) are not counted, but can still use the 8 slack slots if they happen during the first 7 constructions.
- Example:
  ```ts
  // Before: `label` is added after construction -> out-of-object slot
  class Tick { constructor(public price: number, public size: number) {} }
  const t = new Tick(101.5, 3);
  (t as any).label = formatLabel(t);

  // After: the slot exists from the start -> in-object, one shared map
  class Tick {
    label: string | null = null;
    constructor(public price: number, public size: number) {}
  }
  ```
- Avoid/caveats: The first 7 instances of each class are over-allocated by about 8 slots; the GC reclaims this later. Do not add dummy fields "for speed"; only declare fields the class really uses. If TurboFan optimizes an allocation site before 7 constructions, V8 ends slack tracking early for that map family.
- Status: V8 only, still current: `kSlackTrackingCounterStart = 7` in `src/objects/map.h`, `+= 8` in `JSFunction::CalculateExpectedNofProperties` (`src/objects/js-function.cc`), max in-object = (255 - 3 header words) = 252 (`src/objects/js-objects.h`), class constructors add parsed fields (`SharedFunctionInfo::get_property_estimate_from_literal`). Checked on V8 main 2026-09-23.
- Sources: https://v8.dev/blog/slack-tracking ; https://github.com/v8/v8/blob/main/src/objects/js-function.cc ; https://github.com/v8/v8/blob/main/src/objects/map.h ; https://github.com/v8/v8/blob/main/src/objects/shared-function-info.cc

### Assign optional properties unconditionally and in a fixed order
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: animation/render-loop, long-lived session
- Impact: medium, because each conditional branch creates a different leaf map, and code that reads objects with several maps becomes polymorphic.
- Do: Write every property on every path, in the same order. Use `null`/`0`/`NaN` for "absent" instead of skipping the assignment.
- Why: V8 builds a tree of maps (hidden classes) from the initial map, one branch per property name added. In the post's `Peak` example, objects with and without `prominence/isClimbed` end up on two different maps. Slack tracking reserves enough in-object room for the largest descendant, so memory is fine, but property access sites see more than one map.
- Example:
  ```ts
  // Before: two shapes
  function makeOrder(o: Raw) {
    const r: any = { id: o.id, qty: o.qty };
    if (o.limit) r.limit = o.limit;
    return r;
  }
  // After: one shape
  function makeOrder(o: Raw) {
    return { id: o.id, qty: o.qty, limit: o.limit ?? null };
  }
  ```
- Avoid/caveats: A field that is sometimes a number and sometimes `null` is fine for shape, but its field representation becomes Tagged (see section F). Keep number-only fields numeric (use `NaN` as "absent" in hot numeric data).
- Status: V8 only; mechanism unchanged as of 2026-09 (map transitions are core V8).
- Sources: https://v8.dev/blog/slack-tracking

### Create plain objects in one literal with all keys; do not grow them afterwards
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, memory
- When: load, interaction, long-lived session
- Impact: low to medium, because each late property goes out-of-object and the out-of-object array reallocates as it grows.
- Do: Build the object with all its keys in one object literal. Avoid `const o = {}; o.a = ...; o.b = ...` for many keys.
- Why: An object literal with n properties gets a map with exactly n in-object slots and no spare room (`Factory::ObjectLiteralMapFromCache` -> `Map::Create(n)`). An empty `{}` / `new Object()` uses the Object function's initial map with 4 in-object slots (`kInitialGlobalObjectUnusedPropertiesCount = 4`). Keys beyond the in-object slots go to the out-of-object property array. A literal with 128 or more properties starts in dictionary (slow) mode (`kMapCacheSize = 128`).
- Example:
  ```ts
  // Before
  const row: Record<string, unknown> = {};
  row.symbol = s; row.bid = b; row.ask = a; row.last = l; row.time = t; // 5th key: out-of-object
  // After
  const row = { symbol: s, bid: b, ask: a, last: l, time: t };
  ```
- Avoid/caveats: This is about hot, numerous objects. For config objects created once, it does not matter.
- Status: V8 only; checked in `src/heap/factory.cc`, `src/objects/map.cc`, `src/init/bootstrapper.cc`, `src/objects/js-objects.h` on V8 main 2026-09-23. Not stated in the slack-tracking post; derived from source.
- Sources: https://github.com/v8/v8/blob/main/src/heap/factory.cc ; https://github.com/v8/v8/blob/main/src/objects/map.cc ; https://github.com/v8/v8/blob/main/src/init/bootstrapper.cc

### Use `Map` for dynamic keys; do not use plain objects as growing dictionaries
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: INP, memory
- When: long-lived session
- Impact: medium, because the object silently switches to dictionary mode, and every object-shape optimization (inline caches, JSON fast path) stops applying to it.
- Do: Use `Map`/`Set` for collections keyed by runtime values (symbol names, order ids). Keep plain objects for fixed "records".
- Why: When an object has no unused fields left and a keyed store (`obj[key] = v`) would make the number of out-of-object fields larger than max(12, in-object property count), V8 converts the object to dictionary mode (`Map::TooManyFastProperties`, flag `fast_properties_soft_limit = 12`). Dictionary-mode objects are also rejected by the new JSON.stringify fast path.
- Example:
  ```ts
  // Before
  const bySymbol: Record<string, Quote> = {};
  for (const q of quotes) bySymbol[q.symbol] = q;   // many keyed stores -> dictionary mode
  // After
  const bySymbol = new Map<string, Quote>();
  for (const q of quotes) bySymbol.set(q.symbol, q);
  ```
- Avoid/caveats: The limit applies only to keyed stores (`StoreOrigin::kMaybeKeyed`), not to `obj.name = v`. If you must send such a collection as JSON, convert it to an array of records first (see JSON items).
- Status: V8 only; `src/objects/map-inl.h` and `src/flags/flag-definitions.h`, V8 main 2026-09-23. Not stated in the slack-tracking post.
- Sources: https://github.com/v8/v8/blob/main/src/objects/map-inl.h ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h

---

## B. JSON.stringify fast path (V8 13.8 / Chrome 138+)

### Call `JSON.stringify(value)` with no `replacer` and no `space` on hot paths
- Layer: v8
- Stage: script-run, main-thread-task
- Metrics: INP, TBT
- When: interaction, long-lived session (persisting state, sending messages)
- Impact: high for large payloads, because the fast path is more than 2x faster and any replacer or gap argument disables it for the whole call.
- Do: Pass only the value. Transform the data before the call (build a plain DTO) instead of passing a replacer function or array. Pretty-print (`space`) only in debug tools.
- Why: `CanUseFastStringifier` requires `replacer` and `gap` to be `undefined`. Otherwise V8 uses the general, recursive serializer with all its defensive checks.
- Example:
  ```ts
  // Before
  localStorage.setItem('layout', JSON.stringify(layout, (k, v) => (k === 'cache' ? undefined : v), 2));
  // After
  const { cache, ...persisted } = layout;
  localStorage.setItem('layout', JSON.stringify(persisted));
  ```
- Avoid/caveats: The speed-up is V8 only; other engines have their own implementations.
- Status: Shipped in V8 13.8 / Chrome 138 (post). Flag `json_stringify_fast_path` default `true`; the source still has "TODO: Support gap on fast-path" (V8 main 2026-09-23).
- Sources: https://v8.dev/blog/json-stringify ; https://github.com/v8/v8/blob/main/src/json/json-stringifier.cc

### Serialize only plain object literals and arrays: no class instances, `toJSON`, Date, Map, or getters
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT
- When: interaction, long-lived session
- Impact: medium to high, because one unsupported value anywhere in the graph makes V8 throw away the fast-path work and restart the whole call on the slow path.
- Do: Convert domain objects to plain object literals before serialization. Store times as numbers (epoch ms), not `Date`. Do not define `toJSON` on your prototypes.
- Why: The fast path accepts only strings, numbers, booleans, `null`, primitive wrappers, `JS_OBJECT_TYPE` objects whose prototype is the realm's initial `Object.prototype` and which have fast properties and no elements, and arrays whose prototype is the initial `Array.prototype`. Anything else (class instance with its own prototype, `Date`, `Map`, dictionary-mode object, cons string) returns `SLOW_PATH`, and `FastJsonStringify` then restarts from the beginning with the general serializer ("TODO: Resume instead of restarting").
- Example:
  ```ts
  // Before: Position is a class instance with a Date field -> slow path for the whole array
  JSON.stringify(positions);
  // After: plain records
  JSON.stringify(positions.map(p => ({ id: p.id, qty: p.qty, openedAt: p.openedAt.getTime() })));
  ```
- Avoid/caveats: The `map` step allocates; only do it when the payload is large or serialization is frequent. Measure. The "prototype must be the initial prototype" check for class instances comes from source, not from the post (the post only names custom `toJSON`).
- Status: V8 13.8+ (Chrome 138+); checked in `src/json/json-stringifier.cc` (`CanFastSerializeJSObjectFastPath`, `TrySerializeSimpleObject`, `FastJsonStringify`), V8 main 2026-09-23.
- Sources: https://v8.dev/blog/json-stringify ; https://github.com/v8/v8/blob/main/src/json/json-stringifier.cc

### Do not use integer-like keys in objects that you serialize
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT
- When: interaction, long-lived session
- Impact: medium, because keys such as `'0'`, `'42'` are stored as elements, and an object with elements leaves the fast path.
- Do: Send collections keyed by numeric ids as arrays of records, or give keys a non-numeric prefix.
- Why: The post lists "no indexed properties on objects" as a fast-path condition. In source, the object's `elements` store must be empty.
- Example:
  ```ts
  // Before
  JSON.stringify({ [order.id]: order }); // id 1234 -> element, slow path
  // After
  JSON.stringify([{ id: order.id, ...orderFields }]);
  ```
- Avoid/caveats: Arrays are fine; this is about plain objects only.
- Status: V8 13.8+ (Chrome 138+).
- Sources: https://v8.dev/blog/json-stringify ; https://github.com/v8/v8/blob/main/src/json/json-stringifier.cc

### Serialize arrays of same-shaped records with simple keys
- Layer: v8
- Stage: script-run
- Metrics: INP, TBT
- When: interaction, long-lived session
- Impact: medium, because V8 can then copy all keys of a repeated hidden class without per-key checks.
- Do: Create each record with the same keys in the same order (one literal or one constructor-like factory). Use keys without `"`, `\` or control characters, no Symbol keys, and keep all properties enumerable.
- Why: After V8 serializes an object, it marks its hidden class "fast-json-iterable" when no key is a Symbol, all keys are enumerable, and no key needs escaping. The next object with the same hidden class gets its keys copied directly. `JSON.parse` uses the same flag for faster key comparison when it parses arrays of same-shaped objects.
- Example:
  ```ts
  const toRow = (t: Trade) => ({ id: t.id, px: t.price, qty: t.qty, ts: t.time }); // one shape for all rows
  JSON.stringify(trades.map(toRow));
  ```
- Avoid/caveats: Strings with any character above U+00FF are two-byte in V8; the first such string switches the rest of the output to a two-byte buffer (double memory for the result). The post says "ASCII"; the V8 limit is Latin-1 (`kMaxOneByteCharCode`). Do not rewrite user text for this.
- Status: V8 13.8+ (Chrome 138+).
- Sources: https://v8.dev/blog/json-stringify

---

## C. Code caching (Chrome)

### Ship non-trivial scripts as external files of at least 1 KiB, not inline `<script>`
- Layer: build
- Stage: script-compile
- Metrics: startup, FCP, TBT
- When: load, build
- Impact: medium, because a hot code-cache hit skips parse and compile on repeat visits.
- Do: Put scripts that do real work in external files. Merge many tiny (< 1 KiB) scripts into one file.
- Why: Chrome's disk code cache is attached to the HTTP cache entry of a script. External scripts under 1024 characters are never cached (`kMinimalCodeLengthForNonInlineScript = 1024`). Inline scripts have no own resource; the post says Chrome tried to cache them on the HTML document, but in current Chromium the `InlineScriptCache` feature is disabled by default, so inline scripts get no disk code cache.
- Example:
  ```html
  <!-- Before: 40 KB of app bootstrap inline in the HTML -->
  <script>/* ... */</script>
  <!-- After -->
  <script type="module" src="/assets/bootstrap-3f9a1c.js"></script>
  ```
- Avoid/caveats: Very small, critical inline snippets (theme setup, a few lines) are fine inline; they would not be cached anyway.
- Status: Chrome only. Checked in Chromium `third_party/blink/renderer/bindings/core/v8/v8_code_cache.cc` and `third_party/blink/common/features.cc` (`kInlineScriptCache` = `FEATURE_DISABLED_BY_DEFAULT`), main branch 2026-09-23.
- Sources: https://v8.dev/blog/code-caching-for-devs ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/bindings/core/v8/v8_code_cache.cc ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/common/features.cc

### Keep script URLs stable across deploys and sessions
- Layer: build
- Stage: network, script-compile
- Metrics: startup, TBT
- When: build, load
- Impact: medium, because a new URL or a 200 response starts the cache over at a cold run.
- Do: Use content-hashed file names so that unchanged chunks keep their URL. Never add per-deploy or per-session query strings (`?v=...`, `?t=...`) to script URLs. Deploy less often when you can.
- Why: Chrome keys the code cache by script URL, including the query string. A `304 Not Modified` keeps the code cache; a `200 OK` replaces the resource and clears it. Chrome creates the code cache only on the second fetch ("warm run") and uses it from the third ("hot run"). In current source the second fetch must happen within 72 hours of the first (`kHotHours = 72`), otherwise the timestamp is just renewed.
- Example:
  ```ts
  // Before (runtime)
  s.src = `/chart-worker.js?t=${Date.now()}`;
  // After
  s.src = new URL('./chart-worker.js', import.meta.url).href; // bundler emits a hashed, stable name
  ```
- Avoid/caveats: Watch for "hash cascades": when a leaf chunk changes, bundlers also rename every chunk that imports it, so unchanged code gets a new URL and loses its cache. Import maps or a separate runtime/manifest chunk can limit this (my inference, not stated in the post).
- Status: Chrome only; heuristics can change (the post says so). 72-hour rule checked in `v8_code_cache.cc` (`TimestampIsRecent`), main 2026-09-23.
- Sources: https://v8.dev/blog/code-caching-for-devs ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/bindings/core/v8/v8_code_cache.cc

### Split stable library code from frequently changing app code
- Layer: build
- Stage: script-compile
- Metrics: startup
- When: build
- Impact: medium, because a change anywhere in a script invalidates that whole script's code cache.
- Do: Put rarely changing dependencies (framework, chart library) in their own chunk, shared between pages, so their cache survives app deploys.
- Why: Code caching is per script. The post also gives the opposite trade-off: the cache only holds functions that were compiled when the script finished running, so a library made only of lazily compiled functions (called later from another script) is not cached. There is no single answer; do not put everything in one giant bundle either (it hurts streaming, parallel fetch and interactivity).
- Example: `manualChunks: { vendor: ['scichart', 'svelte'] }` (Rollup/Vite style).
- Avoid/caveats: Too many chunks bring request overhead and chunks < 1 KiB are not cached.
- Status: Chrome only; still valid per current `v8_code_cache.cc` structure.
- Sources: https://v8.dev/blog/code-caching-for-devs

### Keep the code path at startup deterministic
- Layer: js
- Stage: script-compile, script-run
- Metrics: startup, TBT
- When: load
- Impact: low to medium, because the code cache holds only functions compiled by the end of the warm run.
- Do: Do not choose between large code paths at random (for example A/B branches by `Math.random()`) during script execution. Make the choice stable per user (a stored bucket) so the same functions run each load.
- Why: Chrome serializes the code cache after the script has executed, to include lazily compiled functions. If the warm run compiled only `A()`, a later run that needs `B()` compiles it on the main thread. Current Chromium also records "local compile hints" (which functions were compiled) on the warm run and uses them to compile those functions eagerly on the next run (`kLocalCompileHints` enabled by default), which has the same dependency on determinism.
- Avoid/caveats: Event handlers and promise callbacks that first run after the script ends are not in the cache either.
- Status: Chrome only; `kLocalCompileHints` = `FEATURE_ENABLED_BY_DEFAULT` in Chromium main 2026-09-23.
- Sources: https://v8.dev/blog/code-caching-for-devs ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/common/features.cc

### Mark the one core file whose functions all run at load with `//# allFunctionsCalledOnLoad`
- Layer: js
- Stage: script-compile
- Metrics: startup, TBT, FCP
- When: load, build
- Impact: medium for the right file, because V8 then compiles all its functions eagerly on a background thread while the file downloads, instead of lazily on the main thread at first call.
- Do: Put `//# allFunctionsCalledOnLoad` as the first line of a file whose functions nearly all run during page load. Use it for one small core file, not for the app. Check that the bundler/minifier keeps the comment (esbuild strips it; issue #4247 is closed with no fix shown; a `banner`-style option can add it back, my inference).
- Why: V8 compiles lazily by default. A function that is compiled only on first call blocks the main thread at that moment. The explicit hint moves this work to background threads, overlapped with the network. The older way is the IIFE/"PIFE" heuristic: a `(` before `function` makes V8 compile eagerly; the 2019 post calls this "an abuse of heuristics" to avoid unless necessary.
- Example:
  ```js
  //# allFunctionsCalledOnLoad
  export function initChartSurface() { /* runs at load */ }
  export function wireToolbar() { /* runs at load */ }
  ```
- Avoid/caveats: The post says to use it sparingly; eager compilation of unused functions costs time and memory. Per-function hints (`//# functionsCalledOnLoad=...`) are experimental and not approved to ship.
- Status: Chrome 136+ (V8 blog, 2025-04-29). Chrome only; other engines ignore the comment.
- Sources: https://v8.dev/blog/explicit-compile-hints ; https://github.com/WICG/explicit-javascript-compile-hints-file-based ; https://github.com/evanw/esbuild/issues/4247 ; https://v8.dev/blog/code-caching-for-devs

### Precache critical classic scripts in the service worker `install` event
- Layer: network
- Stage: network, script-compile
- Metrics: startup, TBT
- When: load
- Impact: medium, because Chrome then creates a full code cache at install time, so even the first page load that uses the script can skip compilation.
- Do: Add critical scripts to Cache Storage inside `install` (`cache.addAll([...])`) and serve them from the service worker.
- Why: For scripts put in Cache Storage during `install`, Chrome compiles everything eagerly and stores a "full" code cache. For scripts stored in Cache Storage at another time and served by the service worker, Chrome makes a normal code cache on the first load (no "hotness" check), one load earlier than with the HTTP cache. Current source: responses served from CacheStorage use `kCodeWithoutHeatCheck`; the eager variant is `kFullCodeWithoutHeatCheck`.
- Example:
  ```js
  self.addEventListener('install', (e) => {
    e.waitUntil(caches.open('core-v12').then((c) => c.addAll(['/assets/core-7c1e.js'])));
  });
  ```
- Avoid/caveats: The full cache costs more memory. The post says the full cache assumes a UTF-8 page and a classic script; if the page loads it as a module, Chrome discards it and makes a normal cache (not re-verified for 2026).
- Status: Chrome only; Service Worker and Cache API are Baseline.
- Sources: https://v8.dev/blog/code-caching-for-devs ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/bindings/core/v8/v8_code_cache.cc

### Verify code caching with a trace of cold, warm and hot runs
- Layer: tooling
- Stage: script-compile
- Metrics: startup
- When: testing
- Impact: low, because it only measures; but it prevents false assumptions.
- Do: Record a trace with the `v8` category in a clean profile (no extensions). Look at `v8.compile` events: warm runs show `cacheProduceOptions`/`producedCacheSize`, hot runs show `cacheConsumeOptions`/`consumedCacheSize`. Load the page three times within 72 hours.
- Why: The post says DevTools did not show code-cache data in 2019. I did not confirm whether current DevTools shows it.
- Example: `google-chrome --user-data-dir="$(mktemp -d)" --disable-extensions`, then record via chrome://tracing or the Perfetto UI.
- Avoid/caveats: Tracing records the whole browser; close other tabs.
- Status: chrome://tracing still exists; Perfetto is the current trace UI (general knowledge, not re-verified).
- Sources: https://v8.dev/blog/code-caching-for-devs

---

## D. Async functions and promises

### Prefer `async`/`await` over hand-written `.then()` chains
- Layer: js
- Stage: microtask, script-run
- Metrics: INP, TBT
- When: interaction, long-lived session
- Impact: low to medium, because since V8 7.2 `await` on a native promise costs one microtask tick and no throwaway promise, and `await` also gives useful async stack traces in production.
- Do: Write async code with `async`/`await`. Use `try/catch` around awaits instead of `.catch` chains.
- Why: Before the spec change, each `await` created two extra promises and needed at least three microtask ticks. Now `await` uses `PromiseResolve`, which returns a native promise unchanged, so the wrapper promise and two ticks are gone, and the throwaway promise was removed by an editorial spec change. "Zero-cost async stack traces" (default since V8 7.3) add `at async fn` frames to `Error.stack`, but only across `await` (and `Promise.all`), not across `.then()`.
- Example:
  ```ts
  // Before
  function load(id) { return fetchQuote(id).then(q => enrich(q)).then(render); }
  // After
  async function load(id) { render(await enrich(await fetchQuote(id))); }
  ```
- Avoid/caveats: Old advice "hand-written promises are faster than async/await" is obsolete (since V8 7.2 / Chrome 72, 2018).
- Status: Spec-level change, all engines; async functions Baseline widely available (webstatus.dev: high date 2019-10-05). `async_stack_traces` default `true` in V8 main.
- Sources: https://v8.dev/blog/fast-async ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h ; https://api.webstatus.dev/v1/features/async-await

### Use native promises only; do not polyfill, subclass, or await custom thenables in hot code
- Layer: js
- Stage: microtask
- Metrics: INP, TBT
- When: interaction, long-lived session
- Impact: low to medium, because the one-tick `await` shortcut works only for native promises.
- Do: Remove Promise polyfills and userland promise libraries (Bluebird, Q) from modern bundles. Do not subclass `Promise` or change `promise.constructor`. Do not make hot-path objects "thenable".
- Why: `PromiseResolve(%Promise%, x)` returns `x` unchanged only when `x` is a native promise whose `constructor` is `%Promise%`. Other values are wrapped in a new promise; a thenable also needs a `PromiseResolveThenableJob` (an extra microtask) that calls its `then`. The post's advice: "stick to the native promise implementation".
- Example:
  ```ts
  // Before
  import Bluebird from 'bluebird'; const q = await Bluebird.resolve(x);
  // After
  const q = await x;
  ```
- Avoid/caveats: Awaiting a non-promise value (`await 42`) still wraps it and costs a tick.
- Status: ECMAScript (ES2019+ await semantics), all engines.
- Sources: https://v8.dev/blog/fast-async

### Write `return await p` instead of `return p` in async functions when latency or ordering matters
- Layer: js
- Stage: microtask
- Metrics: INP
- When: interaction
- Impact: low, because it saves one microtask tick per call; it matters in deep async call chains.
- Do: Use `return await p` inside async functions (always inside `try` blocks, for correct error catching).
- Why: Returning a promise from an async function resolves the implicit promise with a promise, which needs a `PromiseResolveThenableJob` plus a reaction: 2 ticks. `return await p` takes 1 tick. A TC39 proposal to remove this difference ("Faster Promise Adoption") is only at Stage 1.
- Example:
  ```ts
  async function getBook(sym: string) { return await api.book(sym); }
  ```
- Avoid/caveats: Some lint configs (older `no-return-await`) flag this; `@typescript-eslint/return-await` supports it. The difference is small; do not micro-tune non-hot code.
- Status: Current spec behavior as of 2026-09; proposal Stage 1.
- Sources: https://github.com/tc39/proposal-faster-promise-adoption ; https://v8.dev/blog/fast-async

### Yield to the browser with `scheduler.yield()`, not with `await Promise.resolve()`
- Layer: js
- Stage: microtask, main-thread-task
- Metrics: INP, TBT
- When: interaction, load
- Impact: high for long work, because microtasks never let the browser render or handle input.
- Do: Split long work into chunks and `await scheduler.yield()` between them, with a `setTimeout` fallback. Do not expect a chain of resolved promises or `await` in a loop to give the browser a chance to paint.
- Why: The microtask queue is always emptied before control goes back to the event loop. A loop of `await`s on resolved values stays inside one task, however long it runs. `scheduler.yield()` ends the task and schedules a prioritized continuation.
- Example:
  ```ts
  const yieldToMain = () =>
    'scheduler' in globalThis && 'yield' in scheduler
      ? scheduler.yield()
      : new Promise<void>((r) => setTimeout(r, 0));

  for (const [i, bar] of bars.entries()) {
    process(bar);
    if (i % 500 === 0) await yieldToMain();
  }
  ```
- Avoid/caveats: Too many yields add scheduling overhead; yield about every 50 ms of work or at natural breakpoints.
- Status: `scheduler.yield()` Chrome/Edge 129, Firefox 142, not in Safari: Baseline limited availability (MDN BCD, webstatus.dev 2026-09).
- Sources: https://v8.dev/blog/fast-async ; https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield ; https://api.webstatus.dev/v1/features/scheduler

### Start independent async work together and await it with `Promise.all`
- Layer: js
- Stage: network, microtask
- Metrics: INP, LCP
- When: load, interaction
- Impact: medium, because sequential `await`s add up the latency of each request.
- Do: Start all independent requests first, then `await Promise.all([...])`.
- Why: Each `await` suspends the function until its promise settles, so awaits in sequence serialize work. V8 also made `Promise.all` about 8x faster in 2018 (V8 5.5 -> 6.8), so it is not a costly helper.
- Example:
  ```ts
  // Before
  const book = await api.book(s); const trades = await api.trades(s);
  // After
  const [book, trades] = await Promise.all([api.book(s), api.trades(s)]);
  ```
- Avoid/caveats: Use `Promise.allSettled` when one failure must not reject the rest.
- Status: Promise.all Baseline widely available.
- Sources: https://v8.dev/blog/fast-async

### Keep hot, synchronous helpers synchronous
- Layer: js
- Stage: microtask, script-run
- Metrics: INP, FPS/smoothness
- When: animation/render-loop
- Impact: low to medium, because every async call allocates a promise and every `await` suspends, resumes, and costs at least one microtask tick.
- Do: Do not mark per-frame or per-tick functions `async` when they do no I/O. Do not `for await` over plain arrays.
- Why: An async function always returns a new (implicit) promise, and each `await` suspends the function (post). `for await` over a sync iterable wraps each value through an async-from-sync iterator, so each element costs a tick (spec behavior; my inference, not stated in the post).
- Example:
  ```ts
  // Before
  async function toPixel(v: number) { return v * scale; }
  // After
  function toPixel(v: number) { return v * scale; }
  ```
- Avoid/caveats: Clarity first outside hot paths.
- Status: ECMAScript semantics, all engines.
- Sources: https://v8.dev/blog/fast-async

---

## E. Modules and dynamic import()

### Load non-critical features with dynamic `import()` at the moment of user intent
- Layer: js
- Stage: network, script-compile, script-run
- Metrics: LCP, TBT, bundle-size, startup
- When: load, interaction
- Impact: high, because code that is not imported statically is not downloaded, parsed, or compiled at startup.
- Do: Use static `import` for code needed for first paint and above-the-fold UI. Use `import()` for dialogs, rare tools, and secondary panels, triggered by the user action (or earlier, on hover/focus).
- Why: With static imports the whole module graph must be fetched and evaluated before the main code runs. `import()` returns a promise for the module namespace object, after fetching, instantiating and evaluating the module and its dependencies. A module is evaluated once; later `import()` calls get the same namespace.
- Example:
  ```ts
  button.addEventListener('click', async () => {
    const { openIndicatorDialog } = await import('./indicator-dialog');
    openIndicatorDialog();
  });
  ```
- Avoid/caveats: The first use pays network plus compile latency on the interaction (hurts INP); start the import on `pointerenter`/`focus` or preload the chunk. Cross-origin modules need CORS headers. Nested dynamic imports create request waterfalls.
- Status: `import()` Chrome 63, Firefox 67, Safari 11.1 (MDN BCD); JS modules Baseline widely available since 2020-11 (webstatus.dev).
- Sources: https://v8.dev/features/dynamic-import ; https://v8.dev/features/modules ; https://api.webstatus.dev/v1/features/js-modules

### Keep bundling and code-splitting for production
- Layer: build
- Stage: network, script-compile
- Metrics: LCP, startup, bundle-size
- When: build
- Impact: high, because Chrome's analysis of a ~300-module library showed bundled code loads faster than unbundled modules.
- Do: Bundle for production. Split by route/feature. Ship unbundled native modules only for development or small apps (the post: under 100 modules and dependency depth under 5).
- Why: Many small module requests, per-module overhead, and discovery of the graph level by level cost load time. Static `import`/`export` lets bundlers remove unused exports. Unbundled fine-grained modules can win on warm caches (only the changed module is re-fetched), so measure both cold and warm loads before choosing.
- Avoid/caveats: The thresholds date from 2018; I found no newer v8.dev guidance that replaces them.
- Status: Guidance, 2018; still consistent with current bundler practice.
- Sources: https://v8.dev/features/modules

### Write small modules with few exports, and import only what you use
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, startup
- When: build
- Impact: medium, because without tree-shaking the browser downloads, parses and compiles the whole module for one export.
- Do: Prefer fine-grained modules over "utils" files that export many unrelated functions. Import named exports directly from the module that defines them.
- Why: In an unbundled setup `import { pluck } from './util.mjs'` still loads all of `util.mjs`. Fine-grained modules reduce the need for dead-code elimination, and each used module can be code-cached on its own.
- Avoid/caveats: Barrel files that re-export everything have the same problem when the bundler cannot prove they are side-effect free (my inference; the post shows only the util example).
- Status: Guidance, current.
- Sources: https://v8.dev/features/modules

### Declare the critical module graph with `<link rel="modulepreload">`
- Layer: html
- Stage: preload-scan, network, script-compile
- Metrics: LCP, FCP, startup
- When: load
- Impact: medium, because the browser does not have to find dependencies one level at a time.
- Do: Add `modulepreload` links for the entry module and each critical dependency (list them all; do not rely on the browser to fetch dependencies). For a predicted next feature, inject a `modulepreload` link on user intent.
- Why: `modulepreload` fetches, parses and compiles the module and puts it in the module map ready to execute. Plain `preload` only fills the HTTP cache. Fetching dependencies automatically is a browser-specific option, so MDN says to list each one.
- Example:
  ```html
  <link rel="modulepreload" href="/assets/app-9d2e.js">
  <link rel="modulepreload" href="/assets/chart-core-41ab.js">
  <script type="module" src="/assets/app-9d2e.js"></script>
  ```
- Avoid/caveats: Preloading too much competes with LCP resources. Request mode is always CORS; the `crossorigin` value must match the later fetch, or the browser fetches twice.
- Status: Baseline widely available since 2026-03-18 (Chrome 66, Firefox 115, Safari 17; webstatus.dev).
- Sources: https://v8.dev/features/modules ; https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload ; https://api.webstatus.dev/v1/features/modulepreload

### Do not add `defer` to module scripts; use `async` only for independent modules
- Layer: html
- Stage: html-parse, script-run
- Metrics: FCP, LCP
- When: load
- Impact: low, because it is about correct intent, not a speed-up.
- Do: Write `<script type="module" src>` without `defer`. Add `async` only when the module does not depend on DOM order or other scripts (for example analytics).
- Why: Module scripts and all their dependencies download in parallel with HTML parsing and run after parsing, like `defer`. `async` runs the module as soon as it is ready, in no fixed order, and it also works on inline module scripts (not on inline classic scripts). A module URL is evaluated once, even if included several times; a classic script runs each time.
- Status: Baseline widely available.
- Sources: https://v8.dev/features/modules

### Stop shipping `nomodule` fallback bundles; ship modern syntax
- Layer: build
- Stage: network, script-compile
- Metrics: bundle-size, startup
- When: build
- Impact: medium, because transpiled legacy code is larger and slower to parse.
- Do: Remove the `type="module"` / `nomodule` differential serving. Target modern syntax (ES2020+) and do not transpile async/await, classes or arrow functions.
- Why: In 2018 the pattern let modern browsers get smaller, untranspiled code. Now every supported browser runs modules, so the fallback is dead weight in the build.
- Status: JS modules Baseline widely available since 2020-11-09 (webstatus.dev). The nomodule pattern is obsolete.
- Sources: https://v8.dev/features/modules ; https://api.webstatus.dev/v1/features/js-modules

### Do not rely on HTTP/2 server push for module graphs
- Layer: network
- Stage: network
- Metrics: LCP, TTFB
- When: load
- Impact: medium, because push is gone in Chrome.
- Do: Use HTTP/2 or HTTP/3 multiplexing, `modulepreload`, and `103 Early Hints`.
- Why: The 2018 post already called push "not a silver bullet" (hard to push only uncached files). Chrome 106 disabled push by default.
- Status: Removed from Chrome 106 (2022).
- Sources: https://v8.dev/features/modules ; https://developer.chrome.com/blog/removing-push

### Resolve module-relative assets and workers with `new URL(..., import.meta.url)`
- Layer: build
- Stage: network
- Metrics: startup
- When: build, load
- Impact: low, because it is about correct, cache-stable URLs, and module workers keep worker code out of the main bundle.
- Do: Use `new URL('./file', import.meta.url)` for images, WASM and worker entry files, and `new Worker(url, { type: 'module' })` for workers that do heavy data work.
- Why: `import.meta.url` is the module's own URL, so paths do not depend on the page URL. Bundlers recognize this pattern and emit hashed assets (my note; the post shows only the image case).
- Example:
  ```ts
  const worker = new Worker(new URL('./series-worker.ts', import.meta.url), { type: 'module' });
  ```
- Status: Module workers Baseline widely available since 2025-12-06; module service workers newly available since 2026-01-13 (Firefox 147); module shared workers newly available since 2026-05-05 (webstatus.dev).
- Sources: https://v8.dev/features/modules ; https://api.webstatus.dev/v1/features/js-modules-workers ; https://api.webstatus.dev/v1/features/js-modules-service-workers

### Use import maps when you need bare specifiers or stable module names in unbundled code
- Layer: html
- Stage: network
- Metrics: startup
- When: build, load
- Impact: low, because it is mainly a deploy tool.
- Do: Use a `<script type="importmap">` to map bare specifiers to hashed URLs. It can also let a changed leaf module get a new URL without renaming its importers (my inference: this protects the code cache of unchanged modules).
- Why: Bare specifiers throw without an import map. In 2018 import maps were only a proposal.
- Status: Import maps Baseline widely available since 2025-09-27; multiple import maps: limited (webstatus.dev).
- Sources: https://v8.dev/features/modules ; https://api.webstatus.dev/v1/features/import-maps

### Keep top-level `await` out of modules on the critical path
- Layer: js
- Stage: script-run
- Metrics: LCP, startup
- When: load
- Impact: medium, because a module with top-level await delays the evaluation of every module that imports it.
- Do: Do not await network or storage at the top level of shared or entry modules. Export an async init function instead.
- Why: The modules post notes that top-level await exists in modules. Its effect on dependents follows from the module evaluation order (spec; not detailed in this post). `import defer` also evaluates modules with top-level await eagerly.
- Status: Top-level await: webstatus.dev shows Baseline newly available (2026-09-14).
- Sources: https://v8.dev/features/modules ; https://api.webstatus.dev/v1/features/top-level-await ; http://www.mail-archive.com/blink-dev@chromium.org/msg17443.html

### Watch `import defer` but do not depend on it yet
- Layer: js
- Stage: script-run
- Metrics: startup, TBT
- When: load
- Impact: medium when available, because it loads a module graph but runs a module only when code first reads a property of its namespace.
- Do: For now, use dynamic `import()` for lazy evaluation. Re-check support before using `import defer * as ns from './x.js'`.
- Why: `import defer` gives synchronous, lazy evaluation without the async friction of `import()`.
- Status: Limited availability. Chrome Intent to Ship for M155 (2026-09-14); WebKit "shipped/shipping"; Gecko positive (blink-dev). webstatus.dev: limited.
- Sources: http://www.mail-archive.com/blink-dev@chromium.org/msg17443.html ; https://api.webstatus.dev/v1/features/import-defer

---

## F. Pointer compression and number storage

### Keep hot integers inside the 31-bit Smi range
- Layer: v8
- Stage: script-run, gc-memory
- Metrics: memory, FPS/smoothness, INP
- When: animation/render-loop, long-lived session
- Impact: medium, because an integer outside the range is a heap-allocated number (HeapNumber) when it is stored in an object field or a tagged array.
- Do: Keep counters, indices and ids used in hot code between -1,073,741,824 and 1,073,741,823 (-2^30 .. 2^30-1). Store large values such as Unix seconds (about 1.79e9 in 2026), epoch milliseconds, or 32-bit hashes (`h >>> 0`) in typed arrays, or store them as offsets from a base value.
- Why: With pointer compression (Chrome on 64-bit desktop and Android since V8 8.0 / Chrome 80), a tagged value is 32 bits and one bit marks Smi vs pointer, so a Smi carries a 31-bit payload. Without compression (Node.js default builds) Smis are 32-bit.
- Example:
  ```ts
  // Before: epoch seconds on each bar object -> HeapNumber per value
  bars.push({ t: 1790000000, o, h, l, c });
  // After: time column in a typed array, or offset from session start
  times[i] = epochSec;                 // Float64Array / Int32Array column
  const tRel = epochSec - sessionStartSec; // fits a Smi
  ```
- Avoid/caveats: Doubles are fine in `PACKED_DOUBLE_ELEMENTS` arrays (stored unboxed). This rule is about object fields and mixed/tagged arrays.
- Status: V8 only. `kSmiValueSize = 31` for compressed builds in `include/v8-internal.h` (V8 main 2026-09-23).
- Sources: https://v8.dev/blog/pointer-compression ; https://v8.dev/blog/v8-release-80 ; https://github.com/v8/v8/blob/main/include/v8-internal.h

### Store large numeric series in typed arrays, not arrays of objects with number fields
- Layer: v8
- Stage: gc-memory, script-run, gpu-upload
- Metrics: memory, FPS/smoothness, INP
- When: long-lived session, animation/render-loop
- Impact: high for chart data, because each double in an object field costs a pointer plus a separate heap box, and the GC must trace every object.
- Do: Keep OHLC/price/time series as columns of `Float64Array` (or `Float32Array` when precision allows), for example in a ring buffer. Keep objects for UI-level records only.
- Why: "Double field unboxing" (storing a double directly in an object field) was disabled because doubles do not fit in 32-bit compressed fields, and the flag is now gone from V8. A double field holds a pointer to a HeapNumber box (map word + 8-byte value) that V8 updates in place. A typed array stores 8 bytes per value, contiguous, in an ArrayBuffer backing store inside the V8 sandbox and outside the 4 GB pointer-compression heap, with no per-value objects for the GC to trace. The post itself recommends Float64 typed arrays or Wasm for number-crunching.
- Example:
  ```ts
  // Before: ~5 boxes + 1 object per bar
  const bars = data.map(d => ({ t: d.t, o: d.o, h: d.h, l: d.l, c: d.c }));
  // After: 5 columns
  const n = data.length;
  const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n),
        l = new Float64Array(n), c = new Float64Array(n);
  for (let i = 0; i < n; i++) { const d = data[i]; t[i] = d.t; o[i] = d.o; h[i] = d.h; l[i] = d.l; c[i] = d.c; }
  ```
- Avoid/caveats: SciChart.js keeps series data in WebAssembly memory; feed it from typed arrays where its API accepts them (check the SciChart docs for the exact overloads; not verified here). Typed arrays have a fixed length; grow by allocating a larger one and `set()`.
- Status: V8 only. `unbox_double_fields` flag is absent from V8 main (only `unbox_double_arrays` remains); in-place HeapNumber box writes in `JSObject::WriteToField` (`src/objects/js-objects-inl.h`); ArrayBuffer backing stores referenced by sandboxed pointers (`src/sandbox/README.md`). Checked 2026-09-23.
- Sources: https://v8.dev/blog/pointer-compression ; https://github.com/v8/v8/blob/main/src/objects/js-objects-inl.h ; https://github.com/v8/v8/blob/main/src/sandbox/README.md

### Initialize floating-point fields with a double, and never change a field's type
- Layer: v8
- Stage: script-run
- Metrics: INP, FPS/smoothness
- When: long-lived session, animation/render-loop
- Impact: medium, because a field representation change makes V8 create a new map, deprecate the old one, migrate objects, and throw away optimized code that depended on it.
- Do: If a field will hold non-integer numbers (prices, `performance.now()` times), initialize it with a double such as `NaN`, not `0`. Never store a string or object into a numeric field.
- Why: V8 tracks a representation per field: Smi, Double, HeapObject, or Tagged. Smi -> Double needs a new map and deprecates the old one (react-cliff post). In the pointer-compression post, `new Point(2, 'ab')` generalizes field `y`, and optimized code that assumed numbers is deoptimized.
- Example:
  ```ts
  // Before
  class Quote { last = 0; ts = 0; }          // Smi, later receives 101.25 -> map change
  // After
  class Quote { last = NaN; ts = NaN; }      // Double from the start
  ```
- Avoid/caveats: Fields that mix `null` and numbers are Tagged from the start; that is stable, only slower than Double for math. The React "cliff" bug (Smi -> Double together with `Object.preventExtensions`) was fixed in V8 7.4, but the map migration cost remains.
- Status: V8 only.
- Sources: https://v8.dev/blog/pointer-compression ; https://v8.dev/blog/react-cliff

### Size memory with 4-byte slots in Chrome, and do not trust Node.js heap numbers for it
- Layer: tooling
- Stage: gc-memory
- Metrics: memory
- When: testing, long-lived session
- Impact: medium, because unit tests in Node.js use a different object layout than Chrome.
- Do: Estimate Chrome object size as 12 bytes of header (map, properties, elements) + 4 bytes per in-object field (+12 bytes per boxed double). Measure real memory in Chrome (heap snapshot, `performance.measureUserAgentSpecificMemory` where available). Keep the JS-object heap bounded in long sessions: evict old ticks, use ring buffers.
- Why: Chrome uses pointer compression: tagged values are 4 bytes and the JS heap of an isolate lives in a 4 GB region (the post: Chrome limits the heap to 2 or 4 GB depending on the device). Official Node.js builds do not enable pointer compression by default (Node issue #55735), so tagged slots are 8 bytes there and Smis are 32-bit.
- Avoid/caveats: The 4 GB cage is about JS objects; ArrayBuffer data lives outside it (see typed-array rule).
- Status: Chrome 80+ with pointer compression (V8 8.0). Node.js default builds: no pointer compression (per issue #55735, closed as stale; not re-verified for Node 26).
- Sources: https://v8.dev/blog/pointer-compression ; https://v8.dev/blog/v8-release-80 ; https://github.com/nodejs/node/issues/55735

---

## Obsolete or changed advice found in this batch
- "async/await is slower than hand-written promises": obsolete since V8 7.2 / Chrome 72 (fast-async post, update note).
- `--harmony-await-optimization` and `--async-stack-traces` flags: both default on (V8 7.2 and 7.3).
- "Chrome caches inline scripts on the HTML resource" (2019 post): current Chromium has `InlineScriptCache` disabled by default.
- "Code caching data is not in DevTools; use chrome://tracing": still true to my knowledge for DevTools (not verified); Perfetto is the current trace UI.
- "Wrap functions in parentheses to force eager compile": allowed but discouraged; Chrome 136+ has the file-level `//# allFunctionsCalledOnLoad` hint.
- `nomodule` differential serving: obsolete (modules Baseline widely since 2020).
- HTTP/2 server push for modules: removed in Chrome 106.
- "Import maps are a proposal", "module workers need a flag": both Baseline widely available now (2025).
- Layered APIs (`std:` specifiers) and Web Bundles as native bundling (2018 post): never became web platform features for this purpose (I did not verify their formal status).
- Double field unboxing: gone since pointer compression; the flag no longer exists.
- "Smis are 32-bit on 64-bit": only without pointer compression (Node default); Chrome uses 31-bit Smis.
- "Build JSON strings by hand for speed": obsolete; JSON.stringify fast path is more than 2x faster since Chrome 138.

## Sources read
- https://v8.dev/blog/slack-tracking
- https://v8.dev/blog/json-stringify
- https://v8.dev/blog/code-caching-for-devs
- https://v8.dev/blog/fast-async
- https://v8.dev/features/dynamic-import
- https://v8.dev/features/modules
- https://v8.dev/blog/pointer-compression
- https://v8.dev/blog/explicit-compile-hints
- https://v8.dev/blog/v8-release-80
- https://v8.dev/blog/react-cliff
- https://v8.dev/blog/sandbox
- https://github.com/v8/v8/blob/main/src/objects/map.h
- https://github.com/v8/v8/blob/main/src/objects/map-inl.h
- https://github.com/v8/v8/blob/main/src/objects/map.cc
- https://github.com/v8/v8/blob/main/src/objects/js-function.cc
- https://github.com/v8/v8/blob/main/src/objects/js-objects.h
- https://github.com/v8/v8/blob/main/src/objects/js-objects-inl.h
- https://github.com/v8/v8/blob/main/src/objects/shared-function-info.cc
- https://github.com/v8/v8/blob/main/src/parsing/parser-base.h
- https://github.com/v8/v8/blob/main/src/heap/factory.cc
- https://github.com/v8/v8/blob/main/src/init/bootstrapper.cc
- https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h
- https://github.com/v8/v8/blob/main/src/json/json-stringifier.cc
- https://github.com/v8/v8/blob/main/include/v8-internal.h
- https://github.com/v8/v8/blob/main/src/sandbox/README.md
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/bindings/core/v8/v8_code_cache.cc
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/common/features.cc
- https://github.com/WICG/explicit-javascript-compile-hints-file-based (search result summary)
- https://github.com/evanw/esbuild/issues/4247
- https://github.com/tc39/proposal-faster-promise-adoption
- https://github.com/tc39/ecma262/issues/2683 (not relevant to ticks; confirmed)
- https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield
- https://github.com/mdn/browser-compat-data (api/Scheduler.json, javascript/operators/import.json)
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload
- https://developer.chrome.com/blog/removing-push
- https://api.webstatus.dev/v1/features/ (js-modules, modulepreload, import-maps, js-modules-workers, js-modules-service-workers, js-modules-shared-workers, top-level-await, async-await, scheduler, import-defer)
- http://www.mail-archive.com/blink-dev@chromium.org/msg17443.html (Intent to Ship: import defer)
- https://github.com/nodejs/node/issues/55735

## Not covered / could not access
- Diagrams in the posts (map trees, heap layouts, benchmark charts) are images; I used the text only.
- The async post's embedded video was not watched.
- Whether current Chrome DevTools shows code-cache produce/consume data: not verified.
- Whether a pre-cached "full" service-worker code cache is still discarded for module scripts (2020 statement): not re-verified in source.
- Whether Chrome workers share one pointer-compression cage with the page or get their own: not verified.
- Node.js pointer compression status for Node 24/26 official builds: not re-verified beyond issue #55735.
- SciChart.js API overloads for typed arrays: not checked (out of scope for this batch).
- The status of Layered APIs and Web Bundles was not formally verified.
- Bundled-vs-unbundled thresholds (100 modules, depth 5) come from 2018; no newer v8.dev data found.
