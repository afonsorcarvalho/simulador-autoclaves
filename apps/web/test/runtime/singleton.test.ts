import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';

describe('getRuntime', () => {
  beforeEach(() => {
    resetRuntime();
  });

  it('returns a singleton (same instance across calls)', () => {
    const a = getRuntime();
    const b = getRuntime();
    expect(a).toBe(b);
  });

  it('initial state: bridge connected, no cycle, plc null', async () => {
    const r = getRuntime();
    expect(r.cycle_running).toBe(false);
    expect(r.plc).toBeNull();
    // bridge usable
    await expect(r.bridge.readCoils(0x1000, 1)).resolves.toBeDefined();
  });

  it('startCycle sets running and creates plc', () => {
    const r = getRuntime();
    r.startCycle({
      name: 'test',
      sterilization_T_C: 134,
      sterilization_P_bar: 3.04,
      hold_duration_s: 60,
      prevac_pulses: 0,
      prevac_vacuum_target_bar: 0.2,
      prevac_steam_target_bar: 2,
      preheat_duration_s: 10,
      dry_duration_s: 60,
      f0_target_min: 1,
    });
    expect(r.cycle_running).toBe(true);
    expect(r.plc).not.toBeNull();
  });

  it('stopCycle clears running + plc', () => {
    const r = getRuntime();
    r.startCycle({
      name: 'test',
      sterilization_T_C: 134,
      sterilization_P_bar: 3.04,
      hold_duration_s: 60,
      prevac_pulses: 0,
      prevac_vacuum_target_bar: 0.2,
      prevac_steam_target_bar: 2,
      preheat_duration_s: 10,
      dry_duration_s: 60,
      f0_target_min: 1,
    });
    r.stopCycle();
    expect(r.cycle_running).toBe(false);
    expect(r.plc).toBeNull();
  });

  it('tick advances orchestrator + plc when cycle running', async () => {
    const r = getRuntime();
    const t0 = r.orchestrator.getState().time_s;
    r.startCycle({
      name: 'test',
      sterilization_T_C: 134,
      sterilization_P_bar: 3.04,
      hold_duration_s: 60,
      prevac_pulses: 0,
      prevac_vacuum_target_bar: 0.2,
      prevac_steam_target_bar: 2,
      preheat_duration_s: 10,
      dry_duration_s: 60,
      f0_target_min: 1,
    });
    await r.tick();
    expect(r.orchestrator.getState().time_s).toBeGreaterThan(t0);
  });

  it('tick advances orchestrator only (no plc) when no cycle running', async () => {
    const r = getRuntime();
    const t0 = r.orchestrator.getState().time_s;
    await r.tick();
    expect(r.orchestrator.getState().time_s).toBeGreaterThan(t0);
    expect(r.plc).toBeNull();
  });

  it('publishes a snapshot on every tick', async () => {
    const r = getRuntime();
    const seen: number[] = [];
    r.publisher.subscribe((s) => seen.push(s.t_s));
    await r.tick();
    await r.tick();
    expect(seen.length).toBe(2);
  });
});
