import { bar_to_Pa } from '@sim/physics';
import type { Runtime } from '../runtime/singleton.js';

export type KnobFamily = 'cycle' | 'plant' | 'controller' | 'time';

export interface KnobDescriptor {
  id: string;
  family: KnobFamily;
  label: string;
  unit: string;
  default: number;
  min: number;
  max: number;
  step?: number;
  timing: 'live' | 'precycle';
  get(rt: Runtime): number;
  set(rt: Runtime, v: number): void;
}

/** Serializable view (no functions) for the API/UI. */
export type KnobMeta = Omit<KnobDescriptor, 'get' | 'set'>;

const PA_PER_BAR = bar_to_Pa(1);

export const KNOBS: KnobDescriptor[] = [
  // ---- CYCLE (precycle: written into runtime.cycleOverride, merged at startCycle) ----
  {
    id: 'cycle.sterilization_T',
    family: 'cycle',
    label: 'Setpoint esterilização',
    unit: '°C',
    default: 134,
    min: 100,
    max: 140,
    step: 0.5,
    timing: 'precycle',
    get: (rt) => rt.cycleOverride.sterilization_T_C ?? 134,
    set: (rt, v) => {
      rt.cycleOverride.sterilization_T_C = v;
    },
  },
  {
    id: 'cycle.hold_duration',
    family: 'cycle',
    label: 'Duração hold',
    unit: 's',
    default: 420,
    min: 0,
    max: 3600,
    step: 10,
    timing: 'precycle',
    get: (rt) => rt.cycleOverride.hold_duration_s ?? 420,
    set: (rt, v) => {
      rt.cycleOverride.hold_duration_s = v;
    },
  },
  {
    id: 'cycle.prevac_pulses',
    family: 'cycle',
    label: 'Pulsos prevac',
    unit: '',
    default: 3,
    min: 0,
    max: 6,
    step: 1,
    timing: 'precycle',
    get: (rt) => rt.cycleOverride.prevac_pulses ?? 3,
    set: (rt, v) => {
      rt.cycleOverride.prevac_pulses = Math.round(v);
    },
  },
  {
    id: 'cycle.prevac_vacuum_target',
    family: 'cycle',
    label: 'Alvo vácuo prevac',
    unit: 'bar',
    default: 0.15,
    min: 0.05,
    max: 1,
    step: 0.01,
    timing: 'precycle',
    get: (rt) => rt.cycleOverride.prevac_vacuum_target_bar ?? 0.15,
    set: (rt, v) => {
      rt.cycleOverride.prevac_vacuum_target_bar = v;
    },
  },
  {
    id: 'cycle.prevac_steam_target',
    family: 'cycle',
    label: 'Alvo vapor prevac',
    unit: 'bar',
    default: 2.0,
    min: 1,
    max: 3.5,
    step: 0.05,
    timing: 'precycle',
    get: (rt) => rt.cycleOverride.prevac_steam_target_bar ?? 2.0,
    set: (rt, v) => {
      rt.cycleOverride.prevac_steam_target_bar = v;
    },
  },
  {
    id: 'cycle.dry_duration',
    family: 'cycle',
    label: 'Duração secagem',
    unit: 's',
    default: 500,
    min: 0,
    max: 3600,
    step: 10,
    timing: 'precycle',
    get: (rt) => rt.cycleOverride.dry_duration_s ?? 500,
    set: (rt, v) => {
      rt.cycleOverride.dry_duration_s = v;
    },
  },

  // ---- PLANT (live: mutate rt.params in place; Orchestrator reads the ref each tick) ----
  {
    id: 'plant.chamber.relief',
    family: 'plant',
    label: 'Teto alívio câmara',
    unit: 'bar',
    default: 3.25,
    min: 2.5,
    max: 4,
    step: 0.05,
    timing: 'live',
    get: (rt) => rt.params.chamber.relief_pressure_Pa! / PA_PER_BAR,
    set: (rt, v) => {
      rt.params.chamber.relief_pressure_Pa = bar_to_Pa(v);
    },
  },
  {
    id: 'plant.chamber.h_ambient',
    family: 'plant',
    label: 'Perda ambiente câmara',
    unit: 'W/K',
    default: 10,
    min: 0,
    max: 100,
    step: 1,
    timing: 'live',
    get: (rt) => rt.params.chamber.h_ambient_W_per_K ?? 10,
    set: (rt, v) => {
      rt.params.chamber.h_ambient_W_per_K = v;
    },
  },
  {
    id: 'plant.chamber.drain',
    family: 'plant',
    label: 'Dreno condensado câmara',
    unit: 'kg/s',
    default: 2e-5,
    min: 0,
    max: 1e-3,
    step: 1e-6,
    timing: 'live',
    get: (rt) => rt.params.chamber.drain_kg_per_s ?? 2e-5,
    set: (rt, v) => {
      rt.params.chamber.drain_kg_per_s = v;
    },
  },
  {
    id: 'plant.generator.heater_power',
    family: 'plant',
    label: 'Potência aquecedor gerador',
    unit: 'W',
    default: 36000,
    min: 0,
    max: 60000,
    step: 1000,
    timing: 'live',
    get: (rt) => rt.params.generator!.heater_power_W,
    set: (rt, v) => {
      rt.params.generator!.heater_power_W = v;
    },
  },
  {
    id: 'plant.valve.steam_in_int_cv',
    family: 'plant',
    label: 'Cv vapor câmara (V_STEAM_IN_INT)',
    unit: 'm²',
    default: 8e-6,
    min: 1e-6,
    max: 5e-5,
    step: 1e-6,
    timing: 'live',
    get: (rt) => rt.params.valves.V_STEAM_IN_INT!.params.Cv,
    set: (rt, v) => {
      rt.params.valves.V_STEAM_IN_INT!.params.Cv = v;
    },
  },
  {
    id: 'plant.valve.vac_cv',
    family: 'plant',
    label: 'Cv vácuo (V_VAC)',
    unit: 'm²',
    default: 1e-4,
    min: 1e-5,
    max: 5e-4,
    step: 1e-5,
    timing: 'live',
    get: (rt) => rt.params.valves.V_VAC!.params.Cv,
    set: (rt, v) => {
      rt.params.valves.V_VAC!.params.Cv = v;
    },
  },
  {
    id: 'plant.valve.exhaust_cv',
    family: 'plant',
    label: 'Cv exaustão (V_EXHAUST)',
    unit: 'm²',
    default: 2e-5,
    min: 1e-6,
    max: 2e-4,
    step: 1e-6,
    timing: 'live',
    get: (rt) => rt.params.valves.V_EXHAUST!.params.Cv,
    set: (rt, v) => {
      rt.params.valves.V_EXHAUST!.params.Cv = v;
    },
  },

  // ---- CONTROLLER (live: reference bang-bang bands) ----
  {
    id: 'controller.band_low',
    family: 'controller',
    label: 'Banda baixa (abrir < SP+)',
    unit: '°C',
    default: 0.1,
    min: 0,
    max: 2,
    step: 0.05,
    timing: 'live',
    get: (rt) => rt.controller.band_low,
    set: (rt, v) => {
      rt.controller.band_low = v;
    },
  },
  {
    id: 'controller.band_high',
    family: 'controller',
    label: 'Banda alta (fechar > SP+)',
    unit: '°C',
    default: 0.5,
    min: 0,
    max: 3,
    step: 0.05,
    timing: 'live',
    get: (rt) => rt.controller.band_high,
    set: (rt, v) => {
      rt.controller.band_high = v;
    },
  },

  // ---- TIME ----
  {
    id: 'time.scale',
    family: 'time',
    label: 'Velocidade simulação (ticks/firing)',
    unit: '×',
    default: 2,
    min: 1,
    max: 50,
    step: 1,
    timing: 'live',
    get: (rt) => rt.timeScale,
    set: (rt, v) => {
      rt.timeScale = Math.max(1, Math.round(v));
    },
  },
];

export function knobById(id: string): KnobDescriptor | undefined {
  return KNOBS.find((k) => k.id === id);
}

export function knobMeta(): KnobMeta[] {
  return KNOBS.map(({ get: _g, set: _s, ...meta }) => meta);
}
