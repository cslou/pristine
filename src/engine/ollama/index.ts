import type { LlmClient } from '../../core/interfaces.js';
import type { JsonSchema } from '../../core/types.js';
import { AppError } from '../../core/errors.js';
import type { OllamaConfig } from '../types.js';

const DEFAULT_HOST = 'http://localhost:11434';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

// Strips markdown code-fence wrappers from model output. Ollama's
// grammar-constrained sampling does not always prevent models from
// emitting ```json ... ``` around the actual JSON — observed with
// gemma4:e4b on ~30% of responses. Extracts the JSON body if a fence
// is present; returns the raw content otherwise.
const stripJsonWrapper = (raw: string): string => {
  const trimmed = raw.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenceMatch ? fenceMatch[1]!.trim() : trimmed;
};

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
      return JSON.parse(stripJsonWrapper(response.message.content)) as T;
    } catch (error: unknown) {
      throw new AppError(
        `Ollama response parsing failed: ${error instanceof Error ? error.message : 'invalid JSON'}`,
      );
    }
  }

  public async isReachable(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(`${this.host}/api/tags`, { signal: controller.signal });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchWithRetry(
    url: string,
    body: Record<string, unknown>,
  ): Promise<OllamaChatResponse> {
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      // AbortSignal.timeout creates a fresh signal per attempt — a timeout on
      // attempt N must not carry over and cancel attempt N+1.
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
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
        if (this.isTimeoutError(error)) {
          // Do NOT retry timeouts — the prompt is what is slow, not the network.
          // Retrying would just multiply the wait time.
          throw new AppError(
            `Ollama request timed out after ${timeoutMs}ms for model ${this.config.model}. ` +
              `Increase timeoutMs in ~/.pristine/models.json or pick a smaller model.`,
          );
        }
        if (attempt < MAX_RETRIES && this.isNetworkError(error)) {
          await this.delay(BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        const msg = error instanceof Error ? error.message : 'unknown error';
        throw new AppError(
          `Ollama request failed: ${msg}. ` +
            `Start Ollama with \`ollama serve\`, or switch to llamacpp in ~/.pristine/models.json`,
        );
      }
    }

    throw new AppError(
      'Ollama request failed: max retries exceeded. ' +
        'Start Ollama with `ollama serve`, or switch to llamacpp in ~/.pristine/models.json',
    );
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private isNetworkError(error: unknown): boolean {
    // AbortError is intentionally NOT checked here: isTimeoutError() runs
    // first in the catch block and already matches both TimeoutError and
    // AbortError. Any future non-timeout abort path should revise both
    // functions so a cancellation does not get reported as a timeout.
    if (error instanceof TypeError) return true;
    return false;
  }

  private isTimeoutError(error: unknown): boolean {
    // AbortSignal.timeout raises a DOMException with name "TimeoutError" in
    // modern runtimes; Node also uses AbortError for some abort paths. Match
    // both defensively so we attribute the right failure regardless of engine.
    if (error instanceof Error) {
      if (error.name === 'TimeoutError') return true;
      if (error.name === 'AbortError') return true;
    }
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
