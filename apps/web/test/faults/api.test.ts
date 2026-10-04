import { describe, it, expect, beforeEach } from 'vitest';
import { resetRuntime, getRuntime } from '../../server/runtime/singleton.js';
import { GET, POST } from '../../app/api/faults/route.js';

function req(body: unknown): Request {
  return new Request('http://localhost/api/faults', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/faults', () => {
  beforeEach(() => {
    resetRuntime();
  });

  it('GET lista as falhas ativas', async () => {
    const res = await GET(new Request('http://localhost/api/faults'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { faults: unknown[] };
    expect(body.faults).toEqual([]);
  });

  it('POST set injeta a falha; GET/list reflete', async () => {
    const res = await POST(
      req({ action: 'set', fault: { id: 's', tipo: 'digital.force', alvo: 'IN_EMERG_OK', valor: 0 } }),
    );
    expect(res.status).toBe(200);
    expect(getRuntime().faults.list()).toHaveLength(1);
  });

  it('clearAll esvazia', async () => {
    await POST(
      req({ action: 'set', fault: { id: 's', tipo: 'digital.force', alvo: 'IN_EMERG_OK', valor: 0 } }),
    );
    const res = await POST(req({ action: 'clearAll' }));
    expect(res.status).toBe(200);
    expect(getRuntime().faults.list()).toHaveLength(0);
  });

  it('corpo inválido → 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/faults', { method: 'POST', body: '{not json' }),
    );
    expect(res.status).toBe(400);
  });

  it('tipo desconhecido → 400', async () => {
    const res = await POST(
      req({ action: 'set', fault: { id: 's', tipo: 'nope', alvo: 'x' } }),
    );
    expect(res.status).toBe(400);
    expect(getRuntime().faults.list()).toHaveLength(0);
  });

  it('action inválida → 400', async () => {
    const res = await POST(req({ action: 'nope' }));
    expect(res.status).toBe(400);
  });

  it('power.cut sem SIM_POWER_CUT_BIT configurado → 409', async () => {
    const res = await POST(req({ action: 'set', fault: { id: 'pw', tipo: 'power.cut', alvo: '' } }));
    expect(res.status).toBe(409);
    expect(getRuntime().faults.list()).toHaveLength(0);
  });

  it('action door em modo virtual (sem CLP real) → 409', async () => {
    const res = await POST(
      req({ action: 'door', side: 'C', faults: { vazamento: true } }),
    );
    expect(res.status).toBe(409);
  });

  it('id vazio → 400', async () => {
    const res = await POST(
      req({ action: 'set', fault: { id: '', tipo: 'digital.force', alvo: 'IN_EMERG_OK', valor: 0 } }),
    );
    expect(res.status).toBe(400);
    expect(getRuntime().faults.list()).toHaveLength(0);
  });

  it('valor não finito (Infinity, via literal 1e400 que o JSON.parse estoura) → 400', async () => {
    // JSON.stringify(Infinity) vira null, então o literal numérico precisa ir cru no body.
    const res = await POST(
      new Request('http://localhost/api/faults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"action":"set","fault":{"id":"s","tipo":"digital.force","alvo":"IN_EMERG_OK","valor":1e400}}',
      }),
    );
    expect(res.status).toBe(400);
    expect(getRuntime().faults.list()).toHaveLength(0);
  });

  it('digital.force com alvo fora de PLC_INPUTS → 400', async () => {
    const res = await POST(
      req({ action: 'set', fault: { id: 's', tipo: 'digital.force', alvo: 'NAO_EXISTE', valor: 0 } }),
    );
    expect(res.status).toBe(400);
    expect(getRuntime().faults.list()).toHaveLength(0);
  });

  it('utility.off só aceita alvo steam_line', async () => {
    const ok = await POST(
      req({ action: 'set', fault: { id: 's', tipo: 'utility.off', alvo: 'steam_line' } }),
    );
    expect(ok.status).toBe(200);
    const bad = await POST(
      req({ action: 'set', fault: { id: 's2', tipo: 'utility.off', alvo: 'outra_coisa' } }),
    );
    expect(bad.status).toBe(400);
    expect(getRuntime().faults.list()).toHaveLength(1);
  });
});
