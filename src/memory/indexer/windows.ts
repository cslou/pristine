import type Database from 'better-sqlite3';
import type { Embedder } from '../../core/interfaces.js';
import { InvalidArgumentError } from '../../core/errors.js';
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
  const K = newMessageSortOrder;

  // Defensive — `resolveConfig` validates `0 <= overlap < windowSize` so
  // stride is always >= 1 in production. Tests construct configs directly,
  // and a stride <= 0 would otherwise infinite-loop the window-count math.
  if (stride <= 0) {
    throw new InvalidArgumentError(
      `computeWindowsForMessage: stride must be positive (windowSize=${windowSize}, windowOverlap=${windowOverlap})`,
    );
  }

  // Short-conversation case: ONE partial window covering all messages.
  if (N < windowSize) {
    return [
      {
        windowIndex: 0,
        startSortOrder: 0,
        endSortOrder: N - 1,
        position: K,
      },
    ];
  }

  const numWindows = Math.ceil((N - windowSize) / stride) + 1;
  const lastWindowIndex = numWindows - 1;
  const lastWindowEnd = lastWindowIndex * stride + windowSize - 1;
  const tailSlid = lastWindowEnd > N - 1;

  // Compute the contiguous window-index range that includes K directly,
  // then iterate only those windows. Avoids building O(N/stride) entries
  // for short returns in long conversations.
  //   firstWindow = max(0, ceil((K - windowSize + 1) / stride))
  //   lastWindow  = min(numWindows - 1, floor(K / stride))
  const firstWindow = Math.max(0, Math.ceil((K - windowSize + 1) / stride));
  const lastWindow = Math.min(lastWindowIndex, Math.floor(K / stride));

  const result: WindowAssignment[] = [];
  for (let i = firstWindow; i <= lastWindow; i++) {
    let start = i * stride;
    let end = start + windowSize - 1;
    if (i === lastWindowIndex && tailSlid) {
      end = N - 1;
      start = end - windowSize + 1;
    }
    if (K >= start && K <= end) {
      result.push({
        windowIndex: i,
        startSortOrder: start,
        endSortOrder: end,
        position: K - start,
      });
    }
  }

  // The tail-slid last window may include K even when K < firstWindow*stride
  // (because the slide back moves its start earlier). Check and append if so.
  if (tailSlid && lastWindow < lastWindowIndex) {
    const slidStart = N - windowSize;
    const slidEnd = N - 1;
    if (K >= slidStart && K <= slidEnd) {
      result.push({
        windowIndex: lastWindowIndex,
        startSortOrder: slidStart,
        endSortOrder: slidEnd,
        position: K - slidStart,
      });
    }
  }

  return result;
};

// ---------------------------------------------------------------------------
// Embedding assembly
// ---------------------------------------------------------------------------

/**
 * Format one message row as `role: content` for embedding. Matches the
 * format spec-005 §16 references for window text. Exported so tests can
 * pin the format directly; production callers go through
 * `assembleWindowEmbedding`.
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
 *
 * Throws `InvalidArgumentError` on empty input — embedding "" would produce
 * a semantically meaningless vector and the embedder's behavior on empty
 * text isn't specified by the `Embedder` interface. Callers that hit this
 * have a bug upstream (window with zero messages).
 */
export const assembleWindowEmbedding = async (
  messageRows: readonly WindowMessageRow[],
  embedder: Embedder,
): Promise<Float32Array> => {
  if (messageRows.length === 0) {
    throw new InvalidArgumentError('assembleWindowEmbedding: messageRows must be non-empty');
  }
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
 * Closure of the four prepared statements + transaction wrapper that
 * `upsertWindow` needs. Created once per `db` via `createWindowWriter` so
 * Story 6's worker reuses statements across many calls.
 */
export interface WindowWriter {
  upsertWindow(
    conversationId: string,
    windowIndex: number,
    messageIds: readonly number[],
    embedding: Float32Array,
  ): void;
}

/**
 * Build a `WindowWriter` bound to a database. Prepares the four statements
 * upsertWindow needs once and reuses them across calls — Story 6's worker
 * will call upsertWindow once per affected window per processed message,
 * so per-call statement compilation is real overhead.
 *
 * **Idiom:** vec0 does NOT support INSERT OR REPLACE on (conversation_id,
 * window_index) — the contract pinned by sprint-014's PK-rejection test
 * forces DELETE + INSERT inside a `db.transaction(...)`. The writer does
 * the same for `window_messages` so a (conversation_id, window_index) pair
 * is replaced atomically across both tables.
 *
 * **BigInt at the vec0 bind boundary:** `vec_windows.window_index` is
 * INTEGER on a vec0 virtual table; better-sqlite3 binds plain JS numbers
 * as REAL by default, which vec0 rejects with "Expected integer for
 * INTEGER metadata column". Coerce to `BigInt(windowIndex)` at every vec0
 * bind site. Plain numbers are fine for `window_messages` (regular table).
 *
 * Caller responsibilities (upsertWindow):
 *   - `messageIds.length` must be > 0; the array's order determines
 *     `window_messages.position` (0-indexed).
 *   - `embedding` must be a 768-d Float32Array (Nomic v1.5).
 *   - Calling outside an outer transaction is fine; upsertWindow has its
 *     own atomic boundary. Calling INSIDE an outer transaction also works
 *     (the inner db.transaction becomes a savepoint).
 */
export const createWindowWriter = (db: Database.Database): WindowWriter => {
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

  return {
    upsertWindow(conversationId, windowIndex, messageIds, embedding): void {
      if (messageIds.length === 0) {
        throw new InvalidArgumentError(
          'upsertWindow: messageIds must be non-empty (a window with zero messages has no embedding)',
        );
      }
      const windowIndexBig = BigInt(windowIndex);
      const embeddingBuf = Buffer.from(
        embedding.buffer,
        embedding.byteOffset,
        embedding.byteLength,
      );

      const runTransaction = db.transaction(() => {
        deleteVec.run(conversationId, windowIndexBig);
        deleteJoin.run(conversationId, windowIndexBig);
        insertVec.run(conversationId, windowIndexBig, embeddingBuf);
        for (let position = 0; position < messageIds.length; position++) {
          // window_messages is a regular SQLite table — position is plain
          // INTEGER, so no BigInt coercion is needed. Only vec0 metadata
          // columns require BigInt.
          insertJoin.run(conversationId, windowIndexBig, messageIds[position], position);
        }
      });

      runTransaction();
    },
  };
};

/**
 * Convenience one-shot wrapper. Equivalent to
 * `createWindowWriter(db).upsertWindow(...)` — pays the per-call prepare
 * cost. Story 6's worker should use `createWindowWriter` directly and
 * reuse the writer across many calls; this thin shim is for tests and
 * one-off callers.
 */
export const upsertWindow = (
  db: Database.Database,
  conversationId: string,
  windowIndex: number,
  messageIds: readonly number[],
  embedding: Float32Array,
): void => {
  createWindowWriter(db).upsertWindow(conversationId, windowIndex, messageIds, embedding);
};
