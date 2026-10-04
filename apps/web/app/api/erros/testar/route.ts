import { NextResponse } from 'next/server';
import { getErrosService, erroParaResposta } from '../../../../server/erros/service';
import { recusarSeRemoto } from '../../../../server/local-only';

export const dynamic = 'force-dynamic';

/** POST: testa conexão — CLP (lê 1 registro) e IHM (foto VNC de teste). Nunca devolve a senha. */
export async function POST(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  try {
    return NextResponse.json(await getErrosService().testar());
  } catch (err) {
    const { status, body } = erroParaResposta(err);
    return NextResponse.json(body, { status });
  }
}
