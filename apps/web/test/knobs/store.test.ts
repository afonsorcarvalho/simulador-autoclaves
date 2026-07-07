import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import {
  applyOverrides,
  applyOne,
  resetAll,
  currentValues,
} from '../../server/knobs/store.js';

// Fixed name (Date.now/Math.random unavailable in some harnesses; tests run serial).
const FILE = join(tmpdir(), 'sim-knobs-test.json');

describe('knob store', () => {
  beforeEach(() => {
    resetRuntime();
    if (existsSync(FILE)) rmSync(FILE);
  });
  afterEach(() => {
    if (existsSync(FILE)) rmSync(FILE);
  });

  it('applyOne mutates runtime and persists to disk', () => {
    const rt = getRuntime();
    applyOne(rt, 'plant.chamber.h_ambient', 55, FILE);
    expect(rt.params.chamber.h_ambient_W_per_K).toBe(55);
    expect(existsSync(FILE)).toBe(true);
  });

  it('applyOverrides re-applies persisted values on boot', () => {
    const rt1 = getRuntime();
    applyOne(rt1, 'time.scale', 7, FILE);
    resetRuntime();
    const rt2 = getRuntime();
    applyOverrides(rt2, FILE); // simulates boot
    expect(rt2.timeScale).toBe(7);
  });

  it('currentValues returns default when not overridden', () => {
    const rt = getRuntime();
    const v = currentValues(rt);
    expect(v['plant.chamber.relief']).toBeCloseTo(3.25, 4);
  });

  it('rejects out-of-range values', () => {
    const rt = getRuntime();
    expect(() => applyOne(rt, 'time.scale', 999, FILE)).toThrow(/range/i);
  });

  it('rejects unknown id', () => {
    const rt = getRuntime();
    expect(() => applyOne(rt, 'nope.nope', 1, FILE)).toThrow(/unknown/i);
  });

  it('resetAll restores defaults and removes the file', () => {
    const rt = getRuntime();
    applyOne(rt, 'plant.chamber.h_ambient', 55, FILE);
    resetAll(rt, FILE);
    expect(rt.params.chamber.h_ambient_W_per_K).toBe(10);
    expect(existsSync(FILE)).toBe(false);
  });
});
