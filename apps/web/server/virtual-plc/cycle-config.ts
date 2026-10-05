import { z } from 'zod';

const LoadItemSchema = z.object({
  name: z.string().optional(),
  material: z.enum([
    'STAINLESS_316',
    'CARBON_STEEL',
    'ALUMINUM',
    'GLASS',
    'POLYPROPYLENE',
    'PEEK',
    'SILICONE',
    'COTTON_TEXTILE',
  ]),
  mass_kg: z.number().positive(),
  initial_T_C: z.number().optional(),
  witness: z.boolean().optional(),
  embalagem: z.enum(['nenhuma', 'pacote_textil', 'caixa_sms', 'grau_cirurgico']).optional(),
});

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
  load: z.array(LoadItemSchema).optional(),
});
export type CycleConfig = z.infer<typeof CycleConfigSchema>;
