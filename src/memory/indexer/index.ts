import type Database from 'better-sqlite3';
import type { ConversationStore } from '../../conversations/store.js';
import { ConversationNotFoundError, InvalidArgumentError } from '../../core/errors.js';
import type { IngestQueue } from '../../queue/ingest-queue.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Configuration for the sliding-window indexer (sprint-015 spec-005 §16
 * Phase 3). `windowSize` is the number of consecutive messages combined into
 * one embedded window; `windowOverlap` is the number of messages shared
 * between adjacent windows. The stride between windows is
 * `windowSize - windowOverlap`. Defaults match spec §16 Phase 3 P3-S1.
 */
export interface IndexerConfig {
  readonly windowSize?: number;
  readonly windowOverlap?: number;
}

/** Resolved config — defaults applied + invariants validated. */
export interface ResolvedIndexerConfig {
  readonly windowSize: number;
  readonly windowOverlap: number;
}

/**
 * One conversational turn the caller wants indexed. Mirrors the input shape
 * of `ConversationStore.addMessage`.
 *
 * Note on naming: this module deliberately uses `Index*` names rather than
 * `Ingest*` because `IngestOptions` and `IngestResult` are already taken in
 * `src/core/types.ts` for the (now-removed-from-runtime) orchestrator
 * pipeline. Avoiding the name collision keeps consumers from accidentally
 * importing the wrong shape.
 */
export interface IndexTurn {
  readonly role: string;
  readonly content: string;
  readonly timestamp?: string;
}

export interface IndexOptions {
  /** Project the turns belong to. Pass-through into the embed-task payload. */
  readonly projectId: string;
  /** Pre-existing conversation. Must already exist via `addConversation`. */
  readonly conversationId: string;
  /** Optional session id; pass-through for Phase-5 summary injection. */
  readonly sessionId?: string;
}

export interface IndexResult {
  /** messages.id values for the rows inserted, in insertion order. */
  readonly messageIds: readonly number[];
  /** pending_ingest_tasks.id values for the embed tasks enqueued. */
  readonly taskIds: readonly string[];
}

export interface Indexer {
  /**
   * Atomic primitive: insert all turns as message rows + enqueue one
   * embed-message task per inserted row, all in a single transaction.
   * Returns synchronously once the corpus + queue rows are committed; the
   * embed-worker (sprint-015 Story 6) consumes the queue asynchronously.
   *
   * Throws `InvalidArgumentError` for empty turns / empty opts strings.
   * Throws `ConversationNotFoundError` if `opts.conversationId` doesn't
   * resolve. The error is raised by an explicit pre-check SELECT inside the
   * transaction; `addMessage` would raise the same error secondarily if the
   * pre-check were removed, but surfacing it before any INSERT keeps the
   * rollback cheap.
   */
  ingest(turns: readonly IndexTurn[], opts: IndexOptions): IndexResult;
  /** The resolved (defaults-applied) config. Read by Stories 3 + 6. */
  readonly config: ResolvedIndexerConfig;
}

export interface IndexerDeps {
  readonly db: Database.Database;
  readonly conversationStore: ConversationStore;
  readonly ingestQueue: IngestQueue;
  readonly config?: IndexerConfig;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_SIZE = 3;
const DEFAULT_WINDOW_OVERLAP = 1;

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

const resolveConfig = (config?: IndexerConfig): ResolvedIndexerConfig => {
  const windowSize = config?.windowSize ?? DEFAULT_WINDOW_SIZE;
  const windowOverlap = config?.windowOverlap ?? DEFAULT_WINDOW_OVERLAP;

  if (!Number.isInteger(windowSize) || windowSize <= 0) {
    throw new InvalidArgumentError(
      `IndexerConfig.windowSize must be a positive integer, got ${String(windowSize)}`,
    );
  }
  if (!Number.isInteger(windowOverlap) || windowOverlap < 0) {
    throw new InvalidArgumentError(
      `IndexerConfig.windowOverlap must be a non-negative integer, got ${String(windowOverlap)}`,
    );
  }
  if (windowOverlap >= windowSize) {
    throw new InvalidArgumentError(
      `IndexerConfig.windowOverlap (${windowOverlap}) must be less than windowSize (${windowSize})`,
    );
  }

  return { windowSize, windowOverlap };
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createIndexer = (deps: IndexerDeps): Indexer => {
  const config = resolveConfig(deps.config);

  const ingest = (turns: readonly IndexTurn[], opts: IndexOptions): IndexResult => {
    if (turns.length === 0) {
      throw new InvalidArgumentError('Indexer.ingest: turns must be a non-empty array');
    }
    if (opts.projectId === '') {
      throw new InvalidArgumentError('Indexer.ingest: opts.projectId must be non-empty');
    }
    if (opts.conversationId === '') {
      throw new InvalidArgumentError('Indexer.ingest: opts.conversationId must be non-empty');
    }
    if (opts.sessionId !== undefined && opts.sessionId === '') {
      throw new InvalidArgumentError(
        'Indexer.ingest: opts.sessionId must be non-empty when provided',
      );
    }

    // Return the accumulated ids from inside the transaction so the
    // in-memory state stays consistent with committed DB state — a thrown
    // exception unwinds both. (Mutating outer arrays from inside the closure
    // would leave them partially populated on rollback; the caller can't
    // observe that today, but it's a fragile pattern under refactor.)
    const runTransaction = deps.db.transaction((): { messageIds: number[]; taskIds: string[] } => {
      // Story 2 AC has the caller pass { projectId, conversationId,
      // sessionId? } — userId comes from the conversation row (single
      // source of truth). Pre-check before any INSERT so rollback is cheap.
      const userId = deps.conversationStore.getConversationUserId(opts.conversationId);
      if (userId === null) {
        throw new ConversationNotFoundError(`Conversation not found: ${opts.conversationId}`);
      }

      const messageIds: number[] = [];
      const taskIds: string[] = [];

      for (const turn of turns) {
        const messageId = deps.conversationStore.addMessage(opts.conversationId, {
          role: turn.role,
          content: turn.content,
          ...(turn.timestamp !== undefined ? { timestamp: turn.timestamp } : {}),
        });
        messageIds.push(messageId);

        const taskId = deps.ingestQueue.enqueueMessageEmbed({
          messageId,
          conversationId: opts.conversationId,
          userId,
          projectId: opts.projectId,
          ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
        });
        taskIds.push(taskId);
      }

      return { messageIds, taskIds };
    });

    return runTransaction();
  };

  return { ingest, config };
};
