import { describe, expect, it, vi } from 'vitest';
import type {
  AddMemoryInput,
  ConsolidationBatchResult,
  ConsolidationResult,
  ExtractionResult,
  Fact,
  Memory,
  Message,
  SupersedeMemoryResult,
  UpdateMemoryInput,
} from '../../../src/core/types.js';
import type { Consolidator, Embedder, Extractor, Store } from '../../../src/core/interfaces.js';
import type { ConversationStore } from '../../../src/conversations/store.js';
import {
  createIngestPipeline,
  deriveTimestamp,
  type IngestDependencies,
} from '../../../src/memory/orchestrator/ingest.js';
import { createPipelineRunner } from '../../../src/memory/orchestrator/pipeline.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stubMemory = (overrides: Partial<Memory> = {}): Memory => ({
  id: 'mem-1',
  userId: 'user-1',
  text: 'memory text',
  embedding: [0.1],
  contentHash: 'hash-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastAccessed: '2026-01-01T00:00:00.000Z',
  metadata: {},
  isDeleted: false,
  ...overrides,
});

const createDeps = (): IngestDependencies & {
  extractor: Extractor;
  embedder: Embedder;
  store: Store;
  consolidator: Consolidator;
  conversationStore: ConversationStore;
} => {
  const extractor: Extractor = {
    extract: vi.fn(
      async (
        _conversation: readonly Message[],
        _referenceTimestamp: string,
      ): Promise<ExtractionResult> => ({
        facts: [{ text: 'fact one' }],
      }),
    ),
  };

  const embedder: Embedder = {
    embed: vi.fn(async () => [0.1, 0.2]),
    embedBatch: vi.fn(async (texts: readonly string[]) => texts.map(() => [0.1, 0.2])),
  };

  const store: Store = {
    addMemory: vi.fn(async (input: AddMemoryInput) =>
      stubMemory({
        id: `mem-${Math.random().toString(36).slice(2, 8)}`,
        userId: input.userId,
        text: input.text,
        embedding: input.embedding,
        contentHash: input.contentHash,
        sourceConversationId: input.sourceConversationId,
        metadata: input.metadata ?? {},
      }),
    ),
    getMemory: vi.fn(async () => null),
    searchSimilar: vi.fn(async () => []),
    updateMemory: vi.fn(async (id: string, updates: UpdateMemoryInput, userId: string) =>
      stubMemory({
        id,
        userId,
        text: updates.text ?? 'updated',
        embedding: updates.embedding ?? [0.1],
      }),
    ),
    deleteMemory: vi.fn(async () => undefined),
    supersedeMemory: vi.fn(
      async (
        _oldId: string,
        newMemory: AddMemoryInput,
        _reason: string,
      ): Promise<SupersedeMemoryResult> => ({
        oldMemory: stubMemory({ id: _oldId }),
        newMemory: stubMemory({
          id: `supersede-${Math.random().toString(36).slice(2, 8)}`,
          text: newMemory.text,
        }),
      }),
    ),
    getSupersessionChain: vi.fn(async () => []),
    clearAll: vi.fn(async () => undefined),
  };

  const consolidator: Consolidator = {
    consolidate: vi.fn(async (): Promise<ConsolidationResult> => ({ action: 'ADD', factIndex: 0 })),
    consolidateBatch: vi.fn(
      async (): Promise<ConsolidationBatchResult> => ({
        results: [{ action: 'ADD', factIndex: 0 }],
        idRemap: new Map(),
      }),
    ),
  };

  const conversationStore = {
    addConversation: vi.fn((): string => `conv-${Math.random().toString(36).slice(2, 8)}`),
    getConversation: vi.fn(() => null),
    searchConversations: vi.fn(() => []),
  } as unknown as ConversationStore;

  return { extractor, embedder, store, consolidator, conversationStore };
};

const conversation: readonly Message[] = [{ role: 'user', content: 'User likes tea.' }];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ingest pipeline', () => {
  describe('step ordering', () => {
    it('produces 7 pipeline steps in the correct order', () => {
      const deps = createDeps();
      const steps = createIngestPipeline(deps);
      expect(steps).toHaveLength(7);
      expect(steps.map((s) => s.name)).toEqual([
        'storeUser',
        'extract',
        'embed',
        'searchSimilar',
        'consolidate',
        'store',
        'validate-turn-order',
      ]);
    });

    it('executes all steps in order without error', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({
        userId: 'user-1',
        conversation,
      });
      expect(result.error).toBeUndefined();
    });
  });

  describe('context threading', () => {
    it('passes extracted facts through to embedding', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      await pipeline.run({ userId: 'user-1', conversation });

      expect(deps.embedder.embed).toHaveBeenCalled();
    });

    it('passes embeddings to search step', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      await pipeline.run({ userId: 'user-1', conversation });

      expect(deps.store.searchSimilar).toHaveBeenCalledWith(
        expect.objectContaining({
          embedding: expect.any(Array) as number[],
          userId: 'user-1',
        }),
      );
    });

    it('passes similar facts to consolidator', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      await pipeline.run({ userId: 'user-1', conversation });

      expect(deps.consolidator.consolidateBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            newFact: expect.objectContaining({ text: expect.any(String) as string }) as Fact,
            similarMemories: expect.any(Array) as Fact[],
          }),
        ]),
      );
    });

    it('stores memories after consolidation decisions', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      await pipeline.run({ userId: 'user-1', conversation });

      // At least one addMemory call for the ADD decision (no user_raw)
      expect(vi.mocked(deps.store.addMemory).mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('tracks source conversation ID on all stored memories', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ userId: 'user-1', conversation });

      const contextConvId = result.context.sourceConversationId as string;
      expect(contextConvId).toBeDefined();
      expect(typeof contextConvId).toBe('string');

      // sourceConversationId comes from conversationStore.addConversation
      expect(deps.conversationStore.addConversation).toHaveBeenCalled();

      // Fact-level addMemory carries the conversationId
      const addMemoryCalls = vi.mocked(deps.store.addMemory).mock.calls;
      expect(addMemoryCalls[0]?.[0]?.sourceConversationId).toBe(contextConvId);
    });

    it('returns memory IDs from store decisions', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ userId: 'user-1', conversation });

      const memoryIds = result.context.memoryIds as string[];
      expect(memoryIds).toBeDefined();
      expect(memoryIds.length).toBeGreaterThan(0);
    });
  });

  describe('storeUser step', () => {
    it('stores conversation in ConversationStore', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      await pipeline.run({ userId: 'user-1', conversation });

      expect(deps.conversationStore.addConversation).toHaveBeenCalledWith(conversation, 'user-1');
    });

    it('sets sourceConversationId from ConversationStore return value', async () => {
      const deps = createDeps();
      vi.mocked(deps.conversationStore.addConversation).mockReturnValueOnce('conv-fixed-id');

      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ userId: 'user-1', conversation });

      expect(result.context.sourceConversationId).toBe('conv-fixed-id');
    });

    it('skips conversation store when conversation is empty', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ userId: 'user-1', conversation: [] });

      expect(result.error).toBeUndefined();
      expect(deps.conversationStore.addConversation).not.toHaveBeenCalled();
    });

    it('skips entire pipeline on duplicate conversation', async () => {
      const deps = createDeps();
      const sqliteError = new Error(
        'UNIQUE constraint failed: conversations.user_id, conversations.content_hash',
      );
      vi.mocked(deps.conversationStore.addConversation).mockImplementationOnce(() => {
        throw sqliteError;
      });

      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ userId: 'user-1', conversation });

      expect(result.error).toBeUndefined();
      expect(result.context.duplicateDetected).toBe(true);
      expect(deps.extractor.extract).not.toHaveBeenCalled();
      expect(deps.embedder.embed).not.toHaveBeenCalled();
      expect(deps.consolidator.consolidateBatch).not.toHaveBeenCalled();
    });
  });

  describe('consolidation actions', () => {
    it('handles ADD action', async () => {
      const deps = createDeps();
      vi.mocked(deps.consolidator.consolidateBatch).mockResolvedValueOnce({
        results: [{ action: 'ADD', factIndex: 0 }],
        idRemap: new Map(),
      });

      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ userId: 'user-1', conversation });
      expect(result.error).toBeUndefined();
    });

    it('handles UPDATE action with targetMemoryId', async () => {
      const deps = createDeps();
      vi.mocked(deps.consolidator.consolidateBatch).mockResolvedValueOnce({
        results: [{ action: 'UPDATE', factIndex: 0, targetMemoryId: 'existing-1' }],
        idRemap: new Map(),
      });

      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ userId: 'user-1', conversation });
      expect(result.error).toBeUndefined();
      expect(deps.store.updateMemory).toHaveBeenCalledWith(
        'existing-1',
        expect.objectContaining({ text: expect.any(String) as string }),
        'user-1',
      );
    });

    it('handles SUPERSEDE action', async () => {
      const deps = createDeps();
      vi.mocked(deps.consolidator.consolidateBatch).mockResolvedValueOnce({
        results: [
          {
            action: 'SUPERSEDE',
            factIndex: 0,
            targetMemoryId: 'old-1',
            mergedText: 'updated fact',
            supersessionReason: 'more recent',
          },
        ],
        idRemap: new Map(),
      });

      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ userId: 'user-1', conversation });
      expect(result.error).toBeUndefined();
      expect(deps.store.supersedeMemory).toHaveBeenCalled();
      // SUPERSEDE re-embeds the merged text
      expect(vi.mocked(deps.embedder.embed).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('handles DELETE action by deleting then adding replacement', async () => {
      const deps = createDeps();
      vi.mocked(deps.consolidator.consolidateBatch).mockResolvedValueOnce({
        results: [{ action: 'DELETE', factIndex: 0, targetMemoryId: 'delete-1' }],
        idRemap: new Map(),
      });

      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ userId: 'user-1', conversation });
      expect(result.error).toBeUndefined();
      expect(deps.store.deleteMemory).toHaveBeenCalledWith('delete-1', 'user-1');
      // DELETE adds a replacement memory
      expect(vi.mocked(deps.store.addMemory).mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('handles NOOP action by skipping', async () => {
      const deps = createDeps();
      vi.mocked(deps.consolidator.consolidateBatch).mockResolvedValueOnce({
        results: [{ action: 'NOOP', factIndex: 0 }],
        idRemap: new Map(),
      });

      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ userId: 'user-1', conversation });
      expect(result.error).toBeUndefined();

      // No fact-level addMemory for NOOP (conversation goes to conversationStore, not addMemory)
      const addMemory = vi.mocked(deps.store.addMemory);
      expect(addMemory).not.toHaveBeenCalled();
    });

    it('resolves idRemap for targetMemoryId', async () => {
      const deps = createDeps();
      vi.mocked(deps.consolidator.consolidateBatch).mockResolvedValueOnce({
        results: [{ action: 'UPDATE', factIndex: 0, targetMemoryId: '0' }],
        idRemap: new Map([['0', 'real-uuid-123']]),
      });

      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      await pipeline.run({ userId: 'user-1', conversation });

      expect(deps.store.updateMemory).toHaveBeenCalledWith(
        'real-uuid-123',
        expect.any(Object),
        'user-1',
      );
    });
  });

  describe('error handling', () => {
    it('throws OrchestratorError when userId is missing', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ conversation });

      expect(result.error).toBeDefined();
      expect(result.error?.step).toBe('storeUser');
      expect(result.error?.error).toContain('userId');
    });

    it('captures non-fatal store decision errors in stepErrors', async () => {
      const deps = createDeps();
      vi.mocked(deps.consolidator.consolidateBatch).mockResolvedValueOnce({
        results: [{ action: 'UPDATE', factIndex: 0, targetMemoryId: 'bad-id' }],
        idRemap: new Map(),
      });
      vi.mocked(deps.store.updateMemory).mockRejectedValueOnce(new Error('not found'));

      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ userId: 'user-1', conversation });

      // Pipeline completes (error is non-fatal, captured in context)
      expect(result.error).toBeUndefined();
      const stepErrors = result.context.stepErrors as Array<{ step: string; error: string }>;
      expect(stepErrors).toBeDefined();
      expect(stepErrors.length).toBeGreaterThan(0);
      expect(stepErrors[0]?.step).toBe('store');
    });

    it('falls back to ADD on UPDATE duplicate key error', async () => {
      const deps = createDeps();
      vi.mocked(deps.consolidator.consolidateBatch).mockResolvedValueOnce({
        results: [{ action: 'UPDATE', factIndex: 0, targetMemoryId: 'existing-1' }],
        idRemap: new Map(),
      });
      const sqliteError = new Error('UNIQUE constraint failed: memories.content_hash');
      vi.mocked(deps.store.updateMemory).mockRejectedValueOnce(sqliteError);

      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ userId: 'user-1', conversation });

      expect(result.error).toBeUndefined();
      // Falls back to addMemory for the fact
      expect(vi.mocked(deps.store.addMemory).mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('turn-order validation', () => {
    it('validates turn order on successful pipeline run', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ userId: 'user-1', conversation });

      expect(result.error).toBeUndefined();
      const turnOrder = result.context.turnOrder as string[];
      expect(turnOrder).toEqual(['store(user)', 'search', 'LLM', 'store(assistant_pre_reveal)']);
    });

    it('fails when store(user) step is removed', async () => {
      const deps = createDeps();
      const steps = createIngestPipeline(deps).filter((step) => step.name !== 'storeUser');
      const pipeline = createPipelineRunner(steps);
      const result = await pipeline.run({ userId: 'user-1', conversation });

      expect(result.error).toMatchObject({ step: 'validate-turn-order' });
    });

    it('fails when step order is changed', async () => {
      const deps = createDeps();
      const steps = createIngestPipeline(deps);
      const searchIndex = steps.findIndex((step) => step.name === 'searchSimilar');
      const consolidateIndex = steps.findIndex((step) => step.name === 'consolidate');
      const shuffled = [...steps];
      [shuffled[searchIndex]!, shuffled[consolidateIndex]!] = [
        shuffled[consolidateIndex]!,
        shuffled[searchIndex]!,
      ];

      const pipeline = createPipelineRunner(shuffled);
      const result = await pipeline.run({ userId: 'user-1', conversation });

      expect(result.error).toMatchObject({ step: 'validate-turn-order' });
    });

    it('skips validation when conversation is empty', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const result = await pipeline.run({ userId: 'user-1', conversation: [] });

      expect(result.error).toBeUndefined();
    });
  });

  describe('memory origin tagging', () => {
    it('tags assistant_pre_reveal memories from fact extraction', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      await pipeline.run({ userId: 'user-1', conversation });

      const addMemory = vi.mocked(deps.store.addMemory);
      // First addMemory call is the fact-level store (ADD action)
      expect(addMemory.mock.calls[0]?.[0]).toMatchObject({
        metadata: expect.objectContaining({ memory_origin: 'assistant_pre_reveal' }),
      });
    });
  });

  describe('timestamp derivation', () => {
    it('returns latest message timestamp', () => {
      const messages: Message[] = [
        { role: 'user', content: 'hello', timestamp: '2023-05-08T10:00:00.000Z' },
        { role: 'assistant', content: 'hi', timestamp: '2023-05-08T10:01:00.000Z' },
        { role: 'user', content: 'bye', timestamp: '2023-05-08T10:02:00.000Z' },
      ];
      expect(deriveTimestamp(messages)).toBe('2023-05-08T10:02:00.000Z');
    });

    it('returns undefined when no messages have timestamps', () => {
      const messages: Message[] = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ];
      expect(deriveTimestamp(messages)).toBeUndefined();
    });

    it('returns undefined for empty array', () => {
      expect(deriveTimestamp([])).toBeUndefined();
    });

    it('skips messages without timestamps and returns latest timestamped', () => {
      const messages: Message[] = [
        { role: 'user', content: 'a', timestamp: '2023-05-08T09:00:00.000Z' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ];
      expect(deriveTimestamp(messages)).toBe('2023-05-08T09:00:00.000Z');
    });

    it('extractFactsStep uses explicit referenceTimestamp over message timestamps', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const timestampedConversation: Message[] = [
        { role: 'user', content: 'hello', timestamp: '2023-05-08T10:00:00.000Z' },
      ];

      await pipeline.run({
        userId: 'user-1',
        conversation: timestampedConversation,
        referenceTimestamp: '2020-01-01T00:00:00.000Z',
      });

      const extractCalls = vi.mocked(deps.extractor.extract).mock.calls;
      expect(extractCalls[0]?.[1]).toBe('2020-01-01T00:00:00.000Z');
    });

    it('extractFactsStep falls back to message timestamps when no explicit timestamp', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));
      const timestampedConversation: Message[] = [
        { role: 'user', content: 'hello', timestamp: '2023-05-08T10:00:00.000Z' },
        { role: 'assistant', content: 'hi', timestamp: '2023-05-08T10:01:00.000Z' },
      ];

      await pipeline.run({
        userId: 'user-1',
        conversation: timestampedConversation,
      });

      const extractCalls = vi.mocked(deps.extractor.extract).mock.calls;
      expect(extractCalls[0]?.[1]).toBe('2023-05-08T10:01:00.000Z');
    });

    it('extractFactsStep falls back to now when no timestamps at all', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createIngestPipeline(deps));

      const before = new Date().toISOString();
      await pipeline.run({ userId: 'user-1', conversation });
      const after = new Date().toISOString();

      const extractCalls = vi.mocked(deps.extractor.extract).mock.calls;
      const usedTimestamp = extractCalls[0]?.[1] as string;
      expect(usedTimestamp >= before).toBe(true);
      expect(usedTimestamp <= after).toBe(true);
    });
  });
});
