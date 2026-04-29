import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { PristineLocal } from '../../src/client.js';
import { createDatabase } from '../../src/core/database.js';
import type { Embedder } from '../../src/core/interfaces.js';
import { runEmbedWorker } from '../../src/memory/indexer/embed-worker.js';

// ---------------------------------------------------------------------------
// Sprint-016 Story 1 — storeAsync end-to-end populates corpus via worker drain
// ---------------------------------------------------------------------------
//
// Asserts that the public SDK surface `Pristine.create({...}).storeAsync`
// drives the same Phase-3 pipeline scripts/smoke-indexer.ts proves works
// at the module level: messages inserted, embed-message tasks enqueued,
// worker drains them, vec_windows / window_messages / messages_fts
// populated. This is the integration-shaped contract the searcher
// primitive (Stories 2-6) will read from.

// Deterministic 768-d stub: same seed-by-length shape as
// tests/integration/indexer.test.ts so output stays stable across runs
// without paying the real Nomic load cost.
const makeStubEmbedder = (): Embedder => ({
  embed: async (text: string): Promise<number[]> => {
    const seed = text.length / 1000;
    return Array.from({ length: 768 }, (_, i) => seed + i * 1e-4);
  },
  embedBatch: async (texts: readonly string[]): Promise<number[][]> =>
    texts.map((text) => {
      const seed = text.length / 1000;
      return Array.from({ length: 768 }, (_, i) => seed + i * 1e-4);
    }),
});

describe('storeAsync — end-to-end corpus population (sprint-016 Story 1)', () => {
  let db: Database.Database;
  let client: PristineLocal;

  beforeEach(async () => {
    db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    client = await PristineLocal.create({
      db,
      embedder: makeStubEmbedder(),
    });
  });

  afterEach(async () => {
    await client.dispose();
    db.close();
  });

  it('populates messages + vec_windows + window_messages + messages_fts after worker drain', async () => {
    // 6 turns → with windowSize=3, overlap=1, stride=2: windows [0..2],
    // [2..4], [3..5] (tail-slid) → 3 distinct vec_windows, 9
    // window_messages (3 windows × 3 messages each).
    const turns = [
      { role: 'user' as const, content: 'turn one — talking about indexing' },
      { role: 'assistant' as const, content: 'turn two — asking about retrieval' },
      { role: 'user' as const, content: 'turn three — explaining sliding windows' },
      { role: 'assistant' as const, content: 'turn four — clarifying the overlap' },
      { role: 'user' as const, content: 'turn five — wrapping up' },
      { role: 'assistant' as const, content: 'turn six — final answer' },
    ];

    const conversationId = client.storeAsync(turns, 'sprint-016-user', 'sprint-016-project');
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);

    // Pre-drain: messages already inserted (synchronous), embed tasks
    // pending, no vec rows yet.
    const messagesBefore = (db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number })
      .n;
    expect(messagesBefore).toBe(6);

    const pendingBefore = client.ingestQueue.pending;
    expect(pendingBefore).toBe(6);

    const vecBefore = (db.prepare('SELECT COUNT(*) AS n FROM vec_windows').get() as { n: number })
      .n;
    expect(vecBefore).toBe(0);

    // Drain the queue — the embed-worker handler is the one Pristine.create
    // wired up in commit 1.
    const processed = await runEmbedWorker(client.ingestQueue);
    expect(processed).toBe(6);

    // Post-drain: corpus + queue match the smoke-indexer expected counts.
    const counts = {
      messages: (db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n,
      vec_windows: (db.prepare('SELECT COUNT(*) AS n FROM vec_windows').get() as { n: number }).n,
      window_messages: (
        db.prepare('SELECT COUNT(*) AS n FROM window_messages').get() as { n: number }
      ).n,
      messages_fts: (db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get() as { n: number }).n,
      completed: (
        db
          .prepare("SELECT COUNT(*) AS n FROM pending_ingest_tasks WHERE status = 'completed'")
          .get() as { n: number }
      ).n,
      failed: (
        db
          .prepare("SELECT COUNT(*) AS n FROM pending_ingest_tasks WHERE status = 'failed'")
          .get() as { n: number }
      ).n,
    };

    expect(counts).toEqual({
      messages: 6,
      vec_windows: 3,
      window_messages: 9,
      messages_fts: 6,
      completed: 6,
      failed: 0,
    });

    // searchConversations returns the populated FTS hit by keyword.
    const hits = client.searchConversations({
      userId: 'sprint-016-user',
      keyword: 'sliding',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(conversationId);

    // getConversation returns all 6 messages.
    const detail = client.getConversation(conversationId);
    expect(detail).not.toBeNull();
    expect(detail!.messages).toHaveLength(6);
    expect(detail!.userId).toBe('sprint-016-user');
  });

  it('rolls back the conversation row when indexer.ingest fails (atomic transaction)', async () => {
    // Sequence: storeAsync calls addEmptyConversation (which succeeds for
    // `[]` — writes a conversation row with the empty-array content_hash),
    // then calls indexer.ingest which throws
    // `InvalidArgumentError: turns must be a non-empty array`. With the
    // storeAsync atomic-transaction wrapper, the conversation INSERT rolls
    // back when indexer.ingest throws; without it, the row would leak
    // (orphaned, content_hash-locked, unrecoverable).
    //
    // The DB is fresh per test (beforeEach creates an in-memory DB), so a
    // hardcoded baseline of 0 is safe — no prior-test rows to confound the
    // count.
    expect(() => client.storeAsync([], 'rollback-user', 'rollback-project')).toThrow(
      /non-empty array/,
    );

    const conversations = (
      db.prepare('SELECT COUNT(*) AS n FROM conversations').get() as { n: number }
    ).n;
    expect(conversations).toBe(0);

    const tasks = (
      db.prepare('SELECT COUNT(*) AS n FROM pending_ingest_tasks').get() as { n: number }
    ).n;
    expect(tasks).toBe(0);
  });

  it('returns existing conversationId on duplicate without re-enqueueing', async () => {
    const turns = [
      { role: 'user' as const, content: 'duplicate-test message' },
      { role: 'assistant' as const, content: 'duplicate-test reply' },
    ];

    const first = client.storeAsync(turns, 'dup-user');
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(client.ingestQueue.pending).toBe(2);

    // Drain so the second call doesn't see lingering pending rows.
    await runEmbedWorker(client.ingestQueue);

    const second = client.storeAsync(turns, 'dup-user');
    expect(second).toBe(first);

    // Duplicate path returns early — no new tasks enqueued, no new
    // messages inserted.
    expect(client.ingestQueue.pending).toBe(0);
    const totalTasks = (
      db.prepare('SELECT COUNT(*) AS n FROM pending_ingest_tasks').get() as { n: number }
    ).n;
    expect(totalTasks).toBe(2);

    const totalMessages = (db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number })
      .n;
    expect(totalMessages).toBe(2);

    const conversationCount = (
      db.prepare('SELECT COUNT(*) AS n FROM conversations').get() as { n: number }
    ).n;
    expect(conversationCount).toBe(1);
  });
});
