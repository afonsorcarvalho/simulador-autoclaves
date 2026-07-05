import { describe, it, expect } from 'vitest';
import { U_FG0 } from '../src/constants.js';
import { L_eff, vaporU } from '../src/energy.js';
import { h_vap_water } from '../src/saturation.js';
import { C_to_K, CV_VAP } from '../src/constants.js';

describe('common enthalpy reference', () => {
  it('U_FG0 makes effective latent match h_vap_water near 121 C', () => {
    const T = C_to_K(121);
    expect(L_eff(T)).toBeCloseTo(h_vap_water(T), -1);
  });

  it('effective latent tracks h_vap_water across the autoclave range', () => {
    for (const tc of [80, 100, 121, 134, 150]) {
      const T = C_to_K(tc);
      expect(Math.abs(L_eff(T) - h_vap_water(T))).toBeLessThan(2000); // < 2 kJ/kg everywhere
    }
  });

  it('vaporU = CV_VAP*T + U_FG0', () => {
    const T = C_to_K(134);
    expect(vaporU(1, T)).toBeCloseTo(CV_VAP * T + U_FG0, 6);
    expect(vaporU(3, T)).toBeCloseTo(3 * (CV_VAP * T + U_FG0), 6);
  });
});
