import { NextResponse } from 'next/server';
import { getRuntime } from '../../../server/runtime/singleton';
import { knobMeta, knobById } from '../../../server/knobs/registry';
import { applyOne, currentValues } from '../../../server/knobs/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rt = getRuntime();
  return NextResponse.json({ knobs: knobMeta(), values: currentValues(rt) });
}

export async function POST(req: Request) {
  let body: { id?: string; value?: number };
  try {
    body = (await req.json()) as { id?: string; value?: number };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body.id !== 'string' || typeof body.value !== 'number') {
    return NextResponse.json(
      { error: 'body must be { id: string, value: number }' },
      { status: 400 },
    );
  }
  const knob = knobById(body.id);
  if (!knob) {
    return NextResponse.json({ error: `unknown knob "${body.id}"` }, { status: 400 });
  }
  const rt = getRuntime();
  if (knob.timing !== 'live' && rt.cycle_running) {
    return NextResponse.json(
      {
        error:
          knob.timing === 'reset'
            ? 'geometria da câmara só muda com a máquina parada'
            : 'cycle knobs cannot change while a cycle is running',
      },
      { status: 409 },
    );
  }
  try {
    applyOne(rt, body.id, body.value);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: body.id, value: body.value });
}
