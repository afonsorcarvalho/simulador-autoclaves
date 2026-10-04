import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResultadoCenario } from './executor.js';

export interface ResultadoExecucao {
  inicio: string;
  fim: string;
  programa: { commit_clp?: string; versao_ihm?: string };
  setup_inicial: Record<string, unknown>;
  cenarios: ResultadoCenario[];
}

const p2 = (n: number): string => String(n).padStart(2, '0');

/** Cria `base/execucoes/AAAA-MM-DD_HHMMSS` (hora local; `-2`, `-3`... se já existir) e devolve
 *  o caminho = outDir do Executor. */
export function novaPastaExecucao(base: string, d = new Date()): string {
  const nome = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  let dir = join(base, 'execucoes', nome);
  for (let i = 2; existsSync(dir); i++) dir = join(base, 'execucoes', `${nome}-${i}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function gravarResultado(dir: string, r: ResultadoExecucao): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'resultado.json'), JSON.stringify(r, null, 2));
}

/** Acrescenta uma linha `HH:MM:SS msg` em dir/log.txt. */
export function logLinha(dir: string, msg: string, d = new Date()): void {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'log.txt'), `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${msg}\n`);
}
