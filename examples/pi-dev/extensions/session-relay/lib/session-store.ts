import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import {
  MEMORY_SESSIONS_TABLE,
  type MemorySessionRow,
  type MemorySessionSourceHarness,
} from '../../../shared/lib/session-relay-schema.js';

export class SessionRelayStoreError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SessionRelayStoreError';
  }
}

export interface MemorySessionMetadata {
  readonly sourceHarness: MemorySessionSourceHarness;
  readonly sourceUri: string;
  readonly cwd: string;
  readonly firstMessageAt: string;
  readonly lastMessageAt: string;
  readonly visibleMessageCount: number;
  readonly updatedAt: string;
}

const assertSecureDirectory = (dirPath: string): void => {
  mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') return;
  const mode = statSync(dirPath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new SessionRelayStoreError(
      `Pi session relay database directory ${dirPath} must be private (mode 700 or stricter)`,
    );
  }
};

const chmodPrivateIfExists = (path: string): void => {
  if (process.platform === 'win32' || !existsSync(path)) return;
  chmodSync(path, 0o600);
};

const chmodDatabaseFiles = (dbPath: string): void => {
  chmodPrivateIfExists(dbPath);
  chmodPrivateIfExists(`${dbPath}-wal`);
  chmodPrivateIfExists(`${dbPath}-shm`);
  chmodPrivateIfExists(`${dbPath}-journal`);
};

export const openSessionRelayDatabase = (dbPath: string): Database.Database => {
  assertSecureDirectory(dirname(dbPath));
  const db = new Database(dbPath);
  db.pragma('journal_mode = DELETE');
  chmodDatabaseFiles(dbPath);
  return db;
};

export interface SessionMetadataStore {
  upsertSession(metadata: MemorySessionMetadata): void;
  getSession(sourceHarness: MemorySessionSourceHarness, sourceUri: string): MemorySessionRow | null;
  close?(): void;
}

export class SqliteSessionMetadataStore implements SessionMetadataStore {
  private readonly db: Database.Database;
  private readonly ownsDb: boolean;

  public constructor(params: { readonly db: Database.Database; readonly ownsDb?: boolean }) {
    this.db = params.db;
    this.ownsDb = params.ownsDb ?? false;
    this.initTables();
  }

  public upsertSession(metadata: MemorySessionMetadata): void {
    this.db
      .prepare(
        `INSERT INTO ${MEMORY_SESSIONS_TABLE}
           (source_harness, source_uri, cwd, first_message_at, last_message_at, visible_message_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_harness, source_uri) DO UPDATE SET
           cwd = excluded.cwd,
           first_message_at = excluded.first_message_at,
           last_message_at = excluded.last_message_at,
           visible_message_count = excluded.visible_message_count,
           updated_at = excluded.updated_at`,
      )
      .run(
        metadata.sourceHarness,
        metadata.sourceUri,
        metadata.cwd,
        metadata.firstMessageAt,
        metadata.lastMessageAt,
        metadata.visibleMessageCount,
        metadata.updatedAt,
      );
  }

  public getSession(
    sourceHarness: MemorySessionSourceHarness,
    sourceUri: string,
  ): MemorySessionRow | null {
    const row = this.db
      .prepare(
        `SELECT source_harness, source_uri, cwd, first_message_at, last_message_at, visible_message_count, updated_at
           FROM ${MEMORY_SESSIONS_TABLE}
          WHERE source_harness = ? AND source_uri = ?`,
      )
      .get(sourceHarness, sourceUri) as MemorySessionRow | undefined;
    return row ?? null;
  }

  public close(): void {
    if (this.ownsDb) this.db.close();
  }

  private initTables(): void {
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
CREATE TABLE IF NOT EXISTS ${MEMORY_SESSIONS_TABLE} (
  source_harness TEXT NOT NULL CHECK (source_harness IN ('pi', 'codex', 'claude')),
  source_uri TEXT NOT NULL,
  cwd TEXT NOT NULL,
  first_message_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  visible_message_count INTEGER NOT NULL CHECK (visible_message_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_harness, source_uri)
);
CREATE INDEX IF NOT EXISTS ix_memory_sessions_cwd_last_message
  ON ${MEMORY_SESSIONS_TABLE}(cwd, last_message_at);
`);
  }
}

export const createSqliteSessionMetadataStore = (params: {
  readonly dbPath: string;
}): SqliteSessionMetadataStore =>
  new SqliteSessionMetadataStore({
    db: openSessionRelayDatabase(params.dbPath),
    ownsDb: true,
  });
