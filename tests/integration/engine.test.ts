import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { LlamaCppClient } from '../../src/engine/llamacpp/index.js';
import { OllamaClient } from '../../src/engine/ollama/index.js';

// Model discovery: use env var override, or scan ~/.pristine/models/ for any .gguf file
const MODELS_DIR = process.env.PRISTINE_MODELS_DIR ?? join(homedir(), '.pristine', 'models');

function findGgufModel(): string | null {
  const override = process.env.PRISTINE_TEST_GGUF;
  if (override) return existsSync(override) ? override : null;

  if (!existsSync(MODELS_DIR)) return null;
  const files = readdirSync(MODELS_DIR).filter((f) => f.endsWith('.gguf'));
  return files.length > 0 ? join(MODELS_DIR, files[0]!) : null;
}

// Ollama model discovery: use env var override, or pick first available model
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

async function findOllamaModel(): Promise<string | null> {
  const override = process.env.PRISTINE_TEST_OLLAMA_MODEL;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    if (!data.models || data.models.length === 0) return null;

    if (override) {
      const found = data.models.some((m) => m.name === override || m.name.startsWith(override));
      return found ? override : null;
    }

    // Use first available model
    return data.models[0]!.name;
  } catch {
    return null;
  }
}

const EXTRACT_FACTS_SCHEMA = {
  type: 'object' as const,
  properties: {
    facts: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          text: { type: 'string' as const },
        },
        required: ['text'] as const,
      },
    },
  },
  required: ['facts'] as const,
};

const ggufModelPath = findGgufModel();

describe.skipIf(!ggufModelPath)('LlamaCppClient integration (real model)', () => {
  it('generates valid structured JSON from a GGUF model', async () => {
    const client = new LlamaCppClient({ modelPath: ggufModelPath! });

    try {
      const result = await client.generate<{ facts: Array<{ text: string }> }>({
        systemPrompt:
          'You are a fact extractor. Extract ALL factual statements about the user. You MUST return at least one fact.',
        userPrompt:
          'user: I live in Tokyo and I work at Google as a software engineer.\nassistant: Got it!',
        schema: EXTRACT_FACTS_SCHEMA,
        maxTokens: 512,
      });

      expect(result).toBeDefined();
      expect(result.facts).toBeInstanceOf(Array);
    } finally {
      await client.dispose();
    }
  }, 120000);
});

const ollamaModel = await findOllamaModel();

describe.skipIf(!ollamaModel)('OllamaClient integration (requires running Ollama)', () => {
  it('generates valid structured JSON from Ollama', async () => {
    const client = new OllamaClient({ model: ollamaModel! });

    const result = await client.generate<{ facts: Array<{ text: string }> }>({
      systemPrompt:
        'You are a fact extractor. Extract ALL factual statements about the user. You MUST return at least one fact.',
      userPrompt:
        'user: I live in Tokyo and I work at Google as a software engineer.\nassistant: Got it!',
      schema: EXTRACT_FACTS_SCHEMA,
      maxTokens: 512,
    });

    expect(result).toBeDefined();
    expect(result.facts).toBeInstanceOf(Array);
  }, 120000);
});
