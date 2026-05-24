import { describe, it, expect } from 'vitest';
import { F0Accumulator } from '../src/f0.js';
import { C_to_K } from '../src/constants.js';

describe('F0Accumulator', () => {
  it('starts at zero', () => {
    expect(new F0Accumulator().value_minutes).toBe(0);
  });

  it('accumulates 1 minute at exactly 121.1°C in 60 seconds of 1s steps', () => {
    const f = new F0Accumulator();
    for (let i = 0; i < 60; i++) f.step(C_to_K(121.1), 1);
    expect(f.value_minutes).toBeCloseTo(1.0, 3);
  });

  it('accumulates ~10x faster at 131.1°C than at 121.1°C', () => {
    const f1 = new F0Accumulator();
    const f2 = new F0Accumulator();
    for (let i = 0; i < 60; i++) f1.step(C_to_K(121.1), 1);
    for (let i = 0; i < 60; i++) f2.step(C_to_K(131.1), 1);
    expect(f2.value_minutes / f1.value_minutes).toBeCloseTo(10, 0);
  });

  it('accumulates ~19.5x at 134°C vs 121.1°C', () => {
    const f1 = new F0Accumulator();
    const f2 = new F0Accumulator();
    for (let i = 0; i < 60; i++) f1.step(C_to_K(121.1), 1);
    for (let i = 0; i < 60; i++) f2.step(C_to_K(134), 1);
    expect(f2.value_minutes / f1.value_minutes).toBeCloseTo(19.5, 0);
  });

  it('does not accumulate below 100°C (negligible lethality)', () => {
    const f = new F0Accumulator();
    for (let i = 0; i < 600; i++) f.step(C_to_K(99), 1);
    expect(f.value_minutes).toBeLessThan(0.01);
  });

  it('7 minutes at 134°C yields F0 ≥ 100', () => {
    const f = new F0Accumulator();
    for (let i = 0; i < 7 * 60; i++) f.step(C_to_K(134), 1);
    expect(f.value_minutes).toBeGreaterThanOrEqual(100);
  });
});
