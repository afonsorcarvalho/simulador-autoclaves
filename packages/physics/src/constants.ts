// SI units throughout. Kelvin internal, Pa internal.

export const R_AIR = 287.05; // J/(kg·K) — dry air
export const R_VAP = 461.5; // J/(kg·K) — water vapor
export const CP_AIR = 1005; // J/(kg·K)
export const CV_AIR = 718; // J/(kg·K)
export const CP_VAP = 1996; // J/(kg·K) — superheated steam ~100-200°C average
/** c_v do vapor pela relação de Mayer (c_p − c_v = R) — gás ideal consistente: o trabalho de
 *  escoamento (CP−CV)·T vale exatamente R_VAP·T e γ = CP/CV. */
export const CV_VAP = CP_VAP - R_VAP; // 1534.5 J/(kg·K)
export const CP_LIQ = 4186; // J/(kg·K) — liquid water
/** Latent-heat offset for vapor internal energy (J/kg), on the common reference
 *  (liquid water, u = CP_LIQ·T, zero at 0 K). Chosen so the effective condensation latent
 *  L_eff(T) = u_vap − u_liq = U_FG0 − (CP_LIQ − CV_VAP)·T matches the INTERNAL energy of
 *  vaporization u_fg(T) = h_fg − P·v_fg (IAPWS) at 121 °C. L_eff is a storage quantity, so the
 *  target is u_fg, not h_fg: the transported h_vap − h_liq = L_eff + R_VAP·T then reproduces h_fg.
 *  (Calibrating to h_fg overstated the latent by R_VAP·T ≈ 180 kJ/kg, ~9 %.)
 *  u_vap = CV_VAP·T + U_FG0 (storage); h_vap = CP_VAP·T + U_FG0 (transport). */
export const U_FG0 = 3.0676e6; // J/kg
export const GAMMA_AIR = 1.4;
export const GAMMA_VAP = CP_VAP / CV_VAP; // ≈ 1.30

export const P_ATM = 101325; // Pa
export const KELVIN_OFFSET = 273.15;
export const T_REF_F0_C = 121.1; // °C, F0 reference temperature
export const T_REF_F0_K = T_REF_F0_C + KELVIN_OFFSET;
export const Z_F0 = 10; // °C, F0 temperature coefficient

// Critical pressure ratio for choked flow: P_down/P_up at which Mach=1 at throat.
export function criticalRatio(gamma: number): number {
  return Math.pow(2 / (gamma + 1), gamma / (gamma - 1));
}

export const CRITICAL_RATIO_AIR = criticalRatio(GAMMA_AIR); // ≈ 0.528
export const CRITICAL_RATIO_VAP = criticalRatio(GAMMA_VAP); // ≈ 0.546

// Conversion helpers
export const C_to_K = (c: number): number => c + KELVIN_OFFSET;
export const K_to_C = (k: number): number => k - KELVIN_OFFSET;
export const bar_to_Pa = (b: number): number => b * 1e5;
export const Pa_to_bar = (p: number): number => p / 1e5;

/** Constante de Stefan-Boltzmann (W/(m²·K⁴)). */
export const SIGMA_SB = 5.67e-8;
/** Calor específico da água líquida (J/(kg·K)). */
export const CP_WATER = 4186;
/** Densidade de referência do gás para escalar a convecção (kg/m³).
 *  Vapor saturado ~1 bar/100 °C ≈ 0.6 kg/m³. Convecção efetiva = h0·(ρ_gas/este valor). */
export const RHO_GAS_ATM_REF = 0.6;
/** Coef. de condensação em filme do vapor na carga, W/(m²·K), vapor puro.
 *  ponytail: knob de calibração; faixa física 3000–8000 (filme de vapor em superfícies
 *  metálicas/têxteis, sem ar). Convecção seca (h0_conv ~30) subestimava ~100× → câmara
 *  ficava superaquecida e o testemunho levava ~10 min p/ chegar a T_sat. */
export const H_COND_DEFAULT = 5000;
/** Dessuperaquecimento gás↔carga molhada que está condensando (W/(m²·K)). A sucção do filme
 *  arrasta o vapor superaquecido contra a superfície fria → bem maior que a convecção seca.
 *  Calibrado: segura a câmara em ≤ T_sat(P)+5 °C no aquecimento (antes ~15 °C acima). */
export const H_DESUP_DEFAULT = 130;
/** Convecção base gás↔carga à densidade de referência (W/(m²·K)). Knob calibrável. */
export const H0_CONV_DEFAULT = 30;
/** Coef. de condensação (kg/(s·m²·Pa)). Knob calibrável. */
export const K_COND_DEFAULT = 2e-6;
/** Coef. de evaporação/flash (kg/(s·m²·Pa)). Knob calibrável. */
export const K_EV_DEFAULT = 2e-6;
