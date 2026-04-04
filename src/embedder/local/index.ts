import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { Embedder } from '../../core/interfaces.js';
import { AppError } from '../../core/errors.js';

const DEFAULT_MODEL = 'nomic-ai/nomic-embed-text-v1.5';
const EXPECTED_DIMENSION = 768;

export interface LocalEmbedderConfig {
  readonly model?: string;
}

export class LocalEmbedder implements Embedder {
  private readonly modelName: string;
  private pipe: FeatureExtractionPipeline | null = null;
  private pipePromise: Promise<FeatureExtractionPipeline> | null = null;

  public constructor(config: LocalEmbedderConfig = {}) {
    this.modelName = config.model ?? DEFAULT_MODEL;
  }

  public async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    const first = results[0];
    if (!first) {
      throw new AppError('Embedding service returned no results.');
    }
    return first;
  }

  public async embedBatch(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const extractor = await this.ensurePipeline();
    const results: number[][] = [];

    for (const text of texts) {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data as Float32Array).slice(0, EXPECTED_DIMENSION);
      results.push(embedding);
    }

    return results;
  }

  public async dispose(): Promise<void> {
    this.pipe = null;
    this.pipePromise = null;
  }

  private async ensurePipeline(): Promise<FeatureExtractionPipeline> {
    if (this.pipe) {
      return this.pipe;
    }

    if (this.pipePromise) {
      return this.pipePromise;
    }

    this.pipePromise = this.loadPipeline();
    this.pipe = await this.pipePromise;
    return this.pipe;
  }

  private async loadPipeline(): Promise<FeatureExtractionPipeline> {
    try {
      return await pipeline('feature-extraction', this.modelName);
    } catch (error: unknown) {
      this.pipePromise = null;
      throw new AppError(
        `Failed to load embedding model ${this.modelName}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}

export function createLocalEmbedder(config: LocalEmbedderConfig = {}): LocalEmbedder {
  return new LocalEmbedder(config);
}
