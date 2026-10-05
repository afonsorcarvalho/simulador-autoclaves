import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntime, resetRuntime, coldInitial } from '../../server/runtime/singleton.js';
import { knobById } from '../../server/knobs/registry.js';
import { C_to_K } from '@sim/physics';

describe('knobs de temperatura ambiente e porta', () => {
  beforeEach(() => resetRuntime());

  it('plant.ambient.T alimenta atmosphere_T e a máquina fria', () => {
    const rt = getRuntime();
    const k = knobById('plant.ambient.T')!;
    expect(k.default).toBe(23);
    expect([k.min, k.max]).toEqual([0, 45]);
    k.set(rt, 30);
    expect(rt.params.external.atmosphere_T).toBeCloseTo(C_to_K(30), 9);
    expect(k.get(rt)).toBeCloseTo(30, 9);
    expect(coldInitial(rt.params).chamber.T).toBeCloseTo(C_to_K(30), 9);
  });

  it('plant.door.h_open e tau_gas_s vão para os params', () => {
    const rt = getRuntime();
    knobById('plant.door.h_open')!.set(rt, 55);
    knobById('plant.door.tau_gas_s')!.set(rt, 12);
    expect(rt.params.door_h_open_W_per_K).toBe(55);
    expect(rt.params.door_tau_gas_s).toBe(12);
    knobById('plant.door.tau_pressao_s')!.set(rt, 0.3);
    expect(rt.params.door_tau_pressure_s).toBe(0.3);
  });

  it('modo virtual (sem portas): abertura 0 a cada tick', async () => {
    const rt = getRuntime();
    rt.params.door_open = 1.5;
    await rt.tick();
    expect(rt.params.door_open).toBe(0);
  });
});
