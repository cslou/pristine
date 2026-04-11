import { describe, expect, it, vi } from 'vitest';
import type { Embedder, Store } from '../../../src/core/interfaces.js';
import type { Memory } from '../../../src/core/types.js';
import { RetrieverError } from '../../../src/core/errors.js';
import { createRetriever } from '../../../src/memory/retriever/index.js';
import {
  CURRENT_FACT_BOOST,
  RECENCY_MAX_BOOST,
  CONFIDENCE_BOOST_INFERRED,
} from '../../../src/memory/retriever/ranking.js';

function makeVector(index: number, value = 1): number[] {
  const v = new Array(768).fill(0);
  v[index] = value;
  return v;
}

function createMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'memory-1',
    userId: 'user-1',
    text: 'base text',
    embedding: makeVector(0),
    contentHash: 'hash',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    lastAccessed: new Date(0).toISOString(),
    metadata: {},
    isDeleted: false,
    ...overrides,
  };
}

function createMockStore(memories: Memory[]): Store {
  return {
    addMemory: vi.fn(),
    getMemory: vi.fn(),
    searchSimilar: vi.fn().mockResolvedValue(memories),
    updateMemory: vi.fn(),
    deleteMemory: vi.fn(),
    supersedeMemory: vi.fn(),
    getSupersessionChain: vi.fn(),
    clearAll: vi.fn(),
  };
}

function createMockEmbedder(embedding: number[]): Embedder {
  return {
    embed: vi.fn().mockResolvedValue(embedding),
    embedBatch: vi.fn().mockResolvedValue([embedding]),
  };
}

describe('retriever', () => {
  it('returns memories ranked by relevance (highest first)', async () => {
    const embedder = createMockEmbedder([1, 0]);
    const store = createMockStore([
      createMemory({ id: 'far', text: 'far', embedding: [0.2, 0.98] }),
      createMemory({ id: 'close', text: 'close', embedding: [1, 0] }),
      createMemory({ id: 'mid', text: 'mid', embedding: [0.5, 0.5] }),
    ]);
    const retriever = createRetriever({ embedder, store });
    const result = await retriever.retrieve('query', 'user-1', { topK: 10 });

    expect(result.memories[0]!.memory.id).toBe('close');
    expect(result.memories[1]!.memory.id).toBe('mid');
    expect(result.memories[2]!.memory.id).toBe('far');
    expect(result.memories[0]!.score).toBeGreaterThan(result.memories[1]!.score);
  });

  it('respects topK limit', async () => {
    const embedder = createMockEmbedder([1, 0]);
    const store = createMockStore([
      createMemory({ id: 'one', embedding: [1, 0] }),
      createMemory({ id: 'two', embedding: [0.9, 0.1] }),
      createMemory({ id: 'three', embedding: [0.8, 0.2] }),
      createMemory({ id: 'four', embedding: [0.7, 0.3] }),
    ]);
    const retriever = createRetriever({ embedder, store });
    const result = await retriever.retrieve('query', 'user-1', { topK: 2 });

    expect(result.memories).toHaveLength(2);
  });

  it('returns all results when fewer than topK exist', async () => {
    const embedder = createMockEmbedder([1, 0]);
    const store = createMockStore([createMemory({ id: 'only', embedding: [1, 0] })]);
    const retriever = createRetriever({ embedder, store });
    const result = await retriever.retrieve('query', 'user-1', { topK: 10 });

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]!.memory.id).toBe('only');
  });

  it('returns empty array when no matches', async () => {
    const embedder = createMockEmbedder([1, 0]);
    const store = createMockStore([]);
    const retriever = createRetriever({ embedder, store });
    const result = await retriever.retrieve('query', 'user-1', { topK: 5 });

    expect(result.memories).toEqual([]);
    expect(result.metadata.totalFound).toBe(0);
  });

  it('passes userId to store.searchSimilar', async () => {
    const embedder = createMockEmbedder([1, 0]);
    const store = createMockStore([createMemory({ embedding: [1, 0] })]);
    const retriever = createRetriever({ embedder, store });
    await retriever.retrieve('query', 'user-123', { topK: 10 });

    expect(store.searchSimilar).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-123' }),
    );
  });

  it('maps score using 1 - cosine_distance', async () => {
    const embedder = createMockEmbedder([2, 0]);
    const store = createMockStore([
      createMemory({ id: 'parallel', embedding: [1, 0] }),
      createMemory({ id: 'orthogonal', embedding: [0, 3] }),
    ]);
    const retriever = createRetriever({ embedder, store });
    const result = await retriever.retrieve('query', 'user-1', { topK: 10 });

    expect(result.memories[0]!.memory.id).toBe('parallel');
    expect(result.memories[0]!.score).toBeCloseTo(1);
    expect(result.memories[1]!.score).toBeCloseTo(0);
  });

  it('throws RetrieverError on empty query', async () => {
    const embedder = createMockEmbedder([1, 0]);
    const store = createMockStore([]);
    const retriever = createRetriever({ embedder, store });

    await expect(retriever.retrieve('', 'user-1')).rejects.toThrow(RetrieverError);
    await expect(retriever.retrieve('', 'user-1')).rejects.toThrow('query cannot be empty');
  });

  it('throws RetrieverError on missing userId', async () => {
    const embedder = createMockEmbedder([1, 0]);
    const store = createMockStore([]);
    const retriever = createRetriever({ embedder, store });

    await expect(retriever.retrieve('query', '')).rejects.toThrow(RetrieverError);
    await expect(retriever.retrieve('query', '')).rejects.toThrow('userId is required');
  });

  it('throws RetrieverError on zero topK', async () => {
    const embedder = createMockEmbedder([1, 0]);
    const store = createMockStore([]);
    const retriever = createRetriever({ embedder, store });

    await expect(retriever.retrieve('query', 'user-1', { topK: 0 })).rejects.toThrow('topK');
  });

  it('uses default topK when not specified', async () => {
    const embedder = createMockEmbedder([1, 0]);
    const store = createMockStore([]);
    const retriever = createRetriever({ embedder, store });
    await retriever.retrieve('query', 'user-1');

    expect(store.searchSimilar).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
  });

  it('wraps embedder errors as RetrieverError', async () => {
    const embedder: Embedder = {
      embed: vi.fn().mockRejectedValue(new Error('upstream embed failed')),
      embedBatch: vi.fn(),
    };
    const store = createMockStore([]);
    const retriever = createRetriever({ embedder, store });

    await expect(retriever.retrieve('query', 'user-1')).rejects.toThrow(RetrieverError);
    await expect(retriever.retrieve('query', 'user-1')).rejects.toThrow('upstream embed failed');
  });

  it('wraps store errors as RetrieverError', async () => {
    const embedder = createMockEmbedder([1, 0]);
    const store: Store = {
      addMemory: vi.fn(),
      getMemory: vi.fn(),
      searchSimilar: vi.fn().mockRejectedValue(new Error('upstream store failed')),
      updateMemory: vi.fn(),
      deleteMemory: vi.fn(),
      supersedeMemory: vi.fn(),
      getSupersessionChain: vi.fn(),
      clearAll: vi.fn(),
    };
    const retriever = createRetriever({ embedder, store });

    await expect(retriever.retrieve('query', 'user-1')).rejects.toThrow(RetrieverError);
    await expect(retriever.retrieve('query', 'user-1')).rejects.toThrow('upstream store failed');
  });

  it('calls embedder exactly once with query', async () => {
    const embedder = createMockEmbedder([1, 0]);
    const store = createMockStore([]);
    const retriever = createRetriever({ embedder, store });
    await retriever.retrieve('my query', 'user-1');

    expect(embedder.embed).toHaveBeenCalledTimes(1);
    expect(embedder.embed).toHaveBeenCalledWith('my query');
  });

  it('returns RetrieveResult with metadata', async () => {
    const embedder = createMockEmbedder([1, 0]);
    const store = createMockStore([
      createMemory({ id: 'one', embedding: [1, 0] }),
      createMemory({ id: 'two', embedding: [0.9, 0.1] }),
    ]);
    const retriever = createRetriever({ embedder, store });
    const result = await retriever.retrieve('query', 'user-1', { topK: 5 });

    expect(result.metadata.totalFound).toBe(2);
    expect(result.metadata.topK).toBe(5);
    expect(result.query.rewrittenQuery).toBe('query');
    expect(result.query.intent).toBe('contextual_search');
  });
});

describe('retriever integration with temporal ranking', () => {
  it('in full mode, current fact ranks above equally-similar superseded fact', async () => {
    const embedding = makeVector(0);
    const currentMem = createMemory({
      id: 'current',
      embedding,
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: undefined,
    });
    const supersededMem = createMemory({
      id: 'superseded',
      embedding,
      validFrom: '2025-01-01T00:00:00.000Z',
      validUntil: '2026-01-01T00:00:00.000Z',
    });

    const embedder = createMockEmbedder(embedding);
    const store = createMockStore([supersededMem, currentMem]);
    const retriever = createRetriever({ embedder, store });
    const result = await retriever.retrieve('query', 'user-1', { temporalMode: 'full' });

    expect(result.memories[0]!.memory.id).toBe('current');
    expect(result.memories[1]!.memory.id).toBe('superseded');
    expect(result.memories[0]!.score).toBeGreaterThan(result.memories[1]!.score);
  });

  it('newer fact ranks above older equally-similar fact via recency bias', async () => {
    const embedding = makeVector(0);
    const newerMem = createMemory({
      id: 'newer',
      embedding,
      validFrom: '2026-03-01T00:00:00.000Z',
    });
    const olderMem = createMemory({
      id: 'older',
      embedding,
      validFrom: '2020-01-01T00:00:00.000Z',
    });

    const embedder = createMockEmbedder(embedding);
    const store = createMockStore([olderMem, newerMem]);
    const retriever = createRetriever({ embedder, store });
    const result = await retriever.retrieve('query', 'user-1');

    expect(result.memories[0]!.memory.id).toBe('newer');
    expect(result.memories[1]!.memory.id).toBe('older');
  });

  it('boosts do not overwhelm cosine similarity', async () => {
    const queryEmbed = makeVector(0);
    const closeMem = createMemory({
      id: 'close',
      embedding: makeVector(0),
      validFrom: '2020-01-01T00:00:00.000Z',
      validUntil: '2025-01-01T00:00:00.000Z',
    });
    const farMem = createMemory({
      id: 'far',
      embedding: makeVector(1),
      validFrom: new Date().toISOString(),
      validUntil: undefined,
    });

    const embedder = createMockEmbedder(queryEmbed);
    const store = createMockStore([closeMem, farMem]);
    const retriever = createRetriever({ embedder, store });
    const result = await retriever.retrieve('query', 'user-1', { temporalMode: 'full' });

    expect(result.memories[0]!.memory.id).toBe('close');
    expect(result.memories[1]!.memory.id).toBe('far');
  });

  it('default temporalMode is current (no current-fact boost applied)', async () => {
    const embedding = makeVector(0);
    const mem = createMemory({
      id: 'mem',
      embedding,
      validFrom: new Date().toISOString(),
    });

    const embedder = createMockEmbedder(embedding);
    const store = createMockStore([mem]);
    const retriever = createRetriever({ embedder, store });
    const result = await retriever.retrieve('query', 'user-1');
    const score = result.memories[0]!.score;

    expect(score).toBeLessThan(
      1 + CURRENT_FACT_BOOST + RECENCY_MAX_BOOST + CONFIDENCE_BOOST_INFERRED,
    );
    expect(score).toBeGreaterThan(1);
  });
});
