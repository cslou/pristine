/**
 * Shared types for the embedder eval harness.
 *
 * The harness is a maintainer tool — it lives outside `src/` and is not
 * part of the SDK's public surface. It exists to score any `Embedder`
 * implementation on a labelled query set with retrieval-quality metrics
 * (NDCG@10, Recall@K, MRR) plus paired-bootstrap confidence intervals,
 * so candidate selection has uncertainty quantification rather than
 * point-rank claims.
 */

/**
 * Grade buckets for query difficulty. Each query is tagged with one of
 * three buckets so the eval can report metric stratification.
 *
 * - `pessimistic` — lexically dissimilar, semantically related. The
 *   hard cases where dense retrieval should outperform pure BM25.
 * - `typical` — natural-language queries with mixed lexical + semantic
 *   overlap. The "average" retrieval workload.
 * - `optimistic` — high lexical overlap with the relevant doc(s);
 *   FTS5/BM25 should win or tie. Sanity-check bucket.
 */
export type QueryGrade = 'pessimistic' | 'typical' | 'optimistic';

/**
 * One labelled query in the eval set. `relevantDocIds` lists the
 * `EvalDoc.conversationId` values that are considered a relevant
 * retrieval target — the harness's retrieval primitives surface hits
 * keyed by conversationId, so the relevance comparison is at the
 * conversation level. (When the corpus uses one-message-per-conversation
 * the conversationId equals the doc's `id` field, so callers can think
 * of these as doc IDs.) Binary relevance only — graded relevance is
 * out of scope this sprint.
 */
export interface EvalQuery {
  readonly id: string;
  readonly query: string;
  readonly relevantDocIds: readonly string[];
  readonly grade: QueryGrade;
}

/**
 * One corpus document. Mirrors the shape of a Pristine message (role +
 * content + project/conversation IDs) so the eval can exercise both
 * `searcher.vectorSearch` (window-level) and `searcher.hybridSearch`
 * (window + message + session) without bespoke fixtures.
 */
export interface EvalDoc {
  readonly id: string;
  readonly content: string;
  readonly role: 'user' | 'assistant';
  readonly conversationId: string;
  readonly projectId: string;
}

/**
 * Per-query metric record. `retrievalLatencyMs` is wall-clock for the
 * full retrieval round-trip — `embed()` + filter-set query + KNN/FTS
 * lookup + dedup. The harness measures end-to-end retrieval time
 * because that is the consumer-facing SLO; isolating just the embed
 * cost would require reaching into searcher internals and would not
 * reflect what an SDK consumer experiences.
 */
export interface PerQueryMetric {
  readonly queryId: string;
  readonly ndcg10: number;
  readonly recall5: number;
  readonly recall10: number;
  readonly recall20: number;
  readonly mrr: number;
  readonly retrievalLatencyMs: number;
}

/**
 * Bootstrap-derived 95% confidence interval. `lower` and `upper` are
 * the 2.5th and 97.5th percentiles of the bootstrap-resampled metric
 * distribution; `point` is the metric on the original (non-resampled)
 * sample.
 */
export interface BootstrapCI {
  readonly point: number;
  readonly lower: number;
  readonly upper: number;
}

/**
 * Full eval result for one configuration (dense-only OR hybrid).
 * Aggregate metrics include their bootstrap CIs; per-query records
 * are kept so reports can stratify by grade bucket.
 */
export interface EvalResult {
  readonly config: EvalConfigKind;
  readonly candidateName: string;
  readonly dimUsed: number;
  readonly perQuery: readonly PerQueryMetric[];
  readonly ndcg10: BootstrapCI;
  readonly recall5: BootstrapCI;
  readonly recall10: BootstrapCI;
  readonly recall20: BootstrapCI;
  readonly mrr: BootstrapCI;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
}

/**
 * The two retrieval modes the harness exercises:
 *
 * - `dense-only` — pure embedder-driven cosine search via
 *   `searcher.vectorSearch`. FTS5 is not consulted. Isolates the
 *   embedder's contribution to retrieval quality.
 * - `hybrid` — Pristine's production retriever (`searcher.hybridSearch`)
 *   which fuses vector + FTS5 + session via RRF. Approximates what a
 *   real consumer experiences.
 */
export type EvalConfigKind = 'dense-only' | 'hybrid';

/**
 * Options for `runEval`. `bootstrapResamples` defaults to 1000 to
 * match the methodology doc's CI tightness target. `seed` makes the
 * resample sequence deterministic for repeatability.
 */
export interface RunEvalOptions {
  readonly config: EvalConfigKind;
  readonly bootstrapResamples?: number;
  readonly seed?: number;
  /**
   * If provided, restricts the eval to queries whose `id` is in this
   * set. Useful for dev iteration / spot-checking a single bucket.
   */
  readonly queryIdAllowlist?: ReadonlySet<string>;
  /**
   * If provided, the harness uses this `Embedder` instance directly
   * instead of constructing one from the `EmbedderConfig` first
   * argument. Test-only escape hatch — production CLI flow always
   * goes through `createEmbedder(config)` so the candidate-trio
   * mapping in `candidates.ts` stays canonical.
   */
  readonly embedderOverride?: import('../../../src/core/interfaces.js').Embedder;
}

/**
 * Paired-bootstrap delta between two eval results. The pairing is
 * per-query: each resample picks the same query indices for both
 * runs, so query-difficulty noise cancels.
 */
export interface PairedDelta {
  readonly metric: 'ndcg10' | 'recall5' | 'recall10' | 'recall20' | 'mrr';
  readonly delta: BootstrapCI;
}
