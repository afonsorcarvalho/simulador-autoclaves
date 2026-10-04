import type { ModbusBridge } from '../bridge/bridge.js';
import { readCommands } from './command-reader.js';
import { publishSensors } from './sensor-publisher.js';
import { DrainProbe } from '../sensors/drain-probe.js';
import type { FaultEngine } from '../faults/engine.js';
import { system_step, type SystemState, type SystemParams, type LoadState } from '@sim/physics';

export interface OrchestratorOpts {
  bridge: ModbusBridge;
  params: SystemParams;
  initialState: SystemState;
  tickDt_s: number;
  /** Falhas físicas (válvula travada, vapor de rede cortado etc.); sem engine = sem falhas. */
  faults?: FaultEngine;
}

export class Orchestrator {
  private state: SystemState;
  private readonly bridge: ModbusBridge;
  private readonly params: SystemParams;
  private readonly dt: number;
  private readonly faults: FaultEngine | undefined;
  /** Sonda do dreno (PT1), avançada com o tempo de simulação a cada tick. */
  readonly drain = new DrainProbe();

  constructor(opts: OrchestratorOpts) {
    this.bridge = opts.bridge;
    this.params = opts.params;
    this.state = opts.initialState;
    this.dt = opts.tickDt_s;
    this.faults = opts.faults;
  }

  async tick(): Promise<void> {
    const { valves, actuators } = await readCommands(this.bridge, this.faults);
    // utility.off em steam_line: vapor de rede cortado só nesse tick, sem mutar this.params.
    const params = this.faults?.has('utility.off', 'steam_line')
      ? { ...this.params, external: { ...this.params.external, steam_line_pressure: 0 } }
      : this.params;
    this.state = system_step(this.state, params, valves, actuators, this.dt);
    this.drain.step(this.state, params, this.dt);
    await publishSensors(this.bridge, this.state, params);
  }

  getState(): SystemState {
    return this.state;
  }

  /** Troca o estado inteiro da planta (máquina fria/pré-aquecida); a sonda do dreno recomeça no alvo. */
  setState(state: SystemState): void {
    this.state = state;
    this.drain.value_C = null;
  }

  /** Carga nova = ciclo novo: o F0 (integrado no testemunho da carga) recomeça do zero. */
  setLoadState(load: LoadState): void {
    this.state = { ...this.state, load, f0_minutes: 0 };
  }
}
