import { describe, it, expect } from 'vitest';
import { U_FG0, R_VAP } from '../src/constants.js';
import { L_eff, vaporU } from '../src/energy.js';
import { h_vap_water, u_fg_water } from '../src/saturation.js';
import { C_to_K, CV_VAP, CP_VAP, CP_LIQ } from '../src/constants.js';

describe('common energy reference', () => {
  it('U_FG0 makes the effective (internal-energy) latent match u_fg at 121 C', () => {
    const T = C_to_K(121);
    expect(Math.abs(L_eff(T) - u_fg_water(T))).toBeLessThan(2000); // < 2 kJ/kg
  });

  it('effective latent tracks u_fg across the autoclave range', () => {
    // Slope of L_eff is CP_LIQ−CV_VAP = 2651 J/(kg·K) vs 3220 for real u_fg → drift ≤ 25 kJ/kg (1.2 %).
    for (const tc of [80, 100, 121, 134, 150]) {
      const T = C_to_K(tc);
      expect(Math.abs(L_eff(T) - u_fg_water(T))).toBeLessThan(25e3);
    }
  });

  it('transported latent h_vap − h_liq = L_eff + R_VAP·T reproduces h_fg (IAPWS) near 121 C', () => {
    const T = C_to_K(121);
    const h_fg_model = CP_VAP * T + U_FG0 - CP_LIQ * T;
    expect(h_fg_model).toBeCloseTo(L_eff(T) + R_VAP * T, 3);
    // h_vap_water (ajuste linear) erra ~5 kJ/kg vs IAPWS a 121 °C; folga de 10 kJ/kg (0,5 %).
    expect(Math.abs(h_fg_model - h_vap_water(T))).toBeLessThan(10e3);
  });

  it('vapor obeys Mayer: CP_VAP − CV_VAP = R_VAP', () => {
    expect(CP_VAP - CV_VAP).toBeCloseTo(R_VAP, 9);
  });

  it('vaporU = CV_VAP*T + U_FG0', () => {
    const T = C_to_K(134);
    expect(vaporU(1, T)).toBeCloseTo(CV_VAP * T + U_FG0, 6);
    expect(vaporU(3, T)).toBeCloseTo(3 * (CV_VAP * T + U_FG0), 6);
  });
});
