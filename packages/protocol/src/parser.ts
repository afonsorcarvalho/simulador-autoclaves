import yaml from 'js-yaml';
import { z } from 'zod';
import { RegisterFileSchema, type Register, type RegisterFile, type SpaceName } from './schema.js';

export interface ParsedRegisters {
  version: 1;
  spaces: RegisterFile['spaces'];
  registers: Register[];
}

export function parseRegisters(yamlText: string): ParsedRegisters {
  const raw = yaml.load(yamlText);

  let file: ReturnType<typeof RegisterFileSchema.parse>;
  try {
    file = RegisterFileSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      // Surface friendly messages for common validation failures
      for (const issue of err.issues) {
        const path = issue.path.join('.');
        // Unknown/invalid space name in a register
        if (
          issue.code === 'invalid_enum_value' &&
          typeof issue.path[issue.path.length - 1] === 'string' &&
          issue.path[issue.path.length - 1] === 'space'
        ) {
          const received = (issue as z.ZodInvalidEnumValueIssue).received;
          throw new Error(`unknown space "${received}"`);
        }
        void path;
      }
    }
    throw err;
  }

  const knownSpaces = new Set(Object.keys(file.spaces));

  // Cross-validation
  const seenIds = new Set<string>();
  const seenPerSpace = new Map<SpaceName, Map<number, string>>();

  for (const reg of file.registers) {
    if (!knownSpaces.has(reg.space)) {
      throw new Error(`Register ${reg.id}: unknown space "${reg.space}"`);
    }

    const spaceDef = file.spaces[reg.space];
    if (!spaceDef) {
      throw new Error(`Register ${reg.id}: unknown space "${reg.space}"`);
    }
    if (reg.address < spaceDef.base || reg.address > spaceDef.end) {
      throw new Error(
        `Register ${reg.id}: address 0x${reg.address.toString(16).padStart(4, '0')} outside space "${reg.space}" range [0x${spaceDef.base.toString(16).padStart(4, '0')}..0x${spaceDef.end.toString(16).padStart(4, '0')}]`,
      );
    }

    if (seenIds.has(reg.id)) {
      throw new Error(`duplicate id "${reg.id}"`);
    }
    seenIds.add(reg.id);

    let perSpace = seenPerSpace.get(reg.space);
    if (!perSpace) {
      perSpace = new Map();
      seenPerSpace.set(reg.space, perSpace);
    }
    const dup = perSpace.get(reg.address);
    if (dup) {
      throw new Error(
        `duplicate address 0x${reg.address.toString(16).padStart(4, '0')} in space "${reg.space}" between ${dup} and ${reg.id}`,
      );
    }
    perSpace.set(reg.address, reg.id);

    if (reg.space === 'holding_registers' && reg.scale === undefined && reg.type === undefined) {
      throw new Error(
        `holding register "${reg.id}" must declare either "scale" (analog) or "type" (raw uint16/int16)`,
      );
    }
  }

  return { version: file.version, spaces: file.spaces, registers: file.registers };
}
