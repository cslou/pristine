// Reciprocal Rank Fusion (Cormack et al. 2009).
//
// Fuses N ranked lists into one ranking by summing per-list reciprocal-rank
// contributions: score(d) = Σᵢ 1 / (k + rankᵢ(d)). Documents that appear in
// multiple lists accumulate higher fused scores.
//
// `k=60` is the original-paper default; fairness across vector + FTS rank
// scales has held empirically across many retrieval benchmarks. Don't tune
// until an eval suite produces signal.
//
// **Why `idOf` is required (no default).** The caller passes a heterogeneous
// union `WindowHit | MessageHit | SessionHit`; there's no sensible default
// property name that identifies a document across kinds. The caller
// normalizes shape at the boundary
// (`window:{conversationId}:{windowIndex}`, `message:{messageId}`, etc.) so
// RRF stays agnostic about searcher internals.

import { InvalidArgumentError } from '../../core/errors.js';

/** Default k from the original RRF paper. Stable across benchmarks. */
export const RRF_DEFAULT_K = 60;

export interface RrfOptions {
  /** Smoothing constant. Default 60 per Cormack et al. 2009. */
  readonly k?: number;
}

/**
 * Fuses multiple ranked lists into a single ranking via reciprocal-rank
 * fusion. Items in earlier ranks contribute more to the fused score.
 * Items appearing in multiple lists accumulate scores from each list
 * they appear in, naturally promoting consensus picks.
 *
 * - Pure function: identical inputs → identical output (deterministic).
 * - Idempotent: passing an already-fused list back through with itself
 *   doesn't change rank order.
 * - Empty lists are dropped silently. An all-empty input returns `[]`.
 * - Tie-breaking: items with identical fused scores preserve the order
 *   they were first encountered (stable sort over fused-score map).
 */
export function reciprocalRankFusion<T>(
  rankedLists: readonly (readonly T[])[],
  idOf: (item: T) => string,
  opts: RrfOptions = {},
): T[] {
  const k = opts.k ?? RRF_DEFAULT_K;
  if (!Number.isFinite(k) || k <= 0) {
    throw new InvalidArgumentError(
      `reciprocalRankFusion: k must be a positive finite number, got ${String(k)}`,
    );
  }

  const scores = new Map<string, number>();
  // First-seen order preserves the stable tie-break: an item that appears
  // earlier across the input lists wins ties against a later item with
  // the same fused score.
  const firstSeen = new Map<string, T>();
  const firstSeenIndex = new Map<string, number>();
  let nextIndex = 0;

  for (const list of rankedLists) {
    if (list.length === 0) continue;
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const id = idOf(item);
      // RRF rank is 1-indexed in the canonical formula: 1 / (k + rank)
      // where rank starts at 1 for the top item.
      const contribution = 1 / (k + rank + 1);
      scores.set(id, (scores.get(id) ?? 0) + contribution);
      if (!firstSeen.has(id)) {
        firstSeen.set(id, item);
        firstSeenIndex.set(id, nextIndex++);
      }
    }
  }

  return Array.from(firstSeen.entries())
    .map(([id, item]) => ({
      item,
      score: scores.get(id) ?? 0,
      firstSeen: firstSeenIndex.get(id) ?? 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.firstSeen - b.firstSeen;
    })
    .map((entry) => entry.item);
}
