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

export function F0Chart({ history }: { history: Snapshot[] }) {
  const data = history.map((s) => ({ t: s.t_s.toFixed(1), F0: s.f0_min }));
  return (
    <Card title="F0 accumulated (min, log scale)">
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="t" stroke="#94a3b8" tick={{ fontSize: 10 }} />
            <YAxis
              stroke="#94a3b8"
              tick={{ fontSize: 10 }}
              scale="log"
              domain={[0.01, 'auto']}
              allowDataOverflow
            />
            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #475569' }} />
            <Legend />
            <ReferenceLine y={100} stroke="#dc2626" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="F0" stroke="#c084fc" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
