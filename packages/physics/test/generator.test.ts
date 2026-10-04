import { describe, it, expect } from 'vitest';
import {
  generator_step,
  generator_pressure,
  type GeneratorState,
  type GeneratorParams,
} from '../src/generator.js';
import { C_to_K, Pa_to_bar } from '../src/constants.js';

const gen24kW: GeneratorParams = { V_total: 0.05, heater_power_W: 24000 };

describe('generator_step', () => {
  it('heats water from 22°C toward saturation when heater is on', () => {
    const s: GeneratorState = { m_water_liq: 30, m_water_vap: 0, T: C_to_K(22) };
    let next = s;
    for (let i = 0; i < 60; i++) next = generator_step(next, gen24kW, true, 0, 1);
    // Q = 24 kW * 60s = 1440 kJ; ΔT ≈ Q/(m·cp) = 1440e3 / (30·4186) ≈ 11.5°C
    expect(next.T).toBeGreaterThan(C_to_K(30));
    expect(next.T).toBeLessThan(C_to_K(40));
  });

  it('produces vapor once saturated and heater on', () => {
    const s: GeneratorState = { m_water_liq: 30, m_water_vap: 0.001, T: C_to_K(140) };
    const next = generator_step(s, gen24kW, true, 0, 1);
    expect(next.m_water_vap).toBeGreaterThan(s.m_water_vap);
    expect(next.m_water_liq).toBeLessThan(s.m_water_liq);
  });

  it('vapor mass decreases when outflow drawn', () => {
    const s: GeneratorState = { m_water_liq: 30, m_water_vap: 0.05, T: C_to_K(140) };
    const next = generator_step(s, gen24kW, false, 0.01, 1);
    expect(next.m_water_vap).toBeLessThan(s.m_water_vap);
  });

  it('two-phase heating conserves energy: Q ≈ sensible(liquid+vapor) + latent(evaporated)', () => {
    // Estado inicial CONSISTENTE: m_vap = saturação a 120 °C no headspace (0,05 − 30/958 m³).
    const s: GeneratorState = { m_water_liq: 30, m_water_vap: 0.0205, T: C_to_K(120) };
    let st = s;
    const Q = 24000 * 60; // 60 s × 24 kW
    for (let i = 0; i < 1200; i++) st = generator_step(st, gen24kW, true, 0, 0.05);
    const dm = s.m_water_liq - st.m_water_liq;
    const sens = (s.m_water_liq * 4186 + s.m_water_vap * 1534.5) * (st.T - s.T);
    const lat = dm * 2.0e6; // u_fg ≈ 2,0 MJ/kg na faixa
    expect(st.T).toBeGreaterThan(s.T); // pressure vessel warms
    expect(sens + lat).toBeGreaterThan(0.95 * Q);
    expect(sens + lat).toBeLessThan(1.05 * Q);
  });

  it('drawing steam with heater OFF cools the boiler (liquid flashes to refill the headspace)', () => {
    const s: GeneratorState = { m_water_liq: 30, m_water_vap: 0.0205, T: C_to_K(120) };
    let st = s;
    for (let i = 0; i < 600; i++) st = generator_step(st, gen24kW, false, 0.005, 0.05); // 5 g/s, 30 s
    expect(st.T).toBeLessThan(s.T - 0.5);
    expect(st.m_water_liq).toBeLessThan(s.m_water_liq); // flash fed the draw-off
  });

  it('relief valve VENTS mass (liquid flashes down to T_sat(P_relief)); total water decreases', () => {
    const relief = { V_total: 0.05, heater_power_W: 0, relief_pressure_Pa: 400_000 };
    const s: GeneratorState = { m_water_liq: 30, m_water_vap: 0.2, T: C_to_K(150) }; // ~4.8 bar
    const next = generator_step(s, relief, false, 0, 1);
    expect(next.m_water_liq + next.m_water_vap).toBeLessThan(s.m_water_liq + s.m_water_vap);
    expect(Pa_to_bar(generator_pressure(next, relief))).toBeCloseTo(4.0, 1);
  });

  it('feed water refills the boiler and its sensible heat is paid for (boiler cools with heater off)', () => {
    const s: GeneratorState = { m_water_liq: 20, m_water_vap: 0.03, T: C_to_K(140) };
    let st = s;
    const feed = { kg_per_s: 0.05, T_K: C_to_K(20) };
    for (let i = 0; i < 200; i++) st = generator_step(st, gen24kW, false, 0, 0.05, feed); // 10 s → +0,5 kg
    expect(st.m_water_liq + st.m_water_vap).toBeCloseTo(s.m_water_liq + s.m_water_vap + 0.5, 3);
    // 0,5 kg × 4186 × 120 K ≈ 251 kJ saídos de ~84 kJ/K de água quente → ≈ −3 K
    expect(st.T).toBeLessThan(s.T - 2);
    expect(st.T).toBeGreaterThan(s.T - 5);
  });

  it('does not produce vapor when heater is off and not saturated', () => {
    const s: GeneratorState = { m_water_liq: 30, m_water_vap: 0, T: C_to_K(50) };
    const next = generator_step(s, gen24kW, false, 0, 1);
    expect(next.m_water_vap).toBe(0);
    expect(next.T).toBeCloseTo(s.T, 1);
  });
});

describe('generator_pressure', () => {
  it('returns ~3.5 bar absolute at 138°C (saturation)', () => {
    const s: GeneratorState = { m_water_liq: 30, m_water_vap: 0.1, T: C_to_K(138) };
    const p = generator_pressure(s, gen24kW);
    expect(Pa_to_bar(p)).toBeGreaterThan(3.0);
    expect(Pa_to_bar(p)).toBeLessThan(4.0);
  });
});
