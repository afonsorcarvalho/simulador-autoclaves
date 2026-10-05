import type { SystemState, SystemParams } from '@sim/physics';
import {
  chamber_pressure,
  generator_pressure,
  generator_capacity_kg,
  K_to_C,
  Pa_to_bar,
  secagemEN285,
} from '@sim/physics';
import type { DoorSide, DoorState } from '../bridge/delta-plc.js';
import type { Fault } from '../faults/types.js';
import { lvlGenThresholdsKg } from '../orchestrator/sensor-publisher.js';

export interface Snapshot {
  t_s: number;
  wall_t_ms: number;
  cycle_running: boolean;
  cycle_phase: string;
  cycle_elapsed_s: number;
  f0_min: number;
  pressures: { chamber_bar: number; jacket_bar: number; generator_bar: number };
  temperatures: {
    chamber_C: number;
    /** Sonda do dreno (PT1), com atraso do sensor. */
    drain_C: number;
    testemunho_C: number;
    jacket_C: number;
    generator_C: number;
  };
  valves: Record<string, boolean>;
  /** Atuadores não-válvula (PUMP_VAC, HEATER_GEN). */
  actuators: Record<string, boolean>;
  /** Só com SIM_PLC=delta: saídas M40..M59 do CLP, por nome. */
  plc_outputs?: Record<string, boolean>;
  /** Só com SIM_PLC=delta: fase do CLP (SIM_PLC_PHASE_REG). */
  plc_phase?: number;
  /** Só com SIM_PLC=delta: portas C/D (posição, guarnição, FC, falhas). */
  doors?: Record<DoorSide, DoorState>;
  /** Falhas físicas ativas (ver /api/faults); omitido quando não há nenhuma. */
  faults_active?: Fault[];
  masses: { air_chamber_kg: number; vap_chamber_kg: number; liq_chamber_kg: number };
  /** Água na carga/câmara (g), condensado/evaporado acumulados no ciclo (g), vazão com sinal (g/min). */
  condensado?: Condensado;
  /** Consumo de vapor do ciclo atual (ver Vapor). */
  vapor?: Vapor;
  /** Gerador de vapor: água líquida, sensores de nível (mesmos limiares do sensor-publisher) e alívio. */
  generator?: GeneratorSnap;
  /** Umidade por item da carga e aprovação pelo ensaio de secagem EN 285. */
  secagem?: SecagemItem[];
}

export interface SecagemItem {
  nome: string;
  embalagem: string;
  agua_g: number;
  /** Ganho de massa (% da massa seca) e limite EN 285 (%). */
  ganho_pct: number;
  limite_pct: number;
  aprovado: boolean;
}

export interface GeneratorSnap {
  agua_kg: number;
  lvl_min: boolean;
  lvl_max: boolean;
  /** Pressão de abertura da válvula de alívio (bar abs). */
  alivio_bar: number;
  /** Capacidade do vaso (kg de água, 100% cheio de líquido) — referência para o desenho (frações
   *  LVL_GEN_MIN_FRAC/LVL_GEN_MAX_FRAC em @sim/physics, mesmas usadas no sensor-publisher). */
  capacidade_kg: number;
  /** Fundo de escala do transdutor de pressão do gerador (bar abs). */
  transd_fundo_bar: number;
}

/** Massas acumuladas no ciclo (kg, zeradas no início), vazões kg/h (média móvel ~10 s) e energia.
 *  energia_kwh = Σ m·(h_vap(T_origem) − h_liq(25 °C)) do vapor injetado (câmara + camisa), na base
 *  de entalpia do modelo físico (h_vap = CP_VAP·T + U_FG0; h_liq = CP_LIQ·T): energia p/ gerar esse
 *  vapor a partir de água a 25 °C. Exaustão inclui V_EXHAUST, gás de V_DRAIN_INT e alívio (vapor+ar);
 *  vácuo idem (vapor+ar); dreno = líquido da câmara; camisa_dreno = condensado da camisa. */
export interface Vapor {
  injetado_camara_kg: number;
  injetado_camisa_kg: number;
  injetado_total_kg: number;
  exaustao_kg: number;
  vacuo_kg: number;
  dreno_kg: number;
  camisa_dreno_kg: number;
  ar_admitido_kg: number;
  vazao_camara_kg_h: number;
  vazao_camisa_kg_h: number;
  vazao_total_kg_h: number;
  energia_kwh: number;
}

export interface Condensado {
  /** Água atual na carga (Σ m_water dos nós). */
  agua_carga_g: number;
  /** Líquido atual no fundo da câmara. */
  agua_camara_g: number;
  /** Acumulados no ciclo (carga + parede), zerados no início. */
  cond_acum_g: number;
  evap_acum_g: number;
  cond_carga_acum_g: number;
  cond_parede_acum_g: number;
  /** Líquido que saiu pelo dreno no ciclo. */
  dreno_acum_g: number;
  /** (condensação − evaporação) total, média móvel ~10 s: > 0 condensa, < 0 evapora. */
  vazao_g_min: number;
}

export interface BuildSnapshotOpts {
  state: SystemState;
  params: SystemParams;
  cycle_running: boolean;
  cycle_phase: string;
  cycle_elapsed_s: number;
  valves: Record<string, boolean>;
  actuators?: Record<string, boolean>;
  plc_outputs?: Record<string, boolean>;
  plc_phase?: number;
  doors?: Record<DoorSide, DoorState>;
  faults_active?: Fault[];
  /** Leitura da sonda do dreno (°C); sem ela, cai na T do gás. */
  drain_C?: number | null;
  condensado?: Condensado;
  vapor?: Vapor;
}

export function buildSnapshot(o: BuildSnapshotOpts): Snapshot {
  const pc = chamber_pressure(o.state.chamber, o.params.chamber);
  const pj = chamber_pressure(o.state.jacket, o.params.jacket);
  const pg =
    o.state.generator && o.params.generator
      ? generator_pressure(o.state.generator, o.params.generator)
      : 0;
  return {
    t_s: o.state.time_s,
    wall_t_ms: Date.now(),
    cycle_running: o.cycle_running,
    cycle_phase: o.cycle_phase,
    cycle_elapsed_s: o.cycle_elapsed_s,
    f0_min: o.state.f0_minutes,
    pressures: {
      chamber_bar: Pa_to_bar(pc.p_total),
      jacket_bar: Pa_to_bar(pj.p_total),
      generator_bar: Pa_to_bar(pg),
    },
    temperatures: {
      chamber_C: K_to_C(o.state.chamber.T),
      drain_C: o.drain_C ?? K_to_C(o.state.chamber.T),
      testemunho_C: K_to_C(
        (o.state.load.nodes.find((n) => n.isWitness) ?? o.state.load.nodes[0]!).T,
      ),
      jacket_C: K_to_C(o.state.jacket.T),
      generator_C: o.state.generator ? K_to_C(o.state.generator.T) : 0,
    },
    valves: { ...o.valves },
    actuators: { ...o.actuators },
    ...(o.plc_outputs && { plc_outputs: { ...o.plc_outputs } }),
    ...(o.plc_phase !== undefined && { plc_phase: o.plc_phase }),
    ...(o.doors && { doors: o.doors }),
    ...(o.faults_active && o.faults_active.length > 0 && { faults_active: o.faults_active }),
    masses: {
      air_chamber_kg: o.state.chamber.m_air,
      vap_chamber_kg: o.state.chamber.m_vap,
      liq_chamber_kg: o.state.chamber.m_liq,
    },
    ...(o.condensado && { condensado: { ...o.condensado } }),
    ...(o.vapor && { vapor: { ...o.vapor } }),
    secagem: o.state.load.nodes.map((n) => {
      const emb = n.embalagem ?? 'nenhuma';
      const r = secagemEN285(emb, n.m_water, n.mass_kg);
      return {
        nome: n.name,
        embalagem: emb,
        agua_g: n.m_water * 1000,
        ganho_pct: r.ganho * 100,
        limite_pct: r.limite * 100,
        aprovado: r.aprovado,
      };
    }),
    ...(o.state.generator &&
      (() => {
        // mesmo default do modelo (generator.ts)
        const V_total = o.params.generator?.V_total ?? 0.05;
        const { min, max } = lvlGenThresholdsKg(V_total);
        return {
          generator: {
            agua_kg: o.state.generator!.m_water_liq,
            lvl_min: o.state.generator!.m_water_liq > min,
            lvl_max: o.state.generator!.m_water_liq > max,
            alivio_bar: Pa_to_bar(o.params.generator?.relief_pressure_Pa ?? 600000),
            capacidade_kg: generator_capacity_kg(V_total),
            transd_fundo_bar: o.params.generator?.transd_fundo_bar ?? 10,
          },
        };
      })()),
  };
}

export type SnapshotSubscriber = (snap: Snapshot) => void;

const HISTORY_CAP = 5000; // whole cycle at 1 Hz (~83 min)

export class SnapshotPublisher {
  private subs = new Set<SnapshotSubscriber>();
  private _latest: Snapshot | null = null;
  private _history: Snapshot[] = [];
  private lastSec = -1;
  private prevRunning = false;

  publish(snap: Snapshot): void {
    this._latest = snap;
    this.record(snap);
    for (const cb of this.subs) {
      try {
        cb(snap);
      } catch (err) {
        console.error('snapshot subscriber threw:', err);
      }
    }
  }

  /**
   * Server-side cycle history so a client that opens (or re-opens) /live gets the
   * whole cycle, not just from the moment it connected. One point per elapsed second
   * while running; cleared when a new cycle starts (rising edge of cycle_running).
   */
  private record(snap: Snapshot): void {
    if (snap.cycle_running && !this.prevRunning) {
      this._history = [];
      this.lastSec = -1;
    }
    this.prevRunning = snap.cycle_running;
    if (!snap.cycle_running) return;
    const sec = Math.floor(snap.cycle_elapsed_s);
    if (sec !== this.lastSec) {
      this.lastSec = sec;
      this._history.push(snap);
      if (this._history.length > HISTORY_CAP) this._history.shift();
    }
  }

  subscribe(cb: SnapshotSubscriber): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  get latest(): Snapshot | null {
    return this._latest;
  }

  get history(): readonly Snapshot[] {
    return this._history;
  }
}
