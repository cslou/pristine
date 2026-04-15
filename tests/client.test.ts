import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PristineLocal } from '../src/client.js';
import { createDatabase } from '../src/core/database.js';
import { IngestQueueError } from '../src/core/errors.js';
import type { LlmClient, Embedder } from '../src/core/interfaces.js';
import type { LlmClients } from '../src/engine/index.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const createMockLlmClient = (): LlmClient => {
  const generate = async ({ systemPrompt }: { systemPrompt: string }): Promise<unknown> => {
    if (systemPrompt.includes('memory consolidation')) {
      return { decisions: [{ action: 'ADD', factIndex: 0 }] };
    }
    if (systemPrompt.includes('query analysis') || systemPrompt.includes('analyze')) {
      return {
        intent: 'factual_lookup',
        filters: {},
        suggestedTopK: 5,
        rewrittenQuery: 'test query',
      };
    }
    // Extractor default
    return {
      facts: [{ text: 'The user likes tea', validFrom: new Date().toISOString() }],
    };
  };
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
      expect(client.orchestrator).toBeDefined();
    });
  });

  describe('memory API', () => {
    it('store() delegates to orchestrator and returns IngestResult', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      const result = await client.store([{ role: 'user', content: 'I like tea' }], 'test-user');

      expect(result).toBeDefined();
      expect(result.facts).toBeDefined();
      expect(result.errors).toBeDefined();
    });

    it('search() delegates to orchestrator and returns RetrieveResult', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      // Ingest first so there's something to find
      await client.store([{ role: 'user', content: 'I like tea' }], 'test-user');

      const result = await client.search('what does the user like?', 'test-user');

      expect(result).toBeDefined();
      expect(result.memories).toBeDefined();
      expect(result.metadata).toBeDefined();
    });

    it('search() accepts SearchOptions with topK', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      await client.store([{ role: 'user', content: 'I like tea' }], 'test-user');

      const result = await client.search('what does the user like?', 'test-user', { topK: 5 });

      expect(result).toBeDefined();
      expect(result.memories).toBeDefined();
    });

    it('search() accepts SearchOptions with temporalMode', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      await client.store([{ role: 'user', content: 'I like tea' }], 'test-user');

      const resultCurrent = await client.search('tea', 'test-user', { temporalMode: 'current' });
      expect(resultCurrent).toBeDefined();

      const resultFull = await client.search('tea', 'test-user', { temporalMode: 'full' });
      expect(resultFull).toBeDefined();
    });

    it('search() without options is backward compatible', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      await client.store([{ role: 'user', content: 'I like tea' }], 'test-user');

      // Two-arg call should still work
      const result = await client.search('tea', 'test-user');
      expect(result).toBeDefined();
      expect(result.memories).toBeDefined();
    });
  });

  describe('conversation API', () => {
    it('searchConversations() returns matching conversations', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      // Store a conversation first (via store() which writes to ConversationStore)
      await client.store([{ role: 'user', content: 'I love espresso coffee' }], 'test-user');

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
      await client.store(messages, 'test-user');

      // Find the conversation via search
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

  describe('orchestrator property', () => {
    it('exposes orchestrator for advanced pipeline access', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      expect(client.orchestrator.ingest).toBeTypeOf('function');
      expect(client.orchestrator.retrieve).toBeTypeOf('function');
      expect(client.orchestrator.ingestSteps).toBeDefined();
      expect(client.orchestrator.retrieveSteps).toBeDefined();
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
      expect(client.ingestQueue.enqueue).toBeTypeOf('function');
      expect(client.ingestQueue.claimNext).toBeTypeOf('function');
      expect(client.ingestQueue.processNext).toBeTypeOf('function');
    });
  });

  describe('storeAsync()', () => {
    it('enqueues a conversation and returns task ID', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      const taskId = client.storeAsync([{ role: 'user', content: 'I like coffee' }], 'test-user');

      expect(taskId).toBeTruthy();
      expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
      expect(client.ingestQueue.pending).toBe(1);
    });

    it('returns empty string for duplicate conversation', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
      });

      client.storeAsync([{ role: 'user', content: 'I like coffee' }], 'test-user');
      const result = client.storeAsync([{ role: 'user', content: 'I like coffee' }], 'test-user');

      expect(result).toBe('');
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

    it('storeAsync() works on lite clients', () => {
      const liteDb = createDatabase(':memory:');
      const client = PristineLocal.createLite({ db: liteDb });

      const taskId = client.storeAsync([{ role: 'user', content: 'Hello from lite' }], 'lite-user');

      expect(taskId).toBeTruthy();
      expect(client.ingestQueue.pending).toBe(1);

      liteDb.close();
    });

    it('searchConversations() works on lite clients', () => {
      const liteDb = createDatabase(':memory:');
      const client = PristineLocal.createLite({ db: liteDb });

      client.storeAsync([{ role: 'user', content: 'I love espresso coffee' }], 'lite-user');

      const results = client.searchConversations({
        userId: 'lite-user',
        keyword: 'espresso',
      });

      expect(results).toHaveLength(1);
      expect(results[0].snippet).toContain('<b>espresso</b>');

      liteDb.close();
    });

    it('getConversation() works on lite clients', () => {
      const liteDb = createDatabase(':memory:');
      const client = PristineLocal.createLite({ db: liteDb });

      client.storeAsync([{ role: 'user', content: 'Test message' }], 'lite-user');

      const conversations = client.searchConversations({ userId: 'lite-user' });
      const detail = client.getConversation(conversations[0].id);

      expect(detail).not.toBeNull();
      expect(detail!.messages).toHaveLength(1);
      expect(detail!.messages[0].content).toBe('Test message');

      liteDb.close();
    });

    it('store() throws IngestQueueError on lite client', async () => {
      const liteDb = createDatabase(':memory:');
      const client = PristineLocal.createLite({ db: liteDb });

      await expect(client.store([{ role: 'user', content: 'test' }], 'lite-user')).rejects.toThrow(
        IngestQueueError,
      );

      await expect(client.store([{ role: 'user', content: 'test' }], 'lite-user')).rejects.toThrow(
        'store() requires a full client',
      );

      liteDb.close();
    });

    it('search() throws IngestQueueError on lite client', async () => {
      const liteDb = createDatabase(':memory:');
      const client = PristineLocal.createLite({ db: liteDb });

      await expect(client.search('query', 'lite-user')).rejects.toThrow(IngestQueueError);

      await expect(client.search('query', 'lite-user')).rejects.toThrow(
        'search() requires a full client',
      );

      liteDb.close();
    });
  });
});
