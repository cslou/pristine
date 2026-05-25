import type Database from 'better-sqlite3';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
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

const unwrapKekForUser = async (
  wrappedKek: Buffer,
  keyManager: KeyManager,
  userId: string,
): Promise<Buffer> => await keyManager.unwrap(userId, wrappedKek);

// AES-256-KW (RFC 3394) uses a fixed 8-byte IV
const AES_KW_IV = Buffer.from('A6A6A6A6A6A6A6A6', 'hex');
const DEK_LENGTH_BYTES = 32;
const AES_KW_WRAPPED_LENGTH = 40; // 32-byte DEK + 8-byte integrity check

export const wrapDekWithKek = (dek: Buffer, kek: Buffer): Buffer => {
  if (dek.length !== DEK_LENGTH_BYTES) {
    throw new KekManagerError(`DEK must be exactly ${DEK_LENGTH_BYTES} bytes, got ${dek.length}.`);
  }
  if (kek.length !== KEK_LENGTH_BYTES) {
    throw new KekManagerError(`KEK must be exactly ${KEK_LENGTH_BYTES} bytes, got ${kek.length}.`);
  }
  const cipher = createCipheriv('aes256-wrap', kek, AES_KW_IV);
  return Buffer.concat([cipher.update(dek), cipher.final()]);
};

export const unwrapDekWithKek = (wrappedDek: Buffer, kek: Buffer): Buffer => {
  if (wrappedDek.length !== AES_KW_WRAPPED_LENGTH) {
    throw new KekManagerError(
      `Wrapped DEK must be exactly ${AES_KW_WRAPPED_LENGTH} bytes, got ${wrappedDek.length}.`,
    );
  }
  if (kek.length !== KEK_LENGTH_BYTES) {
    throw new KekManagerError(`KEK must be exactly ${KEK_LENGTH_BYTES} bytes, got ${kek.length}.`);
  }
  const decipher = createDecipheriv('aes256-wrap', kek, AES_KW_IV);
  return Buffer.concat([decipher.update(wrappedDek), decipher.final()]);
};

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
      const kek = await unwrapKekForUser(existing.wrapped_kek, this.keyManager, userId);
      this.cache.set(userId, kek);
      return kek;
    }

    const { publicKey } = await this.keyManager.getOrCreatePublicKey(userId);
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

    const resolvedKek = await unwrapKekForUser(row.wrapped_kek, this.keyManager, userId);
    this.cache.set(userId, resolvedKek);
    return resolvedKek;
  }

  public updateWrappedKek(userId: string, wrappedKek: Buffer, keyId: string): void {
    const result = this.db
      .prepare('UPDATE user_keks SET wrapped_kek = ?, key_id = ? WHERE user_id = ?')
      .run(wrappedKek, keyId, userId);
    if (result.changes === 0) {
      throw new KekManagerError(`No KEK found for user ${userId} — cannot update.`);
    }
    this.cache.delete(userId);
  }

  public clearCache(userId?: string): void {
    if (userId !== undefined) {
      this.cache.delete(userId);
    } else {
      this.cache.clear();
    }
  }
}
