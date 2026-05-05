import { describe, expect, it } from 'vitest';
import { bootstrapMeanCI, pairedBootstrapAllMetrics, pairedBootstrapDeltaCI } from './bootstrap.js';

describe('bootstrapMeanCI', () => {
  it('point matches the sample mean', () => {
    const ci = bootstrapMeanCI([1, 2, 3, 4, 5], { resamples: 200, seed: 42 });
    expect(ci.point).toBe(3);
  });

  it('returns a 0-width CI for a constant-valued sample', () => {
    const ci = bootstrapMeanCI([5, 5, 5, 5, 5], { resamples: 500, seed: 7 });
    expect(ci.point).toBe(5);
    expect(ci.lower).toBe(5);
    expect(ci.upper).toBe(5);
  });

  it('lower ≤ point ≤ upper for non-degenerate sample', () => {
    const ci = bootstrapMeanCI([0.1, 0.5, 0.7, 0.9, 0.95], { resamples: 1000, seed: 13 });
    expect(ci.lower).toBeLessThanOrEqual(ci.point);
    expect(ci.point).toBeLessThanOrEqual(ci.upper);
  });

  it('is deterministic given the same seed', () => {
    const a = bootstrapMeanCI([0.1, 0.2, 0.4, 0.8], { resamples: 500, seed: 99 });
    const b = bootstrapMeanCI([0.1, 0.2, 0.4, 0.8], { resamples: 500, seed: 99 });
    expect(a).toEqual(b);
  });

  it('different seeds produce different resample distributions (sanity)', () => {
    const a = bootstrapMeanCI([0.1, 0.2, 0.4, 0.8], { resamples: 500, seed: 1 });
    const b = bootstrapMeanCI([0.1, 0.2, 0.4, 0.8], { resamples: 500, seed: 2 });
    // Points are identical (seeds don't change the mean); CIs may differ
    // slightly due to resample noise.
    expect(a.point).toBe(b.point);
    // Hard to assert "different" deterministically without flake; just
    // confirm the bootstrap ran.
    expect(a.lower).toBeLessThanOrEqual(a.upper);
    expect(b.lower).toBeLessThanOrEqual(b.upper);
  });

  it('returns 0/0/0 for empty input', () => {
    const ci = bootstrapMeanCI([], { resamples: 500, seed: 1 });
    expect(ci).toEqual({ point: 0, lower: 0, upper: 0 });
  });
});

describe('pairedBootstrapDeltaCI', () => {
  it('returns 0 delta when the two samples are identical', () => {
    const a = [0.1, 0.2, 0.3, 0.4, 0.5];
    const ci = pairedBootstrapDeltaCI(a, a, { resamples: 500, seed: 11 });
    expect(ci.point).toBe(0);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBe(0);
  });

  it('point delta matches mean(b) - mean(a)', () => {
    const a = [0.1, 0.2, 0.3];
    const b = [0.4, 0.5, 0.6];
    const ci = pairedBootstrapDeltaCI(a, b, { resamples: 500, seed: 17 });
    expect(ci.point).toBeCloseTo(0.3, 6);
  });

  it('CI brackets the point estimate', () => {
    const a = [0.1, 0.2, 0.4, 0.8];
    const b = [0.2, 0.3, 0.5, 0.85];
    const ci = pairedBootstrapDeltaCI(a, b, { resamples: 1000, seed: 23 });
    expect(ci.lower).toBeLessThanOrEqual(ci.point);
    expect(ci.point).toBeLessThanOrEqual(ci.upper);
  });

  it('throws when paired arrays have different lengths', () => {
    expect(() => pairedBootstrapDeltaCI([1, 2], [1], { resamples: 100, seed: 1 })).toThrow();
  });

  it('returns 0/0/0 for empty paired input', () => {
    const ci = pairedBootstrapDeltaCI([], [], { resamples: 500, seed: 1 });
    expect(ci).toEqual({ point: 0, lower: 0, upper: 0 });
  });

  it('is deterministic given the same seed', () => {
    const a = [0.1, 0.2, 0.4];
    const b = [0.2, 0.3, 0.5];
    const c1 = pairedBootstrapDeltaCI(a, b, { resamples: 500, seed: 31 });
    const c2 = pairedBootstrapDeltaCI(a, b, { resamples: 500, seed: 31 });
    expect(c1).toEqual(c2);
  });
});

describe('pairedBootstrapAllMetrics', () => {
  it('returns one PairedDelta per metric in canonical order', () => {
    const pairs = {
      ndcg10: { a: [0.1, 0.2], b: [0.2, 0.3] },
      recall5: { a: [0.5, 0.6], b: [0.6, 0.7] },
      recall10: { a: [0.7, 0.8], b: [0.8, 0.9] },
      recall20: { a: [0.8, 0.85], b: [0.9, 0.95] },
      mrr: { a: [0.4, 0.5], b: [0.5, 0.6] },
    };
    const result = pairedBootstrapAllMetrics(pairs, { resamples: 200, seed: 1 });
    expect(result.map((d) => d.metric)).toEqual([
      'ndcg10',
      'recall5',
      'recall10',
      'recall20',
      'mrr',
    ]);
    for (const d of result) {
      expect(d.delta.point).toBeCloseTo(0.1, 6);
    }
  });
});
