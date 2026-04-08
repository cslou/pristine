import type { LlmClient, Consolidator } from '../../core/interfaces.js';
import type {
  ConsolidationAction,
  ConsolidationBatchResult,
  ConsolidationRequest,
  ConsolidationResult,
  Fact,
} from '../../core/types.js';
import { AppError, ConsolidationError } from '../../core/errors.js';
import { assertNoLlmReentry } from '../../privacy/sanitizer/index.js';
import { buildConsolidationPrompt } from './prompts.js';
import { CONSOLIDATION_SCHEMA } from './schema.js';

const DEFAULT_SINGLE_MAX_TOKENS = 600;
const DEFAULT_BATCH_MAX_TOKENS = 4096;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 500;

export interface ConsolidatorConfig {
  readonly maxTokens?: number;
  readonly systemPrompt?: string;
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
}

interface ConsolidationDecisionsResponse {
  readonly decisions?: unknown[];
}

class LocalConsolidator implements Consolidator {
  private readonly client: LlmClient;
  private readonly maxTokens: number | undefined;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly systemPrompt: string | undefined;

  public constructor(client: LlmClient, config: ConsolidatorConfig = {}) {
    this.client = client;
    this.maxTokens = config.maxTokens;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.systemPrompt = config.systemPrompt;
  }

  public async consolidate(
    newFact: Fact,
    similarMemories: readonly Fact[],
  ): Promise<ConsolidationResult> {
    const batch = await this.consolidateBatch([{ newFact, similarMemories }]);
    const result = batch.results[0];
    if (!result) {
      throw new ConsolidationError('Consolidator batch returned no results for single-fact call.');
    }

    if (typeof result.targetMemoryId === 'string') {
      const uuid = batch.idRemap.get(result.targetMemoryId);
      return { ...result, targetMemoryId: uuid ?? result.targetMemoryId };
    }

    return result;
  }

  public async consolidateBatch(
    requests: ConsolidationRequest[],
  ): Promise<ConsolidationBatchResult> {
    if (requests.length === 0) {
      return { results: [], idRemap: new Map() };
    }

    for (const request of requests) {
      assertNoLlmReentry(request.newFact, 'consolidator new fact');
      assertNoLlmReentry(request.similarMemories, 'consolidator similar memories');
    }

    const withSimilar: Array<{
      index: number;
      newFact: Fact;
      similarMemories: readonly Fact[];
    }> = [];
    const autoAddResults: ConsolidationResult[] = [];

    for (let i = 0; i < requests.length; i += 1) {
      const request = requests[i]!;
      if (request.similarMemories.length === 0) {
        autoAddResults.push({ action: 'ADD', factIndex: i });
      } else {
        withSimilar.push({
          index: i,
          newFact: request.newFact,
          similarMemories: request.similarMemories,
        });
      }
    }

    if (withSimilar.length === 0) {
      return { results: autoAddResults, idRemap: new Map() };
    }

    const { uuidToIndex, indexToUuid } = this.buildIdRemaps(withSimilar);
    const validTargetIds = new Set(indexToUuid.keys());

    const sections = withSimilar.map(({ index, newFact, similarMemories }) => {
      const memoriesText = this.formatSimilarMemories(similarMemories, uuidToIndex);
      return `--- Fact ${index} ---\nNew fact: ${JSON.stringify(newFact.text)}\nExisting similar memories:\n${memoriesText}`;
    });

    const prompt =
      'Evaluate each fact below against its similar existing memories and return one decision per fact.\n\n' +
      sections.join('\n\n');

    const maxTokens =
      this.maxTokens ??
      (withSimilar.length === 1 ? DEFAULT_SINGLE_MAX_TOKENS : DEFAULT_BATCH_MAX_TOKENS);
    const validFactIndices = new Set(withSimilar.map(({ index }) => index));

    const batchResults = await this.callWithRetry(
      prompt,
      maxTokens,
      validTargetIds,
      validFactIndices,
    );
    const allResults = [...autoAddResults, ...batchResults].sort(
      (a, b) => a.factIndex - b.factIndex,
    );

    return { results: allResults, idRemap: indexToUuid };
  }

  private buildIdRemaps(requests: ReadonlyArray<{ similarMemories: readonly Fact[] }>): {
    uuidToIndex: Map<string, string>;
    indexToUuid: Map<string, string>;
  } {
    const uuidToIndex = new Map<string, string>();
    const indexToUuid = new Map<string, string>();
    let nextIndex = 0;
    for (const request of requests) {
      for (const memory of request.similarMemories) {
        if (typeof memory.id === 'string' && !uuidToIndex.has(memory.id)) {
          const idx = String(nextIndex);
          uuidToIndex.set(memory.id, idx);
          indexToUuid.set(idx, memory.id);
          nextIndex += 1;
        }
      }
    }

    return { uuidToIndex, indexToUuid };
  }

  private formatSimilarMemories(
    similarMemories: readonly Fact[],
    uuidToIndex: ReadonlyMap<string, string>,
  ): string {
    return similarMemories
      .map((memory) => {
        const displayId =
          (typeof memory.id === 'string' && uuidToIndex.get(memory.id)) ?? 'unknown';
        return `Memory [id: ${displayId}]: ${JSON.stringify(memory.text)}`;
      })
      .join('\n');
  }

  private async callWithRetry(
    prompt: string,
    maxTokens: number,
    validTargetIds: ReadonlySet<string>,
    validFactIndices: ReadonlySet<number>,
  ): Promise<ConsolidationResult[]> {
    const systemPrompt = this.systemPrompt ?? buildConsolidationPrompt();

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.client.generate<ConsolidationDecisionsResponse>({
          systemPrompt,
          userPrompt: prompt,
          schema: CONSOLIDATION_SCHEMA,
          maxTokens,
        });

        return this.parseBatchResponse(response, validTargetIds, validFactIndices);
      } catch (error: unknown) {
        if (!this.isRetryableError(error) || attempt === this.maxRetries) {
          throw error;
        }

        const delayMs = this.baseDelayMs * Math.pow(2, attempt);
        await this.delay(delayMs);
      }
    }

    throw new ConsolidationError('Unreachable code path in callWithRetry');
  }

  private async delay(milliseconds: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof ConsolidationError) {
      if (error.message === 'Consolidator batch response missing decisions array.') {
        return true;
      }
      if (error.message === 'Consolidator response payload is invalid.') {
        return true;
      }
      return false;
    }

    if (error instanceof AppError) {
      return true;
    }

    return false;
  }

  private parseBatchResponse(
    response: ConsolidationDecisionsResponse,
    validTargetIds: ReadonlySet<string>,
    validFactIndices: ReadonlySet<number>,
  ): ConsolidationResult[] {
    if (!response || !Array.isArray(response.decisions)) {
      throw new ConsolidationError('Consolidator batch response missing decisions array.');
    }

    return (response.decisions as unknown[]).map((decision: unknown) => {
      const validated = this.validatePayload(decision);
      if (!validFactIndices.has(validated.factIndex)) {
        throw new ConsolidationError(
          `Consolidator batch response contains out-of-range factIndex: ${validated.factIndex}`,
        );
      }

      return this.applyPostValidation(validated, validTargetIds);
    });
  }

  private validatePayload(payload: unknown): ConsolidationResult {
    if (typeof payload !== 'object' || payload === null) {
      throw new ConsolidationError('Consolidator response payload is invalid.');
    }

    const typed = payload as {
      action?: unknown;
      mergedText?: unknown;
      targetMemoryId?: unknown;
      factIndex?: unknown;
      supersessionReason?: unknown;
      validUntil?: unknown;
    };

    if (!this.isAction(typed.action)) {
      throw new ConsolidationError('Consolidator payload action is invalid.');
    }

    if (
      typed.mergedText !== undefined &&
      typed.mergedText !== null &&
      typeof typed.mergedText !== 'string'
    ) {
      throw new ConsolidationError(
        'Consolidator payload mergedText must be a string when present.',
      );
    }

    if (typeof typed.factIndex !== 'number') {
      throw new ConsolidationError('Consolidator payload factIndex must be a number.');
    }

    return {
      action: typed.action,
      mergedText: typeof typed.mergedText === 'string' ? typed.mergedText : undefined,
      targetMemoryId: typeof typed.targetMemoryId === 'string' ? typed.targetMemoryId : undefined,
      factIndex: typed.factIndex,
      supersessionReason:
        typeof typed.supersessionReason === 'string' ? typed.supersessionReason : undefined,
      validUntil: typeof typed.validUntil === 'string' ? typed.validUntil : undefined,
    };
  }

  private applyPostValidation(
    result: ConsolidationResult,
    validTargetIds: ReadonlySet<string>,
  ): ConsolidationResult {
    if (result.action !== 'UPDATE' && result.action !== 'DELETE' && result.action !== 'SUPERSEDE') {
      return result;
    }

    if (result.action === 'SUPERSEDE') {
      if (typeof result.targetMemoryId !== 'string' || !validTargetIds.has(result.targetMemoryId)) {
        return {
          ...result,
          action: 'ADD',
          targetMemoryId: undefined,
          supersessionReason: undefined,
        };
      }

      if (typeof result.mergedText !== 'string') {
        return {
          ...result,
          action: 'ADD',
          targetMemoryId: undefined,
          supersessionReason: undefined,
        };
      }

      if (typeof result.supersessionReason !== 'string') {
        return {
          ...result,
          action: 'ADD',
          targetMemoryId: undefined,
          supersessionReason: undefined,
        };
      }

      return result;
    }

    if (typeof result.targetMemoryId === 'string' && validTargetIds.has(result.targetMemoryId)) {
      return result;
    }

    if (result.action === 'UPDATE') {
      return { ...result, action: 'ADD', targetMemoryId: undefined };
    }

    return { ...result, action: 'NOOP', targetMemoryId: undefined };
  }

  private isAction(value: unknown): value is ConsolidationAction {
    return (
      value === 'ADD' ||
      value === 'UPDATE' ||
      value === 'DELETE' ||
      value === 'NOOP' ||
      value === 'SUPERSEDE'
    );
  }
}

export const createConsolidator = (
  client: LlmClient,
  config: ConsolidatorConfig = {},
): Consolidator => new LocalConsolidator(client, config);
