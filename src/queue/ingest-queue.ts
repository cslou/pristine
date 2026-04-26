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

// `task_type` distinguishes the spec-003 conversation-level extract task
// (default) from the spec-005 Phase-3 per-message embed task. The default
// preserves the legacy enqueue() contract; embed-message rows are inserted
// via enqueueMessageEmbed() and carry message_id + project_id + session_id
// so the embed-worker (sprint-015 Story 6) can route per-message work
// without re-querying the corpus on every claim.
//
// message_id / project_id / session_id are nullable: extract-conversation
// rows don't carry them, embed-message rows always do.
const INGEST_QUEUE_DDL = `
CREATE TABLE IF NOT EXISTS pending_ingest_tasks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'extract-conversation'
    CHECK (task_type IN ('extract-conversation', 'embed-message')),
  message_id INTEGER,
  project_id TEXT,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_ingest_tasks_status
  ON pending_ingest_tasks(status);
CREATE INDEX IF NOT EXISTS idx_pending_ingest_tasks_type_status
  ON pending_ingest_tasks(task_type, status);
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
  task_type: string;
  message_id: number | null;
  project_id: string | null;
  session_id: string | null;
  status: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export type IngestTaskType = 'extract-conversation' | 'embed-message';

export interface IngestTask {
  readonly id: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly taskType: IngestTaskType;
  readonly messageId: number | null;
  readonly projectId: string | null;
  readonly sessionId: string | null;
  readonly status: 'pending' | 'processing' | 'completed' | 'failed';
  readonly error: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

/**
 * Pluggable handler for `embed-message` tasks. Called by `processNext()`
 * after a task is claimed. The handler does the embed work (load message
 * + compute windows + assemble + upsert vec_windows / window_messages);
 * `processNext` owns the lifecycle (markCompleted on success,
 * resetToPending on retryable error, markFailed on terminal error).
 *
 * Sprint-015 Story 6 — `src/memory/indexer/embed-worker.ts` provides the
 * production handler; tests can inject stubs.
 */
export type EmbedTaskHandler = (task: IngestTask) => Promise<void>;

export interface IngestQueueConfig {
  readonly db: Database.Database;
  readonly orchestrator: Orchestrator | null;
  readonly conversationStore: ConversationStore;
  /**
   * Optional handler for `embed-message` tasks. When supplied,
   * `processNext()` dispatches embed-message claims to this handler
   * instead of the orchestrator path.
   */
  readonly embedTaskHandler?: EmbedTaskHandler;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set(['pending', 'processing', 'completed', 'failed']);

// task_type does not need a runtime fallback — the DDL CHECK constraint
// enforces the closed set, so any row that survives an INSERT is one of the
// declared types. Cast directly. status keeps a fallback because legacy DBs
// may have rows that predate the CHECK migration history.
const mapTaskRow = (row: IngestTaskRow): IngestTask => ({
  id: row.id,
  conversationId: row.conversation_id,
  userId: row.user_id,
  taskType: row.task_type as IngestTaskType,
  messageId: row.message_id,
  projectId: row.project_id,
  sessionId: row.session_id,
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
  private readonly orchestrator: Orchestrator | null;
  private readonly conversationStore: ConversationStore;
  private readonly embedTaskHandler: EmbedTaskHandler | null;
  // Cached at construction so a 100-turn indexer batch reuses one
  // prepared statement instead of compiling the SQL 100 times.
  private readonly insertEmbedTaskStmt: Database.Statement;

  public constructor(config: IngestQueueConfig) {
    this.db = config.db;
    this.orchestrator = config.orchestrator;
    this.conversationStore = config.conversationStore;
    this.embedTaskHandler = config.embedTaskHandler ?? null;
    initIngestQueueTables(config.db);
    this.insertEmbedTaskStmt = this.db.prepare(
      `INSERT INTO pending_ingest_tasks
         (id, conversation_id, user_id, task_type, message_id, project_id, session_id)
       VALUES (?, ?, ?, 'embed-message', ?, ?, ?)`,
    );
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
   * Enqueue a per-message embed task. Used by the spec-005 Phase-3 indexer
   * (sprint-015 Story 2) after `addMessage` writes a row, so the embed-worker
   * can claim and process the message asynchronously. Caller passes the
   * INTEGER message id from `messages.id`; the worker uses it to look up the
   * message + its containing windows.
   *
   * Unlike `enqueue()`, this does NOT touch `conversations` or `messages` —
   * the indexer owns the corpus write; this method only inserts the task row.
   * Call inside the indexer's outer transaction so the corpus write + task
   * enqueue are atomic.
   *
   * Returns the task id.
   */
  public enqueueMessageEmbed(params: {
    readonly messageId: number;
    readonly conversationId: string;
    readonly userId: string;
    readonly projectId: string;
    readonly sessionId?: string;
  }): string {
    const taskId = randomUUID();
    this.insertEmbedTaskStmt.run(
      taskId,
      params.conversationId,
      params.userId,
      params.messageId,
      params.projectId,
      params.sessionId ?? null,
    );
    return taskId;
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
   * Claim and process the next pending task. Dispatches on `task_type`:
   *
   *   - **embed-message** (sprint-015 Story 6): delegates to the
   *     `embedTaskHandler` configured at construction. The handler does
   *     the indexer work (load message + compute windows + assemble +
   *     upsert vec_windows / window_messages); this method owns the
   *     lifecycle. If no handler is configured, the task is marked
   *     failed with a clear error so it doesn't sit pending forever.
   *
   *   - **extract-conversation** (legacy spec-003): delegates to the
   *     `orchestrator.ingest(...)` pipeline. spec-005 Phase 1 removed the
   *     orchestrator from runtime; with `orchestrator: null` this path
   *     throws `IngestQueueError`. The path stays for the (currently
   *     dead-letter) backward-compat tests that pin the contract — and
   *     for any future re-introduction of orchestrator-style processing.
   *
   * On retryable errors (Ollama down), resets to pending for retry. On
   * terminal errors, marks as failed. Returns the claimed task, or null
   * if the queue is empty.
   */
  public async processNext(): Promise<IngestTask | null> {
    const task = this.claimNext();
    if (!task) return null;

    try {
      if (task.taskType === 'embed-message') {
        if (!this.embedTaskHandler) {
          throw new IngestQueueError(
            'IngestQueue.processNext: embed-message task claimed but no embedTaskHandler is configured. ' +
              'Pass `embedTaskHandler` in IngestQueueConfig — typically via scripts/embed-worker.ts.',
          );
        }
        await this.embedTaskHandler(task);
        this.markCompleted(task.id);
      } else {
        // Legacy spec-003 extract path. Orchestrator is null in spec-005
        // Phase-1; this branch throws IngestQueueError until/unless an
        // orchestrator-style processor is reintroduced.
        const orchestrator = this.orchestrator;
        if (!orchestrator) {
          throw new IngestQueueError(
            'processNext() is unavailable: the LOCOMO-aimed orchestrator pipeline was removed in spec-005 Phase 1. ' +
              'Conversations can still be enqueued via enqueue(); processing will be reintroduced once the Phase-2 indexer primitive lands.',
          );
        }

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

        await orchestrator.ingest(messages, task.userId, {
          sourceConversationId: task.conversationId,
        });

        this.markCompleted(task.id);
      }
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
