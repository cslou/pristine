import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { ConversationStore } from '../../src/conversations/store.js';
import { createDatabase } from '../../src/core/database.js';
import { DEFAULT_EMBEDDING_DIM } from '../../src/embedder/dim.js';

// ---------------------------------------------------------------------------
// Default-dim DDL observable
// ---------------------------------------------------------------------------
//
// Pins:
//   1. The SDK default constant `DEFAULT_EMBEDDING_DIM` (= 768) flows
//      through `ConversationStore` to produce `float[768]` typed-column
//      DDL on `vec_windows` and `vec_sessions`. Reading back the DDL via
//      `sqlite_master` proves the templating actually wrote the expected
//      dim — not a no-op pass-through.
//   2. The literal `768` in the assertion below is intentional: changing
//      `DEFAULT_EMBEDDING_DIM` to a non-768 value would flip this test
//      red, surfacing the schema implication of the default change.

describe('configured-dim DDL observable', () => {
  const dbs: Database.Database[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('vec_windows DDL contains float[768] when ConversationStore is constructed at the SDK default dim', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    dbs.push(db);

    new ConversationStore(db, DEFAULT_EMBEDDING_DIM);

    const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vec_windows'").get() as
      | { sql: string | null }
      | undefined;

    expect(row).toBeDefined();
    expect(row!.sql).toBeTruthy();
    expect(row!.sql).toContain('float[768]');
  });

  it('vec_sessions DDL contains float[768] when ConversationStore is constructed at the SDK default dim', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    dbs.push(db);

    new ConversationStore(db, DEFAULT_EMBEDDING_DIM);

    const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'vec_sessions'").get() as
      | { sql: string | null }
      | undefined;

    expect(row).toBeDefined();
    expect(row!.sql).toBeTruthy();
    expect(row!.sql).toContain('float[768]');
  });
});
