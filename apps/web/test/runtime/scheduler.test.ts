import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { startScheduler } from '../../server/runtime/scheduler.js';

describe('startScheduler', () => {
  beforeEach(() => resetRuntime());
  let stop: (() => void) | null = null;
  afterEach(() => {
    if (stop) stop();
  });

  it('ticks runtime at tick_wall_ms cadence', async () => {
    const r = getRuntime();
    r.timeScale = 1;
    const t0 = r.orchestrator.getState().time_s;
    stop = startScheduler({ runtime: r, tick_wall_ms: 20 });
    await new Promise((res) => setTimeout(res, 120));
    expect(r.orchestrator.getState().time_s).toBeGreaterThan(t0);
  });

  it('stop function halts ticks', async () => {
    const r = getRuntime();
    r.timeScale = 1;
    stop = startScheduler({ runtime: r, tick_wall_ms: 20 });
    await new Promise((res) => setTimeout(res, 50));
    const t_at_stop = r.orchestrator.getState().time_s;
    stop();
    stop = null;
    await new Promise((res) => setTimeout(res, 100));
    expect(r.orchestrator.getState().time_s).toBeCloseTo(t_at_stop, 1);
  });

  it('timeScale > 1 runs multiple sim ticks per wall tick (fast-forward)', async () => {
    const r = getRuntime();
    r.timeScale = 5;
    const t0 = r.orchestrator.getState().time_s;
    stop = startScheduler({ runtime: r, tick_wall_ms: 20 });
    await new Promise((res) => setTimeout(res, 120));
    const advanced = r.orchestrator.getState().time_s - t0;
    expect(advanced).toBeGreaterThan(0.5);
  });

  it('timeScale change mid-run takes effect (read each firing)', async () => {
    const r = getRuntime();
    r.timeScale = 1;
    stop = startScheduler({ runtime: r, tick_wall_ms: 20 });
    await new Promise((res) => setTimeout(res, 60));
    const slow = r.orchestrator.getState().time_s;
    r.timeScale = 8;
    await new Promise((res) => setTimeout(res, 60));
    const fast = r.orchestrator.getState().time_s;
    expect(fast - slow).toBeGreaterThan(0.4);
  });
});
