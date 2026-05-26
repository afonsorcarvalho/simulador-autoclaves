import type { ModbusBridge } from '../bridge/bridge.js';
import { readCommands } from './command-reader.js';
import { publishSensors } from './sensor-publisher.js';
import { system_step, type SystemState, type SystemParams } from '@sim/physics';

export interface OrchestratorOpts {
  bridge: ModbusBridge;
  params: SystemParams;
  initialState: SystemState;
  tickDt_s: number;
}

export class Orchestrator {
  private state: SystemState;
  private readonly bridge: ModbusBridge;
  private readonly params: SystemParams;
  private readonly dt: number;

  constructor(opts: OrchestratorOpts) {
    this.bridge = opts.bridge;
    this.params = opts.params;
    this.state = opts.initialState;
    this.dt = opts.tickDt_s;
  }

  async tick(): Promise<void> {
    const { valves, actuators } = await readCommands(this.bridge);
    this.state = system_step(this.state, this.params, valves, actuators, this.dt);
    await publishSensors(this.bridge, this.state, this.params);
  }

  getState(): SystemState {
    return this.state;
  }
}
