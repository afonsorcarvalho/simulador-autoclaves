import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { getRuntime, resetRuntime, coldInitial } from '../../server/runtime/singleton.js';
import { KNOBS, knobById, mmFromCv, cvFromMm } from '../../server/knobs/registry.js';
import { defaultOverridePath } from '../../server/knobs/store.js';
import { POST } from '../../app/api/knobs/route.js';
import { system_step, chamber_pressure, P_ATM, R_AIR, type SystemParams } from '@sim/physics';

const post = (id: string, value: number) =>
  POST(
    new Request('http://x/api/knobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, value }),
    }),
  );

/** Tempo (s) de evacuação de P0 até P1 com V_VAC + bomba, a partir de `s0`. */
function evacTime(p: SystemParams, s0: ReturnType<typeof coldInitial>, P1: number): number {
  let s = s0;
  let t = 0;
  while (chamber_pressure(s.chamber, p.chamber).p_total > P1 && t < 2000) {
    s = system_step(s, p, { V_VAC: true }, { pump_vac: true, heater_gen: true }, 0.05);
    t += 0.05;
  }
  return t;
}

/** 1º pulso de prevac: vácuo até 0,15 bar, depois vapor até 2 bar abs; devolve o estado. */
function steamTo2bar(p: SystemParams): ReturnType<typeof coldInitial> {
  let s = coldInitial(p);
  for (let i = 0; i < 1e5 && chamber_pressure(s.chamber, p.chamber).p_total > 1.5e4; i++)
    s = system_step(s, p, { V_VAC: true }, { pump_vac: true, heater_gen: true }, 0.05);
  for (let i = 0; i < 1e5 && chamber_pressure(s.chamber, p.chamber).p_total < 2e5; i++)
    s = system_step(s, p, { V_STEAM_IN_INT: true }, { pump_vac: false, heater_gen: true }, 0.05);
  return s;
}

describe('knobs de planta: diâmetros, bomba, geometria, ajuda', () => {
  const FILE = defaultOverridePath();
  beforeEach(() => {
    resetRuntime();
    if (existsSync(FILE)) rmSync(FILE);
  });
  afterEach(() => {
    if (existsSync(FILE)) rmSync(FILE);
  });

  it('mm ↔ Cv: ida e volta', () => {
    for (const cv of [1e-6, 5e-6, 8e-6, 2e-5, 1e-4])
      expect(cvFromMm(mmFromCv(cv))).toBeCloseTo(cv, 15);
    expect(mmFromCv(cvFromMm(12.7))).toBeCloseTo(12.7, 10);
    expect(mmFromCv(8e-6).toFixed(1)).toBe('3.2');
  });

  it('defaults reproduzem exatamente os parâmetros anteriores', () => {
    const p = getRuntime().params;
    expect(p.valves.V_STEAM_IN_INT!.params.Cv).toBe(8e-6);
    expect(p.valves.V_STEAM_IN_JACKET!.params.Cv).toBe(1e-6); // modo virtual
    expect(p.valves.V_AIR_IN!.params.Cv).toBe(2e-5);
    expect(p.valves.V_EXHAUST!.params.Cv).toBe(2e-5);
    expect(p.valves.V_DRAIN_INT!.params.Cv).toBe(2e-5);
    expect(p.chamber.V).toBe(0.15);
    expect(p.chamber.wall_mass_kg).toBe(50);
    expect(p.jacket.V).toBe(0.025);
    expect(p.jacket.wall_mass_kg).toBe(15);
    expect(p.vacuum_pump).toEqual({ S_nom_m3_per_s: 75 / 3600, p_ult_Pa: 1000, vapor_factor: 1.7 });
    // set(default) é bit-idêntico para todos os knobs
    const rt = getRuntime();
    for (const k of KNOBS) {
      const before = JSON.stringify(rt.params);
      k.set(rt, k.default);
      expect(JSON.stringify(rt.params), k.id).toBe(before);
    }
  });

  // Calibração S_nom 75 m³/h / vapor_factor 1,7: ar 17,4→17,3 s; vapor (2º vácuo do prevac) ~70→71,5 s.
  it('bomba: evacuação de ar e de vapor dentro de 3 % do modelo antigo (Cv 1e-4 até 10 mbar)', () => {
    const pump = structuredClone(getRuntime().params);
    const legacy = structuredClone(pump);
    delete legacy.vacuum_pump;
    const air = (p: SystemParams) => evacTime(p, coldInitial(p), 1e4);
    const steam = (p: SystemParams) => evacTime(p, steamTo2bar(p), 1.5e4);
    for (const f of [air, steam]) {
      const tOld = f(legacy);
      const tNew = f(pump);
      expect(Math.abs(tNew / tOld - 1)).toBeLessThan(0.03);
    }
  });

  it('bomba: nada sai abaixo da pressão final, e a câmara para nela', () => {
    const p = structuredClone(getRuntime().params);
    p.vacuum_pump!.p_ult_Pa = 5000; // 50 mbar
    const t = evacTime(p, coldInitial(p), 4000);
    expect(t).toBeGreaterThanOrEqual(2000); // nunca chega a 40 mbar
    let s = coldInitial(p);
    for (let i = 0; i < 20000; i++)
      s = system_step(s, p, { V_VAC: true }, { pump_vac: true, heater_gen: false }, 0.05);
    expect(chamber_pressure(s.chamber, p.chamber).p_total).toBeGreaterThanOrEqual(4900);
    // bomba desligada: V_VAC aberta não tira nada
    const s0 = coldInitial(p);
    const s1 = system_step(s0, p, { V_VAC: true }, { pump_vac: false, heater_gen: false }, 0.05);
    expect(s1.chamber.m_air).toBe(s0.chamber.m_air);
  });

  it('volume da câmara: 409 no meio do ciclo; parado aplica via reset e escala a camisa', async () => {
    const rt = getRuntime();
    rt.cycle_running = true;
    expect((await post('plant.chamber.volume', 300)).status).toBe(409);
    expect((await post('plant.chamber.wall_mass', 80)).status).toBe(409);
    expect(rt.params.chamber.V).toBe(0.15);
    rt.cycle_running = false;
    rt.resetPlant('cold');
    expect((await post('plant.chamber.volume', 300)).status).toBe(200);
    expect(rt.params.chamber.V).toBe(0.3);
    expect(rt.params.jacket.V).toBeCloseTo(0.05, 12);
    expect(rt.params.jacket.wall_mass_kg).toBeCloseTo(30, 9);
    // reset frio reaplicado com o novo volume: 1 atm de ar em 300 L
    const s = rt.orchestrator.getState();
    expect(s.chamber.m_air).toBeCloseTo(
      (P_ATM * 0.3) / (R_AIR * rt.params.external.atmosphere_T),
      9,
    );
    expect(rt.plantPreset).toBe('cold');
    expect((await post('plant.chamber.wall_mass', 80)).status).toBe(200);
    expect(rt.params.chamber.wall_mass_kg).toBe(80);
    expect(knobById('plant.chamber.volume')!.get(rt)).toBe(300);
  });

  it('todo knob tem texto de ajuda não vazio', () => {
    for (const k of KNOBS) expect(k.help.trim().length, k.id).toBeGreaterThan(40);
  });
});
