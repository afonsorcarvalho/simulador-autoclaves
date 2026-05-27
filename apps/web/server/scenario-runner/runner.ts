import { Orchestrator } from '../orchestrator/orchestrator.js';
import { VirtualPLC } from '../virtual-plc/plc.js';
import type { CycleConfig } from '../virtual-plc/cycle-config.js';
import type { CyclePhase } from '../virtual-plc/state-machine.js';
import type { ModbusBridge } from '../bridge/bridge.js';
import type { SystemParams, SystemState } from '@sim/physics';
import { chamber_pressure, generator_pressure, K_to_C, Pa_to_bar } from '@sim/physics';

export interface ScenarioOpts {
  cycle: CycleConfig;
  params: SystemParams;
  initialState: SystemState;
  bridge: ModbusBridge;
  tickDt_s: number;
  max_duration_s: number;
  /** When set, captures a row of state + phase every `sample_period_s` seconds. */
  trace?: { sample_period_s: number };
}

export interface PhaseHistoryEntry {
  phase: CyclePhase;
  entered_at_s: number;
}

export interface TraceRow {
  t_s: number;
  P_chamber_bar: number;
  P_jacket_bar: number;
  P_gen_bar: number;
  T_chamber_C: number;
  T_test_C: number;
  T_jacket_C: number;
  T_gen_C: number;
  F0_min: number;
  m_air_chamber: number;
  m_vap_chamber: number;
  m_liq_chamber: number;
  phase: CyclePhase;
}

export interface ScenarioResult {
  completed: boolean;
  timed_out: boolean;
  final_phase: CyclePhase;
  elapsed_s: number;
  f0_min: number;
  phase_history: PhaseHistoryEntry[];
  final_state: SystemState;
  trace: TraceRow[];
}

function sampleRow(orch: Orchestrator, params: SystemParams, phase: CyclePhase): TraceRow {
  const s = orch.getState();
  const pc = chamber_pressure(s.chamber, params.chamber);
  const pj = chamber_pressure(s.jacket, params.jacket);
  const pg =
    s.generator && params.generator ? generator_pressure(s.generator, params.generator) : 0;
  return {
    t_s: s.time_s,
    P_chamber_bar: Pa_to_bar(pc.p_total),
    P_jacket_bar: Pa_to_bar(pj.p_total),
    P_gen_bar: Pa_to_bar(pg),
    T_chamber_C: K_to_C(s.chamber.T),
    T_test_C: K_to_C(s.load.T_fabric),
    T_jacket_C: K_to_C(s.jacket.T),
    T_gen_C: s.generator ? K_to_C(s.generator.T) : 0,
    F0_min: s.f0_minutes,
    m_air_chamber: s.chamber.m_air,
    m_vap_chamber: s.chamber.m_vap,
    m_liq_chamber: s.chamber.m_liq,
    phase,
  };
}

export async function runScenario(opts: ScenarioOpts): Promise<ScenarioResult> {
  await opts.bridge.connect();
  const orch = new Orchestrator({
    bridge: opts.bridge,
    params: opts.params,
    initialState: opts.initialState,
    tickDt_s: opts.tickDt_s,
  });
  const plc = new VirtualPLC(opts.cycle, opts.bridge);

  // Bootstrap sensors so the PLC sees a valid state on tick 0
  await orch.tick();

  plc.start();
  const phase_history: PhaseHistoryEntry[] = [{ phase: plc.getPhase(), entered_at_s: 0 }];
  const trace: TraceRow[] = [];
  const sample_period_s = opts.trace?.sample_period_s ?? Infinity;
  const sample_period_ticks =
    sample_period_s === Infinity
      ? Infinity
      : Math.max(1, Math.round(sample_period_s / opts.tickDt_s));

  const max_ticks = Math.ceil(opts.max_duration_s / opts.tickDt_s);
  let last_phase = plc.getPhase();

  for (let i = 0; i < max_ticks; i++) {
    const t = orch.getState().time_s;
    await plc.tick(t);
    await orch.tick();

    const phase = plc.getPhase();
    if (phase !== last_phase) {
      phase_history.push({ phase, entered_at_s: t });
      last_phase = phase;
    }
    if (sample_period_ticks !== Infinity && i % sample_period_ticks === 0) {
      trace.push(sampleRow(orch, opts.params, phase));
    }
    if (phase === 'COMPLETE') {
      trace.push(sampleRow(orch, opts.params, phase));
      return {
        completed: true,
        timed_out: false,
        final_phase: 'COMPLETE',
        elapsed_s: orch.getState().time_s,
        f0_min: orch.getState().f0_minutes,
        phase_history,
        final_state: orch.getState(),
        trace,
      };
    }
  }

  return {
    completed: false,
    timed_out: true,
    final_phase: plc.getPhase(),
    elapsed_s: orch.getState().time_s,
    f0_min: orch.getState().f0_minutes,
    phase_history,
    final_state: orch.getState(),
    trace,
  };
}
