import { NextResponse } from 'next/server';
import { getRuntime } from '../../../server/runtime/singleton';
import type { DeltaPlcBridge } from '../../../server/bridge/delta-plc';
import { applyDoorCommand } from '../../../server/bridge/door-faults';
import { recusarSeRemoto } from '../../../server/local-only';

export const dynamic = 'force-dynamic';

/** POST { side: 'C'|'D', acao: 'abrir'|'fechar'|'parar' } — operador move a porta manual (tipos 1/2). */
export async function POST(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  let body: { side?: unknown; acao?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const bridge = getRuntime().bridge as Partial<DeltaPlcBridge>;
  const { status, body: resBody } = applyDoorCommand(bridge, body.side, body.acao);
  return NextResponse.json(resBody, { status });
}
