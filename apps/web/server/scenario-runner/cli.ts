import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { runScenario, type TraceRow } from './runner.js';
import { CycleConfigSchema } from '../virtual-plc/cycle-config.js';
import { VirtualEsp32Bridge } from '../bridge/virtual-esp32.js';
import type { SystemParams, SystemState } from '@sim/physics';
import { C_to_K, P_ATM, R_AIR, GAMMA_AIR, GAMMA_VAP, R_VAP, bar_to_Pa } from '@sim/physics';

function tracesToCsv(rows: TraceRow[]): string {
  if (rows.length === 0) return '';
  const cols = [
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
    'phase',
  ] as const;
  const fmt = (n: number): string => {
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  };
  const lines = [cols.join(',')];
  for (const r of rows) {
    lines.push(
      [
        fmt(r.t_s),
        fmt(r.P_chamber_bar),
        fmt(r.P_jacket_bar),
        fmt(r.P_gen_bar),
        fmt(r.T_chamber_C),
        fmt(r.T_test_C),
        fmt(r.T_jacket_C),
        fmt(r.T_gen_C),
        fmt(r.F0_min),
        fmt(r.m_air_chamber),
        fmt(r.m_vap_chamber),
        fmt(r.m_liq_chamber),
        r.phase,
      ].join(','),
    );
  }
  return lines.join('\n');
}

function defaultParams(): SystemParams {
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

export interface CliOpts {
  scenarioPath: string;
  outCsv?: string;
  sample_period_s?: number;
}

export async function main(opts: CliOpts): Promise<number> {
  const yamlText = readFileSync(opts.scenarioPath, 'utf8');
  const cycle = CycleConfigSchema.parse(yaml.load(yamlText));
  const params = defaultParams();
  const initial = preheatedInitial(params);

  const wantTrace = opts.outCsv !== undefined;
  console.log(`[scenario] Running ${cycle.name} (max 3600s sim time)...`);
  const start = Date.now();
  const result = await runScenario({
    cycle,
    params,
    initialState: initial,
    bridge: new VirtualEsp32Bridge(),
    tickDt_s: 0.05,
    max_duration_s: 3600,
    ...(wantTrace ? { trace: { sample_period_s: opts.sample_period_s ?? 1 } } : {}),
  });
  const wall = ((Date.now() - start) / 1000).toFixed(1);

  console.log(
    `[scenario] ${result.completed ? 'COMPLETED' : 'TIMED OUT'} in ${result.elapsed_s.toFixed(1)}s sim (${wall}s wall)`,
  );
  console.log(`[scenario] Final phase: ${result.final_phase}`);
  console.log(`[scenario] Final F0: ${result.f0_min.toFixed(2)} min`);
  console.log('[scenario] Phase history:');
  for (const p of result.phase_history) {
    console.log(`  t=${p.entered_at_s.toFixed(1).padStart(7)} s  → ${p.phase}`);
  }

  if (opts.outCsv && result.trace.length > 0) {
    const csv = tracesToCsv(result.trace);
    mkdirSync(dirname(opts.outCsv), { recursive: true });
    writeFileSync(opts.outCsv, csv, 'utf8');
    console.log(`[scenario] CSV trace (${result.trace.length} rows) → ${opts.outCsv}`);
  }

  return result.completed && result.f0_min >= cycle.f0_target_min ? 0 : 1;
}

const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === (process.argv[1] ? resolve(process.argv[1]) : '');
  } catch {
    return false;
  }
})();

if (isMain) {
  // Args: <scenario.yaml> [--out trace.csv] [--sample-period <seconds>]
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('usage: tsx server/scenario-runner/cli.ts <scenario.yaml> [--out trace.csv] [--sample-period 1.0]');
    process.exit(1);
  }
  const scenarioPath = resolve(process.cwd(), args[0]!);
  let outCsv: string | undefined;
  let sample_period_s: number | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) {
      outCsv = resolve(process.cwd(), args[++i]!);
    } else if (args[i] === '--sample-period' && args[i + 1]) {
      sample_period_s = Number.parseFloat(args[++i]!);
    }
  }
  main({ scenarioPath, ...(outCsv ? { outCsv } : {}), ...(sample_period_s !== undefined ? { sample_period_s } : {}) }).then((code) => process.exit(code));
}
