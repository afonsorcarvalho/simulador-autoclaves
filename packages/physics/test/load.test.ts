// packages/physics/test/load.test.ts
import { describe, it, expect } from 'vitest';
import { load_step, type LoadState, type LoadParams, type LoadEnv } from '../src/load.js';
import { C_to_K } from '../src/constants.js';
import { p_sat_water } from '../src/saturation.js';

const P: LoadParams = { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 };

function envAt(opts: Partial<LoadEnv>): LoadEnv {
  return {
    T_gas: C_to_K(134), rho_gas: 0.6, rho_gas_atm: 0.6,
    T_jacket: C_to_K(134), p_sat_at: p_sat_water, p_vap_chamber: p_sat_water(C_to_K(134)),
    chamber_has_vapor: true, ...opts,
  };
}
function oneNode(over: Partial<LoadState['nodes'][0]> = {}): LoadState {
  return { nodes: [{ name: 'n', material: 'STAINLESS_316', mass_kg: 1, T: C_to_K(134), m_water: 0, ...over }] };
}

describe('load_step', () => {
  it('evaporates (flash) when chamber pressure is below node saturation, cooling the node', () => {
    const s = oneNode({ m_water: 0.05, T: C_to_K(134) });
    const e = envAt({ p_vap_chamber: 5000 }); // deep vacuum, p_sat(134°C)≈3 bar >> 5 kPa
    const r = load_step(s, P, e, 1);
    expect(r.next.nodes[0]!.m_water).toBeLessThan(0.05); // water leaves
    expect(r.next.nodes[0]!.T).toBeLessThan(s.nodes[0]!.T); // latent cooling
    expect(r.vaporToChamber_kg).toBeGreaterThan(0); // vapor to chamber
  });

  it('condenses when node is colder than chamber saturation, warming it and accumulating water', () => {
    const s = oneNode({ T: C_to_K(80), m_water: 0 });
    const e = envAt({ p_vap_chamber: p_sat_water(C_to_K(134)), T_gas: C_to_K(134) });
    const r = load_step(s, P, e, 1);
    expect(r.next.nodes[0]!.m_water).toBeGreaterThan(0); // water accumulates
    expect(r.vaporToChamber_kg).toBeLessThan(0); // vapor removed from chamber
  });

  it('convection scales with gas density (≈0 under vacuum)', () => {
    const s = oneNode({ T: C_to_K(80) });
    const hi = load_step(s, P, envAt({ rho_gas: 0.6, p_vap_chamber: 0 }), 1).Q_conv_from_gas;
    const lo = load_step(s, P, envAt({ rho_gas: 1e-4, p_vap_chamber: 0 }), 1).Q_conv_from_gas;
    expect(Math.abs(lo)).toBeLessThan(Math.abs(hi) * 0.01);
  });

  it('radiation from a hot jacket warms a dry node under vacuum', () => {
    const s = oneNode({ T: C_to_K(60), m_water: 0 });
    const e = envAt({ rho_gas: 1e-6, T_jacket: C_to_K(140), p_vap_chamber: 0 });
    const r = load_step(s, P, e, 1);
    expect(r.Q_rad_from_jacket).toBeGreaterThan(0);
    expect(r.next.nodes[0]!.T).toBeGreaterThan(s.nodes[0]!.T);
  });

  it('conserves water between load and chamber (Σ dwater = −vaporToChamber)', () => {
    const s = oneNode({ m_water: 0.05, T: C_to_K(134) });
    const e = envAt({ p_vap_chamber: 5000 });
    const r = load_step(s, P, e, 1);
    const dWater = r.next.nodes[0]!.m_water - s.nodes[0]!.m_water;
    expect(dWater).toBeCloseTo(-r.vaporToChamber_kg, 12);
  });
});
