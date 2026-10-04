import { K_to_C, C_to_K } from './constants.js';

// Antoine equation for water. Valid 1°C..100°C strictly, extrapolated for autoclave range.
// Constants from Bridgeman & Aldrich, error <2% in 20°C..180°C.
const A = 8.07131;
const B = 1730.63;
const C = 233.426;
const MMHG_TO_PA = 133.322;

export function p_sat_water(T_K: number): number {
  const t = K_to_C(T_K);
  const p_mmHg = Math.pow(10, A - B / (C + t));
  return p_mmHg * MMHG_TO_PA;
}

// Linear approximation fitted to IAPWS steam tables over autoclave range (0..200°C).
// h_vap(T_C) ≈ 2533.9 - 2.769·T_C  (kJ/kg)
// Matches: 100°C→2257, 120°C→2202, 134°C→2163 kJ/kg within 5 kJ/kg.
export function h_vap_water(T_K: number): number {
  const t = K_to_C(T_K);
  return (2533.9 - 2.769 * t) * 1e3; // J/kg
}

// Internal energy of vaporization u_fg = h_fg − P·v_fg, linear fit to IAPWS-IF97 (100..140 °C):
// u_fg(T_C) ≈ 2412.0 − 3.22·T_C (kJ/kg). Matches 100°C→2088, 121°C→2022, 140°C→1961 within 3 kJ/kg.
export function u_fg_water(T_K: number): number {
  const t = K_to_C(T_K);
  return (2412.0 - 3.22 * t) * 1e3; // J/kg
}

// Inverse of p_sat_water: saturation (boiling) temperature at a given pressure.
// Analytic inversion of the Antoine equation. Below ~1 Pa the log blows up, so the
// result is floored at 273.15 K (near-vacuum boiling point is effectively 0°C for our range).
export function T_sat_water(P_Pa: number): number {
  if (P_Pa <= 1) return C_to_K(0);
  const p_mmHg = P_Pa / MMHG_TO_PA;
  const t = B / (A - Math.log10(p_mmHg)) - C; // °C
  return C_to_K(t);
}
