import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  seedPiJsonlIndexDb,
  type PiJsonlIndexSeedMessage,
} from './helpers/pi-jsonl-index-fixture.js';
import type { PiJsonlEmbedder } from '../../../examples/pi-dev/extensions/search-memory/lib/local-embedder.js';
import {
  createPristineRecallTool,
  createPristineVectorSearchTool,
  registerSearchMemoryExtension,
} from '../../../examples/pi-dev/extensions/search-memory/index.js';
import { PristinePiVectorSearcher } from '../../../examples/pi-dev/extensions/search-memory/lib/vector-search.js';

class KeywordEmbedder implements PiJsonlEmbedder {
  public async embed(text: string): Promise<readonly number[]> {
    const vectors = await this.embedBatch([text]);
    const first = vectors[0];
    if (first === undefined) throw new Error('missing vector');
    return first;
  }

  public async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return texts.map((text) => [
      text.toLowerCase().includes('sapphire') ? 1 : 0,
      text.toLowerCase().includes('amber') ? 1 : 0,
      text.toLowerCase().includes('cedar') ? 1 : 0,
    ]);
  }
}

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'pristine-pi-search-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

const message = (params: {
  readonly text: string;
  readonly sourceUri?: string;
  readonly entryId: string;
  readonly parentId?: string;
  readonly lineNumber: number;
  readonly timestamp?: string;
  readonly cwd?: string;
}): PiJsonlIndexSeedMessage => ({
  text: params.text,
  sourceUri: params.sourceUri ?? '/tmp/session-a.jsonl',
  entryId: params.entryId,
  parentId: params.parentId,
  lineNumber: params.lineNumber,
  timestamp: params.timestamp,
  cwd: params.cwd,
});

const seedDb = async (
  dbPath: string,
  messages: readonly PiJsonlIndexSeedMessage[],
): Promise<void> =>
  seedPiJsonlIndexDb({
    dbPath,
    messages,
    embedder: new KeywordEmbedder(),
    dimension: 3,
  });

describe('PristinePiVectorSearcher', () => {
  it('returns semantic hits with canonical Pi JSONL source pointers', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'pristine.db');
    await seedDb(dbPath, [
      message({
        text: 'The sprint 022 known phrase sapphire bridge belongs here.',
        entryId: 'entry-sapphire',
        parentId: 'parent-1',
        lineNumber: 7,
        timestamp: '2026-05-06T10:00:00.000Z',
        cwd: '/Users/lou/projects/test-pristine',
      }),
      message({ text: 'Amber archive unrelated note.', entryId: 'entry-amber', lineNumber: 8 }),
    ]);

    const searcher = new PristinePiVectorSearcher({ dbPath, embedder: new KeywordEmbedder() });
    const result = await searcher.search({ query: 'sapphire bridge', limit: 1 });

    expect(result.message).toBeUndefined();
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      rank: 1,
      chunkId: expect.any(String),
      snippet: '[snippet redacted by default; inspect sourcePointer with search-session-history]',
      sourcePointer: {
        sourceKind: 'pi-jsonl',
        sourceUri: '/tmp/session-a.jsonl',
        entryId: 'entry-sapphire',
        parentId: 'parent-1',
        lineNumber: 7,
        timestamp: '2026-05-06T10:00:00.000Z',
        cwd: '/Users/lou/projects/test-pristine',
      },
    });
    expect(result.results[0]?.score).toBeGreaterThan(0);
  });

  it('applies supported source-pointer filters', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'pristine.db');
    await seedDb(dbPath, [
      message({
        text: 'Sapphire bridge project A.',
        sourceUri: '/tmp/session-a.jsonl',
        entryId: 'entry-a',
        parentId: 'parent-a',
        lineNumber: 3,
        timestamp: '2026-05-06T10:00:00.000Z',
        cwd: '/repo/a',
      }),
      message({
        text: 'Sapphire bridge project B.',
        sourceUri: '/tmp/session-b.jsonl',
        entryId: 'entry-b',
        parentId: 'parent-b',
        lineNumber: 9,
        timestamp: '2026-05-07T10:00:00.000Z',
        cwd: '/repo/b',
      }),
    ]);

    const searcher = new PristinePiVectorSearcher({ dbPath, embedder: new KeywordEmbedder() });

    await expect(
      searcher.search({ query: 'sapphire', sourceUri: '/tmp/session-a.jsonl' }),
    ).resolves.toMatchObject({
      results: [
        expect.objectContaining({ sourcePointer: expect.objectContaining({ entryId: 'entry-a' }) }),
      ],
    });
    await expect(searcher.search({ query: 'sapphire', entryId: 'entry-b' })).resolves.toMatchObject(
      {
        results: [
          expect.objectContaining({
            sourcePointer: expect.objectContaining({ entryId: 'entry-b' }),
          }),
        ],
      },
    );
    await expect(
      searcher.search({ query: 'sapphire', parentId: 'parent-a' }),
    ).resolves.toMatchObject({
      results: [
        expect.objectContaining({
          sourcePointer: expect.objectContaining({ parentId: 'parent-a' }),
        }),
      ],
    });
    await expect(searcher.search({ query: 'sapphire', lineNumber: 9 })).resolves.toMatchObject({
      results: [
        expect.objectContaining({ sourcePointer: expect.objectContaining({ lineNumber: 9 }) }),
      ],
    });
    await expect(searcher.search({ query: 'sapphire', cwd: '/repo/b' })).resolves.toMatchObject({
      results: [
        expect.objectContaining({ sourcePointer: expect.objectContaining({ cwd: '/repo/b' }) }),
      ],
    });
    await expect(
      searcher.search({
        query: 'sapphire',
        timestampFrom: '2026-05-07T00:00:00.000Z',
        timestampTo: '2026-05-08T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({
      results: [
        expect.objectContaining({ sourcePointer: expect.objectContaining({ entryId: 'entry-b' }) }),
      ],
    });
    await expect(
      searcher.search({ query: 'sapphire', sourceUri: '/tmp/missing.jsonl' }),
    ).resolves.toMatchObject({
      results: [],
      message: 'No Pristine Pi vector hits matched the provided filters.',
    });
  });

  it('finds filtered hits outside the unfiltered top-k', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'pristine.db');
    await seedDb(dbPath, [
      message({
        text: 'Amber exact nearest global hit.',
        sourceUri: '/tmp/session-a.jsonl',
        entryId: 'entry-a',
        lineNumber: 3,
      }),
      message({
        text: 'Cedar filtered hit farther from amber.',
        sourceUri: '/tmp/session-b.jsonl',
        entryId: 'entry-b',
        lineNumber: 4,
      }),
      message({
        text: 'Cedar second filtered hit also farther from amber.',
        sourceUri: '/tmp/session-b.jsonl',
        entryId: 'entry-c',
        lineNumber: 5,
      }),
    ]);

    const searcher = new PristinePiVectorSearcher({ dbPath, embedder: new KeywordEmbedder() });
    const result = await searcher.search({
      query: 'amber',
      sourceUri: '/tmp/session-b.jsonl',
      limit: 1,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.sourcePointer.entryId).toBe('entry-b');
  });

  it('asks callers to narrow overly broad filtered searches before embedding', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'pristine.db');
    await seedDb(
      dbPath,
      Array.from({ length: 5001 }, (_, index) =>
        message({
          text: `Amber broad candidate ${index}`,
          sourceUri: '/tmp/large-session.jsonl',
          entryId: `entry-${index}`,
          lineNumber: index + 1,
        }),
      ),
    );

    const searcher = new PristinePiVectorSearcher({ dbPath, embedder: new KeywordEmbedder() });
    await expect(
      searcher.search({ query: 'amber', sourceUri: '/tmp/large-session.jsonl', limit: 1 }),
    ).resolves.toEqual({
      results: [],
      message: 'Pristine Pi vector filter matches 5001 rows; narrow filters below 5000 rows.',
    });
  });

  it('rejects filtered rows with mismatched embedding dimensions', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'pristine.db');
    await seedPiJsonlIndexDb({
      dbPath,
      messages: [
        message({ text: 'Amber mismatched row.', entryId: 'entry-mismatch', lineNumber: 4 }),
      ],
      embedder: { embedBatch: async () => [[1, 0]] },
      dimension: 2,
    });

    const searcher = new PristinePiVectorSearcher({ dbPath, embedder: new KeywordEmbedder() });
    await expect(
      searcher.search({ query: 'amber', sourceUri: '/tmp/session-a.jsonl' }),
    ).rejects.toThrow('embedding dimension mismatch');
  });

  it('redacts returned snippets by default', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'pristine.db');
    await seedDb(dbPath, [
      message({
        text: 'Sapphire token Bearer abcdefghijklmnopqrstuvwxyz012345 and dev@example.com should not leak.',
        entryId: 'entry-secret',
        lineNumber: 4,
      }),
    ]);

    const searcher = new PristinePiVectorSearcher({ dbPath, embedder: new KeywordEmbedder() });
    const result = await searcher.search({ query: 'sapphire token' });

    expect(result.results[0]?.snippet).toBe(
      '[snippet redacted by default; inspect sourcePointer with search-session-history]',
    );
  });

  it('registers reusable Pi recall tools with expected response shape', async () => {
    const calls: unknown[] = [];
    const searcher = {
      async search(input: unknown) {
        calls.push(input);
        return {
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
        };
      },
    };
    const tool = createPristineRecallTool(searcher);
    const legacyTool = createPristineVectorSearchTool(searcher);

    const result = await tool.execute('tool-call-1', { query: 'sapphire', limit: 1 });

    await expect(tool.execute('tool-call-2', { query: 123 })).rejects.toThrow(
      'pristine_recall query must be a non-empty string',
    );
    await expect(legacyTool.execute('tool-call-3', { query: 123 })).rejects.toThrow(
      'pristine_vector_search query must be a non-empty string',
    );

    expect(tool.name).toBe('pristine_recall');
    expect(legacyTool.name).toBe('pristine_vector_search');
    expect(calls).toEqual([{ query: 'sapphire', limit: 1 }]);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toContain('known phrase sapphire bridge');
    expect(result.details.results).toHaveLength(1);

    const registered: { readonly name: string }[] = [];
    registerSearchMemoryExtension(
      { registerTool: (registeredTool) => registered.push(registeredTool) },
      () => searcher,
    );
    expect(registered.map((registeredTool) => registeredTool.name)).toEqual([
      'pristine_recall',
      'pristine_vector_search',
    ]);
  });

  it('returns clear negative-case errors and empty-index messages', async () => {
    const dir = await makeTempDir();
    const missingDbPath = join(dir, 'missing.db');
    const searcher = new PristinePiVectorSearcher({
      dbPath: missingDbPath,
      embedder: new KeywordEmbedder(),
    });

    await expect(searcher.search({ query: '   ' })).rejects.toThrow(
      'query must be a non-empty string',
    );
    await expect(searcher.search({ query: 'sapphire', limit: 0 })).rejects.toThrow(
      'limit must be an integer',
    );
    await expect(searcher.search({ query: 'sapphire', lineNumber: 0 })).rejects.toThrow(
      'lineNumber must be a positive integer',
    );
    await expect(searcher.search({ query: 'sapphire' })).rejects.toThrow('database is unavailable');

    const emptyDbPath = join(dir, 'empty.db');
    new Database(emptyDbPath).close();
    const emptySearcher = new PristinePiVectorSearcher({
      dbPath: emptyDbPath,
      embedder: new KeywordEmbedder(),
    });
    await expect(emptySearcher.search({ query: 'sapphire' })).resolves.toEqual({
      results: [],
      message: 'Pristine Pi vector index is empty; run jsonl-index first.',
    });
  });
});
