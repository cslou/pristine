import { homedir } from 'node:os';
import type Database from 'better-sqlite3';
import type {
  ConversationDetail,
  ConversationSearchResult,
  IngestResult,
  Message,
  RetrieveResult,
  RevealResult,
  SearchOptions,
  SecureAndRedactResult,
} from './core/types.js';
import type { Embedder, KeyManager, Orchestrator, VaultStore } from './core/interfaces.js';
import { IngestQueueError } from './core/errors.js';
import { initPristine } from './core/init.js';
import { createDefaultDatabase } from './core/database.js';
import { createLlmClients, type LlmClients } from './engine/index.js';
import { createEmbedder } from './embedder/index.js';
import { SqliteStore } from './memory/store/sqlite/index.js';
import { ConversationStore } from './conversations/store.js';
import { createExtractor, type ExtractorConfig } from './memory/extractor/index.js';
import { createConsolidator } from './memory/consolidator/index.js';
import { createQueryAnalyzer } from './memory/query-analyzer/index.js';
import { createRetriever } from './memory/retriever/index.js';
import { createOrchestrator } from './memory/orchestrator/index.js';
import { IngestQueue } from './queue/ingest-queue.js';
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
  /**
   * Overrides for the fact extractor. Pass `{ systemPrompt: '...' }` to
   * replace the default extraction prompt (useful for privacy-pipeline
   * users who need to re-include placeholder-preservation rules, or for
   * domain-specific category tuning). Pass `{ maxTokens: N }` to tune
   * extraction response budget.
   */
  readonly extractor?: ExtractorConfig;
}

export interface PristineLiteConfig {
  readonly db?: Database.Database;
  readonly baseDir?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class PristineLocal {
  public readonly orchestrator: Orchestrator;
  public readonly ingestQueue: IngestQueue;

  private readonly conversationStore: ConversationStore;
  private readonly memoryStore: SqliteStore | null;
  private readonly db: Database.Database;
  private readonly embedder: Embedder;
  private readonly llmClients: LlmClients;
  private readonly keyManager: KeyManager;
  private readonly kekManager: KekManager;
  private readonly vaultStore: VaultStore;
  private readonly ownsDb: boolean;
  private readonly ownsEmbedder: boolean;
  private readonly ownsLlmClients: boolean;
  private readonly isLite: boolean;

  private constructor(deps: {
    orchestrator: Orchestrator;
    ingestQueue: IngestQueue;
    conversationStore: ConversationStore;
    memoryStore: SqliteStore | null;
    db: Database.Database;
    embedder: Embedder;
    llmClients: LlmClients;
    keyManager: KeyManager;
    kekManager: KekManager;
    vaultStore: VaultStore;
    ownsDb: boolean;
    ownsEmbedder: boolean;
    ownsLlmClients: boolean;
    isLite: boolean;
  }) {
    this.orchestrator = deps.orchestrator;
    this.ingestQueue = deps.ingestQueue;
    this.conversationStore = deps.conversationStore;
    this.memoryStore = deps.memoryStore;
    this.db = deps.db;
    this.embedder = deps.embedder;
    this.llmClients = deps.llmClients;
    this.keyManager = deps.keyManager;
    this.kekManager = deps.kekManager;
    this.vaultStore = deps.vaultStore;
    this.ownsDb = deps.ownsDb;
    this.ownsEmbedder = deps.ownsEmbedder;
    this.ownsLlmClients = deps.ownsLlmClients;
    this.isLite = deps.isLite;
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

    const store = new SqliteStore(db);
    const conversationStore = new ConversationStore(db);
    const extractor = createExtractor(llmClients.memoryClient, config.extractor);
    const consolidator = createConsolidator(llmClients.memoryClient);
    const queryAnalyzer = createQueryAnalyzer(llmClients.memoryClient);
    const retriever = createRetriever({ store, embedder });

    const orchestrator = createOrchestrator({
      extractor,
      embedder,
      store,
      consolidator,
      conversationStore,
      retriever,
      queryAnalyzer,
    });

    const ingestQueue = new IngestQueue({ db, orchestrator, conversationStore });

    const keysDir =
      config.keysDir ?? (init ? `${init.baseDir}/keys` : `${homedir()}/.pristine/keys`);
    const keyManager = new FileSystemKeyManager({ keysDir });
    const kekManager = new KekManager(db, keyManager);
    const vaultStore = createSqliteVaultStore(db);

    return new PristineLocal({
      orchestrator,
      ingestQueue,
      conversationStore,
      memoryStore: store,
      db,
      embedder,
      llmClients,
      keyManager,
      kekManager,
      vaultStore,
      ownsDb,
      ownsEmbedder,
      ownsLlmClients,
      isLite: false,
    });
  }

  /**
   * Lightweight client with only DB, ConversationStore, and IngestQueue.
   * No Ollama connection, no embedder, no LLM clients.
   * Supports storeAsync(), searchConversations(), and getConversation().
   * Throws IngestQueueError on store() or search() (those need full client).
   */
  public static createLite(config: PristineLiteConfig = {}): PristineLocal {
    const ownsDb = config.db === undefined;
    const db =
      config.db ?? createDefaultDatabase(config.baseDir ? `${config.baseDir}/data` : undefined);

    const conversationStore = new ConversationStore(db);
    const ingestQueue = new IngestQueue({
      db,
      orchestrator: null as unknown as Orchestrator,
      conversationStore,
    });

    return new PristineLocal({
      orchestrator: null as unknown as Orchestrator,
      ingestQueue,
      conversationStore,
      memoryStore: null,
      db,
      embedder: null as unknown as Embedder,
      llmClients: null as unknown as LlmClients,
      keyManager: null as unknown as KeyManager,
      kekManager: null as unknown as KekManager,
      vaultStore: null as unknown as VaultStore,
      ownsDb,
      ownsEmbedder: false,
      ownsLlmClients: false,
      isLite: true,
    });
  }

  // -------------------------------------------------------------------------
  // Memory API
  // -------------------------------------------------------------------------

  public async store(conversation: readonly Message[], userId: string): Promise<IngestResult> {
    if (this.isLite) {
      throw new IngestQueueError(
        'store() requires a full client via PristineLocal.create(). ' +
          'Use storeAsync() for fire-and-forget enqueuing with lite clients.',
      );
    }
    return this.orchestrator.store(conversation, userId);
  }

  /**
   * Fire-and-forget: enqueue a conversation for background extraction.
   * Returns the task ID, or empty string if duplicate conversation.
   */
  public storeAsync(conversation: readonly Message[], userId: string): string {
    return this.ingestQueue.enqueue(conversation, userId);
  }

  public async search(
    query: string,
    userId: string,
    options?: SearchOptions,
  ): Promise<RetrieveResult> {
    if (this.isLite) {
      throw new IngestQueueError(
        'search() requires a full client via PristineLocal.create(). ' +
          'Lite clients support searchConversations() and getConversation().',
      );
    }
    return this.orchestrator.search(query, userId, options);
  }

  // -------------------------------------------------------------------------
  // Partial-ingest recovery API
  //
  // The ingest pipeline is not transactional: addConversation commits the
  // conversation row, then extract/embed/store run as separate steps. If an
  // intermediate step fails (Ollama timeout, OOM, SIGINT mid-extraction) the
  // conversation row persists but no memories are linked to it. A naive retry
  // then hits UNIQUE (user_id, content_hash) duplicate detection and skips
  // extraction silently. These methods let callers detect and clean up that
  // partial-ingest state before retrying.
  //
  // Tracked for architectural fix (transactional ingest): see follow-up
  // issue linked from Sprint 008c Story 7.
  // -------------------------------------------------------------------------

  /**
   * Find an existing conversation by (userId, messages) and report how many
   * active memories are linked to it. Returns null if the conversation has
   * not been ingested. Uses the same content-hash algorithm as `store` /
   * `storeAsync`, so lookups match exactly.
   *
   * - memoryCount === 0 → partial-ingest state; safe to delete and retry
   * - memoryCount > 0  → prior ingest completed; retries should be skipped
   */
  public async findConversationByMessages(
    userId: string,
    messages: readonly Message[],
  ): Promise<{ readonly id: string; readonly memoryCount: number } | null> {
    if (this.isLite || !this.memoryStore) {
      throw new IngestQueueError(
        'findConversationByMessages() requires a full client via PristineLocal.create().',
      );
    }
    const row = this.conversationStore.findByMessages(userId, messages);
    if (!row) return null;
    const memoryCount = await this.memoryStore.countForConversation(row.id);
    return { id: row.id, memoryCount };
  }

  /**
   * Delete a conversation row and its messages. Intended for partial-ingest
   * recovery (see findConversationByMessages). No-op on missing id.
   */
  public async deleteConversation(conversationId: string): Promise<void> {
    if (this.isLite) {
      throw new IngestQueueError(
        'deleteConversation() requires a full client via PristineLocal.create().',
      );
    }
    this.conversationStore.deleteById(conversationId);
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
