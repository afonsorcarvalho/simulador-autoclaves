import { NextResponse } from 'next/server';
import { getRuntime } from '../../../server/runtime/singleton';
import type { DeltaPlcBridge } from '../../../server/bridge/delta-plc';
import { applyDoorFaults } from '../../../server/bridge/door-faults';
import { FaultSchema } from '../../../server/faults/schema';
import type { Fault } from '../../../server/faults/types';
import { recusarSeRemoto } from '../../../server/local-only';

export const dynamic = 'force-dynamic';

function isValidFault(f: unknown): f is Fault {
  return FaultSchema.safeParse(f).success;
}

/** GET: falhas físicas ativas (digital/analógico/válvula/utilidade/corte) — pro dashboard. */
export async function GET(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  return NextResponse.json({ faults: getRuntime().faults.list() });
}

/**
 * POST { action: 'set', fault: Fault } — injeta/atualiza uma falha.
 *      { action: 'clear', id: string } — remove uma falha.
 *      { action: 'clearAll' } — remove todas.
 *      { action: 'door', side: 'C'|'D', faults: Partial<DoorFaults> } — repassa pro bridge (HIL).
 */
export async function POST(req: Request) {
  const negado = recusarSeRemoto(req);
  if (negado) return negado;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const rt = getRuntime();

  if (body.action === 'clearAll') {
    rt.faults.clearAll();
    return NextResponse.json({ ok: true, faults: [] });
  }

  if (body.action === 'clear') {
    if (typeof body.id !== 'string') {
      return NextResponse.json({ error: 'id deve ser string' }, { status: 400 });
    }
    rt.faults.clear(body.id);
    return NextResponse.json({ ok: true, faults: rt.faults.list() });
  }

  if (body.action === 'set') {
    if (!isValidFault(body.fault)) {
      return NextResponse.json({ error: 'fault inválido' }, { status: 400 });
    }
    const fault = body.fault;
    if (fault.tipo === 'power.cut') {
      // Corte de energia precisa de um bit M configurado na bancada (SIM_POWER_CUT_BIT); sem
      // isso não há onde escrever o evento no CLP.
      const bridge = rt.bridge as Partial<DeltaPlcBridge>;
      if (bridge.powerCutBit == null) {
        return NextResponse.json(
          { error: 'corte de energia não configurado (SIM_POWER_CUT_BIT)' },
          { status: 409 },
        );
      }
    }
    try {
      rt.faults.set(fault);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, faults: rt.faults.list() });
  }

  if (body.action === 'door') {
    const bridge = rt.bridge as Partial<DeltaPlcBridge>;
    const { status, body: resBody } = applyDoorFaults(bridge, body.side, body.faults);
    return NextResponse.json(resBody, { status });
  }

  return NextResponse.json({ error: 'action inválida' }, { status: 400 });
}
