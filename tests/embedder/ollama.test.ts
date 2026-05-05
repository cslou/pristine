import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbedderError } from '../../src/core/errors.js';
import { OllamaEmbedder } from '../../src/embedder/ollama/index.js';

const TEST_CONFIG = {
  model: 'nomic-embed-text',
  host: 'http://localhost:11434',
};

function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as Response;
}

function makeEmbeddings(count: number, dim = 768): number[][] {
  return Array.from({ length: count }, (_, i) =>
    Array.from({ length: dim }, (__, j) => i + j * 0.1),
  );
}

describe('OllamaEmbedder', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('embed()', () => {
    it('returns number[] from Ollama response', async () => {
      const embeddings = makeEmbeddings(1, 768);
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({ embeddings }));

      const embedder = new OllamaEmbedder(TEST_CONFIG);
      const result = await embedder.embed('hello');

      expect(result).toEqual(embeddings[0]);
    });

    it('throws EmbedderError when response has empty embeddings', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({ embeddings: [] }));

      const embedder = new OllamaEmbedder(TEST_CONFIG);

      await expect(embedder.embed('hello')).rejects.toThrow(EmbedderError);
      await expect(embedder.embed('hello')).rejects.toThrow(/returned no results/);
    });
  });

  describe('embedBatch()', () => {
    it('returns number[][] for multiple texts', async () => {
      const embeddings = makeEmbeddings(3);
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({ embeddings }));

      const embedder = new OllamaEmbedder(TEST_CONFIG);
      const result = await embedder.embedBatch(['a', 'b', 'c']);

      expect(result).toEqual(embeddings);
      expect(result).toHaveLength(3);
    });

    it('returns empty array for empty input without calling fetch', async () => {
      const embedder = new OllamaEmbedder(TEST_CONFIG);
      const result = await embedder.embedBatch([]);

      expect(result).toEqual([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe('request shape', () => {
    it('sends POST to /api/embed with correct body', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ embeddings: makeEmbeddings(1) }),
      );

      const embedder = new OllamaEmbedder(TEST_CONFIG);
      await embedder.embed('test text');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/embed',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const callBody = JSON.parse(
        (vi.mocked(globalThis.fetch).mock.calls[0]![1] as RequestInit).body as string,
      );
      expect(callBody.model).toBe('nomic-embed-text');
      expect(callBody.input).toEqual(['test text']);
    });

    it('uses default model and host when no config provided', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ embeddings: makeEmbeddings(1) }),
      );

      const embedder = new OllamaEmbedder();
      await embedder.embed('hello');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/embed',
        expect.anything(),
      );

      const callBody = JSON.parse(
        (vi.mocked(globalThis.fetch).mock.calls[0]![1] as RequestInit).body as string,
      );
      expect(callBody.model).toBe('nomic-embed-text');
    });

    it('uses OLLAMA_HOST env var when no config host', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ embeddings: makeEmbeddings(1) }),
      );

      const origEnv = process.env.OLLAMA_HOST;
      process.env.OLLAMA_HOST = 'http://custom:9999';
      try {
        const embedder = new OllamaEmbedder({ model: 'nomic-embed-text' });
        await embedder.embed('hello');

        expect(globalThis.fetch).toHaveBeenCalledWith(
          'http://custom:9999/api/embed',
          expect.anything(),
        );
      } finally {
        if (origEnv === undefined) {
          delete process.env.OLLAMA_HOST;
        } else {
          process.env.OLLAMA_HOST = origEnv;
        }
      }
    });

    it('config host takes priority over OLLAMA_HOST env var', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ embeddings: makeEmbeddings(1) }),
      );

      const origEnv = process.env.OLLAMA_HOST;
      process.env.OLLAMA_HOST = 'http://env-host:9999';
      try {
        const embedder = new OllamaEmbedder({ host: 'http://config-host:8888' });
        await embedder.embed('hello');

        expect(globalThis.fetch).toHaveBeenCalledWith(
          'http://config-host:8888/api/embed',
          expect.anything(),
        );
      } finally {
        if (origEnv === undefined) {
          delete process.env.OLLAMA_HOST;
        } else {
          process.env.OLLAMA_HOST = origEnv;
        }
      }
    });
  });

  describe('error handling', () => {
    it('throws EmbedderError on HTTP 400', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({}, 400));

      const embedder = new OllamaEmbedder(TEST_CONFIG);

      await expect(embedder.embed('hello')).rejects.toThrow(EmbedderError);
      await expect(embedder.embed('hello')).rejects.toThrow(/Ollama embedding API error: 400/);
    });

    it('retries on 429 then succeeds', async () => {
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(mockFetchResponse({}, 429))
        .mockResolvedValueOnce(mockFetchResponse({ embeddings: makeEmbeddings(1) }));

      const embedder = new OllamaEmbedder(TEST_CONFIG);
      const result = await embedder.embed('hello');

      expect(result).toEqual(makeEmbeddings(1)[0]);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('retries on 500 then succeeds', async () => {
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(mockFetchResponse({}, 500))
        .mockResolvedValueOnce(mockFetchResponse({ embeddings: makeEmbeddings(1) }));

      const embedder = new OllamaEmbedder(TEST_CONFIG);
      const result = await embedder.embed('hello');

      expect(result).toEqual(makeEmbeddings(1)[0]);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws EmbedderError after exhausting retries on 429', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({}, 429));

      const embedder = new OllamaEmbedder(TEST_CONFIG);

      await expect(embedder.embed('hello')).rejects.toThrow(/Ollama embedding API error: 429/);
      // 1 initial + 3 retries = 4 calls
      expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    }, 15000);

    it('throws EmbedderError immediately on network error without retrying', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('fetch failed'));

      const embedder = new OllamaEmbedder(TEST_CONFIG);

      await expect(embedder.embed('hello')).rejects.toThrow(EmbedderError);
      await expect(embedder.embed('hello')).rejects.toThrow(/Is Ollama running/);
      // No retries on network errors -- exactly 1 call per embed attempt
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws EmbedderError on malformed 200 response missing embeddings', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        mockFetchResponse({ error: 'model not loaded' }),
      );

      const embedder = new OllamaEmbedder(TEST_CONFIG);

      await expect(embedder.embed('hello')).rejects.toThrow(EmbedderError);
      await expect(embedder.embed('hello')).rejects.toThrow(/unexpected response shape/);
    });

    it('network error message includes host URL', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('fetch failed'));

      const embedder = new OllamaEmbedder({ host: 'http://my-host:5555' });

      try {
        await embedder.embed('hello');
        expect.unreachable('should have thrown');
      } catch (error: unknown) {
        const msg = (error as Error).message;
        expect(msg).toContain('Is Ollama running');
        expect(msg).toContain('http://my-host:5555');
      }
    });
  });
});
