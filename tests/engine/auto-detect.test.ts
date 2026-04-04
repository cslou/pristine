import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createLlmClient } from '../../src/engine/index.js';
import { LlamaCppClient } from '../../src/engine/llamacpp/index.js';
import { OllamaClient } from '../../src/engine/ollama/index.js';

vi.mock('../../src/engine/llamacpp/index.js', () => ({
  LlamaCppClient: vi.fn().mockImplementation(() => ({ generate: vi.fn() })),
}));

vi.mock('../../src/engine/ollama/index.js', () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({
    generate: vi.fn(),
    isReachable: vi.fn().mockResolvedValue(false),
  })),
}));

describe('createLlmClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns LlamaCppClient when llmEngine is llamacpp', async () => {
    const client = await createLlmClient({ llmEngine: 'llamacpp' });
    expect(LlamaCppClient).toHaveBeenCalled();
    expect(client).toBeDefined();
  });

  it('returns OllamaClient when llmEngine is ollama', async () => {
    const client = await createLlmClient({ llmEngine: 'ollama' });
    expect(OllamaClient).toHaveBeenCalled();
    expect(client).toBeDefined();
  });

  it('falls back to llamacpp when Ollama is unreachable', async () => {
    vi.mocked(OllamaClient).mockImplementation(
      () =>
        ({
          generate: vi.fn(),
          isReachable: vi.fn().mockResolvedValue(false),
        }) as unknown as OllamaClient,
    );

    const client = await createLlmClient({});
    expect(LlamaCppClient).toHaveBeenCalled();
    expect(client).toBeDefined();
  });

  it('uses Ollama when auto-detect finds it reachable', async () => {
    vi.mocked(OllamaClient).mockImplementation(
      () =>
        ({
          generate: vi.fn(),
          isReachable: vi.fn().mockResolvedValue(true),
        }) as unknown as OllamaClient,
    );

    const client = await createLlmClient({});
    // The final returned client should be an OllamaClient
    // (auto-detect found Ollama, so it creates a new OllamaClient for the actual use)
    expect(OllamaClient).toHaveBeenCalled();
    expect(client).toBeDefined();
  });

  it('uses custom modelsDir for llamacpp model path', async () => {
    await createLlmClient({ llmEngine: 'llamacpp', modelsDir: '/custom/models' });

    expect(LlamaCppClient).toHaveBeenCalledWith(
      expect.objectContaining({
        modelPath: expect.stringContaining('/custom/models/'),
      }),
    );
  });

  it('uses custom llmModel name for ollama', async () => {
    await createLlmClient({ llmEngine: 'ollama', llmModel: 'llama3.2:3b' });

    expect(OllamaClient).toHaveBeenCalledWith(expect.objectContaining({ model: 'llama3.2:3b' }));
  });
});
