export type { LlmClient } from '../core/interfaces.js';
export type { JsonSchema, LocalConfig } from '../core/types.js';

export interface LlamaCppConfig {
  readonly modelPath: string;
  readonly gpu?: 'auto' | 'metal' | 'cuda' | 'vulkan' | false;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface OllamaConfig {
  readonly host?: string;
  readonly model: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /**
   * Per-request timeout in milliseconds. The fetch call is aborted when this
   * elapses, causing `generate` to throw a clear `AppError`. Without this,
   * Ollama can hang indefinitely on large prompts or overloaded models
   * (observed during LOCOMO benchmark runs: >10min hangs on 39-message
   * sessions with llama3.2:3b). Defaults to 120_000 (120s).
   */
  readonly timeoutMs?: number;
}
