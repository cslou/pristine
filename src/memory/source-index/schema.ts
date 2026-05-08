import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { InvalidArgumentError } from '../../core/errors.js';
import { assertValidDim } from '../../core/vector-dim.js';
import type {
  SourceChunkInput,
  SourceChunkNormalizeOptions,
  SourceChunkStoreOptions,
  StoredSourceChunk,
} from './types.js';

/**
 * Source-index storage contract.
 *
 * Tables:
 * - `source_chunks`: stable chunk metadata keyed by `(project_id, chunk_id)`.
 *   Required fields are `project_id`, `chunk_id`, and indexed `text`; source
 *   pointer fields and `metadata_json` are nullable so text-only chunks remain
 *   valid.
 * - `vec_source_chunks`: sqlite-vec table keyed by an internal `chunk_key`
 *   derived from `(project_id, chunk_id)`, with `embedding float[N]` templated
 *   from the configured embedder dimension and `project_id`/`chunk_id`
 *   duplicated for filter-first vector search and result reconstruction.
 */
export const SOURCE_CHUNK_TEXT_LIMIT = 64 * 1024;
export const SOURCE_CHUNK_METADATA_JSON_LIMIT = 16 * 1024;

const SOURCE_CHUNKS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS source_chunks (
  project_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source_kind TEXT,
  source_uri TEXT,
  entry_id TEXT,
  parent_id TEXT,
  line_number INTEGER,
  line_start INTEGER,
  line_end INTEGER,
  timestamp TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS ix_source_chunks_project_updated
  ON source_chunks(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_source_chunks_source
  ON source_chunks(project_id, source_kind, source_uri);
`;

export const buildSourceChunkVectorDdl = (dim: number): string => {
  assertValidDim(dim);
  return `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_source_chunks USING vec0(
  chunk_key TEXT PRIMARY KEY,
  project_id TEXT,
  chunk_id TEXT,
  embedding float[${dim}]
);
`;
};

const readExistingTableSql = (db: Database.Database, tableName: string): string | null => {
  const row = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(tableName) as
    | { sql: string | null }
    | undefined;
  return row?.sql ?? null;
};

const dropIncompatibleSourceChunkTables = (db: Database.Database): void => {
  const sourceChunksSql = readExistingTableSql(db, 'source_chunks');
  const vecSourceChunksSql = readExistingTableSql(db, 'vec_source_chunks');
  const sourceChunksCompatible =
    sourceChunksSql === null || /PRIMARY KEY\s*\(project_id,\s*chunk_id\)/i.test(sourceChunksSql);
  const vecSourceChunksCompatible =
    vecSourceChunksSql === null || /\bchunk_key\s+TEXT\s+PRIMARY KEY\b/i.test(vecSourceChunksSql);

  if (!sourceChunksCompatible || !vecSourceChunksCompatible) {
    db.exec(`
      DROP TABLE IF EXISTS vec_source_chunks;
      DROP TABLE IF EXISTS source_chunks;
    `);
  }
};

export const initSourceChunkTables = (db: Database.Database, dim: number): void => {
  assertValidDim(dim);
  dropIncompatibleSourceChunkTables(db);
  db.exec(SOURCE_CHUNKS_TABLE_DDL);
  db.exec(buildSourceChunkVectorDdl(dim));
};

const assertOptionalString = (value: string | undefined, fieldName: string): string | null => {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    throw new InvalidArgumentError(`SourceChunkInput.${fieldName} must be a string`);
  }
  return value;
};

const assertOptionalInteger = (value: number | undefined, fieldName: string): number | null => {
  if (value === undefined) return null;
  if (!Number.isInteger(value)) {
    throw new InvalidArgumentError(`SourceChunkInput.${fieldName} must be an integer`);
  }
  return value;
};

const sourceChunkKey = (projectId: string, chunkId: string): string =>
  JSON.stringify([projectId, chunkId]);

const assertRecordInput = (value: unknown, name: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidArgumentError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
};

const validateProjectId = (projectId: string): string => {
  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    throw new InvalidArgumentError('SourceChunkStoreOptions.projectId must be a non-empty string');
  }
  return projectId;
};

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const assertJsonValue = (value: unknown, path: string, seen: WeakSet<object>): JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;

  if (
    path.length > 0 &&
    typeof value === 'object' &&
    value !== null &&
    'toJSON' in value &&
    typeof value.toJSON === 'function'
  ) {
    if (seen.has(value)) {
      throw new InvalidArgumentError(`SourceChunkInput.metadata.${path} must not be cyclic`);
    }
    seen.add(value);
    const serialized = assertJsonValue(value.toJSON(), path, seen);
    seen.delete(value);
    return serialized;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new InvalidArgumentError(`SourceChunkInput.metadata.${path} must be a finite number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new InvalidArgumentError(`SourceChunkInput.metadata.${path} must not be cyclic`);
    }
    seen.add(value);
    const out = value.map((item, index) => assertJsonValue(item, `${path}[${index}]`, seen));
    seen.delete(value);
    return out;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      throw new InvalidArgumentError(`SourceChunkInput.metadata.${path} must not be cyclic`);
    }
    seen.add(value);
    const out: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = assertJsonValue(child, path.length === 0 ? key : `${path}.${key}`, seen);
    }
    seen.delete(value);
    return out;
  }
  throw new InvalidArgumentError(
    `SourceChunkInput.metadata.${path} must be JSON-serializable, got ${typeof value}`,
  );
};

const validateMetadata = (metadata: SourceChunkInput['metadata']): string | null => {
  if (metadata === undefined) return null;
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new InvalidArgumentError('SourceChunkInput.metadata must be a JSON-serializable object');
  }

  const jsonValue = assertJsonValue(metadata, '', new WeakSet<object>());
  const encoded = JSON.stringify(jsonValue);
  if (Buffer.byteLength(encoded, 'utf8') > SOURCE_CHUNK_METADATA_JSON_LIMIT) {
    throw new InvalidArgumentError(
      `SourceChunkInput.metadata JSON must be <= ${SOURCE_CHUNK_METADATA_JSON_LIMIT} bytes`,
    );
  }
  return encoded;
};

const validateEmbedding = (embedding: readonly number[], dim: number): Buffer => {
  if (!Array.isArray(embedding)) {
    throw new InvalidArgumentError('SourceChunkStoreOptions.embedding must be an array');
  }
  if (embedding.length !== dim) {
    throw new InvalidArgumentError(
      `SourceChunkStoreOptions.embedding must have dimension ${dim}, got ${embedding.length}`,
    );
  }
  for (let i = 0; i < embedding.length; i++) {
    if (!Number.isFinite(embedding[i])) {
      throw new InvalidArgumentError(`SourceChunkStoreOptions.embedding[${i}] must be finite`);
    }
  }
  const float32 = new Float32Array(embedding);
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
};

export const normalizeSourceChunkInput = (
  input: SourceChunkInput,
  options: SourceChunkNormalizeOptions,
): StoredSourceChunk => {
  const inputRecord = assertRecordInput(input, 'SourceChunkInput');
  const optionsRecord = assertRecordInput(options, 'SourceChunkNormalizeOptions');
  if (typeof inputRecord.text !== 'string') {
    throw new InvalidArgumentError('SourceChunkInput.text must be a string');
  }
  const text = inputRecord.text.trim();
  if (text.length === 0) {
    throw new InvalidArgumentError('SourceChunkInput.text must be non-empty after trim');
  }
  if (Buffer.byteLength(text, 'utf8') > SOURCE_CHUNK_TEXT_LIMIT) {
    throw new InvalidArgumentError(
      `SourceChunkInput.text must be <= ${SOURCE_CHUNK_TEXT_LIMIT} bytes`,
    );
  }

  const chunkIdValue = inputRecord.chunkId;
  if (chunkIdValue !== undefined && typeof chunkIdValue !== 'string') {
    throw new InvalidArgumentError('SourceChunkInput.chunkId must be a string');
  }

  const now = new Date().toISOString();
  return {
    chunkId: chunkIdValue ?? randomUUID(),
    projectId: validateProjectId(optionsRecord.projectId as string),
    text,
    sourceKind: assertOptionalString(inputRecord.sourceKind as string | undefined, 'sourceKind'),
    sourceUri: assertOptionalString(inputRecord.sourceUri as string | undefined, 'sourceUri'),
    entryId: assertOptionalString(inputRecord.entryId as string | undefined, 'entryId'),
    parentId: assertOptionalString(inputRecord.parentId as string | undefined, 'parentId'),
    lineNumber: assertOptionalInteger(inputRecord.lineNumber as number | undefined, 'lineNumber'),
    lineStart: assertOptionalInteger(inputRecord.lineStart as number | undefined, 'lineStart'),
    lineEnd: assertOptionalInteger(inputRecord.lineEnd as number | undefined, 'lineEnd'),
    timestamp: assertOptionalString(inputRecord.timestamp as string | undefined, 'timestamp'),
    metadataJson: validateMetadata(inputRecord.metadata as SourceChunkInput['metadata']),
    createdAt: now,
    updatedAt: now,
  };
};

export class SourceChunkStore {
  private readonly dim: number;
  private readonly upsertChunk: Statement;
  private readonly deleteVector: Statement;
  private readonly insertVector: Statement;
  private readonly writeChunksWithVectors: (
    chunks: readonly StoredSourceChunk[],
    embeddings: readonly Buffer[],
  ) => void;

  public constructor(db: Database.Database, dim: number) {
    initSourceChunkTables(db, dim);
    this.dim = dim;
    this.upsertChunk = db.prepare(`
      INSERT INTO source_chunks (
        project_id, chunk_id, text, source_kind, source_uri, entry_id, parent_id,
        line_number, line_start, line_end, timestamp, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, chunk_id) DO UPDATE SET
        text = excluded.text,
        source_kind = excluded.source_kind,
        source_uri = excluded.source_uri,
        entry_id = excluded.entry_id,
        parent_id = excluded.parent_id,
        line_number = excluded.line_number,
        line_start = excluded.line_start,
        line_end = excluded.line_end,
        timestamp = excluded.timestamp,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);
    this.deleteVector = db.prepare(
      'DELETE FROM vec_source_chunks WHERE project_id = ? AND chunk_id = ?',
    );
    this.insertVector = db.prepare(
      'INSERT INTO vec_source_chunks(chunk_key, project_id, chunk_id, embedding) VALUES (?, ?, ?, ?)',
    );
    this.writeChunksWithVectors = db.transaction(
      (chunks: readonly StoredSourceChunk[], embeddings: readonly Buffer[]) => {
        for (let index = 0; index < chunks.length; index++) {
          const chunk = chunks[index]!;
          this.upsertChunk.run(
            chunk.projectId,
            chunk.chunkId,
            chunk.text,
            chunk.sourceKind,
            chunk.sourceUri,
            chunk.entryId,
            chunk.parentId,
            chunk.lineNumber,
            chunk.lineStart,
            chunk.lineEnd,
            chunk.timestamp,
            chunk.metadataJson,
            chunk.createdAt,
            chunk.updatedAt,
          );
          const chunkKey = sourceChunkKey(chunk.projectId, chunk.chunkId);
          this.deleteVector.run(chunk.projectId, chunk.chunkId);
          this.insertVector.run(chunkKey, chunk.projectId, chunk.chunkId, embeddings[index]!);
        }
      },
    );
  }

  public validateMany(
    inputs: readonly SourceChunkInput[],
    options: SourceChunkNormalizeOptions,
  ): readonly StoredSourceChunk[] {
    return inputs.map((input) => normalizeSourceChunkInput(input, options));
  }

  public put(input: SourceChunkInput, options: SourceChunkStoreOptions): StoredSourceChunk {
    const optionsRecord = assertRecordInput(options, 'SourceChunkStoreOptions');
    const chunks = this.putMany([input], {
      projectId: optionsRecord.projectId as string,
      embeddings: [optionsRecord.embedding as readonly number[]],
    });
    return chunks[0]!;
  }

  public putMany(
    inputs: readonly SourceChunkInput[],
    options: { readonly projectId: string; readonly embeddings: readonly (readonly number[])[] },
  ): readonly StoredSourceChunk[] {
    if (inputs.length !== options.embeddings.length) {
      throw new InvalidArgumentError(
        `SourceChunkStore.putMany: expected ${inputs.length} embeddings, got ${options.embeddings.length}`,
      );
    }
    const chunks = inputs.map((input) => normalizeSourceChunkInput(input, options));
    const embeddings = options.embeddings.map((embedding) =>
      validateEmbedding(embedding, this.dim),
    );
    this.writeChunksWithVectors(chunks, embeddings);
    return chunks;
  }
}
