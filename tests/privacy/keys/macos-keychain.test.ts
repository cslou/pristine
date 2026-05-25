import { describe, expect, it } from 'vitest';
import { KeyManagerError } from '../../../src/core/errors.js';
import {
  MacOsKeychainKeyManager,
  type MacOsSecurityCommandRunner,
} from '../../../src/privacy/keys/macos-keychain.js';
import { generateKeyPair } from '../../../src/privacy/vault/asymmetric-crypto.js';

const makeRunner = (): {
  runner: MacOsSecurityCommandRunner;
  store: Map<string, string>;
  calls: string[][];
} => {
  const store = new Map<string, string>();
  const calls: string[][] = [];

  const runner = async (args: readonly string[]) => {
    calls.push([...args]);

    const accountIndex = args.indexOf('-a');
    const serviceIndex = args.indexOf('-s');
    const account = accountIndex >= 0 ? args[accountIndex + 1] : '';
    const service = serviceIndex >= 0 ? args[serviceIndex + 1] : '';
    const key = `${service}:${account}`;

    if (args[0] === 'find-generic-password') {
      const value = store.get(key);
      if (value === undefined) {
        return {
          stdout: '',
          stderr:
            'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.',
          exitCode: 44,
        };
      }

      return { stdout: value, stderr: '', exitCode: 0 };
    }

    if (args[0] === 'add-generic-password') {
      const passwordIndex = args.indexOf('-w');
      if (passwordIndex < 0) {
        return { stdout: '', stderr: 'missing -w', exitCode: 1 };
      }
      store.set(key, args[passwordIndex + 1] ?? '');
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    return { stdout: '', stderr: `unsupported command: ${args[0] ?? ''}`, exitCode: 1 };
  };

  return { runner, store, calls };
};

describe('MacOsKeychainKeyManager', () => {
  it('generates and stores a key pair on first call', async () => {
    const { runner, store } = makeRunner();
    const manager = new MacOsKeychainKeyManager({ runner, platform: 'darwin' });

    const result = await manager.getOrCreateKeyPair('user-1');

    expect(result.created).toBe(true);
    expect(result.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(result.privateKey).toContain('BEGIN PRIVATE KEY');
    expect(store.size).toBe(1);
  }, 15000);

  it('reloads an existing private key from keychain and derives the public key', async () => {
    const { runner, store } = makeRunner();
    const keyPair = await generateKeyPair();
    store.set('dev.pristine.rsa.private-key:user-1', keyPair.privateKey);

    const manager = new MacOsKeychainKeyManager({ runner, platform: 'darwin' });
    const result = await manager.getOrCreateKeyPair('user-1');

    expect(result.created).toBe(false);
    expect(result.privateKey).toBe(keyPair.privateKey);
    expect(result.publicKey).toBe(keyPair.publicKey);
  }, 15000);

  it('saveKeyPair overwrites the stored private key', async () => {
    const { runner, store } = makeRunner();
    const manager = new MacOsKeychainKeyManager({ runner, platform: 'darwin' });
    const keyPair = await generateKeyPair();

    await manager.saveKeyPair('user-1', keyPair);

    expect(store.get('dev.pristine.rsa.private-key:user-1')).toBe(keyPair.privateKey);

    const reloaded = await manager.getOrCreateKeyPair('user-1');
    expect(reloaded.created).toBe(false);
    expect(reloaded.publicKey).toBe(keyPair.publicKey);
  }, 15000);

  it('rejects non-macOS platforms', async () => {
    const manager = new MacOsKeychainKeyManager({ runner: makeRunner().runner, platform: 'linux' });

    await expect(manager.getOrCreateKeyPair('user-1')).rejects.toThrow(KeyManagerError);
    await expect(manager.getOrCreateKeyPair('user-1')).rejects.toThrow(/only supported on macOS/i);
  });

  it('rejects corrupt private keys returned by keychain', async () => {
    const { runner, store } = makeRunner();
    store.set('dev.pristine.rsa.private-key:user-1', 'not a valid private key');
    const manager = new MacOsKeychainKeyManager({ runner, platform: 'darwin' });

    await expect(manager.getOrCreateKeyPair('user-1')).rejects.toThrow(KeyManagerError);
    await expect(manager.getOrCreateKeyPair('user-1')).rejects.toThrow(/Corrupt private key/);
  });
});
