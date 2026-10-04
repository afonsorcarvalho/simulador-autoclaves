import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { getRuntime } from '../runtime/singleton.js';
import {
  loadConfig,
  saveConfig,
  publicConfig,
  defaultConfigPath,
  type ErrosConfig,
  type PublicErrosConfig,
} from './config.js';
import { loadScenarios, type Scenario } from './scenario.js';
import { capturarIhm } from './vnc.js';
import {
  Executor,
  restaurarSetupPendente,
  type Evento,
  type ResultadoCenario,
  type Pacote,
  type PlcIo,
  type EstadoExecutor,
} from './executor.js';
import { novaPastaExecucao, gravarResultado, logLinha } from './results.js';

/** Erro de serviço com status HTTP — routes só traduzem pra NextResponse. */
export class ErrosServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/** Mapeia qualquer erro do serviço pra {status, body}, pra toda rota devolver igual. */
export function erroParaResposta(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof ErrosServiceError) return { status: err.status, body: { error: err.message } };
  return { status: 500, body: { error: (err as Error).message ?? 'erro desconhecido' } };
}

export interface CenarioResumo {
  id: string;
  titulo: string;
  origem: string;
  automacao: Scenario['automacao'];
}

export interface StatusResposta {
  estado: EstadoExecutor;
  instrucao: string | null;
  resultadoParcial: ResultadoCenario[];
  /** Pastas de execução anterior cujo setup temporário foi restaurado ao iniciar o serviço
   *  (servidor caiu no meio de um cenário). Ausente se nada foi restaurado. */
  setupPendenteRestaurado?: string[];
  /** Nome da pasta (em pacoteDir/execucoes/) da execução atual/última; null se nenhuma. */
  exec: string | null;
}

/** Extensões servidas por /api/erros/arquivo e o content-type de cada uma. */
export const TIPOS_ARQUIVO: Record<string, string> = {
  '.png': 'image/png',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/markdown; charset=utf-8',
};

interface PacoteCarregado {
  cfg: ErrosConfig;
  cenarios: Scenario[];
  mapa: Record<string, string>;
  pacote?: Pacote;
}

function bridgeTemPlcIo(bridge: unknown): bridge is PlcIo {
  // Duck typing, nunca instanceof — ver nota em runtime/singleton.ts.
  const b = bridge as Partial<PlcIo> | null;
  return (
    typeof b?.readPlc === 'function' &&
    typeof b?.writePlc === 'function' &&
    typeof b?.setFaults === 'function'
  );
}

class ErrosServiceImpl {
  private executor: Executor | null = null;
  private resultadoAtual: ResultadoCenario[] = [];
  private ouvintes = new Set<(e: Evento) => void>();
  private restaurados: string[] = [];
  private execAtual: string | null = null;
  /** Restauração de setup pendente da inicialização; iniciar() espera por ela antes de rodar. */
  private readonly pronto: Promise<void>;

  constructor(private readonly configPath: string) {
    // Melhor esforço: se o servidor caiu no meio de um cenário numa execução anterior,
    // restaura o setup temporário original. Nunca bloqueia a criação do serviço.
    this.pronto = this.restaurarPendentes().catch((err) => {
      console.error('erros: falha ao restaurar setup pendente:', err);
    });
  }

  private async restaurarPendentes(): Promise<void> {
    const cfg = loadConfig(this.configPath);
    if (!cfg.pacoteDir || !existsSync(cfg.pacoteDir)) return;
    const bridge = getRuntime().bridge;
    if (!bridgeTemPlcIo(bridge)) return; // modo virtual: nada pra restaurar no CLP
    // No boot o bridge ainda está conectando: espera o CLP responder (até ~30 s).
    for (let i = 0; ; i++) {
      try {
        await bridge.readPlc('D', 0, 1);
        break;
      } catch (err) {
        if (i >= 60) throw err;
        await new Promise((res) => setTimeout(res, 500));
      }
    }
    const execDir = join(cfg.pacoteDir, 'execucoes');
    if (!existsSync(execDir)) return;
    const mapaPath = join(cfg.pacoteDir, 'MAPA_SIMBOLOS.json');
    const mapa = existsSync(mapaPath)
      ? (JSON.parse(readFileSync(mapaPath, 'utf8')) as Record<string, string>)
      : {};
    for (const nome of readdirSync(execDir)) {
      const dir = join(execDir, nome);
      if (await restaurarSetupPendente(dir, bridge, mapa)) this.restaurados.push(nome);
    }
  }

  getConfig(): PublicErrosConfig {
    return publicConfig(this.configPath);
  }

  /** Senha vazia ('') mantém a anterior — só substitui se vier não-vazia. */
  setConfig(patch: Partial<ErrosConfig>): PublicErrosConfig {
    const { vncSenha, ...resto } = patch;
    const aplicar: Partial<ErrosConfig> = vncSenha ? { ...resto, vncSenha } : resto;
    saveConfig(aplicar, this.configPath);
    return publicConfig(this.configPath);
  }

  private carregarPacote(): PacoteCarregado {
    const cfg = loadConfig(this.configPath);
    if (!cfg.pacoteDir || !existsSync(cfg.pacoteDir)) {
      throw new ErrosServiceError('pacote de cenários não configurado', 409);
    }
    const cenarios = loadScenarios(cfg.pacoteDir);
    const mapaPath = join(cfg.pacoteDir, 'MAPA_SIMBOLOS.json');
    const mapa = existsSync(mapaPath)
      ? (JSON.parse(readFileSync(mapaPath, 'utf8')) as Record<string, string>)
      : {};
    const pacotePath = join(cfg.pacoteDir, 'pacote.json');
    const pacote = existsSync(pacotePath)
      ? (JSON.parse(readFileSync(pacotePath, 'utf8')) as Pacote)
      : undefined;
    return { cfg, cenarios, mapa, ...(pacote && { pacote }) };
  }

  listarCenarios(): CenarioResumo[] {
    const { cenarios } = this.carregarPacote();
    return cenarios.map((c) => ({ id: c.id, titulo: c.titulo, origem: c.origem, automacao: c.automacao }));
  }

  /** Dispara a execução em background e devolve assim que ela começou (não espera terminar). */
  iniciar(ids?: string[]): void {
    if (this.executor && this.executor.estado !== 'OCIOSO') {
      throw new ErrosServiceError('já existe uma execução em andamento', 409);
    }
    const rt = getRuntime();
    if (!bridgeTemPlcIo(rt.bridge)) {
      throw new ErrosServiceError('CLP real não conectado (modo virtual, sem readPlc)', 409);
    }
    const bridge = rt.bridge;
    const { cfg, cenarios: todos, mapa, pacote } = this.carregarPacote();

    let cenarios = todos;
    if (ids) {
      const existentes = new Set(todos.map((c) => c.id));
      const faltando = ids.filter((id) => !existentes.has(id));
      if (faltando.length) {
        throw new ErrosServiceError(`cenário(s) inexistente(s): ${faltando.join(', ')}`, 400);
      }
      const pedidos = new Set(ids);
      cenarios = todos.filter((c) => pedidos.has(c.id));
    }

    const outDir = novaPastaExecucao(cfg.pacoteDir);
    const programa = {
      ...(cfg.commitClp && { commit_clp: cfg.commitClp }),
      ...(cfg.versaoIhm && { versao_ihm: cfg.versaoIhm }),
    };
    this.execAtual = basename(outDir);
    this.resultadoAtual = [];
    const inicio = new Date().toISOString();
    this.executor = new Executor({
      bridge,
      faults: rt.faults,
      mapa,
      capturar: (arquivo) => capturarIhm({ ihmIp: cfg.ihmIp, vncPort: cfg.vncPort, vncSenha: cfg.vncSenha }, arquivo),
      snapshot: () => rt.publisher.latest,
      now: () => Date.now(),
      sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
      outDir,
      ...(pacote && { pacote }),
    });

    const emit = (e: Evento): void => {
      if (e.tipo === 'resultado') this.resultadoAtual.push(e.resultado);
      logLinha(outDir, JSON.stringify(e));
      for (const ouvinte of this.ouvintes) ouvinte(e);
    };
    const executor = this.executor;
    // RODANDO já agora (síncrono): um 2º run imediato tem que levar 409, mesmo enquanto a
    // execução ainda espera a restauração da inicialização (`pronto`).
    executor.estado = 'RODANDO';
    void (async () => {
      let resultado: ResultadoCenario[] = this.resultadoAtual;
      try {
        await this.pronto;
        // parar() durante a espera acima: não começa (executar() zeraria o pedido de parar).
        if (executor.estado !== 'PARANDO') resultado = await executor.executar(cenarios, emit);
      } catch (err) {
        logLinha(outDir, `erro na execução: ${(err as Error).message}`);
      } finally {
        executor.estado = 'OCIOSO';
        try {
          gravarResultado(outDir, {
            inicio,
            fim: new Date().toISOString(),
            programa,
            setup_inicial: executor.setupInicial,
            cenarios: resultado,
          });
        } catch (err) {
          console.error('erros: falha gravando resultado.json:', err);
        }
      }
    })();
  }

  parar(): void {
    this.executor?.parar();
  }

  continuar(): void {
    this.executor?.continuar();
  }

  status(): StatusResposta {
    return {
      estado: this.executor?.estado ?? 'OCIOSO',
      instrucao: this.executor?.instrucao ?? null,
      resultadoParcial: this.resultadoAtual,
      ...(this.restaurados.length > 0 && { setupPendenteRestaurado: this.restaurados }),
      exec: this.execAtual,
    };
  }

  /** Testa CLP (lê 1 registro pelo bridge) e IHM (foto VNC numa pasta temporária do pacote).
   *  Nunca devolve a senha: só ok/erro + mensagem já sanitizada pelo vnc.ts. */
  async testar(): Promise<{ clp: 'ok' | 'erro'; ihm: 'ok' | 'erro'; detalhe: { clp?: string; ihm?: string } }> {
    const cfg = loadConfig(this.configPath);
    const detalhe: { clp?: string; ihm?: string } = {};
    let clp: 'ok' | 'erro' = 'erro';
    const bridge = getRuntime().bridge;
    if (!bridgeTemPlcIo(bridge)) detalhe.clp = 'modo virtual (sem CLP real)';
    else {
      try {
        await bridge.readPlc('D', 0, 1);
        clp = 'ok';
      } catch (err) {
        detalhe.clp = (err as Error).message;
      }
    }
    let ihm: 'ok' | 'erro' = 'erro';
    if (!cfg.ihmIp) detalhe.ihm = 'IP da IHM não configurado';
    else if (!cfg.pacoteDir || !existsSync(cfg.pacoteDir)) detalhe.ihm = 'pacote de cenários não configurado';
    else {
      const dir = join(cfg.pacoteDir, 'execucoes', '_teste_conexao');
      mkdirSync(dir, { recursive: true });
      const r = await capturarIhm({ ihmIp: cfg.ihmIp, vncPort: cfg.vncPort, vncSenha: cfg.vncSenha }, join(dir, 'vnc_teste.png'));
      if (r.ok) ihm = 'ok';
      else detalhe.ihm = r.erro;
    }
    return { clp, ihm, detalhe };
  }

  /** Resolve `pacoteDir/execucoes/<exec>/<nome>` rejeitando path traversal (400) e extensões fora
   *  de TIPOS_ARQUIVO. Não checa existência — a rota devolve 404. */
  caminhoArquivo(exec: string, nome: string): string {
    if (!/^[\w.-]+$/.test(exec) || exec === '.' || exec === '..') {
      throw new ErrosServiceError('exec inválido', 400);
    }
    if (!nome || isAbsolute(nome) || nome.split(/[\\/]/).some((p) => p === '..') || /^[a-zA-Z]:/.test(nome)) {
      throw new ErrosServiceError('nome inválido', 400);
    }
    if (!(extname(nome).toLowerCase() in TIPOS_ARQUIVO)) {
      throw new ErrosServiceError('tipo de arquivo não permitido', 400);
    }
    const base = this.pastaExecucao(exec);
    const alvo = resolve(base, nome);
    if (!alvo.startsWith(base + sep)) throw new ErrosServiceError('nome inválido', 400);
    return alvo;
  }

  private pastaExecucao(exec: string): string {
    const cfg = loadConfig(this.configPath);
    if (!cfg.pacoteDir) throw new ErrosServiceError('pacote de cenários não configurado', 409);
    return resolve(cfg.pacoteDir, 'execucoes', exec);
  }

  /** Roda `python <pacoteDir>/gerar_laudo.py <pasta da execução>` (sem shell, timeout 180 s) e
   *  devolve os laudos (pdf/docx/md) presentes na pasta depois disso. */
  async gerarLaudo(exec: string, python = 'python'): Promise<string[]> {
    this.caminhoArquivo(exec, 'x.md'); // valida exec
    if (exec === this.execAtual && this.executor && this.executor.estado !== 'OCIOSO') {
      throw new ErrosServiceError('execução ainda em andamento: aguarde terminar pra gerar o laudo', 409);
    }
    const cfg = loadConfig(this.configPath);
    const script = join(cfg.pacoteDir, 'gerar_laudo.py');
    if (!existsSync(script)) throw new ErrosServiceError('gerar_laudo.py não existe no pacote de cenários', 409);
    const dir = this.pastaExecucao(exec);
    if (!existsSync(dir)) throw new ErrosServiceError(`execução ${exec} não encontrada`, 404);
    return rodarLaudo(python, [script, dir], 180, dir);
  }

  /** Roda `python <pacoteDir>/gerar_laudo.py --acumulado <pacoteDir>` (sem shell, timeout 300 s):
   *  junta as execuções da versão mais recente em execucoes/_acumulado/ e devolve os laudos de lá. */
  async gerarLaudoAcumulado(python = 'python'): Promise<string[]> {
    if (this.executor && this.executor.estado !== 'OCIOSO') {
      throw new ErrosServiceError('execução em andamento: aguarde terminar pra gerar o laudo acumulado', 409);
    }
    const cfg = loadConfig(this.configPath);
    if (!cfg.pacoteDir) throw new ErrosServiceError('pacote de cenários não configurado', 409);
    const script = join(cfg.pacoteDir, 'gerar_laudo.py');
    if (!existsSync(script)) throw new ErrosServiceError('gerar_laudo.py não existe no pacote de cenários', 409);
    return rodarLaudo(python, [script, '--acumulado', cfg.pacoteDir], 300, this.pastaExecucao('_acumulado'));
  }

  /** Assina eventos da execução em curso (SSE). Devolve a função de cancelamento. */
  eventos(ouvir: (e: Evento) => void): () => void {
    this.ouvintes.add(ouvir);
    return () => this.ouvintes.delete(ouvir);
  }
}

/** execFile sem shell; devolve os pdf/docx/md presentes em `dir` depois. */
function rodarLaudo(python: string, args: string[], timeoutS: number, dir: string): Promise<string[]> {
  return new Promise((res, rej) => {
    execFile(python, args, { timeout: timeoutS * 1000, shell: false }, (err, _out, stderr) => {
      if (!err) {
        const fs = existsSync(dir) ? readdirSync(dir) : [];
        return res(fs.filter((f) => ['.pdf', '.docx', '.md'].includes(extname(f).toLowerCase())));
      }
      const e = err as NodeJS.ErrnoException & { killed?: boolean };
      const msg =
        e.code === 'ENOENT' ? `${python} não encontrado no PATH` : e.killed ? `timeout (${timeoutS} s)` : (stderr || e.message).trim();
      rej(new ErrosServiceError(`falha ao gerar laudo: ${msg}`, 500));
    });
  });
}

declare global {
  var __SIM_ERROS__: ErrosServiceImpl | undefined; // eslint-disable-line no-var
}

export type ErrosService = ErrosServiceImpl;

export function getErrosService(configPath = defaultConfigPath()): ErrosService {
  if (!globalThis.__SIM_ERROS__) {
    globalThis.__SIM_ERROS__ = new ErrosServiceImpl(configPath);
  }
  return globalThis.__SIM_ERROS__;
}

export function resetErrosService(): void {
  globalThis.__SIM_ERROS__ = undefined;
}
