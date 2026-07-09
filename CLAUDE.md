# simulador-autoclaves

Hardware-in-the-loop emulator for steam autoclaves: ESP32 (Modbus slave) + Next.js dashboard + thermodynamic model. pnpm@9 + turbo monorepo, Node ≥20, TypeScript, Vitest, ESLint, Prettier.

## Structure

- `packages/protocol` — **source of truth** for the Modbus register map. `registers.yaml` generates `dist/registers.ts` (TS) and `dist/registers.h` (C++), consumed by `apps/web` and the ESP32 firmware.
- `packages/physics` — standalone thermodynamic model (Antoine saturation, choked-flow valves, chamber/jacket/generator mass+energy balances, 2-mass load + testemunho, F0 lethality, integrator) plus a scenario CLI (YAML → CSV trace).
- `apps/web` — Next.js 14 App Router dashboard: virtual bridge, orchestrator tick loop, virtual PLC state machine, SSE snapshot stream, Recharts live page. **Dev/start on port 3030.**

## Commands

```bash
pnpm build | lint | typecheck | test | generate   # turbo, repo-wide
pnpm --filter @sim/<protocol|physics|web> <script> # single package
pnpm generate && pnpm drift-check                  # regen protocol + verify no drift
pnpm --filter @sim/web dev                          # dashboard on :3030
pnpm --filter @sim/web scenario:run <yaml> --out <csv>
```

## Invariants (do not break)

- **Never hand-edit `packages/protocol/dist/*`.** Edit `registers.yaml`, then `pnpm generate`. CI runs `drift-check` and fails on stale artifacts. Use the `protocol-register` skill for register changes.
- CI gate (`.github/workflows/ci.yml`): `format:check → lint → typecheck → test → drift-check`. Reproduce locally before pushing.
- Prettier is authoritative for formatting; a PostToolUse hook auto-formats edited files.
- Physics: keep SI units internally, prefer `constants.ts` over inline magic numbers. F0 references the load/testemunho temperature, not chamber gas.

## Workflow

- Keep root `TODO.md` current (`Em curso` / `Pendente` / `Feito` with ISO dates). Work is split into numbered sub-projetos SP1–SP9 (SP1–SP4 done; SP5 = ESP32 firmware is next).
- `.remember/` is a gitignored session buffer, not source.

## Helpers in this repo

- Agents: `physics-model-reviewer` (physical correctness of `packages/physics`), `protocol-consistency-reviewer` (TS↔C++ register parity).
- Skills: `protocol-register` (register change loop), `project-conventions` (background context).
- MCP (`.mcp.json`): `context7` (live library docs), `playwright` (dashboard UI testing).
