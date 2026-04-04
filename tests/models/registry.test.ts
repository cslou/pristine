import { describe, expect, it } from 'vitest';
import { getModelEntry, getDefaultLlmModelName, listModels } from '../../src/models/registry.js';

describe('model registry', () => {
  it('returns default LLM model name', () => {
    const name = getDefaultLlmModelName();
    expect(name).toBe('qwen2.5-7b-instruct-q4_k_m');
  });

  it('looks up default LLM model entry', () => {
    const entry = getModelEntry('qwen2.5-7b-instruct-q4_k_m');
    expect(entry).toBeDefined();
    expect(entry!.filename).toBe('qwen2.5-7b-instruct-q4_k_m.gguf');
    expect(entry!.url).toContain('huggingface.co');
    expect(entry!.sizeBytes).toBeGreaterThan(0);
  });

  it('returns undefined for unknown model', () => {
    const entry = getModelEntry('nonexistent-model');
    expect(entry).toBeUndefined();
  });

  it('lists all registered models', () => {
    const models = listModels();
    expect(models.length).toBeGreaterThanOrEqual(1);
    expect(models.some((m) => m.name === 'qwen2.5-7b-instruct-q4_k_m')).toBe(true);
  });
});
