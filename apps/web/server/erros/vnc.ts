import { execFile } from 'node:child_process';

/** Captura de tela da IHM via VNC (vncdo), usada pelo simulador de erros pra anexar
 *  evidência visual de um cenário. Nunca lança: erro sempre volta como {ok:false, erro}. */

export interface VncCfg {
  ihmIp: string;
  vncPort: number | null;
  vncSenha: string;
}

export interface VncOpts {
  /** Executável a rodar (default 'vncdo'). Testes injetam process.execPath. */
  cmd?: string;
  /** Monta os args do processo. Default: vncdo -s ip::porta [-p senha] capture arquivo. */
  args?: (cfg: VncCfg, arquivo: string) => string[];
  timeout_ms?: number;
}

type Resultado = { ok: true } | { ok: false; erro: string };

const PORTA_PADRAO = 5900;
const TIMEOUT_PADRAO_MS = 15000;

function argsPadrao(cfg: VncCfg, arquivo: string): string[] {
  const porta = cfg.vncPort ?? PORTA_PADRAO;
  const args = ['-s', `${cfg.ihmIp}::${porta}`];
  if (cfg.vncSenha !== '') args.push('-p', cfg.vncSenha);
  args.push('capture', arquivo);
  return args;
}

/** Remove toda ocorrência da senha de uma mensagem de erro antes de devolvê-la pro chamador. */
function sanitizar(msg: string, senha: string): string {
  if (senha === '') return msg;
  return msg.split(senha).join('***');
}

function tentar(cmd: string, args: string[], timeout_ms: number): Promise<Resultado> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeout_ms, shell: false }, (err, _stdout, stderr) => {
      if (!err) {
        resolve({ ok: true });
        return;
      }
      const erro = err as NodeJS.ErrnoException & { killed?: boolean };
      if (erro.code === 'ENOENT') {
        resolve({ ok: false, erro: 'vncdo não encontrado (pip install vncdotool)' });
        return;
      }
      if (erro.killed) {
        resolve({ ok: false, erro: 'timeout' });
        return;
      }
      resolve({ ok: false, erro: (stderr || erro.message).trim() });
    });
  });
}

export async function capturarIhm(cfg: VncCfg, arquivo: string, opts: VncOpts = {}): Promise<Resultado> {
  const cmd = opts.cmd ?? 'vncdo';
  const args = (opts.args ?? argsPadrao)(cfg, arquivo);
  const timeout_ms = opts.timeout_ms ?? TIMEOUT_PADRAO_MS;

  let resultado = await tentar(cmd, args, timeout_ms);
  if (!resultado.ok) resultado = await tentar(cmd, args, timeout_ms); // 1 nova tentativa
  if (!resultado.ok) return { ok: false, erro: sanitizar(resultado.erro, cfg.vncSenha) };
  return resultado;
}
