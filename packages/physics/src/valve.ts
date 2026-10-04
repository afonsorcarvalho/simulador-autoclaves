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

/** Bomba de vácuo: velocidade nominal (vazão volumétrica na sucção) e pressão final. */
export interface VacuumPumpParams {
  /** Velocidade nominal S_nom (m³/s, na pressão de sucção). */
  S_nom_m3_per_s: number;
  /** Pressão final (última) p_ult (Pa abs) — abaixo dela a bomba não tira mais gás. */
  p_ult_Pa: number;
  /** Multiplicador da velocidade para o VAPOR (padrão 1). Bomba de anel líquido condensa o vapor
   *  no anel/condensador e o "bombeia" com capacidade efetiva maior que a do ar. */
  vapor_factor?: number;
}

/**
 * Vazão mássica (kg/s) de uma espécie que a bomba tira de um volume V (m³) com pressão P (Pa) e massa
 * m_gas (kg) dessa espécie. Curva S(p) = S_nom·(1 − p_ult/p) para p > p_ult, 0 abaixo; ṁ = ρ·S(p).
 * Integrada exatamente no passo (decaimento exponencial da massa: ṁ = m·(1 − e^(−S·dt/V))/dt),
 * de modo que nunca tira mais do que existe — estável para qualquer dt.
 */
export function vacuum_pump_flow(
  P: number,
  m_gas: number,
  V: number,
  pump: VacuumPumpParams,
  dt: number,
): number {
  if (P <= pump.p_ult_Pa || m_gas <= 0 || V <= 0 || dt <= 0) return 0;
  const S = pump.S_nom_m3_per_s * (1 - pump.p_ult_Pa / P);
  return (m_gas * -Math.expm1((-S * dt) / V)) / dt;
}
