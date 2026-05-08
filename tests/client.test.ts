import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PristineLocal } from '../src/client.js';
import { createDatabase } from '../src/core/database.js';
import { InvalidArgumentError } from '../src/core/errors.js';
import type { Embedder } from '../src/core/interfaces.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const createMockEmbedder = (): Embedder & { dispose: ReturnType<typeof vi.fn> } => ({
  dim: 768,
  embed: vi.fn(async () => Array.from({ length: 768 }, () => Math.random())),
  embedBatch: vi.fn(async (texts: readonly string[]) =>
    texts.map(() => Array.from({ length: 768 }, () => Math.random())),
  ),
  dispose: vi.fn(async () => undefined),
});

const createTestDeps = (): {
  db: Database.Database;
  embedder: Embedder & { dispose: ReturnType<typeof vi.fn> };
} => {
  return {
    db: createDatabase(':memory:'),
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
        embedder: deps.embedder,
      });

      expect(client).toBeInstanceOf(PristineLocal);
    });

    it('regression: llmClients is rejected by PristineLocalConfig', async () => {
      // Locks the deletion: if llmClients is re-added to the config type,
      // the @ts-expect-error below becomes unused and the build fails.
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
        // @ts-expect-error — llmClients removed from PristineLocalConfig
        llmClients: {},
      });
      expect(client).toBeInstanceOf(PristineLocal);
    });
  });

  describe('source index API', () => {
    it('indexSourceChunks embeds and writes source chunks synchronously', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      const chunks = await client.indexSourceChunks(
        [
          {
            text: 'source pointer architecture cleanup',
            chunkId: 'chunk-1',
            sourceKind: 'pi-jsonl',
            sourceUri: '/tmp/session.jsonl',
            metadata: { cwd: '/tmp/project' },
          },
        ],
        { projectId: 'project-a' },
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        chunkId: 'chunk-1',
        projectId: 'project-a',
        sourceKind: 'pi-jsonl',
        sourceUri: '/tmp/session.jsonl',
      });
      expect(deps.embedder.embedBatch).toHaveBeenCalledWith([
        'source pointer architecture cleanup',
      ]);
      expect(
        deps.db
          .prepare(
            'SELECT text, source_uri FROM source_chunks WHERE project_id = ? AND chunk_id = ?',
          )
          .get('project-a', 'chunk-1'),
      ).toEqual({ text: 'source pointer architecture cleanup', source_uri: '/tmp/session.jsonl' });
      expect(
        deps.db
          .prepare(
            'SELECT project_id, chunk_id FROM vec_source_chunks WHERE project_id = ? AND chunk_id = ?',
          )
          .get('project-a', 'chunk-1'),
      ).toEqual({ project_id: 'project-a', chunk_id: 'chunk-1' });
    });

    it('indexSourceChunks replaces duplicate chunk ids within a project and isolates other projects', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      await client.indexSourceChunks([{ text: 'before', chunkId: 'stable' }], {
        projectId: 'project-a',
      });
      await client.indexSourceChunks([{ text: 'after', chunkId: 'stable' }], {
        projectId: 'project-a',
      });
      await client.indexSourceChunks([{ text: 'other project', chunkId: 'stable' }], {
        projectId: 'project-b',
      });

      expect(
        deps.db
          .prepare(
            'SELECT project_id, text FROM source_chunks WHERE chunk_id = ? ORDER BY project_id',
          )
          .all('stable'),
      ).toEqual([
        { project_id: 'project-a', text: 'after' },
        { project_id: 'project-b', text: 'other project' },
      ]);
    });

    it('indexSourceChunks supports minimal metadata and rejects invalid input', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      const [minimal] = await client.indexSourceChunks([{ text: 'minimal chunk' }], {
        projectId: 'project-a',
      });

      expect(minimal?.chunkId).toHaveLength(36);
      expect(minimal?.sourceUri).toBeNull();
      await expect(client.indexSourceChunks([], { projectId: 'project-a' })).rejects.toThrow(
        InvalidArgumentError,
      );
    });
  });

  describe('conversation API', () => {
    it('getConversation() returns full conversation with messages', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there' },
      ];
      const conversationId = client.storeAsync(messages, 'test-user');

      const detail = client.getConversation(conversationId);
      expect(detail).not.toBeNull();
      expect(detail?.userId).toBe('test-user');
      expect(detail?.messages).toHaveLength(2);
      expect(detail?.messages[0].role).toBe('user');
      expect(detail?.messages[0].content).toBe('Hello');
      expect(detail?.messages[1].role).toBe('assistant');
      expect(detail?.messages[1].content).toBe('Hi there');
    });

    it('getConversation() returns null for nonexistent ID', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      const result = client.getConversation('nonexistent-id');
      expect(result).toBeNull();
    });
  });

  describe('privacy API', () => {
    it('secureAndRedact() uses configured custom privacy patterns', async () => {
      const keysDir = mkdtempSync(join(tmpdir(), 'pristine-client-keys-'));
      try {
        const client = await PristineLocal.create({
          db: deps.db,
          embedder: deps.embedder,
          keysDir,
          privacy: {
            customPatternsPath: '/tmp/pristine-client-missing-redaction.json',
            customPatterns: [
              {
                id: 'client-acme',
                type: 'api_key',
                pattern: '\\bacme_tk_[A-Za-z0-9]{8}\\b',
                confidence: 0.95,
              },
            ],
          },
        });

        const original = 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 and acme_tk_ABC12345.';
        const result = await client.secureAndRedact(original, 'client-user');

        expect(result.ok).toBe(true);
        if (!result.ok) {
          throw new Error(`Expected privacy success, got ${result.reason}`);
        }

        expect(result.redactedText).toContain('[SENSITIVE:');
        expect(result.redactedText).not.toContain('sk-ant-api03');
        expect(result.redactedText).not.toContain('acme_tk_ABC12345');
        expect(result.placeholderIds).toHaveLength(2);

        const revealed = await client.reveal(result.redactedText, 'client-user');
        expect(revealed.text).toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456');
        expect(revealed.text).toContain('acme_tk_ABC12345');
      } finally {
        rmSync(keysDir, { recursive: true, force: true });
      }
    });

    it('scrubOutput() removes placeholder tokens', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      const result = client.scrubOutput(
        'Hello [SENSITIVE:name:abc-123], your card is [SENSITIVE:credit_card:def-456]',
        [],
      );

      expect(result).toBe('Hello , your card is ');
      expect(result).not.toContain('[SENSITIVE:');
    });

    it('scrubOutput() uses configured custom privacy patterns', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
        privacy: {
          customPatternsPath: '/tmp/pristine-client-missing-redaction.json',
          customPatterns: [
            {
              id: 'client-acme',
              type: 'api_key',
              pattern: '\\bacme_tk_[A-Za-z0-9]{8}\\b',
              confidence: 0.95,
            },
          ],
        },
      });

      const result = client.scrubOutput('Tool output leaked acme_tk_ABC12345', []);

      expect(result).not.toContain('acme_tk_ABC12345');
    });
  });

  describe('dispose()', () => {
    it('does not dispose DI-provided embedder', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      await client.dispose();
      expect(deps.embedder.dispose).not.toHaveBeenCalled();
    });

    it('does not close DI-provided database', async () => {
      const closeSpy = vi.spyOn(deps.db, 'close');

      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      await client.dispose();
      expect(closeSpy).not.toHaveBeenCalled();
    });
  });

  describe('pendingEmbedTasks getter', () => {
    it('exposes a numeric queue depth on full client', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      expect(typeof client.pendingEmbedTasks).toBe('number');
    });

    it('regression: createLite is no longer on the PristineLocal class', () => {
      expect((PristineLocal as unknown as Record<string, unknown>).createLite).toBeUndefined();
    });
  });

  describe('storeAsync()', () => {
    it('stores conversation, returns conversationId, and enqueues one embed task per message', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      const conversationId = client.storeAsync(
        [
          { role: 'user', content: 'I like coffee' },
          { role: 'assistant', content: 'Espresso is excellent' },
        ],
        'test-user',
      );

      expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);
      // Indexer enqueues one embed-message task per inserted message.
      expect(client.pendingEmbedTasks).toBe(2);
    });

    it('returns existing conversationId for duplicate conversation without re-enqueueing', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      const messages = [{ role: 'user' as const, content: 'I like coffee' }];
      const first = client.storeAsync(messages, 'test-user');
      const second = client.storeAsync(messages, 'test-user');

      expect(second).toBe(first);
      // Only the first call enqueued tasks; the duplicate path returns early.
      expect(client.pendingEmbedTasks).toBe(1);
    });
  });

  describe('searcher exposure', () => {
    it('full client exposes pristine.searcher with vectorSearch method', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      expect(typeof client.searcher.vectorSearch).toBe('function');
    });
  });

  describe('drainEmbedQueue()', () => {
    it('returns 0 when the queue is empty (idempotent)', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      // No storeAsync calls → no pending tasks. Drain should resolve to 0
      // without side effects.
      await expect(client.drainEmbedQueue()).resolves.toBe(0);
    });

    it('returns the count of tasks processed after storeAsync enqueues them', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      const turns = [
        { role: 'user' as const, content: 'turn one — drain me' },
        { role: 'assistant' as const, content: 'turn two — drain me too' },
        { role: 'user' as const, content: 'turn three — and me' },
      ];
      client.storeAsync(turns, 'drain-user', 'drain-project');

      // 3 messages → 3 embed-message tasks per indexer's per-message
      // enqueue policy. Drain returns the same count.
      const drained = await client.drainEmbedQueue();
      expect(drained).toBe(3);

      // Idempotent: a second drain on an empty queue returns 0.
      await expect(client.drainEmbedQueue()).resolves.toBe(0);
    });
  });

  describe('buildSessionVector()', () => {
    it('throws InvalidArgumentError when conversationId is empty', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      const promise = client.buildSessionVector('');
      await expect(promise).rejects.toBeInstanceOf(InvalidArgumentError);
      await expect(promise).rejects.toThrow(/conversationId.*required|empty/i);
    });

    it('throws InvalidArgumentError (single class) when conversationId does not exist, with the literal id in the message', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      const missingId = 'does-not-exist-12345';
      // Underlying indexer raises ConversationNotFoundError; the shim
      // narrows the public-surface contract to InvalidArgumentError so
      // callers have one type to catch. The original message
      // (containing the literal id) is preserved.
      const promise = client.buildSessionVector(missingId);
      await expect(promise).rejects.toBeInstanceOf(InvalidArgumentError);
      await expect(promise).rejects.toThrow(/does-not-exist-12345/);
    });

    it('delegates to indexer.buildSessionVector — populates vec_sessions for an existing conversation', async () => {
      const client = await PristineLocal.create({
        db: deps.db,
        embedder: deps.embedder,
      });

      const conversationId = client.storeAsync(
        [
          { role: 'user', content: 'session vector test — turn one' },
          { role: 'assistant', content: 'session vector test — turn two' },
        ],
        'sv-user',
        'sv-project',
      );
      // Drain so message rows exist (storeAsync inserts them via the
      // indexer transaction; this is purely defensive — buildSessionVector
      // reads `messages`, not `vec_windows`).
      await client.drainEmbedQueue();

      // Pre-call: no row in vec_sessions for this conversation.
      const before = deps.db
        .prepare('SELECT COUNT(*) AS n FROM vec_sessions WHERE conversation_id = ?')
        .get(conversationId) as { n: number };
      expect(before.n).toBe(0);

      await client.buildSessionVector(conversationId);

      // Post-call: exactly one row.
      const after = deps.db
        .prepare('SELECT COUNT(*) AS n FROM vec_sessions WHERE conversation_id = ?')
        .get(conversationId) as { n: number };
      expect(after.n).toBe(1);
    });
  });
});
