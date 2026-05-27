export interface CycleStatus {
  running: boolean;
  phase: string;
  elapsed_s: number;
  f0_min: number;
}

export async function startCycle(scenario = 'ster-134-prevac.yaml'): Promise<void> {
  const res = await fetch(`/api/cycle/start?scenario=${encodeURIComponent(scenario)}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? `start failed: ${res.status}`);
  }
}

export async function stopCycle(): Promise<void> {
  const res = await fetch('/api/cycle/stop', { method: 'POST' });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? `stop failed: ${res.status}`);
  }
}

export async function getStatus(): Promise<CycleStatus> {
  const res = await fetch('/api/cycle/status');
  if (!res.ok) throw new Error(`status failed: ${res.status}`);
  return (await res.json()) as CycleStatus;
}

export async function setValve(id: string, value: boolean): Promise<void> {
  const res = await fetch(`/api/valves/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error ?? `valve write failed: ${res.status}`);
  }
}
