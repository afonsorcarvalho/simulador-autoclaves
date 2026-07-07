'use client';

import Link from 'next/link';
import { useSnapshot } from '../lib/useSnapshot';
import { Card } from '../components/ui/Card';
import { ConnectionIndicator } from '../components/ConnectionIndicator';
import { CycleControl } from '../components/CycleControl';

export default function Home() {
  const { snapshot, connected } = useSnapshot();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <ConnectionIndicator connected={connected} />
      </div>

      <CycleControl snapshot={snapshot} />

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
