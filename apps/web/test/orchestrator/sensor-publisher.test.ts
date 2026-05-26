import { describe, it, expect } from 'vitest';
import { publishSensors } from '../../server/orchestrator/sensor-publisher.js';
import { RegisterAccess } from '../../server/bridge/register-access.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';
import type { SystemState, SystemParams } from '@sim/physics';
import { C_to_K } from '@sim/physics';

function makeState(): SystemState {
  const T = C_to_K(134);
  return {
    chamber: { m_air: 0, m_vap: 0.3, m_liq: 0.1, T, T_wall: T },
    jacket: { m_air: 0, m_vap: 0.05, m_liq: 0, T: C_to_K(138), T_wall: C_to_K(138) },
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: { T_metal: C_to_K(133), T_fabric: C_to_K(132) },
    f0_minutes: 100,
    time_s: 600,
  };
}

function makeParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 36000 },
    load: {
      m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500,
      h_gas_metal: 200, h_metal_fabric: 100,
    },
    valves: {},
    external: { steam_line_pressure: 500000, steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
  };
}

describe('publishSensors', () => {
  it('writes chamber/jacket/gen pressures + temperatures to holdings', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    const state = makeState();
    const params = makeParams();

    await publishSensors(bridge, state, params);

    const P_chamber = await access.getAnalog('P_CHAMBER_INT');
    const T_chamber = await access.getAnalog('T_CHAMBER_INT');
    const T_test = await access.getAnalog('T_TESTEMUNHO');
    expect(P_chamber).toBeGreaterThan(2.0);
    expect(P_chamber).toBeLessThan(4.0);
    expect(T_chamber).toBeCloseTo(134, 0);
    expect(T_test).toBeCloseTo(132, 0);
  });

  it('writes F0 (×10, uint16) to F0_X10 diagnostic register', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    const state = makeState();
    const params = makeParams();

    await publishSensors(bridge, state, params);

    const f0_raw = await access.getAnalog('F0_X10');
    expect(f0_raw).toBe(1000);  // 100 min × 10
  });

  it('publishes pressure switch coils based on threshold logic', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    const state = makeState();
    const params = makeParams();

    await publishSensors(bridge, state, params);

    expect(await access.getCoil('PS_STEAM_LINE')).toBe(true);
  });

  it('publishes door limit switches as closed (default healthy state)', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    await publishSensors(bridge, makeState(), makeParams());

    expect(await access.getCoil('LS_DOOR_CLEAN_CLOSED')).toBe(true);
    expect(await access.getCoil('LS_DOOR_STERILE_CLOSED')).toBe(true);
    expect(await access.getCoil('LS_DOOR_CLEAN_OPEN')).toBe(false);
    expect(await access.getCoil('LS_DOOR_STERILE_OPEN')).toBe(false);
  });

  it('publishes generator level switches based on water level', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    await publishSensors(bridge, makeState(), makeParams());

    expect(await access.getCoil('LVL_GEN_MIN')).toBe(true);
    expect(await access.getCoil('LVL_GEN_MAX')).toBe(false);
  });
});
