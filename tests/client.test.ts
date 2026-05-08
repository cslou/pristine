import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PristineLocal, type DeleteSourceChunksResult } from '../src/client.js';
import { createDatabase } from '../src/core/database.js';
import { InvalidArgumentError } from '../src/core/errors.js';
import type { Embedder } from '../src/core/interfaces.js';

const vector = (first: number, second = 0): number[] => [
  first,
  second,
  ...Array.from({ length: 766 }, () => 0),
];

const sourceChunkRowCount = (db: Database.Database, projectId = 'project-a'): number => {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM source_chunks WHERE project_id = ?')
    .get(projectId) as { count: number };
  return row.count;
};

const sourceVectorRowCount = (db: Database.Database, projectId = 'project-a'): number => {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM vec_source_chunks WHERE project_id = ?')
    .get(projectId) as { count: number };
  return row.count;
};

const expectSourceIndexRowCounts = (
  db: Database.Database,
  expected: number,
  projectId = 'project-a',
): void => {
  expect(sourceChunkRowCount(db, projectId)).toBe(expected);
  expect(sourceVectorRowCount(db, projectId)).toBe(expected);
};

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
    expectSourceIndexRowCounts(deps.db, 0);
  });

  it('indexSourceChunks does not write source or vector rows when embedBatch rejects', async () => {
    const embedderFailure = new Error('embedder unavailable');
    vi.mocked(deps.embedder.embedBatch).mockRejectedValueOnce(embedderFailure);
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });

    await expect(
      client.indexSourceChunks(
        [
          { text: 'first valid chunk', chunkId: 'embed-fail-1' },
          { text: 'second valid chunk', chunkId: 'embed-fail-2' },
        ],
        { projectId: 'project-a' },
      ),
    ).rejects.toBe(embedderFailure);
    expectSourceIndexRowCounts(deps.db, 0);
  });

  it('indexSourceChunks rejects embedBatch count mismatches before writing rows', async () => {
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });

    vi.mocked(deps.embedder.embedBatch).mockResolvedValueOnce([vector(1)]);
    await expect(
      client.indexSourceChunks(
        [
          { text: 'first count mismatch', chunkId: 'count-mismatch-1' },
          { text: 'second count mismatch', chunkId: 'count-mismatch-2' },
        ],
        { projectId: 'project-a' },
      ),
    ).rejects.toThrow(InvalidArgumentError);
    expectSourceIndexRowCounts(deps.db, 0);

    vi.mocked(deps.embedder.embedBatch).mockResolvedValueOnce([vector(1), vector(2), vector(3)]);
    await expect(
      client.indexSourceChunks(
        [
          { text: 'first extra embedding', chunkId: 'extra-embedding-1' },
          { text: 'second extra embedding', chunkId: 'extra-embedding-2' },
        ],
        { projectId: 'project-a' },
      ),
    ).rejects.toThrow(InvalidArgumentError);
    expectSourceIndexRowCounts(deps.db, 0);
  });

  it('indexSourceChunks rejects invalid IDs and pointer fields before embedding', async () => {
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });
    const invalidInputs = [
      { text: 'empty chunk id', chunkId: '' },
      { text: 'non-string chunk id', chunkId: 42 },
      { text: 'invalid source kind', sourceKind: 42 },
      { text: 'invalid source uri', sourceUri: 42 },
      { text: 'invalid entry id', entryId: 42 },
      { text: 'invalid parent id', parentId: 42 },
      { text: 'invalid timestamp', timestamp: 42 },
    ] as const;

    for (const input of invalidInputs) {
      await expect(
        client.indexSourceChunks([input as unknown as { text: string }], {
          projectId: 'project-a',
        }),
      ).rejects.toThrow(InvalidArgumentError);
    }
    expect(deps.embedder.embedBatch).not.toHaveBeenCalled();
    expectSourceIndexRowCounts(deps.db, 0);
  });

  it('deleteSourceChunks removes stale chunks and vectors within a project', async () => {
    vi.mocked(deps.embedder.embedBatch).mockResolvedValue([vector(1)]);
    vi.mocked(deps.embedder.embed).mockResolvedValue(vector(1));
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });

    await client.indexSourceChunks([{ text: 'delete stale pointer', chunkId: 'stale' }], {
      projectId: 'project-a',
    });
    await client.indexSourceChunks([{ text: 'keep pointer', chunkId: 'stale' }], {
      projectId: 'project-b',
    });

    expect(client.deleteSourceChunks(['stale'], { projectId: 'project-a' })).toEqual({
      deletedCount: 1,
    });
    await expect(client.searchSourceChunks('stale', { projectId: 'project-a' })).resolves.toEqual(
      [],
    );
    await expect(
      client.searchSourceChunks('stale', { projectId: 'project-b' }),
    ).resolves.toHaveLength(1);
    expect(() => client.deleteSourceChunks([], { projectId: 'project-a' })).toThrow(
      InvalidArgumentError,
    );
  });

  it('deleteSourceChunks reports nonexistent and mixed IDs without mutating invalid calls', async () => {
    vi.mocked(deps.embedder.embedBatch).mockResolvedValue([vector(1), vector(2)]);
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });

    await client.indexSourceChunks(
      [
        { text: 'delete edge first', chunkId: 'delete-1' },
        { text: 'delete edge second', chunkId: 'delete-2' },
      ],
      { projectId: 'project-a' },
    );
    expectSourceIndexRowCounts(deps.db, 2);

    expect(client.deleteSourceChunks(['missing'], { projectId: 'project-a' })).toEqual({
      deletedCount: 0,
    });
    expectSourceIndexRowCounts(deps.db, 2);

    expect(client.deleteSourceChunks(['delete-1', 'missing'], { projectId: 'project-a' })).toEqual({
      deletedCount: 1,
    });
    expectSourceIndexRowCounts(deps.db, 1);

    const invalidDeletes: Array<() => DeleteSourceChunksResult> = [
      () =>
        client.deleteSourceChunks('delete-2' as unknown as readonly string[], {
          projectId: 'project-a',
        }),
      () => client.deleteSourceChunks([42 as unknown as string], { projectId: 'project-a' }),
      () => client.deleteSourceChunks([''], { projectId: 'project-a' }),
      () => client.deleteSourceChunks(['delete-2'], null as unknown as { projectId: string }),
      () => client.deleteSourceChunks(['delete-2'], [] as unknown as { projectId: string }),
      () => client.deleteSourceChunks(['delete-2'], { projectId: '' }),
    ];

    for (const invalidDelete of invalidDeletes) {
      expect(invalidDelete).toThrow(InvalidArgumentError);
      expectSourceIndexRowCounts(deps.db, 1);
    }
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
          parentId: 'parent-1',
          lineNumber: 11,
          lineStart: 10,
          lineEnd: 12,
          timestamp: '2026-05-08T00:00:00.000Z',
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
      parentId: 'parent-1',
      lineNumber: 11,
      lineStart: 10,
      lineEnd: 12,
      timestamp: '2026-05-08T00:00:00.000Z',
      metadata: { cwd: '/tmp/project' },
    });
    expect(hits[1]).toMatchObject({
      chunkId: 'minimal',
      sourceKind: null,
      sourceUri: null,
      entryId: null,
      parentId: null,
      lineNumber: null,
      lineStart: null,
      lineEnd: null,
      timestamp: null,
      metadata: null,
    });
    expect(hits.every((hit) => hit.score > 0 && hit.score <= 1)).toBe(true);
  });

  it('indexSourceChunks generates unique searchable IDs for minimal chunks', async () => {
    vi.mocked(deps.embedder.embedBatch).mockResolvedValueOnce([vector(1), vector(0.5)]);
    vi.mocked(deps.embedder.embed).mockResolvedValueOnce(vector(1));
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });

    const indexed = await client.indexSourceChunks(
      [{ text: 'generated id first' }, { text: 'generated id second' }],
      { projectId: 'project-a' },
    );
    const chunkIds = indexed.map((chunk) => chunk.chunkId);

    expect(chunkIds).toHaveLength(2);
    expect(new Set(chunkIds).size).toBe(2);
    expect(chunkIds.every((chunkId) => chunkId.length > 0)).toBe(true);
    expectSourceIndexRowCounts(deps.db, 2);
    await expect(
      client.searchSourceChunks('generated id', { projectId: 'project-a', limit: 2 }),
    ).resolves.toHaveLength(2);
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
    expect(deps.embedder.embed).toHaveBeenCalledTimes(0);
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

  it('searchSourceChunks trims queries and defaults to a limit of 10', async () => {
    vi.mocked(deps.embedder.embedBatch).mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => vector(index + 1)),
    );
    vi.mocked(deps.embedder.embed).mockResolvedValue(vector(1));
    const client = await PristineLocal.create({ db: deps.db, embedder: deps.embedder });

    await client.indexSourceChunks(
      Array.from({ length: 12 }, (_, index) => ({
        text: `default limit chunk ${index}`,
        chunkId: `default-limit-${index}`,
      })),
      { projectId: 'project-a' },
    );

    const hits = await client.searchSourceChunks('  default limit  ', { projectId: 'project-a' });

    expect(deps.embedder.embed).toHaveBeenCalledWith('default limit');
    expect(hits).toHaveLength(10);
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
