import type Database from 'better-sqlite3';
import type { KeyManager } from '../core/interfaces.js';
import type { ZkV2EncryptedValueMetadata } from '../core/types.js';
import { VaultEntryContractError } from '../core/errors.js';
import { decodeBase64Url, encodeBase64Url } from './vault/base64url.js';
import { type KekManager, wrapDekWithKek } from './kek/kek-manager.js';

interface MigrationRow {
  id: string;
  user_id: string;
  encryption_metadata: string;
}

export interface MigrateResult {
  readonly migrated: number;
  readonly skipped: number;
}

/**
 * Migrate existing RSA-wrapped vault entries to the KEK scheme.
 * For each entry with keyWrapping 'rsa-oaep-256': unwrap DEK with RSA,
 * re-wrap with KEK via AES-256-KW, update metadata in DB.
 *
 * Runs in a single db.transaction() for atomicity.
 * Idempotent — entries already on 'aes-256-kw+rsa-oaep-256' are skipped.
 */
export async function migrateToKek(
  userId: string,
  keyManager: KeyManager,
  kekManager: KekManager,
  db: Database.Database,
): Promise<MigrateResult> {
  const rows = db
    .prepare(
      `SELECT id, user_id, encryption_metadata FROM vault_entries
       WHERE user_id = ? AND encryption_metadata IS NOT NULL`,
    )
    .all(userId) as MigrationRow[];

  const toMigrate: { id: string; metadata: ZkV2EncryptedValueMetadata }[] = [];
  let skipped = 0;

  for (const row of rows) {
    let metadata: ZkV2EncryptedValueMetadata;
    try {
      metadata = JSON.parse(row.encryption_metadata) as ZkV2EncryptedValueMetadata;
    } catch (error: unknown) {
      void error;
      throw new VaultEntryContractError(`Corrupt encryption_metadata on vault entry ${row.id}`);
    }
    if (metadata.keyWrapping === 'rsa-oaep-256') {
      toMigrate.push({ id: row.id, metadata });
    } else {
      skipped++;
    }
  }

  if (toMigrate.length === 0) {
    return { migrated: 0, skipped };
  }

  const kek = await kekManager.getOrCreate(userId);
  const migratedRows: { id: string; metadataJson: string }[] = [];

  for (const { id, metadata } of toMigrate) {
    const wrappedDekBuf = Buffer.from(decodeBase64Url(metadata.wrappedDek));
    const dek = await keyManager.unwrap(userId, wrappedDekBuf);
    const newWrappedDek = wrapDekWithKek(dek, kek);

    const updated: ZkV2EncryptedValueMetadata = {
      ...metadata,
      keyWrapping: 'aes-256-kw+rsa-oaep-256',
      wrappedDek: encodeBase64Url(new Uint8Array(newWrappedDek)),
    };

    migratedRows.push({ id, metadataJson: JSON.stringify(updated) });
  }

  const updateStmt = db.prepare('UPDATE vault_entries SET encryption_metadata = ? WHERE id = ?');

  const migrateAll = db.transaction(
    (rowsToUpdate: readonly { id: string; metadataJson: string }[]) => {
      for (const row of rowsToUpdate) {
        updateStmt.run(row.metadataJson, row.id);
      }
    },
  );

  migrateAll(migratedRows);

  return { migrated: toMigrate.length, skipped };
}
