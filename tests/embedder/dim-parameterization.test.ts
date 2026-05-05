import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '../../src/core/errors.js';
import { assertValidDim, createEmbedder, DEFAULT_EMBEDDING_DIM } from '../../src/embedder/index.js';
import { LocalEmbedder } from '../../src/embedder/local/index.js';
import { OllamaEmbedder } from '../../src/embedder/ollama/index.js';

// ---------------------------------------------------------------------------
// Embedder dim parameterization — unit tests
// ---------------------------------------------------------------------------
//
// Pins:
//   1. Both engine constructors store the configured `dim` and expose
//      it via the `Embedder.dim` getter.
//   2. `createEmbedder` routes the configured `dim` to both engines.
//      (Per-engine strict-validate at embed time is covered separately
//      in tests/embedder/local.test.ts and tests/embedder/ollama.test.ts.)
//   3. `assertValidDim` is the bounds + injection guard for `float[${dim}]`
//      DDL templating: rejects non-integers, out-of-range values, NaN /
//      Infinity, and SQL-injection-shaped strings before any DDL is built.

describe('Embedder constructors — direct dim configuration', () => {
  it('LocalEmbedder constructor stores dim from config', () => {
    expect(new LocalEmbedder().dim).toBe(DEFAULT_EMBEDDING_DIM);
    expect(new LocalEmbedder({ dim: 1024 }).dim).toBe(1024);
    expect(new LocalEmbedder({ dim: 256 }).dim).toBe(256);
  });

  it('OllamaEmbedder constructor stores dim from config', () => {
    expect(new OllamaEmbedder().dim).toBe(DEFAULT_EMBEDDING_DIM);
    expect(new OllamaEmbedder({ dim: 1024 }).dim).toBe(1024);
    expect(new OllamaEmbedder({ dim: 256 }).dim).toBe(256);
  });
});

describe('createEmbedder — dim routing', () => {
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

describe('assertValidDim — bounds + injection guard', () => {
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

  it('rejects SQL-injection-shaped string before any DDL is built', () => {
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
