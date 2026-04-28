import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    it('secureAndRedact() uses configured custom privacy patterns', async () => {
      const keysDir = mkdtempSync(join(tmpdir(), 'pristine-client-keys-'));
      try {
        const client = await PristineLocal.create({
          db: deps.db,
          llmClients: deps.llmClients,
          embedder: deps.embedder,
          keysDir,
          privacy: {
            customPatternsPath: '/tmp/pristine-client-missing-redaction.json',
            customPatterns: [
              {
                id: 'client-acme',
                type: 'api_key',
                pattern: '\\bacme_tk_[A-Za-z0-9]{8}\\b',
                confidence: 0.95,
              },
            ],
          },
        });

        const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
        const result = await client.secureAndRedact(original, 'client-user');

        expect(result.ok).toBe(true);
        if (!result.ok) {
          throw new Error(`Expected privacy success, got ${result.reason}`);
        }

        expect(result.redactedText).toContain('[SENSITIVE:');
        expect(result.redactedText).not.toContain('sk-ant-api03');
        expect(result.redactedText).not.toContain('acme_tk_ABC12345');
        expect(result.placeholderIds).toHaveLength(2);

        const revealed = await client.reveal(result.redactedText, 'client-user');
        expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
        expect(revealed.text).toContain('acme_tk_ABC12345');
      } finally {
        rmSync(keysDir, { recursive: true, force: true });
      }
    });

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

    it('scrubOutput() uses configured custom privacy patterns', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        llmClients: deps.llmClients,
        embedder: deps.embedder,
        privacy: {
          customPatternsPath: '/tmp/pristine-client-missing-redaction.json',
          customPatterns: [
            {
              id: 'client-acme',
              type: 'api_key',
              pattern: '\\bacme_tk_[A-Za-z0-9]{8}\\b',
              confidence: 0.95,
            },
          ],
        },
      });

      const result = client.scrubOutput('Tool output leaked acme_tk_ABC12345', []);

      expect(result).not.toContain('acme_tk_ABC12345');
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
});
