import { NextResponse } from 'next/server';
import { checar, type Ctx } from '../../../../../server/ciclos/http';
import { csv, ler } from '../../../../../server/ciclos/store';

export const dynamic = 'force-dynamic';

/** Série do ciclo em CSV pt-BR (`;`, vírgula decimal), como download. */
export async function GET(req: Request, ctx: Ctx) {
  const r = await checar(req, ctx);
  if (r instanceof Response) return r;
  const c = ler(r.id);
  if (!c) return NextResponse.json({ error: 'ciclo não encontrado' }, { status: 404 });
  return new Response(csv(c), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${r.id}.csv"`,
    },
  });
}
