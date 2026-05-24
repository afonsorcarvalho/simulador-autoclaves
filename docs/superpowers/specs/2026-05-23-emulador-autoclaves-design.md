# Emulador de Autoclaves a Vapor — Design

**Data:** 2026-05-23
**Autor:** Afonso Carvalho
**Status:** spec (aguarda aprovação para gerar plano de implementação)

---

## Contexto

Equipes de automação que desenvolvem software para PLC de autoclaves a vapor precisam testar/depurar código sem acesso ao autoclave real (caro, lento, perigoso, indisponível). Este projeto entrega um **emulador hardware-in-the-loop**: uma placa baseada em ESP32 que se conecta diretamente ao PLC industrial via 24V DC, fingindo ser o autoclave completo — todas as válvulas, sensores, atuadores e utilidades. Por trás do ESP32, um backend Next.js em PC roda um modelo termodinâmico físico (lumped + saturação + carga térmica) que reproduz o comportamento real da câmara, camisa, gerador e carga durante ciclos de esterilização (121°C gravidade, 134°C pré-vácuo, secagem, Bowie-Dick), incluindo cálculo de F0. Dashboard web permite configurar equipamentos diferentes via UI CRUD, monitorar ciclos ao vivo, injetar falhas (válvulas travadas, sensores quebrados, gerador sem água, vazamentos) e validar a reação do PLC. Resultado: ciclo de desenvolvimento PLC sem precisar do autoclave físico.

### Escopo coberto

- Autoclaves genéricos configuráveis (parametrizados por UI/SQLite).
- Topologia: porta dupla (barreira) com gerador integrado **ou** vapor de rede.
- Interface elétrica industrial: 24V DC discreto + 4-20 mA + PT-100.
- Modelo físico lumped + saturação (Antoine) + carga térmica (atraso sensor testemunho).
- Injeção de falhas (válvula, sensor, utilidade) via UI ou cenário YAML.
- Modo HW virtual (sem ESP32 nem PLC) para dev/TDD/CI.

### Fora de escopo (V1)

- Auth/multi-tenant (uso LAN local).
- Mobile UI.
- CFD/multi-zona.
- Outros tipos de esterilizadores (ETO, peróxido).
- Conformidade formal com normas (EN 285, ISO 17665) — modelo "qualitativo realista", não certificado.

---

## Arquitetura

Monorepo (npm workspaces + Turborepo) com 3 aplicações + 2 pacotes partilhados:

```
simulador-autoclaves/
├── apps/
│   ├── web/        # Next.js (App Router): dashboard + backend modelo + master Modbus
│   ├── firmware/   # PlatformIO/Arduino ESP32: I/O + Modbus slave + fast loop local
│   └── hw/         # KiCad: placa condicionamento (opto-iso, DAC 4-20mA, sim PT-100)
├── packages/
│   ├── protocol/   # SoT do protocolo Modbus (registers.yaml → gera .ts + .h)
│   └── physics/    # modelo termo testável isolado (vitest)
├── tools/
│   ├── scenario-runner/   # CLI roda cenários YAML headless
│   └── modbus-probe/      # CLI inspeção registos ESP32
├── docs/
│   ├── superpowers/specs/
│   └── architecture.md / modbus-map.md / physics-model.md
└── TODO.md
```

### Stack

| Camada                    | Tecnologia                                                                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend + UI              | Next.js 14+ App Router, TypeScript, TailwindCSS + shadcn/ui, Recharts, zustand, zod                                                                                                             |
| Persistência              | SQLite via `better-sqlite3` (`~/.simulador-autoclaves/db.sqlite`)                                                                                                                               |
| Comunicação tempo-real UI | WebSocket nativo Next.js                                                                                                                                                                        |
| Comunicação ESP32 ↔ PC    | Modbus TCP (ESP32 slave, Next.js master); lib `jsmodbus` ou `modbus-serial`                                                                                                                     |
| Firmware ESP32            | C++ Arduino framework via PlatformIO; bibliotecas: `eModbus` (TCP slave), `Adafruit_MCP23X17`, `Adafruit_MCP4728`, driver AD5293 custom                                                         |
| Hardware                  | ESP32-WROOM, 2× MCP23017 (32 GPIOs extra), MCP4728 (4× DAC 12-bit) + XTR111 (V→4-20mA), AD5293 (potenciómetro digital p/ sim PT-100), opto-isoladores PC817, drivers ULN2803, fonte 24V isolada |
| Testes                    | vitest (web/physics), Unity (firmware native+target), kicad-cli ERC/DRC                                                                                                                         |
| CI                        | GitHub Actions: build + lint + tests camadas 1-4 + drift check protocolo + kicad checks                                                                                                         |

### Fluxo de dados (modo real)

```
[PLC] ──24V DC──► [Placa cond] ──3.3V──► [ESP32]
                                            │
                                            │ Modbus TCP @ porta 502, sobre WiFi/Ethernet
                                            ▼
                                       [Next.js backend]
                                            │ orchestrator @ 100 Hz:
                                            │   1. read DI (comandos PLC)
                                            │   2. step modelo (chamber+jacket+gen+load+f0)
                                            │   3. write Holding (analógicos novos)
                                            │   4. write Coils (discretos sensores)
                                            │   5. push WebSocket → frontend
                                            │   6. SQLite datalog @ 1 Hz (opcional)
                                            ▼
[PLC] ◄──24V DC── [Placa cond] ◄──── [ESP32]
                                       (DAC 4-20mA via XTR111 + sim PT-100 via AD5293)
```

### Fluxo de dados (modo HW virtual)

`HW_MODE=virtual`: backend usa `bridge/virtual-esp32.ts` (slave Modbus in-memory). Comandos vêm de `/dashboard/virtual-plc` (botões) ou de scenario YAML. Mesma orchestrator, mesmo modelo, sem hardware. Habilita TDD, dev de UI, regressão CI.

---

## Componentes

### apps/firmware (ESP32)

- `main.cpp` — loop principal: leitura GPIO inputs → Modbus DI; serve Modbus TCP; fast model @ 100 Hz; aplica holdings recebidos a DAC/PT-100; watchdog.
- `modbus_slave.cpp` — eModbus, 4 espaços (DI/Coils/Holding/diag).
- `io_expander.cpp` — driver MCP23017 (2 chips, I²C).
- `dac_4_20.cpp` — MCP4728 + XTR111 (3 canais usados: P_int, P_ext, P_gen).
- `pt100_sim.cpp` — AD5293, Callendar-Van Dusen para converter T (°C) → R (Ω) → código DAC.
- `fast_model.cpp` — subset físico local (só câmara interna, vazão por válvula → ΔP) para resposta <10 ms; sincronizado periodicamente pelo PC.
- `watchdog.cpp` — sem PC > 500 ms → todas saídas para fail-safe (válvulas fechadas, heater OFF, DACs → 4 mA = sensor falha).
- `registers_generated.h` — gerado por `packages/protocol`.

### apps/web (Next.js)

**Server (`apps/web/server/`):**

- `bridge/modbus-tcp.ts` + `bridge/virtual-esp32.ts` + `bridge/factory.ts` — interface comum `ModbusBridge` selecionada por `HW_MODE`.
- `model/saturation.ts` — Antoine (água, 0-200°C) + `h_vap(T)` polinomial.
- `model/valve.ts` — vazão choked/sub-choked, com `applyValveFault`.
- `model/chamber.ts` — volume de controle ar+vapor+líquido; balanços massa/energia; condensação/evaporação por saturação.
- `model/jacket.ts` — idem para camisa.
- `model/generator.ts` — pool boiling, T_gen = T_sat(P_gen), `dm_vap = Q_heater/h_vap`.
- `model/load.ts` — 2 massas (metálica+têxtil) com transferência convectiva e condutiva; sensor testemunho embutido na têxtil.
- `model/f0.ts` — acumulador `F0 += 10^((T-121.1)/10) * dt/60`.
- `model/orchestrator.ts` — loop 100 Hz, integra todos VCs, aplica falhas, escreve bridge, publica WS.
- `model/time-engine.ts` — fonte única de tempo (real / acelerado até 10x / pausa / step).
- `faults/injector.ts` — registro de falhas ativas, hooks `applyValveFault` / `applySensorFault` / `applyActuatorFault`.
- `persistence/sqlite.ts` — schema `equipment`, `fault_runs`, `cycle_runs`, `cycle_samples`.

**Frontend (`apps/web/app/`):**

- `(dashboard)/page.tsx` — home: equipamento ativo, status, último ciclo.
- `(dashboard)/live/page.tsx` — mímico P&ID SVG interativo + charts P/T/F0 + eventos.
- `(dashboard)/cycles[/...]` — histórico + replay c/ scrubber.
- `(dashboard)/equipment[/...]` — wizard CRUD topologia/I/O/sensores/falhas disponíveis.
- `(dashboard)/faults` — painel injeção (lista componentes + dropdown modos + form parâmetros).
- `(dashboard)/virtual-plc` — só em modo virtual: botões DO substituem PLC.
- `(dashboard)/scenarios` — lista YAML + executa.
- `(dashboard)/settings` — IP ESP32, time scale, datalog on/off.
- `api/ws/route.ts` — WebSocket snapshot 10 Hz.
- `api/equipment` / `api/faults` / `api/cycles` — REST.

### apps/hw (KiCad)

- Schematic: ESP32 + 2× MCP23017 + MCP4728 + 3× XTR111 + AD5293 + opto-isoladores (entradas 24V → 3.3V) + ULN2803 drivers (saídas 3.3V → 24V open-collector com pull-up no PLC) + fonte AC/DC 24V→5V→3.3V isolada.
- PCB: layout único 100×100 mm (limite low-cost JLC/PCBWay), 2 camadas.
- BOM CSV exportada, README com pinout + procedimento calibração (3 pts de pressão + 3 pts de temperatura por canal).

### packages/protocol

- `registers.yaml` — SoT. Cada entrada: id, address, space (DI/Coil/Holding/Diag), scale, unit, description.
- `generate.ts` — lê YAML, emite `dist/registers.ts` (TypeScript const + tipos) e `dist/registers.h` (defines C++).
- `package.json` — hook `prebuild`.

### packages/physics (opcional, recomendado)

- Re-exporta módulos `model/` puros para teste isolado (sem dependência Next.js).
- Permite vitest standalone + reuso em scenario-runner.

### tools/scenario-runner

- CLI Node consome YAML c/ steps (`cmd`/`fault.activate`/`wait_for`/`hold`) + asserts (F0, T_test, alarmes).
- Modo `virtual` (default) ou `real` (aponta para ESP32 e PLC reais).
- Grava CSV trace em `results/<scenario>-<timestamp>.csv`.
- Cenários iniciais: `ster-121-gravity`, `ster-134-prevac`, `drying-only`, `bowie-dick`, `fault-v-vac-stuck`, `fault-pt100-open`, `fault-leak-chamber`, `fault-heater-burnt`.

---

## Modelo termodinâmico — núcleo

### Estado por volume de controle (câmara interna; análogo para camisa/gerador)

```
m_air, m_vap, m_liq   (massas, kg)
T                     (temperatura uniforme, K)
T_wall                (temperatura parede, K)
V                     (volume fixo, m³)
```

Carga: `T_load_metal`, `T_load_fabric` (este último = sensor testemunho).

### Equações (passo dt = 10 ms, Euler explícito)

1. **Pressões parciais (Dalton):**
   `p_air = m_air·R_air·T/V`, `p_vap = min(m_vap·R_vap·T/V, p_sat(T))`, `p_total = p_air + p_vap`.

2. **Saturação (Antoine, água, 0-200°C):**
   `log10(p_sat[mmHg]) = 8.07131 - 1730.63/(233.426 + T[°C])` (erro <0.5% vs IAPWS no intervalo).

3. **Condensação:** se `m_vap·R_vap·T/V > p_sat`, excesso condensa, libera `Q_lat = dm_cond · h_vap(T)`.

4. **Evaporação:** se `m_liq > 0` e `p_vap < p_sat`, evapora gradual proporcional ao déficit.

5. **Vazão por válvula:** orifício compressível, choked se `ΔP > 0.5·P_up`:
   `ṁ = Cv · cv_mult · P_up · sqrt(γ/(R·T_up))` (choked); ou linear para `ΔP` pequeno.

6. **Balanços:**
   `dm_x/dt = Σ ṁ_in − Σ ṁ_out + termos cond/evap`
   `dU/dt = Σ ṁ_in·h_in − Σ ṁ_out·h_out + Q_lat − Q_to_wall − Q_to_load` → resolve T.

7. **Carga (sensor testemunho):**
   `Q_to_load_metal = h_l · A_l · (T − T_load_metal)`, `Q_metal_to_fabric = h_mf · A_mf · (T_metal − T_fabric)`. Atraso natural na cascata.

8. **F0:** `F0 += 10^((T_test − 121.1)/10) · (dt/60)` quando `T_test ≥ 100°C`.

### Particionamento de carga

| Cálculo                                            | Onde  | Razão                                            |
| -------------------------------------------------- | ----- | ------------------------------------------------ |
| Vazão válvula → ΔP câmara interna (proxy)          | ESP32 | latência <10 ms                                  |
| Modelo gerador / camisa / carga / F0 / condensação | PC    | autoritativo, sat table                          |
| Atualização DAC                                    | ESP32 | usa último valor recebido + correção proxy local |

PC envia holding ao ESP32 a 50 Hz; ESP32 interpola entre updates usando proxy local.

### Cenários referência (validação modelo)

- **Ster 121°C gravidade**: vapor entra sem pré-vácuo → P sobe rápido (ar comprimido), T sobe lento; hold 15 min → F0 ≥ 15.
- **Ster 134°C pré-vácuo** (foco principal): 3-4 pulsos vácuo/vapor remove ar; pressuriza até 3.04 bar abs / 134°C; hold 7 min; F0 ≥ 100. T_testemunho atinge 134°C ~90-150 s após T_gás (atraso carga).
- **Secagem**: vácuo + camisa quente → m_liq na carga evapora puxado pelo déficit de p_vap.

---

## Schema Modbus (resumo)

| Espaço          | Range         | Conteúdo                                                     | Direção    |
| --------------- | ------------- | ------------------------------------------------------------ | ---------- |
| Discrete Inputs | 0x0000-0x0FFF | comandos PLC → ESP32 lê (válvulas, relés)                    | PC só lê   |
| Coils           | 0x1000-0x1FFF | estados discretos para PLC (pressostatos, fim-curso, níveis) | PC escreve |
| Holding         | 0x3000-0x3FFF | analógicos para PLC (P×3, T×4) — int16 escalado              | PC escreve |
| Diagnóstico     | 0x4000-0x4FFF | tick, watchdog, F0, fault_mask, time_scale, equipment_id     | PC escreve |

Escalas fixas no `registers.yaml`. Códigos sentinela: holding `int16=-32768` → sensor OPEN (DAC=0 mA / R=∞); `32767` → SHORT (DAC=22 mA / R=0).

---

## Falhas — taxonomia e injeção

**Famílias:**

- **VLV** (válvula): `STUCK_OPEN`, `STUCK_CLOSED`, `SLOW_OPEN(τ)`, `LEAK(cv)`, `PARTIAL(ratio)`.
- **SNS** (sensor): `OPEN`, `SHORT`, `FROZEN`, `DRIFT(rate)`, `NOISE(σ)`, `OUT_OF_RANGE(clip)`.
- **ACT/UTL** (atuador/utilidade): `VAC_PUMP_DEAD`, `VAC_PUMP_WEAK(ratio)`, `HEATER_BURNT`, `HEATER_PARTIAL`, `GEN_NO_WATER`, `STEAM_LINE_LOW`, `AIR_LINE_LOW`, `LEAK_CHAMBER(cv)`, `SEAL_LEAK`.

**Estado runtime:** `Map<component_id, ActiveFault>` no orchestrator + tabela `fault_runs` SQLite para audit.

**Injeção:**

- UI `/dashboard/faults`: dropdown + form de parâmetros + botão ativar/desativar.
- API REST: `POST /api/faults/activate`, `DELETE /api/faults/:id`, `GET /api/faults`.
- YAML scenario: `fault.activate` / `fault.deactivate` em qualquer step.

**Aplicação no modelo:** hooks `applyValveFault(v, cmd)` e `applySensorFault(s, real)` chamados pelo orchestrator a cada tick; sensor `OPEN`/`SHORT` propaga via códigos sentinela holding → ESP32 traduz em sinal elétrico real.

**Cobertura mínima MVP** (cenários verificando reação PLC):

- `V_VAC STUCK_CLOSED` → PLC alarma `ALM_VACUUM_TIMEOUT` <60 s.
- `P_CHAMBER_INT OPEN` → `ALM_SENSOR_TEMP` imediato.
- `UTL.LEAK_CHAMBER cv=0.1` no hold → `ALM_PRESSURE_LOSS` <30 s, ciclo abortado.
- `ACT.HEATER_BURNT` → `ALM_GEN_NO_PRESSURE` em N min.
- `UTL.GEN_NO_WATER` → `LVL_GEN_MIN` ativa imediato.

---

## UI/Dashboard (resumo)

Rotas: `/dashboard`, `/live` (mímico SVG + charts + F0 + eventos), `/cycles[/...]` (histórico + replay), `/equipment[/...]` (wizard CRUD), `/faults`, `/virtual-plc` (só virtual), `/scenarios`, `/settings`.

**Live screen**: mímico P&ID gerado de `equipment.topology`; válvulas verde/cinza/amarelo/vermelho conforme estado e fault; tubulação anima fluxo; sensor click → atalho injetar falha. Charts Recharts (P×3, T×4, F0, comandos) com downsampling LTTB. Eventos cronológicos com marcadores.

**Virtual PLC**: botões ON/OFF para cada DO, scripts rápidos (pulso pré-vácuo, pressurizar até X, stop tudo).

**Editor equipamento**: wizard topologia → gerador → válvulas → sensores → atuadores → carga → validação. zod schema partilhado.

---

## Critérios de aceitação

- **Físicos**: simular ciclo 134°C pré-vácuo completo em modo virtual com F0 ≥ 100, T_test ≥ 134 durante hold, sem alarme; ciclo 121°C gravidade F0 ≥ 15.
- **Elétricos**: HW-in-loop com PLC real Siemens S7-1200 (ou equivalente) executa ciclo nominal sem alarme inesperado; injeção de cada falha do conjunto mínimo gera alarme PLC esperado no tempo esperado.
- **Engenharia**: monorepo builda em CI; protocolo gerado sem drift; cobertura testes ≥85% modelo, ≥70% firmware; cenários YAML rodam verdes em CI.
- **UX**: dashboard mostra snapshot completo @ 10 Hz com latência ESP32↔PC <30 ms p50 (LAN).

---

## Verificação end-to-end

**Camadas de teste, do mais barato ao mais caro:**

1. **Modelo físico isolado** — `pnpm --filter @sim/physics test` (vitest, ~2 s). Saturação vs IAPWS, choked flow, condensação balance, F0, atraso carga.
2. **Orchestrator + virtual ESP32** — `pnpm --filter @sim/web test:integration` (~30 s). Comando virtual → modelo → API; watchdog; faults sensores propagam códigos sentinela.
3. **Scenarios YAML headless** — `pnpm scenario-runner run-all` (~10 min). Bateria 121/134/secagem/Bowie-Dick + 4 faults mínimas, asserts F0/T/alarmes.
4. **Firmware unit (Unity native)** — `pio test -e native` (~5 s). Fast model latência, Modbus byte order, watchdog fail-safe, PT-100/DAC conversão.
5. **Bancada HW-in-loop manual** — multímetro USB + cargas dummy. DAC sweep ±0.2 mA FS, PT-100 sweep ±1 Ω FS, DI/DO sweep sem cross-talk, watchdog <600 ms, latência mediana <30 ms / p95 <80 ms. Checklist arquivado `docs/qa/bench-<data>.md`.
6. **PLC-in-loop aceitação manual** — PLC real + cabeamento completo. 5 procedimentos: power-up sem alarme, ciclo nominal 30 min, ciclo+injeção falha+recovery, 4 ciclos seguidos sem leak/watchdog. Arquivado `docs/qa/plc-acceptance-<data>.md`.
7. **CI contínuo** — GitHub Actions: build turbo, lint, typecheck, camadas 1-4, kicad ERC/DRC, drift check protocolo.

**Gate de release MVP**: camadas 1-4 verdes em CI + camada 5 manualmente OK + camada 6 com ≥1 PLC alvo.

---

## Decomposição em sub-projetos (sugestão para fase de planejamento)

Spec é grande. Implementação deve ser fatiada. Ordem sugerida para o `writing-plans` skill (cada item ganha plano próprio):

1. **Foundation**: monorepo skeleton + `packages/protocol` (YAML+generator) + CI básico + TODO.md.
2. **Modelo físico standalone**: `packages/physics` com saturação, valve, chamber, jacket, generator, load, f0 + testes vitest. Sem ESP32.
3. **Orchestrator + virtual bridge + scenario runner**: `apps/web/server/*` modo virtual completo, cenário 134°C verde.
4. **Dashboard MVP**: rotas live + virtual-plc + equipment CRUD + WebSocket. Sem mímico bonito (charts simples).
5. **Firmware ESP32 + Modbus slave**: I/O burras (expander+DAC+sim PT-100) + watchdog + fast model trivial. Bancada smoke test.
6. **Injeção de falhas**: hooks orchestrator + UI faults + cenários fault-\*.
7. **Placa condicionamento (apps/hw)**: schematic + PCB + BOM. Fabrica + monta + camada 5 verificação.
8. **PLC-in-loop aceitação**: integração com PLC alvo real, ajustes finais, doc QA arquivada.
9. **Mímico SVG bonito + cycles history + replay**: features visuais/QoL após base sólida.

Cada sub-projeto deve ter PR isolado, testes próprios, demo no `/scenarios` ou bancada.

---

## Arquivos críticos a criar (greenfield — projeto vazio hoje)

Não há código existente para referenciar. Todos os caminhos abaixo são **novos**:

- `package.json` (workspaces) + `turbo.json` + `tsconfig.base.json`
- `packages/protocol/registers.yaml` (SoT do protocolo)
- `packages/protocol/generate.ts`
- `packages/physics/src/{saturation,valve,chamber,jacket,generator,load,f0}.ts`
- `apps/web/server/model/orchestrator.ts`
- `apps/web/server/bridge/{modbus-tcp,virtual-esp32,factory}.ts`
- `apps/web/server/faults/injector.ts`
- `apps/web/server/persistence/sqlite.ts`
- `apps/web/app/(dashboard)/live/page.tsx`
- `apps/firmware/platformio.ini` + `apps/firmware/src/{main,modbus_slave,io_expander,dac_4_20,pt100_sim,fast_model,watchdog}.cpp`
- `apps/hw/autoclave-iface.kicad_pro` + schematic + PCB
- `tools/scenario-runner/src/cli.ts` + `scenarios/*.yaml`
- `TODO.md` (tracker de tarefas do projeto)
- `docs/architecture.md`, `docs/modbus-map.md` (gerado), `docs/physics-model.md`

---

## Riscos e mitigações

| Risco                                                                                       | Mitigação                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Sim PT-100 via AD5293 não cobre range completo (~18..220 Ω alvo, AD5293 = 20 kΩ resolution) | Avaliar alternativa: DAC + amp como fonte de corrente fingindo RTD; ou MAX31865 reverse. Decidir em sub-projeto 5 com bancada de testes. |
| Latência Modbus TCP via WiFi > 30 ms em ambiente ruidoso                                    | Fast model local no ESP32 absorve transientes rápidos; usar Ethernet (módulo W5500) se WiFi inadequado em fábrica.                       |
| Modelo termodinâmico tunning longo p/ bater curvas reais                                    | Começar c/ parâmetros razoáveis literatura + scenario runner com tolerância larga; ajustes finos em fase 8 (PLC-in-loop).                |
| Drift entre registers.h e registers.ts                                                      | CI bloqueia merge se gerado != commitado.                                                                                                |
| Custo placa cond se baixo volume                                                            | Layout 100×100 mm, JLC/PCBWay 5 unid <50 EUR; componentes BOM total <30 EUR/placa.                                                       |
