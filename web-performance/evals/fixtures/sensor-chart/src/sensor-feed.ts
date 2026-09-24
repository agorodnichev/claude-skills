// Mock sensor stream. Each message is JSON {t, v}: t is Unix time in milliseconds, v is the reading.
// It sends about 300 messages per second, in uneven bursts, like a real socket.
export interface SensorFeed {
  onMessage(listener: (raw: string) => void): () => void;
}

export function createSensorFeed(messagesPerSecond = 300): SensorFeed {
  return {
    onMessage(listener) {
      let phase = 0;
      const timer = setInterval(() => {
        const burst = Math.round((messagesPerSecond / 100) * (0.5 + Math.random()));
        for (let i = 0; i < burst; i++) {
          phase += 0.01;
          listener(JSON.stringify({ t: Date.now(), v: 20 + 5 * Math.sin(phase) + Math.random() }));
        }
      }, 10);
      return () => clearInterval(timer);
    },
  };
}
