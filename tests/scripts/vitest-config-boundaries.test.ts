import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const scripts = packageJson.scripts ?? {};

describe('Vitest suite command boundaries', () => {
  it('keeps unit tests separate from smoke, integration, and e2e tests', () => {
    expect(scripts['test:unit']).toContain('VITEST_SUITE=unit');
    expect(scripts['test:unit']).toContain('vitest run');
    expect(scripts['test:integration']).toContain('VITEST_SUITE=integration');
    expect(scripts['test:e2e']).toContain('VITEST_SUITE=e2e');
  });

  it('keeps deterministic smoke separate from optional local-model smoke', () => {
    expect(scripts['test:smoke']).toContain('VITEST_SUITE=smoke');
    expect(scripts['test:smoke:local-model']).toContain('VITEST_SUITE=local-model-smoke');
  });
});
