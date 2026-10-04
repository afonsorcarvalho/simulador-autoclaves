import { describe, it, expect } from 'vitest';
import { comHisterese } from '../../server/orchestrator/sensor-publisher.js';

describe('histerese dos eletrodos de nível do gerador', () => {
  it('liga só acima de limiar+H e desliga só abaixo de limiar−H', () => {
    expect(comHisterese(false, 25.2, 25, 0.3)).toBe(false); // dentro da banda: continua desligado
    expect(comHisterese(false, 25.31, 25, 0.3)).toBe(true);
    expect(comHisterese(true, 24.8, 25, 0.3)).toBe(true); // dentro da banda: continua ligado
    expect(comHisterese(true, 24.69, 25, 0.3)).toBe(false);
  });
  it('nível oscilando dentro da banda não faz o sensor bater', () => {
    let s = false;
    const trocas = [25.35, 25.1, 24.9, 25.2, 24.8, 25.1].reduce((n, m) => {
      const novo = comHisterese(s, m, 25, 0.3);
      const t = novo !== s ? n + 1 : n;
      s = novo;
      return t;
    }, 0);
    expect(trocas).toBe(1);
  });
});
