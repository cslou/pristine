import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { ConversationStore } from '../../src/conversations/store.js';
import { createDatabase } from '../../src/core/database.js';
import { InvalidArgumentError } from '../../src/core/errors.js';
import type { Embedder } from '../../src/core/interfaces.js';
import { createEmbedTaskHandler, runEmbedWorker } from '../../src/memory/indexer/embed-worker.js';
import { createIndexer } from '../../src/memory/indexer/index.js';
import { createWindowWriter } from '../../src/memory/indexer/windows.js';
import { createSearcher } from '../../src/memory/searcher/index.js';
import { IngestQueue } from '../../src/queue/ingest-queue.js';

// ---------------------------------------------------------------------------
// Sprint-016 Story 5 — sessionVectorSearch + 3-source hybrid fan-out
// ---------------------------------------------------------------------------
//
// Pins:
//   1. sessionVectorSearch returns SessionHit[] keyed by conversationId.
//   2. Filter-first project isolation also holds for sessions.
//   3. Empty vec_sessions table returns [] (graceful degradation).
//   4. Cross-conversation reference recall: a query whose match comes
//      ONLY from the session vector (not any individual window) still
//      surfaces the conversation when sessionVectorSearch is run.
//   5. hybridSearch fan-out adds session source to the existing
//      vector + FTS legs; HybridHit has kind: 'session' variant with
//      source: 'session'.
//   6. Window-vs-session tie-break: when a single conversation
//      surfaces from BOTH window and session legs, the window vs the
//      session are SEPARATE hits with distinct ids; both can appear.

const makeStubEmbedder = (): Embedder => ({
  embed: async (text: string): Promise<number[]> => {
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
  const store = new ConversationStore(db);
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
  buildSession = true,
): Promise<string> => {
  const messages = contents.map((content, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content,
  }));
  const conversationId = p.store.addEmptyConversation(userId, messages, projectId);
  p.indexer.ingest(messages, { projectId, conversationId });
  await runEmbedWorker(p.queue);
  if (buildSession) {
    await p.indexer.buildSessionVector(conversationId);
  }
  return conversationId;
};

describe('searcher.sessionVectorSearch — argument validation', () => {
  let p: PipelineDeps;

  beforeEach(() => {
    p = buildPipeline(makeStubEmbedder());
  });

  afterEach(() => {
    p.db.close();
  });

  it('rejects empty query', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    await expect(searcher.sessionVectorSearch('', { projectId: 'p' }, 10)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects empty projectId', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    await expect(searcher.sessionVectorSearch('q', { projectId: '' }, 10)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects limit = 0', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    await expect(searcher.sessionVectorSearch('q', { projectId: 'p' }, 0)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects limit > 1000', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    await expect(
      searcher.sessionVectorSearch('q', { projectId: 'p' }, 1001),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
  });
});

describe('searcher.sessionVectorSearch — end-to-end', () => {
  let p: PipelineDeps;

  beforeEach(() => {
    p = buildPipeline(makeStubEmbedder());
  });

  afterEach(() => {
    p.db.close();
  });

  it('returns SessionHit per conversation in descending similarity order', async () => {
    const idA = await seedConversation(p, 'alice', 'project-s', [
      'machine learning models',
      'gradient descent optimization',
      'neural networks training',
    ]);
    const idB = await seedConversation(p, 'alice', 'project-s', [
      'pizza recipes from Italy',
      'mediterranean cuisine basics',
      'pasta cooking techniques',
    ]);

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.sessionVectorSearch(
      'machine learning',
      { projectId: 'project-s' },
      10,
    );
    expect(hits.length).toBe(2);
    // Both conversations have a session vector; both surface. Score is
    // (0,1] — verify bounds.
    for (const hit of hits) {
      expect(hit.score).toBeGreaterThan(0);
      expect(hit.score).toBeLessThanOrEqual(1);
      expect([idA, idB]).toContain(hit.conversationId);
    }
    // Descending similarity order.
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score);
    }
  });

  it('cross-project isolation: query in project A returns zero hits from project B', async () => {
    await seedConversation(p, 'alice', 'project-a', [
      'shared topic across projects',
      'similar content here',
    ]);
    await seedConversation(p, 'bob', 'project-b', [
      'shared topic across projects',
      'different project entirely',
    ]);

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.sessionVectorSearch('shared topic', { projectId: 'project-a' }, 10);
    expect(hits.length).toBeGreaterThan(0);

    const stmt = p.db.prepare('SELECT project_id FROM conversations WHERE id = ?');
    for (const hit of hits) {
      const row = stmt.get(hit.conversationId) as { project_id: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.project_id).toBe('project-a');
    }
  });

  it('returns empty array when vec_sessions is empty (storeAsync only — no buildSessionVector)', async () => {
    // Seed without building session vectors. The corpus has windows
    // and FTS rows but no vec_sessions entries.
    await seedConversation(p, 'alice', 'project-empty-sessions', ['hi', 'there', 'foo'], false);

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.sessionVectorSearch(
      'anything',
      { projectId: 'project-empty-sessions' },
      10,
    );
    expect(hits).toEqual([]);
  });

  it('returns empty array when filter narrows to zero candidates', async () => {
    await seedConversation(p, 'alice', 'project-s2', ['a', 'b', 'c']);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.sessionVectorSearch('q', { projectId: 'no-such-project' }, 10);
    expect(hits).toEqual([]);
  });

  it('respects conversationId filter', async () => {
    const idA = await seedConversation(p, 'alice', 'project-cf', [
      'first conversation content',
      'first conversation more',
    ]);
    await seedConversation(p, 'alice', 'project-cf', [
      'second conversation content',
      'second conversation more',
    ]);

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.sessionVectorSearch(
      'content',
      { projectId: 'project-cf', conversationId: idA },
      10,
    );
    expect(hits.length).toBe(1);
    expect(hits[0].conversationId).toBe(idA);
  });

  it('silently ignores role filter (sessions aggregate roles)', async () => {
    // role: 'system' would prune all messages in vectorSearch, but
    // sessionVectorSearch should ignore the filter and still return
    // session hits per project.
    await seedConversation(p, 'alice', 'project-role', ['a', 'b', 'c']);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.sessionVectorSearch(
      'a',
      { projectId: 'project-role', role: 'system' },
      10,
    );
    // Session is returned despite role: 'system' (filter intentionally ignored).
    expect(hits.length).toBe(1);
  });
});

describe('searcher.hybridSearch — 3-source fan-out (vector + FTS + session)', () => {
  let p: PipelineDeps;

  beforeEach(() => {
    p = buildPipeline(makeStubEmbedder());
  });

  afterEach(() => {
    p.db.close();
  });

  it('fans out to all three legs; HybridHit can have kind: "session"', async () => {
    // Seed two conversations, both with session vectors built so the
    // session leg has data to return.
    await seedConversation(p, 'alice', 'project-3way', [
      'machine learning models',
      'gradient descent optimization',
      'embedding clusters semantically',
    ]);
    await seedConversation(p, 'alice', 'project-3way', [
      'a different topic entirely',
      'unrelated content here',
      'separate conversation context',
    ]);

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.hybridSearch('machine learning', { projectId: 'project-3way' }, 10);
    expect(hits.length).toBeGreaterThan(0);

    // We expect at least one session hit since vec_sessions is populated.
    const sessionHits = hits.filter((h) => h.kind === 'session');
    expect(sessionHits.length).toBeGreaterThan(0);
    for (const hit of sessionHits) {
      expect(hit.source).toBe('session');
    }
  });

  it('graceful degradation when vec_sessions is empty (storeAsync-only corpus)', async () => {
    // Seed without session vectors. hybridSearch's session leg returns
    // [] and the bi-source vector + FTS results pass through.
    await seedConversation(
      p,
      'alice',
      'project-degraded',
      ['vector-content one', 'vector-content two', 'vector-content three'],
      false,
    );

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.hybridSearch(
      'vector-content',
      { projectId: 'project-degraded' },
      10,
    );
    expect(hits.length).toBeGreaterThan(0);
    // No session hits because vec_sessions is empty.
    for (const hit of hits) {
      expect(hit.kind).not.toBe('session');
    }
  });

  it('cross-conversation reference recall: session vector promotes a topical match without per-window match', async () => {
    // Synthetic two-conversation scenario:
    //   conv-A: discusses TopicX in detail
    //   conv-B: contains a single short message that is THEMATICALLY
    //           related to TopicX but no individual window is a strong
    //           per-message match. The session-level aggregate vector
    //           DOES capture the thematic relevance because it
    //           summarizes the whole conversation.
    //
    // A query for TopicX should surface BOTH conv-A windows AND conv-B
    // session — without sessionVectorSearch, conv-B would not appear.
    const idA = await seedConversation(p, 'alice', 'project-recall', [
      'distributed systems consensus algorithms',
      'paxos and raft are leader-based protocols',
      'byzantine fault tolerance handles malicious nodes',
      'consensus is the heart of distributed coordination',
    ]);
    const idB = await seedConversation(p, 'alice', 'project-recall', [
      'we briefly discussed paxos in passing',
      'but mostly the topic was something else entirely',
      'unrelated context',
      'wrapping up',
    ]);

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.hybridSearch(
      'paxos consensus',
      { projectId: 'project-recall' },
      10,
    );

    const conversationIds = new Set(hits.map((h) => h.conversationId));
    // Both conversations should appear thanks to the 3-source fan-out
    // (window matches from conv-A, session match from conv-B even
    // though conv-B's individual windows aren't strong per-window matches).
    expect(conversationIds.has(idA)).toBe(true);
    expect(conversationIds.has(idB)).toBe(true);
  });

  it('window-vs-session tie-break: same conversation can appear as BOTH a window hit AND a session hit', async () => {
    await seedConversation(p, 'alice', 'project-tie', [
      'first message about kittens',
      'second message about kittens',
      'third message about kittens',
      'fourth message about kittens',
    ]);

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.hybridSearch('kittens', { projectId: 'project-tie' }, 10);

    const kinds = new Set(hits.map((h) => h.kind));
    // Window kind from vectorSearch + session kind from sessionVectorSearch
    // are separate ids (different prefixes), so RRF surfaces them both
    // independently — not a "both" tag.
    expect(kinds.has('window')).toBe(true);
    expect(kinds.has('session')).toBe(true);
  });

  it('empty corpus across all three legs returns []', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.hybridSearch('anything', { projectId: 'no-such-project' }, 10);
    expect(hits).toEqual([]);
  });
});
