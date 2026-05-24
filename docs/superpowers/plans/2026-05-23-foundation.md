# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo skeleton + the shared protocol package (`packages/protocol`) that generates Modbus register definitions for both TypeScript (backend/frontend) and C++ (ESP32 firmware) from a single YAML source of truth, with CI that prevents drift.

**Architecture:** pnpm workspaces + Turborepo monorepo at the project root. `packages/protocol` consumes `registers.yaml`, validates with zod, emits `dist/registers.ts` (TypeScript const + types) and `dist/registers.h` (C preprocessor defines). GitHub Actions runs lint + typecheck + tests on every PR, plus a "drift check" that re-runs the generator and fails if `dist/` differs from committed output.

**Tech Stack:** Node.js 20+, pnpm 9 (via corepack), TypeScript 5, Turborepo 2, vitest 2, zod 3, js-yaml, tsx, prettier, eslint.

---

## File Structure

Project root: the repository root (paths below are relative to it).

```
SIMULADOR DE AUTOCLAVES/
├── .editorconfig
├── .gitignore
├── .prettierrc.json
├── eslint.config.mjs
├── package.json                       # workspaces root, scripts
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── README.md
├── TODO.md                            # project task tracker
├── .github/
│   └── workflows/
│       └── ci.yml
├── docs/
│   └── superpowers/
│       ├── specs/                     # already contains the design spec
│       └── plans/                     # this file lives here
└── packages/
    └── protocol/
        ├── package.json
        ├── tsconfig.json
        ├── vitest.config.ts
        ├── README.md
        ├── registers.yaml             # single source of truth
        ├── src/
        │   ├── schema.ts              # zod schema for the YAML structure
        │   ├── parser.ts              # parse + cross-validate
        │   ├── emit-ts.ts             # TypeScript emitter
        │   ├── emit-cpp.ts            # C++ header emitter
        │   ├── cli.ts                 # CLI entry (called by `pnpm generate`)
        │   └── index.ts               # re-export types
        ├── test/
        │   ├── parser.test.ts
        │   ├── emit-ts.test.ts
        │   ├── emit-cpp.test.ts
        │   └── cli.test.ts
        └── dist/                      # gitignored except registers.ts/.h
            ├── registers.ts           # committed (drift-checked)
            └── registers.h            # committed (drift-checked)
```

### File responsibilities

| File                                | One-line responsibility                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `package.json` (root)               | workspace declaration, top-level scripts (`build`, `lint`, `test`, `generate`, `drift-check`)  |
| `pnpm-workspace.yaml`               | tells pnpm which subdirs are workspaces                                                        |
| `turbo.json`                        | pipeline (build depends on generate; test depends on build)                                    |
| `tsconfig.base.json`                | strict TypeScript config inherited by all packages                                             |
| `packages/protocol/registers.yaml`  | SoT — every Modbus register declared once                                                      |
| `packages/protocol/src/schema.ts`   | zod schema for YAML structure; produces inferred TS types                                      |
| `packages/protocol/src/parser.ts`   | parses YAML, runs cross-cutting validation (duplicate addresses, range membership, gaps, etc.) |
| `packages/protocol/src/emit-ts.ts`  | pure function `Register[] → string` (TS code)                                                  |
| `packages/protocol/src/emit-cpp.ts` | pure function `Register[] → string` (C header)                                                 |
| `packages/protocol/src/cli.ts`      | reads `registers.yaml`, runs parser + emitters, writes `dist/`                                 |
| `.github/workflows/ci.yml`          | install → typecheck → lint → test → generate → drift check                                     |

---

## Task 1: Initialize project root + gitignore + git

**Files:**

- Create: `.gitignore`
- Create: `.editorconfig`
- Verify: git already initialized (status shown in environment)

- [ ] **Step 1.1: Verify git state**

Run: `git status` (from project root)
Expected: branch master, no commits yet, untracked `.remember/` and possibly other files. Acceptable.

- [ ] **Step 1.2: Write `.gitignore`**

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build output
dist/
.next/
.turbo/
build/
out/
*.tsbuildinfo

# Test output
coverage/
.vitest-cache/

# OS / editor
.DS_Store
Thumbs.db
.vscode/
.idea/
*.swp

# Logs
*.log
logs/
.remember/logs/

# Env
.env
.env.local
.env.*.local

# Runtime
~/.simulador-autoclaves/
```

Note: `dist/` is ignored globally. We force-include the two artifacts in `packages/protocol/dist/` via `!packages/protocol/dist/registers.ts` and `!packages/protocol/dist/registers.h` below.

Append to `.gitignore`:

```gitignore

# Force-include generated protocol artifacts (drift-checked in CI)
!packages/protocol/dist/
packages/protocol/dist/*
!packages/protocol/dist/registers.ts
!packages/protocol/dist/registers.h
```

- [ ] **Step 1.3: Write `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false

[*.{yaml,yml}]
indent_size = 2

[*.{c,cpp,h,hpp,ino}]
indent_size = 2

[Makefile]
indent_style = tab
```

- [ ] **Step 1.4: Commit**

```bash
git add .gitignore .editorconfig
git commit -m "chore: add gitignore and editorconfig"
```

Expected: 2 files committed, first commit on `master`.

---

## Task 2: TypeScript base config + prettier

**Files:**

- Create: `tsconfig.base.json`
- Create: `.prettierrc.json`
- Create: `.prettierignore`

- [ ] **Step 2.1: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 2.2: Write `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

- [ ] **Step 2.3: Write `.prettierignore`**

```
node_modules/
dist/
.next/
.turbo/
coverage/
packages/protocol/dist/registers.ts
packages/protocol/dist/registers.h
.remember/
```

- [ ] **Step 2.4: Commit**

```bash
git add tsconfig.base.json .prettierrc.json .prettierignore
git commit -m "chore: add typescript base config and prettier"
```

---

## Task 3: pnpm workspaces + Turborepo root

**Files:**

- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`

- [ ] **Step 3.1: Enable corepack and pin pnpm**

Run: `corepack enable`
Run: `corepack prepare pnpm@9.12.0 --activate`
Expected: pnpm 9.12.0 available. Verify with `pnpm --version`.

- [ ] **Step 3.2: Write root `package.json`**

```json
{
  "name": "simulador-autoclaves",
  "version": "0.1.0",
  "private": true,
  "description": "Hardware-in-the-loop emulator for steam autoclaves (ESP32 + Next.js + thermodynamic model)",
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=20.10.0"
  },
  "scripts": {
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "generate": "turbo run generate",
    "drift-check": "pnpm generate && git diff --exit-code packages/protocol/dist",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "turbo": "^2.1.0",
    "typescript": "^5.5.0",
    "prettier": "^3.3.0",
    "eslint": "^9.10.0",
    "@types/node": "^20.16.0"
  }
}
```

- [ ] **Step 3.3: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'tools/*'
```

- [ ] **Step 3.4: Write `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "generate": {
      "inputs": ["registers.yaml", "src/**", "package.json"],
      "outputs": ["dist/**"],
      "cache": true
    },
    "build": {
      "dependsOn": ["^generate", "^build"],
      "inputs": ["src/**", "package.json", "tsconfig.json"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "typecheck": {
      "dependsOn": ["^generate"],
      "inputs": ["src/**", "test/**", "package.json", "tsconfig.json", "../../tsconfig.base.json"]
    },
    "lint": {
      "inputs": ["src/**", "test/**", "eslint.config.mjs", "package.json"]
    },
    "test": {
      "dependsOn": ["^generate"],
      "inputs": ["src/**", "test/**", "vitest.config.ts", "package.json"]
    }
  }
}
```

- [ ] **Step 3.5: Install root devDependencies**

Run: `pnpm install`
Expected: `node_modules/` created, lockfile written, turbo + typescript + prettier + eslint installed.

- [ ] **Step 3.6: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json pnpm-lock.yaml
git commit -m "chore: initialize pnpm workspaces and turborepo"
```

Note: do NOT add `node_modules` (already gitignored).

---

## Task 4: TODO.md + README.md

**Files:**

- Create: `TODO.md`
- Create: `README.md`

- [ ] **Step 4.1: Write `TODO.md`**

```markdown
# TODO

## Em curso

- Sub-projeto 1 — Foundation (monorepo + packages/protocol + CI)

## Pendente

- Sub-projeto 2 — Modelo físico standalone (packages/physics: saturação, valve, chamber, jacket, generator, load, f0 + testes)
- Sub-projeto 3 — Orchestrator + virtual bridge + scenario runner (cenário 134°C verde)
- Sub-projeto 4 — Dashboard MVP (live + virtual-plc + equipment CRUD + WS)
- Sub-projeto 5 — Firmware ESP32 + Modbus slave (I/O + watchdog + fast model)
- Sub-projeto 6 — Injeção de falhas (hooks orchestrator + UI faults + cenários)
- Sub-projeto 7 — Placa condicionamento KiCad (schematic + PCB + BOM)
- Sub-projeto 8 — PLC-in-loop aceitação (PLC real, ajustes finais, QA arquivada)
- Sub-projeto 9 — Mímico SVG + cycles history + replay

## Feito

(vazio)
```

- [ ] **Step 4.2: Write `README.md`**

````markdown
# Simulador de Autoclaves

Hardware-in-the-loop emulator for steam autoclaves. ESP32 board fingindo ser autoclave completo (válvulas, sensores, gerador, carga) para PLC industrial 24V DC. Backend Next.js roda modelo termodinâmico físico (lumped + saturação + carga térmica) e cobre ciclos de esterilização 121°C gravidade e 134°C pré-vácuo, com injeção de falhas para testar o PLC sem o equipamento real.

## Estrutura

- `apps/web` — Next.js (dashboard, backend modelo, master Modbus TCP) — _vindouro_
- `apps/firmware` — PlatformIO/Arduino ESP32 (Modbus slave + I/O + fast loop) — _vindouro_
- `apps/hw` — KiCad placa condicionamento (24V ↔ 3.3V, DAC 4-20mA, sim PT-100) — _vindouro_
- `packages/protocol` — SoT do protocolo Modbus (`registers.yaml` → TS + C++)
- `packages/physics` — modelo termo isolado (testável) — _vindouro_
- `tools/scenario-runner` — CLI roda cenários YAML headless — _vindouro_
- `tools/modbus-probe` — CLI inspeção de registos — _vindouro_

## Pré-requisitos

- Node.js ≥ 20.10
- pnpm ≥ 9 (via corepack: `corepack enable && corepack prepare pnpm@9.12.0 --activate`)

## Comandos

```bash
pnpm install           # instalar tudo
pnpm generate          # regenerar artefatos do protocolo
pnpm build             # build de todos os pacotes
pnpm test              # rodar testes em todos os pacotes
pnpm typecheck         # typecheck em todos os pacotes
pnpm lint              # lint em todos os pacotes
pnpm drift-check       # regenera e falha se diff vs commitado
pnpm format            # prettier write
```
````

## Documentação

- Design: `docs/superpowers/specs/2026-05-23-emulador-autoclaves-design.md`
- Planos de implementação: `docs/superpowers/plans/`
- Mapa Modbus (gerado): `packages/protocol/dist/registers.ts` / `.h`

## Estado

Em desenvolvimento — sub-projeto 1 (Foundation) em curso.

````

- [ ] **Step 4.3: Commit**

```bash
git add TODO.md README.md
git commit -m "docs: add TODO and README"
````

---

## Task 5: packages/protocol scaffolding

**Files:**

- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/protocol/vitest.config.ts`
- Create: `packages/protocol/README.md`
- Create: `packages/protocol/src/index.ts`

- [ ] **Step 5.1: Write `packages/protocol/package.json`**

```json
{
  "name": "@sim/protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/registers.ts",
  "exports": {
    ".": "./src/index.ts",
    "./registers": "./dist/registers.ts"
  },
  "scripts": {
    "generate": "tsx src/cli.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src test"
  },
  "dependencies": {
    "js-yaml": "^4.1.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^20.16.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 5.2: Write `packages/protocol/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist-tsc",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "dist", "dist-tsc"]
}
```

Note: TypeScript output goes to `dist-tsc/` (gitignored), separate from the emitted `dist/registers.ts` artifact.

- [ ] **Step 5.3: Write `packages/protocol/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/index.ts'],
    },
  },
});
```

- [ ] **Step 5.4: Write `packages/protocol/src/index.ts`**

```typescript
export * from './schema.js';
export * from './parser.js';
```

(`schema.js` and `parser.js` will be created in Tasks 7-8; `.js` suffix is required because of `"type": "module"` + bundler-style imports.)

- [ ] **Step 5.5: Write `packages/protocol/README.md`**

```markdown
# @sim/protocol

Single source of truth for the Modbus register map shared between `apps/web` (TypeScript) and `apps/firmware` (C++ ESP32).

## How it works

1. Edit `registers.yaml`.
2. Run `pnpm generate` (or top-level `pnpm generate`).
3. Two artifacts are written to `dist/`:
   - `registers.ts` — typed `const` consumed by `apps/web`.
   - `registers.h` — `#define`s consumed by `apps/firmware`.
4. Both artifacts are **committed**. CI re-runs the generator and fails if they drift from source.

## YAML schema

See `src/schema.ts` (zod). Top-level fields: `version`, `spaces`, `registers`.

Each register declares: `id`, `space`, `address`, optional `scale`, `unit`, `range`, `type`, `description`.

## Tests

`pnpm test` runs unit tests for parser, emitters, and the CLI integration.
```

- [ ] **Step 5.6: Install workspace dependencies**

Run (from project root): `pnpm install`
Expected: pnpm sees the new workspace, installs `packages/protocol/node_modules` (symlinked from the store), updates lockfile.

- [ ] **Step 5.7: Commit**

```bash
git add packages/protocol/package.json packages/protocol/tsconfig.json packages/protocol/vitest.config.ts packages/protocol/src/index.ts packages/protocol/README.md pnpm-lock.yaml
git commit -m "feat(protocol): scaffold package with vitest"
```

---

## Task 6: Define registers.yaml initial content

**Files:**

- Create: `packages/protocol/registers.yaml`

- [ ] **Step 6.1: Write `packages/protocol/registers.yaml`**

```yaml
version: 1

# Modbus address spaces. base..end inclusive. address of each register must fall within its space's range.
spaces:
  discrete_inputs:
    base: 0x0000
    end: 0x0FFF
    description: 'PLC outputs read by ESP32 (valve/relay commands). PC master reads only.'
  coils:
    base: 0x1000
    end: 0x1FFF
    description: 'Discrete signals ESP32 publishes to PLC (pressure switches, limit switches, levels). PC master writes.'
  input_registers:
    base: 0x2000
    end: 0x2FFF
    description: 'Reserved for future analog inputs from the PLC (e.g., active PT100). Not used in v1.'
  holding_registers:
    base: 0x3000
    end: 0x3FFF
    description: 'Analog values PC sends ESP32 for DAC 4-20mA and PT100 simulation. int16 with per-register scale.'
  diagnostics:
    base: 0x4000
    end: 0x4FFF
    description: 'Tick counter, watchdog, F0, fault mask, time scale, equipment id.'

registers:
  # --- Discrete Inputs: PLC commands seen by ESP32 ---
  - {
      id: V_STEAM_IN_INT,
      space: discrete_inputs,
      address: 0x0000,
      description: 'Steam inlet valve, internal chamber',
    }
  - {
      id: V_STEAM_IN_JACKET,
      space: discrete_inputs,
      address: 0x0001,
      description: 'Steam inlet valve, jacket',
    }
  - {
      id: V_AIR_IN,
      space: discrete_inputs,
      address: 0x0002,
      description: 'Air admission valve (HEPA filtered, post-cycle)',
    }
  - { id: V_VAC, space: discrete_inputs, address: 0x0003, description: 'Vacuum line valve' }
  - { id: V_EXHAUST, space: discrete_inputs, address: 0x0004, description: 'Chamber exhaust valve' }
  - {
      id: V_DRAIN_INT,
      space: discrete_inputs,
      address: 0x0005,
      description: 'Internal chamber drain (condensate)',
    }
  - {
      id: V_DRAIN_JACKET,
      space: discrete_inputs,
      address: 0x0006,
      description: 'Jacket drain (condensate)',
    }
  - {
      id: V_SEAL_CLEAN,
      space: discrete_inputs,
      address: 0x0007,
      description: 'Door seal pressurization, clean side',
    }
  - {
      id: V_SEAL_STERILE,
      space: discrete_inputs,
      address: 0x0008,
      description: 'Door seal pressurization, sterile side',
    }
  - {
      id: V_GEN_WATER_IN,
      space: discrete_inputs,
      address: 0x0009,
      description: 'Generator make-up water valve',
    }
  - { id: PUMP_VAC, space: discrete_inputs, address: 0x000A, description: 'Vacuum pump relay' }
  - {
      id: HEATER_GEN,
      space: discrete_inputs,
      address: 0x000B,
      description: 'Generator heater (electric resistance) relay',
    }
  - {
      id: COMPRESSOR,
      space: discrete_inputs,
      address: 0x000C,
      description: 'Air compressor relay (if present)',
    }

  # --- Coils: states ESP32 publishes back to PLC ---
  - {
      id: PS_STEAM_LINE,
      space: coils,
      address: 0x1000,
      description: 'Pressure switch: steam line OK (above threshold)',
    }
  - {
      id: PS_AIR_LINE,
      space: coils,
      address: 0x1001,
      description: 'Pressure switch: compressed air line OK',
    }
  - {
      id: PS_SEAL_CLEAN,
      space: coils,
      address: 0x1002,
      description: 'Pressure switch: clean-side door seal pressurized',
    }
  - {
      id: PS_SEAL_STERILE,
      space: coils,
      address: 0x1003,
      description: 'Pressure switch: sterile-side door seal pressurized',
    }
  - {
      id: LS_DOOR_CLEAN_OPEN,
      space: coils,
      address: 0x1004,
      description: 'Limit switch: clean-side door open',
    }
  - {
      id: LS_DOOR_CLEAN_CLOSED,
      space: coils,
      address: 0x1005,
      description: 'Limit switch: clean-side door closed',
    }
  - {
      id: LS_DOOR_STERILE_OPEN,
      space: coils,
      address: 0x1006,
      description: 'Limit switch: sterile-side door open',
    }
  - {
      id: LS_DOOR_STERILE_CLOSED,
      space: coils,
      address: 0x1007,
      description: 'Limit switch: sterile-side door closed',
    }
  - {
      id: LVL_GEN_MIN,
      space: coils,
      address: 0x1008,
      description: 'Generator water level: above minimum',
    }
  - {
      id: LVL_GEN_MAX,
      space: coils,
      address: 0x1009,
      description: 'Generator water level: above maximum',
    }
  - {
      id: EMERGENCY_BTN,
      space: coils,
      address: 0x100A,
      description: 'Emergency stop pressed (active low typical, polarity per equipment)',
    }

  # --- Holding registers: analog values PC -> ESP32 (DAC + PT100 sim) ---
  - id: P_CHAMBER_INT
    space: holding_registers
    address: 0x3000
    scale: 1000
    unit: bar_abs
    range: [-1.0, 5.0]
    description: 'Internal chamber pressure (absolute). int16 / 1000 = bar abs. Sentinels: -32768=OPEN, 32767=SHORT.'
  - id: P_CHAMBER_EXT
    space: holding_registers
    address: 0x3001
    scale: 1000
    unit: bar_abs
    range: [0.0, 5.0]
    description: 'Jacket (external chamber) pressure. int16 / 1000 = bar abs.'
  - id: P_GENERATOR
    space: holding_registers
    address: 0x3002
    scale: 1000
    unit: bar_abs
    range: [0.0, 6.0]
    description: 'Generator pressure. int16 / 1000 = bar abs.'
  - id: T_CHAMBER_INT
    space: holding_registers
    address: 0x3010
    scale: 100
    unit: celsius
    range: [-50.0, 200.0]
    description: 'Internal chamber gas temperature. int16 / 100 = °C. Sentinels: -32768=OPEN, 32767=SHORT.'
  - id: T_TESTEMUNHO
    space: holding_registers
    address: 0x3011
    scale: 100
    unit: celsius
    range: [-50.0, 200.0]
    description: 'Witness sensor temperature (embedded in load fabric).'
  - id: T_CHAMBER_EXT
    space: holding_registers
    address: 0x3012
    scale: 100
    unit: celsius
    range: [-50.0, 200.0]
    description: 'Jacket temperature.'
  - id: T_GENERATOR
    space: holding_registers
    address: 0x3013
    scale: 100
    unit: celsius
    range: [0.0, 200.0]
    description: 'Generator temperature.'

  # --- Diagnostics ---
  - {
      id: MODEL_TICK_LOW,
      space: diagnostics,
      address: 0x4000,
      type: uint16,
      description: 'Low 16 bits of model tick counter',
    }
  - {
      id: MODEL_TICK_HIGH,
      space: diagnostics,
      address: 0x4001,
      type: uint16,
      description: 'High 16 bits of model tick counter',
    }
  - id: WATCHDOG_MS
    space: diagnostics
    address: 0x4002
    type: uint16
    description: 'PC heartbeat. PC writes, ESP32 zeros on receive. ESP32 enters fail-safe if no write for >500 ms.'
  - id: F0_X10
    space: diagnostics
    address: 0x4003
    type: uint16
    description: 'Accumulated F0 in equivalent minutes x10 (e.g., 137 means F0=13.7 min).'
  - {
      id: SIM_TIME_SCALE,
      space: diagnostics,
      address: 0x4020,
      type: uint16,
      description: 'Time scale x100 (100=1.0x, 200=2.0x, 50=0.5x)',
    }
  - {
      id: EQUIPMENT_ID,
      space: diagnostics,
      address: 0x4030,
      type: uint16,
      description: '16-bit hash of currently active equipment config',
    }
```

- [ ] **Step 6.2: Commit**

```bash
git add packages/protocol/registers.yaml
git commit -m "feat(protocol): initial register map (MVP DI/coils/holdings/diag)"
```

---

## Task 7: zod schema + parser (TDD)

**Files:**

- Create: `packages/protocol/src/schema.ts`
- Create: `packages/protocol/src/parser.ts`
- Create: `packages/protocol/test/parser.test.ts`

- [ ] **Step 7.1: Write the failing tests first**

Create `packages/protocol/test/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseRegisters } from '../src/parser.js';

const validYaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
  holding_registers: { base: 0x3000, end: 0x3FFF }
registers:
  - { id: V_FOO, space: discrete_inputs, address: 0x0000, description: "foo" }
  - { id: P_BAR, space: holding_registers, address: 0x3000, scale: 1000, unit: bar_abs, range: [0, 5], description: "bar" }
`;

describe('parseRegisters', () => {
  it('parses a valid YAML', () => {
    const result = parseRegisters(validYaml);
    expect(result.registers).toHaveLength(2);
    expect(result.registers[0]!.id).toBe('V_FOO');
    expect(result.registers[1]!.scale).toBe(1000);
  });

  it('rejects unknown space', () => {
    const yaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
registers:
  - { id: X, space: nonexistent_space, address: 0x0000, description: "x" }
`;
    expect(() => parseRegisters(yaml)).toThrow(/unknown space/i);
  });

  it('rejects address outside its space range', () => {
    const yaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
registers:
  - { id: X, space: discrete_inputs, address: 0x2000, description: "x" }
`;
    expect(() => parseRegisters(yaml)).toThrow(/outside space/i);
  });

  it('rejects duplicate addresses within the same space', () => {
    const yaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
registers:
  - { id: A, space: discrete_inputs, address: 0x0000, description: "a" }
  - { id: B, space: discrete_inputs, address: 0x0000, description: "b" }
`;
    expect(() => parseRegisters(yaml)).toThrow(/duplicate address/i);
  });

  it('rejects duplicate ids', () => {
    const yaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
registers:
  - { id: DUP, space: discrete_inputs, address: 0x0000, description: "1" }
  - { id: DUP, space: discrete_inputs, address: 0x0001, description: "2" }
`;
    expect(() => parseRegisters(yaml)).toThrow(/duplicate id/i);
  });

  it('rejects holding register without scale', () => {
    const yaml = `
version: 1
spaces:
  holding_registers: { base: 0x3000, end: 0x3FFF }
registers:
  - { id: P_X, space: holding_registers, address: 0x3000, description: "x" }
`;
    expect(() => parseRegisters(yaml)).toThrow(/holding register .* must declare/i);
  });

  it('allows same address in different spaces', () => {
    const yaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
  coils: { base: 0x1000, end: 0x1FFF }
registers:
  - { id: A, space: discrete_inputs, address: 0x0000, description: "a" }
  - { id: B, space: coils, address: 0x1000, description: "b" }
`;
    const result = parseRegisters(yaml);
    expect(result.registers).toHaveLength(2);
  });
});
```

- [ ] **Step 7.2: Run tests to verify they fail**

Run: `pnpm --filter @sim/protocol test`
Expected: 7 tests fail with "Cannot find module '../src/parser.js'" or similar.

- [ ] **Step 7.3: Implement `src/schema.ts`**

```typescript
import { z } from 'zod';

export const SpaceNameSchema = z.enum([
  'discrete_inputs',
  'coils',
  'input_registers',
  'holding_registers',
  'diagnostics',
]);
export type SpaceName = z.infer<typeof SpaceNameSchema>;

export const SpaceDefSchema = z.object({
  base: z.number().int().min(0).max(0xffff),
  end: z.number().int().min(0).max(0xffff),
  description: z.string().optional(),
});
export type SpaceDef = z.infer<typeof SpaceDefSchema>;

export const RegisterSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'id must be UPPER_SNAKE_CASE starting with a letter'),
  space: SpaceNameSchema,
  address: z.number().int().min(0).max(0xffff),
  type: z.enum(['bool', 'int16', 'uint16']).optional(),
  scale: z.number().positive().optional(),
  unit: z.string().optional(),
  range: z.tuple([z.number(), z.number()]).optional(),
  description: z.string().min(1),
});
export type Register = z.infer<typeof RegisterSchema>;

export const RegisterFileSchema = z.object({
  version: z.literal(1),
  spaces: z.record(SpaceNameSchema, SpaceDefSchema),
  registers: z.array(RegisterSchema).min(1),
});
export type RegisterFile = z.infer<typeof RegisterFileSchema>;
```

- [ ] **Step 7.4: Implement `src/parser.ts`**

```typescript
import yaml from 'js-yaml';
import { RegisterFileSchema, type Register, type RegisterFile, type SpaceName } from './schema.js';

export interface ParsedRegisters {
  version: 1;
  spaces: RegisterFile['spaces'];
  registers: Register[];
}

export function parseRegisters(yamlText: string): ParsedRegisters {
  const raw = yaml.load(yamlText);
  const file = RegisterFileSchema.parse(raw);

  const knownSpaces = new Set(Object.keys(file.spaces));

  // Cross-validation
  const seenIds = new Set<string>();
  const seenPerSpace = new Map<SpaceName, Map<number, string>>();

  for (const reg of file.registers) {
    if (!knownSpaces.has(reg.space)) {
      throw new Error(`Register ${reg.id}: unknown space "${reg.space}"`);
    }

    const spaceDef = file.spaces[reg.space];
    if (!spaceDef) {
      throw new Error(`Register ${reg.id}: unknown space "${reg.space}"`);
    }
    if (reg.address < spaceDef.base || reg.address > spaceDef.end) {
      throw new Error(
        `Register ${reg.id}: address 0x${reg.address.toString(16).padStart(4, '0')} outside space "${reg.space}" range [0x${spaceDef.base.toString(16).padStart(4, '0')}..0x${spaceDef.end.toString(16).padStart(4, '0')}]`,
      );
    }

    if (seenIds.has(reg.id)) {
      throw new Error(`duplicate id "${reg.id}"`);
    }
    seenIds.add(reg.id);

    let perSpace = seenPerSpace.get(reg.space);
    if (!perSpace) {
      perSpace = new Map();
      seenPerSpace.set(reg.space, perSpace);
    }
    const dup = perSpace.get(reg.address);
    if (dup) {
      throw new Error(
        `duplicate address 0x${reg.address.toString(16).padStart(4, '0')} in space "${reg.space}" between ${dup} and ${reg.id}`,
      );
    }
    perSpace.set(reg.address, reg.id);

    if (reg.space === 'holding_registers' && reg.scale === undefined && reg.type === undefined) {
      throw new Error(
        `holding register "${reg.id}" must declare either "scale" (analog) or "type" (raw uint16/int16)`,
      );
    }
  }

  return { version: file.version, spaces: file.spaces, registers: file.registers };
}
```

- [ ] **Step 7.5: Run tests to verify they pass**

Run: `pnpm --filter @sim/protocol test`
Expected: 7/7 tests pass.

- [ ] **Step 7.6: Run typecheck**

Run: `pnpm --filter @sim/protocol typecheck`
Expected: no errors.

- [ ] **Step 7.7: Commit**

```bash
git add packages/protocol/src/schema.ts packages/protocol/src/parser.ts packages/protocol/test/parser.test.ts
git commit -m "feat(protocol): parse and validate registers.yaml with zod"
```

---

## Task 8: TypeScript emitter (TDD)

**Files:**

- Create: `packages/protocol/src/emit-ts.ts`
- Create: `packages/protocol/test/emit-ts.test.ts`

- [ ] **Step 8.1: Write the failing tests first**

Create `packages/protocol/test/emit-ts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseRegisters } from '../src/parser.js';
import { emitTypeScript } from '../src/emit-ts.js';

const sampleYaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
  holding_registers: { base: 0x3000, end: 0x3FFF }
registers:
  - { id: V_FOO, space: discrete_inputs, address: 0x0000, description: "foo valve" }
  - { id: P_BAR, space: holding_registers, address: 0x3000, scale: 1000, unit: bar_abs, range: [0, 5], description: "bar pressure" }
`;

describe('emitTypeScript', () => {
  it('emits a header banner', () => {
    const out = emitTypeScript(parseRegisters(sampleYaml));
    expect(out).toMatch(/AUTO-GENERATED/);
    expect(out).toMatch(/registers\.yaml/);
  });

  it('emits a typed REGISTERS const with each id as a key', () => {
    const out = emitTypeScript(parseRegisters(sampleYaml));
    expect(out).toMatch(/export const REGISTERS = \{/);
    expect(out).toMatch(/V_FOO:\s*\{/);
    expect(out).toMatch(/P_BAR:\s*\{/);
    expect(out).toMatch(/\} as const;/);
  });

  it('emits address as a hex literal', () => {
    const out = emitTypeScript(parseRegisters(sampleYaml));
    expect(out).toMatch(/address:\s*0x0000/);
    expect(out).toMatch(/address:\s*0x3000/);
  });

  it('emits scale and unit for holding registers', () => {
    const out = emitTypeScript(parseRegisters(sampleYaml));
    expect(out).toMatch(/scale:\s*1000/);
    expect(out).toMatch(/unit:\s*'bar_abs'/);
  });

  it('emits a RegisterId union type', () => {
    const out = emitTypeScript(parseRegisters(sampleYaml));
    expect(out).toMatch(/export type RegisterId = 'V_FOO' \| 'P_BAR'/);
  });

  it('emits SPACES const with bases/ends', () => {
    const out = emitTypeScript(parseRegisters(sampleYaml));
    expect(out).toMatch(/export const SPACES =/);
    expect(out).toMatch(/discrete_inputs:\s*\{\s*base:\s*0x0000,\s*end:\s*0x0fff\s*\}/i);
  });

  it('output is deterministic (same input -> same output)', () => {
    const parsed = parseRegisters(sampleYaml);
    const a = emitTypeScript(parsed);
    const b = emitTypeScript(parsed);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 8.2: Run tests to verify they fail**

Run: `pnpm --filter @sim/protocol test`
Expected: emit-ts tests fail with "Cannot find module '../src/emit-ts.js'".

- [ ] **Step 8.3: Implement `src/emit-ts.ts`**

```typescript
import type { ParsedRegisters } from './parser.js';
import type { Register, SpaceDef } from './schema.js';

const BANNER = `// AUTO-GENERATED from packages/protocol/registers.yaml — DO NOT EDIT.
// Run \`pnpm generate\` to regenerate. CI fails on drift.
`;

function hex(n: number, width = 4): string {
  return '0x' + n.toString(16).padStart(width, '0');
}

function emitRegister(reg: Register): string {
  const parts: string[] = [];
  parts.push(`space: '${reg.space}'`);
  parts.push(`address: ${hex(reg.address)}`);
  if (reg.type !== undefined) parts.push(`type: '${reg.type}'`);
  if (reg.scale !== undefined) parts.push(`scale: ${reg.scale}`);
  if (reg.unit !== undefined) parts.push(`unit: '${reg.unit}'`);
  if (reg.range !== undefined) parts.push(`range: [${reg.range[0]}, ${reg.range[1]}] as const`);
  return `  ${reg.id}: { ${parts.join(', ')} },`;
}

function emitSpace(name: string, def: SpaceDef): string {
  return `  ${name}: { base: ${hex(def.base)}, end: ${hex(def.end)} },`;
}

export function emitTypeScript(parsed: ParsedRegisters): string {
  const spacesLines = Object.entries(parsed.spaces).map(([name, def]) => emitSpace(name, def));
  const registerLines = parsed.registers.map(emitRegister);
  const ids = parsed.registers.map((r) => `'${r.id}'`).join(' | ');

  return [
    BANNER,
    `export const SPACES = {`,
    ...spacesLines,
    `} as const;`,
    ``,
    `export const REGISTERS = {`,
    ...registerLines,
    `} as const;`,
    ``,
    `export type RegisterId = ${ids};`,
    ``,
  ].join('\n');
}
```

- [ ] **Step 8.4: Run tests to verify they pass**

Run: `pnpm --filter @sim/protocol test`
Expected: all parser + emit-ts tests pass (7 + 7 = 14).

- [ ] **Step 8.5: Commit**

```bash
git add packages/protocol/src/emit-ts.ts packages/protocol/test/emit-ts.test.ts
git commit -m "feat(protocol): TypeScript emitter for register map"
```

---

## Task 9: C++ emitter (TDD)

**Files:**

- Create: `packages/protocol/src/emit-cpp.ts`
- Create: `packages/protocol/test/emit-cpp.test.ts`

- [ ] **Step 9.1: Write the failing tests first**

Create `packages/protocol/test/emit-cpp.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseRegisters } from '../src/parser.js';
import { emitCpp } from '../src/emit-cpp.js';

const sampleYaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
  holding_registers: { base: 0x3000, end: 0x3FFF }
  diagnostics: { base: 0x4000, end: 0x4FFF }
registers:
  - { id: V_FOO, space: discrete_inputs, address: 0x0000, description: "foo" }
  - { id: P_BAR, space: holding_registers, address: 0x3000, scale: 1000, unit: bar_abs, range: [0, 5], description: "bar" }
  - { id: WATCHDOG_MS, space: diagnostics, address: 0x4002, type: uint16, description: "watchdog" }
`;

describe('emitCpp', () => {
  it('emits header banner and pragma once', () => {
    const out = emitCpp(parseRegisters(sampleYaml));
    expect(out).toMatch(/AUTO-GENERATED/);
    expect(out).toMatch(/#pragma once/);
  });

  it('emits space-name -> Modbus function code mapping macros', () => {
    const out = emitCpp(parseRegisters(sampleYaml));
    expect(out).toMatch(/#define\s+MB_SPACE_DISCRETE_INPUTS\s+1/);
    expect(out).toMatch(/#define\s+MB_SPACE_COILS\s+0/);
    expect(out).toMatch(/#define\s+MB_SPACE_HOLDING_REGISTERS\s+3/);
  });

  it('emits address macros for each register', () => {
    const out = emitCpp(parseRegisters(sampleYaml));
    expect(out).toMatch(/#define\s+REG_V_FOO_ADDR\s+0x0000/);
    expect(out).toMatch(/#define\s+REG_P_BAR_ADDR\s+0x3000/);
    expect(out).toMatch(/#define\s+REG_WATCHDOG_MS_ADDR\s+0x4002/);
  });

  it('emits space macro for each register', () => {
    const out = emitCpp(parseRegisters(sampleYaml));
    expect(out).toMatch(/#define\s+REG_V_FOO_SPACE\s+MB_SPACE_DISCRETE_INPUTS/);
    expect(out).toMatch(/#define\s+REG_P_BAR_SPACE\s+MB_SPACE_HOLDING_REGISTERS/);
  });

  it('emits scale macro for analog holding registers', () => {
    const out = emitCpp(parseRegisters(sampleYaml));
    expect(out).toMatch(/#define\s+REG_P_BAR_SCALE\s+1000/);
  });

  it('does not emit scale for registers without one', () => {
    const out = emitCpp(parseRegisters(sampleYaml));
    expect(out).not.toMatch(/#define\s+REG_V_FOO_SCALE/);
    expect(out).not.toMatch(/#define\s+REG_WATCHDOG_MS_SCALE/);
  });

  it('emits register count macro', () => {
    const out = emitCpp(parseRegisters(sampleYaml));
    expect(out).toMatch(/#define\s+REG_COUNT\s+3/);
  });

  it('output is deterministic', () => {
    const parsed = parseRegisters(sampleYaml);
    expect(emitCpp(parsed)).toBe(emitCpp(parsed));
  });
});
```

- [ ] **Step 9.2: Run tests to verify they fail**

Run: `pnpm --filter @sim/protocol test`
Expected: emit-cpp tests fail.

- [ ] **Step 9.3: Implement `src/emit-cpp.ts`**

```typescript
import type { ParsedRegisters } from './parser.js';
import type { Register, SpaceName } from './schema.js';

const BANNER = `// AUTO-GENERATED from packages/protocol/registers.yaml — DO NOT EDIT.
// Run \`pnpm generate\` to regenerate. CI fails on drift.
`;

// Modbus function-code style constants. Values arbitrary but stable; firmware uses these to dispatch.
const SPACE_CODES: Record<SpaceName, { macro: string; value: number }> = {
  coils: { macro: 'MB_SPACE_COILS', value: 0 },
  discrete_inputs: { macro: 'MB_SPACE_DISCRETE_INPUTS', value: 1 },
  input_registers: { macro: 'MB_SPACE_INPUT_REGISTERS', value: 2 },
  holding_registers: { macro: 'MB_SPACE_HOLDING_REGISTERS', value: 3 },
  diagnostics: { macro: 'MB_SPACE_DIAGNOSTICS', value: 4 },
};

function hex(n: number, width = 4): string {
  return '0x' + n.toString(16).padStart(width, '0').toUpperCase();
}

function emitRegisterMacros(reg: Register): string[] {
  const lines: string[] = [];
  lines.push(`// ${reg.id} — ${reg.description}`);
  lines.push(`#define REG_${reg.id}_ADDR  ${hex(reg.address)}`);
  lines.push(`#define REG_${reg.id}_SPACE ${SPACE_CODES[reg.space].macro}`);
  if (reg.scale !== undefined) {
    lines.push(`#define REG_${reg.id}_SCALE ${reg.scale}`);
  }
  return lines;
}

export function emitCpp(parsed: ParsedRegisters): string {
  const spaceLines = Object.values(SPACE_CODES).map(
    ({ macro, value }) => `#define ${macro} ${value}`,
  );

  const registerLines: string[] = [];
  for (const reg of parsed.registers) {
    registerLines.push(...emitRegisterMacros(reg));
    registerLines.push('');
  }

  return [
    BANNER,
    `#pragma once`,
    ``,
    `// Modbus address space codes`,
    ...spaceLines,
    ``,
    `// Register definitions`,
    ...registerLines,
    `#define REG_COUNT ${parsed.registers.length}`,
    ``,
  ].join('\n');
}
```

- [ ] **Step 9.4: Run tests to verify they pass**

Run: `pnpm --filter @sim/protocol test`
Expected: all tests pass (7 + 7 + 8 = 22).

- [ ] **Step 9.5: Commit**

```bash
git add packages/protocol/src/emit-cpp.ts packages/protocol/test/emit-cpp.test.ts
git commit -m "feat(protocol): C++ header emitter for register map"
```

---

## Task 10: CLI (generate.ts) end-to-end (TDD)

**Files:**

- Create: `packages/protocol/src/cli.ts`
- Create: `packages/protocol/test/cli.test.ts`

- [ ] **Step 10.1: Write the failing integration test**

Create `packages/protocol/test/cli.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'protocol-cli-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const sampleYaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
  holding_registers: { base: 0x3000, end: 0x3FFF }
registers:
  - { id: V_FOO, space: discrete_inputs, address: 0x0000, description: "foo" }
  - { id: P_BAR, space: holding_registers, address: 0x3000, scale: 1000, unit: bar_abs, range: [0, 5], description: "bar" }
`;

describe('cli run', () => {
  it('reads yaml and writes both TS and C++ artifacts', () => {
    const yamlPath = join(tmp, 'registers.yaml');
    const distDir = join(tmp, 'dist');
    writeFileSync(yamlPath, sampleYaml, 'utf8');

    run({ inputPath: yamlPath, outputDir: distDir });

    const ts = readFileSync(join(distDir, 'registers.ts'), 'utf8');
    const cpp = readFileSync(join(distDir, 'registers.h'), 'utf8');
    expect(ts).toMatch(/V_FOO/);
    expect(ts).toMatch(/P_BAR/);
    expect(cpp).toMatch(/#define REG_V_FOO_ADDR\s+0x0000/);
    expect(cpp).toMatch(/#define REG_P_BAR_SCALE\s+1000/);
  });

  it('creates the output directory if it does not exist', () => {
    const yamlPath = join(tmp, 'registers.yaml');
    const distDir = join(tmp, 'nested', 'deeper', 'dist');
    writeFileSync(yamlPath, sampleYaml, 'utf8');

    expect(existsSync(distDir)).toBe(false);
    run({ inputPath: yamlPath, outputDir: distDir });
    expect(existsSync(join(distDir, 'registers.ts'))).toBe(true);
    expect(existsSync(join(distDir, 'registers.h'))).toBe(true);
  });

  it('throws on invalid yaml (propagates parser error)', () => {
    const yamlPath = join(tmp, 'bad.yaml');
    writeFileSync(
      yamlPath,
      `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
registers:
  - { id: X, space: discrete_inputs, address: 0x9999, description: "out of range" }
`,
      'utf8',
    );
    expect(() => run({ inputPath: yamlPath, outputDir: join(tmp, 'dist') })).toThrow(
      /outside space/,
    );
  });
});
```

- [ ] **Step 10.2: Run tests to verify they fail**

Run: `pnpm --filter @sim/protocol test`
Expected: cli tests fail.

- [ ] **Step 10.3: Implement `src/cli.ts`**

```typescript
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRegisters } from './parser.js';
import { emitTypeScript } from './emit-ts.js';
import { emitCpp } from './emit-cpp.js';

export interface RunOptions {
  inputPath: string;
  outputDir: string;
}

export function run(opts: RunOptions): void {
  const yamlText = readFileSync(opts.inputPath, 'utf8');
  const parsed = parseRegisters(yamlText);

  mkdirSync(opts.outputDir, { recursive: true });

  const tsPath = join(opts.outputDir, 'registers.ts');
  const cppPath = join(opts.outputDir, 'registers.h');

  writeFileSync(tsPath, emitTypeScript(parsed), 'utf8');
  writeFileSync(cppPath, emitCpp(parsed), 'utf8');

  console.log(`[@sim/protocol] generated:`);
  console.log(`  ${tsPath}`);
  console.log(`  ${cppPath}`);
  console.log(
    `  ${parsed.registers.length} registers across ${Object.keys(parsed.spaces).length} spaces`,
  );
}

// Auto-invoke when called as a script (not when imported by tests).
const isMain = (() => {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
    return thisFile === invoked;
  } catch {
    return false;
  }
})();

if (isMain) {
  // Defaults assume CWD is packages/protocol
  const inputPath = resolve(process.cwd(), 'registers.yaml');
  const outputDir = resolve(process.cwd(), 'dist');
  run({ inputPath, outputDir });
}
```

- [ ] **Step 10.4: Run tests to verify they pass**

Run: `pnpm --filter @sim/protocol test`
Expected: all 25 tests pass (7 + 7 + 8 + 3).

- [ ] **Step 10.5: Generate the real artifacts from `registers.yaml`**

Run: `pnpm --filter @sim/protocol generate`
Expected: two files created — `packages/protocol/dist/registers.ts` and `packages/protocol/dist/registers.h`. Log lines printed.

- [ ] **Step 10.6: Inspect the generated files**

Run: `cat packages/protocol/dist/registers.ts` (or open in editor)
Expected: TS file with `REGISTERS` const containing every entry from `registers.yaml`, `SPACES` const, `RegisterId` union.

Run: `cat packages/protocol/dist/registers.h`
Expected: C header with `#define REG_*_ADDR`/`REG_*_SPACE`/`REG_*_SCALE` for each register and `REG_COUNT` at the end.

- [ ] **Step 10.7: Commit**

```bash
git add packages/protocol/src/cli.ts packages/protocol/test/cli.test.ts packages/protocol/dist/registers.ts packages/protocol/dist/registers.h
git commit -m "feat(protocol): CLI generator + initial generated artifacts"
```

---

## Task 11: ESLint configuration

**Files:**

- Create: `eslint.config.mjs` (root, flat config — ESLint 9)

- [ ] **Step 11.1: Install eslint TS plugins**

Run (from project root): `pnpm add -D -w typescript-eslint @eslint/js`
Expected: lockfile updated.

- [ ] **Step 11.2: Write `eslint.config.mjs`**

```javascript
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-tsc/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      'packages/protocol/dist/registers.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
);
```

- [ ] **Step 11.3: Run lint to verify it passes on existing code**

Run: `pnpm lint`
Expected: passes (or shows fixable warnings — fix them with `pnpm lint --fix` if any, then re-run).

If unused-vars complaints in `src/cli.ts`, prefix with `_` per the rule.

- [ ] **Step 11.4: Commit**

```bash
git add eslint.config.mjs package.json pnpm-lock.yaml
git commit -m "chore: add eslint flat config"
```

---

## Task 12: GitHub Actions CI

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 12.1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    name: Build / Lint / Test / Drift Check
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20.10.0'

      - name: Enable corepack and pin pnpm
        run: |
          corepack enable
          corepack prepare pnpm@9.12.0 --activate

      - name: Cache pnpm store
        uses: actions/cache@v4
        with:
          path: ~/.local/share/pnpm/store
          key: pnpm-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
          restore-keys: pnpm-${{ runner.os }}-

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Format check
        run: pnpm format:check

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Test
        run: pnpm test

      - name: Drift check (regenerate protocol artifacts)
        run: pnpm drift-check
```

- [ ] **Step 12.2: Run the local equivalents to ensure CI will pass**

Run each in sequence from project root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm drift-check
```

Expected: all pass. `drift-check` exits 0 with no git diff.

If `format:check` complains, run `pnpm format` then re-run `format:check`.

- [ ] **Step 12.3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow (lint/typecheck/test/drift)"
```

---

## Task 13: Smoke test the whole foundation

**Files:** none new.

- [ ] **Step 13.1: Cold install simulation**

Run:

```bash
rm -rf node_modules packages/protocol/node_modules pnpm-lock.yaml
pnpm install
```

Expected: lockfile regenerated identical (or near-identical). All packages install. No errors.

- [ ] **Step 13.2: Full build + test from scratch**

Run:

```bash
pnpm generate
pnpm build
pnpm typecheck
pnpm test
pnpm drift-check
```

Expected: all green. `drift-check` exits 0.

- [ ] **Step 13.3: Tamper test — verify drift check actually catches drift**

Run:

```bash
echo "// tampered" >> packages/protocol/dist/registers.ts
pnpm drift-check
```

Expected: drift-check FAILS (exit 1) with diff showing the appended comment.

Restore:

```bash
git checkout packages/protocol/dist/registers.ts
pnpm drift-check
```

Expected: passes again.

- [ ] **Step 13.4: Update TODO.md**

Move "Sub-projeto 1 — Foundation" from `## Em curso` to `## Feito` with today's date.

Edit `TODO.md`:

```markdown
# TODO

## Em curso

(vazio — escolher próximo sub-projeto)

## Pendente

- Sub-projeto 2 — Modelo físico standalone (packages/physics: saturação, valve, chamber, jacket, generator, load, f0 + testes)
- Sub-projeto 3 — Orchestrator + virtual bridge + scenario runner (cenário 134°C verde)
- Sub-projeto 4 — Dashboard MVP (live + virtual-plc + equipment CRUD + WS)
- Sub-projeto 5 — Firmware ESP32 + Modbus slave (I/O + watchdog + fast model)
- Sub-projeto 6 — Injeção de falhas (hooks orchestrator + UI faults + cenários)
- Sub-projeto 7 — Placa condicionamento KiCad (schematic + PCB + BOM)
- Sub-projeto 8 — PLC-in-loop aceitação (PLC real, ajustes finais, QA arquivada)
- Sub-projeto 9 — Mímico SVG + cycles history + replay

## Feito

- 2026-05-23 — Sub-projeto 1 — Foundation (monorepo pnpm+turbo, packages/protocol gerando TS+C++ de registers.yaml com testes e drift-check em CI)
```

- [ ] **Step 13.5: Final commit**

```bash
git add TODO.md
git commit -m "chore: mark foundation sub-project complete"
```

- [ ] **Step 13.6: Verify final state**

Run: `git log --oneline`
Expected: ~12-13 commits, each focused, in logical order.

Run: `git status`
Expected: working tree clean.

---

## Done criteria

All boxes checked above, plus:

- [ ] `pnpm install` from clean state succeeds.
- [ ] `pnpm test` passes (≥22 tests).
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm drift-check` passes.
- [ ] `packages/protocol/dist/registers.ts` and `.h` exist and are committed.
- [ ] CI workflow file exists at `.github/workflows/ci.yml` and locally-simulated steps all pass.
- [ ] `TODO.md` updated.

---

## What this plan does NOT cover (deliberately)

- The physics model (`packages/physics`) — sub-projeto 2.
- The Next.js app (`apps/web`) — sub-projeto 3-4.
- The firmware (`apps/firmware`) — sub-projeto 5.
- The hardware (`apps/hw`) — sub-projeto 7.
- Pushing to a remote, setting up secrets, branch protection rules — out of scope (do manually when ready).
- Multi-arch firmware testing in CI — sub-projeto 5.

The artifacts emitted by this sub-project will be consumed by every subsequent sub-project — getting the protocol stable now is the whole point of going first.
