import type Database from 'better-sqlite3';
import type { Embedder } from '../../core/interfaces.js';
import type { ResolvedIndexerConfig } from './index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One window the new message at `position` participates in.
 *
 * `windowIndex` is the dense, 0-based ordinal of the window within the
 * conversation. `startSortOrder` and `endSortOrder` (both inclusive)
 * delimit the window in `messages.sort_order` space; `position` is the
 * 0-based index of the input `newMessageSortOrder` inside the window
 * (i.e., `position = newMessageSortOrder - startSortOrder`).
 */
export interface WindowAssignment {
  readonly windowIndex: number;
  readonly startSortOrder: number;
  readonly endSortOrder: number;
  readonly position: number;
}

/**
 * Row shape consumed by `assembleWindowEmbedding`. Mirrors what a worker
 * would SELECT from `messages` for a window's constituent rows. Kept narrow
 * (role + content only) so callers don't have to round-trip extra columns.
 */
export interface WindowMessageRow {
  readonly id: number;
  readonly role: string;
  readonly content: string;
}

// ---------------------------------------------------------------------------
// Pure-logic: window-index math
// ---------------------------------------------------------------------------

/**
 * Compute the windows the new message at `newMessageSortOrder` participates
 * in given a conversation of length `totalMessageCount` and the indexer
 * config. Pure function — no DB access.
 *
 * Behavior:
 *   - `totalMessageCount === 0` or `newMessageSortOrder` out of range → [].
 *   - `1 <= totalMessageCount < windowSize` → ONE partial window, indexes
 *     `[0..totalMessageCount-1]`, `windowIndex = 0`. Phase-3 always indexes
 *     short conversations.
 *   - `totalMessageCount >= windowSize` → regular sliding windows of
 *     `stride = windowSize - windowOverlap`. The final window applies
 *     **tail-slide-back**: when its natural end `(numWindows-1)*stride +
 *     windowSize - 1` would exceed the last sortOrder, the window shifts
 *     back so it always contains exactly `windowSize` messages. The last
 *     window's overlap with its predecessor may temporarily exceed the
 *     configured `windowOverlap` as a result — that's the price of always-
 *     full windows.
 *
 * The signature differs from the sprint-015 sketch (`(conversationId,
 * sortOrder, config)` → `(sortOrder, totalCount, config)`) — `conversationId`
 * was unused for pure logic, and the function genuinely needs the total
 * count to determine which windows are currently present.
 *
 * Return value: only the windows that include the new message. Window-index
 * deltas (e.g., the previous tail window getting reshaped on append) are NOT
 * returned here; callers that care about reshaping detection should diff
 * computeWindowsForMessage(K, N) against computeWindowsForMessage(K, N-1).
 */
export const computeWindowsForMessage = (
  newMessageSortOrder: number,
  totalMessageCount: number,
  config: ResolvedIndexerConfig,
): WindowAssignment[] => {
  if (
    totalMessageCount <= 0 ||
    newMessageSortOrder < 0 ||
    newMessageSortOrder >= totalMessageCount
  ) {
    return [];
  }

  const { windowSize, windowOverlap } = config;
  const stride = windowSize - windowOverlap;
  const N = totalMessageCount;

  const allWindows: WindowAssignment[] = [];

  if (N < windowSize) {
    // Single partial window covers the whole short conversation.
    allWindows.push({
      windowIndex: 0,
      startSortOrder: 0,
      endSortOrder: N - 1,
      position: newMessageSortOrder,
    });
  } else {
    const numWindows = Math.ceil((N - windowSize) / stride) + 1;
    for (let i = 0; i < numWindows; i++) {
      let start = i * stride;
      let end = start + windowSize - 1;
      // Tail-slide-back: if the last window's natural range overshoots, pin
      // its end at the last message and slide start back to keep windowSize.
      if (end > N - 1) {
        end = N - 1;
        start = end - windowSize + 1;
      }
      const position = newMessageSortOrder - start;
      allWindows.push({
        windowIndex: i,
        startSortOrder: start,
        endSortOrder: end,
        position,
      });
    }
  }

  return allWindows.filter(
    (w) => newMessageSortOrder >= w.startSortOrder && newMessageSortOrder <= w.endSortOrder,
  );
};

// ---------------------------------------------------------------------------
// Embedding assembly
// ---------------------------------------------------------------------------

/**
 * Format one message row as `role: content` for embedding. Matches the
 * format spec-005 §16 references for window text. Module-private — exposed
 * only for tests via the named export below.
 */
export const formatMessageForEmbed = (row: WindowMessageRow): string =>
  `${row.role}: ${row.content}`;

/**
 * Concatenate a window's messages (role-prefixed, newline-joined), embed
 * once via the supplied `embedder`, and return the result as a Float32Array.
 *
 * `embedder` is an explicit parameter (not a module-level import) so
 * callers can inject a stub in tests and so the helper stays free of
 * embedder-construction concerns.
 */
export const assembleWindowEmbedding = async (
  messageRows: readonly WindowMessageRow[],
  embedder: Embedder,
): Promise<Float32Array> => {
  const text = messageRows.map(formatMessageForEmbed).join('\n');
  const vec = await embedder.embed(text);
  // Embedder returns number[]; convert to Float32 for vec0 storage. Float64
  // → Float32 narrowing is lossy, but vec0 stores Float32, so this is the
  // canonical representation of "what gets persisted".
  return Float32Array.from(vec);
};

// ---------------------------------------------------------------------------
// vec_windows + window_messages writer
// ---------------------------------------------------------------------------

/**
 * Atomically replace one window's vector + constituent message-id rows.
 *
 * **Idiom:** vec0 does NOT support INSERT OR REPLACE on (conversation_id,
 * window_index) — the contract pinned by sprint-014's PK-rejection test
 * forces DELETE + INSERT inside a `db.transaction(...)`. This method does
 * the same for `window_messages` so a (conversation_id, window_index) pair
 * is replaced atomically across both tables.
 *
 * **BigInt at the bind boundary:** `window_index` is INTEGER on a vec0
 * virtual table; better-sqlite3 binds plain JS numbers as REAL by default,
 * which vec0 rejects with "Expected integer for INTEGER metadata column".
 * Coerce to `BigInt(windowIndex)` at every bind site.
 *
 * Caller responsibilities:
 *   - `messageIds.length` must match the window's constituent message
 *     count; the array's order determines `window_messages.position`
 *     (0-indexed).
 *   - `embedding` must be a 768-d Float32Array (Nomic v1.5).
 *   - Calling outside an outer transaction is fine; this method has its
 *     own atomic boundary.
 */
export const upsertWindow = (
  db: Database.Database,
  conversationId: string,
  windowIndex: number,
  messageIds: readonly number[],
  embedding: Float32Array,
): void => {
  const windowIndexBig = BigInt(windowIndex);
  const embeddingBuf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

  const deleteVec = db.prepare(
    'DELETE FROM vec_windows WHERE conversation_id = ? AND window_index = ?',
  );
  const deleteJoin = db.prepare(
    'DELETE FROM window_messages WHERE conversation_id = ? AND window_index = ?',
  );
  const insertVec = db.prepare(
    'INSERT INTO vec_windows(conversation_id, window_index, embedding) VALUES (?, ?, ?)',
  );
  const insertJoin = db.prepare(
    'INSERT INTO window_messages(conversation_id, window_index, message_id, position) VALUES (?, ?, ?, ?)',
  );

  const runTransaction = db.transaction(() => {
    deleteVec.run(conversationId, windowIndexBig);
    deleteJoin.run(conversationId, windowIndexBig);
    insertVec.run(conversationId, windowIndexBig, embeddingBuf);
    for (let position = 0; position < messageIds.length; position++) {
      insertJoin.run(conversationId, windowIndexBig, messageIds[position], BigInt(position));
    }
  });

  runTransaction();
};
