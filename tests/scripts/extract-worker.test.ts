import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from '../../src/core/database.js';
import { PristineLocal } from '../../src/index.js';
import type { LlmClient, Embedder } from '../../src/core/interfaces.js';
import type { LlmClients } from '../../src/engine/index.js';
import { parseWorkerArgs, runWorker } from '../../scripts/extract-worker.js';

// ---------------------------------------------------------------------------
// Mock factories (reused from client tests)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extract-worker.ts', () => {
  describe('parseWorkerArgs()', () => {
    it('defaults to no flags', () => {
      const args = parseWorkerArgs([]);
      expect(args.dbPath).toBeUndefined();
      expect(args.all).toBe(false);
      expect(args.retryFailed).toBe(false);
    });

    it('parses --db-path', () => {
      const args = parseWorkerArgs(['--db-path', '/tmp/test.db']);
      expect(args.dbPath).toBe('/tmp/test.db');
    });

    it('parses --all flag', () => {
      const args = parseWorkerArgs(['--all']);
      expect(args.all).toBe(true);
    });

    it('parses --retry-failed flag', () => {
      const args = parseWorkerArgs(['--retry-failed']);
      expect(args.retryFailed).toBe(true);
    });

    it('parses all flags together', () => {
      const args = parseWorkerArgs(['--db-path', '/tmp/x.db', '--all', '--retry-failed']);
      expect(args.dbPath).toBe('/tmp/x.db');
      expect(args.all).toBe(true);
      expect(args.retryFailed).toBe(true);
    });
  });

  describe('runWorker()', () => {
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

    it('processes enqueued tasks with --all and exits', async () => {
      client.storeAsync([{ role: 'user', content: 'Task one' }], 'user-1');
      client.storeAsync([{ role: 'user', content: 'Task two' }], 'user-1');
      expect(client.ingestQueue.pending).toBe(2);

      const result = await runWorker(client, { all: true, retryFailed: false });

      expect(result.processed).toBe(2);
      expect(client.ingestQueue.pending).toBe(0);
    });

    it('exits immediately with --all when queue is empty', async () => {
      const start = Date.now();
      const result = await runWorker(client, { all: true, retryFailed: false });
      const elapsed = Date.now() - start;

      expect(result.processed).toBe(0);
      expect(elapsed).toBeLessThan(1000);
    });

    it('--retry-failed resets failed tasks to pending', async () => {
      client.storeAsync([{ role: 'user', content: 'Will fail' }], 'user-1');

      // Manually claim and mark as failed
      const task = client.ingestQueue.claimNext();
      db.prepare(
        "UPDATE pending_ingest_tasks SET status = 'failed', error = 'test' WHERE id = ?",
      ).run(task!.id);
      expect(client.ingestQueue.pending).toBe(0);

      const result = await runWorker(client, { all: true, retryFailed: true });

      expect(result.processed).toBe(1);
    });

    it('logs warning at queue depth thresholds', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      // Enqueue 12 tasks to trigger the >10 threshold
      for (let i = 0; i < 12; i += 1) {
        client.storeAsync([{ role: 'user', content: `Task ${i}` }], 'user-1');
      }

      await runWorker(client, { all: true, retryFailed: false });

      const warningCalls = stderrSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('Warning'),
      );
      expect(warningCalls.length).toBeGreaterThan(0);
      expect(warningCalls[0][0]).toContain('tasks pending in queue');

      stderrSpy.mockRestore();
    });
  });
});
