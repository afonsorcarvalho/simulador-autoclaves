import { CP_LIQ, R_VAP } from './constants.js';
import { p_sat_water, h_vap_water } from './saturation.js';

export interface GeneratorState {
  m_water_liq: number; // kg
  m_water_vap: number; // kg
  T: number; // K
}

export interface GeneratorParams {
  V_total: number; // m³ (liquid + headspace)
  heater_power_W: number;
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

export function generator_step(
  s: GeneratorState,
  p: GeneratorParams,
  heater_on: boolean,
  outflow_vap: number,
  dt: number,
): GeneratorState {
  let m_water_vap = Math.max(s.m_water_vap - outflow_vap * dt, 0);
  let m_water_liq = s.m_water_liq;
  let T = s.T;

  const Q_in = heater_on ? p.heater_power_W * dt : 0;
  if (Q_in === 0) return { m_water_liq, m_water_vap, T };

  // Saturation criterion:
  // - If no vapor present (m_water_vap == 0): sub-cooled liquid, heat it until T reaches
  //   the saturation temperature at the current saturation pressure (p_sat(T)).
  //   In practice this means: heat until T would exceed T_sat(p_sat(T)) = T, which never
  //   triggers — so we keep heating until the first vapor appears.
  //   We switch to boiling when T >= T_sat at 1 atm = 100°C, or more simply when
  //   T reaches the Antoine boiling point.
  // - If vapor is already present (m_water_vap > 0): the two-phase region is active —
  //   all heat input goes to latent heat (boiling), temperature stays at saturation.
  const T_sat_1atm = T_sat_from_p(101325); // ≈ 373 K (100°C)
  const saturated = m_water_vap > 0 || T >= T_sat_1atm;

  if (!saturated && m_water_liq > 0) {
    // Sub-saturated: heater raises liquid temperature
    const dT = Q_in / (m_water_liq * CP_LIQ);
    T = Math.min(T + dT, T_sat_1atm);
  } else if (m_water_liq > 0) {
    // Two-phase (saturated): heater boils water — energy goes entirely to latent heat
    const dm_vap = Q_in / h_vap_water(T);
    const dm_actual = Math.min(dm_vap, m_water_liq);
    m_water_liq -= dm_actual;
    m_water_vap += dm_actual;
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
