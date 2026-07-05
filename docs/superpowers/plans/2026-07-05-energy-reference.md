# Common Enthalpy Reference (u_fg0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make water's latent heat travel with vapor mass consistently across every control volume, so phase changes and cross-CV vapor transport conserve energy exactly (closing the ~1.4 MJ/kg chamber↔load condensation gap the physics review found).

**Architecture:** Adopt a single reference state (liquid water, u=0 at 273.15 K). Vapor internal energy gains a constant latent offset `U_FG0`; vapor transport carries the same offset. Phase change becomes mass-only — temperature is solved from total internal energy (latent included) by bisection — which deletes the explicit latent deposits, the `MIN_HEAT_CAP` floor, and the wall-latent hacks. A global energy-conservation test is the keystone gate.

**Tech Stack:** TypeScript, Vitest, pnpm+turbo. Physics in `packages/physics`.

**Spec:** `docs/superpowers/specs/2026-07-05-energy-reference-design.md`

**Branch:** `feat/chamber-two-phase` (continues; SP-A rewrites the chamber phase block that the earlier Task 2 added, keeps the Q_wall_external/relief infra).

---

## Key constant (derived, use verbatim)

Effective condensation latent `L_eff(T) = U_FG0 − (CP_LIQ − CV_VAP)·T`. Choose `U_FG0` so `L_eff` matches `h_vap_water` at the F0-ish reference 121 °C (394.25 K):

```
U_FG0 = h_vap_water(394.25) + (CP_LIQ − CV_VAP)·394.25
      = 2.1988e6 + 2776·394.25
      ≈ 3.293e6  J/kg
```

Because `CP_LIQ − CV_VAP = 2776 ≈ 2769` (the slope of `h_vap_water` per K), `L_eff(T) ≈ h_vap_water(T)` across the whole autoclave range, not just at 121 °C. Storage: `u_vap = CV_VAP·T + U_FG0`. Transport (advected enthalpy): `h_vap = CP_VAP·T + U_FG0` (the cp/cv split supplies flow work; the latent offset is identical in both).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/physics/src/constants.ts` | SI constants | add `U_FG0`; document reference state |
| `packages/physics/src/energy.ts` (**new**) | shared energy helpers | `vaporU`, `L_eff`, `chamberInternalEnergy` — one home for the reference so every CV agrees |
| `packages/physics/src/chamber.ts` | chamber/jacket CV step | `U` + transport carry latent; phase block → mass-only bisection; delete latent-deposit/floor code |
| `packages/physics/src/load.ts` | load nodes | condensation/flash latent on the common reference |
| `packages/physics/src/integrator.ts` | system wiring | vapor transport between CVs carries latent; generator outflow tagged |
| `packages/physics/src/generator.ts` | generator CV | outflow reference only (internal model unchanged) |
| `packages/physics/test/energy-conservation.test.ts` (**new**) | keystone | closed-system + heater-input conservation |

---

## Task 1: `U_FG0` constant + energy helpers

**Files:**
- Modify: `packages/physics/src/constants.ts`
- Create: `packages/physics/src/energy.ts`
- Test: `packages/physics/test/energy.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/physics/test/energy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { U_FG0 } from '../src/constants.js';
import { L_eff, vaporU } from '../src/energy.js';
import { h_vap_water } from '../src/saturation.js';
import { C_to_K, CV_VAP } from '../src/constants.js';

describe('common enthalpy reference', () => {
  it('U_FG0 makes effective latent match h_vap_water near 121 C', () => {
    const T = C_to_K(121);
    expect(L_eff(T)).toBeCloseTo(h_vap_water(T), -1); // within ~10 J/kg over 2.2e6 → -1 precision (10s of J)
  });

  it('effective latent tracks h_vap_water across the autoclave range', () => {
    for (const tc of [80, 100, 121, 134, 150]) {
      const T = C_to_K(tc);
      expect(Math.abs(L_eff(T) - h_vap_water(T))).toBeLessThan(2000); // < 2 kJ/kg everywhere
    }
  });

  it('vaporU = CV_VAP*T + U_FG0', () => {
    const T = C_to_K(134);
    expect(vaporU(1, T)).toBeCloseTo(CV_VAP * T + U_FG0, 6);
    expect(vaporU(3, T)).toBeCloseTo(3 * (CV_VAP * T + U_FG0), 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sim/physics test -- energy.test.ts`
Expected: FAIL — `U_FG0`, `L_eff`, `vaporU` don't exist.

- [ ] **Step 3: Add the constant**

In `packages/physics/src/constants.ts`, after `CP_LIQ`:

```ts
/** Latent-heat offset for vapor internal energy (J/kg), on the common reference
 *  (liquid water, u=0 at 273.15 K). Chosen so the effective condensation latent
 *  L_eff(T) = U_FG0 − (CP_LIQ − CV_VAP)·T matches h_vap_water(T) near 121 °C (and,
 *  because CP_LIQ−CV_VAP ≈ the slope of h_vap_water, across the whole range).
 *  u_vap = CV_VAP·T + U_FG0 (storage); h_vap = CP_VAP·T + U_FG0 (transport). */
export const U_FG0 = 3.293e6; // J/kg
```

- [ ] **Step 4: Create the energy helper module**

Create `packages/physics/src/energy.ts`:

```ts
import { CV_VAP, CP_LIQ, U_FG0 } from './constants.js';

/** Effective condensation latent at temperature T (J/kg): u_vap − u_liq. */
export function L_eff(T_K: number): number {
  return U_FG0 - (CP_LIQ - CV_VAP) * T_K;
}

/** Internal energy of m kg of vapor at T (J), on the common reference. */
export function vaporU(m_kg: number, T_K: number): number {
  return m_kg * (CV_VAP * T_K + U_FG0);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @sim/physics test -- energy.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/physics/src/constants.ts packages/physics/src/energy.ts packages/physics/test/energy.test.ts
git commit -m "feat(physics): U_FG0 latent offset + energy reference helpers"
```

---

## Task 2: Chamber energy balance carries latent; phase change → mass-only bisection

**Files:**
- Modify: `packages/physics/src/chamber.ts` (energy balance §2-3; phase block §4)
- Test: `packages/physics/test/chamber.test.ts`

**Background:** Today `chamber_step` computes `U_old`/`H_in`/`H_out` as sensible-only, then handles phase change with explicit latent deposits + a saturation loop + (from the earlier Task 2) a pin. Rewrite so vapor carries `U_FG0` in both storage and transport, and the phase split is solved from total `U` by bisection. The wall coupling (§3.2) stays sensible and unchanged. Delete the old §3.5 evaporation, the §4 chamber-branch loop, the pin, the latent-to-wall deposits, and the `MIN_HEAT_CAP_JK` floor in the chamber path. Keep the jacket (`!allowLiquid`) behaviour but on the same energy basis.

- [ ] **Step 1: Write the failing conservation test**

Add to `packages/physics/test/chamber.test.ts`:

```ts
import { vaporU } from '../src/energy.js';
import { CV_AIR, CP_LIQ } from '../src/constants.js';

function chamberEnergy(s: ChamberState, wall_C: number): number {
  const gas = s.m_air * CV_AIR * s.T + vaporU(s.m_vap, s.T) + s.m_liq * CP_LIQ * s.T;
  const wall = wall_C > 0 && s.T_wall !== undefined ? wall_C * s.T_wall : 0;
  return gas + wall;
}

describe('chamber_step — energy conservation (closed CV, latent reference)', () => {
  const walled: ChamberParams = {
    V: 0.15, allowLiquid: true, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200,
  };
  const wall_C = 50 * 500;

  it('conserves total energy when vapor condenses (no flows, no external Q)', () => {
    const s: ChamberState = { m_air: 0, m_vap: 0.03, m_liq: 0, T: C_to_K(150), T_wall: C_to_K(150) };
    const E0 = chamberEnergy(s, wall_C);
    let cur = s;
    for (let i = 0; i < 50; i++) cur = chamber_step(cur, walled, noFlux(cur.T), 0.05);
    const E1 = chamberEnergy(cur, wall_C);
    expect(E1).toBeCloseTo(E0, 2); // total energy conserved to ~0.01 J
    expect(cur.m_vap + cur.m_liq).toBeCloseTo(0.03, 8); // water mass conserved
  });

  it('conserves total energy when liquid evaporates (sub-saturated, no flows)', () => {
    const s: ChamberState = { m_air: 0, m_vap: 0.001, m_liq: 0.02, T: C_to_K(80), T_wall: C_to_K(80) };
    const E0 = chamberEnergy(s, wall_C);
    let cur = s;
    for (let i = 0; i < 50; i++) cur = chamber_step(cur, walled, noFlux(cur.T), 0.05);
    expect(chamberEnergy(cur, wall_C)).toBeCloseTo(E0, 2);
    expect(cur.m_vap + cur.m_liq).toBeCloseTo(0.021, 8);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sim/physics test -- chamber.test.ts -t "energy conservation"`
Expected: FAIL — the current sensible-only `U` + latent-to-wall deposits do not conserve the latent-inclusive energy (that's the bug).

- [ ] **Step 3: Rewrite the energy balance to carry latent**

In `chamber.ts`, add the import:

```ts
import { vaporU, L_eff } from './energy.js';
```

Replace the `U_old`, `H_in`, `H_out` computations (currently ~lines 104-106) with latent-carrying versions:

```ts
  const U_old = s.m_air * CV_AIR * s.T + vaporU(s.m_vap, s.T) + s.m_liq * CP_LIQ * s.T;
  const H_in =
    dm_air_in * CP_AIR * f.inflow_T +
    dm_vap_in * (CP_VAP * f.inflow_T + U_FG0) +
    dm_liq_in * CP_LIQ * f.inflow_T;
  const H_out =
    dm_air_out * CP_AIR * s.T +
    dm_vap_out * (CP_VAP * s.T + U_FG0) +
    dm_liq_out * CP_LIQ * s.T;
```

Add `U_FG0` to the constants import at the top of chamber.ts.

- [ ] **Step 4: Replace the T-solve + phase block with a mass-only equilibrium bisection**

Remove the `U_floor`/`U_ceil` clamp block, the provisional-T solve, the §3.5 evaporation, and the entire §4 phase block **for the chamber path**. Replace with:

```ts
  // Provisional internal energy after transport + external sensible heat (wall handled below).
  const U_raw = U_old + H_in - H_out + f.Q_external * dt;

  // Wall coupling (sensible, unchanged) runs first on a provisional gas T from a
  // frozen-composition estimate, then the phase equilibrium re-solves T from U including latent.
  // ... keep the existing §3.2 wall-coupling block, but drive it from a provisional T computed
  //     with the CURRENT masses (frozen), i.e. T_prov = solveTfrozen(U_raw, m_air, m_vap, m_liq).

  let T: number;
  let m_vap_f = m_vap;
  let m_liq_f = m_liq;

  if (p.allowLiquid) {
    // Two-phase equilibrium: total water splits so vapor is saturated at T; solve T from U.
    const m_w = m_vap + m_liq;
    const energyAt = (Tc: number) => {
      const mv = Math.min(m_w, (p_sat_water(Tc) * p.V) / (R_VAP * Tc));
      const ml = m_w - mv;
      return m_air * CV_AIR * Tc + vaporU(mv, Tc) + ml * CP_LIQ * Tc;
    };
    // Bisection on T in [T_MIN_K, T_MAX_K] to match U_raw (energyAt is monotonic increasing in T).
    let lo = T_MIN_K, hi = T_MAX_K;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (energyAt(mid) < U_raw) lo = mid; else hi = mid;
    }
    T = (lo + hi) / 2;
    m_vap_f = Math.min(m_w, (p_sat_water(T) * p.V) / (R_VAP * T));
    m_liq_f = m_w - m_vap_f;
  } else {
    // Jacket: vapor + air only, condensate drips out. Solve T with liquid removed each step.
    // Single-phase sensible solve, then condense any supersaturation and drop the condensate.
    const denom = m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ;
    T = denom > 0 ? (U_raw - m_vap * U_FG0 - /* liquid/air offsets already in U_raw */ 0) / denom : s.T;
    // NOTE: implementer — derive the jacket T-solve so it is consistent with vaporU storage and
    // drives the conservation test; then condense m_vap>m_vap_sat, drip the condensate out
    // (m_liq=0), and credit the dripped liquid's enthalpy as leaving the CV. The jacket already
    // deposited latent to the wall before; under the latent reference the condensation energy is
    // in U, so route the sensible remainder to the wall via the existing coupling, and let the
    // dripped condensate carry CP_LIQ·T out. Reconcile against the jacket conservation test in Task 4.
    m_vap_f = m_vap; m_liq_f = 0;
  }

  if (!isFinite(T)) T = s.T;
  T = Math.max(T_MIN_K, Math.min(T, T_MAX_K));
  m_vap = m_vap_f;
  m_liq = m_liq_f;
```

Then keep the existing wall-coupling block (§3.2) and the `Q_wall_external` block, but ensure they run against `T` and update `T`/`T_wall` sensibly (wall exchange is sensible only). Keep the relief block (§5).

**Implementer note:** the chamber (`allowLiquid`) path is fully specified above and must pass the Step-1 conservation test. The jacket path needs you to finish the T-solve so its own conservation test (Task 4) passes — the inline note tells you the constraints. Do the chamber path first, get Step-1 green, commit, then handle the jacket in Task 4.

- [ ] **Step 5: Run the conservation test + full chamber suite**

Run: `pnpm --filter @sim/physics test -- chamber.test.ts`
Expected: the two new conservation tests PASS. Existing chamber tests that asserted OLD sensible-only temperatures will shift — migrate each failing expectation to the new value with a one-line physical reason (the gas now stores latent, so condensation/evaporation temperatures differ). Do NOT weaken a test that checks a real invariant (mass conservation, monotonicity); recompute its expected number. Report every migration. If the jacket tests fail here, note them — they're finished in Task 4; you may temporarily `it.skip` a jacket-only test with a `// TODO(Task4)` and un-skip it in Task 4 (report which).

- [ ] **Step 6: Commit**

```bash
git add packages/physics/src/chamber.ts packages/physics/test/chamber.test.ts
git commit -m "feat(physics): chamber energy carries latent; phase change via mass-only bisection"
```

---

## Task 3: Load↔chamber condensation on the common reference

**Files:**
- Modify: `packages/physics/src/load.ts` (condensation/flash latent)
- Test: `packages/physics/test/integrator/drying.test.ts` (closed chamber+load conservation)

**Background:** `load.ts` credits a condensing node `Q_cond = dep·h_vap_water(node.T)` and pulls `dep` kg from chamber vapor. Under the latent reference the vapor leaving the chamber carries `CP_VAP·T + U_FG0`, so the two sides must use the **same** latent basis. Switch the load's condensation/flash latent to `L_eff` (the common effective latent) so the closed chamber+load system conserves energy.

- [ ] **Step 1: Write the failing conservation test**

Add to `packages/physics/test/integrator/drying.test.ts`:

```ts
import { vaporU } from '../../src/energy.js';
import { CV_AIR, CP_LIQ } from '../../src/constants.js';

function systemWaterEnergy(s: SystemState, wall_C_ch: number): number {
  const ch = s.chamber;
  const chGas = ch.m_air * CV_AIR * ch.T + vaporU(ch.m_vap, ch.T) + ch.m_liq * CP_LIQ * ch.T;
  const chWall = ch.T_wall !== undefined ? wall_C_ch * ch.T_wall : 0;
  const load = s.load.nodes.reduce((acc, n) => {
    // node sensible: material heat capacity is folded into load_step; approximate node energy as
    // its water + a material term. Use the load model's own C if exposed; else compare deltas.
    return acc + n.m_water * CP_LIQ * n.T;
  }, 0);
  return chGas + chWall + load;
}

describe('load↔chamber condensation conserves energy (closed, latent reference)', () => {
  it('no energy is created when the load condenses chamber vapor', () => {
    const p = params();
    p.valves = {}; // closed
    const T = C_to_K(134);
    const load = buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], C_to_K(100));
    // cold load in a saturated chamber → condensation onto the load
    let s: SystemState = {
      chamber: { m_air: 1e-6, m_vap: (p_sat_water(T) * 0.15) / (R_VAP * T), m_liq: 0, T, T_wall: T },
      jacket: { m_air: 0, m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(140)), m_liq: 0, T: C_to_K(140), T_wall: C_to_K(140) },
      generator: null, load, f0_minutes: 0, time_s: 0,
    };
    // Isolate chamber+load: neutralize jacket conduction so only chamber↔load exchange moves energy.
    p.jacket_chamber_h_W_per_K = 0;
    const wall_C = 50 * 500;
    const E0 = systemWaterEnergy(s, wall_C);
    for (let i = 0; i < 200; i++) s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.05);
    const E1 = systemWaterEnergy(s, wall_C);
    // Radiation to the load is the only other term; with jacket static and no valves, the
    // chamber↔load water/latent exchange must not create energy. Allow a small tolerance for
    // the jacket radiation term (bounded), assert no gross ~1.4 MJ/kg creation.
    const created = E1 - E0;
    expect(Math.abs(created)).toBeLessThan(5000); // < 5 kJ drift over 10 s (was ~10^5-10^6 J before)
  });
});
```

**Implementer note:** if the residual radiation term makes an exact assertion impractical, tighten the setup (set `emissivity`→0 via a material without radiation, or equalize `T_jacket` to load T) so the ONLY energy path is chamber↔load condensation, and assert conservation to ~1 J. The point is to prove the ~1.4 MJ/kg creation is gone.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sim/physics test -- drying.test.ts -t "conserves energy"`
Expected: FAIL — energy created by the `h_vap_water` vs sensible mismatch.

- [ ] **Step 3: Switch the load latent to the common reference**

In `packages/physics/src/load.ts`, import `L_eff`:

```ts
import { L_eff } from './energy.js';
```

Replace the condensation/flash latent `hv = h_vap_water(node.T)` (line ~60) usage in the condensation and flash branches with `L_eff(node.T)` where the latent crosses the chamber boundary. Concretely, at line ~60 change:

```ts
    const hv = L_eff(node.T); // common-reference latent so chamber↔load condensation conserves
```

(Keep the variable name `hv` to minimize churn; it now holds the common effective latent. Verify both the condensation branch, ~line 78-79, and the flash branch, ~line 92-94, use it.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @sim/physics test -- drying.test.ts -t "conserves energy"`
Expected: PASS.

- [ ] **Step 5: Run the load + drying suites; migrate**

Run: `pnpm --filter @sim/physics test -- load.test.ts drying.test.ts`
Migrate any temperature/water expectations that shift (the latent changed by <1 kJ/kg, so shifts are small). Report migrations. Keep the `load↔chamber water conservation` test passing (water mass is unchanged by this task).

- [ ] **Step 6: Commit**

```bash
git add packages/physics/src/load.ts packages/physics/test/integrator/drying.test.ts
git commit -m "feat(physics): load condensation/flash on common latent reference"
```

---

## Task 4: Jacket + generator outflow on the common reference

**Files:**
- Modify: `packages/physics/src/chamber.ts` (finish jacket T-solve from Task 2)
- Modify: `packages/physics/src/integrator.ts` (generator vapor inflow enthalpy)
- Test: `packages/physics/test/chamber.test.ts`, `packages/physics/test/integrator.test.ts`

- [ ] **Step 1: Write the failing jacket conservation test**

Add to `packages/physics/test/chamber.test.ts`:

```ts
describe('jacket_step — energy conservation with dripping condensate', () => {
  const jacket: ChamberParams = {
    V: 0.025, allowLiquid: false, wall_mass_kg: 15, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 100,
  };
  const wall_C = 15 * 500;

  it('condensing supersaturated vapor conserves energy: wall gain = latent, condensate leaves', () => {
    // Hot vapor supersaturated at a cool wall → condenses, drips out. Energy in the CV afterward
    // (gas + wall) plus the enthalpy carried out by the dripped condensate must equal the start.
    const s: ChamberState = { m_air: 0, m_vap: 0.01, m_liq: 0, T: C_to_K(160), T_wall: C_to_K(120) };
    const gas0 = vaporU(s.m_vap, s.T);
    const wall0 = wall_C * s.T_wall!;
    const next = chamber_step(s, jacket, noFlux(s.T), 0.05);
    const drippedMass = s.m_vap - next.m_vap; // condensate that left (m_liq stays 0 for jacket)
    const gas1 = vaporU(next.m_vap, next.T) ;
    const wall1 = wall_C * next.T_wall!;
    const drippedEnthalpy = drippedMass * CP_LIQ * next.T; // liquid leaves at CV temperature
    expect(gas1 + wall1 + drippedEnthalpy).toBeCloseTo(gas0 + wall0, 1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sim/physics test -- chamber.test.ts -t "dripping condensate"`
Expected: FAIL until the jacket T-solve is finished consistently.

- [ ] **Step 3: Finish the jacket path in `chamber.ts`**

Complete the `else` (jacket) branch left in Task 2 so it: solves `T` from `U_raw` on the latent basis with the current masses, condenses `m_vap` down to `m_vap_sat(T)`, sets `m_liq = 0` (drips out), and accounts the condensate leaving at `CP_LIQ·T`. The energy released by condensation is already inside `U_raw` (latent reference), so the resulting `T` reflects it; the wall exchange stays via the existing coupling. Make the Step-1 test pass. Concrete solve:

```ts
  } else {
    // Jacket: air + vapor; condensate drips out instantly (m_liq ≡ 0).
    // Solve T from U_raw with all current water as vapor, then condense supersaturation and
    // drop the condensate (its enthalpy leaves the CV).
    const m_w = m_vap; // liquid already 0 for jacket inputs
    const denomV = m_air * CV_AIR + m_w * CV_VAP;
    // U_raw includes m_w*U_FG0 (latent). Remove the latent offset to solve sensible T.
    T = denomV > 0 ? (U_raw - m_w * U_FG0) / denomV : s.T;
    T = Math.max(T_MIN_K, Math.min(T, T_MAX_K));
    const m_vap_sat = (p_sat_water(T) * p.V) / (R_VAP * T);
    if (m_w > m_vap_sat) {
      // condense excess; the condensate drips out carrying CP_LIQ*T; latent stays as gas warming
      // via the energy already in U_raw → re-solve T with reduced vapor mass and the condensate gone.
      const dm = m_w - m_vap_sat;
      const U_after = U_raw - dm * (CV_VAP * T + U_FG0) + 0; // vapor→(left as liquid drip): remove its U
      // condensate leaves at CP_LIQ*T; energy leaving = dm*CP_LIQ*T
      const U_left = U_after - dm * (CP_LIQ * T) + dm * (CV_VAP * T + U_FG0); // net: remove drip enthalpy
      const denom2 = m_air * CV_AIR + m_vap_sat * CV_VAP;
      T = denom2 > 0 ? (U_left - m_vap_sat * U_FG0) / denom2 : T;
      T = Math.max(T_MIN_K, Math.min(T, T_MAX_K));
      m_vap = m_vap_sat;
    } else {
      m_vap = m_w;
    }
    m_liq = 0;
  }
```

**Implementer note:** the bookkeeping above is the intended shape but is fiddly — iterate the exact terms against the Step-1 conservation test (`gas1 + wall1 + drippedEnthalpy == gas0 + wall0`). The invariant is: energy is conserved and the dripped condensate carries exactly `CP_LIQ·T` out. If the two-line re-solve is hard to get exact, an equivalent and cleaner route is a small bisection like the chamber path but with `m_liq` forced to 0 and the condensate enthalpy subtracted. Prefer whichever passes the test cleanly.

- [ ] **Step 4: Tag generator vapor inflow with the latent reference**

The generator's vapor entering the chamber/jacket is advected via `inflow_T` in the integrator accumulators (`acc.*.inflow_T_weighted`, consumed by `inflowT()` → `chamber_step`'s `f.inflow_T`). Since `chamber_step` now adds `U_FG0` to all vapor inflow (Task 2, Step 3), generator vapor automatically carries latent on entry — **verify** this is the case and that no double-add occurs (the generator's internal model must NOT also add `U_FG0`; it just emits mass at `up.T`). Read `integrator.ts` lines ~192-202 and confirm generator outflow contributes only mass + temperature to the downstream accumulator, and the latent is added exactly once, by the receiving `chamber_step`. Add a one-line comment at the generator-outflow site documenting that the latent is applied by the receiver.

- [ ] **Step 5: Run to verify jacket + generator conservation**

Run: `pnpm --filter @sim/physics test -- chamber.test.ts integrator.test.ts`
Expected: jacket conservation PASS; un-skip any jacket tests skipped in Task 2 and migrate their expectations. Report migrations.

- [ ] **Step 6: Commit**

```bash
git add packages/physics/src/chamber.ts packages/physics/src/integrator.ts packages/physics/test
git commit -m "feat(physics): jacket condensate + generator outflow on common latent reference"
```

---

## Task 5: Global conservation keystone + full-suite migration

**Files:**
- Create: `packages/physics/test/energy-conservation.test.ts`
- Migrate: any remaining failing tests across `packages/physics` and `apps/web`

- [ ] **Step 1: Write the global conservation test**

Create `packages/physics/test/energy-conservation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../src/integrator.js';
import { buildLoadState } from '../src/load.js';
import { vaporU } from '../src/energy.js';
import { p_sat_water } from '../src/saturation.js';
import { C_to_K, R_VAP, CV_AIR, CP_LIQ, GAMMA_AIR, R_AIR } from '../src/constants.js';

function params(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200 },
    jacket: { V: 0.025, allowLiquid: false, wall_mass_kg: 15, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 100 },
    generator: null,
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
    valves: {},
    external: { steam_line_pressure: 5e5, steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
    jacket_chamber_h_W_per_K: 150,
  };
}

// Total energy of the closed system on the common reference (gas + walls + load water/material).
function totalEnergy(s: SystemState, p: SystemParams): number {
  const cvE = (c: typeof s.chamber, wall_mass: number, wall_cp: number) =>
    c.m_air * CV_AIR * c.T + vaporU(c.m_vap, c.T) + c.m_liq * CP_LIQ * c.T +
    (c.T_wall !== undefined ? wall_mass * wall_cp * c.T_wall : 0);
  const chamber = cvE(s.chamber, 50, 500);
  const jacket = cvE(s.jacket, 15, 500);
  const load = s.load.nodes.reduce((a, n) => a + n.m_water * CP_LIQ * n.T + n.mass_kg * n.C_material * n.T, 0);
  return chamber + jacket + load;
}

describe('global energy conservation (closed system)', () => {
  it('total energy is constant with no valves, no heater, no jacket steam', () => {
    const p = params();
    p.jacket_chamber_h_W_per_K = 0; // isolate: no external drivers, purely internal relaxation
    const T = C_to_K(134);
    const load = buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], C_to_K(110));
    let s: SystemState = {
      chamber: { m_air: 1e-6, m_vap: (p_sat_water(T) * 0.15) / (R_VAP * T), m_liq: 0.01, T, T_wall: T },
      jacket: { m_air: 0, m_vap: 0.001, m_liq: 0, T: C_to_K(134), T_wall: C_to_K(134) },
      generator: null, load, f0_minutes: 0, time_s: 0,
    };
    const E0 = totalEnergy(s, p);
    for (let i = 0; i < 400; i++) s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.05);
    const E1 = totalEnergy(s, p);
    expect(Math.abs(E1 - E0) / Math.abs(E0)).toBeLessThan(1e-4); // <0.01% drift over 20 s
  });
});
```

**Implementer note:** `n.C_material` / `n.mass_kg` — read the actual `LoadNode` shape in `load.ts` and use whatever fields express the node's material heat capacity so `totalEnergy` reflects the load model's real energy. If a node stores `C` (J/K) directly, use that. The test's job is to sum the SAME energy the model integrates. Adjust the helper to match the real fields; keep the assertion (relative drift < 1e-4).

- [ ] **Step 2: Run to verify it fails or passes**

Run: `pnpm --filter @sim/physics test -- energy-conservation.test.ts`
Expected: PASS if Tasks 2-4 are consistent. If it FAILS, the drift localizes the remaining leak — trace which CV's energy jumps (log per-CV energy each step) and fix the offending transport term. Do not weaken the tolerance to pass; fix the accounting.

- [ ] **Step 3: Run the full physics suite and migrate**

Run: `pnpm --filter @sim/physics test`
Triage each failure: (a) shifted temperature/F0 expectation from the corrected energy → migrate to the new value with a one-line physical reason; (b) real regression → fix. F0 assertions: recompute the expected F0 from the corrected model (it was inflated before) — e.g. in `hardness.test.ts` and `scenarios/*.test.ts`, run the scenario, read the actual F0, and if the cycle is physically sensible set the expectation to it; if the cycle is NOT sensible, that's a real regression → report. Report the full migration list.

- [ ] **Step 4: Run the web suite and migrate**

Run: `pnpm --filter @sim/web test`
Migrate any scenario-runner expectations (e.g. `integration-ster-134`) that asserted old energy-dependent values. Report migrations. Structural failures → report.

- [ ] **Step 5: Commit**

```bash
git add packages/physics apps/web
git commit -m "test(physics): global energy-conservation keystone + suite migration"
```

---

## Task 6: Full gate + docs + TODO

**Files:**
- Modify: `packages/physics/docs/modelo-secagem-vacuo.md`
- Modify: `TODO.md`

- [ ] **Step 1: Full CI gate locally**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm generate && pnpm drift-check`
Expected: all green. (Known caveat: a pre-existing typecheck error may exist in `packages/physics/test/load.test.ts` on `master` — if `pnpm typecheck` reports ONLY that pre-existing error, note it and continue; if this branch introduced new type errors, fix them.) Run `pnpm format` if `format:check` fails.

- [ ] **Step 2: Document the energy reference**

In `packages/physics/docs/modelo-secagem-vacuo.md`, add a section recording the common enthalpy reference: the `U_FG0` constant, the reference state, that phase change is now mass-only via bisection, and that the global conservation test is the invariant guarding it. Link the spec + plan. Note this unblocks SP-B (the vapor-dominated chamber pin).

- [ ] **Step 3: Update TODO.md**

Add SP-A (common enthalpy reference) to `## Feito` with `2026-07-05`. Add SP-B (vapor-dominated chamber pin + 4 guards) to `## Pendente` with a one-line pointer to the chamber-two-phase spec §Q5 review findings.

- [ ] **Step 4: Commit**

```bash
git add packages/physics/docs/modelo-secagem-vacuo.md TODO.md
git commit -m "docs(physics): common enthalpy reference landed; SP-B pin is next"
```

---

## Self-Review notes

- **Spec coverage:** §1 reference/energies → Task 1; §2 mass-only phase → Task 2; §3 per-CV (chamber Task 2, load Task 3, generator/jacket Task 4); §4 data flow → Tasks 2-4; testing (global conservation) → Task 5; migration → Tasks 2-5.
- **Type consistency:** `U_FG0` (constants), `L_eff`/`vaporU` (energy.ts) defined in Task 1, consumed in Tasks 2-5. `chamberEnergy`/`totalEnergy` are test helpers.
- **Known implementer latitude:** the jacket T-solve (Task 4) and the exact load-node energy fields (Task 5 helper) are reconciled against conservation tests — this is deliberate TDD for a conservation refactor, with the invariant (energy constant) as the spec. The chamber path (Task 2) is fully specified.
- **Risk:** wide test migration in Task 5. Every migration must recompute the correct number, never weaken an invariant. F0 was inflated pre-fix; expect it to drop.
