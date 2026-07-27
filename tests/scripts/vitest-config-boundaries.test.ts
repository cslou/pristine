import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const vitestBin = resolve(repoRoot, 'node_modules/vitest/vitest.mjs');

const listTests = (suite: string): string => {
  const result = spawnSync(process.execPath, [vitestBin, 'list', '--run'], {
    cwd: repoRoot,
    env: { ...process.env, VITEST_SUITE: suite },
    encoding: 'utf8',
    timeout: 30_000,
  });

  expect(result.status, `${suite} list stderr:\n${result.stderr}`).toBe(0);
  return result.stdout;
};

describe('Vitest suite discovery boundaries', () => {
  it('discovers unit and deterministic smoke tests without crossing suite boundaries', () => {
    const unitTests = listTests('unit');
    expect(unitTests).toContain('tests/scripts/vitest-config-boundaries.test.ts');
    expect(unitTests).not.toContain('tests/smoke/source-index-local-model.local-model.test.ts');
    expect(unitTests).not.toContain('tests/integration/embedder.test.ts');

    const smokeTests = listTests('smoke');
    expect(smokeTests).toBe('');
    expect(smokeTests).not.toContain('tests/smoke/source-index-local-model.local-model.test.ts');
  });

  it('discovers local-model smoke, integration, and e2e tests on explicit suite selectors', () => {
    expect(listTests('local-model-smoke')).toContain(
      'tests/smoke/source-index-local-model.local-model.test.ts',
    );
    expect(listTests('integration')).toContain('tests/integration/embedder.test.ts');
    expect(listTests('e2e')).toBe('');
  });
});
