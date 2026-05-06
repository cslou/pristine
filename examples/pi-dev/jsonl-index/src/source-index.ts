import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type { PiJsonlParsedMessage, PiJsonlSourcePointer } from './pi-jsonl-parser.js';
import type { PiJsonlEmbedder } from './local-embedder.js';

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
}

interface ChunkRow {
  chunk_id: string;
  source_uri: string;
  entry_id: string;
  parent_id: string | null;
  line_number: number;
  timestamp: string | null;
  cwd: string | null;
  snippet: string;
  metadata_json: string;
}

const buildVecDdl = (dim: number): string => `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_pi_jsonl_chunks USING vec0(
  chunk_id TEXT PRIMARY KEY,
  embedding float[${dim}]
);
`;

const chunkIdFor = (pointer: PiJsonlSourcePointer): string =>
  createHash('sha256').update(`${pointer.sourceUri}\0${pointer.entryId}`).digest('hex');

const toEmbeddingBuffer = (vector: readonly number[], dim: number): Buffer => {
  if (vector.length !== dim) {
    throw new Error(`Pi JSONL indexer expected ${dim}-d embedding, got ${vector.length}`);
  }
  const embedding = Float32Array.from(vector);
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
};

const recordFromRow = (row: ChunkRow): PiJsonlChunkRecord => ({
  chunkId: row.chunk_id,
  snippet: row.snippet,
  metadataJson: row.metadata_json,
  pointer: {
    sourceKind: 'pi-jsonl',
    sourceUri: row.source_uri,
    entryId: row.entry_id,
    ...(row.parent_id !== null ? { parentId: row.parent_id } : {}),
    lineNumber: row.line_number,
    ...(row.timestamp !== null ? { timestamp: row.timestamp } : {}),
    ...(row.cwd !== null ? { cwd: row.cwd } : {}),
  },
});

export class SqlitePiJsonlSourceIndexer implements PiJsonlSourceIndexer {
  private readonly db: Database.Database;
  private readonly embedder: PiJsonlEmbedder;
  private readonly ownsDb: boolean;

  public constructor(params: {
    readonly db: Database.Database;
    readonly embedder: PiJsonlEmbedder;
    readonly ownsDb?: boolean;
  }) {
    this.db = params.db;
    this.embedder = params.embedder;
    this.ownsDb = params.ownsDb ?? false;
    this.init();
  }

  public async indexMessages(messages: readonly PiJsonlParsedMessage[]): Promise<PiJsonlIndexResult> {
    const chunks: PiJsonlChunkRecord[] = [];
    let indexed = 0;
    let skippedDuplicate = 0;

    for (const message of messages) {
      const existing = this.findBySourcePointer(message.pointer);
      if (existing !== null) {
        skippedDuplicate++;
        continue;
      }

      const chunkId = chunkIdFor(message.pointer);
      const metadataJson = JSON.stringify({
        role: message.role,
        sourcePointer: message.pointer,
      });
      const vector = await this.embedder.embed(message.text);
      const embedding = toEmbeddingBuffer(vector, this.embedder.dim);
      const record: PiJsonlChunkRecord = {
        chunkId,
        snippet: message.text,
        pointer: message.pointer,
        metadataJson,
      };

      this.writeChunk(record, embedding);
      chunks.push(record);
      indexed++;
    }

    return { indexed, skippedDuplicate, chunks };
  }

  public close(): void {
    if (this.ownsDb) this.db.close();
  }

  private init(): void {
    this.db.pragma('busy_timeout = 5000');
    sqliteVec.load(this.db);
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
    this.db.exec(buildVecDdl(this.embedder.dim));
  }

  private findBySourcePointer(pointer: PiJsonlSourcePointer): PiJsonlChunkRecord | null {
    const row = this.db
      .prepare(
        `SELECT chunk_id, source_uri, entry_id, parent_id, line_number, timestamp, cwd, snippet, metadata_json
         FROM pi_jsonl_chunks
         WHERE source_uri = ? AND entry_id = ?`,
      )
      .get(pointer.sourceUri, pointer.entryId) as ChunkRow | undefined;
    return row === undefined ? null : recordFromRow(row);
  }

  private writeChunk(record: PiJsonlChunkRecord, embedding: Buffer): void {
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO pi_jsonl_chunks
             (chunk_id, source_kind, source_uri, entry_id, parent_id, line_number, timestamp, cwd, snippet, metadata_json)
           VALUES (?, 'pi-jsonl', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.chunkId,
          record.pointer.sourceUri,
          record.pointer.entryId,
          record.pointer.parentId ?? null,
          record.pointer.lineNumber,
          record.pointer.timestamp ?? null,
          record.pointer.cwd ?? null,
          record.snippet,
          record.metadataJson,
        );
      this.db
        .prepare('INSERT INTO vec_pi_jsonl_chunks(chunk_id, embedding) VALUES (?, ?)')
        .run(record.chunkId, embedding);
    });
    write();
  }
}

export const openPiJsonlIndexDatabase = (dbPath: string): Database.Database => {
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  return new Database(dbPath);
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
