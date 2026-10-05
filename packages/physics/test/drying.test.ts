import { describe, it, expect } from 'vitest';
import { load_step, type LoadState, type LoadNode } from '../src/load.js';
import { p_sat_water } from '../src/saturation.js';
import { C_to_K } from '../src/constants.js';
import {
  condutanciaCamada,
  taxaEvaporacao,
  secagemEN285,
  atividadeAgua,
  EMBALAGEM_PARAMS,
  type Embalagem,
} from '../src/drying.js';

/** Item molhado a 134 °C em vácuo de secagem (50 mbar), parede a 130 °C, por `min` minutos. */
function secar(base: Pick<LoadNode, 'material' | 'mass_kg' | 'm_water'>, emb: Embalagem, min: number) {
  let s: LoadState = {
    nodes: [{ name: 'x', T: C_to_K(134), isWitness: true, embalagem: emb, m_water_max: base.m_water, ...base }],
  };
  const dt = 0.05;
  for (let i = 0; i < (min * 60) / dt; i++) {
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
  return s.nodes[0]!;
}

describe('secagem de itens embalados', () => {
  it('vapor passa fácil por SMS em vácuo (Knudsen+viscoso): embalagem fina não é o gargalo', () => {
    const G = condutanciaCamada(EMBALAGEM_PARAMS.caixa_sms.barreira!, 0.1, 3000, C_to_K(60));
    // 0,1 m², Δp 1000 Pa
    expect(G * 1000).toBeGreaterThan(5e-4); // ≥ 0,5 g/s; a energia evapora ~0,04 g/s
  });

  it('condutância cresce com a pressão (parcela viscosa)', () => {
    const c = EMBALAGEM_PARAMS.pacote_textil.barreira!;
    expect(condutanciaCamada(c, 1, 50000, 373)).toBeGreaterThan(condutanciaCamada(c, 1, 500, 373));
  });

  it('pacote têxtil seca mais devagar que o mesmo algodão exposto (frente seca no tecido)', () => {
    const exposto = secar({ material: 'COTTON_TEXTILE', mass_kg: 5, m_water: 0.6 }, 'nenhuma', 5);
    const pacote = secar({ material: 'COTTON_TEXTILE', mass_kg: 5, m_water: 0.6 }, 'pacote_textil', 5);
    expect(pacote.m_water).toBeGreaterThan(2 * exposto.m_water);
  });

  it('caixa em SMS: condensado empoçado seca muito mais devagar que instrumental exposto', () => {
    const exposto = secar({ material: 'STAINLESS_316', mass_kg: 10, m_water: 0.2 }, 'nenhuma', 5);
    const caixa = secar({ material: 'STAINLESS_316', mass_kg: 10, m_water: 0.2 }, 'caixa_sms', 5);
    expect(exposto.m_water).toBeLessThan(0.005);
    expect(caixa.m_water).toBeGreaterThan(0.1); // > metade ainda empoçada em 5 min
  });

  it('caixa empoçada: metal fica acima da ebulição (calor não chega à poça), exposto cai para T_sat', () => {
    const caixa = secar({ material: 'STAINLESS_316', mass_kg: 10, m_water: 0.2 }, 'caixa_sms', 1);
    expect(caixa.T).toBeGreaterThan(C_to_K(100));
  });

  it('taxa de evaporação é zero sem água e quando a câmara está acima da saturação', () => {
    const base = {
      emb: EMBALAGEM_PARAMS.pacote_textil, massa_seca_kg: 5, area_item_m2: 0.5, m_agua_ref_kg: 0.6,
      T_item_K: C_to_K(50),
    };
    expect(taxaEvaporacao({ ...base, m_agua_kg: 0, p_camara_Pa: 1000 }, 2.3e6).taxa).toBe(0);
    expect(taxaEvaporacao({ ...base, m_agua_kg: 0.3, p_camara_Pa: 3e5 }, 2.3e6).taxa).toBe(0);
  });

  it('água ligada nas fibras: atividade < 1 abaixo da umidade de ligação', () => {
    expect(atividadeAgua(0.1, 0.06)).toBe(1);
    expect(atividadeAgua(0.03, 0.06)).toBeCloseTo(0.5, 6);
  });

  it('critério EN 285: têxtil ≤ 1 %, metal ≤ 0,2 % de ganho de massa', () => {
    expect(secagemEN285('pacote_textil', 0.04, 5).aprovado).toBe(true); // 0,8 %
    expect(secagemEN285('pacote_textil', 0.06, 5).aprovado).toBe(false); // 1,2 %
    expect(secagemEN285('caixa_sms', 0.03, 10).aprovado).toBe(false); // 0,3 %
  });
});
