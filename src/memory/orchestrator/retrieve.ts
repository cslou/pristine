import type { PipelineContext, PipelineStep } from './types.js';
import type { AnalyzedQuery, RetrieveResult, TemporalMode } from '../../core/types.js';
import type { QueryAnalyzer, Retriever } from '../../core/interfaces.js';
import { OrchestratorError } from '../../core/errors.js';

// ---------------------------------------------------------------------------
// Retrieve context shape
// ---------------------------------------------------------------------------

interface RetrieveContext extends PipelineContext {
  query?: string;
  userId?: string;
  topK?: number;
  temporalMode?: TemporalMode;
  asOf?: string;
  analyzedQuery?: AnalyzedQuery;
  retrieveResult?: RetrieveResult;
}

export interface RetrieveDependencies {
  readonly queryAnalyzer: QueryAnalyzer;
  readonly retriever: Retriever;
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.length > 0;
};

const readQuery = (context: RetrieveContext): string => {
  if (!isNonEmptyString(context.query)) {
    throw new OrchestratorError('Retrieve pipeline requires query.');
  }
  return context.query;
};

const readUserId = (context: RetrieveContext): string => {
  if (!isNonEmptyString(context.userId)) {
    throw new OrchestratorError('Retrieve pipeline requires userId.');
  }
  return context.userId;
};

const readRequestedTopK = (context: RetrieveContext, analyzedQuery: AnalyzedQuery): number => {
  if (typeof context.topK === 'number' && Number.isInteger(context.topK) && context.topK > 0) {
    return context.topK;
  }
  return analyzedQuery.suggestedTopK;
};

// ---------------------------------------------------------------------------
// Pipeline factory
// ---------------------------------------------------------------------------

export const createRetrievePipeline = (dependencies: RetrieveDependencies): PipelineStep[] => {
  const { queryAnalyzer, retriever } = dependencies;

  const analyzeQueryStep: PipelineStep = {
    name: 'analyze',
    execute: async (context: PipelineContext): Promise<PipelineContext> => {
      const retrieveContext = context as RetrieveContext;
      const userId = readUserId(retrieveContext);
      const query = readQuery(retrieveContext);

      return {
        ...context,
        analyzedQuery: await queryAnalyzer.analyzeQuery(query, { userId }),
      };
    },
  };

  const retrieveStep: PipelineStep = {
    name: 'retrieve',
    execute: async (context: PipelineContext): Promise<PipelineContext> => {
      const retrieveContext = context as RetrieveContext;
      const userId = readUserId(retrieveContext);
      const analyzedQuery = retrieveContext.analyzedQuery;

      if (!analyzedQuery) {
        throw new OrchestratorError('Analyze step must run before retrieve.');
      }

      const topK = readRequestedTopK(retrieveContext, analyzedQuery);
      const result: RetrieveResult = await retriever.retrieve(
        analyzedQuery.rewrittenQuery,
        userId,
        {
          topK,
          temporalMode: retrieveContext.temporalMode,
          asOf: retrieveContext.asOf,
        },
      );

      return {
        ...context,
        retrieveResult: result,
      };
    },
  };

  return [analyzeQueryStep, retrieveStep];
};
