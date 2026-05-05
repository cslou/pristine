/**
 * Shared helpers for the Ollama smoke tests. Lives under `tests/helpers/`
 * (the established convention for cross-test utilities, alongside
 * `in-memory-key-manager.ts`) so it isn't picked up by the `*.test.ts`
 * glob and stays a stable import target across both unit and
 * integration trees.
 */

export const DEFAULT_OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

export const isOllamaReachable = async (host: string = DEFAULT_OLLAMA_HOST): Promise<boolean> => {
  try {
    const res = await fetch(`${host}/api/tags`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Inspect a thrown error message for the Ollama "model not pulled" 404
 * signal. The check requires both "model" + "404" or "model"+"not"+"found"
 * substrings so an unrelated 404 (e.g. wrong endpoint path) doesn't get
 * misattributed.
 */
export const isModelNotPulled = (msg: string): boolean =>
  /model.*not.*found/i.test(msg) || /model.*\b404\b|\b404\b.*model/i.test(msg);
