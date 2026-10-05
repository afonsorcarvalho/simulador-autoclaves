'use client';

import { Card } from '../ui/Card';
import { fmtValor } from '../../lib/format';
import type { Snapshot } from '../../server/runtime/snapshot';
import { LVL_GEN_MIN_FRAC, LVL_GEN_MAX_FRAC } from '@sim/physics';
import { VASO_TOP, VASO_H, yNivel } from '../../lib/generator-geometry';

const MANO_MAX_BAR = 8;

function estado(snap: Snapshot, heater: boolean, bomba: boolean): [string, string] {
  const g = snap.generator!;
  if (!g.lvl_min) return ['Nível baixo', 'text-red-400'];
  if (snap.pressures.generator_bar >= g.alivio_bar * 0.98) return ['Aliviando', 'text-red-400'];
  if (bomba) return ['Repondo água', 'text-sky-400'];
  if (heater) return ['Aquecendo', 'text-amber-400'];
  if (snap.pressures.generator_bar > 2) return ['Em pressão', 'text-emerald-400'];
  return ['Parado', 'text-slate-400'];
}

function Led({ x, y, on, label }: { x: number; y: number; on: boolean; label: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={5} fill={on ? '#22c55e' : '#1e293b'} stroke="#475569" />
      <text x={x + 9} y={y + 4} fontSize={10} fill="#cbd5e1">
        {label}
      </text>
    </g>
  );
}

export function GeneratorView({ snap }: { snap: Snapshot | null }) {
  if (!snap?.generator) return <Card title="Gerador de vapor">Sem gerador no modelo.</Card>;
  const g = snap.generator;
  const on = (k: string) => Boolean(snap.valves[k] ?? snap.actuators[k]);
  const heater = on('HEATER_GEN');
  const bomba = on('V_GEN_WATER_IN');
  const vapor = on('V_STEAM_IN_INT') || on('V_STEAM_IN_JACKET');
  const p = snap.pressures.generator_bar;
  const frac = p / g.alivio_bar;
  const cor = frac >= 0.95 ? '#ef4444' : frac >= 0.85 ? '#f59e0b' : '#22c55e';
  const yAgua = yNivel(g.agua_kg, g.capacidade_kg);
  const LVL_MIN_KG = g.capacidade_kg * LVL_GEN_MIN_FRAC;
  const LVL_MAX_KG = g.capacidade_kg * LVL_GEN_MAX_FRAC;
  // manômetro: 0..MANO_MAX_BAR em 240° (de -210° a +30°)
  const ang = (b: number) =>
    ((-210 + 240 * Math.min(Math.max(b / MANO_MAX_BAR, 0), 1)) * Math.PI) / 180;
  const ponto = (b: number, r: number) =>
    [270 + r * Math.cos(ang(b)), 70 + r * Math.sin(ang(b))] as const;
  const [px, py] = ponto(p, 30);
  const [ax, ay] = ponto(g.alivio_bar, 36);
  const [ax2, ay2] = ponto(g.alivio_bar, 28);
  const [txt, txtCls] = estado(snap, heater, bomba);
  return (
    <Card title="Gerador de vapor">
      <style>{`
        @keyframes gv-gira { to { transform: rotate(360deg) } }
        @keyframes gv-brilho { 50% { opacity: .45 } }
        @keyframes gv-flui { to { stroke-dashoffset: -16 } }
        @keyframes gv-sobe { from { transform: translateY(0); opacity: .8 } to { transform: translateY(-22px); opacity: 0 } }
        @keyframes gv-agita { from { transform: translate(0, 0) } to { transform: translate(var(--dx), var(--dy)) } }
      `}</style>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm tabular-nums mb-2">
        <span className="text-2xl font-semibold" style={{ color: cor }}>
          {fmtValor(p, 'bar')}
        </span>
        <span className="text-2xl font-semibold text-slate-200">
          {fmtValor(snap.temperatures.generator_C, '°C')}
        </span>
        <span className="text-slate-300">água: {fmtValor(g.agua_kg, 'kg')}</span>
        <span className={`font-semibold ${txtCls}`}>{txt}</span>
      </div>
      <svg viewBox="0 0 320 280" className="w-full h-auto max-h-80">
        {/* linha de vapor: topo do vaso até a saída */}
        <path d="M100 40 V20 H310" fill="none" stroke="#475569" strokeWidth={6} />
        {vapor && (
          <path
            d="M100 40 V20 H310"
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={3}
            strokeDasharray="4 4"
            style={{ animation: 'gv-flui .5s linear infinite' }}
          />
        )}
        <text x={310} y={14} fontSize={10} fill="#94a3b8" textAnchor="end">
          {vapor ? 'vapor → câmara/camisa' : 'linha de vapor fechada'}
        </text>
        {/* vaso */}
        <rect
          x={40}
          y={VASO_TOP}
          width={120}
          height={VASO_H}
          rx={12}
          fill="#0f172a"
          stroke="#64748b"
          strokeWidth={2}
        />
        <rect
          x={42}
          y={yAgua}
          width={116}
          height={Math.max(0, VASO_TOP + VASO_H - 2 - yAgua)}
          rx={10}
          fill="#2563eb"
          opacity={0.75}
          style={{ transition: 'y .5s linear, height .5s linear' }}
        />
        {/* bolhas quando aquece */}
        {heater &&
          [60, 95, 130].map((x, i) => (
            <circle
              key={x}
              cx={x}
              cy={yAgua + 30}
              r={3}
              fill="#bfdbfe"
              style={{ animation: `gv-sobe 1.2s ${i * 0.4}s ease-in infinite` }}
            />
          ))}
        {/* moléculas de vapor acima da água: mais numerosas e mais agitadas quanto maior a pressão */}
        {(() => {
          const espaco = yAgua - VASO_TOP - 6;
          if (espaco < 8) return null;
          const agit = Math.min(Math.max((p - 1) / Math.max(g.alivio_bar - 1, 0.1), 0), 1);
          const n = 4 + Math.round(14 * agit);
          const amp = 2 + 8 * agit; // px
          const dur = 1.8 - 1.4 * agit; // s
          return Array.from({ length: n }, (_, i) => {
            // posição pseudoaleatória fixa por índice (não pula a cada render)
            const fx = ((i * 37) % 100) / 100;
            const fy = ((i * 61 + 17) % 100) / 100;
            const ang = (i * 2.399) % (2 * Math.PI);
            return (
              <circle
                key={`m${i}`}
                cx={50 + fx * 100}
                cy={VASO_TOP + 4 + fy * espaco}
                r={1.8}
                fill="#e2e8f0"
                opacity={0.55 + 0.4 * agit}
                style={
                  {
                    '--dx': `${(Math.cos(ang) * amp).toFixed(1)}px`,
                    '--dy': `${(Math.sin(ang) * amp).toFixed(1)}px`,
                    animation: `gv-agita ${dur.toFixed(2)}s ${((i * 0.13) % dur).toFixed(2)}s ease-in-out infinite alternate`,
                  } as React.CSSProperties
                }
              />
            );
          });
        })()}
        {/* marcas de nível */}
        {(
          [
            [LVL_MAX_KG, 'MAX', g.lvl_max],
            [LVL_MIN_KG, 'MIN', g.lvl_min],
          ] as const
        ).map(([kg, l, ligado]) => (
          <g key={l}>
            <line
              x1={34}
              x2={166}
              y1={yNivel(kg, g.capacidade_kg)}
              y2={yNivel(kg, g.capacidade_kg)}
              stroke="#f59e0b"
              strokeDasharray="3 3"
            />
            <Led x={176} y={yNivel(kg, g.capacidade_kg)} on={ligado} label={`LVL ${l}`} />
          </g>
        ))}
        {/* resistência no fundo (abaixo da marca LVL MIN, com folga visível) */}
        <path
          d="M55 230 q8 -12 16 0 t16 0 t16 0 t16 0 t16 0 t16 0"
          fill="none"
          stroke={heater ? '#f97316' : '#475569'}
          strokeWidth={4}
          style={
            heater
              ? {
                  animation: 'gv-brilho .8s ease-in-out infinite',
                  filter: 'drop-shadow(0 0 4px #f97316)',
                }
              : undefined
          }
        />
        <text x={100} y={256} fontSize={10} fill="#cbd5e1" textAnchor="middle">
          resistência {heater ? 'ligada' : 'desligada'}
        </text>
        {/* bomba de reposição (esquerda, entra no fundo do vaso) */}
        <path d="M0 200 H12 M28 200 H40" stroke="#475569" strokeWidth={5} />
        {bomba && (
          <path
            d="M0 200 H40"
            stroke="#60a5fa"
            strokeWidth={3}
            strokeDasharray="4 4"
            style={{ animation: 'gv-flui .4s linear infinite' }}
          />
        )}
        <circle
          cx={20}
          cy={200}
          r={10}
          fill="#1e293b"
          stroke={bomba ? '#60a5fa' : '#475569'}
          strokeWidth={2}
        />
        <g
          style={{
            transformOrigin: '20px 200px',
            animation: bomba ? 'gv-gira .6s linear infinite' : undefined,
          }}
        >
          <path
            d="M20 192 V208 M12 200 H28"
            stroke={bomba ? '#60a5fa' : '#64748b'}
            strokeWidth={2}
          />
        </g>
        <text x={20} y={226} fontSize={10} fill="#cbd5e1" textAnchor="middle">
          bomba
        </text>
        {/* manômetro */}
        <circle cx={270} cy={70} r={38} fill="#0f172a" stroke="#64748b" strokeWidth={2} />
        <line x1={ax} y1={ay} x2={ax2} y2={ay2} stroke="#ef4444" strokeWidth={3} />
        {[0, 2, 4, 6, 8].map((b) => {
          const [x, y] = ponto(b, 22);
          return (
            <text key={b} x={x} y={y + 3} fontSize={8} fill="#94a3b8" textAnchor="middle">
              {b}
            </text>
          );
        })}
        <line x1={270} y1={70} x2={px} y2={py} stroke={cor} strokeWidth={3} strokeLinecap="round" />
        <circle cx={270} cy={70} r={3} fill="#cbd5e1" />
        <text x={270} y={100} fontSize={8} fill="#94a3b8" textAnchor="middle">
          bar abs
        </text>
        <text x={270} y={124} fontSize={10} fill="#cbd5e1" textAnchor="middle">
          alívio {fmtValor(g.alivio_bar, 'bar')}
        </text>
      </svg>
    </Card>
  );
}
