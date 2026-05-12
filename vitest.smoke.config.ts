import { createVitestConfig } from './vitest.config.js';

export default createVitestConfig(['tests/smoke/**/*.test.ts'], ['tests/smoke/**/*.real-smoke.test.ts']);
