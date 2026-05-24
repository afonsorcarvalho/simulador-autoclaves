import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { GAMMA_AIR, R_AIR, C_to_K } from '../../src/constants.js';

const dt = 0.05;

describe('Drying phase', () => {
  it('removes residual liquid water from chamber via vacuum + hot jacket', () => {
    const p: SystemParams = {
      chamber: { V: 0.15, allowLiquid: true },
      jacket: { V: 0.025, allowLiquid: false },
      generator: null,
      load: {
        m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500,
        h_gas_metal: 50, // low: vacuum greatly reduces convective heat transfer
        h_metal_fabric: 30,
      },
      valves: {
        V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR } },
      },
      external: { steam_line_pressure: 0, steam_line_T: 0, atmosphere_T: C_to_K(22) },
    };

    let s: SystemState = {
      chamber: { m_air: 0.01, m_vap: 0.05, m_liq: 0.1, T: C_to_K(134) },
      jacket: { m_air: 0, m_vap: 0.05, m_liq: 0, T: C_to_K(135) },
      generator: null,
      load: { T_metal: C_to_K(134), T_fabric: C_to_K(134) },
      f0_minutes: 100,
      time_s: 0,
    };

    const m_liq_initial = s.chamber.m_liq;
    for (let t = 0; t < 900 / dt; t++) {
      s = system_step(s, p, { V_VAC: true }, { heater_gen: false, pump_vac: true }, dt);
    }

    expect(s.chamber.m_liq).toBeLessThan(m_liq_initial * 0.5);
  }, 120000);
});
