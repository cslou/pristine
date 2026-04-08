import type { Embedder, Retriever, Store } from '../../core/interfaces.js';
import type {
  Memory,
  RankedMemory,
  RetrieveOptions,
  RetrieveResult,
  TemporalMode,
} from '../../core/types.js';
import { RetrieverError } from '../../core/errors.js';
import { applyTemporalBoosts } from './ranking.js';

const DEFAULT_TOP_K = 10;

export interface RetrieverConfig {
  readonly embedder: Embedder;
  readonly store: Store;
}

class LocalRetriever implements Retriever {
  private readonly embedder: Embedder;
  private readonly store: Store;

  public constructor(config: RetrieverConfig) {
    this.embedder = config.embedder;
    this.store = config.store;
  }

  public async retrieve(
    query: string,
    userId: string,
    options?: RetrieveOptions,
  ): Promise<RetrieveResult> {
    const topK = options?.topK ?? DEFAULT_TOP_K;
    const temporalMode: TemporalMode = options?.temporalMode ?? 'current';

    if (query.length === 0) {
      throw new RetrieverError('Retriever query cannot be empty.');
    }

    if (!userId) {
      throw new RetrieverError('Retriever userId is required.');
    }

    if (!Number.isInteger(topK) || topK <= 0) {
      throw new RetrieverError('Retriever topK must be a positive integer.');
    }

    let embedding: number[];
    try {
      embedding = await this.embedder.embed(query);
    } catch (error: unknown) {
      throw new RetrieverError(`Retriever failed to embed query: ${describeError(error)}`);
    }

    let memories: Memory[];
    try {
      memories = await this.store.searchSimilar({
        embedding,
        limit: topK,
        userId,
        temporalMode,
        asOf: options?.asOf,
      });
    } catch (error: unknown) {
      throw new RetrieverError(
        `Retriever failed to search similar memories: ${describeError(error)}`,
      );
    }

    const now = Date.now();

    const ranked: RankedMemory[] = memories.map((memory) => ({
      memory,
      score: applyTemporalBoosts(
        memory,
        1 - cosineDistance(embedding, memory.embedding),
        temporalMode,
        now,
      ),
    }));

    ranked.sort((left, right) => right.score - left.score);
    const results = ranked.slice(0, topK);

    return {
      query: {
        intent: 'contextual_search',
        filters: {},
        suggestedTopK: topK,
        rewrittenQuery: query,
      },
      memories: results,
      metadata: {
        totalFound: memories.length,
        topK,
      },
    };
  }
}

function cosineDistance(left: number[], right: number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;

    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  if (denominator === 0) {
    return 1;
  }

  return 1 - dot / denominator;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

export const createRetriever = (config: RetrieverConfig): Retriever => new LocalRetriever(config);
