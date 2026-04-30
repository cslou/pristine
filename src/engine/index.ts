import type { LlmClient } from './types.js';
import type { ModelConfig, ModelEntry } from '../core/init.js';
import { loadModelConfig } from '../core/init.js';
import { LlamaCppClient } from './llamacpp/index.js';
import { OllamaClient } from './ollama/index.js';

function entriesMatch(a: ModelEntry, b: ModelEntry): boolean {
  if (a.engine !== b.engine) return false;
  if (a.engine === 'ollama' && b.engine === 'ollama') {
    return a.model === b.model && (a.host ?? '') === (b.host ?? '');
  }
  if (a.engine === 'llamacpp' && b.engine === 'llamacpp') {
    return a.path === b.path && (a.gpu ?? undefined) === (b.gpu ?? undefined);
  }
  return false;
}

function createClientFromEntry(entry: ModelEntry): LlmClient {
  if (entry.engine === 'ollama') {
    const host = entry.host ?? process.env.OLLAMA_HOST;
    return new OllamaClient({ model: entry.model, ...(host ? { host } : {}) });
  }
  return new LlamaCppClient({
    modelPath: entry.path,
    ...(entry.gpu !== undefined ? { gpu: entry.gpu } : {}),
  });
}

export function createLlmClients(configDir?: string): {
  privacyClient: LlmClient;
  memoryClient: LlmClient;
} {
  const config: ModelConfig = loadModelConfig(configDir);
  const privacyClient = createClientFromEntry(config.privacy);

  if (entriesMatch(config.privacy, config.memory)) {
    return { privacyClient, memoryClient: privacyClient };
  }

  const memoryClient = createClientFromEntry(config.memory);
  return { privacyClient, memoryClient };
}

export { LlamaCppClient } from './llamacpp/index.js';
export { OllamaClient } from './ollama/index.js';
