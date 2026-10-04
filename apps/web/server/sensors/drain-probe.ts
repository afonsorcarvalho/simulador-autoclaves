import type { SystemState, SystemParams } from '@sim/physics';
import { chamber_pressure, K_to_C, R_AIR, R_VAP, T_sat_water } from '@sim/physics';

// ponytail: sonda do DRENO (PT1): segue a T_sat da pressão parcial do vapor (ponto frio, banhada em
// condensado). Subindo = vapor condensando nela (rápido); descendo = condensado fervendo / tubo esfriando.
// Knobs de calibração contra o equipamento real.
const TAU_SOBE_S = Number(process.env.SIM_DRENO_TAU_SOBE_S ?? 2);
const TAU_DESCE_S = Number(process.env.SIM_DRENO_TAU_DESCE_S ?? 5);
// Seco (sem vapor condensando nem condensado fervendo): tubo/sonda trocam calor só com o gás -> lento.
const TAU_SECO_S = Number(process.env.SIM_DRENO_TAU_SECO_S ?? 30);
/** Condensado mínimo na câmara (kg) para a sonda ainda estar molhada (flash). */
const M_LIQ_MOLHADO_KG = 1e-3;

/** T_sat da pressão parcial do vapor (°C), nunca acima do gás. */
export function drainTarget_C(state: SystemState, params: SystemParams): number {
  const c = state.chamber;
  const t_gas = K_to_C(c.T);
  // fração molar de vapor = m·R de cada espécie (mesma T)
  const nv = c.m_vap * R_VAP;
  const na = c.m_air * R_AIR;
  const y = nv + na > 0 ? nv / (nv + na) : 1;
  const p_vap_Pa = y * chamber_pressure(c, params.chamber).p_total;
  return p_vap_Pa > 100 ? Math.min(t_gas, T_sat_water(p_vap_Pa) - 273.15) : t_gas;
}

/** Sonda do dreno com atraso de 1ª ordem assimétrico, avançada com o dt da simulação. */
export class DrainProbe {
  /** Leitura atual (°C); null até o 1º step (inicia no alvo, sem rampa a partir de 0). */
  value_C: number | null = null;

  step(state: SystemState, params: SystemParams, dt_s: number): number {
    const t_sat = drainTarget_C(state, params);
    const v = this.value_C;
    if (v === null) return (this.value_C = t_sat);
    let alvo: number;
    let tau: number;
    if (t_sat > v) {
      // vapor condensa na sonda (ela está mais fria que a saturação): aquece rápido
      [alvo, tau] = [t_sat, TAU_SOBE_S];
    } else if (state.chamber.m_liq > M_LIQ_MOLHADO_KG) {
      // condensado no dreno fervendo (flash): esfria acompanhando a saturação
      [alvo, tau] = [t_sat, TAU_DESCE_S];
    } else {
      // seco (vácuo profundo / ar): sem vapor nem água, segue o gás devagar; não despenca até a T_sat
      [alvo, tau] = [K_to_C(state.chamber.T), TAU_SECO_S];
    }
    return (this.value_C = v + (alvo - v) * (1 - Math.exp(-dt_s / tau)));
  }
}
