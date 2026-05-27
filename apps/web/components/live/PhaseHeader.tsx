'use client';

import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { fmtSeconds, fmtMinutes } from '../../lib/format';
import type { Snapshot } from '../../server/runtime/snapshot';

export function PhaseHeader({ snap }: { snap: Snapshot | null }) {
  if (!snap) return <Card title="Phase">Waiting for snapshot…</Card>;
  return (
    <Card title="Phase">
      <div className="flex items-center gap-4">
        <span className="text-2xl font-bold tracking-wide">{snap.cycle_phase}</span>
        <Badge variant={snap.cycle_running ? 'ok' : 'neutral'}>
          {snap.cycle_running ? 'running' : 'idle'}
        </Badge>
        <span className="text-slate-400">elapsed: {fmtSeconds(snap.cycle_elapsed_s)}</span>
        <span className="text-slate-400">F0: {fmtMinutes(snap.f0_min)}</span>
      </div>
    </Card>
  );
}
