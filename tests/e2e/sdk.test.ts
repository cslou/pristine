/**
 * SDK integration test — exercises the public API surface only.
 * Imports from src/index.ts (the barrel), not internal modules.
 * Uses DI config: in-memory SQLite + mock LLM + real embedder.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/core/database.js';
import type { LlmClient, LlmClients } from '../../src/index.js';
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

    // Privacy classifier (check before query analyzer — both contain "analyze")
    if (systemPrompt.includes('privacy classifier')) {
      return {
        findings: [
          {
            type: 'person_name',
            text: 'John Smith',
            confidence: 0.95,
            reasoning: 'Full name detected',
          },
        ],
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
        keysDir: '/tmp/pristine-sdk-test-keys',
      });
    });

    afterAll(async () => {
      await client.dispose();
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

    it('secureAndRedact() + reveal() round-trip recovers PII', async () => {
      const original = 'My name is John Smith and I live at 123 Main St.';
      const { redactedText, placeholderIds } = await client.secureAndRedact(original, 'sdk-user-2');

      expect(redactedText).toContain('[SENSITIVE:');
      expect(redactedText).not.toContain('John Smith');
      expect(placeholderIds.length).toBeGreaterThan(0);

      const revealed = await client.reveal(redactedText, 'sdk-user-2');
      expect(revealed).toContain('John Smith');
    }, 120_000);

    it('scrubOutput() removes placeholder tokens', () => {
      const text = 'Hello [SENSITIVE:name:abc-123], how are you?';
      const scrubbed = client.scrubOutput(text);
      expect(scrubbed).toBe('Hello , how are you?');
    });

    it('dispose() completes without error', async () => {
      // Create a separate client to test dispose independently
      const disposableClient = await PristineLocal.create({
        db: createDatabase(':memory:'),
        llmClients,
      });
      await expect(disposableClient.dispose()).resolves.toBeUndefined();
    });
  },
  600_000,
);
