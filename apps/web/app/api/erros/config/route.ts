import { isAbsolute } from 'node:path';
import { NextResponse } from 'next/server';
import { getErrosService } from '../../../../server/erros/service';
import type { ErrosConfig } from '../../../../server/erros/config';
import { recusarSeRemoto } from '../../../../server/local-only';

export const dynamic = 'force-dynamic';

/** GET: config pública do simulador de erros (nunca inclui a senha de VNC). */
export async function GET(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  return NextResponse.json(getErrosService().getConfig());
}

/** POST: salva a config. vncSenha vazia ('') mantém a senha já salva. */
export async function POST(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const patch: Partial<ErrosConfig> = {};
  if (typeof body.plcIp === 'string') patch.plcIp = body.plcIp;
  if (typeof body.ihmIp === 'string') patch.ihmIp = body.ihmIp;
  if (body.vncPort === null || typeof body.vncPort === 'number') patch.vncPort = body.vncPort;
  if (typeof body.vncSenha === 'string') patch.vncSenha = body.vncSenha;
  if (typeof body.commitClp === 'string') patch.commitClp = body.commitClp;
  if (typeof body.versaoIhm === 'string') patch.versaoIhm = body.versaoIhm;
  if (typeof body.pacoteDir === 'string') {
    // pacoteDir tem script python que o servidor executa (gerar_laudo.py): só pasta local
    // absoluta. Recusa compartilhamento de rede (UNC \\host ou //host) e caminho relativo.
    // '' (limpar) é permitido.
    const d = body.pacoteDir;
    if (d !== '' && (/^[\\/]{2}/.test(d) || !isAbsolute(d))) {
      return NextResponse.json({ error: 'pacoteDir deve ser caminho absoluto local' }, { status: 400 });
    }
    patch.pacoteDir = d;
  }
  return NextResponse.json(getErrosService().setConfig(patch));
}
