import { NextResponse } from 'next/server';
import { recusarSeRemoto } from '../local-only';
import { ID_RE } from './store';

export type Ctx = { params: Promise<{ id: string }> };

/** Trava de localhost + id validado pela regex do nome do arquivo (barra/`..` → 400). */
export async function checar(req: Request, ctx: Ctx): Promise<{ id: string } | Response> {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  return { id };
}
