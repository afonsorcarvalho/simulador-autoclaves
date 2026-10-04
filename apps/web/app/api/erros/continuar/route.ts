import { NextResponse } from 'next/server';
import { getErrosService } from '../../../../server/erros/service';
import { recusarSeRemoto } from '../../../../server/local-only';

export const dynamic = 'force-dynamic';

/** POST: libera o passo `manual` em curso (estado AGUARDANDO_OPERADOR). */
export async function POST(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  getErrosService().continuar();
  return NextResponse.json({ ok: true });
}
