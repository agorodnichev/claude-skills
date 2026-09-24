() => {
  // web-performance skill: page probes for chrome-devtools-mcp `evaluate_script` (Chromium only).
  // Pass this whole file as `function` (waitForStableDom: false) after each navigation. The first call
  // installs window.__wpProbe; later calls keep the running observers. To observe from the first byte,
  // pass `(<this file>)()` as the `initScript` of navigate_page. Every result is compact JSON.
  // Calls: env() · frame.start()/stop() · interaction.start()/read() · shift.start()/read() ·
  //        loaf.start()/read() · paint() · memory.start()/sample({ uaMemory }) · dispose()
  // The file starts with the function on purpose: text before it can break the tool's wrapper.
  const VERSION = 2; // bump on every change, so a reinstall replaces an older probe in an open page
  const prev = window.__wpProbe;
  if (prev?.version === VERSION) return { installed: false, version: VERSION, note: 'already installed; observers kept' };
  prev?.dispose?.();

  const r1 = (v) => Math.round(v * 10) / 10;
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const kb = (bytes) => Math.round(bytes / 1024);
  const cut = (s) => (s && s.length > 80 ? s.slice(0, 79) + '…' : s || undefined);
  const file = (url) => (url ? url.split(/[?#]/)[0].split('/').pop() : undefined);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  // Nearest-rank percentile of a sorted array.
  const pct = (sorted, p) => (sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : 0);
  const describe = (node) => {
    if (!node) return null;
    if (node.nodeType !== 1) return node.nodeName.toLowerCase();
    return node.localName + (node.id ? '#' + node.id : node.classList.length ? '.' + node.classList[0] : '');
  };

  // Observers run from install time with buffered: true, so entries from before the install count too.
  const observers = [];
  const observe = (type, extra, handle) => {
    const po = new PerformanceObserver((list) => handle(list.getEntries()));
    po.observe({ type, buffered: true, ...extra });
    observers.push({ po, handle });
  };
  const flush = () => { for (const o of observers) o.handle(o.po.takeRecords()); };

  // Event Timing, grouped by interactionId. Subparts: input delay, processing, presentation delay.
  const ix = { since: 0, byId: new Map(), count0: 0 };
  observe('event', { durationThreshold: 16 }, (entries) => {
    for (const e of entries) {
      if (!e.interactionId || e.startTime < ix.since) continue;
      let g = ix.byId.get(e.interactionId);
      if (!g) {
        if (ix.byId.size >= 300) ix.byId.delete(ix.byId.keys().next().value);
        g = { types: new Set(), target: null, start: e.startTime, pStart: e.processingStart, pEnd: 0, end: 0, latency: 0 };
        ix.byId.set(e.interactionId, g);
      }
      g.types.add(e.name);
      g.target ??= describe(e.target);
      g.start = Math.min(g.start, e.startTime);
      g.pStart = Math.min(g.pStart, e.processingStart);
      g.pEnd = Math.max(g.pEnd, e.processingEnd);
      g.end = Math.max(g.end, e.startTime + e.duration);
      g.latency = Math.max(g.latency, e.duration);
    }
  });

  const ls = { since: 0, list: [] };
  observe('layout-shift', {}, (entries) => {
    for (const e of entries) {
      if (e.startTime < ls.since || ls.list.length >= 1000) continue;
      ls.list.push({ t: e.startTime, v: e.value, input: e.hadRecentInput, src: e.sources.slice(0, 3).map((s) => describe(s.node)) });
    }
  });

  // Long animation frames. `total*` never reset, so frame windows can take differences.
  const lf = { since: 0, count: 0, blocking: 0, maxMs: 0, worst: [], scripts: new Map(), total: 0, totalBlocking: 0 };
  observe('long-animation-frame', {}, (entries) => {
    for (const f of entries) {
      lf.total++;
      lf.totalBlocking += f.blockingDuration;
      if (f.startTime < lf.since) continue;
      lf.count++;
      lf.blocking += f.blockingDuration;
      lf.maxMs = Math.max(lf.maxMs, f.duration);
      lf.worst.push({
        t: r1(f.startTime), ms: r1(f.duration), blockingMs: r1(f.blockingDuration),
        styleLayoutMs: f.styleAndLayoutStart ? r1(f.startTime + f.duration - f.styleAndLayoutStart) : 0,
        ui: f.firstUIEventTimestamp > 0,
      });
      lf.worst.sort((a, b) => b.blockingMs - a.blockingMs);
      if (lf.worst.length > 3) lf.worst.length = 3;
      for (const s of f.scripts) {
        const key = `${s.invokerType}|${s.invoker}|${s.sourceURL}|${s.sourceFunctionName}`;
        let a = lf.scripts.get(key);
        if (!a) {
          if (lf.scripts.size >= 500) continue;
          a = { ms: 0, n: 0, forcedLayoutMs: 0, type: s.invokerType, invoker: cut(s.invoker), src: file(s.sourceURL), fn: s.sourceFunctionName || undefined };
          lf.scripts.set(key, a);
        }
        a.ms += s.duration;
        a.n++;
        a.forcedLayoutMs += s.forcedStyleAndLayoutDuration;
      }
    }
  });

  // rAF intervals go into a preallocated array; statistics are computed only in stop().
  const fr = { buf: null, n: 0, last: 0, raf: 0, loaf0: null };
  const tick = (t) => {
    if (fr.last && fr.n < fr.buf.length) fr.buf[fr.n++] = t - fr.last;
    fr.last = t;
    fr.raf = requestAnimationFrame(tick);
  };

  const mem = { first: null, n: 0 };

  const probe = {
    version: VERSION,

    // Creates one short-lived WebGL2 context. Past the live-context cap the browser drops the oldest
    // context, so on a page with many charts call env() first, or on about:blank in the same browser.
    async env() {
      // The DevTools MCP `emulate` tool empties userAgentData (no brands, no platform), so call env() before emulate.
      const hints = await navigator.userAgentData?.getHighEntropyValues(['fullVersionList', 'platformVersion']);
      const hi = hints?.fullVersionList?.length ? hints : null;
      const brand = (re) => hi?.fullVersionList?.find((b) => re.test(b.brand));
      const b = brand(/Edge/) ?? brand(/Google Chrome/) ?? brand(/Chromium/);
      const gl = document.createElement('canvas').getContext('webgl2');
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      const glRenderer = gl ? gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : null;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      const adapter = await navigator.gpu?.requestAdapter();
      const webgpu = adapter ? { vendor: adapter.info.vendor, arch: adapter.info.architecture, fallback: adapter.info.isFallbackAdapter } : null;
      const warnings = [];
      if (/SwiftShader|llvmpipe|softpipe|Basic Render Driver|Software/i.test(glRenderer ?? '') || webgpu?.fallback) warnings.push('software renderer: reject frame and GPU runs');
      if (document.visibilityState !== 'visible') warnings.push('page hidden: rAF is paused');
      if (!isSecureContext) warnings.push('insecure context: no userAgentData and no WebGPU');
      else if (!hi) warnings.push('userAgentData is empty (emulate clears it): run env() before emulate for the full version');
      return {
        browser: b ? `${b.brand} ${b.version}` : navigator.userAgent.match(/(Edg|Chrome)\/[\d.]+/)?.[0] ?? null,
        platform: hi ? `${hi.platform} ${hi.platformVersion}` : navigator.platform,
        dpr: devicePixelRatio, viewport: `${innerWidth}x${innerHeight}`, glRenderer, webgpu,
        cores: navigator.hardwareConcurrency, deviceMemoryGB: navigator.deviceMemory, crossOriginIsolated,
        webmcp: 'modelContext' in document, perfHooks: Boolean(window.__perf), warnings,
      };
    },

    frame: {
      start({ maxFrames = 12000 } = {}) {
        cancelAnimationFrame(fr.raf);
        Object.assign(fr, { buf: new Float64Array(maxFrames), n: 0, last: 0, loaf0: { total: lf.total, blocking: lf.totalBlocking } });
        fr.raf = requestAnimationFrame(tick);
        return { started: true, maxFrames };
      },
      stop() {
        cancelAnimationFrame(fr.raf);
        if (!fr.buf) return { error: 'call frame.start() first' };
        flush();
        const n = fr.n;
        const d = fr.buf.slice(0, n).sort();
        const spanMs = d.reduce((sum, v) => sum + v, 0);
        // Refresh period: the median of the fast cluster (intervals under 1.75 × the 10th percentile). rAF
        // timestamps jitter by about ±25% in Chrome, so a low percentile alone reads 149 Hz on a 120 Hz display.
        const cap = pct(d, 0.1) * 1.75;
        let fast = 0;
        while (fast < n && d[fast] < cap) fast++;
        const vsync = fast ? d[(fast - 1) >> 1] : 0;
        const over = (ms) => { let c = 0; for (let i = n - 1; i >= 0 && d[i] > ms; i--) c++; return c; };
        const longFrames = over(vsync * 1.5);
        const out = {
          frames: n, spanMs: Math.round(spanMs), hz: vsync ? Math.round(1000 / vsync) : 0,
          p50Ms: r1(pct(d, 0.5)), p95Ms: r1(pct(d, 0.95)), p99Ms: r1(pct(d, 0.99)), maxGapMs: r1(n ? d[n - 1] : 0),
          over16_7: over(16.7), over33: over(33), longFrames, longFramesPer10s: spanMs ? r1((longFrames * 10000) / spanMs) : 0,
          loaf: { count: lf.total - fr.loaf0.total, blockingMs: r1(lf.totalBlocking - fr.loaf0.blocking) },
          ...(n === fr.buf.length ? { truncated: true } : {}),
        };
        fr.buf = null;
        return out;
      },
    },

    interaction: {
      start() {
        ix.since = performance.now();
        ix.byId.clear();
        ix.count0 = performance.interactionCount ?? 0;
        flush();
        return { started: true };
      },
      async read() {
        await settle();
        flush();
        const list = [...ix.byId.values()].sort((a, b) => b.latency - a.latency);
        // Interactions faster than durationThreshold (16 ms) have no entry; interactionCount still counts them.
        const all = typeof performance.interactionCount === 'number' ? performance.interactionCount - ix.count0 : null;
        return {
          count: list.length,
          ...(all > list.length ? { under16Ms: all - list.length } : {}),
          top: list.slice(0, 5).map((g) => ({
            type: [...g.types].join('+'), target: g.target, latencyMs: g.latency,
            inputDelayMs: r1(Math.max(0, g.pStart - g.start)),
            processingMs: r1(Math.max(0, g.pEnd - g.pStart)),
            presentationMs: r1(Math.max(0, g.end - g.pEnd)),
          })),
        };
      },
    },

    shift: {
      start() {
        ls.since = performance.now();
        ls.list = [];
        flush();
        return { started: true };
      },
      async read() {
        await settle();
        flush();
        const own = ls.list.filter((s) => !s.input).sort((a, b) => a.t - b.t);
        // CLS rule: session windows with gaps under 1 s and a length of at most 5 s; the largest window counts.
        let cls = 0, win = 0, winStart = 0, prevT = -Infinity;
        for (const s of own) {
          if (s.t - prevT >= 1000 || s.t - winStart > 5000) { win = 0; winStart = s.t; }
          win += s.v;
          prevT = s.t;
          cls = Math.max(cls, win);
        }
        return {
          count: ls.list.length, withInput: ls.list.length - own.length,
          cls: r4(cls), sumNoInput: r4(own.reduce((sum, s) => sum + s.v, 0)),
          worst: [...ls.list].sort((a, b) => b.v - a.v).slice(0, 3).map((s) => ({ t: r1(s.t), v: r4(s.v), input: s.input, src: s.src })),
        };
      },
    },

    loaf: {
      start() {
        flush();
        Object.assign(lf, { since: performance.now(), count: 0, blocking: 0, maxMs: 0, worst: [], scripts: new Map() });
        return { started: true };
      },
      async read() {
        await settle();
        flush();
        const topScripts = [...lf.scripts.values()].sort((a, b) => b.ms - a.ms).slice(0, 6)
          .map((a) => ({ ...a, ms: r1(a.ms), forcedLayoutMs: r1(a.forcedLayoutMs) }));
        return { count: lf.count, blockingMs: r1(lf.blocking), worstFrameMs: r1(lf.maxMs), worst: lf.worst, topScripts };
      },
    },

    paint() {
      const nav = performance.getEntriesByType('navigation')[0];
      const act = nav?.activationStart || 0;
      const at = (name) => {
        const e = performance.getEntriesByName(name, 'paint')[0];
        return e ? r1(Math.max(0, e.startTime - act)) : null;
      };
      const byType = {};
      let cacheHits = 0;
      for (const r of performance.getEntriesByType('resource')) {
        const t = (byType[r.initiatorType] ??= { n: 0, transferKB: 0, decodedKB: 0, blocking: 0 });
        t.n++;
        t.transferKB += r.transferSize / 1024;
        t.decodedKB += r.decodedBodySize / 1024;
        if (r.renderBlockingStatus === 'blocking') t.blocking++;
        if (r.transferSize === 0 && r.decodedBodySize > 0) cacheHits++;
      }
      for (const t of Object.values(byType)) { t.transferKB = Math.round(t.transferKB); t.decodedKB = Math.round(t.decodedKB); }
      return {
        navType: nav?.type ?? null, protocol: nav?.nextHopProtocol ?? null,
        ttfbMs: nav ? r1(Math.max(0, nav.responseStart - act)) : null,
        fpMs: at('first-paint'), fcpMs: at('first-contentful-paint'),
        dclMs: nav ? r1(nav.domContentLoadedEventEnd - act) : null, loadMs: nav ? r1(nav.loadEventEnd - act) : null,
        docTransferKB: nav ? kb(nav.transferSize) : null, cacheHits, byType,
      };
    },

    memory: {
      start() {
        mem.first = null;
        mem.n = 0;
        return { started: true };
      },
      // uaMemory: true adds measureUserAgentSpecificMemory(); it needs crossOriginIsolated and can take 20 s or more.
      async sample({ uaMemory = false } = {}) {
        const s = {
          domNodes: document.getElementsByTagName('*').length, // light DOM only
          canvases: document.getElementsByTagName('canvas').length,
          counters: window.__perf?.counters?.() ?? null,
        };
        if (uaMemory) {
          s.uaMB = crossOriginIsolated ? r1((await performance.measureUserAgentSpecificMemory()).bytes / 2 ** 20) : null;
          if (!crossOriginIsolated) s.note = 'uaMemory needs crossOriginIsolated';
        }
        mem.n++;
        mem.first ??= s;
        const delta = {};
        for (const k of ['domNodes', 'canvases', 'uaMB']) {
          if (typeof s[k] === 'number' && typeof mem.first[k] === 'number') delta[k] = r1(s[k] - mem.first[k]);
        }
        for (const [k, v] of Object.entries(s.counters ?? {})) {
          const base = mem.first.counters?.[k];
          if (typeof v === 'number' && typeof base === 'number') delta[k] = r1(v - base);
        }
        return { i: mem.n, ...s, delta };
      },
    },

    dispose() {
      for (const o of observers) o.po.disconnect();
      cancelAnimationFrame(fr.raf);
      if (window.__wpProbe === probe) delete window.__wpProbe;
      return { disposed: true };
    },
  };

  window.__wpProbe = probe;
  return { installed: true, version: VERSION };
}
