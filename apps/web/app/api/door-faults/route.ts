import { NextResponse } from 'next/server';
import { getRuntime } from '../../../server/runtime/singleton';
import type { DeltaPlcBridge } from '../../../server/bridge/delta-plc';
import { applyDoorFaults } from '../../../server/bridge/door-faults';

export const dynamic = 'force-dynamic';

/** POST { side: 'C'|'D', faults: Partial<DoorFaults> } — merge nas falhas da porta (memória). */
export async function POST(req: Request) {
  const bridge = getRuntime().bridge as Partial<DeltaPlcBridge>;
  let body: { side?: unknown; faults?: Record<string, unknown> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { status, body: resBody } = applyDoorFaults(bridge, body.side, body.faults);
  return NextResponse.json(resBody, { status });
}
