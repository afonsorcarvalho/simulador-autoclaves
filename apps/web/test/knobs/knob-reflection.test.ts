import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { knobById } from '../../server/knobs/registry.js';
import { CycleStateMachine, type PLCSensors } from '../../server/virtual-plc/state-machine.js';
import type { CycleConfig } from '../../server/virtual-plc/cycle-config.js';

const YAML_CYCLE: CycleConfig = {
  name: 'ster-134-prevac',
  sterilization_T_C: 134,
  sterilization_P_bar: 3.04,
  hold_duration_s: 420,
  prevac_pulses: 3,
  prevac_vacuum_target_bar: 0.15,
  prevac_steam_target_bar: 2.0,
  preheat_duration_s: 300,
  dry_duration_s: 500,
  f0_target_min: 100,
};

describe('knob changes reflect into the simulation', () => {
  beforeEach(() => resetRuntime());

  // The reported bug: change prevac_pulses 3 -> 6, but the cycle still ran 3 pulses.
  it('cycle.prevac_pulses set via knob reaches the started cycle (effectiveCycle)', () => {
    const rt = getRuntime();
    knobById('cycle.prevac_pulses')!.set(rt, 6);
    rt.startCycle(YAML_CYCLE); // YAML says 3
    expect(rt.effectiveCycle?.prevac_pulses).toBe(6);
  });

  it('every cycle knob set via its accessor lands in effectiveCycle at startCycle', () => {
    const rt = getRuntime();
    knobById('cycle.sterilization_T')!.set(rt, 121);
    knobById('cycle.hold_duration')!.set(rt, 900);
    knobById('cycle.prevac_pulses')!.set(rt, 5);
    knobById('cycle.prevac_vacuum_target')!.set(rt, 0.3);
    knobById('cycle.prevac_steam_target')!.set(rt, 2.5);
    knobById('cycle.dry_duration')!.set(rt, 111);
    rt.startCycle(YAML_CYCLE);
    const c = rt.effectiveCycle!;
    expect(c.sterilization_T_C).toBe(121);
    expect(c.hold_duration_s).toBe(900);
    expect(c.prevac_pulses).toBe(5);
    expect(c.prevac_vacuum_target_bar).toBe(0.3);
    expect(c.prevac_steam_target_bar).toBe(2.5);
    expect(c.dry_duration_s).toBe(111);
  });

  it('the state machine actually performs N prevac pulses for prevac_pulses = N', () => {
    const runPulses = (n: number): number => {
      const sm = new CycleStateMachine({ ...YAML_CYCLE, prevac_pulses: n, preheat_duration_s: 0 });
      sm.start(); // PREHEAT
      const lowP: PLCSensors = {
        P_chamber_bar: 0.1,
        T_chamber_C: 40,
        T_test_C: 40,
        P_jacket_bar: 1,
        F0_min: 0,
      }; // hits vacuum target
      const highP: PLCSensors = { ...lowP, P_chamber_bar: 2.5 }; // hits steam target
      let t = 0;
      let pulses = 0;
      // Drive until we leave the prevac loop into PRESSURIZE (or safety cap).
      for (let i = 0; i < 1000; i++) {
        t += 1;
        const before = sm.phase;
        sm.update(t, sm.phase === 'PREVAC_VACUUM' ? lowP : highP);
        if (before === 'PREVAC_STEAM' && sm.phase !== 'PREVAC_STEAM') pulses++;
        if (sm.phase === 'PRESSURIZE') break;
      }
      return pulses;
    };
    expect(runPulses(3)).toBe(3);
    expect(runPulses(6)).toBe(6);
  });

  it('plant knob mutates rt.params in place (Orchestrator reads the ref each tick)', () => {
    const rt = getRuntime();
    knobById('plant.chamber.h_ambient')!.set(rt, 42);
    expect(rt.params.chamber.h_ambient_W_per_K).toBe(42);
  });

  it('controller band knobs mutate rt.controller (passed to plc.tick each tick)', () => {
    const rt = getRuntime();
    knobById('controller.band_low')!.set(rt, 1.0);
    knobById('controller.band_high')!.set(rt, 2.0);
    expect(rt.controller.band_low).toBe(1.0);
    expect(rt.controller.band_high).toBe(2.0);
  });

  it('time.scale knob mutates rt.timeScale (scheduler reads each firing)', () => {
    const rt = getRuntime();
    knobById('time.scale')!.set(rt, 20);
    expect(rt.timeScale).toBe(20);
  });
});
