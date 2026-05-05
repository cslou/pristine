import { describe, expect, it } from 'vitest';
import { OllamaEmbedder } from '../../src/embedder/ollama/index.js';
import {
  DEFAULT_OLLAMA_HOST,
  isModelNotPulled,
  isOllamaReachable,
} from './_ollama-test-helpers.js';

/**
 * Smoke-test for `embeddinggemma:300m` via the existing `OllamaEmbedder`
 * engine. POSTs to `/api/embed`, validates response shape + 768-d
 * output.
 *
 * Manual prerequisite (NOT auto-pulled by this test):
 *   ollama pull embeddinggemma:300m
 *
 * Skipped if `SKIP_SLOW_TESTS=1` OR if Ollama is not reachable on
 * `localhost:11434`. If the model is not pulled, the test fails with
 * a clear "run `ollama pull embeddinggemma:300m` first" message rather
 * than auto-pulling.
 */
const skipSlow = process.env.SKIP_SLOW_TESTS === '1';
const MODEL = 'embeddinggemma:300m';

describe.skipIf(skipSlow)('OllamaEmbedder smoke — embeddinggemma:300m', () => {
  it('loads the model and produces a 768-d vector', async (ctx) => {
    if (!(await isOllamaReachable())) {
      ctx.skip();
      return;
    }

    const embedder = new OllamaEmbedder({ model: MODEL, host: DEFAULT_OLLAMA_HOST, dim: 768 });
    let vector: number[];
    try {
      vector = await embedder.embed('hello world');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isModelNotPulled(msg)) {
        throw new Error(
          `Ollama model not pulled locally. Run \`ollama pull ${MODEL}\` first, then re-run the smoke test. Original error: ${msg}`,
        );
      }
      throw err;
    }

    expect(vector).toHaveLength(768);
    expect(vector.every((v) => typeof v === 'number' && Number.isFinite(v))).toBe(true);
  }, 60_000);
});
