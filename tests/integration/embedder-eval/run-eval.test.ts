import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Embedder } from '../../../src/core/interfaces.js';
import { pairedBootstrapDeltaCI } from './bootstrap.js';
import { runEval } from './run-eval.js';
import type { EvalDoc, EvalQuery } from './types.js';

/**
 * runEval pipeline tests use a deterministic stub embedder that hashes
 * each query/document into a 768-d vector keyed off character codes.
 * Same shape as the searcher integration tests' stubs — keeps the
 * test fast and CI-stable without pulling real model weights.
 */

const writeJsonl = <T>(path: string, records: readonly T[]): void => {
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
};

interface Fixtures {
  readonly dir: string;
  readonly queriesPath: string;
  readonly corpusPath: string;
}

const setupFixtures = (queries: readonly EvalQuery[], corpus: readonly EvalDoc[]): Fixtures => {
  const dir = mkdtempSync(join(tmpdir(), 'pristine-eval-'));
  const queriesPath = join(dir, 'queries.jsonl');
  const corpusPath = join(dir, 'corpus.jsonl');
  writeJsonl(queriesPath, queries);
  writeJsonl(corpusPath, corpus);
  return { dir, queriesPath, corpusPath };
};

/**
 * Deterministic stub embedder: maps text → 768-d vector by encoding
 * each character's code into the corresponding dim. Same prefix gives
 * similar vectors, so a query that overlaps a doc on the first ~N
 * characters will surface that doc as a top hit.
 */
const stubEmbedder = (): Embedder => ({
  dim: 768,
  embed: async (text: string): Promise<number[]> => {
    const out = new Array<number>(768).fill(0.01);
    for (let i = 0; i < Math.min(text.length, 768); i++) {
      out[i] = text.charCodeAt(i) / 1000;
    }
    return out;
  },
  embedBatch: async (texts: readonly string[]): Promise<number[][]> =>
    Promise.all(
      texts.map(async (t) => {
        const out = new Array<number>(768).fill(0.01);
        for (let i = 0; i < Math.min(t.length, 768); i++) {
          out[i] = t.charCodeAt(i) / 1000;
        }
        return out;
      }),
    ),
});

const TINY_CORPUS: readonly EvalDoc[] = [
  {
    id: 'doc-ml',
    content: 'machine learning models train on labelled datasets to predict outputs',
    role: 'user',
    conversationId: 'conv-ml',
    projectId: 'eval',
  },
  {
    id: 'doc-cooking',
    content: 'pasta cooking instructions: boil water, add salt, drop in pasta for ten minutes',
    role: 'user',
    conversationId: 'conv-cooking',
    projectId: 'eval',
  },
  {
    id: 'doc-finance',
    content: 'compound interest calculations apply rates over multiple periods exponentially',
    role: 'user',
    conversationId: 'conv-finance',
    projectId: 'eval',
  },
];

const TINY_QUERIES: readonly EvalQuery[] = [
  {
    id: 'q-ml',
    query: 'machine learning models for prediction',
    relevantDocIds: ['conv-ml'],
    grade: 'typical',
  },
  {
    id: 'q-cooking',
    query: 'pasta cooking time',
    relevantDocIds: ['conv-cooking'],
    grade: 'typical',
  },
];

describe('runEval — pipeline integration with stub embedder', () => {
  let fx: Fixtures;

  beforeEach(() => {
    fx = setupFixtures(TINY_QUERIES, TINY_CORPUS);
  });

  afterEach(() => {
    rmSync(fx.dir, { recursive: true, force: true });
  });

  it('runs end-to-end (dense-only) and returns metrics with bootstrap CIs', async () => {
    const result = await runEval(
      { engine: 'local', dim: 768 },
      {
        config: 'dense-only',
        candidateName: 'stub',
        queriesPath: fx.queriesPath,
        corpusPath: fx.corpusPath,
        bootstrapResamples: 200,
        seed: 42,
        embedderOverride: stubEmbedder(),
      },
    );

    expect(result.candidateName).toBe('stub');
    expect(result.dimUsed).toBe(768);
    expect(result.config).toBe('dense-only');
    expect(result.perQuery).toHaveLength(2);
    for (const m of result.perQuery) {
      expect(m.ndcg10).toBeGreaterThanOrEqual(0);
      expect(m.ndcg10).toBeLessThanOrEqual(1);
    }
    expect(result.ndcg10.lower).toBeLessThanOrEqual(result.ndcg10.point);
    expect(result.ndcg10.point).toBeLessThanOrEqual(result.ndcg10.upper);
    expect(result.p50LatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('exercises the hybrid branch (RRF over vector + FTS + session)', async () => {
    const result = await runEval(
      { engine: 'local', dim: 768 },
      {
        config: 'hybrid',
        candidateName: 'stub',
        queriesPath: fx.queriesPath,
        corpusPath: fx.corpusPath,
        bootstrapResamples: 200,
        seed: 42,
        embedderOverride: stubEmbedder(),
      },
    );

    expect(result.config).toBe('hybrid');
    expect(result.perQuery).toHaveLength(2);
    // Hybrid retrieval combines vector + FTS5; the lexical overlap between
    // "pasta cooking time" and the cooking doc guarantees at least one
    // recall@10 hit across the two queries.
    const totalRecall10 = result.perQuery.reduce((sum, m) => sum + m.recall10, 0);
    expect(totalRecall10).toBeGreaterThan(0);
  });

  it('honors queryIdAllowlist (filters perQuery to the allowed set)', async () => {
    const result = await runEval(
      { engine: 'local', dim: 768 },
      {
        config: 'dense-only',
        queriesPath: fx.queriesPath,
        corpusPath: fx.corpusPath,
        queryIdAllowlist: new Set(['q-ml']),
        bootstrapResamples: 100,
        seed: 1,
        embedderOverride: stubEmbedder(),
      },
    );

    expect(result.perQuery).toHaveLength(1);
    expect(result.perQuery[0]!.queryId).toBe('q-ml');
  });

  it('self-vs-self regression: same stub embedder both runs → paired-delta CI brackets 0', async () => {
    const baseResult = await runEval(
      { engine: 'local', dim: 768 },
      {
        config: 'dense-only',
        candidateName: 'stub-A',
        queriesPath: fx.queriesPath,
        corpusPath: fx.corpusPath,
        bootstrapResamples: 200,
        seed: 7,
        embedderOverride: stubEmbedder(),
      },
    );
    const candResult = await runEval(
      { engine: 'local', dim: 768 },
      {
        config: 'dense-only',
        candidateName: 'stub-B',
        queriesPath: fx.queriesPath,
        corpusPath: fx.corpusPath,
        bootstrapResamples: 200,
        seed: 7,
        embedderOverride: stubEmbedder(),
      },
    );

    // Same deterministic embedder + same corpus + same queries → per-query
    // metrics must be bit-identical, and the paired-delta CI collapses
    // to {0, 0, 0}. This is the "harness has no asymmetric bug" gate.
    const delta = pairedBootstrapDeltaCI(
      baseResult.perQuery.map((m) => m.ndcg10),
      candResult.perQuery.map((m) => m.ndcg10),
      { resamples: 200, seed: 7 },
    );
    expect(delta.point).toBeCloseTo(0, 6);
    expect(delta.lower).toBeLessThanOrEqual(0);
    expect(delta.upper).toBeGreaterThanOrEqual(0);
  });
});
