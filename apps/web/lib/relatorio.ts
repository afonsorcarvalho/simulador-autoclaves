import { faixasFase, passoReducao, reduzir } from './analise';
import type { Ciclo } from '../server/ciclos/store';

// ponytail: dicionário fixo; palavra fora dele vira minúscula crua
const PALAVRAS: Record<string, string> = {
  VALV: 'válvula', V: 'válvula', VAPOR: 'vapor', STEAM: 'vapor', CAMARA: 'câmara', INT: 'câmara',
  CAMISA: 'camisa', JACKET: 'camisa', VACUO: 'vácuo', VAC: 'vácuo', AR: 'ar', AIR: 'ar',
  FILTRADO: 'filtrado', DRENO: 'dreno', DRAIN: 'dreno', AGUA: 'água', WATER: 'água', SELO: 'selo',
  RESISTENCIA: 'resistência', HEATER: 'resistência', GER: 'gerador', GEN: 'gerador',
  BOMBA: 'bomba', PUMP: 'bomba', GUARN: 'guarnição', SEAL: 'guarnição', PORTA: 'porta',
  ABRIR: 'abrir', FECHAR: 'fechar', ALARME: 'alarme', SONORO: 'sonoro', EXAUSTAO: 'exaustão',
  EXHAUST: 'exaustão', LENTA: 'lenta', LED: 'LED', FIM: 'fim', CICLO: 'ciclo', IN: 'entrada',
  CLEAN: 'lado limpo', STERILE: 'lado estéril',
};

/** OUT_VALV_VAPOR_CAMARA → "Válvula vapor câmara". */
export function rotuloSaida(nome: string): string {
  const s = nome.replace(/^OUT_/, '').split('_').map((w) => PALAVRAS[w] ?? w.toLowerCase()).join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Faixas com `rotulo` só para as largas (≥ minFrac do tempo total); estreitas ficam sem (a tabela de tempos por fase já identifica). */
export function faixasRotuladas<F extends { x1: number; x2: number; fase: string }>(
  faixas: readonly F[],
  tTotal: number,
  minFrac = 0.06,
): (F & { rotulo: string })[] {
  return faixas.map((f) => ({ ...f, rotulo: tTotal > 0 && (f.x2 - f.x1) / tTotal >= minFrac ? f.fase : '' }));
}

/** Valor de knob em pt-BR: lista → rótulo da opção; com `decimals` → essa casa; senão 3 alg. sig., inteiro sem casas. */
export function formatarValorKnob(v: number, meta?: { decimals?: number | undefined; optionLabels?: string[] | undefined }): string {
  if (meta?.optionLabels) return meta.optionLabels[Math.round(v)] ?? String(v).replace('.', ',');
  if (meta?.decimals !== undefined) return v.toFixed(meta.decimals).replace('.', ',');
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(3))).replace('.', ',');
}

const limpa = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'NA';

/** RC_<nome>_<AAAA-MM-DD_HHhMM>_CLP-<v>_IHM-<v>, só [A-Za-z0-9.-_]. */
export function nomeArquivo(nome: string, inicio: Date, clp?: string, ihm?: string): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const d = `${inicio.getFullYear()}-${p(inicio.getMonth() + 1)}-${p(inicio.getDate())}_${p(inicio.getHours())}h${p(inicio.getMinutes())}`;
  return `RC_${limpa(nome)}_${d}_CLP-${limpa(clp ?? '')}_IHM-${limpa(ihm ?? '')}`;
}

/**
 * Dados do relatório: série reduzida a ~`limite` pontos com t em min, saídas expandidas
 * em `s<i>` (0/1) e faixas de fase. Ciclos sem `saidas` → `saidas: []`.
 */
export function montarRelatorio(c: Ciclo, limite = 2000) {
  const nomes = c.meta.saidas_nomes ?? [];
  const serie = reduzir(c.serie, passoReducao(c.serie.length, limite));
  const mudou = nomes.map(() => false);
  const primeiro = c.serie.find((p) => p.saidas)?.saidas;
  // "mudou" olha a série inteira, não a reduzida: pulso curto não some
  for (const p of c.serie) if (p.saidas) for (let i = 0; i < nomes.length; i++) if (p.saidas[i] !== primeiro![i]) mudou[i] = true;
  const dados = serie.map((p) => {
    const row: Record<string, number> = { t: p.t_s / 60 };
    for (const [k, v] of Object.entries(p)) if (typeof v === 'number') row[k] = v;
    if (p.saidas) for (let i = 0; i < nomes.length; i++) row[`s${i}`] = p.saidas[i] === '1' ? 1 : 0;
    return row;
  });
  const temSaidas = c.serie.some((p) => p.saidas);
  return {
    dados,
    faixas: faixasFase(c.serie),
    saidas: temSaidas ? nomes.map((nome, i) => ({ nome, rot: rotuloSaida(nome), chave: `s${i}`, mudou: mudou[i]! })) : [],
  };
}
