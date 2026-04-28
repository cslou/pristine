import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryKeyManager } from '../helpers/in-memory-key-manager.js';
import { KekManager } from '../../src/privacy/kek/kek-manager.js';
import { SqliteVaultStore } from '../../src/privacy/vault/sqlite/index.js';
import { secureAndRedact, reveal } from '../../src/privacy/index.js';
import { rotateKey } from '../../src/privacy/rotation.js';
import { clearResolvedStringRegistry } from '../../src/privacy/sanitizer/index.js';
import type { SecureAndRedactResult } from '../../src/core/types.js';

let db: Database.Database;
let keyManager: InMemoryKeyManager;
let kekManager: KekManager;
let vaultStore: SqliteVaultStore;

const expectSuccess = (
  result: SecureAndRedactResult,
): Extract<SecureAndRedactResult, { ok: true }> => {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected rotation setup to succeed, got ${result.redactedText}`);
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

describe('rotateKey', () => {
  it('rotated key still decrypts previously encrypted values', async () => {
    clearResolvedStringRegistry();
    const userId = 'user-rot-1';
    const apiKey = 'sk-ant-api03-rotateabcdefghijklmnopqrstuvwxyz123456';

    const { redactedText } = expectSuccess(
      await secureAndRedact(`Use ${apiKey} please`, {
        vaultStore,
        keyManager,
        kekManager,
        userId,
      }),
    );

    // Capture old key fingerprint
    const oldKeyPair = await keyManager.getOrCreateKeyPair(userId);
    const oldPublicKey = oldKeyPair.publicKey;

    // Rotate
    await rotateKey(userId, keyManager, kekManager);

    // Verify key actually changed
    const newKeyPair = await keyManager.getOrCreateKeyPair(userId);
    expect(newKeyPair.publicKey).not.toBe(oldPublicKey);

    // Old value still decrypts with new key
    const revealed = await reveal(redactedText, { vaultStore, keyManager, kekManager, userId });
    expect(revealed.text).toContain(apiKey);
  });

  it('encrypts new values after rotation and decrypts them', async () => {
    clearResolvedStringRegistry();
    const userId = 'user-rot-2';
    const apiKey = 'sk-ant-api03-afterrotateabcdefghijklmnopqrstuvwxyz123456';

    // Generate initial KEK
    await kekManager.getOrCreate(userId);

    // Rotate
    await rotateKey(userId, keyManager, kekManager);

    // Encrypt after rotation
    const { redactedText } = expectSuccess(
      await secureAndRedact(`Use ${apiKey}`, {
        vaultStore,
        keyManager,
        kekManager,
        userId,
      }),
    );

    const revealed = await reveal(redactedText, { vaultStore, keyManager, kekManager, userId });
    expect(revealed.text).toContain(apiKey);
  }, 15000);

  it('handles multiple rotations in sequence', async () => {
    clearResolvedStringRegistry();
    const userId = 'user-rot-3';
    const apiKey = 'sk-ant-api03-multirotateabcdefghijklmnopqrstuvwxyz123456';

    const { redactedText } = expectSuccess(
      await secureAndRedact(`Use ${apiKey}`, {
        vaultStore,
        keyManager,
        kekManager,
        userId,
      }),
    );

    // Rotate three times
    await rotateKey(userId, keyManager, kekManager);
    await rotateKey(userId, keyManager, kekManager);
    await rotateKey(userId, keyManager, kekManager);

    // Still decrypts
    const revealed = await reveal(redactedText, { vaultStore, keyManager, kekManager, userId });
    expect(revealed.text).toContain(apiKey);
  }, 15000);

  it('updates user_keks row with new key_id after rotation', async () => {
    const userId = 'user-rot-4';
    await kekManager.getOrCreate(userId);

    const beforeRow = db.prepare('SELECT key_id FROM user_keks WHERE user_id = ?').get(userId) as {
      key_id: string;
    };

    await rotateKey(userId, keyManager, kekManager);

    const afterRow = db.prepare('SELECT key_id FROM user_keks WHERE user_id = ?').get(userId) as {
      key_id: string;
    };

    expect(afterRow.key_id).not.toBe(beforeRow.key_id);
    expect(afterRow.key_id).toMatch(/^sha256:[0-9a-f]{64}$/);
  }, 15000);

  it('clears KEK cache after rotation', async () => {
    const userId = 'user-rot-5';
    const kek1 = await kekManager.getOrCreate(userId);

    await rotateKey(userId, keyManager, kekManager);

    // After rotation + cache clear, getOrCreate should re-read from DB
    // The plaintext KEK should still be the same (only wrapping changed)
    const kek2 = await kekManager.getOrCreate(userId);
    expect(kek1.equals(kek2)).toBe(true);
    expect(kek1 === kek2).toBe(false); // different Buffer instance (cache was cleared)
  }, 15000);
});
