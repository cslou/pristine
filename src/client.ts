import { homedir } from 'node:os';
import type Database from 'better-sqlite3';
import type {
  ConversationDetail,
  ConversationSearchResult,
  Message,
  RevealResult,
  SecureAndRedactResult,
} from './core/types.js';
import type { Embedder, KeyManager, VaultStore } from './core/interfaces.js';
import { IngestQueueError, InvalidArgumentError } from './core/errors.js';
import { initPristine } from './core/init.js';
import { createDefaultDatabase } from './core/database.js';
import { createLlmClients, type LlmClients } from './engine/index.js';
import { createEmbedder } from './embedder/index.js';
import { ConversationStore } from './conversations/store.js';
import { IngestQueue } from './queue/ingest-queue.js';
import { createIndexer, type Indexer } from './memory/indexer/index.js';
import { createEmbedTaskHandler, runEmbedWorker } from './memory/indexer/embed-worker.js';
import { createWindowWriter } from './memory/indexer/windows.js';
import { createSearcher, type Searcher } from './memory/searcher/index.js';
import { FileSystemKeyManager } from './privacy/keys/filesystem.js';
import { KekManager } from './privacy/kek/kek-manager.js';
import { createSqliteVaultStore } from './privacy/vault/sqlite/index.js';
import {
  secureAndRedact as privacySecureAndRedact,
  reveal as privacyReveal,
  scrubOutput as privacyScrubOutput,
} from './privacy/index.js';

const VALID_ROLES = new Set<string>(['system', 'user', 'assistant']);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PristineLocalConfig {
  readonly baseDir?: string;
  readonly keysDir?: string;
  readonly db?: Database.Database;
  readonly llmClients?: LlmClients;
  readonly embedder?: Embedder;
}

export interface PristineLiteConfig {
  readonly db?: Database.Database;
  readonly baseDir?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class PristineLocal {
  public readonly ingestQueue: IngestQueue;
  /**
   * Public retrieval primitive (sprint-016 Story 2 / spec-005 Phase 4).
   * Defined on full clients (`Pristine.create({...})`) and `null` on
   * lite clients — the vector path needs an embedder. Asymmetry vs
   * `indexer` (private) is deliberate: `searcher` is the consumer-facing
   * query surface, `indexer` is plumbing that `storeAsync` drives
   * internally.
   */
  public readonly searcher: Searcher | null;

  private readonly conversationStore: ConversationStore;
  private readonly indexer: Indexer | null;
  private readonly db: Database.Database;
  private readonly embedder: Embedder;
  private readonly llmClients: LlmClients;
  private readonly keyManager: KeyManager;
  private readonly kekManager: KekManager;
  private readonly vaultStore: VaultStore;
  private readonly ownsDb: boolean;
  private readonly ownsEmbedder: boolean;
  private readonly ownsLlmClients: boolean;

  private constructor(deps: {
    ingestQueue: IngestQueue;
    conversationStore: ConversationStore;
    indexer: Indexer | null;
    searcher: Searcher | null;
    db: Database.Database;
    embedder: Embedder;
    llmClients: LlmClients;
    keyManager: KeyManager;
    kekManager: KekManager;
    vaultStore: VaultStore;
    ownsDb: boolean;
    ownsEmbedder: boolean;
    ownsLlmClients: boolean;
  }) {
    this.ingestQueue = deps.ingestQueue;
    this.conversationStore = deps.conversationStore;
    this.indexer = deps.indexer;
    this.searcher = deps.searcher;
    this.db = deps.db;
    this.embedder = deps.embedder;
    this.llmClients = deps.llmClients;
    this.keyManager = deps.keyManager;
    this.kekManager = deps.kekManager;
    this.vaultStore = deps.vaultStore;
    this.ownsDb = deps.ownsDb;
    this.ownsEmbedder = deps.ownsEmbedder;
    this.ownsLlmClients = deps.ownsLlmClients;
  }

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------

  public static async create(config: PristineLocalConfig = {}): Promise<PristineLocal> {
    const fullyInjected =
      config.db !== undefined && config.llmClients !== undefined && config.embedder !== undefined;

    const init = fullyInjected ? null : initPristine(config.baseDir);

    const ownsDb = config.db === undefined;
    const db =
      config.db ?? createDefaultDatabase(init?.baseDir ? `${init.baseDir}/data` : undefined);

    const ownsLlmClients = config.llmClients === undefined;
    const llmClients = config.llmClients ?? createLlmClients(init?.baseDir);

    const ownsEmbedder = config.embedder === undefined;
    const embedder =
      config.embedder ?? createEmbedder(init?.config.embedder ?? { engine: 'local' });

    const conversationStore = new ConversationStore(db);

    // Indexer + embed-worker wiring (sprint-015 Phase 3 / sprint-016 Story 1).
    // Mirrors scripts/embed-worker.ts: build a temp queue solely to read the
    // indexer's resolved config, then construct the production queue with the
    // embed-task handler bound. The temp queue shares the same pending_ingest_tasks
    // table; nothing is written to it.
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
      db,
      embedder,
      llmClients,
      keyManager,
      kekManager,
      vaultStore,
      ownsDb,
      ownsEmbedder,
      ownsLlmClients,
    });
  }

  /**
   * Lightweight client with only DB, ConversationStore, and IngestQueue.
   * No embedder, no LLM clients, no indexer. Supports `searchConversations()`
   * and `getConversation()` for read-only flows.
   *
   * `storeAsync()` is NOT available on lite clients — the indexer pipeline
   * requires an embedder. Calling `createLite().storeAsync(...)` throws
   * `InvalidArgumentError`. For ingest, use `Pristine.create({...})` instead;
   * the embedder loads lazily so synchronous startup paths still pay only
   * the construction cost.
   */
  public static createLite(config: PristineLiteConfig = {}): PristineLocal {
    const ownsDb = config.db === undefined;
    const db =
      config.db ?? createDefaultDatabase(config.baseDir ? `${config.baseDir}/data` : undefined);

    const conversationStore = new ConversationStore(db);
    const ingestQueue = new IngestQueue({ db });

    return new PristineLocal({
      ingestQueue,
      conversationStore,
      indexer: null,
      searcher: null,
      db,
      embedder: null as unknown as Embedder,
      llmClients: null as unknown as LlmClients,
      keyManager: null as unknown as KeyManager,
      kekManager: null as unknown as KekManager,
      vaultStore: null as unknown as VaultStore,
      ownsDb,
      ownsEmbedder: false,
      ownsLlmClients: false,
    });
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
   *
   * Requires a fully-constructed `Pristine.create({...})`. `createLite()`
   * has no embedder, so the indexer pipeline can't run; calling
   * `createLite().storeAsync(...)` throws `InvalidArgumentError`.
   */
  public storeAsync(conversation: readonly Message[], userId: string, projectId?: string): string {
    const indexer = this.indexer;
    if (indexer === null) {
      throw new InvalidArgumentError(
        'storeAsync requires Pristine.create() — createLite has no embedder; for ingest, use Pristine.create() (the embedder loads lazily, so synchronous startup paths still pay only construction cost)',
      );
    }
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
      indexer.ingest(conversation, { projectId: resolvedProjectId, conversationId: id });
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
   * **When to call.** After `storeAsync` if the consumer wants
   * synchronous completion before retrieval — e.g., a CLI that calls
   * `searcher.hybridSearch(...)` immediately after store and needs the
   * vec_windows / messages_fts populated. Not needed if the consumer
   * runs `scripts/embed-worker.ts` as a daemon (which loops the same
   * `runEmbedWorker` continuously). One canonical surface, not two —
   * see Sprint-018 Story 2 Tech Notes for why `runEmbedWorker` is NOT
   * additionally re-exported from the package barrel.
   *
   * **Idempotent.** Safe to call repeatedly: when the queue is empty
   * the call resolves to 0 without side effects.
   *
   * **Blocking.** Resolves only when the queue reaches idle. There is
   * no streaming / per-batch progress reporting in this iteration; a
   * future sprint may add `drainEmbedQueue({ onProgress })` once a
   * real consumer demands it.
   *
   * **Lite clients.** `createLite()` has no embedder and so no
   * embed-task handler wired into its `IngestQueue`; calling
   * `drainEmbedQueue` would loop forever or fail when a task is
   * encountered. Throws `InvalidArgumentError` early instead.
   */
  public async drainEmbedQueue(): Promise<number> {
    if (this.indexer === null) {
      throw new InvalidArgumentError(
        'drainEmbedQueue requires Pristine.create() — createLite has no embedder; for ingest, use Pristine.create() (the embedder loads lazily, so synchronous startup paths still pay only construction cost)',
      );
    }
    return runEmbedWorker(this.ingestQueue);
  }

  // -------------------------------------------------------------------------
  // Conversation API
  // -------------------------------------------------------------------------

  public searchConversations(params: {
    userId: string;
    keyword?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }): ConversationSearchResult[] {
    return this.conversationStore.searchConversations(params);
  }

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

  public async secureAndRedact(text: string, userId: string): Promise<SecureAndRedactResult> {
    return privacySecureAndRedact(text, {
      client: this.llmClients.privacyClient,
      vaultStore: this.vaultStore,
      keyManager: this.keyManager,
      kekManager: this.kekManager,
      userId,
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
    return privacyScrubOutput(text, revealedValues);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  public async dispose(): Promise<void> {
    if (this.ownsEmbedder && 'dispose' in this.embedder) {
      await (this.embedder as { dispose: () => Promise<void> }).dispose();
    }

    if (this.ownsLlmClients) {
      const clients = new Set([this.llmClients.privacyClient, this.llmClients.memoryClient]);
      for (const client of clients) {
        if ('dispose' in client) {
          await (client as { dispose: () => Promise<void> }).dispose();
        }
      }
    }

    if (this.ownsDb) {
      this.db.close();
    }
  }
}
