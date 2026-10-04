import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Fault } from '../faults/types.js';
import type { DoorFaults, DoorSide } from '../bridge/delta-plc.js';
import { resolveEndereco, type Esperado, type Passo, type Scenario } from './scenario.js';

/** O que o executor precisa do bridge (DeltaPlcBridge satisfaz). */
export interface PlcIo {
  readPlc(area: 'M' | 'D', addr: number, n: number): Promise<(number | boolean)[]>;
  writePlc(area: 'M' | 'D', addr: number, values: (number | boolean)[]): Promise<void>;
  setFaults(side: DoorSide, f: Partial<DoorFaults>): void;
}
export interface FaultsIo {
  set(f: Fault): void;
  clearAll(): void;
}
export interface Pacote {
  registrar_padrao?: string[];
  /** campos: nome do campo da receita → endereço/símbolo. bit_carga pulsa; bit_ok (opcional) = CLP aceitou. */
  receita?: { campos: Record<string, string>; bit_carga: string; bit_ok?: string };
  /** Endereço/símbolo do bit de partida do ciclo. */
  iniciar?: string;
  /** Aborto antecipado: nos `esperar` de pre/falha, se `ler` == `igual` encerra o cenário em ERRO
   *  (sem esperar o max_s). `motivo` (opcional) é lido e anexado à mensagem. */
  guarda?: { ler: string; igual: number; descricao: string; motivo?: string };
  /** Espera antes da foto da IHM, s (padrão 3): a IHM leva um tempo para trocar de tela. */
  foto_atraso_s?: number;
}
export interface ExecutorDeps {
  bridge: PlcIo;
  faults: FaultsIo;
  mapa: Record<string, string>;
  capturar: (arquivo: string) => Promise<{ ok: true } | { ok: false; erro: string }>;
  snapshot?: () => unknown;
  /** ms */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Pasta da execução (fotos/, snapshots/, setup-pendente.json). */
  outDir: string;
  pacote?: Pacote;
}

export type Veredito = 'PASSOU' | 'FALHOU' | 'ERRO' | 'NAO_APLICAVEL' | 'PARADO';
export type EstadoExecutor = 'OCIOSO' | 'RODANDO' | 'AGUARDANDO_OPERADOR' | 'PARANDO';

export interface ResultadoEsperado {
  descricao: string;
  esperado: string;
  obtido: number | null;
  ok: boolean;
}
export interface ResultadoCenario {
  id: string;
  titulo: string;
  origem: string;
  automacao: Scenario['automacao'];
  veredito: Veredito;
  esperados: ResultadoEsperado[];
  registrados: Record<string, number | null>;
  /** Caminhos relativos a outDir; null = sem captura. */
  foto: string | null;
  snapshot: string | null;
  duracao_s: number;
  /** Cópia do setup temporário do cenário (nomes como no cenário), pro laudo. */
  setup_temporario: Record<string, number>;
  erro?: string;
  /** ERRO porque a guarda do pacote disparou (ciclo abortou antes do previsto). */
  interrompido_por_guarda?: true;
  nota?: string;
  justificativa_na?: string;
}

export type Evento =
  | { tipo: 'inicio_cenario'; id: string; titulo: string }
  | { tipo: 'passo'; id: string; descricao: string }
  | { tipo: 'aguardando_operador'; id: string; instrucao: string }
  | { tipo: 'resultado'; resultado: ResultadoCenario }
  | { tipo: 'fim' };

const POLL_MS = 250;
const POWER_CUT_MAX_S = 60;
const BIT_OK_MAX_S = 10;
/** Nas esperas por polling (passo "esperar" e verificação dos "esperado"), uma queda do CLP não
 *  aborta na hora: loga e tenta de novo até o prazo do passo. Só vira ERRO se o CLP ficar
 *  inacessível por mais tempo que isso seguido (não se aplica ao power.cut, que tem sua própria
 *  espera em cicloEnergia/POWER_CUT_MAX_S — lá a queda é esperada). */
const QUEDA_MAX_S = 30;
const SETUP_PENDENTE = 'setup-pendente.json';
const SEM_FALHAS: DoorFaults = {
  obstaculo: null,
  fc_aberta: null,
  fc_fechada: null,
  vazamento: false,
  pistao_lento: false,
};

class Parado extends Error {}
class GuardaDisparou extends Error {}

function area(nome: string, mapa: Record<string, string>): { area: 'M' | 'D'; addr: number } {
  const r = resolveEndereco(nome, mapa);
  if (r.area !== 'M' && r.area !== 'D') throw new Error(`área não suportada: ${nome}`);
  return { area: r.area, addr: r.addr };
}
async function ler(bridge: PlcIo, mapa: Record<string, string>, nome: string): Promise<number> {
  const e = area(nome, mapa);
  const [v] = await bridge.readPlc(e.area, e.addr, 1);
  return Number(v);
}
async function escrever(bridge: PlcIo, mapa: Record<string, string>, nome: string, v: number): Promise<void> {
  const e = area(nome, mapa);
  await bridge.writePlc(e.area, e.addr, [e.area === 'M' ? v !== 0 : v]);
}

/** Servidor caiu no meio de um cenário: restaura o setup original gravado e apaga o arquivo.
 *  Retorna se havia setup pendente. */
export async function restaurarSetupPendente(
  outDir: string,
  bridge: PlcIo,
  mapa: Record<string, string>,
): Promise<boolean> {
  const f = join(outDir, SETUP_PENDENTE);
  if (!existsSync(f)) return false;
  const orig = JSON.parse(readFileSync(f, 'utf8')) as Record<string, number>;
  for (const [nome, v] of Object.entries(orig)) await escrever(bridge, mapa, nome, v);
  rmSync(f);
  return true;
}

function descreverEsperado(e: Esperado): string {
  const p: string[] = [];
  if (e.igual !== undefined) p.push(`= ${e.igual}`);
  if (e.maior_que !== undefined) p.push(`> ${e.maior_que}`);
  if (e.menor_que !== undefined) p.push(`< ${e.menor_que}`);
  return `${e.ler} ${p.join(' e ')}`;
}
function confere(e: Esperado, v: number): boolean {
  return (
    (e.igual === undefined || v === e.igual) &&
    (e.maior_que === undefined || v > e.maior_que) &&
    (e.menor_que === undefined || v < e.menor_que)
  );
}

export class Executor {
  estado: EstadoExecutor = 'OCIOSO';
  /** Instrução do passo manual em curso (estado AGUARDANDO_OPERADOR). */
  instrucao: string | null = null;
  private pararPedido = false;
  /** Durante a limpeza, checar() não interrompe (parar() só libera espera manual). */
  private emLimpeza = false;
  /** Setup pendente não restaurou: interrompe a execução (não dá pra rodar sobre setup sujo). */
  private interromper = false;
  private liberar: (() => void) | null = null;
  /** Passo de pre/falha em curso (1-based) — só então a guarda do pacote vale. */
  private passoGuardado: { n: number; p: Passo } | null = null;
  /** União dos valores originais lidos antes de cada setup temporário (1ª leitura de cada nome
   *  vale: é o setup real da máquina). Vai pro laudo como setup_inicial. */
  setupInicial: Record<string, number> = {};

  constructor(private readonly d: ExecutorDeps) {}

  /** Interrompe no próximo ponto de espera; limpeza roda; restantes não rodam. */
  parar(): void {
    this.pararPedido = true;
    if (this.estado === 'RODANDO') this.estado = 'PARANDO';
    this.liberar?.();
  }
  /** Libera um passo `manual`. */
  continuar(): void {
    this.liberar?.();
  }

  /** Roda os cenários em ordem; cada evento vai pro callback (SSE). Para no primeiro PARADO. */
  async executar(cenarios: Scenario[], emit: (e: Evento) => void = () => {}): Promise<ResultadoCenario[]> {
    // ponytail: um parar() chamado antes de executar() se perde aqui (zerado). Aceito: a UI só
    // mostra "parar" com execução em curso.
    this.pararPedido = false;
    this.interromper = false;
    this.setupInicial = {};
    this.estado = 'RODANDO';
    const out: ResultadoCenario[] = [];
    try {
      for (const c of cenarios) {
        if (this.pararPedido) break;
        emit({ tipo: 'inicio_cenario', id: c.id, titulo: c.titulo });
        const r = await this.rodar(c, emit);
        out.push(r);
        emit({ tipo: 'resultado', resultado: r });
        if (r.veredito === 'PARADO' || this.interromper) break;
      }
    } finally {
      this.estado = 'OCIOSO';
      this.instrucao = null;
      emit({ tipo: 'fim' });
    }
    return out;
  }

  private checar(): void {
    if (this.pararPedido && !this.emLimpeza) throw new Parado('parado pelo operador');
  }
  private async dormir(ms: number): Promise<void> {
    this.checar();
    await this.d.sleep(ms);
    this.checar();
  }

  private async rodar(c: Scenario, emit: (e: Evento) => void): Promise<ResultadoCenario> {
    const t0 = this.d.now();
    const r: ResultadoCenario = {
      id: c.id,
      titulo: c.titulo,
      origem: c.origem,
      automacao: c.automacao,
      veredito: 'NAO_APLICAVEL',
      esperados: [],
      registrados: {},
      foto: null,
      snapshot: null,
      duracao_s: 0,
      setup_temporario: { ...c.setup_temporario },
      ...(c.nota !== undefined && { nota: c.nota }),
      ...(c.justificativa_na !== undefined && { justificativa_na: c.justificativa_na }),
    };
    if (c.automacao === 'na') return r;

    const { bridge, mapa, outDir } = this.d;
    // Setup pendente de um cenário anterior (restauração falhou ou servidor caiu): restaura antes,
    // senão os "originais" gravados abaixo seriam os valores temporários e o setup real se perderia.
    try {
      await restaurarSetupPendente(outDir, bridge, mapa);
    } catch (err) {
      this.interromper = true;
      r.veredito = 'ERRO';
      r.erro = `setup pendente não restaurado (${(err as Error).message}); execução interrompida`;
      r.duracao_s = (this.d.now() - t0) / 1000;
      return r;
    }
    try {
      mkdirSync(outDir, { recursive: true });
      // 1. setup temporário: grava originais antes de escrever (recuperação se o servidor cair)
      const orig: Record<string, number> = {};
      for (const nome of Object.keys(c.setup_temporario)) orig[nome] = await ler(bridge, mapa, nome);
      this.setupInicial = { ...orig, ...this.setupInicial };
      if (Object.keys(orig).length) writeFileSync(join(outDir, SETUP_PENDENTE), JSON.stringify(orig));
      for (const [nome, v] of Object.entries(c.setup_temporario)) await escrever(bridge, mapa, nome, v);
      // 2-3. pre e falha
      // A guarda só arma depois do iniciar_ciclo deste cenário: antes disso (preparo) o CLP pode
      // estar legitimamente na fase de fim do ciclo anterior, esperando o FECHAR.
      let armada = false;
      for (const [i, p] of [...c.pre, ...c.falha].entries()) {
        this.passoGuardado = armada ? { n: i + 1, p } : null;
        await this.passo(c.id, p, emit);
        if ('iniciar_ciclo' in p) armada = true;
      }
      this.passoGuardado = null;
      // 4. esperados
      for (const e of c.esperado) r.esperados.push(await this.esperar(e, emit, c.id));
      r.veredito = r.esperados.every((e) => e.ok) ? 'PASSOU' : 'FALHOU';
    } catch (err) {
      r.veredito = err instanceof Parado ? 'PARADO' : 'ERRO';
      r.erro = (err as Error).message;
      if (err instanceof GuardaDisparou) r.interrompido_por_guarda = true;
    } finally {
      this.passoGuardado = null;
      // 5. evidências: mesmo em ERRO (ou FALHOU) tenta registrar — se o CLP ainda/já estiver fora,
      // cada captura falha isolada (try/catch próprio) e vira null, sem mudar veredito/erro.
      if (r.veredito !== 'PARADO') await this.capturarEvidencias(c, r, outDir);
      // 6. limpeza: sempre, e um erro aqui não pula o resto da limpeza.
      const falhas: string[] = [];
      const tentar = async (f: () => unknown): Promise<void> => {
        try {
          await f();
        } catch (e) {
          falhas.push((e as Error).message);
        }
      };
      // Falha e portas sem falha primeiro: senão um passo de limpeza do cenário que espera o CLP
      // ocioso (ex. "esperar X=0") nunca completa com a falha do cenário ainda ativa.
      await tentar(() => this.d.faults.clearAll());
      for (const s of ['C', 'D'] as const) await tentar(() => bridge.setFaults(s, { ...SEM_FALHAS }));
      this.emLimpeza = true; // a limpeza do cenário não pode ser interrompida pelo parar()
      for (const p of c.limpeza) await tentar(() => this.passo(c.id, p, emit));
      this.emLimpeza = false;
      // power.cut interrompido: o CLP pode estar fora; espera voltar antes de restaurar.
      const fimVivo = this.d.now() + POWER_CUT_MAX_S * 1000;
      while (!(await this.vivo()) && this.d.now() < fimVivo) await this.d.sleep(POLL_MS);
      await tentar(() => restaurarSetupPendente(outDir, bridge, mapa));
      if (falhas.length) {
        if (r.veredito !== 'PARADO') r.veredito = 'ERRO';
        r.erro = [r.erro, `limpeza: ${falhas.join('; ')}`].filter(Boolean).join(' | ');
      }
      r.duracao_s = (this.d.now() - t0) / 1000;
    }
    return r;
  }

  /** Foto da IHM, snapshot e leitura dos `registrar`: evidências do laudo. Chamado mesmo quando o
   *  cenário deu ERRO/FALHOU (antes da limpeza) — cada captura tem seu próprio try/catch, então se
   *  o CLP ainda estiver fora só aquele campo fica null, sem mudar veredito/erro do cenário. */
  private async capturarEvidencias(c: Scenario, r: ResultadoCenario, outDir: string): Promise<void> {
    try {
      await this.d.sleep((this.d.pacote?.foto_atraso_s ?? 3) * 1000);
      mkdirSync(join(outDir, 'fotos'), { recursive: true });
      const foto = join('fotos', `${c.id}.png`);
      r.foto = (await this.d.capturar(join(outDir, foto))).ok ? foto : null;
    } catch {
      r.foto = null;
    }
    if (this.d.snapshot) {
      try {
        mkdirSync(join(outDir, 'snapshots'), { recursive: true });
        const snap = join('snapshots', `${c.id}.json`);
        writeFileSync(join(outDir, snap), JSON.stringify(this.d.snapshot(), null, 2));
        r.snapshot = snap;
      } catch {
        // evidência opcional: falha não muda o veredito
      }
    }
    const { bridge, mapa } = this.d;
    for (const nome of [...(this.d.pacote?.registrar_padrao ?? []), ...c.registrar]) {
      try {
        r.registrados[nome] = await ler(bridge, mapa, nome);
      } catch {
        r.registrados[nome] = null;
      }
    }
  }

  /** Lê os endereços tolerando falha de leitura: loga via emit e devolve null (chamador tenta de
   *  novo); só lança se o CLP ficar inacessível por mais de QUEDA_MAX_S s seguidos (zerado por
   *  qualquer leitura bem-sucedida). */
  private async lerTolerante(
    nomes: string[],
    emit: (e: Evento) => void,
    id: string,
    queda: { desde: number | null },
  ): Promise<Record<string, number> | null> {
    try {
      const valores: Record<string, number> = {};
      for (const nome of nomes) valores[nome] = await ler(this.d.bridge, this.d.mapa, nome);
      queda.desde = null;
      return valores;
    } catch (err) {
      const msg = (err as Error).message;
      if (queda.desde === null) queda.desde = this.d.now();
      emit({ tipo: 'passo', id, descricao: `leitura falhou, tentando de novo: ${msg}` });
      if (this.d.now() - queda.desde >= QUEDA_MAX_S * 1000) {
        throw new Error(`CLP inacessível por mais de ${QUEDA_MAX_S} s: ${msg}`);
      }
      return null;
    }
  }

  private async esperar(e: Esperado, emit: (ev: Evento) => void, id: string): Promise<ResultadoEsperado> {
    const fim = this.d.now() + e.prazo_s * 1000;
    const queda = { desde: null as number | null };
    let obtido: number | null = null;
    for (;;) {
      const vals = await this.lerTolerante([e.ler], emit, id, queda);
      if (vals) {
        obtido = vals[e.ler]!;
        const ok = confere(e, obtido);
        if (ok || this.d.now() >= fim) return { descricao: e.descricao, esperado: descreverEsperado(e), obtido, ok };
      } else if (this.d.now() >= fim) {
        return { descricao: e.descricao, esperado: descreverEsperado(e), obtido, ok: false };
      }
      await this.dormir(POLL_MS);
    }
  }

  private async passo(id: string, p: Passo, emit: (e: Evento) => void): Promise<void> {
    const { bridge, mapa, pacote } = this.d;
    this.checar();
    emit({ tipo: 'passo', id, descricao: JSON.stringify(p) });
    if ('carregar_receita' in p) {
      const rc = pacote?.receita;
      if (!rc) throw new Error('pacote sem "receita": carregar_receita indisponível');
      // bit_ok pode estar 1 de uma carga anterior: zera antes de escrever, senão o pulso de carga
      // solta e o executor lê a confirmação velha, achando que o CLP já processou esta carga.
      if (rc.bit_ok) await escrever(bridge, mapa, rc.bit_ok, 0);
      for (const [campo, v] of Object.entries(p.carregar_receita.campos)) {
        const end = rc.campos[campo];
        if (!end) throw new Error(`campo de receita sem endereço no pacote: ${campo}`);
        await escrever(bridge, mapa, end, v);
      }
      await escrever(bridge, mapa, rc.bit_carga, 1);
      if (rc.bit_ok) {
        await this.aguardar({ [rc.bit_ok]: 1 }, BIT_OK_MAX_S, emit, id);
      } else {
        // sem bit_ok: só confirmação possível é o próprio CLP zerar bit_carga ao processar.
        const fim = this.d.now() + BIT_OK_MAX_S * 1000;
        while ((await ler(bridge, mapa, rc.bit_carga)) !== 0 && this.d.now() < fim) await this.dormir(POLL_MS);
      }
      if ((await ler(bridge, mapa, rc.bit_carga)) !== 0) await escrever(bridge, mapa, rc.bit_carga, 0);
    } else if ('iniciar_ciclo' in p) {
      if (!pacote?.iniciar) throw new Error('pacote sem "iniciar": iniciar_ciclo indisponível');
      await escrever(bridge, mapa, pacote.iniciar, 1);
    } else if ('esperar' in p) {
      await this.aguardar(p.esperar, p.max_s, emit, id);
    } else if ('aguardar_s' in p) {
      const fim = this.d.now() + p.aguardar_s * 1000;
      while (this.d.now() < fim) await this.dormir(Math.min(POLL_MS, fim - this.d.now()));
    } else if ('escrever' in p) {
      for (const [nome, v] of Object.entries(p.escrever)) await escrever(bridge, mapa, nome, v);
    } else if ('falha' in p) {
      this.d.faults.set(p.falha as Fault);
      if (p.falha.tipo === 'power.cut') await this.cicloEnergia();
    } else if ('porta' in p) {
      bridge.setFaults(p.porta.lado, p.porta.falhas as Partial<DoorFaults>);
    } else if ('manual' in p) {
      this.estado = 'AGUARDANDO_OPERADOR';
      this.instrucao = p.manual;
      emit({ tipo: 'aguardando_operador', id, instrucao: p.manual });
      await new Promise<void>((res) => (this.liberar = res));
      this.liberar = null;
      this.instrucao = null;
      this.estado = this.pararPedido ? 'PARANDO' : 'RODANDO';
      this.checar();
    }
  }

  private async aguardar(
    alvo: Record<string, number>,
    max_s: number,
    emit: (ev: Evento) => void,
    id: string,
  ): Promise<void> {
    const fim = this.d.now() + max_s * 1000;
    const queda = { desde: null as number | null };
    const g = this.d.pacote?.guarda;
    // guarda só nos "esperar" de pre/falha, e não quando o passo espera a própria condição dela
    const pg = this.passoGuardado;
    const guardar = g && pg && 'esperar' in pg.p && pg.p.esperar === alvo && alvo[g.ler] !== g.igual;
    const nomes = guardar ? [...new Set([...Object.keys(alvo), g.ler])] : Object.keys(alvo);
    for (;;) {
      const vals = await this.lerTolerante(nomes, emit, id, queda);
      if (vals && Object.entries(alvo).every(([nome, v]) => vals[nome] === v)) return;
      if (guardar && vals && vals[g.ler] === g.igual) {
        let msg = `${g.descricao} antes do previsto, no passo ${pg.n} (${JSON.stringify(pg.p)})`;
        if (g.motivo) {
          let m: number | string = '?';
          try {
            m = await ler(this.d.bridge, this.d.mapa, g.motivo);
          } catch {
            // motivo é só informativo
          }
          msg += `; ${g.motivo} = ${m}`;
        }
        throw new GuardaDisparou(msg);
      }
      if (this.d.now() >= fim) throw new Error(`timeout (${max_s} s) esperando ${JSON.stringify(alvo)}`);
      await this.dormir(POLL_MS);
    }
  }

  private async vivo(): Promise<boolean> {
    try {
      await this.d.bridge.readPlc('D', 0, 1);
      return true;
    } catch {
      return false;
    }
  }

  /** power.cut: espera o CLP cair (readPlc lança) e voltar, até POWER_CUT_MAX_S. */
  private async cicloEnergia(): Promise<void> {
    const fim = this.d.now() + POWER_CUT_MAX_S * 1000;
    for (const queroVivo of [false, true]) {
      while ((await this.vivo()) !== queroVivo) {
        if (this.d.now() >= fim) {
          throw new Error(`power.cut: CLP não ${queroVivo ? 'voltou' : 'caiu'} em ${POWER_CUT_MAX_S} s`);
        }
        await this.dormir(POLL_MS);
      }
    }
  }
}
