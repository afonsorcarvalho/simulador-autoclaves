---
name: protocol-register
description: Add, change, or remove a Modbus register in the simulador-autoclaves protocol. Use whenever editing packages/protocol/registers.yaml or when a new signal needs to cross the TS orchestrator ↔ ESP32 C++ boundary. Enforces the edit → regenerate → drift-check → verify loop so generated TS and C++ never drift.
---

# Protocol register change

`packages/protocol/registers.yaml` is the **single source of truth** for the Modbus map. Two artifacts are generated from it and consumed downstream:

- `packages/protocol/dist/registers.ts` → used by `apps/web` (orchestrator, virtual bridge)
- `packages/protocol/dist/registers.h` → used by the ESP32 firmware (C++)

These `dist/` files are **generated, drift-checked in CI, and deny-listed for hand-editing**. Never edit them directly — always regenerate.

## Steps

1. **Edit `registers.yaml` only.** Add/modify the register definition. Check:
   - Unique key, unique address, no overlap with existing registers.
   - Correct register class (coil vs holding vs input) and address range.
   - Width reserves enough consecutive addresses for multi-word values.
   - Signed vs unsigned matches the physical range; scale factor documented.

2. **Regenerate both artifacts:**

   ```bash
   pnpm --filter @sim/protocol generate
   ```

3. **Drift-check (must pass):**

   ```bash
   pnpm drift-check
   ```

   This regenerates and runs `git diff --exit-code` on `dist/`. If it fails, the artifacts weren't committed in sync — stage the regenerated `dist/`.

4. **Typecheck + test the protocol package:**

   ```bash
   pnpm --filter @sim/protocol typecheck
   pnpm --filter @sim/protocol test
   ```

5. **Check consumers.** If you renamed or removed a register, grep `apps/web` (and firmware once it exists) for the old key and update every use — a rename is a breaking change for the firmware.

6. **Commit `registers.yaml` and the regenerated `dist/` together.**

## Red flags

- Editing `dist/registers.ts` or `dist/registers.h` by hand → stop, edit YAML and regenerate.
- Committing `registers.yaml` without the regenerated `dist/` → CI drift-check will fail.
- Reusing an address or changing a width without checking multi-word neighbours.

For a deeper correctness audit of the map, dispatch the `protocol-consistency-reviewer` agent.
