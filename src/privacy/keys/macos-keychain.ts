import { spawn } from 'node:child_process';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { KeyManagerError } from '../../core/errors.js';
import type { KeyManager } from '../../core/interfaces.js';
import type { KeyPairWithStatus } from '../../core/types.js';
import { generateKeyPair } from '../vault/asymmetric-crypto.js';
import { encodeKeyUserId, validateKeyUserId } from './shared.js';

interface SecurityCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type MacOsSecurityCommandRunner = (
  args: readonly string[],
) => Promise<SecurityCommandResult>;

export interface MacOsKeychainKeyManagerOptions {
  readonly serviceName?: string;
  readonly runner?: MacOsSecurityCommandRunner;
  readonly platform?: NodeJS.Platform;
}

const DEFAULT_SERVICE_NAME = 'dev.pristine.rsa.private-key';

const defaultRunner: MacOsSecurityCommandRunner = async (
  args: readonly string[],
): Promise<SecurityCommandResult> =>
  await new Promise((resolve, reject) => {
    const child = spawn('security', [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      reject(new KeyManagerError(`Failed to execute macOS security command: ${error.message}`));
    });

    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });

const validatePrivateKeyPem = (pem: string, filePath: string): void => {
  try {
    createPrivateKey(pem);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new KeyManagerError(`Corrupt private key at ${filePath}: ${message}`);
  }
};

const derivePublicKeyPem = (privateKeyPem: string): string => {
  const keyObject = createPrivateKey(privateKeyPem);
  return createPublicKey(keyObject).export({ type: 'spki', format: 'pem' }).toString();
};

const normalizePem = (pem: string): string => pem.replace(/\r\n/g, '\n').trim();

const isItemMissing = (result: SecurityCommandResult): boolean => {
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return combined.includes('could not be found') || combined.includes('item not found');
};

export class MacOsKeychainKeyManager implements KeyManager {
  private readonly serviceName: string;
  private readonly runner: MacOsSecurityCommandRunner;
  private readonly platform: NodeJS.Platform;
  private readonly cache = new Map<string, { publicKey: string; privateKey: string }>();

  public constructor(options: MacOsKeychainKeyManagerOptions = {}) {
    this.serviceName = options.serviceName ?? DEFAULT_SERVICE_NAME;
    this.runner = options.runner ?? defaultRunner;
    this.platform = options.platform ?? process.platform;
  }

  public async getOrCreateKeyPair(userId: string): Promise<KeyPairWithStatus> {
    this.assertSupportedPlatform();
    validateKeyUserId(userId);

    const cached = this.cache.get(userId);
    if (cached) {
      return { ...cached, created: false };
    }

    const existingPrivateKey = await this.loadPrivateKey(userId);
    if (existingPrivateKey !== null) {
      validatePrivateKeyPem(existingPrivateKey, this.itemReference(userId));
      const publicKey = derivePublicKeyPem(existingPrivateKey);
      const keyPair = { publicKey, privateKey: existingPrivateKey };
      this.cache.set(userId, keyPair);
      return { ...keyPair, created: false };
    }

    const keyPair = await generateKeyPair();
    await this.storePrivateKey(userId, keyPair.privateKey);
    this.cache.set(userId, { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey });
    return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey, created: true };
  }

  public async saveKeyPair(
    userId: string,
    keyPair: { publicKey: string; privateKey: string },
  ): Promise<void> {
    this.assertSupportedPlatform();
    validateKeyUserId(userId);
    validatePrivateKeyPem(keyPair.privateKey, '(input)');

    const derivedPublicKey = derivePublicKeyPem(keyPair.privateKey);
    if (normalizePem(derivedPublicKey) !== normalizePem(keyPair.publicKey)) {
      throw new KeyManagerError('Provided publicKey does not match the provided privateKey.');
    }

    await this.storePrivateKey(userId, keyPair.privateKey);
    this.cache.delete(userId);
  }

  private assertSupportedPlatform(): void {
    if (this.platform !== 'darwin') {
      throw new KeyManagerError('MacOsKeychainKeyManager is only supported on macOS.');
    }
  }

  private itemAccount(userId: string): string {
    return encodeKeyUserId(userId);
  }

  private itemReference(userId: string): string {
    return `${this.serviceName}/${this.itemAccount(userId)}`;
  }

  private async loadPrivateKey(userId: string): Promise<string | null> {
    const result = await this.runner([
      'find-generic-password',
      '-a',
      this.itemAccount(userId),
      '-s',
      this.serviceName,
      '-w',
    ]);

    if (result.exitCode !== 0) {
      if (isItemMissing(result)) {
        return null;
      }

      throw new KeyManagerError(
        `Failed to read private key from macOS Keychain for ${this.itemReference(userId)}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
      );
    }

    return result.stdout;
  }

  private async storePrivateKey(userId: string, privateKey: string): Promise<void> {
    const result = await this.runner([
      'add-generic-password',
      '-U',
      '-a',
      this.itemAccount(userId),
      '-s',
      this.serviceName,
      '-l',
      `Pristine RSA private key (${userId})`,
      '-w',
      privateKey,
    ]);

    if (result.exitCode !== 0) {
      throw new KeyManagerError(
        `Failed to store private key in macOS Keychain for ${this.itemReference(userId)}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
      );
    }
  }
}
