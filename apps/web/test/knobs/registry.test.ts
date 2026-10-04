import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { KNOBS, knobById, KNOB_CATEGORIES } from '../../server/knobs/registry.js';
import { MATERIALS } from '@sim/physics';

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

  it('every knob has a categoria that belongs to its family\'s fixed list', () => {
    for (const k of KNOBS) {
      expect(k.categoria, `knob "${k.id}" sem categoria`).toBeTruthy();
      expect(
        KNOB_CATEGORIES[k.family],
        `família "${k.family}" (knob "${k.id}") sem lista de categorias`,
      ).toContain(k.categoria);
    }
  });

  it('lista de materiais da carga é uma ordem travada (o valor salvo é o índice)', () => {
    // material_a/material_b guardam o ÍNDICE nesta lista em knobs.override.json/knobs.factory.json
    // — reordenar ou remover um nome deslocaria o índice salvo p/ OUTRO material. Trava a ordem
    // de hoje; só adicionar material no fim (ver comentário em registry.ts).
    const names = knobById('plant.load.material_a')!.options!;
    expect(names).toEqual([
      'STAINLESS_316',
      'CARBON_STEEL',
      'ALUMINUM',
      'GLASS',
      'POLYPROPYLENE',
      'PEEK',
      'SILICONE',
      'COTTON_TEXTILE',
    ]);
    for (const n of names) expect(MATERIALS).toHaveProperty(n);
  });
});
