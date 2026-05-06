export interface LocalEmbeddingBatchOptions {
  readonly modelName: string;
}

export interface LocalEmbeddingOutput {
  readonly data: unknown;
}

export type LocalEmbeddingExtractor = (
  text: string,
  options: { readonly pooling: 'mean'; readonly normalize: true },
) => Promise<LocalEmbeddingOutput>;

// @huggingface/transformers feature-extraction currently returns a single tensor for
// array input in this project setup. Keep the 1:1 text/vector mapping explicit here
// and share it across Pi reference extensions so they cannot drift.
export const embedTextsSequentially = async (
  extractor: LocalEmbeddingExtractor,
  texts: readonly string[],
  options: LocalEmbeddingBatchOptions,
): Promise<readonly (readonly number[])[]> => {
  const vectors: number[][] = [];
  for (const text of texts) {
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const embedding = Array.from(output.data as ArrayLike<number>);
    if (embedding.length === 0) {
      throw new Error(`LocalNomicEmbedder model ${options.modelName} returned an empty embedding`);
    }
    vectors.push(embedding);
  }
  return vectors;
};
