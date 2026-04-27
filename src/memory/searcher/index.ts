// Spec-005 Phase 4 retrieval primitive — `searcher`. Sprint-016 Story 2
// ships `vectorSearch`; Stories 3-5 extend the same factory with FTS,
// hybrid RRF, and 3-source fan-out. The searcher is read-only: it never
// writes corpus tables, only SELECTs against the indexes the indexer
// (sprint-015) populated.
//
// Filter-first ordering: we narrow the candidate set via SQL over
// `conversations` (and optional joins) BEFORE running vec0 KNN. The
// alternative — KNN-first then filter — would scan the whole vec0 index
// and discard most results, defeating the project-isolation contract.

import type Database from 'better-sqlite3';
import type { Embedder } from '../../core/interfaces.js';
import { InvalidArgumentError } from '../../core/errors.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Role = 'user' | 'assistant' | 'system';

/**
 * Search scope filters applied BEFORE the vector KNN runs.
 *
 * `projectId` is required — the searcher's project-isolation contract is
 * the load-bearing privacy boundary (see spec §5.1.3). Other filters
 * narrow further within that scope.
 */
export interface SearchFilters {
  readonly projectId: string;
  readonly conversationId?: string;
  /**
   * Role filter. A window matches if AT LEAST ONE of its constituent
   * messages has the role. Window-level filtering is permissive because
   * a window's text concatenates messages from multiple roles; treating
   * the role filter as "must contain" is the most useful interpretation
   * for retrieval.
   */
  readonly role?: Role;
  /** ISO 8601 lower bound (inclusive) on `conversations.created_at`. */
  readonly dateFrom?: string;
  /** ISO 8601 upper bound (inclusive) on `conversations.created_at`. */
  readonly dateTo?: string;
}

export interface WindowHit {
  readonly conversationId: string;
  readonly windowIndex: number;
  /** Lower is closer in embedding space; vec0 returns L2 distance by default. */
  readonly score: number;
  /** Constituent message ids ordered by `window_messages.position`. */
  readonly messageIds: readonly number[];
}

export interface Searcher {
  vectorSearch(query: string, filters: SearchFilters, limit: number): Promise<readonly WindowHit[]>;
}

export interface SearcherDeps {
  readonly db: Database.Database;
  readonly embedder: Embedder;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Hard ceiling on `limit`. vec0 KNN cost scales with k; we cap to keep
// pathological queries from blocking the synchronous path. 1000 is
// well above any realistic UX (sprint-016 retrieval surfaces top-5 to
// top-50 in the hybrid-RRF flow).
const MAX_LIMIT = 1000;

const VEC_DIM = 768;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSearcher = (deps: SearcherDeps): Searcher => {
  const { db, embedder } = deps;

  // ---- Filter-first candidate-set query --------------------------------
  //
  // Narrow `conversations` to those matching projectId + optional
  // conversationId + dateFrom/dateTo. The role filter is applied later
  // (it requires joining vec_windows → window_messages → messages, which
  // we want to do only over the candidate set).
  //
  // Hot path: project-only filter resolved by ix_conversations_project_started
  // (project_id, created_at DESC) — confirmed via EXPLAIN QUERY PLAN
  // (pinned in tests/integration/searcher.test.ts as a comment).

  const buildCandidateSql = (filters: SearchFilters): { sql: string; params: unknown[] } => {
    const conditions: string[] = ['c.project_id = ?'];
    const params: unknown[] = [filters.projectId];

    if (filters.conversationId !== undefined) {
      conditions.push('c.id = ?');
      params.push(filters.conversationId);
    }
    if (filters.dateFrom !== undefined) {
      conditions.push('c.created_at >= ?');
      params.push(filters.dateFrom);
    }
    if (filters.dateTo !== undefined) {
      conditions.push('c.created_at <= ?');
      params.push(filters.dateTo);
    }

    return {
      sql: `SELECT c.id AS conversation_id FROM conversations c WHERE ${conditions.join(' AND ')}`,
      params,
    };
  };

  const vectorSearch = async (
    query: string,
    filters: SearchFilters,
    limit: number,
  ): Promise<readonly WindowHit[]> => {
    if (typeof query !== 'string' || query.length === 0) {
      throw new InvalidArgumentError('searcher.vectorSearch: query must be a non-empty string');
    }
    if (filters.projectId === '') {
      throw new InvalidArgumentError('searcher.vectorSearch: filters.projectId must be non-empty');
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new InvalidArgumentError(
        `searcher.vectorSearch: limit must be a positive integer, got ${String(limit)}`,
      );
    }
    if (limit > MAX_LIMIT) {
      throw new InvalidArgumentError(
        `searcher.vectorSearch: limit must be <= ${MAX_LIMIT}, got ${limit}`,
      );
    }

    // Step 1 — narrow conversation candidates via filter SQL.
    const { sql: candSql, params: candParams } = buildCandidateSql(filters);
    const candidateRows = db.prepare(candSql).all(...candParams) as { conversation_id: string }[];
    if (candidateRows.length === 0) return [];
    const candidateIds = candidateRows.map((r) => r.conversation_id);

    // Step 2 — embed the query. We do this AFTER the candidate-set check
    // so an empty-scope query short-circuits without paying the embed
    // cost (Nomic CPU embedding ~50-100ms per call).
    const queryVec = await embedder.embed(query);
    if (queryVec.length !== VEC_DIM) {
      throw new InvalidArgumentError(
        `searcher.vectorSearch: embedder returned ${queryVec.length}-d vector, expected ${VEC_DIM}`,
      );
    }
    if (queryVec.some((v) => Number.isNaN(v))) {
      throw new InvalidArgumentError(
        'searcher.vectorSearch: embedder returned vector containing NaN',
      );
    }
    const queryFloat32 = new Float32Array(queryVec);
    const queryBuf = Buffer.from(
      queryFloat32.buffer,
      queryFloat32.byteOffset,
      queryFloat32.byteLength,
    );

    // Step 3 — vec0 KNN restricted to the candidate set. sqlite-vec
    // accepts `conversation_id IN (...)` as a filter inside the MATCH
    // query; the placeholder list is built dynamically.
    //
    // Over-fetch by k = limit so that the role-filter post-pass below
    // still has enough candidates if it prunes some. limit*2 is the same
    // shape Story 4's hybridSearch uses for its FTS/vector over-fetch.
    const knnK = filters.role !== undefined ? Math.min(limit * 2, MAX_LIMIT) : limit;
    const idPlaceholders = candidateIds.map(() => '?').join(', ');
    const knnSql = `
      SELECT conversation_id, window_index, distance
      FROM vec_windows
      WHERE embedding MATCH ?
        AND k = ?
        AND conversation_id IN (${idPlaceholders})
      ORDER BY distance
    `;
    const knnRows = db.prepare(knnSql).all(queryBuf, knnK, ...candidateIds) as {
      conversation_id: string;
      window_index: number | bigint;
      distance: number;
    }[];

    if (knnRows.length === 0) return [];

    // Step 4 — resolve constituent message ids per window (required for
    // the WindowHit shape) AND optionally enforce the role filter.
    const resolveMessageIds = db.prepare(
      'SELECT message_id, position FROM window_messages WHERE conversation_id = ? AND window_index = ? ORDER BY position ASC',
    );
    const roleMatches = filters.role
      ? db.prepare(
          `SELECT 1 AS hit FROM window_messages wm
           JOIN messages m ON m.id = wm.message_id
           WHERE wm.conversation_id = ? AND wm.window_index = ? AND m.role = ?
           LIMIT 1`,
        )
      : null;

    const hits: WindowHit[] = [];
    for (const row of knnRows) {
      // window_index comes back as a JS number for normal SELECTs; vec0
      // BIND wants BigInt but READS return plain numbers. Coerce defensively.
      const windowIndex =
        typeof row.window_index === 'bigint' ? Number(row.window_index) : row.window_index;
      if (roleMatches !== null) {
        const match = roleMatches.get(row.conversation_id, windowIndex, filters.role) as
          | { hit: number }
          | undefined;
        if (match === undefined) continue;
      }
      const msgRows = resolveMessageIds.all(row.conversation_id, windowIndex) as {
        message_id: number;
        position: number;
      }[];
      hits.push({
        conversationId: row.conversation_id,
        windowIndex,
        score: row.distance,
        messageIds: msgRows.map((m) => m.message_id),
      });
      if (hits.length >= limit) break;
    }
    return hits;
  };

  return { vectorSearch };
};
