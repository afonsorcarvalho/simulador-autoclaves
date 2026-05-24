import { describe, it, expect } from 'vitest';
import { chamber_pressure, type ChamberState, type ChamberParams } from '../src/chamber.js';
import { R_AIR, C_to_K, P_ATM, Pa_to_bar } from '../src/constants.js';

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
