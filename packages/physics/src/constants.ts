// SI units throughout. Kelvin internal, Pa internal.

export const R_AIR = 287.05; // J/(kg·K) — dry air
export const R_VAP = 461.5; // J/(kg·K) — water vapor
export const CP_AIR = 1005; // J/(kg·K)
export const CV_AIR = 718; // J/(kg·K)
export const CP_VAP = 1996; // J/(kg·K) — superheated steam ~100-200°C average
export const CV_VAP = 1410; // J/(kg·K)
export const CP_LIQ = 4186; // J/(kg·K) — liquid water
export const GAMMA_AIR = 1.4;
export const GAMMA_VAP = 1.33;

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
export const CRITICAL_RATIO_VAP = criticalRatio(GAMMA_VAP); // ≈ 0.542

// Conversion helpers
export const C_to_K = (c: number): number => c + KELVIN_OFFSET;
export const K_to_C = (k: number): number => k - KELVIN_OFFSET;
export const bar_to_Pa = (b: number): number => b * 1e5;
export const Pa_to_bar = (p: number): number => p / 1e5;
