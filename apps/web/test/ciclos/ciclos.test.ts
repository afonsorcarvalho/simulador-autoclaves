import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRuntime, resetRuntime } from '../../server/runtime/singleton.js';
import { marcarOrfaos, type Ciclo } from '../../server/ciclos/store.js';
import { CycleRecorder } from '../../server/ciclos/recorder.js';
import type { CycleConfig } from '../../server/virtual-plc/cycle-config.js';
import { GET as LISTA } from '../../app/api/ciclos/route.js';
import { GET, PATCH, DELETE } from '../../app/api/ciclos/[id]/route.js';
import { GET as CSV } from '../../app/api/ciclos/[id]/csv/route.js';

const CYCLE: CycleConfig = {
  name: 'curto',
  sterilization_T_C: 134,
  sterilization_P_bar: 3.04,
  hold_duration_s: 20,
  prevac_pulses: 0,
  prevac_vacuum_target_bar: 0.2,
  prevac_steam_target_bar: 2,
  preheat_duration_s: 5,
  dry_duration_s: 10,
  f0_target_min: 100,
};

let dir: string;
const arquivos = () => readdirSync(dir).filter((f) => f.endsWith('.json'));
const ler = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Ciclo;
const req = (path: string, init: RequestInit & { host?: string } = {}) =>
  new Request(`http://localhost${path}`, {
    ...init,
    headers: { host: init.host ?? 'localhost:3030', 'Content-Type': 'application/json' },
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('gravação de ciclos', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ciclos-'));
    process.env.SIM_CICLOS_DIR = dir;
    resetRuntime();
  });

  it('ciclo virtual completo grava meta/parametros/resumo/serie; parcial durante o ciclo', async () => {
    const r = getRuntime();
    const inicio = new Date();
    r.startCycle(CYCLE);
    for (let i = 0; i < 40; i++) await r.tick(); // 2 s
    expect(arquivos()).toHaveLength(1);
    expect(ler(arquivos()[0]!).meta.parcial).toBe(true);
    for (let i = 0; i < 200000 && r.cycle_running; i++) await r.tick();
    expect(r.cycle_running).toBe(false);
    await r.tick();
    const [f] = arquivos();
    const p = (n: number) => String(n).padStart(2, '0');
    expect(f!.startsWith(`${inicio.getFullYear()}-${p(inicio.getMonth() + 1)}-${p(inicio.getDate())}_`)).toBe(true);
    expect(f).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}h\d{2}m\d{2}s\.json$/);
    const c = ler(f!);
    expect(c.meta.parcial).toBe(false);
    expect(c.meta.resultado).toBe('aprovado');
    expect(c.meta.modo).toBe('virtual');
    expect(c.meta.id).toBe(f!.replace('.json', ''));
    expect(c.parametros.ciclo?.name).toBe('curto');
    expect(c.parametros.knobs['time.scale']).toBe(2);
    expect(c.serie.length).toBeGreaterThan(30);
    expect(c.serie[1]!.t_s).toBe(1);
    expect(c.resumo.f0_min).toBeGreaterThan(0);
    expect(c.resumo.tempos_fase_s['HOLD']).toBeGreaterThan(15);
    expect(c.meta.duracao_s).toBeGreaterThan(30);
    expect(typeof c.serie.at(-1)!.agua_carga_g).toBe('number');
    expect(typeof c.serie.at(-1)!.evap_acum_g).toBe('number');
    expect(c.resumo.agua_carga_fim_g).toBe(c.serie.at(-1)!.agua_carga_g);
    expect(c.resumo.cond_total_g).toBeGreaterThan(0);
    expect(c.resumo.evap_total_g).toBeGreaterThanOrEqual(0);
    expect(c.resumo.vapor_camara_kg).toBe(c.serie.at(-1)!.vapor_camara_kg);
    expect(c.resumo.vapor_total_kg).toBeGreaterThan(0);
    expect(c.resumo.energia_kwh).toBeGreaterThan(0);
    expect(c.serie.at(-1)!.vapor_vazao_kg_h).toBeGreaterThanOrEqual(0);
    // saídas: ids da física (válvulas + atuadores), uma string '0/1' por ponto
    expect(c.meta.saidas_nomes).toContain('V_STEAM_IN_INT');
    expect(c.meta.saidas_nomes).toContain('PUMP_VAC');
    expect(c.serie.every((p) => p.saidas?.length === c.meta.saidas_nomes!.length)).toBe(true);
    const iVap = c.meta.saidas_nomes!.indexOf('V_STEAM_IN_INT');
    expect(c.serie.some((p) => p.saidas![iVap] === '1')).toBe(true);
  });

  it('CLP real: saidas_nomes = PLC_OUTPUTS e bits por ponto', () => {
    const r = new CycleRecorder(getRuntime());
    const snap = (t: number, vapor: boolean, running = true) =>
      ({
        cycle_running: running, plc_phase: 3, cycle_phase: 'X', cycle_elapsed_s: t, wall_t_ms: t * 1000, f0_min: 0,
        pressures: { chamber_bar: 1, jacket_bar: 1, generator_bar: 1 },
        temperatures: { chamber_C: 20, drain_C: 20, testemunho_C: 20, jacket_C: 20, generator_C: 20 },
        valves: { V_FISICA: true }, actuators: {},
        plc_outputs: { OUT_BOMBA_VACUO: true, OUT_VALV_VAPOR_CAMARA: vapor },
      }) as never;
    r.onSnapshot(snap(0, false));
    r.onSnapshot(snap(1, true));
    r.onSnapshot(snap(2, true, false));
    const c = ler(arquivos()[0]!);
    expect(c.meta.saidas_nomes![0]).toBe('OUT_BOMBA_VACUO');
    expect(c.meta.saidas_nomes).toHaveLength(20);
    const i = c.meta.saidas_nomes!.indexOf('OUT_VALV_VAPOR_CAMARA');
    expect(c.serie.map((p) => p.saidas![i])).toEqual(['0', '1']);
    expect(c.serie[0]!.saidas![0]).toBe('1');
  });

  it('CLP já parado no fim (fase 10/11) quando o servidor sobe: não grava ciclo de 0 s', () => {
    const r = new CycleRecorder(getRuntime());
    const snap = { cycle_running: true, plc_phase: 11, cycle_elapsed_s: 0, wall_t_ms: 0 } as never;
    r.onSnapshot(snap);
    r.onSnapshot({ ...(snap as object), wall_t_ms: 1000 } as never);
    expect(arquivos()).toEqual([]);
  });

  it('ciclo parado grava resultado parado; órfão parcial vira interrompido', async () => {
    const r = getRuntime();
    r.startCycle(CYCLE);
    for (let i = 0; i < 100; i++) await r.tick();
    r.stopCycle();
    await r.tick();
    expect(ler(arquivos()[0]!).meta.resultado).toBe('parado');

    const orfao = ler(arquivos()[0]!);
    orfao.meta.parcial = true;
    writeFileSync(join(dir, '2020-01-01_00h00m00s.json'), JSON.stringify({ ...orfao, meta: { ...orfao.meta, id: '2020-01-01_00h00m00s' } }));
    marcarOrfaos();
    const o = ler('2020-01-01_00h00m00s.json');
    expect(o.meta.resultado).toBe('interrompido');
    expect(o.meta.parcial).toBe(false);
  });

  it('API: lista, get, patch, csv, delete, traversal 400, remoto 403', async () => {
    const r = getRuntime();
    r.startCycle(CYCLE);
    for (let i = 0; i < 100; i++) await r.tick();
    r.stopCycle();
    await r.tick();
    const id = arquivos()[0]!.replace('.json', '');

    const lista = (await (await LISTA(req('/api/ciclos'))).json()) as { ciclos: Ciclo[] };
    expect(lista.ciclos).toHaveLength(1);
    expect(lista.ciclos[0]!.serie).toBeUndefined();
    expect(lista.ciclos[0]!.resumo).toBeDefined();

    const full = (await (await GET(req(`/api/ciclos/${id}`), ctx(id))).json()) as Ciclo;
    expect(full.serie.length).toBeGreaterThan(3);

    const pr = await PATCH(req(`/api/ciclos/${id}`, { method: 'PATCH', body: JSON.stringify({ nome: 'teste A', anotacao: 'obs' }) }), ctx(id));
    expect(pr.status).toBe(200);
    expect(ler(`${id}.json`).meta.nome).toBe('teste A');
    expect(ler(`${id}.json`).meta.anotacao).toBe('obs');

    const csv = await (await CSV(req(`/api/ciclos/${id}/csv`), ctx(id))).text();
    const linhas = csv.trim().split('\n');
    expect(linhas[0]).toContain(';');
    expect(linhas[0]).toContain('p_camara_bar');
    expect(linhas[2]).toMatch(/\d,\d/);
    expect(linhas[2]).not.toMatch(/\d\.\d/);

    for (const bad of ['..', '../x', 'a/b', '..%2Fx', '2020-01-01_00h00m00s/..'])
      expect((await GET(req('/api/ciclos/x'), ctx(bad))).status).toBe(400);
    expect((await GET(req(`/api/ciclos/2020-01-01_00h00m00s`), ctx('2020-01-01_00h00m00s'))).status).toBe(404);
    expect((await LISTA(req('/api/ciclos', { host: '192.168.0.50:3030' }))).status).toBe(403);
    expect((await DELETE(req(`/api/ciclos/${id}`, { method: 'DELETE', host: '192.0.2.2' }), ctx(id))).status).toBe(403);

    expect((await DELETE(req(`/api/ciclos/${id}`, { method: 'DELETE' }), ctx(id))).status).toBe(200);
    expect(arquivos()).toHaveLength(0);
  });
});
