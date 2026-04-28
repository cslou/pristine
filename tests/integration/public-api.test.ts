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
});
