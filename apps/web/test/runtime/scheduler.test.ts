import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  it('recupera os ticks perdidos quando um disparo demora mais que o período (tempo de parede)', async () => {
    vi.useFakeTimers();
    try {
      const r = getRuntime();
      r.timeScale = 2; // 2 ticks de 50 ms por disparo de 100 ms = 1× tempo real
      let n = 0;
      r.tick = async () => {
        n++;
        // Um tick em cada 5 "trava" 150 ms (sync Modbus lento) → o disparo seguinte é pulado.
        if (n % 5 === 0) await new Promise((res) => setTimeout(res, 150));
      };
      stop = startScheduler({ runtime: r, tick_wall_ms: 100 });
      await vi.advanceTimersByTimeAsync(10_000);
      // 10 s de parede = 200 ticks devidos; o código antigo (n fixo + busy) perdia ~1 em 4.
      expect(n).toBeGreaterThanOrEqual(190);
      expect(n).toBeLessThanOrEqual(202);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sobrevive a um tick que lança erro (loga e continua)', async () => {
    const r = getRuntime();
    r.timeScale = 1;
    const orig = r.tick.bind(r);
    let n = 0;
    r.tick = async () => {
      if (n++ === 0) throw new Error('falha simulada');
      await orig();
    };
    const t0 = r.orchestrator.getState().time_s;
    stop = startScheduler({ runtime: r, tick_wall_ms: 20 });
    await new Promise((res) => setTimeout(res, 120));
    expect(n).toBeGreaterThan(1);
    expect(r.orchestrator.getState().time_s).toBeGreaterThan(t0);
  });
});
