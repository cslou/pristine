import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConversationStore } from '../../../src/conversations/store.js';
import { createDatabase } from '../../../src/core/database.js';
import { ConversationNotFoundError, InvalidArgumentError } from '../../../src/core/errors.js';
import type { Embedder } from '../../../src/core/interfaces.js';
import { createIndexer } from '../../../src/memory/indexer/index.js';
import { buildSessionVector } from '../../../src/memory/indexer/session-vector.js';
import { IngestQueue } from '../../../src/queue/ingest-queue.js';

let db: ReturnType<typeof createDatabase>;
let store: ConversationStore;
let queue: IngestQueue;

beforeAll(() => {
  db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
  store = new ConversationStore(db, 768);
  queue = new IngestQueue({ db });
});

beforeEach(() => {
  // FK order: window_messages depends on messages.id; clear that first.
  db.exec('DELETE FROM window_messages');
  db.exec('DELETE FROM vec_windows');
  db.exec('DELETE FROM vec_sessions');
  db.exec('DELETE FROM pending_ingest_tasks');
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM conversations');
});

afterAll(() => {
  db.close();
});

const makeMessages = (contents: string[]) =>
  contents.map((content, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content,
  }));

const makeStubEmbedder = (
  vector: number[] = Array.from({ length: 768 }, (_, i) => 0.5 + i * 1e-4),
) => {
  const calls: string[] = [];
  const embedder: Embedder = {
    dim: 768,
    embed: async (text: string): Promise<number[]> => {
      calls.push(text);
      return vector;
    },
    embedBatch: async (_texts: readonly string[]): Promise<number[][]> => {
      throw new Error('embedBatch not used in these tests');
    },
  };
  return { embedder, calls };
};

const readEmbedding = (buf: Buffer): Float32Array =>
  new Float32Array(buf.buffer, buf.byteOffset, 768);

describe('buildSessionVector (helper)', () => {
  it('embeds the role-prefixed concat of all conversation messages and writes to vec_sessions', async () => {
    const conversationId = store.addConversation(
      makeMessages(['hi', 'hello', 'how are you?', 'great thanks']),
      'user-1',
    );
    const { embedder, calls } = makeStubEmbedder();

    await buildSessionVector(db, embedder, conversationId);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(
      'user: hi\nassistant: hello\nuser: how are you?\nassistant: great thanks',
    );

    const row = db
      .prepare(
        'SELECT conversation_id, embedding, updated_at FROM vec_sessions WHERE conversation_id = ?',
      )
      .get(conversationId) as {
      conversation_id: string;
      embedding: Buffer;
      updated_at: number | bigint;
    };
    expect(row.conversation_id).toBe(conversationId);
    expect(Number(row.updated_at)).toBeGreaterThan(Date.now() - 60_000);
    expect(Number(row.updated_at)).toBeLessThanOrEqual(Date.now());

    const stored = readEmbedding(row.embedding);
    expect(stored.length).toBe(768);
    // Bit-identical round-trip on the first index (full check below).
    const expected = Float32Array.from(Array.from({ length: 768 }, (_, i) => 0.5 + i * 1e-4));
    for (let i = 0; i < 768; i++) {
      expect(stored[i]).toBe(expected[i]);
    }
  });

  it('is idempotent — re-running overwrites cleanly via DELETE+INSERT', async () => {
    const conversationId = store.addConversation(makeMessages(['hi']), 'user-rebuild');
    const { embedder: emb1 } = makeStubEmbedder(Array.from({ length: 768 }, () => 0.1));
    const { embedder: emb2 } = makeStubEmbedder(Array.from({ length: 768 }, () => 0.9));

    await buildSessionVector(db, emb1, conversationId);
    const firstUpdatedAt = Number(
      (
        db
          .prepare('SELECT updated_at FROM vec_sessions WHERE conversation_id = ?')
          .get(conversationId) as { updated_at: number | bigint }
      ).updated_at,
    );

    // Wait at least 1ms so updated_at advances visibly.
    await new Promise((resolve) => setTimeout(resolve, 5));

    await buildSessionVector(db, emb2, conversationId);

    const rows = db
      .prepare('SELECT embedding, updated_at FROM vec_sessions WHERE conversation_id = ?')
      .all(conversationId) as { embedding: Buffer; updated_at: number | bigint }[];
    // Single row — the DELETE+INSERT idiom guarantees no accumulation.
    expect(rows).toHaveLength(1);

    const stored = readEmbedding(rows[0].embedding);
    // 0.9 in Float64 → Float32 → readback isn't bit-identical (~1e-8 drift);
    // toBeCloseTo with 4 decimals is enough to distinguish from 0.1 (emb1).
    expect(stored[0]).toBeCloseTo(0.9, 4);
    expect(Number(rows[0].updated_at)).toBeGreaterThanOrEqual(firstUpdatedAt);
  });

  it('throws ConversationNotFoundError when conversationId does not resolve', async () => {
    const { embedder } = makeStubEmbedder();
    await expect(buildSessionVector(db, embedder, 'does-not-exist')).rejects.toBeInstanceOf(
      ConversationNotFoundError,
    );
  });

  it('is a no-op on a conversation with zero messages (no vec_sessions row written)', async () => {
    // Construct a conversation with no messages — addConversation requires
    // at least one, so we INSERT directly.
    const conversationId = 'conv-empty';
    db.prepare("INSERT INTO conversations(id, user_id, content_hash) VALUES (?, ?, 'h')").run(
      conversationId,
      'user-empty',
    );

    const { embedder, calls } = makeStubEmbedder();
    await buildSessionVector(db, embedder, conversationId);

    // Embedder NOT called — no content to embed.
    expect(calls).toHaveLength(0);

    const count = (
      db
        .prepare('SELECT COUNT(*) AS c FROM vec_sessions WHERE conversation_id = ?')
        .get(conversationId) as { c: number }
    ).c;
    expect(count).toBe(0);
  });

  it('preserves the prior vec_sessions row when the embedder throws on rebuild', async () => {
    // Atomicity / rollback case: a prior session vector exists; the
    // embedder fails on rebuild; the prior row stays intact. Achieved
    // because the embed runs BEFORE the DELETE+INSERT transaction opens
    // — the transaction never starts on failure.
    const conversationId = store.addConversation(makeMessages(['hi']), 'user-prior');
    const { embedder: goodEmbedder } = makeStubEmbedder(Array.from({ length: 768 }, () => 0.123));
    await buildSessionVector(db, goodEmbedder, conversationId);

    const priorRow = db
      .prepare('SELECT updated_at FROM vec_sessions WHERE conversation_id = ?')
      .get(conversationId) as { updated_at: number | bigint };
    const priorUpdatedAt = Number(priorRow.updated_at);

    const failingEmbedder: Embedder = {
      dim: 768,
      embed: async (): Promise<number[]> => {
        throw new Error('rebuild failure');
      },
      embedBatch: async (): Promise<number[][]> => {
        throw new Error('not used');
      },
    };

    await expect(buildSessionVector(db, failingEmbedder, conversationId)).rejects.toThrow(
      'rebuild failure',
    );

    // Prior row still present, unchanged.
    const after = db
      .prepare('SELECT updated_at, embedding FROM vec_sessions WHERE conversation_id = ?')
      .all(conversationId) as { updated_at: number | bigint; embedding: Buffer }[];
    expect(after).toHaveLength(1);
    expect(Number(after[0].updated_at)).toBe(priorUpdatedAt);
    const stored = readEmbedding(after[0].embedding);
    expect(stored[0]).toBeCloseTo(0.123, 4);
  });

  it('throws InvalidArgumentError when joined session text exceeds the token budget', async () => {
    const conversationId = store.addConversation(makeMessages(['hi']), 'user-toobig');
    const { embedder, calls } = makeStubEmbedder();
    // Inject a tokenCounter that always returns a count above the
    // (default 3000) maxTokens — exercises the guard without requiring
    // 12K chars of fixture content.
    await expect(
      buildSessionVector(db, embedder, conversationId, {
        tokenCounter: () => 999_999,
      }),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
    expect(calls).toHaveLength(0); // Embedder NOT called.
    const count = (
      db
        .prepare('SELECT COUNT(*) AS c FROM vec_sessions WHERE conversation_id = ?')
        .get(conversationId) as { c: number }
    ).c;
    expect(count).toBe(0);
  });

  it('respects an explicitly-raised maxTokens option', async () => {
    const conversationId = store.addConversation(makeMessages(['hi']), 'user-bigmax');
    const { embedder, calls } = makeStubEmbedder();
    // tokenCounter returns 5000; default maxTokens=3000 would throw, but
    // raising maxTokens to 10000 lets it through.
    await buildSessionVector(db, embedder, conversationId, {
      tokenCounter: () => 5000,
      maxTokens: 10_000,
    });
    expect(calls).toHaveLength(1);
    const count = (
      db
        .prepare('SELECT COUNT(*) AS c FROM vec_sessions WHERE conversation_id = ?')
        .get(conversationId) as { c: number }
    ).c;
    expect(count).toBe(1);
  });

  it('does not write a partial row if the embedder throws (transaction rollback)', async () => {
    const conversationId = store.addConversation(makeMessages(['hi']), 'user-fail');
    const failingEmbedder: Embedder = {
      dim: 768,
      embed: async (): Promise<number[]> => {
        throw new Error('embedder simulated failure');
      },
      embedBatch: async (): Promise<number[][]> => {
        throw new Error('not used');
      },
    };

    await expect(buildSessionVector(db, failingEmbedder, conversationId)).rejects.toThrow(
      'embedder simulated failure',
    );

    const count = (
      db
        .prepare('SELECT COUNT(*) AS c FROM vec_sessions WHERE conversation_id = ?')
        .get(conversationId) as { c: number }
    ).c;
    expect(count).toBe(0);
  });
});

describe('Indexer.buildSessionVector (facade method)', () => {
  it('exposes the helper as a method on the createIndexer() return', async () => {
    const conversationId = store.addConversation(makeMessages(['hi', 'hello']), 'user-facade');
    const { embedder } = makeStubEmbedder();
    const indexer = createIndexer({
      db,
      conversationStore: store,
      ingestQueue: queue,
      embedder,
    });

    await indexer.buildSessionVector(conversationId);

    const count = (
      db
        .prepare('SELECT COUNT(*) AS c FROM vec_sessions WHERE conversation_id = ?')
        .get(conversationId) as { c: number }
    ).c;
    expect(count).toBe(1);
  });

  it('throws InvalidArgumentError if deps.embedder is missing', async () => {
    const conversationId = store.addConversation(makeMessages(['hi']), 'user-noembed');
    // No embedder in deps — the ingest path doesn't need one, so the
    // dep is optional. buildSessionVector requires it.
    const indexer = createIndexer({
      db,
      conversationStore: store,
      ingestQueue: queue,
    });

    await expect(indexer.buildSessionVector(conversationId)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('throws InvalidArgumentError on empty conversationId', async () => {
    const { embedder } = makeStubEmbedder();
    const indexer = createIndexer({
      db,
      conversationStore: store,
      ingestQueue: queue,
      embedder,
    });

    await expect(indexer.buildSessionVector('')).rejects.toBeInstanceOf(InvalidArgumentError);
  });
});
