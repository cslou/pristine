import type Database from 'better-sqlite3';
import { ConversationNotFoundError } from '../../core/errors.js';
import type { Embedder } from '../../core/interfaces.js';
import { formatMessageForEmbed, type WindowMessageRow } from './windows.js';

// ---------------------------------------------------------------------------
// buildSessionVector — sprint-015 Story 5 (spec-005 §16 Phase 3 P3-S4)
// ---------------------------------------------------------------------------

/**
 * Embed an entire conversation as a single 768-d vector and store it in
 * `vec_sessions`. Phase-4 hybrid retrieval reads this row as the
 * coarse-grained session signal alongside the fine-grained `vec_windows`.
 *
 * Flow (all inside a single `db.transaction`):
 *   1. Verify the conversation exists; throw `ConversationNotFoundError`
 *      if it doesn't.
 *   2. Load all messages for the conversation in `sort_order ASC`.
 *   3. If the conversation has zero messages → return early (no-op; no
 *      vec_sessions write). Documented contract: an empty conversation
 *      has nothing to embed.
 *   4. Role-prefix each message (`role: content` per spec-005 §16) and
 *      join with newlines; embed once via the supplied embedder.
 *   5. DELETE existing `vec_sessions` row for `conversation_id` (vec0 PK
 *      rejects INSERT OR REPLACE — this is the verified replace idiom from
 *      sprint-014 Story 2's PK-rejection test).
 *   6. INSERT the fresh row with `+updated_at = BigInt(Date.now())`.
 *
 * `db.transaction(...)` makes the read + delete + insert atomic — a partial
 * failure rolls back rather than leaving a stale or torn row.
 *
 * **BigInt at the vec0 bind boundary:** `vec_sessions.+updated_at INTEGER`
 * is a vec0 auxiliary column; better-sqlite3 binds plain JS numbers as
 * REAL and vec0 rejects them. `BigInt(Date.now())` is the canonical
 * binding pattern.
 *
 * Re-running for the same `conversationId` overwrites cleanly (DELETE +
 * INSERT inside the same transaction; fresh `updated_at`).
 */
export const buildSessionVector = async (
  db: Database.Database,
  embedder: Embedder,
  conversationId: string,
): Promise<void> => {
  // Verify the conversation exists outside the write transaction so we can
  // throw a meaningful error before doing the (potentially slow) embedder
  // call. Reading + writing in the same transaction would also work, but
  // the embed-then-write is async and can't sit inside better-sqlite3's
  // sync transaction wrapper.
  const conversationRow = db
    .prepare('SELECT 1 AS present FROM conversations WHERE id = ?')
    .get(conversationId) as { present: number } | undefined;
  if (!conversationRow) {
    throw new ConversationNotFoundError(`Conversation not found: ${conversationId}`);
  }

  const messageRows = db
    .prepare(
      `SELECT id, role, content
       FROM messages
       WHERE conversation_id = ?
       ORDER BY sort_order ASC`,
    )
    .all(conversationId) as WindowMessageRow[];

  if (messageRows.length === 0) {
    // Empty conversation — no-op. Documented contract: don't write an
    // empty session vector. Phase-4 retrieval treats a missing
    // vec_sessions row as "no session-level signal yet."
    return;
  }

  const text = messageRows.map(formatMessageForEmbed).join('\n');
  const vec = await embedder.embed(text);
  const embedding = Float32Array.from(vec);
  const embeddingBuf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  const updatedAt = BigInt(Date.now());

  const writeTransaction = db.transaction(() => {
    db.prepare('DELETE FROM vec_sessions WHERE conversation_id = ?').run(conversationId);
    db.prepare(
      'INSERT INTO vec_sessions(conversation_id, embedding, updated_at) VALUES (?, ?, ?)',
    ).run(conversationId, embeddingBuf, updatedAt);
  });

  writeTransaction();
};
