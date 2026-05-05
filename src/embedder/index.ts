import type { Embedder } from '../core/interfaces.js';
import { ConfigError } from '../core/errors.js';
import { assertValidDim, DEFAULT_EMBEDDING_DIM } from '../core/vector-dim.js';
import { OllamaEmbedder } from './ollama/index.js';
import { LocalEmbedder } from './local/index.js';
import type { EmbedderConfig } from '../core/embedder-config.js';

export { assertValidDim, DEFAULT_EMBEDDING_DIM } from '../core/vector-dim.js';
export type {
  EmbedderConfig,
  LocalEmbedderEntry,
  OllamaEmbedderEntry,
} from '../core/embedder-config.js';

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
