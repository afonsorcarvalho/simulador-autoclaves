import { F0Accumulator } from './f0.js';
import {
  chamber_step, chamber_pressure,
  type ChamberState, type ChamberParams, type ChamberFluxes, type SpeciesFlow,
} from './chamber.js';
import {
  generator_step, generator_pressure,
  type GeneratorState, type GeneratorParams,
} from './generator.js';
import { load_step, type LoadState, type LoadParams } from './load.js';
import { choked_flow, type ValveParams } from './valve.js';
import { P_ATM } from './constants.js';

export type VCName = 'chamber' | 'jacket' | 'generator' | 'atmosphere' | 'steam_line' | 'vacuum';

export interface ValveTopology {
  from: VCName;
  to: VCName;
  params: ValveParams;
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
}

export interface SystemState {
  chamber: ChamberState;
  jacket: ChamberState;
  generator: GeneratorState | null;
  load: LoadState;
  f0_minutes: number;
  time_s: number;
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

function speciesIn(a: FlowAccum): SpeciesFlow { return { air: a.air_in, vap: a.vap_in, liq: 0 }; }
function speciesOut(a: FlowAccum): SpeciesFlow { return { air: a.air_out, vap: a.vap_out, liq: 0 }; }

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

  for (const [vId, topo] of Object.entries(params.valves)) {
    if (!valves[vId]) continue;
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
    let air_share = 0, vap_share = 0;
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
  const loadResult = load_step(state.load, params.load, state.chamber.T, dt);
  const Q_load = loadResult.Q_from_gas; // positive = removed from gas, goes to load

  // Chamber step (gas absorbs/gives heat to load)
  const chamberFluxes: ChamberFluxes = {
    inflow: speciesIn(acc.chamber),
    inflow_T: inflowT(acc.chamber, state.chamber.T),
    outflow: speciesOut(acc.chamber),
    Q_external: -Q_load, // negative: chamber loses heat to load
  };
  const nextChamber = chamber_step(state.chamber, params.chamber, chamberFluxes, dt);

  // Jacket step (no load coupling)
  const jacketFluxes: ChamberFluxes = {
    inflow: speciesIn(acc.jacket),
    inflow_T: inflowT(acc.jacket, state.jacket.T),
    outflow: speciesOut(acc.jacket),
    Q_external: 0,
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

  // F0 accumulator — uses T_fabric (witness sensor) from old load state
  const f0 = new F0Accumulator();
  f0.value_minutes = state.f0_minutes;
  f0.step(state.load.T_fabric, dt);

  return {
    chamber: nextChamber,
    jacket: nextJacket,
    generator: nextGenerator,
    load: loadResult.next,
    f0_minutes: f0.value_minutes,
    time_s: state.time_s + dt,
  };
}
