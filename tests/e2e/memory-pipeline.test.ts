import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OllamaClient } from '../../src/engine/ollama/index.js';
import { LocalEmbedder } from '../../src/embedder/local/index.js';
import { createExtractor } from '../../src/memory/extractor/index.js';
import { SqliteStore } from '../../src/memory/store/sqlite/index.js';
import { createDatabase } from '../../src/core/database.js';
import type { Extractor } from '../../src/core/interfaces.js';
import { cleanupDirs, isOllamaAvailable } from './helpers.js';

const ollamaAvailable = await isOllamaAvailable();

let db: Database.Database;
let store: SqliteStore;
let client: OllamaClient;
let embedder: LocalEmbedder;
let extractor: Extractor;

afterEach(() => {
  cleanupDirs();
});

describe.skipIf(!ollamaAvailable)(
  'e2e: memory pipeline with real Ollama and embeddings',
  () => {
    beforeAll(() => {
      db = createDatabase(':memory:');
      store = new SqliteStore(db);
      client = new OllamaClient({ model: 'llama3.2:latest' });
      embedder = new LocalEmbedder();
      extractor = createExtractor(client);
    });

    afterAll(async () => {
      await embedder.dispose();
      db.close();
    });

    it('extracts facts, embeds, stores, and searches', async () => {
      const conversation = [
        {
          role: 'user' as const,
          content: 'I just moved to Tokyo and started working at Google as a software engineer.',
        },
        {
          role: 'assistant' as const,
          content: 'That sounds exciting! How are you settling in?',
        },
      ];

      const { facts } = await extractor.extract(conversation);
      expect(facts.length).toBeGreaterThan(0);

      const firstFact = facts[0]!;
      const embedding = await embedder.embed(firstFact.text);
      expect(embedding).toHaveLength(768);

      const contentHash = createHash('sha256').update(firstFact.text).digest('hex');
      const memory = await store.addMemory({
        userId: 'e2e-mem-1',
        text: firstFact.text,
        embedding,
        contentHash,
      });
      expect(memory.id).toBeDefined();
      expect(memory.text).toBe(firstFact.text);

      const queryEmbedding = await embedder.embed('Where does the user live?');
      const results = await store.searchSimilar({
        userId: 'e2e-mem-1',
        embedding: queryEmbedding,
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
    }, 120000);

    it('content hash prevents duplicate memories', async () => {
      const text = 'The user likes sushi';
      const embedding = await embedder.embed(text);
      const contentHash = createHash('sha256').update(text).digest('hex');

      const first = await store.addMemory({
        userId: 'e2e-mem-2',
        text,
        embedding,
        contentHash,
      });

      const second = await store.addMemory({
        userId: 'e2e-mem-2',
        text,
        embedding,
        contentHash,
      });

      expect(first.id).toBe(second.id);
    }, 120000);

    it('temporal search filters by current validity', async () => {
      const text = 'The user works at Google';
      const embedding = await embedder.embed(text);
      const contentHash = createHash('sha256')
        .update(text + '-temporal')
        .digest('hex');
      const validFrom = new Date(Date.now() - 86400000).toISOString();

      await store.addMemory({
        userId: 'e2e-mem-3',
        text,
        embedding,
        contentHash,
        validFrom,
      });

      const queryEmbedding = await embedder.embed('Where does the user work?');
      const results = await store.searchSimilar({
        userId: 'e2e-mem-3',
        embedding: queryEmbedding,
        limit: 5,
        temporalMode: 'current',
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.text).toBe(text);
    }, 120000);
  },
  600000,
);
