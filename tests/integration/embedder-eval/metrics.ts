/**
 * Retrieval-quality + latency metrics. All functions are pure: take a
 * ranked list of doc IDs (the embedder's output ordered by descending
 * relevance) plus the set of relevant doc IDs, return a number.
 *
 * Binary relevance only — graded relevance is out of scope this sprint.
 * NDCG@K is therefore equivalent to a normalised DCG with binary gain.
 */

/**
 * Discounted Cumulative Gain at K with binary relevance:
 *   DCG@K = Σ_{i=1..K} rel_i / log2(i + 1)
 * where rel_i = 1 if rankedDocIds[i-1] ∈ relevantDocIds, else 0.
 */
const dcgAtK = (
  rankedDocIds: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number => {
  let dcg = 0;
  const limit = Math.min(k, rankedDocIds.length);
  for (let i = 0; i < limit; i++) {
    if (relevant.has(rankedDocIds[i]!)) {
      // Math.log2(i + 2) because i is 0-indexed but the formula uses 1-indexed rank
      dcg += 1 / Math.log2(i + 2);
    }
  }
  return dcg;
};

/**
 * Ideal DCG: the DCG achieved by the optimal ranking (all relevant
 * docs at the top). With binary relevance, this is simply the sum of
 * 1/log2(i+1) for i in 1..min(K, |relevant|).
 */
const idcgAtK = (numRelevant: number, k: number): number => {
  let idcg = 0;
  const limit = Math.min(k, numRelevant);
  for (let i = 0; i < limit; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg;
};

/**
 * NDCG@K: DCG@K / IDCG@K. Returns 0 when no relevant docs exist
 * (otherwise the metric is undefined). Standard tie-break for missing
 * relevance: 0 rather than NaN, so downstream aggregation is well-defined.
 */
export const ndcgAtK = (
  rankedDocIds: readonly string[],
  relevantDocIds: readonly string[],
  k: number,
): number => {
  if (relevantDocIds.length === 0) return 0;
  const relevant = new Set(relevantDocIds);
  const idcg = idcgAtK(relevantDocIds.length, k);
  if (idcg === 0) return 0;
  return dcgAtK(rankedDocIds, relevant, k) / idcg;
};

/**
 * Recall@K: fraction of relevant docs that appear in the top-K of the
 * ranked list. Returns 0 when no relevant docs exist.
 */
export const recallAtK = (
  rankedDocIds: readonly string[],
  relevantDocIds: readonly string[],
  k: number,
): number => {
  if (relevantDocIds.length === 0) return 0;
  const relevant = new Set(relevantDocIds);
  const limit = Math.min(k, rankedDocIds.length);
  let hits = 0;
  for (let i = 0; i < limit; i++) {
    if (relevant.has(rankedDocIds[i]!)) hits += 1;
  }
  return hits / relevantDocIds.length;
};

/**
 * Mean Reciprocal Rank: 1 / rank-of-first-relevant in the full ranked
 * list. 0 if no relevant doc is found. No K cap — standard MRR.
 */
export const reciprocalRank = (
  rankedDocIds: readonly string[],
  relevantDocIds: readonly string[],
): number => {
  if (relevantDocIds.length === 0) return 0;
  const relevant = new Set(relevantDocIds);
  for (let i = 0; i < rankedDocIds.length; i++) {
    if (relevant.has(rankedDocIds[i]!)) return 1 / (i + 1);
  }
  return 0;
};

/**
 * Latency percentile from a sample. Uses the nearest-rank method (no
 * interpolation) — standard for SLO reporting and stable under small
 * N. `pct` is in [0, 100].
 */
export const percentile = (samples: readonly number[], pct: number): number => {
  if (samples.length === 0) return 0;
  if (pct < 0 || pct > 100) {
    throw new Error(`percentile: pct must be in [0, 100], got ${pct}`);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((pct / 100) * sorted.length);
  const idx = Math.max(0, Math.min(sorted.length - 1, rank - 1));
  return sorted[idx]!;
};
