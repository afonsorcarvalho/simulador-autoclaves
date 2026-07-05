# Câmara bifásica (vapor saturado) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the chamber gas to `T_sat(P)` while two phases coexist, routing latent heat + jacket conduction to the wall, so the drying dip appears end-to-end (fecha o bloqueador §8b).

**Architecture:** In `chamber_step` (only for `allowLiquid=true`), replace the rate-based evaporation block and the liquid-branch condensation loop with a single **equilibrium partition**: condense/evaporate chamber water toward saturation with the latent heat exchanged against the **wall** (25 000 J/K — stable, no near-vacuum spikes), then clamp the gas temperature to `T_sat(p_vap)` while liquid remains, depositing the sensible surplus into the wall. Jacket conduction is rerouted from the gas to the wall via a new `Q_wall_external` flux. The jacket path (`allowLiquid=false`) is untouched. Chamber relief rises 3.04 → 3.2 bar so saturated steam can reach 134 °C.

**Tech Stack:** TypeScript, Vitest, pnpm+turbo monorepo. Physics in `packages/physics`, config in `apps/web` + scenario YAML.

**Spec:** `docs/superpowers/specs/2026-07-05-chamber-two-phase-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/physics/src/chamber.ts` | chamber/jacket CV step | add `Q_wall_external` flux → wall; new two-phase equilibrium block (allowLiquid); remove old evap block + allowLiquid condensation |
| `packages/physics/src/integrator.ts` | system wiring | line ~262: chamber `Q_external = -Q_load`; `Q_wall_external = Q_jacket_to_chamber` |
| `apps/web/server/runtime/singleton.ts` | live runtime params | chamber relief 3.04 → 3.2 bar |
| `packages/physics/scenarios/ster-134-prevac.yaml` | scenario config | `chamber_relief_bar` 3.04 → 3.2 + header comment |
| `packages/physics/test/chamber.test.ts` | chamber unit tests | add two-phase pin / bidirectional / degenerate tests; migrate evaporation + condensation expectations |
| `packages/physics/test/integrator/drying.test.ts` | integration | keep dip assertion; add gas-saturation assertion |

Import note: `chamber.ts` currently inlines the Antoine `p_sat` in several places. The new block should use the existing helpers `p_sat_water`, `T_sat_water`, `h_vap_water` from `./saturation.js` (already imported: `p_sat_water`, `h_vap_water`; add `T_sat_water`).

---

## Task 1: Route jacket conduction to the wall (`Q_wall_external`)

**Files:**
- Modify: `packages/physics/src/chamber.ts` (interface `ChamberFluxes` ~line 48; wall block ~line 128-157)
- Test: `packages/physics/test/chamber.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/physics/test/chamber.test.ts` inside a new describe block:

```ts
describe('chamber_step — Q_wall_external heats the wall', () => {
  const walled: ChamberParams = {
    V: 0.15, allowLiquid: true, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200,
  };

  it('external wall heat raises T_wall, not applied to the gas directly', () => {
    const s: ChamberState = { m_air: 0.18, m_vap: 0, m_liq: 0, T: C_to_K(100), T_wall: C_to_K(100) };
    const f: ChamberFluxes = {
      inflow: zeroFlow(), inflow_T: s.T, outflow: zeroFlow(),
      Q_external: 0, Q_wall_external: 25000, // 25 kW into the 25 kJ/K wall → +1 K/s
    };
    const next = chamber_step(s, walled, f, 1);
    expect(next.T_wall!).toBeGreaterThan(s.T_wall!); // wall warmed
    expect(next.T_wall!).toBeCloseTo(C_to_K(100) + 1, 0); // ≈ +1 K (25000 J / 25000 J/K), minus gas coupling
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sim/physics test -- chamber.test.ts -t "Q_wall_external"`
Expected: FAIL — `Q_wall_external` not in `ChamberFluxes`, wall unaffected.

- [ ] **Step 3: Add the field to `ChamberFluxes`**

In `packages/physics/src/chamber.ts`, add to the `ChamberFluxes` interface (after `Q_external`):

```ts
  /** External heat delivered to the WALL (W, positive = into wall). E.g. jacket→chamber
   *  conduction. Kept separate from Q_external so it never superheats the near-vacuum gas. */
  Q_wall_external?: number;
```

- [ ] **Step 4: Apply `Q_wall_external` to the wall inside the coupling block**

In the wall coupling block (`if (wall_C > 0 && wall_h > 0) {`), after computing `T_wall` from the implicit relax (both the `gas_C > 0` and `else` branches), add the external wall heat. Simplest: right before the block, seed the wall from the external flux, or add after. Insert immediately after the `if (wall_C > 0 && wall_h > 0) { ... }` block closes:

```ts
  // External heat straight into the wall (jacket conduction) — added after gas↔wall relax.
  const Q_wall_ext = f.Q_wall_external ?? 0;
  if (wall_C > 0 && Q_wall_ext !== 0) {
    T_wall = (T_wall ?? s.T_wall ?? s.T) + (Q_wall_ext * dt) / wall_C;
    if (T_wall > T_MAX_K) T_wall = T_MAX_K;
    if (T_wall < T_MIN_K) T_wall = T_MIN_K;
  }
```

(`wall_C`, `T_wall`, `T_MAX_K`, `T_MIN_K` are all already in scope from the coupling block.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @sim/physics test -- chamber.test.ts -t "Q_wall_external"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/physics/src/chamber.ts packages/physics/test/chamber.test.ts
git commit -m "feat(physics): Q_wall_external flux routes heat to chamber wall"
```

---

## Task 2: Two-phase equilibrium partition + saturation pin

**Files:**
- Modify: `packages/physics/src/chamber.ts` (import; replace evap block ~160-178; fork condensation loop ~180-220)
- Test: `packages/physics/test/chamber.test.ts`

**Background:** Today, for `allowLiquid`, §3.5 evaporates at rate `k_evap` and §4 condenses excess into the liquid heating the *gas* (floor 500 J/K → spikes at vacuum). Replace both with an equilibrium block that exchanges latent with the *wall* and pins gas T to `T_sat`. The `!allowLiquid` (jacket) branch of §4 stays exactly as is.

- [ ] **Step 1: Write the failing tests**

Add to `packages/physics/test/chamber.test.ts`:

```ts
import { p_sat_water, T_sat_water } from '../src/saturation.js';

describe('chamber_step — two-phase saturation pin', () => {
  const walled: ChamberParams = {
    V: 0.15, allowLiquid: true, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200,
  };
  const m_vap_sat = (T: number) => (p_sat_water(T) * 0.15) / (461.5 * T);

  it('pins gas to T_sat(p_vap) while liquid is present, even when the wall is hotter', () => {
    // Liquid present, wall hot (140°C) trying to superheat the gas. Gas must stay saturated.
    const T = C_to_K(134);
    const s: ChamberState = {
      m_air: 1e-6, m_vap: m_vap_sat(T), m_liq: 0.05, T, T_wall: C_to_K(140),
    };
    let cur = s;
    for (let i = 0; i < 200; i++) cur = chamber_step(cur, walled, noFlux(cur.T), 0.05);
    // p_vap from the vapor present; gas T must equal its saturation temperature (±1°C).
    const p_vap = Math.min((cur.m_vap * 461.5 * cur.T) / 0.15, p_sat_water(cur.T));
    expect(cur.T).toBeCloseTo(T_sat_water(p_vap), 0);
    expect(cur.T).toBeLessThan(C_to_K(140)); // never reached the hot wall
    expect(cur.m_liq).toBeGreaterThan(0); // still two-phase
  });

  it('conserves total water mass (m_vap + m_liq) across a step', () => {
    const T = C_to_K(120);
    const s: ChamberState = { m_air: 0, m_vap: 0.02, m_liq: 0.01, T, T_wall: T };
    const next = chamber_step(s, walled, noFlux(T), 0.05);
    expect(next.m_vap + next.m_liq).toBeCloseTo(s.m_vap + s.m_liq, 8);
  });

  it('degenerate m_liq=0 supersaturated: condenses to saturation, no 220°C ceiling', () => {
    // Near-vacuum, no liquid, vapor above saturation → must condense (latent to wall), stay saturated.
    const T = C_to_K(60);
    const s: ChamberState = { m_air: 0, m_vap: 0.02, m_liq: 0, T, T_wall: T };
    const next = chamber_step(s, walled, noFlux(T), 0.05);
    expect(next.m_liq).toBeGreaterThan(0); // condensed
    expect(next.T).toBeLessThan(C_to_K(100)); // NOT slammed to the 220°C ceiling
  });

  it('no NaN under a hard vacuum pump-down with liquid present', () => {
    const T = C_to_K(90);
    const s: ChamberState = { m_air: 1e-6, m_vap: 0.001, m_liq: 0.02, T, T_wall: T };
    const f: ChamberFluxes = {
      inflow: zeroFlow(), inflow_T: T, outflow: { air: 0, vap: 0.01, liq: 0 }, Q_external: 0,
    };
    let cur = s;
    for (let i = 0; i < 500; i++) cur = chamber_step(cur, walled, f, 0.05);
    expect(Number.isFinite(cur.T)).toBe(true);
    expect(Number.isFinite(cur.m_vap)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sim/physics test -- chamber.test.ts -t "two-phase saturation pin"`
Expected: FAIL — gas superheats toward the wall / hits ceiling (old behavior).

- [ ] **Step 3: Add the `T_sat_water` import**

At the top of `packages/physics/src/chamber.ts`, extend the saturation import:

```ts
import { p_sat_water, h_vap_water, T_sat_water } from './saturation.js';
```

- [ ] **Step 4: Replace the evaporation block (§3.5) and the allowLiquid condensation with the equilibrium block**

Delete the entire `// 3.5. Evaporation` block (currently ~lines 160-178).

In the `// 4. Saturation / condensation loop`, keep it **only for the jacket** (`!allowLiquid`). Replace the whole `for` loop (lines ~180-220) with:

```ts
  // 4. Phase equilibrium.
  if (!p.allowLiquid) {
    // Jacket: condensate drips out, latent to the wall (unchanged behaviour).
    for (let iter = 0; iter < 3; iter++) {
      const p_sat = p_sat_water(T);
      const m_vap_max = (p_sat * p.V) / (R_VAP * T);
      if (m_vap <= m_vap_max + 1e-9) break;
      const dm_cond = m_vap - m_vap_max;
      m_vap = m_vap_max;
      if (dm_cond > 0) {
        const Q_lat = dm_cond * h_vap_water(T);
        if (T_wall !== undefined && wall_C > 0) {
          T_wall += Q_lat / wall_C;
          if (T_wall > T_MAX_K) T_wall = T_MAX_K;
        } else {
          const denom = Math.max(m_air * CV_AIR + m_vap * CV_VAP, MIN_HEAT_CAP_JK);
          T += Q_lat / denom;
          if (T > T_MAX_K) T = T_MAX_K;
        }
      }
      break;
    }
  } else {
    // Chamber: two-phase equilibrium partition. Latent exchanged with the WALL (large,
    // stable heat capacity), gas pinned to T_sat while liquid remains. Replaces the
    // rate-based k_evap + gas-heating condensation that spiked at near-vacuum.
    // ponytail: uses h_vap at current T as the latent constant; the wall buffer makes the
    // scheme robust to that approximation. Tune wall_h_W_per_K / wall_mass_kg for real hardware.
    const wallOK = T_wall !== undefined && wall_C > 0;
    const m_vap_sat = (p_sat_water(T) * p.V) / (R_VAP * T);

    if (m_vap > m_vap_sat) {
      // Supersaturated → condense excess to saturation; latent to the wall (or gas floor).
      const dm = m_vap - m_vap_sat;
      m_vap = m_vap_sat;
      m_liq += dm;
      const Q_lat = dm * h_vap_water(T);
      if (wallOK) T_wall! += Q_lat / wall_C;
      else T += Q_lat / Math.max(m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ, MIN_HEAT_CAP_JK);
    } else if (m_liq > 0 && m_vap < m_vap_sat) {
      // Sub-saturated with liquid → evaporate toward saturation; latent drawn FROM the wall.
      const dm = Math.min(m_liq, m_vap_sat - m_vap);
      m_vap += dm;
      m_liq -= dm;
      const Q_lat = dm * h_vap_water(T);
      if (wallOK) T_wall! -= Q_lat / wall_C;
      else T -= Q_lat / Math.max(m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ, MIN_HEAT_CAP_JK);
    }

    // Pin: while liquid remains, the gas cannot exceed its saturation temperature. Clamp T to
    // T_sat(p_vap) and deposit the sensible surplus/deficit into the wall (energy-conserving).
    if (m_liq > 0) {
      const p_vap = (m_vap * R_VAP * T) / p.V;
      const T_sat = T_sat_water(p_vap);
      const gas_C = m_air * CV_AIR + m_vap * CV_VAP + m_liq * CP_LIQ;
      if (wallOK) T_wall! += (gas_C * (T - T_sat)) / wall_C;
      T = T_sat;
    }

    if (T_wall !== undefined) {
      if (T_wall > T_MAX_K) T_wall = T_MAX_K;
      if (T_wall < T_MIN_K) T_wall = T_MIN_K;
    }
    T = Math.max(T_MIN_K, Math.min(T, T_MAX_K));
  }
```

Note: `T_wall` may be `undefined` in the `wallOK=false` fallback; the `T_wall! +=` lines only run when `wallOK` is true, so the non-null assertion is safe.

- [ ] **Step 5: Run the two-phase tests**

Run: `pnpm --filter @sim/physics test -- chamber.test.ts -t "two-phase saturation pin"`
Expected: PASS (all four).

- [ ] **Step 6: Run the whole chamber suite; migrate the two stale expectations**

Run: `pnpm --filter @sim/physics test -- chamber.test.ts`

Two existing tests assert the *old* rate-based behavior and will need updated expectations:

1. `chamber_step — evaporation › evaporates liquid when sub-saturated` (line ~128): the equilibrium block reaches saturation in one step instead of over 6000 steps. Still true that `m_liq` drops and `m_vap` rises. Keep the assertions — they should still pass. If the loop count now over-evaporates to `m_liq=0`, tighten the initial `m_liq` or lower the loop count; the assertions `m_liq < 0.05` and `m_vap > 0` remain valid.

2. `chamber_step — condensation › condenses vapor and releases latent heat when oversaturated` (line ~113) uses `params150L` (no wall). With no wall, the fallback gas-floor path runs. Assertions (`m_liq > 0`, `m_vap` drops) still hold. Verify; adjust only if the no-wall fallback changed the sign.

Fix any failing expectation to match the equilibrium behavior (document the physical reason in a comment). Do NOT weaken a test to pass — if a real assertion breaks, the block is wrong.

- [ ] **Step 7: Commit**

```bash
git add packages/physics/src/chamber.ts packages/physics/test/chamber.test.ts
git commit -m "feat(physics): two-phase equilibrium partition pins chamber gas to T_sat"
```

---

## Task 3: Rewire the integrator (jacket conduction → wall)

**Files:**
- Modify: `packages/physics/src/integrator.ts` (~line 258-264)
- Test: `packages/physics/test/integrator/drying.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/physics/test/integrator/drying.test.ts`:

```ts
describe('jacket conduction reaches the chamber wall, not the gas', () => {
  it('with a hot jacket and liquid in the chamber, the gas stays near T_sat (not superheated)', () => {
    const p = params(); // jacket_chamber_h_W_per_K = 150
    const T = C_to_K(134);
    const load = buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], T);
    let s: SystemState = {
      chamber: { m_air: 1e-6, m_vap: (p_sat_water(T) * 0.15) / (R_VAP * T), m_liq: 0.05, T, T_wall: T },
      jacket: { m_air: 0, m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(140)), m_liq: 0, T: C_to_K(140), T_wall: C_to_K(140) },
      generator: null, load, f0_minutes: 0, time_s: 0,
    };
    for (let i = 0; i < 400; i++) {
      s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.05);
    }
    const p_vap = Math.min((s.chamber.m_vap * R_VAP * s.chamber.T) / 0.15, p_sat_water(s.chamber.T));
    // Gas within a couple of °C of its saturation temperature — NOT dragged to the 140°C jacket.
    expect(Math.abs(s.chamber.T - T_sat_water(p_vap))).toBeLessThan(3);
    expect(s.chamber.T).toBeLessThan(C_to_K(139));
  });
});
```

Add `T_sat_water` to the existing saturation import at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sim/physics test -- drying.test.ts -t "reaches the chamber wall"`
Expected: FAIL — jacket conduction currently heats the gas (`Q_external`), superheating it toward 140 °C.

- [ ] **Step 3: Reroute the conduction in `integrator.ts`**

In `packages/physics/src/integrator.ts`, change the `chamberFluxes` object (~line 258-264):

```ts
  const chamberFluxes: ChamberFluxes = {
    inflow: speciesIn(acc.chamber),
    inflow_T: inflowT(acc.chamber, state.chamber.T),
    outflow: speciesOut(acc.chamber),
    Q_external: -Q_load, // loses heat to the load only
    Q_wall_external: Q_jacket_to_chamber, // jacket conduction heats the WALL, not the gas
    wall_coupling_scale: rho_gas_chamber / RHO_GAS_ATM_REF,
  };
```

(The jacket side at line ~272 is unchanged — it still loses `-Q_jacket_to_chamber` from its own gas; energy leaves the jacket gas and enters the chamber wall, which is physically consistent.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sim/physics test -- drying.test.ts -t "reaches the chamber wall"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/physics/src/integrator.ts packages/physics/test/integrator/drying.test.ts
git commit -m "feat(physics): route jacket→chamber conduction to the wall not the gas"
```

---

## Task 4: Raise chamber relief to 3.2 bar

**Files:**
- Modify: `apps/web/server/runtime/singleton.ts` (~line 30)
- Modify: `packages/physics/scenarios/ster-134-prevac.yaml` (line 12-13 comment, line 24)

- [ ] **Step 1: Update the scenario YAML**

In `packages/physics/scenarios/ster-134-prevac.yaml`:
- Line 13 comment: `#   P_chamber  = 3.04 bar abs (134 °C sat)` → `#   P_chamber  = 3.2 bar abs (~134 °C sat, Antoine model)`
- Line 24: `chamber_relief_bar: 3.04` → `chamber_relief_bar: 3.2`

Rationale (add as a comment above line 24):

```yaml
  # 3.2 bar: with the chamber gas pinned to saturation, reaching 134 °C at the witness
  # needs p_sat(134 °C) ≈ 3.09 bar (this model's Antoine). 3.2 bar gives margin.
  chamber_relief_bar: 3.2
```

- [ ] **Step 2: Update the live runtime singleton**

In `apps/web/server/runtime/singleton.ts` (~line 30):

```ts
      relief_pressure_Pa: bar_to_Pa(3.2),
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/server/runtime/singleton.ts packages/physics/scenarios/ster-134-prevac.yaml
git commit -m "chore(physics): chamber relief 3.04 -> 3.2 bar for saturated 134 C"
```

---

## Task 5: End-to-end — drying dip appears + gas stays saturated

**Files:**
- Modify: `packages/physics/test/integrator/drying.test.ts` (extend the `vacuum drying` test)
- Verify: full ster-134 scenario green

- [ ] **Step 1: Strengthen the drying integration test**

Extend the existing `vacuum drying › cools the witness by evaporative flash` test in `drying.test.ts` — after the loop, add gas-saturation assertions:

```ts
    // Gas must have stayed at/below saturation throughout (never superheated toward the wall).
    const p_vap = Math.min((s.chamber.m_vap * R_VAP * s.chamber.T) / 0.15, p_sat_water(s.chamber.T));
    expect(s.chamber.T).toBeLessThanOrEqual(T_sat_water(p_vap) + 1);
```

- [ ] **Step 2: Run the physics suite**

Run: `pnpm --filter @sim/physics test`
Expected: PASS. If `hardness.test.ts` or `scenarios/drying.test.ts` assert an old superheated-gas number, update the expectation to the saturated value and comment the physical reason. Do not weaken a genuine F0/lethality assertion — F0 references the witness node, which is unaffected by the gas fix except that it should now dip in drying.

- [ ] **Step 3: Run the full scenario end-to-end and inspect the trace**

Run: `pnpm --filter @sim/physics scenario:run scenarios/ster-134-prevac.yaml --out /tmp/ster134.csv`

Then verify from the CSV (spot-check, not an automated assert):
- During HOLD (t ≈ 700–1300 s): chamber gas T within ~1–2 °C of `T_sat(p_chamber)` (was +24 °C).
- During DRY (t ≥ 1450 s): witness T **dips** as `m_water_load` → 0 (the ~0.38 kg flash), instead of rising.
- Cycle reaches STER / F0 accumulates and completes (does not stall in PRESSURIZE).

If the cycle stalls in PRESSURIZE (witness never crosses 134): confirm `chamber_relief_bar` is 3.2 and that `p_sat(134°C)` in this model is ≤ 3.2 bar. If it still stalls, the relief may need +0.05 bar — this is the pressure calibration knob; adjust and re-run.

- [ ] **Step 4: Run the web scenario-runner integration test**

Run: `pnpm --filter @sim/web test -- integration-ster-134`
Expected: PASS (may need the same expectation migration if it asserts gas temperature during hold).

- [ ] **Step 5: Commit**

```bash
git add packages/physics/test packages/physics/scenarios apps/web
git commit -m "test(physics): drying dip appears + chamber gas stays saturated end-to-end"
```

---

## Task 6: Full gate + docs + TODO

**Files:**
- Modify: `packages/physics/docs/modelo-secagem-vacuo.md` (§8b closure note)
- Modify: `TODO.md`

- [ ] **Step 1: Run the full CI gate locally**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm generate && pnpm drift-check`
Expected: all green. Fix anything red before proceeding. (Prettier auto-formats on edit; run `pnpm format` if `format:check` fails.)

- [ ] **Step 2: Close out §8b in the drying doc**

In `packages/physics/docs/modelo-secagem-vacuo.md`, append a short note under §8b.1 recording that the two-phase sub-project landed: equilibrium partition + wall-routed latent + relief 3.2 bar → gas saturated (dT≈0) and drying dip visible end-to-end. Link the spec + plan.

- [ ] **Step 3: Update TODO.md**

Move the "câmara bifásica" item to `## Feito` with date `2026-07-05`. Note any follow-ups discovered (e.g. pressure knob value, jacket saturation if revisited).

- [ ] **Step 4: Commit**

```bash
git add packages/physics/docs/modelo-secagem-vacuo.md TODO.md
git commit -m "docs(physics): chamber two-phase landed; drying dip proven end-to-end"
```

---

## Self-Review notes

- **Spec coverage:** §1 core → Task 2; §2 conduction routing → Tasks 1+3; §3 pressure → Task 4; §5 tests → Tasks 2/3/5; acceptance (gas dT≈0 + drying dip) → Task 5.
- **Type consistency:** `Q_wall_external?: number` on `ChamberFluxes` defined in Task 1, consumed in Task 3. `T_sat_water` imported in Tasks 2 (chamber) and 3/5 (tests). `m_vap_sat` is a local, recomputed per scope (not shared).
- **Known knobs (hardware/calibration):** `chamber_relief_bar` (pressure to reach 134 °C), `wall_h_W_per_K` / `wall_mass_kg` (wall buffer stiffness), latent constant `h_vap_water(T)`. All flagged with `ponytail:` / rationale comments.
