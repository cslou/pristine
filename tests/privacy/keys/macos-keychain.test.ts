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

interface MockEntry {
  activeVersion: string | null;
  versions: string[];
  keys: Map<string, { publicKey: string; privateKey: string }>;
}

const makeRunner = (): {
  runner: MacOsKeychainHelperRunner;
  store: Map<string, MockEntry>;
} => {
  const store = new Map<string, MockEntry>();

  const ensureEntry = (service: string, account: string): MockEntry => {
    const key = `${service}:${account}`;
    const existing = store.get(key);
    if (existing) {
      return existing;
    }

    const created: MockEntry = {
      activeVersion: null,
      versions: [],
      keys: new Map(),
    };
    store.set(key, created);
    return created;
  };

  let counter = 0;
  const nextVersion = (): string => `version-${++counter}`;

  const runner: MacOsKeychainHelperRunner = async (args: readonly string[]) => {
    const service = args[1] ?? '';
    const account = args[2] ?? '';
    const entry = ensureEntry(service, account);

    if (args[0] === 'get-or-create-public-key') {
      if (entry.activeVersion) {
        const active = entry.keys.get(entry.activeVersion);
        if (active) {
          return {
            stdout: JSON.stringify({ ok: true, publicKey: active.publicKey, created: false }),
            stderr: '',
            exitCode: 0,
          };
        }
      }

      const version = nextVersion();
      const keyPair = await generateKeyPair();
      entry.activeVersion = version;
      entry.versions.push(version);
      entry.keys.set(version, keyPair);
      return {
        stdout: JSON.stringify({ ok: true, publicKey: keyPair.publicKey, created: true }),
        stderr: '',
        exitCode: 0,
      };
    }

    if (args[0] === 'unwrap') {
      const wrapped = Buffer.from(args[3] ?? '', 'base64');
      const candidates = [
        entry.activeVersion,
        ...entry.versions.filter((version) => version !== entry.activeVersion),
      ].filter((value): value is string => typeof value === 'string');

      for (const version of candidates) {
        const keyPair = entry.keys.get(version);
        if (!keyPair) continue;
        try {
          const plaintext = unwrapDek(wrapped, keyPair.privateKey);
          entry.activeVersion = version;
          return {
            stdout: JSON.stringify({ ok: true, plaintextBase64: plaintext.toString('base64') }),
            stderr: '',
            exitCode: 0,
          };
        } catch (error: unknown) {
          void error;
        }
      }

      return {
        stdout: JSON.stringify({
          ok: false,
          error: 'no candidate key could decrypt the ciphertext',
        }),
        stderr: '',
        exitCode: 1,
      };
    }

    if (args[0] === 'prepare-rotation') {
      const version = nextVersion();
      const keyPair = await generateKeyPair();
      entry.versions.push(version);
      entry.keys.set(version, keyPair);
      return {
        stdout: JSON.stringify({ ok: true, publicKey: keyPair.publicKey, rotationId: version }),
        stderr: '',
        exitCode: 0,
      };
    }

    if (args[0] === 'commit-rotation') {
      const version = args[3] ?? '';
      if (!entry.keys.has(version)) {
        return {
          stdout: JSON.stringify({ ok: false, error: 'missing staged key' }),
          stderr: '',
          exitCode: 1,
        };
      }
      entry.activeVersion = version;
      return {
        stdout: JSON.stringify({ ok: true, rotationId: version }),
        stderr: '',
        exitCode: 0,
      };
    }

    if (args[0] === 'rollback-rotation') {
      const version = args[3] ?? '';
      if (entry.activeVersion !== version) {
        entry.keys.delete(version);
        entry.versions = entry.versions.filter((candidate) => candidate !== version);
      }
      return {
        stdout: JSON.stringify({ ok: true, rotationId: version }),
        stderr: '',
        exitCode: 0,
      };
    }

    if (args[0] === 'delete-keypair') {
      entry.activeVersion = null;
      entry.versions = [];
      entry.keys.clear();
      return {
        stdout: JSON.stringify({ ok: true }),
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

  return { runner, store };
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
    store.set('dev.pristine.rsa.private-key:user-1', {
      activeVersion: 'version-1',
      versions: ['version-1'],
      keys: new Map([['version-1', keyPair]]),
    });

    const manager = new MacOsKeychainKeyManager({ runner, platform: 'darwin' });
    const result = await manager.getOrCreatePublicKey('user-1');

    expect(result.created).toBe(false);
    expect(result.publicKey).toBe(keyPair.publicKey);
  }, 15000);

  it('unwraps RSA ciphertext via the helper without exposing the private key', async () => {
    const { runner, store } = makeRunner();
    const keyPair = await generateKeyPair();
    store.set('dev.pristine.rsa.private-key:user-1', {
      activeVersion: 'version-1',
      versions: ['version-1'],
      keys: new Map([['version-1', keyPair]]),
    });
    const manager = new MacOsKeychainKeyManager({ runner, platform: 'darwin' });

    const wrapped = wrapDek(Buffer.alloc(32, 7), keyPair.publicKey);
    const plaintext = await manager.unwrap('user-1', wrapped);

    expect(plaintext.equals(Buffer.alloc(32, 7))).toBe(true);
  }, 15000);

  it('stages and commits key rotation through the helper protocol', async () => {
    const { runner } = makeRunner();
    const manager = new MacOsKeychainKeyManager({ runner, platform: 'darwin' });

    const first = await manager.getOrCreatePublicKey('user-1');
    const rotation = await manager.prepareKeyPairRotation('user-1');
    await rotation.commit();
    const after = await manager.getOrCreatePublicKey('user-1');

    expect(rotation.publicKey).not.toBe(first.publicKey);
    expect(after.publicKey).toBe(rotation.publicKey);
    expect(() => validatePublicKey(after.publicKey)).not.toThrow();
  }, 15000);

  it('rejects non-macOS platforms', async () => {
    const manager = new MacOsKeychainKeyManager({ runner: makeRunner().runner, platform: 'linux' });

    await expect(manager.getOrCreatePublicKey('user-1')).rejects.toThrow(KeyManagerError);
    await expect(manager.getOrCreatePublicKey('user-1')).rejects.toThrow(
      /only supported on macOS/i,
    );
  });
});
