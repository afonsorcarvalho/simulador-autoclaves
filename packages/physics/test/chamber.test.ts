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
import { p_sat_water, T_sat_water } from '../src/saturation.js';

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
      m_air: 0.03, // ~1 atm air at 22°C
      m_vap: 0,
      m_liq: 0,
      T: C_to_K(22),
      T_wall: C_to_K(22),
    };
    const f: ChamberFluxes = {
      inflow: { air: 0, vap: 0.004, liq: 0 }, // 4 g/s hot vapor (typical from generator)
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

describe('chamber_step — Q_wall_external heats the wall', () => {
  const walled: ChamberParams = {
    V: 0.15, allowLiquid: true, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200,
  };

  it('external wall heat raises T_wall, not applied to the gas directly', () => {
    const s: ChamberState = { m_air: 0.18, m_vap: 0, m_liq: 0, T: C_to_K(100), T_wall: C_to_K(100) };
    const f: ChamberFluxes = {
      inflow: zeroFlow(), inflow_T: s.T, outflow: zeroFlow(),
      Q_external: 0, Q_wall_external: 25000, // 25 kW into the 25 kJ/K wall → +1 K/s
    };
    const next = chamber_step(s, walled, f, 1);
    expect(next.T_wall!).toBeGreaterThan(s.T_wall!); // wall warmed
    expect(next.T_wall!).toBeCloseTo(C_to_K(100) + 1, 0); // ≈ +1 K (25000 J / 25000 J/K), minus gas coupling
  });
});

describe('wall coupling scales with gas density', () => {
  const p: ChamberParams = { V: 0.15, allowLiquid: true, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200 };
  const base: ChamberState = { m_air: 1e-5, m_vap: 1e-4, m_liq: 0, T: C_to_K(60), T_wall: C_to_K(140) };
  const noFlow: ChamberFluxes = { inflow: { air: 0, vap: 0, liq: 0 }, inflow_T: base.T, outflow: { air: 0, vap: 0, liq: 0 }, Q_external: 0 };

  it('with scale≈0 the near-vacuum gas barely tracks the hot wall', () => {
    const full = chamber_step(base, p, { ...noFlow, wall_coupling_scale: 1 }, 0.05);
    const vac = chamber_step(base, p, { ...noFlow, wall_coupling_scale: 1e-4 }, 0.05);
    // scaled-down coupling ⇒ smaller rise toward the 140 °C wall
    expect(vac.T - base.T).toBeLessThan(full.T - base.T);
  });
});

describe('chamber_step — two-phase saturation pin', () => {
  const walled: ChamberParams = {
    V: 0.15, allowLiquid: true, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200,
  };
  const m_vap_sat = (T: number) => (p_sat_water(T) * 0.15) / (461.5 * T);

  it('pins gas to T_sat(p_vap) while liquid is present, even when the wall is hotter', () => {
    const T = C_to_K(134);
    const s: ChamberState = {
      m_air: 1e-6, m_vap: m_vap_sat(T), m_liq: 0.05, T, T_wall: C_to_K(140),
    };
    let cur = s;
    for (let i = 0; i < 200; i++) cur = chamber_step(cur, walled, noFlux(cur.T), 0.05);
    const p_vap = Math.min((cur.m_vap * 461.5 * cur.T) / 0.15, p_sat_water(cur.T));
    expect(cur.T).toBeCloseTo(T_sat_water(p_vap), 0);
    expect(cur.T).toBeLessThan(C_to_K(140)); // never reached the hot wall
    expect(cur.m_liq).toBeGreaterThan(0); // still two-phase
  });

  it('pins a SUPERHEATED gas back to T_sat in a single step while liquid is present', () => {
    // Gas deliberately above saturation with liquid present (no-wall CV so the equilibrium
    // partition acts on the gas directly). The OLD rate-based model (k_evap-limited
    // evaporation, no pin) leaves the gas superheated at ~150°C, far from its vapor's T_sat;
    // the new equilibrium pin drives it to T_sat(p_vap) in ONE step while liquid remains.
    const T_sup = C_to_K(160); // superheated
    const m_vap = m_vap_sat(C_to_K(120)); // vapor amount whose saturation temp is ~120°C, well below 160
    const s: ChamberState = { m_air: 1e-6, m_vap, m_liq: 0.05, T: T_sup };
    const next = chamber_step(s, params150L, noFlux(T_sup), 0.05);
    const p_vap = Math.min((next.m_vap * 461.5 * next.T) / 0.15, p_sat_water(next.T));
    expect(next.T).toBeCloseTo(T_sat_water(p_vap), 0); // pinned to saturation
    expect(next.T).toBeLessThan(C_to_K(150)); // dropped far below the 160°C superheat
    expect(next.m_liq).toBeGreaterThan(0); // still two-phase
  });

  it('conserves total water mass (m_vap + m_liq) across a step', () => {
    const T = C_to_K(120);
    const s: ChamberState = { m_air: 0, m_vap: 0.02, m_liq: 0.01, T, T_wall: T };
    const next = chamber_step(s, walled, noFlux(T), 0.05);
    expect(next.m_vap + next.m_liq).toBeCloseTo(s.m_vap + s.m_liq, 8);
  });

  it('degenerate m_liq=0 supersaturated: condenses to saturation, no 220°C ceiling', () => {
    const T = C_to_K(60);
    const s: ChamberState = { m_air: 0, m_vap: 0.02, m_liq: 0, T, T_wall: T };
    const next = chamber_step(s, walled, noFlux(T), 0.05);
    expect(next.m_liq).toBeGreaterThan(0); // condensed
    expect(next.T).toBeLessThan(C_to_K(100)); // NOT slammed to the 220°C ceiling
  });

  it('no NaN under a hard vacuum pump-down with liquid present', () => {
    const T = C_to_K(90);
    const s: ChamberState = { m_air: 1e-6, m_vap: 0.001, m_liq: 0.02, T, T_wall: T };
    const f: ChamberFluxes = {
      inflow: zeroFlow(), inflow_T: T, outflow: { air: 0, vap: 0.01, liq: 0 }, Q_external: 0,
    };
    let cur = s;
    for (let i = 0; i < 500; i++) cur = chamber_step(cur, walled, f, 0.05);
    expect(Number.isFinite(cur.T)).toBe(true);
    expect(Number.isFinite(cur.m_vap)).toBe(true);
  });
});
