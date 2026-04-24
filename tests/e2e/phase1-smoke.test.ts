/**
 * Phase-1 smoke test — verifies PristineLocal.create() and createLite() boot
 * cleanly with no live LLM connection (neither llamacpp nor ollama).
 *
 * Satisfies sprint-013 Story 4 AC: "A minimal integration smoke test
 * demonstrates PristineLocal.create() succeeding with neither llamacpp nor
 * ollama configured." The test injects stub LlmClient factories so
 * construction exercises no network / filesystem / model-config path.
 *
 * The Phase-1 public API is also exercised end-to-end within a single
 * process: storeAsync enqueues; searchConversations + getConversation
 * return the enqueued conversation by keyword and by id.
 */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/core/database.js';
import { PristineLocal } from '../../src/index.js';
import type { LlmClient, Embedder } from '../../src/core/interfaces.js';
import type { LlmClients } from '../../src/engine/index.js';

const makeLlmStub = (): LlmClient => ({
  generate: (async () => ({})) as LlmClient['generate'],
});

const makeEmbedderStub = (): Embedder => ({
  embed: vi.fn(async () => Array.from({ length: 768 }, () => 0)),
  embedBatch: vi.fn(async (texts: readonly string[]) =>
    texts.map(() => Array.from({ length: 768 }, () => 0)),
  ),
});

describe('Phase-1 smoke — PristineLocal boots and the public API round-trips', () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  it('create() succeeds with DI overrides (no llamacpp / ollama contact)', async () => {
    const db = createDatabase(':memory:');
    // NB: don't push to `databases` — client.dispose() below closes the DI-provided
    // DB via its `ownsDb=false` guard, so afterEach's teardown would double-close.
    // (ownsDb is true only when PristineLocal allocated the DB itself — injected
    // DBs are the caller's responsibility, and we mirror that by leaving cleanup
    // to the explicit dispose() call.)

    const llmClients: LlmClients = {
      privacyClient: makeLlmStub(),
      memoryClient: makeLlmStub(),
    };

    const client = await PristineLocal.create({
      db,
      llmClients,
      embedder: makeEmbedderStub(),
    });

    expect(client).toBeInstanceOf(PristineLocal);
    expect(client.ingestQueue).toBeDefined();

    await client.dispose();
    db.close();
  });

  it('createLite() succeeds with no LlmClient or Embedder at all', () => {
    const db = createDatabase(':memory:');
    databases.push(db);

    const client = PristineLocal.createLite({ db });

    expect(client).toBeInstanceOf(PristineLocal);
    expect(client.ingestQueue).toBeDefined();
  });

  it('Phase-1 public surface round-trips a conversation (storeAsync → searchConversations → getConversation)', () => {
    const db = createDatabase(':memory:');
    databases.push(db);

    const client = PristineLocal.createLite({ db });

    const messages = [
      { role: 'user' as const, content: 'I love espresso with cardamom' },
      { role: 'assistant' as const, content: 'Great choice — try a Turkish pull.' },
    ];
    const taskId = client.storeAsync(messages, 'user-phase1');
    expect(taskId).toMatch(/^[0-9a-f-]{36}$/);

    const hits = client.searchConversations({ userId: 'user-phase1', keyword: 'cardamom' });
    expect(hits).toHaveLength(1);

    const detail = client.getConversation(hits[0].id);
    expect(detail).not.toBeNull();
    expect(detail!.messages).toHaveLength(2);
    expect(detail!.messages[0].content).toContain('cardamom');
  });

  it('privacy scrubOutput() works with no live LLM', () => {
    const db = createDatabase(':memory:');
    databases.push(db);

    const client = PristineLocal.createLite({ db });
    const scrubbed = client.scrubOutput(
      'Hello [SENSITIVE:name:abc-123], here is your confirmation.',
      [],
    );

    // Full output check, not just negative: the placeholder is stripped in
    // place (no spacing fix-up in Phase 1) and no stray tokens remain.
    expect(scrubbed).toBe('Hello , here is your confirmation.');
    expect(scrubbed).not.toContain('[SENSITIVE:');
  });
});
