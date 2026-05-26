import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { system_step, type SystemState, type SystemParams } from './integrator.js';
import { CsvTrace } from './csv-trace.js';
import { chamber_pressure } from './chamber.js';
import { generator_pressure } from './generator.js';
import {
  GAMMA_AIR,
  GAMMA_VAP,
  R_AIR,
  R_VAP,
  P_ATM,
  C_to_K,
  K_to_C,
  Pa_to_bar,
  bar_to_Pa,
} from './constants.js';

interface Scenario {
  name: string;
  dt_s: number;
  duration_max_s: number;
  equipment: {
    chamber_volume_l: number;
    jacket_volume_l: number;
    generator_water_l: number;
    heater_kw: number;
    /** Relief pressure for the generator safety valve (bar absolute). Default: 4 bar. */
    generator_relief_bar?: number;
    /** Passive pressure-relief setpoint for the jacket (bar absolute). Default: 3.54 bar
     *  (0.5 bar above 134 °C saturation at 3.04 bar). Set to 0 to disable. */
    jacket_relief_bar?: number;
    /** Wall thermal mass of the chamber (kg stainless). Default: 50 kg. */
    chamber_wall_mass_kg?: number;
    /** Wall thermal mass of the jacket (kg stainless). Default: 15 kg. */
    jacket_wall_mass_kg?: number;
    load: { metal_kg: number; fabric_kg: number };
  };
  steps: Array<{ t: number; valves: string[]; actuators: string[] }>;
}

function makeParams(eq: Scenario['equipment']): SystemParams {
  return {
    chamber: {
      V: eq.chamber_volume_l / 1000,
      allowLiquid: true,
      wall_mass_kg: eq.chamber_wall_mass_kg ?? 50, // typical 150 L stainless autoclave chamber
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 200,
    },
    jacket: {
      V: eq.jacket_volume_l / 1000,
      allowLiquid: false,
      wall_mass_kg: eq.jacket_wall_mass_kg ?? 15, // smaller jacket
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 100,
      relief_pressure_Pa: bar_to_Pa(eq.jacket_relief_bar ?? 3.54),
    },
    generator: {
      V_total: 0.05,
      heater_power_W: eq.heater_kw * 1000,
      relief_pressure_Pa: (eq.generator_relief_bar ?? 4) * 1e5,
    },
    load: {
      m_metal: eq.load.metal_kg,
      cp_metal: 500,
      m_fabric: eq.load.fabric_kg,
      cp_fabric: 1500,
      // 200 W/K: realistic steam condensation coupling for an autoclave load in open-loop.
      // (500 W/K is the flooding regime used in closed-loop test scenarios.)
      h_gas_metal: 200,
      // 100 W/K metal→fabric coupling: fabric wrapped around metal in a real pack.
      // (30 W/K is a loose-contact scenario used in tests to exaggerate thermal lag.)
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
        params: { Cv: 5e-6, gamma: GAMMA_VAP, R: R_VAP },
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
  };
}

function makeInitialState(p: SystemParams, eq: Scenario['equipment']): SystemState {
  const T = C_to_K(22);
  return {
    chamber: {
      m_air: (P_ATM * p.chamber.V) / (R_AIR * T),
      m_vap: 0,
      m_liq: 0,
      T,
      T_wall: T, // wall starts at ambient temperature
    },
    jacket: {
      m_air: (P_ATM * p.jacket.V) / (R_AIR * T),
      m_vap: 0,
      m_liq: 0,
      T,
      T_wall: T, // wall starts at ambient temperature
    },
    generator: { m_water_liq: eq.generator_water_l, m_water_vap: 0, T: C_to_K(22) },
    load: { T_metal: T, T_fabric: T },
    f0_minutes: 0,
    time_s: 0,
  };
}

export function run(scenarioPath: string, outCsv: string): void {
  const scn = yaml.load(readFileSync(scenarioPath, 'utf8')) as Scenario;
  const params = makeParams(scn.equipment);
  let state = makeInitialState(params, scn.equipment);

  const trace = new CsvTrace([
    't_s',
    'P_chamber_bar',
    'P_jacket_bar',
    'P_gen_bar',
    'T_chamber_C',
    'T_test_C',
    'T_jacket_C',
    'T_gen_C',
    'F0_min',
    'm_air_chamber',
    'm_vap_chamber',
    'm_liq_chamber',
  ]);

  const steps = [...scn.steps].sort((a, b) => a.t - b.t);
  let stepIdx = 0;
  let currentValves: Record<string, boolean> = {};
  let currentActuators = { heater_gen: false, pump_vac: false };

  const dt = scn.dt_s;
  const N = Math.ceil(scn.duration_max_s / dt);

  for (let i = 0; i < N; i++) {
    while (stepIdx < steps.length && steps[stepIdx]!.t <= state.time_s) {
      const step = steps[stepIdx]!;
      currentValves = Object.fromEntries(step.valves.map((v) => [v, true]));
      currentActuators = {
        heater_gen: step.actuators.includes('HEATER_GEN'),
        pump_vac: step.actuators.includes('PUMP_VAC'),
      };
      stepIdx++;
    }
    state = system_step(state, params, currentValves, currentActuators, dt);

    // Sample at 1 Hz
    if (i % Math.round(1 / dt) === 0) {
      const pc = chamber_pressure(state.chamber, params.chamber);
      const pj = chamber_pressure(state.jacket, params.jacket);
      const pg =
        state.generator && params.generator
          ? generator_pressure(state.generator, params.generator)
          : 0;
      trace.row({
        t_s: state.time_s,
        P_chamber_bar: Pa_to_bar(pc.p_total),
        P_jacket_bar: Pa_to_bar(pj.p_total),
        P_gen_bar: Pa_to_bar(pg),
        T_chamber_C: K_to_C(state.chamber.T),
        T_test_C: K_to_C(state.load.T_fabric),
        T_jacket_C: K_to_C(state.jacket.T),
        T_gen_C: state.generator ? K_to_C(state.generator.T) : 0,
        F0_min: state.f0_minutes,
        m_air_chamber: state.chamber.m_air,
        m_vap_chamber: state.chamber.m_vap,
        m_liq_chamber: state.chamber.m_liq,
      });
    }
  }

  mkdirSync(dirname(outCsv), { recursive: true });
  writeFileSync(outCsv, trace.serialize(), 'utf8');
  console.log(`[scenario] ${scn.name}: ${N} steps simulated`);
  console.log(`[scenario] final F0 = ${state.f0_minutes.toFixed(2)} min`);
  console.log(`[scenario] final T_test = ${K_to_C(state.load.T_fabric).toFixed(1)}°C`);
  console.log(`[scenario] trace written to ${outCsv}`);
}

const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === (process.argv[1] ? resolve(process.argv[1]) : '');
  } catch {
    return false;
  }
})();

if (isMain) {
  const scnArg = process.argv[2];
  const outArg = process.argv[3] ?? 'trace.csv';
  if (!scnArg) {
    console.error('usage: tsx src/cli.ts <scenario.yaml> [out.csv]');
    process.exit(1);
  }
  run(resolve(process.cwd(), scnArg), resolve(process.cwd(), outArg));
}
