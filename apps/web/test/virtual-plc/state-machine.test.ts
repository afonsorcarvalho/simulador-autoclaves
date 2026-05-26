import { describe, it, expect } from 'vitest';
import { CycleStateMachine } from '../../server/virtual-plc/state-machine.js';
import type { CycleConfig } from '../../server/virtual-plc/cycle-config.js';

function makeCycle(): CycleConfig {
  return {
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
}

interface MockSensors {
  P_chamber_bar: number;
  T_test_C: number;
  P_jacket_bar: number;
  F0_min: number;
}

describe('CycleStateMachine', () => {
  it('starts in IDLE', () => {
    const sm = new CycleStateMachine(makeCycle());
    expect(sm.phase).toBe('IDLE');
  });

  it('transitions IDLE → PREHEAT when started', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    expect(sm.phase).toBe('PREHEAT');
  });

  it('transitions PREHEAT → PREVAC_VACUUM after preheat_duration_s', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    const sensors: MockSensors = { P_chamber_bar: 1.0, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 };
    sm.update(150, sensors);
    expect(sm.phase).toBe('PREHEAT');
    sm.update(301, sensors);
    expect(sm.phase).toBe('PREVAC_VACUUM');
  });

  it('PREVAC_VACUUM → PREVAC_STEAM when chamber pressure drops below target', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    const sensors: MockSensors = { P_chamber_bar: 1.0, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 };
    sm.update(301, sensors);
    expect(sm.phase).toBe('PREVAC_VACUUM');

    sm.update(330, { ...sensors, P_chamber_bar: 0.1 });
    expect(sm.phase).toBe('PREVAC_STEAM');
  });

  it('alternates 3 prevac pulses then enters PRESSURIZE', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    let t = 301;
    for (let pulse = 0; pulse < 3; pulse++) {
      sm.update(t, { P_chamber_bar: 1.0, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 });
      expect(sm.phase).toBe('PREVAC_VACUUM');
      sm.update(t + 30, { P_chamber_bar: 0.1, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 });
      expect(sm.phase).toBe('PREVAC_STEAM');
      sm.update(t + 60, { P_chamber_bar: 2.0, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 });
      t += 60;
    }
    expect(sm.phase).toBe('PRESSURIZE');
  });

  it('PRESSURIZE → HOLD when T_test reaches setpoint', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    sm.forcePhase('PRESSURIZE', 500);
    sm.update(550, { P_chamber_bar: 3.04, T_test_C: 134, P_jacket_bar: 3.5, F0_min: 0 });
    expect(sm.phase).toBe('HOLD');
  });

  it('HOLD → EXHAUST after hold_duration_s OR F0 target reached', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    sm.forcePhase('HOLD', 600);
    sm.update(610, { P_chamber_bar: 3.04, T_test_C: 134, P_jacket_bar: 3.5, F0_min: 50 });
    expect(sm.phase).toBe('HOLD');
    sm.update(1030, { P_chamber_bar: 3.04, T_test_C: 134, P_jacket_bar: 3.5, F0_min: 150 });
    expect(sm.phase).toBe('EXHAUST');
  });

  it('EXHAUST → DRY when chamber pressure drops near atmospheric', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    sm.forcePhase('EXHAUST', 1100);
    sm.update(1120, { P_chamber_bar: 0.9, T_test_C: 100, P_jacket_bar: 3.5, F0_min: 150 });
    expect(sm.phase).toBe('DRY');
  });

  it('EXHAUST → DRY pins regression: triggers at atmospheric (1.013 bar)', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    sm.forcePhase('EXHAUST', 1100);
    // 1.013 bar = exactly atmospheric. Old buggy `< 1.0` would never trigger.
    sm.update(1120, { P_chamber_bar: 1.013, T_test_C: 100, P_jacket_bar: 3.5, F0_min: 150 });
    expect(sm.phase).toBe('DRY');
  });

  it('DRY → COMPLETE after dry_duration_s', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    sm.forcePhase('DRY', 1200);
    sm.update(1700, { P_chamber_bar: 0.1, T_test_C: 80, P_jacket_bar: 3.5, F0_min: 150 });
    expect(sm.phase).toBe('DRY');
    sm.update(1701, { P_chamber_bar: 0.1, T_test_C: 80, P_jacket_bar: 3.5, F0_min: 150 });
    expect(sm.phase).toBe('COMPLETE');
  });

  it('tracks current prevac pulse count', () => {
    const sm = new CycleStateMachine(makeCycle());
    sm.start();
    sm.update(301, { P_chamber_bar: 1.0, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 });
    expect(sm.prevacPulseIndex).toBe(0);
    sm.update(330, { P_chamber_bar: 0.1, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 });
    sm.update(360, { P_chamber_bar: 2.0, T_test_C: 22, P_jacket_bar: 3.5, F0_min: 0 });
    expect(sm.prevacPulseIndex).toBe(1);
  });
});
