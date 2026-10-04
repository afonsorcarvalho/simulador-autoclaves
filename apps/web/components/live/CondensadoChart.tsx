'use client';

import { Card } from '../ui/Card';
import { formatHMS, fmtValor } from '../../lib/format';
import type { Snapshot } from '../../server/runtime/snapshot';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  Legend,
} from 'recharts';

const FAIXAS = ['#334155', '#1e3a5f', '#3f2d4f', '#2d4a3a', '#4a3b24', '#4a2a2a'];

/** Fase do ponto: a do CLP real se houver, senão a do CLP virtual. */
const faseDe = (s: Snapshot) => (s.plc_phase !== undefined ? `fase ${s.plc_phase}` : s.cycle_phase);

export function CondensadoChart({ history, snap }: { history: Snapshot[]; snap: Snapshot | null }) {
  const data = history.map((s) => ({
    t: s.cycle_elapsed_s,
    agua: s.condensado?.agua_carga_g ?? 0,
    fundo: s.condensado?.agua_camara_g ?? 0,
    cond: s.condensado?.cond_acum_g ?? 0,
    evap: s.condensado?.evap_acum_g ?? 0,
    vazao: s.condensado?.vazao_g_min ?? 0,
  }));
  // Faixas contíguas por fase.
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
  const c = snap?.condensado;
  const fim = snap && !snap.cycle_running && history.length > 0;
  const vz = c?.vazao_g_min ?? 0;
  const vazaoTxt = (vz >= 0.5 ? '+' : '') + fmtValor(vz, 'g/min');
  return (
    <Card title="Condensado e umidade">
      {fim && (
        <div className="text-base text-sky-300 mb-1 tabular-nums">
          Água na carga no fim: <b>{fmtValor(c?.agua_carga_g ?? 0, 'g')}</b>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-200 mb-2 tabular-nums">
        <span>água na carga: {fmtValor(c?.agua_carga_g ?? 0, 'g')}</span>
        <span>fundo da câmara: {fmtValor(c?.agua_camara_g ?? 0, 'g')}</span>
        <span>condensado: {fmtValor(c?.cond_acum_g ?? 0, 'g')}</span>
        <span>evaporado: {fmtValor(c?.evap_acum_g ?? 0, 'g')}</span>
        <span>vazão: {vazaoTxt}</span>
        {snap && <span>carga (testemunho): {fmtValor(snap.temperatures.testemunho_C, '°C')}</span>}
      </div>
      <ul className="text-xs text-slate-500 mb-2">
        <li><span className="text-sky-400">água na carga</span>: água retida no material agora (sobe no aquecimento, cai no vácuo/secagem).</li>
        <li><span className="text-orange-400">fundo da câmara</span>: líquido acumulado no fundo, ainda não drenado.</li>
        <li><span className="text-slate-300">condensado / evaporado</span>: total que condensou / evaporou no ciclo (carga + parede).</li>
        <li><span className="text-emerald-400">vazão</span>: condensação − evaporação (g/min, média 10 s); positiva condensa, negativa evapora.</li>
      </ul>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            {faixas.map((f, i) => (
              <ReferenceArea
                key={i}
                yAxisId="g"
                x1={f.x1}
                x2={f.x2}
                fill={cores.get(f.fase)}
                fillOpacity={0.5}
                ifOverflow="hidden"
                // rótulo só em faixa larga, senão as fases curtas (pulsos) se sobrepõem
                {...(f.x2 - f.x1 > span * 0.06 && {
                  label: { value: f.fase, position: 'insideTopLeft', fontSize: 9, fill: '#94a3b8' },
                })}
              />
            ))}
            <XAxis
              dataKey="t"
              type="number"
              domain={[0, 'dataMax']}
              tickFormatter={formatHMS}
              stroke="#94a3b8"
              tick={{ fontSize: 10 }}
            />
            <YAxis yAxisId="g" stroke="#94a3b8" tick={{ fontSize: 10 }} unit=" g" />
            <YAxis yAxisId="r" orientation="right" stroke="#94a3b8" tick={{ fontSize: 10 }} unit=" g/min" />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #475569' }}
              labelFormatter={(v) => formatHMS(Number(v))}
              formatter={(v, name) => fmtValor(Number(v), name === 'vazão' ? 'g/min' : 'g')}
            />
            <Legend />
            <ReferenceLine yAxisId="r" y={0} stroke="#34d399" strokeOpacity={0.6} />
            <Line yAxisId="g" name="água na carga" type="monotone" dataKey="agua" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line yAxisId="g" name="fundo da câmara" type="monotone" dataKey="fundo" stroke="#fb923c" dot={false} isAnimationActive={false} />
            <Line yAxisId="g" name="condensado" type="monotone" dataKey="cond" stroke="#cbd5e1" dot={false} isAnimationActive={false} />
            <Line yAxisId="g" name="evaporado" type="monotone" dataKey="evap" stroke="#a78bfa" dot={false} isAnimationActive={false} />
            <Line yAxisId="r" name="vazão" type="monotone" dataKey="vazao" stroke="#34d399" strokeDasharray="4 2" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
