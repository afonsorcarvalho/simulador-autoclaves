'use client';

import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { getKnobs, setKnob, type KnobMeta } from '../../lib/knobs-api';

// Live sim-speed control: the `time.scale` knob, adjustable in real time while the
// (virtual) PLC runs. The scheduler reads runtime.timeScale each firing, so changes
// take effect immediately. Persists like any knob.
export function SpeedControl() {
  const [meta, setMeta] = useState<KnobMeta | null>(null);
  const [value, setValue] = useState<number>(2);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { knobs, values } = await getKnobs();
        const m = knobs.find((k) => k.id === 'time.scale') ?? null;
        setMeta(m);
        if (values['time.scale'] !== undefined) setValue(values['time.scale']);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const commit = async (v: number) => {
    setValue(v);
    try {
      await setKnob('time.scale', v);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!meta) return null;

  return (
    <Card title="Velocidade de simulação">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={meta.min}
          max={meta.max}
          step={meta.step ?? 1}
          value={value}
          onChange={(e) => void commit(Number(e.target.value))}
          className="flex-1"
        />
        <span className="font-mono text-sm w-16 text-right">
          {value}
          {meta.unit}
        </span>
      </div>
      <p className="text-slate-500 text-xs mt-1">
        ticks de simulação por firing (aplica em tempo real)
      </p>
      {error && <p className="text-red-400 text-sm mt-1">Error: {error}</p>}
    </Card>
  );
}
