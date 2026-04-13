/**
 * Conversation store end-to-end tests.
 * Verifies the full workflow: ingest -> search facts -> follow sourceConversationId -> get conversation.
 * Uses PristineLocal with real embedder, in-memory SQLite, and mocked LlmClient.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/core/database.js';
import { PristineLocal } from '../../src/index.js';
import type { LlmClient } from '../../src/index.js';
import type { LlmClients } from '../../src/engine/index.js';
import { createLocalEmbedder } from '../../src/embedder/local/index.js';
import type { Embedder } from '../../src/core/interfaces.js';

const skipSlow = process.env.SKIP_SLOW_TESTS === '1';

// ---------------------------------------------------------------------------
// Mock LlmClient — extracts facts from the actual conversation content
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

    // Extractor: return facts based on conversation content
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

describe.skipIf(skipSlow)('conversation store end-to-end', () => {
  let client: PristineLocal;
  let embedder: Embedder & { dispose: () => Promise<void> };
  let db: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    db = createDatabase(':memory:');
    embedder = createLocalEmbedder();
    const mockClient = createMockLlmClient();
    const llmClients: LlmClients = {
      privacyClient: mockClient,
      memoryClient: mockClient,
    };

    client = await PristineLocal.create({ db, llmClients, embedder });
  });

  afterAll(async () => {
    await client.dispose();
    await embedder.dispose();
    db.close();
  });

  it('ingest -> search fact -> follow sourceConversationId -> get conversation', async () => {
    const messages = [
      { role: 'user' as const, content: 'I just got back from Tokyo, it was amazing!' },
      {
        role: 'assistant' as const,
        content: 'That sounds wonderful! What was your favorite part?',
      },
    ];

    const ingestResult = await client.store(messages, 'e2e-conv-user-1');
    expect(ingestResult.facts.length).toBeGreaterThan(0);

    // Search for the fact
    const searchResult = await client.search('Tokyo travel', 'e2e-conv-user-1');
    expect(searchResult.memories.length).toBeGreaterThan(0);

    // Follow sourceConversationId to the original conversation
    const sourceId = searchResult.memories[0].memory.sourceConversationId;
    expect(sourceId).toBeDefined();
    expect(typeof sourceId).toBe('string');

    const conversation = client.getConversation(sourceId!);
    expect(conversation).not.toBeNull();
    expect(conversation!.userId).toBe('e2e-conv-user-1');
    expect(conversation!.messages).toHaveLength(2);
    expect(conversation!.messages[0].content).toBe(messages[0].content);
    expect(conversation!.messages[1].content).toBe(messages[1].content);
  }, 120_000);

  it('searchConversations finds the right conversation by keyword', async () => {
    // Store two different conversations
    await client.store(
      [{ role: 'user', content: 'I loved the sushi in Tokyo' }],
      'e2e-conv-user-2',
    );
    await client.store(
      [{ role: 'user', content: 'The museums in Berlin were incredible' }],
      'e2e-conv-user-2',
    );

    // Search for Tokyo — should find only the first
    const results = client.searchConversations({
      userId: 'e2e-conv-user-2',
      keyword: 'Tokyo',
    });

    expect(results).toHaveLength(1);
    expect(results[0].snippet).toContain('<b>Tokyo</b>');
  }, 120_000);

  it('dedup prevents duplicate conversations', async () => {
    const messages = [{ role: 'user' as const, content: 'My favorite color is green' }];

    await client.store(messages, 'e2e-conv-user-3');
    await client.store(messages, 'e2e-conv-user-3');

    // Only one conversation should exist
    const results = client.searchConversations({ userId: 'e2e-conv-user-3' });
    expect(results).toHaveLength(1);
  }, 120_000);
});
