import { R_AIR, R_VAP } from './constants.js';
import { p_sat_water } from './saturation.js';

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
