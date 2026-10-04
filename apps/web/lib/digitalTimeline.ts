import type { Snapshot } from '../server/runtime/snapshot';

/** Trecho constante de um sinal: [from, to] em cycle_elapsed_s. */
export interface Segment<T> {
  from: number;
  to: number;
  v: T;
}

/** Run-length encode: uma entrada por mudança de valor, não por amostra. O último trecho vai até a última amostra. */
export function segments<T>(history: readonly Snapshot[], get: (s: Snapshot) => T): Segment<T>[] {
  const out: Segment<T>[] = [];
  for (const s of history) {
    const v = get(s);
    const last = out[out.length - 1];
    if (last) last.to = s.cycle_elapsed_s;
    if (!last || last.v !== v) out.push({ from: s.cycle_elapsed_s, to: s.cycle_elapsed_s, v });
  }
  return out;
}

export interface DigitalSignal {
  id: string;
  label: string;
  /** Válvula principal do processo: aparece mesmo sem mudar. */
  main?: boolean;
  get: (s: Snapshot) => boolean | undefined;
}

const valve = (id: string, label: string, main = false): DigitalSignal => ({
  id,
  label,
  main,
  get: (s) => s.valves[id],
});
const actuator = (id: string, label: string, main = false): DigitalSignal => ({
  id,
  label,
  main,
  get: (s) => s.actuators?.[id],
});
const plc = (id: string, label: string): DigitalSignal => ({
  id: `PLC:${id}`,
  label: `CLP: ${label}`,
  get: (s) => s.plc_outputs?.[id],
});

export const DIGITAL_SIGNALS: DigitalSignal[] = [
  valve('V_STEAM_IN_INT', 'Vapor câmara', true),
  valve('V_STEAM_IN_JACKET', 'Vapor camisa', true),
  valve('V_AIR_IN', 'Ar filtrado', true),
  valve('V_VAC', 'Vácuo (válvula)', true),
  actuator('PUMP_VAC', 'Bomba de vácuo', true),
  valve('V_EXHAUST', 'Exaustão lenta', true),
  valve('V_DRAIN_INT', 'Dreno câmara', true),
  valve('V_DRAIN_JACKET', 'Dreno camisa'),
  valve('V_SEAL_CLEAN', 'Guarnição lado limpo'),
  valve('V_SEAL_STERILE', 'Guarnição lado estéril'),
  valve('V_GEN_WATER_IN', 'Água gerador'),
  actuator('HEATER_GEN', 'Resistência gerador'),
  plc('OUT_VALV_AGUA_SELO', 'Água selo bomba'),
  plc('OUT_GUARN_VAC_C', 'Vácuo guarnição C'),
  plc('OUT_GUARN_VAC_D', 'Vácuo guarnição D'),
  plc('OUT_PORTA_ABRIR_C', 'Abrir porta C'),
  plc('OUT_PORTA_FECHAR_C', 'Fechar porta C'),
  plc('OUT_PORTA_ABRIR_D', 'Abrir porta D'),
  plc('OUT_PORTA_FECHAR_D', 'Fechar porta D'),
  plc('OUT_ALARME_SONORO', 'Alarme sonoro'),
];

export const PLC_PHASES = [
  'OCIOSO',
  'INICIANDO',
  'LEAK TEST',
  'PRÉ-VÁCUO',
  'AQUECIMENTO',
  'HOMOGENEIZAÇÃO',
  'ESTERILIZAÇÃO',
  'DESPRESSURIZAÇÃO',
  'SECAGEM',
  'HIPERVENTILAÇÃO',
  'FINALIZADO',
  'ABORTADO',
];

export interface Lane {
  signal: DigitalSignal;
  on: Segment<boolean>[];
  toggled: boolean;
}

/** Uma faixa por sinal presente no histórico; só os trechos ON são guardados. */
export function buildLanes(history: readonly Snapshot[], showAll: boolean): Lane[] {
  const lanes: Lane[] = [];
  for (const signal of DIGITAL_SIGNALS) {
    if (!history.some((s) => signal.get(s) !== undefined)) continue;
    const segs = segments(history, (s) => signal.get(s) ?? false);
    const toggled = segs.length > 1;
    if (showAll || toggled || signal.main)
      lanes.push({ signal, on: segs.filter((g) => g.v), toggled });
  }
  return lanes;
}
