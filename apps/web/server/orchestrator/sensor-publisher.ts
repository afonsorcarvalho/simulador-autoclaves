import type { ModbusBridge } from '../bridge/bridge.js';
import { RegisterAccess } from '../bridge/register-access.js';
import type { SystemState, SystemParams } from '@sim/physics';
import {
  chamber_pressure,
  generator_pressure,
  generator_capacity_kg,
  LVL_GEN_MIN_FRAC,
  LVL_GEN_MAX_FRAC,
  K_to_C,
  Pa_to_bar,
} from '@sim/physics';

/** Steam line "OK" threshold (bar abs). Above this, pressure switch reports true. */
const PS_STEAM_THRESHOLD_BAR = 3.0;
/** Meia-faixa de histerese dos eletrodos de nível do gerador (kg de água): o sensor liga acima de
 *  limiar+H e só desliga abaixo de limiar−H. Sem isso a água no limiar faz o contato bater a cada
 *  passo e o CLP liga/desliga bomba e resistência em rajada.
 *  ponytail: banda fixa; vira knob se precisar calibrar contra o eletrodo real. */
export const LVL_GEN_HYST_KG = 0.3;

/** Limiares dos eletrodos de nível (kg), derivados da capacidade real do gerador (V_total) e das
 *  frações MIN/MAX únicas (@sim/physics) — as mesmas que o desenho do gerador usa (GeneratorView). */
export function lvlGenThresholdsKg(V_total_m3: number): { min: number; max: number } {
  const cap = generator_capacity_kg(V_total_m3);
  return { min: cap * LVL_GEN_MIN_FRAC, max: cap * LVL_GEN_MAX_FRAC };
}

/** Liga/desliga com histerese em torno de `limiar`. */
export function comHisterese(anterior: boolean, valor: number, limiar: number, h = LVL_GEN_HYST_KG): boolean {
  if (anterior) return valor > limiar - h;
  return valor > limiar + h;
}

export async function publishSensors(
  bridge: ModbusBridge,
  state: SystemState,
  params: SystemParams,
): Promise<void> {
  const access = new RegisterAccess(bridge);

  // Pressures
  const pc = chamber_pressure(state.chamber, params.chamber);
  const pj = chamber_pressure(state.jacket, params.jacket);
  const pg =
    state.generator && params.generator ? generator_pressure(state.generator, params.generator) : 0;
  await access.setAnalog('P_CHAMBER_INT', Pa_to_bar(pc.p_total));
  await access.setAnalog('P_CHAMBER_EXT', Pa_to_bar(pj.p_total));
  await access.setAnalog('P_GENERATOR', Pa_to_bar(pg));

  // Temperatures
  await access.setAnalog('T_CHAMBER_INT', K_to_C(state.chamber.T));
  await access.setAnalog(
    'T_TESTEMUNHO',
    K_to_C((state.load.nodes.find((n) => n.isWitness) ?? state.load.nodes[0])!.T),
  );
  await access.setAnalog('T_CHAMBER_EXT', K_to_C(state.jacket.T));
  await access.setAnalog('T_GENERATOR', state.generator ? K_to_C(state.generator.T) : 0);

  // F0 (register scale ×10 applied by RegisterAccess)
  await access.setAnalog('F0_X10', state.f0_minutes);

  // Pressure switches (Coils)
  const steamLineOk = Pa_to_bar(params.external.steam_line_pressure) >= PS_STEAM_THRESHOLD_BAR;
  await access.setCoil('PS_STEAM_LINE', steamLineOk);
  await access.setCoil('PS_AIR_LINE', false); // no compressed air supply modeled yet
  await access.setCoil('PS_SEAL_CLEAN', true); // assume seals always pressurized
  await access.setCoil('PS_SEAL_STERILE', true);

  // Door limit switches: always healthy (closed) for now
  await access.setCoil('LS_DOOR_CLEAN_OPEN', false);
  await access.setCoil('LS_DOOR_CLEAN_CLOSED', true);
  await access.setCoil('LS_DOOR_STERILE_OPEN', false);
  await access.setCoil('LS_DOOR_STERILE_CLOSED', true);

  // Generator water level switches
  if (state.generator && params.generator) {
    const m = state.generator.m_water_liq;
    const { min, max } = lvlGenThresholdsKg(params.generator.V_total);
    await access.setCoil('LVL_GEN_MIN', comHisterese(await access.getCoil('LVL_GEN_MIN'), m, min));
    await access.setCoil('LVL_GEN_MAX', comHisterese(await access.getCoil('LVL_GEN_MAX'), m, max));
  } else {
    await access.setCoil('LVL_GEN_MIN', false);
    await access.setCoil('LVL_GEN_MAX', false);
  }

  // Emergency button: false (not pressed)
  await access.setCoil('EMERGENCY_BTN', false);
}
