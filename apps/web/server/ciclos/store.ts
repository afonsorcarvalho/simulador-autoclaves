import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type Resultado = 'aprovado' | 'abortado' | 'parado' | 'desconhecido' | 'interrompido';

/** 1 ponto por segundo de ciclo. Pressões em bar abs, temperaturas em °C, F0 em min. */
export interface PontoSerie {
  t_s: number;
  p_camara_bar: number;
  p_camisa_bar: number;
  p_gerador_bar: number;
  t_camara_C: number;
  t_dreno_C: number;
  t_carga_C: number;
  t_camisa_C: number;
  t_gerador_C: number;
  f0_min: number;
  /** Condensado acumulado por origem (g). */
  cond_carga_g: number;
  cond_parede_g: number;
  /** (cond − evap) g/min, com sinal (ciclos antigos: só condensação, ≥ 0). */
  vazao_g_min: number;
  /** Campos novos — ausentes em ciclos gravados antes deles. */
  agua_carga_g?: number;
  agua_camara_g?: number;
  cond_acum_g?: number;
  evap_acum_g?: number;
  dreno_acum_g?: number;
  /** Vapor injetado acumulado (kg) e vazão total (kg/h). */
  vapor_camara_kg?: number;
  vapor_camisa_kg?: number;
  vapor_total_kg?: number;
  vapor_vazao_kg_h?: number;
  fase: string;
  fase_cod: number;
  /** Abertura das portas 0..1 (só CLP real). */
  porta_C?: number;
  porta_D?: number;
  /** Estado das saídas ('0'/'1' por posição de meta.saidas_nomes). Ausente em ciclos antigos. */
  saidas?: string;
}

export interface Ciclo {
  meta: {
    id: string;
    inicio: string;
    fim: string | null;
    duracao_s: number;
    modo: 'virtual' | 'clp';
    /** null enquanto parcial. */
    resultado: Resultado | null;
    motivo: string | null;
    nome: string;
    anotacao: string;
    parcial: boolean;
    /** Nomes das saídas na ordem de PontoSerie.saidas (CLP: PLC_OUTPUTS; virtual: válvulas + atuadores). */
    saidas_nomes?: string[];
  };
  parametros: {
    ciclo: ({ name: string } & Record<string, unknown>) | null;
    knobs: Record<string, number>;
    versoes: { commitClp?: string; versaoIhm?: string };
  };
  resumo: {
    f0_min: number;
    cond_carga_g: number;
    cond_parede_g: number;
    cond_total_g: number;
    /** Ausentes em ciclos antigos. */
    agua_carga_fim_g?: number;
    evap_total_g?: number;
    vapor_camara_kg?: number;
    vapor_camisa_kg?: number;
    vapor_total_kg?: number;
    energia_kwh?: number;
    t_carga_max_C: number;
    p_camara_max_bar: number;
    tempos_fase_s: Record<string, number>;
    /** Umidade final por item e ensaio de secagem EN 285 (ausente em ciclos antigos). */
    secagem?: import('../runtime/snapshot.js').SecagemItem[];
  };
  serie: PontoSerie[];
}

export const ID_RE = /^\d{4}-\d{2}-\d{2}_\d{2}h\d{2}m\d{2}s$/;

export function ciclosDir(): string {
  const d = resolve(process.env.SIM_CICLOS_DIR ?? resolve(process.cwd(), 'ciclos'));
  mkdirSync(d, { recursive: true });
  return d;
}

/** Nome pelo horário LOCAL: AAAA-MM-DD_HHhMMmSS. */
export function idDe(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}m${p(d.getSeconds())}s`;
}

function arq(id: string): string {
  if (!ID_RE.test(id)) throw new Error('id inválido');
  return join(ciclosDir(), `${id}.json`);
}

export function salvar(c: Ciclo): void {
  writeFileSync(arq(c.meta.id), JSON.stringify(c), 'utf8');
}

export function ler(id: string): Ciclo | null {
  const f = arq(id);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Ciclo) : null;
}

/** Meta + parâmetros + resumo (sem série), mais recente primeiro. */
export function listar(): Omit<Ciclo, 'serie'>[] {
  const out: Omit<Ciclo, 'serie'>[] = [];
  for (const f of readdirSync(ciclosDir()).sort().reverse()) {
    const id = f.replace(/\.json$/, '');
    if (!ID_RE.test(id)) continue;
    try {
      const { serie: _serie, ...resto } = ler(id)!;
      out.push(resto);
    } catch {
      // arquivo corrompido: pula
    }
  }
  return out;
}

export function editar(id: string, p: { nome?: string; anotacao?: string }): Ciclo | null {
  const c = ler(id);
  if (!c) return null;
  if (p.nome !== undefined) c.meta.nome = p.nome;
  if (p.anotacao !== undefined) c.meta.anotacao = p.anotacao;
  salvar(c);
  return c;
}

export function apagar(id: string): boolean {
  const f = arq(id);
  if (!existsSync(f)) return false;
  rmSync(f);
  return true;
}

/** Série em CSV pt-BR: `;` como separador e vírgula decimal. */
export function csv(c: Ciclo): string {
  const cols = [...new Set(c.serie.flatMap((p) => Object.keys(p)))] as (keyof PontoSerie)[];
  const cel = (v: unknown) =>
    typeof v === 'number' ? String(v).replace('.', ',') : v === undefined ? '' : String(v);
  const linhas = c.serie.map((p) => cols.map((k) => cel(p[k])).join(';'));
  return [cols.join(';'), ...linhas].join('\n') + '\n';
}

/** Boot: parciais deixados por um servidor que caiu no meio do ciclo viram 'interrompido'. */
export function marcarOrfaos(): void {
  for (const m of listar()) {
    if (!m.meta.parcial) continue;
    const c = ler(m.meta.id)!;
    c.meta.parcial = false;
    c.meta.resultado = 'interrompido';
    salvar(c);
  }
}
