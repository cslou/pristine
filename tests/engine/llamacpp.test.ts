import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppError, DownloadError } from '../../src/core/errors.js';

const mockPrompt = vi.fn();
const mockDispose = vi.fn();
const mockGetSequence = vi.fn().mockReturnValue({});
const mockCreateGrammarForJsonSchema = vi.fn();
const mockLoadModel = vi.fn();
const mockCreateContext = vi.fn();
const mockGetLlama = vi.fn();
const mockLlamaDispose = vi.fn();
const mockModelDispose = vi.fn();
const mockContextDispose = vi.fn();
const mockParse = vi.fn();

vi.mock('node-llama-cpp', () => ({
  getLlama: (...args: unknown[]) => mockGetLlama(...args),
  LlamaChatSession: vi.fn().mockImplementation(() => ({
    prompt: mockPrompt,
    dispose: mockDispose,
  })),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

import { existsSync } from 'node:fs';
import { LlamaCppClient } from '../../src/engine/llamacpp/index.js';
import { LlamaChatSession } from 'node-llama-cpp';

const TEST_SCHEMA = {
  type: 'object' as const,
  properties: {
    facts: {
      type: 'array' as const,
      items: { type: 'string' as const },
    },
  },
  required: ['facts'] as const,
};

const TEST_CONFIG = {
  modelPath: '/tmp/test-model.gguf',
};

function setupMocks(): void {
  mockGetLlama.mockResolvedValue({
    createGrammarForJsonSchema: mockCreateGrammarForJsonSchema,
    loadModel: mockLoadModel,
    dispose: mockLlamaDispose,
  });
  mockLoadModel.mockResolvedValue({
    createContext: mockCreateContext,
    dispose: mockModelDispose,
  });
  mockCreateContext.mockResolvedValue({
    getSequence: mockGetSequence,
    dispose: mockContextDispose,
  });
  mockCreateGrammarForJsonSchema.mockResolvedValue({
    parse: mockParse,
  });
  mockPrompt.mockResolvedValue('{"facts":["User likes coffee"]}');
  mockParse.mockReturnValue({ facts: ['User likes coffee'] });
}

describe('LlamaCppClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
    vi.mocked(existsSync).mockReturnValue(true);
  });

  it('returns parsed JSON matching schema', async () => {
    const client = new LlamaCppClient(TEST_CONFIG);
    const result = await client.generate<{ facts: string[] }>({
      systemPrompt: 'Extract facts.',
      userPrompt: 'I like coffee.',
      schema: TEST_SCHEMA,
    });

    expect(result).toEqual({ facts: ['User likes coffee'] });
    expect(mockParse).toHaveBeenCalledWith('{"facts":["User likes coffee"]}');
  });

  it('creates grammar from provided schema', async () => {
    const client = new LlamaCppClient(TEST_CONFIG);
    await client.generate({
      systemPrompt: 'Extract.',
      userPrompt: 'Test.',
      schema: TEST_SCHEMA,
    });

    expect(mockCreateGrammarForJsonSchema).toHaveBeenCalledWith(TEST_SCHEMA);
  });

  it('passes systemPrompt and userPrompt correctly', async () => {
    const client = new LlamaCppClient(TEST_CONFIG);
    await client.generate({
      systemPrompt: 'You are an extractor.',
      userPrompt: 'I live in Tokyo.',
      schema: TEST_SCHEMA,
    });

    expect(LlamaChatSession).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'You are an extractor.',
      }),
    );
    expect(mockPrompt).toHaveBeenCalledWith(
      'I live in Tokyo.',
      expect.objectContaining({
        maxTokens: 4096,
      }),
    );
  });

  it('uses maxTokens from params', async () => {
    const client = new LlamaCppClient(TEST_CONFIG);
    await client.generate({
      systemPrompt: 'Extract.',
      userPrompt: 'Test.',
      schema: TEST_SCHEMA,
      maxTokens: 2048,
    });

    expect(mockPrompt).toHaveBeenCalledWith(
      'Test.',
      expect.objectContaining({
        maxTokens: 2048,
      }),
    );
  });

  it('defaults maxTokens to 4096', async () => {
    const client = new LlamaCppClient(TEST_CONFIG);
    await client.generate({
      systemPrompt: 'Extract.',
      userPrompt: 'Test.',
      schema: TEST_SCHEMA,
    });

    expect(mockPrompt).toHaveBeenCalledWith(
      'Test.',
      expect.objectContaining({
        maxTokens: 4096,
      }),
    );
  });

  it('throws DownloadError when model file not found', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const client = new LlamaCppClient({ modelPath: '/nonexistent/model.gguf' });

    await expect(
      client.generate({
        systemPrompt: 'Extract.',
        userPrompt: 'Test.',
        schema: TEST_SCHEMA,
      }),
    ).rejects.toThrow(DownloadError);

    expect(mockGetLlama).not.toHaveBeenCalled();
  });

  it('throws AppError on inference failure', async () => {
    mockPrompt.mockRejectedValue(new Error('inference timeout'));

    const client = new LlamaCppClient(TEST_CONFIG);

    await expect(
      client.generate({
        systemPrompt: 'Extract.',
        userPrompt: 'Test.',
        schema: TEST_SCHEMA,
      }),
    ).rejects.toThrow(AppError);
  });

  it('reuses model singleton across calls', async () => {
    const client = new LlamaCppClient(TEST_CONFIG);

    await client.generate({
      systemPrompt: 'Extract.',
      userPrompt: 'First call.',
      schema: TEST_SCHEMA,
    });

    await client.generate({
      systemPrompt: 'Extract.',
      userPrompt: 'Second call.',
      schema: TEST_SCHEMA,
    });

    expect(mockGetLlama).toHaveBeenCalledTimes(1);
    expect(mockLoadModel).toHaveBeenCalledTimes(1);
    expect(mockCreateContext).toHaveBeenCalledTimes(1);
  });

  it('disposes session after each call', async () => {
    const client = new LlamaCppClient(TEST_CONFIG);
    await client.generate({
      systemPrompt: 'Extract.',
      userPrompt: 'Test.',
      schema: TEST_SCHEMA,
    });

    expect(mockDispose).toHaveBeenCalledTimes(1);
  });

  it('disposes session even on error', async () => {
    mockPrompt.mockRejectedValue(new Error('boom'));

    const client = new LlamaCppClient(TEST_CONFIG);
    await expect(
      client.generate({
        systemPrompt: 'Extract.',
        userPrompt: 'Test.',
        schema: TEST_SCHEMA,
      }),
    ).rejects.toThrow();

    expect(mockDispose).toHaveBeenCalledTimes(1);
  });
});
