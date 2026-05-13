import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  seedPiJsonlIndexDb,
  type PiJsonlIndexSeedMessage,
} from './helpers/pi-jsonl-index-fixture.js';
import type { PiJsonlEmbedder } from '../../../examples/pi-dev/extensions/search-memory/lib/local-embedder.js';
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
      snippet: 'The sprint 022 known phrase sapphire bridge belongs here.',
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

  it('returns actual snippets bounded to 800 Unicode characters', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'pristine.db');
    const longSnippet = `token ${'token '.repeat(900)}`;
    await seedDb(dbPath, [
      message({
        text: longSnippet,
        entryId: 'entry-long',
        lineNumber: 4,
      }),
    ]);

    const searcher = new PristinePiVectorSearcher({ dbPath, embedder: new KeywordEmbedder() });
    const result = await searcher.search({ query: 'sapphire token' });
    const snippet = result.results[0]?.snippet;

    expect(snippet).toBe(`${Array.from(longSnippet).slice(0, 799).join('')}…`);
    expect(Array.from(snippet ?? '')).toHaveLength(800);
  });

  it('returns actual snippets without memory-side redaction', async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, 'pristine.db');
    const rawSnippet =
      'Sapphire token Bearer abcdefghijklmnopqrstuvwxyz012345 and dev@example.com remain relevant.';
    await seedDb(dbPath, [
      message({
        text: rawSnippet,
        entryId: 'entry-secret',
        lineNumber: 4,
      }),
    ]);

    const searcher = new PristinePiVectorSearcher({ dbPath, embedder: new KeywordEmbedder() });
    const result = await searcher.search({ query: 'sapphire token' });

    expect(result.results[0]?.snippet).toBe(rawSnippet);
  });
});
