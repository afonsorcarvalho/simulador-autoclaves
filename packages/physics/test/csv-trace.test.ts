import { describe, it, expect } from 'vitest';
import { CsvTrace } from '../src/csv-trace.js';

describe('CsvTrace', () => {
  it('emits header line on first row', () => {
    const t = new CsvTrace(['t', 'p_chamber', 'T_test']);
    t.row({ t: 0, p_chamber: 1.0, T_test: 22 });
    const out = t.serialize();
    expect(out.split('\n')[0]).toBe('t,p_chamber,T_test');
  });

  it('writes rows in registration order with correct values', () => {
    const t = new CsvTrace(['t', 'a', 'b']);
    t.row({ t: 0, a: 1, b: 2 });
    t.row({ t: 1, a: 3, b: 4 });
    const out = t.serialize();
    const lines = out.split('\n');
    expect(lines[1]).toBe('0,1,2');
    expect(lines[2]).toBe('1,3,4');
  });

  it('throws if row is missing a column', () => {
    const t = new CsvTrace(['t', 'a']);
    expect(() => t.row({ t: 0 } as unknown as Record<'t' | 'a', number>)).toThrow(/missing/);
  });

  it('formats numbers with reasonable precision (no scientific by default)', () => {
    const t = new CsvTrace(['t', 'x']);
    t.row({ t: 0.001, x: 1234567.89 });
    const out = t.serialize();
    expect(out).not.toMatch(/e[+-]/i);
  });
});
