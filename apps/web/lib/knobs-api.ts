export interface KnobMeta {
  id: string;
  family: 'cycle' | 'plant' | 'controller' | 'time';
  label: string;
  unit: string;
  default: number;
  min: number;
  max: number;
  step?: number;
  timing: 'live' | 'precycle';
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
