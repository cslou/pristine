import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationStore } from '../../../src/conversations/store.js';
import { createDatabase } from '../../../src/core/database.js';
import { InvalidArgumentError } from '../../../src/core/errors.js';
import type { Embedder } from '../../../src/core/interfaces.js';
import { createSearcher } from '../../../src/memory/searcher/index.js';
import * as sqlBackendModule from '../../../src/memory/searcher/sql-backend.js';
import * as sqlParserModule from '../../../src/memory/searcher/sql-parser.js';

let tmpDir: string;
let db: ReturnType<typeof createDatabase>;
let stubExecuteReadOnly: ReturnType<typeof vi.fn>;
let stubWithTimeout: ReturnType<typeof vi.fn>;

const stubEmbedder: Embedder = {
  dim: 768,
  embed: async (): Promise<number[]> => Array.from({ length: 768 }, () => 0),
  embedBatch: async (texts: readonly string[]): Promise<number[][]> =>
    texts.map(() => Array.from({ length: 768 }, () => 0)),
};

beforeAll(() => {
  // searcher.sql now rejects `:memory:` db.name at the public surface
  // (the per-call RO connection cannot share state with an in-memory
  // writable DB). Use a tmpdir-backed file DB so the new guard does
  // not trip on tests that stub the sql-backend below.
  tmpDir = mkdtempSync(join(tmpdir(), 'sql-method-test-'));
  db = createDatabase({
    path: join(tmpDir, 'test.db'),
    loadSqliteVec: true,
    runIntegrityCheck: false,
  });
  // ConversationStore initialises the corpus tables (messages, conversations,
  // window_messages, ...) that createSearcher prepares statements against at
  // construction time. We don't seed any rows — every test below stubs the
  // sql-backend, so no real query runs.
  new ConversationStore(db);
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  stubExecuteReadOnly = vi.fn().mockResolvedValue([]);
  stubWithTimeout = vi.fn();
  // Intercept createSqlBackend so the factory's bound backend is our stub —
  // the returned executeReadOnly is the spy that records call args + order.
  vi.spyOn(sqlBackendModule, 'createSqlBackend').mockReturnValue({
    executeReadOnly: stubExecuteReadOnly as unknown as ReturnType<
      typeof sqlBackendModule.createSqlBackend
    >['executeReadOnly'],
    withTimeout: stubWithTimeout as unknown as ReturnType<
      typeof sqlBackendModule.createSqlBackend
    >['withTimeout'],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('searcher.sql — order-of-operations', () => {
  it('runs validateSqlAccess strictly before executeReadOnly', async () => {
    const validateSpy = vi.spyOn(sqlParserModule, 'validateSqlAccess');
    const searcher = createSearcher({ db, embedder: stubEmbedder });
    await searcher.sql('SELECT * FROM messages_public');

    expect(validateSpy).toHaveBeenCalledTimes(1);
    expect(stubExecuteReadOnly).toHaveBeenCalledTimes(1);
    const validateOrder = validateSpy.mock.invocationCallOrder[0];
    const executeOrder = stubExecuteReadOnly.mock.invocationCallOrder[0];
    expect(validateOrder).toBeLessThan(executeOrder);
  });

  it('does not call executeReadOnly when validateSqlAccess throws', async () => {
    const searcher = createSearcher({ db, embedder: stubEmbedder });
    await expect(searcher.sql('DROP TABLE messages_public')).rejects.toThrow();
    expect(stubExecuteReadOnly).not.toHaveBeenCalled();
  });
});

describe('searcher.sql — default-opt application', () => {
  it('applies rowCap=1000 + timeoutMs=5000 when opts is omitted', async () => {
    const searcher = createSearcher({ db, embedder: stubEmbedder });
    await searcher.sql('SELECT * FROM messages_public');

    const call = stubExecuteReadOnly.mock.calls[0];
    // call args: (sql, params, opts)
    expect(call[2]).toEqual({ rowCap: 1000, timeoutMs: 5000 });
    // params defaults to [] when not supplied
    expect(call[1]).toEqual([]);
  });

  it('overrides defaults when opts.rowCap and opts.timeoutMs are supplied', async () => {
    const searcher = createSearcher({ db, embedder: stubEmbedder });
    await searcher.sql('SELECT * FROM messages_public', {
      rowCap: 50,
      timeoutMs: 1500,
    });

    const call = stubExecuteReadOnly.mock.calls[0];
    expect(call[2]).toEqual({ rowCap: 50, timeoutMs: 1500 });
  });

  it('forwards opts.params to executeReadOnly', async () => {
    const searcher = createSearcher({ db, embedder: stubEmbedder });
    await searcher.sql('SELECT * FROM messages_public WHERE project_id = ?', {
      params: ['proj-A'],
    });

    const call = stubExecuteReadOnly.mock.calls[0];
    expect(call[1]).toEqual(['proj-A']);
  });
});

describe('searcher.sql — :memory: guard', () => {
  it('rejects in-memory DB with InvalidArgumentError when sql is called', async () => {
    // Construct a fresh searcher backed by an in-memory DB. The four
    // search methods work fine against :memory:; only sql is gated
    // because it opens a separate read-only connection that cannot share
    // the writable DB's pages. The guard fires at first call, not at
    // factory time, so existing tests that use :memory: for vector/FTS
    // are unaffected.
    const memDb = createDatabase({
      path: ':memory:',
      loadSqliteVec: true,
      runIntegrityCheck: false,
    });
    new ConversationStore(memDb);
    const searcher = createSearcher({ db: memDb, embedder: stubEmbedder });
    try {
      await expect(searcher.sql('SELECT * FROM messages_public')).rejects.toThrow(
        InvalidArgumentError,
      );
    } finally {
      memDb.close();
    }
  });
});

describe('Searcher JSDoc placement (AC line 206)', () => {
  it('contains all five method names in a contiguous block above the Searcher interface', async () => {
    // The AC pass condition is: a single contiguous JSDoc block contains
    // references to vectorSearch, ftsSearch, hybridSearch,
    // sessionVectorSearch, AND sql. Read the source and assert all five
    // identifiers appear within the block immediately preceding the
    // `export interface Searcher {` declaration.
    const fs = await import('node:fs');
    const url = new URL('../../../src/memory/searcher/index.ts', import.meta.url);
    const src = fs.readFileSync(url, 'utf-8');
    const match = src.match(/\/\*\*([^*]|\*(?!\/))*\*\/\s*export interface Searcher\s*\{/);
    expect(match).not.toBeNull();
    const block = match?.[0] ?? '';
    for (const method of [
      'vectorSearch',
      'ftsSearch',
      'hybridSearch',
      'sessionVectorSearch',
      'sql',
    ]) {
      expect(block).toContain(method);
    }
  });
});
