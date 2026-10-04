import { NextResponse } from 'next/server';
import { getErrosService, erroParaResposta } from '../../../../server/erros/service';
import { recusarSeRemoto } from '../../../../server/local-only';

export const dynamic = 'force-dynamic';

/** GET: lista os cenários do pacote configurado (id, titulo, origem, automacao).
 *  409 se nenhum pacote estiver configurado (ou a pasta não existir). */
export async function GET(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  try {
    return NextResponse.json({ cenarios: getErrosService().listarCenarios() });
  } catch (err) {
    const { status, body } = erroParaResposta(err);
    return NextResponse.json(body, { status });
  }
}
