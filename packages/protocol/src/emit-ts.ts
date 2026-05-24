import type { ParsedRegisters } from './parser.js';
import type { Register, SpaceDef } from './schema.js';

const BANNER = `// AUTO-GENERATED from packages/protocol/registers.yaml — DO NOT EDIT.
// Run \`pnpm generate\` to regenerate. CI fails on drift.
`;

function hex(n: number, width = 4): string {
  return '0x' + n.toString(16).padStart(width, '0');
}

function emitRegister(reg: Register): string {
  const parts: string[] = [];
  parts.push(`space: '${reg.space}'`);
  parts.push(`address: ${hex(reg.address)}`);
  if (reg.type !== undefined) parts.push(`type: '${reg.type}'`);
  if (reg.scale !== undefined) parts.push(`scale: ${reg.scale}`);
  if (reg.unit !== undefined) parts.push(`unit: '${reg.unit}'`);
  if (reg.range !== undefined) parts.push(`range: [${reg.range[0]}, ${reg.range[1]}] as const`);
  return `  ${reg.id}: { ${parts.join(', ')} },`;
}

function emitSpace(name: string, def: SpaceDef): string {
  return `  ${name}: { base: ${hex(def.base)}, end: ${hex(def.end)} },`;
}

export function emitTypeScript(parsed: ParsedRegisters): string {
  const spacesLines = Object.entries(parsed.spaces)
    .filter((entry): entry is [string, SpaceDef] => entry[1] !== undefined)
    .map(([name, def]) => emitSpace(name, def));
  const registerLines = parsed.registers.map(emitRegister);
  const ids = parsed.registers.map((r) => `'${r.id}'`).join(' | ');

  return [
    BANNER,
    `export const SPACES = {`,
    ...spacesLines,
    `} as const;`,
    ``,
    `export const REGISTERS = {`,
    ...registerLines,
    `} as const;`,
    ``,
    `export type RegisterId = ${ids};`,
    ``,
  ].join('\n');
}
