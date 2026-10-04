'use client';

import { useSnapshot } from '../../lib/useSnapshot';
import { ConnectionIndicator } from '../../components/ConnectionIndicator';
import { CycleControl } from '../../components/CycleControl';
import { PhaseHeader } from '../../components/live/PhaseHeader';
import { SpeedControl } from '../../components/live/SpeedControl';
import { PressureChart } from '../../components/live/PressureChart';
import { TemperatureChart } from '../../components/live/TemperatureChart';
import { F0Chart } from '../../components/live/F0Chart';
import { DigitalTimeline } from '../../components/live/DigitalTimeline';
import { ValveList } from '../../components/live/ValveList';
import { DoorView } from '../../components/live/DoorView';
import { CondensadoChart } from '../../components/live/CondensadoChart';
import { VaporChart } from '../../components/live/VaporChart';
import { GeneratorView } from '../../components/live/GeneratorView';

export default function LivePage() {
  const { snapshot, history, connected } = useSnapshot();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Live Monitor</h1>
        <ConnectionIndicator connected={connected} />
      </div>
      <CycleControl snapshot={snapshot} />
      <SpeedControl />
      <PhaseHeader snap={snapshot} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PressureChart history={history} snap={snapshot} />
        <TemperatureChart history={history} snap={snapshot} />
        <F0Chart history={history} />
        <CondensadoChart history={history} snap={snapshot} />
        <VaporChart history={history} snap={snapshot} />
        <ValveList snap={snapshot} />
        <GeneratorView snap={snapshot} />
        <div className="lg:col-span-2">
          <DoorView snap={snapshot} />
        </div>
        <div className="lg:col-span-2">
          <DigitalTimeline history={history} />
        </div>
      </div>
    </div>
  );
}
