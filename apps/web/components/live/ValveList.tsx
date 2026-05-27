'use client';

import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { Snapshot } from '../../server/runtime/snapshot';

export function ValveList({ snap }: { snap: Snapshot | null }) {
  if (!snap) return <Card title="Valves">Waiting…</Card>;
  const entries = Object.entries(snap.valves).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Card title="Valves">
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-mono">
        {entries.map(([id, on]) => (
          <li key={id} className="flex items-center justify-between">
            <span className="text-slate-300">{id}</span>
            <Badge variant={on ? 'ok' : 'neutral'}>{on ? 'OPEN' : 'closed'}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
