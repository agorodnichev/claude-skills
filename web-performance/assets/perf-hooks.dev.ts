/**
 * Dev-only performance hooks: WebMCP scenario tools plus a `window.__perf` fallback.
 * Template from the web-performance skill. Copy it into a project only with the owner's approval,
 * then write a `PerfAdapter` for the app (fixtures, scenarios, reset, counters).
 *
 * Load it only in development, so the bundler drops it from production builds:
 *   if (import.meta.env.DEV) {
 *     const { registerPerfHooks } = await import('./perf-hooks.dev');
 *     const dispose = registerPerfHooks(adapter);
 *     import.meta.hot?.dispose(dispose);
 *   }
 * Production servers should also send `Permissions-Policy: tools=()`.
 *
 * Any agent or extension on the page can call these tools. Keep them harmless: seeded local data
 * and measurement only; no network writes, no purchases or other irreversible actions, no account data.
 * Measured-window rule: call load_fixture_data before performance_start_trace, call only run_scenario
 * inside the trace, and read get_frame_stats or get_perf_summary after the trace stops.
 * A WebMCP call that fails still reports "Completed"; its output is { error: <message> }.
 * WebMCP is Chromium-only and experimental (see the skill's support.md). Without it, use the same API with
 * evaluate_script, for example `() => window.__perf.run('pan', { seconds: 5 })`.
 */

export const SCENARIOS = ['stream', 'scroll', 'pan', 'zoom', 'hover', 'drag', 'switch_view', 'toggle_panel'] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

/** Clamped: seconds 1–30 (default 5), repeat 1–50 (default 10), rate 1–5000 updates per second (default 300). */
export interface ScenarioOptions { seconds: number; repeat: number; rate: number }

export interface PerfAdapter {
  /** Seeded local fixtures by name. Resolve when the data is on screen. */
  fixtures: Record<string, (signal: AbortSignal) => Promise<{ points: number }>>;
  /** The scenarios this app supports. Each one must stop when `signal` aborts. */
  scenarios: Partial<Record<ScenarioName, (options: ScenarioOptions, signal: AbortSignal) => Promise<void>>>;
  /** Return the app to its start state. */
  reset(): void | Promise<void>;
  /** Counts that must return to baseline, for example { surfaces: 2, series: 8, wasmMb: 64 }. */
  counters?(): Record<string, number>;
}

export interface FrameStats {
  frames: number; hz: number; p50Ms: number; p95Ms: number; p99Ms: number; maxGapMs: number; over16_7: number; over33: number;
}

export interface PerfApi {
  loadFixture(name: string, signal?: AbortSignal): Promise<{ fixture: string; points: number; ms: number }>;
  run(name: ScenarioName, options?: Partial<ScenarioOptions>, signal?: AbortSignal): Promise<{ scenario: ScenarioName; ms: number } & ScenarioOptions>;
  frameStats(durationMs?: number, signal?: AbortSignal): Promise<FrameStats>;
  summary(): { last: { scenario: ScenarioName; ms: number } | null; loaf: { count: number; blockingMs: number; worstMs: number }; counters: Record<string, number> };
  reset(): Promise<{ reset: true }>;
  counters(): Record<string, number>;
}

declare global {
  interface Window { __perf?: PerfApi }
}

interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: object;
  annotations?: { readOnlyHint?: boolean };
  execute(input: Record<string, unknown>, context?: { signal?: AbortSignal }): Promise<unknown>;
}
interface ModelContext { registerTool(tool: WebMcpTool, options: { signal: AbortSignal }): Promise<unknown> }

const r1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const pct = (sorted: Float64Array, p: number) => (sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0 : 0);

/** rAF intervals into a preallocated array; statistics only after sampling ends. */
function sampleFrames(durationMs: number, signal: AbortSignal): Promise<FrameStats> {
  const buf = new Float64Array(Math.ceil(durationMs / 4) + 2);
  let n = 0, first = 0, last = 0, raf = 0;
  return new Promise((resolve) => {
    const done = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      const d = buf.slice(0, n).sort();
      const over = (ms: number) => d.filter((v) => v > ms).length;
      // Refresh period: the median of the fast cluster. rAF timestamps jitter by about ±25% in Chrome,
      // so a low percentile alone reads 149 Hz on a 120 Hz display.
      const cap = pct(d, 0.1) * 1.75;
      const vsync = pct(d.filter((v) => v < cap), 0.5);
      resolve({
        frames: n, hz: vsync ? Math.round(1000 / vsync) : 0, p50Ms: r1(pct(d, 0.5)), p95Ms: r1(pct(d, 0.95)),
        p99Ms: r1(pct(d, 0.99)), maxGapMs: r1(pct(d, 1)), over16_7: over(16.7), over33: over(33),
      });
    };
    const tick = (t: number) => {
      if (last && n < buf.length) buf[n++] = t - last;
      else if (!last) first = t;
      last = t;
      if (t - first >= durationMs) done();
      else raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(done, durationMs + 1000); // a hidden page never runs rAF
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
    else raf = requestAnimationFrame(tick);
  });
}

export function registerPerfHooks(app: PerfAdapter): () => void {
  const life = new AbortController();
  const withLife = (signal?: AbortSignal) => (signal ? AbortSignal.any([life.signal, signal]) : life.signal);
  let running = false;
  let last: { scenario: ScenarioName; ms: number } | null = null;
  const loaf = { count: 0, blockingMs: 0, worstMs: 0 };
  const loafObserver = new PerformanceObserver((list) => {
    for (const f of list.getEntries() as unknown as { duration: number; blockingDuration: number }[]) {
      loaf.count++;
      loaf.blockingMs += f.blockingDuration;
      loaf.worstMs = Math.max(loaf.worstMs, f.duration);
    }
  });
  loafObserver.observe({ type: 'long-animation-frame' });
  const clearMarks = () => {
    performance.clearMarks('wp:start');
    performance.clearMarks('wp:end');
    performance.clearMeasures('wp:scenario');
  };

  const api: PerfApi = {
    async loadFixture(name, signal) {
      const load = Object.hasOwn(app.fixtures, name) ? app.fixtures[name] : undefined;
      if (!load) throw new Error(`Unknown fixture "${name}". Known: ${Object.keys(app.fixtures).join(', ')}`);
      const t0 = performance.now();
      const { points } = await load(withLife(signal));
      return { fixture: name, points, ms: r1(performance.now() - t0) };
    },
    async run(name, options = {}, signal) {
      const scenario = Object.hasOwn(app.scenarios, name) ? app.scenarios[name] : undefined;
      if (!scenario) throw new Error(`Unknown scenario "${name}". Known: ${Object.keys(app.scenarios).join(', ')}`);
      if (running) throw new Error('A scenario is already running.');
      running = true;
      const opts: ScenarioOptions = {
        seconds: clamp(options.seconds, 1, 30, 5),
        repeat: Math.round(clamp(options.repeat, 1, 50, 10)),
        rate: Math.round(clamp(options.rate, 1, 5000, 300)),
      };
      clearMarks();
      Object.assign(loaf, { count: 0, blockingMs: 0, worstMs: 0 });
      // trace-summary.mjs --between wp:start wp:end windows the trace with these marks.
      performance.mark('wp:start', { detail: name });
      try {
        await scenario(opts, withLife(signal));
      } finally {
        performance.mark('wp:end');
        running = false;
      }
      const ms = r1(performance.measure('wp:scenario', 'wp:start', 'wp:end').duration);
      last = { scenario: name, ms };
      return { scenario: name, ms, ...opts };
    },
    frameStats: (durationMs, signal) => sampleFrames(clamp(durationMs, 200, 10_000, 2000), withLife(signal)),
    summary: () => ({
      last,
      loaf: { count: loaf.count, blockingMs: r1(loaf.blockingMs), worstMs: r1(loaf.worstMs) },
      counters: api.counters(),
    }),
    async reset() {
      await app.reset();
      clearMarks();
      last = null;
      return { reset: true };
    },
    counters: () => app.counters?.() ?? {},
  };
  window.__perf = api;

  const mc = (document as Document & { modelContext?: ModelContext }).modelContext;
  if (mc) {
    const tools: WebMcpTool[] = [
      {
        name: 'load_fixture_data',
        description: 'Dev only. Loads a seeded local data fixture (no network) and returns its point count and load time in ms. Call it before a performance trace starts.',
        inputSchema: { type: 'object', properties: { fixture: { type: 'string', enum: Object.keys(app.fixtures) } }, required: ['fixture'] },
        execute: (input, context) => api.loadFixture(String(input.fixture), context?.signal),
      },
      {
        name: 'run_scenario',
        description: 'Dev only. Runs one named, time-boxed UI scenario between the performance marks wp:start and wp:end, and returns its duration in ms. The only hook to call inside a trace.',
        inputSchema: {
          type: 'object',
          properties: {
            scenario: { type: 'string', enum: Object.keys(app.scenarios) },
            seconds: { type: 'number', description: 'Length of timed scenarios, 1 to 30. Default 5.' },
            repeat: { type: 'number', description: 'Repetitions of discrete actions, 1 to 50. Default 10.' },
            rate: { type: 'number', description: 'Updates per second for stream, 1 to 5000. Default 300.' },
          },
          required: ['scenario'],
        },
        execute: (input, context) => api.run(input.scenario as ScenarioName, input as Partial<ScenarioOptions>, context?.signal),
      },
      {
        name: 'get_frame_stats',
        description: 'Dev only. Samples requestAnimationFrame intervals for durationMs (200 to 10000, default 2000) and returns the frame count, refresh rate and interval percentiles in ms. Call it outside a trace.',
        annotations: { readOnlyHint: true },
        inputSchema: { type: 'object', properties: { durationMs: { type: 'number' } } },
        execute: (input, context) => api.frameStats(input.durationMs as number | undefined, context?.signal),
      },
      {
        name: 'get_perf_summary',
        description: 'Dev only. Returns the last scenario duration, long-animation-frame totals since that scenario started, and app counters.',
        annotations: { readOnlyHint: true },
        inputSchema: { type: 'object', properties: {} },
        execute: async () => api.summary(),
      },
      {
        name: 'reset_state',
        description: 'Dev only. Returns the app to its start state and clears the wp: performance marks.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => api.reset(),
      },
    ];
    // A duplicate name rejects, so dispose() must run (HMR, unmount) before the next registration.
    // Chrome drops the message of an error thrown by execute() (see support.md, WebMCP row; execute_webmcp_tool prints
    // {"status":"Error","errorText":""}), so a failed call returns { error: <message> } instead.
    const register = async (tool: WebMcpTool) => {
      const execute: WebMcpTool['execute'] = async (input, context) => {
        try {
          return await tool.execute(input, context);
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      };
      try {
        await mc.registerTool({ ...tool, execute }, { signal: life.signal });
      } catch (error) {
        console.warn(`[perf-hooks] ${tool.name} was not registered`, error);
      }
    };
    for (const tool of tools) void register(tool);
  }

  return () => {
    life.abort();
    loafObserver.disconnect();
    if (window.__perf === api) delete window.__perf;
  };
}
