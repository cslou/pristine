import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { LlamaCppClient } from '../../src/engine/llamacpp/index.js';
import { OllamaClient } from '../../src/engine/ollama/index.js';

const MODELS_DIR = join(homedir(), '.pristine', 'models');
const DEFAULT_MODEL_FILE = 'qwen2.5-7b-instruct-q4_k_m.gguf';
const MODEL_PATH = join(MODELS_DIR, DEFAULT_MODEL_FILE);

const hasLocalModel = existsSync(MODEL_PATH);

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

describe.skipIf(!hasLocalModel)('LlamaCppClient integration (real model)', () => {
  it('generates valid JSON matching extract_facts schema', async () => {
    const client = new LlamaCppClient({ modelPath: MODEL_PATH });

    try {
      const result = await client.generate<{ facts: Array<{ text: string }> }>({
        systemPrompt: 'Extract factual statements from the conversation.',
        userPrompt: 'user: I live in Tokyo and work at Google.\nassistant: Got it!',
        schema: EXTRACT_FACTS_SCHEMA,
        maxTokens: 512,
      });

      expect(result).toBeDefined();
      expect(result.facts).toBeInstanceOf(Array);
      expect(result.facts.length).toBeGreaterThan(0);
      expect(typeof result.facts[0]!.text).toBe('string');
    } finally {
      await client.dispose();
    }
  }, 120000);
});

describe('OllamaClient integration (requires running Ollama)', () => {
  it('generates valid JSON when Ollama is available', async () => {
    const client = new OllamaClient({ model: 'qwen2.5:7b' });
    const reachable = await client.isReachable();

    if (!reachable) {
      return;
    }

    const result = await client.generate<{ facts: Array<{ text: string }> }>({
      systemPrompt: 'Extract factual statements from the conversation.',
      userPrompt: 'user: I live in Tokyo and work at Google.\nassistant: Got it!',
      schema: EXTRACT_FACTS_SCHEMA,
      maxTokens: 512,
    });

    expect(result).toBeDefined();
    expect(result.facts).toBeInstanceOf(Array);
    expect(result.facts.length).toBeGreaterThan(0);
    expect(typeof result.facts[0]!.text).toBe('string');
  }, 120000);
});
