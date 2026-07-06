# Chamber Temperature Control (bang-bang) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the chamber gas temperature within the EN 285 band (setpoint … setpoint+3 °C) during HOLD by (a) making the _plant_ faithful — the chamber must cool when its steam valve shuts — and (b) adding a reference bang-bang controller in the virtual PLC that the real external PLC will later replace over Modbus.

**Architecture:** HIL emulator. The emulator is the **plant** (physics + Modbus sensors/actuators); control is **external** (real PLC, connects in SP5). The bang-bang added here lives in the virtual PLC (`plc.ts`) as a swappable **reference/self-test controller** — NOT in the physics. The physics must honor `V_STEAM_IN_INT` as a plain actuator and respond faithfully (cool when it shuts) so any controller works. No `chamber.ts` pin.

**Tech Stack:** TypeScript, Vitest, pnpm+turbo. Physics `packages/physics`; controller + runtime `apps/web`.

**Spec:** `docs/superpowers/specs/2026-07-06-chamber-temperature-control-design.md`

**Branch:** create `feat/chamber-temp-control` off master.

---

## File Structure

| File                                                                  | Responsibility        | Change                                                                                      |
| --------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| `packages/physics/test/integrator/chamber-cooldown.test.ts` (**new**) | plant-fidelity gate   | chamber cools when steam valve shut                                                         |
| `apps/web/server/runtime/singleton.ts`                                | web plant config      | `V_STEAM_IN_INT` from `generator`→`jacket`; calibrate `wall_h`/`jacket_chamber_h` if needed |
| `packages/physics/scenarios/ster-134-prevac.yaml`                     | scenario plant config | chamber steam source `generator`→`jacket`                                                   |
| `apps/web/server/virtual-plc/state-machine.ts`                        | PLC sensor DTO        | add `T_chamber_C` to `PLCSensors`                                                           |
| `apps/web/server/virtual-plc/plc.ts`                                  | reference controller  | read `T_CHAMBER_INT`; chamber bang-bang (hysteresis) in PRESSURIZE/HOLD                     |
| `apps/web/test/virtual-plc/plc.test.ts`                               | controller unit test  | bang-bang open/close/hysteresis                                                             |
| `apps/web/test/scenario-runner/integration-ster-134.test.ts`          | end-to-end            | chamber in band, valve cycles, F0 sane, drying dip                                          |

---

## Task 1: Plant fidelity — chamber cools when the steam valve shuts (THE essential)

This is the make-or-break, controller-agnostic. If the plant can't cool the chamber when `V_STEAM_IN_INT` is shut, no controller (virtual or real PLC) can hold the band.

**Files:**

- Create: `packages/physics/test/integrator/chamber-cooldown.test.ts`
- Possibly modify (calibration only, if test fails): `packages/physics/src/*` config consumed by scenarios, via the test's params

- [ ] **Step 1: Write the failing test**

Create `packages/physics/test/integrator/chamber-cooldown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { buildLoadState } from '../../src/load.js';
import { p_sat_water } from '../../src/saturation.js';
import { C_to_K, K_to_C, R_VAP, R_AIR, GAMMA_AIR } from '../../src/constants.js';

// Plant only — no controller. Chamber slightly above setpoint (as if just fed a steam burst),
// steam-in valve SHUT, jacket hot (guard), load at setpoint. The chamber must COOL back down,
// otherwise a bang-bang controller can never hold the EN 285 band.
function holdParams(): SystemParams {
  return {
    chamber: {
      V: 0.15,
      allowLiquid: true,
      wall_mass_kg: 50,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 200,
    },
    jacket: {
      V: 0.025,
      allowLiquid: false,
      wall_mass_kg: 15,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 100,
    },
    generator: null,
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
    valves: {}, // V_STEAM_IN_INT SHUT: no chamber steam inflow at all
    external: { steam_line_pressure: 5e5, steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
    jacket_chamber_h_W_per_K: 150,
  };
}

describe('plant fidelity — chamber cools when steam valve is shut', () => {
  it('a chamber above setpoint cools back down with no steam inflow', () => {
    const SP = C_to_K(134);
    const T0 = C_to_K(135.5); // 1.5 °C above setpoint, as after a steam burst
    // Load + walls at/near setpoint; jacket hotter (guard). Chamber saturated at its T.
    const load = buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], SP);
    let s: SystemState = {
      chamber: {
        m_air: 1e-6,
        m_vap: (p_sat_water(T0) * 0.15) / (R_VAP * T0),
        m_liq: 0.02,
        T: T0,
        T_wall: C_to_K(135),
      },
      jacket: {
        m_air: 0,
        m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(138)),
        m_liq: 0,
        T: C_to_K(138),
        T_wall: C_to_K(138),
      },
      generator: null,
      load,
      f0_minutes: 0,
      time_s: 0,
    };
    const T_start = s.chamber.T;
    for (let i = 0; i < 1200; i++) {
      s = system_step(s, holdParams(), {}, { heater_gen: false, pump_vac: false }, 0.05); // 60 s, no valves
    }
    // Must cool (trend down), and must not sit above the EN 285 +3 band.
    expect(s.chamber.T).toBeLessThan(T_start); // cooled
    expect(K_to_C(s.chamber.T)).toBeLessThanOrEqual(134 + 3); // within band ceiling
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @sim/physics test -- chamber-cooldown.test.ts`
Record the result. If it PASSES, the plant already cools — skip to Step 4. If it FAILS (chamber held hot by the jacket-heated wall), go to Step 3.

- [ ] **Step 3: Calibrate so the chamber can cool (only if Step 2 failed)**

The chamber is held hot by the wall (jacket-heated via `jacket_chamber_h_W_per_K=150`, coupled to gas via `wall_h_W_per_K=200`). To let the gas cool toward the load (at setpoint) when steam is off, reduce the jacket→wall conduction and/or the wall→gas coupling so the load/relief path dominates. Try, in this order, re-running the test after each:

1. Lower `jacket_chamber_h_W_per_K` 150 → 80 in `holdParams()` (and later in the real configs). Rationale: less jacket heat into the chamber wall → wall settles nearer setpoint.
2. If still hot, lower chamber `wall_h_W_per_K` 200 → 120. Rationale: gas couples less to the (warmer) wall, more to the load.

**Guard against regressing SP-A:** after picking values, run `pnpm --filter @sim/physics test -- chamber.test.ts` — the vacuum-pulse damping test (`vacuum pulse does NOT crash T below freezing`) must still pass (it relies on wall thermal mass, not on `wall_h` being exactly 200; verify). If a value breaks it, back off toward the original and find the window that passes both. Document the chosen values with a `// ponytail:` comment naming them as the calibration that lets the chamber cool (plant fidelity) — hardware would tune these on the real vessel.

- [ ] **Step 4: Lock the calibration into the shared config**

Whatever `jacket_chamber_h_W_per_K` / `wall_h_W_per_K` values pass Step 2, set them as the defaults used by the real configs so the test and production agree. If defaults changed, update them in `packages/physics/src/cli.ts` (`jacket_chamber_h_W_per_K ?? <new>`) and `apps/web/server/runtime/singleton.ts` (`jacket_chamber_h_W_per_K: <new>`, chamber `wall_h_W_per_K: <new>`). If Step 2 passed with the originals, no change — note it.

- [ ] **Step 5: Run the physics suite**

Run: `pnpm --filter @sim/physics test`
Expected: all green (the new test + no SP-A regression). Migrate any shifted expectation only with a physical reason; a broken vacuum-pulse test means the calibration went too far — re-tune.

- [ ] **Step 6: Commit**

```bash
git add packages/physics
git commit -m "test(physics): plant fidelity — chamber cools when steam valve shut (+ calibration)"
```

---

## Task 2: Topology — chamber fed from the jacket, not the 148 °C generator

**Files:**

- Modify: `apps/web/server/runtime/singleton.ts` (~line 48)
- Modify: `packages/physics/scenarios/ster-134-prevac.yaml`

- [ ] **Step 1: Reroute the web runtime chamber steam source**

In `apps/web/server/runtime/singleton.ts`, the `V_STEAM_IN_INT` valve currently has `from: 'generator'`. Change to `from: 'jacket'`:

```ts
      V_STEAM_IN_INT: {
        from: 'jacket',
        to: 'chamber',
        params: { Cv: 8e-6, gamma: GAMMA_VAP, R: R_VAP },
      },
```

Keep the Cv at `8e-6` initially. The jacket is fed by the generator (`V_STEAM_IN_JACKET`), so the jacket is the chamber's steam buffer. The chamber source is now ≤ jacket temp (~138), not 148.

- [ ] **Step 2: Check the physics scenario topology**

Read `packages/physics/scenarios/ster-134-prevac.yaml`. If the chamber steam-in valve there is wired from the generator (or the scenario relies on the CLI default in `packages/physics/src/cli.ts` ~line 103 `V_STEAM_IN_INT`), change that source to `jacket` too, so standalone physics runs match. If the CLI hardcodes `from: 'generator'` for `V_STEAM_IN_INT`, change it to `'jacket'`.

- [ ] **Step 3: Run the affected suites**

Run: `pnpm --filter @sim/physics test && pnpm --filter @sim/web test`
Expected: green. The physics scenario tests assert inequalities (F0 ≥ 100) so they still pass; the chamber now tops out nearer the jacket (~138) instead of 148. If the jacket can't supply enough steam to the chamber (chamber never pressurizes / F0 drops below target), raise the `V_STEAM_IN_INT` Cv (e.g. 8e-6 → 1.5e-5) and/or the jacket feed Cv, and note it. If it structurally can't pressurize, STOP and report (may need a dedicated chamber steam path).

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/runtime/singleton.ts packages/physics/scenarios packages/physics/src/cli.ts
git commit -m "feat: chamber steam fed from jacket (source <= jacket temp, not 148C generator)"
```

---

## Task 3: Reference controller — chamber temperature bang-bang in the virtual PLC

**Files:**

- Modify: `apps/web/server/virtual-plc/state-machine.ts` (`PLCSensors`)
- Modify: `apps/web/server/virtual-plc/plc.ts`
- Test: `apps/web/test/virtual-plc/plc.test.ts`

**Background:** `plc.ts` `commandsFor(PRESSURIZE|HOLD)` returns `V_STEAM_IN_INT: true` always. Replace with a bang-bang on chamber temperature: open when `T_chamber < SP + 0.1`, close when `T_chamber > SP + 0.5`, hold state in between (hysteresis). `SP = cycle.sterilization_T_C`. This is the reference controller the real PLC replaces.

- [ ] **Step 1: Add `T_chamber_C` to `PLCSensors`**

In `apps/web/server/virtual-plc/state-machine.ts`, extend the interface:

```ts
export interface PLCSensors {
  P_chamber_bar: number;
  T_chamber_C: number;
  T_test_C: number;
  P_jacket_bar: number;
  F0_min: number;
}
```

(If the state machine's phase-transition logic doesn't need `T_chamber_C`, that's fine — it's read by the PLC's controller. Leave state-machine transition logic unchanged.)

- [ ] **Step 2: Write the failing controller test**

Add to `apps/web/test/virtual-plc/plc.test.ts` (follow the file's existing harness for constructing a `VirtualPLC` with a fake bridge; if the file mocks `RegisterAccess`/bridge, reuse that). The test drives the chamber-temp bang-bang directly. If the PLC's bang-bang is extracted as a pure helper (recommended), test the helper:

```ts
import { chamberValveBangBang } from '../../server/virtual-plc/plc.js';

describe('chamber steam valve bang-bang', () => {
  const SP = 134;
  it('opens below SP+0.1', () => {
    expect(chamberValveBangBang(133.9, SP, false)).toBe(true);
    expect(chamberValveBangBang(134.05, SP, false)).toBe(true); // < SP+0.1 → open
  });
  it('closes above SP+0.5', () => {
    expect(chamberValveBangBang(134.6, SP, true)).toBe(false);
  });
  it('holds previous state in the hysteresis band [SP+0.1, SP+0.5]', () => {
    expect(chamberValveBangBang(134.3, SP, true)).toBe(true); // was open → stay open
    expect(chamberValveBangBang(134.3, SP, false)).toBe(false); // was closed → stay closed
  });
});
```

- [ ] **Step 3: Run it**

Run: `pnpm --filter @sim/web test -- plc.test.ts -t "bang-bang"`
Expected: FAIL — `chamberValveBangBang` not exported.

- [ ] **Step 4: Implement the bang-bang + wire it in**

In `apps/web/server/virtual-plc/plc.ts`, add the pure helper (exported for testing) above the class:

```ts
/** Chamber steam-valve bang-bang (reference controller; the real PLC replaces this over Modbus).
 *  Open below SP+0.1, close above SP+0.5, hold previous state in between (hysteresis). */
export function chamberValveBangBang(
  T_chamber_C: number,
  SP_C: number,
  prevOpen: boolean,
): boolean {
  if (T_chamber_C < SP_C + 0.1) return true;
  if (T_chamber_C > SP_C + 0.5) return false;
  return prevOpen; // hysteresis band → hold
}
```

Store the setpoint + previous valve state on the class. In the constructor, capture `this.setpoint_C = cycle.sterilization_T_C;` (add `private setpoint_C: number;` and `private chamberValveOpen = false;` fields). Add `T_chamber_C` to `readSensors`:

```ts
  private async readSensors(): Promise<PLCSensors> {
    return {
      P_chamber_bar: await this.access.getAnalog('P_CHAMBER_INT'),
      T_chamber_C: await this.access.getAnalog('T_CHAMBER_INT'),
      T_test_C: await this.access.getAnalog('T_TESTEMUNHO'),
      P_jacket_bar: await this.access.getAnalog('P_CHAMBER_EXT'),
      F0_min: (await this.access.getAnalog('F0_X10')) / 10,
    };
  }
```

The bang-bang needs the current sensor reading, so compute the chamber valve state in `tick` after reading sensors and pass it into `commandsFor`. Change `tick`:

```ts
  async tick(time_s: number): Promise<void> {
    this.lastTickTime_s = time_s;
    const sensors = await this.readSensors();
    this.sm.update(time_s, sensors);
    // Reference controller: chamber steam valve bang-bang on chamber temperature.
    this.chamberValveOpen = chamberValveBangBang(sensors.T_chamber_C, this.setpoint_C, this.chamberValveOpen);
    const setpoints = this.commandsFor(this.sm.phase, this.chamberValveOpen);
    await this.applyValves(setpoints);
  }
```

Change `commandsFor` to take the chamber-valve state and use it in PRESSURIZE/HOLD:

```ts
  private commandsFor(phase: CyclePhase, chamberValveOpen: boolean): ValveSetpoints {
    switch (phase) {
      // ... unchanged cases ...
      case 'PRESSURIZE':
      case 'HOLD':
        return { V_STEAM_IN_JACKET: true, V_STEAM_IN_INT: chamberValveOpen, HEATER_GEN: true };
      // ... unchanged cases ...
    }
  }
```

(Leave PREVAC_STEAM as `V_STEAM_IN_INT: true` — that phase fills the chamber, not band-holding.)

- [ ] **Step 5: Run the controller test + web PLC suite**

Run: `pnpm --filter @sim/web test -- plc.test.ts`
Expected: bang-bang tests PASS. Migrate any existing plc.test.ts expectation that assumed `V_STEAM_IN_INT` always-on in HOLD, with a one-line reason (now bang-banged). Report migrations.

- [ ] **Step 6: Commit**

```bash
git add apps/web/server/virtual-plc apps/web/test/virtual-plc
git commit -m "feat(web): chamber temperature bang-bang in virtual PLC (reference controller)"
```

---

## Task 4: End-to-end — EN 285 band, valve cycles, F0, drying dip

**Files:**

- Modify: `apps/web/test/scenario-runner/integration-ster-134.test.ts`

- [ ] **Step 1: Add the band + cycling assertions**

Read the existing `integration-ster-134.test.ts` to see how it runs the closed-loop cycle and samples state. Add assertions over the HOLD window (identify HOLD samples by phase or time):

```ts
// EN 285: every chamber-temperature sample during HOLD sits in [SP, SP+3].
const SP = 134;
const holdSamples = samples.filter((s) => s.phase === 'HOLD');
expect(holdSamples.length).toBeGreaterThan(0);
for (const s of holdSamples) {
  expect(s.T_chamber_C).toBeGreaterThanOrEqual(SP - 0.5); // at/above setpoint (small undershoot ok)
  expect(s.T_chamber_C).toBeLessThanOrEqual(SP + 3); // EN 285 ceiling
}
// The chamber steam valve must CYCLE (bang-bang), not sit always-open.
const chamberValveStates = new Set(holdSamples.map((s) => s.V_STEAM_IN_INT));
expect(chamberValveStates.size).toBe(2); // both open and closed occur during HOLD
```

Adapt field names (`T_chamber_C`, `phase`, `V_STEAM_IN_INT`) to what the test's sample/snapshot actually exposes — read the snapshot shape (`apps/web/server/runtime/snapshot.ts`) and the test's existing sampling. If the sample doesn't carry the chamber valve state or phase, extend the sampling to capture them (from the snapshot / register bridge).

- [ ] **Step 2: Run it**

Run: `pnpm --filter @sim/web test -- integration-ster-134`
Expected: PASS. If the band assertion fails (chamber still exceeds SP+3), the plant isn't cooling fast enough between bursts — revisit Task 1 calibration or lower the `V_STEAM_IN_INT` Cv so each burst is smaller. If the valve never closes (always-open), the bang-bang isn't wired — revisit Task 3. Report which.

- [ ] **Step 3: Keep the F0 + existing assertions green**

Confirm the existing `integration-ster-134` F0 assertion (`≥ 100`) still holds and the cycle completes. F0 is on the testemunho and should now be _more_ realistic (chamber no longer superheated). If F0 dropped below the target because the chamber runs cooler/正确, check the hold duration is sufficient; do not weaken the F0 floor without confirming the cycle is physically sensible — report if it can't reach F0.

- [ ] **Step 4: Drive the dashboard and screenshot (visual confirmation)**

Start the dev server (`pnpm --filter @sim/web dev`, port 3030), navigate to `/`, click "Start ster-134-prevac", go to `/live`, wait until phase reaches HOLD, screenshot. Confirm visually: chamber temperature trace sits in the band near 134 (not ~145), and the chamber valve toggles. (Use the run/playwright flow.) Save the screenshot to the scratchpad, not the repo.

- [ ] **Step 5: Commit**

```bash
git add apps/web/test/scenario-runner/integration-ster-134.test.ts
git commit -m "test(web): EN 285 chamber band + valve cycling end-to-end"
```

---

## Task 5: Full gate + docs + TODO

**Files:**

- Modify: `packages/physics/docs/modelo-secagem-vacuo.md`
- Modify: `TODO.md`

- [ ] **Step 1: Full CI gate**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm generate && pnpm drift-check`
Expected: all green. Run `pnpm format` if `format:check` fails, then re-check.

- [ ] **Step 2: Document SP-B**

In `packages/physics/docs/modelo-secagem-vacuo.md`, add a short section: the chamber band is held by a temperature bang-bang in the _controller_ (virtual PLC), not the physics; the plant was made faithful (chamber cools when the steam valve shuts, calibration values X/Y); chamber steam fed from the jacket; real PLC replaces the reference controller over Modbus (SP5). Record the EN 285 band result and any residual.

- [ ] **Step 3: Update TODO.md**

Move SP-B to `## Feito` with `2026-07-06` and a one-line summary (bang-bang controller + plant fidelity + topology + EN 285 band held). Note the real-PLC-swap is SP5. Keep the open physics-model-reviewer findings + the jacket liquid-inflow caveat.

- [ ] **Step 4: Commit**

```bash
git add packages/physics/docs/modelo-secagem-vacuo.md TODO.md
git commit -m "docs: chamber temperature control (SP-B) landed; real PLC swap is SP5"
```

---

## Self-Review notes

- **Spec coverage:** plant fidelity (§Objetivo essential, §5 risk) → Task 1; topology → Task 2; reference controller / bang-bang law (§1) → Task 3; architecture separation (controller in PLC, plant agnostic) → Tasks 1/3; EN 285 band + drying dip + F0 → Task 4; docs/TODO → Task 5.
- **Type consistency:** `chamberValveBangBang(T_chamber_C, SP_C, prevOpen)` defined Task 3, used in its test; `PLCSensors.T_chamber_C` added Task 3; `commandsFor(phase, chamberValveOpen)` signature changed consistently.
- **Known calibration knobs (hardware reality):** `jacket_chamber_h_W_per_K`, chamber `wall_h_W_per_K` (Task 1), `V_STEAM_IN_INT` Cv (Task 2). All flagged; real values tuned against the fidelity + band tests, not guessed.
- **Risk:** Task 1 is the gate — if the chamber can't be made to cool when the valve shuts within a calibration window that keeps SP-A green, stop and reconsider (the spec's fallback: reduce jacket→gas coupling further, or reintroduce a saturation clamp as a safety net). Report before forcing.
- **Architecture guard:** the bang-bang is ONLY in `plc.ts` (controller). Do NOT add a chamber thermostat to the physics valve model — the real PLC must be able to drive `V_STEAM_IN_INT` over Modbus without a plant-side override.
