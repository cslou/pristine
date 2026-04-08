import { describe, expect, it, vi } from 'vitest';
import { createConsolidator } from '../../../src/memory/consolidator/index.js';
import { AppError } from '../../../src/core/errors.js';
import { resolve, clearResolvedStringRegistry } from '../../../src/privacy/sanitizer/index.js';
import type { LlmClient } from '../../../src/core/interfaces.js';

const decisionsResponse = (decisions: unknown[]) => ({ decisions });

const createMockClient = (result: unknown): LlmClient => ({
  generate: vi.fn().mockResolvedValue(result),
});

const createFailingClient = (error: Error): LlmClient => ({
  generate: vi.fn().mockRejectedValue(error),
});

describe('consolidator', () => {
  it('returns clean NOOP result shape', async () => {
    const client = createMockClient(decisionsResponse([{ factIndex: 0, action: 'NOOP' }]));
    const consolidator = createConsolidator(client);
    const result = await consolidator.consolidate({ text: 'User prefers dark mode.' }, [
      { text: 'User likes dark mode.' },
    ]);

    expect(result).toMatchObject({ action: 'NOOP', factIndex: 0 });
  });

  it('consolidateBatch([]) returns empty results without LLM calls', async () => {
    const client = createMockClient(null);
    const consolidator = createConsolidator(client);
    const results = await consolidator.consolidateBatch([]);

    expect(results).toEqual({ results: [], idRemap: new Map() });
    expect(client.generate).not.toHaveBeenCalled();
  });

  it('throws when mergedText is non-string', async () => {
    const client = createMockClient(
      decisionsResponse([{ factIndex: 0, action: 'UPDATE', mergedText: 123, targetMemoryId: '0' }]),
    );
    const consolidator = createConsolidator(client);

    await expect(
      consolidator.consolidate({ text: 'new fact' }, [{ id: 'memory-1', text: 'old memory' }]),
    ).rejects.toThrow('Consolidator payload mergedText must be a string when present.');
  });

  it('throws when response is null', async () => {
    const client = createMockClient(null);
    const consolidator = createConsolidator(client);

    await expect(
      consolidator.consolidate({ text: 'new fact' }, [{ text: 'old memory' }]),
    ).rejects.toThrow('Consolidator batch response missing decisions array.');
  });

  it('throws when decisions is not an array', async () => {
    const client = createMockClient({ decisions: 'not-an-array' });
    const consolidator = createConsolidator(client);

    await expect(
      consolidator.consolidate({ text: 'new fact' }, [{ text: 'old memory' }]),
    ).rejects.toThrow('Consolidator batch response missing decisions array.');
  });

  it('throws when action is missing', async () => {
    const client = createMockClient(decisionsResponse([{ factIndex: 0, mergedText: 'foo' }]));
    const consolidator = createConsolidator(client);

    await expect(
      consolidator.consolidate({ text: 'new fact' }, [{ text: 'old memory' }]),
    ).rejects.toThrow('Consolidator payload action is invalid.');
  });

  it('throws when factIndex is missing', async () => {
    const client = createMockClient(decisionsResponse([{ action: 'ADD' }]));
    const consolidator = createConsolidator(client);

    await expect(
      consolidator.consolidate({ text: 'new fact' }, [{ text: 'old memory' }]),
    ).rejects.toThrow('Consolidator payload factIndex must be a number.');
  });

  it('tolerates extra unexpected fields', async () => {
    const client = createMockClient(
      decisionsResponse([{ factIndex: 0, action: 'ADD', extraField: true }]),
    );
    const consolidator = createConsolidator(client);
    const result = await consolidator.consolidate({ text: 'new fact' }, [{ text: 'old memory' }]);

    expect(result).toMatchObject({ action: 'ADD', factIndex: 0 });
  });

  it('propagates API/network errors', async () => {
    const client = createFailingClient(new Error('upstream failure'));
    const consolidator = createConsolidator(client);

    await expect(
      consolidator.consolidate({ text: 'new fact' }, [{ text: 'old memory' }]),
    ).rejects.toThrow('upstream failure');
  });

  it('batch fails when LLM call throws', async () => {
    const client = createFailingClient(new Error('boom'));
    const consolidator = createConsolidator(client);

    await expect(
      consolidator.consolidateBatch([
        { newFact: { text: 'first' }, similarMemories: [{ text: 'one' }] },
        { newFact: { text: 'second' }, similarMemories: [{ text: 'two' }] },
      ]),
    ).rejects.toThrow('boom');
    expect(client.generate).toHaveBeenCalledTimes(1);
  });

  it('blocks resolved newFact payloads from consolidator LLM input', async () => {
    clearResolvedStringRegistry();

    const client: LlmClient = { generate: vi.fn() };
    const consolidator = createConsolidator(client);
    const resolvedFact = resolve(
      { text: 'User says [SENSITIVE:identity_number:00000000-0000-0000-0000-000000000001]' },
      {
        approvedValues: {
          '00000000-0000-0000-0000-000000000001': 'redacted-identity',
        },
      },
    );

    await expect(
      consolidator.consolidate(resolvedFact as { text: string }, [{ text: 'existing memory' }]),
    ).rejects.toThrow('Resolved payload is not allowed for consolidator new fact.');
    expect(client.generate).not.toHaveBeenCalled();
  });

  it('uses valid targetMemoryId for UPDATE', async () => {
    const client = createMockClient(
      decisionsResponse([
        { factIndex: 0, action: 'UPDATE', mergedText: 'merged memory text', targetMemoryId: '0' },
      ]),
    );
    const consolidator = createConsolidator(client);
    const result = await consolidator.consolidate({ text: 'User likes JavaScript.' }, [
      { id: 'memory-123', text: 'User enjoys JavaScript.' },
      { id: 'memory-456', text: 'User loves TypeScript.' },
    ]);

    expect(result).toEqual({
      action: 'UPDATE',
      mergedText: 'merged memory text',
      targetMemoryId: 'memory-123',
      factIndex: 0,
      supersessionReason: undefined,
      validUntil: undefined,
    });
  });

  it('downgrades invalid targetMemoryId UPDATE to ADD', async () => {
    const client = createMockClient(
      decisionsResponse([
        { factIndex: 0, action: 'UPDATE', mergedText: 'merged memory text', targetMemoryId: '99' },
      ]),
    );
    const consolidator = createConsolidator(client);
    const result = await consolidator.consolidate({ text: 'User likes JavaScript.' }, [
      { id: 'memory-123', text: 'User enjoys JavaScript.' },
    ]);

    expect(result.action).toBe('ADD');
    expect(result.mergedText).toBe('merged memory text');
  });

  it('downgrades missing targetMemoryId DELETE to NOOP', async () => {
    const client = createMockClient(
      decisionsResponse([{ factIndex: 0, action: 'DELETE', mergedText: 'to be removed' }]),
    );
    const consolidator = createConsolidator(client);
    const result = await consolidator.consolidate({ text: 'User likes JavaScript.' }, [
      { id: 'memory-123', text: 'User enjoys JavaScript.' },
    ]);

    expect(result.action).toBe('NOOP');
  });
});

describe('batch consolidation', () => {
  it('returns 3 decisions for 3 facts in a single LLM call', async () => {
    const client = createMockClient(
      decisionsResponse([
        { factIndex: 0, action: 'ADD', mergedText: 'fact zero' },
        { factIndex: 1, action: 'UPDATE', mergedText: 'updated', targetMemoryId: '0' },
        { factIndex: 2, action: 'NOOP' },
      ]),
    );
    const consolidator = createConsolidator(client);
    const batch = await consolidator.consolidateBatch([
      { newFact: { text: 'fact A' }, similarMemories: [{ id: 'uuid-1', text: 'similar A' }] },
      { newFact: { text: 'fact B' }, similarMemories: [{ id: 'uuid-2', text: 'similar B' }] },
      { newFact: { text: 'fact C' }, similarMemories: [{ id: 'uuid-3', text: 'similar C' }] },
    ]);

    expect(client.generate).toHaveBeenCalledTimes(1);
    expect(batch.results).toHaveLength(3);
    expect(batch.results[0]!.action).toBe('ADD');
    expect(batch.results[1]!.action).toBe('UPDATE');
    expect(batch.results[2]!.action).toBe('NOOP');
  });

  it('auto-ADDs facts with no similar memories without LLM call', async () => {
    const client = createMockClient(null);
    const consolidator = createConsolidator(client);
    const batch = await consolidator.consolidateBatch([
      { newFact: { text: 'brand new' }, similarMemories: [] },
    ]);

    expect(client.generate).not.toHaveBeenCalled();
    expect(batch.results).toEqual([{ action: 'ADD', factIndex: 0 }]);
    expect(batch.idRemap.size).toBe(0);
  });

  it('mixes auto-ADD and LLM results for mixed batch', async () => {
    const client = createMockClient(
      decisionsResponse([
        { factIndex: 1, action: 'UPDATE', mergedText: 'enriched', targetMemoryId: '0' },
      ]),
    );
    const consolidator = createConsolidator(client);
    const batch = await consolidator.consolidateBatch([
      { newFact: { text: 'no matches' }, similarMemories: [] },
      {
        newFact: { text: 'has match' },
        similarMemories: [{ id: 'uuid-1', text: 'existing' }],
      },
    ]);

    expect(client.generate).toHaveBeenCalledTimes(1);
    expect(batch.results).toHaveLength(2);
    expect(batch.results[0]!).toEqual({ action: 'ADD', factIndex: 0 });
    expect(batch.results[1]!.action).toBe('UPDATE');
    expect(batch.results[1]!.factIndex).toBe(1);
  });

  it('returns idRemap with integer-to-UUID mappings', async () => {
    const client = createMockClient(decisionsResponse([{ factIndex: 0, action: 'NOOP' }]));
    const consolidator = createConsolidator(client);
    const batch = await consolidator.consolidateBatch([
      {
        newFact: { text: 'new' },
        similarMemories: [
          { id: 'uuid-aaa', text: 'mem A' },
          { id: 'uuid-bbb', text: 'mem B' },
        ],
      },
    ]);

    expect(batch.idRemap.get('0')).toBe('uuid-aaa');
    expect(batch.idRemap.get('1')).toBe('uuid-bbb');
    expect(batch.idRemap.size).toBe(2);
  });

  it('deduplicates same UUID across facts in idRemap', async () => {
    const client = createMockClient(
      decisionsResponse([
        { factIndex: 0, action: 'NOOP' },
        { factIndex: 1, action: 'NOOP' },
      ]),
    );
    const consolidator = createConsolidator(client);
    const batch = await consolidator.consolidateBatch([
      { newFact: { text: 'a' }, similarMemories: [{ id: 'shared-uuid', text: 'mem' }] },
      { newFact: { text: 'b' }, similarMemories: [{ id: 'shared-uuid', text: 'mem' }] },
    ]);

    expect(batch.idRemap.size).toBe(1);
    expect(batch.idRemap.get('0')).toBe('shared-uuid');
  });

  it('uses integer IDs in prompt, not UUIDs', async () => {
    const client = createMockClient(decisionsResponse([{ factIndex: 0, action: 'NOOP' }]));
    const consolidator = createConsolidator(client);
    await consolidator.consolidateBatch([
      {
        newFact: { text: 'query' },
        similarMemories: [{ id: 'abc-123-def-456', text: 'memory text' }],
      },
    ]);

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      userPrompt: string;
    };
    expect(call.userPrompt).toContain('Memory [id: 0]');
    expect(call.userPrompt).not.toContain('abc-123-def-456');
  });

  it('throws on out-of-range factIndex from LLM', async () => {
    const client = createMockClient(decisionsResponse([{ factIndex: 99, action: 'ADD' }]));
    const consolidator = createConsolidator(client);

    await expect(
      consolidator.consolidateBatch([
        {
          newFact: { text: 'only one fact' },
          similarMemories: [{ id: 'uuid-1', text: 'mem' }],
        },
      ]),
    ).rejects.toThrow('Consolidator batch response contains out-of-range factIndex: 99');
  });
});

describe('SUPERSEDE validation', () => {
  it('accepts valid SUPERSEDE with all required fields', async () => {
    const client = createMockClient(
      decisionsResponse([
        {
          factIndex: 0,
          action: 'SUPERSEDE',
          mergedText: 'Works at Meta',
          targetMemoryId: '0',
          supersessionReason: 'Changed employer from Google to Meta',
        },
      ]),
    );
    const consolidator = createConsolidator(client);
    const result = await consolidator.consolidate({ text: 'Works at Meta' }, [
      { id: 'uuid-old', text: 'Works at Google' },
    ]);

    expect(result.action).toBe('SUPERSEDE');
    expect(result.mergedText).toBe('Works at Meta');
    expect(result.targetMemoryId).toBe('uuid-old');
    expect(result.supersessionReason).toBe('Changed employer from Google to Meta');
  });

  it('accepts SUPERSEDE with optional validUntil', async () => {
    const client = createMockClient(
      decisionsResponse([
        {
          factIndex: 0,
          action: 'SUPERSEDE',
          mergedText: 'Lives in London',
          targetMemoryId: '0',
          supersessionReason: 'Moved from Tokyo to London',
          validUntil: '2026-01-15T00:00:00.000Z',
        },
      ]),
    );
    const consolidator = createConsolidator(client);
    const result = await consolidator.consolidate({ text: 'Lives in London' }, [
      { id: 'uuid-old', text: 'Lives in Tokyo' },
    ]);

    expect(result.action).toBe('SUPERSEDE');
    expect(result.validUntil).toBe('2026-01-15T00:00:00.000Z');
  });

  it('downgrades SUPERSEDE to ADD when targetMemoryId is invalid', async () => {
    const client = createMockClient(
      decisionsResponse([
        {
          factIndex: 0,
          action: 'SUPERSEDE',
          mergedText: 'new text',
          targetMemoryId: '99',
          supersessionReason: 'reason',
        },
      ]),
    );
    const consolidator = createConsolidator(client);
    const result = await consolidator.consolidate({ text: 'new' }, [{ id: 'uuid-1', text: 'old' }]);

    expect(result.action).toBe('ADD');
  });

  it('downgrades SUPERSEDE to ADD when mergedText is missing', async () => {
    const client = createMockClient(
      decisionsResponse([
        {
          factIndex: 0,
          action: 'SUPERSEDE',
          targetMemoryId: '0',
          supersessionReason: 'reason',
        },
      ]),
    );
    const consolidator = createConsolidator(client);
    const result = await consolidator.consolidate({ text: 'new' }, [{ id: 'uuid-1', text: 'old' }]);

    expect(result.action).toBe('ADD');
  });

  it('downgrades SUPERSEDE to ADD when supersessionReason is missing', async () => {
    const client = createMockClient(
      decisionsResponse([
        {
          factIndex: 0,
          action: 'SUPERSEDE',
          mergedText: 'new text',
          targetMemoryId: '0',
        },
      ]),
    );
    const consolidator = createConsolidator(client);
    const result = await consolidator.consolidate({ text: 'new' }, [{ id: 'uuid-1', text: 'old' }]);

    expect(result.action).toBe('ADD');
  });
});

describe('consolidation prompt content', () => {
  it('system prompt includes UPDATE vs SUPERSEDE decision tree', async () => {
    const client = createMockClient(decisionsResponse([{ factIndex: 0, action: 'NOOP' }]));
    const consolidator = createConsolidator(client);
    await consolidator.consolidateBatch([
      { newFact: { text: 'test' }, similarMemories: [{ id: 'uuid-1', text: 'existing' }] },
    ]);

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      systemPrompt: string;
    };
    expect(call.systemPrompt).toContain('SUPERSEDE');
    expect(call.systemPrompt).toContain('UPDATE vs SUPERSEDE DECISION TREE');
    expect(call.systemPrompt).toContain('"Works at Google" -> "Works at Meta"');
    expect(call.systemPrompt).toContain('"Likes coffee" -> "Likes black coffee"');
    expect(call.systemPrompt).toContain('MISLEADING');
    expect(call.systemPrompt).toContain('INCOMPLETE');
  });

  it('system prompt includes SUPERSEDE requirements', async () => {
    const client = createMockClient(decisionsResponse([{ factIndex: 0, action: 'NOOP' }]));
    const consolidator = createConsolidator(client);
    await consolidator.consolidateBatch([
      { newFact: { text: 'test' }, similarMemories: [{ id: 'uuid-1', text: 'existing' }] },
    ]);

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      systemPrompt: string;
    };
    expect(call.systemPrompt).toContain('supersessionReason');
    expect(call.systemPrompt).toContain('mergedText');
    expect(call.systemPrompt).toContain('validUntil');
  });

  it('system prompt includes batch instructions', async () => {
    const client = createMockClient(decisionsResponse([{ factIndex: 0, action: 'NOOP' }]));
    const consolidator = createConsolidator(client);
    await consolidator.consolidateBatch([
      { newFact: { text: 'test' }, similarMemories: [{ id: 'uuid-1', text: 'existing' }] },
    ]);

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      systemPrompt: string;
    };
    expect(call.systemPrompt).toContain('BATCH INSTRUCTIONS');
    expect(call.systemPrompt).toContain('one decision per fact');
    expect(call.systemPrompt).toContain('factIndex');
  });

  it('user prompt uses clear section delimiters per fact', async () => {
    const client = createMockClient(
      decisionsResponse([
        { factIndex: 0, action: 'NOOP' },
        { factIndex: 1, action: 'ADD', mergedText: 'new' },
      ]),
    );
    const consolidator = createConsolidator(client);
    await consolidator.consolidateBatch([
      { newFact: { text: 'fact A' }, similarMemories: [{ id: 'uuid-1', text: 'mem A' }] },
      { newFact: { text: 'fact B' }, similarMemories: [{ id: 'uuid-2', text: 'mem B' }] },
    ]);

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      userPrompt: string;
    };
    expect(call.userPrompt).toContain('--- Fact 0 ---');
    expect(call.userPrompt).toContain('--- Fact 1 ---');
    expect(call.userPrompt).toContain('New fact:');
    expect(call.userPrompt).toContain('Existing similar memories:');
  });

  it('passes consolidation schema to generate<T>()', async () => {
    const client = createMockClient(decisionsResponse([{ factIndex: 0, action: 'NOOP' }]));
    const consolidator = createConsolidator(client);
    await consolidator.consolidateBatch([
      { newFact: { text: 'test' }, similarMemories: [{ id: 'uuid-1', text: 'existing' }] },
    ]);

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      schema: Record<string, unknown>;
    };
    expect(call.schema).toBeDefined();
    const schema = call.schema as { properties?: { decisions?: unknown }; required?: string[] };
    expect(schema.properties?.decisions).toBeDefined();
    expect(schema.required).toContain('decisions');
  });

  it('uses custom system prompt when provided', async () => {
    const client = createMockClient(decisionsResponse([{ factIndex: 0, action: 'NOOP' }]));
    const customPrompt = 'Custom consolidation instructions here.';
    const consolidator = createConsolidator(client, { systemPrompt: customPrompt });
    await consolidator.consolidateBatch([
      { newFact: { text: 'test' }, similarMemories: [{ id: 'uuid-1', text: 'existing' }] },
    ]);

    const call = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      systemPrompt: string;
    };
    expect(call.systemPrompt).toBe(customPrompt);
  });
});

describe('retry logic', () => {
  const malformedResponse = { decisions: 'not-an-array' };
  const validResponse = decisionsResponse([{ factIndex: 0, action: 'NOOP' }]);

  const callArgs = {
    newFact: { text: 'new fact' },
    similarMemories: [{ id: 'uuid-1', text: 'old memory' }],
  };

  it('retries on malformed response and succeeds on second attempt', async () => {
    const client: LlmClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce(malformedResponse)
        .mockResolvedValueOnce(validResponse),
    };
    const consolidator = createConsolidator(client, { maxRetries: 2, baseDelayMs: 1 });
    const result = await consolidator.consolidate(callArgs.newFact, callArgs.similarMemories);

    expect(result.action).toBe('NOOP');
    expect(client.generate).toHaveBeenCalledTimes(2);
  });

  it('retries on engine AppError and succeeds', async () => {
    const client: LlmClient = {
      generate: vi
        .fn()
        .mockRejectedValueOnce(new AppError('inference timeout'))
        .mockResolvedValueOnce(validResponse),
    };
    const consolidator = createConsolidator(client, { maxRetries: 2, baseDelayMs: 1 });
    const result = await consolidator.consolidate(callArgs.newFact, callArgs.similarMemories);

    expect(result.action).toBe('NOOP');
    expect(client.generate).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-retryable errors', async () => {
    const client: LlmClient = {
      generate: vi.fn().mockRejectedValue(new Error('unexpected')),
    };
    const consolidator = createConsolidator(client, { maxRetries: 2, baseDelayMs: 1 });

    await expect(
      consolidator.consolidate(callArgs.newFact, callArgs.similarMemories),
    ).rejects.toThrow('unexpected');
    expect(client.generate).toHaveBeenCalledTimes(1);
  });

  it('does not retry on non-retryable ConsolidationError', async () => {
    const client: LlmClient = {
      generate: vi
        .fn()
        .mockResolvedValue(decisionsResponse([{ factIndex: 0, mergedText: 'no action' }])),
    };
    const consolidator = createConsolidator(client, { maxRetries: 2, baseDelayMs: 1 });

    await expect(
      consolidator.consolidate(callArgs.newFact, callArgs.similarMemories),
    ).rejects.toThrow('Consolidator payload action is invalid.');
    expect(client.generate).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries and throws the last error', async () => {
    const client = createMockClient(malformedResponse);
    const consolidator = createConsolidator(client, { maxRetries: 1, baseDelayMs: 1 });

    await expect(
      consolidator.consolidate(callArgs.newFact, callArgs.similarMemories),
    ).rejects.toThrow('Consolidator batch response missing decisions array.');
    expect(client.generate).toHaveBeenCalledTimes(2);
  });

  it('retries on invalid payload (null response) and succeeds', async () => {
    const client: LlmClient = {
      generate: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(validResponse),
    };
    const consolidator = createConsolidator(client, { maxRetries: 2, baseDelayMs: 1 });
    const result = await consolidator.consolidate(callArgs.newFact, callArgs.similarMemories);

    expect(result.action).toBe('NOOP');
    expect(client.generate).toHaveBeenCalledTimes(2);
  });

  it('maxRetries=0 throws immediately without retry', async () => {
    const client = createMockClient(malformedResponse);
    const consolidator = createConsolidator(client, { maxRetries: 0, baseDelayMs: 1 });

    await expect(
      consolidator.consolidate(callArgs.newFact, callArgs.similarMemories),
    ).rejects.toThrow('Consolidator batch response missing decisions array.');
    expect(client.generate).toHaveBeenCalledTimes(1);
  });
});
