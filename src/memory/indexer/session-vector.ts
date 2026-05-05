import type Database from 'better-sqlite3';
import { ConversationNotFoundError, InvalidArgumentError } from '../../core/errors.js';
import type { Embedder } from '../../core/interfaces.js';
import { defaultTokenCounter, type TokenCounter } from '../orchestrator/chunker.js';
import { formatMessageForEmbed, type WindowMessageRow } from './windows.js';

// ---------------------------------------------------------------------------
// buildSessionVector — embeds a whole conversation into vec_sessions
// ---------------------------------------------------------------------------

/**
 * Maximum tokens of joined session text the embedder will accept in one
 * pass. Nomic v1.5's hard context is 8192; we cap at 3000 (the same
 * Graphiti-default threshold the chunker uses for oversize messages) so
 * `buildSessionVector` fails loudly rather than silently producing a
 * vector for a truncated prefix when the conversation grows past what
 * one embed pass can represent.
 */
export const MAX_SESSION_VECTOR_TOKENS = 3000;

export interface BuildSessionVectorOptions {
  readonly tokenCounter?: TokenCounter;
  readonly maxTokens?: number;
}

/**
 * Embed an entire conversation as a single configured-dim vector (default
 * 768) and store it in `vec_sessions`. The hybrid retriever reads this row
 * as the coarse-grained session signal alongside the fine-grained
 * `vec_windows`.
 *
 * Flow:
 *   1. Verify the conversation exists; throw `ConversationNotFoundError`
 *      if it doesn't (synchronous read).
 *   2. Load all messages for the conversation in `sort_order ASC`
 *      (synchronous read).
 *   3. If the conversation has zero messages → return early (no-op; no
 *      vec_sessions write). Documented contract: an empty conversation
 *      has nothing to embed.
 *   4. Role-prefix each message (`role: content`) and join with newlines.
 *   5. **Pre-embed token guard** — if the joined text exceeds
 *      `MAX_SESSION_VECTOR_TOKENS` per `tokenCounter` (default
 *      ~4-chars/token heuristic), throw `InvalidArgumentError`. Avoids
 *      silently producing a session vector for a truncated prefix when
 *      the conversation overflows the embedder's context.
 *   6. Embed once via the supplied embedder (async; runs OUTSIDE the
 *      write transaction because better-sqlite3's `db.transaction`
 *      wrapper is synchronous).
 *   7. Inside `db.transaction(...)`: DELETE the existing `vec_sessions`
 *      row for `conversation_id` (vec0 PK rejects INSERT OR REPLACE —
 *      enforced by the PK-rejection test contract), then INSERT the
 *      fresh row with `+updated_at = BigInt(Date.now())`.
 *
 * The `db.transaction` wraps only steps 7's DELETE + INSERT, so a thrown
 * embedder (step 6) never opens a transaction at all — the prior
 * vec_sessions row, if any, is untouched.
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
  options: BuildSessionVectorOptions = {},
): Promise<void> => {
  if (conversationId === '') {
    throw new InvalidArgumentError('buildSessionVector: conversationId must be non-empty');
  }

  const tokenCounter = options.tokenCounter ?? defaultTokenCounter;
  const maxTokens = options.maxTokens ?? MAX_SESSION_VECTOR_TOKENS;

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
    // empty session vector. The hybrid retriever treats a missing
    // vec_sessions row as "no session-level signal yet."
    return;
  }

  const text = messageRows.map(formatMessageForEmbed).join('\n');
  const tokens = tokenCounter(text);
  if (tokens > maxTokens) {
    throw new InvalidArgumentError(
      `buildSessionVector: conversation ${conversationId} exceeds session-vector token budget (${tokens} > ${maxTokens}). ` +
        `Chunk the conversation first or raise maxTokens explicitly. Nomic v1.5's hard context is 8192.`,
    );
  }

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
