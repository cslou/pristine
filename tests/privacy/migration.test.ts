import Database from 'better-sqlite3';
import { createCipheriv, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryKeyManager } from '../helpers/in-memory-key-manager.js';
import { KekManager } from '../../src/privacy/kek/kek-manager.js';
import { SqliteVaultStore } from '../../src/privacy/vault/sqlite/index.js';
import { wrapDek, computeKeyFingerprint } from '../../src/privacy/vault/asymmetric-crypto.js';
import { encodeBase64Url } from '../../src/privacy/vault/base64url.js';
import { migrateToKek } from '../../src/privacy/migration.js';
import { reveal } from '../../src/privacy/index.js';
import { clearResolvedStringRegistry } from '../../src/privacy/sanitizer/index.js';
import type { ZkV2EncryptedValueMetadata } from '../../src/core/types.js';

let db: Database.Database;
let keyManager: InMemoryKeyManager;
let kekManager: KekManager;
let vaultStore: SqliteVaultStore;

beforeAll(() => {
  db = new Database(':memory:');
  vaultStore = new SqliteVaultStore(db);
});

beforeEach(() => {
  keyManager = new InMemoryKeyManager();
  kekManager = new KekManager(db, keyManager);
});

afterAll(() => {
  db.close();
});

async function insertOldFormatEntry(
  userId: string,
  placeholderId: string,
  plaintext: string,
): Promise<void> {
  const { publicKey } = await keyManager.getOrCreateKeyPair(userId);
  const fingerprint = computeKeyFingerprint(publicKey);

  const dek = randomBytes(32);
  const iv = randomBytes(12);
  const aad = `placeholder:${placeholderId}:email_address`;

  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const wrappedDek = wrapDek(dek, publicKey);

  const metadata: ZkV2EncryptedValueMetadata = {
    scheme: 'zk-v2',
    algorithm: 'aes-256-gcm',
    keyWrapping: 'rsa-oaep-256',
    keyId: fingerprint,
    wrappedDek: encodeBase64Url(new Uint8Array(wrappedDek)),
    aad,
  };

  db.prepare(
    `INSERT INTO vault_entries (id, user_id, placeholder_id, sensitive_type,
     encrypted_value, iv, auth_tag, encryption_mode, encryption_metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    placeholderId,
    userId,
    placeholderId,
    'email_address',
    encrypted,
    iv,
    authTag,
    'client_v2',
    JSON.stringify(metadata),
  );
}

describe('migrateToKek', () => {
  it('migrates old RSA-wrapped entries to KEK scheme', async () => {
    const userId = 'user-mig-1';
    await insertOldFormatEntry(userId, 'ph-mig-1', 'alice@test.com');

    const result = await migrateToKek(userId, keyManager, kekManager, db);

    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(0);

    const row = db
      .prepare('SELECT encryption_metadata FROM vault_entries WHERE id = ?')
      .get('ph-mig-1') as {
      encryption_metadata: string;
    };
    const metadata = JSON.parse(row.encryption_metadata) as ZkV2EncryptedValueMetadata;
    expect(metadata.keyWrapping).toBe('aes-256-kw+rsa-oaep-256');
  });

  it('migrated entries are decryptable via reveal()', async () => {
    clearResolvedStringRegistry();
    const userId = 'user-mig-2';
    const phId = 'aabbccdd-1122-3344-5566-778899aabbcc';
    await insertOldFormatEntry(userId, phId, 'bob@test.com');

    await migrateToKek(userId, keyManager, kekManager, db);

    const redacted = `Contact [SENSITIVE:email_address:${phId}] please`;
    const revealed = await reveal(redacted, { vaultStore, keyManager, kekManager, userId });
    expect(revealed.text).toContain('bob@test.com');
    expect(revealed.revealedValues).toEqual(['bob@test.com']);
  });

  it('is idempotent — running twice causes no errors', async () => {
    const userId = 'user-mig-3';
    await insertOldFormatEntry(userId, 'ph-mig-3', 'carol@test.com');

    const first = await migrateToKek(userId, keyManager, kekManager, db);
    expect(first.migrated).toBe(1);

    const second = await migrateToKek(userId, keyManager, kekManager, db);
    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('handles mixed old and new entries', async () => {
    clearResolvedStringRegistry();
    const userId = 'user-mig-4';

    // Old format entry
    await insertOldFormatEntry(userId, 'ph-mig-4a', 'old@test.com');

    // Migrate first entry
    await migrateToKek(userId, keyManager, kekManager, db);

    // Insert a new-format entry (already KEK-wrapped) via the pipeline
    // by inserting another old one and migrating
    await insertOldFormatEntry(userId, 'ph-mig-4b', 'new@test.com');

    const result = await migrateToKek(userId, keyManager, kekManager, db);
    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('returns zero counts when no entries exist', async () => {
    const result = await migrateToKek('user-mig-empty', keyManager, kekManager, db);
    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(0);
  });
});
