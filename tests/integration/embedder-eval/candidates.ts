import type { EmbedderConfig } from '../../../src/embedder/index.js';

/**
 * Map a candidate name to an `EmbedderConfig`. Centralised so the
 * candidate triplet (engine, model, dim) lives in one place. Adding a
 * new candidate is one switch arm. The mapping is intentionally not
 * data-driven — the candidate set is small, locked at planning, and a
 * typed switch makes typos a TypeScript error.
 */
export const candidateConfig = (name: string): EmbedderConfig => {
  switch (name) {
    case 'nomic-v1.5':
      return { engine: 'local', model: 'nomic-ai/nomic-embed-text-v1.5', dim: 768 };
    case 'gte-modernbert-base':
      return { engine: 'local', model: 'Alibaba-NLP/gte-modernbert-base', dim: 768 };
    case 'embeddinggemma':
      return { engine: 'ollama', model: 'embeddinggemma:300m', dim: 768 };
    case 'qwen3-embedding':
      // Qwen3 is native 1024-d. The harness pins dim=768 to match the
      // SDK default and relies on a wrapper-side slice + L2 renorm of
      // the 1024-d Ollama response (the wrapper lives outside Phase A;
      // until it ships, this candidate fails strict-validate against a
      // 1024-d response and the harness reports the failure rather
      // than silently ingesting wrong-length vectors).
      return { engine: 'ollama', model: 'qwen3-embedding:0.6b', dim: 768 };
    default:
      throw new Error(
        `Unknown candidate: ${name}. Known: nomic-v1.5, gte-modernbert-base, embeddinggemma, qwen3-embedding`,
      );
  }
};

export const KNOWN_CANDIDATES = [
  'nomic-v1.5',
  'gte-modernbert-base',
  'embeddinggemma',
  'qwen3-embedding',
] as const;
