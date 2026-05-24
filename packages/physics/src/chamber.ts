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
export function chamber_step(s: ChamberState, p: ChamberParams, f: ChamberFluxes, dt: number): ChamberState {
  // 1. Provisional mass balance
  let m_air = s.m_air + (f.inflow.air - f.outflow.air) * dt;
  let m_vap = s.m_vap + (f.inflow.vap - f.outflow.vap) * dt;
  let m_liq = s.m_liq + (f.inflow.liq - f.outflow.liq) * dt;
  if (m_air < 0) m_air = 0;
  if (m_vap < 0) m_vap = 0;
  if (m_liq < 0) m_liq = 0;
  if (!p.allowLiquid) m_liq = 0;

  // 2. Energy balance with cv (internal energy) for stored gas, cp (enthalpy) for flows.
  const U_old = s.m_air * CV_AIR * s.T + s.m_vap * CV_VAP * s.T + s.m_liq * CP_LIQ * s.T;
  const H_in =
    (f.inflow.air * CP_AIR + f.inflow.vap * CP_VAP + f.inflow.liq * CP_LIQ) * f.inflow_T;
  const H_out =
    (f.outflow.air * CP_AIR + f.outflow.vap * CP_VAP + f.outflow.liq * CP_LIQ) * s.T;
  const U_new = U_old + (H_in - H_out + f.Q_external) * dt;

  // 3. Solve T from U_new with provisional masses
  const denom_pre = m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ;
  let T = denom_pre > 0 ? U_new / denom_pre : s.T;
  if (!isFinite(T) || T < 1) T = s.T;

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
    const denom = m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ;
    if (denom > 0) T += Q_lat / denom;
  }

  return { m_air, m_vap, m_liq, T };
}
