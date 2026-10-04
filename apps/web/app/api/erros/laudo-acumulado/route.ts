import { NextResponse } from 'next/server';
import { getErrosService, erroParaResposta } from '../../../../server/erros/service';
import { recusarSeRemoto } from '../../../../server/local-only';

export const dynamic = 'force-dynamic';

/** POST: roda gerar_laudo.py --acumulado sobre o pacote; arquivos ficam em execucoes/_acumulado/.
 *  409 se houver execução rodando ou o pacote não tiver gerar_laudo.py. */
export async function POST(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  try {
    return NextResponse.json({ ok: true, arquivos: await getErrosService().gerarLaudoAcumulado() });
  } catch (err) {
    const { status, body } = erroParaResposta(err);
    return NextResponse.json(body, { status });
  }
}
