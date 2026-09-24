#!/usr/bin/env node
// web-performance skill: compare two run files and print median, MAD, delta and a verdict per metric.
// Usage: node compare-runs.mjs <base.json> <after.json> [--floor <metric>=<value>]... [--higher <metric>[,<metric>]]
// Run file:
//   { "label": "base", "profile": "desktop 1440x900 DPR 2, CPU 4x", "build": "prod preview",
//     "env": { "browser": "Google Chrome <version>", "glRenderer": "ANGLE (...)" },
//     "runs": [ { "id": "base-1", "frameP95Ms": 21.4, "longFramesPer10s": 14 }, ... ] }
// Every finite number in a run is a metric; other fields are ignored.
// Lower is better, unless the metric name contains "fps" or is listed with --higher.
// Noise band T = max(2 × MAD of base, 5% of |base median|, floor). MAD is the raw median absolute deviation.
// Lower is better: win when after < base − T; regression when after > base + T; otherwise neutral.
// Higher is better: the same rule with the signs swapped. "base" and "after" are the medians.
// Fewer than 3 runs on a side: "insufficient runs". 3 or 4 runs: the verdict carries "low N".
import { readFileSync } from 'node:fs';

const USAGE = 'Usage: node compare-runs.mjs <base.json> <after.json> [--floor <metric>=<value>]... [--higher <metric>[,<metric>]]';
const fail = (msg) => { console.error(msg); process.exit(1); };

// Default floors from the skill design. Starting values: tune them after the first real runs.
const FLOORS = [
  [/inp|interaction|processing|inputdelay|presentation/i, 10], // ms
  [/lcp/i, 50], // ms
  [/longframe/i, 1], // long frames per 10 s
  [/frame.*p\d+|p\d+.*frame/i, 0.5], // frame interval percentile, ms
  [/heap.*action|action.*heap/i, 0.1], // MB per action
];

const files = [];
const floorFlags = new Map();
const higher = new Set();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--floor') {
    const [name, value] = (argv[++i] ?? '').split('=');
    if (!name || !value || !Number.isFinite(Number(value))) fail(`Bad --floor value. ${USAGE}`);
    floorFlags.set(name, Number(value));
  } else if (a === '--higher') (argv[++i] ?? '').split(',').filter(Boolean).forEach((n) => higher.add(n));
  else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
  else if (a.startsWith('--')) fail(`Unknown argument: ${a}\n${USAGE}`);
  else files.push(a);
}
if (files.length !== 2) fail(USAGE);

const load = (path) => {
  let run;
  try { run = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { fail(`Cannot read run file ${path}: ${e.message}`); }
  if (!Array.isArray(run?.runs)) fail(`${path}: expected an object with a "runs" array.`);
  return run;
};
const [base, after] = files.map(load);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mad = (xs) => { const m = median(xs); return median(xs.map((x) => Math.abs(x - m))); };
const values = (run, metric) => run.runs.map((r) => r?.[metric]).filter((v) => typeof v === 'number' && Number.isFinite(v));
const floorOf = (metric) => floorFlags.get(metric) ?? FLOORS.find(([re]) => re.test(metric))?.[1] ?? 0;
const isHigher = (metric) => higher.has(metric) || /fps/i.test(metric);
const num = (x) => {
  const a = Math.abs(x);
  return a >= 100 ? x.toFixed(0) : a >= 1 ? String(Number(x.toFixed(2))) : String(Number(x.toPrecision(2)));
};
const signed = (x) => (x > 0 ? '+' : '') + num(x);

// Metrics in order of first appearance, base first.
const metrics = [];
for (const r of [...base.runs, ...after.runs]) {
  for (const [k, v] of Object.entries(r ?? {})) if (typeof v === 'number' && Number.isFinite(v) && !metrics.includes(k)) metrics.push(k);
}

const rows = [];
const tally = {};
for (const metric of metrics) {
  const b = values(base, metric), a = values(after, metric);
  let verdict, cells;
  if (!b.length || !a.length) {
    verdict = `missing in ${b.length ? after.label ?? 'after' : base.label ?? 'base'}`;
    cells = [b.length ? `${num(median(b))} (${num(mad(b))})` : '-', a.length ? `${num(median(a))} (${num(mad(a))})` : '-', '-', '-', '-'];
  } else {
    const mb = median(b), ma = median(a), madB = mad(b);
    const t = Math.max(2 * madB, 0.05 * Math.abs(mb), floorOf(metric));
    const delta = ma - mb;
    const better = isHigher(metric) ? delta > t : delta < -t;
    const worse = isHigher(metric) ? delta < -t : delta > t;
    const n = Math.min(b.length, a.length);
    verdict = n < 3 ? 'insufficient runs' : (better ? 'win' : worse ? 'regression' : 'neutral') + (n < 5 ? ' (low N)' : '');
    cells = [`${num(mb)} (${num(madB)})`, `${num(ma)} (${num(mad(a))})`, signed(delta), mb ? `${signed((delta / Math.abs(mb)) * 100)}%` : 'n/a', `±${num(t)}`];
  }
  const word = verdict.replace(' (low N)', '');
  tally[word] = (tally[word] ?? 0) + 1;
  rows.push(`| ${metric}${isHigher(metric) ? ' ↑' : ''} | ${cells.join(' | ')} | ${verdict} |`);
}

// Conditions must match, or the comparison is not valid.
const differences = [];
for (const field of ['profile', 'build']) {
  if (base[field] !== after[field]) differences.push(`${field} "${base[field] ?? '-'}" vs "${after[field] ?? '-'}"`);
}
for (const k of Object.keys(base.env ?? {})) {
  if (after.env && k in after.env && JSON.stringify(base.env[k]) !== JSON.stringify(after.env[k])) {
    differences.push(`env.${k} ${JSON.stringify(base.env[k])} vs ${JSON.stringify(after.env[k])}`);
  }
}

const out = [];
out.push(`Base: ${base.label ?? files[0]} (${base.runs.length} runs) · After: ${after.label ?? files[1]} (${after.runs.length} runs)`);
out.push(`Profile: ${base.profile ?? '-'} · Build: ${base.build ?? '-'}`);
if (differences.length) out.push(`WARNING: conditions differ: ${differences.join('; ')}`);
out.push('');
out.push('| Metric | Before median (MAD) | After median (MAD) | Δ | Δ% | Noise band | Verdict |');
out.push('|---|---|---|---|---|---|---|');
out.push(...rows);
out.push('');
out.push(`Verdicts: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`);
out.push('Noise band = max(2 × MAD of base, 5% of base median, floor). ↑ = higher is better; other metrics: lower is better.');
console.log(out.join('\n'));
