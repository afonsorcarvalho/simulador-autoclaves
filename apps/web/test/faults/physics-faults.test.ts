import { describe, it, expect } from 'vitest';
import { readCommands } from '../../server/orchestrator/command-reader.js';
import { Orchestrator } from '../../server/orchestrator/orchestrator.js';
import { RegisterAccess } from '../../server/bridge/register-access.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';
import { FaultEngine } from '../../server/faults/engine.js';
import type { SystemState, SystemParams } from '@sim/physics';
import { C_to_K, P_ATM, R_AIR, GAMMA_VAP, R_VAP, bar_to_Pa, buildLoadState } from '@sim/physics';

function basicParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 36000, relief_pressure_Pa: 454000 },
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
    valves: {
      V_STEAM_IN_INT: {
        from: 'generator',
        to: 'chamber',
        params: { Cv: 8e-6, gamma: GAMMA_VAP, R: R_VAP },
      },
    },
    external: {
      steam_line_pressure: bar_to_Pa(5),
      steam_line_T: C_to_K(160),
      atmosphere_T: C_to_K(22),
    },
  };
}

function basicState(p: SystemParams): SystemState {
  const T = C_to_K(22);
  return {
    chamber: { m_air: (P_ATM * p.chamber.V) / (R_AIR * T), m_vap: 0, m_liq: 0, T, T_wall: T },
    jacket: { m_air: (P_ATM * p.jacket.V) / (R_AIR * T), m_vap: 0, m_liq: 0, T, T_wall: T },
    generator: { m_water_liq: 10, m_water_vap: 0, T },
    load: buildLoadState(undefined, T),
    f0_minutes: 0,
    time_s: 0,
  };
}

describe('readCommands com FaultEngine', () => {
  it('valve.stuck fechada vence o comando aberto do CLP', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    await access.setDiscrete('V_STEAM_IN_INT', true);

    const faults = new FaultEngine();
    faults.set({ id: 's', tipo: 'valve.stuck', alvo: 'V_STEAM_IN_INT', valor: 0 });

    const { valves } = await readCommands(bridge, faults);
    expect(valves.V_STEAM_IN_INT).toBe(false);
  });

  it('sem faults, comando do CLP passa direto', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    await access.setDiscrete('V_STEAM_IN_INT', true);

    const { valves } = await readCommands(bridge);
    expect(valves.V_STEAM_IN_INT).toBe(true);
  });
});

describe('Orchestrator com falhas físicas', () => {
  it('válvula travada fechada: física não recebe o comando de abrir do CLP', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    const params = basicParams();
    const faults = new FaultEngine();
    const orch = new Orchestrator({
      bridge,
      params,
      initialState: basicState(params),
      tickDt_s: 0.05,
      faults,
    });

    await access.setDiscrete('V_STEAM_IN_INT', true); // CLP manda abrir
    faults.set({ id: 's', tipo: 'valve.stuck', alvo: 'V_STEAM_IN_INT', valor: 0 }); // travada fechada

    for (let i = 0; i < 200; i++) await orch.tick(); // 10 s sim
    // Vapor nunca entrou: a única via de vapor pra câmara é essa válvula
    expect(orch.getState().chamber.m_vap).toBe(0);
  });

  it('utility.off em steam_line zera a pressão de rede no tick (coil PS_STEAM_LINE cai), sem mutar params; clear reverte', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    const params = basicParams();
    const faults = new FaultEngine();
    const orch = new Orchestrator({
      bridge,
      params,
      initialState: basicState(params),
      tickDt_s: 0.05,
      faults,
    });

    await orch.tick();
    expect(await access.getCoil('PS_STEAM_LINE')).toBe(true);

    faults.set({ id: 'u', tipo: 'utility.off', alvo: 'steam_line' });
    await orch.tick();
    expect(await access.getCoil('PS_STEAM_LINE')).toBe(false);
    expect(params.external.steam_line_pressure).toBe(bar_to_Pa(5)); // params original intocado

    faults.clear('u');
    await orch.tick();
    expect(await access.getCoil('PS_STEAM_LINE')).toBe(true);
  });
});
