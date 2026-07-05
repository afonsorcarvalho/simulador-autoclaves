# Modelo de carga N-nós + secagem a vácuo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a carga 2-massa fixa por um modelo de N nós configuráveis com propriedades de material reais, condensação acumulada, arrefecimento evaporativo (flash), radiação jaqueta→carga e convecção ∝ densidade do gás — para que na secagem a vácuo a temperatura do testemunho caia (correção do bug P–T da câmara).

**Architecture:** Refatorar `packages/physics/src/load.ts` in-place para um array de nós; novo `materials.ts` (registry + área estimada + builder de carga). `integrator.ts` liga fluxos convectivo/radiante/latente e conserva água carga↔câmara. `chamber.ts` escala o acoplamento parede↔gás pela densidade. `apps/web` ganha config `load` opcional no YAML de ciclo com carga-default não-quebra.

**Tech Stack:** TypeScript, Vitest, pnpm+turbo. Física em SI. Spec: `docs/superpowers/specs/2026-07-05-vacuum-drying-load-model-design.md`. Teoria: `packages/physics/docs/modelo-secagem-vacuo.md`.

**Nota de refinamento do spec:** o spec listou `h_film` (condensação, W/m²K). Para garantir conservação de água simétrica sem inverter Antoine, o plano usa transferência de massa **isotrópica dirigida por pressão** com dois coeficientes `k_cond`, `k_ev` [kg/(s·m²·Pa)] e o mesmo Δp = `p_sat(T_node) − p_vap_câmara`. `h_film` do spec mapeia para `k_cond`.

---

## Ficheiros

- Create: `packages/physics/src/materials.ts` — registry de materiais, `estimateArea`.
- Modify: `packages/physics/src/constants.ts` — σ, cp água, densidade-ref, defaults de coeficientes.
- Modify: `packages/physics/src/load.ts` — refatorar p/ N nós + `buildLoadState`.
- Modify: `packages/physics/src/chamber.ts` — `wall_coupling_scale` em `ChamberFluxes`.
- Modify: `packages/physics/src/integrator.ts` — nova forma de `SystemState.load`, ligação de fluxos, conservação de água, F0 no nó testemunho.
- Modify: `packages/physics/src/cli.ts` — `equipment.load` como lista + retro-compat + trace pelo witness.
- Modify: `packages/physics/src/index.ts` — exportar `materials`.
- Modify: `apps/web/server/virtual-plc/cycle-config.ts` — schema `load` opcional.
- Modify: `apps/web/server/runtime/singleton.ts` — nós default, `startCycle` constrói carga.
- Modify: `apps/web/server/runtime/snapshot.ts` — `testemunho_C` do nó witness.
- Tests: `packages/physics/test/materials.test.ts`, `load.test.ts` (reescrever), `integrator/drying.test.ts`; ajustar tolerâncias em testes de cenário existentes.

---

## Task 1: Constantes novas

**Files:**
- Modify: `packages/physics/src/constants.ts`
- Test: `packages/physics/test/constants.test.ts` (criar se não existir)

- [ ] **Step 1: Escrever teste falhado**

```ts
// packages/physics/test/constants.test.ts
import { describe, it, expect } from 'vitest';
import { SIGMA_SB, CP_WATER, RHO_GAS_ATM_REF, H0_CONV_DEFAULT, K_COND_DEFAULT, K_EV_DEFAULT } from '../src/constants.js';

describe('drying-model constants', () => {
  it('exposes Stefan-Boltzmann and water cp', () => {
    expect(SIGMA_SB).toBeCloseTo(5.67e-8, 10);
    expect(CP_WATER).toBe(4186);
  });
  it('exposes calibration defaults (positive)', () => {
    for (const v of [RHO_GAS_ATM_REF, H0_CONV_DEFAULT, K_COND_DEFAULT, K_EV_DEFAULT]) {
      expect(v).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Correr — falha**

Run: `pnpm --filter @sim/physics test test/constants.test.ts`
Expected: FAIL (imports indefinidos).

- [ ] **Step 3: Implementar**

Adicionar ao fim de `packages/physics/src/constants.ts`:
```ts
/** Constante de Stefan-Boltzmann (W/(m²·K⁴)). */
export const SIGMA_SB = 5.67e-8;
/** Calor específico da água líquida (J/(kg·K)). */
export const CP_WATER = 4186;
/** Densidade de referência do gás para escalar a convecção (kg/m³).
 *  Vapor saturado ~1 bar/100 °C ≈ 0.6 kg/m³. Convecção efetiva = h0·(ρ_gas/este valor). */
export const RHO_GAS_ATM_REF = 0.6;
/** Convecção base gás↔carga à densidade de referência (W/(m²·K)). Knob calibrável. */
export const H0_CONV_DEFAULT = 30;
/** Coef. de condensação (kg/(s·m²·Pa)). Knob calibrável. */
export const K_COND_DEFAULT = 2e-6;
/** Coef. de evaporação/flash (kg/(s·m²·Pa)). Knob calibrável. */
export const K_EV_DEFAULT = 2e-6;
```

- [ ] **Step 4: Correr — passa**

Run: `pnpm --filter @sim/physics test test/constants.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/physics/src/constants.ts packages/physics/test/constants.test.ts
git commit -m "feat(physics): add drying-model constants (sigma, cp_water, calibration defaults)"
```

---

## Task 2: Registry de materiais + área estimada

**Files:**
- Create: `packages/physics/src/materials.ts`
- Test: `packages/physics/test/materials.test.ts`

- [ ] **Step 1: Escrever teste falhado**

```ts
// packages/physics/test/materials.test.ts
import { describe, it, expect } from 'vitest';
import { MATERIALS, estimateArea, type MaterialName } from '../src/materials.js';

describe('MATERIALS registry', () => {
  it('has sane thermophysical values for every material', () => {
    for (const name of Object.keys(MATERIALS) as MaterialName[]) {
      const m = MATERIALS[name];
      expect(m.rho).toBeGreaterThan(0);
      expect(m.cp).toBeGreaterThan(0);
      expect(m.k).toBeGreaterThan(0);
      expect(m.emissivity).toBeGreaterThanOrEqual(0);
      expect(m.emissivity).toBeLessThanOrEqual(1);
      expect(m.waterCapacity_kg_per_kg).toBeGreaterThanOrEqual(0);
      expect(m.shapeFactor).toBeGreaterThan(0);
    }
  });
  it('textile retains far more water than steel', () => {
    expect(MATERIALS.COTTON_TEXTILE.waterCapacity_kg_per_kg).toBeGreaterThan(
      MATERIALS.STAINLESS_316.waterCapacity_kg_per_kg * 5,
    );
  });
});

describe('estimateArea', () => {
  it('grows monotonically with mass', () => {
    const m = MATERIALS.STAINLESS_316;
    expect(estimateArea(2, m)).toBeGreaterThan(estimateArea(1, m));
  });
  it('follows the (m/rho)^(2/3) law', () => {
    const m = MATERIALS.STAINLESS_316;
    // 8x mass → 4x area
    expect(estimateArea(8 * m.rho, m)).toBeCloseTo(4 * estimateArea(m.rho, m), 6);
  });
});
```

- [ ] **Step 2: Correr — falha**

Run: `pnpm --filter @sim/physics test test/materials.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

```ts
// packages/physics/src/materials.ts
export interface MaterialProps {
  rho: number; // kg/m³
  cp: number; // J/(kg·K)
  k: number; // W/(m·K) — só p/ checagem de Biot (informativo na v1)
  emissivity: number; // 0..1
  waterCapacity_kg_per_kg: number; // condensado máx retido / kg seco
  shapeFactor: number; // A ≈ shapeFactor·(m/ρ)^(2/3)
}

export const MATERIALS = {
  STAINLESS_316: { rho: 8000, cp: 500, k: 16, emissivity: 0.5, waterCapacity_kg_per_kg: 0.02, shapeFactor: 6 },
  CARBON_STEEL: { rho: 7870, cp: 460, k: 50, emissivity: 0.7, waterCapacity_kg_per_kg: 0.02, shapeFactor: 6 },
  ALUMINUM: { rho: 2700, cp: 900, k: 200, emissivity: 0.1, waterCapacity_kg_per_kg: 0.02, shapeFactor: 6 },
  GLASS: { rho: 2500, cp: 840, k: 1.0, emissivity: 0.9, waterCapacity_kg_per_kg: 0.02, shapeFactor: 6 },
  POLYPROPYLENE: { rho: 905, cp: 1920, k: 0.2, emissivity: 0.9, waterCapacity_kg_per_kg: 0.05, shapeFactor: 6 },
  PEEK: { rho: 1300, cp: 1340, k: 0.25, emissivity: 0.9, waterCapacity_kg_per_kg: 0.05, shapeFactor: 6 },
  SILICONE: { rho: 1200, cp: 1300, k: 0.2, emissivity: 0.9, waterCapacity_kg_per_kg: 0.1, shapeFactor: 6 },
  COTTON_TEXTILE: { rho: 400, cp: 1400, k: 0.04, emissivity: 0.8, waterCapacity_kg_per_kg: 0.6, shapeFactor: 10 },
} as const satisfies Record<string, MaterialProps>;

export type MaterialName = keyof typeof MATERIALS;

/** Área de troca estimada da massa e densidade: A ≈ shapeFactor·(m/ρ)^(2/3) (m²). */
export function estimateArea(mass_kg: number, m: MaterialProps): number {
  if (mass_kg <= 0) return 0;
  return m.shapeFactor * Math.cbrt((mass_kg / m.rho) ** 2);
}
```

- [ ] **Step 4: Correr — passa**

Run: `pnpm --filter @sim/physics test test/materials.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/physics/src/materials.ts packages/physics/test/materials.test.ts
git commit -m "feat(physics): add material registry + estimateArea"
```

---

## Task 3: `load.ts` — tipos + `load_step` N-nós (núcleo)

**Files:**
- Modify: `packages/physics/src/load.ts` (reescrever)
- Test: `packages/physics/test/load.test.ts` (reescrever)

- [ ] **Step 1: Escrever testes falhados**

```ts
// packages/physics/test/load.test.ts
import { describe, it, expect } from 'vitest';
import { load_step, type LoadState, type LoadParams, type LoadEnv } from '../src/load.js';
import { C_to_K } from '../src/constants.js';
import { p_sat_water } from '../src/saturation.js';

const P: LoadParams = { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 };

function envAt(opts: Partial<LoadEnv>): LoadEnv {
  return {
    T_gas: C_to_K(134), rho_gas: 0.6, rho_gas_atm: 0.6,
    T_jacket: C_to_K(134), p_sat_at: p_sat_water, p_vap_chamber: p_sat_water(C_to_K(134)),
    chamber_has_vapor: true, ...opts,
  };
}
function oneNode(over: Partial<LoadState['nodes'][0]> = {}): LoadState {
  return { nodes: [{ name: 'n', material: 'STAINLESS_316', mass_kg: 1, T: C_to_K(134), m_water: 0, ...over }] };
}

describe('load_step', () => {
  it('evaporates (flash) when chamber pressure is below node saturation, cooling the node', () => {
    const s = oneNode({ m_water: 0.05, T: C_to_K(134) });
    const e = envAt({ p_vap_chamber: 5000 }); // deep vacuum, p_sat(134°C)≈3 bar >> 5 kPa
    const r = load_step(s, P, e, 1);
    expect(r.next.nodes[0]!.m_water).toBeLessThan(0.05); // water leaves
    expect(r.next.nodes[0]!.T).toBeLessThan(s.nodes[0]!.T); // latent cooling
    expect(r.vaporToChamber_kg).toBeGreaterThan(0); // vapor to chamber
  });

  it('condenses when node is colder than chamber saturation, warming it and accumulating water', () => {
    const s = oneNode({ T: C_to_K(80), m_water: 0 });
    const e = envAt({ p_vap_chamber: p_sat_water(C_to_K(134)), T_gas: C_to_K(134) });
    const r = load_step(s, P, e, 1);
    expect(r.next.nodes[0]!.m_water).toBeGreaterThan(0); // water accumulates
    expect(r.vaporToChamber_kg).toBeLessThan(0); // vapor removed from chamber
  });

  it('convection scales with gas density (≈0 under vacuum)', () => {
    const s = oneNode({ T: C_to_K(80) });
    const hi = load_step(s, P, envAt({ rho_gas: 0.6, p_vap_chamber: 0 }), 1).Q_conv_from_gas;
    const lo = load_step(s, P, envAt({ rho_gas: 1e-4, p_vap_chamber: 0 }), 1).Q_conv_from_gas;
    expect(Math.abs(lo)).toBeLessThan(Math.abs(hi) * 0.01);
  });

  it('radiation from a hot jacket warms a dry node under vacuum', () => {
    const s = oneNode({ T: C_to_K(60), m_water: 0 });
    const e = envAt({ rho_gas: 1e-6, T_jacket: C_to_K(140), p_vap_chamber: 0 });
    const r = load_step(s, P, e, 1);
    expect(r.Q_rad_from_jacket).toBeGreaterThan(0);
    expect(r.next.nodes[0]!.T).toBeGreaterThan(s.nodes[0]!.T);
  });

  it('conserves water between load and chamber (Σ dwater = −vaporToChamber)', () => {
    const s = oneNode({ m_water: 0.05, T: C_to_K(134) });
    const e = envAt({ p_vap_chamber: 5000 });
    const r = load_step(s, P, e, 1);
    const dWater = r.next.nodes[0]!.m_water - s.nodes[0]!.m_water;
    expect(dWater).toBeCloseTo(-r.vaporToChamber_kg, 12);
  });
});
```

- [ ] **Step 2: Correr — falha**

Run: `pnpm --filter @sim/physics test test/load.test.ts`
Expected: FAIL (nova API inexistente).

- [ ] **Step 3: Implementar (reescrever `load.ts`)**

```ts
// packages/physics/src/load.ts
import { MATERIALS, estimateArea, type MaterialName } from './materials.js';
import { h_vap_water } from './saturation.js';
import { CP_WATER, SIGMA_SB, C_to_K } from './constants.js';

export interface LoadNode {
  name: string;
  material: MaterialName;
  mass_kg: number;
  T: number; // K (estado)
  m_water: number; // kg (estado)
  isWitness?: boolean; // true = testemunho (referência p/ F0)
}

export interface LoadState {
  nodes: LoadNode[];
}

export interface LoadParams {
  h0_conv: number; // W/(m²·K) base @ρ_ref
  k_cond: number; // kg/(s·m²·Pa)
  k_ev: number; // kg/(s·m²·Pa)
}

export interface LoadEnv {
  T_gas: number; // K
  rho_gas: number; // kg/m³
  rho_gas_atm: number; // kg/m³ (referência)
  T_jacket: number; // K
  p_sat_at: (T: number) => number; // Pa
  p_vap_chamber: number; // Pa
  chamber_has_vapor: boolean;
}

export interface LoadStepResult {
  next: LoadState;
  Q_conv_from_gas: number; // W (positivo = retirado do gás)
  Q_rad_from_jacket: number; // W (positivo = retirado da jaqueta)
  vaporToChamber_kg: number; // Σ(evaporado − condensado) neste passo
}

export function load_step(s: LoadState, p: LoadParams, e: LoadEnv, dt: number): LoadStepResult {
  let Q_conv_total = 0;
  let Q_rad_total = 0;
  let vaporToChamber = 0;

  const nodes = s.nodes.map((node) => {
    const m = MATERIALS[node.material];
    const A = estimateArea(node.mass_kg, m);

    // Convecção ∝ densidade do gás (→0 no vácuo)
    const h_conv = p.h0_conv * (e.rho_gas / e.rho_gas_atm);
    const Q_conv = h_conv * A * (e.T_gas - node.T); // W (gás→nó)

    // Radiação da jaqueta (domina no vácuo)
    const Q_rad = m.emissivity * SIGMA_SB * A * (e.T_jacket ** 4 - node.T ** 4); // W

    // Mudança de fase dirigida por pressão (simétrica): Δp = p_sat(T_nó) − p_vap_câmara
    const dp = e.p_sat_at(node.T) - e.p_vap_chamber;
    let dWater = 0;
    if (dp > 0 && node.m_water > 0) {
      // Evaporação/flash: água sai do nó
      const m_ev = Math.min(p.k_ev * A * dp * dt, node.m_water);
      dWater = -m_ev;
    } else if (dp < 0 && e.chamber_has_vapor) {
      // Condensação: vapor deposita-se no nó, até à capacidade do material
      const cap = m.waterCapacity_kg_per_kg * node.mass_kg;
      const m_cond = Math.min(p.k_cond * A * -dp * dt, Math.max(0, cap - node.m_water));
      dWater = m_cond;
    }
    vaporToChamber += -dWater; // condensação (dWater>0) retira vapor da câmara

    // Calor latente: condensação (dWater>0) aquece o nó; evaporação (dWater<0) arrefece
    const Q_lat_energy = dWater * h_vap_water(node.T); // J

    // Massa térmica (usa água pré-passo)
    const C = Math.max(node.mass_kg * m.cp + node.m_water * CP_WATER, 1e-6);
    const dU = (Q_conv + Q_rad) * dt + Q_lat_energy;
    const T_new = node.T + dU / C;

    Q_conv_total += Q_conv;
    Q_rad_total += Q_rad;
    return { ...node, T: T_new, m_water: node.m_water + dWater };
  });

  return {
    next: { nodes },
    Q_conv_from_gas: Q_conv_total,
    Q_rad_from_jacket: Q_rad_total,
    vaporToChamber_kg: vaporToChamber,
  };
}

export interface LoadItemConfig {
  name?: string;
  material: MaterialName;
  mass_kg: number;
  initial_T_C?: number;
  witness?: boolean;
}

const DEFAULT_ITEMS: LoadItemConfig[] = [
  { name: 'load', material: 'STAINLESS_316', mass_kg: 20 },
  { name: 'testemunho', material: 'COTTON_TEXTILE', mass_kg: 5, witness: true },
];

/** Constrói o LoadState a partir de itens de config; carga-default quando ausente;
 *  injeta um nó testemunho se nenhum item o for. */
export function buildLoadState(items: LoadItemConfig[] | undefined, T_ambient_K: number): LoadState {
  const src = items && items.length > 0 ? items : DEFAULT_ITEMS;
  const nodes: LoadNode[] = src.map((it, i) => ({
    name: it.name ?? `item-${i}`,
    material: it.material,
    mass_kg: it.mass_kg,
    T: it.initial_T_C != null ? C_to_K(it.initial_T_C) : T_ambient_K,
    m_water: 0,
    isWitness: it.witness ?? false,
  }));
  if (!nodes.some((n) => n.isWitness)) {
    nodes.push({ name: 'testemunho', material: 'COTTON_TEXTILE', mass_kg: 0.05, T: T_ambient_K, m_water: 0, isWitness: true });
  }
  return { nodes };
}
```

- [ ] **Step 4: Correr — passa**

Run: `pnpm --filter @sim/physics test test/load.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add packages/physics/src/load.ts packages/physics/test/load.test.ts
git commit -m "feat(physics): rewrite load.ts as N-node model with condensation/flash/radiation"
```

---

## Task 4: `buildLoadState` — testes de config

**Files:**
- Test: `packages/physics/test/load.test.ts` (adicionar)

- [ ] **Step 1: Adicionar testes**

```ts
// append em packages/physics/test/load.test.ts
import { buildLoadState } from '../src/load.js';

describe('buildLoadState', () => {
  it('uses default load (steel + textile witness) when items omitted', () => {
    const st = buildLoadState(undefined, C_to_K(22));
    expect(st.nodes).toHaveLength(2);
    expect(st.nodes.some((n) => n.isWitness)).toBe(true);
    expect(st.nodes[0]!.material).toBe('STAINLESS_316');
  });
  it('injects a witness node when none is flagged', () => {
    const st = buildLoadState([{ material: 'ALUMINUM', mass_kg: 3 }], C_to_K(22));
    expect(st.nodes).toHaveLength(2);
    expect(st.nodes.filter((n) => n.isWitness)).toHaveLength(1);
  });
  it('honors an explicit witness and initial temperature', () => {
    const st = buildLoadState([{ material: 'GLASS', mass_kg: 1, initial_T_C: 30, witness: true }], C_to_K(22));
    expect(st.nodes).toHaveLength(1);
    expect(st.nodes[0]!.isWitness).toBe(true);
    expect(st.nodes[0]!.T).toBeCloseTo(C_to_K(30), 6);
  });
});
```

- [ ] **Step 2: Correr — passa** (implementação já existe da Task 3)

Run: `pnpm --filter @sim/physics test test/load.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/physics/test/load.test.ts
git commit -m "test(physics): cover buildLoadState defaults + witness injection"
```

---

## Task 5: `chamber.ts` — acoplamento parede∝densidade

**Files:**
- Modify: `packages/physics/src/chamber.ts` (interface `ChamberFluxes` + uso do `wall_h`)
- Test: `packages/physics/test/chamber.test.ts` (adicionar caso)

- [ ] **Step 1: Escrever teste falhado**

```ts
// append em packages/physics/test/chamber.test.ts
import { chamber_step, type ChamberState, type ChamberParams, type ChamberFluxes } from '../src/chamber.js';
import { C_to_K } from '../src/constants.js';

describe('wall coupling scales with gas density', () => {
  const p: ChamberParams = { V: 0.15, allowLiquid: true, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200 };
  const base: ChamberState = { m_air: 1e-5, m_vap: 1e-4, m_liq: 0, T: C_to_K(60), T_wall: C_to_K(140) };
  const noFlow: ChamberFluxes = { inflow: { air: 0, vap: 0, liq: 0 }, inflow_T: base.T, outflow: { air: 0, vap: 0, liq: 0 }, Q_external: 0 };

  it('with scale≈0 the near-vacuum gas barely tracks the hot wall', () => {
    const full = chamber_step(base, p, { ...noFlow, wall_coupling_scale: 1 }, 0.05);
    const vac = chamber_step(base, p, { ...noFlow, wall_coupling_scale: 1e-4 }, 0.05);
    // scaled-down coupling ⇒ smaller rise toward the 140 °C wall
    expect(vac.T - base.T).toBeLessThan(full.T - base.T);
  });
});
```

- [ ] **Step 2: Correr — falha**

Run: `pnpm --filter @sim/physics test test/chamber.test.ts`
Expected: FAIL (campo `wall_coupling_scale` inexistente / sem efeito).

- [ ] **Step 3: Implementar**

Em `packages/physics/src/chamber.ts`, adicionar campo à interface `ChamberFluxes`:
```ts
export interface ChamberFluxes {
  inflow: SpeciesFlow;
  inflow_T: number; // K
  outflow: SpeciesFlow;
  Q_external: number; // W (positive = into chamber)
  /** Escala do acoplamento convectivo parede↔gás (∝ densidade). Default 1 (back-compat). */
  wall_coupling_scale?: number;
}
```
Na secção "3.2. Wall thermal mass coupling", trocar a leitura de `wall_h`:
```ts
  const wall_mass = p.wall_mass_kg ?? 0;
  const wall_cp = p.wall_cp_J_per_kg_K ?? 500;
  const wall_h = (p.wall_h_W_per_K ?? 200) * (f.wall_coupling_scale ?? 1);
```
(o resto do bloco de acoplamento fica igual, já usa `wall_h`.)

- [ ] **Step 4: Correr — passa**

Run: `pnpm --filter @sim/physics test test/chamber.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/physics/src/chamber.ts packages/physics/test/chamber.test.ts
git commit -m "feat(physics): scale chamber wall↔gas coupling by gas density"
```

---

## Task 6: `integrator.ts` — ligar carga N-nós + conservação + F0 witness

**Files:**
- Modify: `packages/physics/src/integrator.ts`
- Test: `packages/physics/test/integrator/drying.test.ts` (criar)

- [ ] **Step 1: Escrever teste de integração falhado**

```ts
// packages/physics/test/integrator/drying.test.ts
import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { buildLoadState } from '../../src/load.js';
import { p_sat_water } from '../../src/saturation.js';
import { C_to_K, R_AIR, R_VAP, P_ATM, GAMMA_VAP, GAMMA_AIR } from '../../src/constants.js';

function params(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200 },
    jacket: { V: 0.025, allowLiquid: false, wall_mass_kg: 15, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 100 },
    generator: null,
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
    valves: {
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR } },
    },
    external: { steam_line_pressure: 5e5, steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
    jacket_chamber_h_W_per_K: 150,
  };
}

// câmara: vapor saturado quente + carga húmida quente; jaqueta quente; a puxar vácuo
function wetHotState(p: SystemParams): SystemState {
  const T = C_to_K(134);
  const load = buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], T);
  load.nodes[0]!.m_water = 0.2; // carga encharcada
  return {
    chamber: { m_air: 1e-6, m_vap: (p_sat_water(T) * 0.15) / (R_VAP * T), m_liq: 0, T, T_wall: T },
    jacket: { m_air: 0, m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(140)), m_liq: 0, T: C_to_K(140), T_wall: C_to_K(140) },
    generator: null,
    load,
    f0_minutes: 0,
    time_s: 0,
  };
}

describe('vacuum drying', () => {
  it('cools the witness by evaporative flash as the chamber is pumped down', () => {
    const p = params();
    let s = wetHotState(p);
    const T0 = s.load.nodes.find((n) => n.isWitness)!.T;
    for (let i = 0; i < 4000; i++) {
      s = system_step(s, p, { V_VAC: true }, { heater_gen: false, pump_vac: true }, 0.05);
    }
    const witness = s.load.nodes.find((n) => n.isWitness)!;
    expect(witness.T).toBeLessThan(T0 - 10); // testemunho cai >10 °C
    expect(witness.m_water).toBeLessThan(0.2); // secou
  });
});
```

- [ ] **Step 2: Correr — falha**

Run: `pnpm --filter @sim/physics test test/integrator/drying.test.ts`
Expected: FAIL (assinatura antiga de `SystemParams.load`/`SystemState.load` + `load_step`).

- [ ] **Step 3: Implementar alterações no `integrator.ts`**

3a. Imports:
```ts
import { load_step, type LoadState, type LoadParams } from './load.js';
import { p_sat_water } from './saturation.js';
import { P_ATM, GAMMA_AIR, GAMMA_VAP, RHO_GAS_ATM_REF } from './constants.js';
```
(`LoadState`/`LoadParams` já vêm de load.js; `SystemState.load: LoadState` e `SystemParams.load: LoadParams` mantêm o nome do campo, muda o tipo.)

3b. Substituir o bloco "Load step" (linhas ~217-219) por:
```ts
  // Densidade do gás da câmara p/ escalar convecção (∝ ρ)
  const rho_gas_chamber = (state.chamber.m_air + state.chamber.m_vap) / params.chamber.V;
  const p_vap_chamber = chamber_pressure(state.chamber, params.chamber).p_vap;
  const loadResult = load_step(
    state.load,
    params.load,
    {
      T_gas: state.chamber.T,
      rho_gas: rho_gas_chamber,
      rho_gas_atm: RHO_GAS_ATM_REF,
      T_jacket: state.jacket.T,
      p_sat_at: p_sat_water,
      p_vap_chamber,
      chamber_has_vapor: state.chamber.m_vap > 0,
    },
    dt,
  );
  const Q_load = loadResult.Q_conv_from_gas; // convectivo retirado do gás
```

3c. Injetar a água carga↔câmara no acumulador da câmara (antes de montar `chamberFluxes`):
```ts
  // Conservação de água carga↔câmara: >0 evaporou p/ câmara (entra), <0 condensou (sai)
  if (loadResult.vaporToChamber_kg > 0) {
    acc.chamber.vap_in += loadResult.vaporToChamber_kg;
    acc.chamber.inflow_T_weighted += loadResult.vaporToChamber_kg * state.chamber.T;
    acc.chamber.inflow_T_mass += loadResult.vaporToChamber_kg;
  } else if (loadResult.vaporToChamber_kg < 0) {
    acc.chamber.vap_out += -loadResult.vaporToChamber_kg;
  }
```

3d. `chamberFluxes.wall_coupling_scale` + Q_external (radiação NÃO passa pelo gás):
```ts
  const chamberFluxes: ChamberFluxes = {
    inflow: speciesIn(acc.chamber),
    inflow_T: inflowT(acc.chamber, state.chamber.T),
    outflow: speciesOut(acc.chamber),
    Q_external: -Q_load + Q_jacket_to_chamber,
    wall_coupling_scale: rho_gas_chamber / RHO_GAS_ATM_REF,
  };
```

3e. Jaqueta perde o Q_rad emitido p/ a carga:
```ts
  const jacketFluxes: ChamberFluxes = {
    inflow: speciesIn(acc.jacket),
    inflow_T: inflowT(acc.jacket, state.jacket.T),
    outflow: speciesOut(acc.jacket),
    Q_external: -Q_jacket_to_chamber - loadResult.Q_rad_from_jacket,
  };
```

3f. F0 no nó testemunho (substituir bloco linhas ~256-259):
```ts
  const witness = loadResult.next.nodes.find((n) => n.isWitness) ?? loadResult.next.nodes[0];
  const f0 = new F0Accumulator();
  f0.value_minutes = state.f0_minutes;
  if (witness) f0.step(witness.T, dt);
```

- [ ] **Step 4: Correr — passa**

Run: `pnpm --filter @sim/physics test test/integrator/drying.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/physics/src/integrator.ts packages/physics/test/integrator/drying.test.ts
git commit -m "feat(physics): wire N-node load into integrator (density-scaled conv, radiation, water conservation, F0 witness)"
```

---

## Task 7: `cli.ts` — config `load` como lista + retro-compat + trace pelo witness

**Files:**
- Modify: `packages/physics/src/cli.ts`
- Test: `packages/physics/test/cli-load.test.ts` (criar)

- [ ] **Step 1: Escrever teste falhado**

```ts
// packages/physics/test/cli-load.test.ts
import { describe, it, expect } from 'vitest';
import { resolveLoadItems } from '../src/cli.js';

describe('resolveLoadItems', () => {
  it('maps legacy {metal_kg, fabric_kg} to steel + textile witness', () => {
    const items = resolveLoadItems({ metal_kg: 20, fabric_kg: 5 });
    expect(items).toEqual([
      { name: 'metal', material: 'STAINLESS_316', mass_kg: 20 },
      { name: 'fabric', material: 'COTTON_TEXTILE', mass_kg: 5, witness: true },
    ]);
  });
  it('passes an explicit item list through unchanged', () => {
    const list = [{ material: 'ALUMINUM' as const, mass_kg: 3 }];
    expect(resolveLoadItems(list)).toBe(list);
  });
  it('returns undefined when load is absent (→ default handled downstream)', () => {
    expect(resolveLoadItems(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr — falha**

Run: `pnpm --filter @sim/physics test test/cli-load.test.ts`
Expected: FAIL (`resolveLoadItems` inexistente).

- [ ] **Step 3: Implementar em `cli.ts`**

3a. Ajustar tipo do cenário (`equipment.load` aceita lista OU legado):
```ts
import { buildLoadState, type LoadItemConfig } from './load.js';
// ...
  equipment: {
    // ...campos existentes...
    load: LoadItemConfig[] | { metal_kg: number; fabric_kg: number };
  };
```

3b. Exportar o resolvedor (retro-compat):
```ts
export function resolveLoadItems(
  load: LoadItemConfig[] | { metal_kg: number; fabric_kg: number } | undefined,
): LoadItemConfig[] | undefined {
  if (!load) return undefined;
  if (Array.isArray(load)) return load;
  return [
    { name: 'metal', material: 'STAINLESS_316', mass_kg: load.metal_kg },
    { name: 'fabric', material: 'COTTON_TEXTILE', mass_kg: load.fabric_kg, witness: true },
  ];
}
```

3c. Em `makeParams`, trocar o `load: {...}` antigo por coeficientes globais:
```ts
    load: { h0_conv: H0_CONV_DEFAULT, k_cond: K_COND_DEFAULT, k_ev: K_EV_DEFAULT },
```
(importar `H0_CONV_DEFAULT, K_COND_DEFAULT, K_EV_DEFAULT` de `./constants.js`.)

3d. Em `makeInitialState`, substituir `load: { T_metal, T_fabric }` por:
```ts
    load: buildLoadState(resolveLoadItems(eq.load), T_ambient),
```

3e. No trace, `T_test` passa a vir do nó witness:
```ts
        T_test_C: K_to_C(
          (state.load.nodes.find((n) => n.isWitness) ?? state.load.nodes[0])!.T,
        ),
```
(e nas duas linhas de `console.log` finais que usavam `state.load.T_fabric`, usar a mesma expressão.)

- [ ] **Step 4: Correr — passa**

Run: `pnpm --filter @sim/physics test test/cli-load.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificar cenário existente corre**

Run: `pnpm --filter @sim/physics build && node packages/physics/dist/cli.js packages/physics/scenarios/ster-134-prevac.yaml /tmp/t.csv` (ou o caminho de cenário existente; ajustar).
Expected: corre sem erro; `T_test` final impresso.

- [ ] **Step 6: Commit**

```bash
git add packages/physics/src/cli.ts packages/physics/test/cli-load.test.ts
git commit -m "feat(physics): cli load as item list with legacy mapping + witness trace"
```

---

## Task 8: Exportar `materials` no index

**Files:**
- Modify: `packages/physics/src/index.ts`

- [ ] **Step 1: Adicionar export**

```ts
export * from './materials.js';
```
(e garantir que `load.js` exports novos tipos já estão reexportados; adicionar se em falta.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @sim/physics typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add packages/physics/src/index.ts
git commit -m "chore(physics): export materials from package index"
```

---

## Task 9: Regressão física — ajustar cenários/testes existentes

**Files:**
- Modify: testes de cenário existentes em `packages/physics/test/**` que assumem a carga antiga.

- [ ] **Step 1: Correr toda a suite physics**

Run: `pnpm --filter @sim/physics test`
Expected: falhas apenas em testes que (a) usam `params.load` antigo `{m_metal,...}`, (b) leem `state.load.T_fabric`, ou (c) têm tolerâncias de timing de `T_test`/F0 apertadas.

- [ ] **Step 2: Corrigir chamadas de API antigas**

Para cada teste que constrói `SystemParams`/`SystemState` à mão:
- `load` params → `{ h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 }`.
- estado inicial `load` → `buildLoadState(undefined, T_ambient)` (ou lista explícita).
- leituras `state.load.T_fabric` → `state.load.nodes.find(n=>n.isWitness)!.T`.

- [ ] **Step 3: Ajustar tolerâncias, não asserções de fundo**

Onde uma asserção verificava `T_test`/F0 com margem apertada e a nova física desloca ligeiramente (na fase de secagem), alargar a tolerância mantendo a asserção de fundo (ex.: HOLD atinge ~134 °C, F0 ≥ 100). **Não** relaxar as asserções estruturais (F0 ≥ 100 no fim do ciclo de esterilização).

- [ ] **Step 4: Correr até verde**

Run: `pnpm --filter @sim/physics test`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add packages/physics/test
git commit -m "test(physics): migrate existing scenarios to N-node load API"
```

---

## Task 10: `apps/web` — schema `load` + runtime + snapshot

**Files:**
- Modify: `apps/web/server/virtual-plc/cycle-config.ts`
- Modify: `apps/web/server/runtime/singleton.ts`
- Modify: `apps/web/server/runtime/snapshot.ts`
- Test: `apps/web/test/runtime/load-config.test.ts` (criar)

- [ ] **Step 1: Escrever teste falhado**

```ts
// apps/web/test/runtime/load-config.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { CycleConfigSchema } from '../../server/virtual-plc/cycle-config.js';

const base = {
  name: 't', sterilization_T_C: 134, sterilization_P_bar: 3.04, hold_duration_s: 60,
  prevac_pulses: 0, prevac_vacuum_target_bar: 0.2, prevac_steam_target_bar: 2,
  preheat_duration_s: 10, dry_duration_s: 60, f0_target_min: 1,
};

describe('load config in cycle', () => {
  beforeEach(() => resetRuntime());
  it('accepts an optional load block', () => {
    const c = CycleConfigSchema.parse({ ...base, load: [{ material: 'ALUMINUM', mass_kg: 3, witness: true }] });
    expect(c.load).toHaveLength(1);
  });
  it('startCycle builds the load nodes from the cycle', () => {
    const r = getRuntime();
    r.startCycle(CycleConfigSchema.parse({ ...base, load: [{ material: 'GLASS', mass_kg: 2, witness: true }] }));
    const witness = r.orchestrator.getState().load.nodes.find((n) => n.isWitness);
    expect(witness?.material).toBe('GLASS');
  });
  it('defaults the load when the block is omitted', () => {
    const r = getRuntime();
    r.startCycle(CycleConfigSchema.parse(base));
    expect(r.orchestrator.getState().load.nodes.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Correr — falha**

Run: `pnpm --filter @sim/web test test/runtime/load-config.test.ts`
Expected: FAIL.

- [ ] **Step 3: `cycle-config.ts` — schema `load`**

```ts
import { z } from 'zod';

const LoadItemSchema = z.object({
  name: z.string().optional(),
  material: z.enum([
    'STAINLESS_316', 'CARBON_STEEL', 'ALUMINUM', 'GLASS',
    'POLYPROPYLENE', 'PEEK', 'SILICONE', 'COTTON_TEXTILE',
  ]),
  mass_kg: z.number().positive(),
  initial_T_C: z.number().optional(),
  witness: z.boolean().optional(),
});

export const CycleConfigSchema = z.object({
  // ...campos existentes...
  load: z.array(LoadItemSchema).optional(),
});
export type CycleConfig = z.infer<typeof CycleConfigSchema>;
```

- [ ] **Step 4: `singleton.ts` — nós default + startCycle constrói carga**

4a. Import + reposição de estado:
```ts
import { buildLoadState } from '@sim/physics';
```
4b. Em `preheatedInitial`, trocar `load: { T_metal, T_fabric }` por:
```ts
    load: buildLoadState(undefined, C_to_K(22)),
```
4c. `defaultParams().load` → coeficientes:
```ts
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
```
4d. Em `startCycle(cycle)`, repor os nós da carga a partir do ciclo:
```ts
  startCycle(cycle: CycleConfig): void {
    this.plc = new VirtualPLC(cycle, this.bridge);
    this.plc.start();
    this.cycle_running = true;
    this.cycle_started_at_s = this.orchestrator.getState().time_s;
    this.orchestrator.setLoadState(buildLoadState(cycle.load, C_to_K(22)));
  }
```
4e. Se `Orchestrator` não expõe `setLoadState`, adicionar um método que substitui `state.load` no seu estado interno (mutação mínima). Verificar `orchestrator.ts` e acrescentar:
```ts
  setLoadState(load: LoadState): void {
    this.state = { ...this.state, load };
  }
```
(importar `LoadState` de `@sim/physics`.)

- [ ] **Step 5: `snapshot.ts` — testemunho do witness**

Trocar `testemunho_C: K_to_C(o.state.load.T_fabric)` por:
```ts
      testemunho_C: K_to_C(
        (o.state.load.nodes.find((n) => n.isWitness) ?? o.state.load.nodes[0]).T,
      ),
```

- [ ] **Step 6: Correr — passa**

Run: `pnpm --filter @sim/web test test/runtime/load-config.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/server/virtual-plc/cycle-config.ts apps/web/server/runtime/singleton.ts apps/web/server/runtime/snapshot.ts apps/web/test/runtime/load-config.test.ts
git commit -m "feat(web): optional load config in cycle + build load nodes at cycle start"
```

---

## Task 11: Regressão web + verificação end-to-end

**Files:**
- Modify: testes web existentes que leem `T_fabric`/`params.load` antigo.

- [ ] **Step 1: Suite web completa**

Run: `pnpm --filter @sim/web test`
Expected: falhas só em pontos que usam a API antiga da carga.

- [ ] **Step 2: Migrar chamadas antigas** (mesma regra da Task 9: `T_fabric` → nó witness; `load` params → coeficientes; estado inicial → `buildLoadState`). Ajustar tolerâncias de timing onde a secagem desloca, mantendo asserções de fundo (F0 ≥ 100 no ciclo).

- [ ] **Step 3: Suite repo-wide + typecheck + lint + drift**

Run: `pnpm typecheck && pnpm test && pnpm lint && pnpm drift-check`
Expected: tudo verde (drift-check não afetado — sem mudanças em `packages/protocol`).

- [ ] **Step 4: Verificação end-to-end (cenário de secagem)**

Run: `pnpm --filter @sim/web scenario:run server/scenarios/ster-134-prevac.yaml --out out/trace.csv --sample-period 1.0`
Depois inspecionar o trace na zona DRY: confirmar `T_test` **desce** (não fica preso a 134 °C) e F0 do HOLD ≥ 100.
Expected: `T_test` cai na secagem; sem "134 °C @ 0.01 bar".

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(web): migrate to N-node load; verify drying cools witness end-to-end"
```

---

## Self-review (feito)

- **Cobertura do spec**: materiais (T2), interfaces load (T3), builder/default (T3/T4), convecção∝ρ (T3+T5+T6), radiação (T3/T6), condensação+flash (T3/T6), conservação água (T3/T6), F0 witness (T6), YAML+default web (T10), CLI+retro-compat (T7), regressão (T9/T11). Todos os requisitos do spec têm task.
- **Placeholders**: nenhum; todo o código é concreto.
- **Consistência de tipos**: `LoadParams {h0_conv,k_cond,k_ev}`, `LoadEnv`, `LoadStepResult {Q_conv_from_gas,Q_rad_from_jacket,vaporToChamber_kg}`, `buildLoadState(items,T)`, `ChamberFluxes.wall_coupling_scale` — usados de forma idêntica entre T3/T5/T6/T7/T10.
- **Nota de conservação de energia**: o calor latente é aplicado no lado da carga; o vapor sai/entra na câmara com a sua entalpia. Massa de água é conservada exatamente (teste T3); energia é conservada aproximadamente (latente domina) — aceite na v1 (spec §7).
