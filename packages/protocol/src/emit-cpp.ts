import type { ParsedRegisters } from './parser.js';
import type { Register, SpaceName } from './schema.js';

const BANNER = `// AUTO-GENERATED from packages/protocol/registers.yaml — DO NOT EDIT.
// Run \`pnpm generate\` to regenerate. CI fails on drift.
`;

// Modbus function-code style constants. Values arbitrary but stable; firmware uses these to dispatch.
const SPACE_CODES: Record<SpaceName, { macro: string; value: number }> = {
  coils: { macro: 'MB_SPACE_COILS', value: 0 },
  discrete_inputs: { macro: 'MB_SPACE_DISCRETE_INPUTS', value: 1 },
  input_registers: { macro: 'MB_SPACE_INPUT_REGISTERS', value: 2 },
  holding_registers: { macro: 'MB_SPACE_HOLDING_REGISTERS', value: 3 },
  diagnostics: { macro: 'MB_SPACE_DIAGNOSTICS', value: 4 },
};

function hex(n: number, width = 4): string {
  return '0x' + n.toString(16).padStart(width, '0').toUpperCase();
}

function emitRegisterMacros(reg: Register): string[] {
  const lines: string[] = [];
  lines.push(`// ${reg.id} — ${reg.description}`);
  lines.push(`#define REG_${reg.id}_ADDR  ${hex(reg.address)}`);
  lines.push(`#define REG_${reg.id}_SPACE ${SPACE_CODES[reg.space].macro}`);
  if (reg.scale !== undefined) {
    lines.push(`#define REG_${reg.id}_SCALE ${reg.scale}`);
  }
  return lines;
}

export function emitCpp(parsed: ParsedRegisters): string {
  const spaceLines = Object.values(SPACE_CODES).map(
    ({ macro, value }) => `#define ${macro} ${value}`,
  );

  const registerLines: string[] = [];
  for (const reg of parsed.registers) {
    registerLines.push(...emitRegisterMacros(reg));
    registerLines.push('');
  }

  return [
    BANNER,
    `#pragma once`,
    ``,
    `// Modbus address space codes`,
    ...spaceLines,
    ``,
    `// Register definitions`,
    ...registerLines,
    `#define REG_COUNT ${parsed.registers.length}`,
    ``,
  ].join('\n');
}
