import { describe, it, expect } from 'vitest';
import { parseRegisters } from '../src/parser.js';
import { emitTypeScript } from '../src/emit-ts.js';

const sampleYaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
  holding_registers: { base: 0x3000, end: 0x3FFF }
registers:
  - { id: V_FOO, space: discrete_inputs, address: 0x0000, description: "foo valve" }
  - { id: P_BAR, space: holding_registers, address: 0x3000, scale: 1000, unit: bar_abs, range: [0, 5], description: "bar pressure" }
`;

describe('emitTypeScript', () => {
  it('emits a header banner', () => {
    const out = emitTypeScript(parseRegisters(sampleYaml));
    expect(out).toMatch(/AUTO-GENERATED/);
    expect(out).toMatch(/registers\.yaml/);
  });

  it('emits a typed REGISTERS const with each id as a key', () => {
    const out = emitTypeScript(parseRegisters(sampleYaml));
    expect(out).toMatch(/export const REGISTERS = \{/);
    expect(out).toMatch(/V_FOO:\s*\{/);
    expect(out).toMatch(/P_BAR:\s*\{/);
    expect(out).toMatch(/\} as const;/);
  });

  it('emits address as a hex literal', () => {
    const out = emitTypeScript(parseRegisters(sampleYaml));
    expect(out).toMatch(/address:\s*0x0000/);
    expect(out).toMatch(/address:\s*0x3000/);
  });

  it('emits scale and unit for holding registers', () => {
    const out = emitTypeScript(parseRegisters(sampleYaml));
    expect(out).toMatch(/scale:\s*1000/);
    expect(out).toMatch(/unit:\s*'bar_abs'/);
  });

  it('emits a RegisterId union type', () => {
    const out = emitTypeScript(parseRegisters(sampleYaml));
    expect(out).toMatch(/export type RegisterId = 'V_FOO' \| 'P_BAR'/);
  });

  it('emits SPACES const with bases/ends', () => {
    const out = emitTypeScript(parseRegisters(sampleYaml));
    expect(out).toMatch(/export const SPACES =/);
    expect(out).toMatch(/discrete_inputs:\s*\{\s*base:\s*0x0000,\s*end:\s*0x0fff\s*\}/i);
  });

  it('output is deterministic (same input -> same output)', () => {
    const parsed = parseRegisters(sampleYaml);
    const a = emitTypeScript(parsed);
    const b = emitTypeScript(parsed);
    expect(a).toBe(b);
  });
});
