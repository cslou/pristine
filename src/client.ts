import { homedir } from 'node:os';
import type Database from 'better-sqlite3';
import type { RevealResult, SecureAndRedactResult, SourceChunkInput } from './core/types.js';
import type { Embedder, KeyManager, VaultStore } from './core/interfaces.js';
import { InvalidArgumentError } from './core/errors.js';
import { initPristine } from './core/init.js';
import { createDefaultDatabase } from './core/database.js';
import { createEmbedder } from './embedder/index.js';
import { SourceChunkStore } from './memory/source-index/index.js';
import { FileSystemKeyManager } from './privacy/keys/filesystem.js';
import { KekManager } from './privacy/kek/kek-manager.js';
import { createSqliteVaultStore } from './privacy/vault/sqlite/index.js';
import {
  reveal as privacyReveal,
  scrubOutput as privacyScrubOutput,
  secureAndRedact as privacySecureAndRedact,
} from './privacy/index.js';
import type { DeterministicClassifierConfig } from './privacy/classifier/deterministic/index.js';

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

export interface SearchSourceChunksOptions {
  readonly projectId: string;
  readonly limit?: number;
}

export interface SourceChunkSearchHit extends IndexedSourceChunk {
  readonly score: number;
}

export interface PristineLocalConfig {
  readonly baseDir?: string;
  readonly keysDir?: string;
  readonly db?: Database.Database;
  readonly embedder?: Embedder;
  readonly privacy?: DeterministicClassifierConfig;
}

const toPublicChunk = (chunk: {
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
  readonly metadataJson: string | null;
}): IndexedSourceChunk => ({
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
});

export class PristineLocal {
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

  public static async create(config: PristineLocalConfig = {}): Promise<PristineLocal> {
    const fullyInjected = config.db !== undefined && config.embedder !== undefined;
    const init = fullyInjected ? null : initPristine(config.baseDir);
    const ownsDb = config.db === undefined;
    const db =
      config.db ?? createDefaultDatabase(init?.baseDir ? `${init.baseDir}/data` : undefined);
    const ownsEmbedder = config.embedder === undefined;
    const embedder =
      config.embedder ?? createEmbedder(init?.config.embedder ?? { engine: 'local' });
    const sourceChunkStore = new SourceChunkStore(db, embedder.dim);
    const keysDir =
      config.keysDir ?? (init ? `${init.baseDir}/keys` : `${homedir()}/.pristine/keys`);
    const keyManager = new FileSystemKeyManager({ keysDir });
    const kekManager = new KekManager(db, keyManager);
    const vaultStore = createSqliteVaultStore(db);

    return new PristineLocal({
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

    const normalized = this.sourceChunkStore.validateMany(chunks, { projectId: options.projectId });
    const embeddings = await this.embedder.embedBatch(normalized.map((chunk) => chunk.text));
    if (embeddings.length !== normalized.length) {
      throw new InvalidArgumentError(
        `indexSourceChunks: embedder returned ${embeddings.length} embeddings for ${normalized.length} chunks`,
      );
    }
    return this.sourceChunkStore.putStoredMany(normalized, embeddings).map(toPublicChunk);
  }

  public async searchSourceChunks(
    query: string,
    options: SearchSourceChunksOptions,
  ): Promise<readonly SourceChunkSearchHit[]> {
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new InvalidArgumentError('searchSourceChunks: query must be a non-empty string');
    }
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new InvalidArgumentError('searchSourceChunks: options must be an object');
    }
    const embedding = await this.embedder.embed(query.trim());
    const limit = options.limit === undefined ? 10 : options.limit;
    return this.sourceChunkStore
      .search(embedding, { projectId: options.projectId, limit })
      .map((hit) => ({ ...toPublicChunk(hit.chunk), score: hit.score }));
  }

  public async secureAndRedact(text: string, userId: string): Promise<SecureAndRedactResult> {
    return privacySecureAndRedact(text, {
      vaultStore: this.vaultStore,
      keyManager: this.keyManager,
      kekManager: this.kekManager,
      userId,
      classifier: this.privacyClassifierConfig,
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

  public scrubOutput(text: string, allowlist: readonly string[] = []): string {
    return privacyScrubOutput(text, allowlist, this.privacyClassifierConfig);
  }

  public async dispose(): Promise<void> {
    this.kekManager.clearCache();
    const disposable = this.embedder as { dispose?: () => Promise<void> };
    if (this.ownsEmbedder && typeof disposable.dispose === 'function') {
      await disposable.dispose();
    }
    if (this.ownsDb) {
      this.db.close();
    }
    void this.keyManager;
  }
}
