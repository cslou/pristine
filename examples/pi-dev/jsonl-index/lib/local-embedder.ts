import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

export interface PiJsonlEmbedder {
  embed(text: string): Promise<readonly number[]>;
  embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface LocalNomicEmbedderOptions {
  readonly model?: string;
  readonly batchSize?: number;
}

const DEFAULT_MODEL = 'nomic-ai/nomic-embed-text-v1.5';
const DEFAULT_BATCH_SIZE = 16;

export class LocalNomicEmbedder implements PiJsonlEmbedder {
  private readonly model: string;
  private readonly batchSize: number;
  private extractor: FeatureExtractionPipeline | null = null;
  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

  public constructor(options: LocalNomicEmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    if (!Number.isInteger(this.batchSize) || this.batchSize < 1) {
      throw new Error(
        `LocalNomicEmbedder batchSize must be a positive integer, got ${this.batchSize}`,
      );
    }
  }

  public async embed(text: string): Promise<readonly number[]> {
    const results = await this.embedBatch([text]);
    const first = results[0];
    if (first === undefined) throw new Error('LocalNomicEmbedder returned no embedding');
    return first;
  }

  public async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    const extractor = await this.ensureExtractor();
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const batch = texts.slice(offset, offset + this.batchSize);
      const output = await extractor([...batch], { pooling: 'mean', normalize: true });
      const data = output.data as Float32Array;
      const dimension = data.length / batch.length;
      if (!Number.isInteger(dimension) || dimension < 1) {
        throw new Error(
          `LocalNomicEmbedder returned invalid batch shape for ${batch.length} texts`,
        );
      }
      for (let index = 0; index < batch.length; index++) {
        const start = index * dimension;
        vectors.push(Array.from(data.subarray(start, start + dimension)));
      }
    }
    return vectors;
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
