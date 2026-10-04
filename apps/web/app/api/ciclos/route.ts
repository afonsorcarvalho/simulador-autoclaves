import { NextResponse } from 'next/server';
import { recusarSeRemoto } from '../../../server/local-only';
import { listar } from '../../../server/ciclos/store';

export const dynamic = 'force-dynamic';

/** Lista os ciclos gravados (meta + parâmetros + resumo, sem série), mais recente primeiro. */
export async function GET(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  return NextResponse.json({ ciclos: listar() });
}
