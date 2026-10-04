import { describe, it, expect } from 'vitest';
import { fmtValor } from '../../lib/format';

describe('fmtValor (pt-BR)', () => {
  it('bar 3 casas, °C 1 casa, g inteiro, vírgula decimal, sem milhar', () => {
    expect(fmtValor(2.0314, 'bar')).toBe('2,031 bar');
    expect(fmtValor(134, '°C')).toBe('134,0 °C');
    expect(fmtValor(1234.4, 'g')).toBe('1234 g');
    expect(fmtValor(2.0673, 'kg')).toBe('2,07 kg');
    expect(fmtValor(21.57, 'kg/h')).toBe('22 kg/h');
    expect(fmtValor(1.8813, 'kWh')).toBe('1,88 kWh');
    expect(fmtValor(12.34, 'g/min')).toBe('12 g/min');
    expect(fmtValor(-0.0001, 'bar')).toBe('0,000 bar');
  });
});
