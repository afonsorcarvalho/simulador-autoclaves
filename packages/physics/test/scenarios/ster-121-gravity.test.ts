import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { GAMMA_AIR, GAMMA_VAP, R_AIR, R_VAP, P_ATM, C_to_K, K_to_C, bar_to_Pa } from '../../src/constants.js';

const dt = 0.05;

function makeParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 24000 },
    load: {
      m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500,
      h_gas_metal: 500, h_metal_fabric: 30,
    },
    valves: {
      V_STEAM_IN_INT: { from: 'generator', to: 'chamber', params: { Cv: 5e-6, gamma: GAMMA_VAP, R: R_VAP } },
      V_STEAM_IN_JACKET: { from: 'generator', to: 'jacket', params: { Cv: 1e-6, gamma: GAMMA_VAP, R: R_VAP } },
      V_EXHAUST: { from: 'chamber', to: 'atmosphere', params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR } },
      V_AIR_IN: { from: 'atmosphere', to: 'chamber', params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR } },
    },
    external: { steam_line_pressure: bar_to_Pa(5), steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
  };
}

function makeInitialState(p: SystemParams): SystemState {
  const T = C_to_K(22);
  return {
    chamber: { m_air: (P_ATM * p.chamber.V) / (R_AIR * T), m_vap: 0, m_liq: 0, T },
    jacket: { m_air: (P_ATM * p.jacket.V) / (R_AIR * T), m_vap: 0, m_liq: 0, T },
    generator: { m_water_liq: 30, m_water_vap: 0, T: C_to_K(22) },
    load: { T_metal: T, T_fabric: T },
    f0_minutes: 0,
    time_s: 0,
  };
}

describe('Sterilization 121°C gravity cycle', () => {
  it('reaches setpoint and accumulates F0 ≥ 15 in 25 min simulated time', () => {
    const p = makeParams();
    let s = makeInitialState(p);

    // Phase 0: heat generator + jacket for 5 min sim time
    for (let t = 0; t < 300 / dt; t++) {
      s = system_step(s, p, { V_STEAM_IN_JACKET: true }, { heater_gen: true, pump_vac: false }, dt);
    }

    // Phase 1: gravity displacement — open exhaust + steam in for 3 min
    for (let t = 0; t < 180 / dt; t++) {
      s = system_step(s, p, { V_STEAM_IN_INT: true, V_STEAM_IN_JACKET: true, V_EXHAUST: true }, { heater_gen: true, pump_vac: false }, dt);
    }

    // Phase 2: pressurize + hold 15 min
    for (let t = 0; t < 15 * 60 / dt; t++) {
      s = system_step(s, p, { V_STEAM_IN_INT: true, V_STEAM_IN_JACKET: true }, { heater_gen: true, pump_vac: false }, dt);
    }

    expect(s.f0_minutes).toBeGreaterThanOrEqual(15);
    expect(K_to_C(s.load.T_fabric)).toBeGreaterThan(120);
  }, 120000);
});
