import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { buildLoadState } from '../../src/load.js';
import { R_AIR, P_ATM, C_to_K } from '../../src/constants.js';

// Sistema fechado (sem válvulas, sem dreno): câmara com vapor a 134 °C, parede e carga mais frias.
const P: SystemParams = {
  chamber: { V: 0.5, allowLiquid: true, wall_mass_kg: 150, wall_cp_J_per_kg_K: 500 },
  jacket: { V: 0.08, allowLiquid: false, wall_mass_kg: 50 },
  generator: null,
  load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
  valves: {},
  external: { steam_line_pressure: 5e5, steam_line_T: C_to_K(160), atmosphere_T: C_to_K(23) },
  jacket_chamber_h_W_per_K: 0,
};

function state(loadT_C: number): SystemState {
  const T = C_to_K(134);
  const jT = C_to_K(23);
  return {
    chamber: { m_air: 0, m_vap: (3e5 * 0.5) / (461.5 * T), m_liq: 0, T, T_wall: C_to_K(110) },
    jacket: { m_air: (P_ATM * 0.08) / (R_AIR * jT), m_vap: 0, m_liq: 0, T: jT, T_wall: jT },
    generator: null,
    load: buildLoadState([{ material: 'STAINLESS_316', mass_kg: 20, initial_T_C: loadT_C, witness: true }], T),
    f0_minutes: 0,
    time_s: 0,
  };
}

const water = (s: SystemState) =>
  s.chamber.m_vap + s.chamber.m_liq + s.load.nodes.reduce((a, n) => a + n.m_water, 0);

function run(s: SystemState, seconds: number) {
  let load = 0;
  let wall = 0;
  let neg = false;
  for (let t = 0; t < seconds; t += 0.05) {
    s = system_step(s, P, {}, { heater_gen: false, pump_vac: false }, 0.05);
    if ((s.cond_load_kg ?? -1) < 0 || (s.cond_wall_kg ?? -1) < 0) neg = true;
    load += s.cond_load_kg!;
    wall += s.cond_wall_kg!;
  }
  return { s, load, wall, neg };
}

describe('condensado por origem', () => {
  it('carga fria condensa mais que carga quente', () => {
    const cold = run(state(23), 60);
    const hot = run(state(100), 60);
    expect(cold.load).toBeGreaterThan(hot.load * 1.5);
    expect(cold.neg || hot.neg).toBe(false);
  });

  it('conserva água e o condensado bate com o vapor que sumiu', () => {
    const s0 = state(23);
    const r = run(s0, 60);
    expect(water(r.s)).toBeCloseTo(water(s0), 9);
    expect(r.wall).toBeGreaterThan(0);
    const vapLost = s0.chamber.m_vap - r.s.chamber.m_vap;
    // cond_load_kg/cond_wall_kg são líquidos (condensação − reevaporação do mesmo passo, piso 0);
    // aqui a carga começa seca (sem água p/ reevaporar em flash) → acumulado ≈ vapor perdido.
    expect(r.load + r.wall).toBeGreaterThanOrEqual(vapLost - 1e-9);
    expect(r.load + r.wall).toBeLessThan(vapLost * 1.05);
  });
});

describe('condensação e evaporação brutas', () => {
  const loadWater = (s: SystemState) => s.load.nodes.reduce((a, n) => a + n.m_water, 0);

  it('aquecimento: carga ganha água, Σcond − Σevap − escoamento = Δágua na carga', () => {
    let s = state(23);
    let cond = 0, evap = 0, out = 0;
    for (let t = 0; t < 60; t += 0.05) {
      s = system_step(s, P, {}, { heater_gen: false, pump_vac: false }, 0.05);
      expect(s.evap_load_kg!).toBeGreaterThanOrEqual(0);
      expect(s.evap_wall_kg!).toBeGreaterThanOrEqual(0);
      cond += s.cond_load_kg!;
      evap += s.evap_load_kg!;
      out += s.load_to_chamber_kg!;
    }
    expect(loadWater(s)).toBeGreaterThan(0);
    expect(cond - evap - out).toBeCloseTo(loadWater(s), 9);
  });

  it('vácuo com carga molhada e quente: evapora (evap > 0) e a carga seca', () => {
    // Câmara quase vazia (vácuo), carga a 120 °C molhada → flash.
    const T = C_to_K(120);
    let s: SystemState = {
      ...state(120),
      chamber: { m_air: 1e-4, m_vap: 1e-4, m_liq: 0, T, T_wall: T },
    };
    s.load.nodes[0]!.m_water = 0.2;
    const w0 = loadWater(s);
    let cond = 0, evap = 0;
    for (let t = 0; t < 5; t += 0.05) {
      s = system_step(s, P, {}, { heater_gen: false, pump_vac: false }, 0.05);
      cond += s.cond_load_kg!;
      evap += s.evap_load_kg!;
    }
    expect(evap).toBeGreaterThan(cond);
    expect(loadWater(s)).toBeLessThan(w0);
    expect(w0 + cond - evap).toBeCloseTo(loadWater(s), 9);
  });
});
