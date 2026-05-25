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
const RHO_LIQ = 958.4;

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

  if (Q_in > 0) {
    // Generator is a sealed pressure vessel.
    // Sub-saturated (no vapor yet): heat raises liquid T until first boiling begins at 1 atm.
    // Saturated (liquid + vapor): heat evaporates liquid. Vessel is rigid volume V_total;
    //   vapor fills headspace V_gas = V_total - m_liq/rho_liq.  After adding dm_vap, the
    //   new vapor density in V_gas determines the pressure, and since liquid is still present,
    //   T must satisfy p_sat(T) = P_vessel.  We use T_sat_from_p to update T.
    const T_sat_1atm = T_sat_from_p(101325); // ≈ 373 K (100°C)
    const saturated = m_water_vap > 0 || T >= T_sat_1atm;

    if (!saturated && m_water_liq > 0) {
      // Sub-saturated: heater raises liquid temperature
      const dT = Q_in / (m_water_liq * CP_LIQ);
      T = Math.min(T + dT, T_sat_1atm);
    } else if (m_water_liq > 0) {
      // Two-phase saturated: heat evaporates liquid; pressure (and T) climb along saturation curve.
      const dm_vap = Q_in / h_vap_water(T);
      const dm_actual = Math.min(dm_vap, m_water_liq);
      m_water_liq -= dm_actual;
      m_water_vap += dm_actual;
      // Update T to new saturation temperature in the closed vessel.
      const V_liq = m_water_liq / RHO_LIQ;
      const V_gas = Math.max(p.V_total - V_liq, 1e-6);
      const P_vessel = (m_water_vap * R_VAP * T) / V_gas;
      T = T_sat_from_p(Math.max(P_vessel, 101325)); // floor at 1 atm
    }
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
      // Two-phase: pressure is p_sat(T). Lower T to T_sat(P_relief) by condensing excess vapor.
      const T_relief = T_sat_from_p(P_relief);
      if (T_relief < T) {
        const V_liq = m_water_liq / RHO_LIQ;
        const V_gas = Math.max(p.V_total - V_liq, 1e-6);
        const m_vap_at_relief = (P_relief * V_gas) / (R_VAP * T_relief);
        if (m_vap_at_relief < m_water_vap) {
          const dm_cond = m_water_vap - m_vap_at_relief;
          m_water_vap = m_vap_at_relief;
          m_water_liq = Math.min(m_water_liq + dm_cond, p.V_total * RHO_LIQ);
          T = T_relief;
        }
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
