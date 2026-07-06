# Knobs no dashboard — design

**Data:** 2026-07-06
**Estado:** aprovado (brainstorming), pronto p/ plano de implementação
**Contexto:** `apps/web` — expor parâmetros tunáveis do emulador HIL na UI, sem editar código/YAML à mão.

## Objectivo

Dar ao operador um painel para ajustar os parâmetros do simulador (setpoints de ciclo, calibração da
planta física, controlador de referência, velocidade de simulação) a partir do dashboard. Tuning HIL:
ver a resposta do modelo enquanto se mexe nos knobs.

## Decisões (brainstorming)

| Eixo | Decisão |
|------|---------|
| Escopo | 4 famílias: **cycle**, **plant**, **controller**, **time** |
| Liveness | **plant/controller/time** aplicam live (ciclo a correr); **cycle** só pré-arranque (semeia PLC/load) |
| Persistência | ficheiro override em disco (`apps/web/knobs.override.json`, gitignored) |
| UI | página nova `/knobs`, agrupada por família |
| Wiring | **registry declarativo** com acessoras `get/set` tipadas (não string-paths) |

## Abordagem escolhida: registry declarativo

Um array de descritores de knob é a fonte única. API e UI são geradas dele. Adicionar um knob = 1 entrada.

Rejeitadas: (B) endpoint+campo hardcoded por knob — drift e boilerplate a ~25 knobs; (C) editar
`SystemParams` inteiro como JSON tree — sem validação, dá para injectar disparate.

## Componentes

### 1. Knob registry — `apps/web/server/knobs/registry.ts`

Fonte única. Cada descritor:

```ts
interface KnobDescriptor {
  id: string;                       // ex. 'plant.chamber.h_ambient'
  family: 'cycle' | 'plant' | 'controller' | 'time';
  label: string;                    // rótulo UI
  unit: string;                     // ex. 'bar', 'W/K', '×', 's'
  default: number;
  min: number;
  max: number;
  step?: number;                    // passo do number input (default 'any')
  timing: 'live' | 'precycle';
  get(rt: Runtime): number;         // lê valor corrente
  set(rt: Runtime, v: number): void; // escreve valor
}
```

Acessoras tipadas isolam "onde escrever" do resto — um refactor do modelo físico não parte a UI, só
as acessoras. Ex.:

```ts
{ id: 'plant.chamber.h_ambient', family: 'plant', label: 'Perda ambiente câmara',
  unit: 'W/K', default: 10, min: 0, max: 100, timing: 'live',
  get: rt => rt.params.chamber.h_ambient_W_per_K,
  set: (rt, v) => { rt.params.chamber.h_ambient_W_per_K = v; } }
```

**Nota:** unidades da UI podem diferir das SI internas (ex. `relief` em `bar` na UI,
`relief_pressure_Pa` internamente). A conversão vive **dentro** das acessoras (`get` divide por
`bar_to_Pa`, `set` multiplica) — o registry expõe a unidade amigável, o modelo mantém SI.

### 2. Estado + wiring no runtime

`KnobStore` no singleton: `Record<id, number>` dos valores correntes (overrides sobre os defaults).

- **Boot:** para cada knob, valor = override persistido ?? `descriptor.default`; aplica via `set(rt, v)`.
- **plant** → `set` muta `rt.params` in-place. `Orchestrator` guarda `params` por referência e lê
  em `system_step` cada tick → pega live sem rewire. _(Verificado: `orchestrator.ts:16,28`.)_
- **time** → `ticks_per_wall` deixa de ser constante capturada na closure do scheduler; passa a valor
  mutável lido a cada firing (ex. `rt.timeScale`, e o scheduler lê `rt.timeScale` dentro do loop).
- **controller** → dois offsets (`band_low`, `band_high`) num objecto `rt.controller`;
  `chamberValveBangBang` recebe-os como argumentos em vez das constantes `+0.1`/`+0.5`.
- **cycle** → `set` escreve em `rt.cycleOverride: Partial<CycleConfig>`; `startCycle` faz
  `{ ...scenarioConfig, ...cycleOverride }` antes de construir o `VirtualPLC`. Não muta um ciclo a correr.

Novos campos no `Runtime`: `knobs: KnobStore`, `timeScale: number`, `controller: { band_low, band_high }`,
`cycleOverride: Partial<CycleConfig>`.

### 3. Persistência — `apps/web/knobs.override.json`

- Gitignored (tuning transitório por máquina; o cenário versionado continua em YAML).
- Formato: `{ [id]: number }` — só os knobs alterados face ao default.
- **Load:** bootstrap lê o ficheiro (ausente = `{}`), aplica sobre os defaults.
- **Save:** cada `POST /api/knobs` reescreve o ficheiro inteiro (ficheiro pequeno; escrita síncrona simples).
- **Reset:** `POST /api/knobs/reset` apaga o ficheiro e repõe todos os defaults do registry via `set`.

### 4. API — `apps/web/app/api/knobs/`

| Rota | Método | Corpo | Efeito |
|------|--------|-------|--------|
| `/api/knobs` | GET | — | `{ knobs: KnobDescriptor[], values: Record<id,number> }` (descritores sem as fns) |
| `/api/knobs` | POST | `{ id, value }` | valida contra `min/max`; se `timing==='precycle'` e `cycle_running` → 409; aplica `set`; persiste |
| `/api/knobs/reset` | POST | — | repõe defaults, apaga override file |

Validação: `id` existe, `value` finito e em `[min,max]` → senão 400.

### 5. UI — `apps/web/app/knobs/page.tsx`

- Fetch inicial `GET /api/knobs`; valores correntes seguem o snapshot SSE onde aplicável, ou re-fetch após POST.
- Secções por família (Ciclo / Planta / Controlador / Tempo). Cada knob: label + number input + unidade + botão reset individual.
- Inputs de família `cycle` desativados quando `snapshot.cycle_running` (com nota, como o `ValvePanel`).
- POST on-change (blur ou debounce). Erro 409/400 mostrado inline, como o padrão do `ValvePanel`.
- Link no layout/nav para `/knobs`.

## MVP de knobs (curado)

O registry torna a extensão trivial (1 entrada). Arranque com:

**Cycle** (precycle): `sterilization_T_C`, `hold_duration_s`, `prevac_pulses`,
`prevac_vacuum_target_bar`, `prevac_steam_target_bar`, `dry_duration_s`.

**Plant** (live): relief câmara (bar), `h_ambient_W_per_K`, `drain_kg_per_s`, `heater_power_W` do
gerador, Cv de `V_STEAM_IN_INT`, Cv de `V_VAC`, Cv de `V_EXHAUST`.

**Controller** (live): band low (default 0.1 °C), band high (default 0.5 °C).

**Time** (live): `ticks_per_wall` (×, default 2).

## Fora de escopo (YAGNI — add-when)

- Editar o array `load` pela UI (materiais/massas) — fica no YAML de cenário. Add quando for preciso variar carga sem editar ficheiro.
- Knobs de parede/jaqueta menos usados (`wall_h`, `jacket_chamber_h`, thermostat da jaqueta) — 1 entrada no registry quando precisar.
- Persistência versionada/perfis de calibração nomeados — 1 ficheiro override chega.
- Live-edit de cycle-config a meio do ciclo — decidido contra (PLC já capturou o setpoint).

## Testes

- **Registry:** cada descritor `get∘set` é round-trip (set(v) → get === v) para plant/controller/time; `set` respeita a conversão de unidade (relief bar↔Pa).
- **API:** POST fora de `[min,max]` → 400; POST a knob `precycle` com ciclo a correr → 409; POST válido persiste no ficheiro; reset limpa.
- **Live plant:** mutar `h_ambient` via `set` altera o próximo `system_step` (asserir que o estado diverge de baseline).
- **Cycle override:** `startCycle` com `cycleOverride` não-vazio usa o valor sobreposto, não o do YAML.
- **Time-scale:** scheduler lê `timeScale` mutável (mudar mid-run altera ticks/firing).

## Ficheiros tocados

- Novo: `server/knobs/registry.ts`, `server/knobs/store.ts`, `app/api/knobs/route.ts`,
  `app/api/knobs/reset/route.ts`, `app/knobs/page.tsx`, `components/knobs/KnobPanel.tsx`, `lib/knobs-api.ts`.
- Editado: `server/runtime/singleton.ts` (campos + boot load/apply), `server/runtime/scheduler.ts`
  (`timeScale` mutável), `server/virtual-plc/plc.ts` (bang-bang recebe offsets), `.gitignore`
  (`knobs.override.json`), nav do `app/layout.tsx`.
