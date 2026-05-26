import { describe, it, expect } from 'vitest';
import { buildSnapshot, SnapshotPublisher } from '../../server/runtime/snapshot.js';
import type { SystemState, SystemParams } from '@sim/physics';
import { C_to_K } from '@sim/physics';

function makeState(): SystemState {
  return {
    chamber: { m_air: 0.18, m_vap: 0.05, m_liq: 0.02, T: C_to_K(120), T_wall: C_to_K(125) },
    jacket: { m_air: 0, m_vap: 0.05, m_liq: 0, T: C_to_K(138), T_wall: C_to_K(138) },
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: { T_metal: C_to_K(118), T_fabric: C_to_K(115) },
    f0_minutes: 30,
    time_s: 450,
  };
}

function makeParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 36000 },
    load: { m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500, h_gas_metal: 200, h_metal_fabric: 100 },
    valves: {},
    external: { steam_line_pressure: 500000, steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
  };
}

describe('buildSnapshot', () => {
  it('extracts pressures + temperatures + F0 + masses from SystemState', () => {
    const snap = buildSnapshot({
      state: makeState(),
      params: makeParams(),
      cycle_running: true,
      cycle_phase: 'HOLD',
      cycle_elapsed_s: 30,
      valves: { V_STEAM_IN_INT: true, V_VAC: false },
    });
    expect(snap.t_s).toBe(450);
    expect(snap.cycle_running).toBe(true);
    expect(snap.cycle_phase).toBe('HOLD');
    expect(snap.f0_min).toBe(30);
    expect(snap.pressures.chamber_bar).toBeGreaterThan(0);
    expect(snap.temperatures.chamber_C).toBeCloseTo(120, 0);
    expect(snap.temperatures.testemunho_C).toBeCloseTo(115, 0);
    expect(snap.valves.V_STEAM_IN_INT).toBe(true);
    expect(snap.masses.air_chamber_kg).toBe(0.18);
  });
});

describe('SnapshotPublisher', () => {
  function dummy(t = 0): import('../../server/runtime/snapshot.js').Snapshot {
    return {
      t_s: t, wall_t_ms: 0,
      cycle_running: false, cycle_phase: 'IDLE', cycle_elapsed_s: 0, f0_min: 0,
      pressures: { chamber_bar: 1, jacket_bar: 1, generator_bar: 1 },
      temperatures: { chamber_C: 22, testemunho_C: 22, jacket_C: 22, generator_C: 22 },
      valves: {},
      masses: { air_chamber_kg: 0, vap_chamber_kg: 0, liq_chamber_kg: 0 },
    };
  }

  it('delivers published snapshots to subscribers', () => {
    const pub = new SnapshotPublisher();
    const received: number[] = [];
    pub.subscribe((s) => received.push(s.t_s));
    pub.publish(dummy(1));
    pub.publish(dummy(2));
    expect(received).toEqual([1, 2]);
  });

  it('stores latest snapshot for new subscribers', () => {
    const pub = new SnapshotPublisher();
    pub.publish(dummy(42));
    expect(pub.latest?.t_s).toBe(42);
  });

  it('unsubscribe stops delivery', () => {
    const pub = new SnapshotPublisher();
    const received: number[] = [];
    const unsub = pub.subscribe((s) => received.push(s.t_s));
    pub.publish(dummy(1));
    unsub();
    pub.publish(dummy(2));
    expect(received).toEqual([1]);
  });
});
