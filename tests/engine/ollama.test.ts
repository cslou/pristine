import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AppError } from '../../src/core/errors.js';
import { OllamaClient } from '../../src/engine/ollama/index.js';

const TEST_CONFIG = {
  model: 'qwen2.5:7b',
  host: 'http://localhost:11434',
};

const TEST_SCHEMA = {
  type: 'object' as const,
  properties: {
    facts: { type: 'array' as const, items: { type: 'string' as const } },
  },
  required: ['facts'] as const,
};

const TEST_PARAMS = {
  systemPrompt: 'Extract facts.',
  userPrompt: 'I like coffee.',
  schema: TEST_SCHEMA,
};

function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as Response;
}

describe('OllamaClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns parsed JSON from Ollama response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse({
        message: { role: 'assistant', content: '{"facts":["User likes coffee"]}' },
      }),
    );

    const client = new OllamaClient(TEST_CONFIG);
    const result = await client.generate<{ facts: string[] }>(TEST_PARAMS);

    expect(result).toEqual({ facts: ['User likes coffee'] });
  });

  it('sends correct request shape to /api/chat', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse({
        message: { role: 'assistant', content: '{"facts":[]}' },
      }),
    );

    const client = new OllamaClient(TEST_CONFIG);
    await client.generate(TEST_PARAMS);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const callBody = JSON.parse(
      (vi.mocked(globalThis.fetch).mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(callBody.model).toBe('qwen2.5:7b');
    expect(callBody.messages).toEqual([
      { role: 'system', content: 'Extract facts.' },
      { role: 'user', content: 'I like coffee.' },
    ]);
    expect(callBody.format).toEqual(TEST_SCHEMA);
    expect(callBody.stream).toBe(false);
  });

  it('uses maxTokens from params', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse({
        message: { role: 'assistant', content: '{"facts":[]}' },
      }),
    );

    const client = new OllamaClient(TEST_CONFIG);
    await client.generate({ ...TEST_PARAMS, maxTokens: 2048 });

    const callBody = JSON.parse(
      (vi.mocked(globalThis.fetch).mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(callBody.options.num_predict).toBe(2048);
  });

  it('falls back to config maxTokens', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse({
        message: { role: 'assistant', content: '{"facts":[]}' },
      }),
    );

    const client = new OllamaClient({ ...TEST_CONFIG, maxTokens: 1024 });
    await client.generate(TEST_PARAMS);

    const callBody = JSON.parse(
      (vi.mocked(globalThis.fetch).mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(callBody.options.num_predict).toBe(1024);
  });

  it('defaults maxTokens to 4096', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse({
        message: { role: 'assistant', content: '{"facts":[]}' },
      }),
    );

    const client = new OllamaClient(TEST_CONFIG);
    await client.generate(TEST_PARAMS);

    const callBody = JSON.parse(
      (vi.mocked(globalThis.fetch).mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(callBody.options.num_predict).toBe(4096);
  });

  it('uses OLLAMA_HOST env var when no host in config', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse({
        message: { role: 'assistant', content: '{"facts":[]}' },
      }),
    );

    const origEnv = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = 'http://custom:9999';
    try {
      const client = new OllamaClient({ model: 'qwen2.5:7b' });
      await client.generate(TEST_PARAMS);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://custom:9999/api/chat',
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

  it('throws AppError on invalid JSON response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockFetchResponse({
        message: { role: 'assistant', content: 'not valid json{' },
      }),
    );

    const client = new OllamaClient(TEST_CONFIG);
    await expect(client.generate(TEST_PARAMS)).rejects.toThrow(AppError);
    await expect(client.generate(TEST_PARAMS)).rejects.toThrow(/response parsing failed/);
  });

  it('throws AppError on HTTP error', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({}, 400));

    const client = new OllamaClient(TEST_CONFIG);
    await expect(client.generate(TEST_PARAMS)).rejects.toThrow(AppError);
    await expect(client.generate(TEST_PARAMS)).rejects.toThrow(/Ollama API error: 400/);
  });

  it('retries on 429 and succeeds', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockFetchResponse({}, 429))
      .mockResolvedValueOnce(
        mockFetchResponse({
          message: { role: 'assistant', content: '{"facts":["retried"]}' },
        }),
      );

    const client = new OllamaClient(TEST_CONFIG);
    const result = await client.generate<{ facts: string[] }>(TEST_PARAMS);

    expect(result).toEqual({ facts: ['retried'] });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 500 and succeeds', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(mockFetchResponse({}, 500))
      .mockResolvedValueOnce(
        mockFetchResponse({
          message: { role: 'assistant', content: '{"facts":[]}' },
        }),
      );

    const client = new OllamaClient(TEST_CONFIG);
    const result = await client.generate<{ facts: string[] }>(TEST_PARAMS);

    expect(result).toEqual({ facts: [] });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('throws AppError when fetch fails (network error)', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('fetch failed'));

    const client = new OllamaClient(TEST_CONFIG);
    await expect(client.generate(TEST_PARAMS)).rejects.toThrow(AppError);
  });

  it('network error includes ollama serve and models.json guidance', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('fetch failed'));

    const client = new OllamaClient(TEST_CONFIG);
    try {
      await client.generate(TEST_PARAMS);
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      const msg = (error as Error).message;
      expect(msg).toContain('ollama serve');
      expect(msg).toContain('models.json');
    }
  });

  it('isReachable returns true when Ollama responds', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({ models: [] }));

    const client = new OllamaClient(TEST_CONFIG);
    const reachable = await client.isReachable();

    expect(reachable).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('isReachable returns false when Ollama is unreachable', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('fetch failed'));

    const client = new OllamaClient(TEST_CONFIG);
    const reachable = await client.isReachable();

    expect(reachable).toBe(false);
  });

  it('throws AppError after exhausting all retries on 429', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({}, 429));

    const client = new OllamaClient(TEST_CONFIG);

    await expect(client.generate(TEST_PARAMS)).rejects.toThrow(/Ollama API error: 429/);
    // 1 initial + 3 retries = 4 calls
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  }, 15000);

  it('throws a clear AppError when a request times out', async () => {
    // Simulate a fetch that honors AbortSignal.timeout: reject with a
    // DOMException-shaped TimeoutError when the signal aborts.
    vi.mocked(globalThis.fetch).mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit).signal as AbortSignal | undefined;
        if (!signal) {
          reject(new Error('test harness: expected signal'));
          return;
        }
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted due to timeout');
          err.name = 'TimeoutError';
          reject(err);
        });
      });
    });

    const client = new OllamaClient({ ...TEST_CONFIG, timeoutMs: 50 });

    await expect(client.generate(TEST_PARAMS)).rejects.toThrow(
      /Ollama request timed out after 50ms for model qwen2\.5:7b/,
    );
    await expect(client.generate(TEST_PARAMS)).rejects.toBeInstanceOf(AppError);
  }, 5000);

  it('does NOT retry on timeout (timeout cancels the attempt, no more attempts made)', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit).signal as AbortSignal | undefined;
        if (!signal) {
          reject(new Error('test harness: expected signal'));
          return;
        }
        signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'TimeoutError';
          reject(err);
        });
      });
    });

    const client = new OllamaClient({ ...TEST_CONFIG, timeoutMs: 30 });

    await expect(client.generate(TEST_PARAMS)).rejects.toThrow(/timed out/);
    // One call only — the prompt is slow, not the network, so retrying
    // would just multiply the wait time. 1 call = no retries.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }, 5000);
});
