'use client';

import { Card } from '../ui/Card';
import { formatHMS } from '../../lib/format';
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

export function TemperatureChart({ history }: { history: Snapshot[] }) {
  const data = history.map((s) => ({
    t: s.cycle_elapsed_s,
    chamber: s.temperatures.chamber_C,
    testemunho: s.temperatures.testemunho_C,
    jacket: s.temperatures.jacket_C,
    generator: s.temperatures.generator_C,
  }));
  return (
    <Card title="Temperature (°C)">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis
              dataKey="t"
              type="number"
              domain={[0, 'dataMax']}
              tickFormatter={formatHMS}
              stroke="#94a3b8"
              tick={{ fontSize: 10 }}
            />
            <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} domain={[0, 200]} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #475569' }}
              labelFormatter={(v) => formatHMS(Number(v))}
            />
            <Legend />
            <ReferenceLine y={134} stroke="#dc2626" strokeDasharray="3 3" />
            <Line
              type="monotone"
              dataKey="chamber"
              stroke="#60a5fa"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="testemunho"
              stroke="#facc15"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="jacket"
              stroke="#fb923c"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="generator"
              stroke="#34d399"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
