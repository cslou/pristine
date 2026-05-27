import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { KeyManager } from '../../core/interfaces.js';
import { FileSystemKeyManager } from './filesystem.js';
import { MacOsKeychainKeyManager } from './macos-keychain.js';

export interface CreateDefaultKeyManagerOptions {
  readonly keysDir?: string;
  readonly baseDir?: string;
  readonly platform?: NodeJS.Platform;
}

const DEFAULT_BASE_DIR = join(homedir(), '.pristine');
const DEFAULT_SERVICE_NAME_PREFIX = 'dev.pristine.rsa.private-key';

const resolveBaseDir = (baseDir?: string): string => resolve(baseDir ?? DEFAULT_BASE_DIR);

const createKeychainServiceName = (baseDir: string): string => {
  const digest = createHash('sha256').update(baseDir).digest('hex').slice(0, 16);
  return `${DEFAULT_SERVICE_NAME_PREFIX}.${digest}`;
};

export const createDefaultKeyManager = (
  options: CreateDefaultKeyManagerOptions = {},
): KeyManager => {
  if (options.keysDir !== undefined) {
    return new FileSystemKeyManager({ keysDir: options.keysDir });
  }

  const baseDir = resolveBaseDir(options.baseDir);
  const keysDir = join(baseDir, 'keys');

  if ((options.platform ?? process.platform) === 'darwin') {
    return new MacOsKeychainKeyManager({
      serviceName: createKeychainServiceName(baseDir),
    });
  }

  return new FileSystemKeyManager({ keysDir });
};
