#!/usr/bin/env node
// web-performance skill: summarize a saved Chrome trace (.json or .json.gz) without reading it into context.
// Usage: node trace-summary.mjs <trace.json[.gz]> [--between <startMark> <endMark>] [--thread <pid:tid>] [--top <n>] [--json]
//   --between  count only events that start inside each <startMark> → next <endMark> pair (performance.mark names)
//   --thread   use this renderer main thread instead of the automatic choice
//   --top      number of extra main-thread events to list by total time (default 8)
//   --json     print the summary as JSON
// Event names and arguments follow devtools-frontend TraceEvents.ts. Times are inclusive, so rows overlap.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const USAGE = 'Usage: node trace-summary.mjs <trace.json[.gz]> [--between <startMark> <endMark>] [--thread <pid:tid>] [--top <n>] [--json]';
const fail = (msg) => { console.error(msg); process.exit(1); };

const opts = { file: null, between: null, thread: null, top: 8, json: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--between') opts.between = [argv[++i], argv[++i]];
  else if (a === '--thread') opts.thread = argv[++i];
  else if (a === '--top') opts.top = Number(argv[++i]);
  else if (a === '--json') opts.json = true;
  else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
  else if (!opts.file && !a.startsWith('--')) opts.file = a;
  else fail(`Unknown argument: ${a}\n${USAGE}`);
}
if (!opts.file || (opts.between && !opts.between[1]) || !(opts.top >= 0) || (opts.thread && !/^\d+:\d+$/.test(opts.thread))) fail(USAGE);

// Main-thread rows that are always printed, with the DevTools Performance panel title.
const ROWS = [
  ['EvaluateScript', 'Evaluate script'], ['v8.evaluateModule', 'Evaluate module'], ['v8.compile', 'Compile script'],
  ['V8.CompileCode', 'Compile code'], ['V8.CompileModule', 'Compile module'], ['FunctionCall', 'Function call'],
  ['EventDispatch', 'Event'], ['TimerFire', 'Timer fired'], ['FireAnimationFrame', 'Animation frame fired'],
  ['RunMicrotasks', 'Run microtasks'], ['MajorGC', 'Major GC'], ['MinorGC', 'Minor GC'], ['BlinkGC.AtomicPhase', 'DOM GC'],
  ['HitTest', 'Hit test'], ['UpdateLayoutTree', 'Recalculate style'], ['Layout', 'Layout'], ['PrePaint', 'Pre-paint'],
  ['Paint', 'Paint'], ['Layerize', 'Layerize'], ['Commit', 'Commit'], ['ParseHTML', 'Parse HTML'],
  ['ParseAuthorStyleSheet', 'Parse stylesheet'],
];
const MARK_PH = new Set(['I', 'i', 'R', 'n']);
// Blink writes navigation timing under blink.user_timing too (ph "R"); DevTools hides these names from Timings.
const NAV_TIMING = new Set(['navigationStart', 'unloadEventStart', 'unloadEventEnd', 'redirectStart', 'redirectEnd',
  'fetchStart', 'commitNavigationEnd', 'domainLookupStart', 'domainLookupEnd', 'connectStart', 'connectEnd',
  'secureConnectionStart', 'requestStart', 'responseStart', 'responseEnd', 'domLoading', 'domInteractive',
  'domContentLoadedEventStart', 'domContentLoadedEventEnd', 'domComplete', 'loadEventStart', 'loadEventEnd']);
const isMark = (e) => MARK_PH.has(e.ph) && typeof e.cat === 'string' && e.cat.includes('blink.user_timing') && !NAV_TIMING.has(e.name);
const isInstant = (e) => e.ph === 'I' || e.ph === 'i';
const key = (e) => `${e.pid}:${e.tid}`;
const ms = (us) => us / 1000;
const r1 = (v) => Math.round(v * 10) / 10;
const max = (xs) => (xs.length ? xs.reduce((m, v) => Math.max(m, v), -Infinity) : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Load. Gzip is detected by its magic bytes, not by the file name.
let buf;
try { buf = readFileSync(opts.file); } catch (e) { fail(`Cannot read ${opts.file}: ${e.message}`); }
const gz = buf[0] === 0x1f && buf[1] === 0x8b;
let data;
try { data = JSON.parse((gz ? gunzipSync(buf) : buf).toString('utf8')); } catch (e) {
  fail(`Cannot parse ${opts.file} as ${gz ? 'gzipped ' : ''}trace JSON: ${e.message}` +
    (e instanceof RangeError ? '. The trace is too large for one string: record a shorter trace.' : ''));
}
const raw = Array.isArray(data) ? data : data?.traceEvents;
if (!Array.isArray(raw)) fail('No trace events: expected a JSON array or an object with "traceEvents".');

// Join B/E pairs into complete (X) events, per thread.
const events = [];
const open = new Map();
for (const e of raw) {
  if (e.ph === 'B') {
    if (!open.has(key(e))) open.set(key(e), []);
    open.get(key(e)).push(e);
  } else if (e.ph === 'E') {
    const b = open.get(key(e))?.pop();
    if (b) events.push({ ...b, ph: 'X', dur: e.ts - b.ts, args: { ...b.args, ...e.args } });
  } else events.push(e);
}

const threadNames = new Map();
let minTs = Infinity, maxTs = -Infinity;
for (const e of events) {
  if (e.ph === 'M') { if (e.name === 'thread_name') threadNames.set(key(e), e.args?.name); continue; }
  if (!(e.ts > 0)) continue;
  minTs = Math.min(minTs, e.ts);
  maxTs = Math.max(maxTs, e.ts + (e.dur ?? 0));
}
const mains = [...threadNames].filter(([, n]) => n === 'CrRendererMain').map(([k]) => k);

// Windows: the whole trace, or each start mark paired with the next end mark (the latest start wins).
let windows = [[minTs, maxTs]];
let markThread = null;
if (opts.between) {
  const [startName, endName] = opts.between;
  const marks = events.filter(isMark).sort((a, b) => a.ts - b.ts);
  windows = [];
  let start = null;
  for (const m of marks) {
    if (m.name === startName) start = m;
    else if (m.name === endName && start) { windows.push([start.ts, m.ts]); markThread ??= key(start); start = null; }
  }
  if (!windows.length) {
    const names = [...new Set(marks.map((m) => m.name))].slice(0, 20);
    fail(`No "${startName}" → "${endName}" pair in the trace. User timing marks found: ${names.join(', ') || 'none'}`);
  }
}
const inWindow = (ts) => windows.some(([a, b]) => ts >= a && ts <= b);
const spanUs = windows.reduce((sum, [a, b]) => sum + (b - a), 0);

// Main thread: --thread, else the thread of the start mark, else the busiest CrRendererMain.
let main = opts.thread, chosenBy = 'flag';
if (!main && markThread && mains.includes(markThread)) { main = markThread; chosenBy = 'start mark'; }
if (!main) {
  const markPid = markThread?.split(':')[0];
  const busy = new Map(mains.filter((k) => !markPid || k.startsWith(markPid + ':')).map((k) => [k, 0]));
  for (const e of events) if (e.name === 'RunTask' && e.ph === 'X' && busy.has(key(e))) busy.set(key(e), busy.get(key(e)) + e.dur);
  main = [...busy].sort((a, b) => b[1] - a[1])[0]?.[0];
  chosenBy = 'busiest renderer main thread';
}
if (!main) fail('No renderer main thread (CrRendererMain) in the trace. Pass --thread <pid:tid>.');
const pid = Number(main.split(':')[0]);

// One pass over the events inside the windows.
const byName = new Map();
const tasks = [], layouts = [], recalcs = [];
const forced = new Map();
const shifts = { count: 0, score: 0, withInput: 0 };
const interactions = new Map();
const marksIn = new Map();
const frames = { BeginFrame: 0, DrawFrame: 0, DroppedFrame: 0 };
const gpu = { count: 0, ms: 0 }, raster = { count: 0, ms: 0 };
for (const e of events) {
  if (e.ph === 'M' || !inWindow(e.ts)) continue;
  if (isMark(e)) marksIn.set(e.name, (marksIn.get(e.name) ?? 0) + 1);
  if (e.name === 'GPUTask' && e.ph === 'X' && (e.args?.data?.renderer_pid ?? pid) === pid) { gpu.count++; gpu.ms += ms(e.dur); }
  if (e.pid !== pid) continue;
  if (key(e) === main && e.ph === 'X') {
    const row = byName.get(e.name) ?? { count: 0, ms: 0, maxMs: 0 };
    row.count++;
    row.ms += ms(e.dur ?? 0);
    row.maxMs = Math.max(row.maxMs, ms(e.dur ?? 0));
    byName.set(e.name, row);
    if (e.name === 'RunTask') tasks.push(e);
    if (e.name === 'Layout') layouts.push(e);
    if (e.name === 'UpdateLayoutTree') recalcs.push(e);
    // Blink puts a JS stack on these events only while script runs, so a stack means script forced the work.
    // Trace stack frames are 1-based (line and column), unlike CDP call frames.
    const top = (e.name === 'Layout' || e.name === 'UpdateLayoutTree') && e.args?.beginData?.stackTrace?.[0];
    if (top) {
      const where = `${top.functionName || '(anonymous)'} (${(top.url || '?').split(/[?#]/)[0].split('/').pop()}:${top.lineNumber}:${top.columnNumber})`;
      const f = forced.get(where) ?? { where, count: 0, ms: 0 };
      f.count++;
      f.ms += ms(e.dur ?? 0);
      forced.set(where, f);
    }
  } else if (e.name === 'LayoutShift') {
    const d = e.args?.data ?? {};
    shifts.count++;
    if (d.had_recent_input) shifts.withInput++;
    else shifts.score += d.weighted_score_delta ?? d.score ?? 0;
  } else if (e.name === 'EventTiming' && e.ph === 'b' && e.args?.data?.interactionId > 0) {
    const d = e.args.data;
    const prev = interactions.get(d.interactionId);
    if (!prev || d.duration > prev.ms) interactions.set(d.interactionId, { ms: d.duration, type: d.type });
  } else if (Object.hasOwn(frames, e.name) && isInstant(e)) {
    frames[e.name]++;
  } else if (e.name === 'RasterTask' && e.ph === 'X') {
    raster.count++;
    raster.ms += ms(e.dur);
  }
}

// Top-level tasks only: a RunTask nested inside another one is skipped.
tasks.sort((a, b) => a.ts - b.ts);
const taskMs = [];
let taskEnd = -Infinity;
for (const t of tasks) if (t.ts >= taskEnd) { taskMs.push(ms(t.dur ?? 0)); taskEnd = t.ts + (t.dur ?? 0); }
const longTasks = taskMs.filter((d) => d > 50);
const busyMs = taskMs.reduce((sum, d) => sum + d, 0);

const begin = layouts.map((l) => l.args?.beginData ?? {});
const nums = (field) => begin.map((b) => b[field]).filter(Number.isFinite);
const worstInteraction = [...interactions.values()].sort((a, b) => b.ms - a.ms)[0];
const rowNames = new Set(ROWS.map(([n]) => n));

const summary = {
  file: opts.file, gzip: gz, events: raw.length,
  window: opts.between
    ? { between: opts.between, windows: windows.length, spanMs: r1(ms(spanUs)) }
    : { between: null, windows: 1, spanMs: r1(ms(spanUs)) },
  thread: { main, chosenBy, rendererMainThreads: mains.length },
  throttling: Array.isArray(data) ? null : { cpu: data.metadata?.cpuThrottling ?? null, network: data.metadata?.networkThrottling ?? null },
  tasks: {
    count: taskMs.length, busyMs: r1(busyMs), busyPct: spanUs ? r1((busyMs / ms(spanUs)) * 100) : 0,
    long: longTasks.length, maxMs: r1(max(taskMs) ?? 0),
    blockingMs: r1(longTasks.reduce((sum, d) => sum + d - 50, 0)),
  },
  rows: ROWS.map(([name, label]) => {
    const r = byName.get(name) ?? { count: 0, ms: 0, maxMs: 0 };
    return { name, label, count: r.count, ms: r1(r.ms), maxMs: r1(r.maxMs) };
  }),
  style: { recalcs: recalcs.length, elements: recalcs.reduce((sum, e) => sum + (e.args?.elementCount ?? 0), 0) },
  layout: {
    count: layouts.length,
    partial: begin.filter((b) => b.partialLayout === true).length,
    wholeDocument: begin.filter((b) => b.partialLayout === false).length,
    dirtyObjects: { median: median(nums('dirtyObjects')), max: max(nums('dirtyObjects')) },
    totalObjects: { median: median(nums('totalObjects')), max: max(nums('totalObjects')) },
    layoutRoots: layouts.reduce((sum, l) => sum + (l.args?.endData?.layoutRoots?.length ?? 0), 0),
  },
  forcedByScript: [...forced.values()].sort((a, b) => b.ms - a.ms).slice(0, 5).map((f) => ({ ...f, ms: r1(f.ms) })),
  layoutShifts: { count: shifts.count, scoreNoInput: Math.round(shifts.score * 1e4) / 1e4, withInput: shifts.withInput },
  interactions: { count: interactions.size, worstMs: worstInteraction ? r1(worstInteraction.ms) : null, worstType: worstInteraction?.type ?? null },
  frames,
  gpuTasks: { count: gpu.count, ms: r1(gpu.ms) },
  rasterTasks: { count: raster.count, ms: r1(raster.ms) },
  marks: Object.fromEntries([...marksIn].slice(0, 10)),
  otherEvents: [...byName].filter(([n]) => n !== 'RunTask' && !rowNames.has(n) && byName.get(n).ms > 0)
    .sort((a, b) => b[1].ms - a[1].ms).slice(0, opts.top)
    .map(([name, r]) => ({ name, count: r.count, ms: r1(r.ms), maxMs: r1(r.maxMs) })),
};

if (opts.json) { console.log(JSON.stringify(summary, null, 2)); process.exit(0); }

const s = summary, L = s.layout;
const out = [];
out.push(`Trace: ${s.file} (${s.gzip ? 'gzip' : 'json'}, ${s.events.toLocaleString('en-US')} events)`);
out.push(s.window.between
  ? `Window: ${s.window.between[0]} → ${s.window.between[1]}, ${s.window.windows} window(s), ${s.window.spanMs} ms in total`
  : `Window: whole trace, ${s.window.spanMs} ms`);
out.push(`Main thread: ${s.thread.main} (${s.thread.chosenBy}; ${s.thread.rendererMainThreads} renderer main thread(s) in trace)`);
out.push(s.throttling && (s.throttling.cpu !== null || s.throttling.network !== null)
  ? `Throttling in file metadata: CPU ${s.throttling.cpu ?? '?'}x, network ${s.throttling.network ?? '?'}`
  : 'Throttling: not in the file; check the MCP trace summary header');
out.push(`Tasks: ${s.tasks.count} top-level, ${s.tasks.busyMs} ms busy (${s.tasks.busyPct}%), ${s.tasks.long} over 50 ms (max ${s.tasks.maxMs} ms), blocking ${s.tasks.blockingMs} ms (sum over 50 ms)`);
out.push('');
// The name column grows to 40 characters, so names such as v8::Debugger::AsyncTaskRun and ...Scheduled stay distinct.
const tableRows = [...s.rows, ...s.otherEvents.map((r) => ({ ...r, label: '(other)' }))];
const nameWidth = Math.min(40, Math.max(24, ...tableRows.map((r) => r.name.length + 1)));
const cell = (name) => (name.length < nameWidth ? name : name.slice(0, nameWidth - 2) + '…').padEnd(nameWidth);
out.push(`${'Event'.padEnd(nameWidth)}${'DevTools title'.padEnd(24)}${'Count'.padStart(7)}${'Total ms'.padStart(11)}${'Max ms'.padStart(9)}`);
for (const r of tableRows) {
  out.push(`${cell(r.name)}${r.label.padEnd(24)}${String(r.count).padStart(7)}${String(r.ms).padStart(11)}${String(r.maxMs).padStart(9)}`);
}
out.push('');
out.push(`Style: ${s.style.recalcs} recalculations, ${s.style.elements} elements`);
out.push(`Layout: ${L.count} (partial ${L.partial}, whole document ${L.wholeDocument}); dirtyObjects median ${L.dirtyObjects.median ?? '-'} max ${L.dirtyObjects.max ?? '-'}; totalObjects median ${L.totalObjects.median ?? '-'} max ${L.totalObjects.max ?? '-'}; layout roots ${L.layoutRoots}`);
out.push(`Forced by script (JS stack on style or layout): ${s.forcedByScript.length ? s.forcedByScript.map((f) => `${f.where} ${f.count}x ${f.ms} ms`).join('; ') : 'none'}`);
out.push(`Layout shifts: ${s.layoutShifts.count} (score without recent input ${s.layoutShifts.scoreNoInput}; ${s.layoutShifts.withInput} with recent input)`);
out.push(`Interactions: ${s.interactions.count}${s.interactions.count ? `, worst ${s.interactions.worstMs} ms (${s.interactions.worstType})` : ''}`);
out.push(`Frames (renderer pid ${pid}): BeginFrame ${s.frames.BeginFrame}, DrawFrame ${s.frames.DrawFrame}, DroppedFrame ${s.frames.DroppedFrame}`);
out.push(`Off main thread: GPUTask ${s.gpuTasks.count} (${s.gpuTasks.ms} ms), RasterTask ${s.rasterTasks.count} (${s.rasterTasks.ms} ms)`);
out.push(`User timing marks: ${Object.entries(s.marks).map(([n, c]) => `${n} ${c}x`).join(', ') || 'none'}`);
console.log(out.join('\n'));
