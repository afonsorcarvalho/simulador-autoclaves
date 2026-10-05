import { F0Accumulator } from './f0.js';
import {
  chamber_step,
  chamber_pressure,
  type ChamberState,
  type ChamberParams,
  type ChamberFluxes,
  type SpeciesFlow,
} from './chamber.js';
import {
  generator_step,
  generator_pressure,
  type GeneratorState,
  type GeneratorParams,
  type GeneratorFeed,
} from './generator.js';
import { load_step, type LoadState, type LoadParams } from './load.js';
import { p_sat_water } from './saturation.js';
import { choked_flow, vacuum_pump_flow, type ValveParams, type VacuumPumpParams } from './valve.js';
import {
  P_ATM,
  R_AIR,
  GAMMA_AIR,
  GAMMA_VAP,
  RHO_GAS_ATM_REF,
  CP_VAP,
  CV_VAP,
  CP_LIQ,
  U_FG0,
} from './constants.js';

export type VCName = 'chamber' | 'jacket' | 'generator' | 'atmosphere' | 'steam_line' | 'vacuum';

export interface ValveThermostat {
  /** Which volume's pressure controls this valve's auto-close behavior. */
  target: VCName;
  /** Close (trip) the valve when target pressure rises above this (Pa absolute). */
  close_at_Pa: number;
  /** Re-open the valve when target pressure falls below this (Pa absolute). */
  reopen_at_Pa: number;
}

export interface ValveTopology {
  from: VCName;
  to: VCName;
  params: ValveParams;
  /** Optional bang-bang pressure controller. If set, valve is auto-closed even when
   *  manually commanded open whenever target pressure exceeds close_at_Pa, and stays
   *  closed until target pressure falls below reopen_at_Pa (hysteresis to prevent chatter). */
  thermostat?: ValveThermostat;
}

export interface ExternalConditions {
  steam_line_pressure: number;
  steam_line_T: number;
  atmosphere_T: number;
}

export interface SystemParams {
  chamber: ChamberParams;
  jacket: ChamberParams;
  generator: GeneratorParams | null;
  load: LoadParams;
  valves: Record<string, ValveTopology>;
  external: ExternalConditions;
  /** Wall conduction coupling between jacket and chamber (W/K).
   *  Default 0 (no coupling — back-compat). Typical 100-300 W/K for real autoclaves. */
  jacket_chamber_h_W_per_K?: number;
  /** Bomba de vácuo com curva S(p). Se presente, a válvula câmara→'vacuum' (só existe uma, V_VAC)
   *  fica limitada pela bomba (ṁ_i = ρ_i·S(p)) em vez do escoamento crítico até o nó fixo de
   *  10 mbar. Válvulas jacket→vacuum (não usadas) continuam no modelo antigo. Com vapor_factor > 1
   *  o vapor sai mais rápido que o ar, então a mistura deriva p/ ar mais cedo que com ρ·S puro —
   *  aceitável como substituto do condensador do anel líquido. */
  vacuum_pump?: VacuumPumpParams;
  /** Bomba de reposição do gerador (ativa com V_GEN_WATER_IN). Default 3 L/min à T ambiente. */
  generator_feed?: GeneratorFeed;
  /** Abertura efetiva das portas (0..2: soma das posições 0..1 de cada porta). Default 0. */
  door_open?: number;
  /** Perda parede→ambiente por porta totalmente aberta (W/K). Default DOOR_H_OPEN_DEFAULT. */
  door_h_open_W_per_K?: number;
  /** Constante de tempo (s) da troca gás↔ar ambiente com UMA porta aberta. Default DOOR_TAU_GAS_DEFAULT. */
  door_tau_gas_s?: number;
  /** Constante de tempo (s) da equalização de PRESSÃO câmara↔atmosfera com porta aberta. Default DOOR_TAU_PRESSURE_DEFAULT. */
  door_tau_pressure_s?: number;
}

/** Câmara de ~500 L: superfície interna ~3,5 m² com h de convecção natural ~10 W/m²K ≈ 35 W/K;
 *  arredondado p/ 40 W/K por porta. Parede de 150 kg inox (75 kJ/K) → τ ≈ 31 min com 1 porta. */
export const DOOR_H_OPEN_DEFAULT = 40;
/** Troca de ar pela porta aberta (~0,35 m², fluxo de empuxo ~25 L/s) renova 500 L em ~20 s. */
export const DOOR_TAU_GAS_DEFAULT = 20;
/** Um vão de porta iguala a pressão quase na hora. Desvio residual = τ·(taxa de subida da pressão por aquecimento/evaporação): no pior caso (gás esquentando ~12 °C/s na parede a 134 °C) 0,5 s dava ~0,026 bar e 0,2 s ~0,011 bar; 0,1 s fica em ~0,005. Piso = dt (fração por passo ≤ 1, sem overshoot). */
export const DOOR_TAU_PRESSURE_DEFAULT = 0.1;
/** Abaixo desta abertura (soma 0..2) a porta não equaliza pressão (vedação encostando). */
export const DOOR_PRESSURE_MIN_OPEN = 0.02;
/** Bomba de alimentação do gerador: ~3 L/min (0,05 kg/s), típica de geradores de 20–50 kW. */
export const GEN_FEED_DEFAULT_KG_S = 0.05;

export interface SystemState {
  chamber: ChamberState;
  jacket: ChamberState;
  generator: GeneratorState | null;
  load: LoadState;
  f0_minutes: number;
  time_s: number;
  /** Per-valve thermostat tripped state. true = closed by thermostat (overrides manual command). */
  valve_tripped?: Record<string, boolean>;
  /** Saída do último passo (kg, todos ≥ 0): condensação/evaporação brutas na carga e no líquido
   *  da câmara (parede), escoamento carga→câmara e líquido que saiu pelo dreno.
   *  Σcond_load − Σevap_load − Σload_to_chamber = Δ(água na carga). */
  cond_load_kg?: number;
  evap_load_kg?: number;
  cond_wall_kg?: number;
  evap_wall_kg?: number;
  load_to_chamber_kg?: number;
  drain_kg?: number;
  /** Massas por caminho no último passo (kg) + entalpia do vapor injetado (J). Opcional. */
  flows?: StepFlows;
}

/** Massas (kg, ≥ 0) que passaram por cada caminho no passo. Saídas da câmara já descontam o
 *  teto de 50% do chamber_step (rateadas por caminho). Exaustão inclui V_EXHAUST, o gás de
 *  V_DRAIN_INT e o alívio de pressão (tudo vai p/ atmosfera). Dreno líquido = drain_kg.
 *  steam_in_H_J = Σ m·h_vap(T_origem) no modelo (h = CP_VAP·T + U_FG0, mesma base do chamber). */
export interface StepFlows {
  steam_in_chamber_kg: number;
  steam_in_jacket_kg: number;
  steam_in_H_J: number;
  exhaust_air_kg: number;
  exhaust_vap_kg: number;
  vacuum_air_kg: number;
  vacuum_vap_kg: number;
  air_in_kg: number;
  door_air_in_kg: number;
  door_air_out_kg: number;
  door_vap_out_kg: number;
  jacket_cond_kg: number;
}

export interface ValveCommands {
  [valveId: string]: boolean;
}

export interface ActuatorCommands {
  heater_gen: boolean;
  pump_vac: boolean;
}

interface FlowAccum {
  air_in: number;
  vap_in: number;
  air_out: number;
  vap_out: number;
  inflow_T_weighted: number;
  inflow_T_mass: number;
}

function emptyAccum(): FlowAccum {
  return { air_in: 0, vap_in: 0, air_out: 0, vap_out: 0, inflow_T_weighted: 0, inflow_T_mass: 0 };
}

function speciesIn(a: FlowAccum): SpeciesFlow {
  return { air: a.air_in, vap: a.vap_in, liq: 0 };
}
function speciesOut(a: FlowAccum): SpeciesFlow {
  return { air: a.air_out, vap: a.vap_out, liq: 0 };
}

function inflowT(a: FlowAccum, fallback: number): number {
  return a.inflow_T_mass > 0 ? a.inflow_T_weighted / a.inflow_T_mass : fallback;
}

function vcPressure(name: VCName, s: SystemState, p: SystemParams): { P: number; T: number } {
  switch (name) {
    case 'chamber': {
      const cp = chamber_pressure(s.chamber, p.chamber);
      return { P: cp.p_total, T: s.chamber.T };
    }
    case 'jacket': {
      const cp = chamber_pressure(s.jacket, p.jacket);
      return { P: cp.p_total, T: s.jacket.T };
    }
    case 'generator': {
      if (!s.generator || !p.generator) return { P: 0, T: 0 };
      return { P: generator_pressure(s.generator, p.generator), T: s.generator.T };
    }
    case 'atmosphere':
      return { P: P_ATM, T: p.external.atmosphere_T };
    case 'steam_line':
      return { P: p.external.steam_line_pressure, T: p.external.steam_line_T };
    case 'vacuum':
      return { P: 1000, T: 273.15 }; // ~10 mbar effective vacuum pump suction
  }
}

export function system_step(
  state: SystemState,
  params: SystemParams,
  valves: ValveCommands,
  actuators: ActuatorCommands,
  dt: number,
): SystemState {
  const acc: Record<'chamber' | 'jacket' | 'generator', FlowAccum> = {
    chamber: emptyAccum(),
    jacket: emptyAccum(),
    generator: emptyAccum(),
  };
  let generatorVaporOutflow = 0;
  // Taxas brutas (kg/s) por caminho de saída da câmara; rateadas pelo saído real no fim.
  const out = { exh_air: 0, exh_vap: 0, vac_air: 0, vac_vap: 0, door_air: 0, door_vap: 0 };
  let steamInCh = 0,
    steamInJk = 0,
    steamH = 0,
    airIn = 0,
    doorAirIn = 0;

  // Update thermostat state per valve (bang-bang with hysteresis)
  const prevTripped = state.valve_tripped ?? {};
  const valve_tripped: Record<string, boolean> = {};
  for (const [vId, topo] of Object.entries(params.valves)) {
    if (!topo.thermostat) continue;
    const P_target = vcPressure(topo.thermostat.target, state, params).P;
    const wasClosed = prevTripped[vId] ?? false;
    // Hysteresis: once closed, stay closed until P drops below reopen threshold
    if (wasClosed) {
      valve_tripped[vId] = P_target > topo.thermostat.reopen_at_Pa;
    } else {
      valve_tripped[vId] = P_target > topo.thermostat.close_at_Pa;
    }
  }

  for (const [vId, topo] of Object.entries(params.valves)) {
    if (!valves[vId]) continue;
    if (valve_tripped[vId]) continue; // thermostat override: keep closed
    // Vacuum line only flows when pump is on — clean skip
    if (topo.to === 'vacuum' && !actuators.pump_vac) continue;

    const up = vcPressure(topo.from, state, params);
    const down = vcPressure(topo.to, state, params);
    if (topo.to === 'vacuum' && params.vacuum_pump && topo.from === 'chamber') {
      // Bomba limita a vazão (V_VAC tratada como sem perda); ar e vapor saem cada um com ρ_i·S.
      const pump = params.vacuum_pump;
      const V = params.chamber.V;
      const va = vacuum_pump_flow(up.P, state.chamber.m_air, V, pump, dt);
      const pumpVap = { ...pump, S_nom_m3_per_s: pump.S_nom_m3_per_s * (pump.vapor_factor ?? 1) };
      const vv = vacuum_pump_flow(up.P, state.chamber.m_vap, V, pumpVap, dt);
      acc.chamber.air_out += va;
      acc.chamber.vap_out += vv;
      out.vac_air += va;
      out.vac_vap += vv;
      continue;
    }
    const m = choked_flow(up.P, up.T, down.P, topo.params);
    if (m <= 0) continue;

    // Species apportionment:
    // - generator / steam_line source → all vapor
    // - atmosphere source → all air
    // - chamber / jacket source → split proportional to mass fractions
    let air_share = 0,
      vap_share = 0;
    if (topo.from === 'generator' || topo.from === 'steam_line') {
      vap_share = m;
    } else if (topo.from === 'atmosphere') {
      air_share = m;
    } else {
      // chamber or jacket: outflow mirrors the species mix inside
      const fromKey = topo.from as 'chamber' | 'jacket';
      const src = state[fromKey] as ChamberState;
      const total = src.m_air + src.m_vap;
      const air_frac = total > 0 ? src.m_air / total : 1;
      air_share = m * air_frac;
      vap_share = m * (1 - air_frac);
    }

    // Subtract from upstream CV (only chamber/jacket/generator have mutable accumulators)
    if (topo.from === 'chamber' || topo.from === 'jacket') {
      acc[topo.from].air_out += air_share;
      acc[topo.from].vap_out += vap_share;
      if (topo.from === 'chamber') {
        const k = topo.to === 'vacuum' ? 'vac' : 'exh';
        out[`${k}_air`] += air_share;
        out[`${k}_vap`] += vap_share;
      }
    }
    if (vap_share > 0 && (topo.from === 'generator' || topo.from === 'steam_line')) {
      if (topo.to === 'chamber') steamInCh += vap_share;
      if (topo.to === 'jacket') steamInJk += vap_share;
      if (topo.to === 'chamber' || topo.to === 'jacket')
        steamH += vap_share * (CP_VAP * up.T + U_FG0);
    }
    if (topo.from === 'atmosphere' && topo.to === 'chamber') airIn += air_share;
    if (topo.from === 'generator') {
      // Generator emits plain vapor mass at its T; the latent offset U_FG0 is applied by the
      // receiving chamber_step's H_in, not here — so latent is counted exactly once.
      generatorVaporOutflow += m;
    }

    // Add to downstream CV
    if (topo.to === 'chamber' || topo.to === 'jacket') {
      acc[topo.to].air_in += air_share;
      acc[topo.to].vap_in += vap_share;
      acc[topo.to].inflow_T_weighted += m * up.T;
      acc[topo.to].inflow_T_mass += m;
    }
    // Flow to atmosphere/vacuum leaves the system (already subtracted from source)
  }

  // Load step: chamber gas ↔ load thermal exchange
  // Densidade do gás da câmara p/ escalar convecção (∝ ρ)
  const rho_gas_chamber = (state.chamber.m_air + state.chamber.m_vap) / params.chamber.V;
  const pc_chamber = chamber_pressure(state.chamber, params.chamber);
  const p_vap_chamber = pc_chamber.p_vap;
  const loadResult = load_step(
    state.load,
    params.load,
    {
      T_gas: state.chamber.T,
      rho_gas: rho_gas_chamber,
      rho_gas_atm: RHO_GAS_ATM_REF,
      // A carga irradia com a parede interna da câmara (que a camisa aquece via h_jc), não com o
      // gás da camisa: sem parede modelada, cai no gás da camisa (back-compat).
      T_wall: state.chamber.T_wall ?? state.jacket.T,
      p_sat_at: p_sat_water,
      p_vap_chamber,
      chamber_has_vapor: state.chamber.m_vap > 0,
      chamber_vapor_kg: state.chamber.m_vap,
      y_vap: pc_chamber.p_total > 0 ? p_vap_chamber / pc_chamber.p_total : 0,
    },
    dt,
  );
  const Q_load = loadResult.Q_conv_from_gas; // convectivo retirado do gás
  const Q_rad_load = loadResult.Q_rad_from_wall; // radiação retirada da parede da câmara
  const hasWall = (params.chamber.wall_mass_kg ?? 0) > 0;

  // Conservação de água carga↔câmara: >0 evaporou p/ câmara (entra), <0 condensou (sai).
  // vaporToChamber_kg é uma MASSA (já ·dt); os acumuladores são TAXAS (kg/s), pois
  // chamber_step volta a multiplicar por dt. Converter na fronteira dividindo por dt.
  const loadVapRate = loadResult.vaporToChamber_kg / dt; // kg → kg/s nesta fronteira
  if (loadVapRate > 0) {
    acc.chamber.vap_in += loadVapRate;
    acc.chamber.inflow_T_weighted += loadVapRate * state.chamber.T;
    acc.chamber.inflow_T_mass += loadVapRate;
  } else if (loadVapRate < 0) {
    acc.chamber.vap_out += -loadVapRate;
  }

  // Load condensation/flash is an IN-PLACE phase transfer at the load surface — it carries NO
  // flow work. But chamber_step routes this vapor through its advective H_in/H_out, which apply
  // the CP basis (flow work (CP_VAP−CV_VAP)·T). Compensate it back out so the chamber loses/gains
  // the load-transfer vapor on the STORAGE (CV) basis, matching the load's L_eff credit. This
  // closes the ~90 kJ (come-up) flow-work residual. Valve/exhaust outflow keeps the CP basis
  // (real flow work leaving the system) — it is NOT part of loadVapRate.
  // ponytail: uses T_ch; when valves co-inject vapor the same tick, chamber_step blends inflow_T
  //   so a tiny (CP−CV)·(inflow_T−T_ch)·rate residual remains. Second-order; revisit only if a
  //   simultaneous valve+flash scenario ever needs Joule-tight conservation.
  // ponytail: also assumes dt small enough that condensation doesn't saturate the vap_out cap
  //   (integrator m_vap/(GAMMA_VAP·dt), chamber.ts 0.5·avail_vap); if it did, Q_comp_load would
  //   over-cancel the un-transported remainder. Negligible while condensation ≪ chamber m_vap.
  const Q_comp_load = (CP_VAP - CV_VAP) * state.chamber.T * -loadVapRate;

  // Porta aberta: o gás da câmara relaxa p/ ar ambiente a 1 atm. Sai mistura (ar+vapor) com a
  // composição atual e entra ar a T_amb, ambos à taxa k = a/τ — passa pelos mesmos acumuladores
  // das válvulas, então massa e energia (entalpia de entrada/saída) seguem o modelo de nós.
  // ponytail: troca exponencial pura (sem empuxo/ΔP); com câmara pressurizada ela "despressuriza"
  //   na mesma τ em vez de num jato. Teto: k·dt ≪ 1 (dt 0,05 s, τ/a ≥ 10 s) e o líquido no
  //   fundo fica. Trocar por fluxo de porta (orifício + empuxo) se precisar da rajada de abertura.
  const door = params.door_open ?? 0;
  if (door > 0) {
    const k = door / (params.door_tau_gas_s ?? DOOR_TAU_GAS_DEFAULT);
    const T_amb = params.external.atmosphere_T;
    const air_in = (k * P_ATM * params.chamber.V) / (R_AIR * T_amb);
    acc.chamber.air_out += k * state.chamber.m_air;
    acc.chamber.vap_out += k * state.chamber.m_vap;
    out.door_air += k * state.chamber.m_air;
    out.door_vap += k * state.chamber.m_vap;
    doorAirIn = air_in;
    acc.chamber.air_in += air_in;
    acc.chamber.inflow_T_weighted += air_in * T_amb;
    acc.chamber.inflow_T_mass += air_in;
    // Fluxo em massa pela porta ∝ (p − P_atm): p > P_atm sai mistura na composição atual,
    // p < P_atm entra ar ambiente. Fração removida/admitida por passo ≤ dt/max(τ,dt) ≤ 1
    // (isotérmico) → nunca cruza P_atm, sem oscilação. Renovação lenta (τ_gas) segue acima.
    if (door > DOOR_PRESSURE_MIN_OPEN && pc_chamber.p_total > 0) {
      const tau_p = Math.max(params.door_tau_pressure_s ?? DOOR_TAU_PRESSURE_DEFAULT, dt);
      const dp = pc_chamber.p_total - P_ATM;
      if (dp > 0) {
        const f = dp / pc_chamber.p_total / tau_p; // 1/s
        acc.chamber.air_out += f * state.chamber.m_air;
        acc.chamber.vap_out += f * state.chamber.m_vap;
        out.door_air += f * state.chamber.m_air;
        out.door_vap += f * state.chamber.m_vap;
      } else {
        const bulk_in = (-dp * params.chamber.V) / (R_AIR * state.chamber.T) / tau_p;
        doorAirIn += bulk_in;
        acc.chamber.air_in += bulk_in;
        acc.chamber.inflow_T_weighted += bulk_in * T_amb;
        acc.chamber.inflow_T_mass += bulk_in;
      }
    }
  }

  // Cap outflow rates so U_new ≥ 0 after the energy balance in chamber_step.
  // The outflow carries enthalpy cp*T while stored energy is cv*T, so the stability
  // limit is: outflow_mass * dt ≤ stored_mass * (cv/cp) = stored_mass / gamma.
  // Using gamma_AIR = 1.4 for air-dominated flows (conservative bound; vapour gamma ≈ 1.30).
  // Runs after the load injection so the load's condensation outflow is included in the cap.
  for (const key of ['chamber', 'jacket'] as const) {
    const src = state[key] as ChamberState;
    const max_air_out = src.m_air / (GAMMA_AIR * dt);
    const max_vap_out = src.m_vap / (GAMMA_VAP * dt);
    if (acc[key].air_out > max_air_out) acc[key].air_out = max_air_out;
    if (acc[key].vap_out > max_vap_out) acc[key].vap_out = max_vap_out;
  }

  // Jacket↔chamber wall conduction coupling
  const h_jc = params.jacket_chamber_h_W_per_K ?? 0;
  // A condução camisa→câmara entra na PAREDE (Q_wall_external), então o potencial é
  // T_camisa − T_parede. Usar T do gás aqui superaquecia a parede em vácuo (gás frio e
  // desacoplado → fluxo enorme sem freio): parede a ~178 °C com camisa a ~135 °C, e o ar
  // admitido depois (fase 10) esquentava a 155–160 °C ao tocar essa parede.
  const T_chamber_wall = state.chamber.T_wall ?? state.chamber.T;
  const Q_jacket_to_chamber = h_jc > 0 ? h_jc * (state.jacket.T - T_chamber_wall) : 0;
  // Porta aberta: parede interna perde calor p/ o ambiente, proporcional à abertura.
  const Q_door_wall =
    door > 0
      ? door *
        (params.door_h_open_W_per_K ?? DOOR_H_OPEN_DEFAULT) *
        (T_chamber_wall - params.external.atmosphere_T)
      : 0;
  // Positive: heat flows from jacket to chamber (jacket hotter)

  // ponytail: ambient loss is a vessel-calibration knob (door/penetration losses); tuned to the band later.
  const Q_ambient_chamber =
    (params.chamber.h_ambient_W_per_K ?? 0) * (state.chamber.T - params.external.atmosphere_T);

  // ponytail: passive condensate-trap rate is a vessel-calibration knob; capped at available liquid.
  const chamberDrain_kg_s = Math.min(params.chamber.drain_kg_per_s ?? 0, state.chamber.m_liq / dt);

  // Chamber step (gas absorbs/gives heat to load; gains from jacket via wall)
  // Condensado que escorreu da carga (acima do que ela retém) entra como líquido na câmara.
  // chamber_step credita CP_LIQ·inflow_T (T misturado das entradas); corrigir p/ a energia real
  // do condensado (CP_WATER·T do nó), de modo que carga + câmara conservem energia.
  const liqFromLoad = loadResult.liqToChamber_kg / dt; // kg/s
  const chamberInflowT = inflowT(acc.chamber, state.chamber.T);
  const Q_liq_from_load = loadResult.liqToChamber_J / dt - liqFromLoad * CP_LIQ * chamberInflowT;
  const chamberFluxes: ChamberFluxes = {
    inflow: { ...speciesIn(acc.chamber), liq: liqFromLoad },
    inflow_T: chamberInflowT,
    outflow: { ...speciesOut(acc.chamber), liq: chamberDrain_kg_s },
    Q_external: -Q_load + Q_comp_load - Q_ambient_chamber + Q_liq_from_load, // loses heat to the load + flow-work compensation for load-transfer vapor + ambient loss
    // jacket conduction heats the WALL, not the gas; the wall also radiates to the load.
    // Sem parede (wall_C = 0) chamber_step descarta Q_wall_external → a radiação sai do gás da camisa.
    Q_wall_external: Q_jacket_to_chamber - Q_door_wall - (hasWall ? Q_rad_load : 0),
    wall_coupling_scale: rho_gas_chamber / RHO_GAS_ATM_REF,
  };
  const nextChamber = chamber_step(state.chamber, params.chamber, chamberFluxes, dt);
  // Condensado na parede/câmara = m_liq que apareceu por mudança de fase (descontado o líquido
  // que entrou da carga e o que saiu pelo dreno). dm_liq_out vem do próprio chamber_step —
  // já é o dreno efetivo (pós-teto de 50% do disponível); não duplicar o cálculo do teto aqui.
  const liqIn = liqFromLoad * dt;
  const liqOut = nextChamber.dm_liq_out ?? 0;
  const dPhase = nextChamber.m_liq - (state.chamber.m_liq + liqIn - liqOut);
  const cond_wall_kg = Math.max(0, dPhase);
  const evap_wall_kg = Math.max(0, -dPhase);
  // Rateio do saído real (pós-tetos) entre os caminhos, na proporção das taxas brutas.
  // acc.*_out inclui a condensação na carga (caminho interno, não exposto).
  const fAir = acc.chamber.air_out > 0 ? (nextChamber.dm_air_out ?? 0) / (acc.chamber.air_out * dt) : 0;
  const fVap = acc.chamber.vap_out > 0 ? (nextChamber.dm_vap_out ?? 0) / (acc.chamber.vap_out * dt) : 0;

  // Jacket step (loses heat to chamber via wall; sem parede modelada, radia direto p/ a carga)
  const jacketFluxes: ChamberFluxes = {
    inflow: speciesIn(acc.jacket),
    inflow_T: inflowT(acc.jacket, state.jacket.T),
    outflow: speciesOut(acc.jacket),
    Q_external: -Q_jacket_to_chamber - (hasWall ? 0 : Q_rad_load),
  };
  const nextJacket = chamber_step(state.jacket, params.jacket, jacketFluxes, dt);

  // Generator step (+ bomba de reposição V_GEN_WATER_IN: não é válvula da topologia de gás)
  let nextGenerator: GeneratorState | null = state.generator;
  if (state.generator && params.generator) {
    const feed = valves['V_GEN_WATER_IN']
      ? (params.generator_feed ?? { kg_per_s: GEN_FEED_DEFAULT_KG_S, T_K: params.external.atmosphere_T })
      : undefined;
    nextGenerator = generator_step(
      state.generator,
      { ...params.generator, T_amb_K: params.external.atmosphere_T },
      actuators.heater_gen,
      generatorVaporOutflow,
      dt,
      feed,
    );
  }

  // F0 accumulator — referência é o nó testemunho (witness)
  const witness = loadResult.next.nodes.find((n) => n.isWitness) ?? loadResult.next.nodes[0];
  const f0 = new F0Accumulator();
  f0.value_minutes = state.f0_minutes;
  if (witness) f0.step(witness.T, dt);

  return {
    chamber: nextChamber,
    jacket: nextJacket,
    generator: nextGenerator,
    load: loadResult.next,
    f0_minutes: f0.value_minutes,
    time_s: state.time_s + dt,
    valve_tripped,
    cond_load_kg: loadResult.cond_kg,
    evap_load_kg: loadResult.evap_kg,
    cond_wall_kg,
    evap_wall_kg,
    load_to_chamber_kg: liqIn,
    drain_kg: liqOut,
    flows: {
      steam_in_chamber_kg: steamInCh * dt,
      steam_in_jacket_kg: steamInJk * dt,
      steam_in_H_J: steamH * dt,
      exhaust_air_kg: out.exh_air * fAir * dt + (nextChamber.dm_relief_air ?? 0),
      exhaust_vap_kg: out.exh_vap * fVap * dt + (nextChamber.dm_relief_vap ?? 0),
      vacuum_air_kg: out.vac_air * fAir * dt,
      vacuum_vap_kg: out.vac_vap * fVap * dt,
      air_in_kg: airIn * dt,
      door_air_in_kg: doorAirIn * dt,
      door_air_out_kg: out.door_air * fAir * dt,
      door_vap_out_kg: out.door_vap * fVap * dt,
      jacket_cond_kg: nextJacket.dm_drop ?? 0,
    },
  };
}
