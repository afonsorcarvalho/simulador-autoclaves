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
