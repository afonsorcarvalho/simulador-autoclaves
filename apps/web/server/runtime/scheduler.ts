import type { Runtime } from './singleton.js';

export interface SchedulerOpts {
  runtime: Runtime;
  /** Wall-clock period between scheduler firings (ms). */
  tick_wall_ms: number;
  /** Number of physics ticks performed per wall firing. >1 = fast-forward. */
  ticks_per_wall: number;
}

export function startScheduler(opts: SchedulerOpts): () => void {
  let running = true;
  let busy = false;

  const handle = setInterval(async () => {
    if (!running || busy) return;
    busy = true;
    try {
      for (let i = 0; i < opts.ticks_per_wall; i++) {
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
