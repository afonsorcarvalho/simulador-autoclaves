import { describe, it, expect } from 'vitest';
import { load_step, type LoadState, type LoadParams } from '../src/load.js';
import { C_to_K } from '../src/constants.js';

const standardLoad: LoadParams = {
  m_metal: 20,
  cp_metal: 500,
  m_fabric: 5,
  cp_fabric: 1500,
  h_gas_metal: 500,
  h_metal_fabric: 30,
};

describe('load_step', () => {
  it('warms metal toward gas T when gas is hotter', () => {
    const s: LoadState = { T_metal: C_to_K(22), T_fabric: C_to_K(22) };
    const { next } = load_step(s, standardLoad, C_to_K(134), 1);
    expect(next.T_metal).toBeGreaterThan(s.T_metal);
  });

  it('fabric warms slower than metal (cascade)', () => {
    const s: LoadState = { T_metal: C_to_K(22), T_fabric: C_to_K(22) };
    let cur = s;
    for (let i = 0; i < 60; i++) cur = load_step(cur, standardLoad, C_to_K(134), 1).next;
    expect(cur.T_metal).toBeGreaterThan(cur.T_fabric);
  });

  it('returns Q_from_gas as positive when gas hotter than metal', () => {
    const s: LoadState = { T_metal: C_to_K(22), T_fabric: C_to_K(22) };
    const { Q_from_gas } = load_step(s, standardLoad, C_to_K(134), 1);
    expect(Q_from_gas).toBeGreaterThan(0);
  });

  it('Q_from_gas is negative when gas colder than metal', () => {
    const s: LoadState = { T_metal: C_to_K(134), T_fabric: C_to_K(134) };
    const { Q_from_gas } = load_step(s, standardLoad, C_to_K(50), 1);
    expect(Q_from_gas).toBeLessThan(0);
  });

  it('fabric catches up at thermal equilibrium over long simulation', () => {
    let cur: LoadState = { T_metal: C_to_K(22), T_fabric: C_to_K(22) };
    for (let i = 0; i < 60 * 60; i++) cur = load_step(cur, standardLoad, C_to_K(134), 1).next;
    expect(cur.T_metal).toBeCloseTo(C_to_K(134), 0);
    expect(cur.T_fabric).toBeCloseTo(C_to_K(134), 0);
  });
});
