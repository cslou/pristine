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
        facts: [{ text: 'test fact' }],
        decisions: [{ action: 'ADD', factIndex: 0 }],
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
