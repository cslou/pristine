import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const listTests = (config: string): string => {
  const result = spawnSync('npx', ['vitest', 'list', '--config', config, '--run'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  expect(result.status, `${config} list stderr:\n${result.stderr}`).toBe(0);
  return result.stdout;
};

describe('Vitest suite discovery boundaries', () => {
  it('discovers public API smoke only in the smoke config', () => {
    const unit = listTests('vitest.unit.config.ts');
    const smoke = listTests('vitest.smoke.config.ts');
    const integration = listTests('vitest.integration.config.ts');
    const e2e = listTests('vitest.e2e.config.ts');

    expect(smoke).toContain('tests/smoke/public-api.smoke.test.ts');
    expect(unit).not.toContain('tests/smoke/public-api.smoke.test.ts');
    expect(integration).not.toContain('tests/smoke/public-api.smoke.test.ts');
    expect(e2e).not.toContain('tests/smoke/public-api.smoke.test.ts');
  });

  it('keeps broader privacy pipeline coverage in the e2e config', () => {
    const smoke = listTests('vitest.smoke.config.ts');
    const e2e = listTests('vitest.e2e.config.ts');

    expect(e2e).toContain('tests/e2e/privacy-pipeline.test.ts');
    expect(smoke).not.toContain('tests/e2e/privacy-pipeline.test.ts');
  });
});
