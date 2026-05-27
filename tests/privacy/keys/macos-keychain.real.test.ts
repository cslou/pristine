import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { secureAndRedact, reveal } from '../../../src/privacy/index.js';
import { KekManager } from '../../../src/privacy/kek/kek-manager.js';
import { MacOsKeychainKeyManager } from '../../../src/privacy/keys/macos-keychain.js';
import { rotateKey } from '../../../src/privacy/rotation.js';
import { SqliteVaultStore } from '../../../src/privacy/vault/sqlite/index.js';

const maybeIt = process.platform === 'darwin' && existsSync('/usr/bin/swift') ? it : it.skip;

const cleanupPaths = new Set<string>();

afterEach(() => {
  for (const path of cleanupPaths) {
    rmSync(path, { force: true });
    rmSync(`${path}-shm`, { force: true });
    rmSync(`${path}-wal`, { force: true });
  }
  cleanupPaths.clear();
});

describe('MacOsKeychainKeyManager (real helper)', () => {
  maybeIt(
    'round-trips redact/reveal, reuses the Keychain key, and preserves reveal after rotation',
    async () => {
      const userId = `macos-real-${randomUUID()}`;
      const serviceName = `dev.pristine.test.${randomUUID()}`;
      const dbPath = join(tmpdir(), `pristine-macos-keychain-${randomUUID()}.db`);
      cleanupPaths.add(dbPath);

      const manager = new MacOsKeychainKeyManager({ serviceName, platform: 'darwin' });
      await manager.deleteKeyPair(userId);

      const db1 = new Database(dbPath);
      const vaultStore1 = new SqliteVaultStore(db1);
      const kekManager1 = new KekManager(db1, manager);
      const secret = `sk-ant-api03-real-${randomUUID().replace(/-/g, '')}abcdefghijklmnop`;
      const text = `Token ${secret}`;

      const redacted = await secureAndRedact(text, {
        vaultStore: vaultStore1,
        keyManager: manager,
        kekManager: kekManager1,
        userId,
      });
      expect(redacted.ok).toBe(true);
      if (!redacted.ok) {
        throw new Error(`Expected secureAndRedact to succeed, got ${redacted.reason}`);
      }

      await expect(
        reveal(redacted.redactedText, {
          vaultStore: vaultStore1,
          keyManager: manager,
          kekManager: kekManager1,
          userId,
        }),
      ).resolves.toMatchObject({ text });
      db1.close();

      const db2 = new Database(dbPath);
      const manager2 = new MacOsKeychainKeyManager({ serviceName, platform: 'darwin' });
      const vaultStore2 = new SqliteVaultStore(db2);
      const kekManager2 = new KekManager(db2, manager2);

      await expect(
        reveal(redacted.redactedText, {
          vaultStore: vaultStore2,
          keyManager: manager2,
          kekManager: kekManager2,
          userId,
        }),
      ).resolves.toMatchObject({ text });

      await rotateKey(userId, manager2, kekManager2);

      await expect(
        reveal(redacted.redactedText, {
          vaultStore: vaultStore2,
          keyManager: manager2,
          kekManager: kekManager2,
          userId,
        }),
      ).resolves.toMatchObject({ text });

      await manager2.deleteKeyPair(userId);
      db2.close();
    },
    120_000,
  );
});
