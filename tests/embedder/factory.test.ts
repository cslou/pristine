import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ConfigError } from '../../src/core/errors.js';

const mockPipeline = vi.fn();

vi.mock('@huggingface/transformers', () => ({
  pipeline: (...args: unknown[]) => mockPipeline(...args),
}));

import { createEmbedder } from '../../src/embedder/index.js';
import { OllamaEmbedder } from '../../src/embedder/ollama/index.js';
import { LocalEmbedder } from '../../src/embedder/local/index.js';

function mockFetchResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as Response;
}

function createMockExtractor(dimension = 768): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    data: new Float32Array(dimension).fill(0.1),
  });
}

describe('createEmbedder', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns OllamaEmbedder for engine "ollama"', () => {
    const embedder = createEmbedder({ engine: 'ollama' });
    expect(embedder).toBeInstanceOf(OllamaEmbedder);
  });

  it('returns LocalEmbedder for engine "local"', () => {
    const embedder = createEmbedder({ engine: 'local' });
    expect(embedder).toBeInstanceOf(LocalEmbedder);
  });

  it('passes local model config to the backend pipeline', async () => {
    const extractor = createMockExtractor();
    mockPipeline.mockResolvedValue(extractor);

    const embedder = createEmbedder({ engine: 'local', model: 'custom/local-model' });
    await embedder.embed('factory local passthrough');

    expect(mockPipeline).toHaveBeenCalledWith('feature-extraction', 'custom/local-model');
  });

  it('passes Ollama model and host config to the backend request', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse({ embeddings: [Array.from({ length: 768 }, () => 0.1)] }),
    );

    const embedder = createEmbedder({
      engine: 'ollama',
      model: 'custom-ollama-model',
      host: 'http://ollama.test:1234',
    });
    await embedder.embed('factory ollama passthrough');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://ollama.test:1234/api/embed',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const callBody = JSON.parse(
      (vi.mocked(globalThis.fetch).mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(callBody).toEqual({
      model: 'custom-ollama-model',
      input: ['factory ollama passthrough'],
    });
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
