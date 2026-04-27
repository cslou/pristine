import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { IngestQueueError } from '../core/errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_SECONDS = 30;

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

// `task_type` is now a singleton: spec-005 Phase 3 (sprint-015) introduced
// per-message embed tasks; sprint-016 Story 1 deleted the legacy
// extract-conversation surface (orchestrator pipeline removed in spec-005
// Phase 1). The CHECK constraint is preserved as a closed-set enum so
// future task types can be added explicitly. message_id / project_id /
// session_id are NOT NULL on the embed-message shape — kept nullable in
// DDL only for backward-compatibility with on-disk rows from earlier
// sprints; new inserts always populate them.
const INGEST_QUEUE_DDL = `
CREATE TABLE IF NOT EXISTS pending_ingest_tasks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'embed-message'
    CHECK (task_type IN ('embed-message')),
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

export type IngestTaskType = 'embed-message';

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
  /**
   * Handler for `embed-message` tasks invoked by `processNext()` after a
   * task is claimed. Optional at config time so tests can construct a
   * queue purely to enqueue rows without wiring the embed pipeline; calling
   * `processNext()` without one configured marks the claimed task failed
   * with a clear error.
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
  private readonly embedTaskHandler: EmbedTaskHandler | null;
  // Cached at construction so a 100-turn indexer batch reuses one
  // prepared statement instead of compiling the SQL 100 times.
  private readonly insertEmbedTaskStmt: Database.Statement;

  public constructor(config: IngestQueueConfig) {
    this.db = config.db;
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
   * Claim and process the next pending `embed-message` task by delegating
   * to the `embedTaskHandler` configured at construction. The handler
   * does the indexer work (load message + compute windows + assemble +
   * upsert vec_windows / window_messages); this method owns the
   * lifecycle (markCompleted on success, resetToPending on retryable
   * error, markFailed on terminal error). If no handler is configured,
   * the task is marked failed with a clear error so it doesn't sit
   * pending forever. Returns the claimed task, or null if the queue is
   * empty.
   */
  public async processNext(): Promise<IngestTask | null> {
    const task = this.claimNext();
    if (!task) return null;

    try {
      if (!this.embedTaskHandler) {
        throw new IngestQueueError(
          'IngestQueue.processNext: embed-message task claimed but no embedTaskHandler is configured. ' +
            'Pass `embedTaskHandler` in IngestQueueConfig — typically via scripts/embed-worker.ts.',
        );
      }
      await this.embedTaskHandler(task);
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
