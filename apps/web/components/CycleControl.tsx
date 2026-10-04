'use client';

import { useState } from 'react';
import { startCycle, stopCycle, resetPlant } from '../lib/api';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { fmtSeconds, fmtMinutes } from '../lib/format';
import type { Snapshot } from '../server/runtime/snapshot';

export function CycleControl({ snapshot }: { snapshot: Snapshot | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Card title="Cycle">
      <div className="flex items-center gap-4 flex-wrap">
        <Badge variant={snapshot?.cycle_running ? 'ok' : 'neutral'}>
          {snapshot?.cycle_running ? 'running' : 'idle'}
        </Badge>
        <span className="text-slate-300">
          phase: <span className="font-mono">{snapshot?.cycle_phase ?? 'IDLE'}</span>
        </span>
        <span className="text-slate-300">
          elapsed: {fmtSeconds(snapshot?.cycle_elapsed_s ?? 0)}
        </span>
        <span className="text-slate-300">F0: {fmtMinutes(snapshot?.f0_min ?? 0)}</span>
        <div className="ml-auto flex gap-2">
          <button
            disabled={busy || snapshot?.cycle_running}
            onClick={() => void run(() => startCycle())}
            className="px-3 py-1.5 rounded bg-green-700 hover:bg-green-600 text-sm font-medium disabled:opacity-50"
          >
            Start ster-134-prevac
          </button>
          <button
            disabled={busy || !snapshot?.cycle_running}
            onClick={() => void run(() => stopCycle())}
            className="px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-sm font-medium disabled:opacity-50"
          >
            Stop
          </button>
          <button
            disabled={busy}
            onClick={() =>
              confirm(
                'Resetar para máquina fria (tudo a 22 °C e 1 atm)? O ciclo virtual é parado.',
              ) && void run(() => resetPlant('cold'))
            }
            className="px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-sm font-medium disabled:opacity-50"
          >
            Máquina fria
          </button>
          <button
            disabled={busy}
            onClick={() =>
              confirm('Resetar para máquina pré-aquecida? O ciclo virtual é parado.') &&
              void run(() => resetPlant('preheated'))
            }
            className="px-3 py-1.5 rounded bg-orange-700 hover:bg-orange-600 text-sm font-medium disabled:opacity-50"
          >
            Máquina pré-aquecida
          </button>
        </div>
      </div>
      {error && <p className="text-red-400 text-sm mt-2">Error: {error}</p>}
    </Card>
  );
}
