import type { ModbusBridge } from '../bridge/bridge.js';
import { RegisterAccess } from '../bridge/register-access.js';
import { CycleStateMachine, type CyclePhase, type PLCSensors } from './state-machine.js';
import type { CycleConfig } from './cycle-config.js';
import type { RegisterId } from '@sim/protocol/registers';

interface ValveSetpoints {
  V_STEAM_IN_INT?: boolean;
  V_STEAM_IN_JACKET?: boolean;
  V_AIR_IN?: boolean;
  V_VAC?: boolean;
  V_EXHAUST?: boolean;
  V_DRAIN_INT?: boolean;
  V_DRAIN_JACKET?: boolean;
  V_SEAL_CLEAN?: boolean;
  V_SEAL_STERILE?: boolean;
  V_GEN_WATER_IN?: boolean;
  PUMP_VAC?: boolean;
  HEATER_GEN?: boolean;
}

const ALL_VALVES: (keyof ValveSetpoints)[] = [
  'V_STEAM_IN_INT',
  'V_STEAM_IN_JACKET',
  'V_AIR_IN',
  'V_VAC',
  'V_EXHAUST',
  'V_DRAIN_INT',
  'V_DRAIN_JACKET',
  'V_SEAL_CLEAN',
  'V_SEAL_STERILE',
  'V_GEN_WATER_IN',
  'PUMP_VAC',
  'HEATER_GEN',
];

export class VirtualPLC {
  private readonly sm: CycleStateMachine;
  private readonly access: RegisterAccess;
  private lastTickTime_s = 0;

  constructor(cycle: CycleConfig, bridge: ModbusBridge) {
    this.sm = new CycleStateMachine(cycle);
    this.access = new RegisterAccess(bridge);
  }

  start(): void {
    this.sm.start();
  }
  getPhase(): CyclePhase {
    return this.sm.phase;
  }
  forcePhase(phase: CyclePhase, at_time_s: number): void {
    this.sm.forcePhase(phase, at_time_s);
  }
  getPhaseElapsed_s(): number {
    return this.lastTickTime_s - this.sm.phaseStartedAt;
  }

  async tick(time_s: number): Promise<void> {
    this.lastTickTime_s = time_s;
    const sensors = await this.readSensors();
    this.sm.update(time_s, sensors);
    const setpoints = this.commandsFor(this.sm.phase);
    await this.applyValves(setpoints);
  }

  private async readSensors(): Promise<PLCSensors> {
    return {
      P_chamber_bar: await this.access.getAnalog('P_CHAMBER_INT'),
      T_test_C: await this.access.getAnalog('T_TESTEMUNHO'),
      P_jacket_bar: await this.access.getAnalog('P_CHAMBER_EXT'),
      F0_min: (await this.access.getAnalog('F0_X10')) / 10,
    };
  }

  private commandsFor(phase: CyclePhase): ValveSetpoints {
    switch (phase) {
      case 'IDLE':
      case 'COMPLETE':
        return {};
      case 'PREHEAT':
        return { V_STEAM_IN_JACKET: true, HEATER_GEN: true };
      case 'PREVAC_VACUUM':
        return { V_STEAM_IN_JACKET: true, V_VAC: true, PUMP_VAC: true, HEATER_GEN: true };
      case 'PREVAC_STEAM':
        return { V_STEAM_IN_JACKET: true, V_STEAM_IN_INT: true, HEATER_GEN: true };
      case 'PRESSURIZE':
      case 'HOLD':
        return { V_STEAM_IN_JACKET: true, V_STEAM_IN_INT: true, HEATER_GEN: true };
      case 'EXHAUST':
        return { V_EXHAUST: true };
      case 'DRY':
        return { V_STEAM_IN_JACKET: true, V_VAC: true, PUMP_VAC: true, HEATER_GEN: true };
    }
  }

  private async applyValves(setpoints: ValveSetpoints): Promise<void> {
    for (const id of ALL_VALVES) {
      const desired = setpoints[id] ?? false;
      await this.access.setDiscrete(id as RegisterId, desired);
    }
  }
}
