import { CP_LIQ, CV_VAP, R_VAP } from './constants.js';
import { p_sat_water, h_vap_water, u_fg_water } from './saturation.js';

export interface GeneratorState {
  m_water_liq: number; // kg
  m_water_vap: number; // kg
  T: number; // K
}

export interface GeneratorParams {
  V_total: number; // m³ (liquid + headspace)
  heater_power_W: number;
  /** Safety relief valve setpoint (Pa). Defaults to 3.5 bar = 350 000 Pa if not provided. */
  relief_pressure_Pa?: number;
}

export function generator_pressure(s: GeneratorState, p: GeneratorParams): number {
  // When liquid water is present the vessel is at thermodynamic saturation: P = p_sat(T).
  // When all liquid is gone, use ideal gas law for the remaining superheated vapor.
  if (s.m_water_liq > 0) {
    return p_sat_water(s.T);
  }
  const V_vap = Math.max(p.V_total - s.m_water_liq / 1000, 1e-6);
  return (s.m_water_vap * R_VAP * s.T) / V_vap;
}

// Liquid water density (kg/m³) at ~100°C — good enough for autoclave range.
export const RHO_LIQ = 958.4;

/** Capacidade do gerador (kg de água) com o vaso 100% cheio de líquido — referência para os
 *  limiares de nível dos eletrodos (sensor-publisher) e para o desenho do vaso (GeneratorView). */
export function generator_capacity_kg(V_total_m3: number): number {
  return V_total_m3 * RHO_LIQ;
}

/** Fração da capacidade em que o eletrodo de nível MÍNIMO atua — logo acima da resistência. */
export const LVL_GEN_MIN_FRAC = 0.15;
/** Fração da capacidade em que o eletrodo de nível MÁXIMO atua — meio do reservatório. */
export const LVL_GEN_MAX_FRAC = 0.5;

/** Água de reposição (bomba de alimentação do gerador). */
export interface GeneratorFeed {
  kg_per_s: number;
  /** Temperatura da água de alimentação (K). */
  T_K: number;
}

export function generator_step(
  s: GeneratorState,
  p: GeneratorParams,
  heater_on: boolean,
  outflow_vap: number,
  dt: number,
  feed?: GeneratorFeed,
): GeneratorState {
  let m_water_vap = Math.max(s.m_water_vap - outflow_vap * dt, 0);
  let m_water_liq = s.m_water_liq;
  let T = s.T;

  // Vaso ABERTO sob extração: dU = Q − h_v·dm_out. Tirar dm_out de m_vap à T atual debita u_v;
  // o trabalho de fluxo R_v·T·dm_out (que a câmara credita em h_v) sai daqui — senão nasce
  // ≈ 182 kJ/kg (~8 % do latente) na fronteira gerador→câmara.
  const dm_out = s.m_water_vap - m_water_vap;
  let Q_in = (heater_on ? p.heater_power_W * dt : 0) - dm_out * R_VAP * T;

  // Reposição: entra água fria, mistura com o líquido (sensível debitado do calor disponível —
  // com Q_in = 0 o balanço bifásico abaixo esfria/condensa para pagar o aquecimento dela).
  // Teto de nível: 95 % do vaso, para o headspace nunca zerar.
  if (feed && feed.kg_per_s > 0) {
    const dm_in = Math.min(feed.kg_per_s * dt, Math.max(0.95 * p.V_total * RHO_LIQ - m_water_liq, 0));
    if (dm_in > 0) {
      Q_in -= dm_in * CP_LIQ * (T - feed.T_K);
      m_water_liq += dm_in;
    }
  }

  // Generator is a sealed rigid pressure vessel (V_total; vapor fills V_gas = V_total − m_liq/ρ).
  // Sub-saturated (no vapor yet): heat raises liquid T until first boiling begins at 1 atm.
  // Saturated (liquid + vapor): the vessel re-equilibrates every step — with or without heat —
  //   by an energy balance on the NEW saturation temperature T′:
  //     Q = C_sens·(T′ − T) + [m_v,sat(T′) − m_v]·u_fg(T),   m_v,sat(T′) = p_sat(T′)·V_gas/(R_v·T′)
  //   (u_fg, not h_fg: rigid vessel, no boundary work). Both terms grow with T′ ⇒ monotone ⇒
  //   bisection. Covers heating (evaporation), steam draw-off with heater OFF (liquid flashes and
  //   the boiler COOLS — the old model kept p_sat(T) forever) and inconsistent initial states
  //   (bounded re-equilibration instead of a runaway). Evaporating all of Q (old behaviour) let
  //   the liquid warm for free — ~6 MJ over a 100→148 °C warm-up of 30 L.
  const T_sat_1atm = T_sat_from_p(101325); // ≈ 373 K (100°C)
  // Só a temperatura decide: vapor residual abaixo de 100 °C fica como está (forçar o piso
  // saturado a 100 °C criaria ~MJ do nada num estado {água fria + 1 g de vapor}).
  const saturated = T >= T_sat_1atm - 1e-6;

  if (m_water_liq > 0 && !saturated) {
    if (Q_in !== 0) {
      const dT = Q_in / (m_water_liq * CP_LIQ); // < 0 só com água de reposição fria
      T = Math.min(T + dT, T_sat_1atm);
    }
  } else if (m_water_liq > 0) {
    const m_w = m_water_liq + m_water_vap;
    const C_sens = m_water_liq * CP_LIQ + m_water_vap * CV_VAP;
    const ufg = u_fg_water(T);
    const m_vap_sat = (Tp: number) => {
      // ponytail: V_gas with the CURRENT liquid volume (Δm ≪ m_liq per step).
      const V_gas = Math.max(p.V_total - m_water_liq / RHO_LIQ, 1e-6);
      return Math.min((p_sat_water(Tp) * V_gas) / (R_VAP * Tp), m_w);
    };
    const g = (Tp: number) => C_sens * (Tp - T) + (m_vap_sat(Tp) - m_water_vap) * ufg - Q_in;
    let lo = T_sat_1atm;
    let hi = 573.15;
    if (g(lo) >= 0) {
      hi = lo; // energy only allows the 1 atm floor (old floor behaviour)
    } else {
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (g(mid) < 0) lo = mid;
        else hi = mid;
      }
    }
    const T_new = (lo + hi) / 2;
    const m_vap_new = m_vap_sat(T_new);
    m_water_liq = m_w - m_vap_new;
    m_water_vap = m_vap_new;
    T = T_new;
  }

  // Safety relief valve: always checked regardless of heater state.
  // If generator pressure exceeds setpoint, vent excess vapor to atmosphere.
  // This models the mechanical safety valve fitted to every real autoclave generator.
  // Default 6 bar absolute: real autoclave generators operate at 4-6 bar to supply steam
  // to the chamber at 2-3.5 bar (121-134°C cycles), with overhead for driving valve flow.
  const P_relief = p.relief_pressure_Pa ?? 600000; // default 6 bar absolute
  const P_now = generator_pressure({ m_water_liq, m_water_vap, T }, p);
  if (P_now > P_relief) {
    if (m_water_liq > 0) {
      // Two-phase: pressure is p_sat(T). The valve VENTS vapor; the liquid, now above the new
      // saturation, flashes until T_sat(P_relief) and that vapor leaves too (energy of the flash
      // = sensible heat lost by the liquid). Condensing in place (old behaviour) was a vessel
      // cooling spontaneously with no mass leaving.
      const T_relief = T_sat_from_p(P_relief);
      if (T_relief < T) {
        const dm_flash = Math.min(
          (m_water_liq * CP_LIQ * (T - T_relief)) / h_vap_water(T_relief),
          m_water_liq,
        );
        m_water_liq -= dm_flash;
        const V_gas = Math.max(p.V_total - m_water_liq / RHO_LIQ, 1e-6);
        m_water_vap = Math.min(m_water_vap, (P_relief * V_gas) / (R_VAP * T_relief));
        T = T_relief;
      }
    } else if (m_water_vap > 0) {
      // Superheated vapor only: vent directly until pressure = P_relief.
      const V_gas = Math.max(p.V_total, 1e-6);
      const m_vap_at_relief = (P_relief * V_gas) / (R_VAP * T);
      m_water_vap = Math.max(m_vap_at_relief, 0);
    }
  }

  return { m_water_liq, m_water_vap, T };
}

// Inverse Antoine via bisection: given pressure P_Pa, find saturation temperature T_K.
function T_sat_from_p(P_Pa: number): number {
  if (P_Pa < 100) return 273.15;
  let lo = 273.15;
  let hi = 573.15;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (p_sat_water(mid) < P_Pa) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
