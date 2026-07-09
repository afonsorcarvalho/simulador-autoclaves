import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { KNOBS } from '../../server/knobs/registry.js';
import { applyFactory, applyOne, resetAll } from '../../server/knobs/store.js';

const SHIPPED = resolve(process.cwd(), 'knobs.factory.json');
const OVERRIDE = join(tmpdir(), 'sim-factory-test-override.json');
const FACTORY = join(tmpdir(), 'sim-factory-test.json');

describe('knob factory file', () => {
  beforeEach(() => {
    resetRuntime();
    for (const f of [OVERRIDE, FACTORY]) if (existsSync(f)) rmSync(f);
  });
  afterEach(() => {
    for (const f of [OVERRIDE, FACTORY]) if (existsSync(f)) rmSync(f);
  });

  it('shipped knobs.factory.json is in sync with registry defaults', () => {
    const factory = JSON.parse(readFileSync(SHIPPED, 'utf8')) as Record<string, number>;
    for (const k of KNOBS) {
      expect(factory[k.id], `missing ${k.id}`).toBeDefined();
      expect(factory[k.id]).toBeCloseTo(k.default, 9);
    }
    // no stray keys that aren't real knobs
    for (const id of Object.keys(factory)) {
      expect(
        KNOBS.some((k) => k.id === id),
        `stray key ${id}`,
      ).toBe(true);
    }
  });

  it('applyFactory applies file values over registry defaults', () => {
    writeFileSync(FACTORY, JSON.stringify({ 'time.scale': 7 }), 'utf8');
    const rt = getRuntime();
    applyFactory(rt, FACTORY);
    expect(rt.timeScale).toBe(7);
    // absent key falls back to registry default
    expect(rt.controller.band_low).toBe(0.1);
  });

  it('resetAll restores the factory baseline, not the registry default', () => {
    writeFileSync(FACTORY, JSON.stringify({ 'plant.chamber.h_ambient': 30 }), 'utf8');
    const rt = getRuntime();
    applyOne(rt, 'plant.chamber.h_ambient', 55, OVERRIDE);
    expect(rt.params.chamber.h_ambient_W_per_K).toBe(55);
    resetAll(rt, OVERRIDE, FACTORY);
    expect(rt.params.chamber.h_ambient_W_per_K).toBe(30); // factory value, not 10
    expect(existsSync(OVERRIDE)).toBe(false);
  });
});
