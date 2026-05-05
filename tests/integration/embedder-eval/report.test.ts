import { describe, expect, it } from 'vitest';
import { renderEvalReport } from './report.js';
import type { BootstrapCI, EvalResult, PairedDelta } from './types.js';

const ci = (point: number, lower: number, upper: number): BootstrapCI => ({ point, lower, upper });

const makeResult = (
  candidateName: string,
  dim: number,
  config: 'dense-only' | 'hybrid',
  point: number,
): EvalResult => ({
  config,
  candidateName,
  dimUsed: dim,
  perQuery: [],
  ndcg10: ci(point, point - 0.05, point + 0.05),
  recall5: ci(point, point - 0.05, point + 0.05),
  recall10: ci(point, point - 0.05, point + 0.05),
  recall20: ci(point, point - 0.05, point + 0.05),
  mrr: ci(point, point - 0.05, point + 0.05),
  p50LatencyMs: 12.3,
  p95LatencyMs: 45.6,
});

const makeDeltas = (delta: BootstrapCI): readonly PairedDelta[] => [
  { metric: 'ndcg10', delta },
  { metric: 'recall5', delta },
  { metric: 'recall10', delta },
  { metric: 'recall20', delta },
  { metric: 'mrr', delta },
];

describe('renderEvalReport', () => {
  it('emits a markdown heading + per-config tables + summary', () => {
    const md = renderEvalReport({
      candidate: {
        denseOnly: makeResult('cand', 768, 'dense-only', 0.55),
        hybrid: makeResult('cand', 768, 'hybrid', 0.6),
      },
      baseline: {
        denseOnly: makeResult('base', 768, 'dense-only', 0.5),
        hybrid: makeResult('base', 768, 'hybrid', 0.55),
      },
      deltas: {
        denseOnly: makeDeltas(ci(0.05, 0.02, 0.08)),
        hybrid: makeDeltas(ci(0.05, 0.02, 0.08)),
      },
      meta: {
        timestamp: '2026-05-05T00:00:00.000Z',
        bootstrapResamples: 1000,
        seed: 42,
        numQueries: 50,
      },
    });

    expect(md).toContain('# Embedder eval — cand vs base');
    expect(md).toContain('### dense-only retrieval');
    expect(md).toContain('### hybrid retrieval');
    expect(md).toContain('## Summary');
    expect(md).toContain('Bootstrap resamples:** 1000');
    expect(md).toContain('Queries:** 50');
  });

  it('marks rows with * when paired-bootstrap CI excludes zero', () => {
    const md = renderEvalReport({
      candidate: {
        denseOnly: makeResult('cand', 768, 'dense-only', 0.55),
        hybrid: makeResult('cand', 768, 'hybrid', 0.55),
      },
      baseline: {
        denseOnly: makeResult('base', 768, 'dense-only', 0.5),
        hybrid: makeResult('base', 768, 'hybrid', 0.5),
      },
      deltas: {
        denseOnly: makeDeltas(ci(0.05, 0.02, 0.08)), // CI excludes 0
        hybrid: makeDeltas(ci(0.05, 0.02, 0.08)),
      },
      meta: { timestamp: 't', bootstrapResamples: 1000, seed: 1, numQueries: 50 },
    });

    expect(md).toContain('**\\***');
    expect(md).toContain('beats base on NDCG@10 in both retrieval modes');
  });

  it('does not mark rows with * when CI brackets zero (inconclusive)', () => {
    const md = renderEvalReport({
      candidate: {
        denseOnly: makeResult('cand', 768, 'dense-only', 0.51),
        hybrid: makeResult('cand', 768, 'hybrid', 0.51),
      },
      baseline: {
        denseOnly: makeResult('base', 768, 'dense-only', 0.5),
        hybrid: makeResult('base', 768, 'hybrid', 0.5),
      },
      deltas: {
        denseOnly: makeDeltas(ci(0.01, -0.03, 0.05)), // CI brackets 0
        hybrid: makeDeltas(ci(0.01, -0.03, 0.05)),
      },
      meta: { timestamp: 't', bootstrapResamples: 1000, seed: 1, numQueries: 50 },
    });

    expect(md).not.toContain('**\\***');
    expect(md).toContain('Inconclusive');
  });

  it('emits negative-verdict copy when CI excludes zero with negative sign', () => {
    const md = renderEvalReport({
      candidate: {
        denseOnly: makeResult('cand', 768, 'dense-only', 0.45),
        hybrid: makeResult('cand', 768, 'hybrid', 0.45),
      },
      baseline: {
        denseOnly: makeResult('base', 768, 'dense-only', 0.5),
        hybrid: makeResult('base', 768, 'hybrid', 0.5),
      },
      deltas: {
        denseOnly: makeDeltas(ci(-0.05, -0.08, -0.02)), // CI excludes 0, negative
        hybrid: makeDeltas(ci(-0.05, -0.08, -0.02)),
      },
      meta: { timestamp: 't', bootstrapResamples: 1000, seed: 1, numQueries: 50 },
    });

    expect(md).toContain('underperforms base on NDCG@10');
    expect(md).toContain('keep base as the default');
  });

  it('throws if a deltas array is missing a required metric', () => {
    expect(() =>
      renderEvalReport({
        candidate: {
          denseOnly: makeResult('cand', 768, 'dense-only', 0.5),
          hybrid: makeResult('cand', 768, 'hybrid', 0.5),
        },
        baseline: {
          denseOnly: makeResult('base', 768, 'dense-only', 0.5),
          hybrid: makeResult('base', 768, 'hybrid', 0.5),
        },
        deltas: {
          denseOnly: [{ metric: 'recall5', delta: ci(0, -0.05, 0.05) }],
          hybrid: makeDeltas(ci(0, -0.05, 0.05)),
        },
        meta: { timestamp: 't', bootstrapResamples: 1000, seed: 1, numQueries: 50 },
      }),
    ).toThrow(/missing the 'ndcg10' metric/);
  });
});
