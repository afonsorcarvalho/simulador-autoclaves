# TODO

## Em curso

- **SP-B — pin vapor-dominated da câmara** (câmara bifásica v2). Ramo `feat/chamber-two-phase`, sobre
  a base de energia correta do SP-A. Objetivo: gás da câmara travado a `T_sat(P)` quando **dominado por
  vapor** (não só com líquido presente — foi o defeito do 1º desenho: gated em `m_liq>0`, nunca disparava
  no ciclo real → gás superaquecia +16 °C, sem queda na secagem, F0=10305). Requer os **4 guards** do
  parecer do `physics-model-reviewer` (§11 do doc + spec `2026-07-05-chamber-two-phase-design.md` §Q5):
  (1) só travar quando `T > T_sat(p_vap)`; (2) limiar de ar por **pressão parcial** `p_air < ~5% p_total`
  (não razão de massa); (3) floor de `p_vap` (~1e4 Pa) p/ não reportar T absurda em vácuo profundo;
  (4) bisecção do ponto fixo (não one-shot). Aceitação: gás saturado no HOLD (dT≈0), queda na secagem
  visível, F0 de confiança (energia agora conserva). Fazer brainstorm→spec→plano próprio. Retomar o
  alívio 3.2 bar (já committed) + migração de ~4 testes de comportamento (drying speed, wall-coupling).

## Pendente

- Física — investigar achados do physics-model-reviewer (2026-07-03):
  - `generator.ts:57-68` — double-count de energia: `dm_vap = Q_in/h_vap` gasta todo Q_in em latente mas T também sobe pela curva sat → calor sensível nunca debitado (não-conservativo, só limitado pela válvula de alívio). Corrigir: dividir Q_in entre latente + sensível.
  - Cap de outflow `chamber.ts:89-91` / `integrator.ts:211-212` aplicado no lado errado → massa fantasma se ligar válvula chamber↔jacket. Topologia atual não dispara. Aplicar cap ao flux partilhado antes do split source/dest.
  - Menor: constantes Antoine inline em `chamber.ts` (usar `p_sat_water`); `k_evap=1e-7` magic → `constants.ts`; F0 dispara no drying (falta via de arrefecimento load/jacket). _(Nota SP-A: `chamber.ts` já usa `p_sat_water` e o `k_evap` foi removido pela bisecção mass-only.)_
  - Menor (SP-A, 2026-07-06): `chamber.ts:105` zera líquido a entrar na jaqueta mas `H_in` ainda conta `dm_liq_in·CP_LIQ·T` → fuga se alguma vez entrar líquido na jaqueta. Não dispara hoje (jaqueta é alimentada a vapor). Guardar/asserir se algum cenário injetar líquido na jaqueta.
- Protocolo — SP5-prep, resolver antes de escrever firmware (protocol-consistency-reviewer, 2026-07-03):
  - `emit-cpp.ts:21-30` — header C++ não emite `type` → C++ não distingue uint16/int16. `F0_X10` (uint16, chega a 50000) lido como signed = erro >32767. Emitir `type` no `dist/registers.h`.
  - Escalas hardcoded em código consumidor em vez do register: `F0_X10` ×10 (`sensor-publisher.ts:36` / `plc.ts:73`), `SIM_TIME_SCALE` ×100. Mover escala p/ definição do register (single source of truth) — senão TS e firmware driftam.
  - Parser (`parser.ts`/`schema.ts`) não valida `range×scale` cabe em int16 → overflow silencioso (clip em `register-access.ts:69`). Adicionar bound-check na cross-validation.
  - Sentinelas PT100 (-32768=OPEN / 32767=SHORT) documentadas só em `P_CHAMBER_INT`/`T_CHAMBER_INT`; faltam nos outros canais incl. `T_TESTEMUNHO` (crítico F0). Clarificar/documentar.
  - Menor: tick 32-bit (`MODEL_TICK_LOW/HIGH`) sem marcador word-order — fixar "LOW = endereço menor" em comentário antes de recombinar.
- Sub-projeto 5 — Firmware ESP32 + Modbus slave (I/O + watchdog + fast model)
- Sub-projeto 6 — Injeção de falhas (hooks orchestrator + UI faults + cenários)
- Sub-projeto 7 — Placa condicionamento KiCad (schematic + PCB + BOM)
- Sub-projeto 8 — PLC-in-loop aceitação (PLC real, ajustes finais, QA arquivada)
- Sub-projeto 9 — Mímico SVG + cycles history + replay

## Feito

- 2026-07-06 — **SP-A — Referência de entalpia comum (`u_fg0`)** (ramo `feat/chamber-two-phase`).
  Fundacional: o latente da água passa a viajar com a massa de vapor em todos os CVs. `U_FG0` +
  `energy.ts` (`vaporU`/`L_eff`); câmara+jaqueta resolvem T da energia total (latente incluído) por
  bisecção mass-only (removidos pin gated-em-`m_liq`, floor `MIN_HEAT_CAP`, clamps `U_floor/ceil`,
  depósitos de latente na parede); condensação carga↔câmara em `L_eff` + compensação de flow-work
  `Q_comp_load`; jaqueta = bisecção partilhada + drip; gerador emite massa, latente aplicado 1× pelo
  recetor. Fecha o gap de **~1.4 MJ/kg** que o `physics-model-reviewer` achou. Keystone
  `energy-conservation.test.ts`: sistema fechado conserva sob condensação real, guarda por-kg
  <200 kJ/kg, **verificado a falhar sob 3 regressões injetadas**. Conservação por-CV a ~precisão de
  máquina. 106 physics / 71 web verde, gate CI verde. Também landed a infra do pin (Q_wall_external,
  condução→parede, alívio 3.2 bar). Spec+plano em docs/superpowers/. Detalhe §11 do doc de secagem.
  Próximo: SP-B (pin vapor-dominated) sobre esta base.
- 2026-07-05 — Modelo de carga N-nós + secagem a vácuo (packages/physics: `materials.ts` registry, `load.ts` N-nós c/ condensação/flash/radiação/convecção∝ρ, integração + conservação água carga↔câmara + F0 no nó testemunho, config `load` no YAML de ciclo, pinning de saturação bifásico. Bug P–T da câmara corrigido: testemunho descola. 91 testes physics + 71 web. Docs: teoria + spec + plano em docs/superpowers/. Falta calibrar come-up wetting → SP-cal em curso)
- 2026-07-05 — Live dashboard: gráfico do ciclo inteiro (eixo HH:MM:SS) + backlog SSE server-side (sobrevive a navegação/reload) + auto-stop do ciclo em COMPLETE
- 2026-05-26 — Sub-projeto 4 — Dashboard MVP (apps/web: Tailwind + Next.js App Router, snapshot publisher + singleton runtime + real-time scheduler, SSE stream, useSnapshot hook, live page c/ Recharts pressure/temperature/F0/valves, virtual PLC manual valve panel, home cycle start/stop)
- 2026-05-26 — Sub-projeto 3 — Orchestrator + virtual bridge + scenario runner (apps/web: ModbusBridge interface, VirtualEsp32Bridge in-memory, RegisterAccess typed wrapper, Orchestrator tick loop, VirtualPLC state machine + valve commander, scenario runner driving closed-loop 134°C cycle to F0 ≥ 100 entirely virtual. 47 vitest tests)
- 2026-05-25 — Sub-projeto 2.5 — Physics hardening + jacket bang-bang + condensation latent heat fix
- 2026-05-24 — Sub-projeto 2 — Modelo físico standalone (packages/physics: saturação Antoine, choked flow, chamber+jacket c/ evaporação+condensação+saturação, generator pressure-vessel boiling, load 2-mass c/ testemunho, F0, integrador, CLI scenario YAML+CSV. Cenários 121°C gravidade + 134°C prevac + drying verdes. 57 vitest tests)
- 2026-05-23 — Sub-projeto 1 — Foundation (monorepo pnpm+turbo, packages/protocol gerando TS+C++ de registers.yaml com testes e drift-check em CI)
