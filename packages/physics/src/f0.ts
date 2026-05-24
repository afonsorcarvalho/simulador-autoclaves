import { K_to_C, T_REF_F0_C, Z_F0 } from './constants.js';

export class F0Accumulator {
  value_minutes = 0;

  step(T_K: number, dt_s: number): void {
    const t_C = K_to_C(T_K);
    if (t_C < 100) return;
    const lethality = Math.pow(10, (t_C - T_REF_F0_C) / Z_F0);
    this.value_minutes += (lethality * dt_s) / 60;
  }
}
