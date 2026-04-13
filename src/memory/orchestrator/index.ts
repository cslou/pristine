import type {
  ConsolidationResult,
  Fact,
  IngestOptions,
  IngestResult,
  Message,
  PipelineContext,
  PipelineStep,
  RetrieveOptions,
  RetrieveResult,
  StepError,
} from '../../core/types.js';
import type { Orchestrator } from '../../core/interfaces.js';
import type { OrchestratorConfig } from './types.js';
import { OrchestratorError } from '../../core/errors.js';
import { createPipelineRunner } from './pipeline.js';
import { createIngestPipeline } from './ingest.js';
import { createRetrievePipeline } from './retrieve.js';

// ---------------------------------------------------------------------------
// Context readers (safe extraction from untyped pipeline context)
// ---------------------------------------------------------------------------

const asFacts = (context: PipelineContext): Fact[] => {
  return Array.isArray(context.facts) ? (context.facts as Fact[]) : [];
};

const asDecisions = (context: PipelineContext): ConsolidationResult[] => {
  return Array.isArray(context.decisions) ? (context.decisions as ConsolidationResult[]) : [];
};

const asMemoryIds = (context: PipelineContext): string[] => {
  return Array.isArray(context.memoryIds) ? (context.memoryIds as string[]) : [];
};

const asStepErrors = (context: PipelineContext): StepError[] => {
  return Array.isArray(context.stepErrors) ? (context.stepErrors as StepError[]) : [];
};

const asRetrieveResult = (context: PipelineContext): RetrieveResult => {
  if (context.retrieveResult && typeof context.retrieveResult === 'object') {
    return context.retrieveResult as RetrieveResult;
  }
  throw new OrchestratorError('Retrieve pipeline failed to produce a result.');
};

const buildIngestResult = (context: PipelineContext): Omit<IngestResult, 'errors'> => {
  return {
    facts: asFacts(context),
    decisions: asDecisions(context),
    memoryIds: asMemoryIds(context),
  };
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createOrchestrator = (config: OrchestratorConfig): Orchestrator => {
  const ingestPipeline = createPipelineRunner(
    createIngestPipeline({
      extractor: config.extractor,
      embedder: config.embedder,
      store: config.store,
      consolidator: config.consolidator,
      conversationStore: config.conversationStore,
      includeResolveInTurnOrder: false,
    }),
  );

  if (config.appControlledResolve === false) {
    const resolveStep: PipelineStep = {
      name: 'resolve',
      execute: async (context: PipelineContext): Promise<PipelineContext> => {
        return context;
      },
    };
    ingestPipeline.registerStep(resolveStep);
  }

  const retrievePipeline = createPipelineRunner(
    createRetrievePipeline({
      queryAnalyzer: config.queryAnalyzer,
      retriever: config.retriever,
    }),
  );

  const ingest = async (
    conversation: readonly Message[],
    userId: string,
    _options: IngestOptions = {},
  ): Promise<IngestResult> => {
    const result = await ingestPipeline.run({ conversation, userId, ..._options });

    const stepErrors = asStepErrors(result.context);
    const pipelineErrors: StepError[] = result.error ? [result.error, ...stepErrors] : stepErrors;

    return {
      ...buildIngestResult(result.context),
      errors: pipelineErrors,
    };
  };

  const retrieve = async (
    query: string,
    userId: string,
    options?: RetrieveOptions,
  ): Promise<RetrieveResult> => {
    const result = await retrievePipeline.run({
      query,
      userId,
      topK: options?.topK,
      temporalMode: options?.temporalMode,
      asOf: options?.asOf,
    });

    if (result.error) {
      throw new OrchestratorError(
        `Pipeline step "${result.error.step}" failed: ${result.error.error}`,
      );
    }

    return asRetrieveResult(result.context);
  };

  const store = async (conversation: readonly Message[], userId: string): Promise<IngestResult> => {
    return ingest(conversation, userId);
  };

  const search = async (query: string, userId: string, topK?: number): Promise<RetrieveResult> => {
    return retrieve(query, userId, topK !== undefined ? { topK } : undefined);
  };

  return {
    ingest,
    retrieve,
    store,
    search,
    ingestSteps: ingestPipeline.steps,
    retrieveSteps: retrievePipeline.steps,
    registerIngestStep: (step: PipelineStep) => ingestPipeline.registerStep(step),
    registerRetrieveStep: (step: PipelineStep) => retrievePipeline.registerStep(step),
  };
};
