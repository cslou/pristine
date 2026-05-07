import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import type { UserConfig } from 'vitest/config';

export const sharedVitestConfig = {
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Several tests exercise RSA-4096 keypair generation (vault, kek, key
    // management). On loaded machines a single keygen can take 3-4 seconds
    // under parallel suite load, and the default 5s timeout was causing
    // intermittent failures as the suite grew (6 flakes observed after
    // Sprint 008c Story 7 merge). The cap only kicks in when a test hangs —
    // raising it does not slow normal runs, and individual tests that want
    // a tighter bound can still pass one explicitly via `it(..., 5000)`.
    testTimeout: 15_000,
  },
} satisfies UserConfig;

export const baseVitestConfig = defineConfig(sharedVitestConfig);

export const createVitestConfig = (include: readonly string[], exclude: readonly string[] = []) =>
  defineConfig({
    ...sharedVitestConfig,
    test: {
      ...sharedVitestConfig.test,
      include: [...include],
      exclude: [...exclude],
    },
  });

export default baseVitestConfig;
