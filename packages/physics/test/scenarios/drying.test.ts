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
    // Wall-less, no-active-heat chamber: pure adiabatic flash pump-down. With the common
    // latent-inclusive energy reference (SP-A Task 2), the chamber's internal energy no
    // longer gets the old U_floor clamp that injected spurious energy during flash cooling
    // and kept the gas warm. Correct energy accounting => the gas settles cold/saturated and
    // evaporation is slower. Removal is still strictly monotonic and completes: crosses the
    // 50 % mark at ~2711 s (vs ~1500 s before). Window widened to 3800 s (~1.4×) with margin.
    // The SP-B vapor-dominated pin (which lets jacket heat drive drying) will restore speed.
    for (let t = 0; t < 3800 / dt; t++) {
      s = system_step(s, p, { V_VAC: true }, { heater_gen: false, pump_vac: true }, dt);
    }

    expect(s.chamber.m_liq).toBeLessThan(m_liq_initial * 0.5);
  }, 120000);
});
