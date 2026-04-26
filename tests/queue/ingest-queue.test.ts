import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from '../../src/core/database.js';
import { ConversationStore } from '../../src/conversations/store.js';
import { IngestQueue } from '../../src/queue/ingest-queue.js';
import type { Orchestrator } from '../../src/core/interfaces.js';
import { AppError, EmbedderError } from '../../src/core/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createMockOrchestrator = (ingestFn?: Orchestrator['ingest']): Orchestrator =>
  ({
    ingest:
      ingestFn ??
      vi.fn(async () => ({
        memoryIds: ['mem-1'],
        errors: [],
      })),
    retrieve: vi.fn(),
    store: vi.fn(),
    search: vi.fn(),
    ingestSteps: [],
    retrieveSteps: [],
    registerIngestStep: vi.fn(),
    registerRetrieveStep: vi.fn(),
  }) as unknown as Orchestrator;

const sampleConversation = [
  { role: 'user' as const, content: 'I just got back from Tokyo' },
  { role: 'assistant' as const, content: 'How was your trip?' },
];

const makeConversation = (suffix: string) => [
  { role: 'user' as const, content: `Message ${suffix}` },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IngestQueue', () => {
  let db: Database.Database;
  let conversationStore: ConversationStore;
  let orchestrator: Orchestrator;
  let queue: IngestQueue;

  beforeEach(() => {
    db = createDatabase(':memory:');
    conversationStore = new ConversationStore(db);
    orchestrator = createMockOrchestrator();
    queue = new IngestQueue({ db, orchestrator, conversationStore });
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // enqueue()
  // -------------------------------------------------------------------------

  describe('enqueue()', () => {
    it('writes conversation + pending task atomically', () => {
      const taskId = queue.enqueue(sampleConversation, 'user-1');
      expect(taskId).toBeTruthy();

      // Verify conversation stored
      const conversations = conversationStore.searchConversations({
        userId: 'user-1',
      });
      expect(conversations).toHaveLength(1);

      // Verify pending task exists
      const row = db.prepare('SELECT * FROM pending_ingest_tasks WHERE id = ?').get(taskId) as {
        status: string;
        user_id: string;
        conversation_id: string;
      };
      expect(row.status).toBe('pending');
      expect(row.user_id).toBe('user-1');
      expect(row.conversation_id).toBeTruthy();
    });

    it('returns a non-empty task ID', () => {
      const taskId = queue.enqueue(sampleConversation, 'user-1');
      expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('task has created_at set', () => {
      const taskId = queue.enqueue(sampleConversation, 'user-1');
      const row = db
        .prepare('SELECT created_at FROM pending_ingest_tasks WHERE id = ?')
        .get(taskId) as { created_at: string };
      expect(row.created_at).toBeTruthy();
    });

    it('returns empty string for duplicate conversation', () => {
      queue.enqueue(sampleConversation, 'user-1');
      const result = queue.enqueue(sampleConversation, 'user-1');
      expect(result).toBe('');
    });

    it('does not create a pending task for duplicate conversation', () => {
      queue.enqueue(sampleConversation, 'user-1');
      queue.enqueue(sampleConversation, 'user-1');

      const count = db.prepare('SELECT COUNT(*) AS count FROM pending_ingest_tasks').get() as {
        count: number;
      };
      expect(count.count).toBe(1);
    });

    it('rolls back conversation if pending task insert fails', () => {
      // First enqueue so user-1 has a conversation
      queue.enqueue(sampleConversation, 'user-1');

      // Manually insert a task with a known ID to cause a UNIQUE constraint
      // violation on the next enqueue with the same ID
      // Instead, we test transaction atomicity by corrupting the table
      db.exec('DROP TABLE pending_ingest_tasks');
      db.exec(`CREATE TABLE pending_ingest_tasks (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT,
        CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
      )`);
      // Add a trigger that always fails to simulate insert failure
      db.exec(`CREATE TRIGGER fail_insert BEFORE INSERT ON pending_ingest_tasks
        BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`);

      const newConversation = [
        { role: 'user' as const, content: 'This is a new unique conversation' },
      ];

      expect(() => queue.enqueue(newConversation, 'user-2')).toThrow('simulated failure');

      // Verify conversation was rolled back — only the first one should exist
      const conversations = conversationStore.searchConversations({
        userId: 'user-2',
      });
      expect(conversations).toHaveLength(0);

      // The original conversation from user-1 should still exist
      const originalCount = db
        .prepare('SELECT COUNT(*) AS count FROM conversations WHERE user_id = ?')
        .get('user-1') as { count: number };
      expect(originalCount.count).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // enqueueMessageEmbed()
  // -------------------------------------------------------------------------

  describe('enqueueMessageEmbed()', () => {
    it('inserts a row with task_type=embed-message + the supplied message-level fields', () => {
      // The conversation has to exist for the FK to pass.
      const conversationId = conversationStore.addConversation(sampleConversation, 'user-em');
      const messageRows = db
        .prepare('SELECT id FROM messages WHERE conversation_id = ?')
        .all(conversationId) as { id: number }[];
      const messageId = messageRows[0].id;

      const taskId = queue.enqueueMessageEmbed({
        messageId,
        conversationId,
        userId: 'user-em',
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
      expect(row.user_id).toBe('user-em');
      expect(row.task_type).toBe('embed-message');
      expect(row.message_id).toBe(messageId);
      expect(row.project_id).toBe('proj-direct');
      expect(row.session_id).toBe('sess-direct');
      expect(row.status).toBe('pending');
    });

    it('stores session_id as NULL when omitted', () => {
      const conversationId = conversationStore.addConversation(sampleConversation, 'user-em2');
      const messageId = (
        db.prepare('SELECT id FROM messages WHERE conversation_id = ?').get(conversationId) as {
          id: number;
        }
      ).id;

      const taskId = queue.enqueueMessageEmbed({
        messageId,
        conversationId,
        userId: 'user-em2',
        projectId: 'proj-no-session',
      });

      const row = db
        .prepare('SELECT session_id FROM pending_ingest_tasks WHERE id = ?')
        .get(taskId) as { session_id: string | null };
      expect(row.session_id).toBeNull();
    });

    it('returns distinct task ids for repeated calls (UUID per insert)', () => {
      const conversationId = conversationStore.addConversation(sampleConversation, 'user-em3');
      const messageId = (
        db.prepare('SELECT id FROM messages WHERE conversation_id = ?').get(conversationId) as {
          id: number;
        }
      ).id;

      const t1 = queue.enqueueMessageEmbed({
        messageId,
        conversationId,
        userId: 'user-em3',
        projectId: 'p',
      });
      const t2 = queue.enqueueMessageEmbed({
        messageId,
        conversationId,
        userId: 'user-em3',
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
      queue.enqueue(sampleConversation, 'user-1');

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
      queue.enqueue(sampleConversation, 'user-1');
      const task = queue.claimNext();
      expect(task).not.toBeNull();

      // Simulate stale: set started_at to 60 seconds ago
      db.prepare(
        `UPDATE pending_ingest_tasks
         SET started_at = datetime('now', '-60 seconds')
         WHERE id = ?`,
      ).run(task!.id);

      // claimNext should reset the stale row and re-claim it
      const reclaimed = queue.claimNext();
      expect(reclaimed).not.toBeNull();
      expect(reclaimed!.id).toBe(task!.id);
      expect(reclaimed!.status).toBe('processing');
    });

    it('claims different tasks on sequential calls', () => {
      queue.enqueue(makeConversation('A'), 'user-1');
      queue.enqueue(makeConversation('B'), 'user-1');

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
    it('claims, runs orchestrator.ingest, and marks completed', async () => {
      queue.enqueue(sampleConversation, 'user-1');

      const task = await queue.processNext();
      expect(task).not.toBeNull();

      // Verify orchestrator.ingest was called
      expect(orchestrator.ingest).toHaveBeenCalledOnce();

      // Verify task marked completed
      const row = db
        .prepare('SELECT status FROM pending_ingest_tasks WHERE id = ?')
        .get(task!.id) as { status: string };
      expect(row.status).toBe('completed');
    });

    it('passes sourceConversationId to orchestrator.ingest', async () => {
      queue.enqueue(sampleConversation, 'user-1');

      await queue.processNext();

      const call = (orchestrator.ingest as ReturnType<typeof vi.fn>).mock.calls[0];
      // call[0] = messages, call[1] = userId, call[2] = options
      expect(call[1]).toBe('user-1');
      expect(call[2]).toHaveProperty('sourceConversationId');
      expect(call[2].sourceConversationId).toBeTruthy();
    });

    it('marks failed on terminal error', async () => {
      const failOrchestrator = createMockOrchestrator(
        vi.fn(async () => {
          throw new Error('malformed conversation data');
        }) as unknown as Orchestrator['ingest'],
      );
      const failQueue = new IngestQueue({
        db,
        orchestrator: failOrchestrator,
        conversationStore,
      });

      failQueue.enqueue(sampleConversation, 'user-1');
      const task = await failQueue.processNext();

      const row = db
        .prepare('SELECT status, error FROM pending_ingest_tasks WHERE id = ?')
        .get(task!.id) as { status: string; error: string };
      expect(row.status).toBe('failed');
      expect(row.error).toContain('malformed conversation data');
    });

    it('resets to pending on retryable Ollama error', async () => {
      const ollamaOrchestrator = createMockOrchestrator(
        vi.fn(async () => {
          throw new EmbedderError(
            'Ollama embedding request failed: fetch failed. Is Ollama running?',
          );
        }) as unknown as Orchestrator['ingest'],
      );
      const ollamaQueue = new IngestQueue({
        db,
        orchestrator: ollamaOrchestrator,
        conversationStore,
      });

      ollamaQueue.enqueue(sampleConversation, 'user-1');
      const task = await ollamaQueue.processNext();

      const row = db
        .prepare('SELECT status FROM pending_ingest_tasks WHERE id = ?')
        .get(task!.id) as { status: string };
      expect(row.status).toBe('pending');
    });

    it('resets to pending on retryable AppError from OllamaClient', async () => {
      const ollamaOrchestrator = createMockOrchestrator(
        vi.fn(async () => {
          throw new AppError('Ollama request failed: max retries exceeded');
        }) as unknown as Orchestrator['ingest'],
      );
      const ollamaQueue = new IngestQueue({
        db,
        orchestrator: ollamaOrchestrator,
        conversationStore,
      });

      ollamaQueue.enqueue(sampleConversation, 'user-1');
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
  // orchestrator guard — ported from the deleted integration test; covers the
  // post-spec-005-Phase-1 state where client.ts constructs IngestQueue with
  // orchestrator: null
  // -------------------------------------------------------------------------

  describe('processNext() orchestrator guard', () => {
    it('marks legacy extract-conversation tasks failed when orchestrator is null (spec-005 Phase-1 state)', async () => {
      // Pre-Story-6 contract: processNext threw IngestQueueError upfront on
      // null orchestrator. Story 6 changed processNext to dispatch by
      // task_type — the throw is now caught inside the try-catch and the
      // specific task is marked 'failed' with the error message preserved.
      // More graceful: one bad legacy task no longer poisons the whole
      // worker loop.
      const localDb = createDatabase(':memory:');
      try {
        const localStore = new ConversationStore(localDb);
        const nullQueue = new IngestQueue({
          db: localDb,
          orchestrator: null,
          conversationStore: localStore,
        });
        const taskId = nullQueue.enqueue(sampleConversation, 'user-guard');

        const task = await nullQueue.processNext();
        expect(task).not.toBeNull();

        const row = localDb
          .prepare('SELECT status, error FROM pending_ingest_tasks WHERE id = ?')
          .get(taskId) as { status: string; error: string };
        expect(row.status).toBe('failed');
        expect(row.error).toContain('orchestrator pipeline was removed in spec-005 Phase 1');
      } finally {
        localDb.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Multi-connection concurrency — ported from the deleted
  // tests/integration/ingest-queue.test.ts so the queue's SQLite-level
  // contracts (atomic claim, busy_timeout) stay covered after spec-005 Phase 1
  // removed the pipeline-coupled integration suite.
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
        const queue1 = new IngestQueue({
          db: db1,
          orchestrator: createMockOrchestrator(),
          conversationStore: convStore1,
        });
        const convStore2 = new ConversationStore(db2);
        const queue2 = new IngestQueue({
          db: db2,
          orchestrator: createMockOrchestrator(),
          conversationStore: convStore2,
        });

        for (let i = 0; i < 5; i += 1) {
          queue1.enqueue(makeConversation(`task-${i}`), 'user-1');
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
        const queue1 = new IngestQueue({
          db: db1,
          orchestrator: createMockOrchestrator(),
          conversationStore: convStore1,
        });
        const queue2 = new IngestQueue({
          db: db2,
          orchestrator: createMockOrchestrator(),
          conversationStore: convStore2,
        });

        expect(() => {
          queue1.enqueue([{ role: 'user', content: 'From writer 1' }], 'user-1');
          queue2.enqueue([{ role: 'user', content: 'From writer 2' }], 'user-2');
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

      queue.enqueue(makeConversation('A'), 'user-1');
      queue.enqueue(makeConversation('B'), 'user-1');
      expect(queue.pending).toBe(2);

      // Claim one (now processing)
      queue.claimNext();
      expect(queue.pending).toBe(2); // 1 pending + 1 processing

      // Process the claimed one would mark completed, reducing pending
      // Instead, manually mark it to test counting
      const rows = db
        .prepare("SELECT id FROM pending_ingest_tasks WHERE status = 'processing'")
        .all() as { id: string }[];
      db.prepare("UPDATE pending_ingest_tasks SET status = 'completed' WHERE id = ?").run(
        rows[0].id,
      );
      expect(queue.pending).toBe(1); // 1 pending, 0 processing

      // Mark the other as failed
      queue.claimNext();
      const failedRows = db
        .prepare("SELECT id FROM pending_ingest_tasks WHERE status = 'processing'")
        .all() as { id: string }[];
      db.prepare("UPDATE pending_ingest_tasks SET status = 'failed' WHERE id = ?").run(
        failedRows[0].id,
      );
      expect(queue.pending).toBe(0); // 0 pending, 0 processing
    });
  });
});
