'use client';

import { Card } from '../ui/Card';
import type { Snapshot } from '../../server/runtime/snapshot';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';

export function PressureChart({ history }: { history: Snapshot[] }) {
  const data = history.map((s) => ({
    t: s.t_s.toFixed(1),
    chamber: s.pressures.chamber_bar,
    jacket: s.pressures.jacket_bar,
    generator: s.pressures.generator_bar,
  }));
  return (
    <Card title="Pressure (bar abs)">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="t" stroke="#94a3b8" tick={{ fontSize: 10 }} />
            <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} domain={[0, 6]} />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569' }} />
            <Legend />
            <ReferenceLine y={3.04} stroke="#dc2626" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="chamber" stroke="#60a5fa" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="jacket" stroke="#fb923c" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="generator" stroke="#34d399" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
