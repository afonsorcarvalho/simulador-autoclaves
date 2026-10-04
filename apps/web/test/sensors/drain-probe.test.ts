import { describe, it, expect } from 'vitest';
import { DrainProbe, drainTarget_C } from '../../server/sensors/drain-probe.js';
import type { SystemState, SystemParams } from '@sim/physics';
import { C_to_K, R_AIR, R_VAP, buildLoadState } from '@sim/physics';

const V = 0.15;
const params = { chamber: { V, allowLiquid: true } } as SystemParams;

/** Câmara com gás a T_C e pressão total p_bar, fração molar de vapor y. */
function state(T_C: number, p_bar: number, y = 1): SystemState {
  const T = C_to_K(T_C);
  const p = p_bar * 1e5;
  return {
    chamber: {
      m_air: ((1 - y) * p * V) / (R_AIR * T),
      m_vap: (y * p * V) / (R_VAP * T),
      m_liq: 0,
      T,
      T_wall: T,
    },
    load: buildLoadState([], T),
  } as unknown as SystemState;
}

describe('sonda do dreno (PT1)', () => {
  it('vapor superaquecido: lê a T_sat, não o gás', () => {
    expect(drainTarget_C(state(134, 1.2), params)).toBeCloseTo(104.8, 0); // T_sat(1,2 bar)
  });

  it('ar residual (y = 0,5) deixa o dreno mais frio', () => {
    const t = drainTarget_C(state(134, 1.2, 0.5), params); // p_vap = 0,6 bar
    expect(t).toBeGreaterThan(85);
    expect(t).toBeLessThan(87);
  });

  it('inicia no alvo, sem rampa a partir de 0', () => {
    expect(new DrainProbe().step(state(150, 1.013), params, 0.05)).toBeCloseTo(100, 0);
  });

  it('sobe com τ 2 s e desce com τ 5 s', () => {
    const d = new DrainProbe();
    d.step(state(150, 1.013), params, 0.05); // 100 °C
    const quente = state(150, 3.04); // T_sat ≈ 134 °C
    const alvo = drainTarget_C(quente, params);
    for (let i = 0; i < 40; i++) d.step(quente, params, 0.05); // 2 s = 1 τ subindo
    expect(d.value_C!).toBeCloseTo(100 + (alvo - 100) * (1 - Math.exp(-1)), 0);
    for (let i = 0; i < 400; i++) d.step(quente, params, 0.05);
    const topo = d.value_C!;
    const molhado = state(150, 1.013);
    molhado.chamber.m_liq = 0.05; // condensado no dreno fervendo
    for (let i = 0; i < 40; i++) d.step(molhado, params, 0.05); // 2 s descendo
    expect(topo - d.value_C!).toBeCloseTo((topo - 100) * (1 - Math.exp(-0.4)), 0);
  });

  it('seco (vácuo profundo, sem condensado): segue o gás com τ 30 s, não despenca até a T_sat', () => {
    const d = new DrainProbe();
    d.step(state(100, 1.013), params, 0.05); // 100 °C
    const vacuo = state(43, 0.01); // T_sat(0,01 bar) ≈ 7 °C, gás a 43 °C, m_liq = 0
    for (let i = 0; i < 600; i++) d.step(vacuo, params, 0.05); // 30 s = 1 τ seco
    expect(d.value_C!).toBeCloseTo(43 + 57 * Math.exp(-1), 0); // ≈ 64 °C
    for (let i = 0; i < 6000; i++) d.step(vacuo, params, 0.05);
    expect(d.value_C!).toBeGreaterThan(42); // tende ao gás, nunca aos 7 °C da T_sat
  });
});
