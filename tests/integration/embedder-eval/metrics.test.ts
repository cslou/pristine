import { describe, expect, it } from 'vitest';
import { ndcgAtK, percentile, recallAtK, reciprocalRank } from './metrics.js';

describe('ndcgAtK', () => {
  it('returns 1.0 when all relevant docs are at the top of the ranking', () => {
    expect(ndcgAtK(['a', 'b', 'c', 'd'], ['a', 'b'], 10)).toBeCloseTo(1.0, 6);
  });

  it('returns 0 when no relevant docs are in the result', () => {
    expect(ndcgAtK(['x', 'y', 'z'], ['a', 'b'], 10)).toBe(0);
  });

  it('returns 0 when relevantDocIds is empty', () => {
    expect(ndcgAtK(['a', 'b'], [], 10)).toBe(0);
  });

  it('discounts later positions per the standard 1/log2(rank+1) formula', () => {
    // Two relevant; one at rank 1 (gain = 1/log2(2) = 1.0), one at rank 3
    // (gain = 1/log2(4) = 0.5). DCG@10 = 1.5. Ideal: rank 1 + rank 2
    // = 1/log2(2) + 1/log2(3) = 1.0 + 0.6309… = 1.6309. NDCG ≈ 0.9197.
    const ndcg = ndcgAtK(['rel1', 'irrel', 'rel2', 'irrel2'], ['rel1', 'rel2'], 10);
    expect(ndcg).toBeCloseTo(1.5 / (1.0 + 1 / Math.log2(3)), 6);
  });

  it('caps the cumulative gain at K', () => {
    // K=2; only the first 2 results contribute.
    const ndcg = ndcgAtK(['rel1', 'irrel', 'rel2'], ['rel1', 'rel2'], 2);
    // DCG@2 = 1.0. IDCG@2 = 1/log2(2) + 1/log2(3) = 1.0 + 0.6309 = 1.6309.
    expect(ndcg).toBeCloseTo(1.0 / (1.0 + 1 / Math.log2(3)), 6);
  });
});

describe('recallAtK', () => {
  it('returns 1.0 when all relevant docs are in top-K', () => {
    expect(recallAtK(['a', 'b', 'c'], ['a', 'b'], 10)).toBe(1.0);
  });

  it('returns 0 when no relevant docs are in the result', () => {
    expect(recallAtK(['x', 'y'], ['a'], 10)).toBe(0);
  });

  it('returns 0 when relevantDocIds is empty', () => {
    expect(recallAtK(['a'], [], 10)).toBe(0);
  });

  it('caps the lookup window at K', () => {
    // K=2; only first 2 results count toward the recall numerator.
    expect(recallAtK(['rel1', 'irrel', 'rel2'], ['rel1', 'rel2'], 2)).toBe(0.5);
  });

  it('partial recall: 1 of 2 relevant in top-K', () => {
    expect(recallAtK(['a', 'x', 'y'], ['a', 'b'], 10)).toBe(0.5);
  });
});

describe('reciprocalRank', () => {
  it('returns 1.0 when first result is relevant', () => {
    expect(reciprocalRank(['rel', 'x', 'y'], ['rel'])).toBe(1.0);
  });

  it('returns 0.5 when relevant doc is at rank 2', () => {
    expect(reciprocalRank(['x', 'rel', 'y'], ['rel'])).toBe(0.5);
  });

  it('returns 0 when no relevant doc is in the result', () => {
    expect(reciprocalRank(['x', 'y'], ['rel'])).toBe(0);
  });

  it('returns 0 when relevantDocIds is empty', () => {
    expect(reciprocalRank(['a', 'b'], [])).toBe(0);
  });

  it('returns reciprocal of FIRST relevant rank when multiple are present', () => {
    expect(reciprocalRank(['x', 'rel1', 'rel2'], ['rel1', 'rel2'])).toBe(0.5);
  });
});

describe('percentile', () => {
  it('returns the median for p50 of a sorted-uniform sample', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it('returns p95 of a 100-element sample as the 95th element', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBe(95);
  });

  it('returns 0 for empty input', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('handles single-element sample at any percentile', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it('rejects out-of-range pct', () => {
    expect(() => percentile([1], -1)).toThrow();
    expect(() => percentile([1], 101)).toThrow();
  });
});
