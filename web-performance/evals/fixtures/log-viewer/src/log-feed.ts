// Mock log feed. It emits about 500 lines per second in small bursts, like a busy server log.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogLine {
  id: number;
  time: number; // Unix time in milliseconds
  level: LogLevel;
  source: string;
  message: string;
}

export interface LogFeed {
  subscribe(listener: (lines: LogLine[]) => void): () => void;
}

const LEVELS: LogLevel[] = ['debug', 'info', 'info', 'info', 'warn', 'error'];
const SOURCES = ['api', 'auth', 'billing', 'search', 'worker'];

export function createLogFeed(linesPerSecond = 500): LogFeed {
  let nextId = 0;
  return {
    subscribe(listener) {
      const perBurst = Math.max(1, Math.round(linesPerSecond / 50));
      const timer = setInterval(() => {
        const lines: LogLine[] = [];
        for (let i = 0; i < perBurst; i++) {
          const id = nextId++;
          lines.push({
            id,
            time: Date.now(),
            level: LEVELS[id % LEVELS.length],
            source: SOURCES[id % SOURCES.length],
            message: `request ${id} handled in ${(id * 7) % 250} ms`,
          });
        }
        listener(lines);
      }, 20);
      return () => clearInterval(timer);
    },
  };
}
