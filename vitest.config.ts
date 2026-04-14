import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export const baseVitestConfig = defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});

export default baseVitestConfig;
