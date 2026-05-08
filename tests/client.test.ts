import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PristineLocal } from '../src/client.js';
import { createDatabase } from '../src/core/database.js';
import { InvalidArgumentError } from '../src/core/errors.js';
import type { Embedder } from '../src/core/interfaces.js';

const vector = (first: number, second = 0): number[] => [
  first,
  second,
  ...Array.from({ length: 766 }, () => 0),
];

const createMockEmbedder = (): Embedder & { dispose: ReturnType<typeof vi.fn> } => ({
  dim: 768,
  embed: vi.fn(async () => vector(1)),
  embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => vector(Math.random()))),
  dispose: vi.fn(async () => undefined),
});

const createTestDeps = (): {
  db: Database.Database;
  embedder: Embedder & { dispose: ReturnType<typeof vi.fn> };
} => ({
  db: createDatabase(':memory:'),
  embedder: createMockEmbedder(),
});

describe('PristineLocal', () => {
  let deps: ReturnType<typeof createTestDeps>;

  beforeEach(() => {
    deps = createTestDeps();
  });

  afterEach(() => {
    deps.db.close();
  });

  it('creates a client with DI overrides and no raw conversation APIs', async () => {
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });

    expect(client).toBeInstanceOf(PristineLocal);
    expect('storeAsync' in client).toBe(false);
    expect('getConversation' in client).toBe(false);
    expect('drainEmbedQueue' in client).toBe(false);
    expect('buildSessionVector' in client).toBe(false);
    expect('searcher' in client).toBe(false);
  });

  it('indexSourceChunks embeds and writes source chunks synchronously', async () => {
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });

    const chunks = await client.indexSourceChunks(
      [
        {
          text: 'source pointer architecture cleanup',
          chunkId: 'chunk-1',
          sourceKind: 'pi-jsonl',
          sourceUri: '/tmp/session.jsonl',
          metadata: { cwd: '/tmp/project' },
        },
      ],
      { projectId: 'project-a' },
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({
      chunkId: 'chunk-1',
      projectId: 'project-a',
      text: 'source pointer architecture cleanup',
      sourceKind: 'pi-jsonl',
      sourceUri: '/tmp/session.jsonl',
      entryId: null,
      parentId: null,
      lineNumber: null,
      lineStart: null,
      lineEnd: null,
      timestamp: null,
      metadata: { cwd: '/tmp/project' },
    });
    expect(deps.embedder.embedBatch).toHaveBeenCalledWith(['source pointer architecture cleanup']);
    expect(
      deps.db
        .prepare(
          'SELECT project_id, chunk_id FROM vec_source_chunks WHERE project_id = ? AND chunk_id = ?',
        )
        .get('project-a', 'chunk-1'),
    ).toEqual({ project_id: 'project-a', chunk_id: 'chunk-1' });
  });

  it('indexSourceChunks replaces duplicate chunk ids within a project and isolates projects', async () => {
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });

    await client.indexSourceChunks([{ text: 'before', chunkId: 'stable' }], {
      projectId: 'project-a',
    });
    await client.indexSourceChunks([{ text: 'after', chunkId: 'stable' }], {
      projectId: 'project-a',
    });
    await client.indexSourceChunks([{ text: 'other project', chunkId: 'stable' }], {
      projectId: 'project-b',
    });

    expect(
      deps.db
        .prepare(
          'SELECT project_id, text FROM source_chunks WHERE chunk_id = ? ORDER BY project_id',
        )
        .all('stable'),
    ).toEqual([
      { project_id: 'project-a', text: 'after' },
      { project_id: 'project-b', text: 'other project' },
    ]);
    expect(
      deps.db
        .prepare(
          'SELECT project_id, chunk_id FROM vec_source_chunks WHERE project_id = ? AND chunk_id = ?',
        )
        .all('project-a', 'stable'),
    ).toEqual([{ project_id: 'project-a', chunk_id: 'stable' }]);
  });

  it('indexSourceChunks validates before embedding and rolls back the whole batch on vector failure', async () => {
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });

    await expect(
      client.indexSourceChunks([{ text: '   ', chunkId: 'invalid' }], { projectId: 'project-a' }),
    ).rejects.toThrow(InvalidArgumentError);
    expect(deps.embedder.embedBatch).not.toHaveBeenCalled();

    vi.mocked(deps.embedder.embedBatch).mockResolvedValueOnce([vector(0.1), [0.1]]);
    await expect(
      client.indexSourceChunks(
        [
          { text: 'valid before failure', chunkId: 'batch-1' },
          { text: 'invalid vector', chunkId: 'batch-2' },
        ],
        { projectId: 'project-a' },
      ),
    ).rejects.toThrow(InvalidArgumentError);
    expect(
      deps.db.prepare('SELECT chunk_id FROM source_chunks WHERE chunk_id LIKE ?').all('batch-%'),
    ).toEqual([]);
  });

  it('searchSourceChunks returns source pointer hits with full and minimal metadata', async () => {
    vi.mocked(deps.embedder.embedBatch).mockResolvedValueOnce([
      vector(1),
      vector(0, 1),
      vector(0.5),
    ]);
    vi.mocked(deps.embedder.embed).mockResolvedValueOnce(vector(1));
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });

    await client.indexSourceChunks(
      [
        {
          text: 'pi source pointer hit',
          chunkId: 'full-pointer',
          sourceKind: 'pi-jsonl',
          sourceUri: '/tmp/session.jsonl',
          entryId: 'entry-1',
          lineStart: 10,
          lineEnd: 12,
          metadata: { cwd: '/tmp/project' },
        },
        { text: 'unrelated chunk', chunkId: 'other' },
        { text: 'minimal pointerless hit', chunkId: 'minimal' },
      ],
      { projectId: 'project-a' },
    );

    const hits = await client.searchSourceChunks('pointer', { projectId: 'project-a', limit: 3 });

    expect(hits.map((hit) => hit.chunkId)).toEqual(['full-pointer', 'minimal', 'other']);
    expect(hits[0]).toMatchObject({
      text: 'pi source pointer hit',
      sourceKind: 'pi-jsonl',
      sourceUri: '/tmp/session.jsonl',
      entryId: 'entry-1',
      lineStart: 10,
      lineEnd: 12,
      metadata: { cwd: '/tmp/project' },
    });
    expect(hits[1]).toMatchObject({
      chunkId: 'minimal',
      sourceKind: null,
      sourceUri: null,
      metadata: null,
    });
    expect(hits.every((hit) => hit.score > 0 && hit.score <= 1)).toBe(true);
  });

  it('searchSourceChunks enforces project isolation and validates arguments', async () => {
    vi.mocked(deps.embedder.embedBatch).mockResolvedValue([vector(1)]);
    vi.mocked(deps.embedder.embed).mockResolvedValue(vector(1));
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });

    await client.indexSourceChunks([{ text: 'project scoped', chunkId: 'scoped' }], {
      projectId: 'project-a',
    });

    await expect(client.searchSourceChunks('', { projectId: 'project-a' })).rejects.toThrow(
      InvalidArgumentError,
    );
    await expect(client.searchSourceChunks('x', { projectId: '', limit: 1 })).rejects.toThrow(
      InvalidArgumentError,
    );
    await expect(
      client.searchSourceChunks('x', { projectId: 'project-a', limit: 0 }),
    ).rejects.toThrow(InvalidArgumentError);
    await expect(
      client.searchSourceChunks('x', { projectId: 'project-a', limit: null } as never),
    ).rejects.toThrow(InvalidArgumentError);
    await expect(
      client.searchSourceChunks('x', { projectId: 'project-a', limit: 1001 }),
    ).rejects.toThrow(InvalidArgumentError);
    await expect(client.searchSourceChunks('x', { projectId: 'project-b' })).resolves.toEqual([]);
    await expect(
      client.searchSourceChunks('x', { projectId: 'project-a', limit: 1 }),
    ).resolves.toHaveLength(1);
  });

  it('searchSourceChunks rejects query embedding dimension mismatches', async () => {
    vi.mocked(deps.embedder.embedBatch).mockResolvedValueOnce([vector(1)]);
    vi.mocked(deps.embedder.embed).mockResolvedValueOnce([1]);
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });

    await client.indexSourceChunks([{ text: 'dimension guard', chunkId: 'dim' }], {
      projectId: 'project-a',
    });

    await expect(
      client.searchSourceChunks('dimension', { projectId: 'project-a' }),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it('privacy APIs remain available', async () => {
    const keysDir = mkdtempSync(join(tmpdir(), 'pristine-client-keys-'));
    try {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
        keysDir,
        privacy: { customPatternsPath: '/tmp/pristine-client-missing-redaction.json' },
      });

      const secured = await client.secureAndRedact(
        'Token sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456',
        'user-a',
      );
      expect(secured.redactedText).toContain('[SENSITIVE:api_key:');
      expect(client.scrubOutput('Tool leaked sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456')).toBe(
        'Tool leaked ',
      );
    } finally {
      rmSync(keysDir, { force: true, recursive: true });
    }
  });

  it('dispose does not dispose DI-provided resources', async () => {
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });
    await client.dispose();

    expect(deps.embedder.dispose).not.toHaveBeenCalled();
    expect(deps.db.open).toBe(true);
  });
});
