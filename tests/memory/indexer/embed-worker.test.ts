import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConversationStore } from '../../../src/conversations/store.js';
import { createDatabase } from '../../../src/core/database.js';
import { IngestQueueError, InvalidArgumentError } from '../../../src/core/errors.js';
import type { Embedder } from '../../../src/core/interfaces.js';
import {
  createEmbedTaskHandler,
  processEmbedTask,
  runEmbedWorker,
} from '../../../src/memory/indexer/embed-worker.js';
import { createIndexer } from '../../../src/memory/indexer/index.js';
import { createWindowWriter } from '../../../src/memory/indexer/windows.js';
import type { IngestTask } from '../../../src/queue/ingest-queue.js';
import { IngestQueue } from '../../../src/queue/ingest-queue.js';

let db: ReturnType<typeof createDatabase>;
let store: ConversationStore;

beforeAll(() => {
  db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
  store = new ConversationStore(db);
  // One IngestQueue instance constructed up-front so the
  // pending_ingest_tasks table exists for the beforeEach DELETE pass.
  // Tests construct their own queue with embedTaskHandler injected.
  new IngestQueue({ db, orchestrator: null, conversationStore: store });
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

// Stub embedder — returns a deterministic vector keyed off the input text
// hash so we can verify which window's text reached the embedder.
const makeStubEmbedder = () => {
  const calls: string[] = [];
  const embedder: Embedder = {
    embed: async (text: string): Promise<number[]> => {
      calls.push(text);
      const seed = text.length / 1000;
      return Array.from({ length: 768 }, (_, i) => seed + i * 1e-4);
    },
    embedBatch: async (_texts: readonly string[]): Promise<number[][]> => {
      throw new Error('embedBatch not used in these tests');
    },
  };
  return { embedder, calls };
};

const seedConversationWithMessages = (
  contents: string[],
  userId: string,
): { conversationId: string; messageIds: number[] } => {
  const conversationId = store.addConversation(makeMessages(contents), userId);
  const messageIds = (
    db
      .prepare('SELECT id FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC')
      .all(conversationId) as { id: number }[]
  ).map((r) => r.id);
  return { conversationId, messageIds };
};

describe('processEmbedTask', () => {
  it('embeds the windows containing the new message and writes vec_windows + window_messages', async () => {
    // Seed a 5-message conversation; default config (windowSize=3,
    // windowOverlap=1) → windows [0..2] and [2..4]. Process task for the
    // middle message (sort_order=2) — should hit BOTH windows.
    const { conversationId, messageIds } = seedConversationWithMessages(
      ['m0', 'm1', 'm2', 'm3', 'm4'],
      'user-mid',
    );

    const { embedder, calls } = makeStubEmbedder();
    const windowWriter = createWindowWriter(db);
    const config = { windowSize: 3, windowOverlap: 1 };

    const task: IngestTask = {
      id: 'task-1',
      conversationId,
      userId: 'user-mid',
      taskType: 'embed-message',
      messageId: messageIds[2], // sort_order=2 → in windows 0 and 1
      projectId: 'p',
      sessionId: null,
      status: 'processing',
      error: null,
      createdAt: 'now',
      startedAt: 'now',
      completedAt: null,
    };

    await processEmbedTask({ db, embedder, windowWriter, config }, task);

    // Embedder called twice — once per affected window.
    expect(calls).toHaveLength(2);
    // Window 0 = m0 + m1 + m2; window 1 = m2 + m3 + m4.
    expect(calls[0]).toBe('user: m0\nassistant: m1\nuser: m2');
    expect(calls[1]).toBe('user: m2\nassistant: m3\nuser: m4');

    const vecCount = db
      .prepare('SELECT COUNT(*) AS c FROM vec_windows WHERE conversation_id = ?')
      .get(conversationId) as { c: number };
    expect(vecCount.c).toBe(2);

    const joinRows = db
      .prepare(
        'SELECT window_index, message_id, position FROM window_messages WHERE conversation_id = ? ORDER BY window_index ASC, position ASC',
      )
      .all(conversationId) as { window_index: number; message_id: number; position: number }[];
    expect(joinRows).toHaveLength(6); // 3 + 3
    expect(joinRows.slice(0, 3).map((r) => r.message_id)).toEqual([
      messageIds[0],
      messageIds[1],
      messageIds[2],
    ]);
    expect(joinRows.slice(3, 6).map((r) => r.message_id)).toEqual([
      messageIds[2],
      messageIds[3],
      messageIds[4],
    ]);
  });

  it('throws IngestQueueError when the referenced message has been deleted (stale task)', async () => {
    const { conversationId, messageIds } = seedConversationWithMessages(
      ['m0', 'm1', 'm2'],
      'user-stale',
    );
    const { embedder, calls } = makeStubEmbedder();
    const windowWriter = createWindowWriter(db);
    const config = { windowSize: 3, windowOverlap: 1 };

    const staleId = messageIds[2];
    db.prepare('DELETE FROM window_messages WHERE message_id = ?').run(staleId);
    db.prepare('DELETE FROM messages WHERE id = ?').run(staleId);

    const task: IngestTask = {
      id: 'task-stale',
      conversationId,
      userId: 'user-stale',
      taskType: 'embed-message',
      messageId: staleId,
      projectId: 'p',
      sessionId: null,
      status: 'processing',
      error: null,
      createdAt: 'now',
      startedAt: 'now',
      completedAt: null,
    };

    await expect(
      processEmbedTask({ db, embedder, windowWriter, config }, task),
    ).rejects.toBeInstanceOf(IngestQueueError);
    expect(calls).toHaveLength(0);
  });

  it('throws IngestQueueError when the message exists but in a DIFFERENT conversation (corruption guard)', async () => {
    // Defense in depth: if a task's messageId references a message from
    // another conversation (stale task across a delete + reuse), the
    // conversation_id filter on the SELECT prevents windows being computed
    // against the wrong corpus.
    const { conversationId: convA, messageIds: idsA } = seedConversationWithMessages(
      ['a0', 'a1'],
      'user-a',
    );
    const { conversationId: convB } = seedConversationWithMessages(['b0'], 'user-b');

    const { embedder, calls } = makeStubEmbedder();
    const windowWriter = createWindowWriter(db);
    const config = { windowSize: 3, windowOverlap: 1 };

    // Task says conversationId = convB but messageId points at convA.
    const task: IngestTask = {
      id: 'task-mismatch',
      conversationId: convB,
      userId: 'user-b',
      taskType: 'embed-message',
      messageId: idsA[0],
      projectId: 'p',
      sessionId: null,
      status: 'processing',
      error: null,
      createdAt: 'now',
      startedAt: 'now',
      completedAt: null,
    };

    await expect(
      processEmbedTask({ db, embedder, windowWriter, config }, task),
    ).rejects.toBeInstanceOf(IngestQueueError);
    expect(calls).toHaveLength(0);
    // convA's corpus is intact — no windows accidentally written there.
    expect(convA).not.toBe(convB);
  });

  it('throws InvalidArgumentError when taskType is not embed-message', async () => {
    const { embedder } = makeStubEmbedder();
    const windowWriter = createWindowWriter(db);
    const config = { windowSize: 3, windowOverlap: 1 };

    const task: IngestTask = {
      id: 'task-wrong',
      conversationId: 'c',
      userId: 'u',
      taskType: 'extract-conversation',
      messageId: null,
      projectId: null,
      sessionId: null,
      status: 'processing',
      error: null,
      createdAt: 'now',
      startedAt: 'now',
      completedAt: null,
    };

    await expect(
      processEmbedTask({ db, embedder, windowWriter, config }, task),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('throws InvalidArgumentError on embed-message task with null messageId (corruption)', async () => {
    const { embedder } = makeStubEmbedder();
    const windowWriter = createWindowWriter(db);
    const config = { windowSize: 3, windowOverlap: 1 };

    const task: IngestTask = {
      id: 'task-null',
      conversationId: 'c',
      userId: 'u',
      taskType: 'embed-message',
      messageId: null,
      projectId: 'p',
      sessionId: null,
      status: 'processing',
      error: null,
      createdAt: 'now',
      startedAt: 'now',
      completedAt: null,
    };

    await expect(
      processEmbedTask({ db, embedder, windowWriter, config }, task),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
  });
});

describe('runEmbedWorker (end-to-end via IngestQueue.processNext)', () => {
  it('drains pending embed-message tasks and self-terminates on idle', async () => {
    const { conversationId } = seedConversationWithMessages(
      ['m0', 'm1', 'm2', 'm3', 'm4'],
      'user-drain',
    );

    const { embedder } = makeStubEmbedder();
    const windowWriter = createWindowWriter(db);
    const config = { windowSize: 3, windowOverlap: 1 };

    const queue = new IngestQueue({
      db,
      orchestrator: null,
      conversationStore: store,
      embedTaskHandler: createEmbedTaskHandler({ db, embedder, windowWriter, config }),
    });

    // Use the full indexer.ingest path so the queue gets real
    // embed-message tasks (one per inserted message). 5 turns ingested
    // means 5 tasks claimed → multiple windows touched.
    const indexer = createIndexer({
      db,
      conversationStore: store,
      ingestQueue: queue,
      config,
    });
    indexer.ingest(makeMessages(['t0', 't1', 't2', 't3', 't4']), {
      projectId: 'p',
      conversationId,
    });

    const tasksProcessed = await runEmbedWorker(queue);

    // 5 messages were ingested. Each generated one embed-message task.
    expect(tasksProcessed).toBe(5);

    const completedCount = db
      .prepare(
        "SELECT COUNT(*) AS c FROM pending_ingest_tasks WHERE status = 'completed' AND task_type = 'embed-message'",
      )
      .get() as { c: number };
    expect(completedCount.c).toBe(5);

    const failedCount = db
      .prepare("SELECT COUNT(*) AS c FROM pending_ingest_tasks WHERE status = 'failed'")
      .get() as { c: number };
    expect(failedCount.c).toBe(0);

    // The new conversation has 1 seed message + 5 ingested = 6 messages
    // total. With windowSize=3, overlap=1, stride=2: windows [0..2], [2..4],
    // [3..5] (tail-slid) → 3 distinct vec_windows rows.
    const vecCount = db
      .prepare('SELECT COUNT(*) AS c FROM vec_windows WHERE conversation_id = ?')
      .get(conversationId) as { c: number };
    expect(vecCount.c).toBe(3);
  });

  it('returns 0 when the queue is empty (idle on first call)', async () => {
    const { embedder } = makeStubEmbedder();
    const windowWriter = createWindowWriter(db);
    const config = { windowSize: 3, windowOverlap: 1 };

    const queue = new IngestQueue({
      db,
      orchestrator: null,
      conversationStore: store,
      embedTaskHandler: createEmbedTaskHandler({ db, embedder, windowWriter, config }),
    });

    const tasksProcessed = await runEmbedWorker(queue);
    expect(tasksProcessed).toBe(0);
  });
});

describe('crash-recovery via stale-claim reset (sprint-015 Story 6)', () => {
  it('re-claims a task that was claimed but never marked complete', async () => {
    // Inline simulation of the "worker crashed mid-task" scenario:
    // 1. Enqueue tasks via real ingest path.
    // 2. claimNext one task — sets status='processing', started_at=now.
    // 3. Manually backdate started_at past the stale-claim threshold.
    // 4. processNext (a) fires the stale-claim reset (started_at older
    //    than threshold → status back to 'pending'), (b) claims the
    //    same row, (c) processes it. Without (a), the row would sit in
    //    'processing' forever.
    const { conversationId } = seedConversationWithMessages(['m0', 'm1', 'm2'], 'user-crash');

    const { embedder } = makeStubEmbedder();
    const windowWriter = createWindowWriter(db);
    const config = { windowSize: 3, windowOverlap: 1 };

    const queue = new IngestQueue({
      db,
      orchestrator: null,
      conversationStore: store,
      embedTaskHandler: createEmbedTaskHandler({ db, embedder, windowWriter, config }),
    });

    const indexer = createIndexer({
      db,
      conversationStore: store,
      ingestQueue: queue,
      config,
    });
    indexer.ingest(makeMessages(['t0']), { projectId: 'p', conversationId });

    // Step 2: claim the task without processing it (simulates crash
    // BEFORE markCompleted runs).
    const claimed = queue.claimNext();
    expect(claimed).not.toBeNull();
    const taskId = claimed!.id;

    // Step 3: backdate started_at far past the stale-claim threshold so
    // the next processNext call's reset path picks it up.
    db.prepare(
      `UPDATE pending_ingest_tasks
       SET started_at = datetime('now', '-1 hour')
       WHERE id = ?`,
    ).run(taskId);

    // Confirm it's still in 'processing' but stale.
    const beforeStatus = (
      db.prepare('SELECT status FROM pending_ingest_tasks WHERE id = ?').get(taskId) as {
        status: string;
      }
    ).status;
    expect(beforeStatus).toBe('processing');

    // Step 4: drain the queue. The stale-claim reset path inside
    // claimNext flips the row back to 'pending', then re-claims it,
    // then the embedTaskHandler processes it normally → markCompleted.
    const processed = await runEmbedWorker(queue);
    expect(processed).toBe(1);

    const afterStatus = (
      db.prepare('SELECT status FROM pending_ingest_tasks WHERE id = ?').get(taskId) as {
        status: string;
      }
    ).status;
    expect(afterStatus).toBe('completed');
  });
});
