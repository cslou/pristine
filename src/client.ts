import { homedir } from 'node:os';
import type Database from 'better-sqlite3';
import type {
  ConversationDetail,
  Message,
  RevealResult,
  SecureAndRedactResult,
  SourceChunkInput,
} from './core/types.js';
import type { Embedder, KeyManager, VaultStore } from './core/interfaces.js';
import { IngestQueueError, InvalidArgumentError } from './core/errors.js';
import { initPristine } from './core/init.js';
import { createDefaultDatabase } from './core/database.js';
import { createEmbedder } from './embedder/index.js';
import { ConversationStore } from './conversations/store.js';
import { IngestQueue } from './queue/ingest-queue.js';
import { createIndexer, type Indexer } from './memory/indexer/index.js';
import { createEmbedTaskHandler, runEmbedWorker } from './memory/indexer/embed-worker.js';
import { createWindowWriter } from './memory/indexer/windows.js';
import { createSearcher, type Searcher } from './memory/searcher/index.js';
import { SourceChunkStore } from './memory/source-index/index.js';
import { FileSystemKeyManager } from './privacy/keys/filesystem.js';
import { KekManager } from './privacy/kek/kek-manager.js';
import { createSqliteVaultStore } from './privacy/vault/sqlite/index.js';
import {
  secureAndRedact as privacySecureAndRedact,
  reveal as privacyReveal,
  scrubOutput as privacyScrubOutput,
} from './privacy/index.js';
import type { DeterministicClassifierConfig } from './privacy/classifier/deterministic/index.js';

const VALID_ROLES = new Set<string>(['system', 'user', 'assistant']);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface IndexSourceChunksOptions {
  readonly projectId: string;
}

export interface IndexedSourceChunk {
  readonly chunkId: string;
  readonly projectId: string;
  readonly text: string;
  readonly sourceKind: string | null;
  readonly sourceUri: string | null;
  readonly entryId: string | null;
  readonly parentId: string | null;
  readonly lineNumber: number | null;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
  readonly timestamp: string | null;
  readonly metadata: SourceChunkInput['metadata'] | null;
}

export interface PristineLocalConfig {
  readonly baseDir?: string;
  readonly keysDir?: string;
  readonly db?: Database.Database;
  readonly embedder?: Embedder;
  readonly privacy?: DeterministicClassifierConfig;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class PristineLocal {
  /**
   * Public retrieval primitive — the consumer-facing query surface. The
   * indexer pipeline plumbing that `storeAsync` drives internally stays
   * private.
   */
  public readonly searcher: Searcher;

  private readonly ingestQueue: IngestQueue;
  private readonly conversationStore: ConversationStore;
  private readonly indexer: Indexer;
  private readonly sourceChunkStore: SourceChunkStore;
  private readonly db: Database.Database;
  private readonly embedder: Embedder;
  private readonly keyManager: KeyManager;
  private readonly kekManager: KekManager;
  private readonly vaultStore: VaultStore;
  private readonly ownsDb: boolean;
  private readonly ownsEmbedder: boolean;
  private readonly privacyClassifierConfig: DeterministicClassifierConfig | undefined;

  private constructor(deps: {
    ingestQueue: IngestQueue;
    conversationStore: ConversationStore;
    indexer: Indexer;
    searcher: Searcher;
    sourceChunkStore: SourceChunkStore;
    db: Database.Database;
    embedder: Embedder;
    keyManager: KeyManager;
    kekManager: KekManager;
    vaultStore: VaultStore;
    ownsDb: boolean;
    ownsEmbedder: boolean;
    privacyClassifierConfig?: DeterministicClassifierConfig;
  }) {
    this.ingestQueue = deps.ingestQueue;
    this.conversationStore = deps.conversationStore;
    this.indexer = deps.indexer;
    this.searcher = deps.searcher;
    this.sourceChunkStore = deps.sourceChunkStore;
    this.db = deps.db;
    this.embedder = deps.embedder;
    this.keyManager = deps.keyManager;
    this.kekManager = deps.kekManager;
    this.vaultStore = deps.vaultStore;
    this.ownsDb = deps.ownsDb;
    this.ownsEmbedder = deps.ownsEmbedder;
    this.privacyClassifierConfig = deps.privacyClassifierConfig;
  }

  /**
   * Number of pending embed tasks queued by `storeAsync` and not yet drained.
   * Useful for dashboards or progress reporting; consumers who want to wait
   * for the queue to reach idle should call `drainEmbedQueue()`.
   */
  public get pendingEmbedTasks(): number {
    return this.ingestQueue.pending;
  }

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------

  public static async create(config: PristineLocalConfig = {}): Promise<PristineLocal> {
    const fullyInjected = config.db !== undefined && config.embedder !== undefined;

    const init = fullyInjected ? null : initPristine(config.baseDir);

    const ownsDb = config.db === undefined;
    const db =
      config.db ?? createDefaultDatabase(init?.baseDir ? `${init.baseDir}/data` : undefined);

    const ownsEmbedder = config.embedder === undefined;
    // Canonical SDK default-config site. The fallback `{ engine: 'local' }`
    // resolves through `createEmbedder` to `DEFAULT_EMBEDDING_DIM` (768).
    // 768 is chosen because gte-modernbert-base (the highest open-weight
    // CoIR scorer at this size) is fixed-768 and not MRL-trained, while
    // 1024-native MRL embedders truncate to 768 with ~1-3% NDCG loss
    // (within bootstrap CI noise) and run 33% cheaper per cosine on
    // consumer hardware. Cross-dim migration of an existing on-disk
    // corpus is unsupported — `vec0` virtual tables have no ALTER.
    // Do not introduce a second default elsewhere; consumers who need a
    // different dim pass it explicitly via `EmbedderConfig.dim`.
    const embedder =
      config.embedder ?? createEmbedder(init?.config.embedder ?? { engine: 'local' });

    const conversationStore = new ConversationStore(db, embedder.dim);

    // Indexer + embed-worker wiring. Mirrors scripts/embed-worker.ts:
    // build a temp queue solely to read the indexer's resolved config,
    // then construct the production queue with the embed-task handler
    // bound. The temp queue shares the same pending_ingest_tasks table;
    // nothing is written to it.
    const windowWriter = createWindowWriter(db);
    const tempQueue = new IngestQueue({ db });
    const indexer = createIndexer({
      db,
      conversationStore,
      ingestQueue: tempQueue,
      embedder,
    });
    const ingestQueue = new IngestQueue({
      db,
      embedTaskHandler: createEmbedTaskHandler({
        db,
        embedder,
        windowWriter,
        config: indexer.config,
      }),
    });

    const searcher = createSearcher({ db, embedder });
    const sourceChunkStore = new SourceChunkStore(db, embedder.dim);

    const keysDir =
      config.keysDir ?? (init ? `${init.baseDir}/keys` : `${homedir()}/.pristine/keys`);
    const keyManager = new FileSystemKeyManager({ keysDir });
    const kekManager = new KekManager(db, keyManager);
    const vaultStore = createSqliteVaultStore(db);

    return new PristineLocal({
      ingestQueue,
      conversationStore,
      indexer,
      searcher,
      sourceChunkStore,
      db,
      embedder,
      keyManager,
      kekManager,
      vaultStore,
      ownsDb,
      ownsEmbedder,
      privacyClassifierConfig: config.privacy,
    });
  }

  // -------------------------------------------------------------------------
  // Source index API
  // -------------------------------------------------------------------------

  /**
   * Synchronously index source-owned chunks with optional source pointers.
   *
   * This is the source-pointer primitive replacing raw conversation
   * ownership: callers provide text/snippets plus any source metadata their
   * harness exposes, and Pristine stores indexed text, metadata, and a vector
   * row in the same local transaction. The raw source remains in the harness;
   * returned `chunkId`s are handles for later pointer-oriented search/delete
   * flows.
   *
   * Duplicate behavior is stable by `(projectId, chunkId)`: re-indexing the
   * same chunk id within the same project replaces the prior text, metadata,
   * and vector. The same chunk id in a different project is isolated.
   */
  public async indexSourceChunks(
    chunks: readonly SourceChunkInput[],
    options: IndexSourceChunksOptions,
  ): Promise<readonly IndexedSourceChunk[]> {
    if (!Array.isArray(chunks)) {
      throw new InvalidArgumentError('indexSourceChunks: chunks must be an array');
    }
    if (chunks.length === 0) {
      throw new InvalidArgumentError('indexSourceChunks: chunks must not be empty');
    }

    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new InvalidArgumentError('indexSourceChunks: options must be an object');
    }

    // Cheap validation before embedding so bad caller input does not pay model cost.
    const normalized = this.sourceChunkStore.validateMany(chunks, { projectId: options.projectId });

    const texts = normalized.map((chunk) => chunk.text);
    const embeddings = await this.embedder.embedBatch(texts);
    if (embeddings.length !== chunks.length) {
      throw new InvalidArgumentError(
        `indexSourceChunks: embedder returned ${embeddings.length} embeddings for ${chunks.length} chunks`,
      );
    }

    const stored = this.sourceChunkStore.putStoredMany(normalized, embeddings);
    return stored.map((chunk) => ({
      chunkId: chunk.chunkId,
      projectId: chunk.projectId,
      text: chunk.text,
      sourceKind: chunk.sourceKind,
      sourceUri: chunk.sourceUri,
      entryId: chunk.entryId,
      parentId: chunk.parentId,
      lineNumber: chunk.lineNumber,
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
      timestamp: chunk.timestamp,
      metadata:
        chunk.metadataJson === null
          ? null
          : (JSON.parse(chunk.metadataJson) as SourceChunkInput['metadata']),
    }));
  }

  // -------------------------------------------------------------------------
  // Ingest API
  // -------------------------------------------------------------------------

  /**
   * Fire-and-forget: store a conversation and enqueue per-message embed
   * tasks the embed-worker drains asynchronously. Returns the conversation
   * id (NOT a task id — the conversation handle is the load-bearing
   * identifier for downstream search).
   *
   * On duplicate (same userId + same content hash), returns the existing
   * conversation id without re-enqueueing — the prior call's tasks remain
   * the source of truth.
   */
  public storeAsync(conversation: readonly Message[], userId: string, projectId?: string): string {
    // Normalize projectId once so the conversation row and the embed
    // tasks land with the same project_id. Empty string is treated as
    // "unset" to mirror addEmptyConversation's resolution logic (see
    // src/conversations/store.ts:613); without this, passing
    // projectId: '' would write the conversation row but make
    // indexer.ingest throw on opts.projectId === '' — leaving an
    // orphaned conversation row. Empty userId falls back to 'default'
    // to match the pre-existing addConversation/addEmptyConversation
    // contract (single-device local-first SDK; cross-user commingling
    // is not a threat model concern here — see CLAUDE.md project
    // intro). A project-wide refactor to reject empty userIds belongs
    // in a separate hardening sprint.
    const resolvedProjectId =
      projectId !== undefined && projectId !== '' ? projectId : userId !== '' ? userId : 'default';

    // Atomic envelope: when both addEmptyConversation AND indexer.ingest
    // run, they commit or roll back together. The duplicate-recovery
    // early-return path (UNIQUE collision → findByMessages → return
    // existing.id) writes nothing inside the transaction; the commit
    // is a no-op against the existing already-committed conversation
    // row. better-sqlite3 nests inner db.transaction() calls
    // (indexer.ingest has its own) as SAVEPOINTs, so the outer
    // transaction is sufficient. Without this envelope, a crash between
    // the two steps would leave a content_hash-locked conversation row
    // with message_count=0 and no embed tasks — permanently
    // unrecoverable because the duplicate guard returns the orphan id
    // on retry.
    const runStore = this.db.transaction((): string => {
      let id: string;
      try {
        id = this.conversationStore.addEmptyConversation(userId, conversation, resolvedProjectId);
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
          const existing = this.conversationStore.findByMessages(userId, conversation);
          if (existing === null) {
            // The conversation matched on UNIQUE(user_id, content_hash)
            // but findByMessages returned null — most likely cause is a
            // concurrent delete that ran between the failed INSERT and
            // the SELECT. Less likely: content-hash drift (a bug in
            // computeConversationContentHash, which is deterministic).
            // Either way, retry will re-ingest cleanly.
            throw new IngestQueueError(
              'Duplicate detected but conversation no longer exists — concurrent delete? Retry to re-ingest',
            );
          }
          return existing.id;
        }
        throw error;
      }
      this.indexer.ingest(conversation, { projectId: resolvedProjectId, conversationId: id });
      return id;
    });

    return runStore();
  }

  /**
   * Drain the embed queue to completion: process every pending
   * embed-message task `storeAsync` enqueued, then resolve. Returns the
   * number of tasks processed (success + failure both count, matching
   * `runEmbedWorker`'s return shape).
   *
   * Composes the ingestion pipeline synchronously inside the calling
   * process — the same pipeline `scripts/embed-worker.ts` runs as a
   * detached daemon.
   *
   * **When to call.** After `storeAsync` if the consumer wants
   * synchronous completion before retrieval — e.g., a CLI that calls
   * `searcher.hybridSearch(...)` immediately after store and needs the
   * `vec_windows` / `messages_fts` rows populated:
   *
   * ```ts
   * const conversationId = client.storeAsync(messages, userId, projectId);
   * const drained = await client.drainEmbedQueue();
   * console.log(`indexed ${drained} messages`);
   * const hits = await client.searcher.hybridSearch(query, { projectId }, 10);
   * ```
   *
   * Not needed if the consumer runs `scripts/embed-worker.ts` as a
   * daemon — the daemon loops the same `runEmbedWorker` continuously,
   * so `vec_windows` populates eventually without a synchronous drain.
   * One canonical SDK surface, not two: `runEmbedWorker` is NOT
   * additionally re-exported from the package barrel; this method is
   * the only consumer-facing entry point. Future evolution (streaming
   * progress, abort signal, per-batch limits) extends on this method
   * rather than the free function.
   *
   * **Idempotent.** Safe to call repeatedly: when the queue is empty
   * the call resolves to 0 without side effects.
   *
   * **Blocking.** Resolves only when the queue reaches idle. There is
   * no streaming / per-batch progress reporting in this iteration; a
   * future sprint may add `drainEmbedQueue({ onProgress })` once a
   * real consumer demands it.
   *
   * @returns Number of tasks processed (success + failure both count).
   */
  public async drainEmbedQueue(): Promise<number> {
    return runEmbedWorker(this.ingestQueue);
  }

  /**
   * Build the session-level vector for a conversation: read every message
   * row, format + concatenate them, embed the joined text, and upsert
   * one row into `vec_sessions` keyed by `conversationId`. Populates the
   * session leg of `searcher.hybridSearch` — without this call, the
   * session leg returns no hits regardless of how the corpus is queried.
   *
   * `storeAsync` writes message + window vectors via the embed-worker
   * pipeline; building `vec_sessions` is a separate explicit call —
   * auto-invocation was deferred until retrieval pressure justifies
   * the cost.
   *
   * **When to call.** After a session-close signal — typically when a
   * conversation finishes appending turns. `storeAsync` does NOT
   * auto-build session vectors. Pair with a prior `drainEmbedQueue()`
   * if the consumer also wants the per-message embeddings flushed
   * before the session vector is computed:
   *
   * ```ts
   * const conversationId = client.storeAsync(messages, userId, projectId);
   * await client.drainEmbedQueue();          // flush per-message embeds
   * await client.buildSessionVector(conversationId); // populate vec_sessions
   * const hits = await client.searcher.hybridSearch(query, { projectId }, 10);
   * // hybridSearch's session leg now returns kind:'session' hits.
   * ```
   *
   * **Error contract.** Throws `InvalidArgumentError` for: empty
   * conversationId, missing conversationId (no row in `conversations`),
   * and any token-budget violation the underlying primitive raises.
   * The public surface narrows the indexer's broader error set
   * (`ConversationNotFoundError`, `InvalidArgumentError`) to a single
   * class so callers have one type to catch; the original error
   * message is preserved.
   *
   * **No-op for empty conversations.** If the conversation has no
   * message rows, the call resolves cleanly without writing a row to
   * `vec_sessions` — the hybrid retriever treats a missing
   * `vec_sessions` row as "no session-level signal yet."
   *
   * **Sequence after `drainEmbedQueue`, do not race it.** Call this
   * method only after the prior `drainEmbedQueue()` promise has
   * resolved. Running the two concurrently — e.g.,
   * `await Promise.all([client.drainEmbedQueue(),
   * client.buildSessionVector(id)])` — risks computing the session
   * vector from a partially-populated `messages` table while the
   * embed-worker is still writing rows. The result is a silently-stale
   * `vec_sessions` row with no error raised. Sequential `await` is the
   * intended pattern.
   *
   * @param conversationId The conversation id returned by `storeAsync`.
   * @throws `InvalidArgumentError` for empty/missing conversationId or
   *   token-budget violations.
   */
  public async buildSessionVector(conversationId: string): Promise<void> {
    if (conversationId === '') {
      throw new InvalidArgumentError('buildSessionVector: conversationId is required (empty)');
    }
    try {
      await this.indexer.buildSessionVector(conversationId);
    } catch (error: unknown) {
      // Narrow the public-surface error contract to a single class so
      // callers have one type to catch (InvalidArgumentError). The
      // underlying primitive may raise ConversationNotFoundError
      // (missing id) or InvalidArgumentError (empty id, token-budget
      // violation); both surface here as InvalidArgumentError with
      // the original message preserved.
      const message = error instanceof Error ? error.message : String(error);
      throw new InvalidArgumentError(message);
    }
  }

  // -------------------------------------------------------------------------
  // Conversation API
  // -------------------------------------------------------------------------

  public getConversation(conversationId: string): ConversationDetail | null {
    const stored = this.conversationStore.getConversation(conversationId);
    if (!stored) return null;
    return {
      id: stored.id,
      userId: stored.userId,
      createdAt: stored.createdAt,
      messages: stored.messages.map((m) => ({
        role: VALID_ROLES.has(m.role) ? (m.role as Message['role']) : 'user',
        content: m.content,
        ...(m.timestamp ? { timestamp: m.timestamp } : {}),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Privacy API
  // -------------------------------------------------------------------------

  public async secureAndRedact(
    text: string,
    userId: string,
    classifier?: DeterministicClassifierConfig,
  ): Promise<SecureAndRedactResult> {
    return privacySecureAndRedact(text, {
      vaultStore: this.vaultStore,
      keyManager: this.keyManager,
      kekManager: this.kekManager,
      userId,
      classifier: classifier ?? this.privacyClassifierConfig,
    });
  }

  public async reveal(redactedText: string, userId: string): Promise<RevealResult> {
    return privacyReveal(redactedText, {
      vaultStore: this.vaultStore,
      keyManager: this.keyManager,
      kekManager: this.kekManager,
      userId,
    });
  }

  public scrubOutput(text: string, revealedValues: readonly string[]): string {
    return privacyScrubOutput(text, revealedValues, this.privacyClassifierConfig);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  public async dispose(): Promise<void> {
    if (this.ownsEmbedder && 'dispose' in this.embedder) {
      await (this.embedder as { dispose: () => Promise<void> }).dispose();
    }

    if (this.ownsDb) {
      this.db.close();
    }
  }
}
