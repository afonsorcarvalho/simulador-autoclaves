'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { HelpTip } from '../ui/HelpTip';
import {
  getKnobs,
  setKnob,
  resetKnobs,
  KNOB_CATEGORIES,
  type KnobMeta,
} from '../../lib/knobs-api';

const FAMILY_LABEL: Record<KnobMeta['family'], string> = {
  cycle: 'Ciclo',
  plant: 'Planta física',
  controller: 'Controlador (referência)',
  time: 'Tempo',
};
const FAMILY_ORDER: KnobMeta['family'][] = ['cycle', 'plant', 'controller', 'time'];

const SECTIONS_STORAGE_KEY = 'knobs.sections.collapsed.v1';

/** Remove acentos e normaliza caixa, pra busca "sem acento/maiúscula". */
const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Diferente do padrão (com folga pra ponto flutuante — ex.: diâmetros convertidos de Cv). */
const isChanged = (k: KnobMeta, v: number | undefined): boolean =>
  v !== undefined && Math.abs(v - k.default) > Math.max(1e-9, Math.abs(k.default) * 1e-9);

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SECTIONS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveCollapsed(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage indisponível (privado/bloqueado) — colapso simplesmente não persiste.
  }
}

export function KnobPanel({ cycleRunning }: { cycleRunning: boolean }) {
  const [knobs, setKnobs] = useState<KnobMeta[]>([]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsed(loadCollapsed());
  }, []);

  const toggleSection = (key: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveCollapsed(next);
      return next;
    });
  };

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

  /** Valor exibido: arredondado em `decimals` (o servidor guarda a precisão total). */
  const shown = (k: KnobMeta) => {
    const v = values[k.id];
    return v === undefined || k.decimals === undefined ? v : Number(v.toFixed(k.decimals));
  };

  const commit = async (k: KnobMeta, raw: string) => {
    const id = k.id;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    // Sem mudança: não regrava o valor arredondado por cima do valor exato (ex.: Cv padrão).
    if (value === shown(k)) return;
    try {
      await setKnob(id, value);
      setValues((v) => ({ ...v, [id]: value }));
      setError(null);
      setSaved(id);
      setTimeout(() => setSaved((s) => (s === id ? null : s)), 1500);
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

  const q = normalize(query.trim());
  const matches = (k: KnobMeta): boolean => {
    if (onlyChanged && !isChanged(k, values[k.id])) return false;
    if (!q) return true;
    return (
      normalize(k.label).includes(q) ||
      normalize(k.id).includes(q) ||
      normalize(k.help).includes(q) ||
      normalize(k.unit).includes(q)
    );
  };

  const anyResult = useMemo(() => knobs.some(matches), [knobs, values, query, onlyChanged]);

  return (
    <div className="space-y-4">
      {error && <p className="text-red-400 text-sm">Error: {error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome, id, unidade ou ajuda…"
          aria-label="Buscar knob"
          className="flex-1 min-w-[12rem] bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => setOnlyChanged((v) => !v)}
          aria-pressed={onlyChanged}
          className={`px-3 py-2 rounded text-sm border ${
            onlyChanged
              ? 'bg-sky-700 border-sky-500 text-white'
              : 'bg-slate-700 border-slate-600 hover:bg-slate-600'
          }`}
        >
          Só alterados
        </button>
      </div>

      {!anyResult && <p className="text-slate-400 text-sm">Nenhum knob encontrado.</p>}

      {FAMILY_ORDER.map((fam) => {
        const famItems = knobs.filter((k) => k.family === fam);
        if (famItems.length === 0) return null;
        const famVisible = famItems.filter(matches);
        if (famVisible.length === 0) return null;
        const familyDisabled = fam === 'cycle' && cycleRunning;
        const categories = KNOB_CATEGORIES[fam].filter((c) => famItems.some((k) => k.categoria === c));

        return (
          <Card key={fam} title={FAMILY_LABEL[fam]}>
            {familyDisabled && (
              <p className="text-yellow-400 text-sm mb-2">Desativado enquanto um ciclo corre.</p>
            )}
            <div className="space-y-3">
              {categories.map((cat) => {
                const items = famItems.filter((k) => k.categoria === cat);
                const visible = items.filter(matches);
                if (visible.length === 0) return null;
                const sectionKey = `${fam}:${cat}`;
                const forcedOpen = q.length > 0; // busca abre a seção com resultado
                const isCollapsed = !forcedOpen && !!collapsed[sectionKey];
                const changedCount = items.filter((k) => isChanged(k, values[k.id])).length;

                return (
                  <div key={cat} className="border border-slate-700 rounded">
                    <button
                      type="button"
                      onClick={() => toggleSection(sectionKey)}
                      aria-expanded={!isCollapsed}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium bg-slate-800/40 hover:bg-slate-700/60 rounded"
                    >
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="opacity-60">
                          {isCollapsed ? '▸' : '▾'}
                        </span>
                        {cat}
                        <span className="opacity-50 text-xs">({items.length})</span>
                        {changedCount > 0 && (
                          <span className="text-sky-400 text-xs">
                            {changedCount} {changedCount === 1 ? 'alterado' : 'alterados'}
                          </span>
                        )}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3">
                        {visible.map((k) => {
                          const disabled = familyDisabled || (k.timing === 'reset' && cycleRunning);
                          const changed = isChanged(k, values[k.id]);
                          return (
                            <div key={k.id} className="flex flex-col gap-1 text-sm">
                              <span className="opacity-80 flex items-center">
                                {changed && (
                                  <span
                                    aria-label="valor alterado do padrão"
                                    title="Diferente do padrão"
                                    className="mr-1 w-1.5 h-1.5 rounded-full bg-sky-400 inline-block"
                                  />
                                )}
                                <label htmlFor={`knob-${k.id}`}>
                                  {k.label} {k.unit && <span className="opacity-50">({k.unit})</span>}
                                </label>
                                <HelpTip text={k.help} label={k.label} />
                                {k.timing === 'reset' && (
                                  <span className="opacity-50 ml-1 text-xs">
                                    · máquina parada, reseta planta
                                  </span>
                                )}
                                {saved === k.id && (
                                  <span className="text-green-400 ml-1">✓ guardado</span>
                                )}
                              </span>
                              {k.options ? (
                                <select
                                  id={`knob-${k.id}`}
                                  disabled={disabled}
                                  value={values[k.id] ?? k.default}
                                  onChange={(e) => void commit(k, e.target.value)}
                                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1 font-mono disabled:opacity-50"
                                >
                                  {k.options.map((o, i) => (
                                    <option key={o} value={i}>
                                      {k.optionLabels?.[i] ?? o}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  id={`knob-${k.id}`}
                                  type="number"
                                  disabled={disabled}
                                  defaultValue={shown(k)}
                                  key={`${k.id}:${values[k.id]}`}
                                  min={k.min}
                                  max={k.max}
                                  step={k.step ?? 'any'}
                                  onBlur={(e) => void commit(k, e.target.value)}
                                  // Enter must save too — blur alone silently drops a typed change,
                                  // so the shown value diverges from what the next cycle actually uses.
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.currentTarget.blur();
                                  }}
                                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1 font-mono disabled:opacity-50"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
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
