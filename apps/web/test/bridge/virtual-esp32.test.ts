import { describe, it, expect } from 'vitest';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';

describe('VirtualEsp32Bridge', () => {
  it('starts disconnected; connect transitions to connected', async () => {
    const b = new VirtualEsp32Bridge();
    await expect(b.readCoils(0x1000, 1)).rejects.toThrow(/not connected/i);
    await b.connect();
    await expect(b.readCoils(0x1000, 1)).resolves.toHaveLength(1);
  });

  it('discrete inputs default to false', async () => {
    const b = new VirtualEsp32Bridge();
    await b.connect();
    const vals = await b.readDiscreteInputs(0x0000, 4);
    expect(vals).toEqual([false, false, false, false]);
  });

  it('writeDiscreteInputs round-trips through readDiscreteInputs', async () => {
    const b = new VirtualEsp32Bridge();
    await b.connect();
    await b.writeDiscreteInputs(0x0000, [true, false, true, true]);
    const vals = await b.readDiscreteInputs(0x0000, 4);
    expect(vals).toEqual([true, false, true, true]);
  });

  it('coils round-trip', async () => {
    const b = new VirtualEsp32Bridge();
    await b.connect();
    await b.writeCoils(0x1000, [true, true, false]);
    const vals = await b.readCoils(0x1000, 3);
    expect(vals).toEqual([true, true, false]);
  });

  it('holding registers round-trip int16 values', async () => {
    const b = new VirtualEsp32Bridge();
    await b.connect();
    await b.writeHoldingRegisters(0x3000, [2040, -100, 32767, -32768]);
    const vals = await b.readHoldingRegisters(0x3000, 4);
    expect(vals).toEqual([2040, -100, 32767, -32768]);
  });

  it('throws when reading outside any declared space', async () => {
    const b = new VirtualEsp32Bridge();
    await b.connect();
    await expect(b.readCoils(0x9999, 1)).rejects.toThrow(/unknown|out of range/i);
  });

  it('disconnect makes operations throw again', async () => {
    const b = new VirtualEsp32Bridge();
    await b.connect();
    await b.writeCoils(0x1000, [true]);
    await b.disconnect();
    await expect(b.readCoils(0x1000, 1)).rejects.toThrow(/not connected/i);
  });
});
