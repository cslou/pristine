import type Database from 'better-sqlite3';
import type { ConversationStore } from '../../conversations/store.js';
import { ConversationNotFoundError, InvalidArgumentError } from '../../core/errors.js';
import type { Embedder } from '../../core/interfaces.js';
import type { IngestQueue } from '../../queue/ingest-queue.js';
import {
  splitOversizeMessage,
  type SplitOversizeOptions,
  type TokenCounter,
} from '../orchestrator/chunker.js';
import { buildSessionVector } from './session-vector.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Configuration for the sliding-window indexer. `windowSize` is the
 * number of consecutive messages combined into one embedded window;
 * `windowOverlap` is the number of messages shared between adjacent
 * windows. The stride between windows is `windowSize - windowOverlap`.
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
 * `mimeType` is an optional hint that routes oversize chunking through the
 * AST splitter (e.g., `text/x-typescript`) instead of the prose splitter.
 * The field is NOT stored on the messages row — it influences chunking
 * only.
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
  readonly mimeType?: string;
}

export interface IndexOptions {
  /** Project the turns belong to. Pass-through into the embed-task payload. */
  readonly projectId: string;
  /** Pre-existing conversation. Must already exist via `addConversation`. */
  readonly conversationId: string;
  /** Optional session id; pass-through for future summary-injection consumers. */
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
   * embed-worker consumes the queue asynchronously.
   *
   * Throws `InvalidArgumentError` for empty turns / empty opts strings.
   * Throws `ConversationNotFoundError` if `opts.conversationId` doesn't
   * resolve. The error is raised by an explicit pre-check SELECT inside the
   * transaction; `addMessage` would raise the same error secondarily if the
   * pre-check were removed, but surfacing it before any INSERT keeps the
   * rollback cheap.
   */
  ingest(turns: readonly IndexTurn[], opts: IndexOptions): IndexResult;
  /**
   * Embed an entire conversation as a single 768-d vector and write it
   * to `vec_sessions`. The session vector is the hybrid retriever's
   * coarse-grained signal alongside the fine-grained `vec_windows`.
   *
   * Called only on explicit consumer demand — NOT auto-invoked by
   * `ingest()`. Auto-build-on-ingest hooks can land later once retrieval
   * pressure is real and the cost/benefit is concrete.
   *
   * Throws `ConversationNotFoundError` if `conversationId` doesn't
   * resolve. No-op when the conversation has zero messages.
   */
  buildSessionVector(conversationId: string): Promise<void>;
  /** The resolved (defaults-applied) config. */
  readonly config: ResolvedIndexerConfig;
}

export interface IndexerDeps {
  readonly db: Database.Database;
  readonly conversationStore: ConversationStore;
  readonly ingestQueue: IngestQueue;
  /**
   * Embedder used by `buildSessionVector`. Optional — the indexer's
   * `ingest()` path doesn't embed (the worker does), so if the consumer
   * never calls `buildSessionVector()` they don't need to pass an
   * embedder. Calling `buildSessionVector()` without one throws
   * `InvalidArgumentError`.
   */
  readonly embedder?: Embedder;
  readonly config?: IndexerConfig;
  /**
   * Optional override for the oversize-chunker — token counter + threshold
   * + overlap. Defaults match Graphiti (3000 tokens, 200-token overlap,
   * ~4-chars/token heuristic).
   */
  readonly oversizeOptions?: SplitOversizeOptions;
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
  const oversizeOptions = deps.oversizeOptions;

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
      // The caller passes { projectId, conversationId, sessionId? } —
      // userId comes from the conversation row (single source of truth).
      // Pre-check before any INSERT so rollback is cheap.
      const userId = deps.conversationStore.getConversationUserId(opts.conversationId);
      if (userId === null) {
        throw new ConversationNotFoundError(`Conversation not found: ${opts.conversationId}`);
      }

      const messageIds: number[] = [];
      const taskIds: string[] = [];

      for (const turn of turns) {
        // Oversize chunker. Below-threshold turns return as a
        // single-element array (cheap no-op); above-threshold turns split
        // into N chunks. We write the parent FIRST, then each chunk with
        // parent_message_id set so the hybrid retriever can resolve a
        // window hit back to the original turn via ix_messages_parent.
        const chunks = splitOversizeMessage(
          {
            role: turn.role,
            content: turn.content,
            ...(turn.timestamp !== undefined ? { timestamp: turn.timestamp } : {}),
            ...(turn.mimeType !== undefined ? { mimeType: turn.mimeType } : {}),
          },
          oversizeOptions ?? {},
        );

        let parentMessageId: number | undefined;
        if (chunks.length > 1) {
          // Oversize path: write the original turn's full content as the
          // parent row. Only the chunks get embed-message tasks (the
          // parent's content is too big to embed as one window — that's
          // the whole reason we chunked).
          //
          // **Content asymmetry between parent and chunks.** The parent
          // stores `turn.content` — the ORIGINAL content as the caller
          // supplied it (including any Markdown code-fence delimiters).
          // The chunks store `chunk.content` from `splitOversizeMessage`
          // — for code-fenced content, that's the FENCE-STRIPPED form
          // (the AST splitter strips ```ts ... ``` before parsing). So
          // Retrieval consumers reading "the original turn" should
          // follow `parent_message_id` to the parent row; consumers
          // joining chunks see the stripped form. Documented so future
          // work picking the right field is unambiguous.
          parentMessageId = deps.conversationStore.addMessage(opts.conversationId, {
            role: turn.role,
            content: turn.content,
            ...(turn.timestamp !== undefined ? { timestamp: turn.timestamp } : {}),
          });
          messageIds.push(parentMessageId);
        }

        for (const chunk of chunks) {
          const messageId = deps.conversationStore.addMessage(opts.conversationId, {
            role: chunk.role,
            content: chunk.content,
            ...(chunk.timestamp !== undefined ? { timestamp: chunk.timestamp } : {}),
            ...(parentMessageId !== undefined ? { parentMessageId } : {}),
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
      }

      return { messageIds, taskIds };
    });

    return runTransaction();
  };

  const buildSessionVectorFacade = async (conversationId: string): Promise<void> => {
    if (deps.embedder === undefined) {
      throw new InvalidArgumentError(
        'Indexer.buildSessionVector: deps.embedder is required for session-vector builds',
      );
    }
    // Empty-conversationId guard lives in the helper (buildSessionVector)
    // so direct callers and facade callers see the same semantics.
    await buildSessionVector(deps.db, deps.embedder, conversationId);
  };

  return { ingest, buildSessionVector: buildSessionVectorFacade, config };
};

// Re-export TokenCounter for consumers that want to inject a real tokenizer.
export type { TokenCounter };
