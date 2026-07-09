# Chamber Temperature Control (bang-bang) Implementation Plan — rev. 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the chamber genuinely controllable so it holds the EN 285 band (setpoint … setpoint+3 °C) during HOLD under any controller. Rev. 1 assumed the plant already cooled; Task 1 proved it pins to `T_sat(relief)=135.5 °C` with no loss path. Rev. 2 adds the real-machine loss paths (ambient loss + condensate drain + relief-as-safety-cap) as the foundation, then a reference bang-bang controller in the virtual PLC that the real external PLC replaces over Modbus.

**Architecture:** HIL emulator. Emulator = plant (physics + Modbus I/O); control = external (real PLC, SP5). The bang-bang lives in `plc.ts` as a swappable reference controller, NOT in the physics. The plant must let the chamber fall below setpoint when the steam valve shuts (via losses), so any controller can regulate it.

**Tech Stack:** TypeScript, Vitest, pnpm+turbo.

**Spec:** `docs/superpowers/specs/2026-07-06-chamber-temperature-control-design.md` (rev. 2)

**Branch:** `feat/chamber-temp-control` (current).

---

## Status

- **Task 1 (DONE, commit 4581c4c):** `chamber-cooldown.test.ts` gates the CURRENT plant equilibrium — chamber pins to ~135.5 °C (in band ≤137, >134) when the valve is shut, documenting that without loss paths it cannot fall to setpoint. This test is STRENGTHENED in Task 4 once losses land (chamber must then fall below setpoint).

---

## Task 2: Chamber ambient heat loss

**Files:**

- Modify: `packages/physics/src/chamber.ts` (ChamberParams + apply loss to wall/gas) OR `integrator.ts` (add `-Q_ambient` to chamber `Q_external`). Prefer integrator (keeps `chamber_step` generic).
- Modify: `packages/physics/src/integrator.ts`
- Test: `packages/physics/test/integrator/chamber-cooldown.test.ts`

- [ ] **Step 1: Write the failing test** — add to `chamber-cooldown.test.ts`:

```ts
describe('chamber ambient heat loss', () => {
  it('with ambient loss enabled, a starved chamber loses more heat than without', () => {
    // Same shut-valve HOLD state, compare end T with vs without ambient loss.
    const SP = C_to_K(134);
    const mk = (h_ambient: number): SystemState => ({
      chamber: {
        m_air: 1e-6,
        m_vap: (p_sat_water(SP) * 0.15) / (R_VAP * SP),
        m_liq: 0.02,
        T: SP,
        T_wall: SP,
      },
      jacket: {
        m_air: 0,
        m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(138)),
        m_liq: 0,
        T: C_to_K(138),
        T_wall: C_to_K(138),
      },
      generator: null,
      load: buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], SP),
      f0_minutes: 0,
      time_s: 0,
    });
    const run = (h_ambient: number) => {
      const p = {
        ...holdParams(),
        chamber: { ...holdParams().chamber, h_ambient_W_per_K: h_ambient },
      } as SystemParams;
      let s = mk(h_ambient);
      for (let i = 0; i < 2000; i++)
        s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.05);
      return s.chamber.T;
    };
    expect(run(50)).toBeLessThan(run(0) - 0.5); // ambient loss cools the chamber measurably more
  });
});
```

- [ ] **Step 2: Run → FAIL** (`h_ambient_W_per_K` unknown): `pnpm --filter @sim/physics test -- chamber-cooldown.test.ts -t "ambient heat loss"`.

- [ ] **Step 3: Implement.** Add to `ChamberParams` (chamber.ts): `/** Ambient heat-loss coefficient (W/K) from chamber wall/gas to atmosphere. Default 0 (back-compat). */ h_ambient_W_per_K?: number;`. In `integrator.ts`, compute `const Q_ambient_chamber = (params.chamber.h_ambient_W_per_K ?? 0) * (state.chamber.T - params.external.atmosphere_T);` and subtract it from the chamber `Q_external`: `Q_external: -Q_load + Q_comp_load - Q_ambient_chamber,`. (ponytail: ambient loss is a calibration knob — the real vessel's door/penetration losses; tune to the band later.)

- [ ] **Step 4: Run → PASS.** Then full physics suite `pnpm --filter @sim/physics test` — green (default 0 = back-compat, no scenario shift).

- [ ] **Step 5: Commit** `git add packages/physics && git commit -m "feat(physics): chamber ambient heat-loss term (controllability)"`

---

## Task 3: Condensate drain (chamber depressurizes when starved)

**Files:**

- Modify: `packages/physics/src/integrator.ts` (drain outflow) + `chamber.ts` if needed
- Modify: `apps/web/server/runtime/singleton.ts` + `packages/physics/src/cli.ts` (wire `V_DRAIN_INT` / passive trap)
- Test: `packages/physics/test/integrator/chamber-cooldown.test.ts`

**Approach:** model a passive condensate trap — a small continuous chamber-liquid outflow to drain (removes `m_liq` + its enthalpy). This sheds condensate and lets pressure fall when steam is off. Simplest: a `chamber.drain_kg_per_s` param applied as chamber `outflow.liq` in the integrator, capped at available `m_liq`.

- [ ] **Step 1: Write the failing test** — add:

```ts
describe('condensate drain', () => {
  it('drains chamber liquid over time when a trap rate is set', () => {
    const SP = C_to_K(134);
    const p = {
      ...holdParams(),
      chamber: { ...holdParams().chamber, drain_kg_per_s: 1e-4 },
    } as SystemParams;
    let s: SystemState = {
      chamber: {
        m_air: 1e-6,
        m_vap: (p_sat_water(SP) * 0.15) / (R_VAP * SP),
        m_liq: 0.05,
        T: SP,
        T_wall: SP,
      },
      jacket: {
        m_air: 0,
        m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(138)),
        m_liq: 0,
        T: C_to_K(138),
        T_wall: C_to_K(138),
      },
      generator: null,
      load: buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], SP),
      f0_minutes: 0,
      time_s: 0,
    };
    const liq0 = s.chamber.m_liq;
    for (let i = 0; i < 2000; i++)
      s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.05);
    expect(s.chamber.m_liq).toBeLessThan(liq0); // condensate drained out
  });
});
```

- [ ] **Step 2: Run → FAIL** (`drain_kg_per_s` unknown).

- [ ] **Step 3: Implement.** Add `ChamberParams.drain_kg_per_s?: number` (default 0). In `integrator.ts`, add to the chamber accumulator a liquid outflow `acc.chamber.liq_out += Math.min(params.chamber.drain_kg_per_s ?? 0, state.chamber.m_liq / dt)` (drain leaves as liquid to system boundary — not re-added to any CV; it exits like valve outflow). Ensure `speciesOut(acc.chamber)` carries `liq`. Verify the drained liquid's enthalpy (`CP_LIQ·T`) leaves via `H_out` (it does — liquid outflow is in the energy balance). ponytail: passive trap rate is a knob.

- [ ] **Step 4: Run → PASS + full physics suite green** (default 0 = back-compat).

- [ ] **Step 5: Commit** `git add packages/physics && git commit -m "feat(physics): chamber condensate drain (passive trap)"`

---

## Task 4: Relief → safety cap; controllability gate (chamber falls below setpoint)

**Files:**

- Modify: `apps/web/server/runtime/singleton.ts` (chamber relief 3.2 → 3.4 bar; set `h_ambient_W_per_K`, `drain_kg_per_s`)
- Modify: `packages/physics/src/cli.ts` + `packages/physics/scenarios/ster-134-prevac.yaml` (same)
- Modify: `packages/physics/test/integrator/chamber-cooldown.test.ts` (strengthen)

- [ ] **Step 1: Strengthen the controllability test.** Replace the Task-1 durable-equilibrium assertion so it now requires the chamber to fall BELOW setpoint when the valve is shut, WITH losses+drain enabled at the production values:

```ts
it('with losses + drain, a starved chamber falls below setpoint (controllable)', () => {
  const SP = C_to_K(134);
  const p = {
    ...holdParams(),
    chamber: {
      ...holdParams().chamber,
      h_ambient_W_per_K: H_AMB,
      drain_kg_per_s: DRAIN,
      relief_pressure_Pa: 3.4e5,
    },
  } as SystemParams;
  let s: SystemState = {
    /* saturated at SP, valve shut, jacket 138 (as above) */
  };
  for (let i = 0; i < 4000; i++)
    s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.05); // 200 s
  expect(K_to_C(s.chamber.T)).toBeLessThan(134 - 0.1); // fell below SP → controller would reopen
});
```

- [ ] **Step 2: Calibrate `H_AMB` / `DRAIN`** so the starved chamber falls below setpoint within ~200 s but not absurdly fast (a few °C over minutes). Start `h_ambient_W_per_K ≈ 30`, `drain_kg_per_s ≈ 5e-5`; increase until the test passes. Record the values. These become the production defaults.

- [ ] **Step 3: Raise the relief to a safety cap.** In singleton.ts + cli.ts + scenario yaml, chamber relief 3.2 → 3.4 bar (safety only). Set the calibrated `h_ambient_W_per_K` / `drain_kg_per_s` in those configs. ponytail comments naming them as vessel-calibration knobs.

- [ ] **Step 4: Run** `pnpm --filter @sim/physics test` — the controllability test passes; migrate the old Task-1 equilibrium assertion (now superseded — chamber falls below SP). Ensure SP-A + scenario tests green; if a scenario now drifts (drain/losses shift F0), migrate inequality expectations only with reason, or tune the knobs. Report.

- [ ] **Step 5: Commit** `git add packages/physics apps/web && git commit -m "feat: chamber loss calibration + relief as safety cap; chamber now falls below setpoint when starved"`

---

## Task 5: Topology — chamber fed from the jacket

**Files:** `apps/web/server/runtime/singleton.ts`, `packages/physics/src/cli.ts`, scenario yaml.

- [ ] **Step 1:** Change `V_STEAM_IN_INT` `from: 'generator'` → `from: 'jacket'` in singleton.ts (and the CLI/scenario chamber steam source). Keep Cv 8e-6 initially.
- [ ] **Step 2:** Run `pnpm --filter @sim/physics test && pnpm --filter @sim/web test`. The chamber source is now ≤ jacket temp. If the jacket can't supply the chamber (F0 below target / never pressurizes), raise `V_STEAM_IN_INT` Cv (8e-6 → 1.5e-5) and note it. Structural failure → report.
- [ ] **Step 3: Commit** `git add apps/web packages/physics && git commit -m "feat: chamber steam fed from jacket (source <= jacket temp)"`

---

## Task 6: Reference controller — chamber temperature bang-bang in the virtual PLC

**Files:** `apps/web/server/virtual-plc/state-machine.ts` (`PLCSensors`), `apps/web/server/virtual-plc/plc.ts`, `apps/web/test/virtual-plc/plc.test.ts`.

- [ ] **Step 1: Add `T_chamber_C` to `PLCSensors`** in state-machine.ts:

```ts
export interface PLCSensors {
  P_chamber_bar: number;
  T_chamber_C: number;
  T_test_C: number;
  P_jacket_bar: number;
  F0_min: number;
}
```

- [ ] **Step 2: Write the failing controller test** in `plc.test.ts`:

```ts
import { chamberValveBangBang } from '../../server/virtual-plc/plc.js';
describe('chamber steam valve bang-bang', () => {
  const SP = 134;
  it('opens below SP+0.1', () => {
    expect(chamberValveBangBang(133.9, SP, false)).toBe(true);
  });
  it('closes above SP+0.5', () => {
    expect(chamberValveBangBang(134.6, SP, true)).toBe(false);
  });
  it('holds previous in the band', () => {
    expect(chamberValveBangBang(134.3, SP, true)).toBe(true);
    expect(chamberValveBangBang(134.3, SP, false)).toBe(false);
  });
});
```

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implement.** In `plc.ts` add the exported pure helper:

```ts
/** Chamber steam-valve bang-bang (reference controller; real PLC replaces this over Modbus).
 *  Open below SP+0.1, close above SP+0.5, hold in between (hysteresis). */
export function chamberValveBangBang(
  T_chamber_C: number,
  SP_C: number,
  prevOpen: boolean,
): boolean {
  if (T_chamber_C < SP_C + 0.1) return true;
  if (T_chamber_C > SP_C + 0.5) return false;
  return prevOpen;
}
```

Add `private setpoint_C = cycle.sterilization_T_C;` and `private chamberValveOpen = false;` fields. Add `T_chamber_C: await this.access.getAnalog('T_CHAMBER_INT'),` to `readSensors`. In `tick`, after reading sensors: `this.chamberValveOpen = chamberValveBangBang(sensors.T_chamber_C, this.setpoint_C, this.chamberValveOpen);` and pass into `commandsFor(phase, this.chamberValveOpen)`. In `commandsFor`, PRESSURIZE/HOLD return `V_STEAM_IN_INT: chamberValveOpen` (instead of `true`).

- [ ] **Step 5: Run** `pnpm --filter @sim/web test -- plc.test.ts` — bang-bang tests pass; migrate any always-open-in-HOLD assumption with a reason.

- [ ] **Step 6: Commit** `git add apps/web && git commit -m "feat(web): chamber temperature bang-bang in virtual PLC (reference controller)"`

---

## Task 7: End-to-end — EN 285 band, valve cycles, F0, drying dip, dashboard

**Files:** `apps/web/test/scenario-runner/integration-ster-134.test.ts`.

- [ ] **Step 1: Add band + cycling assertions** over the HOLD window (adapt field names to the snapshot shape):

```ts
const SP = 134;
const hold = samples.filter((s) => s.phase === 'HOLD');
expect(hold.length).toBeGreaterThan(0);
for (const s of hold) {
  expect(s.T_chamber_C).toBeGreaterThanOrEqual(SP - 1); // near/at setpoint
  expect(s.T_chamber_C).toBeLessThanOrEqual(SP + 3); // EN 285 ceiling
}
expect(new Set(hold.map((s) => s.V_STEAM_IN_INT)).size).toBe(2); // valve cycles
```

- [ ] **Step 2: Run** `pnpm --filter @sim/web test -- integration-ster-134`. If the band fails (chamber > SP+3), tune the loss knobs (Task 4) / lower `V_STEAM_IN_INT` Cv (smaller bursts). If the valve never cycles, the bang-bang isn't wired (Task 6). If chamber never reaches SP, the jacket can't supply it (Task 5 Cv). Report which lever you used.

- [ ] **Step 3: Keep F0 + drying dip.** Confirm F0 ≥ target still holds (now realistic) and the witness dips in DRY (chamber saturated → load wetted come-up → flashes). If F0 dropped, verify hold duration; don't weaken the floor without confirming the cycle is sensible — report.

- [ ] **Step 4: Dashboard visual.** Start dev (`pnpm --filter @sim/web dev`, 3030), Start ster-134-prevac, /live, wait for HOLD, screenshot to scratchpad. Confirm chamber trace in band near 134 + valve toggling. Stop the server after.

- [ ] **Step 5: Commit** `git add apps/web && git commit -m "test(web): EN 285 chamber band + valve cycling end-to-end"`

---

## Task 8: Full gate + docs + TODO

- [ ] **Step 1: Full gate** `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm generate && pnpm drift-check` — all green (`pnpm format` if needed).
- [ ] **Step 2: Docs** — in `packages/physics/docs/modelo-secagem-vacuo.md`, add SP-B section: band held by a controller (virtual PLC, real PLC replaces it via Modbus SP5); plant made controllable via ambient loss + condensate drain + relief-as-safety-cap (values X/Y/Z); chamber fed from jacket; EN 285 band result. Record why coupling calibration alone failed (saturation pin).
- [ ] **Step 3: TODO.md** — SP-B → Feito (2026-07-06) with the loss-path + controller summary; note real-PLC swap is SP5; keep the open physics-model-reviewer findings + jacket liquid-inflow caveat.
- [ ] **Step 4: Commit** `git add packages/physics/docs TODO.md && git commit -m "docs: chamber temperature control (SP-B) landed; real PLC swap is SP5"`

---

## Self-Review notes

- **Spec coverage (rev.2):** loss-path foundation (§Achado, §2) → Tasks 2/3/4; controllability (chamber falls below SP) → Task 4; topology → Task 5; reference controller/bang-bang → Task 6; EN 285 band + drying dip + F0 → Task 7; docs/TODO → Task 8. Task 1 (committed) documents the pre-loss plant; Task 4 strengthens it.
- **Type consistency:** `h_ambient_W_per_K`, `drain_kg_per_s` on `ChamberParams` (Tasks 2/3); `chamberValveBangBang(T,SP,prev)` + `PLCSensors.T_chamber_C` + `commandsFor(phase, open)` (Task 6).
- **Calibration knobs (hardware reality):** `h_ambient_W_per_K`, `drain_kg_per_s`, chamber relief (safety cap), `V_STEAM_IN_INT` Cv. All TDD-tuned against the controllability + band tests, flagged `ponytail:`.
- **Architecture guard:** bang-bang ONLY in `plc.ts` (controller). Loss paths are plant (controller-agnostic). The real PLC drives `V_STEAM_IN_INT` over Modbus with no plant-side override.
- **Risk:** Task 4 calibration must make the chamber fall below SP while keeping SP-A + scenarios green. If losses that achieve controllability break drying/F0 scenarios, tune or migrate with reason; escalate if irreconcilable.
