import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabase,
  InvalidSqlError,
  PristineLocal,
  QueryTimeoutError,
} from '../../src/index.js';

// Slow-test timeout matching the sprint-016 hookTimeout pattern.
const SLOW_TEST_TIMEOUT_MS = 120_000;

const PROJECT_A = 'sql-test-project-A';
const PROJECT_B = 'sql-test-project-B';
const USER_ID = 'sql-test-user';

let tmpDir: string;
let db: ReturnType<typeof createDatabase>;
let client: PristineLocal;

const stubEmbedder = {
  embed: async (): Promise<number[]> => Array.from({ length: 768 }, () => 0.01),
  embedBatch: async (texts: readonly string[]): Promise<number[][]> =>
    texts.map(() => Array.from({ length: 768 }, () => 0.01)),
};

const seedSqlCorpus = async (): Promise<void> => {
  // Deterministic, dim-stable corpus: 2 projects × 3 conversations × 3
  // messages = 18 rows. Each conversation gets 3 messages alternating
  // user/assistant. The compound-query test (happy-3) relies on the
  // exact 3-conversations-per-project shape.
  for (const projectId of [PROJECT_A, PROJECT_B]) {
    for (let c = 0; c < 3; c += 1) {
      const messages = [
        { role: 'user' as const, content: `${projectId}-conv-${String(c)}-msg-0` },
        { role: 'assistant' as const, content: `${projectId}-conv-${String(c)}-msg-1` },
        { role: 'user' as const, content: `${projectId}-conv-${String(c)}-msg-2` },
      ];
      client.storeAsync(messages, USER_ID, projectId);
    }
  }
  await client.drainEmbedQueue();

  // Seed one summary for the summaries_public happy-path test. The
  // writable DB connection is the addSummary-equivalent path here —
  // PristineLocal does not expose addSummary on its public surface, but
  // the AC requires the summary to land. Direct INSERT against the
  // public Database connection writes a row visible to summaries_public.
  db.prepare(
    `INSERT INTO summaries (id, session_id, project_id, text, timestamp, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    'sum-1',
    'sum-session-1',
    PROJECT_A,
    'A reference summary used by the summaries_public happy-path test',
    Date.now(),
    null,
  );
};

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'searcher-sql-test-'));
  db = createDatabase({
    path: join(tmpDir, 'test.db'),
    loadSqliteVec: true,
    runIntegrityCheck: false,
  });
  client = await PristineLocal.create({ db, embedder: stubEmbedder });
  await seedSqlCorpus();
}, SLOW_TEST_TIMEOUT_MS);

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('searcher.sql primitive', () => {
  it('post-seeding sanity: 18 messages + 1 summary exist', () => {
    const messageCount = (db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number })
      .c;
    expect(messageCount).toBe(18);
    const summaryCount = (db.prepare('SELECT COUNT(*) AS c FROM summaries').get() as { c: number })
      .c;
    expect(summaryCount).toBe(1);
  });

  it(
    '@AC-Story3-happy-1: SELECT messages_public scoped by project returns 9 messages',
    { timeout: SLOW_TEST_TIMEOUT_MS },
    async () => {
      const rows = await client.searcher.sql(
        'SELECT id, content FROM messages_public WHERE project_id = ?',
        { params: [PROJECT_A] },
      );
      expect(rows).toHaveLength(9);
      for (const row of rows) {
        expect((row as { content: string }).content).toContain(PROJECT_A);
      }
    },
  );

  it(
    '@AC-Story3-happy-2: positional ? binding treats injection-style payload as a string literal',
    { timeout: SLOW_TEST_TIMEOUT_MS },
    async () => {
      const injection = "'; DROP TABLE messages; --";
      // The bound payload is treated as a literal string parameter, not
      // statement-merged into SQL — query succeeds returning empty rows
      // (no conversation matches that id), AND the messages table still
      // has 18 rows after the call.
      const rows = await client.searcher.sql('SELECT id FROM conversations_public WHERE id = ?', {
        params: [injection],
      });
      expect(rows).toHaveLength(0);
      const after = (db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c;
      expect(after).toBe(18);
    },
  );

  it(
    '@AC-Story3-happy-3: compound JOIN + COUNT + GROUP BY + ORDER BY + LIMIT + WHERE-= + ?',
    { timeout: SLOW_TEST_TIMEOUT_MS },
    async () => {
      const rows = await client.searcher.sql(
        `SELECT conv.id AS conv_id, COUNT(m.id) AS msg_count
         FROM conversations_public AS conv
         JOIN messages_public AS m ON m.conversation_id = conv.id
         WHERE conv.project_id = ?
         GROUP BY conv.id
         ORDER BY msg_count DESC
         LIMIT 10`,
        { params: [PROJECT_A] },
      );
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect((row as { msg_count: number }).msg_count).toBe(3);
      }
    },
  );

  it(
    '@AC-Story3-happy-4: summaries_public returns the seeded summary',
    { timeout: SLOW_TEST_TIMEOUT_MS },
    async () => {
      const rows = await client.searcher.sql(
        'SELECT id, session_id, project_id, text, timestamp FROM summaries_public WHERE project_id = ?',
        { params: [PROJECT_A] },
      );
      expect(rows).toHaveLength(1);
      const row = rows[0] as {
        id: string;
        session_id: string | null;
        project_id: string;
        text: string;
        timestamp: string;
      };
      expect(row.id).toBe('sum-1');
      expect(row.project_id).toBe(PROJECT_A);
      expect(row.text).toContain('reference summary');
    },
  );

  it(
    '@AC-Story3-happy-5: non-= WHERE operators (IN, BETWEEN, LIKE) accepted by the parser',
    { timeout: SLOW_TEST_TIMEOUT_MS },
    async () => {
      // turn_index is the index-friendly stable column (sort_order alias)
      // exposed by the messages_public view; using it for BETWEEN avoids
      // the nullable-timestamp pass-through that makes a timestamp-range
      // filter unreliable on `storeAsync`-seeded rows without explicit
      // per-message timestamps.
      const rows = await client.searcher.sql(
        `SELECT id, role
         FROM messages_public
         WHERE project_id = ?
           AND role IN (?, ?)
           AND turn_index BETWEEN ? AND ?
           AND content LIKE ?`,
        {
          params: [PROJECT_A, 'user', 'assistant', 0, 5, '%conv-0%'],
        },
      );
      expect(rows.length).toBeGreaterThan(0);
    },
  );

  it(
    '@AC-Story3-smoke-1: rowCap=5 limits to 5 rows on the 18-row corpus',
    { timeout: SLOW_TEST_TIMEOUT_MS },
    async () => {
      const rows = await client.searcher.sql('SELECT id FROM messages_public', {
        rowCap: 5,
      });
      expect(rows).toHaveLength(5);
    },
  );

  it(
    '@AC-Story3-smoke-2: timeoutMs=200 throws QueryTimeoutError on a slow query',
    { timeout: SLOW_TEST_TIMEOUT_MS },
    async () => {
      // Recursive CTE inflates the cartesian's row volume well past the
      // default rowCap so the per-iteration elapsed-time check fires
      // before rowCap. CTE-local names are skipped from the allowlist
      // check (parser contract), so 'big' below does not reject.
      const sql = `
        WITH RECURSIVE big(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM big WHERE i < 100000)
        SELECT a.id, length(randomblob(50000)) AS rb
        FROM messages_public a CROSS JOIN big
      `;
      const start = Date.now();
      await expect(
        client.searcher.sql(sql, { timeoutMs: 200, rowCap: 10000 }),
      ).rejects.toBeInstanceOf(QueryTimeoutError);
      // AC-mandated wall-time bound: timeoutMs + 2000ms framework overhead.
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(200 + 2000);
    },
  );
});

// ---------------------------------------------------------------------------
// Adversarial suite (sprint-019 Story 4 — privacy-boundary contract)
// ---------------------------------------------------------------------------
//
// Story-start probes for class (b) and (c) reflect repo state at sprint-019
// HEAD:
//
// - Class (b) Internal-table SELECT: `embed_jobs` and `migrations` do NOT
//   exist in src/conversations/store.ts (no CREATE TABLE for either), so
//   neither is appended. messages_fts IS in the default allowlist (Story 2
//   extended it; see Story 2 PR body's `## messages_fts allowlist decision`
//   heading for verbatim rationale), so messages_fts is dropped from this
//   class and the FTS5 shadow tables are substituted in. The full shadow
//   set per AC line 249 is asserted unconditionally — string-exact
//   allowlist comparison rejects them whether the binding currently
//   exposes them or not, protecting against a future binding that adds
//   `messages_fts_content` or `messages_fts_vocab`.
//
// - Class (c) Vault / privacy surface SELECT: probe
//   `grep -rn "CREATE TABLE.*vault\|CREATE TABLE.*key" src/privacy/`
//   returns three tables: `vault_entries` (src/privacy/vault/sqlite/),
//   `user_public_keys` (same file), and `user_keks`
//   (src/privacy/kek/kek-manager.ts). All three SELECT attempts must
//   reject. The fallback for empty privacy modules is unused.
describe('searcher.sql adversarial suite', () => {
  describe('(a) DML attempts', () => {
    const dmlCases: ReadonlyArray<{ label: string; sql: string }> = [
      { label: 'INSERT', sql: "INSERT INTO messages_public (id) VALUES ('x')" },
      { label: 'UPDATE', sql: "UPDATE messages_public SET content = 'x'" },
      { label: 'DELETE', sql: 'DELETE FROM messages_public' },
      { label: 'DROP TABLE', sql: 'DROP TABLE messages_public' },
      { label: 'ALTER TABLE', sql: 'ALTER TABLE messages_public ADD COLUMN x INT' },
    ];
    for (const c of dmlCases) {
      it(`rejects ${c.label} with InvalidSqlError`, async () => {
        await expect(client.searcher.sql(c.sql)).rejects.toBeInstanceOf(InvalidSqlError);
      });
    }
  });

  describe('(b) Internal-table SELECT', () => {
    // messages_fts is in the allowlist (Story 2 extended). The shadow
    // tables enumerate the FTS5 shadow set; string-exact allowlist
    // comparison rejects them all.
    const internalTables: readonly string[] = [
      'messages',
      'conversations',
      'window_messages',
      'vec_windows',
      'vec_sessions',
      'messages_fts_data',
      'messages_fts_idx',
      'messages_fts_content',
      'messages_fts_docsize',
      'messages_fts_config',
      'messages_fts_vocab',
    ];
    for (const t of internalTables) {
      it(`rejects SELECT * FROM ${t} with InvalidSqlError`, async () => {
        await expect(client.searcher.sql(`SELECT * FROM ${t}`)).rejects.toBeInstanceOf(
          InvalidSqlError,
        );
      });
    }
  });

  describe('(c) Vault / privacy surface SELECT', () => {
    // Probe grep `CREATE TABLE.*vault\|CREATE TABLE.*key` in src/privacy/
    // returned vault_entries, user_public_keys, user_keks. Each must
    // reject with InvalidSqlError.
    const vaultTables: readonly string[] = ['vault_entries', 'user_public_keys', 'user_keks'];
    for (const t of vaultTables) {
      it(`rejects SELECT * FROM ${t} with InvalidSqlError`, async () => {
        await expect(client.searcher.sql(`SELECT * FROM ${t}`)).rejects.toBeInstanceOf(
          InvalidSqlError,
        );
      });
    }
  });

  describe('(d) DoS / row-cap escape', () => {
    // Wall-time bound for each: ≤(MAX_TIMEOUT_MS + 2000)ms = ≤12s.
    it(
      'cartesian-join row-cap: > 1M-row CROSS JOIN terminates at rowCap or via timeout within 12s',
      { timeout: 12_000 },
      async () => {
        const start = Date.now();
        // CTE-amplified cartesian: 18 messages × 100k generated rows × 18
        // messages = 32M virtual rows. Either the row-cap cursor
        // short-circuits (returning rowCap=1000 rows fast) or the timeout
        // fires (QueryTimeoutError). Both are AC-acceptable per the
        // technical-note fallback.
        const sql = `
          WITH RECURSIVE big(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM big WHERE i < 100000)
          SELECT a.id FROM messages_public a CROSS JOIN big CROSS JOIN messages_public c
        `;
        let rowCapHit = false;
        let timeoutHit = false;
        try {
          const rows = await client.searcher.sql(sql, { rowCap: 1000, timeoutMs: 10_000 });
          rowCapHit = rows.length === 1000;
        } catch (err) {
          timeoutHit = err instanceof QueryTimeoutError;
        }
        const elapsed = Date.now() - start;
        expect(rowCapHit || timeoutHit).toBe(true);
        expect(elapsed).toBeLessThan(12_000);
      },
    );

    it(
      'CTE bomb timeout: WITH RECURSIVE + randomblob terminates within 12s via QueryTimeoutError',
      { timeout: 12_000 },
      async () => {
        const start = Date.now();
        const sql = `
          WITH RECURSIVE big(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM big WHERE i < 1000000)
          SELECT a.id, length(randomblob(50000)) AS rb FROM messages_public a CROSS JOIN big
        `;
        await expect(
          client.searcher.sql(sql, { timeoutMs: 200, rowCap: 10_000 }),
        ).rejects.toBeInstanceOf(QueryTimeoutError);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(12_000);
      },
    );

    it(
      'large randomblob amplification: randomblob(1MB) CROSS JOIN times out within 12s',
      { timeout: 12_000 },
      async () => {
        const start = Date.now();
        const sql = `
          SELECT a.id, length(randomblob(1000000)) AS rb
          FROM messages_public a CROSS JOIN messages_public b CROSS JOIN messages_public c
        `;
        // 18^3 = 5832 rows × 1MB randomblob each. Without timeout this
        // allocates ~5.8GB. timeoutMs=200 fires well before completion.
        await expect(
          client.searcher.sql(sql, { timeoutMs: 200, rowCap: 10_000 }),
        ).rejects.toBeInstanceOf(QueryTimeoutError);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(12_000);
      },
    );
  });

  describe('(e) Identifier-encoding tricks', () => {
    const encodingCases: ReadonlyArray<{ label: string; sql: string }> = [
      { label: 'double-quoted off-allowlist', sql: 'SELECT * FROM "messages"' },
      { label: 'square-bracket off-allowlist', sql: 'SELECT * FROM [messages]' },
      { label: 'backtick off-allowlist', sql: 'SELECT * FROM `messages`' },
      {
        label: 'main.<off-allowlist> via main. prefix-strip',
        sql: 'SELECT * FROM main.messages',
      },
      {
        label: 'temp. schema prefix rejected even on allowlist name',
        sql: 'SELECT * FROM temp.messages_public',
      },
      {
        label: 'aux. schema prefix rejected',
        sql: 'SELECT * FROM aux.messages_public',
      },
      {
        label: 'line comment hiding off-allowlist target',
        sql: 'SELECT * FROM messages -- comment',
      },
      {
        label: 'block comment injection before SELECT clause',
        sql: 'SELECT /* injected */ * FROM messages',
      },
      {
        label: 'CTE shadowing real internal table',
        sql: 'WITH foo AS (SELECT * FROM messages) SELECT * FROM foo',
      },
      {
        label: 'nested-CTE attack',
        sql: 'WITH a AS (WITH b AS (SELECT * FROM messages) SELECT * FROM b) SELECT * FROM a',
      },
    ];
    for (const c of encodingCases) {
      it(`rejects ${c.label} with InvalidSqlError`, async () => {
        await expect(client.searcher.sql(c.sql)).rejects.toBeInstanceOf(InvalidSqlError);
      });
    }
  });
});
