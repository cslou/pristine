import Database from 'better-sqlite3';
import { load as loadSqliteVec } from 'sqlite-vec';
import {
  PI_JSONL_CHUNKS_TABLE,
  PI_JSONL_VECTOR_TABLE,
} from '../../../../examples/pi-dev/shared/lib/pi-jsonl-index-schema.js';

export interface PiJsonlIndexSeedMessage {
  readonly text: string;
  readonly sourceUri: string;
  readonly entryId: string;
  readonly parentId?: string;
  readonly lineNumber: number;
  readonly timestamp?: string;
  readonly cwd?: string;
}

export interface PiJsonlIndexSeedEmbedder {
  embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

const toEmbeddingBuffer = (vector: readonly number[]): Buffer => {
  const embedding = Float32Array.from(vector);
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
};

export const seedPiJsonlIndexDb = async (params: {
  readonly dbPath: string;
  readonly messages: readonly PiJsonlIndexSeedMessage[];
  readonly embedder: PiJsonlIndexSeedEmbedder;
  readonly dimension: number;
}): Promise<void> => {
  const db = new Database(params.dbPath);
  try {
    loadSqliteVec(db);
    db.exec(`
CREATE TABLE IF NOT EXISTS ${PI_JSONL_CHUNKS_TABLE} (
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
CREATE VIRTUAL TABLE IF NOT EXISTS ${PI_JSONL_VECTOR_TABLE} USING vec0(
  chunk_id TEXT PRIMARY KEY,
  embedding float[${params.dimension}]
);
`);
    const vectors = await params.embedder.embedBatch(params.messages.map((entry) => entry.text));
    const insertChunk = db.prepare(
      `INSERT INTO ${PI_JSONL_CHUNKS_TABLE}
       (chunk_id, source_kind, source_uri, entry_id, parent_id, line_number, timestamp, cwd, snippet, metadata_json)
       VALUES (?, 'pi-jsonl', ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertVector = db.prepare(
      `INSERT INTO ${PI_JSONL_VECTOR_TABLE}(chunk_id, embedding) VALUES (?, ?)`,
    );
    const write = db.transaction(() => {
      params.messages.forEach((entry, index) => {
        const vector = vectors[index];
        if (vector === undefined) throw new Error(`Missing test embedding for message ${index}`);
        const chunkId = `chunk-${index}`;
        insertChunk.run(
          chunkId,
          entry.sourceUri,
          entry.entryId,
          entry.parentId ?? null,
          entry.lineNumber,
          entry.timestamp ?? null,
          entry.cwd ?? null,
          entry.text,
          JSON.stringify({ role: 'user' }),
        );
        insertVector.run(chunkId, toEmbeddingBuffer(vector));
      });
    });
    write();
  } finally {
    db.close();
  }
};
