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
import { reciprocalRankFusion, RRF_DEFAULT_K } from '../retriever/ranking.js';
import { createSqlBackend, type Row } from './sql-backend.js';
import { DEFAULT_PUBLIC_VIEW_ALLOWLIST, validateSqlAccess } from './sql-parser.js';

export type { Row } from './sql-backend.js';

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
   * Role filter. **Semantics differ by method**:
   *
   * - `vectorSearch`: a window matches if AT LEAST ONE of its
   *   constituent messages has the role (permissive, window-level).
   *   Window-level filtering is permissive because a window's text
   *   concatenates messages from multiple roles; treating the role
   *   filter as "must contain" is the most useful interpretation for
   *   retrieval.
   * - `ftsSearch`: a message matches if its OWN role equals the
   *   filter (strict, message-level). FTS5 operates at message
   *   granularity, so message-level matching is the natural fit.
   * - `sessionVectorSearch`: **silently ignored**. A session vector
   *   aggregates messages of every role; a role-scoped session query
   *   is a category error rather than a useful filter. Documented
   *   here at the field definition so callers see the gap without
   *   navigating to the method JSDoc.
   *
   * `hybridSearch` passes the same `filters` object to all three
   * methods; callers who pass `role: 'user'` should expect
   * vectorSearch to surface windows where any message is from the
   * user, ftsSearch to surface only user-authored messages, and
   * sessionVectorSearch to ignore the constraint. The asymmetry is
   * intentional given each engine's natural granularity.
   *
   * **Caveat (vectorSearch only):** the role-filter post-pass runs
   * over a fixed `limit*2` over-fetch from the KNN. If more than half
   * the top-2*limit windows fail the role check, the returned array
   * can be shorter than `limit` even when more matching windows exist
   * further down the KNN ranking. Documented for callers; auto-grow
   * over-fetch is deferred to Phase 7 eval signal.
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

/**
 * Source-provenance tag on `HybridHit`. Indicates which underlying
 * primitive(s) surfaced this hit:
 *
 * - `'vector'` — only the `vectorSearch` leg matched (window hit)
 * - `'fts'` — only the `ftsSearch` leg matched (message hit)
 * - `'session'` — only the `sessionVectorSearch` leg matched (session
 *   hit, sprint-016 Story 5)
 * - `'both'` — multiple legs matched the same id. With sprint-016's
 *   disjoint id-space (`window:` / `message:` / `session:`), this
 *   today only appears when a future id-derivation change introduces
 *   shared ids across legs. Pre-existing on the type for forward
 *   compatibility.
 */
export type HybridSource = 'vector' | 'fts' | 'session' | 'both';

/**
 * Unified hit shape returned by `hybridSearch`. Discriminated union over
 * the underlying primitive's payload (window from vectorSearch, message
 * from ftsSearch); future Story 5 extends with `kind: 'session'` from
 * `sessionVectorSearch`.
 */
export type HybridHit =
  | {
      readonly kind: 'window';
      readonly conversationId: string;
      readonly windowIndex: number;
      readonly messageIds: readonly number[];
      /**
       * Fused RRF score (sum of `1/(k+rank)` contributions across the
       * primitives this hit appeared in). Higher = more relevant. Not
       * directly comparable to the underlying `WindowHit.score` /
       * `MessageHit.score` / `SessionHit.score` — those are
       * per-primitive similarities, this is a fusion-level rank-derived
       * score.
       */
      readonly score: number;
      readonly source: HybridSource;
    }
  | {
      readonly kind: 'message';
      readonly messageId: number;
      readonly conversationId: string;
      readonly score: number;
      readonly source: HybridSource;
      readonly snippet?: string;
    }
  | {
      readonly kind: 'session';
      readonly conversationId: string;
      readonly score: number;
      readonly source: HybridSource;
    };

export interface SessionHit {
  readonly conversationId: string;
  /**
   * Similarity score, **higher = more similar**. Computed as
   * `1 / (1 + distance)` from vec0's L2 distance over the
   * conversation's whole-session embedding (sprint-015 Story 5).
   * Same convention as `WindowHit.score` so Story 4's RRF fusion sees
   * consistent ordering across vector + FTS + session sources.
   */
  readonly score: number;
}

export interface MessageHit {
  readonly messageId: number;
  readonly conversationId: string;
  /**
   * Similarity score, **higher = more relevant**. Computed as
   * `|bm25| / (1 + |bm25|)` from FTS5's bm25() output (which SQLite
   * returns as a non-positive number — more negative = more relevant).
   * Score lives in [0, 1), approaching 1 as |bm25| grows, with 0
   * meaning no relevance. Same "higher is better" convention as
   * `WindowHit.score` so Story 4's RRF fusion sees consistent ordering
   * across vector + FTS sources.
   */
  readonly score: number;
  /**
   * FTS5-rendered snippet of the matching content with `<b>...</b>` tags
   * around the matched terms. Truncated to ~64 tokens around the match.
   * Undefined when the FTS5 snippet helper returns an empty string
   * (very short matches).
   */
  readonly snippet?: string;
}

/**
 * Per-call options for {@link Searcher.sql}. Every field is optional;
 * unset fields fall back to the searcher's defaults (`rowCap = 1000`,
 * `timeoutMs = 5000`).
 */
export interface SqlOpts {
  /**
   * Positional `?` parameter values, bound left-to-right against the SQL
   * string. SQLite quotes them safely so an injection-style payload like
   * `'; DROP TABLE messages; --'` passed as a `?` value is treated as a
   * literal string, not statement-merged into the SQL.
   */
  readonly params?: readonly unknown[];
  /**
   * Maximum rows returned. Defaults to `1000`. Bound: `[1, 10000]`. Out
   * of range throws `InvalidArgumentError`. The cursor stops at
   * `rowCap`; rows beyond the cap are silently dropped (callers MUST
   * keep their own `LIMIT` ≤ `rowCap`).
   */
  readonly rowCap?: number;
  /**
   * Per-iteration elapsed-time budget in ms. Defaults to `5000`.
   * Bound: `[100, 10000]`. Out of range throws `InvalidArgumentError`.
   * Throws `QueryTimeoutError` when exceeded.
   */
  readonly timeoutMs?: number;
}

/**
 * Read-only retrieval primitive. Five methods cover the Pristine SDK's
 * search surface:
 *
 * - {@link Searcher.vectorSearch} — KNN over `vec_windows`, project-scoped.
 * - {@link Searcher.ftsSearch} — FTS5 keyword search over `messages_fts`.
 * - {@link Searcher.hybridSearch} — RRF fusion of vector + FTS + session.
 * - {@link Searcher.sessionVectorSearch} — KNN over `vec_sessions`.
 * - {@link Searcher.sql} — raw read-only SQL against the public-view
 *   allowlist (`messages_public`, `conversations_public`,
 *   `summaries_public`, `messages_fts`).
 *
 * Every method returns a `Promise` and is read-only at the SQLite level —
 * no method writes corpus tables. `sql` enforces the read-only contract
 * via a `SQLITE_OPEN_READONLY` connection per call (DML is rejected by
 * the engine before any rows are produced).
 */
export interface Searcher {
  vectorSearch(query: string, filters: SearchFilters, limit: number): Promise<readonly WindowHit[]>;
  /**
   * FTS5 keyword search over `messages_fts`, scoped to the same
   * `SearchFilters` as `vectorSearch`. Returns up to `limit` message
   * hits in descending score order (more relevant first).
   *
   * **Tokenizer reality check (sprint-016).** `messages_fts` uses the
   * default `unicode61` tokenizer (no `tokenize` clause in the DDL at
   * `src/conversations/store.ts`), NOT porter — despite spec §5.5
   * implying stem matching. Phrase / boolean / prefix queries work as
   * expected; stem matching does NOT (`"running"` does not match
   * `"run"`). Migrating to porter requires DROP + CREATE on the
   * virtual table + a corpus rebuild and is deferred to a future
   * sprint.
   *
   * **FTS5 query-syntax errors** (unbalanced quotes, invalid operators)
   * are caught and rethrown as `InvalidArgumentError` — no raw SQLite
   * errors leak to callers.
   */
  ftsSearch(query: string, filters: SearchFilters, limit: number): Promise<readonly MessageHit[]>;
  /**
   * Hybrid search: runs `vectorSearch`, `ftsSearch`, and
   * `sessionVectorSearch` in parallel and fuses the three ranked lists
   * via reciprocal rank fusion (k=60). Returns up to `limit`
   * `HybridHit`s in fused score order, each tagged with which
   * primitive(s) surfaced it.
   *
   * **Over-fetch.** All three legs over-fetch `limit*2` so RRF has
   * enough candidates to fuse meaningfully — a query that ranks
   * candidates across vector, FTS, and session sources with overlap
   * should produce a richer fused list than the top-`limit` of any one
   * leg alone.
   *
   * **Partial-empty resilience.** Any leg returning empty does NOT
   * short-circuit the others; `hybridSearch` fuses whichever legs
   * returned hits. Common case: a corpus that has only run
   * `storeAsync` (no explicit `buildSessionVector` calls) will see
   * the session leg return `[]`, and fusion proceeds over vector + FTS
   * alone.
   *
   * **All-leg error.** If all three legs reject simultaneously (e.g.,
   * embedder outage + FTS5 syntax error + session-leg failure),
   * `hybridSearch` rethrows the vectorSearch error — the embedder
   * failure is the higher-impact one.
   */
  hybridSearch(query: string, filters: SearchFilters, limit: number): Promise<readonly HybridHit[]>;
  /**
   * Filter-first KNN over `vec_sessions` — coarse-grained
   * per-conversation vectors built by `indexer.buildSessionVector`.
   * Returns up to `limit` conversations whose session vector is
   * closest to the query, in descending similarity order.
   *
   * **Empty result when `vec_sessions` is unpopulated.** Sprint-015
   * shipped `buildSessionVector` as an explicit consumer-demand call
   * — `storeAsync` does NOT auto-build session vectors. A corpus
   * that has only run `storeAsync` (no separate `buildSessionVector`
   * invocations) will have an empty `vec_sessions` table and return
   * `[]` from this method. `hybridSearch`'s 3-source fan-out
   * degrades gracefully in that case.
   *
   * **Filter shape note.** The `role` filter does NOT apply at
   * session granularity — a session aggregates messages of every
   * role. The implementation silently ignores `filters.role`;
   * documented here so callers don't expect role-narrowed session
   * results.
   */
  sessionVectorSearch(
    query: string,
    filters: SearchFilters,
    limit: number,
  ): Promise<readonly SessionHit[]>;
  /**
   * Raw read-only SQL against the public-view allowlist
   * (`messages_public`, `conversations_public`, `summaries_public`,
   * `messages_fts`). The single public entry point for ad-hoc analytical
   * queries the four search methods above don't cover.
   *
   * Pipeline: input SQL → {@link validateSqlAccess} (parser-level gate
   * against off-allowlist tables and non-SELECT statements) →
   * `executeReadOnly` (per-call `SQLITE_OPEN_READONLY` connection,
   * row-cap-bounded cursor, per-iteration timeout). Validate-then-execute
   * ordering is non-negotiable — the parser is the privacy-boundary
   * gate, the read-only connection is defence-in-depth.
   *
   * Parameter binding is positional via `?` placeholders. Out-of-range
   * `rowCap` or `timeoutMs` throws `InvalidArgumentError` before any DB
   * work begins.
   */
  sql(sql: string, opts?: SqlOpts): Promise<readonly Row[]>;
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

// Convert FTS5 bm25() output to a similarity score in [0, 1). bm25 is
// non-positive (more negative = more relevant per the SQLite
// implementation): use |bm25| / (1 + |bm25|), monotonically increasing
// in -bm25. bm25 = 0 → score = 0 (no relevance); bm25 → -∞ → score → 1.
// NaN / +Infinity are guarded — they shouldn't occur from FTS5 in
// practice, but the formula is undefined on them so we collapse to 0.
const bm25ToScore = (bm25: number): number => {
  if (!Number.isFinite(bm25)) return 0;
  // Math.abs avoids the -0 quirk: -bm25 of 0 produces -0; Math.abs(0)
  // produces +0. Functionally identical for comparisons (-0 === 0)
  // but JSON.stringify(-0) and Object.is(-0, 0) differ, so this
  // keeps the score stable for any test or serialization that cares.
  const abs = Math.abs(bm25);
  return abs / (1 + abs);
};

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

  // ---- ftsSearch (sprint-016 Story 3 / spec-005 §16 P4-S2) ---------------
  //
  // FTS5 keyword search over `messages_fts`. The candidate-narrowing
  // logic from `vectorSearch` is folded into a single JOIN-based SQL
  // pass (no separate candidate-set query) because `messages_fts` joins
  // through `messages` which already carries denormalized `project_id`,
  // and `conversations` is needed only for date-range filters. Filter
  // shape mirrors `SearchFilters` so callers can swap vector and FTS
  // freely without rewriting filter args.

  const ftsSearch = async (
    query: string,
    filters: SearchFilters,
    limit: number,
  ): Promise<readonly MessageHit[]> => {
    if (typeof query !== 'string' || query.length === 0) {
      throw new InvalidArgumentError('searcher.ftsSearch: query must be a non-empty string');
    }
    if (filters.projectId === '') {
      throw new InvalidArgumentError('searcher.ftsSearch: filters.projectId must be non-empty');
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new InvalidArgumentError(
        `searcher.ftsSearch: limit must be a positive integer, got ${String(limit)}`,
      );
    }
    if (limit > MAX_LIMIT) {
      throw new InvalidArgumentError(
        `searcher.ftsSearch: limit must be <= ${MAX_LIMIT}, got ${limit}`,
      );
    }

    // Build the filter conditions inline. project_id is sourced from
    // messages (denormalized — same project_id on every message of a
    // conversation, written by addConversation/addEmptyConversation).
    // dateFrom/dateTo apply to conversations.created_at; we JOIN
    // conversations only when those filters are present.
    const conditions: string[] = ['messages_fts MATCH ?', 'm.project_id = ?'];
    const params: unknown[] = [query, filters.projectId];

    if (filters.conversationId !== undefined) {
      conditions.push('m.conversation_id = ?');
      params.push(filters.conversationId);
    }
    if (filters.role !== undefined) {
      conditions.push('m.role = ?');
      params.push(filters.role);
    }

    const needsConversationsJoin = filters.dateFrom !== undefined || filters.dateTo !== undefined;
    if (filters.dateFrom !== undefined) {
      conditions.push('c.created_at >= ?');
      params.push(filters.dateFrom);
    }
    if (filters.dateTo !== undefined) {
      conditions.push('c.created_at <= ?');
      params.push(filters.dateTo);
    }

    const sql = `
      SELECT m.id AS message_id,
             m.conversation_id,
             bm25(messages_fts) AS bm25,
             snippet(messages_fts, 0, '<b>', '</b>', '...', 64) AS snippet
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
      ${needsConversationsJoin ? 'JOIN conversations c ON c.id = m.conversation_id' : ''}
      WHERE ${conditions.join(' AND ')}
      ORDER BY bm25 ASC
      LIMIT ?
    `;
    params.push(limit);

    let rows: {
      message_id: number;
      conversation_id: string;
      bm25: number;
      snippet: string | null;
    }[];
    try {
      rows = db.prepare(sql).all(...params) as typeof rows;
    } catch (error: unknown) {
      // FTS5 query-syntax errors surface as better-sqlite3 SqliteError
      // with code === 'SQLITE_ERROR' (the generic SQLite error code).
      // BUT SQLITE_ERROR also fires on infrastructure failures we
      // explicitly want to propagate — "no such table: messages_fts"
      // (FTS5 not loaded), "no such column" (schema migration drift),
      // etc. Use the AND of code + message-keyword regex so we wrap
      // ONLY query-syntax patterns and propagate everything else with
      // its original error class + code intact. Catastrophic codes
      // (SQLITE_CORRUPT, SQLITE_BUSY) never reach the inner branch.
      const code = (error as { code?: string }).code;
      const msg = error instanceof Error ? error.message : '';
      // Match TRUE FTS5 query-syntax error patterns only — never the
      // bare "fts5" keyword. Infrastructure failures like "no such
      // module: fts5" (extension not loaded) or "no such column:
      // fts5_rank" (schema drift) ALSO contain "fts5", so matching that
      // keyword would silently misclassify them as user-input errors.
      // Real syntax errors always contain one of the structural-error
      // keywords below or a "MATCH"-related token.
      const looksLikeFtsSyntax =
        /fts5: syntax error|syntax error near|unterminated|malformed (match|fts5)/i.test(msg) ||
        /MATCH/.test(msg);
      const isFtsSyntax = code === 'SQLITE_ERROR' && looksLikeFtsSyntax;
      if (isFtsSyntax) {
        throw new InvalidArgumentError(`searcher.ftsSearch: invalid FTS5 query — ${msg}`);
      }
      throw error;
    }

    return rows.map((row) => {
      const hit: { -readonly [K in keyof MessageHit]: MessageHit[K] } = {
        messageId: row.message_id,
        conversationId: row.conversation_id,
        score: bm25ToScore(row.bm25),
      };
      // FTS5's snippet() can return either '' (matched content too
      // short to span a snippet window) OR null (content-table shadow
      // desync — base-row content was deleted before snippet ran).
      // Treat both as "no snippet"; omit the field so callers can
      // rely on `hit.snippet ? renderSnippet(hit.snippet) : ...`.
      const rawSnippet: unknown = row.snippet;
      if (typeof rawSnippet === 'string' && rawSnippet !== '') {
        hit.snippet = rawSnippet;
      }
      return hit;
    });
  };

  // ---- sessionVectorSearch (sprint-016 Story 5 / spec-005 §16 P4-S4) -----
  //
  // KNN over vec_sessions (whole-conversation embeddings). Filter shape
  // is a subset of SearchFilters: projectId + conversationId? + dateFrom?
  // + dateTo?. Role does NOT apply (a session aggregates roles). The
  // candidate-set query reuses the same `ix_conversations_project_started`
  // index as vectorSearch's hot path.

  const sessionVectorSearch = async (
    query: string,
    filters: SearchFilters,
    limit: number,
  ): Promise<readonly SessionHit[]> => {
    if (typeof query !== 'string' || query.length === 0) {
      throw new InvalidArgumentError(
        'searcher.sessionVectorSearch: query must be a non-empty string',
      );
    }
    if (filters.projectId === '') {
      throw new InvalidArgumentError(
        'searcher.sessionVectorSearch: filters.projectId must be non-empty',
      );
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new InvalidArgumentError(
        `searcher.sessionVectorSearch: limit must be a positive integer, got ${String(limit)}`,
      );
    }
    if (limit > MAX_LIMIT) {
      throw new InvalidArgumentError(
        `searcher.sessionVectorSearch: limit must be <= ${MAX_LIMIT}, got ${limit}`,
      );
    }

    // Step 1 — narrow conversation candidates. Same shape as vectorSearch
    // but role filter is intentionally ignored (session-level granularity
    // doesn't decompose by role; documented on the Searcher interface).
    const { sql: candSql, params: candParams } = buildCandidateSql(filters);
    const candidateRows = db.prepare(candSql).all(...candParams) as { conversation_id: string }[];
    if (candidateRows.length === 0) return [];
    const candidateIds = candidateRows.map((r) => r.conversation_id);

    // Step 2 — embed the query (same lazy ordering as vectorSearch:
    // cheap candidate check first, expensive embed second).
    const queryVec = await embedder.embed(query);
    if (queryVec.length !== VEC_DIM) {
      throw new InvalidArgumentError(
        `searcher.sessionVectorSearch: embedder returned ${queryVec.length}-d vector, expected ${VEC_DIM}`,
      );
    }
    for (let i = 0; i < queryVec.length; i++) {
      if (Number.isNaN(queryVec[i])) {
        throw new InvalidArgumentError(
          'searcher.sessionVectorSearch: embedder returned vector containing NaN',
        );
      }
    }
    const queryFloat32 = new Float32Array(queryVec);
    const queryBuf = Buffer.from(
      queryFloat32.buffer,
      queryFloat32.byteOffset,
      queryFloat32.byteLength,
    );

    // Step 3 — vec0 KNN over vec_sessions. Same JSON-IN-list pattern as
    // vectorSearch to sidestep SQLite's 32766-bind-param limit.
    const candidateIdsJson = JSON.stringify(candidateIds);
    const knnRows = db
      .prepare(
        `
      SELECT conversation_id, distance
      FROM vec_sessions
      WHERE embedding MATCH ?
        AND k = ?
        AND conversation_id IN (SELECT value FROM json_each(?))
      ORDER BY distance
    `,
      )
      .all(queryBuf, limit, candidateIdsJson) as {
      conversation_id: string;
      distance: number;
    }[];

    return knnRows.map((row) => ({
      conversationId: row.conversation_id,
      score: distanceToScore(row.distance),
    }));
  };

  // ---- hybridSearch (sprint-016 Story 4 / spec-005 §16 P4-S3, extended
  // sprint-016 Story 5 / §16 P4-S4 to 3-source fan-out) --------------------
  //
  // Fans out vectorSearch + ftsSearch + sessionVectorSearch in parallel
  // via Promise.allSettled so a failure on one leg doesn't poison the
  // others. Maps each leg's hits into the unified HybridHit shape with
  // a stable id, then fuses via RRF (k=60). The id space is
  // heterogeneous on purpose:
  //   window:{conversationId}:{windowIndex}  — vectorSearch hits
  //   message:{messageId}                     — ftsSearch hits
  //   session:{conversationId}                — sessionVectorSearch hits
  // Disjoint prefixes guarantee no cross-kind collisions; a single
  // conversation can surface as a window AND a session simultaneously,
  // and RRF score-summing naturally promotes that consensus.

  const hybridIdOf = (hit: HybridHit): string => {
    if (hit.kind === 'window') {
      return `window:${hit.conversationId}:${hit.windowIndex}`;
    }
    if (hit.kind === 'message') {
      return `message:${hit.messageId}`;
    }
    return `session:${hit.conversationId}`;
  };

  const hybridSearch = async (
    query: string,
    filters: SearchFilters,
    limit: number,
  ): Promise<readonly HybridHit[]> => {
    if (typeof query !== 'string' || query.length === 0) {
      throw new InvalidArgumentError('searcher.hybridSearch: query must be a non-empty string');
    }
    if (filters.projectId === '') {
      throw new InvalidArgumentError('searcher.hybridSearch: filters.projectId must be non-empty');
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new InvalidArgumentError(
        `searcher.hybridSearch: limit must be a positive integer, got ${String(limit)}`,
      );
    }
    if (limit > MAX_LIMIT) {
      throw new InvalidArgumentError(
        `searcher.hybridSearch: limit must be <= ${MAX_LIMIT}, got ${limit}`,
      );
    }

    const overFetch = Math.min(limit * 2, MAX_LIMIT);

    // allSettled rather than all so a syntax error / outage on one leg
    // doesn't preempt the others. Three-source fan-out (sprint-016
    // Story 5): vector + FTS + session.
    const [vectorResult, ftsResult, sessionResult] = await Promise.allSettled([
      vectorSearch(query, filters, overFetch),
      ftsSearch(query, filters, overFetch),
      sessionVectorSearch(query, filters, overFetch),
    ]);

    if (
      vectorResult.status === 'rejected' &&
      ftsResult.status === 'rejected' &&
      sessionResult.status === 'rejected'
    ) {
      // All three failed: rethrow the vector error per the documented
      // contract (embedder failure is the higher-impact one for
      // operators). Promise.allSettled types `reason` as unknown —
      // normalize before rethrow so a non-Error rejection (e.g., a
      // string thrown by a buggy dependency) doesn't crash a downstream
      // `catch (e) { e.message }` consumer with "cannot read properties
      // of undefined". Wrapping non-Errors in InvalidArgumentError
      // preserves the contract (a downstream typed catch still works).
      const reason = vectorResult.reason;
      if (reason instanceof Error) throw reason;
      throw new InvalidArgumentError(
        `searcher.hybridSearch: vector leg rejected with non-Error value: ${String(reason)}`,
      );
    }

    const vectorHits: readonly WindowHit[] =
      vectorResult.status === 'fulfilled' ? vectorResult.value : [];
    const ftsHits: readonly MessageHit[] = ftsResult.status === 'fulfilled' ? ftsResult.value : [];
    const sessionHits: readonly SessionHit[] =
      sessionResult.status === 'fulfilled' ? sessionResult.value : [];

    // Lift each leg's hits into the HybridHit union with a tentative
    // per-leg source tag. The post-fusion pass below replaces it with
    // 'both' on the rare case where the same id surfaces from multiple
    // legs (with disjoint id-space prefixes today, that requires a
    // future change to id derivation — kept on the type for
    // forward-compat).
    const vectorAsHybrid: HybridHit[] = vectorHits.map((h) => ({
      kind: 'window' as const,
      conversationId: h.conversationId,
      windowIndex: h.windowIndex,
      messageIds: h.messageIds,
      score: h.score,
      source: 'vector' as const,
    }));
    const ftsAsHybrid: HybridHit[] = ftsHits.map((h) => {
      const base: {
        readonly kind: 'message';
        readonly messageId: number;
        readonly conversationId: string;
        readonly score: number;
        readonly source: HybridSource;
        snippet?: string;
      } = {
        kind: 'message',
        messageId: h.messageId,
        conversationId: h.conversationId,
        score: h.score,
        source: 'fts',
      };
      if (h.snippet !== undefined) base.snippet = h.snippet;
      return base;
    });
    const sessionAsHybrid: HybridHit[] = sessionHits.map((h) => ({
      kind: 'session' as const,
      conversationId: h.conversationId,
      score: h.score,
      source: 'session' as const,
    }));
    // Initial source tag matches the leg of origin so the intermediate
    // state is accurate (debuggers / logs reading sessionAsHybrid before
    // the post-fusion pass see the right value). The post-fusion pass
    // below replaces it with 'both' on the rare case where the same id
    // surfaces from multiple legs (with disjoint id-space prefixes
    // today, that requires a future change to id derivation — kept on
    // the type for forward-compat).

    // Build per-leg id sets so we can tag the post-fusion `source`
    // field accurately.
    const vectorIds = new Set(vectorAsHybrid.map(hybridIdOf));
    const ftsIds = new Set(ftsAsHybrid.map(hybridIdOf));
    const sessionIds = new Set(sessionAsHybrid.map(hybridIdOf));

    const fused = reciprocalRankFusion<HybridHit>(
      [vectorAsHybrid, ftsAsHybrid, sessionAsHybrid],
      hybridIdOf,
    );

    // Compute the fused-rank score per id. Same RRF formula the helper
    // uses internally; reuse RRF_DEFAULT_K so any future tune in
    // ranking.ts applies here too.
    const fusedScores = new Map<string, number>();
    for (const list of [vectorAsHybrid, ftsAsHybrid, sessionAsHybrid]) {
      for (let rank = 0; rank < list.length; rank++) {
        const id = hybridIdOf(list[rank]);
        fusedScores.set(id, (fusedScores.get(id) ?? 0) + 1 / (RRF_DEFAULT_K + rank + 1));
      }
    }

    return fused.slice(0, limit).map((hit) => {
      const id = hybridIdOf(hit);
      const inVector = vectorIds.has(id);
      const inFts = ftsIds.has(id);
      const inSession = sessionIds.has(id);
      const sourceCount = (inVector ? 1 : 0) + (inFts ? 1 : 0) + (inSession ? 1 : 0);
      const source: HybridSource =
        sourceCount > 1 ? 'both' : inVector ? 'vector' : inSession ? 'session' : 'fts';
      const score = fusedScores.get(id) ?? 0;
      // Rebuild the hit with the post-fusion source + score. The
      // discriminator (`kind`) preserves the underlying payload shape.
      if (hit.kind === 'window') {
        return {
          kind: 'window',
          conversationId: hit.conversationId,
          windowIndex: hit.windowIndex,
          messageIds: hit.messageIds,
          score,
          source,
        };
      }
      if (hit.kind === 'session') {
        return {
          kind: 'session',
          conversationId: hit.conversationId,
          score,
          source,
        };
      }
      const out: HybridHit = {
        kind: 'message',
        messageId: hit.messageId,
        conversationId: hit.conversationId,
        score,
        source,
        ...(hit.snippet !== undefined ? { snippet: hit.snippet } : {}),
      };
      return out;
    });
  };

  // ---------------------------------------------------------------------------
  // searcher.sql — public read-only SQL primitive
  // ---------------------------------------------------------------------------

  // Defaults applied when SqlOpts fields are omitted. Held at the wiring
  // layer rather than in sql-backend.ts because they are public-surface
  // policy, not internal-backend invariants. Bounds-checking is delegated
  // to executeReadOnly's validateOpts (1 ≤ rowCap ≤ 10000;
  // 100 ≤ timeoutMs ≤ 10000).
  const SQL_DEFAULT_ROW_CAP = 1000;
  const SQL_DEFAULT_TIMEOUT_MS = 5000;

  // The sql-backend opens a fresh SQLITE_OPEN_READONLY connection per
  // executeReadOnly call against `db.name` (the writable connection's
  // file path). The factory itself is cheap; bound once per Searcher.
  const sqlBackend = createSqlBackend({ dbPath: db.name });

  const sql = async (rawSql: string, opts?: SqlOpts): Promise<readonly Row[]> => {
    // Reject in-memory DBs at the public surface. better-sqlite3's
    // `:memory:` databases are not shared across connections — opening a
    // second connection at `:memory:` produces a fresh empty DB rather
    // than sharing state with the writable connection. Without this
    // guard, every searcher.sql call would silently see an empty schema
    // and surface SQLite's "no such table" error from the public
    // view, which is far worse UX than an explicit rejection.
    if (db.name === ':memory:') {
      throw new InvalidArgumentError(
        'searcher.sql requires a file-backed DB; in-memory DBs cannot be opened read-only from a second connection',
      );
    }
    // Validate-then-execute. The parser is the privacy-boundary gate; the
    // read-only connection is defence-in-depth. Order is non-negotiable.
    validateSqlAccess(rawSql, DEFAULT_PUBLIC_VIEW_ALLOWLIST);
    return sqlBackend.executeReadOnly(rawSql, opts?.params ?? [], {
      rowCap: opts?.rowCap ?? SQL_DEFAULT_ROW_CAP,
      timeoutMs: opts?.timeoutMs ?? SQL_DEFAULT_TIMEOUT_MS,
    });
  };

  return { vectorSearch, ftsSearch, hybridSearch, sessionVectorSearch, sql };
};
