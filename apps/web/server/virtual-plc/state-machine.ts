import type { CycleConfig } from './cycle-config.js';

export type CyclePhase =
  | 'IDLE'
  | 'PREHEAT'
  | 'PREVAC_VACUUM'
  | 'PREVAC_STEAM'
  | 'PRESSURIZE'
  | 'HOLD'
  | 'EXHAUST'
  | 'DRY'
  | 'COMPLETE';

export interface PLCSensors {
  P_chamber_bar: number;
  T_test_C: number;
  P_jacket_bar: number;
  F0_min: number;
}

export class CycleStateMachine {
  phase: CyclePhase = 'IDLE';
  prevacPulseIndex = 0;
  phaseStartedAt = 0;

  constructor(private readonly cycle: CycleConfig) {}

  start(): void {
    this.phase = 'PREHEAT';
    this.phaseStartedAt = 0;
    this.prevacPulseIndex = 0;
  }

  /** Forces a transition for testing. */
  forcePhase(phase: CyclePhase, at_time_s: number): void {
    this.phase = phase;
    this.phaseStartedAt = at_time_s;
  }

  /** Advance phase logic given current time and sensor readings. */
  update(time_s: number, s: PLCSensors): void {
    const elapsed = time_s - this.phaseStartedAt;

    switch (this.phase) {
      case 'IDLE':
        return;

      case 'PREHEAT':
        if (elapsed >= this.cycle.preheat_duration_s) this.transition('PREVAC_VACUUM', time_s);
        return;

      case 'PREVAC_VACUUM':
        if (s.P_chamber_bar <= this.cycle.prevac_vacuum_target_bar) {
          this.transition('PREVAC_STEAM', time_s);
        }
        return;

      case 'PREVAC_STEAM':
        if (s.P_chamber_bar >= this.cycle.prevac_steam_target_bar) {
          this.prevacPulseIndex++;
          if (this.prevacPulseIndex >= this.cycle.prevac_pulses) {
            this.transition('PRESSURIZE', time_s);
          } else {
            this.transition('PREVAC_VACUUM', time_s);
          }
        }
        return;

      case 'PRESSURIZE':
        if (s.T_test_C >= this.cycle.sterilization_T_C) {
          this.transition('HOLD', time_s);
        }
        return;

      case 'HOLD':
        if (elapsed >= this.cycle.hold_duration_s || s.F0_min >= this.cycle.f0_target_min) {
          this.transition('EXHAUST', time_s);
        }
        return;

      case 'EXHAUST':
        if (s.P_chamber_bar < 1.0) this.transition('DRY', time_s);
        return;

      case 'DRY':
        if (elapsed > this.cycle.dry_duration_s) this.transition('COMPLETE', time_s);
        return;

      case 'COMPLETE':
        return;
    }
  }

  private transition(next: CyclePhase, at_time_s: number): void {
    this.phase = next;
    this.phaseStartedAt = at_time_s;
  }
}
