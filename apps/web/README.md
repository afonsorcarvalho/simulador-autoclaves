# @sim/web

Next.js app: orchestrator runtime + dashboard.

## Run a scenario (headless, virtual bridge)

```bash
# Phase history + final F0 only
pnpm --filter @sim/web scenario:run server/scenarios/ster-134-prevac.yaml

# Also dump CSV trace (paths relative to apps/web because pnpm sets cwd there)
pnpm --filter @sim/web scenario:run server/scenarios/ster-134-prevac.yaml --out out/trace.csv --sample-period 1.0

# Plot the trace (from project root)
python scripts/plot_trace.py apps/web/out/trace.csv --save scripts/orchestrator_trace.png --no-show
```

## Run tests

```bash
pnpm --filter @sim/web test
```

## Dev server (Dashboard MVP)

```bash
pnpm --filter @sim/web dev
# → http://localhost:3030  (port changed from default 3000 to avoid conflicts)
```

Override port via env:

```bash
PORT=4000 pnpm --filter @sim/web dev
# (Next.js -p flag in package.json wins unless overridden by env; pass -p explicitly to change.)
```
