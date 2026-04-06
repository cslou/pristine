import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../../src/core/database.js';
import { SqliteStore } from '../../../src/memory/store/sqlite/index.js';
import type { AddMemoryInput } from '../../../src/core/types.js';

let db: ReturnType<typeof createDatabase>;
let store: SqliteStore;

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

// Generate a 768-dim embedding with a known pattern for testing similarity
const makeEmbedding = (seed: number): number[] => {
  const emb = new Array<number>(768).fill(0);
  emb[0] = seed;
  emb[1] = seed * 0.5;
  // Normalize to unit length for cosine distance
  const norm = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
  return emb.map((v) => v / norm);
};

const makeInput = (
  text: string,
  seed: number,
  overrides: Partial<AddMemoryInput> = {},
): AddMemoryInput => ({
  userId: 'user-1',
  text,
  embedding: makeEmbedding(seed),
  contentHash: hash(text),
  ...overrides,
});

beforeAll(() => {
  db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
  store = new SqliteStore(db);
});

beforeEach(() => {
  db.exec('DELETE FROM memory_vectors');
  db.exec('DELETE FROM memories');
});

afterAll(() => {
  db.close();
});

describe('SqliteStore vector search', () => {
  it('searchSimilar returns memories ranked by cosine distance', async () => {
    await store.addMemory(makeInput('User likes espresso.', 1.0));
    await store.addMemory(makeInput('User prefers cold brew.', 0.9));
    await store.addMemory(makeInput('User enjoys hiking.', 0.1));

    const results = await store.searchSimilar({
      embedding: makeEmbedding(1.0),
      limit: 3,
      userId: 'user-1',
      temporalMode: 'full',
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
    // First result should be the closest match (seed 1.0 query matches seed 1.0 memory)
    expect(results[0]!.text).toBe('User likes espresso.');
  });

  it('searchSimilar respects limit', async () => {
    await store.addMemory(makeInput('Fact A', 1.0));
    await store.addMemory(makeInput('Fact B', 0.9));
    await store.addMemory(makeInput('Fact C', 0.8));

    const results = await store.searchSimilar({
      embedding: makeEmbedding(1.0),
      limit: 2,
      userId: 'user-1',
      temporalMode: 'full',
    });

    expect(results).toHaveLength(2);
  });

  it('searchSimilar excludes deleted memories', async () => {
    const mem = await store.addMemory(makeInput('Deleted fact.', 1.0));
    await store.deleteMemory(mem.id, 'user-1');

    const results = await store.searchSimilar({
      embedding: makeEmbedding(1.0),
      limit: 10,
      userId: 'user-1',
      temporalMode: 'full',
    });

    expect(results).toHaveLength(0);
  });

  it('searchSimilar excludes other users', async () => {
    await store.addMemory(makeInput('Other user fact.', 1.0, { userId: 'user-other' }));

    const results = await store.searchSimilar({
      embedding: makeEmbedding(1.0),
      limit: 10,
      userId: 'user-1',
      temporalMode: 'full',
    });

    expect(results).toHaveLength(0);
  });

  it('searchSimilar current mode excludes memories with valid_until set', async () => {
    await store.addMemory(
      makeInput('Current fact.', 1.0, { validFrom: '2025-01-01T00:00:00.000Z' }),
    );
    await store.addMemory(
      makeInput('Expired fact.', 0.9, {
        validFrom: '2024-01-01T00:00:00.000Z',
        validUntil: '2025-01-01T00:00:00.000Z',
      }),
    );

    const results = await store.searchSimilar({
      embedding: makeEmbedding(1.0),
      limit: 10,
      userId: 'user-1',
      temporalMode: 'current',
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.text).toBe('Current fact.');
  });

  it('searchSimilar throws on as_of without timestamp', async () => {
    await expect(
      store.searchSimilar({
        embedding: makeEmbedding(1.0),
        limit: 10,
        userId: 'user-1',
        temporalMode: 'as_of',
      }),
    ).rejects.toThrow('as_of mode requires an asOf timestamp');
  });
});

describe('SqliteStore FTS5 keyword search', () => {
  it('searchByKeyword finds matching memories', async () => {
    await store.addMemory(makeInput('User likes espresso coffee.', 1.0));
    await store.addMemory(makeInput('User enjoys hiking mountains.', 0.5));

    const results = await store.searchByKeyword('espresso', 'user-1', 10);

    expect(results).toHaveLength(1);
    expect(results[0]!.text).toContain('espresso');
  });

  it('searchByKeyword excludes deleted memories', async () => {
    const mem = await store.addMemory(makeInput('Deleted espresso fact.', 1.0));
    await store.deleteMemory(mem.id, 'user-1');

    const results = await store.searchByKeyword('espresso', 'user-1', 10);
    expect(results).toHaveLength(0);
  });

  it('searchByKeyword returns empty for no matches', async () => {
    await store.addMemory(makeInput('User likes tea.', 1.0));

    const results = await store.searchByKeyword('espresso', 'user-1', 10);
    expect(results).toHaveLength(0);
  });
});

describe('SqliteStore supersession', () => {
  it('supersedeMemory creates linked new memory and updates old', async () => {
    const old = await store.addMemory(makeInput('User works at Google.', 1.0));

    const result = await store.supersedeMemory(
      old.id,
      makeInput('User works at Meta.', 0.9),
      'Job change',
    );

    expect(result.newMemory.text).toBe('User works at Meta.');
    expect(result.newMemory.supersedes).toBe(old.id);
    expect(result.oldMemory.supersededBy).toBe(result.newMemory.id);
    expect(result.oldMemory.supersessionReason).toBe('Job change');
    expect(result.oldMemory.validUntil).toBeDefined();
  });

  it('supersedeMemory throws for already-superseded memory', async () => {
    const old = await store.addMemory(makeInput('Original fact.', 1.0));
    await store.supersedeMemory(old.id, makeInput('Updated fact.', 0.9), 'Update');

    await expect(
      store.supersedeMemory(old.id, makeInput('Another update.', 0.8), 'Second update'),
    ).rejects.toThrow('already superseded');
  });

  it('supersedeMemory throws for deleted memory', async () => {
    const old = await store.addMemory(makeInput('To delete.', 1.0));
    await store.deleteMemory(old.id, 'user-1');

    await expect(
      store.supersedeMemory(old.id, makeInput('Replacement.', 0.9), 'Replace'),
    ).rejects.toThrow('not found');
  });

  it('getSupersessionChain returns full chain', async () => {
    const a = await store.addMemory(makeInput('Version A.', 1.0));
    const { newMemory: b } = await store.supersedeMemory(
      a.id,
      makeInput('Version B.', 0.9),
      'Update 1',
    );
    const { newMemory: c } = await store.supersedeMemory(
      b.id,
      makeInput('Version C.', 0.8),
      'Update 2',
    );

    const chain = await store.getSupersessionChain(b.id, 'user-1');

    expect(chain).toHaveLength(3);
    expect(chain[0]!.id).toBe(a.id);
    expect(chain[1]!.id).toBe(b.id);
    expect(chain[2]!.id).toBe(c.id);
  });

  it('getSupersessionChain returns empty for nonexistent memory', async () => {
    const chain = await store.getSupersessionChain('nonexistent', 'user-1');
    expect(chain).toHaveLength(0);
  });
});
