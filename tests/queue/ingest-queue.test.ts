import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from '../../src/core/database.js';
import { ConversationStore } from '../../src/conversations/store.js';
import { IngestQueue, type IngestTask } from '../../src/queue/ingest-queue.js';
import { AppError, EmbedderError } from '../../src/core/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleConversation = [
  { role: 'user' as const, content: 'I just got back from Tokyo' },
  { role: 'assistant' as const, content: 'How was your trip?' },
];

const seedConversation = (
  db: Database.Database,
  store: ConversationStore,
  conversation = sampleConversation,
  userId = 'user-1',
): { conversationId: string; messageIds: number[] } => {
  const conversationId = store.addConversation(conversation, userId);
  const rows = db
    .prepare('SELECT id FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC')
    .all(conversationId) as { id: number }[];
  return { conversationId, messageIds: rows.map((r) => r.id) };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IngestQueue', () => {
  let db: Database.Database;
  let conversationStore: ConversationStore;
  let queue: IngestQueue;

  beforeEach(() => {
    db = createDatabase(':memory:');
    conversationStore = new ConversationStore(db);
    queue = new IngestQueue({ db });
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // enqueueMessageEmbed()
  // -------------------------------------------------------------------------

  describe('enqueueMessageEmbed()', () => {
    it('inserts a row with task_type=embed-message + the supplied message-level fields', () => {
      const { conversationId, messageIds } = seedConversation(db, conversationStore);
      const messageId = messageIds[0];

      const taskId = queue.enqueueMessageEmbed({
        messageId,
        conversationId,
        userId: 'user-1',
        projectId: 'proj-direct',
        sessionId: 'sess-direct',
      });

      expect(typeof taskId).toBe('string');
      expect(taskId).not.toBe('');

      const row = db.prepare('SELECT * FROM pending_ingest_tasks WHERE id = ?').get(taskId) as {
        id: string;
        conversation_id: string;
        user_id: string;
        task_type: string;
        message_id: number;
        project_id: string;
        session_id: string | null;
        status: string;
      };
      expect(row.id).toBe(taskId);
      expect(row.conversation_id).toBe(conversationId);
      expect(row.user_id).toBe('user-1');
      expect(row.task_type).toBe('embed-message');
      expect(row.message_id).toBe(messageId);
      expect(row.project_id).toBe('proj-direct');
      expect(row.session_id).toBe('sess-direct');
      expect(row.status).toBe('pending');
    });

    it('stores session_id as NULL when omitted', () => {
      const { conversationId, messageIds } = seedConversation(db, conversationStore);

      const taskId = queue.enqueueMessageEmbed({
        messageId: messageIds[0],
        conversationId,
        userId: 'user-1',
        projectId: 'proj-no-session',
      });

      const row = db
        .prepare('SELECT session_id FROM pending_ingest_tasks WHERE id = ?')
        .get(taskId) as { session_id: string | null };
      expect(row.session_id).toBeNull();
    });

    it('returns distinct task ids for repeated calls (UUID per insert)', () => {
      const { conversationId, messageIds } = seedConversation(db, conversationStore);
      const messageId = messageIds[0];

      const t1 = queue.enqueueMessageEmbed({
        messageId,
        conversationId,
        userId: 'user-1',
        projectId: 'p',
      });
      const t2 = queue.enqueueMessageEmbed({
        messageId,
        conversationId,
        userId: 'user-1',
        projectId: 'p',
      });
      expect(t1).not.toBe(t2);

      const count = db
        .prepare(
          "SELECT COUNT(*) AS c FROM pending_ingest_tasks WHERE task_type = 'embed-message' AND conversation_id = ?",
        )
        .get(conversationId) as { c: number };
      expect(count.c).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // claimNext()
  // -------------------------------------------------------------------------

  describe('claimNext()', () => {
    it('claims next pending task and sets status to processing', () => {
      const { conversationId, messageIds } = seedConversation(db, conversationStore);
      queue.enqueueMessageEmbed({
        messageId: messageIds[0],
        conversationId,
        userId: 'user-1',
        projectId: 'p',
      });

      const task = queue.claimNext();
      expect(task).not.toBeNull();
      expect(task!.status).toBe('processing');
      expect(task!.startedAt).toBeTruthy();
      expect(task!.userId).toBe('user-1');
    });

    it('returns null when no pending tasks', () => {
      const task = queue.claimNext();
      expect(task).toBeNull();
    });

    it('resets stale processing rows to pending before claiming', () => {
      const { conversationId, messageIds } = seedConversation(db, conversationStore);
      queue.enqueueMessageEmbed({
        messageId: messageIds[0],
        conversationId,
        userId: 'user-1',
        projectId: 'p',
      });
      const task = queue.claimNext();
      expect(task).not.toBeNull();

      // Simulate stale: set started_at to 60 seconds ago
      db.prepare(
        `UPDATE pending_ingest_tasks
         SET started_at = datetime('now', '-60 seconds')
         WHERE id = ?`,
      ).run(task!.id);

      const reclaimed = queue.claimNext();
      expect(reclaimed).not.toBeNull();
      expect(reclaimed!.id).toBe(task!.id);
      expect(reclaimed!.status).toBe('processing');
    });

    it('claims different tasks on sequential calls', () => {
      const { conversationId, messageIds } = seedConversation(db, conversationStore);
      queue.enqueueMessageEmbed({
        messageId: messageIds[0],
        conversationId,
        userId: 'user-1',
        projectId: 'p',
      });
      queue.enqueueMessageEmbed({
        messageId: messageIds[1],
        conversationId,
        userId: 'user-1',
        projectId: 'p',
      });

      const first = queue.claimNext();
      const second = queue.claimNext();

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first!.id).not.toBe(second!.id);
    });
  });

  // -------------------------------------------------------------------------
  // processNext()
  // -------------------------------------------------------------------------

  describe('processNext()', () => {
    it('claims an embed-message task, runs the handler, marks completed', async () => {
      const handler = vi.fn(async (_task: IngestTask) => undefined);
      const handlerQueue = new IngestQueue({ db, embedTaskHandler: handler });
      const { conversationId, messageIds } = seedConversation(db, conversationStore);
      handlerQueue.enqueueMessageEmbed({
        messageId: messageIds[0],
        conversationId,
        userId: 'user-1',
        projectId: 'p',
      });

      const task = await handlerQueue.processNext();
      expect(task).not.toBeNull();
      expect(handler).toHaveBeenCalledOnce();

      const row = db
        .prepare('SELECT status FROM pending_ingest_tasks WHERE id = ?')
        .get(task!.id) as { status: string };
      expect(row.status).toBe('completed');
    });

    it('marks failed when no embed handler is configured', async () => {
      const { conversationId, messageIds } = seedConversation(db, conversationStore);
      queue.enqueueMessageEmbed({
        messageId: messageIds[0],
        conversationId,
        userId: 'user-1',
        projectId: 'p',
      });

      const task = await queue.processNext();
      expect(task).not.toBeNull();

      const row = db
        .prepare('SELECT status, error FROM pending_ingest_tasks WHERE id = ?')
        .get(task!.id) as { status: string; error: string };
      expect(row.status).toBe('failed');
      expect(row.error).toContain('embedTaskHandler');
    });

    it('marks failed on terminal handler error', async () => {
      const failingHandler = vi.fn(async () => {
        throw new Error('malformed message data');
      });
      const failQueue = new IngestQueue({ db, embedTaskHandler: failingHandler });
      const { conversationId, messageIds } = seedConversation(db, conversationStore);
      failQueue.enqueueMessageEmbed({
        messageId: messageIds[0],
        conversationId,
        userId: 'user-1',
        projectId: 'p',
      });

      const task = await failQueue.processNext();

      const row = db
        .prepare('SELECT status, error FROM pending_ingest_tasks WHERE id = ?')
        .get(task!.id) as { status: string; error: string };
      expect(row.status).toBe('failed');
      expect(row.error).toContain('malformed message data');
    });

    it('resets to pending on retryable Ollama error from handler', async () => {
      const ollamaHandler = vi.fn(async () => {
        throw new EmbedderError(
          'Ollama embedding request failed: fetch failed. Is Ollama running?',
        );
      });
      const ollamaQueue = new IngestQueue({ db, embedTaskHandler: ollamaHandler });
      const { conversationId, messageIds } = seedConversation(db, conversationStore);
      ollamaQueue.enqueueMessageEmbed({
        messageId: messageIds[0],
        conversationId,
        userId: 'user-1',
        projectId: 'p',
      });

      const task = await ollamaQueue.processNext();

      const row = db
        .prepare('SELECT status FROM pending_ingest_tasks WHERE id = ?')
        .get(task!.id) as { status: string };
      expect(row.status).toBe('pending');
    });

    it('resets to pending on retryable AppError from handler', async () => {
      const ollamaHandler = vi.fn(async () => {
        throw new AppError('Ollama request failed: max retries exceeded');
      });
      const ollamaQueue = new IngestQueue({ db, embedTaskHandler: ollamaHandler });
      const { conversationId, messageIds } = seedConversation(db, conversationStore);
      ollamaQueue.enqueueMessageEmbed({
        messageId: messageIds[0],
        conversationId,
        userId: 'user-1',
        projectId: 'p',
      });

      const task = await ollamaQueue.processNext();

      const row = db
        .prepare('SELECT status FROM pending_ingest_tasks WHERE id = ?')
        .get(task!.id) as { status: string };
      expect(row.status).toBe('pending');
    });

    it('returns null when no pending tasks', async () => {
      const task = await queue.processNext();
      expect(task).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Multi-connection concurrency — ported from the deleted
  // tests/integration/ingest-queue.test.ts so the queue's SQLite-level
  // contracts (atomic claim, busy_timeout) stay covered.
  // -------------------------------------------------------------------------

  describe('multi-connection concurrency', () => {
    let tempDir: string;
    let dbPath: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'pristine-queue-concurrency-'));
      dbPath = join(tempDir, 'test.db');
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('two separate connections claim different tasks', () => {
      const db1 = createDatabase(dbPath);
      const db2 = createDatabase(dbPath);
      try {
        const convStore1 = new ConversationStore(db1);
        const queue1 = new IngestQueue({ db: db1 });
        const queue2 = new IngestQueue({ db: db2 });

        const { conversationId, messageIds } = seedConversation(db1, convStore1, [
          { role: 'user', content: 'A' },
          { role: 'assistant', content: 'B' },
          { role: 'user', content: 'C' },
          { role: 'assistant', content: 'D' },
          { role: 'user', content: 'E' },
        ]);
        for (const messageId of messageIds) {
          queue1.enqueueMessageEmbed({
            messageId,
            conversationId,
            userId: 'user-1',
            projectId: 'p',
          });
        }

        const first = queue1.claimNext();
        const second = queue2.claimNext();

        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(first!.id).not.toBe(second!.id);
      } finally {
        db1.close();
        db2.close();
      }
    });

    it('busy_timeout allows concurrent enqueue without SQLITE_BUSY', () => {
      const db1 = createDatabase(dbPath);
      const db2 = createDatabase(dbPath);
      try {
        const convStore1 = new ConversationStore(db1);
        const convStore2 = new ConversationStore(db2);
        const queue1 = new IngestQueue({ db: db1 });
        const queue2 = new IngestQueue({ db: db2 });

        const c1 = seedConversation(
          db1,
          convStore1,
          [{ role: 'user', content: 'From writer 1' }],
          'u1',
        );
        const c2 = seedConversation(
          db2,
          convStore2,
          [{ role: 'user', content: 'From writer 2' }],
          'u2',
        );

        expect(() => {
          queue1.enqueueMessageEmbed({
            messageId: c1.messageIds[0],
            conversationId: c1.conversationId,
            userId: 'u1',
            projectId: 'p',
          });
          queue2.enqueueMessageEmbed({
            messageId: c2.messageIds[0],
            conversationId: c2.conversationId,
            userId: 'u2',
            projectId: 'p',
          });
        }).not.toThrow();

        expect(queue1.pending).toBe(2);
      } finally {
        db1.close();
        db2.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // pending
  // -------------------------------------------------------------------------

  describe('pending', () => {
    it('returns count of pending + processing tasks', () => {
      expect(queue.pending).toBe(0);

      const { conversationId, messageIds } = seedConversation(db, conversationStore);
      queue.enqueueMessageEmbed({
        messageId: messageIds[0],
        conversationId,
        userId: 'user-1',
        projectId: 'p',
      });
      queue.enqueueMessageEmbed({
        messageId: messageIds[1],
        conversationId,
        userId: 'user-1',
        projectId: 'p',
      });
      expect(queue.pending).toBe(2);

      // Claim one (now processing)
      queue.claimNext();
      expect(queue.pending).toBe(2); // 1 pending + 1 processing

      // Mark the processing one completed
      const rows = db
        .prepare("SELECT id FROM pending_ingest_tasks WHERE status = 'processing'")
        .all() as { id: string }[];
      db.prepare("UPDATE pending_ingest_tasks SET status = 'completed' WHERE id = ?").run(
        rows[0].id,
      );
      expect(queue.pending).toBe(1);

      // Mark the other as failed
      queue.claimNext();
      const failedRows = db
        .prepare("SELECT id FROM pending_ingest_tasks WHERE status = 'processing'")
        .all() as { id: string }[];
      db.prepare("UPDATE pending_ingest_tasks SET status = 'failed' WHERE id = ?").run(
        failedRows[0].id,
      );
      expect(queue.pending).toBe(0);
    });
  });
});
