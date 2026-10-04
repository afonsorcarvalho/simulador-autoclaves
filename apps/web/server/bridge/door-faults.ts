import type { DeltaPlcBridge, DoorFaults, DoorSide } from './delta-plc.js';

const KEYS = ['obstaculo', 'fc_aberta', 'fc_fechada', 'vazamento', 'pistao_lento'] as const;

/**
 * Valida e aplica falhas de porta num bridge (duck typing, não `instanceof`: o runtime vive em
 * globalThis e a rota carrega outra cópia da classe). Compartilhado por /api/door-faults e pela
 * ação `door` de /api/faults.
 *
 * Vive fora de app/api/*: um route.ts só pode exportar os handlers HTTP e configs reconhecidas
 * (GET/POST/dynamic/...) — qualquer outro export aqui quebra `next build`.
 */
export function applyDoorFaults(
  bridge: Partial<DeltaPlcBridge>,
  side: unknown,
  faultsRaw: unknown,
): { status: number; body: Record<string, unknown> } {
  if (typeof bridge.setFaults !== 'function' || !bridge.faults) {
    return { status: 409, body: { error: 'só com SIM_PLC=delta' } };
  }
  if (side !== 'C' && side !== 'D') {
    return { status: 400, body: { error: "side deve ser 'C' ou 'D'" } };
  }
  const f = faultsRaw ?? {};
  if (typeof f !== 'object' || Array.isArray(f)) {
    return { status: 400, body: { error: 'faults deve ser objeto' } };
  }
  const out: Partial<DoorFaults> = {};
  for (const k of KEYS) {
    if (!(k in f)) continue;
    const v = (f as Record<string, unknown>)[k];
    const ok =
      k === 'obstaculo'
        ? v === null || (typeof v === 'number' && v >= 0 && v <= 1)
        : k === 'vazamento' || k === 'pistao_lento'
          ? typeof v === 'boolean'
          : v === null || typeof v === 'boolean';
    if (!ok) return { status: 400, body: { error: `valor inválido em ${k}` } };
    (out as Record<string, unknown>)[k] = v;
  }
  const s = side as DoorSide;
  bridge.setFaults(s, out);
  return { status: 200, body: { ok: true, side: s, faults: bridge.faults[s] } };
}

/** Comando do operador numa porta manual (tipos 1/2). 409 sem CLP real ou no tipo 3. */
export function applyDoorCommand(
  bridge: Partial<DeltaPlcBridge>,
  side: unknown,
  acao: unknown,
): { status: number; body: Record<string, unknown> } {
  if (typeof bridge.comandarPorta !== 'function') {
    return { status: 409, body: { error: 'só com SIM_PLC=delta' } };
  }
  if (side !== 'C' && side !== 'D') return { status: 400, body: { error: "side deve ser 'C' ou 'D'" } };
  if (acao !== 'abrir' && acao !== 'fechar' && acao !== 'parar') {
    return { status: 400, body: { error: "acao deve ser 'abrir', 'fechar' ou 'parar'" } };
  }
  if (!bridge.comandarPorta(side, acao)) {
    return { status: 409, body: { error: 'porta automática (tipo 3): quem comanda é o CLP' } };
  }
  return { status: 200, body: { ok: true, side, acao } };
}
