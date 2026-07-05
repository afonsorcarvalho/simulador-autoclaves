# TODO

## Em curso

- SP-cal (calibração da secagem) — **próximo: superaquecimento do gás da câmara**. ✅ Feito: come-up wetting resolvido (calor em vapor saturado vem por condensação → testemunho acumula ~0.38 kg; commit fa56b0f) + orçamento partilhado de vapor multi-nó + pinning de saturação (segura 134 °C molhado). ⚠️ Bloqueio da queda na secagem: o gás da câmara superaquece a ~217 °C (artefacto do modelo vapor-só, era out-of-scope §7 do spec) e, enquanto há densidade no início do DRY, aquece o testemunho por convecção → sobe a ~138 em vez de cair; só arrefece quando P→0. Próximo: limitar T_gás da câmara à saturação enquanto há duas fases / ou termo de arrefecimento por expansão (`chamber.ts`). Coluna `m_water_load` no trace p/ diagnóstico. Sem hardware → validar por plausibilidade.

## Pendente

- Física — investigar achados do physics-model-reviewer (2026-07-03):
  - `generator.ts:57-68` — double-count de energia: `dm_vap = Q_in/h_vap` gasta todo Q_in em latente mas T também sobe pela curva sat → calor sensível nunca debitado (não-conservativo, só limitado pela válvula de alívio). Corrigir: dividir Q_in entre latente + sensível.
  - Cap de outflow `chamber.ts:89-91` / `integrator.ts:211-212` aplicado no lado errado → massa fantasma se ligar válvula chamber↔jacket. Topologia atual não dispara. Aplicar cap ao flux partilhado antes do split source/dest.
  - Menor: constantes Antoine inline em `chamber.ts` (usar `p_sat_water`); `k_evap=1e-7` magic → `constants.ts`; F0 dispara no drying (falta via de arrefecimento load/jacket).
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

- 2026-07-05 — Modelo de carga N-nós + secagem a vácuo (packages/physics: `materials.ts` registry, `load.ts` N-nós c/ condensação/flash/radiação/convecção∝ρ, integração + conservação água carga↔câmara + F0 no nó testemunho, config `load` no YAML de ciclo, pinning de saturação bifásico. Bug P–T da câmara corrigido: testemunho descola. 91 testes physics + 71 web. Docs: teoria + spec + plano em docs/superpowers/. Falta calibrar come-up wetting → SP-cal em curso)
- 2026-07-05 — Live dashboard: gráfico do ciclo inteiro (eixo HH:MM:SS) + backlog SSE server-side (sobrevive a navegação/reload) + auto-stop do ciclo em COMPLETE
- 2026-05-26 — Sub-projeto 4 — Dashboard MVP (apps/web: Tailwind + Next.js App Router, snapshot publisher + singleton runtime + real-time scheduler, SSE stream, useSnapshot hook, live page c/ Recharts pressure/temperature/F0/valves, virtual PLC manual valve panel, home cycle start/stop)
- 2026-05-26 — Sub-projeto 3 — Orchestrator + virtual bridge + scenario runner (apps/web: ModbusBridge interface, VirtualEsp32Bridge in-memory, RegisterAccess typed wrapper, Orchestrator tick loop, VirtualPLC state machine + valve commander, scenario runner driving closed-loop 134°C cycle to F0 ≥ 100 entirely virtual. 47 vitest tests)
- 2026-05-25 — Sub-projeto 2.5 — Physics hardening + jacket bang-bang + condensation latent heat fix
- 2026-05-24 — Sub-projeto 2 — Modelo físico standalone (packages/physics: saturação Antoine, choked flow, chamber+jacket c/ evaporação+condensação+saturação, generator pressure-vessel boiling, load 2-mass c/ testemunho, F0, integrador, CLI scenario YAML+CSV. Cenários 121°C gravidade + 134°C prevac + drying verdes. 57 vitest tests)
- 2026-05-23 — Sub-projeto 1 — Foundation (monorepo pnpm+turbo, packages/protocol gerando TS+C++ de registers.yaml com testes e drift-check em CI)
