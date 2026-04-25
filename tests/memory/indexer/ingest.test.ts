import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConversationStore } from '../../../src/conversations/store.js';
import { createDatabase } from '../../../src/core/database.js';
import { ConversationNotFoundError, InvalidArgumentError } from '../../../src/core/errors.js';
import { createIndexer } from '../../../src/memory/indexer/index.js';
import { IngestQueue } from '../../../src/queue/ingest-queue.js';

let db: ReturnType<typeof createDatabase>;
let store: ConversationStore;
let queue: IngestQueue;

const makeMessages = (contents: string[]) =>
  contents.map((content, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content,
  }));

beforeAll(() => {
  db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
  store = new ConversationStore(db);
  queue = new IngestQueue({ db, orchestrator: null, conversationStore: store });
});

beforeEach(() => {
  // Wipe everything the indexer touches between tests so each test gets a
  // clean (conversations, messages, pending_ingest_tasks) starting state.
  db.exec('DELETE FROM pending_ingest_tasks');
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM conversations');
});

afterAll(() => {
  db.close();
});

describe('IndexerConfig validation', () => {
  it('applies default windowSize=3 + windowOverlap=1 when no config is given', () => {
    const indexer = createIndexer({ db, conversationStore: store, ingestQueue: queue });
    expect(indexer.config.windowSize).toBe(3);
    expect(indexer.config.windowOverlap).toBe(1);
  });

  it('preserves an explicit valid config (windowSize=5, windowOverlap=2)', () => {
    const indexer = createIndexer({
      db,
      conversationStore: store,
      ingestQueue: queue,
      config: { windowSize: 5, windowOverlap: 2 },
    });
    expect(indexer.config.windowSize).toBe(5);
    expect(indexer.config.windowOverlap).toBe(2);
  });

  it('allows windowOverlap=0 (zero-overlap is valid; boundary case)', () => {
    const indexer = createIndexer({
      db,
      conversationStore: store,
      ingestQueue: queue,
      config: { windowSize: 3, windowOverlap: 0 },
    });
    expect(indexer.config.windowOverlap).toBe(0);
  });

  it('rejects non-integer windowSize', () => {
    expect(() =>
      createIndexer({
        db,
        conversationStore: store,
        ingestQueue: queue,
        config: { windowSize: 2.5, windowOverlap: 1 },
      }),
    ).toThrow(InvalidArgumentError);
  });

  it('rejects windowSize <= 0', () => {
    expect(() =>
      createIndexer({
        db,
        conversationStore: store,
        ingestQueue: queue,
        config: { windowSize: 0, windowOverlap: 0 },
      }),
    ).toThrow(InvalidArgumentError);
  });

  it('rejects negative windowOverlap', () => {
    expect(() =>
      createIndexer({
        db,
        conversationStore: store,
        ingestQueue: queue,
        config: { windowSize: 3, windowOverlap: -1 },
      }),
    ).toThrow(InvalidArgumentError);
  });

  it('rejects windowOverlap >= windowSize (degenerate stride)', () => {
    expect(() =>
      createIndexer({
        db,
        conversationStore: store,
        ingestQueue: queue,
        config: { windowSize: 3, windowOverlap: 3 },
      }),
    ).toThrow(InvalidArgumentError);

    expect(() =>
      createIndexer({
        db,
        conversationStore: store,
        ingestQueue: queue,
        config: { windowSize: 3, windowOverlap: 4 },
      }),
    ).toThrow(InvalidArgumentError);
  });
});

describe('Indexer.ingest happy path', () => {
  it('inserts one message + enqueues one embed-message task per turn', () => {
    const conversationId = store.addConversation(makeMessages(['seed']), 'user-1');
    const indexer = createIndexer({ db, conversationStore: store, ingestQueue: queue });

    const result = indexer.ingest(makeMessages(['t1', 't2', 't3']), {
      projectId: 'proj-A',
      conversationId,
    });

    expect(result.messageIds).toHaveLength(3);
    expect(result.taskIds).toHaveLength(3);
    // messageIds are unique positive integers
    for (const id of result.messageIds) {
      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
    }
    expect(new Set(result.messageIds).size).toBe(3);

    const messageRows = db
      .prepare(
        `SELECT id, role, content, sort_order, project_id
         FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC`,
      )
      .all(conversationId) as {
      id: number;
      role: string;
      content: string;
      sort_order: number;
      project_id: string;
    }[];
    // 1 seed + 3 ingested = 4 messages on the conversation
    expect(messageRows).toHaveLength(4);
    // The 3 newly-inserted messages are the trailing 3
    const ingested = messageRows.slice(1);
    expect(ingested.map((r) => r.id)).toEqual([...result.messageIds]);
    expect(ingested.map((r) => r.content)).toEqual(['t1', 't2', 't3']);

    const taskRows = db
      .prepare(
        // ORDER BY message_id ASC: messages.id is INTEGER AUTOINCREMENT, so
        // it monotonically reflects insertion order. created_at is per-second
        // and ties break unpredictably across UUID task ids — avoid it.
        `SELECT id, conversation_id, user_id, task_type, message_id, project_id, session_id, status
         FROM pending_ingest_tasks
         WHERE task_type = 'embed-message' AND conversation_id = ?
         ORDER BY message_id ASC`,
      )
      .all(conversationId) as {
      id: string;
      conversation_id: string;
      user_id: string;
      task_type: string;
      message_id: number;
      project_id: string;
      session_id: string | null;
      status: string;
    }[];
    expect(taskRows).toHaveLength(3);
    expect(taskRows.map((r) => r.id)).toEqual([...result.taskIds]);
    expect(taskRows.map((r) => r.message_id)).toEqual([...result.messageIds]);
    for (const row of taskRows) {
      expect(row.task_type).toBe('embed-message');
      expect(row.conversation_id).toBe(conversationId);
      expect(row.user_id).toBe('user-1');
      expect(row.project_id).toBe('proj-A');
      expect(row.session_id).toBeNull();
      expect(row.status).toBe('pending');
    }
  });

  it('propagates sessionId into the embed-message task payload when provided', () => {
    const conversationId = store.addConversation(makeMessages(['seed']), 'user-2');
    const indexer = createIndexer({ db, conversationStore: store, ingestQueue: queue });

    indexer.ingest(makeMessages(['hi']), {
      projectId: 'proj-B',
      conversationId,
      sessionId: 'sess-42',
    });

    const row = db
      .prepare(
        `SELECT session_id FROM pending_ingest_tasks
         WHERE task_type = 'embed-message' AND conversation_id = ?`,
      )
      .get(conversationId) as { session_id: string };
    expect(row.session_id).toBe('sess-42');
  });

  it('preserves message ordering — ingested messages get contiguous sort_order after the seed', () => {
    const conversationId = store.addConversation(makeMessages(['seed-a', 'seed-b']), 'user-3');
    const indexer = createIndexer({ db, conversationStore: store, ingestQueue: queue });

    indexer.ingest(makeMessages(['turn-1', 'turn-2', 'turn-3', 'turn-4']), {
      projectId: 'proj-C',
      conversationId,
    });

    const rows = db
      .prepare(
        `SELECT sort_order, content FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC`,
      )
      .all(conversationId) as { sort_order: number; content: string }[];
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.content)).toEqual([
      'seed-a',
      'seed-b',
      'turn-1',
      'turn-2',
      'turn-3',
      'turn-4',
    ]);
  });

  it('returns within 500ms for 100 turns (CI threshold tolerant 2x = 1000ms)', () => {
    const conversationId = store.addConversation(makeMessages(['seed']), 'user-perf');
    const indexer = createIndexer({ db, conversationStore: store, ingestQueue: queue });

    const turns = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${i} — body of moderate length so the prepared-statement run reflects realistic work`,
    }));

    const t0 = performance.now();
    const result = indexer.ingest(turns, { projectId: 'proj-perf', conversationId });
    const elapsed = performance.now() - t0;

    expect(result.messageIds).toHaveLength(100);
    expect(result.taskIds).toHaveLength(100);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('Indexer.ingest error propagation', () => {
  it('throws InvalidArgumentError on zero turns', () => {
    const conversationId = store.addConversation(makeMessages(['seed']), 'user-err');
    const indexer = createIndexer({ db, conversationStore: store, ingestQueue: queue });
    expect(() => indexer.ingest([], { projectId: 'p', conversationId })).toThrow(
      InvalidArgumentError,
    );
  });

  it('throws InvalidArgumentError on empty projectId', () => {
    const conversationId = store.addConversation(makeMessages(['seed']), 'user-err');
    const indexer = createIndexer({ db, conversationStore: store, ingestQueue: queue });
    expect(() => indexer.ingest(makeMessages(['t']), { projectId: '', conversationId })).toThrow(
      InvalidArgumentError,
    );
  });

  it('throws InvalidArgumentError on empty conversationId', () => {
    const indexer = createIndexer({ db, conversationStore: store, ingestQueue: queue });
    expect(() =>
      indexer.ingest(makeMessages(['t']), { projectId: 'p', conversationId: '' }),
    ).toThrow(InvalidArgumentError);
  });

  it('throws InvalidArgumentError on empty sessionId when provided', () => {
    const conversationId = store.addConversation(makeMessages(['seed']), 'user-err');
    const indexer = createIndexer({ db, conversationStore: store, ingestQueue: queue });
    expect(() =>
      indexer.ingest(makeMessages(['t']), {
        projectId: 'p',
        conversationId,
        sessionId: '',
      }),
    ).toThrow(InvalidArgumentError);
  });

  it('throws ConversationNotFoundError when conversationId does not resolve', () => {
    const indexer = createIndexer({ db, conversationStore: store, ingestQueue: queue });
    expect(() =>
      indexer.ingest(makeMessages(['t']), {
        projectId: 'p',
        conversationId: 'does-not-exist',
      }),
    ).toThrow(ConversationNotFoundError);
  });

  it('throws ConversationNotFoundError without inserting any partial state', () => {
    // Atomicity: the user_id resolve fails inside the transaction → nothing
    // gets written to messages or pending_ingest_tasks for the doomed batch.
    const indexer = createIndexer({ db, conversationStore: store, ingestQueue: queue });

    const beforeMessages = db.prepare('SELECT COUNT(*) AS c FROM messages').get() as {
      c: number;
    };
    const beforeTasks = db.prepare('SELECT COUNT(*) AS c FROM pending_ingest_tasks').get() as {
      c: number;
    };

    expect(() =>
      indexer.ingest(makeMessages(['t1', 't2', 't3']), {
        projectId: 'p',
        conversationId: 'does-not-exist',
      }),
    ).toThrow(ConversationNotFoundError);

    const afterMessages = db.prepare('SELECT COUNT(*) AS c FROM messages').get() as {
      c: number;
    };
    const afterTasks = db.prepare('SELECT COUNT(*) AS c FROM pending_ingest_tasks').get() as {
      c: number;
    };
    expect(afterMessages.c).toBe(beforeMessages.c);
    expect(afterTasks.c).toBe(beforeTasks.c);
  });
});

describe('Indexer.ingest does NOT do embedding work synchronously', () => {
  it('returns before any embed-message task transitions to processing', () => {
    // Phase-3 contract: embedding is offloaded to the worker. After ingest()
    // returns, every newly-enqueued task is still in 'pending' status — no
    // implicit processing happens inside ingest().
    const conversationId = store.addConversation(makeMessages(['seed']), 'user-async');
    const indexer = createIndexer({ db, conversationStore: store, ingestQueue: queue });

    const result = indexer.ingest(makeMessages(['t1', 't2']), {
      projectId: 'p',
      conversationId,
    });

    const statuses = db
      .prepare(
        `SELECT status FROM pending_ingest_tasks
         WHERE id IN (${result.taskIds.map(() => '?').join(', ')})`,
      )
      .all(...result.taskIds) as { status: string }[];
    expect(statuses).toHaveLength(2);
    for (const s of statuses) expect(s.status).toBe('pending');
  });
});
