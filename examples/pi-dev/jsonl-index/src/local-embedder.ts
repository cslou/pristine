import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

export interface PiJsonlEmbedder {
  readonly dim: number;
  embed(text: string): Promise<readonly number[]>;
}

export interface LocalNomicEmbedderOptions {
  readonly model?: string;
  readonly dim?: number;
}

const DEFAULT_MODEL = 'nomic-ai/nomic-embed-text-v1.5';
const DEFAULT_DIM = 768;

export class LocalNomicEmbedder implements PiJsonlEmbedder {
  public readonly dim: number;
  private readonly model: string;
  private extractor: FeatureExtractionPipeline | null = null;
  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

  public constructor(options: LocalNomicEmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.dim = options.dim ?? DEFAULT_DIM;
  }

  public async embed(text: string): Promise<readonly number[]> {
    const extractor = await this.ensureExtractor();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const vector = Array.from(output.data as Float32Array);
    if (vector.length !== this.dim) {
      throw new Error(
        `LocalNomicEmbedder expected ${this.dim}-d vector from ${this.model}, got ${vector.length}`,
      );
    }
    return vector;
  }

  private async ensureExtractor(): Promise<FeatureExtractionPipeline> {
    if (this.extractor !== null) return this.extractor;
    if (this.extractorPromise === null) {
      this.extractorPromise = pipeline('feature-extraction', this.model);
    }
    this.extractor = await this.extractorPromise;
    return this.extractor;
  }
}
