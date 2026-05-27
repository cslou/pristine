import type { KeyManager } from '../../src/core/interfaces.js';
import type { KeyPairWithStatus } from '../../src/core/types.js';
import { generateKeyPair, unwrapDek } from '../../src/privacy/vault/asymmetric-crypto.js';

export class InMemoryKeyManager implements KeyManager {
  private readonly keys = new Map<string, { publicKey: string; privateKey: string }>();
  private readonly stagedKeys = new Map<string, { publicKey: string; privateKey: string }>();

  public async getOrCreatePublicKey(userId: string): Promise<KeyPairWithStatus> {
    const existing = this.keys.get(userId);
    if (existing) {
      return { ...existing, created: false };
    }

    const keyPair = await generateKeyPair();
    this.keys.set(userId, { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey });
    return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey, created: true };
  }

  public async unwrap(userId: string, wrappedValue: Buffer): Promise<Buffer> {
    const active = this.keys.get(userId);
    if (active) {
      try {
        return unwrapDek(wrappedValue, active.privateKey);
      } catch {
        // Try staged key before failing.
      }
    }

    const staged = this.stagedKeys.get(userId);
    if (staged) {
      const unwrapped = unwrapDek(wrappedValue, staged.privateKey);
      this.keys.set(userId, staged);
      this.stagedKeys.delete(userId);
      return unwrapped;
    }

    throw new Error(`No key pair available for user ${userId}`);
  }

  public async prepareKeyPairRotation(userId: string): Promise<{
    readonly publicKey: string;
    commit(): Promise<void>;
    rollback(): Promise<void>;
  }> {
    const keyPair = await generateKeyPair();
    this.stagedKeys.set(userId, { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey });

    return {
      publicKey: keyPair.publicKey,
      commit: async () => {
        this.keys.set(userId, { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey });
        this.stagedKeys.delete(userId);
      },
      rollback: async () => {
        this.stagedKeys.delete(userId);
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
    this.keys.set(userId, { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey });
    this.stagedKeys.delete(userId);
  }
}
