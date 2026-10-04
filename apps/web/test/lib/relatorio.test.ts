import { describe, it, expect } from 'vitest';
import { montarRelatorio, nomeArquivo, rotuloSaida, faixasRotuladas, formatarValorKnob } from '../../lib/relatorio';
import type { Ciclo } from '../../server/ciclos/store';

describe('relatório de ciclo', () => {
  it('rótulo pt-BR da saída', () => {
    expect(rotuloSaida('OUT_VALV_VAPOR_CAMARA')).toBe('Válvula vapor câmara');
    expect(rotuloSaida('OUT_BOMBA_VACUO')).toBe('Bomba vácuo');
    expect(rotuloSaida('OUT_VALV_EXAUSTAO_LENTA')).toBe('Válvula exaustão lenta');
    expect(rotuloSaida('V_STEAM_IN_JACKET')).toBe('Válvula vapor entrada camisa');
    expect(rotuloSaida('HEATER_GEN')).toBe('Resistência gerador');
    expect(rotuloSaida('X_DESCONHECIDO')).toBe('X desconhecido');
  });

  it('nome de arquivo sanitizado', () => {
    const d = new Date(2026, 9, 3, 14, 5);
    expect(nomeArquivo('Bowie/Dick: teste #1', d, '1.005', 'v2 b')).toBe('RC_Bowie-Dick-teste-1_2026-10-03_14h05_CLP-1.005_IHM-v2-b');
    expect(nomeArquivo('Ação', d)).toBe('RC_Acao_2026-10-03_14h05_CLP-NA_IHM-NA');
  });

  const base = (serie: Partial<Ciclo['serie'][number]>[], meta: Partial<Ciclo['meta']> = {}) =>
    ({
      meta: { id: 'x', inicio: '', fim: null, duracao_s: 0, modo: 'virtual', resultado: null, motivo: null, nome: '', anotacao: '', parcial: false, ...meta },
      parametros: { ciclo: null, knobs: {}, versoes: {} },
      resumo: {} as Ciclo['resumo'],
      serie: serie.map((p, i) => ({ t_s: i, fase: 'A', fase_cod: 0, ...p })),
    }) as unknown as Ciclo;

  it('ciclo antigo sem saídas: monta sem gráfico de saídas', () => {
    const r = montarRelatorio(base([{ p_camara_bar: 1 }, { p_camara_bar: 2 }]));
    expect(r.saidas).toEqual([]);
    expect(r.dados).toHaveLength(2);
    expect(r.dados[1]!.t).toBeCloseTo(1 / 60);
  });

  it('saídas: só as que mudaram, linhas empilhadas, redução ≤ limite', () => {
    const serie = Array.from({ length: 5000 }, (_, i) => ({ saidas: i > 2500 ? '101' : '001' }));
    const r = montarRelatorio(base(serie, { saidas_nomes: ['A_X', 'B_Y', 'C_Z'] }), 2000);
    expect(r.dados.length).toBeLessThanOrEqual(2001);
    expect(r.saidas.map((s) => s.nome)).toEqual(['A_X', 'B_Y', 'C_Z']);
    expect(r.saidas.map((s) => s.mudou)).toEqual([true, false, false]);
    expect(r.dados.at(-1)!['s0']).toBe(1);
    expect(r.dados[0]!['s0']).toBe(0);
    expect(r.dados[0]!['s2']).toBe(1);
  });

  it('faixas largas ganham rótulo, estreitas ficam sem (≥6% do tempo total)', () => {
    const faixas = [
      { x1: 0, x2: 1, fase: 'Pré-vácuo' }, // 1/100 = 1%
      { x1: 1, x2: 90, fase: 'Esterilização' }, // 89%
      { x1: 90, x2: 100, fase: 'Secagem' }, // 10%
    ];
    const r = faixasRotuladas(faixas, 100);
    expect(r.map((f) => f.rotulo)).toEqual(['', 'Esterilização', 'Secagem']);
  });

  it('faixasRotuladas: minFrac customizado e tTotal 0 não quebra', () => {
    const faixas = [{ x1: 0, x2: 5, fase: 'A' }];
    expect(faixasRotuladas(faixas, 100, 0.1).map((f) => f.rotulo)).toEqual(['']);
    expect(faixasRotuladas(faixas, 0).map((f) => f.rotulo)).toEqual(['']);
  });

  it('valor de knob: decimals explícito', () => {
    expect(formatarValorKnob(3.191538243211461, { decimals: 1 })).toBe('3,2');
    expect(formatarValorKnob(5, { decimals: 0 })).toBe('5');
  });

  it('valor de knob: sem decimals — 3 alg. sig., inteiro sem casas', () => {
    expect(formatarValorKnob(3.191538243211461)).toBe('3,19');
    expect(formatarValorKnob(10)).toBe('10');
    expect(formatarValorKnob(0.0012345)).toBe('0,00123');
  });

  it('valor de knob: lista mostra o rótulo da opção', () => {
    const meta = { optionLabels: ['Aço inox', 'Alumínio'] };
    expect(formatarValorKnob(0, meta)).toBe('Aço inox');
    expect(formatarValorKnob(1, meta)).toBe('Alumínio');
  });
});
