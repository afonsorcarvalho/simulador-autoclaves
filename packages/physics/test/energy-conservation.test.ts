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
  it('conserves total energy under REAL condensation dynamics (load cold, chamber saturated)', () => {
    const p = params();
    const T = C_to_K(134);
    // Load starts COLD (100 °C) vs the 134 °C saturated chamber, so the condensation branch
    // FIRES: vapor condenses onto the cool cotton, wetting it and warming it toward 134. This
    // exercises the load↔chamber phase-change boundary the vacuous (all-at-134) case never did.
    const load = buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], C_to_K(100));
    const w0 = load.nodes[0].m_water;
    const T0 = load.nodes[0].T;
    let s: SystemState = {
      chamber: { m_air: 1e-6, m_vap: (p_sat_water(T) * 0.15) / (R_VAP * T), m_liq: 0.01, T, T_wall: T },
      jacket: { m_air: 0, m_vap: 0.001, m_liq: 0, T: C_to_K(134), T_wall: C_to_K(134) },
      generator: null, load, f0_minutes: 0, time_s: 0,
    };
    const E0 = totalEnergy(s);
    for (let i = 0; i < 400; i++) s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.05);
    const E1 = totalEnergy(s);
    const relDrift = Math.abs(E1 - E0) / Math.abs(E0);
    // Mass that crossed the load↔chamber condensation boundary (where the gross latent bug lives).
    const kgCondensed = s.load.nodes[0].m_water - w0;
    const perKgErr = Math.abs(E1 - E0) / Math.max(kgCondensed, 1e-6); // J per kg of phase change

    // DYNAMICS GUARD — fails if the run went vacuous (nothing moved).
    expect(s.load.nodes[0].m_water).toBeGreaterThan(w0); // load wetted by condensation
    expect(s.load.nodes[0].T).toBeGreaterThan(T0); // load warmed toward chamber T

    // PRIMARY GUARD — throughput-independent per-kg energy balance at the condensation boundary.
    // The gross bug (chamber debits sensible-only while load credits full latent) creates
    // ~1.4 MJ/kg; the genuine second-order residual (vapor sensible cooling T_ch→T_node not fully
    // credited: Q_comp_load uses T_ch, L_eff uses T_node) is ~CV_VAP·(T_ch−T_node) ≈ 42 kJ/kg at a
    // 30 K gradient. 200 kJ/kg sits ~5× above the residual and ~7× below the gross bug, so it
    // catches gross latent creation REGARDLESS of how little mass condenses (the +hv over-credit
    // self-limits dep=q·dt/hv, so a relative-drift bound alone misses it).
    expect(perKgErr).toBeLessThan(200e3);

    // Secondary: relative drift stays tiny under real dynamics (observed ≈ 3.1e-5).
    expect(relDrift).toBeLessThan(1e-3);
  });
});
