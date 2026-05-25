import { homedir } from 'node:os';
import type { KeyManager } from '../../core/interfaces.js';
import { FileSystemKeyManager } from './filesystem.js';
import { MacOsKeychainKeyManager } from './macos-keychain.js';

export interface CreateDefaultKeyManagerOptions {
  readonly keysDir?: string;
  readonly baseDir?: string;
  readonly platform?: NodeJS.Platform;
}

export const createDefaultKeyManager = (
  options: CreateDefaultKeyManagerOptions = {},
): KeyManager => {
  if (options.keysDir !== undefined) {
    return new FileSystemKeyManager({ keysDir: options.keysDir });
  }

  if ((options.platform ?? process.platform) === 'darwin') {
    return new MacOsKeychainKeyManager();
  }

  return new FileSystemKeyManager({
    keysDir: options.baseDir ? `${options.baseDir}/keys` : `${homedir()}/.pristine/keys`,
  });
};
