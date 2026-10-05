// packages/physics/src/load.ts
import { MATERIALS, estimateArea, type MaterialName } from './materials.js';
import { T_sat_water } from './saturation.js';
import { L_eff } from './energy.js';
import { EMBALAGEM_PARAMS, taxaEvaporacao, type Embalagem } from './drying.js';
import { CP_WATER, SIGMA_SB, C_to_K, H_COND_DEFAULT, H_DESUP_DEFAULT, CV_VAP } from './constants.js';

export interface LoadNode {
  name: string;
  material: MaterialName;
  mass_kg: number;
  T: number; // K (estado)
  m_water: number; // kg (estado)
  isWitness?: boolean; // true = testemunho (referência p/ F0)
  /** Embalagem do item (secagem). Ausente/'nenhuma' = água em filme, flash imediato. */
  embalagem?: Embalagem;
  /** Maior água retida no ciclo (kg) — referência da frente seca do tecido. */
  m_water_max?: number;
}

export interface LoadState {
  nodes: LoadNode[];
}

export interface LoadParams {
  h0_conv: number; // W/(m²·K) base @ρ_ref
  // Reservados: coeficientes de taxa de condensação/evaporação. O modelo de pinning de
  // saturação é quase-estático (dirigido por energia, não por Δp), por isso não os usa na v1.
  // Mantidos p/ compatibilidade de config e para um futuro modelo de taxa finita.
  k_cond: number; // kg/(s·m²·Pa)
  k_ev: number; // kg/(s·m²·Pa)
  /** Coef. de condensação em filme na superfície da carga (W/(m²·K)) com vapor puro.
   *  Default H_COND_DEFAULT. Escala com a fração molar de vapor (bloqueio pelo ar). */
  h_cond?: number;
  /** Dessuperaquecimento gás↔carga em condensação, W/(m²·K). Default H_DESUP_DEFAULT. */
  h_desup?: number;
}

export interface LoadEnv {
  T_gas: number; // K
  rho_gas: number; // kg/m³
  rho_gas_atm: number; // kg/m³ (referência)
  /** Temperatura da superfície que a carga enxerga por radiação (parede interna da câmara), K. */
  T_wall: number;
  p_sat_at: (T: number) => number; // Pa
  p_vap_chamber: number; // Pa
  chamber_has_vapor: boolean;
  chamber_vapor_kg: number; // kg de vapor disponível na câmara (limite p/ condensação, conservação)
  /** Fração molar de vapor na câmara p_vap/p_total (0..1). Default 1 (vapor puro). */
  y_vap?: number;
}

export interface LoadStepResult {
  next: LoadState;
  Q_conv_from_gas: number; // W (positivo = retirado do gás)
  Q_rad_from_wall: number; // W (positivo = retirado da parede da câmara)
  vaporToChamber_kg: number; // Σ(evaporado − condensado) neste passo
  /** Condensado que excedeu a capacidade de retenção da carga e escorreu p/ a câmara (kg). */
  liqToChamber_kg: number;
  /** Energia sensível desse condensado (J, CP_WATER·T do nó) — entra na câmara com ele. */
  liqToChamber_J: number;
  /** Condensação bruta nos nós neste passo (kg, ≥ 0). */
  cond_kg: number;
  /** Evaporação (flash) bruta dos nós neste passo (kg, ≥ 0). */
  evap_kg: number;
}

export function load_step(s: LoadState, p: LoadParams, e: LoadEnv, dt: number): LoadStepResult {
  let Q_conv_total = 0;
  let Q_rad_total = 0;
  let vaporToChamber = 0;
  let liqToChamber = 0;
  let liqToChamber_J = 0;
  let condGross = 0;
  let evapGross = 0;
  // Condensação em filme: h ≫ convecção seca. Bloqueio pelo ar: o ar acumula na interface e
  // freia a difusão do vapor → h escala com a fração molar de vapor.
  // ponytail: bloqueio linear em y_vap; o real é mais forte (1% de ar já corta ~metade).
  //   O ponto frio do Bowie-Dick vem sobretudo de T_boil = T_sat(p_vap) < T_sat(P_total).
  const h_cond = (p.h_cond ?? H_COND_DEFAULT) * Math.max(0, Math.min(1, e.y_vap ?? 1));

  // Vapor da câmara é um recurso PARTILHADO entre nós. Orçamento total de condensação por passo
  // (50% do disponível, p/ não esvaziar a câmara num tick) decrementado à medida que cada nó
  // condensa — senão N nós puxariam cada um 50% e o total ultrapassaria o vapor real (massa fantasma).
  let condBudget = 0.5 * e.chamber_vapor_kg;

  const nodes = s.nodes.map((node) => {
    const m = MATERIALS[node.material];
    const A = estimateArea(node.mass_kg, m);
    const C = Math.max(node.mass_kg * m.cp + node.m_water * CP_WATER, 1e-6);
    // Latent on the COMMON energy reference (u_vap − u_liq), same basis the chamber stores
    // and transports vapor on. Using h_vap_water here would credit R_v·T ≈ 0.18 MJ/kg more than the
    // chamber is debited → energy created at the load↔chamber condensation boundary.
    const hv = L_eff(node.T);
    const T_boil = T_sat_water(e.p_vap_chamber);
    const cap = m.waterCapacity_kg_per_kg * node.mass_kg;
    const h_gas = p.h0_conv * (e.rho_gas / e.rho_gas_atm); // coef. de troca gás↔carga ∝ densidade

    // Radiação da PAREDE interna da câmara (domina no vácuo) — sempre presente. Dois corpos cinzas,
    // carga envolvida pela parede [Incropera 13.3]: F = 1/(1/ε_n + (A_n/A_w)(1/ε_w − 1)); com as áreas
    // deste modelo (A_n ~ 0,1 m² vs A_w ~ 3 m²) o termo da parede some e F → ε_n.
    // ponytail: limite A_n ≪ A_w; se a carga encher a câmara (A_n/A_w ~ 1), expor a razão de áreas.
    const Q_rad = m.emissivity * SIGMA_SB * A * (e.T_wall ** 4 - node.T ** 4); // W

    let dWater = 0;
    let Q_conv = 0; // só o sensível seco entra aqui (o latente vem via massa de vapor)
    let T_final: number;

    if (node.T < T_boil - 1e-9 && condBudget > 0) {
      // REGIME DE CONDENSAÇÃO: em vapor saturado o calor chega POR condensação na superfície mais
      // fria — entrega calor latente E deposita água (não é convecção seca). q = h·A·(T_sat−T_carga);
      // água depositada = q·dt/h_vap. É isto que molha a carga no aquecimento (era o gap do come-up).
      // Dessuperaquecimento: o gás acima de T_sat também troca calor sensível com a carga.
      // Sem a escala ∝ρ da convecção seca: a sucção da condensação afina a camada-limite e
      // mistura o gás contra a superfície molhada. Com ∝ρ, em 0,1–1 bar o gás de poucos gramas
      // ficava 50–90 K superaquecido (trabalho de fluxo do vapor admitido) sem freio.
      // ponytail: h0_conv sem escala é o mesmo knob da convecção a 1 atm; calibrar no vaso real.
      Q_conv =
        Math.max(h_gas, p.h0_conv, p.h_desup ?? H_DESUP_DEFAULT) * A * (e.T_gas - node.T);
      const q_drive = h_cond * A * (T_boil - node.T); // W potencial de condensação
      // O vapor sai da câmara a T_gas (CV_VAP·T_gas + U_FG0) e vira líquido a T do nó: o nó recebe
      // o latente a T_nó MAIS o sensível do vapor (T_gas→T_nó). Só L_eff(T_nó) destruía
      // CV_VAP·(T_gas−T_nó) por kg — resíduo que crescia com a condensação rápida.
      const hv_c = hv + CV_VAP * (e.T_gas - node.T);
      // Teto: não condensar além do que leva o nó exatamente a T_boil (sem sobra de energia
      // p/ o clamp abaixo descartar).
      const headroom = Math.max(0, C * (T_boil - node.T) - (Q_conv + Q_rad) * dt) / hv_c;
      const dep = Math.min((q_drive * dt) / hv_c, headroom, condBudget); // kg condensados
      const Q_cond = (dep * hv_c) / dt; // W efetivamente entregues
      dWater = dep;
      condBudget -= dep;
      let T_new = node.T + ((Q_cond + Q_conv + Q_rad) * dt) / C;
      if (T_new > T_boil) {
        // Não ultrapassa a ebulição (pinned). A sobra (convecção+radiação além do headroom) volta
        // p/ o gás via Q_conv em vez de sumir no clamp — mantém a conservação exata.
        Q_conv -= (C * (T_new - T_boil)) / dt;
        T_new = T_boil;
      }
      T_final = T_new;
    } else {
      // REGIME SECO / SUPERAQUECIDO / SEM VAPOR: sensível seco (convecção ∝ρ) + radiação.
      Q_conv = h_gas * A * (e.T_gas - node.T); // W (gás→nó)
      const T_prov = node.T + ((Q_conv + Q_rad) * dt) / C;
      const emb = node.embalagem && node.embalagem !== 'nenhuma' ? node.embalagem : null;
      if (emb && node.m_water > 0 && T_prov > T_boil) {
        // Item EMBALADO: evaporação limitada por calor item→água e saída do vapor (drying.ts).
        const ev = taxaEvaporacao(
          {
            emb: EMBALAGEM_PARAMS[emb],
            massa_seca_kg: node.mass_kg,
            area_item_m2: A,
            m_agua_kg: node.m_water,
            m_agua_ref_kg: Math.max(node.m_water_max ?? 0, node.m_water),
            T_item_K: T_prov,
            p_camara_Pa: e.p_vap_chamber,
          },
          hv,
        );
        const evap = Math.max(
          0,
          Math.min(ev.taxa * dt, node.m_water, (C * (T_prov - ev.T_b)) / hv),
        );
        dWater = -evap;
        T_final = T_prov - (evap * hv) / C;
      } else if (node.m_water > 0 && T_prov > T_boil) {
        // Flash: água livre não deixa superaquecer — evapora até à ebulição (arrefece no vácuo).
        const surplus = C * (T_prov - T_boil);
        const evap = Math.min(surplus / hv, node.m_water);
        dWater = -evap;
        T_final = T_prov - (evap * hv) / C; // chega a T_boil se houver água; senão fica acima (secou)
      } else {
        T_final = T_prov;
      }
    }
    vaporToChamber += -dWater; // condensação (dWater>0) retira vapor da câmara; flash (<0) adiciona
    if (dWater > 0) condGross += dWater;
    else evapGross -= dWater;

    // Condensado acima da capacidade de retenção escorre p/ a câmara (m_liq → dreno) a T do nó.
    // Não bloqueia a condensação: a carga continua sendo sumidouro enquanto estiver fria.
    let m_water = node.m_water + dWater;
    const overflow = Math.max(0, m_water - cap);
    if (overflow > 0) {
      m_water -= overflow;
      liqToChamber += overflow;
      liqToChamber_J += overflow * CP_WATER * T_final;
    }

    Q_conv_total += Q_conv;
    Q_rad_total += Q_rad;
    return { ...node, T: T_final, m_water, m_water_max: Math.max(node.m_water_max ?? 0, m_water) };
  });

  return {
    next: { nodes },
    Q_conv_from_gas: Q_conv_total,
    Q_rad_from_wall: Q_rad_total,
    vaporToChamber_kg: vaporToChamber,
    liqToChamber_kg: liqToChamber,
    liqToChamber_J,
    cond_kg: condGross,
    evap_kg: evapGross,
  };
}

export interface LoadItemConfig {
  name?: string;
  material: MaterialName;
  mass_kg: number;
  initial_T_C?: number;
  witness?: boolean;
  /** Embalagem (secagem): nenhuma | pacote_textil | caixa_sms | grau_cirurgico. */
  embalagem?: Embalagem;
}

const DEFAULT_ITEMS: LoadItemConfig[] = [
  { name: 'load', material: 'STAINLESS_316', mass_kg: 20 },
  { name: 'testemunho', material: 'COTTON_TEXTILE', mass_kg: 5, witness: true },
];

/** Constrói o LoadState a partir de itens de config; carga-default quando ausente;
 *  injeta um nó testemunho se nenhum item o for. */
export function buildLoadState(
  items: LoadItemConfig[] | undefined,
  T_ambient_K: number,
): LoadState {
  const src = items && items.length > 0 ? items : DEFAULT_ITEMS;
  const nodes: LoadNode[] = src.map((it, i) => ({
    name: it.name ?? `item-${i}`,
    material: it.material,
    mass_kg: it.mass_kg,
    T: it.initial_T_C != null ? C_to_K(it.initial_T_C) : T_ambient_K,
    m_water: 0,
    isWitness: it.witness ?? false,
    ...(it.embalagem ? { embalagem: it.embalagem } : {}),
  }));
  if (!nodes.some((n) => n.isWitness)) {
    nodes.push({
      name: 'testemunho',
      material: 'COTTON_TEXTILE',
      mass_kg: 0.05,
      T: T_ambient_K,
      m_water: 0,
      isWitness: true,
    });
  }
  return { nodes };
}
