import { K_to_C } from './constants.js';

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
