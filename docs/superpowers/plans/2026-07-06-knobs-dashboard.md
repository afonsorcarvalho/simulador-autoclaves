# Knobs no Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Painel `/knobs` no dashboard que ajusta parâmetros do emulador (ciclo, planta, controlador, velocidade), com plant/controller/time live e cycle pré-arranque, persistidos num ficheiro override.

**Architecture:** Registry declarativo (`server/knobs/registry.ts`) é a fonte única — cada knob traz acessoras `get(rt)/set(rt,v)` tipadas. Um `KnobStore` carrega overrides de disco no boot e aplica via `set`. Plant muta `rt.params` in-place (Orchestrator lê a ref cada tick); time via `rt.timeScale` (scheduler lê cada firing); controller via offsets passados ao bang-bang; cycle via `rt.cycleOverride` mergido em `startCycle`. API/Ui geradas do registry.

**Tech Stack:** Next.js 14 App Router, TypeScript (ESM, `.js` imports), Zod, Vitest, Node fs. Prettier autoritativo. Correr sempre em `apps/web`.

---

## Ficheiros

**Novos:**
- `apps/web/server/knobs/registry.ts` — descritores dos knobs + MVP.
- `apps/web/server/knobs/store.ts` — load/save/apply/reset/currentValues (path injectável).
- `apps/web/app/api/knobs/route.ts` — GET (descritores+valores), POST (set 1 knob).
- `apps/web/app/api/knobs/reset/route.ts` — POST reset.
- `apps/web/lib/knobs-api.ts` — cliente fetch.
- `apps/web/components/knobs/KnobPanel.tsx` — painel agrupado.
- `apps/web/app/knobs/page.tsx` — página.
- Testes: `apps/web/test/knobs/registry.test.ts`, `apps/web/test/knobs/store.test.ts`, `apps/web/test/knobs/api.test.ts`.

**Editados:**
- `apps/web/server/runtime/singleton.ts` — campos `timeScale`, `controller`, `cycleOverride`; merge em `startCycle`; boot apply.
- `apps/web/server/runtime/scheduler.ts` — lê `runtime.timeScale` (remove `ticks_per_wall`).
- `apps/web/server/runtime/bootstrap.ts` — deixa de passar `ticks_per_wall`.
- `apps/web/server/virtual-plc/plc.ts` — `chamberValveBangBang` recebe offsets; `tick` recebe controller config.
- `apps/web/server/runtime/singleton.ts` — `tick` passa `this.controller` ao `plc.tick`.
- `apps/web/test/runtime/scheduler.test.ts` — usa `r.timeScale` em vez de `ticks_per_wall`.
- `apps/web/app/layout.tsx` — link nav `/knobs`.
- `apps/web/.gitignore` — `knobs.override.json`.

---

## Task 1: Runtime `timeScale` + scheduler live-read

Torna a velocidade de simulação um knob live: o scheduler passa a ler `runtime.timeScale` a cada firing em vez de uma constante capturada.

**Files:**
- Modify: `apps/web/server/runtime/singleton.ts`
- Modify: `apps/web/server/runtime/scheduler.ts`
- Modify: `apps/web/server/runtime/bootstrap.ts`
- Test: `apps/web/test/runtime/scheduler.test.ts`

- [ ] **Step 1: Reescrever o teste do scheduler p/ usar `timeScale`**

Substituir o conteúdo de `apps/web/test/runtime/scheduler.test.ts`:

```ts
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
    r.timeScale = 1;
    const t0 = r.orchestrator.getState().time_s;
    stop = startScheduler({ runtime: r, tick_wall_ms: 20 });
    await new Promise((res) => setTimeout(res, 120));
    expect(r.orchestrator.getState().time_s).toBeGreaterThan(t0);
  });

  it('stop function halts ticks', async () => {
    const r = getRuntime();
    r.timeScale = 1;
    stop = startScheduler({ runtime: r, tick_wall_ms: 20 });
    await new Promise((res) => setTimeout(res, 50));
    const t_at_stop = r.orchestrator.getState().time_s;
    stop();
    stop = null;
    await new Promise((res) => setTimeout(res, 100));
    expect(r.orchestrator.getState().time_s).toBeCloseTo(t_at_stop, 1);
  });

  it('timeScale > 1 runs multiple sim ticks per wall tick (fast-forward)', async () => {
    const r = getRuntime();
    r.timeScale = 5;
    const t0 = r.orchestrator.getState().time_s;
    stop = startScheduler({ runtime: r, tick_wall_ms: 20 });
    await new Promise((res) => setTimeout(res, 120));
    const advanced = r.orchestrator.getState().time_s - t0;
    expect(advanced).toBeGreaterThan(0.5);
  });

  it('timeScale change mid-run takes effect (read each firing)', async () => {
    const r = getRuntime();
    r.timeScale = 1;
    stop = startScheduler({ runtime: r, tick_wall_ms: 20 });
    await new Promise((res) => setTimeout(res, 60));
    const slow = r.orchestrator.getState().time_s;
    r.timeScale = 8;
    await new Promise((res) => setTimeout(res, 60));
    const fast = r.orchestrator.getState().time_s;
    expect(fast - slow).toBeGreaterThan(0.4);
  });
});
```

- [ ] **Step 2: Correr o teste — deve falhar**

Run: `pnpm --filter @sim/web test -- scheduler`
Expected: FAIL — `r.timeScale` não existe / `SchedulerOpts` ainda exige `ticks_per_wall`.

- [ ] **Step 3: Adicionar `timeScale` ao Runtime**

Em `apps/web/server/runtime/singleton.ts`, na interface `Runtime` (a seguir a `params: SystemParams;`):

```ts
  timeScale: number;
```

Na classe `RuntimeImpl`, a seguir a `params: SystemParams;`:

```ts
  timeScale = 2;
```

- [ ] **Step 4: Scheduler lê `runtime.timeScale`**

Substituir `apps/web/server/runtime/scheduler.ts`:

```ts
import type { Runtime } from './singleton.js';

export interface SchedulerOpts {
  runtime: Runtime;
  /** Wall-clock period between scheduler firings (ms). */
  tick_wall_ms: number;
}

export function startScheduler(opts: SchedulerOpts): () => void {
  let running = true;
  let busy = false;

  const handle = setInterval(async () => {
    if (!running || busy) return;
    busy = true;
    try {
      // Read timeScale each firing so mid-run changes (a knob) take effect immediately.
      const n = Math.max(1, Math.round(opts.runtime.timeScale));
      for (let i = 0; i < n; i++) {
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

- [ ] **Step 5: Bootstrap deixa de passar `ticks_per_wall`**

Em `apps/web/server/runtime/bootstrap.ts`, trocar a chamada:

```ts
  const stop = startScheduler({ runtime, tick_wall_ms: 100 });
```

- [ ] **Step 6: Correr testes**

Run: `pnpm --filter @sim/web test -- scheduler`
Expected: PASS (4 testes).

- [ ] **Step 7: Commit**

```bash
git add apps/web/server/runtime/scheduler.ts apps/web/server/runtime/singleton.ts apps/web/server/runtime/bootstrap.ts apps/web/test/runtime/scheduler.test.ts
git commit -m "feat(web): scheduler reads live runtime.timeScale (time-scale knob foundation)"
```

---

## Task 2: Controller offsets no bang-bang

O controlador de referência passa a receber as bandas como argumentos (defaults 0.1/0.5), e o runtime guarda-as num objecto `controller` que a UI vai mexer live.

**Files:**
- Modify: `apps/web/server/virtual-plc/plc.ts`
- Modify: `apps/web/server/runtime/singleton.ts`
- Test: `apps/web/test/virtual-plc/plc.test.ts`

- [ ] **Step 1: Adicionar testes das bandas parametrizadas**

Em `apps/web/test/virtual-plc/plc.test.ts`, dentro do `describe('chamber steam valve bang-bang', ...)`, acrescentar:

```ts
  it('uses custom band offsets when provided', () => {
    // band_low=1.0, band_high=2.0 → open below SP+1.0, close above SP+2.0
    expect(chamberValveBangBang(134.9, SP, false, 1.0, 2.0)).toBe(true);
    expect(chamberValveBangBang(136.1, SP, true, 1.0, 2.0)).toBe(false);
    expect(chamberValveBangBang(135.5, SP, true, 1.0, 2.0)).toBe(true); // in band, hold
  });
```

- [ ] **Step 2: Correr — deve falhar**

Run: `pnpm --filter @sim/web test -- plc`
Expected: FAIL — `chamberValveBangBang` aceita 3 args.

- [ ] **Step 3: Parametrizar `chamberValveBangBang`**

Em `apps/web/server/virtual-plc/plc.ts`, substituir a função (manter o comentário-doc por cima):

```ts
export function chamberValveBangBang(
  T_chamber_C: number,
  SP_C: number,
  prevOpen: boolean,
  band_low_C = 0.1,
  band_high_C = 0.5,
): boolean {
  if (T_chamber_C < SP_C + band_low_C) return true;
  if (T_chamber_C > SP_C + band_high_C) return false;
  return prevOpen;
}
```

- [ ] **Step 4: `tick` aceita controller config e passa ao bang-bang**

Em `apps/web/server/virtual-plc/plc.ts`, alterar a assinatura e a chamada dentro de `tick`:

```ts
  async tick(time_s: number, controller?: { band_low: number; band_high: number }): Promise<void> {
    this.lastTickTime_s = time_s;
    const sensors = await this.readSensors();
    this.sm.update(time_s, sensors);
    // Reference controller: chamber steam valve bang-bang on chamber temperature (real PLC replaces).
    this.chamberValveOpen = chamberValveBangBang(
      sensors.T_chamber_C,
      this.setpoint_C,
      this.chamberValveOpen,
      controller?.band_low,
      controller?.band_high,
    );
    const setpoints = this.commandsFor(this.sm.phase, this.chamberValveOpen);
    await this.applyValves(setpoints);
  }
```

- [ ] **Step 5: Runtime guarda `controller` e passa-o no tick**

Em `apps/web/server/runtime/singleton.ts`:

Na interface `Runtime`, a seguir a `timeScale: number;`:

```ts
  controller: { band_low: number; band_high: number };
```

Na classe `RuntimeImpl`, a seguir a `timeScale = 2;`:

```ts
  controller = { band_low: 0.1, band_high: 0.5 };
```

No método `tick`, trocar a chamada `await this.plc.tick(t);` por:

```ts
      await this.plc.tick(t, this.controller);
```

- [ ] **Step 6: Correr testes**

Run: `pnpm --filter @sim/web test -- plc`
Expected: PASS (bang-bang + VirtualPLC verdes).

- [ ] **Step 7: Commit**

```bash
git add apps/web/server/virtual-plc/plc.ts apps/web/server/runtime/singleton.ts apps/web/test/virtual-plc/plc.test.ts
git commit -m "feat(web): parametrize chamber bang-bang bands via runtime.controller (live controller knobs)"
```

---

## Task 3: `cycleOverride` mergido em `startCycle`

Knobs de ciclo não mutam um ciclo a correr; escrevem em `rt.cycleOverride` e são mergidos sobre o YAML quando o ciclo arranca.

**Files:**
- Modify: `apps/web/server/runtime/singleton.ts`
- Test: `apps/web/test/runtime/singleton.test.ts`

- [ ] **Step 1: Teste do merge**

Acrescentar a `apps/web/test/runtime/singleton.test.ts` (dentro do describe existente; se o import de `CycleConfig` faltar, adicionar `import type { CycleConfig } from '../../server/virtual-plc/cycle-config.js';`):

```ts
  it('startCycle merges cycleOverride over the passed config', () => {
    const r = getRuntime();
    const cycle: CycleConfig = {
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
    r.cycleOverride = { sterilization_T_C: 121, hold_duration_s: 900 };
    r.startCycle(cycle);
    expect(r.effectiveCycle?.sterilization_T_C).toBe(121);
    expect(r.effectiveCycle?.hold_duration_s).toBe(900);
    expect(r.effectiveCycle?.prevac_pulses).toBe(3); // não sobreposto
  });
```

- [ ] **Step 2: Correr — deve falhar**

Run: `pnpm --filter @sim/web test -- singleton`
Expected: FAIL — `cycleOverride` / `effectiveCycle` não existem.

- [ ] **Step 3: Campos + merge no runtime**

Em `apps/web/server/runtime/singleton.ts`:

Na interface `Runtime`, a seguir a `controller: ...`:

```ts
  cycleOverride: Partial<CycleConfig>;
  effectiveCycle: CycleConfig | null;
```

Na classe `RuntimeImpl`, a seguir a `controller = ...`:

```ts
  cycleOverride: Partial<CycleConfig> = {};
  effectiveCycle: CycleConfig | null = null;
```

No método `startCycle`, substituir o corpo para mergir primeiro:

```ts
  startCycle(cycle: CycleConfig): void {
    const merged: CycleConfig = { ...cycle, ...this.cycleOverride };
    this.effectiveCycle = merged;
    this.plc = new VirtualPLC(merged, this.bridge);
    this.plc.start();
    this.cycle_running = true;
    this.cycle_started_at_s = this.orchestrator.getState().time_s;
    // zod's optional() widens props to `| undefined`; exactOptionalPropertyTypes
    // rejects that against LoadItemConfig. Runtime-identical — cast.
    this.orchestrator.setLoadState(
      buildLoadState(merged.load as LoadItemConfig[] | undefined, C_to_K(22)),
    );
  }
```

- [ ] **Step 4: Correr testes**

Run: `pnpm --filter @sim/web test -- singleton`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/runtime/singleton.ts apps/web/test/runtime/singleton.test.ts
git commit -m "feat(web): startCycle merges runtime.cycleOverride over scenario config"
```

---

## Task 4: Knob registry

A fonte única. Descritores + o conjunto MVP com acessoras tipadas.

**Files:**
- Create: `apps/web/server/knobs/registry.ts`
- Test: `apps/web/test/knobs/registry.test.ts`

- [ ] **Step 1: Teste de round-trip do registry**

Criar `apps/web/test/knobs/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { KNOBS, knobById } from '../../server/knobs/registry.js';

describe('knob registry', () => {
  beforeEach(() => resetRuntime());

  it('every knob has a unique id and default within [min,max]', () => {
    const ids = new Set<string>();
    for (const k of KNOBS) {
      expect(ids.has(k.id)).toBe(false);
      ids.add(k.id);
      expect(k.default).toBeGreaterThanOrEqual(k.min);
      expect(k.default).toBeLessThanOrEqual(k.max);
    }
  });

  it('get∘set round-trips for every knob', () => {
    const rt = getRuntime();
    for (const k of KNOBS) {
      const v = (k.min + k.max) / 2;
      k.set(rt, v);
      expect(k.get(rt)).toBeCloseTo(v, 6);
    }
  });

  it('relief knob converts bar↔Pa in the accessors', () => {
    const rt = getRuntime();
    const relief = knobById('plant.chamber.relief');
    expect(relief).toBeDefined();
    relief!.set(rt, 3.5);
    expect(rt.params.chamber.relief_pressure_Pa).toBeCloseTo(350000, 0);
    expect(relief!.get(rt)).toBeCloseTo(3.5, 4);
  });

  it('plant.chamber.h_ambient set mutates runtime params live', () => {
    const rt = getRuntime();
    knobById('plant.chamber.h_ambient')!.set(rt, 42);
    expect(rt.params.chamber.h_ambient_W_per_K).toBe(42);
  });
});
```

- [ ] **Step 2: Correr — deve falhar**

Run: `pnpm --filter @sim/web test -- registry`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Escrever o registry**

Criar `apps/web/server/knobs/registry.ts`:

```ts
import { bar_to_Pa } from '@sim/physics';
import type { Runtime } from '../runtime/singleton.js';

export type KnobFamily = 'cycle' | 'plant' | 'controller' | 'time';

export interface KnobDescriptor {
  id: string;
  family: KnobFamily;
  label: string;
  unit: string;
  default: number;
  min: number;
  max: number;
  step?: number;
  timing: 'live' | 'precycle';
  get(rt: Runtime): number;
  set(rt: Runtime, v: number): void;
}

/** Serializable view (no functions) for the API/UI. */
export type KnobMeta = Omit<KnobDescriptor, 'get' | 'set'>;

const PA_PER_BAR = bar_to_Pa(1);

export const KNOBS: KnobDescriptor[] = [
  // ---- CYCLE (precycle: written into runtime.cycleOverride, merged at startCycle) ----
  {
    id: 'cycle.sterilization_T',
    family: 'cycle',
    label: 'Setpoint esterilização',
    unit: '°C',
    default: 134,
    min: 100,
    max: 140,
    step: 0.5,
    timing: 'precycle',
    get: (rt) => rt.cycleOverride.sterilization_T_C ?? 134,
    set: (rt, v) => {
      rt.cycleOverride.sterilization_T_C = v;
    },
  },
  {
    id: 'cycle.hold_duration',
    family: 'cycle',
    label: 'Duração hold',
    unit: 's',
    default: 420,
    min: 0,
    max: 3600,
    step: 10,
    timing: 'precycle',
    get: (rt) => rt.cycleOverride.hold_duration_s ?? 420,
    set: (rt, v) => {
      rt.cycleOverride.hold_duration_s = v;
    },
  },
  {
    id: 'cycle.prevac_pulses',
    family: 'cycle',
    label: 'Pulsos prevac',
    unit: '',
    default: 3,
    min: 0,
    max: 6,
    step: 1,
    timing: 'precycle',
    get: (rt) => rt.cycleOverride.prevac_pulses ?? 3,
    set: (rt, v) => {
      rt.cycleOverride.prevac_pulses = Math.round(v);
    },
  },
  {
    id: 'cycle.prevac_vacuum_target',
    family: 'cycle',
    label: 'Alvo vácuo prevac',
    unit: 'bar',
    default: 0.15,
    min: 0.05,
    max: 1,
    step: 0.01,
    timing: 'precycle',
    get: (rt) => rt.cycleOverride.prevac_vacuum_target_bar ?? 0.15,
    set: (rt, v) => {
      rt.cycleOverride.prevac_vacuum_target_bar = v;
    },
  },
  {
    id: 'cycle.prevac_steam_target',
    family: 'cycle',
    label: 'Alvo vapor prevac',
    unit: 'bar',
    default: 2.0,
    min: 1,
    max: 3.5,
    step: 0.05,
    timing: 'precycle',
    get: (rt) => rt.cycleOverride.prevac_steam_target_bar ?? 2.0,
    set: (rt, v) => {
      rt.cycleOverride.prevac_steam_target_bar = v;
    },
  },
  {
    id: 'cycle.dry_duration',
    family: 'cycle',
    label: 'Duração secagem',
    unit: 's',
    default: 500,
    min: 0,
    max: 3600,
    step: 10,
    timing: 'precycle',
    get: (rt) => rt.cycleOverride.dry_duration_s ?? 500,
    set: (rt, v) => {
      rt.cycleOverride.dry_duration_s = v;
    },
  },

  // ---- PLANT (live: mutate rt.params in place; Orchestrator reads the ref each tick) ----
  {
    id: 'plant.chamber.relief',
    family: 'plant',
    label: 'Teto alívio câmara',
    unit: 'bar',
    default: 3.25,
    min: 2.5,
    max: 4,
    step: 0.05,
    timing: 'live',
    get: (rt) => rt.params.chamber.relief_pressure_Pa / PA_PER_BAR,
    set: (rt, v) => {
      rt.params.chamber.relief_pressure_Pa = bar_to_Pa(v);
    },
  },
  {
    id: 'plant.chamber.h_ambient',
    family: 'plant',
    label: 'Perda ambiente câmara',
    unit: 'W/K',
    default: 10,
    min: 0,
    max: 100,
    step: 1,
    timing: 'live',
    get: (rt) => rt.params.chamber.h_ambient_W_per_K ?? 10,
    set: (rt, v) => {
      rt.params.chamber.h_ambient_W_per_K = v;
    },
  },
  {
    id: 'plant.chamber.drain',
    family: 'plant',
    label: 'Dreno condensado câmara',
    unit: 'kg/s',
    default: 2e-5,
    min: 0,
    max: 1e-3,
    step: 1e-6,
    timing: 'live',
    get: (rt) => rt.params.chamber.drain_kg_per_s ?? 2e-5,
    set: (rt, v) => {
      rt.params.chamber.drain_kg_per_s = v;
    },
  },
  {
    id: 'plant.generator.heater_power',
    family: 'plant',
    label: 'Potência aquecedor gerador',
    unit: 'W',
    default: 36000,
    min: 0,
    max: 60000,
    step: 1000,
    timing: 'live',
    get: (rt) => rt.params.generator.heater_power_W,
    set: (rt, v) => {
      rt.params.generator.heater_power_W = v;
    },
  },
  {
    id: 'plant.valve.steam_in_int_cv',
    family: 'plant',
    label: 'Cv vapor câmara (V_STEAM_IN_INT)',
    unit: 'm²',
    default: 8e-6,
    min: 1e-6,
    max: 5e-5,
    step: 1e-6,
    timing: 'live',
    get: (rt) => rt.params.valves.V_STEAM_IN_INT.params.Cv,
    set: (rt, v) => {
      rt.params.valves.V_STEAM_IN_INT.params.Cv = v;
    },
  },
  {
    id: 'plant.valve.vac_cv',
    family: 'plant',
    label: 'Cv vácuo (V_VAC)',
    unit: 'm²',
    default: 1e-4,
    min: 1e-5,
    max: 5e-4,
    step: 1e-5,
    timing: 'live',
    get: (rt) => rt.params.valves.V_VAC.params.Cv,
    set: (rt, v) => {
      rt.params.valves.V_VAC.params.Cv = v;
    },
  },
  {
    id: 'plant.valve.exhaust_cv',
    family: 'plant',
    label: 'Cv exaustão (V_EXHAUST)',
    unit: 'm²',
    default: 2e-5,
    min: 1e-6,
    max: 2e-4,
    step: 1e-6,
    timing: 'live',
    get: (rt) => rt.params.valves.V_EXHAUST.params.Cv,
    set: (rt, v) => {
      rt.params.valves.V_EXHAUST.params.Cv = v;
    },
  },

  // ---- CONTROLLER (live: reference bang-bang bands) ----
  {
    id: 'controller.band_low',
    family: 'controller',
    label: 'Banda baixa (abrir < SP+)',
    unit: '°C',
    default: 0.1,
    min: 0,
    max: 2,
    step: 0.05,
    timing: 'live',
    get: (rt) => rt.controller.band_low,
    set: (rt, v) => {
      rt.controller.band_low = v;
    },
  },
  {
    id: 'controller.band_high',
    family: 'controller',
    label: 'Banda alta (fechar > SP+)',
    unit: '°C',
    default: 0.5,
    min: 0,
    max: 3,
    step: 0.05,
    timing: 'live',
    get: (rt) => rt.controller.band_high,
    set: (rt, v) => {
      rt.controller.band_high = v;
    },
  },

  // ---- TIME ----
  {
    id: 'time.scale',
    family: 'time',
    label: 'Velocidade simulação (ticks/firing)',
    unit: '×',
    default: 2,
    min: 1,
    max: 50,
    step: 1,
    timing: 'live',
    get: (rt) => rt.timeScale,
    set: (rt, v) => {
      rt.timeScale = Math.max(1, Math.round(v));
    },
  },
];

export function knobById(id: string): KnobDescriptor | undefined {
  return KNOBS.find((k) => k.id === id);
}

export function knobMeta(): KnobMeta[] {
  return KNOBS.map(({ get: _g, set: _s, ...meta }) => meta);
}
```

- [ ] **Step 4: Correr testes**

Run: `pnpm --filter @sim/web test -- registry`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/knobs/registry.ts apps/web/test/knobs/registry.test.ts
git commit -m "feat(web): declarative knob registry with typed get/set accessors + MVP knobs"
```

---

## Task 5: Knob store (load/save/apply/reset, path injectável)

**Files:**
- Create: `apps/web/server/knobs/store.ts`
- Test: `apps/web/test/knobs/store.test.ts`

- [ ] **Step 1: Teste do store**

Criar `apps/web/test/knobs/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import {
  applyOverrides,
  applyOne,
  resetAll,
  currentValues,
} from '../../server/knobs/store.js';

// Fixed name (Date.now/Math.random unavailable in some harnesses; tests run serial).
const FILE = join(tmpdir(), 'sim-knobs-test.json');

describe('knob store', () => {
  beforeEach(() => {
    resetRuntime();
    if (existsSync(FILE)) rmSync(FILE);
  });
  afterEach(() => {
    if (existsSync(FILE)) rmSync(FILE);
  });

  it('applyOne mutates runtime and persists to disk', () => {
    const rt = getRuntime();
    applyOne(rt, 'plant.chamber.h_ambient', 55, FILE);
    expect(rt.params.chamber.h_ambient_W_per_K).toBe(55);
    expect(existsSync(FILE)).toBe(true);
  });

  it('applyOverrides re-applies persisted values on boot', () => {
    const rt1 = getRuntime();
    applyOne(rt1, 'time.scale', 7, FILE);
    resetRuntime();
    const rt2 = getRuntime();
    applyOverrides(rt2, FILE); // simulates boot
    expect(rt2.timeScale).toBe(7);
  });

  it('currentValues returns default when not overridden', () => {
    const rt = getRuntime();
    const v = currentValues(rt);
    expect(v['plant.chamber.relief']).toBeCloseTo(3.25, 4);
  });

  it('rejects out-of-range values', () => {
    const rt = getRuntime();
    expect(() => applyOne(rt, 'time.scale', 999, FILE)).toThrow(/range/i);
  });

  it('rejects unknown id', () => {
    const rt = getRuntime();
    expect(() => applyOne(rt, 'nope.nope', 1, FILE)).toThrow(/unknown/i);
  });

  it('resetAll restores defaults and removes the file', () => {
    const rt = getRuntime();
    applyOne(rt, 'plant.chamber.h_ambient', 55, FILE);
    resetAll(rt, FILE);
    expect(rt.params.chamber.h_ambient_W_per_K).toBe(10);
    expect(existsSync(FILE)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr — deve falhar**

Run: `pnpm --filter @sim/web test -- store`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Escrever o store**

Criar `apps/web/server/knobs/store.ts`:

```ts
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Runtime } from '../runtime/singleton.js';
import { KNOBS, knobById } from './registry.js';

/** Default override-file path (relative to cwd = apps/web when running dev/start). */
export function defaultOverridePath(): string {
  return resolve(process.cwd(), 'knobs.override.json');
}

function readFile(path: string): Record<string, number> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeFile(path: string, data: Record<string, number>): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

function validate(id: string, value: number): void {
  const k = knobById(id);
  if (!k) throw new Error(`unknown knob "${id}"`);
  if (!Number.isFinite(value)) throw new Error(`value must be finite`);
  if (value < k.min || value > k.max) {
    throw new Error(`value ${value} out of range [${k.min}, ${k.max}] for "${id}"`);
  }
}

/** Apply persisted overrides on top of defaults (boot). */
export function applyOverrides(rt: Runtime, path = defaultOverridePath()): void {
  const overrides = readFile(path);
  for (const k of KNOBS) {
    const v = overrides[k.id];
    if (v !== undefined && Number.isFinite(v) && v >= k.min && v <= k.max) {
      k.set(rt, v);
    }
  }
}

/** Apply one knob, validate, mutate runtime, persist. */
export function applyOne(rt: Runtime, id: string, value: number, path = defaultOverridePath()): void {
  validate(id, value);
  knobById(id)!.set(rt, value);
  const overrides = readFile(path);
  overrides[id] = value;
  writeFile(path, overrides);
}

/** Current effective value of every knob. */
export function currentValues(rt: Runtime): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of KNOBS) out[k.id] = k.get(rt);
  return out;
}

/** Restore all defaults and delete the override file. */
export function resetAll(rt: Runtime, path = defaultOverridePath()): void {
  for (const k of KNOBS) k.set(rt, k.default);
  if (existsSync(path)) rmSync(path);
}
```

- [ ] **Step 4: Correr testes**

Run: `pnpm --filter @sim/web test -- store`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/knobs/store.ts apps/web/test/knobs/store.test.ts
git commit -m "feat(web): knob store — load/apply/persist/reset with injectable path"
```

---

## Task 6: Boot wiring + `.gitignore`

Aplicar overrides no arranque do runtime e ignorar o ficheiro.

**Files:**
- Modify: `apps/web/server/runtime/singleton.ts`
- Modify: `apps/web/.gitignore` (criar se não existir)

- [ ] **Step 1: Aplicar overrides no fim do construtor**

Em `apps/web/server/runtime/singleton.ts`, no topo adicionar o import:

```ts
import { applyOverrides } from '../knobs/store.js';
```

No fim do `constructor()` de `RuntimeImpl`, a seguir a `void this.bridge.connect();`:

```ts
    // Load persisted knob overrides on top of defaults. Safe: no MVP knob feeds the
    // initial state (preheatedInitial reads only chamber.V, which is not a knob).
    try {
      applyOverrides(this as unknown as Runtime);
    } catch (err) {
      console.error('failed to apply knob overrides:', err);
    }
```

- [ ] **Step 2: `.gitignore`**

Garantir que `apps/web/.gitignore` contém a linha (acrescentar; criar o ficheiro com só esta linha se não existir):

```
knobs.override.json
```

- [ ] **Step 3: Correr a suite web toda (não regrediu nada)**

Run: `pnpm --filter @sim/web test`
Expected: PASS (todos, incl. os novos).

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/runtime/singleton.ts apps/web/.gitignore
git commit -m "feat(web): apply persisted knob overrides on runtime boot; gitignore override file"
```

---

## Task 7: API routes

**Files:**
- Create: `apps/web/app/api/knobs/route.ts`
- Create: `apps/web/app/api/knobs/reset/route.ts`
- Test: `apps/web/test/knobs/api.test.ts`

- [ ] **Step 1: Teste das handlers**

Criar `apps/web/test/knobs/api.test.ts` (chama as handlers directamente, como não há outros testes de route; usa o ficheiro override default, limpa no fim):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resetRuntime } from '../../server/runtime/singleton.js';
import { defaultOverridePath } from '../../server/knobs/store.js';
import { GET, POST } from '../../app/api/knobs/route.js';
import { POST as RESET } from '../../app/api/knobs/reset/route.js';

const FILE = defaultOverridePath();

function req(body: unknown): Request {
  return new Request('http://x/api/knobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('knobs API', () => {
  beforeEach(() => {
    resetRuntime();
    if (existsSync(FILE)) rmSync(FILE);
  });
  afterEach(() => {
    if (existsSync(FILE)) rmSync(FILE);
  });

  it('GET returns knob metadata + current values', async () => {
    const res = await GET();
    const body = (await res.json()) as {
      knobs: { id: string }[];
      values: Record<string, number>;
    };
    expect(body.knobs.length).toBeGreaterThan(5);
    expect(body.values['time.scale']).toBe(2);
    // metadata must not leak functions
    expect((body.knobs[0] as Record<string, unknown>).get).toBeUndefined();
  });

  it('POST valid knob applies + persists', async () => {
    const res = await POST(req({ id: 'time.scale', value: 9 }));
    expect(res.status).toBe(200);
    expect(existsSync(FILE)).toBe(true);
  });

  it('POST out-of-range → 400', async () => {
    const res = await POST(req({ id: 'time.scale', value: 999 }));
    expect(res.status).toBe(400);
  });

  it('POST precycle knob while cycle running → 409', async () => {
    const { getRuntime } = await import('../../server/runtime/singleton.js');
    getRuntime().cycle_running = true;
    const res = await POST(req({ id: 'cycle.hold_duration', value: 600 }));
    expect(res.status).toBe(409);
  });

  it('reset returns 200 and removes file', async () => {
    await POST(req({ id: 'time.scale', value: 9 }));
    const res = await RESET();
    expect(res.status).toBe(200);
    expect(existsSync(FILE)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr — deve falhar**

Run: `pnpm --filter @sim/web test -- knobs/api`
Expected: FAIL — routes não existem.

- [ ] **Step 3: `GET`/`POST` route**

Criar `apps/web/app/api/knobs/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getRuntime } from '../../../server/runtime/singleton';
import { knobMeta, knobById } from '../../../server/knobs/registry';
import { applyOne, currentValues } from '../../../server/knobs/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rt = getRuntime();
  return NextResponse.json({ knobs: knobMeta(), values: currentValues(rt) });
}

export async function POST(req: Request) {
  let body: { id?: string; value?: number };
  try {
    body = (await req.json()) as { id?: string; value?: number };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body.id !== 'string' || typeof body.value !== 'number') {
    return NextResponse.json({ error: 'body must be { id: string, value: number }' }, { status: 400 });
  }
  const knob = knobById(body.id);
  if (!knob) {
    return NextResponse.json({ error: `unknown knob "${body.id}"` }, { status: 400 });
  }
  const rt = getRuntime();
  if (knob.timing === 'precycle' && rt.cycle_running) {
    return NextResponse.json(
      { error: 'cycle knobs cannot change while a cycle is running' },
      { status: 409 },
    );
  }
  try {
    applyOne(rt, body.id, body.value);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: body.id, value: body.value });
}
```

- [ ] **Step 4: `reset` route**

Criar `apps/web/app/api/knobs/reset/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getRuntime } from '../../../../server/runtime/singleton';
import { resetAll } from '../../../../server/knobs/store';

export const dynamic = 'force-dynamic';

export async function POST() {
  resetAll(getRuntime());
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Correr testes**

Run: `pnpm --filter @sim/web test -- knobs/api`
Expected: PASS (5 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/knobs/route.ts apps/web/app/api/knobs/reset/route.ts apps/web/test/knobs/api.test.ts
git commit -m "feat(web): /api/knobs GET/POST + reset (validation, 409 for precycle mid-cycle)"
```

---

## Task 8: Cliente + página `/knobs` + nav

**Files:**
- Create: `apps/web/lib/knobs-api.ts`
- Create: `apps/web/components/knobs/KnobPanel.tsx`
- Create: `apps/web/app/knobs/page.tsx`
- Modify: `apps/web/app/layout.tsx`

Sem testes automáticos (UI client — segue o padrão do `ValvePanel`, que também não tem). Verificação manual no fim.

- [ ] **Step 1: Cliente fetch**

Criar `apps/web/lib/knobs-api.ts`:

```ts
export interface KnobMeta {
  id: string;
  family: 'cycle' | 'plant' | 'controller' | 'time';
  label: string;
  unit: string;
  default: number;
  min: number;
  max: number;
  step?: number;
  timing: 'live' | 'precycle';
}

export interface KnobsResponse {
  knobs: KnobMeta[];
  values: Record<string, number>;
}

export async function getKnobs(): Promise<KnobsResponse> {
  const res = await fetch('/api/knobs');
  if (!res.ok) throw new Error(`knobs fetch failed: ${res.status}`);
  return (await res.json()) as KnobsResponse;
}

export async function setKnob(id: string, value: number): Promise<void> {
  const res = await fetch('/api/knobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, value }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? `set failed: ${res.status}`);
  }
}

export async function resetKnobs(): Promise<void> {
  const res = await fetch('/api/knobs/reset', { method: 'POST' });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
}
```

- [ ] **Step 2: `KnobPanel` component**

Criar `apps/web/components/knobs/KnobPanel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { getKnobs, setKnob, resetKnobs, type KnobMeta } from '../../lib/knobs-api';

const FAMILY_LABEL: Record<KnobMeta['family'], string> = {
  cycle: 'Ciclo',
  plant: 'Planta física',
  controller: 'Controlador (referência)',
  time: 'Tempo',
};
const FAMILY_ORDER: KnobMeta['family'][] = ['cycle', 'plant', 'controller', 'time'];

export function KnobPanel({ cycleRunning }: { cycleRunning: boolean }) {
  const [knobs, setKnobs] = useState<KnobMeta[]>([]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const { knobs, values } = await getKnobs();
      setKnobs(knobs);
      setValues(values);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const commit = async (id: string, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    try {
      await setKnob(id, value);
      setValues((v) => ({ ...v, [id]: value }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      void load(); // reverte para o valor do servidor
    }
  };

  const reset = async () => {
    try {
      await resetKnobs();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      {error && <p className="text-red-400 text-sm">Error: {error}</p>}
      {FAMILY_ORDER.map((fam) => {
        const items = knobs.filter((k) => k.family === fam);
        if (items.length === 0) return null;
        const disabled = fam === 'cycle' && cycleRunning;
        return (
          <Card key={fam} title={FAMILY_LABEL[fam]}>
            {disabled && (
              <p className="text-yellow-400 text-sm mb-2">
                Desativado enquanto um ciclo corre.
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map((k) => (
                <label key={k.id} className="flex flex-col gap-1 text-sm">
                  <span className="opacity-80">
                    {k.label} {k.unit && <span className="opacity-50">({k.unit})</span>}
                  </span>
                  <input
                    type="number"
                    disabled={disabled}
                    defaultValue={values[k.id]}
                    key={`${k.id}:${values[k.id]}`}
                    min={k.min}
                    max={k.max}
                    step={k.step ?? 'any'}
                    onBlur={(e) => void commit(k.id, e.target.value)}
                    className="bg-slate-700 border border-slate-600 rounded px-2 py-1 font-mono disabled:opacity-50"
                  />
                </label>
              ))}
            </div>
          </Card>
        );
      })}
      <button
        onClick={() => void reset()}
        className="px-3 py-2 rounded text-sm bg-slate-700 border border-slate-600 hover:bg-slate-600"
      >
        Repor defaults
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Página `/knobs`**

Criar `apps/web/app/knobs/page.tsx`:

```tsx
'use client';

import { useSnapshot } from '../../lib/useSnapshot';
import { ConnectionIndicator } from '../../components/ConnectionIndicator';
import { KnobPanel } from '../../components/knobs/KnobPanel';

export default function KnobsPage() {
  const { snapshot, connected } = useSnapshot();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Knobs</h1>
        <ConnectionIndicator connected={connected} />
      </div>
      <p className="text-slate-400 text-sm">
        Parâmetros do emulador. Planta, controlador e tempo aplicam live; os de ciclo só com o
        ciclo parado (semeiam o PLC ao arrancar). Persistem em disco.
      </p>
      <KnobPanel cycleRunning={snapshot?.cycle_running ?? false} />
    </div>
  );
}
```

- [ ] **Step 4: Link na nav**

Em `apps/web/app/layout.tsx`, a seguir ao `<Link href="/virtual-plc" ...>`:

```tsx
          <Link href="/knobs" className="hover:text-blue-400">
            Knobs
          </Link>
```

- [ ] **Step 5: Verificar build + lint + typecheck**

Run: `pnpm --filter @sim/web lint && pnpm --filter @sim/web typecheck && pnpm --filter @sim/web build`
Expected: PASS (sem erros).

- [ ] **Step 6: Verificação manual**

Run: `pnpm --filter @sim/web dev` → abrir `http://localhost:3030/knobs`.
Verificar: (a) knobs carregam com valores correntes; (b) mudar `time.scale` acelera o relógio na página Live; (c) mudar um knob de planta com ciclo a correr responde no gráfico; (d) knobs de ciclo desativados com ciclo a correr; (e) "Repor defaults" volta tudo ao inicial; (f) `apps/web/knobs.override.json` aparece após uma mudança.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/knobs-api.ts apps/web/components/knobs/KnobPanel.tsx apps/web/app/knobs/page.tsx apps/web/app/layout.tsx
git commit -m "feat(web): /knobs dashboard page — grouped knob panel, live + precycle, reset"
```

---

## Final: gate CI local

- [ ] **Step 1: Correr o gate completo**

Run (na raiz): `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS. Se `format:check` falhar, correr `pnpm format` (o hook PostToolUse também formata) e commitar.

- [ ] **Step 2: Atualizar TODO.md**

Mover a entrada de knobs para `## Feito` com data `2026-07-06`, via a skill `todo` ou edição directa.

---

## Notas de decomposição

- **Ordem:** Tasks 1–3 preparam o runtime (time/controller/cycle) antes de existir registry — cada uma é um commit verde independente. Task 4 (registry) depende de os campos existirem. 5–7 empilham store→boot→API. 8 é a UI. Nenhuma task deixa a suite vermelha.
- **Isolação:** o registry é o único sítio que conhece os caminhos internos do modelo; API, store e UI só falam ids. Adicionar knob futuro = 1 entrada no array + (se precisar) 1 campo runtime.
- **Risco conhecido:** knobs que alimentem `preheatedInitial` (hoje só `chamber.V`, não exposto) teriam de ser aplicados antes da construção do estado inicial. Nenhum knob MVP o faz — documentado no comentário do boot.
```
