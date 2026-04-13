import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalEmbedder } from '../../src/embedder/local/index.js';
import { createExtractor } from '../../src/memory/extractor/index.js';
import { createConsolidator } from '../../src/memory/consolidator/index.js';
import { createQueryAnalyzer } from '../../src/memory/query-analyzer/index.js';
import { createRetriever } from '../../src/memory/retriever/index.js';
import { SqliteStore } from '../../src/memory/store/sqlite/index.js';
import { ConversationStore } from '../../src/conversations/store.js';
import { createDatabase } from '../../src/core/database.js';
import { createOrchestrator } from '../../src/memory/orchestrator/index.js';
import type { LlmClient, Orchestrator } from '../../src/core/interfaces.js';
import type { Message } from '../../src/core/types.js';

const skipSlow = process.env.SKIP_SLOW_TESTS === '1';

// ---------------------------------------------------------------------------
// Mock LlmClient that returns predictable facts
// ---------------------------------------------------------------------------

const createMockLlmClient = (): LlmClient => {
  const generate = async ({
    systemPrompt,
    userPrompt,
  }: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<unknown> => {
    // Consolidator: system prompt contains "memory consolidation"
    if (systemPrompt.includes('memory consolidation')) {
      // Count how many "NEW fact" entries are in the batch prompt
      const factCount = (userPrompt.match(/NEW fact/gi) ?? []).length || 1;
      return {
        decisions: Array.from({ length: factCount }, (_, i) => ({
          action: 'ADD',
          factIndex: i,
        })),
      };
    }

    // Query analyzer: system prompt contains "query analysis" or "analyze"
    if (systemPrompt.includes('query analysis') || systemPrompt.includes('analyze')) {
      return {
        intent: 'factual_lookup',
        filters: {},
        suggestedTopK: 5,
        rewrittenQuery: userPrompt,
      };
    }

    // Extractor (default): extract facts from conversation
    return {
      facts: [
        {
          text: 'The user lives in Tokyo',
          validFrom: new Date().toISOString(),
        },
        {
          text: 'The user works at Google as a software engineer',
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
  'orchestrator end-to-end',
  () => {
    let db: Database.Database;
    let store: SqliteStore;
    let embedder: LocalEmbedder;
    let orchestrator: Orchestrator;

    beforeAll(() => {
      db = createDatabase(':memory:');
      store = new SqliteStore(db);
      embedder = new LocalEmbedder();

      const llmClient = createMockLlmClient();
      const extractor = createExtractor(llmClient);
      const consolidator = createConsolidator(llmClient);
      const queryAnalyzer = createQueryAnalyzer(llmClient);
      const retriever = createRetriever({ store, embedder });

      const conversationStore = new ConversationStore(db);
      orchestrator = createOrchestrator({
        extractor,
        embedder,
        store,
        consolidator,
        conversationStore,
        retriever,
        queryAnalyzer,
      });
    });

    afterAll(async () => {
      await embedder.dispose();
      db.close();
    });

    it('ingests a multi-turn conversation and retrieves matching facts', async () => {
      const conversation: Message[] = [
        {
          role: 'user',
          content: 'I just moved to Tokyo and started working at Google as a software engineer.',
        },
        { role: 'assistant', content: 'That sounds exciting! How are you settling in?' },
      ];

      const ingestResult = await orchestrator.ingest(conversation, 'e2e-user-1');

      expect(ingestResult.facts.length).toBeGreaterThan(0);
      expect(ingestResult.memoryIds.length).toBeGreaterThan(0);

      const retrieveResult = await orchestrator.retrieve('Where does the user live?', 'e2e-user-1');

      expect(retrieveResult.memories.length).toBeGreaterThan(0);
      const memoryTexts = retrieveResult.memories.map((m) => m.memory.text);
      expect(memoryTexts.some((t) => t.toLowerCase().includes('tokyo'))).toBe(true);
    }, 120_000);

    it('store() and search() convenience methods work', async () => {
      const conversation: Message[] = [{ role: 'user', content: 'I love sushi and ramen.' }];

      const ingestResult = await orchestrator.store(conversation, 'e2e-user-2');
      expect(ingestResult.facts.length).toBeGreaterThan(0);

      const searchResult = await orchestrator.search('What food does the user like?', 'e2e-user-2');
      expect(searchResult.memories.length).toBeGreaterThan(0);
    }, 120_000);

    it('dedup prevents duplicate memories on re-ingestion', async () => {
      const conversation: Message[] = [{ role: 'user', content: 'My favorite color is blue.' }];

      const first = await orchestrator.ingest(conversation, 'e2e-user-3');
      expect(first.facts.length).toBeGreaterThan(0);
      const firstMemoryCount = first.memoryIds.length;

      const second = await orchestrator.ingest(conversation, 'e2e-user-3');

      // Store handles dedup at DB level (returns existing on content_hash match)
      // so second ingestion produces same memoryIds — no net new memories
      expect(second.memoryIds.length).toBeLessThanOrEqual(firstMemoryCount);

      // Verify no duplicate memories created by searching
      const results = await orchestrator.search('favorite color', 'e2e-user-3', 10);
      const uniqueIds = new Set(results.memories.map((m) => m.memory.id));
      expect(uniqueIds.size).toBe(results.memories.length);
    }, 120_000);

    it('temporal search returns currently valid memories', async () => {
      const conversation: Message[] = [
        { role: 'user', content: 'I currently work at Google but I used to work at Meta.' },
      ];

      const result = await orchestrator.ingest(conversation, 'e2e-user-4');
      expect(result.facts.length).toBeGreaterThan(0);

      // All ingested facts have validFrom set to now (by mock), so they are
      // currently valid. Verify that temporalMode='current' returns them.
      const currentResults = await orchestrator.retrieve(
        'Where does the user work?',
        'e2e-user-4',
        {
          temporalMode: 'current',
        },
      );

      expect(currentResults.memories.length).toBeGreaterThan(0);
      // Verify all returned memories have valid temporal state
      for (const ranked of currentResults.memories) {
        if (ranked.memory.validUntil) {
          expect(new Date(ranked.memory.validUntil).getTime()).toBeGreaterThan(Date.now());
        }
      }
    }, 120_000);
  },
  600_000,
);
