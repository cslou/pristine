import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqliteVaultStore, SqlitePublicKeyStore } from '../../src/privacy/vault/sqlite/index.js';
import {
  generateKeyPair,
  computeKeyFingerprint,
} from '../../src/privacy/vault/asymmetric-crypto.js';
import { encryptAndWrapValue } from '../../src/privacy/vault/asymmetric-encrypt.js';
import { generateKek } from '../../src/privacy/kek/kek-manager.js';

let db: Database.Database;
let store: SqliteVaultStore;
let keyStore: SqlitePublicKeyStore;
let publicKey: string;
let fingerprint: string;
let kek: Buffer;

beforeAll(async () => {
  db = new Database(':memory:');
  store = new SqliteVaultStore(db);
  keyStore = new SqlitePublicKeyStore(db);

  const keyPair = await generateKeyPair();
  publicKey = keyPair.publicKey;
  fingerprint = computeKeyFingerprint(publicKey);
  kek = generateKek();
});

afterAll(() => {
  db.close();
});

const makeEntry = (placeholderId: string, sensitiveType = 'email_address') => {
  const encrypted = encryptAndWrapValue(
    `secret-${placeholderId}`,
    sensitiveType,
    placeholderId,
    kek,
    fingerprint,
  );
  return { userId: 'user-1', placeholderId, sensitiveType, encrypted };
};

describe('SqliteVaultStore', () => {
  it('addEntries stores and returns vault entries', async () => {
    const entries = [makeEntry('ph-1'), makeEntry('ph-2', 'phone_number')];
    const result = await store.addEntries(entries);

    expect(result).toHaveLength(2);
    expect(result[0]!.placeholderId).toBe('ph-1');
    expect(result[0]!.sensitiveType).toBe('email_address');
    expect(result[0]!.encryptionMode).toBe('client_v2');
    expect(result[0]!.encryptionMetadata).toBeDefined();
    expect(result[0]!.encryptionMetadata!.scheme).toBe('zk-v2');
    expect(result[1]!.placeholderId).toBe('ph-2');
    expect(result[1]!.sensitiveType).toBe('phone_number');
  });

  it('addEntries returns empty array for empty input', async () => {
    const result = await store.addEntries([]);
    expect(result).toHaveLength(0);
  });

  it('getEntriesByPlaceholderIds retrieves entries by placeholder ID', async () => {
    const result = await store.getEntriesByPlaceholderIds('user-1', ['ph-1']);

    expect(result).toHaveLength(1);
    expect(result[0]!.placeholderId).toBe('ph-1');
    expect(result[0]!.userId).toBe('user-1');
  });

  it('getEntriesByPlaceholderIds returns empty for unknown IDs', async () => {
    const result = await store.getEntriesByPlaceholderIds('user-1', ['nonexistent']);
    expect(result).toHaveLength(0);
  });

  it('getEntriesByPlaceholderIds returns empty for wrong user', async () => {
    const result = await store.getEntriesByPlaceholderIds('other-user', ['ph-1']);
    expect(result).toHaveLength(0);
  });

  it('encrypted values are stored as blobs', async () => {
    const result = await store.getEntriesByPlaceholderIds('user-1', ['ph-1']);
    const entry = result[0]!;

    expect(Buffer.isBuffer(entry.encryptedValue)).toBe(true);
    expect(Buffer.isBuffer(entry.iv)).toBe(true);
    expect(Buffer.isBuffer(entry.authTag)).toBe(true);
  });

  it('lists safe summaries without leaking secret-derived labels', async () => {
    const results = await store.listEntries('user-1');

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sensitiveRef: 'ph-1', label: 'email_address-ph1' }),
        expect.objectContaining({ sensitiveRef: 'ph-2', label: 'phone_number-ph2' }),
      ]),
    );
    expect(results[0]!.alias).toBeUndefined();
  });

  it('gets and updates one safe summary by exact ref', async () => {
    const before = await store.getEntry('user-1', 'ph-1');
    expect(before?.label).toBe('email_address-ph1');
    expect(before?.alias).toBeUndefined();

    const updated = await store.updateEntry('user-1', 'ph-1', { alias: 'primary email secret' });
    expect(updated.alias).toBe('primary email secret');
    expect(updated.sensitiveRef).toBe('ph-1');

    const after = await store.getEntry('user-1', 'ph-1');
    expect(after?.alias).toBe('primary email secret');
  });

  it('deletes entries by exact refs and reports missing refs', async () => {
    const result = await store.deleteEntries('user-1', ['ph-2', 'missing-ref']);

    expect(result.deletedCount).toBe(1);
    expect(result.missingSensitiveRefs).toEqual(['missing-ref']);
    await expect(store.getEntry('user-1', 'ph-2')).resolves.toBeNull();
  });
});

describe('SqlitePublicKeyStore', () => {
  it('stores and retrieves a public key', () => {
    keyStore.storePublicKey('user-pk-1', publicKey, fingerprint);

    const result = keyStore.getPublicKey('user-pk-1');
    expect(result).not.toBeNull();
    expect(result!.publicKey).toBe(publicKey);
    expect(result!.fingerprint).toBe(fingerprint);
  });

  it('returns null for unknown user', () => {
    const result = keyStore.getPublicKey('nonexistent');
    expect(result).toBeNull();
  });

  it('overwrites existing key on re-store', () => {
    keyStore.storePublicKey('user-pk-2', 'old-key', 'old-fp');
    keyStore.storePublicKey('user-pk-2', publicKey, fingerprint);

    const result = keyStore.getPublicKey('user-pk-2');
    expect(result!.publicKey).toBe(publicKey);
  });

  it('deletes a public key', () => {
    keyStore.storePublicKey('user-pk-3', publicKey, fingerprint);
    keyStore.deletePublicKey('user-pk-3');

    const result = keyStore.getPublicKey('user-pk-3');
    expect(result).toBeNull();
  });
});
