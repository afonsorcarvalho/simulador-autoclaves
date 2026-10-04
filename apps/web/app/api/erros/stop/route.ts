import { NextResponse } from 'next/server';
import { getErrosService } from '../../../../server/erros/service';
import { recusarSeRemoto } from '../../../../server/local-only';

export const dynamic = 'force-dynamic';

/** POST: pede pra parar no próximo ponto de espera (limpeza do cenário atual ainda roda). */
export async function POST(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  getErrosService().parar();
  return NextResponse.json({ ok: true });
}
