import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { KeyManager } from '../../core/interfaces.js';
import { KekManagerError } from '../../core/errors.js';
import { computeKeyFingerprint, unwrapDek, wrapDek } from '../vault/asymmetric-crypto.js';

const KEK_LENGTH_BYTES = 32;

const USER_KEKS_DDL = `
CREATE TABLE IF NOT EXISTS user_keks (
  user_id TEXT PRIMARY KEY,
  wrapped_kek BLOB NOT NULL,
  key_id TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'rsa-oaep-256',
  created_at TEXT DEFAULT (datetime('now'))
);
`;

// ---------------------------------------------------------------------------
// Standalone functions
// ---------------------------------------------------------------------------

export const generateKek = (): Buffer => randomBytes(KEK_LENGTH_BYTES);

export const wrapKek = (kek: Buffer, publicKeyPem: string): Buffer => {
  if (kek.length !== KEK_LENGTH_BYTES) {
    throw new KekManagerError(`KEK must be exactly ${KEK_LENGTH_BYTES} bytes, got ${kek.length}.`);
  }
  return wrapDek(kek, publicKeyPem);
};

export const unwrapKek = (wrappedKek: Buffer, privateKeyPem: string): Buffer =>
  unwrapDek(wrappedKek, privateKeyPem);

export function initKekTable(db: Database.Database): void {
  db.exec(USER_KEKS_DDL);
}

// ---------------------------------------------------------------------------
// KekManager
// ---------------------------------------------------------------------------

interface KekRow {
  wrapped_kek: Buffer;
  key_id: string;
}

export class KekManager {
  private readonly db: Database.Database;
  private readonly keyManager: KeyManager;
  private readonly cache = new Map<string, Buffer>();

  public constructor(db: Database.Database, keyManager: KeyManager) {
    this.db = db;
    this.keyManager = keyManager;
    initKekTable(db);
  }

  public async getOrCreate(userId: string): Promise<Buffer> {
    const cached = this.cache.get(userId);
    if (cached) {
      return cached;
    }

    const existing = this.db
      .prepare('SELECT wrapped_kek, key_id FROM user_keks WHERE user_id = ?')
      .get(userId) as KekRow | undefined;

    if (existing) {
      const { privateKey } = await this.keyManager.getOrCreateKeyPair(userId);
      const kek = unwrapKek(existing.wrapped_kek, privateKey);
      this.cache.set(userId, kek);
      return kek;
    }

    const { publicKey, privateKey } = await this.keyManager.getOrCreateKeyPair(userId);
    const fingerprint = computeKeyFingerprint(publicKey);
    const kek = generateKek();
    const wrappedKek = wrapKek(kek, publicKey);

    // INSERT OR IGNORE handles the race where concurrent callers both pass
    // the SELECT above. The loser's insert is silently ignored, and the
    // unconditional re-fetch below adopts the winner's stored KEK.
    this.db
      .prepare(
        `INSERT OR IGNORE INTO user_keks (user_id, wrapped_kek, key_id, algorithm)
         VALUES (?, ?, ?, 'rsa-oaep-256')`,
      )
      .run(userId, wrappedKek, fingerprint);

    const row = this.db
      .prepare('SELECT wrapped_kek FROM user_keks WHERE user_id = ?')
      .get(userId) as KekRow;

    const resolvedKek = unwrapKek(row.wrapped_kek, privateKey);
    this.cache.set(userId, resolvedKek);
    return resolvedKek;
  }

  public clearCache(userId?: string): void {
    if (userId !== undefined) {
      this.cache.delete(userId);
    } else {
      this.cache.clear();
    }
  }
}
