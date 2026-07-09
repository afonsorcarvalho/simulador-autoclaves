import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { CycleConfigSchema } from '../../server/virtual-plc/cycle-config.js';

const base = {
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
};

describe('load config in cycle', () => {
  beforeEach(() => resetRuntime());
  it('accepts an optional load block', () => {
    const c = CycleConfigSchema.parse({
      ...base,
      load: [{ material: 'ALUMINUM', mass_kg: 3, witness: true }],
    });
    expect(c.load).toHaveLength(1);
  });
  it('startCycle builds the load nodes from the cycle', () => {
    const r = getRuntime();
    r.startCycle(
      CycleConfigSchema.parse({
        ...base,
        load: [{ material: 'GLASS', mass_kg: 2, witness: true }],
      }),
    );
    const witness = r.orchestrator.getState().load.nodes.find((n) => n.isWitness);
    expect(witness?.material).toBe('GLASS');
  });
  it('defaults the load when the block is omitted', () => {
    const r = getRuntime();
    r.startCycle(CycleConfigSchema.parse(base));
    expect(r.orchestrator.getState().load.nodes.length).toBeGreaterThanOrEqual(2);
  });
});
