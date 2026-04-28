import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PristineLocal } from '../src/client.js';
import { createDatabase } from '../src/core/database.js';
import { InvalidArgumentError } from '../src/core/errors.js';
import type { LlmClient, Embedder } from '../src/core/interfaces.js';
import type { LlmClients } from '../src/engine/index.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const createMockLlmClient = (): LlmClient => {
  const generate = async (): Promise<unknown> => ({});
  return { generate: generate as LlmClient['generate'] };
};

const createMockEmbedder = (): Embedder & { dispose: ReturnType<typeof vi.fn> } => ({
  embed: vi.fn(async () => Array.from({ length: 768 }, () => Math.random())),
  embedBatch: vi.fn(async (texts: readonly string[]) =>
    texts.map(() => Array.from({ length: 768 }, () => Math.random())),
  ),
  dispose: vi.fn(async () => undefined),
});

const createTestDeps = (): {
  db: Database.Database;
  llmClients: LlmClients;
  embedder: Embedder & { dispose: ReturnType<typeof vi.fn> };
} => {
  const mockClient = createMockLlmClient();
  return {
    db: createDatabase(':memory:'),
    llmClients: { privacyClient: mockClient, memoryClient: mockClient },
    embedder: createMockEmbedder(),
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PristineLocal', () => {
  let deps: ReturnType<typeof createTestDeps>;

  beforeEach(() => {
    deps = createTestDeps();
  });

  afterEach(async () => {
    deps.db.close();
  });

  describe('create()', () => {
    it('creates a client with DI overrides (no filesystem access)', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      expect(client).toBeInstanceOf(PristineLocal);
    });
  });

  describe('conversation API', () => {
    it('searchConversations() returns matching conversations after storeAsync', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      client.storeAsync([{ role: 'user', content: 'I love espresso coffee' }], 'test-user');

      const results = client.searchConversations({
        userId: 'test-user',
        keyword: 'espresso',
      });

      expect(results).toHaveLength(1);
      expect(results[0].snippet).toContain('<b>espresso</b>');
      expect(results[0].messageCount).toBe(1);
    });

    it('searchConversations() returns empty for no matches', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      const results = client.searchConversations({
        userId: 'test-user',
        keyword: 'nonexistent',
      });

      expect(results).toHaveLength(0);
    });

    it('getConversation() returns full conversation with messages', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there' },
      ];
      client.storeAsync(messages, 'test-user');

      const searchResults = client.searchConversations({ userId: 'test-user' });
      expect(searchResults.length).toBeGreaterThan(0);

      const detail = client.getConversation(searchResults[0].id);
      expect(detail).not.toBeNull();
      expect(detail?.userId).toBe('test-user');
      expect(detail?.messages).toHaveLength(2);
      expect(detail?.messages[0].role).toBe('user');
      expect(detail?.messages[0].content).toBe('Hello');
      expect(detail?.messages[1].role).toBe('assistant');
      expect(detail?.messages[1].content).toBe('Hi there');
    });

    it('getConversation() returns null for nonexistent ID', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      const result = client.getConversation('nonexistent-id');
      expect(result).toBeNull();
    });
  });

  describe('privacy API', () => {
    it('scrubOutput() removes placeholder tokens', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      const result = client.scrubOutput(
        'Hello [SENSITIVE:name:abc-123], your card is [SENSITIVE:credit_card:def-456]',
        [],
      );

      expect(result).toBe('Hello , your card is ');
      expect(result).not.toContain('[SENSITIVE:');
    });
  });

  describe('dispose()', () => {
    it('does not dispose DI-provided embedder', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      await client.dispose();
      expect(deps.embedder.dispose).not.toHaveBeenCalled();
    });

    it('does not close DI-provided database', async () => {
      const closeSpy = vi.spyOn(deps.db, 'close');

      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      await client.dispose();
      expect(closeSpy).not.toHaveBeenCalled();
    });
  });

  describe('ingestQueue property', () => {
    it('exposes ingestQueue on full client', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      expect(client.ingestQueue).toBeDefined();
      expect(client.ingestQueue.claimNext).toBeTypeOf('function');
      expect(client.ingestQueue.processNext).toBeTypeOf('function');
    });
  });

  describe('storeAsync()', () => {
    it('stores conversation, returns conversationId, and enqueues one embed task per message', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      const conversationId = client.storeAsync(
        [
          { role: 'user', content: 'I like coffee' },
          { role: 'assistant', content: 'Espresso is excellent' },
        ],
        'test-user',
      );

      expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);
      // Indexer enqueues one embed-message task per inserted message.
      expect(client.ingestQueue.pending).toBe(2);
    });

    it('returns existing conversationId for duplicate conversation without re-enqueueing', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      const messages = [{ role: 'user' as const, content: 'I like coffee' }];
      const first = client.storeAsync(messages, 'test-user');
      const second = client.storeAsync(messages, 'test-user');

      expect(second).toBe(first);
      // Only the first call enqueued tasks; the duplicate path returns early.
      expect(client.ingestQueue.pending).toBe(1);
    });
  });

  describe('createLite()', () => {
    it('creates a lite client with in-memory DB', () => {
      const liteDb = createDatabase(':memory:');
      const client = PristineLocal.createLite({ db: liteDb });

      expect(client).toBeInstanceOf(PristineLocal);
      expect(client.ingestQueue).toBeDefined();

      liteDb.close();
    });

    it('storeAsync() throws on lite clients (no embedder, no indexer)', () => {
      const liteDb = createDatabase(':memory:');
      const client = PristineLocal.createLite({ db: liteDb });

      expect(() =>
        client.storeAsync([{ role: 'user', content: 'Hello from lite' }], 'lite-user'),
      ).toThrow(InvalidArgumentError);

      liteDb.close();
    });

    it('searcher is null on lite clients (no embedder)', () => {
      const liteDb = createDatabase(':memory:');
      const client = PristineLocal.createLite({ db: liteDb });

      expect(client.searcher).toBeNull();

      liteDb.close();
    });
  });

  describe('searcher exposure', () => {
    it('full client exposes pristine.searcher with vectorSearch method', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      expect(client.searcher).not.toBeNull();
      expect(typeof client.searcher?.vectorSearch).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // Sprint-018 Story 2 — drainEmbedQueue passthrough
  // -------------------------------------------------------------------------

  describe('drainEmbedQueue()', () => {
    it('returns 0 when the queue is empty (idempotent)', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      // No storeAsync calls → no pending tasks. Drain should resolve to 0
      // without side effects.
      await expect(client.drainEmbedQueue()).resolves.toBe(0);
    });

    it('returns the count of tasks processed after storeAsync enqueues them', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      const turns = [
        { role: 'user' as const, content: 'turn one — drain me' },
        { role: 'assistant' as const, content: 'turn two — drain me too' },
        { role: 'user' as const, content: 'turn three — and me' },
      ];
      client.storeAsync(turns, 'drain-user', 'drain-project');

      // 3 messages → 3 embed-message tasks per indexer's per-message
      // enqueue policy. Drain returns the same count.
      const drained = await client.drainEmbedQueue();
      expect(drained).toBe(3);

      // Idempotent: a second drain on an empty queue returns 0.
      await expect(client.drainEmbedQueue()).resolves.toBe(0);
    });

    it('throws InvalidArgumentError on lite clients (no embedder)', async () => {
      const liteDb = createDatabase(':memory:');
      const client = PristineLocal.createLite({ db: liteDb });

      // The error is thrown synchronously inside the async method's first
      // tick, so the rejection arrives via the returned promise.
      await expect(client.drainEmbedQueue()).rejects.toBeInstanceOf(InvalidArgumentError);

      liteDb.close();
    });
  });

  // -------------------------------------------------------------------------
  // Sprint-018 Story 3 — buildSessionVector passthrough
  // -------------------------------------------------------------------------

  describe('buildSessionVector()', () => {
    it('throws InvalidArgumentError on lite clients (no embedder)', async () => {
      const liteDb = createDatabase(':memory:');
      const client = PristineLocal.createLite({ db: liteDb });

      await expect(client.buildSessionVector('any-id')).rejects.toBeInstanceOf(
        InvalidArgumentError,
      );

      liteDb.close();
    });

    it('throws InvalidArgumentError when conversationId is empty', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      const promise = client.buildSessionVector('');
      await expect(promise).rejects.toBeInstanceOf(InvalidArgumentError);
      await expect(promise).rejects.toThrow(/conversationId.*required|empty/i);
    });

    it('throws InvalidArgumentError (single class) when conversationId does not exist, with the literal id in the message', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      const missingId = 'does-not-exist-12345';
      // Underlying indexer raises ConversationNotFoundError; the shim
      // narrows the public-surface contract to InvalidArgumentError so
      // callers have one type to catch. The original message
      // (containing the literal id) is preserved.
      const promise = client.buildSessionVector(missingId);
      await expect(promise).rejects.toBeInstanceOf(InvalidArgumentError);
      await expect(promise).rejects.toThrow(/does-not-exist-12345/);
    });

    it('delegates to indexer.buildSessionVector — populates vec_sessions for an existing conversation', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      const conversationId = client.storeAsync(
        [
          { role: 'user', content: 'session vector test — turn one' },
          { role: 'assistant', content: 'session vector test — turn two' },
        ],
        'sv-user',
        'sv-project',
      );
      // Drain so message rows exist (storeAsync inserts them via the
      // indexer transaction; this is purely defensive — buildSessionVector
      // reads `messages`, not `vec_windows`).
      await client.drainEmbedQueue();

      // Pre-call: no row in vec_sessions for this conversation.
      const before = deps.db
        .prepare('SELECT COUNT(*) AS n FROM vec_sessions WHERE conversation_id = ?')
        .get(conversationId) as { n: number };
      expect(before.n).toBe(0);

      await client.buildSessionVector(conversationId);

      // Post-call: exactly one row.
      const after = deps.db
        .prepare('SELECT COUNT(*) AS n FROM vec_sessions WHERE conversation_id = ?')
        .get(conversationId) as { n: number };
      expect(after.n).toBe(1);
    });
  });
});
