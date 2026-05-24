# @sim/physics

Standalone thermodynamic model of a steam autoclave (chamber + jacket + steam generator + thermal load). Lumped parameter, gas+vapor+liquid mass balances, saturation handling (Antoine), F0 accumulation.

Used by `apps/web` (Next.js orchestrator) and by the scenario-runner CLI.

## Run a scenario

```bash
pnpm --filter @sim/physics scenario scenarios/ster-134-prevac.yaml out/trace.csv
```

## Run tests

```bash
pnpm --filter @sim/physics test
```

## Status (V1)

- 57 vitest tests pass (parser, valve, F0, chamber, generator, load, integrator, CSV, 3 integration scenarios: 121°C gravity, 134°C prevac, drying).
- Physics is **lumped + qualitatively realistic**, not certified to any norm.

## Known limitation: CLI demo is open-loop

The `scenarios/*.yaml` files describe time-triggered valve sequences without feedback control. The physical model is calibrated for **condensation regime** (`h_gas_metal = 500 W/K`), which makes the load track the chamber temperature in ~20 s. Without closed-loop control over steam injection, an open-loop YAML will overshoot setpoint and produce nonsensical F0 (10^14+ minutes).

This is **by design** — the realistic closed-loop PID (open/close steam valve based on chamber T or P setpoint) belongs to the orchestrator (sub-projeto 3, `apps/web/server/model/orchestrator.ts`). The CLI is useful for inspecting model dynamics (open the CSV in any spreadsheet to see pressure/temperature/F0 traces) and for validating individual phases, not for end-to-end cycle replay.

The integration tests in `test/scenarios/*.test.ts` exercise the same physics with short pulse durations + endpoint-only assertions, so they pass without closed-loop control.

## Physical model summary

- **Saturation**: Antoine equation for water (P_sat in 0..200°C, error <2% vs IAPWS).
- **Valve**: compressible orifice (choked + subsonic regimes).
- **Chamber**: gas+vapor+liquid CV with mass+energy balance, saturation clipping, condensation (releases latent heat), evaporation (absorbs latent heat).
- **Generator**: pressure-vessel pool boiling — saturation temperature tracks vapor pressure as it builds.
- **Load**: 2-mass cascade (metal → fabric/witness sensor) with configurable convective+conductive coupling.
- **F0**: lethality integral `Σ 10^((T - 121.1) / 10) · dt / 60` (T in °C), only above 100°C.

## API surface

```typescript
import {
  system_step, // one Euler tick (state, params, valves, actuators, dt) → next state
  type SystemState,
  type SystemParams,
  type ValveCommands,
  type ActuatorCommands,
  chamber_pressure,
  generator_pressure, // derived quantities
  F0Accumulator,
  CsvTrace,
} from '@sim/physics';
```

All functions are pure (no module-level mutable state) → re-entrant, deterministic, parallel-safe.

## Coverage

98% statements / 88% branches / 100% functions (vitest --coverage).
