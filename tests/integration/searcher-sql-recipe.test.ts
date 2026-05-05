import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, PristineLocal } from '../../src/index.js';

// Recipe-equivalence test for the canonical migration recipe shipped
// in spec §5.2 (concrete `client.searcher.sql` raw-SQL form replacing
// the removed `searchConversations` method).
//
// Verifies the recipe returns the expected per-message FTS5 hits
// against a seeded corpus on three representative inputs:
//
//   1. Different keyword (matches a subset of seeded messages).
//   2. Different project (project-scoped filter narrows results).
//   3. Empty result (no keyword match in any seeded message).
//
// The recipe is project-scoped, not user-scoped — Story 2's
// `## messages_fts allowlist decision` extended the allowlist to
// include `messages_fts` but `conversations_public` does NOT expose
// `user_id` (only `id, project_id, started_at`), so the new recipe
// pivots on `messages_public.project_id` rather than the legacy
// `conversations.user_id`. The seeded corpus uses one user per
// project so the conversation-set membership is identical between
// "scoped by user X" and "scoped by project P" semantics.

const SLOW_TEST_TIMEOUT_MS = 120_000;

const PROJECT_A = 'recipe-test-project-A';
const PROJECT_B = 'recipe-test-project-B';
const USER_A = 'recipe-test-user-a';
const USER_B = 'recipe-test-user-b';

let tmpDir: string;
let db: ReturnType<typeof createDatabase>;
let client: PristineLocal;

const stubEmbedder = {
  dim: 768,
  embed: async (): Promise<number[]> => Array.from({ length: 768 }, () => 0.01),
  embedBatch: async (texts: readonly string[]): Promise<number[][]> =>
    texts.map(() => Array.from({ length: 768 }, () => 0.01)),
};

// FTS5 keyword escaper used by the recipe — wraps each whitespace-
// separated term in double quotes so FTS5 doesn't interpret `-` as NOT
// or other syntax. Matches the legacy `escapeFts5Query` in
// src/conversations/store.ts that was removed alongside
// searchConversations.
const escapeFts5Query = (keyword: string): string =>
  keyword
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' ');

// Locked recipe shape — one row per matching message, project-scoped,
// ordered by FTS5 rank. Mirrors the spec §5.2 canonical form.
const RECIPE_SQL = `
  SELECT m.id, m.conversation_id, m.role, m.timestamp,
         snippet(messages_fts, 0, '<b>', '</b>', '...', 32) AS snippet
  FROM messages_fts
  JOIN messages_public m ON m.id = messages_fts.rowid
  WHERE messages_fts MATCH ? AND m.project_id = ?
  ORDER BY rank
  LIMIT ?
`;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'searcher-sql-recipe-test-'));
  db = createDatabase({
    path: join(tmpDir, 'test.db'),
    loadSqliteVec: true,
    runIntegrityCheck: false,
  });
  client = await PristineLocal.create({ db, embedder: stubEmbedder });

  // Seed: project A has 2 conversations × 2 messages each (4 messages)
  // mentioning espresso / cardamom; project B has 1 conversation × 2
  // messages (2 messages) mentioning hiking. Per-project user is fixed
  // so legacy user-scoped semantics map 1:1 to project-scoped recipe.
  client.storeAsync(
    [
      { role: 'user', content: 'I love espresso with cardamom in the morning' },
      { role: 'assistant', content: 'Great choice — try a Turkish pull for espresso' },
    ],
    USER_A,
    PROJECT_A,
  );
  client.storeAsync(
    [
      { role: 'user', content: 'What about cardamom-rosewater pastries?' },
      { role: 'assistant', content: 'Best paired with strong coffee' },
    ],
    USER_A,
    PROJECT_A,
  );
  client.storeAsync(
    [
      { role: 'user', content: 'I went hiking on the ridge yesterday' },
      { role: 'assistant', content: 'How was the hiking trail?' },
    ],
    USER_B,
    PROJECT_B,
  );
  await client.drainEmbedQueue();
}, SLOW_TEST_TIMEOUT_MS);

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('searcher.sql recipe equivalence', () => {
  it(
    'recipe input #1 (different keyword): "espresso" in project A returns the 2 espresso-mentioning messages',
    { timeout: SLOW_TEST_TIMEOUT_MS },
    async () => {
      const rows = await client.searcher.sql(RECIPE_SQL, {
        params: [escapeFts5Query('espresso'), PROJECT_A, 100],
      });
      // 2 messages mention espresso (one in each conversation).
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect((row as { snippet: string }).snippet).toContain('<b>espresso</b>');
      }
    },
  );

  it(
    'recipe input #2 (different project): "hiking" in project B returns the 2 hiking-mentioning messages',
    { timeout: SLOW_TEST_TIMEOUT_MS },
    async () => {
      const rows = await client.searcher.sql(RECIPE_SQL, {
        params: [escapeFts5Query('hiking'), PROJECT_B, 100],
      });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        const snippet = (row as { snippet: string }).snippet;
        expect(snippet.toLowerCase()).toContain('<b>hiking</b>');
      }
    },
  );

  it(
    'recipe input #3 (empty result): a keyword in no seeded message returns empty',
    { timeout: SLOW_TEST_TIMEOUT_MS },
    async () => {
      const rows = await client.searcher.sql(RECIPE_SQL, {
        params: [escapeFts5Query('quantumfizzgrip'), PROJECT_A, 100],
      });
      expect(rows).toHaveLength(0);
    },
  );

  it(
    'recipe scopes correctly across projects: "cardamom" in project A returns A-scoped rows only',
    { timeout: SLOW_TEST_TIMEOUT_MS },
    async () => {
      // Defence-in-depth assertion: same keyword scoped to a different
      // project returns no hits even though the writable corpus has
      // 'cardamom' in project A. Confirms project-scoped semantics
      // match the legacy user-scoped semantics under the seed's
      // 1-user-per-project shape.
      const inA = await client.searcher.sql(RECIPE_SQL, {
        params: [escapeFts5Query('cardamom'), PROJECT_A, 100],
      });
      expect(inA.length).toBeGreaterThan(0);

      const inB = await client.searcher.sql(RECIPE_SQL, {
        params: [escapeFts5Query('cardamom'), PROJECT_B, 100],
      });
      expect(inB).toHaveLength(0);
    },
  );
});
