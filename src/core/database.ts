import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { AppError } from './errors.js';

export interface DatabaseOptions {
  readonly path: string;
  readonly enableWal?: boolean;
  readonly runIntegrityCheck?: boolean;
  readonly loadSqliteVec?: boolean;
}

const DEFAULT_OPTIONS: Required<Omit<DatabaseOptions, 'path'>> = {
  enableWal: true,
  runIntegrityCheck: true,
  loadSqliteVec: true,
};

export function createDatabase(options: DatabaseOptions | string): Database.Database {
  const opts = typeof options === 'string' ? { path: options } : options;
  const config = { ...DEFAULT_OPTIONS, ...opts };

  const db = new Database(config.path);

  if (config.enableWal) {
    db.pragma('journal_mode = WAL');
  }

  if (config.runIntegrityCheck) {
    const result = db.pragma('integrity_check') as { integrity_check: string }[];
    const status = result[0]?.integrity_check;
    if (status !== 'ok') {
      db.close();
      throw new AppError(`SQLite integrity check failed: ${status ?? 'unknown'}`);
    }
  }

  if (config.loadSqliteVec) {
    sqliteVec.load(db);
  }

  return db;
}

export function createDefaultDatabase(dataDir?: string): Database.Database {
  const resolvedDir = dataDir ?? join(homedir(), '.pristine', 'data');
  mkdirSync(resolvedDir, { recursive: true });
  return createDatabase({ path: join(resolvedDir, 'pristine.db') });
}
