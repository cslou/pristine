import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { InvalidArgumentError } from '../../core/errors.js';
import { assertValidDim } from '../../core/vector-dim.js';
import type { SourceChunkInput, SourceChunkStoreOptions, StoredSourceChunk } from './types.js';

/**
 * Source-index storage contract.
 *
 * Tables:
 * - `source_chunks`: stable chunk metadata keyed by `chunk_id`. Required
 *   fields are `chunk_id`, `project_id`, and indexed `text`; source pointer
 *   fields and `metadata_json` are nullable so text-only chunks remain valid.
 * - `vec_source_chunks`: sqlite-vec table keyed by the same `chunk_id`, with
 *   `embedding float[N]` templated from the configured embedder dimension and
 *   `project_id` duplicated for filter-first vector search.
 */
export const SOURCE_CHUNK_TEXT_LIMIT = 64 * 1024;
export const SOURCE_CHUNK_METADATA_JSON_LIMIT = 16 * 1024;

const SOURCE_CHUNKS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS source_chunks (
  chunk_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  chunk_id TEXT PRIMARY KEY,
  project_id TEXT,
  embedding float[${dim}]
);
`;
};

export const initSourceChunkTables = (db: Database.Database, dim: number): void => {
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
    return value.map((item, index) => assertJsonValue(item, `${path}[${index}]`, seen));
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
  options: SourceChunkStoreOptions,
): StoredSourceChunk => {
  if (typeof input.text !== 'string') {
    throw new InvalidArgumentError('SourceChunkInput.text must be a string');
  }
  const text = input.text.trim();
  if (text.length === 0) {
    throw new InvalidArgumentError('SourceChunkInput.text must be non-empty after trim');
  }
  if (Buffer.byteLength(text, 'utf8') > SOURCE_CHUNK_TEXT_LIMIT) {
    throw new InvalidArgumentError(
      `SourceChunkInput.text must be <= ${SOURCE_CHUNK_TEXT_LIMIT} bytes`,
    );
  }

  const now = new Date().toISOString();
  return {
    chunkId: input.chunkId ?? randomUUID(),
    projectId: validateProjectId(options.projectId),
    text,
    sourceKind: assertOptionalString(input.sourceKind, 'sourceKind'),
    sourceUri: assertOptionalString(input.sourceUri, 'sourceUri'),
    entryId: assertOptionalString(input.entryId, 'entryId'),
    parentId: assertOptionalString(input.parentId, 'parentId'),
    lineNumber: assertOptionalInteger(input.lineNumber, 'lineNumber'),
    lineStart: assertOptionalInteger(input.lineStart, 'lineStart'),
    lineEnd: assertOptionalInteger(input.lineEnd, 'lineEnd'),
    timestamp: assertOptionalString(input.timestamp, 'timestamp'),
    metadataJson: validateMetadata(input.metadata),
    createdAt: now,
    updatedAt: now,
  };
};

export class SourceChunkStore {
  private readonly dim: number;
  private readonly upsertChunk: Statement;
  private readonly deleteVector: Statement;
  private readonly insertVector: Statement;

  public constructor(
    private readonly db: Database.Database,
    dim: number,
  ) {
    initSourceChunkTables(db, dim);
    this.dim = dim;
    this.upsertChunk = db.prepare(`
      INSERT INTO source_chunks (
        chunk_id, project_id, text, source_kind, source_uri, entry_id, parent_id,
        line_number, line_start, line_end, timestamp, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        project_id = excluded.project_id,
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
    this.deleteVector = db.prepare('DELETE FROM vec_source_chunks WHERE chunk_id = ?');
    this.insertVector = db.prepare(
      'INSERT INTO vec_source_chunks(chunk_id, project_id, embedding) VALUES (?, ?, ?)',
    );
  }

  public put(input: SourceChunkInput, options: SourceChunkStoreOptions): StoredSourceChunk {
    const chunk = normalizeSourceChunkInput(input, options);
    const embedding = validateEmbedding(options.embedding, this.dim);
    const runTransaction = this.db.transaction(() => {
      this.upsertChunk.run(
        chunk.chunkId,
        chunk.projectId,
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
      this.deleteVector.run(chunk.chunkId);
      this.insertVector.run(chunk.chunkId, chunk.projectId, embedding);
    });
    runTransaction();
    return chunk;
  }
}
