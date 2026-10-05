// Curvas de secagem (CSV) para as figuras do artigo/guia: item molhado a 134 °C em vácuo de 50 mbar,
// parede a 130 °C. Uso: pnpm exec tsx scripts/secagem-curvas.ts > curvas.csv
import { load_step, type LoadState, type LoadNode } from '../src/load.js';
import { p_sat_water } from '../src/saturation.js';
import { C_to_K, K_to_C } from '../src/constants.js';
import { secagemEN285, type Embalagem } from '../src/drying.js';

const casos: Array<[string, Pick<LoadNode, 'material' | 'mass_kg' | 'm_water'>, Embalagem]> = [
  ['algodao_exposto', { material: 'COTTON_TEXTILE', mass_kg: 5, m_water: 0.6 }, 'nenhuma'],
  ['pacote_textil', { material: 'COTTON_TEXTILE', mass_kg: 5, m_water: 0.6 }, 'pacote_textil'],
  ['inox_exposto', { material: 'STAINLESS_316', mass_kg: 10, m_water: 0.2 }, 'nenhuma'],
  ['caixa_sms', { material: 'STAINLESS_316', mass_kg: 10, m_water: 0.2 }, 'caixa_sms'],
  ['grau_cirurgico', { material: 'STAINLESS_316', mass_kg: 1, m_water: 0.02 }, 'grau_cirurgico'],
];
const dt = 0.05;
console.log('caso,t_min,agua_g,ganho_pct,limite_pct,T_C');
for (const [nome, base, emb] of casos) {
  let s: LoadState = {
    nodes: [{ name: nome, T: C_to_K(134), isWitness: true, embalagem: emb, m_water_max: base.m_water, ...base }],
  };
  for (let i = 0; i <= (40 * 60) / dt; i++) {
    if (i % Math.round(10 / dt) === 0) {
      const n = s.nodes[0]!;
      const r = secagemEN285(emb, n.m_water, n.mass_kg);
      console.log([nome, ((i * dt) / 60).toFixed(3), (n.m_water * 1000).toFixed(2), (r.ganho * 100).toFixed(4), (r.limite * 100).toFixed(2), K_to_C(n.T).toFixed(2)].join(','));
    }
    s = load_step(
      s,
      { h0_conv: 30, k_cond: 0, k_ev: 0 },
      {
        T_gas: C_to_K(60), rho_gas: 0.03, rho_gas_atm: 0.6, T_wall: C_to_K(130), p_sat_at: p_sat_water,
        p_vap_chamber: 5000, chamber_has_vapor: true, chamber_vapor_kg: 0.02, y_vap: 1,
      },
      dt,
    ).next;
  }
}
