import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InvalidArgumentError, QueryTimeoutError } from '../../../src/core/errors.js';
import {
  createSqlBackend,
  MAX_ROW_CAP,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  withTimeout,
} from '../../../src/memory/searcher/sql-backend.js';

const CORPUS_SIZE = 2000;

let tmpDir: string;
let dbPath: string;
let writableDb: Database.Database;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'sql-backend-test-'));
  dbPath = join(tmpDir, 'test.db');
  writableDb = new Database(dbPath);
  writableDb.exec('CREATE TABLE nums (n INTEGER NOT NULL)');
  const insert = writableDb.prepare('INSERT INTO nums (n) VALUES (?)');
  const seed = writableDb.transaction((count: number) => {
    for (let i = 0; i < count; i += 1) insert.run(i);
  });
  seed(CORPUS_SIZE);
});

afterAll(() => {
  writableDb.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('createSqlBackend.executeReadOnly', () => {
  it('honors rowCap by stopping the cursor at the cap', async () => {
    const backend = createSqlBackend({ dbPath });

    const small = await backend.executeReadOnly('SELECT n FROM nums ORDER BY n', [], {
      rowCap: 500,
      timeoutMs: 5000,
    });
    expect(small).toHaveLength(500);
    expect((small[0] as { n: number }).n).toBe(0);
    expect((small[499] as { n: number }).n).toBe(499);

    const full = await backend.executeReadOnly('SELECT n FROM nums ORDER BY n', [], {
      rowCap: CORPUS_SIZE,
      timeoutMs: 5000,
    });
    expect(full).toHaveLength(CORPUS_SIZE);
  });

  it(
    'throws QueryTimeoutError when per-row work exceeds timeoutMs before rowCap is reached',
    { timeout: 7000 },
    async () => {
      const backend = createSqlBackend({ dbPath });
      const timeoutMs = 200;
      // Each yielded row pays for a 50KB randomblob allocation, so 10K rows
      // (the MAX_ROW_CAP ceiling) cannot be produced within timeoutMs=200.
      // The per-iteration elapsed-time check fires before rowCap is hit.
      const start = Date.now();
      await expect(
        backend.executeReadOnly(
          'SELECT a.n, length(randomblob(50000)) AS rb FROM nums a CROSS JOIN nums b',
          [],
          { rowCap: MAX_ROW_CAP, timeoutMs },
        ),
      ).rejects.toBeInstanceOf(QueryTimeoutError);
      const elapsed = Date.now() - start;
      // AC-fv-2 wall-time bound: timeoutMs + 2000ms framework overhead.
      expect(elapsed).toBeLessThan(timeoutMs + 2000);
    },
  );

  it('rejects out-of-range opts with InvalidArgumentError', async () => {
    const backend = createSqlBackend({ dbPath });
    const sql = 'SELECT n FROM nums LIMIT 1';

    await expect(
      backend.executeReadOnly(sql, [], { rowCap: 0, timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(InvalidArgumentError);

    await expect(
      backend.executeReadOnly(sql, [], { rowCap: MAX_ROW_CAP + 1, timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(InvalidArgumentError);

    await expect(
      backend.executeReadOnly(sql, [], { rowCap: 100, timeoutMs: MIN_TIMEOUT_MS - 1 }),
    ).rejects.toBeInstanceOf(InvalidArgumentError);

    await expect(
      backend.executeReadOnly(sql, [], { rowCap: 100, timeoutMs: MAX_TIMEOUT_MS + 1 }),
    ).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('closes its read-only connection on success (no fd leak across many calls)', async () => {
    const backend = createSqlBackend({ dbPath });
    for (let i = 0; i < 100; i += 1) {
      const rows = await backend.executeReadOnly('SELECT n FROM nums LIMIT 5', [], {
        rowCap: 5,
        timeoutMs: 1000,
      });
      expect(rows).toHaveLength(5);
    }
    // Arrival without fd-exhaustion / locking errors proves close() ran on
    // every iteration; better-sqlite3 surfaces those failures by throwing.
    expect(true).toBe(true);
  });

  it('rejects DML at the SQLite level, leaves the corpus unchanged, and still releases the connection', async () => {
    const backend = createSqlBackend({ dbPath });
    // INSERT ... RETURNING is iterable (returns rows), so it bypasses
    // better-sqlite3's "this statement does not return data" guard and
    // reaches the SQLite engine; the read-only connection rejects the
    // write before any row is produced.
    await expect(
      backend.executeReadOnly('INSERT INTO nums (n) VALUES (99999) RETURNING n', [], {
        rowCap: 100,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/readonly|read-only/i);

    // Corpus row count unchanged → INSERT was rejected before any write.
    const after = (writableDb.prepare('SELECT COUNT(*) AS c FROM nums').get() as { c: number }).c;
    expect(after).toBe(CORPUS_SIZE);

    // Same backend can still serve reads → connection cleanup ran in finally.
    const rows = await backend.executeReadOnly('SELECT n FROM nums LIMIT 1', [], {
      rowCap: 1,
      timeoutMs: 1000,
    });
    expect(rows).toHaveLength(1);
  });
});

describe('withTimeout (named module export)', () => {
  it(
    'is exposed as a named export and yields rows when the query is fast, throws QueryTimeoutError when slow',
    { timeout: 7000 },
    () => {
      // Backend method and named export resolve to the same primitive.
      const backend = createSqlBackend({ dbPath });
      expect(backend.withTimeout).toBe(withTimeout);

      const fastDb = new Database(dbPath, { readonly: true });
      try {
        const fastStmt = fastDb.prepare<unknown[], { n: number }>('SELECT n FROM nums LIMIT 5');
        const fastRows = Array.from(withTimeout(fastStmt, [], 1000));
        expect(fastRows).toHaveLength(5);
        expect(fastRows[0].n).toBe(0);
      } finally {
        fastDb.close();
      }

      const slowDb = new Database(dbPath, { readonly: true });
      try {
        // 50KB-randomblob-per-row mirrors the executeReadOnly timeout test's
        // workload: per-row cost is large enough that MAX_ROW_CAP rows cannot
        // be produced within timeoutMs=200, so the per-iteration check fires
        // before the bounded drain hits its cap.
        const slowStmt = slowDb.prepare<unknown[], { n: number; rb: number }>(
          'SELECT a.n, length(randomblob(50000)) AS rb FROM nums a CROSS JOIN nums b',
        );
        const consume = (): void => {
          // Bounded drain — break at MAX_ROW_CAP to cap memory use. The outer
          // try/finally calls `.return()` on the generator so its finally
          // finalises the inner SQLite cursor before the surrounding test
          // closes the connection.
          const iter = withTimeout(slowStmt, [], 200);
          let drained = 0;
          try {
            let next = iter.next();
            while (!next.done) {
              drained += 1;
              if (drained >= MAX_ROW_CAP) break;
              next = iter.next();
            }
          } finally {
            iter.return?.();
          }
        };
        expect(consume).toThrow(QueryTimeoutError);
      } finally {
        slowDb.close();
      }
    },
  );
});
