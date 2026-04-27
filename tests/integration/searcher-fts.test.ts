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
// Sprint-016 Story 3 — searcher.ftsSearch end-to-end (FTS5 + filter scope)
// ---------------------------------------------------------------------------
//
// Pins:
//   1. messages_fts MATCH + bm25 ranking + snippet() helper end-to-end.
//   2. Filter scope through messages.project_id (denormalized) for hot
//      path; conversations JOIN added only when date filters present.
//   3. Cross-project isolation — same-keyword query in project A returns
//      ZERO hits from project B.
//   4. FTS5 query-syntax errors caught + rethrown as InvalidArgumentError.
//   5. Empty-corpus returns []; argument-validation guards trip.
//   6. Score is the bm25 → similarity transform from MessageHit JSDoc.

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
): Promise<string> => {
  const messages = contents.map((content, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content,
  }));
  const conversationId = p.store.addEmptyConversation(userId, messages, projectId);
  p.indexer.ingest(messages, { projectId, conversationId });
  await runEmbedWorker(p.queue);
  return conversationId;
};

describe('searcher.ftsSearch — argument validation', () => {
  let p: PipelineDeps;

  beforeEach(() => {
    p = buildPipeline(makeStubEmbedder());
  });

  afterEach(() => {
    p.db.close();
  });

  it('rejects empty query string', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    await expect(searcher.ftsSearch('', { projectId: 'p' }, 10)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects empty projectId', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    await expect(searcher.ftsSearch('q', { projectId: '' }, 10)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects limit = 0', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    await expect(searcher.ftsSearch('q', { projectId: 'p' }, 0)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });

  it('rejects limit > 1000', async () => {
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    await expect(searcher.ftsSearch('q', { projectId: 'p' }, 1001)).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
  });
});

describe('searcher.ftsSearch — end-to-end (FTS5 + filter scope)', () => {
  let p: PipelineDeps;

  beforeEach(() => {
    p = buildPipeline(makeStubEmbedder());
  });

  afterEach(() => {
    p.db.close();
  });

  it('returns matching messages ranked by bm25 similarity (higher score = more relevant)', async () => {
    await seedConversation(p, 'alice', 'project-a', [
      'machine learning model training pipeline',
      'we use gradient descent for optimization',
      'embeddings cluster semantically related items',
      'pizza is a great Friday dinner option',
    ]);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.ftsSearch('machine learning', { projectId: 'project-a' }, 10);

    expect(hits.length).toBeGreaterThan(0);
    // Ranked descending: most-relevant first.
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score);
    }
    // Score in [0, 1) — bm25 → bounded similarity.
    for (const hit of hits) {
      expect(hit.score).toBeGreaterThanOrEqual(0);
      expect(hit.score).toBeLessThan(1);
    }
    // First hit's content should contain the query keywords (rendered in
    // the snippet via FTS5's <b>...</b> highlighter).
    expect(hits[0].snippet).toBeDefined();
    expect(hits[0].snippet).toMatch(/<b>/i);
  });

  it('cross-project isolation: query in project A returns zero hits from project B', async () => {
    await seedConversation(p, 'alice', 'project-a', [
      'unique-error-code XYZ-9001 occurred during boot',
      'rebooting the system now',
    ]);
    await seedConversation(p, 'bob', 'project-b', [
      'unique-error-code XYZ-9001 occurred during boot',
      'this is a different project entirely',
    ]);

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hitsA = await searcher.ftsSearch('"XYZ-9001"', { projectId: 'project-a' }, 10);
    expect(hitsA.length).toBeGreaterThan(0);

    const stmt = p.db.prepare('SELECT project_id FROM conversations WHERE id = ?');
    for (const hit of hitsA) {
      const row = stmt.get(hit.conversationId) as { project_id: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.project_id).toBe('project-a');
    }

    const hitsB = await searcher.ftsSearch('"XYZ-9001"', { projectId: 'project-b' }, 10);
    expect(hitsB.length).toBeGreaterThan(0);
    for (const hit of hitsB) {
      const row = stmt.get(hit.conversationId) as { project_id: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.project_id).toBe('project-b');
    }
  });

  it('returns empty array on empty corpus', async () => {
    // No seed; messages_fts is empty.
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.ftsSearch('anything', { projectId: 'project-empty' }, 10);
    expect(hits).toEqual([]);
  });

  it('returns empty array when filters narrow to zero candidates', async () => {
    await seedConversation(p, 'alice', 'project-a', ['hello world', 'goodbye world', 'foo bar']);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.ftsSearch('world', { projectId: 'project-nonexistent' }, 10);
    expect(hits).toEqual([]);
  });

  it('phrase matching ("exact phrase")', async () => {
    await seedConversation(p, 'alice', 'project-phrase', [
      'machine learning is fascinating',
      'machine and learning are separate words here',
      'we learn machines through repetition',
    ]);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.ftsSearch(
      '"machine learning"',
      { projectId: 'project-phrase' },
      10,
    );
    expect(hits.length).toBe(1);
    // The hit must be the row that contains the exact bigram.
    const stmt = p.db.prepare('SELECT content FROM messages WHERE id = ?');
    const row = stmt.get(hits[0].messageId) as { content: string };
    expect(row.content).toContain('machine learning');
  });

  it('boolean operators (foo AND NOT bar)', async () => {
    await seedConversation(p, 'alice', 'project-bool', [
      'the cat sat on the mat',
      'the cat chased the mouse',
      'a dog also sat there',
    ]);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.ftsSearch('cat NOT mouse', { projectId: 'project-bool' }, 10);
    // Should match "cat sat on the mat" but exclude "cat chased the mouse".
    const stmt = p.db.prepare('SELECT content FROM messages WHERE id = ?');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    for (const hit of hits) {
      const row = stmt.get(hit.messageId) as { content: string };
      expect(row.content).toMatch(/cat/);
      expect(row.content).not.toMatch(/mouse/);
    }
  });

  it('prefix matching (run*)', async () => {
    await seedConversation(p, 'alice', 'project-prefix', [
      'the runner finished the marathon',
      'we are running short on time',
      'the bird flew away',
    ]);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.ftsSearch('run*', { projectId: 'project-prefix' }, 10);
    // Should match both "runner" and "running" via prefix expansion.
    expect(hits.length).toBe(2);
    const stmt = p.db.prepare('SELECT content FROM messages WHERE id = ?');
    for (const hit of hits) {
      const row = stmt.get(hit.messageId) as { content: string };
      expect(row.content).toMatch(/run/i);
    }
  });

  it('catches FTS5 syntax errors and rethrows InvalidArgumentError', async () => {
    await seedConversation(p, 'alice', 'project-a', ['hi', 'there', 'foo']);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    // Unbalanced double-quote in phrase — FTS5 throws "fts5: syntax error..."
    await expect(
      searcher.ftsSearch('"unbalanced phrase', { projectId: 'project-a' }, 10),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('propagates infrastructure errors (e.g. "no such table") UNCHANGED — not wrapped as InvalidArgumentError', async () => {
    // Build a fresh DB that has NO messages_fts table; the
    // SQLITE_ERROR ("no such table: messages_fts") must propagate as a
    // SqliteError, not get silently misclassified as a user-input
    // error. Pins the iter-2 P1 fix that narrowed the catch regex.
    const bareDb = createDatabase({
      path: ':memory:',
      loadSqliteVec: false,
      runIntegrityCheck: false,
    });
    try {
      // Create just enough schema for the SQL template to parse — the
      // JOIN target tables must exist OR the error trips earlier (also
      // SQLITE_ERROR, also infrastructure, also must propagate).
      bareDb.exec(`
        CREATE TABLE messages (id INTEGER PRIMARY KEY, conversation_id TEXT,
          role TEXT, content TEXT, project_id TEXT);
        CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT,
          created_at TEXT);
        CREATE TABLE window_messages (conversation_id TEXT, window_index INTEGER,
          message_id INTEGER, position INTEGER);
      `);
      bareDb
        .prepare('INSERT INTO conversations (id, project_id, created_at) VALUES (?, ?, ?)')
        .run('c1', 'p', new Date().toISOString());

      const searcher = createSearcher({ db: bareDb, embedder: makeStubEmbedder() });
      await expect(searcher.ftsSearch('hello', { projectId: 'p' }, 10)).rejects.not.toBeInstanceOf(
        InvalidArgumentError,
      );
    } finally {
      bareDb.close();
    }
  });

  it('respects role filter — only matches messages of the given role', async () => {
    // user/assistant alternation: contents at even indices are 'user' role.
    await seedConversation(p, 'alice', 'project-role', [
      'cat user-side',
      'cat assistant-side',
      'cat user-side again',
      'cat assistant-side again',
    ]);
    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hitsUser = await searcher.ftsSearch(
      'cat',
      { projectId: 'project-role', role: 'user' },
      10,
    );
    const hitsAssistant = await searcher.ftsSearch(
      'cat',
      { projectId: 'project-role', role: 'assistant' },
      10,
    );

    const stmt = p.db.prepare('SELECT role FROM messages WHERE id = ?');
    for (const hit of hitsUser) {
      const row = stmt.get(hit.messageId) as { role: string };
      expect(row.role).toBe('user');
    }
    for (const hit of hitsAssistant) {
      const row = stmt.get(hit.messageId) as { role: string };
      expect(row.role).toBe('assistant');
    }
  });

  it('respects conversationId filter — narrows to single conversation', async () => {
    const idA = await seedConversation(p, 'alice', 'project-cf', [
      'unique-keyword in conversation A',
      'more A content',
    ]);
    await seedConversation(p, 'alice', 'project-cf', [
      'unique-keyword in conversation B',
      'more B content',
    ]);

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.ftsSearch(
      '"unique-keyword"',
      { projectId: 'project-cf', conversationId: idA },
      10,
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.conversationId).toBe(idA);
    }
  });

  it('respects dateTo — narrows to conversations created on or before the bound', async () => {
    const idEarly = await seedConversation(p, 'alice', 'project-dt2', [
      'shared-keyword early one',
      'shared-keyword early two',
    ]);
    await new Promise((r) => setTimeout(r, 1100));
    const idLate = await seedConversation(p, 'alice', 'project-dt2', [
      'shared-keyword late one',
      'shared-keyword late two',
    ]);

    const earlyCreatedAt = (
      p.db.prepare('SELECT created_at FROM conversations WHERE id = ?').get(idEarly) as {
        created_at: string;
      }
    ).created_at;

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.ftsSearch(
      '"shared-keyword"',
      { projectId: 'project-dt2', dateTo: earlyCreatedAt },
      10,
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.conversationId).toBe(idEarly);
      expect(hit.conversationId).not.toBe(idLate);
    }
  });

  it('respects dateFrom — narrows to conversations created on or after the bound', async () => {
    const idEarly = await seedConversation(p, 'alice', 'project-dt', [
      'shared-keyword early one',
      'shared-keyword early two',
    ]);
    await new Promise((r) => setTimeout(r, 1100));
    const idLate = await seedConversation(p, 'alice', 'project-dt', [
      'shared-keyword late one',
      'shared-keyword late two',
    ]);

    const lateCreatedAt = (
      p.db.prepare('SELECT created_at FROM conversations WHERE id = ?').get(idLate) as {
        created_at: string;
      }
    ).created_at;

    const searcher = createSearcher({ db: p.db, embedder: makeStubEmbedder() });
    const hits = await searcher.ftsSearch(
      '"shared-keyword"',
      { projectId: 'project-dt', dateFrom: lateCreatedAt },
      10,
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.conversationId).toBe(idLate);
      expect(hit.conversationId).not.toBe(idEarly);
    }
  });
});
