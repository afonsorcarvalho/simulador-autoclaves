import { R_AIR, R_VAP, CV_AIR, CV_VAP, CP_LIQ, CP_AIR, CP_VAP, U_FG0 } from './constants.js';
import { p_sat_water } from './saturation.js';
import { vaporU } from './energy.js';

export interface ChamberState {
  m_air: number; // kg
  m_vap: number; // kg
  m_liq: number; // kg
  T: number; // K
  T_wall?: number; // K — wall temperature; if undefined, defaults to T at first step
  /** Liquid outflow actually applied THIS step (kg), after the 50% available-mass cap below.
   *  Callers that need to know how much drain really left (e.g. to back out condensation-only
   *  mass from the liquid balance) read this instead of recomputing the same cap. Stale/unused
   *  as an input — only meaningful on the value chamber_step() just returned. */
  dm_liq_out?: number;
  /** Gás que saiu de fato neste passo (kg, pós-teto de 50%) — mesmo contrato de dm_liq_out. */
  dm_air_out?: number;
  dm_vap_out?: number;
  /** Ventado pelo alívio de pressão neste passo (kg). */
  dm_relief_air?: number;
  dm_relief_vap?: number;
  /** Condensado descartado (allowLiquid=false, camisa) neste passo (kg). */
  dm_drop?: number;
}

export interface ChamberParams {
  V: number; // m³
  allowLiquid: boolean; // false for jacket (vapor only; condensate drips out)
  /** Mass of the metallic wall in thermal contact with the gas (kg). Default: 0 (no wall model). */
  wall_mass_kg?: number;
  /** Specific heat of the wall material (J/(kg·K)). Default: 500 (stainless steel). */
  wall_cp_J_per_kg_K?: number;
  /** Gas↔wall coefficient (W/K) with pure steam (condensing film). Default: 200. */
  wall_h_W_per_K?: number;
  /** Gas↔wall coefficient (W/K) with dry air (natural convection, ~10× smaller). The effective
   *  coefficient interpolates by vapor MOLE fraction y (same blocking rule as the load's h_cond):
   *  h = h_air + (h_steam − h_air)·y. Default: wall_h_W_per_K (composition-independent, back-compat). */
  wall_h_air_W_per_K?: number;
  /** Gas↔wall coefficient (W/K) with pure DRY steam (wall above dew point: forced convection of
   *  the inlet jet, no film). h_dry = h_air·(1−y) + h_steam_dry·y. Default: wall_h_air_W_per_K. */
  wall_h_steam_dry_W_per_K?: number;
  /** Passive pressure-relief setpoint (Pa). When total pressure exceeds this, excess vapor
   *  (or air if needed) is vented. Undefined = no relief (default, back-compat). */
  relief_pressure_Pa?: number;
  /** Ambient heat-loss coefficient (W/K), chamber wall/gas → atmosphere. Default 0 (back-compat). */
  h_ambient_W_per_K?: number;
  /** Passive condensate-drain (steam trap) rate (kg/s) removing chamber liquid + enthalpy.
   *  Default 0 (back-compat). */
  drain_kg_per_s?: number;
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
  // that would produce H_out > U_old and drive U_gas negative.
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

  // 2. Energy balance. The gas internal energy U_gas carries the latent offset (common
  //    reference): vapor terms include U_FG0 so phase change never has to be booked as a
  //    separate heat deposit. It is the conserved state carried through the whole step.
  const U_old = s.m_air * CV_AIR * s.T + vaporU(s.m_vap, s.T) + s.m_liq * CP_LIQ * s.T;
  const H_in =
    dm_air_in * CP_AIR * f.inflow_T +
    dm_vap_in * (CP_VAP * f.inflow_T + U_FG0) +
    dm_liq_in * CP_LIQ * f.inflow_T;
  const H_out =
    dm_air_out * CP_AIR * s.T + dm_vap_out * (CP_VAP * s.T + U_FG0) + dm_liq_out * CP_LIQ * s.T;
  let U_gas = U_old + H_in - H_out + f.Q_external * dt;

  // Total water: the chamber path partitions this between vapor and liquid at equilibrium.
  const m_w = m_vap + m_liq;
  // Vapor/liquid split at temperature Tc (saturation clamped to the valid range).
  const splitAt = (Tc: number) => {
    const Tk = Math.max(T_MIN_K, Math.min(Tc, T_MAX_K));
    const mv = Math.min(m_w, (p_sat_water(Tk) * p.V) / (R_VAP * Tk));
    return { m_vap: mv, m_liq: m_w - mv };
  };
  // Latent-inclusive internal energy of the gas if it sat at Tc (vapor/liquid split by
  // saturation). Monotone increasing in Tc, so it inverts by bisection.
  const energyAt = (Tc: number) => {
    const { m_vap: mv, m_liq: ml } = splitAt(Tc);
    return m_air * CV_AIR * Tc + vaporU(mv, Tc) + ml * CP_LIQ * Tc;
  };
  // Invert energyAt → temperature (UNCLAMPED). In the valid range this bisects; outside it
  // extrapolates linearly with the boundary heat capacity. The unclamped result matters for
  // the wall coupling: a near-vacuum gas whose energy implies a sub-floor temperature must be
  // seen as that cold, or the wall under-delivers the energy that reheats it. The caller
  // clamps the FINAL temperature to [T_MIN_K, T_MAX_K] as the last-resort guard.
  const invertEnergy = (U: number): { T: number; m_vap: number; m_liq: number } => {
    // Both chamber and jacket solve T + phase split from the latent-inclusive energy by the
    // SAME bisection. The only difference is downstream: the jacket drips its condensate
    // (m_liq forced to 0 after the final solve), the chamber retains it.
    const Elo = energyAt(T_MIN_K);
    const Ehi = energyAt(T_MAX_K);
    let Tc: number;
    if (U <= Elo) {
      const { m_vap: mv, m_liq: ml } = splitAt(T_MIN_K);
      const Cf = m_air * CV_AIR + mv * CV_VAP + ml * CP_LIQ;
      Tc = Cf > 0 ? T_MIN_K - (Elo - U) / Cf : T_MIN_K;
    } else if (U >= Ehi) {
      const { m_vap: mv, m_liq: ml } = splitAt(T_MAX_K);
      const Cc = m_air * CV_AIR + mv * CV_VAP + ml * CP_LIQ;
      Tc = Cc > 0 ? T_MAX_K + (U - Ehi) / Cc : T_MAX_K;
    } else {
      let lo = T_MIN_K;
      let hi = T_MAX_K;
      // 60 iterations → machine precision over the ~293 K bracket.
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (energyAt(mid) < U) lo = mid;
        else hi = mid;
      }
      Tc = (lo + hi) / 2;
    }
    if (!isFinite(Tc)) Tc = s.T;
    const { m_vap: mv, m_liq: ml } = splitAt(Tc);
    return { T: Tc, m_vap: mv, m_liq: ml };
  };

  // Provisional T (for the wall coupling) from the pre-wall internal energy.
  const prov = invertEnergy(U_gas);
  let T = prov.T;

  // 3.2. Wall thermal mass coupling (gas ↔ wall heat exchange via implicit-Euler).
  // The wall acts as a thermal reservoir that damps fast T transients during vacuum pulses.
  // If wall_mass_kg is zero or undefined the model is bypassed (back-compat).
  const wall_mass = p.wall_mass_kg ?? 0;
  const wall_cp = p.wall_cp_J_per_kg_K ?? 500;
  const h_steam = p.wall_h_W_per_K ?? 200;
  const h_air = p.wall_h_air_W_per_K ?? h_steam;
  // Vapor seco (parede acima do orvalho) ainda troca bem: o jato superaquecido da admissão é
  // convecção forçada contra a parede, e é isso que dessuperaquece o gás para perto de T_sat.
  const h_steam_dry = p.wall_h_steam_dry_W_per_K ?? h_air;
  // Fração MOLAR de vapor: o ar não-condensável se acumula na interface e bloqueia o filme de
  // condensação na proporção da pressão parcial (mesma regra do h_cond da carga). O filme só
  // existe se a parede está abaixo do ponto de orvalho (p_vap > p_sat(T_parede)); parede mais
  // quente que o orvalho (ex.: ar úmido após a quebra de vácuo, camisa quente) = convecção seca.
  // ponytail: degrau seco/condensando sem histerese; suavizar se aparecer chattering no HOLD.
  const nv = prov.m_vap * R_VAP;
  const na = m_air * R_AIR;
  const y_vap = nv + na > 0 ? nv / (nv + na) : 1;
  const T_wall_0 = s.T_wall ?? s.T;
  const condensing =
    (nv * prov.T) / p.V > p_sat_water(Math.max(T_MIN_K, Math.min(T_wall_0, T_MAX_K)));
  // Dessuperaquecimento só com gás MAIS quente que a parede (jato de vapor superaquecido da
  // admissão). Parede aquecendo o gás (ar/vapor após a quebra, camisa quente) = convecção natural.
  const desuperheating = prov.T > T_wall_0;
  const wall_h =
    (h_air * (1 - y_vap) + (condensing ? h_steam : desuperheating ? h_steam_dry : h_air) * y_vap) *
    (f.wall_coupling_scale ?? 1);
  const wall_C = wall_mass * wall_cp; // J/K
  let T_wall: number | undefined;

  if (wall_C > 0 && wall_h > 0) {
    // Initialize T_wall from state, defaulting to current gas T if not set.
    const T_wall_prev = s.T_wall ?? s.T;
    const gas_C = m_air * CV_AIR + prov.m_vap * CV_VAP + prov.m_liq * CP_LIQ;
    if (gas_C > 0) {
      // Symmetric implicit-Euler update for the coupled gas+wall system.
      // Both sub-systems relax to a shared steady-state T_inf with time constant tau.
      // dT_gas/dt  = -h/gas_C  * (T_gas  - T_wall)
      // dT_wall/dt =  h/wall_C * (T_gas  - T_wall)
      const T_inf = (gas_C * T + wall_C * T_wall_prev) / (gas_C + wall_C);
      const tau = (gas_C * wall_C) / (wall_h * (gas_C + wall_C));
      const decay = Math.exp(-dt / tau);
      const T_new = T_inf + (T - T_inf) * decay;
      T_wall = T_inf + (T_wall_prev - T_inf) * decay;
      // Move exactly the sensible energy the wall gained out of the gas internal energy,
      // so the latent-inclusive CV energy (gas + wall) is conserved by construction.
      U_gas -= gas_C * (T - T_new);
      // (T is re-derived from U_gas at the final equilibrium below; no need to set it here.)
    } else {
      // No gas mass — wall stays at previous temperature
      T_wall = s.T_wall ?? s.T;
    }
  }

  // External heat straight into the wall (jacket conduction) — added after gas↔wall relax.
  // ponytail: Q_wall_external is dropped if wall_C==0 (the jacket still loses it upstream →
  // energy leak). Fine: two-phase chambers always define a wall. If a wall-less chamber is
  // ever coupled again, route this flux back to the gas (Q_external) instead.
  const Q_wall_ext = f.Q_wall_external ?? 0;
  if (wall_C > 0 && Q_wall_ext !== 0) {
    T_wall = (T_wall ?? s.T_wall ?? s.T) + (Q_wall_ext * dt) / wall_C;
    if (T_wall > T_MAX_K) T_wall = T_MAX_K;
    if (T_wall < T_MIN_K) T_wall = T_MIN_K;
  }
  // If no wall model: T_wall remains undefined (back-compat)

  // 4. Final phase equilibrium from the wall-adjusted internal energy. Phase change is a
  //    pure mass repartition at fixed U_gas — no separate latent heat deposit is needed
  //    because the latent offset already lives inside U_gas. The final temperature is clamped
  //    to [T_MIN_K, T_MAX_K] as the last-resort guard.
  const eq = invertEnergy(U_gas);
  T = Math.max(T_MIN_K, Math.min(eq.T, T_MAX_K));
  m_vap = eq.m_vap;
  m_liq = eq.m_liq;
  const dm_drop = p.allowLiquid ? 0 : m_liq;
  // Jacket drips: the condensate the bisection just partitioned at CP_LIQ·T leaves the CV,
  // carrying exactly that enthalpy out. Energy stays conserved because it was in U_gas.
  if (!p.allowLiquid) m_liq = 0;

  // 5. Pressure relief: vent excess vapor (or air) when P_total exceeds setpoint.
  // Models a passive mechanical relief valve (e.g., on the jacket). No PID — pure set-and-vent.
  const m_air_pre = m_air;
  const m_vap_pre = m_vap;
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
      } else {
        // Air alone exceeds setpoint — vent air too until p_air = setpoint.
        m_air = Math.max((setpoint * p.V) / (R_AIR * T), 0);
        m_vap = 0;
      }
      // O ventilado sai com ENTALPIA h = u + R·T: o gás que fica paga o trabalho de fluxo R·T por kg
      // e esfria. Tirar a massa à T constante (base u) deixava o gás de passagem (válvula aberta +
      // alívio) subir até γ·T_entrada − perdas: 152 °C com vapor de 148 °C.
      const gas_C = m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ;
      if (gas_C > 0) {
        const W_flow = ((m_air_pre - m_air) * R_AIR + (m_vap_pre - m_vap) * R_VAP) * T;
        T = Math.max(T_MIN_K, T - W_flow / gas_C);
      }
    }
  }

  const out = {
    dm_liq_out,
    dm_air_out,
    dm_vap_out,
    dm_relief_air: m_air_pre - m_air,
    dm_relief_vap: m_vap_pre - m_vap,
    dm_drop,
  };
  return T_wall !== undefined
    ? { m_air, m_vap, m_liq, T, T_wall, ...out }
    : { m_air, m_vap, m_liq, T, ...out };
}
