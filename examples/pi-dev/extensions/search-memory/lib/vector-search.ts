import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { load as loadSqliteVec } from 'sqlite-vec';
import { resolvePiPristineDbPath } from '../../../shared/lib/db-path.js';
import {
  PI_JSONL_CHUNKS_TABLE,
  PI_JSONL_INDEX_TABLES,
  PI_JSONL_VECTOR_TABLE,
  piJsonlChunkSelectList,
  type PiJsonlIndexChunkRow,
} from '../../../shared/lib/pi-jsonl-index-schema.js';
import { LocalNomicEmbedder, type PiJsonlEmbedder } from './local-embedder.js';

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
const MAX_FILTERED_CANDIDATES = 5000;

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

const euclideanDistance = (left: readonly number[], right: Buffer): number => {
  const values = new Float32Array(right.buffer, right.byteOffset, right.byteLength / 4);
  if (values.length !== left.length) {
    throw new Error(
      `pristine_vector_search embedding dimension mismatch: query has ${left.length}, stored row has ${values.length}`,
    );
  }
  let sum = 0;
  for (let index = 0; index < left.length; index++) {
    const delta = (left[index] ?? 0) - (values[index] ?? 0);
    sum += delta * delta;
  }
  return Math.sqrt(sum);
};

const REDACTED_SNIPPET =
  '[snippet redacted by default; inspect sourcePointer with search-session-history]';

const scrubSnippet = (_snippet: string): string => REDACTED_SNIPPET;

interface SearchRow extends PiJsonlIndexChunkRow {
  readonly distance: number;
}

interface FilteredCandidateRow extends Omit<SearchRow, 'distance'> {
  readonly embedding: Buffer;
}

const hasIndexTables = (db: Database.Database): boolean => {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM sqlite_master
       WHERE type IN ('table', 'virtual table')
         AND name IN (${PI_JSONL_INDEX_TABLES.map(() => '?').join(', ')})`,
    )
    .get(...PI_JSONL_INDEX_TABLES) as { count: number };
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
      const filteredCandidateCount = this.countFilteredCandidates(db, filter);
      if (filteredCandidateCount === 0) {
        return { results: [], message: 'No Pristine Pi vector hits matched the provided filters.' };
      }
      if (
        filteredCandidateCount !== undefined &&
        filteredCandidateCount > MAX_FILTERED_CANDIDATES
      ) {
        return {
          results: [],
          message: `Pristine Pi vector filter matches ${filteredCandidateCount} rows; narrow filters below ${MAX_FILTERED_CANDIDATES} rows.`,
        };
      }

      const vector = await this.embedder.embed(query);
      const embedding = toEmbeddingBuffer(vector);
      const rows =
        filteredCandidateCount === undefined
          ? this.runKnn(db, embedding, limit)
          : this.runFilteredExact(db, vector, limit, filter);
      return {
        results: rows.map(mapSearchRow),
        message: rows.length === 0 ? 'No Pristine Pi vector hits found.' : undefined,
      };
    } finally {
      db.close();
    }
  }

  private countFilteredCandidates(
    db: Database.Database,
    filter: { readonly clauses: readonly string[]; readonly params: readonly unknown[] },
  ): number | undefined {
    if (filter.clauses.length === 0) return undefined;
    const row = db
      .prepare(
        `SELECT count(*) AS count FROM ${PI_JSONL_CHUNKS_TABLE} WHERE ${filter.clauses.join(' AND ')}`,
      )
      .get(...filter.params) as { count: number };
    return row.count;
  }

  private runKnn(db: Database.Database, embedding: Buffer, limit: number): readonly SearchRow[] {
    return db
      .prepare(
        `SELECT ${piJsonlChunkSelectList('c')},
                v.distance
         FROM ${PI_JSONL_VECTOR_TABLE} AS v
         JOIN ${PI_JSONL_CHUNKS_TABLE} AS c ON c.chunk_id = v.chunk_id
         WHERE v.embedding MATCH ?
           AND k = ?
         ORDER BY v.distance
         LIMIT ?`,
      )
      .all(embedding, limit, limit) as SearchRow[];
  }

  private runFilteredExact(
    db: Database.Database,
    queryVector: readonly number[],
    limit: number,
    filter: { readonly clauses: readonly string[]; readonly params: readonly unknown[] },
  ): readonly SearchRow[] {
    const rows: SearchRow[] = [];
    const statement = db.prepare(
      `SELECT ${piJsonlChunkSelectList('c')},
              v.embedding
       FROM ${PI_JSONL_CHUNKS_TABLE} AS c
       JOIN ${PI_JSONL_VECTOR_TABLE} AS v ON v.chunk_id = c.chunk_id
       WHERE ${filter.clauses.join(' AND ')}`,
    );

    for (const row of statement.iterate(...filter.params) as Iterable<FilteredCandidateRow>) {
      rows.push({ ...row, distance: euclideanDistance(queryVector, row.embedding) });
      rows.sort((left, right) => left.distance - right.distance);
      if (rows.length > limit) rows.pop();
    }

    return rows;
  }
}

export const createPristinePiVectorSearcher = (
  config: PristineVectorSearchConfig = {},
): PristinePiVectorSearcher => new PristinePiVectorSearcher(config);
