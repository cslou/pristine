import { describe, expect, it, vi } from 'vitest';
import { createQueryAnalyzer } from '../../../src/memory/query-analyzer/index.js';
import { AppError } from '../../../src/core/errors.js';
import { resolve, clearResolvedStringRegistry } from '../../../src/privacy/sanitizer/index.js';
import type { LlmClient } from '../../../src/core/interfaces.js';

const analysisResponse = (payload: unknown) => payload;

const createMockClient = (result: unknown): LlmClient => ({
  generate: vi.fn().mockResolvedValue(result),
});

const createFailingClient = (error: Error): LlmClient => ({
  generate: vi.fn().mockRejectedValue(error),
});

describe('query analyzer intent classification', () => {
  it('classifies factual lookup intent', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'factual_lookup',
        filters: {},
        suggestedTopK: 3,
        rewrittenQuery: 'What is the capital of France?',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('What is the capital of France?');

    expect(result.intent).toBe('factual_lookup');
  });

  it('classifies contextual search intent', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'contextual_search',
        filters: {},
        suggestedTopK: 10,
        rewrittenQuery: 'general thoughts on productivity',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('Tell me about productivity.');

    expect(result.intent).toBe('contextual_search');
  });

  it('classifies temporal query intent', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'temporal_query',
        filters: { timeRange: { start: '2026-01-01', end: '2026-03-01' } },
        suggestedTopK: 5,
        rewrittenQuery: 'events from January to March 2026',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('What happened in the first quarter?');

    expect(result.intent).toBe('temporal_query');
    expect(result.filters.timeRange).toEqual({ start: '2026-01-01', end: '2026-03-01' });
  });
});

describe('query analyzer filter extraction', () => {
  it('extracts a time range', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'temporal_query',
        filters: { timeRange: { start: '2026-02-23', end: '2026-03-01' } },
        suggestedTopK: 5,
        rewrittenQuery: 'events from last week',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('What happened last week?');

    expect(result.filters.timeRange).toEqual({ start: '2026-02-23', end: '2026-03-01' });
  });

  it('extracts a topic filter', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'contextual_search',
        filters: { topic: 'cooking' },
        suggestedTopK: 10,
        rewrittenQuery: 'memories about cooking',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('Tell me about cooking.');

    expect(result.filters.topic).toBe('cooking');
  });

  it('extracts topic and timeRange filters together', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'temporal_query',
        filters: {
          topic: 'gardening',
          timeRange: { start: '2026-03-01', end: '2026-03-15' },
        },
        suggestedTopK: 8,
        rewrittenQuery: 'gardening activities in early March',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('What gardening did I do in early March?');

    expect(result.filters.topic).toBe('gardening');
    expect(result.filters.timeRange).toEqual({ start: '2026-03-01', end: '2026-03-15' });
  });

  it('returns empty filters object when no filters are present', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'contextual_search',
        filters: {},
        suggestedTopK: 10,
        rewrittenQuery: 'general query',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('Tell me something.');

    expect(result.filters).toEqual({});
  });

  it('trims whitespace from topic and agentScope', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'contextual_search',
        filters: { topic: '  cooking  ', agentScope: '  home  ' },
        suggestedTopK: 10,
        rewrittenQuery: 'cooking at home',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('Cooking at home');

    expect(result.filters.topic).toBe('cooking');
    expect(result.filters.agentScope).toBe('home');
  });

  it('excludes empty-string topic after trimming', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'contextual_search',
        filters: { topic: '   ' },
        suggestedTopK: 10,
        rewrittenQuery: 'general query',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('Something');

    expect(result.filters.topic).toBeUndefined();
  });
});

describe('query analyzer rewriting and topK', () => {
  it('rewrites vague queries for better embedding match', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'contextual_search',
        filters: {},
        suggestedTopK: 10,
        rewrittenQuery: 'specific memories about recent activities and events',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('stuff');

    expect(result.rewrittenQuery).not.toBe('stuff');
    expect(result.rewrittenQuery.length).toBeGreaterThan(0);
  });

  it('passes through specific query text when no rewrite is needed', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'factual_lookup',
        filters: {},
        suggestedTopK: 3,
        rewrittenQuery: 'What programming languages does the user know?',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('What programming languages does the user know?');

    expect(result.rewrittenQuery).toBe('What programming languages does the user know?');
  });

  it('uses low suggestedTopK for factual lookup', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'factual_lookup',
        filters: {},
        suggestedTopK: 3,
        rewrittenQuery: 'user favorite color',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('What is my favorite color?');

    expect(result.suggestedTopK).toBeLessThanOrEqual(3);
  });

  it('uses higher suggestedTopK for contextual search', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'contextual_search',
        filters: {},
        suggestedTopK: 15,
        rewrittenQuery: 'broad search',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('Tell me everything you know.');

    expect(result.suggestedTopK).toBeGreaterThan(3);
  });
});

describe('query analyzer context handling', () => {
  it('works when context is not provided', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'factual_lookup',
        filters: {},
        suggestedTopK: 5,
        rewrittenQuery: 'What is the weather?',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    await analyzer.analyzeQuery('What is the weather?');

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      userPrompt: string;
    };
    expect(call.userPrompt).toBe('What is the weather?');
  });

  it('passes context into the prompt for richer analysis', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'contextual_search',
        filters: {},
        suggestedTopK: 10,
        rewrittenQuery: 'context-aware query',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    await analyzer.analyzeQuery('What about that?', {
      userId: 'user-42',
      conversationHistory: [{ role: 'user', content: 'Previous message' }],
    });

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      userPrompt: string;
    };
    expect(call.userPrompt).toContain('user-42');
    expect(call.userPrompt).toContain('conversationHistory');
  });
});

describe('query analyzer fallback behavior', () => {
  it('falls back for empty query input', async () => {
    const client: LlmClient = { generate: vi.fn() };
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('');

    expect(client.generate).not.toHaveBeenCalled();
    expect(result).toEqual({
      intent: 'contextual_search',
      filters: {},
      suggestedTopK: 10,
      rewrittenQuery: '',
    });
  });

  it('falls back when the LLM call fails', async () => {
    const client = createFailingClient(new Error('network down'));
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('What is my name?');

    expect(result).toEqual({
      intent: 'contextual_search',
      filters: {},
      suggestedTopK: 10,
      rewrittenQuery: 'What is my name?',
    });
  });

  it('falls back when the API rejects with AppError', async () => {
    const client = createFailingClient(new AppError('inference failed'));
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('Some query');

    expect(client.generate).toHaveBeenCalledTimes(1);
    expect(result.intent).toBe('contextual_search');
    expect(result.suggestedTopK).toBe(10);
  });

  it('falls back when tool result is invalid', async () => {
    const client = createMockClient('{ invalid payload }');
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('Some query');

    expect(result).toEqual({
      intent: 'contextual_search',
      filters: {},
      suggestedTopK: 10,
      rewrittenQuery: 'Some query',
    });
  });

  it('returns passthrough result shape on fallback', async () => {
    const client = createFailingClient(new Error('timeout'));
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('My specific question');

    expect(result.rewrittenQuery).toBe('My specific question');
    expect(result.intent).toBe('contextual_search');
  });
});

describe('query analyzer parsing and validation', () => {
  it('parses full complex response with all filters', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'temporal_query',
        filters: {
          topic: 'gardening',
          timeRange: { start: '2026-01-01', end: '2026-06-01' },
          agentScope: 'home',
        },
        suggestedTopK: 8,
        rewrittenQuery: 'gardening activities at home in first half of 2026',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    const result = await analyzer.analyzeQuery('What gardening have I done at home this year?');

    expect(result.intent).toBe('temporal_query');
    expect(result.filters.topic).toBe('gardening');
    expect(result.filters.timeRange).toEqual({ start: '2026-01-01', end: '2026-06-01' });
    expect(result.filters.agentScope).toBe('home');
    expect(result.suggestedTopK).toBe(8);
    expect(result.rewrittenQuery).toBe('gardening activities at home in first half of 2026');
  });

  it('passes schema to generate<T>()', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'contextual_search',
        filters: {},
        suggestedTopK: 10,
        rewrittenQuery: 'test',
      }),
    );
    const analyzer = createQueryAnalyzer(client);
    await analyzer.analyzeQuery('test');

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      schema: Record<string, unknown>;
    };
    expect(call.schema).toBeDefined();
    const schema = call.schema as { required?: string[] };
    expect(schema.required).toContain('intent');
    expect(schema.required).toContain('rewrittenQuery');
  });

  it('uses custom system prompt when provided', async () => {
    const client = createMockClient(
      analysisResponse({
        intent: 'contextual_search',
        filters: {},
        suggestedTopK: 10,
        rewrittenQuery: 'test',
      }),
    );
    const customPrompt = 'Custom query analysis instructions.';
    const analyzer = createQueryAnalyzer(client, { systemPrompt: customPrompt });
    await analyzer.analyzeQuery('test');

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      systemPrompt: string;
    };
    expect(call.systemPrompt).toBe(customPrompt);
  });
});

describe('query analyzer security', () => {
  it('throws when analyzeQuery receives a resolved string', async () => {
    clearResolvedStringRegistry();

    const client: LlmClient = { generate: vi.fn() };
    const analyzer = createQueryAnalyzer(client);
    const resolvedQuery = resolve(
      'User says [SENSITIVE:identity_number:00000000-0000-0000-0000-000000000001]',
      {
        approvedValues: {
          '00000000-0000-0000-0000-000000000001': 'redacted-identity',
        },
      },
    );

    await expect(analyzer.analyzeQuery(resolvedQuery as string)).rejects.toThrow(
      'Resolved payload is not allowed for query analyzer query.',
    );
    expect(client.generate).not.toHaveBeenCalled();
  });
});
