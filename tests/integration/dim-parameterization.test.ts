import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { PristineLocal } from '../../src/client.js';
import { createDatabase } from '../../src/core/database.js';
import type { Embedder } from '../../src/core/interfaces.js';

// ---------------------------------------------------------------------------
// Custom-dim integration — happy path
// ---------------------------------------------------------------------------
//
// Pins:
//   1. A consumer-supplied stub embedder at dim=1024 is threaded through
//      `PristineLocal.create` to `ConversationStore`, so the resulting
//      `vec_windows` and `vec_sessions` DDL contains `float[1024]`.
//   2. A full `storeAsync` → drain → `searcher.vectorSearch` round-trip
//      succeeds with 1024-d vectors, proving the searcher reads dim from
//      `embedder.dim` rather than a hardcoded constant.

const CUSTOM_DIM = 1024;

const makeStubEmbedderAtDim = (dim: number): Embedder => ({
  dim,
  embed: async (text: string): Promise<number[]> => {
    const seed = text.length / 1000;
    return Array.from({ length: dim }, (_, i) => seed + i * 1e-4);
  },
  embedBatch: async (texts: readonly string[]): Promise<number[][]> =>
    texts.map((text) => {
      const seed = text.length / 1000;
      return Array.from({ length: dim }, (_, i) => seed + i * 1e-4);
    }),
});

describe('PristineLocal.create — custom dim threading', () => {
  let db: Database.Database;
  let client: PristineLocal;

  beforeEach(async () => {
    db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    client = await PristineLocal.create({
      db,
      embedder: makeStubEmbedderAtDim(CUSTOM_DIM),
    });
  });

  afterEach(async () => {
    await client.dispose();
    db.close();
  });

  it('templates vec_windows DDL with float[1024] when the configured embedder dim is 1024', () => {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vec_windows'").get() as
      | { sql: string | null }
      | undefined;

    expect(row).toBeDefined();
    expect(row!.sql).toContain(`float[${String(CUSTOM_DIM)}]`);
    expect(row!.sql).not.toContain('float[768]');
  });

  it('templates vec_sessions DDL with float[1024] when the configured embedder dim is 1024', () => {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vec_sessions'").get() as
      | { sql: string | null }
      | undefined;

    expect(row).toBeDefined();
    expect(row!.sql).toContain(`float[${String(CUSTOM_DIM)}]`);
    expect(row!.sql).not.toContain('float[768]');
  });

  it('storeAsync → drain → searcher.vectorSearch round-trips at dim=1024', async () => {
    const turns = [
      { role: 'user' as const, content: 'first message about retrieval' },
      { role: 'assistant' as const, content: 'second message answering retrieval' },
      { role: 'user' as const, content: 'third message asking another question' },
      { role: 'assistant' as const, content: 'fourth message giving final answer' },
    ];

    const conversationId = client.storeAsync(turns, 'test-user', 'test-project');
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);

    const processed = await client.drainEmbedQueue();
    expect(processed).toBeGreaterThan(0);

    const hits = await client.searcher.vectorSearch(
      'retrieval question',
      { projectId: 'test-project' },
      5,
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.conversationId).toBe(conversationId);
  });
});
