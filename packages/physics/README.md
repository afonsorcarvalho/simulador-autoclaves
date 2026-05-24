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
