import { createPrivateKey } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { KeyManagerError } from '../../core/errors.js';
import type { KeyManager } from '../../core/interfaces.js';
import type { KeyPairWithStatus } from '../../core/types.js';
import { generateKeyPair, validatePublicKey } from '../vault/asymmetric-crypto.js';

interface FileSystemKeyManagerOptions {
  readonly keysDir: string;
}

const SAFE_USER_ID_RE = /^[A-Za-z0-9._-]+$/;

const validatePem = (pem: string, kind: 'public' | 'private', filePath: string): void => {
  try {
    if (kind === 'public') {
      validatePublicKey(pem);
    } else {
      createPrivateKey(pem);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new KeyManagerError(`Corrupt ${kind} key at ${filePath}: ${message}`);
  }
};

const atomicWriteFile = (filePath: string, content: string, mode = 0o644): void => {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, content, { encoding: 'utf-8', mode });
  renameSync(tmpPath, filePath);
};

export class FileSystemKeyManager implements KeyManager {
  private readonly resolvedKeysDir: string;
  private readonly cache = new Map<string, { publicKey: string; privateKey: string }>();

  public constructor(options: FileSystemKeyManagerOptions) {
    this.resolvedKeysDir = resolve(options.keysDir);
  }

  public async getOrCreateKeyPair(userId: string): Promise<KeyPairWithStatus> {
    const cached = this.cache.get(userId);
    if (cached) {
      return { ...cached, created: false };
    }

    const publicKeyPath = this.publicKeyPath(userId);
    const privateKeyPath = this.privateKeyPath(userId);

    if (existsSync(publicKeyPath) && existsSync(privateKeyPath)) {
      const publicKey = readFileSync(publicKeyPath, 'utf-8');
      const privateKey = readFileSync(privateKeyPath, 'utf-8');
      validatePem(publicKey, 'public', publicKeyPath);
      validatePem(privateKey, 'private', privateKeyPath);
      this.cache.set(userId, { publicKey, privateKey });
      return { publicKey, privateKey, created: false };
    }

    const keyPair = await generateKeyPair();
    this.writeToDisk(userId, keyPair.publicKey, keyPair.privateKey);
    this.cache.set(userId, { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey });
    return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey, created: true };
  }

  public async saveKeyPair(
    userId: string,
    keyPair: { publicKey: string; privateKey: string },
  ): Promise<void> {
    validatePem(keyPair.publicKey, 'public', '(input)');
    validatePem(keyPair.privateKey, 'private', '(input)');
    this.writeToDisk(userId, keyPair.publicKey, keyPair.privateKey);
    this.cache.delete(userId);
  }

  private userFilenameComponent(userId: string): string {
    if (SAFE_USER_ID_RE.test(userId)) {
      return userId;
    }

    return `u-${Buffer.from(userId, 'utf8').toString('base64url')}`;
  }

  private resolvePathInsideKeysDir(fileName: string): string {
    const resolvedPath = resolve(this.resolvedKeysDir, fileName);
    if (
      resolvedPath !== this.resolvedKeysDir &&
      !resolvedPath.startsWith(`${this.resolvedKeysDir}${sep}`)
    ) {
      throw new KeyManagerError(`Resolved key path escaped keysDir: ${resolvedPath}`);
    }
    return resolvedPath;
  }

  private publicKeyPath(userId: string): string {
    return this.resolvePathInsideKeysDir(`${this.userFilenameComponent(userId)}-public.pem`);
  }

  private privateKeyPath(userId: string): string {
    return this.resolvePathInsideKeysDir(`${this.userFilenameComponent(userId)}-private.pem`);
  }

  private writeToDisk(userId: string, publicKey: string, privateKey: string): void {
    mkdirSync(this.resolvedKeysDir, { recursive: true });
    atomicWriteFile(this.publicKeyPath(userId), publicKey);
    atomicWriteFile(this.privateKeyPath(userId), privateKey, 0o600);
  }
}
