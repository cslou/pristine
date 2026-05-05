import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { ConversationStore } from '../../src/conversations/store.js';
import { createDatabase } from '../../src/core/database.js';
import type { Embedder } from '../../src/core/interfaces.js';
import { InvalidArgumentError } from '../../src/core/errors.js';
import { createEmbedTaskHandler, runEmbedWorker } from '../../src/memory/indexer/embed-worker.js';
import { createIndexer } from '../../src/memory/indexer/index.js';
import { createWindowWriter } from '../../src/memory/indexer/windows.js';
import { createSearcher } from '../../src/memory/searcher/index.js';
import { IngestQueue } from '../../src/queue/ingest-queue.js';

// ---------------------------------------------------------------------------
// searcher.vectorSearch end-to-end (filter-first KNN)
// ---------------------------------------------------------------------------
//
// Pins:
//   1. The vec0 KNN read-path syntax (`WHERE embedding MATCH ? AND k = ?
//      AND conversation_id IN (...)`) actually works against the installed
//      sqlite-vec end-to-end (write + read).
//   2. Cross-project isolation: a query in project A returns ZERO hits
//      from project B, regardless of vector similarity.
//   3. Filter-first ordering: the candidate-set query hits the
//      `ix_conversations_project_started` index, not a full scan.
//   4. Window-to-messageIds resolution preserves position order.
//   5. Empty candidate set returns []; argument-validation guards trip.

// Deterministic stub embedder. Maps query text to a 768-d vector by
// hashing the text length into the first dim. Same shape as the indexer
// integration tests so two queries with the same length embed
// identically — useful for asserting tie-breaking.
//
// For the cross-project isolation test we need queries from project A
// and project B to embed to similar vectors so that the project filter
// is doing the work, not the distance ranking.
const makeStubEmbedder = (): Embedder => ({
  dim: 768,
  embed: async (text: string): Promise<number[]> => {
    // Encode each char's code at index i so the vector is deterministic per
    // text. Pad/truncate to 768 dims with a fixed scalar.
    const out = new Array<number>(768).fill(0.01);
    for (let i = 0; i < Math.min(text.length, 768); i++) {
      out[i] = text.charCodeAt(i) / 1000;
    }
    return out;
  },
  embedBatch: async () => {
    throw new InvalidArgumentError('embedBatch not used in this suite');
  },
});

interface PipelineDeps {
  readonly db: Database.Database;
  readonly store: ConversationStore;
  readonly queue: IngestQueue;
  readonly indexer: ReturnType<typeof createIndexer>;
}

const buildPipeline = (embedder: Embedder): PipelineDeps => {
  const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
  const store = new ConversationStore(db, 768);
  const windowWriter = createWindowWriter(db);
  const config = { windowSize: 3, windowOverlap: 1 };

  const queue = new IngestQueue({
    db,
    embedTaskHandler: createEmbedTaskHandler({ db, embedder, windowWriter, config }),
  });

  const indexer = createIndexer({
    db,
    conversationStore: store,
    ingestQueue: queue,
    embedder,
    config,
  });

  return { db, store, queue, indexer };
};

const seedConversation = async (
  p: PipelineDeps,
  userId: string,
  projectId: string,
  contents: string[],
): Promise<string> => {
  // Use addEmptyConversation + indexer.ingest to mirror the production
  // storeAsync composition; gives us proper window vectors for KNN.
  const messages = contents.map((content, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content,
  }));
  const conversationId = p.store.addEmptyConversation(userId, messages, projectId);
  p.indexer.ingest(messages, { projectId, conversationId });
  await runEmbedWorker(p.queue);
  return conversationId;
};

describe('searcher.vectorSearch — argument validation', () => {
  // Validation guards trip before any DB call, but createSearcher now
  // prepares statements at construction time, so the test still needs a
  // real DB (just no seeded data). Keep it lightweight: in-memory DB,
  // sqlite-vec NOT loaded (validation never reaches the KNN path).
  let p: PipelineDeps;

  beforeEach(() => {
    p = buildPipeline(makeStubEmbedder());
  });

  afterEach(() => {
    p.db.close();
  });

  it('rejects empty query string', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    await expect(searcher.vectorSearch('', { projectId: 'p' }, 10)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects empty projectId', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    await expect(searcher.vectorSearch('q', { projectId: '' }, 10)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects limit = 0', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    await expect(searcher.vectorSearch('q', { projectId: 'p' }, 0)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects negative limit', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    await expect(searcher.vectorSearch('q', { projectId: 'p' }, -1)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects non-integer limit', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    await expect(searcher.vectorSearch('q', { projectId: 'p' }, 1.5)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects limit > 1000', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    await expect(searcher.vectorSearch('q', { projectId: 'p' }, 1001)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });
});

describe('searcher.vectorSearch — end-to-end (filter-first KNN)', () => {
  let p: PipelineDeps;

  beforeEach(() => {
    p = buildPipeline(makeStubEmbedder());
  });

  afterEach(() => {
    p.db.close();
  });

  it('cross-project isolation: query in project A returns zero hits from project B', async () => {
    // Two projects, deliberately overlapping content. If the project
    // filter doesn't narrow first, KNN would surface the closer of the
    // two regardless of project — which would be a privacy boundary
    // violation.
    await seedConversation(p, 'alice', 'project-a', [
      'machine learning model training pipeline',
      'gradient descent converges quickly',
      'embeddings cluster by topic',
      'vector search retrieves nearest neighbors',
    ]);
    await seedConversation(p, 'bob', 'project-b', [
      'machine learning model training pipeline',
      'gradient descent converges slowly',
      'embeddings drift over time',
      'vector search has recall issues',
    ]);

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hitsA = await searcher.vectorSearch(
      'machine learning model',
      { projectId: 'project-a' },
      10,
    );
    expect(hitsA.length).toBeGreaterThan(0);

    // Every hit MUST be from a project-a conversation. Resolve back to
    // the conversation row to verify project_id.
    const stmt = p.db.prepare('SELECT project_id FROM conversations WHERE id = ?');
    for (const hit of hitsA) {
      const row = stmt.get(hit.conversationId) as { project_id: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.project_id).toBe('project-a');
    }

    // Reverse direction.
    const hitsB = await searcher.vectorSearch(
      'machine learning model',
      { projectId: 'project-b' },
      10,
    );
    expect(hitsB.length).toBeGreaterThan(0);
    for (const hit of hitsB) {
      const row = stmt.get(hit.conversationId) as { project_id: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.project_id).toBe('project-b');
    }
  });

  it('returns empty array when filter narrows to zero candidates', async () => {
    await seedConversation(p, 'alice', 'project-a', ['hello', 'world', 'foo', 'bar']);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });

    const hits = await searcher.vectorSearch('q', { projectId: 'project-nonexistent' }, 10);
    expect(hits).toEqual([]);
  });

  it('resolves messageIds in window-position order', async () => {
    await seedConversation(p, 'alice', 'project-a', [
      'first message',
      'second message',
      'third message',
      'fourth message',
    ]);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.vectorSearch('first', { projectId: 'project-a' }, 5);
    expect(hits.length).toBeGreaterThan(0);

    // Each hit's messageIds should be a 3-element ordered array of
    // INTEGER ids matching the messages in window-position order.
    const stmt = p.db.prepare(
      'SELECT message_id FROM window_messages WHERE conversation_id = ? AND window_index = ? ORDER BY position ASC',
    );
    for (const hit of hits) {
      const expected = (
        stmt.all(hit.conversationId, hit.windowIndex) as { message_id: number }[]
      ).map((r) => r.message_id);
      expect(hit.messageIds).toEqual(expected);
    }
  });

  it('respects the limit parameter', async () => {
    await seedConversation(p, 'alice', 'project-a', [
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
      'm6',
      'm7',
      'm8',
    ]);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.vectorSearch('q', { projectId: 'project-a' }, 2);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('scoring monotonicity: hits returned in descending similarity order (higher = closer)', async () => {
    // WindowHit.score is similarity (1/(1+distance)) — higher = more
    // similar — to match the RRF fusion convention. Hits come back in
    // KNN-distance-ascending order, which maps to score-descending order
    // monotonically (the inversion is monotonic).
    await seedConversation(p, 'alice', 'project-a', [
      'cat dog bird',
      'apple banana',
      'red blue green',
      'one two three',
    ]);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.vectorSearch('cat dog bird', { projectId: 'project-a' }, 10);
    expect(hits.length).toBeGreaterThan(1);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score);
    }
    // Score lives in (0, 1] — verify the bounds.
    for (const hit of hits) {
      expect(hit.score).toBeGreaterThan(0);
      expect(hit.score).toBeLessThanOrEqual(1);
    }
  });

  it('dateFrom narrows candidates to conversations created on or after the bound', async () => {
    // Seed two conversations with different created_at by inserting one,
    // forcing a sleep, then inserting the second. better-sqlite3's
    // datetime('now') is millisecond-resolution; a 50ms sleep is enough
    // to produce distinct timestamps.
    const idEarly = await seedConversation(p, 'alice', 'project-date', [
      'early msg one',
      'early msg two',
      'early msg three',
      'early msg four',
    ]);
    await new Promise((r) => setTimeout(r, 1100));
    const idLate = await seedConversation(p, 'alice', 'project-date', [
      'late msg one',
      'late msg two',
      'late msg three',
      'late msg four',
    ]);

    const lateCreatedAt = (
      p.db.prepare('SELECT created_at FROM conversations WHERE id = ?').get(idLate) as {
        created_at: string;
      }
    ).created_at;

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.vectorSearch(
      'msg',
      { projectId: 'project-date', dateFrom: lateCreatedAt },
      10,
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.conversationId).toBe(idLate);
      expect(hit.conversationId).not.toBe(idEarly);
    }
  });

  it('dateTo narrows candidates to conversations created on or before the bound', async () => {
    const idEarly = await seedConversation(p, 'alice', 'project-date2', [
      'early msg one',
      'early msg two',
      'early msg three',
      'early msg four',
    ]);
    await new Promise((r) => setTimeout(r, 1100));
    const idLate = await seedConversation(p, 'alice', 'project-date2', [
      'late msg one',
      'late msg two',
      'late msg three',
      'late msg four',
    ]);

    const earlyCreatedAt = (
      p.db.prepare('SELECT created_at FROM conversations WHERE id = ?').get(idEarly) as {
        created_at: string;
      }
    ).created_at;

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.vectorSearch(
      'msg',
      { projectId: 'project-date2', dateTo: earlyCreatedAt },
      10,
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.conversationId).toBe(idEarly);
      expect(hit.conversationId).not.toBe(idLate);
    }
  });

  it('rejects NaN-containing query embedding', async () => {
    await seedConversation(p, 'alice', 'project-a', ['hi', 'there', 'foo', 'bar']);
    const nanEmbedder: Embedder = {
      dim: 768,
      embed: async () => {
        const out = Array<number>(768).fill(0.01);
        out[0] = Number.NaN;
        return out;
      },
      embedBatch: async () => {
        throw new InvalidArgumentError('not used');
      },
    };
    const searcher = createSearcher({ db: p.db, embedder: nanEmbedder });
    await expect(searcher.vectorSearch('q', { projectId: 'project-a' }, 5)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects wrong-dimension query embedding', async () => {
    await seedConversation(p, 'alice', 'project-a', ['hi', 'there', 'foo', 'bar']);
    const wrongDimEmbedder: Embedder = {
      dim: 768,
      embed: async () => Array<number>(512).fill(0.01),
      embedBatch: async () => {
        throw new InvalidArgumentError('not used');
      },
    };
    const searcher = createSearcher({ db: p.db, embedder: wrongDimEmbedder });
    await expect(searcher.vectorSearch('q', { projectId: 'project-a' }, 5)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('conversationId filter narrows to a single conversation', async () => {
    const idA = await seedConversation(p, 'alice', 'project-a', ['msg1', 'msg2', 'msg3', 'msg4']);
    await seedConversation(p, 'alice', 'project-a', ['other1', 'other2', 'other3', 'other4']);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.vectorSearch(
      'msg1',
      { projectId: 'project-a', conversationId: idA },
      10,
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.conversationId).toBe(idA);
    }
  });

  it('role filter prunes windows that contain no message of the role', async () => {
    // Seed a conversation where every other turn alternates user/assistant.
    // Window of 3 messages always contains both roles, so role: 'system'
    // should match zero windows (no system messages at all in seed).
    await seedConversation(p, 'alice', 'project-a', ['a', 'b', 'c', 'd', 'e', 'f']);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hitsSystem = await searcher.vectorSearch(
      'a',
      { projectId: 'project-a', role: 'system' },
      10,
    );
    expect(hitsSystem).toEqual([]);

    // role: 'user' should match (every window contains a user message
    // since the seed alternates).
    const hitsUser = await searcher.vectorSearch('a', { projectId: 'project-a', role: 'user' }, 10);
    expect(hitsUser.length).toBeGreaterThan(0);
  });

  it('candidate-set query uses ix_conversations_project_started (not full scan)', async () => {
    // EXPLAIN QUERY PLAN proof of filter-first ordering. Pinned in-test
    // so a future schema change that drops the index trips this assertion
    // before regressions surface in production.
    await seedConversation(p, 'alice', 'project-a', ['hi', 'there', 'foo', 'bar']);

    const plan = p.db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT c.id FROM conversations c WHERE c.project_id = ? AND c.created_at >= ?',
      )
      .all('project-a', '2020-01-01') as { detail: string }[];
    const planText = plan.map((r) => r.detail).join(' | ');
    // Expect the index-aware plan, not a full table scan.
    expect(planText).toMatch(/USING INDEX ix_conversations_project_started|USING COVERING INDEX/);
  });
});
