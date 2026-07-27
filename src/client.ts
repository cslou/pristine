import type Database from 'better-sqlite3';
import type { SourceChunkInput } from './core/types.js';
import type { Embedder } from './core/interfaces.js';
import { InvalidArgumentError } from './core/errors.js';
import { initPristine } from './core/init.js';
import { createDefaultDatabase } from './core/database.js';
import { createEmbedder } from './embedder/index.js';
import { SourceChunkStore } from './memory/source-index/index.js';

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

export interface MemoryStatus {
  readonly projectId: string;
  readonly storedCount: number;
}

export interface RecalledMemory extends StoredMemory {
  readonly score: number;
}

export interface PristineConfig {
  readonly baseDir?: string;
  readonly db?: Database.Database;
  readonly embedder?: Embedder;
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
  private readonly ownsDb: boolean;
  private readonly ownsEmbedder: boolean;

  private constructor(deps: {
    sourceChunkStore: SourceChunkStore;
    db: Database.Database;
    embedder: Embedder;
    ownsDb: boolean;
    ownsEmbedder: boolean;
  }) {
    this.sourceChunkStore = deps.sourceChunkStore;
    this.db = deps.db;
    this.embedder = deps.embedder;
    this.ownsDb = deps.ownsDb;
    this.ownsEmbedder = deps.ownsEmbedder;
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
    return new Pristine({
      sourceChunkStore,
      db,
      embedder,
      ownsDb,
      ownsEmbedder,
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

  public status(projectId: string): MemoryStatus {
    return { projectId, storedCount: this.sourceChunkStore.count(projectId) };
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

  public async dispose(): Promise<void> {
    const disposable = this.embedder as { dispose?: () => Promise<void> };
    if (this.ownsEmbedder && typeof disposable.dispose === 'function') {
      await disposable.dispose();
    }
    if (this.ownsDb) {
      this.db.close();
    }
  }
}
