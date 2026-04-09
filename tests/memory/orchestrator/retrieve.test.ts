import { describe, expect, it, vi } from 'vitest';
import type { AnalyzedQuery, RetrieveResult } from '../../../src/core/types.js';
import type { QueryAnalyzer, Retriever } from '../../../src/core/interfaces.js';
import {
  createRetrievePipeline,
  type RetrieveDependencies,
} from '../../../src/memory/orchestrator/retrieve.js';
import { createPipelineRunner } from '../../../src/memory/orchestrator/pipeline.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stubAnalyzedQuery = (overrides: Partial<AnalyzedQuery> = {}): AnalyzedQuery => ({
  intent: 'factual_lookup',
  filters: {},
  suggestedTopK: 5,
  rewrittenQuery: 'rewritten query',
  ...overrides,
});

const stubRetrieveResult = (overrides: Partial<RetrieveResult> = {}): RetrieveResult => ({
  query: stubAnalyzedQuery(),
  memories: [],
  metadata: { totalFound: 0, topK: 5 },
  ...overrides,
});

const createDeps = (): RetrieveDependencies => {
  const queryAnalyzer: QueryAnalyzer = {
    analyzeQuery: vi.fn(async () => stubAnalyzedQuery()),
  };

  const retriever: Retriever = {
    retrieve: vi.fn(async () => stubRetrieveResult()),
  };

  return { queryAnalyzer, retriever };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('retrieve pipeline', () => {
  describe('step ordering', () => {
    it('produces 2 pipeline steps in the correct order', () => {
      const deps = createDeps();
      const steps = createRetrievePipeline(deps);
      expect(steps).toHaveLength(2);
      expect(steps.map((s) => s.name)).toEqual(['analyze', 'retrieve']);
    });

    it('executes all steps without error', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createRetrievePipeline(deps));
      const result = await pipeline.run({ query: 'test query', userId: 'user-1' });
      expect(result.error).toBeUndefined();
    });
  });

  describe('query analysis', () => {
    it('passes query and userId to query analyzer', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createRetrievePipeline(deps));
      await pipeline.run({ query: 'what do I like?', userId: 'user-1' });

      expect(deps.queryAnalyzer.analyzeQuery).toHaveBeenCalledWith('what do I like?', {
        userId: 'user-1',
      });
    });

    it('stores analyzed query in context', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createRetrievePipeline(deps));
      const result = await pipeline.run({ query: 'test', userId: 'user-1' });

      expect(result.context.analyzedQuery).toBeDefined();
      expect((result.context.analyzedQuery as AnalyzedQuery).rewrittenQuery).toBe(
        'rewritten query',
      );
    });
  });

  describe('retrieval', () => {
    it('passes rewritten query and userId to retriever', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createRetrievePipeline(deps));
      await pipeline.run({ query: 'test', userId: 'user-1' });

      expect(deps.retriever.retrieve).toHaveBeenCalledWith('rewritten query', 'user-1', {
        topK: 5,
        temporalMode: undefined,
        asOf: undefined,
      });
    });

    it('uses analyzer suggestedTopK by default', async () => {
      const deps = createDeps();
      vi.mocked(deps.queryAnalyzer.analyzeQuery).mockResolvedValueOnce(
        stubAnalyzedQuery({ suggestedTopK: 10 }),
      );
      const pipeline = createPipelineRunner(createRetrievePipeline(deps));
      await pipeline.run({ query: 'test', userId: 'user-1' });

      expect(deps.retriever.retrieve).toHaveBeenCalledWith(
        expect.any(String),
        'user-1',
        expect.objectContaining({ topK: 10 }),
      );
    });

    it('allows caller to override topK', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createRetrievePipeline(deps));
      await pipeline.run({ query: 'test', userId: 'user-1', topK: 20 });

      expect(deps.retriever.retrieve).toHaveBeenCalledWith(
        expect.any(String),
        'user-1',
        expect.objectContaining({ topK: 20 }),
      );
    });

    it('passes temporal mode and asOf to retriever', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createRetrievePipeline(deps));
      await pipeline.run({
        query: 'test',
        userId: 'user-1',
        temporalMode: 'as_of',
        asOf: '2026-01-01T00:00:00Z',
      });

      expect(deps.retriever.retrieve).toHaveBeenCalledWith(
        expect.any(String),
        'user-1',
        expect.objectContaining({ temporalMode: 'as_of', asOf: '2026-01-01T00:00:00Z' }),
      );
    });

    it('stores retrieve result in context', async () => {
      const deps = createDeps();
      const expectedResult = stubRetrieveResult({
        memories: [{ memory: { id: 'mem-1' } as never, score: 0.95 }],
        metadata: { totalFound: 1, topK: 5 },
      });
      vi.mocked(deps.retriever.retrieve).mockResolvedValueOnce(expectedResult);

      const pipeline = createPipelineRunner(createRetrievePipeline(deps));
      const result = await pipeline.run({ query: 'test', userId: 'user-1' });

      const retrieveResult = result.context.retrieveResult as RetrieveResult;
      expect(retrieveResult).toBeDefined();
      expect(retrieveResult.memories).toHaveLength(1);
      expect(retrieveResult.metadata.totalFound).toBe(1);
    });
  });

  describe('error handling', () => {
    it('fails when query is missing', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createRetrievePipeline(deps));
      const result = await pipeline.run({ userId: 'user-1' });

      expect(result.error).toBeDefined();
      expect(result.error?.step).toBe('analyze');
      expect(result.error?.error).toContain('query');
    });

    it('fails when userId is missing', async () => {
      const deps = createDeps();
      const pipeline = createPipelineRunner(createRetrievePipeline(deps));
      const result = await pipeline.run({ query: 'test' });

      expect(result.error).toBeDefined();
      expect(result.error?.step).toBe('analyze');
      expect(result.error?.error).toContain('userId');
    });

    it('fails when analyze step is skipped', async () => {
      const deps = createDeps();
      const steps = createRetrievePipeline(deps).filter((s) => s.name !== 'analyze');
      const pipeline = createPipelineRunner(steps);
      const result = await pipeline.run({ query: 'test', userId: 'user-1' });

      expect(result.error).toBeDefined();
      expect(result.error?.step).toBe('retrieve');
      expect(result.error?.error).toContain('Analyze step');
    });
  });
});
