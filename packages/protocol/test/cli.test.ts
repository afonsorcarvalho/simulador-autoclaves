import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'protocol-cli-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const sampleYaml = `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
  holding_registers: { base: 0x3000, end: 0x3FFF }
registers:
  - { id: V_FOO, space: discrete_inputs, address: 0x0000, description: "foo" }
  - { id: P_BAR, space: holding_registers, address: 0x3000, scale: 1000, unit: bar_abs, range: [0, 5], description: "bar" }
`;

describe('cli run', () => {
  it('reads yaml and writes both TS and C++ artifacts', () => {
    const yamlPath = join(tmp, 'registers.yaml');
    const distDir = join(tmp, 'dist');
    writeFileSync(yamlPath, sampleYaml, 'utf8');

    run({ inputPath: yamlPath, outputDir: distDir });

    const ts = readFileSync(join(distDir, 'registers.ts'), 'utf8');
    const cpp = readFileSync(join(distDir, 'registers.h'), 'utf8');
    expect(ts).toMatch(/V_FOO/);
    expect(ts).toMatch(/P_BAR/);
    expect(cpp).toMatch(/#define REG_V_FOO_ADDR\s+0x0000/);
    expect(cpp).toMatch(/#define REG_P_BAR_SCALE\s+1000/);
  });

  it('creates the output directory if it does not exist', () => {
    const yamlPath = join(tmp, 'registers.yaml');
    const distDir = join(tmp, 'nested', 'deeper', 'dist');
    writeFileSync(yamlPath, sampleYaml, 'utf8');

    expect(existsSync(distDir)).toBe(false);
    run({ inputPath: yamlPath, outputDir: distDir });
    expect(existsSync(join(distDir, 'registers.ts'))).toBe(true);
    expect(existsSync(join(distDir, 'registers.h'))).toBe(true);
  });

  it('throws on invalid yaml (propagates parser error)', () => {
    const yamlPath = join(tmp, 'bad.yaml');
    writeFileSync(
      yamlPath,
      `
version: 1
spaces:
  discrete_inputs: { base: 0x0000, end: 0x0FFF }
registers:
  - { id: X, space: discrete_inputs, address: 0x9999, description: "out of range" }
`,
      'utf8',
    );
    expect(() => run({ inputPath: yamlPath, outputDir: join(tmp, 'dist') })).toThrow(
      /outside space/,
    );
  });
});
