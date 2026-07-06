import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../src/integrator.js';
import { buildLoadState } from '../src/load.js';
import { vaporU } from '../src/energy.js';
import { p_sat_water } from '../src/saturation.js';
import { MATERIALS } from '../src/materials.js';
import { C_to_K, R_VAP, CV_AIR, CP_LIQ } from '../src/constants.js';

function params(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200 },
    jacket: { V: 0.025, allowLiquid: false, wall_mass_kg: 15, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 100 },
    generator: null,
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
    valves: {},
    external: { steam_line_pressure: 5e5, steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
    jacket_chamber_h_W_per_K: 0, // isolate: no external drivers
  };
}

// Sum the TOTAL energy of the closed system on the common latent reference — the SAME
// energy the model integrates: chamber/jacket gas via vaporU + wall sensible heat, and
// each load node's water (liquid, CP_LIQ·T) + material heat capacity (mass·cp·T).
function totalEnergy(s: SystemState): number {
  const cv = (c: SystemState['chamber'], wmass: number, wcp: number) =>
    c.m_air * CV_AIR * c.T + vaporU(c.m_vap, c.T) + c.m_liq * CP_LIQ * c.T +
    (c.T_wall !== undefined ? wmass * wcp * c.T_wall : 0);
  const chamber = cv(s.chamber, 50, 500);
  const jacket = cv(s.jacket, 15, 500);
  const load = s.load.nodes.reduce(
    (a, n) => a + n.m_water * CP_LIQ * n.T + n.mass_kg * MATERIALS[n.material].cp * n.T,
    0,
  );
  return chamber + jacket + load;
}

describe('global energy conservation (closed system, common reference)', () => {
  it('total energy is constant with no valves, no heater, no jacket steam', () => {
    const p = params();
    const T = C_to_K(134);
    // Load starts at the same T as chamber/jacket so the L_eff(node.T) vs Q_comp(T_chamber)
    // second-order flow-work term is nulled — this proves conservation of the accounting itself,
    // not merely that a temperature-difference residual stays small.
    const load = buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], T);
    let s: SystemState = {
      chamber: { m_air: 1e-6, m_vap: (p_sat_water(T) * 0.15) / (R_VAP * T), m_liq: 0.01, T, T_wall: T },
      jacket: { m_air: 0, m_vap: 0.001, m_liq: 0, T: C_to_K(134), T_wall: C_to_K(134) },
      generator: null, load, f0_minutes: 0, time_s: 0,
    };
    const E0 = totalEnergy(s);
    for (let i = 0; i < 400; i++) s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.05);
    const E1 = totalEnergy(s);
    // Observed: bit-exact (rel drift == 0) — the common-reference accounting closes to the
    // last ULP with load starting at chamber T. Tolerance kept at 1e-4 as a guard band.
    expect(Math.abs(E1 - E0) / Math.abs(E0)).toBeLessThan(1e-4); // < 0.01% over 20 s
  });
});
