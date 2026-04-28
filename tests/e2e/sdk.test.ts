/**
 * SDK integration test — exercises the public API surface.
 * Imports from the barrel (src/index.ts) for all business types/classes.
 * One internal import: createDatabase (loads sqlite-vec extension for in-memory DB).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/core/database.js';
import type { Embedder, LlmClient, LlmClients } from '../../src/index.js';
import { PristineLocal } from '../../src/index.js';

const skipSlow = process.env.SKIP_SLOW_TESTS === '1';

// ---------------------------------------------------------------------------
// Mock LlmClient
// ---------------------------------------------------------------------------

const createMockLlmClient = (): LlmClient => {
  const generate = async ({
    systemPrompt,
    userPrompt,
  }: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<unknown> => {
    // Consolidator
    if (systemPrompt.includes('memory consolidation')) {
      const factCount = (userPrompt.match(/NEW fact/gi) ?? []).length || 1;
      return {
        decisions: Array.from({ length: factCount }, (_, i) => ({
          action: 'ADD',
          factIndex: i,
        })),
      };
    }

    // Query analyzer
    if (systemPrompt.includes('query analysis') || systemPrompt.includes('analyze')) {
      return {
        intent: 'factual_lookup',
        filters: {},
        suggestedTopK: 5,
        rewrittenQuery: userPrompt,
      };
    }

    // Extractor (default)
    return {
      facts: [
        {
          text: 'The user lives in Berlin',
          validFrom: new Date().toISOString(),
        },
        {
          text: 'The user works as a designer',
          validFrom: new Date().toISOString(),
        },
      ],
    };
  };

  return { generate: generate as LlmClient['generate'] };
};

const createMockEmbedder = (): Embedder => ({
  embed: async () => Array.from({ length: 768 }, () => 0),
  embedBatch: async (texts: readonly string[]) =>
    texts.map(() => Array.from({ length: 768 }, () => 0)),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(skipSlow)(
  'SDK public API end-to-end',
  () => {
    let client: PristineLocal;
    const mockClient = createMockLlmClient();
    const llmClients: LlmClients = { privacyClient: mockClient, memoryClient: mockClient };

    beforeAll(async () => {
      client = await PristineLocal.create({
        db: createDatabase(':memory:'),
        llmClients,
        embedder: createMockEmbedder(),
        keysDir: '/tmp/pristine-sdk-test-keys',
        privacy: {
          customPatternsPath: '/tmp/pristine-sdk-missing-redaction.json',
          customPatterns: [
            {
              id: 'sdk-acme',
              type: 'api_key',
              pattern: '\\bacme_tk_[A-Za-z0-9]{8}\\b',
              confidence: 0.95,
            },
          ],
        },
      });
    });

    afterAll(async () => {
      if (client) {
        await client.dispose();
      }
    });

    it('store() + search() round-trip returns matching facts', async () => {
      await client.store(
        [
          { role: 'user', content: 'I just moved to Berlin and work as a designer.' },
          { role: 'assistant', content: 'Welcome to Berlin! How do you like it so far?' },
        ],
        'sdk-user-1',
      );

      const result = await client.search('Where does the user live?', 'sdk-user-1');

      expect(result.memories.length).toBeGreaterThan(0);
      const texts = result.memories.map((m) => m.memory.text.toLowerCase());
      expect(texts.some((t) => t.includes('berlin'))).toBe(true);
    }, 120_000);

    it('secureAndRedact() + reveal() round-trip recovers secrets', async () => {
      const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
      const result = await client.secureAndRedact(original, 'sdk-user-2');

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`Expected privacy success, got ${result.reason}`);
      }

      const { redactedText, placeholderIds } = result;

      expect(redactedText).toContain('[SENSITIVE:');
      expect(redactedText).not.toContain('sk-ant-api03');
      expect(redactedText).not.toContain('acme_tk_ABC12345');
      expect(placeholderIds).toHaveLength(2);

      const revealed = await client.reveal(redactedText, 'sdk-user-2');
      expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
      expect(revealed.text).toContain('acme_tk_ABC12345');
      expect(revealed.revealedValues).toContain('acme_tk_ABC12345');
    }, 120_000);

    it('scrubOutput() removes placeholder tokens', () => {
      const text = 'Hello [SENSITIVE:name:abc-123], how are you?';
      const scrubbed = client.scrubOutput(text, []);
      expect(scrubbed).toBe('Hello , how are you?');
    });

    it('dispose() completes without error', async () => {
      const disposableClient = await PristineLocal.create({
        db: createDatabase(':memory:'),
        llmClients,
        embedder: createMockEmbedder(),
      });
      await expect(disposableClient.dispose()).resolves.toBeUndefined();
    });
  },
  600_000,
);
