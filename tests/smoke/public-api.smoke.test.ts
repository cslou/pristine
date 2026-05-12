import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/core/database.js';
import type { Embedder } from '../../src/core/interfaces.js';
import * as PristineBarrel from '../../src/index.js';
import {
  AppError,
  ConfigError,
  EmbedderError,
  PristineLocal,
  SensitiveNotFoundError,
  createDatabase as createDatabaseFromBarrel,
} from '../../src/index.js';

const makeEmbedderStub = (): Embedder => ({
  dim: 768,
  embed: vi.fn(async () => [1, ...Array.from({ length: 767 }, () => 0)]),
  embedBatch: vi.fn(async (texts: readonly string[]) =>
    texts.map(() => [1, ...Array.from({ length: 767 }, () => 0)]),
  ),
});

describe('public-API smoke — source chunk API', () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  it('create() succeeds with DI overrides (no model contact)', async () => {
    const db = createDatabase(':memory:');
    const client = await PristineLocal.create({ db, embedder: makeEmbedderStub() });

    try {
      expect(client).toBeInstanceOf(PristineLocal);
      expect('pendingEmbedTasks' in client).toBe(false);
      await client.dispose();
    } finally {
      db.close();
    }
  });

  it('src/index.ts public barrel exports the source-index surface', () => {
    expect(PristineLocal).toBeTypeOf('function');
    expect(createDatabaseFromBarrel).toBeTypeOf('function');
    expect(AppError).toBeTypeOf('function');
    expect(ConfigError).toBeTypeOf('function');
    expect(EmbedderError).toBeTypeOf('function');
    expect(SensitiveNotFoundError).toBeTypeOf('function');

    expect(Object.keys(PristineBarrel).sort()).toEqual([
      'AppError',
      'ConfigError',
      'EmbedderError',
      'InvalidArgumentError',
      'PristineLocal',
      'SOURCE_CHUNK_METADATA_JSON_LIMIT',
      'SOURCE_CHUNK_TEXT_LIMIT',
      'SensitiveNotFoundError',
      'SourceChunkStore',
      'buildSourceChunkVectorDdl',
      'createDatabase',
      'initSourceChunkTables',
      'normalizeSourceChunkInput',
    ]);
  });

  it('public surface indexes and searches a source chunk', async () => {
    const db = createDatabase(':memory:');
    const client = await PristineLocal.create({ db, embedder: makeEmbedderStub() });

    try {
      await client.store(
        [{ text: 'espresso with cardamom', chunkId: 'chunk-1', sourceUri: '/tmp/session.jsonl' }],
        { projectId: 'project-a' },
      );

      const hits = await client.recall('cardamom', { projectId: 'project-a' });
      expect(hits[0]).toMatchObject({
        chunkId: 'chunk-1',
        text: 'espresso with cardamom',
        sourceUri: '/tmp/session.jsonl',
      });
    } finally {
      await client.dispose();
      db.close();
    }
  });

  it('privacy scrubOutput() works without ingest', async () => {
    const db = createDatabase(':memory:');
    databases.push(db);

    const client = await PristineLocal.create({ db, embedder: makeEmbedderStub() });
    const scrubbed = client.scrubOutput(
      'Hello [SENSITIVE:name:abc-123], here is your confirmation.',
      [],
    );

    expect(scrubbed).toBe('Hello , here is your confirmation.');
    expect(scrubbed).not.toContain('[SENSITIVE:');
  });
});
