import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { buildLoadState } from '../../src/load.js';
import { GAMMA_AIR, R_AIR, C_to_K } from '../../src/constants.js';

const dt = 0.05;

describe('Drying phase', () => {
  it('removes residual liquid water from chamber via vacuum + hot jacket', () => {
    const p: SystemParams = {
      chamber: { V: 0.15, allowLiquid: true },
      jacket: { V: 0.025, allowLiquid: false },
      generator: null,
      load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
      valves: {
        V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR } },
      },
      external: { steam_line_pressure: 0, steam_line_T: 0, atmosphere_T: C_to_K(22) },
    };

    let s: SystemState = {
      chamber: { m_air: 0.01, m_vap: 0.05, m_liq: 0.1, T: C_to_K(134) },
      jacket: { m_air: 0, m_vap: 0.05, m_liq: 0, T: C_to_K(135) },
      generator: null,
      load: buildLoadState(undefined, C_to_K(134)),
      f0_minutes: 100,
      time_s: 0,
    };

    const m_liq_initial = s.chamber.m_liq;
    // N-node load coupling: the hot (134 °C) load is now a thermal reservoir tied to the
    // gas by radiation + density-scaled convection, which slows the chamber's evaporative
    // pump-down. Removal is still monotonic and completes (~0 by ~2700 s); it just crosses
    // the 50 % mark at ~1500 s instead of within 900 s. Same assertion, longer window.
    for (let t = 0; t < 1800 / dt; t++) {
      s = system_step(s, p, { V_VAC: true }, { heater_gen: false, pump_vac: true }, dt);
    }

    expect(s.chamber.m_liq).toBeLessThan(m_liq_initial * 0.5);
  }, 120000);
});
