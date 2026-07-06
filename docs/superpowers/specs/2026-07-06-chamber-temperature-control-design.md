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

## Objetivo / aceitação

- **[PLANTA — o essencial] Fidelidade:** com `V_STEAM_IN_INT` fechada no HOLD, `dT_chamber/dt < 0`
  (a câmara arrefece até reabrir). É isto que faz o bang-bang de QUALQUER controlador (virtual ou PLC
  real) funcionar. Sem isto, o SP-B falha, por mais bem afinado que esteja o controlador de referência.
- **[EN 285] Banda:** com o controlador de referência a atuar, T da câmara ∈ **[SP, SP+3] °C** durante
  todo o HOLD (era +10). Idealmente [SP+0.1, SP+0.5]. A válvula da câmara **cicla** (não fica sempre
  aberta).
- **F0** acumula no nó testemunho, monótono, valor de confiança (energia já conserva pelo SP-A).
- **Queda na secagem visível:** com a câmara saturada a 134, a carga molha no come-up (condensação) →
  faz flash no DRY → testemunho cai.
- Ciclo `ster-134-prevac` verde; dashboard mostra a câmara na banda.

## Aprovações do brainstorm

- **Mecanismo:** bang-bang de temperatura na válvula da câmara (não pin na física; sem tocar em
  `chamber.ts`).
- **Topologia:** `V_STEAM_IN_INT` passa a ser alimentada **do jacket** (não do gerador a 148 °C) — a
  fonte nunca é mais quente que o jacket, reduz o overshoot.

## Arquitetura (emulador HIL — planta vs controlador) — CRÍTICO

Este projeto é um **emulador Hardware-in-the-Loop de autoclave**. Objetivo final: o utilizador programa
um **PLC real** (externo, Modbus master), liga hardware que fala com o emulador, e desenvolve/testa o
software de controlo **sem uma autoclave física**. O register map já reflete isto:
`discrete_inputs` = "PLC outputs read by ESP32 (valve commands)"; `holding_registers` = sensores que o
emulador publica (PT100/4-20 mA) para o PLC ler.

Consequências que **governam este sub-projeto**:

1. **O emulador é a PLANTA** (física + publicar sensores + honrar atuadores via Modbus). **O controlo é
   externo** (o PLC real). Não cravar controlo na planta; manter a planta **agnóstica ao controlador**.
2. O **bang-bang é um controlador de REFERÊNCIA / auto-teste**, não a entrega. Vive no virtual PLC
   (`plc.ts`) e no scenario CLI (harness de teste), claramente separado e **substituível** — quando o
   PLC real conduzir via Modbus (SP5), o virtual PLC sai da frente. A entrega do SP-B **não** é "um bom
   controlador"; é a planta responder de forma fiel a QUALQUER controlador.
3. **Entrega principal = FIDELIDADE DA PLANTA.** O critério que faz ou quebra o SP-B: com
   `V_STEAM_IN_INT` **fechada** no HOLD, a câmara tem de **arrefecer** (`dT_chamber/dt < 0`) até poder
   reabrir. Se a planta não arrefecer (parede/jacket a segurar o gás quente), o bang-bang do PLC real
   **não funcionará** na autoclave emulada — e é o PLC real que interessa. Sensor `T_CHAMBER_INT`
   publicado (já existe) e atuador `V_STEAM_IN_INT` honrado venha de quem vier.
4. Sem novos sensores a expor (confirmado com o utilizador) — a banda EN 285 é verificada com o
   `T_CHAMBER_INT` existente.

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

- **[PLANTA] Fidelidade (o teste que define o SP-B):** cenário no HOLD com `V_STEAM_IN_INT` forçada
  fechada → asserir `dT_chamber/dt < 0` (câmara arrefece). Controlador-agnóstico: só exercita a planta.
  Se falhar, calibrar `wall_h`/`jacket_chamber_h` até passar.
- **Unit** (bang-bang, controlador de referência): abre em `T<SP+0.1`, fecha em `T>SP+0.5`, mantém na
  banda (histerese). No PLC e no CLI.
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
