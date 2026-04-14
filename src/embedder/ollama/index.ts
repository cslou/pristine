import type { Embedder } from '../../core/interfaces.js';
import { EmbedderError } from '../../core/errors.js';

const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_HOST = 'http://localhost:11434';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

export interface OllamaEmbedderConfig {
  readonly model?: string;
  readonly host?: string;
}

interface OllamaEmbedResponse {
  readonly embeddings: number[][];
}

export class OllamaEmbedder implements Embedder {
  private readonly model: string;
  private readonly host: string;

  public constructor(config: OllamaEmbedderConfig = {}) {
    this.model = config.model ?? DEFAULT_MODEL;
    this.host = config.host ?? process.env.OLLAMA_HOST ?? DEFAULT_HOST;
  }

  public async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    const first = results[0];
    if (!first) {
      throw new EmbedderError('Embedding service returned no results.');
    }
    return first;
  }

  public async embedBatch(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await this.fetchWithRetry(`${this.host}/api/embed`, {
      model: this.model,
      input: texts,
    });

    return response.embeddings;
  }

  private async fetchWithRetry(
    url: string,
    body: Record<string, unknown>,
  ): Promise<OllamaEmbedResponse> {
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
          throw new EmbedderError(`Ollama embedding API error: ${status} ${response.statusText}`);
        }

        return (await response.json()) as OllamaEmbedResponse;
      } catch (error: unknown) {
        if (error instanceof EmbedderError) {
          throw error;
        }
        // Network error (connection refused, DNS failure) -- fail immediately, no retries
        const msg = error instanceof Error ? error.message : 'unknown error';
        throw new EmbedderError(
          `Ollama embedding request failed: ${msg}. ` +
            `Is Ollama running? Start it with \`ollama serve\` or check OLLAMA_HOST (current: ${this.host})`,
        );
      }
    }

    throw new EmbedderError(
      'Ollama embedding request failed: max retries exceeded. ' +
        `Is Ollama running at ${this.host}?`,
    );
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

export function createOllamaEmbedder(config: OllamaEmbedderConfig = {}): OllamaEmbedder {
  return new OllamaEmbedder(config);
}
