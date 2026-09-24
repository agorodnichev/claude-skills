# Verify: 09-v8-consolidated.md

Checked on 2026-09-23. 142 items: **125 verified, 16 corrected, 1 disputed, 0 unverified.**

Method and data (all saved under `raw/verify/09/`):
- web-features 3.39.0 and BCD 8.1.2 (2026-09-17), reused from `raw/verify/02/` (current: npm latest is still 3.39.0 / 8.1.2). Query helper `raw/verify/09/q.py`.
- V8 `main` source and flags fetched on 2026-09-23 (`flag-definitions.h`, `feature-flags.h`, `map*.h`, `js-objects.h`, `elements-kind.h`, `ic.cc`, `intl-objects.cc`, `json-parser.cc`, `js-data-object-builder.cc`, `json-stringifier.cc`, `builtins-object-gen.cc`, `builtins-arraybuffer.cc`, `experimental-compiler.cc`, `wasm-limits.h`, `module-compiler.cc`, `version.h`, `code-serializer.cc`, `BUILD.gn` and others in `raw/verify/09/v8/`).
- Chromium `main` Blink source (`script_streamer.cc`, `features.cc`, `v8_code_cache.cc`, `v8_script_runner.cc`, `v8_wasm_response_extensions.cc`, `inspector_trace_events.cc` in `raw/verify/09/cr/`).
- All 19 V8 commits cited in item Status lines (plus b71404f1c8) fetched from the GitHub API (`gh-*.json`) and mapped to milestones with chromiumdash `fetch_commit` (`cd-*.json`). Every commit exists and every milestone in the notes matches chromiumdash (106, 108, 110, 111, 122, 135, 137, 143, 147, 149, 150, 151, 152, 153, 154, 156). Commits e8301c0028 and bfe12807c1 (listed only in "Sources read") were not checked.
- chromiumdash schedule: Chrome 154 stable 2026-09-22 (154.0.8037.57/.58), 155 on 2026-10-06, 156 on 2026-10-20. Chrome blog 2026-03-03 confirms the 2-week cadence from Chrome 153.
- Emscripten `settings.js` and `ChangeLog.md` (6.0.10, 2026-09-21), Terser CHANGELOG, Vite 8.3 docs, Rolldown docs, esbuild docs, Svelte docs, TypeScript docs, v8.dev posts (fetched), chromestatus API, blink-dev archive, Safari 27 release notes (saved by an earlier checker in `raw/verify/02/safari27.txt`).

Key corrections (details under each item):
1. **Object spread vs `Object.assign`** (disputed): V8 has a fast clone path for `Object.assign({}, src)` since Chrome 129.
2. **`import defer`**: Chrome 155 approved (LGTM3 2026-09-16); Safari only in Technology Preview, not "shipping".
3. **Code-cache invalidation**: `Version::Hash()` includes the V8 patch number, so weekly security updates also cause cold compiles, not only the 2-week milestones.
4. **Public class fields**: Baseline widely available since 2025-03-12 (not 2022-09-12).
5. **`Intl.NumberFormat.formatRange`**: Chrome 106, Firefox 116, Safari 15.4 (the quoted 76/91/14.1 is DateTimeFormat).
6. **Document-Isolation-Policy**: chromestatus ship stage lists Android 146, not desktop only.
7. **JSON data block**: the Do line lost its escape; it must say escape `<` as `\u003c`.
8. **Trace names**: `cacheProduceOptions`/`cacheConsumeOptions` and `wasm.TopTierFinished` are not in current source.
9. **Inline sort**: the one-elements-kind condition arrived in Chrome 153, not 149.
10. **Linear regexp engine**: it now handles non-capturing lookbehinds; still no `i`/`u`/`v` or backreferences.

---

### Give all objects of one kind one creation path: same properties, same order, same site
- Verdict: verified
- Evidence: https://v8.dev/blog/system-analyzer ("Snippet 1 runs approximately 3 times faster than snippet 2") ; https://github.com/v8/v8/blob/main/src/objects/js-data-object-builder.cc (`InitializeMapFromZero` starts JSON.parse objects from `ObjectLiteralMapFromCache`, the same root map family as object literals) ; https://mathiasbynens.be/notes/shapes-ics

### Declare every field at construction time; never add properties after hot code has used the shape
- Verdict: verified
- Evidence: https://github.com/v8/v8/blob/main/src/objects/map.h (`kSlackTrackingCounterStart = 7`, `kSlackTrackingCounterEnd = 1`) ; https://github.com/v8/v8/blob/main/src/objects/js-function.cc (`expected_nof_properties += 8`, capped at `JSObject::kMaxInObjectProperties`) ; https://github.com/v8/v8/blob/main/src/objects/js-objects.h (`kInitialGlobalObjectUnusedPropertiesCount = 4`; `kMaxInObjectProperties = (kMaxInstanceSize - kHeaderSize) >> kTaggedSizeLog2`, 252 with 4-byte slots) ; https://v8.dev/blog/slack-tracking

### Never use `delete` on objects that hot code reads; assign `undefined` or build a new object
- Verdict: verified
- Evidence: https://github.com/v8/v8/commit/389ea9be7d ("[runtime] Drop fast last-property deletion ... interacts badly with other optimizations", 2024-01-11) ; https://chromiumdash.appspot.com/fetch_commit?commit=389ea9be7d68 (earliest 122.0.6244.0)

### Use `Map`/`Set` for dynamic keys; keep plain objects for fixed-shape records
- Verdict: verified
- Evidence: https://github.com/v8/v8/blob/main/src/objects/map-inl.h (`Map::TooManyFastProperties`: returns false for non-keyed stores and prototype maps; limit = max(`fast_properties_soft_limit`, in-object count)) ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`fast_properties_soft_limit` 12) ; https://github.com/v8/v8/blob/main/src/objects/property-details.h (`kMaxNumberOfDescriptors = (1 << 10) - 4` = 1020) ; https://github.com/v8/v8/blob/main/src/heap/factory.cc (`ObjectLiteralMapFromCache`: `number_of_properties >= kMapCacheSize` (128) returns the slow-object map; JSON.parse uses the same function) ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`map`, `set`: high 2018-01-29)

### Attach side data to objects through a `Map`/`WeakMap` keyed by the object, never through expando ids or properties
- Verdict: verified
- Evidence: https://v8.dev/blog/hash-code ; https://v8.dev/features/weak-references ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`weakmap` high 2018-01-29, Chrome 36, Firefox 6, Safari 8)

### Never modify built-in prototypes at runtime, and never change an object's prototype after creation
- Verdict: verified
- Evidence: https://mathiasbynens.be/notes/prototypes ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/setPrototypeOf ("a very slow operation in every browser and JavaScript engine")

### Keep hot property-access sites monomorphic: one shape and one elements kind per site
- Verdict: verified
- Evidence: https://github.com/v8/v8/commit/f2c89563c0 (`DEFAULT_MAX_POLYMORPHIC_MAP_COUNT` 4 -> 10, "jetstream 3 total score increase is ~1%"; chromiumdash earliest 154.0.8027.0, stable 154.0.8037.21) ; https://github.com/v8/v8/commit/ab86d353fe (homomorphic LoadIC state, "Maglev/Turbolev to inline the handler, Turbofan will just do a megamorphic lookup"; earliest 147.0.7715.0) ; https://github.com/v8/v8/commit/77b7016561 (moves `homomorphic_ic` to shipped feature flags; earliest 156.0.8061.0) ; https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=156 (stable 2026-10-20) ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (value 10 still in `main` 2026-09-23)

### Copy plain objects with object spread, not an `Object.assign` helper; keep spread sources plain data objects
- Verdict: disputed
- Correction: The premise that `Object.assign` lacks a fast path is out of date. Since Chrome 129 (V8 commit b71404f1c8, "Re-enable Object.assign fastcase", 2024-08-06), `Object.assign(target, src, …)` clones the first source with `FastCloneJSObject` when the target is a fresh empty `{}` from the current realm and the source is a fast JSObject with a compatible layout (cached through a side-step transition, `clone_object_sidestep_transitions` default true). So `Object.assign({}, state, { filter })` is no longer a known slow pattern. Keep spread as the idiomatic default, but drop "not an `Object.assign` helper" and "Do not let a transpiler lower object spread to `Object.assign`" as performance rules; no primary source measures a gap between the two in current V8. The CloneObject IC part (`GetCloneModeForMap` in `ic.cc`) is correct.
- Evidence: https://github.com/v8/v8/blob/main/src/builtins/builtins-object-gen.cc (`TF_BUILTIN(ObjectAssign…)`: "First let's try a fastpath specifically for when the target objects is an empty object literal") ; https://github.com/v8/v8/commit/b71404f1c8 ; https://chromiumdash.appspot.com/fetch_commit?commit=b71404f1c80e29afa075ff7269893c3b8137c528 (earliest 129.0.6642.0) ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`clone_object_sidestep_transitions`, true) ; https://github.com/v8/v8/blob/main/src/ic/ic.cc (`GetCloneModeForMap`)

### Keep `Proxy` objects out of hot data paths: unwrap before loops, never proxy large numeric data
- Verdict: corrected
- Correction: The 2017 post does not say "up to 5x faster calls" in those words and does not mention "5 of the 13 traps" for for-in. Use the post's figures: construct 49-74% faster, calls "up to 500%" faster, `has` 71-428%, `set` 27-438%. Mark the for-in trap count as unsourced (or drop it). The rest is correct: the fast proxy IC is commit be455d8278 (first build 150.0.7865.0), `DEFINE_BOOL(fast_proxy_ic, false, …)` with `DEFINE_WEAK_IMPLICATION(future, fast_proxy_ic)` in `main` on 2026-09-23.
- Evidence: https://v8.dev/blog/optimizing-proxies (published 2017-10-05) ; https://github.com/v8/v8/commit/be455d8278 ; https://chromiumdash.appspot.com/fetch_commit?commit=be455d82789a ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`proxy-reflect` high 2019-03-20)

### In Svelte 5, hold large or numeric datasets in `$state.raw`, typed arrays or class instances, not in deep `$state`
- Verdict: verified
- Evidence: https://svelte.dev/docs/svelte/$state ("State is proxified recursively until Svelte finds something other than an array or simple object"; "Class instances are not proxied"; `$state.raw` "can improve performance with large arrays and objects"; `$state.snapshot` for libraries "that don't expect a proxy")

### Diagnose shapes, ICs and deopts with natives syntax, Indicium and V8 log flags
- Verdict: corrected
- Correction: The IC legend is incomplete for current V8. `IC::TransitionMarkFromState` in `ic.cc` prints: `X` no feedback, `0` uninitialized, `1` monomorphic, `^` recompute handler, `P` polymorphic, `H` homomorphic (new; default-on from Chrome 156), `N` megamorphic, `D` MegaDOM, `G` generic. Add `H`, because Chrome 156+ logs will contain it. The legend is not in the Indicium post; cite `ic.cc`. Also note that `--log-deopt` and `--trace-deopt` are `DEFINE_DEVELOPER_FLAG`s (they are refused when `--disallow-developer-only-features` is set). `v8.dev/tools/head/system-analyzer` now 301-redirects to the v8.github.io URL in the note.
- Evidence: https://github.com/v8/v8/blob/main/src/ic/ic.cc (`TransitionMarkFromState`) ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`log_maps`, `log_ic`, `log_deopt` developer flag) ; https://v8.dev/blog/system-analyzer ; https://v8.github.io/tools/head/system-analyzer/ (HTTP 200)

### Keep each array in its most specific elements kind, and know which writes generalize it
- Verdict: corrected
- Correction: "21 kinds" is the 2017 post's count ("V8 currently distinguishes 21 different elements kinds"). V8 `main` has `kElementsKindCount` = 42 (it adds NONEXTENSIBLE/SEALED/FROZEN, SHARED_ARRAY, string-wrapper, Float16 and the 12 RAB/GSAB typed-array kinds). Say "six fast kinds matter here (PACKED/HOLEY × SMI/DOUBLE/ELEMENTS) out of about 40". The transition rules are correct.
- Evidence: https://v8.dev/blog/elements-kinds ; https://github.com/v8/v8/blob/main/src/objects/elements-kind.h (`enum ElementsKind`, `kElementsKindCount = LAST_ELEMENTS_KIND - FIRST_ELEMENTS_KIND + 1`)

### Build arrays without holes; pre-size with `new Array(n).fill(v)` or a typed array
- Verdict: verified
- Evidence: https://github.com/v8/v8/commit/785a0f64 ("Array.fill tries to transition to optimal elements kind … allows going backwards … only supported for the initial JSArray maps", 2025-02-28; chromiumdash earliest 135.0.7043.0) ; https://v8.dev/blog/elements-kinds ("There is now an exception to this for `Array.prototype.fill` specifically")

### Never use arrays as sparse maps, and never give array indices non-default attributes
- Verdict: verified
- Evidence: https://v8.dev/blog/fast-properties ; https://github.com/v8/v8/blob/main/src/objects/elements-kind.h (frozen/sealed kinds exist only for ELEMENTS). The 1024 gap is a local test; it matches V8's `kMaxGap` heuristic.

### Never read past the end of an array: loop with `i < length`
- Verdict: verified
- Evidence: https://v8.dev/blog/elements-kinds ("Fixing the termination condition to the proper `i < array.length` yields a 6× performance improvement"; "the performance of both `for-of` and `forEach` is on par with the old-fashioned `for` loop")

### Use real arrays and rest parameters instead of `arguments` and array-likes
- Verdict: verified
- Evidence: https://v8.dev/blog/elements-kinds ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`destructuring`, `spread` high 2022-07-15)

### Store bulk numeric series in typed-array columns (struct of arrays), not arrays of objects
- Verdict: verified
- Evidence: https://v8.dev/blog/pointer-compression ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (only `unbox_double_arrays` exists; no `unbox_double_fields`) ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`typed-arrays` high 2018-01-29). Memory numbers are local Node measurements, not re-run.

### Freeze constant lookup arrays freely, but never freeze numeric arrays
- Verdict: verified
- Evidence: https://v8.dev/blog/react-cliff ("we've fixed this performance cliff in V8 v7.4") ; https://github.com/v8/v8/blob/main/src/objects/elements-kind.h (PACKED/HOLEY_NONEXTENSIBLE/SEALED/FROZEN exist only for ELEMENTS) ; https://v8.dev/blog/v8-release-76

### Decode and encode mixed-type binary data with `DataView`, and always pass `littleEndian`
- Verdict: verified
- Evidence: https://v8.dev/blog/dataview (V8 v6.9; "16 times as fast"; "up to 3 times as fast as the Uint8Array wrapper"; near-TypedArray speed "when accessing data aligned in the native endianness") ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`float16array` low 2025-04-04: Chrome 135, Firefox 129, Safari 18.2; includes `DataView.getFloat16`/`setFloat16`)

### In hot decode loops, check bounds yourself and call fixed DataView methods
- Verdict: verified
- Evidence: https://v8.dev/blog/dataview (removed "support for indices or offsets that are too large (outside of Smi range)" from optimized code; "deoptimizing back to the baseline Torque implementation when we need to throw") ; https://github.com/v8/v8/blob/main/include/v8-internal.h (`kSmiValueSize = 31` with pointer compression)

### Grow CPU-side binary buffers with a resizable `ArrayBuffer`, and hand them over with a same-length `transfer()`
- Verdict: verified
- Evidence: https://github.com/v8/v8/blob/main/src/builtins/builtins-arraybuffer.cc ("Case 2: We can reuse the same BackingStore" only if the source is not resizable, the result is not resizable and `new_byte_length == GetByteLength()`; else "Case 3 … Copy the buffer") ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`resizable-buffers` low 2024-07-09: Chrome 111, Firefox 128, Safari 16.4; `transferable-arraybuffer` high 2026-09-05)

### Never pass views over resizable buffers to WebGL or WebGPU uploads; stage GPU data in fixed-length buffers
- Verdict: verified
- Evidence: https://registry.khronos.org/webgl/specs/latest/2.0/webgl2.idl and 1.0/webgl.idl (no `[AllowResizable]`, only `[AllowShared]`) ; https://gpuweb.github.io/gpuweb/ (no `[AllowResizable]`; `writeBuffer` takes `AllowSharedBufferSource`) ; https://webidl.spec.whatwg.org/#AllowResizable ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/ChangeLog.md (6.0.3, 2026-07-13: "The default value for `GROWABLE_ARRAYBUFFERS` was reverted to `0` since we found issues with Web API compatibility")

### Keep hot integers inside the 31-bit Smi range; store large values in typed arrays or as offsets
- Verdict: verified
- Evidence: https://github.com/v8/v8/blob/main/include/v8-internal.h (`kSmiValueSize = 31` for compressed builds, 32 otherwise) ; https://v8.dev/blog/react-cliff ("the first loop is easily twice as fast") ; https://v8.dev/blog/pointer-compression

### Initialize numeric fields with a number of their final kind (`NaN` for doubles), never with `null` or `undefined`
- Verdict: verified
- Evidence: https://v8.dev/blog/react-cliff (React initializes with `Number.NaN` to get Double representation) ; https://v8.dev/blog/mutable-heap-number. Benchmark numbers are local.

### In TypeScript, never leave numeric class fields uninitialized when `useDefineForClassFields` is on
- Verdict: verified
- Evidence: https://www.typescriptlang.org/tsconfig/#useDefineForClassFields (default "`true` if target is ES2022 or higher, or target is ESNext; false otherwise") ; https://esbuild.github.io/content-types/ (esbuild copies the same default)

### Keep numeric variables type-stable: accumulators, top-level `let` bindings and return values
- Verdict: verified
- Evidence: https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`script_context_cells` true, `function_context_cells` true, `function_context_cells_max_size` 2, `maglev_untagged_phis` true) ; https://v8.dev/blog/mutable-heap-number. Chrome milestones for the 2024-11/2025-01/2025-05 commits remain estimates, as the note says.

### Keep integer state in signed Int32 with `| 0` and `Math.imul`; use `>>> 0` only on temporaries
- Verdict: verified
- Evidence: https://v8.dev/blog/mutable-heap-number (Int32 slots; PRNG example) ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h

### Use Number for prices, sizes and millisecond timestamps; use BigInt only for true 64-bit integers and convert at the boundary
- Verdict: verified
- Evidence: https://v8.dev/blog/bigint ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`bigint` high 2023-03-16). Loop timings are local.

### When BigInt is required in hot code, keep values in the 64-bit range with `BigInt64Array` and `BigInt.asIntN/asUintN(64, …)`
- Verdict: verified
- Evidence: https://github.com/v8/v8/commit/fced4e9e35 (2022-09-29, earliest 108.0.5331.0) ; https://github.com/v8/v8/commit/b53f4d8247 (2022-12-16, earliest 111.0.5483.0) ; https://github.com/v8/v8/commit/ae67ffb8a7 ("[maglev] Specialize BigInt operations", 2026-06-16, earliest 151.0.7896.0) ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`bigint64array` high 2024-03-20)

### Decode 64-bit wire fields that fit in 53 bits as two `getUint32` reads, not `getBigUint64` plus `Number()`
- Verdict: verified
- Evidence: https://v8.dev/blog/bigint ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`bigint64array` group includes DataView BigInt methods, high 2024-03-20). The 12x figure is a local measurement.

### Create each `Intl` formatter once per (locale, options) and reuse it; never pass options to `toLocaleString` in hot code
- Verdict: corrected
- Correction: Status line: "`formatRange` Chrome 76, Firefox 91, Safari 14.1" is `Intl.DateTimeFormat.prototype.formatRange` only. `Intl.NumberFormat.prototype.formatRange` is Chrome 106, Firefox 116, Safari 15.4 (BCD). Write both. The cache rule is correct: `intl-objects.cc` and `js-date-time-format.cc` cache only when `(IsString(locales) || IsUndefined(locales)) && IsUndefined(options)`, and `isolate.cc` keeps one entry per cache type.
- Evidence: @mdn/browser-compat-data 8.1.2 (2026-09-17) (`javascript.builtins.Intl.NumberFormat.formatRange`: Chrome 106, Firefox 116, Safari 15.4; `…DateTimeFormat.formatRange`: Chrome 76, Firefox 91, Safari 14.1) ; https://github.com/v8/v8/blob/main/src/objects/intl-objects.cc (`Intl::NumberToLocaleString`, `can_cache`) ; https://github.com/v8/v8/blob/main/src/execution/isolate.cc (`set_icu_object_in_cache`)

### Sort strings with option-free `localeCompare` or with one reused `Intl.Collator`
- Verdict: verified
- Evidence: https://github.com/v8/v8/blob/main/src/objects/intl-objects.cc (`CompareStringsOptionsFor` returns kNone when options are defined; `kFastLocales` = en-US, en, fr, es, de, pt, it, ca, de-AT, fi, id, id-ID, ms, nl, pl, ro, sl, sv, sw, vi, en-DE, en-GB) ; https://github.com/v8/v8/blob/main/src/builtins/builtins-intl.cc (`CollatorInternalCompare` calls `Intl::CompareStrings` with default options, so no fast path)

### Use built-in `Intl` APIs instead of shipping formatting libraries and locale data
- Verdict: verified
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json): `intl-relative-time-format` high 2023-03-16; `intl-list-format` high 2023-10-26; `intl-plural-rules` high 2022-03-19; `intl-segmenter` low 2024-04-16 (Firefox 125); `intl-duration-format` low 2025-03-04. So all six listed constructors are Baseline (Segmenter only newly). https://v8.dev/blog/intl

### Keep machine-generated strings (keys, ids, protocol fields) ASCII or Latin-1
- Verdict: verified
- Evidence: https://v8.dev/blog/json-stringify ("a new two-byte stringifier is created, inheriting the current state"; fast-json-iterable needs keys with no escaping; V8 13.8 / Chrome 138) ; https://v8.dev/blog/scanner

### Declare instance state as native class fields and compile TypeScript to ES2022 or later
- Verdict: corrected
- Correction: Status date is wrong: public class fields became Baseline newly available on 2022-09-12 and widely available on 2025-03-12 (Safari 16 is the first full version; 14-15.x partial). Private fields: widely since 2024-01-13; private methods: widely since 2024-03-20 (so "private fields and methods earlier" is right). Everything else holds (V8 9.7 / Chrome 97, `DefineNamedOwnIC`/`DefineKeyedOwnIC`).
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`class-syntax`, `by_compat_key`: `javascript.classes.public_class_fields` low 2022-09-12 / high 2025-03-12; `private_class_fields` high 2024-01-13; `private_class_methods` high 2024-03-20) ; @mdn/browser-compat-data 8.1.2 (2026-09-17) (`public_class_fields`: Safari 16, 14-16 partial) ; https://v8.dev/blog/faster-class-features

### Keep instance initialization predictable: one owner per field, no proxy or return override from a base constructor
- Verdict: verified
- Evidence: https://v8.dev/blog/faster-class-features

### Call `super()` directly in the constructor of derived classes that have private methods
- Verdict: verified
- Evidence: https://v8.dev/blog/faster-class-features

### Use named `super.x` and `super.m()` freely; keep keyed super access and super writes out of hot code
- Verdict: verified
- Evidence: https://v8.dev/blog/fast-super ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`DEFINE_BOOL(super_ic, true, …)`) ; https://github.com/v8/v8/blob/main/src/interpreter/bytecode-generator.cc

### Do not build hot class hierarchies from mixin factories
- Verdict: verified
- Evidence: https://v8.dev/blog/fast-super ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (polymorphic limit 10)

### Pass only the arguments you have; do not pad calls to the declared parameter count
- Verdict: verified
- Evidence: https://v8.dev/blog/adaptor-frame (V8 v8.9 / Chrome 89; "up to 40% speedup" in optimized code, 11.2% in the interpreter)

### Keep hot-loop variables local and create closures outside hot loops
- Verdict: verified
- Evidence: https://v8.dev/blog/preparser ; https://v8.dev/blog/holiday-season-2023 (mechanism-derived rule, as the note says)

### Write `let` and `const`; do not hand-convert declarations to `var` for speed
- Verdict: verified
- Evidence: https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`ignition_elide_redundant_tdz_checks` true, "elide TDZ checks dominated by other TDZ checks") ; https://v8.dev/blog/holiday-season-2023 ("eliding some redundant temporal dead zone checks"). The 8-12% TypeScript figure is not in the holiday post; it rests on the v8-reviews thread only.

### Use `const` for values that never change, and do not reassign module-level state that hot code reads
- Verdict: verified
- Evidence: https://v8.dev/blog/maglev ("Maglev can load the value at compile time and embed it directly into the machine code; if the runtime ever mutates that global, it'll also take care to invalidate and deoptimize") ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`script_context_cells` true)

### Do not create Errors, throw for expected outcomes, or read `error.stack` on hot paths
- Verdict: verified
- Evidence: https://v8.dev/blog/v8-release-78 (lazy source positions, 1-2.5% memory) ; https://github.com/v8/v8/blob/main/BUILD.gn (`v8_enable_lazy_source_positions = true`) ; @mdn/browser-compat-data 8.1.2 (2026-09-17) (`Error.stackTraceLimit` standard_track false; Chrome 3, Firefox 153, Safari 11.1)

### Write async code with `async`/`await` on native promises; no promise polyfills, subclasses or custom thenables
- Verdict: verified
- Evidence: https://v8.dev/blog/fast-async ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`async-await` high 2019-10-05)

### Write `return await p` in async functions when latency or ordering matters
- Verdict: verified
- Evidence: https://github.com/tc39/proposal-faster-promise-adoption (README: "Status: Stage 1") ; https://v8.dev/blog/fast-async

### Start independent async work together and await it with `Promise.all`; use `Array.fromAsync` only for true async streams
- Verdict: verified
- Evidence: https://rolldown.rs/in-depth/tla-in-rolldown ("it will change the original code's behavior from concurrent to sequential") ; https://v8.dev/blog/fast-async (Promise.all 8x faster from V8 5.5 to 6.8; the note's "in V8 6.8" is the cumulative gain) ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`array-fromasync` high 2026-07-25; `promise-allsettled` high 2023-01-28)

### Keep hot synchronous helpers synchronous; never `for await` over plain arrays
- Verdict: verified
- Evidence: https://tc39.es/ecma262/ (CreateAsyncFromSyncIterator) ; https://v8.dev/blog/fast-async

### Break long script work into chunks and yield with `scheduler.yield()`, not with resolved promises
- Verdict: corrected
- Correction: Status is right (Chrome/Edge 129, Firefox 142, no Safari; Baseline limited). The fallback is the weak part: the only engine that takes the fallback is Safari, and a `setTimeout(r, 0)` fallback inside a yield loop becomes a nested timer and is clamped to 4 ms (WebKit `DOMTimer.cpp`: one-shot timers clamp from nesting level 10). Use a `MessageChannel`/`postMessage` fallback, which has no clamp (the event-loop notes, file 06, already recommend it): `const ch = new MessageChannel(); const q = []; ch.port1.onmessage = () => q.shift()(); const yieldToMain = () => globalThis.scheduler?.yield ? scheduler.yield() : new Promise(r => { q.push(r); ch.port2.postMessage(0); });`.
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`scheduler` limited: Chrome 129, Firefox 142) ; @mdn/browser-compat-data 8.1.2 (2026-09-17) (`api.Scheduler.yield`, Safari false) ; https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers ; https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/DOMTimer.cpp (`maxTimerNestingLevelForOneShotTimers = 10`, `defaultMinimumInterval() 4_ms`) ; verify/06-js-event-loop-and-scheduling.verify.md (cross-file conflicts)

### Keep top-level `await` out of shared modules; await only in the entry module or behind an exported init function
- Verdict: verified
- Evidence: https://api.webstatus.dev/v1/features/top-level-await (newly, low_date 2026-09-14) ; @mdn/browser-compat-data 8.1.2 (2026-09-17) (`javascript.operators.await.top_level`: Safari 27; Safari 15-26 partial, "Doesn't support multiple modules simultaneously importing a module containing a top-level await", webkit.org/b/242740) ; Safari 27 release notes ("complete standards-compliant rewrite of the ECMAScript module (ESM) loader … Fixing Top-Level Await in Safari")

### Emit ESM output when any module uses top-level await
- Verdict: verified
- Evidence: https://esbuild.github.io/content-types/ ("bundling code containing top-level await is only supported when the output format is set to esm") ; https://rolldown.rs/in-depth/tla-in-rolldown ("could only be bundled and emitted with esm format")

### Do not treat `DOMContentLoaded` or `load` as "app ready" when entry modules use top-level await; publish a ready signal
- Verdict: verified
- Evidence: https://html.spec.whatwg.org/multipage/webappapis.html#run-a-module-script ; https://html.spec.whatwg.org/multipage/scripting.html#execute-the-script-element

### In module workers, attach the message handler before the first top-level `await`
- Verdict: verified
- Evidence: https://html.spec.whatwg.org/multipage/workers.html#run-a-worker ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`js-modules-workers` high 2025-12-06)

### Never block or spin on the main thread; use `Atomics.waitAsync` or read shared state once per frame
- Verdict: verified
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`atomics-wait-async` low 2025-11-11: Chrome 90, Firefox 145, Safari 16.4; `shared-memory` high 2024-06-13) ; https://html.spec.whatwg.org/multipage/webappapis.html#hostenqueuegenericjob ; https://v8.dev/features/atomics

### Enable `SharedArrayBuffer` with cross-origin isolation, check `crossOriginIsolated`, and keep a transfer fallback
- Verdict: corrected
- Correction: "Document-Isolation-Policy is Chrome desktop only" / "Chrome 137 desktop" is stale. chromestatus lists the ship stage as desktop 137 and Android 146 (`android_first: 146`); the Chrome blog said Android support was planned for M146. File 07 already says "Chrome desktop 137, Chrome Android 146". Write: "Document-Isolation-Policy: Chrome desktop 137, Android 146 (chromestatus; still 'In development' in the status field); not in Firefox (positive) or Safari (negative)". COOP/COEP (Chrome 83, Firefox 79, Safari 15.2) and `credentialless` (Chrome 96, Firefox 119 desktop only, no Safari) are correct.
- Evidence: https://chromestatus.com/feature/5141940204208128 (API JSON: ship stage desktop_first 137, android_first 146; Firefox 'Positive', Safari 'Negative') ; https://developer.chrome.com/blog/document-isolation-policy ; @mdn/browser-compat-data 8.1.2 (2026-09-17) (`http.headers.Cross-Origin-Embedder-Policy.credentialless`: Chrome 96, Firefox 119, Firefox Android false, Safari false)

### Stream worker data through a single-producer, single-consumer ring buffer: Atomics on head and tail only, plain access for the payload
- Verdict: verified
- Evidence: https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics-object ; https://tc39.es/ecma262/multipage/memory-model.html ; https://v8.dev/features/atomics

### If you need a lock, build a three-state futex on an `Int32Array`: `compareExchange`, a short `Atomics.pause()` spin in workers, then wait, retry and notify one
- Verdict: verified
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`atomics-pause` low 2025-04-01: Chrome 133, Firefox 137, Safari 18.4) ; https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics.pause ; https://v8.dev/features/atomics

### Give `Atomics.wait` a timeout in any worker that must also handle messages
- Verdict: verified
- Evidence: https://tc39.es/ecma262/multipage/structured-data.html#sec-atomics.wait ; https://v8.dev/features/atomics

### Ship less JavaScript at startup; load non-critical features with dynamic `import()` at the moment of user intent
- Verdict: verified
- Evidence: https://v8.dev/blog/cost-of-javascript-2019 ("the dominant costs of processing scripts are now download and CPU execution time"; "if a bundle exceeds ~50–100 kB, split it up"; Reddit "3–4× longer for a median phone (Moto G4)") ; @mdn/browser-compat-data 8.1.2 (2026-09-17) (dynamic `import()`: Chrome 63, Firefox 67, Safari 11.1)

### Keep bundling and code splitting for production; write small modules and import only what you use
- Verdict: verified
- Evidence: https://v8.dev/features/modules (unbundled only for "less than 100 modules in total" and depth "less than 5")

### Preload critical ES modules with `rel="modulepreload"`, never with `rel="preload" as="script"`
- Verdict: verified
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`modulepreload` high 2026-03-18: Chrome 66, Firefox 115, Safari 17) ; https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/bindings/core/v8/script_streamer.cc (`NotStreamingReason::kErrorScriptTypeMismatch`)

### Reference startup scripts with `<script src>` (or a preload) so Chrome streams and compiles them off the main thread
- Verdict: corrected
- Correction: The V8 v7.8 post measures "perceptible compilation time", not script-tag-to-run time: "perceptible compilation time dropped, on average, by 5–20%". Replace the Impact wording accordingly. The rest is correct: `kMaximumLengthOfBOM = 4` and `kScriptTooSmall` below that; `kHasCodeCache` suppresses streaming.
- Evidence: https://v8.dev/blog/v8-release-78 ; https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/bindings/core/v8/script_streamer.cc (`constexpr uint32_t kMaximumLengthOfBOM = 4`, `kScriptTooSmall`, `kHasCodeCache`)

### Ship startup JavaScript as external UTF-8 http(s) files; never run large code through `eval`, `new Function`, inline scripts or `blob:` URLs
- Verdict: verified
- Evidence: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/common/features.cc (`kInlineScriptCache` and `kPrecompileInlineScripts` FEATURE_DISABLED_BY_DEFAULT) ; script_streamer.cc (accepts windows-1252, ISO-8859-1, US-ASCII, UTF-8; else `kEncodingNotSupported`) ; https://v8.dev/blog/code-caching-for-devs ("Script tags whose source is inline in the HTML … can't be cached")

### Design for the code cache: external files of at least 1 KiB, stable content-hashed URLs, and a separate vendor chunk
- Verdict: corrected
- Correction: "Each user gets a cold compile about every 2 weeks" understates it. V8 rejects cached data on any V8 version change, and `Version::Hash()` includes the patch number (`hash_combine(major_, minor_, build_, patch_)`). Chrome also ships weekly security updates between milestones (for example 153.0.8010.36 → .47 → .52 → .54 within two weeks, chromiumdash), and those usually carry V8 patch bumps. Write: "every Chrome update that changes the V8 version (each 2-week milestone and most weekly security updates) invalidates the JS and Wasm code caches". The rest is correct: `kHotHours = base::Hours(72)`, `kMinimalCodeLengthForNonInlineScript = 1024`.
- Evidence: https://github.com/v8/v8/blob/main/src/utils/version.h (`Hash()`) ; https://github.com/v8/v8/blob/main/src/snapshot/code-serializer.cc (`kVersionMismatch` when `version_hash != Version::Hash()`) ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/bindings/core/v8/v8_code_cache.cc ; https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Linux&num=6 ; https://developer.chrome.com/blog/chrome-two-week-release ("Chrome introduced a weekly security update … back in 2023")

### Keep the startup path deterministic, and run code that must be fast on repeat visits during the top-level run
- Verdict: verified
- Evidence: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/common/features.cc (`kLocalCompileHints` FEATURE_ENABLED_BY_DEFAULT) ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/bindings/core/v8/v8_script_runner.cc (`CompileModule`: "TODO(40286622): Compile hints for modules", local hints stripped for modules) ; https://v8.dev/blog/improved-code-caching ("20–40% reduction", Chrome 66, cache produced after top-level execution)

### Precache critical classic scripts in the service worker `install` event
- Verdict: verified
- Evidence: https://v8.dev/blog/code-caching-for-devs (install-time "full" cache assumes UTF-8 and a classic script; otherwise "discarded and replaced") ; v8_code_cache.cc ("If the resource is served from CacheStorage, generate the V8 code cache …")

### Mark one small core startup file with `//# allFunctionsCalledOnLoad`, and make the comment survive the build
- Verdict: verified
- Evidence: https://v8.dev/blog/explicit-compile-hints (2025-04-29: "//# allFunctionsCalledOnLoad at the top of the file"; "17 out of 20 showed improvements … 630 ms"; Chrome 136; "should be used sparingly") ; https://chromestatus.com/feature/5100466238652416 (ship stage 136 desktop and Android) ; https://chromestatus.com/feature/5153430045458432 ("Proposed", updated 2025-11-26) ; https://github.com/evanw/esbuild/issues/4247 (closed 2025-07-18; maintainer: use `banner`) ; v8_script_runner.cc keeps `kFollowCompileHintsMagicComment` for module compiles, so the hint also works on ES-module chunks

### Wrap only profiled startup-critical function expressions as PIFEs
- Verdict: verified
- Evidence: https://github.com/terser/terser/blob/master/CHANGELOG.md (v5.43.0: "`wrap_func_args` format option is now false by default") ; https://github.com/rolldown/rolldown/pull/5319 ("use PIFE for callbacks passed to `__esmMin` wrapper", closed 2025-07-24)

### Expect lazily compiled functions to compile on the main thread at their first call; keep the first-interaction path small
- Verdict: verified
- Evidence: https://v8.dev/blog/background-compilation ; https://v8.dev/blog/preparser

### Verify compile and code-cache behavior with a trace and V8 logs in a clean profile
- Verdict: corrected
- Correction: The trace field names are out of date. Current Blink `v8.compile` events carry `streamed`, `notStreamedReason`, and on cache use `consumedCacheSize`, `cacheRejected` and `cacheKind` (`full`/`normal`); cache production is a separate `v8.produceCache` event with `producedCacheSize`. `cacheProduceOptions`/`cacheConsumeOptions` (2019 post) no longer appear. Warm run = a `v8.produceCache` event; hot run = `v8.compile` with `consumedCacheSize` and `cacheRejected: false`. `--log-function-events` is correct.
- Evidence: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/inspector/inspector_trace_events.cc (`inspector_compile_script_event::Data`, `inspector_produce_script_cache_event::Data`) ; v8_code_cache.cc (`"v8.produceCache"`) ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`log_function_events`)

### Ship modern syntax untranspiled to Baseline targets; drop `nomodule` fallback bundles
- Verdict: verified
- Evidence: https://web.dev/articles/publish-modern-javascript ("no longer available in this location as it was out of date") ; https://web.dev/blog/browserslist-supports-baseline ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`js-modules` high 2020-11-09) ; https://vite.dev/config/build-options (Vite 8.3 `build.target` default `'baseline-widely-available'`)

### Minify production bundles: strip whitespace and comments, mangle local names, move legal comments out
- Verdict: verified
- Evidence: https://vite.dev/config/build-options (Vite v8.3.0: `build.minify` default "'oxc' for client build, false for SSR build"; `'esbuild'` deprecated) ; https://rolldown.rs/reference/OutputOptions.comments (default true keeps legal, annotation and JSDoc comments; other comments always removed) ; https://esbuild.github.io/api/#legal-comments ; https://v8.dev/blog/scanner

### Write identifiers in ASCII, and keep non-ASCII text in string data served as UTF-8
- Verdict: verified
- Evidence: https://v8.dev/blog/scanner ; https://esbuild.github.io/api/#charset

### Write module scripts without `defer`; use `async` only for independent modules; resolve assets with `import.meta.url`
- Verdict: verified
- Evidence: https://v8.dev/features/modules ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`js-modules-workers` high 2025-12-06; `import-maps` high 2025-09-27; `import-maps-multiple` limited: Chrome 133, Safari 18.4)

### Use dynamic `import()` for lazy evaluation today; re-check support before you rely on `import defer`
- Verdict: corrected
- Correction: Status is stale by a few days and "WebKit shipping" is wrong for released Safari. (1) Chrome: the Intent to Ship got LGTM3 on 2026-09-16 for Chrome 155 (desktop, Android, WebView); Chrome 155 stable is 2026-10-06. (2) Safari: only Safari Technology Preview (static `import defer` in STP 245, fixes in STP 251); Safari 27 release notes do not list it, and BCD 8.1.2 has Safari "preview". (3) Firefox: not shipped (Mozilla positive). (4) webstatus.dev: limited. Keep the "use `import()` today" rule; after 2026-10-06 it is Chromium-only.
- Evidence: http://www.mail-archive.com/blink-dev@chromium.org/msg17471.html (LGTM3, 2026-09-16, M155) ; https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=155 ; @mdn/browser-compat-data 8.1.2 (2026-09-17) (`javascript.statements.import.defer`: Safari preview, others false) ; https://api.webstatus.dev/v1/features/import-defer (limited) ; https://webkit.org/blog/17970/release-notes-for-safari-technology-preview-245/ ; https://webkit.org/blog/18194/release-notes-for-safari-technology-preview-251/

### Measure warm code after tier-up, not only first calls; know V8's tiers
- Verdict: verified
- Evidence: https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`invocation_count_for_feedback_allocation` 8; `invocation_count_for_maglev` 400, 1000 on ANDROID; `invocation_count_for_maglev_osr` 100; `invocation_count_for_turbofan` 3000; `invocation_count_for_osr` 500; `turbolev` false) ; https://v8.dev/blog/maglev (Sparkplug "41% improvement over Ignition" on Speedometer; Maglev "10x faster than TurboFan"; energy -10% on Speedometer) ; https://github.com/v8/v8/blob/main/BUILD.gn (`v8_enable_maglev` on arm, x64, arm64 and others). Note: the OSR values are interrupt-budget multipliers, so "100/500 iterations" is approximate.

### Test performance with the V8 optimizers turned off, because some users run without them
- Verdict: verified
- Evidence: https://blog.google/security/advancing-protection-in-chrome-on/ (2025-07-08: "Since Chrome 133, we've exposed this as a Site Setting") ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`disable_optimizing_compilers` negates turbofan, maglev, turbolev, `wasm_tier_up`, `wasm_dynamic_tiering`; implies `liftoff`; Sparkplug stays)

### Let temporary objects die young; do not keep them "just in case"
- Verdict: verified
- Evidence: https://v8.dev/blog/trash-talk (nursery → intermediate → old after a second survival) ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`DEFINE_EXPERIMENTAL_FEATURE(minor_ms, …)`)

### Reuse large buffers, not small objects; do not build object pools by default
- Verdict: verified
- Evidence: https://v8.dev/blog/trash-talk (mechanism-derived, as the note says)

### Do not store freshly allocated objects into long-lived containers every frame; write numbers into existing storage
- Verdict: verified
- Evidence: https://v8.dev/blog/trash-talk (write barrier, remembered set)

### Leave idle time in each frame: render on change and stop the loop when the chart is hidden
- Verdict: verified
- Evidence: https://v8.dev/blog/trash-talk ("The GC can post 'Idle Tasks' … in the spare time before the next frame") ; https://v8.dev/blog/free-garbage-collection

### Give every listener, timer and subscription a teardown, and drop references to big data when a view closes
- Verdict: verified
- Evidence: @mdn/browser-compat-data 8.1.2 (2026-09-17) (`addEventListener` `signal` option: Chrome 90, Firefox 86, Safari 15) ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`aborting` high 2021-09-25) ; https://v8.dev/features/weak-references ; https://v8.dev/blog/tracing-js-dom

### Create long-lived callbacks in small scopes that do not also hold large data
- Verdict: verified
- Evidence: https://v8.dev/features/weak-references (shared closure context example). Not re-checked in V8 source, as the note says.

### Use `WeakRef` and `FinalizationRegistry` only as a safety net, never for required cleanup or program logic; call `deref()` once per task
- Verdict: verified
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`weak-references` high 2023-10-26; `explicit-resource-management` limited: Chrome 134, Firefox 141; BCD `using`: Safari preview only) ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`handle_weak_ref_weakly_in_minor_gc` true) ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry

### Update large data sets incrementally instead of rebuilding them
- Verdict: verified
- Evidence: https://v8.dev/blog/trash-talk ("Concurrent marking and sweeping has reduced pause times in heavy WebGL games by up to 50%")

### Estimate Chrome object memory with 4-byte slots, and measure it in Chrome, not Node
- Verdict: verified
- Evidence: https://v8.dev/blog/pointer-compression ; https://github.com/nodejs/node/issues/55735 ("Pointer Compression and Isolate Groups", closed 2024-11-05) ; @mdn/browser-compat-data 8.1.2 (2026-09-17) (`performance.measureUserAgentSpecificMemory`: Chrome 89, experimental)

### Find leaks with heap-snapshot retaining paths, and name your callbacks
- Verdict: verified
- Evidence: https://developer.chrome.com/docs/devtools/memory ; https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots ; https://v8.dev/blog/tracing-js-dom

### Keep RegExp instances and `RegExp.prototype` unmodified, do not subclass RegExp in hot code, and keep `lastIndex` a non-negative integer
- Verdict: verified
- Evidence: https://github.com/v8/v8/blob/main/src/regexp/regexp-utils.cc (`IsUnmodifiedRegExp`: initial JSRegExp map, prototype map equals `regexp_prototype_map`, `exec` unchanged) ; https://v8.dev/blog/speeding-up-regular-expressions

### Create each distinct RegExp once; cache dynamic patterns; use string methods for literal checks
- Verdict: verified
- Evidence: https://github.com/v8/v8/commit/4b2ab5e9cf ("[regexp] Enable the single-tier pipeline by default", `regexp_tier_up_ticks` 1 → 0; chromiumdash earliest 152.0.7936.0) ; https://v8.dev/blog/regexp-tier-up ("Starting with V8 v7.9 (Chrome 79) we tier up regular expressions") ; https://github.com/v8/v8/blob/main/src/codegen/compilation-cache.h (`kGenerations = 2` for the RegExp sub-cache) ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`regexp-escape` low 2025-05-01)

### Use `test()` when you need only a yes/no answer
- Verdict: verified
- Evidence: https://github.com/v8/v8/blob/main/src/builtins/regexp-test.tq

### Anchor whole-string patterns and use the sticky flag for tokenizers
- Verdict: verified
- Evidence: https://v8.dev/blog/v8-release-78 ("V8 v7.8 brings a 20% improvement to the average-of-all-iterations subscore" on UniPoker)

### Write backtracking-safe patterns: no nested or overlapping quantifiers, anchors, and a cap on input length
- Verdict: corrected
- Correction: The linear-engine limits are partly out of date. In V8 `main` (`experimental-compiler.cc`, `CanBeHandledVisitor`): allowed flags are only `g`, `y`, `m`, `s` and the linear flag, so `i`, `u` and `v` patterns are never handled; backreferences are never handled; non-capturing lookbehinds ARE now handled (in non-global, non-sticky patterns), while lookaheads and capturing lookbehinds need the extra flag `--experimental-regexp-engine-capture-group-opt`; quantifier replication above 16 is rejected. The fallback itself is still `DEFINE_EXPERIMENTAL_FEATURE(enable_experimental_regexp_engine_on_excessive_backtracks)` with `regexp_backtracks_before_fallback` 50,000, so the advice (write safe patterns) stands.
- Evidence: https://github.com/v8/v8/blob/main/src/regexp/experimental/experimental-compiler.cc ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h ; https://v8.dev/blog/non-backtracking-regexp (2021: "Irregexp is orders of magnitude faster than the new engine on most common patterns")

### Escape user text with `RegExp.escape`, and run user-written patterns in a worker with a time limit
- Verdict: verified
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`regexp-escape` low 2025-05-01: Chrome 136, Firefox 134, Safari 18.2) ; https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/escape

### Call `JSON.stringify(value)` with no `replacer` and no `space` on hot paths
- Verdict: verified
- Evidence: https://v8.dev/blog/json-stringify ("more than twice as fast", V8 13.8 / Chrome 138; "No replacer or space arguments") ; https://github.com/v8/v8/blob/main/src/json/json-stringifier.cc (`CanUseFastStringifier`, "TODO(pthier): Support gap on fast-path") ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`json_stringify_fast_path` true)

### Serialize only plain objects and arrays: no class instances, `toJSON`, `Date`, `Map`, dictionary-mode objects or integer-like keys
- Verdict: verified
- Evidence: https://v8.dev/blog/json-stringify (no custom `toJSON`, no indexed properties, no `ConsString`-type strings) ; https://github.com/v8/v8/blob/main/src/json/json-stringifier.cc

### Serialize and parse arrays of same-shape records: same keys, same order, simple keys, stable value types
- Verdict: verified
- Evidence: https://github.com/v8/v8/commit/72a5044f96 ("Add direct layout fast path for homogeneous object arrays", 2026-07-08; chromiumdash earliest 152.0.7941.0) ; https://github.com/v8/v8/blob/main/src/json/json-parser.cc (`BuildJsonObject` fast path when `cont.fast_keys_matched`) ; https://v8.dev/blog/json-stringify (fast-json-iterable)

### Keep numeric JSON arrays free of `null` and strings so they parse to unboxed double arrays
- Verdict: verified
- Evidence: https://github.com/v8/v8/blob/main/src/json/json-parser.cc ; https://v8.dev/blog/v8-release-76

### Parse hot payloads without a reviver; if you need one, write an arrow function with exactly two parameters
- Verdict: verified
- Evidence: https://github.com/v8/v8/commit/be082f4011 ("Detect some cases where reviver has only 2 args … 36% reduction … still about five times slower than the fast parser"; earliest 143.0.7471.0) ; https://github.com/v8/v8/commit/2b6d499abb (earliest 143.0.7485.0) ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`json-raw` low 2025-03-31: Chrome 114, Firefox 135, Safari 18.4). The Chrome 152 timings are local.

### Ship large static data (10 kB or more) as JSON: `JSON.parse('…')`, a bundler JSON import, or a JSON module
- Verdict: verified
- Evidence: https://v8.dev/blog/cost-of-javascript-2019 ("1.7× as fast"; "objects of 10 kB or larger") ; https://vite.dev/config/shared-options (`json.stringify` default `'auto'`, "bigger than 10kB") ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`json-modules` low 2025-04-29: Chrome 123, Firefox 138, Safari 17.2) ; https://github.com/v8/v8/blob/main/src/heap/factory.cc (≥128 properties → slow map)

### Inline server data in HTML as a `<script type="application/json">` block and parse it with `JSON.parse`
- Verdict: corrected
- Correction: The Do line is garbled: it says "Escape every `<` in the JSON as `<`", which is a no-op (the escape sequence was lost; bytes on line 1787 are a literal `<`). Write: "Escape every `<` in the JSON as `\u003c`" (valid inside JSON strings, and `<` cannot appear outside strings in JSON). This removes `</script`, `<!--` and `<script` sequences that the HTML spec's restrictions for script contents forbid. The rest is correct.
- Evidence: https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements ; https://html.spec.whatwg.org/multipage/scripting.html#the-script-element (data block) ; https://v8.dev/features/subsume-json ; local check: `sed -n 1787p 09-v8-consolidated.md | od -c`

### Use for-in only on fast-mode objects with no integer-like keys and no enumerable prototype properties; define methods with class syntax
- Verdict: verified
- Evidence: https://v8.dev/blog/fast-for-in ; https://github.com/v8/v8/blob/main/src/codegen/code-stub-assembler.cc (`CheckEnumCache`, `CheckPrototypeEnumCache`)

### Never use for-in on arrays or on objects keyed by integers; use indexed loops, `Map`, or a typed array
- Verdict: verified
- Evidence: https://v8.dev/blog/fast-for-in ; https://github.com/v8/v8/blob/main/src/codegen/code-stub-assembler.cc

### Do not add or delete properties on an object inside its own for-in loop
- Verdict: verified
- Evidence: https://v8.dev/blog/fast-for-in

### Read known fields directly in hot loops; never call `Object.entries` or `Object.keys` per frame
- Verdict: verified
- Evidence: https://github.com/v8/v8/blob/main/src/builtins/builtins-object-gen.cc ; https://v8.dev/blog/fast-for-in. Ratios are local.

### Use native destructuring, spread, `for…of`, generators and async functions; do not desugar them by hand for speed
- Verdict: verified
- Evidence: https://v8.dev/blog/v8-release-78 ("object destructuring is as fast as the equivalent desugared variable assignment (in fact, we generate the same bytecode for both)") ; https://v8.dev/blog/high-performance-es2015

### Copy arrays with a leading spread or `Array.from`; spread `Set`s and Map keys or values, not Map entries
- Verdict: verified
- Evidence: https://v8.dev/blog/spread-elements ("roughly a 3× performance improvement … about 25% faster than the hand-written clone loop"; Sets "about 18× faster", Maps "about 14× faster"; "does not support spreading a map directly ([...map]) … neither fast path supports the entries() iterator"; `Array.from` without a mapping function behaves like spread; V8 v7.2)

### Never patch array or iterator built-ins
- Verdict: verified
- Evidence: https://v8.dev/blog/spread-elements

### Always pass a numeric comparator to `Array.prototype.sort` for numbers
- Verdict: verified
- Evidence: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort ; https://v8.dev/blog/array-sort

### Sort typed arrays with `.sort()` and no comparator; reverse for descending order
- Verdict: verified
- Evidence: https://github.com/v8/v8/blob/main/src/builtins/typed-array-sort.tq (no comparefn → `TypedArraySortFast`; with comparefn → `TypedArrayMergeSort` over a FixedArray) ; https://github.com/v8/v8/blob/main/src/runtime/runtime-typedarray.cc (`std::sort(…, CompareNum<ctype>)`)

### Write pure, consistent, cheap comparators: precompute sort keys and never change the array while it sorts
- Verdict: verified
- Evidence: https://v8.dev/blog/array-sort ; https://github.com/v8/v8/blob/main/third_party/v8/builtins/array-sort.tq

### Rely on stable sorting: remove index tie-breakers and "stable sort" helpers
- Verdict: verified
- Evidence: https://github.com/v8/v8/commit/8899b945f6 ("Sorting: TimSort --> PowerSort", 2026-04-20; chromiumdash earliest 149.0.7804.0; Chrome 149 stable 2026-06-02 per BCD) ; https://v8.dev/blog/array-sort

### Let the sort use presorted runs; insert single late items with a binary search
- Verdict: verified
- Evidence: https://github.com/v8/v8/commit/8899b945f6 ("same behavior on trivially-sorted inputs") ; https://v8.dev/blog/array-sort

### For small sorts in hot code, sort packed arrays with a comparator known at the call site
- Verdict: corrected
- Correction: The "all receiver maps share one elements kind" condition is newer than Chrome 149. Commit 66a3f1e94d (Chrome 149) inlined sort for PACKED arrays with length ≤ 16 and a known comparator (TurboFan: PACKED_SMI and PACKED_ELEMENTS; Maglev: all packed kinds). Commit e0562d87ad (2026-08-07, first build 153.0.7997.0) added the rule that mixed-kind feedback is not inlined, after a memory-safety bug where {PACKED_SMI, PACKED} feedback was unioned to PACKED_ELEMENTS. Write "Chrome 149+; the one-elements-kind requirement since Chrome 153".
- Evidence: https://github.com/v8/v8/commit/66a3f1e94d ; https://github.com/v8/v8/commit/e0562d87ad ("Require all receiver maps to agree on their elements kind before inlining") ; https://chromiumdash.appspot.com/fetch_commit?commit=e0562d87ad9c (earliest 153.0.7997.0)

### Sort scratch arrays in place; use `toSorted()` only when the original must not change
- Verdict: verified
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`array-by-copy` high 2026-01-04)

### Use iterator helpers for early-exit pipelines over large or lazy sources, not as a general loop replacement
- Verdict: verified
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`iterator-methods` low 2025-03-31: Chrome 122, Firefox 131, Safari 18.4) ; https://v8.dev/blog/holiday-season-2023 (iterator helpers were unshipped for a web-compat issue, then reshipped)

### Look up a `Map` once per operation: `get` and test for `undefined`, or `getOrInsertComputed`
- Verdict: verified
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`getorinsert` low 2026-02-14: Chrome 145, Firefox 144, Safari 26.2) ; @mdn/browser-compat-data 8.1.2 (2026-09-17) (`Map.getOrInsertComputed` same versions)

### Load `.wasm` with `WebAssembly.instantiateStreaming` on a `fetch()` response
- Verdict: verified
- Evidence: @mdn/browser-compat-data 8.1.2 (2026-09-17) (`webassembly.api.instantiateStreaming_static` / `compileStreaming_static`: Chrome 60, Firefox 58, Safari 15) ; https://v8.dev/blog/wasm-code-caching ; https://v8.dev/docs/wasm-compilation-pipeline. The SciChart loader detail was checked by the SciChart verify pass (verify/13-scichart.verify.md), not here.

### Serve `.wasm` with exactly `Content-Type: application/wasm` and a 2xx or 304 status
- Verdict: verified
- Evidence: https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/bindings/core/v8/v8_wasm_response_extensions.cc (`if (!response->ok())` → "HTTP status code is not ok"; `EqualIgnoringAsciiCase(response->ContentType(), "application/wasm")`, compared against ContentType() so parameters fail). Note: `ok()` means 200-299; a browser revalidation 304 reaches `fetch()` as the cached 200.

### Keep the `.wasm` URL and bytes stable between visits; version by content hash, never by a per-load query string
- Verdict: corrected
- Correction: "Since Chrome 153 updates come every 2 weeks" undercounts updates: weekly security updates (since 2023) also ship between milestones, and a V8 patch bump changes `Version::Hash()`. Write "each milestone (every 2 weeks) and most weekly security updates". The digest check is correct: Blink stores a 32-byte SHA-256 of the wire bytes (`kWireBytesDigestSize = 32`) and emits `v8.wasm.moduleCacheInvalidDigest` on mismatch.
- Evidence: https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/bindings/core/v8/v8_wasm_response_extensions.cc ; https://github.com/v8/v8/blob/main/src/utils/version.h ; https://developer.chrome.com/blog/chrome-two-week-release (Extended Stable "will continue with its existing eight-week cycle"; weekly security update since 2023)

### Expect the Wasm code cache to hold only hot, optimized code, and measure warm starts after a real session
- Verdict: verified
- Evidence: https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`wasm_caching_threshold` 1'000, `wasm_caching_timeout_ms` 2000, `wasm_caching_hard_threshold` 1'000'000) ; https://v8.dev/docs/wasm-compilation-pipeline ; https://v8.dev/blog/wasm-code-caching (2019: 128 kB threshold and "about 150 MB" cap, now historical)

### Compile and warm Wasm off the critical path: pre-compile in a worker or service worker, and exercise first-interaction code while idle
- Verdict: verified
- Evidence: https://v8.dev/blog/wasm-code-caching ("WebAssembly code caching is enabled for workers and service workers") ; https://github.com/v8/v8/commit/29131d5e3e ("Enable lazy compilation by default", 2022-11-14; earliest 110.0.5420.0)

### Put hot Wasm loops in functions that are called many times, not in one long call
- Verdict: verified
- Evidence: https://v8.dev/blog/wasm-dynamic-tiering ("V8 does not use on-stack-replacement for WebAssembly code, the execution can be stuck in a loop in Liftoff code") ; https://v8.dev/blog/liftoff ("around 50% slower than TurboFan code on the desktop machine and 70% slower on the MacBook")

### Keep Wasm binaries small and run Binaryen `wasm-opt` on every release build
- Verdict: verified
- Evidence: https://v8.dev/blog/wasm-gc-porting ("wasm-opt … on average making them 1.9× faster")

### Leave CPU headroom for background TurboFan compiles when you size worker pools
- Verdict: verified
- Evidence: https://v8.dev/blog/wasm-dynamic-tiering ("The CPU cores that execute TurboFan compilation in the background can block other tasks … e.g. workers of the web application") ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`wasm_num_compilation_tasks` 128)

### Measure Wasm at steady state with `v8.wasm` trace events, and never benchmark Wasm with DevTools open
- Verdict: corrected
- Correction: `wasm.TopTierFinished` was not found in V8 `main` (`src/wasm/module-compiler.cc` emits `wasm.BaselineFinished`, `wasm.CompilationChunkFinished` and `wasm.OnFinishedUnits`; no module-wide top-tier event exists under dynamic tiering, because only hot functions tier up). Drop `wasm.TopTierFinished`; to see tier-up, look for TurboFan compile jobs in the `v8.wasm` category or use the developer flag `--trace-wasm-compilation-times` via `--js-flags`. The Blink event names are correct: `v8.wasm.compiledModule`, `v8.wasm.cachedModule`, `v8.wasm.moduleCacheHit`, `v8.wasm.moduleCacheInvalid`, `v8.wasm.moduleCacheInvalidDigest` (category `disabled-by-default-devtools.timeline`).
- Evidence: https://github.com/v8/v8/blob/main/src/wasm/module-compiler.cc ; https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/bindings/core/v8/v8_wasm_response_extensions.cc ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`trace_wasm_compilation_times` developer flag) ; https://v8.dev/docs/wasm-compilation-pipeline

### Compile compute-heavy Wasm with SIMD (`-msimd128`, Rust `+simd128`) and ship one SIMD build for Baseline targets
- Verdict: verified
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`wasm-simd` high 2025-09-27: Chrome 91, Firefox 89, Safari 16.4) ; https://v8.dev/features/simd (MediaPipe "14-15 FPS" vs "38-40 FPS"; `-msimd128`, `+simd128`)

### Hand-write SIMD intrinsics for the hottest kernels, and avoid SIMD operations that are slow on x86
- Verdict: verified
- Evidence: https://emscripten.org/docs/porting/simd.html ; https://v8.dev/features/simd. Rust `core::arch::wasm32` SIMD intrinsics are stable since Rust 1.54 (2021).

### Use relaxed SIMD only for visual output that may differ between machines, behind feature detection
- Verdict: verified
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`wasm-simd-relaxed` limited: Chrome 114, Firefox 146, no Safari) ; https://github.com/WebAssembly/relaxed-simd/blob/main/proposals/relaxed-simd/Overview.md (20 instructions: swizzle 1, trunc 4, madd/nmadd 4, laneselect 4, min/max 4, q15mulr 1, dot 2)

### Keep hot indirect calls monomorphic and hot callees small so V8 can inline them
- Verdict: verified
- Evidence: https://v8.dev/blog/wasm-speculative-optimizations (2025-06-24: "675 ms to 90 ms"; "Between 1% and 8%"; "Up to four target functions"; "Shipped with Google Chrome M137") ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`wasm_inlining_call_indirect` true, `wasm_inlining_budget` 5000, `wasm_inlining_max_size` 500, `wasm_inlining_factor` 3)

### Fill function tables once and keep hot Wasm-to-Wasm calls inside one module instance
- Verdict: verified
- Evidence: https://github.com/v8/v8/commit/bec1fa5a87 ("[wasm] Enable wasm deopts by default", 2025-04-07; earliest 137.0.7115.0) ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`wasm_deopts_per_function_limit` 10) ; https://v8.dev/blog/wasm-speculative-optimizations (180 ms with inlining only)

### Give Wasm exports that hot JS calls numeric signatures, call them from stable sites, and batch work per call
- Verdict: verified
- Evidence: https://github.com/v8/v8/commit/f1a4104ff9 ("Re-enable inlining of JS->Wasm calls by default", 2022-08-05; earliest 106.0.5227.0) ; https://github.com/v8/v8/blob/main/src/flags/flag-definitions.h (`turbolev` false) ; https://v8.dev/features/wasm-bigint. Chrome 152 timings are local.

### Pass Wasm `i64` values as BigInt; never hand-split them into two `i32` halves
- Verdict: verified
- Evidence: https://raw.githubusercontent.com/emscripten-core/emscripten/main/ChangeLog.md (4.0.0, 2025-01-14: "The WASM_BIGINT feature is enabled by default"; 6.0.8, 2026-08-20: "WASM_BIGINT was deprecated" and "The deprecated LEGALIZE_JS_FFI setting was completely removed") ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`wasm-bigint` high 2023-10-26: Chrome 85, Firefox 78, Safari 14.1)

### Treat Wasm pointers as unsigned 32-bit values in JS glue: `>>>`, never `>>`
- Verdict: verified
- Evidence: https://v8.dev/blog/4gb-wasm-memory ("`>>` is a signed operation"; "If your flags make 2GB+ addresses possible then the compiler will automatically rewrite all memory accesses to use `>>>`") ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/src/settings.js (`MAXIMUM_MEMORY = 2147483648`)

### Start Wasm memory small, grow it on demand up to a set maximum, and handle allocation failure
- Verdict: verified
- Evidence: https://raw.githubusercontent.com/emscripten-core/emscripten/main/src/settings.js (`MEMORY_GROWTH_GEOMETRIC_STEP = 0.20`, `MEMORY_GROWTH_GEOMETRIC_CAP = 96*1024*1024`, "profiled to be on the order of ~20 msecs"; `INITIAL_HEAP` exists, default 16 MiB) ; https://github.com/v8/v8/blob/main/src/wasm/wasm-limits.h (`kV8MaxWasmMemory32Pages` 65'536 on 64-bit, 32'767 on 32-bit)

### Re-create typed-array views over Wasm memory after any call that can grow it
- Verdict: verified
- Evidence: @mdn/browser-compat-data 8.1.2 (2026-09-17) (`webassembly.api.Memory.toResizableBuffer`: Chrome 144, Firefox 145, Safari 26.2) ; https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow ; the Firefox-154 remark is in Emscripten `src/settings.js` (`GROWABLE_ARRAYBUFFERS` comment: "it was not usable on Firefox until Firefox 154"), not in ChangeLog.md; cite settings.js

### Stay on wasm32 unless one tab must hold more than 4 GiB; treat Memory64 as an opt-in with costs
- Verdict: verified
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`wasm-memory64` limited: Chrome 133, Firefox 134, no Safari) ; https://github.com/v8/v8/blob/main/src/wasm/wasm-limits.h (`kV8MaxWasmMemory64Pages` 262'144 = 16 GiB on 64-bit) ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/src/settings.js (`MEMORY64` marked `[deprecated]`, "we recommend using the more standard `-m64`") ; verify/13-scichart.verify.md ("~10% performance hit")

### Use JSPI, not Asyncify, when synchronous Wasm code must await promise-based web APIs; wrap only what needs it
- Verdict: verified
- Evidence: web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`wasm-jspi` low 2026-09-14: Chrome 137, Firefox 153, Safari 27) ; Safari 27 release notes ("adds support for WebAssembly JavaScript Promise Integration (JSPI)") ; https://raw.githubusercontent.com/emscripten-core/emscripten/main/ChangeLog.md (3.1.59: "`-sASYNCIFY=2` is setting now deprecated, use `-sJSPI` instead"; 6.0.8: "The JSPI setting is no longer considered experimental") ; https://v8.dev/blog/jspi ("approximately 1μs" per suspension)

### Treat Wasm linear memory as a heap that never shrinks: reuse long-lived buffers and avoid transient peaks
- Verdict: verified
- Evidence: https://github.com/WebAssembly/proposals (Memory control: Phase 1) ; https://v8.dev/blog/wasm-gc-porting (2 MB / 1.5 MB fragmentation example)

### Release every JS-to-Wasm-object link explicitly (`delete()`), because the GC cannot see through linear memory
- Verdict: verified
- Evidence: https://v8.dev/blog/wasm-gc-porting (in WasmMVP "there is no way to have bidirectional links between Wasm and JS that allow cycles to be collected in a fine-grained manner")

### Measure Wasm memory with Wasm-side counters, because heap snapshots show linear memory as one opaque buffer
- Verdict: verified
- Evidence: https://v8.dev/blog/wasm-gc-porting

### For code written in garbage-collected languages, prefer WasmGC builds over shipping a runtime and GC in linear memory
- Verdict: verified
- Evidence: https://v8.dev/blog/wasm-gc-porting ("2.3 K vs 6.1-9.6 K"; speculative inlining "about a 30% speedup" on the Sheets calc engine) ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`wasm-garbage-collection` low 2024-12-11: Chrome 119, Firefox 120, Safari 18.2)

### Build C++ Wasm that throws with native Wasm exception handling
- Verdict: verified
- Evidence: https://raw.githubusercontent.com/emscripten-core/emscripten/main/src/settings.js (`WASM_LEGACY_EXCEPTIONS = true`) ; web-features 3.39.0 (https://cdn.jsdelivr.net/npm/web-features/data.json) (`wasm-exception-handling` high 2024-11-03; `wasm-exnref-exceptions` low 2025-05-29: Chrome 137, Firefox 131, Safari 18.4) ; https://emscripten.org/docs/porting/exceptions.html

## Notes on the "Obsolete advice" and "Conflicts resolved" tables (not `###` items)

- Myth 8, 24, 25, 27, 28, 38, 41, 42, 44, 47, 48, 49, 50: consistent with the checks above.
- Myth 26 ("linear-time fallback"): still correct that it is off by default; the engine now also handles non-capturing lookbehinds (item "Write backtracking-safe patterns").
- Myth 34 (release cadence): add "and weekly security updates"; each V8 patch bump invalidates JS and Wasm code caches (`Version::Hash()` includes `patch_`).
- New myth worth adding: "`Object.assign({}, x)` is always slower than `{...x}`": not true since Chrome 129 (V8 b71404f1c8).
- Conflicts table: the homomorphic-IC, polymorphic-limit and cadence rows match chromiumdash (ab86d353fe → 147.0.7715.0; 77b7016561 → 156.0.8061.0; f2c89563c0 → 154.0.8027.0; 154 stable 2026-09-22). The fill row matches 785a0f64 → 135.0.7043.0.

## Cross-file conflicts

1. **Release cadence.** `19-design-b-task.md:684` says "Browsers ship every 4 weeks". `09` (lines 4, 1181, 2094, 2504) and `19-skill-design.md:29, 1019` say 2 weeks from Chrome 153. The Chrome blog (2026-03-03) and chromiumdash (153 on 09-08, 154 on 09-22, 155 on 10-06) support 2 weeks. Fix 19-design-b-task.
2. **Document-Isolation-Policy on Android.** `09:1022-1026` says "Chrome 137+ desktop … Chrome desktop only". `07-js-web-apis.md:157` says "Chrome desktop 137, Chrome Android 146 (chromestatus)". chromestatus supports 07 (ship stage android_first 146; status text still "In development").
3. **`scheduler.yield()` fallback.** `09:912-917`, `01-critical-rendering-path.md:865` and `03-course-js-and-vitals.md:694` use `setTimeout(r, 0)`. `06-js-event-loop-and-scheduling.md:106, 147-154` recommends a `MessageChannel` task because nested timers clamp to 4 ms (spec; WebKit one-shot timers from nesting level 10). Only Safari takes the fallback, so the skill should use the MessageChannel helper everywhere (the 06 verify report lists the same conflict).
4. **Code-cache invalidation scope.** `09:1181` says a cold compile "about every 2 weeks". `07-js-web-apis.md:887` says the cache is invalidated "when the module or Chrome version changes", which is the more accurate framing (any V8 version change, including weekly security updates).
5. **JSPI in webstatus.** `19-design-a-pipeline.md:1017` says "The Safari row for JSPI is missing from webstatus". That is still true for the webstatus API (`browser_implementations` has no Safari entry on 2026-09-23), while web-features 3.39.0 lists Safari 27 and `09:2378` cites web-features. Not a contradiction; cite web-features for the Safari version.
6. No conflict found for: polymorphic limit (only 09 states it), TimSort/PowerSort, `JSON.stringify` fast path (Chrome 138 in 09 and 19-design-c-symptom.md:737), compile hints Chrome 136 (09, 19-design-c-symptom.md:737), `Atomics.waitAsync`/`Atomics.pause` dates (07:140), Memory64 Firefox 134 (07:900, 13:613), relaxed SIMD Chrome 114 / Firefox 146 (07:900), `transfer()` widely 2026-09-05 (07:83), `instantiateStreaming` versions (07:888), Wasm 128 kB threshold described as historical (07:886).

## Missing but important

1. **`Object.assign({}, src)` fast clone (Chrome 129+).** V8 clones the first source with `FastCloneJSObject` when the target is a fresh `{}`; so `Object.assign` and spread are both fine for plain-object copies. Source: https://github.com/v8/v8/blob/main/src/builtins/builtins-object-gen.cc ; https://github.com/v8/v8/commit/b71404f1c8
2. **Chrome and Edge on iOS do not run V8.** Outside the EU and Japan entitlements, iOS browsers must use "WebKit and WebKit JavaScript", so every V8 threshold in this file (IC limits, Smi width, code cache, compile hints) does not apply to iPhone users of Chrome. Test hot paths in Safari/JavaScriptCore too. Source: https://developer.apple.com/app-store/review/guidelines/#2.5.6
3. **Weekly security updates also cold-start the caches.** Plan warm-start metrics around V8 patch bumps, not only milestones. Source: https://github.com/v8/v8/blob/main/src/utils/version.h ; https://github.com/v8/v8/blob/main/src/snapshot/code-serializer.cc ; https://developer.chrome.com/blog/chrome-two-week-release
4. **Debug streaming and cache misses from trace fields.** `v8.compile` events carry `streamed`, `notStreamedReason` (for example `ScriptTooSmall`, `EncodingNotSupported`, `HasCodeCache`, `ErrorScriptTypeMismatch`), `consumedCacheSize`, `cacheRejected`, `cacheKind`; `v8.produceCache` carries `producedCacheSize`. Source: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/inspector/inspector_trace_events.cc
5. **Local compile hints skip ES modules.** Chromium's crowdsourced/local compile hints apply only to classic scripts ("TODO(40286622): Compile hints for modules"), so an all-ESM Vite app gets no automatic eager-compile help; the explicit magic comment still works for modules. Source: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/bindings/core/v8/v8_script_runner.cc
6. **Wasm JS String Builtins** (`WebAssembly.compileStreaming(resp, { builtins: ['js-string'] })`): removes JS glue calls for string operations in WasmGC languages. Limited availability: Chrome 130, Firefox 134, no Safari. Source: web-features `wasm-string-builtins` ; https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/JavaScript_builtins
7. **Wasm tail calls** for interpreters and functional-language output: no trampolines. Baseline newly available 2024-12-11 (Chrome 112, Firefox 121, Safari 18.2). Source: web-features `wasm-tail-call-optimization`
8. **Wasm branch hinting** (`metadata.code.branch_hint` custom section): lets the engine lay out likely/unlikely branches. Baseline newly available 2026-02-24 (Chrome 137, Firefox 148, Safari 16). Check toolchain support before relying on it. Source: web-features `wasm-branch-hinting`
9. **Homomorphic IC marker in logs.** From Chrome 156, `--log-ic` output and Indicium can show state `H`; treat it as "many maps, one handler" (better than `N`, worse than `1`). Source: https://github.com/v8/v8/blob/main/src/ic/ic.cc (`TransitionMarkFromState`) ; https://github.com/v8/v8/commit/77b7016561
