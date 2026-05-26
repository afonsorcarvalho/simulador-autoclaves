import { z } from 'zod';

export const CycleConfigSchema = z.object({
  name: z.string(),
  sterilization_T_C: z.number(),
  sterilization_P_bar: z.number(),
  hold_duration_s: z.number().positive(),
  prevac_pulses: z.number().int().nonnegative(),
  prevac_vacuum_target_bar: z.number().positive(),
  prevac_steam_target_bar: z.number().positive(),
  preheat_duration_s: z.number().nonnegative(),
  dry_duration_s: z.number().nonnegative(),
  f0_target_min: z.number().nonnegative(),
});
export type CycleConfig = z.infer<typeof CycleConfigSchema>;
