import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { PristineLocal, createDatabase, type Embedder } from '../../src/index.js';

// ---------------------------------------------------------------------------
// Public-API integration harness
// ---------------------------------------------------------------------------
//
// This file is the consumer-eye view of the SDK. It imports ONLY from the
// package barrel (src/index.ts) — the project's ESLint config has an
// override that fails any import resolving under ../../src/* other than
// the barrel. Reaching into internal modules defeats the harness contract:
// the purpose is to exercise the same surface an external SDK consumer
// (pi.dev, Claude Code hooks, etc.) sees.
//
// Slow-test gating: the harness inherits searcher.test.ts's
// `SKIP_SLOW_TESTS=1` opt-out + per-hook + per-it timeouts =
// SLOW_TEST_TIMEOUT_MS = 120_000. The describe block is wrapped in
// `describe.skipIf(skipSlow)` so CI (where `SKIP_SLOW_TESTS=1` is the
// default) doesn't see the slow tests fire on every unrelated PR. Local
// dev with the gate unset runs the full harness. When future commits
// switch the embedder from the deterministic stub to real Nomic, the
// timeout window already covers a 30+ s model-load.

const skipSlow = process.env.SKIP_SLOW_TESTS === '1';
const SLOW_TEST_TIMEOUT_MS = 120_000;

const makeStubEmbedder = (): Embedder => ({
  embed: async (text: string): Promise<number[]> => {
    const seed = text.length / 1000;
    return Array.from({ length: 768 }, (_, i) => seed + i * 1e-4);
  },
  embedBatch: async (texts: readonly string[]): Promise<number[][]> =>
    texts.map((text) => {
      const seed = text.length / 1000;
      return Array.from({ length: 768 }, (_, i) => seed + i * 1e-4);
    }),
});

// Tiny in-process corpus, written through the public surface. Each test
// calls this to seed; isolation is provided by the per-test in-memory DB
// the beforeEach reconstructs.
async function seedPublicApiCorpus(
  client: PristineLocal,
): Promise<{ projectId: string; conversationIds: readonly string[] }> {
  const projectId = 'pa-test-project';
  const userId = 'pa-user';
  const conv1 = client.storeAsync(
    [
      { role: 'user', content: 'hello world from the public-api harness' },
      { role: 'assistant', content: 'hi there — replying for the harness corpus' },
    ],
    userId,
    projectId,
  );
  return { projectId, conversationIds: [conv1] };
}

describe.skipIf(skipSlow)('public-API integration harness', () => {
  let db: Database.Database;
  let client: PristineLocal;

  beforeEach(async () => {
    db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    client = await PristineLocal.create({
      db,
      embedder: makeStubEmbedder(),
    });
  }, SLOW_TEST_TIMEOUT_MS);

  afterEach(async () => {
    await client.dispose();
    db.close();
  });

  it(
    'harness boots — barrel imports resolve and PristineLocal.create wires searcher',
    () => {
      // Smoke test: confirms the harness wiring is intact. If a future
      // change accidentally drops a load-bearing barrel export (e.g.
      // PristineLocal, createDatabase), this test breaks loudly before
      // any other test gets a chance to run.
      expect(client.searcher).not.toBeNull();
      expect(typeof client.storeAsync).toBe('function');
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it(
    'round-trip: storeAsync → drainEmbedQueue → hybridSearch returns hits',
    async () => {
      const { projectId } = await seedPublicApiCorpus(client);
      const drained = await client.drainEmbedQueue();
      expect(drained).toBeGreaterThanOrEqual(1);
      const hits = await client.searcher.hybridSearch('hello', { projectId }, 5);
      expect(hits.length).toBeGreaterThan(0);
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it(
    'session leg of hybridSearch populates after client.buildSessionVector',
    async () => {
      const { projectId, conversationIds } = await seedPublicApiCorpus(client);
      await client.drainEmbedQueue();
      await client.buildSessionVector(conversationIds[0]);
      const hits = await client.searcher.hybridSearch('hello', { projectId }, 10);
      const sessionHits = hits.filter((h) => h.kind === 'session');
      expect(sessionHits.length).toBeGreaterThanOrEqual(1);
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // Barrel hygiene check.
  //
  // Hybrid runtime + static-source assertion. Required because TypeScript
  // erases `export type { … }` at runtime: `IngestTask`,
  // `IngestQueueConfig`, and `Memory` are type-only re-exports, so a
  // runtime `expect(barrel.IngestTask).toBeUndefined()` would
  // false-negative pass green. Only `IngestQueue` is a value export (the
  // class), so it gets the runtime check; the three type-only names get
  // a source-text grep.
  //
  // The `readFile` + `import.meta.url` pattern is a filesystem read, not
  // an `import` statement — the file-scoped ESLint
  // `no-restricted-imports` override fires on imports only, so this does
  // not violate the harness contract.
  // -------------------------------------------------------------------------
  it(
    'barrel does not export IngestQueue / IngestTask / IngestQueueConfig / Memory',
    async () => {
      const barrelModule = await import('../../src/index.js');
      const barrel = barrelModule as unknown as Record<string, unknown>;
      expect(barrel.IngestQueue).toBeUndefined();

      // Static-source check: the three type-only names. The barrel uses
      // BOTH shapes — multi-line list (each ident on its own indented
      // comma-terminated line) AND single-line `export { A, B } from '…';`.
      // The regex is a disjunction of both shapes, anchored to either a
      // standalone-ident line OR an export-list inside `{ … }`:
      //
      //
      //   `^\s*<Name>\s*,?\s*$`          ← multi-line block (Memory)
      //   `\{[^}]*\b<Name>\b[^}]*\}`     ← single-line block (IngestTask, …)
      //
      // The `[^}]*` is greedy but stops at the first closing brace, so
      // the brace alternative does not span unrelated blocks. Bare
      // mentions inside code comments, JSDoc, or string literals do
      // NOT match: the multi-line alternative requires the name to be
      // the only non-whitespace content on a line, and the brace
      // alternative requires the name inside `{ … }`. Future prose
      // mentioning the tokens (e.g. a removal-explanation comment)
      // will NOT re-fire the regex.
      const indexUrl = new URL('../../src/index.ts', import.meta.url);
      const indexSrc = await readFile(indexUrl, 'utf8');
      const inExportList = (name: string): RegExp =>
        new RegExp(`(?:^\\s*${name}\\s*,?\\s*$)|(?:\\{[^}]*\\b${name}\\b[^}]*\\})`, 'm');
      expect(indexSrc).not.toMatch(inExportList('IngestTask'));
      expect(indexSrc).not.toMatch(inExportList('IngestQueueConfig'));
      expect(indexSrc).not.toMatch(inExportList('Memory'));
    },
    SLOW_TEST_TIMEOUT_MS,
  );
});
