import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

export interface PiJsonlEmbedder {
  embed(text: string): Promise<readonly number[]>;
  embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface LocalNomicEmbedderOptions {
  readonly model?: string;
}

const DEFAULT_MODEL = 'nomic-ai/nomic-embed-text-v1.5';

export class LocalNomicEmbedder implements PiJsonlEmbedder {
  private readonly model: string;
  private extractor: FeatureExtractionPipeline | null = null;
  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

  public constructor(options: LocalNomicEmbedderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
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
    const output = await extractor([...texts], { pooling: 'mean', normalize: true });
    const data = output.data as Float32Array;
    const dimension = data.length / texts.length;
    if (!Number.isInteger(dimension) || dimension < 1) {
      throw new Error(`LocalNomicEmbedder returned invalid batch shape for ${texts.length} texts`);
    }
    return texts.map((_, index) => {
      const start = index * dimension;
      return Array.from(data.subarray(start, start + dimension));
    });
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
