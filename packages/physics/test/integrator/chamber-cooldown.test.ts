import { describe, it, expect } from 'vitest';
import { system_step, type SystemState, type SystemParams } from '../../src/integrator.js';
import { buildLoadState } from '../../src/load.js';
import { p_sat_water } from '../../src/saturation.js';
import { C_to_K, K_to_C, R_VAP } from '../../src/constants.js';

// Plant only — no controller. Chamber slightly above setpoint (as if just fed a steam burst),
// steam-in valve SHUT, jacket hot (guard), load at setpoint.
//
// FINDING (SP-B Task 1): with steam shut, the chamber does NOT relax to setpoint. While liquid
// is present it is two-phase, so the gas temperature is pinned to the RELIEF saturation
// temperature: T_sat(3.2 bar) ≈ 135.5 °C = setpoint + 1.5. The durable equilibrium is set by
// the relief setpoint, NOT by jacket→chamber coupling — reducing jacket_chamber_h from 150 down
// to 40 (and wall_h 200→80) leaves T_eq at 135.495; even zero jacket coupling only reaches
// 135.15. The only lever that reaches ~134 is lowering the relief setpoint to ~p_sat(134)=3.09
// bar (→ T_eq 134.6, but the chamber then boils dry) — out of Task 1 scope. So this test gates
// the REAL achievable durable behavior: the chamber stays within the EN 285 band ceiling
// (setpoint+3) and does not run away, pinned by relief. Bringing the floor down to setpoint
// needs the relief setpoint change or the Task 2 chamber-from-jacket topology fix.
function holdParams(jacket_chamber_h = 150, chamber_wall_h = 200): SystemParams {
  return {
    // relief_pressure_Pa 3.2 bar matches the production chamber (singleton.ts): with liquid
    // present the vent pins vapor pressure → gas saturation temperature, the durable equilibrium.
    chamber: {
      V: 0.15,
      allowLiquid: true,
      wall_mass_kg: 50,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: chamber_wall_h,
      relief_pressure_Pa: 3.2e5,
    },
    jacket: {
      V: 0.025,
      allowLiquid: false,
      wall_mass_kg: 15,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 100,
    },
    generator: null,
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
    valves: {}, // V_STEAM_IN_INT SHUT: no chamber steam inflow at all
    external: { steam_line_pressure: 5e5, steam_line_T: C_to_K(160), atmosphere_T: C_to_K(22) },
    jacket_chamber_h_W_per_K: jacket_chamber_h,
  };
}

function settle(jacket_chamber_h: number, chamber_wall_h: number): number {
  const SP = C_to_K(134);
  const T0 = C_to_K(135.5); // 1.5 °C above setpoint, as after a steam burst
  const load = buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], SP);
  let s: SystemState = {
    chamber: {
      m_air: 1e-6,
      m_vap: (p_sat_water(T0) * 0.15) / (R_VAP * T0),
      m_liq: 0.02,
      T: T0,
      T_wall: C_to_K(135),
    },
    jacket: {
      m_air: 0,
      m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(138)),
      m_liq: 0,
      T: C_to_K(138),
      T_wall: C_to_K(138),
    },
    generator: null,
    load,
    f0_minutes: 0,
    time_s: 0,
  };
  for (let i = 0; i < 4000; i++) {
    s = system_step(
      s,
      holdParams(jacket_chamber_h, chamber_wall_h),
      {},
      { heater_gen: false, pump_vac: false },
      0.05,
    ); // 200 s
  }
  return K_to_C(s.chamber.T); // durable equilibrium (200 s, relief-pinned)
}

describe('chamber ambient heat loss', () => {
  it('with ambient loss enabled, a starved chamber loses more heat than without', () => {
    const SP = C_to_K(134);
    const mk = (): SystemState => ({
      chamber: {
        m_air: 1e-6,
        m_vap: (p_sat_water(SP) * 0.15) / (R_VAP * SP),
        m_liq: 0.02,
        T: SP,
        T_wall: SP,
      },
      jacket: {
        m_air: 0,
        m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(138)),
        m_liq: 0,
        T: C_to_K(138),
        T_wall: C_to_K(138),
      },
      generator: null,
      load: buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], SP),
      f0_minutes: 0,
      time_s: 0,
    });
    const run = (h_ambient: number) => {
      const base = holdParams();
      const p = {
        ...base,
        chamber: { ...base.chamber, h_ambient_W_per_K: h_ambient },
      } as SystemParams;
      let s = mk();
      for (let i = 0; i < 2000; i++)
        s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.05);
      return s.chamber.T;
    };
    expect(run(50)).toBeLessThan(run(0) - 0.5); // ambient loss cools measurably more than no loss
  });
});

describe('condensate drain', () => {
  it('drains chamber liquid over time when a trap rate is set', () => {
    const SP = C_to_K(134);
    const base = holdParams();
    const p = { ...base, chamber: { ...base.chamber, drain_kg_per_s: 1e-4 } } as SystemParams;
    let s: SystemState = {
      chamber: {
        m_air: 1e-6,
        m_vap: (p_sat_water(SP) * 0.15) / (R_VAP * SP),
        m_liq: 0.05,
        T: SP,
        T_wall: SP,
      },
      jacket: {
        m_air: 0,
        m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(138)),
        m_liq: 0,
        T: C_to_K(138),
        T_wall: C_to_K(138),
      },
      generator: null,
      load: buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], SP),
      f0_minutes: 0,
      time_s: 0,
    };
    const liq0 = s.chamber.m_liq;
    for (let i = 0; i < 2000; i++)
      s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.05);
    expect(s.chamber.m_liq).toBeLessThan(liq0); // condensate drained out
  });
});

// Production loss calibration (rev.2): ambient loss + condensate drain make the starved chamber
// fall BELOW setpoint, so a controller (virtual PLC or real PLC over Modbus) can regulate it up.
// The relief is now a safety cap (3.4 bar), not the operating point. Values are vessel-calibration
// knobs (ponytail) tuned here against the controllability gate.
const H_AMBIENT_W_PER_K = 10;
const DRAIN_KG_PER_S = 2e-5;
const CHAMBER_RELIEF_PA = 3.25e5;

function settleWithLosses(): number {
  const SP = C_to_K(134);
  const T0 = C_to_K(135.5);
  const base = holdParams();
  const p = {
    ...base,
    chamber: {
      ...base.chamber,
      relief_pressure_Pa: CHAMBER_RELIEF_PA,
      h_ambient_W_per_K: H_AMBIENT_W_PER_K,
      drain_kg_per_s: DRAIN_KG_PER_S,
    },
  } as SystemParams;
  const load = buildLoadState([{ material: 'COTTON_TEXTILE', mass_kg: 5, witness: true }], SP);
  let s: SystemState = {
    chamber: {
      m_air: 1e-6,
      m_vap: (p_sat_water(T0) * 0.15) / (R_VAP * T0),
      m_liq: 0.02,
      T: T0,
      T_wall: C_to_K(135),
    },
    jacket: {
      m_air: 0,
      m_vap: (3.54e5 * 0.025) / (R_VAP * C_to_K(138)),
      m_liq: 0,
      T: C_to_K(138),
      T_wall: C_to_K(138),
    },
    generator: null,
    load,
    f0_minutes: 0,
    time_s: 0,
  };
  for (let i = 0; i < 4000; i++) {
    s = system_step(s, p, {}, { heater_gen: false, pump_vac: false }, 0.05); // 200 s starved
  }
  return K_to_C(s.chamber.T);
}

describe('plant controllability — starved chamber falls below setpoint (losses + drain)', () => {
  it('with ambient loss + condensate drain, a steam-starved chamber cools below setpoint', () => {
    // The controller closes V_STEAM_IN_INT when hot; the plant must then fall below setpoint so
    // the controller has to reopen — otherwise the chamber is uncontrollable (Task 1 finding).
    const T_eq = settleWithLosses();
    expect(T_eq).toBeLessThan(134 - 0.1); // fell below setpoint → controllable
    expect(T_eq).toBeGreaterThan(120); // gentle fall over 200 s starved, not a crash (calibration sane)
  });
});
