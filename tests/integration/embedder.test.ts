import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/core/database.js';
import { Pristine } from '../../src/client.js';
import { LocalEmbedder } from '../../src/embedder/local/index.js';

// These tests download the real Nomic Embed model (~300 MB) on first run.
// Skip in CI by setting SKIP_SLOW_TESTS=1.
const skipSlow = process.env.SKIP_SLOW_TESTS === '1';

describe.skipIf(skipSlow)('LocalEmbedder integration (real model)', () => {
  let embedder: LocalEmbedder;

  beforeAll(() => {
    embedder = new LocalEmbedder();
  });

  afterAll(async () => {
    await embedder.dispose();
  });

  it('produces 768-dimensional vector from real model', async () => {
    const vector = await embedder.embed('The user lives in Tokyo.');

    expect(vector).toHaveLength(768);
    expect(vector.every((v) => typeof v === 'number' && Number.isFinite(v))).toBe(true);
    // Normalized vectors should have magnitude close to 1
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1.0, 1);
  }, 300000);

  it('similar texts have higher cosine similarity than dissimilar texts', async () => {
    const [vecA, vecB, vecC] = await Promise.all([
      embedder.embed('I enjoy drinking coffee every morning.'),
      embedder.embed('My favorite beverage is a morning espresso.'),
      embedder.embed('The stock market closed higher today.'),
    ]);

    const simAB = cosineSimilarity(vecA!, vecB!);
    const simAC = cosineSimilarity(vecA!, vecC!);

    // Coffee/espresso should be more similar than coffee/stock market
    expect(simAB).toBeGreaterThan(simAC);
    expect(simAB).toBeGreaterThan(0.5);
  }, 300000);
});

describe.skipIf(skipSlow)('source-index integration (real local embedder)', () => {
  it('indexes and searches one source chunk with the default local embedder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pristine-source-index-integration-'));
    const db = createDatabase(join(dir, 'source-index.db'));
    const embedder = new LocalEmbedder();
    let client: Pristine | undefined;

    try {
      client = await Pristine.create({ db, embedder, keysDir: join(dir, 'keys') });
      await client.store(
        [
          {
            text: 'real model source-index integration remembers obsidian falcon',
            chunkId: 'real-source-1',
            sourceKind: 'integration',
          },
        ],
        { projectId: 'integration-source-index' },
      );
      const hits = await client.recall('obsidian falcon memory', {
        projectId: 'integration-source-index',
        limit: 1,
      });

      expect(hits[0]).toMatchObject({
        chunkId: 'real-source-1',
        sourceKind: 'integration',
      });
    } finally {
      await client?.dispose();
      db.close();
      rmSync(dir, { force: true, recursive: true });
    }
  }, 300000);
});

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
