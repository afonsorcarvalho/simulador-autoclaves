import { VirtualEsp32Bridge } from '../bridge/virtual-esp32.js';
import { DeltaPlcBridge } from '../bridge/delta-plc.js';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { VirtualPLC } from '../virtual-plc/plc.js';
import type { CycleConfig } from '../virtual-plc/cycle-config.js';
import type { ModbusBridge } from '../bridge/bridge.js';
import { SnapshotPublisher, buildSnapshot, type Condensado, type Vapor } from './snapshot.js';
import type {
  SystemParams,
  SystemState,
  LoadItemConfig,
  LoadState,
  MaterialName,
} from '@sim/physics';
import {
  C_to_K,
  CP_LIQ,
  P_ATM,
  R_AIR,
  GAMMA_AIR,
  GAMMA_VAP,
  R_VAP,
  bar_to_Pa,
  buildLoadState,
} from '@sim/physics';
import { readCommands } from '../orchestrator/command-reader.js';
import { applyFactory, applyOverrides } from '../knobs/store.js';
import { FaultEngine } from '../faults/engine.js';
import { CycleRecorder } from '../ciclos/recorder.js';
import { marcarOrfaos } from '../ciclos/store.js';
import { REAL_PLC, VALVE_CV_DEFAULT, PUMP_DEFAULT, CHAMBER_REF } from './plant-defaults.js';

/** Bridge com faultEngine próprio (HIL real). Duck typing por formato, não `instanceof`:
 *  o runtime vive em globalThis (sobrevive ao HMR) e rotas importam sua própria cópia da
 *  classe DeltaPlcBridge/FaultEngine — `instanceof` falharia mesmo sendo a mesma instância. */
function hasFaultEngine(b: unknown): b is { faultEngine: FaultEngine } {
  const f = (b as { faultEngine?: unknown } | null)?.faultEngine as
    | Partial<FaultEngine>
    | undefined;
  return typeof f?.applyValves === 'function' && typeof f?.has === 'function';
}

export const TICK_DT_S = 0.05;
const CV = VALVE_CV_DEFAULT;

function defaultParams(): SystemParams {
  return {
    chamber: {
      V: CHAMBER_REF.V,
      allowLiquid: true,
      wall_mass_kg: CHAMBER_REF.wall_kg,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 200,
      // Gás↔parede com ar seco (convecção natural): calibrado p/ a câmara ficar em 60–80 °C após a
      // quebra de vácuo com camisa quente (test/sensors/quebra-vacuo.test.ts). Knob de calibração.
      wall_h_air_W_per_K: 15,
      wall_h_steam_dry_W_per_K: 100,
      // SP-B: relief is a SAFETY CAP, not the operating point. Sized so its saturation temperature
      // T_sat(3.25 bar) ≈ 135.9 °C stays under the EN 285 +3 ceiling (137) — an open steam burst
      // saturates the chamber toward the relief pressure, so the relief sets the overshoot ceiling.
      // The steam-valve controller (bang-bang) regulates temperature against the loss paths below.
      relief_pressure_Pa: bar_to_Pa(3.25),
      // ponytail: vessel-calibration knobs — ambient loss (door/penetrations) + passive condensate
      // trap. Sized so a steam-starved chamber falls below setpoint in ~50 s (controllable). Tune on
      // the real vessel. See docs .../2026-07-06-chamber-temperature-control-design.md.
      h_ambient_W_per_K: 10,
      drain_kg_per_s: 2e-5,
    },
    jacket: {
      V: CHAMBER_REF.jacket_V,
      allowLiquid: false,
      wall_mass_kg: CHAMBER_REF.jacket_wall_kg,
      wall_cp_J_per_kg_K: 500,
      wall_h_W_per_K: 100,
    },
    generator: {
      V_total: 0.05,
      heater_power_W: 36000,
      relief_pressure_Pa: bar_to_Pa(4.54),
    },
    load: { h0_conv: 30, k_cond: 2e-6, k_ev: 2e-6 },
    valves: {
      V_STEAM_IN_INT: {
        from: 'generator',
        to: 'chamber',
        params: { Cv: CV.V_STEAM_IN_INT, gamma: GAMMA_VAP, R: R_VAP },
      },
      V_STEAM_IN_JACKET: {
        from: 'generator',
        to: 'jacket',
        // CLP real: ele controla a camisa (sem termostato interno) e precisa de vazão para chegar
        // ao SP de ~3,6 bar abs em < 2 min. ponytail: Cv 5e-6 calibrado a olho; ajustar no vaso real.
        // Teto da camisa continua sendo o alívio do gerador (4,54 bar abs).
        params: { Cv: CV.V_STEAM_IN_JACKET, gamma: GAMMA_VAP, R: R_VAP },
        ...(REAL_PLC
          ? {}
          : {
              // Termostato 3,24–3,44 bar (T_sat ≈ 136,6–138,3 °C): com a condução camisa→parede
              // corrigida (potencial T_camisa − T_parede) a camisa a 3,54 bar (139 °C) empurrava a
              // câmara acima do teto EN 285 (137 °C) no HOLD. ponytail: knob de calibração.
              thermostat: {
                target: 'jacket',
                close_at_Pa: bar_to_Pa(3.44),
                reopen_at_Pa: bar_to_Pa(3.24),
              },
            }),
      },
      V_VAC: {
        from: 'chamber',
        to: 'vacuum',
        // Com vacuum_pump definido, a vazão é a da bomba (curva S(p)); este Cv fica sem uso.
        params: { Cv: 1e-4, gamma: GAMMA_AIR, R: R_AIR },
      },
      V_EXHAUST: {
        from: 'chamber',
        to: 'atmosphere',
        params: { Cv: CV.V_EXHAUST, gamma: GAMMA_AIR, R: R_AIR },
      },
      // Dreno da câmara (M45 no CLP real) é a via de despressurização do programa Delta
      // (câmara -> condensador/atmosfera). No modo virtual só abre se comandada (manual).
      // ponytail: modelado como gás com o Cv da exaustão; o condensado continua saindo pelo
      // drain_kg_per_s passivo.
      V_DRAIN_INT: {
        from: 'chamber',
        to: 'atmosphere',
        params: { Cv: CV.V_DRAIN_INT, gamma: GAMMA_VAP, R: R_VAP },
      },
      V_AIR_IN: {
        from: 'atmosphere',
        to: 'chamber',
        params: { Cv: CV.V_AIR_IN, gamma: GAMMA_AIR, R: R_AIR },
      },
    },
    vacuum_pump: {
      S_nom_m3_per_s: PUMP_DEFAULT.S_nom_m3_h / 3600,
      p_ult_Pa: PUMP_DEFAULT.p_ult_mbar * 100,
      vapor_factor: PUMP_DEFAULT.vapor_factor,
    },
    external: {
      steam_line_pressure: bar_to_Pa(5),
      steam_line_T: C_to_K(160),
      atmosphere_T: C_to_K(23), // knob plant.ambient.T
    },
    jacket_chamber_h_W_per_K: 150,
  };
}

function preheatedInitial(p: SystemParams): SystemState {
  const T_amb = p.external.atmosphere_T;
  const T_hot = C_to_K(138);
  return {
    chamber: {
      m_air: (P_ATM * p.chamber.V) / (R_AIR * T_amb),
      m_vap: 0,
      m_liq: 0,
      T: T_amb,
      T_wall: T_hot,
    },
    jacket: {
      m_air: 0,
      m_vap: 0.047 * (p.jacket.V / CHAMBER_REF.jacket_V),
      m_liq: 0,
      T: T_hot,
      T_wall: T_hot,
    },
    generator: { m_water_liq: 10, m_water_vap: 0.05, T: C_to_K(148) },
    load: buildLoadState(undefined, T_amb),
    f0_minutes: 0,
    time_s: 0,
  };
}

/**
 * Máquina fria: câmara, camisa e carga na T ambiente (external.atmosphere_T) e 1 atm, só com ar.
 * Gerador: por padrão fica QUENTE (estado do preheated, ~4,5 bar) — o CLP real usa fonte de vapor = 1
 * (linha de vapor externa) e nunca liga a resistência; no simulador o gerador faz o papel da linha.
 * generatorCold (fonte 3, gerador próprio): o modelo não tem ar no gerador — com água líquida a
 * pressão é p_sat(T), então gerador frio = 10 kg de água a T ambiente sem vapor (≈ 2,6 kPa abs).
 */
export function coldInitial(p: SystemParams, generatorCold = false): SystemState {
  const T_amb = p.external.atmosphere_T;
  const air = (V: number) => (P_ATM * V) / (R_AIR * T_amb);
  return {
    chamber: { m_air: air(p.chamber.V), m_vap: 0, m_liq: 0, T: T_amb, T_wall: T_amb },
    jacket: { m_air: air(p.jacket.V), m_vap: 0, m_liq: 0, T: T_amb, T_wall: T_amb },
    generator: generatorCold
      ? { m_water_liq: 10, m_water_vap: 0, T: T_amb }
      : preheatedInitial(p).generator,
    load: buildLoadState(undefined, T_amb),
    f0_minutes: 0,
    time_s: 0,
  };
}

export type PlantPreset = 'cold' | 'preheated';

export interface Runtime {
  bridge: ModbusBridge;
  orchestrator: Orchestrator;
  /** Falhas físicas (válvula travada, vapor de rede cortado etc.). Mesma engine do bridge HIL
   *  quando ele tiver uma (CLP real); senão, engine própria do runtime (modo virtual). */
  faults: FaultEngine;
  plc: VirtualPLC | null;
  publisher: SnapshotPublisher;
  cycle_running: boolean;
  cycle_started_at_s: number;
  params: SystemParams;
  timeScale: number;
  controller: { band_low: number; band_high: number };
  cycleOverride: Partial<CycleConfig>;
  effectiveCycle: CycleConfig | null;
  startCycle(cycle: CycleConfig): void;
  stopCycle(): void;
  tick(): Promise<void>;
  resetPlant(preset: PlantPreset, generatorCold?: boolean): void;
  /** Último preset de reset (boot = 'preheated'); mudanças de geometria re-resetam com ele. */
  plantPreset: PlantPreset;
  /** Re-reseta a planta com o último preset (usado após mudar a geometria da câmara). */
  reapplyPlant(): void;
  /** Tipo de porta 1..3 (knob plant.door.tipo); repassado ao bridge do CLP real. */
  doorTipo: 1 | 2 | 3;
  /** Carga dos knobs plant.load.* (T_initial_C = -1, sentinela, segue o ambiente). */
  loadKnobs: {
    material_a: MaterialName;
    mass_a_kg: number;
    material_b: MaterialName;
    mass_b_kg: number;
    T_initial_C: number;
  };
  /** Carga do ciclo: a do ciclo se definida, senão A + B dos knobs; T inicial = T_initial. */
  cycleLoadState(): LoadState;
  /** Condensado do ciclo atual (zerado no início de cada ciclo). */
  condensado: Condensado;
  /** Consumo de vapor do ciclo atual (zerado no início de cada ciclo). */
  vapor: Vapor;
}

const COND_TAU_S = 10; // média móvel da vazão de condensado
const zeroCond = (): Condensado => ({
  agua_carga_g: 0,
  agua_camara_g: 0,
  cond_acum_g: 0,
  evap_acum_g: 0,
  cond_carga_acum_g: 0,
  cond_parede_acum_g: 0,
  dreno_acum_g: 0,
  vazao_g_min: 0,
});
const zeroVapor = (): Vapor => ({
  injetado_camara_kg: 0,
  injetado_camisa_kg: 0,
  injetado_total_kg: 0,
  exaustao_kg: 0,
  vacuo_kg: 0,
  dreno_kg: 0,
  camisa_dreno_kg: 0,
  ar_admitido_kg: 0,
  vazao_camara_kg_h: 0,
  vazao_camisa_kg_h: 0,
  vazao_total_kg_h: 0,
  energia_kwh: 0,
});
/** Referência da energia: água líquida a 25 °C (h = CP_LIQ·T, base do modelo). */
const H_LIQ_25 = CP_LIQ * C_to_K(25);

class RuntimeImpl implements Runtime {
  bridge: ModbusBridge;
  orchestrator: Orchestrator;
  faults: FaultEngine;
  plc: VirtualPLC | null = null;
  publisher = new SnapshotPublisher();
  cycle_running = false;
  cycle_started_at_s = 0;
  params: SystemParams;
  // Default 2: with bootstrap's 100ms wall tick and TICK_DT_S=0.05, 2 ticks/firing = 1× real time. Keep these three in sync.
  private _timeScale = 2;
  get timeScale(): number {
    return this._timeScale;
  }
  set timeScale(v: number) {
    // CLP real roda em tempo real: velocidade travada em 1× (2 ticks/firing).
    if (!REAL_PLC) this._timeScale = v;
  }
  controller = { band_low: 0.1, band_high: 0.5 };
  cycleOverride: Partial<CycleConfig> = {};
  effectiveCycle: CycleConfig | null = null;
  plantPreset: PlantPreset = 'preheated';
  doorTipo: 1 | 2 | 3 = 3;
  loadKnobs: Runtime['loadKnobs'] = {
    material_a: 'STAINLESS_316',
    mass_a_kg: 20,
    material_b: 'COTTON_TEXTILE',
    mass_b_kg: 5,
    T_initial_C: -1,
  };
  private generatorCold = false;
  condensado = zeroCond();
  vapor = zeroVapor();

  constructor() {
    this.bridge = REAL_PLC ? DeltaPlcBridge.fromEnv() : new VirtualEsp32Bridge();
    // CLP real inicia o ciclo: carga nova, fria (operador carregou material novo).
    if (this.bridge instanceof DeltaPlcBridge) {
      this.bridge.drainProbe_C = () => this.orchestrator.drain.value_C;
      this.bridge.onCycleStart = () => {
        this.cycle_started_at_s = this.orchestrator.getState().time_s;
        this.orchestrator.setLoadState(this.cycleLoadState());
        this.condensado = zeroCond();
        this.vapor = zeroVapor();
      };
    }
    this.faults = hasFaultEngine(this.bridge) ? this.bridge.faultEngine : new FaultEngine();
    this.params = defaultParams();
    const initial = preheatedInitial(this.params);
    this.orchestrator = new Orchestrator({
      bridge: this.bridge,
      params: this.params,
      initialState: initial,
      tickDt_s: TICK_DT_S,
      faults: this.faults,
    });
    void this.bridge.connect();
    // Apply the versioned factory baseline, then persisted overrides on top. Safe: no
    // MVP knob feeds the initial state (preheatedInitial reads only chamber.V, not a knob).
    try {
      applyFactory(this);
      applyOverrides(this);
    } catch (err) {
      console.error('failed to apply knob overrides:', err);
    }
    // Histórico de ciclos (apps/web/ciclos/): parciais de um boot anterior viram 'interrompido'.
    try {
      marcarOrfaos();
    } catch (err) {
      console.error('ciclos: falha marcando órfãos:', err);
    }
    const recorder = new CycleRecorder(this);
    this.publisher.subscribe((snap) => recorder.onSnapshot(snap));
  }

  startCycle(cycle: CycleConfig): void {
    const merged: CycleConfig = { ...cycle, ...this.cycleOverride };
    this.effectiveCycle = merged;
    // Com CLP real quem decide é ele; o simulador só roda a física.
    if (!REAL_PLC) {
      this.plc = new VirtualPLC(merged, this.bridge);
      this.plc.start();
    }
    this.cycle_running = true;
    this.cycle_started_at_s = this.orchestrator.getState().time_s;
    this.orchestrator.setLoadState(this.cycleLoadState());
    this.condensado = zeroCond();
    this.vapor = zeroVapor();
  }

  cycleLoadState(): LoadState {
    const k = this.loadKnobs;
    const T0 = k.T_initial_C === -1 ? this.params.external.atmosphere_T : C_to_K(k.T_initial_C);
    // zod's optional() widens props to `| undefined`; exactOptionalPropertyTypes
    // rejects that against LoadItemConfig. Runtime-identical — cast.
    const own = this.effectiveCycle?.load as LoadItemConfig[] | undefined;
    if (own && own.length > 0) return buildLoadState(own, T0);
    const items: LoadItemConfig[] = [
      { name: 'carga A', material: k.material_a, mass_kg: k.mass_a_kg },
    ];
    if (k.mass_b_kg > 0)
      items.push({ name: 'carga B', material: k.material_b, mass_kg: k.mass_b_kg, witness: true });
    else items[0]!.witness = true;
    return buildLoadState(items, T0);
  }

  stopCycle(): void {
    this.plc = null;
    this.cycle_running = false;
    void this.bridge.writeDiscreteInputs(0x0000, new Array(13).fill(false));
  }

  /** Reseta a planta simulada. Virtual: para o ciclo antes. CLP real: o ciclo é dele, só avisa. */
  resetPlant(preset: PlantPreset, generatorCold = false): void {
    this.plantPreset = preset;
    this.generatorCold = generatorCold;
    if (this.bridge instanceof DeltaPlcBridge) {
      if (this.bridge.fase !== 0)
        console.warn(`resetPlant(${preset}) com o CLP em fase ${this.bridge.fase}`);
      this.bridge.resetPt100Filter();
    } else if (this.cycle_running) {
      this.stopCycle();
    }
    // time_s continua (gráficos/ciclo não voltam no tempo); o resto vem do preset.
    const time_s = this.orchestrator.getState().time_s;
    const s =
      preset === 'cold' ? coldInitial(this.params, generatorCold) : preheatedInitial(this.params);
    this.orchestrator.setState({ ...s, time_s, load: this.cycleLoadState() });
  }

  reapplyPlant(): void {
    this.resetPlant(this.plantPreset, this.generatorCold);
  }

  async tick(): Promise<void> {
    const t = this.orchestrator.getState().time_s;
    if (this.plc) {
      await this.plc.tick(t, this.controller);
    }
    // Abertura efetiva das portas (0..2) p/ a física; sem portas (modo virtual) = fechada.
    this.params.door_open =
      this.bridge instanceof DeltaPlcBridge ? this.bridge.door.C + this.bridge.door.D : 0;
    await this.orchestrator.tick();
    const st = this.orchestrator.getState();
    const condLoad = (st.cond_load_kg ?? 0) * 1000;
    const condWall = (st.cond_wall_kg ?? 0) * 1000;
    const evap = ((st.evap_load_kg ?? 0) + (st.evap_wall_kg ?? 0)) * 1000;
    const c = this.condensado;
    c.agua_carga_g = st.load.nodes.reduce((a, n) => a + n.m_water, 0) * 1000;
    c.agua_camara_g = st.chamber.m_liq * 1000;
    c.cond_carga_acum_g += condLoad;
    c.cond_parede_acum_g += condWall;
    c.cond_acum_g += condLoad + condWall;
    c.evap_acum_g += evap;
    c.dreno_acum_g += (st.drain_kg ?? 0) * 1000;
    const taxa = ((condLoad + condWall - evap) / TICK_DT_S) * 60;
    c.vazao_g_min += (taxa - c.vazao_g_min) * (TICK_DT_S / COND_TAU_S);
    const f = st.flows;
    if (f) {
      const v = this.vapor;
      const ema = (y: number, kg: number) => y + ((kg / TICK_DT_S) * 3600 - y) * (TICK_DT_S / COND_TAU_S);
      const inj = f.steam_in_chamber_kg + f.steam_in_jacket_kg;
      v.injetado_camara_kg += f.steam_in_chamber_kg;
      v.injetado_camisa_kg += f.steam_in_jacket_kg;
      v.injetado_total_kg += inj;
      v.exaustao_kg += f.exhaust_air_kg + f.exhaust_vap_kg;
      v.vacuo_kg += f.vacuum_air_kg + f.vacuum_vap_kg;
      v.dreno_kg += st.drain_kg ?? 0;
      v.camisa_dreno_kg += f.jacket_cond_kg;
      v.ar_admitido_kg += f.air_in_kg;
      v.vazao_camara_kg_h = ema(v.vazao_camara_kg_h, f.steam_in_chamber_kg);
      v.vazao_camisa_kg_h = ema(v.vazao_camisa_kg_h, f.steam_in_jacket_kg);
      v.vazao_total_kg_h = ema(v.vazao_total_kg_h, inj);
      v.energia_kwh += (f.steam_in_H_J - inj * H_LIQ_25) / 3.6e6;
    }
    if (this.bridge instanceof DeltaPlcBridge) this.cycle_running = this.bridge.fase !== 0;
    const phase = this.plc ? this.plc.getPhase() : 'IDLE';
    const { valves, actuators } = await readCommands(this.bridge, this.faults);
    const delta = this.bridge instanceof DeltaPlcBridge ? this.bridge : null;
    const snap = buildSnapshot({
      state: this.orchestrator.getState(),
      params: this.params,
      cycle_running: this.cycle_running,
      cycle_phase: phase,
      cycle_elapsed_s: this.cycle_running
        ? this.orchestrator.getState().time_s - this.cycle_started_at_s
        : 0,
      valves: valves as Record<string, boolean>,
      drain_C: this.orchestrator.drain.value_C,
      actuators: { PUMP_VAC: actuators.pump_vac, HEATER_GEN: actuators.heater_gen },
      faults_active: this.faults.list(),
      condensado: this.condensado,
      vapor: this.vapor,
      ...(delta && {
        plc_outputs: delta.outputs,
        plc_phase: delta.fase,
        doors: { C: delta.doorState('C'), D: delta.doorState('D') },
      }),
    });
    this.publisher.publish(snap);
    // Freeze the cycle once it completes: otherwise cycle_running stays true and the
    // integrator keeps running the COMPLETE plateau forever (elapsed + F0 runaway).
    if (this.cycle_running && phase === 'COMPLETE') this.stopCycle();
  }
}

// Singleton via globalThis (survives Next.js HMR in dev)
declare global {
  var __SIM_RUNTIME__: Runtime | undefined; // eslint-disable-line no-var
}

export function getRuntime(): Runtime {
  if (!globalThis.__SIM_RUNTIME__) {
    globalThis.__SIM_RUNTIME__ = new RuntimeImpl();
    // CLP real: cria o serviço do simulador de erros já no boot, pra ele restaurar setup
    // temporário deixado pendente se o servidor caiu no meio de um cenário. Import dinâmico:
    // service.ts importa este arquivo (ciclo).
    if (REAL_PLC) {
      void import('../erros/service.js')
        .then((m) => m.getErrosService())
        .catch((err) => console.error('erros: falha criando serviço no boot:', err));
    }
  }
  return globalThis.__SIM_RUNTIME__;
}

export function resetRuntime(): void {
  globalThis.__SIM_RUNTIME__ = undefined;
}
