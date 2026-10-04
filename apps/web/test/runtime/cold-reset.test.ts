import { describe, it, expect, beforeEach } from 'vitest';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { setManualValve } from '../../server/runtime/manual-control.js';
import { POST } from '../../app/api/plant/reset/route.js';
import { chamber_pressure, generator_pressure, K_to_C, P_ATM } from '@sim/physics';

const post = (q: string) => POST(new Request(`http://x/api/plant/reset${q}`, { method: 'POST' }));

function finite(o: unknown): boolean {
  return typeof o === 'number'
    ? Number.isFinite(o)
    : typeof o === 'object' && o !== null
      ? Object.values(o).every(finite)
      : true;
}

describe('máquina fria', () => {
  beforeEach(() => resetRuntime());

  it('reset frio: ambiente, 1 atm, F0 0, dreno ambiente, ciclo virtual parado', async () => {
    const r = getRuntime();
    for (let i = 0; i < 20; i++) await r.tick();
    r.startCycle({
      name: 't',
      sterilization_T_C: 134,
      sterilization_P_bar: 3.04,
      hold_duration_s: 60,
      prevac_pulses: 0,
      prevac_vacuum_target_bar: 0.2,
      prevac_steam_target_bar: 2,
      preheat_duration_s: 10,
      dry_duration_s: 60,
      f0_target_min: 1,
    });
    const res = await post('?preset=cold');
    expect(res.status).toBe(200);
    expect(r.cycle_running).toBe(false);
    await r.tick();
    const s = r.orchestrator.getState();
    for (const T of [s.chamber.T, s.chamber.T_wall, s.jacket.T, s.jacket.T_wall] as number[])
      expect(K_to_C(T)).toBeCloseTo(23, 0);
    expect(chamber_pressure(s.chamber, r.params.chamber).p_total / P_ATM).toBeCloseTo(1, 1);
    expect(chamber_pressure(s.jacket, r.params.jacket).p_total / P_ATM).toBeCloseTo(1, 1);
    // gerador = linha de vapor (fonte de vapor = 1): continua quente
    expect(K_to_C(s.generator!.T)).toBeGreaterThan(140);
    expect(s.f0_minutes).toBe(0);
    expect(r.orchestrator.drain.value_C).toBeCloseTo(23, 0);
    expect(r.publisher.latest?.f0_min ?? 0).toBe(0);
  });

  it('preset inválido -> 400; pré-aquecida volta a parede quente', async () => {
    expect((await post('?preset=xx')).status).toBe(400);
    expect((await post('?preset=preheated')).status).toBe(200);
    expect(K_to_C(getRuntime().orchestrator.getState().jacket.T)).toBeCloseTo(138, 0);
  });

  it('reset frio: válvula de vapor aberta pressuriza a câmara (gerador = linha)', async () => {
    const r = getRuntime();
    await post('?preset=cold');
    await setManualValve(r, 'V_STEAM_IN_INT', true);
    for (let i = 0; i < 600; i++) await r.tick(); // 30 s simulados
    const s = r.orchestrator.getState();
    expect(finite(s)).toBe(true);
    expect(chamber_pressure(s.chamber, r.params.chamber).p_total / P_ATM).toBeGreaterThan(1.2);
  });

  it('gerador=frio: água a ambiente sem vapor, estável com aquecedor e válvulas de vapor abertas (sem NaN)', async () => {
    const r = getRuntime();
    await post('?preset=cold&gerador=frio');
    expect(K_to_C(r.orchestrator.getState().generator!.T)).toBeCloseTo(23, 0);
    expect(r.orchestrator.getState().generator!.m_water_vap).toBe(0);
    for (const v of ['HEATER_GEN', 'V_STEAM_IN_INT', 'V_STEAM_IN_JACKET'])
      await setManualValve(r, v, true);
    for (let i = 0; i < 600; i++) await r.tick(); // 30 s simulados
    const s = r.orchestrator.getState();
    expect(finite(s)).toBe(true);
    expect(s.chamber.m_vap).toBeGreaterThanOrEqual(0);
    expect(s.generator!.m_water_vap).toBeGreaterThanOrEqual(0);
    expect(K_to_C(s.generator!.T)).toBeGreaterThan(23);
    expect(Number.isFinite(generator_pressure(s.generator!, r.params.generator!))).toBe(true);
  });
});
