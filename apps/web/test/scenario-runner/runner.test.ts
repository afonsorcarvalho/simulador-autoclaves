import { describe, it, expect } from 'vitest';
import { runScenario } from '../../server/scenario-runner/runner.js';
import type { CycleConfig } from '../../server/virtual-plc/cycle-config.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';
import type { SystemParams, SystemState } from '@sim/physics';
import { C_to_K, P_ATM, R_AIR, GAMMA_AIR, GAMMA_VAP, R_VAP, bar_to_Pa } from '@sim/physics';

function basicParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true, relief_pressure_Pa: 304000 },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 36000, relief_pressure_Pa: 454000 },
    load: {
      m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500,
      h_gas_metal: 200, h_metal_fabric: 500,
    },
    valves: {
      V_STEAM_IN_INT: { from: 'generator', to: 'chamber', params: { Cv: 8e-6, gamma: GAMMA_VAP, R: R_VAP } },
      V_STEAM_IN_JACKET: {
        from: 'generator', to: 'jacket',
        params: { Cv: 1e-6, gamma: GAMMA_VAP, R: R_VAP },
        thermostat: { target: 'jacket', close_at_Pa: bar_to_Pa(3.54), reopen_at_Pa: bar_to_Pa(3.34) },
      },
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR } },
      V_EXHAUST: { from: 'chamber', to: 'atmosphere', params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR } },
    },
    external: { steam_line_pressure: bar_to_Pa(5), steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
    jacket_chamber_h_W_per_K: 150,
  };
}

function preheatedState(p: SystemParams): SystemState {
  const T_amb = C_to_K(22);
  const T_hot = C_to_K(138);
  return {
    chamber: { m_air: (P_ATM * p.chamber.V) / (R_AIR * T_amb), m_vap: 0, m_liq: 0, T: T_amb, T_wall: T_hot },
    jacket: { m_air: 0, m_vap: 0.047, m_liq: 0, T: T_hot, T_wall: T_hot },
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: { T_metal: T_amb, T_fabric: T_amb },
    f0_minutes: 0,
    time_s: 0,
  };
}

const shortCycle: CycleConfig = {
  name: 'unit-test',
  sterilization_T_C: 133,
  sterilization_P_bar: 3.04,
  hold_duration_s: 60,
  prevac_pulses: 2,
  prevac_vacuum_target_bar: 0.25,
  prevac_steam_target_bar: 2.0,
  preheat_duration_s: 30,
  dry_duration_s: 60,
  f0_target_min: 20,
};

describe('runScenario', () => {
  it('runs a full cycle to COMPLETE within timeout', async () => {
    const params = basicParams();
    const initial = preheatedState(params);
    const result = await runScenario({
      cycle: shortCycle,
      params,
      initialState: initial,
      bridge: new VirtualEsp32Bridge(),
      tickDt_s: 0.05,
      max_duration_s: 1500,
    });

    expect(result.completed).toBe(true);
    expect(result.final_phase).toBe('COMPLETE');
    expect(result.f0_min).toBeGreaterThan(0);
  }, 60000);

  it('returns result with timing + final F0 + phase history', async () => {
    const params = basicParams();
    const initial = preheatedState(params);
    const result = await runScenario({
      cycle: shortCycle,
      params,
      initialState: initial,
      bridge: new VirtualEsp32Bridge(),
      tickDt_s: 0.05,
      max_duration_s: 1500,
    });

    expect(result.elapsed_s).toBeGreaterThan(0);
    expect(result.phase_history.length).toBeGreaterThan(0);
    expect(result.phase_history[0]?.phase).toBe('PREHEAT');
  }, 60000);

  it('times out if cycle never completes', async () => {
    const params = basicParams();
    const initial = preheatedState(params);
    const result = await runScenario({
      cycle: shortCycle,
      params,
      initialState: initial,
      bridge: new VirtualEsp32Bridge(),
      tickDt_s: 0.05,
      max_duration_s: 1,  // 1 s — way too short
    });

    expect(result.completed).toBe(false);
    expect(result.timed_out).toBe(true);
  }, 30000);
});
