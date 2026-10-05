import { describe, it, expect } from 'vitest';
import { fracaoNivel, yNivel, VASO_TOP, VASO_H } from '../../lib/generator-geometry.js';
import { generator_capacity_kg, LVL_GEN_MIN_FRAC, LVL_GEN_MAX_FRAC } from '@sim/physics';

describe('geometria do vaso do gerador (desenho)', () => {
  const V_total = 0.05; // m³ (singleton.ts / cli.ts)
  const cap = generator_capacity_kg(V_total);

  it('LVL MAX cai no meio do reservatório (fração 0,50)', () => {
    expect(fracaoNivel(cap * LVL_GEN_MAX_FRAC, cap)).toBeCloseTo(0.5, 9);
    expect(yNivel(cap * LVL_GEN_MAX_FRAC, cap)).toBeCloseTo(VASO_TOP + VASO_H * 0.5, 6);
  });

  it('LVL MIN cai a 15% da altura, acima do fundo (resistência)', () => {
    expect(fracaoNivel(cap * LVL_GEN_MIN_FRAC, cap)).toBeCloseTo(0.15, 9);
    const yMin = yNivel(cap * LVL_GEN_MIN_FRAC, cap);
    const yMax = yNivel(cap * LVL_GEN_MAX_FRAC, cap);
    // MIN fica abaixo (y maior) do MAX, mas ainda bem acima do fundo do vaso (y = VASO_TOP + VASO_H).
    expect(yMin).toBeGreaterThan(yMax);
    expect(yMin).toBeLessThan(VASO_TOP + VASO_H);
  });

  it('satura em 0 e 1 fora da faixa (vazio / transbordo)', () => {
    expect(fracaoNivel(-5, cap)).toBe(0);
    expect(fracaoNivel(cap * 2, cap)).toBe(1);
  });
});
