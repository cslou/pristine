import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { ConversationNotFoundError, InvalidArgumentError } from '../core/errors.js';
import type { ConversationSearchResult } from '../core/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StoredConversation {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly messageCount: number;
  readonly messages: readonly StoredMessage[];
}

export interface StoredMessage {
  readonly role: string;
  readonly content: string;
  readonly timestamp?: string;
  readonly sortOrder: number;
}

// ConversationSearchResult lives in core/types.ts — re-exported from here so
// external consumers of this module keep a stable import path.
export type { ConversationSearchResult } from '../core/types.js';

export interface ConversationSearchParams {
  readonly userId: string;
  readonly keyword?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly limit?: number;
}

export interface StoredSummary {
  readonly id: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly text: string;
  readonly timestamp: number;
  readonly metadata?: string;
}

// ---------------------------------------------------------------------------
// Internal row types (snake_case matching DB columns)
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: string;
  user_id: string;
  content_hash: string;
  created_at: string;
  message_count: number;
}

interface MessageRow {
  id: number;
  conversation_id: string;
  role: string;
  content: string;
  timestamp: string | null;
  sort_order: number;
}

interface SearchRow {
  id: string;
  user_id: string;
  created_at: string;
  message_count: number;
  snippet: string;
}

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

const CONVERSATION_STORE_DDL = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  message_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_user_content_hash
  ON conversations(user_id, content_hash);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT,
  sort_order INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
  USING fts5(content, content=messages, content_rowid=rowid);

CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`;

// Spec-005 §12 indexes — runs after ADD COLUMN steps so project_id and
// parent_message_id exist when the partial + parent indexes reference them.
const SPRINT_014_INDEXES_DDL = `
CREATE INDEX IF NOT EXISTS ix_conversations_project_started
  ON conversations(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_messages_conv_sort
  ON messages(conversation_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_messages_timestamp_nonchunk
  ON messages(timestamp DESC) WHERE parent_message_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_messages_parent
  ON messages(parent_message_id);
`;

// Spec-005 §12 vec_windows — sliding-window primary semantic index. vec0 stores
// 768-d Nomic Embed v1.5 vectors keyed by (conversation_id, window_index). The
// `float[768]` is the sqlite-vec typed-column syntax; vec0 handles the BLOB
// representation internally. Requires sqlite-vec loaded on the connection.
//
// **Write idiom note**: vec0 does NOT support INSERT OR REPLACE — duplicate
// inserts on the composite key just add a second row (this table has no
// declared PK), and on vec_sessions' PK it throws UNIQUE constraint failed.
// The indexer's "replace" primitive is DELETE + INSERT inside a transaction.
// Contract pinned by the PK-rejection test in store.test.ts.
//
// **CREATE inside transaction**: `CREATE VIRTUAL TABLE IF NOT EXISTS` inside
// db.transaction() is not guaranteed to roll back cleanly on transaction
// abort in standard SQLite; the IF NOT EXISTS guard makes a subsequent
// re-run idempotent on the success path, which is what we rely on.
const SPRINT_014_VEC_WINDOWS_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_windows USING vec0(
  conversation_id TEXT,
  window_index INTEGER,
  embedding float[768]
);
`;

// Spec-005 §12 window_messages — join table resolving the messages that
// comprise each window. Composite PK mirrors the vec_windows key +
// message_id, so the same (conversation_id, window_index) pair in both
// tables is the indexer's atomic write unit. message_id is INTEGER to
// match the current messages.id type (see sprint-014 Known Deviation #1
// and GH issue #106 for the future TEXT UUID migration).
//
// ix_window_messages_message_id supports Phase-4 reverse lookups (window
// hits resolve to constituent message_ids) without a full scan of
// window_messages. Spec §12's index list omits this, but the Phase-4
// join pattern makes it load-bearing at scale.
const SPRINT_014_WINDOW_MESSAGES_DDL = `
CREATE TABLE IF NOT EXISTS window_messages (
  conversation_id TEXT NOT NULL,
  window_index INTEGER NOT NULL,
  message_id INTEGER NOT NULL REFERENCES messages(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, window_index, message_id)
);
CREATE INDEX IF NOT EXISTS ix_window_messages_message_id
  ON window_messages(message_id);
`;

// Spec-005 §12 vec_sessions — whole-conversation secondary semantic index.
// One vector per conversation (keyed by conversation_id, PRIMARY KEY), used
// by Phase-4 hybrid retrieval as a coarse-grained vector source alongside
// vec_windows. No project_id column per spec §12 — Phase-4 filters sessions
// via a pre-query join on conversations.project_id.
// `+updated_at INTEGER` uses the vec0 auxiliary-column syntax (`+` prefix).
// vec0 does not accept NOT NULL / CHECK / DEFAULT on auxiliary columns at
// DDL — the non-null invariant is enforced at the write-helper layer in
// sprint-015.
//
// Same INSERT OR REPLACE caveat as vec_windows: duplicate PK inserts throw
// UNIQUE constraint failed; use DELETE + INSERT for the replace idiom.
const SPRINT_014_VEC_SESSIONS_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_sessions USING vec0(
  conversation_id TEXT PRIMARY KEY,
  embedding float[768],
  +updated_at INTEGER
);
`;

// Spec-005 §12 messages_public — read-only view exposing the Phase-5 SQL
// primitive's safe message surface. Aliases internal column names the spec
// exposes to consumers (sort_order → turn_index) and casts TEXT timestamps
// to unix milliseconds so Phase-4 integer-ms range filters work. Excludes
// parent_message_id — oversize-chunk linkage is an internal concern the
// SQL-primitive consumer should never see. The explicit column list in
// the VIEW declaration pins the surface contract; adding a column to the
// SELECT without also listing it in the view's declared columns raises a
// DDL error, so the view can't accidentally leak new columns.
//
// **timestamp nullability.** The underlying messages.timestamp column is
// nullable TEXT (Sprint-009 shape; addConversation without per-message
// timestamps inserts NULL). `strftime('%s', NULL)` returns NULL, so the
// view's timestamp column passes NULL through for those rows. Consumers
// doing time-range filters must handle NULL (e.g. `WHERE timestamp IS NOT
// NULL AND timestamp > ?`) — coercing to 0 / epoch would lie about data
// availability. Pinned by the NULL-passthrough test in store.test.ts.
//
// **Index pushdown.** The CAST(strftime(...)) expression blocks use of
// ix_messages_timestamp_nonchunk through the view — SQLite can't see
// through the cast to the base column. Consumers issuing time-range
// queries should filter against the base messages table (using the
// index-friendly raw column) and join back to messages_public only for
// the aliased surface. Same caveat applies to conversations_public
// .started_at vs. ix_conversations_project_started.
const SPRINT_014_VIEW_MESSAGES_PUBLIC_DDL = `
CREATE VIEW IF NOT EXISTS messages_public
  (id, conversation_id, turn_index, role, content, timestamp, project_id) AS
  SELECT id,
         conversation_id,
         sort_order AS turn_index,
         role,
         content,
         CAST(strftime('%s', timestamp) * 1000 AS INTEGER) AS timestamp,
         project_id
    FROM messages;
`;

// Spec-005 §12 conversations_public — read-only public view. Same pattern
// as messages_public: alias + cast + exclude. created_at (TEXT ISO from
// datetime('now')) casts to unix milliseconds as started_at (spec §12
// name). Excludes user_id, content_hash, message_count — all internal
// implementation details the Phase-5 SQL-primitive consumer should not
// see. project_id IS exposed — consumers need it for project-scoped
// retrieval.
const SPRINT_014_VIEW_CONVERSATIONS_PUBLIC_DDL = `
CREATE VIEW IF NOT EXISTS conversations_public (id, project_id, started_at) AS
  SELECT id,
         project_id,
         CAST(strftime('%s', created_at) * 1000 AS INTEGER) AS started_at
    FROM conversations;
`;

// Spec-005 §12 summaries — scratch-pad table for Phase-5 reference summaries
// injected into the retrieval context. No FK to conversations intentional:
// session_id is a harness-provided opaque string; multiple conversations may
// share a session (session lifetime is harness-scoped, not corpus-scoped).
// `metadata` holds optional caller-provided JSON-encoded state. Per spec §12
// the column list is (id TEXT PK, session_id TEXT NOT NULL, project_id TEXT
// NOT NULL, text TEXT NOT NULL, timestamp INTEGER NOT NULL, metadata TEXT).
// ix_summaries_project_time covers the recency query pattern getRecentSummaries
// uses — filter by project_id + order by timestamp DESC.
const SPRINT_014_SUMMARIES_DDL = `
CREATE TABLE IF NOT EXISTS summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS ix_summaries_project_time
  ON summaries(project_id, timestamp DESC);
`;

// Spec-005 §12 summaries_public — read-only public view. Excludes the
// metadata column (private caller-state) per spec §12 privacy invariant;
// exposes everything else verbatim. No CAST needed — summaries.timestamp
// is already stored as INTEGER unix ms (unlike messages.timestamp which
// was TEXT from Sprint-009).
const SPRINT_014_VIEW_SUMMARIES_PUBLIC_DDL = `
CREATE VIEW IF NOT EXISTS summaries_public (id, session_id, project_id, text, timestamp) AS
  SELECT id, session_id, project_id, text, timestamp FROM summaries;
`;

// ---------------------------------------------------------------------------
// Table initialization
// ---------------------------------------------------------------------------

interface TableInfoRow {
  readonly name: string;
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  ddl: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[];
  if (columns.some((row) => row.name === column)) {
    return;
  }
  db.exec(ddl);
}

// Schema version tracked via PRAGMA user_version. Bump when adding a new
// migration step; the initConversationTables gate only runs migration work
// when the stored version is below this constant. Exported so tests can pin
// the exact post-migration value without re-declaring the number.
// - 0 = Sprint-009 baseline (pre-sprint-014)
// - 1 = Sprint-014 Story 1 (project_id, parent_message_id, 4 spec-§12 indexes)
// - 2 = Sprint-014 Story 2 (vec_windows + window_messages + vec_sessions)
// - 3 = Sprint-014 Story 3 (messages_public + conversations_public views)
// - 4 = Sprint-014 Story 4 (summaries table + ix_summaries_project_time + summaries_public view + addMessage/addSummary/getRecentSummaries API)
export const SCHEMA_VERSION = 4;

export function initConversationTables(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  db.exec(CONVERSATION_STORE_DDL);

  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  if (currentVersion >= SCHEMA_VERSION) {
    return;
  }

  // Atomic forward migration. Each versioned block is gated on the stored
  // user_version so a DB that's already partway through (e.g. v1 → v2) only
  // applies the steps it's missing. The whole migration + user_version bump
  // commits as a single transaction; a crash leaves the DB at its prior
  // version with no recovery path needed.
  db.transaction(() => {
    if (currentVersion < 1) {
      addColumnIfMissing(
        db,
        'conversations',
        'project_id',
        "ALTER TABLE conversations ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'",
      );
      db.exec(
        "UPDATE conversations SET project_id = COALESCE(NULLIF(user_id, ''), 'default') WHERE project_id = 'default'",
      );

      addColumnIfMissing(
        db,
        'messages',
        'project_id',
        "ALTER TABLE messages ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'",
      );
      db.exec(
        `UPDATE messages
         SET project_id = COALESCE(
           (SELECT project_id FROM conversations WHERE conversations.id = messages.conversation_id),
           'default'
         )
         WHERE project_id = 'default'`,
      );

      addColumnIfMissing(
        db,
        'messages',
        'parent_message_id',
        'ALTER TABLE messages ADD COLUMN parent_message_id INTEGER',
      );

      db.exec(SPRINT_014_INDEXES_DDL);
    }

    if (currentVersion < 2) {
      db.exec(SPRINT_014_VEC_WINDOWS_DDL);
      db.exec(SPRINT_014_WINDOW_MESSAGES_DDL);
      db.exec(SPRINT_014_VEC_SESSIONS_DDL);
    }

    if (currentVersion < 3) {
      db.exec(SPRINT_014_VIEW_MESSAGES_PUBLIC_DDL);
      db.exec(SPRINT_014_VIEW_CONVERSATIONS_PUBLIC_DDL);
    }

    if (currentVersion < 4) {
      db.exec(SPRINT_014_SUMMARIES_DDL);
      db.exec(SPRINT_014_VIEW_SUMMARIES_PUBLIC_DDL);
    }

    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

const mapMessageRow = (row: MessageRow): StoredMessage => ({
  role: row.role,
  content: row.content,
  ...(row.timestamp !== null ? { timestamp: row.timestamp } : {}),
  sortOrder: row.sort_order,
});

const mapSearchRow = (row: SearchRow): ConversationSearchResult => ({
  id: row.id,
  userId: row.user_id,
  createdAt: row.created_at,
  messageCount: row.message_count,
  snippet: row.snippet,
});

// ---------------------------------------------------------------------------
// Default search limit
// ---------------------------------------------------------------------------

const DEFAULT_SEARCH_LIMIT = 20;

/**
 * Escape a keyword for safe use in FTS5 MATCH expressions.
 * Wraps each term in double quotes to prevent FTS5 syntax interpretation
 * (e.g. hyphens treated as NOT operators).
 */
const escapeFts5Query = (keyword: string): string => {
  return keyword
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(' ');
};

// ---------------------------------------------------------------------------
// ConversationStore
// ---------------------------------------------------------------------------

/**
 * Compute the canonical conversation content hash used by addConversation's
 * UNIQUE (user_id, content_hash) index. Exported so other modules can look up
 * a conversation by the same identity it was stored under without duplicating
 * the hashing logic.
 */
export function computeConversationContentHash(
  messages: readonly { readonly role: string; readonly content: string }[],
): string {
  return createHash('sha256')
    .update(messages.map((m, i) => `${i}:${m.role}:${m.content}`).join('\x00'))
    .digest('hex');
}

export class ConversationStore {
  private readonly db: Database.Database;

  public constructor(db: Database.Database) {
    this.db = db;
    initConversationTables(db);
  }

  /**
   * Store a conversation and its messages. Returns the conversation ID.
   *
   * **project_id derivation.** If `projectId` is omitted, it's derived from
   * `userId` using the same rule the migration back-fill applies:
   * `COALESCE(NULLIF(userId, ''), 'default')`. This keeps new writes
   * consistent with legacy back-filled rows. Callers with a distinct
   * project concept (e.g. multi-project-per-user harnesses) pass it
   * explicitly.
   *
   * Both the conversation row and every message row land with the same
   * `project_id`, so Phase-4's filter-first vector search can narrow
   * candidates without joining through conversations on every query.
   *
   * Throws on duplicate (user_id, content_hash) — callers should check for
   * `error.message.includes('UNIQUE constraint failed')` to detect duplicates.
   */
  public addConversation(
    messages: readonly {
      readonly role: string;
      readonly content: string;
      readonly timestamp?: string;
    }[],
    userId: string,
    projectId?: string,
  ): string {
    const id = randomUUID();
    const contentHash = computeConversationContentHash(messages);
    // Empty-string projectId is treated as "unset" (not as a valid value) so
    // the fallback-to-userId branch runs — `??` alone only short-circuits on
    // null/undefined and would let `''` through into the NOT NULL column.
    const explicitProject = projectId !== undefined && projectId !== '' ? projectId : undefined;
    const resolvedProjectId = explicitProject ?? (userId !== '' ? userId : 'default');

    const insertConversation = this.db.prepare(
      `INSERT INTO conversations (id, user_id, content_hash, message_count, project_id)
       VALUES (?, ?, ?, ?, ?)`,
    );

    const insertMessage = this.db.prepare(
      `INSERT INTO messages (conversation_id, role, content, timestamp, sort_order, project_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    const runTransaction = this.db.transaction(() => {
      insertConversation.run(id, userId, contentHash, messages.length, resolvedProjectId);
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        insertMessage.run(id, msg.role, msg.content, msg.timestamp ?? null, i, resolvedProjectId);
      }
    });

    runTransaction();
    return id;
  }

  /**
   * Append a single message to an existing conversation.
   *
   * **Atomic sort_order + message_count.** The method wraps three steps in
   * a single `db.transaction(...)`: (1) resolve the parent conversation +
   * its `project_id`, (2) compute `MAX(sort_order) + 1`, (3) insert the
   * message + bump `conversations.message_count` by 1. Concurrent appends
   * serialize at the SQLite level so the ordinal sequence stays gapless
   * and the counter stays accurate. Worker-thread concurrency arrives with
   * sprint-015's embed-worker; this contract is pinned now.
   *
   * **Project scope from parent.** `project_id` is read from the parent
   * conversation row, NOT supplied by the caller. This prevents cross-
   * project contamination that would be near-impossible to diagnose later.
   * If the conversation doesn't exist, throws `ConversationNotFoundError`
   * and nothing is written (transaction rolls back).
   *
   * `sort_order` is ordinal, not contiguous — deleting a message and later
   * appending yields `MAX(sort_order) + 1`, so gaps are allowed.
   *
   * Returns void to match the spec §5.1.1 primitive contract; callers that
   * need the inserted id should query by (conversationId, sort_order).
   */
  public addMessage(
    conversationId: string,
    message: {
      readonly role: string;
      readonly content: string;
      readonly timestamp?: string;
      readonly parentMessageId?: number;
    },
  ): void {
    const selectParent = this.db.prepare('SELECT project_id FROM conversations WHERE id = ?');
    const selectMaxSort = this.db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM messages WHERE conversation_id = ?',
    );
    const insertMessage = this.db.prepare(
      `INSERT INTO messages
         (conversation_id, role, content, timestamp, sort_order, project_id, parent_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const bumpMessageCount = this.db.prepare(
      'UPDATE conversations SET message_count = message_count + 1 WHERE id = ?',
    );

    const runTransaction = this.db.transaction(() => {
      const parent = selectParent.get(conversationId) as { project_id: string } | undefined;
      if (!parent) {
        throw new ConversationNotFoundError(`Conversation not found: ${conversationId}`);
      }
      const { next } = selectMaxSort.get(conversationId) as { next: number };
      insertMessage.run(
        conversationId,
        message.role,
        message.content,
        message.timestamp ?? null,
        next,
        parent.project_id,
        message.parentMessageId ?? null,
      );
      bumpMessageCount.run(conversationId);
    });

    runTransaction();
  }

  /**
   * Insert a reference summary into the summaries table. Returns the
   * generated id. Phase-5's summary-injection flow writes here after the
   * retrieval context is assembled.
   *
   * Unlike `addMessage`, `projectId` IS caller-supplied — summaries aren't
   * attached to a specific conversation, and session_id is a harness-
   * provided opaque string that may span multiple conversations.
   *
   * **Empty-text guard.** A summary with no text carries no retrieval
   * value; `text.trim().length === 0` throws `InvalidArgumentError` and
   * nothing is inserted. Callers get a targetable catch class rather than
   * discovering the empty row later in a query result.
   */
  public addSummary(params: {
    readonly sessionId: string;
    readonly projectId: string;
    readonly text: string;
    readonly timestamp: number;
    readonly metadata?: string;
  }): string {
    if (params.text.trim().length === 0) {
      throw new InvalidArgumentError('addSummary: text must not be empty or whitespace-only');
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO summaries (id, session_id, project_id, text, timestamp, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.sessionId,
        params.projectId,
        params.text,
        params.timestamp,
        params.metadata ?? null,
      );
    return id;
  }

  /**
   * Return the most recent summaries for a project, ordered by timestamp
   * DESC. Default limit of 10 keeps the caller's retrieval-context budget
   * bounded; callers that need more pass an explicit positive integer.
   *
   * Uses `ix_summaries_project_time (project_id, timestamp DESC)` — the
   * query plan is a covering index seek+scan, not a full-table sort.
   *
   * Throws `InvalidArgumentError` on `limit <= 0` — SQLite treats `LIMIT -1`
   * as "no limit" and `LIMIT 0` as "no rows", both surprising and silent
   * for callers passing an unvalidated variable.
   */
  public getRecentSummaries(projectId: string, limit = 10): readonly StoredSummary[] {
    if (limit <= 0) {
      throw new InvalidArgumentError(
        `getRecentSummaries: limit must be a positive integer (got ${limit})`,
      );
    }
    const rows = this.db
      .prepare(
        `SELECT id, session_id, project_id, text, timestamp, metadata
         FROM summaries
         WHERE project_id = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(projectId, limit) as {
      id: string;
      session_id: string;
      project_id: string;
      text: string;
      timestamp: number;
      metadata: string | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      projectId: row.project_id,
      text: row.text,
      timestamp: row.timestamp,
      ...(row.metadata !== null ? { metadata: row.metadata } : {}),
    }));
  }

  /**
   * Look up a conversation row by (userId, content_hash) using the same
   * hashing algorithm as addConversation. Returns the conversation id when
   * a row exists, or null otherwise. Used for partial-ingest recovery: the
   * caller can detect that a prior addConversation inserted the conversation
   * but a subsequent step (extract/embed/store) failed, and reset the row
   * to re-drive the pipeline cleanly.
   */
  public findByMessages(
    userId: string,
    messages: readonly { readonly role: string; readonly content: string }[],
  ): { readonly id: string } | null {
    const contentHash = computeConversationContentHash(messages);
    const row = this.db
      .prepare('SELECT id FROM conversations WHERE user_id = ? AND content_hash = ?')
      .get(userId, contentHash) as { id: string } | undefined;
    return row ? { id: row.id } : null;
  }

  /**
   * Delete a conversation and all its associated messages. FTS index entries
   * are removed automatically via the AFTER DELETE trigger on messages.
   * No-op if the conversation does not exist. Intended for partial-ingest
   * recovery — not a general delete-a-user-conversation API.
   */
  public deleteById(conversationId: string): void {
    const runTransaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
      this.db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
    });
    runTransaction();
  }

  /**
   * Retrieve a full conversation with ordered messages. Returns null if not found.
   */
  public getConversation(conversationId: string): StoredConversation | null {
    const conversationRow = this.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(conversationId) as ConversationRow | undefined;

    if (!conversationRow) {
      return null;
    }

    const messageRows = this.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC')
      .all(conversationId) as MessageRow[];

    return {
      id: conversationRow.id,
      userId: conversationRow.user_id,
      createdAt: conversationRow.created_at,
      messageCount: conversationRow.message_count,
      messages: messageRows.map(mapMessageRow),
    };
  }

  /**
   * Search conversations by keyword (FTS5), date range, and userId.
   * Returns matching conversations with FTS5 snippets when keyword is provided.
   */
  public searchConversations(params: ConversationSearchParams): ConversationSearchResult[] {
    const limit = params.limit ?? DEFAULT_SEARCH_LIMIT;

    if (params.keyword) {
      const ftsQuery = escapeFts5Query(params.keyword);
      if (ftsQuery.length > 0) {
        return this.searchWithKeyword(params, limit, ftsQuery);
      }
    }

    return this.searchWithoutKeyword(params, limit);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private searchWithKeyword(
    params: ConversationSearchParams,
    limit: number,
    ftsQuery: string,
  ): ConversationSearchResult[] {
    const dateConditions: string[] = [];
    const dateValues: (string | number)[] = [];

    if (params.dateFrom) {
      dateConditions.push('c.created_at >= ?');
      dateValues.push(params.dateFrom);
    }
    if (params.dateTo) {
      dateConditions.push('c.created_at <= ?');
      dateValues.push(params.dateTo);
    }

    const dateFilter = dateConditions.length > 0 ? ' AND ' + dateConditions.join(' AND ') : '';

    // Subquery finds the best matching message rowid per conversation,
    // then the outer query calls snippet() on that single row (no GROUP BY needed).
    const sql = `
      SELECT c.id, c.user_id, c.created_at, c.message_count,
             snippet(messages_fts, 0, '<b>', '</b>', '...', 64) AS snippet
      FROM messages_fts fts
      JOIN messages m ON m.rowid = fts.rowid
      JOIN conversations c ON c.id = m.conversation_id
      WHERE fts.rowid IN (
        SELECT MIN(fts2.rowid)
        FROM messages_fts fts2
        JOIN messages m2 ON m2.rowid = fts2.rowid
        JOIN conversations c2 ON c2.id = m2.conversation_id
        WHERE messages_fts MATCH ?
          AND c2.user_id = ?
          ${dateFilter}
        GROUP BY c2.id
      )
      AND messages_fts MATCH ?
      ORDER BY c.created_at DESC
      LIMIT ?
    `;

    const values: (string | number)[] = [ftsQuery, params.userId, ...dateValues, ftsQuery, limit];

    const rows = this.db.prepare(sql).all(...values) as SearchRow[];
    return rows.map(mapSearchRow);
  }

  private searchWithoutKeyword(
    params: ConversationSearchParams,
    limit: number,
  ): ConversationSearchResult[] {
    const conditions: string[] = ['c.user_id = ?'];
    const values: (string | number)[] = [params.userId];

    if (params.dateFrom) {
      conditions.push('c.created_at >= ?');
      values.push(params.dateFrom);
    }
    if (params.dateTo) {
      conditions.push('c.created_at <= ?');
      values.push(params.dateTo);
    }

    values.push(limit);

    const sql = `
      SELECT c.id, c.user_id, c.created_at, c.message_count, '' AS snippet
      FROM conversations c
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.created_at DESC
      LIMIT ?
    `;

    const rows = this.db.prepare(sql).all(...values) as SearchRow[];
    return rows.map(mapSearchRow);
  }
}
