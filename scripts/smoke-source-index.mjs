import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, PristineLocal } from '../dist/index.js';

const dir = mkdtempSync(join(tmpdir(), 'pristine-source-index-smoke-'));
const db = createDatabase(join(dir, 'pristine.db'));

try {
  const client = await PristineLocal.create({ db, baseDir: dir, keysDir: join(dir, 'keys') });
  await client.indexSourceChunks(
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

  const hits = await client.searchSourceChunks('semantic pointer retrieval', {
    projectId: 'source-smoke',
    limit: 1,
  });
  if (hits[0]?.chunkId !== 'source-smoke-1') {
    throw new Error(`Expected source-smoke-1 top hit, got ${hits[0]?.chunkId ?? 'none'}`);
  }
  if (hits[0].sourceUri !== 'file:///tmp/source-smoke.txt') {
    throw new Error(`Expected source pointer URI, got ${String(hits[0].sourceUri)}`);
  }
  await client.dispose();
  console.log('source-index smoke: PASS');
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
