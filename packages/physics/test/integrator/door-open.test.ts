import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { chamber_pressure } from '../../src/chamber.js';
import { buildLoadState } from '../../src/load.js';
import { R_AIR, P_ATM, C_to_K } from '../../src/constants.js';

// Câmara de 500 L / parede 150 kg (configuração atual da bancada), quente com vapor a 134 °C,
// camisa fria (sem acoplamento salvo quando o teste pede) para isolar o efeito da porta.
const T_AMB = C_to_K(23);

function params(door_open: number, h_jc = 0): SystemParams {
  return {
    chamber: { V: 0.5, allowLiquid: true, wall_mass_kg: 150, wall_cp_J_per_kg_K: 500 },
    jacket: { V: 0.08, allowLiquid: false, wall_mass_kg: 50 },
    generator: null,
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
    valves: {},
    external: { steam_line_pressure: 5e5, steam_line_T: C_to_K(160), atmosphere_T: T_AMB },
    jacket_chamber_h_W_per_K: h_jc,
    door_open,
  };
}

function hotState(jacketT = T_AMB): SystemState {
  const T = C_to_K(134);
  return {
    chamber: { m_air: 0, m_vap: (3e5 * 0.5) / (461.5 * T), m_liq: 0, T, T_wall: T },
    jacket: {
      m_air: (P_ATM * 0.08) / (R_AIR * jacketT),
      m_vap: 0,
      m_liq: 0,
      T: jacketT,
      T_wall: jacketT,
    },
    generator: null,
    load: buildLoadState([], T),
    f0_minutes: 0,
    time_s: 0,
  };
}

function run(s: SystemState, p: SystemParams, seconds: number): SystemState {
  const dt = 0.05;
  for (let t = 0; t < seconds; t += dt)
    s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, dt);
  return s;
}

describe('porta aberta', () => {
  it('esfria parede e gás em direção à T ambiente', () => {
    const s = run(hotState(), params(1), 300);
    expect(s.chamber.T_wall!).toBeLessThan(C_to_K(134) - 2);
    expect(s.chamber.T_wall!).toBeGreaterThan(T_AMB);
    // gás fica entre a parede (acoplamento forte) e o ar que entra
    expect(s.chamber.T).toBeLessThan(C_to_K(134) - 20);
    expect(s.chamber.T).toBeLessThanOrEqual(s.chamber.T_wall! + 0.5);
    expect(s.chamber.T).toBeGreaterThan(T_AMB - 1);
    // ar ambiente entrou, vapor saiu
    expect(s.chamber.m_air).toBeGreaterThan(0.3);
    expect(s.chamber.m_vap).toBeLessThan(0.05);
  });

  it('duas portas esfriam mais rápido que uma', () => {
    const one = run(hotState(), params(1), 300);
    const two = run(hotState(), params(2), 300);
    expect(two.chamber.T_wall!).toBeLessThan(one.chamber.T_wall! - 1);
  });

  it('porta fechada (a=0) não muda nada em relação a sem o campo', () => {
    const p0 = params(0);
    const { door_open: _d, ...pNo } = p0;
    const a = run(hotState(), p0, 10);
    const b = run(hotState(), pNo as SystemParams, 10);
    expect(a).toEqual(b);
  });

  it('porta fechada com camisa quente reaquece a parede fria', () => {
    const s0 = hotState(C_to_K(138));
    s0.chamber = {
      m_air: (P_ATM * 0.5) / (R_AIR * C_to_K(60)),
      m_vap: 0,
      m_liq: 0,
      T: C_to_K(60),
      T_wall: C_to_K(60),
    };
    const s = run(s0, params(0, 150), 120);
    expect(s.chamber.T_wall!).toBeGreaterThan(C_to_K(60) + 1);
  });

  it('porta aberta iguala a pressão à atmosférica em ~2 s e não oscila (câmara quente condensando)', () => {
    const p = params(1);
    let s = hotState();
    const dt = 0.05;
    let maxDev = 0;
    for (let t = 0; t < 120; t += dt) {
      s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, dt);
      const pt = chamber_pressure(s.chamber, p.chamber).p_total;
      if (t >= 2) maxDev = Math.max(maxDev, Math.abs(pt - P_ATM));
    }
    console.log(`desvio máx. de pressão (porta aberta, t≥2 s): ${(maxDev / 1e5).toFixed(4)} bar`);
    expect(maxDev).toBeLessThan(1000); // ±0,01 bar
  });

  it('balanço de massa fecha com porta aberta', () => {
    const p = params(1);
    let s = hotState();
    const dt = 0.05;
    const tot = (x: SystemState) => x.chamber.m_air + x.chamber.m_vap + x.chamber.m_liq;
    let net = 0;
    const m0 = tot(s);
    for (let t = 0; t < 30; t += dt) {
      s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, dt);
      const f = (s as any).flows ?? {};
      net += (f.door_air_in_kg ?? 0) - (f.door_air_out_kg ?? 0) - (f.door_vap_out_kg ?? 0);
    }
    expect(Math.abs(tot(s) - m0 - net)).toBeLessThan(1e-6 * Math.max(1, m0));
  });
});
