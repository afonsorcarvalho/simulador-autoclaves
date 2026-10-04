import { NextResponse } from 'next/server';
import { getErrosService, erroParaResposta } from '../../../../server/erros/service';
import { recusarSeRemoto } from '../../../../server/local-only';

export const dynamic = 'force-dynamic';

/** POST { ids?: string[] }: roda os cenários do pacote (todos se `ids` ausente) em background.
 *  409 se já houver execução em andamento, ou sem CLP real conectado (modo virtual).
 *  400 se algum id não existir no pacote. 409 se não houver pacote configurado. */
export async function POST(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  let body: Record<string, unknown> = {};
  try {
    const texto = await req.text();
    if (texto) body = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  let ids: string[] | undefined;
  if (body.ids !== undefined) {
    if (!Array.isArray(body.ids) || !body.ids.every((x) => typeof x === 'string')) {
      return NextResponse.json({ error: 'ids deve ser string[]' }, { status: 400 });
    }
    ids = body.ids as string[];
  }
  try {
    getErrosService().iniciar(ids);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body: erroBody } = erroParaResposta(err);
    return NextResponse.json(erroBody, { status });
  }
}
