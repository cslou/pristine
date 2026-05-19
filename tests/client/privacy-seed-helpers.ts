import type Database from 'better-sqlite3';
import { secureAndRedact as privacySecureAndRedact } from '../../src/privacy/index.js';
import { KekManager } from '../../src/privacy/kek/kek-manager.js';
import { FileSystemKeyManager } from '../../src/privacy/keys/filesystem.js';
import { createSqliteVaultStore } from '../../src/privacy/vault/sqlite/index.js';

export const seedClientSensitiveValue = async (input: {
  readonly db: Database.Database;
  readonly keysDir: string;
  readonly userId: string;
  readonly text: string;
  readonly customPatternsPath?: string;
}): Promise<void> => {
  const keyManager = new FileSystemKeyManager({ keysDir: input.keysDir });
  await privacySecureAndRedact(input.text, {
    vaultStore: createSqliteVaultStore(input.db),
    keyManager,
    kekManager: new KekManager(input.db, keyManager),
    userId: input.userId,
    classifier: input.customPatternsPath
      ? { customPatternsPath: input.customPatternsPath }
      : undefined,
  });
};
