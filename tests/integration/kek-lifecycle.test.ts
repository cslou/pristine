import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryKeyManager } from '../helpers/in-memory-key-manager.js';
import { KekManager } from '../../src/privacy/kek/kek-manager.js';
import { SqliteVaultStore } from '../../src/privacy/vault/sqlite/index.js';
import { secureAndRedact, reveal } from '../../src/privacy/index.js';
import { rotateKey } from '../../src/privacy/rotation.js';
import { migrateToKek } from '../../src/privacy/migration.js';
import { clearResolvedStringRegistry } from '../../src/privacy/sanitizer/index.js';
import { computeKeyFingerprint, wrapDek } from '../../src/privacy/vault/asymmetric-crypto.js';
import { encodeBase64Url } from '../../src/privacy/vault/base64url.js';
import type { LlmClient } from '../../src/core/interfaces.js';
import type { SecureAndRedactResult, ZkV2EncryptedValueMetadata } from '../../src/core/types.js';

let db: Database.Database;
let keyManager: InMemoryKeyManager;
let kekManager: KekManager;
let vaultStore: SqliteVaultStore;

const createMockClient = (findings: unknown[]): LlmClient => ({
  generate: vi.fn().mockResolvedValue({ findings }),
});

const emailFinding = (text: string) => ({
  type: 'email_address',
  confidence: 0.95,
  reasoning: 'Email detected',
  text,
});

const phoneFinding = (text: string) => ({
  type: 'phone_number',
  confidence: 0.9,
  reasoning: 'Phone detected',
  text,
});

const expectSuccess = (
  result: SecureAndRedactResult,
): Extract<SecureAndRedactResult, { ok: true }> => {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected KEK lifecycle step to succeed but got ${result.redactedText}`);
  }
  return result;
};

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

describe('KEK lifecycle e2e', () => {
  it('generates KEK on first encrypt and round-trips through reveal', async () => {
    clearResolvedStringRegistry();
    const userId = 'kek-e2e-1';
    const mockClient = createMockClient([
      emailFinding('eve@example.com'),
      phoneFinding('555-000-1234'),
    ]);

    const { redactedText, placeholderIds } = expectSuccess(
      await secureAndRedact('Reach eve@example.com or 555-000-1234', {
        client: mockClient,
        vaultStore,
        keyManager,
        kekManager,
        userId,
      }),
    );

    expect(redactedText).not.toContain('eve@example.com');
    expect(redactedText).not.toContain('555-000-1234');
    expect(placeholderIds).toHaveLength(2);

    // KEK row created in DB
    const kekRow = db
      .prepare('SELECT key_id, algorithm FROM user_keks WHERE user_id = ?')
      .get(userId) as { key_id: string; algorithm: string };
    expect(kekRow.key_id).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(kekRow.algorithm).toBe('rsa-oaep-256');

    // Vault entries use new KEK wrapping scheme
    const entries = await vaultStore.getEntriesByPlaceholderIds(userId, placeholderIds as string[]);
    for (const entry of entries) {
      expect(entry.encryptionMode).toBe('client_v2');
      expect(entry.encryptionMetadata?.keyWrapping).toBe('aes-256-kw+rsa-oaep-256');
    }

    // Round-trip
    const revealed = await reveal(redactedText, {
      vaultStore,
      keyManager,
      kekManager,
      userId,
    });
    expect(revealed.text).toContain('eve@example.com');
    expect(revealed.text).toContain('555-000-1234');
    expect(revealed.text).not.toContain('[SENSITIVE:');
  });

  it('key rotation preserves access to pre-rotation data', async () => {
    clearResolvedStringRegistry();
    const userId = 'kek-e2e-2';
    const mockClient = createMockClient([emailFinding('pre@rot.com')]);

    const { redactedText } = expectSuccess(
      await secureAndRedact('Email pre@rot.com', {
        client: mockClient,
        vaultStore,
        keyManager,
        kekManager,
        userId,
      }),
    );

    const oldKeyId = (
      db.prepare('SELECT key_id FROM user_keks WHERE user_id = ?').get(userId) as {
        key_id: string;
      }
    ).key_id;

    await rotateKey(userId, keyManager, kekManager);

    // key_id changed
    const newKeyId = (
      db.prepare('SELECT key_id FROM user_keks WHERE user_id = ?').get(userId) as {
        key_id: string;
      }
    ).key_id;
    expect(newKeyId).not.toBe(oldKeyId);

    // Pre-rotation data still decryptable
    const revealed = await reveal(redactedText, {
      vaultStore,
      keyManager,
      kekManager,
      userId,
    });
    expect(revealed.text).toContain('pre@rot.com');
  }, 15000);

  it('encrypts and decrypts new data after rotation', async () => {
    clearResolvedStringRegistry();
    const userId = 'kek-e2e-3';

    // Encrypt before rotation
    const mockPre = createMockClient([emailFinding('before@rot.com')]);
    const pre = expectSuccess(
      await secureAndRedact('Email before@rot.com', {
        client: mockPre,
        vaultStore,
        keyManager,
        kekManager,
        userId,
      }),
    );

    await rotateKey(userId, keyManager, kekManager);

    // Encrypt after rotation
    clearResolvedStringRegistry();
    const mockPost = createMockClient([phoneFinding('555-999-0000')]);
    const post = expectSuccess(
      await secureAndRedact('Call 555-999-0000', {
        client: mockPost,
        vaultStore,
        keyManager,
        kekManager,
        userId,
      }),
    );

    // Both decrypt correctly
    const revealedPre = await reveal(pre.redactedText, {
      vaultStore,
      keyManager,
      kekManager,
      userId,
    });
    expect(revealedPre.text).toContain('before@rot.com');

    const revealedPost = await reveal(post.redactedText, {
      vaultStore,
      keyManager,
      kekManager,
      userId,
    });
    expect(revealedPost.text).toContain('555-999-0000');
  }, 15000);

  it('survives multiple sequential rotations', async () => {
    clearResolvedStringRegistry();
    const userId = 'kek-e2e-4';
    const redactedTexts: string[] = [];

    // Encrypt, rotate, encrypt, rotate, encrypt, rotate
    const piiValues = ['a@test.com', 'b@test.com', 'c@test.com'];
    for (const pii of piiValues) {
      clearResolvedStringRegistry();
      const mock = createMockClient([emailFinding(pii)]);
      const { redactedText } = expectSuccess(
        await secureAndRedact(`Contact ${pii}`, {
          client: mock,
          vaultStore,
          keyManager,
          kekManager,
          userId,
        }),
      );
      redactedTexts.push(redactedText);
      await rotateKey(userId, keyManager, kekManager);
    }

    // All three values decrypt after three rotations
    for (let i = 0; i < piiValues.length; i++) {
      const revealed = await reveal(redactedTexts[i]!, {
        vaultStore,
        keyManager,
        kekManager,
        userId,
      });
      expect(revealed.text).toContain(piiValues[i]);
    }
  }, 15000);

  it('migrates legacy RSA-wrapped entries and reveals via KEK path', async () => {
    const userId = 'kek-e2e-5';

    // Generate keys so we can create a legacy entry manually
    const { publicKey } = await keyManager.getOrCreateKeyPair(userId);
    const fingerprint = computeKeyFingerprint(publicKey);

    // Create a legacy RSA-wrapped vault entry directly
    const { randomBytes: rb } = await import('node:crypto');
    const dek = rb(32);
    const iv = rb(12);
    const plaintext = 'legacy-secret-value';
    const placeholderId = '00000000-0000-0000-0000-000000000001';
    const aad = `placeholder:${placeholderId}:email_address`;

    const { createCipheriv } = await import('node:crypto');
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    cipher.setAAD(Buffer.from(aad));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Wrap DEK with RSA directly (legacy path)
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
       VALUES (?, ?, ?, ?, ?, ?, ?, 'client_v2', ?)`,
    ).run(
      'legacy-entry-e2e-5',
      userId,
      placeholderId,
      'email_address',
      encrypted,
      iv,
      authTag,
      JSON.stringify(metadata),
    );

    // Ensure KEK exists for migration target
    await kekManager.getOrCreate(userId);

    // Migrate
    const result = await migrateToKek(userId, keyManager, kekManager, db);
    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(0);

    // Verify entry now uses KEK wrapping
    const row = db
      .prepare('SELECT encryption_metadata FROM vault_entries WHERE id = ?')
      .get('legacy-entry-e2e-5') as { encryption_metadata: string };
    const updated = JSON.parse(row.encryption_metadata) as ZkV2EncryptedValueMetadata;
    expect(updated.keyWrapping).toBe('aes-256-kw+rsa-oaep-256');

    // Reveal via KEK path
    const revealed = await reveal(`Check [SENSITIVE:email_address:${placeholderId}] now`, {
      vaultStore,
      keyManager,
      kekManager,
      userId,
    });
    expect(revealed.text).toContain('legacy-secret-value');

    // Idempotent -- second migration is a no-op
    const result2 = await migrateToKek(userId, keyManager, kekManager, db);
    expect(result2.migrated).toBe(0);
    expect(result2.skipped).toBe(1);
  });
});
