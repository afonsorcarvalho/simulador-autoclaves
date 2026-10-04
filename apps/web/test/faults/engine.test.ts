import { describe, it, expect } from 'vitest';
import { FaultEngine } from '../../server/faults/engine.js';

describe('FaultEngine', () => {
  it('analog: open, force, offset, freeze, clear', () => {
    const f = new FaultEngine();
    const raw = [100, 200, 300];
    expect(f.applyAnalog('temp', raw)).toEqual([100, 200, 300]);
    f.set({ id: 'a', tipo: 'analog.open', alvo: 'temp:1', valor: 32767 });
    expect(f.applyAnalog('temp', raw)).toEqual([100, 32767, 300]);
    f.set({ id: 'b', tipo: 'analog.offset', alvo: 'temp:2', valor: -150 });
    expect(f.applyAnalog('temp', raw)).toEqual([100, 32767, 150]);
    f.clear('a');
    f.set({ id: 'c', tipo: 'analog.freeze', alvo: 'temp:0' });
    expect(f.applyAnalog('temp', [111, 200, 300])[0]).toBe(111);
    expect(f.applyAnalog('temp', [555, 200, 300])[0]).toBe(111); // congelado no 1º valor visto
    f.clearAll();
    expect(f.applyAnalog('temp', raw)).toEqual(raw);
  });
  it('digital.force sobrescreve entrada por nome', () => {
    const f = new FaultEngine();
    f.set({ id: 'x', tipo: 'digital.force', alvo: 'IN_A', valor: 0 });
    expect(f.applyDigital({ IN_A: true, IN_B: true })).toEqual({ IN_A: false, IN_B: true });
  });
  it('valve.stuck força válvula da física', () => {
    const f = new FaultEngine();
    f.set({ id: 'v', tipo: 'valve.stuck', alvo: 'V_X', valor: 1 });
    expect(f.applyValves({ V_X: false, V_Y: true })).toEqual({ V_X: true, V_Y: true });
  });
  it('rejeita tipo/alvo inválido', () => {
    const f = new FaultEngine();
    expect(() => f.set({ id: 'z', tipo: 'analog.open', alvo: 'temp' } as never)).toThrow();
  });
  it('clear de outra falha no mesmo alvo não descongela o freeze', () => {
    const f = new FaultEngine();
    f.set({ id: 'freeze', tipo: 'analog.freeze', alvo: 'temp:1' });
    expect(f.applyAnalog('temp', [100, 200, 300])[1]).toBe(200); // congela em 200
    f.set({ id: 'offset', tipo: 'analog.offset', alvo: 'temp:1', valor: 10 });
    f.clear('offset');
    expect(f.applyAnalog('temp', [100, 999, 300])[1]).toBe(200); // freeze mantém o valor
  });
});
