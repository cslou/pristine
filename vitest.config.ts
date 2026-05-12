import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import type { UserConfig } from 'vitest/config';

type VitestSuite = 'all' | 'unit' | 'smoke' | 'local-model-smoke' | 'integration' | 'e2e';

const suite = (process.env.VITEST_SUITE ?? 'all') as VitestSuite;

const suitePatterns: Record<VitestSuite, Pick<NonNullable<UserConfig['test']>, 'include' | 'exclude'>> = {
  all: {
    include: ['tests/**/*.test.ts'],
  },
  unit: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/smoke/**', 'tests/integration/**', 'tests/e2e/**'],
  },
  smoke: {
    include: ['tests/smoke/**/*.smoke.test.ts'],
    exclude: ['tests/smoke/**/*.local-model.test.ts'],
  },
  'local-model-smoke': {
    include: ['tests/smoke/**/*.local-model.test.ts'],
  },
  integration: {
    include: ['tests/integration/**/*.test.ts'],
  },
  e2e: {
    include: ['tests/e2e/**/*.test.ts'],
  },
};

const selectedSuite = suitePatterns[suite];
if (selectedSuite === undefined) {
  throw new Error(`Unknown VITEST_SUITE: ${suite}`);
}

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    ...selectedSuite,
    // Several tests exercise RSA-4096 keypair generation (vault, kek, key
    // management). On loaded machines a single keygen can take 3-4 seconds
    // under parallel suite load, and the default 5s timeout was causing
    // intermittent failures as the suite grew (6 flakes observed after
    // Sprint 008c Story 7 merge). The cap only kicks in when a test hangs —
    // raising it does not slow normal runs, and individual tests that want
    // a tighter bound can still pass one explicitly via `it(..., 5000)`.
    testTimeout: 15_000,
  },
});
