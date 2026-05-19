import { homedir } from 'node:os';
import type Database from 'better-sqlite3';
import type {
  DeleteSensitiveResult,
  ListSensitiveOptions,
  RevealResult,
  SensitiveRef,
  SensitiveSummary,
  SourceChunkInput,
  UpdateSensitiveInput,
} from './core/types.js';
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
  deleteSensitive as privacyDeleteSensitive,
  getSensitive as privacyGetSensitive,
  listSensitive as privacyListSensitive,
  resolveSensitive as privacyResolveSensitive,
  reveal as privacyReveal,
  scrubOutput as privacyScrubOutput,
  updateSensitive as privacyUpdateSensitive,
} from './privacy/index.js';
import type { DeterministicClassifierConfig } from './privacy/classifier/deterministic/index.js';

export interface StoreOptions {
  readonly projectId: string;
}

export interface StoredMemory {
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

export interface RecallOptions {
  readonly projectId: string;
  readonly limit?: number;
}

export interface ForgetOptions {
  readonly projectId: string;
}

export interface ForgetResult {
  readonly deletedCount: number;
}

export interface RecalledMemory extends StoredMemory {
  readonly score: number;
}

/** @deprecated Use StoreOptions. */
export type IndexSourceChunksOptions = StoreOptions;
/** @deprecated Use StoredMemory. */
export type IndexedSourceChunk = StoredMemory;
/** @deprecated Use RecallOptions. */
export type SearchSourceChunksOptions = RecallOptions;
/** @deprecated Use ForgetOptions. */
export type DeleteSourceChunksOptions = ForgetOptions;
/** @deprecated Use ForgetResult. */
export type DeleteSourceChunksResult = ForgetResult;
/** @deprecated Use RecalledMemory. */
export type SourceChunkSearchHit = RecalledMemory;

export interface PristineConfig {
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
}): StoredMemory => ({
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

export class Pristine {
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

  public static async create(config: PristineConfig = {}): Promise<Pristine> {
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

    return new Pristine({
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

  public async store(
    chunks: readonly SourceChunkInput[],
    options: StoreOptions,
  ): Promise<readonly StoredMemory[]> {
    if (!Array.isArray(chunks)) {
      throw new InvalidArgumentError('store: chunks must be an array');
    }
    if (chunks.length === 0) {
      throw new InvalidArgumentError('store: chunks must not be empty');
    }
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new InvalidArgumentError('store: options must be an object');
    }

    const normalized = this.sourceChunkStore.validateMany(chunks, { projectId: options.projectId });
    const embeddings = await this.embedder.embedBatch(normalized.map((chunk) => chunk.text));
    if (embeddings.length !== normalized.length) {
      throw new InvalidArgumentError(
        `store: embedder returned ${embeddings.length} embeddings for ${normalized.length} chunks`,
      );
    }
    return this.sourceChunkStore.putStoredMany(normalized, embeddings).map(toPublicChunk);
  }

  public forget(chunkIds: readonly string[], options: ForgetOptions): ForgetResult {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new InvalidArgumentError('forget: options must be an object');
    }
    const deletedCount = this.sourceChunkStore.deleteMany(options.projectId, chunkIds);
    return { deletedCount };
  }

  public async recall(query: string, options: RecallOptions): Promise<readonly RecalledMemory[]> {
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new InvalidArgumentError('recall: query must be a non-empty string');
    }
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new InvalidArgumentError('recall: options must be an object');
    }
    if (typeof options.projectId !== 'string' || options.projectId.trim().length === 0) {
      throw new InvalidArgumentError('recall: options.projectId must be a non-empty string');
    }
    const limit = options.limit === undefined ? 10 : options.limit;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
      throw new InvalidArgumentError('recall: options.limit must be a positive integer <= 1000');
    }

    const embedding = await this.embedder.embed(query.trim());
    return this.sourceChunkStore
      .search(embedding, { projectId: options.projectId, limit })
      .map((hit) => ({ ...toPublicChunk(hit.chunk), score: hit.score }));
  }

  /** @deprecated Use store(). */
  public async indexSourceChunks(
    chunks: readonly SourceChunkInput[],
    options: IndexSourceChunksOptions,
  ): Promise<readonly IndexedSourceChunk[]> {
    return this.store(chunks, options);
  }

  /** @deprecated Use forget(). */
  public deleteSourceChunks(
    chunkIds: readonly string[],
    options: DeleteSourceChunksOptions,
  ): DeleteSourceChunksResult {
    return this.forget(chunkIds, options);
  }

  /** @deprecated Use recall(). */
  public async searchSourceChunks(
    query: string,
    options: SearchSourceChunksOptions,
  ): Promise<readonly SourceChunkSearchHit[]> {
    return this.recall(query, options);
  }

  public async listSensitive(
    userId: string,
    options?: ListSensitiveOptions,
  ): Promise<readonly SensitiveSummary[]> {
    return privacyListSensitive(
      {
        vaultStore: this.vaultStore,
        userId,
      },
      options,
    );
  }

  public async getSensitive(
    userId: string,
    sensitiveRef: SensitiveRef,
  ): Promise<SensitiveSummary | null> {
    return privacyGetSensitive(sensitiveRef, {
      vaultStore: this.vaultStore,
      userId,
    });
  }

  public async updateSensitive(
    userId: string,
    sensitiveRef: SensitiveRef,
    input: UpdateSensitiveInput,
  ): Promise<SensitiveSummary> {
    return privacyUpdateSensitive(sensitiveRef, input, {
      vaultStore: this.vaultStore,
      userId,
    });
  }

  public async deleteSensitive(
    userId: string,
    sensitiveRefs: readonly SensitiveRef[],
  ): Promise<DeleteSensitiveResult> {
    return privacyDeleteSensitive(sensitiveRefs, {
      vaultStore: this.vaultStore,
      userId,
    });
  }

  public async resolveSensitive(userId: string, sensitiveRef: SensitiveRef): Promise<string> {
    return privacyResolveSensitive(sensitiveRef, {
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
