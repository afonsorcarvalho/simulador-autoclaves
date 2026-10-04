export type KnobFamily = 'cycle' | 'plant' | 'controller' | 'time';

/** Categorias válidas por família, na ordem fixa de exibição na UI (lista "pertence à família"). */
export const KNOB_CATEGORIES: Record<KnobFamily, readonly string[]> = {
  cycle: ['Esterilização', 'Pré-vácuo', 'Secagem'],
  plant: [
    'Ambiente',
    'Câmara',
    'Camisa',
    'Gerador',
    'Válvulas',
    'Vácuo',
    'Portas',
    'Carga',
    'Perdas e drenos',
  ],
  controller: ['Histerese'],
  time: ['Simulação'],
};

export interface KnobMeta {
  id: string;
  family: KnobFamily;
  /** Subgrupo dentro da família (uma das KNOB_CATEGORIES[family]); organiza a UI em seções. */
  categoria: string;
  label: string;
  unit: string;
  default: number;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  options?: string[];
  optionLabels?: string[];
  timing: 'live' | 'precycle' | 'reset';
  help: string;
}

export interface KnobsResponse {
  knobs: KnobMeta[];
  values: Record<string, number>;
}

export async function getKnobs(): Promise<KnobsResponse> {
  const res = await fetch('/api/knobs');
  if (!res.ok) throw new Error(`knobs fetch failed: ${res.status}`);
  return (await res.json()) as KnobsResponse;
}

export async function setKnob(id: string, value: number): Promise<void> {
  const res = await fetch('/api/knobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, value }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? `set failed: ${res.status}`);
  }
}

export async function resetKnobs(): Promise<void> {
  const res = await fetch('/api/knobs/reset', { method: 'POST' });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
}
