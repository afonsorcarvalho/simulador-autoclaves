import { describe, it, expect } from 'vitest';
import { VirtualPLC } from '../../server/virtual-plc/plc.js';
import type { CycleConfig } from '../../server/virtual-plc/cycle-config.js';
import { RegisterAccess } from '../../server/bridge/register-access.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';

function makeCycle(): CycleConfig {
  return {
    name: 'test',
    sterilization_T_C: 134,
    sterilization_P_bar: 3.04,
    hold_duration_s: 420,
    prevac_pulses: 3,
    prevac_vacuum_target_bar: 0.15,
    prevac_steam_target_bar: 2.0,
    preheat_duration_s: 300,
    dry_duration_s: 500,
    f0_target_min: 100,
  };
}

async function setup(): Promise<{ bridge: VirtualEsp32Bridge; access: RegisterAccess; plc: VirtualPLC }> {
  const bridge = new VirtualEsp32Bridge();
  await bridge.connect();
  const access = new RegisterAccess(bridge);
  const plc = new VirtualPLC(makeCycle(), bridge);
  return { bridge, access, plc };
}

async function setSensors(access: RegisterAccess, s: { P_chamber: number; T_test: number; P_jacket: number; F0: number }) {
  await access.setAnalog('P_CHAMBER_INT', s.P_chamber);
  await access.setAnalog('T_TESTEMUNHO', s.T_test);
  await access.setAnalog('P_CHAMBER_EXT', s.P_jacket);
  await access.setAnalog('F0_X10', s.F0 * 10);
}

describe('VirtualPLC', () => {
  it('does nothing in IDLE: all valves off', async () => {
    const { access, plc } = await setup();
    await plc.tick(0);
    expect(await access.getDiscrete('V_VAC')).toBe(false);
    expect(await access.getDiscrete('V_STEAM_IN_INT')).toBe(false);
    expect(await access.getDiscrete('HEATER_GEN')).toBe(false);
  });

  it('PREHEAT: opens V_STEAM_IN_JACKET + HEATER_GEN', async () => {
    const { access, plc } = await setup();
    plc.start();
    await setSensors(access, { P_chamber: 1.0, T_test: 22, P_jacket: 1.0, F0: 0 });
    await plc.tick(10);
    expect(await access.getDiscrete('V_STEAM_IN_JACKET')).toBe(true);
    expect(await access.getDiscrete('HEATER_GEN')).toBe(true);
    expect(await access.getDiscrete('V_STEAM_IN_INT')).toBe(false);
    expect(await access.getDiscrete('V_VAC')).toBe(false);
  });

  it('PREVAC_VACUUM: opens V_VAC + PUMP_VAC, keeps V_STEAM_IN_JACKET', async () => {
    const { access, plc } = await setup();
    plc.start();
    await setSensors(access, { P_chamber: 1.0, T_test: 22, P_jacket: 3.5, F0: 0 });
    await plc.tick(301);
    expect(await access.getDiscrete('V_VAC')).toBe(true);
    expect(await access.getDiscrete('PUMP_VAC')).toBe(true);
    expect(await access.getDiscrete('V_STEAM_IN_JACKET')).toBe(true);
  });

  it('PREVAC_STEAM: opens V_STEAM_IN_INT, closes V_VAC + PUMP_VAC', async () => {
    const { access, plc } = await setup();
    plc.start();
    await setSensors(access, { P_chamber: 1.0, T_test: 22, P_jacket: 3.5, F0: 0 });
    await plc.tick(301);
    await setSensors(access, { P_chamber: 0.10, T_test: 22, P_jacket: 3.5, F0: 0 });
    await plc.tick(330);
    expect(await access.getDiscrete('V_STEAM_IN_INT')).toBe(true);
    expect(await access.getDiscrete('V_VAC')).toBe(false);
    expect(await access.getDiscrete('PUMP_VAC')).toBe(false);
  });

  it('EXHAUST: opens V_EXHAUST, closes everything else', async () => {
    const { access, plc } = await setup();
    plc.start();
    plc.forcePhase('EXHAUST', 1100);
    await setSensors(access, { P_chamber: 3.0, T_test: 134, P_jacket: 3.5, F0: 100 });
    await plc.tick(1110);
    expect(await access.getDiscrete('V_EXHAUST')).toBe(true);
    expect(await access.getDiscrete('V_STEAM_IN_INT')).toBe(false);
    expect(await access.getDiscrete('HEATER_GEN')).toBe(false);
  });

  it('phase becomes COMPLETE after full cycle progression', async () => {
    const { access, plc } = await setup();
    plc.start();
    plc.forcePhase('DRY', 1200);
    await setSensors(access, { P_chamber: 0.1, T_test: 80, P_jacket: 3.5, F0: 150 });
    await plc.tick(1701);
    expect(plc.getPhase()).toBe('COMPLETE');
    expect(await access.getDiscrete('V_VAC')).toBe(false);
    expect(await access.getDiscrete('PUMP_VAC')).toBe(false);
  });
});
