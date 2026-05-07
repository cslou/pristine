import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import e2eConfig from '../../vitest.e2e.config.js';
import integrationConfig from '../../vitest.integration.config.js';
import smokeConfig from '../../vitest.smoke.config.js';
import unitConfig from '../../vitest.unit.config.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const vitestBin = resolve(repoRoot, 'node_modules/vitest/vitest.mjs');

const testConfig = (config: unknown): { include?: string[]; exclude?: string[] } => {
  if (typeof config !== 'object' || config === null || !('test' in config)) {
    throw new TypeError('Vitest config does not expose a test block');
  }

  const test = (config as { test: unknown }).test;
  if (typeof test !== 'object' || test === null) {
    throw new TypeError('Vitest config test block is not an object');
  }

  return test as { include?: string[]; exclude?: string[] };
};

const listTests = (config: string): string => {
  const result = spawnSync(process.execPath, [vitestBin, 'list', '--config', config, '--run'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10_000,
  });

  expect(result.status, `${config} list stderr:\n${result.stderr}`).toBe(0);
  return result.stdout;
};

describe('Vitest suite discovery boundaries', () => {
  it('discovers public API smoke tests through the smoke config', () => {
    expect(testConfig(smokeConfig).include).toEqual(['tests/smoke/**/*.test.ts']);
    expect(testConfig(unitConfig).exclude).toContain('tests/smoke/**/*.test.ts');
    expect(testConfig(integrationConfig).include).toEqual(['tests/integration/**/*.test.ts']);
    expect(testConfig(e2eConfig).include).toEqual(['tests/e2e/**/*.test.ts']);

    expect(listTests('vitest.smoke.config.ts')).toContain('tests/smoke/public-api.smoke.test.ts');
  });

  it('discovers broader privacy pipeline coverage through the e2e config', () => {
    expect(testConfig(e2eConfig).include).toContain('tests/e2e/**/*.test.ts');
    expect(testConfig(smokeConfig).include).not.toContain('tests/e2e/**/*.test.ts');

    expect(listTests('vitest.e2e.config.ts')).toContain('tests/e2e/privacy-pipeline.test.ts');
  });
});
