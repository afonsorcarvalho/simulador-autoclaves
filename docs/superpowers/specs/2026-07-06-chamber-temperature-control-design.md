# Controlo de temperatura da câmara (bang-bang) — design

**Data:** 2026-07-06
**Estado:** aprovado (brainstorm), pronto p/ plano
**Sub-projeto:** SP-B. Constrói sobre o SP-A (referência de entalpia comum, já em master).
**Supersede:** a direção "pin vapor-dominated" do `2026-07-05-chamber-two-phase-design.md` §Q5 — o
desenho correto (dado pelo conhecimento do utilizador da máquina real) é um **laço de controlo**, não
um pin na física.

## Problema

No dashboard (só SP-A), o gás da câmara sobe a ~145 °C no HOLD — **>+10 °C acima do setpoint 134**.
As normas (EN 285) exigem que os pontos medidos na câmara fiquem na banda **0 a +3 °C** do setpoint no
plateau. Causa medida: durante PRESSURIZE/HOLD a válvula de vapor da câmara (`V_STEAM_IN_INT`) é mantida
**sempre aberta** (`plc.ts:88-90`) e alimentada com vapor do gerador a **148 °C / 4.5 bar** — inunda a
câmara com vapor superaquecido → o gás fica a ~148. **Não é falta de física; é falta de controlador.**

Fisicamente (lei do utilizador, correta): vapor saturado tem `T = T_sat(P)`. Na máquina real a câmara é
regulada por um **bang-bang de temperatura na válvula de vapor da câmara**: setpoint 134,0 — abre quando
`T < 134,1`, fecha quando `T > 134,5` (histerese). Fecha a válvula → câmara arrefece abaixo de 134,1 →
reabre. Oscila apertado → dentro da banda. O modelo não tem este laço.

## Objetivo / aceitação (EN 285)

- **Banda:** T da câmara ∈ **[SP, SP+3] °C** durante todo o HOLD (era +10). Idealmente [SP+0.1, SP+0.5].
- **F0** acumula no nó testemunho, monótono, valor de confiança (energia já conserva pelo SP-A).
- **Queda na secagem visível:** com a câmara saturada a 134, a carga molha no come-up (condensação) →
  faz flash no DRY → testemunho cai.
- Ciclo `ster-134-prevac` verde; dashboard mostra a câmara na banda.

## Aprovações do brainstorm

- **Mecanismo:** bang-bang de temperatura na válvula da câmara (não pin na física; sem tocar em
  `chamber.ts`).
- **Topologia:** `V_STEAM_IN_INT` passa a ser alimentada **do jacket** (não do gerador a 148 °C) — a
  fonte nunca é mais quente que o jacket, reduz o overshoot.

## Desenho

### 1. Lei de controlo (bang-bang com histerese)

Estado da válvula da câmara regulado pela temperatura da câmara:

```
open  quando  T_chamber < SP + open_offset   (default +0.1 °C)
close quando  T_chamber > SP + close_offset  (default +0.5 °C)
manter estado anterior na banda [SP+0.1, SP+0.5]  (histerese)
```

`SP` = setpoint de esterilização do ciclo (134 °C para ster-134). Só ativo em **PRESSURIZE + HOLD**
(nas outras fases a válvula segue a lógica de fase atual). Análogo ao bang-bang de pressão do jacket já
existente (`jacket_setpoint_bar` / `jacket_deadband_bar`).

### 2. Componentes

- **Virtual PLC** (`apps/web/server/virtual-plc/plc.ts`): em `commandsFor(PRESSURIZE|HOLD)`, em vez de
  `V_STEAM_IN_INT: true` fixo, calcular o estado pela histerese lendo o sensor de temperatura da câmara
  (`T_CHAMBER_INT`). Guardar o estado anterior da válvula p/ a histerese (o PLC já tem estado por
  passo). Este é o caminho que alimenta o **dashboard**.
- **Scenario CLI** (`packages/physics/src/cli.ts`): o mesmo bang-bang p/ corridas standalone, config do
  YAML (`chamber_setpoint_C`, `chamber_deadband_C` com defaults). Espelha o bang-bang de pressão do
  jacket que o CLI já aplica.
- **Topologia** (`apps/web/server/runtime/singleton.ts` + cenário): `V_STEAM_IN_INT` `from: 'jacket'`
  (era `'generator'`). O jacket passa a ser o buffer/fonte da câmara; verificar Cv suficiente p/ a
  câmara repressurizar nos pulsos e no HOLD. O gerador continua a alimentar o jacket.
- **Calibração da física** (risco técnico, ver abaixo): garantir que, com a válvula fechada, o gás da
  câmara **arrefece** de volta a SP+0.1. Se o acoplamento parede↔gás (`wall_h_W_per_K`) ou a condução
  jacket→parede (`jacket_chamber_h_W_per_K`) segurarem o gás acima de SP+0.5 (parede a ~138 aquece o
  gás), afinar esses coeficientes. É um knob de calibração, não reescrita.

### 3. Sensor de controlo

O bang-bang lê a **temperatura do gás da câmara** (`T_CHAMBER_INT`), não o testemunho. (O testemunho é a
referência do F0; a temperatura da câmara é o que a válvula regula, como na máquina real.) Confirmar que
o registo `T_CHAMBER_INT` já publica `chamber.T`.

### 4. Fluxo de dados

```
física (chamber.T) → sensor T_CHAMBER_INT → PLC/CLI bang-bang (histerese) → V_STEAM_IN_INT → física
                                                                    (fonte = jacket, ~138 °C)
```

### 5. Risco técnico principal (a resolver na implementação)

A parede da câmara é aquecida pelo jacket (~138 °C) e acoplada ao gás. Se esse acoplamento for forte
demais, ao fechar a válvula o gás **não arrefece** (a parede segura-o a ~138) → a válvula nunca reabre e
o gás fica a +4 °C (fora da banda). Câmaras reais perdem calor p/ a carga/porta/alívio mais depressa do
que a parede reaquece. **Mitigação:** calibrar `wall_h_W_per_K` / `jacket_chamber_h_W_per_K` para que o
gás possa arrefecer quando a válvula fecha. Medir no trace: com a válvula fechada, `dT_chamber/dt < 0`.
Se não der só com calibração, reconsiderar (fallback: reduzir a condução jacket→gás, ou aceitar que o
tecto real é `T_sat(P_câmara)` e reintroduzir o pin como rede de segurança — mas tentar controlo puro
primeiro).

## Testes

- **Unit** (bang-bang): abre em `T<SP+0.1`, fecha em `T>SP+0.5`, mantém na banda (histerese). No PLC e
  no CLI.
- **Integração** (`ster-134`): T da câmara ∈ [SP, SP+3] em todo o HOLD; a válvula da câmara **cicla**
  (abre/fecha, não fica sempre aberta); F0 no testemunho monótono; queda na secagem visível
  (`m_water_load` da carga sobe no come-up e vai a ~0 no DRY, testemunho cai).
- **Dashboard** (playwright): correr ster-134 até ao HOLD, screenshot mostra a câmara na banda.

## Ficheiros

| Ficheiro                                          | Mudança                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `apps/web/server/virtual-plc/plc.ts`              | bang-bang de T da câmara em PRESSURIZE/HOLD (lê `T_CHAMBER_INT`, histerese)   |
| `packages/physics/src/cli.ts`                     | mesmo bang-bang p/ cenários standalone, config YAML                           |
| `apps/web/server/runtime/singleton.ts`            | `V_STEAM_IN_INT` `from: 'jacket'` + Cv                                        |
| `packages/physics/scenarios/ster-134-prevac.yaml` | `chamber_setpoint_C` / `chamber_deadband_C`; topologia do vapor da câmara     |
| física (calibração)                               | `wall_h_W_per_K` / `jacket_chamber_h_W_per_K` afinados se o gás não arrefecer |
| testes                                            | unit bang-bang + integração banda EN 285 + dashboard                          |

## Fora de escopo

- **Pin vapor-dominated na física** (a direção anterior) — abandonada; o controlo bang-bang é o
  mecanismo real e mais simples. Se a calibração não segurar a banda, reconsiderar como fallback.
- Achados abertos do physics-model-reviewer (generator double-count, cap outflow) → TODO.md.
- Config do bang-bang no web UI → SP posterior.
