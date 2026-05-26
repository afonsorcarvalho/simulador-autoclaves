import type { ModbusBridge } from '../bridge/bridge.js';
import { RegisterAccess } from '../bridge/register-access.js';
import { REGISTERS, type RegisterId } from '@sim/protocol/registers';
import type { ValveCommands, ActuatorCommands } from '@sim/physics';

/** Read all discrete inputs and split into the shapes physics expects. */
export async function readCommands(
  bridge: ModbusBridge,
): Promise<{ valves: ValveCommands; actuators: ActuatorCommands }> {
  const access = new RegisterAccess(bridge);
  const valves: ValveCommands = {};
  let pump_vac = false;
  let heater_gen = false;

  for (const [idStr, reg] of Object.entries(REGISTERS)) {
    if (reg.space !== 'discrete_inputs') continue;
    const id = idStr as RegisterId;
    const value = await access.getDiscrete(id);

    if (id === 'PUMP_VAC') pump_vac = value;
    else if (id === 'HEATER_GEN') heater_gen = value;
    else if (id === 'COMPRESSOR') {
      // Not used by physics yet; reserve for future
    } else if (id.startsWith('V_')) {
      valves[id] = value;
    }
  }

  return { valves, actuators: { pump_vac, heater_gen } };
}
