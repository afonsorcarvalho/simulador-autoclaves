// packages/physics/test/integrator/drying.test.ts
import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { buildLoadState } from '../../src/load.js';
import { p_sat_water, T_sat_water } from '../../src/saturation.js';
import { C_to_K, R_AIR, R_VAP, GAMMA_AIR, CV_AIR, CP_LIQ } from '../../src/constants.js';
import { vaporU } from '../../src/energy.js';
import { MATERIALS } from '../../src/materials.js';

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
    jacket: {
      m_air: 0,
      m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(140)),
      m_liq: 0,
      T: C_to_K(140),
      T_wall: C_to_K(140),
    },
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
    jacket: {
      m_air: 0,
      m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(140)),
      m_liq: 0,
      T: C_to_K(140),
      T_wall: C_to_K(140),
    },
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

describe('load↔chamber condensation conserves energy exactly (closed, latent reference)', () => {
  it('no energy is created when the load condenses chamber vapor', () => {
    const p = params();
    p.valves = {}; // closed system
    p.jacket_chamber_h_W_per_K = 0; // no jacket conduction
    const T = C_to_K(134); // chamber, saturated
    // Node & jacket at 133°C: node just below T_boil (=T_ch, chamber saturated) so condensation
    // is the ONLY active path, and T_node≈T_ch kills the physical CV_VAP·(T_node−T_ch) residual.
    // Large node mass keeps it isothermal near the jacket → radiation driver (T_jacket⁴−T_node⁴)≈0
    // throughout, so chamber↔load condensation is isolated to ~Joules.
    const Tn = C_to_K(133);
    const load = buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 50, witness: true }], Tn);
    let s: SystemState = {
      chamber: {
        m_air: 1e-6,
        m_vap: (p_sat_water(T) * 0.15) / (R_VAP * T),
        m_liq: 0,
        T,
        T_wall: T,
      }, // saturated (V=0.15)
      jacket: { m_air: 0, m_vap: 0.001, m_liq: 0, T: Tn, T_wall: Tn }, // at node T → radiation ~0; decoupled (h_jc=0)
      generator: null,
      load,
      f0_minutes: 0,
      time_s: 0,
    };
    const wall_C = p.chamber.wall_mass_kg! * p.chamber.wall_cp_J_per_kg_K!; // derive so it can't drift from params()
    const nodeEnergy = (st: SystemState) =>
      st.load.nodes.reduce(
        (a, n) => a + n.m_water * CP_LIQ * n.T + n.mass_kg * MATERIALS[n.material].cp * n.T,
        0,
      );
    const chamberEnergy = (c: typeof s.chamber) =>
      c.m_air * CV_AIR * c.T +
      vaporU(c.m_vap, c.T) +
      c.m_liq * CP_LIQ * c.T +
      (c.T_wall !== undefined ? wall_C * c.T_wall : 0);
    // Com condensação em filme (h_cond) o nó chega a T_boil (134) em segundos e passa a irradiar
    // p/ a jaqueta (133): a jaqueta entra no balanço (guarda mais estrita, não mais frouxa).
    const wall_Cj = p.jacket.wall_mass_kg! * p.jacket.wall_cp_J_per_kg_K!;
    const jacketEnergy = (j: typeof s.jacket) =>
      j.m_air * CV_AIR * j.T + vaporU(j.m_vap, j.T) + j.m_liq * CP_LIQ * j.T + wall_Cj * j.T_wall!;
    const E0 = chamberEnergy(s.chamber) + nodeEnergy(s) + jacketEnergy(s.jacket);
    for (let i = 0; i < 200; i++)
      s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.05);
    // sanity: condensation actually happened (test is meaningful)
    expect(s.load.nodes[0]!.m_water).toBeGreaterThan(1e-4);
    const E1 = chamberEnergy(s.chamber) + nodeEnergy(s) + jacketEnergy(s.jacket);
    expect(Math.abs(E1 - E0)).toBeLessThan(50); // < 50 J over 10 s: no creation AND no flow-work residual
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

describe('jacket conduction reaches the chamber wall, not the gas', () => {
  it('with a hot jacket and liquid in the chamber, the gas stays near T_sat (not superheated)', () => {
    const p = params(); // jacket_chamber_h_W_per_K = 150
    const T = C_to_K(134);
    const load = buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], T);
    let s: SystemState = {
      chamber: {
        m_air: 1e-6,
        m_vap: (p_sat_water(T) * 0.15) / (R_VAP * T),
        m_liq: 0.05,
        T,
        T_wall: T,
      },
      jacket: {
        m_air: 0,
        m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(140)),
        m_liq: 0,
        T: C_to_K(140),
        T_wall: C_to_K(140),
      },
      generator: null,
      load,
      f0_minutes: 0,
      time_s: 0,
    };
    for (let i = 0; i < 400; i++) {
      s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.05);
    }
    const p_vap = Math.min(
      (s.chamber.m_vap * R_VAP * s.chamber.T) / 0.15,
      p_sat_water(s.chamber.T),
    );
    expect(Math.abs(s.chamber.T - T_sat_water(p_vap))).toBeLessThan(3);
    expect(s.chamber.T).toBeLessThan(C_to_K(139));
  });
});
