import { createVitestConfig } from './vitest.config.js';

export default createVitestConfig(
  ['tests/**/*.test.ts'],
  ['tests/integration/**/*.test.ts', 'tests/e2e/**/*.test.ts', 'tests/smoke/**/*.smoke.test.ts'],
);
