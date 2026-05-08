import { describe, expect, it } from 'vitest';

// This smoke imports the built package entrypoint that consumers resolve via
// package.json exports. It requires `npm run build` before `npm run test:smoke`.
describe('package entrypoint smoke', () => {
  it('exports the source-index public API from dist', async () => {
    const pkg = (await import('../../dist/index.js')) as Record<string, unknown>;

    expect(pkg.PristineLocal).toBeTypeOf('function');
    expect(pkg.createDatabase).toBeTypeOf('function');
    expect(pkg.SourceChunkStore).toBeTypeOf('function');
    expect(pkg.initSourceChunkTables).toBeTypeOf('function');
    expect(pkg.normalizeSourceChunkInput).toBeTypeOf('function');
    expect(pkg).not.toHaveProperty('IngestQueueError');
    expect(pkg).not.toHaveProperty('InvalidSqlError');
    expect(pkg).not.toHaveProperty('QueryTimeoutError');
  });
});
