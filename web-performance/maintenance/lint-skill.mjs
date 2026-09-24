#!/usr/bin/env node
// Lint for the web-performance skill. MAINTAINING.md explains each check and how to fix a failure.
// Usage: node lint-skill.mjs [--root <skill folder>] [--today YYYY-MM-DD] [--release]
// Exit code: 0 pass, 1 fail, 2 bad arguments. Node built-ins only.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage: node lint-skill.mjs [--root <skill folder>] [--today YYYY-MM-DD] [--release]
  --root     the skill folder (default: the folder above this script)
  --today    the date for the staleness checks (default: today)
  --release  also fail on warnings and on missing files`;

// ------------------------------------------------------------------ the contract

const PREFIXES = ['HTML', 'MEDIA', 'CSS', 'EVT', 'TASK', 'DOM', 'DATA', 'LIFE', 'V8', 'CNV', 'GPU', 'SC'];
const ID = `(?:${PREFIXES.join('|')})-\\d{2}`;
const ID_RE = new RegExp(`\\b${ID}\\b`, 'g');
const EXACT_ID_RE = new RegExp(`^${ID}$`);
// Matches the text before an ID that follows an arrow: "→ A-01", "-> A-01, B-02".
const AFTER_ARROW_RE = new RegExp(`(?:→|->)\\s*[*\`]*(?:${ID}[*\`]*\\s*(?:,|and)\\s*[*\`]*)*$`);

const DEFAULT_STAGES = ['network', 'parse', 'cssom', 'script-load', 'tasks', 'js', 'style', 'layout', 'paint', 'composite', 'gpu-upload', 'gpu-draw', 'memory'];
const METRICS = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB', 'frame', 'memory', 'bytes', 'startup'];
const WHEN = ['load', 'interaction', 'render-loop', 'session', 'build'];
const IMPACTS = ['high', 'medium', 'low'];
const TAGS = ['stage', 'metric', 'when', 'impact', 'support', 'also'];
const REQUIRED_TAGS = TAGS.filter((t) => t !== 'also');
const FIELDS = ['Do', 'Why', 'Detect', 'Verify', 'Example', 'Avoid', 'Source'];
const REQUIRED_FIELDS = FIELDS.filter((f) => f !== 'Example');

const LIMITS = {
  skillLines: 270,
  skillChars: 18_000, // about 4,500 tokens: all of SKILL.md survives the 5,000-token re-attach after compaction
  listingChars: 1_536, // Claude Code cuts description + when_to_use at this length in the skill listing
  budgetSlackPercent: 15,
  ruleLines: 18, // lines of a full rule, not counting the code lines of its example
  exampleLines: 14,
  titleChars: 90,
  checklistPointerLines: 6,
  staleDays: 90,
};

// Every file of the skill. `budget` is a line budget, set only for files that Claude reads
// into its context. `prefix` marks a rule file. `splitAt` is where a file must split.
const FILES = {
  'SKILL.md': {},
  'references/pipeline.md': { budget: 300 },
  'references/html-loading.md': { budget: 320, prefix: 'HTML' },
  'references/html-media-and-fonts.md': { budget: 200, prefix: 'MEDIA' },
  'references/css-rendering.md': { budget: 340, prefix: 'CSS' },
  'references/js-events-and-input.md': { budget: 260, prefix: 'EVT' },
  'references/js-scheduling-and-workers.md': { budget: 280, prefix: 'TASK' },
  'references/js-dom-and-lists.md': { budget: 180, prefix: 'DOM' },
  'references/js-live-data-and-network.md': { budget: 260, prefix: 'DATA' },
  'references/js-lifecycle-and-memory.md': { budget: 240, prefix: 'LIFE' },
  'references/v8-hot-code.md': { budget: 200, prefix: 'V8' },
  'references/gpu-canvas-and-frames.md': { budget: 280, prefix: 'CNV' },
  'references/gpu-webgl-webgpu.md': {
    budget: 460,
    prefix: 'GPU',
    splitAt: 500,
    split: 'split it into gpu-setup-and-upload.md (§0–§C, §F) and gpu-draw-and-readback.md (§D–§E, §G–§J); both keep GPU- IDs',
  },
  'references/scichart.md': { budget: 360, prefix: 'SC' },
  'references/measure.md': { budget: 380 },
  'references/review.md': { budget: 170 },
  'references/support.md': { budget: 260 },
  'scripts/probes.js': { budget: 300 }, // sent in full per evaluate_script install; keep it small
  'scripts/trace-summary.mjs': {},
  'scripts/compare-runs.mjs': {},
  'assets/perf-hooks.dev.ts': { budget: 230 }, // template copied into projects, not loaded into context
  'maintenance/MAINTAINING.md': {},
  'maintenance/crosswalk.tsv': {},
  'evals/evals.json': {},
  'evals/trigger-queries.json': {},
};

// Frontmatter values that break the design. `bad` gets the raw value.
const YAML_TRUE = /^(true|yes|on|1)$/i;
const YAML_FALSE = /^(false|no|off|0)$/i;
const FRONTMATTER_BANS = {
  paths: { bad: () => true, why: 'modes 2 and 3 start before any file is open, and "**/*.ts" also matches backend code' },
  'allowed-tools': { bad: () => true, why: 'a model-invoked skill must not pre-approve browser tools; measurement stays under normal permission prompts' },
  context: { bad: () => true, why: 'the write-time rules must stay in the main context' },
  arguments: { bad: () => true, why: 'with a placeholder, Claude Code stops adding the "ARGUMENTS: <value>" line that the mode table reads' },
  'disable-model-invocation': { bad: (v) => YAML_TRUE.test(v), why: 'the skill must load on its own while Claude writes code' },
  'user-invocable': { bad: (v) => YAML_FALSE.test(v), why: '"/web-performance review" and "/web-performance measure" must stay available' },
};

// Versions and dates belong only in references/support.md.
const BROWSER_VERSION = { what: 'browser or OS version', re: /\b(?:Chrome|Chromium|Edge|Firefox|Safari|Opera|iOS|iPadOS|macOS|Android)\s+v?\d{2,3}\b/g };
const ISO_DATE = { what: 'date', re: /\b(?:19|20)\d\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g };
const MONTH_DATE = {
  what: 'date',
  re: /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b\.?\s+(?:\d{1,2},?\s+)?(?:19|20)\d\d\b/g,
};
const SEMVER = { what: 'version', re: /(?<![\d.])v?\d+\.\d+\.\d+(?!\.?\d)/g };
const BASELINE_YEAR = { what: 'Baseline year', re: /\bBaseline\s+(?:19|20)\d\d\b/g };
const TEXT_PATTERNS = [BROWSER_VERSION, SEMVER, ISO_DATE, MONTH_DATE, BASELINE_YEAR];
const CODE_PATTERNS = [BROWSER_VERSION, ISO_DATE, MONTH_DATE]; // code can hold x.y.z numbers that are not versions

// ------------------------------------------------------------------ arguments and output state

const DAY_MS = 86_400_000;
const OPTS = parseArgs(process.argv.slice(2));
const ROOT = OPTS.root;

const findings = [];
const seenFindings = new Set();
const notChecked = new Map(); // what → { why, count }
const handledRefs = new Set(); // "file:line:ID" already reported by a more specific check
const facts = [];

function parseArgs(argv) {
  const opts = { root: resolve(dirname(fileURLToPath(import.meta.url)), '..'), today: null, release: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--release') opts.release = true;
    else if (arg === '--root' && argv[i + 1]) opts.root = resolve(argv[++i]);
    else if (arg === '--today' && argv[i + 1]) opts.today = parseDate(argv[++i]) ?? usage('--today needs a date as YYYY-MM-DD.');
    else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else usage(`Unknown or incomplete argument "${arg}".`);
  }
  if (!existsSync(opts.root) || !statSync(opts.root).isDirectory()) usage(`The skill folder "${opts.root}" does not exist.`);
  if (!opts.today) {
    const now = new Date();
    opts.today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }
  return opts;
}

function usage(message) {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

function add(level, file, line, msg) {
  const key = `${level}\0${file}\0${line}\0${msg}`;
  if (seenFindings.has(key)) return;
  seenFindings.add(key);
  findings.push({ level, file, line, msg });
}
const error = (file, line, msg) => add('error', file, line, msg);
const warn = (file, line, msg) => add('warn', file, line, msg);

function skip(what, why) {
  const entry = notChecked.get(what) ?? { why, count: 0 };
  entry.count++;
  notChecked.set(what, entry);
}

// ------------------------------------------------------------------ text helpers

function parseDate(text) {
  const m = String(text ?? '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return date.getUTCMonth() === +m[2] - 1 ? date : null;
}
const iso = (date) => date.toISOString().slice(0, 10);
const num = (n) => n.toLocaleString('en-US');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const codeSpans = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
const plain = (text) => text.replace(/[`*]/g, '').trim();
const list = (text) => text.split(',').map((s) => plain(s)).filter(Boolean);
const urlSpans = (line) => [...line.matchAll(/(?:https?:\/\/|www\.)\S+/g)].map((m) => [m.index, m.index + m[0].length]);
const inSpans = (spans, index) => spans.some(([a, b]) => index >= a && index < b);

function listDir(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  return readdirSync(abs)
    .filter((name) => statSync(join(abs, name)).isFile())
    .sort()
    .map((name) => `${dir}/${name}`);
}

// A loaded file. For Markdown, `kind[i]` is 'text', 'fence' or 'code', and `headings` skips code blocks.
function load(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  const text = readFileSync(abs, 'utf8').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const kind = lines.map(() => 'text');
  const headings = [];
  if (rel.endsWith('.md')) {
    let fence = null;
    let openedAt = 0;
    lines.forEach((line, i) => {
      const m = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
      if (fence) {
        const closes = m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim();
        kind[i] = closes ? 'fence' : 'code';
        if (closes) fence = null;
      } else if (m) {
        kind[i] = 'fence';
        fence = m[1];
        openedAt = i;
      } else {
        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) headings.push({ i, level: h[1].length, text: h[2].trim() });
      }
    });
    if (fence) error(rel, openedAt + 1, 'This code fence is never closed, so the lint cannot read the rest of the file.');
  }
  return { rel, text, lines, kind, headings };
}

function rangeOf(doc, heading) {
  const next = doc.headings.find((h) => h.i > heading.i && h.level <= heading.level);
  return { start: heading.i + 1, end: next ? next.i : doc.lines.length, heading };
}

function section(doc, re) {
  const heading = doc.headings.find((h) => re.test(h.text));
  return heading ? rangeOf(doc, heading) : null;
}

// Table rows in a line range. The row above a |---| line is a header row.
function tableRows(doc, range = { start: 0, end: doc.lines.length }) {
  const rows = [];
  for (let i = range.start; i < range.end; i++) {
    const line = doc.lines[i];
    if (doc.kind[i] !== 'text' || !line.trimStart().startsWith('|')) continue;
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/(?<!\\)\|$/, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) {
      if (rows.at(-1)?.i === i - 1) rows.at(-1).header = true;
      continue;
    }
    rows.push({ i, cells, header: false });
  }
  return rows;
}

// How an ID is used on a line: after an arrow, in a tag line's `also:`, or as a plain mention.
function refKind(line, index) {
  const before = line.slice(0, index);
  if (AFTER_ARROW_RE.test(before)) return 'pointer';
  if (/^stage:/.test(line) && /(?:^|·)\s*also:[^·]*$/.test(before)) return 'also';
  return 'mention';
}

// ------------------------------------------------------------------ vocabularies from the skill's own files

function readStages(doc) {
  const fallback = { stages: DEFAULT_STAGES, fromPipeline: false };
  if (!doc) {
    skip('Stage vocabulary', 'references/pipeline.md is missing; the built-in 13 stages are used');
    return fallback;
  }
  const sec = section(doc, /§J|stage vocabulary/i);
  const rows = sec ? tableRows(doc, sec) : [];
  const header = rows.find((r) => r.header);
  const col = Math.max(0, header ? header.cells.findIndex((c) => /tag|stage/i.test(c)) : 0);
  const words = rows
    .filter((r) => !r.header)
    .flatMap((r) => {
      const cell = r.cells[col] ?? '';
      const spans = codeSpans(cell);
      return spans.length ? spans : [plain(cell)];
    })
    .filter((w) => /^[a-z][a-z0-9-]*$/.test(w));
  if (!words.length) {
    error(doc.rel, sec ? sec.heading.i + 1 : null, 'Cannot read the stage vocabulary: add a "§J Stage vocabulary" table whose first column lists the stage tags.');
    return fallback;
  }
  const stages = [...new Set(words)];
  facts.push(['Stage vocabulary', `${stages.length} stages from pipeline.md §J`]);
  return { stages, fromPipeline: true };
}

function readSupport(doc) {
  if (!doc) return null;
  const rel = doc.rel;
  const sec = section(doc, /§A|feature table/i);
  if (!sec) warn(rel, null, 'No "§A Feature table" heading; the lint reads support keys from every table in the file.');
  const keys = new Set();
  const staleRows = [];
  let checkedCol = -1;
  for (const row of tableRows(doc, sec ?? undefined)) {
    if (row.header) {
      checkedCol = row.cells.findIndex((c) => /^checked$/i.test(plain(c)));
      continue;
    }
    const key = codeSpans(row.cells[0])[0] ?? plain(row.cells[0]).split(/\s+/)[0];
    if (key) keys.add(key);
    const checked = checkedCol >= 0 ? parseDate(row.cells[checkedCol]) : null;
    if (checked && ageDays(checked) > LIMITS.staleDays) staleRows.push(key);
  }
  if (staleRows.length) warn(rel, null, `${plural(staleRows.length, 'row')} checked more than ${LIMITS.staleDays} days ago: ${staleRows.join(', ')}. Re-check them.`);

  // "Checked: 2026-09-22." and "Stale after: …" header lines; bold markers are allowed.
  const headerDate = (name) => {
    const i = doc.lines.findIndex((l) => new RegExp(`^\\W*${name}:\\W*\\d{4}-\\d{2}-\\d{2}`).test(l));
    return i < 0 ? { i } : { i, date: parseDate(doc.lines[i]) };
  };
  const { i: checkedAt, date: checked } = headerDate('Checked');
  const { i: staleAt, date: given } = headerDate('Stale after');
  if (!checked) {
    error(rel, checkedAt < 0 ? null : checkedAt + 1, 'Add the header line "Checked: YYYY-MM-DD" with a valid date.');
  } else {
    let staleAfter = new Date(checked.getTime() + LIMITS.staleDays * DAY_MS);
    if (!given) warn(rel, staleAt < 0 ? checkedAt + 1 : staleAt + 1, `Add the header line "Stale after: ${iso(staleAfter)}" (Checked + ${LIMITS.staleDays} days).`);
    else {
      if (given > staleAfter) warn(rel, staleAt + 1, `"Stale after" is more than ${LIMITS.staleDays} days after "Checked"; set it to ${iso(staleAfter)}.`);
      staleAfter = given;
    }
    if (OPTS.today > staleAfter) warn(rel, checkedAt + 1, `support.md is stale: checked ${iso(checked)}, stale after ${iso(staleAfter)}. Refresh it (MAINTAINING.md).`);
    facts.push(['support.md', `${keys.size} keys, checked ${iso(checked)}, stale after ${iso(staleAfter)}`]);
  }
  return { keys };
}

function ageDays(date) {
  return Math.floor((OPTS.today - date) / DAY_MS);
}

// Recipe names in measure.md: "#fps" in a heading or in the first cell of a table row, a heading slug, or an HTML id.
function readRecipes(doc) {
  if (!doc) return null;
  const names = new Set();
  for (const h of doc.headings) {
    names.add(
      h.text
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, '')
        .trim()
        .replace(/\s+/g, '-'),
    );
    for (const m of h.text.matchAll(/#([\w-]+)/g)) names.add(m[1]);
  }
  for (const row of tableRows(doc)) for (const m of row.cells[0].matchAll(/#([\w-]+)/g)) names.add(m[1]);
  for (const m of doc.text.matchAll(/\b(?:id|name)="([\w-]+)"/g)) names.add(m[1]);
  return names;
}

function readRetired(doc) {
  const map = new Map(); // ID → { line, replacedBy }
  if (!doc) return map;
  const sec = section(doc, /retired rule ids/i);
  if (!sec) {
    error(doc.rel, null, 'Add the "## Retired rule IDs" table; the lint reads it.');
    return map;
  }
  let byCol = -1;
  for (const row of tableRows(doc, sec)) {
    if (row.header) {
      byCol = row.cells.findIndex((c) => /replaced/i.test(c));
      continue;
    }
    const id = plain(row.cells[0]);
    if (!EXACT_ID_RE.test(id)) error(doc.rel, row.i + 1, `"${row.cells[0]}" is not a rule ID.`);
    else if (map.has(id)) error(doc.rel, row.i + 1, `${id} is listed twice.`);
    else map.set(id, { line: row.i + 1, replacedBy: byCol >= 0 ? (row.cells[byCol] ?? '').match(ID_RE) ?? [] : [] });
  }
  return map;
}

// ------------------------------------------------------------------ rule files

function findRuleFiles() {
  const found = [];
  for (const [rel, doc] of docs) {
    if (!rel.startsWith('references/')) continue;
    const expected = FILES[rel]?.prefix;
    const m = doc.lines[0]?.match(/^# .*\(([A-Z][A-Z0-9]*)-\)\s*$/);
    if (expected) {
      if (!m) error(rel, 1, `Line 1 must be "# <Title> (${expected}-)".`);
      else if (m[1] !== expected) error(rel, 1, `Line 1 names the prefix ${m[1]}-, but this file holds ${expected}- rules.`);
      found.push(parseRuleFile(doc, expected));
    } else if (m) {
      if (PREFIXES.includes(m[1])) found.push(parseRuleFile(doc, m[1]));
      else error(rel, 1, `Unknown prefix ${m[1]}-. Known prefixes: ${PREFIXES.join(', ')}.`);
    }
  }
  return found;
}

function parseRuleFile(doc, prefix) {
  const firstH2 = doc.headings.find((h) => h.level === 2);
  const checklist = firstH2 && /^checklist\b/i.test(firstH2.text) ? rangeOf(doc, firstH2) : null;
  const inChecklist = (i) => checklist && i >= checklist.start && i < checklist.end;
  const rules = [];
  doc.headings.forEach((h, n) => {
    const m = h.level === 3 && h.text.match(/^([A-Z][A-Z0-9]*-\d+)\b\s*(.*)$/);
    if (m) rules.push({ type: 'full', id: m[1], title: m[2], i: h.i, end: doc.headings[n + 1]?.i ?? doc.lines.length });
  });
  doc.lines.forEach((line, i) => {
    const m = doc.kind[i] === 'text' && !inChecklist(i) && line.match(/^- \*\*([A-Z][A-Z0-9]*-\d+)\*\*\s*(.*)$/);
    if (m) rules.push({ type: 'one-line', id: m[1], text: m[2], i });
  });
  return { doc, prefix, firstH2, checklist, rules };
}

function registerRules() {
  const map = new Map();
  for (const rf of ruleFiles) {
    for (const rule of rf.rules) {
      const [prefix, digits] = rule.id.split('-');
      const at = rule.i + 1;
      if (!PREFIXES.includes(prefix)) {
        error(rf.doc.rel, at, `${rule.id}: unknown prefix. Known prefixes: ${PREFIXES.join(', ')}.`);
        continue;
      }
      if (!/^\d{2}$/.test(digits)) {
        error(rf.doc.rel, at, `${rule.id}: an ID has exactly two digits (${prefix}-<nn>).`);
        continue;
      }
      if (prefix !== rf.prefix) {
        error(rf.doc.rel, at, `${rule.id} is in a ${rf.prefix}- file. The prefix is the file's category: give the rule a ${rf.prefix}- ID, or move it to the ${prefix}- file.`);
      }
      if (!map.has(rule.id)) map.set(rule.id, []);
      map.get(rule.id).push({ rel: rf.doc.rel, line: at, filePrefix: rf.prefix });
    }
  }
  return map;
}

function checkRuleFile(rf) {
  const { doc, firstH2, checklist } = rf;
  const headerEnd = firstH2 ? firstH2.i : doc.lines.length;
  if (!doc.lines.slice(1, headerEnd).some((l) => /^Open this when\b/.test(l))) {
    error(doc.rel, 3, 'Add the line "Open this when you write …" under the title.');
  }
  if (!checklist) {
    error(doc.rel, firstH2 ? firstH2.i + 1 : 1, 'The first "## " heading must be "## Checklist": the checklist is the table of contents.');
  }
  for (const rule of rf.rules) {
    if (firstH2 && rule.i < firstH2.i) error(doc.rel, rule.i + 1, `${rule.id} comes before the checklist. Rules come after it.`);
    if (rule.type === 'full') checkFullRule(doc, rule);
    else checkOneLineRule(doc, rule);
  }
  if (checklist) checkChecklist(rf);
}

function checkFullRule(doc, rule) {
  const { rel, lines, kind } = doc;
  const { id } = rule;
  const at = rule.i + 1;
  const title = rule.title.replace(/`/g, '');
  if (!title) error(rel, at, `${id}: the heading needs a title after the ID.`);
  else if (title.length > LIMITS.titleChars) warn(rel, at, `${id}: the title has ${title.length} characters; the target is ${LIMITS.titleChars} at most.`);

  const tagLine = lines[rule.i + 1] ?? '';
  if (/^stage:\s/.test(tagLine)) rule.info = checkTagLine(rel, at + 1, id, tagLine);
  else {
    error(rel, at + 1, `${id}: the line under the title must be the tag line "stage: … · metric: … · when: … · impact: … · support: …". The stage grep (grep -B1 '^stage:') depends on it.`);
  }

  const fields = new Map();
  let proseLines = 1; // the heading
  let codeLines = 0;
  for (let i = rule.i + 1; i < rule.end; i++) {
    if (kind[i] === 'code') {
      codeLines++;
      continue;
    }
    if (kind[i] === 'fence') {
      if (codeLines > LIMITS.exampleLines) error(rel, i + 1, `${id}: the code example has ${codeLines} lines; the limit is ${LIMITS.exampleLines}.`);
      codeLines = 0;
      continue;
    }
    if (lines[i].trim()) proseLines++;
    const m = lines[i].match(/^- (Do|Why|Detect|Verify|Example|Avoid|Source):\s*(.*)$/);
    if (!m) continue;
    if (fields.has(m[1])) error(rel, i + 1, `${id}: "- ${m[1]}:" appears twice.`);
    else fields.set(m[1], { line: i + 1, value: m[2] });
  }
  if (proseLines > LIMITS.ruleLines) {
    error(rel, at, `${id}: ${proseLines} lines, not counting the example code; the limit is ${LIMITS.ruleLines}. Shorten it, or move detail to a one-line rule.`);
  }
  for (const field of REQUIRED_FIELDS) if (!fields.has(field)) error(rel, at, `${id}: missing the "- ${field}:" line.`);

  const detect = fields.get('Detect');
  if (detect && !/`[^`]+`/.test(detect.value)) error(rel, detect.line, `${id}: Detect has no pattern in backticks, so a review cannot grep for it.`);
  const verify = fields.get('Verify');
  if (verify && !/measure\.md#[\w-]+/.test(verify.value)) error(rel, verify.line, `${id}: Verify must name a recipe as "measure.md#<recipe>".`);
  if (verify && !/\bPass:/.test(verify.value)) error(rel, verify.line, `${id}: Verify needs "Pass: <condition>".`);
  const source = fields.get('Source');
  if (source && !/https?:\/\//.test(source.value)) error(rel, source.line, `${id}: Source needs at least one URL.`);
}

function checkTagLine(rel, line, id, text) {
  const tags = new Map();
  for (const part of text.split(/\s+·\s+(?=[a-z]+:)/)) {
    const m = part.match(/^([a-z]+):\s*(.*)$/);
    if (!m) error(rel, line, `${id}: cannot read the tag "${part}". Separate tags with " · ".`);
    else if (!TAGS.includes(m[1])) error(rel, line, `${id}: unknown tag "${m[1]}". Tags: ${TAGS.join(', ')}.`);
    else if (tags.has(m[1])) error(rel, line, `${id}: the tag "${m[1]}" appears twice.`);
    else tags.set(m[1], m[2].trim());
  }
  for (const tag of REQUIRED_TAGS) if (!tags.has(tag)) error(rel, line, `${id}: the tag line has no "${tag}:".`);

  const stages = checkWords(rel, line, id, 'stage', tags.get('stage'), vocab.stages);
  checkWords(rel, line, id, 'metric', tags.get('metric'), METRICS);
  checkWords(rel, line, id, 'when', tags.get('when'), WHEN);

  const impact = tags.get('impact');
  if (impact !== undefined && !/^(high|medium|low)\s+(—|–|-{1,2})\s+\S/.test(impact)) {
    error(rel, line, `${id}: write the impact as "high|medium|low — <one-clause reason>".`);
  }

  const supportValue = tags.get('support');
  if (supportValue !== undefined) {
    const keys = list(supportValue.replace(/\([^)]*\)/g, ''));
    if (!keys.length) error(rel, line, `${id}: "support:" is empty. Use a key from support.md, "baseline" or "n/a".`);
    for (const key of keys) {
      if (key === 'baseline' || key === 'n/a') continue;
      if (!support) skip('Support keys', 'references/support.md is missing');
      else if (!support.keys.has(key)) error(rel, line, `${id}: the support key "${key}" is not in references/support.md §A. Add a row there, or use "baseline" or "n/a".`);
    }
  }

  const also = tags.get('also');
  if (also !== undefined && !/^(—|-|none|n\/a)?$/i.test(also)) {
    for (const token of also.split(/[,\s]+/).map(plain).filter(Boolean)) {
      if (!EXACT_ID_RE.test(token)) error(rel, line, `${id}: "also:" holds only rule IDs, and "${token}" is not one.`);
      else if (token === id) error(rel, line, `${id}: "also:" points to the rule itself.`);
    }
  }
  return { stages, impact: impact?.match(/^(high|medium|low)\b/)?.[1] };
}

function checkWords(rel, line, id, tag, value, allowed) {
  if (value === undefined) return [];
  const words = list(value);
  if (!words.length) error(rel, line, `${id}: "${tag}:" is empty.`);
  for (const word of words) if (!allowed.includes(word)) error(rel, line, `${id}: unknown ${tag} "${word}". Allowed: ${allowed.join(', ')}.`);
  return words;
}

function checkOneLineRule(doc, rule) {
  const at = rule.i + 1;
  const tags = [...rule.text.matchAll(/\[([^[\]]*·[^[\]]*)\]/g)].at(-1);
  if (!tags) error(doc.rel, at, `${rule.id}: a one-line rule needs "[<stage> · <metric> · <impact>]" after its text.`);
  else {
    const parts = tags[1].split('·').map((s) => s.trim());
    if (parts.length !== 3) error(doc.rel, at, `${rule.id}: the brackets need exactly three tags: [<stage> · <metric> · <impact>].`);
    else {
      const stages = checkWords(doc.rel, at, rule.id, 'stage', parts[0], vocab.stages);
      checkWords(doc.rel, at, rule.id, 'metric', parts[1], METRICS);
      if (!IMPACTS.includes(parts[2])) error(doc.rel, at, `${rule.id}: unknown impact "${parts[2]}". Allowed: ${IMPACTS.join(', ')}.`);
      rule.info = { stages, impact: parts[2] };
    }
  }
  if (!/https?:\/\//.test(rule.text)) error(doc.rel, at, `${rule.id}: a one-line rule needs one source URL.`);
}

// The checklist is the table of contents: every rule of the file has a row, and rows match the rules.
function checkChecklist(rf) {
  const { doc, checklist } = rf;
  const own = new Map(rf.rules.map((r) => [r.id, r]));
  const listed = new Set();
  let pointerLines = 0;
  for (let i = checklist.start; i < checklist.end; i++) {
    const line = doc.lines[i];
    let hasPointer = false;
    for (const m of line.matchAll(ID_RE)) {
      listed.add(m[0]);
      if (refKind(line, m.index) !== 'pointer') continue;
      hasPointer = true;
      if (own.has(m[0])) {
        error(doc.rel, i + 1, `→ ${m[0]} points into this file. Give ${m[0]} its own checklist row instead.`);
        handledRefs.add(`${doc.rel}:${i + 1}:${m[0]}`);
      }
    }
    if (hasPointer) pointerLines++;
  }
  if (pointerLines > LIMITS.checklistPointerLines) {
    warn(doc.rel, checklist.start, `The checklist has ${pointerLines} "→ ID" lines; the target is ${LIMITS.checklistPointerLines} at most.`);
  }
  for (const [id, rule] of own) {
    if (EXACT_ID_RE.test(id) && !listed.has(id)) error(doc.rel, rule.i + 1, `${id} is missing from the checklist. The checklist is the table of contents: add a row.`);
  }
  for (const row of tableRows(doc, checklist)) {
    if (row.header) continue;
    const id = plain(row.cells[0]);
    if (!EXACT_ID_RE.test(id)) continue;
    const rule = own.get(id);
    if (!rule) {
      const home = defs.get(id)?.[0];
      error(doc.rel, row.i + 1, home ? `${id} lives in ${home.rel}. Write "→ ${id}" here instead of a row: a rule has one home.` : `The checklist row ${id} has no rule in this file.`);
      handledRefs.add(`${doc.rel}:${row.i + 1}:${id}`);
      continue;
    }
    if (!rule.info) continue;
    const rest = row.cells.slice(1).map(plain);
    const impact = rest.find((c) => IMPACTS.includes(c));
    if (impact && rule.info.impact && impact !== rule.info.impact) {
      error(doc.rel, row.i + 1, `${id}: the checklist says impact "${impact}", but the rule says "${rule.info.impact}".`);
    }
    const stage = rest.map(list).find((words) => words.length && words.every((w) => vocab.stages.includes(w)));
    if (stage && rule.info.stages.length && stage[0] !== rule.info.stages[0]) {
      error(doc.rel, row.i + 1, `${id}: the checklist says first stage "${stage[0]}", but the rule says "${rule.info.stages[0]}".`);
    }
  }
}

// ------------------------------------------------------------------ SKILL.md

function checkSkill(doc) {
  if (!doc) {
    skip('SKILL.md checks', 'SKILL.md is missing');
    return;
  }
  const rel = doc.rel;
  if (doc.lines[0] !== '---') error(rel, 1, 'Line 1 must be "---": Claude Code reads the frontmatter only when it starts on the first line.');
  else {
    const end = doc.lines.indexOf('---', 1);
    if (end < 0) error(rel, 1, 'The frontmatter has no closing "---".');
    else checkFrontmatter(rel, parseFrontmatter(doc.lines.slice(1, end)));
  }

  doc.lines.forEach((line, i) => {
    for (const m of line.matchAll(/\$(?:ARGUMENTS\b|\d)/g)) {
      const backslashes = line.slice(0, m.index).match(/\\*$/)[0].length;
      if (backslashes === 1) continue; // one backslash escapes the placeholder
      error(rel, i + 1, `"${m[0]}" is an argument placeholder, and Claude Code replaces it. Write "\\${m[0].slice(1)}" or rephrase. The skill reads arguments from the "ARGUMENTS: <value>" line.`);
    }
  });

  if (!vocab.fromPipeline) return;
  const sec = section(doc, /pipeline on one screen/i);
  if (!sec) {
    warn(rel, null, 'No "## The pipeline on one screen" section, so its stages cannot be compared with pipeline.md §J.');
    return;
  }
  const rows = tableRows(doc, sec);
  const header = rows.find((r) => r.header);
  const col = header ? header.cells.findIndex((c) => /stage/i.test(c)) : 1;
  const words = new Set(rows.filter((r) => !r.header).flatMap((r) => codeSpans(r.cells[col] ?? '')));
  for (const stage of vocab.stages) {
    if (!words.has(stage)) error(rel, sec.heading.i + 1, `The pipeline table lacks the stage "${stage}" from pipeline.md §J.`);
  }
  for (const word of words) {
    if (!vocab.stages.includes(word)) error(rel, sec.heading.i + 1, `The pipeline table has the stage "${word}", which pipeline.md §J does not list.`);
  }
}

function checkFrontmatter(rel, fm) {
  for (const [key, { bad, why }] of Object.entries(FRONTMATTER_BANS)) {
    if (Object.hasOwn(fm, key) && bad(fm[key].trim())) error(rel, null, `Remove "${key}" from the frontmatter: ${why}.`);
  }
  const description = fm.description ?? '';
  const whenToUse = fm.when_to_use ?? '';
  if (!description.trim()) error(rel, null, 'The frontmatter needs a "description".');
  const total = description.length + whenToUse.length;
  if (total > LIMITS.listingChars) {
    error(rel, null, `description (${num(description.length)}) + when_to_use (${num(whenToUse.length)}) = ${num(total)} characters; the skill listing cuts at ${num(LIMITS.listingChars)}.`);
  }
  facts.push(['Frontmatter', `description ${num(description.length)} + when_to_use ${num(whenToUse.length)} = ${num(total)} / ${num(LIMITS.listingChars)} characters`]);
}

// A small YAML reader for flat frontmatter: plain, quoted and block (| or >) scalars.
function parseFrontmatter(lines) {
  const out = {};
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
    i++;
    if (!m) continue;
    const continuation = [];
    while (i < lines.length && (!lines[i].trim() || /^\s/.test(lines[i]))) continuation.push(lines[i++]);
    out[m[1]] = yamlScalar((m[2] ?? '').trim(), continuation);
  }
  return out;
}

function yamlScalar(first, continuation) {
  const block = first.match(/^([>|])(?:([+-])\d?|\d([+-])?)?\s*(?:#.*)?$/);
  if (block) return yamlBlock(block[1], block[2] ?? block[3] ?? '', continuation);
  let text = '';
  let breaks = 0;
  for (const part of [first, ...continuation.map((l) => l.trim())]) {
    if (!part) {
      breaks++;
      continue;
    }
    if (text) text += breaks ? '\n'.repeat(breaks) : ' ';
    text += part;
    breaks = 0;
  }
  if (/^".*"$/s.test(text)) return text.slice(1, -1).replace(/\\(["\\])/g, '$1').replace(/\\n/g, '\n');
  if (/^'.*'$/s.test(text)) return text.slice(1, -1).replace(/''/g, "'");
  return text.replace(/\s+#.*$/, '');
}

function yamlBlock(style, chomp, continuation) {
  const firstText = continuation.find((l) => l.trim());
  if (firstText === undefined) return '';
  const indent = firstText.match(/^ */)[0].length;
  const body = continuation.map((l) => (l.trim() ? l.slice(indent) : ''));
  let trailing = 0;
  while (body.length && !body.at(-1)) {
    body.pop();
    trailing++;
  }
  let text = '';
  if (style === '|') text = body.join('\n');
  else {
    // Folded: lines join with a space; an empty line is a line break; more-indented lines keep their breaks.
    let previous = null;
    for (const line of body) {
      if (!line) {
        text += '\n';
        previous = 'empty';
        continue;
      }
      const more = /^\s/.test(line);
      if (previous === 'text' && !more) text += ' ';
      else if (previous === 'more' || (previous === 'text' && more)) text += '\n';
      text += line;
      previous = more ? 'more' : 'text';
    }
  }
  if (chomp === '-') return text;
  if (chomp === '+') return `${text}\n${'\n'.repeat(trailing)}`;
  return `${text}\n`;
}

// ------------------------------------------------------------------ IDs across the skill

function checkIdHistory() {
  for (const [id, places] of defs) {
    for (const place of places.slice(1)) error(place.rel, place.line, `${id} is defined twice; the first is at ${places[0].rel}:${places[0].line}. IDs are unique.`);
  }
  if (!maintainingDoc) {
    skip('Retired IDs and ID gaps', 'maintenance/MAINTAINING.md is missing');
    return;
  }
  for (const [id, entry] of retired) {
    const place = defs.get(id)?.[0];
    if (place) error(place.rel, place.line, `${id} is retired (MAINTAINING.md, line ${entry.line}). Never reuse an ID: take ${nextFree(id.split('-')[0])}.`);
    for (const target of entry.replacedBy) if (!defs.has(target)) resolveFail(maintainingDoc.rel, entry.line, target, 'mention');
  }
  const next = [];
  for (const prefix of PREFIXES.filter((p) => prefixesPresent.has(p))) {
    const home = ruleFiles.find((rf) => rf.prefix === prefix).doc.rel;
    const top = maxNumber(prefix);
    for (let n = 1; n <= top; n++) {
      const id = formatId(prefix, n);
      const defined = defs.get(id)?.some((d) => d.filePrefix === prefix);
      if (!defined && !retired.has(id)) {
        error(home, null, `${id} is missing. A removed rule leaves a gap that is never reused: add ${id} to "Retired rule IDs" in MAINTAINING.md. Before the first release, you may renumber instead.`);
      }
    }
    next.push(nextFree(prefix));
  }
  if (next.length) facts.push(['Next free IDs', next.join(' ')]);
}

function maxNumber(prefix) {
  const numbers = [...defs.entries()]
    .filter(([, places]) => places.some((d) => d.filePrefix === prefix))
    .map(([id]) => id)
    .concat([...retired.keys()])
    .filter((id) => id.startsWith(`${prefix}-`))
    .map((id) => Number(id.split('-')[1]));
  return Math.max(0, ...numbers);
}
const formatId = (prefix, n) => `${prefix}-${String(n).padStart(2, '0')}`;
const nextFree = (prefix) => formatId(prefix, maxNumber(prefix) + 1);

function resolveFail(rel, line, id, kind) {
  const entry = retired.get(id);
  if (entry) {
    const to = entry.replacedBy.length ? entry.replacedBy.join(', ') : 'the rule that replaced it';
    error(rel, line, `${id} is retired (MAINTAINING.md, line ${entry.line}). Point to ${to} instead.`);
    return;
  }
  const prefix = id.split('-')[0];
  if (!prefixesPresent.has(prefix)) {
    skip(`${prefix}- references`, `no ${prefix}- rule file yet`);
    return;
  }
  const label = { pointer: `→ ${id}`, also: `also: ${id}`, crosswalk: `The crosswalk row's ${id}` }[kind] ?? id;
  error(rel, line, `${label} does not resolve: no rule has the ID ${id}.`);
}

// Every rule ID named in SKILL.md or a reference file must exist.
function checkReferences() {
  for (const doc of markdownDocs) {
    doc.lines.forEach((line, i) => {
      for (const m of line.matchAll(ID_RE)) {
        if (defs.has(m[0]) || handledRefs.has(`${doc.rel}:${i + 1}:${m[0]}`)) continue;
        resolveFail(doc.rel, i + 1, m[0], refKind(line, m.index));
      }
    });
  }
  checkFileAndRecipePointers();
}

// "references/x.md", "scripts/x.mjs", "x.md" and "measure.md#recipe" must point to something that exists.
function checkFileAndRecipePointers() {
  const refNames = new Set([...Object.keys(FILES), ...extraRefs].filter((rel) => rel.startsWith('references/')).map((rel) => rel.slice('references/'.length)));
  for (const doc of markdownDocs) {
    doc.lines.forEach((line, i) => {
      const urls = urlSpans(line);
      for (const m of line.matchAll(/\b(?:references|scripts|assets|evals|maintenance)\/[\w./*{},-]+/g)) {
        const path = m[0].replace(/[.,]+$/, '');
        if (inSpans(urls, m.index) || /[*{]/.test(path) || Object.hasOwn(FILES, path) || existsSync(join(ROOT, path))) continue;
        error(doc.rel, i + 1, `"${path}" does not exist in the skill.`);
      }
      for (const m of line.matchAll(/(?<![\w/.-])[a-z0-9][a-z0-9-]*\.md\b/g)) {
        if (!inSpans(urls, m.index) && !refNames.has(m[0])) error(doc.rel, i + 1, `"${m[0]}" is not a file in references/.`);
      }
      for (const m of line.matchAll(/measure\.md#([\w-]+)/g)) {
        if (!recipes) skip('measure.md#<recipe> pointers', 'references/measure.md is missing');
        else if (!recipes.has(m[1])) error(doc.rel, i + 1, `measure.md#${m[1]} does not resolve: measure.md has no recipe "#${m[1]}".`);
      }
    });
  }
}

function checkCrosswalk(doc) {
  if (!doc) {
    skip('Crosswalk', 'maintenance/crosswalk.tsv is missing');
    return;
  }
  let firstRow = true;
  doc.lines.forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    const cells = line.split('\t');
    const target = (cells[2] ?? '').trim();
    const ids = target.match(ID_RE) ?? [];
    const dropped = /^dropped\b/i.test(target);
    // "-> <file>[ §X]" points a note item at a file without rules (pipeline, measure, review, support, SKILL.md).
    const pointer = target.match(/^->\s*([\w.-]+\.md)\b/);
    const unmapped = /^unmapped\b/i.test(target);
    const isHeader = firstRow && !ids.length && !dropped && !pointer && !unmapped;
    firstRow = false;
    if (isHeader) return;
    if (cells.length < 3) error(doc.rel, i + 1, 'A row needs 3 tab-separated columns: source file, heading, rule ID, "-> <file>", or "dropped: <reason>".');
    else if (dropped) {
      if (!/^dropped:\s*\S/i.test(target)) error(doc.rel, i + 1, 'Write "dropped: <reason>".');
    } else if (unmapped) warn(doc.rel, i + 1, 'Unmapped note item: give it a rule ID, "-> <file>", or "dropped: <reason>".');
    else if (pointer && !ids.length) {
      const file = pointer[1] === 'SKILL.md' ? 'SKILL.md' : `references/${pointer[1]}`;
      if (!existsSync(join(ROOT, file)) && file !== "SKILL.md") error(doc.rel, i + 1, `"${target}" points to ${file}, which does not exist.`);
    } else if (!ids.length) error(doc.rel, i + 1, `"${target}" is neither a rule ID, "-> <file>", nor "dropped: <reason>".`);
    else for (const id of ids) if (!defs.has(id)) resolveFail(doc.rel, i + 1, id, 'crosswalk');
  });
}

// ------------------------------------------------------------------ versions, dates, JSON, sizes

function checkVersionsAndDates() {
  const targets = [
    ...markdownDocs.filter((d) => d.rel !== 'references/support.md').map((d) => [d, TEXT_PATTERNS]),
    ...[...listDir('scripts'), ...listDir('assets')].map((rel) => [docs.get(rel) ?? load(rel), CODE_PATTERNS]),
  ];
  for (const [doc, patterns] of targets) {
    doc.lines.forEach((line, i) => {
      const urls = urlSpans(line);
      for (const { what, re } of patterns) {
        for (const m of line.matchAll(re)) {
          if (inSpans(urls, m.index)) warn(doc.rel, i + 1, `The ${what} "${m[0]}" is inside a URL. Prefer a URL without it; support.md holds the checked version.`);
          else error(doc.rel, i + 1, `The ${what} "${m[0]}" is outside support.md. Versions and dates live only in references/support.md: name the support key or section instead.`);
        }
      }
    });
  }
}

function checkJson() {
  for (const [rel, doc] of docs) {
    if (!rel.endsWith('.json')) continue;
    try {
      JSON.parse(doc.text);
    } catch (e) {
      error(rel, null, `Not valid JSON: ${e.message}`);
    }
  }
}

function checkSizes() {
  const rows = [];
  for (const [rel, spec] of Object.entries(FILES)) {
    const doc = docs.get(rel);
    if (!doc) {
      rows.push(['missing', rel, '']);
      continue;
    }
    const n = doc.lines.length;
    if (rel === 'SKILL.md') {
      const chars = doc.text.length;
      if (n > LIMITS.skillLines) error(rel, null, `${n} lines; the limit is ${LIMITS.skillLines}.`);
      if (chars > LIMITS.skillChars) {
        error(rel, null, `${num(chars)} characters; the limit is ${num(LIMITS.skillChars)}, so that all of SKILL.md survives compaction. Move "Router: symptoms" to pipeline.md §G first.`);
      }
      const over = n > LIMITS.skillLines || chars > LIMITS.skillChars;
      rows.push([over ? 'over' : 'ok', rel, `${n} / ${LIMITS.skillLines} lines, ${num(chars)} / ${num(LIMITS.skillChars)} characters`]);
    } else if (spec.budget) {
      const limit = Math.min(Math.floor((spec.budget * (100 + LIMITS.budgetSlackPercent)) / 100), spec.splitAt ?? Infinity);
      if (spec.splitAt && n > spec.splitAt) error(rel, null, `${n} lines, past ${spec.splitAt}: ${spec.split}.`);
      else if (n > limit) {
        const fix = spec.prefix ? 'Cut the lowest-impact rules first.' : 'Claude reads this file into its context: shorten it.';
        error(rel, null, `${n} lines; the budget is ${spec.budget} + ${LIMITS.budgetSlackPercent}% = ${limit}. ${fix}`);
      }
      rows.push([n > limit ? 'over' : 'ok', rel, `${n} / ${limit} lines`]);
    } else rows.push(['ok', rel, `${n} lines`]);
  }
  for (const rel of extraRefs) {
    warn(rel, null, 'This file is not in FILES in lint-skill.mjs, so it has no line budget. Add it.');
    rows.push(['no budget', rel, `${docs.get(rel).lines.length} lines`]);
  }
  return rows;
}

// ------------------------------------------------------------------ report

function printReport() {
  const out = [`web-performance skill lint · ${ROOT} · ${iso(OPTS.today)}${OPTS.release ? ' · release mode' : ''}`, '', 'Files'];
  for (const [status, rel, size] of fileRows) out.push(`  ${status.padEnd(10)}${rel.padEnd(42)}${size}`.trimEnd());

  const full = ruleFiles.reduce((n, rf) => n + rf.rules.filter((r) => r.type === 'full').length, 0);
  const oneLine = ruleFiles.reduce((n, rf) => n + rf.rules.filter((r) => r.type === 'one-line').length, 0);
  facts.unshift(['Rules', `${full} full and ${oneLine} one-line, in ${plural(ruleFiles.length, 'rule file')}; ${plural(retired.size, 'retired ID')}`]);
  out.push('', 'Facts', ...facts.map(([k, v]) => `  ${k}: ${v}`));

  if (notChecked.size) {
    out.push('', 'Not checked');
    for (const [what, { why, count }] of notChecked) out.push(`  ${what}: ${why}${count > 1 ? ` (${count} times)` : ''}`);
  }

  const byPlace = (a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0);
  const errors = findings.filter((f) => f.level === 'error').sort(byPlace);
  const warnings = findings.filter((f) => f.level === 'warn').sort(byPlace);
  for (const [title, items] of [
    ['Errors', errors],
    ['Warnings', warnings],
  ]) {
    if (!items.length) continue;
    out.push('', `${title} (${items.length})`);
    for (const f of items) out.push(`  ${f.file}${f.line ? `:${f.line}` : ''}  ${f.msg}`);
  }

  const failed = errors.length > 0 || (OPTS.release && (warnings.length > 0 || missing.length > 0));
  const counts = `${plural(errors.length, 'error')}, ${plural(warnings.length, 'warning')}, ${plural(missing.length, 'file')} missing`;
  const note = OPTS.release ? '' : ' (missing files and warnings fail only with --release)';
  out.push('', `${failed ? 'FAIL' : 'PASS'}: ${counts}${note}.`);
  console.log(out.join('\n'));
  process.exitCode = failed ? 1 : 0;
}

// ------------------------------------------------------------------ run (at the end, so that every helper above is defined)

const docs = new Map();
const missing = [];
for (const rel of Object.keys(FILES)) {
  const doc = load(rel);
  if (doc) docs.set(rel, doc);
  else missing.push(rel);
}
const extraRefs = listDir('references').filter((rel) => rel.endsWith('.md') && !Object.hasOwn(FILES, rel));
for (const rel of extraRefs) docs.set(rel, load(rel));

const skillDoc = docs.get('SKILL.md');
const supportDoc = docs.get('references/support.md');
const maintainingDoc = docs.get('maintenance/MAINTAINING.md');
const markdownDocs = [...docs.values()].filter((d) => d.rel === 'SKILL.md' || d.rel.startsWith('references/'));

const vocab = readStages(docs.get('references/pipeline.md'));
const support = readSupport(supportDoc);
const recipes = readRecipes(docs.get('references/measure.md'));
const retired = readRetired(maintainingDoc);

const ruleFiles = findRuleFiles();
const prefixesPresent = new Set(ruleFiles.map((rf) => rf.prefix));
const defs = registerRules(); // ID → [{ rel, line, filePrefix }]

checkSkill(skillDoc);
for (const rf of ruleFiles) checkRuleFile(rf);
checkIdHistory();
checkCrosswalk(docs.get('maintenance/crosswalk.tsv'));
checkReferences();
checkVersionsAndDates();
checkJson();
const fileRows = checkSizes();
printReport();
