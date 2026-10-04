import { fmtValor } from './format';

/** Tipo de eixo de cada grandeza (uma unidade por eixo). */
export type Eixo = 'temp' | 'press' | 'cond' | 'vazao' | 'kg' | 'kgh' | 'f0';

export const UNIDADE: Record<Eixo, string> = { temp: '°C', press: 'bar', cond: 'g', vazao: 'g/min', kg: 'kg', kgh: 'kg/h', f0: 'min' };

export const GRANDEZAS = [
  { k: 't_carga_C', rot: 'Temp. carga (°C)', eixo: 'temp' },
  { k: 't_camara_C', rot: 'Temp. câmara (°C)', eixo: 'temp' },
  { k: 't_dreno_C', rot: 'Temp. dreno (°C)', eixo: 'temp' },
  { k: 't_camisa_C', rot: 'Temp. camisa (°C)', eixo: 'temp' },
  { k: 't_gerador_C', rot: 'Temp. gerador (°C)', eixo: 'temp' },
  { k: 'p_camara_bar', rot: 'Pressão câmara (bar abs)', eixo: 'press' },
  { k: 'p_camisa_bar', rot: 'Pressão camisa (bar abs)', eixo: 'press' },
  { k: 'p_gerador_bar', rot: 'Pressão gerador (bar abs)', eixo: 'press' },
  { k: 'agua_carga_g', rot: 'Água na carga (g)', eixo: 'cond' },
  { k: 'agua_camara_g', rot: 'Água no fundo da câmara (g)', eixo: 'cond' },
  { k: 'cond_acum_g', rot: 'Condensado acumulado (g)', eixo: 'cond' },
  { k: 'evap_acum_g', rot: 'Evaporado acumulado (g)', eixo: 'cond' },
  { k: 'cond_carga_g', rot: 'Condensado carga (g)', eixo: 'cond' },
  { k: 'cond_parede_g', rot: 'Condensado parede (g)', eixo: 'cond' },
  { k: 'vazao_g_min', rot: 'Vazão cond−evap (g/min, com sinal)', eixo: 'vazao' },
  { k: 'vapor_camara_kg', rot: 'Vapor câmara acumulado (kg)', eixo: 'kg' },
  { k: 'vapor_camisa_kg', rot: 'Vapor camisa acumulado (kg)', eixo: 'kg' },
  { k: 'vapor_total_kg', rot: 'Vapor total acumulado (kg)', eixo: 'kg' },
  { k: 'vapor_vazao_kg_h', rot: 'Vazão de vapor total (kg/h)', eixo: 'kgh' },
  { k: 'f0_min', rot: 'F0 (min)', eixo: 'f0' },
] as const satisfies readonly { k: string; rot: string; eixo: Eixo }[];

export type GrandezaK = (typeof GRANDEZAS)[number]['k'];
export const grandeza = (k: string) => GRANDEZAS.find((g) => g.k === k)!;

export function fmtGrandeza(v: number, eixo: Eixo): string {
  return eixo === 'f0' ? `${v.toFixed(1).replace('.', ',')} min` : fmtValor(v, UNIDADE[eixo] as 'bar');
}

/**
 * Escolhe até 2 eixos entre os tipos selecionados (na ordem de preferência: temperatura,
 * pressão, condensado, vazão, vapor kg, vapor kg/h, F0). Temperatura fica à esquerda e pressão à direita quando ambas.
 * Retorna também os tipos que ficaram de fora (para avisar).
 */
export function escolherEixos(sel: readonly string[]): { esq: Eixo | undefined; dir: Eixo | undefined; fora: Eixo[] } {
  const ordem: Eixo[] = ['temp', 'press', 'cond', 'vazao', 'kg', 'kgh', 'f0'];
  const tipos = ordem.filter((e) => sel.some((k) => grandeza(k).eixo === e));
  const [a, b] = tipos;
  // pressão sempre à direita; o resto: 1º à esquerda, 2º à direita
  const esq = a === 'press' ? b : a;
  const dir = a === 'press' ? a : b;
  return { esq, dir, fora: tipos.slice(2) };
}

/** Passo de redução para que a soma de pontos fique ≤ limite (1 a cada N). */
export function passoReducao(totalPontos: number, limite = 20_000): number {
  return Math.max(1, Math.ceil(totalPontos / limite));
}

/** Mantém 1 a cada `passo` pontos, sempre preservando o último. */
export function reduzir<T>(arr: readonly T[], passo: number): T[] {
  if (passo <= 1) return [...arr];
  const out = arr.filter((_, i) => i % passo === 0);
  if (arr.length && (arr.length - 1) % passo !== 0) out.push(arr.at(-1)!);
  return out;
}

type Ponto = { t_s: number };

/**
 * Junta as séries de vários ciclos num único array para o recharts, por tempo desde o início
 * (min). Chave de cada valor: `${i}:${grandeza}` (i = índice do ciclo). Ordenado por t.
 */
export function mesclarSeries<P extends Ponto>(series: readonly (readonly P[])[], ks: readonly string[]) {
  const porT = new Map<number, Record<string, number>>();
  series.forEach((serie, i) => {
    for (const p of serie) {
      let row = porT.get(p.t_s);
      if (!row) porT.set(p.t_s, (row = { t: p.t_s / 60 }));
      for (const k of ks) if (typeof (p as Record<string, unknown>)[k] === 'number') row[`${i}:${k}`] = (p as Record<string, number>)[k]!;
    }
  });
  return [...porT.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
}

/** Faixas contíguas de fase (t em min). */
export function faixasFase(serie: readonly { t_s: number; fase: string }[]) {
  const out: { x1: number; x2: number; fase: string }[] = [];
  for (const p of serie) {
    const last = out.at(-1);
    if (last && last.fase === p.fase) last.x2 = p.t_s / 60;
    else out.push({ x1: last?.x2 ?? p.t_s / 60, x2: p.t_s / 60, fase: p.fase });
  }
  return out;
}

/** Achata o objeto de parâmetros em chaves "a.b" → valor. */
export function achatar(o: unknown, pre = ''): Record<string, unknown> {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return pre ? { [pre]: o } : {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) Object.assign(out, achatar(v, pre ? `${pre}.${k}` : k));
  return out;
}

/** Linhas da tabela lado a lado: união das chaves, valores por ciclo e se diferem. */
export function diffParametros(objs: readonly Record<string, unknown>[]) {
  const chaves = [...new Set(objs.flatMap((o) => Object.keys(o)))].sort();
  return chaves.map((k) => {
    const valores = objs.map((o) => o[k]);
    const s = valores.map((v) => JSON.stringify(v));
    return { k, valores, difere: s.some((x) => x !== s[0]) };
  });
}
