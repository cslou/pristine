/**
 * Public-API smoke test — verifies `PristineLocal.create()` boots cleanly
 * without contacting any live model or filesystem path, and that the
 * public API round-trips end-to-end within a single process: `storeAsync`
 * enqueues; `getConversation` returns the enqueued conversation by id.
 */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/core/database.js';
import * as PristineBarrel from '../../src/index.js';
import {
  AppError,
  ConfigError,
  EmbedderError,
  IngestQueueError,
  PristineLocal,
  createDatabase as createDatabaseFromBarrel,
} from '../../src/index.js';
import type { Embedder } from '../../src/core/interfaces.js';

const makeEmbedderStub = (): Embedder => ({
  embed: vi.fn(async () => Array.from({ length: 768 }, () => 0)),
  embedBatch: vi.fn(async (texts: readonly string[]) =>
    texts.map(() => Array.from({ length: 768 }, () => 0)),
  ),
});

describe('public-API smoke — PristineLocal boots and the public API round-trips', () => {
  const databases: Database.Database[] = [];

  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  it('create() succeeds with DI overrides (no model contact)', async () => {
    const db = createDatabase(':memory:');
    // NB: don't push to `databases` — client.dispose() with DI-provided deps
    // leaves the DB to the caller (ownsDb=false). We close it in finally so
    // a dispose rejection still releases the handle.

    const client = await PristineLocal.create({
      db,
      embedder: makeEmbedderStub(),
    });

    try {
      expect(client).toBeInstanceOf(PristineLocal);
      expect(typeof client.pendingEmbedTasks).toBe('number');

      await client.dispose();
    } finally {
      db.close();
    }
  });

  it('src/index.ts public barrel exports the public-API surface (import-level check)', () => {
    // Named-export contract — all symbols an SDK consumer needs must
    // resolve to defined values at import time. A future refactor that
    // silently drops one of these exports breaks downstream imports at
    // consume-site with no local signal; this test catches it at the barrel.
    expect(PristineLocal).toBeTypeOf('function');
    expect(createDatabaseFromBarrel).toBeTypeOf('function');
    expect(AppError).toBeTypeOf('function');
    expect(ConfigError).toBeTypeOf('function');
    expect(EmbedderError).toBeTypeOf('function');
    expect(IngestQueueError).toBeTypeOf('function');

    // Wildcard-import sanity: the barrel's named-export shape is a closed
    // set. `toEqual` with an exact sorted list catches both missing exports
    // (regression) and accidental re-exports (sprawl) — `arrayContaining`
    // only enforces the subset, which would silently pass extras through.
    // `IngestQueue` is internal-only plumbing; `IngestQueueError` stays
    // because consumers catch it. `InvalidArgumentError` is on the barrel
    // because the two passthrough methods (drainEmbedQueue,
    // buildSessionVector) narrow their error set to this single class —
    // consumers need it for typed catches.
    const keys = Object.keys(PristineBarrel).sort();
    expect(keys).toEqual([
      'AppError',
      'ConfigError',
      'EmbedderError',
      'IngestQueueError',
      'InvalidArgumentError',
      'InvalidSqlError',
      'PristineLocal',
      'QueryTimeoutError',
      'createDatabase',
    ]);
  });

  it('public surface round-trips a conversation (storeAsync → getConversation)', async () => {
    const db = createDatabase(':memory:');
    // storeAsync requires Pristine.create() (the indexer pipeline needs an
    // embedder). Use the stub embedder to keep the smoke fast and offline.
    const client = await PristineLocal.create({
      db,
      embedder: makeEmbedderStub(),
    });

    try {
      const messages = [
        { role: 'user' as const, content: 'I love espresso with cardamom' },
        { role: 'assistant' as const, content: 'Great choice — try a Turkish pull.' },
      ];
      const conversationId = client.storeAsync(messages, 'user-phase1');
      expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);

      const detail = client.getConversation(conversationId);
      expect(detail).not.toBeNull();
      expect(detail!.messages).toHaveLength(2);
      expect(detail!.messages[0].content).toContain('cardamom');
    } finally {
      await client.dispose();
      db.close();
    }
  });

  it('privacy scrubOutput() works without ingest', async () => {
    const db = createDatabase(':memory:');
    databases.push(db);

    const client = await PristineLocal.create({ db, embedder: makeEmbedderStub() });
    const scrubbed = client.scrubOutput(
      'Hello [SENSITIVE:name:abc-123], here is your confirmation.',
      [],
    );

    // Full output check, not just negative: the placeholder is stripped in
    // place (no spacing fix-up) and no stray tokens remain.
    expect(scrubbed).toBe('Hello , here is your confirmation.');
    expect(scrubbed).not.toContain('[SENSITIVE:');
  });
});
