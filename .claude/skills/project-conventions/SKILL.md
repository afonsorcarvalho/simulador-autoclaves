---
name: project-conventions
description: Background conventions for the simulador-autoclaves monorepo (pnpm+turbo, packages/protocol + packages/physics + apps/web). Load when working anywhere in this repo so commands, structure, and the drift-check invariant are respected.
user-invocable: false
---

# simulador-autoclaves — conventions

Hardware-in-the-loop emulator for steam autoclaves: ESP32 + Next.js + thermodynamic model. pnpm@9 + turbo monorepo, Node ≥20, TypeScript, Vitest, ESLint, Prettier.

## Layout
- `packages/protocol` — Modbus register map. `registers.yaml` is the source of truth; generates `dist/registers.ts` (TS) + `dist/registers.h` (C++). Consumed by `apps/web` and the future ESP32 firmware.
- `packages/physics` — standalone thermodynamic model (saturation, valves/choked flow, chamber/jacket/generator balances, load + testemunho, F0, integrator) + a scenario CLI (YAML in, CSV trace out).
- `apps/web` — Next.js 14 App Router dashboard: virtual bridge, orchestrator tick loop, virtual PLC, SSE snapshot stream, Recharts live page. Dev/start on **port 3030**.

## Commands (always target the workspace)
- Per-package: `pnpm --filter @sim/<protocol|physics|web> <script>`.
- Repo-wide via turbo: `pnpm build | lint | typecheck | test | generate`.
- Regenerate protocol: `pnpm generate`; verify no drift: `pnpm drift-check`.
- Scenario run: `pnpm --filter @sim/web scenario:run <yaml> --out <csv>` (physics CLI similar).

## Invariants
- **Never hand-edit `packages/protocol/dist/*`** — regenerate from `registers.yaml`. CI's `drift-check` fails on stale artifacts. Use the `protocol-register` skill for register changes.
- CI gate (`.github/workflows/ci.yml`): format:check → lint → typecheck → test → drift-check. Match it locally before pushing.
- Prettier is authoritative for formatting (a PostToolUse hook auto-formats on edit).
- Physics changes: prefer constants from `constants.ts` over inline magic numbers; keep SI units internally. For correctness audits dispatch the `physics-model-reviewer` agent.

## Workflow
- Keep `TODO.md` at the repo root current (Em curso / Pendente / Feito with ISO dates). Work is organised as numbered sub-projetos (SP1–SP9); SP1–SP4 done, SP5 = ESP32 firmware next.
- Session history buffer lives in `.remember/` (gitignored) — not source.
