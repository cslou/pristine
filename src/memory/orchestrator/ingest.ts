import { createHash } from 'node:crypto';
import type { PipelineContext, PipelineStep } from './types.js';
import type {
  AddMemoryInput,
  ConsolidationBatchResult,
  ConsolidationResult,
  Fact,
  Memory,
  Message,
  StepError,
} from '../../core/types.js';
import type { Consolidator, Embedder, Extractor, Store } from '../../core/interfaces.js';
import type { ConversationStore } from '../../conversations/store.js';
import { OrchestratorError } from '../../core/errors.js';
import { getTurnOrderForMode, type TurnStep, validateTurnOrder } from './turn-order.js';
import { validateTemporalFields } from '../temporal/index.js';
import { chunkConversation } from './chunker.js';

const SIMILARITY_TOP_K = 10;

const ASSISTANT_PRE_REVEAL_MEMORY_ORIGIN = 'assistant_pre_reveal';

// ---------------------------------------------------------------------------
// Ingest context shape
// ---------------------------------------------------------------------------

interface IngestContext extends PipelineContext {
  conversation?: readonly Message[];
  userId?: string;
  referenceTimestamp?: string;
  facts?: Fact[];
  factEmbeddings?: number[][];
  similarFacts?: Fact[][];
  decisions?: ConsolidationResult[];
  idRemap?: ReadonlyMap<string, string>;
  memoryIds?: string[];
  turnOrder?: TurnStep[];
  sourceConversationId?: string;
  stepErrors?: StepError[];
  duplicateDetected?: boolean;
}

export interface IngestDependencies {
  readonly extractor: Extractor;
  readonly embedder: Embedder;
  readonly store: Store;
  readonly consolidator: Consolidator;
  readonly conversationStore: ConversationStore;
  readonly includeResolveInTurnOrder?: boolean;
}

// ---------------------------------------------------------------------------
// Context helpers (safe type-narrowing readers)
// ---------------------------------------------------------------------------

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.length > 0;
};

const readConversation = (context: IngestContext): readonly Message[] => {
  return context.conversation ?? [];
};

const readUserId = (context: IngestContext): string => {
  if (!isNonEmptyString(context.userId)) {
    throw new OrchestratorError('Ingest pipeline requires userId.');
  }
  return context.userId;
};

const readFacts = (context: IngestContext): Fact[] => {
  return Array.isArray(context.facts) ? context.facts : [];
};

const readEmbeddings = (context: IngestContext): number[][] => {
  return Array.isArray(context.factEmbeddings) ? context.factEmbeddings : [];
};

const readSimilarFacts = (context: IngestContext): Fact[][] => {
  return Array.isArray(context.similarFacts) ? context.similarFacts : [];
};

const readDecisions = (context: IngestContext): ConsolidationResult[] => {
  return Array.isArray(context.decisions) ? context.decisions : [];
};

const readTurnOrder = (context: IngestContext): TurnStep[] => {
  return Array.isArray(context.turnOrder) ? context.turnOrder : [];
};

const readStepErrors = (context: IngestContext): StepError[] => {
  return Array.isArray(context.stepErrors) ? context.stepErrors : [];
};

const isDuplicate = (context: IngestContext): boolean => {
  return context.duplicateDetected === true;
};

export const deriveTimestamp = (messages: readonly Message[]): string | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const ts = messages[i]?.timestamp;
    if (typeof ts === 'string' && ts.length > 0) {
      return ts;
    }
  }
  return undefined;
};

const appendTurnOrder = (context: IngestContext, step: TurnStep): IngestContext => {
  return {
    ...context,
    turnOrder: [...readTurnOrder(context), step],
  };
};

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

const isDuplicateKeyError = (error: unknown): boolean => {
  if (error instanceof Error) {
    return error.message.includes('UNIQUE constraint failed');
  }
  return false;
};

const memoryTextFromDecision = (fact: Fact, decision: ConsolidationResult): string => {
  if (typeof decision.mergedText === 'string') {
    return decision.mergedText;
  }
  return fact.text;
};

const mapMemoryToFact = (memory: Memory): Fact => {
  return {
    id: memory.id,
    text: memory.text,
    sourceConversationId: memory.sourceConversationId,
    metadata: memory.metadata,
    validFrom: memory.validFrom,
    validUntil: memory.validUntil,
  };
};

const toMemoryInput = (
  userId: string,
  fact: Fact,
  text: string,
  embedding: number[],
  sourceConversationId?: string,
): AddMemoryInput => {
  return {
    userId,
    text,
    embedding,
    contentHash: createHash('sha256').update(text).digest('hex'),
    sourceConversationId: sourceConversationId ?? fact.sourceConversationId,
    metadata: {
      ...fact.metadata,
      memory_origin: ASSISTANT_PRE_REVEAL_MEMORY_ORIGIN,
    },
    validFrom: fact.validFrom,
    validUntil: fact.validUntil,
  };
};

// ---------------------------------------------------------------------------
// Store decision execution
// ---------------------------------------------------------------------------

const createStoreDecision = async (
  fact: Fact,
  decision: ConsolidationResult,
  userId: string,
  embedding: number[],
  store: Store,
  embedder: Embedder,
  sourceConversationId?: string,
): Promise<string> => {
  const text = memoryTextFromDecision(fact, decision);

  if (decision.action === 'ADD') {
    const memory = await store.addMemory(
      toMemoryInput(userId, fact, text, embedding, sourceConversationId),
    );
    return memory.id;
  }

  if (decision.action === 'UPDATE') {
    if (!isNonEmptyString(decision.targetMemoryId)) {
      throw new OrchestratorError('UPDATE action requires targetMemoryId.');
    }

    const contentHash = createHash('sha256').update(text).digest('hex');
    try {
      const memory = await store.updateMemory(
        decision.targetMemoryId,
        { text, embedding, contentHash },
        userId,
      );
      return memory.id;
    } catch (updateError: unknown) {
      if (isDuplicateKeyError(updateError)) {
        const memory = await store.addMemory(
          toMemoryInput(userId, fact, text, embedding, sourceConversationId),
        );
        return memory.id;
      }
      throw updateError;
    }
  }

  if (decision.action === 'SUPERSEDE') {
    if (
      !isNonEmptyString(decision.targetMemoryId) ||
      !isNonEmptyString(decision.mergedText) ||
      !isNonEmptyString(decision.supersessionReason)
    ) {
      throw new OrchestratorError(
        'SUPERSEDE action requires targetMemoryId, mergedText, and supersessionReason.',
      );
    }

    const supersedeEmbedding = await embedder.embed(decision.mergedText);
    const newMemoryInput = toMemoryInput(
      userId,
      fact,
      decision.mergedText,
      supersedeEmbedding,
      sourceConversationId,
    );

    const result = await store.supersedeMemory(
      decision.targetMemoryId,
      newMemoryInput,
      decision.supersessionReason,
      decision.validUntil,
    );
    return result.newMemory.id;
  }

  if (decision.action === 'DELETE') {
    if (!isNonEmptyString(decision.targetMemoryId)) {
      throw new OrchestratorError('DELETE action requires targetMemoryId.');
    }

    await store.deleteMemory(decision.targetMemoryId, userId);
    const memory = await store.addMemory(
      toMemoryInput(userId, fact, text, embedding, sourceConversationId),
    );
    return memory.id;
  }

  // NOOP — handled by caller, but defensive return
  return '';
};

// ---------------------------------------------------------------------------
// Turn-order validation step
// ---------------------------------------------------------------------------

const validateConversationTurnOrder = (
  context: IngestContext,
  expectedTurnOrder: readonly TurnStep[],
): void => {
  if (readConversation(context).length === 0) {
    return;
  }
  validateTurnOrder(readTurnOrder(context), expectedTurnOrder);
};

// ---------------------------------------------------------------------------
// Pipeline factory
// ---------------------------------------------------------------------------

export const createIngestPipeline = (dependencies: IngestDependencies): PipelineStep[] => {
  const { extractor, embedder, store, consolidator, conversationStore, includeResolveInTurnOrder } =
    dependencies;
  const expectedTurnOrder = getTurnOrderForMode(includeResolveInTurnOrder ?? false);

  const storeUserStep: PipelineStep = {
    name: 'storeUser',
    execute: async (context: PipelineContext): Promise<PipelineContext> => {
      const ingestContext = context as IngestContext;
      const conversation = readConversation(ingestContext);
      if (conversation.length === 0) {
        return context;
      }

      // If sourceConversationId is already provided (e.g., from IngestQueue),
      // skip conversation storage — it was persisted during enqueue().
      if (isNonEmptyString(ingestContext.sourceConversationId)) {
        return appendTurnOrder(ingestContext, 'store(user)');
      }

      const userId = readUserId(ingestContext);

      try {
        const conversationId = conversationStore.addConversation(conversation, userId);

        return appendTurnOrder(
          {
            ...context,
            sourceConversationId: conversationId,
          },
          'store(user)',
        );
      } catch (error: unknown) {
        if (isDuplicateKeyError(error)) {
          return { ...context, duplicateDetected: true };
        }
        throw error;
      }
    },
  };

  const extractFactsStep: PipelineStep = {
    name: 'extract',
    execute: async (context: PipelineContext): Promise<PipelineContext> => {
      const ingestContext = context as IngestContext;
      if (isDuplicate(ingestContext)) return context;
      const messages = readConversation(ingestContext);
      const refTimestamp =
        ingestContext.referenceTimestamp ?? deriveTimestamp(messages) ?? new Date().toISOString();
      const chunks = chunkConversation(messages);
      const extractions = await Promise.all(
        chunks.map((chunk) => extractor.extract(chunk, refTimestamp)),
      );
      const allFacts = extractions.flatMap((result) => result.facts);

      const validatedFacts = allFacts.map((fact) =>
        validateTemporalFields(fact, { referenceTimestamp: refTimestamp }),
      );

      return {
        ...context,
        facts: validatedFacts,
      };
    },
  };

  const embedStep: PipelineStep = {
    name: 'embed',
    execute: async (context: PipelineContext): Promise<PipelineContext> => {
      const ingestContext = context as IngestContext;
      if (isDuplicate(ingestContext)) return context;
      const facts = readFacts(ingestContext);
      const embeddings = await Promise.all(facts.map((fact: Fact) => embedder.embed(fact.text)));
      return {
        ...context,
        factEmbeddings: embeddings,
      };
    },
  };

  const searchStep: PipelineStep = {
    name: 'searchSimilar',
    execute: async (context: PipelineContext): Promise<PipelineContext> => {
      const ingestContext = context as IngestContext;
      if (isDuplicate(ingestContext)) return context;
      const embeddings = readEmbeddings(ingestContext);
      const userId = readUserId(ingestContext);
      const similarFacts = await Promise.all(
        embeddings.map((embedding: number[]) =>
          store
            .searchSimilar({
              embedding,
              limit: SIMILARITY_TOP_K,
              userId,
            })
            .then((memories: Memory[]) =>
              memories.map((memory: Memory) => mapMemoryToFact(memory)),
            ),
        ),
      );

      return appendTurnOrder(
        {
          ...context,
          similarFacts,
        },
        'search',
      );
    },
  };

  const consolidateStep: PipelineStep = {
    name: 'consolidate',
    execute: async (context: PipelineContext): Promise<PipelineContext> => {
      const ingestContext = context as IngestContext;
      if (isDuplicate(ingestContext)) return context;
      const facts = readFacts(ingestContext);
      const similarFacts = readSimilarFacts(ingestContext);

      const batchRequests = facts.map((fact: Fact, index: number) => ({
        newFact: fact,
        similarMemories: similarFacts[index] ?? [],
      }));

      const batchResult: ConsolidationBatchResult =
        await consolidator.consolidateBatch(batchRequests);

      return appendTurnOrder(
        {
          ...context,
          decisions: batchResult.results,
          idRemap: batchResult.idRemap,
        },
        'LLM',
      );
    },
  };

  const storeStep: PipelineStep = {
    name: 'store',
    execute: async (context: PipelineContext): Promise<PipelineContext> => {
      const ingestContext = context as IngestContext;
      if (isDuplicate(ingestContext)) return context;
      const facts = readFacts(ingestContext);
      const decisions = readDecisions(ingestContext);
      const embeddings = readEmbeddings(ingestContext);
      const userId = readUserId(ingestContext);
      const idRemap = ingestContext.idRemap;

      const memoryIds: string[] = [];
      const sourceConversationId = ingestContext.sourceConversationId;
      const stepErrors = [...readStepErrors(ingestContext)];

      for (let index = 0; index < facts.length; index += 1) {
        const fact = facts[index];
        const decision = decisions[index];
        if (!fact || !decision) {
          memoryIds.push('');
          continue;
        }

        if (decision.action === 'NOOP') {
          memoryIds.push('');
          continue;
        }

        // Resolve integer-indexed targetMemoryId back to real UUID
        const resolvedDecision =
          typeof decision.targetMemoryId === 'string' && idRemap
            ? {
                ...decision,
                targetMemoryId: idRemap.get(decision.targetMemoryId) ?? decision.targetMemoryId,
              }
            : decision;

        const embedding = embeddings[index] ?? [];
        try {
          const memoryId = await createStoreDecision(
            fact,
            resolvedDecision,
            userId,
            embedding,
            store,
            embedder,
            sourceConversationId,
          );
          if (memoryId.length > 0) {
            memoryIds.push(memoryId);
          }
        } catch (decisionError: unknown) {
          stepErrors.push({
            step: 'store',
            error:
              decisionError instanceof Error
                ? `Fact ${index} (${resolvedDecision.action}): ${decisionError.message}`
                : String(decisionError),
          });
        }
      }

      return appendTurnOrder(
        {
          ...context,
          memoryIds,
          decisions: readDecisions(ingestContext),
          facts: readFacts(ingestContext),
          factEmbeddings: readEmbeddings(ingestContext),
          similarFacts: readSimilarFacts(ingestContext),
          stepErrors,
        } as IngestContext,
        'store(assistant_pre_reveal)',
      );
    },
  };

  const validateTurnOrderStep: PipelineStep = {
    name: 'validate-turn-order',
    execute: async (context: PipelineContext): Promise<PipelineContext> => {
      if (isDuplicate(context as IngestContext)) return context;
      validateConversationTurnOrder(context as IngestContext, expectedTurnOrder);
      return context;
    },
  };

  return [
    storeUserStep,
    extractFactsStep,
    embedStep,
    searchStep,
    consolidateStep,
    storeStep,
    validateTurnOrderStep,
  ];
};
