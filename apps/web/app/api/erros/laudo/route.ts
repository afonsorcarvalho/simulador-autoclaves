import { NextResponse } from 'next/server';
import { getErrosService, erroParaResposta } from '../../../../server/erros/service';
import { recusarSeRemoto } from '../../../../server/local-only';

export const dynamic = 'force-dynamic';

/** POST { exec }: roda gerar_laudo.py do pacote sobre a pasta da execução.
 *  409 se o pacote não tiver gerar_laudo.py; 400 se exec inválido. */
export async function POST(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  let exec: unknown;
  try {
    exec = ((await req.json()) as Record<string, unknown>).exec;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof exec !== 'string') return NextResponse.json({ error: 'exec obrigatório' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, arquivos: await getErrosService().gerarLaudo(exec) });
  } catch (err) {
    const { status, body } = erroParaResposta(err);
    return NextResponse.json(body, { status });
  }
}
