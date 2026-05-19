import type { RedactOptions, RedactResultRedaction } from '../../core/types.js';
import { computeKeyFingerprint } from '../vault/asymmetric-crypto.js';
import { encryptAndWrapValue } from '../vault/asymmetric-encrypt.js';

export interface PendingRedactionWrite {
  readonly redaction: RedactResultRedaction;
  readonly rawValue: string;
  readonly placeholderId: string;
  readonly vaultType: string;
}

export const persistRedactions = async (
  userId: string,
  options: RedactOptions,
  pending: readonly PendingRedactionWrite[],
): Promise<void> => {
  const { publicKey } = await options.keyManager.getOrCreateKeyPair(userId);
  const fingerprint = computeKeyFingerprint(publicKey);
  const kek = await options.kekManager.getOrCreate(userId);

  await options.vaultStore.addEntries(
    pending.map(({ rawValue, placeholderId, vaultType }) => ({
      userId,
      placeholderId,
      sensitiveType: vaultType,
      encrypted: encryptAndWrapValue(rawValue, vaultType, placeholderId, kek, fingerprint),
    })),
  );

  for (const { redaction } of pending) {
    if (redaction.alias) {
      await options.vaultStore.updateEntry(userId, redaction.sensitiveRef, {
        alias: redaction.alias,
      });
    }
  }
};
