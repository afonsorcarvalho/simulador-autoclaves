# TODO

## Em curso

- (nada — SP-B concluído; próximo grande bloco é SP5 firmware ESP32, ver Pendente)

## Pendente

- **SP-B follow-up (diferido):** alimentar a câmara **do jacket** (topologia real, tecto de fonte ≤
  jacket) — a jaqueta pequena não sustenta a procura do come-up (estagna em PRESSURIZE). A banda EN 285
  é mantida sem isso (controlador + perdas + alívio-tecto). Retomar com retuning do Cv de alimentação da
  jaqueta se se quiser a topologia fiel. Ramo `feat/chamber-temp-control`.

- Física — investigar achados do physics-model-reviewer (2026-07-03):
  - `generator.ts:57-68` — double-count de energia: `dm_vap = Q_in/h_vap` gasta todo Q_in em latente mas T também sobe pela curva sat → calor sensível nunca debitado (não-conservativo, só limitado pela válvula de alívio). Corrigir: dividir Q_in entre latente + sensível.
  - Cap de outflow `chamber.ts:89-91` / `integrator.ts:211-212` aplicado no lado errado → massa fantasma se ligar válvula chamber↔jacket. Topologia atual não dispara. Aplicar cap ao flux partilhado antes do split source/dest.
  - Menor: constantes Antoine inline em `chamber.ts` (usar `p_sat_water`); `k_evap=1e-7` magic → `constants.ts`; F0 dispara no drying (falta via de arrefecimento load/jacket). _(Nota SP-A: `chamber.ts` já usa `p_sat_water` e o `k_evap` foi removido pela bisecção mass-only.)_
  - Menor (SP-A, 2026-07-06): `chamber.ts:105` zera líquido a entrar na jaqueta mas `H_in` ainda conta `dm_liq_in·CP_LIQ·T` → fuga se alguma vez entrar líquido na jaqueta. Não dispara hoje (jaqueta é alimentada a vapor). Guardar/asserir se algum cenário injetar líquido na jaqueta.
- Sub-projeto 5 — Firmware ESP32 + Modbus slave (I/O + watchdog + fast model)
- Sub-projeto 6 — Injeção de falhas (hooks orchestrator + UI faults + cenários)
- Sub-projeto 7 — Placa condicionamento KiCad (schematic + PCB + BOM)
- Sub-projeto 8 — PLC-in-loop aceitação (PLC real, ajustes finais, QA arquivada)
- Sub-projeto 9 — Mímico SVG + cycles history + replay

## Feito

- 2026-07-09 — **SP5-prep — achados protocol-consistency-reviewer resolvidos.** (1) `emit-cpp`
  passa a emitir `REG_<id>_TYPE` (MB_TYPE_BOOL/INT16/UINT16) → firmware distingue uint16/int16
  (`F0_X10` deixa de ler como signed). (2) Escalas movidas p/ register: `F0_X10` scale=10 e
  `SIM_TIME_SCALE` scale=100 no `registers.yaml`; consumidores (`sensor-publisher`, `plc`) largam
  os ×10/÷10 hardcoded — RegisterAccess aplica a escala (single source of truth). (3) Parser valida
  `range×scale` cabe no tipo (`TYPE_BOUNDS` + `resolveType` partilhados em `schema.ts`) → erro em vez
  de clip silencioso. (4) Sentinelas PT100 documentadas em todos os canais analógicos (incl.
  `T_TESTEMUNHO`). (5) Word-order do tick 32-bit fixado em comentário (LOW = endereço menor,
  `(HIGH<<16)|LOW`). Protocolo 28 testes + web 102 verdes; lint/typecheck verdes; generate idempotente.
  `feat/knobs-dashboard`). Componente `CycleControl` (Start/Stop) extraído e reutilizado em Home/Live/
  Virtual PLC (dedup). `SpeedControl` (slider `time.scale`) na Live — muda a velocidade de simulação em
  tempo real a meio do ciclo (scheduler lê `runtime.timeScale` cada firing). `knobs.factory.json`
  versionado = baseline de fábrica; "Repor defaults" restaura DESTE ficheiro (fallback ao registry por
  knob); boot aplica fábrica → overrides. 95 testes web verdes (+3 factory). Verificado por Playwright:
  Stop na Live (F0 101→IDLE), slider 2→50 acelerou 2.1→52.5 sim-s/2s live, reset restaura fábrica.
- 2026-07-07 — **Painel `/knobs` no dashboard** (ramo `feat/knobs-dashboard`). Registry declarativo
  (`server/knobs/registry.ts`) como fonte única — cada knob traz acessoras `get/set` tipadas; store
  load/apply/persist/reset num ficheiro override (`knobs.override.json`, gitignored, aplicado no boot);
  API `/api/knobs` GET/POST + `/reset` (validação range, 409 para knobs de ciclo mid-cycle); página
  `/knobs` com painel agrupado (ciclo/planta/controlador/tempo). Plant muta `rt.params` in-place (live),
  time via `rt.timeScale` (scheduler lê cada firing), controller via offsets ao bang-bang, cycle via
  `rt.cycleOverride` mergido em `startCycle` (só pré-arranque). 92 testes web verdes; lint/typecheck/
  build verdes. Spec+plano em docs/superpowers/. Falta verificação manual no browser (Task 8 Step 6).
- 2026-07-06 — **SP-B — Controlo de temperatura da câmara (banda EN 285)** (ramo
  `feat/chamber-temp-control`). Emulador HIL: planta agnóstica ao controlador; o bang-bang é
  controlador de **referência** no virtual PLC (substituível pelo PLC real via Modbus, SP5). Achado:
  T_câmara = T_sat(P_câmara); sem vias de perda a câmara fixa-se em T_sat(alívio) e o controlo não a
  baixa. Adicionado à planta: perda ambiente (`h_ambient_W_per_K`=10), dreno de condensado
  (`drain_kg_per_s`=2e-5), alívio = **teto de segurança 3.25 bar** (T_sat≈135.9 sob o teto +3 — o
  alívio fixa o tecto do overshoot). Controlador `chamberValveBangBang` (abrir<SP+0.1, fechar>SP+0.5,
  só no HOLD; PRESSURIZE full-open p/ come-up). Resultado: câmara no HOLD em **[134.1, 136.4] °C**
  (banda EN 285; era ~145), F0≈101, queda na secagem, ciclo COMPLETE. Detalhe §12 do doc de secagem.
  Diferido: topologia câmara-do-jacket (jaqueta não sustenta come-up). NÃO merged em master ainda.
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
