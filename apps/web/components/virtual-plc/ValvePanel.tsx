'use client';

import { useState } from 'react';
import { Card } from '../ui/Card';
import { setValve } from '../../lib/api';
import type { Snapshot } from '../../server/runtime/snapshot';

const VALVE_IDS = [
  'V_STEAM_IN_INT',
  'V_STEAM_IN_JACKET',
  'V_AIR_IN',
  'V_VAC',
  'V_EXHAUST',
  'V_DRAIN_INT',
  'V_DRAIN_JACKET',
  'V_SEAL_CLEAN',
  'V_SEAL_STERILE',
  'V_GEN_WATER_IN',
  'PUMP_VAC',
  'HEATER_GEN',
];

export function ValvePanel({ snap, disabled }: { snap: Snapshot | null; disabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const toggle = async (id: string) => {
    try {
      const current = snap?.valves[id] ?? false;
      await setValve(id, !current);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card title="Manual Valve Control">
      {disabled && (
        <p className="text-yellow-400 text-sm mb-2">Disabled while a cycle is running.</p>
      )}
      {error && <p className="text-red-400 text-sm mb-2">Error: {error}</p>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {VALVE_IDS.map((id) => {
          const on = snap?.valves[id] ?? false;
          return (
            <button
              key={id}
              disabled={disabled}
              onClick={() => void toggle(id)}
              className={`px-3 py-2 rounded text-sm font-mono border transition ${
                on
                  ? 'bg-green-700 border-green-500 hover:bg-green-600'
                  : 'bg-slate-700 border-slate-600 hover:bg-slate-600'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="text-left">
                <div className="font-semibold">{id}</div>
                <div className="text-xs opacity-70">{on ? 'OPEN' : 'closed'}</div>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
