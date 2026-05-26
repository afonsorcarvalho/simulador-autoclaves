import type { ModbusBridge } from '../bridge/bridge.js';
import { RegisterAccess } from '../bridge/register-access.js';
import type { SystemState, SystemParams } from '@sim/physics';
import { chamber_pressure, generator_pressure, K_to_C, Pa_to_bar } from '@sim/physics';

/** Steam line "OK" threshold (bar abs). Above this, pressure switch reports true. */
const PS_STEAM_THRESHOLD_BAR = 3.0;
/** Generator water level min threshold (kg). */
const LVL_GEN_MIN_KG = 1.0;
/** Generator water level max threshold (kg). */
const LVL_GEN_MAX_KG = 25.0;

export async function publishSensors(
  bridge: ModbusBridge,
  state: SystemState,
  params: SystemParams,
): Promise<void> {
  const access = new RegisterAccess(bridge);

  // Pressures
  const pc = chamber_pressure(state.chamber, params.chamber);
  const pj = chamber_pressure(state.jacket, params.jacket);
  const pg = state.generator && params.generator
    ? generator_pressure(state.generator, params.generator)
    : 0;
  await access.setAnalog('P_CHAMBER_INT', Pa_to_bar(pc.p_total));
  await access.setAnalog('P_CHAMBER_EXT', Pa_to_bar(pj.p_total));
  await access.setAnalog('P_GENERATOR', Pa_to_bar(pg));

  // Temperatures
  await access.setAnalog('T_CHAMBER_INT', K_to_C(state.chamber.T));
  await access.setAnalog('T_TESTEMUNHO', K_to_C(state.load.T_fabric));
  await access.setAnalog('T_CHAMBER_EXT', K_to_C(state.jacket.T));
  await access.setAnalog('T_GENERATOR', state.generator ? K_to_C(state.generator.T) : 0);

  // F0 × 10
  await access.setAnalog('F0_X10', state.f0_minutes * 10);

  // Pressure switches (Coils)
  const steamLineOk = Pa_to_bar(params.external.steam_line_pressure) >= PS_STEAM_THRESHOLD_BAR;
  await access.setCoil('PS_STEAM_LINE', steamLineOk);
  await access.setCoil('PS_AIR_LINE', false);  // no compressed air supply modeled yet
  await access.setCoil('PS_SEAL_CLEAN', true);   // assume seals always pressurized
  await access.setCoil('PS_SEAL_STERILE', true);

  // Door limit switches: always healthy (closed) for now
  await access.setCoil('LS_DOOR_CLEAN_OPEN', false);
  await access.setCoil('LS_DOOR_CLEAN_CLOSED', true);
  await access.setCoil('LS_DOOR_STERILE_OPEN', false);
  await access.setCoil('LS_DOOR_STERILE_CLOSED', true);

  // Generator water level switches
  if (state.generator) {
    await access.setCoil('LVL_GEN_MIN', state.generator.m_water_liq > LVL_GEN_MIN_KG);
    await access.setCoil('LVL_GEN_MAX', state.generator.m_water_liq > LVL_GEN_MAX_KG);
  } else {
    await access.setCoil('LVL_GEN_MIN', false);
    await access.setCoil('LVL_GEN_MAX', false);
  }

  // Emergency button: false (not pressed)
  await access.setCoil('EMERGENCY_BTN', false);
}
