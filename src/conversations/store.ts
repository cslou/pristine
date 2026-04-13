import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';

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

export interface ConversationSearchResult {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly messageCount: number;
  readonly snippet: string;
}

export interface ConversationSearchParams {
  readonly userId: string;
  readonly keyword?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly limit?: number;
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

// ---------------------------------------------------------------------------
// Table initialization
// ---------------------------------------------------------------------------

export function initConversationTables(db: Database.Database): void {
  db.exec(CONVERSATION_STORE_DDL);
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

// ---------------------------------------------------------------------------
// ConversationStore
// ---------------------------------------------------------------------------

export class ConversationStore {
  private readonly db: Database.Database;

  public constructor(db: Database.Database) {
    this.db = db;
    initConversationTables(db);
  }

  /**
   * Store a conversation and its messages. Returns the conversation ID.
   * Throws on duplicate (user_id, content_hash) — callers catch via isDuplicateKeyError.
   */
  public addConversation(
    messages: readonly { readonly role: string; readonly content: string; readonly timestamp?: string }[],
    userId: string,
  ): string {
    const id = randomUUID();
    const contentHash = createHash('sha256')
      .update(messages.map((m) => m.content).join('\n'))
      .digest('hex');

    const insertConversation = this.db.prepare(
      `INSERT INTO conversations (id, user_id, content_hash, message_count)
       VALUES (?, ?, ?, ?)`,
    );

    const insertMessage = this.db.prepare(
      `INSERT INTO messages (conversation_id, role, content, timestamp, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    );

    const runTransaction = this.db.transaction(() => {
      insertConversation.run(id, userId, contentHash, messages.length);
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        insertMessage.run(id, msg.role, msg.content, msg.timestamp ?? null, i);
      }
    });

    runTransaction();
    return id;
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
      return this.searchWithKeyword(params, limit);
    }

    return this.searchWithoutKeyword(params, limit);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private searchWithKeyword(
    params: ConversationSearchParams,
    limit: number,
  ): ConversationSearchResult[] {
    const conditions: string[] = [
      'messages_fts MATCH ?',
      'c.user_id = ?',
    ];
    const values: (string | number)[] = [params.keyword as string, params.userId];

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
      SELECT c.id, c.user_id, c.created_at, c.message_count,
             snippet(messages_fts, 0, '<b>', '</b>', '...', 64) AS snippet
      FROM messages_fts fts
      JOIN messages m ON m.rowid = fts.rowid
      JOIN conversations c ON c.id = m.conversation_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT ?
    `;

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
