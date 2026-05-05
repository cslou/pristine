import type { Embedder } from '../../../../src/index.js';
import { InvalidArgumentError } from '../../../../src/core/errors.js';

/**
 * Slice a vector to the first `targetDim` elements and L2-renormalize.
 * Per the Matryoshka Representation Learning (MRL) recipe: an MRL-trained
 * embedder's prefix vectors are themselves valid unit-norm representations
 * after re-normalization, so callers can pick any prefix length without
 * retraining the underlying model.
 *
 * Returns a fresh array; does not mutate the input.
 */
export const truncateAndRenorm = (vec: readonly number[], targetDim: number): number[] => {
  const sliced = vec.slice(0, targetDim);
  let sumSq = 0;
  for (const v of sliced) sumSq += v * v;
  if (sumSq === 0) return sliced;
  const norm = Math.sqrt(sumSq);
  return sliced.map((v) => v / norm);
};

/**
 * Wrap an `Embedder` to expose a smaller dim via Matryoshka truncation.
 * The underlying embedder produces vectors at its full native dim
 * (e.g. 1024 for Qwen3-Embedding-0.6B); the wrapper exposes `dim:
 * targetDim` and applies the slice + L2 renorm to every embed call's
 * output.
 *
 * Lives in the eval harness — outside `src/` — so the SDK's engine
 * classes stay candidate-agnostic. Doing the truncation here rather
 * than inside `OllamaEmbedder` preserves the modularization invariant:
 * a new candidate that needs a different truncation policy is one
 * wrapper module, not a change to the engine class.
 *
 * Throws if `targetDim >= underlying.dim` (no work to do; almost
 * certainly a misconfiguration).
 */
export const createTruncatingEmbedder = (underlying: Embedder, targetDim: number): Embedder => {
  if (targetDim >= underlying.dim) {
    throw new InvalidArgumentError(
      `createTruncatingEmbedder: targetDim ${targetDim} must be strictly less than underlying.dim ${underlying.dim}`,
    );
  }
  return {
    dim: targetDim,
    embed: async (text: string): Promise<number[]> => {
      const raw = await underlying.embed(text);
      return truncateAndRenorm(raw, targetDim);
    },
    embedBatch: async (texts: readonly string[]): Promise<number[][]> => {
      const rawBatch = await underlying.embedBatch(texts);
      return rawBatch.map((raw) => truncateAndRenorm(raw, targetDim));
    },
  };
};
