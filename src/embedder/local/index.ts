import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { Embedder } from '../../core/interfaces.js';
import { EmbedderError, InvalidArgumentError } from '../../core/errors.js';
import { assertValidDim, DEFAULT_EMBEDDING_DIM } from '../index.js';

const DEFAULT_MODEL = 'nomic-ai/nomic-embed-text-v1.5';

export interface LocalEmbedderConfig {
  readonly model?: string;
  readonly dim?: number;
}

export class LocalEmbedder implements Embedder {
  private readonly modelName: string;
  public readonly dim: number;
  private pipe: FeatureExtractionPipeline | null = null;
  private pipePromise: Promise<FeatureExtractionPipeline> | null = null;

  public constructor(config: LocalEmbedderConfig = {}) {
    this.modelName = config.model ?? DEFAULT_MODEL;
    const dim = config.dim ?? DEFAULT_EMBEDDING_DIM;
    assertValidDim(dim);
    this.dim = dim;
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

    const extractor = await this.ensurePipeline();
    const results: number[][] = [];

    // Process sequentially — @huggingface/transformers feature-extraction
    // pipeline returns a single Tensor for array input without per-item separation.
    // Sequential processing ensures correct 1:1 mapping.
    for (const text of texts) {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data as Float32Array);
      if (embedding.length !== this.dim) {
        throw new InvalidArgumentError(
          `LocalEmbedder configured dim=${this.dim} but model '${this.modelName}' produced ${embedding.length}-d output`,
        );
      }
      results.push(embedding);
    }

    return results;
  }

  public async dispose(): Promise<void> {
    const currentPipe = this.pipe;
    this.pipe = null;
    this.pipePromise = null;

    if (
      currentPipe &&
      typeof (currentPipe as unknown as { dispose?: () => void }).dispose === 'function'
    ) {
      (currentPipe as unknown as { dispose: () => void }).dispose();
    }
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
      throw new EmbedderError(
        `Failed to load embedding model ${this.modelName}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}

export function createLocalEmbedder(config: LocalEmbedderConfig = {}): LocalEmbedder {
  return new LocalEmbedder(config);
}
