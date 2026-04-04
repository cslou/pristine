import { join } from 'node:path';
import { homedir } from 'node:os';
import type { LlmClient } from '../core/interfaces.js';
import type { LocalConfig } from '../core/types.js';
import { LlamaCppClient } from './llamacpp/index.js';
import { OllamaClient } from './ollama/index.js';
import { getModelEntry, getDefaultLlmModelName } from '../models/registry.js';

const DEFAULT_MODELS_DIR = join(homedir(), '.pristine', 'models');

export async function createLlmClient(config: LocalConfig = {}): Promise<LlmClient> {
  const engine = config.llmEngine ?? (await detectEngine(config));

  if (engine === 'ollama') {
    const model = config.llmModel ?? getDefaultLlmModelName();
    const host = process.env.OLLAMA_HOST;
    return new OllamaClient({ model, ...(host ? { host } : {}) });
  }

  const modelsDir = config.modelsDir ?? DEFAULT_MODELS_DIR;
  const modelName = config.llmModel ?? getDefaultLlmModelName();
  const entry = getModelEntry(modelName);
  const modelPath = entry ? join(modelsDir, entry.filename) : modelName;

  return new LlamaCppClient({ modelPath });
}

async function detectEngine(config: LocalConfig): Promise<'llamacpp' | 'ollama'> {
  try {
    const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
    const client = new OllamaClient({ model: config.llmModel ?? getDefaultLlmModelName(), host });
    const reachable = await client.isReachable();
    return reachable ? 'ollama' : 'llamacpp';
  } catch {
    return 'llamacpp';
  }
}

export { LlamaCppClient } from './llamacpp/index.js';
export { OllamaClient } from './ollama/index.js';
