import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../../src/core/database.js';
import { SqliteStore } from '../../../src/memory/store/sqlite/index.js';
import type { AddMemoryInput } from '../../../src/core/types.js';

let db: ReturnType<typeof createDatabase>;
let store: SqliteStore;

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

const makeInput = (overrides: Partial<AddMemoryInput> = {}): AddMemoryInput => ({
  userId: 'user-1',
  text: 'User likes espresso.',
  embedding: [0.1, 0.2, 0.3],
  contentHash: hash(overrides.text ?? 'User likes espresso.'),
  ...overrides,
});

beforeAll(() => {
  db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
  store = new SqliteStore(db);
});

beforeEach(() => {
  db.exec('DELETE FROM memory_vectors');
  db.exec('DELETE FROM memories');
});

afterAll(() => {
  db.close();
});

describe('SqliteStore CRUD', () => {
  describe('addMemory', () => {
    it('stores and returns a memory with correct fields', async () => {
      const input = makeInput();
      const memory = await store.addMemory(input);

      expect(memory.id).toBeDefined();
      expect(memory.userId).toBe('user-1');
      expect(memory.text).toBe('User likes espresso.');
      expect(memory.contentHash).toBe(hash('User likes espresso.'));
      expect(memory.isDeleted).toBe(false);
      expect(memory.createdAt).toBeDefined();
      expect(memory.updatedAt).toBeDefined();
      expect(memory.embedding).toEqual([0.1, 0.2, 0.3]);
    });

    it('deduplicates by content hash + userId', async () => {
      const input = makeInput();
      const first = await store.addMemory(input);
      const second = await store.addMemory(input);

      expect(first.id).toBe(second.id);
    });

    it('allows same content hash for different userId', async () => {
      const first = await store.addMemory(makeInput({ userId: 'user-a' }));
      const second = await store.addMemory(makeInput({ userId: 'user-b' }));

      expect(first.id).not.toBe(second.id);
    });

    it('stores optional fields', async () => {
      const memory = await store.addMemory(
        makeInput({
          sourceConversationId: 'conv-1',
          metadata: { source: 'voice' },
          validFrom: '2026-01-01T00:00:00.000Z',
          validUntil: '2027-01-01T00:00:00.000Z',
        }),
      );

      expect(memory.sourceConversationId).toBe('conv-1');
      expect(memory.metadata).toEqual({ source: 'voice' });
      expect(memory.validFrom).toBe('2026-01-01T00:00:00.000Z');
      expect(memory.validUntil).toBe('2027-01-01T00:00:00.000Z');
    });
  });

  describe('getMemory', () => {
    it('returns memory by ID + userId', async () => {
      const added = await store.addMemory(makeInput());
      const found = await store.getMemory(added.id, 'user-1');

      expect(found).not.toBeNull();
      expect(found!.id).toBe(added.id);
      expect(found!.text).toBe('User likes espresso.');
    });

    it('returns null for nonexistent ID', async () => {
      const found = await store.getMemory('nonexistent', 'user-1');
      expect(found).toBeNull();
    });

    it('returns null for deleted memory', async () => {
      const added = await store.addMemory(makeInput());
      await store.deleteMemory(added.id, 'user-1');

      const found = await store.getMemory(added.id, 'user-1');
      expect(found).toBeNull();
    });

    it('returns null for wrong userId', async () => {
      const added = await store.addMemory(makeInput());
      const found = await store.getMemory(added.id, 'other-user');
      expect(found).toBeNull();
    });
  });

  describe('updateMemory', () => {
    it('updates text and metadata', async () => {
      const added = await store.addMemory(makeInput());
      const updated = await store.updateMemory(
        added.id,
        { text: 'User prefers tea.', metadata: { updated: true } },
        'user-1',
      );

      expect(updated.text).toBe('User prefers tea.');
      expect(updated.metadata).toEqual({ updated: true });
      expect(updated.updatedAt).toBeDefined();
    });

    it('updates embedding', async () => {
      const added = await store.addMemory(makeInput());
      const updated = await store.updateMemory(added.id, { embedding: [0.9, 0.8, 0.7] }, 'user-1');

      expect(updated.embedding).toEqual([0.9, 0.8, 0.7]);
    });
  });

  describe('deleteMemory', () => {
    it('soft-deletes memory (is_deleted = 1)', async () => {
      const added = await store.addMemory(makeInput());
      await store.deleteMemory(added.id, 'user-1');

      const row = db.prepare('SELECT is_deleted FROM memories WHERE id = ?').get(added.id) as {
        is_deleted: number;
      };
      expect(row.is_deleted).toBe(1);
    });
  });

  describe('clearAll', () => {
    it('with userId removes only that user memories', async () => {
      await store.addMemory(makeInput({ userId: 'user-a', text: 'a', contentHash: hash('a') }));
      await store.addMemory(makeInput({ userId: 'user-b', text: 'b', contentHash: hash('b') }));

      await store.clearAll('user-a');

      const remaining = db.prepare('SELECT count(*) as cnt FROM memories').get() as { cnt: number };
      expect(remaining.cnt).toBe(1);
    });

    it('without userId removes all memories', async () => {
      await store.addMemory(makeInput({ userId: 'user-a', text: 'a', contentHash: hash('a') }));
      await store.addMemory(makeInput({ userId: 'user-b', text: 'b', contentHash: hash('b') }));

      await store.clearAll();

      const remaining = db.prepare('SELECT count(*) as cnt FROM memories').get() as { cnt: number };
      expect(remaining.cnt).toBe(0);
    });
  });
});
