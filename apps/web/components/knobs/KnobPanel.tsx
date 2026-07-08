'use client';

import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { getKnobs, setKnob, resetKnobs, type KnobMeta } from '../../lib/knobs-api';

const FAMILY_LABEL: Record<KnobMeta['family'], string> = {
  cycle: 'Ciclo',
  plant: 'Planta física',
  controller: 'Controlador (referência)',
  time: 'Tempo',
};
const FAMILY_ORDER: KnobMeta['family'][] = ['cycle', 'plant', 'controller', 'time'];

export function KnobPanel({ cycleRunning }: { cycleRunning: boolean }) {
  const [knobs, setKnobs] = useState<KnobMeta[]>([]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const { knobs, values } = await getKnobs();
      setKnobs(knobs);
      setValues(values);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const commit = async (id: string, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    try {
      await setKnob(id, value);
      setValues((v) => ({ ...v, [id]: value }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      void load(); // reverte para o valor do servidor
    }
  };

  const reset = async () => {
    try {
      await resetKnobs();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      {error && <p className="text-red-400 text-sm">Error: {error}</p>}
      {FAMILY_ORDER.map((fam) => {
        const items = knobs.filter((k) => k.family === fam);
        if (items.length === 0) return null;
        const disabled = fam === 'cycle' && cycleRunning;
        return (
          <Card key={fam} title={FAMILY_LABEL[fam]}>
            {disabled && (
              <p className="text-yellow-400 text-sm mb-2">Desativado enquanto um ciclo corre.</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map((k) => (
                <label key={k.id} className="flex flex-col gap-1 text-sm">
                  <span className="opacity-80">
                    {k.label} {k.unit && <span className="opacity-50">({k.unit})</span>}
                  </span>
                  <input
                    type="number"
                    disabled={disabled}
                    defaultValue={values[k.id]}
                    key={`${k.id}:${values[k.id]}`}
                    min={k.min}
                    max={k.max}
                    step={k.step ?? 'any'}
                    onBlur={(e) => void commit(k.id, e.target.value)}
                    // Enter must save too — blur alone silently drops a typed change,
                    // so the shown value diverges from what the next cycle actually uses.
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    className="bg-slate-700 border border-slate-600 rounded px-2 py-1 font-mono disabled:opacity-50"
                  />
                </label>
              ))}
            </div>
          </Card>
        );
      })}
      <button
        onClick={() => void reset()}
        className="px-3 py-2 rounded text-sm bg-slate-700 border border-slate-600 hover:bg-slate-600"
      >
        Repor defaults
      </button>
    </div>
  );
}
