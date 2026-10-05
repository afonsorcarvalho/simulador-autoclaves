// packages/physics/src/drying.ts
// Secagem a vácuo de itens embalados: a água retida evapora limitada por DOIS caminhos em série,
// resolvidos juntos a cada passo:
//   1. CALOR do item até a água:   ṁ·L = G·(T_item − T_b(p_in))      (G = condutância W/K)
//   2. SAÍDA DO VAPOR até a câmara: ṁ = (p_in − p_câm) / R           (R = resistência Pa·s/kg)
// p_in é a pressão do vapor junto à água (dentro do pacote/poros). Resistência alta ⇒ p_in sobe ⇒
// T_b sobe ⇒ menos calor chega ⇒ seca devagar. É a "dificuldade de evaporação" de pacotes e caixas.
//
// Fontes das estimativas (ver docs/secagem-embalagens.md):
//  - fluxo em meio poroso Knudsen + viscoso (Poiseuille) em paralelo — mesma formulação da
//    "resistência do produto" Rp da liofilização;
//  - secagem de têxteis em dois períodos: taxa constante, depois taxa decrescente quando a frente
//    seca avança para dentro do tecido (resistência cresce com a espessura seca);
//  - caixa de instrumental: condensado empoça no fundo da bandeja e só recebe calor por condução
//    do metal numa área pequena (AAMI ST79: limite ~11,4 kg por set por causa disso);
//  - critério de aprovação EN 285 (ensaio de secagem): ganho de massa ≤ 1 % têxtil, ≤ 0,2 % metal.
// ponytail: TODOS os números abaixo são estimativas de literatura, não calibrados — knobs de
//   calibração contra pesagem de pacotes reais antes/depois do ciclo.

import { R_VAP } from './constants.js';
import { p_sat_water, T_sat_water } from './saturation.js';

export const EMBALAGENS = ['nenhuma', 'pacote_textil', 'caixa_sms', 'grau_cirurgico'] as const;
export type Embalagem = (typeof EMBALAGENS)[number];

export const EMBALAGEM_LABELS: Record<Embalagem, string> = {
  nenhuma: 'Sem embalagem (exposto)',
  pacote_textil: 'Pacote têxtil (campo SMS duplo)',
  caixa_sms: 'Caixa de instrumental em SMS',
  grau_cirurgico: 'Embalagem grau cirúrgico (papel/filme)',
};

/** Camada porosa por onde o vapor sai (Knudsen + viscoso em paralelo). */
export interface CamadaPorosa {
  r_poro_m: number; // raio médio de poro
  porosidade: number; // ε
  tortuosidade: number; // τ ≥ 1
  espessura_m: number; // L
}

export interface EmbalagemParams {
  /** Embalagem externa (SMS, papel). null = sem barreira. */
  barreira: CamadaPorosa | null;
  /** Fração da área do item por onde a barreira deixa o vapor sair (grau cirúrgico: só o papel). */
  fracao_area_porosa: number;
  /** Meio poroso interno que o vapor atravessa (tecido do pacote). null = água na superfície. */
  interno: Omit<CamadaPorosa, 'espessura_m'> | null;
  /** Coeficiente de troca item→água (W/(m²·K)) e área da água (fração da área do item, ou m²/kg). */
  h_agua: number;
  area_agua: { fracao_da_area: number } | { m2_por_kg: number };
  /** Umidade de água ligada (kg/kg seco): abaixo dela a_w < 1 (água presa nas fibras). 0 = não há. */
  X_ligada: number;
  /** Limite EN 285 de ganho de massa (fração). */
  limite_en285: number;
}

// SMS: meltblown entre spunbonds, poros ~10–20 µm de diâmetro, ~0,4 mm por folha, dupla.
const SMS_DUPLO: CamadaPorosa = { r_poro_m: 5e-6, porosidade: 0.6, tortuosidade: 2, espessura_m: 0.8e-3 };
// Papel grau cirúrgico 60–70 g/m²: poros ~1–3 µm, ~0,1 mm.
const PAPEL_GC: CamadaPorosa = { r_poro_m: 1e-6, porosidade: 0.3, tortuosidade: 3, espessura_m: 0.1e-3 };

export const EMBALAGEM_PARAMS: Record<Embalagem, EmbalagemParams> = {
  // Água em filme na superfície do item: evapora em flash, como no modelo antigo.
  nenhuma: {
    barreira: null,
    fracao_area_porosa: 1,
    interno: null,
    h_agua: 5000,
    area_agua: { fracao_da_area: 1 },
    X_ligada: 0,
    limite_en285: 0.002,
  },
  // Água distribuída nas fibras (contato íntimo, h alto), mas o vapor do miolo atravessa
  // centímetros de tecido seco: poros ~50 µm entre fios, ε ~0,8. Água ligada ~6 % (regain do algodão).
  pacote_textil: {
    barreira: SMS_DUPLO,
    fracao_area_porosa: 1,
    interno: { r_poro_m: 25e-6, porosidade: 0.8, tortuosidade: 1.5 },
    h_agua: 5000,
    area_agua: { fracao_da_area: 1 },
    X_ligada: 0.06,
    limite_en285: 0.01,
  },
  // Condensado empoçado no fundo da bandeja: ~0,002 m² por kg de instrumental (0,02 m² numa
  // caixa de 10 kg), calor só por condução metal→poça através de ~3 mm de água (k/δ ≈ 200).
  caixa_sms: {
    barreira: SMS_DUPLO,
    fracao_area_porosa: 1,
    interno: null,
    h_agua: 200,
    area_agua: { m2_por_kg: 0.002 },
    X_ligada: 0,
    limite_en285: 0.002,
  },
  // Gotas presas entre item e filme: contato pior que filme livre; vapor só sai pelo lado do papel.
  grau_cirurgico: {
    barreira: PAPEL_GC,
    fracao_area_porosa: 0.5,
    interno: null,
    h_agua: 1000,
    area_agua: { fracao_da_area: 0.5 },
    X_ligada: 0,
    limite_en285: 0.002,
  },
};

const M_AGUA = 0.018015; // kg/mol
const R_U = 8.314;
const ETA_VAPOR = 1.2e-5; // Pa·s, vapor ~40–100 °C

/** Condutância de vapor de uma camada porosa (kg/(s·Pa)) para área A, pressão média p, temperatura T.
 *  Knudsen: D_K = (2rε/3τ)·√(8RT/πM); viscoso: D_v = (r²ε/8ητ)·p — fluxos em paralelo. */
export function condutanciaCamada(c: CamadaPorosa, A: number, p_media: number, T: number): number {
  if (A <= 0 || c.espessura_m <= 0) return Infinity;
  const vMol = Math.sqrt((8 * R_U * T) / (Math.PI * M_AGUA));
  const D_K = ((2 * c.r_poro_m * c.porosidade) / (3 * c.tortuosidade)) * vMol;
  const D_v = ((c.r_poro_m ** 2 * c.porosidade) / (8 * ETA_VAPOR * c.tortuosidade)) * Math.max(p_media, 0);
  // fluxo molar = D·Δp/(R T L) → mássico ×M
  return ((D_K + D_v) * A * M_AGUA) / (R_U * T * c.espessura_m);
}

/** Atividade de água: 1 para água livre; abaixo de X_ligada cai linearmente (isoterma simplificada). */
export function atividadeAgua(X: number, X_ligada: number): number {
  if (X_ligada <= 0 || X >= X_ligada) return 1;
  return Math.max(0.05, X / X_ligada);
}

export interface EvapEntrada {
  emb: EmbalagemParams;
  massa_seca_kg: number;
  area_item_m2: number;
  m_agua_kg: number;
  /** Água máxima já vista no item neste ciclo (para a frente seca do tecido). */
  m_agua_ref_kg: number;
  T_item_K: number;
  p_camara_Pa: number;
}

export interface EvapResultado {
  /** Taxa de evaporação (kg/s), ≥ 0. */
  taxa: number;
  /** Pressão de vapor junto à água (Pa) e temperatura de ebulição correspondente (K). */
  p_in: number;
  T_b: number;
}

/** Espessura de tecido seco que o vapor atravessa: frente seca avança com a perda de água. */
export function espessuraSeca(e: EvapEntrada): number {
  const meia = 0.5 * Math.cbrt(e.massa_seca_kg / 400); // meia-espessura do fardo (ρ têxtil ~400)
  const fr = e.m_agua_ref_kg > 0 ? 1 - e.m_agua_kg / e.m_agua_ref_kg : 0;
  return meia * Math.min(1, Math.max(0.03, fr));
}

/** Resistência total à saída do vapor (Pa·s/kg) na pressão média p. */
function resistencia(e: EvapEntrada, p_media: number, T: number): number {
  let R = 0;
  const { barreira, interno } = e.emb;
  if (barreira) R += 1 / condutanciaCamada(barreira, e.area_item_m2 * e.emb.fracao_area_porosa, p_media, T);
  if (interno) {
    const L = espessuraSeca(e);
    R += 1 / condutanciaCamada({ ...interno, espessura_m: L }, e.area_item_m2, p_media, T);
  }
  return R;
}

/**
 * Taxa de evaporação da água retida num item, resolvendo calor e saída de vapor em série.
 * Busca p_in em [p_câm, a_w·p_sat(T_item)] tal que G·(T_item − T_b(p_in))/L = (p_in − p_câm)/R.
 * O lado do calor cai com p_in e o do vapor sobe: monótono, bisseção sempre converge.
 */
export function taxaEvaporacao(e: EvapEntrada, latente: number): EvapResultado {
  const a_w = atividadeAgua(e.m_agua_kg / Math.max(e.massa_seca_kg, 1e-9), e.emb.X_ligada);
  const p_max = a_w * p_sat_water(e.T_item_K);
  const p_c = Math.max(e.p_camara_Pa, 1);
  if (e.m_agua_kg <= 0 || p_max <= p_c) return { taxa: 0, p_in: p_c, T_b: e.T_item_K };
  const A_agua =
    'fracao_da_area' in e.emb.area_agua
      ? e.emb.area_agua.fracao_da_area * e.area_item_m2
      : e.emb.area_agua.m2_por_kg * e.massa_seca_kg;
  const G = e.emb.h_agua * A_agua; // W/K
  // T_b na pressão p_in, corrigida pela atividade (água ligada ferve "mais quente")
  const Tb = (p: number) => T_sat_water(p / a_w);
  const calor = (p: number) => Math.max(0, (G * (e.T_item_K - Tb(p))) / latente);
  const vapor = (p: number) => {
    const R = resistencia(e, 0.5 * (p + p_c), e.T_item_K);
    return R > 0 ? (p - p_c) / R : Infinity;
  };
  let lo = p_c;
  let hi = p_max;
  for (let i = 0; i < 50; i++) {
    const mid = 0.5 * (lo + hi);
    if (vapor(mid) < calor(mid)) lo = mid;
    else hi = mid;
  }
  const p_in = 0.5 * (lo + hi);
  return { taxa: calor(p_in), p_in, T_b: Tb(p_in) };
}

/** Ganho de massa relativo (água retida / massa seca) e aprovação pelo critério EN 285. */
export function secagemEN285(emb: Embalagem, m_agua_kg: number, massa_seca_kg: number) {
  const ganho = massa_seca_kg > 0 ? m_agua_kg / massa_seca_kg : 0;
  const limite = EMBALAGEM_PARAMS[emb].limite_en285;
  return { ganho, limite, aprovado: ganho <= limite };
}

// Reexporta R_VAP só para documentação de unidades nos testes (vapor ideal).
export const _R_VAP = R_VAP;
