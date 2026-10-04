import { NextResponse } from 'next/server';
import { checar, type Ctx } from '../../../../server/ciclos/http';
import { apagar, editar, ler } from '../../../../server/ciclos/store';

export const dynamic = 'force-dynamic';

const naoAchou = () => NextResponse.json({ error: 'ciclo não encontrado' }, { status: 404 });

export async function GET(req: Request, ctx: Ctx) {
  const r = await checar(req, ctx);
  if (r instanceof Response) return r;
  const c = ler(r.id);
  return c ? NextResponse.json(c) : naoAchou();
}

export async function PATCH(req: Request, ctx: Ctx) {
  const r = await checar(req, ctx);
  if (r instanceof Response) return r;
  let body: { nome?: unknown; anotacao?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const ok = (v: unknown) => v === undefined || typeof v === 'string';
  if (!ok(body.nome) || !ok(body.anotacao))
    return NextResponse.json({ error: 'body: { nome?: string, anotacao?: string }' }, { status: 400 });
  const c = editar(r.id, {
    ...(body.nome !== undefined && { nome: body.nome as string }),
    ...(body.anotacao !== undefined && { anotacao: body.anotacao as string }),
  });
  return c ? NextResponse.json({ ok: true, meta: c.meta }) : naoAchou();
}

export async function DELETE(req: Request, ctx: Ctx) {
  const r = await checar(req, ctx);
  if (r instanceof Response) return r;
  return apagar(r.id) ? NextResponse.json({ ok: true }) : naoAchou();
}
