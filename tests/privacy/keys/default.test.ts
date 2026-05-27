import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultKeyManager } from '../../../src/privacy/keys/default.js';
import { FileSystemKeyManager } from '../../../src/privacy/keys/filesystem.js';
import { MacOsKeychainKeyManager } from '../../../src/privacy/keys/macos-keychain.js';

let cleanupDirs: string[] = [];

const makeBaseDir = (): string => {
  const dir = join(
    tmpdir(),
    `pristine-default-key-manager-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  cleanupDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of cleanupDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  cleanupDirs = [];
});

describe('createDefaultKeyManager', () => {
  it('uses macOS Keychain by default on darwin when no legacy filesystem keys exist', () => {
    const manager = createDefaultKeyManager({ platform: 'darwin', baseDir: makeBaseDir() });
    expect(manager).toBeInstanceOf(MacOsKeychainKeyManager);
  });

  it('keeps using filesystem keys for existing macOS stores with legacy key files', () => {
    const baseDir = makeBaseDir();
    const keysDir = join(baseDir, 'keys');
    mkdirSync(keysDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(keysDir, 'legacy-user-private.pem'), 'placeholder');

    const manager = createDefaultKeyManager({ platform: 'darwin', baseDir });
    expect(manager).toBeInstanceOf(FileSystemKeyManager);
  });

  it('uses filesystem keys by default on non-macOS platforms', () => {
    const manager = createDefaultKeyManager({ platform: 'linux', baseDir: makeBaseDir() });
    expect(manager).toBeInstanceOf(FileSystemKeyManager);
  });

  it('prefers explicit keysDir even on macOS', () => {
    const manager = createDefaultKeyManager({ platform: 'darwin', keysDir: '/tmp/pristine-keys' });
    expect(manager).toBeInstanceOf(FileSystemKeyManager);
  });

  it('namespaces macOS Keychain services by baseDir', () => {
    const a = createDefaultKeyManager({
      platform: 'darwin',
      baseDir: makeBaseDir(),
    }) as unknown as {
      serviceName: string;
    };
    const b = createDefaultKeyManager({
      platform: 'darwin',
      baseDir: makeBaseDir(),
    }) as unknown as {
      serviceName: string;
    };

    expect(a.serviceName).not.toBe(b.serviceName);
  });
});
