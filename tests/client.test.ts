import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PristineLocal } from '../src/client.js';
import { createDatabase } from '../src/core/database.js';
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
});
