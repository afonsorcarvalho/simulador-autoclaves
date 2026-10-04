import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { buildLoadState } from '../../src/load.js';
import { chamber_pressure } from '../../src/chamber.js';
import { T_sat_water } from '../../src/saturation.js';
import { GAMMA_VAP, R_AIR, R_VAP, C_to_K, bar_to_Pa } from '../../src/constants.js';

// Carga fria (22 °C) recebendo vapor do gerador pela válvula, câmara pós pré-vácuo.
function params(): SystemParams {
  return {
    chamber: {
      V: 0.15,
      allowLiquid: true,
      wall_mass_kg: 50,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 200,
      drain_kg_per_s: 2e-5,
    },
    jacket: {
      V: 0.025,
      allowLiquid: false,
      wall_mass_kg: 15,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 100,
    },
    generator: { V_total: 0.05, heater_power_W: 36000, relief_pressure_Pa: bar_to_Pa(4.54) },
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
    valves: {
      V_STEAM_IN_INT: {
        from: 'generator',
        to: 'chamber',
        params: { Cv: 8e-6, gamma: GAMMA_VAP, R: R_VAP },
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

function state(P0_bar: number, airFrac: number): SystemState {
  const T0 = C_to_K(100);
  const P0 = P0_bar * 1e5;
  return {
    chamber: {
      m_air: (airFrac * P0 * 0.15) / (R_AIR * T0),
      m_vap: ((1 - airFrac) * P0 * 0.15) / (R_VAP * T0),
      m_liq: 0,
      T: T0,
      T_wall: C_to_K(134),
    },
    jacket: { m_air: 0, m_vap: 0.047, m_liq: 0, T: C_to_K(138), T_wall: C_to_K(138) },
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: buildLoadState(undefined, C_to_K(22)),
    f0_minutes: 0,
    time_s: 0,
  };
}

const dt = 0.05;
function run(
  P0_bar: number,
  airFrac: number,
  seconds: number,
  each: (s: SystemState, t: number, Tsat: number) => void,
) {
  const p = params();
  let s = state(P0_bar, airFrac);
  for (let i = 1; i <= seconds / dt; i++) {
    s = system_step(s, p, { V_STEAM_IN_INT: true }, { heater_gen: true, pump_vac: false }, dt);
    const P = chamber_pressure(s.chamber, p.chamber).p_total;
    each(s, i * dt, T_sat_water(P));
  }
  return s;
}

describe('condensação na carga fria', () => {
  // Câmara com vapor a 1 bar (pós-pulsos), carga nova a 22 °C, vapor do gerador aberto.
  it('testemunho acompanha T_sat em segundos e a câmara satura ao pressurizar', () => {
    const lag: number[] = [];
    let tPress = Infinity;
    let superEnd = Infinity;
    const s = run(1, 0, 240, (st, t, Tsat) => {
      const w = st.load.nodes.find((n) => n.isWitness)!;
      if (t >= 30 && Math.abs(t - Math.round(t)) < 1e-6) lag.push(Tsat - w.T);
      if (tPress === Infinity && Tsat >= C_to_K(134)) tPress = t;
      superEnd = st.chamber.T - Tsat;
    });
    console.log(
      'defasagem máx',
      Math.max(...lag),
      't(T_sat≥134)',
      tPress,
      'superaq final',
      superEnd,
    );
    // Antes (h de convecção seca ~30–90 W/m²K) o testemunho levava ~10 min; agora segundos.
    expect(Math.max(...lag)).toBeLessThan(3);
    expect(tPress).toBeLessThan(240);
    expect(superEnd).toBeLessThanOrEqual(2); // pressurizada, com condensado: saturada
    expect(s.chamber.m_liq).toBeGreaterThan(0); // condensado escorreu da carga p/ a câmara
  });

  it('ar residual: a carga fica abaixo de T_sat(P_total) (ponto frio Bowie-Dick)', () => {
    let gap = 0;
    run(0.3, 1, 240, (st, _t, Tsat) => {
      gap = Tsat - st.load.nodes.find((n) => n.isWitness)!.T;
    });
    console.log('ponto frio', gap);
    expect(gap).toBeGreaterThan(2);
  });
});
