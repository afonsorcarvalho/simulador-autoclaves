# Orchestrator + Virtual Bridge + Scenario Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Next.js server-side orchestrator that runs the physics model in real time, exposes a Modbus-shaped interface for the PLC (real or virtual), and drives a virtual PLC controller that closes a full 134°C pre-vacuum cycle reaching F0 ≥ 100 entirely in-process (no ESP32, no real PLC).

**Architecture:** A `ModbusBridge` abstraction sits between the orchestrator (server side) and the PLC (real ESP32 or virtual in-process). The orchestrator ticks the physics model at fixed dt, reads valve/actuator commands from the bridge's Discrete Input space (what the PLC commanded), writes sensor values to the bridge's Holding/Coil spaces (what the PLC reads back). The virtual PLC is a state machine + control loops that wakes on the bridge, decides commands, writes them back — exactly as a real PLC would. Both physics and PLC sit on the same Node process in virtual mode; the bridge is a thin in-memory store. Real mode (sub-projeto 5) swaps the bridge to Modbus TCP over the network without touching orchestrator code.

**Tech Stack:** Next.js 14+ App Router (apps/web), TypeScript 5, vitest 2, zod 3, js-yaml; consumes `@sim/protocol` (register map) and `@sim/physics` (model). No Modbus library yet — real TCP bridge skeleton with deferred wire integration (sub-projeto 5).

---

## File Structure

```
apps/web/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── next.config.mjs
├── README.md
├── app/                          # Next.js routes (placeholder for sub-projeto 4)
│   └── page.tsx                  # minimal stub
├── server/
│   ├── bridge/
│   │   ├── bridge.ts             # ModbusBridge interface
│   │   ├── virtual-esp32.ts      # in-memory implementation
│   │   ├── register-access.ts    # typed wrapper (RegisterId → scaled value)
│   │   └── factory.ts            # switch via HW_MODE env (virtual default)
│   ├── orchestrator/
│   │   ├── orchestrator.ts       # tick loop coordinator
│   │   ├── sensor-publisher.ts   # writes physics state → holdings/coils
│   │   ├── command-reader.ts     # reads discrete inputs → ValveCommands/ActuatorCommands
│   │   └── snapshot.ts           # Snapshot type + publisher
│   ├── virtual-plc/
│   │   ├── plc.ts                # main VirtualPLC class + tick
│   │   ├── state-machine.ts      # CyclePhase transitions
│   │   ├── chamber-pid.ts        # closed-loop control on V_STEAM_IN_INT
│   │   └── cycle-config.ts       # CycleConfig type + zod schema
│   ├── scenario-runner/
│   │   ├── runner.ts             # ties orchestrator + plc + assertions
│   │   ├── assertions.ts         # F0/T/no-alarm checks
│   │   └── cli.ts                # pnpm scenario:run entry point
│   └── scenarios/
│       └── ster-134-prevac.yaml  # cycle config for 134°C reference
└── test/
    ├── bridge/
    │   ├── virtual-esp32.test.ts
    │   └── register-access.test.ts
    ├── orchestrator/
    │   ├── orchestrator.test.ts
    │   ├── sensor-publisher.test.ts
    │   └── command-reader.test.ts
    ├── virtual-plc/
    │   ├── state-machine.test.ts
    │   ├── chamber-pid.test.ts
    │   └── plc.test.ts
    └── scenario-runner/
        ├── runner.test.ts
        └── integration-ster-134.test.ts
```

### File responsibilities

| File | One-line responsibility |
|---|---|
| `bridge.ts` | Defines `ModbusBridge` interface (DI/coils/holdings + async I/O) |
| `virtual-esp32.ts` | In-memory implementation with 4 arrays per space |
| `register-access.ts` | Typed getter/setter using `@sim/protocol` register map + scaling |
| `factory.ts` | Returns virtual or real bridge based on `HW_MODE` env |
| `orchestrator.ts` | Owns physics state + bridge handle; coordinates a single tick |
| `sensor-publisher.ts` | Maps `SystemState` → holding registers (P, T) + coils (PS, LS, LVL) |
| `command-reader.ts` | Maps Discrete Inputs → `ValveCommands` + `ActuatorCommands` |
| `snapshot.ts` | Aggregates orchestrator state for WS broadcast (used in sub-projeto 4) |
| `plc.ts` | Virtual PLC: ticks state machine + controllers + writes valve commands |
| `state-machine.ts` | Phase transitions: IDLE → PREHEAT → PREVAC → HOLD → EXHAUST → DRY → DONE |
| `chamber-pid.ts` | PI controller modulating V_STEAM_IN_INT to hold chamber at setpoint |
| `cycle-config.ts` | zod schema for cycle YAML (setpoints, durations, prevac pulses) |
| `runner.ts` | Drives orchestrator + virtual PLC for duration, returns final state |
| `assertions.ts` | Pure functions: `assertF0Reached`, `assertTempProfile`, etc |
| `cli.ts` | Loads YAML, runs scenario, prints summary + exits with status code |

---

## Type contracts (locked in here)

```typescript
// bridge.ts
export interface ModbusBridge {
  // Discrete Inputs (PLC outputs - what PLC commanded)
  readDiscreteInputs(addr: number, count: number): Promise<boolean[]>;
  /** Test-only: virtual bridge lets us inject PLC commands. Real bridge throws. */
  writeDiscreteInputs(addr: number, values: boolean[]): Promise<void>;

  // Coils (states PLC reads from autoclave: pressure switches, limits, levels)
  readCoils(addr: number, count: number): Promise<boolean[]>;
  writeCoils(addr: number, values: boolean[]): Promise<void>;

  // Holding registers (PC writes analog values for PLC to read: P, T, F0)
  readHoldingRegisters(addr: number, count: number): Promise<number[]>;
  writeHoldingRegisters(addr: number, values: number[]): Promise<void>;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

// register-access.ts (consumes @sim/protocol)
export class RegisterAccess {
  constructor(bridge: ModbusBridge);
  getDiscrete(id: RegisterId): Promise<boolean>;
  setDiscrete(id: RegisterId, value: boolean): Promise<void>;
  getCoil(id: RegisterId): Promise<boolean>;
  setCoil(id: RegisterId, value: boolean): Promise<void>;
  /** Scaled value in physical units (bar abs, °C, etc — defined by register.unit). */
  getAnalog(id: RegisterId): Promise<number>;
  setAnalog(id: RegisterId, value: number): Promise<void>;
}

// orchestrator.ts
import type { SystemState, SystemParams } from '@sim/physics';
export interface OrchestratorOpts {
  bridge: ModbusBridge;
  params: SystemParams;
  initialState: SystemState;
  tickDt_s: number;
}
export class Orchestrator {
  constructor(opts: OrchestratorOpts);
  /** Run a single tick: read commands → step physics → write sensors. */
  tick(): Promise<void>;
  getState(): SystemState;
}

// snapshot.ts
export interface Snapshot {
  t_s: number;
  P_chamber_bar: number; P_jacket_bar: number; P_gen_bar: number;
  T_chamber_C: number;  T_test_C: number;  T_jacket_C: number;  T_gen_C: number;
  F0_min: number;
  valves: Record<string, boolean>;   // commanded states
  cycle_phase?: string;              // populated when running with virtual PLC
}

// virtual-plc/cycle-config.ts
export interface CycleConfig {
  name: string;
  sterilization_T_C: number;
  sterilization_P_bar: number;
  hold_duration_s: number;
  prevac_pulses: number;
  prevac_vacuum_target_bar: number;
  prevac_steam_target_bar: number;
  preheat_duration_s: number;
  dry_duration_s: number;
  f0_target_min: number;
}

// virtual-plc/state-machine.ts
export type CyclePhase =
  | 'IDLE'
  | 'PREHEAT'
  | 'PREVAC_VACUUM'
  | 'PREVAC_STEAM'
  | 'PRESSURIZE'
  | 'HOLD'
  | 'EXHAUST'
  | 'DRY'
  | 'COMPLETE';

// virtual-plc/plc.ts
export class VirtualPLC {
  constructor(cycle: CycleConfig, bridge: ModbusBridge);
  tick(time_s: number): Promise<void>;
  getPhase(): CyclePhase;
  getPhaseElapsed_s(): number;
}
```

---

## Task 1: Scaffold apps/web Next.js workspace

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/README.md`
- Create: `apps/web/app/page.tsx`

- [ ] **Step 1.1: Write `apps/web/package.json`**

```json
{
  "name": "@sim/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint server test",
    "scenario:run": "tsx server/scenario-runner/cli.ts"
  },
  "dependencies": {
    "@sim/physics": "workspace:*",
    "@sim/protocol": "workspace:*",
    "js-yaml": "^4.1.0",
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^20.16.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitest/coverage-v8": "^2.1.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 1.2: Write `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "types": ["node"],
    "jsx": "preserve",
    "lib": ["ES2022", "DOM"],
    "moduleResolution": "Bundler",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["server/**/*", "test/**/*", "app/**/*", "next-env.d.ts"],
  "exclude": ["node_modules", ".next"]
}
```

- [ ] **Step 1.3: Write `apps/web/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['server/**/*.ts'],
      exclude: ['server/scenario-runner/cli.ts'],
    },
  },
});
```

- [ ] **Step 1.4: Write `apps/web/next.config.mjs`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@sim/physics', '@sim/protocol'],
};

export default nextConfig;
```

- [ ] **Step 1.5: Write `apps/web/app/page.tsx`** (placeholder for sub-projeto 4)

```tsx
export default function Home() {
  return (
    <main>
      <h1>Simulador de Autoclaves</h1>
      <p>Dashboard placeholder — sub-projeto 4 will replace this.</p>
    </main>
  );
}
```

- [ ] **Step 1.6: Write `apps/web/README.md`**

```markdown
# @sim/web

Next.js app: orchestrator runtime + dashboard.

## Run a scenario (headless, virtual bridge)

```bash
pnpm --filter @sim/web scenario:run server/scenarios/ster-134-prevac.yaml
```

## Run tests

```bash
pnpm --filter @sim/web test
```

## Dev server (when dashboard exists — sub-projeto 4)

```bash
pnpm --filter @sim/web dev
```
```

- [ ] **Step 1.7: Install + verify**

```
pnpm install
pnpm --filter @sim/web typecheck
```

Expected: lockfile updated, typecheck clean (only `app/page.tsx` exists, trivial).

- [ ] **Step 1.8: Commit**

```bash
git add apps/web/package.json apps/web/tsconfig.json apps/web/vitest.config.ts apps/web/next.config.mjs apps/web/app/page.tsx apps/web/README.md pnpm-lock.yaml
git commit -m "feat(web): scaffold @sim/web Next.js workspace"
```

---

## Task 2: Bridge interface + scaffold

**Files:**
- Create: `apps/web/server/bridge/bridge.ts`

- [ ] **Step 2.1: Write `apps/web/server/bridge/bridge.ts`**

```typescript
/**
 * Abstract Modbus-shaped interface sitting between the orchestrator (which owns
 * the physics model) and the PLC (real ESP32 or virtual in-process). Both sides
 * see the same 4-space register layout from @sim/protocol.
 */
export interface ModbusBridge {
  /** Discrete Inputs (0x0000-0x0FFF): PLC outputs read by ESP32.
   *  These are the COMMANDS the PLC sent (valve open/close, relay on/off). */
  readDiscreteInputs(addr: number, count: number): Promise<boolean[]>;
  /** Test/virtual-only: write DI directly (simulates PLC commanding). Real bridge throws. */
  writeDiscreteInputs(addr: number, values: boolean[]): Promise<void>;

  /** Coils (0x1000-0x1FFF): discrete states ESP32 publishes to PLC.
   *  Pressure switches, limit switches, level switches. */
  readCoils(addr: number, count: number): Promise<boolean[]>;
  writeCoils(addr: number, values: boolean[]): Promise<void>;

  /** Holding registers (0x3000-0x3FFF + 0x4000-0x4FFF diagnostics).
   *  PC writes analog values for the PLC to read (P, T, F0, tick, watchdog).
   *  int16, with per-register scale defined in @sim/protocol. */
  readHoldingRegisters(addr: number, count: number): Promise<number[]>;
  writeHoldingRegisters(addr: number, values: number[]): Promise<void>;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
```

- [ ] **Step 2.2: Commit**

```bash
git add apps/web/server/bridge/bridge.ts
git commit -m "feat(web): ModbusBridge interface"
```

---

## Task 3: Virtual ESP32 bridge (in-memory) — TDD

**Files:**
- Create: `apps/web/test/bridge/virtual-esp32.test.ts`
- Create: `apps/web/server/bridge/virtual-esp32.ts`

- [ ] **Step 3.1: Write failing tests**

```typescript
// test/bridge/virtual-esp32.test.ts
import { describe, it, expect } from 'vitest';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';

describe('VirtualEsp32Bridge', () => {
  it('starts disconnected; connect transitions to connected', async () => {
    const b = new VirtualEsp32Bridge();
    await expect(b.readCoils(0x1000, 1)).rejects.toThrow(/not connected/i);
    await b.connect();
    await expect(b.readCoils(0x1000, 1)).resolves.toHaveLength(1);
  });

  it('discrete inputs default to false', async () => {
    const b = new VirtualEsp32Bridge();
    await b.connect();
    const vals = await b.readDiscreteInputs(0x0000, 4);
    expect(vals).toEqual([false, false, false, false]);
  });

  it('writeDiscreteInputs round-trips through readDiscreteInputs', async () => {
    const b = new VirtualEsp32Bridge();
    await b.connect();
    await b.writeDiscreteInputs(0x0000, [true, false, true, true]);
    const vals = await b.readDiscreteInputs(0x0000, 4);
    expect(vals).toEqual([true, false, true, true]);
  });

  it('coils round-trip', async () => {
    const b = new VirtualEsp32Bridge();
    await b.connect();
    await b.writeCoils(0x1000, [true, true, false]);
    const vals = await b.readCoils(0x1000, 3);
    expect(vals).toEqual([true, true, false]);
  });

  it('holding registers round-trip int16 values', async () => {
    const b = new VirtualEsp32Bridge();
    await b.connect();
    await b.writeHoldingRegisters(0x3000, [2040, -100, 32767, -32768]);
    const vals = await b.readHoldingRegisters(0x3000, 4);
    expect(vals).toEqual([2040, -100, 32767, -32768]);
  });

  it('throws when reading outside any declared space', async () => {
    const b = new VirtualEsp32Bridge();
    await b.connect();
    await expect(b.readCoils(0x9999, 1)).rejects.toThrow(/unknown|out of range/i);
  });

  it('disconnect makes operations throw again', async () => {
    const b = new VirtualEsp32Bridge();
    await b.connect();
    await b.writeCoils(0x1000, [true]);
    await b.disconnect();
    await expect(b.readCoils(0x1000, 1)).rejects.toThrow(/not connected/i);
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

```
pnpm --filter @sim/web test
```

Expected: module not found error.

- [ ] **Step 3.3: Implement `apps/web/server/bridge/virtual-esp32.ts`**

```typescript
import type { ModbusBridge } from './bridge.js';
import { SPACES } from '@sim/protocol/registers';

type SpaceName = keyof typeof SPACES;

/**
 * In-memory implementation of ModbusBridge. Backs each Modbus space with a typed
 * array sized to the space's range. Used in virtual mode (no ESP32 hardware) and
 * in tests. No network, fully synchronous beneath the Promise interface.
 */
export class VirtualEsp32Bridge implements ModbusBridge {
  private connected = false;
  private readonly discreteInputs: Uint8Array;
  private readonly coils: Uint8Array;
  private readonly holding: Int16Array;

  constructor() {
    this.discreteInputs = new Uint8Array(0x1000);
    this.coils = new Uint8Array(0x1000);
    // Holding registers space (0x3000-0x3FFF) + diagnostics (0x4000-0x4FFF):
    // 0x2000 contiguous, addressed by (addr - 0x3000).
    this.holding = new Int16Array(0x2000);
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  private requireConnected(): void {
    if (!this.connected) throw new Error('bridge not connected');
  }

  private offsetIn(space: SpaceName, addr: number, count: number): number {
    const def = SPACES[space];
    if (addr < def.base || addr + count - 1 > def.end) {
      throw new Error(`address 0x${addr.toString(16)} out of range for space "${space}"`);
    }
    return addr - def.base;
  }

  async readDiscreteInputs(addr: number, count: number): Promise<boolean[]> {
    this.requireConnected();
    const off = this.offsetIn('discrete_inputs', addr, count);
    return Array.from(this.discreteInputs.subarray(off, off + count), (b) => b !== 0);
  }

  async writeDiscreteInputs(addr: number, values: boolean[]): Promise<void> {
    this.requireConnected();
    const off = this.offsetIn('discrete_inputs', addr, values.length);
    for (let i = 0; i < values.length; i++) this.discreteInputs[off + i] = values[i] ? 1 : 0;
  }

  async readCoils(addr: number, count: number): Promise<boolean[]> {
    this.requireConnected();
    const off = this.offsetIn('coils', addr, count);
    return Array.from(this.coils.subarray(off, off + count), (b) => b !== 0);
  }

  async writeCoils(addr: number, values: boolean[]): Promise<void> {
    this.requireConnected();
    const off = this.offsetIn('coils', addr, values.length);
    for (let i = 0; i < values.length; i++) this.coils[off + i] = values[i] ? 1 : 0;
  }

  async readHoldingRegisters(addr: number, count: number): Promise<number[]> {
    this.requireConnected();
    // Combined range 0x3000-0x4FFF; offset relative to 0x3000.
    if (addr < 0x3000 || addr + count - 1 > 0x4FFF) {
      throw new Error(`address 0x${addr.toString(16)} out of range for holding/diagnostics`);
    }
    const off = addr - 0x3000;
    return Array.from(this.holding.subarray(off, off + count));
  }

  async writeHoldingRegisters(addr: number, values: number[]): Promise<void> {
    this.requireConnected();
    if (addr < 0x3000 || addr + values.length - 1 > 0x4FFF) {
      throw new Error(`address 0x${addr.toString(16)} out of range for holding/diagnostics`);
    }
    const off = addr - 0x3000;
    for (let i = 0; i < values.length; i++) this.holding[off + i] = values[i];
  }
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

```
pnpm --filter @sim/web test
```

Expected: 7 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add apps/web/test/bridge/virtual-esp32.test.ts apps/web/server/bridge/virtual-esp32.ts
git commit -m "feat(web): virtual ESP32 bridge (in-memory Modbus space)"
```

---

## Task 4: RegisterAccess typed wrapper — TDD

**Files:**
- Create: `apps/web/test/bridge/register-access.test.ts`
- Create: `apps/web/server/bridge/register-access.ts`

- [ ] **Step 4.1: Write failing tests**

```typescript
// test/bridge/register-access.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { RegisterAccess } from '../../server/bridge/register-access.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';

describe('RegisterAccess', () => {
  let bridge: VirtualEsp32Bridge;
  let access: RegisterAccess;

  beforeEach(async () => {
    bridge = new VirtualEsp32Bridge();
    access = new RegisterAccess(bridge);
    await bridge.connect();
  });

  it('reads a discrete input by RegisterId', async () => {
    await bridge.writeDiscreteInputs(0x0000, [true]); // V_STEAM_IN_INT
    expect(await access.getDiscrete('V_STEAM_IN_INT')).toBe(true);
  });

  it('writes a coil by RegisterId', async () => {
    await access.setCoil('PS_STEAM_LINE', true);
    expect(await bridge.readCoils(0x1000, 1)).toEqual([true]);
  });

  it('scaled analog round-trip: P_CHAMBER_INT (scale=1000, bar abs)', async () => {
    await access.setAnalog('P_CHAMBER_INT', 3.04);  // 134°C sat pressure
    const raw = await bridge.readHoldingRegisters(0x3000, 1);
    expect(raw[0]).toBe(3040);  // 3.04 * 1000
    expect(await access.getAnalog('P_CHAMBER_INT')).toBeCloseTo(3.04, 3);
  });

  it('scaled analog round-trip: T_CHAMBER_INT (scale=100, celsius)', async () => {
    await access.setAnalog('T_CHAMBER_INT', 134.0);
    const raw = await bridge.readHoldingRegisters(0x3010, 1);
    expect(raw[0]).toBe(13400);
    expect(await access.getAnalog('T_CHAMBER_INT')).toBeCloseTo(134, 2);
  });

  it('clips analog values to int16 range', async () => {
    await access.setAnalog('P_CHAMBER_INT', 1000);  // way out of range
    const raw = await bridge.readHoldingRegisters(0x3000, 1);
    expect(raw[0]).toBeLessThanOrEqual(32767);
    expect(raw[0]).toBeGreaterThanOrEqual(-32768);
  });

  it('uint16 register without scale reads as raw value', async () => {
    await bridge.writeHoldingRegisters(0x4002, [250]); // WATCHDOG_MS
    expect(await access.getAnalog('WATCHDOG_MS')).toBe(250);
  });

  it('throws when accessing a register with wrong type', async () => {
    // P_CHAMBER_INT is a holding register, not a coil
    await expect(access.getCoil('P_CHAMBER_INT' as never)).rejects.toThrow(/space mismatch/i);
  });
});
```

- [ ] **Step 4.2: Run tests → fail**

- [ ] **Step 4.3: Implement `apps/web/server/bridge/register-access.ts`**

```typescript
import type { ModbusBridge } from './bridge.js';
import { REGISTERS, type RegisterId } from '@sim/protocol/registers';

const INT16_MIN = -32768;
const INT16_MAX = 32767;

export class RegisterAccess {
  constructor(private readonly bridge: ModbusBridge) {}

  private reg(id: RegisterId): (typeof REGISTERS)[RegisterId] {
    const r = REGISTERS[id];
    if (!r) throw new Error(`unknown register "${id}"`);
    return r;
  }

  async getDiscrete(id: RegisterId): Promise<boolean> {
    const r = this.reg(id);
    if (r.space !== 'discrete_inputs') throw new Error(`space mismatch: ${id} is ${r.space}, not discrete_inputs`);
    const [v] = await this.bridge.readDiscreteInputs(r.address, 1);
    return v ?? false;
  }

  async setDiscrete(id: RegisterId, value: boolean): Promise<void> {
    const r = this.reg(id);
    if (r.space !== 'discrete_inputs') throw new Error(`space mismatch: ${id} is ${r.space}, not discrete_inputs`);
    await this.bridge.writeDiscreteInputs(r.address, [value]);
  }

  async getCoil(id: RegisterId): Promise<boolean> {
    const r = this.reg(id);
    if (r.space !== 'coils') throw new Error(`space mismatch: ${id} is ${r.space}, not coils`);
    const [v] = await this.bridge.readCoils(r.address, 1);
    return v ?? false;
  }

  async setCoil(id: RegisterId, value: boolean): Promise<void> {
    const r = this.reg(id);
    if (r.space !== 'coils') throw new Error(`space mismatch: ${id} is ${r.space}, not coils`);
    await this.bridge.writeCoils(r.address, [value]);
  }

  async getAnalog(id: RegisterId): Promise<number> {
    const r = this.reg(id);
    if (r.space !== 'holding_registers' && r.space !== 'diagnostics') {
      throw new Error(`space mismatch: ${id} is ${r.space}, not holding/diagnostics`);
    }
    const [raw] = await this.bridge.readHoldingRegisters(r.address, 1);
    if (raw === undefined) return 0;
    return r.scale !== undefined ? raw / r.scale : raw;
  }

  async setAnalog(id: RegisterId, value: number): Promise<void> {
    const r = this.reg(id);
    if (r.space !== 'holding_registers' && r.space !== 'diagnostics') {
      throw new Error(`space mismatch: ${id} is ${r.space}, not holding/diagnostics`);
    }
    const raw = r.scale !== undefined ? Math.round(value * r.scale) : Math.round(value);
    const clipped = Math.max(INT16_MIN, Math.min(INT16_MAX, raw));
    await this.bridge.writeHoldingRegisters(r.address, [clipped]);
  }
}
```

- [ ] **Step 4.4: Run tests → pass**

- [ ] **Step 4.5: Commit**

```bash
git add apps/web/test/bridge/register-access.test.ts apps/web/server/bridge/register-access.ts
git commit -m "feat(web): RegisterAccess typed wrapper (RegisterId → scaled physical units)"
```

---

## Task 5: Command reader (DI → physics commands) — TDD

**Files:**
- Create: `apps/web/test/orchestrator/command-reader.test.ts`
- Create: `apps/web/server/orchestrator/command-reader.ts`

- [ ] **Step 5.1: Write failing tests**

```typescript
// test/orchestrator/command-reader.test.ts
import { describe, it, expect } from 'vitest';
import { readCommands } from '../../server/orchestrator/command-reader.js';
import { RegisterAccess } from '../../server/bridge/register-access.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';

async function setup() {
  const bridge = new VirtualEsp32Bridge();
  await bridge.connect();
  return { bridge, access: new RegisterAccess(bridge) };
}

describe('readCommands', () => {
  it('maps Discrete Inputs to ValveCommands and ActuatorCommands', async () => {
    const { bridge, access } = await setup();
    await access.setDiscrete('V_VAC', true);
    await access.setDiscrete('V_STEAM_IN_INT', true);
    await access.setDiscrete('PUMP_VAC', true);
    await access.setDiscrete('HEATER_GEN', true);

    const { valves, actuators } = await readCommands(bridge);

    expect(valves.V_VAC).toBe(true);
    expect(valves.V_STEAM_IN_INT).toBe(true);
    expect(valves.V_STEAM_IN_JACKET).toBe(false);
    expect(actuators.pump_vac).toBe(true);
    expect(actuators.heater_gen).toBe(true);
  });

  it('all-off DI yields all false', async () => {
    const { bridge } = await setup();
    const { valves, actuators } = await readCommands(bridge);
    expect(Object.values(valves).every((v) => v === false)).toBe(true);
    expect(actuators.pump_vac).toBe(false);
    expect(actuators.heater_gen).toBe(false);
  });
});
```

- [ ] **Step 5.2: Run tests → fail**

- [ ] **Step 5.3: Implement `apps/web/server/orchestrator/command-reader.ts`**

```typescript
import type { ModbusBridge } from '../bridge/bridge.js';
import { RegisterAccess } from '../bridge/register-access.js';
import { REGISTERS, type RegisterId } from '@sim/protocol/registers';
import type { ValveCommands, ActuatorCommands } from '@sim/physics';

/** Read all discrete inputs and split into the shapes physics expects. */
export async function readCommands(
  bridge: ModbusBridge,
): Promise<{ valves: ValveCommands; actuators: ActuatorCommands }> {
  const access = new RegisterAccess(bridge);
  const valves: ValveCommands = {};
  let pump_vac = false;
  let heater_gen = false;

  for (const [idStr, reg] of Object.entries(REGISTERS)) {
    if (reg.space !== 'discrete_inputs') continue;
    const id = idStr as RegisterId;
    const value = await access.getDiscrete(id);

    if (id === 'PUMP_VAC') pump_vac = value;
    else if (id === 'HEATER_GEN') heater_gen = value;
    else if (id === 'COMPRESSOR') {
      // Not used by physics yet; reserve for future
    } else if (id.startsWith('V_')) {
      valves[id] = value;
    }
  }

  return { valves, actuators: { pump_vac, heater_gen } };
}
```

- [ ] **Step 5.4: Run tests → pass**

- [ ] **Step 5.5: Commit**

```bash
git add apps/web/test/orchestrator/command-reader.test.ts apps/web/server/orchestrator/command-reader.ts
git commit -m "feat(web): command reader (Discrete Inputs → ValveCommands + ActuatorCommands)"
```

---

## Task 6: Sensor publisher (physics state → holdings/coils) — TDD

**Files:**
- Create: `apps/web/test/orchestrator/sensor-publisher.test.ts`
- Create: `apps/web/server/orchestrator/sensor-publisher.ts`

- [ ] **Step 6.1: Write failing tests**

```typescript
// test/orchestrator/sensor-publisher.test.ts
import { describe, it, expect } from 'vitest';
import { publishSensors } from '../../server/orchestrator/sensor-publisher.js';
import { RegisterAccess } from '../../server/bridge/register-access.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';
import type { SystemState, SystemParams } from '@sim/physics';
import { C_to_K, P_ATM, R_AIR } from '@sim/physics';

function makeState(): SystemState {
  const T = C_to_K(134);
  return {
    chamber: { m_air: 0, m_vap: 0.3, m_liq: 0.1, T, T_wall: T },
    jacket: { m_air: 0, m_vap: 0.05, m_liq: 0, T: C_to_K(138), T_wall: C_to_K(138) },
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: { T_metal: C_to_K(133), T_fabric: C_to_K(132) },
    f0_minutes: 100,
    time_s: 600,
  };
}

function makeParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 36000 },
    load: {
      m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500,
      h_gas_metal: 200, h_metal_fabric: 100,
    },
    valves: {},
    external: { steam_line_pressure: 500000, steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
  };
}

describe('publishSensors', () => {
  it('writes chamber/jacket/gen pressures + temperatures to holdings', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    const state = makeState();
    const params = makeParams();

    await publishSensors(bridge, state, params);

    const P_chamber = await access.getAnalog('P_CHAMBER_INT');
    const T_chamber = await access.getAnalog('T_CHAMBER_INT');
    const T_test = await access.getAnalog('T_TESTEMUNHO');
    expect(P_chamber).toBeGreaterThan(2.0);
    expect(P_chamber).toBeLessThan(4.0);
    expect(T_chamber).toBeCloseTo(134, 0);
    expect(T_test).toBeCloseTo(132, 0);
  });

  it('writes F0 (×10, uint16) to F0_X10 diagnostic register', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    const state = makeState();
    const params = makeParams();

    await publishSensors(bridge, state, params);

    const f0_raw = await access.getAnalog('F0_X10');
    expect(f0_raw).toBe(1000);  // 100 min × 10
  });

  it('publishes pressure switch coils based on threshold logic', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    const state = makeState();
    const params = makeParams();

    await publishSensors(bridge, state, params);

    // Steam line pressure switch: external_steam = 5 bar > threshold, should be true
    expect(await access.getCoil('PS_STEAM_LINE')).toBe(true);
  });

  it('publishes door limit switches as closed (default healthy state)', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    await publishSensors(bridge, makeState(), makeParams());

    expect(await access.getCoil('LS_DOOR_CLEAN_CLOSED')).toBe(true);
    expect(await access.getCoil('LS_DOOR_STERILE_CLOSED')).toBe(true);
    expect(await access.getCoil('LS_DOOR_CLEAN_OPEN')).toBe(false);
    expect(await access.getCoil('LS_DOOR_STERILE_OPEN')).toBe(false);
  });

  it('publishes generator level switches based on water level', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    await publishSensors(bridge, makeState(), makeParams());

    // m_water_liq = 10 kg → above min, below max threshold
    expect(await access.getCoil('LVL_GEN_MIN')).toBe(true);
    expect(await access.getCoil('LVL_GEN_MAX')).toBe(false);
  });
});
```

- [ ] **Step 6.2: Run tests → fail**

- [ ] **Step 6.3: Implement `apps/web/server/orchestrator/sensor-publisher.ts`**

```typescript
import type { ModbusBridge } from '../bridge/bridge.js';
import { RegisterAccess } from '../bridge/register-access.js';
import type { SystemState, SystemParams } from '@sim/physics';
import { chamber_pressure, generator_pressure, K_to_C, Pa_to_bar } from '@sim/physics';

/** Steam line "OK" threshold (bar abs). Above this, pressure switch reports true. */
const PS_STEAM_THRESHOLD_BAR = 3.0;
/** Air line "OK" threshold (bar abs). */
const PS_AIR_THRESHOLD_BAR = 4.0;
/** Generator water level min threshold (kg). */
const LVL_GEN_MIN_KG = 1.0;
/** Generator water level max threshold (kg). */
const LVL_GEN_MAX_KG = 25.0;

export async function publishSensors(
  bridge: ModbusBridge,
  state: SystemState,
  params: SystemParams,
): Promise<void> {
  const access = new RegisterAccess(bridge);

  // Pressures
  const pc = chamber_pressure(state.chamber, params.chamber);
  const pj = chamber_pressure(state.jacket, params.jacket);
  const pg = state.generator && params.generator
    ? generator_pressure(state.generator, params.generator)
    : 0;
  await access.setAnalog('P_CHAMBER_INT', Pa_to_bar(pc.p_total));
  await access.setAnalog('P_CHAMBER_EXT', Pa_to_bar(pj.p_total));
  await access.setAnalog('P_GENERATOR', Pa_to_bar(pg));

  // Temperatures
  await access.setAnalog('T_CHAMBER_INT', K_to_C(state.chamber.T));
  await access.setAnalog('T_TESTEMUNHO', K_to_C(state.load.T_fabric));
  await access.setAnalog('T_CHAMBER_EXT', K_to_C(state.jacket.T));
  await access.setAnalog('T_GENERATOR', state.generator ? K_to_C(state.generator.T) : 0);

  // F0 × 10
  await access.setAnalog('F0_X10', state.f0_minutes * 10);

  // Pressure switches (Coils)
  const steamLineOk = Pa_to_bar(params.external.steam_line_pressure) >= PS_STEAM_THRESHOLD_BAR;
  await access.setCoil('PS_STEAM_LINE', steamLineOk);
  await access.setCoil('PS_AIR_LINE', false);  // no compressed air supply modeled yet
  await access.setCoil('PS_SEAL_CLEAN', true);   // assume seals always pressurized
  await access.setCoil('PS_SEAL_STERILE', true);

  // Door limit switches: always healthy (closed) for now
  await access.setCoil('LS_DOOR_CLEAN_OPEN', false);
  await access.setCoil('LS_DOOR_CLEAN_CLOSED', true);
  await access.setCoil('LS_DOOR_STERILE_OPEN', false);
  await access.setCoil('LS_DOOR_STERILE_CLOSED', true);

  // Generator water level switches
  if (state.generator) {
    await access.setCoil('LVL_GEN_MIN', state.generator.m_water_liq > LVL_GEN_MIN_KG);
    await access.setCoil('LVL_GEN_MAX', state.generator.m_water_liq > LVL_GEN_MAX_KG);
  } else {
    await access.setCoil('LVL_GEN_MIN', false);
    await access.setCoil('LVL_GEN_MAX', false);
  }

  // Emergency button: false (not pressed)
  await access.setCoil('EMERGENCY_BTN', false);
}
```

- [ ] **Step 6.4: Run tests → pass**

- [ ] **Step 6.5: Commit**

```bash
git add apps/web/test/orchestrator/sensor-publisher.test.ts apps/web/server/orchestrator/sensor-publisher.ts
git commit -m "feat(web): sensor publisher (physics state → holdings + coils)"
```

---

## Task 7: Orchestrator core (tick loop) — TDD

**Files:**
- Create: `apps/web/test/orchestrator/orchestrator.test.ts`
- Create: `apps/web/server/orchestrator/orchestrator.ts`

- [ ] **Step 7.1: Write failing tests**

```typescript
// test/orchestrator/orchestrator.test.ts
import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../../server/orchestrator/orchestrator.js';
import { RegisterAccess } from '../../server/bridge/register-access.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';
import type { SystemState, SystemParams } from '@sim/physics';
import { C_to_K, P_ATM, R_AIR, GAMMA_AIR, GAMMA_VAP, R_VAP, bar_to_Pa } from '@sim/physics';

function basicParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 36000, relief_pressure_Pa: 454000 },
    load: {
      m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500,
      h_gas_metal: 200, h_metal_fabric: 100,
    },
    valves: {
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR } },
      V_STEAM_IN_INT: { from: 'generator', to: 'chamber', params: { Cv: 8e-6, gamma: GAMMA_VAP, R: R_VAP } },
    },
    external: { steam_line_pressure: bar_to_Pa(5), steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
  };
}

function basicState(p: SystemParams): SystemState {
  const T = C_to_K(22);
  return {
    chamber: { m_air: (P_ATM * p.chamber.V) / (R_AIR * T), m_vap: 0, m_liq: 0, T, T_wall: T },
    jacket: { m_air: (P_ATM * p.jacket.V) / (R_AIR * T), m_vap: 0, m_liq: 0, T, T_wall: T },
    generator: { m_water_liq: 10, m_water_vap: 0, T },
    load: { T_metal: T, T_fabric: T },
    f0_minutes: 0,
    time_s: 0,
  };
}

describe('Orchestrator', () => {
  it('advances physics one dt per tick', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const params = basicParams();
    const initial = basicState(params);
    const orch = new Orchestrator({ bridge, params, initialState: initial, tickDt_s: 0.05 });

    await orch.tick();
    expect(orch.getState().time_s).toBeCloseTo(0.05, 6);

    await orch.tick();
    expect(orch.getState().time_s).toBeCloseTo(0.1, 6);
  });

  it('reads PLC commands from DI and applies to physics', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    const params = basicParams();
    const initial = basicState(params);
    const orch = new Orchestrator({ bridge, params, initialState: initial, tickDt_s: 0.05 });

    // PLC commands V_VAC open + PUMP_VAC on
    await access.setDiscrete('V_VAC', true);
    await access.setDiscrete('PUMP_VAC', true);

    for (let i = 0; i < 600; i++) await orch.tick();  // 30 s sim
    const s = orch.getState();
    // Chamber air mass should drop significantly under vacuum
    expect(s.chamber.m_air).toBeLessThan(initial.chamber.m_air * 0.5);
  });

  it('publishes sensors to holding registers after each tick', async () => {
    const bridge = new VirtualEsp32Bridge();
    await bridge.connect();
    const access = new RegisterAccess(bridge);
    const params = basicParams();
    const initial = basicState(params);
    const orch = new Orchestrator({ bridge, params, initialState: initial, tickDt_s: 0.05 });

    await orch.tick();
    const P_chamber = await access.getAnalog('P_CHAMBER_INT');
    expect(P_chamber).toBeCloseTo(1.013, 1);  // 1 atm
  });
});
```

- [ ] **Step 7.2: Run → fail**

- [ ] **Step 7.3: Implement `apps/web/server/orchestrator/orchestrator.ts`**

```typescript
import type { ModbusBridge } from '../bridge/bridge.js';
import { readCommands } from './command-reader.js';
import { publishSensors } from './sensor-publisher.js';
import { system_step, type SystemState, type SystemParams } from '@sim/physics';

export interface OrchestratorOpts {
  bridge: ModbusBridge;
  params: SystemParams;
  initialState: SystemState;
  tickDt_s: number;
}

export class Orchestrator {
  private state: SystemState;
  private readonly bridge: ModbusBridge;
  private readonly params: SystemParams;
  private readonly dt: number;

  constructor(opts: OrchestratorOpts) {
    this.bridge = opts.bridge;
    this.params = opts.params;
    this.state = opts.initialState;
    this.dt = opts.tickDt_s;
  }

  async tick(): Promise<void> {
    const { valves, actuators } = await readCommands(this.bridge);
    this.state = system_step(this.state, this.params, valves, actuators, this.dt);
    await publishSensors(this.bridge, this.state, this.params);
  }

  getState(): SystemState {
    return this.state;
  }
}
```

- [ ] **Step 7.4: Run → pass**

- [ ] **Step 7.5: Commit**

```bash
git add apps/web/test/orchestrator/orchestrator.test.ts apps/web/server/orchestrator/orchestrator.ts
git commit -m "feat(web): orchestrator tick loop (read commands → step physics → publish sensors)"
```

---

## Task 8: Virtual PLC state machine — TDD

**Files:**
- Create: `apps/web/test/virtual-plc/state-machine.test.ts`
- Create: `apps/web/server/virtual-plc/state-machine.ts`

- [ ] **Step 8.1: Write failing tests**

```typescript
// test/virtual-plc/state-machine.test.ts
import { describe, it, expect } from 'vitest';
import { CycleStateMachine, type CyclePhase } from '../../server/virtual-plc/state-machine.js';
import type { CycleConfig } from '../../server/virtual-plc/cycle-config.js';

function makeCycle(): CycleConfig {
  return {
    name: 'ster-134-prevac',
    sterilization_T_C: 134,
    sterilization_P_bar: 3.04,
    hold_duration_s: 420,
    prevac_pulses: 3,
    prevac_vacuum_target_bar: 0.15,
    prevac_steam_target_bar: 2.0,
    preheat_duration_s: 300,
    dry_duration_s: 500,
    f0_target_min: 100,
  };
}

interface MockSensors {
  P_chamber_bar: number;
  T_test_C: number;
  P_jacket_bar: number;
  F0_min: number;
}

describe('CycleStateMachine', () => {
  it('starts in IDLE', () => {
    const sm = new CycleStateMachine(makeCycle());
    expect(sm.phase).toBe('IDLE');
  });

  it('transitions IDLE → PREHEAT when started', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    expect(sm.phase).toBe('PREHEAT');
  });

  it('transitions PREHEAT → PREVAC_VACUUM after preheat_duration_s', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    const sensors: MockSensors = { P_chamber_bar: 1.0, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 };
    sm.update(150, sensors);
    expect(sm.phase).toBe('PREHEAT');
    sm.update(301, sensors);
    expect(sm.phase).toBe('PREVAC_VACUUM');
  });

  it('PREVAC_VACUUM → PREVAC_STEAM when chamber pressure drops below target', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    const sensors: MockSensors = { P_chamber_bar: 1.0, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 };
    sm.update(301, sensors);
    expect(sm.phase).toBe('PREVAC_VACUUM');

    sm.update(330, { ...sensors, P_chamber_bar: 0.10 });
    expect(sm.phase).toBe('PREVAC_STEAM');
  });

  it('alternates 3 prevac pulses then enters PRESSURIZE', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    let t = 301;
    for (let pulse = 0; pulse < 3; pulse++) {
      sm.update(t, { P_chamber_bar: 1.0, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 });
      expect(sm.phase).toBe('PREVAC_VACUUM');
      sm.update(t + 30, { P_chamber_bar: 0.10, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 });
      expect(sm.phase).toBe('PREVAC_STEAM');
      sm.update(t + 60, { P_chamber_bar: 2.0, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 });
      t += 60;
    }
    expect(sm.phase).toBe('PRESSURIZE');
  });

  it('PRESSURIZE → HOLD when T_test reaches setpoint', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    // Manually advance to PRESSURIZE
    sm.forcePhase('PRESSURIZE', 500);
    sm.update(550, { P_chamber_bar: 3.04, T_test_C: 134, P_jacket_bar: 3.5, F0_min: 0 });
    expect(sm.phase).toBe('HOLD');
  });

  it('HOLD → EXHAUST after hold_duration_s OR F0 target reached', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    sm.forcePhase('HOLD', 600);
    sm.update(610, { P_chamber_bar: 3.04, T_test_C: 134, P_jacket_bar: 3.5, F0_min: 50 });
    expect(sm.phase).toBe('HOLD');
    sm.update(1030, { P_chamber_bar: 3.04, T_test_C: 134, P_jacket_bar: 3.5, F0_min: 150 });
    expect(sm.phase).toBe('EXHAUST');
  });

  it('EXHAUST → DRY when chamber pressure drops near atmospheric', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    sm.forcePhase('EXHAUST', 1100);
    sm.update(1120, { P_chamber_bar: 0.9, T_test_C: 100, P_jacket_bar: 3.5, F0_min: 150 });
    expect(sm.phase).toBe('DRY');
  });

  it('DRY → COMPLETE after dry_duration_s', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    sm.forcePhase('DRY', 1200);
    sm.update(1700, { P_chamber_bar: 0.1, T_test_C: 80, P_jacket_bar: 3.5, F0_min: 150 });
    expect(sm.phase).toBe('DRY');
    sm.update(1701, { P_chamber_bar: 0.1, T_test_C: 80, P_jacket_bar: 3.5, F0_min: 150 });
    expect(sm.phase).toBe('COMPLETE');
  });

  it('tracks current prevac pulse count', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    sm.update(301, { P_chamber_bar: 1.0, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 });
    expect(sm.prevacPulseIndex).toBe(0);
    sm.update(330, { P_chamber_bar: 0.10, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 });
    sm.update(360, { P_chamber_bar: 2.0, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 });
    expect(sm.prevacPulseIndex).toBe(1);
  });
});
```

- [ ] **Step 8.2: Run → fail**

- [ ] **Step 8.3: Implement `apps/web/server/virtual-plc/cycle-config.ts`**

```typescript
import { z } from 'zod';

export const CycleConfigSchema = z.object({
  name: z.string(),
  sterilization_T_C: z.number(),
  sterilization_P_bar: z.number(),
  hold_duration_s: z.number().positive(),
  prevac_pulses: z.number().int().nonnegative(),
  prevac_vacuum_target_bar: z.number().positive(),
  prevac_steam_target_bar: z.number().positive(),
  preheat_duration_s: z.number().nonnegative(),
  dry_duration_s: z.number().nonnegative(),
  f0_target_min: z.number().nonnegative(),
});
export type CycleConfig = z.infer<typeof CycleConfigSchema>;
```

- [ ] **Step 8.4: Implement `apps/web/server/virtual-plc/state-machine.ts`**

```typescript
import type { CycleConfig } from './cycle-config.js';

export type CyclePhase =
  | 'IDLE'
  | 'PREHEAT'
  | 'PREVAC_VACUUM'
  | 'PREVAC_STEAM'
  | 'PRESSURIZE'
  | 'HOLD'
  | 'EXHAUST'
  | 'DRY'
  | 'COMPLETE';

export interface PLCSensors {
  P_chamber_bar: number;
  T_test_C: number;
  P_jacket_bar: number;
  F0_min: number;
}

export class CycleStateMachine {
  phase: CyclePhase = 'IDLE';
  prevacPulseIndex = 0;
  phaseStartedAt = 0;
  private steamPulseTargetReached = false;

  constructor(private readonly cycle: CycleConfig) {}

  start(): void {
    this.phase = 'PREHEAT';
    this.phaseStartedAt = 0;
    this.prevacPulseIndex = 0;
  }

  /** Forces a transition for testing. */
  forcePhase(phase: CyclePhase, at_time_s: number): void {
    this.phase = phase;
    this.phaseStartedAt = at_time_s;
  }

  /** Advance phase logic given current time and sensor readings. */
  update(time_s: number, s: PLCSensors): void {
    const elapsed = time_s - this.phaseStartedAt;

    switch (this.phase) {
      case 'IDLE':
        return;

      case 'PREHEAT':
        if (elapsed >= this.cycle.preheat_duration_s) this.transition('PREVAC_VACUUM', time_s);
        return;

      case 'PREVAC_VACUUM':
        if (s.P_chamber_bar <= this.cycle.prevac_vacuum_target_bar) {
          this.transition('PREVAC_STEAM', time_s);
        }
        return;

      case 'PREVAC_STEAM':
        if (s.P_chamber_bar >= this.cycle.prevac_steam_target_bar) {
          this.prevacPulseIndex++;
          if (this.prevacPulseIndex >= this.cycle.prevac_pulses) {
            this.transition('PRESSURIZE', time_s);
          } else {
            this.transition('PREVAC_VACUUM', time_s);
          }
        }
        return;

      case 'PRESSURIZE':
        if (s.T_test_C >= this.cycle.sterilization_T_C) {
          this.transition('HOLD', time_s);
        }
        return;

      case 'HOLD':
        if (elapsed >= this.cycle.hold_duration_s || s.F0_min >= this.cycle.f0_target_min) {
          this.transition('EXHAUST', time_s);
        }
        return;

      case 'EXHAUST':
        if (s.P_chamber_bar < 1.0) this.transition('DRY', time_s);
        return;

      case 'DRY':
        if (elapsed > this.cycle.dry_duration_s) this.transition('COMPLETE', time_s);
        return;

      case 'COMPLETE':
        return;
    }
  }

  private transition(next: CyclePhase, at_time_s: number): void {
    this.phase = next;
    this.phaseStartedAt = at_time_s;
  }
}
```

- [ ] **Step 8.5: Run → pass**

- [ ] **Step 8.6: Commit**

```bash
git add apps/web/test/virtual-plc/state-machine.test.ts apps/web/server/virtual-plc/cycle-config.ts apps/web/server/virtual-plc/state-machine.ts
git commit -m "feat(web): cycle state machine (IDLE → PREHEAT → ... → COMPLETE)"
```

---

## Task 9: Virtual PLC valve commander — TDD

**Files:**
- Create: `apps/web/test/virtual-plc/plc.test.ts`
- Create: `apps/web/server/virtual-plc/plc.ts`

The PLC class derives valve/actuator commands per phase and writes them to the bridge (so the orchestrator reads them next tick).

- [ ] **Step 9.1: Write failing tests**

```typescript
// test/virtual-plc/plc.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualPLC } from '../../server/virtual-plc/plc.js';
import type { CycleConfig } from '../../server/virtual-plc/cycle-config.js';
import { RegisterAccess } from '../../server/bridge/register-access.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';

function makeCycle(): CycleConfig {
  return {
    name: 'test',
    sterilization_T_C: 134,
    sterilization_P_bar: 3.04,
    hold_duration_s: 420,
    prevac_pulses: 3,
    prevac_vacuum_target_bar: 0.15,
    prevac_steam_target_bar: 2.0,
    preheat_duration_s: 300,
    dry_duration_s: 500,
    f0_target_min: 100,
  };
}

async function setup(): Promise<{ bridge: VirtualEsp32Bridge; access: RegisterAccess; plc: VirtualPLC }> {
  const bridge = new VirtualEsp32Bridge();
  await bridge.connect();
  const access = new RegisterAccess(bridge);
  const plc = new VirtualPLC(makeCycle(), bridge);
  return { bridge, access, plc };
}

async function setSensors(access: RegisterAccess, s: { P_chamber: number; T_test: number; P_jacket: number; F0: number }) {
  await access.setAnalog('P_CHAMBER_INT', s.P_chamber);
  await access.setAnalog('T_TESTEMUNHO', s.T_test);
  await access.setAnalog('P_CHAMBER_EXT', s.P_jacket);
  await access.setAnalog('F0_X10', s.F0 * 10);
}

describe('VirtualPLC', () => {
  it('does nothing in IDLE: all valves off', async () => {
    const { access, plc } = await setup();
    await plc.tick(0);
    expect(await access.getDiscrete('V_VAC')).toBe(false);
    expect(await access.getDiscrete('V_STEAM_IN_INT')).toBe(false);
    expect(await access.getDiscrete('HEATER_GEN')).toBe(false);
  });

  it('PREHEAT: opens V_STEAM_IN_JACKET + HEATER_GEN', async () => {
    const { access, plc } = await setup();
    plc.start();
    await setSensors(access, { P_chamber: 1.0, T_test: 22, P_jacket: 1.0, F0: 0 });
    await plc.tick(10);
    expect(await access.getDiscrete('V_STEAM_IN_JACKET')).toBe(true);
    expect(await access.getDiscrete('HEATER_GEN')).toBe(true);
    expect(await access.getDiscrete('V_STEAM_IN_INT')).toBe(false);
    expect(await access.getDiscrete('V_VAC')).toBe(false);
  });

  it('PREVAC_VACUUM: opens V_VAC + PUMP_VAC, keeps V_STEAM_IN_JACKET', async () => {
    const { access, plc } = await setup();
    plc.start();
    await setSensors(access, { P_chamber: 1.0, T_test: 22, P_jacket: 3.5, F0: 0 });
    await plc.tick(301);
    expect(await access.getDiscrete('V_VAC')).toBe(true);
    expect(await access.getDiscrete('PUMP_VAC')).toBe(true);
    expect(await access.getDiscrete('V_STEAM_IN_JACKET')).toBe(true);
  });

  it('PREVAC_STEAM: opens V_STEAM_IN_INT, closes V_VAC + PUMP_VAC', async () => {
    const { access, plc } = await setup();
    plc.start();
    await setSensors(access, { P_chamber: 1.0, T_test: 22, P_jacket: 3.5, F0: 0 });
    await plc.tick(301);
    await setSensors(access, { P_chamber: 0.10, T_test: 22, P_jacket: 3.5, F0: 0 });
    await plc.tick(330);
    expect(await access.getDiscrete('V_STEAM_IN_INT')).toBe(true);
    expect(await access.getDiscrete('V_VAC')).toBe(false);
    expect(await access.getDiscrete('PUMP_VAC')).toBe(false);
  });

  it('EXHAUST: opens V_EXHAUST, closes everything else', async () => {
    const { access, plc } = await setup();
    plc.start();
    plc.forcePhase('EXHAUST', 1100);
    await setSensors(access, { P_chamber: 3.0, T_test: 134, P_jacket: 3.5, F0: 100 });
    await plc.tick(1110);
    expect(await access.getDiscrete('V_EXHAUST')).toBe(true);
    expect(await access.getDiscrete('V_STEAM_IN_INT')).toBe(false);
    expect(await access.getDiscrete('HEATER_GEN')).toBe(false);
  });

  it('phase becomes COMPLETE after full cycle progression', async () => {
    const { access, plc } = await setup();
    plc.start();
    plc.forcePhase('DRY', 1200);
    await setSensors(access, { P_chamber: 0.1, T_test: 80, P_jacket: 3.5, F0: 150 });
    await plc.tick(1701);
    expect(plc.getPhase()).toBe('COMPLETE');
    expect(await access.getDiscrete('V_VAC')).toBe(false);
    expect(await access.getDiscrete('PUMP_VAC')).toBe(false);
  });
});
```

- [ ] **Step 9.2: Run → fail**

- [ ] **Step 9.3: Implement `apps/web/server/virtual-plc/plc.ts`**

```typescript
import type { ModbusBridge } from '../bridge/bridge.js';
import { RegisterAccess } from '../bridge/register-access.js';
import { CycleStateMachine, type CyclePhase, type PLCSensors } from './state-machine.js';
import type { CycleConfig } from './cycle-config.js';
import type { RegisterId } from '@sim/protocol/registers';

interface ValveSetpoints {
  V_STEAM_IN_INT?: boolean;
  V_STEAM_IN_JACKET?: boolean;
  V_AIR_IN?: boolean;
  V_VAC?: boolean;
  V_EXHAUST?: boolean;
  V_DRAIN_INT?: boolean;
  V_DRAIN_JACKET?: boolean;
  V_GEN_WATER_IN?: boolean;
  PUMP_VAC?: boolean;
  HEATER_GEN?: boolean;
}

const ALL_VALVES: (keyof ValveSetpoints)[] = [
  'V_STEAM_IN_INT', 'V_STEAM_IN_JACKET', 'V_AIR_IN', 'V_VAC', 'V_EXHAUST',
  'V_DRAIN_INT', 'V_DRAIN_JACKET', 'V_GEN_WATER_IN', 'PUMP_VAC', 'HEATER_GEN',
];

export class VirtualPLC {
  private readonly sm: CycleStateMachine;
  private readonly access: RegisterAccess;

  constructor(cycle: CycleConfig, bridge: ModbusBridge) {
    this.sm = new CycleStateMachine(cycle);
    this.access = new RegisterAccess(bridge);
  }

  start(): void { this.sm.start(); }
  getPhase(): CyclePhase { return this.sm.phase; }
  forcePhase(phase: CyclePhase, at_time_s: number): void { this.sm.forcePhase(phase, at_time_s); }

  async tick(time_s: number): Promise<void> {
    const sensors = await this.readSensors();
    this.sm.update(time_s, sensors);
    const setpoints = this.commandsFor(this.sm.phase);
    await this.applyValves(setpoints);
  }

  private async readSensors(): Promise<PLCSensors> {
    return {
      P_chamber_bar: await this.access.getAnalog('P_CHAMBER_INT'),
      T_test_C: await this.access.getAnalog('T_TESTEMUNHO'),
      P_jacket_bar: await this.access.getAnalog('P_CHAMBER_EXT'),
      F0_min: (await this.access.getAnalog('F0_X10')) / 10,
    };
  }

  private commandsFor(phase: CyclePhase): ValveSetpoints {
    switch (phase) {
      case 'IDLE':
      case 'COMPLETE':
        return {};
      case 'PREHEAT':
        return { V_STEAM_IN_JACKET: true, HEATER_GEN: true };
      case 'PREVAC_VACUUM':
        return { V_STEAM_IN_JACKET: true, V_VAC: true, PUMP_VAC: true, HEATER_GEN: true };
      case 'PREVAC_STEAM':
        return { V_STEAM_IN_JACKET: true, V_STEAM_IN_INT: true, HEATER_GEN: true };
      case 'PRESSURIZE':
      case 'HOLD':
        return { V_STEAM_IN_JACKET: true, V_STEAM_IN_INT: true, HEATER_GEN: true };
      case 'EXHAUST':
        return { V_EXHAUST: true };
      case 'DRY':
        return { V_STEAM_IN_JACKET: true, V_VAC: true, PUMP_VAC: true, HEATER_GEN: true };
    }
  }

  private async applyValves(setpoints: ValveSetpoints): Promise<void> {
    for (const id of ALL_VALVES) {
      const desired = setpoints[id] ?? false;
      await this.access.setDiscrete(id as RegisterId, desired);
    }
  }
}
```

- [ ] **Step 9.4: Run → pass**

- [ ] **Step 9.5: Commit**

```bash
git add apps/web/test/virtual-plc/plc.test.ts apps/web/server/virtual-plc/plc.ts
git commit -m "feat(web): VirtualPLC valve commander (writes valve setpoints via bridge)"
```

---

## Task 10: Scenario runner — TDD

**Files:**
- Create: `apps/web/test/scenario-runner/runner.test.ts`
- Create: `apps/web/server/scenario-runner/runner.ts`

- [ ] **Step 10.1: Write failing tests**

```typescript
// test/scenario-runner/runner.test.ts
import { describe, it, expect } from 'vitest';
import { runScenario, type ScenarioResult } from '../../server/scenario-runner/runner.js';
import type { CycleConfig } from '../../server/virtual-plc/cycle-config.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';
import type { SystemParams, SystemState } from '@sim/physics';
import { C_to_K, P_ATM, R_AIR, GAMMA_AIR, GAMMA_VAP, R_VAP, bar_to_Pa } from '@sim/physics';

function basicParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true, relief_pressure_Pa: 304000 },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 36000, relief_pressure_Pa: 454000 },
    load: {
      m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500,
      h_gas_metal: 200, h_metal_fabric: 100,
    },
    valves: {
      V_STEAM_IN_INT: { from: 'generator', to: 'chamber', params: { Cv: 8e-6, gamma: GAMMA_VAP, R: R_VAP } },
      V_STEAM_IN_JACKET: {
        from: 'generator', to: 'jacket',
        params: { Cv: 1e-6, gamma: GAMMA_VAP, R: R_VAP },
        thermostat: { target: 'jacket', close_at_Pa: bar_to_Pa(3.54), reopen_at_Pa: bar_to_Pa(3.34) },
      },
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR } },
      V_EXHAUST: { from: 'chamber', to: 'atmosphere', params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR } },
    },
    external: { steam_line_pressure: bar_to_Pa(5), steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
    jacket_chamber_h_W_per_K: 150,
  };
}

function preheatedState(p: SystemParams): SystemState {
  const T_amb = C_to_K(22);
  const T_hot = C_to_K(138);
  return {
    chamber: { m_air: (P_ATM * p.chamber.V) / (R_AIR * T_amb), m_vap: 0, m_liq: 0, T: T_amb, T_wall: T_hot },
    jacket: { m_air: 0, m_vap: 0.047, m_liq: 0, T: T_hot, T_wall: T_hot },
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: { T_metal: T_amb, T_fabric: T_amb },
    f0_minutes: 0,
    time_s: 0,
  };
}

const shortCycle: CycleConfig = {
  name: 'unit-test',
  sterilization_T_C: 134,
  sterilization_P_bar: 3.04,
  hold_duration_s: 60,
  prevac_pulses: 2,
  prevac_vacuum_target_bar: 0.25,
  prevac_steam_target_bar: 2.0,
  preheat_duration_s: 30,
  dry_duration_s: 60,
  f0_target_min: 20,
};

describe('runScenario', () => {
  it('runs a full cycle to COMPLETE within timeout', async () => {
    const params = basicParams();
    const initial = preheatedState(params);
    const result = await runScenario({
      cycle: shortCycle,
      params,
      initialState: initial,
      bridge: new VirtualEsp32Bridge(),
      tickDt_s: 0.05,
      max_duration_s: 1500,
    });

    expect(result.completed).toBe(true);
    expect(result.final_phase).toBe('COMPLETE');
    expect(result.f0_min).toBeGreaterThan(0);
  }, 60000);

  it('returns result with timing + final F0 + phase history', async () => {
    const params = basicParams();
    const initial = preheatedState(params);
    const result = await runScenario({
      cycle: shortCycle,
      params,
      initialState: initial,
      bridge: new VirtualEsp32Bridge(),
      tickDt_s: 0.05,
      max_duration_s: 1500,
    });

    expect(result.elapsed_s).toBeGreaterThan(0);
    expect(result.phase_history.length).toBeGreaterThan(0);
    expect(result.phase_history[0]?.phase).toBe('PREHEAT');
  }, 60000);

  it('times out if cycle never completes', async () => {
    const params = basicParams();
    const initial = preheatedState(params);
    const result = await runScenario({
      cycle: shortCycle,
      params,
      initialState: initial,
      bridge: new VirtualEsp32Bridge(),
      tickDt_s: 0.05,
      max_duration_s: 1,  // 1 s — way too short
    });

    expect(result.completed).toBe(false);
    expect(result.timed_out).toBe(true);
  }, 30000);
});
```

- [ ] **Step 10.2: Run → fail**

- [ ] **Step 10.3: Implement `apps/web/server/scenario-runner/runner.ts`**

```typescript
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { VirtualPLC } from '../virtual-plc/plc.js';
import type { CycleConfig } from '../virtual-plc/cycle-config.js';
import type { CyclePhase } from '../virtual-plc/state-machine.js';
import type { ModbusBridge } from '../bridge/bridge.js';
import type { SystemParams, SystemState } from '@sim/physics';

export interface ScenarioOpts {
  cycle: CycleConfig;
  params: SystemParams;
  initialState: SystemState;
  bridge: ModbusBridge;
  tickDt_s: number;
  max_duration_s: number;
}

export interface PhaseHistoryEntry {
  phase: CyclePhase;
  entered_at_s: number;
}

export interface ScenarioResult {
  completed: boolean;
  timed_out: boolean;
  final_phase: CyclePhase;
  elapsed_s: number;
  f0_min: number;
  phase_history: PhaseHistoryEntry[];
  final_state: SystemState;
}

export async function runScenario(opts: ScenarioOpts): Promise<ScenarioResult> {
  await opts.bridge.connect();
  const orch = new Orchestrator({
    bridge: opts.bridge,
    params: opts.params,
    initialState: opts.initialState,
    tickDt_s: opts.tickDt_s,
  });
  const plc = new VirtualPLC(opts.cycle, opts.bridge);

  // Bootstrap sensors so the PLC sees a valid state on tick 0
  await orch.tick();

  plc.start();
  const phase_history: PhaseHistoryEntry[] = [{ phase: plc.getPhase(), entered_at_s: 0 }];

  const max_ticks = Math.ceil(opts.max_duration_s / opts.tickDt_s);
  let last_phase = plc.getPhase();

  for (let i = 0; i < max_ticks; i++) {
    const t = orch.getState().time_s;
    await plc.tick(t);
    await orch.tick();

    const phase = plc.getPhase();
    if (phase !== last_phase) {
      phase_history.push({ phase, entered_at_s: t });
      last_phase = phase;
    }
    if (phase === 'COMPLETE') {
      return {
        completed: true,
        timed_out: false,
        final_phase: 'COMPLETE',
        elapsed_s: orch.getState().time_s,
        f0_min: orch.getState().f0_minutes,
        phase_history,
        final_state: orch.getState(),
      };
    }
  }

  return {
    completed: false,
    timed_out: true,
    final_phase: plc.getPhase(),
    elapsed_s: orch.getState().time_s,
    f0_min: orch.getState().f0_minutes,
    phase_history,
    final_state: orch.getState(),
  };
}
```

- [ ] **Step 10.4: Run → pass**

- [ ] **Step 10.5: Commit**

```bash
git add apps/web/test/scenario-runner/runner.test.ts apps/web/server/scenario-runner/runner.ts
git commit -m "feat(web): scenario runner (orchestrator + virtual PLC for full cycle)"
```

---

## Task 11: Integration — 134°C cycle green

**Files:**
- Create: `apps/web/test/scenario-runner/integration-ster-134.test.ts`
- Create: `apps/web/server/scenarios/ster-134-prevac.yaml`

- [ ] **Step 11.1: Write the scenario YAML**

```yaml
# apps/web/server/scenarios/ster-134-prevac.yaml
name: ster-134-prevac
sterilization_T_C: 134
sterilization_P_bar: 3.04
hold_duration_s: 420       # 7 min
prevac_pulses: 3
prevac_vacuum_target_bar: 0.20
prevac_steam_target_bar: 2.0
preheat_duration_s: 60     # short — start preheated
dry_duration_s: 300
f0_target_min: 100
```

- [ ] **Step 11.2: Write failing integration test**

```typescript
// test/scenario-runner/integration-ster-134.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { runScenario } from '../../server/scenario-runner/runner.js';
import { CycleConfigSchema } from '../../server/virtual-plc/cycle-config.js';
import { VirtualEsp32Bridge } from '../../server/bridge/virtual-esp32.js';
import type { SystemParams, SystemState } from '@sim/physics';
import { C_to_K, P_ATM, R_AIR, GAMMA_AIR, GAMMA_VAP, R_VAP, bar_to_Pa } from '@sim/physics';

function makeParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200, relief_pressure_Pa: bar_to_Pa(3.04) },
    jacket: { V: 0.025, allowLiquid: false, wall_mass_kg: 15, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 100 },
    generator: { V_total: 0.05, heater_power_W: 36000, relief_pressure_Pa: bar_to_Pa(4.54) },
    load: {
      m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500,
      h_gas_metal: 200, h_metal_fabric: 100,
    },
    valves: {
      V_STEAM_IN_INT: { from: 'generator', to: 'chamber', params: { Cv: 8e-6, gamma: GAMMA_VAP, R: R_VAP } },
      V_STEAM_IN_JACKET: {
        from: 'generator', to: 'jacket',
        params: { Cv: 1e-6, gamma: GAMMA_VAP, R: R_VAP },
        thermostat: { target: 'jacket', close_at_Pa: bar_to_Pa(3.54), reopen_at_Pa: bar_to_Pa(3.34) },
      },
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR } },
      V_EXHAUST: { from: 'chamber', to: 'atmosphere', params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR } },
      V_AIR_IN: { from: 'atmosphere', to: 'chamber', params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR } },
    },
    external: { steam_line_pressure: bar_to_Pa(5), steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
    jacket_chamber_h_W_per_K: 150,
  };
}

function preheatedInitial(p: SystemParams): SystemState {
  const T_amb = C_to_K(22);
  const T_hot = C_to_K(138);
  return {
    chamber: { m_air: (P_ATM * p.chamber.V) / (R_AIR * T_amb), m_vap: 0, m_liq: 0, T: T_amb, T_wall: T_hot },
    jacket: { m_air: 0, m_vap: 0.047, m_liq: 0, T: T_hot, T_wall: T_hot },
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: { T_metal: T_amb, T_fabric: T_amb },
    f0_minutes: 0,
    time_s: 0,
  };
}

describe('Integration: 134°C pre-vacuum cycle via virtual PLC', () => {
  it('completes the cycle and reaches F0 ≥ 100', async () => {
    const yamlText = readFileSync(
      resolve(__dirname, '../../server/scenarios/ster-134-prevac.yaml'),
      'utf8',
    );
    const cycle = CycleConfigSchema.parse(yaml.load(yamlText));
    const params = makeParams();
    const initial = preheatedInitial(params);

    const result = await runScenario({
      cycle,
      params,
      initialState: initial,
      bridge: new VirtualEsp32Bridge(),
      tickDt_s: 0.05,
      max_duration_s: 3600,
    });

    expect(result.completed).toBe(true);
    expect(result.final_phase).toBe('COMPLETE');
    expect(result.f0_min).toBeGreaterThanOrEqual(100);
    expect(result.phase_history.map((p) => p.phase)).toContain('HOLD');
  }, 180000);
});
```

- [ ] **Step 11.3: Run → likely fails first (timing / PID tuning)**

If F0 doesn't reach 100, tune in this order:
- preheat_duration too short → starts prevac before generator hot. Raise.
- prevac_pulses not removing enough air → chamber doesn't reach 134°C. Reduce prevac_vacuum_target_bar.
- hold_duration too short → F0 plateau before target. Raise.
- chamber relief_pressure too tight → P stuck below 3.04. Loosen.

After tuning, re-run.

- [ ] **Step 11.4: Confirm green**

```
pnpm --filter @sim/web test
```

All passing.

- [ ] **Step 11.5: Commit**

```bash
git add apps/web/test/scenario-runner/integration-ster-134.test.ts apps/web/server/scenarios/ster-134-prevac.yaml
git commit -m "test(web): 134°C cycle integration (closed-loop virtual PLC reaches F0 ≥ 100)"
```

---

## Task 12: CLI runner + finalize

**Files:**
- Create: `apps/web/server/scenario-runner/cli.ts`
- Modify: `TODO.md`

- [ ] **Step 12.1: Implement `apps/web/server/scenario-runner/cli.ts`**

```typescript
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { runScenario } from './runner.js';
import { CycleConfigSchema } from '../virtual-plc/cycle-config.js';
import { VirtualEsp32Bridge } from '../bridge/virtual-esp32.js';
import type { SystemParams, SystemState } from '@sim/physics';
import { C_to_K, P_ATM, R_AIR, GAMMA_AIR, GAMMA_VAP, R_VAP, bar_to_Pa } from '@sim/physics';

function defaultParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200, relief_pressure_Pa: bar_to_Pa(3.04) },
    jacket: { V: 0.025, allowLiquid: false, wall_mass_kg: 15, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 100 },
    generator: { V_total: 0.05, heater_power_W: 36000, relief_pressure_Pa: bar_to_Pa(4.54) },
    load: { m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500, h_gas_metal: 200, h_metal_fabric: 100 },
    valves: {
      V_STEAM_IN_INT: { from: 'generator', to: 'chamber', params: { Cv: 8e-6, gamma: GAMMA_VAP, R: R_VAP } },
      V_STEAM_IN_JACKET: {
        from: 'generator', to: 'jacket',
        params: { Cv: 1e-6, gamma: GAMMA_VAP, R: R_VAP },
        thermostat: { target: 'jacket', close_at_Pa: bar_to_Pa(3.54), reopen_at_Pa: bar_to_Pa(3.34) },
      },
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR } },
      V_EXHAUST: { from: 'chamber', to: 'atmosphere', params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR } },
      V_AIR_IN: { from: 'atmosphere', to: 'chamber', params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR } },
    },
    external: { steam_line_pressure: bar_to_Pa(5), steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
    jacket_chamber_h_W_per_K: 150,
  };
}

function preheatedInitial(p: SystemParams): SystemState {
  const T_amb = C_to_K(22);
  const T_hot = C_to_K(138);
  return {
    chamber: { m_air: (P_ATM * p.chamber.V) / (R_AIR * T_amb), m_vap: 0, m_liq: 0, T: T_amb, T_wall: T_hot },
    jacket: { m_air: 0, m_vap: 0.047, m_liq: 0, T: T_hot, T_wall: T_hot },
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: { T_metal: T_amb, T_fabric: T_amb },
    f0_minutes: 0,
    time_s: 0,
  };
}

export async function main(scenarioPath: string): Promise<number> {
  const yamlText = readFileSync(scenarioPath, 'utf8');
  const cycle = CycleConfigSchema.parse(yaml.load(yamlText));
  const params = defaultParams();
  const initial = preheatedInitial(params);

  console.log(`[scenario] Running ${cycle.name} (max ${3600}s sim time)...`);
  const start = Date.now();
  const result = await runScenario({
    cycle, params, initialState: initial,
    bridge: new VirtualEsp32Bridge(),
    tickDt_s: 0.05,
    max_duration_s: 3600,
  });
  const wall = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`[scenario] ${result.completed ? 'COMPLETED' : 'TIMED OUT'} in ${result.elapsed_s.toFixed(1)}s sim (${wall}s wall)`);
  console.log(`[scenario] Final phase: ${result.final_phase}`);
  console.log(`[scenario] Final F0: ${result.f0_min.toFixed(2)} min`);
  console.log('[scenario] Phase history:');
  for (const p of result.phase_history) {
    console.log(`  t=${p.entered_at_s.toFixed(1).padStart(7)} s  → ${p.phase}`);
  }

  return result.completed && result.f0_min >= cycle.f0_target_min ? 0 : 1;
}

const isMain = (() => {
  try { return fileURLToPath(import.meta.url) === (process.argv[1] ? resolve(process.argv[1]) : ''); }
  catch { return false; }
})();

if (isMain) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: tsx server/scenario-runner/cli.ts <scenario.yaml>');
    process.exit(1);
  }
  main(resolve(process.cwd(), arg)).then((code) => process.exit(code));
}
```

- [ ] **Step 12.2: Smoke run**

```
pnpm --filter @sim/web scenario:run server/scenarios/ster-134-prevac.yaml
```

Expected output: phase progression printed, final F0 ≥ 100, exit code 0.

- [ ] **Step 12.3: Update TODO.md**

Move sub-projeto 3 from "Em curso" to "Feito" with today's date 2026-05-26.

```markdown
## Feito

- 2026-05-26 — Sub-projeto 3 — Orchestrator + virtual bridge + scenario runner (apps/web: ModbusBridge interface, VirtualEsp32Bridge in-memory, RegisterAccess typed wrapper, Orchestrator tick loop, VirtualPLC state machine + valve commander, scenario runner driving closed-loop 134°C cycle to F0 ≥ 100 entirely virtual)
- 2026-05-25 — Sub-projeto 2.5 — Physics hardening + jacket bang-bang + condensation latent heat fix
- (previous entries unchanged)
```

- [ ] **Step 12.4: Commit + push**

```bash
git add apps/web/server/scenario-runner/cli.ts TODO.md
git commit -m "feat(web): scenario CLI runner + mark sub-projeto 3 complete"
git push origin master
```

---

## Done criteria

- 12 tasks above complete.
- All vitest tests pass (target: 30+ new tests in apps/web).
- `pnpm --filter @sim/web scenario:run server/scenarios/ster-134-prevac.yaml` exits 0 with F0 ≥ 100.
- Type check clean.
- Lint clean.
- CI green on GitHub.
- TODO.md updated.

---

## What this plan does NOT cover (deferred)

- **Real Modbus TCP bridge** — sub-projeto 5 (firmware ESP32). Skeleton bridge.ts exists; concrete TCP client implementation lands when there's a real ESP32 to talk to.
- **WebSocket snapshot stream** — sub-projeto 4 (dashboard).
- **Next.js routes / dashboard** — sub-projeto 4.
- **Fault injection** — sub-projeto 6.
- **PID controller on chamber** — current PLC uses bang-bang via thermostat valves + relief setpoints. PID lands if the bang-bang misbehaves on more complex cycles.
- **121°C gravity cycle, drying-only scenario** — easy to add as additional YAMLs after the framework is in place; not required to declare sub-projeto 3 done.
