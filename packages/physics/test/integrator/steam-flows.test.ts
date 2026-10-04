import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { buildLoadState } from '../../src/load.js';
import { chamber_pressure } from '../../src/chamber.js';
import { generator_pressure } from '../../src/generator.js';
import { choked_flow } from '../../src/valve.js';
import { GAMMA_AIR, GAMMA_VAP, R_AIR, R_VAP, P_ATM, C_to_K, bar_to_Pa } from '../../src/constants.js';

function params(): SystemParams {
  return {
    chamber: { V: 0.5, allowLiquid: true, wall_mass_kg: 150, drain_kg_per_s: 2e-5 },
    jacket: { V: 0.08, allowLiquid: false, wall_mass_kg: 60 },
    generator: { V_total: 0.05, heater_power_W: 36000 },
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
    valves: {
      V_STEAM_IN_INT: { from: 'generator', to: 'chamber', params: { Cv: 1e-5, gamma: GAMMA_VAP, R: R_VAP } },
      V_STEAM_IN_JACKET: { from: 'generator', to: 'jacket', params: { Cv: 5e-6, gamma: GAMMA_VAP, R: R_VAP } },
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 5e-5, gamma: GAMMA_AIR, R: R_AIR } },
      V_EXHAUST: { from: 'chamber', to: 'atmosphere', params: { Cv: 1e-5, gamma: GAMMA_AIR, R: R_AIR } },
      V_AIR_IN: { from: 'atmosphere', to: 'chamber', params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR } },
    },
    external: { steam_line_pressure: bar_to_Pa(5), steam_line_T: C_to_K(160), atmosphere_T: C_to_K(23) },
    vacuum_pump: { S_nom_m3_per_s: 0.01, p_ult_Pa: 3000, vapor_factor: 1.5 },
  };
}

function state(): SystemState {
  const T = C_to_K(23);
  return {
    chamber: { m_air: (P_ATM * 0.5) / (R_AIR * T), m_vap: 0, m_liq: 0, T },
    jacket: { m_air: 0, m_vap: 0.05, m_liq: 0, T: C_to_K(138) },
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: buildLoadState(undefined, T),
    f0_minutes: 0,
    time_s: 0,
  };
}

const mass = (s: SystemState) => s.chamber.m_air + s.chamber.m_vap + s.chamber.m_liq;
const act = { heater_gen: true, pump_vac: true };

describe('fluxos por caminho (consumo de vapor)', () => {
  it('vapor injetado = vazão da válvula·dt e ≥ 0', () => {
    const s = state();
    const p = params();
    const n = system_step(s, p, { V_STEAM_IN_INT: true }, act, 0.05);
    const pg = generator_pressure(s.generator!, p.generator!);
    const pc = chamber_pressure(s.chamber, p.chamber).p_total;
    const m = choked_flow(pg, s.generator!.T, pc, p.valves.V_STEAM_IN_INT!.params) * 0.05;
    expect(n.flows!.steam_in_chamber_kg).toBeGreaterThan(0);
    expect(n.flows!.steam_in_chamber_kg).toBeCloseTo(m, 12);
    expect(n.flows!.steam_in_jacket_kg).toBe(0);
    expect(n.flows!.steam_in_H_J).toBeGreaterThan(m * 2.5e6);
  });

  it('balanço de massa da câmara fecha num trecho (Δm = entradas − saídas)', () => {
    const p = params();
    let s = state();
    const seq: [Record<string, boolean>, number][] = [
      [{ V_VAC: true }, 1200], // vácuo
      [{ V_STEAM_IN_INT: true, V_STEAM_IN_JACKET: true }, 1200], // injeção
      [{ V_STEAM_IN_INT: true, V_EXHAUST: true }, 600], // purga
      [{ V_EXHAUST: true }, 600],
      [{ V_AIR_IN: true }, 600],
    ];
    const m0 = mass(s);
    let ent = 0,
      sai = 0,
      steam = 0,
      jk = 0;
    for (const [v, n] of seq)
      for (let i = 0; i < n; i++) {
        s = system_step(s, p, v, act, 0.05);
        const f = s.flows!;
        for (const x of Object.values(f)) expect(x).toBeGreaterThanOrEqual(0);
        ent += f.steam_in_chamber_kg + f.air_in_kg + f.door_air_in_kg;
        ent += (s.evap_load_kg ?? 0) + (s.load_to_chamber_kg ?? 0) - (s.cond_load_kg ?? 0);
        sai += f.exhaust_air_kg + f.exhaust_vap_kg + f.vacuum_air_kg + f.vacuum_vap_kg;
        sai += f.door_air_out_kg + f.door_vap_out_kg + (s.drain_kg ?? 0);
        steam += f.steam_in_chamber_kg;
        jk += f.jacket_cond_kg;
      }
    expect(steam).toBeGreaterThan(0.1);
    expect(jk).toBeGreaterThan(0);
    expect(Math.abs(mass(s) - m0 - (ent - sai))).toBeLessThan(1e-3 * steam);
  });

  it('porta aberta: troca entra/sai e o balanço fecha', () => {
    const p = { ...params(), door_open: 1 };
    let s = state();
    s = { ...s, chamber: { ...s.chamber, m_vap: 0.3, T: C_to_K(120) } };
    const m0 = mass(s);
    let net = 0;
    for (let i = 0; i < 200; i++) {
      s = system_step(s, p, {}, act, 0.05);
      const f = s.flows!;
      net += f.door_air_in_kg - f.door_air_out_kg - f.door_vap_out_kg - (s.drain_kg ?? 0);
      net += (s.evap_load_kg ?? 0) + (s.load_to_chamber_kg ?? 0) - (s.cond_load_kg ?? 0);
    }
    expect(Math.abs(mass(s) - m0 - net)).toBeLessThan(1e-3);
  });
});
