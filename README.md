# Simulador de Autoclaves

Hardware-in-the-loop emulator for steam autoclaves. ESP32 board fingindo ser autoclave completo (válvulas, sensores, gerador, carga) para PLC industrial 24V DC. Backend Next.js roda modelo termodinâmico físico (lumped + saturação + carga térmica) e cobre ciclos de esterilização 121°C gravidade e 134°C pré-vácuo, com injeção de falhas para testar o PLC sem o equipamento real.

## Estrutura

- `apps/web` — Next.js (dashboard, backend modelo, master Modbus TCP) — _vindouro_
- `apps/firmware` — PlatformIO/Arduino ESP32 (Modbus slave + I/O + fast loop) — _vindouro_
- `apps/hw` — KiCad placa condicionamento (24V ↔ 3.3V, DAC 4-20mA, sim PT-100) — _vindouro_
- `packages/protocol` — SoT do protocolo Modbus (`registers.yaml` → TS + C++)
- `packages/physics` — modelo termo isolado (testável) — _vindouro_
- `tools/scenario-runner` — CLI roda cenários YAML headless — _vindouro_
- `tools/modbus-probe` — CLI inspeção de registos — _vindouro_

## Pré-requisitos

- Node.js ≥ 20.10
- pnpm ≥ 9 (via corepack: `corepack enable && corepack prepare pnpm@9.12.0 --activate`)

## Comandos

```bash
pnpm install           # instalar tudo
pnpm generate          # regenerar artefatos do protocolo
pnpm build             # build de todos os pacotes
pnpm test              # rodar testes em todos os pacotes
pnpm typecheck         # typecheck em todos os pacotes
pnpm lint              # lint em todos os pacotes
pnpm drift-check       # regenera e falha se diff vs commitado
pnpm format            # prettier write
```

## Documentação

- Design: `docs/superpowers/specs/2026-05-23-emulador-autoclaves-design.md`
- Planos de implementação: `docs/superpowers/plans/`
- Mapa Modbus (gerado): `packages/protocol/dist/registers.ts` / `.h`

## Estado

Sub-projeto 1 (Foundation) concluído em 2026-05-23 — monorepo + `packages/protocol` (gerador YAML→TS+C++, drift-check em CI). Próximo: sub-projeto 2 (modelo físico standalone).
