import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { knobById } from '../../server/knobs/registry.js';
import { applyOne } from '../../server/knobs/store.js';
import { CycleConfigSchema } from '../../server/virtual-plc/cycle-config.js';
import { C_to_K, MATERIALS } from '@sim/physics';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = CycleConfigSchema.parse({
  name: 't',
  sterilization_T_C: 134,
  sterilization_P_bar: 3.04,
  hold_duration_s: 60,
  prevac_pulses: 0,
  prevac_vacuum_target_bar: 0.2,
  prevac_steam_target_bar: 2,
  preheat_duration_s: 10,
  dry_duration_s: 60,
  f0_target_min: 1,
});
const tmp = join(tmpdir(), `knobs-load-${process.pid}.json`);
const idx = (m: string) => knobById('plant.load.material_a')!.options!.indexOf(m);
const nodes = () => getRuntime().orchestrator.getState().load.nodes;

describe('knobs de carga', () => {
  beforeEach(() => resetRuntime());

  it('validam faixa e lista de materiais', () => {
    const rt = getRuntime();
    const a = knobById('plant.load.material_a')!;
    expect(a.options).toEqual(Object.keys(MATERIALS));
    expect(a.default).toBe(idx('STAINLESS_316'));
    expect(knobById('plant.load.material_b')!.default).toBe(idx('COTTON_TEXTILE'));
    expect(() => applyOne(rt, 'plant.load.material_a', 8, tmp)).toThrow();
    expect(() => applyOne(rt, 'plant.load.material_a', 1.5, tmp)).toThrow();
    expect(() => applyOne(rt, 'plant.load.mass_a_kg', 201, tmp)).toThrow();
    expect(() => applyOne(rt, 'plant.load.T_initial', -2, tmp)).toThrow(); // -1 é a sentinela válida
    expect(knobById('plant.load.mass_a_kg')!.default).toBe(20);
    expect(knobById('plant.load.mass_b_kg')!.default).toBe(5);
  });

  it('dois materiais: soma das capacidades térmicas, testemunho B; ociosa reconstrói na hora', () => {
    const rt = getRuntime();
    knobById('plant.load.material_a')!.set(rt, idx('ALUMINUM'));
    knobById('plant.load.mass_a_kg')!.set(rt, 30);
    knobById('plant.load.material_b')!.set(rt, idx('GLASS'));
    knobById('plant.load.mass_b_kg')!.set(rt, 10);
    const n = nodes();
    expect(n.map((x) => [x.material, x.mass_kg, !!x.isWitness])).toEqual([
      ['ALUMINUM', 30, false],
      ['GLASS', 10, true],
    ]);
    const C = n.reduce((s, x) => s + x.mass_kg * MATERIALS[x.material].cp, 0);
    expect(C).toBeCloseTo(30 * MATERIALS.ALUMINUM.cp + 10 * MATERIALS.GLASS.cp, 6);
  });

  it('massa B = 0: só A, testemunho A', () => {
    const rt = getRuntime();
    knobById('plant.load.mass_b_kg')!.set(rt, 0);
    rt.startCycle(base);
    expect(nodes().map((x) => [x.material, !!x.isWitness])).toEqual([['STAINLESS_316', true]]);
  });

  it('T_initial = -1 (sentinela, default) segue o ambiente; valor explícito ignora mudança de ambiente depois', () => {
    const rt = getRuntime();
    expect(knobById('plant.load.T_initial')!.default).toBe(-1);
    // Sentinela: get() devolve -1 cru, não resolvido — nunca "vira null" por coincidir com o ambiente.
    expect(knobById('plant.load.T_initial')!.get(rt)).toBe(-1);
    knobById('plant.ambient.T')!.set(rt, 28);
    expect(knobById('plant.load.T_initial')!.get(rt)).toBe(-1); // ainda a sentinela, ambiente não "consome" ela
    rt.orchestrator.setLoadState({
      nodes: nodes().map((x) => ({ ...x, T: C_to_K(130) })),
    });
    rt.startCycle(base);
    for (const x of nodes()) expect(x.T).toBeCloseTo(C_to_K(28), 9); // ciclo resolve p/ o ambiente atual

    // Valor explícito (ex.: coincide com um ambiente antigo de 23 °C) não deve "virar" a sentinela
    // e deve se manter mesmo subindo o ambiente depois — era o bug do antigo sentinela por igualdade.
    knobById('plant.load.T_initial')!.set(rt, 23);
    knobById('plant.ambient.T')!.set(rt, 30);
    expect(knobById('plant.load.T_initial')!.get(rt)).toBe(23);
    rt.orchestrator.setLoadState({
      nodes: nodes().map((x) => ({ ...x, T: C_to_K(130) })),
    });
    rt.startCycle(base);
    for (const x of nodes()) expect(x.T).toBeCloseTo(C_to_K(23), 9);
  });

  it('carga do ciclo prevalece (só T_initial aplica); knob em ciclo vale no próximo', () => {
    const rt = getRuntime();
    knobById('plant.load.T_initial')!.set(rt, 10);
    rt.startCycle(
      CycleConfigSchema.parse({ ...base, load: [{ material: 'PEEK', mass_kg: 2, witness: true }] }),
    );
    expect(nodes().map((x) => [x.material, x.T])).toEqual([['PEEK', C_to_K(10)]]);
    knobById('plant.load.mass_a_kg')!.set(rt, 99);
    expect(nodes()[0]!.material).toBe('PEEK');
  });
});
