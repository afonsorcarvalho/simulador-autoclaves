// packages/physics/test/cli-load.test.ts
import { describe, it, expect } from 'vitest';
import { resolveLoadItems } from '../src/cli.js';

describe('resolveLoadItems', () => {
  it('maps legacy {metal_kg, fabric_kg} to steel + textile witness', () => {
    const items = resolveLoadItems({ metal_kg: 20, fabric_kg: 5 });
    expect(items).toEqual([
      { name: 'metal', material: 'STAINLESS_316', mass_kg: 20 },
      { name: 'fabric', material: 'COTTON_TEXTILE', mass_kg: 5, witness: true },
    ]);
  });
  it('passes an explicit item list through unchanged', () => {
    const list = [{ material: 'ALUMINUM' as const, mass_kg: 3 }];
    expect(resolveLoadItems(list)).toBe(list);
  });
  it('returns undefined when load is absent (→ default handled downstream)', () => {
    expect(resolveLoadItems(undefined)).toBeUndefined();
  });
});
