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
