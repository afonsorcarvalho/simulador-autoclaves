// AUTO-GENERATED from packages/protocol/registers.yaml — DO NOT EDIT.
// Run `pnpm generate` to regenerate. CI fails on drift.

export const SPACES = {
  discrete_inputs: { base: 0x0000, end: 0x0fff },
  coils: { base: 0x1000, end: 0x1fff },
  input_registers: { base: 0x2000, end: 0x2fff },
  holding_registers: { base: 0x3000, end: 0x3fff },
  diagnostics: { base: 0x4000, end: 0x4fff },
} as const;

export const REGISTERS = {
  V_STEAM_IN_INT: { space: 'discrete_inputs', address: 0x0000 },
  V_STEAM_IN_JACKET: { space: 'discrete_inputs', address: 0x0001 },
  V_AIR_IN: { space: 'discrete_inputs', address: 0x0002 },
  V_VAC: { space: 'discrete_inputs', address: 0x0003 },
  V_EXHAUST: { space: 'discrete_inputs', address: 0x0004 },
  V_DRAIN_INT: { space: 'discrete_inputs', address: 0x0005 },
  V_DRAIN_JACKET: { space: 'discrete_inputs', address: 0x0006 },
  V_SEAL_CLEAN: { space: 'discrete_inputs', address: 0x0007 },
  V_SEAL_STERILE: { space: 'discrete_inputs', address: 0x0008 },
  V_GEN_WATER_IN: { space: 'discrete_inputs', address: 0x0009 },
  PUMP_VAC: { space: 'discrete_inputs', address: 0x000a },
  HEATER_GEN: { space: 'discrete_inputs', address: 0x000b },
  COMPRESSOR: { space: 'discrete_inputs', address: 0x000c },
  PS_STEAM_LINE: { space: 'coils', address: 0x1000 },
  PS_AIR_LINE: { space: 'coils', address: 0x1001 },
  PS_SEAL_CLEAN: { space: 'coils', address: 0x1002 },
  PS_SEAL_STERILE: { space: 'coils', address: 0x1003 },
  LS_DOOR_CLEAN_OPEN: { space: 'coils', address: 0x1004 },
  LS_DOOR_CLEAN_CLOSED: { space: 'coils', address: 0x1005 },
  LS_DOOR_STERILE_OPEN: { space: 'coils', address: 0x1006 },
  LS_DOOR_STERILE_CLOSED: { space: 'coils', address: 0x1007 },
  LVL_GEN_MIN: { space: 'coils', address: 0x1008 },
  LVL_GEN_MAX: { space: 'coils', address: 0x1009 },
  EMERGENCY_BTN: { space: 'coils', address: 0x100a },
  P_CHAMBER_INT: { space: 'holding_registers', address: 0x3000, scale: 1000, unit: 'bar_abs', range: [-1, 5] as const },
  P_CHAMBER_EXT: { space: 'holding_registers', address: 0x3001, scale: 1000, unit: 'bar_abs', range: [0, 5] as const },
  P_GENERATOR: { space: 'holding_registers', address: 0x3002, scale: 1000, unit: 'bar_abs', range: [0, 6] as const },
  T_CHAMBER_INT: { space: 'holding_registers', address: 0x3010, scale: 100, unit: 'celsius', range: [-50, 200] as const },
  T_TESTEMUNHO: { space: 'holding_registers', address: 0x3011, scale: 100, unit: 'celsius', range: [-50, 200] as const },
  T_CHAMBER_EXT: { space: 'holding_registers', address: 0x3012, scale: 100, unit: 'celsius', range: [-50, 200] as const },
  T_GENERATOR: { space: 'holding_registers', address: 0x3013, scale: 100, unit: 'celsius', range: [0, 200] as const },
  MODEL_TICK_LOW: { space: 'diagnostics', address: 0x4000, type: 'uint16' },
  MODEL_TICK_HIGH: { space: 'diagnostics', address: 0x4001, type: 'uint16' },
  WATCHDOG_MS: { space: 'diagnostics', address: 0x4002, type: 'uint16' },
  F0_X10: { space: 'diagnostics', address: 0x4003, type: 'uint16' },
  SIM_TIME_SCALE: { space: 'diagnostics', address: 0x4020, type: 'uint16' },
  EQUIPMENT_ID: { space: 'diagnostics', address: 0x4030, type: 'uint16' },
} as const;

export type RegisterId = 'V_STEAM_IN_INT' | 'V_STEAM_IN_JACKET' | 'V_AIR_IN' | 'V_VAC' | 'V_EXHAUST' | 'V_DRAIN_INT' | 'V_DRAIN_JACKET' | 'V_SEAL_CLEAN' | 'V_SEAL_STERILE' | 'V_GEN_WATER_IN' | 'PUMP_VAC' | 'HEATER_GEN' | 'COMPRESSOR' | 'PS_STEAM_LINE' | 'PS_AIR_LINE' | 'PS_SEAL_CLEAN' | 'PS_SEAL_STERILE' | 'LS_DOOR_CLEAN_OPEN' | 'LS_DOOR_CLEAN_CLOSED' | 'LS_DOOR_STERILE_OPEN' | 'LS_DOOR_STERILE_CLOSED' | 'LVL_GEN_MIN' | 'LVL_GEN_MAX' | 'EMERGENCY_BTN' | 'P_CHAMBER_INT' | 'P_CHAMBER_EXT' | 'P_GENERATOR' | 'T_CHAMBER_INT' | 'T_TESTEMUNHO' | 'T_CHAMBER_EXT' | 'T_GENERATOR' | 'MODEL_TICK_LOW' | 'MODEL_TICK_HIGH' | 'WATCHDOG_MS' | 'F0_X10' | 'SIM_TIME_SCALE' | 'EQUIPMENT_ID';
