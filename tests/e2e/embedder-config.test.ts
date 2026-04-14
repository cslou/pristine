/**
 * Embedder config end-to-end tests.
 * Verifies factory wiring, temporalMode filtering, backward compat,
 * and conversation store regression. Uses mock embedder (no Ollama required).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/core/database.js';
import { PristineLocal } from '../../src/index.js';
import type { LlmClient, Embedder } from '../../src/index.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const createMockEmbedder = (): Embedder => ({
  embed: vi.fn(async () => Array.from({ length: 768 }, () => Math.random())),
  embedBatch: vi.fn(async (texts: readonly string[]) =>
    texts.map(() => Array.from({ length: 768 }, () => Math.random())),
  ),
});

const createMockLlmClient = (): LlmClient => {
  const generate = async ({
    systemPrompt,
    userPrompt,
  }: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<unknown> => {
    if (systemPrompt.includes('memory consolidation')) {
      const factCount = (userPrompt.match(/NEW fact/gi) ?? []).length || 1;
      return {
        decisions: Array.from({ length: factCount }, (_, i) => ({
          action: 'ADD',
          factIndex: i,
        })),
      };
    }

    if (systemPrompt.includes('query analysis') || systemPrompt.includes('analyze')) {
      return {
        intent: 'factual_lookup',
        filters: {},
        suggestedTopK: 10,
        rewrittenQuery: userPrompt,
      };
    }

    // Extractor
    const now = new Date().toISOString();
    return {
      facts: [{ text: 'The user shared a fact', validFrom: now }],
    };
  };

  return { generate: generate as LlmClient['generate'] };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('embedder config e2e', () => {
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    db = createDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('backward compat: missing embedder config falls back to mock embedder via DI', async () => {
    const mockClient = createMockLlmClient();
    const embedder = createMockEmbedder();
    const client = await PristineLocal.create({
      db,
      llmClients: { privacyClient: mockClient, memoryClient: mockClient },
      embedder,
    });

    await client.store([{ role: 'user', content: 'I like coffee' }], 'config-user-1');
    const result = await client.search('coffee', 'config-user-1');

    expect(result.memories.length).toBeGreaterThan(0);
    await client.dispose();
  });

  it('search with temporalMode "full" returns facts', async () => {
    const mockClient = createMockLlmClient();
    const embedder = createMockEmbedder();
    const client = await PristineLocal.create({
      db,
      llmClients: { privacyClient: mockClient, memoryClient: mockClient },
      embedder,
    });

    await client.store([{ role: 'user', content: 'I like hiking' }], 'temporal-user-1');

    // temporalMode 'full' passes through to retriever and returns all facts
    const fullResult = await client.search('hiking', 'temporal-user-1', { temporalMode: 'full' });
    expect(fullResult.memories.length).toBeGreaterThanOrEqual(1);

    await client.dispose();
  });

  it('search with temporalMode "current" is the default', async () => {
    const mockClient = createMockLlmClient();
    const embedder = createMockEmbedder();
    const client = await PristineLocal.create({
      db,
      llmClients: { privacyClient: mockClient, memoryClient: mockClient },
      embedder,
    });

    await client.store([{ role: 'user', content: 'I like tea' }], 'temporal-user-2');

    // Default (no options) behaves the same as explicit 'current'
    const defaultResult = await client.search('tea', 'temporal-user-2');
    const currentResult = await client.search('tea', 'temporal-user-2', {
      temporalMode: 'current',
    });

    expect(defaultResult.memories.length).toBe(currentResult.memories.length);
    await client.dispose();
  });

  it('conversation store regression: searchConversations works', async () => {
    const mockClient = createMockLlmClient();
    const embedder = createMockEmbedder();
    const client = await PristineLocal.create({
      db,
      llmClients: { privacyClient: mockClient, memoryClient: mockClient },
      embedder,
    });

    await client.store([{ role: 'user', content: 'I love espresso coffee' }], 'regression-user-1');

    const results = client.searchConversations({
      userId: 'regression-user-1',
      keyword: 'espresso',
    });

    expect(results).toHaveLength(1);
    expect(results[0].snippet).toContain('<b>espresso</b>');
    await client.dispose();
  });

  it('conversation store regression: getConversation returns messages', async () => {
    const mockClient = createMockLlmClient();
    const embedder = createMockEmbedder();
    const client = await PristineLocal.create({
      db,
      llmClients: { privacyClient: mockClient, memoryClient: mockClient },
      embedder,
    });

    await client.store(
      [
        { role: 'user', content: 'Hello there' },
        { role: 'assistant', content: 'Hi! How can I help?' },
      ],
      'regression-user-2',
    );

    const convResults = client.searchConversations({ userId: 'regression-user-2' });
    expect(convResults.length).toBeGreaterThan(0);

    const detail = client.getConversation(convResults[0].id);
    expect(detail).not.toBeNull();
    expect(detail!.messages).toHaveLength(2);
    expect(detail!.messages[0].role).toBe('user');
    expect(detail!.messages[0].content).toBe('Hello there');
    expect(detail!.messages[1].role).toBe('assistant');
    expect(detail!.messages[1].content).toBe('Hi! How can I help?');
    await client.dispose();
  });
});
