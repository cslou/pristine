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

  const preparedRotation = await keyManager.prepareKeyPairRotation(userId);
  const newFingerprint = computeKeyFingerprint(preparedRotation.publicKey);
  const newWrappedKek = wrapKek(kek, preparedRotation.publicKey);

  let updated = false;
  try {
    kekManager.updateWrappedKek(userId, newWrappedKek, newFingerprint);
    updated = true;
    await preparedRotation.commit();
  } catch (error) {
    if (!updated) {
      await preparedRotation.rollback();
    }
    throw error;
  }
}
