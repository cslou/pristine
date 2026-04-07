import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryKeyManager } from '../helpers/in-memory-key-manager.js';
import { KekManager } from '../../src/privacy/kek/kek-manager.js';
import { SqliteVaultStore } from '../../src/privacy/vault/sqlite/index.js';
import { secureAndRedact, reveal } from '../../src/privacy/index.js';
import { rotateKey } from '../../src/privacy/rotation.js';
import { clearResolvedStringRegistry } from '../../src/privacy/sanitizer/index.js';
import type { LlmClient } from '../../src/core/interfaces.js';
import type { SecureAndRedactResult } from '../../src/core/types.js';

let db: Database.Database;
let keyManager: InMemoryKeyManager;
let kekManager: KekManager;
let vaultStore: SqliteVaultStore;

const createMockClient = (findings: unknown[]): LlmClient => ({
  generate: vi.fn().mockResolvedValue({ findings }),
});

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
    const mockClient = createMockClient([
      { type: 'email_address', confidence: 0.95, reasoning: 'Email', text: 'alice@test.com' },
    ]);

    const { redactedText } = expectSuccess(
      await secureAndRedact('Contact alice@test.com please', {
        client: mockClient,
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
    expect(revealed.text).toContain('alice@test.com');
  });

  it('encrypts new values after rotation and decrypts them', async () => {
    clearResolvedStringRegistry();
    const userId = 'user-rot-2';
    const mockClient = createMockClient([
      { type: 'phone_number', confidence: 0.9, reasoning: 'Phone', text: '555-111-2222' },
    ]);

    // Generate initial KEK
    await kekManager.getOrCreate(userId);

    // Rotate
    await rotateKey(userId, keyManager, kekManager);

    // Encrypt after rotation
    const { redactedText } = expectSuccess(
      await secureAndRedact('Call 555-111-2222', {
        client: mockClient,
        vaultStore,
        keyManager,
        kekManager,
        userId,
      }),
    );

    const revealed = await reveal(redactedText, { vaultStore, keyManager, kekManager, userId });
    expect(revealed.text).toContain('555-111-2222');
  });

  it('handles multiple rotations in sequence', async () => {
    clearResolvedStringRegistry();
    const userId = 'user-rot-3';
    const mockClient = createMockClient([
      { type: 'email_address', confidence: 0.95, reasoning: 'Email', text: 'bob@test.com' },
    ]);

    const { redactedText } = expectSuccess(
      await secureAndRedact('Reach bob@test.com', {
        client: mockClient,
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
    expect(revealed.text).toContain('bob@test.com');
  });

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
  });

  it('clears KEK cache after rotation', async () => {
    const userId = 'user-rot-5';
    const kek1 = await kekManager.getOrCreate(userId);

    await rotateKey(userId, keyManager, kekManager);

    // After rotation + cache clear, getOrCreate should re-read from DB
    // The plaintext KEK should still be the same (only wrapping changed)
    const kek2 = await kekManager.getOrCreate(userId);
    expect(kek1.equals(kek2)).toBe(true);
    expect(kek1 === kek2).toBe(false); // different Buffer instance (cache was cleared)
  });
});
