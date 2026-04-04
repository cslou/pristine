import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase } from '../../src/core/database.js';

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pristine-test-'));
  return join(dir, 'test.db');
}

const dbPaths: string[] = [];

afterEach(() => {
  for (const p of dbPaths) {
    for (const suffix of ['', '-wal', '-shm']) {
      const file = p + suffix;
      if (existsSync(file)) {
        unlinkSync(file);
      }
    }
  }
  dbPaths.length = 0;
});

describe('createDatabase', () => {
  it('creates a database file at the given path (object form)', () => {
    const dbPath = createTempDbPath();
    dbPaths.push(dbPath);

    const db = createDatabase({ path: dbPath });
    db.close();

    expect(existsSync(dbPath)).toBe(true);
  });

  it('accepts a string path shorthand', () => {
    const dbPath = createTempDbPath();
    dbPaths.push(dbPath);

    const db = createDatabase(dbPath);
    db.close();

    expect(existsSync(dbPath)).toBe(true);
  });

  it('enables WAL mode by default', () => {
    const dbPath = createTempDbPath();
    dbPaths.push(dbPath);

    const db = createDatabase(dbPath);
    const result = db.pragma('journal_mode') as { journal_mode: string }[];

    expect(result[0]?.journal_mode).toBe('wal');
    db.close();
  });

  it('passes integrity check on a fresh database', () => {
    const dbPath = createTempDbPath();
    dbPaths.push(dbPath);

    const db = createDatabase(dbPath);
    db.close();
  });

  it('works with :memory: path', () => {
    const db = createDatabase(':memory:');
    const result = db.pragma('journal_mode') as { journal_mode: string }[];

    // WAL is not supported for in-memory databases; SQLite falls back to 'memory'
    expect(result[0]?.journal_mode).toBe('memory');
    db.close();
  });

  it('loads sqlite-vec extension', () => {
    const db = createDatabase(':memory:');

    // sqlite-vec registers vec0 virtual table module; verify by creating one
    db.exec('CREATE VIRTUAL TABLE test_vec USING vec0(embedding float[3])');
    const info = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_vec'")
      .get() as { name: string } | undefined;

    expect(info?.name).toBe('test_vec');
    db.close();
  });

  it('can disable WAL mode', () => {
    const dbPath = createTempDbPath();
    dbPaths.push(dbPath);

    const db = createDatabase({ path: dbPath, enableWal: false });
    const result = db.pragma('journal_mode') as { journal_mode: string }[];

    expect(result[0]?.journal_mode).toBe('delete');
    db.close();
  });

  it('can disable sqlite-vec loading', () => {
    const db = createDatabase({ path: ':memory:', loadSqliteVec: false });

    // Without sqlite-vec, vec0 should not be available
    expect(() => {
      db.exec('CREATE VIRTUAL TABLE test_vec USING vec0(embedding float[3])');
    }).toThrow();
    db.close();
  });
});
