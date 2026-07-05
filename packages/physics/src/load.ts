// packages/physics/src/load.ts
import { MATERIALS, estimateArea, type MaterialName } from './materials.js';
import { h_vap_water } from './saturation.js';
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

    // Mudança de fase dirigida por pressão (simétrica): Δp = p_sat(T_nó) − p_vap_câmara
    const dp = e.p_sat_at(node.T) - e.p_vap_chamber;
    let dWater = 0;
    if (dp > 0 && node.m_water > 0) {
      // Evaporação/flash: água sai do nó
      const m_ev = Math.min(p.k_ev * A * dp * dt, node.m_water);
      dWater = -m_ev;
    } else if (dp < 0 && e.chamber_has_vapor) {
      // Condensação: vapor deposita-se no nó, até à capacidade do material
      const cap = m.waterCapacity_kg_per_kg * node.mass_kg;
      const m_cond = Math.min(p.k_cond * A * -dp * dt, Math.max(0, cap - node.m_water));
      dWater = m_cond;
    }
    vaporToChamber += -dWater; // condensação (dWater>0) retira vapor da câmara

    // Calor latente: condensação (dWater>0) aquece o nó; evaporação (dWater<0) arrefece
    const Q_lat_energy = dWater * h_vap_water(node.T); // J

    // Massa térmica (usa água pré-passo)
    const C = Math.max(node.mass_kg * m.cp + node.m_water * CP_WATER, 1e-6);
    const dU = (Q_conv + Q_rad) * dt + Q_lat_energy;
    const T_new = node.T + dU / C;

    Q_conv_total += Q_conv;
    Q_rad_total += Q_rad;
    return { ...node, T: T_new, m_water: node.m_water + dWater };
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
