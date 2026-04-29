import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqliteVaultStore } from '../../src/privacy/vault/sqlite/index.js';
import { InMemoryKeyManager } from '../helpers/in-memory-key-manager.js';
import { KekManager } from '../../src/privacy/kek/kek-manager.js';
import { secureAndRedact, reveal } from '../../src/privacy/index.js';
import { rotateKey } from '../../src/privacy/rotation.js';
import { clearResolvedStringRegistry } from '../../src/privacy/sanitizer/index.js';
import { createDatabase } from '../../src/core/database.js';
import type { SecureAndRedactResult } from '../../src/core/types.js';

let db: Database.Database;
let vaultStore: SqliteVaultStore;
let keyManager: InMemoryKeyManager;
let kekManager: KekManager;

const expectSuccess = (
  result: SecureAndRedactResult,
): Extract<SecureAndRedactResult, { ok: true }> => {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected privacy pipeline success but got ${result.redactedText}`);
  }
  return result;
};

describe('e2e: deterministic privacy pipeline', () => {
  beforeAll(() => {
    db = createDatabase(':memory:');
    vaultStore = new SqliteVaultStore(db);
    keyManager = new InMemoryKeyManager();
    kekManager = new KekManager(db, keyManager);
  });

  afterAll(() => {
    db.close();
  });

  it('detects secrets and round-trips through reveal', async () => {
    clearResolvedStringRegistry();

    const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
    const privateKey =
      'DEPLOYER_PRIVATE_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const text = `Use ${apiKey} and ${privateKey}.`;
    const result = expectSuccess(
      await secureAndRedact(text, {
        vaultStore,
        keyManager,
        kekManager,
        userId: 'e2e-priv-1',
      }),
    );

    expect(result.redactedText).not.toContain(apiKey);
    expect(result.redactedText).not.toContain(privateKey);
    expect(result.redactedText).toMatch(/\[SENSITIVE:/);
    expect(result.placeholderIds.length).toBeGreaterThan(0);

    const revealed = await reveal(result.redactedText, {
      vaultStore,
      keyManager,
      kekManager,
      userId: 'e2e-priv-1',
    });

    expect(revealed.text).toContain(apiKey);
    expect(revealed.text).toContain(privateKey);
  }, 120000);

  it('vault entries use KEK wrapping scheme', async () => {
    clearResolvedStringRegistry();

    const result = expectSuccess(
      await secureAndRedact('API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456', {
        vaultStore,
        keyManager,
        kekManager,
        userId: 'e2e-priv-2',
      }),
    );

    const entries = await vaultStore.getEntriesByPlaceholderIds(
      'e2e-priv-2',
      result.placeholderIds as string[],
    );

    for (const entry of entries) {
      expect(entry.encryptionMetadata?.keyWrapping).toBe('aes-256-kw+rsa-oaep-256');
    }
  }, 120000);

  it('key rotation preserves access to encrypted data', async () => {
    clearResolvedStringRegistry();

    const { redactedText } = expectSuccess(
      await secureAndRedact('API key sk-ant-api03-rotateabcdefghijklmnopqrstuvwxyz123456', {
        vaultStore,
        keyManager,
        kekManager,
        userId: 'e2e-priv-3',
      }),
    );

    await rotateKey('e2e-priv-3', keyManager, kekManager);

    const revealed = await reveal(redactedText, {
      vaultStore,
      keyManager,
      kekManager,
      userId: 'e2e-priv-3',
    });

    expect(revealed.text).toContain('sk-ant-api03-rotate');
  }, 120000);

  it('detects API keys without an LLM classifier', async () => {
    clearResolvedStringRegistry();

    const text = 'API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 for John.';
    const result = expectSuccess(
      await secureAndRedact(text, {
        vaultStore,
        keyManager,
        kekManager,
        userId: 'e2e-priv-4',
      }),
    );

    expect(result.redactedText).not.toContain('sk-ant-api03');
    expect(result.redactedText).toMatch(/\[SENSITIVE:/);
  }, 120000);
}, 600000);
