import { describe, expect, it } from 'vitest';
import type { Embedder } from '../../src/index.js';
import { InvalidArgumentError } from '../../src/core/errors.js';
import {
  createTruncatingEmbedder,
  truncateAndRenorm,
} from '../integration/embedder-eval/wrappers/truncating-wrapper.js';

describe('truncateAndRenorm', () => {
  it('produces a unit-norm vector of the target length', () => {
    const v = [3, 4, 0, 0, 0]; // length-5; first-2 prefix is [3, 4] with norm 5
    const out = truncateAndRenorm(v, 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeCloseTo(0.6, 6);
    expect(out[1]).toBeCloseTo(0.8, 6);
    const norm = Math.sqrt(out[0]! * out[0]! + out[1]! * out[1]!);
    expect(norm).toBeCloseTo(1.0, 6);
  });

  it('handles a vector that is already unit-norm at the prefix', () => {
    const v = [1, 0, 0.5, 0.5];
    const out = truncateAndRenorm(v, 2);
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(0);
  });

  it('returns the all-zeros prefix unchanged when the prefix has zero norm', () => {
    const out = truncateAndRenorm([0, 0, 1, 1], 2);
    expect(out).toEqual([0, 0]);
  });

  it('does not mutate the input', () => {
    const v = [3, 4, 5, 6];
    truncateAndRenorm(v, 2);
    expect(v).toEqual([3, 4, 5, 6]);
  });
});

const stubEmbedder = (dim: number, fill: (i: number) => number = (i) => i): Embedder => ({
  dim,
  embed: async (): Promise<number[]> => Array.from({ length: dim }, (_, i) => fill(i)),
  embedBatch: async (texts: readonly string[]): Promise<number[][]> =>
    texts.map(() => Array.from({ length: dim }, (_, i) => fill(i))),
});

describe('createTruncatingEmbedder', () => {
  it('exposes the configured target dim', () => {
    const wrapped = createTruncatingEmbedder(stubEmbedder(1024), 768);
    expect(wrapped.dim).toBe(768);
  });

  it('embed() returns a 768-d unit-norm vector when wrapping a 1024-d underlying embedder', async () => {
    const underlying = stubEmbedder(1024, (i) => (i < 768 ? 1 : 0)); // first-768 are all 1s; rest are 0
    const wrapped = createTruncatingEmbedder(underlying, 768);
    const v = await wrapped.embed('hello');
    expect(v).toHaveLength(768);
    let norm = 0;
    for (const x of v) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 6);
  });

  it('embedBatch() applies truncation to each vector independently', async () => {
    const wrapped = createTruncatingEmbedder(stubEmbedder(1024), 768);
    const out = await wrapped.embedBatch(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
    for (const v of out) {
      expect(v).toHaveLength(768);
    }
  });

  it('throws InvalidArgumentError when targetDim >= underlying.dim', () => {
    const u = stubEmbedder(768);
    expect(() => createTruncatingEmbedder(u, 768)).toThrow(InvalidArgumentError);
    expect(() => createTruncatingEmbedder(u, 1024)).toThrow(InvalidArgumentError);
  });
});
