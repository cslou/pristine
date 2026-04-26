import type Database from 'better-sqlite3';
import type { Embedder } from '../../core/interfaces.js';
import { IngestQueueError } from '../../core/errors.js';
import type { IngestQueue, IngestTask } from '../../queue/ingest-queue.js';
import type { ResolvedIndexerConfig } from './index.js';
import {
  assembleWindowEmbedding,
  computeWindowsForMessage,
  type WindowMessageRow,
  type WindowWriter,
} from './windows.js';

// ---------------------------------------------------------------------------
// embed-worker — sprint-015 Story 6 (spec-005 §16 Phase 3 P3-S5)
// ---------------------------------------------------------------------------

/**
 * Dependencies the embed-task handler closes over. The factory in this
 * module wires these into a callback compatible with `IngestQueueConfig.
 * embedTaskHandler` so `IngestQueue.processNext()` can dispatch
 * embed-message tasks without importing indexer internals.
 */
export interface EmbedWorkerDeps {
  readonly db: Database.Database;
  readonly embedder: Embedder;
  readonly windowWriter: WindowWriter;
  readonly config: ResolvedIndexerConfig;
}

/**
 * Process one embed-message task:
 *   1. Load the message (id, role, content, sort_order).
 *   2. Read total messageCount for the conversation.
 *   3. computeWindowsForMessage(sortOrder, count, config).
 *   4. For each affected window: load constituent messages →
 *      assembleWindowEmbedding → windowWriter.upsertWindow.
 *
 * Throws on missing message (terminal — message id from a stale task)
 * and on embedder/db failure (transient or terminal — caller decides).
 *
 * Does NOT call markCompleted / markFailed on the queue; lifecycle is
 * owned by `IngestQueue.processNext`. Throwing routes into
 * markFailed/resetToPending per the queue's retryable-error logic.
 */
export const processEmbedTask = async (deps: EmbedWorkerDeps, task: IngestTask): Promise<void> => {
  if (task.taskType !== 'embed-message') {
    throw new IngestQueueError(
      `processEmbedTask: expected task_type 'embed-message', got '${task.taskType}'`,
    );
  }
  if (task.messageId === null) {
    throw new IngestQueueError(
      `processEmbedTask: embed-message task ${task.id} has no message_id (corruption?)`,
    );
  }

  const messageRow = deps.db
    .prepare('SELECT id, role, content, sort_order FROM messages WHERE id = ?')
    .get(task.messageId) as
    | { id: number; role: string; content: string; sort_order: number }
    | undefined;
  if (!messageRow) {
    throw new IngestQueueError(
      `processEmbedTask: message ${task.messageId} not found (referenced by task ${task.id})`,
    );
  }

  const countRow = deps.db
    .prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?')
    .get(task.conversationId) as { c: number };
  const totalMessageCount = countRow.c;

  const windows = computeWindowsForMessage(messageRow.sort_order, totalMessageCount, deps.config);

  for (const window of windows) {
    const windowRows = deps.db
      .prepare(
        `SELECT id, role, content
         FROM messages
         WHERE conversation_id = ?
           AND sort_order >= ?
           AND sort_order <= ?
         ORDER BY sort_order ASC`,
      )
      .all(task.conversationId, window.startSortOrder, window.endSortOrder) as WindowMessageRow[];

    if (windowRows.length === 0) {
      // Defensive — shouldn't happen if computeWindowsForMessage agrees
      // with the corpus, but skip cleanly rather than hand the embedder
      // an empty input.
      continue;
    }

    const embedding = await assembleWindowEmbedding(windowRows, deps.embedder);
    deps.windowWriter.upsertWindow(
      task.conversationId,
      window.windowIndex,
      windowRows.map((r) => r.id),
      embedding,
    );
  }
};

/**
 * Build an `EmbedTaskHandler` ready to plug into `IngestQueueConfig.
 * embedTaskHandler`. Closes over the deps so `IngestQueue.processNext`
 * can call the handler with just the claimed task.
 */
export const createEmbedTaskHandler = (
  deps: EmbedWorkerDeps,
): ((task: IngestTask) => Promise<void>) => {
  return (task) => processEmbedTask(deps, task);
};

/**
 * Drain the queue: call `processNext` repeatedly until it returns null
 * (queue empty), then return. The worker self-terminates on idle —
 * no polling, no infinite loop. Callers that want long-running behavior
 * wrap this in their own scheduler.
 *
 * Returns the number of tasks processed (success + failure both count).
 */
export const runEmbedWorker = async (queue: IngestQueue): Promise<number> => {
  let processed = 0;
  let task = await queue.processNext();
  while (task !== null) {
    processed++;
    task = await queue.processNext();
  }
  return processed;
};
