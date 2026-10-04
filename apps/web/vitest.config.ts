import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    // nunca tocar no knobs.override.json real (ajustes do operador): arquivo temporário só dos testes
    env: {
      SIM_KNOBS_OVERRIDE: join(tmpdir(), 'sim-knobs.override.test.json'),
      SIM_CICLOS_DIR: join(tmpdir(), 'sim-ciclos-test'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['server/**/*.ts'],
      exclude: ['server/scenario-runner/cli.ts'],
    },
  },
});
