import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseScenario, resolveEndereco, loadScenarios } from '../../server/erros/scenario.js';

function exemploCompleto(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'A-S1',
    titulo: 'Falha de sensor de temperatura',
    origem: 'ISO 17665 — exemplo de teste',
    automacao: 'auto',
    registrar: ['NOME_SIMBOLO', 'M10'],
    setup_temporario: { NOME_SIMBOLO: 1 },
    pre: [
      { carregar_receita: { numero: 1, campos: { SETPOINT: 134 } } },
      { iniciar_ciclo: true },
    ],
    falha: [
      { falha: { id: 'f1', tipo: 'analog.open', alvo: 'temp:0' } },
      { aguardar_s: 5 },
    ],
    esperado: [{ descricao: 'alarme de sensor ativo', ler: 'M10', igual: 1, prazo_s: 10 }],
    limpeza: [{ escrever: { NOME_SIMBOLO: 0 } }],
    ...overrides,
  };
}

describe('parseScenario', () => {
  it('aceita um exemplo completo', () => {
    const s = parseScenario(exemploCompleto());
    expect(s.id).toBe('A-S1');
    expect(s.esperado[0]?.prazo_s).toBe(10);
    expect(s.registrar).toEqual(['NOME_SIMBOLO', 'M10']);
  });

  it('aplica default prazo_s quando omitido', () => {
    const s = parseScenario(
      exemploCompleto({ esperado: [{ descricao: 'x', ler: 'M10', igual: 1 }] }),
    );
    expect(s.esperado[0]?.prazo_s).toBe(10);
  });

  it('rejeita sem id', () => {
    const completo = exemploCompleto() as Record<string, unknown>;
    delete completo.id;
    expect(() => parseScenario(completo)).toThrow();
  });

  it('rejeita esperado vazio quando automacao é auto', () => {
    expect(() => parseScenario(exemploCompleto({ esperado: [] }))).toThrow(/esperado/i);
  });

  it('aceita esperado vazio quando automacao é na, com justificativa', () => {
    const s = parseScenario(
      exemploCompleto({ automacao: 'na', justificativa_na: 'não aplicável nesta bancada', esperado: [] }),
    );
    expect(s.automacao).toBe('na');
  });

  it('rejeita operador desconhecido em esperado', () => {
    expect(() =>
      parseScenario(
        exemploCompleto({
          esperado: [{ descricao: 'x', ler: 'M10', operador_estranho: 1 }],
        }),
      ),
    ).toThrow();
  });

  it('rejeita esperado sem nenhum operador (igual/maior_que/menor_que)', () => {
    expect(() =>
      parseScenario(exemploCompleto({ esperado: [{ descricao: 'x', ler: 'M10' }] })),
    ).toThrow();
  });

  it('rejeita igual não inteiro (registros são inteiros)', () => {
    expect(() =>
      parseScenario(exemploCompleto({ esperado: [{ descricao: 'x', ler: 'D100', igual: 1.5 }] })),
    ).toThrow();
  });

  it('rejeita passo desconhecido em pre', () => {
    expect(() => parseScenario(exemploCompleto({ pre: [{ passo_mitico: true }] }))).toThrow();
  });

  it('rejeita falha com tipo inválido', () => {
    expect(() =>
      parseScenario(
        exemploCompleto({ falha: [{ falha: { id: 'f1', tipo: 'nao.existe', alvo: 'temp:0' } }] }),
      ),
    ).toThrow();
  });
});

describe('resolveEndereco', () => {
  const mapa = { NOME_SIMBOLO: 'D100' };

  it('resolve nome via mapa de símbolos', () => {
    expect(resolveEndereco('NOME_SIMBOLO', mapa)).toEqual({ area: 'D', addr: 100 });
  });

  it('resolve endereço direto sem precisar do mapa', () => {
    expect(resolveEndereco('M10', mapa)).toEqual({ area: 'M', addr: 10 });
  });

  it('erro em nome inexistente', () => {
    expect(() => resolveEndereco('NAO_EXISTE', mapa)).toThrow(/desconhecido/i);
  });
});

describe('loadScenarios', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function cenarioNa(id: string): unknown {
    return exemploCompleto({ id, automacao: 'na', justificativa_na: 'teste', esperado: [] });
  }

  it('lê dir/cenarios/*.json ordenado por grupo e número natural', () => {
    dir = mkdtempSync(join(tmpdir(), 'sim-erros-scenarios-'));
    const cenariosDir = join(dir, 'cenarios');
    mkdirSync(cenariosDir);
    const nomes = ['B-S1.json', 'A-S2.json', 'A-S10.json', 'A-S1.json'];
    for (const nome of nomes) {
      const id = nome.replace('.json', '');
      writeFileSync(join(cenariosDir, nome), JSON.stringify(cenarioNa(id)), 'utf8');
    }
    const scenarios = loadScenarios(dir);
    expect(scenarios.map((s) => s.id)).toEqual(['A-S1', 'A-S2', 'A-S10', 'B-S1']);
  });
});
