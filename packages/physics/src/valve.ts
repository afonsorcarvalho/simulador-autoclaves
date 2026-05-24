import { criticalRatio } from './constants.js';

export interface ValveParams {
  Cv: number;
  gamma: number;
  R: number;
}

export function choked_flow(P_up: number, T_up: number, P_down: number, v: ValveParams): number {
  if (P_up <= P_down) return 0;

  const r_crit = criticalRatio(v.gamma);
  const ratio = P_down / P_up;

  const baseFactor = (v.Cv * P_up) / Math.sqrt(v.R * T_up);

  if (ratio <= r_crit) {
    const term = Math.pow(2 / (v.gamma + 1), (v.gamma + 1) / (2 * (v.gamma - 1)));
    return baseFactor * Math.sqrt(v.gamma) * term;
  }

  const r_2_g = Math.pow(ratio, 2 / v.gamma);
  const r_g1_g = Math.pow(ratio, (v.gamma + 1) / v.gamma);
  const inside = ((2 * v.gamma) / (v.gamma - 1)) * (r_2_g - r_g1_g);
  return baseFactor * Math.sqrt(inside);
}
