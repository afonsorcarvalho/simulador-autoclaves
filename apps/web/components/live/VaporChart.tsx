'use client';

import { Card } from '../ui/Card';
import { formatHMS, fmtValor } from '../../lib/format';
import type { Snapshot } from '../../server/runtime/snapshot';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea, Legend } from 'recharts';

const FAIXAS = ['#334155', '#1e3a5f', '#3f2d4f', '#2d4a3a', '#4a3b24', '#4a2a2a'];
const faseDe = (s: Snapshot) => (s.plc_phase !== undefined ? `fase ${s.plc_phase}` : s.cycle_phase);

/** Consumo de vapor do ciclo: acumulados câmara/camisa (kg) + vazão total (kg/h, eixo direito). */
export function VaporChart({ history, snap }: { history: Snapshot[]; snap: Snapshot | null }) {
  const data = history.map((s) => ({
    t: s.cycle_elapsed_s,
    camara: s.vapor?.injetado_camara_kg ?? 0,
    camisa: s.vapor?.injetado_camisa_kg ?? 0,
    vazao: s.vapor?.vazao_total_kg_h ?? 0,
  }));
  // ponytail: faixas iguais às do CondensadoChart; extrair helper se um 3º card precisar
  const faixas: { x1: number; x2: number; fase: string }[] = [];
  for (const s of history) {
    const f = faseDe(s);
    const last = faixas.at(-1);
    if (last && last.fase === f) last.x2 = s.cycle_elapsed_s;
    else faixas.push({ x1: last?.x2 ?? s.cycle_elapsed_s, x2: s.cycle_elapsed_s, fase: f });
  }
  const cores = new Map<string, string>();
  for (const f of faixas) if (!cores.has(f.fase)) cores.set(f.fase, FAIXAS[cores.size % FAIXAS.length]!);
  const span = (history.at(-1)?.cycle_elapsed_s ?? 0) - (history[0]?.cycle_elapsed_s ?? 0);
  const v = snap?.vapor;
  const kg = (x?: number) => fmtValor(x ?? 0, 'kg');
  const kgh = (x?: number) => fmtValor(x ?? 0, 'kg/h');
  return (
    <Card title="Consumo de vapor">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-200 mb-2 tabular-nums">
        <span>câmara: {kg(v?.injetado_camara_kg)} ({kgh(v?.vazao_camara_kg_h)})</span>
        <span>camisa: {kg(v?.injetado_camisa_kg)} ({kgh(v?.vazao_camisa_kg_h)})</span>
        <span>total: <b>{kg(v?.injetado_total_kg)}</b> ({kgh(v?.vazao_total_kg_h)})</span>
        <span>energia: {fmtValor(v?.energia_kwh ?? 0, 'kWh')}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 mb-2 tabular-nums">
        <span>exaustão: {kg(v?.exaustao_kg)}</span>
        <span>vácuo: {kg(v?.vacuo_kg)}</span>
        <span>dreno câmara: {kg(v?.dreno_kg)}</span>
        <span>dreno camisa: {kg(v?.camisa_dreno_kg)}</span>
        <span>ar admitido: {kg(v?.ar_admitido_kg)}</span>
      </div>
      <p className="text-xs text-slate-500 mb-2">
        Injetado = vapor que entrou pelas válvulas (acumulado no ciclo); vazão média 10 s. Exaustão/vácuo = vapor + ar
        retirados. Energia = entalpia do vapor injetado acima de água líquida a 25 °C.
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            {faixas.map((f, i) => (
              <ReferenceArea
                key={i}
                yAxisId="kg"
                x1={f.x1}
                x2={f.x2}
                fill={cores.get(f.fase)}
                fillOpacity={0.5}
                ifOverflow="hidden"
                {...(f.x2 - f.x1 > span * 0.06 && {
                  label: { value: f.fase, position: 'insideTopLeft', fontSize: 9, fill: '#94a3b8' },
                })}
              />
            ))}
            <XAxis dataKey="t" type="number" domain={[0, 'dataMax']} tickFormatter={formatHMS} stroke="#94a3b8" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="kg" stroke="#94a3b8" tick={{ fontSize: 10 }} unit=" kg" />
            <YAxis yAxisId="r" orientation="right" stroke="#94a3b8" tick={{ fontSize: 10 }} unit=" kg/h" />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #475569' }}
              labelFormatter={(x) => formatHMS(Number(x))}
              formatter={(x, name) => (name === 'vazão total' ? kgh(Number(x)) : kg(Number(x)))}
            />
            <Legend />
            <Line yAxisId="kg" name="câmara" type="monotone" dataKey="camara" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line yAxisId="kg" name="camisa" type="monotone" dataKey="camisa" stroke="#fb923c" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line yAxisId="r" name="vazão total" type="monotone" dataKey="vazao" stroke="#34d399" strokeDasharray="4 2" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
