# Animação da porta guilhotina — design

Data: 2026-10-01 · Branch: `feat/delta-plc-bridge`

## Objetivo

Mostrar no `/live` a porta guilhotina (tipo 3: pistão pneumático, guarnição ar/vácuo,
fins de curso, antiesmagamento) dos lados C e D, controlada pelas saídas do CLP, e
permitir injetar falhas para testar a lógica `fb_porta_auto` / `fb_guarnicao`.

## Modelo (bridge `apps/web/server/bridge/delta-plc.ts`)

Por lado (C/D):

- `pos` 0–1 (0 = fechada). Velocidade = `DOOR_SPEED_PER_S × fator` (fator 1, ou 0,5
  com falha `pistao_lento`).
- Guarnição, estado derivado das saídas:
  - `recolhida`: AR e VAC desligados
  - `vacuo`: `OUT_GUARN_VAC_*` ligado
  - `pressurizando`: `OUT_GUARN_AR_*` ligado há menos de `SEAL_PRESSURIZE_S`
  - `selada`: AR ligado há ≥ `SEAL_PRESSURIZE_S`
  - Falha `vazamento`: nunca passa de `pressurizando`; `IN_PRESS_GUARN_*` = 0.
- Obstáculo (`obstaculo`: número 0–1 ou null): porta fechando não desce abaixo dele;
  `IN_ANTIESMAGA_*` = 1 enquanto `pos <= obstaculo + 0,01`.
- FC travado (`fc_aberta`, `fc_fechada`: `null | boolean`): quando não-null, força a
  entrada correspondente ao valor, ignorando a posição.

## Falhas

- Estado só em memória (some ao reiniciar o servidor).
- `POST /api/door-faults` com `{ side: 'C'|'D', faults: Partial<DoorFaults> }` faz merge.
- Snapshot ganha `doors: { C, D }`, cada um com
  `{ pos, seal, faults, fc_aberta, fc_fechada, antiesmaga, press_guarn }`.

## UI

`components/live/DoorView.tsx`, um bloco por lado, SVG:

- Frontal: trilhos, porta na altura `pos`, pistão em cima com haste proporcional,
  LEDs FC aberta/fechada, LED antiesmaga, obstáculo desenhado quando houver.
- Corte lateral: porta, guarnição contra o flange da câmara com cor por estado
  (cinza recolhida, azul vácuo, amarelo pressurizando, verde selada).
- Abaixo: controles de falha (obstáculo on/off + posição, FC aberta/fechada travado
  em 0/1/livre, vazamento, pistão lento).
- Transição CSS na posição para suavizar entre ticks.

Entra no grid do `/live` com `lg:col-span-2`.

## Testes

`apps/web/test/bridge/delta-plc.test.ts` (vitest):

- obstáculo para a porta e liga antiesmaga;
- vazamento nunca pressuriza;
- FC travado ignora posição;
- pistão lento dobra o tempo de curso;
- estados da guarnição seguem as saídas AR/VAC.

## Fora do escopo

- Mudar o tipo de porta de 1 para 3 no CLP (download feito pelo Afonso).
- Persistir falhas.
