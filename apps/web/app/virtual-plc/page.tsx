'use client';

import { useSnapshot } from '../../lib/useSnapshot';
import { ConnectionIndicator } from '../../components/ConnectionIndicator';
import { ValvePanel } from '../../components/virtual-plc/ValvePanel';

export default function VirtualPlcPage() {
  const { snapshot, connected } = useSnapshot();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Virtual PLC</h1>
        <ConnectionIndicator connected={connected} />
      </div>
      <p className="text-slate-400 text-sm">
        Manual valve overrides while no cycle is running. Useful for testing individual valves and
        seeing physics response without the cycle state machine.
      </p>
      <ValvePanel snap={snapshot} disabled={snapshot?.cycle_running ?? false} />
    </div>
  );
}
