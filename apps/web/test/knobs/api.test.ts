import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resetRuntime } from '../../server/runtime/singleton.js';
import { defaultOverridePath } from '../../server/knobs/store.js';
import { GET, POST } from '../../app/api/knobs/route.js';
import { POST as RESET } from '../../app/api/knobs/reset/route.js';

const FILE = defaultOverridePath();

function req(body: unknown): Request {
  return new Request('http://x/api/knobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('knobs API', () => {
  beforeEach(() => {
    resetRuntime();
    if (existsSync(FILE)) rmSync(FILE);
  });
  afterEach(() => {
    if (existsSync(FILE)) rmSync(FILE);
  });

  it('GET returns knob metadata + current values', async () => {
    const res = await GET();
    const body = (await res.json()) as {
      knobs: { id: string }[];
      values: Record<string, number>;
    };
    expect(body.knobs.length).toBeGreaterThan(5);
    expect(body.values['time.scale']).toBe(2);
    // metadata must not leak functions
    expect((body.knobs[0] as Record<string, unknown>).get).toBeUndefined();
  });

  it('POST valid knob applies + persists', async () => {
    const res = await POST(req({ id: 'time.scale', value: 9 }));
    expect(res.status).toBe(200);
    expect(existsSync(FILE)).toBe(true);
  });

  it('POST out-of-range → 400', async () => {
    const res = await POST(req({ id: 'time.scale', value: 999 }));
    expect(res.status).toBe(400);
  });

  it('POST precycle knob while cycle running → 409', async () => {
    const { getRuntime } = await import('../../server/runtime/singleton.js');
    getRuntime().cycle_running = true;
    const res = await POST(req({ id: 'cycle.hold_duration', value: 600 }));
    expect(res.status).toBe(409);
  });

  it('reset returns 200 and removes file', async () => {
    await POST(req({ id: 'time.scale', value: 9 }));
    const res = await RESET();
    expect(res.status).toBe(200);
    expect(existsSync(FILE)).toBe(false);
  });
});
