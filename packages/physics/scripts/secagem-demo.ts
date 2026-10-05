// Demonstração: item molhado a 134 °C, câmara em vácuo de secagem (50 mbar de vapor), parede a 130 °C.
// Uso: pnpm exec tsx scripts/secagem-demo.ts
import { load_step, type LoadState, type LoadNode } from '../src/load.js';
import { p_sat_water } from '../src/saturation.js';
import { C_to_K, K_to_C } from '../src/constants.js';
import { secagemEN285, type Embalagem } from '../src/drying.js';

const casos: Array<[string, Partial<LoadNode> & Pick<LoadNode, 'material' | 'mass_kg' | 'm_water'>, Embalagem]> = [
  ['algodão 5 kg exposto', { material: 'COTTON_TEXTILE', mass_kg: 5, m_water: 0.6 }, 'nenhuma'],
  ['pacote têxtil 5 kg', { material: 'COTTON_TEXTILE', mass_kg: 5, m_water: 0.6 }, 'pacote_textil'],
  ['inox 10 kg exposto', { material: 'STAINLESS_316', mass_kg: 10, m_water: 0.2 }, 'nenhuma'],
  ['caixa inox 10 kg SMS', { material: 'STAINLESS_316', mass_kg: 10, m_water: 0.2 }, 'caixa_sms'],
  ['inox 1 kg grau cirúrgico', { material: 'STAINLESS_316', mass_kg: 1, m_water: 0.02 }, 'grau_cirurgico'],
];
const dt = 0.05;
const p_ch = 5000;
for (const [nome, base, emb] of casos) {
  let s: LoadState = {
    nodes: [{ name: nome, T: C_to_K(134), isWitness: true, embalagem: emb, m_water_max: base.m_water, ...base }],
  };
  const marcas: string[] = [];
  for (let i = 1; i <= (30 * 60) / dt; i++) {
    s = load_step(
      s,
      { h0_conv: 30, k_cond: 0, k_ev: 0 },
      {
        T_gas: C_to_K(60), rho_gas: 0.03, rho_gas_atm: 0.6, T_wall: C_to_K(130), p_sat_at: p_sat_water,
        p_vap_chamber: p_ch, chamber_has_vapor: true, chamber_vapor_kg: 0.02, y_vap: 1,
      },
      dt,
    ).next;
    const t = i * dt;
    if ([60, 300, 600, 1200, 1800].some((m) => Math.abs(t - m) < dt / 2)) {
      const n = s.nodes[0]!;
      marcas.push(`${t / 60}min: ${(n.m_water * 1000).toFixed(0)} g, ${K_to_C(n.T).toFixed(0)} °C`);
    }
  }
  const n = s.nodes[0]!;
  const r = secagemEN285(emb, n.m_water, n.mass_kg);
  console.log(`${nome.padEnd(26)} | ${marcas.join(' | ')} | EN285 ${(r.ganho * 100).toFixed(2)}% (lim ${(r.limite * 100).toFixed(1)}%) ${r.aprovado ? 'OK' : 'MOLHADO'}`);
}
