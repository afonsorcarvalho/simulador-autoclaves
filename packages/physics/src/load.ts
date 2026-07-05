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

  const nodes = s.nodes.map((node) => {
    const m = MATERIALS[node.material];
    const A = estimateArea(node.mass_kg, m);

    // Convecção ∝ densidade do gás (→0 no vácuo)
    const h_conv = p.h0_conv * (e.rho_gas / e.rho_gas_atm);
    const Q_conv = h_conv * A * (e.T_gas - node.T); // W (gás→nó)

    // Radiação da jaqueta (domina no vácuo)
    const Q_rad = m.emissivity * SIGMA_SB * A * (e.T_jacket ** 4 - node.T ** 4); // W

    // Temperatura provisória (só sensível: convecção + radiação).
    const C = Math.max(node.mass_kg * m.cp + node.m_water * CP_WATER, 1e-6);
    const T_prov = node.T + ((Q_conv + Q_rad) * dt) / C;

    // Pinning de saturação bifásico: uma superfície com água livre é uma interface de
    // ebulição/condensação presa a T_sat(P_câmara). Excedente de calor evapora água (flash) em
    // vez de superaquecer; défice abaixo de T_sat num nó molhado/exposto a vapor condensa para
    // aquecer. Quase-estático (NÃO limitado por Δp): no patamar HOLD Δp≈0 mas o excedente de
    // radiação tem de evaporar na mesma — o pin é dirigido pelo desequilíbrio de energia,
    // limitado pela massa de água (flash) e pela capacidade + vapor disponível (condensação).
    const hv = h_vap_water(node.T);
    const T_boil = T_sat_water(e.p_vap_chamber);
    const cap = m.waterCapacity_kg_per_kg * node.mass_kg;
    let dWater = 0;
    let T_final = T_prov;
    if (node.m_water > 0 && T_prov > T_boil) {
      // Flash: evapora para puxar T até à ebulição, limitado pela água disponível.
      const surplus = C * (T_prov - T_boil); // J acima da ebulição
      const evap = Math.min(surplus / hv, node.m_water);
      dWater = -evap;
      T_final = T_prov - (evap * hv) / C; // chega a T_boil se houver água; senão fica acima (secou)
    } else if (T_prov < T_boil && e.chamber_vapor_kg > 0) {
      // Condensação: deposita vapor para puxar T até à ebulição, limitado pela capacidade do
      // material E pelo vapor disponível na câmara (50% p/ não esvaziar num passo — conservação).
      const deficit = C * (T_boil - T_prov); // J abaixo da ebulição
      const room = Math.max(0, cap - node.m_water);
      const cond = Math.min(deficit / hv, room, 0.5 * e.chamber_vapor_kg);
      dWater = cond;
      T_final = T_prov + (cond * hv) / C; // chega a T_boil se a capacidade/vapor permitir
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
