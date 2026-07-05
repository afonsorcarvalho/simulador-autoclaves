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
} from './generator.js';
import { load_step, type LoadState, type LoadParams } from './load.js';
import { p_sat_water } from './saturation.js';
import { choked_flow, type ValveParams } from './valve.js';
import { P_ATM, GAMMA_AIR, GAMMA_VAP, RHO_GAS_ATM_REF } from './constants.js';

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
}

export interface SystemState {
  chamber: ChamberState;
  jacket: ChamberState;
  generator: GeneratorState | null;
  load: LoadState;
  f0_minutes: number;
  time_s: number;
  /** Per-valve thermostat tripped state. true = closed by thermostat (overrides manual command). */
  valve_tripped?: Record<string, boolean>;
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
    }
    if (topo.from === 'generator') {
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
  const p_vap_chamber = chamber_pressure(state.chamber, params.chamber).p_vap;
  const loadResult = load_step(
    state.load,
    params.load,
    {
      T_gas: state.chamber.T,
      rho_gas: rho_gas_chamber,
      rho_gas_atm: RHO_GAS_ATM_REF,
      T_jacket: state.jacket.T,
      p_sat_at: p_sat_water,
      p_vap_chamber,
      chamber_has_vapor: state.chamber.m_vap > 0,
      chamber_vapor_kg: state.chamber.m_vap,
    },
    dt,
  );
  const Q_load = loadResult.Q_conv_from_gas; // convectivo retirado do gás

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

  // Cap outflow rates so U_new ≥ 0 after the energy balance in chamber_step.
  // The outflow carries enthalpy cp*T while stored energy is cv*T, so the stability
  // limit is: outflow_mass * dt ≤ stored_mass * (cv/cp) = stored_mass / gamma.
  // Using gamma_AIR = 1.4 for air-dominated flows (conservative bound; vapour gamma ≈ 1.33).
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
  const Q_jacket_to_chamber = h_jc > 0 ? h_jc * (state.jacket.T - state.chamber.T) : 0;
  // Positive: heat flows from jacket to chamber (jacket hotter)

  // Chamber step (gas absorbs/gives heat to load; gains from jacket via wall)
  const chamberFluxes: ChamberFluxes = {
    inflow: speciesIn(acc.chamber),
    inflow_T: inflowT(acc.chamber, state.chamber.T),
    outflow: speciesOut(acc.chamber),
    Q_external: -Q_load, // loses heat to the load only
    Q_wall_external: Q_jacket_to_chamber, // jacket conduction heats the WALL, not the gas
    wall_coupling_scale: rho_gas_chamber / RHO_GAS_ATM_REF,
  };
  const nextChamber = chamber_step(state.chamber, params.chamber, chamberFluxes, dt);

  // Jacket step (loses heat to chamber via wall; radia p/ a carga)
  const jacketFluxes: ChamberFluxes = {
    inflow: speciesIn(acc.jacket),
    inflow_T: inflowT(acc.jacket, state.jacket.T),
    outflow: speciesOut(acc.jacket),
    Q_external: -Q_jacket_to_chamber - loadResult.Q_rad_from_jacket, // loses to chamber + radia p/ carga
  };
  const nextJacket = chamber_step(state.jacket, params.jacket, jacketFluxes, dt);

  // Generator step
  let nextGenerator: GeneratorState | null = state.generator;
  if (state.generator && params.generator) {
    nextGenerator = generator_step(
      state.generator,
      params.generator,
      actuators.heater_gen,
      generatorVaporOutflow,
      dt,
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
  };
}
