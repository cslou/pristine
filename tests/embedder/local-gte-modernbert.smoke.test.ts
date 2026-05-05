import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalEmbedder } from '../../src/embedder/local/index.js';

/**
 * Smoke-test for `Alibaba-NLP/gte-modernbert-base` via the existing
 * `LocalEmbedder` engine. Proves the model loads on the pinned
 * `@huggingface/transformers` version + produces a 768-d unit-norm
 * vector for a trivial input.
 *
 * The test downloads the model (~600 MB) on first run; subsequent
 * runs hit the local HF cache. Skip in CI by setting
 * `SKIP_SLOW_TESTS=1`. No production-code change here — the test
 * validates the existing `LocalEmbedder` works with the candidate
 * out-of-the-box; if it doesn't, the failure is FLAGGED for a
 * follow-up sprint, not fixed in this one.
 */
const skipSlow = process.env.SKIP_SLOW_TESTS === '1';

describe.skipIf(skipSlow)('LocalEmbedder smoke — gte-modernbert-base', () => {
  let embedder: LocalEmbedder;

  beforeAll(() => {
    embedder = new LocalEmbedder({ model: 'Alibaba-NLP/gte-modernbert-base', dim: 768 });
  });

  afterAll(async () => {
    await embedder.dispose();
  });

  it('loads the model and produces a 768-d unit-norm vector', async () => {
    const vector = await embedder.embed('hello world');

    expect(vector).toHaveLength(768);
    expect(vector.every((v) => typeof v === 'number' && Number.isFinite(v))).toBe(true);
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    // gte-modernbert-base is documented to produce normalised output;
    // tolerate ±0.05 to absorb floating-point + library-edge variation.
    expect(magnitude).toBeCloseTo(1.0, 1);
  }, 300_000);
});
