import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Embedder } from '../../src/core/interfaces.js';
import * as PristineBarrel from '../../src/index.js';
import {
  AppError,
  ConfigError,
  EmbedderError,
  InvalidArgumentError,
  Pristine,
  createDatabase,
} from '../../src/index.js';

const makeEmbedderStub = (): Embedder => ({
  dim: 768,
  embed: vi.fn(async () => [1, ...Array.from({ length: 767 }, () => 0)]),
  embedBatch: vi.fn(async (texts: readonly string[]) =>
    texts.map(() => [1, ...Array.from({ length: 767 }, () => 0)]),
  ),
});

describe('public API smoke — source memory', () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  it('creates a client with dependency-injected memory components', async () => {
    const db = createDatabase(':memory:');
    databases.push(db);
    const client = await Pristine.create({ db, embedder: makeEmbedderStub() });

    try {
      expect(client).toBeInstanceOf(Pristine);
    } finally {
      await client.dispose();
    }
  });

  it('exports the source-memory public surface', () => {
    expect(Pristine).toBeTypeOf('function');
    expect(createDatabase).toBeTypeOf('function');
    expect(AppError).toBeTypeOf('function');
    expect(ConfigError).toBeTypeOf('function');
    expect(EmbedderError).toBeTypeOf('function');
    expect(InvalidArgumentError).toBeTypeOf('function');

    expect(Object.keys(PristineBarrel).sort()).toEqual([
      'AppError',
      'ConfigError',
      'EmbedderError',
      'InvalidArgumentError',
      'Pristine',
      'SOURCE_CHUNK_METADATA_JSON_LIMIT',
      'SOURCE_CHUNK_TEXT_LIMIT',
      'SourceChunkStore',
      'buildSourceChunkVectorDdl',
      'createDatabase',
      'initSourceChunkTables',
      'normalizeSourceChunkInput',
    ]);
  });

  it('stores, recalls, and forgets source memory through the public API', async () => {
    const db = createDatabase(':memory:');
    databases.push(db);
    const client = await Pristine.create({ db, embedder: makeEmbedderStub() });

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

      expect(client.forget(['chunk-1'], { projectId: 'project-a' })).toEqual({
        deletedCount: 1,
      });
      await expect(client.recall('cardamom', { projectId: 'project-a' })).resolves.toEqual([]);
    } finally {
      await client.dispose();
    }
  });
});
