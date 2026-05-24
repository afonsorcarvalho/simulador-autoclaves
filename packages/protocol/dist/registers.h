// AUTO-GENERATED from packages/protocol/registers.yaml — DO NOT EDIT.
// Run `pnpm generate` to regenerate. CI fails on drift.

#pragma once

// Modbus address space codes
#define MB_SPACE_COILS 0
#define MB_SPACE_DISCRETE_INPUTS 1
#define MB_SPACE_INPUT_REGISTERS 2
#define MB_SPACE_HOLDING_REGISTERS 3
#define MB_SPACE_DIAGNOSTICS 4

// Register definitions
// V_STEAM_IN_INT — Steam inlet valve, internal chamber
#define REG_V_STEAM_IN_INT_ADDR  0x0000
#define REG_V_STEAM_IN_INT_SPACE MB_SPACE_DISCRETE_INPUTS

// V_STEAM_IN_JACKET — Steam inlet valve, jacket
#define REG_V_STEAM_IN_JACKET_ADDR  0x0001
#define REG_V_STEAM_IN_JACKET_SPACE MB_SPACE_DISCRETE_INPUTS

// V_AIR_IN — Air admission valve (HEPA filtered, post-cycle)
#define REG_V_AIR_IN_ADDR  0x0002
#define REG_V_AIR_IN_SPACE MB_SPACE_DISCRETE_INPUTS

// V_VAC — Vacuum line valve
#define REG_V_VAC_ADDR  0x0003
#define REG_V_VAC_SPACE MB_SPACE_DISCRETE_INPUTS

// V_EXHAUST — Chamber exhaust valve
#define REG_V_EXHAUST_ADDR  0x0004
#define REG_V_EXHAUST_SPACE MB_SPACE_DISCRETE_INPUTS

// V_DRAIN_INT — Internal chamber drain (condensate)
#define REG_V_DRAIN_INT_ADDR  0x0005
#define REG_V_DRAIN_INT_SPACE MB_SPACE_DISCRETE_INPUTS

// V_DRAIN_JACKET — Jacket drain (condensate)
#define REG_V_DRAIN_JACKET_ADDR  0x0006
#define REG_V_DRAIN_JACKET_SPACE MB_SPACE_DISCRETE_INPUTS

// V_SEAL_CLEAN — Door seal pressurization, clean side
#define REG_V_SEAL_CLEAN_ADDR  0x0007
#define REG_V_SEAL_CLEAN_SPACE MB_SPACE_DISCRETE_INPUTS

// V_SEAL_STERILE — Door seal pressurization, sterile side
#define REG_V_SEAL_STERILE_ADDR  0x0008
#define REG_V_SEAL_STERILE_SPACE MB_SPACE_DISCRETE_INPUTS

// V_GEN_WATER_IN — Generator make-up water valve
#define REG_V_GEN_WATER_IN_ADDR  0x0009
#define REG_V_GEN_WATER_IN_SPACE MB_SPACE_DISCRETE_INPUTS

// PUMP_VAC — Vacuum pump relay
#define REG_PUMP_VAC_ADDR  0x000A
#define REG_PUMP_VAC_SPACE MB_SPACE_DISCRETE_INPUTS

// HEATER_GEN — Generator heater (electric resistance) relay
#define REG_HEATER_GEN_ADDR  0x000B
#define REG_HEATER_GEN_SPACE MB_SPACE_DISCRETE_INPUTS

// COMPRESSOR — Air compressor relay (if present)
#define REG_COMPRESSOR_ADDR  0x000C
#define REG_COMPRESSOR_SPACE MB_SPACE_DISCRETE_INPUTS

// PS_STEAM_LINE — Pressure switch: steam line OK (above threshold)
#define REG_PS_STEAM_LINE_ADDR  0x1000
#define REG_PS_STEAM_LINE_SPACE MB_SPACE_COILS

// PS_AIR_LINE — Pressure switch: compressed air line OK
#define REG_PS_AIR_LINE_ADDR  0x1001
#define REG_PS_AIR_LINE_SPACE MB_SPACE_COILS

// PS_SEAL_CLEAN — Pressure switch: clean-side door seal pressurized
#define REG_PS_SEAL_CLEAN_ADDR  0x1002
#define REG_PS_SEAL_CLEAN_SPACE MB_SPACE_COILS

// PS_SEAL_STERILE — Pressure switch: sterile-side door seal pressurized
#define REG_PS_SEAL_STERILE_ADDR  0x1003
#define REG_PS_SEAL_STERILE_SPACE MB_SPACE_COILS

// LS_DOOR_CLEAN_OPEN — Limit switch: clean-side door open
#define REG_LS_DOOR_CLEAN_OPEN_ADDR  0x1004
#define REG_LS_DOOR_CLEAN_OPEN_SPACE MB_SPACE_COILS

// LS_DOOR_CLEAN_CLOSED — Limit switch: clean-side door closed
#define REG_LS_DOOR_CLEAN_CLOSED_ADDR  0x1005
#define REG_LS_DOOR_CLEAN_CLOSED_SPACE MB_SPACE_COILS

// LS_DOOR_STERILE_OPEN — Limit switch: sterile-side door open
#define REG_LS_DOOR_STERILE_OPEN_ADDR  0x1006
#define REG_LS_DOOR_STERILE_OPEN_SPACE MB_SPACE_COILS

// LS_DOOR_STERILE_CLOSED — Limit switch: sterile-side door closed
#define REG_LS_DOOR_STERILE_CLOSED_ADDR  0x1007
#define REG_LS_DOOR_STERILE_CLOSED_SPACE MB_SPACE_COILS

// LVL_GEN_MIN — Generator water level: above minimum
#define REG_LVL_GEN_MIN_ADDR  0x1008
#define REG_LVL_GEN_MIN_SPACE MB_SPACE_COILS

// LVL_GEN_MAX — Generator water level: above maximum
#define REG_LVL_GEN_MAX_ADDR  0x1009
#define REG_LVL_GEN_MAX_SPACE MB_SPACE_COILS

// EMERGENCY_BTN — Emergency stop pressed (active low typical, polarity per equipment)
#define REG_EMERGENCY_BTN_ADDR  0x100A
#define REG_EMERGENCY_BTN_SPACE MB_SPACE_COILS

// P_CHAMBER_INT — Internal chamber pressure (absolute). int16 / 1000 = bar abs. Sentinels: -32768=OPEN, 32767=SHORT.
#define REG_P_CHAMBER_INT_ADDR  0x3000
#define REG_P_CHAMBER_INT_SPACE MB_SPACE_HOLDING_REGISTERS
#define REG_P_CHAMBER_INT_SCALE 1000

// P_CHAMBER_EXT — Jacket (external chamber) pressure. int16 / 1000 = bar abs.
#define REG_P_CHAMBER_EXT_ADDR  0x3001
#define REG_P_CHAMBER_EXT_SPACE MB_SPACE_HOLDING_REGISTERS
#define REG_P_CHAMBER_EXT_SCALE 1000

// P_GENERATOR — Generator pressure. int16 / 1000 = bar abs.
#define REG_P_GENERATOR_ADDR  0x3002
#define REG_P_GENERATOR_SPACE MB_SPACE_HOLDING_REGISTERS
#define REG_P_GENERATOR_SCALE 1000

// T_CHAMBER_INT — Internal chamber gas temperature. int16 / 100 = celsius. Sentinels: -32768=OPEN, 32767=SHORT.
#define REG_T_CHAMBER_INT_ADDR  0x3010
#define REG_T_CHAMBER_INT_SPACE MB_SPACE_HOLDING_REGISTERS
#define REG_T_CHAMBER_INT_SCALE 100

// T_TESTEMUNHO — Witness sensor temperature (embedded in load fabric).
#define REG_T_TESTEMUNHO_ADDR  0x3011
#define REG_T_TESTEMUNHO_SPACE MB_SPACE_HOLDING_REGISTERS
#define REG_T_TESTEMUNHO_SCALE 100

// T_CHAMBER_EXT — Jacket temperature.
#define REG_T_CHAMBER_EXT_ADDR  0x3012
#define REG_T_CHAMBER_EXT_SPACE MB_SPACE_HOLDING_REGISTERS
#define REG_T_CHAMBER_EXT_SCALE 100

// T_GENERATOR — Generator temperature.
#define REG_T_GENERATOR_ADDR  0x3013
#define REG_T_GENERATOR_SPACE MB_SPACE_HOLDING_REGISTERS
#define REG_T_GENERATOR_SCALE 100

// MODEL_TICK_LOW — Low 16 bits of model tick counter
#define REG_MODEL_TICK_LOW_ADDR  0x4000
#define REG_MODEL_TICK_LOW_SPACE MB_SPACE_DIAGNOSTICS

// MODEL_TICK_HIGH — High 16 bits of model tick counter
#define REG_MODEL_TICK_HIGH_ADDR  0x4001
#define REG_MODEL_TICK_HIGH_SPACE MB_SPACE_DIAGNOSTICS

// WATCHDOG_MS — PC heartbeat. PC writes, ESP32 zeros on receive. ESP32 enters fail-safe if no write for >500 ms.
#define REG_WATCHDOG_MS_ADDR  0x4002
#define REG_WATCHDOG_MS_SPACE MB_SPACE_DIAGNOSTICS

// F0_X10 — Accumulated F0 in equivalent minutes x10 (e.g., 137 means F0=13.7 min).
#define REG_F0_X10_ADDR  0x4003
#define REG_F0_X10_SPACE MB_SPACE_DIAGNOSTICS

// SIM_TIME_SCALE — Time scale x100 (100=1.0x, 200=2.0x, 50=0.5x)
#define REG_SIM_TIME_SCALE_ADDR  0x4020
#define REG_SIM_TIME_SCALE_SPACE MB_SPACE_DIAGNOSTICS

// EQUIPMENT_ID — 16-bit hash of currently active equipment config
#define REG_EQUIPMENT_ID_ADDR  0x4030
#define REG_EQUIPMENT_ID_SPACE MB_SPACE_DIAGNOSTICS

#define REG_COUNT 37
