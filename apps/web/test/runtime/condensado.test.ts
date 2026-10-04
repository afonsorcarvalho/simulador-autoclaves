import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import type { CycleConfig } from '../../server/virtual-plc/cycle-config.js';

const CYCLE: CycleConfig = {
  name: 'test',
  sterilization_T_C: 134,
  sterilization_P_bar: 3.04,
  hold_duration_s: 60,
  prevac_pulses: 0,
  prevac_vacuum_target_bar: 0.2,
  prevac_steam_target_bar: 2,
  preheat_duration_s: 10,
  dry_duration_s: 60,
  f0_target_min: 1,
};

const ZERO = {
  agua_carga_g: 0,
  agua_camara_g: 0,
  cond_acum_g: 0,
  evap_acum_g: 0,
  cond_carga_acum_g: 0,
  cond_parede_acum_g: 0,
  dreno_acum_g: 0,
  vazao_g_min: 0,
};

describe('condensado no runtime', () => {
  beforeEach(() => resetRuntime());

  it('aquecimento molha a carga, secagem com vácuo seca (vazão negativa), conserva e zera no início', async () => {
    const r = getRuntime();
    r.startCycle(CYCLE);
    let maxAgua = 0;
    let minVazao = 0;
    let n = 0;
    let fase = '';
    while (fase !== 'COMPLETE' && n++ < 60_000) {
      await r.tick();
      fase = r.publisher.latest!.cycle_phase;
      const c = r.condensado;
      maxAgua = Math.max(maxAgua, c.agua_carga_g);
      if (fase === 'DRY') minVazao = Math.min(minVazao, c.vazao_g_min);
    }
    expect(fase).toBe('COMPLETE');
    const c = r.publisher.latest!.condensado!;
    expect(maxAgua).toBeGreaterThan(1);
    expect(c.agua_carga_g).toBeLessThan(maxAgua);
    expect(c.evap_acum_g).toBeGreaterThan(0);
    expect(minVazao).toBeLessThan(0);
    expect(c.cond_acum_g).toBeCloseTo(c.cond_carga_acum_g + c.cond_parede_acum_g, 6);
    // eslint-disable-next-line no-console
    console.log('ciclo padrão:', { maxAgua, ...c });
    expect(r.publisher.history.at(-1)!.condensado).toBeDefined();

    r.startCycle(CYCLE);
    expect(r.condensado).toEqual(ZERO);
  }, 120_000);
});
