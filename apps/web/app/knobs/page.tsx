'use client';

import { useSnapshot } from '../../lib/useSnapshot';
import { ConnectionIndicator } from '../../components/ConnectionIndicator';
import { KnobPanel } from '../../components/knobs/KnobPanel';

export default function KnobsPage() {
  const { snapshot, connected } = useSnapshot();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Knobs</h1>
        <ConnectionIndicator connected={connected} />
      </div>
      <p className="text-slate-400 text-sm">
        Parâmetros do emulador. Planta, controlador e tempo aplicam live; os de ciclo só com o ciclo
        parado (semeiam o PLC ao arrancar). Persistem em disco.
      </p>
      <KnobPanel cycleRunning={snapshot?.cycle_running ?? false} />
    </div>
  );
}
