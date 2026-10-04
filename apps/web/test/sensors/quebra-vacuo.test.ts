import { describe, it, expect } from 'vitest';
import {
  system_step,
  buildLoadState,
  p_sat_water,
  T_sat_water,
  C_to_K,
  K_to_C,
  bar_to_Pa,
  chamber_pressure,
  P_ATM,
  R_AIR,
  R_VAP,
  GAMMA_AIR,
  GAMMA_VAP,
  type SystemParams,
  type SystemState,
  type ValveCommands,
} from '@sim/physics';
import { DrainProbe } from '../../server/sensors/drain-probe.js';

// Bancada com CLP real: câmara 500 L, parede 150 kg, camisa mantida ~135 °C. Depois da secagem a
// vácuo, a quebra com ar ambiente levava câmara/dreno a ~111 °C (acoplamento gás↔parede de vapor
// aplicado ao ar). Na máquina real ficam em 60–80 °C.
const dt = 0.05;
const T_JACKET = C_to_K(135);
const GEN_FIXED = { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) };

function params(): SystemParams {
  const V = 0.5;
  return {
    chamber: {
      V,
      allowLiquid: true,
      wall_mass_kg: 150,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 200,
      wall_h_air_W_per_K: 15,
      wall_h_steam_dry_W_per_K: 100,
      relief_pressure_Pa: bar_to_Pa(4),
      h_ambient_W_per_K: 20,
      drain_kg_per_s: 4e-5,
    },
    jacket: {
      V: (0.025 * V) / 0.15,
      allowLiquid: false,
      wall_mass_kg: 45,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 100,
    },
    generator: { V_total: 0.05, heater_power_W: 56000, relief_pressure_Pa: bar_to_Pa(4.54) },
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
    valves: {
      V_STEAM_IN_INT: {
        from: 'generator',
        to: 'chamber',
        params: { Cv: 2e-5, gamma: GAMMA_VAP, R: R_VAP },
      },
      V_EXHAUST: {
        from: 'chamber',
        to: 'atmosphere',
        params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR },
      },
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR } },
      V_AIR_IN: {
        from: 'atmosphere',
        to: 'chamber',
        params: { Cv: 2.8e-5, gamma: GAMMA_AIR, R: R_AIR },
      },
    },
    vacuum_pump: { S_nom_m3_per_s: 75 / 3600, p_ult_Pa: 1000, vapor_factor: 1.7 },
    external: {
      steam_line_pressure: bar_to_Pa(5),
      steam_line_T: C_to_K(160),
      atmosphere_T: C_to_K(23),
    },
    jacket_chamber_h_W_per_K: 150,
  };
}

/** Camisa mantida pelo CLP: vapor saturado a 135 °C. */
function jacketFixed(p: SystemParams): SystemState['jacket'] {
  const m_vap = (p_sat_water(T_JACKET) * p.jacket.V) / (R_VAP * T_JACKET);
  return { m_air: 0, m_vap, m_liq: 0, T: T_JACKET, T_wall: T_JACKET };
}

export interface CicloResultado {
  t_134_s: number;
  t_carga_s: number;
  T_ester_C: number;
  /** Máx. de T_câmara − T_sat(P_câmara) com P > 1,2 bar no aquecimento + esterilização. */
  sobreaq_max_C: number;
  Tc_max_C: number;
  quebra: { min: number; camara: number; dreno: number; carga: number }[];
}

export function cicloBancada(p: SystemParams): CicloResultado {
  const T_amb = p.external.atmosphere_T;
  let s: SystemState = {
    chamber: {
      m_air: (P_ATM * p.chamber.V) / (R_AIR * T_amb),
      m_vap: 0,
      m_liq: 0,
      T: T_amb,
      T_wall: T_JACKET,
    },
    jacket: jacketFixed(p),
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: buildLoadState(undefined, T_amb),
    f0_minutes: 0,
    time_s: 0,
  };
  const dreno = new DrainProbe();
  const P = () => chamber_pressure(s.chamber, p.chamber).p_total;
  let sobreaq_max_C = -Infinity;
  let Tc_max_C = -Infinity;
  let medir = false;
  const step = (v: ValveCommands, pump = false) => {
    s = system_step(s, p, v, { heater_gen: true, pump_vac: pump }, dt);
    // Camisa e gerador fixos: a bancada mede câmara/dreno/carga; o boiler é fonte "infinita"
    // (sem reposição de água, a física honesta do alívio secaria 10 kg no ciclo longo).
    s = { ...s, jacket: jacketFixed(p), generator: { ...GEN_FIXED } };
    dreno.step(s, p, dt);
    if (medir && P() > 120000) {
      sobreaq_max_C = Math.max(sobreaq_max_C, s.chamber.T - T_sat_water(P()));
      Tc_max_C = Math.max(Tc_max_C, K_to_C(s.chamber.T));
    }
  };
  const Tc = () => K_to_C(s.chamber.T);
  const Tcarga = () => K_to_C(Math.min(...s.load.nodes.map((nd) => nd.T)));

  // Pré-vácuo: 3 pulsos (vácuo 150 mbar / vapor 1,5 bar), depois liga-desliga 134–135 °C na
  // câmara até a carga (nó mais frio) chegar a 134 °C; então 4 min de esterilização.
  for (let k = 0; k < 3; k++) {
    while (P() > 15000) step({ V_VAC: true }, true);
    while (P() < 150000) step({ V_STEAM_IN_INT: true });
  }
  while (P() > 15000) step({ V_VAC: true }, true);
  const t0 = s.time_s;
  medir = true;
  let t_134_s = NaN;
  let t_carga_s = NaN;
  let on = true;
  const ctrl = () => {
    on = Tc() < 134 ? true : Tc() > 135 ? false : on;
    step({ V_STEAM_IN_INT: on });
  };
  for (let i = 0; i < 1200 / dt && Number.isNaN(t_carga_s); i++) {
    ctrl();
    if (Number.isNaN(t_134_s) && Tc() >= 134) t_134_s = s.time_s - t0;
    if (Tcarga() >= 134) t_carga_s = s.time_s - t0;
  }
  let soma = 0;
  let n = 0;
  for (let i = 0; i < 240 / dt; i++) {
    ctrl();
    soma += Tc();
    n++;
  }
  medir = false;
  // Despressurização, secagem a vácuo ~50 mbar por 5 min.
  while (P() > 1.1 * P_ATM) step({ V_EXHAUST: true });
  while (P() > 5000) step({ V_VAC: true }, true);
  for (let i = 0; i < 300 / dt; i++) step({ V_VAC: P() > 5000 }, true);
  // Quebra de vácuo: ar ambiente até 1 atm (válvula aberta).
  const quebra: CicloResultado['quebra'] = [];
  const marcas = [1, 3, 5, 10];
  for (let i = 1; i <= 600 / dt; i++) {
    step({ V_AIR_IN: true });
    const min = (i * dt) / 60;
    if (marcas.some((m) => Math.abs(m - min) < dt / 120)) {
      const carga = Tcarga();
      quebra.push({ min: Math.round(min), camara: Tc(), dreno: dreno.value_C!, carga });
    }
  }
  return { t_134_s, t_carga_s, T_ester_C: soma / n, sobreaq_max_C, Tc_max_C, quebra };
}

describe('quebra de vácuo com ar (câmara 500 L, camisa 135 °C)', () => {
  it('câmara e dreno ficam em 60–80 °C 5 min após a quebra', () => {
    const r = cicloBancada(params());
    console.log(JSON.stringify(r));
    const q5 = r.quebra.find((q) => q.min === 5)!;
    expect(q5.camara).toBeGreaterThanOrEqual(60);
    expect(q5.camara).toBeLessThanOrEqual(80);
    expect(q5.dreno).toBeGreaterThanOrEqual(60);
    expect(q5.dreno).toBeLessThanOrEqual(80);
  }, 300000);

  it('sem superaquecimento irreal: câmara ≤ T_sat(P)+5 °C e ≤ 138 °C no aquecimento/esterilização', () => {
    const r = cicloBancada(params());
    expect(r.sobreaq_max_C).toBeLessThanOrEqual(5);
    expect(r.Tc_max_C).toBeLessThanOrEqual(138);
  }, 300000);

  it('aquecimento e esterilização quase iguais ao acoplamento fixo antigo (h_ar = h_vapor)', () => {
    const novo = cicloBancada(params());
    const p = params();
    p.chamber.wall_h_air_W_per_K = 200; // = h_vapor: acoplamento antigo, independente da composição
    const antigo = cicloBancada(p);
    console.log(JSON.stringify({ antigo, novo }));
    // 10 %: com o latente recalibrado (u_fg) o acoplamento por composição ficou ~5,5 % mais lento
    // que o fixo (151 → 159 s); a esterilização continua igual dentro de 0,1 K.
    expect(Math.abs(novo.t_carga_s - antigo.t_carga_s)).toBeLessThan(0.1 * antigo.t_carga_s);
    expect(Math.abs(novo.T_ester_C - antigo.T_ester_C)).toBeLessThan(0.1);
  }, 300000);
});
