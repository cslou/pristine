import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/core/database.js';
import { ConversationStore, SCHEMA_VERSION } from '../../src/conversations/store.js';
import { ConversationNotFoundError, InvalidArgumentError } from '../../src/core/errors.js';

let db: ReturnType<typeof createDatabase>;
let store: ConversationStore;

const makeMessages = (contents: string[]) =>
  contents.map((content, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content,
  }));

const contentHash = (messages: { role: string; content: string }[]): string =>
  createHash('sha256')
    .update(messages.map((m, i) => `${i}:${m.role}:${m.content}`).join('\x00'))
    .digest('hex');

beforeAll(() => {
  db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
  store = new ConversationStore(db);
});

beforeEach(() => {
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM conversations');
});

afterAll(() => {
  db.close();
});

describe('ConversationStore', () => {
  describe('addConversation', () => {
    it('stores and returns a conversation ID', () => {
      const messages = makeMessages(['Hello', 'Hi there']);
      const id = store.addConversation(messages, 'user-1');

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('derives project_id from userId by default (conversation + messages)', () => {
      const id = store.addConversation(makeMessages(['hi']), 'user-proj-default');

      const convRow = db.prepare('SELECT project_id FROM conversations WHERE id = ?').get(id) as {
        project_id: string;
      };
      expect(convRow.project_id).toBe('user-proj-default');

      const msgRow = db
        .prepare('SELECT project_id FROM messages WHERE conversation_id = ? LIMIT 1')
        .get(id) as { project_id: string };
      expect(msgRow.project_id).toBe('user-proj-default');
    });

    it('accepts an explicit projectId override (multi-project-per-user case)', () => {
      const id = store.addConversation(makeMessages(['hi']), 'user-multi', 'proj-beta');

      const row = db
        .prepare('SELECT user_id, project_id FROM conversations WHERE id = ?')
        .get(id) as { user_id: string; project_id: string };
      expect(row.user_id).toBe('user-multi');
      expect(row.project_id).toBe('proj-beta');

      const msgRow = db
        .prepare('SELECT project_id FROM messages WHERE conversation_id = ? LIMIT 1')
        .get(id) as { project_id: string };
      expect(msgRow.project_id).toBe('proj-beta');
    });

    it("falls back to 'default' project_id when userId is empty", () => {
      const id = store.addConversation(makeMessages(['hi']), '');

      const row = db.prepare('SELECT project_id FROM conversations WHERE id = ?').get(id) as {
        project_id: string;
      };
      expect(row.project_id).toBe('default');
    });

    it('stores messages with correct sort_order', () => {
      const messages = makeMessages(['First', 'Second', 'Third']);
      const id = store.addConversation(messages, 'user-1');

      const rows = db
        .prepare(
          'SELECT sort_order, content FROM messages WHERE conversation_id = ? ORDER BY sort_order',
        )
        .all(id) as { sort_order: number; content: string }[];

      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({ sort_order: 0, content: 'First' });
      expect(rows[1]).toMatchObject({ sort_order: 1, content: 'Second' });
      expect(rows[2]).toMatchObject({ sort_order: 2, content: 'Third' });
    });

    it('computes content_hash from role, index, and content', () => {
      const messages = makeMessages(['Hello world', 'Goodbye world']);
      const id = store.addConversation(messages, 'user-1');

      const row = db.prepare('SELECT content_hash FROM conversations WHERE id = ?').get(id) as {
        content_hash: string;
      };

      expect(row.content_hash).toBe(contentHash(messages));
    });

    it('stores message_count correctly', () => {
      const messages = makeMessages(['a', 'b', 'c', 'd']);
      const id = store.addConversation(messages, 'user-1');

      const row = db.prepare('SELECT message_count FROM conversations WHERE id = ?').get(id) as {
        message_count: number;
      };

      expect(row.message_count).toBe(4);
    });

    it('throws on duplicate content_hash for same userId', () => {
      const messages = makeMessages(['Hello', 'World']);
      store.addConversation(messages, 'user-1');

      expect(() => store.addConversation(messages, 'user-1')).toThrow('UNIQUE constraint failed');
    });

    it('allows same content_hash for different userIds', () => {
      const messages = makeMessages(['Hello', 'World']);
      const id1 = store.addConversation(messages, 'user-1');
      const id2 = store.addConversation(messages, 'user-2');

      expect(id1).not.toBe(id2);
    });

    it('stores message timestamps when provided', () => {
      const timestamp = '2026-04-13T10:00:00.000Z';
      const messages = [
        { role: 'user', content: 'Hello', timestamp },
        { role: 'assistant', content: 'Hi' },
      ];
      const id = store.addConversation(messages, 'user-1');

      const rows = db
        .prepare('SELECT timestamp FROM messages WHERE conversation_id = ? ORDER BY sort_order')
        .all(id) as { timestamp: string | null }[];

      expect(rows[0].timestamp).toBe(timestamp);
      expect(rows[1].timestamp).toBeNull();
    });
  });

  describe('getConversation', () => {
    it('returns full conversation with ordered messages', () => {
      const messages = makeMessages(['Hello', 'Hi there', 'How are you?']);
      const id = store.addConversation(messages, 'user-1');

      const result = store.getConversation(id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(id);
      expect(result?.userId).toBe('user-1');
      expect(result?.messageCount).toBe(3);
      expect(result?.messages).toHaveLength(3);
      expect(result?.messages[0]).toMatchObject({
        role: 'user',
        content: 'Hello',
        sortOrder: 0,
      });
      expect(result?.messages[1]).toMatchObject({
        role: 'assistant',
        content: 'Hi there',
        sortOrder: 1,
      });
      expect(result?.messages[2]).toMatchObject({
        role: 'user',
        content: 'How are you?',
        sortOrder: 2,
      });
    });

    it('returns null for nonexistent conversationId', () => {
      const result = store.getConversation('nonexistent-id');
      expect(result).toBeNull();
    });

    it('includes createdAt timestamp', () => {
      const id = store.addConversation(makeMessages(['test']), 'user-1');
      const result = store.getConversation(id);

      expect(result?.createdAt).toBeDefined();
      expect(typeof result?.createdAt).toBe('string');
    });

    it('omits timestamp field on messages without timestamps', () => {
      const messages = makeMessages(['Hello']);
      const id = store.addConversation(messages, 'user-1');
      const result = store.getConversation(id);

      expect(result?.messages[0]).not.toHaveProperty('timestamp');
    });
  });

  describe('searchConversations', () => {
    it('finds conversations by keyword via FTS5', () => {
      store.addConversation(makeMessages(['I love espresso coffee']), 'user-1');
      store.addConversation(makeMessages(['I went hiking yesterday']), 'user-1');

      const results = store.searchConversations({ userId: 'user-1', keyword: 'espresso' });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBeDefined();
    });

    it('returns snippet with keyword highlighted', () => {
      store.addConversation(makeMessages(['I love espresso coffee in the morning']), 'user-1');

      const results = store.searchConversations({ userId: 'user-1', keyword: 'espresso' });

      expect(results).toHaveLength(1);
      expect(results[0].snippet).toContain('<b>espresso</b>');
    });

    it('filters by dateFrom', () => {
      const oldId = store.addConversation(makeMessages(['old conversation']), 'user-1');
      const newId = store.addConversation(makeMessages(['new conversation']), 'user-1');

      // Manually set created_at to control dates
      db.prepare("UPDATE conversations SET created_at = '2026-01-01 00:00:00' WHERE id = ?").run(
        oldId,
      );
      db.prepare("UPDATE conversations SET created_at = '2026-06-01 00:00:00' WHERE id = ?").run(
        newId,
      );

      const results = store.searchConversations({
        userId: 'user-1',
        dateFrom: '2026-03-01',
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(newId);
    });

    it('filters by dateTo', () => {
      const oldId = store.addConversation(makeMessages(['old conversation']), 'user-1');
      const newId = store.addConversation(makeMessages(['new conversation']), 'user-1');

      db.prepare("UPDATE conversations SET created_at = '2026-01-01 00:00:00' WHERE id = ?").run(
        oldId,
      );
      db.prepare("UPDATE conversations SET created_at = '2026-06-01 00:00:00' WHERE id = ?").run(
        newId,
      );

      const results = store.searchConversations({
        userId: 'user-1',
        dateTo: '2026-03-01',
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(oldId);
    });

    it('filters by dateFrom and dateTo combined', () => {
      const earlyId = store.addConversation(makeMessages(['early conversation']), 'user-1');
      const middleId = store.addConversation(makeMessages(['middle conversation']), 'user-1');
      const lateId = store.addConversation(makeMessages(['late conversation']), 'user-1');

      db.prepare("UPDATE conversations SET created_at = '2026-01-01 00:00:00' WHERE id = ?").run(
        earlyId,
      );
      db.prepare("UPDATE conversations SET created_at = '2026-06-01 00:00:00' WHERE id = ?").run(
        middleId,
      );
      db.prepare("UPDATE conversations SET created_at = '2026-12-01 00:00:00' WHERE id = ?").run(
        lateId,
      );

      const results = store.searchConversations({
        userId: 'user-1',
        dateFrom: '2026-03-01',
        dateTo: '2026-09-01',
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(middleId);
    });

    it('filters by userId', () => {
      store.addConversation(makeMessages(['user 1 conversation']), 'user-1');
      store.addConversation(makeMessages(['user 2 conversation']), 'user-2');

      const results = store.searchConversations({ userId: 'user-1' });

      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe('user-1');
    });

    it('returns empty array when no matches', () => {
      store.addConversation(makeMessages(['Hello world']), 'user-1');

      const results = store.searchConversations({
        userId: 'user-1',
        keyword: 'zyxnonexistent',
      });

      expect(results).toHaveLength(0);
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        store.addConversation(makeMessages([`conversation ${i} about testing`]), 'user-1');
      }

      const results = store.searchConversations({
        userId: 'user-1',
        keyword: 'testing',
        limit: 2,
      });

      expect(results).toHaveLength(2);
    });

    it('returns results ordered by created_at DESC', () => {
      const id1 = store.addConversation(makeMessages(['first topic']), 'user-1');
      const id2 = store.addConversation(makeMessages(['second topic']), 'user-1');
      const id3 = store.addConversation(makeMessages(['third topic']), 'user-1');

      db.prepare("UPDATE conversations SET created_at = '2026-01-01 00:00:00' WHERE id = ?").run(
        id1,
      );
      db.prepare("UPDATE conversations SET created_at = '2026-06-01 00:00:00' WHERE id = ?").run(
        id2,
      );
      db.prepare("UPDATE conversations SET created_at = '2026-12-01 00:00:00' WHERE id = ?").run(
        id3,
      );

      const results = store.searchConversations({ userId: 'user-1' });

      expect(results).toHaveLength(3);
      expect(results[0].id).toBe(id3);
      expect(results[1].id).toBe(id2);
      expect(results[2].id).toBe(id1);
    });

    it('returns all conversations for userId when no keyword', () => {
      store.addConversation(makeMessages(['Hello']), 'user-1');
      store.addConversation(makeMessages(['World']), 'user-1');
      store.addConversation(makeMessages(['Other user']), 'user-2');

      const results = store.searchConversations({ userId: 'user-1' });

      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.userId).toBe('user-1'));
    });

    it('groups by conversation when multiple messages match keyword', () => {
      store.addConversation(
        makeMessages(['I love coffee in the morning', 'Coffee is great', 'More coffee please']),
        'user-1',
      );

      const results = store.searchConversations({
        userId: 'user-1',
        keyword: 'coffee',
      });

      expect(results).toHaveLength(1);
    });

    it('treats whitespace-only keyword as no keyword', () => {
      store.addConversation(makeMessages(['Hello world']), 'user-1');
      store.addConversation(makeMessages(['Goodbye world']), 'user-1');

      const results = store.searchConversations({ userId: 'user-1', keyword: '   ' });

      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.snippet).toBe(''));
    });

    it('returns empty snippet when searching without keyword', () => {
      store.addConversation(makeMessages(['Hello']), 'user-1');

      const results = store.searchConversations({ userId: 'user-1' });

      expect(results).toHaveLength(1);
      expect(results[0].snippet).toBe('');
    });
  });

  describe('DDL idempotency', () => {
    it('constructing a second ConversationStore on same db does not throw', () => {
      expect(() => new ConversationStore(db)).not.toThrow();
    });
  });

  describe('findByMessages', () => {
    it('returns the stored conversation id when (userId, messages) matches', () => {
      const messages = makeMessages(['Hi', 'Hello']);
      const id = store.addConversation(messages, 'user-1');

      const found = store.findByMessages('user-1', messages);
      expect(found).toEqual({ id });
    });

    it('returns null when no conversation matches the hash', () => {
      store.addConversation(makeMessages(['Hi']), 'user-1');
      const found = store.findByMessages('user-1', makeMessages(['Different']));
      expect(found).toBeNull();
    });

    it('is scoped by userId — same hash under different user returns null', () => {
      const messages = makeMessages(['Hi']);
      store.addConversation(messages, 'user-1');
      const found = store.findByMessages('user-2', messages);
      expect(found).toBeNull();
    });

    it('computes the same hash as addConversation', () => {
      const messages = makeMessages(['unique-content-abc', 'reply-xyz']);
      const insertedId = store.addConversation(messages, 'user-hash');
      const expectedHash = contentHash(messages);

      const row = db
        .prepare('SELECT content_hash FROM conversations WHERE id = ?')
        .get(insertedId) as { content_hash: string };
      expect(row.content_hash).toBe(expectedHash);

      const found = store.findByMessages('user-hash', messages);
      expect(found?.id).toBe(insertedId);
    });
  });

  describe('deleteById', () => {
    it('removes the conversation row and its messages', () => {
      const messages = makeMessages(['Hi', 'Hello', 'Bye']);
      const id = store.addConversation(messages, 'user-1');

      store.deleteById(id);

      expect(store.getConversation(id)).toBeNull();
      const remaining = db
        .prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?')
        .get(id) as { c: number };
      expect(remaining.c).toBe(0);
    });

    it('is a no-op on a missing conversation id (no throw)', () => {
      expect(() => store.deleteById('does-not-exist')).not.toThrow();
    });

    it('allows re-adding a conversation with the same (userId, messages) after delete', () => {
      // The whole point of delete: a partial-ingest recovery re-inserts the
      // conversation fresh. This must not trip the UNIQUE constraint.
      const messages = makeMessages(['Hi']);
      const firstId = store.addConversation(messages, 'user-1');

      store.deleteById(firstId);

      const secondId = store.addConversation(messages, 'user-1');
      expect(secondId).not.toBe(firstId);
      expect(store.getConversation(secondId)).not.toBeNull();
    });
  });
});

// -----------------------------------------------------------------------------
// Sprint-014 schema migration
// -----------------------------------------------------------------------------

// Pre-sprint-014 (Sprint-009) DDL — used to seed a "legacy" DB so the migration
// path runs against a shape that matches what an existing user's DB looks like.
// Includes the FTS5 triggers so direct INSERTs below populate messages_fts, which
// matches real Sprint-009 DBs and avoids spurious "disk image malformed" errors
// when the back-fill UPDATE fires the AFTER UPDATE trigger.
const SPRINT_009_DDL = `
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  message_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT,
  sort_order INTEGER NOT NULL
);
CREATE VIRTUAL TABLE messages_fts
  USING fts5(content, content=messages, content_rowid=rowid);
CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER messages_fts_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`;

const makeLegacyDb = () => {
  const d = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
  d.exec(SPRINT_009_DDL);
  return d;
};

describe('sprint-014 schema migration', () => {
  it('enables PRAGMA foreign_keys after store init', () => {
    const d = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    new ConversationStore(d);
    const result = d.pragma('foreign_keys', { simple: true });
    expect(result).toBe(1);
    d.close();
  });

  it('back-fills conversations.project_id from user_id on legacy rows', () => {
    const d = makeLegacyDb();
    d.prepare(
      "INSERT INTO conversations (id, user_id, content_hash) VALUES ('c-legacy-1', 'u-legacy', 'h1')",
    ).run();

    new ConversationStore(d);

    const row = d
      .prepare('SELECT project_id FROM conversations WHERE id = ?')
      .get('c-legacy-1') as { project_id: string };
    expect(row.project_id).toBe('u-legacy');
    d.close();
  });

  it("back-fills conversations.project_id to 'default' when user_id is empty", () => {
    const d = makeLegacyDb();
    d.prepare(
      "INSERT INTO conversations (id, user_id, content_hash) VALUES ('c-empty', '', 'h2')",
    ).run();

    new ConversationStore(d);

    const row = d.prepare('SELECT project_id FROM conversations WHERE id = ?').get('c-empty') as {
      project_id: string;
    };
    expect(row.project_id).toBe('default');
    d.close();
  });

  it('back-fills messages.project_id from the parent conversation', () => {
    const d = makeLegacyDb();
    d.prepare(
      "INSERT INTO conversations (id, user_id, content_hash) VALUES ('c-parent', 'u-parent', 'h3')",
    ).run();
    d.prepare(
      "INSERT INTO messages (conversation_id, role, content, sort_order) VALUES ('c-parent', 'user', 'hi', 0)",
    ).run();

    new ConversationStore(d);

    const row = d
      .prepare('SELECT project_id FROM messages WHERE conversation_id = ?')
      .get('c-parent') as { project_id: string };
    expect(row.project_id).toBe('u-parent');
    d.close();
  });

  it("back-fills orphaned messages.project_id to 'default' (COALESCE fallback)", () => {
    // Legacy DBs built before PRAGMA foreign_keys = ON was enabled can contain
    // messages whose conversation_id has no matching row in conversations. The
    // back-fill's correlated subquery returns NULL for those rows; without the
    // COALESCE fallback, the UPDATE would violate the NOT NULL constraint and
    // abort the migration. Disable FK on the legacy seed so we can simulate
    // the orphan shape a legacy DB could have accrued.
    const d = makeLegacyDb();
    d.pragma('foreign_keys = OFF');
    d.prepare(
      "INSERT INTO messages (conversation_id, role, content, sort_order) VALUES ('c-missing', 'user', 'orphan', 0)",
    ).run();

    expect(() => new ConversationStore(d)).not.toThrow();

    const row = d
      .prepare('SELECT project_id FROM messages WHERE conversation_id = ?')
      .get('c-missing') as { project_id: string };
    expect(row.project_id).toBe('default');
    d.close();
  });

  it('addConversation writes parent_message_id = NULL by default', () => {
    const msgs = makeMessages(['Hi', 'Hello']);
    const id = store.addConversation(msgs, 'user-parent-null');

    const rows = db
      .prepare('SELECT parent_message_id FROM messages WHERE conversation_id = ?')
      .all(id) as { parent_message_id: number | null }[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.parent_message_id).toBeNull();
    }
  });

  it('creates all four Story-1 spec §12 indexes in sqlite_master', () => {
    const expected = [
      'ix_conversations_project_started',
      'ix_messages_conv_sort',
      'ix_messages_timestamp_nonchunk',
      'ix_messages_parent',
    ].sort();
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index'
           AND name IN ('ix_conversations_project_started', 'ix_messages_conv_sort',
                        'ix_messages_timestamp_nonchunk', 'ix_messages_parent')`,
      )
      .all() as { name: string }[];
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(expected);
  });

  it('re-running migration is a no-op (idempotent)', () => {
    const d = makeLegacyDb();
    d.prepare(
      "INSERT INTO conversations (id, user_id, content_hash) VALUES ('c-idem', 'u-idem', 'h4')",
    ).run();

    new ConversationStore(d);
    const beforeCols = d.prepare('PRAGMA table_info(messages)').all();
    const beforeIdx = d
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all();

    expect(() => new ConversationStore(d)).not.toThrow();

    const afterCols = d.prepare('PRAGMA table_info(messages)').all();
    const afterIdx = d
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all();
    expect(afterCols).toEqual(beforeCols);
    expect(afterIdx).toEqual(beforeIdx);

    // Consumer-reassigned project_id must survive a re-run — the user_version
    // gate skips the whole back-fill block on already-migrated DBs, so any
    // caller-assigned value is safe regardless of whether it equals 'default'.
    d.prepare("UPDATE conversations SET project_id = 'custom' WHERE id = ?").run('c-idem');
    new ConversationStore(d);
    const row = d.prepare('SELECT project_id FROM conversations WHERE id = ?').get('c-idem') as {
      project_id: string;
    };
    expect(row.project_id).toBe('custom');
    d.close();
  });

  it('bumps PRAGMA user_version to SCHEMA_VERSION on first migration and skips on re-run', () => {
    const d = makeLegacyDb();
    expect(d.pragma('user_version', { simple: true })).toBe(0);

    new ConversationStore(d);
    expect(d.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);

    // Flip a conversation's project_id to 'default' (the back-fill sentinel).
    // If the migration ran again, the back-fill UPDATE would re-match and
    // rewrite this row from user_id; with the version gate, it must survive.
    d.prepare(
      "INSERT INTO conversations (id, user_id, content_hash, project_id) VALUES ('c-post', 'u-post', 'h-post', 'default')",
    ).run();

    new ConversationStore(d);
    const row = d.prepare('SELECT project_id FROM conversations WHERE id = ?').get('c-post') as {
      project_id: string;
    };
    expect(row.project_id).toBe('default');
    expect(d.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    d.close();
  });
});

// -----------------------------------------------------------------------------
// Sprint-014 Story 2 — vec_windows + window_messages + vec_sessions
// -----------------------------------------------------------------------------

// sqlite-vec vec0 tables require BigInt for INTEGER metadata / PK columns.
// Plain JS numbers get bound as REAL and vec0 rejects them with
// "Expected integer for INTEGER metadata column ...".
const makeEmbedding = (seed: number): Buffer => {
  const f = new Float32Array(768);
  for (let i = 0; i < 768; i++) f[i] = seed + i * 1e-4;
  return Buffer.from(f.buffer);
};

const readEmbedding = (buf: Buffer): Float32Array =>
  new Float32Array(buf.buffer, buf.byteOffset, 768);

describe('sprint-014 Story 2 — vec tables', () => {
  it('creates vec_windows, window_messages, vec_sessions in sqlite_master', () => {
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('vec_windows', 'window_messages', 'vec_sessions') ORDER BY name",
      )
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toContain('vec_windows');
    expect(names).toContain('window_messages');
    expect(names).toContain('vec_sessions');
  });

  it('creates ix_window_messages_message_id for Phase-4 reverse joins', () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ix_window_messages_message_id'",
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('ix_window_messages_message_id');
  });

  it('round-trips a 768-d embedding through vec_windows (bit-identical)', () => {
    const d = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    new ConversationStore(d);

    // Bit-identical round-trip check: compare against the same Float32 source
    // that was written, not the JS Float64 literal — otherwise precision loss
    // from the Float64 → Float32 cast breaks equality on most element indexes.
    const source = new Float32Array(768);
    for (let i = 0; i < 768; i++) source[i] = 0.25 + i * 1e-4;
    const writeBuf = Buffer.from(source.buffer);

    d.prepare(
      'INSERT INTO vec_windows(conversation_id, window_index, embedding) VALUES (?, ?, ?)',
    ).run('c-rt', 0n, writeBuf);

    const row = d
      .prepare('SELECT embedding FROM vec_windows WHERE conversation_id = ? AND window_index = ?')
      .get('c-rt', 0n) as { embedding: Buffer };
    const out = readEmbedding(row.embedding);

    for (let i = 0; i < 768; i++) {
      expect(out[i]).toBe(source[i]);
    }
    d.close();
  });

  it('rejects a non-768-dimension embedding on vec_windows', () => {
    const d = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    new ConversationStore(d);

    const wrong = Buffer.from(new Float32Array(512).buffer);
    expect(() =>
      d
        .prepare(
          'INSERT INTO vec_windows(conversation_id, window_index, embedding) VALUES (?, ?, ?)',
        )
        .run('c-wrong', 0n, wrong),
    ).toThrow(/Dimension mismatch/i);
    d.close();
  });

  it('round-trips a 768-d embedding + updated_at through vec_sessions', () => {
    const d = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    new ConversationStore(d);

    const source = new Float32Array(768);
    for (let i = 0; i < 768; i++) source[i] = 0.75 + i * 1e-4;
    const writeBuf = Buffer.from(source.buffer);

    d.prepare(
      'INSERT INTO vec_sessions(conversation_id, embedding, updated_at) VALUES (?, ?, ?)',
    ).run('c-sess', writeBuf, 1_700_000_000_000n);

    const row = d
      .prepare(
        'SELECT conversation_id, embedding, updated_at FROM vec_sessions WHERE conversation_id = ?',
      )
      .get('c-sess') as { conversation_id: string; embedding: Buffer; updated_at: number | bigint };
    expect(row.conversation_id).toBe('c-sess');
    // vec0 INTEGER auxiliary columns currently return as Number via
    // better-sqlite3, but the typed row annotation accepts bigint too so
    // an sqlite-vec return-type change doesn't silently break this assertion.
    // Explicit Number() coercion makes the comparison symmetric with the
    // BigInt literal used on write.
    expect(Number(row.updated_at)).toBe(1_700_000_000_000);
    const out = readEmbedding(row.embedding);
    for (let i = 0; i < 768; i++) {
      expect(out[i]).toBe(source[i]);
    }
    d.close();
  });

  it('vec_sessions.conversation_id PK rejects a duplicate insert', () => {
    // vec0 does not support INSERT OR REPLACE on the declared PRIMARY KEY —
    // duplicate inserts throw a UNIQUE constraint. The indexer's "replace"
    // idiom is DELETE + INSERT inside a transaction; this test pins that
    // contract at the schema level so sprint-015's write-helper lands on
    // the right primitive.
    const d = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    new ConversationStore(d);

    const emb1 = makeEmbedding(0.1);
    const emb2 = makeEmbedding(0.2);

    d.prepare(
      'INSERT INTO vec_sessions(conversation_id, embedding, updated_at) VALUES (?, ?, ?)',
    ).run('c-pk', emb1, 1n);

    expect(() =>
      d
        .prepare(
          'INSERT INTO vec_sessions(conversation_id, embedding, updated_at) VALUES (?, ?, ?)',
        )
        .run('c-pk', emb2, 2n),
    ).toThrow(/UNIQUE constraint failed/i);

    // DELETE + INSERT is the supported replace idiom — verify it leaves one row
    // with the new embedding and updated_at.
    d.transaction(() => {
      d.prepare('DELETE FROM vec_sessions WHERE conversation_id = ?').run('c-pk');
      d.prepare(
        'INSERT INTO vec_sessions(conversation_id, embedding, updated_at) VALUES (?, ?, ?)',
      ).run('c-pk', emb2, 2n);
    })();

    const row = d
      .prepare('SELECT updated_at FROM vec_sessions WHERE conversation_id = ?')
      .get('c-pk') as { updated_at: number | bigint };
    expect(Number(row.updated_at)).toBe(2);
    d.close();
  });

  it('window_messages FK rejects an insert with non-existent message_id', () => {
    const d = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    new ConversationStore(d);

    // Pre-condition: Story 1 enabled PRAGMA foreign_keys = ON. Confirm it
    // here so this test's failure mode is clear — if the pragma ever
    // regresses, the FK-rejection would silently pass and this test would
    // fail on the pragma line rather than the FK assertion, pointing at
    // the right place.
    expect(d.pragma('foreign_keys', { simple: true })).toBe(1);

    expect(() =>
      d
        .prepare(
          'INSERT INTO window_messages (conversation_id, window_index, message_id, position) VALUES (?, ?, ?, ?)',
        )
        .run('c-fk', 0, 999_999, 0),
    ).toThrow(/FOREIGN KEY constraint failed/i);
    d.close();
  });

  it('window_messages FK accepts an insert with existing message_id', () => {
    // Pair-test for the FK rejection above: prove the FK is not over-
    // restrictive — a valid message_id lands cleanly.
    const d = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    const s = new ConversationStore(d);

    const convId = s.addConversation(makeMessages(['hi', 'hello']), 'user-fk');
    const mid = d
      .prepare('SELECT id FROM messages WHERE conversation_id = ? ORDER BY sort_order LIMIT 1')
      .get(convId) as { id: number };

    expect(() =>
      d
        .prepare(
          'INSERT INTO window_messages (conversation_id, window_index, message_id, position) VALUES (?, ?, ?, ?)',
        )
        .run(convId, 0, mid.id, 0),
    ).not.toThrow();

    const row = d
      .prepare('SELECT position FROM window_messages WHERE message_id = ?')
      .get(mid.id) as { position: number };
    expect(row.position).toBe(0);
    d.close();
  });
});

// -----------------------------------------------------------------------------
// Sprint-014 Story 3 — public views (messages_public + conversations_public)
// -----------------------------------------------------------------------------

describe('sprint-014 Story 3 — public views', () => {
  it('messages_public exposes EXACTLY (id, conversation_id, turn_index, role, content, timestamp, project_id) in declared order', () => {
    const cols = db.prepare('PRAGMA table_info(messages_public)').all() as { name: string }[];
    // No .sort() — the DDL declares a specific column order and SELECT ... *
    // callers of the view see columns in that order. A future refactor that
    // reorders the SELECT should fail this test, not silently pass.
    expect(cols.map((c) => c.name)).toEqual([
      'id',
      'conversation_id',
      'turn_index',
      'role',
      'content',
      'timestamp',
      'project_id',
    ]);
  });

  it('messages_public excludes parent_message_id (privacy invariant)', () => {
    const cols = db.prepare('PRAGMA table_info(messages_public)').all() as { name: string }[];
    expect(cols.map((c) => c.name)).not.toContain('parent_message_id');
  });

  it('conversations_public exposes EXACTLY (id, project_id, started_at) in declared order', () => {
    const cols = db.prepare('PRAGMA table_info(conversations_public)').all() as { name: string }[];
    expect(cols.map((c) => c.name)).toEqual(['id', 'project_id', 'started_at']);
  });

  it('conversations_public excludes user_id, content_hash, message_count (privacy invariant)', () => {
    const cols = db.prepare('PRAGMA table_info(conversations_public)').all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).not.toContain('user_id');
    expect(names).not.toContain('content_hash');
    expect(names).not.toContain('message_count');
  });

  it('messages_public.timestamp is integer (unix ms, not text)', () => {
    // Seed a message with a TEXT timestamp so the cast has something to operate on.
    const msgs = [{ role: 'user', content: 'view-ts-test', timestamp: '2026-04-24T10:00:00' }];
    store.addConversation(msgs, 'user-view-ts');

    const row = db
      .prepare(
        "SELECT typeof(timestamp) AS t FROM messages_public WHERE content = 'view-ts-test' LIMIT 1",
      )
      .get() as { t: string };
    expect(row.t).toBe('integer');
  });

  it('conversations_public.started_at is integer (unix ms, not text)', () => {
    const convId = store.addConversation(makeMessages(['started-at-test']), 'user-started-at');

    // Scope to the row this test just inserted — LIMIT 1 without a WHERE
    // filter would pick an arbitrary row depending on test order, which is
    // fragile even though all rows share the same cast.
    const row = db
      .prepare('SELECT typeof(started_at) AS t FROM conversations_public WHERE id = ?')
      .get(convId) as { t: string };
    expect(row.t).toBe('integer');
  });

  it('messages_public.timestamp is NULL when the underlying message was stored without a timestamp', () => {
    // Sprint-009's physical messages.timestamp is nullable TEXT; addConversation
    // without per-message timestamps inserts NULL. strftime('%s', NULL) returns
    // NULL, so the view's timestamp column passes NULL through for those rows.
    // This is the documented contract — consumers must handle NULL on
    // messages_public.timestamp, not assume the INTEGER type annotation
    // guarantees non-null.
    const convId = store.addConversation(makeMessages(['null-ts-test']), 'user-null-ts');

    const row = db
      .prepare(
        'SELECT timestamp, typeof(timestamp) AS t FROM messages_public WHERE conversation_id = ?',
      )
      .get(convId) as { timestamp: number | null; t: string };
    expect(row.timestamp).toBeNull();
    expect(row.t).toBe('null');
  });

  it('round-trips addConversation data through messages_public with correct aliases', () => {
    const timestamp = '2026-04-24T10:00:00';
    // strftime('%s', '2026-04-24T10:00:00') assumes UTC when there's no tz
    // suffix, which is the Sprint-009 datetime('now') default. Compute the
    // expected unix-ms value the same way the view's CAST does.
    const expectedMs = Math.floor(Date.parse(`${timestamp}Z`) / 1000) * 1000;

    const convId = store.addConversation(
      [
        { role: 'user', content: 'first turn', timestamp },
        { role: 'assistant', content: 'second turn', timestamp },
      ],
      'user-rt',
    );

    const rows = db
      .prepare(
        `SELECT id, conversation_id, turn_index, role, content, timestamp, project_id
         FROM messages_public
         WHERE conversation_id = ?
         ORDER BY turn_index ASC`,
      )
      .all(convId) as {
      id: number;
      conversation_id: string;
      turn_index: number;
      role: string;
      content: string;
      timestamp: number;
      project_id: string;
    }[];

    expect(rows).toHaveLength(2);
    expect(rows[0].conversation_id).toBe(convId);
    expect(rows[0].turn_index).toBe(0);
    expect(rows[0].role).toBe('user');
    expect(rows[0].content).toBe('first turn');
    expect(rows[0].timestamp).toBe(expectedMs);
    // addConversation derives project_id from userId when no explicit
    // projectId is supplied — same rule the migration back-fill applies
    // for legacy rows. A caller that needs multi-project-per-user scoping
    // can pass `projectId` as the third parameter.
    expect(rows[0].project_id).toBe('user-rt');
    expect(rows[1].turn_index).toBe(1);
    expect(rows[1].content).toBe('second turn');
  });

  it('round-trips addConversation data through conversations_public with started_at cast', () => {
    const convId = store.addConversation(makeMessages(['hi']), 'user-conv-rt');

    // started_at is derived from datetime('now') — can't predict the exact
    // value, but assert structure: integer, positive, within the last minute.
    const row = db
      .prepare('SELECT id, project_id, started_at FROM conversations_public WHERE id = ?')
      .get(convId) as { id: string; project_id: string; started_at: number };

    expect(row.id).toBe(convId);
    // project_id defaults to the userId value (see addConversation JSDoc).
    expect(row.project_id).toBe('user-conv-rt');
    expect(typeof row.started_at).toBe('number');
    expect(row.started_at).toBeGreaterThan(0);
    // Must be within 60 seconds of now — confirms unix ms, not text.
    const nowMs = Date.now();
    expect(Math.abs(nowMs - row.started_at)).toBeLessThan(60_000);
  });
});

// -----------------------------------------------------------------------------
// Sprint-014 Story 4 — summaries table + API surface
// -----------------------------------------------------------------------------

describe('sprint-014 Story 4 — summaries schema', () => {
  it('creates the summaries table + ix_summaries_project_time index', () => {
    const tableRow = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'summaries'")
      .get() as { name: string } | undefined;
    expect(tableRow?.name).toBe('summaries');

    const indexRow = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ix_summaries_project_time'",
      )
      .get() as { name: string } | undefined;
    expect(indexRow?.name).toBe('ix_summaries_project_time');
  });

  it('summaries_public exposes EXACTLY (id, session_id, project_id, text, timestamp) in declared order (excludes metadata)', () => {
    const cols = db.prepare('PRAGMA table_info(summaries_public)').all() as { name: string }[];
    expect(cols.map((c) => c.name)).toEqual([
      'id',
      'session_id',
      'project_id',
      'text',
      'timestamp',
    ]);
    expect(cols.map((c) => c.name)).not.toContain('metadata');
  });
});

describe('sprint-014 Story 4 — addMessage', () => {
  it('appends a message with correct sort_order = N+1 when N messages exist (return void)', () => {
    const convId = store.addConversation(makeMessages(['msg0', 'msg1']), 'user-seq');
    // Confirm baseline: parent has 2 messages (sort_order 0 + 1).
    const beforeCount = db
      .prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?')
      .get(convId) as { c: number };
    expect(beforeCount.c).toBe(2);

    const result = store.addMessage(convId, { role: 'user', content: 'appended-after' });
    // Spec §5.1.1 primitive: addMessage returns void — callers that need the
    // inserted id query by (conversationId, sort_order).
    expect(result).toBeUndefined();

    const rows = db
      .prepare(
        'SELECT sort_order, content FROM messages WHERE conversation_id = ? ORDER BY sort_order',
      )
      .all(convId) as { sort_order: number; content: string }[];
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ sort_order: 2, content: 'appended-after' });
  });

  it('bumps conversations.message_count by 1 on each append', () => {
    // Seed 2 initial messages via addConversation — message_count should be 2.
    const convId = store.addConversation(makeMessages(['a', 'b']), 'user-count');
    const initial = db
      .prepare('SELECT message_count FROM conversations WHERE id = ?')
      .get(convId) as { message_count: number };
    expect(initial.message_count).toBe(2);

    store.addMessage(convId, { role: 'user', content: 'append-1' });
    store.addMessage(convId, { role: 'assistant', content: 'append-2' });
    store.addMessage(convId, { role: 'user', content: 'append-3' });

    const after = db
      .prepare('SELECT message_count FROM conversations WHERE id = ?')
      .get(convId) as { message_count: number };
    expect(after.message_count).toBe(5);

    // getConversation surfaces the live counter.
    expect(store.getConversation(convId)?.messageCount).toBe(5);
  });

  it('reads project_id from the parent conversation (not caller-supplied)', () => {
    const convId = store.addConversation(makeMessages(['hi']), 'user-scope');
    // Flip the parent conversation to a known non-default project_id so the
    // assertion is unambiguous.
    db.prepare("UPDATE conversations SET project_id = 'proj-alpha' WHERE id = ?").run(convId);

    store.addMessage(convId, { role: 'assistant', content: 'from-alpha' });

    const row = db
      .prepare(
        "SELECT project_id FROM messages WHERE conversation_id = ? AND content = 'from-alpha'",
      )
      .get(convId) as { project_id: string };
    expect(row.project_id).toBe('proj-alpha');
  });

  it('throws ConversationNotFoundError when the parent conversation does not exist', () => {
    expect(() =>
      store.addMessage('nonexistent-conv-id', { role: 'user', content: 'orphan' }),
    ).toThrow(ConversationNotFoundError);

    // No row inserted — atomic transaction rolled back.
    const count = db
      .prepare("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = 'nonexistent-conv-id'")
      .get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('writes parent_message_id when provided (non-null)', () => {
    const convId = store.addConversation(makeMessages(['parent']), 'user-parent-id');
    const parentId = db
      .prepare('SELECT id FROM messages WHERE conversation_id = ? LIMIT 1')
      .get(convId) as { id: number };

    store.addMessage(convId, {
      role: 'assistant',
      content: 'child-chunk',
      parentMessageId: parentId.id,
    });

    const row = db
      .prepare(
        "SELECT parent_message_id FROM messages WHERE conversation_id = ? AND content = 'child-chunk'",
      )
      .get(convId) as { parent_message_id: number | null };
    expect(row.parent_message_id).toBe(parentId.id);
  });

  it('produces a gapless sort_order sequence across 10 sequential appends', () => {
    const convId = store.addConversation(makeMessages(['seed']), 'user-gapless');

    for (let i = 0; i < 10; i++) {
      store.addMessage(convId, { role: 'user', content: `append-${i}` });
    }

    const rows = db
      .prepare('SELECT sort_order FROM messages WHERE conversation_id = ? ORDER BY sort_order')
      .all(convId) as { sort_order: number }[];
    // 1 seed + 10 appends = 11 rows with sort_order 0..10 contiguous.
    expect(rows).toHaveLength(11);
    for (let i = 0; i < 11; i++) {
      expect(rows[i]!.sort_order).toBe(i);
    }
  });
});

describe('sprint-014 Story 4 — addSummary + getRecentSummaries', () => {
  it('addSummary inserts a row and returns a non-empty id', () => {
    const id = store.addSummary({
      sessionId: 'sess-1',
      projectId: 'proj-sum',
      text: 'The session covered X, Y, Z.',
      timestamp: 1_700_000_000_000,
    });

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const row = db
      .prepare('SELECT session_id, project_id, text, timestamp FROM summaries WHERE id = ?')
      .get(id) as {
      session_id: string;
      project_id: string;
      text: string;
      timestamp: number;
    };
    expect(row.session_id).toBe('sess-1');
    expect(row.project_id).toBe('proj-sum');
    expect(row.text).toBe('The session covered X, Y, Z.');
    expect(row.timestamp).toBe(1_700_000_000_000);
  });

  it('rejects empty-text summaries with InvalidArgumentError', () => {
    expect(() =>
      store.addSummary({
        sessionId: 's',
        projectId: 'p',
        text: '',
        timestamp: 1,
      }),
    ).toThrow(InvalidArgumentError);

    expect(() =>
      store.addSummary({
        sessionId: 's',
        projectId: 'p',
        text: '   \n\t  ',
        timestamp: 1,
      }),
    ).toThrow(InvalidArgumentError);
  });

  it('getRecentSummaries returns rows in timestamp DESC order and respects the limit', () => {
    store.addSummary({ sessionId: 's', projectId: 'proj-rec', text: 'oldest', timestamp: 1000 });
    store.addSummary({ sessionId: 's', projectId: 'proj-rec', text: 'middle', timestamp: 2000 });
    store.addSummary({ sessionId: 's', projectId: 'proj-rec', text: 'newest', timestamp: 3000 });
    // A summary in a DIFFERENT project must not leak into proj-rec's results.
    store.addSummary({ sessionId: 's', projectId: 'other', text: 'other-proj', timestamp: 5000 });

    const limited = store.getRecentSummaries('proj-rec', 2);
    expect(limited).toHaveLength(2);
    expect(limited[0]!.text).toBe('newest');
    expect(limited[1]!.text).toBe('middle');

    const all = store.getRecentSummaries('proj-rec');
    expect(all).toHaveLength(3);
    expect(all.map((r) => r.text)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('getRecentSummaries uses ix_summaries_project_time (EXPLAIN QUERY PLAN)', () => {
    // Seed enough rows that SQLite's optimizer reliably picks the index —
    // a single-row table can be full-scanned in less CPU than an index
    // seek, so the optimizer may skip the index even when it exists. 50
    // rows is comfortably past the threshold where the optimizer commits
    // to indexed access.
    for (let i = 0; i < 50; i++) {
      store.addSummary({
        sessionId: 's',
        projectId: 'proj-plan',
        text: `summary ${i}`,
        timestamp: 1_000 + i,
      });
    }

    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id, session_id, project_id, text, timestamp, metadata
         FROM summaries
         WHERE project_id = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all('proj-plan', 10) as { detail: string }[];
    const planText = plan.map((r) => r.detail).join('\n');
    expect(planText).toContain('ix_summaries_project_time');
  });

  it('rejects limit <= 0 in getRecentSummaries with InvalidArgumentError', () => {
    expect(() => store.getRecentSummaries('proj-limit', 0)).toThrow(InvalidArgumentError);
    expect(() => store.getRecentSummaries('proj-limit', -1)).toThrow(InvalidArgumentError);
  });

  it('addSummary stores + getRecentSummaries omits metadata when NULL', () => {
    const id = store.addSummary({
      sessionId: 's',
      projectId: 'proj-no-meta',
      text: 'no metadata',
      timestamp: 42,
    });

    const row = db.prepare('SELECT metadata FROM summaries WHERE id = ?').get(id) as {
      metadata: string | null;
    };
    expect(row.metadata).toBeNull();

    const [result] = store.getRecentSummaries('proj-no-meta');
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty('metadata');
  });
});
