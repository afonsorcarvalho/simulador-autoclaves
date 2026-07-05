// packages/physics/test/constants.test.ts
import { describe, it, expect } from 'vitest';
import { SIGMA_SB, CP_WATER, RHO_GAS_ATM_REF, H0_CONV_DEFAULT, K_COND_DEFAULT, K_EV_DEFAULT } from '../src/constants.js';

describe('drying-model constants', () => {
  it('exposes Stefan-Boltzmann and water cp', () => {
    expect(SIGMA_SB).toBeCloseTo(5.67e-8, 10);
    expect(CP_WATER).toBe(4186);
  });
  it('exposes calibration defaults (positive)', () => {
    for (const v of [RHO_GAS_ATM_REF, H0_CONV_DEFAULT, K_COND_DEFAULT, K_EV_DEFAULT]) {
      expect(v).toBeGreaterThan(0);
    }
  });
});
