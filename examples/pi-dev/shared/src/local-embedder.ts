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
    const extractor = await this.ensureExtractor();
    const vectors: number[][] = [];
    for (const text of texts) {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      vectors.push(Array.from(output.data as Float32Array));
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
