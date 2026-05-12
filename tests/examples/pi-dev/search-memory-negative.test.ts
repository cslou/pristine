import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
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
    return texts.map((text) => [text.toLowerCase().includes('sapphire') ? 1 : 0]);
  }
}

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'pristine-pi-search-negative-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

describe('PristinePiVectorSearcher negative cases', () => {
  it('returns clear validation errors and empty-index messages', async () => {
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
