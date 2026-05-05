import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { ConversationStore } from '../../src/conversations/store.js';
import { createDatabase } from '../../src/core/database.js';

// ---------------------------------------------------------------------------
// Story 0 / sprint-017 — default-dim positive observable (AC-FV-1)
// ---------------------------------------------------------------------------
//
// Pins:
//   1. With no explicit dim, ConversationStore initializes vec_windows
//      and vec_sessions with `float[768]` typed-column syntax. Reading
//      back the DDL via `sqlite_master` proves the default-768 path was
//      actually exercised — not a no-op pass-through.
//   2. The default flows from `DEFAULT_EMBEDDING_DIM` (single source of
//      truth) into the templated DDL builders. Changing the default to a
//      non-768 value would flip this test red — that's the whole point.

describe('default-dim DDL observable (AC-FV-1)', () => {
  const dbs: Database.Database[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('vec_windows DDL contains float[768] when ConversationStore is constructed without an explicit dim', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    dbs.push(db);

    new ConversationStore(db);

    const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vec_windows'").get() as
      | { sql: string | null }
      | undefined;

    expect(row).toBeDefined();
    expect(row!.sql).toBeTruthy();
    expect(row!.sql).toContain('float[768]');
  });

  it('vec_sessions DDL contains float[768] when ConversationStore is constructed without an explicit dim', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    dbs.push(db);

    new ConversationStore(db);

    const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vec_sessions'").get() as
      | { sql: string | null }
      | undefined;

    expect(row).toBeDefined();
    expect(row!.sql).toBeTruthy();
    expect(row!.sql).toContain('float[768]');
  });
});
