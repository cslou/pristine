import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { FileSystemKeyManager } from '../../../src/privacy/keys/filesystem.js';
import { KeyManagerError } from '../../../src/core/errors.js';
import { generateKeyPair } from '../../../src/privacy/vault/asymmetric-crypto.js';

const makeTmpKeysDir = (): string => {
  const dir = join(
    tmpdir(),
    `pristine-test-keys-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

let cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  cleanupDirs = [];
});

const createManager = (): { manager: FileSystemKeyManager; keysDir: string } => {
  const keysDir = makeTmpKeysDir();
  cleanupDirs.push(keysDir);
  return { manager: new FileSystemKeyManager({ keysDir }), keysDir };
};

describe('FileSystemKeyManager', () => {
  it('generates and persists key pair on first call', async () => {
    const { manager, keysDir } = createManager();
    const result = await manager.getOrCreateKeyPair('user-1');

    expect(result.created).toBe(true);
    expect(result.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(result.privateKey).toContain('BEGIN PRIVATE KEY');
    expect(existsSync(join(keysDir, 'user-1-public.pem'))).toBe(true);
    expect(existsSync(join(keysDir, 'user-1-private.pem'))).toBe(true);
  });

  it('returns created=false on subsequent calls (from cache)', async () => {
    const { manager } = createManager();
    const first = await manager.getOrCreateKeyPair('user-1');
    const second = await manager.getOrCreateKeyPair('user-1');

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.publicKey).toBe(first.publicKey);
    expect(second.privateKey).toBe(first.privateKey);
  });

  it('reloads keys from disk on fresh instance', async () => {
    const keysDir = makeTmpKeysDir();
    cleanupDirs.push(keysDir);

    const manager1 = new FileSystemKeyManager({ keysDir });
    const original = await manager1.getOrCreateKeyPair('user-1');
    expect(original.created).toBe(true);

    // Fresh instance — no in-memory cache, must read from disk
    const manager2 = new FileSystemKeyManager({ keysDir });
    const reloaded = await manager2.getOrCreateKeyPair('user-1');

    expect(reloaded.created).toBe(false);
    expect(reloaded.publicKey).toBe(original.publicKey);
    expect(reloaded.privateKey).toBe(original.privateKey);
  });

  it('isolates keys by userId', async () => {
    const { manager } = createManager();

    const a = await manager.getOrCreateKeyPair('alice');
    const b = await manager.getOrCreateKeyPair('bob');

    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });

  it('sets private key permissions to 0600 on Unix', async () => {
    if (process.platform === 'win32') return;

    const { manager, keysDir } = createManager();
    await manager.getOrCreateKeyPair('user-1');

    const stats = statSync(join(keysDir, 'user-1-private.pem'));
    // eslint-disable-next-line no-bitwise
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('creates keysDir recursively if it does not exist', async () => {
    const baseDir = makeTmpKeysDir();
    cleanupDirs.push(baseDir);
    const nestedKeysDir = join(baseDir, 'deep', 'nested', 'keys');

    const manager = new FileSystemKeyManager({ keysDir: nestedKeysDir });
    const result = await manager.getOrCreateKeyPair('user-1');

    expect(result.created).toBe(true);
    expect(existsSync(join(nestedKeysDir, 'user-1-public.pem'))).toBe(true);
  });

  it('throws KeyManagerError for corrupt public key file', async () => {
    const keysDir = makeTmpKeysDir();
    cleanupDirs.push(keysDir);

    // Write valid private key but corrupt public key
    const keyPair = await generateKeyPair();
    writeFileSync(join(keysDir, 'user-1-private.pem'), keyPair.privateKey);
    writeFileSync(join(keysDir, 'user-1-public.pem'), 'NOT A VALID PEM');

    const manager = new FileSystemKeyManager({ keysDir });
    await expect(manager.getOrCreateKeyPair('user-1')).rejects.toThrow(KeyManagerError);
    await expect(manager.getOrCreateKeyPair('user-1')).rejects.toThrow(/Corrupt public key/);
  });

  it('throws KeyManagerError for corrupt private key file', async () => {
    const keysDir = makeTmpKeysDir();
    cleanupDirs.push(keysDir);

    const keyPair = await generateKeyPair();
    writeFileSync(join(keysDir, 'user-1-public.pem'), keyPair.publicKey);
    writeFileSync(join(keysDir, 'user-1-private.pem'), 'TRUNCATED CONTENT');

    const manager = new FileSystemKeyManager({ keysDir });
    await expect(manager.getOrCreateKeyPair('user-1')).rejects.toThrow(KeyManagerError);
    await expect(manager.getOrCreateKeyPair('user-1')).rejects.toThrow(/Corrupt private key/);
  });

  it('saveKeyPair writes keys and invalidates cache', async () => {
    const { manager, keysDir } = createManager();

    // Generate initial key pair
    const initial = await manager.getOrCreateKeyPair('user-1');

    // Generate a different key pair and save it
    const newKeyPair = await generateKeyPair();
    await manager.saveKeyPair('user-1', newKeyPair);

    // Cache was invalidated — next call reads from disk
    const reloaded = await manager.getOrCreateKeyPair('user-1');
    expect(reloaded.created).toBe(false);
    expect(reloaded.publicKey).toBe(newKeyPair.publicKey);
    expect(reloaded.privateKey).toBe(newKeyPair.privateKey);
    expect(reloaded.publicKey).not.toBe(initial.publicKey);

    // Verify files on disk
    const diskPublic = readFileSync(join(keysDir, 'user-1-public.pem'), 'utf-8');
    expect(diskPublic).toBe(newKeyPair.publicKey);
  });

  it('saveKeyPair validates PEM before writing', async () => {
    const { manager } = createManager();

    await expect(
      manager.saveKeyPair('user-1', { publicKey: 'bad', privateKey: 'bad' }),
    ).rejects.toThrow(KeyManagerError);
  });

  it('saveKeyPair creates keysDir if needed', async () => {
    const baseDir = makeTmpKeysDir();
    cleanupDirs.push(baseDir);
    const nestedKeysDir = join(baseDir, 'new', 'path');

    const manager = new FileSystemKeyManager({ keysDir: nestedKeysDir });
    const keyPair = await generateKeyPair();
    await manager.saveKeyPair('user-1', keyPair);

    expect(existsSync(join(nestedKeysDir, 'user-1-public.pem'))).toBe(true);
  });
});
