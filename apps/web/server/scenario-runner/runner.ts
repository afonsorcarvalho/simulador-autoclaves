import { Orchestrator } from '../orchestrator/orchestrator.js';
import { VirtualPLC } from '../virtual-plc/plc.js';
import type { CycleConfig } from '../virtual-plc/cycle-config.js';
import type { CyclePhase } from '../virtual-plc/state-machine.js';
import type { ModbusBridge } from '../bridge/bridge.js';
import type { SystemParams, SystemState } from '@sim/physics';

export interface ScenarioOpts {
  cycle: CycleConfig;
  params: SystemParams;
  initialState: SystemState;
  bridge: ModbusBridge;
  tickDt_s: number;
  max_duration_s: number;
}

export interface PhaseHistoryEntry {
  phase: CyclePhase;
  entered_at_s: number;
}

export interface ScenarioResult {
  completed: boolean;
  timed_out: boolean;
  final_phase: CyclePhase;
  elapsed_s: number;
  f0_min: number;
  phase_history: PhaseHistoryEntry[];
  final_state: SystemState;
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
    if (phase === 'COMPLETE') {
      return {
        completed: true,
        timed_out: false,
        final_phase: 'COMPLETE',
        elapsed_s: orch.getState().time_s,
        f0_min: orch.getState().f0_minutes,
        phase_history,
        final_state: orch.getState(),
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
  };
}
