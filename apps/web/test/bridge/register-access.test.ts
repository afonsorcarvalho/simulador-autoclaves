import { describe, it, expect, beforeEach } from 'vitest';
import { RegisterAccess } from '../../server/bridge/register-access.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';

describe('RegisterAccess', () => {
  let bridge: VirtualEsp32Bridge;
  let access: RegisterAccess;

  beforeEach(async () => {
    bridge = new VirtualEsp32Bridge();
    access = new RegisterAccess(bridge);
    await bridge.connect();
  });

  it('reads a discrete input by RegisterId', async () => {
    await bridge.writeDiscreteInputs(0x0000, [true]); // V_STEAM_IN_INT
    expect(await access.getDiscrete('V_STEAM_IN_INT')).toBe(true);
  });

  it('writes a coil by RegisterId', async () => {
    await access.setCoil('PS_STEAM_LINE', true);
    expect(await bridge.readCoils(0x1000, 1)).toEqual([true]);
  });

  it('scaled analog round-trip: P_CHAMBER_INT (scale=1000, bar abs)', async () => {
    await access.setAnalog('P_CHAMBER_INT', 3.04);  // 134°C sat pressure
    const raw = await bridge.readHoldingRegisters(0x3000, 1);
    expect(raw[0]).toBe(3040);  // 3.04 * 1000
    expect(await access.getAnalog('P_CHAMBER_INT')).toBeCloseTo(3.04, 3);
  });

  it('scaled analog round-trip: T_CHAMBER_INT (scale=100, celsius)', async () => {
    await access.setAnalog('T_CHAMBER_INT', 134.0);
    const raw = await bridge.readHoldingRegisters(0x3010, 1);
    expect(raw[0]).toBe(13400);
    expect(await access.getAnalog('T_CHAMBER_INT')).toBeCloseTo(134, 2);
  });

  it('clips analog values to int16 range', async () => {
    await access.setAnalog('P_CHAMBER_INT', 1000);  // way out of range
    const raw = await bridge.readHoldingRegisters(0x3000, 1);
    expect(raw[0]).toBeLessThanOrEqual(32767);
    expect(raw[0]).toBeGreaterThanOrEqual(-32768);
  });

  it('uint16 register without scale reads as raw value', async () => {
    await bridge.writeHoldingRegisters(0x4002, [250]); // WATCHDOG_MS
    expect(await access.getAnalog('WATCHDOG_MS')).toBe(250);
  });

  it('throws when accessing a register with wrong type', async () => {
    // P_CHAMBER_INT is a holding register, not a coil
    await expect(access.getCoil('P_CHAMBER_INT' as never)).rejects.toThrow(/space mismatch/i);
  });
});
