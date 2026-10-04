import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { buildLoadState } from '../../src/load.js';
import { GAMMA_AIR, R_AIR, P_ATM, C_to_K, bar_to_Pa } from '../../src/constants.js';

// Regressão HIL (Bowie-Dick, fase 8→10): vácuo profundo com camisa quente e depois
// admissão de ar. Antes, a condução camisa→parede usava T do gás (frio em vácuo) e a
// parede passava de 170 °C; o ar admitido chegava a ~160 °C (alarme de sobretemperatura).
function params(): SystemParams {
  return {
    chamber: {
      V: 0.15,
      allowLiquid: true,
      wall_mass_kg: 50,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 200,
    },
    jacket: {
      V: 0.025,
      allowLiquid: false,
      wall_mass_kg: 15,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 100,
    },
    generator: { V_total: 0.05, heater_power_W: 0 },
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
    valves: {
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR } },
      V_AIR_IN: {
        from: 'atmosphere',
        to: 'chamber',
        params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR },
      },
    },
    external: {
      steam_line_pressure: bar_to_Pa(5),
      steam_line_T: C_to_K(160),
      atmosphere_T: C_to_K(22),
    },
    jacket_chamber_h_W_per_K: 150,
  };
}

describe('admissão de ar após vácuo profundo', () => {
  it('parede não passa da camisa e o gás não passa de max(parede, camisa)', () => {
    const p = params();
    const T_hot = C_to_K(138);
    let s: SystemState = {
      chamber: {
        m_air: (P_ATM * 0.15) / (R_AIR * T_hot),
        m_vap: 0,
        m_liq: 0,
        T: T_hot,
        T_wall: T_hot,
      },
      jacket: { m_air: 0, m_vap: 0.047, m_liq: 0, T: T_hot, T_wall: T_hot },
      generator: null,
      load: buildLoadState(undefined, C_to_K(22)),
      f0_minutes: 0,
      time_s: 0,
    };
    const dt = 0.05;
    for (let i = 0; i < 600 / dt; i++) {
      s = system_step(s, p, { V_VAC: true }, { heater_gen: false, pump_vac: true }, dt);
      expect(s.chamber.T_wall!).toBeLessThanOrEqual(s.jacket.T + 5); // folga: a camisa (sem vapor aqui) esfria antes da parede
    }
    for (let i = 0; i < 120 / dt; i++) {
      s = system_step(s, p, { V_AIR_IN: true }, { heater_gen: false, pump_vac: false }, dt);
      expect(Number.isFinite(s.chamber.T)).toBe(true);
      expect(s.chamber.T).toBeLessThanOrEqual(Math.max(s.chamber.T_wall!, s.jacket.T) + 2);
    }
  });
});
