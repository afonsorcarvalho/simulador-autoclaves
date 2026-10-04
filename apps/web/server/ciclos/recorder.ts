import type { Snapshot } from '../runtime/snapshot.js';
import type { Runtime } from '../runtime/singleton.js';
import { currentValues } from '../knobs/store.js';
import { loadConfig } from '../erros/config.js';
import { PLC_PHASES } from '../../lib/digitalTimeline.js';
import { PLC_OUTPUTS } from '../bridge/delta-plc.js';
import { idDe, salvar, type Ciclo, type PontoSerie, type Resultado } from './store.js';

const FASES_VIRTUAIS = ['IDLE', 'PREHEAT', 'PREVAC_VACUUM', 'PREVAC_STEAM', 'PRESSURIZE', 'HOLD', 'EXHAUST', 'DRY', 'COMPLETE'];
const PLC_FINALIZADO = 10;
const PLC_ABORTADO = 11;

/** Nomes das saídas: CLP real = PLC_OUTPUTS na ordem; virtual = válvulas + atuadores da física. */
function nomesSaidas(s: Snapshot): string[] {
  return s.plc_outputs ? PLC_OUTPUTS.map(([n]) => n) : [...Object.keys(s.valves ?? {}), ...Object.keys(s.actuators ?? {})];
}

function saidasDe(s: Snapshot, nomes: readonly string[]): string {
  const m = s.plc_outputs ?? { ...s.valves, ...s.actuators };
  return nomes.map((n) => (m[n] ? '1' : '0')).join('');
}

function ponto(s: Snapshot, t_s: number, nomes: readonly string[]): PontoSerie {
  const fc = s.plc_phase;
  return {
    t_s,
    p_camara_bar: s.pressures.chamber_bar,
    p_camisa_bar: s.pressures.jacket_bar,
    p_gerador_bar: s.pressures.generator_bar,
    t_camara_C: s.temperatures.chamber_C,
    t_dreno_C: s.temperatures.drain_C,
    t_carga_C: s.temperatures.testemunho_C,
    t_camisa_C: s.temperatures.jacket_C,
    t_gerador_C: s.temperatures.generator_C,
    f0_min: s.f0_min,
    cond_carga_g: s.condensado?.cond_carga_acum_g ?? 0,
    cond_parede_g: s.condensado?.cond_parede_acum_g ?? 0,
    vazao_g_min: s.condensado?.vazao_g_min ?? 0,
    agua_carga_g: s.condensado?.agua_carga_g ?? 0,
    agua_camara_g: s.condensado?.agua_camara_g ?? 0,
    cond_acum_g: s.condensado?.cond_acum_g ?? 0,
    evap_acum_g: s.condensado?.evap_acum_g ?? 0,
    dreno_acum_g: s.condensado?.dreno_acum_g ?? 0,
    ...(s.vapor && {
      vapor_camara_kg: s.vapor.injetado_camara_kg,
      vapor_camisa_kg: s.vapor.injetado_camisa_kg,
      vapor_total_kg: s.vapor.injetado_total_kg,
      vapor_vazao_kg_h: s.vapor.vazao_total_kg_h,
    }),
    fase: fc !== undefined ? (PLC_PHASES[fc] ?? String(fc)) : s.cycle_phase,
    fase_cod: fc ?? FASES_VIRTUAIS.indexOf(s.cycle_phase),
    ...(s.doors && { porta_C: s.doors.C.pos, porta_D: s.doors.D.pos }),
    saidas: saidasDe(s, nomes),
  };
}

function resultadoDe(s: Snapshot | null): Resultado {
  if (!s) return 'desconhecido';
  if (s.plc_phase !== undefined)
    return s.plc_phase === PLC_FINALIZADO ? 'aprovado' : s.plc_phase === PLC_ABORTADO ? 'abortado' : 'desconhecido';
  // virtual: COMPLETE = aprovado; caiu antes disso = operador parou (stopCycle)
  return s.cycle_phase === 'COMPLETE' ? 'aprovado' : 'parado';
}

/**
 * Grava cada ciclo em JSON (ver store.ts). Alimentado pelos snapshots do runtime:
 * início = borda de subida de cycle_running; fim = borda de descida ou (CLP real) fase
 * FINALIZADO/ABORTADO. Parcial a cada `parcialMs` de relógio, p/ não perder dados se cair.
 * ponytail: CLP real não expõe o motivo do aborto no snapshot; motivo fica null.
 */
export class CycleRecorder {
  parcialMs = 60_000;
  private c: Ciclo | null = null;
  private lastSec = -1;
  private lastSave = -Infinity;
  private prevRunning = false;
  private last: Snapshot | null = null;

  constructor(private readonly rt: Runtime) {}

  onSnapshot(s: Snapshot): void {
    const subida = s.cycle_running && !this.prevRunning;
    this.prevRunning = s.cycle_running;
    // Servidor subindo com o CLP já parado no fim de um ciclo (fase 10/11, esperando o FECHAR):
    // não é ciclo novo — gravaria um ciclo de 0 s. O próximo começa depois que a fase voltar a 0.
    const jaNoFim = s.plc_phase === PLC_FINALIZADO || s.plc_phase === PLC_ABORTADO;
    if (subida && !jaNoFim) this.iniciar(s);
    if (!this.c) return;
    if (!s.cycle_running) return this.terminar(this.last);
    this.last = s;
    const sec = Math.floor(s.cycle_elapsed_s);
    if (sec !== this.lastSec) {
      this.lastSec = sec;
      this.c.serie.push(ponto(s, sec, this.c.meta.saidas_nomes ?? []));
    }
    if (s.plc_phase === PLC_FINALIZADO || s.plc_phase === PLC_ABORTADO) return this.terminar(s);
    if (s.wall_t_ms - this.lastSave >= this.parcialMs) this.gravar(s, null);
  }

  private iniciar(s: Snapshot): void {
    const inicio = new Date(s.wall_t_ms);
    const cfg = loadConfig();
    const clp = s.plc_phase !== undefined;
    this.lastSec = -1;
    this.lastSave = -Infinity; // 1º parcial já no primeiro ponto
    this.last = null;
    this.c = {
      meta: {
        id: idDe(inicio),
        inicio: inicio.toISOString(),
        fim: null,
        duracao_s: 0,
        modo: clp ? 'clp' : 'virtual',
        resultado: null,
        motivo: null,
        nome: '',
        anotacao: '',
        parcial: true,
        saidas_nomes: nomesSaidas(s),
      },
      parametros: {
        // CLP real: a receita está no CLP; o simulador não a conhece.
        ciclo: clp ? null : ((this.rt.effectiveCycle as Ciclo['parametros']['ciclo']) ?? null),
        knobs: currentValues(this.rt),
        versoes: {
          ...(cfg.commitClp && { commitClp: cfg.commitClp }),
          ...(cfg.versaoIhm && { versaoIhm: cfg.versaoIhm }),
        },
      },
      resumo: {
        f0_min: 0,
        cond_carga_g: 0,
        cond_parede_g: 0,
        cond_total_g: 0,
        agua_carga_fim_g: 0,
        evap_total_g: 0,
        t_carga_max_C: 0,
        p_camara_max_bar: 0,
        tempos_fase_s: {},
      },
      serie: [],
    };
  }

  private terminar(s: Snapshot | null): void {
    const r = resultadoDe(s);
    this.gravar(s, r, r === 'parado' ? 'parado pelo operador' : null);
    this.c = null;
  }

  private gravar(s: Snapshot | null, r: Resultado | null, motivo: string | null = null): void {
    const c = this.c!;
    const serie = c.serie;
    const ult = serie.at(-1);
    c.meta.parcial = r === null;
    c.meta.resultado = r;
    c.meta.motivo = motivo;
    c.meta.fim = r === null ? null : new Date(s?.wall_t_ms ?? Date.now()).toISOString();
    c.meta.duracao_s = ult?.t_s ?? 0;
    const tempos: Record<string, number> = {};
    for (let i = 1; i < serie.length; i++) {
      const f = serie[i - 1]!.fase;
      tempos[f] = (tempos[f] ?? 0) + serie[i]!.t_s - serie[i - 1]!.t_s;
    }
    let tMax = -Infinity;
    let pMax = -Infinity;
    for (const p of serie) {
      tMax = Math.max(tMax, p.t_carga_C);
      pMax = Math.max(pMax, p.p_camara_bar);
    }
    c.resumo = {
      f0_min: ult?.f0_min ?? 0,
      cond_carga_g: ult?.cond_carga_g ?? 0,
      cond_parede_g: ult?.cond_parede_g ?? 0,
      cond_total_g: (ult?.cond_carga_g ?? 0) + (ult?.cond_parede_g ?? 0),
      agua_carga_fim_g: ult?.agua_carga_g ?? 0,
      evap_total_g: ult?.evap_acum_g ?? 0,
      vapor_camara_kg: ult?.vapor_camara_kg ?? 0,
      vapor_camisa_kg: ult?.vapor_camisa_kg ?? 0,
      vapor_total_kg: ult?.vapor_total_kg ?? 0,
      energia_kwh: s?.vapor?.energia_kwh ?? 0,
      t_carga_max_C: ult ? tMax : 0,
      p_camara_max_bar: ult ? pMax : 0,
      tempos_fase_s: tempos,
    };
    try {
      salvar(c);
    } catch (err) {
      console.error('ciclos: falha gravando ciclo:', err);
    }
    this.lastSave = s?.wall_t_ms ?? Date.now();
  }
}
