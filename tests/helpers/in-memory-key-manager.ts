import type { KeyManager } from '../../src/core/interfaces.js';
import type { KeyPairWithStatus } from '../../src/core/types.js';
import { generateKeyPair } from '../../src/privacy/vault/asymmetric-crypto.js';

export class InMemoryKeyManager implements KeyManager {
  private readonly keys = new Map<string, { publicKey: string; privateKey: string }>();

  public async getOrCreateKeyPair(userId: string): Promise<KeyPairWithStatus> {
    const existing = this.keys.get(userId);
    if (existing) {
      return { ...existing, created: false };
    }

    const keyPair = await generateKeyPair();
    this.keys.set(userId, { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey });
    return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey, created: true };
  }

  public async saveKeyPair(
    userId: string,
    keyPair: { publicKey: string; privateKey: string },
  ): Promise<void> {
    this.keys.set(userId, { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey });
  }
}
