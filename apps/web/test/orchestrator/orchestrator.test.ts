import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../../server/orchestrator/orchestrator.js';
import { RegisterAccess } from '../../server/bridge/register-access.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';
import type { SystemState, SystemParams } from '@sim/physics';
import { C_to_K, P_ATM, R_AIR, GAMMA_AIR, GAMMA_VAP, R_VAP, bar_to_Pa } from '@sim/physics';

function basicParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 36000, relief_pressure_Pa: 454000 },
    load: {
      m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500,
      h_gas_metal: 200, h_metal_fabric: 100,
    },
    valves: {
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR } },
      V_STEAM_IN_INT: { from: 'generator', to: 'chamber', params: { Cv: 8e-6, gamma: GAMMA_VAP, R: R_VAP } },
    },
    external: { steam_line_pressure: bar_to_Pa(5), steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
  };
}

function basicState(p: SystemParams): SystemState {
  const T = C_to_K(22);
  return {
    chamber: { m_air: (P_ATM * p.chamber.V) / (R_AIR * T), m_vap: 0, m_liq: 0, T, T_wall: T },
    jacket: { m_air: (P_ATM * p.jacket.V) / (R_AIR * T), m_vap: 0, m_liq: 0, T, T_wall: T },
    generator: { m_water_liq: 10, m_water_vap: 0, T },
    load: { T_metal: T, T_fabric: T },
    f0_minutes: 0,
    time_s: 0,
  };
}

describe('Orchestrator', () => {
  it('advances physics one dt per tick', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const params = basicParams();
    const initial = basicState(params);
    const orch = new Orchestrator({ bridge, params, initialState: initial, tickDt_s: 0.05 });

    await orch.tick();
    expect(orch.getState().time_s).toBeCloseTo(0.05, 6);

    await orch.tick();
    expect(orch.getState().time_s).toBeCloseTo(0.1, 6);
  });

  it('reads PLC commands from DI and applies to physics', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    const params = basicParams();
    const initial = basicState(params);
    const orch = new Orchestrator({ bridge, params, initialState: initial, tickDt_s: 0.05 });

    // PLC commands V_VAC open + PUMP_VAC on
    await access.setDiscrete('V_VAC', true);
    await access.setDiscrete('PUMP_VAC', true);

    for (let i = 0; i < 600; i++) await orch.tick();  // 30 s sim
    const s = orch.getState();
    // Chamber air mass should drop significantly under vacuum
    expect(s.chamber.m_air).toBeLessThan(initial.chamber.m_air * 0.5);
  });

  it('publishes sensors to holding registers after each tick', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    const params = basicParams();
    const initial = basicState(params);
    const orch = new Orchestrator({ bridge, params, initialState: initial, tickDt_s: 0.05 });

    await orch.tick();
    const P_chamber = await access.getAnalog('P_CHAMBER_INT');
    expect(P_chamber).toBeCloseTo(1.013, 1);  // 1 atm
  });
});
