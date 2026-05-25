import { PrivacyPipelineError } from '../../core/errors.js';
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
  const { publicKey } = await options.keyManager.getOrCreatePublicKey(userId);
  const fingerprint = computeKeyFingerprint(publicKey);
  const kek = await options.kekManager.getOrCreate(userId);

  const entries = await options.vaultStore.addEntries(
    pending.map(({ rawValue, placeholderId, vaultType }) => ({
      userId,
      placeholderId,
      sensitiveType: vaultType,
      encrypted: encryptAndWrapValue(rawValue, vaultType, placeholderId, kek, fingerprint),
    })),
  );
  if (entries.length !== pending.length) {
    throw new PrivacyPipelineError('redact: vault store did not persist every redaction');
  }
  const persistedRefs = new Set(entries.map((entry) => entry.placeholderId));
  for (const pendingWrite of pending) {
    if (!persistedRefs.has(pendingWrite.placeholderId)) {
      throw new PrivacyPipelineError('redact: vault store persisted an unexpected redaction set');
    }
  }
};
