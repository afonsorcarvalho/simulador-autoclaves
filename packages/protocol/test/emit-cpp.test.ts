import { describe, it, expect } from 'vitest';
import { parseRegisters } from '../src/parser.js';
import { emitCpp } from '../src/emit-cpp.js';

const sampleYaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
  holding_registers: { base: 0x3000, end: 0x3FFF }
  diagnostics: { base: 0x4000, end: 0x4FFF }
registers:
  - { id: V_FOO, space: discrete_inputs, address: 0x0000, description: "foo" }
  - { id: P_BAR, space: holding_registers, address: 0x3000, scale: 1000, unit: bar_abs, range: [0, 5], description: "bar" }
  - { id: WATCHDOG_MS, space: diagnostics, address: 0x4002, type: uint16, description: "watchdog" }
`;

describe('emitCpp', () => {
  it('emits header banner and pragma once', () => {
    const out = emitCpp(parseRegisters(sampleYaml));
    expect(out).toMatch(/AUTO-GENERATED/);
    expect(out).toMatch(/#pragma once/);
  });

  it('emits space-name -> Modbus function code mapping macros', () => {
    const out = emitCpp(parseRegisters(sampleYaml));
    expect(out).toMatch(/#define\s+MB_SPACE_DISCRETE_INPUTS\s+1/);
    expect(out).toMatch(/#define\s+MB_SPACE_COILS\s+0/);
    expect(out).toMatch(/#define\s+MB_SPACE_HOLDING_REGISTERS\s+3/);
  });

  it('emits address macros for each register', () => {
    const out = emitCpp(parseRegisters(sampleYaml));
    expect(out).toMatch(/#define\s+REG_V_FOO_ADDR\s+0x0000/);
    expect(out).toMatch(/#define\s+REG_P_BAR_ADDR\s+0x3000/);
    expect(out).toMatch(/#define\s+REG_WATCHDOG_MS_ADDR\s+0x4002/);
  });

  it('emits space macro for each register', () => {
    const out = emitCpp(parseRegisters(sampleYaml));
    expect(out).toMatch(/#define\s+REG_V_FOO_SPACE\s+MB_SPACE_DISCRETE_INPUTS/);
    expect(out).toMatch(/#define\s+REG_P_BAR_SPACE\s+MB_SPACE_HOLDING_REGISTERS/);
  });

  it('emits scale macro for analog holding registers', () => {
    const out = emitCpp(parseRegisters(sampleYaml));
    expect(out).toMatch(/#define\s+REG_P_BAR_SCALE\s+1000/);
  });

  it('does not emit scale for registers without one', () => {
    const out = emitCpp(parseRegisters(sampleYaml));
    expect(out).not.toMatch(/#define\s+REG_V_FOO_SCALE/);
    expect(out).not.toMatch(/#define\s+REG_WATCHDOG_MS_SCALE/);
  });

  it('emits register count macro', () => {
    const out = emitCpp(parseRegisters(sampleYaml));
    expect(out).toMatch(/#define\s+REG_COUNT\s+3/);
  });

  it('output is deterministic', () => {
    const parsed = parseRegisters(sampleYaml);
    expect(emitCpp(parsed)).toBe(emitCpp(parsed));
  });
});
