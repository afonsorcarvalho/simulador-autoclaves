'use client';

import { useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { formatHMS } from '../../lib/format';
import {
  buildLanes,
  segments,
  PLC_PHASES,
  type Lane,
  type Segment,
} from '../../lib/digitalTimeline';
import type { Snapshot } from '../../server/runtime/snapshot';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from 'recharts';

const LANE_PX = 22;
const PHASE_COLORS = [
  '#475569',
  '#64748b',
  '#a855f7',
  '#6366f1',
  '#f97316',
  '#eab308',
  '#dc2626',
  '#0ea5e9',
  '#14b8a6',
  '#22c55e',
  '#16a34a',
  '#991b1b',
];

/** Linha do tempo digital: uma faixa on/off por válvula/atuador, mesmo eixo X dos gráficos analógicos. */
export function DigitalTimeline({ history }: { history: Snapshot[] }) {
  const [showAll, setShowAll] = useState(false);
  const n = history.length; // history é mutado no lugar pelo useSnapshot: o tamanho é a dependência
  const lanes = useMemo(() => buildLanes(history, showAll), [history, n, showAll]);
  const phases = useMemo(
    () =>
      history.some((s) => s.plc_phase !== undefined)
        ? segments(history, (s) => s.plc_phase ?? 0)
        : [],
    [history, n],
  );
  const tMax = history[n - 1]?.cycle_elapsed_s ?? 0;
  // Pontos só para o tooltip: no máx. ~600, independe do tamanho do histórico.
  const data = useMemo(() => {
    const step = Math.max(1, Math.ceil(n / 600));
    return history.filter((_, i) => i % step === 0).map((s) => ({ t: s.cycle_elapsed_s, y: 0 }));
  }, [history, n]);

  const phaseRow = phases.length ? 1 : 0;
  const rows = lanes.length + phaseRow;
  // Faixa i ocupa y ∈ [rows-1-i, rows-i): a primeira fica no topo.
  const yOf = (i: number) => rows - 1 - i;
  const ticks = lanes.map((_, i) => yOf(i + phaseRow) + 0.5);
  const labelAt = new Map(ticks.map((y, i) => [y, lanes[i]!.signal.label]));

  return (
    <Card title="Válvulas e atuadores (digital)">
      <label className="flex items-center gap-2 text-xs text-slate-400 mb-1">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        mostrar todas
      </label>
      <div style={{ height: rows * LANE_PX + 40 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <XAxis
              dataKey="t"
              type="number"
              domain={[0, tMax]}
              tickFormatter={formatHMS}
              stroke="#94a3b8"
              tick={{ fontSize: 10 }}
            />
            <YAxis
              type="number"
              domain={[0, rows]}
              ticks={ticks}
              tickFormatter={(y: number) => labelAt.get(y) ?? ''}
              interval={0}
              width={140}
              stroke="#94a3b8"
              tick={{ fontSize: 10 }}
            />
            {phases.map((p) => (
              <ReferenceArea
                key={`f${p.from}`}
                x1={p.from}
                x2={p.to}
                y1={yOf(0)}
                y2={yOf(0) + 0.9}
                fill={PHASE_COLORS[p.v] ?? '#475569'}
                fillOpacity={0.8}
                ifOverflow="hidden"
                label={{ value: PLC_PHASES[p.v] ?? `FASE ${p.v}`, fontSize: 9, fill: '#f8fafc' }}
              />
            ))}
            {lanes.flatMap((lane, i) =>
              lane.on.map((g) => (
                <ReferenceArea
                  key={`${lane.signal.id}${g.from}`}
                  x1={g.from}
                  x2={g.to}
                  y1={yOf(i + phaseRow) + 0.1}
                  y2={yOf(i + phaseRow) + 0.8}
                  fill="#34d399"
                  fillOpacity={0.85}
                  ifOverflow="hidden"
                />
              )),
            )}
            <Line
              dataKey="y"
              stroke="none"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
            <Tooltip
              content={({ label }) =>
                label === undefined ? null : (
                  <TimelineTip t={Number(label)} lanes={lanes} phases={phases} />
                )
              }
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function TimelineTip({
  t,
  lanes,
  phases,
}: {
  t: number;
  lanes: Lane[];
  phases: Segment<number>[];
}) {
  const at = (g: { from: number; to: number }) => t >= g.from && t <= g.to;
  const phase = phases.find(at);
  const on = lanes.filter((l) => l.on.some(at));
  return (
    <div className="rounded border border-slate-600 bg-slate-800 p-2 text-xs">
      <div className="font-mono">{formatHMS(t)}</div>
      {phase && <div className="text-slate-300">Fase: {PLC_PHASES[phase.v] ?? phase.v}</div>}
      {on.length ? (
        on.map((l) => (
          <div key={l.signal.id} className="text-emerald-400">
            {l.signal.label}
          </div>
        ))
      ) : (
        <div className="text-slate-400">tudo desligado</div>
      )}
    </div>
  );
}
