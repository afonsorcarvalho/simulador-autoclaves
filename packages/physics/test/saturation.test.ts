import { describe, it, expect } from 'vitest';
import { p_sat_water, h_vap_water } from '../src/saturation.js';
import { C_to_K, Pa_to_bar } from '../src/constants.js';

describe('p_sat_water (Antoine, water)', () => {
  it('returns ~1.013 bar at 100°C (boiling at 1 atm)', () => {
    const p = p_sat_water(C_to_K(100));
    expect(Pa_to_bar(p)).toBeCloseTo(1.013, 1);
  });

  it('returns ~2.06 bar absolute at 121.1°C (standard sterilization gravity)', () => {
    const p = p_sat_water(C_to_K(121.1));
    expect(Pa_to_bar(p)).toBeCloseTo(2.06, 1);
  });

  it('returns ~3.06 bar absolute at 134°C (prevac sterilization)', () => {
    const p = p_sat_water(C_to_K(134));
    expect(Pa_to_bar(p)).toBeCloseTo(3.06, 1);
  });

  it('returns ~0.024 bar at 20°C (room temperature humidity)', () => {
    const p = p_sat_water(C_to_K(20));
    expect(Pa_to_bar(p)).toBeCloseTo(0.0234, 2);
  });

  it('is monotonically increasing in T', () => {
    let prev = -Infinity;
    for (let T_C = 0; T_C <= 200; T_C += 10) {
      const p = p_sat_water(C_to_K(T_C));
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });
});

describe('h_vap_water', () => {
  it('returns ~2257 kJ/kg at 100°C', () => {
    expect(h_vap_water(C_to_K(100))).toBeCloseTo(2257e3, -4);
  });

  it('returns ~2202 kJ/kg at 120°C', () => {
    expect(h_vap_water(C_to_K(120))).toBeCloseTo(2202e3, -4);
  });

  it('returns ~2163 kJ/kg at 134°C', () => {
    expect(h_vap_water(C_to_K(134))).toBeCloseTo(2163e3, -4);
  });

  it('decreases with temperature', () => {
    expect(h_vap_water(C_to_K(20))).toBeGreaterThan(h_vap_water(C_to_K(100)));
    expect(h_vap_water(C_to_K(100))).toBeGreaterThan(h_vap_water(C_to_K(200)));
  });
});
