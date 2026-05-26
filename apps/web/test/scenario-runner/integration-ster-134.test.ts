import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { runScenario } from '../../server/scenario-runner/runner.js';
import { CycleConfigSchema } from '../../server/virtual-plc/cycle-config.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';
import type { SystemParams, SystemState } from '@sim/physics';
import { C_to_K, P_ATM, R_AIR, GAMMA_AIR, GAMMA_VAP, R_VAP, bar_to_Pa } from '@sim/physics';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function makeParams(): SystemParams {
  return {
    chamber: {
      V: 0.15,
      allowLiquid: true,
      wall_mass_kg: 50,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 200,
      relief_pressure_Pa: bar_to_Pa(3.04),
    },
    jacket: {
      V: 0.025,
      allowLiquid: false,
      wall_mass_kg: 15,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 100,
    },
    generator: { V_total: 0.05, heater_power_W: 36000, relief_pressure_Pa: bar_to_Pa(4.54) },
    load: {
      m_metal: 20,
      cp_metal: 500,
      m_fabric: 5,
      cp_fabric: 1500,
      h_gas_metal: 200,
      h_metal_fabric: 100,
    },
    valves: {
      V_STEAM_IN_INT: {
        from: 'generator',
        to: 'chamber',
        params: { Cv: 8e-6, gamma: GAMMA_VAP, R: R_VAP },
      },
      V_STEAM_IN_JACKET: {
        from: 'generator',
        to: 'jacket',
        params: { Cv: 1e-6, gamma: GAMMA_VAP, R: R_VAP },
        thermostat: {
          target: 'jacket',
          close_at_Pa: bar_to_Pa(3.54),
          reopen_at_Pa: bar_to_Pa(3.34),
        },
      },
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR } },
      V_EXHAUST: {
        from: 'chamber',
        to: 'atmosphere',
        params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR },
      },
      V_AIR_IN: {
        from: 'atmosphere',
        to: 'chamber',
        params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR },
      },
    },
    external: {
      steam_line_pressure: bar_to_Pa(5),
      steam_line_T: C_to_K(160),
      atmosphere_T: C_to_K(22),
    },
    jacket_chamber_h_W_per_K: 150,
  };
}

function preheatedInitial(p: SystemParams): SystemState {
  const T_amb = C_to_K(22);
  const T_hot = C_to_K(138);
  return {
    chamber: {
      m_air: (P_ATM * p.chamber.V) / (R_AIR * T_amb),
      m_vap: 0,
      m_liq: 0,
      T: T_amb,
      T_wall: T_hot,
    },
    jacket: { m_air: 0, m_vap: 0.047, m_liq: 0, T: T_hot, T_wall: T_hot },
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: { T_metal: T_amb, T_fabric: T_amb },
    f0_minutes: 0,
    time_s: 0,
  };
}

describe('Integration: 134°C pre-vacuum cycle via virtual PLC', () => {
  it('completes the cycle and reaches F0 ≥ 100', async () => {
    const yamlText = readFileSync(
      resolve(__dirname, '../../server/scenarios/ster-134-prevac.yaml'),
      'utf8',
    );
    const cycle = CycleConfigSchema.parse(yaml.load(yamlText));
    const params = makeParams();
    const initial = preheatedInitial(params);

    const result = await runScenario({
      cycle,
      params,
      initialState: initial,
      bridge: new VirtualEsp32Bridge(),
      tickDt_s: 0.05,
      max_duration_s: 3600,
    });

    console.log('Phase history:', JSON.stringify(result.phase_history, null, 2));
    console.log(
      'F0:',
      result.f0_min,
      'min, elapsed:',
      result.elapsed_s,
      's, phase:',
      result.final_phase,
    );

    expect(result.completed).toBe(true);
    expect(result.final_phase).toBe('COMPLETE');
    expect(result.f0_min).toBeGreaterThanOrEqual(100);
    expect(result.phase_history.map((p) => p.phase)).toContain('HOLD');
  }, 180000);
});
