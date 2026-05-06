import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { load as loadSqliteVec } from 'sqlite-vec';
import type { PiJsonlParsedMessage, PiJsonlSourcePointer } from './pi-jsonl-parser.js';
import type { PiJsonlEmbedder } from '../../shared/src/local-embedder.js';

export interface PiJsonlChunkRecord {
  readonly chunkId: string;
  readonly snippet: string;
  readonly pointer: PiJsonlSourcePointer;
  readonly metadataJson: string;
}

export interface PiJsonlIndexResult {
  readonly indexed: number;
  readonly skippedDuplicate: number;
  readonly chunks: readonly PiJsonlChunkRecord[];
}

export interface PiJsonlSourceIndexer {
  indexMessages(messages: readonly PiJsonlParsedMessage[]): Promise<PiJsonlIndexResult>;
  reconcileActiveEntries?(sourceUri: string, activeEntryIds: ReadonlySet<string>): void;
  close?(): void;
}

const validateEmbeddingDim = (dim: number): number => {
  if (!Number.isInteger(dim) || dim <= 0 || dim > 8192) {
    throw new Error(
      `Pi JSONL indexer: embedding dimension must be an integer in [1, 8192], got ${dim}`,
    );
  }
  return dim;
};

const buildVecDdl = (dim: number): string => {
  const safeDim = validateEmbeddingDim(dim);
  return `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_pi_jsonl_chunks USING vec0(
  chunk_id TEXT PRIMARY KEY,
  embedding float[${safeDim}]
);
`;
};

const chunkIdFor = (pointer: PiJsonlSourcePointer): string =>
  createHash('sha256').update(`${pointer.sourceUri}\0${pointer.entryId}`).digest('hex');

const toEmbeddingBuffer = (vector: readonly number[]): Buffer => {
  validateEmbeddingDim(vector.length);
  const embedding = Float32Array.from(vector);
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
};

interface PendingChunk {
  readonly record: PiJsonlChunkRecord;
  readonly embedding: Buffer;
}

export class SqlitePiJsonlSourceIndexer implements PiJsonlSourceIndexer {
  private readonly db: Database.Database;
  private readonly embedder: PiJsonlEmbedder;
  private readonly ownsDb: boolean;
  private vectorDim: number | null = null;

  public constructor(params: {
    readonly db: Database.Database;
    readonly embedder: PiJsonlEmbedder;
    readonly ownsDb?: boolean;
  }) {
    this.db = params.db;
    this.embedder = params.embedder;
    this.ownsDb = params.ownsDb ?? false;
    this.initMetadataTables();
  }

  public async indexMessages(messages: readonly PiJsonlParsedMessage[]): Promise<PiJsonlIndexResult> {
    if (messages.length === 0) return { indexed: 0, skippedDuplicate: 0, chunks: [] };

    const firstSeen = new Set<string>();
    const candidates: PiJsonlParsedMessage[] = [];
    let duplicateInBatch = 0;
    for (const message of messages) {
      const sourceKey = `${message.pointer.sourceUri}\0${message.pointer.entryId}`;
      if (firstSeen.has(sourceKey)) {
        duplicateInBatch++;
        continue;
      }
      firstSeen.add(sourceKey);
      candidates.push(message);
    }

    const vectors = await this.embedder.embedBatch(candidates.map((message) => message.text));
    if (vectors.length !== candidates.length) {
      throw new Error(
        `Pi JSONL indexer expected ${candidates.length} embeddings, got ${vectors.length}`,
      );
    }

    const pending: PendingChunk[] = [];
    for (let index = 0; index < candidates.length; index++) {
      const message = candidates[index];
      const vector = vectors[index];
      if (message === undefined || vector === undefined) continue;
      this.ensureVectorTable(vector.length);
      pending.push({
        record: {
          chunkId: chunkIdFor(message.pointer),
          snippet: message.text,
          pointer: message.pointer,
          metadataJson: JSON.stringify({ role: message.role, sourcePointer: message.pointer }),
        },
        embedding: toEmbeddingBuffer(vector),
      });
    }

    const written = this.writeChunks(pending);
    return {
      indexed: written.length,
      skippedDuplicate: duplicateInBatch + pending.length - written.length,
      chunks: written,
    };
  }

  public reconcileActiveEntries(sourceUri: string, activeEntryIds: ReadonlySet<string>): void {
    if (activeEntryIds.size === 0) return;
    const existing = this.db
      .prepare('SELECT chunk_id, entry_id FROM pi_jsonl_chunks WHERE source_uri = ?')
      .all(sourceUri) as { chunk_id: string; entry_id: string }[];
    const staleChunkIds = existing
      .filter((row) => !activeEntryIds.has(row.entry_id))
      .map((row) => row.chunk_id);
    if (staleChunkIds.length === 0) return;

    const deleteStale = this.db.transaction((chunkIds: readonly string[]) => {
      const deleteChunk = this.db.prepare('DELETE FROM pi_jsonl_chunks WHERE chunk_id = ?');
      const deleteVector = this.hasVectorTable()
        ? this.db.prepare('DELETE FROM vec_pi_jsonl_chunks WHERE chunk_id = ?')
        : null;
      for (const chunkId of chunkIds) {
        deleteVector?.run(chunkId);
        deleteChunk.run(chunkId);
      }
    });
    deleteStale(staleChunkIds);
  }

  public close(): void {
    if (this.ownsDb) this.db.close();
  }

  private initMetadataTables(): void {
    this.db.pragma('busy_timeout = 5000');
    loadSqliteVec(this.db);
    this.db.exec(`
CREATE TABLE IF NOT EXISTS pi_jsonl_chunks (
  chunk_id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (source_kind = 'pi-jsonl'),
  source_uri TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  parent_id TEXT,
  line_number INTEGER NOT NULL,
  timestamp TEXT,
  cwd TEXT,
  snippet TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_uri, entry_id)
);
CREATE INDEX IF NOT EXISTS ix_pi_jsonl_chunks_source_uri ON pi_jsonl_chunks(source_uri);
CREATE INDEX IF NOT EXISTS ix_pi_jsonl_chunks_timestamp ON pi_jsonl_chunks(timestamp);
`);
  }

  private ensureVectorTable(dim: number): void {
    const safeDim = validateEmbeddingDim(dim);
    if (this.vectorDim !== null) {
      if (this.vectorDim !== safeDim) {
        throw new Error(
          `Pi JSONL indexer: mixed embedding dimensions are unsupported (${this.vectorDim} then ${safeDim})`,
        );
      }
      return;
    }
    this.db.exec(buildVecDdl(safeDim));
    this.vectorDim = safeDim;
  }

  private hasVectorTable(): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'vec_pi_jsonl_chunks'",
      )
      .get() as { present: number } | undefined;
    return row !== undefined;
  }

  private writeChunks(items: readonly PendingChunk[]): readonly PiJsonlChunkRecord[] {
    if (items.length === 0) return [];
    const insertChunk = this.db.prepare(
      `INSERT OR IGNORE INTO pi_jsonl_chunks
         (chunk_id, source_kind, source_uri, entry_id, parent_id, line_number, timestamp, cwd, snippet, metadata_json)
       VALUES (?, 'pi-jsonl', ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const deleteVector = this.db.prepare('DELETE FROM vec_pi_jsonl_chunks WHERE chunk_id = ?');
    const insertVector = this.db.prepare(
      'INSERT INTO vec_pi_jsonl_chunks(chunk_id, embedding) VALUES (?, ?)',
    );
    const write = this.db.transaction((chunkItems: readonly PendingChunk[]) => {
      const written: PiJsonlChunkRecord[] = [];
      for (const item of chunkItems) {
        const result = insertChunk.run(
          item.record.chunkId,
          item.record.pointer.sourceUri,
          item.record.pointer.entryId,
          item.record.pointer.parentId ?? null,
          item.record.pointer.lineNumber,
          item.record.pointer.timestamp ?? null,
          item.record.pointer.cwd ?? null,
          item.record.snippet,
          item.record.metadataJson,
        );
        if (result.changes === 0) continue;
        deleteVector.run(item.record.chunkId);
        insertVector.run(item.record.chunkId, item.embedding);
        written.push(item.record);
      }
      return written;
    });
    return write(items) as PiJsonlChunkRecord[];
  }
}

const assertSecureDirectory = (dirPath: string): void => {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') return;
  const mode = statSync(dirPath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`Pi JSONL index directory ${dirPath} must be private (mode 700 or stricter)`);
  }
};

const chmodPrivateIfExists = (path: string): void => {
  if (process.platform === 'win32' || !existsSync(path)) return;
  chmodSync(path, 0o600);
};

const chmodDatabaseFiles = (dbPath: string): void => {
  chmodPrivateIfExists(dbPath);
  chmodPrivateIfExists(`${dbPath}-wal`);
  chmodPrivateIfExists(`${dbPath}-shm`);
  chmodPrivateIfExists(`${dbPath}-journal`);
};

export const openPiJsonlIndexDatabase = (dbPath: string): Database.Database => {
  assertSecureDirectory(dirname(dbPath));
  const db = new Database(dbPath);
  db.pragma('journal_mode = DELETE');
  chmodDatabaseFiles(dbPath);
  return db;
};

export const createSqlitePiJsonlSourceIndexer = (params: {
  readonly dbPath: string;
  readonly embedder: PiJsonlEmbedder;
}): SqlitePiJsonlSourceIndexer =>
  new SqlitePiJsonlSourceIndexer({
    db: openPiJsonlIndexDatabase(params.dbPath),
    embedder: params.embedder,
    ownsDb: true,
  });
