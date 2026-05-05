import { beforeAll, describe, expect, it } from 'vitest';
import { OllamaEmbedder } from '../../src/embedder/ollama/index.js';

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
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const MODEL = 'embeddinggemma:300m';

const isOllamaReachable = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
};

let ollamaUp = false;

beforeAll(async () => {
  ollamaUp = await isOllamaReachable();
});

describe.skipIf(skipSlow)('OllamaEmbedder smoke — embeddinggemma:300m', () => {
  it('loads the model and produces a 768-d vector', async () => {
    if (!ollamaUp) {
      // eslint-disable-next-line no-console
      console.warn(`[smoke] Ollama not reachable at ${OLLAMA_HOST}; skipping this test.`);
      return;
    }

    const embedder = new OllamaEmbedder({ model: MODEL, host: OLLAMA_HOST, dim: 768 });
    let vector: number[];
    try {
      vector = await embedder.embed('hello world');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/model.*not.*found|404/i.test(msg)) {
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
