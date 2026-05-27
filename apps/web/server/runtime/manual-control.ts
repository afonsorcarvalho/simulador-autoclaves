import type { Runtime } from './singleton.js';
import { RegisterAccess } from '../bridge/register-access.js';
import { REGISTERS, type RegisterId } from '@sim/protocol/registers';

export async function setManualValve(
  runtime: Runtime,
  valveId: string,
  value: boolean,
): Promise<void> {
  if (runtime.cycle_running) {
    throw new Error('cannot toggle valve while cycle running');
  }
  if (!(valveId in REGISTERS) || REGISTERS[valveId as RegisterId].space !== 'discrete_inputs') {
    throw new Error(`unknown valve id "${valveId}"`);
  }
  const access = new RegisterAccess(runtime.bridge);
  await access.setDiscrete(valveId as RegisterId, value);
}
