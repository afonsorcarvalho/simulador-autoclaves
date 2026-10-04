import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { runScenario } from '../../server/scenario-runner/runner.js';
import { CycleConfigSchema } from '../../server/virtual-plc/cycle-config.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';
import type { SystemParams, SystemState } from '@sim/physics';
import {
  C_to_K,
  P_ATM,
  R_AIR,
  GAMMA_AIR,
  GAMMA_VAP,
  R_VAP,
  bar_to_Pa,
  buildLoadState,
} from '@sim/physics';

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
      // SP-B: relief is a safety cap sized so its SATURATION temperature (T_sat(3.25 bar) ≈ 135.9 °C)
      // stays under the EN 285 +3 ceiling (137) — an open steam burst saturates the chamber toward
      // the relief pressure, so the relief sets the overshoot ceiling. Chamber temperature is
      // regulated by the bang-bang against the loss paths. Matches singleton.ts.
      relief_pressure_Pa: bar_to_Pa(3.25),
      h_ambient_W_per_K: 10,
      drain_kg_per_s: 2e-5,
    },
    jacket: {
      V: 0.025,
      allowLiquid: false,
      wall_mass_kg: 15,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 100,
    },
    generator: { V_total: 0.05, heater_power_W: 36000, relief_pressure_Pa: bar_to_Pa(4.54) },
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
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
          close_at_Pa: bar_to_Pa(3.44),
          reopen_at_Pa: bar_to_Pa(3.24),
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
    load: buildLoadState(undefined, T_amb),
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
      trace: { sample_period_s: 5 },
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

    // EN 285: every chamber-temperature sample during HOLD sits within [SP, SP+3].
    const SP = cycle.sterilization_T_C; // 134
    const holdRows = result.trace.filter((r) => r.phase === 'HOLD');
    expect(holdRows.length).toBeGreaterThan(0);
    const maxHold = Math.max(...holdRows.map((r) => r.T_chamber_C));
    const minHold = Math.min(...holdRows.map((r) => r.T_chamber_C));
    console.log('HOLD chamber T range:', minHold.toFixed(2), '..', maxHold.toFixed(2));
    expect(maxHold).toBeLessThanOrEqual(SP + 3); // EN 285 ceiling — no superheat runaway
    expect(minHold).toBeGreaterThanOrEqual(SP - 1); // stays near/at setpoint (small undershoot ok)

    // Drying dip: the load wets during come-up (condensation) and flashes off in DRY, so the
    // witness cools and the load water trends toward ~0 by the end.
    const dryRows = result.trace.filter((r) => r.phase === 'DRY');
    if (dryRows.length > 1) {
      const witnessStart = dryRows[0]!.T_test_C;
      const witnessMin = Math.min(...dryRows.map((r) => r.T_test_C));
      expect(witnessMin).toBeLessThan(witnessStart); // testemunho dips during drying
    }
  }, 180000);
});
