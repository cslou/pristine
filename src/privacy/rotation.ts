import type { KeyManager } from '../core/interfaces.js';
import { computeKeyFingerprint } from './vault/asymmetric-crypto.js';
import { type KekManager, wrapKek } from './kek/kek-manager.js';

/**
 * Rotate the RSA key pair for a user. Generates a new RSA-4096 key pair,
 * re-wraps the existing KEK with the new public key, and persists both.
 *
 * This is O(1) regardless of vault size — only the KEK's RSA wrapping
 * changes. All DEKs remain wrapped by the same KEK, so existing vault
 * entries are unaffected.
 */
export async function rotateKey(
  userId: string,
  keyManager: KeyManager,
  kekManager: KekManager,
): Promise<void> {
  // Get the plaintext KEK (getOrCreate handles RSA unwrap internally)
  const kek = await kekManager.getOrCreate(userId);

  const rotatedKey = await keyManager.rotateKeyPair(userId);
  const newFingerprint = computeKeyFingerprint(rotatedKey.publicKey);
  const newWrappedKek = wrapKek(kek, rotatedKey.publicKey);

  // Rotation replaces the active RSA key pair before updating the KEK row.
  // If the DB update fails after this point, operator repair is required because
  // the old wrapped KEK can no longer be unwrapped by the new private key.
  kekManager.updateWrappedKek(userId, newWrappedKek, newFingerprint);
}
