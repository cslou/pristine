/**
 * Ollama embedder end-to-end tests.
 * Requires a running Ollama server with nomic-embed-text pulled.
 * Skip with SKIP_OLLAMA_TESTS=1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/core/database.js';
import { PristineLocal } from '../../src/index.js';
import type { LlmClient } from '../../src/index.js';
import type { LlmClients } from '../../src/engine/index.js';
import { OllamaEmbedder } from '../../src/embedder/ollama/index.js';

const skipOllama = process.env.SKIP_OLLAMA_TESTS === '1';

// ---------------------------------------------------------------------------
// Mock LlmClient — deterministic extraction for testing embedder path
// ---------------------------------------------------------------------------

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
        suggestedTopK: 5,
        rewrittenQuery: userPrompt,
      };
    }

    const now = new Date().toISOString();
    if (userPrompt.includes('Tokyo')) {
      return {
        facts: [{ text: 'The user recently visited Tokyo', validFrom: now }],
      };
    }
    if (userPrompt.includes('Berlin')) {
      return {
        facts: [{ text: 'The user plans to visit Berlin', validFrom: now }],
      };
    }
    return {
      facts: [{ text: 'The user shared a personal fact', validFrom: now }],
    };
  };

  return { generate: generate as LlmClient['generate'] };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(skipOllama)('Ollama embedder end-to-end', () => {
  let client: PristineLocal;
  let db: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    db = createDatabase(':memory:');
    const mockClient = createMockLlmClient();
    const llmClients: LlmClients = {
      privacyClient: mockClient,
      memoryClient: mockClient,
    };
    const embedder = new OllamaEmbedder({ model: 'nomic-embed-text' });

    client = await PristineLocal.create({ db, llmClients, embedder });
  });

  afterAll(async () => {
    await client.dispose();
    db.close();
  });

  it('PristineLocal.create() with Ollama embedder is near-instant', async () => {
    const start = Date.now();
    const mockClient = createMockLlmClient();
    const testDb = createDatabase(':memory:');
    const testClient = await PristineLocal.create({
      db: testDb,
      llmClients: { privacyClient: mockClient, memoryClient: mockClient },
      embedder: new OllamaEmbedder(),
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
    await testClient.dispose();
    testDb.close();
  });

  it('store() + search() round-trip with Ollama embedding', async () => {
    await client.store(
      [{ role: 'user', content: 'I just got back from Tokyo, it was amazing!' }],
      'ollama-e2e-user-1',
    );

    const result = await client.search('Tokyo travel', 'ollama-e2e-user-1');

    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.memories[0].memory.text).toContain('Tokyo');
  }, 30_000);

  it('searchConversations() works with Ollama embedder', async () => {
    await client.store(
      [{ role: 'user', content: 'I loved the sushi in Tokyo' }],
      'ollama-e2e-user-2',
    );

    const results = client.searchConversations({
      userId: 'ollama-e2e-user-2',
      keyword: 'sushi',
    });

    expect(results).toHaveLength(1);
    expect(results[0].snippet).toContain('<b>sushi</b>');
  }, 30_000);

  it('getConversation() returns full conversation via sourceConversationId', async () => {
    await client.store(
      [
        { role: 'user', content: 'I want to visit Berlin next year' },
        { role: 'assistant', content: 'Berlin is a great choice!' },
      ],
      'ollama-e2e-user-3',
    );

    const searchResult = await client.search('Berlin', 'ollama-e2e-user-3');
    expect(searchResult.memories.length).toBeGreaterThan(0);

    const sourceId = searchResult.memories[0].memory.sourceConversationId;
    expect(sourceId).toBeDefined();

    const conversation = client.getConversation(sourceId!);
    expect(conversation).not.toBeNull();
    expect(conversation!.messages).toHaveLength(2);
    expect(conversation!.messages[0].content).toContain('Berlin');
  }, 30_000);
});
