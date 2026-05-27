import { NextResponse } from 'next/server';
import { getRuntime } from '../../../../server/runtime/singleton';
import { setManualValve } from '../../../../server/runtime/manual-control';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { value?: boolean };
  try {
    body = (await req.json()) as { value?: boolean };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body.value !== 'boolean') {
    return NextResponse.json({ error: 'body must be { value: boolean }' }, { status: 400 });
  }
  try {
    await setManualValve(getRuntime(), id, body.value);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id, value: body.value });
}
