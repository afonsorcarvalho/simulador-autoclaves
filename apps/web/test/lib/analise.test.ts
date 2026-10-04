import { describe, it, expect } from 'vitest';
import { achatar, grandeza, diffParametros, escolherEixos, mesclarSeries, passoReducao, reduzir } from '../../lib/analise';

describe('análise de ciclos — funções puras', () => {
  it('mescla séries por tempo (min), chave ciclo:grandeza', () => {
    const r = mesclarSeries(
      [
        [{ t_s: 0, t_carga_C: 20 }, { t_s: 60, t_carga_C: 30 }],
        [{ t_s: 60, t_carga_C: 25 }, { t_s: 120, t_carga_C: 40 }],
      ],
      ['t_carga_C'],
    );
    expect(r).toEqual([
      { t: 0, '0:t_carga_C': 20 },
      { t: 1, '0:t_carga_C': 30, '1:t_carga_C': 25 },
      { t: 2, '1:t_carga_C': 40 },
    ]);
  });

  it('ciclo antigo sem os campos novos: grandeza nova fica ausente (sem quebrar)', () => {
    const r = mesclarSeries([[{ t_s: 0, cond_carga_g: 5 }]], ['agua_carga_g', 'cond_carga_g']);
    expect(r).toEqual([{ t: 0, '0:cond_carga_g': 5 }]);
    expect(grandeza('agua_carga_g').eixo).toBe('cond');
    expect(grandeza('evap_acum_g').eixo).toBe('cond');
  });

  it('reduz 1 a cada N preservando o último', () => {
    expect(reduzir([0, 1, 2, 3, 4, 5, 6], 3)).toEqual([0, 3, 6]);
    expect(reduzir([0, 1, 2, 3, 4], 3)).toEqual([0, 3, 4]);
    expect(reduzir([1, 2], 1)).toEqual([1, 2]);
    expect(passoReducao(15_000)).toBe(1);
    expect(passoReducao(45_000)).toBe(3);
  });

  it('diff de parâmetros marca só as linhas diferentes', () => {
    const a = achatar({ name: 'A', hold: { s: 240 }, x: 1 });
    const b = achatar({ name: 'A', hold: { s: 300 } });
    const d = diffParametros([a, b]);
    expect(d.find((l) => l.k === 'name')!.difere).toBe(false);
    expect(d.find((l) => l.k === 'hold.s')).toEqual({ k: 'hold.s', valores: [240, 300], difere: true });
    expect(d.find((l) => l.k === 'x')!.difere).toBe(true);
  });

  it('escolhe no máximo 2 eixos (pressão à direita) e avisa o resto', () => {
    expect(escolherEixos(['p_camara_bar', 't_carga_C', 'cond_carga_g'])).toEqual({ esq: 'temp', dir: 'press', fora: ['cond'] });
    expect(escolherEixos(['p_camara_bar'])).toEqual({ esq: undefined, dir: 'press', fora: [] });
    expect(escolherEixos(['vapor_vazao_kg_h', 'vapor_total_kg'])).toEqual({ esq: 'kg', dir: 'kgh', fora: [] });
  });
});
