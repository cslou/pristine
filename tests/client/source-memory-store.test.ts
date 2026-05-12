import { describe, expect, it, vi } from 'vitest';
import { PristineLocal } from '../../src/client.js';
import { EmbedderError, InvalidArgumentError } from '../../src/core/errors.js';
import { OllamaEmbedder } from '../../src/embedder/ollama/index.js';
import {
  createClient,
  expectSourceIndexRowCounts,
  mockFetchResponse,
  vector,
  withSourceMemoryClient,
} from './source-memory-helpers.js';

describe('PristineLocal store memory verb', () => {
  const { getDeps } = withSourceMemoryClient();

  it('keeps source-chunk method names as deprecated compatibility aliases', async () => {
    vi.mocked(getDeps().embedder.embedBatch).mockResolvedValueOnce([vector(1)]);
    vi.mocked(getDeps().embedder.embed).mockResolvedValueOnce(vector(1));
    const client = await createClient(getDeps());

    await expect(
      client.indexSourceChunks([{ text: 'legacy alias memory', chunkId: 'legacy' }], {
        projectId: 'project-a',
      }),
    ).resolves.toHaveLength(1);
    await expect(
      client.searchSourceChunks('legacy alias', { projectId: 'project-a', limit: 1 }),
    ).resolves.toHaveLength(1);
    expect(client.deleteSourceChunks(['legacy'], { projectId: 'project-a' })).toEqual({
      deletedCount: 1,
    });
  });

  it('store embeds and writes source chunks synchronously', async () => {
    const client = await createClient(getDeps());

    const chunks = await client.store(
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
    expect(getDeps().embedder.embedBatch).toHaveBeenCalledWith([
      'source pointer architecture cleanup',
    ]);
    expect(
      getDeps()
        .db.prepare(
          'SELECT project_id, chunk_id FROM vec_source_chunks WHERE project_id = ? AND chunk_id = ?',
        )
        .get('project-a', 'chunk-1'),
    ).toEqual({ project_id: 'project-a', chunk_id: 'chunk-1' });
  });

  it('store replaces duplicate chunk ids within a project and isolates projects', async () => {
    const client = await createClient(getDeps());

    await client.store([{ text: 'before', chunkId: 'stable' }], {
      projectId: 'project-a',
    });
    await client.store([{ text: 'after', chunkId: 'stable' }], {
      projectId: 'project-a',
    });
    await client.store([{ text: 'other project', chunkId: 'stable' }], {
      projectId: 'project-b',
    });

    expect(
      getDeps()
        .db.prepare(
          'SELECT project_id, text FROM source_chunks WHERE chunk_id = ? ORDER BY project_id',
        )
        .all('stable'),
    ).toEqual([
      { project_id: 'project-a', text: 'after' },
      { project_id: 'project-b', text: 'other project' },
    ]);
    expect(
      getDeps()
        .db.prepare(
          'SELECT project_id, chunk_id FROM vec_source_chunks WHERE project_id = ? AND chunk_id = ?',
        )
        .all('project-a', 'stable'),
    ).toEqual([{ project_id: 'project-a', chunk_id: 'stable' }]);
  });

  it('store validates before embedding and rolls back the whole batch on vector failure', async () => {
    const client = await createClient(getDeps());

    await expect(
      client.store([{ text: '   ', chunkId: 'invalid' }], { projectId: 'project-a' }),
    ).rejects.toThrow(InvalidArgumentError);
    expect(getDeps().embedder.embedBatch).not.toHaveBeenCalled();

    vi.mocked(getDeps().embedder.embedBatch).mockResolvedValueOnce([vector(0.1), [0.1]]);
    await expect(
      client.store(
        [
          { text: 'valid before failure', chunkId: 'batch-1' },
          { text: 'invalid vector', chunkId: 'batch-2' },
        ],
        { projectId: 'project-a' },
      ),
    ).rejects.toThrow(InvalidArgumentError);
    expectSourceIndexRowCounts(getDeps().db, 0);
  });

  it('store does not write source or vector rows when embedBatch rejects', async () => {
    const embedderFailure = new Error('embedder unavailable');
    vi.mocked(getDeps().embedder.embedBatch).mockRejectedValueOnce(embedderFailure);
    const client = await createClient(getDeps());

    await expect(
      client.store(
        [
          { text: 'first valid chunk', chunkId: 'embed-fail-1' },
          { text: 'second valid chunk', chunkId: 'embed-fail-2' },
        ],
        { projectId: 'project-a' },
      ),
    ).rejects.toBe(embedderFailure);
    expectSourceIndexRowCounts(getDeps().db, 0);
  });

  it('store rejects embedBatch count mismatches before writing rows', async () => {
    const client = await createClient(getDeps());

    vi.mocked(getDeps().embedder.embedBatch).mockResolvedValueOnce([vector(1)]);
    await expect(
      client.store(
        [
          { text: 'first count mismatch', chunkId: 'count-mismatch-1' },
          { text: 'second count mismatch', chunkId: 'count-mismatch-2' },
        ],
        { projectId: 'project-a' },
      ),
    ).rejects.toThrow(InvalidArgumentError);
    expectSourceIndexRowCounts(getDeps().db, 0);

    vi.mocked(getDeps().embedder.embedBatch).mockResolvedValueOnce([
      vector(1),
      vector(2),
      vector(3),
    ]);
    await expect(
      client.store(
        [
          { text: 'first extra embedding', chunkId: 'extra-embedding-1' },
          { text: 'second extra embedding', chunkId: 'extra-embedding-2' },
        ],
        { projectId: 'project-a' },
      ),
    ).rejects.toThrow(InvalidArgumentError);
    expectSourceIndexRowCounts(getDeps().db, 0);
  });

  it('store rejects invalid IDs and pointer fields before embedding', async () => {
    const client = await createClient(getDeps());
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
        client.store([input as unknown as { text: string }], {
          projectId: 'project-a',
        }),
      ).rejects.toThrow(InvalidArgumentError);
    }
    expect(getDeps().embedder.embedBatch).not.toHaveBeenCalled();
    expectSourceIndexRowCounts(getDeps().db, 0);
  });

  it('store rejects malformed Ollama payloads without source-index writes', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        mockFetchResponse({ embeddings: [[Number.NaN, ...Array.from({ length: 767 }, () => 0)]] }),
      );
    try {
      const client = await PristineLocal.create({
        db: getDeps().db,
        embedder: new OllamaEmbedder({ model: 'nomic-embed-text', dim: 768 }),
      });

      await expect(
        client.store([{ text: 'malformed ollama payload', chunkId: 'ollama-bad' }], {
          projectId: 'project-a',
        }),
      ).rejects.toThrow(EmbedderError);
      expectSourceIndexRowCounts(getDeps().db, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
