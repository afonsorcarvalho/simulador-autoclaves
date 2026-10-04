# Histórico de ciclos e aba de análise comparativa — design

Data: 2026-10-03. Pedido do Afonso; padrões propostos e aceitos na conversa.

## Objetivo

Guardar os dados de cada ciclo e comparar ciclos num mesmo gráfico (ex. temperatura da carga de 3
ciclos), para otimizar os parâmetros de ciclo. Inclui o condensado calculado.

## Gravação

- Automática: todo ciclo é gravado ao terminar (finalizado, abortado ou parado). Funciona no modo
  virtual (ciclo do simulador) e com CLP real (`onCycleStart` / fim quando a fase volta a 0 ou o
  ciclo termina — use os ganchos existentes de início/fim).
- Pasta `apps/web/ciclos/` (configurável por env `SIM_CICLOS_DIR`), fora do git (`.gitignore`).
- Um arquivo JSON por ciclo, nome = horário local de início `AAAA-MM-DD_HHhMMmSS.json`.
- Conteúdo:
  - `meta`: id (= nome), início, fim, duração_s, modo (virtual / CLP real), resultado
    (aprovado / abortado / parado / desconhecido), motivo se houver, nome e anotação (editáveis);
  - `parametros`: receita/ciclo usado, todos os valores de knobs no início do ciclo, versões
    (se configuradas nas config do simulador de erros);
  - `resumo`: F0 final, condensado total (carga, parede), T máx carga, P máx câmara, tempos por fase;
  - `serie`: 1 ponto/s, t_s desde o início + grandezas: pressões (câmara, camisa, gerador),
    temperaturas (câmara, dreno, carga/testemunho, camisa, gerador), F0, condensado carga/parede (g),
    vazão (g/min), fase do ciclo (texto e código), estado de portas (se houver).
- Reaproveitar o `SnapshotPublisher.history` / snapshot existentes para os campos; não duplicar
  cálculo.
- Limite: série inteira do ciclo (ciclos de até ~4 h a 1 ponto/s ≈ 15 k pontos); gravar no fim
  (e um parcial a cada ~60 s para não perder se o servidor cair).

## API

- `GET /api/ciclos` → lista (meta + resumo, sem série).
- `GET /api/ciclos/<id>` → ciclo completo.
- `PATCH /api/ciclos/<id>` `{nome?, anotacao?}`; `DELETE /api/ciclos/<id>`.
- `GET /api/ciclos/<id>/csv` → série em CSV (pt-BR: `;` separador, vírgula decimal).
- id validado (regex do nome do arquivo; sem path traversal).

## Aba "Análise de ciclos" (`/analise`)

- Lista dos ciclos gravados (data, nome, receita, resultado, duração, F0, condensado total),
  editar nome/anotação, apagar (com confirmação), checkbox para selecionar.
- Seletor de grandezas (multi). Gráfico sobrepondo os ciclos selecionados, tempo zerado no início
  de cada ciclo (t em min), uma cor por ciclo, estilo de linha por grandeza quando houver mais de
  uma; tooltip com valores formatados (pressão 3 casas bar, temperatura 1 casa °C, condensado g
  inteiro — reutilizar `lib/format.ts`). Faixas de fase do primeiro ciclo selecionado (opcional).
- Tabela de parâmetros lado a lado dos ciclos selecionados, destacando as linhas que diferem.
- Tabela de resumo lado a lado.
- Link no menu.

## Testes

- Gravação: ciclo virtual curto gera arquivo com meta/parâmetros/resumo/série; nome pelo horário;
  parcial existe durante o ciclo; ciclo parado/abortado também grava com resultado certo.
- API: lista, get, patch, delete, csv, traversal → 400.
- UI: conferida no navegador em servidor separado (modo virtual).

## Fora de escopo

- Banco de dados; comparação estatística; alinhamento por fase (pode vir depois).
