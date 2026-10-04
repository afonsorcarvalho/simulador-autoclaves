import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Executor, restaurarSetupPendente, type Evento, type ExecutorDeps, type PlcIo } from '../../server/erros/executor.js';
import { gravarResultado, logLinha, novaPastaExecucao } from '../../server/erros/results.js';
import { parseScenario } from '../../server/erros/scenario.js';
import { FaultEngine } from '../../server/faults/engine.js';

/** CLP falso mínimo: M/D em arrays; `tick` roda a cada sleep (lógica do "CLP"). */
class FakeIo implements PlcIo {
  m = new Array<boolean>(100).fill(true);
  d = new Array<number>(600).fill(0);
  down = false;
  portas: Record<string, unknown> = {};
  acessos = 0;
  async readPlc(area: 'M' | 'D', addr: number, n: number) {
    this.acessos++;
    if (this.down) throw new Error('offline');
    return area === 'M' ? this.m.slice(addr, addr + n) : this.d.slice(addr, addr + n);
  }
  async writePlc(area: 'M' | 'D', addr: number, v: (number | boolean)[]) {
    this.acessos++;
    if (this.down) throw new Error('offline');
    v.forEach((x, i) => (area === 'M' ? (this.m[addr + i] = Boolean(x)) : (this.d[addr + i] = Number(x))));
  }
  setFaults(side: 'C' | 'D', f: unknown) {
    this.portas[side] = f;
  }
}

function montar(tick: (io: FakeIo, faults: FaultEngine) => void = () => {}, over: Partial<ExecutorDeps> = {}) {
  const io = new FakeIo();
  const faults = new FaultEngine();
  const outDir = mkdtempSync(join(tmpdir(), 'exec-'));
  let t = 0;
  const fotos: string[] = [];
  const ex = new Executor({
    bridge: io,
    faults,
    mapa: { ENTRADA_X: 'M5' },
    capturar: async (f) => {
      fotos.push(f);
      writeFileSync(f, 'png');
      return { ok: true };
    },
    snapshot: () => ({ t }),
    now: () => t,
    sleep: async (ms) => {
      t += ms;
      tick(io, faults);
    },
    outDir,
    ...over,
  });
  return { io, faults, outDir, ex, fotos, tempo: () => t };
}

const base = (extra: Record<string, unknown>) =>
  parseScenario({
    id: 'S1',
    titulo: 'teste',
    origem: 'x',
    automacao: 'auto',
    esperado: [{ descricao: 'fase 11', ler: 'D100', igual: 11, prazo_s: 5 }],
    ...extra,
  });

describe('Executor', () => {
  it('pre + falha + esperado → PASSOU com obtido, foto e snapshot', async () => {
    const { ex, io, outDir } = montar((io, f) => {
      if (f.has('digital.force', 'IN_EMERG_OK') && io.d[100] === 6) io.d[100] = 11;
    });
    const c = base({
      pre: [{ escrever: { D100: 6 } }],
      falha: [{ falha: { id: 'f1', tipo: 'digital.force', alvo: 'IN_EMERG_OK', valor: 0 } }],
      registrar: ['ENTRADA_X'],
    });
    const [r] = await ex.executar([c]);
    expect(r!.veredito).toBe('PASSOU');
    expect(r!.esperados[0]).toMatchObject({ obtido: 11, ok: true });
    expect(r!.registrados).toEqual({ ENTRADA_X: 1 });
    expect(existsSync(join(outDir, r!.foto!))).toBe(true);
    expect(JSON.parse(readFileSync(join(outDir, r!.snapshot!), 'utf8'))).toHaveProperty('t');
    expect(io.portas.C).toMatchObject({ obstaculo: null });
  });

  it('guarda: ciclo aborta durante esperar fase 7 → ERRO na hora, com motivo', async () => {
    const pacote = { iniciar: 'M20', guarda: { ler: 'D100', igual: 11, descricao: 'ciclo abortou', motivo: 'D101' } };
    const { ex, tempo } = montar((io) => {
      io.d[100] = 11;
      io.d[101] = 3;
    }, { pacote });
    const c = base({
      pre: [{ escrever: { D100: 6 } }, { iniciar_ciclo: true }, { esperar: { D100: 7 }, max_s: 1500 }],
      registrar: ['ENTRADA_X'],
    });
    const [r] = await ex.executar([c]);
    expect(r!.veredito).toBe('ERRO');
    expect(r!.interrompido_por_guarda).toBe(true);
    expect(r!.erro).toBe('ciclo abortou antes do previsto, no passo 3 ({"esperar":{"D100":7},"max_s":1500}); D101 = 3');
    expect(r!.registrados).toEqual({ ENTRADA_X: 1 });
    expect(r!.foto).not.toBeNull();
    expect(tempo()).toBeLessThan(5000);
  });

  it('guarda: no preparo (antes do iniciar_ciclo) não dispara — fim do ciclo anterior', async () => {
    const pacote = { guarda: { ler: 'D100', igual: 11, descricao: 'ciclo abortou' } };
    const { ex } = montar((io) => {
      io.d[100] = 11;
    }, { pacote });
    const [r] = await ex.executar([base({ pre: [{ esperar: { D101: 0 }, max_s: 10 }] })]);
    expect(r!.interrompido_por_guarda).toBeUndefined();
  });

  it('guarda: esperar a própria condição da guarda não dispara', async () => {
    const pacote = { guarda: { ler: 'D100', igual: 11, descricao: 'ciclo abortou' } };
    const { ex } = montar((io) => {
      io.d[100] = 11;
    }, { pacote });
    const [r] = await ex.executar([base({ pre: [{ esperar: { D100: 11 }, max_s: 10 }] })]);
    expect(r!.veredito).toBe('PASSOU');
    expect(r!.interrompido_por_guarda).toBeUndefined();
  });

  it('prazo estoura → FALHOU com último valor', async () => {
    const { ex, tempo } = montar();
    const [r] = await ex.executar([base({ pre: [{ escrever: { D100: 7 } }] })]);
    expect(r!.veredito).toBe('FALHOU');
    expect(r!.esperados[0]).toMatchObject({ obtido: 7, ok: false });
    expect(tempo()).toBeGreaterThanOrEqual(5000);
  });

  it('setup_temporario: escreve, grava pendente, restaura no fim', async () => {
    let durante: number | null = null;
    let pendente = false;
    const h = montar((io) => {
      durante = io.d[200]!;
      pendente = existsSync(join(h.outDir, 'setup-pendente.json'));
      io.d[100] = 11;
    });
    h.io.d[200] = 50;
    const [r] = await h.ex.executar([base({ setup_temporario: { D200: 5 } })]);
    expect(r!.veredito).toBe('PASSOU');
    expect(durante).toBe(5);
    expect(pendente).toBe(true);
    expect(h.io.d[200]).toBe(50);
    expect(existsSync(join(h.outDir, 'setup-pendente.json'))).toBe(false);
    // laudo: cenário carrega o setup temporário; executor expõe os originais lidos
    expect(r!.setup_temporario).toEqual({ D200: 5 });
    expect(h.ex.setupInicial).toEqual({ D200: 50 });
  });

  it('exceção no meio → ERRO, setup restaurado, falhas limpas', async () => {
    const h = montar();
    h.io.d[200] = 50;
    const orig = h.io.readPlc.bind(h.io);
    let n = 0;
    // n=1: leitura do setup temporário (fora do retry tolerante do "esperar"), falha de vez.
    h.io.readPlc = async (a, ad, k) => {
      if (++n === 1) throw new Error('modbus caiu');
      return orig(a, ad, k);
    };
    const c = base({
      setup_temporario: { D200: 5 },
      falha: [{ falha: { id: 'f1', tipo: 'digital.force', alvo: 'IN_EMERG_OK', valor: 0 } }],
    });
    const [r] = await h.ex.executar([c]);
    expect(r!.veredito).toBe('ERRO');
    expect(r!.erro).toContain('modbus caiu');
    expect(h.io.d[200]).toBe(50);
    expect(h.faults.list()).toEqual([]);
  });

  it('na → NAO_APLICAVEL sem tocar no CLP', async () => {
    const h = montar();
    const c = parseScenario({ id: 'N', titulo: 't', origem: 'o', automacao: 'na', justificativa_na: 'sem hw' });
    const [r] = await h.ex.executar([c]);
    expect(r).toMatchObject({ veredito: 'NAO_APLICAVEL', justificativa_na: 'sem hw' });
    expect(h.io.acessos).toBe(0);
  });

  it('manual → AGUARDANDO_OPERADOR; continuar() segue', async () => {
    const h = montar((io) => (io.d[100] = 11));
    const evs: Evento[] = [];
    const p = h.ex.executar([base({ automacao: 'manual', pre: [{ manual: 'abra a porta' }] })], (e) => {
      evs.push(e);
      if (e.tipo === 'aguardando_operador') {
        expect(h.ex.estado).toBe('AGUARDANDO_OPERADOR');
        expect(h.ex.instrucao).toBe('abra a porta');
        setTimeout(() => h.ex.continuar(), 0);
      }
    });
    const [r] = await p;
    expect(evs.some((e) => e.tipo === 'aguardando_operador' && e.instrucao === 'abra a porta')).toBe(true);
    expect(r!.veredito).toBe('PASSOU');
  });

  it('parar() → PARADO, limpeza roda, restantes não rodam', async () => {
    let ex!: Executor;
    const h = montar((_io, _f) => ex.parar());
    ex = h.ex;
    h.io.d[200] = 50;
    const c = base({
      setup_temporario: { D200: 5 },
      falha: [{ falha: { id: 'f1', tipo: 'digital.force', alvo: 'IN_EMERG_OK', valor: 0 } }],
    });
    const rs = await ex.executar([c, { ...c, id: 'S2' }]);
    expect(rs.map((r) => r.veredito)).toEqual(['PARADO']);
    expect(h.faults.list()).toEqual([]);
    expect(h.io.d[200]).toBe(50);
    expect(ex.estado).toBe('OCIOSO');
  });

  it('restaurarSetupPendente', async () => {
    const h = montar();
    expect(await restaurarSetupPendente(h.outDir, h.io, {})).toBe(false);
    writeFileSync(join(h.outDir, 'setup-pendente.json'), JSON.stringify({ D200: 50 }));
    expect(await restaurarSetupPendente(h.outDir, h.io, {})).toBe(true);
    expect(h.io.d[200]).toBe(50);
    expect(existsSync(join(h.outDir, 'setup-pendente.json'))).toBe(false);
  });

  it('power.cut espera o CLP cair e voltar', async () => {
    let k = 0;
    const h = montar((io) => {
      k++;
      io.down = k >= 2 && k < 4;
      io.d[100] = 11;
    });
    const [r] = await h.ex.executar([base({ falha: [{ falha: { id: 'p', tipo: 'power.cut', alvo: '' } }] })]);
    expect(r!.veredito).toBe('PASSOU');
    expect(k).toBeGreaterThanOrEqual(4);
  });

  it('setup pendente de antes é restaurado antes do cenário', async () => {
    const h = montar((io) => (io.d[100] = 11));
    h.io.d[200] = 5; // valor temporário que ficou
    writeFileSync(join(h.outDir, 'setup-pendente.json'), JSON.stringify({ D200: 50 }));
    const [r] = await h.ex.executar([base({ setup_temporario: { D200: 5 } })]);
    expect(r!.veredito).toBe('PASSOU');
    expect(h.io.d[200]).toBe(50);
  });

  it('setup pendente que não restaura → ERRO, nada escrito, execução interrompida', async () => {
    const h = montar((io) => (io.d[100] = 11));
    const f = join(h.outDir, 'setup-pendente.json');
    writeFileSync(f, JSON.stringify({ X9: 50 }));
    const c = base({ setup_temporario: { D200: 5 } });
    const rs = await h.ex.executar([c, { ...c, id: 'S2' }]);
    expect(rs.map((r) => r.veredito)).toEqual(['ERRO']);
    expect(h.io.d[200]).toBe(0);
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ X9: 50 });
  });

  it('parar() com CLP fora no power.cut: limpeza espera voltar e restaura', async () => {
    let k = 0;
    let ex!: Executor;
    const h = montar((io) => {
      k++;
      io.down = k >= 2 && k < 8;
      if (k === 3) ex.parar();
    });
    ex = h.ex;
    h.io.d[200] = 50;
    const c = base({ setup_temporario: { D200: 5 }, falha: [{ falha: { id: 'p', tipo: 'power.cut', alvo: '' } }] });
    const [r] = await ex.executar([c]);
    expect(r!.veredito).toBe('PARADO');
    expect(r!.erro).not.toContain('limpeza');
    expect(h.io.d[200]).toBe(50);
  });

  it('parar() durante a limpeza não interrompe os passos', async () => {
    let ex!: Executor;
    const h = montar(() => ex.parar());
    ex = h.ex;
    const c = base({ limpeza: [{ aguardar_s: 1 }, { escrever: { D100: 9 } }] });
    const [r] = await ex.executar([c]);
    expect(r!.veredito).toBe('PARADO');
    expect(h.io.d[100]).toBe(9);
  });

  it('carregar_receita: bit_ok já 1 de carga anterior → espera a confirmação real, não a velha', async () => {
    let ciclos = 0;
    const h = montar(
      (io) => {
        io.d[100] = 11;
        // CLP falso: só confirma (D301=1) depois de 2 ciclos de sleep do executor.
        if (io.d[300] === 1) {
          ciclos++;
          if (ciclos >= 2) io.d[301] = 1;
        }
      },
      {
        pacote: {
          receita: { campos: { tempo: 'D302' }, bit_carga: 'D300', bit_ok: 'D301' },
        },
      },
    );
    h.io.d[301] = 1; // bit_ok "sujo" de uma carga anterior
    const c = base({ pre: [{ carregar_receita: { numero: 1, campos: { tempo: 42 } } }] });
    const [r] = await h.ex.executar([c]);
    expect(r!.veredito).toBe('PASSOU');
    expect(ciclos).toBeGreaterThanOrEqual(2);
    expect(h.io.d[302]).toBe(42);
    expect(h.io.d[300]).toBe(0); // pulso de carga foi zerado no fim
  });

  it('limpeza do cenário roda depois de faults.clearAll()/portas sem falha', async () => {
    const h = montar((io, f) => {
      io.d[100] = 11;
      if (!f.has('digital.force', 'IN_EMERG_OK')) io.d[400] = 0; // CLP só zera quando a falha some
    });
    h.io.d[400] = 1;
    const c = base({
      falha: [{ falha: { id: 'f1', tipo: 'digital.force', alvo: 'IN_EMERG_OK', valor: 0 } }],
      limpeza: [{ esperar: { D400: 0 }, max_s: 5 }],
    });
    const [r] = await h.ex.executar([c]);
    expect(r!.veredito).toBe('PASSOU');
    expect(r!.erro).toBeUndefined();
    expect(h.io.d[400]).toBe(0);
  });

  it('snapshot que falha não muda veredito; snapshot fica null', async () => {
    const h = montar((io) => (io.d[100] = 11), {
      snapshot: () => {
        throw new Error('boom');
      },
    });
    const [r] = await h.ex.executar([base({})]);
    expect(r!.veredito).toBe('PASSOU');
    expect(r!.snapshot).toBeNull();
  });

  it('leitura falha por alguns segundos (queda curta) e depois volta: PASSOU, com log da falha', async () => {
    const h = montar();
    h.io.d[100] = 11;
    let falhas = 0;
    const orig = h.io.readPlc.bind(h.io);
    h.io.readPlc = async (a, ad, n) => {
      if (h.tempo() < 10_000) {
        falhas++;
        throw new Error('timeout conectando');
      }
      return orig(a, ad, n);
    };
    const evs: Evento[] = [];
    const c = base({ esperado: [{ descricao: 'fase 11', ler: 'D100', igual: 11, prazo_s: 20 }] });
    const [r] = await h.ex.executar([c], (e) => evs.push(e));
    expect(r!.veredito).toBe('PASSOU');
    expect(r!.esperados[0]).toMatchObject({ obtido: 11, ok: true });
    expect(falhas).toBeGreaterThanOrEqual(3);
    expect(evs.some((e) => e.tipo === 'passo' && e.descricao.includes('leitura falhou'))).toBe(true);
  });

  it('leitura falha continuamente por mais de 30 s → ERRO com a mensagem', async () => {
    const h = montar();
    h.io.readPlc = async () => {
      throw new Error('timeout conectando');
    };
    const c = base({ esperado: [{ descricao: 'fase 11', ler: 'D100', igual: 11, prazo_s: 60 }] });
    const [r] = await h.ex.executar([c]);
    expect(r!.veredito).toBe('ERRO');
    expect(r!.erro).toContain('CLP inacessível por mais de 30 s');
    expect(r!.erro).toContain('timeout conectando');
  });

  it('cenário com ERRO ainda tenta foto, snapshot e registrar; preenchidos quando o CLP responde', async () => {
    const h = montar((io) => (io.d[100] = 11));
    let n = 0;
    const orig = h.io.readPlc.bind(h.io);
    // Só a leitura do setup temporário falha (fora do retry tolerante); o resto do CLP responde.
    h.io.readPlc = async (a, ad, k) => {
      if (++n === 1) throw new Error('modbus caiu');
      return orig(a, ad, k);
    };
    const c = base({ setup_temporario: { D200: 5 }, registrar: ['ENTRADA_X'] });
    const [r] = await h.ex.executar([c]);
    expect(r!.veredito).toBe('ERRO');
    expect(r!.erro).toContain('modbus caiu');
    expect(r!.foto).toBe(join('fotos', 'S1.png'));
    expect(existsSync(join(h.outDir, r!.foto!))).toBe(true);
    expect(r!.snapshot).not.toBeNull();
    expect(r!.registrados).toEqual({ ENTRADA_X: 1 });
  });
});

describe('results', () => {
  it('grava resultado.json e log.txt na pasta da execução', () => {
    const base = mkdtempSync(join(tmpdir(), 'res-'));
    const dir = novaPastaExecucao(base, new Date(2026, 9, 2, 14, 5, 7));
    expect(dir).toBe(join(base, 'execucoes', '2026-10-02_140507'));
    const r = {
      inicio: 'a',
      fim: 'b',
      programa: { commit_clp: 'abc' },
      setup_inicial: { D200: 50 },
      cenarios: [
        {
          id: 'S1', titulo: 't', origem: 'o', automacao: 'auto' as const, veredito: 'PASSOU' as const,
          esperados: [{ descricao: 'd', esperado: 'D100 = 11', obtido: 11, ok: true }],
          registrados: {}, foto: 'fotos/S1.png', snapshot: null, duracao_s: 1, setup_temporario: {},
        },
      ],
    };
    gravarResultado(dir, r);
    logLinha(dir, 'olá', new Date(2026, 9, 2, 14, 5, 9));
    expect(JSON.parse(readFileSync(join(dir, 'resultado.json'), 'utf8'))).toEqual(r);
    expect(readFileSync(join(dir, 'log.txt'), 'utf8')).toBe('14:05:09 olá\n');
  });

  it('novaPastaExecucao no mesmo segundo não colide: sufixo -2, -3', () => {
    const base = mkdtempSync(join(tmpdir(), 'res-'));
    const d = new Date(2026, 9, 2, 14, 5, 7);
    const nomes = [1, 2, 3].map(() => basename(novaPastaExecucao(base, d)));
    expect(nomes).toEqual(['2026-10-02_140507', '2026-10-02_140507-2', '2026-10-02_140507-3']);
    for (const n of nomes) expect(n).toMatch(/^[\w.-]+$/); // ainda aceito como `exec` na API
  });
});
