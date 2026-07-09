import { CV_VAP, CP_LIQ, U_FG0 } from './constants.js';

/** Effective condensation latent at temperature T (J/kg): u_vap − u_liq. */
export function L_eff(T_K: number): number {
  return U_FG0 - (CP_LIQ - CV_VAP) * T_K;
}

/** Internal energy of m kg of vapor at T (J), on the common reference. */
export function vaporU(m_kg: number, T_K: number): number {
  return m_kg * (CV_VAP * T_K + U_FG0);
}
