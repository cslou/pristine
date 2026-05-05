import type { Embedder } from '../core/interfaces.js';
import { ConfigError, InvalidArgumentError } from '../core/errors.js';
import { OllamaEmbedder } from './ollama/index.js';
import { LocalEmbedder } from './local/index.js';

export const DEFAULT_EMBEDDING_DIM = 768;

const MIN_DIM = 64;
const MAX_DIM = 4096;

/**
 * Validate a candidate embedding dimension. Single source of truth used by
 * `createEmbedder`, `validateEmbedderEntry`, and the DDL-build sites in
 * `ConversationStore`. Bounds (64..4096) reject sub-byte-aligned absurdities
 * while covering current production embedders (text-embedding-3-large is
 * 3072 native). The integer check also serves as the SQL-injection guard
 * for the templated `float[${dim}]` DDL — only validated integers reach
 * the string interpolation.
 */
export function assertValidDim(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_DIM || value > MAX_DIM) {
    throw new InvalidArgumentError(
      `Embedding dim must be an integer in [${MIN_DIM}, ${MAX_DIM}]. Received: ${String(value)}`,
    );
  }
}

export interface OllamaEmbedderEntry {
  readonly engine: 'ollama';
  readonly model?: string;
  readonly host?: string;
  readonly dim?: number;
}

export interface LocalEmbedderEntry {
  readonly engine: 'local';
  readonly model?: string;
  readonly dim?: number;
}

export type EmbedderConfig = OllamaEmbedderEntry | LocalEmbedderEntry;

export function createEmbedder(config: EmbedderConfig): Embedder {
  const dim = config.dim ?? DEFAULT_EMBEDDING_DIM;
  assertValidDim(dim);

  if (config.engine === 'ollama') {
    return new OllamaEmbedder({
      model: config.model,
      ...(config.host ? { host: config.host } : {}),
      dim,
    });
  }
  if (config.engine === 'local') {
    return new LocalEmbedder({ model: config.model, dim });
  }
  throw new ConfigError(
    `Unsupported embedder engine: "${(config as { engine: string }).engine}". ` +
      `Supported engines: ollama, local`,
  );
}

export { OllamaEmbedder } from './ollama/index.js';
export type { OllamaEmbedderConfig } from './ollama/index.js';
export { LocalEmbedder } from './local/index.js';
export type { LocalEmbedderConfig } from './local/index.js';
