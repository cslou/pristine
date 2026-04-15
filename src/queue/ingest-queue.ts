import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Message } from '../core/types.js';
import type { Orchestrator } from '../core/interfaces.js';
import type { ConversationStore } from '../conversations/store.js';
import { IngestQueueError } from '../core/errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_SECONDS = 30;

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

const INGEST_QUEUE_DDL = `
CREATE TABLE IF NOT EXISTS pending_ingest_tasks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_ingest_tasks_status
  ON pending_ingest_tasks(status);
`;

export function initIngestQueueTables(db: Database.Database): void {
  db.exec(INGEST_QUEUE_DDL);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IngestTaskRow {
  id: string;
  conversation_id: string;
  user_id: string;
  status: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface IngestTask {
  readonly id: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly status: 'pending' | 'processing' | 'completed' | 'failed';
  readonly error: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface IngestQueueConfig {
  readonly db: Database.Database;
  readonly orchestrator: Orchestrator;
  readonly conversationStore: ConversationStore;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set(['pending', 'processing', 'completed', 'failed']);

const mapTaskRow = (row: IngestTaskRow): IngestTask => ({
  id: row.id,
  conversationId: row.conversation_id,
  userId: row.user_id,
  status: VALID_STATUSES.has(row.status) ? (row.status as IngestTask['status']) : 'pending',
  error: row.error,
  createdAt: row.created_at,
  startedAt: row.started_at,
  completedAt: row.completed_at,
});

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

const isRetryableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('ollama') ||
    msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up')
  );
};

// ---------------------------------------------------------------------------
// IngestQueue
// ---------------------------------------------------------------------------

export class IngestQueue {
  private readonly db: Database.Database;
  private readonly orchestrator: Orchestrator;
  private readonly conversationStore: ConversationStore;

  public constructor(config: IngestQueueConfig) {
    this.db = config.db;
    this.orchestrator = config.orchestrator;
    this.conversationStore = config.conversationStore;
    initIngestQueueTables(config.db);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Atomically store a conversation and enqueue it for extraction.
   * Returns the task ID, or empty string if the conversation is a duplicate.
   */
  public enqueue(
    conversation: readonly {
      readonly role: string;
      readonly content: string;
      readonly timestamp?: string;
    }[],
    userId: string,
  ): string {
    const taskId = randomUUID();

    const insertTask = this.db.prepare(
      `INSERT INTO pending_ingest_tasks (id, conversation_id, user_id)
       VALUES (?, ?, ?)`,
    );

    const runTransaction = this.db.transaction(() => {
      let conversationId: string;
      try {
        conversationId = this.conversationStore.addConversation(conversation, userId);
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
          return null;
        }
        const msg = error instanceof Error ? error.message : 'unknown error';
        throw new IngestQueueError(`Failed to enqueue conversation: ${msg}`);
      }
      insertTask.run(taskId, conversationId, userId);
      return taskId;
    });

    const result = runTransaction();
    if (result === null) {
      return '';
    }
    return result;
  }

  /**
   * Reset stale processing rows, then atomically claim the next pending task.
   * Returns null if no tasks are pending.
   */
  public claimNext(): IngestTask | null {
    this.db
      .prepare(
        `UPDATE pending_ingest_tasks
       SET status = 'pending', started_at = NULL
       WHERE status = 'processing'
         AND started_at < datetime('now', ?)`,
      )
      .run(`-${STALE_THRESHOLD_SECONDS} seconds`);

    const row = this.db
      .prepare(
        `UPDATE pending_ingest_tasks
       SET status = 'processing', started_at = datetime('now')
       WHERE id = (
         SELECT id FROM pending_ingest_tasks
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1
       )
       RETURNING *`,
      )
      .get() as IngestTaskRow | undefined;

    return row ? mapTaskRow(row) : null;
  }

  /**
   * Claim and process the next pending task.
   * On retryable errors (Ollama down), resets to pending for retry.
   * On terminal errors, marks as failed.
   * Returns the claimed task, or null if queue is empty.
   */
  public async processNext(): Promise<IngestTask | null> {
    if (!this.orchestrator) {
      throw new IngestQueueError(
        'processNext() requires a full client with an orchestrator. ' +
          'Lite clients can only call enqueue().',
      );
    }

    const task = this.claimNext();
    if (!task) return null;

    try {
      const stored = this.conversationStore.getConversation(task.conversationId);
      if (!stored) {
        const errorMsg = `Conversation ${task.conversationId} not found`;
        this.markFailed(task.id, errorMsg);
        return task;
      }

      const messages: Message[] = stored.messages.map((m) => ({
        role:
          m.role === 'system' || m.role === 'user' || m.role === 'assistant'
            ? (m.role as Message['role'])
            : 'user',
        content: m.content,
        ...(m.timestamp ? { timestamp: m.timestamp } : {}),
      }));

      await this.orchestrator.ingest(messages, task.userId, {
        sourceConversationId: task.conversationId,
      });

      this.markCompleted(task.id);
    } catch (error: unknown) {
      if (isRetryableError(error)) {
        this.resetToPending(task.id);
      } else {
        const msg = error instanceof Error ? error.message : 'unknown error';
        this.markFailed(task.id, msg);
      }
    }

    return task;
  }

  /**
   * Reset all failed tasks to pending so they can be retried.
   * Returns the number of tasks reset.
   */
  public resetFailed(): number {
    const result = this.db
      .prepare(
        `UPDATE pending_ingest_tasks
       SET status = 'pending', started_at = NULL
       WHERE status = 'failed'`,
      )
      .run();
    return result.changes;
  }

  /**
   * Number of tasks that are pending or currently being processed.
   */
  public get pending(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM pending_ingest_tasks
       WHERE status IN ('pending', 'processing')`,
      )
      .get() as { count: number };
    return row.count;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private markCompleted(taskId: string): void {
    this.db
      .prepare(
        `UPDATE pending_ingest_tasks
       SET status = 'completed', completed_at = datetime('now')
       WHERE id = ?`,
      )
      .run(taskId);
  }

  private markFailed(taskId: string, error: string): void {
    this.db
      .prepare(
        `UPDATE pending_ingest_tasks
       SET status = 'failed', error = ?, completed_at = datetime('now')
       WHERE id = ?`,
      )
      .run(error, taskId);
  }

  private resetToPending(taskId: string): void {
    this.db
      .prepare(
        `UPDATE pending_ingest_tasks
       SET status = 'pending', started_at = NULL
       WHERE id = ?`,
      )
      .run(taskId);
  }
}
