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
}
