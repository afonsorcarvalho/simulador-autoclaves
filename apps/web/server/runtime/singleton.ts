import { VirtualEsp32Bridge } from '../bridge/virtual-esp32.js';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { VirtualPLC } from '../virtual-plc/plc.js';
import type { CycleConfig } from '../virtual-plc/cycle-config.js';
import type { ModbusBridge } from '../bridge/bridge.js';
import { SnapshotPublisher, buildSnapshot } from './snapshot.js';
import type { SystemParams, SystemState } from '@sim/physics';
import { C_to_K, P_ATM, R_AIR, GAMMA_AIR, GAMMA_VAP, R_VAP, bar_to_Pa } from '@sim/physics';
import { readCommands } from '../orchestrator/command-reader.js';

const TICK_DT_S = 0.05;

function defaultParams(): SystemParams {
  return {
    chamber: {
      V: 0.15,
      allowLiquid: true,
      wall_mass_kg: 50,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 200,
      relief_pressure_Pa: bar_to_Pa(3.04),
    },
    jacket: {
      V: 0.025,
      allowLiquid: false,
      wall_mass_kg: 15,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 100,
    },
    generator: {
      V_total: 0.05,
      heater_power_W: 36000,
      relief_pressure_Pa: bar_to_Pa(4.54),
    },
    load: {
      m_metal: 20,
      cp_metal: 500,
      m_fabric: 5,
      cp_fabric: 1500,
      h_gas_metal: 200,
      h_metal_fabric: 100,
    },
    valves: {
      V_STEAM_IN_INT: {
        from: 'generator',
        to: 'chamber',
        params: { Cv: 8e-6, gamma: GAMMA_VAP, R: R_VAP },
      },
      V_STEAM_IN_JACKET: {
        from: 'generator',
        to: 'jacket',
        params: { Cv: 1e-6, gamma: GAMMA_VAP, R: R_VAP },
        thermostat: {
          target: 'jacket',
          close_at_Pa: bar_to_Pa(3.54),
          reopen_at_Pa: bar_to_Pa(3.34),
        },
      },
      V_VAC: {
        from: 'chamber',
        to: 'vacuum',
        params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR },
      },
      V_EXHAUST: {
        from: 'chamber',
        to: 'atmosphere',
        params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR },
      },
      V_AIR_IN: {
        from: 'atmosphere',
        to: 'chamber',
        params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR },
      },
    },
    external: {
      steam_line_pressure: bar_to_Pa(5),
      steam_line_T: C_to_K(160),
      atmosphere_T: C_to_K(22),
    },
    jacket_chamber_h_W_per_K: 150,
  };
}

function preheatedInitial(p: SystemParams): SystemState {
  const T_amb = C_to_K(22);
  const T_hot = C_to_K(138);
  return {
    chamber: {
      m_air: (P_ATM * p.chamber.V) / (R_AIR * T_amb),
      m_vap: 0,
      m_liq: 0,
      T: T_amb,
      T_wall: T_hot,
    },
    jacket: { m_air: 0, m_vap: 0.047, m_liq: 0, T: T_hot, T_wall: T_hot },
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: { T_metal: T_amb, T_fabric: T_amb },
    f0_minutes: 0,
    time_s: 0,
  };
}

export interface Runtime {
  bridge: ModbusBridge;
  orchestrator: Orchestrator;
  plc: VirtualPLC | null;
  publisher: SnapshotPublisher;
  cycle_running: boolean;
  cycle_started_at_s: number;
  params: SystemParams;
  startCycle(cycle: CycleConfig): void;
  stopCycle(): void;
  tick(): Promise<void>;
}

class RuntimeImpl implements Runtime {
  bridge: ModbusBridge;
  orchestrator: Orchestrator;
  plc: VirtualPLC | null = null;
  publisher = new SnapshotPublisher();
  cycle_running = false;
  cycle_started_at_s = 0;
  params: SystemParams;

  constructor() {
    this.bridge = new VirtualEsp32Bridge();
    this.params = defaultParams();
    const initial = preheatedInitial(this.params);
    this.orchestrator = new Orchestrator({
      bridge: this.bridge,
      params: this.params,
      initialState: initial,
      tickDt_s: TICK_DT_S,
    });
    void this.bridge.connect();
  }

  startCycle(cycle: CycleConfig): void {
    this.plc = new VirtualPLC(cycle, this.bridge);
    this.plc.start();
    this.cycle_running = true;
    this.cycle_started_at_s = this.orchestrator.getState().time_s;
  }

  stopCycle(): void {
    this.plc = null;
    this.cycle_running = false;
    void this.bridge.writeDiscreteInputs(0x0000, new Array(13).fill(false));
  }

  async tick(): Promise<void> {
    const t = this.orchestrator.getState().time_s;
    if (this.plc) {
      await this.plc.tick(t);
    }
    await this.orchestrator.tick();
    const { valves } = await readCommands(this.bridge);
    const snap = buildSnapshot({
      state: this.orchestrator.getState(),
      params: this.params,
      cycle_running: this.cycle_running,
      cycle_phase: this.plc ? this.plc.getPhase() : 'IDLE',
      cycle_elapsed_s: this.cycle_running
        ? this.orchestrator.getState().time_s - this.cycle_started_at_s
        : 0,
      valves: valves as Record<string, boolean>,
    });
    this.publisher.publish(snap);
  }
}

// Singleton via globalThis (survives Next.js HMR in dev)
declare global {
  // eslint-disable-next-line no-var
  var __SIM_RUNTIME__: Runtime | undefined;
}

export function getRuntime(): Runtime {
  if (!globalThis.__SIM_RUNTIME__) {
    globalThis.__SIM_RUNTIME__ = new RuntimeImpl();
  }
  return globalThis.__SIM_RUNTIME__;
}

export function resetRuntime(): void {
  globalThis.__SIM_RUNTIME__ = undefined;
}
