import { describe, it, expect } from 'vitest';
import { parseRegisters } from '../src/parser.js';

const validYaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
  holding_registers: { base: 0x3000, end: 0x3FFF }
registers:
  - { id: V_FOO, space: discrete_inputs, address: 0x0000, description: "foo" }
  - { id: P_BAR, space: holding_registers, address: 0x3000, scale: 1000, unit: bar_abs, range: [0, 5], description: "bar" }
`;

describe('parseRegisters', () => {
  it('parses a valid YAML', () => {
    const result = parseRegisters(validYaml);
    expect(result.registers).toHaveLength(2);
    expect(result.registers[0]!.id).toBe('V_FOO');
    expect(result.registers[1]!.scale).toBe(1000);
  });

  it('rejects unknown space', () => {
    const yaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
registers:
  - { id: X, space: nonexistent_space, address: 0x0000, description: "x" }
`;
    expect(() => parseRegisters(yaml)).toThrow(/unknown space/i);
  });

  it('rejects address outside its space range', () => {
    const yaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
registers:
  - { id: X, space: discrete_inputs, address: 0x2000, description: "x" }
`;
    expect(() => parseRegisters(yaml)).toThrow(/outside space/i);
  });

  it('rejects duplicate addresses within the same space', () => {
    const yaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
registers:
  - { id: A, space: discrete_inputs, address: 0x0000, description: "a" }
  - { id: B, space: discrete_inputs, address: 0x0000, description: "b" }
`;
    expect(() => parseRegisters(yaml)).toThrow(/duplicate address/i);
  });

  it('rejects duplicate ids', () => {
    const yaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
registers:
  - { id: DUP, space: discrete_inputs, address: 0x0000, description: "1" }
  - { id: DUP, space: discrete_inputs, address: 0x0001, description: "2" }
`;
    expect(() => parseRegisters(yaml)).toThrow(/duplicate id/i);
  });

  it('rejects holding register without scale', () => {
    const yaml = `
version: 1
spaces:
  holding_registers: { base: 0x3000, end: 0x3FFF }
registers:
  - { id: P_X, space: holding_registers, address: 0x3000, description: "x" }
`;
    expect(() => parseRegisters(yaml)).toThrow(/holding register .* must declare/i);
  });

  it('allows same address in different spaces', () => {
    const yaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
  coils: { base: 0x1000, end: 0x1FFF }
registers:
  - { id: A, space: discrete_inputs, address: 0x0000, description: "a" }
  - { id: B, space: coils, address: 0x1000, description: "b" }
`;
    const result = parseRegisters(yaml);
    expect(result.registers).toHaveLength(2);
  });
});
