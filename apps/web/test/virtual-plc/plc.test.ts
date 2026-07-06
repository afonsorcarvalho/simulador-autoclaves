import { describe, it, expect } from 'vitest';
import { VirtualPLC, chamberValveBangBang } from '../../server/virtual-plc/plc.js';
import type { CycleConfig } from '../../server/virtual-plc/cycle-config.js';
import { RegisterAccess } from '../../server/bridge/register-access.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';

describe('chamber steam valve bang-bang', () => {
  const SP = 134;
  it('opens below SP+0.1', () => {
    expect(chamberValveBangBang(133.9, SP, false)).toBe(true);
    expect(chamberValveBangBang(134.05, SP, false)).toBe(true);
  });
  it('closes above SP+0.5', () => {
    expect(chamberValveBangBang(134.6, SP, true)).toBe(false);
  });
  it('holds previous state in the hysteresis band [SP+0.1, SP+0.5]', () => {
    expect(chamberValveBangBang(134.3, SP, true)).toBe(true); // was open → stay open
    expect(chamberValveBangBang(134.3, SP, false)).toBe(false); // was closed → stay closed
  });
  it('uses custom band offsets when provided', () => {
    // band_low=1.0, band_high=2.0 → open below SP+1.0, close above SP+2.0
    expect(chamberValveBangBang(134.9, SP, false, 1.0, 2.0)).toBe(true);
    expect(chamberValveBangBang(136.1, SP, true, 1.0, 2.0)).toBe(false);
    expect(chamberValveBangBang(135.5, SP, true, 1.0, 2.0)).toBe(true); // in band, hold
  });
});

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

async function setup(): Promise<{
  bridge: VirtualEsp32Bridge;
  access: RegisterAccess;
  plc: VirtualPLC;
}> {
  const bridge = new VirtualEsp32Bridge();
  await bridge.connect();
  const access = new RegisterAccess(bridge);
  const plc = new VirtualPLC(makeCycle(), bridge);
  return { bridge, access, plc };
}

async function setSensors(
  access: RegisterAccess,
  s: { P_chamber: number; T_test: number; P_jacket: number; F0: number },
) {
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
    await setSensors(access, { P_chamber: 0.1, T_test: 22, P_jacket: 3.5, F0: 0 });
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

  it('reports phase elapsed time based on last tick', async () => {
    const { access, plc } = await setup();
    plc.start();
    await setSensors(access, { P_chamber: 1.0, T_test: 22, P_jacket: 1.0, F0: 0 });
    await plc.tick(45);
    expect(plc.getPhaseElapsed_s()).toBeCloseTo(45, 1);
  });
});
