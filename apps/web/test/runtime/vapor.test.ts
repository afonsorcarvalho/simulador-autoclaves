import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { CycleConfigSchema } from '../../server/virtual-plc/cycle-config.js';

const CYCLE = CycleConfigSchema.parse(
  yaml.load(readFileSync(resolve(__dirname, '../../server/scenarios/ster-134-prevac.yaml'), 'utf8')),
);

describe('consumo de vapor no runtime', () => {
  beforeEach(() => resetRuntime());

  it('ciclo padrão: acumula números plausíveis e zera no início do próximo', async () => {
    const r = getRuntime();
    r.startCycle(CYCLE);
    let n = 0;
    let fase = '';
    let maxVazao = 0;
    while (fase !== 'COMPLETE' && n++ < 100_000) {
      await r.tick();
      fase = r.publisher.latest!.cycle_phase;
      maxVazao = Math.max(maxVazao, r.vapor.vazao_total_kg_h);
    }
    expect(fase).toBe('COMPLETE');
    const v = r.publisher.latest!.vapor!;
    // eslint-disable-next-line no-console
    console.log('vapor ciclo padrão:', { ...v, maxVazao, t: r.publisher.latest!.cycle_elapsed_s });
    expect(v.injetado_total_kg).toBeCloseTo(v.injetado_camara_kg + v.injetado_camisa_kg, 9);
    // 500 L + 25 kg de carga: alguns kg de vapor por ciclo
    expect(v.injetado_camara_kg).toBeGreaterThan(0.5);
    expect(v.injetado_camara_kg).toBeLessThan(20);
    expect(v.vacuo_kg).toBeGreaterThan(0);
    expect(v.exaustao_kg).toBeGreaterThan(0);
    // ~2,6–2,9 MJ/kg: kWh ≈ 0,7–0,8 × kg
    expect(v.energia_kwh / v.injetado_total_kg).toBeGreaterThan(0.7);
    expect(v.energia_kwh / v.injetado_total_kg).toBeLessThan(0.85);
    expect(maxVazao).toBeGreaterThan(1);

    r.startCycle(CYCLE);
    expect(Object.values(r.vapor).every((x) => x === 0)).toBe(true);
  }, 300_000);
});
