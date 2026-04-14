import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/core/errors.js';
import { createEmbedder } from '../../src/embedder/index.js';
import { OllamaEmbedder } from '../../src/embedder/ollama/index.js';
import { LocalEmbedder } from '../../src/embedder/local/index.js';

describe('createEmbedder', () => {
  it('returns OllamaEmbedder for engine "ollama"', () => {
    const embedder = createEmbedder({ engine: 'ollama' });
    expect(embedder).toBeInstanceOf(OllamaEmbedder);
  });

  it('returns LocalEmbedder for engine "local"', () => {
    const embedder = createEmbedder({ engine: 'local' });
    expect(embedder).toBeInstanceOf(LocalEmbedder);
  });

  it('throws ConfigError for unsupported engine "llamacpp"', () => {
    expect(() =>
      createEmbedder({ engine: 'llamacpp' } as unknown as Parameters<typeof createEmbedder>[0]),
    ).toThrow(ConfigError);
    expect(() =>
      createEmbedder({ engine: 'llamacpp' } as unknown as Parameters<typeof createEmbedder>[0]),
    ).toThrow(/Unsupported embedder engine/);
  });

  it('throws ConfigError for unknown engine string', () => {
    expect(() =>
      createEmbedder({ engine: 'openai' } as unknown as Parameters<typeof createEmbedder>[0]),
    ).toThrow(ConfigError);
  });
});
