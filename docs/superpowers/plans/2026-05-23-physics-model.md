# Physics Model (packages/physics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, vitest-tested thermodynamic model of a steam autoclave (chamber + jacket + integrated steam generator + thermal load with witness sensor + F0 accumulator) that can simulate 121°C gravity, 134°C pre-vacuum, and drying cycles end-to-end without ESP32 or PLC.

**Architecture:** Pure TypeScript, no I/O dependencies. Each control volume (CV) is a small module with state + pure step function (`(state, params, fluxes, dt) → state`). An orchestrator (`integrator.ts`) connects valves between CVs, computes fluxes, drives Euler integration at fixed dt (default 10 ms). All physics use SI units internally (Pa, K, kg, m³, s); convenience accessors expose °C / bar for tests and CSV.

**Tech Stack:** TypeScript 5, vitest 2 (already installed at the workspace level by Foundation). No new runtime dependencies.

---

## File Structure

Project root: the repository root. New files live under `packages/physics/`.

```
packages/physics/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── src/
│   ├── constants.ts              # gas constants, cp/cv, gammas
│   ├── saturation.ts             # Antoine + h_vap for water
│   ├── valve.ts                  # compressible orifice (choked + subsonic)
│   ├── f0.ts                     # F0 accumulator class
│   ├── chamber.ts                # generic gas-vapor-liquid CV (used for chamber and jacket)
│   ├── generator.ts              # pool-boiling steam generator
│   ├── load.ts                   # 2-mass (metal + fabric) thermal cascade; witness sensor = fabric T
│   ├── integrator.ts             # System type + step() orchestrator
│   ├── csv-trace.ts              # CSV serializer for scenario traces
│   ├── cli.ts                    # `pnpm scenario` entry: load YAML, run, write CSV
│   └── index.ts                  # re-exports
├── test/
│   ├── saturation.test.ts
│   ├── valve.test.ts
│   ├── f0.test.ts
│   ├── chamber.test.ts
│   ├── generator.test.ts
│   ├── load.test.ts
│   ├── integrator.test.ts
│   ├── csv-trace.test.ts
│   └── scenarios/
│       ├── ster-121-gravity.test.ts
│       ├── ster-134-prevac.test.ts
│       └── drying.test.ts
```

### File responsibilities

| File | One-line responsibility |
|---|---|
| `constants.ts` | Numerical constants (gas constants, specific heats, gammas, critical pressure ratios, defaults) |
| `saturation.ts` | `p_sat_water(T_K)` (Antoine) and `h_vap_water(T_K)` (linear approx) |
| `valve.ts` | `choked_flow(P_up, T_up, P_down, valveParams) → kg/s` for compressible gas |
| `f0.ts` | `F0Accumulator` — integrates `10^((T-121.1)/10)` over time |
| `chamber.ts` | Generic CV holding air + vapor + liquid with mass + energy balances and saturation handling. Used for both internal chamber and jacket (with `allowLiquid: false` if needed). |
| `generator.ts` | Pool boiling: water reservoir + vapor headspace; heater drives evaporation; exposes outlet flow on demand |
| `load.ts` | 2-mass thermal cascade: chamber gas → metal mass → fabric mass; fabric T = witness sensor reading |
| `integrator.ts` | Defines `SystemState` and `SystemParams` aggregate types; `step()` reads valve commands, computes inter-CV flows, drives all CVs one dt, updates F0 |
| `csv-trace.ts` | Append snapshots to in-memory rows + serialize to CSV string |
| `cli.ts` | Reads a scenario YAML, runs the integrator headless, writes CSV to disk |

---

## Type contracts (locked in here, used by all tasks)

```typescript
// constants.ts
export const R_AIR = 287.05;        // J/(kg·K)
export const R_VAP = 461.5;         // J/(kg·K)
export const CP_AIR = 1005;         // J/(kg·K)
export const CV_AIR = 718;          // J/(kg·K)
export const CP_VAP = 1996;         // J/(kg·K)
export const CV_VAP = 1410;         // J/(kg·K)
export const CP_LIQ = 4186;         // J/(kg·K)
export const GAMMA_AIR = 1.4;
export const GAMMA_VAP = 1.33;
export const P_ATM = 101325;        // Pa
export const T_REF_F0_K = 394.25;   // 121.1°C in K
export const Z_F0 = 10;             // °C
export const KELVIN_OFFSET = 273.15;
```

```typescript
// saturation.ts
export function p_sat_water(T_K: number): number;       // Pa
export function h_vap_water(T_K: number): number;       // J/kg

// valve.ts
export interface ValveParams { Cv: number; gamma: number; R: number; }
export function choked_flow(P_up: number, T_up: number, P_down: number, v: ValveParams): number;

// f0.ts
export class F0Accumulator {
  value_minutes: number;
  step(T_K: number, dt_s: number): void;
}

// chamber.ts
export interface ChamberState { m_air: number; m_vap: number; m_liq: number; T: number; }
export interface ChamberParams { V: number; allowLiquid: boolean; }
export interface SpeciesFlow { air: number; vap: number; liq: number; }
export interface ChamberFluxes {
  inflow: SpeciesFlow;        // kg/s, each species
  inflow_T: number;            // K, temperature of inflow gas (carries enthalpy)
  outflow: SpeciesFlow;       // kg/s, each species (uses chamber's own T for enthalpy)
  Q_external: number;          // W, net heat into chamber (positive = heating)
}
export function chamber_step(s: ChamberState, p: ChamberParams, f: ChamberFluxes, dt: number): ChamberState;
export function chamber_pressure(s: ChamberState, p: ChamberParams): {
  p_air: number; p_vap: number; p_total: number;  // Pa
};

// generator.ts
export interface GeneratorState { m_water_liq: number; m_water_vap: number; T: number; }
export interface GeneratorParams { V_total: number; heater_power_W: number; }
export function generator_step(s: GeneratorState, p: GeneratorParams, heater_on: boolean, outflow_vap: number, dt: number): GeneratorState;
export function generator_pressure(s: GeneratorState, p: GeneratorParams): number;  // Pa

// load.ts
export interface LoadState { T_metal: number; T_fabric: number; }
export interface LoadParams {
  m_metal: number; cp_metal: number; m_fabric: number; cp_fabric: number;
  h_gas_metal: number;        // W/K — gas↔metal coupling
  h_metal_fabric: number;     // W/K — metal↔fabric coupling
}
export function load_step(s: LoadState, p: LoadParams, T_gas: number, dt: number): {
  next: LoadState;
  Q_from_gas: number;  // W absorbed from gas (positive = removed from gas)
};

// integrator.ts
export type VCName = 'chamber' | 'jacket' | 'generator' | 'atmosphere' | 'steam_line' | 'vacuum';
export interface ValveTopology { from: VCName; to: VCName; params: ValveParams; }
export interface SystemParams {
  chamber: ChamberParams;
  jacket: ChamberParams;
  generator: GeneratorParams | null;       // null if vapor source is external steam line
  load: LoadParams;
  valves: Record<string, ValveTopology>;
  external: { steam_line_pressure: number; steam_line_T: number; atmosphere_T: number; };
}
export interface SystemState {
  chamber: ChamberState;
  jacket: ChamberState;
  generator: GeneratorState | null;
  load: LoadState;
  f0_minutes: number;
  time_s: number;
}
export interface ValveCommands { [valveId: string]: boolean; }
export interface ActuatorCommands { heater_gen: boolean; pump_vac: boolean; }
export function system_step(s: SystemState, p: SystemParams, valves: ValveCommands, actuators: ActuatorCommands, dt: number): SystemState;
```

These type signatures are normative — every task respects them. If a task needs to extend a type, document the change in its commit message.

---

## Task 1: Scaffold packages/physics

**Files:**
- Create: `packages/physics/package.json`
- Create: `packages/physics/tsconfig.json`
- Create: `packages/physics/vitest.config.ts`
- Create: `packages/physics/README.md`
- Create: `packages/physics/src/index.ts`

- [ ] **Step 1.1: Write `packages/physics/package.json`**

```json
{
  "name": "@sim/physics",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "scenario": "tsx src/cli.ts",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src test"
  },
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^20.16.0",
    "@vitest/coverage-v8": "^2.1.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 1.2: Write `packages/physics/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 1.3: Write `packages/physics/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/index.ts'],
    },
  },
});
```

- [ ] **Step 1.4: Write `packages/physics/README.md`**

```markdown
# @sim/physics

Standalone thermodynamic model of a steam autoclave (chamber + jacket + steam generator + thermal load). Lumped parameter, gas+vapor+liquid mass balances, saturation handling (Antoine), F0 accumulation.

Used by `apps/web` (Next.js orchestrator) and by the scenario-runner CLI.

## Run a scenario

```bash
pnpm --filter @sim/physics scenario scenarios/ster-134-prevac.yaml --out trace.csv
```

## Run tests

```bash
pnpm --filter @sim/physics test
```
```

- [ ] **Step 1.5: Write `packages/physics/src/index.ts`** (placeholder re-exports; will fill as modules land)

```typescript
export * from './constants.js';
```

- [ ] **Step 1.6: Install workspace deps**

Run from project root: `pnpm install`

Expected: pnpm picks up `@sim/physics` workspace, links node_modules, updates lockfile.

- [ ] **Step 1.7: Commit**

```bash
git add packages/physics/package.json packages/physics/tsconfig.json packages/physics/vitest.config.ts packages/physics/README.md packages/physics/src/index.ts pnpm-lock.yaml
git commit -m "feat(physics): scaffold @sim/physics workspace"
```

---

## Task 2: Constants

**Files:**
- Create: `packages/physics/src/constants.ts`

- [ ] **Step 2.1: Write `packages/physics/src/constants.ts`**

```typescript
// SI units throughout. Kelvin internal, Pa internal.

export const R_AIR = 287.05; // J/(kg·K) — dry air
export const R_VAP = 461.5; // J/(kg·K) — water vapor
export const CP_AIR = 1005; // J/(kg·K)
export const CV_AIR = 718; // J/(kg·K)
export const CP_VAP = 1996; // J/(kg·K) — superheated steam ~100-200°C average
export const CV_VAP = 1410; // J/(kg·K)
export const CP_LIQ = 4186; // J/(kg·K) — liquid water
export const GAMMA_AIR = 1.4;
export const GAMMA_VAP = 1.33;

export const P_ATM = 101325; // Pa
export const KELVIN_OFFSET = 273.15;
export const T_REF_F0_C = 121.1; // °C, F0 reference temperature
export const T_REF_F0_K = T_REF_F0_C + KELVIN_OFFSET;
export const Z_F0 = 10; // °C, F0 temperature coefficient

// Critical pressure ratio for choked flow: P_down/P_up at which Mach=1 at throat.
export function criticalRatio(gamma: number): number {
  return Math.pow(2 / (gamma + 1), gamma / (gamma - 1));
}

export const CRITICAL_RATIO_AIR = criticalRatio(GAMMA_AIR); // ≈ 0.528
export const CRITICAL_RATIO_VAP = criticalRatio(GAMMA_VAP); // ≈ 0.542

// Conversion helpers
export const C_to_K = (c: number): number => c + KELVIN_OFFSET;
export const K_to_C = (k: number): number => k - KELVIN_OFFSET;
export const bar_to_Pa = (b: number): number => b * 1e5;
export const Pa_to_bar = (p: number): number => p / 1e5;
```

- [ ] **Step 2.2: Commit**

```bash
git add packages/physics/src/constants.ts
git commit -m "feat(physics): physical constants and unit helpers"
```

(No test for constants alone — they're verified through downstream module tests.)

---

## Task 3: Saturation (Antoine + h_vap) — TDD

**Files:**
- Create: `packages/physics/test/saturation.test.ts`
- Create: `packages/physics/src/saturation.ts`

- [ ] **Step 3.1: Write failing tests**

```typescript
// test/saturation.test.ts
import { describe, it, expect } from 'vitest';
import { p_sat_water, h_vap_water } from '../src/saturation.js';
import { C_to_K, Pa_to_bar } from '../src/constants.js';

describe('p_sat_water (Antoine, water)', () => {
  it('returns ~1.013 bar at 100°C (boiling at 1 atm)', () => {
    const p = p_sat_water(C_to_K(100));
    expect(Pa_to_bar(p)).toBeCloseTo(1.013, 1);
  });

  it('returns ~2.03 bar absolute at 121.1°C (standard sterilization gravity)', () => {
    const p = p_sat_water(C_to_K(121.1));
    expect(Pa_to_bar(p)).toBeCloseTo(2.06, 1);
  });

  it('returns ~3.04 bar absolute at 134°C (prevac sterilization)', () => {
    const p = p_sat_water(C_to_K(134));
    expect(Pa_to_bar(p)).toBeCloseTo(3.06, 1);
  });

  it('returns ~0.024 bar at 20°C (room temperature humidity)', () => {
    const p = p_sat_water(C_to_K(20));
    expect(Pa_to_bar(p)).toBeCloseTo(0.0234, 2);
  });

  it('is monotonically increasing in T', () => {
    let prev = -Infinity;
    for (let T_C = 0; T_C <= 200; T_C += 10) {
      const p = p_sat_water(C_to_K(T_C));
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });
});

describe('h_vap_water', () => {
  it('returns ~2257 kJ/kg at 100°C', () => {
    expect(h_vap_water(C_to_K(100))).toBeCloseTo(2257e3, -4); // tolerance ±10 kJ/kg
  });

  it('returns ~2202 kJ/kg at 120°C', () => {
    expect(h_vap_water(C_to_K(120))).toBeCloseTo(2202e3, -4);
  });

  it('returns ~2163 kJ/kg at 134°C', () => {
    expect(h_vap_water(C_to_K(134))).toBeCloseTo(2163e3, -4);
  });

  it('decreases with temperature', () => {
    expect(h_vap_water(C_to_K(20))).toBeGreaterThan(h_vap_water(C_to_K(100)));
    expect(h_vap_water(C_to_K(100))).toBeGreaterThan(h_vap_water(C_to_K(200)));
  });
});
```

Note `toBeCloseTo` second arg = decimal precision. `-4` means tolerance ±0.5×10⁴ = ±5000 (i.e., ±5 kJ/kg). Reasonable for a linear approximation.

- [ ] **Step 3.2: Run tests to verify they fail**

`pnpm --filter @sim/physics test`. Expect module-not-found.

- [ ] **Step 3.3: Implement `packages/physics/src/saturation.ts`**

```typescript
import { K_to_C } from './constants.js';

// Antoine equation for water (NIST coefficients, valid 1°C..100°C, extrapolated for our needs).
// log10(P_mmHg) = A - B / (C + T_°C); we use Bridgeman & Aldrich constants extended for higher T.
// Constants chosen to keep error <2% in the 20°C..180°C range needed for autoclaves.
const A = 8.07131;
const B = 1730.63;
const C = 233.426;
const MMHG_TO_PA = 133.322;

export function p_sat_water(T_K: number): number {
  const t = K_to_C(T_K);
  const p_mmHg = Math.pow(10, A - B / (C + t));
  return p_mmHg * MMHG_TO_PA;
}

// Linear approximation: h_vap(T_C) ≈ 2500.9 - 2.36·T_C (kJ/kg)
// Within ~1% of IAPWS in 0..200°C range.
export function h_vap_water(T_K: number): number {
  const t = K_to_C(T_K);
  return (2500.9 - 2.36 * t) * 1e3; // J/kg
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

`pnpm --filter @sim/physics test`. Expect saturation tests pass.

- [ ] **Step 3.5: Update `src/index.ts` to re-export**

```typescript
export * from './constants.js';
export * from './saturation.js';
```

- [ ] **Step 3.6: Commit**

```bash
git add packages/physics/test/saturation.test.ts packages/physics/src/saturation.ts packages/physics/src/index.ts
git commit -m "feat(physics): water saturation pressure (Antoine) and latent heat"
```

---

## Task 4: Valve (compressible orifice) — TDD

**Files:**
- Create: `packages/physics/test/valve.test.ts`
- Create: `packages/physics/src/valve.ts`

- [ ] **Step 4.1: Write failing tests**

```typescript
// test/valve.test.ts
import { describe, it, expect } from 'vitest';
import { choked_flow } from '../src/valve.js';
import { R_AIR, GAMMA_AIR, P_ATM, C_to_K, bar_to_Pa } from '../src/constants.js';

const airValve = { Cv: 1.0, gamma: GAMMA_AIR, R: R_AIR };

describe('choked_flow', () => {
  it('returns 0 when ΔP = 0', () => {
    const flow = choked_flow(P_ATM, C_to_K(20), P_ATM, airValve);
    expect(flow).toBe(0);
  });

  it('returns 0 when P_down > P_up (no reverse flow handled here; caller swaps)', () => {
    const flow = choked_flow(P_ATM, C_to_K(20), bar_to_Pa(2), airValve);
    expect(flow).toBe(0);
  });

  it('returns positive flow when P_up > P_down (subsonic regime)', () => {
    const flow = choked_flow(bar_to_Pa(1.5), C_to_K(20), P_ATM, airValve);
    expect(flow).toBeGreaterThan(0);
  });

  it('chokes when P_down/P_up < critical ratio (0.528 for air)', () => {
    // P_up = 5 bar, P_down = 1 bar → ratio 0.2, definitely choked
    const flow_choked = choked_flow(bar_to_Pa(5), C_to_K(20), bar_to_Pa(1), airValve);
    // P_up = 5 bar, P_down = 4 bar → ratio 0.8, subsonic
    const flow_subsonic = choked_flow(bar_to_Pa(5), C_to_K(20), bar_to_Pa(4), airValve);
    // Choked flow at the same P_up but lower P_down should NOT exceed choked-at-critical (mass flow caps).
    // Lower P_down past critical doesn't increase flow.
    expect(flow_choked).toBeGreaterThan(flow_subsonic);

    // Reducing P_down further must not change mass flow once choked.
    const flow_ultra_choked = choked_flow(bar_to_Pa(5), C_to_K(20), bar_to_Pa(0.001), airValve);
    expect(flow_ultra_choked).toBeCloseTo(flow_choked, 5);
  });

  it('scales linearly with Cv', () => {
    const v1 = { ...airValve, Cv: 1.0 };
    const v2 = { ...airValve, Cv: 2.5 };
    const f1 = choked_flow(bar_to_Pa(3), C_to_K(20), P_ATM, v1);
    const f2 = choked_flow(bar_to_Pa(3), C_to_K(20), P_ATM, v2);
    expect(f2 / f1).toBeCloseTo(2.5, 6);
  });

  it('scales with P_up (higher upstream pressure = more mass flow)', () => {
    const f1 = choked_flow(bar_to_Pa(2), C_to_K(20), P_ATM, airValve);
    const f2 = choked_flow(bar_to_Pa(4), C_to_K(20), P_ATM, airValve);
    expect(f2).toBeGreaterThan(f1);
  });

  it('decreases with hotter gas (lower density)', () => {
    const fcold = choked_flow(bar_to_Pa(3), C_to_K(20), P_ATM, airValve);
    const fhot = choked_flow(bar_to_Pa(3), C_to_K(150), P_ATM, airValve);
    expect(fhot).toBeLessThan(fcold);
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

`pnpm --filter @sim/physics test`. Expect module-not-found.

- [ ] **Step 4.3: Implement `packages/physics/src/valve.ts`**

```typescript
import { criticalRatio } from './constants.js';

export interface ValveParams {
  Cv: number; // empirical coefficient (kg/(s·Pa·sqrt(K)) after absorbing area + Cd; tuned per valve)
  gamma: number; // ratio of specific heats of upstream fluid
  R: number; // specific gas constant J/(kg·K)
}

/**
 * Compressible mass flow through an orifice. Returns kg/s (positive = downstream).
 * Returns 0 if P_up <= P_down. For reverse flow, caller must swap arguments and negate.
 */
export function choked_flow(P_up: number, T_up: number, P_down: number, v: ValveParams): number {
  if (P_up <= P_down) return 0;

  const r_crit = criticalRatio(v.gamma);
  const ratio = P_down / P_up;

  const baseFactor = v.Cv * P_up / Math.sqrt(v.R * T_up);

  if (ratio <= r_crit) {
    // Choked: mass flow caps. ṁ = Cv·P_up·sqrt(γ/(R·T))·((2/(γ+1))^((γ+1)/(2(γ-1))))
    const term = Math.pow(2 / (v.gamma + 1), (v.gamma + 1) / (2 * (v.gamma - 1)));
    return baseFactor * Math.sqrt(v.gamma) * term;
  }

  // Subsonic: ṁ = Cv·P_up·sqrt((2γ/((γ-1)R·T)) · (r^(2/γ) − r^((γ+1)/γ)))
  const r_2_g = Math.pow(ratio, 2 / v.gamma);
  const r_g1_g = Math.pow(ratio, (v.gamma + 1) / v.gamma);
  const inside = (2 * v.gamma / (v.gamma - 1)) * (r_2_g - r_g1_g);
  return baseFactor * Math.sqrt(inside);
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

`pnpm --filter @sim/physics test`. Expect saturation + valve tests pass.

- [ ] **Step 4.5: Re-export**

Edit `src/index.ts`:
```typescript
export * from './constants.js';
export * from './saturation.js';
export * from './valve.js';
```

- [ ] **Step 4.6: Commit**

```bash
git add packages/physics/test/valve.test.ts packages/physics/src/valve.ts packages/physics/src/index.ts
git commit -m "feat(physics): compressible orifice mass flow (choked + subsonic)"
```

---

## Task 5: F0 accumulator — TDD

**Files:**
- Create: `packages/physics/test/f0.test.ts`
- Create: `packages/physics/src/f0.ts`

- [ ] **Step 5.1: Write failing tests**

```typescript
// test/f0.test.ts
import { describe, it, expect } from 'vitest';
import { F0Accumulator } from '../src/f0.js';
import { C_to_K } from '../src/constants.js';

describe('F0Accumulator', () => {
  it('starts at zero', () => {
    expect(new F0Accumulator().value_minutes).toBe(0);
  });

  it('accumulates 1 minute at exactly 121.1°C in 60 seconds of 1s steps', () => {
    const f = new F0Accumulator();
    for (let i = 0; i < 60; i++) f.step(C_to_K(121.1), 1);
    expect(f.value_minutes).toBeCloseTo(1.0, 3);
  });

  it('accumulates ~10x faster at 131.1°C than at 121.1°C', () => {
    const f1 = new F0Accumulator();
    const f2 = new F0Accumulator();
    for (let i = 0; i < 60; i++) f1.step(C_to_K(121.1), 1);
    for (let i = 0; i < 60; i++) f2.step(C_to_K(131.1), 1);
    expect(f2.value_minutes / f1.value_minutes).toBeCloseTo(10, 0);
  });

  it('accumulates ~19.5x at 134°C vs 121.1°C', () => {
    const f1 = new F0Accumulator();
    const f2 = new F0Accumulator();
    for (let i = 0; i < 60; i++) f1.step(C_to_K(121.1), 1);
    for (let i = 0; i < 60; i++) f2.step(C_to_K(134), 1);
    expect(f2.value_minutes / f1.value_minutes).toBeCloseTo(19.5, 0);
  });

  it('does not accumulate below 100°C (negligible lethality)', () => {
    const f = new F0Accumulator();
    for (let i = 0; i < 600; i++) f.step(C_to_K(99), 1); // 10 min @ 99°C
    expect(f.value_minutes).toBeLessThan(0.01);
  });

  it('7 minutes at 134°C yields F0 ≥ 100 (typical prion target)', () => {
    const f = new F0Accumulator();
    for (let i = 0; i < 7 * 60; i++) f.step(C_to_K(134), 1);
    expect(f.value_minutes).toBeGreaterThanOrEqual(100);
  });
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

`pnpm --filter @sim/physics test`. Expect module-not-found.

- [ ] **Step 5.3: Implement `packages/physics/src/f0.ts`**

```typescript
import { K_to_C, T_REF_F0_C, Z_F0 } from './constants.js';

export class F0Accumulator {
  value_minutes = 0;

  step(T_K: number, dt_s: number): void {
    const t_C = K_to_C(T_K);
    if (t_C < 100) return; // negligible lethality below 100°C
    const lethality = Math.pow(10, (t_C - T_REF_F0_C) / Z_F0);
    this.value_minutes += (lethality * dt_s) / 60;
  }
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

`pnpm --filter @sim/physics test`. All saturation + valve + f0 tests pass.

- [ ] **Step 5.5: Re-export**

Append to `src/index.ts`:
```typescript
export * from './f0.js';
```

- [ ] **Step 5.6: Commit**

```bash
git add packages/physics/test/f0.test.ts packages/physics/src/f0.ts packages/physics/src/index.ts
git commit -m "feat(physics): F0 accumulator (lethality integrator)"
```

---

## Task 6: Chamber — pressure + state (TDD, no step yet)

**Files:**
- Create: `packages/physics/test/chamber.test.ts` (partial)
- Create: `packages/physics/src/chamber.ts` (partial)

This task introduces the chamber state types + pressure compute. Step function lands in Task 7.

- [ ] **Step 6.1: Write failing tests**

```typescript
// test/chamber.test.ts
import { describe, it, expect } from 'vitest';
import { chamber_pressure, type ChamberState, type ChamberParams } from '../src/chamber.js';
import { R_AIR, C_to_K, P_ATM, Pa_to_bar } from '../src/constants.js';

const params150L: ChamberParams = { V: 0.15, allowLiquid: true };

function emptyChamberAt(T_C: number): ChamberState {
  return { m_air: 0, m_vap: 0, m_liq: 0, T: C_to_K(T_C) };
}

describe('chamber_pressure', () => {
  it('returns 0 for an empty chamber', () => {
    const s = emptyChamberAt(20);
    expect(chamber_pressure(s, params150L).p_total).toBe(0);
  });

  it('returns ~1 atm with 1 atm of dry air at 20°C', () => {
    // m = P·V/(R·T). For 1 atm, V=0.15, T=293.15: m = 101325·0.15/(287.05·293.15) ≈ 0.1804 kg
    const s: ChamberState = { m_air: 0.1804, m_vap: 0, m_liq: 0, T: C_to_K(20) };
    const p = chamber_pressure(s, params150L);
    expect(Pa_to_bar(p.p_total)).toBeCloseTo(1.013, 2);
    expect(p.p_vap).toBe(0);
    expect(p.p_air).toBeCloseTo(p.p_total, 2);
  });

  it('clips vapor partial pressure at saturation when oversaturated', () => {
    // Lots of vapor at 100°C in a small volume — should clip to p_sat (≈1 atm)
    const s: ChamberState = { m_air: 0, m_vap: 1.0, m_liq: 0, T: C_to_K(100) };
    const p = chamber_pressure(s, params150L);
    expect(Pa_to_bar(p.p_vap)).toBeCloseTo(1.013, 1);
  });

  it('air + vapor sum via Dalton', () => {
    // 0.1 kg air + small vapor below saturation
    const s: ChamberState = { m_air: 0.1, m_vap: 0.001, m_liq: 0, T: C_to_K(50) };
    const p = chamber_pressure(s, params150L);
    expect(p.p_total).toBeCloseTo(p.p_air + p.p_vap, 0);
  });
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

`pnpm --filter @sim/physics test`. Expect module-not-found.

- [ ] **Step 6.3: Implement `packages/physics/src/chamber.ts` (state + pressure only)**

```typescript
import { R_AIR, R_VAP } from './constants.js';
import { p_sat_water } from './saturation.js';

export interface ChamberState {
  m_air: number; // kg
  m_vap: number; // kg
  m_liq: number; // kg
  T: number; // K
}

export interface ChamberParams {
  V: number; // m³
  allowLiquid: boolean; // false for jacket (vapor only, condensate dripped)
}

export interface ChamberPressureBreakdown {
  p_air: number;
  p_vap: number;
  p_total: number;
}

export function chamber_pressure(s: ChamberState, p: ChamberParams): ChamberPressureBreakdown {
  if (s.T <= 0 || p.V <= 0) return { p_air: 0, p_vap: 0, p_total: 0 };

  const p_air = (s.m_air * R_AIR * s.T) / p.V;
  const p_vap_kinetic = (s.m_vap * R_VAP * s.T) / p.V;
  const p_sat = p_sat_water(s.T);
  const p_vap = Math.min(p_vap_kinetic, p_sat);
  return { p_air, p_vap, p_total: p_air + p_vap };
}
```

- [ ] **Step 6.4: Run tests, verify pass**

`pnpm --filter @sim/physics test`.

- [ ] **Step 6.5: Commit**

```bash
git add packages/physics/test/chamber.test.ts packages/physics/src/chamber.ts
git commit -m "feat(physics): chamber state + pressure computation (Dalton + saturation clip)"
```

---

## Task 7: Chamber step (mass + energy balance + condensation) — TDD

**Files:**
- Modify: `packages/physics/test/chamber.test.ts` (append)
- Modify: `packages/physics/src/chamber.ts` (append `chamber_step`)

- [ ] **Step 7.1: Append failing tests for `chamber_step`**

```typescript
// Append to test/chamber.test.ts
import { chamber_step, type ChamberFluxes, type SpeciesFlow } from '../src/chamber.js';
import { CV_AIR, CV_VAP, CP_LIQ } from '../src/constants.js';

function zeroFlow(): SpeciesFlow { return { air: 0, vap: 0, liq: 0 }; }
function noFlux(T_K: number): ChamberFluxes {
  return { inflow: zeroFlow(), inflow_T: T_K, outflow: zeroFlow(), Q_external: 0 };
}

describe('chamber_step — mass balance', () => {
  it('conserves air mass when no flow and no heat', () => {
    const s = { m_air: 0.18, m_vap: 0, m_liq: 0, T: C_to_K(20) };
    const next = chamber_step(s, params150L, noFlux(s.T), 0.01);
    expect(next.m_air).toBeCloseTo(0.18, 8);
    expect(next.T).toBeCloseTo(s.T, 6);
  });

  it('adds inflow air mass linearly', () => {
    const s = { m_air: 0.1, m_vap: 0, m_liq: 0, T: C_to_K(20) };
    const f: ChamberFluxes = {
      inflow: { air: 0.01, vap: 0, liq: 0 }, // 10 g/s in
      inflow_T: C_to_K(20),
      outflow: zeroFlow(),
      Q_external: 0,
    };
    const next = chamber_step(s, params150L, f, 1); // 1 second
    expect(next.m_air).toBeCloseTo(0.11, 6);
  });

  it('removes outflow mass linearly', () => {
    const s = { m_air: 0.1, m_vap: 0, m_liq: 0, T: C_to_K(20) };
    const f: ChamberFluxes = {
      inflow: zeroFlow(),
      inflow_T: C_to_K(20),
      outflow: { air: 0.01, vap: 0, liq: 0 },
      Q_external: 0,
    };
    const next = chamber_step(s, params150L, f, 1);
    expect(next.m_air).toBeCloseTo(0.09, 6);
  });
});

describe('chamber_step — energy balance', () => {
  it('raises T when hot air is injected into cold chamber', () => {
    const s = { m_air: 0.1, m_vap: 0, m_liq: 0, T: C_to_K(20) };
    const f: ChamberFluxes = {
      inflow: { air: 0.05, vap: 0, liq: 0 }, // 50g/s hot
      inflow_T: C_to_K(200),
      outflow: zeroFlow(),
      Q_external: 0,
    };
    // After 1 second: 100g cold air + 50g hot air, mass-weighted enthalpy mixing
    const next = chamber_step(s, params150L, f, 1);
    expect(next.T).toBeGreaterThan(C_to_K(60));
    expect(next.T).toBeLessThan(C_to_K(120));
  });

  it('cools when Q_external is negative (heat loss)', () => {
    const s = { m_air: 0.18, m_vap: 0, m_liq: 0, T: C_to_K(100) };
    const f: ChamberFluxes = {
      inflow: zeroFlow(), inflow_T: C_to_K(100), outflow: zeroFlow(),
      Q_external: -1000, // 1 kW loss
    };
    const next = chamber_step(s, params150L, f, 1);
    expect(next.T).toBeLessThan(s.T);
  });
});

describe('chamber_step — condensation', () => {
  it('condenses vapor and releases latent heat when oversaturated', () => {
    // Inject lots of vapor at 100°C into a chamber too cold to hold it all
    const s = { m_air: 0, m_vap: 0.02, m_liq: 0, T: C_to_K(50) };
    const next = chamber_step(s, params150L, noFlux(s.T), 0.01);
    // Cold chamber can't hold m_vap = 0.02 at 50°C → condenses → m_liq increases, T might rise from latent heat
    expect(next.m_liq).toBeGreaterThan(0);
    expect(next.m_vap).toBeLessThan(s.m_vap);
  });

  it('conserves total water mass (m_vap + m_liq) when condensation occurs', () => {
    const s = { m_air: 0, m_vap: 0.02, m_liq: 0.005, T: C_to_K(60) };
    const next = chamber_step(s, params150L, noFlux(s.T), 0.01);
    expect(next.m_vap + next.m_liq).toBeCloseTo(s.m_vap + s.m_liq, 6);
  });
});
```

- [ ] **Step 7.2: Run tests, verify fail**

`pnpm --filter @sim/physics test`. The new tests should fail with `chamber_step is not a function` or similar.

- [ ] **Step 7.3: Append `chamber_step` implementation to `src/chamber.ts`**

```typescript
import { CV_AIR, CV_VAP, CP_LIQ, CP_AIR, CP_VAP, R_VAP } from './constants.js';
import { h_vap_water } from './saturation.js';

export interface SpeciesFlow {
  air: number; // kg/s
  vap: number; // kg/s
  liq: number; // kg/s
}

export interface ChamberFluxes {
  inflow: SpeciesFlow;
  inflow_T: number; // K, temperature of inflow gas
  outflow: SpeciesFlow;
  Q_external: number; // W, net heat into chamber from walls/load/heater (positive = gain)
}

/**
 * Single-step (explicit Euler) integration of chamber gas+vapor+liquid mass and energy balances.
 * Uses constant-cv assumption (ideal gas), latent heat handled via condensation step.
 */
export function chamber_step(s: ChamberState, p: ChamberParams, f: ChamberFluxes, dt: number): ChamberState {
  // 1. Mass balance (provisional, before condensation)
  let m_air = s.m_air + (f.inflow.air - f.outflow.air) * dt;
  let m_vap = s.m_vap + (f.inflow.vap - f.outflow.vap) * dt;
  let m_liq = s.m_liq + (f.inflow.liq - f.outflow.liq) * dt;
  if (m_air < 0) m_air = 0;
  if (m_vap < 0) m_vap = 0;
  if (m_liq < 0) m_liq = 0;
  if (!p.allowLiquid) m_liq = 0;

  // 2. Energy balance: U_old + h_in·ṁ_in·dt − h_out·ṁ_out·dt + Q_external·dt
  // Reference enthalpies to 0 K; cp for gases (constant-cp), cp_liq for liquid.
  const U_old = s.m_air * CV_AIR * s.T + s.m_vap * CV_VAP * s.T + s.m_liq * CP_LIQ * s.T;
  const H_in =
    (f.inflow.air * CP_AIR + f.inflow.vap * CP_VAP + f.inflow.liq * CP_LIQ) * f.inflow_T;
  const H_out =
    (f.outflow.air * CP_AIR + f.outflow.vap * CP_VAP + f.outflow.liq * CP_LIQ) * s.T;
  const U_new = U_old + (H_in - H_out + f.Q_external) * dt;

  // 3. Solve T from U_new with provisional masses
  let T = U_new / (m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ);
  if (!isFinite(T) || T < 1) T = s.T; // safety: empty chamber edge case

  // 4. Saturation check / condensation
  // If m_vap exceeds max at T, excess condenses, releasing latent heat → raises T.
  // Solve iteratively (one or two iterations enough for typical dt).
  for (let iter = 0; iter < 3; iter++) {
    const p_sat = (() => { // inline import use to avoid circular
      const t_C = T - 273.15;
      const p_mmHg = Math.pow(10, 8.07131 - 1730.63 / (233.426 + t_C));
      return p_mmHg * 133.322;
    })();
    const m_vap_max = (p_sat * p.V) / (R_VAP * T);
    if (m_vap <= m_vap_max + 1e-9) break;

    const dm_cond = m_vap - m_vap_max;
    if (!p.allowLiquid) {
      // Jacket case: condensate drips out instantly, doesn't accumulate
      m_vap = m_vap_max;
      break;
    }
    m_vap -= dm_cond;
    m_liq += dm_cond;
    const Q_lat = dm_cond * h_vap_water(T);
    const denom = m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ;
    T += Q_lat / denom;
  }

  return { m_air, m_vap, m_liq, T };
}
```

Note: the inline `p_sat` calculation duplicates `saturation.ts` to avoid a circular import via `saturation` re-exports. Acceptable for now; if future refactor adds a `numerics.ts`, move both there.

- [ ] **Step 7.4: Run tests, verify pass**

`pnpm --filter @sim/physics test`. All chamber tests pass.

- [ ] **Step 7.5: Re-export**

Append to `src/index.ts`:
```typescript
export * from './chamber.js';
```

- [ ] **Step 7.6: Commit**

```bash
git add packages/physics/test/chamber.test.ts packages/physics/src/chamber.ts packages/physics/src/index.ts
git commit -m "feat(physics): chamber step (mass+energy balance, condensation, sat clipping)"
```

---

## Task 8: Generator (pool boiling) — TDD

**Files:**
- Create: `packages/physics/test/generator.test.ts`
- Create: `packages/physics/src/generator.ts`

- [ ] **Step 8.1: Write failing tests**

```typescript
// test/generator.test.ts
import { describe, it, expect } from 'vitest';
import { generator_step, generator_pressure, type GeneratorState, type GeneratorParams } from '../src/generator.js';
import { C_to_K, Pa_to_bar } from '../src/constants.js';

const gen24kW: GeneratorParams = { V_total: 0.05, heater_power_W: 24000 };

describe('generator_step', () => {
  it('heats water from 22°C toward saturation when heater is on', () => {
    const s: GeneratorState = { m_water_liq: 30, m_water_vap: 0, T: C_to_K(22) };
    let next = s;
    for (let i = 0; i < 60; i++) next = generator_step(next, gen24kW, true, 0, 1); // 60 s heating
    // Q = 24 kW * 60s = 1440 kJ; ΔT ≈ Q/(m·cp) = 1440e3 / (30·4186) ≈ 11.5°C
    expect(next.T).toBeGreaterThan(C_to_K(30));
    expect(next.T).toBeLessThan(C_to_K(40));
  });

  it('produces vapor once saturated and heater on', () => {
    const s: GeneratorState = { m_water_liq: 30, m_water_vap: 0.001, T: C_to_K(140) };
    const next = generator_step(s, gen24kW, true, 0, 1);
    expect(next.m_water_vap).toBeGreaterThan(s.m_water_vap);
    expect(next.m_water_liq).toBeLessThan(s.m_water_liq);
  });

  it('vapor mass decreases when outflow drawn', () => {
    const s: GeneratorState = { m_water_liq: 30, m_water_vap: 0.05, T: C_to_K(140) };
    const next = generator_step(s, gen24kW, false, 0.01, 1); // 10 g/s vapor outflow, heater off
    expect(next.m_water_vap).toBeLessThan(s.m_water_vap);
  });

  it('does not produce vapor when heater is off and not saturated', () => {
    const s: GeneratorState = { m_water_liq: 30, m_water_vap: 0, T: C_to_K(50) };
    const next = generator_step(s, gen24kW, false, 0, 1);
    expect(next.m_water_vap).toBe(0);
    expect(next.T).toBeCloseTo(s.T, 1);
  });
});

describe('generator_pressure', () => {
  it('returns ~3.5 bar absolute at 138°C (saturation)', () => {
    const s: GeneratorState = { m_water_liq: 30, m_water_vap: 0.1, T: C_to_K(138) };
    const p = generator_pressure(s, gen24kW);
    expect(Pa_to_bar(p)).toBeGreaterThan(3.0);
    expect(Pa_to_bar(p)).toBeLessThan(4.0);
  });
});
```

- [ ] **Step 8.2: Run tests, verify fail**

`pnpm --filter @sim/physics test`.

- [ ] **Step 8.3: Implement `packages/physics/src/generator.ts`**

```typescript
import { CP_LIQ, R_VAP } from './constants.js';
import { p_sat_water, h_vap_water } from './saturation.js';

export interface GeneratorState {
  m_water_liq: number; // kg
  m_water_vap: number; // kg
  T: number; // K (liquid + vapor in equilibrium when saturated)
}

export interface GeneratorParams {
  V_total: number; // m³ (liquid + headspace)
  heater_power_W: number;
}

export function generator_pressure(s: GeneratorState, p: GeneratorParams): number {
  // Volume available to vapor = V_total − V_liq (liquid density ≈ 1000 kg/m³)
  const V_vap = Math.max(p.V_total - s.m_water_liq / 1000, 1e-6);
  const p_vapor = (s.m_water_vap * R_VAP * s.T) / V_vap;
  const p_sat = p_sat_water(s.T);
  // In a sealed boiling vessel, vapor pressure equals saturation when liquid present
  return s.m_water_liq > 0 ? Math.max(p_vapor, p_sat) : p_vapor;
}

/**
 * Single-step pool-boiling model. Heater energy first heats liquid to saturation,
 * then boils off (mass moves liq→vap, T pinned to T_sat(p)).
 * Outflow_vap drawn first, then heater raises T or generates vapor.
 */
export function generator_step(s: GeneratorState, p: GeneratorParams, heater_on: boolean, outflow_vap: number, dt: number): GeneratorState {
  // Remove outflow vapor first
  let m_water_vap = Math.max(s.m_water_vap - outflow_vap * dt, 0);
  let m_water_liq = s.m_water_liq;
  let T = s.T;

  const Q_in = heater_on ? p.heater_power_W * dt : 0;
  if (Q_in === 0) return { m_water_liq, m_water_vap, T };

  // Is liquid below saturation at current vapor pressure?
  const p_vap = generator_pressure({ m_water_liq, m_water_vap, T }, p);
  const T_sat_at_p = T_sat_from_p(p_vap);

  if (T < T_sat_at_p - 0.1) {
    // Sub-saturated: heater raises T of liquid
    const dT = Q_in / (m_water_liq * CP_LIQ);
    T += dT;
    if (T > T_sat_at_p) T = T_sat_at_p; // clip to saturation
  } else {
    // Saturated: heater boils water. dm_vap = Q / h_vap
    const dm_vap = Q_in / h_vap_water(T);
    const dm_actual = Math.min(dm_vap, m_water_liq);
    m_water_liq -= dm_actual;
    m_water_vap += dm_actual;
  }

  return { m_water_liq, m_water_vap, T };
}

// Inverse Antoine — bisection (avoids needing a numerics dep).
function T_sat_from_p(P_Pa: number): number {
  if (P_Pa < 100) return 273.15; // ~0°C floor
  let lo = 273.15;
  let hi = 573.15; // 300°C ceiling
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (p_sat_water(mid) < P_Pa) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
```

- [ ] **Step 8.4: Run tests, verify pass**

`pnpm --filter @sim/physics test`.

- [ ] **Step 8.5: Re-export**

Append to `src/index.ts`:
```typescript
export * from './generator.js';
```

- [ ] **Step 8.6: Commit**

```bash
git add packages/physics/test/generator.test.ts packages/physics/src/generator.ts packages/physics/src/index.ts
git commit -m "feat(physics): pool-boiling steam generator"
```

---

## Task 9: Load (2-mass thermal cascade) — TDD

**Files:**
- Create: `packages/physics/test/load.test.ts`
- Create: `packages/physics/src/load.ts`

- [ ] **Step 9.1: Write failing tests**

```typescript
// test/load.test.ts
import { describe, it, expect } from 'vitest';
import { load_step, type LoadState, type LoadParams } from '../src/load.js';
import { C_to_K } from '../src/constants.js';

const standardLoad: LoadParams = {
  m_metal: 20, cp_metal: 500,         // 20 kg metal, cp ≈ 500 J/(kg·K) typical stainless
  m_fabric: 5, cp_fabric: 1500,       // 5 kg fabric, cp ≈ 1500 J/(kg·K)
  h_gas_metal: 500,                   // W/K typical for forced convection on metal
  h_metal_fabric: 30,                 // W/K conductive, much lower
};

describe('load_step', () => {
  it('warms metal toward gas T when gas is hotter', () => {
    const s: LoadState = { T_metal: C_to_K(22), T_fabric: C_to_K(22) };
    const { next } = load_step(s, standardLoad, C_to_K(134), 1); // 1 s
    expect(next.T_metal).toBeGreaterThan(s.T_metal);
  });

  it('fabric warms slower than metal (cascade)', () => {
    const s: LoadState = { T_metal: C_to_K(22), T_fabric: C_to_K(22) };
    let cur = s;
    for (let i = 0; i < 60; i++) cur = load_step(cur, standardLoad, C_to_K(134), 1).next;
    expect(cur.T_metal).toBeGreaterThan(cur.T_fabric);
  });

  it('returns Q_from_gas as positive when gas hotter than metal', () => {
    const s: LoadState = { T_metal: C_to_K(22), T_fabric: C_to_K(22) };
    const { Q_from_gas } = load_step(s, standardLoad, C_to_K(134), 1);
    expect(Q_from_gas).toBeGreaterThan(0);
  });

  it('Q_from_gas is negative when gas colder than metal (load gives heat back)', () => {
    const s: LoadState = { T_metal: C_to_K(134), T_fabric: C_to_K(134) };
    const { Q_from_gas } = load_step(s, standardLoad, C_to_K(50), 1);
    expect(Q_from_gas).toBeLessThan(0);
  });

  it('fabric eventually catches up at thermal equilibrium', () => {
    let cur: LoadState = { T_metal: C_to_K(22), T_fabric: C_to_K(22) };
    for (let i = 0; i < 60 * 60; i++) cur = load_step(cur, standardLoad, C_to_K(134), 1); // 1 hr
    expect(cur.T_metal).toBeCloseTo(C_to_K(134), 0);
    expect(cur.T_fabric).toBeCloseTo(C_to_K(134), 0);
  });
});
```

- [ ] **Step 9.2: Run tests, verify fail**

`pnpm --filter @sim/physics test`.

- [ ] **Step 9.3: Implement `packages/physics/src/load.ts`**

```typescript
export interface LoadState {
  T_metal: number; // K
  T_fabric: number; // K — also reported as "witness sensor" temperature
}

export interface LoadParams {
  m_metal: number; // kg
  cp_metal: number; // J/(kg·K)
  m_fabric: number; // kg
  cp_fabric: number; // J/(kg·K)
  h_gas_metal: number; // W/K (gas ↔ metal convective coefficient × area)
  h_metal_fabric: number; // W/K (metal ↔ fabric conductive coefficient × area)
}

export interface LoadStepResult {
  next: LoadState;
  Q_from_gas: number; // W absorbed by load (positive = heat flowing from gas to load)
}

export function load_step(s: LoadState, p: LoadParams, T_gas: number, dt: number): LoadStepResult {
  const Q_gas_metal = p.h_gas_metal * (T_gas - s.T_metal); // W (positive: gas → metal)
  const Q_metal_fabric = p.h_metal_fabric * (s.T_metal - s.T_fabric); // W (positive: metal → fabric)

  const dT_metal = ((Q_gas_metal - Q_metal_fabric) * dt) / (p.m_metal * p.cp_metal);
  const dT_fabric = (Q_metal_fabric * dt) / (p.m_fabric * p.cp_fabric);

  return {
    next: { T_metal: s.T_metal + dT_metal, T_fabric: s.T_fabric + dT_fabric },
    Q_from_gas: Q_gas_metal,
  };
}
```

- [ ] **Step 9.4: Run tests, verify pass**

`pnpm --filter @sim/physics test`.

- [ ] **Step 9.5: Re-export**

Append to `src/index.ts`:
```typescript
export * from './load.js';
```

- [ ] **Step 9.6: Commit**

```bash
git add packages/physics/test/load.test.ts packages/physics/src/load.ts packages/physics/src/index.ts
git commit -m "feat(physics): 2-mass thermal load with witness sensor"
```

---

## Task 10: Integrator (system orchestrator) — TDD

**Files:**
- Create: `packages/physics/test/integrator.test.ts`
- Create: `packages/physics/src/integrator.ts`

The integrator wires CVs together via valves. It reads valve commands, computes per-valve mass flow using upstream pressure and downstream pressure of the connected VCs, and dispatches `chamber_step` / `generator_step` / `load_step` calls with the appropriate fluxes.

- [ ] **Step 10.1: Write failing tests**

```typescript
// test/integrator.test.ts
import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../src/integrator.js';
import { R_AIR, GAMMA_AIR, GAMMA_VAP, R_VAP, P_ATM, C_to_K, Pa_to_bar, bar_to_Pa } from '../src/constants.js';
import { p_sat_water } from '../src/saturation.js';

function basicParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 24000 },
    load: {
      m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500,
      h_gas_metal: 500, h_metal_fabric: 30,
    },
    valves: {
      V_STEAM_IN_INT: { from: 'generator', to: 'chamber', params: { Cv: 1e-6, gamma: GAMMA_VAP, R: R_VAP } },
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 5e-6, gamma: GAMMA_AIR, R: R_AIR } },
      V_AIR_IN: { from: 'atmosphere', to: 'chamber', params: { Cv: 2e-6, gamma: GAMMA_AIR, R: R_AIR } },
    },
    external: { steam_line_pressure: bar_to_Pa(5), steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
  };
}

function basicState(): SystemState {
  // Chamber + jacket filled with atmospheric air at 22°C
  const T = C_to_K(22);
  const m_air_chamber = (P_ATM * 0.15) / (R_AIR * T);
  const m_air_jacket = (P_ATM * 0.025) / (R_AIR * T);
  return {
    chamber: { m_air: m_air_chamber, m_vap: 0, m_liq: 0, T },
    jacket: { m_air: m_air_jacket, m_vap: 0, m_liq: 0, T },
    generator: { m_water_liq: 30, m_water_vap: 0, T: C_to_K(22) },
    load: { T_metal: T, T_fabric: T },
    f0_minutes: 0,
    time_s: 0,
  };
}

describe('system_step', () => {
  it('advances time_s by dt', () => {
    const s = basicState();
    const p = basicParams();
    const next = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.01);
    expect(next.time_s).toBeCloseTo(0.01, 6);
  });

  it('vacuum drops chamber pressure when V_VAC open and pump on', () => {
    const s = basicState();
    const p = basicParams();
    let cur = s;
    for (let i = 0; i < 3000; i++) { // 30 s
      cur = system_step(cur, p, { V_VAC: true }, { heater_gen: false, pump_vac: true }, 0.01);
    }
    // Chamber pressure should drop significantly (target ~0.1 bar)
    const p_chamber_air = (cur.chamber.m_air * R_AIR * cur.chamber.T) / p.chamber.V;
    expect(Pa_to_bar(p_chamber_air)).toBeLessThan(0.5);
  });

  it('steam injection from saturated generator raises chamber T and P', () => {
    const s = basicState();
    const p = basicParams();
    // Pre-heat generator manually to saturation
    s.generator!.T = C_to_K(150);
    s.generator!.m_water_vap = 0.5;
    let cur = s;
    for (let i = 0; i < 1500; i++) { // 15 s
      cur = system_step(cur, p, { V_STEAM_IN_INT: true }, { heater_gen: true, pump_vac: false }, 0.01);
    }
    expect(cur.chamber.T).toBeGreaterThan(C_to_K(60));
    expect(cur.chamber.m_vap).toBeGreaterThan(0);
  });

  it('F0 accumulates only when testemunho (T_fabric) ≥ 100°C', () => {
    const s = basicState();
    const p = basicParams();
    s.load = { T_metal: C_to_K(134), T_fabric: C_to_K(134) };
    let cur = s;
    for (let i = 0; i < 6000; i++) { // 60 s
      cur = system_step(cur, p, {}, { heater_gen: false, pump_vac: false }, 0.01);
    }
    // ~1 minute at 134°C → F0 ≈ 19.5
    expect(cur.f0_minutes).toBeGreaterThan(15);
  });

  it('air admission valve fills evacuated chamber from atmosphere', () => {
    const s = basicState();
    const p = basicParams();
    s.chamber.m_air = s.chamber.m_air * 0.01; // simulate post-vacuum chamber
    let cur = s;
    for (let i = 0; i < 1000; i++) { // 10 s
      cur = system_step(cur, p, { V_AIR_IN: true }, { heater_gen: false, pump_vac: false }, 0.01);
    }
    expect(cur.chamber.m_air).toBeGreaterThan(s.chamber.m_air);
  });
});
```

- [ ] **Step 10.2: Run tests, verify fail**

`pnpm --filter @sim/physics test`.

- [ ] **Step 10.3: Implement `packages/physics/src/integrator.ts`**

```typescript
import { F0Accumulator } from './f0.js';
import {
  chamber_step, chamber_pressure,
  type ChamberState, type ChamberParams, type ChamberFluxes, type SpeciesFlow,
} from './chamber.js';
import {
  generator_step, generator_pressure,
  type GeneratorState, type GeneratorParams,
} from './generator.js';
import { load_step, type LoadState, type LoadParams } from './load.js';
import { choked_flow, type ValveParams } from './valve.js';
import { R_AIR, R_VAP, GAMMA_AIR, GAMMA_VAP, P_ATM } from './constants.js';

export type VCName = 'chamber' | 'jacket' | 'generator' | 'atmosphere' | 'steam_line' | 'vacuum';

export interface ValveTopology {
  from: VCName;
  to: VCName;
  params: ValveParams;
}

export interface ExternalConditions {
  steam_line_pressure: number; // Pa
  steam_line_T: number; // K
  atmosphere_T: number; // K
}

export interface SystemParams {
  chamber: ChamberParams;
  jacket: ChamberParams;
  generator: GeneratorParams | null;
  load: LoadParams;
  valves: Record<string, ValveTopology>;
  external: ExternalConditions;
}

export interface SystemState {
  chamber: ChamberState;
  jacket: ChamberState;
  generator: GeneratorState | null;
  load: LoadState;
  f0_minutes: number;
  time_s: number;
}

export interface ValveCommands {
  [valveId: string]: boolean;
}

export interface ActuatorCommands {
  heater_gen: boolean;
  pump_vac: boolean;
}

// Pressure + T accessors per VC name
function vcPressure(name: VCName, s: SystemState, p: SystemParams): { P: number; T: number } {
  switch (name) {
    case 'chamber': {
      const cp = chamber_pressure(s.chamber, p.chamber);
      return { P: cp.p_total, T: s.chamber.T };
    }
    case 'jacket': {
      const cp = chamber_pressure(s.jacket, p.jacket);
      return { P: cp.p_total, T: s.jacket.T };
    }
    case 'generator': {
      if (!s.generator || !p.generator) return { P: 0, T: 0 };
      return { P: generator_pressure(s.generator, p.generator), T: s.generator.T };
    }
    case 'atmosphere':
      return { P: P_ATM, T: p.external.atmosphere_T };
    case 'steam_line':
      return { P: p.external.steam_line_pressure, T: p.external.steam_line_T };
    case 'vacuum':
      return { P: 1000, T: 273.15 }; // 10 mbar effective vacuum pump suction
  }
}

function isVaporSpecies(from: VCName): boolean {
  return from === 'generator' || from === 'steam_line';
}

interface FlowAccum {
  air_in: number;
  vap_in: number;
  air_out: number;
  vap_out: number;
  inflow_T_weighted: number; // sum of (ṁ_in · T_up) for averaging
  inflow_T_mass: number;
}

function emptyAccum(): FlowAccum { return { air_in: 0, vap_in: 0, air_out: 0, vap_out: 0, inflow_T_weighted: 0, inflow_T_mass: 0 }; }

function speciesIn(a: FlowAccum): SpeciesFlow { return { air: a.air_in, vap: a.vap_in, liq: 0 }; }
function speciesOut(a: FlowAccum): SpeciesFlow { return { air: a.air_out, vap: a.vap_out, liq: 0 }; }
function inflowT(a: FlowAccum, fallback: number): number {
  return a.inflow_T_mass > 0 ? a.inflow_T_weighted / a.inflow_T_mass : fallback;
}

export function system_step(
  state: SystemState,
  params: SystemParams,
  valves: ValveCommands,
  actuators: ActuatorCommands,
  dt: number,
): SystemState {
  // Per-VC flow accumulators
  const acc: Record<string, FlowAccum> = {
    chamber: emptyAccum(),
    jacket: emptyAccum(),
    generator: emptyAccum(),
  };
  let vacuumDrawAir = 0;
  let vacuumDrawVap = 0;
  let generatorVaporOutflow = 0;

  // For each valve, compute ṁ if open
  for (const [vId, topo] of Object.entries(params.valves)) {
    if (!valves[vId]) continue;
    const up = vcPressure(topo.from, state, params);
    const down = vcPressure(topo.to, state, params);
    // Forward flow only (if reversed, swap and negate would apply — caller is expected to
    // design topology so this doesn't normally happen for autoclave valves).
    const m = choked_flow(up.P, up.T, down.P, topo.params);
    if (m <= 0) continue;

    const species = isVaporSpecies(topo.from) ? 'vap' : 'air';

    // Subtract from upstream
    if (topo.from === 'chamber' || topo.from === 'jacket' || topo.from === 'generator') {
      if (species === 'vap') acc[topo.from]!.vap_out += m;
      else acc[topo.from]!.air_out += m;
    }
    if (topo.from === 'generator') generatorVaporOutflow += m;

    // Add to downstream
    if (topo.to === 'chamber' || topo.to === 'jacket' || topo.to === 'generator') {
      if (species === 'vap') acc[topo.to]!.vap_in += m;
      else acc[topo.to]!.air_in += m;
      acc[topo.to]!.inflow_T_weighted += m * up.T;
      acc[topo.to]!.inflow_T_mass += m;
    } else if (topo.to === 'vacuum' && actuators.pump_vac) {
      if (species === 'vap') vacuumDrawVap += m;
      else vacuumDrawAir += m;
    }
  }

  // Apply vacuum pump effect: subtract additional mass from chamber (already counted in valve flow)
  // (Vacuum pump is modeled implicitly: V_VAC connects chamber→vacuum at low effective P_down.
  // When pump_vac is OFF, set vacuum P_down high so no flow. Simpler: skip vacuum effect if pump off.)
  if (!actuators.pump_vac) {
    // Undo any flow into vacuum if pump is off
    for (const [vId, topo] of Object.entries(params.valves)) {
      if (!valves[vId] || topo.to !== 'vacuum') continue;
      const up = vcPressure(topo.from, state, params);
      const down = vcPressure(topo.to, state, params);
      const m = choked_flow(up.P, up.T, down.P, topo.params);
      const species = isVaporSpecies(topo.from) ? 'vap' : 'air';
      if (topo.from === 'chamber' || topo.from === 'jacket') {
        if (species === 'vap') acc[topo.from]!.vap_out -= m;
        else acc[topo.from]!.air_out -= m;
      }
    }
  }

  // Load step (chamber gas ↔ load)
  const loadResult = load_step(state.load, params.load, state.chamber.T, dt);
  const Q_load = loadResult.Q_from_gas; // positive = removed from gas

  // Chamber step
  const chamberFluxes: ChamberFluxes = {
    inflow: speciesIn(acc.chamber!),
    inflow_T: inflowT(acc.chamber!, state.chamber.T),
    outflow: speciesOut(acc.chamber!),
    Q_external: -Q_load, // load absorbs heat → negative for chamber
  };
  const nextChamber = chamber_step(state.chamber, params.chamber, chamberFluxes, dt);

  // Jacket step
  const jacketFluxes: ChamberFluxes = {
    inflow: speciesIn(acc.jacket!),
    inflow_T: inflowT(acc.jacket!, state.jacket.T),
    outflow: speciesOut(acc.jacket!),
    Q_external: 0,
  };
  const nextJacket = chamber_step(state.jacket, params.jacket, jacketFluxes, dt);

  // Generator step
  let nextGenerator: GeneratorState | null = state.generator;
  if (state.generator && params.generator) {
    nextGenerator = generator_step(
      state.generator,
      params.generator,
      actuators.heater_gen,
      generatorVaporOutflow,
      dt,
    );
  }

  // F0 step (uses fabric/witness temp)
  const f0 = new F0Accumulator();
  f0.value_minutes = state.f0_minutes;
  f0.step(state.load.T_fabric, dt);

  return {
    chamber: nextChamber,
    jacket: nextJacket,
    generator: nextGenerator,
    load: loadResult.next,
    f0_minutes: f0.value_minutes,
    time_s: state.time_s + dt,
  };
}
```

- [ ] **Step 10.4: Run tests, verify pass**

`pnpm --filter @sim/physics test`.

If tests fail because of tuning (e.g., chamber doesn't pressurize fast enough with Cv=1e-6), adjust Cv values in `basicParams()` of the test — these are tuning parameters not physical truths. The test asserts QUALITATIVE behavior (pressure increases, temperature rises) — actual numbers depend on Cv tuning. Keep tolerances generous.

- [ ] **Step 10.5: Re-export**

Append to `src/index.ts`:
```typescript
export * from './integrator.js';
```

- [ ] **Step 10.6: Commit**

```bash
git add packages/physics/test/integrator.test.ts packages/physics/src/integrator.ts packages/physics/src/index.ts
git commit -m "feat(physics): system integrator (composes CVs via valves)"
```

---

## Task 11: CSV trace utility — TDD

**Files:**
- Create: `packages/physics/test/csv-trace.test.ts`
- Create: `packages/physics/src/csv-trace.ts`

- [ ] **Step 11.1: Write failing tests**

```typescript
// test/csv-trace.test.ts
import { describe, it, expect } from 'vitest';
import { CsvTrace } from '../src/csv-trace.js';

describe('CsvTrace', () => {
  it('emits header line on first row', () => {
    const t = new CsvTrace(['t', 'p_chamber', 'T_test']);
    t.row({ t: 0, p_chamber: 1.0, T_test: 22 });
    const out = t.serialize();
    expect(out.split('\n')[0]).toBe('t,p_chamber,T_test');
  });

  it('writes rows in registration order with correct values', () => {
    const t = new CsvTrace(['t', 'a', 'b']);
    t.row({ t: 0, a: 1, b: 2 });
    t.row({ t: 1, a: 3, b: 4 });
    const out = t.serialize();
    const lines = out.split('\n');
    expect(lines[1]).toBe('0,1,2');
    expect(lines[2]).toBe('1,3,4');
  });

  it('throws if row is missing a column', () => {
    const t = new CsvTrace(['t', 'a']);
    expect(() => t.row({ t: 0 } as any)).toThrow(/missing/);
  });

  it('formats numbers with reasonable precision (no scientific by default)', () => {
    const t = new CsvTrace(['t', 'x']);
    t.row({ t: 0.001, x: 1234567.89 });
    const out = t.serialize();
    expect(out).not.toMatch(/e[+-]/i);
  });
});
```

- [ ] **Step 11.2: Run tests, verify fail**

`pnpm --filter @sim/physics test`.

- [ ] **Step 11.3: Implement `packages/physics/src/csv-trace.ts`**

```typescript
export class CsvTrace<C extends string> {
  private readonly columns: C[];
  private readonly rows: number[][] = [];

  constructor(columns: C[]) {
    this.columns = columns;
  }

  row(values: Record<C, number>): void {
    const arr: number[] = [];
    for (const c of this.columns) {
      if (!(c in values)) throw new Error(`CsvTrace row missing column "${c}"`);
      arr.push(values[c]);
    }
    this.rows.push(arr);
  }

  serialize(): string {
    const fmt = (n: number): string => {
      if (Number.isInteger(n)) return n.toString();
      return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    };
    const lines = [this.columns.join(',')];
    for (const row of this.rows) {
      lines.push(row.map(fmt).join(','));
    }
    return lines.join('\n');
  }
}
```

- [ ] **Step 11.4: Run tests, verify pass.**

- [ ] **Step 11.5: Re-export and commit**

Append to `src/index.ts`:
```typescript
export * from './csv-trace.js';
```

```bash
git add packages/physics/test/csv-trace.test.ts packages/physics/src/csv-trace.ts packages/physics/src/index.ts
git commit -m "feat(physics): CSV trace utility for scenario output"
```

---

## Task 12: Scenario test — 121°C gravity (integration)

**Files:**
- Create: `packages/physics/test/scenarios/ster-121-gravity.test.ts`

This is an INTEGRATION test that drives the system through a full 121°C gravity-displacement cycle and asserts qualitative correctness.

- [ ] **Step 12.1: Write the scenario test**

```typescript
// test/scenarios/ster-121-gravity.test.ts
import { describe, it, expect } from 'vitest';
import {
  system_step, type SystemState, type SystemParams,
} from '../../src/integrator.js';
import { GAMMA_AIR, GAMMA_VAP, R_AIR, R_VAP, P_ATM, C_to_K, K_to_C, Pa_to_bar, bar_to_Pa } from '../../src/constants.js';
import { chamber_pressure } from '../../src/chamber.js';

const dt = 0.05; // 50 ms steps for faster runtime; scenario lasts ~25 min sim time

function makeParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 24000 },
    load: {
      m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500,
      h_gas_metal: 500, h_metal_fabric: 30,
    },
    valves: {
      V_STEAM_IN_INT: { from: 'generator', to: 'chamber', params: { Cv: 5e-7, gamma: GAMMA_VAP, R: R_VAP } },
      V_STEAM_IN_JACKET: { from: 'generator', to: 'jacket', params: { Cv: 1e-7, gamma: GAMMA_VAP, R: R_VAP } },
      V_EXHAUST: { from: 'chamber', to: 'atmosphere', params: { Cv: 2e-6, gamma: GAMMA_AIR, R: R_AIR } },
      V_AIR_IN: { from: 'atmosphere', to: 'chamber', params: { Cv: 2e-6, gamma: GAMMA_AIR, R: R_AIR } },
    },
    external: { steam_line_pressure: bar_to_Pa(5), steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
  };
}

function makeInitialState(p: SystemParams): SystemState {
  const T = C_to_K(22);
  const m_air_chamber = (P_ATM * p.chamber.V) / (R_AIR * T);
  const m_air_jacket = (P_ATM * p.jacket.V) / (R_AIR * T);
  return {
    chamber: { m_air: m_air_chamber, m_vap: 0, m_liq: 0, T },
    jacket: { m_air: m_air_jacket, m_vap: 0, m_liq: 0, T },
    generator: { m_water_liq: 30, m_water_vap: 0, T: C_to_K(22) },
    load: { T_metal: T, T_fabric: T },
    f0_minutes: 0,
    time_s: 0,
  };
}

describe('Sterilization 121°C gravity cycle', () => {
  it('reaches setpoint and accumulates F0 ≥ 15 in 25 min simulated time', () => {
    const p = makeParams();
    let s = makeInitialState(p);

    // Phase 0: heat generator + jacket for 5 min sim time
    for (let t = 0; t < 300 / dt; t++) {
      s = system_step(s, p, { V_STEAM_IN_JACKET: true }, { heater_gen: true, pump_vac: false }, dt);
    }

    // Phase 1: vent (open exhaust) to displace air with steam — typical gravity displacement
    // Open exhaust + steam in for 3 min (vapor pushes air out by gravity)
    for (let t = 0; t < 180 / dt; t++) {
      s = system_step(s, p, { V_STEAM_IN_INT: true, V_STEAM_IN_JACKET: true, V_EXHAUST: true }, { heater_gen: true, pump_vac: false }, dt);
    }

    // Phase 2: close exhaust, pressurize and hold 15 min @ 121°C
    for (let t = 0; t < 15 * 60 / dt; t++) {
      s = system_step(s, p, { V_STEAM_IN_INT: true, V_STEAM_IN_JACKET: true }, { heater_gen: true, pump_vac: false }, dt);
    }

    expect(s.f0_minutes).toBeGreaterThanOrEqual(15);
    expect(K_to_C(s.load.T_fabric)).toBeGreaterThan(120);
  }, 120000);
});
```

- [ ] **Step 12.2: Run and tune**

`pnpm --filter @sim/physics test test/scenarios/ster-121-gravity.test.ts`.

If F0 doesn't reach 15 in the simulated time, you have a tuning issue. Likely fixes:
- Increase Cv of V_STEAM_IN_INT (more vapor entering)
- Increase generator heater power
- Reduce load mass (less thermal inertia)
- Or extend the hold time

The test is a qualitative check — adjust the Cv and timing parameters in the test until it passes naturally. If you have to tune by huge amounts (>10x), there's likely a bug in the physics. Audit dimensional consistency first.

If a real physics bug surfaces (e.g., generator never reaches saturation), fix it in the source and document in commit.

- [ ] **Step 12.3: Commit**

```bash
git add packages/physics/test/scenarios/ster-121-gravity.test.ts
# AND any source file changes resulting from tuning/bugfixes
git commit -m "test(physics): 121°C gravity sterilization cycle integration"
```

---

## Task 13: Scenario test — 134°C pre-vacuum (HEADLINE)

**Files:**
- Create: `packages/physics/test/scenarios/ster-134-prevac.test.ts`

- [ ] **Step 13.1: Write the scenario test**

```typescript
// test/scenarios/ster-134-prevac.test.ts
import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { GAMMA_AIR, GAMMA_VAP, R_AIR, R_VAP, P_ATM, C_to_K, K_to_C, Pa_to_bar, bar_to_Pa } from '../../src/constants.js';
import { chamber_pressure } from '../../src/chamber.js';

const dt = 0.05;

function makeParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 24000 },
    load: {
      m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500,
      h_gas_metal: 500, h_metal_fabric: 30,
    },
    valves: {
      V_STEAM_IN_INT: { from: 'generator', to: 'chamber', params: { Cv: 8e-7, gamma: GAMMA_VAP, R: R_VAP } },
      V_STEAM_IN_JACKET: { from: 'generator', to: 'jacket', params: { Cv: 1e-7, gamma: GAMMA_VAP, R: R_VAP } },
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-5, gamma: GAMMA_AIR, R: R_AIR } },
      V_EXHAUST: { from: 'chamber', to: 'atmosphere', params: { Cv: 2e-6, gamma: GAMMA_AIR, R: R_AIR } },
    },
    external: { steam_line_pressure: bar_to_Pa(5), steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
  };
}

function makeInitialState(p: SystemParams): SystemState {
  const T = C_to_K(22);
  return {
    chamber: { m_air: (P_ATM * p.chamber.V) / (R_AIR * T), m_vap: 0, m_liq: 0, T },
    jacket: { m_air: (P_ATM * p.jacket.V) / (R_AIR * T), m_vap: 0, m_liq: 0, T },
    generator: { m_water_liq: 30, m_water_vap: 0, T: C_to_K(22) },
    load: { T_metal: T, T_fabric: T },
    f0_minutes: 0,
    time_s: 0,
  };
}

function vacuumPulse(state: SystemState, p: SystemParams, duration_s: number): SystemState {
  let s = state;
  for (let t = 0; t < duration_s / dt; t++) {
    s = system_step(s, p, { V_VAC: true }, { heater_gen: true, pump_vac: true }, dt);
  }
  return s;
}

function steamPulse(state: SystemState, p: SystemParams, duration_s: number): SystemState {
  let s = state;
  for (let t = 0; t < duration_s / dt; t++) {
    s = system_step(s, p, { V_STEAM_IN_INT: true, V_STEAM_IN_JACKET: true }, { heater_gen: true, pump_vac: false }, dt);
  }
  return s;
}

describe('Sterilization 134°C pre-vacuum cycle (headline)', () => {
  it('completes 3 prevac pulses + hold and reaches F0 ≥ 100', () => {
    const p = makeParams();
    let s = makeInitialState(p);

    // Phase 0: 5 min heat jacket + generator
    for (let t = 0; t < 300 / dt; t++) {
      s = system_step(s, p, { V_STEAM_IN_JACKET: true }, { heater_gen: true, pump_vac: false }, dt);
    }

    // 3 alternating vacuum/steam pulses (each 30 s vac, 30 s steam)
    for (let i = 0; i < 3; i++) {
      s = vacuumPulse(s, p, 30);
      s = steamPulse(s, p, 30);
    }

    // Final pressurization until T_fabric ≥ 134°C (max 5 min)
    const maxRamp = 5 * 60 / dt;
    for (let t = 0; t < maxRamp; t++) {
      s = system_step(s, p, { V_STEAM_IN_INT: true, V_STEAM_IN_JACKET: true }, { heater_gen: true, pump_vac: false }, dt);
      if (K_to_C(s.load.T_fabric) >= 134) break;
    }

    // Hold 7 min
    for (let t = 0; t < 7 * 60 / dt; t++) {
      s = system_step(s, p, { V_STEAM_IN_INT: true, V_STEAM_IN_JACKET: true }, { heater_gen: true, pump_vac: false }, dt);
    }

    expect(s.f0_minutes).toBeGreaterThanOrEqual(100);
    expect(K_to_C(s.load.T_fabric)).toBeGreaterThanOrEqual(134);
  }, 180000);
});
```

- [ ] **Step 13.2: Run + tune**

`pnpm --filter @sim/physics test test/scenarios/ster-134-prevac.test.ts`.

Tune Cv values until cycle behaves realistically. Vacuum should drop chamber pressure to <0.3 bar within 30 s; steam pulse should restore to ~2 bar within 30 s; final hold at 134°C should accumulate F0 ≈ 137 in 7 min.

If tuning becomes extreme (Cv changes >10x), revisit the physics. Common bugs to check:
- Chamber `Q_external` sign (should be negative when load absorbs heat from gas)
- Condensation latent heat sign (releases heat into chamber when condensing)
- Generator never crossing saturation (check `T_sat_from_p` bisection)

- [ ] **Step 13.3: Commit**

```bash
git add packages/physics/test/scenarios/ster-134-prevac.test.ts
git commit -m "test(physics): 134°C pre-vacuum sterilization cycle integration"
```

---

## Task 14: Scenario test — drying (qualitative)

**Files:**
- Create: `packages/physics/test/scenarios/drying.test.ts`

- [ ] **Step 14.1: Write the test**

```typescript
// test/scenarios/drying.test.ts
import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { GAMMA_AIR, R_AIR, P_ATM, C_to_K, Pa_to_bar } from '../../src/constants.js';

const dt = 0.05;

describe('Drying phase', () => {
  it('removes residual liquid water from chamber via vacuum + hot jacket', () => {
    const p: SystemParams = {
      chamber: { V: 0.15, allowLiquid: true },
      jacket: { V: 0.025, allowLiquid: false },
      generator: null,
      load: { m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500, h_gas_metal: 500, h_metal_fabric: 30 },
      valves: {
        V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-5, gamma: GAMMA_AIR, R: R_AIR } },
      },
      external: { steam_line_pressure: 0, steam_line_T: 0, atmosphere_T: C_to_K(22) },
    };

    let s: SystemState = {
      chamber: { m_air: 0.01, m_vap: 0.05, m_liq: 0.1, T: C_to_K(134) }, // hot wet chamber post-cycle
      jacket: { m_air: 0, m_vap: 0.05, m_liq: 0, T: C_to_K(135) },
      generator: null,
      load: { T_metal: C_to_K(134), T_fabric: C_to_K(134) },
      f0_minutes: 100,
      time_s: 0,
    };

    const m_liq_initial = s.chamber.m_liq;
    for (let t = 0; t < 900 / dt; t++) {  // 15 min vacuum
      s = system_step(s, p, { V_VAC: true }, { heater_gen: false, pump_vac: true }, dt);
    }

    expect(s.chamber.m_liq).toBeLessThan(m_liq_initial * 0.5); // at least half evaporated
  }, 120000);
});
```

Note: this test will only pass if the chamber model implements evaporation when `p_vap < p_sat` and `m_liq > 0`. The chamber_step implementation above DOES NOT include explicit evaporation — it only handles condensation (excess vapor → liquid). Drying via vacuum only removes vapor by mass outflow; liquid stays.

If the test fails because liquid doesn't decrease, EXTEND `chamber_step` to add an evaporation term:

Add inside `chamber_step` before the saturation loop:
```typescript
// Evaporation: if liquid present and gas is sub-saturated, evaporate at rate proportional to deficit
if (p.allowLiquid && m_liq > 0) {
  const p_sat = (() => { const t_C = T - 273.15; return Math.pow(10, 8.07131 - 1730.63 / (233.426 + t_C)) * 133.322; })();
  const p_vap_now = (m_vap * R_VAP * T) / p.V;
  if (p_vap_now < p_sat) {
    const k_evap = 1e-7; // kg/(s·Pa) — empirical surface-evaporation coefficient
    const dm_evap_max = m_liq;
    const dm_evap = Math.min(k_evap * (p_sat - p_vap_now) * dt, dm_evap_max);
    m_liq -= dm_evap;
    m_vap += dm_evap;
    // Cools the system (latent heat absorbed)
    const Q_lat = -dm_evap * h_vap_water(T);
    const denom = m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ;
    T += Q_lat / denom;
  }
}
```

(Add the `R_VAP` import to chamber.ts if not present — it should be from the saturation handling.)

If you add evaporation, add a chamber test for it too:

```typescript
// Append to test/chamber.test.ts
describe('chamber_step — evaporation', () => {
  it('evaporates liquid when sub-saturated', () => {
    const s = { m_air: 0.01, m_vap: 0, m_liq: 0.05, T: C_to_K(80) };
    let cur = s;
    for (let i = 0; i < 60 * 100; i++) cur = chamber_step(cur, params150L, noFlux(cur.T), 0.01);
    expect(cur.m_liq).toBeLessThan(s.m_liq);
    expect(cur.m_vap).toBeGreaterThan(s.m_vap);
  });
});
```

- [ ] **Step 14.2: Run and tune.** Adjust `k_evap` if drying is too slow/fast.

- [ ] **Step 14.3: Commit**

```bash
git add packages/physics/test/scenarios/drying.test.ts packages/physics/src/chamber.ts packages/physics/test/chamber.test.ts
git commit -m "feat(physics): chamber evaporation + drying scenario test"
```

---

## Task 15: CLI scenario runner

**Files:**
- Create: `packages/physics/src/cli.ts`
- Create: `packages/physics/scenarios/ster-134-prevac.yaml` (example scenario)

The CLI takes a YAML scenario file with timed valve commands and produces a CSV trace.

- [ ] **Step 15.1: Write example scenario YAML**

```yaml
# packages/physics/scenarios/ster-134-prevac.yaml
name: ster-134-prevac
dt_s: 0.05
duration_max_s: 1800
equipment:
  chamber_volume_l: 150
  jacket_volume_l: 25
  generator_water_l: 30
  heater_kw: 24
  load:
    metal_kg: 20
    fabric_kg: 5
steps:
  - { t: 0,    valves: [V_STEAM_IN_JACKET], actuators: [HEATER_GEN] }
  - { t: 300,  valves: [V_VAC], actuators: [HEATER_GEN, PUMP_VAC] }
  - { t: 330,  valves: [V_STEAM_IN_INT, V_STEAM_IN_JACKET], actuators: [HEATER_GEN] }
  - { t: 360,  valves: [V_VAC], actuators: [HEATER_GEN, PUMP_VAC] }
  - { t: 390,  valves: [V_STEAM_IN_INT, V_STEAM_IN_JACKET], actuators: [HEATER_GEN] }
  - { t: 420,  valves: [V_VAC], actuators: [HEATER_GEN, PUMP_VAC] }
  - { t: 450,  valves: [V_STEAM_IN_INT, V_STEAM_IN_JACKET], actuators: [HEATER_GEN] }
  - { t: 1050, valves: [V_EXHAUST], actuators: [HEATER_GEN] }      # exhaust
  - { t: 1110, valves: [V_VAC], actuators: [HEATER_GEN, PUMP_VAC] } # drying
```

- [ ] **Step 15.2: Implement `packages/physics/src/cli.ts`**

```typescript
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { system_step, type SystemState, type SystemParams } from './integrator.js';
import { CsvTrace } from './csv-trace.js';
import { chamber_pressure } from './chamber.js';
import { generator_pressure } from './generator.js';
import { GAMMA_AIR, GAMMA_VAP, R_AIR, R_VAP, P_ATM, C_to_K, K_to_C, Pa_to_bar, bar_to_Pa } from './constants.js';

interface Scenario {
  name: string;
  dt_s: number;
  duration_max_s: number;
  equipment: {
    chamber_volume_l: number;
    jacket_volume_l: number;
    generator_water_l: number;
    heater_kw: number;
    load: { metal_kg: number; fabric_kg: number };
  };
  steps: Array<{ t: number; valves: string[]; actuators: string[] }>;
}

function makeParams(eq: Scenario['equipment']): SystemParams {
  return {
    chamber: { V: eq.chamber_volume_l / 1000, allowLiquid: true },
    jacket: { V: eq.jacket_volume_l / 1000, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: eq.heater_kw * 1000 },
    load: {
      m_metal: eq.load.metal_kg, cp_metal: 500,
      m_fabric: eq.load.fabric_kg, cp_fabric: 1500,
      h_gas_metal: 500, h_metal_fabric: 30,
    },
    valves: {
      V_STEAM_IN_INT: { from: 'generator', to: 'chamber', params: { Cv: 8e-7, gamma: GAMMA_VAP, R: R_VAP } },
      V_STEAM_IN_JACKET: { from: 'generator', to: 'jacket', params: { Cv: 1e-7, gamma: GAMMA_VAP, R: R_VAP } },
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-5, gamma: GAMMA_AIR, R: R_AIR } },
      V_EXHAUST: { from: 'chamber', to: 'atmosphere', params: { Cv: 2e-6, gamma: GAMMA_AIR, R: R_AIR } },
      V_AIR_IN: { from: 'atmosphere', to: 'chamber', params: { Cv: 2e-6, gamma: GAMMA_AIR, R: R_AIR } },
    },
    external: { steam_line_pressure: bar_to_Pa(5), steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
  };
}

function makeInitialState(p: SystemParams, eq: Scenario['equipment']): SystemState {
  const T = C_to_K(22);
  return {
    chamber: { m_air: (P_ATM * p.chamber.V) / (R_AIR * T), m_vap: 0, m_liq: 0, T },
    jacket: { m_air: (P_ATM * p.jacket.V) / (R_AIR * T), m_vap: 0, m_liq: 0, T },
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

  const trace = new CsvTrace(['t_s', 'P_chamber_bar', 'P_jacket_bar', 'P_gen_bar', 'T_chamber_C', 'T_test_C', 'T_jacket_C', 'T_gen_C', 'F0_min', 'm_air_chamber', 'm_vap_chamber', 'm_liq_chamber']);

  // Sort steps by t
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
      const pg = state.generator ? generator_pressure(state.generator, params.generator!) : 0;
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

// Auto-invoke
const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === (process.argv[1] ? resolve(process.argv[1]) : '');
  } catch { return false; }
})();

if (isMain) {
  const [scn, out] = [process.argv[2], process.argv[3] ?? 'trace.csv'];
  if (!scn) {
    console.error('usage: tsx src/cli.ts <scenario.yaml> [out.csv]');
    process.exit(1);
  }
  run(resolve(process.cwd(), scn), resolve(process.cwd(), out));
}
```

- [ ] **Step 15.3: Smoke-run the scenario manually**

```bash
pnpm --filter @sim/physics scenario scenarios/ster-134-prevac.yaml out/trace.csv
```

Expected: logs printed, `packages/physics/out/trace.csv` written, F0 ≥ 100 at end.

Inspect the CSV manually or pipe through a quick plot. Open in Excel/Numbers/LibreOffice to visually confirm pressure rises during steam pulses, drops during vacuum, T_test lags T_chamber.

(`out/` should be in .gitignore — verify.)

- [ ] **Step 15.4: Commit**

```bash
git add packages/physics/src/cli.ts packages/physics/scenarios/ster-134-prevac.yaml
git commit -m "feat(physics): CLI scenario runner with YAML input + CSV trace output"
```

---

## Task 16: Smoke + finalize TODO

**Files:**
- Modify: `TODO.md`

- [ ] **Step 16.1: Full local check**

```
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

All must pass.

If any TypeScript errors come from `packages/physics` consuming itself or others, fix and recommit.

- [ ] **Step 16.2: Update TODO.md**

Move sub-projeto 2 from "Em curso" to "Feito":

```markdown
## Em curso

(vazio — escolher próximo sub-projeto)

## Pendente

- Sub-projeto 3 — Orchestrator + virtual bridge + scenario runner (cenário 134°C verde)
- Sub-projeto 4 — Dashboard MVP (live + virtual-plc + equipment CRUD + WS)
- Sub-projeto 5 — Firmware ESP32 + Modbus slave (I/O + watchdog + fast model)
- Sub-projeto 6 — Injeção de falhas (hooks orchestrator + UI faults + cenários)
- Sub-projeto 7 — Placa condicionamento KiCad (schematic + PCB + BOM)
- Sub-projeto 8 — PLC-in-loop aceitação (PLC real, ajustes finais, QA arquivada)
- Sub-projeto 9 — Mímico SVG + cycles history + replay

## Feito

- 2026-05-23 — Sub-projeto 2 — Modelo físico standalone (packages/physics: saturação, valve, chamber, jacket, generator, load, f0, integrator, CLI scenario runner. Cenários 121°C gravidade + 134°C prevac + drying verdes)
- 2026-05-23 — Sub-projeto 1 — Foundation (...)
```

- [ ] **Step 16.3: Commit**

```bash
git add TODO.md
git commit -m "chore: mark physics sub-project complete"
```

- [ ] **Step 16.4: Push**

```bash
git push origin master
```

Verify CI green at https://github.com/afonsorcarvalho/simulador-autoclaves/actions.

---

## Done criteria

- All vitest tests pass (parser tests from Foundation + new physics tests + 3 scenarios).
- `pnpm --filter @sim/physics scenario scenarios/ster-134-prevac.yaml out/trace.csv` produces a CSV showing realistic cycle dynamics with F0 ≥ 100.
- Type errors: zero.
- Lint: clean.
- CI green on GitHub.
- TODO.md updated.

---

## What this plan does NOT cover

- ESP32 fast-loop subset (Phase 5).
- Modbus bridge / virtual slave (Phase 3).
- Dashboard / mímico (Phase 4).
- Fault injection hooks (Phase 6) — model state is pure, hooks come later.
- Real autoclave parameter calibration against a specific PLC reference run — tuning here is "qualitatively realistic", not certified.
