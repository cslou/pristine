import type { BootstrapCI, PairedDelta } from './types.js';

/**
 * Paired bootstrap for retrieval-metric deltas.
 *
 * The bootstrap is paired-by-query: each resample picks the same query
 * indices for both A and B, so query-difficulty noise (some queries are
 * harder than others, irrespective of which embedder runs them) cancels
 * in the per-resample delta. The returned 95% CI for the metric (or
 * delta) is the [2.5th, 97.5th] percentile of the resample distribution.
 *
 * 1000 resamples is the methodology-doc target; tighter CIs need more
 * resamples but the 1k floor was chosen at sprint planning to keep
 * eval wall-time under ~30s per candidate.
 */

const DEFAULT_RESAMPLES = 1000;

/**
 * Deterministic seedable PRNG (mulberry32). Math.random isn't seedable,
 * so for reproducible CIs we roll a tiny PRNG. Output is uniform on [0, 1).
 */
const mulberry32 = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Mean of a numeric array. Returns 0 for empty input (keeps downstream
 * code branchless without producing NaN).
 */
const mean = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
};

/**
 * 95% percentile interval [2.5th, 97.5th]. Sorts a copy of the input
 * (does not mutate). For n=1000, the indices are 25 and 975.
 */
const percentile95CI = (sortedSamples: readonly number[], point: number): BootstrapCI => {
  if (sortedSamples.length === 0) return { point, lower: point, upper: point };
  const lowerIdx = Math.floor(0.025 * sortedSamples.length);
  const upperIdx = Math.min(sortedSamples.length - 1, Math.floor(0.975 * sortedSamples.length));
  return {
    point,
    lower: sortedSamples[lowerIdx]!,
    upper: sortedSamples[upperIdx]!,
  };
};

/**
 * Bootstrap CI for the mean of a single sample. `point` is the mean
 * computed on the full sample (not a resample); `lower` / `upper` are
 * the 2.5th / 97.5th percentiles of the resample-mean distribution.
 *
 * Resampling is with replacement — standard nonparametric bootstrap.
 */
export const bootstrapMeanCI = (
  values: readonly number[],
  options: { readonly resamples?: number; readonly seed?: number } = {},
): BootstrapCI => {
  const { resamples = DEFAULT_RESAMPLES, seed = 0xc0ffee } = options;
  if (values.length === 0) return { point: 0, lower: 0, upper: 0 };

  const rng = mulberry32(seed);
  const n = values.length;
  const resampleMeans: number[] = new Array<number>(resamples);

  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * n);
      sum += values[idx]!;
    }
    resampleMeans[r] = sum / n;
  }

  resampleMeans.sort((a, b) => a - b);
  return percentile95CI(resampleMeans, mean(values));
};

/**
 * Paired bootstrap CI for the delta between two metric arrays paired
 * by query. `valuesA[i]` and `valuesB[i]` must be the same query;
 * arrays must be the same length and same query order.
 *
 * The delta computed per resample is `mean(B[indices]) - mean(A[indices])`
 * — positive = B better than A. Returned `point` is the delta on the
 * full (non-resampled) sample.
 */
export const pairedBootstrapDeltaCI = (
  valuesA: readonly number[],
  valuesB: readonly number[],
  options: { readonly resamples?: number; readonly seed?: number } = {},
): BootstrapCI => {
  if (valuesA.length !== valuesB.length) {
    throw new Error(
      `pairedBootstrapDeltaCI: paired arrays must have same length (got ${valuesA.length} vs ${valuesB.length})`,
    );
  }
  const { resamples = DEFAULT_RESAMPLES, seed = 0xc0ffee } = options;
  const n = valuesA.length;
  if (n === 0) return { point: 0, lower: 0, upper: 0 };

  const rng = mulberry32(seed);
  const deltas: number[] = new Array<number>(resamples);

  for (let r = 0; r < resamples; r++) {
    let sumA = 0;
    let sumB = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * n);
      sumA += valuesA[idx]!;
      sumB += valuesB[idx]!;
    }
    deltas[r] = sumB / n - sumA / n;
  }

  deltas.sort((a, b) => a - b);
  return percentile95CI(deltas, mean(valuesB) - mean(valuesA));
};

/**
 * Convenience: compute paired-bootstrap deltas for the 5 retrieval
 * metrics in one call (used by Story 4's report writer).
 */
export const pairedBootstrapAllMetrics = (
  pairsByMetric: {
    readonly ndcg10: { readonly a: readonly number[]; readonly b: readonly number[] };
    readonly recall5: { readonly a: readonly number[]; readonly b: readonly number[] };
    readonly recall10: { readonly a: readonly number[]; readonly b: readonly number[] };
    readonly recall20: { readonly a: readonly number[]; readonly b: readonly number[] };
    readonly mrr: { readonly a: readonly number[]; readonly b: readonly number[] };
  },
  options: { readonly resamples?: number; readonly seed?: number } = {},
): readonly PairedDelta[] => {
  const metrics = ['ndcg10', 'recall5', 'recall10', 'recall20', 'mrr'] as const;
  return metrics.map((metric) => ({
    metric,
    delta: pairedBootstrapDeltaCI(pairsByMetric[metric].a, pairsByMetric[metric].b, options),
  }));
};
