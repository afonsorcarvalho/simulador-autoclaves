import { z } from 'zod';

export const SpaceNameSchema = z.enum([
  'discrete_inputs',
  'coils',
  'input_registers',
  'holding_registers',
  'diagnostics',
]);
export type SpaceName = z.infer<typeof SpaceNameSchema>;

export const SpaceDefSchema = z.object({
  base: z.number().int().min(0).max(0xffff),
  end: z.number().int().min(0).max(0xffff),
  description: z.string().optional(),
});
export type SpaceDef = z.infer<typeof SpaceDefSchema>;

export const RegisterSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'id must be UPPER_SNAKE_CASE starting with a letter'),
  space: SpaceNameSchema,
  address: z.number().int().min(0).max(0xffff),
  type: z.enum(['bool', 'int16', 'uint16']).optional(),
  scale: z.number().positive().optional(),
  unit: z.string().optional(),
  range: z.tuple([z.number(), z.number()]).optional(),
  description: z.string().min(1),
});
export type Register = z.infer<typeof RegisterSchema>;

export const RegisterFileSchema = z.object({
  version: z.literal(1),
  spaces: z.record(SpaceNameSchema, SpaceDefSchema),
  registers: z.array(RegisterSchema).min(1),
});
export type RegisterFile = z.infer<typeof RegisterFileSchema>;
