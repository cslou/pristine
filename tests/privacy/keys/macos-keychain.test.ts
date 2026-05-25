import { describe, expect, it } from 'vitest';
import { KeyManagerError } from '../../../src/core/errors.js';
import {
  MacOsKeychainKeyManager,
  type MacOsKeychainHelperRunner,
} from '../../../src/privacy/keys/macos-keychain.js';
import {
  generateKeyPair,
  unwrapDek,
  validatePublicKey,
  wrapDek,
} from '../../../src/privacy/vault/asymmetric-crypto.js';

const makeRunner = (): {
  runner: MacOsKeychainHelperRunner;
  store: Map<string, { publicKey: string; privateKey: string }>;
  calls: string[][];
} => {
  const store = new Map<string, { publicKey: string; privateKey: string }>();
  const calls: string[][] = [];

  const runner: MacOsKeychainHelperRunner = async (args: readonly string[]) => {
    calls.push([...args]);

    const service = args[1] ?? '';
    const account = args[2] ?? '';
    const key = `${service}:${account}`;

    if (args[0] === 'get-or-create-public-key') {
      const existing = store.get(key);
      if (existing) {
        return {
          stdout: JSON.stringify({ ok: true, publicKey: existing.publicKey, created: false }),
          stderr: '',
          exitCode: 0,
        };
      }

      const created = await generateKeyPair();
      store.set(key, created);
      return {
        stdout: JSON.stringify({ ok: true, publicKey: created.publicKey, created: true }),
        stderr: '',
        exitCode: 0,
      };
    }

    if (args[0] === 'unwrap') {
      const existing = store.get(key);
      if (!existing) {
        return {
          stdout: JSON.stringify({ ok: false, error: 'missing key pair' }),
          stderr: '',
          exitCode: 1,
        };
      }

      const ciphertext = Buffer.from(args[3] ?? '', 'base64');
      const plaintext = unwrapDek(ciphertext, existing.privateKey);
      return {
        stdout: JSON.stringify({ ok: true, plaintextBase64: plaintext.toString('base64') }),
        stderr: '',
        exitCode: 0,
      };
    }

    if (args[0] === 'rotate-keypair') {
      const rotated = await generateKeyPair();
      store.set(key, rotated);
      return {
        stdout: JSON.stringify({ ok: true, publicKey: rotated.publicKey, created: true }),
        stderr: '',
        exitCode: 0,
      };
    }

    return {
      stdout: JSON.stringify({ ok: false, error: `unsupported command: ${args[0] ?? ''}` }),
      stderr: '',
      exitCode: 1,
    };
  };

  return { runner, store, calls };
};

describe('MacOsKeychainKeyManager', () => {
  it('gets or creates a keychain-backed public key', async () => {
    const { runner, store } = makeRunner();
    const manager = new MacOsKeychainKeyManager({ runner, platform: 'darwin' });

    const result = await manager.getOrCreatePublicKey('user-1');

    expect(result.created).toBe(true);
    expect(result.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(store.size).toBe(1);
  }, 15000);

  it('reloads an existing keychain-backed public key', async () => {
    const { runner, store } = makeRunner();
    const keyPair = await generateKeyPair();
    store.set('dev.pristine.rsa.private-key:user-1', keyPair);

    const manager = new MacOsKeychainKeyManager({ runner, platform: 'darwin' });
    const result = await manager.getOrCreatePublicKey('user-1');

    expect(result.created).toBe(false);
    expect(result.publicKey).toBe(keyPair.publicKey);
  }, 15000);

  it('unwraps RSA ciphertext via the helper without exposing the private key', async () => {
    const { runner, store } = makeRunner();
    const keyPair = await generateKeyPair();
    store.set('dev.pristine.rsa.private-key:user-1', keyPair);
    const manager = new MacOsKeychainKeyManager({ runner, platform: 'darwin' });

    const wrapped = wrapDek(Buffer.alloc(32, 7), keyPair.publicKey);
    const plaintext = await manager.unwrap('user-1', wrapped);

    expect(plaintext.equals(Buffer.alloc(32, 7))).toBe(true);
  }, 15000);

  it('rotates the key pair and returns the new public key', async () => {
    const { runner } = makeRunner();
    const manager = new MacOsKeychainKeyManager({ runner, platform: 'darwin' });

    const first = await manager.getOrCreatePublicKey('user-1');
    const rotated = await manager.rotateKeyPair('user-1');

    expect(rotated.created).toBe(true);
    expect(rotated.publicKey).not.toBe(first.publicKey);
    expect(() => validatePublicKey(rotated.publicKey)).not.toThrow();
  }, 15000);

  it('rejects non-macOS platforms', async () => {
    const manager = new MacOsKeychainKeyManager({ runner: makeRunner().runner, platform: 'linux' });

    await expect(manager.getOrCreatePublicKey('user-1')).rejects.toThrow(KeyManagerError);
    await expect(manager.getOrCreatePublicKey('user-1')).rejects.toThrow(
      /only supported on macOS/i,
    );
  });
});
