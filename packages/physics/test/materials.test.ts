// packages/physics/test/materials.test.ts
import { describe, it, expect } from 'vitest';
import { MATERIALS, estimateArea, type MaterialName } from '../src/materials.js';

describe('MATERIALS registry', () => {
  it('has sane thermophysical values for every material', () => {
    for (const name of Object.keys(MATERIALS) as MaterialName[]) {
      const m = MATERIALS[name];
      expect(m.rho).toBeGreaterThan(0);
      expect(m.cp).toBeGreaterThan(0);
      expect(m.k).toBeGreaterThan(0);
      expect(m.emissivity).toBeGreaterThanOrEqual(0);
      expect(m.emissivity).toBeLessThanOrEqual(1);
      expect(m.waterCapacity_kg_per_kg).toBeGreaterThanOrEqual(0);
      expect(m.shapeFactor).toBeGreaterThan(0);
    }
  });
  it('textile retains far more water than steel', () => {
    expect(MATERIALS.COTTON_TEXTILE.waterCapacity_kg_per_kg).toBeGreaterThan(
      MATERIALS.STAINLESS_316.waterCapacity_kg_per_kg * 5,
    );
  });
});

describe('estimateArea', () => {
  it('grows monotonically with mass', () => {
    const m = MATERIALS.STAINLESS_316;
    expect(estimateArea(2, m)).toBeGreaterThan(estimateArea(1, m));
  });
  it('follows the (m/rho)^(2/3) law', () => {
    const m = MATERIALS.STAINLESS_316;
    // 8x mass → 4x area
    expect(estimateArea(8 * m.rho, m)).toBeCloseTo(4 * estimateArea(m.rho, m), 6);
  });
});
