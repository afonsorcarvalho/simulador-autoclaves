import type { ModbusBridge } from './bridge.js';
import { SPACES } from '@sim/protocol/registers';

type SpaceName = keyof typeof SPACES;

/**
 * In-memory implementation of ModbusBridge. Backs each Modbus space with a typed
 * array sized to the space's range. Used in virtual mode (no ESP32 hardware) and
 * in tests. No network, fully synchronous beneath the Promise interface.
 */
export class VirtualEsp32Bridge implements ModbusBridge {
  private connected = false;
  private readonly discreteInputs: Uint8Array;
  private readonly coils: Uint8Array;
  private readonly holding: Int16Array;

  constructor() {
    this.discreteInputs = new Uint8Array(0x1000);
    this.coils = new Uint8Array(0x1000);
    // Holding registers space (0x3000-0x3FFF) + diagnostics (0x4000-0x4FFF):
    // 0x2000 contiguous, addressed by (addr - 0x3000).
    this.holding = new Int16Array(0x2000);
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  private requireConnected(): void {
    if (!this.connected) throw new Error('bridge not connected');
  }

  private offsetIn(space: SpaceName, addr: number, count: number): number {
    const def = SPACES[space];
    if (def === undefined) throw new Error(`unknown space "${space}"`);
    if (addr < def.base || addr + count - 1 > def.end) {
      throw new Error(`address 0x${addr.toString(16)} out of range for space "${space}"`);
    }
    return addr - def.base;
  }

  async readDiscreteInputs(addr: number, count: number): Promise<boolean[]> {
    this.requireConnected();
    const off = this.offsetIn('discrete_inputs', addr, count);
    return Array.from(this.discreteInputs.subarray(off, off + count), (b) => b !== 0);
  }

  async writeDiscreteInputs(addr: number, values: boolean[]): Promise<void> {
    this.requireConnected();
    const off = this.offsetIn('discrete_inputs', addr, values.length);
    values.forEach((v, i) => {
      this.discreteInputs[off + i] = v ? 1 : 0;
    });
  }

  async readCoils(addr: number, count: number): Promise<boolean[]> {
    this.requireConnected();
    const off = this.offsetIn('coils', addr, count);
    return Array.from(this.coils.subarray(off, off + count), (b) => b !== 0);
  }

  async writeCoils(addr: number, values: boolean[]): Promise<void> {
    this.requireConnected();
    const off = this.offsetIn('coils', addr, values.length);
    values.forEach((v, i) => {
      this.coils[off + i] = v ? 1 : 0;
    });
  }

  async readHoldingRegisters(addr: number, count: number): Promise<number[]> {
    this.requireConnected();
    // Combined range 0x3000-0x4FFF; offset relative to 0x3000.
    if (addr < 0x3000 || addr + count - 1 > 0x4fff) {
      throw new Error(`address 0x${addr.toString(16)} out of range for holding/diagnostics`);
    }
    const off = addr - 0x3000;
    return Array.from(this.holding.subarray(off, off + count));
  }

  async writeHoldingRegisters(addr: number, values: number[]): Promise<void> {
    this.requireConnected();
    if (addr < 0x3000 || addr + values.length - 1 > 0x4fff) {
      throw new Error(`address 0x${addr.toString(16)} out of range for holding/diagnostics`);
    }
    const off = addr - 0x3000;
    values.forEach((v, i) => {
      this.holding[off + i] = v;
    });
  }
}
