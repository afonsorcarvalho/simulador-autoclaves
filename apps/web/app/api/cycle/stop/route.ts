import { NextResponse } from 'next/server';
import { getRuntime } from '../../../../server/runtime/singleton';

export async function POST() {
  const runtime = getRuntime();
  if (!runtime.cycle_running) {
    return NextResponse.json({ error: 'no cycle running' }, { status: 409 });
  }
  runtime.stopCycle();
  return NextResponse.json({ ok: true });
}
