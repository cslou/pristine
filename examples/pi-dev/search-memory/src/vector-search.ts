import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { load as loadSqliteVec } from 'sqlite-vec';
import { resolvePiPristineDbPath } from '../../shared/src/db-path.js';
import { LocalNomicEmbedder, type PiJsonlEmbedder } from '../../shared/src/local-embedder.js';

export interface PristineVectorSearchFilters {
  readonly sourceUri?: string;
  readonly entryId?: string;
  readonly parentId?: string;
  readonly lineNumber?: number;
  readonly timestampFrom?: string;
  readonly timestampTo?: string;
  readonly cwd?: string;
}

export interface PristineVectorSearchInput extends PristineVectorSearchFilters {
  readonly query: string;
  readonly limit?: number;
}

export interface PristineVectorSearchSourcePointer {
  readonly sourceKind: 'pi-jsonl';
  readonly sourceUri: string;
  readonly entryId?: string;
  readonly parentId?: string;
  readonly lineNumber: number;
  readonly timestamp?: string;
  readonly cwd?: string;
}

export interface PristineVectorSearchHit {
  readonly rank: number;
  readonly score: number;
  readonly chunkId: string;
  readonly snippet: string;
  readonly sourcePointer: PristineVectorSearchSourcePointer;
}

export interface PristineVectorSearchResult {
  readonly results: readonly PristineVectorSearchHit[];
  readonly message?: string;
}

export interface PristineVectorSearchConfig {
  readonly dbPath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly embedder?: PiJsonlEmbedder;
}

const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 5;
const MAX_EMBEDDING_DIM = 8192;

const validateLimit = (limit: number | undefined): number => {
  const resolved = limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > MAX_LIMIT) {
    throw new Error(
      `pristine_vector_search limit must be an integer in [1, ${MAX_LIMIT}], got ${resolved}`,
    );
  }
  return resolved;
};

const validateLineNumber = (lineNumber: number | undefined): number | undefined => {
  if (lineNumber === undefined) return undefined;
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    throw new Error(
      `pristine_vector_search lineNumber must be a positive integer, got ${lineNumber}`,
    );
  }
  return lineNumber;
};

const toEmbeddingBuffer = (vector: readonly number[]): Buffer => {
  if (!Number.isInteger(vector.length) || vector.length < 1 || vector.length > MAX_EMBEDDING_DIM) {
    throw new Error(
      `pristine_vector_search embedding dimension must be in [1, ${MAX_EMBEDDING_DIM}], got ${vector.length}`,
    );
  }
  const embedding = Float32Array.from(vector);
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
};

const scoreFromDistance = (distance: number): number => 1 / (1 + distance);

const scrubSnippet = (snippet: string): string =>
  snippet
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g, '[REDACTED TOKEN]')
    .replace(/\bA[KS]IA[0-9A-Z]{16}\b/g, '[REDACTED AWS KEY]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED EMAIL]')
    .replace(/\b(?:\+?\d[\d(). -]{7,}\d)\b/g, '[REDACTED PHONE]')
    .replace(/\b([A-Z][A-Z0-9_]{2,})=([^\s]{8,})/g, '$1=[REDACTED]')
    .replace(/\b[A-Za-z0-9_/-]{32,}\b/g, '[REDACTED SECRET]');

interface SearchRow {
  readonly chunk_id: string;
  readonly source_kind: 'pi-jsonl';
  readonly source_uri: string;
  readonly entry_id: string | null;
  readonly parent_id: string | null;
  readonly line_number: number | bigint;
  readonly timestamp: string | null;
  readonly cwd: string | null;
  readonly snippet: string;
  readonly distance: number;
}

const hasIndexTables = (db: Database.Database): boolean => {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM sqlite_master
       WHERE type IN ('table', 'virtual table')
         AND name IN ('pi_jsonl_chunks', 'vec_pi_jsonl_chunks')`,
    )
    .get() as { count: number };
  return row.count === 2;
};

const buildFilterWhere = (
  input: PristineVectorSearchInput,
): {
  readonly clauses: string[];
  readonly params: unknown[];
} => {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const addEquals = (column: string, value: string | undefined): void => {
    if (value === undefined) return;
    clauses.push(`${column} = ?`);
    params.push(value);
  };

  addEquals('source_uri', input.sourceUri);
  addEquals('entry_id', input.entryId);
  addEquals('parent_id', input.parentId);
  addEquals('cwd', input.cwd);
  const lineNumber = validateLineNumber(input.lineNumber);
  if (lineNumber !== undefined) {
    clauses.push('line_number = ?');
    params.push(lineNumber);
  }
  if (input.timestampFrom !== undefined) {
    clauses.push('timestamp >= ?');
    params.push(input.timestampFrom);
  }
  if (input.timestampTo !== undefined) {
    clauses.push('timestamp <= ?');
    params.push(input.timestampTo);
  }

  return { clauses, params };
};

const mapSearchRow = (row: SearchRow, index: number): PristineVectorSearchHit => {
  const lineNumber =
    typeof row.line_number === 'bigint' ? Number(row.line_number) : row.line_number;
  return {
    rank: index + 1,
    score: scoreFromDistance(row.distance),
    chunkId: row.chunk_id,
    snippet: scrubSnippet(row.snippet),
    sourcePointer: {
      sourceKind: row.source_kind,
      sourceUri: row.source_uri,
      entryId: row.entry_id ?? undefined,
      parentId: row.parent_id ?? undefined,
      lineNumber,
      timestamp: row.timestamp ?? undefined,
      cwd: row.cwd ?? undefined,
    },
  };
};

export class PristinePiVectorSearcher {
  private readonly dbPath: string;
  private readonly embedder: PiJsonlEmbedder;

  public constructor(config: PristineVectorSearchConfig = {}) {
    this.dbPath = resolvePiPristineDbPath({
      explicitPath: config.dbPath,
      env: config.env,
      homeDir: config.homeDir,
    });
    this.embedder = config.embedder ?? new LocalNomicEmbedder();
  }

  public async search(input: PristineVectorSearchInput): Promise<PristineVectorSearchResult> {
    const query = input.query.trim();
    if (query.length === 0)
      throw new Error('pristine_vector_search query must be a non-empty string');
    const limit = validateLimit(input.limit);
    validateLineNumber(input.lineNumber);
    if (!existsSync(this.dbPath)) {
      throw new Error(`pristine_vector_search database is unavailable: ${this.dbPath}`);
    }

    const db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
    try {
      loadSqliteVec(db);
      if (!hasIndexTables(db)) {
        return {
          results: [],
          message: 'Pristine Pi vector index is empty; run jsonl-index first.',
        };
      }
      const filter = buildFilterWhere(input);

      const vector = await this.embedder.embed(query);
      const embedding = toEmbeddingBuffer(vector);
      const rows = this.runKnn(db, embedding, limit, filter);
      return {
        results: rows.map(mapSearchRow),
        message: rows.length === 0 ? 'No Pristine Pi vector hits found.' : undefined,
      };
    } finally {
      db.close();
    }
  }

  private runKnn(
    db: Database.Database,
    embedding: Buffer,
    limit: number,
    filter: { readonly clauses: readonly string[]; readonly params: readonly unknown[] },
  ): readonly SearchRow[] {
    const params: unknown[] = [embedding, limit, ...filter.params];
    const candidatePredicate =
      filter.clauses.length === 0
        ? ''
        : `AND v.chunk_id IN (SELECT chunk_id FROM pi_jsonl_chunks WHERE ${filter.clauses.join(' AND ')})`;
    return db
      .prepare(
        `SELECT c.chunk_id,
                c.source_kind,
                c.source_uri,
                c.entry_id,
                c.parent_id,
                c.line_number,
                c.timestamp,
                c.cwd,
                c.snippet,
                v.distance
         FROM vec_pi_jsonl_chunks AS v
         JOIN pi_jsonl_chunks AS c ON c.chunk_id = v.chunk_id
         WHERE v.embedding MATCH ?
           AND k = ?
           ${candidatePredicate}
         ORDER BY v.distance`,
      )
      .all(...params) as SearchRow[];
  }
}

export const createPristinePiVectorSearcher = (
  config: PristineVectorSearchConfig = {},
): PristinePiVectorSearcher => new PristinePiVectorSearcher(config);
