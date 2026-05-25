import { describe, expect, it } from 'vitest';
import { createDefaultKeyManager } from '../../../src/privacy/keys/default.js';
import { FileSystemKeyManager } from '../../../src/privacy/keys/filesystem.js';
import { MacOsKeychainKeyManager } from '../../../src/privacy/keys/macos-keychain.js';

describe('createDefaultKeyManager', () => {
  it('uses macOS Keychain by default on darwin', () => {
    const manager = createDefaultKeyManager({ platform: 'darwin' });
    expect(manager).toBeInstanceOf(MacOsKeychainKeyManager);
  });

  it('uses filesystem keys by default on non-macOS platforms', () => {
    const manager = createDefaultKeyManager({ platform: 'linux' });
    expect(manager).toBeInstanceOf(FileSystemKeyManager);
  });

  it('prefers explicit keysDir even on macOS', () => {
    const manager = createDefaultKeyManager({ platform: 'darwin', keysDir: '/tmp/pristine-keys' });
    expect(manager).toBeInstanceOf(FileSystemKeyManager);
  });
});
