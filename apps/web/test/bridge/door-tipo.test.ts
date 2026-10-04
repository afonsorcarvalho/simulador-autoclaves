import { describe, it, expect, beforeEach } from 'vitest';
import { DeltaPlcBridge } from '../../server/bridge/delta-plc.js';
import { applyDoorCommand } from '../../server/bridge/door-faults.js';
import type { ModbusTransport } from '../../server/bridge/modbus-tcp.js';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { knobById } from '../../server/knobs/registry.js';
import { POST } from '../../app/api/doors/route.js';

class FakePlc implements ModbusTransport {
  m = new Array<boolean>(100).fill(false);
  d = new Array<number>(400).fill(0);
  async readBits(a: number, n: number) {
    return this.m.slice(a - 0x800, a - 0x800 + n);
  }
  async writeBits(a: number, v: boolean[]) {
    v.forEach((x, i) => (this.m[a - 0x800 + i] = x));
  }
  async readRegs(a: number, n: number) {
    return this.d.slice(a - 0x1000, a - 0x1000 + n);
  }
  async writeRegs(a: number, v: number[]) {
    v.forEach((x, i) => (this.d[a - 0x1000 + i] = x));
  }
  close() {}
}

async function setup(tipo: 1 | 2 | 3) {
  const plc = new FakePlc();
  const b = new DeltaPlcBridge(plc, 0, undefined, null);
  await b.connect();
  b.tipo = tipo;
  return { plc, b };
}
const run = async (b: DeltaPlcBridge, s: number) => {
  for (let i = 0; i < Math.round(s / 0.1); i++) await b.sync(0.1);
};

describe('tipo de porta', () => {
  it('tipo 3: saída ABRIR do CLP move a porta (regressão); comando manual recusado', async () => {
    const { plc, b } = await setup(3);
    plc.m[53] = true;
    await run(b, 1);
    expect(b.door.C).toBeCloseTo(0.2, 5);
    expect(b.comandarPorta('C', 'fechar')).toBe(false);
    expect(applyDoorCommand(b, 'C', 'abrir').status).toBe(409);
    expect(b.doorState('C').tipo).toBe(3);
  });

  for (const tipo of [1, 2] as const) {
    it(`tipo ${tipo}: saídas do CLP não movem; abrir ~3 s com FCs; fechar assenta em 0`, async () => {
      const { plc, b } = await setup(tipo);
      plc.m[53] = true;
      plc.m[55] = true;
      await run(b, 2);
      expect(b.door).toEqual({ C: 0, D: 0 });
      plc.m[53] = plc.m[55] = false;
      expect(applyDoorCommand(b, 'C', 'abrir').status).toBe(200);
      await run(b, 1.5);
      expect(b.door.C).toBeCloseTo(0.5, 5);
      expect(plc.m[8] || plc.m[10]).toBe(false); // meio do curso: nenhum FC
      await run(b, 1.6);
      expect(b.door.C).toBe(1);
      expect(plc.m[10]).toBe(true);
      b.comandarPorta('C', 'fechar');
      await run(b, 1);
      b.comandarPorta('C', 'parar');
      await run(b, 1);
      expect(b.door.C).toBeCloseTo(2 / 3, 5);
      b.comandarPorta('C', 'fechar');
      for (let i = 0; i < 40 && !plc.m[8]; i++) await b.sync(0.13);
      expect(b.door.C).toBe(0);
      expect(plc.m[8]).toBe(true);
    });
  }

  it('obstáculo segura a porta manual', async () => {
    const { plc, b } = await setup(2);
    b.door.C = 1;
    b.setFaults('C', { obstaculo: 0.4 });
    b.comandarPorta('C', 'fechar');
    await run(b, 4);
    expect(b.door.C).toBeCloseTo(0.4, 5);
    expect(plc.m[14]).toBe(true);
  });

  it('tipo 1: guarnição estática selada com a porta fechada; vazamento derruba', async () => {
    const { plc, b } = await setup(1);
    await run(b, 0.2);
    expect(b.doorState('C').seal).toBe('selada');
    expect(plc.m[12]).toBe(true);
    b.setFaults('C', { vazamento: true });
    await run(b, 0.2);
    expect(plc.m[12]).toBe(false);
    b.setFaults('C', { vazamento: false });
    b.comandarPorta('C', 'abrir');
    await run(b, 0.5);
    expect(b.doorState('C').seal).toBe('recolhida');
  });

  it('tipo 2: guarnição segue a saída de ar do CLP', async () => {
    const { plc, b } = await setup(2);
    await run(b, 0.2);
    expect(plc.m[12]).toBe(false);
    plc.m[49] = true;
    await run(b, 2.5);
    expect(plc.m[12]).toBe(true);
  });
});

describe('knob plant.door.tipo e /api/doors', () => {
  beforeEach(() => resetRuntime());

  it('knob guarda índice, padrão tipo 3, e repassa ao bridge em tempo real', () => {
    const rt = getRuntime();
    const k = knobById('plant.door.tipo')!;
    expect(k.default).toBe(2);
    expect(k.get(rt)).toBe(2);
    const fake = { tipo: 3 };
    (rt as { bridge: unknown }).bridge = fake;
    k.set(rt, 0);
    expect(rt.doorTipo).toBe(1);
    expect(fake.tipo).toBe(1);
  });

  const req = (host: string) =>
    new Request(`http://${host}/api/doors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host },
      body: JSON.stringify({ side: 'C', acao: 'abrir' }),
    });

  it('403 remoto; 409 sem CLP real', async () => {
    expect((await POST(req('192.168.0.50:3030'))).status).toBe(403);
    expect((await POST(req('localhost:3030'))).status).toBe(409);
  });

  it('200 no tipo 2 com bridge delta', async () => {
    const { b } = await setup(2);
    (getRuntime() as { bridge: unknown }).bridge = b;
    expect((await POST(req('localhost:3030'))).status).toBe(200);
    b.tipo = 3;
    expect((await POST(req('localhost:3030'))).status).toBe(409);
  });
});
