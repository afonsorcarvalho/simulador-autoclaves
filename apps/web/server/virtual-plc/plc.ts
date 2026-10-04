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

/** Chamber steam-valve bang-bang (REFERENCE controller for self-test; the real external PLC
 *  replaces this over Modbus in SP5). Open below SP+0.1, close above SP+0.5, hold previous state
 *  in the hysteresis band. The plant lets the chamber fall below setpoint when the valve is shut
 *  (ambient loss + condensate drain), so this loop can regulate the chamber into the EN 285 band. */
export function chamberValveBangBang(
  T_chamber_C: number,
  SP_C: number,
  prevOpen: boolean,
  band_low_C = 0.1,
  band_high_C = 0.5,
): boolean {
  if (T_chamber_C < SP_C + band_low_C) return true;
  if (T_chamber_C > SP_C + band_high_C) return false;
  return prevOpen;
}

/** Supervisão do gerador (pressostato + nível), como num CLP real. A resistência NÃO fica ligada
 *  direto: desliga acima de GEN_P_OFF_BAR e religa abaixo de GEN_P_ON_BAR (abaixo do alívio de
 *  4,54 bar, para a válvula de segurança quase não atuar). A bomba repõe água do nível mínimo
 *  até o máximo. Sem isso a física honesta (alívio ventila massa) secava o boiler em ~10 min. */
export const GEN_P_OFF_BAR = 4.4;
export const GEN_P_ON_BAR = 4.1;

export class VirtualPLC {
  private readonly sm: CycleStateMachine;
  private readonly access: RegisterAccess;
  private lastTickTime_s = 0;
  private readonly setpoint_C: number;
  private chamberValveOpen = false;
  private heaterOn = true;
  private feedPumpOn = false;

  constructor(cycle: CycleConfig, bridge: ModbusBridge) {
    this.sm = new CycleStateMachine(cycle);
    this.access = new RegisterAccess(bridge);
    this.setpoint_C = cycle.sterilization_T_C;
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

  async tick(time_s: number, controller?: { band_low: number; band_high: number }): Promise<void> {
    this.lastTickTime_s = time_s;
    const sensors = await this.readSensors();
    this.sm.update(time_s, sensors);
    // Reference controller: chamber steam valve bang-bang on chamber temperature (real PLC replaces).
    this.chamberValveOpen = chamberValveBangBang(
      sensors.T_chamber_C,
      this.setpoint_C,
      this.chamberValveOpen,
      controller?.band_low,
      controller?.band_high,
    );
    const setpoints = this.commandsFor(this.sm.phase, this.chamberValveOpen);
    await this.superviseGenerator(setpoints);
    await this.applyValves(setpoints);
  }

  /** Pressostato (histerese) sobre o pedido de resistência da fase + bomba de reposição por nível. */
  private async superviseGenerator(sp: ValveSetpoints): Promise<void> {
    const P_gen = await this.access.getAnalog('P_GENERATOR');
    if (P_gen >= GEN_P_OFF_BAR) this.heaterOn = false;
    else if (P_gen <= GEN_P_ON_BAR) this.heaterOn = true;
    const lvlMin = await this.access.getCoil('LVL_GEN_MIN');
    const lvlMax = await this.access.getCoil('LVL_GEN_MAX');
    if (!lvlMin) this.feedPumpOn = true;
    else if (lvlMax) this.feedPumpOn = false;
    if (sp.HEATER_GEN) sp.HEATER_GEN = this.heaterOn;
    if (this.sm.phase !== 'IDLE') sp.V_GEN_WATER_IN = this.feedPumpOn;
  }

  private async readSensors(): Promise<PLCSensors> {
    return {
      P_chamber_bar: await this.access.getAnalog('P_CHAMBER_INT'),
      T_chamber_C: await this.access.getAnalog('T_CHAMBER_INT'),
      T_test_C: await this.access.getAnalog('T_TESTEMUNHO'),
      P_jacket_bar: await this.access.getAnalog('P_CHAMBER_EXT'),
      F0_min: await this.access.getAnalog('F0_X10'),
    };
  }

  private commandsFor(phase: CyclePhase, chamberValveOpen: boolean): ValveSetpoints {
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
        // Come-up: chamber steam full-open for fast heat-up of the load to setpoint.
        return { V_STEAM_IN_JACKET: true, V_STEAM_IN_INT: true, HEATER_GEN: true };
      case 'HOLD':
        // Sterilization plateau: chamber steam valve regulated by the bang-bang (reference
        // controller) to hold the EN 285 band. Real PLC replaces this over Modbus.
        return { V_STEAM_IN_JACKET: true, V_STEAM_IN_INT: chamberValveOpen, HEATER_GEN: true };
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
