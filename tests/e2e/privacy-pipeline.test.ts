import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OllamaClient } from '../../src/engine/ollama/index.js';
import { SqliteVaultStore } from '../../src/privacy/vault/sqlite/index.js';
import { InMemoryKeyManager } from '../helpers/in-memory-key-manager.js';
import { KekManager } from '../../src/privacy/kek/kek-manager.js';
import { secureAndRedact, reveal } from '../../src/privacy/index.js';
import { rotateKey } from '../../src/privacy/rotation.js';
import { clearResolvedStringRegistry } from '../../src/privacy/sanitizer/index.js';
import { createDatabase } from '../../src/core/database.js';
import { isOllamaAvailable } from './helpers.js';
import type { SecureAndRedactResult } from '../../src/core/types.js';

const ollamaAvailable = await isOllamaAvailable();

let db: Database.Database;
let vaultStore: SqliteVaultStore;
let keyManager: InMemoryKeyManager;
let kekManager: KekManager;
let client: OllamaClient;

const expectSuccess = (
  result: SecureAndRedactResult,
): Extract<SecureAndRedactResult, { ok: true }> => {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected privacy pipeline success but got ${result.redactedText}`);
  }
  return result;
};

describe.skipIf(!ollamaAvailable)(
  'e2e: privacy pipeline with real Ollama',
  () => {
    beforeAll(() => {
      db = createDatabase(':memory:');
      vaultStore = new SqliteVaultStore(db);
      keyManager = new InMemoryKeyManager();
      kekManager = new KekManager(db, keyManager);
      client = new OllamaClient({ model: 'llama3.2:latest' });
    });

    afterAll(() => {
      db.close();
    });

    it('detects real PII and round-trips through reveal', async () => {
      clearResolvedStringRegistry();

      const text = 'My email is alice@example.com and my phone is 555-867-5309.';
      const result = expectSuccess(
        await secureAndRedact(text, {
          client,
          vaultStore,
          keyManager,
          kekManager,
          userId: 'e2e-priv-1',
        }),
      );

      expect(result.redactedText).not.toContain('alice@example.com');
      expect(result.redactedText).not.toContain('555-867-5309');
      expect(result.redactedText).toMatch(/\[SENSITIVE:/);
      expect(result.placeholderIds.length).toBeGreaterThan(0);

      const revealed = await reveal(result.redactedText, {
        vaultStore,
        keyManager,
        kekManager,
        userId: 'e2e-priv-1',
      });

      expect(revealed.text).toContain('alice@example.com');
      expect(revealed.text).toContain('555-867-5309');
    }, 120000);

    it('vault entries use KEK wrapping scheme', async () => {
      clearResolvedStringRegistry();

      const result = expectSuccess(
        await secureAndRedact('SSN is 123-45-6789', {
          client,
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
        await secureAndRedact('Contact bob@test.com', {
          client,
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

      expect(revealed.text).toContain('bob@test.com');
    }, 120000);

    it('deterministic classifier detects API keys alongside LLM', async () => {
      clearResolvedStringRegistry();

      const text = 'API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456 for John.';
      const result = expectSuccess(
        await secureAndRedact(text, {
          client,
          vaultStore,
          keyManager,
          kekManager,
          userId: 'e2e-priv-4',
        }),
      );

      expect(result.redactedText).not.toContain('sk-ant-api03');
      expect(result.redactedText).toMatch(/\[SENSITIVE:/);
    }, 120000);
  },
  600000,
);
