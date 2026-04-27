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
  queue = new IngestQueue({ db });
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

describe('Indexer.ingest oversize-message chunking (sprint-015 Story 4)', () => {
  it('splits an oversize prose turn into N chunks linked via parent_message_id', () => {
    const conversationId = store.addConversation(makeMessages(['seed']), 'user-oversize');
    // Inject a tiny threshold + char-tokens counter so we don't have to
    // produce 12K chars of content. Parent is one big paragraph that
    // exceeds the 50-char threshold; after splitting it should yield
    // multiple chunks.
    const oversize = 'paragraph 1\n\nparagraph 2\n\nparagraph 3\n\nparagraph 4';
    const indexer = createIndexer({
      db,
      conversationStore: store,
      ingestQueue: queue,
      oversizeOptions: {
        tokenCounter: (text: string) => text.length,
        threshold: 20,
        overlapTokens: 0,
      },
    });

    const result = indexer.ingest([{ role: 'user', content: oversize }], {
      projectId: 'proj-oversize',
      conversationId,
    });

    // result.messageIds[0] is the parent; the rest are chunks.
    expect(result.messageIds.length).toBeGreaterThan(2); // 1 parent + ≥2 chunks
    const parentId = result.messageIds[0];
    const chunkIds = result.messageIds.slice(1);

    // Chunks have parent_message_id = parentId; parent has parent_message_id = NULL.
    const parentRow = db
      .prepare('SELECT parent_message_id FROM messages WHERE id = ?')
      .get(parentId) as { parent_message_id: number | null };
    expect(parentRow.parent_message_id).toBeNull();

    for (const cid of chunkIds) {
      const row = db.prepare('SELECT parent_message_id FROM messages WHERE id = ?').get(cid) as {
        parent_message_id: number | null;
      };
      expect(row.parent_message_id).toBe(parentId);
    }

    // embed-message tasks: only chunks get tasks; parent does NOT.
    expect(result.taskIds.length).toBe(chunkIds.length);
    const taskMessageIds = (
      db
        .prepare(
          "SELECT message_id FROM pending_ingest_tasks WHERE task_type = 'embed-message' AND conversation_id = ? ORDER BY message_id ASC",
        )
        .all(conversationId) as { message_id: number }[]
    ).map((r) => r.message_id);
    expect(taskMessageIds.slice().sort((a, b) => a - b)).toEqual(
      chunkIds.slice().sort((a, b) => a - b),
    );
    expect(taskMessageIds).not.toContain(parentId);
  });

  it('does NOT split a below-threshold turn (no parent row, no chunks)', () => {
    const conversationId = store.addConversation(makeMessages(['seed']), 'user-small');
    const indexer = createIndexer({
      db,
      conversationStore: store,
      ingestQueue: queue,
      oversizeOptions: {
        tokenCounter: (text: string) => text.length,
        threshold: 1000,
      },
    });

    const result = indexer.ingest([{ role: 'user', content: 'short' }], {
      projectId: 'p',
      conversationId,
    });

    // Single message, no parent linkage.
    expect(result.messageIds).toHaveLength(1);
    const row = db
      .prepare('SELECT parent_message_id FROM messages WHERE id = ?')
      .get(result.messageIds[0]) as { parent_message_id: number | null };
    expect(row.parent_message_id).toBeNull();

    // Task is enqueued for the single message.
    expect(result.taskIds).toHaveLength(1);
  });

  it('routes mimeType=text/x-typescript through the AST splitter (chunks linked to parent)', () => {
    const conversationId = store.addConversation(makeMessages(['seed']), 'user-code');
    const code = `
function alpha() { return 1; }
function beta() { return 2; }
function gamma() { return 3; }
function delta() { return 4; }
`.trim();
    const indexer = createIndexer({
      db,
      conversationStore: store,
      ingestQueue: queue,
      oversizeOptions: {
        tokenCounter: (text: string) => text.length,
        threshold: 50,
        overlapTokens: 0,
      },
    });

    const result = indexer.ingest(
      [{ role: 'user', content: code, mimeType: 'text/x-typescript' }],
      { projectId: 'p', conversationId },
    );

    // 1 parent + multiple chunks (one per AST top-level function, packed).
    expect(result.messageIds.length).toBeGreaterThan(1);
    const parentId = result.messageIds[0];
    const chunkRows = db
      .prepare(
        'SELECT id, parent_message_id, content FROM messages WHERE conversation_id = ? AND parent_message_id IS NOT NULL ORDER BY sort_order ASC',
      )
      .all(conversationId) as { id: number; parent_message_id: number; content: string }[];
    expect(chunkRows.length).toBeGreaterThan(0);
    for (const row of chunkRows) {
      expect(row.parent_message_id).toBe(parentId);
    }
    // Concatenated chunks should contain every function signature.
    const allText = chunkRows.map((r) => r.content).join('\n');
    expect(allText).toContain('alpha');
    expect(allText).toContain('beta');
    expect(allText).toContain('gamma');
    expect(allText).toContain('delta');
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
