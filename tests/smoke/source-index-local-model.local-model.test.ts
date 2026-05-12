import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, PristineLocal } from '../../dist/index.js';

const tempDirs: string[] = [];

describe('local-model source-index smoke', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores and recalls a semantic source pointer with the default local embedder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pristine-source-index-smoke-'));
    tempDirs.push(dir);
    const db = createDatabase(join(dir, 'pristine.db'));
    const client = await PristineLocal.create({ db, baseDir: dir, keysDir: join(dir, 'keys') });

    try {
      await client.store(
        [
          {
            text: 'local source chunk smoke verifies semantic pointer retrieval',
            chunkId: 'source-smoke-1',
            sourceKind: 'smoke',
            sourceUri: 'file:///tmp/source-smoke.txt',
          },
        ],
        { projectId: 'source-smoke' },
      );

      const hits = await client.recall('semantic pointer retrieval', {
        projectId: 'source-smoke',
        limit: 1,
      });

      expect(hits[0]).toMatchObject({
        chunkId: 'source-smoke-1',
        sourceUri: 'file:///tmp/source-smoke.txt',
      });
    } finally {
      try {
        await client.dispose();
      } finally {
        db.close();
      }
    }
  });
});
