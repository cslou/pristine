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
      // Check for active duplicate first
      const existing = this.db
        .prepare(
          'SELECT *, rowid FROM memories WHERE user_id = ? AND content_hash = ? AND is_deleted = 0',
        )
        .get(input.userId, input.contentHash) as MemoryRow | undefined;

      if (existing) {
        return mapRow(existing);
      }

      // Check for soft-deleted duplicate — un-delete and update it
      const deleted = this.db
        .prepare(
          'SELECT *, rowid FROM memories WHERE user_id = ? AND content_hash = ? AND is_deleted = 1',
        )
        .get(input.userId, input.contentHash) as MemoryRow | undefined;

      if (deleted) {
        this.db
          .prepare(
            `UPDATE memories SET is_deleted = 0, text = ?, embedding = ?, metadata = ?,
             updated_at = ?, last_accessed = ?, valid_from = ?, valid_until = ?,
             source_conversation_id = ? WHERE id = ?`,
          )
          .run(
            input.text,
            embeddingJson,
            metadataJson,
            now,
            now,
            input.validFrom ?? null,
            input.validUntil ?? null,
            input.sourceConversationId ?? null,
            deleted.id,
          );

        const restored = this.db
          .prepare('SELECT *, rowid FROM memories WHERE id = ?')
          .get(deleted.id) as MemoryRow;

        if (input.embedding.length === EMBEDDING_DIM && restored.rowid !== undefined) {
          this.db
            .prepare('DELETE FROM memory_vectors WHERE rowid = CAST(? AS INTEGER)')
            .run(restored.rowid);
          this.db
            .prepare('INSERT INTO memory_vectors (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)')
            .run(restored.rowid, embeddingJson);
        }

        return mapRow(restored);
      }

      throw new AppError('Content hash conflict but existing memory not found.');
    }

    const row = this.db.prepare('SELECT *, rowid FROM memories WHERE id = ?').get(id) as MemoryRow;

    if (input.embedding.length === EMBEDDING_DIM && row.rowid !== undefined) {
      this.db
        .prepare('INSERT INTO memory_vectors (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)')
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

    const updateResult = this.db
      .prepare(
        `UPDATE memories SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ? AND is_deleted = 0`,
      )
      .run(...values);

    const updated = this.db
      .prepare('SELECT *, rowid FROM memories WHERE id = ? AND user_id = ? AND is_deleted = 0')
      .get(id, userId) as MemoryRow | undefined;

    if (!updated || updateResult.changes === 0) {
      throw new AppError(`Memory ${id} not found or is deleted.`);
    }

    if (updates.embedding !== undefined && updated.rowid !== undefined) {
      this.db
        .prepare('DELETE FROM memory_vectors WHERE rowid = CAST(? AS INTEGER)')
        .run(updated.rowid);
      if (updates.embedding.length === EMBEDDING_DIM) {
        this.db
          .prepare('INSERT INTO memory_vectors (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)')
          .run(updated.rowid, JSON.stringify(updates.embedding));
      }
    }

    return mapRow(updated);
  }

  public async deleteMemory(id: string, userId: string): Promise<void> {
    const row = this.db
      .prepare('SELECT rowid FROM memories WHERE id = ? AND user_id = ?')
      .get(id, userId) as { rowid: number } | undefined;

    this.db
      .prepare('UPDATE memories SET is_deleted = 1, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(new Date().toISOString(), id, userId);

    if (row) {
      this.db.prepare('DELETE FROM memory_vectors WHERE rowid = CAST(? AS INTEGER)').run(row.rowid);
    }
  }

  public async clearAll(userId?: string): Promise<void> {
    if (userId) {
      const rows = this.db.prepare('SELECT rowid FROM memories WHERE user_id = ?').all(userId) as {
        rowid: number;
      }[];
      for (const row of rows) {
        this.db
          .prepare('DELETE FROM memory_vectors WHERE rowid = CAST(? AS INTEGER)')
          .run(row.rowid);
      }
      this.db.prepare('DELETE FROM memories WHERE user_id = ?').run(userId);
    } else {
      this.db.prepare('DELETE FROM memory_vectors').run();
      this.db.prepare('DELETE FROM memories').run();
    }
  }

  public async searchSimilar(params: SearchParams): Promise<Memory[]> {
    const mode = params.temporalMode ?? 'current';

    if (mode === 'as_of' && !params.asOf) {
      throw new AppError('searchSimilar as_of mode requires an asOf timestamp.');
    }

    if (mode === 'as_of' && Number.isNaN(Date.parse(params.asOf!))) {
      throw new AppError(`searchSimilar as_of received invalid asOf: "${params.asOf}".`);
    }

    // Step 1: Find nearest vectors via sqlite-vec
    const vectorRows = this.db
      .prepare(
        `SELECT rowid, distance
         FROM memory_vectors
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?`,
      )
      .all(JSON.stringify(params.embedding), params.limit * 3) as {
      rowid: number;
      distance: number;
    }[];

    if (vectorRows.length === 0) return [];

    // Step 2: Join with memories table, apply filters
    const rowids = vectorRows.map((r) => r.rowid);
    const distanceMap = new Map(vectorRows.map((r) => [r.rowid, r.distance]));
    const placeholders = rowids.map(() => '?').join(', ');

    let temporalClause = '';
    const filterValues: unknown[] = [...rowids, params.userId];

    if (mode === 'current') {
      temporalClause =
        " AND (m.valid_from IS NULL OR m.valid_from <= datetime('now')) AND (m.valid_until IS NULL)";
    } else if (mode === 'as_of') {
      temporalClause =
        ' AND (m.valid_from IS NULL OR m.valid_from <= ?) AND (m.valid_until IS NULL OR m.valid_until > ?)';
      filterValues.push(params.asOf, params.asOf);
    }

    const memoryRows = this.db
      .prepare(
        `SELECT m.*, m.rowid AS rowid FROM memories m
         WHERE m.rowid IN (${placeholders})
           AND m.user_id = ?
           AND m.is_deleted = 0${temporalClause}`,
      )
      .all(...filterValues) as MemoryRow[];

    // Step 3: Sort by vector distance and limit
    const sorted = memoryRows
      .map((row) => ({ row, distance: distanceMap.get(row.rowid!) ?? Infinity }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, params.limit);

    return sorted.map((s) => mapRow(s.row));
  }

  public async searchByKeyword(query: string, userId: string, limit: number): Promise<Memory[]> {
    const rows = this.db
      .prepare(
        `SELECT m.*, m.rowid AS rowid, fts.rank
         FROM memories_fts fts
         JOIN memories m ON m.rowid = fts.rowid
         WHERE memories_fts MATCH ?
           AND m.user_id = ?
           AND m.is_deleted = 0
           AND (m.valid_from IS NULL OR m.valid_from <= datetime('now'))
           AND m.valid_until IS NULL
         ORDER BY fts.rank
         LIMIT ?`,
      )
      .all(query, userId, limit) as (MemoryRow & { rank: number })[];

    return rows.map(mapRow);
  }

  public async supersedeMemory(
    oldId: string,
    newMemory: AddMemoryInput,
    reason: string,
    validUntil?: string,
  ): Promise<SupersedeMemoryResult> {
    const effectiveValidUntil = validUntil ?? new Date().toISOString();

    const doSupersede = this.db.transaction(() => {
      // Step 1: Verify old memory is eligible
      const oldRow = this.db
        .prepare(
          'SELECT *, rowid FROM memories WHERE id = ? AND is_deleted = 0 AND superseded_by IS NULL',
        )
        .get(oldId) as MemoryRow | undefined;

      if (!oldRow) {
        throw new AppError(`Memory ${oldId} not found, is deleted, or is already superseded.`);
      }

      if (oldRow.user_id !== newMemory.userId) {
        throw new AppError('Cannot supersede a memory belonging to a different user.');
      }

      // Step 2: Insert new memory with supersedes link
      const newId = randomUUID();
      const now = new Date().toISOString();
      const embeddingJson = JSON.stringify(newMemory.embedding);
      const metadataJson = JSON.stringify(newMemory.metadata ?? {});

      this.db
        .prepare(
          `INSERT INTO memories (
            id, user_id, text, embedding, content_hash, created_at, updated_at,
            last_accessed, source_conversation_id, metadata, valid_from, supersedes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          newId,
          newMemory.userId,
          newMemory.text,
          embeddingJson,
          newMemory.contentHash,
          now,
          now,
          now,
          newMemory.sourceConversationId ?? null,
          metadataJson,
          effectiveValidUntil,
          oldId,
        );

      const newRow = this.db
        .prepare('SELECT *, rowid FROM memories WHERE id = ?')
        .get(newId) as MemoryRow;

      if (newMemory.embedding.length === EMBEDDING_DIM && newRow.rowid !== undefined) {
        this.db
          .prepare('INSERT INTO memory_vectors (rowid, embedding) VALUES (CAST(? AS INTEGER), ?)')
          .run(newRow.rowid, embeddingJson);
      }

      // Step 3: Update old memory
      this.db
        .prepare(
          `UPDATE memories SET valid_until = ?, superseded_by = ?, supersession_reason = ?,
           updated_at = ? WHERE id = ?`,
        )
        .run(effectiveValidUntil, newId, reason, now, oldId);

      const updatedOldRow = this.db
        .prepare('SELECT *, rowid FROM memories WHERE id = ?')
        .get(oldId) as MemoryRow;

      return {
        oldMemory: mapRow(updatedOldRow),
        newMemory: mapRow(newRow),
      };
    });

    return doSupersede();
  }

  private static readonly MAX_CHAIN_DEPTH = 50;

  public async getSupersessionChain(memoryId: string, userId: string): Promise<Memory[]> {
    const target = this.fetchMemoryById(memoryId, userId);
    if (!target) return [];

    const visited = new Set<string>([target.id]);
    const chain: Memory[] = [target];
    const halfDepth = Math.floor(SqliteStore.MAX_CHAIN_DEPTH / 2);

    // Walk backward via supersedes to find the root
    let current = target;
    let backwardSteps = 0;
    while (current.supersedes && backwardSteps < halfDepth) {
      if (visited.has(current.supersedes)) break;
      const prev = this.fetchMemoryById(current.supersedes, userId);
      if (!prev) break;
      visited.add(prev.id);
      chain.unshift(prev);
      current = prev;
      backwardSteps++;
    }

    // Walk forward via supersededBy from the target
    current = target;
    let forwardSteps = 0;
    while (current.supersededBy && forwardSteps < halfDepth) {
      if (visited.has(current.supersededBy)) break;
      const next = this.fetchMemoryById(current.supersededBy, userId);
      if (!next) break;
      visited.add(next.id);
      chain.push(next);
      current = next;
      forwardSteps++;
    }

    return chain;
  }

  private fetchMemoryById(id: string, userId: string): Memory | null {
    const row = this.db
      .prepare('SELECT *, rowid FROM memories WHERE id = ? AND user_id = ?')
      .get(id, userId) as MemoryRow | undefined;
    return row ? mapRow(row) : null;
  }
}

export const createSqliteStore = (db: Database.Database): SqliteStore => new SqliteStore(db);
