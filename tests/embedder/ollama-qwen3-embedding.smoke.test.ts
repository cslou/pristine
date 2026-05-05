import { beforeAll, describe, expect, it } from 'vitest';
import { OllamaEmbedder } from '../../src/embedder/ollama/index.js';
import { createTruncatingEmbedder } from '../integration/embedder-eval/wrappers/truncating-wrapper.js';

/**
 * Smoke-test for `qwen3-embedding:0.6b` via the existing `OllamaEmbedder`
 * engine plus the eval-harness's Matryoshka truncating-wrapper.
 *
 * Qwen3-Embedding-0.6B is native 1024-d and MRL-trained; the SDK's
 * `vec_windows.embedding` column is `float[768]` at the configured
 * default, so a wrapper truncates the 1024-d Ollama response to 768
 * (slice + L2 renorm) before the vector reaches storage. The wrapper
 * lives in the harness — outside `src/` — so the engine class stays
 * candidate-agnostic.
 *
 * Manual prerequisite (NOT auto-pulled by this test):
 *   ollama pull qwen3-embedding:0.6b
 *
 * Skipped if `SKIP_SLOW_TESTS=1` OR if Ollama is not reachable on
 * `localhost:11434`.
 */
const skipSlow = process.env.SKIP_SLOW_TESTS === '1';
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const MODEL = 'qwen3-embedding:0.6b';
const QWEN3_NATIVE_DIM = 1024;
const TARGET_DIM = 768;

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

describe.skipIf(skipSlow)(
  'OllamaEmbedder smoke — qwen3-embedding:0.6b + truncating-wrapper',
  () => {
    it('Ollama returns a 1024-d vector for the model', async () => {
      if (!ollamaUp) {
        // eslint-disable-next-line no-console
        console.warn(`[smoke] Ollama not reachable at ${OLLAMA_HOST}; skipping this test.`);
        return;
      }

      // Configure OllamaEmbedder with the model's native dim so the
      // strict-validate length check inside `OllamaEmbedder.embedBatch`
      // passes against the 1024-d response.
      const native = new OllamaEmbedder({
        model: MODEL,
        host: OLLAMA_HOST,
        dim: QWEN3_NATIVE_DIM,
      });

      let raw: number[];
      try {
        raw = await native.embed('hello world');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/model.*not.*found|404/i.test(msg)) {
          throw new Error(
            `Ollama model not pulled locally. Run \`ollama pull ${MODEL}\` first, then re-run the smoke test. Original error: ${msg}`,
          );
        }
        throw err;
      }

      expect(raw).toHaveLength(QWEN3_NATIVE_DIM);
      expect(raw.every((v) => typeof v === 'number' && Number.isFinite(v))).toBe(true);
    }, 60_000);

    it('truncating-wrapper produces a 768-d unit-norm vector from the 1024-d underlying embedder', async () => {
      if (!ollamaUp) {
        // eslint-disable-next-line no-console
        console.warn(`[smoke] Ollama not reachable at ${OLLAMA_HOST}; skipping this test.`);
        return;
      }

      const native = new OllamaEmbedder({
        model: MODEL,
        host: OLLAMA_HOST,
        dim: QWEN3_NATIVE_DIM,
      });
      const wrapped = createTruncatingEmbedder(native, TARGET_DIM);

      let vector: number[];
      try {
        vector = await wrapped.embed('hello world');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/model.*not.*found|404/i.test(msg)) {
          throw new Error(
            `Ollama model not pulled locally. Run \`ollama pull ${MODEL}\` first, then re-run the smoke test. Original error: ${msg}`,
          );
        }
        throw err;
      }

      expect(wrapped.dim).toBe(TARGET_DIM);
      expect(vector).toHaveLength(TARGET_DIM);
      const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
      // Wrapper L2-renorms; magnitude must be exactly 1.0 within float
      // precision regardless of whether the raw vector was already unit-norm.
      expect(magnitude).toBeCloseTo(1.0, 6);
    }, 60_000);
  },
);
