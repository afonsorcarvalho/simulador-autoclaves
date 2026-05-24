import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../src/integrator.js';
import {
  GAMMA_AIR, GAMMA_VAP, R_AIR, R_VAP, P_ATM,
  C_to_K, K_to_C, Pa_to_bar, bar_to_Pa,
} from '../src/constants.js';
import { chamber_pressure } from '../src/chamber.js';

function basicParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 24000 },
    load: {
      m_metal: 20, cp_metal: 500, m_fabric: 5, cp_fabric: 1500,
      h_gas_metal: 500, h_metal_fabric: 30,
    },
    valves: {
      V_STEAM_IN_INT: { from: 'generator', to: 'chamber', params: { Cv: 1e-5, gamma: GAMMA_VAP, R: R_VAP } },
      V_VAC:          { from: 'chamber',   to: 'vacuum',  params: { Cv: 5e-5, gamma: GAMMA_AIR, R: R_AIR } },
      V_AIR_IN:       { from: 'atmosphere', to: 'chamber', params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR } },
    },
    external: { steam_line_pressure: bar_to_Pa(5), steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
  };
}

function basicState(): SystemState {
  const T = C_to_K(22);
  const m_air_chamber = (P_ATM * 0.15) / (R_AIR * T);
  const m_air_jacket = (P_ATM * 0.025) / (R_AIR * T);
  return {
    chamber: { m_air: m_air_chamber, m_vap: 0, m_liq: 0, T },
    jacket: { m_air: m_air_jacket, m_vap: 0, m_liq: 0, T },
    generator: { m_water_liq: 30, m_water_vap: 0, T: C_to_K(22) },
    load: { T_metal: T, T_fabric: T },
    f0_minutes: 0,
    time_s: 0,
  };
}

describe('system_step', () => {
  it('advances time_s by dt', () => {
    const s = basicState();
    const p = basicParams();
    const next = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.01);
    expect(next.time_s).toBeCloseTo(0.01, 6);
  });

  it('vacuum drops chamber pressure when V_VAC open and pump on', () => {
    const s = basicState();
    const p = basicParams();
    let cur = s;
    for (let i = 0; i < 3000; i++) {
      cur = system_step(cur, p, { V_VAC: true }, { heater_gen: false, pump_vac: true }, 0.01);
    }
    const p_chamber_air = (cur.chamber.m_air * R_AIR * cur.chamber.T) / p.chamber.V;
    expect(Pa_to_bar(p_chamber_air)).toBeLessThan(0.5);
  });

  it('vacuum valve has NO effect when pump is off', () => {
    const s = basicState();
    const p = basicParams();
    let cur = s;
    for (let i = 0; i < 100; i++) {
      cur = system_step(cur, p, { V_VAC: true }, { heater_gen: false, pump_vac: false }, 0.01);
    }
    // Air mass should be essentially unchanged (no flow without pump)
    expect(cur.chamber.m_air).toBeCloseTo(s.chamber.m_air, 4);
  });

  it('steam injection from saturated generator raises chamber T and adds vapor', () => {
    const s = basicState();
    const p = basicParams();
    s.generator!.T = C_to_K(150);
    s.generator!.m_water_vap = 0.5;
    let cur = s;
    for (let i = 0; i < 1500; i++) {
      cur = system_step(cur, p, { V_STEAM_IN_INT: true }, { heater_gen: true, pump_vac: false }, 0.01);
    }
    expect(cur.chamber.T).toBeGreaterThan(C_to_K(40));
    expect(cur.chamber.m_vap).toBeGreaterThan(0);
  });

  it('F0 accumulates when testemunho (T_fabric) ≥ 100°C', () => {
    const s = basicState();
    const p = basicParams();
    s.load = { T_metal: C_to_K(134), T_fabric: C_to_K(134) };
    let cur = s;
    for (let i = 0; i < 6000; i++) {
      cur = system_step(cur, p, {}, { heater_gen: false, pump_vac: false }, 0.01);
    }
    expect(cur.f0_minutes).toBeGreaterThan(15);
  });

  it('air admission valve fills evacuated chamber from atmosphere', () => {
    const s = basicState();
    const p = basicParams();
    s.chamber.m_air = s.chamber.m_air * 0.01;
    let cur = s;
    for (let i = 0; i < 1000; i++) {
      cur = system_step(cur, p, { V_AIR_IN: true }, { heater_gen: false, pump_vac: false }, 0.01);
    }
    expect(cur.chamber.m_air).toBeGreaterThan(s.chamber.m_air);
  });
});
