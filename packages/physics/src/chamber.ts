import { R_AIR, R_VAP, CV_AIR, CV_VAP, CP_LIQ, CP_AIR, CP_VAP } from './constants.js';
import { p_sat_water, h_vap_water } from './saturation.js';

export interface ChamberState {
  m_air: number; // kg
  m_vap: number; // kg
  m_liq: number; // kg
  T: number; // K
}

export interface ChamberParams {
  V: number; // m³
  allowLiquid: boolean; // false for jacket (vapor only; condensate drips out)
}

export interface ChamberPressureBreakdown {
  p_air: number;
  p_vap: number;
  p_total: number;
}

export function chamber_pressure(s: ChamberState, p: ChamberParams): ChamberPressureBreakdown {
  if (s.T <= 0 || p.V <= 0) return { p_air: 0, p_vap: 0, p_total: 0 };

  const p_air = (s.m_air * R_AIR * s.T) / p.V;
  const p_vap_kinetic = (s.m_vap * R_VAP * s.T) / p.V;
  const p_sat = p_sat_water(s.T);
  const p_vap = Math.min(p_vap_kinetic, p_sat);
  return { p_air, p_vap, p_total: p_air + p_vap };
}

export interface SpeciesFlow {
  air: number; // kg/s
  vap: number; // kg/s
  liq: number; // kg/s
}

export interface ChamberFluxes {
  inflow: SpeciesFlow;
  inflow_T: number; // K
  outflow: SpeciesFlow;
  Q_external: number; // W (positive = into chamber)
}

/**
 * Single-step Euler integration. Mass + energy balances + saturation/condensation.
 * For jacket (allowLiquid=false), condensate is dropped (drips out instantly).
 */
export function chamber_step(
  s: ChamberState,
  p: ChamberParams,
  f: ChamberFluxes,
  dt: number,
): ChamberState {
  // 1. Provisional mass balance — clamp to zero to prevent negative masses.
  // Compute ACTUAL mass removed (capped at available) for energy accounting.
  const dm_air_out_req = f.outflow.air * dt;
  const dm_vap_out_req = f.outflow.vap * dt;
  const dm_liq_out_req = f.outflow.liq * dt;
  const dm_air_in = f.inflow.air * dt;
  const dm_vap_in = f.inflow.vap * dt;
  const dm_liq_in = f.inflow.liq * dt;
  // Actual outflow cannot exceed available mass
  const dm_air_out = Math.min(dm_air_out_req, Math.max(s.m_air + dm_air_in, 0));
  const dm_vap_out = Math.min(dm_vap_out_req, Math.max(s.m_vap + dm_vap_in, 0));
  const dm_liq_out = Math.min(dm_liq_out_req, Math.max(s.m_liq + dm_liq_in, 0));

  let m_air = s.m_air + dm_air_in - dm_air_out;
  let m_vap = s.m_vap + dm_vap_in - dm_vap_out;
  let m_liq = s.m_liq + dm_liq_in - dm_liq_out;
  if (m_air < 0) m_air = 0;
  if (m_vap < 0) m_vap = 0;
  if (m_liq < 0) m_liq = 0;
  if (!p.allowLiquid) m_liq = 0;

  // 2. Energy balance — use ACTUAL (clamped) outflow for consistency with mass balance.
  const U_old = s.m_air * CV_AIR * s.T + s.m_vap * CV_VAP * s.T + s.m_liq * CP_LIQ * s.T;
  const H_in = (dm_air_in * CP_AIR + dm_vap_in * CP_VAP + dm_liq_in * CP_LIQ) * f.inflow_T;
  const H_out = (dm_air_out * CP_AIR + dm_vap_out * CP_VAP + dm_liq_out * CP_LIQ) * s.T;
  const U_new = U_old + H_in - H_out + f.Q_external * dt;

  // 3. Solve T from U_new with provisional masses.
  const T_MAX_K = 273.15 + 600; // 600 °C — hard cap, well above any autoclave condition
  const MIN_HEAT_CAP_JK = 500; // J/K — floor used only in condensation latent heat to prevent
  // T spikes when condensing large vapor mass into tiny liquid at near-vacuum (see step 4).
  const denom_pre = m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ;
  let T = denom_pre > 0 ? U_new / denom_pre : s.T;
  if (!isFinite(T) || T < 1 || T > T_MAX_K) T = Math.min(s.T, T_MAX_K);

  // 3.5. Evaporation: liquid → vapor when sub-saturated
  if (p.allowLiquid && m_liq > 0) {
    const t_C_evap = T - 273.15;
    const p_sat_now = Math.pow(10, 8.07131 - 1730.63 / (233.426 + t_C_evap)) * 133.322;
    const p_vap_now = (m_vap * R_VAP * T) / p.V;
    if (p_vap_now < p_sat_now) {
      const k_evap = 1e-7; // kg/(s·Pa) — empirical; tunable
      const dm_evap_max = m_liq;
      const dm_evap = Math.min(k_evap * (p_sat_now - p_vap_now) * dt, dm_evap_max);
      m_liq -= dm_evap;
      m_vap += dm_evap;
      // Cools system: latent heat absorbed
      const denom_evap = Math.max(
        m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ,
        MIN_HEAT_CAP_JK,
      );
      T -= (dm_evap * h_vap_water(T)) / denom_evap;
    }
  }

  // 4. Saturation / condensation loop (1-3 iterations are enough for typical dt)
  for (let iter = 0; iter < 3; iter++) {
    const p_sat = (() => {
      const t_C = T - 273.15;
      const p_mmHg = Math.pow(10, 8.07131 - 1730.63 / (233.426 + t_C));
      return p_mmHg * 133.322;
    })();
    const m_vap_max = (p_sat * p.V) / (R_VAP * T);
    if (m_vap <= m_vap_max + 1e-9) break;

    const dm_cond = m_vap - m_vap_max;
    if (!p.allowLiquid) {
      // Jacket: condensate drips out immediately
      m_vap = m_vap_max;
      break;
    }
    m_vap -= dm_cond;
    m_liq += dm_cond;
    const Q_lat = dm_cond * h_vap_water(T);
    const denom = Math.max(m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ, MIN_HEAT_CAP_JK);
    T += Q_lat / denom;
    if (T > T_MAX_K) {
      T = T_MAX_K;
      break;
    } // guard against residual runaway
  }

  return { m_air, m_vap, m_liq, T };
}
