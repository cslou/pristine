import type { Embedder } from '../core/interfaces.js';
import { ConfigError } from '../core/errors.js';
import { assertValidDim, DEFAULT_EMBEDDING_DIM } from './dim.js';
import { OllamaEmbedder } from './ollama/index.js';
import { LocalEmbedder } from './local/index.js';

export { assertValidDim, DEFAULT_EMBEDDING_DIM } from './dim.js';

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
