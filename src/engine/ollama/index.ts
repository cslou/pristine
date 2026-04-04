import type { LlmClient } from '../../core/interfaces.js';
import type { JsonSchema } from '../../core/types.js';
import { AppError } from '../../core/errors.js';
import type { OllamaConfig } from '../types.js';

const DEFAULT_HOST = 'http://localhost:11434';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

interface OllamaChatResponse {
  readonly message: {
    readonly role: string;
    readonly content: string;
  };
}

export class OllamaClient implements LlmClient {
  private readonly config: OllamaConfig;
  private readonly host: string;

  public constructor(config: OllamaConfig) {
    this.config = config;
    this.host = config.host ?? process.env.OLLAMA_HOST ?? DEFAULT_HOST;
  }

  public async generate<T>(params: {
    readonly systemPrompt: string;
    readonly userPrompt: string;
    readonly schema: JsonSchema;
    readonly maxTokens?: number;
  }): Promise<T> {
    const maxTokens = params.maxTokens ?? this.config.maxTokens ?? DEFAULT_MAX_TOKENS;
    const temperature = this.config.temperature ?? DEFAULT_TEMPERATURE;

    const body = {
      model: this.config.model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
      format: params.schema,
      stream: false,
      options: {
        num_predict: maxTokens,
        temperature,
      },
    };

    const response = await this.fetchWithRetry(`${this.host}/api/chat`, body);

    try {
      return JSON.parse(response.message.content) as T;
    } catch (error: unknown) {
      throw new AppError(
        `Ollama response parsing failed: ${error instanceof Error ? error.message : 'invalid JSON'}`,
      );
    }
  }

  public async isReachable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`${this.host}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async fetchWithRetry(
    url: string,
    body: Record<string, unknown>,
  ): Promise<OllamaChatResponse> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const status = response.status;
          if (this.isRetryableStatus(status) && attempt < MAX_RETRIES) {
            await this.delay(BASE_DELAY_MS * Math.pow(2, attempt));
            continue;
          }
          throw new AppError(`Ollama API error: ${status} ${response.statusText}`);
        }

        return (await response.json()) as OllamaChatResponse;
      } catch (error: unknown) {
        if (error instanceof AppError) {
          throw error;
        }
        if (attempt < MAX_RETRIES && this.isNetworkError(error)) {
          await this.delay(BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw new AppError(
          `Ollama request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    throw new AppError('Ollama request failed: max retries exceeded');
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private isNetworkError(error: unknown): boolean {
    if (error instanceof TypeError) return true;
    if (error instanceof Error && error.name === 'AbortError') return false;
    return false;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

export function createOllamaClient(config: OllamaConfig): OllamaClient {
  return new OllamaClient(config);
}
