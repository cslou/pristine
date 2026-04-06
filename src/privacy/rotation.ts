import type { KeyManager } from '../core/interfaces.js';
import { computeKeyFingerprint, generateKeyPair } from './vault/asymmetric-crypto.js';
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

  // Generate new RSA key pair
  const newKeyPair = await generateKeyPair();
  const newFingerprint = computeKeyFingerprint(newKeyPair.publicKey);

  // Re-wrap KEK with new RSA public key and update DB
  const newWrappedKek = wrapKek(kek, newKeyPair.publicKey);
  kekManager.updateWrappedKek(userId, newWrappedKek, newFingerprint);

  // Persist new RSA key pair (replaces old keys on disk/memory)
  await keyManager.saveKeyPair(userId, newKeyPair);

  // Force re-read on next getOrCreate — cache now holds stale KEK
  // (same plaintext, but the KekManager needs to know about the new wrapping)
  kekManager.clearCache(userId);
}
