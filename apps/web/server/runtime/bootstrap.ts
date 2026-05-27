import { getRuntime } from './singleton.js';
import { startScheduler } from './scheduler.js';

declare global {
  // eslint-disable-next-line no-var
  var __SIM_SCHEDULER_STOP__: (() => void) | undefined;
}

/** Ensure a scheduler is running. Safe to call repeatedly (idempotent across HMR). */
export function ensureSchedulerRunning(): void {
  if (globalThis.__SIM_SCHEDULER_STOP__) return;
  const runtime = getRuntime();
  // 100ms wall tick × 2 sim ticks (50ms total sim per wall tick = 1× real time at dt=0.05).
  const stop = startScheduler({ runtime, tick_wall_ms: 100, ticks_per_wall: 2 });
  globalThis.__SIM_SCHEDULER_STOP__ = stop;
}
