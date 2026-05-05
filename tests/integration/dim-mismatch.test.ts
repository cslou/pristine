import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PristineLocal } from '../../src/client.js';
import { createDatabase } from '../../src/core/database.js';
import { InvalidArgumentError } from '../../src/core/errors.js';
import type { Embedder } from '../../src/core/interfaces.js';

// ---------------------------------------------------------------------------
// Cross-dim error path (load-bearing)
// ---------------------------------------------------------------------------
//
// Pins:
//   1. A DB seeded at one dim retains its `float[N]` typed vec_windows /
//      vec_sessions even after the file is reopened with a different-dim
//      embedder (vec0 has no `ALTER` and `CREATE ... IF NOT EXISTS` is a
//      no-op against the existing tables).
//   2. Reopening through `PristineLocal.create` throws `InvalidArgumentError`
//      before indexing/searching can reach sqlite-vec with the wrong vector
//      width — proves the documented "consumer who later changes dim must
//      hit a clear runtime error" behavior.

const TMP_DIRS: string[] = [];

const makeStubAtDim = (dim: number): Embedder => ({
  dim,
  embed: async (text: string): Promise<number[]> => {
    const seed = text.length / 1000;
    return Array.from({ length: dim }, (_, i) => seed + i * 1e-4);
  },
  embedBatch: async (texts: readonly string[]): Promise<number[][]> =>
    texts.map((text) => {
      const seed = text.length / 1000;
      return Array.from({ length: dim }, (_, i) => seed + i * 1e-4);
    }),
});

describe('cross-dim mismatch', () => {
  afterEach(() => {
    for (const dir of TMP_DIRS.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('searcher.vectorSearch throws InvalidArgumentError naming both 1024 and 768 when the DB was seeded at 768 and reopened at 1024', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pristine-dim-mismatch-'));
    TMP_DIRS.push(tmp);
    const dbPath = join(tmp, 'corpus.db');

    // -----------------------------------------------------------------------
    // Phase 1: seed at default dim=768
    // -----------------------------------------------------------------------
    const dbSeed: Database.Database = createDatabase({
      path: dbPath,
      loadSqliteVec: true,
      runIntegrityCheck: false,
    });
    const seedClient = await PristineLocal.create({
      db: dbSeed,
      embedder: makeStubAtDim(768),
    });

    const turns = [
      { role: 'user' as const, content: 'first message' },
      { role: 'assistant' as const, content: 'second message' },
      { role: 'user' as const, content: 'third message' },
      { role: 'assistant' as const, content: 'fourth message' },
    ];
    seedClient.storeAsync(turns, 'test-user', 'test-project');
    await seedClient.drainEmbedQueue();

    // Confirm the seed wrote float[768]
    const seedDdl = dbSeed
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'vec_windows'")
      .get() as { sql: string };
    expect(seedDdl.sql).toContain('float[768]');

    await seedClient.dispose();
    dbSeed.close();

    // -----------------------------------------------------------------------
    // Phase 2: reopen at dim=1024 (cross-dim — DB already has float[768])
    // -----------------------------------------------------------------------
    const dbReopen: Database.Database = createDatabase({
      path: dbPath,
      loadSqliteVec: true,
      runIntegrityCheck: false,
    });
    let captured: unknown = null;
    try {
      await PristineLocal.create({
        db: dbReopen,
        embedder: makeStubAtDim(1024),
      });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(InvalidArgumentError);
    const message = (captured as Error).message;
    expect(message).toMatch(/1024/);
    expect(message).toMatch(/768/);
    expect(message).toMatch(/vec_windows/);

    dbReopen.close();
  });
});
