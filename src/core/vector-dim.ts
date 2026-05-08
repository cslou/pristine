import { InvalidArgumentError } from '../core/errors.js';

export const DEFAULT_EMBEDDING_DIM = 768;

const MIN_DIM = 64;
const MAX_DIM = 4096;

/**
 * Validate a candidate embedding dimension. Single source of truth used by
 * the embedder factory, the engine constructors (`LocalEmbedder`,
 * `OllamaEmbedder`), the `models.json` validator (`validateEmbedderEntry`),
 * and source-index DDL-build sites. Bounds (64..4096) reject
 * sub-byte-aligned absurdities while covering current production embedders
 * (text-embedding-3-large is 3072 native). The integer check also serves
 * as the SQL-injection guard for the templated `float[${dim}]` DDL — only
 * validated integers reach the string interpolation.
 *
 * Lives in a leaf module (no engine dependencies) so engine implementations
 * can import it without creating a cycle through the barrel.
 */
export function assertValidDim(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_DIM || value > MAX_DIM) {
    throw new InvalidArgumentError(
      `Embedding dim must be an integer in [${MIN_DIM}, ${MAX_DIM}]. Received: ${String(value)}`,
    );
  }
}
