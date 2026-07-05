// packages/physics/src/load.ts
import { MATERIALS, estimateArea, type MaterialName } from './materials.js';
import { h_vap_water, T_sat_water } from './saturation.js';
import { CP_WATER, SIGMA_SB, C_to_K } from './constants.js';

export interface LoadNode {
  name: string;
  material: MaterialName;
  mass_kg: number;
  T: number; // K (estado)
  m_water: number; // kg (estado)
  isWitness?: boolean; // true = testemunho (referência p/ F0)
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
}

export interface LoadEnv {
  T_gas: number; // K
  rho_gas: number; // kg/m³
  rho_gas_atm: number; // kg/m³ (referência)
  T_jacket: number; // K
  p_sat_at: (T: number) => number; // Pa
  p_vap_chamber: number; // Pa
  chamber_has_vapor: boolean;
  chamber_vapor_kg: number; // kg de vapor disponível na câmara (limite p/ condensação, conservação)
}

export interface LoadStepResult {
  next: LoadState;
  Q_conv_from_gas: number; // W (positivo = retirado do gás)
  Q_rad_from_jacket: number; // W (positivo = retirado da jaqueta)
  vaporToChamber_kg: number; // Σ(evaporado − condensado) neste passo
}

export function load_step(s: LoadState, p: LoadParams, e: LoadEnv, dt: number): LoadStepResult {
  let Q_conv_total = 0;
  let Q_rad_total = 0;
  let vaporToChamber = 0;

  // Vapor da câmara é um recurso PARTILHADO entre nós. Orçamento total de condensação por passo
  // (50% do disponível, p/ não esvaziar a câmara num tick) decrementado à medida que cada nó
  // condensa — senão N nós puxariam cada um 50% e o total ultrapassaria o vapor real (massa fantasma).
  let condBudget = 0.5 * e.chamber_vapor_kg;

  const nodes = s.nodes.map((node) => {
    const m = MATERIALS[node.material];
    const A = estimateArea(node.mass_kg, m);
    const C = Math.max(node.mass_kg * m.cp + node.m_water * CP_WATER, 1e-6);
    const hv = h_vap_water(node.T);
    const T_boil = T_sat_water(e.p_vap_chamber);
    const cap = m.waterCapacity_kg_per_kg * node.mass_kg;
    const h_gas = p.h0_conv * (e.rho_gas / e.rho_gas_atm); // coef. de troca gás↔carga ∝ densidade

    // Radiação da jaqueta (domina no vácuo) — sempre presente.
    const Q_rad = m.emissivity * SIGMA_SB * A * (e.T_jacket ** 4 - node.T ** 4); // W

    let dWater = 0;
    let Q_conv = 0; // só o sensível seco entra aqui (o latente vem via massa de vapor)
    let T_final: number;

    if (node.T < T_boil - 1e-9 && condBudget > 0) {
      // REGIME DE CONDENSAÇÃO: em vapor saturado o calor chega POR condensação na superfície mais
      // fria — entrega calor latente E deposita água (não é convecção seca). q = h·A·(T_sat−T_carga);
      // água depositada = q·dt/h_vap. É isto que molha a carga no aquecimento (era o gap do come-up).
      const room = Math.max(0, cap - node.m_water);
      const q_drive = h_gas * A * (T_boil - node.T); // W potencial de condensação
      const dep = Math.min((q_drive * dt) / hv, room, condBudget); // kg realmente condensados
      const Q_cond = (dep * hv) / dt; // W efetivamente entregues (limitado por room/orçamento)
      dWater = dep;
      condBudget -= dep;
      let T_new = node.T + ((Q_cond + Q_rad) * dt) / C;
      if (T_new > T_boil) T_new = T_boil; // não ultrapassa a ebulição por condensação (pinned)
      T_final = T_new;
    } else {
      // REGIME SECO / SUPERAQUECIDO / SEM VAPOR: sensível seco (convecção ∝ρ) + radiação.
      Q_conv = h_gas * A * (e.T_gas - node.T); // W (gás→nó)
      const T_prov = node.T + ((Q_conv + Q_rad) * dt) / C;
      if (node.m_water > 0 && T_prov > T_boil) {
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

    Q_conv_total += Q_conv;
    Q_rad_total += Q_rad;
    return { ...node, T: T_final, m_water: node.m_water + dWater };
  });

  return {
    next: { nodes },
    Q_conv_from_gas: Q_conv_total,
    Q_rad_from_jacket: Q_rad_total,
    vaporToChamber_kg: vaporToChamber,
  };
}

export interface LoadItemConfig {
  name?: string;
  material: MaterialName;
  mass_kg: number;
  initial_T_C?: number;
  witness?: boolean;
}

const DEFAULT_ITEMS: LoadItemConfig[] = [
  { name: 'load', material: 'STAINLESS_316', mass_kg: 20 },
  { name: 'testemunho', material: 'COTTON_TEXTILE', mass_kg: 5, witness: true },
];

/** Constrói o LoadState a partir de itens de config; carga-default quando ausente;
 *  injeta um nó testemunho se nenhum item o for. */
export function buildLoadState(items: LoadItemConfig[] | undefined, T_ambient_K: number): LoadState {
  const src = items && items.length > 0 ? items : DEFAULT_ITEMS;
  const nodes: LoadNode[] = src.map((it, i) => ({
    name: it.name ?? `item-${i}`,
    material: it.material,
    mass_kg: it.mass_kg,
    T: it.initial_T_C != null ? C_to_K(it.initial_T_C) : T_ambient_K,
    m_water: 0,
    isWitness: it.witness ?? false,
  }));
  if (!nodes.some((n) => n.isWitness)) {
    nodes.push({ name: 'testemunho', material: 'COTTON_TEXTILE', mass_kg: 0.05, T: T_ambient_K, m_water: 0, isWitness: true });
  }
  return { nodes };
}
