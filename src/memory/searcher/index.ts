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
   *
   * **Caveat:** the role-filter post-pass runs over a fixed `limit*2`
   * over-fetch from the KNN. If more than half the top-2*limit windows
   * fail the role check, the returned array can be shorter than `limit`
   * even when more matching windows exist further down the KNN ranking.
   * Documented for callers; auto-grow over-fetch is deferred to Phase 7
   * eval signal.
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
  /**
   * Similarity score, **higher = more similar**. Computed as
   * `1 / (1 + distance)` from vec0's L2 distance: 0 < score ≤ 1, with
   * score → 1 as distance → 0. Story 4's RRF fusion across vector + FTS
   * + session sources requires a consistent "higher is better" convention
   * (spec §5.1.3 + Story 4 Technical Notes); inverting at the primitive
   * boundary keeps fusion arithmetic clean and lets future ranking
   * tweaks work in score-space rather than distance-space.
   */
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

// Convert vec0 L2 distance to a similarity score in (0, 1]. Monotonically
// decreasing in distance, so KNN's distance-ascending order maps to
// score-descending order without any re-sort. Higher = more similar; this
// is the convention Story 4's RRF fusion expects across all primitives.
const distanceToScore = (distance: number): number => 1 / (1 + distance);

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSearcher = (deps: SearcherDeps): Searcher => {
  const { db, embedder } = deps;

  // Statements with FIXED shape — hoisted to factory scope so the SQL
  // compiles once per searcher lifetime, not once per vectorSearch call.
  // Both use json_each(?) to bind the IN-list as a single JSON-string
  // parameter, sidestepping SQLite's 32766-bind-parameter limit on
  // dynamic IN-lists.

  // Resolve all (cid, widx) → messageIds in one query. Caller supplies
  // (cid, widx) pairs as a JSON array of {c, w} objects. ORDER BY ensures
  // window_messages.position-order is preserved per (cid, widx) group.
  const resolveMessageIdsBatch = db.prepare(`
    SELECT wm.conversation_id, wm.window_index, wm.message_id, wm.position
    FROM window_messages wm
    JOIN json_each(?) j
      ON j.value ->> '$.c' = wm.conversation_id
     AND j.value ->> '$.w' = wm.window_index
    ORDER BY wm.conversation_id, wm.window_index, wm.position ASC
  `);

  // Find which (cid, widx) pairs contain at least one message with the
  // given role. Caller supplies the same JSON array; result is the
  // surviving set.
  const roleMatchesBatch = db.prepare(`
    SELECT DISTINCT wm.conversation_id, wm.window_index
    FROM window_messages wm
    JOIN messages m ON m.id = wm.message_id
    JOIN json_each(?) j
      ON j.value ->> '$.c' = wm.conversation_id
     AND j.value ->> '$.w' = wm.window_index
    WHERE m.role = ?
  `);

  // ---- Filter-first candidate-set query --------------------------------
  //
  // Narrow `conversations` to those matching projectId + optional
  // conversationId + dateFrom/dateTo. The role filter is applied later
  // (it requires joining vec_windows → window_messages → messages).
  //
  // Hot path: project-only filter resolved by ix_conversations_project_started
  // (project_id, created_at DESC) — confirmed via EXPLAIN QUERY PLAN
  // (pinned in tests/integration/searcher-vector.test.ts).
  //
  // SQL is built dynamically (filter combinations vary), but only the
  // four hard-coded fragments below ever appear; values always go through
  // `?` placeholders. Caching via a small Map keyed on the filter shape
  // would help, but for sprint-016 the per-call db.prepare() cost on a
  // ≤4-AND query is ~50µs — negligible vs the embed call.

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
    // Use a for-loop instead of .some so an early-exit on the first NaN
    // doesn't allocate a closure per call on the (clean) common path.
    for (let i = 0; i < queryVec.length; i++) {
      if (Number.isNaN(queryVec[i])) {
        throw new InvalidArgumentError(
          'searcher.vectorSearch: embedder returned vector containing NaN',
        );
      }
    }
    const queryFloat32 = new Float32Array(queryVec);
    const queryBuf = Buffer.from(
      queryFloat32.buffer,
      queryFloat32.byteOffset,
      queryFloat32.byteLength,
    );

    // Step 3 — vec0 KNN restricted to the candidate set. We bind the
    // candidate id list as a single JSON-string parameter via json_each,
    // sidestepping SQLite's 32766-parameter limit that a dynamic
    // `IN (?, ?, ?, ...)` would hit at large project sizes (sprint doc
    // §16 P4-S1 Technical Notes call this out).
    //
    // Over-fetch by limit*2 when a role filter is configured so the
    // post-KNN role-pruning pass still has enough candidates if it
    // discards some windows. limit*2 is the same shape Story 4's
    // hybridSearch uses for its FTS/vector over-fetch.
    const knnK =
      filters.role !== undefined ? Math.min(limit * 2, MAX_LIMIT) : Math.min(limit, MAX_LIMIT);
    const knnSql = `
      SELECT conversation_id, window_index, distance
      FROM vec_windows
      WHERE embedding MATCH ?
        AND k = ?
        AND conversation_id IN (SELECT value FROM json_each(?))
      ORDER BY distance
    `;
    const candidateIdsJson = JSON.stringify(candidateIds);
    const knnRows = db.prepare(knnSql).all(queryBuf, knnK, candidateIdsJson) as {
      conversation_id: string;
      window_index: number | bigint;
      distance: number;
    }[];

    if (knnRows.length === 0) return [];

    // Normalize bigint → number once; vec0 reads sometimes surface bigint
    // for INTEGER columns even though writes require BigInt binds.
    const normalizedKnn = knnRows.map((row) => ({
      conversationId: row.conversation_id,
      windowIndex:
        typeof row.window_index === 'bigint' ? Number(row.window_index) : row.window_index,
      distance: row.distance,
    }));

    // Step 4 — batched role-filter (single SQL query, not per-row).
    const knnPairsJson = JSON.stringify(
      normalizedKnn.map((r) => ({ c: r.conversationId, w: r.windowIndex })),
    );

    let roleAllowed: Set<string> | null = null;
    if (filters.role !== undefined) {
      const allowedRows = roleMatchesBatch.all(knnPairsJson, filters.role) as {
        conversation_id: string;
        window_index: number | bigint;
      }[];
      roleAllowed = new Set(
        allowedRows.map(
          (r) =>
            `${r.conversation_id} ${typeof r.window_index === 'bigint' ? Number(r.window_index) : r.window_index}`,
        ),
      );
    }

    // Step 5 — batched messageIds resolution (single SQL query, not per-row).
    type IdRow = {
      conversation_id: string;
      window_index: number | bigint;
      message_id: number;
      position: number;
    };
    const idRows = resolveMessageIdsBatch.all(knnPairsJson) as IdRow[];
    const messageIdsByPair = new Map<string, number[]>();
    for (const r of idRows) {
      const widx = typeof r.window_index === 'bigint' ? Number(r.window_index) : r.window_index;
      const key = `${r.conversation_id} ${widx}`;
      let arr = messageIdsByPair.get(key);
      if (arr === undefined) {
        arr = [];
        messageIdsByPair.set(key, arr);
      }
      arr.push(r.message_id);
    }

    // Step 6 — assemble hits in KNN distance order, applying role filter
    // and stopping at limit.
    const hits: WindowHit[] = [];
    for (const row of normalizedKnn) {
      const key = `${row.conversationId} ${row.windowIndex}`;
      if (roleAllowed !== null && !roleAllowed.has(key)) continue;
      const messageIds = messageIdsByPair.get(key) ?? [];
      hits.push({
        conversationId: row.conversationId,
        windowIndex: row.windowIndex,
        score: distanceToScore(row.distance),
        messageIds,
      });
      if (hits.length >= limit) break;
    }
    return hits;
  };

  return { vectorSearch };
};
