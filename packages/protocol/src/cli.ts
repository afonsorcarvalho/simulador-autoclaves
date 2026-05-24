import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRegisters } from './parser.js';
import { emitTypeScript } from './emit-ts.js';
import { emitCpp } from './emit-cpp.js';

export interface RunOptions {
  inputPath: string;
  outputDir: string;
}

export function run(opts: RunOptions): void {
  const yamlText = readFileSync(opts.inputPath, 'utf8');
  const parsed = parseRegisters(yamlText);

  mkdirSync(opts.outputDir, { recursive: true });

  const tsPath = join(opts.outputDir, 'registers.ts');
  const cppPath = join(opts.outputDir, 'registers.h');

  writeFileSync(tsPath, emitTypeScript(parsed), 'utf8');
  writeFileSync(cppPath, emitCpp(parsed), 'utf8');

  console.log(`[@sim/protocol] generated:`);
  console.log(`  ${tsPath}`);
  console.log(`  ${cppPath}`);
  console.log(
    `  ${parsed.registers.length} registers across ${Object.keys(parsed.spaces).length} spaces`,
  );
}

// Auto-invoke when called as a script (not when imported by tests).
const isMain = (() => {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
    return thisFile === invoked;
  } catch {
    return false;
  }
})();

if (isMain) {
  // Defaults assume CWD is packages/protocol
  const inputPath = resolve(process.cwd(), 'registers.yaml');
  const outputDir = resolve(process.cwd(), 'dist');
  run({ inputPath, outputDir });
}
