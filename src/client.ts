import type Database from 'better-sqlite3';
import type { IngestResult, Message, RetrieveResult } from './core/types.js';
import type { Embedder, KeyManager, Orchestrator, VaultStore } from './core/interfaces.js';
import { initPristine } from './core/init.js';
import { createDefaultDatabase } from './core/database.js';
import { createLlmClients, type LlmClients } from './engine/index.js';
import { createLocalEmbedder } from './embedder/local/index.js';
import { SqliteStore } from './memory/store/sqlite/index.js';
import { createExtractor } from './memory/extractor/index.js';
import { createConsolidator } from './memory/consolidator/index.js';
import { createQueryAnalyzer } from './memory/query-analyzer/index.js';
import { createRetriever } from './memory/retriever/index.js';
import { createOrchestrator } from './memory/orchestrator/index.js';
import { FileSystemKeyManager } from './privacy/keys/filesystem.js';
import { KekManager } from './privacy/kek/kek-manager.js';
import { createSqliteVaultStore } from './privacy/vault/sqlite/index.js';
import {
  secureAndRedact as privacySecureAndRedact,
  reveal as privacyReveal,
  scrubOutput as privacyScrubOutput,
  type SecureAndRedactResult,
} from './privacy/index.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PristineLocalConfig {
  readonly baseDir?: string;
  readonly db?: Database.Database;
  readonly llmClients?: LlmClients;
  readonly embedder?: Embedder;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class PristineLocal {
  public readonly orchestrator: Orchestrator;

  private readonly db: Database.Database;
  private readonly embedder: Embedder;
  private readonly llmClients: LlmClients;
  private readonly keyManager: KeyManager;
  private readonly kekManager: KekManager;
  private readonly vaultStore: VaultStore;
  private readonly ownsDb: boolean;
  private readonly ownsEmbedder: boolean;

  private constructor(deps: {
    orchestrator: Orchestrator;
    db: Database.Database;
    embedder: Embedder;
    llmClients: LlmClients;
    keyManager: KeyManager;
    kekManager: KekManager;
    vaultStore: VaultStore;
    ownsDb: boolean;
    ownsEmbedder: boolean;
  }) {
    this.orchestrator = deps.orchestrator;
    this.db = deps.db;
    this.embedder = deps.embedder;
    this.llmClients = deps.llmClients;
    this.keyManager = deps.keyManager;
    this.kekManager = deps.kekManager;
    this.vaultStore = deps.vaultStore;
    this.ownsDb = deps.ownsDb;
    this.ownsEmbedder = deps.ownsEmbedder;
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

    const llmClients = config.llmClients ?? createLlmClients(init?.baseDir);

    const ownsEmbedder = config.embedder === undefined;
    const embedder = config.embedder ?? createLocalEmbedder();

    const store = new SqliteStore(db);
    const extractor = createExtractor(llmClients.memoryClient);
    const consolidator = createConsolidator(llmClients.memoryClient);
    const queryAnalyzer = createQueryAnalyzer(llmClients.memoryClient);
    const retriever = createRetriever({ store, embedder });

    const orchestrator = createOrchestrator({
      extractor,
      embedder,
      store,
      consolidator,
      retriever,
      queryAnalyzer,
    });

    const keysDir = init ? `${init.baseDir}/keys` : '';
    const keyManager = new FileSystemKeyManager({ keysDir });
    const kekManager = new KekManager(db, keyManager);
    const vaultStore = createSqliteVaultStore(db);

    return new PristineLocal({
      orchestrator,
      db,
      embedder,
      llmClients,
      keyManager,
      kekManager,
      vaultStore,
      ownsDb,
      ownsEmbedder,
    });
  }

  // -------------------------------------------------------------------------
  // Memory API
  // -------------------------------------------------------------------------

  public async store(conversation: readonly Message[], userId: string): Promise<IngestResult> {
    return this.orchestrator.store(conversation, userId);
  }

  public async search(query: string, userId: string, topK?: number): Promise<RetrieveResult> {
    return this.orchestrator.search(query, userId, topK);
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

  public async reveal(redactedText: string, userId: string): Promise<string> {
    return privacyReveal(redactedText, {
      vaultStore: this.vaultStore,
      keyManager: this.keyManager,
      kekManager: this.kekManager,
      userId,
    });
  }

  public scrubOutput(text: string): string {
    return privacyScrubOutput(text);
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
