# Referência de entalpia comum (u_fg0) — design

**Data:** 2026-07-05
**Estado:** aprovado (brainstorm), pronto p/ plano
**Sub-projeto:** SP-A (fundacional). Pré-requisito do SP-B (câmara bifásica / pin vapor-dominated).
**Origem:** achado do physics-model-reviewer durante a validação end-to-end do pin da câmara
(ver `docs/superpowers/specs/2026-07-05-chamber-two-phase-design.md` §Q5 do review).

## Problema

Os volumes de controlo (câmara, jaqueta, gerador, carga) usam energia interna **só sensível**
(`U = m·cv·T`, sem offset de latente). O calor latente entra como **transferências de calor
explícitas** nos pontos de mudança de fase (deposição na parede, bumps de T, `Q_cond = dep·hv`).

Isto **cria energia** quando o vapor muda de fase ou atravessa fronteiras entre CVs, porque os
dois lados usam referências inconsistentes:

1. **Fronteira câmara↔carga (o gap medido):** quando um nó da carga condensa `dep` kg
   (`load.ts:79`), credita ao nó `Q_cond = dep·h_vap ≈ 2.2 MJ/kg`. O mesmo vapor é retirado da
   câmara como `vap_out` (`integrator.ts:235-237`), mas `chamber_step` debita à câmara apenas o
   sensível `dm·CP_VAP·T ≈ 0.8 MJ/kg` (`H_out`). **Cria-se ~1.4 MJ/kg** por kg condensado.
2. **Interno à câmara (double-benefit):** ao condensar vapor→líquido, o latente `dm·hv` é
   depositado na parede E a água passa a contribuir `CP_LIQ·T` (líquido) em vez de `CV_VAP·T`
   (vapor) na `U` do passo seguinte — `CP_LIQ ≫ CV_VAP`, energia sensível espúria.

Hoje o gap está **dormente** (a carga superaquece em vez de condensar, o pin não dispara). Mas o
SP-B (pin vapor-dominated) **liga** o caminho de condensação (~0.5 MJ no come-up) → enviesa o
testemunho quente → **F0 deixa de ser de confiança**. Por isso a energia tem de ser reconciliada
**antes** do pin.

## Objetivo / aceitação

- **Teste de conservação global** (novo) verde: sub-sistema fechado (sem válvulas) conserva a
  energia total a ~1e-6 relativo ao longo de muitos passos; variante com fluxo conhecido
  (aquecedor N s) fecha `ΔΣ = entrada` dentro de tolerância.
- **Suite completa verde** após migração das asserções de temperatura afetadas.
- **Sem comportamento qualitativo partido** (jaqueta condensa→parede aquece; carga molha no
  come-up; F0 no testemunho).
- SP-A **não** toca no gate do pin nem adiciona o comportamento vapor-dominated (isso é o SP-B).

## Aprovações do brainstorm

- **Reconciliação:** referência de entalpia comum com offset `u_fg0` (não patches locais).
- **Estrutura:** dois sub-projetos, **energia primeiro** (SP-A), depois pin (SP-B).

## Desenho

### 1. Referência + energias específicas

Referência única: **água líquida, u=0 a `T_ref = 273.15 K`**. Energia interna específica por
espécie:

- ar: `u_air = CV_AIR · T`
- líquido: `u_liq = CP_LIQ · T`
- vapor: `u_vap = CV_VAP · T + u_fg0`   ← latente vive na energia

`u_fg0` é um **offset constante** de latente. O latente efetivo de condensação a T é
`u_vap − u_liq = u_fg0 − (CP_LIQ − CV_VAP)·T` — **decresce com T automaticamente**, seguindo a
tendência física de `h_fg(T)`. Escolher `u_fg0` para casar `h_vap_water` numa referência média
(~121 °C). O transporte carrega o mesmo offset (`h_fg0`); a diferença cp/cv já contém o trabalho
de escoamento (`cp − cv = R`).

### 2. Consequência: mudança de fase passa a ser mass-only

Mover `dm` vapor↔líquido move `u_fg0` na `U` automaticamente; **T resolve-se da `U` total**
(incluindo latente) por **bisecção** em `[T_MIN_K, T_MAX_K]` com
`m_vap = min(m_água, m_vap_sat(T))`. Condensação/evaporação **caem do split de massa** — sem
deposições de latente explícitas. Remove:

- os bumps de T por latente (`T += Q_lat/denom`),
- o floor `MIN_HEAT_CAP_JK` (existia para mascarar spikes de latente em gás quase-nulo),
- os hacks de depositar latente na parede (branches a/b do bloco de equilíbrio atual).

A parede continua puramente **sensível** (coupling gás↔parede inalterado).

### 3. Mudanças por CV

- **`chamber.ts` (`chamber_step`):** `U` ganha `m_vap·u_fg0`; `H_in`/`H_out` do vapor ganham
  `dm_vap·h_fg0`. Bloco de fase reescrito para o solve de equilíbrio mass-only (bisecção). Caminho
  jaqueta (`allowLiquid=false`): mesmo esquema; condensado sai (dripa) levando `u_liq`.
- **`load.ts`:** condensação retira `dep` kg do vapor da câmara; esse vapor sai da câmara com
  `CP_VAP·T + h_fg0`. O nó da carga credita o latente correspondente com a **mesma constante** →
  o gap de ~1.4 MJ/kg fecha estruturalmente. Flash (`dWater<0`) simétrico.
- **`generator.ts`:** modelo interno **inalterado** (já é consistente na curva de saturação). Só o
  **outflow** de vapor p/ câmara/jaqueta é etiquetado com a referência comum (`inflow_T` +
  latente), para o CV recetor contabilizar coerentemente.
- **Válvulas/exhaust:** vapor p/ vácuo/atmosfera leva o latente para fora do sistema (correto).
- **`constants.ts`:** adicionar `U_FG0` / `H_FG0`, derivados de `h_vap_water` na referência,
  documentados com o estado de referência.

### 4. Fluxo de dados (energia)

```
aquecedor → gerador → (vapor+latente) → U câmara/jaqueta → split de fase resolve T
   → (vapor+latente) → condensação na carga / alívio / exhaust
```

Cada seta transporta o latente **com** a massa. Nenhuma transferência de latente "solta".

## Testes

- **Conservação global (keystone, novo):** sub-sistema fechado (sem válvulas, aquecedor off)
  conserva `Σ = Σ U_CV(com u_fg0) + Σ E_parede + Σ E_nós` a ~1e-6 relativo em N passos. Variante:
  aquecedor on M s → `ΔΣ = P_aquecedor·M·dt` dentro de tolerância.
- **Migração unitária:** asserções de temperatura em chamber/generator/load/integrator que
  dependem da energia mudam. Triagem por falha: (a) número corrigido → migrar expectativa com
  razão física de 1 linha; (b) regressão real → corrigir código. Reportar o split.
- **F0:** re-derivar do modelo corrigido (o F0 antigo estava inflado pela energia criada); não
  copiar o valor antigo. Manter referência no nó testemunho.
- **Guarda comportamental:** jaqueta condensa→parede aquece; carga molha no come-up — continuam
  qualitativamente.

## Ficheiros

| Ficheiro | Mudança |
|---|---|
| `packages/physics/src/constants.ts` | `U_FG0` / `H_FG0` + referência documentada |
| `packages/physics/src/chamber.ts` | `U`/transporte com latente; bloco de fase mass-only (bisecção); remover deposições de latente + floor |
| `packages/physics/src/load.ts` | condensação/flash na referência comum |
| `packages/physics/src/integrator.ts` | transporte de vapor entre CVs com latente; outflow do gerador etiquetado |
| `packages/physics/src/generator.ts` | outflow de vapor na referência comum (interno inalterado) |
| teste de conservação global (novo) | keystone |
| migração de ~vários testes | expectativas de T corrigidas |

## Fora de escopo

- Gate do pin / comportamento vapor-dominated / 4 guards → **SP-B** (`câmara bifásica v2`).
- Caminho de perda da parede (se `T_wall` saturar no teto) → observar; tratar em SP-B se surgir.
- Achados abertos do reviewer não relacionados (generator double-count histórico, cap outflow) →
  TODO.md.

## Notas de dependência

O ramo `feat/chamber-two-phase` já tem infra válida (SP anterior): `Q_wall_external` +
roteamento da condução p/ parede + alívio 3.2 bar. SP-A reescreve o bloco de fase do
`chamber_step` (superseede o pin gated-em-`m_liq` do Task 2 anterior). SP-B reconstrói o pin
vapor-dominated sobre a base corrigida.
