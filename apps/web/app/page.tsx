'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSnapshot } from '../lib/useSnapshot';
import { startCycle, stopCycle } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { ConnectionIndicator } from '../components/ConnectionIndicator';
import { fmtSeconds, fmtMinutes } from '../lib/format';

export default function Home() {
  const { snapshot, connected } = useSnapshot();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onStart = async () => {
    setBusy(true);
    setError(null);
    try {
      await startCycle();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  const onStop = async () => {
    setBusy(true);
    setError(null);
    try {
      await stopCycle();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <ConnectionIndicator connected={connected} />
      </div>

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
              onClick={() => void onStart()}
              className="px-3 py-1.5 rounded bg-green-700 hover:bg-green-600 text-sm font-medium disabled:opacity-50"
            >
              Start ster-134-prevac
            </button>
            <button
              disabled={busy || !snapshot?.cycle_running}
              onClick={() => void onStop()}
              className="px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-sm font-medium disabled:opacity-50"
            >
              Stop
            </button>
          </div>
        </div>
        {error && <p className="text-red-400 text-sm mt-2">Error: {error}</p>}
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Link href="/live" className="block">
          <Card>
            <div className="text-lg font-semibold">Live monitor →</div>
            <div className="text-slate-400 text-sm">
              Charts: pressure, temperature, F0; valve states
            </div>
          </Card>
        </Link>
        <Link href="/virtual-plc" className="block">
          <Card>
            <div className="text-lg font-semibold">Virtual PLC →</div>
            <div className="text-slate-400 text-sm">Manual valve overrides when idle</div>
          </Card>
        </Link>
      </div>
    </div>
  );
}
