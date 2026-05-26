# TODO

## Em curso

- Sub-projeto 4 — Dashboard MVP (live + virtual-plc + equipment CRUD + WS)

## Pendente
- Sub-projeto 5 — Firmware ESP32 + Modbus slave (I/O + watchdog + fast model)
- Sub-projeto 6 — Injeção de falhas (hooks orchestrator + UI faults + cenários)
- Sub-projeto 7 — Placa condicionamento KiCad (schematic + PCB + BOM)
- Sub-projeto 8 — PLC-in-loop aceitação (PLC real, ajustes finais, QA arquivada)
- Sub-projeto 9 — Mímico SVG + cycles history + replay

## Feito

- 2026-05-26 — Sub-projeto 3 — Orchestrator + virtual bridge + scenario runner (apps/web: ModbusBridge interface, VirtualEsp32Bridge in-memory, RegisterAccess typed wrapper, Orchestrator tick loop, VirtualPLC state machine + valve commander, scenario runner driving closed-loop 134°C cycle to F0 ≥ 100 entirely virtual. 44 vitest tests)
- 2026-05-25 — Sub-projeto 2.5 — Physics hardening + jacket bang-bang + condensation latent heat fix
- 2026-05-24 — Sub-projeto 2 — Modelo físico standalone (packages/physics: saturação Antoine, choked flow, chamber+jacket c/ evaporação+condensação+saturação, generator pressure-vessel boiling, load 2-mass c/ testemunho, F0, integrator, CLI scenario YAML+CSV. Cenários 121°C gravidade + 134°C prevac + drying verdes. 57 vitest tests)
- 2026-05-23 — Sub-projeto 1 — Foundation (monorepo pnpm+turbo, packages/protocol gerando TS+C++ de registers.yaml com testes e drift-check em CI)
