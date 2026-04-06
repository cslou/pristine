import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Store } from '../../../core/interfaces.js';
import type {
  Memory,
  AddMemoryInput,
  UpdateMemoryInput,
  SearchParams,
  SupersedeMemoryResult,
} from '../../../core/types.js';
import { AppError } from '../../../core/errors.js';

const EMBEDDING_DIM = 768;

interface MemoryRow {
  id: string;
  user_id: string;
  text: string;
  embedding: string | null;
  content_hash: string;
  created_at: string;
  updated_at: string;
  last_accessed: string;
  source_conversation_id: string | null;
  metadata: string;
  is_deleted: number;
  valid_from: string | null;
  valid_until: string | null;
  superseded_by: string | null;
  supersedes: string | null;
  supersession_reason: string | null;
  rowid?: number;
}

const STORE_DDL = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  last_accessed TEXT DEFAULT (datetime('now')),
  source_conversation_id TEXT,
  metadata TEXT DEFAULT '{}',
  is_deleted INTEGER DEFAULT 0,
  valid_from TEXT,
  valid_until TEXT,
  superseded_by TEXT,
  supersedes TEXT,
  supersession_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_user_content_hash
  ON memories(user_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors
  USING vec0(embedding float[768]);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
  USING fts5(text, content=memories, content_rowid=rowid);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
END;
`;

const parseEmbedding = (raw: string | null): number[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as number[]) : [];
  } catch {
    return [];
  }
};

const parseMetadata = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const mapRow = (row: MemoryRow): Memory => ({
  id: row.id,
  userId: row.user_id,
  text: row.text,
  embedding: parseEmbedding(row.embedding),
  contentHash: row.content_hash,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastAccessed: row.last_accessed,
  sourceConversationId: row.source_conversation_id ?? undefined,
  metadata: parseMetadata(row.metadata),
  isDeleted: row.is_deleted === 1,
  validFrom: row.valid_from ?? undefined,
  validUntil: row.valid_until ?? undefined,
  supersededBy: row.superseded_by ?? undefined,
  supersedes: row.supersedes ?? undefined,
  supersessionReason: row.supersession_reason ?? undefined,
});

export function initStoreTables(db: Database.Database): void {
  db.exec(STORE_DDL);
}

export class SqliteStore implements Store {
  private readonly db: Database.Database;

  public constructor(db: Database.Database) {
    this.db = db;
    initStoreTables(db);
  }

  public async addMemory(input: AddMemoryInput): Promise<Memory> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const embeddingJson = JSON.stringify(input.embedding);
    const metadataJson = JSON.stringify(input.metadata ?? {});

    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO memories (
          id, user_id, text, embedding, content_hash, created_at, updated_at,
          last_accessed, source_conversation_id, metadata, valid_from, valid_until
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.text,
        embeddingJson,
        input.contentHash,
        now,
        now,
        now,
        input.sourceConversationId ?? null,
        metadataJson,
        input.validFrom ?? null,
        input.validUntil ?? null,
      );

    if (result.changes === 0) {
      const existing = this.db
        .prepare(
          'SELECT *, rowid FROM memories WHERE user_id = ? AND content_hash = ? AND is_deleted = 0',
        )
        .get(input.userId, input.contentHash) as MemoryRow | undefined;

      if (existing) {
        return mapRow(existing);
      }
      throw new AppError('Content hash conflict but existing memory not found.');
    }

    const row = this.db.prepare('SELECT *, rowid FROM memories WHERE id = ?').get(id) as MemoryRow;

    if (input.embedding.length === EMBEDDING_DIM && row.rowid !== undefined) {
      this.db
        .prepare('INSERT INTO memory_vectors (rowid, embedding) VALUES (?, ?)')
        .run(row.rowid, embeddingJson);
    }

    return mapRow(row);
  }

  public async getMemory(id: string, userId: string): Promise<Memory | null> {
    const row = this.db
      .prepare('SELECT *, rowid FROM memories WHERE id = ? AND user_id = ? AND is_deleted = 0')
      .get(id, userId) as MemoryRow | undefined;

    if (!row) return null;

    this.db
      .prepare('UPDATE memories SET last_accessed = ? WHERE id = ?')
      .run(new Date().toISOString(), id);

    return mapRow(row);
  }

  public async updateMemory(
    id: string,
    updates: UpdateMemoryInput,
    userId: string,
  ): Promise<Memory> {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.text !== undefined) {
      setClauses.push('text = ?');
      values.push(updates.text);
    }
    if (updates.embedding !== undefined) {
      setClauses.push('embedding = ?');
      values.push(JSON.stringify(updates.embedding));
    }
    if (updates.contentHash !== undefined) {
      setClauses.push('content_hash = ?');
      values.push(updates.contentHash);
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }
    if (updates.validFrom !== undefined) {
      setClauses.push('valid_from = ?');
      values.push(updates.validFrom);
    }
    if (updates.validUntil !== undefined) {
      setClauses.push('valid_until = ?');
      values.push(updates.validUntil);
    }

    const now = new Date().toISOString();
    setClauses.push('updated_at = ?');
    values.push(now);

    values.push(id, userId);

    this.db
      .prepare(`UPDATE memories SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...values);

    if (updates.embedding !== undefined) {
      const row = this.db.prepare('SELECT rowid FROM memories WHERE id = ?').get(id) as
        | { rowid: number }
        | undefined;
      if (row) {
        this.db.prepare('DELETE FROM memory_vectors WHERE rowid = ?').run(row.rowid);
        if (updates.embedding.length === EMBEDDING_DIM) {
          this.db
            .prepare('INSERT INTO memory_vectors (rowid, embedding) VALUES (?, ?)')
            .run(row.rowid, JSON.stringify(updates.embedding));
        }
      }
    }

    const updated = this.db
      .prepare('SELECT *, rowid FROM memories WHERE id = ? AND user_id = ?')
      .get(id, userId) as MemoryRow | undefined;

    if (!updated) {
      throw new AppError(`Memory ${id} not found after update.`);
    }

    return mapRow(updated);
  }

  public async deleteMemory(id: string, userId: string): Promise<void> {
    this.db
      .prepare('UPDATE memories SET is_deleted = 1, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(new Date().toISOString(), id, userId);
  }

  public async clearAll(userId?: string): Promise<void> {
    if (userId) {
      const rows = this.db.prepare('SELECT rowid FROM memories WHERE user_id = ?').all(userId) as {
        rowid: number;
      }[];
      for (const row of rows) {
        this.db.prepare('DELETE FROM memory_vectors WHERE rowid = ?').run(row.rowid);
      }
      this.db.prepare('DELETE FROM memories WHERE user_id = ?').run(userId);
    } else {
      this.db.prepare('DELETE FROM memory_vectors').run();
      this.db.prepare('DELETE FROM memories').run();
    }
  }

  public async searchSimilar(_params: SearchParams): Promise<Memory[]> {
    throw new AppError('searchSimilar not implemented yet — see Story 5.');
  }

  public async supersedeMemory(
    _oldId: string,
    _newMemory: AddMemoryInput,
    _reason: string,
    _validUntil?: string,
  ): Promise<SupersedeMemoryResult> {
    throw new AppError('supersedeMemory not implemented yet — see Story 5.');
  }

  public async getSupersessionChain(_memoryId: string, _userId: string): Promise<Memory[]> {
    throw new AppError('getSupersessionChain not implemented yet — see Story 5.');
  }
}

export const createSqliteStore = (db: Database.Database): SqliteStore => new SqliteStore(db);
