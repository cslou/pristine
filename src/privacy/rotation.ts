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

  const newWrappedKek = wrapKek(kek, newKeyPair.publicKey);

  // Persist new RSA key pair FIRST — if this fails, the DB still holds the
  // old wrapped KEK which remains decryptable with the old private key.
  // Updating the DB first would risk leaving the KEK unrecoverable.
  await keyManager.saveKeyPair(userId, newKeyPair);

  // Now update DB with new wrapped KEK (updateWrappedKek also clears cache)
  kekManager.updateWrappedKek(userId, newWrappedKek, newFingerprint);
}
