import { getLlama, LlamaChatSession } from 'node-llama-cpp';
import type { Llama, LlamaModel, LlamaContext, LlamaContextSequence } from 'node-llama-cpp';
import { existsSync } from 'node:fs';
import type { LlmClient } from '../../core/interfaces.js';
import type { JsonSchema } from '../../core/types.js';
import { AppError, DownloadError } from '../../core/errors.js';
import type { LlamaCppConfig } from '../types.js';

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0;

export class LlamaCppClient implements LlmClient {
  private readonly config: LlamaCppConfig;
  private llama: Llama | null = null;
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private contextSequence: LlamaContextSequence | null = null;
  private loadPromise: Promise<void> | null = null;

  public constructor(config: LlamaCppConfig) {
    this.config = config;
  }

  public async generate<T>(params: {
    readonly systemPrompt: string;
    readonly userPrompt: string;
    readonly schema: JsonSchema;
    readonly maxTokens?: number;
  }): Promise<T> {
    await this.ensureLoaded();

    let session: LlamaChatSession | null = null;
    try {
      const grammar = await this.llama!.createGrammarForJsonSchema(
        params.schema as Parameters<Llama['createGrammarForJsonSchema']>[0],
      );

      session = new LlamaChatSession({
        contextSequence: this.contextSequence!,
        systemPrompt: params.systemPrompt,
      });

      const maxTokens = params.maxTokens ?? this.config.maxTokens ?? DEFAULT_MAX_TOKENS;

      const responseText = await session.prompt(params.userPrompt, {
        grammar,
        maxTokens,
        temperature: this.config.temperature ?? DEFAULT_TEMPERATURE,
      });

      return grammar.parse(responseText) as T;
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `LlamaCpp inference failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      session?.dispose();
    }
  }

  public async dispose(): Promise<void> {
    this.contextSequence = null;
    if (this.context) {
      await this.context.dispose();
      this.context = null;
    }
    if (this.model) {
      await this.model.dispose();
      this.model = null;
    }
    if (this.llama) {
      await this.llama.dispose();
      this.llama = null;
    }
    this.loadPromise = null;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.llama && this.model && this.context) {
      return;
    }

    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }

    this.loadPromise = this.load();
    await this.loadPromise;
  }

  private async load(): Promise<void> {
    if (!existsSync(this.config.modelPath)) {
      this.loadPromise = null;
      throw new DownloadError(
        `Model file not found: ${this.config.modelPath}. Run 'npx pristine-local download-models' to download.`,
      );
    }

    this.llama = await getLlama({ gpu: this.config.gpu ?? 'auto' });
    this.model = await this.llama.loadModel({ modelPath: this.config.modelPath });
    this.context = await this.model.createContext();
    this.contextSequence = this.context.getSequence();
  }
}

export function createLlamaCppClient(config: LlamaCppConfig): LlamaCppClient {
  return new LlamaCppClient(config);
}
