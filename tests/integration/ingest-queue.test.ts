/**
 * Ingest queue integration tests: failure modes, crash recovery, concurrency.
 * Skippable via SKIP_SLOW_TESTS=1.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from '../../src/core/database.js';
import { ConversationStore } from '../../src/conversations/store.js';
import { IngestQueue } from '../../src/queue/ingest-queue.js';
import { PristineLocal } from '../../src/index.js';
import { EmbedderError } from '../../src/core/errors.js';
import type { Orchestrator, Embedder, LlmClient } from '../../src/core/interfaces.js';
import type { LlmClients } from '../../src/engine/index.js';
import { runWorker } from '../../scripts/extract-worker.js';

const skipSlow = process.env.SKIP_SLOW_TESTS === '1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createMockOrchestrator = (ingestFn?: Orchestrator['ingest']): Orchestrator =>
  ({
    ingest:
      ingestFn ??
      vi.fn(async () => ({
        facts: [{ text: 'test fact' }],
        decisions: [{ action: 'ADD', factIndex: 0 }],
        memoryIds: ['mem-1'],
        errors: [],
      })),
    retrieve: vi.fn(),
    store: vi.fn(),
    search: vi.fn(),
    ingestSteps: [],
    retrieveSteps: [],
    registerIngestStep: vi.fn(),
    registerRetrieveStep: vi.fn(),
  }) as unknown as Orchestrator;

const createMockLlmClient = (): LlmClient => {
  const generate = async ({ systemPrompt }: { systemPrompt: string }): Promise<unknown> => {
    if (systemPrompt.includes('memory consolidation')) {
      return { decisions: [{ action: 'ADD', factIndex: 0 }] };
    }
    if (systemPrompt.includes('query analysis') || systemPrompt.includes('analyze')) {
      return { intent: 'factual_lookup', filters: {}, suggestedTopK: 5, rewrittenQuery: 'q' };
    }
    return { facts: [{ text: 'test fact', validFrom: new Date().toISOString() }] };
  };
  return { generate: generate as LlmClient['generate'] };
};

const createMockEmbedder = (): Embedder => ({
  embed: vi.fn(async () => Array.from({ length: 768 }, () => Math.random())),
  embedBatch: vi.fn(async (texts: readonly string[]) =>
    texts.map(() => Array.from({ length: 768 }, () => Math.random())),
  ),
});

const sampleConversation = [{ role: 'user' as const, content: 'I like coffee' }];
const makeConversation = (suffix: string) => [
  { role: 'user' as const, content: `Message ${suffix}` },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(skipSlow)('IngestQueue integration', () => {
  // -------------------------------------------------------------------------
  // Happy path: storeAsync -> processNext -> search
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    let db: Database.Database;
    let client: PristineLocal;

    beforeEach(async () => {
      db = createDatabase(':memory:');
      const mockClient = createMockLlmClient();
      const llmClients: LlmClients = { privacyClient: mockClient, memoryClient: mockClient };
      client = await PristineLocal.create({ db, llmClients, embedder: createMockEmbedder() });
    });

    afterEach(async () => {
      await client.dispose();
      db.close();
    });

    it('storeAsync enqueues, processNext extracts, search finds results', async () => {
      const taskId = client.storeAsync(sampleConversation, 'user-1');
      expect(taskId).toBeTruthy();
      expect(client.ingestQueue.pending).toBe(1);

      const task = await client.ingestQueue.processNext();
      expect(task).not.toBeNull();
      expect(client.ingestQueue.pending).toBe(0);

      const result = await client.search('coffee', 'user-1');
      expect(result.memories.length).toBeGreaterThan(0);
    });

    it('searchConversations finds stored conversations by keyword', async () => {
      client.storeAsync([{ role: 'user', content: 'I love espresso' }], 'user-1');

      const results = client.searchConversations({ userId: 'user-1', keyword: 'espresso' });
      expect(results).toHaveLength(1);
      expect(results[0].snippet).toContain('<b>espresso</b>');
    });
  });

  // -------------------------------------------------------------------------
  // Crash recovery
  // -------------------------------------------------------------------------

  describe('crash recovery', () => {
    let db: Database.Database;
    let conversationStore: ConversationStore;
    let queue: IngestQueue;

    beforeEach(() => {
      db = createDatabase(':memory:');
      conversationStore = new ConversationStore(db);
      queue = new IngestQueue({
        db,
        orchestrator: createMockOrchestrator(),
        conversationStore,
      });
    });

    afterEach(() => {
      db.close();
    });

    it('recovers stale processing rows (worker dies mid-extraction)', () => {
      queue.enqueue(sampleConversation, 'user-1');
      const task = queue.claimNext();
      expect(task).not.toBeNull();

      // Simulate crash: set started_at to 60s ago
      db.prepare(
        `UPDATE pending_ingest_tasks
         SET started_at = datetime('now', '-60 seconds')
         WHERE id = ?`,
      ).run(task!.id);

      // Next claim should reset and re-claim the stale task
      const recovered = queue.claimNext();
      expect(recovered).not.toBeNull();
      expect(recovered!.id).toBe(task!.id);
    });

    it('SIGKILL scenario: stale processing row recovered on next claim', () => {
      queue.enqueue(sampleConversation, 'user-1');
      const task = queue.claimNext();

      // Simulate SIGKILL: task stays processing with old timestamp
      db.prepare(
        `UPDATE pending_ingest_tasks
         SET started_at = datetime('now', '-120 seconds')
         WHERE id = ?`,
      ).run(task!.id);

      const recovered = queue.claimNext();
      expect(recovered).not.toBeNull();
      expect(recovered!.id).toBe(task!.id);
      expect(recovered!.status).toBe('processing');
    });
  });

  // -------------------------------------------------------------------------
  // Error classification
  // -------------------------------------------------------------------------

  describe('error classification', () => {
    let db: Database.Database;
    let conversationStore: ConversationStore;

    beforeEach(() => {
      db = createDatabase(':memory:');
      conversationStore = new ConversationStore(db);
    });

    afterEach(() => {
      db.close();
    });

    it('Ollama unreachable: task stays pending (retryable)', async () => {
      const queue = new IngestQueue({
        db,
        orchestrator: createMockOrchestrator(
          vi.fn(async () => {
            throw new EmbedderError('Ollama embedding request failed: fetch failed');
          }) as unknown as Orchestrator['ingest'],
        ),
        conversationStore,
      });

      queue.enqueue(sampleConversation, 'user-1');
      await queue.processNext();

      const row = db
        .prepare("SELECT status FROM pending_ingest_tasks WHERE status = 'pending'")
        .get() as { status: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.status).toBe('pending');
    });

    it('Ollama returns garbage: task marked failed (non-retryable)', async () => {
      const queue = new IngestQueue({
        db,
        orchestrator: createMockOrchestrator(
          vi.fn(async () => {
            throw new Error('Extraction failed: unexpected response format');
          }) as unknown as Orchestrator['ingest'],
        ),
        conversationStore,
      });

      queue.enqueue(sampleConversation, 'user-1');
      await queue.processNext();

      const row = db
        .prepare("SELECT status, error FROM pending_ingest_tasks WHERE status = 'failed'")
        .get() as { status: string; error: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.error).toContain('unexpected response format');
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate handling
  // -------------------------------------------------------------------------

  describe('duplicate handling', () => {
    it('second enqueue returns empty string, no duplicate task', () => {
      const db = createDatabase(':memory:');
      try {
        const conversationStore = new ConversationStore(db);
        const queue = new IngestQueue({
          db,
          orchestrator: createMockOrchestrator(),
          conversationStore,
        });

        const first = queue.enqueue(sampleConversation, 'user-1');
        const second = queue.enqueue(sampleConversation, 'user-1');

        expect(first).toBeTruthy();
        expect(second).toBe('');
        expect(queue.pending).toBe(1);
      } finally {
        db.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent claims
  // -------------------------------------------------------------------------

  describe('concurrent claims', () => {
    it('two separate connections claim different tasks', () => {
      const dir = mkdtempSync(join(tmpdir(), 'pristine-race-'));
      const racePath = join(dir, 'test.db');
      const db1 = createDatabase(racePath);
      const db2 = createDatabase(racePath);
      try {
        const convStore1 = new ConversationStore(db1);
        const queue1 = new IngestQueue({
          db: db1,
          orchestrator: createMockOrchestrator(),
          conversationStore: convStore1,
        });
        const convStore2 = new ConversationStore(db2);
        const queue2 = new IngestQueue({
          db: db2,
          orchestrator: createMockOrchestrator(),
          conversationStore: convStore2,
        });

        for (let i = 0; i < 5; i += 1) {
          queue1.enqueue(makeConversation(`task-${i}`), 'user-1');
        }

        // Two separate connections claim — SQLite write lock ensures atomicity
        const first = queue1.claimNext();
        const second = queue2.claimNext();

        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(first!.id).not.toBe(second!.id);
      } finally {
        db1.close();
        db2.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // SQLITE_BUSY under concurrent writes
  // -------------------------------------------------------------------------

  describe('SQLITE_BUSY', () => {
    let dbPath: string;
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'pristine-busy-'));
      dbPath = join(tempDir, 'test.db');
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('busy_timeout allows concurrent writes without SQLITE_BUSY', () => {
      const db1 = createDatabase(dbPath);
      const db2 = createDatabase(dbPath);

      const convStore1 = new ConversationStore(db1);
      const convStore2 = new ConversationStore(db2);
      const queue1 = new IngestQueue({
        db: db1,
        orchestrator: createMockOrchestrator(),
        conversationStore: convStore1,
      });
      const queue2 = new IngestQueue({
        db: db2,
        orchestrator: createMockOrchestrator(),
        conversationStore: convStore2,
      });

      // Both write concurrently — busy_timeout should prevent SQLITE_BUSY
      expect(() => {
        queue1.enqueue([{ role: 'user', content: 'From writer 1' }], 'user-1');
        queue2.enqueue([{ role: 'user', content: 'From writer 2' }], 'user-2');
      }).not.toThrow();

      expect(queue1.pending).toBe(2);

      db1.close();
      db2.close();
    });
  });

  // -------------------------------------------------------------------------
  // Transaction atomicity
  // -------------------------------------------------------------------------

  describe('transaction atomicity', () => {
    it('rolls back conversation if pending task insert fails', () => {
      const db = createDatabase(':memory:');
      try {
        const conversationStore = new ConversationStore(db);
        const queue = new IngestQueue({
          db,
          orchestrator: createMockOrchestrator(),
          conversationStore,
        });

        // First enqueue succeeds
        queue.enqueue(sampleConversation, 'user-1');

        // Break the pending_ingest_tasks table
        db.exec('DROP TABLE pending_ingest_tasks');
        db.exec(`CREATE TABLE pending_ingest_tasks (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', error TEXT,
          created_at TEXT DEFAULT (datetime('now')), started_at TEXT, completed_at TEXT,
          CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
        )`);
        db.exec(`CREATE TRIGGER fail_insert BEFORE INSERT ON pending_ingest_tasks
          BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`);

        const newConv = [{ role: 'user' as const, content: 'Should be rolled back' }];
        expect(() => queue.enqueue(newConv, 'user-2')).toThrow('simulated failure');

        // Conversation should NOT be in the store
        const results = conversationStore.searchConversations({ userId: 'user-2' });
        expect(results).toHaveLength(0);
      } finally {
        db.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Queue backlog warning
  // -------------------------------------------------------------------------

  describe('queue backlog warning', () => {
    it('logs warning when queue exceeds threshold', async () => {
      const db = createDatabase(':memory:');
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      try {
        const mockClient = createMockLlmClient();
        const llmClients: LlmClients = { privacyClient: mockClient, memoryClient: mockClient };
        const client = await PristineLocal.create({
          db,
          llmClients,
          embedder: createMockEmbedder(),
        });

        for (let i = 0; i < 15; i += 1) {
          client.storeAsync(makeConversation(`backlog-${i}`), 'user-1');
        }

        await runWorker(client, { all: true, retryFailed: false });

        const warnings = stderrSpy.mock.calls.filter(
          (call) => typeof call[0] === 'string' && call[0].includes('Warning'),
        );
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings[0][0]).toContain('tasks pending in queue');

        await client.dispose();
      } finally {
        stderrSpy.mockRestore();
        db.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // --retry-failed
  // -------------------------------------------------------------------------

  describe('--retry-failed', () => {
    it('resets failed tasks to pending and processes them', async () => {
      const db = createDatabase(':memory:');
      try {
        const mockClient = createMockLlmClient();
        const llmClients: LlmClients = { privacyClient: mockClient, memoryClient: mockClient };
        const client = await PristineLocal.create({
          db,
          llmClients,
          embedder: createMockEmbedder(),
        });

        // Enqueue and manually fail tasks
        client.storeAsync(sampleConversation, 'user-1');
        const task = client.ingestQueue.claimNext();
        db.prepare(
          "UPDATE pending_ingest_tasks SET status = 'failed', error = 'test' WHERE id = ?",
        ).run(task!.id);

        expect(client.ingestQueue.pending).toBe(0);

        const result = await runWorker(client, { all: true, retryFailed: true });
        expect(result.processed).toBe(1);

        await client.dispose();
      } finally {
        db.close();
      }
    });
  });
});
