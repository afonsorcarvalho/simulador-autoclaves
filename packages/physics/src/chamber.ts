import { R_AIR, R_VAP, CV_AIR, CV_VAP, CP_LIQ, CP_AIR, CP_VAP } from './constants.js';
import { p_sat_water, h_vap_water, T_sat_water } from './saturation.js';

export interface ChamberState {
  m_air: number; // kg
  m_vap: number; // kg
  m_liq: number; // kg
  T: number; // K
  T_wall?: number; // K — wall temperature; if undefined, defaults to T at first step
}

export interface ChamberParams {
  V: number; // m³
  allowLiquid: boolean; // false for jacket (vapor only; condensate drips out)
  /** Mass of the metallic wall in thermal contact with the gas (kg). Default: 0 (no wall model). */
  wall_mass_kg?: number;
  /** Specific heat of the wall material (J/(kg·K)). Default: 500 (stainless steel). */
  wall_cp_J_per_kg_K?: number;
  /** Convective heat-transfer coefficient gas↔wall (W/K). Default: 200. */
  wall_h_W_per_K?: number;
  /** Passive pressure-relief setpoint (Pa). When total pressure exceeds this, excess vapor
   *  (or air if needed) is vented. Undefined = no relief (default, back-compat). */
  relief_pressure_Pa?: number;
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
  /** External heat delivered to the WALL (W, positive = into wall). E.g. jacket→chamber
   *  conduction. Kept separate from Q_external so it never superheats the near-vacuum gas. */
  Q_wall_external?: number;
  /** Escala do acoplamento convectivo parede↔gás (∝ densidade). Default 1 (back-compat). */
  wall_coupling_scale?: number;
}

// Hard temperature bounds for the chamber/jacket control volumes.
// Floor: 200 K (−73 °C, below the lowest possible dew-point during vacuum evacuation).
// Ceiling: 493 K (220 °C, well above any autoclave operating range; steam tables degrade
//   at higher temperatures under Antoine-equation extrapolation, so this is a hard guard).
// These bounds are last-resort guards; normal physics should stay well within them.
export const T_MIN_K = 200; // K  (−73.15 °C)
export const T_MAX_K = 273.15 + 220; // K  (220 °C)

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
  // Cap at 50% of available mass per step to prevent discretization-driven over-evacuation
  // that would produce H_out > U_old and drive U_new negative.
  const dm_air_in = f.inflow.air * dt;
  const dm_vap_in = f.inflow.vap * dt;
  const dm_liq_in = f.inflow.liq * dt;
  const dm_air_out_req = f.outflow.air * dt;
  const dm_vap_out_req = f.outflow.vap * dt;
  const dm_liq_out_req = f.outflow.liq * dt;

  // Max outflow: min(requested, 50% of available) — the 0.5 factor keeps one step from
  // emptying the CV entirely, which would make H_out > U_old and invert T.
  const avail_air = Math.max(s.m_air + dm_air_in, 0);
  const avail_vap = Math.max(s.m_vap + dm_vap_in, 0);
  const avail_liq = Math.max(s.m_liq + dm_liq_in, 0);
  const dm_air_out = Math.min(dm_air_out_req, 0.5 * avail_air);
  const dm_vap_out = Math.min(dm_vap_out_req, 0.5 * avail_vap);
  const dm_liq_out = Math.min(dm_liq_out_req, 0.5 * avail_liq);

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

  // Clamp U_new to [U_floor, U_ceil] to prevent T escaping sane bounds when the gas
  // thermal mass is tiny (near-vacuum) and Q_external is large (high h_gas_metal).
  // U_ceil corresponds to T_MAX_K; U_floor corresponds to T_MIN_K.
  // This ensures that no matter how extreme Q_external or H_out become, T stays in
  // [T_MIN_K, T_MAX_K].  This is the last resort: normal physics should stay within bounds.
  const denom_pre_for_clamp = m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ;
  const U_floor = denom_pre_for_clamp * T_MIN_K; // minimum sensible energy at T_MIN_K
  const U_ceil = denom_pre_for_clamp * T_MAX_K; // maximum sensible energy at T_MAX_K
  const U_raw = U_old + H_in - H_out + f.Q_external * dt;
  const U_new = denom_pre_for_clamp > 0 ? Math.max(U_floor, Math.min(U_raw, U_ceil)) : U_raw;

  // 3. Solve T from U_new with provisional masses.
  const MIN_HEAT_CAP_JK = 500; // J/K — floor used only in condensation latent heat to prevent
  // T spikes when condensing large vapor mass into tiny liquid at near-vacuum (see step 4).
  const denom_pre = denom_pre_for_clamp;
  let T = denom_pre > 0 ? U_new / denom_pre : s.T;
  // Hard bounds: clamp to [T_MIN_K, T_MAX_K] rather than preserving stale s.T
  if (!isFinite(T)) T = s.T;
  T = Math.max(T_MIN_K, Math.min(T, T_MAX_K));

  // 3.2. Wall thermal mass coupling (gas ↔ wall heat exchange via implicit-Euler).
  // The wall acts as a thermal reservoir that damps fast T transients during vacuum pulses.
  // If wall_mass_kg is zero or undefined the model is bypassed (back-compat).
  const wall_mass = p.wall_mass_kg ?? 0;
  const wall_cp = p.wall_cp_J_per_kg_K ?? 500;
  const wall_h = (p.wall_h_W_per_K ?? 200) * (f.wall_coupling_scale ?? 1);
  const wall_C = wall_mass * wall_cp; // J/K
  let T_wall: number | undefined;

  if (wall_C > 0 && wall_h > 0) {
    // Initialize T_wall from state, defaulting to current gas T if not set.
    const T_wall_prev = s.T_wall ?? s.T;
    const gas_C = m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ;
    if (gas_C > 0) {
      // Symmetric implicit-Euler update for the coupled gas+wall system.
      // Both sub-systems relax to a shared steady-state T_inf with time constant tau.
      // dT_gas/dt  = -h/gas_C  * (T_gas  - T_wall)
      // dT_wall/dt =  h/wall_C * (T_gas  - T_wall)
      const T_inf = (gas_C * T + wall_C * T_wall_prev) / (gas_C + wall_C);
      const tau = (gas_C * wall_C) / (wall_h * (gas_C + wall_C));
      const decay = Math.exp(-dt / tau);
      T = T_inf + (T - T_inf) * decay;
      T_wall = T_inf + (T_wall_prev - T_inf) * decay;
      // Keep T within hard bounds after wall exchange
      T = Math.max(T_MIN_K, Math.min(T, T_MAX_K));
    } else {
      // No gas mass — wall stays at previous temperature
      T_wall = s.T_wall ?? s.T;
    }
  }

  // External heat straight into the wall (jacket conduction) — added after gas↔wall relax.
  const Q_wall_ext = f.Q_wall_external ?? 0;
  if (wall_C > 0 && Q_wall_ext !== 0) {
    T_wall = (T_wall ?? s.T_wall ?? s.T) + (Q_wall_ext * dt) / wall_C;
    if (T_wall > T_MAX_K) T_wall = T_MAX_K;
    if (T_wall < T_MIN_K) T_wall = T_MIN_K;
  }
  // If no wall model: T_wall remains undefined (back-compat)

  // 4. Phase equilibrium.
  if (!p.allowLiquid) {
    // Jacket: condensate drips out, latent to the wall (unchanged behaviour).
    for (let iter = 0; iter < 3; iter++) {
      const p_sat = p_sat_water(T);
      const m_vap_max = (p_sat * p.V) / (R_VAP * T);
      if (m_vap <= m_vap_max + 1e-9) break;
      const dm_cond = m_vap - m_vap_max;
      m_vap = m_vap_max;
      if (dm_cond > 0) {
        const Q_lat = dm_cond * h_vap_water(T);
        if (T_wall !== undefined && wall_C > 0) {
          T_wall += Q_lat / wall_C;
          if (T_wall > T_MAX_K) T_wall = T_MAX_K;
        } else {
          const denom = Math.max(m_air * CV_AIR + m_vap * CV_VAP, MIN_HEAT_CAP_JK);
          T += Q_lat / denom;
          if (T > T_MAX_K) T = T_MAX_K;
        }
      }
      break;
    }
  } else {
    // Chamber: two-phase equilibrium partition. Latent exchanged with the WALL (large,
    // stable heat capacity), gas pinned to T_sat while liquid remains. Replaces the
    // rate-based k_evap + gas-heating condensation that spiked at near-vacuum.
    // ponytail: uses h_vap at current T as the latent constant; the wall buffer makes the
    // scheme robust to that approximation. Tune wall_h_W_per_K / wall_mass_kg for real hardware.
    const wallOK = T_wall !== undefined && wall_C > 0;
    const m_vap_sat = (p_sat_water(T) * p.V) / (R_VAP * T);

    if (m_vap > m_vap_sat) {
      // Supersaturated → condense excess to saturation; latent to the wall (or gas floor).
      const dm = m_vap - m_vap_sat;
      m_vap = m_vap_sat;
      m_liq += dm;
      const Q_lat = dm * h_vap_water(T);
      if (wallOK) T_wall! += Q_lat / wall_C;
      else T += Q_lat / Math.max(m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ, MIN_HEAT_CAP_JK);
    } else if (m_liq > 0 && m_vap < m_vap_sat) {
      // Sub-saturated with liquid → evaporate toward saturation; latent drawn FROM the wall.
      let dm = Math.min(m_liq, m_vap_sat - m_vap);
      const gas_C_evap = m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ;
      if (!wallOK) {
        // No wall: latent comes from the gas itself. Cap evaporation so the gas cannot
        // over-cool past its own saturation temperature — otherwise dumping a full liquid
        // charge's latent into the tiny gas heat capacity crashes T and leaves the vapor
        // grossly oversaturated (the very near-vacuum spike this scheme removes). Converges
        // to equilibrium over successive steps, matching the old rate-based evaporator.
        const T_sat_now = T_sat_water((m_vap * R_VAP * T) / p.V);
        const dm_energy = Math.max(0, (gas_C_evap * (T - T_sat_now)) / h_vap_water(T));
        dm = Math.min(dm, dm_energy);
      }
      m_vap += dm;
      m_liq -= dm;
      const Q_lat = dm * h_vap_water(T);
      if (wallOK) T_wall! -= Q_lat / wall_C;
      else T -= Q_lat / Math.max(m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ, MIN_HEAT_CAP_JK);
    }

    // Pin: while liquid remains, the gas cannot exceed its saturation temperature. Clamp T to
    // T_sat(p_vap) and deposit the sensible surplus/deficit into the wall (energy-conserving).
    if (m_liq > 0) {
      const p_vap = (m_vap * R_VAP * T) / p.V;
      const T_sat = T_sat_water(p_vap);
      const gas_C = m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ;
      if (wallOK) T_wall! += (gas_C * (T - T_sat)) / wall_C;
      T = T_sat;
    }

    if (T_wall !== undefined) {
      if (T_wall > T_MAX_K) T_wall = T_MAX_K;
      if (T_wall < T_MIN_K) T_wall = T_MIN_K;
    }
    T = Math.max(T_MIN_K, Math.min(T, T_MAX_K));
  }

  // 5. Pressure relief: vent excess vapor (or air) when P_total exceeds setpoint.
  // Models a passive mechanical relief valve (e.g., on the jacket). No PID — pure set-and-vent.
  if (p.relief_pressure_Pa !== undefined && p.relief_pressure_Pa > 0) {
    const setpoint = p.relief_pressure_Pa;
    const p_air_now = (m_air * R_AIR * T) / p.V;
    // Vapor partial pressure is capped at saturation (same logic as chamber_pressure helper)
    const p_sat_relief = (() => {
      const t_C = T - 273.15;
      const p_mmHg = Math.pow(10, 8.07131 - 1730.63 / (233.426 + t_C));
      return p_mmHg * 133.322;
    })();
    const p_vap_now = Math.min((m_vap * R_VAP * T) / p.V, p_sat_relief);
    const p_total = p_air_now + p_vap_now;
    if (p_total > setpoint) {
      // Vent vapor preferentially (accumulates fastest in steam-fed jacket).
      // Target vapor partial pressure = setpoint - p_air, then back-compute m_vap target.
      const p_vap_target = Math.max(0, setpoint - p_air_now);
      const m_vap_target = (p_vap_target * p.V) / (R_VAP * T);
      if (m_vap_target < m_vap) {
        // Normal case: venting vapor alone brings P down to setpoint.
        m_vap = m_vap_target;
        // T unchanged — venting at constant T is approximately isenthalpic.
      } else {
        // Air alone exceeds setpoint — vent air too until p_air = setpoint.
        m_air = Math.max((setpoint * p.V) / (R_AIR * T), 0);
        m_vap = 0;
      }
    }
  }

  return T_wall !== undefined ? { m_air, m_vap, m_liq, T, T_wall } : { m_air, m_vap, m_liq, T };
}
