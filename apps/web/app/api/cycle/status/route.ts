import { NextResponse } from 'next/server';
import { getRuntime } from '../../../../server/runtime/singleton';

export const dynamic = 'force-dynamic';

export async function GET() {
  const r = getRuntime();
  const snap = r.publisher.latest;
  return NextResponse.json({
    running: r.cycle_running,
    phase: snap?.cycle_phase ?? 'IDLE',
    elapsed_s: snap?.cycle_elapsed_s ?? 0,
    f0_min: snap?.f0_min ?? 0,
  });
}
