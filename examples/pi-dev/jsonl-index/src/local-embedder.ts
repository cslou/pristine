import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

export interface PiJsonlEmbedder {
  embed(text: string): Promise<readonly number[]>;
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
    const extractor = await this.ensureExtractor();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
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
