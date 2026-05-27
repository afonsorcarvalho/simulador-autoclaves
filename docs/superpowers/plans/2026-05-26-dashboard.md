# Dashboard MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js dashboard that drives the orchestrator in real time, shows live cycle progress (phase, pressures, temperatures, F0) through a Server-Sent Events stream, and offers a Virtual PLC control panel for starting/stopping cycles and manually toggling valves when idle.

**Architecture:** Server-side singleton runtime (Orchestrator + VirtualPLC + bridge) ticks under a real-time scheduler in the Next.js server process. SSE route streams snapshots @ 10 Hz to React clients. API routes mutate runtime state (start/stop cycle, manual valve override). Client uses a `useSnapshot()` hook + Recharts for live visualization. No Modbus TCP / no real ESP32 — virtual mode only (real bridge lands in sub-projeto 5). No equipment CRUD / no SQLite — config stays in scenario YAML (deferred).

**Tech Stack:** Next.js 14 App Router, React 18, TailwindCSS 3, Recharts 2, vitest 2. SSE via ReadableStream in Route Handler (no extra ws lib). Singleton state via `globalThis` (survives Next.js HMR in dev).

---

## File Structure

Root: `apps/web/` (already scaffolded by sub-projeto 3).

```
apps/web/
├── app/
│   ├── layout.tsx               # NEW: root layout (nav, fonts, tailwind)
│   ├── page.tsx                 # MODIFY: home — status overview + cycle controls
│   ├── live/page.tsx            # NEW: live monitor (charts + valves)
│   ├── virtual-plc/page.tsx     # NEW: manual control panel
│   ├── globals.css              # NEW: tailwind base
│   └── api/
│       ├── snapshot/stream/route.ts   # NEW: SSE stream
│       ├── cycle/start/route.ts       # NEW: POST start
│       ├── cycle/stop/route.ts        # NEW: POST stop
│       ├── cycle/status/route.ts      # NEW: GET status
│       └── valves/[id]/route.ts       # NEW: POST manual valve override
├── server/
│   ├── runtime/
│   │   ├── snapshot.ts          # NEW: Snapshot type + builder + publisher
│   │   ├── singleton.ts         # NEW: shared runtime (orchestrator + plc + bridge)
│   │   ├── scheduler.ts         # NEW: real-time tick loop (setInterval)
│   │   └── manual-control.ts    # NEW: valve override when no cycle running
│   └── (sub-projeto 3 modules: bridge/, orchestrator/, virtual-plc/, scenario-runner/)
├── components/
│   ├── live/
│   │   ├── PhaseHeader.tsx      # NEW
│   │   ├── PressureChart.tsx    # NEW
│   │   ├── TemperatureChart.tsx # NEW
│   │   ├── F0Chart.tsx          # NEW
│   │   └── ValveList.tsx        # NEW
│   ├── virtual-plc/
│   │   └── ValvePanel.tsx       # NEW
│   ├── ui/
│   │   ├── Card.tsx             # NEW: simple card layout
│   │   └── Badge.tsx            # NEW: status badge
│   └── ConnectionIndicator.tsx  # NEW: SSE connection status pill
├── lib/
│   ├── useSnapshot.ts           # NEW: SSE React hook
│   ├── api.ts                   # NEW: typed fetch wrappers
│   └── format.ts                # NEW: number formatters
├── tailwind.config.ts           # NEW
├── postcss.config.mjs           # NEW
└── test/
    ├── runtime/
    │   ├── snapshot.test.ts     # NEW
    │   ├── singleton.test.ts    # NEW
    │   ├── scheduler.test.ts    # NEW
    │   └── manual-control.test.ts  # NEW
    └── (sub-projeto 3 tests preserved)
```

### File responsibilities

| File                                    | One-line responsibility                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `runtime/snapshot.ts`                   | Build a `Snapshot` from `SystemState` + cycle metadata; publisher with subscriber callbacks |
| `runtime/singleton.ts`                  | Lazy-init the shared `Runtime` (bridge + orchestrator + plc); accessed by API routes        |
| `runtime/scheduler.ts`                  | Drives `runtime.tick()` under `setInterval` at wall-clock rate                              |
| `runtime/manual-control.ts`             | When no cycle is running, lets the user toggle valves via API directly (writes DI)          |
| `api/snapshot/stream/route.ts`          | SSE: subscribes to snapshot publisher, writes `data:` lines                                 |
| `api/cycle/start/route.ts`              | Loads YAML cycle, calls `runtime.startCycle()`                                              |
| `api/cycle/stop/route.ts`               | Calls `runtime.stopCycle()`; valves go to safe state                                        |
| `api/cycle/status/route.ts`             | Returns `{ running, phase, elapsed_s, f0_min }`                                             |
| `api/valves/[id]/route.ts`              | POST `{ value: boolean }` — calls `manualValve(id, value)`                                  |
| `lib/useSnapshot.ts`                    | React hook subscribing to SSE; returns latest snapshot + ring buffer                        |
| `components/live/*.tsx`                 | Each renders one section of the live view from the snapshot                                 |
| `components/virtual-plc/ValvePanel.tsx` | Grid of valve toggles                                                                       |

---

## Type contracts (locked in here)

```typescript
// runtime/snapshot.ts
export interface Snapshot {
  t_s: number; // sim time
  wall_t_ms: number; // wall clock ms when produced
  cycle_running: boolean;
  cycle_phase: string; // 'IDLE' | 'PREHEAT' | ... | 'COMPLETE' | 'STOPPED'
  cycle_elapsed_s: number;
  f0_min: number;
  pressures: { chamber_bar: number; jacket_bar: number; generator_bar: number };
  temperatures: { chamber_C: number; testemunho_C: number; jacket_C: number; generator_C: number };
  valves: Record<string, boolean>; // valve id → commanded state
  masses: { air_chamber_kg: number; vap_chamber_kg: number; liq_chamber_kg: number };
}

export type SnapshotSubscriber = (snap: Snapshot) => void;
export class SnapshotPublisher {
  publish(snap: Snapshot): void;
  subscribe(cb: SnapshotSubscriber): () => void; // returns unsubscribe
  get latest(): Snapshot | null;
}

// runtime/singleton.ts
export interface Runtime {
  bridge: ModbusBridge;
  orchestrator: Orchestrator;
  plc: VirtualPLC | null; // null = no cycle running
  publisher: SnapshotPublisher;
  cycle_running: boolean;
  startCycle(cycle: CycleConfig): void;
  stopCycle(): void;
  tick(): Promise<void>; // single tick (orchestrator + plc if running)
}
export function getRuntime(): Runtime; // lazy singleton, survives HMR via globalThis
export function resetRuntime(): void; // test-only: tear down + recreate

// runtime/scheduler.ts
export interface SchedulerOpts {
  runtime: Runtime;
  tick_wall_ms: number; // e.g., 100ms (10 Hz scheduler)
  ticks_per_wall: number; // sim ticks per wall tick; e.g., 2 → 50ms sim per 100ms wall
}
export function startScheduler(opts: SchedulerOpts): () => void; // returns stop fn

// runtime/manual-control.ts
export async function setManualValve(
  runtime: Runtime,
  valveId: string,
  value: boolean,
): Promise<void>;
// Throws if cycle running.
```

---

## Task 1: Tailwind + base layout

**Files:**

- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/app/globals.css`
- Modify: `apps/web/app/page.tsx` (placeholder home updated)
- Create: `apps/web/app/layout.tsx`
- Modify: `apps/web/package.json` (add tailwind dev deps)

- [ ] **Step 1.1: Add Tailwind devDeps**

Run from project root:

```
pnpm --filter @sim/web add -D tailwindcss@^3.4.0 postcss@^8.4.0 autoprefixer@^10.4.0
```

- [ ] **Step 1.2: Write `apps/web/tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ok: '#16a34a', // green-600
        warn: '#eab308', // yellow-500
        err: '#dc2626', // red-600
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 1.3: Write `apps/web/postcss.config.mjs`**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 1.4: Write `apps/web/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html,
body {
  background-color: #0f172a; /* slate-900 */
  color: #f1f5f9; /* slate-100 */
  font-family:
    ui-sans-serif,
    system-ui,
    -apple-system,
    sans-serif;
}
```

- [ ] **Step 1.5: Write `apps/web/app/layout.tsx`**

```tsx
import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Simulador de Autoclaves',
  description: 'Steam autoclave HIL emulator dashboard',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-br">
      <body className="min-h-screen">
        <nav className="border-b border-slate-700 bg-slate-800 px-4 py-3 flex gap-4 items-center">
          <span className="font-bold text-lg">Simulador de Autoclaves</span>
          <Link href="/" className="hover:text-blue-400">
            Home
          </Link>
          <Link href="/live" className="hover:text-blue-400">
            Live
          </Link>
          <Link href="/virtual-plc" className="hover:text-blue-400">
            Virtual PLC
          </Link>
        </nav>
        <main className="p-4">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 1.6: Replace `apps/web/app/page.tsx`**

```tsx
export default function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-slate-300">Cycle status overview lands in Task 10.</p>
      <ul className="list-disc list-inside text-sm text-slate-400">
        <li>
          <a href="/live" className="text-blue-400 hover:underline">
            Live monitor
          </a>
        </li>
        <li>
          <a href="/virtual-plc" className="text-blue-400 hover:underline">
            Virtual PLC control panel
          </a>
        </li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 1.7: Smoke**

Run from project root:

```
pnpm --filter @sim/web build
```

Expected: build succeeds. If it fails on missing module errors for components/lib that don't exist yet — those imports haven't been added yet; this task only creates layout + home, no components. If build complains about content paths, verify tailwind.config.ts.

- [ ] **Step 1.8: Commit**

```bash
git add apps/web/tailwind.config.ts apps/web/postcss.config.mjs apps/web/app/globals.css apps/web/app/layout.tsx apps/web/app/page.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): tailwind + base layout"
```

---

## Task 2: Snapshot publisher (TDD)

**Files:**

- Create: `apps/web/test/runtime/snapshot.test.ts`
- Create: `apps/web/server/runtime/snapshot.ts`

- [ ] **Step 2.1: Write failing tests**

```typescript
// test/runtime/snapshot.test.ts
import { describe, it, expect } from 'vitest';
import { buildSnapshot, SnapshotPublisher } from '../../server/runtime/snapshot.js';
import type { SystemState, SystemParams } from '@sim/physics';
import { C_to_K } from '@sim/physics';

function makeState(): SystemState {
  return {
    chamber: { m_air: 0.18, m_vap: 0.05, m_liq: 0.02, T: C_to_K(120), T_wall: C_to_K(125) },
    jacket: { m_air: 0, m_vap: 0.05, m_liq: 0, T: C_to_K(138), T_wall: C_to_K(138) },
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: { T_metal: C_to_K(118), T_fabric: C_to_K(115) },
    f0_minutes: 30,
    time_s: 450,
  };
}

function makeParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 36000 },
    load: {
      m_metal: 20,
      cp_metal: 500,
      m_fabric: 5,
      cp_fabric: 1500,
      h_gas_metal: 200,
      h_metal_fabric: 100,
    },
    valves: {},
    external: { steam_line_pressure: 500000, steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
  };
}

describe('buildSnapshot', () => {
  it('extracts pressures + temperatures + F0 + masses from SystemState', () => {
    const snap = buildSnapshot({
      state: makeState(),
      params: makeParams(),
      cycle_running: true,
      cycle_phase: 'HOLD',
      cycle_elapsed_s: 30,
      valves: { V_STEAM_IN_INT: true, V_VAC: false },
    });
    expect(snap.t_s).toBe(450);
    expect(snap.cycle_running).toBe(true);
    expect(snap.cycle_phase).toBe('HOLD');
    expect(snap.f0_min).toBe(30);
    expect(snap.pressures.chamber_bar).toBeGreaterThan(0);
    expect(snap.temperatures.chamber_C).toBeCloseTo(120, 0);
    expect(snap.temperatures.testemunho_C).toBeCloseTo(115, 0);
    expect(snap.valves.V_STEAM_IN_INT).toBe(true);
    expect(snap.masses.air_chamber_kg).toBe(0.18);
  });
});

describe('SnapshotPublisher', () => {
  function dummy(t = 0): import('../../server/runtime/snapshot.js').Snapshot {
    return {
      t_s: t,
      wall_t_ms: 0,
      cycle_running: false,
      cycle_phase: 'IDLE',
      cycle_elapsed_s: 0,
      f0_min: 0,
      pressures: { chamber_bar: 1, jacket_bar: 1, generator_bar: 1 },
      temperatures: { chamber_C: 22, testemunho_C: 22, jacket_C: 22, generator_C: 22 },
      valves: {},
      masses: { air_chamber_kg: 0, vap_chamber_kg: 0, liq_chamber_kg: 0 },
    };
  }

  it('delivers published snapshots to subscribers', () => {
    const pub = new SnapshotPublisher();
    const received: number[] = [];
    pub.subscribe((s) => received.push(s.t_s));
    pub.publish(dummy(1));
    pub.publish(dummy(2));
    expect(received).toEqual([1, 2]);
  });

  it('stores latest snapshot for new subscribers', () => {
    const pub = new SnapshotPublisher();
    pub.publish(dummy(42));
    expect(pub.latest?.t_s).toBe(42);
  });

  it('unsubscribe stops delivery', () => {
    const pub = new SnapshotPublisher();
    const received: number[] = [];
    const unsub = pub.subscribe((s) => received.push(s.t_s));
    pub.publish(dummy(1));
    unsub();
    pub.publish(dummy(2));
    expect(received).toEqual([1]);
  });
});
```

- [ ] **Step 2.2: Run tests → fail**

```
pnpm --filter @sim/web test
```

- [ ] **Step 2.3: Implement `apps/web/server/runtime/snapshot.ts`**

```typescript
import type { SystemState, SystemParams } from '@sim/physics';
import { chamber_pressure, generator_pressure, K_to_C, Pa_to_bar } from '@sim/physics';

export interface Snapshot {
  t_s: number;
  wall_t_ms: number;
  cycle_running: boolean;
  cycle_phase: string;
  cycle_elapsed_s: number;
  f0_min: number;
  pressures: { chamber_bar: number; jacket_bar: number; generator_bar: number };
  temperatures: { chamber_C: number; testemunho_C: number; jacket_C: number; generator_C: number };
  valves: Record<string, boolean>;
  masses: { air_chamber_kg: number; vap_chamber_kg: number; liq_chamber_kg: number };
}

export interface BuildSnapshotOpts {
  state: SystemState;
  params: SystemParams;
  cycle_running: boolean;
  cycle_phase: string;
  cycle_elapsed_s: number;
  valves: Record<string, boolean>;
}

export function buildSnapshot(o: BuildSnapshotOpts): Snapshot {
  const pc = chamber_pressure(o.state.chamber, o.params.chamber);
  const pj = chamber_pressure(o.state.jacket, o.params.jacket);
  const pg =
    o.state.generator && o.params.generator
      ? generator_pressure(o.state.generator, o.params.generator)
      : 0;
  return {
    t_s: o.state.time_s,
    wall_t_ms: Date.now(),
    cycle_running: o.cycle_running,
    cycle_phase: o.cycle_phase,
    cycle_elapsed_s: o.cycle_elapsed_s,
    f0_min: o.state.f0_minutes,
    pressures: {
      chamber_bar: Pa_to_bar(pc.p_total),
      jacket_bar: Pa_to_bar(pj.p_total),
      generator_bar: Pa_to_bar(pg),
    },
    temperatures: {
      chamber_C: K_to_C(o.state.chamber.T),
      testemunho_C: K_to_C(o.state.load.T_fabric),
      jacket_C: K_to_C(o.state.jacket.T),
      generator_C: o.state.generator ? K_to_C(o.state.generator.T) : 0,
    },
    valves: { ...o.valves },
    masses: {
      air_chamber_kg: o.state.chamber.m_air,
      vap_chamber_kg: o.state.chamber.m_vap,
      liq_chamber_kg: o.state.chamber.m_liq,
    },
  };
}

export type SnapshotSubscriber = (snap: Snapshot) => void;

export class SnapshotPublisher {
  private subs = new Set<SnapshotSubscriber>();
  private _latest: Snapshot | null = null;

  publish(snap: Snapshot): void {
    this._latest = snap;
    for (const cb of this.subs) {
      try {
        cb(snap);
      } catch (err) {
        console.error('snapshot subscriber threw:', err);
      }
    }
  }

  subscribe(cb: SnapshotSubscriber): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  get latest(): Snapshot | null {
    return this._latest;
  }
}
```

- [ ] **Step 2.4: Run → pass**

- [ ] **Step 2.5: Commit**

```bash
git add apps/web/test/runtime/snapshot.test.ts apps/web/server/runtime/snapshot.ts
git commit -m "feat(web): snapshot builder + publisher"
```

---

## Task 3: Singleton runtime (TDD)

**Files:**

- Create: `apps/web/test/runtime/singleton.test.ts`
- Create: `apps/web/server/runtime/singleton.ts`

- [ ] **Step 3.1: Write failing tests**

```typescript
// test/runtime/singleton.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';

describe('getRuntime', () => {
  beforeEach(() => {
    resetRuntime();
  });

  it('returns a singleton (same instance across calls)', () => {
    const a = getRuntime();
    const b = getRuntime();
    expect(a).toBe(b);
  });

  it('initial state: bridge connected, no cycle, plc null', async () => {
    const r = getRuntime();
    expect(r.cycle_running).toBe(false);
    expect(r.plc).toBeNull();
    // bridge usable
    await expect(r.bridge.readCoils(0x1000, 1)).resolves.toBeDefined();
  });

  it('startCycle sets running and creates plc', () => {
    const r = getRuntime();
    r.startCycle({
      name: 'test',
      sterilization_T_C: 134,
      sterilization_P_bar: 3.04,
      hold_duration_s: 60,
      prevac_pulses: 0,
      prevac_vacuum_target_bar: 0.2,
      prevac_steam_target_bar: 2,
      preheat_duration_s: 10,
      dry_duration_s: 60,
      f0_target_min: 1,
    });
    expect(r.cycle_running).toBe(true);
    expect(r.plc).not.toBeNull();
  });

  it('stopCycle clears running + plc', () => {
    const r = getRuntime();
    r.startCycle({
      name: 'test',
      sterilization_T_C: 134,
      sterilization_P_bar: 3.04,
      hold_duration_s: 60,
      prevac_pulses: 0,
      prevac_vacuum_target_bar: 0.2,
      prevac_steam_target_bar: 2,
      preheat_duration_s: 10,
      dry_duration_s: 60,
      f0_target_min: 1,
    });
    r.stopCycle();
    expect(r.cycle_running).toBe(false);
    expect(r.plc).toBeNull();
  });

  it('tick advances orchestrator + plc when cycle running', async () => {
    const r = getRuntime();
    const t0 = r.orchestrator.getState().time_s;
    r.startCycle({
      name: 'test',
      sterilization_T_C: 134,
      sterilization_P_bar: 3.04,
      hold_duration_s: 60,
      prevac_pulses: 0,
      prevac_vacuum_target_bar: 0.2,
      prevac_steam_target_bar: 2,
      preheat_duration_s: 10,
      dry_duration_s: 60,
      f0_target_min: 1,
    });
    await r.tick();
    expect(r.orchestrator.getState().time_s).toBeGreaterThan(t0);
  });

  it('tick advances orchestrator only (no plc) when no cycle running', async () => {
    const r = getRuntime();
    const t0 = r.orchestrator.getState().time_s;
    await r.tick();
    expect(r.orchestrator.getState().time_s).toBeGreaterThan(t0);
    expect(r.plc).toBeNull();
  });

  it('publishes a snapshot on every tick', async () => {
    const r = getRuntime();
    const seen: number[] = [];
    r.publisher.subscribe((s) => seen.push(s.t_s));
    await r.tick();
    await r.tick();
    expect(seen.length).toBe(2);
  });
});
```

- [ ] **Step 3.2: Run → fail**

- [ ] **Step 3.3: Implement `apps/web/server/runtime/singleton.ts`**

```typescript
import { VirtualEsp32Bridge } from '../bridge/virtual-esp32.js';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { VirtualPLC } from '../virtual-plc/plc.js';
import type { CycleConfig } from '../virtual-plc/cycle-config.js';
import type { ModbusBridge } from '../bridge/bridge.js';
import { SnapshotPublisher, buildSnapshot } from './snapshot.js';
import type { SystemParams, SystemState, ValveCommands } from '@sim/physics';
import { C_to_K, P_ATM, R_AIR, GAMMA_AIR, GAMMA_VAP, R_VAP, bar_to_Pa } from '@sim/physics';
import { readCommands } from '../orchestrator/command-reader.js';

const TICK_DT_S = 0.05;

function defaultParams(): SystemParams {
  return {
    chamber: {
      V: 0.15,
      allowLiquid: true,
      wall_mass_kg: 50,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 200,
      relief_pressure_Pa: bar_to_Pa(3.04),
    },
    jacket: {
      V: 0.025,
      allowLiquid: false,
      wall_mass_kg: 15,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 100,
    },
    generator: { V_total: 0.05, heater_power_W: 36000, relief_pressure_Pa: bar_to_Pa(4.54) },
    load: {
      m_metal: 20,
      cp_metal: 500,
      m_fabric: 5,
      cp_fabric: 1500,
      h_gas_metal: 200,
      h_metal_fabric: 100,
    },
    valves: {
      V_STEAM_IN_INT: {
        from: 'generator',
        to: 'chamber',
        params: { Cv: 8e-6, gamma: GAMMA_VAP, R: R_VAP },
      },
      V_STEAM_IN_JACKET: {
        from: 'generator',
        to: 'jacket',
        params: { Cv: 1e-6, gamma: GAMMA_VAP, R: R_VAP },
        thermostat: {
          target: 'jacket',
          close_at_Pa: bar_to_Pa(3.54),
          reopen_at_Pa: bar_to_Pa(3.34),
        },
      },
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR } },
      V_EXHAUST: {
        from: 'chamber',
        to: 'atmosphere',
        params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR },
      },
      V_AIR_IN: {
        from: 'atmosphere',
        to: 'chamber',
        params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR },
      },
    },
    external: {
      steam_line_pressure: bar_to_Pa(5),
      steam_line_T: C_to_K(160),
      atmosphere_T: C_to_K(22),
    },
    jacket_chamber_h_W_per_K: 150,
  };
}

function preheatedInitial(p: SystemParams): SystemState {
  const T_amb = C_to_K(22);
  const T_hot = C_to_K(138);
  return {
    chamber: {
      m_air: (P_ATM * p.chamber.V) / (R_AIR * T_amb),
      m_vap: 0,
      m_liq: 0,
      T: T_amb,
      T_wall: T_hot,
    },
    jacket: { m_air: 0, m_vap: 0.047, m_liq: 0, T: T_hot, T_wall: T_hot },
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: { T_metal: T_amb, T_fabric: T_amb },
    f0_minutes: 0,
    time_s: 0,
  };
}

export interface Runtime {
  bridge: ModbusBridge;
  orchestrator: Orchestrator;
  plc: VirtualPLC | null;
  publisher: SnapshotPublisher;
  cycle_running: boolean;
  cycle_started_at_s: number;
  startCycle(cycle: CycleConfig): void;
  stopCycle(): void;
  tick(): Promise<void>;
  params: SystemParams;
}

class RuntimeImpl implements Runtime {
  bridge: ModbusBridge;
  orchestrator: Orchestrator;
  plc: VirtualPLC | null = null;
  publisher = new SnapshotPublisher();
  cycle_running = false;
  cycle_started_at_s = 0;
  params: SystemParams;

  constructor() {
    this.bridge = new VirtualEsp32Bridge();
    this.params = defaultParams();
    const initial = preheatedInitial(this.params);
    this.orchestrator = new Orchestrator({
      bridge: this.bridge,
      params: this.params,
      initialState: initial,
      tickDt_s: TICK_DT_S,
    });
    void this.bridge.connect();
  }

  startCycle(cycle: CycleConfig): void {
    this.plc = new VirtualPLC(cycle, this.bridge);
    this.plc.start();
    this.cycle_running = true;
    this.cycle_started_at_s = this.orchestrator.getState().time_s;
  }

  stopCycle(): void {
    this.plc = null;
    this.cycle_running = false;
    // clear all DI on the bridge (valves return to off)
    void this.bridge.writeDiscreteInputs(0x0000, new Array(13).fill(false));
  }

  async tick(): Promise<void> {
    const t = this.orchestrator.getState().time_s;
    if (this.plc) {
      await this.plc.tick(t);
    }
    await this.orchestrator.tick();
    // build + publish snapshot
    const { valves } = (await readCommands(this.bridge)) as { valves: ValveCommands };
    const snap = buildSnapshot({
      state: this.orchestrator.getState(),
      params: this.params,
      cycle_running: this.cycle_running,
      cycle_phase: this.plc ? this.plc.getPhase() : 'IDLE',
      cycle_elapsed_s: this.cycle_running
        ? this.orchestrator.getState().time_s - this.cycle_started_at_s
        : 0,
      valves: valves as Record<string, boolean>,
    });
    this.publisher.publish(snap);
  }
}

// Singleton via globalThis (survives Next.js HMR in dev)
declare global {
  // eslint-disable-next-line no-var
  var __SIM_RUNTIME__: Runtime | undefined;
}

export function getRuntime(): Runtime {
  if (!globalThis.__SIM_RUNTIME__) {
    globalThis.__SIM_RUNTIME__ = new RuntimeImpl();
  }
  return globalThis.__SIM_RUNTIME__;
}

export function resetRuntime(): void {
  globalThis.__SIM_RUNTIME__ = undefined;
}
```

- [ ] **Step 3.4: Run → pass**

- [ ] **Step 3.5: Commit**

```bash
git add apps/web/test/runtime/singleton.test.ts apps/web/server/runtime/singleton.ts
git commit -m "feat(web): singleton runtime (bridge + orchestrator + plc + publisher)"
```

---

## Task 4: Real-time scheduler (TDD)

**Files:**

- Create: `apps/web/test/runtime/scheduler.test.ts`
- Create: `apps/web/server/runtime/scheduler.ts`

- [ ] **Step 4.1: Write failing tests**

```typescript
// test/runtime/scheduler.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { startScheduler } from '../../server/runtime/scheduler.js';

describe('startScheduler', () => {
  beforeEach(() => resetRuntime());
  let stop: (() => void) | null = null;
  afterEach(() => {
    if (stop) stop();
  });

  it('ticks runtime at tick_wall_ms cadence', async () => {
    const r = getRuntime();
    const t0 = r.orchestrator.getState().time_s;
    stop = startScheduler({ runtime: r, tick_wall_ms: 20, ticks_per_wall: 1 });
    await new Promise((res) => setTimeout(res, 120));
    expect(r.orchestrator.getState().time_s).toBeGreaterThan(t0);
  });

  it('stop function halts ticks', async () => {
    const r = getRuntime();
    stop = startScheduler({ runtime: r, tick_wall_ms: 20, ticks_per_wall: 1 });
    await new Promise((res) => setTimeout(res, 50));
    const t_at_stop = r.orchestrator.getState().time_s;
    stop();
    stop = null;
    await new Promise((res) => setTimeout(res, 100));
    // sim time should not have advanced after stop
    expect(r.orchestrator.getState().time_s).toBeCloseTo(t_at_stop, 1);
  });

  it('ticks_per_wall > 1 runs multiple sim ticks per wall tick (fast-forward)', async () => {
    const r = getRuntime();
    const t0 = r.orchestrator.getState().time_s;
    stop = startScheduler({ runtime: r, tick_wall_ms: 20, ticks_per_wall: 5 });
    await new Promise((res) => setTimeout(res, 120));
    const advanced = r.orchestrator.getState().time_s - t0;
    // wall=120ms / tick_wall=20ms = ~6 wall ticks × 5 sim ticks × 0.05s = ~1.5s sim advanced.
    expect(advanced).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 4.2: Run → fail**

- [ ] **Step 4.3: Implement `apps/web/server/runtime/scheduler.ts`**

```typescript
import type { Runtime } from './singleton.js';

export interface SchedulerOpts {
  runtime: Runtime;
  /** Wall-clock period between scheduler firings (ms). */
  tick_wall_ms: number;
  /** Number of physics ticks performed per wall firing. >1 = fast-forward. */
  ticks_per_wall: number;
}

export function startScheduler(opts: SchedulerOpts): () => void {
  let running = true;
  let busy = false;

  const handle = setInterval(async () => {
    if (!running || busy) return;
    busy = true;
    try {
      for (let i = 0; i < opts.ticks_per_wall; i++) {
        await opts.runtime.tick();
      }
    } catch (err) {
      console.error('scheduler tick error:', err);
    } finally {
      busy = false;
    }
  }, opts.tick_wall_ms);

  return () => {
    running = false;
    clearInterval(handle);
  };
}
```

- [ ] **Step 4.4: Run → pass**

- [ ] **Step 4.5: Commit**

```bash
git add apps/web/test/runtime/scheduler.test.ts apps/web/server/runtime/scheduler.ts
git commit -m "feat(web): real-time scheduler (setInterval + ticks_per_wall fast-forward)"
```

---

## Task 5: Manual valve control (TDD)

**Files:**

- Create: `apps/web/test/runtime/manual-control.test.ts`
- Create: `apps/web/server/runtime/manual-control.ts`

- [ ] **Step 5.1: Write failing tests**

```typescript
// test/runtime/manual-control.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { setManualValve } from '../../server/runtime/manual-control.js';
import { RegisterAccess } from '../../server/bridge/register-access.js';

describe('setManualValve', () => {
  beforeEach(() => resetRuntime());

  it('writes the requested valve discrete input when no cycle running', async () => {
    const r = getRuntime();
    await setManualValve(r, 'V_VAC', true);
    const access = new RegisterAccess(r.bridge);
    expect(await access.getDiscrete('V_VAC')).toBe(true);
  });

  it('throws when a cycle is running (would conflict with PLC)', async () => {
    const r = getRuntime();
    r.startCycle({
      name: 't',
      sterilization_T_C: 134,
      sterilization_P_bar: 3.04,
      hold_duration_s: 60,
      prevac_pulses: 0,
      prevac_vacuum_target_bar: 0.2,
      prevac_steam_target_bar: 2,
      preheat_duration_s: 10,
      dry_duration_s: 60,
      f0_target_min: 1,
    });
    await expect(setManualValve(r, 'V_VAC', true)).rejects.toThrow(/cycle running/i);
  });

  it('rejects unknown valve ids', async () => {
    const r = getRuntime();
    await expect(setManualValve(r, 'V_NONSENSE' as never, true)).rejects.toThrow(/unknown/i);
  });
});
```

- [ ] **Step 5.2: Run → fail**

- [ ] **Step 5.3: Implement `apps/web/server/runtime/manual-control.ts`**

```typescript
import type { Runtime } from './singleton.js';
import { RegisterAccess } from '../bridge/register-access.js';
import { REGISTERS, type RegisterId } from '@sim/protocol/registers';

export async function setManualValve(
  runtime: Runtime,
  valveId: string,
  value: boolean,
): Promise<void> {
  if (runtime.cycle_running) {
    throw new Error('cannot toggle valve while cycle running');
  }
  if (!(valveId in REGISTERS) || REGISTERS[valveId as RegisterId].space !== 'discrete_inputs') {
    throw new Error(`unknown valve id "${valveId}"`);
  }
  const access = new RegisterAccess(runtime.bridge);
  await access.setDiscrete(valveId as RegisterId, value);
}
```

- [ ] **Step 5.4: Run → pass**

- [ ] **Step 5.5: Commit**

```bash
git add apps/web/test/runtime/manual-control.test.ts apps/web/server/runtime/manual-control.ts
git commit -m "feat(web): manual valve override (rejects when cycle running)"
```

---

## Task 6: API routes (cycle + valves + status)

**Files:**

- Create: `apps/web/app/api/cycle/start/route.ts`
- Create: `apps/web/app/api/cycle/stop/route.ts`
- Create: `apps/web/app/api/cycle/status/route.ts`
- Create: `apps/web/app/api/valves/[id]/route.ts`
- Create: `apps/web/server/scenarios/ster-134-prevac.yaml` (already exists from sub-projeto 3; check it does and skip)

- [ ] **Step 6.1: Verify scenario YAML exists**

Run:

```
ls apps/web/server/scenarios/
```

Expect to see `ster-134-prevac.yaml`. If not, restore from sub-projeto 3 commit.

- [ ] **Step 6.2: Implement `apps/web/app/api/cycle/start/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { CycleConfigSchema } from '../../../../server/virtual-plc/cycle-config';
import { getRuntime } from '../../../../server/runtime/singleton';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const scenario = url.searchParams.get('scenario') ?? 'ster-134-prevac.yaml';
  const path = resolve(process.cwd(), 'server/scenarios', scenario);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return NextResponse.json({ error: `scenario "${scenario}" not found` }, { status: 404 });
  }
  const cycle = CycleConfigSchema.parse(yaml.load(text));
  const runtime = getRuntime();
  if (runtime.cycle_running) {
    return NextResponse.json({ error: 'cycle already running' }, { status: 409 });
  }
  runtime.startCycle(cycle);
  return NextResponse.json({ ok: true, cycle: cycle.name });
}
```

- [ ] **Step 6.3: Implement `apps/web/app/api/cycle/stop/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { getRuntime } from '../../../../server/runtime/singleton';

export async function POST() {
  const runtime = getRuntime();
  if (!runtime.cycle_running) {
    return NextResponse.json({ error: 'no cycle running' }, { status: 409 });
  }
  runtime.stopCycle();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6.4: Implement `apps/web/app/api/cycle/status/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { getRuntime } from '../../../../server/runtime/singleton';

export async function GET() {
  const r = getRuntime();
  const snap = r.publisher.latest;
  return NextResponse.json({
    running: r.cycle_running,
    phase: snap?.cycle_phase ?? 'IDLE',
    elapsed_s: snap?.cycle_elapsed_s ?? 0,
    f0_min: snap?.f0_min ?? 0,
  });
}
```

- [ ] **Step 6.5: Implement `apps/web/app/api/valves/[id]/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { getRuntime } from '../../../../server/runtime/singleton';
import { setManualValve } from '../../../../server/runtime/manual-control';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { value?: boolean };
  try {
    body = (await req.json()) as { value?: boolean };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body.value !== 'boolean') {
    return NextResponse.json({ error: 'body must be { value: boolean }' }, { status: 400 });
  }
  try {
    await setManualValve(getRuntime(), id, body.value);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id, value: body.value });
}
```

- [ ] **Step 6.6: Typecheck**

```
pnpm --filter @sim/web typecheck
```

If imports fail with paths like `../../../../server/...`, count `../` from `app/api/<route>/route.ts` to `server/`: that's 4 ups. Verify.

- [ ] **Step 6.7: Commit**

```bash
git add apps/web/app/api/
git commit -m "feat(web): cycle + valve API routes (start/stop/status, manual override)"
```

---

## Task 7: SSE snapshot stream + scheduler bootstrap

**Files:**

- Create: `apps/web/app/api/snapshot/stream/route.ts`
- Create: `apps/web/server/runtime/bootstrap.ts` (auto-starts scheduler on first import)

- [ ] **Step 7.1: Implement `apps/web/server/runtime/bootstrap.ts`**

```typescript
import { getRuntime } from './singleton.js';
import { startScheduler } from './scheduler.js';

declare global {
  // eslint-disable-next-line no-var
  var __SIM_SCHEDULER_STOP__: (() => void) | undefined;
}

/** Ensure a scheduler is running. Safe to call repeatedly (idempotent across HMR). */
export function ensureSchedulerRunning(): void {
  if (globalThis.__SIM_SCHEDULER_STOP__) return;
  const runtime = getRuntime();
  // 100ms wall tick × 2 sim ticks (50ms total sim per wall tick = 1× real time at dt=0.05).
  const stop = startScheduler({ runtime, tick_wall_ms: 100, ticks_per_wall: 2 });
  globalThis.__SIM_SCHEDULER_STOP__ = stop;
}
```

- [ ] **Step 7.2: Implement `apps/web/app/api/snapshot/stream/route.ts`**

```typescript
import { getRuntime } from '../../../../server/runtime/singleton';
import { ensureSchedulerRunning } from '../../../../server/runtime/bootstrap';

export const dynamic = 'force-dynamic';
export const runtime_config = 'nodejs';

export async function GET(): Promise<Response> {
  ensureSchedulerRunning();
  const runtime = getRuntime();

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();

      // Send latest immediately if available
      if (runtime.publisher.latest) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(runtime.publisher.latest)}\n\n`));
      }

      const unsub = runtime.publisher.subscribe((snap) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(snap)}\n\n`));
        } catch {
          // controller closed; unsubscribe handled below
        }
      });

      // Heartbeat every 10s to keep connection open through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: heartbeat\n\n`));
        } catch {
          /* ignore */
        }
      }, 10000);

      // Detach on client close (next sets a signal)
      (controller as unknown as { _cleanup?: () => void })._cleanup = () => {
        clearInterval(heartbeat);
        unsub();
      };
    },
    cancel() {
      const c = this as unknown as { _cleanup?: () => void };
      c._cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
```

- [ ] **Step 7.3: Smoke run dev server**

Run from project root:

```
pnpm --filter @sim/web dev
```

In another terminal (or after server is up):

```
curl -N http://localhost:3000/api/snapshot/stream
```

Expected: stream emits `data: {...}` lines (one every ~100ms wall when scheduler running).

Kill dev server when done.

- [ ] **Step 7.4: Commit**

```bash
git add apps/web/app/api/snapshot/stream/ apps/web/server/runtime/bootstrap.ts
git commit -m "feat(web): SSE snapshot stream + scheduler bootstrap"
```

---

## Task 8: useSnapshot hook + lib utilities

**Files:**

- Create: `apps/web/lib/useSnapshot.ts`
- Create: `apps/web/lib/api.ts`
- Create: `apps/web/lib/format.ts`

- [ ] **Step 8.1: Write `apps/web/lib/format.ts`**

```typescript
export function fmtBar(v: number, decimals = 2): string {
  return `${v.toFixed(decimals)} bar`;
}

export function fmtCelsius(v: number, decimals = 1): string {
  return `${v.toFixed(decimals)} °C`;
}

export function fmtMinutes(v: number, decimals = 1): string {
  return `${v.toFixed(decimals)} min`;
}

export function fmtSeconds(v: number): string {
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
```

- [ ] **Step 8.2: Write `apps/web/lib/api.ts`**

```typescript
export interface CycleStatus {
  running: boolean;
  phase: string;
  elapsed_s: number;
  f0_min: number;
}

export async function startCycle(scenario = 'ster-134-prevac.yaml'): Promise<void> {
  const res = await fetch(`/api/cycle/start?scenario=${encodeURIComponent(scenario)}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error((await res.json()).error ?? `start failed: ${res.status}`);
}

export async function stopCycle(): Promise<void> {
  const res = await fetch('/api/cycle/stop', { method: 'POST' });
  if (!res.ok) throw new Error((await res.json()).error ?? `stop failed: ${res.status}`);
}

export async function getStatus(): Promise<CycleStatus> {
  const res = await fetch('/api/cycle/status');
  if (!res.ok) throw new Error(`status failed: ${res.status}`);
  return (await res.json()) as CycleStatus;
}

export async function setValve(id: string, value: boolean): Promise<void> {
  const res = await fetch(`/api/valves/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? `valve write failed: ${res.status}`);
}
```

- [ ] **Step 8.3: Write `apps/web/lib/useSnapshot.ts`**

```typescript
'use client';

import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../server/runtime/snapshot';

const RING_CAPACITY = 600; // ~60 s at 10 Hz

export interface UseSnapshotResult {
  snapshot: Snapshot | null;
  history: Snapshot[];
  connected: boolean;
}

export function useSnapshot(): UseSnapshotResult {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const historyRef = useRef<Snapshot[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    const es = new EventSource('/api/snapshot/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      try {
        const snap = JSON.parse(ev.data) as Snapshot;
        setSnapshot(snap);
        historyRef.current.push(snap);
        if (historyRef.current.length > RING_CAPACITY) historyRef.current.shift();
        setHistoryVersion((v) => v + 1);
      } catch {
        /* ignore malformed */
      }
    };
    return () => {
      es.close();
    };
  }, []);

  return { snapshot, history: historyRef.current, connected };
  // historyVersion forces re-render when history mutates; consumed via closure
  void historyVersion;
}
```

- [ ] **Step 8.4: Commit**

```bash
git add apps/web/lib/
git commit -m "feat(web): client-side hooks + API helpers + formatters"
```

---

## Task 9: Live page (charts + valve list + phase header)

**Files:**

- Create: `apps/web/components/ui/Card.tsx`
- Create: `apps/web/components/ui/Badge.tsx`
- Create: `apps/web/components/ConnectionIndicator.tsx`
- Create: `apps/web/components/live/PhaseHeader.tsx`
- Create: `apps/web/components/live/PressureChart.tsx`
- Create: `apps/web/components/live/TemperatureChart.tsx`
- Create: `apps/web/components/live/F0Chart.tsx`
- Create: `apps/web/components/live/ValveList.tsx`
- Create: `apps/web/app/live/page.tsx`
- Install Recharts

- [ ] **Step 9.1: Install Recharts**

```
pnpm --filter @sim/web add recharts@^2.12.0
```

- [ ] **Step 9.2: Write `apps/web/components/ui/Card.tsx`**

```tsx
import type { ReactNode } from 'react';

export function Card({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
      {title && (
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-2">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}
```

- [ ] **Step 9.3: Write `apps/web/components/ui/Badge.tsx`**

```tsx
import type { ReactNode } from 'react';

const variants = {
  ok: 'bg-green-600 text-green-50',
  warn: 'bg-yellow-500 text-yellow-50',
  err: 'bg-red-600 text-red-50',
  neutral: 'bg-slate-600 text-slate-100',
} as const;

export function Badge({
  children,
  variant = 'neutral',
}: {
  children: ReactNode;
  variant?: keyof typeof variants;
}) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${variants[variant]}`}>
      {children}
    </span>
  );
}
```

- [ ] **Step 9.4: Write `apps/web/components/ConnectionIndicator.tsx`**

```tsx
'use client';

import { Badge } from './ui/Badge';

export function ConnectionIndicator({ connected }: { connected: boolean }) {
  return <Badge variant={connected ? 'ok' : 'err'}>{connected ? '● live' : '○ offline'}</Badge>;
}
```

- [ ] **Step 9.5: Write `apps/web/components/live/PhaseHeader.tsx`**

```tsx
'use client';

import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { fmtSeconds, fmtMinutes } from '../../lib/format';
import type { Snapshot } from '../../server/runtime/snapshot';

export function PhaseHeader({ snap }: { snap: Snapshot | null }) {
  if (!snap) return <Card title="Phase">Waiting for snapshot…</Card>;
  return (
    <Card title="Phase">
      <div className="flex items-center gap-4">
        <span className="text-2xl font-bold tracking-wide">{snap.cycle_phase}</span>
        <Badge variant={snap.cycle_running ? 'ok' : 'neutral'}>
          {snap.cycle_running ? 'running' : 'idle'}
        </Badge>
        <span className="text-slate-400">elapsed: {fmtSeconds(snap.cycle_elapsed_s)}</span>
        <span className="text-slate-400">F0: {fmtMinutes(snap.f0_min)}</span>
      </div>
    </Card>
  );
}
```

- [ ] **Step 9.6: Write `apps/web/components/live/PressureChart.tsx`**

```tsx
'use client';

import { Card } from '../ui/Card';
import type { Snapshot } from '../../server/runtime/snapshot';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';

export function PressureChart({ history }: { history: Snapshot[] }) {
  const data = history.map((s) => ({
    t: s.t_s.toFixed(1),
    chamber: s.pressures.chamber_bar,
    jacket: s.pressures.jacket_bar,
    generator: s.pressures.generator_bar,
  }));
  return (
    <Card title="Pressure (bar abs)">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="t" stroke="#94a3b8" tick={{ fontSize: 10 }} />
            <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} domain={[0, 6]} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569' }} />
            <Legend />
            <ReferenceLine y={3.04} stroke="#dc2626" strokeDasharray="3 3" />
            <Line
              type="monotone"
              dataKey="chamber"
              stroke="#60a5fa"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="jacket"
              stroke="#fb923c"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="generator"
              stroke="#34d399"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
```

- [ ] **Step 9.7: Write `apps/web/components/live/TemperatureChart.tsx`**

```tsx
'use client';

import { Card } from '../ui/Card';
import type { Snapshot } from '../../server/runtime/snapshot';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';

export function TemperatureChart({ history }: { history: Snapshot[] }) {
  const data = history.map((s) => ({
    t: s.t_s.toFixed(1),
    chamber: s.temperatures.chamber_C,
    testemunho: s.temperatures.testemunho_C,
    jacket: s.temperatures.jacket_C,
    generator: s.temperatures.generator_C,
  }));
  return (
    <Card title="Temperature (°C)">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="t" stroke="#94a3b8" tick={{ fontSize: 10 }} />
            <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} domain={[0, 200]} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569' }} />
            <Legend />
            <ReferenceLine y={134} stroke="#dc2626" strokeDasharray="3 3" />
            <Line
              type="monotone"
              dataKey="chamber"
              stroke="#60a5fa"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="testemunho"
              stroke="#facc15"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="jacket"
              stroke="#fb923c"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="generator"
              stroke="#34d399"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
```

- [ ] **Step 9.8: Write `apps/web/components/live/F0Chart.tsx`**

```tsx
'use client';

import { Card } from '../ui/Card';
import type { Snapshot } from '../../server/runtime/snapshot';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';

export function F0Chart({ history }: { history: Snapshot[] }) {
  const data = history.map((s) => ({ t: s.t_s.toFixed(1), F0: s.f0_min }));
  return (
    <Card title="F0 accumulated (min, log scale)">
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="t" stroke="#94a3b8" tick={{ fontSize: 10 }} />
            <YAxis
              stroke="#94a3b8"
              tick={{ fontSize: 10 }}
              scale="log"
              domain={[0.01, 'auto']}
              allowDataOverflow
            />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569' }} />
            <Legend />
            <ReferenceLine y={100} stroke="#dc2626" strokeDasharray="3 3" />
            <Line
              type="monotone"
              dataKey="F0"
              stroke="#c084fc"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
```

- [ ] **Step 9.9: Write `apps/web/components/live/ValveList.tsx`**

```tsx
'use client';

import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { Snapshot } from '../../server/runtime/snapshot';

export function ValveList({ snap }: { snap: Snapshot | null }) {
  if (!snap) return <Card title="Valves">Waiting…</Card>;
  const entries = Object.entries(snap.valves).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Card title="Valves">
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-mono">
        {entries.map(([id, on]) => (
          <li key={id} className="flex items-center justify-between">
            <span className="text-slate-300">{id}</span>
            <Badge variant={on ? 'ok' : 'neutral'}>{on ? 'OPEN' : 'closed'}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
```

- [ ] **Step 9.10: Write `apps/web/app/live/page.tsx`**

```tsx
'use client';

import { useSnapshot } from '../../lib/useSnapshot';
import { ConnectionIndicator } from '../../components/ConnectionIndicator';
import { PhaseHeader } from '../../components/live/PhaseHeader';
import { PressureChart } from '../../components/live/PressureChart';
import { TemperatureChart } from '../../components/live/TemperatureChart';
import { F0Chart } from '../../components/live/F0Chart';
import { ValveList } from '../../components/live/ValveList';

export default function LivePage() {
  const { snapshot, history, connected } = useSnapshot();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Live Monitor</h1>
        <ConnectionIndicator connected={connected} />
      </div>
      <PhaseHeader snap={snapshot} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PressureChart history={history} />
        <TemperatureChart history={history} />
        <F0Chart history={history} />
        <ValveList snap={snapshot} />
      </div>
    </div>
  );
}
```

- [ ] **Step 9.11: Typecheck**

```
pnpm --filter @sim/web typecheck
```

- [ ] **Step 9.12: Commit**

```bash
git add apps/web/components/ apps/web/app/live/ apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): live page (phase + pressure/temperature/F0 charts + valves)"
```

---

## Task 10: Virtual PLC control panel page

**Files:**

- Create: `apps/web/components/virtual-plc/ValvePanel.tsx`
- Create: `apps/web/app/virtual-plc/page.tsx`
- Modify: `apps/web/app/page.tsx` (home: cycle controls)

- [ ] **Step 10.1: Write `apps/web/components/virtual-plc/ValvePanel.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Card } from '../ui/Card';
import { setValve } from '../../lib/api';
import type { Snapshot } from '../../server/runtime/snapshot';

const VALVE_IDS = [
  'V_STEAM_IN_INT',
  'V_STEAM_IN_JACKET',
  'V_AIR_IN',
  'V_VAC',
  'V_EXHAUST',
  'V_DRAIN_INT',
  'V_DRAIN_JACKET',
  'V_SEAL_CLEAN',
  'V_SEAL_STERILE',
  'V_GEN_WATER_IN',
  'PUMP_VAC',
  'HEATER_GEN',
];

export function ValvePanel({ snap, disabled }: { snap: Snapshot | null; disabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const toggle = async (id: string) => {
    try {
      const current = snap?.valves[id] ?? false;
      await setValve(id, !current);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card title="Manual Valve Control">
      {disabled && (
        <p className="text-yellow-400 text-sm mb-2">Disabled while a cycle is running.</p>
      )}
      {error && <p className="text-red-400 text-sm mb-2">Error: {error}</p>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {VALVE_IDS.map((id) => {
          const on = snap?.valves[id] ?? false;
          return (
            <button
              key={id}
              disabled={disabled}
              onClick={() => void toggle(id)}
              className={`px-3 py-2 rounded text-sm font-mono border transition ${
                on
                  ? 'bg-green-700 border-green-500 hover:bg-green-600'
                  : 'bg-slate-700 border-slate-600 hover:bg-slate-600'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="text-left">
                <div className="font-semibold">{id}</div>
                <div className="text-xs opacity-70">{on ? 'OPEN' : 'closed'}</div>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
```

- [ ] **Step 10.2: Write `apps/web/app/virtual-plc/page.tsx`**

```tsx
'use client';

import { useSnapshot } from '../../lib/useSnapshot';
import { ConnectionIndicator } from '../../components/ConnectionIndicator';
import { ValvePanel } from '../../components/virtual-plc/ValvePanel';

export default function VirtualPlcPage() {
  const { snapshot, connected } = useSnapshot();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Virtual PLC</h1>
        <ConnectionIndicator connected={connected} />
      </div>
      <p className="text-slate-400 text-sm">
        Manual valve overrides while no cycle is running. Useful for testing individual valves and
        seeing physics response without the cycle state machine.
      </p>
      <ValvePanel snap={snapshot} disabled={snapshot?.cycle_running ?? false} />
    </div>
  );
}
```

- [ ] **Step 10.3: Update `apps/web/app/page.tsx`** (home: cycle controls)

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSnapshot } from '../lib/useSnapshot';
import { startCycle, stopCycle } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { ConnectionIndicator } from '../components/ConnectionIndicator';
import { fmtSeconds, fmtMinutes } from '../lib/format';

export default function Home() {
  const { snapshot, connected } = useSnapshot();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onStart = async () => {
    setBusy(true);
    setError(null);
    try {
      await startCycle();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  const onStop = async () => {
    setBusy(true);
    setError(null);
    try {
      await stopCycle();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <ConnectionIndicator connected={connected} />
      </div>

      <Card title="Cycle">
        <div className="flex items-center gap-4 flex-wrap">
          <Badge variant={snapshot?.cycle_running ? 'ok' : 'neutral'}>
            {snapshot?.cycle_running ? 'running' : 'idle'}
          </Badge>
          <span className="text-slate-300">
            phase: <span className="font-mono">{snapshot?.cycle_phase ?? 'IDLE'}</span>
          </span>
          <span className="text-slate-300">
            elapsed: {fmtSeconds(snapshot?.cycle_elapsed_s ?? 0)}
          </span>
          <span className="text-slate-300">F0: {fmtMinutes(snapshot?.f0_min ?? 0)}</span>
          <div className="ml-auto flex gap-2">
            <button
              disabled={busy || snapshot?.cycle_running}
              onClick={() => void onStart()}
              className="px-3 py-1.5 rounded bg-green-700 hover:bg-green-600 text-sm font-medium disabled:opacity-50"
            >
              Start ster-134-prevac
            </button>
            <button
              disabled={busy || !snapshot?.cycle_running}
              onClick={() => void onStop()}
              className="px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-sm font-medium disabled:opacity-50"
            >
              Stop
            </button>
          </div>
        </div>
        {error && <p className="text-red-400 text-sm mt-2">Error: {error}</p>}
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Link href="/live" className="block">
          <Card>
            <div className="text-lg font-semibold">Live monitor →</div>
            <div className="text-slate-400 text-sm">
              Charts: pressure, temperature, F0; valve states
            </div>
          </Card>
        </Link>
        <Link href="/virtual-plc" className="block">
          <Card>
            <div className="text-lg font-semibold">Virtual PLC →</div>
            <div className="text-slate-400 text-sm">Manual valve overrides when idle</div>
          </Card>
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 10.4: Typecheck**

```
pnpm --filter @sim/web typecheck
```

- [ ] **Step 10.5: Commit**

```bash
git add apps/web/components/virtual-plc/ apps/web/app/virtual-plc/ apps/web/app/page.tsx
git commit -m "feat(web): virtual PLC control panel + home cycle controls"
```

---

## Task 11: Build + dev-server smoke + finalize

**Files:**

- Modify: `TODO.md`

- [ ] **Step 11.1: Run all gates**

```
pnpm --filter @sim/web test
pnpm --filter @sim/web typecheck
pnpm lint
pnpm format:check
pnpm drift-check
pnpm --filter @sim/web build
```

All must pass. `pnpm build` does a Next.js production build — this catches React/Next.js issues vitest doesn't see.

- [ ] **Step 11.2: Manual dev server smoke**

```
pnpm --filter @sim/web dev
```

In a browser, open:

- http://localhost:3000 — home with cycle controls
- http://localhost:3000/live — live charts (should show pressures/temperatures even idle, since orchestrator ticks)
- http://localhost:3000/virtual-plc — valve buttons

Click "Start ster-134-prevac". Switch to /live. Observe phase progression, charts updating. Switch to /virtual-plc — valves should be disabled (cycle running). Click Stop on home. Back to /virtual-plc — valves enabled.

Document any issues in commit message.

- [ ] **Step 11.3: Update TODO.md**

Read TODO.md, then update:

```markdown
# TODO

## Em curso

(vazio — escolher próximo sub-projeto)

## Pendente

- Sub-projeto 5 — Firmware ESP32 + Modbus slave (I/O + watchdog + fast model)
- Sub-projeto 6 — Injeção de falhas (hooks orchestrator + UI faults + cenários)
- Sub-projeto 7 — Placa condicionamento KiCad (schematic + PCB + BOM)
- Sub-projeto 8 — PLC-in-loop aceitação (PLC real, ajustes finais, QA arquivada)
- Sub-projeto 9 — Mímico SVG + cycles history + replay

## Feito

- 2026-05-26 — Sub-projeto 4 — Dashboard MVP (apps/web: Tailwind + Next.js App Router, snapshot publisher + singleton runtime + real-time scheduler, SSE stream, useSnapshot hook, live page c/ Recharts pressure/temperature/F0/valves, virtual PLC manual valve panel, home cycle start/stop)
- 2026-05-26 — Sub-projeto 3 — Orchestrator + virtual bridge + scenario runner (apps/web: ModbusBridge interface, VirtualEsp32Bridge in-memory, RegisterAccess typed wrapper, Orchestrator tick loop, VirtualPLC state machine + valve commander, scenario runner driving closed-loop 134°C cycle to F0 ≥ 100 entirely virtual. 47 vitest tests)
- (previous entries unchanged)
```

- [ ] **Step 11.4: Commit + push**

```bash
git add TODO.md
git commit -m "chore: mark sub-projeto 4 (Dashboard MVP) complete"
git push origin master
```

---

## Done criteria

- All 11 tasks above completed.
- `pnpm --filter @sim/web test` passes (47 existing + ~12 new = ~59 tests).
- `pnpm typecheck`, `lint`, `format:check`, `drift-check` all pass.
- `pnpm --filter @sim/web build` succeeds (Next.js production build).
- Dev server smoke: home / live / virtual-plc all render; cycle starts via button; SSE updates charts.
- TODO.md updated.

---

## What this plan does NOT cover (deferred)

- **Equipment CRUD** — config stays in YAML. Multi-equipment management = future sub-projeto.
- **SQLite persistence** — no datalog of past cycles; live-only view.
- **Mímico P&ID SVG** — sub-projeto 9.
- **Cycle history / replay** — sub-projeto 9.
- **Fault injection UI** — sub-projeto 6.
- **WebSocket** — using SSE instead (simpler in Next.js, sufficient for one-way snapshot stream).
- **Real Modbus TCP bridge** — sub-projeto 5.
- **Authentication / multi-user** — local LAN tool, out of scope per design spec.
- **Multiple concurrent SSE clients** — current SnapshotPublisher supports this trivially (Set of subscribers), but only verified with one browser tab.
