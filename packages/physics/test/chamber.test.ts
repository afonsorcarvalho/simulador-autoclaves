import { describe, it, expect } from 'vitest';
import {
  chamber_pressure,
  chamber_step,
  type ChamberState,
  type ChamberParams,
  type ChamberFluxes,
  type SpeciesFlow,
} from '../src/chamber.js';
import { C_to_K, Pa_to_bar } from '../src/constants.js';

const params150L: ChamberParams = { V: 0.15, allowLiquid: true };

function emptyChamberAt(T_C: number): ChamberState {
  return { m_air: 0, m_vap: 0, m_liq: 0, T: C_to_K(T_C) };
}

describe('chamber_pressure', () => {
  it('returns 0 for an empty chamber', () => {
    const s = emptyChamberAt(20);
    expect(chamber_pressure(s, params150L).p_total).toBe(0);
  });

  it('returns ~1 atm with 1 atm of dry air at 20°C', () => {
    // m = P·V/(R·T). For 1 atm, V=0.15, T=293.15: m ≈ 0.1804 kg
    const s: ChamberState = { m_air: 0.1804, m_vap: 0, m_liq: 0, T: C_to_K(20) };
    const p = chamber_pressure(s, params150L);
    expect(Pa_to_bar(p.p_total)).toBeCloseTo(1.013, 2);
    expect(p.p_vap).toBe(0);
    expect(p.p_air).toBeCloseTo(p.p_total, 2);
  });

  it('clips vapor partial pressure at saturation when oversaturated', () => {
    const s: ChamberState = { m_air: 0, m_vap: 1.0, m_liq: 0, T: C_to_K(100) };
    const p = chamber_pressure(s, params150L);
    expect(Pa_to_bar(p.p_vap)).toBeCloseTo(1.013, 1);
  });

  it('air + vapor sum via Dalton', () => {
    const s: ChamberState = { m_air: 0.1, m_vap: 0.001, m_liq: 0, T: C_to_K(50) };
    const p = chamber_pressure(s, params150L);
    expect(p.p_total).toBeCloseTo(p.p_air + p.p_vap, 0);
  });
});

function zeroFlow(): SpeciesFlow {
  return { air: 0, vap: 0, liq: 0 };
}
function noFlux(T_K: number): ChamberFluxes {
  return { inflow: zeroFlow(), inflow_T: T_K, outflow: zeroFlow(), Q_external: 0 };
}

describe('chamber_step — mass balance', () => {
  it('conserves air mass when no flow and no heat', () => {
    const s = { m_air: 0.18, m_vap: 0, m_liq: 0, T: C_to_K(20) };
    const next = chamber_step(s, params150L, noFlux(s.T), 0.01);
    expect(next.m_air).toBeCloseTo(0.18, 8);
    expect(next.T).toBeCloseTo(s.T, 6);
  });

  it('adds inflow air mass linearly', () => {
    const s = { m_air: 0.1, m_vap: 0, m_liq: 0, T: C_to_K(20) };
    const f: ChamberFluxes = {
      inflow: { air: 0.01, vap: 0, liq: 0 },
      inflow_T: C_to_K(20),
      outflow: zeroFlow(),
      Q_external: 0,
    };
    const next = chamber_step(s, params150L, f, 1);
    expect(next.m_air).toBeCloseTo(0.11, 6);
  });

  it('removes outflow mass linearly', () => {
    const s = { m_air: 0.1, m_vap: 0, m_liq: 0, T: C_to_K(20) };
    const f: ChamberFluxes = {
      inflow: zeroFlow(),
      inflow_T: C_to_K(20),
      outflow: { air: 0.01, vap: 0, liq: 0 },
      Q_external: 0,
    };
    const next = chamber_step(s, params150L, f, 1);
    expect(next.m_air).toBeCloseTo(0.09, 6);
  });
});

describe('chamber_step — energy balance', () => {
  it('raises T when hot air is injected into cold chamber', () => {
    const s = { m_air: 0.1, m_vap: 0, m_liq: 0, T: C_to_K(20) };
    const f: ChamberFluxes = {
      inflow: { air: 0.05, vap: 0, liq: 0 },
      inflow_T: C_to_K(200),
      outflow: zeroFlow(),
      Q_external: 0,
    };
    const next = chamber_step(s, params150L, f, 1);
    expect(next.T).toBeGreaterThan(C_to_K(60));
    expect(next.T).toBeLessThan(C_to_K(200)); // must stay below inflow temperature
  });

  it('cools when Q_external is negative (heat loss)', () => {
    const s = { m_air: 0.18, m_vap: 0, m_liq: 0, T: C_to_K(100) };
    const f: ChamberFluxes = {
      inflow: zeroFlow(),
      inflow_T: C_to_K(100),
      outflow: zeroFlow(),
      Q_external: -1000,
    };
    const next = chamber_step(s, params150L, f, 1);
    expect(next.T).toBeLessThan(s.T);
  });
});

describe('chamber_step — condensation', () => {
  it('condenses vapor and releases latent heat when oversaturated', () => {
    const s = { m_air: 0, m_vap: 0.02, m_liq: 0, T: C_to_K(50) };
    const next = chamber_step(s, params150L, noFlux(s.T), 0.01);
    expect(next.m_liq).toBeGreaterThan(0);
    expect(next.m_vap).toBeLessThan(s.m_vap);
  });

  it('conserves total water mass (m_vap + m_liq) when condensation occurs', () => {
    const s = { m_air: 0, m_vap: 0.02, m_liq: 0.005, T: C_to_K(60) };
    const next = chamber_step(s, params150L, noFlux(s.T), 0.01);
    expect(next.m_vap + next.m_liq).toBeCloseTo(s.m_vap + s.m_liq, 6);
  });
});

describe('chamber_step — evaporation', () => {
  it('evaporates liquid when sub-saturated', () => {
    const s = { m_air: 0.01, m_vap: 0, m_liq: 0.05, T: C_to_K(80) };
    let cur = s;
    for (let i = 0; i < 60 * 100; i++) cur = chamber_step(cur, params150L, noFlux(cur.T), 0.01);
    expect(cur.m_liq).toBeLessThan(s.m_liq);
    expect(cur.m_vap).toBeGreaterThan(s.m_vap);
  });
});

describe('chamber_step — relief valve', () => {
  const params150L_relief: ChamberParams = {
    V: 0.025, // jacket-sized
    allowLiquid: false,
    relief_pressure_Pa: 354000, // 3.54 bar abs
  };

  it('vents excess vapor when pressure exceeds setpoint', () => {
    // Start with vapor pressure way above setpoint
    const s: ChamberState = {
      m_air: 0,
      m_vap: 0.05, // way above what 3.54 bar can hold at this T/V
      m_liq: 0,
      T: C_to_K(140),
    };
    const next = chamber_step(s, params150L_relief, noFlux(s.T), 0.01);
    const p_after = (next.m_vap * 461.5 * next.T) / params150L_relief.V;
    expect(p_after).toBeLessThanOrEqual(354000 * 1.05); // within 5%
  });

  it('does NOT vent below setpoint', () => {
    // Pressure already below setpoint — nothing should happen
    const s: ChamberState = { m_air: 0, m_vap: 0.001, m_liq: 0, T: C_to_K(140) };
    const next = chamber_step(s, params150L_relief, noFlux(s.T), 0.01);
    expect(next.m_vap).toBeCloseTo(s.m_vap, 6);
  });

  it('back-compat: omitting relief_pressure_Pa keeps original behaviour', () => {
    const s: ChamberState = { m_air: 0, m_vap: 0.05, m_liq: 0, T: C_to_K(140) };
    const params_no_relief: ChamberParams = { V: 0.025, allowLiquid: false };
    const next = chamber_step(s, params_no_relief, noFlux(s.T), 0.01);
    // Without relief, vapor stays (clipped only by saturation, not by setpoint)
    expect(next.m_vap).toBeGreaterThan(s.m_vap * 0.5);
  });
});

describe('chamber_step — jacket condensation releases latent heat', () => {
  const jacket_params: ChamberParams = {
    V: 0.025,
    allowLiquid: false,
    wall_mass_kg: 15,
    wall_cp_J_per_kg_K: 500,
    wall_h_W_per_K: 100,
  };

  it('hot vapor entering cold jacket heats the wall via condensation latent heat', () => {
    const s: ChamberState = {
      m_air: 0.03,           // ~1 atm air at 22°C
      m_vap: 0,
      m_liq: 0,
      T: C_to_K(22),
      T_wall: C_to_K(22),
    };
    const f: ChamberFluxes = {
      inflow: { air: 0, vap: 0.004, liq: 0 },  // 4 g/s hot vapor (typical from generator)
      inflow_T: C_to_K(148),
      outflow: zeroFlow(),
      Q_external: 0,
    };
    let cur = s;
    for (let i = 0; i < 90; i++) cur = chamber_step(cur, jacket_params, f, 1); // 90 s
    // Wall + gas warm via condensation latent heat (with MIN_HEAT_CAP_JK floor
    // suppressing unrealistic per-step T-spikes, warming is slower but bounded).
    expect(cur.T_wall).toBeDefined();
    expect(cur.T_wall!).toBeGreaterThan(C_to_K(30)); // bare minimum: warmed above ambient
    expect(cur.T).toBeGreaterThan(C_to_K(30));
  });
});

describe('chamber_step — wall thermal mass', () => {
  const params150L_walled: ChamberParams = {
    V: 0.15,
    allowLiquid: true,
    wall_mass_kg: 50,
    wall_cp_J_per_kg_K: 500,
    wall_h_W_per_K: 200,
  };

  it('vacuum pulse does NOT crash T below freezing (with wall thermal mass)', () => {
    const s: ChamberState = {
      m_air: 0.18,
      m_vap: 0,
      m_liq: 0,
      T: C_to_K(22),
      T_wall: C_to_K(22),
    };
    const f: ChamberFluxes = {
      inflow: zeroFlow(),
      inflow_T: C_to_K(22),
      outflow: { air: 0.05, vap: 0, liq: 0 }, // 50 g/s outflow (heavy vacuum)
      Q_external: 0,
    };
    let cur: ChamberState = s;
    for (let i = 0; i < 60; i++) cur = chamber_step(cur, params150L_walled, f, 1);
    // With 25 kJ/K wall thermal mass, T should drop modestly (10–20°C max, not crash to -73°C)
    expect(cur.T).toBeGreaterThan(C_to_K(0));
    expect(cur.T).toBeLessThan(C_to_K(22));
  });

  it('wall warms up when gas is hot (heat sink behavior)', () => {
    const s: ChamberState = {
      m_air: 0.18,
      m_vap: 0,
      m_liq: 0,
      T: C_to_K(140),
      T_wall: C_to_K(22),
    };
    const next = chamber_step(s, params150L_walled, noFlux(s.T), 60); // 60 s with hot gas, no flows
    expect(next.T_wall).toBeDefined();
    expect(next.T_wall!).toBeGreaterThan(s.T_wall!);
    expect(next.T).toBeLessThan(s.T); // gas cools as wall absorbs heat
  });

  it('back-compat: omitting wall_mass_kg gives original behavior (no wall coupling)', () => {
    const s: ChamberState = { m_air: 0.18, m_vap: 0, m_liq: 0, T: C_to_K(100) };
    const next = chamber_step(s, params150L, noFlux(s.T), 1); // params150L has no wall
    expect(next.T).toBeCloseTo(s.T, 4);
    expect(next.T_wall).toBeUndefined();
  });
});
