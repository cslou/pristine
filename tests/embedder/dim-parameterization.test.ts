import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '../../src/core/errors.js';
import { assertValidDim, createEmbedder, DEFAULT_EMBEDDING_DIM } from '../../src/embedder/index.js';
import { LocalEmbedder } from '../../src/embedder/local/index.js';
import { OllamaEmbedder } from '../../src/embedder/ollama/index.js';

// ---------------------------------------------------------------------------
// Story 0 / sprint-017 — dim parameterization unit tests
// ---------------------------------------------------------------------------
//
// Pins:
//   1. AC-FV-2 — factory routes the configured `dim` to both engine
//      constructors; resulting instances expose `dim` via `Embedder.dim`.
//      (Per-engine strict-validate at embed time — AC-FV-3 — is covered
//      in tests/embedder/local.test.ts and tests/embedder/ollama.test.ts.)
//   2. AC-FV-5 — `assertValidDim` rejects the SQL-injection-shaped
//      string before any DDL is built.
//   3. AC-FV-6 — bounds check (`64 <= dim <= 4096`, integer-only).

describe('createEmbedder — dim routing (AC-FV-2)', () => {
  it('routes default dim (768) to LocalEmbedder when omitted', () => {
    const embedder = createEmbedder({ engine: 'local' });
    expect(embedder).toBeInstanceOf(LocalEmbedder);
    expect(embedder.dim).toBe(DEFAULT_EMBEDDING_DIM);
    expect(embedder.dim).toBe(768);
  });

  it('routes default dim (768) to OllamaEmbedder when omitted', () => {
    const embedder = createEmbedder({ engine: 'ollama' });
    expect(embedder).toBeInstanceOf(OllamaEmbedder);
    expect(embedder.dim).toBe(DEFAULT_EMBEDDING_DIM);
  });

  it('routes a custom dim (1024) to LocalEmbedder', () => {
    const embedder = createEmbedder({ engine: 'local', dim: 1024 });
    expect(embedder).toBeInstanceOf(LocalEmbedder);
    expect(embedder.dim).toBe(1024);
  });

  it('routes a custom dim (1024) to OllamaEmbedder', () => {
    const embedder = createEmbedder({ engine: 'ollama', dim: 1024 });
    expect(embedder).toBeInstanceOf(OllamaEmbedder);
    expect(embedder.dim).toBe(1024);
  });

  it('rejects an out-of-bounds dim at the factory before constructing the engine', () => {
    expect(() => createEmbedder({ engine: 'local', dim: 8192 })).toThrow(InvalidArgumentError);
    expect(() => createEmbedder({ engine: 'ollama', dim: 32 })).toThrow(InvalidArgumentError);
  });
});

describe('assertValidDim — bounds + injection guard (AC-FV-5, AC-FV-6)', () => {
  it('accepts the documented default 768', () => {
    expect(() => {
      assertValidDim(768);
    }).not.toThrow();
  });

  it('accepts the documented bounds endpoints', () => {
    expect(() => {
      assertValidDim(64);
    }).not.toThrow();
    expect(() => {
      assertValidDim(4096);
    }).not.toThrow();
  });

  it('accepts other commonly-shipped embedder dims', () => {
    for (const dim of [256, 512, 1024, 1536, 3072]) {
      expect(() => {
        assertValidDim(dim);
      }).not.toThrow();
    }
  });

  it('rejects below-bound dim (63)', () => {
    expect(() => {
      assertValidDim(63);
    }).toThrow(InvalidArgumentError);
  });

  it('rejects above-bound dim (4097)', () => {
    expect(() => {
      assertValidDim(4097);
    }).toThrow(InvalidArgumentError);
  });

  it('rejects non-integer numeric dim', () => {
    expect(() => {
      assertValidDim(768.5);
    }).toThrow(InvalidArgumentError);
  });

  it('rejects string-typed dim (TS bypass)', () => {
    expect(() => {
      assertValidDim('768' as unknown);
    }).toThrow(InvalidArgumentError);
  });

  it('rejects SQL-injection-shaped string before any DDL is built (AC-FV-5)', () => {
    expect(() => {
      assertValidDim('768; DROP TABLE messages;--' as unknown);
    }).toThrow(InvalidArgumentError);
  });

  it('rejects null and undefined', () => {
    expect(() => {
      assertValidDim(null);
    }).toThrow(InvalidArgumentError);
    expect(() => {
      assertValidDim(undefined);
    }).toThrow(InvalidArgumentError);
  });

  it('rejects NaN and Infinity', () => {
    expect(() => {
      assertValidDim(Number.NaN);
    }).toThrow(InvalidArgumentError);
    expect(() => {
      assertValidDim(Number.POSITIVE_INFINITY);
    }).toThrow(InvalidArgumentError);
  });
});
