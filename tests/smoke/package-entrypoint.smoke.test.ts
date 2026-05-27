import { describe, expect, it, vi } from 'vitest';

// This smoke imports the built package entrypoint that consumers resolve via
// package.json exports. It requires `pnpm run build` before `pnpm run test:smoke`.
describe('package entrypoint smoke', () => {
  it('exports and exercises the source-index public API from dist', async () => {
    const pkg = (await import('../../dist/index.js')) as Record<string, unknown>;

    expect(Object.keys(pkg).sort()).toEqual([
      'AppError',
      'ConfigError',
      'EmbedderError',
      'FileSystemKeyManager',
      'InvalidArgumentError',
      'MacOsKeychainKeyManager',
      'Pristine',
      'SOURCE_CHUNK_METADATA_JSON_LIMIT',
      'SOURCE_CHUNK_TEXT_LIMIT',
      'SensitiveNotFoundError',
      'SourceChunkStore',
      'buildSourceChunkVectorDdl',
      'classify',
      'createDatabase',
      'createDefaultKeyManager',
      'detect',
      'initSourceChunkTables',
      'normalizeSourceChunkInput',
      'redact',
    ]);
    expect(pkg.Pristine).toBeTypeOf('function');
    expect(pkg).not.toHaveProperty('PristineLocal');
    expect(pkg.createDatabase).toBeTypeOf('function');
    expect(pkg.classify).toBeTypeOf('function');
    expect(pkg.detect).toBeTypeOf('function');
    expect(pkg.createDefaultKeyManager).toBeTypeOf('function');
    expect(pkg.FileSystemKeyManager).toBeTypeOf('function');
    expect(pkg.MacOsKeychainKeyManager).toBeTypeOf('function');
    expect(pkg.redact).toBeTypeOf('function');
    expect(pkg.SourceChunkStore).toBeTypeOf('function');
    expect(pkg.initSourceChunkTables).toBeTypeOf('function');
    expect(pkg.normalizeSourceChunkInput).toBeTypeOf('function');
    expect(pkg).not.toHaveProperty('secureAndRedact');
    expect(pkg).not.toHaveProperty('storeAsync');
    expect(pkg).not.toHaveProperty('getConversation');
    expect(pkg).not.toHaveProperty('IngestQueueError');
    expect(pkg).not.toHaveProperty('InvalidSqlError');
    expect(pkg).not.toHaveProperty('QueryTimeoutError');

    const { createDatabase, Pristine } = pkg as typeof import('../../dist/index.js');
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const vector = [1, ...Array.from({ length: 767 }, () => 0)];
    const embedder = {
      dim: 768,
      embed: vi.fn(async () => vector),
      embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => vector)),
    };
    const client = await Pristine.create({ db, embedder });
    try {
      await client.store([{ text: 'built package source index', chunkId: 'built-1' }], {
        projectId: 'built-smoke',
      });
      await expect(
        client.recall('source index', { projectId: 'built-smoke', limit: 1 }),
      ).resolves.toHaveLength(1);
      expect(client.forget(['built-1'], { projectId: 'built-smoke' })).toEqual({
        deletedCount: 1,
      });
      expect(client.redact).toBeTypeOf('function');
      expect('secureAndRedact' in client).toBe(false);
      expect('storeAsync' in client).toBe(false);
      expect('getConversation' in client).toBe(false);
    } finally {
      await client.dispose();
      db.close();
    }
  });
});
