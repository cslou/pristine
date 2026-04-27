import { describe, expect, it } from 'vitest';
import { createSearcher } from '../../../src/memory/searcher/index.js';
import { InvalidArgumentError } from '../../../src/core/errors.js';
import type { Embedder } from '../../../src/core/interfaces.js';
import type Database from 'better-sqlite3';

// Argument-validation tests don't need a real DB — the guards run before
// any DB call. A no-op stub db is fine for these cases.
const noopDb = {
  prepare: () => {
    throw new Error('noopDb.prepare should not be reached on validation paths');
  },
} as unknown as Database.Database;

const makeStubEmbedder = (vec: number[] = Array(768).fill(0.5)): Embedder => ({
  embed: async () => vec,
  embedBatch: async () => {
    throw new Error('embedBatch not used');
  },
});

describe('searcher.vectorSearch — argument validation', () => {
  const searcher = createSearcher({ db: noopDb, embedder: makeStubEmbedder() });
  const validFilters = { projectId: 'p' };

  it('rejects empty query string', async () => {
    await expect(searcher.vectorSearch('', validFilters, 10)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects empty projectId', async () => {
    await expect(searcher.vectorSearch('q', { projectId: '' }, 10)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects limit = 0', async () => {
    await expect(searcher.vectorSearch('q', validFilters, 0)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects negative limit', async () => {
    await expect(searcher.vectorSearch('q', validFilters, -1)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects non-integer limit', async () => {
    await expect(searcher.vectorSearch('q', validFilters, 1.5)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects limit > 1000', async () => {
    await expect(searcher.vectorSearch('q', validFilters, 1001)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });
});
