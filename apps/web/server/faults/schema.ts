import { z } from 'zod';
import { PLC_INPUTS } from '../bridge/delta-plc.js';
import type { FaultTipo } from './types.js';

const TIPOS = [
  'analog.open',
  'analog.freeze',
  'analog.offset',
  'analog.force',
  'digital.force',
  'valve.stuck',
  'utility.off',
  'power.cut',
] as const satisfies readonly FaultTipo[];

/** Mesma validação de `app/api/faults/route.ts` (isValidFault), como schema zod reutilizável
 *  pelo esquema de cenário (`server/erros/scenario.ts`). */
export const FaultSchema = z
  .object({
    id: z.string().min(1),
    tipo: z.enum(TIPOS),
    alvo: z.string(),
    valor: z.number().finite().optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.tipo === 'digital.force' && !(PLC_INPUTS as readonly string[]).includes(f.alvo)) {
      ctx.addIssue({ code: 'custom', message: `alvo digital desconhecido: ${f.alvo}` });
    }
    if (f.tipo === 'utility.off' && f.alvo !== 'steam_line') {
      ctx.addIssue({ code: 'custom', message: `alvo utility.off inválido: ${f.alvo}` });
    }
  });
