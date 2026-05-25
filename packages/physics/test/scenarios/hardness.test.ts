/**
 * hardness.test.ts — Regression tests asserting numerically bounded behavior throughout
 * the entire simulation, not just at endpoints.
 *
 * These tests catch any future regression that allows T, P, or F0 to escape sane bounds.
 * They run the same scenario helpers used by the scenario tests but sample every step.
 */

import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { generator_pressure } from '../../src/generator.js';
import { p_sat_water } from '../../src/saturation.js';
import {
  GAMMA_AIR,
  GAMMA_VAP,
  R_AIR,
  R_VAP,
  P_ATM,
  C_to_K,
  K_to_C,
  bar_to_Pa,
  Pa_to_bar,
} from '../../src/constants.js';
import { T_MIN_K, T_MAX_K } from '../../src/chamber.js';

const dt = 0.05;
const CHAMBER_V = 0.15; // m³ (150 L)

// ── Shared setup ────────────────────────────────────────────────────────────

function makeParams134(): SystemParams {
  return {
    chamber: { V: CHAMBER_V, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 24000, relief_pressure_Pa: 6e5 },
    load: {
      m_metal: 20,
      cp_metal: 500,
      m_fabric: 5,
      cp_fabric: 1500,
      h_gas_metal: 500,
      h_metal_fabric: 30,
    },
    valves: {
      V_STEAM_IN_INT: {
        from: 'generator',
        to: 'chamber',
        params: { Cv: 8e-6, gamma: GAMMA_VAP, R: R_VAP },
      },
      V_STEAM_IN_JACKET: {
        from: 'generator',
        to: 'jacket',
        params: { Cv: 1e-6, gamma: GAMMA_VAP, R: R_VAP },
      },
      V_VAC: {
        from: 'chamber',
        to: 'vacuum',
        params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR },
      },
      V_EXHAUST: {
        from: 'chamber',
        to: 'atmosphere',
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

function makeParams121(): SystemParams {
  return {
    chamber: { V: CHAMBER_V, allowLiquid: true },
    jacket: { V: 0.025, allowLiquid: false },
    generator: { V_total: 0.05, heater_power_W: 24000, relief_pressure_Pa: 6e5 },
    load: {
      m_metal: 20,
      cp_metal: 500,
      m_fabric: 5,
      cp_fabric: 1500,
      h_gas_metal: 500,
      h_metal_fabric: 30,
    },
    valves: {
      V_STEAM_IN_INT: {
        from: 'generator',
        to: 'chamber',
        params: { Cv: 5e-6, gamma: GAMMA_VAP, R: R_VAP },
      },
      V_STEAM_IN_JACKET: {
        from: 'generator',
        to: 'jacket',
        params: { Cv: 1e-6, gamma: GAMMA_VAP, R: R_VAP },
      },
      V_EXHAUST: {
        from: 'chamber',
        to: 'atmosphere',
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

function makeInitialState(p: SystemParams): SystemState {
  const T = C_to_K(22);
  return {
    chamber: { m_air: (P_ATM * p.chamber.V) / (R_AIR * T), m_vap: 0, m_liq: 0, T },
    jacket: { m_air: (P_ATM * p.jacket.V) / (R_AIR * T), m_vap: 0, m_liq: 0, T },
    generator: { m_water_liq: 30, m_water_vap: 0, T: C_to_K(22) },
    load: { T_metal: T, T_fabric: T },
    f0_minutes: 0,
    time_s: 0,
  };
}

// ── Bound-checking helpers ──────────────────────────────────────────────────

interface BoundViolation {
  time_s: number;
  field: string;
  value: number;
  limit: number;
}

/** Asserts all hard bounds at every step. Returns list of violations (empty = pass). */
function checkBounds(s: SystemState, p: SystemParams, violations: BoundViolation[]): void {
  const T_ch_C = K_to_C(s.chamber.T);
  const T_test_C = K_to_C(s.load.T_fabric);
  const P_gen_bar =
    s.generator && p.generator ? Pa_to_bar(generator_pressure(s.generator, p.generator)) : 0;
  const m_vap = s.chamber.m_vap;

  // Chamber temperature must stay within hard limits
  if (s.chamber.T < T_MIN_K) {
    violations.push({ time_s: s.time_s, field: 'T_chamber_K', value: s.chamber.T, limit: T_MIN_K });
  }
  if (s.chamber.T > T_MAX_K) {
    violations.push({ time_s: s.time_s, field: 'T_chamber_K', value: s.chamber.T, limit: T_MAX_K });
  }

  // Practical bounds (more generous than the hard T limits — catches physics runaway)
  if (T_ch_C < -75) {
    violations.push({ time_s: s.time_s, field: 'T_chamber_C', value: T_ch_C, limit: -75 });
  }
  if (T_ch_C > 220) {
    violations.push({ time_s: s.time_s, field: 'T_chamber_C', value: T_ch_C, limit: 220 });
  }

  // T_test must also stay within practical autoclave bounds
  if (T_test_C < -10) {
    violations.push({ time_s: s.time_s, field: 'T_test_C', value: T_test_C, limit: -10 });
  }
  if (T_test_C > 220) {
    violations.push({ time_s: s.time_s, field: 'T_test_C', value: T_test_C, limit: 220 });
  }

  // Generator pressure must be bounded by relief valve (≤ 7 bar — 1 bar headroom above 6 bar default)
  if (P_gen_bar > 7) {
    violations.push({ time_s: s.time_s, field: 'P_gen_bar', value: P_gen_bar, limit: 7 });
  }

  // Vapor mass must not exceed saturation max by more than 1% (condensation loop keeps it bounded)
  const p_sat = p_sat_water(s.chamber.T);
  const m_vap_max = (p_sat * CHAMBER_V) / (R_VAP * s.chamber.T);
  if (m_vap > m_vap_max * 1.01 + 1e-6) {
    violations.push({
      time_s: s.time_s,
      field: 'm_vap_over_saturation',
      value: m_vap / m_vap_max,
      limit: 1.01,
    });
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Numerical hardness — bounded behavior throughout', () => {
  it('134°C pre-vacuum cycle: T stays in [-73°C, 220°C] and P_gen ≤ 7 bar throughout', () => {
    const p = makeParams134();
    let s = makeInitialState(p);
    const violations: BoundViolation[] = [];

    // Phase 0: preheat 5 min
    for (let t = 0; t < 300 / dt; t++) {
      s = system_step(s, p, { V_STEAM_IN_JACKET: true }, { heater_gen: true, pump_vac: false }, dt);
      checkBounds(s, p, violations);
    }

    // 3 vacuum/steam prevac pulses
    for (let i = 0; i < 3; i++) {
      for (let t = 0; t < 30 / dt; t++) {
        s = system_step(s, p, { V_VAC: true }, { heater_gen: true, pump_vac: true }, dt);
        checkBounds(s, p, violations);
      }
      for (let t = 0; t < 30 / dt; t++) {
        s = system_step(
          s,
          p,
          { V_STEAM_IN_INT: true, V_STEAM_IN_JACKET: true },
          { heater_gen: true, pump_vac: false },
          dt,
        );
        checkBounds(s, p, violations);
      }
    }

    // Sterilization hold 7 min
    for (let t = 0; t < (7 * 60) / dt; t++) {
      s = system_step(
        s,
        p,
        { V_STEAM_IN_INT: true, V_STEAM_IN_JACKET: true },
        { heater_gen: true, pump_vac: false },
        dt,
      );
      checkBounds(s, p, violations);
    }

    // Exhaust 3 min
    for (let t = 0; t < 180 / dt; t++) {
      s = system_step(s, p, { V_EXHAUST: true }, { heater_gen: false, pump_vac: false }, dt);
      checkBounds(s, p, violations);
    }

    // Drying 10 min
    for (let t = 0; t < 600 / dt; t++) {
      s = system_step(s, p, { V_VAC: true }, { heater_gen: false, pump_vac: true }, dt);
      checkBounds(s, p, violations);
    }

    if (violations.length > 0) {
      const first5 = violations.slice(0, 5);
      const msg = first5
        .map(
          (v) => `[t=${v.time_s.toFixed(1)}] ${v.field}=${v.value.toFixed(4)} (limit=${v.limit})`,
        )
        .join('; ');
      expect.fail(`${violations.length} bound violation(s): ${msg}`);
    }
  }, 180000);

  it('121°C gravity cycle: T stays in [-73°C, 220°C] throughout 25 min sim', () => {
    const p = makeParams121();
    let s = makeInitialState(p);
    const violations: BoundViolation[] = [];

    // Phase 0: preheat 5 min
    for (let t = 0; t < 300 / dt; t++) {
      s = system_step(s, p, { V_STEAM_IN_JACKET: true }, { heater_gen: true, pump_vac: false }, dt);
      checkBounds(s, p, violations);
    }

    // Gravity displacement 3 min
    for (let t = 0; t < 180 / dt; t++) {
      s = system_step(
        s,
        p,
        { V_STEAM_IN_INT: true, V_STEAM_IN_JACKET: true, V_EXHAUST: true },
        { heater_gen: true, pump_vac: false },
        dt,
      );
      checkBounds(s, p, violations);
    }

    // Hold 15 min
    for (let t = 0; t < (15 * 60) / dt; t++) {
      s = system_step(
        s,
        p,
        { V_STEAM_IN_INT: true, V_STEAM_IN_JACKET: true },
        { heater_gen: true, pump_vac: false },
        dt,
      );
      checkBounds(s, p, violations);
    }

    if (violations.length > 0) {
      const first5 = violations.slice(0, 5);
      const msg = first5
        .map(
          (v) => `[t=${v.time_s.toFixed(1)}] ${v.field}=${v.value.toFixed(4)} (limit=${v.limit})`,
        )
        .join('; ');
      expect.fail(`${violations.length} bound violation(s): ${msg}`);
    }
  }, 180000);

  it('Drying phase: T stays in [-73°C, 220°C] and F0 does not grow rogue (Δ ≤ 1000 min)', () => {
    // Start drying from realistic post-sterilisation state.
    const p: SystemParams = {
      chamber: { V: CHAMBER_V, allowLiquid: true },
      jacket: { V: 0.025, allowLiquid: false },
      generator: null,
      load: {
        m_metal: 20,
        cp_metal: 500,
        m_fabric: 5,
        cp_fabric: 1500,
        h_gas_metal: 50, // vacuum significantly reduces convective transfer
        h_metal_fabric: 30,
      },
      valves: {
        V_VAC: {
          from: 'chamber',
          to: 'vacuum',
          params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR },
        },
      },
      external: {
        steam_line_pressure: 0,
        steam_line_T: 0,
        atmosphere_T: C_to_K(22),
      },
    };

    let s: SystemState = {
      chamber: { m_air: 0.01, m_vap: 0.05, m_liq: 0.1, T: C_to_K(134) },
      jacket: { m_air: 0, m_vap: 0.05, m_liq: 0, T: C_to_K(135) },
      generator: null,
      load: { T_metal: C_to_K(134), T_fabric: C_to_K(134) },
      f0_minutes: 100,
      time_s: 0,
    };

    const violations: BoundViolation[] = [];
    const f0_start = s.f0_minutes;

    // Simulate 15 min of drying
    for (let t = 0; t < 900 / dt; t++) {
      s = system_step(s, p, { V_VAC: true }, { heater_gen: false, pump_vac: true }, dt);
      checkBounds(s, p, violations);
    }

    if (violations.length > 0) {
      const first5 = violations.slice(0, 5);
      const msg = first5
        .map(
          (v) => `[t=${v.time_s.toFixed(1)}] ${v.field}=${v.value.toFixed(4)} (limit=${v.limit})`,
        )
        .join('; ');
      expect.fail(`${violations.length} bound violation(s): ${msg}`);
    }

    // F0 must not grow by more than 1000 min during a drying phase
    // (load cools below 100°C quickly; rogue F0 growth from -T artifacts was the bug)
    const f0_growth = s.f0_minutes - f0_start;
    expect(f0_growth).toBeLessThan(1000);
  }, 120000);

  it('Generator relief valve caps P_gen below 7 bar during any heater-on scenario', () => {
    const p = makeParams134();
    let s = makeInitialState(p);
    let maxPgen = 0;

    // Run heater-on with all steam valves CLOSED (worst-case pressure build-up scenario)
    // The third prevac pulse in ster-134-prevac.yaml has exactly this configuration.
    for (let t = 0; t < 180 / dt; t++) {
      s = system_step(s, p, {}, { heater_gen: true, pump_vac: false }, dt);
      if (s.generator && p.generator) {
        const P = generator_pressure(s.generator, p.generator);
        if (P > maxPgen) maxPgen = P;
      }
    }

    expect(Pa_to_bar(maxPgen)).toBeLessThan(7);
  });

  it('Vacuum pulse from 1 atm: T_chamber stays above -74°C throughout evacuation', () => {
    const p = makeParams134();
    let s = makeInitialState(p);

    // First pre-heat so load is warm
    for (let t = 0; t < 300 / dt; t++) {
      s = system_step(s, p, { V_STEAM_IN_JACKET: true }, { heater_gen: true, pump_vac: false }, dt);
    }

    let minT = s.chamber.T;

    // Vacuum pulse 60 s
    for (let t = 0; t < 60 / dt; t++) {
      s = system_step(s, p, { V_VAC: true }, { heater_gen: true, pump_vac: true }, dt);
      if (s.chamber.T < minT) minT = s.chamber.T;
    }

    expect(K_to_C(minT)).toBeGreaterThan(-74); // floor is -73.15°C = T_MIN_K
  });

  it('Saturation guard: m_vap never exceeds m_vap_max * 1.01 under any steam-fill scenario', () => {
    const p = makeParams134();
    let s = makeInitialState(p);

    // Heavy steam fill: pre-heat then 7 min of both steam valves open, no exhaust
    for (let t = 0; t < 300 / dt; t++) {
      s = system_step(s, p, { V_STEAM_IN_JACKET: true }, { heater_gen: true, pump_vac: false }, dt);
    }

    let maxOversat = 0;

    for (let t = 0; t < (7 * 60) / dt; t++) {
      s = system_step(
        s,
        p,
        { V_STEAM_IN_INT: true, V_STEAM_IN_JACKET: true },
        { heater_gen: true, pump_vac: false },
        dt,
      );
      const p_sat = p_sat_water(s.chamber.T);
      const m_vap_max = (p_sat * CHAMBER_V) / (R_VAP * s.chamber.T);
      if (m_vap_max > 1e-6) {
        const ratio = s.chamber.m_vap / m_vap_max;
        if (ratio > maxOversat) maxOversat = ratio;
      }
    }

    expect(maxOversat).toBeLessThanOrEqual(1.01);
  }, 60000);
});
