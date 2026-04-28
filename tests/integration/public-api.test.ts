import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import {
  PristineLocal,
  createDatabase,
  type Embedder,
  type LlmClient,
  type LlmClients,
} from '../../src/index.js';

// ---------------------------------------------------------------------------
// Sprint-018 Story 1 — public-API integration harness
// ---------------------------------------------------------------------------
//
// This file is the consumer-eye view of the SDK. It imports ONLY from the
// package barrel (src/index.ts) — the project's ESLint config has an
// override that fails any import resolving under ../../src/* other than
// the barrel. Reaching into internal modules defeats the harness contract:
// the purpose is to exercise the same surface an external SDK consumer
// (pi.dev, Claude Code hooks, etc.) sees.
//
// Stories 2-4 fill this file with RED outer-loop tests; Story 1 ships the
// scaffolding (this commit) + each subsequent commit adds one RED block.

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

const makeStubLlmClient = (): LlmClient => ({
  generate: (async () => ({})) as LlmClient['generate'],
});

const makeLlmClients = (): LlmClients => ({
  privacyClient: makeStubLlmClient(),
  memoryClient: makeStubLlmClient(),
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

describe('public-API integration harness — sprint-018 Story 1', () => {
  let db: Database.Database;
  let client: PristineLocal;

  beforeEach(async () => {
    db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
    client = await PristineLocal.create({
      db,
      llmClients: makeLlmClients(),
      embedder: makeStubEmbedder(),
    });
  });

  afterEach(async () => {
    await client.dispose();
    db.close();
  });

  it('harness boots — barrel imports resolve and PristineLocal.create wires searcher', () => {
    // Smoke test: confirms the harness wiring is intact. If a future
    // Story 4 removal accidentally drops a load-bearing barrel export
    // (e.g. PristineLocal, createDatabase), this test breaks loudly
    // before any RED outer-loop test gets a chance to run.
    expect(client.searcher).not.toBeNull();
    expect(typeof client.storeAsync).toBe('function');
  });

  // -------------------------------------------------------------------------
  // Story 2 outer-loop test — RED until sprint-018 Story 2 ships
  // PristineLocal.drainEmbedQueue.
  //
  // RED mechanism: `// @ts-expect-error` on the call site. The method does
  // not exist on PristineLocal yet, so without the directive `tsc --noEmit`
  // would error and pre-push would block the commit. With it, the file
  // compiles but the runtime call throws `TypeError: client.drainEmbedQueue
  // is not a function`, which is the test's RED state. When Story 2 ships
  // the method, the line is no longer erroneous and the directive itself
  // becomes a TS error (TS6133 "unused '@ts-expect-error' directive"),
  // forcing Story 2 to remove the directive as part of "AC goes GREEN".
  // The forcing function fires at type-level — that's the spirit of Story
  // 1's AC-3 ("TypeScript-level failure"), reconciled with the pre-push
  // typecheck gate.
  // -------------------------------------------------------------------------
  it('round-trip: storeAsync → drainEmbedQueue → hybridSearch returns hits @AC-Story2-1', async () => {
    const { projectId } = await seedPublicApiCorpus(client);
    // @ts-expect-error — sprint-018 Story 2 ships PristineLocal.drainEmbedQueue
    const drained = await client.drainEmbedQueue();
    expect(drained).toBeGreaterThanOrEqual(1);
    // searcher is non-null on Pristine.create() (vs createLite); the
    // smoke test above pins this invariant.
    const hits = await client.searcher!.hybridSearch('hello', { projectId }, 5);
    expect(hits.length).toBeGreaterThan(0);
  });
});
