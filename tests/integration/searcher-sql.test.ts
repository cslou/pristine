import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, PristineLocal, QueryTimeoutError } from '../../src/index.js';

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
