import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/core/database.js';
import { ConversationStore } from '../../src/conversations/store.js';

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

  it('creates all four spec §12 indexes in sqlite_master', () => {
    const expected = [
      'ix_conversations_project_started',
      'ix_messages_conv_sort',
      'ix_messages_timestamp_nonchunk',
      'ix_messages_parent',
    ];
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'ix_%'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(expected.sort());
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

  it('bumps PRAGMA user_version to the current target on first migration and skips on re-run', () => {
    const d = makeLegacyDb();
    expect(d.pragma('user_version', { simple: true })).toBe(0);

    new ConversationStore(d);
    const afterFirst = d.pragma('user_version', { simple: true }) as number;
    expect(afterFirst).toBeGreaterThanOrEqual(1);

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
    expect(d.pragma('user_version', { simple: true })).toBe(afterFirst);
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
      .get('c-sess') as { conversation_id: string; embedding: Buffer; updated_at: number };
    expect(row.conversation_id).toBe('c-sess');
    expect(row.updated_at).toBe(1_700_000_000_000);
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
      .get('c-pk') as { updated_at: number };
    expect(row.updated_at).toBe(2);
    d.close();
  });
});
