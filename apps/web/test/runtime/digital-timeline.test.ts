import { describe, it, expect } from 'vitest';
import { segments, buildLanes } from '../../lib/digitalTimeline.js';
import type { Snapshot } from '../../server/runtime/snapshot.js';

const snap = (t: number, vac: boolean, extra: Partial<Snapshot> = {}): Snapshot =>
  ({
    cycle_elapsed_s: t,
    valves: { V_VAC: vac, V_STEAM_IN_INT: false, V_DRAIN_JACKET: false },
    actuators: { PUMP_VAC: vac },
    ...extra,
  }) as Snapshot;

describe('digital timeline', () => {
  it('segments faz run-length encode por mudança', () => {
    const h = [snap(0, false), snap(1, true), snap(2, true), snap(3, false), snap(4, false)];
    expect(segments(h, (s) => s.valves.V_VAC)).toEqual([
      { from: 0, to: 1, v: false },
      { from: 1, to: 3, v: true },
      { from: 3, to: 4, v: false },
    ]);
    expect(segments([], () => 1)).toEqual([]);
  });

  it('buildLanes esconde sinais parados que não são principais, salvo mostrar todas', () => {
    const h = [snap(0, false), snap(5, true)];
    const ids = (all: boolean) => buildLanes(h, all).map((l) => l.signal.id);
    expect(ids(false)).toContain('V_VAC');
    expect(ids(false)).toContain('V_STEAM_IN_INT'); // principal
    expect(ids(false)).not.toContain('V_DRAIN_JACKET');
    expect(ids(true)).toContain('V_DRAIN_JACKET');
    expect(ids(true)).not.toContain('V_AIR_IN'); // ausente do snapshot
    expect(buildLanes(h, false).find((l) => l.signal.id === 'PUMP_VAC')!.on).toEqual([
      { from: 5, to: 5, v: true },
    ]);
  });

  it('inclui saídas do CLP quando plc_outputs existe', () => {
    const h = [
      snap(0, false, { plc_outputs: { OUT_ALARME_SONORO: false } }),
      snap(1, false, { plc_outputs: { OUT_ALARME_SONORO: true } }),
    ];
    expect(buildLanes(h, false).map((l) => l.signal.id)).toContain('PLC:OUT_ALARME_SONORO');
  });
});
