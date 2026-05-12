import { describe, expect, it } from 'vitest';
import {
  createPristineRecallTool,
  registerSearchMemoryExtension,
} from '../../../examples/pi-dev/extensions/search-memory/index.js';

interface SearchInput {
  readonly query: string;
  readonly limit?: number;
}

const makeSearchResult = () => ({
  results: [
    {
      rank: 1,
      score: 1,
      chunkId: 'chunk-1',
      snippet: 'known phrase sapphire bridge',
      sourcePointer: {
        sourceKind: 'pi-jsonl' as const,
        sourceUri: '/tmp/session.jsonl',
        lineNumber: 1,
      },
    },
  ],
});

describe('search-memory Pi tool wrappers', () => {
  it('registers only the canonical recall tool', () => {
    const searcher = { search: async (_input: SearchInput) => makeSearchResult() };
    const registered: { readonly name: string }[] = [];

    registerSearchMemoryExtension(
      { registerTool: (registeredTool) => registered.push(registeredTool) },
      () => searcher,
    );

    expect(registered.map((registeredTool) => registeredTool.name)).toEqual(['pristine_recall']);
  });

  it('validates canonical tool inputs', async () => {
    const searcher = { search: async (_input: SearchInput) => makeSearchResult() };
    const tool = createPristineRecallTool(searcher);

    await expect(tool.execute('tool-call-1', { query: 123 })).rejects.toThrow(
      'pristine_recall query must be a non-empty string',
    );
  });

  it('returns the successful canonical response shape', async () => {
    const calls: unknown[] = [];
    const searcher = {
      async search(input: SearchInput) {
        calls.push(input);
        return makeSearchResult();
      },
    };
    const tool = createPristineRecallTool(searcher);

    const result = await tool.execute('tool-call-1', { query: 'sapphire', limit: 1 });

    expect(tool.name).toBe('pristine_recall');
    expect(calls).toEqual([{ query: 'sapphire', limit: 1 }]);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toContain('known phrase sapphire bridge');
    expect(result.details.results).toHaveLength(1);
  });
});
