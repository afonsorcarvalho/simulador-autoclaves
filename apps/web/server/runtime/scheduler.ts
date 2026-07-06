import type { Runtime } from './singleton.js';

export interface SchedulerOpts {
  runtime: Runtime;
  /** Wall-clock period between scheduler firings (ms). */
  tick_wall_ms: number;
}

export function startScheduler(opts: SchedulerOpts): () => void {
  let running = true;
  let busy = false;

  const handle = setInterval(async () => {
    if (!running || busy) return;
    busy = true;
    try {
      // Read timeScale each firing so mid-run changes (a knob) take effect immediately.
      const n = Math.max(1, Math.round(opts.runtime.timeScale));
      for (let i = 0; i < n; i++) {
        await opts.runtime.tick();
      }
    } catch (err) {
      console.error('scheduler tick error:', err);
    } finally {
      busy = false;
    }
  }, opts.tick_wall_ms);

  return () => {
    running = false;
    clearInterval(handle);
  };
}
