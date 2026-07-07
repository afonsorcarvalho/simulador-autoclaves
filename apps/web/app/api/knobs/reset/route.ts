import { NextResponse } from 'next/server';
import { getRuntime } from '../../../../server/runtime/singleton';
import { resetAll } from '../../../../server/knobs/store';

export const dynamic = 'force-dynamic';

export async function POST() {
  resetAll(getRuntime());
  return NextResponse.json({ ok: true });
}
