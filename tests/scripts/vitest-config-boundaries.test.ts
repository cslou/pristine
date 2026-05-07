import { describe, expect, it } from 'vitest';
import e2eConfig from '../../vitest.e2e.config.js';
import integrationConfig from '../../vitest.integration.config.js';
import smokeConfig from '../../vitest.smoke.config.js';
import unitConfig from '../../vitest.unit.config.js';

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

describe('Vitest suite discovery boundaries', () => {
  it('discovers public API smoke tests only in the smoke config', () => {
    expect(testConfig(smokeConfig).include).toEqual(['tests/smoke/**/*.test.ts']);
    expect(testConfig(unitConfig).exclude).toContain('tests/smoke/**/*.test.ts');
    expect(testConfig(integrationConfig).include).toEqual(['tests/integration/**/*.test.ts']);
    expect(testConfig(e2eConfig).include).toEqual(['tests/e2e/**/*.test.ts']);
  });

  it('keeps broader privacy pipeline coverage in the e2e config', () => {
    expect(testConfig(e2eConfig).include).toContain('tests/e2e/**/*.test.ts');
    expect(testConfig(smokeConfig).include).not.toContain('tests/e2e/**/*.test.ts');
  });
});
