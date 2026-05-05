import { describe, expect, it } from 'vitest';
import { candidateConfig, KNOWN_CANDIDATES } from './candidates.js';

describe('candidateConfig', () => {
  it('returns local engine + dim 768 for nomic-v1.5', () => {
    expect(candidateConfig('nomic-v1.5')).toEqual({
      engine: 'local',
      model: 'nomic-ai/nomic-embed-text-v1.5',
      dim: 768,
    });
  });

  it('returns local engine + dim 768 for gte-modernbert-base', () => {
    expect(candidateConfig('gte-modernbert-base')).toEqual({
      engine: 'local',
      model: 'Alibaba-NLP/gte-modernbert-base',
      dim: 768,
    });
  });

  it('returns ollama engine + dim 768 for embeddinggemma', () => {
    expect(candidateConfig('embeddinggemma')).toEqual({
      engine: 'ollama',
      model: 'embeddinggemma:300m',
      dim: 768,
    });
  });

  it('returns ollama engine + dim 768 for qwen3-embedding (truncation-target dim)', () => {
    expect(candidateConfig('qwen3-embedding')).toEqual({
      engine: 'ollama',
      model: 'qwen3-embedding:0.6b',
      dim: 768,
    });
  });

  it('throws for unknown candidate names with a helpful message', () => {
    expect(() => candidateConfig('not-a-candidate')).toThrow(/Unknown candidate: not-a-candidate/);
    expect(() => candidateConfig('not-a-candidate')).toThrow(/Known: nomic-v1.5/);
  });

  it('all KNOWN_CANDIDATES entries resolve to a valid config', () => {
    for (const name of KNOWN_CANDIDATES) {
      const cfg = candidateConfig(name);
      expect(cfg.dim).toBe(768);
      expect(['local', 'ollama']).toContain(cfg.engine);
    }
  });
});
