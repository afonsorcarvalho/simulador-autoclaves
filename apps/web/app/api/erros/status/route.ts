import { NextResponse } from 'next/server';
import { getErrosService } from '../../../../server/erros/service';
import { recusarSeRemoto } from '../../../../server/local-only';

export const dynamic = 'force-dynamic';

/** GET: estado atual (OCIOSO/RODANDO/AGUARDANDO_OPERADOR/PARANDO), instrução do passo manual
 *  em curso (se houver) e os resultados parciais da execução atual/última. */
export async function GET(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  return NextResponse.json(getErrosService().status());
}
