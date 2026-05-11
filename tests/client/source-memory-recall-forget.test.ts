import { describe, expect, it, vi } from 'vitest';
import type { ForgetResult } from '../../src/client.js';
import { InvalidArgumentError } from '../../src/core/errors.js';
import {
  createClient,
  expectSourceIndexRowCounts,
  vector,
  withSourceMemoryClient,
} from './source-memory-helpers.js';

describe('PristineLocal recall and forget memory verbs', () => {
  const { getDeps } = withSourceMemoryClient();

  it('forget removes stale chunks and vectors within a project', async () => {
    vi.mocked(getDeps().embedder.embedBatch).mockResolvedValue([vector(1)]);
    vi.mocked(getDeps().embedder.embed).mockResolvedValue(vector(1));
    const client = await createClient(getDeps());

    await client.store([{ text: 'delete stale pointer', chunkId: 'stale' }], {
      projectId: 'project-a',
    });
    await client.store([{ text: 'keep pointer', chunkId: 'stale' }], {
      projectId: 'project-b',
    });

    expect(client.forget(['stale'], { projectId: 'project-a' })).toEqual({
      deletedCount: 1,
    });
    await expect(client.recall('stale', { projectId: 'project-a' })).resolves.toEqual([]);
    await expect(client.recall('stale', { projectId: 'project-b' })).resolves.toHaveLength(1);
    expect(() => client.forget([], { projectId: 'project-a' })).toThrow(InvalidArgumentError);
  });

  it('forget reports nonexistent and mixed IDs without mutating invalid calls', async () => {
    vi.mocked(getDeps().embedder.embedBatch).mockResolvedValue([vector(1), vector(2)]);
    const client = await createClient(getDeps());

    await client.store(
      [
        { text: 'delete edge first', chunkId: 'delete-1' },
        { text: 'delete edge second', chunkId: 'delete-2' },
      ],
      { projectId: 'project-a' },
    );
    expectSourceIndexRowCounts(getDeps().db, 2);

    expect(client.forget(['missing'], { projectId: 'project-a' })).toEqual({
      deletedCount: 0,
    });
    expectSourceIndexRowCounts(getDeps().db, 2);

    expect(client.forget(['delete-1', 'missing'], { projectId: 'project-a' })).toEqual({
      deletedCount: 1,
    });
    expectSourceIndexRowCounts(getDeps().db, 1);

    const invalidDeletes: Array<() => ForgetResult> = [
      () =>
        client.forget('delete-2' as unknown as readonly string[], {
          projectId: 'project-a',
        }),
      () => client.forget([42 as unknown as string], { projectId: 'project-a' }),
      () => client.forget([''], { projectId: 'project-a' }),
      () => client.forget(['delete-2'], null as unknown as { projectId: string }),
      () => client.forget(['delete-2'], [] as unknown as { projectId: string }),
      () => client.forget(['delete-2'], { projectId: '' }),
    ];

    for (const invalidDelete of invalidDeletes) {
      expect(invalidDelete).toThrow(InvalidArgumentError);
      expectSourceIndexRowCounts(getDeps().db, 1);
    }
  });

  it('recall returns source pointer hits with full and minimal metadata', async () => {
    vi.mocked(getDeps().embedder.embedBatch).mockResolvedValueOnce([
      vector(1),
      vector(0, 1),
      vector(0.5),
    ]);
    vi.mocked(getDeps().embedder.embed).mockResolvedValueOnce(vector(1));
    const client = await createClient(getDeps());

    await client.store(
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

    const hits = await client.recall('pointer', { projectId: 'project-a', limit: 3 });

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

  it('store generates unique searchable IDs for minimal chunks', async () => {
    vi.mocked(getDeps().embedder.embedBatch).mockResolvedValueOnce([vector(1), vector(0.5)]);
    vi.mocked(getDeps().embedder.embed).mockResolvedValueOnce(vector(1));
    const client = await createClient(getDeps());

    const indexed = await client.store(
      [{ text: 'generated id first' }, { text: 'generated id second' }],
      { projectId: 'project-a' },
    );
    const chunkIds = indexed.map((chunk) => chunk.chunkId);

    expect(chunkIds).toHaveLength(2);
    expect(new Set(chunkIds).size).toBe(2);
    expect(chunkIds.every((chunkId) => chunkId.length > 0)).toBe(true);
    expectSourceIndexRowCounts(getDeps().db, 2);
    await expect(
      client.recall('generated id', { projectId: 'project-a', limit: 2 }),
    ).resolves.toHaveLength(2);
  });

  it('recall enforces project isolation and validates arguments', async () => {
    vi.mocked(getDeps().embedder.embedBatch).mockResolvedValue([vector(1)]);
    vi.mocked(getDeps().embedder.embed).mockResolvedValue(vector(1));
    const client = await createClient(getDeps());

    await client.store([{ text: 'project scoped', chunkId: 'scoped' }], {
      projectId: 'project-a',
    });

    await expect(client.recall('', { projectId: 'project-a' })).rejects.toThrow(
      InvalidArgumentError,
    );
    await expect(client.recall('x', { projectId: '', limit: 1 })).rejects.toThrow(
      InvalidArgumentError,
    );
    expect(getDeps().embedder.embed).toHaveBeenCalledTimes(0);
    await expect(client.recall('x', { projectId: 'project-a', limit: 0 })).rejects.toThrow(
      InvalidArgumentError,
    );
    await expect(
      client.recall('x', { projectId: 'project-a', limit: null } as never),
    ).rejects.toThrow(InvalidArgumentError);
    await expect(client.recall('x', { projectId: 'project-a', limit: 1001 })).rejects.toThrow(
      InvalidArgumentError,
    );
    await expect(client.recall('x', { projectId: 'project-b' })).resolves.toEqual([]);
    await expect(client.recall('x', { projectId: 'project-a', limit: 1 })).resolves.toHaveLength(1);
  });

  it('recall trims queries and defaults to a limit of 10', async () => {
    vi.mocked(getDeps().embedder.embedBatch).mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => vector(index + 1)),
    );
    vi.mocked(getDeps().embedder.embed).mockResolvedValue(vector(1));
    const client = await createClient(getDeps());

    await client.store(
      Array.from({ length: 12 }, (_, index) => ({
        text: `default limit chunk ${index}`,
        chunkId: `default-limit-${index}`,
      })),
      { projectId: 'project-a' },
    );

    const hits = await client.recall('  default limit  ', { projectId: 'project-a' });

    expect(getDeps().embedder.embed).toHaveBeenCalledWith('default limit');
    expect(hits).toHaveLength(10);
  });

  it('recall rejects query embedding dimension mismatches', async () => {
    vi.mocked(getDeps().embedder.embedBatch).mockResolvedValueOnce([vector(1)]);
    vi.mocked(getDeps().embedder.embed).mockResolvedValueOnce([1]);
    const client = await createClient(getDeps());

    await client.store([{ text: 'dimension guard', chunkId: 'dim' }], {
      projectId: 'project-a',
    });

    await expect(client.recall('dimension', { projectId: 'project-a' })).rejects.toThrow(
      InvalidArgumentError,
    );
  });
});
