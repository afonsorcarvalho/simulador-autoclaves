import type { ModbusBridge } from './bridge.js';
import { REGISTERS, type RegisterId } from '@sim/protocol/registers';

const INT16_MIN = -32768;
const INT16_MAX = 32767;

export class RegisterAccess {
  constructor(private readonly bridge: ModbusBridge) {}

  private reg(id: RegisterId): (typeof REGISTERS)[RegisterId] {
    const r = REGISTERS[id];
    if (!r) throw new Error(`unknown register "${id}"`);
    return r;
  }

  async getDiscrete(id: RegisterId): Promise<boolean> {
    const r = this.reg(id);
    if (r.space !== 'discrete_inputs')
      throw new Error(`space mismatch: ${id} is ${r.space}, not discrete_inputs`);
    const [v] = await this.bridge.readDiscreteInputs(r.address, 1);
    return v ?? false;
  }

  async setDiscrete(id: RegisterId, value: boolean): Promise<void> {
    const r = this.reg(id);
    if (r.space !== 'discrete_inputs')
      throw new Error(`space mismatch: ${id} is ${r.space}, not discrete_inputs`);
    await this.bridge.writeDiscreteInputs(r.address, [value]);
  }

  async getCoil(id: RegisterId): Promise<boolean> {
    const r = this.reg(id);
    if (r.space !== 'coils') throw new Error(`space mismatch: ${id} is ${r.space}, not coils`);
    const [v] = await this.bridge.readCoils(r.address, 1);
    return v ?? false;
  }

  async setCoil(id: RegisterId, value: boolean): Promise<void> {
    const r = this.reg(id);
    if (r.space !== 'coils') throw new Error(`space mismatch: ${id} is ${r.space}, not coils`);
    await this.bridge.writeCoils(r.address, [value]);
  }

  async getAnalog(id: RegisterId): Promise<number> {
    const r = this.reg(id);
    if (r.space !== 'holding_registers' && r.space !== 'diagnostics') {
      throw new Error(`space mismatch: ${id} is ${r.space}, not holding/diagnostics`);
    }
    const [raw] = await this.bridge.readHoldingRegisters(r.address, 1);
    if (raw === undefined) return 0;
    return 'scale' in r && r.scale !== undefined ? raw / r.scale : raw;
  }

  async setAnalog(id: RegisterId, value: number): Promise<void> {
    const r = this.reg(id);
    if (r.space !== 'holding_registers' && r.space !== 'diagnostics') {
      throw new Error(`space mismatch: ${id} is ${r.space}, not holding/diagnostics`);
    }
    const raw =
      'scale' in r && r.scale !== undefined ? Math.round(value * r.scale) : Math.round(value);
    const clipped = Math.max(INT16_MIN, Math.min(INT16_MAX, raw));
    await this.bridge.writeHoldingRegisters(r.address, [clipped]);
  }
}
