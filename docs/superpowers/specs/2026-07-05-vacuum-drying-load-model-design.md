# Spec — Modelo de carga N-nós + secagem a vácuo (arrefecimento evaporativo)

- **Data**: 2026-07-05
- **Âmbito**: `packages/physics` (`load.ts`, `chamber.ts`, `constants.ts`, novo `materials.ts`, `integrator.ts`, `cli.ts`) + `apps/web` (`cycle-config.ts`, `singleton.ts`, `snapshot.ts`)
- **Teoria de suporte**: [`packages/physics/docs/modelo-secagem-vacuo.md`](../../../packages/physics/docs/modelo-secagem-vacuo.md)
- **Abordagem escolhida**: A — refatorar `load.ts` in-place para array de nós.

## 1. Problema

Na secagem (EXHAUST→DRY) a pressão da câmara colapsa (3.04→0.01 bar) mas a temperatura fica presa em ~134 °C (câmara e testemunho). Causa: `load.ts` não modela humidade/evaporação/radiação e a convecção gás↔carga/parede é constante (não cai no vácuo), prendendo T. Fisicamente, a humidade residual na carga deve fazer _flash_ ao baixar a pressão, roubar calor latente à carga e arrefecê-la; a jaqueta só repõe calor por radiação (sem gás → sem convecção). Ver teoria §§1–3.

## 2. Decisões (fechadas com o utilizador)

1. **Nós térmicos**: N nós (1 por item configurado) + nó testemunho dedicado (`isWitness`).
2. **Config da carga**: bloco `load` opcional no YAML de cenário; **carga-default** quando ausente (não-quebra).
3. **Área de superfície**: sempre estimada de massa+densidade — `A ≈ shapeFactor·(m/ρ)^(2/3)`.
4. **Convecção vs vácuo**: escala com densidade do gás (`h_eff = h0·ρ_gas/ρ_gas_atm`) — o mais físico.
5. **Condensação**: acumulada durante todo o ciclo (estado `m_water` por nó), simétrica com a evaporação.
6. **Complexidade**: pragmático — nós lumped, `k` só para checagem de Biot (sem sub-nós/gradientes na v1). Coeficientes `h0/h_film/k_ev/shapeFactor/waterCapacity` são knobs calibráveis com defaults.
7. **Conservação**: jaqueta perde o `Q_rad` que emite p/ a carga; água conservada carga↔câmara.

## 3. Arquitetura — módulos e interfaces

### 3.1 Novo `packages/physics/src/materials.ts`

```ts
export interface MaterialProps {
  rho: number; // kg/m³
  cp: number; // J/(kg·K)
  k: number; // W/(m·K) — só p/ checagem de Biot
  emissivity: number; // 0..1
  waterCapacity_kg_per_kg: number; // condensado máx retido / kg seco
  shapeFactor: number; // A ≈ shapeFactor·(m/ρ)^(2/3)
}
export const MATERIALS = {
  STAINLESS_316,
  CARBON_STEEL,
  ALUMINUM,
  GLASS,
  POLYPROPYLENE,
  PEEK,
  SILICONE,
  COTTON_TEXTILE,
} as const satisfies Record<string, MaterialProps>;
export type MaterialName = keyof typeof MATERIALS;
export function estimateArea(mass_kg: number, m: MaterialProps): number;
```

Valores base: teoria §5.1.

### 3.2 `load.ts` (refatorado)

```ts
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
  h0_conv: number;
  h_film: number;
  k_ev: number;
}
export interface LoadEnv {
  T_gas: number;
  rho_gas: number;
  rho_gas_atm: number;
  T_jacket: number;
  p_sat_at: (T: number) => number;
  p_vap_chamber: number;
}
export interface LoadStepResult {
  next: LoadState;
  Q_conv_from_gas: number; // W, soma dos nós (retirado do gás)
  Q_rad_from_jacket: number; // W, soma (retirado da jaqueta)
  vaporToChamber_kg: number; // Σ(evaporado − condensado) neste passo
}
export function load_step(s: LoadState, p: LoadParams, e: LoadEnv, dt: number): LoadStepResult;
```

Builder partilhado (usado por CLI + web):

```ts
export interface LoadItemConfig {
  name?: string;
  material: MaterialName;
  mass_kg: number;
  initial_T_C?: number;
  witness?: boolean;
}
export function buildLoadState(items: LoadItemConfig[] | undefined, T_ambient_K: number): LoadState;
```

- `items` ausente → carga-default `[STAINLESS_316 20 kg, COTTON_TEXTILE 5 kg witness]`.
- Nenhum `witness` → injeta nó testemunho padrão.

### 3.3 `chamber.ts`

`wall_h` efetivo ∝ densidade: `wall_h_eff = wall_h · (ρ_gas/ρ_gas_atm)`. Sem outra mudança estrutural.

### 3.4 `constants.ts`

`SIGMA_SB = 5.670e-8`, `RHO_GAS_ATM_REF`, defaults `H0_CONV`, `H_FILM`, `K_EV`.

## 4. Fluxo de dados (`integrator.ts` `system_step`)

1. `rho_gas = (chamber.m_air + chamber.m_vap) / chamber.V`.
2. `env = { T_gas: chamber.T, rho_gas, rho_gas_atm: RHO_GAS_ATM_REF, T_jacket: jacket.T, p_sat_at: p_sat_water, p_vap_chamber: chamber_pressure(chamber).p_vap }`.
3. `loadResult = load_step(state.load, params.load, env, dt)`.
4. Acoplamentos:
   - Câmara-gás `Q_external`: `−Q_conv_from_gas` + jacket↔chamber (inalterado). Radiação **não** passa pelo gás.
   - Jaqueta `Q_external`: `−= Q_rad_from_jacket` (conservação).
   - Água carga↔câmara: `vaporToChamber_kg` no acumulador de vapor da câmara — `>0` → `vap_in` a `T_load` (média dos nós que evaporam); `<0` → `vap_out`.
5. F0: `witness = loadResult.next.nodes.find(n => n.isWitness) ?? nodes[0]; f0.step(witness.T, dt)`.
6. `SystemState.load` = `{ nodes }`; `SystemParams.load` = coeficientes globais.

## 5. Integração YAML + carga-default

### 5.1 Web (`apps/web`)

- `CycleConfigSchema` ganha `load?: LoadItemConfig[]` (opcional, validado por zod).
- `singleton.startCycle(cycle)` → `buildLoadState(cycle.load, T_amb)` e repõe `state.load` no arranque.
- `defaultParams`/`preheatedInitial` migram p/ `{nodes}`.
- `buildSnapshot`: `testemunho_C` = nó witness. (Temps por-nó no snapshot: fora de escopo.)

### 5.2 Physics CLI (`cli.ts`)

- `equipment.load` aceita `LoadItemConfig[]`. Retro-compat: `{metal_kg, fabric_kg}` → `[STAINLESS_316 metal_kg, COTTON_TEXTILE fabric_kg witness]`.
- `makeInitialState` usa `buildLoadState`.

### 5.3 Exemplo

```yaml
load:
  - { material: STAINLESS_316, mass_kg: 20 }
  - { material: COTTON_TEXTILE, mass_kg: 5, witness: true }
# omitido → carga-default
```

## 6. Testes (Vitest, TDD)

**Unit `materials.ts`**: valores sãos (ε∈[0,1], ρ/cp>0); `estimateArea` monotónica na massa.

**Unit `load.ts`** (um efeito por teste):

- Condensação: `T_load<T_sat`, vapor → `m_water↑`, `T_load↑`, `vaporToChamber<0`.
- Flash: `P<p_sat(T_load)`, `m_water>0` → `m_water↓`, `T_load↓`, `vaporToChamber>0`.
- Auto-limite: com água, `T_load` estabiliza perto de `T_sat(P)`.
- Convecção ∝ρ: `rho_gas` alto → forte; `rho_gas→0` → `Q_conv≈0`.
- Radiação: vácuo + seco → `T_load` puxada p/ `T_jacket`.
- Conservação de água: perdida pela carga = entregue à câmara.
- Witness: F0 usa nó `isWitness`.

**Integração — cenário de secagem** (fecha o bug §1):

- 134 prevac. Fase DRY: `T_test` desce > 10 °C do pico; `m_water_load→0`; sem "134 °C @ 0.01 bar".
- HOLD inalterado: `T_test` atinge 134 °C; **F0 ≥ 100**.

**Regressão**:

- ~68 testes atuais passam com carga-default; ajustar **tolerâncias** de timing onde a nova física desloca ligeiramente (não a asserção de fundo).
- Cenário sem `load` → carga-default, corre.

## 7. Invariantes / fora de escopo

- SI interno; constantes em `constants.ts`/`materials.ts`, sem magic numbers inline.
- Conservação de massa de água (carga↔câmara) e de energia (latente nos dois lados).
- F0 referencia o nó testemunho.
- **Fora de escopo**: UI de configuração de carga no web (SP posterior); temps por-nó no snapshot; sub-nós/gradientes internos (Biot só informativo); termo de arrefecimento por expansão da câmara-gás (a decoupling P–T da câmara-gás resolve-se pela física da carga; o vapor-só superaquecido sobre parede quente é aceitável — o alvo é `T_test` cair).

## 8. Fontes

Ver [`modelo-secagem-vacuo.md`](../../../packages/physics/docs/modelo-secagem-vacuo.md) §10 (flash evaporation, Stefan-Boltzmann, AIST/EngineeringToolbox, retenção têxtil).
