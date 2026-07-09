# Câmara bifásica (vapor saturado) — design

**Data:** 2026-07-05
**Estado:** aprovado (brainstorm), pronto p/ plano
**Bloqueador que fecha:** `packages/physics/docs/modelo-secagem-vacuo.md` §8b + §8b.1
**Sub-projeto:** câmara como sistema bifásico próprio, gás pinned a `T_sat(P)`.

## Problema

Estado atual (N-nós + come-up wetting): o testemunho molha no come-up (~0.38 kg
condensado) mas **a queda na secagem não aparece** — o testemunho sobe 135→138 em vez
de arrefecer no flash.

Causa medida (trace): o **gás da câmara superaquece** — no HOLD/PRESSURIZE está **+24 °C
acima de `T_sat`** (subia 137→158 °C a P constante 3.04 bar). Vapor saturado é
impossível superaquecer a P fixa. Dois mecanismos degenerados:

1. **Condução jaqueta→câmara** (`jacket_chamber_h_W_per_K`) somada ao `Q_external` do
   **gás** — devia aquecer a **parede** (`integrator.ts:262`).
2. **T do gás livre** — sem pin de saturação. Com `m_liq=0` em vácuo, a massa de gás é
   quase-nula, a heat capacity ~0 e T bate no teto `T_MAX` (220 °C). Latente de
   condensação depositado no gás minúsculo (`chamber.ts:213-215`, floor 500 J/K) dispara T.

Enquanto o gás está a ~217 °C e ainda há densidade no início do DRY, aquece o testemunho
por convecção (~660 W) mais do que o flash arrefece → sem queda.

Protótipo provado e revertido (§8b.1): rotear condução→parede + pin gás a `T_sat(p_vap)`
→ **gás saturado, dT ≈ 0** o ciclo todo. Reverteu porque o landing limpo exige flash
bidirecional estável + retuning de pressão + migração de testes. Este spec faz isso.

## Objetivo / aceitação

Ciclo `ster-134-prevac` completo corre **verde** e o trace mostra:

- Gás da câmara **saturado**: `|T_gas − T_sat(p_vap)| ≈ 0` no HOLD (era +24 °C).
- **Queda na secagem visível**: o testemunho arrefece no DRY quando a sua água
  (~0.38 kg) faz flash, em vez de subir.
- F0 acumulado no nó testemunho, monótono.

## Aprovações do brainstorm

- **Modelo bifásico:** solver de **equilíbrio** (não rate-based).
- **Pressão STER:** subir alívio da câmara p/ **~3.2 bar** (config, física intacta).
- **Escopo:** **end-to-end** — núcleo + roteamento + pressão + migração de testes.

## Desenho

### 1. Núcleo — partição de equilíbrio (`chamber.ts`, só `allowLiquid=true`)

Substitui **ambos** os mecanismos rate-based (o bloco `k_evap` de evaporação, §3.5, e o
loop iterativo de condensação, §4) por **uma partição de equilíbrio por passo**.

Depois do balanço de massa (in/out) e da atualização de energia sensível:

- **Regime bifásico** — água presente nas 2 fases, OU vapor supersaturado
  (`m_vap > m_vap_sat`), OU líquido presente sub-saturado: o gás é **pinned** a
  `T = T_sat(p_vap)`. Calcula `m_vap_sat(T) = p_sat(T)·V / (R_VAP·T)` e resolve
  `(T, m_vap, m_liq)` por **bisecção limitada** em `[T_MIN_K, T_MAX_K]` tal que `T = T_sat`
  e a energia total é conservada. O **excedente/défice de latente** (a energia que
  empurraria T para fora da saturação) é **trocado com a parede** (50 kg·500 = 25 000 J/K,
  estável), não com o gás quase-nulo. Sem constantes de taxa → sem spikes de vácuo.
- **Bidirecional emerge do equilíbrio:** bomba puxa vapor → sub-satura → líquido faz flash
  → arrefece a `T_sat` (latente vem da parede/gás). Carga injeta vapor → supersatura →
  condensa → latente para a parede.
- **Fallback monofásico:** se só vapor com `m_vap ≤ m_vap_sat` (ou vácuo sem água
  relevante), o gás evolui por energia sensível como hoje — vapor/ar superaquecido é um
  estado físico real; o pin só existe enquanto duas fases coexistem.
- **Degenerado `m_liq=0` coberto:** `m_vap > m_vap_sat` → condensa excesso → torna-se
  bifásico → pin (fim do teto 217 °C). `m_vap ≤ m_vap_sat` → monofásico honesto.

Jacket (`allowLiquid=false`) **intacto** — já deposita o latente de condensação na parede
(`chamber.ts:191-208`); não é a fonte do bug.

### 2. Roteamento da condução (`chamber.ts` + `integrator.ts`)

- `ChamberFluxes` ganha `Q_wall_external?: number` (W, positivo = para a parede).
- `chamber_step` soma `Q_wall_external·dt` à energia da parede, a par do latente já
  depositado lá.
- `integrator.ts:262` → chamber `Q_external = -Q_load` (só perde para a carga);
  `Q_wall_external = Q_jacket_to_chamber`. Corrige a causa (1).

### 3. Retuning de pressão (config, física intacta)

Vapor saturado precisa de `p_sat(134 °C) ≈ 3.09 bar` (Antoine do modelo) para o testemunho
atingir 134. Alívio da câmara sobe **3.04 → 3.2 bar** (margem acima de 3.09):

- `apps/web/server/runtime/singleton.ts` (`bar_to_Pa(3.04)` → `3.2`).
- `packages/physics/scenarios/ster-134-prevac.yaml` (`chamber_relief_bar: 3.04` → `3.2`,
  - comentário do header).

Fisicamente honesto: autoclaves reais correm ~3.1–3.2 bar para 134 °C.

### 4. Fluxo de dados

```
jaqueta ─(condução Q_wall_external)→ parede câmara ─(coupling implícito)→ gás pinned T_sat
   → (convecção) → carga (N-nós) → flash de água → vapor p/ câmara
   → partição de equilíbrio (condensa excesso→parede / alimenta evaporação)
bomba ─(outflow vapor)→ sub-satura câmara → líquido faz flash → arrefece a T_sat
```

### 5. Estabilidade / tratamento de erro

- Solve de T por **bisecção limitada** em `[T_MIN_K, T_MAX_K]` — sempre converge, sem
  overshoot.
- **Parede como buffer de latente** (25 000 J/K) — absorve/fornece o latente sem T-spike;
  substitui o `MIN_HEAT_CAP_JK` floor como mecanismo anti-spike no caminho bifásico.
- Clamps de `U`/`T` a `[T_MIN_K, T_MAX_K]` mantidos como guardas de último recurso.

## Testes

- **Unit** (`packages/physics/test/chamber.test.ts`):
  - pin segura em regime bifásico (`|T − T_sat| ≈ 0` após passo);
  - flash bidirecional conserva massa de água (`m_vap+m_liq`) e energia (dentro de tol);
  - degenerado `m_liq=0` com `m_vap>m_vap_sat` → condensa, T ≤ T_sat, sem teto 220.
- **Migrar** (~3-4): wall-coupling (latente/condução → parede); drying-liquid (remoção de
  líquido da câmara); hardness/F0 na secagem.
- **Integração** (`ster-134`): verde; `|T_gas − T_sat|` pequeno no HOLD; testemunho **cai**
  no DRY; F0 no testemunho.

## Ficheiros

| Ficheiro                                          | Mudança                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/physics/src/chamber.ts`                 | solver de equilíbrio (substitui §3.5+§4 no caminho `allowLiquid`); `Q_wall_external` |
| `packages/physics/src/integrator.ts`              | linha 262: `Q_external`/`Q_wall_external`                                            |
| `apps/web/server/runtime/singleton.ts`            | relief 3.04 → 3.2 bar                                                                |
| `packages/physics/scenarios/ster-134-prevac.yaml` | relief 3.04 → 3.2 bar                                                                |
| `packages/physics/test/chamber.test.ts`           | unit bifásico                                                                        |
| migração ~3 testes                                | wall-coupling / drying-liquid / hardness-F0                                          |

## Fora de escopo

- Refactor do jacket (funciona).
- Config de pressão no web UI (SP posterior).
- Achados abertos do physics-model-reviewer (generator double-count, cap outflow) — TODO.md.
