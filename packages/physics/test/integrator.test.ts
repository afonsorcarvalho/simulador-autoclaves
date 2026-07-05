import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../src/integrator.js';
import { buildLoadState } from '../src/load.js';
import { chamber_pressure } from '../src/chamber.js';
import {
  GAMMA_AIR,
  GAMMA_VAP,
  R_AIR,
  R_VAP,
  P_ATM,
  C_to_K,
  Pa_to_bar,
  bar_to_Pa,
} from '../src/constants.js';

function basicParams(): SystemParams {
  return {
    chamber: { V: 0.15, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 24000 },
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
    valves: {
      V_STEAM_IN_INT: {
        from: 'generator',
        to: 'chamber',
        params: { Cv: 1e-5, gamma: GAMMA_VAP, R: R_VAP },
      },
      V_VAC: { from: 'chamber', to: 'vacuum', params: { Cv: 5e-5, gamma: GAMMA_AIR, R: R_AIR } },
      V_AIR_IN: {
        from: 'atmosphere',
        to: 'chamber',
        params: { Cv: 2e-5, gamma: GAMMA_AIR, R: R_AIR },
      },
    },
    external: {
      steam_line_pressure: bar_to_Pa(5),
      steam_line_T: C_to_K(160),
      atmosphere_T: C_to_K(22),
    },
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
    load: buildLoadState(undefined, T),
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
      cur = system_step(
        cur,
        p,
        { V_STEAM_IN_INT: true },
        { heater_gen: true, pump_vac: false },
        0.01,
      );
    }
    expect(cur.chamber.T).toBeGreaterThan(C_to_K(40));
    expect(cur.chamber.m_vap).toBeGreaterThan(0);
  });

  it('F0 accumulates when testemunho (witness) ≥ 100°C', () => {
    const s = basicState();
    const p = basicParams();
    s.load = buildLoadState(undefined, C_to_K(134));
    let cur = s;
    for (let i = 0; i < 6000; i++) {
      cur = system_step(cur, p, {}, { heater_gen: false, pump_vac: false }, 0.01);
    }
    // N-node model: the witness (textile) now sheds heat by radiation to the cold
    // (22 °C) jacket, so F0 accrues more slowly than the old stuck-hot 2-mass load.
    // Still substantial over 60 s starting from 134 °C; keep a positive-accrual floor.
    expect(cur.f0_minutes).toBeGreaterThan(5);
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

describe('system_step — jacket-chamber wall coupling', () => {
  it('cold chamber ends warmer with coupling than without coupling', () => {
    // Run two identical scenarios: one with coupling, one without.
    // Chamber gas is cold (40°C), jacket is hot (140°C).
    // No gas↔metal exchange (h_gas_metal = 0) so the load does not mask the coupling effect.
    const makeScenario = (h_jc: number) => {
      const s = basicState();
      s.jacket.T = C_to_K(140);
      s.chamber.T = C_to_K(40);
      s.chamber.T_wall = C_to_K(40);
      s.load = buildLoadState(undefined, C_to_K(40));
      const p = basicParams();
      // Jacket conduction now heats the chamber WALL, not the gas directly; the two-phase
      // chamber always has a wall, so the scenario must include one for the heat to reach the gas.
      p.chamber = { ...p.chamber, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200 };
      p.jacket_chamber_h_W_per_K = h_jc;
      let cur = s;
      for (let i = 0; i < 600; i++) {
        // 6 s simulated
        cur = system_step(cur, p, {}, { heater_gen: false, pump_vac: false }, 0.01);
      }
      return cur.chamber.T;
    };
    const T_with = makeScenario(200);
    const T_without = makeScenario(0);
    // Jacket coupling still warms the chamber, but via the wall now: the heat charges the
    // large wall thermal mass instead of spiking the gas, so the gas rise is small (was a
    // +1 K/6 s margin under the old direct-gas-heating model, which this task removes).
    expect(T_with).toBeGreaterThan(T_without);
  });

  it('back-compat: disabling coupling (h=0) produces cooler chamber than h=200', () => {
    // Mirror of the previous test: zero coupling means jacket heat does NOT reach chamber.
    // No gas↔metal exchange so the coupling signal is not masked.
    const makeScenario = (h_jc: number) => {
      const s = basicState();
      s.jacket.T = C_to_K(140);
      s.chamber.T = C_to_K(40);
      s.chamber.T_wall = C_to_K(40);
      s.load = buildLoadState(undefined, C_to_K(40));
      const p = basicParams();
      // Jacket conduction now heats the chamber WALL, not the gas directly; include a wall.
      p.chamber = { ...p.chamber, wall_mass_kg: 50, wall_cp_J_per_kg_K: 500, wall_h_W_per_K: 200 };
      p.jacket_chamber_h_W_per_K = h_jc;
      let cur = s;
      for (let i = 0; i < 600; i++) {
        cur = system_step(cur, p, {}, { heater_gen: false, pump_vac: false }, 0.01);
      }
      return cur.chamber.T;
    };
    const T_coupled = makeScenario(200);
    const T_decoupled = makeScenario(0);
    expect(T_coupled).toBeGreaterThan(T_decoupled);
  });

  it('coupling drives jacket and chamber toward thermal equilibrium', () => {
    const s = basicState();
    const p = basicParams();
    p.jacket_chamber_h_W_per_K = 500;
    s.jacket.T = C_to_K(140);
    s.chamber.T = C_to_K(20);
    s.load = buildLoadState(undefined, C_to_K(20));
    let cur = s;
    for (let i = 0; i < 30000; i++) {
      // 5 min simulated
      cur = system_step(cur, p, {}, { heater_gen: false, pump_vac: false }, 0.01);
    }
    // After enough time, T_chamber should be close to T_jacket (within 30°C as approximation)
    expect(Math.abs(cur.jacket.T - cur.chamber.T)).toBeLessThan(30);
  });
});

describe('system_step — valve thermostat (bang-bang control)', () => {
  it('valve auto-closes when target pressure exceeds setpoint', () => {
    const s = basicState();
    const p = basicParams();
    // Wire V_STEAM_IN_JACKET with a thermostat at 3.54 bar
    p.valves.V_STEAM_IN_JACKET = {
      from: 'generator',
      to: 'jacket',
      params: { Cv: 5e-5, gamma: GAMMA_VAP, R: R_VAP },
      thermostat: {
        target: 'jacket',
        close_at_Pa: bar_to_Pa(3.54),
        reopen_at_Pa: bar_to_Pa(3.49),
      },
    };
    // Pre-pressurize generator
    s.generator!.T = C_to_K(150);
    s.generator!.m_water_vap = 0.5;

    let cur = s;
    // Drive jacket above setpoint (commanded open continuously)
    for (let i = 0; i < 12000; i++) {
      // 2 min sim
      cur = system_step(
        cur,
        p,
        { V_STEAM_IN_JACKET: true },
        { heater_gen: true, pump_vac: false },
        0.01,
      );
    }
    // Jacket pressure should converge to slightly above 3.54 bar (just at close threshold)
    const P_jacket = chamber_pressure(cur.jacket, p.jacket).p_total;
    expect(Pa_to_bar(P_jacket)).toBeLessThan(3.7);
    expect(Pa_to_bar(P_jacket)).toBeGreaterThan(3.4);
    expect(cur.valve_tripped?.V_STEAM_IN_JACKET).toBe(true);
  });

  it('hysteresis: once tripped, valve stays closed until target drops below reopen threshold', () => {
    const s = basicState();
    const p = basicParams();
    p.valves.V_STEAM_IN_JACKET = {
      from: 'generator',
      to: 'jacket',
      params: { Cv: 5e-5, gamma: GAMMA_VAP, R: R_VAP },
      thermostat: {
        target: 'jacket',
        close_at_Pa: bar_to_Pa(3.54),
        reopen_at_Pa: bar_to_Pa(3.49),
      },
    };
    // Manually set jacket above close threshold and mark as tripped
    s.jacket.m_vap = 0.05; // arbitrary mass to put jacket above 3.54 bar
    s.jacket.T = C_to_K(150);
    s.valve_tripped = { V_STEAM_IN_JACKET: true };

    // Run a single step — should remain tripped
    const cur = system_step(
      s,
      p,
      { V_STEAM_IN_JACKET: true },
      { heater_gen: false, pump_vac: false },
      0.01,
    );
    expect(cur.valve_tripped?.V_STEAM_IN_JACKET).toBe(true);
  });

  it('back-compat: valves without thermostat behave as before', () => {
    const s = basicState();
    const p = basicParams();
    // V_STEAM_IN_INT has no thermostat
    s.generator!.T = C_to_K(150);
    s.generator!.m_water_vap = 0.5;
    let cur = s;
    for (let i = 0; i < 100; i++) {
      cur = system_step(
        cur,
        p,
        { V_STEAM_IN_INT: true },
        { heater_gen: false, pump_vac: false },
        0.01,
      );
    }
    // Without thermostat, vapor should keep entering chamber
    expect(cur.chamber.m_vap).toBeGreaterThan(0);
    expect(cur.valve_tripped).toBeDefined();
    expect(cur.valve_tripped!.V_STEAM_IN_INT).toBeUndefined();
  });
});
