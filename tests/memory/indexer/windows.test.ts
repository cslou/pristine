import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConversationStore } from '../../../src/conversations/store.js';
import { createDatabase } from '../../../src/core/database.js';
import type { Embedder } from '../../../src/core/interfaces.js';
import type { ResolvedIndexerConfig } from '../../../src/memory/indexer/index.js';
import {
  assembleWindowEmbedding,
  computeWindowsForMessage,
  formatMessageForEmbed,
  upsertWindow,
} from '../../../src/memory/indexer/windows.js';

// ---------------------------------------------------------------------------
// computeWindowsForMessage — pure-logic tests (no DB)
// ---------------------------------------------------------------------------

const config = (windowSize: number, windowOverlap: number): ResolvedIndexerConfig => ({
  windowSize,
  windowOverlap,
});

describe('computeWindowsForMessage', () => {
  it('returns [] for an empty conversation', () => {
    expect(computeWindowsForMessage(0, 0, config(3, 1))).toEqual([]);
  });

  it('returns [] when sortOrder is out of range', () => {
    expect(computeWindowsForMessage(5, 3, config(3, 1))).toEqual([]);
    expect(computeWindowsForMessage(-1, 3, config(3, 1))).toEqual([]);
  });

  it('returns 1 partial window when totalMessageCount < windowSize', () => {
    const windows = computeWindowsForMessage(0, 1, config(3, 1));
    expect(windows).toEqual([{ windowIndex: 0, startSortOrder: 0, endSortOrder: 0, position: 0 }]);

    const windows2 = computeWindowsForMessage(1, 2, config(3, 1));
    expect(windows2).toEqual([{ windowIndex: 0, startSortOrder: 0, endSortOrder: 1, position: 1 }]);
  });

  it('returns 1 full window when totalMessageCount === windowSize', () => {
    expect(computeWindowsForMessage(0, 3, config(3, 1))).toEqual([
      { windowIndex: 0, startSortOrder: 0, endSortOrder: 2, position: 0 },
    ]);
    expect(computeWindowsForMessage(1, 3, config(3, 1))).toEqual([
      { windowIndex: 0, startSortOrder: 0, endSortOrder: 2, position: 1 },
    ]);
    expect(computeWindowsForMessage(2, 3, config(3, 1))).toEqual([
      { windowIndex: 0, startSortOrder: 0, endSortOrder: 2, position: 2 },
    ]);
  });

  it('returns overlapping windows for the AC-pinned 5-message / windowSize=3 / overlap=1 case', () => {
    // Spec: expected windows are [0,1,2] and [2,3,4].
    // Message 2 belongs to BOTH windows (overlap=1; stride=2).
    const w0 = computeWindowsForMessage(0, 5, config(3, 1));
    expect(w0).toEqual([{ windowIndex: 0, startSortOrder: 0, endSortOrder: 2, position: 0 }]);

    const w2 = computeWindowsForMessage(2, 5, config(3, 1));
    expect(w2).toEqual([
      { windowIndex: 0, startSortOrder: 0, endSortOrder: 2, position: 2 },
      { windowIndex: 1, startSortOrder: 2, endSortOrder: 4, position: 0 },
    ]);

    const w4 = computeWindowsForMessage(4, 5, config(3, 1));
    expect(w4).toEqual([{ windowIndex: 1, startSortOrder: 2, endSortOrder: 4, position: 2 }]);
  });

  it('does NOT tail-slide when N=5, windowSize=3, overlap=1 (already fits)', () => {
    // Sanity: with stride=2 and 5 messages, last window naturally lands on
    // [2..4] which is the last sortOrder. No slide needed.
    const w3 = computeWindowsForMessage(3, 5, config(3, 1));
    expect(w3).toEqual([{ windowIndex: 1, startSortOrder: 2, endSortOrder: 4, position: 1 }]);
  });

  it('applies tail-slide-back when the natural last window overshoots (N=4, W=3, O=1)', () => {
    // Stride=2; windows would be [0..2] and [2..4] but 4 doesn't exist.
    // Tail-slide: last window pins end at N-1=3 and slides start back to 1.
    // Final: [0..2] and [1..3]. Last window's overlap is now 2 (positions 1..2).
    const w0 = computeWindowsForMessage(0, 4, config(3, 1));
    expect(w0).toEqual([{ windowIndex: 0, startSortOrder: 0, endSortOrder: 2, position: 0 }]);
    const w1 = computeWindowsForMessage(1, 4, config(3, 1));
    expect(w1).toEqual([
      { windowIndex: 0, startSortOrder: 0, endSortOrder: 2, position: 1 },
      { windowIndex: 1, startSortOrder: 1, endSortOrder: 3, position: 0 },
    ]);
    const w3 = computeWindowsForMessage(3, 4, config(3, 1));
    expect(w3).toEqual([{ windowIndex: 1, startSortOrder: 1, endSortOrder: 3, position: 2 }]);
  });

  it('applies tail-slide-back at N=6 producing [0..2], [2..4], [3..5]', () => {
    // Stride=2; natural windows: [0..2], [2..4], [4..6] but 6 doesn't exist.
    // Tail-slide: last window pins end at 5 and slides start back to 3.
    const w5 = computeWindowsForMessage(5, 6, config(3, 1));
    expect(w5).toEqual([{ windowIndex: 2, startSortOrder: 3, endSortOrder: 5, position: 2 }]);
    const w3 = computeWindowsForMessage(3, 6, config(3, 1));
    expect(w3).toEqual([
      { windowIndex: 1, startSortOrder: 2, endSortOrder: 4, position: 1 },
      { windowIndex: 2, startSortOrder: 3, endSortOrder: 5, position: 0 },
    ]);
  });

  it('handles zero-overlap (stride=windowSize) with non-overlapping windows', () => {
    // windowSize=3, overlap=0, stride=3, N=6 → [0..2], [3..5].
    expect(computeWindowsForMessage(0, 6, config(3, 0))).toEqual([
      { windowIndex: 0, startSortOrder: 0, endSortOrder: 2, position: 0 },
    ]);
    expect(computeWindowsForMessage(3, 6, config(3, 0))).toEqual([
      { windowIndex: 1, startSortOrder: 3, endSortOrder: 5, position: 0 },
    ]);
    // Boundary: message 2 only in window 0; message 3 only in window 1.
    expect(computeWindowsForMessage(2, 6, config(3, 0))).toEqual([
      { windowIndex: 0, startSortOrder: 0, endSortOrder: 2, position: 2 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// formatMessageForEmbed — module helper
// ---------------------------------------------------------------------------

describe('formatMessageForEmbed', () => {
  it('produces "role: content" format', () => {
    expect(formatMessageForEmbed({ id: 1, role: 'user', content: 'hello' })).toBe('user: hello');
    expect(formatMessageForEmbed({ id: 2, role: 'assistant', content: 'how can I help?' })).toBe(
      'assistant: how can I help?',
    );
  });
});

// ---------------------------------------------------------------------------
// assembleWindowEmbedding — uses an injected stub embedder
// ---------------------------------------------------------------------------

const makeStubEmbedder = (vector: number[] = Array.from({ length: 768 }, (_, i) => i * 1e-4)) => {
  const calls: string[] = [];
  const embedder: Embedder = {
    embed: async (text: string): Promise<number[]> => {
      calls.push(text);
      return vector;
    },
    embedBatch: async (_texts: readonly string[]): Promise<number[][]> => {
      throw new Error('embedBatch not used in these tests');
    },
  };
  return { embedder, calls };
};

describe('assembleWindowEmbedding', () => {
  it('joins role-prefixed message rows with newlines and embeds once', async () => {
    const { embedder, calls } = makeStubEmbedder();
    const rows = [
      { id: 1, role: 'user', content: 'hi' },
      { id: 2, role: 'assistant', content: 'hello' },
      { id: 3, role: 'user', content: 'bye' },
    ];

    const result = await assembleWindowEmbedding(rows, embedder);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('user: hi\nassistant: hello\nuser: bye');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(768);
  });

  it('handles a single-message window', async () => {
    const { embedder, calls } = makeStubEmbedder();
    const result = await assembleWindowEmbedding(
      [{ id: 1, role: 'user', content: 'solo' }],
      embedder,
    );
    expect(calls[0]).toBe('user: solo');
    expect(result.length).toBe(768);
  });

  it('returns the embedder vector cast to Float32Array', async () => {
    const knownVec = Array.from({ length: 768 }, (_, i) => 0.5 + i * 1e-4);
    const { embedder } = makeStubEmbedder(knownVec);
    const result = await assembleWindowEmbedding([{ id: 1, role: 'user', content: 'x' }], embedder);
    // Float64 → Float32 narrowing is lossy at the bit level but the
    // first-decimal precision should match.
    for (let i = 0; i < 768; i++) {
      expect(result[i]).toBeCloseTo(knownVec[i], 4);
    }
  });
});

// ---------------------------------------------------------------------------
// upsertWindow — DB writer (vec_windows + window_messages)
// ---------------------------------------------------------------------------

let db: ReturnType<typeof createDatabase>;
let store: ConversationStore;

const makeMessages = (contents: string[]) =>
  contents.map((content, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content,
  }));

const makeEmbedding = (seed: number): Float32Array => {
  const f = new Float32Array(768);
  for (let i = 0; i < 768; i++) f[i] = seed + i * 1e-4;
  return f;
};

const readEmbedding = (buf: Buffer): Float32Array =>
  new Float32Array(buf.buffer, buf.byteOffset, 768);

beforeAll(() => {
  db = createDatabase({ path: ':memory:', loadSqliteVec: true, runIntegrityCheck: false });
  store = new ConversationStore(db);
});

beforeEach(() => {
  // FK order: window_messages depends on messages.id. Drop the dependent
  // tables first so a fresh test slate doesn't trip the FK.
  db.exec('DELETE FROM window_messages');
  db.exec('DELETE FROM vec_windows');
  db.exec('DELETE FROM vec_sessions');
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM conversations');
});

afterAll(() => {
  db.close();
});

describe('upsertWindow', () => {
  it('inserts a new vec_windows row + window_messages rows for the window', () => {
    const conversationId = store.addConversation(makeMessages(['m0', 'm1', 'm2']), 'user-up');
    const messageRows = db
      .prepare('SELECT id FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC')
      .all(conversationId) as { id: number }[];
    const messageIds = messageRows.map((r) => r.id);

    const embedding = makeEmbedding(0.25);
    upsertWindow(db, conversationId, 0, messageIds, embedding);

    // vec_windows row exists with the bit-identical embedding
    const vecRow = db
      .prepare('SELECT embedding FROM vec_windows WHERE conversation_id = ? AND window_index = ?')
      .get(conversationId, 0n) as { embedding: Buffer };
    const stored = readEmbedding(vecRow.embedding);
    for (let i = 0; i < 768; i++) {
      expect(stored[i]).toBe(embedding[i]);
    }

    // window_messages rows present with explicit position ordering
    const joinRows = db
      .prepare(
        `SELECT message_id, position FROM window_messages
         WHERE conversation_id = ? AND window_index = ?
         ORDER BY position ASC`,
      )
      .all(conversationId, 0n) as { message_id: number; position: number }[];
    expect(joinRows).toHaveLength(3);
    expect(joinRows.map((r) => r.message_id)).toEqual(messageIds);
    expect(joinRows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it('re-running upsertWindow for the same (conversation_id, window_index) replaces both rows', () => {
    const conversationId = store.addConversation(
      makeMessages(['m0', 'm1', 'm2', 'm3']),
      'user-replace',
    );
    const messageRows = db
      .prepare('SELECT id FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC')
      .all(conversationId) as { id: number }[];
    const ids = messageRows.map((r) => r.id);

    upsertWindow(db, conversationId, 0, [ids[0], ids[1], ids[2]], makeEmbedding(0.1));

    // Now re-run with the tail-slide shape: window 0's content changes to
    // [m1, m2, m3] (different message ids + different embedding).
    upsertWindow(db, conversationId, 0, [ids[1], ids[2], ids[3]], makeEmbedding(0.9));

    const vecCount = db
      .prepare(
        'SELECT COUNT(*) AS c FROM vec_windows WHERE conversation_id = ? AND window_index = ?',
      )
      .get(conversationId, 0n) as { c: number };
    expect(vecCount.c).toBe(1);

    const joinRows = db
      .prepare(
        `SELECT message_id FROM window_messages
         WHERE conversation_id = ? AND window_index = ?
         ORDER BY position ASC`,
      )
      .all(conversationId, 0n) as { message_id: number }[];
    expect(joinRows.map((r) => r.message_id)).toEqual([ids[1], ids[2], ids[3]]);

    const vecRow = db
      .prepare('SELECT embedding FROM vec_windows WHERE conversation_id = ? AND window_index = ?')
      .get(conversationId, 0n) as { embedding: Buffer };
    const fresh = makeEmbedding(0.9);
    const stored = readEmbedding(vecRow.embedding);
    expect(stored[0]).toBe(fresh[0]);
  });

  it('writing two distinct (conversation_id, window_index) pairs leaves both rows intact', () => {
    const conversationId = store.addConversation(
      makeMessages(['m0', 'm1', 'm2', 'm3', 'm4']),
      'user-multi',
    );
    const ids = (
      db
        .prepare('SELECT id FROM messages WHERE conversation_id = ? ORDER BY sort_order ASC')
        .all(conversationId) as { id: number }[]
    ).map((r) => r.id);

    upsertWindow(db, conversationId, 0, [ids[0], ids[1], ids[2]], makeEmbedding(0.1));
    upsertWindow(db, conversationId, 1, [ids[2], ids[3], ids[4]], makeEmbedding(0.5));

    const vecCount = db
      .prepare('SELECT COUNT(*) AS c FROM vec_windows WHERE conversation_id = ?')
      .get(conversationId) as { c: number };
    expect(vecCount.c).toBe(2);

    const joinCount = db
      .prepare('SELECT COUNT(*) AS c FROM window_messages WHERE conversation_id = ?')
      .get(conversationId) as { c: number };
    expect(joinCount.c).toBe(6); // 3 + 3
  });
});
