import { describe, it, expect } from 'vitest';
import { choked_flow, vacuum_pump_flow } from '../src/valve.js';
import { R_AIR, GAMMA_AIR, P_ATM, C_to_K, bar_to_Pa } from '../src/constants.js';

const airValve = { Cv: 1.0, gamma: GAMMA_AIR, R: R_AIR };

describe('choked_flow', () => {
  it('returns 0 when ΔP = 0', () => {
    const flow = choked_flow(P_ATM, C_to_K(20), P_ATM, airValve);
    expect(flow).toBe(0);
  });

  it('returns 0 when P_down > P_up', () => {
    const flow = choked_flow(P_ATM, C_to_K(20), bar_to_Pa(2), airValve);
    expect(flow).toBe(0);
  });

  it('returns positive flow when P_up > P_down (subsonic)', () => {
    const flow = choked_flow(bar_to_Pa(1.5), C_to_K(20), P_ATM, airValve);
    expect(flow).toBeGreaterThan(0);
  });

  it('chokes when P_down/P_up < critical ratio (0.528 for air)', () => {
    const flow_choked = choked_flow(bar_to_Pa(5), C_to_K(20), bar_to_Pa(1), airValve);
    const flow_subsonic = choked_flow(bar_to_Pa(5), C_to_K(20), bar_to_Pa(4), airValve);
    expect(flow_choked).toBeGreaterThan(flow_subsonic);

    const flow_ultra_choked = choked_flow(bar_to_Pa(5), C_to_K(20), bar_to_Pa(0.001), airValve);
    expect(flow_ultra_choked).toBeCloseTo(flow_choked, 5);
  });

  it('scales linearly with Cv', () => {
    const v1 = { ...airValve, Cv: 1.0 };
    const v2 = { ...airValve, Cv: 2.5 };
    const f1 = choked_flow(bar_to_Pa(3), C_to_K(20), P_ATM, v1);
    const f2 = choked_flow(bar_to_Pa(3), C_to_K(20), P_ATM, v2);
    expect(f2 / f1).toBeCloseTo(2.5, 6);
  });

  it('scales with P_up', () => {
    const f1 = choked_flow(bar_to_Pa(2), C_to_K(20), P_ATM, airValve);
    const f2 = choked_flow(bar_to_Pa(4), C_to_K(20), P_ATM, airValve);
    expect(f2).toBeGreaterThan(f1);
  });

  it('decreases with hotter gas', () => {
    const fcold = choked_flow(bar_to_Pa(3), C_to_K(20), P_ATM, airValve);
    const fhot = choked_flow(bar_to_Pa(3), C_to_K(150), P_ATM, airValve);
    expect(fhot).toBeLessThan(fcold);
  });
});

describe('vacuum_pump_flow', () => {
  const pump = { S_nom_m3_per_s: 75 / 3600, p_ult_Pa: 1000 };
  it('zero na pressão final ou abaixo', () => {
    expect(vacuum_pump_flow(1000, 0.01, 0.15, pump, 0.05)).toBe(0);
    expect(vacuum_pump_flow(500, 0.01, 0.15, pump, 0.05)).toBe(0);
  });
  it('ṁ ≈ ρ·S(p) para passo pequeno, e nunca tira mais do que existe', () => {
    const m = 0.18;
    const P = 101325;
    const S = pump.S_nom_m3_per_s * (1 - pump.p_ult_Pa / P);
    expect(vacuum_pump_flow(P, m, 0.15, pump, 1e-4)).toBeCloseTo((m / 0.15) * S, 6);
    expect(vacuum_pump_flow(P, m, 0.001, pump, 10) * 10).toBeLessThanOrEqual(m);
  });
});
