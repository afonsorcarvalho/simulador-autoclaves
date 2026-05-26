import { describe, it, expect } from 'vitest';
import { readCommands } from '../../server/orchestrator/command-reader.js';
import { RegisterAccess } from '../../server/bridge/register-access.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';

async function setup() {
  const bridge = new VirtualEsp32Bridge();
  await bridge.connect();
  return { bridge, access: new RegisterAccess(bridge) };
}

describe('readCommands', () => {
  it('maps Discrete Inputs to ValveCommands and ActuatorCommands', async () => {
    const { bridge, access } = await setup();
    await access.setDiscrete('V_VAC', true);
    await access.setDiscrete('V_STEAM_IN_INT', true);
    await access.setDiscrete('PUMP_VAC', true);
    await access.setDiscrete('HEATER_GEN', true);

    const { valves, actuators } = await readCommands(bridge);

    expect(valves.V_VAC).toBe(true);
    expect(valves.V_STEAM_IN_INT).toBe(true);
    expect(valves.V_STEAM_IN_JACKET).toBe(false);
    expect(actuators.pump_vac).toBe(true);
    expect(actuators.heater_gen).toBe(true);
  });

  it('all-off DI yields all false', async () => {
    const { bridge } = await setup();
    const { valves, actuators } = await readCommands(bridge);
    expect(Object.values(valves).every((v) => v === false)).toBe(true);
    expect(actuators.pump_vac).toBe(false);
    expect(actuators.heater_gen).toBe(false);
  });
});
