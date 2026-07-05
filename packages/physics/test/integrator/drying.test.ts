// packages/physics/test/integrator/drying.test.ts
import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { buildLoadState } from '../../src/load.js';
import { p_sat_water } from '../../src/saturation.js';
import { C_to_K, R_AIR, R_VAP, GAMMA_AIR } from '../../src/constants.js';

function params(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200 },
    jacket: { V: 0.025, allowLiquid: false, wall_mass_kg: 15, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 100 },
    generator: null,
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
    valves: {
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR } },
    },
    external: { steam_line_pressure: 5e5, steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
    jacket_chamber_h_W_per_K: 150,
  };
}

// câmara: vapor saturado quente + carga húmida quente; jaqueta quente; a puxar vácuo
function wetHotState(_p: SystemParams): SystemState {
  const T = C_to_K(134);
  const load = buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], T);
  load.nodes[0]!.m_water = 0.2; // carga encharcada
  return {
    chamber: { m_air: 1e-6, m_vap: (p_sat_water(T) * 0.15) / (R_VAP * T), m_liq: 0, T, T_wall: T },
    jacket: { m_air: 0, m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(140)), m_liq: 0, T: C_to_K(140), T_wall: C_to_K(140) },
    generator: null,
    load,
    f0_minutes: 0,
    time_s: 0,
  };
}

// Isolated chamber (no valves) + wet hot load undersaturated so the only thing that can move
// chamber vapor is the load↔chamber water exchange. Water must be conserved exactly.
function conservationParams(): SystemParams {
  const p = params();
  p.valves = {}; // no valves → load↔chamber exchange is the only chamber-vapor path
  return p;
}

function undersaturatedWetHotState(): SystemState {
  const T = C_to_K(134);
  const load = buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], T);
  load.nodes[0]!.m_water = 0.2; // carga encharcada, nó quente → evapora
  return {
    chamber: { m_air: 1e-6, m_vap: 0.05, m_liq: 0, T, T_wall: T }, // undersaturated: p_sat(134°C)≈3e5, p_vap≈0.6e5
    jacket: { m_air: 0, m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(140)), m_liq: 0, T: C_to_K(140), T_wall: C_to_K(140) },
    generator: null,
    load,
    f0_minutes: 0,
    time_s: 0,
  };
}

describe('load↔chamber water conservation', () => {
  it('conserves water across one system_step at shipped dt (rate vs mass)', () => {
    const p = conservationParams();
    const s = undersaturatedWetHotState();
    const next = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.05);
    // no valves → only load↔chamber water exchange moves chamber vapor
    const before = s.load.nodes[0]!.m_water + s.chamber.m_vap;
    const after = next.load.nodes[0]!.m_water + next.chamber.m_vap;
    expect(next.load.nodes[0]!.m_water).toBeLessThan(0.2); // evaporou algo (teste é significativo)
    expect(after).toBeCloseTo(before, 8); // água conservada carga+câmara
  });
});

describe('vacuum drying', () => {
  it('cools the witness by evaporative flash as the chamber is pumped down', () => {
    const p = params();
    let s = wetHotState(p);
    const T0 = s.load.nodes.find((n) => n.isWitness)!.T;
    for (let i = 0; i < 4000; i++) {
      s = system_step(s, p, { V_VAC: true }, { heater_gen: false, pump_vac: true }, 0.05);
    }
    const witness = s.load.nodes.find((n) => n.isWitness)!;
    expect(witness.T).toBeLessThan(T0 - 10); // testemunho cai >10 °C
    expect(witness.m_water).toBeLessThan(0.2); // secou
  });
});
