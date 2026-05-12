import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { decodeBase64Url, encodeBase64Url } from '../base64url.js';
import { SensitiveNotFoundError, VaultEntryContractError } from '../../../core/errors.js';
import type { VaultStore } from '../../../core/interfaces.js';
import type {
  DeleteSensitiveResult,
  ListSensitiveOptions,
  SensitiveRef,
  SensitiveSummary,
  UpdateSensitiveInput,
  VaultEntry,
  VaultEntryInput,
  ZkV2EncryptedValue,
  ZkV2EncryptedValueMetadata,
} from '../../../core/types.js';

const CLIENT_V2 = 'client_v2';

interface VaultRow {
  id: string;
  memory_id: string | null;
  user_id: string | null;
  placeholder_id: string | null;
  sensitive_type: string;
  encrypted_value: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  created_at: string;
  encryption_mode: string | null;
  encryption_metadata: string | null;
}

interface PublicKeyRow {
  user_id: string;
  public_key: string;
  fingerprint: string;
  created_at: string;
}

interface SensitiveSummaryRow {
  entry_id: string;
  user_id: string;
  placeholder_id: string;
  sensitive_type: string;
  alias: string | null;
  created_at: string;
  updated_at: string | null;
}

const VAULT_DDL = `
CREATE TABLE IF NOT EXISTS vault_entries (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  user_id TEXT,
  placeholder_id TEXT,
  sensitive_type TEXT NOT NULL,
  encrypted_value BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  encryption_mode TEXT DEFAULT 'client_v2',
  encryption_metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vault_memory_id ON vault_entries(memory_id);
CREATE INDEX IF NOT EXISTS idx_vault_placeholder_id ON vault_entries(placeholder_id);
CREATE INDEX IF NOT EXISTS idx_vault_user_id ON vault_entries(user_id);

CREATE TABLE IF NOT EXISTS user_public_keys (
  user_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vault_entry_metadata (
  entry_id TEXT PRIMARY KEY REFERENCES vault_entries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  placeholder_id TEXT NOT NULL,
  alias TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, placeholder_id)
);
CREATE INDEX IF NOT EXISTS idx_vault_entry_metadata_user_placeholder
  ON vault_entry_metadata(user_id, placeholder_id);
`;

const parseZkV2EncryptionMetadata = (value: unknown): ZkV2EncryptedValueMetadata => {
  let candidate: unknown = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      throw new VaultEntryContractError('client_v2 vault metadata must be valid JSON.');
    }
  }

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new VaultEntryContractError('client_v2 vault metadata must be an object.');
  }

  const parsed = candidate as Partial<ZkV2EncryptedValueMetadata>;

  if (
    parsed.scheme !== 'zk-v2' ||
    parsed.algorithm !== 'aes-256-gcm' ||
    (parsed.keyWrapping !== 'rsa-oaep-256' && parsed.keyWrapping !== 'aes-256-kw+rsa-oaep-256') ||
    typeof parsed.keyId !== 'string' ||
    typeof parsed.wrappedDek !== 'string' ||
    typeof parsed.aad !== 'string'
  ) {
    throw new VaultEntryContractError(
      'client_v2 vault metadata is missing one or more required fields.',
    );
  }

  if (parsed.recoveryWrappedDek !== undefined && typeof parsed.recoveryWrappedDek !== 'string') {
    throw new VaultEntryContractError(
      'client_v2 vault metadata recoveryWrappedDek must be a string.',
    );
  }

  return {
    scheme: parsed.scheme,
    algorithm: parsed.algorithm,
    keyWrapping: parsed.keyWrapping,
    keyId: parsed.keyId,
    wrappedDek: parsed.wrappedDek,
    aad: parsed.aad,
    recoveryWrappedDek: parsed.recoveryWrappedDek,
  };
};

const mapRow = (row: VaultRow): VaultEntry => ({
  id: row.id,
  memoryId: row.memory_id ?? undefined,
  userId: row.user_id ?? undefined,
  placeholderId: row.placeholder_id ?? undefined,
  sensitiveType: row.sensitive_type,
  encryptedValue: row.encrypted_value,
  iv: row.iv,
  authTag: row.auth_tag,
  createdAt: row.created_at,
  encryptionMode: CLIENT_V2,
  encryptionMetadata: parseZkV2EncryptionMetadata(row.encryption_metadata),
});

const buildSafeLabel = (sensitiveType: string, sensitiveRef: SensitiveRef): string => {
  const normalizedRef = sensitiveRef.toLowerCase().replace(/[^a-z0-9]/g, '');
  const suffix = normalizedRef.slice(-6) || 'saved';
  return `${sensitiveType}-${suffix}`;
};

const mapSensitiveSummaryRow = (row: SensitiveSummaryRow): SensitiveSummary => ({
  sensitiveRef: row.placeholder_id,
  sensitiveType: row.sensitive_type,
  label: buildSafeLabel(row.sensitive_type, row.placeholder_id),
  alias: row.alias ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at ?? row.created_at,
});

export const toApprovedValue = (entry: VaultEntry): ZkV2EncryptedValue => {
  const metadata = entry.encryptionMetadata;
  if (!metadata) {
    throw new VaultEntryContractError('Encrypted vault entries must include encryptionMetadata.');
  }

  return {
    scheme: metadata.scheme,
    algorithm: metadata.algorithm,
    keyWrapping: metadata.keyWrapping,
    keyId: metadata.keyId,
    sensitiveType: entry.sensitiveType,
    ciphertext: encodeBase64Url(new Uint8Array(entry.encryptedValue)),
    iv: encodeBase64Url(new Uint8Array(entry.iv)),
    authTag: encodeBase64Url(new Uint8Array(entry.authTag)),
    wrappedDek: metadata.wrappedDek,
    aad: metadata.aad,
    recoveryWrappedDek: metadata.recoveryWrappedDek,
  };
};

export function initVaultTables(db: Database.Database): void {
  db.exec(VAULT_DDL);
}

export class SqliteVaultStore implements VaultStore {
  private readonly db: Database.Database;

  public constructor(db: Database.Database) {
    this.db = db;
    initVaultTables(db);
  }

  public async addEntries(entries: VaultEntryInput[]): Promise<VaultEntry[]> {
    if (entries.length === 0) {
      return [];
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO vault_entries (
        id, memory_id, user_id, placeholder_id, sensitive_type,
        encrypted_value, iv, auth_tag, encryption_mode, encryption_metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const selectStmt = this.db.prepare('SELECT * FROM vault_entries WHERE id = ?');

    const insertAll = this.db.transaction((items: VaultEntryInput[]) => {
      const results: VaultEntry[] = [];

      for (const entry of items) {
        const id = entry.entryId ?? randomUUID();
        const encryptedValue = Buffer.from(decodeBase64Url(entry.encrypted.ciphertext));
        const iv = Buffer.from(decodeBase64Url(entry.encrypted.iv));
        const authTag = Buffer.from(decodeBase64Url(entry.encrypted.authTag));
        const encryptionMetadata: ZkV2EncryptedValueMetadata = {
          scheme: entry.encrypted.scheme,
          algorithm: entry.encrypted.algorithm,
          keyWrapping: entry.encrypted.keyWrapping,
          keyId: entry.encrypted.keyId,
          wrappedDek: entry.encrypted.wrappedDek,
          aad: entry.encrypted.aad,
          recoveryWrappedDek: entry.encrypted.recoveryWrappedDek,
        };

        insertStmt.run(
          id,
          null,
          entry.userId,
          entry.placeholderId ?? null,
          entry.sensitiveType,
          encryptedValue,
          iv,
          authTag,
          CLIENT_V2,
          JSON.stringify(encryptionMetadata),
        );

        const row = selectStmt.get(id) as VaultRow | undefined;
        if (row) {
          results.push(mapRow(row));
        }
      }

      return results;
    });

    return insertAll(entries);
  }

  public async getEntriesByPlaceholderIds(
    userId: string,
    placeholderIds: string[],
  ): Promise<VaultEntry[]> {
    if (placeholderIds.length === 0) {
      return [];
    }

    const placeholders = placeholderIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT * FROM vault_entries
         WHERE user_id = ? AND placeholder_id IN (${placeholders})
         ORDER BY created_at`,
      )
      .all(userId, ...placeholderIds) as VaultRow[];

    return rows.map(mapRow);
  }

  public async listEntries(
    userId: string,
    options: ListSensitiveOptions = {},
  ): Promise<readonly SensitiveSummary[]> {
    let sql = `
      SELECT
        v.id AS entry_id,
        v.user_id,
        v.placeholder_id,
        v.sensitive_type,
        m.alias,
        v.created_at,
        m.updated_at
      FROM vault_entries v
      LEFT JOIN vault_entry_metadata m ON m.entry_id = v.id
      WHERE v.user_id = ? AND v.placeholder_id IS NOT NULL
    `;
    const params: Array<string | number> = [userId];

    if (options.sensitiveType !== undefined) {
      sql += ' AND v.sensitive_type = ?';
      params.push(options.sensitiveType);
    }
    if (options.createdFrom !== undefined) {
      sql += ' AND v.created_at >= ?';
      params.push(options.createdFrom);
    }
    if (options.createdTo !== undefined) {
      sql += ' AND v.created_at <= ?';
      params.push(options.createdTo);
    }

    sql += ' ORDER BY COALESCE(m.updated_at, v.created_at) DESC, v.created_at DESC';

    if (options.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as SensitiveSummaryRow[];
    return rows.map(mapSensitiveSummaryRow);
  }

  public async getEntry(userId: string, sensitiveRef: SensitiveRef): Promise<SensitiveSummary | null> {
    const row = this.db
      .prepare(
        `
          SELECT
            v.id AS entry_id,
            v.user_id,
            v.placeholder_id,
            v.sensitive_type,
            m.alias,
            v.created_at,
            m.updated_at
          FROM vault_entries v
          LEFT JOIN vault_entry_metadata m ON m.entry_id = v.id
          WHERE v.user_id = ? AND v.placeholder_id = ?
          LIMIT 1
        `,
      )
      .get(userId, sensitiveRef) as SensitiveSummaryRow | undefined;

    return row ? mapSensitiveSummaryRow(row) : null;
  }

  public async updateEntry(
    userId: string,
    sensitiveRef: SensitiveRef,
    input: UpdateSensitiveInput,
  ): Promise<SensitiveSummary> {
    const baseRow = this.db
      .prepare(
        `
          SELECT id, user_id, placeholder_id
          FROM vault_entries
          WHERE user_id = ? AND placeholder_id = ?
          LIMIT 1
        `,
      )
      .get(userId, sensitiveRef) as
      | { id: string; user_id: string; placeholder_id: string }
      | undefined;

    if (!baseRow) {
      throw new SensitiveNotFoundError(`Sensitive entry not found for ref ${sensitiveRef}`);
    }

    const normalizedAlias =
      input.alias === undefined
        ? undefined
        : input.alias === null || input.alias.trim().length === 0
          ? null
          : input.alias.trim();

    const runUpdate = this.db.transaction(() => {
      const existingMetadata = this.db
        .prepare('SELECT entry_id FROM vault_entry_metadata WHERE entry_id = ? LIMIT 1')
        .get(baseRow.id) as { entry_id: string } | undefined;

      if (normalizedAlias === undefined) {
        return;
      }

      if (existingMetadata) {
        this.db
          .prepare(
            `
              UPDATE vault_entry_metadata
              SET alias = ?, updated_at = datetime('now')
              WHERE entry_id = ?
            `,
          )
          .run(normalizedAlias, baseRow.id);
        return;
      }

      this.db
        .prepare(
          `
            INSERT INTO vault_entry_metadata (
              entry_id, user_id, placeholder_id, alias, created_at, updated_at
            ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
          `,
        )
        .run(baseRow.id, baseRow.user_id, baseRow.placeholder_id, normalizedAlias);
    });

    runUpdate();

    const summary = await this.getEntry(userId, sensitiveRef);
    if (!summary) {
      throw new SensitiveNotFoundError(`Sensitive entry not found for ref ${sensitiveRef}`);
    }
    return summary;
  }

  public async deleteEntries(
    userId: string,
    sensitiveRefs: readonly SensitiveRef[],
  ): Promise<DeleteSensitiveResult> {
    if (sensitiveRefs.length === 0) {
      return { deletedCount: 0, missingSensitiveRefs: [] };
    }

    const uniqueRefs = [...new Set(sensitiveRefs)];
    const placeholders = uniqueRefs.map(() => '?').join(', ');
    const existingRows = this.db
      .prepare(
        `
          SELECT placeholder_id
          FROM vault_entries
          WHERE user_id = ? AND placeholder_id IN (${placeholders})
        `,
      )
      .all(userId, ...uniqueRefs) as Array<{ placeholder_id: string | null }>;

    const existingRefs = new Set(
      existingRows
        .map((row) => row.placeholder_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    );
    const missingSensitiveRefs = uniqueRefs.filter((ref) => !existingRefs.has(ref));

    const deletedCount = this.db
      .prepare(
        `
          DELETE FROM vault_entries
          WHERE user_id = ? AND placeholder_id IN (${placeholders})
        `,
      )
      .run(userId, ...uniqueRefs).changes;

    return { deletedCount, missingSensitiveRefs };
  }
}

export class SqlitePublicKeyStore {
  private readonly db: Database.Database;

  public constructor(db: Database.Database) {
    this.db = db;
    initVaultTables(db);
  }

  public storePublicKey(userId: string, publicKey: string, fingerprint: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO user_public_keys (user_id, public_key, fingerprint)
         VALUES (?, ?, ?)`,
      )
      .run(userId, publicKey, fingerprint);
  }

  public getPublicKey(userId: string): { publicKey: string; fingerprint: string } | null {
    const row = this.db.prepare('SELECT * FROM user_public_keys WHERE user_id = ?').get(userId) as
      | PublicKeyRow
      | undefined;
    if (!row) return null;
    return { publicKey: row.public_key, fingerprint: row.fingerprint };
  }

  public deletePublicKey(userId: string): void {
    this.db.prepare('DELETE FROM user_public_keys WHERE user_id = ?').run(userId);
  }
}

export const createSqliteVaultStore = (db: Database.Database): SqliteVaultStore =>
  new SqliteVaultStore(db);

export const createSqlitePublicKeyStore = (db: Database.Database): SqlitePublicKeyStore =>
  new SqlitePublicKeyStore(db);
