'use client';

import { Card } from '../ui/Card';
import { fmtValor } from '../../lib/format';
import type { Snapshot } from '../../server/runtime/snapshot';
import type { DoorAcao, DoorFaults, DoorSide, DoorState, DoorTipo, SealState } from '../../server/bridge/delta-plc';

const TIPO_LABEL: Record<DoorTipo, string> = {
  1: '1 — Manual volante central',
  2: '2 — Manual guilhotina',
  3: '3 — Automática guilhotina (segue o CLP)',
};

async function comandar(side: DoorSide, acao: DoorAcao) {
  await fetch('/api/doors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ side, acao }),
  });
}

const SEAL_COLOR: Record<SealState, string> = {
  recolhida: '#64748b',
  vacuo: '#3b82f6',
  pressurizando: '#eab308',
  selada: '#22c55e',
};

function Led({ x, y, on, label, color = '#22c55e' }: { x: number; y: number; on: boolean; label: string; color?: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={5} fill={on ? color : '#1e293b'} stroke="#475569" />
      <text x={x + 9} y={y + 4} fontSize={10} fill="#cbd5e1">{label}</text>
    </g>
  );
}

/** Vista frontal: trilhos, porta (sobe = abre), pistão em cima, LEDs. */
function Frontal({ d }: { d: DoorState }) {
  const OPEN_H = 110; // curso em px
  const doorY = 140 - d.pos * OPEN_H; // topo da porta fechada em y=140
  const obst = d.faults.obstaculo;
  return (
    <svg viewBox="0 0 220 300" className="w-full h-auto">
      {/* pistão: cilindro fixo + haste até a porta */}
      <rect x={100} y={4} width={20} height={20} fill="#334155" stroke="#94a3b8" />
      <rect x={107} y={24} width={6} height={Math.max(0, doorY - 24)} fill="#cbd5e1" style={{ transition: 'height 0.25s linear' }} />
      {/* trilhos */}
      <rect x={36} y={20} width={6} height={270} fill="#475569" />
      <rect x={178} y={20} width={6} height={270} fill="#475569" />
      {/* boca da câmara */}
      <rect x={50} y={160} width={120} height={100} fill="#0f172a" stroke="#334155" />
      {/* porta */}
      <g style={{ transform: `translateY(${doorY}px)`, transition: 'transform 0.25s linear' }}>
        <rect x={44} y={0} width={132} height={130} rx={3} fill="#94a3b8" stroke={SEAL_COLOR[d.seal]} strokeWidth={4} />
      </g>
      {/* obstáculo no vão */}
      {obst !== null && (
        <rect x={95} y={270 - obst * OPEN_H} width={30} height={10} fill="#ef4444" />
      )}
      <Led x={10} y={30} on={d.fc_aberta} label="FA" />
      <Led x={10} y={150} on={d.fc_fechada} label="FF" />
      <Led x={190} y={265} on={d.antiesmaga} label="AE" color="#ef4444" />
    </svg>
  );
}

/** Corte lateral: porta, guarnição contra o flange da câmara. */
function Corte({ d }: { d: DoorState }) {
  const OPEN_H = 140; // curso maior no corte: aberta, a porta sai toda de cima da câmara
  const doorY = 140 - d.pos * OPEN_H;
  const sealX = d.seal === 'selada' || d.seal === 'pressurizando' ? 96 : d.seal === 'vacuo' ? 90 : 91;
  return (
    <svg viewBox="0 0 160 300" className="w-full h-auto">
      {/* câmara + flange */}
      <rect x={100} y={140} width={56} height={140} fill="#1e293b" stroke="#475569" />
      <rect x={98} y={140} width={6} height={140} fill="#64748b" />
      {/* porta em corte */}
      <g style={{ transform: `translateY(${doorY}px)`, transition: 'transform 0.25s linear' }}>
        <rect x={70} y={0} width={16} height={140} fill="#94a3b8" />
        <rect x={86} y={0} width={6} height={140} fill="#475569" />
      </g>
      {/* guarnição (no canal da porta, empurra contra o flange quando pressurizada);
          translateX em vez de animar `x`, que não transiciona em todos os browsers */}
      <g style={{ transform: `translateY(${doorY}px)`, transition: 'transform 0.25s linear' }}>
        <g style={{ transform: `translateX(${sealX - 4}px)`, transition: 'transform 0.3s' }}>
          <rect x={0} y={10} width={6} height={120} rx={3} fill={SEAL_COLOR[d.seal]} />
        </g>
      </g>
      <text x={4} y={296} fontSize={10} fill="#cbd5e1">guarnição: {d.seal}</text>
    </svg>
  );
}

async function setFaults(side: DoorSide, faults: Partial<DoorFaults>) {
  await fetch('/api/door-faults', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ side, faults }),
  });
}

function TriState({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  const opts: Array<[string, boolean | null]> = [['livre', null], ['0', false], ['1', true]];
  return (
    <div className="flex items-center gap-1">
      <span className="w-24">{label}</span>
      {opts.map(([t, v]) => (
        <button
          key={t}
          onClick={() => onChange(v)}
          className={`px-2 rounded border border-slate-600 ${value === v ? 'bg-slate-600' : ''}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function Faults({ side, d }: { side: DoorSide; d: DoorState }) {
  const f = d.faults;
  return (
    <div className="space-y-1 text-xs text-slate-300">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={f.obstaculo !== null} onChange={(e) => setFaults(side, { obstaculo: e.target.checked ? 0.3 : null })} />
        obstáculo
        <input
          type="range" min={0} max={1} step={0.05} disabled={f.obstaculo === null}
          // não controlado: o snapshot (atrasado) não puxa o cursor durante o arraste
          key={f.obstaculo === null ? 'off' : 'on'}
          defaultValue={f.obstaculo ?? 0.3}
          onChange={(e) => setFaults(side, { obstaculo: Number(e.target.value) })}
        />
      </label>
      <TriState label="FC aberta" value={f.fc_aberta} onChange={(v) => setFaults(side, { fc_aberta: v })} />
      <TriState label="FC fechada" value={f.fc_fechada} onChange={(v) => setFaults(side, { fc_fechada: v })} />
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={f.vazamento} onChange={(e) => setFaults(side, { vazamento: e.target.checked })} />
        guarnição com vazamento
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={f.pistao_lento} onChange={(e) => setFaults(side, { pistao_lento: e.target.checked })} />
        pistão lento
      </label>
    </div>
  );
}

export function DoorView({ snap }: { snap: Snapshot | null }) {
  if (!snap?.doors) return <Card title="Portas">Só com SIM_PLC=delta.</Card>;
  const ledFimCiclo = snap.plc_outputs?.OUT_LED_FIM_CICLO ?? false;
  return (
    <Card title="Portas">
      <div className="text-sm text-slate-200 mb-2 tabular-nums flex items-center gap-2">
        <span>
          tipo de porta: {TIPO_LABEL[snap.doors.C.tipo]} ·{' '}
          câmara: {fmtValor(snap.pressures.chamber_bar, 'bar')} · {fmtValor(snap.temperatures.chamber_C, '°C')}
        </span>
        <svg viewBox="0 0 110 14" width={110} height={14}>
          <Led x={6} y={7} on={ledFimCiclo} label="Fim de ciclo" />
        </svg>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(['C', 'D'] as const).map((s) => {
          const d = snap.doors![s];
          return (
            <div key={s} className="space-y-2">
              <div className="text-sm font-semibold text-slate-200">
                Lado {s === 'C' ? 'C (limpo)' : 'D (estéril)'} — {Math.round(d.pos * 100)}% aberta
              </div>
              <div className="grid grid-cols-[3fr_2fr] gap-2">
                <Frontal d={d} />
                <Corte d={d} />
              </div>
              <div className="flex gap-3 text-xs text-slate-400">
                <span>FC ab: {d.fc_aberta ? '1' : '0'}</span>
                <span>FC fe: {d.fc_fechada ? '1' : '0'}</span>
                <span>press. guarn: {d.press_guarn ? '1' : '0'}</span>
                <span className={d.antiesmaga ? 'text-red-400' : ''}>antiesmaga: {d.antiesmaga ? '1' : '0'}</span>
              </div>
              {d.tipo !== 3 && (
                <div className="flex items-center gap-2 text-xs">
                  {(['abrir', 'fechar', 'parar'] as const).map((a) => (
                    <button key={a} onClick={() => comandar(s, a)} className="px-2 py-0.5 rounded border border-slate-600 hover:bg-slate-700 capitalize">
                      {a}
                    </button>
                  ))}
                  {(snap.plc_phase ?? 0) !== 0 && (
                    <span className="text-amber-400">ciclo em andamento — o CLP deve manter a porta travada</span>
                  )}
                </div>
              )}
              <Faults side={s} d={d} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
