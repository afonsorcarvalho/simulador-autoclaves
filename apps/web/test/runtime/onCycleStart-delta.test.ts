import { describe, it, expect, vi, afterEach } from 'vitest';
import { C_to_K } from '@sim/physics';

// REAL_PLC (server/runtime/plant-defaults.ts) é lido de process.env.SIM_PLC uma vez, no load do
// módulo — por isso este teste liga SIM_PLC=delta e usa vi.resetModules() + import() dinâmico
// para forçar uma reavaliação fresca de plant-defaults/singleton/delta-plc com o env certo, sem
// afetar os outros arquivos de teste (que rodam com o runtime virtual).
const ORIGINAL_SIM_PLC = process.env.SIM_PLC;

describe('onCycleStart (CLP Delta real): aplica a carga dos knobs e zera o condensado', () => {
  afterEach(() => {
    if (ORIGINAL_SIM_PLC === undefined) delete process.env.SIM_PLC;
    else process.env.SIM_PLC = ORIGINAL_SIM_PLC;
    (globalThis as { __SIM_RUNTIME__?: unknown }).__SIM_RUNTIME__ = undefined;
    vi.resetModules();
  });

  it('fase do CLP 0→≠0 monta 2 materiais + T inicial dos knobs e zera o condensado acumulado', async () => {
    process.env.SIM_PLC = 'delta';
    vi.resetModules();
    const { getRuntime, resetRuntime } = await import('../../server/runtime/singleton.js');
    const { DeltaPlcBridge } = await import('../../server/bridge/delta-plc.js');

    resetRuntime();
    const rt = getRuntime();
    expect(rt.bridge).toBeInstanceOf(DeltaPlcBridge);
    const bridge = rt.bridge as InstanceType<typeof DeltaPlcBridge>;

    // fromEnv() aponta p/ um host de bancada real (SIM_PLC_HOST); garante que o timer de
    // polling (sync() a cada 200 ms, que abriria um socket real) nunca chega a disparar —
    // conecta e desconecta de novo antes de qualquer tick do setInterval.
    await bridge.connect();
    await bridge.disconnect();

    rt.loadKnobs.material_a = 'ALUMINUM';
    rt.loadKnobs.mass_a_kg = 12;
    rt.loadKnobs.material_b = 'GLASS';
    rt.loadKnobs.mass_b_kg = 3;
    rt.loadKnobs.T_initial_C = 50; // valor explícito (não a sentinela -1)
    rt.condensado.cond_acum_g = 123;
    rt.condensado.evap_acum_g = 45;
    rt.condensado.vazao_g_min = 6;

    expect(bridge.onCycleStart).toBeInstanceOf(Function);
    bridge.onCycleStart!(); // mesmo gatilho que fase 0→≠0 no CLP real (ver delta-plc.test.ts)

    expect(rt.condensado.cond_acum_g).toBe(0);
    expect(rt.condensado.evap_acum_g).toBe(0);
    expect(rt.condensado.vazao_g_min).toBe(0);

    const nodes = rt.orchestrator.getState().load.nodes;
    const a = nodes.find((n) => n.material === 'ALUMINUM');
    const b = nodes.find((n) => n.material === 'GLASS');
    expect(a?.mass_kg).toBe(12);
    expect(b?.mass_kg).toBe(3);
    expect(a?.T).toBeCloseTo(C_to_K(50), 6);
    expect(b?.T).toBeCloseTo(C_to_K(50), 6);
    expect(b?.isWitness).toBe(true); // mass_b_kg > 0 → B é o testemunho
  });
});
