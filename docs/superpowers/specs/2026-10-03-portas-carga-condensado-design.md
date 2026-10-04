# Portas resfriam a câmara, carga configurável e gráfico de condensado — design

Data: 2026-10-03. Aprovado pelo Afonso na conversa.

## Objetivo

Deixar o simulador mais útil para estudar configuração de ciclo:

1. A câmara interna esfria quando a porta abre (mais rápido com as duas abertas) e volta a
   esquentar quando fecha (a camisa aquece a parede).
2. A carga é configurável por knobs: dois materiais com massa cada um e temperatura inicial.
3. Um gráfico mostra o condensado gerado ao longo do ciclo, separado por origem (carga e parede da
   câmara), com os valores atuais em número.

## 1. Portas e temperatura da câmara

- Knob `plant.ambient.T` (°C, padrão 23, faixa 0..45): temperatura ambiente. Substitui o 22 °C
  fixo usado hoje em `singleton.ts` (máquina fria, carga) e o `atmosphere_T` dos params.
- Abertura efetiva `a = pos_C + pos_D` (0..2), vinda do modelo de porta da bancada (`DeltaPlcBridge.door`,
  só com `SIM_PLC=delta`; sem portas, `a = 0`). Porta parcialmente aberta conta proporcional.
- Com `a > 0`, a câmara troca calor e massa com o ambiente:
  - parede interna perde calor por convecção para o ambiente: `Q = a · h_porta · (T_parede − T_amb)`;
  - o gás da câmara relaxa para ar ambiente na pressão atmosférica (porta aberta = câmara a
    1 atm): vapor sai, ar entra, com taxa proporcional a `a` (constante de tempo knob).
- Knob `plant.door.h_open` (W/K por porta, padrão calibrável, ex. 40) e
  `plant.door.tau_gas_s` (s, padrão ex. 20) para calibrar contra a máquina real.
- Porta fechada: nenhuma troca extra; a camisa reaquece a parede pelo acoplamento existente
  (conferir que existe e funciona; se não, acrescentar condução camisa→parede).

## 2. Carga

Knobs (aplicados ao iniciar cada ciclo, ou ao trocar o knob com a máquina ociosa):

- `plant.load.material_a` (lista: os 8 materiais de `packages/physics/src/materials.ts`), padrão
  `STAINLESS_316`; `plant.load.mass_a_kg` (0..200), padrão o valor atual.
- `plant.load.material_b`, padrão `COTTON_TEXTILE`; `plant.load.mass_b_kg` (0..200; 0 = sem B).
- `plant.load.T_initial` (°C, padrão = temperatura ambiente): a carga entra nessa temperatura no
  início do ciclo, mesmo com a câmara quente.
- O material B é o testemunho do F0 (como o têxtil hoje). Se B tiver massa 0, o testemunho é A.
- Se o ciclo vier com carga própria (`effectiveCycle.load`), os knobs prevalecem? Não: a carga do
  ciclo/cenário prevalece; os knobs valem quando o ciclo não define carga (documentar no knob).

## 3. Condensado

- A física já calcula a condensação na carga (troca de massa carga↔câmara) e na parede/câmara
  (bisseção de saturação). Expor por passo: `cond_load_kg`, `cond_wall_kg` (só condensação,
  positiva; evaporação não desconta do acumulado — mostrar também o líquido líquido acumulado se
  for trivial).
- Acumulados por ciclo no runtime, zerados no início de cada ciclo; vão no snapshot.
- Card novo no `/live`: gráfico no tempo com acumulado carga (g), acumulado parede (g) e vazão total
  (g/min), faixas por fase do ciclo; totais no fim do ciclo.

## 4. Valores numéricos atuais

Nos cards novos/afetados (condensado, câmara/portas, carga), mostrar o valor atual em número:

- pressão em bar com 3 casas decimais (ex. `2,031 bar`);
- temperatura em °C com 1 casa decimal (ex. `134,0 °C`);
- condensado em gramas, sem casa decimal (ex. `1234 g`).

Formatação pt-BR (vírgula decimal).

## Testes

- Física: porta aberta esfria a parede e o gás; duas portas esfriam mais rápido que uma; porta
  fechada com camisa quente reaquece; conservação de água (condensado + vapor + líquido constante
  dentro da tolerância em sistema fechado); carga fria condensa mais que carga quente; mistura de 2
  materiais soma capacidades térmicas.
- Knobs: validação de faixa e lista de materiais; aplicação no início do ciclo.
- UI: conferida no navegador (Playwright), modo virtual.

## Fora de escopo

- Modelo de convecção detalhado na porta; umidade do ar ambiente; perda de vapor pela guarnição.
