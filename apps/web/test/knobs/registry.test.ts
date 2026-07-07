import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { KNOBS, knobById } from '../../server/knobs/registry.js';

describe('knob registry', () => {
  beforeEach(() => resetRuntime());

  it('every knob has a unique id and default within [min,max]', () => {
    const ids = new Set<string>();
    for (const k of KNOBS) {
      expect(ids.has(k.id)).toBe(false);
      ids.add(k.id);
      expect(k.default).toBeGreaterThanOrEqual(k.min);
      expect(k.default).toBeLessThanOrEqual(k.max);
    }
  });

  it('get∘set round-trips for every knob', () => {
    const rt = getRuntime();
    for (const k of KNOBS) {
      k.set(rt, k.min);
      expect(k.get(rt)).toBeCloseTo(k.min, 6);
    }
  });

  it('relief knob converts bar↔Pa in the accessors', () => {
    const rt = getRuntime();
    const relief = knobById('plant.chamber.relief');
    expect(relief).toBeDefined();
    relief!.set(rt, 3.5);
    expect(rt.params.chamber.relief_pressure_Pa).toBeCloseTo(350000, 0);
    expect(relief!.get(rt)).toBeCloseTo(3.5, 4);
  });

  it('plant.chamber.h_ambient set mutates runtime params live', () => {
    const rt = getRuntime();
    knobById('plant.chamber.h_ambient')!.set(rt, 42);
    expect(rt.params.chamber.h_ambient_W_per_K).toBe(42);
  });
});
