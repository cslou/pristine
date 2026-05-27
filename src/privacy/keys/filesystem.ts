import { createPrivateKey } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve, sep } from 'node:path';
import { KeyManagerError } from '../../core/errors.js';
import type { KeyManager } from '../../core/interfaces.js';
import type { KeyPairWithStatus } from '../../core/types.js';
import { generateKeyPair, unwrapDek, validatePublicKey } from '../vault/asymmetric-crypto.js';
import { encodeKeyUserId, validateKeyUserId } from './shared.js';

interface FileSystemKeyManagerOptions {
  readonly keysDir: string;
}

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

const validateDirectoryPermissions = (dirPath: string): void => {
  if (process.platform === 'win32') return;
  const mode = statSync(dirPath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new KeyManagerError(
      `Permissions 0${mode.toString(8)} for '${dirPath}' are too open. ` +
        `It is required that your key directory is NOT accessible by others. ` +
        `Run: chmod 700 ${dirPath}`,
    );
  }
};

const validateFilePermissions = (filePath: string): void => {
  if (process.platform === 'win32') return;
  const mode = statSync(filePath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new KeyManagerError(
      `Permissions 0${mode.toString(8)} for '${filePath}' are too open. ` +
        `It is required that your private key files are NOT accessible by others. ` +
        `Run: chmod 600 ${filePath}`,
    );
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

  public async getOrCreatePublicKey(userId: string): Promise<KeyPairWithStatus> {
    validateKeyUserId(userId);
    const cached = this.cache.get(userId);
    if (cached) {
      return { ...cached, created: false };
    }

    const publicKeyPath = this.publicKeyPath(userId);
    const privateKeyPath = this.privateKeyPath(userId);

    if (existsSync(publicKeyPath) && existsSync(privateKeyPath)) {
      validateDirectoryPermissions(this.resolvedKeysDir);
      validateFilePermissions(privateKeyPath);
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

  public async unwrap(userId: string, wrappedValue: Buffer): Promise<Buffer> {
    validateKeyUserId(userId);

    const active = this.loadKeyPairFromDisk(userId, false);
    if (active) {
      try {
        return unwrapDek(wrappedValue, active.privateKey);
      } catch (error: unknown) {
        void error;
        // Try a staged keypair before failing.
      }
    }

    const staged = this.loadKeyPairFromDisk(userId, true);
    if (staged) {
      const unwrapped = unwrapDek(wrappedValue, staged.privateKey);
      this.writeToDisk(userId, staged.publicKey, staged.privateKey);
      this.deleteStagedFiles(userId);
      this.cache.set(userId, { publicKey: staged.publicKey, privateKey: staged.privateKey });
      return unwrapped;
    }

    throw new KeyManagerError(`No private key available for user ${userId}.`);
  }

  public async prepareKeyPairRotation(userId: string): Promise<{
    readonly publicKey: string;
    commit(): Promise<void>;
    rollback(): Promise<void>;
  }> {
    validateKeyUserId(userId);

    const keyPair = await generateKeyPair();
    this.writeToDisk(userId, keyPair.publicKey, keyPair.privateKey, true);

    return {
      publicKey: keyPair.publicKey,
      commit: async () => {
        this.writeToDisk(userId, keyPair.publicKey, keyPair.privateKey);
        this.deleteStagedFiles(userId);
        this.cache.set(userId, { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey });
      },
      rollback: async () => {
        this.deleteStagedFiles(userId);
      },
    };
  }

  public async getOrCreateKeyPair(userId: string): Promise<KeyPairWithStatus> {
    return this.getOrCreatePublicKey(userId);
  }

  public async saveKeyPair(
    userId: string,
    keyPair: { publicKey: string; privateKey: string },
  ): Promise<void> {
    validateKeyUserId(userId);
    validatePem(keyPair.publicKey, 'public', '(input)');
    validatePem(keyPair.privateKey, 'private', '(input)');
    this.writeToDisk(userId, keyPair.publicKey, keyPair.privateKey);
    this.cache.delete(userId);
  }

  private userFilenameComponent(userId: string): string {
    return encodeKeyUserId(userId);
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

  private publicKeyPath(userId: string, staged = false): string {
    const suffix = staged ? '-next-public.pem' : '-public.pem';
    return this.resolvePathInsideKeysDir(`${this.userFilenameComponent(userId)}${suffix}`);
  }

  private privateKeyPath(userId: string, staged = false): string {
    const suffix = staged ? '-next-private.pem' : '-private.pem';
    return this.resolvePathInsideKeysDir(`${this.userFilenameComponent(userId)}${suffix}`);
  }

  private loadKeyPairFromDisk(
    userId: string,
    staged: boolean,
  ): { publicKey: string; privateKey: string } | null {
    const publicKeyPath = this.publicKeyPath(userId, staged);
    const privateKeyPath = this.privateKeyPath(userId, staged);

    if (!existsSync(publicKeyPath) || !existsSync(privateKeyPath)) {
      return null;
    }

    validateDirectoryPermissions(this.resolvedKeysDir);
    validateFilePermissions(privateKeyPath);
    const publicKey = readFileSync(publicKeyPath, 'utf-8');
    const privateKey = readFileSync(privateKeyPath, 'utf-8');
    validatePem(publicKey, 'public', publicKeyPath);
    validatePem(privateKey, 'private', privateKeyPath);
    return { publicKey, privateKey };
  }

  private writeToDisk(userId: string, publicKey: string, privateKey: string, staged = false): void {
    mkdirSync(this.resolvedKeysDir, { recursive: true });
    if (process.platform !== 'win32') {
      chmodSync(this.resolvedKeysDir, 0o700);
    }
    atomicWriteFile(this.publicKeyPath(userId, staged), publicKey);
    atomicWriteFile(this.privateKeyPath(userId, staged), privateKey, 0o600);
  }

  private deleteStagedFiles(userId: string): void {
    for (const path of [this.publicKeyPath(userId, true), this.privateKeyPath(userId, true)]) {
      if (existsSync(path)) {
        unlinkSync(path);
      }
    }
  }
}
