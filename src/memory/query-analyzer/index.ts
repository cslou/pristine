import type { LlmClient, QueryAnalyzer } from '../../core/interfaces.js';
import type { AnalyzedQuery, QueryContext, QueryIntent } from '../../core/types.js';
import { AppError } from '../../core/errors.js';
import { assertNoLlmReentry } from '../../privacy/sanitizer/index.js';
import { buildQueryAnalysisPrompt } from './prompts.js';
import { QUERY_ANALYSIS_SCHEMA } from './schema.js';

const DEFAULT_MAX_TOKENS = 600;
const DEFAULT_SUGGESTED_TOP_K = 10;

export interface QueryAnalyzerConfig {
  readonly maxTokens?: number;
  readonly systemPrompt?: string;
}

interface QueryAnalysisResponse {
  readonly intent?: unknown;
  readonly filters?: unknown;
  readonly suggestedTopK?: unknown;
  readonly rewrittenQuery?: unknown;
}

const isQueryIntent = (value: unknown): value is QueryIntent =>
  value === 'factual_lookup' || value === 'contextual_search' || value === 'temporal_query';

class LocalQueryAnalyzer implements QueryAnalyzer {
  private readonly client: LlmClient;
  private readonly maxTokens: number;
  private readonly systemPrompt: string | undefined;

  public constructor(client: LlmClient, config: QueryAnalyzerConfig = {}) {
    this.client = client;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.systemPrompt = config.systemPrompt;
  }

  public async analyzeQuery(query: string, context?: QueryContext): Promise<AnalyzedQuery> {
    assertNoLlmReentry(query, 'query analyzer query');
    if (context) {
      assertNoLlmReentry(context, 'query analyzer context');
    }

    if (query.length === 0) {
      return this.createFallbackResult(query);
    }

    try {
      const systemPrompt = this.systemPrompt ?? buildQueryAnalysisPrompt();
      const userPrompt = this.createPrompt(query, context);

      const response = await this.client.generate<QueryAnalysisResponse>({
        systemPrompt,
        userPrompt,
        schema: QUERY_ANALYSIS_SCHEMA,
        maxTokens: this.maxTokens,
      });

      return this.validatePayload(response);
    } catch {
      return this.createFallbackResult(query);
    }
  }

  private createPrompt(query: string, context?: QueryContext): string {
    if (!context) {
      return query;
    }

    return [
      `query: ${JSON.stringify(query)}`,
      `userId: ${context.userId ?? 'undefined'}`,
      `conversationHistory: ${JSON.stringify(context.conversationHistory ?? [])}`,
    ].join('\n');
  }

  private validatePayload(payload: unknown): AnalyzedQuery {
    if (typeof payload !== 'object' || payload === null) {
      throw new AppError('Query analyzer response payload is invalid.');
    }

    const typed = payload as QueryAnalysisResponse;

    if (!isQueryIntent(typed.intent)) {
      throw new AppError('Query analyzer payload intent is invalid.');
    }

    if (
      typeof typed.suggestedTopK !== 'number' ||
      !Number.isFinite(typed.suggestedTopK) ||
      typed.suggestedTopK <= 0
    ) {
      throw new AppError('Query analyzer payload suggestedTopK must be a positive finite number.');
    }

    if (typeof typed.rewrittenQuery !== 'string' || typed.rewrittenQuery.length === 0) {
      throw new AppError('Query analyzer payload rewrittenQuery must be a non-empty string.');
    }

    const filters = this.validateFilters(typed.filters);

    return {
      intent: typed.intent,
      filters,
      suggestedTopK: typed.suggestedTopK,
      rewrittenQuery: typed.rewrittenQuery,
    };
  }

  private validateFilters(filters: unknown): AnalyzedQuery['filters'] {
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
      return {};
    }

    const typed = filters as Record<string, unknown>;
    const result: {
      topic?: string;
      timeRange?: { start?: string; end?: string };
      agentScope?: string;
    } = {};

    if (typeof typed.topic === 'string') {
      const trimmed = typed.topic.trim();
      if (trimmed.length > 0) {
        result.topic = trimmed;
      }
    }

    if (typeof typed.agentScope === 'string') {
      const trimmed = typed.agentScope.trim();
      if (trimmed.length > 0) {
        result.agentScope = trimmed;
      }
    }

    if (
      typeof typed.timeRange === 'object' &&
      typed.timeRange !== null &&
      !Array.isArray(typed.timeRange)
    ) {
      const tr = typed.timeRange as Record<string, unknown>;
      const start = typeof tr.start === 'string' ? tr.start : undefined;
      const end = typeof tr.end === 'string' ? tr.end : undefined;
      if (start !== undefined || end !== undefined) {
        result.timeRange = { start, end };
      }
    }

    return result;
  }

  private createFallbackResult(query: string): AnalyzedQuery {
    return {
      intent: 'contextual_search',
      filters: {},
      suggestedTopK: DEFAULT_SUGGESTED_TOP_K,
      rewrittenQuery: query,
    };
  }
}

export const createQueryAnalyzer = (
  client: LlmClient,
  config: QueryAnalyzerConfig = {},
): QueryAnalyzer => new LocalQueryAnalyzer(client, config);
